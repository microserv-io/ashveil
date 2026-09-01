import argparse
import hashlib
import importlib.util
import json
import math
import sys
from pathlib import Path

import bpy
from mathutils import Matrix, Quaternion, Vector
from mathutils.kdtree import KDTree


def load_module(name, filename):
    specification = importlib.util.spec_from_file_location(name, Path(__file__).with_name(filename))
    module = importlib.util.module_from_spec(specification)
    specification.loader.exec_module(module)
    return module


BASE = load_module("ashveil_mixamo_ashveil_base", "auto-rig-pro-retarget.py")
TRANSFER = load_module("ashveil_mixamo_ashveil_transfer", "auto-rig-pro-transfer-v2.py")
PROCEDURAL = load_module("ashveil_mixamo_ashveil_procedural", "auto-rig-pro-procedural-v1.py")

SOURCE_SHA256 = "ecc6d600e10358d9d2230fa199f7e0b49d3b50d98775a46f39bc7dff43f1b916"
PRESET_SHA256 = "000ea4e15cd9b37ae45dfa450f85b97ce1a0622396d908008ef9f1b64967d7f7"
SOURCE_FRAMES = 62
FPS = 60
OUTPUT_ACTION = "Ashveil_Mixamo_Walk_InPlace_60fps"
MAXIMUM_GROUNDING_OFFSET_METRES = 0.035
MAXIMUM_GROUNDING_FRAME_VELOCITY_METRES = 0.020
SAMPLE_FRAMES = {"first": 0, "contact": 15, "mid": 30, "late": 45, "last": 61}
EXPECTED_SOURCE_BONES = {
    "mixamorig:Hips", "mixamorig:Spine", "mixamorig:Spine1", "mixamorig:Spine2",
    "mixamorig:Neck", "mixamorig:Head", "mixamorig:LeftShoulder", "mixamorig:LeftArm",
    "mixamorig:LeftForeArm", "mixamorig:LeftHand", "mixamorig:RightShoulder",
    "mixamorig:RightArm", "mixamorig:RightForeArm", "mixamorig:RightHand",
    "mixamorig:LeftUpLeg", "mixamorig:LeftLeg", "mixamorig:LeftFoot",
    "mixamorig:LeftToeBase", "mixamorig:RightUpLeg", "mixamorig:RightLeg",
    "mixamorig:RightFoot", "mixamorig:RightToeBase",
}
REQUIRED_MAP = {
    "c_root_master.x": "mixamorig:Hips",
    "c_spine_01.x": "mixamorig:Spine",
    "c_spine_02.x": "mixamorig:Spine1",
    "c_neck.x": "mixamorig:Neck",
    "c_head.x": "mixamorig:Head",
    "c_shoulder.l": "mixamorig:LeftShoulder",
    "c_arm_fk.l": "mixamorig:LeftArm",
    "c_forearm_fk.l": "mixamorig:LeftForeArm",
    "c_hand_fk.l": "mixamorig:LeftHand",
    "c_shoulder.r": "mixamorig:RightShoulder",
    "c_arm_fk.r": "mixamorig:RightArm",
    "c_forearm_fk.r": "mixamorig:RightForeArm",
    "c_hand_fk.r": "mixamorig:RightHand",
    "c_thigh_fk.l": "mixamorig:LeftUpLeg",
    "c_leg_fk.l": "mixamorig:LeftLeg",
    "c_foot_fk.l": "mixamorig:LeftFoot",
    "c_thigh_fk.r": "mixamorig:RightUpLeg",
    "c_leg_fk.r": "mixamorig:RightLeg",
    "c_foot_fk.r": "mixamorig:RightFoot",
}
RUNTIME_DEFORM_RENAMES = {
    "c_arm_twist_offset.l": "arm_twist.l",
    "c_arm_twist_offset.r": "arm_twist.r",
}
AXIAL_LIMITS = {
    "thigh_stretch.l": 60.0, "thigh_stretch.r": 60.0,
    "leg_stretch.l": 20.0, "leg_stretch.r": 20.0,
    "foot.l": 45.0, "foot.r": 45.0,
}


def parse_args():
    separator = sys.argv.index("--") if "--" in sys.argv else len(sys.argv)
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", required=True)
    parser.add_argument("--source-sha256", required=True)
    parser.add_argument("--output", required=True)
    return parser.parse_args(sys.argv[separator + 1:])


def sha256(path):
    digest = hashlib.sha256()
    with Path(path).open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def import_source(path):
    before = set(bpy.data.objects)
    result = bpy.ops.import_scene.fbx(filepath=str(path), automatic_bone_orientation=False, use_anim=True)
    if result != {"FINISHED"}:
        raise RuntimeError(f"Mixamo source import failed: {result}")
    imported = set(bpy.data.objects) - before
    armatures = [obj for obj in imported if obj.type == "ARMATURE"]
    meshes = [obj for obj in imported if obj.type == "MESH"]
    if len(armatures) != 1 or meshes:
        raise RuntimeError(f"Motion source must import one armature and no meshes: {len(armatures)}, {len(meshes)}")
    source = armatures[0]
    action = source.animation_data.action if source.animation_data else None
    if action is None or tuple(action.frame_range) != (1.0, 62.0):
        raise RuntimeError(f"Mixamo source action timing changed: {tuple(action.frame_range) if action else None}")
    bones = {bone.name for bone in source.data.bones}
    if len(bones) != 65 or not EXPECTED_SOURCE_BONES.issubset(bones):
        raise RuntimeError("Mixamo source bone inventory changed")
    if bpy.context.scene.render.fps != FPS:
        raise RuntimeError(f"Mixamo source must import at {FPS} fps, found {bpy.context.scene.render.fps}")
    source.name = "Mixamo_Ashveil_Walk_Source"
    return source, action


def source_root_motion(source, action):
    BASE.assign_action(source, action)
    points = []
    for frame in (1, SOURCE_FRAMES):
        bpy.context.scene.frame_set(frame)
        bpy.context.view_layer.update()
        points.append(source.matrix_world @ source.pose.bones["mixamorig:Hips"].head)
    delta = points[1] - points[0]
    horizontal = Vector((delta.x, delta.y, 0.0))
    result = {
        "sourceFrameStart": 0,
        "sourceFrameEnd": 61,
        "importedFrameStart": 1,
        "importedFrameEnd": 62,
        "fps": FPS,
        "hipsStartMetres": list(points[0]),
        "hipsEndMetres": list(points[1]),
        "hipsDeltaMetres": list(delta),
        "forwardDistanceMetres": horizontal.length,
        "forwardDirection": list(horizontal.normalized()),
    }
    result["pass"] = 1.80 <= horizontal.length <= 1.90
    if not result["pass"]:
        raise RuntimeError(f"Mixamo source root-motion contract changed: {result}")
    return result


def source_loop_seam(source, action):
    BASE.assign_action(source, action)
    samples = {}
    for frame in (1, 2, 61, 62):
        bpy.context.scene.frame_set(frame)
        bpy.context.view_layer.update()
        samples[frame] = {
            name: source.pose.bones[name].matrix.to_quaternion().normalized()
            for name in EXPECTED_SOURCE_BONES
        }
    endpoint = max(quaternion_angle(samples[1][name], samples[62][name]) for name in EXPECTED_SOURCE_BONES)
    velocity = max(
        abs(
            quaternion_angle(samples[1][name], samples[2][name])
            - quaternion_angle(samples[61][name], samples[62][name])
        ) for name in EXPECTED_SOURCE_BONES
    )
    result = {
        "measurementSpace": "imported_source_armature_pose_rotations",
        "hipsForwardTranslationExcluded": True,
        "endpointRotationMaximumDegrees": endpoint,
        "velocityRotationMaximumErrorDegreesPerFrame": velocity,
    }
    result["pass"] = endpoint <= 2.0 and velocity <= 2.0
    return result


def action_curve_hash(action):
    return BASE.hash_values(
        value
        for curve in sorted(BASE.action_curves(action), key=lambda item: (item.data_path, item.array_index))
        for point in curve.keyframe_points
        for value in (curve.data_path, curve.array_index, point.co.x, point.co.y)
    )


