from __future__ import annotations

import math

import bpy
import numpy as np
from mathutils import Vector

from mathutils.bvhtree import BVHTree

from fit.frame import blender_from_runtime, rounded, runtime_from_blender


AXIS = {"X": 0, "Y": 1, "Z": 2}
HUG_GROUP = "GearHug"
RAY_AXES = (Vector((1.0, 0.0, 0.0)), Vector((0.0, 1.0, 0.0)), Vector((0.0, 0.0, 1.0)))
# Step past each hit before casting on, or the ray re-hits the face it just left.
RAY_STEP = 1e-5
RAY_HIT_LIMIT = 256
# Deeper than this a vertex is buried rather than caught in a crease of the skin.
DEEP_INSIDE = 0.005
# One pass only moves a vertex to the nearest surface, which for a sleeve buried in an
# arm is the torso, so it takes several to walk out of overlapping shells.
OUTSIDE_PASSES = 8
# Cross sections a limb band is measured as. Fewer and a cuff's own wobble is the axis.
LIMB_SLICES = 8
# What one region vertex left outside the piece costs the roll score, as metres of
# mean distance. Enclosure is the question a glove is judged by, so it outweighs
# hugging: a glove tight against the back of a hand the fingers hang out of is wrong.
ROLL_OUTSIDE_PENALTY = 0.05
# A region vertex the piece's shell cannot answer for at all, as a distance.
ROLL_MISS_METRES = 1.0
# How far the seating score may pull the roll off the thumb prior. A hand is near
# enough symmetric that the score alone picks the mirror; the thumb says which way
# round the piece goes and the score only trims where in that neighbourhood it sits.
ROLL_REFINE_DEGREES = 20.0


def _runtime_points(obj) -> np.ndarray:
    return np.array([runtime_from_blender(obj.matrix_world @ vertex.co) for vertex in obj.data.vertices],
                    dtype=np.float64)


def _value(bounds: tuple[np.ndarray, np.ndarray], choice: str, axis: int) -> float:
    low, high = bounds
    if choice == "min":
        return float(low[axis])
    if choice == "max":
        return float(high[axis])
    return float((low[axis] + high[axis]) * 0.5)


class Surface:
    """The body as an inside test, and as the part of itself a viewer can still see.

    A nearest-point sign test reads the wrong side inside every concavity - an
    ear, an armpit - because the closest face there points away from the notch.
    Ray parity does not care about local shape, so three axis casts and a
    majority vote survive a face the ray happens to graze edge on.

    Hidden faces stay in the tree that answers "which way is out" and leave the
    one that answers "was that seen", which is the rule the clip gate measures by.

    The rim rule: a triangle is gone from the drawn body only when all three of its
    vertices are hidden, but one hidden corner is enough to stop it being counted -
    a rim triangle is half under the garment, and a piece resting in it is resting
    on skin the garment already ate.
    """

    def __init__(self, meshes: list, hidden: dict[str, set[int]] | None = None) -> None:
        hidden = hidden or {}
        points: list[tuple[float, float, float]] = []
        every: list[tuple[int, int, int]] = []
        counted: list[tuple[int, int, int]] = []
        for obj in meshes:
            base = len(points)
            matrix = obj.matrix_world
            points.extend(tuple(matrix @ vertex.co) for vertex in obj.data.vertices)
            covered = hidden.get(obj.name, set())
            for face in obj.data.polygons:
                corners = list(face.vertices)
                for at in range(1, len(corners) - 1):
                    corner_ids = (corners[0], corners[at], corners[at + 1])
                    triangle = tuple(base + corner for corner in corner_ids)
                    every.append(triangle)
                    if not any(corner in covered for corner in corner_ids):
                        counted.append(triangle)
        if not every:
            raise RuntimeError("surface gate: the body has no faces to measure against")
        self.every = BVHTree.FromPolygons(points, every, all_triangles=True)
        self.seen = (self.every if len(counted) == len(every)
                     else BVHTree.FromPolygons(points, counted, all_triangles=True))

    def _crossings(self, origin: Vector, direction: Vector) -> int:
        crossings = 0
        at = origin.copy()
        while crossings <= RAY_HIT_LIMIT:
            hit, _, _, _ = self.every.ray_cast(at, direction)
            if hit is None:
                return crossings
            crossings += 1
            at = hit + direction * RAY_STEP
        raise RuntimeError("inside gate: a ray crossed the body more times than a body can be crossed")

    def measure(self, point: np.ndarray) -> tuple[bool, float]:
        """Whether a runtime-frame point is inside the body, and its distance to the skin."""
        local = Vector(blender_from_runtime(point))
        nearest, _, _, distance = self.every.find_nearest(local)
        if nearest is None:
            return False, float("inf")
        odd = sum(1 for direction in RAY_AXES if self._crossings(local, direction) % 2 == 1)
        return odd >= 2, float(distance)

    def probe(self, point: np.ndarray) -> tuple[float, bool]:
        """How deep a viewer sees the piece sink in, and whether the two tests disagreed.

        Parity alone calls a point a centimetre off a shell with sockets - an eye, the
        gap under hair - inside, so the nearest counted triangle's own normal has to
        agree before a hit is a hit. The disagreements are counted rather than dropped:
        a piece that racks them up is sitting somewhere the body cannot be measured.
        """
        local = Vector(blender_from_runtime(point))
        crossed, distance = self.measure(point)
        nearest, normal, _, shown = self.seen.find_nearest(local)
        if nearest is None or shown > distance + 1e-9:
            return 0.0, False
        behind = (local - nearest).dot(normal) < 0.0
        if crossed and behind:
            return distance, False
        return 0.0, crossed != behind

    def penetration(self, point: np.ndarray) -> float:
        return self.probe(point)[0]


