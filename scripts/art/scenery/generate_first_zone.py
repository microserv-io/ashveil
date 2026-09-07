"""Generate the authored first-zone scenery templates and review artefacts."""

from __future__ import annotations

import hashlib
import json
import math
import random
import sys
import tempfile
from pathlib import Path

import bpy
from mathutils import Vector


ROOT = Path(__file__).resolve().parents[3]
PUBLIC = ROOT / "public" / "world" / "first-zone"
LOCAL = ROOT / "scripts" / "art" / "scenery" / ".output" / "first-zone"
GLB = PUBLIC / "scenery-kit.glb"
MANIFEST = PUBLIC / "scenery-kit.manifest.json"
BLEND = LOCAL / "scenery-kit.blend"
CONTACT_SHEET = LOCAL / "scenery-kit-contact-sheet.png"
PROOF_CLOSE = LOCAL / "cottage-alder-body-close.png"
PROOF_PLAY = LOCAL / "cottage-alder-body-play-distance.png"
ATLAS_SIZE = 2048
ATLAS_GUTTER = 14
TREE_GROUND_ZONE_CUTOFF = 1.0
COLOR_ATTRIBUTE = "Color"
MATERIAL_NAME = "scenery_pbr_atlas"

ATLAS_FILES = {
    "baseColor": LOCAL / "scenery-atlas-basecolor.png",
    "orm": LOCAL / "scenery-atlas-orm.png",
    "normal": LOCAL / "scenery-atlas-normal.png",
}
SEMANTIC_COLORS = {
    "plaster": (0.72, 0.63, 0.43),
    "stone": (0.57, 0.54, 0.43),
    "wood": (0.34, 0.19, 0.075),
    "roof": (0.45, 0.245, 0.135),
    "bark": (0.30, 0.19, 0.09),
    "leaves": (0.25, 0.39, 0.085),
    "cloth": (0.035, 0.34, 0.32),
}
SEMANTIC_REGIONS = {
    "plaster": (0, 1), "stone": (1, 1), "wood": (2, 1),
    "roof": (0, 0), "bark": (1, 0), "leaves": (2, 0), "cloth": (3, 0),
}
TEMPLATES = {
    "refuge_hall": {"footprintRadius": 6.0, "advisoryTriangles": 35000, "runawayTriangleCap": 1000000},
    "cottage": {"footprintRadius": 4.0, "advisoryTriangles": 25000, "runawayTriangleCap": 1000000},
    "alder_tree": {"footprintRadius": 1.1, "advisoryTriangles": 15000, "runawayTriangleCap": 1000000},
    "orchard_tree": {"footprintRadius": 1.1, "advisoryTriangles": 15000, "runawayTriangleCap": 1000000},
}


def reset_scene() -> None:
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    for collection in (bpy.data.meshes, bpy.data.materials, bpy.data.images, bpy.data.cameras, bpy.data.lights, bpy.data.curves):
        for item in list(collection):
            collection.remove(item)


def atlas_rect(semantic: str) -> tuple[float, float, float, float]:
    column, row = SEMANTIC_REGIONS[semantic]
    gutter = ATLAS_GUTTER / ATLAS_SIZE
    width, height = 1.0 / 4.0, 1.0 / 2.0
    return (column * width + gutter, row * height + gutter, (column + 1) * width - gutter, (row + 1) * height - gutter)


