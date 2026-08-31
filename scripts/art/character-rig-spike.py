import argparse
import hashlib
import json
import math
import struct
import sys
from pathlib import Path

import bmesh
import bpy
from mathutils import Vector


SEMANTIC_MESHES = [
    "Body",
    "Head",
    "Hand_NegativeX",
    "Hand_PositiveX",
    "Eye_NegativeX",
    "Eye_PositiveX",
    "Facial_Feature_01",
]
POSES = [
    ("bind", 0),
    ("overhead-reach", 10),
    ("horizontal-attack", 20),
    ("deep-elbow-bend", 30),
    ("long-stride", 40),
    ("head-turn", 50),
]
VIEWS = ("front", "back", "right")
EXPECTED_SOURCE_SHA256 = "375e25dea0da0c8d4267ee4402a64cf4582520341b367e1163730b8f8fc56edb"
EXPECTED_PREPARED_BLEND_SHA256 = "c9212b65a98456dbb2eaa2a51b4347d12ec6571e2162e9eda1592db6e25480c7"
EXPECTED_BALD_GLB_SHA256 = "76c95673872e1ac2042d8d965e950c846b7990f6701ac6d7df016015964f185d"
EXPECTED_VERTEX_COUNT = 7966
EXPECTED_HEIGHT = 1.8


def parse_args():
    separator = sys.argv.index("--") if "--" in sys.argv else len(sys.argv)
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True)
    parser.add_argument("--output", required=True)
    return parser.parse_args(sys.argv[separator + 1 :])


def sha256(path):
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def load_json(path):
    return json.loads(path.read_text(encoding="utf-8"))


def parse_glb(path):
    with path.open("rb") as source:
        if source.read(4) != b"glTF":
            raise RuntimeError(f"Invalid GLB header: {path.name}")
        source.read(8)
        document = None
        while header := source.read(8):
            chunk_length, chunk_type = struct.unpack("<II", header)
            chunk = source.read(chunk_length)
            if chunk_type == 0x4E4F534A:
                document = json.loads(chunk.decode("utf-8"))
                break
    if document is None:
        raise RuntimeError(f"GLB has no JSON document: {path.name}")
    meshes = document.get("meshes", [])
    skins = document.get("skins", [])
    animations = document.get("animations", [])
    interpolation_modes = sorted(
        {
            sampler.get("interpolation", "LINEAR")
            for animation in animations
            for sampler in animation.get("samplers", [])
        }
    )
    return {
        "meshes": len(meshes),
        "primitives": sum(len(mesh.get("primitives", [])) for mesh in meshes),
        "nodes": len(document.get("nodes", [])),
        "materials": len(document.get("materials", [])),
        "skins": len(skins),
        "joints": sum(len(skin.get("joints", [])) for skin in skins),
        "animations": len(animations),
        "animationNames": [animation.get("name", "") for animation in animations],
        "animationInterpolationModes": interpolation_modes,
    }


def validate_prepared_input(input_directory):
    report_path = input_directory / "report.json"
    blend_path = input_directory / "masculine-character-spike.blend"
    bald_path = input_directory / "masculine-bald-base.glb"
    for path in (report_path, blend_path, bald_path):
        if not path.is_file():
            raise RuntimeError(f"Prepared input is missing {path.name}")

    report = load_json(report_path)
    component_names = sorted(
        item["name"]
        for item in report.get("preparation", {}).get("components", [])
        if item.get("name") != "Hair_Source"
    )
    bounds = report.get("preparation", {}).get("baldBounds", {}).get("dimensions", [])
    bald_export = next(
        (entry for entry in report.get("exports", []) if entry.get("path") == bald_path.name),
        None,
    )
    blend_export = next(
        (entry for entry in report.get("exports", []) if entry.get("path") == blend_path.name),
        None,
    )
    if (
        report.get("pipeline") != "ashveil-character-model-spike"
        or report.get("status") != "spike_not_production_ready"
        or report.get("source", {}).get("sha256Before") != EXPECTED_SOURCE_SHA256
        or report.get("source", {}).get("sha256After") != EXPECTED_SOURCE_SHA256
        or report.get("source", {}).get("preserved") is not True
        or report.get("parameters", {}).get("targetHeightMetres") != EXPECTED_HEIGHT
        or report.get("preparation", {}).get("meshHealth", {}).get("vertices")
        != EXPECTED_VERTEX_COUNT
        or component_names != sorted(SEMANTIC_MESHES)
        or len(bounds) != 3
        or abs(bounds[2] - EXPECTED_HEIGHT) > 1e-6
        or blend_export is None
        or blend_export.get("sha256") != EXPECTED_PREPARED_BLEND_SHA256
        or sha256(blend_path) != EXPECTED_PREPARED_BLEND_SHA256
        or bald_export is None
        or bald_export.get("sha256") != EXPECTED_BALD_GLB_SHA256
        or sha256(bald_path) != EXPECTED_BALD_GLB_SHA256
    ):
        raise RuntimeError("Prepared report does not match the audited masculine mannequin contract")
    structure = parse_glb(bald_path)
    if structure != {
        "meshes": 7,
        "primitives": 7,
        "nodes": 7,
        "materials": 2,
        "skins": 0,
        "joints": 0,
        "animations": 0,
        "animationNames": [],
        "animationInterpolationModes": [],
    }:
        raise RuntimeError(f"Prepared bald GLB structure changed: {structure}")
    return report, report_path, blend_path, bald_path


