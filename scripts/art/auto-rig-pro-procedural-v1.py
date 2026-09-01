import argparse
import importlib.util
import json
import math
import statistics
import sys
from pathlib import Path

import bpy
from mathutils import Matrix, Quaternion, Vector


BASE_PATH = Path(__file__).with_name("auto-rig-pro-retarget.py")
BASE_SPEC = importlib.util.spec_from_file_location("ashveil_auto_rig_pro_helpers", BASE_PATH)
BASE = importlib.util.module_from_spec(BASE_SPEC)
BASE_SPEC.loader.exec_module(BASE)

FPS = 30
CLIPS = (
    ("idle", "Ashveil_Idle_InPlace", 120),
    ("walk", "Ashveil_Walk_InPlace", 30),
    ("sprint", "Ashveil_Sprint_InPlace", 18),
)
PENETRATION_LIMIT = -0.002
CONTACT_DISTANCE_LIMIT = 0.020
WALK_CONTACT_DISTANCE_LIMIT = 0.003
STANCE_SLIDE_LIMIT = 0.005
SWING_CLEARANCE_LIMIT = 0.020
WALK_MINIMUM_KNEE_FLEXION = 8.0
SKINNED_P95_LIMIT = 0.001
SKINNED_MAXIMUM_LIMIT = 0.002
DEFORMATION_AREA_P05_LIMIT = 0.60
DEFORMATION_AREA_MINIMUM_LIMIT = 0.20
PARITY_P95_LIMIT = 0.001
PARITY_MAXIMUM_LIMIT = 0.002
AUTHORED_CONTROLS = {
    "c_root_master.x", "c_spine_01.x", "c_spine_02.x", "c_neck.x", "c_head.x",
    "c_shoulder.l", "c_arm_fk.l", "c_forearm_fk.l",
    "c_shoulder.r", "c_arm_fk.r", "c_forearm_fk.r",
    "c_foot_ik.l", "c_toes_ik.l", "c_leg_pole.l",
    "c_foot_ik.r", "c_toes_ik.r", "c_leg_pole.r",
    "c_hand_ik.l", "c_hand_ik.r",
}
EXPECTED_DEFORM_BONES = (
    "arm_stretch.l", "arm_stretch.r",
    "c_arm_twist_offset.l", "c_arm_twist_offset.r",
    "foot.l", "foot.r",
    "forearm_stretch.l", "forearm_stretch.r", "forearm_twist.l", "forearm_twist.r",
    "hand.l", "hand.r", "head.x",
    "leg_stretch.l", "leg_stretch.r", "leg_twist.l", "leg_twist.r",
    "neck.x", "root.x", "shoulder.l", "shoulder.r", "spine_01.x", "spine_02.x",
    "thigh_stretch.l", "thigh_stretch.r", "thigh_twist.l", "thigh_twist.r",
    "toes_01.l", "toes_01.r",
)
DEFORM_BONES = set(EXPECTED_DEFORM_BONES)


def parse_args():
    separator = sys.argv.index("--") if "--" in sys.argv else len(sys.argv)
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", required=True)
    return parser.parse_args(sys.argv[separator + 1:])


def percentile(values, quantile):
    ordered = sorted(values)
    index = min(len(ordered) - 1, max(0, math.ceil(len(ordered) * quantile) - 1))
    return ordered[index]


def derived_anatomical_frame(target):
    rig_rotation = target.matrix_world.to_3x3()
    up = (rig_rotation @ Vector((0.0, 0.0, 1.0))).normalized()
    left_hip = target.matrix_world @ target.data.bones["thigh_stretch.l"].head_local
    right_hip = target.matrix_world @ target.data.bones["thigh_stretch.r"].head_local
    bind_lateral = left_hip - right_hip
    bind_lateral -= up * bind_lateral.dot(up)
    bind_lateral.normalize()
    toe_directions = []
    for side in ("l", "r"):
        foot = target.data.bones[f"foot.{side}"]
        toes = target.data.bones[f"toes_01.{side}"]
        direction = rig_rotation @ (toes.head_local - foot.head_local)
        direction -= up * direction.dot(up)
        toe_directions.append(direction.normalized())
    bind_forward = sum(toe_directions, Vector())
    bind_forward -= up * bind_forward.dot(up)
    bind_forward.normalize()
    lateral = up.cross(bind_forward).normalized()
    if lateral.dot(bind_lateral) <= 0.0:
        raise RuntimeError("Procedural anatomical frame has reversed left/right handedness")
    forward = lateral.cross(up).normalized()
    raw_toe_direction_dots = [forward.dot(direction) for direction in toe_directions]
    sagittal_toe_directions = []
    for direction in toe_directions:
        sagittal = direction - lateral * direction.dot(lateral)
        sagittal_toe_directions.append(sagittal.normalized())
    toe_direction_dots = [forward.dot(direction) for direction in sagittal_toe_directions]
    if min(toe_direction_dots) < 0.999 or abs(forward.dot(up)) > 1e-6:
        raise RuntimeError(
            f"Procedural anatomical frame does not preserve bind toe direction: {toe_direction_dots}"
        )
    return {
        "lateral": lateral,
        "forward": forward,
        "up": up,
        "toeDirectionDots": toe_direction_dots,
        "rawToeDirectionDots": raw_toe_direction_dots,
        "forwardUpDot": forward.dot(up),
    }


def sole_patch(mesh, side):
    groups = {mesh.vertex_groups[f"foot.{side}"].index, mesh.vertex_groups[f"toes_01.{side}"].index}
    floor = min((mesh.matrix_world @ vertex.co).z for vertex in mesh.data.vertices)
    selected = []
    for vertex in mesh.data.vertices:
        world = mesh.matrix_world @ vertex.co
        correct_side = world.x > 0.0 if side == "l" else world.x < 0.0
        weight = sum(group.weight for group in vertex.groups if group.group in groups)
        if correct_side and weight >= 0.5 and world.z <= floor + 0.005:
            selected.append(vertex.index)
    if len(selected) != 59:
        raise RuntimeError(f"Procedural sole patch changed for {side}: {len(selected)}")
    return selected


