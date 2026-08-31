import argparse
import hashlib
import json
import struct
import sys
from pathlib import Path

import bmesh
import bpy
from mathutils import Vector


SUPPORTED_SOURCE_SHA256 = "375e25dea0da0c8d4267ee4402a64cf4582520341b367e1163730b8f8fc56edb"
SUPPORTED_ISLAND_VERTEX_SIGNATURE = [61, 61, 114, 806, 807, 1345, 2959, 4772]


def parse_args():
    separator = sys.argv.index("--") if "--" in sys.argv else len(sys.argv)
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--target-height", required=True, type=float)
    args = parser.parse_args(sys.argv[separator + 1 :])
    if args.target_height <= 0:
        parser.error("target height must be positive")
    return args


def sha256(path):
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def object_points(obj):
    return [obj.matrix_world @ vertex.co for vertex in obj.data.vertices]


def bounds(objects):
    points = [point for obj in objects for point in object_points(obj)]
    minimum = Vector(tuple(min(point[axis] for point in points) for axis in range(3)))
    maximum = Vector(tuple(max(point[axis] for point in points) for axis in range(3)))
    return minimum, maximum


def mesh_health(obj):
    mesh = obj.data
    bm = bmesh.new()
    bm.from_mesh(mesh)
    health = {
        "vertices": len(bm.verts),
        "edges": len(bm.edges),
        "faces": len(bm.faces),
        "triangles": sum(1 for face in bm.faces if len(face.verts) == 3),
        "quads": sum(1 for face in bm.faces if len(face.verts) == 4),
        "ngons": sum(1 for face in bm.faces if len(face.verts) > 4),
        "runtimeTriangles": sum(max(0, len(face.verts) - 2) for face in bm.faces),
        "boundaryEdges": sum(1 for edge in bm.edges if edge.is_boundary),
        "overConnectedEdges": sum(1 for edge in bm.edges if len(edge.link_faces) > 2),
        "wireEdges": sum(1 for edge in bm.edges if len(edge.link_faces) == 0),
        "zeroAreaFaces": sum(1 for face in bm.faces if face.calc_area() <= 1e-12),
    }
    bm.free()
    return health


def aggregate_health(objects):
    totals = {
        "vertices": 0,
        "edges": 0,
        "faces": 0,
        "triangles": 0,
        "quads": 0,
        "ngons": 0,
        "runtimeTriangles": 0,
        "boundaryEdges": 0,
        "overConnectedEdges": 0,
        "wireEdges": 0,
        "zeroAreaFaces": 0,
    }
    for obj in objects:
        for key, value in mesh_health(obj).items():
            totals[key] += value
    return totals


def dimensions_record(minimum, maximum):
    size = maximum - minimum
    return {
        "minimum": [round(value, 6) for value in minimum],
        "maximum": [round(value, 6) for value in maximum],
        "dimensions": [round(value, 6) for value in size],
    }


def select_only(objects):
    bpy.ops.object.select_all(action="DESELECT")
    for obj in objects:
        obj.hide_set(False)
        obj.select_set(True)
    if objects:
        bpy.context.view_layer.objects.active = objects[0]


def apply_imported_transforms(objects):
    for obj in objects:
        select_only([obj])
        bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)


def cleanup_mesh(obj):
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    degenerate_faces = [face for face in bm.faces if face.calc_area() <= 1e-12]
    removed = len(degenerate_faces)
    if degenerate_faces:
        bmesh.ops.delete(bm, geom=degenerate_faces, context="FACES")
        loose_edges = [edge for edge in bm.edges if not edge.link_faces]
        if loose_edges:
            bmesh.ops.delete(bm, geom=loose_edges, context="EDGES")
        loose_vertices = [vertex for vertex in bm.verts if not vertex.link_edges]
        if loose_vertices:
            bmesh.ops.delete(bm, geom=loose_vertices, context="VERTS")
    if bm.faces:
        bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
    bm.to_mesh(obj.data)
    bm.free()
    obj.data.update()
    return removed