def generate_atlases() -> dict[str, bpy.types.Image]:
    import numpy as np

    LOCAL.mkdir(parents=True, exist_ok=True)
    size = ATLAS_SIZE
    yy, xx = np.mgrid[0:size, 0:size]
    rng = np.random.default_rng(84721)
    coarse = rng.normal(0.0, 1.0, (size // 8, size // 8)).astype(np.float32)
    noise = np.repeat(np.repeat(coarse, 8, axis=0), 8, axis=1)
    blurred = (noise + np.roll(noise, 3, 0) + np.roll(noise, -3, 0) + np.roll(noise, 3, 1) + np.roll(noise, -3, 1) + np.roll(noise, 6, 0) + np.roll(noise, -6, 1)) / 7.0
    base = np.ones((size, size, 4), dtype=np.float32)
    orm = np.ones((size, size, 4), dtype=np.float32)
    normal = np.zeros((size, size, 4), dtype=np.float32)
    normal[:, :, :3], normal[:, :, 3] = (0.5, 0.5, 1.0), 1.0
    cell_width, cell_height = size // 4, size // 2
    for semantic, (column, row) in SEMANTIC_REGIONS.items():
        x0, x1 = column * cell_width, size if column == 3 else (column + 1) * cell_width
        y0, y1 = row * cell_height, (row + 1) * cell_height
        local_x = xx[y0:y1, x0:x1].astype(np.float32)
        local_y = yy[y0:y1, x0:x1].astype(np.float32)
        detail = blurred[y0:y1, x0:x1]
        if semantic == "plaster":
            stains = np.maximum(0.0, np.sin(local_x * 0.012 + np.sin(local_y * 0.009)) - 0.72)
            chips = ((np.sin(local_x * 0.071) + np.sin(local_y * 0.093)) > 1.74).astype(np.float32)
            height = detail * 0.20 - stains * 0.55 - chips * 0.38
            modulation, roughness = 1.0 + height * 0.48, 0.88 + detail * 0.02
        elif semantic == "stone":
            courses = np.sin(local_y * 0.054 + np.sin(local_x * 0.016) * 0.9)
            chips = np.sin(local_x * 0.083 + np.sin(local_y * 0.027)) * np.sin(local_y * 0.071)
            height = detail * 0.27 + chips * 0.16 + courses * 0.07
            modulation, roughness = 1.0 + height * 0.17, 0.92 + detail * 0.02
        elif semantic == "wood":
            grain = np.sin(local_x * 0.12 + np.sin(local_y * 0.022) * 2.2)
            knots = np.sin(np.sqrt((local_x % 310 - 155) ** 2 + (local_y % 440 - 220) ** 2) * 0.08)
            height = detail * 0.10 + grain * 0.28 + knots * 0.07
            modulation, roughness = 1.0 + height * 0.28, 0.80 + detail * 0.035
        elif semantic == "roof":
            weather = np.sin(local_y * 0.065) + np.sin(local_x * 0.019 + local_y * 0.01)
            height = detail * 0.15 + weather * 0.10
            modulation, roughness = 1.0 + height * 0.20, 0.84 + detail * 0.03
        elif semantic == "bark":
            furrows = np.sin(local_x * 0.105 + np.sin(local_y * 0.03) * 1.8)
            height = detail * 0.18 + furrows * 0.29
            modulation, roughness = 1.0 + height * 0.24, 0.93 + detail * 0.02
        elif semantic == "leaves":
            veins = np.sin((local_x + local_y) * 0.115) * 0.12
            height = detail * 0.13 + veins
            modulation, roughness = 1.0 + height * 0.19, 0.78 + detail * 0.025
        else:
            weave = np.sin(local_x * 0.18) * np.sin(local_y * 0.18)
            height = detail * 0.10 + weave * 0.08
            modulation, roughness = 1.0 + height * 0.12, 0.86 + detail * 0.02
        color = np.array(SEMANTIC_COLORS[semantic], dtype=np.float32)
        base[y0:y1, x0:x1, :3] = np.clip(color[None, None, :] * modulation[:, :, None], 0.0, 1.0)
        orm[y0:y1, x0:x1, 0] = np.clip(0.93 - detail * 0.025, 0.0, 1.0)
        orm[y0:y1, x0:x1, 1] = np.clip(roughness, 0.0, 1.0)
        orm[y0:y1, x0:x1, 2] = 0.0
        dx, dy = np.roll(height, -1, 1) - np.roll(height, 1, 1), np.roll(height, -1, 0) - np.roll(height, 1, 0)
        strength = 0.75 if semantic in ("wood", "bark", "stone") else 0.45
        nx, ny, nz = -dx * strength, -dy * strength, np.ones_like(dx)
        length = np.sqrt(nx * nx + ny * ny + nz * nz)
        normal[y0:y1, x0:x1, :3] = np.stack((nx / length * 0.5 + 0.5, ny / length * 0.5 + 0.5, nz / length * 0.5 + 0.5), axis=-1)
    images = {}
    for role, pixels in (("baseColor", base), ("orm", orm), ("normal", normal)):
        image_name = "scenery-atlas-basecolor" if role == "baseColor" else f"scenery-atlas-{role}"
        image = bpy.data.images.new(image_name, width=size, height=size, alpha=False)
        image.colorspace_settings.name = "sRGB" if role == "baseColor" else "Non-Color"
        image.pixels.foreach_set((np.round(np.clip(pixels, 0.0, 1.0) * 255.0) / 255.0).ravel())
        image.filepath_raw, image.file_format = str(ATLAS_FILES[role]), "PNG"
        image.save()
        image.pack()
        images[role] = image
    return images


def pbr_atlas_material(images: dict[str, bpy.types.Image]):
    material = bpy.data.materials.new(MATERIAL_NAME)
    material.use_nodes = True
    nodes, links = material.node_tree.nodes, material.node_tree.links
    nodes.clear()
    output, shader = nodes.new("ShaderNodeOutputMaterial"), nodes.new("ShaderNodeBsdfPrincipled")
    base, orm, normal_texture = nodes.new("ShaderNodeTexImage"), nodes.new("ShaderNodeTexImage"), nodes.new("ShaderNodeTexImage")
    base.name, base.image = "Shared base-color atlas", images["baseColor"]
    orm.name, orm.image = "Shared ORM atlas", images["orm"]
    normal_texture.name, normal_texture.image = "Shared tangent normal atlas", images["normal"]
    separate = nodes.new("ShaderNodeSeparateColor")
    tint, multiply = nodes.new("ShaderNodeVertexColor"), nodes.new("ShaderNodeMixRGB")
    tint.layer_name, multiply.blend_type, multiply.inputs[0].default_value = COLOR_ATTRIBUTE, "MULTIPLY", 1.0
    normal_map = nodes.new("ShaderNodeNormalMap")
    normal_map.inputs["Strength"].default_value = 0.42
    links.new(base.outputs["Color"], multiply.inputs[1]); links.new(tint.outputs["Color"], multiply.inputs[2])
    links.new(multiply.outputs["Color"], shader.inputs["Base Color"])
    links.new(orm.outputs["Color"], separate.inputs["Color"])
    links.new(separate.outputs["Green"], shader.inputs["Roughness"]); links.new(separate.outputs["Blue"], shader.inputs["Metallic"])
    links.new(normal_texture.outputs["Color"], normal_map.inputs["Color"]); links.new(normal_map.outputs["Normal"], shader.inputs["Normal"])
    links.new(shader.outputs["BSDF"], output.inputs["Surface"])
    group = bpy.data.node_groups.new("glTF Material Output", "ShaderNodeTree")
    group.interface.new_socket(name="Occlusion", in_out="INPUT", socket_type="NodeSocketFloat")
    ao_output = nodes.new("ShaderNodeGroup"); ao_output.node_tree = group
    links.new(separate.outputs["Red"], ao_output.inputs["Occlusion"])
    return material


def author_uv(obj, semantic: str) -> None:
    mesh = obj.data
    uv_layer = mesh.uv_layers.get("UVMap") or mesh.uv_layers.new(name="UVMap")
    minimum = Vector(tuple(min(v.co[i] for v in mesh.vertices) for i in range(3)))
    maximum = Vector(tuple(max(v.co[i] for v in mesh.vertices) for i in range(3)))
    extent, rect = maximum - minimum, atlas_rect(semantic)
    for polygon in mesh.polygons:
        axis = max(range(3), key=lambda index: abs(polygon.normal[index]))
        axes = ((1, 2), (0, 2), (0, 1))[axis]
        for loop_index in polygon.loop_indices:
            coordinate = mesh.vertices[mesh.loops[loop_index].vertex_index].co
            first = (coordinate[axes[0]] - minimum[axes[0]]) / max(extent[axes[0]], 1e-5)
            second = (coordinate[axes[1]] - minimum[axes[1]]) / max(extent[axes[1]], 1e-5)
            uv_layer.data[loop_index].uv = (rect[0] + first * (rect[2] - rect[0]), rect[1] + second * (rect[3] - rect[1]))


def finish_part(obj, semantic, seed, material, bevel=0.0, bevel_segments=2, smooth=False):
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    if bevel > 0:
        modifier = obj.modifiers.new("Soft hand-worked edges", "BEVEL")
        modifier.width, modifier.segments, modifier.limit_method = bevel, bevel_segments, "ANGLE"
        bpy.ops.object.modifier_apply(modifier=modifier.name)
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    for polygon in obj.data.polygons:
        polygon.use_smooth = smooth
    attribute = obj.data.color_attributes.get(COLOR_ATTRIBUTE) or obj.data.color_attributes.new(name=COLOR_ATTRIBUTE, type="BYTE_COLOR", domain="CORNER")
    rng = random.Random(seed); warm = rng.uniform(-0.05, 0.055)
    color = (max(0.82, min(1.0, 0.95 + warm)), max(0.82, min(1.0, 0.95 + warm * 0.55)), max(0.82, min(1.0, 0.95 - warm * 0.25)), 1.0)
    for datum in attribute.data:
        datum.color = color
    author_uv(obj, semantic)
    obj.data.materials.append(material)
    return obj


def box(parts, name, location, dimensions, semantic, material, bevel=0.0, rotation=(0.0, 0.0, 0.0)):
    bpy.ops.mesh.primitive_cube_add(location=location, rotation=rotation)
    obj = bpy.context.object; obj.name, obj.dimensions = name, dimensions
    parts.append(finish_part(obj, semantic, name, material, bevel, 3))
    return obj


def irregular_stone(parts, name, location, scale, material, rng):
    bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=2, radius=1.0, location=location)
    obj = bpy.context.object; obj.name = name
    obj.scale = tuple(scale[i] * rng.uniform(0.87, 1.12) for i in range(3))
    obj.rotation_euler = (rng.uniform(-0.09, 0.09), rng.uniform(-0.09, 0.09), rng.uniform(-0.16, 0.16))
    for vertex in obj.data.vertices:
        vertex.co *= 1.0 + rng.uniform(-0.06, 0.06)
    parts.append(finish_part(obj, "stone", name, material, smooth=True))


def masonry_stone(parts, name, location, dimensions, material, rng):
    bpy.ops.mesh.primitive_cube_add(location=location)
    obj = bpy.context.object; obj.name = name
    obj.dimensions = tuple(dimensions[i] * rng.uniform(0.91, 1.08) for i in range(3))
    obj.rotation_euler = (rng.uniform(-0.035, 0.035), rng.uniform(-0.035, 0.035), rng.uniform(-0.055, 0.055))
    parts.append(finish_part(obj, "stone", name, material, min(dimensions) * 0.16, 3))


def beam(parts, name, location, dimensions, material, rotation=(0.0, 0.0, 0.0), lighter=False):
    obj = box(parts, name, location, dimensions, "wood", material, min(dimensions) * 0.14, rotation)
    rng = random.Random(name)
    for vertex in obj.data.vertices:
        vertex.co.x += math.sin(vertex.co.z * 1.7 + rng.random()) * min(dimensions) * 0.025
        vertex.co.y += math.sin(vertex.co.z * 1.3 + rng.random()) * min(dimensions) * 0.018
    author_uv(obj, "wood")
    if lighter:
        for datum in obj.data.color_attributes[COLOR_ATTRIBUTE].data:
            datum.color = (1.0, 0.93, 0.78, 1.0)
    return obj


def curved_tile(parts, name, center, width, length, thickness, material, rng, rotation=(0.0, 0.0, 0.0), semantic="roof"):
    segments, arch = 5, width * rng.uniform(0.13, 0.19)
    vertices = []
    for z_offset in (0.0, -thickness):
        for longitudinal in (-0.5, 0.5):
            for index in range(segments + 1):
                across = index / segments - 0.5
                vertices.append((across * width, longitudinal * length, arch * (1.0 - (across * 2.0) ** 2) + z_offset))
    faces, row, layer = [], segments + 1, (segments + 1) * 2
    for index in range(segments):
        faces.extend(((index, index + 1, row + index + 1, row + index), (layer + index + 1, layer + index, layer + row + index, layer + row + index + 1)))
    for longitudinal in range(2):
        start, bottom = longitudinal * row, layer + longitudinal * row
        for index in range(segments):
            faces.append((start + index + 1, start + index, bottom + index, bottom + index + 1))
    faces.extend(((0, row, layer + row, layer), (row - 1, layer - 1, layer * 2 - 1, layer + row - 1)))
    mesh = bpy.data.meshes.new(f"{name}_mesh"); mesh.from_pydata(vertices, [], faces); mesh.update()
    obj = bpy.data.objects.new(name, mesh); bpy.context.scene.collection.objects.link(obj)
    obj.location, obj.rotation_euler = center, rotation
    parts.append(finish_part(obj, semantic, name, material, smooth=True))


def curved_tube(parts, name, points, start_radius, end_radius, semantic, material, sides=9):
    vertices, faces, count = [], [], len(points)
    for index, point in enumerate(points):
        center = Vector(point)
        tangent = (Vector(points[1]) - center) if index == 0 else (center - Vector(points[index - 1])) if index == count - 1 else (Vector(points[index + 1]) - Vector(points[index - 1]))
        tangent.normalize()
        reference = Vector((0.0, 0.0, 1.0)) if abs(tangent.z) < 0.88 else Vector((0.0, 1.0, 0.0))
        normal, binormal = tangent.cross(reference).normalized(), None
        binormal = tangent.cross(normal).normalized()
        radius = start_radius + (end_radius - start_radius) * (index / (count - 1))
        for side in range(sides):
            angle = math.tau * side / sides
            vertices.append(tuple(center + (normal * math.cos(angle) + binormal * math.sin(angle)) * radius))
    for ring in range(count - 1):
        for side in range(sides):
            next_side = (side + 1) % sides
            a, b = ring * sides + side, ring * sides + next_side
            faces.append((a, b, (ring + 1) * sides + next_side, (ring + 1) * sides + side))
    faces.extend((tuple(reversed(range(sides))), tuple((count - 1) * sides + side for side in range(sides))))
    mesh = bpy.data.meshes.new(f"{name}_mesh"); mesh.from_pydata(vertices, [], faces); mesh.update()
    obj = bpy.data.objects.new(name, mesh); bpy.context.scene.collection.objects.link(obj)
    parts.append(finish_part(obj, semantic, name, material, smooth=True))


def bezier_points(start, control_a, control_b, end, segments=7):
    a, b, c, d = map(Vector, (start, control_a, control_b, end))
    return [tuple(a * (1 - t) ** 3 + b * (3 * (1 - t) ** 2 * t) + c * (3 * (1 - t) * t * t) + d * t ** 3) for t in (index / segments for index in range(segments + 1))]


def join_template(name: str, parts: list, material):
    bpy.ops.object.select_all(action="DESELECT")
    for part in parts:
        part.select_set(True)
    bpy.context.view_layer.objects.active = parts[0]; bpy.ops.object.join()
    root = bpy.context.object; root.name, root.data.name = name, f"{name}_mesh"
    root.location, root.rotation_euler, root.scale = (0.0, 0.0, 0.0), (0.0, 0.0, 0.0), (1.0, 1.0, 1.0)
    while len(root.data.materials) > 1:
        root.data.materials.pop(index=len(root.data.materials) - 1)
    if not root.data.materials:
        root.data.materials.append(material)
    root["footprintRadius"], root["templateKind"], root["groundedY"] = TEMPLATES[name]["footprintRadius"], name, 0.0
    triangulate = root.modifiers.new("Runtime triangles", "TRIANGULATE")
    bpy.context.view_layer.objects.active = root; bpy.ops.object.modifier_apply(modifier=triangulate.name)
    return root


def foundation(parts, name, width, depth, material, rng):
    for course, z in enumerate((-0.28, 0.34)):
        stone_width = 0.78 if course == 0 else 0.68
        count = math.ceil(width / stone_width)
        for side, y in (("front", -depth / 2), ("back", depth / 2)):
            for index in range(count):
                x = -width / 2 + ((index + 0.5 + course * 0.5) % count) * width / count
                masonry_stone(parts, f"{name}_foundation_{side}_{course}_{index:02}", (x, y, z + rng.uniform(-0.025, 0.025)), (width / count * 0.94, 0.48, 0.58), material, rng)
        side_count = max(4, math.ceil((depth - 0.7) / stone_width))
        for side, x in (("left", -width / 2), ("right", width / 2)):
            for index in range(side_count):
                y = -depth / 2 + 0.38 + ((index + 0.5 + course * 0.5) % side_count) * (depth - 0.76) / side_count
                masonry_stone(parts, f"{name}_foundation_{side}_{course}_{index:02}", (x, y, z + rng.uniform(-0.025, 0.025)), (0.48, (depth - 0.76) / side_count * 0.94, 0.58), material, rng)


def gable(parts, name, y, width, wall_top, rise, material):
    thickness = 0.18
    vertices = [(-width / 2, -thickness / 2, 0.0), (width / 2, -thickness / 2, 0.0), (0.0, -thickness / 2, rise), (-width / 2, thickness / 2, 0.0), (width / 2, thickness / 2, 0.0), (0.0, thickness / 2, rise)]
    faces = [(0, 1, 2), (5, 4, 3), (0, 3, 4, 1), (1, 4, 5, 2), (2, 5, 3, 0)]
    mesh = bpy.data.meshes.new(f"{name}_mesh"); mesh.from_pydata(vertices, [], faces); mesh.update()
    obj = bpy.data.objects.new(name, mesh); bpy.context.scene.collection.objects.link(obj); obj.location = (0.0, y, wall_top)
    parts.append(finish_part(obj, "plaster", name, material, 0.035, 2))


def end_gable(parts, name, x, depth, wall_top, rise, material):
    thickness = 0.18
    vertices = [(-thickness / 2, -depth / 2, 0.0), (-thickness / 2, depth / 2, 0.0), (-thickness / 2, 0.0, rise), (thickness / 2, -depth / 2, 0.0), (thickness / 2, depth / 2, 0.0), (thickness / 2, 0.0, rise)]
    faces = [(0, 1, 2), (5, 4, 3), (0, 3, 4, 1), (1, 4, 5, 2), (2, 5, 3, 0)]
    mesh = bpy.data.meshes.new(f"{name}_mesh"); mesh.from_pydata(vertices, [], faces); mesh.update()
    obj = bpy.data.objects.new(name, mesh); bpy.context.scene.collection.objects.link(obj); obj.location = (x, 0.0, wall_top)
    parts.append(finish_part(obj, "plaster", name, material, 0.035, 2))


def window(parts, name, x, y, z, width, height, face, material):
    if face == "front":
        box(parts, f"{name}_recess", (x, y + 0.08, z), (width, 0.13, height), "wood", material, 0.015)
        box(parts, f"{name}_sill", (x, y - 0.05, z - height / 2 - 0.09), (width + 0.32, 0.28, 0.16), "stone", material, 0.035)
        for offset in (-width / 2, width / 2): beam(parts, f"{name}_frame_v_{offset}", (x + offset, y - 0.045, z), (0.13, 0.16, height + 0.24), material, lighter=True)
        for offset in (-height / 2, height / 2, 0.0): beam(parts, f"{name}_frame_h_{offset}", (x, y - 0.05, z + offset), (width + 0.24, 0.16, 0.12), material, lighter=True)
    else:
        box(parts, f"{name}_recess", (x - 0.08, y, z), (0.13, width, height), "wood", material, 0.015)
        box(parts, f"{name}_sill", (x + 0.05, y, z - height / 2 - 0.09), (0.28, width + 0.32, 0.16), "stone", material, 0.035)
        for offset in (-width / 2, width / 2): beam(parts, f"{name}_frame_v_{offset}", (x + 0.045, y + offset, z), (0.16, 0.13, height + 0.24), material, lighter=True)
        for offset in (-height / 2, height / 2, 0.0): beam(parts, f"{name}_frame_h_{offset}", (x + 0.05, y, z + offset), (0.16, width + 0.24, 0.12), material, lighter=True)


def tiled_roof(parts, name, width, depth, wall_top, rise, material, rng, tile_size=0.55):
    eave, half_depth = wall_top + 0.12, depth / 2
    slope_length = math.hypot(half_depth, rise)
    rows, columns, angle = max(7, math.ceil(slope_length / (tile_size * 0.70))), max(10, math.ceil(width / tile_size)), math.atan2(rise, half_depth)
    for side in (-1, 1):
        y, z = side * half_depth * 0.5, eave + rise * 0.5 - 0.08
        underlay = box(parts, f"{name}_roof_underlay_{side}", (0.0, y, z), (width + 0.05, slope_length + 0.08, 0.08), "roof", material, 0.02, (side * -angle, 0.0, 0.0))
        for datum in underlay.data.color_attributes[COLOR_ATTRIBUTE].data: datum.color = (0.72, 0.68, 0.62, 1.0)
        for row in range(rows):
            t = (row + 0.5) / rows; y, z = side * (half_depth * (1.0 - t)), eave + rise * t
            row_columns = columns + row % 2; tile_width = width / row_columns
            for column in range(row_columns):
                x = -width / 2 + (column + 0.5) * tile_width + (row % 2) * tile_width * 0.18
                curved_tile(parts, f"{name}_tile_{side}_{row:02}_{column:02}", (x + rng.uniform(-0.018, 0.018), y, z + rng.uniform(-0.022, 0.022)), tile_width * rng.uniform(0.92, 1.02), slope_length / rows * 1.18 * rng.uniform(0.95, 1.06), 0.045, material, rng, (side * -angle, 0.0, rng.uniform(-0.018, 0.018)))
    ridge_count = max(12, math.ceil(width / 0.46))
    for index in range(ridge_count):
        x0, x1 = -width / 2 + index * width / ridge_count, -width / 2 + (index + 1.08) * width / ridge_count
        curved_tube(parts, f"{name}_ridge_{index:02}", [(x0, 0, eave + rise + 0.06), ((x0 + x1) / 2, 0, eave + rise + 0.10), (x1, 0, eave + rise + 0.06)], 0.15, 0.15, "roof", material, 9)


def chimney(parts, name, x, y, base_z, material, rng):
    for layer in range(5):
        for index in range(2):
            horizontal = layer % 2 == 0
            offset = (index - 0.5) * 0.39
            masonry_stone(parts, f"{name}_{layer}_{index}",
                          (x + (offset if horizontal else 0), y + (0 if horizontal else offset), base_z + layer * 0.27),
                          (0.37, 0.77, 0.25) if horizontal else (0.77, 0.37, 0.25), material, rng)
    box(parts, f"{name}_cap", (x, y, base_z + 1.42), (0.92, 0.76, 0.18), "stone", material, 0.07)


def dormer(parts, name, x, roof_y, roof_z, material, rng):
    width, height = 1.05, 0.72
    front = roof_y - 0.32
    box(parts, f"{name}_cheeks", (x, roof_y + 0.13, roof_z + 0.25), (width, 0.9, 0.95), "plaster", material, 0.025)
    window(parts, f"{name}_window", x, front - 0.06, roof_z + height * 0.45, 0.57, 0.53, "front", material)
    gable(parts, f"{name}_gable", front, width, roof_z + height, 0.38, material)
    for vertex in parts[-1].data.vertices:
        vertex.co.x += x
    author_uv(parts[-1], "plaster")
    for side in (-1, 1):
        for row in range(3):
            for column in range(3):
                curved_tile(parts, f"{name}_tile_{side}_{row}_{column}",
                            (x + side * (0.50 - row * 0.19), front + column * 0.30 + 0.03,
                             roof_z + height + 0.08 + row * 0.13),
                            0.33, 0.30, 0.035, material, rng, (side * 0.60, 0.0, math.pi / 2))
        beam(parts, f"{name}_barge_{side}",
             (x + side * 0.27, front - 0.11, roof_z + height + 0.21),
             (0.69, 0.12, 0.11), material, (0.0, side * 0.60, 0.0), True)


def awning_cloth(parts, name, center, width, depth, material):
    columns, rows = 9, 5; vertices, faces = [], []
    for row in range(rows + 1):
        y = center[1] - depth / 2 + depth * row / rows
        for column in range(columns + 1):
            x = center[0] - width / 2 + width * column / columns
            sag = -0.24 * math.sin(math.pi * column / columns) * math.sin(math.pi * row / rows)
            ripple = 0.025 * math.sin(column * 2.4 + row * 1.7)
            vertices.append((x, y, center[2] + sag + ripple))
    for row in range(rows):
        for column in range(columns):
            a = row * (columns + 1) + column; faces.append((a, a + 1, a + columns + 2, a + columns + 1))
    mesh = bpy.data.meshes.new(f"{name}_mesh"); mesh.from_pydata(vertices, [], faces); mesh.update()
    obj = bpy.data.objects.new(name, mesh); bpy.context.scene.collection.objects.link(obj); parts.append(finish_part(obj, "cloth", name, material, smooth=True))


def build_building(name, width, depth, wall_top, roof_rise, hall, material):
    rng, parts = random.Random(f"ashveil-{name}"), []
    foundation(parts, name, width, depth, material, rng)
    box(parts, f"{name}_plaster", (0.0, 0.0, wall_top / 2 + 0.47), (width - 0.42, depth - 0.42, wall_top - 0.58), "plaster", material, 0.10)
    end_gable(parts, f"{name}_gable_left", -width / 2 + 0.18, depth - 0.42, wall_top, roof_rise * 0.87, material)
    end_gable(parts, f"{name}_gable_right", width / 2 - 0.18, depth - 0.42, wall_top, roof_rise * 0.87, material)
    for x in (-width / 2 + 0.17, 0.0, width / 2 - 0.17):
        lean = rng.uniform(-0.025, 0.025)
        beam(parts, f"{name}_front_post_{x}", (x, -depth / 2 - 0.015, wall_top / 2 + 0.34), (0.23, 0.22, wall_top - 0.42), material, (0.0, lean, 0.0))
        beam(parts, f"{name}_back_post_{x}", (x, depth / 2 + 0.015, wall_top / 2 + 0.34), (0.23, 0.22, wall_top - 0.42), material, (0.0, -lean, 0.0))
    for y in (-depth / 2 + 0.22, 0.0, depth / 2 - 0.22):
        beam(parts, f"{name}_left_post_{y}", (-width / 2 - 0.015, y, wall_top / 2 + 0.34), (0.22, 0.23, wall_top - 0.42), material)
        beam(parts, f"{name}_right_post_{y}", (width / 2 + 0.015, y, wall_top / 2 + 0.34), (0.22, 0.23, wall_top - 0.42), material)
    for z in (0.72, wall_top - 0.22):
        beam(parts, f"{name}_front_band_{z}", (0.0, -depth / 2 - 0.025, z), (width, 0.24, 0.21), material)
        beam(parts, f"{name}_back_band_{z}", (0.0, depth / 2 + 0.025, z), (width, 0.24, 0.21), material)
        beam(parts, f"{name}_left_band_{z}", (-width / 2 - 0.025, 0.0, z), (0.24, depth, 0.21), material)
        beam(parts, f"{name}_right_band_{z}", (width / 2 + 0.025, 0.0, z), (0.24, depth, 0.21), material)
    diagonal_length, diagonal_angle = math.hypot(width * 0.35, 1.18), math.atan2(1.18, width * 0.35)
    for side in (-1, 1):
        beam(parts, f"{name}_brace_{side}", (side * width * 0.32, -depth / 2 - 0.05, 1.45), (diagonal_length, 0.18, 0.17), material, (0.0, diagonal_angle * side, 0.0), True)
    door_x, door_height, door_base = (-width * 0.19 if hall else width * 0.20), (2.12 if hall else 2.02), 0.30
    box(parts, f"{name}_door_recess", (door_x, -depth / 2 + 0.09, door_base + door_height / 2), (1.04, 0.15, door_height + 0.06), "wood", material, 0.06)
    for plank in range(5):
        beam(parts, f"{name}_door_plank_{plank}", (door_x - 0.405 + plank * 0.2025, -depth / 2 - 0.015, door_base + door_height / 2), (0.185, 0.11, door_height - 0.05), material, lighter=plank % 3 == 0)
    beam(parts, f"{name}_door_left", (door_x - 0.59, -depth / 2 - 0.10, door_base + door_height / 2), (0.18, 0.20, door_height + 0.30), material)
    beam(parts, f"{name}_door_right", (door_x + 0.59, -depth / 2 - 0.10, door_base + door_height / 2), (0.18, 0.20, door_height + 0.30), material)
    beam(parts, f"{name}_door_top", (door_x, -depth / 2 - 0.10, door_base + door_height + 0.13), (1.36, 0.21, 0.22), material)
    bpy.ops.mesh.primitive_uv_sphere_add(segments=12, ring_count=6, radius=0.055, location=(door_x + 0.35, -depth / 2 - 0.10, 1.56))
    latch = bpy.context.object; latch.name = f"{name}_door_latch"; parts.append(finish_part(latch, "stone", latch.name, material, smooth=True))
    window_x = width * 0.27 if hall else -width * 0.23
    window(parts, f"{name}_front_window", window_x, -depth / 2 - 0.07, 2.0, 1.1, 1.25, "front", material)
    window(parts, f"{name}_side_window", width / 2 + 0.07, 0.32, 1.9, 1.05, 1.2, "side", material)
    window(parts, f"{name}_back_window", -width * 0.22, depth / 2 + 0.07, 1.9, 1.05, 1.15, "front", material)
    roof_width, roof_depth = width + 0.54, depth + 0.62
    tiled_roof(parts, name, roof_width, roof_depth, wall_top, roof_rise, material, rng, 0.55 if hall else 0.50)
    chimney_y = depth * 0.12; chimney_roof_z = wall_top + 0.12 + roof_rise * (1.0 - abs(chimney_y) / (roof_depth / 2))
    chimney(parts, f"{name}_chimney", -width * 0.29, chimney_y, chimney_roof_z - 0.08, material, rng)
    dormer_y = -depth * 0.22; dormer_roof_z = wall_top + 0.12 + roof_rise * (1.0 - abs(dormer_y) / (roof_depth / 2))
    dormer(parts, f"{name}_dormer", width * 0.18, dormer_y, dormer_roof_z, material, rng)
    if hall:
        porch_width, porch_front = 3.4, -3.58
        for x in (-porch_width / 2, porch_width / 2): beam(parts, f"{name}_porch_post_{x}", (x, porch_front, 1.55), (0.24, 0.24, 3.1), material, lighter=True)
        beam(parts, f"{name}_porch_header", (0.0, porch_front, 3.0), (porch_width + 0.4, 0.27, 0.28), material, lighter=True)
        awning_cloth(parts, f"{name}_awning_cloth", (0.0, -3.25, 3.05), porch_width + 0.18, 1.35, material)
        for step in range(3): box(parts, f"{name}_step_{step}", (door_x, -depth / 2 - 0.45 - step * 0.34, 0.52 - step * 0.16), (1.8 + step * 0.32, 0.52, 0.22), "stone", material, 0.06)
    else:
        beam(parts, f"{name}_canopy_left", (door_x - 0.78, -depth / 2 - 0.55, 2.42), (0.14, 1.0, 0.14), material, (0.18, 0.0, 0.0), True)
        beam(parts, f"{name}_canopy_right", (door_x + 0.78, -depth / 2 - 0.55, 2.42), (0.14, 1.0, 0.14), material, (0.18, 0.0, 0.0), True)
        for index in range(5): curved_tile(parts, f"{name}_canopy_tile_{index}", (door_x - 0.72 + index * 0.36, -depth / 2 - 0.58, 2.55), 0.40, 1.07, 0.045, material, rng, (0.18, 0.0, 0.0))
        for step in range(2): box(parts, f"{name}_step_{step}", (door_x, -depth / 2 - 0.34 - step * 0.3, 0.46 - step * 0.2), (1.5 + step * 0.28, 0.48, 0.24), "stone", material, 0.06)
    return join_template(name, parts, material)


def leaf_fan(parts, name, anchor, direction, material, rng, orchard):
    direction = Vector(direction).normalized(); vertices, faces = [], []
    for index in range(9 if orchard else 10):
        offset = Vector((rng.uniform(-0.42, 0.42), rng.uniform(-0.42, 0.42), rng.uniform(-0.34, 0.34)))
        center = Vector(anchor) + offset
        length = rng.uniform(0.25, 0.36) if orchard else rng.uniform(0.28, 0.40); width = length * rng.uniform(0.48, 0.64)
        leaf_axis = Vector((rng.uniform(-1, 1), rng.uniform(-1, 1), rng.uniform(-0.32, 0.72))).normalized()
        normal = Vector((rng.uniform(-0.45, 0.45), rng.uniform(-0.45, 0.45), 1.0)).normalized()
        leaf_side = normal.cross(leaf_axis)
        if leaf_side.length < 0.1: leaf_side = Vector((1.0, 0.0, 0.0))
        leaf_side.normalize(); normal = leaf_axis.cross(leaf_side).normalized(); start = len(vertices)
        vertices.append(tuple(center + normal * width * 0.08))
        for segment in range(8):
            angle = math.tau * segment / 8
            vertices.append(tuple(center + leaf_axis * math.cos(angle) * length * 0.5 + leaf_side * math.sin(angle) * width * 0.5 + normal * math.sin(angle * 2) * width * 0.06))
        for segment in range(8): faces.append((start, start + 1 + segment, start + 1 + (segment + 1) % 8))
    mesh = bpy.data.meshes.new(f"{name}_mesh"); mesh.from_pydata(vertices, [], faces); mesh.update()
    obj = bpy.data.objects.new(name, mesh); bpy.context.scene.collection.objects.link(obj); parts.append(finish_part(obj, "leaves", name, material, smooth=True))


def merge_organic_bark(bark_parts, name, material):
    bpy.ops.object.select_all(action="DESELECT")
    for part in bark_parts: part.select_set(True)
    bpy.context.view_layer.objects.active = bark_parts[0]; bpy.ops.object.join()
    bark = bpy.context.object; bark.name = f"{name}_organic_bark"
    remesh = bark.modifiers.new("Union and soften living forks", "REMESH")
    remesh.mode, remesh.voxel_size, remesh.use_smooth_shade = "VOXEL", 0.075, True
    bpy.ops.object.modifier_apply(modifier=remesh.name)
    decimate = bark.modifiers.new("Retain organic silhouette", "DECIMATE"); decimate.ratio = 0.72
    bpy.ops.object.modifier_apply(modifier=decimate.name)
    bark.data.materials.clear()
    while bark.data.color_attributes: bark.data.color_attributes.remove(bark.data.color_attributes[0])
    while bark.data.uv_layers: bark.data.uv_layers.remove(bark.data.uv_layers[0])
    return finish_part(bark, "bark", bark.name, material, smooth=True)


def build_tree(name, orchard, material):
    rng, parts, bark_parts = random.Random(f"ashveil-{name}"), [], []
    trunk_top = 3.65 if orchard else 4.45
    curved_tube(bark_parts, f"{name}_trunk", bezier_points((0, 0, -0.06), (0.18, -0.12, 1.15), (-0.19, 0.17, 2.65), (0.13, -0.03, trunk_top), 11), 0.45 if orchard else 0.52, 0.16 if orchard else 0.19, "bark", material, 12)
    root_ends = ((0.96, 0.12, -0.04), (-0.83, 0.52, -0.03), (0.18, -1.02, -0.04), (-0.62, -0.76, -0.05), (0.72, 0.67, -0.04), (0.02, 0.94, -0.06))
    for index, end in enumerate(root_ends):
        curved_tube(bark_parts, f"{name}_root_{index:02}", [(0.0, 0.0, 0.34), (end[0] * 0.34, end[1] * 0.34, 0.20), (end[0] * 0.72, end[1] * 0.72, 0.04), end], 0.25 if orchard else 0.29, 0.028, "bark", material, 9)
    if orchard:
        specifications = [
            ((-0.07, 0.02, 1.95), (-1.45, 0.22, 4.05)), ((0.08, -0.02, 2.30), (1.65, -0.12, 4.35)),
            ((-0.02, -0.03, 2.72), (-0.50, -1.35, 4.70)), ((0.08, 0.05, 3.04), (0.75, 1.20, 4.95)),
            ((0.10, -0.02, 3.42), (0.18, -0.42, 5.35)),
        ]
    else:
        specifications = [
            ((-0.08, 0.03, 2.25), (-1.72, 0.28, 4.55)), ((0.05, -0.03, 2.62), (1.98, -0.24, 4.95)),
            ((-0.04, -0.02, 3.00), (-0.62, -1.65, 5.35)), ((0.07, 0.04, 3.28), (0.92, 1.50, 5.72)),
            ((0.10, -0.02, 3.66), (0.35, -0.58, 6.62)), ((-0.04, 0.02, 3.85), (-2.58, 0.66, 5.62)),
            ((0.08, -0.01, 4.03), (2.72, -0.50, 5.90)), ((0.03, 0.00, 4.18), (-0.34, 1.12, 6.85)),
        ]
    tips, twig_origins = [], []
    for index, (start, end) in enumerate(specifications):
        path = bezier_points(start, (start[0] + end[0] * 0.18, start[1] + end[1] * 0.16, start[2] + 0.55), (end[0] * 0.68, end[1] * 0.66, end[2] - 0.35), end, 8)
        curved_tube(bark_parts, f"{name}_branch_{index:02}", path, 0.23 if orchard else 0.27, 0.065, "bark", material, 9)
        tips.append(Vector(end))
        twig_origins.extend(Vector(point) for point in path[4::2])
    parts.append(merge_organic_bark(bark_parts, name, material))
    fan_count = 170 if orchard else 230
    crown_center = Vector((-0.10, 0.03, 4.65 if orchard else 5.65)); crown_scale = Vector((2.35, 1.82, 1.35) if orchard else (3.25, 2.35, 1.70))
    for index in range(fan_count):
        angle = math.tau * index / fan_count + rng.uniform(-0.15, 0.15); radial = math.sqrt(rng.random())
        anchor = crown_center + Vector((math.cos(angle) * crown_scale.x * radial, math.sin(angle) * crown_scale.y * radial, rng.uniform(-1.0, 1.0) * crown_scale.z * (0.65 + radial * 0.35)))
        branch = min(twig_origins, key=lambda point: (point - anchor).length); outward = (anchor - branch).normalized(); twig_end = anchor + outward * rng.uniform(0.24, 0.42)
        curved_tube(parts, f"{name}_twig_{index:03}", [tuple(branch), tuple((branch + anchor) * 0.5 + Vector((0, 0, 0.10))), tuple(anchor), tuple(twig_end)], 0.035, 0.010, "bark", material, 6)
        leaf_fan(parts, f"{name}_leaf_fan_{index:03}", anchor, outward, material, rng, orchard)
    if orchard:
        for index in range(18):
            angle, radius = rng.uniform(0, math.tau), rng.uniform(0.7, 1.8)
            bpy.ops.mesh.primitive_uv_sphere_add(segments=10, ring_count=6, radius=0.105, location=(math.cos(angle) * radius, math.sin(angle) * radius * 0.72, rng.uniform(3.45, 5.7)))
            apple = bpy.context.object; apple.name = f"{name}_apple_{index:02}"; parts.append(finish_part(apple, "roof", apple.name, material, smooth=True))
    return join_template(name, parts, material)


def bounds_runtime(obj):
    points = [vertex.co for vertex in obj.data.vertices]
    return {"minimum": [round(v, 6) for v in (min(p.x for p in points), min(p.z for p in points), min(-p.y for p in points))], "maximum": [round(v, 6) for v in (max(p.x for p in points), max(p.z for p in points), max(-p.y for p in points))]}


def triangle_count(obj) -> int:
    return sum(len(polygon.vertices) - 2 for polygon in obj.data.polygons)


def validate(roots) -> None:
    if sorted(root.name for root in roots) != sorted(TEMPLATES): raise RuntimeError("root gate: exported root names do not match the runtime contract")
    for root in roots:
        if root.type != "MESH": raise RuntimeError(f"root gate: {root.name} is not a mesh")
        if tuple(root.location) != (0.0, 0.0, 0.0) or tuple(root.scale) != (1.0, 1.0, 1.0): raise RuntimeError(f"transform gate: {root.name} does not have identity TRS")
        if any(abs(value) > 1e-7 for value in root.rotation_euler): raise RuntimeError(f"transform gate: {root.name} carries rotation")
        if len(root.data.materials) != 1 or root.data.materials[0].name != MATERIAL_NAME: raise RuntimeError(f"material gate: {root.name} must use one shared PBR atlas material")
        if COLOR_ATTRIBUTE not in root.data.color_attributes or not root.data.uv_layers: raise RuntimeError(f"attribute gate: {root.name} requires UVMap and {COLOR_ATTRIBUTE}")
        triangles = triangle_count(root)
        if triangles > TEMPLATES[root.name]["runawayTriangleCap"]: raise RuntimeError(f"runaway triangle gate: {root.name} has {triangles} triangles")
        footprint = TEMPLATES[root.name]["footprintRadius"]
        radial = max(math.hypot(vertex.co.x, vertex.co.y) for vertex in root.data.vertices if root.name in ("refuge_hall", "cottage") or vertex.co.z <= TREE_GROUND_ZONE_CUTOFF)
        if radial > footprint + 1e-5: raise RuntimeError(f"footprint gate: {root.name} reaches {radial:.4f}m outside {footprint:.2f}m")


def export(roots) -> None:
    PUBLIC.mkdir(parents=True, exist_ok=True); bpy.ops.object.select_all(action="DESELECT")
    for root in roots:
        root.data.validate(verbose=True, clean_customdata=False)
        root.data.update(calc_edges=True)
        root.select_set(True)
    bpy.context.view_layer.objects.active = roots[0]
    bpy.ops.export_scene.gltf(
        filepath=str(GLB),
        export_format="GLB",
        use_selection=True,
        export_yup=True,
        export_animations=False,
        export_materials="EXPORT",
        export_attributes=True,
        export_extras=True,
        export_apply=False,
        export_image_format="AUTO",
        export_vertex_color="NAME",
        export_vertex_color_name=COLOR_ATTRIBUTE,
        export_all_vertex_colors=False,
    )


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1 << 20), b""): digest.update(chunk)
    return digest.hexdigest()


