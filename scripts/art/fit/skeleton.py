"""Stage 3: the family skeleton, placed on the landmarks and oriented by rule.

The rule is in `frame.py` and in the family contract, and it is checked here
rather than trusted: every bone's measured axes are compared against what the
rule says they should be, and a bone that drifted fails the stage by name.

A bone's primary axis is fixed the moment its head and tail land on landmarks.
What the rule really decides is the roll, and roll is the difference between an
elbow that hinges about one axis and an elbow that needs two.
"""

from __future__ import annotations

import hashlib
import json
import math

import bpy
from mathutils import Vector

from .frame import BLENDER_FORWARD, BLENDER_LATERAL, blender_from_runtime, rounded

ARMATURE_NAME = "Rig"
AXIS_TOLERANCE_DEGREES = 0.5
DEGENERATE_LATERAL = 0.15


class SkeletonError(RuntimeError):
    pass


def _blender_landmarks(landmarks: dict) -> dict[str, Vector]:
    return {name: Vector(blender_from_runtime(point)) for name, point in landmarks.items()}


def _along(spec: dict, points: dict[str, Vector]) -> Vector:
    start, end = points[spec["from"]], points[spec["towards"]]
    return start + (end - start) * float(spec["along"])


def _endpoint(spec, points: dict[str, Vector]) -> Vector:
    return _along(spec, points) if isinstance(spec, dict) else points[spec]


def _roll_target(chain: str, direction: Vector) -> Vector:
    """The vector the bone's local +Z is rolled onto. See frame.py for why."""
    if chain == "spine":
        return Vector(BLENDER_FORWARD)
    lateral = Vector(BLENDER_LATERAL)
    target = lateral.cross(direction)
    if target.length < DEGENERATE_LATERAL:
        raise SkeletonError("axis rule: a limb bone runs along the lateral axis and has no hinge")
    return target.normalized()


def build(landmarks: dict, contract: dict, helpers: bool) -> dict:
    points = _blender_landmarks(landmarks)
    specs = list(contract["bones"]) + (list(contract["helpers"]) if helpers else [])
    for spec in specs:
        for end in ("head", "tail"):
            name = spec[end]
            wanted = [name] if isinstance(name, str) else [name["from"], name["towards"]]
            missing = [each for each in wanted if each not in points]
            if missing:
                raise SkeletonError(f"skeleton gate: bone {spec['name']} needs landmark {missing[0]}")

    armature_data = bpy.data.armatures.new(ARMATURE_NAME)
    armature = bpy.data.objects.new(ARMATURE_NAME, armature_data)
    bpy.context.scene.collection.objects.link(armature)
    bpy.context.view_layer.objects.active = armature
    bpy.ops.object.mode_set(mode="EDIT")

    chains = {}
    for spec in specs:
        bone = armature_data.edit_bones.new(spec["name"])
        bone.head = _endpoint(spec["head"], points)
        bone.tail = _endpoint(spec["tail"], points)
        bone.use_deform = bool(spec["deform"])
        if bone.length < 1e-4:
            raise SkeletonError(f"skeleton gate: bone {spec['name']} has no length")
        chains[spec["name"]] = spec.get("chain", "spine")
    for spec in specs:
        if spec["parent"]:
            armature_data.edit_bones[spec["name"]].parent = armature_data.edit_bones[spec["parent"]]
    for spec in specs:
        bone = armature_data.edit_bones[spec["name"]]
        bone.align_roll(_roll_target(chains[spec["name"]], Vector(bone.vector).normalized()))

    axes = {}
    for spec in specs:
        bone = armature_data.edit_bones[spec["name"]]
        direction = Vector(bone.vector).normalized()
        wanted = _roll_target(chains[spec["name"]], direction)
        wanted = (wanted - direction * wanted.dot(direction)).normalized()
        drift = math.degrees(math.acos(max(-1.0, min(1.0, bone.z_axis.normalized().dot(wanted)))))
        if drift > AXIS_TOLERANCE_DEGREES:
            raise SkeletonError(
                f"axis rule gate: bone {spec['name']} secondary axis is {drift:.3f} degrees off, "
                f"limit {AXIS_TOLERANCE_DEGREES}")
        axes[spec["name"]] = {
            "chain": chains[spec["name"]],
            "primary": rounded(direction),
            "secondary": rounded(bone.z_axis.normalized()),
            "hinge": rounded(bone.x_axis.normalized()),
            "driftDegrees": round(drift, 4),
            "roll": round(float(bone.roll), 6),
            "lengthMetres": round(float(bone.length), 6),
        }
    signature = _rest_signature(armature_data.edit_bones, specs)
    bpy.ops.object.mode_set(mode="OBJECT")

    return {"armature": armature, "report": {
        "bones": [spec["name"] for spec in contract["bones"]],
        "helpers": [spec["name"] for spec in contract["helpers"]] if helpers else [],
        "axes": axes,
        "restSignatureSha256": signature,
        "rule": contract["boneAxisRule"],
    }}


def _rest_signature(edit_bones, specs) -> str:
    records = [{
        "name": spec["name"],
        "parent": spec["parent"],
        "deform": bool(spec["deform"]),
        "head": rounded(edit_bones[spec["name"]].head),
        "tail": rounded(edit_bones[spec["name"]].tail),
        "roll": round(float(edit_bones[spec["name"]].roll), 6),
    } for spec in specs]
    canonical = json.dumps(records, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()
