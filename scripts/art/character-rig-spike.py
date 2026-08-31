import argparse
import hashlib
import json
import math
import struct
import sys
from pathlib import Path

import bmesh
import bpy
from mathutils import Matrix, Quaternion, Vector

sys.path.insert(0, str(Path(__file__).resolve().parent))
from humanoid_landmarks import HUMANOID_V1, fit_humanoid_landmarks, mirror_pair, robust_surface_center


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
    ("cross-body-reach", 20),
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
CONTRACT_PATH = Path(__file__).resolve().parent / "contracts" / "humanoid.v1.json"
JOINT_NAMES = [
    f"{name}.{side}"
    for name in ("shoulder", "elbow", "wrist", "hip", "knee", "ankle")
    for side in ("L", "R")
] + ["pelvis", "chest", "neck", "head"]


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
        binary = b""
        while header := source.read(8):
            chunk_length, chunk_type = struct.unpack("<II", header)
            chunk = source.read(chunk_length)
            if chunk_type == 0x4E4F534A:
                document = json.loads(chunk.decode("utf-8"))
            elif chunk_type == 0x004E4942:
                binary = chunk
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
    nodes = document.get("nodes", [])
    animation_target_names = sorted(
        {
            nodes[channel.get("target", {}).get("node", -1)].get("name", "")
            for animation in animations
            for channel in animation.get("channels", [])
            if 0 <= channel.get("target", {}).get("node", -1) < len(nodes)
        }
    )
    all_node_names = sorted(node.get("name", "") for node in nodes)
    authoring_leakage = [
        name
        for name in sorted(set(all_node_names + animation_target_names))
        if name.startswith(("CTRL_", "ORG-", "MCH-", "DEF-")) or "Authoring" in name
    ]
    parent_by_index = {}
    for parent_index, node in enumerate(nodes):
        for child_index in node.get("children", []):
            parent_by_index[child_index] = parent_index
    joint_names = []
    joint_parent_graph = {}
    inverse_bind = None
    runtime_rest_signature = None
    rigify_leakage = []
    if skins:
        joint_indices = skins[0].get("joints", [])
        joint_names = [nodes[index].get("name", "") for index in joint_indices]
        joint_set = set(joint_indices)
        joint_parent_graph = {
            nodes[index].get("name", ""): (
                nodes[parent_by_index[index]].get("name", "") if parent_by_index.get(index) in joint_set else None
            )
            for index in joint_indices
        }
        rest_records = [
            {
                "name": nodes[index].get("name", ""),
                "parent": joint_parent_graph[nodes[index].get("name", "")],
                "matrix": nodes[index].get("matrix"),
                "translation": nodes[index].get("translation"),
                "rotation": nodes[index].get("rotation"),
                "scale": nodes[index].get("scale"),
            }
            for index in sorted(joint_indices, key=lambda item: nodes[item].get("name", ""))
        ]
        runtime_rest_signature = hashlib.sha256(
            json.dumps(rest_records, sort_keys=True, separators=(",", ":")).encode("utf-8")
        ).hexdigest()
        accessor = document["accessors"][skins[0]["inverseBindMatrices"]]
        buffer_view = document["bufferViews"][accessor["bufferView"]]
        byte_offset = buffer_view.get("byteOffset", 0) + accessor.get("byteOffset", 0)
        byte_length = accessor["count"] * 16 * 4
        inverse_bytes = binary[byte_offset : byte_offset + byte_length]
        inverse_bind = {
            "count": accessor["count"],
            "type": accessor["type"],
            "componentType": accessor["componentType"],
            "sha256": hashlib.sha256(inverse_bytes).hexdigest(),
        }
        rigify_leakage = [name for name in joint_names if name.startswith(("ORG-", "MCH-", "CTRL-", "DEF-"))]
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
        "animationTargetNodeNames": animation_target_names,
        "nodeNames": all_node_names,
        "authoringRigLeakage": authoring_leakage,
        "jointNames": joint_names,
        "jointParentGraph": joint_parent_graph,
        "inverseBindMatrices": inverse_bind,
        "runtimeRestSignatureSha256": runtime_rest_signature,
        "rigifyControlLeakage": rigify_leakage,
        "skinnedMeshNames": sorted(node.get("name", "") for node in nodes if "skin" in node and "mesh" in node),
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
    if {key: structure[key] for key in ("meshes", "primitives", "nodes", "materials", "skins", "joints", "animations")} != {
        "meshes": 7, "primitives": 7, "nodes": 7, "materials": 2, "skins": 0, "joints": 0, "animations": 0
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


def load_contract():
    contract = load_json(CONTRACT_PATH)
    if contract.get("name") != "humanoid.v1" or len(contract.get("bones", [])) != 20:
        raise RuntimeError("Invalid humanoid.v1 skeleton manifest")
    return contract


def seam_landmark(contract, meshes_by_name):
    primary = meshes_by_name[contract["primary"]]
    secondary = meshes_by_name[contract["secondary"]]
    primary_points = object_points(primary)
    secondary_points = object_points(secondary)
    midpoints = [
        tuple(
            (primary_points[pair["primaryVertex"]][axis] + secondary_points[pair["secondaryVertex"]][axis]) / 2
            for axis in range(3)
        )
        for pair in contract["pairs"]
    ]
    return robust_surface_center(midpoints), {
        "method": "frozen_boundary_pair_midpoints",
        "sourceObjects": [contract["primary"], contract["secondary"]],
        "sourceVertexPairs": [
            [pair["primaryVertex"], pair["secondaryVertex"]] for pair in contract["pairs"]
        ],
        "sampleCount": len(midpoints),
        "confidence": min(1.0, len(midpoints) / 24),
    }


def fit_landmarks(meshes_by_name, seam_contracts):
    components = {
        name: [tuple(point) for point in object_points(obj)] for name, obj in meshes_by_name.items()
    }
    fitted = fit_humanoid_landmarks(components)
    positive_hand_center = Vector(robust_surface_center(components["Hand_PositiveX"]))
    negative_hand_center = Vector(robust_surface_center(components["Hand_NegativeX"]))
    if (
        abs(fitted["bounds"]["height"] - EXPECTED_HEIGHT) > 1e-6
        or positive_hand_center.x <= 0
        or negative_hand_center.x >= 0
        or abs(positive_hand_center.x + negative_hand_center.x) > fitted["symmetryToleranceMetres"]
    ):
        raise RuntimeError("Prepared geometry violates humanoid.v1 orientation or side identity")
    fitted["canonicalization"] = {
        "transformsApplied": True,
        "heightMetres": fitted["bounds"]["height"],
        "positiveXHandCenter": vector_record(positive_hand_center),
        "negativeXHandCenter": vector_record(negative_hand_center),
        "mirroredInputRejected": True,
    }
    by_name = {contract["name"]: contract for contract in seam_contracts}
    left_wrist, left_measurement = seam_landmark(by_name["positive-x-hand-body"], meshes_by_name)
    right_wrist, right_measurement = seam_landmark(by_name["negative-x-hand-body"], meshes_by_name)
    fitted["landmarks"]["wrist.L"], fitted["landmarks"]["wrist.R"], wrist_symmetry = mirror_pair(
        left_wrist, right_wrist
    )
    left_measurement["rawTargetWorld"] = left_wrist
    right_measurement["rawTargetWorld"] = right_wrist
    fitted["measurements"]["wrist.L"] = left_measurement
    fitted["measurements"]["wrist.R"] = right_measurement
    fitted["rawSymmetryErrorMetres"]["wrist"] = wrist_symmetry
    neck, neck_measurement = seam_landmark(by_name["head-body"], meshes_by_name)
    fitted["landmarks"]["neck"] = (0.0, neck[1], neck[2])
    neck_measurement["rawTargetWorld"] = neck
    fitted["measurements"]["neck"] = neck_measurement
    if wrist_symmetry > fitted["symmetryToleranceMetres"]:
        raise RuntimeError("Wrist seam landmarks exceed humanoid.v1 symmetry tolerance")
    return fitted


def control_pole(start, joint, end, total_length):
    start = Vector(start)
    joint = Vector(joint)
    axis = (Vector(end) - start).normalized()
    projection = start + axis * (joint - start).dot(axis)
    offset = joint - projection
    if offset.length < 1e-5:
        raise RuntimeError("A humanoid.v1 chain cannot derive a non-collinear bind pole")
    return projection + offset.normalized() * total_length * 0.3


def create_armature(landmarks, contract, name="Ashveil_DiagnosticRig", authoring=False):
    armature_data = bpy.data.armatures.new(name)
    armature = bpy.data.objects.new(name, armature_data)
    bpy.context.scene.collection.objects.link(armature)
    select_only([armature])
    bpy.ops.object.mode_set(mode="EDIT")
    bones = armature_data.edit_bones
    for definition in contract["bones"]:
        create_bone(
            bones,
            definition["name"],
            landmarks[definition["head"]],
            landmarks[definition["tail"]],
            definition["parent"],
            definition["deform"] and not authoring,
        )
    if authoring:
        create_bone(bones, "CTRL_cog", landmarks["pelvis"], Vector(landmarks["pelvis"]) + Vector((0, 0, 0.08)), deform=False)
        for side in ("L", "R"):
            shoulder = Vector(landmarks[f"shoulder.{side}"])
            elbow = Vector(landmarks[f"elbow.{side}"])
            wrist = Vector(landmarks[f"wrist.{side}"])
            hip = Vector(landmarks[f"hip.{side}"])
            knee = Vector(landmarks[f"knee.{side}"])
            ankle = Vector(landmarks[f"ankle.{side}"])
            arm_length = (elbow - shoulder).length + (wrist - elbow).length
            leg_length = (knee - hip).length + (ankle - knee).length
            create_bone(bones, f"CTRL_hand_ik.{side}", wrist, landmarks[f"hand.{side}"], deform=False)
            elbow_pole = control_pole(shoulder, elbow, wrist, arm_length)
            create_bone(bones, f"CTRL_elbow_pole.{side}", elbow_pole, elbow_pole + Vector((0, 0, 0.08)), deform=False)
            create_bone(bones, f"CTRL_foot_ik.{side}", ankle, landmarks[f"foot.{side}"], deform=False)
            knee_pole = control_pole(hip, knee, ankle, leg_length)
            create_bone(bones, f"CTRL_knee_pole.{side}", knee_pole, knee_pole + Vector((0, 0, 0.08)), deform=False)
    for bone in bones:
        if abs(bone.vector.z) < bone.length * 0.95:
            bone.align_roll(Vector((0, -1, 0)))
    bpy.ops.object.mode_set(mode="OBJECT")
    armature.show_in_front = True
    armature.data.display_type = "STICK"
    armature["coordinate_contract"] = "Blender Z-up; front -Y; anatomical .L +X; ground Z=0"
    armature["skeleton_contract"] = contract["name"]
    armature["role"] = "authoring_control_rig" if authoring else "frozen_deform_rig"
    if authoring:
        configure_authoring_constraints(armature)
    return armature


def configure_authoring_constraints(armature):
    for side in ("L", "R"):
        arm_ik = armature.pose.bones[f"forearm.{side}"].constraints.new("IK")
        arm_ik.name = f"IK_arm.{side}"
        arm_ik.target = armature
        arm_ik.subtarget = f"CTRL_hand_ik.{side}"
        arm_ik.pole_target = armature
        arm_ik.pole_subtarget = f"CTRL_elbow_pole.{side}"
        arm_ik.chain_count = 2
        arm_ik.use_stretch = False
        arm_ik.influence = 0
        hand_copy = armature.pose.bones[f"hand.{side}"].constraints.new("COPY_TRANSFORMS")
        hand_copy.name = f"ORIENT_hand.{side}"
        hand_copy.target = armature
        hand_copy.subtarget = f"CTRL_hand_ik.{side}"
        hand_copy.influence = 0
        leg_ik = armature.pose.bones[f"shin.{side}"].constraints.new("IK")
        leg_ik.name = f"IK_leg.{side}"
        leg_ik.target = armature
        leg_ik.subtarget = f"CTRL_foot_ik.{side}"
        leg_ik.pole_target = armature
        leg_ik.pole_subtarget = f"CTRL_knee_pole.{side}"
        leg_ik.chain_count = 2
        leg_ik.use_stretch = False
        leg_ik.influence = 0
        foot_copy = armature.pose.bones[f"foot.{side}"].constraints.new("COPY_TRANSFORMS")
        foot_copy.name = f"ORIENT_foot.{side}"
        foot_copy.target = armature
        foot_copy.subtarget = f"CTRL_foot_ik.{side}"
        foot_copy.influence = 0


def bind_meshes(meshes, armature):
    select_only(meshes + [armature])
    bpy.context.view_layer.objects.active = armature
    bpy.ops.object.parent_set(type="ARMATURE_AUTO")
    for obj in meshes:
        modifiers = [modifier for modifier in obj.modifiers if modifier.type == "ARMATURE"]
        if len(modifiers) != 1 or modifiers[0].object != armature:
            raise RuntimeError(f"{obj.name} did not bind to the shared armature")


def normalize_weights(meshes, contract):
    bone_names = {bone.name for bone in bpy.data.objects["Ashveil_DiagnosticRig"].data.bones if bone.use_deform}
    report = []
    total_weighted = 0
    maximum_influences = 0
    all_finite = True
    normalized = True
    allowed_sets_pass = True
    for obj in meshes:
        group_by_index = {group.index: group for group in obj.vertex_groups if group.name in bone_names}
        allowed = set(contract["allowedBonesByObject"][obj.name])
        disallowed = [group for group in group_by_index.values() if group.name not in allowed]
        for group in disallowed:
            group.remove(range(len(obj.data.vertices)))
        weighted = 0
        object_maximum = 0
        for vertex in obj.data.vertices:
            influences = [
                (group_by_index[element.group], element.weight)
                for element in vertex.groups
                if element.group in group_by_index
                and group_by_index[element.group].name in allowed
                and element.weight > 0
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
            allowed_sets_pass = allowed_sets_pass and all(group.name in allowed for group, _ in kept)
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
    if (
        total_weighted != EXPECTED_VERTEX_COUNT
        or maximum_influences > contract["maximumInfluences"]
        or not normalized
        or not all_finite
        or not allowed_sets_pass
    ):
        raise RuntimeError("Automatic weights failed the normalized four-influence contract")
    return report, total_weighted, maximum_influences, normalized, all_finite, allowed_sets_pass


def harmonize_seam_weights(seam_contracts, meshes_by_name, armature):
    shared_bones = {
        "head-body": "neck",
        "negative-x-hand-body": "forearm.R",
        "positive-x-hand-body": "forearm.L",
    }
    deform_names = {bone.name for bone in armature.data.bones if bone.use_deform}
    records = []
    for contract in seam_contracts:
        bone_name = shared_bones[contract["name"]]
        for object_name, index_key in ((contract["primary"], "primaryVertex"), (contract["secondary"], "secondaryVertex")):
            obj = meshes_by_name[object_name]
            indices = sorted({pair[index_key] for pair in contract["pairs"]})
            for group in obj.vertex_groups:
                if group.name in deform_names:
                    group.remove(indices)
            group = obj.vertex_groups.get(bone_name) or obj.vertex_groups.new(name=bone_name)
            group.add(indices, 1.0, "REPLACE")
        records.append({"name": contract["name"], "sharedBone": bone_name, "pairCount": len(contract["pairs"])})
    return records


def reset_pose(armature):
    for bone in armature.pose.bones:
        bone.rotation_mode = "QUATERNION"
        bone.matrix_basis = Matrix.Identity(4)
        for constraint in bone.constraints:
            constraint.influence = 0
    bpy.context.view_layer.update()


def segment_matrix(rest_bone, head, tail, authored_twist_degrees=0):
    direction = Vector(tail) - Vector(head)
    if direction.length < 1e-5:
        raise RuntimeError(f"Degenerate target for {rest_bone.name}")
    rest_rotation = rest_bone.matrix_local.to_quaternion().normalized()
    rest_axis = rest_rotation @ Vector((0, 1, 0))
    target_axis = direction.normalized()
    transported_rotation = rest_axis.rotation_difference(target_axis) @ rest_rotation
    authored_twist = Quaternion(target_axis, math.radians(authored_twist_degrees))
    matrix = (authored_twist @ transported_rotation).to_matrix().to_4x4()
    matrix.translation = Vector(head)
    return matrix


def set_segment(armature, name, head, tail, authored_twist_degrees=0):
    pose_bone = armature.pose.bones[name]
    pose_bone.matrix = segment_matrix(
        armature.data.bones[name], head, tail, authored_twist_degrees
    )
    bpy.context.view_layer.update()


def bone_pose_points(armature, name):
    bone = armature.pose.bones[name]
    return Vector(bone.head), Vector(bone.tail)


def quaternion_error_degrees(first, second):
    first = first.normalized()
    second = second.normalized()
    if first.dot(second) < 0:
        second = Quaternion((-second.w, -second.x, -second.y, -second.z))
    return math.degrees(first.rotation_difference(second).angle)


def set_control(armature, name, head, tail):
    armature.pose.bones[name].matrix = segment_matrix(armature.data.bones[name], head, tail)
    bpy.context.view_layer.update()


def pole_fraction(start, end, pole, chain_length):
    start = Vector(start)
    axis = (Vector(end) - start).normalized()
    perpendicular = Vector(pole) - start - axis * (Vector(pole) - start).dot(axis)
    return perpendicular.length / chain_length


def solve_authoring_chain(
    armature,
    side,
    chain_type,
    target,
    desired_joint,
    terminal_tail,
    authored_twist_degrees=0,
):
    if chain_type == "arm":
        start_name, joint_name, terminal_name = f"upper_arm.{side}", f"forearm.{side}", f"hand.{side}"
        target_control, pole_control = f"CTRL_hand_ik.{side}", f"CTRL_elbow_pole.{side}"
        constraint_name, orient_name = f"IK_arm.{side}", f"ORIENT_hand.{side}"
    else:
        start_name, joint_name, terminal_name = f"thigh.{side}", f"shin.{side}", f"foot.{side}"
        target_control, pole_control = f"CTRL_foot_ik.{side}", f"CTRL_knee_pole.{side}"
        constraint_name, orient_name = f"IK_leg.{side}", f"ORIENT_foot.{side}"

    start, _ = bone_pose_points(armature, start_name)
    first_length = armature.data.bones[start_name].length
    second_length = armature.data.bones[joint_name].length
    chain_length = first_length + second_length
    pole = control_pole(start, desired_joint, target, chain_length)
    fraction = pole_fraction(start, target, pole, chain_length)
    if fraction < 0.1:
        raise RuntimeError(f"{chain_type}.{side} pole is too close to the chain axis: {fraction}")

    set_control(armature, target_control, target, terminal_tail)
    set_control(armature, pole_control, pole, pole + Vector((0, 0, 0.08)))
    ik = armature.pose.bones[joint_name].constraints[constraint_name]
    orient = armature.pose.bones[terminal_name].constraints[orient_name]
    ik.influence = 1
    orient.influence = 1

    best = None
    for pole_angle in [math.radians(value) for value in range(-180, 181, 5)]:
        ik.pole_angle = pole_angle
        bpy.context.view_layer.update()
        actual_joint, actual_target = bone_pose_points(armature, joint_name)
        score = (actual_joint - Vector(desired_joint)).length + (actual_target - Vector(target)).length * 4
        if best is None or score < best[0]:
            best = (score, pole_angle)
    coarse_angle = best[1]
    for offset in [math.radians(value / 4) for value in range(-20, 21)]:
        ik.pole_angle = coarse_angle + offset
        bpy.context.view_layer.update()
        actual_joint, actual_target = bone_pose_points(armature, joint_name)
        score = (actual_joint - Vector(desired_joint)).length + (actual_target - Vector(target)).length * 4
        if score < best[0]:
            best = (score, coarse_angle + offset)
    ik.pole_angle = best[1]
    bpy.context.view_layer.update()

    actual_joint, actual_target = bone_pose_points(armature, joint_name)
    endpoint_error = (actual_target - Vector(target)).length
    ik.influence = 0
    orient.influence = 0
    bpy.context.view_layer.update()
    set_segment(armature, start_name, start, actual_joint, authored_twist_degrees)
    set_segment(armature, joint_name, actual_joint, actual_target)
    set_segment(armature, terminal_name, actual_target, terminal_tail)
    return {
        "chain": f"{chain_type}.{side}",
        "space": "authoring_armature",
        "poleWorld": vector_record(pole),
        "poleAngleDegrees": math.degrees(best[1]),
        "poleOffsetFraction": fraction,
        "targetWorld": vector_record(target),
        "actualEndpointWorld": vector_record(actual_target),
        "endpointErrorMetres": endpoint_error,
        "jointTargetWorld": vector_record(desired_joint),
        "jointErrorMetres": (actual_joint - Vector(desired_joint)).length,
        "authoredTwistDegrees": authored_twist_degrees,
    }


def bake_authoring_to_deform(authoring, deform, contract):
    records = []
    for definition in contract["bones"]:
        name = definition["name"]
        author_matrix = authoring.pose.bones[name].matrix.copy()
        deform.pose.bones[name].matrix = author_matrix
        bpy.context.view_layer.update()
        author_head, author_tail = bone_pose_points(authoring, name)
        deform_head, deform_tail = bone_pose_points(deform, name)
        orientation_error = quaternion_error_degrees(
            authoring.pose.bones[name].matrix.to_quaternion(),
            deform.pose.bones[name].matrix.to_quaternion(),
        )
        endpoint_error = max((author_head - deform_head).length, (author_tail - deform_tail).length)
        records.append(
            {
                "bone": name,
                "orientationErrorDegrees": orientation_error,
                "endpointErrorMetres": endpoint_error,
            }
        )
    if max(record["orientationErrorDegrees"] for record in records) > 1 or max(
        record["endpointErrorMetres"] for record in records
    ) > 0.001:
        raise RuntimeError("Authoring-to-deform bake exceeded its orientation or endpoint tolerance")
    return records


def calibrate_bind_ik(authoring, landmarks):
    records = []
    reset_pose(authoring)
    for side in ("L", "R"):
        for chain_type, target_name, joint_name, terminal_name in (
            ("arm", "wrist", "elbow", "hand"),
            ("leg", "ankle", "knee", "foot"),
        ):
            record = solve_authoring_chain(
                authoring,
                side,
                chain_type,
                landmarks[f"{target_name}.{side}"],
                landmarks[f"{joint_name}.{side}"],
                landmarks[f"{terminal_name}.{side}"],
            )
            chain_bones = (
                (f"upper_arm.{side}", f"forearm.{side}", f"hand.{side}")
                if chain_type == "arm"
                else (f"thigh.{side}", f"shin.{side}", f"foot.{side}")
            )
            record["maximumBindOrientationErrorDegrees"] = max(
                quaternion_error_degrees(
                    authoring.data.bones[name].matrix_local.to_quaternion(),
                    authoring.pose.bones[name].matrix.to_quaternion(),
                )
                for name in chain_bones
            )
            record["pass"] = (
                record["endpointErrorMetres"] <= 0.001
                and record["jointErrorMetres"] <= 0.001
                and record["maximumBindOrientationErrorDegrees"] <= 1
                and record["poleOffsetFraction"] >= 0.1
            )
            records.append(record)
            reset_pose(authoring)
    if not all(record["pass"] for record in records):
        raise RuntimeError(f"Bind IK calibration failed: {records}")
    return {"chains": records, "pass": True}


def two_bone_joint(start, target, first_length, second_length, pole):
    start = Vector(start)
    target = Vector(target)
    pole = Vector(pole)
    delta = target - start
    distance = min(max(delta.length, abs(first_length - second_length) + 1e-4), first_length + second_length - 1e-4)
    axis = delta.normalized()
    projected_target = start + axis * distance
    pole_direction = pole - start
    perpendicular = pole_direction - axis * pole_direction.dot(axis)
    if perpendicular.length < 1e-5:
        perpendicular = axis.cross(Vector((1, 0, 0)))
    perpendicular.normalize()
    along = (first_length * first_length - second_length * second_length + distance * distance) / (2 * distance)
    height = math.sqrt(max(0.0, first_length * first_length - along * along))
    return start + axis * along + perpendicular * height, projected_target


def point_at_length(start, direction_target, length):
    start = Vector(start)
    direction = Vector(direction_target) - start
    return start + direction.normalized() * length


def rotate_about_z(point, pivot, degrees):
    angle = math.radians(degrees)
    delta = Vector(point) - Vector(pivot)
    return Vector(pivot) + Vector(
        (delta.x * math.cos(angle) - delta.y * math.sin(angle), delta.x * math.sin(angle) + delta.y * math.cos(angle), delta.z)
    )


def apply_pose(authoring, deform, pose_name, landmarks, contract):
    reset_pose(authoring)
    reset_pose(deform)
    channels = {
        "space": "Blender_armature_space_Z_up_forward_negative_Y",
        "targets": [],
        "ikChains": [],
        "terminalOrientationIntent": {},
    }

    if pose_name == "overhead-reach":
        for side, sign in (("L", 1), ("R", -1)):
            clavicle_name = f"clavicle.{side}"
            clavicle_length = authoring.data.bones[clavicle_name].length
            shoulder = point_at_length(
                landmarks["neck.base"],
                Vector(landmarks[f"shoulder.{side}"]) + Vector((0.02 * sign, -0.01, 0.02)),
                clavicle_length,
            )
            set_segment(authoring, clavicle_name, landmarks["neck.base"], shoulder)
            upper_length = (Vector(landmarks[f"elbow.{side}"]) - Vector(landmarks[f"shoulder.{side}"])).length
            fore_length = (Vector(landmarks[f"wrist.{side}"]) - Vector(landmarks[f"elbow.{side}"])).length
            elbow = point_at_length(shoulder, Vector((0.34 * sign, -0.035, 1.61)), upper_length)
            wrist = point_at_length(elbow, Vector((0.27 * sign, -0.03, 1.82)), fore_length)
            hand_length = (Vector(landmarks[f"hand.{side}"]) - Vector(landmarks[f"wrist.{side}"])).length
            hand_target = wrist + Vector((0.015 * sign, 0, hand_length))
            channels["ikChains"].append(
                solve_authoring_chain(authoring, side, "arm", wrist, elbow, hand_target)
            )
            channels["terminalOrientationIntent"][f"hand.{side}"] = "palm_neutral_fingers_up"
            channels["targets"].append({"bone": f"hand.{side}", "targetWorld": vector_record(hand_target)})
    elif pose_name == "cross-body-reach":
        clavicle_length = authoring.data.bones["clavicle.L"].length
        shoulder = point_at_length(
            landmarks["neck.base"], Vector(landmarks["shoulder.L"]) + Vector((0.0, -0.018, 0.006)), clavicle_length
        )
        set_segment(authoring, "clavicle.L", landmarks["neck.base"], shoulder)
        upper_length = (Vector(landmarks["elbow.L"]) - shoulder).length
        fore_length = (Vector(landmarks["wrist.L"]) - Vector(landmarks["elbow.L"])).length
        hand_length = (Vector(landmarks["hand.L"]) - Vector(landmarks["wrist.L"])).length
        elbow = point_at_length(shoulder, Vector((0.37, -0.08, 1.31)), upper_length)
        wrist = point_at_length(elbow, Vector((0.13, -0.20, 1.275)), fore_length)
        target = point_at_length(wrist, Vector((-0.035, -0.255, 1.275)), hand_length)
        channels["ikChains"].append(solve_authoring_chain(authoring, "L", "arm", wrist, elbow, target))
        channels["terminalOrientationIntent"]["hand.L"] = "lead_palm_neutral_along_reach"
        channels["targets"].append({"bone": "hand.L", "targetWorld": vector_record(target), "role": "lead_cross_body"})
    elif pose_name == "deep-elbow-bend":
        clavicle_length = authoring.data.bones["clavicle.L"].length
        shoulder = point_at_length(
            landmarks["neck.base"], Vector(landmarks["shoulder.L"]) + Vector((0.006, -0.012, 0.004)), clavicle_length
        )
        set_segment(authoring, "clavicle.L", landmarks["neck.base"], shoulder)
        upper_length = (Vector(landmarks["elbow.L"]) - shoulder).length
        fore_length = (Vector(landmarks["wrist.L"]) - Vector(landmarks["elbow.L"])).length
        elbow = point_at_length(shoulder, Vector((0.43, -0.035, shoulder.z)), upper_length)
        wrist = point_at_length(elbow, Vector((0.285, -0.07, shoulder.z + 0.17)), fore_length)
        hand_length = (Vector(landmarks["hand.L"]) - Vector(landmarks["wrist.L"])).length
        hand_target = wrist + (Vector(shoulder) - wrist).normalized() * hand_length
        channels["ikChains"].append(solve_authoring_chain(authoring, "L", "arm", wrist, elbow, hand_target))
        channels["terminalOrientationIntent"]["hand.L"] = "palm_neutral_toward_same_shoulder"
        channels["targets"].append({"bone": "forearm.L", "flexionTargetDegrees": 135})
    elif pose_name == "long-stride":
        pelvis_drop = Vector((0, 0, -0.025))
        pelvis = authoring.pose.bones["pelvis"]
        pelvis.matrix = Matrix.Translation(pelvis_drop) @ pelvis.bone.matrix_local
        authoring.pose.bones["CTRL_cog"].matrix = Matrix.Translation(pelvis_drop) @ authoring.pose.bones["CTRL_cog"].bone.matrix_local
        bpy.context.view_layer.update()
        for side, lead in (("L", True), ("R", False)):
            hip, _ = bone_pose_points(authoring, f"thigh.{side}")
            bind_ankle = Vector(landmarks[f"ankle.{side}"])
            ankle_target = bind_ankle + (Vector((0, -0.13, 0.05)) if lead else Vector((0, 0, 0.009)))
            knee, ankle = two_bone_joint(
                hip,
                ankle_target,
                (Vector(landmarks[f"knee.{side}"]) - Vector(landmarks[f"hip.{side}"])).length,
                (Vector(landmarks[f"ankle.{side}"]) - Vector(landmarks[f"knee.{side}"])).length,
                Vector((hip.x, hip.y - (0.25 if lead else 0.10), (hip.z + ankle_target.z) / 2)),
            )
            foot_delta = Vector(landmarks[f"foot.{side}"]) - bind_ankle
            foot_tail = ankle + foot_delta
            channels["ikChains"].append(
                solve_authoring_chain(authoring, side, "leg", ankle, knee, foot_tail)
            )
            channels["terminalOrientationIntent"][f"foot.{side}"] = "sole_parallel_to_bind_ground"
            channels["targets"].append({"bone": f"foot.{side}", "targetWorld": vector_record(ankle_target), "role": "lead" if lead else "trail"})
    elif pose_name == "head-turn":
        neck_bone = authoring.pose.bones["neck"]
        head_bone = authoring.pose.bones["head"]
        neck_bone.matrix = Matrix.Translation(neck_bone.bone.head_local) @ Matrix.Rotation(math.radians(20), 4, "Z") @ Matrix.Translation(-neck_bone.bone.head_local) @ neck_bone.bone.matrix_local
        bpy.context.view_layer.update()
        head_bone.matrix = Matrix.Translation(head_bone.bone.head_local) @ Matrix.Rotation(math.radians(45), 4, "Z") @ Matrix.Translation(-head_bone.bone.head_local) @ head_bone.bone.matrix_local
        bpy.context.view_layer.update()
        channels["targets"].append({"bone": "head", "worldYawDegrees": 45})
    channels["authoringToDeform"] = bake_authoring_to_deform(authoring, deform, contract)
    return channels


def key_pose(armature, frame):
    for bone in armature.pose.bones:
        bone.keyframe_insert(data_path="location", frame=frame, group=bone.name)
        bone.keyframe_insert(data_path="rotation_quaternion", frame=frame, group=bone.name)
        bone.keyframe_insert(data_path="scale", frame=frame, group=bone.name)


def action_curves(action):
    curves = []
    if hasattr(action, "fcurves"):
        curves.extend(action.fcurves)
    else:
        for layer in action.layers:
            for strip in layer.strips:
                for channel_bag in strip.channelbags:
                    curves.extend(channel_bag.fcurves)
    return curves


def create_action(authoring, deform, landmarks, contract):
    bpy.context.scene.render.fps = 30
    bpy.context.scene.frame_start = 0
    bpy.context.scene.frame_end = 50
    deform.animation_data_create()
    action = bpy.data.actions.new("Ashveil_RigStress")
    deform.animation_data.action = action
    authoring.animation_data_create()
    author_action = bpy.data.actions.new("Ashveil_AuthoringStress")
    authoring.animation_data.action = author_action
    pose_channels = {}
    for pose_name, frame in POSES:
        pose_channels[pose_name] = apply_pose(authoring, deform, pose_name, landmarks, contract)
        key_pose(authoring, frame)
        key_pose(deform, frame)
        marker = action.pose_markers.new(pose_name)
        marker.frame = frame
        author_marker = author_action.pose_markers.new(pose_name)
        author_marker.frame = frame
    reset_pose(authoring)
    reset_pose(deform)
    bpy.context.scene.frame_set(0)
    curves = action_curves(action)
    author_curves = action_curves(author_action)
    for curve in curves + author_curves:
        for point in curve.keyframe_points:
            point.interpolation = "CONSTANT"
    keyframe_count = sum(len(curve.keyframe_points) for curve in curves)
    if not curves or any(
        point.interpolation != "CONSTANT" for curve in curves for point in curve.keyframe_points
    ):
        raise RuntimeError("Rig stress action did not retain constant interpolation")
    action["frames_per_second"] = 30
    action["diagnostic_only"] = True
    author_action["diagnostic_authoring_only"] = True
    return action, author_action, pose_channels, len(curves), keyframe_count


def bone_endpoint(armature, bone_name, endpoint):
    bone = armature.data.bones[bone_name]
    point = bone.head_local if endpoint == "head" else bone.tail_local
    return armature.matrix_world @ point


def rest_contract(armature, contract):
    records = []
    for definition in contract["bones"]:
        bone = armature.data.bones[definition["name"]]
        records.append(
            {
                "name": bone.name,
                "parent": bone.parent.name if bone.parent else None,
                "deform": bone.use_deform,
                "head": vector_record(bone.head_local),
                "tail": vector_record(bone.tail_local),
                "roll": round(bone.matrix_local.to_euler().y, 6),
                "matrixLocal": [round(value, 6) for row in bone.matrix_local for value in row],
            }
        )
    encoded = json.dumps(records, sort_keys=True, separators=(",", ":")).encode("utf-8")
    return records, hashlib.sha256(encoded).hexdigest()


def pose_matrix_snapshot(authoring, deform, contract):
    snapshot = {}
    for pose_name, frame in POSES:
        bpy.context.scene.frame_set(frame)
        bpy.context.view_layer.update()
        snapshot[pose_name] = {
            role: {
                definition["name"]: [value for row in rig.pose.bones[definition["name"]].matrix for value in row]
                for definition in contract["bones"]
            }
            for role, rig in (("authoring", authoring), ("deform", deform))
        }
    return snapshot


def verify_reopened_bake(snapshot, contract):
    authoring = bpy.data.objects.get("Ashveil_AuthoringRig")
    deform = bpy.data.objects.get("Ashveil_DiagnosticRig")
    if authoring is None or deform is None:
        raise RuntimeError("Saved blend lost its authoring or deform rig")
    maximum_saved_matrix_delta = 0.0
    maximum_cross_rig_orientation = 0.0
    maximum_cross_rig_endpoint = 0.0
    for pose_name, frame in POSES:
        bpy.context.scene.frame_set(frame)
        bpy.context.view_layer.update()
        for definition in contract["bones"]:
            name = definition["name"]
            author_matrix = authoring.pose.bones[name].matrix
            deform_matrix = deform.pose.bones[name].matrix
            for role, matrix in (("authoring", author_matrix), ("deform", deform_matrix)):
                maximum_saved_matrix_delta = max(
                    maximum_saved_matrix_delta,
                    max(
                        abs(value - snapshot[pose_name][role][name][index])
                        for index, value in enumerate(value for row in matrix for value in row)
                    ),
                )
            maximum_cross_rig_orientation = max(
                maximum_cross_rig_orientation,
                quaternion_error_degrees(author_matrix.to_quaternion(), deform_matrix.to_quaternion()),
            )
            author_head, author_tail = bone_pose_points(authoring, name)
            deform_head, deform_tail = bone_pose_points(deform, name)
            maximum_cross_rig_endpoint = max(
                maximum_cross_rig_endpoint,
                (author_head - deform_head).length,
                (author_tail - deform_tail).length,
            )
    deform_constraints = sum(len(bone.constraints) for bone in deform.pose.bones)
    report = {
        "reopenedSavedBlend": True,
        "explicitSpaces": ["armature", "world", "parent_relative_action_channels"],
        "maximumSavedMatrixDelta": maximum_saved_matrix_delta,
        "maximumAuthoringToDeformOrientationDegrees": maximum_cross_rig_orientation,
        "maximumAuthoringToDeformEndpointMetres": maximum_cross_rig_endpoint,
        "deformConstraintCount": deform_constraints,
        "pass": maximum_saved_matrix_delta <= 1e-6
        and maximum_cross_rig_orientation <= 1
        and maximum_cross_rig_endpoint <= 0.001
        and deform_constraints == 0,
    }
    if not report["pass"]:
        raise RuntimeError(f"Reopened authoring/deform bake verification failed: {report}")
    return authoring, deform, report


def joint_fit_report(armature, fitted):
    endpoints = {
        **{f"shoulder.{side}": (f"upper_arm.{side}", "head") for side in ("L", "R")},
        **{f"elbow.{side}": (f"forearm.{side}", "head") for side in ("L", "R")},
        **{f"wrist.{side}": (f"hand.{side}", "head") for side in ("L", "R")},
        **{f"hip.{side}": (f"thigh.{side}", "head") for side in ("L", "R")},
        **{f"knee.{side}": (f"shin.{side}", "head") for side in ("L", "R")},
        **{f"ankle.{side}": (f"foot.{side}", "head") for side in ("L", "R")},
        "pelvis": ("pelvis", "head"),
        "chest": ("chest", "head"),
        "neck": ("head", "head"),
        "head": ("head", "tail"),
    }
    threshold = fitted["jointToleranceMetres"]
    joints = []
    for name in JOINT_NAMES:
        target = Vector(fitted["landmarks"][name])
        actual = bone_endpoint(armature, *endpoints[name])
        error = actual - target
        measurement = fitted["measurements"][name]
        joints.append(
            {
                "name": name,
                "targetWorld": vector_record(target),
                "actualWorld": vector_record(actual),
                "errorVectorMetres": vector_record(error),
                "errorMetres": error.length,
                "thresholdMetres": threshold,
                "derivation": measurement["method"],
                "sourceObjects": measurement["sourceObjects"],
                "sourceVertexPairs": measurement.get("sourceVertexPairs", []),
                "sampleCount": measurement["sampleCount"],
                "confidence": measurement.get("confidence", min(1.0, measurement["sampleCount"] / 24)),
                "pass": error.length <= threshold,
            }
        )
    maximum = max(joint["errorMetres"] for joint in joints)
    report = {
        "contract": "humanoid.v1",
        "targetsFrozenBeforeArmature": True,
        "toleranceMetres": threshold,
        "symmetryToleranceMetres": fitted["symmetryToleranceMetres"],
        "rawSymmetryErrorMetres": fitted["rawSymmetryErrorMetres"],
        "canonicalization": fitted["canonicalization"],
        "maximumErrorMetres": maximum,
        "joints": joints,
        "pass": all(joint["pass"] for joint in joints),
    }
    if not report["pass"]:
        raise RuntimeError(f"Fitted joints exceed humanoid.v1 tolerance: {maximum}")
    return report


def pose_bone_points(armature, name):
    pose_bone = armature.pose.bones[name]
    return armature.matrix_world @ pose_bone.head, armature.matrix_world @ pose_bone.tail


CONNECTED_CHAINS = [
    ("clavicle.L", "upper_arm.L"),
    ("upper_arm.L", "forearm.L"),
    ("forearm.L", "hand.L"),
    ("clavicle.R", "upper_arm.R"),
    ("upper_arm.R", "forearm.R"),
    ("forearm.R", "hand.R"),
    ("thigh.L", "shin.L"),
    ("shin.L", "foot.L"),
    ("thigh.R", "shin.R"),
    ("shin.R", "foot.R"),
]
ORIENTATION_BONES_BY_POSE = {
    "bind": [],
    "overhead-reach": ["upper_arm.L", "forearm.L", "hand.L", "upper_arm.R", "forearm.R", "hand.R"],
    "cross-body-reach": ["upper_arm.L", "forearm.L", "hand.L"],
    "deep-elbow-bend": ["upper_arm.L", "forearm.L", "hand.L"],
    "long-stride": ["thigh.L", "shin.L", "foot.L", "thigh.R", "shin.R", "foot.R"],
    "head-turn": [],
}


def signed_axial_twist_degrees(bind, pose):
    bind = bind.normalized()
    pose = pose.normalized()
    if bind.dot(pose) < 0:
        pose = Quaternion((-pose.w, -pose.x, -pose.y, -pose.z))
    primary = Vector((0, 1, 0))
    swing = (bind @ primary).rotation_difference(pose @ primary)
    residual = (swing @ bind).inverted() @ pose
    magnitude = math.hypot(residual.w, residual.y)
    if magnitude < 1e-8:
        return 0.0
    angle = math.degrees(2 * math.atan2(residual.y / magnitude, residual.w / magnitude))
    return (angle + 180) % 360 - 180


def orientation_evidence_report(authoring, deform, pose_channels):
    bpy.context.scene.frame_set(0)
    bpy.context.view_layer.update()
    bind = {
        name: deform.pose.bones[name].matrix.to_quaternion().normalized()
        for names in ORIENTATION_BONES_BY_POSE.values()
        for name in names
    }
    poses = []
    passed = True
    for pose_name, frame in POSES:
        bpy.context.scene.frame_set(frame)
        bpy.context.view_layer.update()
        axial = {
            name: signed_axial_twist_degrees(bind[name], deform.pose.bones[name].matrix.to_quaternion())
            for name in ORIENTATION_BONES_BY_POSE[pose_name]
        }
        chain_gaps = {
            f"{parent}->{child}": (pose_bone_points(deform, parent)[1] - pose_bone_points(deform, child)[0]).length
            for parent, child in CONNECTED_CHAINS
        }
        authoring_errors = {}
        for name in [bone.name for bone in deform.data.bones]:
            author_head, author_tail = pose_bone_points(authoring, name)
            deform_head, deform_tail = pose_bone_points(deform, name)
            authoring_errors[name] = {
                "orientationDegrees": quaternion_error_degrees(
                    authoring.pose.bones[name].matrix.to_quaternion(),
                    deform.pose.bones[name].matrix.to_quaternion(),
                ),
                "endpointMetres": max(
                    (author_head - deform_head).length, (author_tail - deform_tail).length
                ),
            }
        bend_planes = {}
        for side in ("L", "R"):
            for label, upper, lower in (
                ("arm", f"upper_arm.{side}", f"forearm.{side}"),
                ("leg", f"thigh.{side}", f"shin.{side}"),
            ):
                upper_head, upper_tail = pose_bone_points(deform, upper)
                lower_head, lower_tail = pose_bone_points(deform, lower)
                normal = (upper_tail - upper_head).cross(lower_tail - lower_head)
                if normal.length > 1e-8:
                    normal.normalize()
                mirrored = Vector((normal.x if side == "L" else -normal.x, normal.y, normal.z))
                bend_planes[f"{label}.{side}"] = {
                    "worldNormal": vector_record(normal),
                    "mirrorNormalizedNormal": vector_record(mirrored),
                }
        pose_pass = (
            all(abs(value) <= 60 for value in axial.values())
            and all(value <= 0.001 for value in chain_gaps.values())
            and all(
                value["orientationDegrees"] <= 1 and value["endpointMetres"] <= 0.001
                for value in authoring_errors.values()
            )
            and all(
                chain["poleOffsetFraction"] >= 0.1
                for chain in pose_channels[pose_name]["ikChains"]
            )
        )
        if pose_name == "overhead-reach":
            pose_pass = pose_pass and all(
                abs(axial[f"{segment}.L"] + axial[f"{segment}.R"]) <= 15
                for segment in ("upper_arm", "forearm")
            )
        passed = passed and pose_pass
        poses.append(
            {
                "name": pose_name,
                "frame": frame,
                "axialTwistDegrees": axial,
                "chainGapsMetres": chain_gaps,
                "bendPlanes": bend_planes,
                "authoringToDeform": authoring_errors,
                "ikChains": pose_channels[pose_name]["ikChains"],
                "terminalOrientationIntent": pose_channels[pose_name]["terminalOrientationIntent"],
                "pass": pose_pass,
            }
        )
    report = {
        "measurementSpace": "evaluated_armature_space_after_constant_action_sampling",
        "maximumUncommandedAxialTwistDegrees": 60,
        "maximumOverheadBilateralAbsoluteDifferenceDegrees": 15,
        "maximumConnectedChainGapMetres": 0.001,
        "minimumPoleOffsetFraction": 0.1,
        "poses": poses,
        "pass": passed,
    }
    if not passed:
        raise RuntimeError("Evaluated orientation, pole, chain, or authoring bake evidence failed")
    return report


def angle_degrees(first, second):
    return math.degrees(Vector(first).angle(Vector(second)))


def evaluated_vertex(obj, index):
    return object_points(obj, evaluated=True)[index]


def sole_patch_indices(body, side, minimum_z, height):
    points = object_points(body)
    candidates = [
        (index, point)
        for index, point in enumerate(points)
        if point.x * side > 0 and point.z <= minimum_z + height * 0.018 and point.y < 0.08
    ]
    if len(candidates) < 4:
        raise RuntimeError("Could not derive a representative sole patch")
    return [index for index, _ in sorted(candidates, key=lambda item: item[1].z)[:24]]


def pose_intent_report(armature, meshes_by_name, landmarks, pose_channels):
    body = meshes_by_name["Body"]
    all_minimum, all_maximum = bounds(list(meshes_by_name.values()))
    height = all_maximum.z - all_minimum.z
    sole_indices = {
        "L": sole_patch_indices(body, 1, all_minimum.z, height),
        "R": sole_patch_indices(body, -1, all_minimum.z, height),
    }
    bpy.context.scene.frame_set(0)
    bpy.context.view_layer.update()
    bind = {
        name: pose_bone_points(armature, name)
        for name in ("pelvis", "hand.L", "foot.L", "foot.R", "thigh.L", "shin.L", "thigh.R", "shin.R", "head")
    }
    bind_soles = {
        side: [evaluated_vertex(body, index) for index in indices] for side, indices in sole_indices.items()
    }
    bind_face_points = object_points(meshes_by_name["Facial_Feature_01"], evaluated=True)
    bind_head_points = object_points(meshes_by_name["Head"], evaluated=True)
    bind_face_center = sum(bind_face_points, Vector()) / len(bind_face_points)
    bind_head_center = sum(bind_head_points, Vector()) / len(bind_head_points)
    bind_gaze = (bind_face_center - bind_head_center).normalized()
    bind_gaze_yaw = math.degrees(math.atan2(bind_gaze.x, -bind_gaze.y))
    results = []

    bpy.context.scene.frame_set(10)
    bpy.context.view_layer.update()
    left_hand = pose_bone_points(armature, "hand.L")[1]
    right_hand = pose_bone_points(armature, "hand.R")[1]
    overhead_pass = left_hand.z > landmarks["head"][2] and right_hand.z > landmarks["head"][2] and abs(left_hand.z - right_hand.z) < 0.04
    results.append({"name": "overhead-reach", "leftHandWorld": vector_record(left_hand), "rightHandWorld": vector_record(right_hand), "symmetryHeightErrorMetres": abs(left_hand.z - right_hand.z), "pass": overhead_pass})

    bpy.context.scene.frame_set(20)
    bpy.context.view_layer.update()
    attack_hand = pose_bone_points(armature, "hand.L")[1]
    attack_target = next(
        Vector(target["targetWorld"])
        for target in pose_channels["cross-body-reach"]["targets"]
        if target["bone"] == "hand.L"
    )
    attack_error = (attack_hand - attack_target).length
    attack = {
        "name": "cross-body-reach",
        "leadHand": "hand.L",
        "targetWorld": vector_record(attack_target),
        "actualWorld": vector_record(attack_hand),
        "targetErrorMetres": attack_error,
        "verticalTargetErrorMetres": abs(attack_hand.z - attack_target.z),
        "crossedMidline": attack_hand.x < 0,
    }
    attack["pass"] = attack["crossedMidline"] and attack_error <= 0.04 and attack["verticalTargetErrorMetres"] <= 0.04
    results.append(attack)

    bpy.context.scene.frame_set(30)
    bpy.context.view_layer.update()
    upper_head, upper_tail = pose_bone_points(armature, "upper_arm.L")
    fore_head, fore_tail = pose_bone_points(armature, "forearm.L")
    elbow_flex = angle_degrees(upper_tail - upper_head, fore_tail - fore_head)
    results.append({"name": "deep-elbow-bend", "actualFlexionDegrees": elbow_flex, "targetFlexionDegrees": 135, "errorDegrees": abs(elbow_flex - 135), "pass": 105 <= elbow_flex <= 150})

    bpy.context.scene.frame_set(40)
    bpy.context.view_layer.update()
    pelvis = pose_bone_points(armature, "pelvis")[0]
    pelvis_delta = pelvis - bind["pelvis"][0]
    stride_legs = {}
    for side in ("L", "R"):
        hip, knee = pose_bone_points(armature, f"thigh.{side}")
        _, ankle = pose_bone_points(armature, f"shin.{side}")
        sign = 1 if side == "L" else -1
        thigh = knee - hip
        shin = ankle - knee
        sagittal_bend = thigh.y * shin.z - thigh.z * shin.y
        stride_legs[side] = {
            "hipWorld": vector_record(hip),
            "kneeWorld": vector_record(knee),
            "ankleWorld": vector_record(ankle),
            "kneeLateralDriftMetres": knee.x - landmarks[f"knee.{side}"][0],
            "sameSideMarginMetres": knee.x * sign,
            "signedSagittalBend": sagittal_bend,
            "flexionDegrees": angle_degrees(thigh, shin),
        }
    lead_foot = pose_bone_points(armature, "foot.L")[0]
    trail_foot = pose_bone_points(armature, "foot.R")[0]
    lead_delta = lead_foot - bind["foot.L"][0]
    trail_delta = trail_foot - bind["foot.R"][0]
    posed_soles = {
        side: [evaluated_vertex(body, index) for index in indices] for side, indices in sole_indices.items()
    }
    lead_lift = min(point.z for point in posed_soles["L"]) - min(point.z for point in bind_soles["L"])
    trail_minimum = min(point.z for point in posed_soles["R"])
    trail_bind_minimum = min(point.z for point in bind_soles["R"])
    trail_ground_error = abs(trail_minimum - trail_bind_minimum)
    stride = {
        "name": "long-stride",
        "leadLeg": "leg.L",
        "trailLeg": "leg.R",
        "pelvisBindWorld": vector_record(bind["pelvis"][0]),
        "pelvisWorld": vector_record(pelvis),
        "pelvisWorldDelta": vector_record(pelvis_delta),
        "leadFootBindWorld": vector_record(bind["foot.L"][0]),
        "leadFootWorld": vector_record(lead_foot),
        "leadFootWorldDelta": vector_record(lead_delta),
        "trailFootBindWorld": vector_record(bind["foot.R"][0]),
        "trailFootWorld": vector_record(trail_foot),
        "trailFootWorldDelta": vector_record(trail_delta),
        "trailFootDisplacementMetres": trail_delta.length,
        "leadSolePatchLiftMetres": lead_lift,
        "trailSolePatchMinimumZ": trail_minimum,
        "trailSolePatchPenetrationMetres": max(0, -trail_minimum),
        "trailFootGroundErrorMetres": trail_ground_error,
        "knees": stride_legs,
        "kneesStayOnAnatomicalSide": all(item["sameSideMarginMetres"] > 0.035 for item in stride_legs.values()),
    }
    stride["pass"] = (
        -0.04 <= stride["pelvisWorldDelta"][2] <= -0.02
        and abs(stride["pelvisWorldDelta"][1]) <= 0.02
        and stride["leadFootWorldDelta"][1] <= -0.12
        and stride["leadFootWorldDelta"][2] >= 0.04
        and stride["trailFootDisplacementMetres"] <= 0.035
        and stride["leadSolePatchLiftMetres"] >= 0.025
        and stride["trailFootGroundErrorMetres"] <= 0.015
        and stride["trailSolePatchPenetrationMetres"] <= 0.01
        and stride["kneesStayOnAnatomicalSide"]
        and all(abs(item["kneeLateralDriftMetres"]) <= 0.05 and 5 <= item["flexionDegrees"] <= 145 and item["signedSagittalBend"] > 0 for item in stride_legs.values())
    )
    results.append(stride)

    bpy.context.scene.frame_set(50)
    bpy.context.view_layer.update()
    head_bone = armature.pose.bones["head"]
    rest_basis = armature.data.bones["head"].matrix_local.to_3x3()
    actual_basis = head_bone.matrix.to_3x3()
    actual_yaw = math.degrees((actual_basis @ rest_basis.inverted()).to_euler("XYZ").z)
    face_points = object_points(meshes_by_name["Facial_Feature_01"], evaluated=True)
    face_center = sum(face_points, Vector()) / len(face_points)
    head_center = sum(object_points(meshes_by_name["Head"], evaluated=True), Vector()) / len(object_points(meshes_by_name["Head"], evaluated=True))
    gaze = (face_center - head_center).normalized()
    gaze_yaw = math.degrees(math.atan2(gaze.x, -gaze.y)) - bind_gaze_yaw
    gaze_yaw = (gaze_yaw + 180) % 360 - 180
    head_turn = {"name": "head-turn", "intendedWorldYawDegrees": 45, "actualWorldYawDegrees": actual_yaw, "faceGazeWorldYawDegrees": gaze_yaw, "pass": abs(actual_yaw - 45) <= 1 and abs(gaze_yaw - actual_yaw) <= 12}
    results.append(head_turn)
    report = {"contract": "humanoid.v1", "measurementSpace": "evaluated_armature_and_skinned_geometry", "forward": [0, -1, 0], "leadHand": "hand.L", "leadLeg": "leg.L", "trailLeg": "leg.R", "poses": results, "pass": all(result["pass"] for result in results)}
    if not report["pass"]:
        print("POSE_INTENT_DIAGNOSTIC " + json.dumps(results))
        raise RuntimeError("A world-space pose intent failed humanoid.v1 validation")
    return report


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


def diagnostic_material(name, color):
    material = bpy.data.materials.new(name)
    material.diffuse_color = (*color, 1)
    material.roughness = 0.65
    return material


def cylinder_between(name, start, end, radius, material):
    start = Vector(start)
    end = Vector(end)
    direction = end - start
    bpy.ops.mesh.primitive_cylinder_add(vertices=10, radius=radius, depth=direction.length, location=(start + end) / 2)
    obj = bpy.context.object
    obj.name = name
    obj.rotation_mode = "QUATERNION"
    obj.rotation_quaternion = Vector((0, 0, 1)).rotation_difference(direction.normalized())
    obj.data.materials.append(material)
    obj["diagnostic_render_only"] = True
    return obj


def sphere_at(name, point, radius, material):
    bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=2, radius=radius, location=point)
    obj = bpy.context.object
    obj.name = name
    obj.data.materials.append(material)
    obj["diagnostic_render_only"] = True
    return obj


def create_skeleton_overlay(armature, fitted, view, minimum, maximum):
    bone_material = diagnostic_material(f"Skeleton_{view}", (0.04, 0.75, 1.0))
    target_material = diagnostic_material(f"Targets_{view}", (1.0, 0.18, 0.08))
    if view == "front":
        offset = Vector((0, minimum.y - 0.045, 0))
        project = lambda point: Vector((point.x, offset.y, point.z))
    else:
        offset = Vector((maximum.x + 0.045, 0, 0))
        project = lambda point: Vector((offset.x, point.y, point.z))
    objects = []
    for bone in armature.data.bones:
        objects.append(cylinder_between(f"OVERLAY_{view}_{bone.name}", project(bone.head_local), project(bone.tail_local), 0.008, bone_material))
    for name in JOINT_NAMES:
        objects.append(sphere_at(f"TARGET_{view}_{name}", project(Vector(fitted["landmarks"][name])), 0.015, target_material))
    for obj in objects:
        obj.hide_render = True
    return objects


def render_skeleton_overlay(output, camera, meshes, wire_overlays, overlay_by_view):
    scene = bpy.context.scene
    scene.frame_set(0)
    bpy.context.view_layer.update()
    minimum, maximum = bounds(meshes, evaluated=True)
    target = (minimum + maximum) / 2
    dimensions = maximum - minimum
    camera.data.ortho_scale = max(dimensions.z * 1.14, dimensions.x * 1.2, dimensions.y * 1.2)
    distance = max(dimensions) * 3
    positions = {
        "front": Vector((target.x, minimum.y - distance, target.z)),
        "right": Vector((maximum.x + distance, target.y, target.z)),
    }
    paths = []
    for view, overlay in overlay_by_view.items():
        for obj in overlay_by_view["front"] + overlay_by_view["right"]:
            obj.hide_render = obj not in overlay
        for obj in meshes + wire_overlays:
            obj.hide_render = False
        camera.location = positions[view]
        point_camera(camera, target)
        path = output / f"validation-bind-skeleton-{view}.png"
        scene.render.filepath = str(path)
        bpy.ops.render.render(write_still=True)
        paths.append(path)
    for overlay in overlay_by_view.values():
        for obj in overlay:
            obj.hide_render = True
    return paths


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

    if any(
        max(abs(obj.matrix_world[row][column] - Matrix.Identity(4)[row][column]) for row in range(4) for column in range(4)) > 1e-6
        for obj in meshes
    ):
        raise RuntimeError("Prepared semantic meshes must have applied identity transforms")

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
            "pairs": seam_pairs(meshes_by_name["Body"], meshes_by_name["Hand_NegativeX"], 13, 0.03),
        },
        {
            "name": "positive-x-hand-body",
            "primary": "Body",
            "secondary": "Hand_PositiveX",
            "pairs": seam_pairs(meshes_by_name["Body"], meshes_by_name["Hand_PositiveX"], 13, 0.03),
        },
    ]
    contract = load_contract()
    fitted = fit_landmarks(meshes_by_name, seam_contracts)

    add_materials(meshes)
    armature = create_armature(fitted["landmarks"], contract)
    authoring = create_armature(
        fitted["landmarks"], contract, name="Ashveil_AuthoringRig", authoring=True
    )
    joint_fit = joint_fit_report(armature, fitted)
    rest_records, rest_signature = rest_contract(armature, contract)
    accepted_rest_signature = contract.get("acceptedMaleRestSignatureSha256")
    if accepted_rest_signature and rest_signature != accepted_rest_signature:
        raise RuntimeError(
            f"humanoid.v1 accepted male rest signature changed: {rest_signature}"
        )
    bind_reference_points = {
        name: [point.copy() for point in object_points(obj)] for name, obj in meshes_by_name.items()
    }
    bind_ik_calibration = calibrate_bind_ik(authoring, fitted["landmarks"])
    bind_meshes(meshes, armature)
    weight_objects, weighted_vertices, maximum_influences, normalized, finite_weights, allowed_sets_pass = normalize_weights(
        meshes, contract
    )
    seam_weight_records = harmonize_seam_weights(seam_contracts, meshes_by_name, armature)
    action, author_action, pose_channels, curve_count, keyframe_count = create_action(
        authoring, armature, fitted["landmarks"], contract
    )
    pose_intent = pose_intent_report(
        armature, meshes_by_name, fitted["landmarks"], pose_channels
    )
    orientation_evidence = orientation_evidence_report(authoring, armature, pose_channels)
    bpy.context.scene.frame_set(0)
    bpy.context.view_layer.update()
    hip_midpoint = (
        pose_bone_points(armature, "thigh.L")[0] + pose_bone_points(armature, "thigh.R")[0]
    ) / 2
    pelvis_head = pose_bone_points(armature, "pelvis")[0]
    cog_head = pose_bone_points(authoring, "CTRL_cog")[0]
    pelvis_cog = {
        "hipMidpointWorld": vector_record(hip_midpoint),
        "deformPelvisWorld": vector_record(pelvis_head),
        "authoringCogWorld": vector_record(cog_head),
        "pelvisToHipMidpointMetres": (pelvis_head - hip_midpoint).length,
        "cogToHipMidpointMetres": (cog_head - hip_midpoint).length,
    }
    pelvis_cog["pass"] = (
        pelvis_cog["pelvisToHipMidpointMetres"] <= 0.02
        and pelvis_cog["cogToHipMidpointMetres"] <= 0.02
    )
    if not pelvis_cog["pass"]:
        raise RuntimeError(f"Pelvis or COG is not at the fitted bilateral hip midpoint: {pelvis_cog}")
    bind_geometry_maximum_deviation = max(
        (evaluated - bind_reference_points[name][index]).length
        for name, obj in meshes_by_name.items()
        for index, evaluated in enumerate(object_points(obj, evaluated=True))
    )
    if bind_geometry_maximum_deviation > 0.0001:
        raise RuntimeError(
            f"Frame-zero bind geometry moved by {bind_geometry_maximum_deviation} metres"
        )
    wire_overlays = create_wire_overlays(meshes)

    camera = setup_render(meshes, wire_overlays, armature)
    bind_minimum, bind_maximum = bounds(meshes)
    overlay_by_view = {
        view: create_skeleton_overlay(armature, fitted, view, bind_minimum, bind_maximum)
        for view in ("front", "right")
    }
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
    overlay_paths = render_skeleton_overlay(output, camera, meshes, wire_overlays, overlay_by_view)
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
    authoring_name = authoring.name
    action_name = action.name
    author_action_name = author_action.name
    authoring_controls = sorted(
        bone.name for bone in authoring.data.bones if bone.name.startswith("CTRL_")
    )
    pose_snapshot = pose_matrix_snapshot(authoring, armature, contract)
    bpy.ops.wm.save_as_mainfile(filepath=str(blend_output_path))
    bpy.ops.wm.open_mainfile(filepath=str(blend_output_path))
    authoring, armature, reopen_verification = verify_reopened_bake(pose_snapshot, contract)
    meshes_by_name = {name: bpy.data.objects[name] for name in SEMANTIC_MESHES}
    meshes = [meshes_by_name[name] for name in SEMANTIC_MESHES]
    reopened_author_action = bpy.data.actions.get(author_action_name)
    authoring.animation_data.action = None
    if reopened_author_action:
        bpy.data.actions.remove(reopened_author_action)
    bpy.context.scene.frame_set(0)
    export_glb(glb_path, meshes, armature)
    glb_structure = parse_glb(glb_path)
    expected_joint_names = sorted(definition["gltfName"] for definition in contract["bones"])
    gltf_name_by_source = {definition["name"]: definition["gltfName"] for definition in contract["bones"]}
    expected_parent_graph = {
        definition["gltfName"]: (
            gltf_name_by_source[definition["parent"]] if definition["parent"] else None
        )
        for definition in contract["bones"]
    }
    if (
        glb_structure["meshes"] != 7
        or glb_structure["primitives"] != 7
        or glb_structure["skins"] != 1
        or glb_structure["joints"] != 20
        or glb_structure["animations"] != 1
        or glb_structure["animationNames"] != ["Ashveil_RigStress"]
        or sorted(glb_structure["jointNames"]) != expected_joint_names
        or glb_structure["jointParentGraph"] != expected_parent_graph
        or glb_structure["inverseBindMatrices"]["count"] != 20
        or glb_structure["inverseBindMatrices"]["type"] != "MAT4"
        or glb_structure["inverseBindMatrices"]["sha256"]
        != contract["acceptedMaleInverseBindMatricesSha256"]
        or glb_structure["rigifyControlLeakage"]
        or glb_structure["authoringRigLeakage"]
        or glb_structure["skinnedMeshNames"] != sorted(SEMANTIC_MESHES)
        or (
            contract.get("acceptedMaleRuntimeRestSignatureSha256")
            and glb_structure["runtimeRestSignatureSha256"]
            != contract["acceptedMaleRuntimeRestSignatureSha256"]
        )
    ):
        raise RuntimeError(f"Rigged GLB structure failed: {glb_structure}")
    input_hashes_after = {path.name: sha256(path) for path in (report_path, blend_path, bald_path)}
    if input_hashes_after != input_hashes_before:
        raise RuntimeError("A prepared input changed during rig generation")
    artifacts = [blend_output_path, glb_path, *render_paths, *overlay_paths]
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
            "contract": contract["name"],
            "name": armature.name,
            "bones": len(armature.data.bones),
            "deformBones": sum(1 for bone in armature.data.bones if bone.use_deform),
            "rootBone": "root",
            "rootDeforms": armature.data.bones["root"].use_deform,
            "boneNames": [bone.name for bone in armature.data.bones],
            "manifest": "scripts/art/contracts/humanoid.v1.json",
            "restRecords": rest_records,
            "acceptedMaleRestSignatureSha256": rest_signature,
            "authoringRig": {
                "name": authoring_name,
                "action": author_action_name,
                "controls": authoring_controls,
                "handoff": "Blender_native_IK_FK_authoring_to_frozen_deform_matrices",
                "meshBoundToAuthoringRig": False,
                "bindIkCalibration": bind_ik_calibration,
            },
            "rigify": "not_used_lightweight_Blender_native_control_rig_retained_in_editable_blend",
        },
        "jointFit": joint_fit,
        "pelvisCogFit": pelvis_cog,
        "weights": {
            "vertices": EXPECTED_VERTEX_COUNT,
            "weightedVertices": weighted_vertices,
            "maximumInfluences": maximum_influences,
            "normalized": normalized,
            "finite": finite_weights,
            "sharedArmatureModifier": True,
            "semanticAllowedBoneSets": allowed_sets_pass,
            "objects": weight_objects,
            "seamHarmonization": seam_weight_records,
        },
        "animation": {
            "name": action_name,
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
        "orientationEvidence": orientation_evidence,
        "bakeVerification": reopen_verification,
        "bindGeometryMaximumDeviationMetres": bind_geometry_maximum_deviation,
        "seams": {
            "thresholdMetres": 0.03,
            "maximumBaselineMultiplier": 2,
            "fixedBindCorrespondences": seam_contracts,
            "poses": seam_pose_results,
            "pass": seams_pass,
        },
        "poseIntent": pose_intent,
        "groundAndBounds": {"poses": bounds_pose_results, "pass": bounds_pass},
        "export": {
            "path": glb_path.name,
            "gltfStructure": glb_structure,
            "containsArmorProxy": False,
        },
        "renders": [path.name for path in render_paths],
        "skeletonOverlays": [path.name for path in overlay_paths],
        "artifacts": [artifact_record(path) for path in artifacts],
        "knownLimitations": [
            "This is an automatic-weight diagnostic rig, not a production skeleton or animation set.",
            "The spike does not validate feminine parity, armor transfer, retargeting, root motion, UVs, or textures.",
            "Passing seam distances does not replace visual review of neck, wrists, shoulders, elbows, hips, and knees.",
            "The long-stride pose lifts the leading foot and exposes a rough knee silhouette; it is negative deformation evidence, not a production animation pass.",
            "The 1.8 metre source normalization remains provisional relative to actor-radius runtime scaling.",
            "humanoid.v1 proves only this accepted masculine mannequin; other body archetypes require separately approved fitted rest signatures.",
        ],
    }
    (output / "report.json").write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(f"Character rig spike complete: {output / 'report.json'}")


if __name__ == "__main__":
    main()
