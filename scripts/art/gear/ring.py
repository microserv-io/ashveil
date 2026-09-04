"""Ring placement: a loop around a bone has exactly one correct place on a body.

A belt strap, a collar or a cuff closes a loop about the vertical axis, and the
body's cross section at that height plus a clearance says where the loop goes.
The strap's own inner ellipse is measured, the body's outer ellipse at the same
height too, and the whole piece - buckle, pouches, sash, rivets - is moved by one
rigid transform with a scale per horizontal axis.

An ellipse is where the placement ends and the belt is not on yet, because a waist
is not an ellipse: the leather touches at the points where the body reaches the
ellipse and stands a centimetre off between them. So the strap is then conformed.
Per azimuth the surface's own reach is measured by ray and the leather is drawn onto
it, every vertex in that direction moving by the same amount so the thickness and
the edge profile come along unchanged. One Shrinkwrap pushes back out what the
conform left inside, and a Corrective Smooth tidies only what moved.

Only the strap is ever reshaped. The body has an opinion about a band of leather
lying on it and none at all about the buckle bolted through it, so every other part
rides the strap: the patch of leather it is welded to says how that leather turned
as well as where it went, and the whole part is carried by that one rigid move and
keeps its own shape to the millimetre. What that leaves inside the clothes
underneath - the belt was generated against nothing, so a pouch back can start in
the hem - is then swung out, whole part by whole part, about the line of leather the
part is bolted along. Only what hangs below the strap's own bottom edge is measured:
inside the band the part is welded to leather the seat has legitimately conformed
onto the tunic, and a part cannot be asked to clear the surface its anchor lies on.

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
from typing import NamedTuple

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
from gear import body, gate, piece, regions, weights  # noqa: E402

ROOT = Path(__file__).resolve().parents[3]
CONTRACT_PATH = ROOT / "scripts" / "art" / "contracts" / "humanoid.v1.json"

AZIMUTH_BINS = 36
# What the strap holds off the body's own surface before the seat runs.
RING_CLEARANCE = 0.003
SHRINKWRAP_OFFSET = 0.003
# The conform reads a cross section rather than fits one, so it wants a finer comb
# than the ellipse does: 5 degrees is a bin the strap always has vertices in.
CONFORM_BINS = 72
# What the conformed leather holds off the surface it now lies on.
CONFORM_GAP = 0.002
# One spike in the measured profile must not pull a whole column of the strap in,
# and the same width tidies the surface up the band as tidies it around.
CONFORM_KERNEL = 3
# Heights across the strap's own band both the surface and the leather are read at.
# A waist tapers, so one radius per azimuth makes the band ride its widest height.
CONFORM_SAMPLES = 9
# How far the displacement may change between neighbouring height slices. Past this
# the band stops following the surface's slope and starts folding over itself.
CONFORM_SLOPE = 0.006
CONFORM_SLOPE_PASSES = 8
# Past this a bin moved far enough to be worth naming rather than counting.
CONFORM_LOUD = 0.015
# How far inside its own edges the leather cuts the piece below it. The two surfaces
# deform apart, so a cut ending exactly at the strap sawtooths the moment either moves.
PROFILE_INSET = 0.003
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
# What an attachment patch has to be before it can say which way its part turned:
# fewer points than this, or all of them on one line, and only the shift is known.
PATCH_MIN_VERTICES = 4
PATCH_MIN_SPREAD = 0.001
# How close two islands' vertices come before they are one part: a flap on its pouch,
# a keeper loop on its strap, the knot on the sash.
CLUSTER_RADIUS = 0.005
# Below this a vertex grazes the cloth rather than sits inside it.
CLEARANCE_DEPTH = 0.002
# What a cleared part keeps beyond the surface it was buried in.
CLEARANCE_MARGIN = 0.003
# The skirt's flare is curved, so one swing out can bury a tall part again.
CLEARANCE_PASSES = 3
# How far a part may be swung off the pose it was drawn in. Past a quarter turn the
# belt stops being the belt that was drawn, and the drawing is the thing to fix.
HINGE_MAX_DEGREES = 25.0
# A vertex this close to the hinge line sits on it, and no angle would swing it out.
HINGE_MIN_LEVER = 0.002
# What "welded to the leather" means on the source mesh, where nothing has moved yet.
FLUSH_RAW = 0.002
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

    def hits(self, origin: Vector, direction: Vector):
        """Every crossing along one ray, near to far: a dressed cross section is layered."""
        at = origin.copy()
        for _ in range(RAY_HIT_LIMIT):
            hit, _, _, _ = self.tree.ray_cast(at, direction)
            if hit is None:
                return
            yield hit
            at = hit + direction * RAY_NUDGE

    def _crossings(self, origin: Vector, direction: Vector) -> int:
        return sum(1 for _ in self.hits(origin, direction))

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
        "within5mm": round(float((values <= 0.005).mean()), 6),
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


def circular_fill(values: np.ndarray) -> np.ndarray:
    """A bin nothing landed in borrows from its neighbours, the short way round."""
    known = np.flatnonzero(np.isfinite(values))
    if known.size == 0:
        raise RingError("conform gate: no azimuth bin carries a radius")
    if known.size == values.size:
        return values.copy()
    bins = len(values)
    step = 2.0 * math.pi / bins
    at = known.astype(float) * step
    grid = np.concatenate([at[-1:] - 2.0 * math.pi, at, at[:1] + 2.0 * math.pi])
    picked = np.concatenate([values[known[-1:]], values[known], values[known[:1]]])
    return np.interp(np.arange(bins) * step, grid, picked)


def circular_smooth(values: np.ndarray, width: int) -> np.ndarray:
    """A moving average that wraps, because the last bin and the first are neighbours."""
    if width <= 1:
        return values.copy()
    padded = np.concatenate([values[-width:], values, values[:width]])
    kernel = np.ones(width) / float(width)
    return np.convolve(padded, kernel, mode="same")[width:width + len(values)]


def cell_fill(grid: np.ndarray) -> np.ndarray:
    """Every cell of an (azimuth, height) field gets a value, up the band before around it.

    Which neighbour to borrow from is not a toss-up. Across the band a radius changes
    by a few millimetres and around the ring it changes by fifty, so a gap filled from
    the same azimuth is close and one filled from the same height is a guess. It
    matters most where the samples are sparse and biased: the strap only reaches a
    given height at the azimuths where its band happens to pass through it, and those
    are the widest ones, so filling around the ring first spreads the widest reading
    over the whole waist and the leather is drawn onto a body two centimetres too fat.

    An azimuth with nothing at any height has no column to borrow from, and only then
    is the height row filled the short way round.
    """
    levels = np.arange(grid.shape[1], dtype=float)
    filled = grid.copy()
    for slot in range(grid.shape[0]):
        known = np.flatnonzero(np.isfinite(grid[slot]))
        if known.size:
            filled[slot] = np.interp(levels, known.astype(float), grid[slot, known])
    empty = ~np.isfinite(filled).any(axis=1)
    if empty.all():
        raise RingError("conform gate: no azimuth carries a radius at any height")
    if empty.any():
        for level in range(grid.shape[1]):
            filled[:, level] = circular_fill(filled[:, level])
    return filled


def height_smooth(grid: np.ndarray, width: int) -> np.ndarray:
    """A moving average up the band. The top and bottom rows repeat rather than wrap:
    a waist is a loop around, and is not a loop from hem to hem."""
    if width <= 1:
        return grid.copy()
    pad = width // 2
    padded = np.concatenate([np.repeat(grid[:, :1], pad, axis=1), grid,
                             np.repeat(grid[:, -1:], pad, axis=1)], axis=1)
    kernel = np.ones(width) / float(width)
    return np.stack([np.convolve(row, kernel, mode="valid") for row in padded])


class Surface(NamedTuple):
    """What the body reaches under the strap: a radius per azimuth and per height."""

    grid: np.ndarray
    ridge: np.ndarray
    heights: np.ndarray


def surface_radii(target: Solid, centre_xz: np.ndarray, band: tuple[float, float], near_torso,
                  bins: int, samples: int, gap: float, kernel: int) -> tuple[Surface, dict]:
    """How far the surface under the strap reaches, per azimuth and height, plus the gap.

    A cross section read off the target's own vertices is as sparse as the mesh is,
    and a belt conformed to it would follow the triangulation. A ray from the ring
    axis asks the surface itself, and the furthest torso crossing is the outside of
    whatever is worn there: skin where nothing is, the tunic's outer shell where it
    is. Hits that are not torso are dropped, because at waist height the arm is a
    wall the leather would otherwise be asked to wrap.

    The band is sampled at several heights and every one of them is kept, because a
    waist tapers and a belt drawn onto one radius per azimuth rides its widest height
    and stands off everywhere else. The ridge - that widest height - is kept beside
    the field so the older per-azimuth conform can still be asked for.
    """
    heights = np.linspace(band[0], band[1], samples)
    grid = np.full((bins, samples), np.nan)
    per_bin_hits = np.zeros(bins, dtype=int)
    for slot, angle in enumerate(bin_angles(bins)):
        direction = Vector(blender_from_runtime((math.cos(angle), 0.0, math.sin(angle))))
        for level, height in enumerate(heights):
            origin = Vector(blender_from_runtime((centre_xz[0], height, centre_xz[1])))
            for hit in target.hits(origin, direction):
                point = np.array(runtime_from_blender(hit))
                if not near_torso(point):
                    continue
                per_bin_hits[slot] += 1
                reach = math.hypot(point[0] - centre_xz[0], point[2] - centre_xz[1])
                if not np.isfinite(grid[slot, level]) or reach > grid[slot, level]:
                    grid[slot, level] = reach
    radii = np.where(np.isnan(grid).all(axis=1), np.nan, np.nanmax(grid, axis=1))
    # How much of the surface a single radius per azimuth has to throw away.
    spread = np.nanmax(grid, axis=1) - np.nanmin(grid, axis=1)
    measured = int(np.isfinite(radii).sum())
    if measured < bins // 2:
        raise RingError(f"conform gate: only {measured} of {bins} azimuths found the surface")
    reach = cell_fill(grid)
    # Smoothing keeps one spike from pulling a whole column in, but a waist is convex
    # and an average of a convex profile sits under it: smoothed alone would bury the
    # leather in every belly and hip it crosses. A strap is a taut band, so it rides
    # what sticks out and bridges what does not, and the smoothing only ever gets to
    # lift the target, never to sink it below the surface it was measured from.
    field = np.maximum(
        height_smooth(np.stack([circular_smooth(row, kernel) for row in reach.T], axis=1), kernel),
        reach) + gap
    ridge = circular_smooth(circular_fill(radii), kernel) + gap
    return Surface(field, ridge, heights), {
        "bins": bins, "samples": samples, "gapMetres": gap, "kernelBins": kernel,
        "band": [round(float(band[0]), 6), round(float(band[1]), 6)],
        "centreXZ": [round(float(centre_xz[0]), 6), round(float(centre_xz[1]), 6)],
        "binsMeasured": measured, "binsFilled": bins - measured,
        "cellsMeasured": int(np.isfinite(grid).sum()), "cells": bins * samples,
        "torsoHits": int(per_bin_hits.sum()),
        "rawMinMetres": round(float(np.nanmin(grid)), 6),
        "rawMaxMetres": round(float(np.nanmax(grid)), 6),
        "targetMinMetres": round(float(field.min()), 6),
        "targetMaxMetres": round(float(field.max()), 6),
        "ridgeMinMetres": round(float(ridge.min()), 6),
        "ridgeMaxMetres": round(float(ridge.max()), 6),
        "bandSpreadMetres": {"min": round(float(np.nanmin(spread)), 6),
                             "median": round(float(np.nanmedian(spread)), 6),
                             "max": round(float(np.nanmax(spread)), 6)},
        "medianRadiusPerHeight": [[round(float(height), 6),
                                   round(float(np.nanmedian(grid[:, level])), 6),
                                   round(float(np.median(field[:, level])), 6)]
                                  for level, height in enumerate(heights)],
    }


def bin_thickness(points: np.ndarray, centre_xz: np.ndarray, bins: int) -> np.ndarray:
    """Per azimuth, how far the outer face stands off the inner one: the strap's own depth."""
    inner, outer = bin_extremes(points, centre_xz, bins)
    return (outer - inner)[np.isfinite(inner)]


