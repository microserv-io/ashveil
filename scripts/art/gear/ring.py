"""Ring placement: a loop around a bone has exactly one correct place on a body.

A belt strap, a collar or a cuff closes a loop about the vertical axis, and the
body's cross section at that height plus a clearance says where the loop goes.
Nothing here reshapes the piece to place it: the strap's own inner ellipse is
measured, the body's outer ellipse at the same height too, and the whole piece - buckle,
pouches, sash, rivets - is moved by one rigid transform with a scale per horizontal
axis. Then one Shrinkwrap pushes the strap back out of the body, and a Corrective
Smooth tidies only what moved.

Only the strap is ever reshaped. The body has an opinion about a band of leather
lying on it and none at all about the buckle bolted through it, so every other
island is translated by what the seat did to the strap under it and keeps its own
shape to the millimetre.

Every island and every triangle the source had survives to the runtime file. The
2% debris rule that ate the belt's buckle, the alignment search, the tube fit and
the hug bands are all absent on purpose; this is the whole rule.
"""

from __future__ import annotations

import argparse
import json
import math
import sys
import traceback
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import bpy  # noqa: E402
import numpy as np  # noqa: E402
from mathutils import Matrix, Vector  # noqa: E402
from mathutils.bvhtree import BVHTree  # noqa: E402
from mathutils.kdtree import KDTree  # noqa: E402

from fit import export as exporter  # noqa: E402
from fit.frame import blender_from_runtime, runtime_from_blender  # noqa: E402
from fit.glb import Glb  # noqa: E402
from fit import normalise  # noqa: E402
from gear import body, gate, piece, weights  # noqa: E402

ROOT = Path(__file__).resolve().parents[3]
CONTRACT_PATH = ROOT / "scripts" / "art" / "contracts" / "humanoid.v1.json"

AZIMUTH_BINS = 36
# What the strap holds off the body's own surface before the seat runs.
RING_CLEARANCE = 0.003
SHRINKWRAP_OFFSET = 0.003
# A vertex the seat did not touch is not "moved"; float noise is not movement.
MOVE_EPSILON = 1e-6
# Below this the seat found nothing to fix and a smooth would only blur the source.
SMOOTH_FLOOR = 0.01
SMOOTH_FACTOR = 0.5
SMOOTH_ITERATIONS = 5
# How far off the body's own waist band a surface vertex may be and still be torso:
# the arms hang at waist height and their radius would otherwise set the ellipse.
TORSO_REACH = 0.08
# What fraction of the azimuth bins an island must reach to count as closing a loop.
LOOP_COVERAGE = 0.9
# How far out an island's nearest vertex must stay, against its own outer radius,
# before it is a ring rather than a lump: a pouch has no hole, a strap is all hole.
LOOP_HOLE = 0.5
# Three axis casts and a majority vote, because a nearest-point sign test reads the
# wrong side in every concavity.
RAY_DIRECTIONS = ((1.0, 0.0, 0.0), (0.0, 1.0, 0.0), (0.0, 0.0, 1.0))
RAY_HIT_LIMIT = 64
RAY_NUDGE = 1e-5
# How close an island has to sit to the strap to count as welded to that leather.
ATTACH_RADIUS = 0.02
ISLAND_GROUP = "ring_island"
STRAP_GROUP = "ring_strap"


class RingError(RuntimeError):
    pass


def points_of(obj) -> np.ndarray:
    """One object's vertices in the runtime frame: +Y up, +Z forward, +X left."""
    matrix = obj.matrix_world
    return np.array([runtime_from_blender(matrix @ vertex.co) for vertex in obj.data.vertices],
                    dtype=np.float64)


def triangles_of(obj) -> int:
    return sum(max(0, len(face.vertices) - 2) for face in obj.data.polygons)