def _scale(original: np.ndarray, region_bounds, rule: dict, span: dict | None) -> float:
    """How much the source grows to sit on the region it covers."""
    factor = float(span["factor"] if span else rule["span"]["factor"])
    span_axis = AXIS[span["axis"] if span else rule["span"]["axis"]]
    extent = float(original[:, span_axis].max() - original[:, span_axis].min())
    # A slot's span measures the region it sits on; an override measures the piece
    # against two landmarks instead, for a garment the region has no extent for.
    target_extent = (span["metres"] if span
                     else float(region_bounds[1][span_axis] - region_bounds[0][span_axis]))
    if extent <= 1e-9 or target_extent <= 1e-9:
        raise RuntimeError("alignment gate: the piece or body reference has zero span")
    return target_extent * factor / extent


def _triangles(obj) -> list[tuple[int, int, int]]:
    faces = []
    for face in obj.data.polygons:
        corners = list(face.vertices)
        faces.extend((corners[0], corners[at], corners[at + 1]) for at in range(1, len(corners) - 1))
    return faces


def _turn_about(points: np.ndarray, axis: np.ndarray, pivot: np.ndarray, angle: float) -> np.ndarray:
    relative = points - pivot
    cosine, sine = math.cos(angle), math.sin(angle)
    return (pivot + relative * cosine + np.cross(np.broadcast_to(axis, relative.shape), relative) * sine
            + np.outer(relative @ axis, axis) * (1.0 - cosine))


def _encloses(tree: BVHTree, point: np.ndarray) -> bool:
    """Ray parity against a piece shell: is this body vertex inside the garment?"""
    odd = 0
    for direction in RAY_AXES:
        crossings = 0
        at = Vector((float(point[0]), float(point[1]), float(point[2])))
        while crossings <= RAY_HIT_LIMIT:
            hit, _, _, _ = tree.ray_cast(at, direction)
            if hit is None:
                break
            crossings += 1
            at = hit + direction * RAY_STEP
        if crossings % 2 == 1:
            odd += 1
    return odd >= 2


def _roll(points: np.ndarray, obj, reference: np.ndarray, roll: dict,
          anchor, step: float) -> tuple[np.ndarray, dict]:
    """Turn the piece about its bone until it wraps the region the way a glove does.

    A source is modelled in whatever pose the concept was drawn in, and a glove drawn
    back-of-hand to the viewer arrives rolled a quarter turn off a hand that hangs
    palm to thigh: the fingers come out through the palm. Nothing in scale or the
    anchors can see that - the bounding box is nearly the same either way - so the
    roll is searched for rather than assumed, and scored on the only thing that
    distinguishes it, whether the piece ends up around the region or beside it.

    The piece stays put and the region is carried into its frame instead, so one
    shell serves every candidate rather than one per angle.
    """
    axis = np.array(roll["direction"], dtype=np.float64)
    axis = axis / np.linalg.norm(axis)
    # A slot's region runs further up the limb than the piece does - `hands` reaches
    # mid forearm - and region vertices the piece never reaches score the same at
    # every angle while burying the difference between them. The span is taken once,
    # off the unrolled piece, so no candidate can improve itself by covering less.
    span = _within_span(points, reference, axis)
    centre = span.mean(axis=0)
    tree = BVHTree.FromPolygons([tuple(float(value) for value in point) for point in points],
                                _triangles(obj), all_triangles=True)

    def seat(moved: np.ndarray) -> np.ndarray:
        """The anchors again, minus the axis they turn about.

        A bounding box turns with the piece, so re-anchoring along the axis moves the
        stations a tube measures by centimetres per angle. Where the piece sits along
        the limb was settled before the roll, and the tube's own stretch places it.
        """
        shift = anchor(moved)
        return shift - axis * float(shift @ axis)

    prior = roll.get("prior")
    prior_degrees = None
    piece_thumb = body_thumb = None
    if prior:
        piece_thumb = _across(np.asarray(prior["piece"], dtype=np.float64), axis)
        body_thumb = _across(np.asarray(prior["body"], dtype=np.float64), axis)
        prior_degrees = math.degrees(math.atan2(float(axis @ np.cross(piece_thumb, body_thumb)),
                                                float(piece_thumb @ body_thumb))) % 360.0

    scored = []
    for degrees in range(0, 360, max(1, int(round(step)))):
        angle = math.radians(degrees)
        moved = _turn_about(points, axis, centre, angle)
        shift = seat(moved)
        # Rolling the piece and measuring the region against it is the same as
        # carrying the region the other way and measuring against the piece as built.
        carried = _turn_about(span - shift, axis, centre, -angle)
        distances = []
        outside = 0
        for point in carried:
            nearest, _, _, distance = tree.find_nearest(Vector((float(point[0]), float(point[1]), float(point[2]))))
            distances.append(float(distance) if nearest is not None else ROLL_MISS_METRES)
            if not _encloses(tree, point):
                outside += 1
        fraction = outside / max(1, len(carried))
        entry = {"degrees": degrees,
                 "meanDistanceMetres": round(float(np.mean(distances)), 6),
                 "outsideFraction": round(fraction, 6),
                 "score": round(float(np.mean(distances)) + fraction * ROLL_OUTSIDE_PENALTY, 6)}
        if prior_degrees is not None:
            entry["fromPriorDegrees"] = round(abs((degrees - prior_degrees + 180.0) % 360.0 - 180.0), 3)
        scored.append(entry)

    allowed = [entry for entry in scored
               if entry.get("fromPriorDegrees", 0.0) <= ROLL_REFINE_DEGREES]
    if not allowed:
        raise RuntimeError("thumb gate: no roll step lands within the thumb prior's window")
    order = sorted(allowed, key=lambda entry: (entry["score"], entry["degrees"]))
    best = order[0]
    second = order[1] if len(order) > 1 else order[0]
    at_zero = next(entry for entry in scored if entry["degrees"] == 0)
    angle = math.radians(best["degrees"])
    rolled = _turn_about(points, axis, centre, angle)
    rolled = rolled + seat(rolled)
    measured = {
        "bone": roll["bone"],
        "axis": rounded(axis),
        "scoredRegionVertices": int(len(span)),
        "stepDegrees": float(step),
        "chosenDegrees": best["degrees"],
        "candidates": len(scored),
        "best": best,
        "secondBest": second,
        "atZero": at_zero,
    }
    if prior_degrees is not None:
        measured["prior"] = {
            "degrees": round(prior_degrees, 3),
            "windowDegrees": ROLL_REFINE_DEGREES,
            "refinedDegrees": round((best["degrees"] - prior_degrees + 180.0) % 360.0 - 180.0, 3),
            "pieceThumb": rounded(piece_thumb),
            "bodyThumb": rounded(body_thumb),
            "candidates": len(allowed),
        }
    return rolled, measured


