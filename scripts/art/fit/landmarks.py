"""Where a humanoid's joints are, read off the mesh alone.

Every point that enters and leaves this module is in the runtime frame of
`frame.py`: +Y up, +Z forward, +X the character's left. There is no bpy here,
so the fitter is testable without Blender and cannot pick up a Blender-frame
assumption by accident.

Each landmark comes back with the method that produced it and a confidence, and
`fit` raises rather than guessing when one is under-sampled: a landmark placed
from twelve stray vertices is a bone in the wrong place three stages later.
"""

from __future__ import annotations

import math

import numpy as np

BANDS = {
    "ankle": (0.045, 0.09),
    "knee": (0.255, 0.315),
    "hip": (0.455, 0.51),
    "spine": (0.515, 0.57),
    "elbow": (0.60, 0.68),
    "chest": (0.645, 0.70),
    "upper_torso": (0.775, 0.81),
}
ARM_BANDS = ((0.10, 0.12), (0.12, 0.14), (0.14, 0.16), (0.16, 0.18))
ARM_HEIGHT_WINDOW = (0.68, 0.83)
SHOULDER_EXTRAPOLATION_X = 0.105
CENTRAL_WIDTH_FRACTION = 0.18
MINIMUM_SLICE_POINTS = 12
NOMINAL_SLICE_POINTS = 40
OUTER_CLUSTER_MINIMUM_GAP = 0.015
SEAM_PAIR_COUNT = 32
SOLE_BAND = 0.012
HIP_LATERAL_LIMIT = 0.16
WRIST_SEARCH = (0.6, 0.93)


class LandmarkError(RuntimeError):
    pass


def _band(points: np.ndarray, floor: float, height: float, band) -> np.ndarray:
    low, high = floor + height * band[0], floor + height * band[1]
    return points[(points[:, 1] >= low) & (points[:, 1] <= high)]


def _surface_centre(points: np.ndarray) -> np.ndarray:
    """Midpoint of the 10th and 90th percentile in x and z, median in y.

    A mean follows wherever the mesh happens to be dense; this follows the
    surface's own extent, which is what a joint sits in the middle of.
    """
    if len(points) < MINIMUM_SLICE_POINTS:
        raise LandmarkError(f"landmark slice has only {len(points)} points")
    low, high = np.percentile(points, 10, axis=0), np.percentile(points, 90, axis=0)
    return np.array([(low[0] + high[0]) / 2, float(np.median(points[:, 1])), (low[2] + high[2]) / 2])


def _outer_cluster(points: np.ndarray, side: int, height: float) -> np.ndarray:
    """One limb out of a bilateral slice: the outer cluster on the given side."""
    signed = points[points[:, 0] * side > 0]
    if len(signed) < MINIMUM_SLICE_POINTS:
        raise LandmarkError("bilateral slice is under-sampled on one side")
    lateral = np.sort(np.abs(signed[:, 0]))
    if lateral[0] > height * 0.04:
        return signed
    floor_group = max(MINIMUM_SLICE_POINTS, round(len(lateral) * 0.12))
    window = lateral[floor_group:len(lateral) - floor_group + 1]
    gaps = np.diff(window) if len(window) > 1 else np.array([0.0])
    at = int(np.argmax(gaps))
    if gaps[at] < height * OUTER_CLUSTER_MINIMUM_GAP:
        cutoff = float(np.percentile(lateral, 55))
    else:
        cutoff = float((window[at] + window[at + 1]) / 2)
    selected = signed[np.abs(signed[:, 0]) >= cutoff]
    if len(selected) < MINIMUM_SLICE_POINTS:
        raise LandmarkError("outer limb cluster is under-sampled")
    return selected


def _mirror(left: np.ndarray, right: np.ndarray):
    """Force a bilateral pair onto one mirrored pair, and say how far it moved."""
    lateral = (abs(left[0]) + abs(right[0])) / 2
    shared = (left[1:] + right[1:]) / 2
    error = float(np.linalg.norm([left[0] + right[0], left[1] - right[1], left[2] - right[2]]))
    return (np.array([lateral, shared[0], shared[1]]),
            np.array([-lateral, shared[0], shared[1]]), error)


def _central(points: np.ndarray, floor: float, height: float, width: float, band) -> np.ndarray:
    sliced = _band(points, floor, height, band)
    return _surface_centre(sliced[np.abs(sliced[:, 0]) <= width * CENTRAL_WIDTH_FRACTION])


