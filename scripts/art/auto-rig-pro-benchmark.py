import argparse
import hashlib
import importlib.util
import json
import math
import struct
import sys
import tomllib
from pathlib import Path

import bpy
from mathutils import Matrix, Quaternion, Vector


SEMANTIC_MESHES = (
    "Body",
    "Head",
    "Hand_NegativeX",
    "Hand_PositiveX",
    "Eye_NegativeX",
    "Eye_PositiveX",
    "Facial_Feature_01",
)
POSES = (
    ("bind", 0),
    ("overhead-reach", 10),
    ("cross-body-reach", 20),
    ("deep-elbow-bend", 30),
    ("long-stride", 40),
    ("head-turn", 50),
)
EXPECTED_SOURCE_SHA256 = "375e25dea0da0c8d4267ee4402a64cf4582520341b367e1163730b8f8fc56edb"
EXPECTED_BLEND_SHA256 = "c9212b65a98456dbb2eaa2a51b4347d12ec6571e2162e9eda1592db6e25480c7"
EXPECTED_AI_VERSION = "1.21"
EXPECTED_ARP_VERSION = "3.78.47"
FRAMES_PER_SECOND = 30
STRESS_ACTION_NAME = "Ashveil_ARP_Benchmark"
WALK_ACTION_NAME = "Ashveil_Walk_InPlace"
SPRINT_ACTION_NAME = "Ashveil_Sprint_InPlace"


def parse_args():
    separator = sys.argv.index("--") if "--" in sys.argv else len(sys.argv)
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True)
    parser.add_argument("--output", required=True)
    return parser.parse_args(sys.argv[separator + 1 :])