def select_only(objects):
    bpy.ops.object.mode_set(mode="OBJECT") if bpy.context.object and bpy.context.object.mode != "OBJECT" else None
    bpy.ops.object.select_all(action="DESELECT")
    for obj in objects:
        obj.hide_set(False)
        obj.hide_render = False
        obj.select_set(True)
    if objects:
        bpy.context.view_layer.objects.active = objects[0]


def object_points(obj, evaluated=False):
    if not evaluated:
        return [obj.matrix_world @ vertex.co for vertex in obj.data.vertices]
    depsgraph = bpy.context.evaluated_depsgraph_get()
    evaluated_object = obj.evaluated_get(depsgraph)
    mesh = evaluated_object.to_mesh()
    try:
        return [evaluated_object.matrix_world @ vertex.co for vertex in mesh.vertices]
    finally:
        evaluated_object.to_mesh_clear()


def bounds(objects, evaluated=False):
    points = [point for obj in objects for point in object_points(obj, evaluated)]
    minimum = Vector(tuple(min(point[axis] for point in points) for axis in range(3)))
    maximum = Vector(tuple(max(point[axis] for point in points) for axis in range(3)))
    return minimum, maximum


def vector_record(vector):
    return [round(value, 6) for value in vector]


def create_bone(edit_bones, name, head, tail, parent=None, deform=True):
    bone = edit_bones.new(name)
    bone.head = head
    bone.tail = tail
    bone.use_deform = deform
    if parent:
        bone.parent = edit_bones[parent]
    return bone


def create_armature():
    armature_data = bpy.data.armatures.new("Ashveil_DiagnosticRig")
    armature = bpy.data.objects.new("Ashveil_DiagnosticRig", armature_data)
    bpy.context.scene.collection.objects.link(armature)
    select_only([armature])
    bpy.ops.object.mode_set(mode="EDIT")
    bones = armature_data.edit_bones
    create_bone(bones, "root", (0, 0, 0), (0, 0, 0.12), deform=False)
    create_bone(bones, "pelvis", (0, 0, 0.76), (0, 0, 0.96), "root")
    create_bone(bones, "spine", (0, 0, 0.96), (0, 0, 1.18), "pelvis")
    create_bone(bones, "chest", (0, 0, 1.18), (0, 0, 1.4), "spine")
    create_bone(bones, "neck", (0, 0, 1.4), (0, 0, 1.515), "chest")
    create_bone(bones, "head", (0, 0, 1.515), (0, 0, 1.77), "neck")

    for suffix, sign in (("L", 1), ("R", -1)):
        create_bone(
            bones,
            f"clavicle.{suffix}",
            (0.01 * sign, 0, 1.39),
            (0.19 * sign, 0, 1.36),
            "chest",
        )
        create_bone(
            bones,
            f"upper_arm.{suffix}",
            (0.19 * sign, 0, 1.36),
            (0.34 * sign, -0.005, 1.16),
            f"clavicle.{suffix}",
        )
        create_bone(
            bones,
            f"forearm.{suffix}",
            (0.34 * sign, -0.005, 1.16),
            (0.43 * sign, -0.02, 0.95),
            f"upper_arm.{suffix}",
        )
        create_bone(
            bones,
            f"hand.{suffix}",
            (0.43 * sign, -0.02, 0.95),
            (0.44 * sign, -0.035, 0.8),
            f"forearm.{suffix}",
        )
        create_bone(
            bones,
            f"thigh.{suffix}",
            (0.105 * sign, 0, 0.88),
            (0.105 * sign, 0, 0.51),
            "pelvis",
        )
        create_bone(
            bones,
            f"shin.{suffix}",
            (0.105 * sign, 0, 0.51),
            (0.105 * sign, 0, 0.12),
            f"thigh.{suffix}",
        )
        create_bone(
            bones,
            f"foot.{suffix}",
            (0.105 * sign, 0, 0.12),
            (0.105 * sign, -0.14, 0.045),
            f"shin.{suffix}",
        )
    for bone in bones:
        if abs(bone.vector.z) < bone.length * 0.95:
            bone.align_roll(Vector((0, -1, 0)))
    bpy.ops.object.mode_set(mode="OBJECT")
    armature.show_in_front = True
    armature.data.display_type = "STICK"
    armature["coordinate_contract"] = "Blender Z-up; front -Y; anatomical .L +X; ground Z=0"
    return armature