def edge_stats(values: np.ndarray) -> dict:
    """One edge's own extent around the ring. The tilt is what a flat band gets wrong."""
    return {"min": round(float(values.min()), 6),
            "median": round(float(np.median(values)), 6),
            "max": round(float(values.max()), 6),
            "tiltMetres": round(float(values.max() - values.min()), 6)}


class Band(NamedTuple):
    """The strap's own top and bottom edge per azimuth, and which side of them a point is.

    A conformed strap tilts by nearly its own height around the waist, so "under the
    leather" is a different height at every azimuth and one pair of numbers gets it
    wrong wherever the band rides low.
    """

    centre: np.ndarray
    tops: np.ndarray
    bottoms: np.ndarray
    bins: int
    empty_bins: int

    def _at(self, points: np.ndarray) -> np.ndarray:
        return bin_index(azimuth(points, self.centre)[0], self.bins)

    def below(self, points: np.ndarray) -> np.ndarray:
        return points[:, 1] < self.bottoms[self._at(points)]

    def within(self, points: np.ndarray) -> np.ndarray:
        at = self._at(points)
        return (points[:, 1] >= self.bottoms[at]) & (points[:, 1] <= self.tops[at])


def band_edges(points: np.ndarray, centre_xz: np.ndarray, bins: int) -> Band:
    """Per azimuth, where the leather actually starts and stops."""
    at = bin_index(azimuth(points, centre_xz)[0], bins)
    tops = np.full(bins, np.nan)
    bottoms = np.full(bins, np.nan)
    for index in range(bins):
        members = points[at == index]
        if len(members) == 0:
            continue
        bottoms[index] = members[:, 1].min()
        tops[index] = members[:, 1].max()
    if not np.isfinite(tops).any():
        raise RingError("band gate: the strap covers no azimuth bin")
    empty = int((~np.isfinite(tops)).sum())
    return Band(centre_xz, circular_fill(tops), circular_fill(bottoms), bins, empty)


