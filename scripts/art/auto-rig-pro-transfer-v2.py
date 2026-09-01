import importlib.util
import json
import math
import sys
from pathlib import Path

import bpy
from mathutils import Vector


MODULE_PATH = Path(__file__).with_name("auto-rig-pro-retarget.py")
MODULE_SPEC = importlib.util.spec_from_file_location("ashveil_auto_rig_pro_retarget", MODULE_PATH)
BASE = importlib.util.module_from_spec(MODULE_SPEC)
MODULE_SPEC.loader.exec_module(BASE)

EXPECTED_MAP_SHA256 = "a0704448ac716e98875b05773e98071e8813c9c1a83cecab73c9db167848047a"
SOURCE_FPS = 20
OUTPUT_FPS = 30
CLIPS = (
    ("walk", "Ashveil_Walk_InPlace"),
    ("sprint", "Ashveil_Sprint_InPlace"),
)
SOURCE_TO_TARGET = {
    "Hips": "c_root_master.x",
    "LeftUpLeg": "c_thigh_fk.l",
    "LeftLeg": "c_leg_fk.l",
    "LeftFoot": "c_foot_fk.l",
    "LeftToe": "c_toes_fk.l",
    "RightUpLeg": "c_thigh_fk.r",
    "RightLeg": "c_leg_fk.r",
    "RightFoot": "c_foot_fk.r",
    "RightToe": "c_toes_fk.r",
    "Spine1": "c_spine_01.x",
    "Spine2": "c_spine_02.x",
    "Neck": "c_neck.x",
    "Head": "c_head.x",
    "LeftShoulder": "c_shoulder.l",
    "LeftArm": "c_arm_fk.l",
    "LeftForeArm": "c_forearm_fk.l",
    "RightShoulder": "c_shoulder.r",
    "RightArm": "c_arm_fk.r",
    "RightForeArm": "c_forearm_fk.r",
}
SOURCE_TO_DEFORM = {
    "Hips": "root.x",
    "LeftUpLeg": "thigh_stretch.l",
    "LeftLeg": "leg_stretch.l",
    "LeftFoot": "foot.l",
    "LeftToe": "toes_01.l",
    "RightUpLeg": "thigh_stretch.r",
    "RightLeg": "leg_stretch.r",
    "RightFoot": "foot.r",
    "RightToe": "toes_01.r",
    "Spine1": "spine_01.x",
    "Spine2": "spine_02.x",
    "Neck": "neck.x",
    "Head": "head.x",
    "LeftShoulder": "shoulder.l",
    "LeftArm": "arm_stretch.l",
    "LeftForeArm": "forearm_stretch.l",
    "RightShoulder": "shoulder.r",
    "RightArm": "arm_stretch.r",
    "RightForeArm": "forearm_stretch.r",
}
TARGET_CONTROLS = set(SOURCE_TO_TARGET.values())
SWITCH_CONTROLS = {"c_foot_ik.l", "c_foot_ik.r", "c_hand_ik.l", "c_hand_ik.r"}
KNEE_AREA_P05_LIMIT = 0.70
KNEE_AREA_MINIMUM_LIMIT = 0.50
FOOT_AREA_P05_LIMIT = 0.80
PARITY_P95_LIMIT = 0.001
PARITY_MAXIMUM_LIMIT = 0.002


def parse_args():
    return BASE.parse_args()


def import_source(path, clip_id, frames):
    BASE.validate_bvh(path, frames)
    before = set(bpy.data.objects)
    scene = bpy.context.scene
    scene.render.fps = SOURCE_FPS
    scene.render.fps_base = 1.0
    result = bpy.ops.import_anim.bvh(
        filepath=str(path),
        target="ARMATURE",
        global_scale=1.0,
        frame_start=1,
        use_fps_scale=False,
        update_scene_fps=True,
        update_scene_duration=True,
        use_cyclic=False,
        rotate_mode="QUATERNION",
        axis_forward="-Z",
        axis_up="Y",
    )
    if result != {"FINISHED"}:
        raise RuntimeError(f"BVH import failed for {clip_id}: {result}")
    imported = [obj for obj in set(bpy.data.objects) - before if obj.type == "ARMATURE"]
    if len(imported) != 1:
        raise RuntimeError(f"BVH import created {len(imported)} armatures for {clip_id}")
    source = imported[0]
    source.name = f"MoMask_{clip_id}_TransferV2_Source"
    action = source.animation_data.action if source.animation_data else None
    if action is None:
        raise RuntimeError(f"BVH import created no action for {clip_id}")
    action.name = f"MoMask_{clip_id}_TransferV2_20fps"
    parents = {bone.name: bone.parent.name if bone.parent else None for bone in source.data.bones}
    if parents != BASE.SOURCE_PARENTS:
        raise RuntimeError(f"Imported hierarchy changed for {clip_id}: {parents}")
    if tuple(action.frame_range) != (1.0, float(frames)):
        raise RuntimeError(f"Imported frame range changed for {clip_id}: {tuple(action.frame_range)}")
    return source, action