def ensure_key(curve, frame, evaluated_value):
    matches = [point for point in curve.keyframe_points if abs(point.co.x - frame) <= 1e-6]
    if len(matches) > 1:
        raise RuntimeError(f"Duplicate keys at frame {frame} for {curve.data_path}[{curve.array_index}]")
    if matches:
        return matches[0], False
    return curve.keyframe_points.insert(frame, evaluated_value, options={"FAST"}), True


def set_key_value(point, value):
    delta = value - point.co.y
    point.co.y = value
    point.handle_left.y += delta
    point.handle_right.y += delta


def condition_source_loop(action):
    before_hash = action_curve_hash(action)
    adjusted = []
    inserted = []
    maximum_delta = 0.0
    for curve in BASE.action_curves(action):
        if not curve.data_path.endswith(("rotation_euler", "rotation_quaternion", "rotation_axis_angle")):
            continue
        start_value = curve.evaluate(1)
        second_value_before = curve.evaluate(2)
        penultimate_value_before = curve.evaluate(61)
        end_value = curve.evaluate(62)
        start_velocity = second_value_before - start_value
        end_velocity = end_value - penultimate_value_before
        if abs(start_velocity - end_velocity) <= 1e-8:
            continue
        start, start_inserted = ensure_key(curve, 1, start_value)
        second, second_inserted = ensure_key(curve, 2, second_value_before)
        penultimate, penultimate_inserted = ensure_key(curve, 61, penultimate_value_before)
        end, end_inserted = ensure_key(curve, 62, end_value)
        for frame, was_inserted in ((1, start_inserted), (2, second_inserted), (61, penultimate_inserted), (62, end_inserted)):
            if was_inserted:
                inserted.append(f"{curve.data_path}[{curve.array_index}]@{frame}")
        wrapped_velocity = (start_velocity + end_velocity) * 0.5
        second_value = start.co.y + wrapped_velocity
        penultimate_value = end.co.y - wrapped_velocity
        maximum_delta = max(
            maximum_delta,
            abs(second_value - second.co.y),
            abs(penultimate_value - penultimate.co.y),
        )
        set_key_value(second, second_value)
        set_key_value(penultimate, penultimate_value)
        adjusted.append(f"{curve.data_path}[{curve.array_index}]")
    for curve in BASE.action_curves(action):
        for point in curve.keyframe_points:
            point.interpolation = "LINEAR"
    return {
        "algorithm": "symmetric_wrapped_rotation_velocity_average",
        "sourceOnly": True,
        "seamWindowFramesPerEnd": 1,
        "preservedEndpointFrames": [1, 62],
        "adjustedCurveCount": len(adjusted),
        "adjustedCurves": adjusted,
        "insertedKeyCount": len(inserted),
        "insertedKeys": inserted,
        "maximumCurveValueCorrection": maximum_delta,
        "beforeActionCurveSha256": before_hash,
        "afterActionCurveSha256": action_curve_hash(action),
        "pass": bool(adjusted),
    }


def configure_remap(source, source_action, target):
    scene = bpy.context.scene
    scene.batch_retarget = False
    scene.source_rig = source.name
    scene.target_rig = target.name
    scene.source_action = source_action.name
    scene.arp_retarget_in_place = False
    BASE.assign_action(source, source_action)
    BASE.select([source], source)
    if bpy.ops.arp.build_bones_list("EXEC_DEFAULT") != {"FINISHED"}:
        raise RuntimeError("ARP Mixamo source discovery failed")
    if bpy.ops.arp.import_config_preset("EXEC_DEFAULT", preset_name="mixamo_fbx_ik") != {"FINISHED"}:
        raise RuntimeError("ARP native Mixamo preset failed to load")
    installation = BASE.arp_installation()
    preset = Path(sys.modules[installation["extensionModule"]].__file__).resolve().parent / "remap_presets/mixamo_fbx_ik.bmap"
    if sha256(preset) != PRESET_SHA256:
        raise RuntimeError("ARP native Mixamo mapping preset changed")
    for side in ("l", "r"):
        foot = next(item for item in scene.bones_map_v2 if item.name == f"c_foot_ik.{side}")
        toes = next(item for item in scene.bones_map_v2 if item.name == f"c_toes_ik.{side}")
        foot.name = f"c_foot_fk.{side}"
        foot.ik = False
        foot.ik_pole = ""
        toes.name = "None"
        toes.ik = False
        toes.ik_pole = ""
    mapping = {
        item.name: item.source_bone
        for item in scene.bones_map_v2
        if item.name not in {"", "None"}
    }
    if any(mapping.get(target_name) != source_name for target_name, source_name in REQUIRED_MAP.items()):
        raise RuntimeError(f"ARP Mixamo core mapping changed: {mapping}")
    roots = [item.name for item in scene.bones_map_v2 if item.set_as_root]
    if roots != ["c_root_master.x"]:
        raise RuntimeError(f"ARP Mixamo root mapping changed: {roots}")
    if any(item.ik for item in scene.bones_map_v2 if item.name.startswith(("c_foot_fk.", "c_toes_fk."))):
        raise RuntimeError("ARP Mixamo FK foot branch retained IK settings")
    if bpy.ops.arp.auto_scale("EXEC_DEFAULT") != {"FINISHED"}:
        raise RuntimeError("ARP Mixamo auto-scale failed")
    if bpy.ops.arp.redefine_rest_pose("EXEC_DEFAULT", preserve=True, rest_pose="REST") != {"FINISHED"}:
        raise RuntimeError("ARP Mixamo source-rest preparation failed")
    bpy.ops.pose.select_all(action="DESELECT")
    aligned_source_bones = set(REQUIRED_MAP.values()) - {
        "mixamorig:Hips", "mixamorig:Spine", "mixamorig:LeftHand", "mixamorig:RightHand",
    }
    for name in aligned_source_bones:
        if bpy.app.version >= (5, 0, 0):
            source.pose.bones[name].select = True
        else:
            source.pose.bones[name].bone.select = True
    if bpy.ops.arp.copy_bone_rest("EXEC_DEFAULT") != {"FINISHED"}:
        raise RuntimeError("ARP Mixamo mapped body rest alignment failed")
    if bpy.ops.arp.save_pose_rest("EXEC_DEFAULT") != {"FINISHED"}:
        raise RuntimeError("ARP Mixamo calibrated rest save failed")
    map_hash = BASE.hash_values(
        value
        for item in sorted(scene.bones_map_v2, key=lambda item: item.name)
        for value in (item.name, item.source_bone, item.set_as_root, item.ik, item.ik_pole)
    )
    return {
        "preset": "mixamo_fbx_ik",
        "presetSha256": PRESET_SHA256,
        "mapSha256": map_hash,
        "mappedControls": sorted(mapping),
        "mappedControlCount": len(mapping),
        "presetLegBranchOverride": "fk_legs_and_feet_with_unmapped_toes",
        "restCalibration": "rest_pose_preserve_then_selected_mapped_body_copy",
        "alignedSourceBones": sorted(aligned_source_bones),
        "oneRoot": True,
        "feetUseIk": False,
        "toesMapped": False,
        "toesInheritFkFoot": True,
        "armsUseFk": True,
        "pass": True,
    }, set(mapping)


def set_switches(target):
    for side in ("l", "r"):
        foot = target.pose.bones[f"c_foot_ik.{side}"]
        hand = target.pose.bones[f"c_hand_ik.{side}"]
        foot["ik_fk_switch"] = 1.0
        foot["auto_stretch"] = 0.0
        hand["ik_fk_switch"] = 1.0
        hand["auto_stretch"] = 0.0


def key_switches(target, action):
    BASE.assign_action(target, action)
    set_switches(target)
    for side in ("l", "r"):
        for name in (f"c_foot_ik.{side}", f"c_hand_ik.{side}"):
            bone = target.pose.bones[name]
            for frame in (1, SOURCE_FRAMES):
                bone.keyframe_insert('["ik_fk_switch"]', frame=frame, group=bone.name)
                bone.keyframe_insert('["auto_stretch"]', frame=frame, group=bone.name)


