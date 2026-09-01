import hashlib
import importlib
import importlib.util
import json
import math
import statistics
from pathlib import Path

import bpy
from mathutils import Matrix, Quaternion, Vector


V2_PATH = Path(__file__).with_name("auto-rig-pro-transfer-v2.py")
V2_SPEC = importlib.util.spec_from_file_location("ashveil_auto_rig_pro_transfer_v2", V2_PATH)
V2 = importlib.util.module_from_spec(V2_SPEC)
V2_SPEC.loader.exec_module(V2)
BASE = V2.BASE
RIG_FUNCTIONS = importlib.import_module("bl_ext.user_default.auto_rig_pro.src.rig_functions")

SOURCE_IMPORT_FORWARD = 'axis_forward="-Z"'
INITIAL_SOLE_DISTANCE_LIMIT = 0.020
PENETRATION_LIMIT = -0.002
CONTACT_HEIGHT_BAND = 0.025
STANCE_SLIDE_LIMIT = 0.050
POSE_POP_LIMIT = 0.020
SKINNED_P95_LIMIT = 0.001
SKINNED_MAXIMUM_LIMIT = 0.002
LOOP_VALUE_LIMIT = 0.001
LOOP_VELOCITY_LIMIT = 0.010
CONTACT_PITCH_MIN = math.radians(-25.0)
CONTACT_PITCH_MAX = math.radians(45.0)
CLIPS = V2.CLIPS
DEFORM_SAMPLE_BONES = (
    "root.x",
    "thigh_stretch.l", "leg_stretch.l", "foot.l", "toes_01.l",
    "thigh_stretch.r", "leg_stretch.r", "foot.r", "toes_01.r",
)
IK_CONTROLS = {
    "c_foot_ik.l", "c_toes_ik.l", "c_leg_pole.l",
    "c_foot_ik.r", "c_toes_ik.r", "c_leg_pole.r",
}
FK_LEG_CONTROLS = {
    "c_thigh_fk.l", "c_leg_fk.l", "c_foot_fk.l", "c_toes_fk.l",
    "c_thigh_fk.r", "c_leg_fk.r", "c_foot_fk.r", "c_toes_fk.r",
}


def evaluated_vertex_world(mesh, index, depsgraph):
    evaluated = mesh.evaluated_get(depsgraph)
    return evaluated.matrix_world @ evaluated.data.vertices[index].co


def sole_patch(mesh, side):
    group_names = (f"foot.{side}", f"toes_01.{side}")
    group_indices = {mesh.vertex_groups[name].index for name in group_names}
    floor = min((mesh.matrix_world @ vertex.co).z for vertex in mesh.data.vertices)
    root_x = (mesh.matrix_world @ Vector()).x
    weighted = []
    for vertex in mesh.data.vertices:
        weight = sum(item.weight for item in vertex.groups if item.group in group_indices)
        world = mesh.matrix_world @ vertex.co
        correct_side = world.x > root_x if side == "l" else world.x < root_x
        if weight >= 0.5 and correct_side and world.z <= floor + 0.005:
            weighted.append(vertex.index)
    if len(weighted) != 59:
        raise RuntimeError(f"Bind-only sole patch changed for {side}: {len(weighted)} vertices")
    minimum = min((mesh.matrix_world @ mesh.data.vertices[index].co).z for index in weighted)
    payload = ",".join(str(index) for index in weighted).encode("utf-8")
    return {
        "vertexIds": weighted,
        "sha256": hashlib.sha256(payload).hexdigest(),
        "bindMinimumZMetres": minimum,
    }


def patch_sample(mesh, patch, depsgraph):
    points = [evaluated_vertex_world(mesh, index, depsgraph) for index in patch["vertexIds"]]
    centroid = sum(points, Vector()) / len(points)
    return {
        "minimumZ": min(point.z for point in points),
        "centroid": centroid,
    }


def bone_world_matrix(rig, name):
    return rig.matrix_world @ rig.pose.bones[name].matrix


def leg_points(rig, side):
    thigh = rig.pose.bones[f"thigh_stretch.{side}"]
    leg = rig.pose.bones[f"leg_stretch.{side}"]
    return {
        "hip": rig.matrix_world @ thigh.head,
        "knee": rig.matrix_world @ leg.head,
        "ankle": rig.matrix_world @ leg.tail,
    }


