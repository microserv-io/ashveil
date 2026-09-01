import argparse
import hashlib
import json
import math
import struct
import sys
import tomllib
from pathlib import Path

import bpy


EXPECTED_ARP_VERSION = "3.78.47"
EXPECTED_MAP_SHA256 = "d9b4566ab7f9344505545260530ad14e56f0daacab2cea181b90e26df2bc9324"
SOURCE_FPS = 20
OUTPUT_FPS = 30
CLIPS = (
    ("idle", "Ashveil_Idle_InPlace"),
    ("walk", "Ashveil_Walk_InPlace"),
    ("sprint", "Ashveil_Sprint_InPlace"),
)
SOURCE_PARENTS = {
    "Hips": None,
    "LeftUpLeg": "Hips",
    "LeftLeg": "LeftUpLeg",
    "LeftFoot": "LeftLeg",
    "LeftToe": "LeftFoot",
    "RightUpLeg": "Hips",
    "RightLeg": "RightUpLeg",
    "RightFoot": "RightLeg",
    "RightToe": "RightFoot",
    "Spine": "Hips",
    "Spine1": "Spine",
    "Spine2": "Spine1",
    "Neck": "Spine2",
    "Head": "Neck",
    "LeftShoulder": "Spine2",
    "LeftArm": "LeftShoulder",
    "LeftForeArm": "LeftArm",
    "LeftHand": "LeftForeArm",
    "RightShoulder": "Spine2",
    "RightArm": "RightShoulder",
    "RightForeArm": "RightArm",
    "RightHand": "RightForeArm",
}
TARGET_CONTROLS = {
    "c_root_master.x",
    "c_thigh_fk.l", "c_leg_fk.l", "c_foot_ik.l", "c_toes_ik.l",
    "c_thigh_fk.r", "c_leg_fk.r", "c_foot_ik.r", "c_toes_ik.r",
    "c_spine_01.x", "c_spine_02.x", "c_neck.x", "c_head.x",
    "c_shoulder.l", "c_arm_fk.l", "c_forearm_fk.l",
    "c_shoulder.r", "c_arm_fk.r", "c_forearm_fk.r",
}
ALIGN_SOURCE_BONES = tuple(
    name for name in SOURCE_PARENTS
    if name not in {"Hips", "Spine", "LeftHand", "RightHand"}
)
POLE_CONTROLS = {"c_leg_pole.l", "c_leg_pole.r"}
SWITCH_CONTROLS = {"c_foot_ik.l", "c_foot_ik.r", "c_hand_ik.l", "c_hand_ik.r"}


def parse_args():
    separator = sys.argv.index("--") if "--" in sys.argv else len(sys.argv)
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", required=True)
    parser.add_argument("--source-report", required=True)
    parser.add_argument("--map", required=True)
    parser.add_argument("--output", required=True)
    return parser.parse_args(sys.argv[separator + 1:])


def sha256(path):
    digest = hashlib.sha256()
    with Path(path).open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def hash_values(values):
    digest = hashlib.sha256()
    for value in values:
        if isinstance(value, str):
            digest.update(value.encode("utf-8"))
            digest.update(b"\0")
        else:
            digest.update(struct.pack("<d", float(value)))
    return digest.hexdigest()


def action_curves(action):
    if hasattr(action, "fcurves"):
        return list(action.fcurves)
    curves = []
    for layer in action.layers:
        for strip in layer.strips:
            for channel_bag in strip.channelbags:
                curves.extend(channel_bag.fcurves)
    return curves


def select(objects, active):
    if bpy.context.object and bpy.context.object.mode != "OBJECT":
        bpy.ops.object.mode_set(mode="OBJECT")
    bpy.ops.object.select_all(action="DESELECT")
    for obj in objects:
        obj.hide_set(False)
        obj.hide_viewport = False
        obj.hide_select = False
        obj.select_set(True)
    bpy.context.view_layer.objects.active = active


def assign_action(rig, action):
    rig.animation_data_create().action = action