def atlas_manifest() -> dict:
    semantic_rects = {}
    for semantic in SEMANTIC_REGIONS:
        u0, v0, u1, v1 = atlas_rect(semantic)
        semantic_rects[semantic] = {
            "uvMinimum": [round(u0, 8), round(1.0 - v1, 8)],
            "uvMaximum": [round(u1, 8), round(1.0 - v0, 8)],
        }
    return {
        "dimensions": [ATLAS_SIZE, ATLAS_SIZE],
        "gutterPixels": ATLAS_GUTTER,
        "uvOrigin": "topLeft",
        "uvConvention": "Exported glTF TEXCOORD_0; V is flipped from Blender's bottom-left image convention.",
        "semanticRects": semantic_rects,
        "images": [
            {"name": "scenery-atlas-basecolor", "embeddedFile": ATLAS_FILES["baseColor"].name, "sha256": sha256(ATLAS_FILES["baseColor"]), "encodedBytes": ATLAS_FILES["baseColor"].stat().st_size, "decodedRgbaBytes": ATLAS_SIZE * ATLAS_SIZE * 4, "colorSpace": "sRGB", "nativeChannels": ["R", "G", "B"], "channels": {"rgb": "baseColor"}, "opacityFactor": 1.0},
            {"name": "scenery-atlas-orm", "embeddedFile": ATLAS_FILES["orm"].name, "sha256": sha256(ATLAS_FILES["orm"]), "encodedBytes": ATLAS_FILES["orm"].stat().st_size, "decodedRgbaBytes": ATLAS_SIZE * ATLAS_SIZE * 4, "colorSpace": "linear", "nativeChannels": ["R", "G", "B"], "channels": {"r": "ambientOcclusion", "g": "roughness", "b": "metallic"}},
            {"name": "scenery-atlas-normal", "embeddedFile": ATLAS_FILES["normal"].name, "sha256": sha256(ATLAS_FILES["normal"]), "encodedBytes": ATLAS_FILES["normal"].stat().st_size, "decodedRgbaBytes": ATLAS_SIZE * ATLAS_SIZE * 4, "colorSpace": "linear", "nativeChannels": ["R", "G", "B"], "channels": {"rgb": "tangentNormal"}},
        ],
    }