def bend_vector(points):
    axis = points["ankle"] - points["hip"]
    if axis.length < 1e-6:
        raise RuntimeError("Degenerate hip-to-ankle axis")
    projected = points["hip"] + axis * (
        (points["knee"] - points["hip"]).dot(axis) / axis.length_squared
    )
    bend = points["knee"] - projected
    if bend.length < 1e-5:
        raise RuntimeError("Degenerate evaluated knee plane")
    return bend.normalized()


def derive_leg_plane_pole(rig, side, points):
    bend = bend_vector(points)
    chain_length = (points["knee"] - points["hip"]).length + (points["ankle"] - points["knee"]).length
    world_position = points["knee"] + bend * max(0.35, chain_length * 0.75)
    return rig.matrix_world.inverted() @ world_position


def key_pose_transform(bone, location=True, rotation=True, scale=False):
    if location:
        bone.keyframe_insert(data_path="location")
    if rotation:
        if bone.rotation_mode == "QUATERNION":
            bone.keyframe_insert(data_path="rotation_quaternion")
        else:
            bone.keyframe_insert(data_path="rotation_euler")
    if scale:
        bone.keyframe_insert(data_path="scale")


def matrix_component_error(left, right):
    return max(abs(left[row][column] - right[row][column]) for row in range(4) for column in range(4))


def evaluated_mesh_positions(mesh, depsgraph):
    evaluated = mesh.evaluated_get(depsgraph)
    return [evaluated.matrix_world @ vertex.co for vertex in evaluated.data.vertices]


def percentile(values, quantile):
    ordered = sorted(values)
    index = min(len(ordered) - 1, int(math.ceil(len(ordered) * quantile)) - 1)
    return ordered[max(0, index)]


def capture_fk_samples(target, action, body, patches, frames):
    BASE.assign_action(target, action)
    depsgraph = bpy.context.evaluated_depsgraph_get()
    samples = []
    for frame in frames:
        bpy.context.scene.frame_set(frame)
        bpy.context.view_layer.update()
        sides = {}
        for side in ("l", "r"):
            patch = patch_sample(body, patches[side], depsgraph)
            points = leg_points(target, side)
            sides[side] = {
                "soleMinimumZ": patch["minimumZ"],
                "soleCentroid": patch["centroid"],
                "legPoints": points,
                "bend": bend_vector(points),
                "deformMatrices": {
                    name: bone_world_matrix(target, name).copy()
                    for name in (f"thigh_stretch.{side}", f"leg_stretch.{side}", f"foot.{side}", f"toes_01.{side}")
                },
            }
        samples.append({"frame": frame, "sides": sides})
    return samples


def contiguous_phases(flags):
    phases = []
    start = None
    for index, active in enumerate(flags + [False]):
        if active and start is None:
            start = index
        elif not active and start is not None:
            phases.append((start, index - 1))
            start = None
    if len(phases) > 1 and flags[0] and flags[-1]:
        first = phases.pop(0)
        last = phases.pop()
        phases.insert(0, (last[0], first[1] + len(flags)))
    return phases


def classify_contacts(clip_id, samples):
    all_heights = [sample["sides"][side]["soleMinimumZ"] for sample in samples for side in ("l", "r")]
    baseline = min(all_heights)
    side_thresholds = {}
    contacts = {"l": [], "r": []}
    for side in ("l", "r"):
        heights = sorted(sample["sides"][side]["soleMinimumZ"] for sample in samples)
        low = heights[max(0, int(len(heights) * 0.30) - 1)]
        high = heights[min(len(heights) - 1, int(len(heights) * 0.70))]
        threshold = min(baseline + CONTACT_HEIGHT_BAND, (low + high) * 0.5)
        side_thresholds[side] = threshold
        contacts[side] = [sample["sides"][side]["soleMinimumZ"] <= threshold for sample in samples]
    if clip_id == "walk":
        for index in range(len(samples)):
            if not contacts["l"][index] and not contacts["r"][index]:
                lower = min(("l", "r"), key=lambda side: samples[index]["sides"][side]["soleMinimumZ"])
                contacts[lower][index] = True
    flight = [not contacts["l"][index] and not contacts["r"][index] for index in range(len(samples))]
    contact_distances = [
        abs(samples[index]["sides"][side]["soleMinimumZ"])
        for side in ("l", "r")
        for index, active in enumerate(contacts[side])
        if active
    ]
    initial_maximum = max(contact_distances)
    sprint_flight = clip_id != "sprint" or any(flight)
    return {
        "contacts": contacts,
        "flight": flight,
        "baseline": baseline,
        "thresholds": side_thresholds,
        "initialMaximumSampledSoleDistanceMetres": initial_maximum,
        "initialWithinPostCorrectionTarget": initial_maximum <= INITIAL_SOLE_DISTANCE_LIMIT,
        "sprintFlightDetected": sprint_flight,
    }