def band_profile(points: np.ndarray, centre_xz: np.ndarray, bins: int,
                 inset: float = PROFILE_INSET, kernel: int = CONFORM_KERNEL) -> dict:
    """Where the strap's own edges run around the ring, and the band a hide rule cuts.

    A surface conform tilts the strap, so the heights it covers at one azimuth are not
    the heights it covers at the next: a flat band spanning the whole strap cuts hem
    the leather is not behind at the azimuths where it rides low, and the band they
    all share is a slab a millimetre high. `hideTop` and `hideBottom` are the edges
    themselves, smoothed the way the conform target is and pulled `inset` into the
    leather so the cut always ends under it.
    """
    edges = band_edges(points, centre_xz, bins)
    tops, bottoms, empty = edges.tops, edges.bottoms, edges.empty_bins
    hide_top = circular_smooth(tops, kernel) - inset
    hide_bottom = circular_smooth(bottoms, kernel) + inset
    return {
        "bins": bins,
        "emptyBins": empty,
        "insetMetres": inset,
        "kernelBins": kernel,
        "everywhereMetres": [round(float(bottoms.max()), 6), round(float(tops.min()), 6)],
        "topSpreadMetres": round(float(tops.max() - tops.min()), 6),
        "bottomSpreadMetres": round(float(bottoms.max() - bottoms.min()), 6),
        "topMetres": edge_stats(tops),
        "bottomMetres": edge_stats(bottoms),
        "hideTopMetres": edge_stats(hide_top),
        "hideBottomMetres": edge_stats(hide_bottom),
        "tops": [round(float(value), 6) for value in tops],
        "bottoms": [round(float(value), 6) for value in bottoms],
        "hideTop": [round(float(value), 6) for value in hide_top],
        "hideBottom": [round(float(value), 6) for value in hide_bottom],
    }


def buried_bins(points: np.ndarray, centre_xz: np.ndarray, bins: int, depths: np.ndarray,
                limit: float) -> list[dict]:
    """Which way round the ring the leather is still under the clothes, and how far.

    A total says how much is buried and never where, and where is the whole question
    for a belt: eight vertices at one azimuth is a hole a reader sees and eight spread
    around the waist is nothing.
    """
    angles, _ = azimuth(points, centre_xz)
    which = bin_index(angles, bins)
    centres = bin_angles(bins)
    rows = []
    for slot in range(bins):
        picked = depths[which == slot]
        if picked.size and float(picked.max()) > limit:
            rows.append({"bin": slot, "degrees": round(math.degrees(centres[slot]), 1),
                         "vertices": int((picked > limit).sum()),
                         "maxDepthMetres": round(float(picked.max()), 6)})
    return sorted(rows, key=lambda row: -row["maxDepthMetres"])


def nearest_slice(heights_of: np.ndarray, heights: np.ndarray) -> np.ndarray:
    """Which sampled height each vertex belongs to."""
    return np.abs(heights_of[:, None] - heights[None, :]).argmin(axis=1)


def slice_thickness(points: np.ndarray, centre_xz: np.ndarray, bins: int,
                    heights: np.ndarray) -> np.ndarray:
    """Per height slice, the median depth of the leather across the azimuths it covers.

    The per-bin figure answers "is the strap still as thick", and this one answers
    "is it still as thick everywhere up its height", which is what a conform that
    moves the top of the band differently from the bottom can get wrong.
    """
    angles, radius = azimuth(points, centre_xz)
    which = bin_index(angles, bins)
    level_of = nearest_slice(points[:, 1], heights)
    medians = np.full(len(heights), np.nan)
    for level in range(len(heights)):
        spans = []
        for slot in range(bins):
            picked = radius[(which == slot) & (level_of == level)]
            if picked.size > 1:
                spans.append(picked.max() - picked.min())
        if spans:
            medians[level] = float(np.median(spans))
    return medians