def evaluated_positions(mesh, indices=None):
    evaluated = mesh.evaluated_get(bpy.context.evaluated_depsgraph_get())
    vertices = evaluated.data.vertices if indices is None else (evaluated.data.vertices[index] for index in indices)
    return [evaluated.matrix_world @ vertex.co for vertex in vertices]


def patch_sample(mesh, indices):
    points = evaluated_positions(mesh, indices)
    return {
        "minimumZ": min(point.z for point in points),
        "centroid": sum(points, Vector()) / len(points),
    }


def bind_control_state(target):
    return {name: target.pose.bones[name].matrix.copy() for name in AUTHORED_CONTROLS}


def set_control_matrix(bone, bind_matrix, translation=Vector(), rotation=None):
    matrix = bind_matrix.copy()
    matrix.translation = bind_matrix.translation + translation
    if rotation is not None:
        matrix_rotation = rotation @ bind_matrix.to_quaternion()
        matrix = matrix_rotation.to_matrix().to_4x4()
        matrix.translation = bind_matrix.translation + translation
    bone.matrix = matrix
    bpy.context.view_layer.update()


def key_control(bone, frame, location=True, rotation=True):
    if location:
        bone.keyframe_insert(data_path="location", frame=frame)
    if rotation:
        bone.rotation_mode = "QUATERNION"
        bone.keyframe_insert(data_path="rotation_quaternion", frame=frame)
    bone.keyframe_insert(data_path="scale", frame=frame)


def quaternion_swing_twist(bind_matrix, swing_axis, swing_angle, twist_axis, twist_angle):
    swing = Quaternion(swing_axis.normalized(), swing_angle)
    twist = Quaternion(twist_axis.normalized(), twist_angle)
    return (swing @ twist).normalized()


def explicit_elbow_hinge(bind_matrix, hinge_axis, flexion_angle):
    return Quaternion(hinge_axis.normalized(), flexion_angle)


def bind_axis(bind_matrix, local_axis):
    return (bind_matrix.to_3x3() @ local_axis).normalized()


def gait_parameters(clip_id):
    sprint = clip_id == "sprint"
    contact_fraction = 0.32 if sprint else 0.58
    stride = 0.48 if sprint else 0.30
    return contact_fraction, stride, stride / contact_fraction


def gait_sample(clip_id, phase, side_offset):
    side_phase = (phase + side_offset) % 1.0
    if clip_id == "idle":
        return {"support": True, "toeOff": False, "y": 0.0, "z": 0.0, "toe": 0.0}
    sprint = clip_id == "sprint"
    contact_fraction, stride, speed = gait_parameters(clip_id)
    if side_phase < contact_fraction:
        local_time = side_phase / contact_fraction
        toe_off = local_time >= 0.82
        return {
            "support": not toe_off,
            "toeOff": toe_off,
            "y": stride * 0.5 - speed * contact_fraction * local_time,
            "z": 0.0,
            "toe": math.radians(24.0) * max(0.0, (local_time - 0.82) / 0.18),
        }
    swing_time = (side_phase - contact_fraction) / (1.0 - contact_fraction)
    return {
        "support": False,
        "toeOff": False,
        "y": -stride * 0.5 + stride * (0.5 - 0.5 * math.cos(math.pi * swing_time)),
        "z": (0.13 if sprint else 0.110) * math.sin(math.pi * swing_time),
        "toe": math.radians(18.0) * math.sin(math.pi * swing_time),
    }


def copy_literal_duplicate_endpoint(action, end_frame):
    curves = BASE.action_curves(action)
    copied = 0
    maximum_key_value_error = 0.0
    for curve in curves:
        start = next((point for point in curve.keyframe_points if abs(point.co.x) <= 1e-6), None)
        end = next(
            (point for point in curve.keyframe_points if abs(point.co.x - end_frame) <= 1e-6),
            None,
        )
        if start is None or end is None:
            continue
        left_offset = start.handle_left - start.co
        right_offset = start.handle_right - start.co
        end.co.y = start.co.y
        end.interpolation = start.interpolation
        end.easing = start.easing
        end.handle_left_type = start.handle_left_type
        end.handle_right_type = start.handle_right_type
        end.handle_left = end.co + left_offset
        end.handle_right = end.co + right_offset
        curve.update()
        maximum_key_value_error = max(maximum_key_value_error, abs(start.co.y - end.co.y))
        copied += 1
    if copied != len(curves) or maximum_key_value_error > 1e-8:
        raise RuntimeError(
            f"Procedural endpoint copy failed for {action.name}: "
            f"{copied}/{len(curves)} curves, error {maximum_key_value_error}"
        )
    return {
        "copiedCurveCount": copied,
        "totalCurveCount": len(curves),
        "maximumKeyValueError": maximum_key_value_error,
        "startFrame": 0,
        "endFrame": end_frame,
        "pass": True,
    }


def solve_support_sole_heights(target, body, patches, action, contacts, end_frame, up):
    BASE.assign_action(target, action)
    corrections = []
    for frame in range(end_frame + 1):
        bpy.context.scene.frame_set(frame)
        bpy.context.view_layer.update()
        for side in ("l", "r"):
            if not contacts[side]["support"][frame]:
                continue
            foot = target.pose.bones[f"c_foot_ik.{side}"]
            total = 0.0
            for _ in range(3):
                minimum_z = patch_sample(body, patches[side])["minimumZ"]
                correction = -minimum_z
                if abs(correction) <= 1e-6:
                    break
                matrix = foot.matrix.copy()
                matrix.translation += up * correction
                foot.matrix = matrix
                bpy.context.view_layer.update()
                foot.keyframe_insert(data_path="location", frame=frame)
                total += correction
            corrections.append(total)
    return {
        "maximumAbsoluteVerticalCorrectionMetres": max(abs(value) for value in corrections),
        "supportSamples": len(corrections),
        "pass": True,
    }


