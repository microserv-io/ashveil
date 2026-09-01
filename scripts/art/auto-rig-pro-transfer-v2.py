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
FRAME_ALIGNMENT = {
    source: target
    for source, target in SOURCE_TO_TARGET.items()
    if source not in {"Hips"}
}
TARGET_CONTROLS = set(SOURCE_TO_TARGET.values())
SWITCH_CONTROLS = {"c_foot_ik.l", "c_foot_ik.r", "c_hand_ik.l", "c_hand_ik.r"}


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


def world_rotation(rig, pose_bone):
    return (rig.matrix_world.to_quaternion() @ pose_bone.matrix.to_quaternion()).normalized()


def residual_roll_degrees(reference, actual):
    delta = (reference.conjugated() @ actual).normalized()
    twist = delta.copy()
    twist.x = 0.0
    twist.z = 0.0
    if twist.magnitude < 1e-12:
        return 0.0
    twist.normalize()
    angle = math.degrees(twist.angle)
    return min(angle, 360.0 - angle)


def align_source_full_frames(source, target):
    target_frames = {
        source_name: world_rotation(target, target.pose.bones[target_name])
        for source_name, target_name in FRAME_ALIGNMENT.items()
    }
    for source_name in FRAME_ALIGNMENT:
        source_bone = source.pose.bones[source_name]
        source_rotation = (
            source.matrix_world.to_quaternion().conjugated() @ target_frames[source_name]
        ).normalized()
        matrix = source_rotation.to_matrix().to_4x4()
        matrix.translation = source_bone.head
        source_bone.matrix = matrix
        bpy.context.view_layer.update()

    direction_dots = {}
    residual_rolls = {}
    for source_name, target_name in FRAME_ALIGNMENT.items():
        source_rotation = world_rotation(source, source.pose.bones[source_name])
        target_rotation = world_rotation(target, target.pose.bones[target_name])
        source_direction = source_rotation @ Vector((0.0, 1.0, 0.0))
        target_direction = target_rotation @ Vector((0.0, 1.0, 0.0))
        direction_dots[source_name] = source_direction.normalized().dot(target_direction.normalized())
        residual_rolls[source_name] = residual_roll_degrees(target_rotation, source_rotation)
    minimumDirectionDot = min(direction_dots.values())
    maximumResidualRollDegrees = max(residual_rolls.values())
    passed = minimumDirectionDot >= 0.999 and maximumResidualRollDegrees <= 2.0
    result = {
        "method": "source_pose_full_quaternion_frame",
        "minimumDirectionDot": minimumDirectionDot,
        "maximumResidualRollDegrees": maximumResidualRollDegrees,
        "directionDots": direction_dots,
        "residualRollDegrees": residual_rolls,
        "targetRestOrPoseChanged": False,
        "pass": passed,
    }
    if not passed:
        raise RuntimeError(f"Full-frame source rest alignment failed: {result}")
    return result


def configure_remap(source, source_action, target, map_path):
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
    result = bpy.ops.arp.redefine_rest_pose("EXEC_DEFAULT", preserve=True, rest_pose="REST")
    if result != {"FINISHED"}:
        raise RuntimeError(f"ARP source rest preparation failed: {result}")
    alignment = align_source_full_frames(source, target)
    if bpy.ops.arp.save_pose_rest("EXEC_DEFAULT") != {"FINISHED"}:
        raise RuntimeError("ARP source rest save failed")
    return alignment


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

    actions = []
    clip_reports = []
    convention_reports = []
    vertical_reports = []
    alignment_reports = []
    for clip_id, output_name in CLIPS:
        motion = source_by_id[clip_id]["sourceMotion"]
        frames = int(motion["frames"])
        source, source_action = import_source(source_directory / motion["path"], clip_id, frames)
        convention = assert_source_convention(source, target)
        vertical = remove_constant_hips_vertical_offset(source, source_action, frames)
        alignment = configure_remap(source, source_action, target, map_path)
        target.animation_data.action = None
        set_limb_mode(target, legs_fk=True, arms_fk=True)
        target_action = BASE.retarget(source, source_action, target, frames)
        target_action.name = output_name
        key_limb_mode(target, target_action, 1, frames)
        keyed = validate_control_action(target_action)
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
        )
        if not skeletal_pass:
            raise RuntimeError(
                f"{clip_id} transfer v2 skeletal gate failed: root net {root_distance}, "
                f"bind height error {root_height_error}, self-containment {self_containment}"
            )
        output_end = BASE.retime_action(target_action, 1, frames)
        actions.append(target_action)
        convention_reports.append({"id": clip_id, **convention})
        vertical_reports.append({"id": clip_id, **vertical})
        alignment_reports.append({"id": clip_id, **alignment})
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
    objective_pass = (
        all(item["pass"] for item in convention_reports)
        and all(item["pass"] for item in vertical_reports)
        and all(item["pass"] for item in alignment_reports)
        and all(item["pass"] for item in clip_reports)
        and target_unchanged
        and clip_timing_pass
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
        "restFrameAlignment": {
            "method": "source_only_full_local_quaternion_frames",
            "directionDotThreshold": 0.999,
            "residualRollThresholdDegrees": 2.0,
            "clips": alignment_reports,
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
            "unchanged": target_unchanged,
        },
        "retargetSkeletal": {
            "clips": clip_reports,
            "rotationAuthoring": "auto_rig_pro_retarget_operator",
            "directTargetBoneRotationsAuthoredByAshveil": False,
            "pass": True,
        },
        "meshDeformation": {
            "measured": False,
            "pass": False,
            "reason": "Skinned contact, deformation, and silhouette gates remain pending.",
        },
        "exportParity": {
            "arpExporterOnly": True,
            "clipTimingPass": True,
            "runtimeInventoryPass": not glb["controlJoints"],
            "blenderGlbSkinnedParityMeasured": False,
            "pass": False,
            "reason": "Per-frame skinned Blender/GLB parity remains pending.",
            "gltfStructure": glb,
        },
        "humanReview": {"pass": False, "required": True},
        "productionPass": False,
        "canonicalViewerPromoted": False,
        "artifacts": [BASE.artifact(blend_path), BASE.artifact(glb_path)],
    }
    (output / "report.json").write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
