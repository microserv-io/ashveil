import math

from mathutils import Vector


ARM_BONES = {
    "L": ("clavicle.L", "upper_arm.L", "forearm.L", "hand.L"),
    "R": ("clavicle.R", "upper_arm.R", "forearm.R", "hand.R"),
}


def clamp(value, minimum=0.0, maximum=1.0):
    return max(minimum, min(maximum, value))


def smoothstep(edge0, edge1, value):
    t = clamp((value - edge0) / (edge1 - edge0))
    return t * t * (3.0 - 2.0 * t)


def segment_coordinate(point, start, end):
    axis = Vector(end) - Vector(start)
    length_squared = axis.length_squared
    coordinate = (Vector(point) - Vector(start)).dot(axis) / length_squared
    nearest = Vector(start) + axis * clamp(coordinate)
    return coordinate, (Vector(point) - nearest).length


def normalized(weights):
    positive = {name: weight for name, weight in weights.items() if weight > 1e-6}
    total = sum(positive.values())
    return {name: weight / total for name, weight in positive.items()}


def body_arm_profile(point, side, landmarks):
    sign = 1 if side == "L" else -1
    if point.x * sign < 0.14:
        return None
    shoulder = Vector(landmarks[f"shoulder.{side}"])
    elbow = Vector(landmarks[f"elbow.{side}"])
    wrist = Vector(landmarks[f"wrist.{side}"])
    upper_t, upper_radius = segment_coordinate(point, shoulder, elbow)
    fore_t, fore_radius = segment_coordinate(point, elbow, wrist)
    if min(upper_radius, fore_radius) > 0.105:
        return None
    clavicle, upper, forearm, hand = ARM_BONES[side]
    if upper_t <= 0.18:
        upper_weight = smoothstep(-0.22, 0.04, upper_t)
        support = 1.0 - upper_weight
        return normalized({"chest": support * 0.25, clavicle: support * 0.75, upper: upper_weight})
    if upper_t < 0.78:
        return {upper: 1.0}
    if fore_t <= 0.22:
        upper_length = (elbow - shoulder).length
        fore_length = (wrist - elbow).length
        signed_distance = (upper_t - 1.0) * upper_length if upper_t <= 1.0 else fore_t * fore_length
        forearm_weight = smoothstep(-0.045, 0.045, signed_distance)
        return normalized({upper: 1.0 - forearm_weight, forearm: forearm_weight})
    if fore_t < 0.72:
        return {forearm: 1.0}
    hand_weight = smoothstep(0.72, 1.16, fore_t)
    return normalized({forearm: 1.0 - hand_weight, hand: hand_weight})


def hand_profile(point, side, landmarks):
    wrist = Vector(landmarks[f"wrist.{side}"])
    fingertip = Vector(landmarks[f"hand.{side}"])
    coordinate, _ = segment_coordinate(point, wrist, fingertip)
    hand_weight = smoothstep(-0.15, 0.32, coordinate)
    _, _, forearm, hand = ARM_BONES[side]
    return normalized({forearm: 1.0 - hand_weight, hand: hand_weight})


def replace_vertex_weights(obj, vertex_index, weights, deform_names):
    for group in obj.vertex_groups:
        if group.name in deform_names:
            group.remove([vertex_index])
    for name, weight in weights.items():
        group = obj.vertex_groups.get(name) or obj.vertex_groups.new(name=name)
        group.add([vertex_index], weight, "REPLACE")


def apply_geometry_arm_weights(meshes_by_name, armature, landmarks):
    deform_names = {bone.name for bone in armature.data.bones if bone.use_deform}
    records = []
    for object_name, side in (("Hand_PositiveX", "L"), ("Hand_NegativeX", "R")):
        obj = meshes_by_name[object_name]
        for vertex in obj.data.vertices:
            replace_vertex_weights(
                obj,
                vertex.index,
                hand_profile(obj.matrix_world @ vertex.co, side, landmarks),
                deform_names,
            )
        records.append({"object": object_name, "vertices": len(obj.data.vertices), "profile": "wrist_ring"})
    body = meshes_by_name["Body"]
    changed = {"L": 0, "R": 0}
    for vertex in body.data.vertices:
        point = body.matrix_world @ vertex.co
        side = "L" if point.x >= 0 else "R"
        weights = body_arm_profile(point, side, landmarks)
        if weights is None:
            continue
        replace_vertex_weights(body, vertex.index, weights, deform_names)
        changed[side] += 1
    records.extend(
        {"object": "Body", "side": side, "vertices": count, "profile": "shoulder_elbow_wrist_chain"}
        for side, count in changed.items()
    )
    return records