def separate_loose_geometry(objects):
    separated = []
    for obj in objects:
        select_only([obj])
        bpy.context.view_layer.objects.active = obj
        bpy.ops.object.mode_set(mode="EDIT")
        bpy.ops.mesh.select_all(action="SELECT")
        bpy.ops.mesh.separate(type="LOOSE")
        bpy.ops.object.mode_set(mode="OBJECT")
        separated.extend(selected for selected in bpy.context.selected_objects if selected.type == "MESH")
    return list(dict.fromkeys(separated))


def normalize_geometry(objects, measured_objects, target_height):
    minimum, maximum = bounds(measured_objects)
    original_size = maximum - minimum
    if original_size.z <= 0:
        raise RuntimeError("Imported character has no measurable vertical height")
    scale = target_height / original_size.z
    center_x = (minimum.x + maximum.x) / 2
    center_y = (minimum.y + maximum.y) / 2
    origin = Vector((center_x, center_y, minimum.z))

    for obj in objects:
        for vertex in obj.data.vertices:
            world_point = obj.matrix_world @ vertex.co
            vertex.co = (world_point - origin) * scale
        obj.matrix_world.identity()
        obj.data.update()

    normalized_minimum, normalized_maximum = bounds(measured_objects)
    return {
        "scaleFactor": scale,
        "sourceBounds": dimensions_record(minimum, maximum),
        "normalizedBounds": dimensions_record(normalized_minimum, normalized_maximum),
    }


def component_measurement(obj, total_height):
    minimum, maximum = bounds([obj])
    center = (minimum + maximum) / 2
    size = maximum - minimum
    return {
        "object": obj,
        "vertices": len(obj.data.vertices),
        "center": center,
        "minimum": minimum,
        "maximum": maximum,
        "dimensions": size,
        "relativeCenterHeight": center.z / total_height,
        "relativeHeight": size.z / total_height,
        "volume": size.x * size.y * size.z,
    }


def classify_components(objects, total_height):
    measured = [component_measurement(obj, total_height) for obj in objects]
    body = max(measured, key=lambda item: (item["relativeHeight"], item["vertices"]))
    remaining = [item for item in measured if item is not body]
    upper = [item for item in remaining if item["relativeCenterHeight"] > 0.72]
    if len(upper) < 2:
        raise RuntimeError("Could not identify separate hair and head components from spatial evidence")

    upper_by_vertices = sorted(upper, key=lambda item: item["vertices"], reverse=True)
    hair = upper_by_vertices[0]
    head = upper_by_vertices[1]
    remaining = [item for item in remaining if item not in (hair, head)]

    hand_candidates = [
        item
        for item in remaining
        if abs(item["center"].x) > total_height * 0.16
        and 0.35 < item["relativeCenterHeight"] < 0.8
    ]
    hand_candidates = sorted(hand_candidates, key=lambda item: item["vertices"], reverse=True)[:2]
    if len(hand_candidates) != 2:
        hand_candidates = sorted(
            remaining,
            key=lambda item: (abs(item["center"].x), item["vertices"]),
            reverse=True,
        )[:2]

    classifications = [(body, "Body"), (hair, "Hair_Source"), (head, "Head")]
    for hand in sorted(hand_candidates, key=lambda item: item["center"].x):
        side = "NegativeX" if hand["center"].x < 0 else "PositiveX"
        classifications.append((hand, f"Hand_{side}"))

    facial = [item for item in remaining if item not in hand_candidates]
    mirrored_pairs = []
    for left in facial:
        for right in facial:
            if left["center"].x >= 0 or right["center"].x <= 0:
                continue
            score = (
                abs(left["vertices"] - right["vertices"])
                + abs(abs(left["center"].x) - abs(right["center"].x)) * 1000
                + abs(left["center"].z - right["center"].z) * 1000
            )
            mirrored_pairs.append((score, left, right))
    eye_pair = min(mirrored_pairs, key=lambda value: value[0])[1:] if mirrored_pairs else ()
    if eye_pair:
        classifications.extend([(eye_pair[0], "Eye_NegativeX"), (eye_pair[1], "Eye_PositiveX")])
    remaining_facial = [item for item in facial if item not in eye_pair]
    for index, item in enumerate(remaining_facial, start=1):
        classifications.append((item, f"Facial_Feature_{index:02d}"))

    for item, name in classifications:
        item["object"].name = name
        item["object"].data.name = f"{name}_Mesh"
        item["classification"] = name
    return measured, hair["object"]