def _reached(points: np.ndarray, reference: np.ndarray) -> np.ndarray:
    """The region a piece could hold: its vertices inside the piece's own box."""
    low, high = points.min(axis=0), points.max(axis=0)
    chosen = reference[np.all((reference >= low) & (reference <= high), axis=1)]
    return chosen if len(chosen) >= 8 else reference


def _enclose(points: np.ndarray, obj, reference: np.ndarray, settings: dict,
             anchor) -> tuple[np.ndarray, dict]:
    """Grow the piece until the region is inside it, or until the ceiling says stop.

    A glove scaled to the region's extent along one axis can end up shorter than the
    hand, because its cuff spends the budget the fingers needed. What is measured is
    the body region inside the piece shell, which for a closed garment around a limb
    is a well posed question - the reverse of growing a piece until its own vertices
    leave the body, which is not, since a shell one centimetre off the skin still
    reads as inside by parity.

    Uniform growth about the anchored end, so the fingertips stay put and the cuff
    travels. One shell answers every step: scaling the piece by k is the same as
    dividing the region by k.
    """
    target = float(settings["fraction"])
    step = float(settings["step"])
    ceiling = float(settings["maxGrow"])
    tree = BVHTree.FromPolygons([tuple(float(value) for value in point) for point in points],
                                _triangles(obj), all_triangles=True)
    chosen = settings.get("region")
    chosen = reference if chosen is None else np.asarray(chosen, dtype=np.float64)

    grow = 1.0
    steps = []
    placed = points
    while True:
        moved = points * grow
        shift = anchor(moved)
        carried = (chosen - shift) / grow
        inside = sum(1 for point in carried if _encloses(tree, point))
        fraction = inside / max(1, len(chosen))
        steps.append({"scale": round(grow, 6), "insideFraction": round(fraction, 6)})
        placed = moved + shift
        if fraction >= target or grow * (1.0 + step) > ceiling:
            break
        grow *= 1.0 + step
    return placed, {
        "bone": settings.get("bone", ""),
        "fraction": target,
        "step": step,
        "maxGrow": ceiling,
        "scoredRegionVertices": int(len(chosen)),
        "chosenScale": steps[-1]["scale"],
        "insideFractionAtOne": steps[0]["insideFraction"],
        "insideFractionChosen": steps[-1]["insideFraction"],
        "reachedTarget": steps[-1]["insideFraction"] >= target,
        "steps": steps,
    }


def _across(direction: np.ndarray, axis: np.ndarray) -> np.ndarray:
    """A direction flattened onto the plane across the limb, where a roll can see it."""
    flat = direction - axis * float(direction @ axis)
    length = float(np.linalg.norm(flat))
    if length < 1e-9:
        raise RuntimeError("thumb gate: the thumb direction runs along the limb axis")
    return flat / length