def _seam_centre(primary: np.ndarray, secondary: np.ndarray, height: float) -> np.ndarray:
    """Where two mesh regions meet: the midpoints of the closest vertex pairs."""
    low, high = secondary[:, 1].min(), secondary[:, 1].max()
    padding = height * 0.035
    near = primary[(primary[:, 1] >= low - padding) & (primary[:, 1] <= high + padding)]
    if len(near) < MINIMUM_SLICE_POINTS:
        raise LandmarkError("mesh regions do not overlap in height")
    distance = np.linalg.norm(secondary[:, None, :] - near[None, :, :], axis=2)
    nearest = np.argmin(distance, axis=1)
    best = distance[np.arange(len(secondary)), nearest]
    order = np.argsort(best)[:SEAM_PAIR_COUNT]
    return _surface_centre((secondary[order] + near[nearest[order]]) / 2)


def _arm_centreline(points: np.ndarray, side: int, floor: float, height: float):
    """The shoulder joint, extrapolated up the upper arm's own medial axis.

    The joint is inside the deltoid, where no surface slice can find it, so the
    arm's cross-section centres are fitted as a line and followed inwards. The
    band that is not fitted is held out and its residual is the confidence.
    """
    window = (floor + height * ARM_HEIGHT_WINDOW[0], floor + height * ARM_HEIGHT_WINDOW[1])
    in_window = points[(points[:, 1] >= window[0]) & (points[:, 1] <= window[1])]
    centres, counts = [], []
    for low, high in ARM_BANDS:
        lateral = np.abs(in_window[:, 0])
        own_side = in_window[:, 0] * side > 0
        # A sparser mesh puts fewer vertices in a two-centimetre band; widen the
        # band about its centre until it holds a slice, rather than fail on density.
        middle, half = (low + high) / 2, (high - low) / 2
        for widen in (1.0, 1.5, 2.25, 3.4):
            selected = in_window[(lateral >= height * (middle - half * widen))
                                 & (lateral <= height * (middle + half * widen)) & own_side]
            if len(selected) >= MINIMUM_SLICE_POINTS:
                break
        centre = _surface_centre(selected)
        centres.append(np.array([abs(centre[0]), centre[1], centre[2]]))
        counts.append(len(selected))
    # A least-squares line through every band: a stylised arm's centres wander
    # more than an anatomical one's, and one held-out band then reads as noise.
    samples = np.array(centres)
    if float(samples[:, 0].max() - samples[:, 0].min()) < 1e-9:
        raise LandmarkError("proximal upper-arm samples cannot define a medial axis")
    target_x = height * SHOULDER_EXTRAPOLATION_X
    fitted = []
    for axis in (1, 2):
        slope, intercept = np.polyfit(samples[:, 0], samples[:, axis], 1)
        fitted.append((float(slope), float(intercept)))
    predicted = np.stack([fitted[0][0] * samples[:, 0] + fitted[0][1],
                          fitted[1][0] * samples[:, 0] + fitted[1][1]], axis=1)
    residual = float(np.sqrt(np.mean(np.sum((predicted - samples[:, 1:]) ** 2, axis=1))))
    target = np.array([side * target_x,
                       fitted[0][0] * target_x + fitted[0][1],
                       fitted[1][0] * target_x + fitted[1][1]])
    # Enough points per band to centre a slice is full marks; a denser mesh is not
    # a better-placed shoulder. The held-out residual carries the geometry's vote.
    confidence = min(1.0, sum(counts) / (4 * MINIMUM_SLICE_POINTS)) * max(0.0, 1.0 - residual / (height * 0.03))
    return target, {"method": "proximal_upper_arm_medial_axis_fit",
                    "sampleCount": int(sum(counts)),
                    "heldOutResidualMetres": round(residual, 6),
                    "confidence": round(min(1.0, confidence), 4)}


def _hand_tip(points: np.ndarray, wrist: np.ndarray) -> np.ndarray:
    direction = _surface_centre(points) - wrist
    length = float(np.linalg.norm(direction))
    if length < 1e-6:
        raise LandmarkError("hand region sits on top of its wrist")
    unit = direction / length
    along = (points - wrist) @ unit
    return wrist + unit * float(np.percentile(along, 90))