def sha256(path):
    digest = hashlib.sha256()
    with Path(path).open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def load_pipeline_helpers():
    path = Path(__file__).with_name("character-rig-spike.py")
    spec = importlib.util.spec_from_file_location("ashveil_character_rig_spike", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def arp_installation():
    addon = bpy.context.preferences.addons.get("bl_ext.user_default.auto_rig_pro")
    if addon is None:
        raise RuntimeError("Auto-Rig Pro must be enabled as bl_ext.user_default.auto_rig_pro")
    package = Path(sys.modules[addon.module].__file__).resolve().parent
    manifest = tomllib.loads((package / "blender_manifest.toml").read_text(encoding="utf-8"))
    ai_root = Path(addon.preferences.ai_presets_path)
    ai_version = next(
        line.split("=", 1)[1].strip()
        for line in (ai_root / "info.dat").read_text(encoding="utf-8").splitlines()
        if line.startswith("version=")
    )
    if manifest["version"] != EXPECTED_ARP_VERSION or ai_version != EXPECTED_AI_VERSION:
        raise RuntimeError(
            f"Expected Auto-Rig Pro {EXPECTED_ARP_VERSION} with AI {EXPECTED_AI_VERSION}, "
            f"found {manifest['version']} with AI {ai_version}"
        )
    return {
        "extensionModule": addon.module,
        "addonVersion": manifest["version"],
        "aiVersion": ai_version,
        "manifestSha256": sha256(package / "blender_manifest.toml"),
    }


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


def validate_live_session():
    scene = bpy.context.scene
    if (
        scene.get("ashveil_arp_session_phase") != "reference_rig_detected"
        or scene.get("ashveil_source_sha256") != EXPECTED_SOURCE_SHA256
        or scene.get("ashveil_prepared_blend_sha256") != EXPECTED_BLEND_SHA256
    ):
        raise RuntimeError("Blend is not an Ashveil ARP Smart marker session")
    rigs = [
        obj
        for obj in bpy.data.objects
        if obj.type == "ARMATURE" and "arp_rig_type" in obj.keys()
    ]
    if len(rigs) != 1:
        raise RuntimeError(
            "Live phase must run Guess Markers and Go, then save exactly one ARP reference rig"
        )
    if bpy.data.objects.get("body_temp") is not None:
        raise RuntimeError("ARP Smart detection is incomplete; body_temp still exists")
    return rigs[0]


def match_and_bind(rig, meshes):
    already_bound = rig.data.get("has_match_to_rig") is True and all(
        any(modifier.type == "ARMATURE" and modifier.object == rig for modifier in mesh.modifiers)
        for mesh in meshes
    )
    if already_bound:
        return {"matchOperatorResult": ["REUSED"], "bindOperatorResult": ["REUSED"]}
    select([rig], rig)
    match_result = bpy.ops.arp.match_to_rig("EXEC_DEFAULT")
    if match_result != {"FINISHED"} or rig.data.get("has_match_to_rig") is not True:
        raise RuntimeError(f"Auto-Rig Pro Match to Rig failed: {match_result}")
    scene = bpy.context.scene
    scene.arp_bind_engine = "HEAT_MAP"
    scene.arp_bind_split = False
    scene.arp_bind_scale_fix = False
    select([*meshes, rig], rig)
    bind_result = bpy.ops.arp.bind_to_rig("EXEC_DEFAULT")
    if bind_result != {"FINISHED"}:
        raise RuntimeError(f"Auto-Rig Pro Bind to Rig failed: {bind_result}")
    missing = [
        mesh.name
        for mesh in meshes
        if not any(modifier.type == "ARMATURE" and modifier.object == rig for modifier in mesh.modifiers)
    ]
    if missing:
        raise RuntimeError(f"Auto-Rig Pro did not bind semantic meshes: {missing}")
    return {"matchOperatorResult": sorted(match_result), "bindOperatorResult": sorted(bind_result)}


def inventory(rig):
    bones = list(rig.data.bones)
    deform = sorted(bone.name for bone in bones if bone.use_deform)
    controls = sorted(bone.name for bone in bones if bone.name.startswith("c_"))
    names = {bone.name for bone in bones}
    roles = {
        "clavicle": all(f"shoulder.{side}" in names for side in ("l", "r")),
        "scapula": all(any("scap" in name.lower() and name.endswith(f".{side}") for name in names) for side in ("l", "r")),
        "upperArm": all(f"arm.{side}" in names for side in ("l", "r")),
        "forearm": all(f"forearm.{side}" in names for side in ("l", "r")),
        "upperArmTwist": all(f"arm_twist.{side}" in names for side in ("l", "r")),
        "forearmTwist": all(f"forearm_twist.{side}" in names for side in ("l", "r")),
        "hand": all(f"hand.{side}" in names for side in ("l", "r")),
    }
    return {
        "totalBones": len(bones),
        "deformBoneCount": len(deform),
        "controlBoneCount": len(controls),
        "deformBones": deform,
        "controlBones": controls,
        "rolePresence": roles,
        "scapulaRequirementPass": roles["scapula"],
    }


def classify_exported_arp_rig(rig, glb_structure):
    joint_names = glb_structure["jointNames"]
    deform_names = {bone.name for bone in rig.data.bones if bone.use_deform}
    controls = sorted(name for name in joint_names if name.startswith("c_"))
    references = sorted(name for name in joint_names if "_ref." in name)
    deform_flagged = sorted(name for name in joint_names if name in deform_names)
    deform_only = sorted(
        name for name in joint_names if name in deform_names and name not in controls and name not in references
    )
    classified = set(controls + references + deform_only)
    mechanisms = sorted(name for name in joint_names if name not in classified)
    full_authoring_rig = len(joint_names) == len(rig.data.bones) and bool(controls) and bool(mechanisms)
    return {
        "fullAuthoringRigExported": full_authoring_rig,
        "runtimeReductionPending": True,
        "runtimeClean": False,
        "classificationRule": "exclusive precedence: c_ controls; *_ref.* references; deform-only; remainder mechanisms",
        "jointCount": len(joint_names),
        "deformFlaggedJointCount": len(deform_flagged),
        "deformOnlyJointCount": len(deform_only),
        "controlJointCount": len(controls),
        "referenceJointCount": len(references),
        "mechanismJointCount": len(mechanisms),
        "deformFlaggedJoints": deform_flagged,
        "deformOnlyJoints": deform_only,
        "controlJoints": controls,
        "referenceJoints": references,
        "mechanismJoints": mechanisms,
    }


def weight_report(meshes, rig):
    deform = {bone.name for bone in rig.data.bones if bone.use_deform}
    weighted = 0
    maximum_influences = 0
    maximum_normalization_error = 0.0
    finite = True
    vertices = 0
    for obj in meshes:
        for vertex in obj.data.vertices:
            vertices += 1
            values = [
                element.weight
                for element in vertex.groups
                if obj.vertex_groups[element.group].name in deform and element.weight > 1e-8
            ]
            total = sum(values)
            weighted += int(bool(values))
            maximum_influences = max(maximum_influences, len(values))
            maximum_normalization_error = max(maximum_normalization_error, abs(1.0 - total))
            finite = finite and all(math.isfinite(value) for value in values)
    return {
        "vertices": vertices,
        "weightedVertices": weighted,
        "maximumInfluences": maximum_influences,
        "maximumNormalizationError": maximum_normalization_error,
        "finite": finite,
        "normalized": maximum_normalization_error <= 1e-4,
        "pass": weighted == vertices
        and maximum_influences <= 4
        and maximum_normalization_error <= 1e-4
        and finite,
    }


def cap_and_normalize_deform_weights(meshes, rig, maximum_influences=4):
    deform = {bone.name for bone in rig.data.bones if bone.use_deform}
    before = weight_report(meshes, rig)
    for obj in meshes:
        for vertex in obj.data.vertices:
            weighted_groups = [
                (element.group, element.weight)
                for element in vertex.groups
                if obj.vertex_groups[element.group].name in deform and element.weight > 1e-8
            ]
            weighted_groups.sort(key=lambda item: (-item[1], item[0]))
            retained = weighted_groups[:maximum_influences]
            total = sum(weight for _, weight in retained)
            if total <= 1e-8:
                continue
            retained_indices = {group for group, _ in retained}
            for group, _ in weighted_groups:
                if group not in retained_indices:
                    obj.vertex_groups[group].remove([vertex.index])
            for group, weight in retained:
                obj.vertex_groups[group].add([vertex.index], weight / total, "REPLACE")
        obj.data.update()
        for modifier in obj.modifiers:
            if modifier.type == "ARMATURE" and modifier.object == rig:
                modifier.use_deform_preserve_volume = False
    after = weight_report(meshes, rig)
    return {
        **after,
        "sourceMaximumInfluences": before["maximumInfluences"],
        "sourceMaximumNormalizationError": before["maximumNormalizationError"],
        "maximumAllowedInfluences": maximum_influences,
        "preserveVolume": False,
    }


def reset_controls(rig):
    for pose_bone in rig.pose.bones:
        pose_bone.matrix_basis = Matrix.Identity(4)
    for side in ("l", "r"):
        hand_ik = rig.pose.bones.get(f"c_hand_ik.{side}")
        foot_ik = rig.pose.bones.get(f"c_foot_ik.{side}")
        if hand_ik and "ik_fk_switch" in hand_ik:
            hand_ik["ik_fk_switch"] = 1.0
        if foot_ik and "ik_fk_switch" in foot_ik:
            foot_ik["ik_fk_switch"] = 1.0
    bpy.context.view_layer.update()


def rotate_control_world(rig, name, axis, degrees):
    pose_bone = rig.pose.bones.get(name)
    if pose_bone is None:
        return False
    pivot = pose_bone.head.copy()
    rotation = Quaternion(Vector(axis).normalized(), math.radians(degrees)).to_matrix().to_4x4()
    pose_bone.matrix = Matrix.Translation(pivot) @ rotation @ Matrix.Translation(-pivot) @ pose_bone.matrix
    return True


def rotate_control_local_axis(rig, name, axis_index, degrees):
    pose_bone = rig.pose.bones.get(name)
    if pose_bone is None:
        return False
    axis = pose_bone.matrix.to_3x3().col[axis_index].normalized()
    return rotate_control_world(rig, name, axis, degrees)


def chest_frame(rig):
    basis = rig.pose.bones["c_spine_02.x"].matrix.to_3x3()
    return {
        "lateral": basis.col[0].normalized(),
        "up": basis.col[1].normalized(),
        "forward": basis.col[2].normalized(),
    }


def chest_direction(frame, lateral=0.0, forward=0.0, up=0.0):
    return (
        frame["lateral"] * lateral
        + frame["forward"] * forward
        + frame["up"] * up
    ).normalized()


def orient_control_y_z(rig, name, primary_y, transported_z):
    pose_bone = rig.pose.bones.get(name)
    if pose_bone is None:
        return False
    y_axis = Vector(primary_y).normalized()
    z_axis = Vector(transported_z) - y_axis * Vector(transported_z).dot(y_axis)
    if z_axis.length < 1e-6:
        raise RuntimeError(f"Transported hinge is degenerate for {name}")
    z_axis.normalize()
    x_axis = y_axis.cross(z_axis).normalized()
    rotation = Matrix((x_axis, y_axis, z_axis)).transposed().to_4x4()
    pose_bone.matrix = Matrix.Translation(pose_bone.head.copy()) @ rotation
    bpy.context.view_layer.update()
    return True


def key_control_state(rig, frame):
    for pose_bone in rig.pose.bones:
        if not pose_bone.name.startswith("c_"):
            continue
        pose_bone.keyframe_insert("location", frame=frame, group=pose_bone.name)
        if pose_bone.rotation_mode == "QUATERNION":
            pose_bone.keyframe_insert("rotation_quaternion", frame=frame, group=pose_bone.name)
        elif pose_bone.rotation_mode == "AXIS_ANGLE":
            pose_bone.keyframe_insert("rotation_axis_angle", frame=frame, group=pose_bone.name)
        else:
            pose_bone.keyframe_insert("rotation_euler", frame=frame, group=pose_bone.name)
        pose_bone.keyframe_insert("scale", frame=frame, group=pose_bone.name)
        for property_name in ("ik_fk_switch", "auto_stretch"):
            if property_name in pose_bone:
                pose_bone.keyframe_insert(f'["{property_name}"]', frame=frame, group=pose_bone.name)


def set_action_interpolation(action, interpolation):
    curves = []
    if hasattr(action, "fcurves"):
        curves.extend(action.fcurves)
    else:
        for layer in action.layers:
            for strip in layer.strips:
                for channel_bag in strip.channelbags:
                    curves.extend(channel_bag.fcurves)
    for fcurve in curves:
        for point in fcurve.keyframe_points:
            point.interpolation = interpolation


def configure_scene_timing(scene, start=0, end=50):
    scene.render.fps = FRAMES_PER_SECOND
    scene.render.fps_base = 1.0
    scene.frame_start = start
    scene.frame_end = end


def remove_generated_actions():
    for name in (STRESS_ACTION_NAME, WALK_ACTION_NAME, SPRINT_ACTION_NAME):
        action = bpy.data.actions.get(name)
        if action is not None:
            bpy.data.actions.remove(action)


def author_diagnostic_action(rig):
    action = bpy.data.actions.new(STRESS_ACTION_NAME)
    action.use_fake_user = True
    action["ashveil_clip_kind"] = "diagnostic_stress_poses"
    action["ashveil_fps"] = FRAMES_PER_SECOND
    rig.animation_data_create()
    rig.animation_data.action = action
    authored = []
    required_by_pose = {
        "overhead-reach": ["c_shoulder.l", "c_shoulder.r", "c_arm_fk.l", "c_arm_fk.r"],
        "cross-body-reach": ["c_shoulder.l", "c_arm_fk.l", "c_forearm_fk.l"],
        "deep-elbow-bend": ["c_forearm_fk.l", "c_hand_fk.l"],
        "long-stride": ["c_thigh_fk.l", "c_thigh_fk.r", "c_leg_fk.l", "c_leg_fk.r"],
        "head-turn": ["c_head.x"],
    }
    for pose_name, frame in POSES:
        bpy.context.scene.frame_set(frame)
        reset_controls(rig)
        local_frame = chest_frame(rig)
        applied = []
        if pose_name == "overhead-reach":
            for side, sign in (("l", 1), ("r", -1)):
                shoulder = f"c_shoulder.{side}"
                arm = f"c_arm_fk.{side}"
                forearm = f"c_forearm_fk.{side}"
                if rotate_control_local_axis(rig, shoulder, 0, 15):
                    applied.append(shoulder)
                hinge = rig.pose.bones[arm].matrix.to_3x3().col[2].normalized()
                arm_target = chest_direction(local_frame, lateral=0.18 * sign, forward=0.12, up=0.976)
                if orient_control_y_z(rig, arm, arm_target, hinge):
                    applied.append(arm)
                transported_hinge = rig.pose.bones[arm].matrix.to_3x3().col[2].normalized()
                forearm_target = chest_direction(local_frame, lateral=0.08 * sign, forward=0.18, up=0.980)
                if orient_control_y_z(rig, forearm, forearm_target, transported_hinge):
                    applied.append(forearm)
                orient_control_y_z(rig, f"c_hand_fk.{side}", forearm_target, transported_hinge)
        elif pose_name == "cross-body-reach":
            if rotate_control_local_axis(rig, "c_shoulder.l", 2, 12):
                applied.append("c_shoulder.l")
            hinge = rig.pose.bones["c_arm_fk.l"].matrix.to_3x3().col[2].normalized()
            arm_target = chest_direction(local_frame, lateral=-0.62, forward=0.72, up=-0.30)
            if orient_control_y_z(rig, "c_arm_fk.l", arm_target, hinge):
                applied.append("c_arm_fk.l")
            transported_hinge = rig.pose.bones["c_arm_fk.l"].matrix.to_3x3().col[2].normalized()
            forearm_target = chest_direction(local_frame, lateral=-0.43, forward=0.86, up=0.28)
            if orient_control_y_z(rig, "c_forearm_fk.l", forearm_target, transported_hinge):
                applied.append("c_forearm_fk.l")
            orient_control_y_z(rig, "c_hand_fk.l", forearm_target, transported_hinge)
        elif pose_name == "deep-elbow-bend":
            arm_target = chest_direction(local_frame, lateral=0.54, forward=0.42, up=-0.73)
            hinge = rig.pose.bones["c_arm_fk.l"].matrix.to_3x3().col[2].normalized()
            if orient_control_y_z(rig, "c_arm_fk.l", arm_target, hinge):
                applied.append("c_arm_fk.l")
            transported_hinge = rig.pose.bones["c_arm_fk.l"].matrix.to_3x3().col[2].normalized()
            forearm_target = Quaternion(transported_hinge, math.radians(-127.5)) @ arm_target
            if orient_control_y_z(rig, "c_forearm_fk.l", forearm_target, transported_hinge):
                applied.append("c_forearm_fk.l")
            if orient_control_y_z(rig, "c_hand_fk.l", forearm_target, transported_hinge):
                applied.append("c_hand_fk.l")
        elif pose_name == "long-stride":
            for side, sign in (("l", 1), ("r", -1)):
                applied += [name for name, ok in (
                    (f"c_thigh_fk.{side}", rotate_control_world(rig, f"c_thigh_fk.{side}", (1, 0, 0), sign * 34)),
                    (f"c_leg_fk.{side}", rotate_control_world(rig, f"c_leg_fk.{side}", (1, 0, 0), -sign * 24)),
                ) if ok]
        elif pose_name == "head-turn":
            if rotate_control_local_axis(rig, "c_head.x", 1, 32):
                applied.append("c_head.x")
        bpy.context.view_layer.update()
        key_control_state(rig, frame)
        missing = [name for name in required_by_pose.get(pose_name, []) if name not in rig.pose.bones]
        authored.append(
            {
                "name": pose_name,
                "frame": frame,
                "authoredControls": applied,
                "missingRequiredControls": missing,
                "feasible": not missing,
                "humanReviewRequired": pose_name != "bind",
            }
        )
    set_action_interpolation(action, "CONSTANT")
    return action, authored


def translate_control(rig, name, translation):
    pose_bone = rig.pose.bones.get(name)
    if pose_bone is None:
        return False
    local_translation = pose_bone.bone.matrix_local.to_3x3().inverted() @ Vector(translation)
    pose_bone.location += local_translation
    bpy.context.view_layer.update()
    return True


def set_locomotion_switches(rig):
    for side in ("l", "r"):
        foot = rig.pose.bones[f"c_foot_ik.{side}"]
        hand = rig.pose.bones[f"c_hand_ik.{side}"]
        foot["ik_fk_switch"] = 0.0
        foot["auto_stretch"] = 0.0
        hand["ik_fk_switch"] = 1.0


def action_control_matrix(rig, action, control, frame):
    rig.animation_data.action = action
    bpy.context.scene.frame_set(frame)
    bpy.context.view_layer.update()
    return rig.pose.bones[control].matrix.copy()


def matrix_difference(first, second):
    translation = (first.translation - second.translation).length
    rotation = math.degrees(first.to_quaternion().rotation_difference(second.to_quaternion()).angle)
    scale = max(abs(value - 1.0) for value in second.to_scale())
    return translation, rotation, scale


def locomotion_clip_report(rig, action, frames, contacts, minimum_clearance):
    controls = ("c_traj", "c_root_master.x", "c_root.x", "c_foot_ik.l", "c_foot_ik.r")
    start = frames[0]
    end = frames[-1]
    endpoint_differences = [
        matrix_difference(
            action_control_matrix(rig, action, control, start),
            action_control_matrix(rig, action, control, end),
        )
        for control in controls
    ]
    trajectory_start = action_control_matrix(rig, action, "c_traj", start)
    trajectory_end = action_control_matrix(rig, action, "c_traj", end)
    trajectory_translation, trajectory_rotation, _ = matrix_difference(trajectory_start, trajectory_end)
    foot_positions = {side: [] for side in ("l", "r")}
    for frame in frames:
        rig.animation_data.action = action
        bpy.context.scene.frame_set(frame)
        bpy.context.view_layer.update()
        for side in ("l", "r"):
            foot_positions[side].append(rig.pose.bones[f"foot.{side}"].head.copy())
    deform_foot_travel = {
        side: max((point - foot_positions[side][0]).length for point in foot_positions[side])
        for side in ("l", "r")
    }
    control_loop_pass = max(item[0] for item in endpoint_differences) <= 0.0001 \
        and max(item[1] for item in endpoint_differences) <= 0.1 \
        and trajectory_translation <= 0.0001 \
        and trajectory_rotation <= 0.1 \
        and min(deform_foot_travel.values()) >= 0.05
    return {
        "name": action.name,
        "framesPerSecond": bpy.context.scene.render.fps / bpy.context.scene.render.fps_base,
        "frameStart": start,
        "frameEnd": end,
        "sampleCount": end - start + 1,
        "durationSeconds": (end - start) / (bpy.context.scene.render.fps / bpy.context.scene.render.fps_base),
        "explicitLoopDuplicateEndpoint": True,
        "contactSchedule": contacts,
        "minimumAuthoredSwingClearanceMetres": minimum_clearance,
        "maximumLoopEndpointTranslationErrorMetres": max(item[0] for item in endpoint_differences),
        "maximumLoopEndpointRotationErrorDegrees": max(item[1] for item in endpoint_differences),
        "maximumScaleDeviation": max(item[2] for item in endpoint_differences),
        "trajectoryNetTranslationMetres": trajectory_translation,
        "trajectoryNetRotationDegrees": trajectory_rotation,
        "evaluatedDeformFootTravelMetres": deform_foot_travel,
        "measurementSpace": "evaluated_auto_rig_pro_control_and_deform_bone_matrices",
        "controlAuthoringPass": control_loop_pass,
        "productionLocomotionPass": False,
    }


def author_locomotion_action(rig, name, schedule, contacts, minimum_clearance):
    action = bpy.data.actions.new(name)
    action.use_fake_user = True
    action["ashveil_clip_kind"] = "in_place_locomotion"
    action["ashveil_fps"] = FRAMES_PER_SECOND
    action["ashveil_loop_duplicate_endpoint"] = True
    rig.animation_data_create()
    rig.animation_data.action = action
    local_frame = chest_frame(rig)
    for sample in schedule:
        frame = sample["frame"]
        bpy.context.scene.frame_set(frame)
        reset_controls(rig)
        set_locomotion_switches(rig)
        for side in ("l", "r"):
            forward, lift = sample[side]
            displacement = local_frame["forward"] * forward + local_frame["up"] * lift
            translate_control(rig, f"c_foot_ik.{side}", displacement)
            translate_control(rig, f"c_leg_pole.{side}", local_frame["forward"] * forward * 0.35)
        translate_control(rig, "c_root.x", local_frame["up"] * sample["body"])
        rotate_control_local_axis(rig, "c_arm_fk.l", 2, sample["arm"])
        rotate_control_local_axis(rig, "c_arm_fk.r", 2, -sample["arm"])
        key_control_state(rig, frame)
    set_action_interpolation(action, "LINEAR")
    return action, locomotion_clip_report(
        rig,
        action,
        [sample["frame"] for sample in schedule],
        contacts,
        minimum_clearance,
    )


def author_locomotion_actions(rig):
    walk_schedule = [
        {"frame": 0, "l": (-0.12, 0.0), "r": (0.12, 0.03), "body": -0.010, "arm": -22},
        {"frame": 4, "l": (-0.12, 0.0), "r": (0.05, 0.06), "body": -0.004, "arm": -12},
        {"frame": 8, "l": (-0.12, 0.0), "r": (-0.03, 0.08), "body": 0.006, "arm": 2},
        {"frame": 11, "l": (-0.12, 0.005), "r": (-0.08, 0.04), "body": 0.001, "arm": 14},
        {"frame": 15, "l": (0.12, 0.03), "r": (-0.12, 0.0), "body": -0.010, "arm": 22},
        {"frame": 19, "l": (0.05, 0.06), "r": (-0.12, 0.0), "body": -0.004, "arm": 12},
        {"frame": 23, "l": (-0.03, 0.08), "r": (-0.12, 0.0), "body": 0.006, "arm": -2},
        {"frame": 26, "l": (-0.08, 0.04), "r": (-0.12, 0.005), "body": 0.001, "arm": -14},
        {"frame": 30, "l": (-0.12, 0.0), "r": (0.12, 0.03), "body": -0.010, "arm": -22},
    ]
    sprint_schedule = [
        {"frame": 0, "l": (-0.16, 0.0), "r": (0.16, 0.06), "body": -0.025, "arm": -34},
        {"frame": 2, "l": (-0.16, 0.0), "r": (0.10, 0.07), "body": -0.045, "arm": -25},
        {"frame": 5, "l": (-0.16, 0.04), "r": (0.00, 0.11), "body": 0.015, "arm": -5},
        {"frame": 7, "l": (0.12, 0.12), "r": (-0.12, 0.10), "body": 0.045, "arm": 24},
        {"frame": 9, "l": (0.16, 0.06), "r": (-0.16, 0.0), "body": -0.025, "arm": 34},
        {"frame": 11, "l": (0.10, 0.07), "r": (-0.16, 0.0), "body": -0.045, "arm": 25},
        {"frame": 14, "l": (0.00, 0.11), "r": (-0.16, 0.04), "body": 0.015, "arm": 5},
        {"frame": 16, "l": (-0.12, 0.10), "r": (0.12, 0.12), "body": 0.045, "arm": -24},
        {"frame": 18, "l": (-0.16, 0.0), "r": (0.16, 0.06), "body": -0.025, "arm": -34},
    ]
    walk_contacts = [
        {"frame": 0, "phase": "left_contact"},
        {"frame": 4, "phase": "down"},
        {"frame": 8, "phase": "pass"},
        {"frame": 11, "phase": "up_toeoff"},
        {"frame": 15, "phase": "right_contact"},
        {"frame": 19, "phase": "down"},
        {"frame": 23, "phase": "pass"},
        {"frame": 26, "phase": "up"},
        {"frame": 30, "phase": "loop_duplicate"},
    ]
    sprint_contacts = [
        {"frame": 0, "phase": "left_contact"},
        {"frame": 2, "phase": "compression"},
        {"frame": 5, "phase": "pass_takeoff"},
        {"frame": 7, "phase": "flight"},
        {"frame": 9, "phase": "right_contact"},
        {"frame": 11, "phase": "compression"},
        {"frame": 14, "phase": "pass"},
        {"frame": 16, "phase": "flight"},
        {"frame": 18, "phase": "loop_duplicate"},
    ]
    _, walk = author_locomotion_action(rig, WALK_ACTION_NAME, walk_schedule, walk_contacts, 0.08)
    _, sprint = author_locomotion_action(rig, SPRINT_ACTION_NAME, sprint_schedule, sprint_contacts, 0.12)
    return [walk, sprint]


def bone_direction(rig, name):
    bone = rig.pose.bones[name]
    return (bone.tail - bone.head).normalized()


def stress_pose_identity(rig, action):
    rig.animation_data.action = action
    bpy.context.scene.frame_set(0)
    bpy.context.view_layer.update()
    bind_legs = {side: bone_direction(rig, f"thigh.{side}") for side in ("l", "r")}
    bind_head = rig.pose.bones["c_head.x"].matrix.to_quaternion().normalized()
    records = []
    for pose_name, frame in POSES:
        bpy.context.scene.frame_set(frame)
        bpy.context.view_layer.update()
        local_frame = chest_frame(rig)
        record = {"name": pose_name, "namedFrame": frame, "evaluatedFrame": bpy.context.scene.frame_current}
        if pose_name == "overhead-reach":
            elevations = {
                side: bone_direction(rig, f"arm.{side}").dot(local_frame["up"])
                for side in ("l", "r")
            }
            record.update({"upperArmUpDots": elevations, "pass": min(elevations.values()) >= 0.70})
        elif pose_name == "cross-body-reach":
            forward_dots = {
                segment: bone_direction(rig, segment).dot(local_frame["forward"])
                for segment in ("arm.l", "forearm.l")
            }
            record.update({"forwardDots": forward_dots, "pass": min(forward_dots.values()) >= 0.25})
        elif pose_name == "deep-elbow-bend":
            flexion = math.degrees(bone_direction(rig, "arm.l").angle(bone_direction(rig, "forearm.l")))
            record.update({"elbowFlexionDegrees": flexion, "pass": 120 <= flexion <= 135})
        elif pose_name == "long-stride":
            forward_dots = {
                side: bone_direction(rig, f"thigh.{side}").dot(local_frame["forward"])
                for side in ("l", "r")
            }
            record.update(
                {
                    "thighForwardDots": forward_dots,
                    "pass": forward_dots["l"] * forward_dots["r"] < 0,
                }
            )
        elif pose_name == "head-turn":
            current_head = rig.pose.bones["c_head.x"].matrix.to_quaternion().normalized()
            delta = current_head @ bind_head.inverted()
            axis, angle = delta.to_axis_angle()
            signed_angle = math.degrees(angle) * (1 if axis.dot(local_frame["up"]) >= 0 else -1)
            leg_errors = {
                side: math.degrees(bind_legs[side].angle(bone_direction(rig, f"thigh.{side}")))
                for side in ("l", "r")
            }
            record.update(
                {
                    "headYawDegrees": signed_angle,
                    "legBindDirectionErrorsDegrees": leg_errors,
                    "pass": abs(abs(signed_angle) - 32) <= 1 and max(leg_errors.values()) <= 2,
                }
            )
        else:
            record["pass"] = frame == 0
        record["pass"] = record["pass"] and record["evaluatedFrame"] == record["namedFrame"]
        records.append(record)
    return {
        "measurementSpace": "evaluated_auto_rig_pro_deform_bones_at_named_scene_frames",
        "frameIdentityExact": all(item["namedFrame"] == item["evaluatedFrame"] for item in records),
        "poses": records,
        "pass": all(item["pass"] for item in records),
    }


def glb_animation_metadata(path):
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
    if document is None:
        raise RuntimeError(f"GLB has no JSON document: {path.name}")
    accessors = document.get("accessors", [])
    records = []
    for animation in document.get("animations", []):
        inputs = [accessors[sampler["input"]] for sampler in animation.get("samplers", [])]
        records.append(
            {
                "name": animation.get("name", ""),
                "startSeconds": min(accessor.get("min", [0])[0] for accessor in inputs),
                "endSeconds": max(accessor.get("max", [0])[0] for accessor in inputs),
                "sampleCount": max(accessor.get("count", 0) for accessor in inputs),
            }
        )
    for record in records:
        record["durationSeconds"] = record["endSeconds"] - record["startSeconds"]
    return records


def frozen_regions(input_directory, body):
    report_path = input_directory.parent / "rigged" / "report.json"
    report = json.loads(report_path.read_text(encoding="utf-8"))
    landmarks = {
        joint["name"]: Vector(joint["actualWorld"])
        for joint in report["jointFit"]["joints"]
        if joint["name"].split(".")[0] in {"shoulder", "elbow", "wrist"}
    }
    regions = load_pipeline_helpers().freeze_arm_regions(body, landmarks)
    required = {f"{joint}.{side}" for joint in ("shoulder", "elbow", "wrist") for side in ("L", "R")}
    if {region["name"] for region in regions} != required:
        raise RuntimeError("Canonical rig report does not provide the six frozen arm regions")
    return regions, sha256(report_path)


def deformation_report(body, regions, helpers):
    bpy.context.scene.frame_set(0)
    bpy.context.view_layer.update()
    bind_points = helpers.object_points(body, evaluated=True)
    names_by_pose = {
        "overhead-reach": {"shoulder.L", "shoulder.R"},
        "cross-body-reach": {"shoulder.L", "wrist.L"},
        "deep-elbow-bend": {"shoulder.L", "elbow.L", "wrist.L"},
    }
    frames = dict(POSES)
    poses = []
    for pose_name, names in names_by_pose.items():
        bpy.context.scene.frame_set(frames[pose_name])
        bpy.context.view_layer.update()
        posed_points = helpers.object_points(body, evaluated=True)
        measured = [
            helpers.measure_region(region, bind_points, posed_points)
            for region in regions
            if region["name"] in names
        ]
        for item in measured:
            item["pass"] = (
                item["covarianceVolumeRatio"] >= 0.70
                and item["triangleAreaRatioP05"] >= 0.60
                and item["minimumTriangleAreaRatio"] >= 0.20
                and item["signedNormalInversions"] == 0
            )
        poses.append(
            {
                "name": pose_name,
                "frame": frames[pose_name],
                "regions": measured,
                "pass": all(item["pass"] for item in measured),
            }
        )
    return {
        "measurementSpace": "evaluated_auto_rig_pro_skinned_geometry",
        "frozenRegionTopology": True,
        "minimumCovarianceVolumeRatio": 0.70,
        "minimumTriangleAreaRatioP05": 0.60,
        "minimumTriangleAreaRatio": 0.20,
        "maximumSignedNormalInversions": 0,
        "poses": poses,
        "pass": all(pose["pass"] for pose in poses),
    }


def create_skeleton_overlay(rig, view, minimum, maximum, helpers):
    material = helpers.diagnostic_material(f"ARP_Skeleton_{view}", (0.04, 0.75, 1.0))
    if view == "front":
        project = lambda point: Vector((point.x, minimum.y - 0.045, point.z))
    else:
        project = lambda point: Vector((maximum.x + 0.045, point.y, point.z))
    objects = []
    for bone in rig.data.bones:
        if not bone.use_deform:
            continue
        objects.append(
            helpers.cylinder_between(
                f"ARP_OVERLAY_{view}_{bone.name}",
                project(rig.matrix_world @ bone.head_local),
                project(rig.matrix_world @ bone.tail_local),
                0.005,
                material,
            )
        )
    for obj in objects:
        obj.hide_render = True
    return objects


def render_overlays(output, camera, meshes, wire_overlays, overlay_by_view, helpers):
    scene = bpy.context.scene
    scene.frame_set(0)
    minimum, maximum = helpers.bounds(meshes, evaluated=True)
    target = (minimum + maximum) / 2
    dimensions = maximum - minimum
    camera.data.ortho_scale = max(dimensions.z * 1.14, dimensions.x * 1.2, dimensions.y * 1.2)
    distance = max(dimensions) * 3
    positions = {
        "front": Vector((target.x, minimum.y - distance, target.z)),
        "right": Vector((maximum.x + distance, target.y, target.z)),
    }
    paths = []
    all_overlays = sum(overlay_by_view.values(), [])
    for view, overlay in overlay_by_view.items():
        for obj in all_overlays:
            obj.hide_render = obj not in overlay
        for obj in meshes + wire_overlays:
            obj.hide_render = False
        camera.location = positions[view]
        helpers.point_camera(camera, target)
        path = output / f"validation-bind-skeleton-{view}.png"
        scene.render.filepath = str(path)
        bpy.ops.render.render(write_still=True)
        paths.append(path)
    for obj in all_overlays:
        obj.hide_render = True
    return paths


def main():
    args = parse_args()
    input_directory = Path(args.input).resolve()
    output = Path(args.output).resolve()
    output.mkdir(parents=True, exist_ok=True)
    prepared_blend = input_directory / "masculine-character-spike.blend"
    if sha256(prepared_blend) != EXPECTED_BLEND_SHA256:
        raise RuntimeError("Prepared blend changed before the ARP benchmark")
    installation = arp_installation()
    rig = validate_live_session()
    configure_scene_timing(bpy.context.scene)
    meshes_by_name = {name: bpy.data.objects.get(name) for name in SEMANTIC_MESHES}
    if any(obj is None or obj.type != "MESH" for obj in meshes_by_name.values()):
        raise RuntimeError("ARP session is missing a semantic source mesh")
    meshes = [meshes_by_name[name] for name in SEMANTIC_MESHES]
    helpers = load_pipeline_helpers()
    bind_before = {
        obj.name: [point.copy() for point in helpers.object_points(obj, evaluated=True)]
        for obj in meshes
    }
    operators = match_and_bind(rig, meshes)
    reset_controls(rig)
    bpy.context.view_layer.update()
    bind_deviation = max(
        (point - bind_before[obj.name][index]).length
        for obj in meshes
        for index, point in enumerate(helpers.object_points(obj, evaluated=True))
    )
    bone_inventory = inventory(rig)
    weights = cap_and_normalize_deform_weights(meshes, rig)
    remove_generated_actions()
    action, pose_records = author_diagnostic_action(rig)
    pose_identity = stress_pose_identity(rig, action)
    locomotion = author_locomotion_actions(rig)
    regions, region_source_hash = frozen_regions(input_directory, meshes_by_name["Body"])
    rig.animation_data.action = action
    deformation = deformation_report(meshes_by_name["Body"], regions, helpers)
    helpers.add_materials(meshes)
    wire_overlays = helpers.create_wire_overlays(meshes)
    camera = helpers.setup_render(meshes, wire_overlays, rig)
    renders = []
    for pose_name, frame in POSES:
        renders.extend(helpers.render_pose_views(output, camera, pose_name, frame, meshes))
    bpy.context.scene.frame_set(0)
    minimum, maximum = helpers.bounds(meshes, evaluated=True)
    overlays = {
        view: create_skeleton_overlay(rig, view, minimum, maximum, helpers)
        for view in ("front", "right")
    }
    skeleton_renders = render_overlays(output, camera, meshes, wire_overlays, overlays, helpers)
    for obj in wire_overlays + sum(overlays.values(), []):
        bpy.data.objects.remove(obj, do_unlink=True)
    blend_output = output / "masculine-auto-rig-pro-spike.blend"
    glb_output = output / "masculine-auto-rig-pro-diagnostic.glb"
    bpy.context.scene.frame_set(0)
    bpy.ops.wm.save_as_mainfile(filepath=str(blend_output))
    helpers.export_glb(glb_output, meshes, rig)
    glb_structure = helpers.parse_glb(glb_output)
    exported_clips = glb_animation_metadata(glb_output)
    glb_structure.pop("authoringRigLeakage", None)
    glb_structure.pop("rigifyControlLeakage", None)
    runtime_rig = classify_exported_arp_rig(rig, glb_structure)
    prepared_unchanged = sha256(prepared_blend) == EXPECTED_BLEND_SHA256
    structural_pass = bone_inventory["scapulaRequirementPass"] and weights["pass"]
    locomotion_control_authoring_pass = all(
        clip["controlAuthoringPass"] for clip in locomotion
    )
    locomotion_production_pass = False
    report = {
        "schemaVersion": 1,
        "pipeline": "ashveil-auto-rig-pro-benchmark",
        "status": "diagnostic_not_production_ready",
        "input": {
            "preparedBlendSha256": EXPECTED_BLEND_SHA256,
            "sourceSha256": EXPECTED_SOURCE_SHA256,
            "preserved": prepared_unchanged,
        },
        "autoRigPro": installation,
        "liveSession": {
            "phase": bpy.context.scene["ashveil_arp_session_phase"],
            "markerPositions": json.loads(bpy.context.scene["ashveil_arp_markers"]),
        },
        "operators": operators,
        "skeleton": bone_inventory,
        "bindGeometryMaximumDeviationMetres": bind_deviation,
        "weights": weights,
        "animation": {
            "name": action.name,
            "framesPerSecond": bpy.context.scene.render.fps / bpy.context.scene.render.fps_base,
            "frameStart": POSES[0][1],
            "frameEnd": POSES[-1][1],
            "poses": pose_records,
            "sourceInterpolation": "CONSTANT",
            "namedPoseIdentity": pose_identity,
            "humanReviewRequired": True,
        },
        "locomotion": {
            "clips": locomotion,
            "controlAuthoringPass": locomotion_control_authoring_pass,
            "productionLocomotionPass": locomotion_production_pass,
            "unmeasuredProductionGates": [
                "skinned sole contact and plant slide",
                "ground penetration and swing clearance",
                "knee plane and midline drift",
                "cyclic velocity continuity",
                "bilateral half-cycle mirror error",
            ],
        },
        "productionDeformation": deformation,
        "frozenRegionSourceReportSha256": region_source_hash,
        "export": {
            "skeletonCount": glb_structure["skins"],
            "animationCount": glb_structure["animations"],
            "animationClips": exported_clips,
            "runtimeRig": runtime_rig,
            "gltfStructure": glb_structure,
        },
        "productionAcceptance": {
            "structuralPass": structural_pass,
            "deformationPass": deformation["pass"],
            "poseIdentityPass": pose_identity["pass"],
            "locomotionControlAuthoringPass": locomotion_control_authoring_pass,
            "locomotionProductionPass": locomotion_production_pass,
            "pass": structural_pass
            and deformation["pass"]
            and pose_identity["pass"]
            and locomotion_production_pass,
        },
        "renders": [path.name for path in renders],
        "skeletonOverlays": [path.name for path in skeleton_renders],
        "knownLimitations": [
            "This is a diagnostic Auto-Rig Pro benchmark, not an accepted runtime skeleton.",
            "Diagnostic pose controls require human visual review.",
            "Walk and sprint are in-place control-authoring prototypes and still require skinned-foot contact review.",
            "Production acceptance remains false unless the scapula inventory and unchanged deformation gates pass.",
            "The GLB contains the full ARP authoring/control/mechanism graph; runtime reduction remains pending.",
        ],
    }
    artifact_paths = [blend_output, glb_output, *renders, *skeleton_renders]
    report["artifacts"] = [helpers.artifact_record(path) for path in artifact_paths]
    for artifact in report["artifacts"]:
        structure = artifact.get("gltfStructure")
        if structure:
            structure.pop("authoringRigLeakage", None)
            structure.pop("rigifyControlLeakage", None)
    report_path = output / "report.json"
    report_path.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    if not prepared_unchanged:
        raise RuntimeError("Prepared input changed during the Auto-Rig Pro benchmark")


main()