def write_manifest(roots) -> None:
    document = {
        "schema": "ashveil.scenery-kit.v2", "version": 2, "generator": "scripts/art/scenery/generate_first_zone.py",
        "asset": {"file": GLB.name, "sha256": sha256(GLB), "bytes": GLB.stat().st_size}, "coordinateFrame": {"up": "+Y", "front": "+Z", "units": "metres"}, "treeGroundZoneCutoff": TREE_GROUND_ZONE_CUTOFF,
        "material": {"name": MATERIAL_NAME, "vertexColorAttribute": "COLOR_0", "uvAttribute": "TEXCOORD_0", "bindings": {"baseColor": "baseColorTexture", "orm": ["occlusionTexture", "metallicRoughnessTexture"], "normal": "normalTexture"}, "atlas": atlas_manifest()},
        "references": [
            {"file": "docs/art-pipeline/concepts/opening-chapter/environment-kit.png", "sha256": sha256(ROOT / "docs/art-pipeline/concepts/opening-chapter/environment-kit.png")},
            {"file": "public/bodies/masculine-v3/masculine-v3.glb", "sha256": sha256(ROOT / "public/bodies/masculine-v3/masculine-v3.glb")},
        ],
        "scaleProof": {"body": "public/bodies/masculine-v3/masculine-v3.glb", "measuredBodyHeightMetres": 1.8, "renders": [str(PROOF_CLOSE.relative_to(ROOT)), str(PROOF_PLAY.relative_to(ROOT))]},
        "templates": [{"id": root.name, "nodeType": "mesh", "identityTRS": True, "groundedY": 0.0, "footprintRadius": TEMPLATES[root.name]["footprintRadius"], "vertices": len(root.data.vertices), "triangles": triangle_count(root), "advisoryTriangles": TEMPLATES[root.name]["advisoryTriangles"], "runawayTriangleCap": TEMPLATES[root.name]["runawayTriangleCap"], "materials": 1, "bounds": bounds_runtime(root)} for root in roots],
    }
    MANIFEST.write_text(json.dumps(document, indent=2) + "\n")