def target_state(rig, meshes):
    rest = []
    for bone in sorted(rig.data.bones, key=lambda item: item.name):
        rest.append(bone.name)
        rest.extend(value for row in bone.matrix_local for value in row)
    skin = []
    for obj in sorted(meshes, key=lambda item: item.name):
        skin.extend((obj.name, obj.data.name))
        for vertex in obj.data.vertices:
            skin.extend(vertex.co)
            for group in sorted(vertex.groups, key=lambda item: obj.vertex_groups[item.group].name):
                skin.extend((obj.vertex_groups[group.group].name, group.weight))
        for modifier in obj.modifiers:
            skin.extend((
                modifier.name,
                modifier.type,
                modifier.object.name if getattr(modifier, "object", None) else "",
            ))
    return {
        "restMatricesSha256": hash_values(rest),
        "meshGeometryWeightsSha256": hash_values(skin),
    }


def clear_animation(rig):
    if rig.animation_data:
        rig.animation_data.action = None
        for track in list(rig.animation_data.nla_tracks):
            rig.animation_data.nla_tracks.remove(track)
    for action in list(bpy.data.actions):
        bpy.data.actions.remove(action)
    select([rig], rig)
    bpy.ops.object.mode_set(mode="POSE")
    bpy.ops.arp.reset_pose()
    bpy.ops.object.mode_set(mode="OBJECT")


def arp_installation():
    addon = bpy.context.preferences.addons.get("bl_ext.user_default.auto_rig_pro")
    if addon is None:
        raise RuntimeError("Auto-Rig Pro must be enabled as bl_ext.user_default.auto_rig_pro")
    package = Path(sys.modules[addon.module].__file__).resolve().parent
    manifest_path = package / "blender_manifest.toml"
    manifest = tomllib.loads(manifest_path.read_text(encoding="utf-8"))
    if manifest["version"] != EXPECTED_ARP_VERSION:
        raise RuntimeError(f"Expected Auto-Rig Pro {EXPECTED_ARP_VERSION}, found {manifest['version']}")
    return {
        "extensionModule": addon.module,
        "version": manifest["version"],
        "manifestSha256": sha256(manifest_path),
    }


def validate_bvh(path, frames):
    lines = path.read_text(encoding="utf-8").splitlines()
    frame_line = next((line for line in lines if line.startswith("Frames:")), "")
    time_line = next((line for line in lines if line.startswith("Frame Time:")), "")
    if not frame_line or int(frame_line.split(":", 1)[1]) != frames:
        raise RuntimeError(f"{path.name} BVH frame count changed")
    if not time_line or abs(float(time_line.split(":", 1)[1]) - 0.05) > 1e-8:
        raise RuntimeError(f"{path.name} must retain native 20 fps")
    if not any(
        line.strip() == "CHANNELS 6 Xposition Yposition Zposition Zrotation Yrotation Xrotation"
        for line in lines
    ):
        raise RuntimeError(f"{path.name} root channels changed")
    if sum(line.strip().startswith(("ROOT ", "JOINT ")) for line in lines) != 22:
        raise RuntimeError(f"{path.name} must contain 22 joints")


def import_source(path, clip_id, frames):
    validate_bvh(path, frames)
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
        axis_forward="Z",
        axis_up="Y",
    )
    if result != {"FINISHED"}:
        raise RuntimeError(f"BVH import failed for {clip_id}: {result}")
    imported = [obj for obj in set(bpy.data.objects) - before if obj.type == "ARMATURE"]
    if len(imported) != 1:
        raise RuntimeError(f"BVH import created {len(imported)} armatures for {clip_id}")
    source = imported[0]
    source.name = f"MoMask_{clip_id}_Source"
    action = source.animation_data.action if source.animation_data else None
    if action is None:
        raise RuntimeError(f"BVH import created no action for {clip_id}")
    action.name = f"MoMask_{clip_id}_Root_20fps"
    parents = {bone.name: bone.parent.name if bone.parent else None for bone in source.data.bones}
    if parents != SOURCE_PARENTS:
        raise RuntimeError(f"Imported hierarchy changed for {clip_id}: {parents}")
    if tuple(action.frame_range) != (1.0, float(frames)):
        raise RuntimeError(f"Imported frame range changed for {clip_id}: {tuple(action.frame_range)}")
    return source, action