def azimuth(points: np.ndarray, centre: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """Where each point sits around the ring, and how far out: the loop in polar form."""
    dx = points[:, 0] - centre[0]
    dz = points[:, 2] - centre[1]
    return np.arctan2(dz, dx), np.hypot(dx, dz)


def bin_index(angles: np.ndarray, bins: int) -> np.ndarray:
    return np.minimum(((angles + math.pi) / (2.0 * math.pi) * bins).astype(int), bins - 1)


def bin_extremes(points: np.ndarray, centre: np.ndarray, bins: int) -> tuple[np.ndarray, np.ndarray]:
    """Per azimuth bin, the nearest and furthest radius, or NaN where nothing landed."""
    angles, radius = azimuth(points, centre)
    which = bin_index(angles, bins)
    inner = np.full(bins, np.nan)
    outer = np.full(bins, np.nan)
    for slot in range(bins):
        picked = radius[which == slot]
        if picked.size:
            inner[slot] = picked.min()
            outer[slot] = picked.max()
    return inner, outer


def bin_angles(bins: int) -> np.ndarray:
    """The middle of each bin, which is the angle its radius was measured at."""
    return -math.pi + (np.arange(bins) + 0.5) * (2.0 * math.pi / bins)


def ring_centre(points: np.ndarray, bins: int, passes: int = 8,
                outer: bool = False) -> tuple[np.ndarray, np.ndarray]:
    """The centre of the loop, which the vertex mean is not.

    Tripo spends its triangles where the detail is, so the mean of a belt's
    vertices sits wherever the buckle is. One point per azimuth bin is spread
    evenly around the loop whatever the density, so the mean of those is a centre;
    re-binning about it and repeating converges in a handful of passes.

    A body's cross section needs the same treatment for the opposite reason: a
    belly is not centred on the pelvis, so an ellipse centred on the region's
    centroid stands off the front by exactly what it cuts into the back.
    """
    centre = np.array([points[:, 0].mean(), points[:, 2].mean()])
    start = centre.copy()
    for _ in range(passes):
        angles, radius = azimuth(points, centre)
        which = bin_index(angles, bins)
        picked = []
        for slot in range(bins):
            members = np.flatnonzero(which == slot)
            if members.size:
                at = np.argmax(radius[members]) if outer else np.argmin(radius[members])
                picked.append(points[members[at]])
        if len(picked) < 3:
            break
        picked = np.array(picked)
        moved = np.array([picked[:, 0].mean(), picked[:, 2].mean()])
        if np.linalg.norm(moved - centre) < 1e-6:
            centre = moved
            break
        centre = moved
    return centre, start


def fit_ellipse(angles: np.ndarray, radii: np.ndarray) -> tuple[float, float]:
    """Semi-axes a (lateral) and b (forward) from radii sampled around the loop.

    An axis-aligned ellipse satisfies 1/r^2 = cos^2(t)/a^2 + sin^2(t)/b^2, which is
    linear in 1/a^2 and 1/b^2, so this is one least-squares solve and no search.
    """
    usable = np.isfinite(radii) & (radii > 1e-9)
    if usable.sum() < 4:
        raise RingError(f"ring gate: only {int(usable.sum())} azimuth bins carry a radius")
    t = angles[usable]
    r = radii[usable]
    design = np.stack([np.cos(t) ** 2, np.sin(t) ** 2], axis=1)
    solution, *_ = np.linalg.lstsq(design, 1.0 / (r ** 2), rcond=None)
    if np.any(solution <= 0.0):
        raise RingError(f"ring gate: the radii do not fit an ellipse ({solution.tolist()})")
    return float(1.0 / math.sqrt(solution[0])), float(1.0 / math.sqrt(solution[1]))


def bounding_semi_axes(points: np.ndarray, centre: np.ndarray) -> tuple[float, float]:
    """The fallback the time box names: half the strap's own bounding box."""
    return (float((points[:, 0].max() - points[:, 0].min()) * 0.5),
            float((points[:, 2].max() - points[:, 2].min()) * 0.5))


def loop_measure(points: np.ndarray, centre: np.ndarray, bins: int) -> tuple[int, float]:
    """How much of the ring an island covers, and how big a hole it leaves.

    Azimuth coverage alone says nothing: every blob covers all 36 bins about its own
    centroid. A loop is the shape whose nearest vertex in every direction is still
    well out from the centre, so the hole is what tells a strap from a pouch.
    """
    inner, outer = bin_extremes(points, centre, bins)
    covered = int(np.isfinite(inner).sum())
    if covered == 0:
        return 0, 0.0
    return covered, float(np.nanmin(inner) / max(float(np.nanmedian(outer)), 1e-9))


def strap_island(islands: list, bins: int) -> tuple[object, dict]:
    """The strap is the largest island that closes a loop, not merely the largest.

    On the shipped belt the largest island is the sash: decimation spent the budget
    on the hanging cloth and the strap came second. A loop is what the ring rule
    places, so a loop is what it looks for, and the report says when the two differ.
    """
    ranked = sorted(islands, key=triangles_of, reverse=True)
    measured = []
    for obj in ranked:
        points = points_of(obj)
        centre, _ = ring_centre(points, bins)
        measured.append((obj, *loop_measure(points, centre, bins)))
    closed = [entry for entry in measured
              if entry[1] >= bins * LOOP_COVERAGE and entry[2] >= LOOP_HOLE]
    chosen, covered, hole = closed[0] if closed else measured[0]
    return chosen, {"closed": bool(closed), "binsCovered": covered, "bins": bins,
                    "holeRatio": round(hole, 4), "holeFloor": LOOP_HOLE,
                    "largestIslandIsTheStrap": chosen is ranked[0],
                    "islandCoverage": [{"triangles": triangles_of(obj), "binsCovered": count,
                                        "holeRatio": round(ratio, 4)}
                                       for obj, count, ratio in measured[:8]]}


def inner_face(points: np.ndarray, centre: np.ndarray, bins: int) -> np.ndarray:
    """The half of the strap shell that faces the body, as a boolean mask.

    Per azimuth bin the strap spans a near radius and a far one; anything inside the
    midpoint is the face that has to touch, and it is what a contact measurement is
    allowed to look at. The outer face of a 2 cm strap is 2 cm off the body by
    construction and says nothing about whether the belt is on.
    """
    angles, radius = azimuth(points, centre)
    which = bin_index(angles, bins)
    chosen = np.zeros(len(points), dtype=bool)
    for slot in range(bins):
        members = np.flatnonzero(which == slot)
        if members.size == 0:
            continue
        near, far = radius[members].min(), radius[members].max()
        chosen[members[radius[members] <= (near + far) * 0.5]] = True
    return chosen


class Solid:
    """A closed surface as a distance and an inside test."""

    def __init__(self, objects: list) -> None:
        vertices: list[tuple[float, float, float]] = []
        faces: list[tuple[int, int, int]] = []
        for obj in objects:
            base = len(vertices)
            matrix = obj.matrix_world
            vertices.extend(tuple(matrix @ vertex.co) for vertex in obj.data.vertices)
            for face in obj.data.polygons:
                corners = list(face.vertices)
                for at in range(1, len(corners) - 1):
                    faces.append((base + corners[0], base + corners[at], base + corners[at + 1]))
        if not faces:
            raise RingError("surface gate: nothing to measure against")
        self.tree = BVHTree.FromPolygons(vertices, faces, all_triangles=True)

    def distance(self, point) -> float:
        found = self.tree.find_nearest(Vector(point))
        return float("inf") if found[0] is None else float(found[3])

    def _crossings(self, origin: Vector, direction: Vector) -> int:
        crossings = 0
        at = origin.copy()
        while crossings <= RAY_HIT_LIMIT:
            hit, _, _, _ = self.tree.ray_cast(at, direction)
            if hit is None:
                return crossings
            crossings += 1
            at = hit + direction * RAY_NUDGE
        return crossings

    def inside(self, point) -> bool:
        origin = Vector(point)
        votes = 0
        for axis in RAY_DIRECTIONS:
            direction = Vector(axis)
            votes += int((self._crossings(origin, direction) % 2) == 1)
        return votes >= 2

    def depth(self, point) -> float:
        """How far a point sits inside, and zero when it is out."""
        return self.distance(point) if self.inside(point) else 0.0


def described(values: np.ndarray) -> dict:
    if values.size == 0:
        return {"count": 0}
    return {
        "count": int(values.size),
        "minMetres": round(float(values.min()), 6),
        "medianMetres": round(float(np.median(values)), 6),
        "p90Metres": round(float(np.percentile(values, 90)), 6),
        "maxMetres": round(float(values.max()), 6),
        "within10mm": round(float((values <= 0.010).mean()), 6),
    }


def waist_region(loaded: dict, slot_name: str) -> np.ndarray:
    """The body's own vertices for a slot's region, in the runtime frame."""
    meshes = {obj.name: obj for obj in loaded["meshes"]}
    points = []
    for name, indices in sorted(loaded["masks"]["slots"].get(slot_name, {}).items()):
        obj = meshes.get(name)
        if obj is None or not indices:
            continue
        matrix = obj.matrix_world
        points.extend(runtime_from_blender(matrix @ obj.data.vertices[index].co) for index in indices)
    if not points:
        raise RingError(f"region gate: the body has no {slot_name} region")
    return np.array(points, dtype=np.float64)


def torso_filter(region: np.ndarray, reach: float):
    """Is this surface vertex torso, or is it the arm hanging beside it? Runtime frame.

    A max-radius-per-bin measurement at waist height would otherwise measure the
    hands: they sit at the same height and three times the radius.
    """
    tree = KDTree(len(region))
    for at, point in enumerate(region):
        tree.insert(Vector(tuple(point)), at)
    tree.balance()

    def near(point) -> bool:
        found = tree.find(Vector(tuple(point)))
        return found[2] is not None and found[2] <= reach

    return near


def target_ellipse(surface_points: np.ndarray, is_torso: np.ndarray, centre: np.ndarray,
                   band: tuple[float, float], bins: int, clearance: float) -> dict:
    """The body's outer cross section over one height band, plus the strap's clearance."""
    inside_band = ((surface_points[:, 1] >= band[0]) & (surface_points[:, 1] <= band[1]) & is_torso)
    picked = surface_points[inside_band]
    if len(picked) < bins:
        raise RingError(f"ring gate: only {len(picked)} target vertices in the band {band}")
    middle, _ = ring_centre(picked, bins, outer=True)
    _, outer = bin_extremes(picked, middle, bins)
    covered = int(np.isfinite(outer).sum())
    a, b = fit_ellipse(bin_angles(bins), outer + clearance)
    return {"a": a, "b": b, "vertices": int(len(picked)), "binsCovered": covered,
            "band": [round(float(band[0]), 6), round(float(band[1]), 6)],
            "centreXZ": [round(float(middle[0]), 6), round(float(middle[1]), 6)],
            "regionCentroidXZ": [round(float(centre[0]), 6), round(float(centre[1]), 6)],
            "maxRadius": round(float(np.nanmax(outer)), 6),
            "minRadius": round(float(np.nanmin(outer)), 6)}


def transform(objects: list, centre_xz: np.ndarray, centre_y: float, scale: tuple[float, float, float],
              destination: np.ndarray, yaw_degrees: int) -> None:
    """One rigid move with a scale per horizontal axis, applied to every island alike.

    The buckle and the pouches ride the strap because they are moved by the strap's
    own transform, which is the whole reason a ring piece needs no per-island rule.
    """
    pivot = Vector(blender_from_runtime((centre_xz[0], centre_y, centre_xz[1])))
    shift = Vector(blender_from_runtime((destination[0] - centre_xz[0],
                                         destination[1] - centre_y,
                                         destination[2] - centre_xz[1])))
    # Runtime (X up-right, Y up, Z forward) is Blender (X, -Z, Y), so the scale
    # vector permutes with the frame and the vertical factor lands on Blender Z.
    diagonal = Matrix.Diagonal((scale[0], scale[2], scale[1], 1.0))
    spin = Matrix.Rotation(math.radians(yaw_degrees), 4, "Z")
    about = Matrix.Translation(pivot) @ diagonal @ spin @ Matrix.Translation(-pivot)
    matrix = Matrix.Translation(shift) @ about
    for obj in objects:
        obj.matrix_world = matrix @ obj.matrix_world
        bpy.ops.object.select_all(action="DESELECT")
        obj.select_set(True)
        bpy.context.view_layer.objects.active = obj
        bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)