def assert_source_convention(source, target):
    source_root_x = source.data.bones["Hips"].head_local.x
    target_root_x = target.data.bones["c_root_master.x"].head_local.x
    source_left_x = source.data.bones["LeftUpLeg"].head_local.x - source_root_x
    source_right_x = source.data.bones["RightUpLeg"].head_local.x - source_root_x
    target_left_x = target.data.bones["c_thigh_fk.l"].head_local.x - target_root_x
    target_right_x = target.data.bones["c_thigh_fk.r"].head_local.x - target_root_x
    source_toes_y = {
        side: (
            source.data.bones[f"{side}Toe"].head_local
            - source.data.bones[f"{side}Foot"].head_local
        ).y
        for side in ("Left", "Right")
    }
    target_toes_y = {
        side: (
            target.data.bones[f"c_toes_fk.{side}"].head_local
            - target.data.bones[f"c_foot_fk.{side}"].head_local
        ).y
        for side in ("l", "r")
    }
    passed = (
        source_left_x > 0.0
        and source_right_x < 0.0
        and target_left_x > 0.0
        and target_right_x < 0.0
        and all(value < 0.0 for value in source_toes_y.values())
        and all(value < 0.0 for value in target_toes_y.values())
    )
    result = {
        "sourceLeftIsPositiveX": source_left_x > 0.0,
        "sourceRightIsNegativeX": source_right_x < 0.0,
        "targetLeftIsPositiveX": target_left_x > 0.0,
        "targetRightIsNegativeX": target_right_x < 0.0,
        "sourceToeForwardY": source_toes_y,
        "targetToeForwardY": target_toes_y,
        "pass": passed,
    }
    if not passed:
        raise RuntimeError(f"Source/target convention gate failed: {result}")
    return result


def hips_world_heights(source, action, frames):
    BASE.assign_action(source, action)
    heights = []
    for frame in range(1, frames + 1):
        bpy.context.scene.frame_set(frame)
        bpy.context.view_layer.update()
        heights.append((source.matrix_world @ source.pose.bones["Hips"].head).z)
    return heights


def remove_constant_hips_vertical_offset(source, action, frames):
    before = hips_world_heights(source, action, frames)
    root = source.pose.bones["Hips"]
    root_frame = source.matrix_world.to_3x3() @ root.bone.matrix_local.to_3x3()
    rest_height = (source.matrix_world @ source.data.bones["Hips"].head_local).z
    removed_world_constant = before[0] - rest_height
    local_offset = root_frame.inverted() @ Vector((0.0, 0.0, removed_world_constant))
    path = 'pose.bones["Hips"].location'
    curves = {curve.array_index: curve for curve in BASE.action_curves(action) if curve.data_path == path}
    if set(curves) != {0, 1, 2}:
        raise RuntimeError(f"Expected three source Hips location curves, found {sorted(curves)}")
    for index, curve in curves.items():
        for point in curve.keyframe_points:
            point.co.y -= local_offset[index]
            point.handle_left.y -= local_offset[index]
            point.handle_right.y -= local_offset[index]
    after = hips_world_heights(source, action, frames)
    maximum_delta_error = max(
        abs((after[index] - after[0]) - (before[index] - before[0]))
        for index in range(frames)
    )
    bind_height_error = abs(after[0] - rest_height)
    passed = maximum_delta_error <= 1e-6 and bind_height_error <= 1e-6
    result = {
        "removedLocalConstantVector": list(local_offset),
        "removedWorldConstantMetres": removed_world_constant,
        "maximumPreservedVerticalDeltaErrorMetres": maximum_delta_error,
        "sourceBindRelativeHeightErrorMetres": bind_height_error,
        "pass": passed,
    }
    if not passed:
        raise RuntimeError(f"Source Hips vertical normalization failed: {result}")
    return result