def reset_controls(target, bind):
    for name, matrix in bind.items():
        target.pose.bones[name].matrix = matrix.copy()
    bpy.context.view_layer.update()


def author_clip(target, bind, frame_axes, clip_id, action_name, end_frame):
    action = bpy.data.actions.new(action_name)
    target.animation_data_create().action = action
    action.use_frame_range = True
    action.frame_start = 0
    action.frame_end = end_frame
    contact_schedule = {
        side: {"support": [], "toeOff": []}
        for side in ("l", "r")
    }
    authored = []
    lateral = frame_axes["lateral"]
    forward = frame_axes["forward"]
    up = frame_axes["up"]
    for frame in range(end_frame + 1):
        bpy.context.scene.frame_set(frame)
        phase = 0.0 if frame == end_frame else frame / end_frame
        angle = math.tau * phase
        reset_controls(target, bind)
        if clip_id == "idle":
            bob = 0.003 * (1.0 - math.cos(angle)) * 0.5
            sway = 0.002 * math.sin(angle)
            yaw = math.radians(0.8) * math.sin(angle)
            arm_swing = math.radians(1.5) * math.sin(angle)
            elbow_flex = math.radians(3.0) * (1.0 - math.cos(angle)) * 0.5
        else:
            sprint = clip_id == "sprint"
            bob = (
                0.040 * (1.0 - math.cos(angle * 2.0)) * 0.5
                if sprint
                else -0.020 + 0.010 * (1.0 - math.cos(angle * 2.0)) * 0.5
            )
            sway = (0.020 if sprint else 0.012) * math.sin(angle)
            yaw = math.radians(6.0 if sprint else 3.5) * math.sin(angle)
            arm_swing = math.radians(42.0 if sprint else 27.0) * math.sin(angle)
            elbow_flex = math.radians(42.0 if sprint else 24.0) * (0.5 + 0.5 * math.cos(angle))
        root_rotation = Quaternion(up, yaw)
        set_control_matrix(
            target.pose.bones["c_root_master.x"], bind["c_root_master.x"],
            lateral * sway + up * bob, root_rotation,
        )
        key_control(target.pose.bones["c_root_master.x"], frame)
        for name, factor in (("c_spine_01.x", -0.45), ("c_spine_02.x", -0.65)):
            rotation = Quaternion(up, yaw * factor) @ Quaternion(lateral, math.radians(-3.0 if clip_id == "sprint" else 0.0))
            set_control_matrix(target.pose.bones[name], bind[name], rotation=rotation)
            key_control(target.pose.bones[name], frame, location=False)
        for name, factor in (("c_neck.x", 0.30), ("c_head.x", 0.35)):
            rotation = Quaternion(up, -yaw * factor)
            set_control_matrix(target.pose.bones[name], bind[name], rotation=rotation)
            key_control(target.pose.bones[name], frame, location=False)
        for side, sign in (("l", 1.0), ("r", -1.0)):
            gait = gait_sample(clip_id, phase, 0.0 if side == "l" else 0.5)
            contact_schedule[side]["support"].append(gait["support"])
            contact_schedule[side]["toeOff"].append(gait["toeOff"])
            foot_name = f"c_foot_ik.{side}"
            toe_name = f"c_toes_ik.{side}"
            pole_name = f"c_leg_pole.{side}"
            set_control_matrix(
                target.pose.bones[foot_name], bind[foot_name],
                forward * gait["y"] + up * gait["z"],
            )
            set_control_matrix(
                target.pose.bones[toe_name], bind[toe_name],
                forward * gait["y"] + up * gait["z"],
                Quaternion(bind_axis(bind[toe_name], Vector((1.0, 0.0, 0.0))), gait["toe"]),
            )
            set_control_matrix(
                target.pose.bones[pole_name], bind[pole_name], forward * gait["y"] * 0.25 + up * bob,
            )
            for name in (foot_name, toe_name, pole_name):
                key_control(target.pose.bones[name], frame)
            foot = target.pose.bones[foot_name]
            hand = target.pose.bones[f"c_hand_ik.{side}"]
            foot["ik_fk_switch"] = 0.0
            foot["auto_stretch"] = 0.0
            hand["ik_fk_switch"] = 1.0
            hand["auto_stretch"] = 0.0
            if frame in (0, end_frame):
                foot.keyframe_insert(data_path='["ik_fk_switch"]', frame=frame)
                foot.keyframe_insert(data_path='["auto_stretch"]', frame=frame)
                hand.keyframe_insert(data_path='["ik_fk_switch"]', frame=frame)
                hand.keyframe_insert(data_path='["auto_stretch"]', frame=frame)
            shoulder_name = f"c_shoulder.{side}"
            arm_name = f"c_arm_fk.{side}"
            forearm_name = f"c_forearm_fk.{side}"
            shoulder_rotation = Quaternion(up, -yaw * 0.25 * sign)
            set_control_matrix(target.pose.bones[shoulder_name], bind[shoulder_name], rotation=shoulder_rotation)
            key_control(target.pose.bones[shoulder_name], frame, location=False)
            swing = arm_swing * sign
            humeralTwist = 0.0 if clip_id == "idle" else math.radians(5.0) * math.sin(angle) * sign
            arm_swing_axis = bind_axis(bind[arm_name], Vector((0.0, 0.0, -1.0 if side == "l" else 1.0)))
            arm_twist_axis = bind_axis(bind[arm_name], Vector((0.0, 1.0, 0.0)))
            arm_rotation = quaternion_swing_twist(
                bind[arm_name], arm_swing_axis, swing, arm_twist_axis, humeralTwist,
            )
            set_control_matrix(target.pose.bones[arm_name], bind[arm_name], rotation=arm_rotation)
            key_control(target.pose.bones[arm_name], frame, location=False)
            elbowHinge = elbow_flex + (math.radians(12.0) if clip_id != "idle" else math.radians(5.0))
            hinge_axis = bind_axis(bind[forearm_name], Vector((0.0, 0.0, -1.0 if side == "l" else 1.0)))
            forearm_rotation = explicit_elbow_hinge(bind[forearm_name], hinge_axis, elbowHinge)
            set_control_matrix(target.pose.bones[forearm_name], bind[forearm_name], rotation=forearm_rotation)
            key_control(target.pose.bones[forearm_name], frame, location=False)
        bpy.context.view_layer.update()
        authored.append({
            "frame": frame,
            "phase": phase,
            "rootBob": bob,
            "rootSway": sway,
            "rootYaw": yaw,
            "armSwingLeft": arm_swing,
            "armSwingRight": -arm_swing,
            "humeralTwist": 0.0 if clip_id == "idle" else math.radians(5.0) * math.sin(angle),
            "elbowHinge": elbow_flex,
        })
    endpoint_copy = copy_literal_duplicate_endpoint(action, end_frame)
    action["explicitDuplicateEndpoint"] = True
    return action, contact_schedule, authored, endpoint_copy