def remove_control_rotation_curves(action, control_names):
    paths = {
        f'pose.bones["{name}"].{channel}'
        for name in control_names
        for channel in ("rotation_euler", "rotation_quaternion", "rotation_axis_angle")
    }
    removable = [curve for curve in BASE.action_curves(action) if curve.data_path in paths]
    if hasattr(action, "fcurves"):
        for curve in removable:
            action.fcurves.remove(curve)
        return
    pointers = {curve.as_pointer() for curve in removable}
    for layer in action.layers:
        for strip in layer.strips:
            for channel_bag in strip.channelbags:
                for curve in list(channel_bag.fcurves):
                    if curve.as_pointer() in pointers:
                        channel_bag.fcurves.remove(curve)


def hemisphere_aligned(quaternion, reference):
    aligned = quaternion.copy()
    if aligned.dot(reference) < 0.0:
        aligned.negate()
    return aligned


def calibrate_fk_feet(source, source_action, target, action):
    control_names = {f"c_foot_fk.{side}" for side in ("l", "r")}
    remove_control_rotation_curves(action, control_names)
    source_bind = {}
    target_bind = {}
    for side, source_side in (("l", "Left"), ("r", "Right")):
        source_parent = source.data.bones[f"mixamorig:{source_side}Leg"]
        source_foot = source.data.bones[f"mixamorig:{source_side}Foot"]
        source_bind[side] = (
            source_parent.matrix_local.inverted_safe() @ source_foot.matrix_local
        ).to_quaternion().normalized()
        foot = target.pose.bones[f"c_foot_fk.{side}"]
        target_bind[side] = (
            foot.parent.bone.matrix_local.inverted_safe() @ foot.bone.matrix_local
        ).to_quaternion().normalized()
        foot.rotation_mode = "QUATERNION"

    previous = dict(target_bind)
    maximum_source_delta = {"l": 0.0, "r": 0.0}
    BASE.assign_action(source, source_action)
    BASE.assign_action(target, action)
    for frame in range(1, SOURCE_FRAMES + 1):
        bpy.context.scene.frame_set(frame)
        bpy.context.view_layer.update()
        for side, source_side in (("l", "Left"), ("r", "Right")):
            source_parent = source.pose.bones[f"mixamorig:{source_side}Leg"]
            source_foot = source.pose.bones[f"mixamorig:{source_side}Foot"]
            source_relative = (
                source_parent.matrix.inverted_safe() @ source_foot.matrix
            ).to_quaternion().normalized()
            source_relative = hemisphere_aligned(source_relative, source_bind[side])
            source_delta = (source_bind[side].conjugated() @ source_relative).normalized()
            maximum_source_delta[side] = max(
                maximum_source_delta[side],
                TRANSFER.quaternion_angle_degrees(source_bind[side], source_relative),
            )
            target_relative = (target_bind[side] @ source_delta).normalized()
            target_relative = hemisphere_aligned(target_relative, previous[side])
            previous[side] = target_relative.copy()
            foot = target.pose.bones[f"c_foot_fk.{side}"]
            evaluated_relative = foot.parent.matrix.inverted_safe() @ foot.matrix
            desired_relative = Matrix.LocRotScale(
                evaluated_relative.translation,
                target_relative,
                evaluated_relative.to_scale(),
            )
            desired_pose = foot.parent.matrix @ desired_relative
            foot.matrix_basis = foot.bone.convert_local_to_pose(
                desired_pose,
                foot.bone.matrix_local,
                parent_matrix=foot.parent.matrix,
                parent_matrix_local=foot.parent.bone.matrix_local,
                invert=True,
            )
            bpy.context.view_layer.update()
            foot.keyframe_insert("rotation_quaternion", frame=frame, group=foot.name)
    return {
        "algorithm": "source_parent_relative_delta_on_target_parent_relative_bind",
        "sourceControls": ["mixamorig:LeftFoot", "mixamorig:RightFoot"],
        "targetControls": sorted(control_names),
        "quaternionHemisphereContinuity": True,
        "targetDeformRotationsAuthored": False,
        "maximumSourceRelativeDeltaDegrees": maximum_source_delta,
        "pass": all(value > 1.0 for value in maximum_source_delta.values()),
    }


def validate_control_action(target, action, mapped_controls):
    allowed = mapped_controls | {
        "c_foot_ik.l", "c_foot_ik.r", "c_hand_ik.l", "c_hand_ik.r",
        "c_leg_pole.l", "c_leg_pole.r",
    }
    keyed = set()
    for curve in BASE.action_curves(action):
        if curve.data_path.startswith('pose.bones["'):
            keyed.add(curve.data_path.split('"', 2)[1])
    unexpected = sorted(keyed - allowed)
    deform = sorted(name for name in keyed if target.data.bones.get(name) and target.data.bones[name].use_deform)
    result = {"keyedControls": sorted(keyed), "unexpected": unexpected, "deformBonesKeyed": deform}
    result["pass"] = not unexpected and not deform
    if not result["pass"]:
        raise RuntimeError(f"ARP Mixamo action ownership failed: {result}")
    return result


def target_bind_forward(target):
    forward = sum((
        target.matrix_world.to_3x3() @ (
            target.data.bones[f"toes_01.{side}"].head_local
            - target.data.bones[f"foot.{side}"].head_local
        )
        for side in ("l", "r")
    ), Vector())
    forward.z = 0.0
    forward.normalize()
    return forward


def curve_values(action):
    return {
        (curve.data_path, curve.array_index): [point.co.y for point in curve.keyframe_points]
        for curve in BASE.action_curves(action)
    }


def source_in_place_conversion(source, original_action, source_motion):
    original_values = curve_values(original_action)
    bpy.context.scene.arp_retarget_in_place = True
    bpy.context.view_layer.update()
    in_place = source.animation_data.action if source.animation_data else None
    if in_place is None or in_place == original_action or not in_place.name.endswith("_IN_PLACE"):
        raise RuntimeError("ARP did not create and assign a source in-place action")
    converted_values = curve_values(in_place)
    changed = []
    for key, before in original_values.items():
        after = converted_values.get(key)
        if after is None or len(after) != len(before):
            raise RuntimeError(f"ARP source in-place curve inventory changed: {key}")
        maximum = max(abs(left - right) for left, right in zip(before, after))
        if maximum > 1e-8:
            changed.append({"dataPath": key[0], "arrayIndex": key[1], "maximumValueChange": maximum})
    unexpected = [item for item in changed if item["dataPath"] != 'pose.bones["mixamorig:Hips"].location']
    BASE.assign_action(source, in_place)
    points = []
    for frame in (1, SOURCE_FRAMES):
        bpy.context.scene.frame_set(frame)
        bpy.context.view_layer.update()
        points.append(source.matrix_world @ source.pose.bones["mixamorig:Hips"].head)
    delta = points[1] - points[0]
    forward = Vector(source_motion["forwardDirection"])
    horizontal = Vector((delta.x, delta.y, 0.0))
    off_forward = horizontal - forward * horizontal.dot(forward)
    result = {
        "implementation": "arp_source_action_in_place_conversion_before_retarget",
        "originalAction": original_action.name,
        "inPlaceAction": in_place.name,
        "changedCurves": changed,
        "unexpectedChangedCurves": unexpected,
        "sourceInPlaceHipsDeltaMetres": list(delta),
        "sourceInPlaceHorizontalNetMetres": horizontal.length,
        "sourceInPlaceOffForwardNetMetres": off_forward.length,
        "originalForwardDistanceMetres": source_motion["forwardDistanceMetres"],
        "postTargetRootCurveEdits": False,
    }
    result["pass"] = (
        bool(changed) and not unexpected and horizontal.length <= 1e-5
        and abs(delta.z - source_motion["hipsDeltaMetres"][2]) <= 1e-6
    )
    if not result["pass"]:
        raise RuntimeError(f"ARP source in-place conversion failed provenance gates: {result}")
    return in_place, result