def review_material(name, color, roughness=0.82):
    material = bpy.data.materials.new(name); material.diffuse_color = (*color, 1.0); material.use_nodes = True
    shader = material.node_tree.nodes.get("Principled BSDF"); shader.inputs["Base Color"].default_value, shader.inputs["Roughness"].default_value = (*color, 1.0), roughness
    return material


def setup_review_scene():
    ground_material = review_material("review_ground_material", (0.11, 0.145, 0.065), 0.93)
    box([], "review_ground", (0.0, 0.0, -0.28), (26.0, 22.0, 0.5), "leaves", ground_material, 0.10)
    world = bpy.context.scene.world; world.use_nodes = True
    background = world.node_tree.nodes.get("Background"); background.inputs["Color"].default_value, background.inputs["Strength"].default_value = (0.055, 0.075, 0.090, 1.0), 0.52
    def light(name, location, energy, size, color):
        data = bpy.data.lights.new(name, "AREA"); data.energy, data.shape, data.size, data.color = energy, "DISK", size, color
        obj = bpy.data.objects.new(name, data); obj.location = location; obj.rotation_euler = (Vector((0.0, 0.0, 3.0)) - obj.location).to_track_quat("-Z", "Y").to_euler(); bpy.context.scene.collection.objects.link(obj); return obj
    lights = [light("Warm key", (-5.0, -9.0, 14.0), 2200, 7.0, (1.0, 0.79, 0.57)), light("Sky fill", (9.0, -4.0, 10.0), 2100, 9.0, (0.58, 0.72, 0.88)), light("Rim", (0.0, 8.0, 12.0), 1500, 6.0, (1.0, 0.72, 0.42))]
    camera_data = bpy.data.cameras.new("Kit review"); camera_data.lens = 56
    camera = bpy.data.objects.new("Kit review", camera_data); bpy.context.scene.collection.objects.link(camera)
    scene = bpy.context.scene; scene.camera, scene.render.engine = camera, "BLENDER_EEVEE"
    scene.render.resolution_x, scene.render.resolution_y, scene.render.resolution_percentage = 960, 640, 100
    scene.render.image_settings.file_format, scene.render.film_transparent, scene.view_settings.look = "PNG", False, "AgX - Medium High Contrast"
    return camera, lights