def seat(obj, targets: list, offset: float, limit_group: str | None = None,
         scope: np.ndarray | None = None) -> dict:
    """One Shrinkwrap outward per layer, then a Corrective Smooth on what moved.

    One shrinkwrap against body and tunic welded into a single mesh does not do it:
    the mode's inside test reads the nearest surface's normal, and for a vertex
    between the two shells the nearest surface is the skin, whose normal says the
    vertex is already out. A modifier per layer asks each shell its own question.

    `limit_group` narrows both modifiers to one island. A shrinkwrap that reshapes a
    buckle to the body's cross section is the one thing a fitted belt must not do,
    and the body has an opinion about the strap alone; the hardware rides it.
    """
    before = np.array([tuple(vertex.co) for vertex in obj.data.vertices])
    for at, target in enumerate(targets):
        shrink = obj.modifiers.new(f"Ring seat {at}", "SHRINKWRAP")
        shrink.wrap_method = "NEAREST_SURFACEPOINT"
        shrink.wrap_mode = "OUTSIDE"
        shrink.offset = offset
        shrink.target = target
        if limit_group:
            shrink.vertex_group = limit_group
    depsgraph = bpy.context.evaluated_depsgraph_get()
    evaluated = obj.evaluated_get(depsgraph)
    mesh = evaluated.to_mesh()
    after = np.array([tuple(vertex.co) for vertex in mesh.vertices])
    evaluated.to_mesh_clear()
    moves = np.linalg.norm(after - before, axis=1)
    watched = np.arange(len(moves)) if scope is None else np.asarray(scope, dtype=int)
    moved = watched[moves[watched] > MOVE_EPSILON]
    fraction = float(len(moved) / max(1, len(watched)))
    report = {
        "offsetMetres": offset,
        "targets": [target.name for target in targets],
        "limitGroup": limit_group,
        "pieceVertices": int(len(moves)),
        "vertices": int(len(watched)),
        "movedVertices": int(len(moved)),
        "movedFraction": round(fraction, 6),
        "meanMoveMetres": round(float(moves[moved].mean()) if len(moved) else 0.0, 6),
        "maxMoveMetres": round(float(moves[watched].max()) if len(watched) else 0.0, 6),
        "smoothed": fraction >= SMOOTH_FLOOR,
    }
    if report["smoothed"]:
        group = obj.vertex_groups.new(name="ring_seat_moved")
        group.add([int(index) for index in moved], 1.0, "REPLACE")
        smooth = obj.modifiers.new("Ring seat smooth", "CORRECTIVE_SMOOTH")
        smooth.vertex_group = group.name
        smooth.factor = SMOOTH_FACTOR
        smooth.iterations = SMOOTH_ITERATIONS
        report["smoothFactor"] = SMOOTH_FACTOR
        report["smoothIterations"] = SMOOTH_ITERATIONS
    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    # Both modifiers at once: applying the shrinkwrap first would make its result the
    # corrective smooth's rest shape, and the smooth would then have nothing to do.
    bpy.ops.object.convert(target="MESH")
    if report["smoothed"] and obj.vertex_groups.get("ring_seat_moved"):
        obj.vertex_groups.remove(obj.vertex_groups["ring_seat_moved"])
    return report