def semantic_sample_frames(cleanup, frames):
    contacts = []
    for side in ("left", "right"):
        for segment in cleanup.get("contactSchedule", {}).get(side, []):
            contacts.append((int(segment["startFrame"]) + int(segment["endFrameInclusive"])) // 2 + 1)
    contact = contacts[0] if contacts else max(2, frames // 4)
    return {
        "first": 1,
        "contact": min(frames, max(1, contact)),
        "mid": (frames + 1) // 2,
        "last": frames,
    }


def validate_source_cleanup(cleanup, clip_id):
    bvh = cleanup.get("bvh", {})
    loop = bvh.get("loop", {})
    knee = bvh.get("kneePlane", {})
    contacts = bvh.get("contacts", {})
    in_place_range = cleanup.get("inPlaceRootHorizontalRange", [math.inf, math.inf])
    contact_samples = [contacts.get(side, {}).get("sampleCount", 0) for side in ("left", "right")]
    contact_speeds = [
        contacts.get(side, {}).get("horizontalSpeedP95")
        for side in ("left", "right")
    ]
    result = {
        "inPlaceRootRangeMetres": max(abs(value) for value in in_place_range),
        "loopValueMaximumMetres": loop.get("valueMax", math.inf),
        "loopVelocityMaximumMetresPerFrame": loop.get("velocityMaxPerFrame", math.inf),
        "kneePlaneSignFlipFractions": {
            side: knee.get(side, {}).get("signFlipFraction", math.inf)
            for side in ("left", "right")
        },
        "contactSamples": dict(zip(("left", "right"), contact_samples)),
        "contactSpeedP95MetresPerSecond": dict(zip(("left", "right"), contact_speeds)),
        "sourceFitP95Metres": bvh.get("sourceFitP95", math.inf),
        "sourceFitMaximumMetres": bvh.get("sourceFitMax", math.inf),
        "cleanupCorrectionP95Metres": cleanup.get("cleanupCorrectionP95", math.inf),
        "cleanupCorrectionMaximumMetres": cleanup.get("cleanupCorrectionMax", math.inf),
        "reciprocalArmCorrelation": bvh.get("reciprocalArmCorrelation", math.inf),
    }
    result["pass"] = (
        result["inPlaceRootRangeMetres"] <= 1e-6
        and result["loopValueMaximumMetres"] <= 0.001
        and result["loopVelocityMaximumMetresPerFrame"] <= 0.001
        and all(value == 0.0 for value in result["kneePlaneSignFlipFractions"].values())
        and all(value >= 1 for value in contact_samples)
        and all(value is not None and value <= 0.3 for value in contact_speeds)
        and min(contacts.get(side, {}).get("minimumFootOrToeHeight", -math.inf) for side in ("left", "right")) >= -0.02
        and result["sourceFitP95Metres"] <= 0.06
        and result["sourceFitMaximumMetres"] <= 0.18
        and result["cleanupCorrectionP95Metres"] <= 0.15
        and result["cleanupCorrectionMaximumMetres"] <= 0.3
        and result["reciprocalArmCorrelation"] <= -0.65
    )
    if not result["pass"]:
        raise RuntimeError(f"{clip_id} regenerated source no longer passes source-motion gates: {result}")
    return result


def world_pose_matrix(rig, bone_name):
    return rig.matrix_world @ rig.pose.bones[bone_name].matrix


def capture_expected_frame_contract(source, source_action, target, sample_frames):
    BASE.assign_action(source, source_action)
    target_bind = {
        "controls": {
            source_name: world_pose_matrix(target, target_name).copy()
            for source_name, target_name in SOURCE_TO_TARGET.items()
        },
        "deforms": {
            source_name: world_pose_matrix(target, target_name).copy()
            for source_name, target_name in SOURCE_TO_DEFORM.items()
        },
    }
    source_samples = {}
    for label, frame in sample_frames.items():
        bpy.context.scene.frame_set(frame)
        bpy.context.view_layer.update()
        source_samples[label] = {
            source_name: world_pose_matrix(source, source_name).copy()
            for source_name in SOURCE_TO_TARGET
        }
    expected = {"controls": {}, "deforms": {}}
    for layer in ("controls", "deforms"):
        for label in sample_frames:
            expected[layer][label] = {}
            for source_name in SOURCE_TO_TARGET:
                target_bind_matrix = target_bind[layer][source_name]
                source_bind = source_samples["first"][source_name]
                source_sample = source_samples[label][source_name]
                expected_matrix = target_bind_matrix @ source_bind.inverted_safe() @ source_sample
                expected[layer][label][source_name] = expected_matrix
    return {
        "sampleFrames": sample_frames,
        "expected": expected,
        "sourceReferenceFrame": 1,
    }


def quaternion_angle_degrees(first, second):
    angle = math.degrees(first.rotation_difference(second).angle)
    return min(angle, 360.0 - angle)


def axial_error_degrees(expected_rotation, actual_rotation):
    delta = (expected_rotation.conjugated() @ actual_rotation).normalized()
    twist = delta.copy()
    twist.x = 0.0
    twist.z = 0.0
    if twist.magnitude <= 1e-12:
        return 0.0
    twist.normalize()
    return min(math.degrees(twist.angle), 360.0 - math.degrees(twist.angle))


def validate_expected_frames(target, target_action, contract):
    BASE.assign_action(target, target_action)
    target_maps = {"controls": SOURCE_TO_TARGET, "deforms": SOURCE_TO_DEFORM}
    samples = []
    angular_by_sample = {}
    for label, frame in contract["sampleFrames"].items():
        bpy.context.scene.frame_set(frame)
        bpy.context.view_layer.update()
        angular_by_sample[label] = {"controls": {}, "deforms": {}}
        for layer, mapping in target_maps.items():
            for source_name, target_name in mapping.items():
                expected = contract["expected"][layer][label][source_name]
                actual = world_pose_matrix(target, target_name)
                expected_rotation = expected.to_quaternion().normalized()
                actual_rotation = actual.to_quaternion().normalized()
                angular = quaternion_angle_degrees(expected_rotation, actual_rotation)
                axial = axial_error_degrees(expected_rotation, actual_rotation)
                delta_euler = (expected_rotation.conjugated() @ actual_rotation).to_euler("XYZ")
                yaw_pitch = max(abs(math.degrees(delta_euler.x)), abs(math.degrees(delta_euler.z)))
                hinge = angular if source_name.endswith(("Leg", "ForeArm", "Foot", "Toe")) else 0.0
                head = (expected.translation - actual.translation).length
                angular_by_sample[label][layer][source_name] = angular
                samples.append({
                    "sample": label,
                    "frame": frame,
                    "layer": layer,
                    "sourceBone": source_name,
                    "targetBone": target_name,
                    "headErrorMetres": head,
                    "angularErrorDegrees": angular,
                    "axialErrorDegrees": axial,
                    "yawPitchErrorDegrees": yaw_pitch,
                    "hingeErrorDegrees": hinge,
                })
    symmetry = []
    for label in contract["sampleFrames"]:
        for layer in target_maps:
            for left_name in (name for name in SOURCE_TO_TARGET if name.startswith("Left")):
                right_name = "Right" + left_name[4:]
                if right_name in SOURCE_TO_TARGET:
                    symmetry.append(abs(
                        angular_by_sample[label][layer][left_name]
                        - angular_by_sample[label][layer][right_name]
                    ))
    result = {
        "sampleFrames": contract["sampleFrames"],
        "maximumHeadErrorMetres": max(item["headErrorMetres"] for item in samples),
        "maximumAngularErrorDegrees": max(item["angularErrorDegrees"] for item in samples),
        "maximumAxialErrorDegrees": max(item["axialErrorDegrees"] for item in samples),
        "maximumYawPitchErrorDegrees": max(item["yawPitchErrorDegrees"] for item in samples),
        "maximumHingeErrorDegrees": max(item["hingeErrorDegrees"] for item in samples),
        "maximumPhaseSymmetryErrorDegrees": max(symmetry, default=0.0),
        "samples": samples,
    }
    result["pass"] = (
        result["maximumHeadErrorMetres"] <= 0.0005
        and result["maximumAngularErrorDegrees"] <= 0.1
        and result["maximumAxialErrorDegrees"] <= 0.1
        and result["maximumYawPitchErrorDegrees"] <= 0.25
        and result["maximumHingeErrorDegrees"] <= 0.25
        and result["maximumPhaseSymmetryErrorDegrees"] <= 3.0
    )
    if not result["pass"]:
        raise RuntimeError(f"Independent expected-frame gate failed: {result}")
    return result


def configure_remap(source, source_action, target, map_path, sample_frames):
    scene = bpy.context.scene
    scene.batch_retarget = False
    scene.source_rig = source.name
    scene.target_rig = target.name
    scene.source_action = source_action.name
    BASE.assign_action(source, source_action)
    scene.arp_retarget_in_place = False
    BASE.select([source], source)
    result = bpy.ops.arp.build_bones_list("EXEC_DEFAULT")
    if result != {"FINISHED"} or len(scene.remap_source_nodes) != len(BASE.SOURCE_PARENTS):
        raise RuntimeError(f"ARP source-node discovery failed: {result}")
    result = bpy.ops.arp.import_config("EXEC_DEFAULT", filepath=str(map_path), clear_current=True)
    if result != {"FINISHED"}:
        raise RuntimeError(f"ARP transfer v2 map import failed: {result}")
    mapped = [item.name for item in scene.bones_map_v2 if item.name not in {"", "None"}]
    if set(mapped) != TARGET_CONTROLS or len(mapped) != len(set(mapped)):
        raise RuntimeError(f"ARP transfer v2 map is not the frozen bijection: {mapped}")
    if sum(1 for item in scene.bones_map_v2 if item.set_as_root) != 1:
        raise RuntimeError("ARP transfer v2 map must contain one root")
    if any(item.ik for item in scene.bones_map_v2):
        raise RuntimeError("ARP transfer v2 leg benchmark must not map IK controls or poles")
    result = bpy.ops.arp.auto_scale("EXEC_DEFAULT")
    if result != {"FINISHED"} or max(source.scale) - min(source.scale) > 1e-8:
        raise RuntimeError("ARP Auto Scale did not produce uniform scale")
    expected_contract = capture_expected_frame_contract(
        source, source_action, target, sample_frames,
    )
    BASE.assign_action(source, source_action)
    scene.frame_set(1)
    bpy.context.view_layer.update()
    result = bpy.ops.arp.redefine_rest_pose("EXEC_DEFAULT", preserve=True, rest_pose="CURRENT")
    if result != {"FINISHED"}:
        raise RuntimeError(f"ARP source rest preparation failed: {result}")
    if bpy.ops.arp.save_pose_rest("EXEC_DEFAULT") != {"FINISHED"}:
        raise RuntimeError("ARP source rest save failed")
    return {
        "method": "arp_current_pose_source_sample_1",
        "sourceReferenceFrame": 1,
        "targetRestOrPoseChanged": False,
        "bmapRotationOffsetsAreZero": True,
        "pass": True,
    }, expected_contract


def set_limb_mode(target, legs_fk, arms_fk):
    for side in ("l", "r"):
        foot = target.pose.bones[f"c_foot_ik.{side}"]
        hand = target.pose.bones[f"c_hand_ik.{side}"]
        foot["ik_fk_switch"] = 1.0 if legs_fk else 0.0
        foot["auto_stretch"] = 0.0
        hand["ik_fk_switch"] = 1.0 if arms_fk else 0.0
        hand["auto_stretch"] = 0.0


def key_limb_mode(target, action, start, end):
    BASE.assign_action(target, action)
    set_limb_mode(target, legs_fk=True, arms_fk=True)
    for side in ("l", "r"):
        for bone_name in (f"c_foot_ik.{side}", f"c_hand_ik.{side}"):
            bone = target.pose.bones[bone_name]
            for frame in (start, end):
                bone.keyframe_insert('["ik_fk_switch"]', frame=frame, group=bone.name)
                bone.keyframe_insert('["auto_stretch"]', frame=frame, group=bone.name)


def validate_control_action(action):
    keyed = BASE.keyed_bones(action)
    unexpected = sorted(keyed - TARGET_CONTROLS - SWITCH_CONTROLS)
    if unexpected:
        raise RuntimeError(f"Transfer v2 keys non-whitelisted controls: {unexpected}")
    for forbidden in ("c_hand_fk.l", "c_hand_fk.r"):
        if forbidden in keyed:
            raise RuntimeError(f"Unobservable hand control was keyed: {forbidden}")
    for curve in BASE.action_curves(action):
        if any(f'pose.bones["{name}"]' in curve.data_path for name in SWITCH_CONTROLS):
            if not (
                curve.data_path.endswith('["ik_fk_switch"]')
                or curve.data_path.endswith('["auto_stretch"]')
            ):
                raise RuntimeError(f"Opposite kinematic chain was animated: {curve.data_path}")
    return sorted(keyed)


def validate_action_self_containment(rig, action, frames, expected_snapshots):
    rig.animation_data.action = None
    set_limb_mode(rig, legs_fk=False, arms_fk=False)
    BASE.assign_action(rig, action)
    replayed = BASE.deform_snapshots(rig, action, frames)
    error, frame, bone = BASE.maximum_snapshot_error(expected_snapshots, replayed)
    return {
        "maximumDeformMatrixComponentError": error,
        "maximumErrorFrame": frame,
        "maximumErrorBone": bone,
        "oppositeAmbientStateRejected": error <= 1e-6,
        "pass": error <= 1e-6,
    }


def bind_floor_and_root_height(target, meshes):
    floor = min(
        (obj.matrix_world @ vertex.co).z
        for obj in meshes
        for vertex in obj.data.vertices
    )
    root = (target.matrix_world @ target.pose.bones["c_root_master.x"].head).z
    return floor, root - floor


def target_root_height(target, action, frame, bind_floor):
    BASE.assign_action(target, action)
    bpy.context.scene.frame_set(frame)
    bpy.context.view_layer.update()
    return (target.matrix_world @ target.pose.bones["c_root_master.x"].head).z - bind_floor


def percentile(values, quantile):
    if not values:
        raise RuntimeError("Cannot measure an empty deformation sample")
    ordered = sorted(values)
    index = min(len(ordered) - 1, max(0, math.ceil(len(ordered) * quantile) - 1))
    return ordered[index]


def evaluated_positions(mesh):
    evaluated = mesh.evaluated_get(bpy.context.evaluated_depsgraph_get())
    return [evaluated.matrix_world @ vertex.co for vertex in evaluated.data.vertices]


def weighted_region_vertices(mesh, groups, center_z, radius, side):
    group_indices = {mesh.vertex_groups[name].index for name in groups}
    selected = set()
    for vertex in mesh.data.vertices:
        world = mesh.matrix_world @ vertex.co
        correct_side = world.x >= 0.0 if side == "l" else world.x <= 0.0
        weight = sum(item.weight for item in vertex.groups if item.group in group_indices)
        if correct_side and weight >= 0.5 and abs(world.z - center_z) <= radius:
            selected.add(vertex.index)
    return selected


def frozen_deformation_patches(target, body):
    patches = {"knees": {}, "feet": {}}
    for side in ("l", "r"):
        knee_z = (target.matrix_world @ target.data.bones[f"leg_stretch.{side}"].head_local).z
        knee_vertices = weighted_region_vertices(
            body, (f"thigh_stretch.{side}", f"leg_stretch.{side}"), knee_z, 0.09, side,
        )
        foot_z = (target.matrix_world @ target.data.bones[f"foot.{side}"].head_local).z
        foot_vertices = weighted_region_vertices(
            body, (f"foot.{side}", f"toes_01.{side}"), foot_z, 0.16, side,
        )
        for label, vertices in (("knees", knee_vertices), ("feet", foot_vertices)):
            faces = [
                tuple(polygon.vertices)
                for polygon in body.data.polygons
                if len(polygon.vertices) == 3 and all(index in vertices for index in polygon.vertices)
            ]
            if not faces:
                raise RuntimeError(f"Frozen {label} patch is empty for {side}")
            patches[label][side] = faces
    bind_positions = evaluated_positions(body)
    for regions in patches.values():
        for faces in regions.values():
            for face in faces:
                a, b, c = (bind_positions[index] for index in face)
                if (b - a).cross(c - a).length <= 1e-10:
                    raise RuntimeError("Frozen deformation patch contains a degenerate bind triangle")
    return patches, bind_positions


def patch_area_ratios(positions, bind_positions, faces):
    ratios = []
    for face in faces:
        bind_a, bind_b, bind_c = (bind_positions[index] for index in face)
        pose_a, pose_b, pose_c = (positions[index] for index in face)
        bind_area = (bind_b - bind_a).cross(bind_c - bind_a).length
        pose_area = (pose_b - pose_a).cross(pose_c - pose_a).length
        ratios.append(pose_area / bind_area)
    return ratios


def validate_mesh_deformation(target, body, actions, clip_reports, patches, bind_positions):
    knee_ratios = []
    foot_ratios = []
    samples = []
    action_by_name = {action.name: action for action in actions}
    for clip in clip_reports:
        action = action_by_name[clip["outputName"]]
        for label, frame in clip["outputSemanticFrames"].items():
            BASE.assign_action(target, action)
            bpy.context.scene.frame_set(frame)
            bpy.context.view_layer.update()
            positions = evaluated_positions(body)
            sample_knees = []
            sample_feet = []
            for side in ("l", "r"):
                sample_knees.extend(patch_area_ratios(
                    positions, bind_positions, patches["knees"][side],
                ))
                sample_feet.extend(patch_area_ratios(
                    positions, bind_positions, patches["feet"][side],
                ))
            knee_ratios.extend(sample_knees)
            foot_ratios.extend(sample_feet)
            samples.append({
                "clip": clip["id"],
                "sample": label,
                "frame": frame,
                "kneeAreaRatioP05": percentile(sample_knees, 0.05),
                "footAreaRatioP05": percentile(sample_feet, 0.05),
            })
    result = {
        "measured": True,
        "kneePatchAreaRatioP05": percentile(knee_ratios, 0.05),
        "kneePatchAreaRatioMinimum": min(knee_ratios),
        "kneePatchFacesBelowHalf": sum(value < KNEE_AREA_MINIMUM_LIMIT for value in knee_ratios),
        "footPatchAreaRatioP05": percentile(foot_ratios, 0.05),
        "footPatchAreaRatioMinimum": min(foot_ratios),
        "samples": samples,
    }
    result["pass"] = (
        result["kneePatchAreaRatioP05"] >= KNEE_AREA_P05_LIMIT
        and result["kneePatchFacesBelowHalf"] == 0
        and result["footPatchAreaRatioP05"] >= FOOT_AREA_P05_LIMIT
    )
    if not result["pass"]:
        raise RuntimeError(f"Transfer v2 mesh deformation gate failed: {result}")
    return result


def output_semantic_frames(source_frames, output_end):
    scale = OUTPUT_FPS / SOURCE_FPS
    return {
        label: int(round((frame - 1) * scale))
        for label, frame in source_frames.items()
        if 0 <= int(round((frame - 1) * scale)) <= output_end
    }


def validate_retimed_expected_frames(target, action, contract, output_frames):
    retimed_contract = {
        "sampleFrames": output_frames,
        "expected": contract["expected"],
    }
    return validate_expected_frames(target, action, retimed_contract)


def runtime_bone(runtime, source_name):
    if source_name in runtime.pose.bones:
        return runtime.pose.bones[source_name]
    candidates = [bone for bone in runtime.pose.bones if bone.name.endswith(source_name)]
    if len(candidates) != 1:
        raise RuntimeError(f"Runtime bone correspondence missing for {source_name}")
    return candidates[0]


def validate_blender_glb_parity(glb_path, target, meshes, actions, clip_reports):
    reference = {}
    for clip in clip_reports:
        action = next(item for item in actions if item.name == clip["outputName"])
        BASE.assign_action(target, action)
        reference[action.name] = {}
        for frame in sorted(set(clip["outputSemanticFrames"].values())):
            bpy.context.scene.frame_set(frame)
            bpy.context.view_layer.update()
            reference[action.name][frame] = {
                "vertices": {mesh.name: evaluated_positions(mesh) for mesh in meshes},
                "deforms": {
                    name: world_pose_matrix(target, name).copy()
                    for name in SOURCE_TO_DEFORM.values()
                },
            }
    before = set(bpy.data.objects)
    if bpy.ops.import_scene.gltf(filepath=str(glb_path)) != {"FINISHED"}:
        raise RuntimeError("Transfer v2 GLB could not be re-imported for parity")
    imported_objects = set(bpy.data.objects) - before
    runtime_armatures = [obj for obj in imported_objects if obj.type == "ARMATURE"]
    runtime_meshes = [obj for obj in imported_objects if obj.type == "MESH"]
    if len(runtime_armatures) != 1:
        raise RuntimeError(f"Expected one runtime armature, found {len(runtime_armatures)}")
    runtime = runtime_armatures[0]
    vertex_errors = []
    hinge_errors = []
    roll_errors = []
    for action in actions:
        imported_action = next(
            (candidate for candidate in bpy.data.actions if candidate != action and candidate.name.startswith(action.name)),
            None,
        )
        if imported_action is None:
            raise RuntimeError(f"Imported GLB action missing for parity: {action.name}")
        BASE.assign_action(runtime, imported_action)
        for frame, sample in reference[action.name].items():
            bpy.context.scene.frame_set(frame)
            bpy.context.view_layer.update()
            for name, source_positions in sample["vertices"].items():
                runtime_mesh = next(
                    (mesh for mesh in runtime_meshes if mesh.name.startswith(name) and len(mesh.data.vertices) == len(source_positions)),
                    None,
                )
                if runtime_mesh is None:
                    raise RuntimeError(f"Runtime mesh correspondence missing for {name}")
                vertex_errors.extend(
                    (source - actual).length
                    for source, actual in zip(source_positions, evaluated_positions(runtime_mesh))
                )
            for bone_name, source_matrix in sample["deforms"].items():
                actual_matrix = runtime.matrix_world @ runtime_bone(runtime, bone_name).matrix
                source_rotation = source_matrix.to_quaternion().normalized()
                actual_rotation = actual_matrix.to_quaternion().normalized()
                error = quaternion_angle_degrees(source_rotation, actual_rotation)
                if bone_name.startswith(("leg_stretch", "forearm_stretch")):
                    hinge_errors.append(error)
                roll_errors.append(axial_error_degrees(source_rotation, actual_rotation))
    result = {
        "measured": True,
        "authorRuntimeHingeErrorDegrees": max(hinge_errors, default=0.0),
        "authorRuntimeRollErrorDegrees": max(roll_errors, default=0.0),
        "skinnedVertexP95Metres": percentile(vertex_errors, 0.95),
        "skinnedVertexMaximumMetres": max(vertex_errors),
    }
    result["pass"] = (
        result["authorRuntimeHingeErrorDegrees"] <= 0.1
        and result["authorRuntimeRollErrorDegrees"] <= 0.1
        and result["skinnedVertexP95Metres"] <= PARITY_P95_LIMIT
        and result["skinnedVertexMaximumMetres"] <= PARITY_MAXIMUM_LIMIT
    )
    for obj in imported_objects:
        bpy.data.objects.remove(obj, do_unlink=True)
    if not result["pass"]:
        raise RuntimeError(f"Transfer v2 Blender/GLB parity failed: {result}")
    return result


def render_semantic_samples(output, target, meshes, actions, clip_reports):
    directory = output / "renders"
    directory.mkdir(parents=True, exist_ok=True)
    scene = bpy.context.scene
    camera_data = bpy.data.cameras.new("TransferV2SemanticCamera")
    camera = bpy.data.objects.new("TransferV2SemanticCamera", camera_data)
    scene.collection.objects.link(camera)
    scene.camera = camera
    camera_data.type = "ORTHO"
    camera_data.ortho_scale = 2.15
    scene.render.engine = "BLENDER_WORKBENCH"
    scene.render.resolution_x = scene.render.resolution_y = 512
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    target.hide_render = True
    action_by_name = {action.name: action for action in actions}
    paths = []
    center = Vector((0.0, 0.0, 0.95))
    views = {
        "front": Vector((0.0, -4.5, 1.05)),
        "right": Vector((4.5, 0.0, 1.05)),
        "back": Vector((0.0, 4.5, 1.05)),
    }
    for clip in clip_reports:
        BASE.assign_action(target, action_by_name[clip["outputName"]])
        for label, frame in clip["outputSemanticFrames"].items():
            scene.frame_set(frame)
            bpy.context.view_layer.update()
            for view, location in views.items():
                camera.location = location
                camera.rotation_mode = "QUATERNION"
                camera.rotation_quaternion = (center - location).to_track_quat("-Z", "Y")
                path = directory / f"{clip['id']}-{label}-{view}.png"
                scene.render.filepath = str(path)
                bpy.ops.render.render(write_still=True)
                paths.append(path)
    bpy.data.objects.remove(camera, do_unlink=True)
    bpy.data.cameras.remove(camera_data)
    return paths


def main():
    args = parse_args()
    source_directory = Path(args.source).resolve()
    source_report_path = Path(args.source_report).resolve()
    map_path = Path(args.map).resolve()
    output = Path(args.output).resolve()
    output.mkdir(parents=True, exist_ok=True)
    if BASE.sha256(map_path) != EXPECTED_MAP_SHA256:
        raise RuntimeError("Frozen transfer v2 map hash changed")
    source_report = json.loads(source_report_path.read_text(encoding="utf-8"))
    if source_report.get("retargetReady") is not True:
        raise RuntimeError("Source report is not retarget-ready")
    source_by_id = {clip["id"]: clip for clip in source_report["clips"]}
    for clip_id, _ in CLIPS:
        if source_by_id[clip_id].get("sourceMotion", {}).get("pass") is not True:
            raise RuntimeError(f"{clip_id} sourceMotion.pass is not true")

    installation = BASE.arp_installation()
    target = bpy.data.objects.get("rig")
    if target is None or target.type != "ARMATURE" or len(target.data.bones) != 211:
        raise RuntimeError("Accepted 211-bone ARP target rig was not found")
    meshes = [
        obj for obj in bpy.data.objects
        if obj.type == "MESH"
        and any(mod.type == "ARMATURE" and mod.object == target for mod in obj.modifiers)
    ]
    if not meshes:
        raise RuntimeError("Accepted ARP target has no skinned meshes")
    state_before = BASE.target_state(target, meshes)
    BASE.clear_animation(target)
    bind_floor, bind_root_height = bind_floor_and_root_height(target, meshes)
    body = bpy.data.objects.get("Body")
    if body not in meshes:
        raise RuntimeError("Accepted Body mesh was not found")
    deformation_patches, bind_body_positions = frozen_deformation_patches(target, body)

    actions = []
    clip_reports = []
    convention_reports = []
    vertical_reports = []
    calibration_reports = []
    for clip_id, output_name in CLIPS:
        motion = source_by_id[clip_id]["sourceMotion"]
        frames = int(motion["frames"])
        cleanup_path = source_directory / clip_id / "game_loop_cleanup.json"
        cleanup = json.loads(cleanup_path.read_text(encoding="utf-8"))
        source_cleanup_acceptance = validate_source_cleanup(cleanup, clip_id)
        knee_cleanup = cleanup.get("kneeSagittalCorrection", {})
        foot_cleanup = cleanup.get("footToeSwingCorrection", {})
        provenance = cleanup.get("sourceProvenance", {})
        knee_sides = [knee_cleanup.get(side, {}) for side in ("left", "right")]
        foot_sides = [foot_cleanup.get(side, {}) for side in ("left", "right")]
        cleanup_pass = (
            all(item.get("pass") is True for item in knee_sides)
            and max(item.get("maximumHingeOffSagittalDegrees", math.inf) for item in knee_sides) <= 15.0 + 1e-6
            and all(item.get("pass") is True for item in foot_sides)
            and max(item.get("maximumSwingOffSagittalDegrees", math.inf) for item in foot_sides) <= 5.0
            and max(item.get("maximumUnobservableAxialRollDegrees", math.inf) for item in foot_sides) <= 5.0
            and provenance.get("sourceFrameOneMaximumCorrectionMetres", math.inf) <= 1e-8
        )
        if not cleanup_pass:
            raise RuntimeError(f"{clip_id} source anatomical cleanup gate failed")
        sample_frames = semantic_sample_frames(cleanup, frames)
        source, source_action = import_source(source_directory / motion["path"], clip_id, frames)
        convention = assert_source_convention(source, target)
        vertical = remove_constant_hips_vertical_offset(source, source_action, frames)
        calibration, expected_contract = configure_remap(
            source, source_action, target, map_path, sample_frames,
        )
        target.animation_data.action = None
        set_limb_mode(target, legs_fk=True, arms_fk=True)
        target_action = BASE.retarget(source, source_action, target, frames)
        target_action.name = output_name
        key_limb_mode(target, target_action, 1, frames)
        keyed = validate_control_action(target_action)
        expected_frames = validate_expected_frames(target, target_action, expected_contract)
        snapshots = BASE.deform_snapshots(target, target_action, range(1, frames + 1))
        root_distance = BASE.root_net_distance(target, target_action, 1, frames)
        self_containment = validate_action_self_containment(
            target,
            target_action,
            range(1, frames + 1),
            snapshots,
        )
        root_height = target_root_height(target, target_action, 1, bind_floor)
        root_height_error = abs(root_height - bind_root_height)
        skeletal_pass = (
            root_distance <= 0.001
            and root_height_error <= 0.001
            and self_containment["pass"]
            and expected_frames["pass"]
        )
        if not skeletal_pass:
            raise RuntimeError(
                f"{clip_id} transfer v2 skeletal gate failed: root net {root_distance}, "
                f"bind height error {root_height_error}, self-containment {self_containment}"
            )
        output_end = BASE.retime_action(target_action, 1, frames)
        output_frames = output_semantic_frames(sample_frames, output_end)
        retimed_expected_frames = validate_retimed_expected_frames(
            target, target_action, expected_contract, output_frames,
        )
        actions.append(target_action)
        convention_reports.append({"id": clip_id, **convention})
        vertical_reports.append({"id": clip_id, **vertical})
        calibration_reports.append({"id": clip_id, **calibration})
        clip_reports.append({
            "id": clip_id,
            "sourcePath": motion["path"],
            "sourceSha256": motion["sha256"],
            "sourceFrames": frames,
            "sourceFps": SOURCE_FPS,
            "outputName": output_name,
            "outputFrames": output_end + 1,
            "outputFrameStart": 0,
            "outputFrameEnd": output_end,
            "outputFps": OUTPUT_FPS,
            "durationSeconds": output_end / OUTPUT_FPS,
            "retargetBakeCount": 1,
            "legMode": "FK",
            "armMode": "FK",
            "handsUnmapped": True,
            "targetRootNetHorizontalDistanceMetres": root_distance,
            "targetBindRelativeRootHeightMetres": root_height,
            "targetBindRelativeRootHeightErrorMetres": root_height_error,
            "actionSelfContainment": self_containment,
            "independentExpectedFrames": expected_frames,
            "retimedExpectedFrames": retimed_expected_frames,
            "outputSemanticFrames": output_frames,
            "sourceCleanupPath": str(cleanup_path.relative_to(source_directory)),
            "sourceCleanupSha256": BASE.sha256(cleanup_path),
            "sourceAnatomicalCleanup": {
                "kneeSagittalCorrection": knee_cleanup,
                "footToeSwingCorrection": foot_cleanup,
                "sourceFrameOneMaximumCorrectionMetres": provenance["sourceFrameOneMaximumCorrectionMetres"],
                "pass": cleanup_pass,
            },
            "sourceCleanupAcceptance": source_cleanup_acceptance,
            "targetMeshContactMeasured": False,
            "pass": skeletal_pass,
        })
        BASE.remove_source(source, [source_action])
        if "rest_transf_offset" in bpy.context.scene:
            del bpy.context.scene["rest_transf_offset"]

    state_after = BASE.target_state(target, meshes)
    target_unchanged = state_before == state_after
    if not target_unchanged:
        raise RuntimeError("Transfer v2 changed accepted target rest, geometry, weights, or modifiers")
    mesh_deformation = validate_mesh_deformation(
        target, body, actions, clip_reports, deformation_patches, bind_body_positions,
    )
    BASE.configure_export(bpy.context.scene, actions)
    BASE.assign_action(target, actions[0])
    blend_path = output / "masculine-auto-rig-pro-transfer-v2.blend"
    glb_path = output / "masculine-auto-rig-pro-transfer-v2-diagnostic.glb"
    bpy.context.scene.frame_start = 0
    bpy.context.scene.frame_end = int(max(action.frame_end for action in actions))
    bpy.ops.wm.save_as_mainfile(filepath=str(blend_path))
    BASE.select([target, *meshes], target)
    export_result = bpy.ops.arp.arp_export_gltf_panel(
        "EXEC_DEFAULT",
        filepath=str(glb_path),
        quick_export=True,
    )
    if export_result != {"FINISHED"} or not glb_path.exists():
        raise RuntimeError(f"ARP GLB export failed: {export_result}")
    glb = BASE.parse_glb(glb_path)
    expected_names = sorted(action.name for action in actions)
    actual_names = sorted(animation["name"] for animation in glb["animations"])
    clip_timing_pass = actual_names == expected_names and all(
        any(
            animation["name"] == clip["outputName"]
            and abs(animation["endSeconds"] - clip["durationSeconds"]) <= 1e-5
            for animation in glb["animations"]
        )
        for clip in clip_reports
    )
    if not clip_timing_pass:
        raise RuntimeError(f"Transfer v2 GLB clip timing failed: {glb['animations']}")
    export_parity = validate_blender_glb_parity(glb_path, target, meshes, actions, clip_reports)
    render_paths = render_semantic_samples(output, target, meshes, actions, clip_reports)
    objective_pass = (
        all(item["pass"] for item in convention_reports)
        and all(item["pass"] for item in vertical_reports)
        and all(item["pass"] for item in calibration_reports)
        and all(item["pass"] for item in clip_reports)
        and target_unchanged
        and clip_timing_pass
        and mesh_deformation["pass"]
        and export_parity["pass"]
    )
    if not objective_pass:
        raise RuntimeError("Transfer v2 objective acceptance failed")
    report = {
        "schemaVersion": "ashveil.auto-rig-pro-transfer-v2",
        "status": "diagnostic_not_production_ready",
        "objectiveAcceptance": {"pass": True},
        "sourceMotion": {
            "pass": True,
            "reportSha256": BASE.sha256(source_report_path),
            "clips": [
                {"id": clip["id"], "path": clip["sourcePath"], "sha256": clip["sourceSha256"]}
                for clip in clip_reports
            ],
            "rejectedClips": [
                {
                    "id": "idle",
                    "outputProduced": False,
                    "reason": "Current MoMask idle is excluded from transfer v2.",
                }
            ],
        },
        "sourceConvention": {"clips": convention_reports, "pass": True},
        "sourceVerticalNormalization": {"clips": vertical_reports, "pass": True},
        "sourceRestCalibration": {
            "method": "arp_current_pose_source_sample_1",
            "clips": calibration_reports,
            "pass": True,
        },
        "mapping": {
            "path": map_path.name,
            "sha256": BASE.sha256(map_path),
            "mappedTargetCount": len(TARGET_CONTROLS),
            "legs": "FK",
            "polesMapped": False,
            "unmappedSourceBones": ["Spine", "LeftHand", "RightHand"],
            "terminalHandsUseAcceptedBindRoll": True,
            "pass": True,
        },
        "autoRigPro": installation,
        "target": {
            "object": target.name,
            "bindFloorMetres": bind_floor,
            "bindRelativeRootHeightMetres": bind_root_height,
            "before": state_before,
            "after": state_after,
            "cleanBindUnchanged": target_unchanged,
            "unchanged": target_unchanged,
        },
        "retargetSkeletal": {
            "clips": clip_reports,
            "rotationAuthoring": "auto_rig_pro_retarget_operator",
            "directTargetBoneRotationsAuthoredByAshveil": False,
            "pass": True,
        },
        "meshDeformation": mesh_deformation,
        "exportParity": {
            "arpExporterOnly": True,
            "clipTimingPass": True,
            "runtimeInventoryPass": not glb["controlJoints"],
            "blenderGlbSkinnedParityMeasured": True,
            **export_parity,
            "gltfStructure": glb,
        },
        "humanReview": {"pass": False, "required": True},
        "productionPass": False,
        "canonicalViewerPromoted": False,
        "artifacts": [
            BASE.artifact(blend_path),
            BASE.artifact(glb_path),
            *[BASE.artifact(path) for path in render_paths],
        ],
    }
    (output / "report.json").write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