def covariance_volume(points):
    if len(points) < 4:
        return 0.0
    center = sum(points, Vector()) / len(points)
    xx = xy = xz = yy = yz = zz = 0.0
    for point in points:
        delta = point - center
        xx += delta.x * delta.x
        xy += delta.x * delta.y
        xz += delta.x * delta.z
        yy += delta.y * delta.y
        yz += delta.y * delta.z
        zz += delta.z * delta.z
    scale = 1.0 / len(points)
    xx, xy, xz, yy, yz, zz = (value * scale for value in (xx, xy, xz, yy, yz, zz))
    determinant = xx * (yy * zz - yz * yz) - xy * (xy * zz - yz * xz) + xz * (xy * yz - yy * xz)
    return math.sqrt(max(0.0, determinant))


def percentile(values, fraction):
    ordered = sorted(values)
    position = (len(ordered) - 1) * fraction
    lower = math.floor(position)
    upper = math.ceil(position)
    if lower == upper:
        return ordered[lower]
    return ordered[lower] * (upper - position) + ordered[upper] * (position - lower)


def triangle_area(first, second, third):
    return (Vector(second) - Vector(first)).cross(Vector(third) - Vector(first)).length * 0.5


def region_indices(obj, center, radius):
    center = Vector(center)
    return [
        vertex.index
        for vertex in obj.data.vertices
        if (obj.matrix_world @ vertex.co - center).length <= radius
    ]


def region_triangles(obj, indices):
    selected = set(indices)
    obj.data.calc_loop_triangles()
    return [
        tuple(vertex for vertex in triangle.vertices)
        for triangle in obj.data.loop_triangles
        if all(vertex in selected for vertex in triangle.vertices)
    ]


def freeze_arm_regions(body, landmarks):
    definitions = []
    for side in ("L", "R"):
        for joint, radius in (("shoulder", 0.115), ("elbow", 0.085), ("wrist", 0.065)):
            indices = region_indices(body, landmarks[f"{joint}.{side}"], radius)
            triangles = region_triangles(body, indices)
            if len(indices) < 12 or len(triangles) < 4:
                raise RuntimeError(f"{joint}.{side} deformation region is under-sampled")
            definitions.append(
                {"name": f"{joint}.{side}", "object": body.name, "vertexIndices": indices, "triangles": triangles}
            )
    return definitions


def measure_region(region, bind_points, posed_points):
    indices = region["vertexIndices"]
    bind_subset = [bind_points[index] for index in indices]
    posed_subset = [posed_points[index] for index in indices]
    bind_volume = covariance_volume(bind_subset)
    posed_volume = covariance_volume(posed_subset)
    bind_center = sum(bind_subset, Vector()) / len(bind_subset)
    posed_center = sum(posed_subset, Vector()) / len(posed_subset)
    ratios = []
    inversions = 0
    for first, second, third in region["triangles"]:
        bind_area = triangle_area(bind_points[first], bind_points[second], bind_points[third])
        posed_area = triangle_area(posed_points[first], posed_points[second], posed_points[third])
        if bind_area <= 1e-12:
            continue
        ratios.append(posed_area / bind_area)
        bind_normal = (bind_points[second] - bind_points[first]).cross(bind_points[third] - bind_points[first])
        posed_normal = (posed_points[second] - posed_points[first]).cross(posed_points[third] - posed_points[first])
        bind_triangle_center = (bind_points[first] + bind_points[second] + bind_points[third]) / 3
        posed_triangle_center = (posed_points[first] + posed_points[second] + posed_points[third]) / 3
        bind_orientation = bind_normal.dot(bind_triangle_center - bind_center)
        posed_orientation = posed_normal.dot(posed_triangle_center - posed_center)
        if bind_orientation * posed_orientation < 0:
            inversions += 1
    return {
        "name": region["name"],
        "object": region["object"],
        "vertexIndices": indices,
        "triangleCount": len(ratios),
        "covarianceVolumeRatio": posed_volume / bind_volume if bind_volume > 1e-12 else 0.0,
        "triangleAreaRatioP05": percentile(ratios, 0.05),
        "minimumTriangleAreaRatio": min(ratios),
        "signedNormalInversions": inversions,
    }
