"""Generate the authored first-zone scenery templates and their review artefacts."""

from __future__ import annotations

import hashlib
import json
import math
import random
import tempfile
import sys
from pathlib import Path

import bpy
from mathutils import Euler, Vector


ROOT = Path(__file__).resolve().parents[3]
PUBLIC = ROOT / "public" / "world" / "first-zone"
LOCAL = ROOT / "scripts" / "art" / "scenery" / ".output" / "first-zone"
GLB = PUBLIC / "scenery-kit.glb"
MANIFEST = PUBLIC / "scenery-kit.manifest.json"
BLEND = LOCAL / "scenery-kit.blend"
CONTACT_SHEET = LOCAL / "scenery-kit-contact-sheet.png"
COLOR_ATTRIBUTE = "Color"
MATERIAL_NAME = "scenery_vertex_color"

PALETTE = {
    "plaster": (0.72, 0.63, 0.44, 1.0),
    "plaster_light": (0.86, 0.78, 0.58, 1.0),
    "stone": (0.58, 0.54, 0.42, 1.0),
    "stone_light": (0.76, 0.70, 0.55, 1.0),
    "timber": (0.22, 0.12, 0.065, 1.0),
    "timber_light": (0.34, 0.20, 0.10, 1.0),
    "terracotta": (0.58, 0.20, 0.085, 1.0),
    "terracotta_light": (0.66, 0.27, 0.105, 1.0),
    "terracotta_dark": (0.46, 0.145, 0.055, 1.0),
    "teal": (0.035, 0.31, 0.29, 1.0),
    "glass": (0.055, 0.16, 0.16, 1.0),
    "leaf_dark": (0.075, 0.18, 0.045, 1.0),
    "leaf_mid": (0.17, 0.34, 0.08, 1.0),
    "leaf_light": (0.38, 0.49, 0.12, 1.0),
    "leaf_gold": (0.30, 0.38, 0.065, 1.0),
    "apple": (0.58, 0.055, 0.025, 1.0),
}

TEMPLATES = {
    "refuge_hall": {"footprintRadius": 6.0, "triangleBudget": 12000},
    "cottage": {"footprintRadius": 4.0, "triangleBudget": 10000},
    "alder_tree": {"footprintRadius": 1.1, "triangleBudget": 5000},
    "orchard_tree": {"footprintRadius": 1.1, "triangleBudget": 5000},
}


def reset_scene() -> None:
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    for collection in (bpy.data.meshes, bpy.data.materials, bpy.data.cameras, bpy.data.lights):
        for item in list(collection):
            collection.remove(item)


def vertex_color_material():
    material = bpy.data.materials.new(MATERIAL_NAME)
    material.use_nodes = True
    material.diffuse_color = PALETTE["plaster"]
    nodes = material.node_tree.nodes
    links = material.node_tree.links
    for node in list(nodes):
        nodes.remove(node)
    output = nodes.new("ShaderNodeOutputMaterial")
    shader = nodes.new("ShaderNodeBsdfPrincipled")
    attribute = nodes.new("ShaderNodeVertexColor")
    attribute.layer_name = COLOR_ATTRIBUTE
    shader.inputs["Roughness"].default_value = 0.84
    shader.inputs["Metallic"].default_value = 0.0
    links.new(attribute.outputs["Color"], shader.inputs["Base Color"])
    links.new(shader.outputs["BSDF"], output.inputs["Surface"])
    return material


def varied(color, amount: float, rng: random.Random):
    factor = 1.0 + rng.uniform(-amount, amount)
    return tuple(max(0.0, min(1.0, channel * factor)) for channel in color[:3]) + (1.0,)


def paint(obj, color, seed: str, variation: float = 0.06) -> None:
    rng = random.Random(seed)
    attribute = obj.data.color_attributes.get(COLOR_ATTRIBUTE)
    if attribute is None:
        attribute = obj.data.color_attributes.new(
            name=COLOR_ATTRIBUTE,
            type="BYTE_COLOR",
            domain="CORNER",
        )
    for polygon in obj.data.polygons:
        face_color = varied(color, variation, rng)
        for loop_index in polygon.loop_indices:
            attribute.data[loop_index].color = face_color


def finish_part(obj, color, seed: str, material, bevel: float = 0.0, smooth: bool = False):
    bpy.context.view_layer.objects.active = obj
    if bevel > 0:
        modifier = obj.modifiers.new("Softened handcrafted edge", "BEVEL")
        modifier.width = bevel
        modifier.segments = 1
        modifier.limit_method = "ANGLE"
        bpy.ops.object.modifier_apply(modifier=modifier.name)
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    for polygon in obj.data.polygons:
        polygon.use_smooth = smooth
    paint(obj, color, seed)
    obj.data.materials.append(material)
    return obj


