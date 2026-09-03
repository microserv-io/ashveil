"""Hanging cloth: the part of a piece that swings instead of following a limb.

A sash below a belt band, the cloth under a pauldron, everything below a cape's
yoke - none of it is skin over a bone, and weighting it to one makes it a plate.
So the band below the `to` line gets its own short chain of bones hanging from the
body bone it is attached to, skinned as a rope, and the runtime swings that chain
as a damped pendulum driven by the body's own motion.

The chain is the fitter's whole contribution: rest position, rest orientation and
the direction a swing would carry the cloth into the body. Everything the cloth
then does is `src/render/drape.ts`, in sim time.
"""

from __future__ import annotations

import math
import re

import bpy
import numpy as np
from mathutils import Vector

from fit.frame import blender_from_runtime, rounded, runtime_from_blender
from fit.glb import Glb

# How tall the ring below the `to` line is: the vertices whose centroid is the root.
RING_METRES = 0.015
# Where the chain's hold fades into the body weights, so the root does not tear.
FADE_METRES = 0.03
MAX_INFLUENCES = 4
DEFAULT_SEGMENTS = 2
MAX_SEGMENTS = 6
PREFIX = "drape_"
NAME = re.compile(r"^[a-z][a-z0-9_]*$")
# A drape hangs. Further off vertical than this the band is not the cloth it names.
MAX_TILT_DEGREES = 60.0
# How far off the body a chain may be hung at rest, before it is a wing rather than cloth.
MAX_REST_DEGREES = 45.0
MAX_SUPPORTS_PER_SEGMENT = 24
MAX_SUPPORT_TERMS = 12

# A small body-specific envelope is fitted from these semantic spans. The names are
# portable family joints; the positions and radii written to a manifest are measured
# from the fitted body rather than being runtime constants.
COLLIDER_SPANS = (
    ("pelvis", "chest", ("pelvis", "spine")),
    ("chest", "neck", ("chest", "clavicle_L", "clavicle_R")),
    ("clavicle_L", "upper_arm_L", ("clavicle_L", "shoulder_helper_L")),
    ("clavicle_R", "upper_arm_R", ("clavicle_R", "shoulder_helper_R")),
    ("upper_arm_L", "forearm_L", ("upper_arm_L", "shoulder_helper_L", "twist_upper_arm_L")),
    ("upper_arm_R", "forearm_R", ("upper_arm_R", "shoulder_helper_R", "twist_upper_arm_R")),
    ("thigh_L", "shin_L", ("thigh_L",)),
    ("thigh_R", "shin_R", ("thigh_R",)),
    ("shin_L", "foot_L", ("shin_L",)),
    ("shin_R", "foot_R", ("shin_R",)),
)


class DrapeError(RuntimeError):
    pass


def parse(spec: str) -> dict:
    """`name:attachBone:from:to[:segments[:restDegrees]]`, fractions of the island's Y."""
    parts = spec.split(":")
    if len(parts) not in (4, 5, 6):
        raise DrapeError(f"drape gate: \"{spec}\" is not name:bone:from:to[:segments[:restDegrees]]")
    name, bone = parts[0], parts[1]
    if not NAME.match(name):
        raise DrapeError(f"drape gate: \"{name}\" is not a lowercase drape name")
    try:
        low, high = float(parts[2]), float(parts[3])
        segments = int(parts[4]) if len(parts) > 4 else DEFAULT_SEGMENTS
        rest = float(parts[5]) if len(parts) > 5 else 0.0
    except ValueError as error:
        raise DrapeError(f"drape gate: \"{spec}\" has a number that is not one: {error}") from error
    if not 0.0 <= low < high <= 1.0:
        raise DrapeError(f"drape gate: {name} wants 0 <= from < to <= 1, not {low} and {high}")
    if not 1 <= segments <= MAX_SEGMENTS:
        raise DrapeError(f"drape gate: {name} wants 1 to {MAX_SEGMENTS} segments, not {segments}")
    if not 0.0 <= rest <= MAX_REST_DEGREES:
        raise DrapeError(f"drape gate: {name} wants a rest tilt of 0 to {MAX_REST_DEGREES} "
                         f"degrees, not {rest}")
    return {"name": name, "attachBone": bone, "from": low, "to": high, "segments": segments,
            "restDegrees": rest}


