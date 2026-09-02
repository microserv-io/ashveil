"""Stage 4: skin the body, confine the weights to their regions, prove the shape.

Bone-heat weights are a good first guess and a bad last word: they let the
upper arm and the clavicle reach into the latissimus, so raising an arm drags
the back up into wings and shears the deltoid cap. The clean is deterministic
and geometric - a capsule around each limb bone, a cap the clavicle hands over
to the arm across, a smoothing band, four influences - and then the body is
posed and measured to prove it.

The binding half runs in Blender; the confining and measuring half runs on the
exported file, so the numbers in the report describe the bytes that ship.
"""

from __future__ import annotations

import numpy as np

from .skin import Body, FRONT, LATERAL

PARAMS = {
    "capsule_scale": 1.20,
    "capsule_bulge": 0.90,
    "radial_fade": 0.045,
    "deltoid_reach": 0.070,
    "axial_fade": 0.055,
    "cap_bottom": 0.100,
    "clavicle_handoff": 0.050,
    "cap_authority": 0.70,
    "cap_core": 0.60,
    "clavicle_crossover": 0.010,
    "clavicle_crossover_fade": 0.045,
    "armpit_drop": 0.075,
    "armpit_fade": 0.045,
    "scapula_drop": 0.020,
    "back_plane": 0.020,
    "back_fade": 0.050,
    "glute_reach": 0.040,
    "smooth_reach": 0.13,
    "smooth_iterations": 8,
    "smooth_cycles": 3,
    "helper_capsule": 1.15,
    "shoulder_helper_share": 0.8,
    "shoulder_helper_core": 0.03,
    "shoulder_helper_reach": 0.45,
    "twist_start": 0.5,
    "twist_share": 0.6,
}


class WeightError(RuntimeError):
    pass


# ------------------------------------------------------------------ binding

def bind(armature, regions: dict, contract: dict) -> dict:
    """Automatic weights, then the family's allow-list, then no orphans.

    The allow-list is what keeps a hand's shell off the far shoulder. Stripping
    it can leave a vertex holding nothing, so those are handed to the nearest
    bone the region is allowed to use rather than left to collapse to the
    origin, and the count is reported because a large one means the allow-list
    or the landmarks are wrong.
    """
    import bpy

    bpy.ops.object.select_all(action="DESELECT")
    for obj in regions.values():
        obj.select_set(True)
    armature.select_set(True)
    bpy.context.view_layer.objects.active = armature
    bpy.ops.object.parent_set(type="ARMATURE_AUTO")

    allowed = contract["regions"]["allowedBones"]
    deform = [spec["name"] for spec in contract["bones"] if spec["deform"]]
    segments = {bone.name: (np.array(bone.head_local), np.array(bone.tail_local))
                for bone in armature.data.bones}

    stripped, orphaned = {}, {}
    for name, obj in regions.items():
        permitted = [bone for bone in allowed.get(name, deform) if bone in segments]
        if not permitted:
            raise WeightError(f"weight gate: region {name} is allowed no bone to hold it")
        removed = [group.name for group in obj.vertex_groups if group.name not in permitted]
        for group_name in removed:
            obj.vertex_groups.remove(obj.vertex_groups[group_name])
        stripped[name] = removed

        empty = [vertex.index for vertex in obj.data.vertices
                 if not any(element.weight > 0 for element in vertex.groups)]
        if empty:
            points = np.array([tuple(obj.data.vertices[at].co) for at in empty])
            distances = np.stack([_segment_distance(points, *segments[bone]) for bone in permitted])
            nearest = np.argmin(distances, axis=0)
            groups = {bone: obj.vertex_groups.get(bone) or obj.vertex_groups.new(name=bone) for bone in permitted}
            for at, bone in zip(empty, (permitted[index] for index in nearest)):
                groups[bone].add([at], 1.0, "REPLACE")
        orphaned[name] = len(empty)

    carried = {bone: 0 for bone in deform}
    influences = 0
    for obj in regions.values():
        names = {group.index: group.name for group in obj.vertex_groups}
        for vertex in obj.data.vertices:
            held = [names[element.group] for element in vertex.groups if element.weight > 0]
            influences = max(influences, len(held))
            for bone in held:
                if bone in carried:
                    carried[bone] += 1

    starved = sorted(bone for bone, count in carried.items() if count == 0)
    if starved:
        raise WeightError(f"weight gate: no vertex is weighted to {', '.join(starved)}")
    return {"strippedGroups": {name: value for name, value in stripped.items() if value},
            "orphanedVertices": {name: value for name, value in orphaned.items() if value},
            "maxInfluencesPerVertexBeforeExport": influences,
            "verticesPerBone": carried}