def tag_islands(islands: list) -> list[str]:
    """Name every island on itself, because joining is what forgets which is which."""
    names = []
    for at, obj in enumerate(islands):
        name = f"{ISLAND_GROUP}_{at:03d}"
        obj.vertex_groups.new(name=name).add(range(len(obj.data.vertices)), 1.0, "REPLACE")
        names.append(name)
    return names


def island_members(obj, names: list[str]) -> list[list[int]]:
    """The joined mesh's vertices back in island order, and the tags then removed."""
    slot_of = {obj.vertex_groups[name].index: at for at, name in enumerate(names)}
    members: list[list[int]] = [[] for _ in names]
    for vertex in obj.data.vertices:
        for element in vertex.groups:
            at = slot_of.get(element.group)
            if at is not None and element.weight > 0.5:
                members[at].append(vertex.index)
                break
    for name in names:
        obj.vertex_groups.remove(obj.vertex_groups[name])
    return members


def rigid_transport(obj, members: list[list[int]], strap_at: int, before: np.ndarray,
                    displacement: np.ndarray, radius: float) -> list[dict]:
    """Every island but the strap rides it: translated by what moved under it, never
    reshaped.

    A buckle, a pouch and a hanging sash are welded to the leather, so the strap's
    own move is the whole of the answer for them, and the mean over the strap
    vertices they touch is that move. An island near enough nothing (a loose rivet,
    the fringe of the sash) follows the single strap vertex it is nearest, which is
    the same rule with the neighbourhood shrunk to one.
    """
    strap = members[strap_at]
    tree = KDTree(len(strap))
    for at, index in enumerate(strap):
        tree.insert(Vector(tuple(before[index])), at)
    tree.balance()
    moved = []
    for island_at, indices in enumerate(members):
        if island_at == strap_at or not indices:
            continue
        touching: set[int] = set()
        nearest_distance, nearest_slot = float("inf"), 0
        for index in indices:
            point = Vector(tuple(before[index]))
            for _, slot, _ in tree.find_range(point, radius):
                touching.add(slot)
            found = tree.find(point)
            if found[2] is not None and found[2] < nearest_distance:
                nearest_distance, nearest_slot = float(found[2]), found[1]
        borrowed = not touching
        if borrowed:
            touching = {nearest_slot}
        attached = np.array([strap[slot] for slot in sorted(touching)], dtype=int)
        shift = displacement[attached].mean(axis=0)
        for index in indices:
            obj.data.vertices[index].co = Vector(tuple(before[index] + shift))
        moved.append({
            "island": island_at,
            "attachmentVertices": int(len(attached)),
            "fromNearestStrapVertex": borrowed,
            "nearestStrapMetres": round(nearest_distance, 6),
            "translationMetres": round(float(np.linalg.norm(shift)), 6),
            "translation": [round(float(value), 6) for value in runtime_from_blender(shift)],
        })
    obj.data.update()
    return moved