def sided(spec: dict, side: str | None) -> dict:
    """A pair's drape is declared once, for the left island, and mirrored by name."""
    if side is None:
        return dict(spec)
    bone = spec["attachBone"]
    if side == "R":
        if not bone.endswith("_L"):
            raise DrapeError(f"drape gate: {bone} has no side to swap for the right island")
        bone = f"{bone[:-2]}_R"
    return dict(spec) | {"name": f"{spec['name']}_{side}", "attachBone": bone}


def bones(spec: dict) -> list[str]:
    return [f"{PREFIX}{spec['name']}_{at + 1}" for at in range(spec["segments"])]


def _ring(points: np.ndarray, band: np.ndarray) -> np.ndarray:
    """The band's own top ring: the highest 1.5cm of it, whether or not that reaches
    the `to` line, because a coarse sheet can have no row within a window of it."""
    return band & (points[:, 1] >= float(points[band][:, 1].max()) - RING_METRES)


def _chain(points: np.ndarray, band: np.ndarray, root: np.ndarray,
           name: str) -> tuple[np.ndarray, float]:
    """Where the cloth hangs: root to the band's own bottom, and how far that is.

    The direction is the bottom ring's centroid rather than the band's principal
    axis, which for a drape wider than it is tall points across the cloth instead
    of down it.
    """
    inside = points[band]
    bottom = inside[inside[:, 1] <= inside[:, 1].min() + RING_METRES].mean(axis=0)
    axis = bottom - root
    length = float(np.linalg.norm(axis))
    if length < RING_METRES:
        raise DrapeError(f"drape gate: {name} is {length:.4f}m from its root to its bottom")
    axis = axis / length
    tilt = math.degrees(math.acos(min(1.0, max(-1.0, float(-axis[1])))))
    if tilt > MAX_TILT_DEGREES:
        raise DrapeError(f"drape gate: {name} hangs {tilt:.1f} degrees off vertical, "
                         "so the band is not cloth hanging from the \"to\" line")
    reach = float(((inside - root) @ axis).max())
    return axis, max(reach, length)


def _turned(points: np.ndarray, hinge: np.ndarray, pivot: np.ndarray, angle) -> np.ndarray:
    """Rodrigues about a line through `pivot`, per point, for the rest tilt of a chain."""
    relative = points - pivot
    cosine, sine = np.cos(angle), np.sin(angle)
    if np.ndim(cosine):
        cosine, sine = cosine[:, None], sine[:, None]
    return (pivot + relative * cosine + np.cross(hinge, relative) * sine
            + np.outer(relative @ hinge, hinge) * (1.0 - cosine))


def _bone_head(armature, name: str) -> np.ndarray:
    """Where the bone a drape hangs on sits, in the runtime frame."""
    bone = armature.data.bones.get(name)
    if bone is None:
        raise DrapeError(f"drape gate: the body has no bone \"{name}\" to hang from")
    return np.array(runtime_from_blender(armature.matrix_world @ bone.head_local), dtype=np.float64)