def _segment_distance(points: np.ndarray, head: np.ndarray, tail: np.ndarray) -> np.ndarray:
    segment = tail - head
    along = np.clip(((points - head) @ segment) / float(segment @ segment), 0.0, 1.0)
    return np.linalg.norm(points - (head + np.outer(along, segment)), axis=1)


# --------------------------------------------------------------- confining

def _smoothstep(value: np.ndarray) -> np.ndarray:
    clamped = np.clip(value, 0.0, 1.0)
    return clamped * clamped * (3.0 - 2.0 * clamped)


def _arm_radius(body: Body, weights: np.ndarray, side: str) -> float:
    along, radius = body.arm_coords(side, body.positions)
    at = body.index[body.bone[f"shoulder.{side.lower()}"]]
    # The upper arm and its helpers hold the arm between them; the radius is the arm's.
    held = weights[:, at] + sum(weights[:, body.index[name]] for name in body.helper_names(side).values())
    core = (held > 0.9) & (along > 0.5 * body.arm_axis(side)[2])
    if core.sum() < 20:
        core = (held > 0.7) & (along > 0.4 * body.arm_axis(side)[2])
    if core.sum() < 20:
        raise WeightError(f"weight gate: the {side} upper arm has no core vertices to measure")
    return float(np.percentile(radius[core], 98))


def _normalise_top4(weights: np.ndarray) -> np.ndarray:
    clipped = np.clip(weights, 0.0, None)
    keep = np.argsort(-clipped, axis=1)[:, :4]
    out = np.zeros_like(clipped)
    rows = np.arange(len(clipped))[:, None]
    out[rows, keep] = clipped[rows, keep]
    total = out.sum(axis=1, keepdims=True)
    return out / np.where(total < 1e-12, 1.0, total)


def _redistribute(body: Body, weights: np.ndarray, freed: np.ndarray, band: float = 0.06) -> None:
    split = body.head[body.bone["chest"]][1]
    to_chest = _smoothstep((body.positions[:, 1] - (split - band)) / (2 * band))
    weights[:, body.index[body.bone["chest"]]] += freed * to_chest
    weights[:, body.index[body.bone["spine"]]] += freed * (1.0 - to_chest)


def _shoulder_region(body: Body, side: str, radius: float, params: dict) -> dict:
    shoulder, direction, length = body.arm_axis(side)
    sign = 1.0 if side == "L" else -1.0
    along, distance = body.arm_coords(side, body.positions)
    top = -params["deltoid_reach"]

    perpendicular = (body.positions - shoulder) - np.outer(along, direction)
    lateral = LATERAL * np.sign(shoulder[0])
    lateral = lateral - (lateral @ direction) * direction
    lateral = lateral / np.linalg.norm(lateral)
    facing = (perpendicular @ lateral) / np.maximum(distance, 1e-9)
    capsule = radius * (params["capsule_scale"] + params["capsule_bulge"] * np.clip(facing, 0.0, 1.0))

    radial = 1.0 - _smoothstep((distance - capsule) / params["radial_fade"])
    keep_arm = np.clip(radial * _smoothstep((along - top) / params["axial_fade"]), 0.0, 1.0)
    distal = along > 0.25 * length
    keep_arm[distal] = np.maximum(keep_arm[distal], radial[distal])

    armpit = shoulder[1] - params["armpit_drop"]
    scapula = shoulder[1] - params["scapula_drop"]
    above_armpit = _smoothstep((body.positions[:, 1] - armpit) / params["armpit_fade"])
    on_back = _smoothstep((shoulder[2] - params["back_plane"] - body.positions[:, 2]) / params["back_fade"])
    below_scapula = 1.0 - _smoothstep((body.positions[:, 1] - scapula) / params["armpit_fade"])
    own_side = 1.0 - _smoothstep(
        (-sign * body.positions[:, 0] - params["clavicle_crossover"]) / params["clavicle_crossover_fade"])
    keep_clavicle = np.clip(above_armpit * (1.0 - on_back * below_scapula) * own_side, 0.0, 1.0)

    cap = (along > top) & (along < params["cap_bottom"]) & (distance < capsule)
    return {"arm": keep_arm, "clavicle": keep_clavicle, "cap": cap, "along": along,
            "distance": distance, "capsule": capsule, "top": top, "radius": radius}