def configure_remap(source, source_action, target, map_path):
    scene = bpy.context.scene
    scene.batch_retarget = False
    scene.source_rig = source.name
    scene.target_rig = target.name
    scene.source_action = source_action.name
    assign_action(source, source_action)
    scene.arp_retarget_in_place = False
    select([source], source)
    result = bpy.ops.arp.build_bones_list("EXEC_DEFAULT")
    if result != {"FINISHED"} or len(scene.remap_source_nodes) != len(SOURCE_PARENTS):
        raise RuntimeError(f"ARP source-node discovery failed: {result}")
    result = bpy.ops.arp.import_config("EXEC_DEFAULT", filepath=str(map_path), clear_current=True)
    if result != {"FINISHED"}:
        raise RuntimeError(f"ARP map import failed: {result}")
    mapped = [item.name for item in scene.bones_map_v2 if item.name not in {"", "None"}]
    if set(mapped) != TARGET_CONTROLS or len(mapped) != len(set(mapped)):
        raise RuntimeError(f"ARP map is not the frozen bijection: {mapped}")
    if sum(1 for item in scene.bones_map_v2 if item.set_as_root) != 1:
        raise RuntimeError("ARP map must contain one root")
    result = bpy.ops.arp.auto_scale("EXEC_DEFAULT")
    if result != {"FINISHED"} or max(source.scale) - min(source.scale) > 1e-8:
        raise RuntimeError("ARP Auto Scale did not produce uniform scale")
    result = bpy.ops.arp.redefine_rest_pose("EXEC_DEFAULT", preserve=True, rest_pose="REST")
    if result != {"FINISHED"}:
        raise RuntimeError(f"ARP source rest preparation failed: {result}")
    bpy.ops.pose.select_all(action="DESELECT")
    for name in ALIGN_SOURCE_BONES:
        if bpy.app.version >= (5, 0, 0):
            source.pose.bones[name].select = True
        else:
            source.pose.bones[name].bone.select = True
    if bpy.ops.arp.copy_bone_rest("EXEC_DEFAULT") != {"FINISHED"}:
        raise RuntimeError("ARP source rest alignment failed")
    if bpy.ops.arp.save_pose_rest("EXEC_DEFAULT") != {"FINISHED"}:
        raise RuntimeError("ARP source rest save failed")


def retarget(source, source_action, target, frames):
    scene = bpy.context.scene
    assign_action(source, source_action)
    scene.source_action = source_action.name
    select([target], target)
    result = bpy.ops.arp.retarget(
        "EXEC_DEFAULT",
        frame_start=1,
        frame_end=frames,
        fake_user_action=True,
        only_existing_keyframes=False,
        clean_fk_rot=False,
        clean_ik_pole=False,
        extract_root_motion=False,
        interpolation_type="LINEAR",
        handle_type="VECTOR",
    )
    if result != {"FINISHED"} or not target.animation_data or not target.animation_data.action:
        raise RuntimeError(f"ARP retarget failed for {source_action.name}: {result}")
    return target.animation_data.action


def set_limb_mode(target, feet_ik, hands_fk):
    for side in ("l", "r"):
        foot = target.pose.bones[f"c_foot_ik.{side}"]
        hand = target.pose.bones[f"c_hand_ik.{side}"]
        foot["ik_fk_switch"] = 0.0 if feet_ik else 1.0
        foot["auto_stretch"] = 0.0
        hand["ik_fk_switch"] = 1.0 if hands_fk else 0.0
        hand["auto_stretch"] = 0.0


def key_limb_mode(target, action, start, end):
    assign_action(target, action)
    set_limb_mode(target, feet_ik=True, hands_fk=True)
    for side in ("l", "r"):
        foot = target.pose.bones[f"c_foot_ik.{side}"]
        hand = target.pose.bones[f"c_hand_ik.{side}"]
        for frame in (start, end):
            for bone in (foot, hand):
                bone.keyframe_insert('["ik_fk_switch"]', frame=frame, group=bone.name)
                bone.keyframe_insert('["auto_stretch"]', frame=frame, group=bone.name)


