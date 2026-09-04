from __future__ import annotations

import bpy
import numpy as np

from fit import normalise
from fit.frame import blender_from_runtime, runtime_from_blender

DEBRIS_FRACTION = 0.02
# A shape the fitter builds itself, for a fixture no region of the body can stand in
# for: `proxy:<slot>` is a shell carved off the body, and a cape hangs off it instead.
SHAPES = {"cape": {"reference": "chest", "width": 0.22, "height": 0.6, "spacing": 0.01,
                   "behind": 0.03, "yoke": 0.03, "yokeRows": 4, "neck": 0.09, "neckFade": 0.06}}


class PieceError(RuntimeError):
    pass


def _triangles(obj) -> int:
    return sum(max(0, len(face.vertices) - 2) for face in obj.data.polygons)


def _select(objects) -> None:
    bpy.ops.object.select_all(action="DESELECT")
    for obj in objects:
        obj.hide_set(False)
        obj.select_set(True)
    if objects:
        bpy.context.view_layer.objects.active = objects[0]


def _join(objects, name: str):
    if len(objects) == 1:
        objects[0].name = name
        return objects[0]
    _select(objects)
    bpy.context.view_layer.objects.active = objects[0]
    bpy.ops.object.join()
    objects[0].name = name
    return objects[0]


def _materials_have_images(objects) -> bool:
    for obj in objects:
        for material in obj.data.materials:
            if material and material.use_nodes and any(node.type == "TEX_IMAGE" and node.image
                                                       for node in material.node_tree.nodes):
                return True
    return False


def import_file(path: str) -> tuple[list, dict]:
    before = set(bpy.context.scene.objects)
    lowered = path.lower()
    if lowered.endswith(".fbx"):
        bpy.ops.import_scene.fbx(filepath=path)
    elif lowered.endswith((".glb", ".gltf")):
        bpy.ops.import_scene.gltf(filepath=path)
    else:
        raise PieceError(f"import gate: {path} is not an FBX or a glTF file")
    added = [obj for obj in bpy.context.scene.objects if obj not in before]
    meshes = [obj for obj in added if obj.type == "MESH"]
    if not meshes:
        raise PieceError("import gate: the file contains no mesh")
    source_had = {
        "uvs": any(obj.data.uv_layers for obj in meshes),
        "textures": _materials_have_images(meshes),
    }
    for obj in meshes:
        obj.parent = None
        _select([obj])
        bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
        normalise._merge_seams(obj)
        normalise._drop_degenerate(obj)
    for obj in added:
        if obj.type != "MESH" and obj.name in bpy.data.objects:
            bpy.data.objects.remove(obj, do_unlink=True)
    return meshes, source_had


def _region_points(loaded: dict, slot: str) -> np.ndarray:
    meshes = {obj.name: obj for obj in loaded["meshes"]}
    points = [runtime_from_blender(meshes[name].matrix_world @ meshes[name].data.vertices[index].co)
              for name, indices in sorted(loaded["masks"]["slots"].get(slot, {}).items())
              if name in meshes for index in indices]
    if not points:
        raise PieceError(f"region gate: the body has no {slot} region to build a shape against")
    return np.array(points, dtype=np.float64)


def _yoke_depth(offset: float, settings: dict) -> float:
    """How far forward the yoke reaches at one column, and nothing at the neck.

    A yoke that crosses the midline crosses the neck with it, so the shoulders carry
    the whole of it and the middle keeps a lip that only says which way is forward.
    """
    inner, fade = float(settings["neck"]), float(settings["neckFade"])
    reach = min(1.0, max(0.0, (abs(offset) - inner) / max(fade, 1e-9)))
    return float(settings["yoke"]) * max(0.05, reach * reach * (3.0 - 2.0 * reach))


def shape(loaded: dict, name: str) -> tuple[list, dict]:
    """A cape as a yoke over the shoulders and a sheet hanging behind them.

    A drape fixture cannot be a proxy: a shell carved off the body has no tail to
    hang, and `back` carves nothing at all. A sheet the fitter builds itself is the
    smallest thing that has one, and it is the same bytes on every machine. It needs
    the yoke because a `back` piece is anchored by its front: a sheet with no depth
    would be placed in front of the chest and hang down the body it should hang off.
    """
    settings = SHAPES[name]
    region = _region_points(loaded, settings["reference"])
    step = float(settings["spacing"])
    columns = max(2, int(round(float(settings["width"]) / step)) + 1)
    sheet = max(2, int(round(float(settings["height"]) / step)) + 1)
    yoke = int(settings["yokeRows"])
    middle = float((region[:, 0].min() + region[:, 0].max()) * 0.5)
    top = float(region[:, 1].max())
    back = float(region[:, 2].min()) - float(settings["behind"])
    offsets = [(column - (columns - 1) * 0.5) * step for column in range(columns)]
    depths = [_yoke_depth(offset, settings) for offset in offsets]
    vertices = []
    for row in range(yoke + sheet):
        forward = max(0, yoke - row) / yoke
        for column, offset in enumerate(offsets):
            vertices.append(blender_from_runtime(
                (middle + offset, top - max(0, row - yoke) * step, back + depths[column] * forward)))
    rows = yoke + sheet
    faces = []
    for row in range(rows - 1):
        for column in range(columns - 1):
            first = row * columns + column
            # Wound so the sheet's own normals face away from the body it hangs behind.
            faces.append((first, first + 1, first + columns + 1))
            faces.append((first, first + columns + 1, first + columns))
    mesh = bpy.data.meshes.new(f"shape-{name}")
    mesh.from_pydata(vertices, [], faces)
    mesh.update()
    obj = bpy.data.objects.new(mesh.name, mesh)
    bpy.context.scene.collection.objects.link(obj)
    return [obj], {"uvs": False, "textures": False}


