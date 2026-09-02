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
    """

    def __init__(self, meshes: list, hidden: dict[str, set[int]] | None = None) -> None:
        hidden = hidden or {}
        points: list[tuple[float, float, float]] = []
        every: list[tuple[int, int, int]] = []
        seen: list[tuple[int, int, int]] = []
        for obj in meshes:
            base = len(points)
            matrix = obj.matrix_world
            points.extend(tuple(matrix @ vertex.co) for vertex in obj.data.vertices)
            covered = hidden.get(obj.name, set())
            for face in obj.data.polygons:
                corners = list(face.vertices)
                shown = not all(corner in covered for corner in corners)
                for at in range(1, len(corners) - 1):
                    triangle = (base + corners[0], base + corners[at], base + corners[at + 1])
                    every.append(triangle)
                    if shown:
                        seen.append(triangle)
        if not every:
            raise RuntimeError("surface gate: the body has no faces to measure against")
        self.every = BVHTree.FromPolygons(points, every, all_triangles=True)
        self.seen = self.every if len(seen) == len(every) else BVHTree.FromPolygons(points, seen, all_triangles=True)

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

    def penetration(self, point: np.ndarray) -> float:
        """How deep a viewer would see the piece sink in; zero where the skin is hidden."""
        inside, distance = self.measure(point)
        if not inside:
            return 0.0
        nearest, _, _, shown = self.seen.find_nearest(Vector(blender_from_runtime(point)))
        return distance if nearest is not None and shown <= distance + 1e-9 else 0.0


def align(obj, reference: np.ndarray, rule: dict, surface: Surface, side: str | None = None) -> dict:
    original = _runtime_points(obj)
    region_bounds = (reference.min(axis=0), reference.max(axis=0))
    span_axis = AXIS[rule["span"]["axis"]]
    extent = float(original[:, span_axis].max() - original[:, span_axis].min())
    region_extent = float(region_bounds[1][span_axis] - region_bounds[0][span_axis])
    if extent <= 1e-9 or region_extent <= 1e-9:
        raise RuntimeError("alignment gate: the piece or body reference has zero span")
    scale = region_extent * float(rule["span"]["factor"]) / extent
    candidates = []
    for yaw in (0, 180):
        points = original.copy()
        if yaw:
            points[:, 0] *= -1.0
            points[:, 2] *= -1.0
        points *= scale
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
        inside = sum(1 for is_inside, _ in distances if is_inside)
        mean = sum(distance for _, distance in distances) / max(1, len(distances))
        candidates.append((inside, mean, yaw, points, translation))
    inside, mean, yaw, points, translation = min(candidates, key=lambda item: (item[0], item[1], item[2]))
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
    return {
        "scale": round(scale, 6),
        "yawDegrees": yaw,
        "translation": rounded(translation),
        "insideVerticesBeforeShrinkwrap": inside,
        "meanSurfaceDistanceMetres": round(mean, 6),
        "anchorResidualMetres": residuals,
    }


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


def shrinkwrap(objects: list, target, slot: dict) -> dict:
    clearance = float(slot["clearance"])
    report = {"wholeMovedVertices": 0, "hugSelectedVertices": 0, "hugMovedVertices": 0}
    for obj in objects:
        report["wholeMovedVertices"] += _apply_shrinkwrap(obj, target, clearance)
        points = _runtime_points(obj)
        axis = AXIS[slot["align"]["span"]["axis"]]
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
    return report


def outside_measure(objects: list, surface: Surface) -> dict:
    depths = []
    for obj in objects:
        for point in _runtime_points(obj):
            depths.append(surface.penetration(point))
    return {
        "insideVertices": sum(depth > 0 for depth in depths),
        "maxPenetrationMetres": round(max(depths, default=0.0), 9),
    }