def point_camera(camera, location, target, lens):
    camera.location, camera.data.lens = location, lens; camera.rotation_euler = (Vector(target) - camera.location).to_track_quat("-Z", "Y").to_euler()


def import_scaled_body(location, collection=None):
    before = set(bpy.context.scene.objects); bpy.ops.import_scene.gltf(filepath=str(ROOT / "public" / "bodies" / "masculine-v3" / "masculine-v3.glb"))
    imported = [obj for obj in bpy.context.scene.objects if obj not in before]; meshes = [obj for obj in imported if obj.type == "MESH"]
    corners = [mesh.matrix_world @ Vector(corner) for mesh in meshes for corner in mesh.bound_box]
    minimum_z, maximum_z = min(point.z for point in corners), max(point.z for point in corners); scale = 1.8 / (maximum_z - minimum_z)
    parent = bpy.data.objects.new("masculine-v3-scale-reference", None); bpy.context.scene.collection.objects.link(parent)
    for obj in imported:
        if obj.parent is None:
            matrix = obj.matrix_world.copy(); obj.parent = parent; obj.matrix_world = matrix
    parent.scale, parent.location = (scale, scale, scale), Vector(location) - Vector((0.0, 0.0, minimum_z * scale))
    return parent, imported


def delete_objects(objects):
    for obj in objects:
        if obj and obj.name in bpy.context.scene.objects: bpy.data.objects.remove(obj, do_unlink=True)