def box(parts, name, location, dimensions, color, material, bevel=0.0, rotation=(0.0, 0.0, 0.0)):
    bpy.ops.mesh.primitive_cube_add(location=location, rotation=rotation)
    obj = bpy.context.object
    obj.name = name
    obj.dimensions = dimensions
    parts.append(finish_part(obj, color, name, material, bevel))
    return obj


def cone(parts, name, location, radius1, radius2, depth, vertices, color, material, rotation=(0.0, 0.0, 0.0), smooth=False):
    bpy.ops.mesh.primitive_cone_add(
        vertices=vertices,
        radius1=radius1,
        radius2=radius2,
        depth=depth,
        location=location,
        rotation=rotation,
    )
    obj = bpy.context.object
    obj.name = name
    parts.append(finish_part(obj, color, name, material, 0.0, smooth))
    return obj


def cylinder_between(parts, name, start, end, radius1, radius2, color, material, vertices=8, smooth=True):
    start_point = Vector(start)
    end_point = Vector(end)
    direction = end_point - start_point
    bpy.ops.mesh.primitive_cone_add(
        vertices=vertices,
        radius1=radius1,
        radius2=radius2,
        depth=direction.length,
        location=(start_point + end_point) * 0.5,
    )
    obj = bpy.context.object
    obj.name = name
    obj.rotation_euler = direction.to_track_quat("Z", "Y").to_euler()
    parts.append(finish_part(obj, color, name, material, 0.0, smooth))
    return obj


def ico(parts, name, location, scale, color, material, subdivisions=2):
    bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=subdivisions, radius=1.0, location=location)
    obj = bpy.context.object
    obj.name = name
    obj.scale = scale
    parts.append(finish_part(obj, color, name, material, 0.0, True))
    return obj


def join_template(name: str, parts: list, material):
    bpy.ops.object.select_all(action="DESELECT")
    for part in parts:
        part.select_set(True)
    bpy.context.view_layer.objects.active = parts[0]
    bpy.ops.object.join()
    root = bpy.context.object
    root.name = name
    root.data.name = f"{name}_mesh"
    root.location = (0.0, 0.0, 0.0)
    root.rotation_euler = (0.0, 0.0, 0.0)
    root.scale = (1.0, 1.0, 1.0)
    while len(root.data.materials) > 1:
        root.data.materials.pop(index=len(root.data.materials) - 1)
    if not root.data.materials:
        root.data.materials.append(material)
    root["footprintRadius"] = TEMPLATES[name]["footprintRadius"]
    root["templateKind"] = name
    root["groundedY"] = 0.0
    triangulate = root.modifiers.new("Runtime triangles", "TRIANGULATE")
    bpy.context.view_layer.objects.active = root
    bpy.ops.object.modifier_apply(modifier=triangulate.name)
    return root


def foundation(parts, name, width, depth, z, material, rng):
    stone_width = 0.82
    for side, y in (("front", -depth / 2), ("back", depth / 2)):
        count = math.ceil(width / stone_width)
        for index in range(count):
            x = -width / 2 + (index + 0.5) * width / count
            box(
                parts,
                f"{name}_foundation_{side}_{index:02}",
                (x, y, z + rng.uniform(-0.025, 0.025)),
                (width / count * 0.97, 0.44, 1.22 + rng.uniform(-0.05, 0.05)),
                PALETTE["stone_light"] if index % 3 else PALETTE["stone"],
                material,
                0.055,
            )
    count = max(3, math.ceil((depth - 0.8) / stone_width))
    for side, x in (("left", -width / 2), ("right", width / 2)):
        for index in range(count):
            y = -depth / 2 + 0.45 + (index + 0.5) * (depth - 0.9) / count
            box(
                parts,
                f"{name}_foundation_{side}_{index:02}",
                (x, y, z + rng.uniform(-0.025, 0.025)),
                (0.44, (depth - 0.9) / count * 0.96, 1.2 + rng.uniform(-0.05, 0.05)),
                PALETTE["stone_light"] if index % 2 else PALETTE["stone"],
                material,
                0.055,
            )


def beam(parts, name, location, dimensions, material, rotation=(0.0, 0.0, 0.0), light=False):
    return box(
        parts,
        name,
        location,
        dimensions,
        PALETTE["timber_light"] if light else PALETTE["timber"],
        material,
        0.025,
        rotation,
    )