def keyed_bones(action):
    names = set()
    for curve in action_curves(action):
        if curve.data_path.startswith('pose.bones["'):
            names.add(curve.data_path.split('"', 2)[1])
    return names


def validate_control_action(action):
    allowed = TARGET_CONTROLS | POLE_CONTROLS | SWITCH_CONTROLS
    keyed = keyed_bones(action)
    unexpected = sorted(keyed - allowed)
    if unexpected:
        raise RuntimeError(f"Retarget keys non-whitelisted controls: {unexpected}")
    for hand in ("c_hand_fk.l", "c_hand_fk.r"):
        if hand in keyed:
            raise RuntimeError(f"Unobservable hand control was keyed: {hand}")
    for curve in action_curves(action):
        if any(f'pose.bones["{name}"]' in curve.data_path for name in ("c_hand_ik.l", "c_hand_ik.r")):
            if not (
                curve.data_path.endswith('["ik_fk_switch"]')
                or curve.data_path.endswith('["auto_stretch"]')
            ):
                raise RuntimeError(f"Opposite arm IK chain was animated: {curve.data_path}")
    return sorted(keyed)


def deform_snapshots(rig, action, frames):
    assign_action(rig, action)
    deform = [bone.name for bone in rig.data.bones if bone.use_deform]
    snapshots = []
    for frame in frames:
        bpy.context.scene.frame_set(frame)
        bpy.context.view_layer.update()
        inverse_root = rig.pose.bones["c_root_master.x"].matrix.inverted_safe()
        snapshots.append({
            name: tuple(value for row in (inverse_root @ rig.pose.bones[name].matrix) for value in row)
            for name in deform
        })
    return snapshots


def maximum_snapshot_error(left, right):
    maximum = (0.0, -1, "")
    for frame_index, (left_frame, right_frame) in enumerate(zip(left, right)):
        for name in left_frame:
            error = max(abs(a - b) for a, b in zip(left_frame[name], right_frame[name]))
            if error > maximum[0]:
                maximum = (error, frame_index + 1, name)
    return maximum


def root_net_distance(rig, action, start, end):
    assign_action(rig, action)
    points = []
    for frame in (start, end):
        bpy.context.scene.frame_set(frame)
        bpy.context.view_layer.update()
        points.append(rig.matrix_world @ rig.pose.bones["c_root_master.x"].head)
    delta = points[1] - points[0]
    return math.hypot(delta.x, delta.y)


def validate_action_self_containment(rig, action, frames, expected_snapshots):
    rig.animation_data.action = None
    set_limb_mode(rig, feet_ik=False, hands_fk=False)
    assign_action(rig, action)
    replayed = deform_snapshots(rig, action, frames)
    error, frame, bone = maximum_snapshot_error(expected_snapshots, replayed)
    return {
        "maximumDeformMatrixComponentError": error,
        "maximumErrorFrame": frame,
        "maximumErrorBone": bone,
        "oppositeAmbientStateRejected": error <= 1e-6,
        "pass": error <= 1e-6,
    }


def retime_action(action, start, end):
    scale = OUTPUT_FPS / SOURCE_FPS
    output_end = (end - start) * scale
    if abs(output_end - round(output_end)) > 1e-8:
        raise RuntimeError(f"{action.name} cannot retime to integer 30 fps bounds")
    for curve in action_curves(action):
        for point in curve.keyframe_points:
            point.co.x = (point.co.x - start) * scale
            point.handle_left.x = (point.handle_left.x - start) * scale
            point.handle_right.x = (point.handle_right.x - start) * scale
            point.interpolation = "LINEAR"
    action.use_frame_range = True
    action.frame_start = 0
    action.frame_end = int(round(output_end))
    return int(round(output_end))


def remove_source(source, actions):
    if source.animation_data:
        source.animation_data.action = None
    bpy.data.objects.remove(source, do_unlink=True)
    for action in actions:
        if action and bpy.data.actions.get(action.name) == action:
            bpy.data.actions.remove(action)