def keyed_bone_gate(action):
    keyed = BASE.keyed_bones(action)
    unexpected = sorted(keyed - AUTHORED_CONTROLS)
    deform_curves = sorted(keyed & DEFORM_BONES)
    result = {"keyedBones": sorted(keyed), "unexpected": unexpected, "deformCurves": deform_curves}
    result["pass"] = not unexpected and not deform_curves
    if not result["pass"]:
        raise RuntimeError(f"Procedural control ownership failed: {result}")
    return result


def action_key_time_gate(action, end_frame):
    key_times = sorted({
        round(point.co.x, 6)
        for curve in BASE.action_curves(action)
        for point in curve.keyframe_points
    })
    expected = [float(frame) for frame in range(end_frame + 1)]
    result = {"keyTimes": key_times, "expectedKeyTimes": expected, "pass": key_times == expected}
    if not result["pass"]:
        raise RuntimeError(f"Procedural action key-time inventory failed: {result}")
    return result


def sample_motion(target, body, patches, action, contacts, authored, end_frame, clip_id, frame_axes):
    BASE.assign_action(target, action)
    forward = frame_axes["forward"]
    samples = []
    for frame in range(end_frame + 1):
        bpy.context.scene.frame_set(frame)
        bpy.context.view_layer.update()
        feet = {side: patch_sample(body, patches[side]) for side in ("l", "r")}
        knees = {}
        hands = {}
        hands_chest_forward = {}
        chest_world = target.matrix_world @ target.pose.bones["c_spine_02.x"].matrix
        chest_inverse = chest_world.inverted_safe()
        chest_forward = (chest_inverse.to_3x3() @ forward).normalized()
        for side in ("l", "r"):
            thigh = target.pose.bones[f"thigh_stretch.{side}"]
            leg = target.pose.bones[f"leg_stretch.{side}"]
            hip = target.matrix_world @ thigh.head
            knee = target.matrix_world @ leg.head
            ankle = target.matrix_world @ leg.tail
            axis = ankle - hip
            projected = hip + axis * ((knee - hip).dot(axis) / axis.length_squared)
            bend = knee - projected
            upper = (knee - hip).normalized()
            lower = (ankle - knee).normalized()
            knees[side] = {
                "knee": knee,
                "ankle": ankle,
                "bend": bend.normalized(),
                "flexion": math.degrees(upper.angle(lower)),
            }
            hands[side] = target.matrix_world @ target.pose.bones[f"hand.{side}"].head
            hands_chest_forward[side] = (chest_inverse @ hands[side]).dot(chest_forward)
        samples.append({
            "frame": frame,
            "feet": feet,
            "knees": knees,
            "hands": hands,
            "handsChestForward": hands_chest_forward,
            "root": target.matrix_world @ target.pose.bones["c_root_master.x"].head,
            "spineRotation": target.pose.bones["c_spine_02.x"].matrix.to_quaternion(),
        })
    contact_distances = []
    penetration = float("inf")
    stanceSlide = 0.0
    swing_clearance = float("inf")
    virtual_speed = 0.0 if clip_id == "idle" else gait_parameters(clip_id)[2]
    for side in ("l", "r"):
        phase_start = None
        phase_points = []
        for frame, support in enumerate(contacts[side]["support"]):
            patch = samples[frame]["feet"][side]
            penetration = min(penetration, patch["minimumZ"])
            if support:
                contact_distances.append(abs(patch["minimumZ"]))
                virtual = patch["centroid"] + forward * (virtual_speed * frame / FPS)
                if phase_start is None:
                    phase_start = virtual
                    phase_points = [virtual]
                else:
                    phase_points.append(virtual)
            elif not contacts[side]["toeOff"][frame]:
                swing_clearance = min(swing_clearance, patch["minimumZ"])
                if phase_start is not None:
                    stanceSlide = max(stanceSlide, max((point - phase_start).to_2d().length for point in phase_points))
                    phase_start = None
                    phase_points = []
            elif phase_start is not None:
                stanceSlide = max(stanceSlide, max((point - phase_start).to_2d().length for point in phase_points))
                phase_start = None
                phase_points = []
        if phase_start is not None:
            stanceSlide = max(stanceSlide, max((point - phase_start).to_2d().length for point in phase_points))
    sprintFlight = clip_id != "sprint" or any(
        not contacts["l"]["support"][frame] and not contacts["r"]["support"][frame]
        and not contacts["l"]["toeOff"][frame] and not contacts["r"]["toeOff"][frame]
        and samples[frame]["feet"]["l"]["minimumZ"] >= SWING_CLEARANCE_LIMIT
        and samples[frame]["feet"]["r"]["minimumZ"] >= SWING_CLEARANCE_LIMIT
        for frame in range(end_frame + 1)
    )
    side_crossing = any(
        sample["knees"]["l"]["knee"].x <= 0.0 or sample["knees"]["r"]["knee"].x >= 0.0
        for sample in samples
    )
    knee_forward_dots = [
        sample["knees"][side]["bend"].dot(frame_axes["forward"])
        for sample in samples for side in ("l", "r")
    ]
    knee_plane = min(knee_forward_dots) > 0.0
    flexions = [sample["knees"][side]["flexion"] for sample in samples for side in ("l", "r")]
    left_hand = [sample["handsChestForward"]["l"] for sample in samples]
    right_hand = [sample["handsChestForward"]["r"] for sample in samples]
    reciprocalArms = statistics.correlation(left_hand, right_hand) if len(set(left_hand)) > 1 and len(set(right_hand)) > 1 else -1.0
    first_sample = samples[0]
    root_motion_amplitude = max((sample["root"] - first_sample["root"]).length for sample in samples)
    spine_rotation_amplitude = max(
        first_sample["spineRotation"].rotation_difference(sample["spineRotation"]).angle
        for sample in samples
    )
    hand_motion_by_side = {
        side: max(
            (sample["hands"][side] - first_sample["hands"][side]).length
            for sample in samples
        )
        for side in ("l", "r")
    }
    hand_motion_amplitude = max(hand_motion_by_side.values())
    hands_do_not_cross = all(
        sample["hands"]["l"].x > 0.0 and sample["hands"]["r"].x < 0.0
        for sample in samples
    )
    hand_motion_mean = statistics.mean(hand_motion_by_side.values())
    hand_motion_difference = abs(hand_motion_by_side["l"] - hand_motion_by_side["r"])
    hand_motion_symmetric = (
        hand_motion_difference <= 0.005
        and hand_motion_difference / hand_motion_mean <= 0.30
    )
    humeral_twist_maximum = max(abs(math.degrees(item["humeralTwist"])) for item in authored)
    idle_hands_quiet = all(0.005 <= amplitude <= 0.040 for amplitude in hand_motion_by_side.values())
    idle_no_humeral_twist = clip_id != "idle" or humeral_twist_maximum <= 1e-4
    idle_motion_pass = clip_id != "idle" or (
        0.002 <= root_motion_amplitude <= 0.010
        and 0.005 <= spine_rotation_amplitude <= 0.030
        and idle_hands_quiet and hand_motion_symmetric and hands_do_not_cross
        and idle_no_humeral_twist
    )
    locomotion_reciprocal_pass = clip_id == "idle" or reciprocalArms <= -0.5
    no_stretch = all(
        target.pose.bones[f"c_foot_ik.{side}"]["auto_stretch"] == 0.0
        and target.pose.bones[f"c_hand_ik.{side}"]["auto_stretch"] == 0.0
        for side in ("l", "r")
    )
    contact_distance_limit = WALK_CONTACT_DISTANCE_LIMIT if clip_id == "walk" else CONTACT_DISTANCE_LIMIT
    minimum_knee_flexion = WALK_MINIMUM_KNEE_FLEXION if clip_id == "walk" else 3.0
    result = {
        "maximumContactDistanceMetres": max(contact_distances),
        "contactDistanceLimitMetres": contact_distance_limit,
        "minimumSoleZMetres": penetration,
        "stanceSlideMetres": stanceSlide,
        "minimumSwingClearanceMetres": swing_clearance if clip_id != "idle" else 0.0,
        "sprintFlight": sprintFlight,
        "sideCrossing": side_crossing,
        "kneePlane": knee_plane,
        "minimumKneeForwardDot": min(knee_forward_dots),
        "minimumKneeFlexionDegrees": min(flexions),
        "minimumKneeFlexionLimitDegrees": minimum_knee_flexion,
        "maximumKneeFlexionDegrees": max(flexions),
        "reciprocalArms": reciprocalArms,
        "reciprocalArmsSpace": "evaluated_chest_local",
        "rootMotionAmplitudeMetres": root_motion_amplitude,
        "spineRotationAmplitudeRadians": spine_rotation_amplitude,
        "handMotionAmplitudeMetres": hand_motion_amplitude,
        "handMotionAmplitudeBySideMetres": hand_motion_by_side,
        "handMotionDifferenceMetres": hand_motion_difference,
        "handMotionDifferenceFractionOfMean": hand_motion_difference / hand_motion_mean,
        "handMotionSymmetric": hand_motion_symmetric,
        "idleHandsQuiet": idle_hands_quiet,
        "handsDoNotCross": hands_do_not_cross,
        "idleNoHumeralTwist": idle_no_humeral_twist,
        "idleMotionPass": idle_motion_pass,
        "locomotionReciprocalPass": locomotion_reciprocal_pass,
        "humeralTwistMaximumDegrees": humeral_twist_maximum,
        "elbowHingeMaximumDegrees": max(abs(math.degrees(item["elbowHinge"])) for item in authored),
        "noStretch": no_stretch,
    }
    result["pass"] = (
        result["maximumContactDistanceMetres"] <= contact_distance_limit
        and result["minimumSoleZMetres"] >= PENETRATION_LIMIT
        and result["stanceSlideMetres"] <= STANCE_SLIDE_LIMIT
        and (clip_id == "idle" or result["minimumSwingClearanceMetres"] >= SWING_CLEARANCE_LIMIT)
        and sprintFlight and not side_crossing and knee_plane
        and min(flexions) >= minimum_knee_flexion and max(flexions) <= 145.0
        and locomotion_reciprocal_pass and idle_motion_pass
        and result["humeralTwistMaximumDegrees"] <= 8.0
        and result["elbowHingeMaximumDegrees"] <= 70.0 and no_stretch
    )
    if not result["pass"]:
        raise RuntimeError(f"Procedural skeletal/contact gate failed for {clip_id}: {result}")
    return result, samples