def island_table(profiles: list[dict], members: list[list[int]], strap_at: int,
                 transported: list[dict], depths: np.ndarray,
                 bare_depths: np.ndarray) -> list[dict]:
    """Every island on one line: what it is, what carried it, and where it ended up."""
    carried = {entry["island"]: entry for entry in transported}
    rows = []
    for at, profile in enumerate(profiles):
        indices = np.array(members[at], dtype=int)
        row = {**profile, "island": at, "isStrap": at == strap_at,
               "joinedVertices": int(len(indices)),
               "insideDressedDeeperThan2mm": int((depths[indices] > 0.002).sum()),
               "insideBareDeeperThan2mm": int((bare_depths[indices] > 0.002).sum())}
        move = carried.get(at)
        if move:
            row.update({key: value for key, value in move.items() if key != "island"})
        rows.append(row)
    rows.sort(key=lambda entry: -entry["triangles"])
    return rows


def measure_strap(points: np.ndarray, centre: np.ndarray, bins: int, dressed: Solid,
                  bare: Solid) -> dict:
    """What the review is actually about: is the inner face of the strap on the body."""
    face = inner_face(points, centre, bins)
    inner = points[face]
    to_dressed = np.array([dressed.distance(blender_from_runtime(point)) for point in inner])
    to_bare = np.array([bare.distance(blender_from_runtime(point)) for point in inner])
    return {
        "innerFaceVertices": int(face.sum()),
        "toDressedSurface": described(to_dressed),
        "toBareBody": described(to_bare),
    }


def extents(points: np.ndarray) -> dict:
    return {
        "widthMetres": round(float(points[:, 0].max() - points[:, 0].min()), 6),
        "depthMetres": round(float(points[:, 2].max() - points[:, 2].min()), 6),
        "heightMetres": round(float(points[:, 1].max() - points[:, 1].min()), 6),
    }


