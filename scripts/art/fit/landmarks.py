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
        selected = in_window[(lateral >= height * low) & (lateral <= height * high) & (in_window[:, 0] * side > 0)]
        centre = _surface_centre(selected)
        centres.append(np.array([abs(centre[0]), centre[1], centre[2]]))
        counts.append(len(selected))
    training = np.array([centres[0], centres[2]])
    held_out = centres[1]
    target_x = height * SHOULDER_EXTRAPOLATION_X
    fitted = []
    for axis in (1, 2):
        span = training[1, 0] - training[0, 0]
        if abs(span) < 1e-9:
            raise LandmarkError("proximal upper-arm samples cannot define a medial axis")
        slope = (training[1, axis] - training[0, axis]) / span
        intercept = training[0, axis] - slope * training[0, 0]
        fitted.append((slope, intercept))
    predicted = [slope * held_out[0] + intercept for slope, intercept in fitted]
    residual = float(np.linalg.norm([predicted[0] - held_out[1], predicted[1] - held_out[2]]))
    target = np.array([side * target_x,
                       fitted[0][0] * target_x + fitted[0][1],
                       fitted[1][0] * target_x + fitted[1][1]])
    confidence = min(1.0, sum(counts) / (4 * MINIMUM_SLICE_POINTS * 2)) * max(0.0, 1.0 - residual / (height * 0.03))
    return target, {"method": "proximal_upper_arm_medial_axis_extrapolation",
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


def _sole(points: np.ndarray, side: int, floor: float, height: float) -> np.ndarray:
    foot = points[(points[:, 0] * side > 0) & (points[:, 1] <= floor + height * 0.07)]
    if len(foot) < MINIMUM_SLICE_POINTS:
        raise LandmarkError("foot region is under-sampled")
    return foot[foot[:, 1] <= foot[:, 1].min() + height * SOLE_BAND]


def _end_of(points: np.ndarray, axis: int, sign: int) -> np.ndarray:
    """The far end of a cluster along one axis, always enough points to average."""
    take = max(MINIMUM_SLICE_POINTS * 2, int(len(points) * 0.15))
    order = np.argsort(sign * points[:, axis])[-take:]
    return points[order]


def _confidence(samples: int) -> float:
    """How well sampled a landmark is. Symmetry is a separate gate, not a discount:
    a mesh that is a centimetre lopsided is a mesh to reject, not to half-trust."""
    return round(min(1.0, samples / NOMINAL_SLICE_POINTS), 4)


def torso_lean(body: np.ndarray, floor: float, height: float) -> tuple[np.ndarray, np.ndarray]:
    """The hip-to-shoulder axis, measured off bilateral pairs so it is sagittal.

    A central surface slice puts the midline wherever the mesh happens to be
    dense, which reads as several degrees of sideways lean on a body that has
    none. A mirrored pair cannot: its midpoint sits on x = 0 by construction, so
    what is left is the lean that actually exists, front to back.
    """
    sliced = _band(body, floor, height, BANDS["hip"])
    hips = [_surface_centre(_outer_cluster(sliced, sign, height)) for sign in (1, -1)]
    shoulders = [_arm_centreline(body, sign, floor, height)[0] for sign in (1, -1)]
    return ((hips[0] + hips[1]) / 2 * np.array([0.0, 1.0, 1.0]),
            (shoulders[0] + shoulders[1]) / 2 * np.array([0.0, 1.0, 1.0]))


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

    wrists = {"L": _seam_centre(body, regions["Hand_PositiveX"], height),
              "R": _seam_centre(body, regions["Hand_NegativeX"], height)}
    landmarks["wrist_L"], landmarks["wrist_R"], error = _mirror(wrists["L"], wrists["R"])
    for side in ("L", "R"):
        measurements[f"wrist_{side}"] = {"method": "region_seam_midpoints", "sampleCount": SEAM_PAIR_COUNT,
                                         "symmetryErrorMetres": round(error, 6),
                                         "confidence": _confidence(SEAM_PAIR_COUNT * 4)}

    hands = {"L": _hand_tip(regions["Hand_PositiveX"], wrists["L"]),
             "R": _hand_tip(regions["Hand_NegativeX"], wrists["R"])}
    landmarks["hand_L"], landmarks["hand_R"], error = _mirror(hands["L"], hands["R"])
    for side, region in (("L", "Hand_PositiveX"), ("R", "Hand_NegativeX")):
        measurements[f"hand_{side}"] = {"method": "distal_hand_extent", "sampleCount": int(len(regions[region])),
                                        "symmetryErrorMetres": round(error, 6),
                                        "confidence": _confidence(len(regions[region]))}

    for side, sign in (("L", 1), ("R", -1)):
        sole = _sole(body, sign, low[1], height)
        landmarks[f"toe_{side}"] = _surface_centre(_end_of(sole, 2, 1))
        landmarks[f"heel_{side}"] = _surface_centre(_end_of(sole, 2, -1))
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

    return {"landmarks": landmarks, "measurements": measurements,
            "bounds": {"minimum": low.tolist(), "maximum": high.tolist(), "height": height, "width": width}}


def check_symmetry(fitted: dict, contract: dict) -> None:
    """A mirrored landmark hides how lopsided the mesh under it was; this reports it.

    Distal landmarks get their own tolerance: a generator is least symmetric at
    the end of a chain, and a centimetre at a fingertip is not a centimetre at a
    hip.
    """
    height = fitted["bounds"]["height"]
    tolerances = contract["symmetryToleranceHeight"]
    distal = set(contract["distalLandmarks"])
    lopsided = []
    for name, detail in sorted(fitted["measurements"].items()):
        error = detail.get("symmetryErrorMetres")
        if error is None:
            continue
        root = name.rsplit("_", 1)[0]
        limit = height * tolerances["distal" if root in distal else "default"]
        detail["symmetryToleranceMetres"] = round(limit, 6)
        if error > limit and (root, error, limit) not in lopsided:
            lopsided.append((root, error, limit))
    if lopsided:
        detail = ", ".join(f"{name} {error * 100:.2f}cm over {limit * 100:.2f}cm"
                           for name, error, limit in lopsided)
        raise LandmarkError(f"symmetry gate: bilateral landmarks are lopsided: {detail}")


def check_confidence(fitted: dict, minimum: float, required: list[str]) -> None:
    missing = [name for name in required if name not in fitted["landmarks"]]
    if missing:
        raise LandmarkError(f"landmark gate: no landmark fitted for {', '.join(sorted(missing))}")
    weak = sorted((name, fitted["measurements"][name]["confidence"]) for name in required
                  if fitted["measurements"][name]["confidence"] < minimum)
    if weak:
        detail = ", ".join(f"{name} {value:.2f}" for name, value in weak)
        raise LandmarkError(f"landmark gate: confidence below {minimum} for {detail}")