def _wrist_from_arm(body: np.ndarray, shoulder: np.ndarray, elbow: np.ndarray, side: int, height: float):
    """The wrist on a body whose hands are not separate: the forearm's narrowest section.

    Points beyond the elbow along the upper arm's axis are binned by distance
    along it; the bin with the smallest cross-section, past the mid-forearm and
    before the hand widens, is the wrist. The hand tip is the far end of the
    same run.
    """
    direction = elbow - shoulder
    length = float(np.linalg.norm(direction))
    direction = direction / length
    relative = body - shoulder
    along = relative @ direction
    radial = np.linalg.norm(relative - np.outer(along, direction), axis=1)
    beyond = (along > length) & (body[:, 0] * side > 0) & (radial < height * 0.09)
    if beyond.sum() < MINIMUM_SLICE_POINTS * 4:
        raise LandmarkError("forearm run is under-sampled")
    run_along, run_radial = along[beyond] - length, radial[beyond]
    reach = float(np.percentile(run_along, 99))
    step = height * 0.01
    bins = np.arange(0.0, reach, step)
    widths = np.array([np.percentile(run_radial[(run_along >= start) & (run_along < start + step)], 85)
                       if ((run_along >= start) & (run_along < start + step)).sum() >= MINIMUM_SLICE_POINTS else np.inf
                       for start in bins])
    window = (bins >= reach * WRIST_SEARCH[0]) & (bins <= reach * WRIST_SEARCH[1])
    if not window.any() or not np.isfinite(widths[window]).any():
        raise LandmarkError("no forearm section to read a wrist from")
    at = int(np.argmin(np.where(window, widths, np.inf)))
    wrist_along = bins[at] + step / 2
    slab = beyond.copy()
    slab[beyond] = np.abs(run_along - wrist_along) <= step
    wrist = _surface_centre(body[slab])
    tip_slab = beyond.copy()
    tip_slab[beyond] = run_along >= reach - height * 0.02
    tip = _surface_centre(body[tip_slab]) if tip_slab.sum() >= MINIMUM_SLICE_POINTS else shoulder + direction * (length + reach)
    return wrist, tip, {"sampleCount": int(slab.sum()), "forearmReachMetres": round(reach, 6),
                        "wristWidthMetres": round(float(widths[at]) * 2, 6)}


def _sole(points: np.ndarray, side: int, floor: float, height: float) -> np.ndarray:
    foot = points[(points[:, 0] * side > 0) & (points[:, 1] <= floor + height * 0.07)]
    if len(foot) < MINIMUM_SLICE_POINTS:
        raise LandmarkError("foot region is under-sampled")
    return foot[foot[:, 1] <= foot[:, 1].min() + height * SOLE_BAND]


def _tip(points: np.ndarray, axis: int, sign: int, height: float) -> np.ndarray:
    """The far end of a cluster along one axis: the tip, not the average near it.

    Averaging back from an extreme is how a toe lands in the middle of a foot.
    The window is widened only if the tip is too thin to average at all.
    """
    reach = float((sign * points[:, axis]).max())
    for window in (0.01, 0.02, 0.04, 0.08):
        near = points[sign * points[:, axis] >= reach - height * window]
        if len(near) >= MINIMUM_SLICE_POINTS:
            return _surface_centre(near)
    raise LandmarkError("cluster has no tip with enough points to average")


def footprint(sole: np.ndarray, ankle: np.ndarray) -> dict:
    """Where the skinned foot meets the ground, relative to its own ankle.

    Measured off the sole's real extremes rather than off the toe and heel
    landmarks, which sit a centimetre inside the tips: this is the surface the
    gait rolls the foot over, and a foot that rolls short of its own toe slides.
    """
    back, front = float(sole[:, 2].min()), float(sole[:, 2].max())
    edge = (front - back) * 0.08
    heel_height = float(sole[sole[:, 2] <= back + edge][:, 1].mean())
    toe_height = float(sole[sole[:, 2] >= front - edge][:, 1].mean())
    return {"heel": round(float(ankle[2]) - back, 6),
            "toe": round(front - float(ankle[2]), 6),
            "lift": round(float(ankle[1]) - float(sole[:, 1].min()), 6),
            "pitch": round(math.atan2(toe_height - heel_height, front - back), 6)}


def _confidence(samples: int) -> float:
    """How well sampled a landmark is. Symmetry is a separate gate, not a discount:
    a mesh that is a centimetre lopsided is a mesh to reject, not to half-trust."""
    return round(min(1.0, samples / NOMINAL_SLICE_POINTS), 4)


def torso_lean(body: np.ndarray, floor: float, height: float, width: float) -> tuple[np.ndarray, np.ndarray]:
    """The torso's own axis, hip height to shoulder height, front to back only.

    Both ends are the same kind of measurement - the midrange of a central slice
    of the torso - because a lean is a difference between like things. Measuring
    from a hip cluster to an extrapolated shoulder joint reads the shoulder's
    anatomy (the ball sits behind the chest) as five degrees of backward lean,
    and "correcting" that tilts an upright body over. Only the sagittal
    component is kept: the lateral midline of a surface slice wanders by a
    centimetre with the mesh's own density, which is three degrees of lean that
    is not there.
    """
    hip = _central(body, floor, height, width, BANDS["hip"])
    shoulder = _central(body, floor, height, width, BANDS["upper_torso"])
    sagittal = np.array([0.0, 1.0, 1.0])
    return hip * sagittal, shoulder * sagittal