def target_root_net(target, action):
    BASE.assign_action(target, action)
    points = []
    for frame in (0, 61):
        bpy.context.scene.frame_set(frame)
        bpy.context.view_layer.update()
        points.append(target.matrix_world @ target.pose.bones["c_root_master.x"].head)
    delta = points[1] - points[0]
    result = {"deltaMetres": list(delta), "horizontalNetMetres": math.hypot(delta.x, delta.y)}
    result["pass"] = result["horizontalNetMetres"] <= 0.002
    return result


def shift_to_zero(action):
    for curve in BASE.action_curves(action):
        for point in curve.keyframe_points:
            point.co.x -= 1.0
            point.handle_left.x -= 1.0
            point.handle_right.x -= 1.0
            point.interpolation = "LINEAR"
    action.use_frame_range = True
    action.frame_start = 0
    action.frame_end = 61


def quaternion_angle(first, second):
    angle = math.degrees(first.rotation_difference(second).angle)
    return min(angle, 360.0 - angle)


def axial_twist(target, action, bind_rotations):
    BASE.assign_action(target, action)
    maxima = {name: 0.0 for name in AXIAL_LIMITS}
    for frame in range(SOURCE_FRAMES):
        bpy.context.scene.frame_set(frame)
        bpy.context.view_layer.update()
        for name in maxima:
            actual = (target.matrix_world @ target.pose.bones[name].matrix).to_quaternion().normalized()
            maxima[name] = max(maxima[name], TRANSFER.axial_error_degrees(bind_rotations[name], actual))
    result = {"maximumDegrees": maxima, "limitsDegrees": AXIAL_LIMITS}
    result["pass"] = all(maxima[name] <= AXIAL_LIMITS[name] for name in maxima)
    return result


def knee_hinge(target, action, forward):
    BASE.assign_action(target, action)
    crossing = 0
    minimum_forward = math.inf
    maximum_flexion = 0.0
    for frame in range(SOURCE_FRAMES):
        bpy.context.scene.frame_set(frame)
        bpy.context.view_layer.update()
        knees = {}
        for side in ("l", "r"):
            hip, knee, ankle = [
                target.matrix_world @ target.pose.bones[f"{name}.{side}"].head
                for name in ("thigh_stretch", "leg_stretch", "foot")
            ]
            knees[side] = knee
            axis = ankle - hip
            closest = hip + axis * ((knee - hip).dot(axis) / max(axis.length_squared, 1e-12))
            bend = knee - closest
            upper = (knee - hip).normalized()
            lower = (ankle - knee).normalized()
            flexion = math.degrees(math.acos(max(-1.0, min(1.0, upper.dot(lower)))))
            maximum_flexion = max(maximum_flexion, flexion)
            if flexion >= 10.0:
                minimum_forward = min(minimum_forward, bend.dot(forward))
        crossing += knees["l"].x <= knees["r"].x
    result = {
        "sideCrossingFrames": crossing,
        "minimumForwardBendMetres": minimum_forward if minimum_forward < math.inf else 0.0,
        "maximumFlexionDegrees": maximum_flexion,
    }
    result["pass"] = crossing == 0 and result["minimumForwardBendMetres"] >= -0.01 and maximum_flexion <= 155.0
    return result


def foot_contact(target, body, action, patches, floor):
    BASE.assign_action(target, action)
    samples = {"l": [], "r": []}
    for frame in range(SOURCE_FRAMES):
        bpy.context.scene.frame_set(frame)
        bpy.context.view_layer.update()
        for side in ("l", "r"):
            samples[side].append(min(point.z for point in PROCEDURAL.evaluated_positions(body, patches[side])) - floor)
    result = {
        "minimumSoleHeightMetres": {side: min(values) for side, values in samples.items()},
        "contactFramesWithin20mm": {side: sum(value <= 0.02 for value in values) for side, values in samples.items()},
        "minimumPenetrationMetres": min(value for values in samples.values() for value in values),
    }
    result["pass"] = (
        all(value >= 1 for value in result["contactFramesWithin20mm"].values())
        and result["minimumPenetrationMetres"] >= -0.005
    )
    return result


def sole_minimum(target, body, action, patches, floor):
    BASE.assign_action(target, action)
    minimum = math.inf
    for frame in range(SOURCE_FRAMES):
        bpy.context.scene.frame_set(frame)
        bpy.context.view_layer.update()
        minimum = min(
            minimum,
            *(min(point.z for point in PROCEDURAL.evaluated_positions(body, patches[side])) - floor for side in ("l", "r")),
        )
    return minimum


def ground_action(target, body, action, patches, floor):
    BASE.assign_action(target, action)
    minima = []
    for frame in range(SOURCE_FRAMES):
        bpy.context.scene.frame_set(frame)
        bpy.context.view_layer.update()
        positions = PROCEDURAL.evaluated_positions(body)
        minima.append(min(
            min(positions[index].z - floor for index in patches[side])
            for side in ("l", "r")
        ))
    offsets = [-minimum for minimum in minima]
    offsets[-1] = offsets[0]
    wrapped_velocity = ((offsets[1] - offsets[0]) + (offsets[-1] - offsets[-2])) * 0.5
    offsets[1] = offsets[0] + wrapped_velocity
    offsets[-2] = offsets[-1] - wrapped_velocity
    maximum_absolute_offset = max(abs(value) for value in offsets)
    maximum_frame_velocity = max(
        abs(offsets[frame] - offsets[frame - 1])
        for frame in range(1, SOURCE_FRAMES)
    )
    root_path = 'pose.bones["c_root_master.x"].location'
    untouched_before = {
        key: values for key, values in curve_values(action).items() if key[0] != root_path
    }
    BASE.assign_action(target, action)
    root = target.pose.bones["c_root_master.x"]
    for frame in range(SOURCE_FRAMES):
        bpy.context.scene.frame_set(frame)
        bpy.context.view_layer.update()
        armature_up = target.matrix_world.inverted().to_3x3() @ Vector((0.0, 0.0, offsets[frame]))
        desired = root.matrix.copy()
        desired.translation += armature_up
        conversion = {
            "parent_matrix": root.parent.matrix if root.parent else Matrix.Identity(4),
            "parent_matrix_local": root.parent.bone.matrix_local if root.parent else Matrix.Identity(4),
        }
        root.matrix_basis = root.bone.convert_local_to_pose(
            desired,
            root.bone.matrix_local,
            invert=True,
            **conversion,
        )
        bpy.context.view_layer.update()
        root.keyframe_insert("location", frame=frame, group=root.name)
    untouched_after = {
        key: values for key, values in curve_values(action).items() if key[0] != root_path
    }
    after = sole_minimum(target, body, action, patches, floor)
    result = {
        "implementation": "contact_constrained_periodic_root_world_vertical_normalization",
        "formula": "rootWorldZ'(f) = rootWorldZ(f) - min(soleWorldZ_l(f), soleWorldZ_r(f))",
        "targetControl": root.name,
        "targetControlLocationOnly": untouched_before == untouched_after,
        "preCorrectionMinimumSoleHeightMetres": min(minima),
        "verticalOffsetMetresByFrame": {str(frame): value for frame, value in enumerate(offsets)},
        "postCorrectionMinimumSoleHeightMetres": after,
        "endpointOffsetDifferenceMetres": abs(offsets[0] - offsets[-1]),
        "velocityOffsetDifferenceMetresPerFrame": abs(
            (offsets[1] - offsets[0]) - (offsets[-1] - offsets[-2])
        ),
        "maximumAbsoluteOffsetMetres": maximum_absolute_offset,
        "maximumAbsoluteOffsetLimitMetres": MAXIMUM_GROUNDING_OFFSET_METRES,
        "maximumFrameVelocityMetres": maximum_frame_velocity,
        "maximumFrameVelocityLimitMetres": MAXIMUM_GROUNDING_FRAME_VELOCITY_METRES,
        "targetRootVerticalCurveAuthored": True,
        "targetVerticalPlacementChanged": True,
        "targetRotationsAuthored": False,
    }
    result["pass"] = (
        result["targetControlLocationOnly"]
        and after >= -0.0001
        and maximum_absolute_offset <= MAXIMUM_GROUNDING_OFFSET_METRES
        and maximum_frame_velocity <= MAXIMUM_GROUNDING_FRAME_VELOCITY_METRES
        and result["endpointOffsetDifferenceMetres"] <= 1e-7
        and result["velocityOffsetDifferenceMetresPerFrame"] <= 1e-7
    )
    if not result["pass"]:
        raise RuntimeError(f"Mixamo root grounding failed: {result}")
    return result