def window(parts, name, x, y, z, width, height, face, material):
    thickness = 0.10
    if face == "front":
        box(parts, f"{name}_glass", (x, y, z), (width, thickness, height), PALETTE["glass"], material, 0.02)
        for offset in (-width / 2, width / 2):
            beam(parts, f"{name}_frame_v_{offset}", (x + offset, y - 0.045, z), (0.13, 0.13, height + 0.22), material, light=True)
        for offset in (-height / 2, height / 2, 0.0):
            beam(parts, f"{name}_frame_h_{offset}", (x, y - 0.05, z + offset), (width + 0.24, 0.13, 0.12), material, light=True)
        return
    box(parts, f"{name}_glass", (x, y, z), (thickness, width, height), PALETTE["glass"], material, 0.02)
    for offset in (-width / 2, width / 2):
        beam(parts, f"{name}_frame_v_{offset}", (x - 0.045, y + offset, z), (0.13, 0.13, height + 0.22), material, light=True)
    for offset in (-height / 2, height / 2, 0.0):
        beam(parts, f"{name}_frame_h_{offset}", (x - 0.05, y, z + offset), (0.13, width + 0.24, 0.12), material, light=True)


def tiled_roof(parts, name, width, depth, wall_top, rise, material, rng, tile_size=0.68):
    eave = wall_top + 0.16
    half_depth = depth / 2
    slope_length = math.hypot(half_depth, rise)
    rows = max(5, math.ceil(slope_length / (tile_size * 0.76)))
    columns = max(7, math.ceil(width / tile_size))
    angle = math.atan2(rise, half_depth)
    for side in (-1, 1):
        for row in range(rows):
            t = (row + 0.5) / rows
            y = side * (half_depth * (1.0 - t))
            z = eave + rise * t - 0.09 * math.sin(math.pi * t)
            row_columns = columns + (row % 2)
            tile_width = width / row_columns
            for column in range(row_columns):
                x = -width / 2 + (column + 0.5) * tile_width
                x += (row % 2) * tile_width * 0.12
                color = PALETTE["terracotta_light"] if rng.random() < 0.2 else PALETTE["terracotta"]
                if rng.random() < 0.08:
                    color = PALETTE["terracotta_dark"]
                box(
                    parts,
                    f"{name}_tile_{side}_{row:02}_{column:02}",
                    (x, y, z + rng.uniform(-0.018, 0.018)),
                    (tile_width * 0.91, slope_length / rows * 1.08, 0.105),
                    color,
                    material,
                    0.0,
                    (side * -angle, 0.0, 0.0),
                )
    ridge_count = max(8, math.ceil(width / 0.58))
    for index in range(ridge_count):
        x = -width / 2 + (index + 0.5) * width / ridge_count
        cone(
            parts,
            f"{name}_ridge_{index:02}",
            (x, 0.0, eave + rise + 0.04),
            0.15,
            0.15,
            width / ridge_count * 1.04,
            8,
            PALETTE["terracotta_light"] if index % 3 else PALETTE["terracotta"],
            material,
            (0.0, math.pi / 2, 0.0),
            True,
        )


def chimney(parts, name, x, y, base_z, material, rng):
    for layer in range(5):
        for x_index in range(2):
            for y_index in range(2):
                box(
                    parts,
                    f"{name}_{layer}_{x_index}_{y_index}",
                    (x + (x_index - 0.5) * 0.34, y + (y_index - 0.5) * 0.30, base_z + layer * 0.28),
                    (0.39, 0.35, 0.3),
                    PALETTE["stone_light"] if rng.random() > 0.35 else PALETTE["stone"],
                    material,
                    0.045,
                )
    box(parts, f"{name}_cap", (x, y, base_z + 1.43), (1.0, 0.88, 0.18), PALETTE["stone_light"], material, 0.05)


