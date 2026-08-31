import math


HUMANOID_V1 = {
    "name": "humanoid.v1",
    "heightBands": {
        "ankle": (0.045, 0.09),
        "knee": (0.255, 0.315),
        "hip": (0.455, 0.51),
        "spine": (0.515, 0.57),
        "elbow": (0.60, 0.68),
        "chest": (0.645, 0.70),
        "shoulder": (0.735, 0.785),
    },
    "jointToleranceHeight": 0.02,
    "symmetryToleranceHeight": 0.012,
    "sliceMinimumPoints": 12,
    "outerClusterMinimumGapHeight": 0.015,
    "centralWidthFraction": 0.18,
    "proximalArmBands": ((0.10, 0.12), (0.12, 0.14), (0.14, 0.16), (0.16, 0.18)),
    "shoulderExtrapolationXHeight": 0.105,
    "upperTorsoBand": (0.775, 0.81),
    "seamCandidateHeightPadding": 0.035,
    "seamPairCount": 32,
}


def percentile(values, fraction):
    ordered = sorted(values)
    if not ordered:
        raise ValueError("Cannot measure an empty point set")
    position = (len(ordered) - 1) * fraction
    lower = math.floor(position)
    upper = math.ceil(position)
    if lower == upper:
        return ordered[lower]
    weight = position - lower
    return ordered[lower] * (1 - weight) + ordered[upper] * weight


def robust_surface_center(points):
    if len(points) < HUMANOID_V1["sliceMinimumPoints"]:
        raise ValueError(f"Landmark slice has only {len(points)} points")
    return (
        (percentile([point[0] for point in points], 0.1) + percentile([point[0] for point in points], 0.9)) / 2,
        (percentile([point[1] for point in points], 0.1) + percentile([point[1] for point in points], 0.9)) / 2,
        percentile([point[2] for point in points], 0.5),
    )


def mesh_bounds(points):
    return tuple(min(point[axis] for point in points) for axis in range(3)), tuple(
        max(point[axis] for point in points) for axis in range(3)
    )


def points_in_height_band(points, minimum_z, height, band):
    lower = minimum_z + height * band[0]
    upper = minimum_z + height * band[1]
    return [point for point in points if lower <= point[2] <= upper]


def side_outer_cluster(points, side, height):
    signed = [point for point in points if point[0] * side > 0]
    if len(signed) < HUMANOID_V1["sliceMinimumPoints"]:
        raise ValueError("Bilateral slice does not contain enough points on both sides")
    absolute_x = sorted(abs(point[0]) for point in signed)
    if absolute_x[0] > height * 0.04:
        return signed
    minimum_group = max(HUMANOID_V1["sliceMinimumPoints"], round(len(absolute_x) * 0.12))
    candidates = [
        (absolute_x[index + 1] - absolute_x[index], index)
        for index in range(minimum_group - 1, len(absolute_x) - minimum_group)
    ]
    gap, index = max(candidates, default=(0, 0))
    if gap < height * HUMANOID_V1["outerClusterMinimumGapHeight"]:
        cutoff = percentile(absolute_x, 0.55)
    else:
        cutoff = (absolute_x[index] + absolute_x[index + 1]) / 2
    selected = [point for point in signed if abs(point[0]) >= cutoff]
    if len(selected) < HUMANOID_V1["sliceMinimumPoints"]:
        raise ValueError("Outer limb cluster is under-sampled")
    return selected


def central_slice(points, minimum_z, height, width, band):
    sliced = points_in_height_band(points, minimum_z, height, band)
    central = [point for point in sliced if abs(point[0]) <= width * HUMANOID_V1["centralWidthFraction"]]
    return robust_surface_center(central)


def closest_surface_center(primary, secondary, minimum_z, height):
    secondary_minimum, secondary_maximum = mesh_bounds(secondary)
    padding = height * HUMANOID_V1["seamCandidateHeightPadding"]
    primary_candidates = [
        point
        for point in primary
        if secondary_minimum[2] - padding <= point[2] <= secondary_maximum[2] + padding
    ]
    pairs = []
    for secondary_point in secondary:
        primary_point = min(primary_candidates, key=lambda point: squared_distance(point, secondary_point))
        pairs.append((squared_distance(primary_point, secondary_point), primary_point, secondary_point))
    pairs.sort(key=lambda entry: entry[0])
    midpoints = [
        tuple((primary[axis] + secondary_point[axis]) / 2 for axis in range(3))
        for _, primary, secondary_point in pairs[: HUMANOID_V1["seamPairCount"]]
    ]
    return robust_surface_center(midpoints)


def squared_distance(first, second):
    return sum((first[axis] - second[axis]) ** 2 for axis in range(3))