def fit(regions: dict[str, np.ndarray]) -> dict:
    everything = np.concatenate(list(regions.values()))
    low, high = everything.min(axis=0), everything.max(axis=0)
    height = float(high[1] - low[1])
    width = float(high[0] - low[0])
    body = regions["Body"]

    landmarks: dict[str, np.ndarray] = {}
    measurements: dict[str, dict] = {}

    paired = {"ankle": "ankle", "knee": "knee", "hip": "hip", "elbow": "elbow"}
    for band_name, landmark in paired.items():
        sliced = _band(body, low[1], height, BANDS[band_name])
        if band_name == "hip":
            # Hanging hands reach hip height on a low A-pose; the hip is never that far out.
            sliced = sliced[np.abs(sliced[:, 0]) <= height * HIP_LATERAL_LIMIT]
        clusters = {side: _outer_cluster(sliced, sign, height) for side, sign in (("L", 1), ("R", -1))}
        left, right, error = _mirror(_surface_centre(clusters["L"]), _surface_centre(clusters["R"]))
        landmarks[f"{landmark}_L"], landmarks[f"{landmark}_R"] = left, right
        for side in ("L", "R"):
            measurements[f"{landmark}_{side}"] = {
                "method": "height_slice_outer_cluster",
                "band": list(BANDS[band_name]),
                "sampleCount": int(len(clusters[side])),
                "symmetryErrorMetres": round(error, 6),
                "confidence": _confidence(len(clusters[side])),
            }

    left, detail_left = _arm_centreline(body, 1, low[1], height)
    right, detail_right = _arm_centreline(body, -1, low[1], height)
    landmarks["shoulder_L"], landmarks["shoulder_R"], error = _mirror(left, right)
    for side, detail in (("L", detail_left), ("R", detail_right)):
        measurements[f"shoulder_{side}"] = {**detail, "symmetryErrorMetres": round(error, 6),
                                            "confidence": round(min(detail["confidence"],
                                                                    _confidence(detail["sampleCount"])), 4)}

    if "Hand_PositiveX" in regions and "Hand_NegativeX" in regions:
        wrists = {"L": _seam_centre(body, regions["Hand_PositiveX"], height),
                  "R": _seam_centre(body, regions["Hand_NegativeX"], height)}
        hands = {"L": _hand_tip(regions["Hand_PositiveX"], wrists["L"]),
                 "R": _hand_tip(regions["Hand_NegativeX"], wrists["R"])}
        wrist_detail = {side: {"method": "region_seam_midpoints", "sampleCount": SEAM_PAIR_COUNT} for side in ("L", "R")}
        hand_detail = {side: {"method": "distal_hand_extent", "sampleCount": int(len(regions[region]))}
                       for side, region in (("L", "Hand_PositiveX"), ("R", "Hand_NegativeX"))}
    else:
        wrists, hands, wrist_detail, hand_detail = {}, {}, {}, {}
        for side, sign in (("L", 1), ("R", -1)):
            wrist, tip, detail = _wrist_from_arm(body, landmarks[f"shoulder_{side}"], landmarks[f"elbow_{side}"], sign, height)
            wrists[side], hands[side] = wrist, tip
            wrist_detail[side] = {"method": "forearm_narrowest_section", **detail}
            hand_detail[side] = {"method": "forearm_axis_extent", **detail}
    landmarks["wrist_L"], landmarks["wrist_R"], error = _mirror(wrists["L"], wrists["R"])
    for side in ("L", "R"):
        measurements[f"wrist_{side}"] = {**wrist_detail[side], "symmetryErrorMetres": round(error, 6),
                                         "confidence": _confidence(wrist_detail[side]["sampleCount"])}
    landmarks["hand_L"], landmarks["hand_R"], error = _mirror(hands["L"], hands["R"])
    for side in ("L", "R"):
        measurements[f"hand_{side}"] = {**hand_detail[side], "symmetryErrorMetres": round(error, 6),
                                        "confidence": _confidence(hand_detail[side]["sampleCount"])}

    soles = {}
    for side, sign in (("L", 1), ("R", -1)):
        sole = _sole(body, sign, low[1], height)
        soles[side] = sole
        landmarks[f"toe_{side}"] = _tip(sole, 2, 1, height)
        landmarks[f"heel_{side}"] = _tip(sole, 2, -1, height)
        for landmark in (f"toe_{side}", f"heel_{side}"):
            measurements[landmark] = {"method": "sole_extent", "sampleCount": int(len(sole)),
                                      "confidence": _confidence(len(sole))}
    for landmark in ("toe", "heel"):
        left, right, error = _mirror(landmarks[f"{landmark}_L"], landmarks[f"{landmark}_R"])
        landmarks[f"{landmark}_L"], landmarks[f"{landmark}_R"] = left, right
        for side in ("L", "R"):
            measurements[f"{landmark}_{side}"]["symmetryErrorMetres"] = round(error, 6)
            measurements[f"{landmark}_{side}"]["confidence"] = _confidence(
                measurements[f"{landmark}_{side}"]["sampleCount"])

    landmarks["pelvis"] = (landmarks["hip_L"] + landmarks["hip_R"]) / 2
    measurements["pelvis"] = {"method": "bilateral_hip_midpoint", "sampleCount": measurements["hip_L"]["sampleCount"],
                              "confidence": min(measurements["hip_L"]["confidence"], measurements["hip_R"]["confidence"])}
    for name, band in (("spine", "spine"), ("chest", "chest"), ("neck_base", "upper_torso")):
        sliced = _band(body, low[1], height, BANDS[band])
        central = sliced[np.abs(sliced[:, 0]) <= width * CENTRAL_WIDTH_FRACTION]
        landmarks[name] = _surface_centre(central)
        measurements[name] = {"method": "height_slice_central_cluster", "band": list(BANDS[band]),
                              "sampleCount": int(len(central)), "confidence": _confidence(len(central))}

    landmarks["neck"] = _seam_centre(body, regions["Head"], height)
    measurements["neck"] = {"method": "region_seam_midpoints", "sampleCount": SEAM_PAIR_COUNT,
                            "confidence": _confidence(SEAM_PAIR_COUNT * 4)}
    head = regions["Head"]
    head_low, head_high = head.min(axis=0), head.max(axis=0)
    landmarks["head"] = np.array([(head_low[0] + head_high[0]) / 2, head_high[1] - height * 0.015,
                                  (head_low[2] + head_high[2]) / 2])
    measurements["head"] = {"method": "head_bounds_crown", "sampleCount": int(len(head)),
                            "confidence": _confidence(len(head))}
    landmarks["root"] = np.array([0.0, low[1], (landmarks["heel_L"][2] + landmarks["toe_L"][2]) / 2])
    measurements["root"] = {"method": "ground_under_the_footprint", "sampleCount": int(len(everything)),
                            "confidence": 1.0}

    prints = [footprint(soles[side], landmarks[f"ankle_{side}"]) for side in ("L", "R")]
    averaged = {key: round(sum(each[key] for each in prints) / 2, 6) for key in prints[0]}

    return {"landmarks": landmarks, "measurements": measurements, "footprint": averaged,
            "bounds": {"minimum": low.tolist(), "maximum": high.tolist(), "height": height, "width": width}}