def bind_meshes(meshes, armature):
    select_only(meshes + [armature])
    bpy.context.view_layer.objects.active = armature
    bpy.ops.object.parent_set(type="ARMATURE_AUTO")
    for obj in meshes:
        modifiers = [modifier for modifier in obj.modifiers if modifier.type == "ARMATURE"]
        if len(modifiers) != 1 or modifiers[0].object != armature:
            raise RuntimeError(f"{obj.name} did not bind to the shared armature")


def normalize_weights(meshes):
    bone_names = {bone.name for bone in bpy.data.objects["Ashveil_DiagnosticRig"].data.bones if bone.use_deform}
    report = []
    total_weighted = 0
    maximum_influences = 0
    all_finite = True
    normalized = True
    for obj in meshes:
        group_by_index = {group.index: group for group in obj.vertex_groups if group.name in bone_names}
        weighted = 0
        object_maximum = 0
        for vertex in obj.data.vertices:
            influences = [
                (group_by_index[element.group], element.weight)
                for element in vertex.groups
                if element.group in group_by_index and element.weight > 0
            ]
            influences.sort(key=lambda item: item[1], reverse=True)
            kept = influences[:4]
            for group, _ in influences[4:]:
                group.remove([vertex.index])
            total = sum(weight for _, weight in kept)
            if not math.isfinite(total) or total <= 0:
                continue
            for group, weight in kept:
                normalized_weight = weight / total
                all_finite = all_finite and math.isfinite(normalized_weight)
                group.add([vertex.index], normalized_weight, "REPLACE")
            weighted += 1
            object_maximum = max(object_maximum, len(kept))
            normalized = normalized and abs(sum(weight / total for _, weight in kept) - 1.0) <= 1e-6
        total_weighted += weighted
        maximum_influences = max(maximum_influences, object_maximum)
        report.append(
            {
                "name": obj.name,
                "vertices": len(obj.data.vertices),
                "weightedVertices": weighted,
                "maximumInfluences": object_maximum,
            }
        )
    if total_weighted != EXPECTED_VERTEX_COUNT or maximum_influences > 4 or not normalized or not all_finite:
        raise RuntimeError("Automatic weights failed the normalized four-influence contract")
    return report, total_weighted, maximum_influences, normalized, all_finite


def reset_pose(armature):
    for bone in armature.pose.bones:
        bone.rotation_mode = "XYZ"
        bone.location = (0, 0, 0)
        bone.rotation_euler = (0, 0, 0)
        bone.scale = (1, 1, 1)


def set_rotation(armature, name, axis, degrees):
    armature.pose.bones[name].rotation_euler[axis] = math.radians(degrees)