def mirror_pair(left, right):
    x = (abs(left[0]) + abs(right[0])) / 2
    y = (left[1] + right[1]) / 2
    z = (left[2] + right[2]) / 2
    raw_error = math.sqrt((left[0] + right[0]) ** 2 + (left[1] - right[1]) ** 2 + (left[2] - right[2]) ** 2)
    return (x, y, z), (-x, y, z), raw_error


def linear_fit(samples, value_axis):
    xs = [sample[0] for sample in samples]
    values = [sample[value_axis] for sample in samples]
    mean_x = sum(xs) / len(xs)
    mean_value = sum(values) / len(values)
    variance = sum((x - mean_x) ** 2 for x in xs)
    if variance < 1e-10:
        raise ValueError("Proximal upper-arm samples cannot define a medial axis")
    slope = sum((x - mean_x) * (value - mean_value) for x, value in zip(xs, values)) / variance
    return slope, mean_value - slope * mean_x


def proximal_arm_centerline(points, side, minimum_z, height):
    centers = []
    samples = []
    for lower_fraction, upper_fraction in HUMANOID_V1["proximalArmBands"]:
        lower = height * lower_fraction
        upper = height * upper_fraction
        selected = [
            point
            for point in points
            if lower <= abs(point[0]) <= upper
            and point[0] * side > 0
            and minimum_z + height * 0.68 <= point[2] <= minimum_z + height * 0.83
        ]
        center = robust_surface_center(selected)
        center = (abs(center[0]), center[1], center[2])
        centers.append(center)
        samples.append(len(selected))
    training = [centers[index] for index in (0, 2)]
    held_out = centers[1]
    y_slope, y_intercept = linear_fit(training, 1)
    z_slope, z_intercept = linear_fit(training, 2)
    target_x = height * HUMANOID_V1["shoulderExtrapolationXHeight"]
    target = (side * target_x, y_slope * target_x + y_intercept, z_slope * target_x + z_intercept)
    predicted_held_out = (
        side * held_out[0],
        y_slope * held_out[0] + y_intercept,
        z_slope * held_out[0] + z_intercept,
    )
    held_out_signed = (side * held_out[0], held_out[1], held_out[2])
    residual = math.sqrt(squared_distance(predicted_held_out, held_out_signed))
    return target, {
        "method": "proximal_upper_arm_medial_axis_extrapolation",
        "sourceObjects": ["Body"],
        "heightBands": HUMANOID_V1["proximalArmBands"],
        "crossSectionCenters": [(side * center[0], center[1], center[2]) for center in centers],
        "trainingSectionIndices": [0, 2],
        "heldOutSectionIndex": 1,
        "heldOutResidualMetres": residual,
        "extrapolationXMetres": side * target_x,
        "sampleCounts": samples,
        "sampleCount": sum(samples),
        "confidence": min(1.0, sum(samples) / 96),
    }


def distal_hand_point(points, wrist):
    center = robust_surface_center(points)
    direction = tuple(center[axis] - wrist[axis] for axis in range(3))
    length = math.sqrt(sum(value * value for value in direction))
    unit = tuple(value / length for value in direction)
    projections = [sum((point[axis] - wrist[axis]) * unit[axis] for axis in range(3)) for point in points]
    distance = percentile(projections, 0.9)
    return tuple(wrist[axis] + unit[axis] * distance for axis in range(3))


def foot_tip(points, side, minimum_z, height):
    candidates = [
        point
        for point in points
        if point[0] * side > 0 and point[2] <= minimum_z + height * 0.07
    ]
    forward = percentile([point[1] for point in candidates], 0.05)
    near_forward = [point for point in candidates if point[1] <= forward + height * 0.012]
    return robust_surface_center(near_forward)