def virtual_trajectory_and_slide(samples, contacts):
    slopes = []
    phase_records = []
    frame_seconds = 1.0 / V2.SOURCE_FPS
    for side in ("l", "r"):
        for start, end in contiguous_phases(contacts[side]):
            indices = [index % len(samples) for index in range(start, end + 1)]
            if len(indices) < 2:
                continue
            first = samples[indices[0]]["sides"][side]["soleCentroid"]
            last = samples[indices[-1]]["sides"][side]["soleCentroid"]
            duration = (len(indices) - 1) * frame_seconds
            slopes.append((last.y - first.y) / duration)
            phase_records.append((side, indices))
    forward_speed = statistics.median(slopes) if slopes else 0.0
    maximum_slide = 0.0
    phase_slides = []
    for side, indices in phase_records:
        positions = []
        for step, index in enumerate(indices):
            point = samples[index]["sides"][side]["soleCentroid"]
            virtualForwardTrajectory = Vector((0.0, -forward_speed * step * frame_seconds, 0.0))
            positions.append(point + virtualForwardTrajectory)
        slide = max((point - positions[0]).to_2d().length for point in positions)
        maximum_slide = max(maximum_slide, slide)
        phase_slides.append({"side": side, "frames": [indices[0] + 1, indices[-1] + 1], "slideMetres": slide})
    return {
        "virtualForwardTrajectory": {
            "formula": "p_virtual(t) = p_in_place(t) + (0,-speed*t,0)",
            "speedMetresPerSecond": forward_speed,
            "source": "median stance-phase sole-centroid Y slope",
        },
        "phases": phase_slides,
        "maximumStanceSlideMetres": maximum_slide,
        "thresholdMetres": STANCE_SLIDE_LIMIT,
        "pass": maximum_slide <= STANCE_SLIDE_LIMIT,
    }


def set_matrix_translation_z(bone, delta):
    matrix = bone.matrix.copy()
    matrix.translation.z += delta
    bone.matrix = matrix
    bpy.context.view_layer.update()


def contact_pitch(target, side):
    matrix = bone_world_matrix(target, f"foot.{side}")
    direction = (matrix.to_3x3() @ Vector((0.0, 1.0, 0.0))).normalized()
    return math.atan2(direction.z, -direction.y)


def clamp_contact_pitch(target, side):
    pitch = contact_pitch(target, side)
    clamped = min(CONTACT_PITCH_MAX, max(CONTACT_PITCH_MIN, pitch))
    if abs(clamped - pitch) > 1e-7:
        foot = target.pose.bones[f"c_foot_ik.{side}"]
        lateral = Vector((1.0, 0.0, 0.0))
        correction = Quaternion(lateral, clamped - pitch)
        matrix = foot.matrix.copy()
        translation = matrix.translation.copy()
        matrix = correction.to_matrix().to_4x4() @ matrix
        matrix.translation = translation
        foot.matrix = matrix
        bpy.context.view_layer.update()
    return math.degrees(pitch), math.degrees(clamped)


def snap_fk_pose_to_ik(target, side, pole_position):
    RIG_FUNCTIONS.ik_to_fk_leg(target, f".{side}", add_keyframe=True)
    pole = target.pose.bones[f"c_leg_pole.{side}"]
    pole_matrix = pole.matrix.copy()
    pole_matrix.translation = pole_position
    pole.matrix = pole_matrix
    key_pose_transform(pole, rotation=False)
    foot = target.pose.bones[f"c_foot_ik.{side}"]
    foot["ik_fk_switch"] = 0.0
    foot["auto_stretch"] = 0.0
    foot.keyframe_insert(data_path='["ik_fk_switch"]')
    foot.keyframe_insert(data_path='["auto_stretch"]')
    bpy.context.view_layer.update()