def apply_pose(armature, pose_name):
    reset_pose(armature)
    channels = []

    def rotate(name, axis, degrees):
        set_rotation(armature, name, axis, degrees)
        channels.append({"bone": name, "axis": "XYZ"[axis], "degrees": degrees})

    if pose_name == "overhead-reach":
        rotate("clavicle.L", 2, 20)
        rotate("clavicle.R", 2, -20)
        rotate("upper_arm.L", 2, 145)
        rotate("upper_arm.R", 2, -145)
        rotate("forearm.L", 2, -8)
        rotate("forearm.R", 2, 8)
    elif pose_name == "horizontal-attack":
        rotate("chest", 1, 35)
        rotate("clavicle.L", 2, 12)
        rotate("upper_arm.L", 2, 70)
        rotate("upper_arm.L", 1, -25)
        rotate("forearm.L", 2, 35)
        rotate("clavicle.R", 2, -12)
        rotate("upper_arm.R", 2, -45)
        rotate("upper_arm.R", 1, 20)
    elif pose_name == "deep-elbow-bend":
        rotate("upper_arm.L", 2, 35)
        rotate("forearm.L", 2, 135)
    elif pose_name == "long-stride":
        armature.pose.bones["pelvis"].location.z = -0.1
        channels.append({"bone": "pelvis", "axis": "location.Z", "metres": -0.1})
        rotate("thigh.L", 0, 60)
        rotate("shin.L", 0, -100)
        rotate("thigh.R", 0, -30)
        rotate("shin.R", 0, 18)
    elif pose_name == "head-turn":
        rotate("neck", 1, 25)
        rotate("head", 1, 45)
    return channels


def key_pose(armature, frame):
    for bone in armature.pose.bones:
        bone.keyframe_insert(data_path="location", frame=frame, group=bone.name)
        bone.keyframe_insert(data_path="rotation_euler", frame=frame, group=bone.name)
        bone.keyframe_insert(data_path="scale", frame=frame, group=bone.name)


def create_action(armature):
    bpy.context.scene.render.fps = 30
    bpy.context.scene.frame_start = 0
    bpy.context.scene.frame_end = 50
    armature.animation_data_create()
    action = bpy.data.actions.new("Ashveil_RigStress")
    armature.animation_data.action = action
    pose_channels = {}
    for pose_name, frame in POSES:
        pose_channels[pose_name] = apply_pose(armature, pose_name)
        key_pose(armature, frame)
        marker = action.pose_markers.new(pose_name)
        marker.frame = frame
    reset_pose(armature)
    bpy.context.scene.frame_set(0)
    curves = []
    if hasattr(action, "fcurves"):
        curves.extend(action.fcurves)
    else:
        for layer in action.layers:
            for strip in layer.strips:
                for channel_bag in strip.channelbags:
                    curves.extend(channel_bag.fcurves)
    for curve in curves:
        for point in curve.keyframe_points:
            point.interpolation = "CONSTANT"
    keyframe_count = sum(len(curve.keyframe_points) for curve in curves)
    if not curves or any(
        point.interpolation != "CONSTANT" for curve in curves for point in curve.keyframe_points
    ):
        raise RuntimeError("Rig stress action did not retain constant interpolation")
    action["frames_per_second"] = 30
    action["diagnostic_only"] = True
    return action, pose_channels, len(curves), keyframe_count


def boundary_vertex_indices(obj):
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    indices = sorted({vertex.index for edge in bm.edges if edge.is_boundary for vertex in edge.verts})
    bm.free()
    return indices


def seam_pairs(primary, secondary, count, maximum_distance):
    primary_points = object_points(primary)
    secondary_points = object_points(secondary)
    primary_boundary = boundary_vertex_indices(primary)
    secondary_boundary = boundary_vertex_indices(secondary)
    candidates = []
    for secondary_index in secondary_boundary:
        point = secondary_points[secondary_index]
        nearest_index, distance = min(
            ((index, (primary_points[index] - point).length) for index in primary_boundary),
            key=lambda item: item[1],
        )
        if distance <= maximum_distance:
            candidates.append((distance, nearest_index, secondary_index))
    candidates.sort()
    selected = []
    for distance, primary_index, secondary_index in candidates:
        selected.append(
            {
                "primaryVertex": primary_index,
                "secondaryVertex": secondary_index,
                "baselineMetres": distance,
            }
        )
        if len(selected) == count:
            break
    if len(selected) != count:
        raise RuntimeError(
            f"Expected {count} seam pairs for {primary.name}/{secondary.name}, found {len(selected)}"
        )
    return selected


