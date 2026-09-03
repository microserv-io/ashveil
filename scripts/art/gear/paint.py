"""Two-sided cloth: one hue outside, one inside, with the baked shading kept.

Tripo paints a cape by projecting what it sees, so a fold that showed its lining
came back with teal baked onto the outer face and orange onto the inner one, and
the piece read as shards rather than a lined cloak. Nothing about the geometry is
wrong, only which patch of the texture each side of the cloth was painted from.

So the sides are told apart by the piece's own shape - a triangle whose normal
points away from the body's spine axis is the outside, one that points back at it
is the inside - each side's own median colour is measured off the texture it has,
and every texel a side covers is repainted to that colour at the texel's own
brightness. The fold shading survives because only the hue is replaced.
"""

from __future__ import annotations

import math

import bpy
import numpy as np

from fit.frame import runtime_from_blender

# A triangle this near edge-on is not confidently either face: it still takes a side,
# but only for the texels no face of its own class already claims.
EDGE_ON_DEGREES = 20.0
LUMINANCE = np.array([0.2126, 0.7152, 0.0722])
# How far a texel's brightness may be pushed, so a black seam does not become a hole.
BRIGHTNESS_LIMITS = (0.15, 4.0)
# Lloyd rounds over the two dyes: they are far apart in hue, so this converges at once.
CLUSTER_ROUNDS = 6


class PaintError(RuntimeError):
    pass


def _image(obj):
    """The base colour image of the piece's material, which is what a viewer sees."""
    for material in obj.data.materials:
        if not material or not material.use_nodes:
            continue
        for node in material.node_tree.nodes:
            # `size` is what loads a packed image; `has_data` is False until it does.
            if node.type == "TEX_IMAGE" and node.image and all(node.image.size):
                return node.image
    raise PaintError("paint gate: the piece has no base colour texture to repaint")


def _axis(armature) -> np.ndarray:
    """The body's own vertical line, as the point every side is measured out from."""
    heads = [np.array(runtime_from_blender(armature.matrix_world @ armature.data.bones[name].head_local))
             for name in ("pelvis", "chest") if name in armature.data.bones]
    if not heads:
        raise PaintError("paint gate: the body has no pelvis or chest to take a spine axis from")
    return np.mean(heads, axis=0)


def _sides(obj, armature) -> tuple[np.ndarray, dict]:
    """Which side of the cloth every triangle is, by its own normal at bind."""
    mesh = obj.data
    mesh.calc_loop_triangles()
    axis = _axis(armature)
    matrix = obj.matrix_world
    normal_matrix = matrix.to_3x3().inverted().transposed()
    edge_on = math.cos(math.radians(90.0 - EDGE_ON_DEGREES))
    sides = np.zeros(len(mesh.loop_triangles), dtype=np.int8)
    weak = np.zeros(len(mesh.loop_triangles), dtype=np.int8)
    for at, triangle in enumerate(mesh.loop_triangles):
        centre = np.array(runtime_from_blender(matrix @ triangle.center), dtype=np.float64)
        normal = np.array(runtime_from_blender(normal_matrix @ triangle.normal), dtype=np.float64)
        outward = centre - axis
        outward[1] = 0.0
        reach = float(np.linalg.norm(outward))
        length = float(np.linalg.norm(normal))
        if reach < 1e-9 or length < 1e-9:
            continue
        facing = float(normal @ outward) / (reach * length)
        weak[at] = 1 if facing >= 0.0 else -1
        sides[at] = weak[at] if abs(facing) > edge_on else 0
    counted = {"outerTriangles": int((sides == 1).sum()), "innerTriangles": int((sides == -1).sum()),
               "edgeOnTriangles": int((sides == 0).sum())}
    return sides, weak, counted


def _footprints(obj, sides: np.ndarray, width: int, height: int) -> np.ndarray:
    """How many triangles of each side cover each texel, rasterised from the UVs.

    A texel is covered when its own centre lands inside the triangle's UV footprint,
    which is the same rule the renderer samples by.
    """
    mesh = obj.data
    layer = mesh.uv_layers.active
    if layer is None:
        raise PaintError("paint gate: the piece has no UVs to rasterise")
    counts = np.zeros((2, height, width), dtype=np.int32)
    for at, triangle in enumerate(mesh.loop_triangles):
        if sides[at] == 0:
            continue
        uv = np.array([layer.data[loop].uv for loop in triangle.loops], dtype=np.float64)
        pixels = np.stack([uv[:, 0] * width - 0.5, uv[:, 1] * height - 0.5], axis=1)
        low = np.maximum(np.floor(pixels.min(axis=0)).astype(int), 0)
        high = np.minimum(np.ceil(pixels.max(axis=0)).astype(int), [width - 1, height - 1])
        if np.any(low > high):
            continue
        columns = np.arange(low[0], high[0] + 1)
        rows = np.arange(low[1], high[1] + 1)
        grid_x, grid_y = np.meshgrid(columns, rows)
        first, second, third = pixels
        area = ((second[0] - first[0]) * (third[1] - first[1])
                - (third[0] - first[0]) * (second[1] - first[1]))
        if abs(area) < 1e-12:
            continue
        one = ((second[0] - grid_x) * (third[1] - grid_y) - (third[0] - grid_x) * (second[1] - grid_y)) / area
        two = ((third[0] - grid_x) * (first[1] - grid_y) - (first[0] - grid_x) * (third[1] - grid_y)) / area
        three = 1.0 - one - two
        inside = (one >= 0) & (two >= 0) & (three >= 0)
        if not inside.any():
            # A footprint thinner than a texel still owns the texels its corners land in.
            inside[...] = False
            for point in pixels:
                column = int(round(point[0])) - low[0]
                row = int(round(point[1])) - low[1]
                if 0 <= row < inside.shape[0] and 0 <= column < inside.shape[1]:
                    inside[row, column] = True
        lane = 0 if sides[at] == 1 else 1
        counts[lane][low[1]:high[1] + 1, low[0]:high[0] + 1] += inside
    return counts