def _confine(body: Body, weights: np.ndarray, side: str, region: dict, ceiling) -> None:
    arm = body.index[body.bone[f"shoulder.{side.lower()}"]]
    clavicle = body.index[body.bone[f"clavicle.{side.lower()}"]]
    if ceiling is None:
        new_arm, new_clavicle = weights[:, arm] * region["arm"], weights[:, clavicle] * region["clavicle"]
    else:
        new_arm = np.minimum(weights[:, arm], ceiling["arm"])
        new_clavicle = np.minimum(weights[:, clavicle], ceiling["clavicle"])
    freed = (weights[:, arm] - new_arm) + (weights[:, clavicle] - new_clavicle)
    weights[:, arm], weights[:, clavicle] = new_arm, new_clavicle
    _redistribute(body, weights, freed)


def _blend_cap(body: Body, weights: np.ndarray, side: str, region: dict, params: dict) -> None:
    cap, along, distance = region["cap"], region["along"], region["distance"]
    if not cap.any():
        return
    arm = body.index[body.bone[f"shoulder.{side.lower()}"]]
    clavicle = body.index[body.bone[f"clavicle.{side.lower()}"]]
    handover = _smoothstep((along[cap] - region["top"]) / (params["clavicle_handoff"] - region["top"]))
    inner = region["radius"] * params["cap_core"]
    mix = np.clip(1.0 - _smoothstep((distance[cap] - inner) / np.maximum(region["capsule"][cap] - inner, 1e-6)),
                  0.0, 1.0) * params["cap_authority"]
    target = np.zeros((int(cap.sum()), weights.shape[1]))
    target[:, arm] = handover
    target[:, clavicle] = 1.0 - handover
    weights[cap] = weights[cap] * (1.0 - mix[:, None]) + target * mix[:, None]


def _assign_helpers(body: Body, weights: np.ndarray, side: str, region: dict, params: dict) -> dict:
    """Hand the deltoid cap to the shoulder helper and the lower upper arm to the twist.

    Each helper takes a fixed share of the pool it shares with the upper arm, so
    running this again after a smoothing pass lands on the same split rather than
    compounding. The shoulder helper turns at half the arm's rate, so a cap that
    is mostly helper follows the arm at about half rate: that is the blend across
    the joint a single bone cannot make.
    """
    helpers = body.helper_names(side)
    if not helpers:
        return {}
    arm = body.index[body.bone[f"shoulder.{side.lower()}"]]
    along, distance = region["along"], region["distance"]
    _, _, length = body.arm_axis(side)
    inside = distance < region["capsule"] * params["helper_capsule"]
    log = {}

    if "shoulder" in helpers:
        helper = body.index[helpers["shoulder"]]
        reach = params["shoulder_helper_reach"] * length
        share = params["shoulder_helper_share"] * (1.0 - _smoothstep((along - params["shoulder_helper_core"]) / reach))
        share = np.where((along > region["top"]) & inside, share, 0.0)
        pool = weights[:, arm] + weights[:, helper]
        weights[:, helper] = pool * share
        weights[:, arm] = pool * (1.0 - share)
        log["shoulderHelperVertices"] = int((weights[:, helper] > 0.05).sum())

    if "twist" in helpers:
        twist = body.index[helpers["twist"]]
        start = params["twist_start"] * length
        share = params["twist_share"] * _smoothstep((along - start) / max(length - start, 1e-6))
        share = np.where(inside, share, 0.0)
        pool = weights[:, arm] + weights[:, twist]
        weights[:, twist] = pool * share
        weights[:, arm] = pool * (1.0 - share)
        log["twistHelperVertices"] = int((weights[:, twist] > 0.05).sum())
    return log