def measure_seams(seam_contracts, meshes_by_name):
    evaluated = {name: object_points(obj, evaluated=True) for name, obj in meshes_by_name.items()}
    results = []
    passed = True
    for contract in seam_contracts:
        distances = []
        pair_records = []
        primary_points = evaluated[contract["primary"]]
        secondary_points = evaluated[contract["secondary"]]
        for pair in contract["pairs"]:
            distance = (
                primary_points[pair["primaryVertex"]] - secondary_points[pair["secondaryVertex"]]
            ).length
            pair_passed = distance <= 0.03 and distance <= pair["baselineMetres"] * 2
            passed = passed and pair_passed
            distances.append(distance)
            pair_records.append(
                {
                    **pair,
                    "distanceMetres": distance,
                    "pass": pair_passed,
                }
            )
        results.append(
            {
                "name": contract["name"],
                "maximumMetres": max(distances),
                "minimumMetres": min(distances),
                "pass": all(pair["pass"] for pair in pair_records),
                "pairs": pair_records,
            }
        )
    return results, passed


def add_materials(meshes):
    body_material = bpy.data.materials.get("Base_Undersuit")
    skin_material = bpy.data.materials.get("Base_Skin")
    for obj in meshes:
        obj.show_wire = True
        obj.show_all_edges = True
        if not obj.data.materials:
            obj.data.materials.append(body_material if obj.name == "Body" else skin_material)


def create_wire_overlays(meshes):
    wire_material = bpy.data.materials.new("Diagnostic_Wire")
    wire_material.diffuse_color = (0.008, 0.01, 0.014, 1.0)
    wire_material.roughness = 1.0
    overlays = []
    for obj in meshes:
        overlay = obj.copy()
        overlay.data = obj.data.copy()
        overlay.name = f"WIRE_{obj.name}"
        overlay.data.name = f"WIRE_{obj.data.name}"
        obj.users_collection[0].objects.link(overlay)
        overlay.data.materials.clear()
        overlay.data.materials.append(wire_material)
        wireframe = overlay.modifiers.new(name="Diagnostic_Wireframe", type="WIREFRAME")
        wireframe.thickness = 0.0012
        wireframe.offset = 1.0
        wireframe.use_replace = True
        overlay["diagnostic_render_only"] = True
        overlays.append(overlay)
    return overlays


def point_camera(camera, target):
    camera.rotation_euler = (target - camera.location).to_track_quat("-Z", "Y").to_euler()


def setup_render(meshes, wire_overlays, armature):
    for obj in bpy.context.scene.objects:
        obj.hide_render = obj not in meshes and obj not in wire_overlays
    camera_data = bpy.data.cameras.new("Rig_Validation_Camera")
    camera = bpy.data.objects.new("Rig_Validation_Camera", camera_data)
    bpy.context.scene.collection.objects.link(camera)
    bpy.context.scene.camera = camera
    camera_data.type = "ORTHO"
    camera_data.ortho_scale = 2.05
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_WORKBENCH"
    scene.display.shading.light = "STUDIO"
    scene.display.shading.color_type = "MATERIAL"
    scene.display.shading.show_shadows = True
    scene.display.shading.show_cavity = True
    scene.display.shading.cavity_type = "WORLD"
    scene.display.shading.show_specular_highlight = True
    scene.render.resolution_x = 640
    scene.render.resolution_y = 640
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.render.film_transparent = False
    armature.hide_render = True
    return camera


def render_pose_views(output, camera, pose_name, frame, meshes):
    scene = bpy.context.scene
    scene.frame_set(frame)
    bpy.context.view_layer.update()
    minimum, maximum = bounds(meshes, evaluated=True)
    target = (minimum + maximum) / 2
    dimensions = maximum - minimum
    camera.data.ortho_scale = max(dimensions.z * 1.14, dimensions.x * 1.2, dimensions.y * 1.2)
    distance = max(dimensions) * 3
    views = {
        "front": Vector((target.x, minimum.y - distance, target.z)),
        "back": Vector((target.x, maximum.y + distance, target.z)),
        "right": Vector((maximum.x + distance, target.y, target.z)),
    }
    paths = []
    for view_name, position in views.items():
        camera.location = position
        point_camera(camera, target)
        path = output / f"validation-{pose_name}-{view_name}.png"
        scene.render.filepath = str(path)
        bpy.ops.render.render(write_still=True)
        paths.append(path)
    return paths


def export_glb(path, meshes, armature):
    select_only(meshes + [armature])
    bpy.context.view_layer.objects.active = armature
    bpy.ops.export_scene.gltf(
        filepath=str(path),
        export_format="GLB",
        use_selection=True,
        export_yup=True,
        export_skins=True,
        export_animations=True,
        export_animation_mode="ACTIONS",
        export_force_sampling=True,
        export_all_influences=False,
    )