def _add_bones(armature, spec: dict, names: list[str], root: np.ndarray, axis: np.ndarray,
               segment: float) -> None:
    if spec["attachBone"] not in armature.data.bones:
        raise DrapeError(f"drape gate: the body has no bone \"{spec['attachBone']}\" to hang from")
    into = armature.matrix_world.inverted()
    bpy.context.view_layer.objects.active = armature
    armature.hide_set(False)
    bpy.ops.object.mode_set(mode="EDIT")
    try:
        above = armature.data.edit_bones[spec["attachBone"]]
        for at, name in enumerate(names):
            if name in armature.data.edit_bones:
                raise DrapeError(f"drape gate: bone \"{name}\" is already on the armature")
            bone = armature.data.edit_bones.new(name)
            head = root + axis * segment * at
            bone.head = into @ Vector(blender_from_runtime(head))
            bone.tail = into @ Vector(blender_from_runtime(head + axis * segment))
            bone.parent = above
            bone.use_connect = False
            bone.use_deform = True
            above = bone
    finally:
        bpy.ops.object.mode_set(mode="OBJECT")


def _hold(share: float, at: float, segments: int, names: list[str]) -> dict[str, float]:
    """A rope: the vertex hangs between the two joints it lies between, linearly."""
    lower = min(int(math.floor(at)), segments - 1)
    if lower >= segments - 1:
        return {names[-1]: share}
    across = at - lower
    return {names[lower]: share * (1.0 - across), names[lower + 1]: share * across}


def _weigh(obj, names: list[str], band: np.ndarray, points: np.ndarray, root: np.ndarray,
           axis: np.ndarray, segment: float, line: float, segments: int) -> dict:
    groups = {name: obj.vertex_groups.get(name) or obj.vertex_groups.new(name=name)
              for name in names}
    named = {group.index: group.name for group in obj.vertex_groups}
    counted = {"bandVertices": 0, "fadeVertices": 0}
    for vertex, point, inside in zip(obj.data.vertices, points, band):
        if not inside:
            continue
        held = min(1.0, max(0.0, (line - float(point[1])) / FADE_METRES))
        share = held * held * (3.0 - 2.0 * held)
        if share <= 0.0:
            continue
        counted["bandVertices"] += 1
        counted["fadeVertices"] += int(share < 1.0)
        along = float(np.clip((point - root) @ axis, 0.0, segment * segments))
        chain = _hold(share, along / segment, segments, names)
        body = {named[element.group]: element.weight * (1.0 - share)
                for element in vertex.groups if named[element.group] not in groups}
        for name, weight in body.items():
            if weight <= 1e-6:
                obj.vertex_groups[name].remove([vertex.index])
            else:
                obj.vertex_groups[name].add([vertex.index], weight, "REPLACE")
        for name, weight in chain.items():
            groups[name].add([vertex.index], weight, "REPLACE")
    return counted


def _terms(obj, vertices, barycentric: tuple[float, ...]) -> list[dict]:
    """Exact linear-blend terms for a point sampled on a rendered triangle."""
    groups = {group.index: group.name for group in obj.vertex_groups}
    terms = []
    for vertex, share in zip(vertices, barycentric):
        if share <= 0.0:
            continue
        position = runtime_from_blender(obj.matrix_world @ vertex.co)
        for influence in sorted(vertex.groups, key=lambda entry: groups.get(entry.group, "")):
            weight = float(influence.weight) * share
            if weight <= 1e-7:
                continue
            terms.append({"joint": groups[influence.group], "weight": weight,
                          "position": np.asarray(position, dtype=np.float64)})
    if len(terms) > MAX_SUPPORT_TERMS:
        raise DrapeError(f"drape gate: a surface support needs {len(terms)} skin terms, "
                         f"the contract allows {MAX_SUPPORT_TERMS}")
    total = sum(term["weight"] for term in terms)
    return [{"joint": term["joint"], "weight": round(term["weight"] / total, 7),
             "position": rounded(term["position"])} for term in terms]


def _support_point(terms: list[dict]) -> np.ndarray:
    return sum((np.asarray(term["position"], dtype=np.float64) * term["weight"] for term in terms),
               np.zeros(3, dtype=np.float64))


