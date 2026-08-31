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
    for name in ("shoulder", "elbow", "hip", "knee", "ankle"):
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
    shoulder_middle = tuple((landmarks["shoulder.L"][axis] + landmarks["shoulder.R"][axis]) / 2 for axis in range(3))
    landmarks["neck.base"] = shoulder_middle
    landmarks["neck"] = head_base
    measurements["neck.base"] = {
        "method": "bilateral_shoulder_midpoint",
        "sourceObjects": ["Body"],
        "sampleCount": measurements["shoulder.L"]["sampleCount"] + measurements["shoulder.R"]["sampleCount"],
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