def _confine_thigh(body: Body, weights: np.ndarray, side: str, params: dict) -> dict:
    lowered = side.lower()
    hip = body.head[body.bone[f"hip.{lowered}"]]
    knee = body.head[body.bone[f"knee.{lowered}"]]
    direction = knee - hip
    length = float(np.linalg.norm(direction))
    direction = direction / length
    relative = body.positions - hip
    along = relative @ direction
    distance = np.linalg.norm(relative - np.outer(along, direction), axis=1)
    at = body.index[body.bone[f"hip.{lowered}"]]
    core = (weights[:, at] > 0.9) & (along > 0.4 * length)
    radius = float(np.percentile(distance[core], 98)) if core.sum() > 20 else 0.11
    capsule = radius * params["capsule_scale"]
    radial = 1.0 - _smoothstep((distance - capsule) / params["radial_fade"])
    keep = np.clip(radial * _smoothstep((along + params["glute_reach"]) / params["axial_fade"]), 0.0, 1.0)
    distal = along > 0.25 * length
    keep[distal] = np.maximum(keep[distal], radial[distal])
    stripped = int(((weights[:, at] > 0.05) & (keep < 0.5)).sum())
    freed = weights[:, at] * (1.0 - keep)
    weights[:, at] *= keep
    weights[:, body.index[body.bone["pelvis"]]] += freed
    return {"strippedVertices": stripped, "radiusCm": round(radius * 100, 2)}


def _weld(positions: np.ndarray, digits: int = 5) -> np.ndarray:
    _, inverse = np.unique(np.round(positions, digits), axis=0, return_inverse=True)
    return inverse.ravel()


def _smooth(body: Body, weights: np.ndarray, centres: list, reach: float, iterations: int) -> None:
    welded = _weld(body.positions)
    count = int(welded.max()) + 1
    edges = np.vstack([body.triangles[:, [0, 1]], body.triangles[:, [1, 2]], body.triangles[:, [2, 0]]])
    mapped = welded[edges]
    mapped = np.unique(np.vstack([mapped, mapped[:, ::-1]]), axis=0)
    mapped = mapped[mapped[:, 0] != mapped[:, 1]]
    mapped = mapped[np.argsort(mapped[:, 0], kind="stable")]
    starts = np.searchsorted(mapped[:, 0], np.arange(count + 1))
    neighbours, counts = mapped[:, 1], np.diff(starts)

    distance = np.full(len(body.positions), np.inf)
    for centre in centres:
        distance = np.minimum(distance, np.linalg.norm(body.positions - centre, axis=1))
    strength = 1.0 - _smoothstep((distance - reach * 0.55) / (reach * 0.45))

    merged = np.zeros((count, weights.shape[1]))
    np.add.at(merged, welded, weights)
    merged /= np.bincount(welded, minlength=count)[:, None]
    merged_strength = np.zeros(count)
    np.maximum.at(merged_strength, welded, strength)

    source = np.repeat(np.arange(count), counts)
    for _ in range(iterations):
        summed = np.zeros_like(merged)
        np.add.at(summed, source, merged[neighbours])
        merged += merged_strength[:, None] * (summed / np.maximum(counts, 1)[:, None] - merged)
    weights[:] = merged[welded]


def _pool_helpers(body: Body, weights: np.ndarray) -> None:
    """Fold bone heat's own helper split back into the upper arm.

    Bone heat spreads the arm between the upper arm and its helpers by distance,
    which is arbitrary; the deterministic split is made later by `_assign_helpers`
    on top of the cleaned arm.
    """
    for side in ("L", "R"):
        arm = body.index[body.bone[f"shoulder.{side.lower()}"]]
        for name in body.helper_names(side).values():
            helper = body.index[name]
            weights[:, arm] += weights[:, helper]
            weights[:, helper] = 0.0