def collection(name):
    found = bpy.data.collections.get(name)
    if found:
        return found
    created = bpy.data.collections.new(name)
    bpy.context.scene.collection.children.link(created)
    return created


def move_to_collection(obj, destination):
    for source in list(obj.users_collection):
        source.objects.unlink(obj)
    destination.objects.link(obj)


def material(name, color, metallic=0.0, roughness=0.65):
    result = bpy.data.materials.new(name)
    result.diffuse_color = color
    result.metallic = metallic
    result.roughness = roughness
    return result


def assign_material(obj, assigned_material):
    obj.data.materials.clear()
    obj.data.materials.append(assigned_material)


def create_torso_mask(body, target_height, fit_collection):
    torso_mask = body.copy()
    torso_mask.data = body.data.copy()
    torso_mask.name = "MASK_Torso"
    torso_mask.data.name = "MASK_Torso_Mesh"
    fit_collection.objects.link(torso_mask)

    bm = bmesh.new()
    bm.from_mesh(torso_mask.data)
    minimum_z = target_height * 0.53
    maximum_z = target_height * 0.8
    maximum_x = target_height * 0.12
    outside = [
        face
        for face in bm.faces
        if not (
            minimum_z <= face.calc_center_median().z <= maximum_z
            and abs(face.calc_center_median().x) <= maximum_x
        )
    ]
    bmesh.ops.delete(bm, geom=outside, context="FACES")
    unused_vertices = [vertex for vertex in bm.verts if not vertex.link_faces]
    if unused_vertices:
        bmesh.ops.delete(bm, geom=unused_vertices, context="VERTS")
    bm.to_mesh(torso_mask.data)
    bm.free()
    torso_mask.data.update()
    if not torso_mask.data.polygons:
        raise RuntimeError("Torso mask selection produced no surface")

    torso_mask["ashveil_role"] = "body_mask_torso"
    torso_mask["selection_rule"] = (
        "body face center: 53%-80% target height and within 12% target height of center X"
    )

    fit_proxy = torso_mask.copy()
    fit_proxy.data = torso_mask.data.copy()
    fit_proxy.name = "PROXY_Torso_ArmorFit_NOT_PRODUCTION_ARMOR"
    fit_proxy.data.name = "PROXY_Torso_ArmorFit_Mesh"
    fit_collection.objects.link(fit_proxy)
    fit_proxy["ashveil_role"] = "armor_fit_proxy"
    fit_proxy["production_ready"] = False

    select_only([fit_proxy])
    modifier = fit_proxy.modifiers.new(name="Fit_Clearance_Solidify", type="SOLIDIFY")
    modifier.thickness = target_height * 0.008
    modifier.offset = 1.0
    modifier.use_even_offset = True
    bpy.context.view_layer.objects.active = fit_proxy
    bpy.ops.object.modifier_apply(modifier=modifier.name)
    return torso_mask, fit_proxy


def component_record(item):
    return {
        "name": item["classification"],
        "vertices": item["vertices"],
        "center": [round(value, 6) for value in item["center"]],
        "dimensions": [round(value, 6) for value in item["dimensions"]],
        "relativeCenterHeight": round(item["relativeCenterHeight"], 6),
        "classificationEvidence": {
            "relativeHeight": round(item["relativeHeight"], 6),
            "boundingBoxVolume": round(item["volume"], 9),
        },
    }