def remove_fk_leg_curves(action):
    removable = [
        curve for curve in BASE.action_curves(action)
        if any(f'pose.bones["{name}"]' in curve.data_path for name in FK_LEG_CONTROLS)
    ]
    if hasattr(action, "fcurves"):
        for curve in removable:
            action.fcurves.remove(curve)
        return
    removable_pointers = {curve.as_pointer() for curve in removable}
    for layer in action.layers:
        for strip in layer.strips:
            for channel_bag in strip.channelbags:
                for curve in list(channel_bag.fcurves):
                    if curve.as_pointer() in removable_pointers:
                        channel_bag.fcurves.remove(curve)


def convert_fk_action_to_grounded_ik(target, action, body, patches, samples, classification):
    BASE.assign_action(target, action)
    BASE.select([target], target)
    if target.mode != "POSE":
        bpy.ops.object.mode_set(mode="POSE")
    depsgraph = bpy.context.evaluated_depsgraph_get()
    maximum_pose_pop = 0.0
    maximum_deform_matrix_error = 0.0
    maximum_skinned_vertex_displacement = 0.0
    maximum_skinned_vertex_p95 = 0.0
    minimum_patch_z = float("inf")
    maximum_contact_distance = 0.0
    sideCrossing = False
    kneeReversal = False
    maximum_scale_error = 0.0
    pitch_records = []
    for index, sample in enumerate(samples):
        frame = sample["frame"]
        bpy.context.scene.frame_set(frame)
        bpy.context.view_layer.update()
        active_sides = [side for side in ("l", "r") if classification["contacts"][side][index]]
        if active_sides:
            lowest = min(sample["sides"][side]["soleMinimumZ"] for side in active_sides)
            root = target.pose.bones["c_root_master.x"]
            set_matrix_translation_z(root, -lowest)
            key_pose_transform(root, rotation=False)
        corrected_fk = {}
        for side in ("l", "r"):
            points = leg_points(target, side)
            corrected_fk[side] = {
                "points": points,
                "bend": bend_vector(points),
                "matrices": {
                    name: bone_world_matrix(target, name).copy()
                    for name in (f"thigh_stretch.{side}", f"leg_stretch.{side}", f"foot.{side}", f"toes_01.{side}")
                },
            }
            pole = derive_leg_plane_pole(target, side, points)
        baseline_vertices = evaluated_mesh_positions(body, depsgraph)
        for side in ("l", "r"):
            pole = derive_leg_plane_pole(target, side, corrected_fk[side]["points"])
            snap_fk_pose_to_ik(target, side, pole)
        for side in ("l", "r"):
            if classification["contacts"][side][index]:
                patch = patch_sample(body, patches[side], depsgraph)
                set_matrix_translation_z(target.pose.bones[f"c_foot_ik.{side}"], -patch["minimumZ"])
                before_pitch, after_pitch = clamp_contact_pitch(target, side)
                key_pose_transform(target.pose.bones[f"c_foot_ik.{side}"])
                pitch_records.append({
                    "frame": frame,
                    "side": side,
                    "beforeDegrees": before_pitch,
                    "afterDegrees": after_pitch,
                })
        bpy.context.view_layer.update()
        corrected_vertices = evaluated_mesh_positions(body, depsgraph)
        vertex_displacements = [
            (after - before).length for before, after in zip(baseline_vertices, corrected_vertices)
        ]
        maximum_skinned_vertex_displacement = max(maximum_skinned_vertex_displacement, max(vertex_displacements))
        maximum_skinned_vertex_p95 = max(maximum_skinned_vertex_p95, percentile(vertex_displacements, 0.95))
        root_x = (target.matrix_world @ target.pose.bones["root.x"].head).x
        for side in ("l", "r"):
            patch = patch_sample(body, patches[side], depsgraph)
            minimum_patch_z = min(minimum_patch_z, patch["minimumZ"])
            if classification["contacts"][side][index]:
                maximum_contact_distance = max(maximum_contact_distance, abs(patch["minimumZ"]))
            ik_points = leg_points(target, side)
            ankle_x = ik_points["ankle"].x
            sideCrossing = sideCrossing or (side == "l" and ankle_x < root_x) or (side == "r" and ankle_x > root_x)
            kneeReversal = kneeReversal or bend_vector(ik_points).dot(corrected_fk[side]["bend"]) <= 0.0
            for name, baseline in corrected_fk[side]["matrices"].items():
                actual = bone_world_matrix(target, name)
                maximum_deform_matrix_error = max(
                    maximum_deform_matrix_error, matrix_component_error(actual, baseline)
                )
                for point in (Vector((0.0, 0.0, 0.0)), Vector((0.0, target.pose.bones[name].length, 0.0))):
                    maximum_pose_pop = max(maximum_pose_pop, ((actual @ point) - (baseline @ point)).length)
            foot = target.pose.bones[f"c_foot_ik.{side}"]
            maximum_scale_error = max(maximum_scale_error, max(abs(value - 1.0) for value in foot.scale))
    passed = (
        maximum_pose_pop <= POSE_POP_LIMIT
        and maximum_skinned_vertex_p95 <= SKINNED_P95_LIMIT
        and maximum_skinned_vertex_displacement <= SKINNED_MAXIMUM_LIMIT
        and maximum_contact_distance <= 0.002
        and minimum_patch_z >= PENETRATION_LIMIT
        and not sideCrossing
        and not kneeReversal
        and maximum_scale_error <= 0.001
    )
    result = {
        "maximumPosePopMetres": maximum_pose_pop,
        "posePopThresholdMetres": POSE_POP_LIMIT,
        "maximumDeformMatrixComponentError": maximum_deform_matrix_error,
        "skinnedVertexP95DisplacementMetres": maximum_skinned_vertex_p95,
        "skinnedVertexP95ThresholdMetres": SKINNED_P95_LIMIT,
        "skinnedVertexMaximumDisplacementMetres": maximum_skinned_vertex_displacement,
        "skinnedVertexMaximumThresholdMetres": SKINNED_MAXIMUM_LIMIT,
        "maximumCorrectedContactSoleDistanceMetres": maximum_contact_distance,
        "minimumSoleZMetres": minimum_patch_z,
        "penetrationLimitMetres": PENETRATION_LIMIT,
        "sideCrossing": sideCrossing,
        "kneeReversal": kneeReversal,
        "maximumIkFootScaleError": maximum_scale_error,
        "contactPitchClampDegrees": [-25.0, 45.0],
        "contactPitchSamples": pitch_records,
        "pass": passed,
    }
    if not passed:
        raise RuntimeError(f"Grounded IK conversion failed: {result}")
    remove_fk_leg_curves(action)
    return result