def toe_alignment(target, action):
    BASE.assign_action(target, action)
    maximum = 0.0
    samples = []
    for label, frame in SAMPLE_FRAMES.items():
        bpy.context.scene.frame_set(frame)
        bpy.context.view_layer.update()
        sides = {}
        for side in ("l", "r"):
            foot = target.pose.bones[f"foot.{side}"]
            toes = target.pose.bones[f"toes_01.{side}"]
            foot_segment = (toes.head - foot.head).normalized()
            toe_segment = (toes.tail - toes.head).normalized()
            angle = math.degrees(foot_segment.angle(toe_segment))
            maximum = max(maximum, angle)
            sides[side] = angle
        samples.append({"name": label, "frame": frame, "footToeDirectionAngleDegrees": sides})
    result = {
        "measurementSpace": "evaluated_target_armature_segments",
        "maximumFootToeDirectionAngleDegrees": maximum,
        "limitDegrees": 45.0,
        "samples": samples,
    }
    result["pass"] = maximum <= result["limitDegrees"]
    return result


def heel_forefoot_contact(target, body, action, patches, floor, forward):
    bind_positions = [body.matrix_world @ vertex.co for vertex in body.data.vertices]
    bands = {}
    for side, indices in patches.items():
        ordered = sorted(indices, key=lambda index: bind_positions[index].dot(forward))
        count = max(3, math.ceil(len(ordered) * 0.25))
        bands[side] = {"heel": ordered[:count], "forefoot": ordered[-count:]}
    BASE.assign_action(target, action)
    samples = {side: [] for side in ("l", "r")}
    for frame in range(SOURCE_FRAMES):
        bpy.context.scene.frame_set(frame)
        bpy.context.view_layer.update()
        for side in ("l", "r"):
            positions = PROCEDURAL.evaluated_positions(body)
            heel = min(positions[index].z - floor for index in bands[side]["heel"])
            forefoot = min(positions[index].z - floor for index in bands[side]["forefoot"])
            samples[side].append({"frame": frame, "heelMetres": heel, "forefootMetres": forefoot})
    sides = {}
    for side, values in samples.items():
        heel_contacts = [item for item in values if item["heelMetres"] <= 0.02]
        forefoot_contacts = [item for item in values if item["forefootMetres"] <= 0.02]
        flat_contacts = [
            item for item in values
            if item["heelMetres"] <= 0.02 and item["forefootMetres"] <= 0.02
        ]
        sides[side] = {
            "heelContactFramesWithin20mm": len(heel_contacts),
            "forefootContactFramesWithin20mm": len(forefoot_contacts),
            "flatSupportFramesWithin20mm": len(flat_contacts),
            "minimumHeelHeightMetres": min(item["heelMetres"] for item in values),
            "minimumForefootHeightMetres": min(item["forefootMetres"] for item in values),
        }
        sides[side]["pass"] = bool(heel_contacts and forefoot_contacts and flat_contacts)
    return {
        "measurementSpace": "evaluated_frozen_bind_sole_heel_and_forefoot_bands",
        "sides": sides,
        "pass": all(item["pass"] for item in sides.values()),
    }


def loop_seam(target, action):
    BASE.assign_action(target, action)
    samples = {}
    for frame in (0, 1, 60, 61):
        bpy.context.scene.frame_set(frame)
        bpy.context.view_layer.update()
        samples[frame] = {
            bone.name: (target.matrix_world @ target.pose.bones[bone.name].matrix).copy()
            for bone in target.data.bones if bone.use_deform
        }
    endpoint_translation = max(
        (samples[0][name].translation - samples[61][name].translation).length for name in samples[0]
    )
    endpoint_rotation = max(
        quaternion_angle(samples[0][name].to_quaternion(), samples[61][name].to_quaternion()) for name in samples[0]
    )
    velocity_translation = max(
        abs(
            (samples[1][name].translation - samples[0][name].translation).length
            - (samples[61][name].translation - samples[60][name].translation).length
        ) for name in samples[0]
    )
    velocity_rotation = max(
        abs(
            quaternion_angle(samples[0][name].to_quaternion(), samples[1][name].to_quaternion())
            - quaternion_angle(samples[60][name].to_quaternion(), samples[61][name].to_quaternion())
        ) for name in samples[0]
    )
    result = {
        "endpointTranslationMaximumMetres": endpoint_translation,
        "endpointRotationMaximumDegrees": endpoint_rotation,
        "velocityTranslationMaximumErrorMetresPerFrame": velocity_translation,
        "velocityRotationMaximumErrorDegreesPerFrame": velocity_rotation,
    }
    result["pass"] = (
        endpoint_translation <= 0.002 and endpoint_rotation <= 2.0
        and velocity_translation <= 0.002 and velocity_rotation <= 2.0
    )
    return result


def gait_anatomy(target, action, bind_directions):
    BASE.assign_action(target, action)
    samples = []
    passed = True
    for label, frame in SAMPLE_FRAMES.items():
        bpy.context.scene.frame_set(frame)
        bpy.context.view_layer.update()
        sides = {}
        for side, sign in (("l", 1.0), ("r", -1.0)):
            shoulder = target.matrix_world @ target.pose.bones[f"arm_stretch.{side}"].head
            elbow = target.matrix_world @ target.pose.bones[f"forearm_stretch.{side}"].head
            wrist = target.matrix_world @ target.pose.bones[f"hand.{side}"].head
            hand_tail = target.matrix_world @ target.pose.bones[f"hand.{side}"].tail
            upper = elbow - shoulder
            lower = wrist - elbow
            hand = hand_tail - wrist
            upper_deviation = math.degrees(bind_directions[f"arm_stretch.{side}"].angle(upper))
            elbow_flexion = math.degrees(upper.angle(lower))
            wrist_bend = math.degrees(lower.angle(hand))
            side_pass = (
                sign * elbow.x >= 0.06 and sign * wrist.x >= -0.02
                and upper_deviation <= 75.0 and elbow_flexion <= 110.0 and wrist_bend <= 60.0
            )
            sides[side] = {
                "shoulderWorld": list(shoulder), "elbowWorld": list(elbow), "wristWorld": list(wrist),
                "upperArmBindDeviationDegrees": upper_deviation,
                "elbowFlexionDegrees": elbow_flexion,
                "wristBendDegrees": wrist_bend,
                "pass": side_pass,
            }
            passed = passed and side_pass
        samples.append({"name": label, "frame": frame, "sides": sides, "pass": all(item["pass"] for item in sides.values())})
    return {
        "measurementSpace": "evaluated_target_deform_bones_world",
        "maximumUpperArmBindDeviationDegrees": 75.0,
        "maximumElbowFlexionDegrees": 110.0,
        "maximumWristBendDegrees": 60.0,
        "samples": samples,
        "pass": passed,
    }