def export_glb(path, objects):
    select_only(objects)
    bpy.ops.export_scene.gltf(
        filepath=str(path),
        export_format="GLB",
        use_selection=True,
        export_yup=True,
    )


def point_camera(camera, point):
    camera.rotation_euler = (point - camera.location).to_track_quat("-Z", "Y").to_euler()


def render_views(output, visible_objects, target_height, fit_proxy):
    bpy.ops.object.select_all(action="DESELECT")
    for obj in bpy.context.scene.objects:
        if obj.type == "MESH":
            obj.hide_render = obj not in visible_objects
    minimum, maximum = bounds(visible_objects)
    center = (minimum + maximum) / 2
    width = maximum.x - minimum.x
    depth = maximum.y - minimum.y

    camera_data = bpy.data.cameras.new("Validation_Camera")
    camera = bpy.data.objects.new("Validation_Camera", camera_data)
    bpy.context.scene.collection.objects.link(camera)
    bpy.context.scene.camera = camera
    camera_data.type = "ORTHO"
    camera_data.ortho_scale = max(target_height * 1.1, width * 1.2)

    scene = bpy.context.scene
    scene.render.engine = "BLENDER_WORKBENCH"
    scene.display.shading.light = "STUDIO"
    scene.display.shading.color_type = "MATERIAL"
    scene.display.shading.show_shadows = True
    scene.display.shading.show_cavity = True
    scene.display.shading.cavity_type = "WORLD"
    scene.render.resolution_x = 768
    scene.render.resolution_y = 768
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.render.film_transparent = False

    distance = target_height * 3
    views = {
        "front": Vector((center.x, minimum.y - distance - depth, center.z)),
        "back": Vector((center.x, maximum.y + distance + depth, center.z)),
        "right": Vector((maximum.x + distance + width, center.y, center.z)),
    }
    rendered = []
    for name, position in views.items():
        camera.location = position
        point_camera(camera, center)
        path = output / f"validation-{name}.png"
        scene.render.filepath = str(path)
        bpy.ops.render.render(write_still=True)
        rendered.append(path)
    bpy.ops.object.select_all(action="DESELECT")
    fit_proxy.hide_render = False
    fit_proxy.hide_set(False)
    bpy.context.view_layer.update()
    camera.location = views["front"]
    point_camera(camera, center)
    fit_path = output / "validation-fit-proxy-front.png"
    scene.render.filepath = str(fit_path)
    bpy.ops.render.render(write_still=True)
    fit_proxy.hide_render = True
    rendered.append(fit_path)
    return rendered


def glb_structure(path):
    with path.open("rb") as source:
        if source.read(4) != b"glTF":
            raise RuntimeError(f"Invalid GLB header: {path}")
        source.read(8)
        document = None
        while chunk_header := source.read(8):
            chunk_length, chunk_type = struct.unpack("<II", chunk_header)
            chunk = source.read(chunk_length)
            if chunk_type == 0x4E4F534A:
                document = json.loads(chunk.decode("utf-8"))
                break
    if document is None:
        raise RuntimeError(f"GLB has no JSON document: {path}")
    meshes = document.get("meshes", [])
    return {
        "meshes": len(meshes),
        "primitives": sum(len(mesh.get("primitives", [])) for mesh in meshes),
        "nodes": len(document.get("nodes", [])),
        "materials": len(document.get("materials", [])),
        "meshPrimitiveCounts": [
            {
                "name": mesh.get("name", f"mesh-{index}"),
                "primitives": len(mesh.get("primitives", [])),
            }
            for index, mesh in enumerate(meshes)
        ],
    }


def output_record(path):
    record = {
        "path": path.name,
        "bytes": path.stat().st_size,
        "sha256": sha256(path),
    }
    if path.suffix == ".glb":
        record["gltfStructure"] = glb_structure(path)
    return record