def build_building(name: str, width: float, depth: float, wall_top: float, roof_rise: float, hall: bool, material):
    rng = random.Random(f"ashveil-{name}")
    parts = []
    foundation(parts, name, width, depth, 0.0, material, rng)
    box(parts, f"{name}_plaster", (0.0, 0.0, wall_top / 2 + 0.48), (width - 0.34, depth - 0.34, wall_top - 0.56), PALETTE["plaster_light"], material, 0.07)

    for x in (-width / 2 + 0.17, 0.0, width / 2 - 0.17):
        beam(parts, f"{name}_front_post_{x}", (x, -depth / 2 - 0.015, wall_top / 2 + 0.35), (0.2, 0.20, wall_top - 0.42), material)
        beam(parts, f"{name}_back_post_{x}", (x, depth / 2 + 0.015, wall_top / 2 + 0.35), (0.2, 0.20, wall_top - 0.42), material)
    for y in (-depth / 2 + 0.22, 0.0, depth / 2 - 0.22):
        beam(parts, f"{name}_left_post_{y}", (-width / 2 - 0.015, y, wall_top / 2 + 0.35), (0.20, 0.2, wall_top - 0.42), material)
        beam(parts, f"{name}_right_post_{y}", (width / 2 + 0.015, y, wall_top / 2 + 0.35), (0.20, 0.2, wall_top - 0.42), material)
    for z in (0.72, wall_top - 0.22):
        beam(parts, f"{name}_front_band_{z}", (0.0, -depth / 2 - 0.025, z), (width, 0.22, 0.2), material)
        beam(parts, f"{name}_back_band_{z}", (0.0, depth / 2 + 0.025, z), (width, 0.22, 0.2), material)
        beam(parts, f"{name}_left_band_{z}", (-width / 2 - 0.025, 0.0, z), (0.22, depth, 0.2), material)
        beam(parts, f"{name}_right_band_{z}", (width / 2 + 0.025, 0.0, z), (0.22, depth, 0.2), material)

    diagonal_length = math.hypot(width * 0.34, 1.05)
    diagonal_angle = math.atan2(1.05, width * 0.34)
    for side in (-1, 1):
        beam(parts, f"{name}_brace_{side}", (side * width * 0.33, -depth / 2 - 0.04, 1.35), (diagonal_length, 0.17, 0.16), material, (0.0, diagonal_angle * side, 0.0), True)

    door_x = -width * 0.19 if hall else width * 0.20
    door_height = 2.15 if hall else 1.95
    box(parts, f"{name}_door", (door_x, -depth / 2 - 0.055, 0.65 + door_height / 2), (1.1, 0.12, door_height), PALETTE["timber_light"], material, 0.035)
    beam(parts, f"{name}_door_left", (door_x - 0.64, -depth / 2 - 0.11, 0.65 + door_height / 2), (0.16, 0.16, door_height + 0.25), material)
    beam(parts, f"{name}_door_right", (door_x + 0.64, -depth / 2 - 0.11, 0.65 + door_height / 2), (0.16, 0.16, door_height + 0.25), material)
    beam(parts, f"{name}_door_top", (door_x, -depth / 2 - 0.11, 0.65 + door_height + 0.1), (1.42, 0.17, 0.18), material)

    window_x = width * 0.27 if hall else -width * 0.23
    window(parts, f"{name}_front_window", window_x, -depth / 2 - 0.06, 2.0, 1.1, 1.25, "front", material)
    window(parts, f"{name}_side_window", width / 2 + 0.06, 0.32, 1.9, 1.05, 1.2, "side", material)
    window(parts, f"{name}_back_window", -width * 0.22, depth / 2 + 0.06, 1.9, 1.05, 1.15, "front", material)

    tiled_roof(parts, name, width + 0.42, depth + 0.5, wall_top, roof_rise, material, rng, 0.62 if hall else 0.58)
    chimney(parts, f"{name}_chimney", -width * 0.29, depth * 0.12, wall_top + roof_rise * 0.52, material, rng)

    if hall:
        porch_width = 3.4
        porch_front = -3.58
        for x in (-porch_width / 2, porch_width / 2):
            beam(parts, f"{name}_porch_post_{x}", (x, porch_front, 1.55), (0.22, 0.22, 3.1), material, light=True)
        beam(parts, f"{name}_porch_header", (0.0, porch_front, 3.0), (porch_width + 0.4, 0.25, 0.27), material, light=True)
        for index, y in enumerate((-2.92, -3.25, -3.52)):
            box(parts, f"{name}_awning_{index}", (0.0, y, 3.02 - index * 0.11), (porch_width + 0.16, 0.72, 0.09), PALETTE["teal"], material, 0.035, (0.10 + index * 0.03, 0.0, 0.0))
        for step in range(3):
            box(parts, f"{name}_step_{step}", (door_x, -depth / 2 - 0.45 - step * 0.34, 0.52 - step * 0.16), (1.8 + step * 0.32, 0.52, 0.22), PALETTE["stone_light"], material, 0.045)
    else:
        beam(parts, f"{name}_canopy_left", (door_x - 0.78, -depth / 2 - 0.55, 2.42), (0.13, 1.0, 0.13), material, (0.18, 0.0, 0.0), True)
        beam(parts, f"{name}_canopy_right", (door_x + 0.78, -depth / 2 - 0.55, 2.42), (0.13, 1.0, 0.13), material, (0.18, 0.0, 0.0), True)
        box(parts, f"{name}_canopy", (door_x, -depth / 2 - 0.58, 2.55), (1.85, 1.05, 0.11), PALETTE["terracotta"], material, 0.025, (0.18, 0.0, 0.0))
        for step in range(2):
            box(parts, f"{name}_step_{step}", (door_x, -depth / 2 - 0.34 - step * 0.3, 0.46 - step * 0.2), (1.5 + step * 0.28, 0.48, 0.24), PALETTE["stone_light"], material, 0.045)

    return join_template(name, parts, material)