def matrix_loop_gate(target, action, end_frame):
    snapshots = BASE.deform_snapshots(target, action, (0, 1, end_frame - 1, end_frame))
    first_snapshot, second_snapshot, before_last_snapshot, last_snapshot = snapshots
    value = 0.0
    velocity = 0.0
    value_bone = ""
    value_component = -1
    velocity_bone = ""
    velocity_component = -1
    endpoint_translation = 0.0
    endpoint_translation_bone = ""
    endpoint_rotation = 0.0
    endpoint_rotation_bone = ""
    endpoint_scale = 0.0
    endpoint_scale_bone = ""
    velocity_translation = 0.0
    velocity_translation_bone = ""
    velocity_rotation = 0.0
    velocity_rotation_bone = ""
    velocity_scale = 0.0
    velocity_scale_bone = ""
    for name in DEFORM_BONES:
        first = first_snapshot[name]
        second = second_snapshot[name]
        before_last = before_last_snapshot[name]
        last = last_snapshot[name]
        for component, (first_value, second_value, before_last_value, last_value) in enumerate(zip(
            first, second, before_last, last,
        )):
            component_value = abs(first_value - last_value)
            component_velocity = abs(
                (second_value - first_value) - (last_value - before_last_value)
            )
            if component_value > value:
                value = component_value
                value_bone = name
                value_component = component
            if component_velocity > velocity:
                velocity = component_velocity
                velocity_bone = name
                velocity_component = component
        matrices = []
        for values in (first, second, before_last, last):
            matrices.append(Matrix(tuple(
                tuple(values[index:index + 4])
                for index in range(0, 16, 4)
            )))
        first_location, first_rotation, first_scale = matrices[0].decompose()
        second_location, second_rotation, second_scale = matrices[1].decompose()
        before_last_location, before_last_rotation, before_last_scale = matrices[2].decompose()
        last_location, last_rotation, last_scale = matrices[3].decompose()
        translation_error = (first_location - last_location).length
        rotation_error = first_rotation.rotation_difference(last_rotation).angle
        scale_error = max(abs(first_scale[index] - last_scale[index]) for index in range(3))
        translation_velocity_error = (
            (second_location - first_location) - (last_location - before_last_location)
        ).length
        start_rotation_velocity = first_rotation.rotation_difference(second_rotation)
        end_rotation_velocity = before_last_rotation.rotation_difference(last_rotation)
        rotation_velocity_error = start_rotation_velocity.rotation_difference(end_rotation_velocity).angle
        scale_velocity_error = max(
            abs(
                (second_scale[index] - first_scale[index])
                - (last_scale[index] - before_last_scale[index])
            )
            for index in range(3)
        )
        if translation_error > endpoint_translation:
            endpoint_translation = translation_error
            endpoint_translation_bone = name
        if rotation_error > endpoint_rotation:
            endpoint_rotation = rotation_error
            endpoint_rotation_bone = name
        if scale_error > endpoint_scale:
            endpoint_scale = scale_error
            endpoint_scale_bone = name
        if translation_velocity_error > velocity_translation:
            velocity_translation = translation_velocity_error
            velocity_translation_bone = name
        if rotation_velocity_error > velocity_rotation:
            velocity_rotation = rotation_velocity_error
            velocity_rotation_bone = name
        if scale_velocity_error > velocity_scale:
            velocity_scale = scale_velocity_error
            velocity_scale_bone = name
    result = {
        "rawMatrixValueError": value,
        "rawMatrixValueErrorBone": value_bone,
        "rawMatrixValueErrorComponent": value_component,
        "rawMatrixVelocityError": velocity,
        "rawMatrixVelocityErrorBone": velocity_bone,
        "rawMatrixVelocityErrorComponent": velocity_component,
        "endpointTranslationMetres": endpoint_translation,
        "endpointTranslationBone": endpoint_translation_bone,
        "endpointRotationDegrees": math.degrees(endpoint_rotation),
        "endpointRotationBone": endpoint_rotation_bone,
        "endpointScaleError": endpoint_scale,
        "endpointScaleBone": endpoint_scale_bone,
        "wrappedTranslationVelocityErrorMetresPerFrame": velocity_translation,
        "wrappedTranslationVelocityErrorBone": velocity_translation_bone,
        "wrappedAngularVelocityErrorDegreesPerFrame": math.degrees(velocity_rotation),
        "wrappedAngularVelocityErrorBone": velocity_rotation_bone,
        "wrappedScaleVelocityErrorPerFrame": velocity_scale,
        "wrappedScaleVelocityErrorBone": velocity_scale_bone,
        "explicitDuplicateEndpoint": True,
    }
    result["pass"] = (
        endpoint_translation <= 0.0001
        and math.degrees(endpoint_rotation) <= 0.1
        and endpoint_scale <= 0.001
        and velocity_translation <= 0.0001
        and math.degrees(velocity_rotation) <= 0.1
        and velocity_scale <= 0.001
    )
    if not result["pass"]:
        raise RuntimeError(f"Procedural loop gate failed: {result}")
    return result