def configure_export(scene, actions):
    scene.render.fps = OUTPUT_FPS
    scene.render.fps_base = 1.0
    scene.arp_export_format_copy = "GLTF"
    scene.arp_engine_type = "OTHERS"
    scene.arp_export_rig_type = "HUMANOID"
    scene.arp_bake_anim = True
    scene.arp_bake_type = "ACTIONS"
    scene.arp_frame_range_type = "FULL"
    scene.arp_bake_only_active = False
    scene.arp_bake_only_active_slot = True
    scene.arp_simplify_fac = 0.0
    scene.arp_ge_bake_sample = 1.0
    scene.arp_ge_gltf_format = "GLB"
    scene.arp_ge_gltf_all_inf = False
    scene.arp_ge_gltf_sample_anim = True
    scene.arp_ge_gltf_export_frame_step = 1
    scene.arp_ge_gltf_anim_start_zero = True
    scene.arp_ge_reset_transforms = True
    scene.arp_export_noparent = False
    scene.arp_export_act_name = "NONE"
    scene.arp_export_use_actlist = True
    scene.arp_export_separate_fbx = False
    scene.arp_export_actlist.clear()
    action_list = scene.arp_export_actlist.add()
    action_list.name = "Ashveil_Game_Loops"
    action_list.exportable = True
    for action in bpy.data.actions:
        action["arp_export"] = action in actions
    for action in actions:
        item = action_list.actions.add()
        item.action = action


def parse_glb(path):
    data = path.read_bytes()
    if data[:4] != b"glTF":
        raise RuntimeError("ARP export is not a GLB")
    json_length = struct.unpack_from("<I", data, 12)[0]
    document = json.loads(data[20:20 + json_length].decode("utf-8"))
    accessors = document.get("accessors", [])
    animations = []
    for animation in document.get("animations", []):
        inputs = [accessors[sampler["input"]] for sampler in animation.get("samplers", [])]
        animations.append({
            "name": animation.get("name", ""),
            "startSeconds": min((item.get("min", [0])[0] for item in inputs), default=0),
            "endSeconds": max((item.get("max", [0])[0] for item in inputs), default=0),
            "maximumSamples": max((item.get("count", 0) for item in inputs), default=0),
        })
    joint_indices = sorted({joint for skin in document.get("skins", []) for joint in skin.get("joints", [])})
    nodes = document.get("nodes", [])
    joint_names = [nodes[index].get("name", "") for index in joint_indices]
    return {
        "animations": animations,
        "skins": len(document.get("skins", [])),
        "joints": len(joint_indices),
        "jointNames": joint_names,
        "controlJoints": sorted(name for name in joint_names if name.startswith("c_")),
    }


def artifact(path):
    return {"path": path.name, "sha256": sha256(path), "bytes": path.stat().st_size}