def _reduce_supports(candidates: list[dict], limit: int) -> list[dict]:
    """Stable farthest-point reduction keeps the whole surface envelope represented."""
    ordered = sorted(candidates, key=lambda item: (tuple(item["point"]), tuple(
        (term["joint"], tuple(term["position"]), term["weight"]) for term in item["terms"])))
    unique = []
    seen = set()
    for item in ordered:
        key = (tuple(item["point"]), tuple(
            (term["joint"], tuple(term["position"]), term["weight"]) for term in item["terms"]))
        if key in seen:
            continue
        seen.add(key)
        unique.append(item)
    ordered = unique
    if len(ordered) <= limit:
        return ordered
    points = np.asarray([item["point"] for item in ordered], dtype=np.float64)
    chosen = [0]
    distance = np.sum((points - points[0]) ** 2, axis=1)
    while len(chosen) < limit:
        at = int(np.argmax(distance))
        chosen.append(at)
        distance = np.minimum(distance, np.sum((points - points[at]) ** 2, axis=1))
    return [ordered[at] for at in sorted(chosen)]


def surface_supports(obj, names: list[str], body_samples: dict) -> list[dict]:
    """Vertices, edge midpoints and centroid samples for every draped triangle."""
    group_index = {group.name: group.index for group in obj.vertex_groups}
    chain = {group_index[name]: at for at, name in enumerate(names)}
    barycentrics = ((1.0, 0.0, 0.0), (0.0, 1.0, 0.0), (0.0, 0.0, 1.0),
                    (0.5, 0.5, 0.0), (0.0, 0.5, 0.5), (0.5, 0.0, 0.5),
                    (1.0 / 3.0, 1.0 / 3.0, 1.0 / 3.0))
    per_segment = [[] for _ in names]
    for polygon in sorted(obj.data.polygons, key=lambda entry: entry.index):
        if len(polygon.vertices) != 3:
            continue
        vertices = [obj.data.vertices[index] for index in polygon.vertices]
        if not any(entry.group in chain for vertex in vertices for entry in vertex.groups):
            continue
        for barycentric in barycentrics:
            terms = _terms(obj, vertices, barycentric)
            influence = np.zeros(len(names), dtype=np.float64)
            for term in terms:
                if term["joint"] in names:
                    influence[names.index(term["joint"])] += term["weight"]
            if float(influence.sum()) <= 1e-7:
                continue
            segment = int(np.argmax(influence))
            point = rounded(_support_point(terms))
            per_segment[segment].append({"point": point, "terms": terms})
    supports = []
    for segment, candidates in enumerate(per_segment):
        for support in _reduce_supports(candidates, MAX_SUPPORTS_PER_SEGMENT):
            point = np.asarray(support["point"], dtype=np.float64)
            distances = np.sum((body_samples["points"] - point) ** 2, axis=1)
            nearest = int(np.argmin(distances))
            separation = float(math.sqrt(distances[nearest]))
            normal = point - body_samples["points"][nearest]
            normal /= max(separation, 1e-9)
            supports.append({"segment": segment, "terms": support["terms"],
                             "bodyTerms": body_samples["terms"][nearest],
                             "normal": rounded(normal),
                             "clearance": round(separation, 6)})
    return supports


def body_anchors(meshes) -> dict:
    """Every fitted-body vertex as exact LBS terms, for nearest surface anchors."""
    points, terms = [], []
    for obj in sorted(meshes, key=lambda entry: entry.name):
        groups = {group.index: group.name for group in obj.vertex_groups}
        for vertex in obj.data.vertices:
            position = np.asarray(runtime_from_blender(obj.matrix_world @ vertex.co), dtype=np.float64)
            influences = sorted(vertex.groups, key=lambda entry: groups.get(entry.group, ""))
            total = sum(float(entry.weight) for entry in influences)
            points.append(position)
            terms.append([{"joint": groups[entry.group], "weight": round(float(entry.weight) / total, 7),
                           "position": rounded(position)} for entry in influences if entry.weight > 1e-7])
    return {"points": np.asarray(points, dtype=np.float64), "terms": terms}