def check_symmetry(fitted: dict, contract: dict) -> None:
    """A mirrored landmark hides how lopsided the mesh under it was; this reports it.

    On a body whose sagittal plane was fitted before the landmarks were, the
    errors are sub-millimetre. A centimetre here means the plane is wrong, not
    that the generator was sloppy.
    """
    limit = fitted["bounds"]["height"] * contract["symmetryToleranceHeight"]
    lopsided = []
    for name, detail in sorted(fitted["measurements"].items()):
        error = detail.get("symmetryErrorMetres")
        if error is None:
            continue
        detail["symmetryToleranceMetres"] = round(limit, 6)
        root = name.rsplit("_", 1)[0]
        if error > limit and (root, error) not in lopsided:
            lopsided.append((root, error))
    if lopsided:
        detail = ", ".join(f"{name} {error * 100:.2f}cm" for name, error in lopsided)
        raise LandmarkError(
            f"symmetry gate: bilateral landmarks are lopsided by more than {limit * 100:.2f}cm: {detail}")


def check_confidence(fitted: dict, minimum: float, required: list[str]) -> None:
    missing = [name for name in required if name not in fitted["landmarks"]]
    if missing:
        raise LandmarkError(f"landmark gate: no landmark fitted for {', '.join(sorted(missing))}")
    weak = sorted((name, fitted["measurements"][name]["confidence"]) for name in required
                  if fitted["measurements"][name]["confidence"] < minimum)
    if weak:
        detail = ", ".join(f"{name} {value:.2f} {fitted['measurements'][name]}" for name, value in weak)
        raise LandmarkError(f"landmark gate: confidence below {minimum} for {detail}")