def root_cluster(parts, name, end, radius, material, color):
    direction = Vector(end)
    start = direction.normalized() * 0.10
    cylinder_between(parts, name, start, end, radius, radius * 0.18, color, material, 8, True)


def foliage_core(parts, name, center, scale, palette_name, material, rng):
    for index in range(2):
        lobe_center = (
            center[0] + rng.uniform(-scale[0] * 0.12, scale[0] * 0.12),
            center[1] + rng.uniform(-scale[1] * 0.12, scale[1] * 0.12),
            center[2] + rng.uniform(-scale[2] * 0.10, scale[2] * 0.10),
        )
        lobe_scale = (
            scale[0] * rng.uniform(0.28, 0.39),
            scale[1] * rng.uniform(0.28, 0.39),
            scale[2] * rng.uniform(0.25, 0.36),
        )
        color = PALETTE["leaf_dark"] if index == 0 else PALETTE[palette_name]
        ico(parts, f"{name}_lobe_{index:02}", lobe_center, lobe_scale, color, material, 2)


def leaf_cloud(parts, name, clusters, leaves_per_cluster, material, rng, orchard):
    vertices = []
    faces = []
    leaf_colors = []
    colors = [PALETTE["leaf_dark"], PALETTE["leaf_mid"], PALETTE["leaf_light"]]
    if not orchard:
        colors.append(PALETTE["leaf_gold"])

    for cluster_index, (center, scale, _) in enumerate(clusters):
        for leaf_index in range(leaves_per_cluster):
            while True:
                offset = Vector((rng.uniform(-1, 1), rng.uniform(-1, 1), rng.uniform(-1, 1)))
                if offset.length_squared <= 1:
                    break
            leaf_center = Vector((
                center[0] + offset.x * scale[0],
                center[1] + offset.y * scale[1],
                center[2] + offset.z * scale[2],
            ))
            length = rng.uniform(0.32, 0.48) if orchard else rng.uniform(0.38, 0.58)
            width = length * rng.uniform(0.38, 0.54)
            fold = width * rng.uniform(0.10, 0.18)
            local = [
                Vector((0.0, length * 0.5, fold)),
                Vector((width * 0.5, length * 0.14, 0.0)),
                Vector((width * 0.42, -length * 0.18, 0.0)),
                Vector((0.0, -length * 0.5, fold)),
                Vector((-width * 0.42, -length * 0.18, 0.0)),
                Vector((-width * 0.5, length * 0.14, 0.0)),
            ]
            orientation = Euler((
                rng.uniform(-1.05, 1.05),
                rng.uniform(-1.05, 1.05),
                rng.uniform(0, math.tau),
            ), "XYZ").to_matrix()
            start = len(vertices)
            vertices.extend([tuple(leaf_center + orientation @ point) for point in local])
            faces.extend([
                (start, start + 1, start + 5),
                (start + 1, start + 2, start + 5),
                (start + 5, start + 2, start + 4),
                (start + 4, start + 2, start + 3),
            ])
            color = colors[(cluster_index + leaf_index + rng.randrange(len(colors))) % len(colors)]
            leaf_colors.extend([varied(color, 0.10, rng)] * 4)

    mesh = bpy.data.meshes.new(f"{name}_mesh")
    mesh.from_pydata(vertices, [], faces)
    mesh.update()
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.scene.collection.objects.link(obj)
    attribute = mesh.color_attributes.new(name=COLOR_ATTRIBUTE, type="BYTE_COLOR", domain="CORNER")
    for polygon, color in zip(mesh.polygons, leaf_colors):
        for loop_index in polygon.loop_indices:
            attribute.data[loop_index].color = color
    mesh.materials.append(material)
    parts.append(obj)