def strap_radii(points: np.ndarray, centre_xz: np.ndarray, bins: int,
                heights: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """Where the leather's inner face sits, per azimuth and per height, filled and as read.

    Only the face that has to touch is measured: a cell holding nothing but outer
    face would otherwise read a radius a strap thickness too far out and the conform
    would leave a dent there. Cells the mesh left empty are filled the same way the
    surface's are, so the field the displacement is built from has no holes.
    """
    angles, radius = azimuth(points, centre_xz)
    which = bin_index(angles, bins)
    face = inner_face(points, centre_xz, bins)
    level_of = nearest_slice(points[:, 1], heights)
    grid = np.full((bins, len(heights)), np.nan)
    for slot in range(bins):
        for level in range(len(heights)):
            picked = radius[face & (which == slot) & (level_of == level)]
            if picked.size:
                grid[slot, level] = picked.min()
    return cell_fill(grid), grid


def slope_limit(field: np.ndarray, limit: float, passes: int) -> tuple[np.ndarray, list[dict]]:
    """Hold the displacement's change up the band, so the leather bends and never folds.

    Two neighbouring height slices pulled apart by more than a slice is tall turn the
    band inside out. Only ever the outer of the pair is given way to: a limit that
    could drag a slice further in would push that leather under the clothes it was
    just drawn onto, and no fold is worth burying the belt to avoid. Raising only
    settles, because nothing here ever comes back down.
    """
    steps = np.diff(field, axis=1)
    engaged = [{"bin": int(slot), "slice": int(level),
                "rawStepMetres": round(float(steps[slot, level]), 6)}
               for slot, level in np.argwhere(np.abs(steps) > limit)]
    limited = field.copy()
    for _ in range(passes):
        for level in range(limited.shape[1] - 1):
            limited[:, level] = np.maximum(limited[:, level], limited[:, level + 1] - limit)
            limited[:, level + 1] = np.maximum(limited[:, level + 1], limited[:, level] - limit)
        for level in range(limited.shape[1] - 2, -1, -1):
            limited[:, level] = np.maximum(limited[:, level], limited[:, level + 1] - limit)
            limited[:, level + 1] = np.maximum(limited[:, level + 1], limited[:, level] - limit)
        if float(np.abs(np.diff(limited, axis=1)).max()) <= limit + 1e-9:
            break
    return limited, engaged


def bilinear(field: np.ndarray, angles: np.ndarray, heights_of: np.ndarray,
             heights: np.ndarray, bins: int) -> np.ndarray:
    """Read an (azimuth, height) field at a vertex, so no vertex steps against its neighbour."""
    across = (angles + math.pi) / (2.0 * math.pi / bins) - 0.5
    near = np.floor(across).astype(int)
    weight_across = across - near
    left, right = near % bins, (near + 1) % bins
    span = max(float(heights[-1] - heights[0]), 1e-9)
    up = np.clip((heights_of - heights[0]) / span * (len(heights) - 1), 0.0, len(heights) - 1)
    below = np.clip(np.floor(up).astype(int), 0, len(heights) - 2)
    weight_up = up - below
    lower = field[left, below] * (1.0 - weight_across) + field[right, below] * weight_across
    upper = field[left, below + 1] * (1.0 - weight_across) + field[right, below + 1] * weight_across
    return lower * (1.0 - weight_up) + upper * weight_up


def azimuth_shift(strap: np.ndarray, angles: np.ndarray, centre_xz: np.ndarray,
                  ridge: np.ndarray, bins: int) -> tuple[np.ndarray, dict]:
    """The older conform: one displacement per azimuth, so the band stays vertical."""
    _, radius = azimuth(strap, centre_xz)
    which = bin_index(angles, bins)
    inner = np.full(bins, np.nan)
    for slot in range(bins):
        members = radius[which == slot]
        if members.size:
            inner[slot] = members.min()
    filled = circular_fill(inner)
    delta = ridge - filled
    centres = bin_angles(bins)
    grid = np.concatenate([centres[-1:] - 2.0 * math.pi, centres, centres[:1] + 2.0 * math.pi])
    values = np.concatenate([delta[-1:], delta, delta[:1]])
    loud = [slot for slot in range(bins) if abs(delta[slot]) > CONFORM_LOUD]
    return np.interp(angles, grid, values), {
        "emptyBins": int((~np.isfinite(inner)).sum()),
        "displacementMetres": {"min": round(float(delta.min()), 6),
                               "median": round(float(np.median(delta)), 6),
                               "max": round(float(delta.max()), 6),
                               "maxAbs": round(float(np.abs(delta).max()), 6)},
        "loudBins": [{"bin": slot, "degrees": round(math.degrees(centres[slot]), 2),
                      "displacementMetres": round(float(delta[slot]), 6)} for slot in loud],
        "loudBinCount": len(loud),
        "innerRadiusBeforeMetres": {"min": round(float(filled.min()), 6),
                                    "median": round(float(np.median(filled)), 6),
                                    "max": round(float(filled.max()), 6)},
        "targetRadiusMetres": {"min": round(float(ridge.min()), 6),
                               "median": round(float(np.median(ridge)), 6),
                               "max": round(float(ridge.max()), 6)},
    }


def surface_shift(strap: np.ndarray, angles: np.ndarray, centre_xz: np.ndarray,
                  surface: Surface, bins: int) -> tuple[np.ndarray, dict]:
    """One displacement per azimuth and per height, so the band follows the surface's slope.

    Inner and outer face at the same place around and up the ring move by the same
    amount, so the leather keeps its radial depth and its edge profile; what changes
    is that the top of the band can come in further than the bottom, which is the
    only way a strap sits on a waist that is not a cylinder.
    """
    inner, raw_inner = strap_radii(strap, centre_xz, bins, surface.heights)
    raw = surface.grid - inner
    delta, engaged = slope_limit(raw, CONFORM_SLOPE, CONFORM_SLOPE_PASSES)
    centres = bin_angles(bins)
    loud = np.argwhere(np.abs(delta) > CONFORM_LOUD)
    return bilinear(delta, angles, strap[:, 1], surface.heights, bins), {
        "samples": len(surface.heights),
        "heights": [round(float(height), 6) for height in surface.heights],
        "emptyCells": int(np.isnan(raw_inner).sum()), "cells": int(delta.size),
        "innerPerSliceMetres": [
            [round(float(surface.heights[level]), 6),
             int(np.isfinite(raw_inner[:, level]).sum()),
             _rounded(np.nanmin(raw_inner[:, level]) if np.isfinite(raw_inner[:, level]).any() else np.nan),
             _rounded(np.nanmedian(raw_inner[:, level]) if np.isfinite(raw_inner[:, level]).any() else np.nan),
             _rounded(np.nanmax(raw_inner[:, level]) if np.isfinite(raw_inner[:, level]).any() else np.nan),
             round(float(np.median(inner[:, level])), 6)] for level in range(inner.shape[1])],
        "targetPerSliceMetres": [
            [round(float(surface.heights[level]), 6),
             round(float(surface.grid[:, level].min()), 6),
             round(float(np.median(surface.grid[:, level])), 6),
             round(float(surface.grid[:, level].max()), 6)] for level in range(surface.grid.shape[1])],
        "displacementMetres": {"min": round(float(delta.min()), 6),
                               "median": round(float(np.median(delta)), 6),
                               "max": round(float(delta.max()), 6),
                               "maxAbs": round(float(np.abs(delta).max()), 6)},
        "displacementPerSliceMetres": [
            [round(float(surface.heights[level]), 6),
             round(float(delta[:, level].min()), 6),
             round(float(np.median(delta[:, level])), 6),
             round(float(delta[:, level].max()), 6)] for level in range(delta.shape[1])],
        "loudCellCount": int(len(loud)),
        "loudBins": sorted({int(slot) for slot, _ in loud}),
        "loudSlices": sorted({int(level) for _, level in loud}),
        "loudCells": [{"bin": int(slot), "degrees": round(math.degrees(centres[slot]), 2),
                       "slice": int(level),
                       "heightMetres": round(float(surface.heights[level]), 6),
                       "displacementMetres": round(float(delta[slot, level]), 6)}
                      for slot, level in loud[:16]],
        "slopeLimitMetres": CONFORM_SLOPE,
        "slopeEngagements": len(engaged),
        "slopeEngagedBins": sorted({entry["bin"] for entry in engaged}),
        "slopeEngagedSlices": sorted({entry["slice"] for entry in engaged}),
        "slopeMaxRawStepMetres": round(float(np.abs(np.diff(raw, axis=1)).max()), 6),
        "slopeMaxStepMetres": round(float(np.abs(np.diff(delta, axis=1)).max()), 6),
        "slopeEngagementTable": engaged[:16],
        "innerRadiusBeforeMetres": {"min": round(float(inner.min()), 6),
                                    "median": round(float(np.median(inner)), 6),
                                    "max": round(float(inner.max()), 6)},
        "targetRadiusMetres": {"min": round(float(surface.grid.min()), 6),
                               "median": round(float(np.median(surface.grid)), 6),
                               "max": round(float(surface.grid.max()), 6)},
    }


def conform(obj, indices: list[int], centre_xz: np.ndarray, surface: Surface, bins: int,
            mode: str) -> dict:
    """Draw the strap onto the surface under it, keeping the leather's depth.

    The strap has an inner radius and the body has a reach, and the difference is
    what the leather has to come in by. Every vertex in that direction moves by it,
    horizontally and about the ring axis, so the outer face travels with the inner
    one: the thickness and the edge profile are the same shape afterwards, only
    wrapped around a waist rather than around an ellipse.

    In "surface" the difference is read per azimuth and per height and interpolated
    bilinearly, so the band tilts to the surface's slope; in "azimuth" it is one
    number per direction and the band stays vertical, riding the widest height it
    covers. Neither ever moves a vertex up or down: the band's extent is the source's.
    """
    picked = np.array(sorted(indices), dtype=int)
    strap = points_of(obj)[picked]
    angles, radius = azimuth(strap, centre_xz)
    if float(radius.min()) < 1e-9:
        raise RingError("conform gate: a strap vertex sits on the ring's own axis")
    if mode == "azimuth":
        shift, detail = azimuth_shift(strap, angles, centre_xz, surface.ridge, bins)
    else:
        shift, detail = surface_shift(strap, angles, centre_xz, surface, bins)
    towards = np.stack([(strap[:, 0] - centre_xz[0]) / radius, np.zeros(len(strap)),
                        (strap[:, 2] - centre_xz[1]) / radius], axis=1)
    travel = towards * shift[:, None]
    moved = strap + travel
    before = bin_thickness(strap, centre_xz, bins)
    after = bin_thickness(moved, centre_xz, bins)
    before_slices = slice_thickness(strap, centre_xz, bins, surface.heights)
    after_slices = slice_thickness(moved, centre_xz, bins, surface.heights)
    basis = obj.matrix_world.to_3x3().inverted()
    for at, index in enumerate(picked):
        vertex = obj.data.vertices[int(index)]
        vertex.co = vertex.co + (basis @ Vector(blender_from_runtime(travel[at])))
    obj.data.update()
    return {
        "mode": mode,
        "bins": bins,
        "vertices": int(len(picked)),
        "loudThresholdMetres": CONFORM_LOUD,
        **detail,
        "thicknessBeforeMetres": {"min": round(float(before.min()), 6),
                                  "median": round(float(np.median(before)), 6),
                                  "max": round(float(before.max()), 6)},
        "thicknessAfterMetres": {"min": round(float(after.min()), 6),
                                 "median": round(float(np.median(after)), 6),
                                 "max": round(float(after.max()), 6)},
        # A bin is a 5 degree wedge, so its inner and outer extreme are not the same
        # radial line and a steep bin reads a change the leather did not have.
        "thicknessChangeMetres": {"median": round(float(np.median(np.abs(after - before))), 6),
                                  "p90": round(float(np.percentile(np.abs(after - before), 90)), 6),
                                  "max": round(float(np.abs(after - before).max()), 6)},
        "thicknessPerSliceMetres": [[round(float(height), 6), _rounded(before_slices[level]),
                                     _rounded(after_slices[level])]
                                    for level, height in enumerate(surface.heights)],
        "bandMetres": {
            "before": [round(float(strap[:, 1].min()), 6), round(float(strap[:, 1].max()), 6)],
            "after": [round(float(moved[:, 1].min()), 6), round(float(moved[:, 1].max()), 6)],
            "heightBefore": round(float(strap[:, 1].max() - strap[:, 1].min()), 6),
            "heightAfter": round(float(moved[:, 1].max() - moved[:, 1].min()), 6)},
        "maxVertexMoveMetres": round(float(np.abs(shift).max()), 6),
    }


def _rounded(value: float) -> float | None:
    return None if not np.isfinite(value) else round(float(value), 6)


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


def kabsch(before: np.ndarray, after: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """The rotation and shift that best carry one cloud onto the other, no scale.

    The reflection the raw SVD can return is a mirrored part, which is worse than any
    residual it saves, so the determinant is forced positive.
    """
    mid_before, mid_after = before.mean(axis=0), after.mean(axis=0)
    left, _, right = np.linalg.svd((before - mid_before).T @ (after - mid_after))
    handed = np.diag([1.0, 1.0, float(np.sign(np.linalg.det(right.T @ left.T)) or 1.0)])
    rotation = right.T @ handed @ left.T
    return rotation, mid_after - rotation @ mid_before


def patch_spread(points: np.ndarray) -> float:
    """How wide the patch is across its second axis: a line is nearly zero here.

    A patch on one line pins the part's shift and nothing about its spin around that
    line, and Kabsch answers such a patch with whatever the noise says.
    """
    values = np.linalg.svd(points - points.mean(axis=0), compute_uv=False)
    return float(values[1]) / math.sqrt(len(points))


def attachment_patch(indices: np.ndarray, strap: list[int], before: np.ndarray, tree: KDTree,
                     radius: float) -> tuple[np.ndarray, bool, float]:
    """The strap vertices a part is welded to, in the frame before the strap moved."""
    touching: set[int] = set()
    nearest_distance, nearest_slot = float("inf"), 0
    for index in indices:
        point = Vector(tuple(before[int(index)]))
        for _, slot, _ in tree.find_range(point, radius):
            touching.add(slot)
        found = tree.find(point)
        if found[2] is not None and found[2] < nearest_distance:
            nearest_distance, nearest_slot = float(found[2]), found[1]
    borrowed = not touching
    if borrowed:
        touching = {nearest_slot}
    return (np.array([strap[slot] for slot in sorted(touching)], dtype=int), borrowed,
            nearest_distance)


def rigid_transport(obj, members: list[list[int]], clusters: list[list[int]], strap_at: int,
                    before: np.ndarray, displacement: np.ndarray, radius: float) -> list[dict]:
    """Every part but the strap rides it, by one rigid move each, never reshaped.

    A buckle, a pouch and a hanging sash are welded to the leather, so what that
    leather did is the whole of the answer for them - and the leather did not only
    move, it turned. The patch it is welded to is read before and after, and the
    rigid transform that best carries the patch across carries the part with it: a
    pouch hanging a hand below the strap swings out with the band it hangs from
    instead of standing off the curve the band was bent onto.

    A patch too small or all on one line says nothing about the spin, and such a part
    falls back to the patch's mean shift, which is the same rule with the rotation
    dropped. Clusters, not islands: a flap and its pouch are one part and one move.
    """
    strap = members[strap_at]
    tree = KDTree(len(strap))
    for at, index in enumerate(strap):
        tree.insert(Vector(tuple(before[index])), at)
    tree.balance()
    after = before + displacement
    moved = []
    for cluster_at, cluster in enumerate(clusters):
        indices = np.array(sorted(index for island in cluster for index in members[island]),
                           dtype=int)
        if not len(indices):
            continue
        attached, borrowed, nearest_distance = attachment_patch(indices, strap, before, tree,
                                                                radius)
        patch_before, patch_after = before[attached], after[attached]
        spread = patch_spread(patch_before) if len(attached) >= PATCH_MIN_VERTICES else 0.0
        turned = spread >= PATCH_MIN_SPREAD
        if turned:
            rotation, shift = kabsch(patch_before, patch_after)
        else:
            rotation, shift = np.eye(3), displacement[attached].mean(axis=0)
        carried = before[indices] @ rotation.T + shift
        for at, index in enumerate(indices):
            obj.data.vertices[int(index)].co = Vector(tuple(carried[at]))
        residual = np.linalg.norm(patch_before @ rotation.T + shift - patch_after, axis=1)
        travel = carried.mean(axis=0) - before[indices].mean(axis=0)
        moved.append({
            "cluster": cluster_at,
            "islands": cluster,
            "clusterVertices": int(len(indices)),
            "attachmentVertices": int(len(attached)),
            "fromNearestStrapVertex": borrowed,
            "nearestStrapMetres": round(nearest_distance, 6),
            "patchSpreadMetres": round(spread, 6),
            "rotationFitted": turned,
            "rotationDegrees": round(math.degrees(math.acos(
                float(np.clip((np.trace(rotation) - 1.0) * 0.5, -1.0, 1.0)))), 4),
            "patchResidualMetres": round(float(np.sqrt((residual ** 2).mean())), 6),
            "translationMetres": round(float(np.linalg.norm(travel)), 6),
            "translation": [round(float(value), 6) for value in runtime_from_blender(travel)],
        })
    obj.data.update()
    return moved


def transport_summary(carried: list[dict]) -> dict:
    """What the ride cost, per deformation: how far, how much spin, how well it fitted."""
    return {
        "clustersMoved": len(carried),
        "fellBackToTranslation": [entry["cluster"] for entry in carried
                                  if not entry["rotationFitted"]],
        "fromNearestStrapVertex": [entry["cluster"] for entry in carried
                                   if entry["fromNearestStrapVertex"]],
        "maxTranslationMetres": round(max((entry["translationMetres"] for entry in carried),
                                          default=0.0), 6),
        "meanTranslationMetres": round(float(np.mean([entry["translationMetres"]
                                                      for entry in carried]))
                                       if carried else 0.0, 6),
        "maxRotationDegrees": round(max((entry["rotationDegrees"] for entry in carried),
                                        default=0.0), 4),
        "maxPatchResidualMetres": round(max((entry["patchResidualMetres"] for entry in carried),
                                            default=0.0), 6),
        "table": carried,
    }


def island_clusters(points: np.ndarray, members: list[list[int]], strap_at: int,
                    radius: float) -> list[list[int]]:
    """Islands that touch are one part, and one part has to move as one thing.

    A flap sits on its pouch, a keeper loop on its pouch strap and the knot on the
    sash; clearing either half on its own opens a seam the camera looks straight
    through. The strap is no candidate: it is seated on the body and nothing may
    carry it off again.
    """
    movable = [at for at, indices in enumerate(members) if at != strap_at and indices]
    if not movable:
        return []
    owner: list[int] = []
    tree = KDTree(sum(len(members[at]) for at in movable))
    for island in movable:
        for index in members[island]:
            tree.insert(Vector(tuple(points[index])), len(owner))
            owner.append(island)
    tree.balance()
    parent = {island: island for island in movable}

    def root(at: int) -> int:
        while parent[at] != at:
            parent[at] = parent[parent[at]]
            at = parent[at]
        return at

    for island in movable:
        for index in members[island]:
            for _, found, _ in tree.find_range(Vector(tuple(points[index])), radius):
                here, other = root(island), root(owner[found])
                if here != other:
                    parent[other] = here
    grouped: dict[int, list[int]] = {}
    for island in movable:
        grouped.setdefault(root(island), []).append(island)
    return sorted((sorted(group) for group in grouped.values()),
                  key=lambda group: -sum(len(members[at]) for at in group))


def runtime_points(obj, indices: np.ndarray) -> np.ndarray:
    matrix = obj.matrix_world
    return np.array([runtime_from_blender(matrix @ obj.data.vertices[int(at)].co)
                     for at in indices], dtype=np.float64)


def depths_of(obj, indices: np.ndarray, solid: Solid) -> np.ndarray:
    matrix = obj.matrix_world
    return np.array([solid.depth(matrix @ obj.data.vertices[int(at)].co) for at in indices])


def place(obj, indices: np.ndarray, runtime: np.ndarray) -> None:
    matrix = obj.matrix_world.inverted()
    for at, index in enumerate(indices):
        obj.data.vertices[int(index)].co = matrix @ Vector(blender_from_runtime(runtime[at]))


def nearest_strap(obj, indices: np.ndarray, tree: KDTree) -> float:
    """The closest a part comes to the leather, which is how a part coming off shows."""
    return min(float(tree.find(obj.data.vertices[int(at)].co)[2]) for at in indices)


def surface_tree(points: np.ndarray, faces: list[tuple[int, ...]]) -> BVHTree:
    return BVHTree.FromPolygons([tuple(point) for point in points], faces, all_triangles=False)


def nearest_surface(tree: BVHTree, points: np.ndarray) -> float:
    """How close a part comes to a surface rather than to its vertices.

    A strap carries a vertex every few millimetres, so a vertex-to-vertex distance
    reads a part welded flat onto the leather as standing a millimetre off it.
    """
    best = float("inf")
    for point in points:
        found = tree.find_nearest(Vector(tuple(point)))
        if found[3] is not None:
            best = min(best, float(found[3]))
    return best


def strap_surface(obj, points: np.ndarray, strap: list[int]) -> BVHTree:
    """The leather's own faces, out of the joined mesh every part now shares."""
    picked = set(strap)
    return surface_tree(points, [tuple(face.vertices) for face in obj.data.polygons
                                 if all(at in picked for at in face.vertices)])


def raw_flush(islands: list, strap_at: int, limit: float) -> dict[int, float]:
    """How close every island starts to the leather, before anything has moved it.

    Only a part drawn welded to the strap can be said to have come off it later: a
    stud floating a hand away in the source was drawn floating and stays that way.
    """
    strap = islands[strap_at]
    tree = surface_tree(points_of(strap),
                        [tuple(face.vertices) for face in strap.data.polygons])
    gaps = {}
    for at, island in enumerate(islands):
        if at == strap_at:
            continue
        gap = nearest_surface(tree, points_of(island))
        if gap < limit:
            gaps[at] = gap
    return gaps


def island_gaps(obj, members: list[list[int]], strap: list[int],
                wanted: dict[int, float]) -> dict[int, float]:
    """The same measure on the fitted mesh: is the welded part still on the leather?"""
    points = points_of(obj)
    tree = strap_surface(obj, points, strap)
    return {at: nearest_surface(tree, points[np.array(members[at], dtype=int)])
            for at in sorted(wanted) if members[at]}


def worst_gap(gaps: dict[int, float], islands: list[int]) -> float | None:
    """The furthest off the leather any welded part of one cluster has come."""
    picked = [gaps[at] for at in islands if at in gaps]
    return round(max(picked), 6) if picked else None


def hinge_frame(patch: np.ndarray, centre_xz: np.ndarray) -> tuple[np.ndarray, np.ndarray,
                                                                   np.ndarray]:
    """Where a part is bolted on, and the one line it can swing about there.

    Level and along the leather. A hinge across the strap would peel the part off it
    sideways, and a hinge on the radius would swing it round the waist instead of away
    from the body, which is the only direction that empties a thigh.
    """
    pivot = patch.mean(axis=0)
    away = np.array([pivot[0] - centre_xz[0], 0.0, pivot[2] - centre_xz[1]])
    length = float(np.linalg.norm(away))
    if length < 1e-9:
        raise RingError("hinge gate: a part is bolted to the ring's own axis")
    radial = away / length
    return pivot, np.array([-radial[2], 0.0, radial[0]]), radial


def swung(points: np.ndarray, pivot: np.ndarray, axis: np.ndarray, angle: float) -> np.ndarray:
    """One rigid turn about a line, in the runtime frame."""
    offsets = points - pivot
    cos, sin = math.cos(angle), math.sin(angle)
    return (pivot + offsets * cos + np.cross(axis, offsets) * sin
            + np.outer(offsets @ axis, axis) * (1.0 - cos))


def lever_arm(point: np.ndarray, pivot: np.ndarray, axis: np.ndarray) -> float:
    offset = point - pivot
    return float(np.linalg.norm(offset - (offset @ axis) * axis))


def hinge_clearance(obj, members: list[list[int]], clusters: list[list[int]], target: Solid,
                    strap: list[int], band: Band, limit: float, margin: float, passes: int,
                    max_degrees: float) -> list[dict]:
    """Swing a buried part out on the leather it is bolted to, never off it.

    Pushing a part straight out of the waist cost the belt its hardware. The depth
    that drove the push was read across the strap's own band as well as under it, and
    inside that band a pouch back is welded to leather the conform has legitimately
    laid onto the tunic - so the whole part paid, in a centimetres-long translation,
    for a depth belonging to the strap. The band is exempt here and only what hangs
    below the leather is measured; the in-band depth is reported and left alone.

    The move is a rotation about the line the part is bolted along, so the anchor
    stays where the strap put it while the hanging end swings clear. The angle is the
    worst vertex's own depth over its own lever about that line, it is capped, and
    what is left is reported rather than chased: a part needing more than a quarter
    turn is a part drawn wrong, not a part to bend further.
    """
    leather = KDTree(len(strap))
    for at, index in enumerate(strap):
        leather.insert(obj.data.vertices[index].co, at)
    leather.balance()
    # The strap never moves here, so one snapshot answers every part's anchor.
    seated = points_of(obj)
    anchor = KDTree(len(strap))
    for at, index in enumerate(strap):
        anchor.insert(Vector(tuple(seated[index])), at)
    anchor.balance()
    ceiling = math.radians(max_degrees)
    rows = []
    for cluster_at, cluster in enumerate(clusters):
        indices = np.array(sorted(index for island in cluster for index in members[island]),
                           dtype=int)
        points = seated[indices]
        attached, borrowed, _ = attachment_patch(indices, strap, seated, anchor, ATTACH_RADIUS)
        pivot, axis, radial = hinge_frame(seated[attached], band.centre)
        # Frozen where the seat left the part, so before and after weigh the same
        # vertices: swinging out lifts a hem, and a set read again sheds its worst.
        under, within = band.below(points), band.within(points)
        over = ~(under | within)
        depths = depths_of(obj, indices, target)
        first, first_buried = float(depths[under].max(initial=0.0)), int((depths[under] > limit).sum())
        advisory, advisory_buried = (float(depths[within].max(initial=0.0)),
                                     int((depths[within] > limit).sum()))
        crown, crown_buried = (float(depths[over].max(initial=0.0)),
                               int((depths[over] > limit).sum()))
        touched = nearest_strap(obj, indices, leather)
        turned, steps, note = 0.0, [], None
        if first_buried:
            lift = np.cross(axis, points[under].mean(axis=0) - pivot)
            sense = 1.0 if float(lift @ radial) >= 0.0 else -1.0
            while (len(steps) < passes and float(depths[under].max(initial=0.0)) > limit
                   and turned < ceiling - 1e-9):
                worst = int(np.argmax(np.where(under, depths, -1.0)))
                lever = lever_arm(points[worst], pivot, axis)
                if lever < HINGE_MIN_LEVER:
                    note = "the worst vertex sits on the hinge line"
                    break
                angle = min((float(depths[worst]) + margin) / lever, ceiling - turned)
                points = swung(points, pivot, axis, sense * angle)
                place(obj, indices, points)
                turned += angle
                depths = depths_of(obj, indices, target)
                steps.append({"degrees": round(math.degrees(angle), 4),
                              "leverMetres": round(lever, 6),
                              "belowBandMaxDepthAfterMetres":
                                  round(float(depths[under].max(initial=0.0)), 6)})
        last = float(depths[under].max(initial=0.0))
        if last > limit and note is None:
            note = (f"the cap of {max_degrees:g} degrees was reached"
                    if turned >= ceiling - 1e-9 else "the pass limit was reached")
        rows.append({
            "cluster": cluster_at,
            "islands": cluster,
            "vertices": int(len(indices)),
            "belowBandVertices": int(under.sum()),
            "inBandVertices": int(within.sum()),
            "aboveBandVertices": int(over.sum()),
            "attachmentVertices": int(len(attached)),
            "fromNearestStrapVertex": borrowed,
            "hingeMetres": [round(float(value), 6) for value in pivot],
            "hingeAxis": [round(float(value), 6) for value in axis],
            "belowBandMaxDepthBeforeMetres": round(first, 6),
            "belowBandMaxDepthAfterMetres": round(last, 6),
            "belowBandDeeperThan2mmBefore": first_buried,
            "belowBandDeeperThan2mmAfter": int((depths[under] > limit).sum()),
            "inBandMaxDepthBeforeMetres": round(advisory, 6),
            "inBandMaxDepthAfterMetres": round(float(depths[within].max(initial=0.0)), 6),
            "inBandDeeperThan2mmBefore": advisory_buried,
            "inBandDeeperThan2mmAfter": int((depths[within] > limit).sum()),
            "aboveBandMaxDepthBeforeMetres": round(crown, 6),
            "aboveBandMaxDepthAfterMetres": round(float(depths[over].max(initial=0.0)), 6),
            "aboveBandDeeperThan2mmBefore": crown_buried,
            "aboveBandDeeperThan2mmAfter": int((depths[over] > limit).sum()),
            "degreesApplied": round(math.degrees(turned), 4),
            "passes": len(steps),
            "residual": note,
            "toStrapBeforeMetres": round(touched, 6),
            "toStrapAfterMetres": round(nearest_strap(obj, indices, leather), 6),
            "steps": steps,
        })
    obj.data.update()
    return rows


def island_table(profiles: list[dict], members: list[list[int]], strap_at: int,
                 transported: list[dict], cleared: list[dict], depths: np.ndarray,
                 bare_depths: np.ndarray) -> list[dict]:
    """Every island on one line: what it is, what carried it, and where it ended up."""
    carried = {island: entry for entry in transported for island in entry["islands"]}
    pushed = {island: (at, entry) for at, entry in enumerate(cleared)
              for island in entry["islands"]}
    rows = []
    for at, profile in enumerate(profiles):
        indices = np.array(members[at], dtype=int)
        row = {**profile, "island": at, "isStrap": at == strap_at,
               "joinedVertices": int(len(indices)),
               "insideDressedDeeperThan2mm": int((depths[indices] > 0.002).sum()),
               "insideBareDeeperThan2mm": int((bare_depths[indices] > 0.002).sum())}
        move = carried.get(at)
        if move:
            row.update({key: value for key, value in move.items() if key != "islands"})
        push = pushed.get(at)
        if push:
            row.update({"cluster": push[0], "hingeDegrees": push[1]["degreesApplied"]})
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
    hidden_regions = [name.strip() for name in (args.hides_regions or "").split(",") if name.strip()]
    for name in hidden_regions:
        if name not in contract["slots"]:
            raise RingError(f"hide gate: unknown region \"{name}\"")
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
    strap_at = islands.index(strap)
    # Read on the source, where nothing has moved yet: which parts were drawn welded
    # to the leather is the only ground for saying one has come off it later.
    flush = raw_flush(islands, strap_at, FLUSH_RAW)

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
    # Read on the placed piece, before anything deforms: touching islands are one part
    # for every move that follows, and the source's own contacts are what decide that.
    clusters = island_clusters(np.array([tuple(vertex.co) for vertex in
                                         fitted_object.data.vertices]),
                               members, strap_at, CLUSTER_RADIUS)

    placed_band = (float(placed_strap[:, 1].min()), float(placed_strap[:, 1].max()))
    conform_heights = np.linspace(placed_band[0], placed_band[1], CONFORM_SAMPLES)
    conformed: dict | None = None
    after_conform = before_seat
    if args.conform:
        before_conform_points = np.array([tuple(vertex.co)
                                          for vertex in fitted_object.data.vertices])
        surface, profile = surface_radii(dressed, placed_centre, placed_band, near_torso,
                                         CONFORM_BINS, CONFORM_SAMPLES, CONFORM_GAP, CONFORM_KERNEL)
        conformed = conform(fitted_object, strap_vertices, placed_centre, surface, CONFORM_BINS,
                            args.conform)
        conformed["target"] = profile
        # The hardware is welded to leather that just changed shape, so it rides the
        # conform by the same rule it rides the seat by, and before the seat runs.
        carried = rigid_transport(
            fitted_object, members, clusters, strap_at, before_conform_points,
            np.array([tuple(vertex.co) for vertex in fitted_object.data.vertices])
            - before_conform_points, ATTACH_RADIUS)
        conformed["transport"] = transport_summary(carried)
        after_conform = measure_strap(points_of(fitted_object)[strap_vertices], placed_centre,
                                      args.bins, dressed, bare)

    before_seat_points = np.array([tuple(vertex.co) for vertex in fitted_object.data.vertices])
    limited = args.seat == "strap"
    shrinkwrap = seat(fitted_object, seat_targets if args.seat == "layers" else [dressed_target],
                      SHRINKWRAP_OFFSET, STRAP_GROUP if limited else None,
                      np.array(strap_vertices, dtype=int) if limited else None)
    shrinkwrap["mode"] = args.seat
    fitted_object.vertex_groups.remove(fitted_object.vertex_groups[STRAP_GROUP])

    transported: list[dict] = []
    cleared: list[dict] = []
    gaps_seated: dict[int, float] = {}
    ring_centre_xz = placed_centre
    if limited:
        after_seat_points = np.array([tuple(vertex.co) for vertex in fitted_object.data.vertices])
        transported = rigid_transport(fitted_object, members, clusters, strap_at,
                                      before_seat_points,
                                      after_seat_points - before_seat_points, ATTACH_RADIUS)
        # The seated strap, not the placement destination, is where the waist now is.
        ring_centre_xz, _ = ring_centre(points_of(fitted_object)[strap_vertices], args.bins)
        gaps_seated = island_gaps(fitted_object, members, strap_vertices, flush)
        cleared = hinge_clearance(fitted_object, members, clusters, dressed, strap_vertices,
                                  band_edges(points_of(fitted_object)[strap_vertices],
                                             ring_centre_xz, CONFORM_BINS),
                                  CLEARANCE_DEPTH, CLEARANCE_MARGIN, CLEARANCE_PASSES,
                                  HINGE_MAX_DEGREES)

    after_points = points_of(fitted_object)
    strap_after = after_points[strap_vertices]
    after_seat = measure_strap(strap_after, placed_centre, args.bins, dressed, bare)
    seated_thickness = bin_thickness(strap_after, placed_centre, CONFORM_BINS)
    seated_slices = slice_thickness(strap_after, placed_centre, CONFORM_BINS, conform_heights)

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
    piece_regions, region_report = regions.of_glb(glb_path, str(loaded["path"]), loaded["masks"])
    # The band a hide rule reaches over the piece below is the leather's own, after
    # the conform and the seat have decided where the leather actually lies.
    hides_band = [round(float(strap_after[:, 1].min()), 6), round(float(strap_after[:, 1].max()), 6)]
    strap_profile = band_profile(strap_after, ring_centre_xz, CONFORM_BINS)
    # The conform tilts the strap by nearly its own height, so the band it hides is
    # its own edges per azimuth and not one pair of heights.
    hides_profile = {
        "centre": [round(float(ring_centre_xz[0]), 6),
                   round((hides_band[0] + hides_band[1]) / 2.0, 6),
                   round(float(ring_centre_xz[1]), 6)],
        "bins": strap_profile["bins"],
        "top": strap_profile["hideTop"],
        "bottom": strap_profile["hideBottom"],
    }

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
    gaps_final = island_gaps(fitted_object, members, strap_vertices, flush) if limited else {}
    for row in cleared:
        welded = [island for island in row["islands"] if island in flush]
        row["flushIslands"] = welded
        row["attachmentGapBeforeMetres"] = worst_gap(gaps_seated, welded)
        row["attachmentGapAfterMetres"] = worst_gap(gaps_final, welded)
    islands_table = island_table(profiles, members, strap_at, transported, cleared, depths,
                                 bare_depths)
    strap_buried = int((depths[np.array(strap_vertices, dtype=int)] > CLEARANCE_DEPTH).sum())
    clearance = {
        "mode": "hinge",
        "clusterRadiusMetres": CLUSTER_RADIUS,
        "depthLimitMetres": CLEARANCE_DEPTH,
        "marginMetres": CLEARANCE_MARGIN,
        "maxPasses": CLEARANCE_PASSES,
        "maxDegrees": HINGE_MAX_DEGREES,
        "bandBins": CONFORM_BINS,
        "ringCentreXZ": [round(float(ring_centre_xz[0]), 6), round(float(ring_centre_xz[1]), 6)],
        "clusters": len(clusters),
        "clustersTurned": sum(1 for entry in cleared if entry["passes"]),
        "maxDegreesApplied": round(max((entry["degreesApplied"] for entry in cleared),
                                       default=0.0), 4),
        # The strap is not a candidate and does not move here, so its own buried count
        # is the same on both sides of the step and belongs to both totals.
        "belowBandDeeperThan2mmBefore": sum(entry["belowBandDeeperThan2mmBefore"]
                                            for entry in cleared) + strap_buried,
        "belowBandDeeperThan2mmAfter": sum(entry["belowBandDeeperThan2mmAfter"]
                                           for entry in cleared) + strap_buried,
        # Advisory: a part welded at or above the band shares whatever the leather is
        # inside, and the leather is legitimately conformed onto the tunic.
        "inBandDeeperThan2mmAdvisory": sum(entry["inBandDeeperThan2mmAfter"] for entry in cleared),
        "aboveBandDeeperThan2mmAdvisory": sum(entry["aboveBandDeeperThan2mmAfter"]
                                              for entry in cleared),
        "residual": [entry["cluster"] for entry in cleared if entry["residual"]],
        "attachmentGapAfterMetres": worst_gap(gaps_final, sorted(flush)),
        "strapDeeperThan2mm": strap_buried,
        "strapBuriedBins": buried_bins(strap_after, placed_centre, CONFORM_BINS,
                                       depths[np.array(strap_vertices, dtype=int)],
                                       CLEARANCE_DEPTH),
        "table": cleared,
    }
    attachment = {
        "rawFlushLimitMetres": FLUSH_RAW,
        "islands": sorted(flush),
        "maxGapAfterMetres": worst_gap(gaps_final, sorted(flush)),
        "table": [{"island": at, "rawMetres": round(flush[at], 6),
                   "seatedMetres": worst_gap(gaps_seated, [at]),
                   "finalMetres": worst_gap(gaps_final, [at])} for at in sorted(flush)],
    }

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
        # One layer up the same rule bites: the leather owns the waist band, so the
        # piece below stops drawing what it tagged waist inside that band. `hidesBand`
        # is the flat extent the profile replaces, kept one release for older runtimes.
        **({"hidesRegions": hidden_regions, "hidesBand": hides_band,
            "hidesProfile": hides_profile} if hidden_regions else {}),
        "regions": piece_regions,
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
        "regions": {**region_report, "hides": hidden_regions, "band": hides_band,
                    "bandProfile": strap_profile, "hidesProfileCentre": hides_profile["centre"]},
        "islandTable": islands_table,
        "transport": {"mode": args.seat, "attachRadiusMetres": ATTACH_RADIUS,
                      "strapIsland": strap_at, "clusters": len(clusters),
                      "clusterIslands": clusters,
                      "patchMinVertices": PATCH_MIN_VERTICES,
                      "patchMinSpreadMetres": PATCH_MIN_SPREAD,
                      **transport_summary(transported)},
        "clearance": clearance,
        "attachment": attachment,
        "conformMode": args.conform,
        "conform": conformed,
        "strapBeforeSeat": before_seat,
        "strapAfterConform": after_conform,
        "strapAfterSeat": after_seat,
        "strapThicknessAfterSeatMetres": {
            "min": round(float(seated_thickness.min()), 6),
            "median": round(float(np.median(seated_thickness)), 6),
            "max": round(float(seated_thickness.max()), 6),
            "perSlice": [[round(float(height), 6), _rounded(seated_slices[level])]
                         for level, height in enumerate(conform_heights)]},
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
    parser.add_argument("--hides-regions", dest="hides_regions", default="",
                        help="contract regions this piece hides on the pieces below it, "
                             "inside its own strap band")
    parser.add_argument("--weights", choices=("transfer", "stiff", "rigid"), default="stiff")
    parser.add_argument("--yaw", type=int, choices=(0, 180), default=0)
    parser.add_argument("--bins", type=int, default=AZIMUTH_BINS)
    parser.add_argument("--passes", type=int, default=3)
    parser.add_argument("--seat", choices=("strap", "merged", "layers"), default="strap")
    parser.add_argument("--conform", choices=("surface", "azimuth"), default="surface",
                        help="surface follows the body around and up the band; azimuth keeps "
                             "the band vertical on the widest height it covers")
    parser.add_argument("--no-conform", dest="conform", action="store_const", const=None,
                        help="place by the ellipse alone and leave the cross section unread")
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