def _frame(axis: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """Two axes across the limb, so a slice can be measured and scaled in its own plane."""
    seed = np.array([0.0, 0.0, 1.0]) if abs(axis[2]) < 0.9 else np.array([1.0, 0.0, 0.0])
    across = np.cross(axis, seed)
    across = across / np.linalg.norm(across)
    return across, np.cross(axis, across)


def _neck(points: np.ndarray, along: np.ndarray, frame, low: float, high: float,
          slices: int = 24) -> float:
    """Where a garment is narrowest between its ends: a glove's wrist, a boot's ankle.

    The ends are excluded because an open rim and a fingertip are both narrow, and
    neither is the waist the stretch has to pin.

    Each slice is measured about its own centroid, not about the limb axis, so the
    station a roll about that axis finds is the same station: a piece turning about
    a line it does not sit on changes its distance to that line and nothing else.
    """
    across, up = frame
    edges = np.linspace(low, high, slices + 1)
    best, at = None, (low + high) * 0.5
    for index in range(slices):
        if not 0.2 <= (index + 0.5) / slices <= 0.8:
            continue
        chosen = points[(along >= edges[index]) & (along <= edges[index + 1])]
        if len(chosen) < 8:
            continue
        section = np.stack([chosen @ across, chosen @ up], axis=1)
        radius = float(np.mean(np.linalg.norm(section - section.mean(axis=0), axis=1)))
        if best is None or radius < best:
            best, at = radius, float((edges[index] + edges[index + 1]) * 0.5)
    return at


def _remap(values: np.ndarray, source: list[float], target: list[float]) -> np.ndarray:
    """Piecewise linear along the axis, so fingers stretch without dragging the cuff."""
    moved = np.empty_like(values)
    for index in range(len(source) - 1):
        low, high = source[index], source[index + 1]
        span = high - low
        scale = (target[index + 1] - target[index]) / span if abs(span) > 1e-9 else 1.0
        first, last = index == 0, index == len(source) - 2
        chosen = ((values >= low) | first) & ((values <= high) | last)
        moved[chosen] = target[index] + (values[chosen] - low) * scale
    return moved


def _tube(points: np.ndarray, reference: np.ndarray, tube: dict, clearance: float) -> tuple[np.ndarray, dict]:
    """Deform the piece onto the limb it is worn on, along the limb and around it.

    One source has to fit every body the game grows, and races differ in hand and
    limb size, so a piece cannot be scaled uniformly onto a body and then have the
    shrinkwrap argue with the result: a glove scaled to reach the wrist has fingers
    the wrong length, and growing it to cover them turns the cuff into a bell.

    So the piece is stretched piecewise along the limb axis until its own stations -
    fingertip, wrist, cuff - sit on the body's, and then widened slice by slice until
    each cross section clears the body it holds. The slice factors are smoothed along
    the axis because a factor that jumps between slices is a ridge in the silhouette.

    Each slice is carried onto the body's own cross section as well as widened, so a
    limb that turns at its joint - a forearm leaves this wrist 11.5 degrees off the
    hand - is followed rather than approximated by the axis it was measured on.
    """
    axis = np.array(tube["axis"], dtype=np.float64)
    axis = axis / np.linalg.norm(axis)
    origin = np.array(tube["origin"], dtype=np.float64)
    across, up = _frame(axis)
    relative = points - origin
    along = relative @ axis
    body_along = (reference - origin) @ axis
    report: dict = {}

    stretch = tube.get("stretch")
    if stretch is not None:
        tips = np.asarray(stretch["tipRegion"], dtype=np.float64)
        waist = float((np.asarray(stretch["waistPoint"], dtype=np.float64) - origin) @ axis)
        body = [float(body_along.min()), waist, float(((tips - origin) @ axis).max())]
        piece = [float(along.min()), 0.0, float(along.max())]
        piece[1] = _neck(relative, along, (across, up), piece[0], piece[2])
        if not (piece[0] < piece[1] < piece[2] and body[0] < body[1] < body[2]):
            raise RuntimeError(f"tube gate: stations out of order, piece {piece} body {body}")
        along = _remap(along, piece, body)
        relative = relative + np.outer(along - (relative @ axis), axis)
        report["stations"] = {"piece": [round(value, 6) for value in piece],
                              "body": [round(value, 6) for value in body],
                              "stretch": [round((body[at + 1] - body[at]) / (piece[at + 1] - piece[at]), 6)
                                          for at in range(2)]}

    step = float(tube["sliceMetres"])
    low, high = float(along.min()), float(along.max())
    count = max(1, int(math.ceil((high - low) / step)))
    edges = np.linspace(low, high, count + 1)
    centres = (edges[:-1] + edges[1:]) * 0.5
    lanes = np.stack([relative @ across, relative @ up], axis=1)
    skin_lanes = np.stack([(reference - origin) @ across, (reference - origin) @ up], axis=1)
    factors = np.ones((count, 2))
    middles = np.zeros((count, 2))
    shifts = np.zeros((count, 2))
    for index in range(count):
        chosen = (along >= edges[index]) & (along <= edges[index + 1])
        held = (body_along >= edges[index]) & (body_along <= edges[index + 1])
        if chosen.sum() < 4:
            continue
        mine = lanes[chosen]
        middles[index] = (mine.max(axis=0) + mine.min(axis=0)) * 0.5
        if held.sum() < 4:
            continue
        theirs = skin_lanes[held]
        shifts[index] = (theirs.max(axis=0) + theirs.min(axis=0)) * 0.5 - middles[index]
        factors[index] = np.maximum(1.0, (theirs.max(axis=0) - theirs.min(axis=0) + 2.0 * clearance)
                                    / np.maximum(mine.max(axis=0) - mine.min(axis=0), 1e-9))

    smooth = max(1, int(tube.get("smooth", 3)))
    if smooth > 1 and count > 1:
        pad = smooth // 2
        kernel = np.ones(smooth) / smooth
        factors, middles, shifts = (
            np.stack([np.convolve(np.pad(strip, ((pad, pad), (0, 0)), mode="edge")[:, lane], kernel,
                                  mode="valid")[:count] for lane in range(2)], axis=1)
            for strip in (factors, middles, shifts))

    weight = np.ones(len(points))
    band = tube.get("band")
    if band:
        fraction = (along - low) / max(high - low, 1e-9)
        weight = np.array([_band_weight(value, [list(band)], float(tube.get("fade", 0.0)))
                           for value in fraction])

    def sampled(strip: np.ndarray) -> np.ndarray:
        return np.stack([np.interp(along, centres, strip[:, lane]) for lane in range(2)], axis=1)

    scaled = 1.0 + (sampled(factors) - 1.0) * weight[:, None]
    # Widened about the slice's own centre and carried onto the limb's, because
    # scaling an off-centre cuff about the axis only throws it further off.
    middle = sampled(middles)
    placed_lanes = (lanes - middle) * scaled + middle + sampled(shifts) * weight[:, None]
    radial = np.outer(placed_lanes[:, 0], across) + np.outer(placed_lanes[:, 1], up)
    report["slices"] = count
    report["sliceMetres"] = step
    report["smooth"] = smooth
    report["radialFactorMin"] = round(float(factors.min()), 6)
    report["radialFactorMax"] = round(float(factors.max()), 6)
    report["radialFactorMean"] = round(float(factors.mean()), 6)
    report["centreShiftMaxMetres"] = round(float(np.abs(shifts).max()), 6)
    return origin + np.outer(along, axis) + radial, report


def _within_span(points: np.ndarray, reference: np.ndarray, axis: np.ndarray) -> np.ndarray:
    """The region a piece reaches: its vertices between the piece's own ends along a bone."""
    along = points @ axis
    reach = reference @ axis
    chosen = reference[(reach >= float(along.min())) & (reach <= float(along.max()))]
    return chosen if len(chosen) >= 8 else reference


def _straighten(points: np.ndarray, limb: dict) -> tuple[np.ndarray, dict]:
    """Swing the piece's limb section onto the bone that carries it.

    A source is modelled standing on its own: this boot's shaft rises vertically,
    and this body's shin leans 5.9 degrees inward, so the shaft stood 4.8cm off the
    calf and the outside pass wrapped it onto the leg rather than correcting it.
    The band is turned and seated onto the bone line, faded to nothing below, so
    the part the anchors placed - a boot's sole on the ground - never moves.

    A turn alone is not enough and measurably worse: the misalignment is a 1.9cm
    offset at the ankle as well as a lean, and rotating without seating leaves the
    shaft leaning correctly through the wrong place.
    """
    direction = np.array(limb["direction"], dtype=np.float64)
    direction = direction / np.linalg.norm(direction)
    band = [float(value) for value in limb["band"]]
    along = points @ direction
    low, high = float(along.min()), float(along.max())
    fraction = (along - low) / max(high - low, 1e-9)
    chosen = (fraction >= band[0]) & (fraction <= band[1])
    edges = np.linspace(float(along[chosen].min()), float(along[chosen].max()), LIMB_SLICES + 1) \
        if int(chosen.sum()) else np.zeros(LIMB_SLICES + 1)
    centroids = []
    for at in range(LIMB_SLICES):
        below = along <= edges[at + 1] if at == LIMB_SLICES - 1 else along < edges[at + 1]
        cross = chosen & (along >= edges[at]) & below
        if int(cross.sum()) >= 4:
            centroids.append(points[cross].mean(axis=0))
    if len(centroids) < 2:
        raise RuntimeError(f"limb gate: band {band} on {limb['bone']} has no cross sections to "
                           "measure an axis from")
    bottom, top = centroids[0], centroids[-1]
    axis = top - bottom
    length = float(np.linalg.norm(axis))
    if length <= 1e-9:
        raise RuntimeError(f"limb gate: band {band} on {limb['bone']} has no extent")
    axis = axis / length
    if float(axis @ direction) < 0.0:
        direction = -direction

    weight = np.array([_band_weight(value, [band], float(limb["fade"])) for value in fraction])
    angle = math.acos(float(np.clip(axis @ direction, -1.0, 1.0)))
    turn = np.cross(axis, direction)
    scale = float(np.linalg.norm(turn))
    moved = points
    if scale > 1e-9 and angle > 1e-6:
        turn = turn / scale
        relative = moved - bottom
        turned = (angle * weight)[:, None]
        cosine, sine = np.cos(turned), np.sin(turned)
        moved = bottom + (relative * cosine
                          + np.cross(np.broadcast_to(turn, relative.shape), relative) * sine
                          + np.outer(relative @ turn, turn) * (1.0 - cosine))
    joint = np.array(limb["joint"], dtype=np.float64)
    seat = joint + direction * float((bottom - joint) @ direction) - bottom
    moved = moved + weight[:, None] * seat
    return moved, {
        "bone": limb["bone"],
        "band": band,
        "fade": float(limb["fade"]),
        "correctionDegrees": round(math.degrees(angle), 4),
        "seatMetres": rounded(seat),
        "pieceAxis": rounded(axis),
        "boneDirection": rounded(direction),
        "bandVertices": int(chosen.sum()),
    }


def align(obj, reference: np.ndarray, rule: dict, surface: Surface, side: str | None = None,
          span: dict | None = None, yaw: int = 0, limb: dict | None = None,
          roll: dict | None = None, tube: dict | None = None,
          enclose: dict | None = None) -> dict:
    """Place the piece on the region it covers, at the yaw the caller asked for.

    The fitter used to vote between 0 and 180 by counting vertices inside the body,
    and a boot is nearly symmetric enough for that vote to come out backwards. Every
    source faces +Z by contract, so the yaw is told, not guessed; both counts stay in
    the report as a diagnostic, alongside how much of the piece lands inside the body
    before shrinkwrap corrects it.
    """
    original = _runtime_points(obj)
    region_bounds = (reference.min(axis=0), reference.max(axis=0))
    scale = _scale(original, region_bounds, rule, span)

    def anchor(points: np.ndarray) -> np.ndarray:
        piece_bounds = (points.min(axis=0), points.max(axis=0))
        translation = np.zeros(3)
        for axis_name, rules in rule["anchors"].items():
            axis = AXIS[axis_name]
            offset = float(rules["offset"])
            if side and axis_name == "X":
                offset *= 1.0 if side == "L" else -1.0
            translation[axis] = (_value(region_bounds, rules["body"], axis) + offset
                                 - _value(piece_bounds, rules["piece"], axis))
        return translation

    turned: dict = {}

    def place(turn: int, at: float) -> tuple[int, float, np.ndarray, np.ndarray]:
        points = original.copy()
        if turn:
            points[:, 0] *= -1.0
            points[:, 2] *= -1.0
        points *= at
        translation = anchor(points)
        points += translation
        if limb:
            # The band fades to nothing before the anchored end, so the anchors that
            # placed the piece still hold and re-applying them would undo the swing.
            points, turned[turn] = _straighten(points, limb)
        distances = [surface.measure(point) for point in points]
        return (sum(1 for is_inside, _ in distances if is_inside),
                sum(distance for _, distance in distances) / max(1, len(distances)),
                points, translation,
                sum(1 for is_inside, depth in distances if is_inside and depth > DEEP_INSIDE))

    candidates = {turn: place(turn, scale) for turn in (0, 180)}
    inside, mean, points, translation, deep = candidates[yaw]
    rolled = None
    tubed = None
    grown = None
    if roll:
        points, rolled = _roll(points, obj, reference, roll, anchor, float(roll["stepDegrees"]))
    if tube:
        # The stations are the placement, so the anchors are not re-applied over them.
        points, tubed = _tube(points, reference, tube, float(tube["clearance"]))
    if enclose:
        points, grown = _enclose(points, obj, reference, enclose, anchor)
    if roll or tube or enclose:
        distances = [surface.measure(point) for point in points]
        inside = sum(1 for is_inside, _ in distances if is_inside)
        mean = sum(distance for _, distance in distances) / max(1, len(distances))
        deep = sum(1 for is_inside, depth in distances if is_inside and depth > DEEP_INSIDE)
    inverse = obj.matrix_world.inverted()
    for vertex, point in zip(obj.data.vertices, points):
        vertex.co = inverse @ Vector(blender_from_runtime(point))
    obj.data.update()

    final_bounds = (points.min(axis=0), points.max(axis=0))
    residuals = {}
    for axis_name, anchor in rule["anchors"].items():
        axis = AXIS[axis_name]
        offset = float(anchor["offset"])
        if side and axis_name == "X":
            offset *= 1.0 if side == "L" else -1.0
        expected = _value(region_bounds, anchor["body"], axis) + offset
        residuals[axis_name] = round(abs(_value(final_bounds, anchor["piece"], axis) - expected), 9)
    measured = {
        "scale": round(scale, 6),
        "yawDegrees": yaw,
        "translation": rounded(translation),
        "insideVerticesBeforeShrinkwrap": inside,
        "insideFractionBeforeShrinkwrap": round(inside / max(1, len(original)), 6),
        # Parity counts a vertex a tenth of a millimetre into a crease the same as one
        # buried in a skull; the deep count is the one that says "reshaped".
        "deepInsideVerticesBeforeShrinkwrap": deep,
        "deepInsideFractionBeforeShrinkwrap": round(deep / max(1, len(original)), 6),
        "meanSurfaceDistanceMetres": round(mean, 6),
        # Diagnostics only. They used to decide the yaw and they decided it wrong.
        "insideVerticesByYaw": {str(turn): value[0] for turn, value in candidates.items()},
        "meanSurfaceDistanceByYaw": {str(turn): round(value[1], 6) for turn, value in candidates.items()},
        "anchorResidualMetres": residuals,
    }
    if span:
        measured["spanOverride"] = {"axis": span["axis"], "from": span["from"], "to": span["to"],
                                    "metres": round(span["metres"], 6), "factor": span["factor"]}
    if limb:
        measured["limb"] = turned[yaw]
    if rolled:
        measured["roll"] = rolled
    if tubed:
        measured["tube"] = tubed
    if grown:
        measured["enclose"] = grown
    return measured


def decimate(objects: list, maximum: int) -> dict:
    before = sum(sum(max(0, len(face.vertices) - 2) for face in obj.data.polygons) for obj in objects)
    ratio = min(1.0, maximum / before) if before else 1.0
    if ratio < 1.0:
        for obj in objects:
            bpy.context.view_layer.objects.active = obj
            modifier = obj.modifiers.new("Gear triangle budget", "DECIMATE")
            modifier.decimate_type = "COLLAPSE"
            modifier.ratio = ratio
            bpy.ops.object.modifier_apply(modifier=modifier.name)
    after = sum(sum(max(0, len(face.vertices) - 2) for face in obj.data.polygons) for obj in objects)
    return {"trianglesBefore": before, "trianglesAfter": after, "ratio": round(ratio, 6)}


def _apply_shrinkwrap(obj, target, clearance: float, vertex_group: str = "", outside_surface: bool = False) -> int:
    before = [vertex.co.copy() for vertex in obj.data.vertices]
    bpy.context.view_layer.objects.active = obj
    modifier = obj.modifiers.new("Gear surface clearance", "SHRINKWRAP")
    modifier.target = target
    modifier.wrap_method = "NEAREST_SURFACEPOINT"
    modifier.wrap_mode = "OUTSIDE_SURFACE" if outside_surface else "OUTSIDE"
    modifier.offset = clearance
    modifier.vertex_group = vertex_group
    bpy.ops.object.modifier_apply(modifier=modifier.name)
    return sum(1 for old, vertex in zip(before, obj.data.vertices) if (old - vertex.co).length > 1e-7)


def _band_weight(value: float, bands: list, fade: float) -> float:
    best = 0.0
    for low, high in bands:
        if low <= value <= high:
            best = 1.0
        elif fade > 0 and low - fade < value < low:
            t = (value - (low - fade)) / fade
            best = max(best, t * t * (3.0 - 2.0 * t))
        elif fade > 0 and high < value < high + fade:
            t = ((high + fade) - value) / fade
            best = max(best, t * t * (3.0 - 2.0 * t))
    return best


def shrinkwrap(objects: list, target, slot: dict, surface: Surface, span: dict | None = None) -> dict:
    clearance = float(slot["clearance"])
    total = max(1, sum(len(obj.data.vertices) for obj in objects))
    report = {"pieceVertices": total, "outsidePasses": [], "wholeMovedVertices": 0,
              "hugSelectedVertices": 0, "hugMovedVertices": 0}
    for _ in range(OUTSIDE_PASSES):
        moved = sum(_apply_shrinkwrap(obj, target, clearance) for obj in objects)
        inside = sum(1 for obj in objects for point in _runtime_points(obj)
                     if surface.penetration(point) > 0.0)
        report["outsidePasses"].append({"movedVertices": moved,
                                        "movedFraction": round(moved / total, 6),
                                        "insideAfter": inside})
        report["wholeMovedVertices"] += moved
        if inside == 0:
            break

    for obj in objects:
        points = _runtime_points(obj)
        axis = AXIS[span["axis"] if span else slot["align"]["span"]["axis"]]
        low, high = points[:, axis].min(), points[:, axis].max()
        extent = max(float(high - low), 1e-9)
        group = obj.vertex_groups.get(HUG_GROUP) or obj.vertex_groups.new(name=HUG_GROUP)
        selected = []
        for vertex, point in zip(obj.data.vertices, points):
            local = target.matrix_world.inverted() @ (obj.matrix_world @ vertex.co)
            found, hit, _, _ = target.closest_point_on_mesh(local)
            distance = float((local - hit).length) if found else float("inf")
            fraction = float((point[axis] - low) / extent)
            weight = _band_weight(fraction, slot["hug"]["bands"], float(slot["hug"]["fade"]))
            if distance <= float(slot["hug"]["reach"]) and weight > 0:
                group.add([vertex.index], weight, "REPLACE")
                selected.append(vertex.index)
        report["hugSelectedVertices"] += len(selected)
        if selected:
            report["hugMovedVertices"] += _apply_shrinkwrap(obj, target, clearance, HUG_GROUP, True)
        # Vertex groups live on the mesh datablock, which modifier_apply replaces:
        # the group has to be looked up again by name or the pointer dangles.
        stale = obj.vertex_groups.get(HUG_GROUP)
        if stale is not None:
            obj.vertex_groups.remove(stale)
    # Shrinkwrap is a correction, not a reshaping: a pass that moves most of a piece
    # is the alignment failing somewhere upstream, and the fraction is how it shows.
    report["wholeMovedFraction"] = round(report["wholeMovedVertices"] / total, 6)
    report["hugMovedFraction"] = round(report["hugMovedVertices"] / total, 6)
    return report


def outside_measure(objects: list, surface: Surface) -> dict:
    depths = []
    disagreed = 0
    deepest = None
    for obj in objects:
        for point in _runtime_points(obj):
            depth, split = surface.probe(point)
            depths.append(depth)
            disagreed += int(split)
            # The gate names the piece; without the point nobody can find the vertex.
            if depth > (deepest[0] if deepest else 0.0):
                deepest = (depth, point)
    return {
        "insideVertices": sum(depth > 0 for depth in depths),
        "disagreeingVertices": disagreed,
        "maxPenetrationMetres": round(max(depths, default=0.0), 9),
        "deepestPoint": rounded(deepest[1]) if deepest else None,
    }


def coverage(piece, meshes: list, reach: float) -> dict[str, list[int]]:
    """The body vertices a fitted piece covers at bind, per mesh.

    Authored slot regions stop where the anatomy does, and a garment does not: a
    waistband climbs above the waist, a sleeve wall stands off an upper arm the
    shoulders region never claimed. So the mask is measured off the piece itself -
    a vertex is covered when a ray along its own normal reaches the garment within
    `reach`, or when the garment has swallowed it whole.
    """
    points = [tuple(piece.matrix_world @ vertex.co) for vertex in piece.data.vertices]
    faces = _triangles(piece)
    if not faces:
        raise RuntimeError("coverage gate: the fitted piece has no faces")
    tree = BVHTree.FromPolygons(points, faces, all_triangles=True)
    shell = Surface([piece])
    box = np.array(points, dtype=np.float64)
    low, high = box.min(axis=0) - reach, box.max(axis=0) + reach

    covered: dict[str, list[int]] = {}
    for obj in meshes:
        normal_matrix = obj.matrix_world.to_3x3().inverted().transposed()
        found: list[int] = []
        for vertex in obj.data.vertices:
            world = obj.matrix_world @ vertex.co
            place = np.array(tuple(world), dtype=np.float64)
            if np.any(place < low) or np.any(place > high):
                continue
            normal = (normal_matrix @ vertex.normal).normalized()
            if tree.ray_cast(world, normal, reach)[0] is not None:
                found.append(vertex.index)
            elif shell.measure(runtime_from_blender(world))[0]:
                found.append(vertex.index)
        if found:
            covered[obj.name] = found
    return covered


def enclosure(piece, reference: dict[str, np.ndarray]) -> dict:
    """How much of the region the fitted piece actually contains, per side.

    A glove is judged by whether the hand is in it. Alignment can put a piece
    against a region rather than around it and every gate still passes, so the
    fraction is measured off the fitted piece and reported: near 1.0 is worn, and
    a half is a piece the body is hanging out of.

    Measured over the region inside the piece's own box, because a slot's region
    reaches past the garment on purpose - `hands` runs to mid forearm - and counting
    skin no glove was ever going to hold would answer a different question.
    """
    shell = Surface([piece])
    box = _runtime_points(piece)
    found = {}
    for side, points in reference.items():
        within = _reached(box, points)
        inside = sum(1 for point in within if shell.measure(point)[0])
        found[side] = {"regionVertices": len(points), "withinPieceBox": len(within),
                       "insideVertices": inside,
                       "insideFraction": round(inside / max(1, len(within)), 6)}
    return found


def facing(objects: list, reference: dict, slot: dict, contract: dict, landmarks: dict) -> dict:
    """Which way the fitted piece points: forward of its region, and toes ahead of ankles.

    A boot is symmetric enough to look plausible backwards from the front, so the
    heel-versus-toe question is asked in numbers rather than left to a review sheet.
    """
    points = np.concatenate([_runtime_points(obj) for obj in objects])
    every = np.concatenate([side for side in reference.values()])
    report = {"pieceCentroidZ": round(float(points[:, 2].mean()), 6),
              "regionCentroidZ": round(float(every[:, 2].mean()), 6)}
    report["aheadOfRegionMetres"] = round(report["pieceCentroidZ"] - report["regionCentroidZ"], 6)

    named = {bone["name"]: bone for bone in contract["bones"]}
    worn = {rule["bone"] for rule in slot["region"]}
    feet = {("L" if bone["role"].endswith(".l") else "R"): bone
            for bone in named.values()
            if bone.get("role", "").startswith("foot.") and bone["name"] in worn}
    if not slot["pair"] or len(feet) != 2 or len(objects) != 2:
        return report
    toes = {}
    for at, obj in enumerate(objects):
        side = ("L", "R")[at]
        ankle = feet[side]["head"]
        if not isinstance(ankle, str) or ankle not in landmarks:
            raise RuntimeError(f"toe gate: {feet[side]['name']} has no landmark head")
        centroid = float(_runtime_points(obj)[:, 2].mean())
        toes[side] = {"islandCentroidZ": round(centroid, 6),
                      "ankleZ": round(float(landmarks[ankle][2]), 6),
                      "aheadMetres": round(centroid - float(landmarks[ankle][2]), 6)}
    report["toes"] = toes
    return report