def artifact_record(path):
    record = {"path": path.name, "bytes": path.stat().st_size, "sha256": sha256(path)}
    if path.suffix == ".glb":
        record["gltfStructure"] = parse_glb(path)
    return record


def main():
    args = parse_args()
    input_directory = Path(args.input).resolve()
    output = Path(args.output).resolve()
    prepared_report, report_path, blend_path, bald_path = validate_prepared_input(input_directory)
    output.mkdir(parents=True, exist_ok=True)
    input_hashes_before = {path.name: sha256(path) for path in (report_path, blend_path, bald_path)}

    bpy.ops.wm.open_mainfile(filepath=str(blend_path))
    meshes_by_name = {name: bpy.data.objects.get(name) for name in SEMANTIC_MESHES}
    if any(obj is None or obj.type != "MESH" for obj in meshes_by_name.values()):
        raise RuntimeError("Prepared blend does not contain the seven semantic base mesh objects")
    meshes = [meshes_by_name[name] for name in SEMANTIC_MESHES]
    if sum(len(obj.data.vertices) for obj in meshes) != EXPECTED_VERTEX_COUNT:
        raise RuntimeError("Prepared blend vertex count changed")
    for obj in list(bpy.context.scene.objects):
        if obj.type in {"CAMERA", "LIGHT", "ARMATURE"} or (obj.type == "MESH" and obj not in meshes):
            bpy.data.objects.remove(obj, do_unlink=True)

    add_materials(meshes)
    armature = create_armature()
    bind_meshes(meshes, armature)
    weight_objects, weighted_vertices, maximum_influences, normalized, finite_weights = normalize_weights(
        meshes
    )
    action, pose_channels, curve_count, keyframe_count = create_action(armature)
    wire_overlays = create_wire_overlays(meshes)

    seam_contracts = [
        {
            "name": "head-body",
            "primary": "Body",
            "secondary": "Head",
            "pairs": seam_pairs(meshes_by_name["Body"], meshes_by_name["Head"], 27, 0.03),
        },
        {
            "name": "negative-x-hand-body",
            "primary": "Body",
            "secondary": "Hand_NegativeX",
            "pairs": seam_pairs(
                meshes_by_name["Body"], meshes_by_name["Hand_NegativeX"], 13, 0.03
            ),
        },
        {
            "name": "positive-x-hand-body",
            "primary": "Body",
            "secondary": "Hand_PositiveX",
            "pairs": seam_pairs(
                meshes_by_name["Body"], meshes_by_name["Hand_PositiveX"], 13, 0.03
            ),
        },
    ]

    camera = setup_render(meshes, wire_overlays, armature)
    render_paths = []
    seam_pose_results = []
    bounds_pose_results = []
    seams_pass = True
    bounds_pass = True
    for pose_name, frame in POSES:
        bpy.context.scene.frame_set(frame)
        bpy.context.view_layer.update()
        pose_seams, pose_passed = measure_seams(seam_contracts, meshes_by_name)
        seams_pass = seams_pass and pose_passed
        minimum, maximum = bounds(meshes, evaluated=True)
        coordinates_finite = all(math.isfinite(value) for value in (*minimum, *maximum))
        grounded = minimum.z >= -0.05
        bounds_pass = bounds_pass and coordinates_finite and grounded
        seam_pose_results.append(
            {"name": pose_name, "frame": frame, "pass": pose_passed, "groups": pose_seams}
        )
        bounds_pose_results.append(
            {
                "name": pose_name,
                "frame": frame,
                "minimum": vector_record(minimum),
                "maximum": vector_record(maximum),
                "groundMinimumZ": minimum.z,
                "finite": coordinates_finite,
                "pass": coordinates_finite and grounded,
            }
        )
        render_paths.extend(render_pose_views(output, camera, pose_name, frame, meshes))
    if not seams_pass:
        print(
            "SEAM_DIAGNOSTIC "
            + json.dumps(
                [
                    {
                        "pose": pose["name"],
                        "groups": [
                            {
                                "name": group["name"],
                                "maximumMetres": group["maximumMetres"],
                                "pass": group["pass"],
                            }
                            for group in pose["groups"]
                        ],
                    }
                    for pose in seam_pose_results
                ]
            )
        )
        raise RuntimeError("A tracked neck or wrist seam exceeded its diagnostic threshold")
    if not bounds_pass:
        raise RuntimeError("A stress pose produced invalid bounds or crossed the ground tolerance")

    glb_path = output / "masculine-rigged-diagnostic.glb"
    blend_output_path = output / "masculine-rig-spike.blend"
    bpy.context.scene.frame_set(0)
    export_glb(glb_path, meshes, armature)
    glb_structure = parse_glb(glb_path)
    if (
        glb_structure["meshes"] != 7
        or glb_structure["primitives"] != 7
        or glb_structure["skins"] != 1
        or glb_structure["joints"] != 20
        or glb_structure["animations"] != 1
        or glb_structure["animationNames"] != ["Ashveil_RigStress"]
    ):
        raise RuntimeError(f"Rigged GLB structure failed: {glb_structure}")
    bpy.ops.wm.save_as_mainfile(filepath=str(blend_output_path))

    input_hashes_after = {path.name: sha256(path) for path in (report_path, blend_path, bald_path)}
    if input_hashes_after != input_hashes_before:
        raise RuntimeError("A prepared input changed during rig generation")
    artifacts = [blend_output_path, glb_path, *render_paths]
    report = {
        "schemaVersion": 1,
        "pipeline": "ashveil-character-rig-spike",
        "status": "diagnostic_not_production_ready",
        "input": {
            "directory": input_directory.name,
            "sourceSha256": prepared_report["source"]["sha256Before"],
            "files": [
                {
                    "path": name,
                    "sha256Before": input_hashes_before[name],
                    "sha256After": input_hashes_after[name],
                }
                for name in sorted(input_hashes_before)
            ],
            "preserved": input_hashes_before == input_hashes_after,
        },
        "coordinateContract": {
            "source": "Blender Z-up, front -Y, ground Z=0",
            "runtime": "glTF Y-up",
            "anatomicalLeft": "+X",
            "anatomicalRight": "-X",
            "heightMetres": EXPECTED_HEIGHT,
            "heightStatus": "provisional_not_canonical_runtime_scale",
        },
        "skeleton": {
            "name": armature.name,
            "bones": len(armature.data.bones),
            "deformBones": sum(1 for bone in armature.data.bones if bone.use_deform),
            "rootBone": "root",
            "rootDeforms": armature.data.bones["root"].use_deform,
            "boneNames": [bone.name for bone in armature.data.bones],
        },
        "weights": {
            "vertices": EXPECTED_VERTEX_COUNT,
            "weightedVertices": weighted_vertices,
            "maximumInfluences": maximum_influences,
            "normalized": normalized,
            "finite": finite_weights,
            "sharedArmatureModifier": True,
            "objects": weight_objects,
        },
        "animation": {
            "name": action.name,
            "framesPerSecond": 30,
            "frameStart": 0,
            "frameEnd": 50,
            "durationSeconds": 50 / 30,
            "sourceInterpolation": "CONSTANT",
            "runtimeInterpolationModes": glb_structure["animationInterpolationModes"],
            "fCurves": curve_count,
            "keyframes": keyframe_count,
            "poses": [{"name": name, "frame": frame} for name, frame in POSES],
            "poseChannels": pose_channels,
            "diagnosticOnly": True,
        },
        "seams": {
            "thresholdMetres": 0.03,
            "maximumBaselineMultiplier": 2,
            "fixedBindCorrespondences": seam_contracts,
            "poses": seam_pose_results,
            "pass": seams_pass,
        },
        "groundAndBounds": {"poses": bounds_pose_results, "pass": bounds_pass},
        "export": {
            "path": glb_path.name,
            "gltfStructure": glb_structure,
            "containsArmorProxy": False,
        },
        "renders": [path.name for path in render_paths],
        "artifacts": [artifact_record(path) for path in artifacts],
        "knownLimitations": [
            "This is an automatic-weight diagnostic rig, not a production skeleton or animation set.",
            "The spike does not validate feminine parity, armor transfer, retargeting, root motion, UVs, or textures.",
            "Passing seam distances does not replace visual review of neck, wrists, shoulders, elbows, hips, and knees.",
            "The long-stride pose lifts the leading foot and exposes a rough knee silhouette; it is negative deformation evidence, not a production animation pass.",
            "The 1.8 metre source normalization remains provisional relative to actor-radius runtime scaling.",
        ],
    }
    (output / "report.json").write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(f"Character rig spike complete: {output / 'report.json'}")


if __name__ == "__main__":
    main()