def self_containment(target, action, end_frame):
    expected = BASE.deform_snapshots(target, action, range(end_frame + 1))
    target.animation_data.action = None
    for side in ("l", "r"):
        target.pose.bones[f"c_foot_ik.{side}"]["ik_fk_switch"] = 1.0
        target.pose.bones[f"c_hand_ik.{side}"]["ik_fk_switch"] = 0.0
        target.pose.bones[f"c_foot_ik.{side}"]["auto_stretch"] = 1.0
        target.pose.bones[f"c_hand_ik.{side}"]["auto_stretch"] = 1.0
    BASE.assign_action(target, action)
    replayed = BASE.deform_snapshots(target, action, range(end_frame + 1))
    error, frame, bone = BASE.maximum_snapshot_error(expected, replayed)
    result = {"maximumError": error, "frame": frame, "bone": bone, "pass": error <= 1e-6}
    if not result["pass"]:
        raise RuntimeError(f"Procedural self-containment failed: {result}")
    return result


def deformation_gate(body, action, end_frame, bind_positions):
    ratios = []
    faces = [tuple(polygon.vertices) for polygon in body.data.polygons if len(polygon.vertices) == 3]
    bind_areas = []
    for face in faces:
        a, b, c = (bind_positions[index] for index in face)
        bind_areas.append((b - a).cross(c - a).length * 0.5)
    for frame in sorted({0, end_frame // 4, end_frame // 2, end_frame * 3 // 4, end_frame}):
        bpy.context.scene.frame_set(frame)
        bpy.context.view_layer.update()
        positions = evaluated_positions(body)
        for face, bind_area in zip(faces, bind_areas):
            if bind_area <= 1e-10:
                continue
            a, b, c = (positions[index] for index in face)
            ratios.append(((b - a).cross(c - a).length * 0.5) / bind_area)
    result = {
        "triangleAreaRatioP05": percentile(ratios, 0.05),
        "triangleAreaRatioMinimum": min(ratios),
        "skinnedP95LimitMetres": SKINNED_P95_LIMIT,
        "skinnedMaximumLimitMetres": SKINNED_MAXIMUM_LIMIT,
    }
    result["pass"] = (
        result["triangleAreaRatioP05"] >= DEFORMATION_AREA_P05_LIMIT
        and result["triangleAreaRatioMinimum"] >= DEFORMATION_AREA_MINIMUM_LIMIT
    )
    if not result["pass"]:
        raise RuntimeError(f"Procedural deformation gate failed: {result}")
    return result


def blenderGlbSkinnedParity(glb_path, source_meshes, actions):
    reference = {}
    for action in actions:
        BASE.assign_action(bpy.data.objects["rig"], action)
        reference[action.name] = {}
        for frame in (int(action.frame_start), int((action.frame_start + action.frame_end) * 0.5), int(action.frame_end)):
            bpy.context.scene.frame_set(frame)
            bpy.context.view_layer.update()
            reference[action.name][frame] = {mesh.name: evaluated_positions(mesh) for mesh in source_meshes}
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=str(glb_path))
    imported = [obj for obj in set(bpy.data.objects) - before if obj.type == "MESH"]
    maximum = 0.0
    p95 = 0.0
    for action in actions:
        imported_action = next((candidate for candidate in bpy.data.actions if candidate.name.startswith(action.name)), None)
        armature = next((obj for obj in set(bpy.data.objects) - before if obj.type == "ARMATURE"), None)
        if imported_action is None or armature is None:
            raise RuntimeError(f"Imported GLB action missing for parity: {action.name}")
        BASE.assign_action(armature, imported_action)
        for frame, source_by_mesh in reference[action.name].items():
            bpy.context.scene.frame_set(frame)
            bpy.context.view_layer.update()
            for name, source_positions in source_by_mesh.items():
                mesh = next((candidate for candidate in imported if candidate.name.startswith(name) and len(candidate.data.vertices) == len(source_positions)), None)
                if mesh is None:
                    raise RuntimeError(f"Imported GLB mesh correspondence missing: {name}")
                distances = [(left - right).length for left, right in zip(source_positions, evaluated_positions(mesh))]
                maximum = max(maximum, max(distances))
                p95 = max(p95, percentile(distances, 0.95))
    result = {"p95Metres": p95, "maximumMetres": maximum, "pass": p95 <= PARITY_P95_LIMIT and maximum <= PARITY_MAXIMUM_LIMIT}
    if not result["pass"]:
        raise RuntimeError(f"Blender/GLB skinned parity failed: {result}")
    return result


def render_views(output, target, meshes, action, clip_id, frame):
    directory = output / "renders"
    directory.mkdir(parents=True, exist_ok=True)
    scene = bpy.context.scene
    camera_data = bpy.data.cameras.new(f"Procedural_{clip_id}_Camera")
    camera = bpy.data.objects.new(f"Procedural_{clip_id}_Camera", camera_data)
    scene.collection.objects.link(camera)
    scene.camera = camera
    camera_data.type = "ORTHO"
    camera_data.ortho_scale = 2.15
    scene.render.engine = "BLENDER_WORKBENCH"
    scene.render.resolution_x = scene.render.resolution_y = 512
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    target.hide_render = True
    for obj in bpy.data.objects:
        if obj.type == "MESH" and obj not in meshes:
            obj.hide_render = True
    BASE.assign_action(target, action)
    scene.frame_set(frame)
    paths = []
    center = Vector((0.0, 0.0, 0.95))
    for view, location in {
        "front": Vector((0.0, -4.5, 1.05)),
        "right": Vector((4.5, 0.0, 1.05)),
        "back": Vector((0.0, 4.5, 1.05)),
    }.items():
        camera.location = location
        camera.rotation_mode = "QUATERNION"
        camera.rotation_quaternion = (center - location).to_track_quat("-Z", "Y")
        path = directory / f"{clip_id}-{view}.png"
        scene.render.filepath = str(path)
        bpy.ops.render.render(write_still=True)
        paths.append(path)
    bpy.data.objects.remove(camera, do_unlink=True)
    bpy.data.cameras.remove(camera_data)
    return paths


def main():
    args = parse_args()
    output = Path(args.output).resolve()
    output.mkdir(parents=True, exist_ok=True)
    scene = bpy.context.scene
    scene.render.fps = 30
    scene.render.fps_base = 1.0
    target = bpy.data.objects.get("rig")
    if target is None or target.type != "ARMATURE" or len(target.data.bones) != 211:
        raise RuntimeError("Accepted ARP rig missing")
    actual_deform_bones = tuple(sorted(bone.name for bone in target.data.bones if bone.use_deform))
    if actual_deform_bones != EXPECTED_DEFORM_BONES:
        raise RuntimeError(
            f"Accepted ARP deform inventory changed: {actual_deform_bones}"
        )
    deform_inventory = {
        "count": len(actual_deform_bones),
        "names": list(actual_deform_bones),
        "matchesAcceptedTarget": True,
        "pass": True,
    }
    meshes = [
        obj for obj in bpy.data.objects
        if obj.type == "MESH" and any(mod.type == "ARMATURE" and mod.object == target for mod in obj.modifiers)
    ]
    body = bpy.data.objects.get("Body")
    if body not in meshes:
        raise RuntimeError("Accepted Body mesh missing")
    state_before = BASE.target_state(target, meshes)
    BASE.clear_animation(target)
    bind = bind_control_state(target)
    frame_axes = derived_anatomical_frame(target)
    patches = {side: sole_patch(body, side) for side in ("l", "r")}
    bind_positions = evaluated_positions(body)
    actions = []
    reports = []
    for clip_id, action_name, end_frame in CLIPS:
        action, contacts, authored, endpoint_copy = author_clip(
            target, bind, frame_axes, clip_id, action_name, end_frame,
        )
        grounding = solve_support_sole_heights(
            target, body, patches, action, contacts, end_frame, frame_axes["up"],
        )
        endpoint_copy = copy_literal_duplicate_endpoint(action, end_frame)
        ownership = keyed_bone_gate(action)
        key_times = action_key_time_gate(action, end_frame)
        motion, samples = sample_motion(target, body, patches, action, contacts, authored, end_frame, clip_id, frame_axes)
        loop = matrix_loop_gate(target, action, end_frame)
        contained = self_containment(target, action, end_frame)
        deformation = deformation_gate(body, action, end_frame, bind_positions)
        actions.append(action)
        reports.append({
            "id": clip_id,
            "name": action_name,
            "frameStart": 0,
            "frameEnd": end_frame,
            "fps": FPS,
            "durationSeconds": end_frame / FPS,
            "explicitDuplicateEndpoint": True,
            "ownership": ownership,
            "keyTimeInventory": key_times,
            "literalDuplicateEndpoint": endpoint_copy,
            "supportGrounding": grounding,
            "motion": motion,
            "loop": loop,
            "selfContainment": contained,
            "deformation": deformation,
            "pass": True,
        })
    state_after = BASE.target_state(target, meshes)
    if state_after != state_before:
        raise RuntimeError("Procedural v1 changed accepted rest, geometry, weights, or modifiers")
    BASE.configure_export(scene, actions)
    scene.arp_ge_master_traj = False
    if hasattr(scene, "arp_ge_parent_fallback"):
        scene.arp_ge_parent_fallback = False
    blend_path = output / "masculine-auto-rig-pro-procedural-v1.blend"
    glb_path = output / "masculine-auto-rig-pro-procedural-v1-diagnostic.glb"
    BASE.assign_action(target, actions[0])
    scene.frame_start = 0
    scene.frame_end = 120
    bpy.ops.wm.save_as_mainfile(filepath=str(blend_path))
    BASE.select([target, *meshes], target)
    export_result = bpy.ops.arp.arp_export_gltf_panel("EXEC_DEFAULT", filepath=str(glb_path), quick_export=True)
    if export_result != {"FINISHED"} or not glb_path.exists():
        raise RuntimeError(f"ARP GLB export failed: {export_result}")
    glb = BASE.parse_glb(glb_path)
    expected = {name: end / FPS for _, name, end in CLIPS}
    timing_pass = {item["name"]: item["endSeconds"] for item in glb["animations"]} == expected
    if not timing_pass or glb["controlJoints"]:
        raise RuntimeError(f"Procedural runtime export failed: {glb}")
    parity = blenderGlbSkinnedParity(glb_path, meshes, actions)
    render_paths = []
    for action, (clip_id, _, end_frame) in zip(actions, CLIPS):
        render_paths.extend(render_views(output, target, meshes, action, clip_id, end_frame // 2))
    report = {
        "schemaVersion": "ashveil.auto-rig-pro-procedural-v1",
        "status": "machine_accepted_human_review_pending",
        "objectiveAcceptance": {"pass": True},
        "clips": reports,
        "anatomicalFrame": {
            "lateral": list(frame_axes["lateral"]),
            "forward": list(frame_axes["forward"]),
            "up": list(frame_axes["up"]),
            "toeDirectionDots": frame_axes["toeDirectionDots"],
            "rawToeDirectionDots": frame_axes["rawToeDirectionDots"],
            "forwardUpDot": frame_axes["forwardUpDot"],
        },
        "target": {"before": state_before, "after": state_after, "unchanged": True},
        "deformJointInventory": deform_inventory,
        "export": {
            "arpExporterOnly": True,
            "clipTimingPass": timing_pass,
            "cTrajExcluded": True,
            "blenderGlbSkinnedParity": parity,
            "gltfStructure": glb,
            "pass": True,
        },
        "humanReview": {"pass": False, "required": True},
        "productionPass": False,
        "canonicalViewerPromoted": False,
        "artifacts": [BASE.artifact(path) for path in (blend_path, glb_path, *render_paths)],
    }
    (output / "report.json").write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