def build_tree(name: str, orchard: bool, material):
    rng = random.Random(f"ashveil-{name}")
    parts = []
    trunk_color = PALETTE["timber_light"] if orchard else PALETTE["timber"]
    height = 4.9 if orchard else 7.0
    fork = 2.15 if orchard else 2.7
    cylinder_between(parts, f"{name}_trunk_lower", (0, 0, 0.02), (0.05, 0.0, fork), 0.48 if orchard else 0.62, 0.32 if orchard else 0.42, trunk_color, material, 9)
    roots = [
        (0.92, 0.18, 0.02), (-0.78, 0.55, 0.02), (0.22, -0.98, 0.02),
        (-0.55, -0.72, 0.02), (0.66, 0.62, 0.02),
    ]
    for index, end in enumerate(roots):
        root_cluster(parts, f"{name}_root_{index:02}", end, 0.22 if orchard else 0.27, material, trunk_color)

    branches = [
        ((0.04, 0.0, fork - 0.12), (-1.15, 0.18, fork + 1.28)),
        ((0.04, 0.0, fork + 0.02), (1.18, 0.16, fork + 1.48)),
        ((0.02, 0.0, fork + 0.18), (-0.22, -0.92, fork + 1.72)),
        ((0.03, 0.0, fork + 0.26), (0.48, 0.78, fork + 1.86)),
    ]
    if not orchard:
        branches.extend([
            ((-0.34, 0.08, fork + 0.6), (-2.0, 0.36, fork + 2.12)),
            ((0.42, 0.12, fork + 0.75), (2.05, -0.28, fork + 2.35)),
            ((0.02, -0.45, fork + 0.92), (-0.15, -1.85, fork + 2.45)),
        ])
    for index, (start, end) in enumerate(branches):
        cylinder_between(parts, f"{name}_branch_{index:02}", start, end, 0.25 if orchard else 0.31, 0.08 if orchard else 0.10, trunk_color, material, 8)
        twig_end = Vector(end) + Vector((rng.uniform(-0.45, 0.45), rng.uniform(-0.4, 0.4), rng.uniform(0.45, 0.8)))
        cylinder_between(parts, f"{name}_twig_{index:02}", end, twig_end, 0.09, 0.025, trunk_color, material, 7)

    if orchard:
        clusters = [
            ((-1.08, 0.05, 4.0), (1.42, 1.05, 1.15), "leaf_mid"),
            ((1.05, 0.12, 4.1), (1.38, 1.03, 1.1), "leaf_mid"),
            ((0.0, -0.85, 4.22), (1.45, 1.0, 1.12), "leaf_dark"),
            ((0.0, 0.78, 4.38), (1.35, 0.96, 1.05), "leaf_light"),
            ((-0.15, 0.0, 4.95), (1.25, 0.93, 0.95), "leaf_light"),
        ]
    else:
        clusters = [
            ((-1.65, 0.18, 5.35), (1.85, 1.30, 1.35), "leaf_dark"),
            ((1.58, 0.05, 5.48), (1.9, 1.28, 1.4), "leaf_mid"),
            ((-0.2, -1.28, 5.65), (1.75, 1.25, 1.35), "leaf_dark"),
            ((0.25, 1.18, 5.72), (1.75, 1.2, 1.25), "leaf_mid"),
            ((-0.55, 0.12, 6.65), (1.72, 1.18, 1.2), "leaf_light"),
            ((1.02, -0.72, 6.55), (1.45, 1.05, 1.08), "leaf_gold"),
            ((-1.12, 0.82, 6.72), (1.42, 1.0, 1.02), "leaf_mid"),
        ]
    for index, (center, scale, color) in enumerate(clusters):
        foliage_core(parts, f"{name}_foliage_{index:02}", center, scale, color, material, rng)
        twig_end = (center[0] * 0.72, center[1] * 0.72, center[2] - scale[2] * 0.18)
        twig_start = (center[0] * 0.22, center[1] * 0.22, fork + 0.55)
        cylinder_between(parts, f"{name}_crown_twig_{index:02}", twig_start, twig_end, 0.075, 0.022, trunk_color, material, 7)
    leaf_cloud(parts, f"{name}_leaves", clusters, 76 if orchard else 92, material, rng, orchard)

    if orchard:
        for index in range(18):
            angle = rng.uniform(0, math.tau)
            radius = rng.uniform(0.65, 1.55)
            center = (
                math.cos(angle) * radius,
                math.sin(angle) * radius * 0.7,
                rng.uniform(3.55, height),
            )
            ico(parts, f"{name}_apple_{index:02}", center, (0.105, 0.105, 0.115), PALETTE["apple"], material, 1)

    return join_template(name, parts, material)


