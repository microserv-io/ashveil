from __future__ import annotations

import os

import bpy
import numpy as np

from mathutils import Vector
from mathutils.bvhtree import BVHTree

from fit.frame import blender_from_runtime
from fit.glb import Glb
from fit.review import VIEWS, _render
from fit.skin import Body

POSES = ("bind", "abduct90", "flex60")
# A piece is a shell, not a solid, so the nearest-normal sign only means anything
# close to it; past this the "inside" of an open patch is half the world.
SWALLOW_REACH = 0.05


def _posed(skinned: Body, pose: dict) -> list:
    matrices = skinned.skin_matrices(pose)
    moved = []
    for region in skinned.regions:
        points = np.einsum("vj,jab,vb->va", region["weights"], matrices[:, :3, :3], region["positions"])
        moved.append(points + region["weights"] @ matrices[:, :3, 3])
    return moved


def _shown(region: dict, hidden: dict[str, set[int]]):
    """The body the game draws: a triangle goes when all three of its vertices are worn over."""
    covered = hidden.get(region["name"], set())
    if not covered:
        return region["triangles"]
    return [face for face in region["triangles"] if not all(int(index) in covered for index in face)]


def _swallowed(body: Body, body_points: list, piece_points: list, piece: Body,
               hidden: dict[str, set[int]]) -> int:
    """Body vertices no worn region hides that sit inside the piece, so a swallowed arm shows up."""
    points: list = []
    faces: list = []
    for region, moved in zip(piece.regions, piece_points):
        base = len(points)
        points.extend(tuple(float(value) for value in vertex) for vertex in moved)
        faces.extend(tuple(base + int(index) for index in face) for face in region["triangles"])
    tree = BVHTree.FromPolygons(points, faces, all_triangles=True)
    swallowed = 0
    for region, moved in zip(body.regions, body_points):
        covered = hidden.get(region["name"], set())
        for index, vertex in enumerate(moved):
            if index in covered:
                continue
            point = Vector((float(vertex[0]), float(vertex[1]), float(vertex[2])))
            hit, normal, _, distance = tree.find_nearest(point, SWALLOW_REACH)
            if hit is not None and distance <= SWALLOW_REACH and (point - hit).dot(normal) < 0.0:
                swallowed += 1
    return swallowed


def _scene(body: Body, piece: Body, body_points: list, piece_points: list,
           hidden: dict[str, set[int]]) -> None:
    for kind in (bpy.data.objects, bpy.data.meshes, bpy.data.cameras, bpy.data.lights, bpy.data.armatures,
                 bpy.data.materials):
        for item in list(kind):
            kind.remove(item)
    for skinned, moved_regions, colour in ((body, body_points, (0.18, 0.20, 0.23, 1.0)),
                                           (piece, piece_points, (0.72, 0.16, 0.08, 1.0))):
        material = bpy.data.materials.new("Body" if skinned is body else "Gear")
        material.diffuse_color = colour
        for region, moved in zip(skinned.regions, moved_regions):
            faces = _shown(region, hidden) if skinned is body else region["triangles"]
            mesh = bpy.data.meshes.new(region["name"])
            mesh.from_pydata([blender_from_runtime(vertex) for vertex in moved], [],
                             [tuple(int(index) for index in face) for face in faces])
            mesh.materials.append(material)
            mesh.update()
            mesh.shade_smooth()
            bpy.context.scene.collection.objects.link(bpy.data.objects.new(region["name"], mesh))


def sheet(body_path: str, piece_path: str, contract: dict, out_path: str, scratch: str,
          hidden: dict[str, set[int]] | None = None) -> dict[str, int]:
    """The sheet shows what the game shows, and counts the skin the piece ate."""
    hidden = hidden or {}
    body = Body(Glb(body_path), contract)
    piece = Body(Glb(piece_path), contract, primary="")
    poses = body.poses(contract["gates"]["clavicleShare"])
    rows = []
    swallowed = {}
    for pose_name in POSES:
        body_points = _posed(body, poses[pose_name])
        piece_points = _posed(piece, poses[pose_name])
        swallowed[pose_name] = _swallowed(body, body_points, piece_points, piece, hidden)
        row = []
        for view, (eye, target) in VIEWS.items():
            path = os.path.join(scratch, f"{pose_name}-{view}.png")
            _scene(body, piece, body_points, piece_points, hidden)
            _render(eye, target, path)
            row.append(path)
        rows.append(row)
    tiles = []
    for row in rows:
        images = []
        for path in row:
            image = bpy.data.images.load(path)
            width, height = image.size
            images.append(np.array(image.pixels[:]).reshape(height, width, 4))
            bpy.data.images.remove(image)
        tiles.append(np.concatenate(images, axis=1))
    pixels = np.concatenate(tiles[::-1], axis=0)
    output = bpy.data.images.new("sheet", width=pixels.shape[1], height=pixels.shape[0], alpha=True)
    output.pixels = pixels.ravel().tolist()
    output.filepath_raw = out_path
    output.file_format = "PNG"
    output.save()
    bpy.data.images.remove(output)
    return swallowed