def render_body_scale_proofs(cottage, alder):
    cottage.location, alder.location = (-3.2, 1.1, 0.0), (3.7, 0.9, 0.0)
    body_parent, imported = import_scaled_body((0.45, -1.8, 0.0)); camera, lights = setup_review_scene()
    point_camera(camera, (13.0, -21.0, 11.0), (0.0, 0.3, 3.65), 56); bpy.context.scene.render.filepath = str(PROOF_CLOSE); bpy.ops.render.render(write_still=True); print(f"PROOF_CLOSE={PROOF_CLOSE}", flush=True)
    point_camera(camera, (18.0, -30.0, 16.0), (0.0, 0.8, 3.65), 62); bpy.context.scene.render.filepath = str(PROOF_PLAY); bpy.ops.render.render(write_still=True); print(f"PROOF_PLAY={PROOF_PLAY}", flush=True)
    cottage.location, alder.location = (0.0, 0.0, 0.0), (0.0, 0.0, 0.0)
    delete_objects(imported + [body_parent, camera, *lights, bpy.data.objects.get("review_ground")])


def render_contact_sheet(roots) -> None:
    import numpy as np
    camera, lights = setup_review_scene(); scene = bpy.context.scene; scene.render.resolution_x, scene.render.resolution_y = 800, 600; tiles = {}
    with tempfile.TemporaryDirectory(prefix="ashveil-scenery-review-") as scratch:
        for root in roots:
            for candidate in roots: candidate.hide_render = candidate is not root
            points = [vertex.co for vertex in root.data.vertices]; minimum = Vector(tuple(min(point[i] for point in points) for i in range(3))); maximum = Vector(tuple(max(point[i] for point in points) for i in range(3))); size, target = maximum - minimum, Vector((0.0, 0.0, (minimum.z + maximum.z) * 0.5))
            point_camera(camera, target + Vector((0.58, -1.0, 0.48)).normalized() * max(size.z * 3.0, size.x * 2.5, size.y * 3.6), target, 58)
            path = Path(scratch) / f"{root.name}.png"; scene.render.filepath = str(path); bpy.ops.render.render(write_still=True)
            image = bpy.data.images.load(str(path)); width, height = image.size; tiles[root.name] = np.array(image.pixels[:]).reshape(height, width, 4); bpy.data.images.remove(image)
    pixels = np.concatenate((np.concatenate((tiles["alder_tree"], tiles["orchard_tree"]), axis=1), np.concatenate((tiles["refuge_hall"], tiles["cottage"]), axis=1)), axis=0)
    sheet = bpy.data.images.new("First-zone scenery kit", width=pixels.shape[1], height=pixels.shape[0], alpha=True); sheet.pixels.foreach_set(pixels.astype(np.float32).ravel()); sheet.filepath_raw, sheet.file_format = str(CONTACT_SHEET), "PNG"; sheet.save(); bpy.data.images.remove(sheet)
    for root in roots: root.hide_render = False
    delete_objects([camera, *lights, bpy.data.objects.get("review_ground")])