def action_self_containment(target, action, frames, expected):
    target.animation_data.action = None
    V2.set_limb_mode(target, legs_fk=True, arms_fk=False)
    BASE.assign_action(target, action)
    replayed = BASE.deform_snapshots(target, action, frames)
    error, frame, bone = BASE.maximum_snapshot_error(expected, replayed)
    return {
        "oppositeAmbientFootFkAndHandIk": True,
        "maximumDeformMatrixComponentError": error,
        "maximumErrorFrame": frame,
        "maximumErrorBone": bone,
        "pass": error <= 1e-6,
    }


def loop_metrics(target, action):
    BASE.assign_action(target, action)
    snapshots = BASE.deform_snapshots(target, action, (0, 1, 59, 60))
    value_error = 0.0
    velocity_error = 0.0
    for name in DEFORM_SAMPLE_BONES:
        value_error = max(value_error, matrix_component_error(snapshots[0][name], snapshots[60][name]))
        for row in range(4):
            for column in range(4):
                start_velocity = snapshots[1][name][row][column] - snapshots[0][name][row][column]
                end_velocity = snapshots[60][name][row][column] - snapshots[59][name][row][column]
                velocity_error = max(velocity_error, abs(start_velocity - end_velocity))
    loopValueContinuity = value_error <= LOOP_VALUE_LIMIT
    loopVelocityContinuity = velocity_error <= LOOP_VELOCITY_LIMIT
    return {
        "maximumValueComponentError": value_error,
        "valueThreshold": LOOP_VALUE_LIMIT,
        "loopValueContinuity": loopValueContinuity,
        "maximumVelocityComponentError": velocity_error,
        "velocityThreshold": LOOP_VELOCITY_LIMIT,
        "loopVelocityContinuity": loopVelocityContinuity,
        "pass": loopValueContinuity and loopVelocityContinuity,
    }