def island_azimuths(objects: list, strap, centre: np.ndarray) -> dict:
    """Where the hardware sits around the ring, so a belt worn backwards is visible."""
    front = back = 0
    listed = []
    for obj in objects:
        if obj is strap:
            continue
        points = points_of(obj)
        middle = np.array([points[:, 0].mean(), points[:, 2].mean()])
        degrees = math.degrees(math.atan2(middle[1] - centre[1], middle[0] - centre[0]))
        count = triangles_of(obj)
        listed.append({"triangles": count, "degrees": round(degrees, 2),
                       "forward": bool(middle[1] > centre[1])})
        if middle[1] > centre[1]:
            front += count
        else:
            back += count
    listed.sort(key=lambda entry: -entry["triangles"])
    return {"forwardTriangles": front, "backwardTriangles": back, "islands": listed[:12]}


def island_profiles(islands: list, centre: np.ndarray) -> list[dict]:
    """One row per island, in island order, so a reader can tell them apart.

    Triangles alone do not say which island is the buckle and which is the sash, so
    the row carries where it sits around the ring and how far down it hangs.
    """
    rows = []
    for obj in islands:
        points = points_of(obj)
        middle = np.array([points[:, 0].mean(), points[:, 2].mean()])
        rows.append({
            "triangles": triangles_of(obj),
            "vertices": int(len(points)),
            "degrees": round(math.degrees(math.atan2(middle[1] - centre[1],
                                                     middle[0] - centre[0])), 2),
            "yMetres": [round(float(points[:, 1].min()), 6), round(float(points[:, 1].max()), 6)],
            "heightMetres": round(float(points[:, 1].max() - points[:, 1].min()), 6),
        })
    return rows