def clean(body: Body, params: dict = PARAMS):
    weights = body.primary["weights"].copy()
    _pool_helpers(body, weights)
    radius = {side: _arm_radius(body, weights, side) for side in ("L", "R")}
    regions = {side: _shoulder_region(body, side, radius[side], params) for side in ("L", "R")}
    log = {"armRadiusCm": {side: round(value * 100, 2) for side, value in radius.items()},
           "shoulder": {}, "thigh": {}}

    for side in ("L", "R"):
        arm = body.index[body.bone[f"shoulder.{side.lower()}"]]
        clavicle = body.index[body.bone[f"clavicle.{side.lower()}"]]
        before = (weights[:, arm].copy(), weights[:, clavicle].copy())
        _confine(body, weights, side, regions[side], None)
        _blend_cap(body, weights, side, regions[side], params)
        helper_log = _assign_helpers(body, weights, side, regions[side], params)
        log["shoulder"][side] = {
            "armStrippedVertices": int(((before[0] > 0.05) & (regions[side]["arm"] < 0.5)).sum()),
            "clavicleStrippedVertices": int(((before[1] > 0.05) & (regions[side]["clavicle"] < 0.5)).sum()),
            "capVertices": int(regions[side]["cap"].sum()),
            "armRadiusCm": round(radius[side] * 100, 2),
            **helper_log,
        }
    for side in ("L", "R"):
        log["thigh"][side] = _confine_thigh(body, weights, side, params)
    weights = _normalise_top4(weights)

    ceiling = {side: {"arm": np.maximum(weights[:, body.index[body.bone[f"shoulder.{side.lower()}"]]],
                                        regions[side]["arm"]),
                      "clavicle": np.maximum(weights[:, body.index[body.bone[f"clavicle.{side.lower()}"]]],
                                             regions[side]["clavicle"])}
               for side in ("L", "R")}
    centres = [body.head[body.bone[f"shoulder.{side.lower()}"]] for side in ("L", "R")]
    for _ in range(params["smooth_cycles"]):
        _smooth(body, weights, centres, params["smooth_reach"], params["smooth_iterations"])
        for side in ("L", "R"):
            _confine(body, weights, side, regions[side], ceiling[side])
            _blend_cap(body, weights, side, regions[side], params)
            _assign_helpers(body, weights, side, regions[side], params)
        weights = _normalise_top4(weights)
    return weights, log


def pack(weights: np.ndarray):
    order = np.argsort(-weights, axis=1, kind="stable")[:, :4]
    rows = np.arange(len(weights))[:, None]
    values = weights[rows, order]
    total = values.sum(axis=1, keepdims=True)
    values = values / np.where(total < 1e-12, 1.0, total)
    return np.where(values > 0, order, 0).astype(np.uint8), values.astype(np.float32)


# ---------------------------------------------------------------- measuring

def _displacement(body: Body, weights: np.ndarray, pose: dict, subset: np.ndarray) -> dict:
    posed, _ = body.skinned(weights, pose)
    moved = np.linalg.norm(posed[subset] - body.positions[subset], axis=1)
    return {"vertices": int(subset.sum()), "maxCm": round(float(moved.max()) * 100, 3),
            "p95Cm": round(float(np.percentile(moved, 95)) * 100, 3)}


def _deltoid_ring(body: Body, side: str, radius: float) -> np.ndarray:
    along, distance = body.arm_coords(side, body.positions)
    return (along > -0.045) & (along < 0.075) & (distance < radius * 1.35)


def _inversions(body: Body, weights: np.ndarray, pose: dict, side: str, radius: float) -> int:
    ring = _deltoid_ring(body, side, radius)
    posed, blended = body.skinned(weights, pose)
    triangles = body.triangles
    face = np.cross(posed[triangles[:, 1]] - posed[triangles[:, 0]],
                    posed[triangles[:, 2]] - posed[triangles[:, 0]])
    geometric = np.zeros_like(posed)
    for corner in range(3):
        np.add.at(geometric, triangles[:, corner], face)
    length = np.linalg.norm(geometric, axis=1, keepdims=True)
    geometric = geometric / np.where(length < 1e-12, 1.0, length)
    return int((np.einsum("va,va->v", geometric[ring], blended[ring]) < 0).sum())


def _ring_ratio(body: Body, weights: np.ndarray, pose: dict, side: str, radius: float) -> float:
    """How far the deltoid ring is from round, posed: max over min sector radius.

    Measured about the arm's own posed axis, so a cap that stays a cap reads the
    same in every pose and one that shears into a plate reads higher.
    """
    ring = _deltoid_ring(body, side, radius)
    if ring.sum() < 24:
        return float("nan")
    posed, _ = body.skinned(weights, pose)
    shoulder, elbow = body._arm_bones(side)[:2]
    matrices = body.skin_matrices(pose)
    pivot = matrices[body.index[shoulder]] @ np.append(body.head[shoulder], 1.0)
    tip = matrices[body.index[elbow]] @ np.append(body.head[elbow], 1.0)
    axis = (tip[:3] - pivot[:3])
    axis /= np.linalg.norm(axis)
    relative = posed[ring] - pivot[:3]
    radial = relative - np.outer(relative @ axis, axis)
    distance = np.linalg.norm(radial, axis=1)
    reference = np.cross(axis, FRONT if abs(axis @ FRONT) < 0.9 else LATERAL)
    reference /= np.linalg.norm(reference)
    other = np.cross(axis, reference)
    angle = np.arctan2(radial @ other, radial @ reference)
    sectors = np.floor((angle + np.pi) / (2 * np.pi) * 12).astype(int).clip(0, 11)
    means = np.array([distance[sectors == sector].mean() for sector in range(12) if (sectors == sector).any()])
    return round(float(means.max() / max(means.min(), 1e-6)), 3)