def create_editable_review_scene(roots):
    source_collection = bpy.data.collections.new("EXPORT_SOURCE__4_IDENTITY_ROOTS"); bpy.context.scene.collection.children.link(source_collection)
    for root in roots:
        for collection in list(root.users_collection): collection.objects.unlink(root)
        source_collection.objects.link(root); root.hide_viewport, root.hide_render = True, True
    review_collection = bpy.data.collections.new("REVIEW_PRESENTATION__NOT_EXPORTED"); bpy.context.scene.collection.children.link(review_collection)
    positions = {"refuge_hall": (-5.7, 4.0, 0.0), "cottage": (4.2, 4.0, 0.0), "alder_tree": (-4.8, -5.0, 0.0), "orchard_tree": (4.4, -4.8, 0.0)}
    for root in roots:
        duplicate = root.copy(); duplicate.data = root.data.copy(); duplicate.name = f"review_{root.name}"; duplicate.location = positions[root.name]; duplicate.hide_viewport, duplicate.hide_render = False, False; review_collection.objects.link(duplicate)
    body_parent, imported = import_scaled_body((0.0, -1.7, 0.0))
    for obj in imported + [body_parent]:
        if obj is None: continue
        for collection in list(obj.users_collection): collection.objects.unlink(obj)
        review_collection.objects.link(obj)
    camera, lights = setup_review_scene(); point_camera(camera, (17.0, -24.0, 15.0), (0.0, 0.0, 3.2), 58)
    for obj in [camera, *lights, bpy.data.objects.get("review_ground")]:
        if obj:
            for collection in list(obj.users_collection): collection.objects.unlink(obj)
            review_collection.objects.link(obj)
    bpy.context.scene.camera = camera


def main() -> None:
    reset_scene(); images = generate_atlases(); material = pbr_atlas_material(images)
    cottage = build_building("cottage", 5.6, 3.9, 3.35, 1.95, False, material); alder = build_tree("alder_tree", False, material)
    render_body_scale_proofs(cottage, alder)
    hall = build_building("refuge_hall", 8.6, 5.4, 4.25, 2.45, True, material); orchard = build_tree("orchard_tree", True, material); roots = [hall, cottage, alder, orchard]
    validate(roots); export(roots); write_manifest(roots); render_contact_sheet(roots); create_editable_review_scene(roots); bpy.ops.wm.save_as_mainfile(filepath=str(BLEND))
    print(json.dumps({"glb": str(GLB), "manifest": str(MANIFEST), "blend": str(BLEND), "proofClose": str(PROOF_CLOSE), "proofPlayDistance": str(PROOF_PLAY), "contactSheet": str(CONTACT_SHEET), "templates": {root.name: {"vertices": len(root.data.vertices), "triangles": triangle_count(root)} for root in roots}}, indent=2))


if __name__ == "__main__":
    try: main()
    except Exception as error:
        print(f"SCENERY GENERATION FAILED: {error}", file=sys.stderr); raise