def main():
    args = parse_args()
    source = Path(args.input).expanduser().resolve()
    output = Path(args.output).expanduser().resolve()
    if not source.is_file():
        raise FileNotFoundError(f"Input FBX does not exist: {source}")
    output.mkdir(parents=True, exist_ok=True)
    source_hash_before = sha256(source)
    if source_hash_before != SUPPORTED_SOURCE_SHA256:
        raise RuntimeError(
            "Unsupported FBX fingerprint. This spike only classifies the audited masculine Tripo source; "
            "add and review an explicit asset mapping before processing another model."
        )

    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.fbx(filepath=str(source))
    imported_meshes = [obj for obj in bpy.context.scene.objects if obj.type == "MESH"]
    if not imported_meshes:
        raise RuntimeError("FBX import produced no mesh objects")

    imported_minimum, imported_maximum = bounds(imported_meshes)
    imported_health = aggregate_health(imported_meshes)
    imported_object_transforms = [
        {
            "name": obj.name,
            "location": [round(value, 6) for value in obj.location],
            "rotationEuler": [round(value, 6) for value in obj.rotation_euler],
            "scale": [round(value, 6) for value in obj.scale],
        }
        for obj in imported_meshes
    ]

    apply_imported_transforms(imported_meshes)
    removed_zero_area_faces = sum(cleanup_mesh(obj) for obj in imported_meshes)
    components = separate_loose_geometry(imported_meshes)
    island_vertex_signature = sorted(len(obj.data.vertices) for obj in components)
    if island_vertex_signature != SUPPORTED_ISLAND_VERTEX_SIGNATURE:
        raise RuntimeError(
            f"Unsupported loose-island signature: {island_vertex_signature}; "
            f"expected {SUPPORTED_ISLAND_VERTEX_SIGNATURE}"
        )
    component_minimum, component_maximum = bounds(components)
    source_height = component_maximum.z - component_minimum.z
    measured, hair = classify_components(components, source_height)
    base_components = [obj for obj in components if obj is not hair]
    normalization = normalize_geometry(components, base_components, args.target_height)
    measured = [
        {
            **component_measurement(item["object"], args.target_height),
            "classification": item["classification"],
        }
        for item in measured
    ]

    base_collection = collection("CHARACTER_BASE_BALD")
    hair_collection = collection("EXCLUDED_SOURCE_HAIR")
    fit_collection = collection("ARMOR_FIT_SPIKE")
    for item in measured:
        obj = item["object"]
        move_to_collection(obj, hair_collection if obj is hair else base_collection)

    body = next(item["object"] for item in measured if item["classification"] == "Body")
    torso_mask, fit_proxy = create_torso_mask(body, args.target_height, fit_collection)

    body_material = material("Base_Undersuit", (0.12, 0.22, 0.24, 1.0), roughness=0.8)
    skin_material = material("Base_Skin", (0.58, 0.38, 0.28, 1.0), roughness=0.72)
    mask_material = material("Torso_BodyMask", (0.06, 0.3, 0.52, 1.0), roughness=0.6)
    proxy_material = material("Armor_Fit_Proxy", (0.95, 0.34, 0.06, 1.0), metallic=0.05, roughness=0.55)
    for item in measured:
        obj = item["object"]
        if obj is hair:
            continue
        assign_material(obj, body_material if item["classification"] == "Body" else skin_material)
    assign_material(torso_mask, mask_material)
    assign_material(fit_proxy, proxy_material)

    hair.hide_set(True)
    hair.hide_render = True
    hair["ashveil_role"] = "excluded_source_hair"
    hair["excluded_from_runtime_exports"] = True
    torso_mask.hide_set(True)
    torso_mask.hide_render = True
    fit_proxy.hide_set(True)
    fit_proxy.hide_render = True

    base_objects = [item["object"] for item in measured if item["object"] is not hair]
    bald_path = output / "masculine-bald-base.glb"
    fit_path = output / "masculine-armor-fit-proxy.glb"
    blend_path = output / "masculine-character-spike.blend"
    export_glb(bald_path, base_objects)
    export_glb(fit_path, base_objects + [fit_proxy])
    rendered_paths = render_views(output, base_objects, args.target_height, fit_proxy)
    bpy.ops.wm.save_as_mainfile(filepath=str(blend_path))

    normalized_minimum, normalized_maximum = bounds(base_objects)
    prepared_health = aggregate_health(base_objects)
    source_hash_after = sha256(source)
    if source_hash_after != source_hash_before:
        raise RuntimeError("Raw source FBX changed during the pipeline")

    artifact_paths = [blend_path, bald_path, fit_path, *rendered_paths]
    report = {
        "schemaVersion": 1,
        "pipeline": "ashveil-character-model-spike",
        "scope": "fingerprinted_masculine_mannequin_only",
        "status": "spike_not_production_ready",
        "source": {
            "path": source.name,
            "sha256Before": source_hash_before,
            "sha256After": source_hash_after,
            "preserved": source_hash_before == source_hash_after,
        },
        "blender": {
            "version": bpy.app.version_string,
            "background": bpy.app.background,
        },
        "parameters": {
            "targetHeightMetres": args.target_height,
            "status": "provisional_spike_parameter_not_canonical_scale",
        },
        "import": {
            "meshObjects": len(imported_meshes),
            "bounds": dimensions_record(imported_minimum, imported_maximum),
            "objectTransforms": imported_object_transforms,
            "meshHealth": imported_health,
            "acceptedIslandVertexSignature": island_vertex_signature,
        },
        "preparation": {
            "looseComponents": len(components),
            "removedZeroAreaFaces": removed_zero_area_faces,
            "normalization": normalization,
            "baldBounds": dimensions_record(normalized_minimum, normalized_maximum),
            "meshHealth": prepared_health,
            "components": [component_record(item) for item in measured],
            "hairExcludedFromRuntime": hair.name,
        },
        "armorFitSpike": {
            "status": "fit_proxy_not_production_armor",
            "bodyMaskObject": torso_mask.name,
            "fitProxyObject": fit_proxy.name,
            "maskFaces": len(torso_mask.data.polygons),
            "maskVertices": len(torso_mask.data.vertices),
            "proxyFaces": len(fit_proxy.data.polygons),
            "proxyVertices": len(fit_proxy.data.vertices),
            "clearanceMetres": args.target_height * 0.008,
            "selectionRule": torso_mask["selection_rule"],
            "diagnosticAssessment": (
                "Negative fit-quality diagnostic: axis-aligned extraction leaves jagged open boundaries "
                "and shoulder fragments. Production slot masks require authored boundaries and pose tests."
            ),
        },
        "runtimePackagingObservation": {
            "sourceBlenderMeshObjects": len(imported_meshes),
            "preparedSemanticMeshObjects": len(base_objects),
            "assessment": (
                "Semantic Blender objects export as separate glTF meshes/primitives. "
                "Draw calls depend on engine packaging and materials; this spike sets no runtime budget."
            ),
        },
        "exports": [output_record(path) for path in artifact_paths],
        "knownLimitations": [
            "Component labels are inferred from geometry size and position and need artist confirmation.",
            "The torso shell is an automated fit proxy, not authored or deformation-tested armor.",
            "The spike does not add UVs, textures, a skeleton, skin weights, or animation.",
            "Open component boundaries are preserved; the pipeline does not weld or remesh the source.",
            "The 1.8 m normalization target is provisional and is not integrated with runtime actor-radius scaling.",
        ],
    }
    report_path = output / "report.json"
    report_path.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(f"Character spike complete: {report_path}")


if __name__ == "__main__":
    main()