def proxy(loaded: dict, source_slot: str) -> tuple[list, dict]:
    masks = loaded["masks"]["slots"].get(source_slot, {})
    meshes = {obj.name: obj for obj in loaded["meshes"]}
    created = []
    for mesh_name, indices in sorted(masks.items()):
        source = meshes.get(mesh_name)
        if source is None:
            raise PieceError(f"body gate: mask names missing mesh {mesh_name}")
        selected = set(indices)
        faces = [tuple(face.vertices) for face in source.data.polygons
                 if len(face.vertices) == 3 and all(index in selected for index in face.vertices)]
        used = sorted({index for face in faces for index in face})
        if not faces:
            continue
        remap = {old: new for new, old in enumerate(used)}
        vertices = []
        normal_matrix = source.matrix_world.to_3x3().inverted().transposed()
        for index in used:
            vertex = source.data.vertices[index]
            point = source.matrix_world @ vertex.co
            normal = (normal_matrix @ vertex.normal).normalized()
            vertices.append(tuple(point + normal * 0.015))
        mesh = bpy.data.meshes.new(f"proxy-{source_slot}-{mesh_name}")
        mesh.from_pydata(vertices, [], [tuple(remap[index] for index in face) for face in faces])
        mesh.update()
        created.append(bpy.data.objects.new(mesh.name, mesh))
        bpy.context.scene.collection.objects.link(created[-1])
    if not created:
        raise PieceError(f"region gate: proxy:{source_slot} contains no complete body faces")
    return created, {"uvs": False, "textures": False}


def under(root, names: list[str]) -> list:
    """The fitted pieces this one is worn over, as plain meshes to fit against.

    A piece is fitted to the bare body, so nothing stops a hood's mantle landing
    inside a tunic collar. Naming what it goes over puts those shells in the
    surface the shrinkwrap pushes out of and the bind gate measures against; the
    armature comes with them and is dropped, since both files share the body's
    bind pose and only the rest geometry is wanted.

    Only what the file's own armature skins is kept. Importing any skinned glTF also
    leaves a one-metre Icosphere at the origin - the importer's bone-widget mesh, in
    no file and in no scene graph - and welded into the target it swallows the whole
    lower body, so every piece hanging below the waist measured as buried in it.
    `body.load` has always filtered by the same rule; this is that rule, here.
    """
    meshes = []
    for name in names:
        path = root / "public" / "gear" / name / f"{name}.glb"
        if not path.exists():
            raise PieceError(f"under gate: no fitted piece at {path}")
        before = set(bpy.context.scene.objects)
        bpy.ops.import_scene.gltf(filepath=str(path))
        added = [obj for obj in bpy.context.scene.objects if obj not in before]
        armatures = {obj for obj in added if obj.type == "ARMATURE"}
        skinned = [obj for obj in added if obj.type == "MESH"
                   and any(modifier.type == "ARMATURE" and modifier.object in armatures
                           for modifier in obj.modifiers)]
        for obj in added:
            if obj not in skinned:
                continue
            for modifier in list(obj.modifiers):
                obj.modifiers.remove(modifier)
            world = obj.matrix_world.copy()
            obj.parent = None
            obj.matrix_world = world
            _select([obj])
            bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
            obj.name = f"under-{name}-{obj.name}"
            obj.hide_render = True
            meshes.append(obj)
        for obj in added:
            if obj not in skinned and obj.name in bpy.data.objects:
                bpy.data.objects.remove(obj, do_unlink=True)
    if names and not meshes:
        raise PieceError(f"under gate: {', '.join(names)} carry no skinned mesh")
    return meshes


def _centroid_x(obj) -> float:
    vertices = obj.data.vertices
    if not vertices:
        return 0.0
    return sum(runtime_from_blender(obj.matrix_world @ vertex.co)[0] for vertex in vertices) / len(vertices)


def islands(objects: list, pair: bool, name: str) -> tuple[list, dict]:
    """Reduce a source to the shapes a slot wears: one per side, or one in all.

    A runtime body GLB is seam-split, so anything carved from one arrives as
    dozens of loose patches; merging by distance is what makes an island an
    island again, and the side a patch belongs to is the sign of its centre.
    """
    for obj in objects:
        normalise._merge_seams(obj)
    separated = normalise._split_islands(objects)
    counts = {obj: _triangles(obj) for obj in separated}
    total = sum(counts.values())
    kept = [obj for obj in separated if counts[obj] >= total * DEBRIS_FRACTION]
    dropped = sorted(counts[obj] for obj in separated if obj not in kept)
    for obj in separated:
        if obj not in kept:
            bpy.data.objects.remove(obj, do_unlink=True)
    if not kept:
        raise PieceError("island gate: every island was under the debris threshold")

    if pair:
        sides = {"L": [obj for obj in kept if _centroid_x(obj) >= 0.0],
                 "R": [obj for obj in kept if _centroid_x(obj) < 0.0]}
        empty = sorted(side for side, group in sides.items() if not group)
        if empty:
            raise PieceError(f"pair gate: no island on side {', '.join(empty)}, "
                             f"from {len(kept)} island(s) kept of {len(separated)}")
        grouped = {side: len(group) for side, group in sides.items()}
        result = [_join(sides["L"], f"{name}_L"), _join(sides["R"], f"{name}_R")]
    else:
        grouped = {"all": len(kept)}
        result = [_join(kept, name)]
    return result, {
        "found": len(separated),
        "kept": len(kept),
        "grouped": grouped,
        "droppedTriangleCounts": dropped,
        "triangles": sum(_triangles(obj) for obj in result),
    }


def join(objects: list, name: str):
    return _join(objects, name)