def _hues(colour: np.ndarray) -> np.ndarray:
    """Colour without its brightness, which is what tells two dyes apart."""
    return colour / np.maximum(colour.sum(axis=-1, keepdims=True), 1e-6)


def _srgb(linear: np.ndarray) -> np.ndarray:
    value = np.maximum(np.asarray(linear, dtype=np.float64), 0.0)
    return np.where(value <= 0.0031308, value * 12.92, 1.055 * value ** (1 / 2.4) - 0.055)


def _lining(colour: np.ndarray, owner: np.ndarray) -> list[np.ndarray]:
    """Split the painted texels into the two dyes, and give each side the one it is.

    A median over a side straight out of the source is a median over both dyes, because
    the bake put patches of each on both faces: this cape's inner face came out 57 per
    cent outer orange, so its median was mud rather than teal. The two dyes are found by
    the colours furthest apart in hue and refined, the outside takes whichever it is
    mostly painted in, and the lining takes the other one - a lining is the other colour.
    """
    covered = owner >= 0
    hue = _hues(colour[covered])
    seeds = np.stack([hue[np.argmax(hue[:, 0] - hue[:, 2])], hue[np.argmax(hue[:, 2] - hue[:, 0])]])
    for _ in range(CLUSTER_ROUNDS):
        near = np.argmin(((hue[:, None, :] - seeds[None, :, :]) ** 2).sum(axis=2), axis=1)
        for lane in (0, 1):
            if (near == lane).any():
                seeds[lane] = np.median(hue[near == lane], axis=0)
    dye = np.full(owner.shape, -1, dtype=np.int8)
    dye[covered] = near
    outer = dye[owner == 0]
    first = int((outer == 0).sum()) >= int((outer == 1).sum())
    return [dye == (0 if first else 1), dye == (1 if first else 0)]


def apply(obj, armature) -> dict:
    """Repaint the piece's texture so each side of the cloth carries one hue."""
    image = _image(obj)
    width, height = image.size
    buffer = np.empty(width * height * 4, dtype=np.float32)
    image.pixels.foreach_get(buffer)
    pixels = buffer.astype(np.float64).reshape(height, width, 4)
    sides, weak, report = _sides(obj, armature)
    if not report["outerTriangles"] or not report["innerTriangles"]:
        raise PaintError(f"paint gate: the piece is one sided, {report}")
    counts = _footprints(obj, sides, width, height)
    # A texel both sides paint belongs to whichever covers it more, and the outside
    # wins a tie: the outer face is the one a player is looking at. A texel no face
    # claims is settled by the triangles too edge-on to be sure of, which is what
    # keeps a fold from staying the colour of the side it was baked from.
    edges = _footprints(obj, np.where(sides == 0, weak, np.int8(0)), width, height)
    held = np.where((counts[0] == 0) & (counts[1] == 0), -1, np.where(counts[0] >= counts[1], 0, 1))
    guessed = np.where((edges[0] == 0) & (edges[1] == 0), -1, np.where(edges[0] >= edges[1], 0, 1))
    owner = np.where(held >= 0, held, guessed)
    report["edgeOnTexels"] = int(((held < 0) & (guessed >= 0)).sum())
    colour = pixels[..., :3]
    brightness = colour @ LUMINANCE
    report["image"] = image.name
    report["size"] = [int(width), int(height)]
    for lane, name in ((0, "outer"), (1, "inner")):
        if not (owner == lane).any():
            raise PaintError(f"paint gate: the {name} side covers no texel")
    painted = 0
    lining = _lining(colour, owner)
    for lane, name in ((0, "outer"), (1, "inner")):
        mask = owner == lane
        chosen = mask & lining[lane]
        if not chosen.any():
            raise PaintError(f"paint gate: the {name} side carries none of the dye it took")
        median = np.median(colour[chosen], axis=0)
        middle = float(np.median(brightness[mask]))
        if middle < 1e-6:
            raise PaintError(f"paint gate: the {name} side has no brightness to scale by")
        scale = np.clip(brightness[mask] / middle, *BRIGHTNESS_LIMITS)[:, None]
        pixels[mask, :3] = np.clip(median[None, :] * scale, 0.0, 1.0)
        report[name] = [round(float(value), 6) for value in median]
        report[f"{name}Srgb"] = [round(float(value), 6) for value in _srgb(median)]
        report[f"{name}Texels"] = int(mask.sum())
        report[f"{name}Share"] = round(float(chosen.sum()) / max(1, int(mask.sum())), 6)
        painted += int(mask.sum())
    image.pixels.foreach_set(pixels.astype(np.float32).ravel())
    image.update()
    # The exporter writes the file it was given unless the datablock is the source,
    # and an imported GLB's image is packed, so packing again keeps the edit.
    image.pack()
    report["texelsRepainted"] = painted
    report["texelFraction"] = round(painted / float(width * height), 6)
    return report