def point_camera(camera, target):
    camera.rotation_euler = (target - camera.location).to_track_quat("-Z", "Y").to_euler()


def render_views(output, target, meshes, action, clip_id, frame):
    scene = bpy.context.scene
    render_directory = output / "renders"
    render_directory.mkdir(parents=True, exist_ok=True)
    camera_data = bpy.data.cameras.new(f"TransferV3_{clip_id}_Camera")
    camera = bpy.data.objects.new(f"TransferV3_{clip_id}_Camera", camera_data)
    scene.collection.objects.link(camera)
    scene.camera = camera
    camera_data.type = "ORTHO"
    camera_data.ortho_scale = 2.15
    scene.render.engine = "BLENDER_WORKBENCH"
    scene.display.shading.light = "STUDIO"
    scene.display.shading.color_type = "MATERIAL"
    scene.display.shading.show_shadows = True
    scene.render.resolution_x = 512
    scene.render.resolution_y = 512
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.render.film_transparent = False
    BASE.assign_action(target, action)
    scene.frame_set(frame)
    bpy.context.view_layer.update()
    target.hide_render = True
    for obj in bpy.data.objects:
        if obj.type == "MESH" and obj not in meshes:
            obj.hide_render = True
    center = Vector((0.0, 0.0, 0.95))
    views = {
        "front": Vector((0.0, -4.5, 1.05)),
        "right": Vector((4.5, 0.0, 1.05)),
        "back": Vector((0.0, 4.5, 1.05)),
    }
    paths = []
    for view, location in views.items():
        camera.location = location
        point_camera(camera, center)
        path = render_directory / f"{clip_id}-{view}.png"
        scene.render.filepath = str(path)
        bpy.ops.render.render(write_still=True)
        paths.append(path)
    bpy.data.objects.remove(camera, do_unlink=True)
    bpy.data.cameras.remove(camera_data)
    return paths


