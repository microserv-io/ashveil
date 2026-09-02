from __future__ import annotations

import os

import bpy
import numpy as np

from fit.frame import blender_from_runtime
from fit.glb import Glb
from fit.review import VIEWS, _render
from fit.skin import Body

POSES = ("bind", "abduct90", "flex60")


def _scene(body: Body, piece: Body, pose: dict) -> None:
    for kind in (bpy.data.objects, bpy.data.meshes, bpy.data.cameras, bpy.data.lights, bpy.data.armatures,
                 bpy.data.materials):
        for item in list(kind):
            kind.remove(item)
    for skinned, colour in ((body, (0.18, 0.20, 0.23, 1.0)), (piece, (0.72, 0.16, 0.08, 1.0))):
        material = bpy.data.materials.new("Body" if skinned is body else "Gear")
        material.diffuse_color = colour
        matrices = skinned.skin_matrices(pose)
        for region in skinned.regions:
            moved = np.einsum("vj,jab,vb->va", region["weights"], matrices[:, :3, :3], region["positions"])
            moved += region["weights"] @ matrices[:, :3, 3]
            mesh = bpy.data.meshes.new(region["name"])
            mesh.from_pydata([blender_from_runtime(vertex) for vertex in moved], [],
                             [tuple(face) for face in region["triangles"]])
            mesh.materials.append(material)
            mesh.update()
            mesh.shade_smooth()
            bpy.context.scene.collection.objects.link(bpy.data.objects.new(region["name"], mesh))


def sheet(body_path: str, piece_path: str, contract: dict, out_path: str, scratch: str) -> None:
    body = Body(Glb(body_path), contract)
    piece = Body(Glb(piece_path), contract, primary="")
    poses = body.poses(contract["gates"]["clavicleShare"])
    rows = []
    for pose_name in POSES:
        row = []
        for view, (eye, target) in VIEWS.items():
            path = os.path.join(scratch, f"{pose_name}-{view}.png")
            _scene(body, piece, poses[pose_name])
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