def _armpit_gap(body: Body, weights: np.ndarray, pose: dict, side: str, radius: float) -> float:
    shoulder, _, _ = body.arm_axis(side)
    sign = 1.0 if side == "L" else -1.0
    along, distance = body.arm_coords(side, body.positions)
    slab = (body.positions[:, 1] > shoulder[1] - 0.19) & (body.positions[:, 1] < shoulder[1] - 0.07)
    arm = slab & (distance < radius * 1.2) & (along > 0)
    lateral = sign * body.positions[:, 0]
    torso = slab & (distance > radius * 1.6) & (lateral > 0.0) & (lateral < sign * shoulder[0]) \
        & (np.abs(body.positions[:, 2]) < 0.2)
    if not arm.any() or not torso.any():
        return float("nan")
    posed, _ = body.skinned(weights, pose)
    return float(np.linalg.norm(posed[arm][:, None, :] - posed[torso][None, :, :], axis=2).min())


def measure(body: Body, weights: np.ndarray, contract: dict) -> dict:
    radius = {side: _arm_radius(body, weights, side) for side in ("L", "R")}
    poses = body.poses(contract["gates"]["clavicleShare"])
    field = body.far_field()
    return {
        "farFieldVertices": int(field.sum()),
        "displacement": {name: _displacement(body, weights, pose, field)
                         for name, pose in poses.items() if name != "bind"},
        "normalInversions": {f"{name}_{side}": _inversions(body, weights, poses[name], side, radius[side])
                             for name in ("abduct90", "abduct150", "abduct150_rhythm", "abduct180", "abduct180_rhythm")
                             for side in ("L", "R")},
        "deltoidRingRatio": {f"{name}_{side}": _ring_ratio(body, weights, poses[name], side, radius[side])
                             for name in ("bind", "abduct90", "abduct150_rhythm", "abduct180_rhythm")
                             for side in ("L", "R")},
        "armpitGapCm": {name: {side: round(_armpit_gap(body, weights, poses[name], side, radius[side]) * 100, 2)
                               for side in ("L", "R")} for name in ("bind", "abduct90")},
        "maxInfluencesPerVertex": int((weights > 1e-6).sum(axis=1).max()),
        "weightSumMaxError": round(float(np.abs(weights.sum(axis=1) - 1.0).max()), 9),
    }


def gates(measured: dict, contract: dict) -> dict:
    limits = contract["gates"]
    inversions = measured["normalInversions"]
    return {
        f"far_field_under_{limits['farFieldDisplacement90Cm']}cm_at_90":
            measured["displacement"]["abduct90"]["maxCm"] <= limits["farFieldDisplacement90Cm"],
        f"far_field_under_{limits['farFieldDisplacement150Cm']}cm_at_150":
            measured["displacement"]["abduct150"]["maxCm"] <= limits["farFieldDisplacement150Cm"],
        f"far_field_under_{limits['flexion60DisplacementCm']}cm_at_flexion_60":
            measured["displacement"]["flex60"]["maxCm"] <= limits["flexion60DisplacementCm"],
        "no_deltoid_normal_inversions_at_90":
            all(inversions[f"abduct90_{side}"] <= limits["normalInversions90"] for side in ("L", "R")),
        f"at_most_{limits['normalInversions150']}_inversions_at_150_with_clavicle_rhythm":
            all(inversions[f"abduct150_rhythm_{side}"] <= limits["normalInversions150"] for side in ("L", "R")),
        "at_most_four_influences_per_vertex":
            measured["maxInfluencesPerVertex"] <= contract["budget"]["maxInfluencesPerVertex"],
        "weights_sum_to_one": measured["weightSumMaxError"] <= 1e-5,
    }