def main():
    args = V2.parse_args()
    source_directory = Path(args.source).resolve()
    source_report_path = Path(args.source_report).resolve()
    map_path = Path(args.map).resolve()
    output = Path(args.output).resolve()
    output.mkdir(parents=True, exist_ok=True)
    source_report = json.loads(source_report_path.read_text(encoding="utf-8"))
    source_by_id = {clip["id"]: clip for clip in source_report["clips"]}
    installation = BASE.arp_installation()
    target = bpy.data.objects.get("rig")
    if target is None or target.type != "ARMATURE" or len(target.data.bones) != 211:
        raise RuntimeError("Accepted 211-bone ARP target rig was not found")
    meshes = [
        obj for obj in bpy.data.objects
        if obj.type == "MESH" and any(mod.type == "ARMATURE" and mod.object == target for mod in obj.modifiers)
    ]
    body = bpy.data.objects.get("Body")
    if body not in meshes:
        raise RuntimeError("Accepted Body semantic mesh was not found")
    state_before = BASE.target_state(target, meshes)
    BASE.clear_animation(target)
    bind_floor, bind_root_height = V2.bind_floor_and_root_height(target, meshes)
    patches = {side: sole_patch(body, side) for side in ("l", "r")}

    actions = []
    clip_reports = []
    convention_reports = []
    vertical_reports = []
    alignment_reports = []
    ground_reports = []
    kinematic_reports = []
    loop_reports = []
    render_paths = []
    for clip_id, output_name in CLIPS:
        motion = source_by_id[clip_id]["sourceMotion"]
        frames = int(motion["frames"])
        source, source_action = V2.import_source(source_directory / motion["path"], clip_id, frames)
        convention = V2.assert_source_convention(source, target)
        vertical = V2.remove_constant_hips_vertical_offset(source, source_action, frames)
        alignment = V2.configure_remap(source, source_action, target, map_path)
        target.animation_data.action = None
        V2.set_limb_mode(target, legs_fk=True, arms_fk=True)
        target_action = BASE.retarget(source, source_action, target, frames)
        target_action.name = output_name
        V2.key_limb_mode(target, target_action, 1, frames)
        fk_samples = capture_fk_samples(target, target_action, body, patches, range(1, frames + 1))
        classification = classify_contacts(clip_id, fk_samples)
        baseline_slide = virtual_trajectory_and_slide(fk_samples, classification["contacts"])
        kinematics = convert_fk_action_to_grounded_ik(
            target, target_action, body, patches, fk_samples, classification
        )
        corrected_samples = capture_fk_samples(
            target, target_action, body, patches, range(1, frames + 1)
        )
        corrected_classification = classify_contacts(clip_id, corrected_samples)
        postCorrectionStanceSlide = virtual_trajectory_and_slide(
            corrected_samples, classification["contacts"]
        )
        if not postCorrectionStanceSlide["pass"]:
            raise RuntimeError(
                f"{clip_id} post-correction virtual stance slide failed: {postCorrectionStanceSlide}"
            )
        expected = BASE.deform_snapshots(target, target_action, range(1, frames + 1))
        self_containment = action_self_containment(target, target_action, range(1, frames + 1), expected)
        if not self_containment["pass"]:
            raise RuntimeError(f"{clip_id} action self-containment failed: {self_containment}")
        root_distance = BASE.root_net_distance(target, target_action, 1, frames)
        if root_distance > 0.001:
            raise RuntimeError(f"{clip_id} root net horizontal distance failed: {root_distance}")
        output_end = BASE.retime_action(target_action, 1, frames)
        loop = loop_metrics(target, target_action)
        if not loop["pass"]:
            raise RuntimeError(f"{clip_id} loop continuity failed: {loop}")
        actions.append(target_action)
        convention_reports.append({"id": clip_id, **convention})
        vertical_reports.append({"id": clip_id, **vertical})
        alignment_reports.append({"id": clip_id, **alignment})
        ground_reports.append({
            "id": clip_id,
            "contactFrames": {
                side: [index + 1 for index, active in enumerate(classification["contacts"][side]) if active]
                for side in ("l", "r")
            },
            "flightFrames": [index + 1 for index, active in enumerate(classification["flight"]) if active],
            "initialMaximumSampledSoleDistanceMetres": classification["initialMaximumSampledSoleDistanceMetres"],
            "initialSoleDistanceThresholdMetres": INITIAL_SOLE_DISTANCE_LIMIT,
            "baselineSprintFlightDetected": classification["sprintFlightDetected"],
            "postCorrectionSprintFlightDetected": corrected_classification["sprintFlightDetected"],
            "baselineStanceSlide": baseline_slide,
            "postCorrectionStanceSlide": postCorrectionStanceSlide,
            "pass": corrected_classification["sprintFlightDetected"] and postCorrectionStanceSlide["pass"],
        })
        kinematic_reports.append({"id": clip_id, **kinematics, "actionSelfContainment": self_containment})
        loop_reports.append({"id": clip_id, **loop})
        clip_reports.append({
            "id": clip_id,
            "outputName": output_name,
            "sourceFrames": frames,
            "sourceFps": V2.SOURCE_FPS,
            "outputFrames": output_end + 1,
            "outputFps": V2.OUTPUT_FPS,
            "durationSeconds": output_end / V2.OUTPUT_FPS,
            "retargetBakeCount": 1,
            "legMode": "IK",
            "armMode": "FK",
            "targetRootNetHorizontalDistanceMetres": root_distance,
            "pass": True,
        })
        BASE.remove_source(source, [source_action])
        if "rest_transf_offset" in bpy.context.scene:
            del bpy.context.scene["rest_transf_offset"]

    state_after = BASE.target_state(target, meshes)
    target_unchanged = state_before == state_after
    if not target_unchanged:
        raise RuntimeError("Transfer v3 changed accepted target rest, geometry, weights, or modifiers")
    for action, (clip_id, _) in zip(actions, CLIPS):
        review_frame = 15 if clip_id == "walk" else 9
        render_paths.extend(render_views(output, target, meshes, action, clip_id, review_frame))
    BASE.configure_export(bpy.context.scene, actions)
    scene = bpy.context.scene
    master_trajectory_supported = hasattr(scene, "arp_ge_master_traj")
    parent_fallback_supported = hasattr(scene, "arp_ge_parent_fallback")
    if master_trajectory_supported:
        scene.arp_ge_master_traj = False
    if parent_fallback_supported:
        scene.arp_ge_parent_fallback = False
    BASE.assign_action(target, actions[0])
    blend_path = output / "masculine-auto-rig-pro-transfer-v3.blend"
    glb_path = output / "masculine-auto-rig-pro-transfer-v3-diagnostic.glb"
    scene.frame_start = 0
    scene.frame_end = 60
    bpy.ops.wm.save_as_mainfile(filepath=str(blend_path))
    BASE.select([target, *meshes], target)
    export_result = bpy.ops.arp.arp_export_gltf_panel(
        "EXEC_DEFAULT", filepath=str(glb_path), quick_export=True
    )
    if export_result != {"FINISHED"} or not glb_path.exists():
        raise RuntimeError(f"ARP GLB export failed: {export_result}")
    glb = BASE.parse_glb(glb_path)
    expected_names = sorted(action.name for action in actions)
    actual_names = sorted(animation["name"] for animation in glb["animations"])
    clip_timing_pass = actual_names == expected_names and all(
        animation["endSeconds"] == 2.0 and animation["maximumSamples"] == 61
        for animation in glb["animations"]
    )
    if not clip_timing_pass:
        raise RuntimeError(f"Transfer v3 GLB timing failed: {glb['animations']}")
    objective_pass = (
        all(item["pass"] for item in convention_reports)
        and all(item["pass"] for item in vertical_reports)
        and all(item["pass"] for item in alignment_reports)
        and all(item["pass"] for item in ground_reports)
        and all(item["pass"] for item in kinematic_reports)
        and all(item["pass"] for item in loop_reports)
        and target_unchanged
        and clip_timing_pass
        and len(render_paths) == 6
    )
    if not objective_pass:
        raise RuntimeError("Transfer v3 objective acceptance failed")
    artifact_paths = [blend_path, glb_path, *render_paths]
    report = {
        "schemaVersion": "ashveil.auto-rig-pro-transfer-v3",
        "status": "diagnostic_not_production_ready",
        "objectiveAcceptance": {"pass": True},
        "inheritedV2": {
            "sourceConvention": {"clips": convention_reports, "pass": True},
            "sourceVerticalNormalization": {"clips": vertical_reports, "pass": True},
            "restFrameAlignment": {"clips": alignment_reports, "pass": True},
            "oneRetargetBakePerClip": True,
            "sourceImportForward": "-Z",
            "armMode": "FK",
            "targetUnchanged": target_unchanged,
            "pass": True,
        },
        "solePatches": {
            side: {
                "vertexIds": patches[side]["vertexIds"],
                "sha256": patches[side]["sha256"],
                "bindMinimumZMetres": patches[side]["bindMinimumZMetres"],
            }
            for side in ("l", "r")
        },
        "groundContact": {"clips": ground_reports, "pass": True},
        "legKinematics": {"clips": kinematic_reports, "pass": True},
        "loopContinuity": {"clips": loop_reports, "pass": True},
        "retargetSkeletal": {"clips": clip_reports, "pass": True},
        "target": {
            "bindFloorMetres": bind_floor,
            "bindRelativeRootHeightMetres": bind_root_height,
            "before": state_before,
            "after": state_after,
            "unchanged": target_unchanged,
        },
        "renderReview": {
            "requiredViews": ["front", "right", "back"],
            "representativeFrames30Fps": {"walk": 15, "sprint": 9},
            "artifacts": [path.relative_to(output).as_posix() for path in render_paths],
            "pass": True,
        },
        "exportParity": {
            "arpExporterOnly": True,
            "clipTimingPass": True,
            "masterTrajectoryDisabledWhenSupported": master_trajectory_supported,
            "parentFallbackDisabledWhenSupported": parent_fallback_supported,
            "runtimeInventoryPass": not glb["controlJoints"],
            "blenderGlbSkinnedParityMeasured": False,
            "gltfStructure": glb,
            "pass": False,
        },
        "meshDeformation": {"measured": False, "pass": False},
        "humanReview": {"pass": False, "required": True},
        "productionPass": False,
        "canonicalViewerPromoted": False,
        "artifacts": [BASE.artifact(path) for path in artifact_paths],
    }
    (output / "report.json").write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
