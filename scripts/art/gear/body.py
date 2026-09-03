from __future__ import annotations

import json
from pathlib import Path

import bpy
import numpy as np

from fit import normalise
from fit.frame import runtime_from_blender


class BodyError(RuntimeError):
    pass


def _mesh_objects():
    return [obj for obj in bpy.context.scene.objects if obj.type == "MESH"]


def load(root: Path, body_name: str) -> dict:
    directory = root / "public" / "bodies" / body_name
    glb_path = directory / f"{body_name}.glb"
    manifest_path = directory / f"{body_name}.manifest.json"
    masks_path = directory / f"{body_name}.masks.json"
    for path in (glb_path, manifest_path, masks_path):
        if not path.exists():
            raise BodyError(f"body gate: no file at {path}")

    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=str(glb_path))
    armatures = [obj for obj in bpy.context.scene.objects if obj.type == "ARMATURE"]
    if len(armatures) != 1:
        raise BodyError(f"body gate: expected one armature, found {len(armatures)}")
    # The importer leaves geometry in the scene that the file never named, and a
    # stray sphere joined into the target is a body the piece has to dodge.
    meshes = [obj for obj in _mesh_objects()
              if any(modifier.type == "ARMATURE" and modifier.object is armatures[0]
                     for modifier in obj.modifiers)]
    masks = json.loads(masks_path.read_text())
    named = sorted({name for slot in masks["slots"].values() for name in slot})
    if sorted(obj.name for obj in meshes) != named:
        raise BodyError(f"body gate: the import skins {sorted(obj.name for obj in meshes)}, "
                        f"the masks name {named}")
    return {
        "path": glb_path,
        "manifest": json.loads(manifest_path.read_text()),
        "masks": masks,
        "meshes": meshes,
        "armature": armatures[0],
    }


def by_name(loaded: dict) -> dict:
    return {obj.name: obj for obj in loaded["meshes"]}


def region(loaded: dict, slots: list[str], pair: bool,
           bones: dict[str, str] | None = None) -> dict[str, np.ndarray]:
    """The body extents a piece aligns against: every region it covers, as one shape.

    A garment is anchored by what it hides, not by the one slot it hangs from, so a
    trouser that covers legs and waist reaches the natural waist rather than the hip.

    `bones` narrows it to the skin one bone owns, per side. A slot's region reaches
    further up the limb than the garment does on purpose - `hands` is four fifths
    forearm - so a measurement about whether the hand is in the glove has to ask
    about the hand.
    """
    meshes = by_name(loaded)
    sides: dict[str, list] = {"L": [], "R": []} if pair else {"all": []}
    for slot in slots:
        for mesh_name, indices in sorted(loaded["masks"]["slots"].get(slot, {}).items()):
            obj = meshes.get(mesh_name)
            if obj is None:
                raise BodyError(f"body gate: mask names missing mesh {mesh_name}")
            groups = {group.index: group.name for group in obj.vertex_groups}
            for index in indices:
                vertex = obj.data.vertices[index]
                point = runtime_from_blender(obj.matrix_world @ vertex.co)
                if not pair:
                    sides["all"].append(point)
                    continue
                dominant = max(vertex.groups, key=lambda element: element.weight, default=None)
                bone = groups.get(dominant.group, "") if dominant else ""
                side = ("L" if bone.endswith("_L") else "R" if bone.endswith("_R")
                        else ("L" if point[0] >= 0 else "R"))
                if bones and bone != bones.get(side):
                    continue
                sides[side].append(point)
    result = {side: np.array(points, dtype=np.float64) for side, points in sides.items()}
    if any(len(points) == 0 for points in result.values()):
        missing = ", ".join(side for side, points in result.items() if len(points) == 0)
        named = f" on {sorted(set(bones.values()))}" if bones else ""
        raise BodyError(f"region gate: {', '.join(slots)} has no body vertices{named} for {missing}")
    return result


def replaced_tree(loaded: dict, replaced: dict[str, list[int]]):
    """The skin a slot stands in for, as a nearest-point lookup in Blender space."""
    from mathutils.kdtree import KDTree

    meshes = by_name(loaded)
    points = [meshes[name].matrix_world @ meshes[name].data.vertices[index].co
              for name, indices in sorted(replaced.items()) if name in meshes for index in indices]
    if not points:
        return None
    tree = KDTree(len(points))
    for at, point in enumerate(points):
        tree.insert(point, at)
    tree.balance()
    return tree


def joined_meshes(sources: list, name: str = "GearFitSurface"):
    copies = []
    for source in sources:
        copy = source.copy()
        copy.data = source.data.copy()
        copy.animation_data_clear()
        bpy.context.scene.collection.objects.link(copy)
        copies.append(copy)
    bpy.ops.object.select_all(action="DESELECT")
    for copy in copies:
        copy.hide_set(False)
        copy.select_set(True)
    bpy.context.view_layer.objects.active = copies[0]
    bpy.ops.object.join()
    target = copies[0]
    target.name = name
    target.parent = None
    target.hide_render = True
    # A runtime GLB is seam-split, so the join has thousands of boundary edges and
    # is not a closed volume until the seams are welded; a ray cannot count into one.
    normalise._merge_seams(target)
    return target


def joined_target(loaded: dict, extra: list | None = None):
    return joined_meshes(list(loaded["meshes"]) + list(extra or []))


def region_vertices(loaded: dict, covers: list[str]) -> dict[str, set[int]]:
    """The slot regions a piece spans, per mesh.

    Fitting still leans on them: the piece's own mask cannot exist until the piece
    has been shrinkwrapped, so the regions are what "is this inside skin anyone can
    see" means while it is being fitted. Nothing downstream masks by them.
    """
    spanned: dict[str, set[int]] = {}
    for slot in covers:
        for mesh_name, indices in loaded["masks"]["slots"].get(slot, {}).items():
            spanned.setdefault(mesh_name, set()).update(indices)
    return spanned
