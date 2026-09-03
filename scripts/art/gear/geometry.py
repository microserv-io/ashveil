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


def align(obj, reference: np.ndarray, rule: dict, surface: Surface, side: str | None = None,
          span: dict | None = None, yaw: int = 0) -> dict:
    """Place the piece on the region it covers, at the yaw the caller asked for.

    The fitter used to vote between 0 and 180 by counting vertices inside the body,
    and a boot is nearly symmetric enough for that vote to come out backwards. Every
    source faces +Z by contract, so the yaw is told, not guessed; both counts stay in
    the report as a diagnostic, alongside how much of the piece lands inside the body
    before shrinkwrap corrects it.
    """
    original = _runtime_points(obj)
    region_bounds = (reference.min(axis=0), reference.max(axis=0))
    span_axis = AXIS[span["axis"] if span else rule["span"]["axis"]]
    extent = float(original[:, span_axis].max() - original[:, span_axis].min())
    # A slot's span measures the region it sits on; an override measures the piece
    # against two landmarks instead, for a garment the region has no extent for.
    target_extent = (span["metres"] if span
                     else float(region_bounds[1][span_axis] - region_bounds[0][span_axis]))
    factor = float(span["factor"] if span else rule["span"]["factor"])
    if extent <= 1e-9 or target_extent <= 1e-9:
        raise RuntimeError("alignment gate: the piece or body reference has zero span")
    scale = target_extent * factor / extent

    def place(turn: int, at: float) -> tuple[int, float, np.ndarray, np.ndarray]:
        points = original.copy()
        if turn:
            points[:, 0] *= -1.0
            points[:, 2] *= -1.0
        points *= at
        piece_bounds = (points.min(axis=0), points.max(axis=0))
        translation = np.zeros(3)
        for axis_name, anchor in rule["anchors"].items():
            axis = AXIS[axis_name]
            offset = float(anchor["offset"])
            if side and axis_name == "X":
                offset *= 1.0 if side == "L" else -1.0
            translation[axis] = (_value(region_bounds, anchor["body"], axis) + offset
                                 - _value(piece_bounds, anchor["piece"], axis))
        points += translation
        distances = [surface.measure(point) for point in points]
        return (sum(1 for is_inside, _ in distances if is_inside),
                sum(distance for _, distance in distances) / max(1, len(distances)),
                points, translation,
                sum(1 for is_inside, depth in distances if is_inside and depth > DEEP_INSIDE))

    candidates = {turn: place(turn, scale) for turn in (0, 180)}
    inside, mean, points, translation, deep = candidates[yaw]
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
    faces: list[tuple[int, int, int]] = []
    for face in piece.data.polygons:
        corners = list(face.vertices)
        faces.extend((corners[0], corners[at], corners[at + 1]) for at in range(1, len(corners) - 1))
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