def fit_humanoid_landmarks(components):
    all_points = [point for points in components.values() for point in points]
    minimum, maximum = mesh_bounds(all_points)
    height = maximum[2] - minimum[2]
    width = maximum[0] - minimum[0]
    body = components["Body"]
    raw_pairs = {}
    landmarks = {}
    measurements = {}
    for name in ("elbow", "hip", "knee", "ankle"):
        sliced = points_in_height_band(body, minimum[2], height, HUMANOID_V1["heightBands"][name])
        left_cluster = side_outer_cluster(sliced, 1, height)
        right_cluster = side_outer_cluster(sliced, -1, height)
        left = robust_surface_center(left_cluster)
        right = robust_surface_center(right_cluster)
        landmarks[f"{name}.L"], landmarks[f"{name}.R"], raw_pairs[name] = mirror_pair(left, right)
        for side, cluster in (("L", left_cluster), ("R", right_cluster)):
            measurements[f"{name}.{side}"] = {
                "method": "robust_height_slice_outer_cluster",
                "sourceObjects": ["Body"],
                "heightBand": HUMANOID_V1["heightBands"][name],
                "sampleCount": len(cluster),
            }

    raw_left_shoulder, left_shoulder_measurement = proximal_arm_centerline(
        body, 1, minimum[2], height
    )
    raw_right_shoulder, right_shoulder_measurement = proximal_arm_centerline(
        body, -1, minimum[2], height
    )
    landmarks["shoulder.L"], landmarks["shoulder.R"], raw_pairs["shoulder"] = mirror_pair(
        raw_left_shoulder, raw_right_shoulder
    )
    measurements["shoulder.L"] = left_shoulder_measurement
    measurements["shoulder.R"] = right_shoulder_measurement
    measurements["shoulder.L"]["rawTargetWorld"] = raw_left_shoulder
    measurements["shoulder.R"]["rawTargetWorld"] = raw_right_shoulder

    left_wrist = closest_surface_center(body, components["Hand_PositiveX"], minimum[2], height)
    right_wrist = closest_surface_center(body, components["Hand_NegativeX"], minimum[2], height)
    landmarks["wrist.L"], landmarks["wrist.R"], raw_pairs["wrist"] = mirror_pair(left_wrist, right_wrist)
    head_base = closest_surface_center(body, components["Head"], minimum[2], height)
    head_minimum, head_maximum = mesh_bounds(components["Head"])
    landmarks["pelvis"] = tuple(
        (landmarks["hip.L"][axis] + landmarks["hip.R"][axis]) / 2 for axis in range(3)
    )
    landmarks["spine"] = central_slice(body, minimum[2], height, width, HUMANOID_V1["heightBands"]["spine"])
    landmarks["chest"] = central_slice(body, minimum[2], height, width, HUMANOID_V1["heightBands"]["chest"])
    measurements["pelvis"] = {
        "method": "bilateral_hip_midpoint",
        "sourceObjects": ["Body"],
        "sampleCount": measurements["hip.L"]["sampleCount"] + measurements["hip.R"]["sampleCount"],
    }
    for name in ("spine", "chest"):
        central_points = [
            point
            for point in points_in_height_band(body, minimum[2], height, HUMANOID_V1["heightBands"][name])
            if abs(point[0]) <= width * HUMANOID_V1["centralWidthFraction"]
        ]
        measurements[name] = {
            "method": "robust_height_slice_central_cluster",
            "sourceObjects": ["Body"],
            "heightBand": HUMANOID_V1["heightBands"][name],
            "sampleCount": len(central_points),
        }
    landmarks["neck.base"] = central_slice(
        body, minimum[2], height, width, HUMANOID_V1["upperTorsoBand"]
    )
    landmarks["neck"] = head_base
    measurements["neck.base"] = {
        "method": "robust_upper_torso_sternoclavicular_center",
        "sourceObjects": ["Body"],
        "heightBand": HUMANOID_V1["upperTorsoBand"],
        "sampleCount": len([
            point
            for point in points_in_height_band(body, minimum[2], height, HUMANOID_V1["upperTorsoBand"])
            if abs(point[0]) <= width * HUMANOID_V1["centralWidthFraction"]
        ]),
    }
    measurements["neck"] = {
        "method": "closest_component_surface",
        "sourceObjects": ["Body", "Head"],
        "sampleCount": HUMANOID_V1["seamPairCount"],
    }
    landmarks["head"] = (
        (head_minimum[0] + head_maximum[0]) / 2,
        (head_minimum[1] + head_maximum[1]) / 2,
        head_maximum[2] - height * 0.015,
    )
    measurements["head"] = {
        "method": "head_bounds_crown_center",
        "sourceObjects": ["Head"],
        "sampleCount": len(components["Head"]),
    }
    landmarks["hand.L"] = distal_hand_point(components["Hand_PositiveX"], landmarks["wrist.L"])
    landmarks["hand.R"] = distal_hand_point(components["Hand_NegativeX"], landmarks["wrist.R"])
    landmarks["foot.L"] = foot_tip(body, 1, minimum[2], height)
    landmarks["foot.R"] = foot_tip(body, -1, minimum[2], height)
    landmarks["root"] = ((minimum[0] + maximum[0]) / 2, (minimum[1] + maximum[1]) / 2, minimum[2])

    symmetry_tolerance = height * HUMANOID_V1["symmetryToleranceHeight"]
    if max(raw_pairs.values()) > symmetry_tolerance:
        raise ValueError("Raw bilateral landmarks exceed humanoid.v1 symmetry tolerance")
    return {
        "contract": HUMANOID_V1,
        "bounds": {"minimum": minimum, "maximum": maximum, "height": height, "width": width},
        "landmarks": landmarks,
        "measurements": measurements,
        "rawSymmetryErrorMetres": raw_pairs,
        "jointToleranceMetres": height * HUMANOID_V1["jointToleranceHeight"],
        "symmetryToleranceMetres": symmetry_tolerance,
    }
