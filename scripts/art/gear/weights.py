from __future__ import annotations

import numpy as np

import bpy

from fit.frame import runtime_from_blender
from fit.weights import _segment_distance

# A vertex under this holds no bone strongly enough to be rigid with it: it is in the
# hinge band, and how tall that band is is what "stiff" and "skin-like" differ by.
BAND_CEILING = 0.8
STIFF_INFLUENCES = 2
DEFAULT_STIFFNESS = 3.0


class GearWeightError(RuntimeError):
    pass


def _allowed(slot: dict, side: str | None) -> list[str]:
    names = slot["weights"]["allowedBones"]
    if side is None:
        return list(names)
    return [name for name in names if not name.endswith(("_L", "_R")) or name.endswith(f"_{side}")]


def _orphan(obj, armature, permitted: list[str]) -> int:
    empty = [vertex.index for vertex in obj.data.vertices
             if not any(element.weight > 1e-8 for element in vertex.groups)]
    if not empty:
        return 0
    segments = {bone.name: (np.array(bone.head_local), np.array(bone.tail_local))
                for bone in armature.data.bones if bone.name in permitted}
    if not segments:
        raise GearWeightError("weight gate: no permitted bone exists on the body armature")
    to_armature = armature.matrix_world.inverted() @ obj.matrix_world
    points = np.array([tuple(to_armature @ obj.data.vertices[index].co) for index in empty])
    names = sorted(segments)
    distances = np.stack([_segment_distance(points, *segments[name]) for name in names])
    nearest = np.argmin(distances, axis=0)
    groups = {name: obj.vertex_groups.get(name) or obj.vertex_groups.new(name=name) for name in names}
    for index, bone_at in zip(empty, nearest):
        groups[names[bone_at]].add([index], 1.0, "REPLACE")
    return len(empty)


def _sharpen(obj, stiffness: float) -> None:
    """Pull every vertex toward the bone that already holds it most.

    Transferred weights are skin's: a boot inherits the ankle's blend, so its shaft
    smears with the shin the way a calf does and reads as rubber. Raising the
    weights to a power and renormalising leaves the hinge where it was and makes it
    thin, which is what leather and plate do instead of stretching.
    """
    names = {group.index: group.name for group in obj.vertex_groups}
    groups = {group.name: group for group in obj.vertex_groups}
    for vertex in obj.data.vertices:
        held = sorted(((names[element.group], element.weight) for element in vertex.groups
                       if element.weight > 1e-8),
                      key=lambda pair: (-pair[1], pair[0]))[:STIFF_INFLUENCES]
        if not held:
            continue
        raised = [(name, weight ** stiffness) for name, weight in held]
        total = sum(weight for _, weight in raised)
        if total <= 0.0:
            raised, total = [(held[0][0], 1.0)], 1.0
        kept = {name for name, _ in raised}
        for name, weight in raised:
            groups[name].add([vertex.index], weight / total, "REPLACE")
        for name in names.values():
            if name not in kept:
                groups[name].remove([vertex.index])


def _band(obj) -> dict:
    """How tall the hinge is, and how much of the piece is in it."""
    heights = []
    peaks = []
    for vertex in obj.data.vertices:
        weights = [element.weight for element in vertex.groups if element.weight > 1e-8]
        if not weights:
            continue
        peak = max(weights)
        peaks.append(peak)
        if peak < BAND_CEILING:
            heights.append(float(runtime_from_blender(obj.matrix_world @ vertex.co)[1]))
    report = {
        "vertices": len(peaks),
        "bandVertices": len(heights),
        "bandFraction": round(len(heights) / max(1, len(peaks)), 6),
        "ceiling": BAND_CEILING,
        "minPeakWeight": round(min(peaks, default=1.0), 6),
        "meanPeakWeight": round(sum(peaks) / max(1, len(peaks)), 6),
    }
    if heights:
        report["bandHeightMetres"] = round(max(heights) - min(heights), 6)
        report["bandMinY"] = round(min(heights), 6)
        report["bandMaxY"] = round(max(heights), 6)
    return report


def _parent(obj, armature) -> None:
    obj.parent = None
    for modifier in list(obj.modifiers):
        if modifier.type == "ARMATURE":
            obj.modifiers.remove(modifier)
    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    armature.hide_set(False)
    armature.select_set(True)
    bpy.context.view_layer.objects.active = armature
    bpy.ops.object.parent_set(type="ARMATURE")


def apply(objects: list, target, armature, slot: dict, mode: str, pair: bool) -> dict:
    stripped: dict[str, list[str]] = {}
    orphaned: dict[str, int] = {}
    bands: dict[str, dict] = {}
    stiffness = float(slot["weights"].get("stiffness", DEFAULT_STIFFNESS))
    for at, obj in enumerate(objects):
        side = ("L", "R")[at] if pair else None
        permitted = _allowed(slot, side)
        if mode in ("transfer", "stiff"):
            for name in permitted:
                obj.vertex_groups.get(name) or obj.vertex_groups.new(name=name)
            bpy.context.view_layer.objects.active = obj
            modifier = obj.modifiers.new("Gear weight transfer", "DATA_TRANSFER")
            modifier.object = target
            modifier.use_vert_data = True
            modifier.data_types_verts = {"VGROUP_WEIGHTS"}
            modifier.vert_mapping = "POLYINTERP_NEAREST"
            modifier.layers_vgroup_select_src = "ALL"
            modifier.layers_vgroup_select_dst = "NAME"
            bpy.ops.object.datalayout_transfer(modifier=modifier.name)
            bpy.ops.object.modifier_apply(modifier=modifier.name)
            removed = sorted(group.name for group in obj.vertex_groups if group.name not in permitted)
            for name in removed:
                obj.vertex_groups.remove(obj.vertex_groups[name])
            stripped[obj.name] = removed
            orphaned[obj.name] = _orphan(obj, armature, permitted)
            if mode == "stiff":
                _sharpen(obj, stiffness)
        else:
            rigid = slot["weights"]["rigidBone"]
            bone = rigid[side] if isinstance(rigid, dict) else rigid
            if not bone:
                raise GearWeightError("weight gate: rigid mode has no rigid bone")
            obj.vertex_groups.clear()
            obj.vertex_groups.new(name=bone).add(range(len(obj.data.vertices)), 1.0, "REPLACE")
            stripped[obj.name] = []
            orphaned[obj.name] = 0

        bpy.context.view_layer.objects.active = obj
        obj.select_set(True)
        bpy.ops.object.vertex_group_limit_total(
            group_select_mode="ALL", limit=STIFF_INFLUENCES if mode == "stiff" else 4)
        bpy.ops.object.vertex_group_normalize_all(group_select_mode="ALL", lock_active=False)
        bands[obj.name] = _band(obj)
        _parent(obj, armature)
    report = {
        "mode": mode,
        "strippedGroups": {name: groups for name, groups in stripped.items() if groups},
        "orphanedVertices": {name: count for name, count in orphaned.items() if count},
        "band": bands,
    }
    if mode == "stiff":
        report["stiffness"] = stiffness
    return report