def run(args) -> dict:
    contract = json.loads(CONTRACT_PATH.read_text())
    if args.slot not in contract["slots"]:
        raise RingError(f"slot gate: unknown slot \"{args.slot}\"")
    slot = contract["slots"][args.slot]
    loaded = body.load(ROOT, args.body)
    worn_under = [name.strip() for name in (args.under or "").split(",") if name.strip()]
    beneath = piece.under(ROOT, worn_under)

    dressed_target = body.joined_target(loaded, beneath)
    bare_target = body.joined_target(loaded)
    # Measured against the union, seated against each shell: see `seat`.
    seat_targets = [bare_target] + [body.joined_meshes(
        [mesh for mesh in beneath if mesh.name.startswith(f"under-{name}-")], f"RingSeat-{name}")
        for name in worn_under]
    dressed = Solid([dressed_target])
    bare = Solid([bare_target])

    objects, source_had = piece.import_file(args.input)
    islands = normalise._split_islands(objects)
    raw = {"islands": len(islands), "triangles": sum(triangles_of(obj) for obj in islands),
           "vertices": sum(len(obj.data.vertices) for obj in islands)}
    strap, chosen = strap_island(islands, args.bins)
    strap_points = points_of(strap)

    centre, vertex_mean = ring_centre(strap_points, args.bins)
    inner, outer = bin_extremes(strap_points, centre, args.bins)
    covered = int(np.isfinite(inner).sum())
    loop = {**chosen, "binsCovered": covered,
            "centre": [round(float(centre[0]), 6), round(float(centre[1]), 6)],
            "vertexMeanCentre": [round(float(vertex_mean[0]), 6), round(float(vertex_mean[1]), 6)],
            "strapTriangles": triangles_of(strap), "strapVertices": len(strap_points)}
    if not loop["closed"]:
        loop["note"] = "the strap does not close a loop; the ring rule does not apply"

    fallback = False
    try:
        a_s, b_s = fit_ellipse(bin_angles(args.bins), inner)
    except RingError as error:
        fallback = True
        loop["ellipseError"] = str(error)
        a_s, b_s = bounding_semi_axes(strap_points, centre)
    strap_band = (float(strap_points[:, 1].min()), float(strap_points[:, 1].max()))
    strap_height = strap_band[1] - strap_band[0]
    strap_centre_y = float((strap_band[0] + strap_band[1]) * 0.5)

    region = waist_region(loaded, args.slot)
    region_y = (float(region[:, 1].min()), float(region[:, 1].max()))
    place_y = float((region_y[0] + region_y[1]) * 0.5)
    region_centre = np.array([float(region[:, 0].mean()), float(region[:, 2].mean())])

    surface_points = points_of(dressed_target)
    near_torso = torso_filter(region, TORSO_REACH)
    is_torso = np.array([near_torso(point) for point in surface_points])

    # The band the target is measured over is the strap's own height, which is only
    # known once the scale is - so it is solved for, starting from the body's region.
    band = region_y
    passes = []
    scale_x = scale_y = scale_z = 1.0
    for _ in range(max(1, args.passes)):
        fitted = target_ellipse(surface_points, is_torso, region_centre, band, args.bins,
                                RING_CLEARANCE)
        scale_x = fitted["a"] / a_s
        scale_z = fitted["b"] / b_s
        scale_y = (scale_x + scale_z) * 0.5
        half = strap_height * scale_y * 0.5
        band = (place_y - half, place_y + half)
        passes.append({"target": fitted, "scaleX": round(scale_x, 6), "scaleZ": round(scale_z, 6),
                       "scaleY": round(scale_y, 6),
                       "strapBand": [round(band[0], 6), round(band[1], 6)]})

    scale = (scale_x, scale_y, scale_z)
    target_centre = np.array(fitted["centreXZ"])
    destination = np.array([target_centre[0], place_y, target_centre[1]])
    transform(islands, centre, strap_centre_y, scale, destination, args.yaw)

    placed_strap = points_of(strap)
    placed_centre = np.array([destination[0], destination[2]])
    hardware = island_azimuths(islands, strap, placed_centre)
    profiles = island_profiles(islands, placed_centre)
    strap_at = islands.index(strap)
    before_seat = measure_strap(placed_strap, placed_centre, args.bins, dressed, bare)

    # Joining renumbers vertices and both the contact measurement and the rigid
    # transport have to keep looking at the same island, so every island says who it
    # is before the join does.
    tags = tag_islands(islands)
    fitted_object = piece.join(islands, args.piece)
    members = island_members(fitted_object, tags)
    strap_vertices = members[strap_at]
    if not strap_vertices:
        raise RingError("strap gate: the join lost the strap island")
    fitted_object.vertex_groups.new(name=STRAP_GROUP).add(strap_vertices, 1.0, "REPLACE")

    before_seat_points = np.array([tuple(vertex.co) for vertex in fitted_object.data.vertices])
    limited = args.seat == "strap"
    shrinkwrap = seat(fitted_object, seat_targets if args.seat == "layers" else [dressed_target],
                      SHRINKWRAP_OFFSET, STRAP_GROUP if limited else None,
                      np.array(strap_vertices, dtype=int) if limited else None)
    shrinkwrap["mode"] = args.seat
    fitted_object.vertex_groups.remove(fitted_object.vertex_groups[STRAP_GROUP])

    transported: list[dict] = []
    if limited:
        after_seat_points = np.array([tuple(vertex.co) for vertex in fitted_object.data.vertices])
        transported = rigid_transport(fitted_object, members, strap_at, before_seat_points,
                                      after_seat_points - before_seat_points, ATTACH_RADIUS)

    after_points = points_of(fitted_object)
    strap_after = after_points[strap_vertices]
    after_seat = measure_strap(strap_after, placed_centre, args.bins, dressed, bare)

    torso_band = surface_points[(surface_points[:, 1] >= band[0]) & (surface_points[:, 1] <= band[1])
                                & is_torso]
    bare_points = points_of(bare_target)
    bare_torso = np.array([near_torso(point) for point in bare_points])
    bare_band = bare_points[(bare_points[:, 1] >= band[0]) & (bare_points[:, 1] <= band[1]) & bare_torso]

    mode = args.weights or slot["weights"]["mode"]
    weight_report = weights.apply([fitted_object], dressed_target, loaded["armature"], slot, mode, False)

    out = Path(args.outdir)
    out.mkdir(parents=True, exist_ok=True)
    glb_path = str(out / f"{args.piece}.glb")
    exporter.write_glb(glb_path, {args.piece: fitted_object}, loaded["armature"])
    rest = exporter.finish(glb_path)

    depths = np.array([dressed.depth(blender_from_runtime(point)) for point in after_points])
    bare_depths = np.array([bare.depth(blender_from_runtime(point)) for point in after_points])
    outside = {
        "insideVertices": int((depths > 0).sum()),
        "maxPenetrationMetres": round(float(depths.max(initial=0.0)), 9),
        "deeperThan2mm": int((depths > 0.002).sum()),
    }
    bare_outside = {
        "insideVertices": int((bare_depths > 0).sum()),
        "maxPenetrationMetres": round(float(bare_depths.max(initial=0.0)), 9),
        "deeperThan2mm": int((bare_depths > 0.002).sum()),
    }
    islands_table = island_table(profiles, members, strap_at, transported, depths, bare_depths)

    measured = gate.measure(glb_path, str(loaded["path"]), contract, source_had, outside)
    gates_table = gate.gates(measured, slot, None, [])
    manifest = {
        "schema": "ashveil.gear-manifest.v1",
        "family": contract["family"],
        "contractVersion": contract["version"],
        "body": args.body,
        "slot": args.slot,
        "piece": args.piece,
        "source": {"file": Path(args.input).name, "sha256": exporter.sha256_file(args.input)},
        "bones": _bone_names(glb_path),
        "inverseBindSha256": _inverse_bind_sha(glb_path),
        "covers": [args.slot],
        "under": worn_under,
        "hidesPieces": bool(slot.get("hidesPieces", True)),
        # A belt hides nothing: the tunic under it is a piece, not skin, and the skin
        # under the tunic is already hidden by the tunic's own mask.
        "hides": {},
        "weights": mode,
        # The schema carries one scale, and the ring rule has three; the report has
        # the axes, and the mean is what a reader comparing pieces wants here.
        "alignment": {"scale": round(float(sum(scale) / 3.0), 6), "yawDegrees": args.yaw,
                      "translation": [round(float(value), 6) for value in
                                      (destination[0] - centre[0], destination[1] - strap_centre_y,
                                       destination[2] - centre[1])]},
        "budget": {"triangles": measured["triangles"], "materials": measured["materials"],
                   "meshes": measured["meshes"],
                   "maxInfluencesPerVertex": measured["maxInfluencesPerVertex"]},
        "gates": gates_table,
        "reportFile": f"{args.piece}.report.json",
    }
    report = {
        "schema": "ashveil.gear-report.v1",
        "rule": "ring",
        "family": contract["family"],
        "contractVersion": contract["version"],
        "body": args.body,
        "slot": args.slot,
        "piece": args.piece,
        "under": worn_under,
        "source": manifest["source"],
        "raw": raw,
        "loop": loop,
        "strapEllipse": {"aMetres": round(a_s, 6), "bMetres": round(b_s, 6),
                         "heightMetres": round(strap_height, 6),
                         "centreY": round(strap_centre_y, 6),
                         "fromBoundingBox": fallback},
        "region": {"slot": args.slot, "vertices": int(len(region)),
                   "yMetres": [round(region_y[0], 6), round(region_y[1], 6)],
                   "placementY": round(place_y, 6),
                   "centreXZ": [round(float(region_centre[0]), 6), round(float(region_centre[1]), 6)],
                   "torsoReachMetres": TORSO_REACH,
                   "torsoVertices": int(is_torso.sum())},
        "passes": passes,
        "placement": {"scaleX": round(scale[0], 6), "scaleY": round(scale[1], 6),
                      "scaleZ": round(scale[2], 6), "yawDegrees": args.yaw,
                      "clearanceMetres": RING_CLEARANCE,
                      "translation": manifest["alignment"]["translation"]},
        "hardware": hardware,
        "islandTable": islands_table,
        "transport": {"mode": args.seat, "attachRadiusMetres": ATTACH_RADIUS,
                      "strapIsland": strap_at, "islandsMoved": len(transported),
                      "fromNearestStrapVertex": sum(1 for entry in transported
                                                    if entry["fromNearestStrapVertex"]),
                      "maxTranslationMetres": round(max((entry["translationMetres"]
                                                         for entry in transported), default=0.0), 6)},
        "strapBeforeSeat": before_seat,
        "strapAfterSeat": after_seat,
        "strapExtents": extents(strap_after),
        "torsoExtents": {"dressed": extents(torso_band), "bare": extents(bare_band),
                         "band": [round(band[0], 6), round(band[1], 6)]},
        "shrinkwrap": shrinkwrap,
        "seatMode": args.seat,
        "weights": weight_report,
        "rest": rest,
        "bindClearance": outside,
        "bareBodyClearance": bare_outside,
        "runtime": measured,
        "gates": gates_table,
        "gatesPass": all(gates_table.values()),
        "outputs": {"glb": f"{args.piece}.glb", "manifest": f"{args.piece}.manifest.json",
                    "report": f"{args.piece}.report.json",
                    "sha256": exporter.sha256_file(glb_path)},
    }
    exporter.write_json(str(out / f"{args.piece}.manifest.json"), manifest)
    exporter.write_json(str(out / f"{args.piece}.report.json"), report)
    return report