def bounds_runtime(obj):
    points = [vertex.co for vertex in obj.data.vertices]
    minimum = (min(point.x for point in points), min(point.z for point in points), min(-point.y for point in points))
    maximum = (max(point.x for point in points), max(point.z for point in points), max(-point.y for point in points))
    return {
        "minimum": [round(value, 6) for value in minimum],
        "maximum": [round(value, 6) for value in maximum],
    }


def triangle_count(obj) -> int:
    return sum(len(polygon.vertices) - 2 for polygon in obj.data.polygons)


def validate(roots) -> None:
    if sorted(root.name for root in roots) != sorted(TEMPLATES):
        raise RuntimeError("root gate: exported root names do not match the runtime contract")
    for root in roots:
        if root.type != "MESH":
            raise RuntimeError(f"root gate: {root.name} is not a mesh")
        if tuple(root.location) != (0.0, 0.0, 0.0) or tuple(root.scale) != (1.0, 1.0, 1.0):
            raise RuntimeError(f"transform gate: {root.name} does not have identity TRS")
        if any(abs(value) > 1e-7 for value in root.rotation_euler):
            raise RuntimeError(f"transform gate: {root.name} carries rotation")
        if len(root.data.materials) != 1 or root.data.materials[0].name != MATERIAL_NAME:
            raise RuntimeError(f"material gate: {root.name} must use one vertex-color material")
        if COLOR_ATTRIBUTE not in root.data.color_attributes:
            raise RuntimeError(f"color gate: {root.name} has no {COLOR_ATTRIBUTE} attribute")
        triangles = triangle_count(root)
        if triangles > TEMPLATES[root.name]["triangleBudget"]:
            raise RuntimeError(f"triangle gate: {root.name} has {triangles} triangles")
        footprint = TEMPLATES[root.name]["footprintRadius"]
        if root.name in ("refuge_hall", "cottage"):
            radial = max(math.hypot(vertex.co.x, vertex.co.y) for vertex in root.data.vertices)
        else:
            radial = max(
                math.hypot(vertex.co.x, vertex.co.y)
                for vertex in root.data.vertices
                if vertex.co.z <= 0.55
            )
        if radial > footprint + 1e-5:
            raise RuntimeError(f"footprint gate: {root.name} reaches {radial:.4f}m outside {footprint:.2f}m")


def export(roots) -> None:
    PUBLIC.mkdir(parents=True, exist_ok=True)
    bpy.ops.object.select_all(action="DESELECT")
    for root in roots:
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
    )


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1 << 20), b""):
            digest.update(chunk)
    return digest.hexdigest()


def write_manifest(roots) -> None:
    document = {
        "schema": "ashveil.scenery-kit.v1",
        "version": 1,
        "generator": "scripts/art/scenery/generate_first_zone.py",
        "asset": {"file": GLB.name, "sha256": sha256(GLB)},
        "coordinateFrame": {"up": "+Y", "front": "+Z", "units": "metres"},
        "material": {"name": MATERIAL_NAME, "vertexColorAttribute": "COLOR_0"},
        "references": [
            {"file": "docs/art-pipeline/concepts/opening-chapter/environment-kit.png", "sha256": sha256(ROOT / "docs/art-pipeline/concepts/opening-chapter/environment-kit.png")},
            {"file": "public/bodies/masculine-v3/masculine-v3.glb", "sha256": sha256(ROOT / "public/bodies/masculine-v3/masculine-v3.glb")},
            {"file": "public/textures/first-zone/concepts/village-edge.png", "sha256": sha256(ROOT / "public/textures/first-zone/concepts/village-edge.png")},
        ],
        "templates": [
            {
                "id": root.name,
                "nodeType": "mesh",
                "identityTRS": True,
                "groundedY": 0.0,
                "footprintRadius": TEMPLATES[root.name]["footprintRadius"],
                "vertices": len(root.data.vertices),
                "triangles": triangle_count(root),
                "triangleBudget": TEMPLATES[root.name]["triangleBudget"],
                "materials": 1,
                "bounds": bounds_runtime(root),
            }
            for root in roots
        ],
    }
    MANIFEST.write_text(json.dumps(document, indent=2) + "\n")