def main():
    args = parse_args()
    source_directory = Path(args.source).resolve()
    source_report_path = Path(args.source_report).resolve()
    map_path = Path(args.map).resolve()
    output = Path(args.output).resolve()
    output.mkdir(parents=True, exist_ok=True)
    if sha256(map_path) != EXPECTED_MAP_SHA256:
        raise RuntimeError("Frozen MoMask-to-ARP map hash changed")
    source_report = json.loads(source_report_path.read_text(encoding="utf-8"))
    if source_report.get("retargetReady") is not True:
        raise RuntimeError("Source report is not retarget-ready")
    source_by_id = {clip["id"]: clip for clip in source_report["clips"]}
    for clip_id, _ in CLIPS:
        if source_by_id[clip_id].get("sourceMotion", {}).get("pass") is not True:
            raise RuntimeError(f"{clip_id} sourceMotion.pass is not true")

    installation = arp_installation()
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
    state_before = target_state(target, meshes)
    clear_animation(target)

    actions = []
    clip_reports = []
    for clip_id, output_name in CLIPS:
        motion = source_by_id[clip_id]["sourceMotion"]
        frames = int(motion["frames"])
        source, source_action = import_source(source_directory / motion["path"], clip_id, frames)
        configure_remap(source, source_action, target, map_path)
        target.animation_data.action = None
        set_limb_mode(target, feet_ik=True, hands_fk=True)
        target_action = retarget(source, source_action, target, frames)
        target_action.name = output_name
        key_limb_mode(target, target_action, 1, frames)
        keyed = validate_control_action(target_action)
        snapshots = deform_snapshots(target, target_action, range(1, frames + 1))
        target_root_distance = root_net_distance(target, target_action, 1, frames)
        self_containment = validate_action_self_containment(
            target,
            target_action,
            range(1, frames + 1),
            snapshots,
        )
        skeletal_pass = target_root_distance <= 0.001 and self_containment["pass"]
        if not skeletal_pass:
            raise RuntimeError(
                f"{clip_id} skeletal gate failed: root net {target_root_distance}, "
                f"self-containment {self_containment}"
            )
        output_end = retime_action(target_action, 1, frames)
        actions.append(target_action)
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
            "sourceAlreadyInPlace": True,
            "retargetBakeCount": 1,
            "targetRootNetHorizontalDistanceMetres": target_root_distance,
            "actionSelfContainment": self_containment,
            "sourceMotionGatePass": True,
            "targetMeshContactMeasured": False,
            "terminalPalmRollObservable": False,
            "keyedControls": keyed,
            "pass": skeletal_pass,
        })
        remove_source(source, [source_action])
        if "rest_transf_offset" in bpy.context.scene:
            del bpy.context.scene["rest_transf_offset"]

    state_after = target_state(target, meshes)
    target_unchanged = state_before == state_after
    if not target_unchanged:
        raise RuntimeError("Retarget changed accepted target rest, geometry, weights, or modifiers")
    configure_export(bpy.context.scene, actions)
    assign_action(target, actions[0])
    blend_path = output / "masculine-auto-rig-pro-retarget.blend"
    glb_path = output / "masculine-auto-rig-pro-retarget-diagnostic.glb"
    bpy.context.scene.frame_start = 0
    bpy.context.scene.frame_end = int(max(action.frame_end for action in actions))
    bpy.ops.wm.save_as_mainfile(filepath=str(blend_path))
    select([target, *meshes], target)
    result = bpy.ops.arp.arp_export_gltf_panel(
        "EXEC_DEFAULT",
        filepath=str(glb_path),
        quick_export=True,
    )
    if result != {"FINISHED"} or not glb_path.exists():
        raise RuntimeError(f"ARP GLB export failed: {result}")
    glb = parse_glb(glb_path)
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
    runtime_inventory_pass = not glb["controlJoints"]
    report = {
        "schemaVersion": "ashveil.auto-rig-pro-retarget.v1",
        "status": "diagnostic_not_production_ready",
        "sourceMotion": {
            "pass": True,
            "reportSha256": sha256(source_report_path),
            "clips": [
                {"id": clip["id"], "path": clip["sourcePath"], "sha256": clip["sourceSha256"]}
                for clip in clip_reports
            ],
        },
        "mapping": {
            "path": map_path.name,
            "sha256": sha256(map_path),
            "mappedTargetCount": len(TARGET_CONTROLS),
            "unmappedSourceBones": ["Spine", "LeftHand", "RightHand"],
            "terminalHandsUseAcceptedBindRoll": True,
            "pass": True,
        },
        "autoRigPro": installation,
        "target": {
            "object": target.name,
            "before": state_before,
            "after": state_after,
            "unchanged": target_unchanged,
        },
        "retargetSkeletal": {
            "clips": clip_reports,
            "handsUnmapped": True,
            "targetRotationsAuthoredByPipeline": False,
            "pass": target_unchanged and all(clip["pass"] for clip in clip_reports),
        },
        "meshDeformation": {
            "measured": False,
            "pass": False,
            "reason": "Skinned contact, slide, penetration, deformation, and silhouette gates require review.",
        },
        "exportParity": {
            "arpExporterOnly": True,
            "clipTimingPass": clip_timing_pass,
            "runtimeInventoryPass": runtime_inventory_pass,
            "blenderGlbSkinnedParityMeasured": False,
            "pass": False,
            "reason": "Per-frame skinned vertex and normal parity remains pending.",
            "gltfStructure": glb,
        },
        "humanReview": {"pass": False, "required": True},
        "productionPass": False,
        "canonicalViewerPromoted": False,
        "artifacts": [artifact(blend_path), artifact(glb_path)],
    }
    (output / "report.json").write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