def _bone_names(glb_path: str) -> list[str]:
    glb = Glb(glb_path)
    return [glb.json["nodes"][node]["name"] for node in glb.json["skins"][0]["joints"]]


def _inverse_bind_sha(glb_path: str) -> str:
    glb = Glb(glb_path)
    return exporter.sha256_array(glb.accessor(glb.json["skins"][0]["inverseBindMatrices"]))


def parse(argv: list[str]):
    parser = argparse.ArgumentParser(prog="art:ring")
    parser.add_argument("--input", required=True)
    parser.add_argument("--slot", default="waist")
    parser.add_argument("--body", required=True)
    parser.add_argument("--piece", required=True)
    parser.add_argument("--under", default="")
    parser.add_argument("--weights", choices=("transfer", "stiff", "rigid"), default="stiff")
    parser.add_argument("--yaw", type=int, choices=(0, 180), default=0)
    parser.add_argument("--bins", type=int, default=AZIMUTH_BINS)
    parser.add_argument("--passes", type=int, default=3)
    parser.add_argument("--seat", choices=("strap", "merged", "layers"), default="strap")
    parser.add_argument("--outdir", required=True)
    return parser.parse_args(argv)


def main() -> int:
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else sys.argv[1:]
    args = parse(argv)
    try:
        report = run(args)
    except Exception as error:  # noqa: BLE001 - Blender's exit status is the wrapper contract.
        traceback.print_exc()
        print(f"RING FIT FAILED: {error}", file=sys.stderr)
        return 1
    print(json.dumps({"piece": report["piece"], "gatesPass": report["gatesPass"],
                      "gates": report["gates"], "outputs": report["outputs"]}, separators=(",", ":")))
    return 0


if __name__ == "__main__":
    sys.exit(main())