def collider_proxies(meshes, armature) -> list[dict]:
    """Measure a conservative capsule radius from skin owned by each body span."""
    points_by_bone: dict[str, list[np.ndarray]] = {}
    for obj in sorted(meshes, key=lambda entry: entry.name):
        groups = {group.index: group.name for group in obj.vertex_groups}
        for vertex in obj.data.vertices:
            point = np.asarray(runtime_from_blender(obj.matrix_world @ vertex.co), dtype=np.float64)
            for influence in vertex.groups:
                if influence.weight >= 0.2:
                    points_by_bone.setdefault(groups[influence.group], []).append(point)

    proxies = []
    for start_name, end_name, owners in COLLIDER_SPANS:
        if start_name not in armature.data.bones or end_name not in armature.data.bones:
            continue
        start = _bone_head(armature, start_name)
        end = _bone_head(armature, end_name)
        axis = end - start
        span = float(axis @ axis)
        owned = [point for owner in owners for point in points_by_bone.get(owner, [])]
        if not owned or span <= 1e-9:
            continue
        cloud = np.asarray(owned, dtype=np.float64)
        along = np.clip(((cloud - start) @ axis) / span, 0.0, 1.0)
        radial = np.linalg.norm(cloud - (start + np.outer(along, axis)), axis=1)
        # A percentile ignores isolated seam/weight outliers while still enclosing the
        # body region that the rendered garment can visibly meet.
        radius = float(np.quantile(radial, 0.95))
        proxies.append({"from": start_name, "to": end_name, "radius": round(radius, 6)})
    return proxies


def build(obj, spec: dict, armature, surface) -> tuple[dict, dict]:
    """One drape on one island: its chain, its weights, and what the manifest carries."""
    points = np.array([runtime_from_blender(obj.matrix_world @ vertex.co)
                       for vertex in obj.data.vertices], dtype=np.float64)
    low, high = float(points[:, 1].min()), float(points[:, 1].max())
    extent = high - low
    if extent <= 1e-6:
        raise DrapeError(f"drape gate: {spec['name']} sits on an island with no height")
    line = low + spec["to"] * extent
    band = (points[:, 1] <= line) & (points[:, 1] >= low + spec["from"] * extent)
    if int(band.sum()) < 8:
        raise DrapeError(f"drape gate: {spec['name']} holds {int(band.sum())} vertices, "
                         "which is not a band of cloth")
    root = points[_ring(points, band)].mean(axis=0)
    axis, length = _chain(points, band, root, spec["name"])

    # Which way a swing carries the cloth into the skin: from the cloth to the bone it
    # hangs on. The nearest skin point says the same for a sash beside a hip, and says
    # nothing for a cape, whose band encircles the body and whose root is inside it.
    centre = points[band].mean(axis=0)
    toward = _bone_head(armature, spec["attachBone"]) - centre
    toward[1] = 0.0
    reach = float(np.linalg.norm(toward))
    if reach < 1e-6:
        raise DrapeError(f"drape gate: {spec['name']} hangs on the axis of "
                         f"{spec['attachBone']}, so no swing of it can reach the body")
    skin = surface.nearest(root) - root
    skin[1] = 0.0

    # Cloth at rest hangs a little off the body it is worn on: a cape that hangs plumb
    # sits on the seat and a sash on the thigh, and no motion is needed to see it. The
    # chain is hung that far away from `toward`, and the band is turned with it about
    # the root - by the whole angle at the hem and by none of it at the top, because a
    # band that rings the body has sides off the hinge, and turning those rigidly lifts
    # them into the shoulders it hangs from. The hem lands where the chain's tip does
    # either way; only the cloth between them is left where the fit put it.
    tilt = math.radians(float(spec["restDegrees"]))
    if tilt > 0.0:
        hinge = np.cross(np.array([0.0, 1.0, 0.0]), toward / reach)
        hinge = hinge / np.linalg.norm(hinge)
        along = np.clip((points[band] - root) @ axis / length, 0.0, 1.0)
        points[band] = _turned(points[band], hinge, root, tilt * along)
        axis = _turned(np.array([axis]), hinge, np.zeros(3), tilt)[0]
        inverse = obj.matrix_world.inverted()
        for vertex, point, inside in zip(obj.data.vertices, points, band):
            if inside:
                vertex.co = inverse @ Vector(blender_from_runtime(point))
        obj.data.update()

    names = bones(spec)
    segment = length / spec["segments"]
    _add_bones(armature, spec, names, root, axis, segment)
    counted = _weigh(obj, names, band, points, root, axis, segment, line, spec["segments"])
    block = {
        "name": spec["name"],
        "attachBone": spec["attachBone"],
        "bones": names,
        "segmentLength": round(segment, 6),
        "restDegrees": float(spec["restDegrees"]),
        "root": rounded(root),
        "toward": rounded(toward / reach),
    }
    report = dict(block) | {
        "island": obj.name,
        "from": spec["from"],
        "to": spec["to"],
        "segments": spec["segments"],
        "islandHeightMetres": round(extent, 6),
        "restTiltMetresAtTheHem": round(length * math.sin(tilt), 6),
        "toLineY": round(line, 6),
        "chainLengthMetres": round(length, 6),
        "axis": rounded(axis),
        "towardMetres": round(reach, 6),
        "bandCentre": rounded(centre),
        # The rule this replaced, kept as a diagnostic: where the nearest skin is.
        "nearestSkinMetres": round(float(np.linalg.norm(skin)), 6),
        "nearestSkin": rounded(skin / max(float(np.linalg.norm(skin)), 1e-9)),
    } | counted
    return block, report