def sagittal_posture(target, action, forward, up):
    BASE.assign_action(target, action)
    samples = []
    for label, frame in SAMPLE_FRAMES.items():
        bpy.context.scene.frame_set(frame)
        bpy.context.view_layer.update()
        hip = sum(
            (target.matrix_world @ target.pose.bones[f"thigh_stretch.{side}"].head for side in ("l", "r")),
            Vector(),
        ) / 2.0
        shoulder = sum(
            (target.matrix_world @ target.pose.bones[f"arm_stretch.{side}"].head for side in ("l", "r")),
            Vector(),
        ) / 2.0
        axis = shoulder - hip
        lean = math.degrees(math.atan2(axis.dot(forward), axis.dot(up)))
        samples.append({"name": label, "frame": frame, "hipShoulderSagittalLeanDegrees": lean})
    ordered = sorted(item["hipShoulderSagittalLeanDegrees"] for item in samples)
    median = ordered[len(ordered) // 2]
    result = {
        "measurementSpace": "evaluated_target_hip_to_bilateral_shoulder_axis",
        "acceptedBaselineLeanDegrees": samples[0]["hipShoulderSagittalLeanDegrees"],
        "medianAnimatedLeanDegrees": median,
        "maximumBackwardLeanDegrees": min(item["hipShoulderSagittalLeanDegrees"] for item in samples),
        "maximumBackwardLeanLimitDegrees": -8.0,
        "samples": samples,
    }
    result["pass"] = result["maximumBackwardLeanDegrees"] >= result["maximumBackwardLeanLimitDegrees"]
    return result


def normalized_mesh_name(name):
    return name.split(".", 1)[0].removesuffix("_Mesh")


def boundary_vertices(mesh):
    edge_counts = {}
    for polygon in mesh.data.polygons:
        vertices = tuple(polygon.vertices)
        for index, left in enumerate(vertices):
            edge = tuple(sorted((left, vertices[(index + 1) % len(vertices)])))
            edge_counts[edge] = edge_counts.get(edge, 0) + 1
    return {index for edge, count in edge_counts.items() if count == 1 for index in edge}


def vertex_weight_profile(mesh, index):
    names = {group.index: group.name for group in mesh.vertex_groups}
    return {
        names[item.group]: item.weight
        for item in mesh.data.vertices[index].groups if item.weight >= 0.001
    }


def weight_profile_l1(first, second):
    return sum(abs(first.get(name, 0.0) - second.get(name, 0.0)) for name in set(first) | set(second))


def freeze_head_body_seam(body, head):
    body_positions = [body.matrix_world @ vertex.co for vertex in body.data.vertices]
    head_positions = [head.matrix_world @ vertex.co for vertex in head.data.vertices]
    head_boundary = boundary_vertices(head)
    tree = KDTree(len(head_boundary))
    for index in head_boundary:
        tree.insert(head_positions[index], index)
    tree.balance()
    pairs = []
    for body_index in boundary_vertices(body):
        point = body_positions[body_index]
        _, head_index, distance = tree.find(point)
        if point.z >= 1.20 and distance <= 0.03:
            pairs.append((body_index, head_index, distance))
    if len(pairs) < 20:
        raise RuntimeError(f"Head/body seam inventory changed: {len(pairs)} pairs")
    weight_differences = [
        weight_profile_l1(
            vertex_weight_profile(body, body_index),
            vertex_weight_profile(head, head_index),
        )
        for body_index, head_index, _ in pairs
    ]
    return {
        "pairs": pairs,
        "pairSha256": BASE.hash_values(value for pair in pairs for value in pair[:2]),
        "pairCount": len(pairs),
        "maximumBindGapMetres": max(pair[2] for pair in pairs),
        "p95BindGapMetres": TRANSFER.percentile([pair[2] for pair in pairs], 0.95),
        "maximumWeightL1Difference": max(weight_differences),
        "p95WeightL1Difference": TRANSFER.percentile(weight_differences, 0.95),
    }


def validate_head_body_seam(target, body, head, action, frozen):
    BASE.assign_action(target, action)
    maximum_gap = 0.0
    maximum_growth = 0.0
    samples = []
    for label, frame in SAMPLE_FRAMES.items():
        bpy.context.scene.frame_set(frame)
        bpy.context.view_layer.update()
        body_positions = PROCEDURAL.evaluated_positions(body)
        head_positions = PROCEDURAL.evaluated_positions(head)
        gaps = [
            (body_positions[body_index] - head_positions[head_index]).length
            for body_index, head_index, _ in frozen["pairs"]
        ]
        growth = [gap - frozen["pairs"][index][2] for index, gap in enumerate(gaps)]
        maximum_gap = max(maximum_gap, max(gaps))
        maximum_growth = max(maximum_growth, max(growth))
        samples.append({
            "name": label,
            "frame": frame,
            "maximumGapMetres": max(gaps),
            "p95GapMetres": TRANSFER.percentile(gaps, 0.95),
        })
    result = {
        key: value for key, value in frozen.items() if key != "pairs"
    }
    result.update({
        "pairPolicy": "fixed_bind_body_boundary_to_nearest_head_boundary_within_30mm_above_1.20m",
        "maximumAnimatedGapMetres": maximum_gap,
        "maximumDynamicGapGrowthMetres": maximum_growth,
        "limitsMetres": {"bindGap": 0.002, "animatedGap": 0.003, "dynamicGrowth": 0.002},
        "maximumSharedWeightL1Difference": 0.05,
        "samples": samples,
    })
    result["pass"] = (
        result["maximumBindGapMetres"] <= result["limitsMetres"]["bindGap"]
        and result["maximumAnimatedGapMetres"] <= result["limitsMetres"]["animatedGap"]
        and result["maximumDynamicGapGrowthMetres"] <= result["limitsMetres"]["dynamicGrowth"]
        and result["maximumWeightL1Difference"] <= result["maximumSharedWeightL1Difference"]
    )
    return result


def split_aware_vertex_errors(source_positions, runtime_positions):
    runtime_tree = KDTree(len(runtime_positions))
    for index, point in enumerate(runtime_positions):
        runtime_tree.insert(point, index)
    runtime_tree.balance()
    source_tree = KDTree(len(source_positions))
    for index, point in enumerate(source_positions):
        source_tree.insert(point, index)
    source_tree.balance()
    return (
        [runtime_tree.find(point)[2] for point in source_positions]
        + [source_tree.find(point)[2] for point in runtime_positions]
    )


def validate_runtime_parity(glb_path, target, meshes, action):
    BASE.assign_action(target, action)
    reference = {}
    for frame in SAMPLE_FRAMES.values():
        bpy.context.scene.frame_set(frame)
        bpy.context.view_layer.update()
        reference[frame] = {
            "vertices": {mesh.name: TRANSFER.evaluated_positions(mesh) for mesh in meshes},
            "deforms": {
                bone.name: {
                    "pose": TRANSFER.world_pose_matrix(target, bone.name).copy(),
                    "rest": (target.matrix_world @ bone.matrix_local).copy(),
                }
                for bone in target.data.bones if bone.use_deform
            },
        }
    before_objects = set(bpy.data.objects)
    before_actions = set(bpy.data.actions)
    if bpy.ops.import_scene.gltf(filepath=str(glb_path)) != {"FINISHED"}:
        raise RuntimeError("Ashveil Mixamo GLB could not be re-imported for parity")
    imported_objects = set(bpy.data.objects) - before_objects
    imported_actions = set(bpy.data.actions) - before_actions
    runtime_armatures = [obj for obj in imported_objects if obj.type == "ARMATURE"]
    runtime_meshes = [obj for obj in imported_objects if obj.type == "MESH"]
    runtime_action = next((item for item in imported_actions if item.name.startswith(OUTPUT_ACTION)), None)
    if len(runtime_armatures) != 1 or runtime_action is None:
        raise RuntimeError("Ashveil Mixamo runtime parity inventory is incomplete")
    runtime = runtime_armatures[0]
    BASE.assign_action(runtime, runtime_action)
    runtime_deform_map = {
        bone.name: RUNTIME_DEFORM_RENAMES.get(bone.name, bone.name)
        for bone in target.data.bones if bone.use_deform
    }
    if set(runtime_deform_map.values()) != {bone.name for bone in runtime.data.bones if bone.use_deform}:
        raise RuntimeError("Runtime deform inventory differs from the accepted target")
    vertex_errors = []
    hinge_errors = []
    roll_errors = []
    correspondence = {}
    topology = {}
    for source_name, source_positions in reference[0]["vertices"].items():
        candidates = [
            mesh for mesh in runtime_meshes
            if normalized_mesh_name(mesh.name) == normalized_mesh_name(source_name)
        ]
        if len(candidates) != 1:
            inventory = {mesh.name: len(mesh.data.vertices) for mesh in runtime_meshes}
            raise RuntimeError(f"Runtime mesh correspondence missing for {source_name}: {inventory}")
        correspondence[source_name] = candidates[0]
        topology[source_name] = {
            "runtimeMesh": candidates[0].name,
            "authorVertices": len(source_positions),
            "runtimeVertices": len(candidates[0].data.vertices),
            "gltfSplitVertexDelta": len(candidates[0].data.vertices) - len(source_positions),
        }
    for frame, sample in reference.items():
        bpy.context.scene.frame_set(frame)
        bpy.context.view_layer.update()
        for source_name, source_positions in sample["vertices"].items():
            vertex_errors.extend(split_aware_vertex_errors(
                source_positions,
                TRANSFER.evaluated_positions(correspondence[source_name]),
            ))
        for bone_name, source in sample["deforms"].items():
            runtime_pose_bone = runtime.pose.bones[runtime_deform_map[bone_name]]
            author_pose = source["pose"]
            author_rest = source["rest"]
            runtime_pose = runtime.matrix_world @ runtime_pose_bone.matrix
            runtime_rest = runtime.matrix_world @ runtime_pose_bone.bone.matrix_local
            author_skin = author_pose @ author_rest.inverted_safe()
            runtime_skin = runtime_pose @ runtime_rest.inverted_safe()
            author_rotation = author_skin.to_quaternion().normalized()
            runtime_rotation = runtime_skin.to_quaternion().normalized()
            error = TRANSFER.quaternion_angle_degrees(author_rotation, runtime_rotation)
            if bone_name.startswith(("leg_stretch", "forearm_stretch")):
                hinge_errors.append(error)
            roll_errors.append(TRANSFER.axial_error_degrees(author_rotation, runtime_rotation))
    result = {
        "measured": True,
        "jointComparisonSpace": "bind_relative_world_skin_transforms",
        "runtimeDeformMap": runtime_deform_map,
        "meshCorrespondence": topology,
        "vertexCorrespondencePolicy": "symmetric_nearest_surface_vertices_for_gltf_split_duplicates",
        "authorRuntimeHingeErrorDegrees": max(hinge_errors, default=0.0),
        "authorRuntimeRollErrorDegrees": max(roll_errors, default=0.0),
        "skinnedVertexP95Metres": TRANSFER.percentile(vertex_errors, 0.95),
        "skinnedVertexMaximumMetres": max(vertex_errors),
    }
    result["pass"] = (
        result["authorRuntimeHingeErrorDegrees"] <= 0.1
        and result["authorRuntimeRollErrorDegrees"] <= 0.1
        and result["skinnedVertexP95Metres"] <= 0.001
        and result["skinnedVertexMaximumMetres"] <= 0.002
    )
    for obj in imported_objects:
        bpy.data.objects.remove(obj, do_unlink=True)
    return result


def render_runtime(glb_path, output):
    before_objects = set(bpy.data.objects)
    before_actions = set(bpy.data.actions)
    if bpy.ops.import_scene.gltf(filepath=str(glb_path)) != {"FINISHED"}:
        raise RuntimeError("Ashveil Mixamo runtime GLB re-import failed")
    imported = set(bpy.data.objects) - before_objects
    armature = next((obj for obj in imported if obj.type == "ARMATURE"), None)
    meshes = [obj for obj in imported if obj.type == "MESH"]
    actions = set(bpy.data.actions) - before_actions
    action = next((item for item in actions if item.name.startswith(OUTPUT_ACTION)), None)
    body = next((mesh for mesh in meshes if mesh.name.startswith("Body")), None)
    if armature is None or body is None or action is None:
        raise RuntimeError("Ashveil Mixamo runtime render inventory is incomplete")
    BASE.assign_action(armature, action)
    for obj in bpy.data.objects:
        if obj.type == "MESH":
            obj.hide_render = obj not in meshes
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_WORKBENCH"
    scene.render.resolution_x = scene.render.resolution_y = 512
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    camera_data = bpy.data.cameras.new("AshveilMixamoRuntimeCamera")
    camera = bpy.data.objects.new("AshveilMixamoRuntimeCamera", camera_data)
    scene.collection.objects.link(camera)
    scene.camera = camera
    camera_data.type = "ORTHO"
    camera_data.ortho_scale = 2.15
    center = Vector((0.0, 0.0, 0.95))
    directory = output / "renders"
    directory.mkdir(parents=True, exist_ok=True)
    positions = {}
    paths = []
    for label, frame in SAMPLE_FRAMES.items():
        scene.frame_set(frame)
        bpy.context.view_layer.update()
        positions[frame] = PROCEDURAL.evaluated_positions(body)
        for view, location in {
            "front": Vector((0.0, -4.5, 1.05)),
            "right": Vector((4.5, 0.0, 1.05)),
            "back": Vector((0.0, 4.5, 1.05)),
        }.items():
            camera.location = location
            camera.rotation_mode = "QUATERNION"
            camera.rotation_quaternion = (center - location).to_track_quat("-Z", "Y")
            path = directory / f"ashveil-mixamo-walk-{frame:02d}-{view}.png"
            scene.render.filepath = str(path)
            bpy.ops.render.render(write_still=True)
            paths.append(path)
    reference = positions[0]
    displacement = {
        str(frame): max((actual - bind).length for actual, bind in zip(points, reference))
        for frame, points in positions.items()
    }
    front_hashes = {sha256(path) for path in paths if path.name.endswith("-front.png") and "-61-" not in path.name}
    result = {
        "frames": list(SAMPLE_FRAMES.values()),
        "views": ["front", "right", "back"],
        "renderCount": len(paths),
        "distinctNonterminalFrontRenderHashes": len(front_hashes),
        "maximumVertexDisplacementFromFrame0Metres": max(displacement.values()),
        "frameMaximumVertexDisplacementFromFrame0Metres": displacement,
        "artifacts": [BASE.artifact(path) for path in paths],
    }
    result["pass"] = len(paths) == 15 and len(front_hashes) == 4 and max(displacement.values()) >= 0.01
    return result


def main():
    args = parse_args()
    source_path = Path(args.source).resolve()
    output = Path(args.output).resolve()
    output.mkdir(parents=True, exist_ok=True)
    if args.source_sha256 != SOURCE_SHA256 or sha256(source_path) != SOURCE_SHA256:
        raise RuntimeError("Pinned Mixamo source checksum changed")
    target = bpy.data.objects.get("rig")
    if target is None or target.type != "ARMATURE" or len(target.data.bones) != 211:
        raise RuntimeError("Accepted Auto-Rig Pro target is missing")
    meshes = [
        obj for obj in bpy.data.objects
        if obj.type == "MESH" and any(mod.type == "ARMATURE" and mod.object == target for mod in obj.modifiers)
    ]
    body = bpy.data.objects.get("Body")
    if body not in meshes:
        raise RuntimeError("Accepted Body mesh is missing")
    head = bpy.data.objects.get("Head")
    if head not in meshes:
        raise RuntimeError("Accepted Head mesh is missing")
    BASE.clear_animation(target)
    state_before = BASE.target_state(target, meshes)
    bind_rotations = {
        name: (target.matrix_world @ target.pose.bones[name].matrix).to_quaternion().normalized()
        for name in AXIAL_LIMITS
    }
    bind_directions = {
        f"arm_stretch.{side}": (
            target.matrix_world.to_3x3() @ (
                target.data.bones[f"arm_stretch.{side}"].tail_local
                - target.data.bones[f"arm_stretch.{side}"].head_local
            )
        ).normalized()
        for side in ("l", "r")
    }
    forward = target_bind_forward(target)
    up = (target.matrix_world.to_3x3() @ Vector((0.0, 0.0, 1.0))).normalized()
    floor = min((body.matrix_world @ vertex.co).z for vertex in body.data.vertices)
    sole_patches = {side: PROCEDURAL.sole_patch(body, side) for side in ("l", "r")}
    frozen_head_seam = freeze_head_body_seam(body, head)
    deformation_patches, bind_positions = TRANSFER.frozen_deformation_patches(target, body)

    source, source_action = import_source(source_path)
    source_motion = source_root_motion(source, source_action)
    source_loop_original = source_loop_seam(source, source_action)
    source_loop_conditioning = condition_source_loop(source_action)
    source_loop = source_loop_seam(source, source_action)
    if not source_loop["pass"]:
        raise RuntimeError(f"Conditioned Mixamo source loop remains outside the frozen gate: {source_loop}")
    remap, mapped_controls = configure_remap(source, source_action, target)
    source_in_place_action, root_extraction = source_in_place_conversion(
        source, source_action, source_motion,
    )
    target.animation_data.action = None
    set_switches(target)
    action = BASE.retarget(source, source_in_place_action, target, SOURCE_FRAMES)
    action.name = OUTPUT_ACTION
    foot_calibration = calibrate_fk_feet(source, source_in_place_action, target, action)
    posture_calibration = {
        "enabled": False,
        "reason": "disabled_to_preserve_accepted_target_spine_pose",
        "targetControlsChanged": False,
        "pass": True,
    }
    key_switches(target, action)
    action_ownership = validate_control_action(target, action, mapped_controls)
    shift_to_zero(action)

    source_curves_before_grounding = curve_values(source_in_place_action)
    pre_ground_contact = {
        "measured": True,
        "sole": foot_contact(target, body, action, sole_patches, floor),
        "heelForefoot": heel_forefoot_contact(target, body, action, sole_patches, floor, forward),
    }
    grounding = ground_action(target, body, action, sole_patches, floor)
    grounding["sourceActionCurvesChanged"] = (
        curve_values(source_in_place_action) != source_curves_before_grounding
    )
    grounding["pass"] = grounding["pass"] and not grounding["sourceActionCurvesChanged"]
    if not grounding["pass"]:
        raise RuntimeError(f"Mixamo root grounding changed source action curves: {grounding}")
    BASE.remove_source(source, [source_action, source_in_place_action])
    root_net = target_root_net(target, action)
    axial = axial_twist(target, action, bind_rotations)
    knee = knee_hinge(target, action, forward)
    contact = foot_contact(target, body, action, sole_patches, floor)
    heel_forefoot = heel_forefoot_contact(target, body, action, sole_patches, floor, forward)
    toes = toe_alignment(target, action)
    seam = loop_seam(target, action)
    anatomy = gait_anatomy(target, action, bind_directions)
    posture = sagittal_posture(target, action, forward, up)
    head_seam = validate_head_body_seam(target, body, head, action, frozen_head_seam)
    clip_report = [{"id": "walk", "outputName": OUTPUT_ACTION, "outputSemanticFrames": SAMPLE_FRAMES}]
    try:
        deformation = TRANSFER.validate_mesh_deformation(
            target, body, [action], clip_report, deformation_patches, bind_positions,
        )
    except RuntimeError as error:
        deformation = {"measured": True, "pass": False, "failure": str(error)}
    state_after = BASE.target_state(target, meshes)
    bind_parity = {
        "before": state_before,
        "after": state_after,
        "maximumAcceptedBindChangeMetres": 0.0,
        "pass": state_before == state_after,
    }
    if not bind_parity["pass"]:
        raise RuntimeError("Mixamo retarget changed accepted bind/rest/weights")

    BASE.configure_export(bpy.context.scene, [action])
    bpy.context.scene.render.fps = FPS
    bpy.context.scene.render.fps_base = 1.0
    bpy.context.scene.arp_ge_master_traj = False
    bpy.context.scene.arp_twist_fac = 1.0
    BASE.assign_action(target, action)
    bpy.context.scene.frame_start = 0
    bpy.context.scene.frame_end = 61
    blend_path = output / "masculine-auto-rig-pro-mixamo-ashveil-wip.blend"
    glb_path = output / "masculine-auto-rig-pro-mixamo-ashveil-wip.glb"
    bpy.ops.wm.save_as_mainfile(filepath=str(blend_path))
    BASE.select([target, *meshes], target)
    export_result = bpy.ops.arp.arp_export_gltf_panel("EXEC_DEFAULT", filepath=str(glb_path), quick_export=True)
    if export_result != {"FINISHED"} or not glb_path.exists():
        raise RuntimeError(f"ARP Mixamo GLB export failed: {export_result}")
    glb = BASE.parse_glb(glb_path)
    runtime_inventory = {
        "jointCount": glb["joints"],
        "controlJoints": glb["controlJoints"],
        "pass": not glb["controlJoints"] and len(glb["animations"]) == 1,
    }
    try:
        parity = validate_runtime_parity(glb_path, target, meshes, action)
        joint_parity = {
            "maximumHingeErrorDegrees": parity["authorRuntimeHingeErrorDegrees"],
            "maximumRollErrorDegrees": parity["authorRuntimeRollErrorDegrees"],
            "pass": parity["authorRuntimeHingeErrorDegrees"] <= 0.1 and parity["authorRuntimeRollErrorDegrees"] <= 0.1,
        }
        vertex_parity = {
            "p95Metres": parity["skinnedVertexP95Metres"],
            "maximumMetres": parity["skinnedVertexMaximumMetres"],
            "pass": parity["skinnedVertexP95Metres"] <= 0.001 and parity["skinnedVertexMaximumMetres"] <= 0.002,
        }
    except RuntimeError as error:
        joint_parity = {"measured": True, "pass": False, "failure": str(error)}
        vertex_parity = {"measured": True, "pass": False, "failure": str(error)}
    runtime = render_runtime(glb_path, output)
    gates = {
        "sourceRootMotion": source_motion,
        "sourceLoopSeam": source_loop,
        "mapping": remap,
        "actionOwnership": action_ownership,
        "rootMotionExtraction": root_extraction,
        "footRotationCalibration": foot_calibration,
        "postureCalibration": posture_calibration,
        "groundPlacement": grounding,
        "targetRootNet": root_net,
        "bindPoseParity": bind_parity,
        "bindRelativeAxialTwist": axial,
        "kneeHingeDirection": knee,
        "footContact": contact,
        "heelForefootContact": heel_forefoot,
        "toeAlignment": toes,
        "loopSeam": seam,
        "shoulderWristContinuity": anatomy,
        "sagittalPosture": posture,
        "headBodySeam": head_seam,
        "meshDeformation": deformation,
        "runtimeInventory": runtime_inventory,
        "authorRuntimeJointParity": joint_parity,
        "skinnedVertexParity": vertex_parity,
        "runtimeRenderEvidence": runtime,
    }
    failed = [name for name, gate in gates.items() if not gate["pass"]]
    report = {
        "schemaVersion": "ashveil.auto-rig-pro-mixamo-ashveil.v1",
        "status": "diagnostic_candidate" if not failed else "diagnostic_rejected",
        "objectiveAcceptance": {"pass": not failed, "failedGates": failed},
        "source": {
            "file": source_path.name,
            "sha256": SOURCE_SHA256,
            "bytes": source_path.stat().st_size,
            "bones": 65,
            "meshes": 0,
            "frames": SOURCE_FRAMES,
            "fps": FPS,
            "rootMotion": source_motion,
            "originalLoopSeam": source_loop_original,
            "loopConditioning": source_loop_conditioning,
            "conditionedLoopSeam": source_loop,
            "pass": True,
        },
        "autoRigPro": {**BASE.arp_installation(), **remap},
        "preGroundContact": pre_ground_contact,
        **gates,
        "export": {
            "arpExporterOnly": True,
            "sourceMeshesExported": False,
            "actions": [{
                "name": OUTPUT_ACTION, "frames": SOURCE_FRAMES, "fps": FPS,
                "durationSeconds": (SOURCE_FRAMES - 1) / FPS,
            }],
            "gltfStructure": glb,
            "runtimeInventory": runtime_inventory,
        },
        "humanReview": {"pass": False, "required": True},
        "productionPass": False,
        "canonicalViewerPromoted": False,
        "artifacts": [BASE.artifact(blend_path), BASE.artifact(glb_path), *runtime["artifacts"]],
    }
    (output / "report.json").write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    if failed:
        raise RuntimeError(f"Ashveil Mixamo candidate failed objective gates: {failed}")


if __name__ == "__main__":
    main()