def render_contact_sheet(roots) -> None:
    import numpy as np

    LOCAL.mkdir(parents=True, exist_ok=True)
    bpy.ops.wm.save_as_mainfile(filepath=str(BLEND))
    box([], "review_ground", (0.0, 0.0, -0.36), (24.0, 18.0, 0.5), (0.16, 0.20, 0.12, 1.0), bpy.data.materials[MATERIAL_NAME], 0.12)
    world = bpy.context.scene.world
    world.use_nodes = True
    background = world.node_tree.nodes.get("Background")
    background.inputs["Color"].default_value = (0.035, 0.052, 0.068, 1.0)
    background.inputs["Strength"].default_value = 0.28

    def light(name, location, energy, size, color):
        data = bpy.data.lights.new(name, "AREA")
        data.energy = energy
        data.shape = "DISK"
        data.size = size
        data.color = color
        obj = bpy.data.objects.new(name, data)
        obj.location = location
        obj.rotation_euler = (Vector((0.0, 0.0, 3.0)) - obj.location).to_track_quat("-Z", "Y").to_euler()
        bpy.context.scene.collection.objects.link(obj)

    light("Warm key", (-5.0, -9.0, 14.0), 1800, 7.0, (1.0, 0.79, 0.57))
    light("Sky fill", (9.0, -4.0, 10.0), 1200, 8.0, (0.58, 0.72, 0.88))
    light("Rim", (0.0, 8.0, 12.0), 1500, 6.0, (1.0, 0.72, 0.42))

    camera_data = bpy.data.cameras.new("Kit review")
    camera_data.lens = 58
    camera = bpy.data.objects.new("Kit review", camera_data)
    bpy.context.scene.collection.objects.link(camera)

    scene = bpy.context.scene
    scene.camera = camera
    scene.render.engine = "BLENDER_EEVEE"
    scene.render.resolution_x = 800
    scene.render.resolution_y = 600
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.render.film_transparent = False
    scene.view_settings.look = "AgX - Medium High Contrast"

    tiles = {}
    with tempfile.TemporaryDirectory(prefix="ashveil-scenery-review-") as scratch:
        for root in roots:
            for candidate in roots:
                candidate.hide_render = candidate is not root
            points = [vertex.co for vertex in root.data.vertices]
            minimum = Vector((min(point.x for point in points), min(point.y for point in points), min(point.z for point in points)))
            maximum = Vector((max(point.x for point in points), max(point.y for point in points), max(point.z for point in points)))
            size = maximum - minimum
            target = Vector((0.0, 0.0, (minimum.z + maximum.z) * 0.5))
            distance = max(size.z * 3.2, size.x * 2.6, size.y * 4.0)
            view = Vector((0.56, -1.0, 0.52)).normalized()
            camera.location = target + view * distance
            camera.rotation_euler = (target - camera.location).to_track_quat("-Z", "Y").to_euler()
            path = Path(scratch) / f"{root.name}.png"
            scene.render.filepath = str(path)
            bpy.ops.render.render(write_still=True)
            image = bpy.data.images.load(str(path))
            width, height = image.size
            tiles[root.name] = np.array(image.pixels[:]).reshape(height, width, 4)
            bpy.data.images.remove(image)

    top = np.concatenate([tiles["refuge_hall"], tiles["cottage"]], axis=1)
    bottom = np.concatenate([tiles["alder_tree"], tiles["orchard_tree"]], axis=1)
    pixels = np.concatenate([bottom, top], axis=0)
    sheet = bpy.data.images.new("First-zone scenery kit", width=pixels.shape[1], height=pixels.shape[0], alpha=True)
    sheet.pixels = pixels.ravel().tolist()
    sheet.filepath_raw = str(CONTACT_SHEET)
    sheet.file_format = "PNG"
    sheet.save()
    bpy.data.images.remove(sheet)


def main() -> None:
    reset_scene()
    material = vertex_color_material()
    roots = [
        build_building("refuge_hall", 8.6, 5.4, 4.25, 2.45, True, material),
        build_building("cottage", 5.6, 3.9, 3.35, 1.95, False, material),
        build_tree("alder_tree", False, material),
        build_tree("orchard_tree", True, material),
    ]
    validate(roots)
    export(roots)
    write_manifest(roots)
    render_contact_sheet(roots)
    print(json.dumps({
        "glb": str(GLB),
        "manifest": str(MANIFEST),
        "blend": str(BLEND),
        "contactSheet": str(CONTACT_SHEET),
        "templates": {root.name: {"vertices": len(root.data.vertices), "triangles": triangle_count(root)} for root in roots},
    }, indent=2))


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(f"SCENERY GENERATION FAILED: {error}", file=sys.stderr)
        raise
