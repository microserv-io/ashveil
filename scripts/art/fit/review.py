"""The contact sheet: the same body in the poses the gates measured, four ways.

Rendered from the exported file rather than the Blender scene, and with the
Workbench engine, so the sheet is a deterministic function of the bytes that
ship and a rerun produces the same image.
"""

from __future__ import annotations

import numpy as np

from .glb import Glb
from .skin import Body

VIEWS = {
    "front": ((0.0, 1.0, 3.4), (0.0, 0.95, 0.0)),
    "back": ((0.0, 1.0, -3.4), (0.0, 0.95, 0.0)),
    "side": ((3.4, 1.0, 0.0), (0.0, 0.95, 0.0)),
}
POSES = ("bind", "abduct90", "abduct150_rhythm", "abduct180_rhythm", "flex60")
TILE = 384


def _scene(body: Body, pose: dict) -> None:
    import bpy

    for kind in (bpy.data.objects, bpy.data.meshes, bpy.data.cameras, bpy.data.lights, bpy.data.armatures):
        for item in list(kind):
            kind.remove(item)
    matrices = body.skin_matrices(pose)
    for region in body.regions:
        posed = np.einsum("vj,jab,vb->va", region["weights"], matrices[:, :3, :3], region["positions"])
        posed += region["weights"] @ matrices[:, :3, 3]
        # glTF Y-up to Blender Z-up, the inverse of frame.runtime_from_blender.
        vertices = np.stack([posed[:, 0], -posed[:, 2], posed[:, 1]], axis=1)
        mesh = bpy.data.meshes.new(region["name"])
        mesh.from_pydata([tuple(vertex) for vertex in vertices], [], [tuple(face) for face in region["triangles"]])
        mesh.update()
        mesh.shade_smooth()
        bpy.context.scene.collection.objects.link(bpy.data.objects.new(region["name"], mesh))


def _render(eye, target, path: str) -> None:
    import bpy
    import mathutils

    scene = bpy.context.scene
    camera_data = bpy.data.cameras.new("Review")
    camera_data.lens = 50.0
    camera = bpy.data.objects.new("Review", camera_data)
    camera.location = (eye[0], -eye[2], eye[1])
    direction = mathutils.Vector((target[0] - eye[0], -(target[2] - eye[2]), target[1] - eye[1]))
    camera.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()
    scene.collection.objects.link(camera)
    scene.camera = camera
    scene.render.engine = "BLENDER_WORKBENCH"
    scene.display.shading.light = "STUDIO"
    scene.display.shading.show_shadows = True
    scene.display.shading.show_cavity = True
    scene.render.resolution_x = TILE
    scene.render.resolution_y = TILE
    scene.render.film_transparent = False
    scene.render.image_settings.file_format = "PNG"
    scene.render.filepath = path
    bpy.ops.render.render(write_still=True)


def sheet(glb_path: str, contract: dict, out_path: str, scratch: str) -> list[str]:
    import bpy
    import os

    body = Body(Glb(glb_path), contract)
    poses = body.poses(contract["gates"]["clavicleShare"])
    rows = []
    for pose_name in POSES:
        row = []
        for view, (eye, target) in VIEWS.items():
            path = os.path.join(scratch, f"{pose_name}-{view}.png")
            _scene(body, poses[pose_name])
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
    sheet_pixels = np.concatenate(tiles[::-1], axis=0)  # Blender's pixel rows run bottom-up
    out = bpy.data.images.new("sheet", width=sheet_pixels.shape[1], height=sheet_pixels.shape[0], alpha=True)
    out.pixels = sheet_pixels.ravel().tolist()
    out.filepath_raw = out_path
    out.file_format = "PNG"
    out.save()
    bpy.data.images.remove(out)
    return [path for row in rows for path in row]