def order_joints(path: str, body_bones: list[str], declared: list[str]) -> list[str]:
    """Body joints first, in the body's order, then the drape bones as declared.

    The exporter writes the armature's own hierarchy order, which puts a bone hanging
    off the pelvis in the middle of the body's list; the runtime binds the piece to the
    body's skeleton by index, so the body's order is the contract and the extras are
    appended to it.
    """
    glb = Glb(path)
    skin = glb.json["skins"][0]
    names = [glb.json["nodes"][node].get("name") for node in skin["joints"]]
    order = list(body_bones) + list(declared)
    if sorted(order) != sorted(names):
        missing = sorted(set(order) - set(names))
        extra = sorted(set(names) - set(order))
        raise DrapeError(f"drape gate: the exported skin is not the body plus the drapes "
                         f"(missing {missing}, unexpected {extra})")
    index = {name: at for at, name in enumerate(names)}
    permutation = [index[name] for name in order]
    skin["joints"] = [skin["joints"][at] for at in permutation]
    glb.write_accessor(skin["inverseBindMatrices"],
                       glb.accessor(skin["inverseBindMatrices"])[permutation])
    moved = np.zeros(len(permutation), dtype=np.int64)
    moved[permutation] = np.arange(len(permutation))
    rewritten: set[int] = set()
    for mesh in glb.json["meshes"]:
        for primitive in mesh["primitives"]:
            for attribute, accessor in primitive["attributes"].items():
                if attribute.startswith("JOINTS_") and accessor not in rewritten:
                    glb.write_accessor(accessor, moved[glb.accessor(accessor)])
                    rewritten.add(accessor)
    glb.write(path)
    return order


def tidy(obj) -> None:
    """Four influences and a normalised sum, once the chain has taken its share."""
    bpy.ops.object.select_all(action="DESELECT")
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    bpy.ops.object.vertex_group_limit_total(group_select_mode="ALL", limit=MAX_INFLUENCES)
    bpy.ops.object.vertex_group_normalize_all(group_select_mode="ALL", lock_active=False)
