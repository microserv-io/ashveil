"""Stage 1: whatever came out of the generator becomes a body in the runtime frame.

Import, keep every region and material and UV exactly as they arrived, then put
the body where the rest of the pipeline can assume it is: standing on the
ground, centred, facing forward, upright, at the family's canonical height.

Facing is measured, never assumed. Two independent cues have to agree - the
foot points from heel to toe, and the face points out of the head - because a
generator that emits a body backwards is indistinguishable from one that emits
it forwards until something asks the mesh.
"""

from __future__ import annotations

import math

import bmesh
import bpy
import numpy as np
from mathutils import Matrix, Vector

from . import landmarks as landmark_fitter
from .frame import blender_from_runtime, runtime_from_blender

HAIR_REGION = "Hair_Source"
FACING_AGREEMENT_DEGREES = 25.0
UPRIGHT_PASSES = 8


class NormaliseError(RuntimeError):
    pass


def _select(objects) -> None:
    bpy.ops.object.select_all(action="DESELECT")
    for obj in objects:
        obj.hide_set(False)
        obj.select_set(True)
    if objects:
        bpy.context.view_layer.objects.active = objects[0]


def _points(obj) -> np.ndarray:
    matrix = obj.matrix_world
    return np.array([tuple(matrix @ vertex.co) for vertex in obj.data.vertices], dtype=np.float64)


def _bounds(objects):
    stacked = np.concatenate([_points(obj) for obj in objects])
    return stacked.min(axis=0), stacked.max(axis=0)


def _import(path: str) -> None:
    bpy.ops.wm.read_factory_settings(use_empty=True)
    lowered = path.lower()
    if lowered.endswith(".fbx"):
        bpy.ops.import_scene.fbx(filepath=path)
    elif lowered.endswith(".glb") or lowered.endswith(".gltf"):
        bpy.ops.import_scene.gltf(filepath=path)
    else:
        raise NormaliseError(f"import gate: {path} is not an FBX or a glTF file")
    if not [obj for obj in bpy.context.scene.objects if obj.type == "MESH"]:
        raise NormaliseError("import gate: the file contains no mesh")


def _mesh_health(obj) -> dict:
    mesh = bmesh.new()
    mesh.from_mesh(obj.data)
    health = {
        "vertices": len(mesh.verts),
        "triangles": sum(max(0, len(face.verts) - 2) for face in mesh.faces),
        "ngons": sum(1 for face in mesh.faces if len(face.verts) > 4),
        "boundaryEdges": sum(1 for edge in mesh.edges if edge.is_boundary),
        "zeroAreaFaces": sum(1 for face in mesh.faces if face.calc_area() <= 1e-12),
    }
    mesh.free()
    return health


def _drop_degenerate(obj) -> int:
    mesh = bmesh.new()
    mesh.from_mesh(obj.data)
    degenerate = [face for face in mesh.faces if face.calc_area() <= 1e-12]
    if degenerate:
        bmesh.ops.delete(mesh, geom=degenerate, context="FACES")
        loose = [edge for edge in mesh.edges if not edge.link_faces]
        if loose:
            bmesh.ops.delete(mesh, geom=loose, context="EDGES")
        stray = [vertex for vertex in mesh.verts if not vertex.link_edges]
        if stray:
            bmesh.ops.delete(mesh, geom=stray, context="VERTS")
    if mesh.faces:
        bmesh.ops.recalc_face_normals(mesh, faces=list(mesh.faces))
    mesh.to_mesh(obj.data)
    mesh.free()
    obj.data.update()
    return len(degenerate)


def _split_islands(objects) -> list:
    islands = []
    for obj in objects:
        _select([obj])
        bpy.ops.object.mode_set(mode="EDIT")
        bpy.ops.mesh.select_all(action="SELECT")
        bpy.ops.mesh.separate(type="LOOSE")
        bpy.ops.object.mode_set(mode="OBJECT")
        islands.extend(part for part in bpy.context.selected_objects if part.type == "MESH")
    return list(dict.fromkeys(islands))


def _classify(islands, height: float) -> dict:
    """Name the regions from where they sit and how big they are.

    Deliberately geometric: the generator names its meshes after a job id, so
    position and size are the only evidence there is.
    """
    measured = []
    for obj in islands:
        points = _points(obj)
        low, high = points.min(axis=0), points.max(axis=0)
        measured.append({"object": obj, "points": points, "vertices": len(points),
                         "centre": (low + high) / 2, "size": high - low})
    body = max(measured, key=lambda item: (item["size"][2], item["vertices"]))
    rest = [item for item in measured if item is not body]

    upper = sorted([item for item in rest if item["centre"][2] > body["centre"][2] + height * 0.22],
                   key=lambda item: item["vertices"], reverse=True)
    if len(upper) < 2:
        raise NormaliseError("region gate: no separate head and hair island above the torso")
    hair, head = upper[0], upper[1]
    rest = [item for item in rest if item not in (hair, head)]

    hands = sorted([item for item in rest if abs(item["centre"][0]) > height * 0.16],
                   key=lambda item: item["vertices"], reverse=True)[:2]
    if len(hands) != 2:
        raise NormaliseError(f"region gate: found {len(hands)} hand islands, expected 2")
    rest = [item for item in rest if item not in hands]

    named = {"Body": body, HAIR_REGION: hair, "Head": head}
    for hand in hands:
        named[f"Hand_{'PositiveX' if hand['centre'][0] > 0 else 'NegativeX'}"] = hand
    if len(named) != 5:
        raise NormaliseError("region gate: the two hand islands sit on the same side")

    mirrored = sorted(
        ((abs(left["vertices"] - right["vertices"]) + abs(abs(left["centre"][0]) - abs(right["centre"][0])) * 1000,
          left, right)
         for left in rest for right in rest if left["centre"][0] > 0 > right["centre"][0]),
        key=lambda entry: entry[0])
    if mirrored:
        _, left, right = mirrored[0]
        named["Eye_PositiveX"], named["Eye_NegativeX"] = left, right
        rest = [item for item in rest if item not in (left, right)]
    for at, item in enumerate(sorted(rest, key=lambda item: -item["vertices"]), start=1):
        named[f"Facial_Feature_{at:02d}"] = item

    _name(named)
    return named


def _name(named: dict) -> None:
    """Two passes, because Blender suffixes a name that is already taken and a
    suffixed node name is a dot the runtime would have to strip."""
    for at, item in enumerate(named.values()):
        item["object"].name = f"__fitting_{at}"
        item["object"].data.name = f"__fitting_{at}"
    for name, item in named.items():
        item["object"].name = name
        item["object"].data.name = f"{name}_Mesh"
        item["name"] = name


def _relabel_sides(named: dict) -> dict:
    """Left and right are only knowable once the body faces forward.

    Classification runs before the facing turn because it needs the head and the
    feet to measure the heading at all, and a body that arrives backwards has its
    sides swapped by that turn. So the paired regions are named here, afterwards,
    off their own coordinates.
    """
    relabelled = {name: item for name, item in named.items() if not name.startswith(("Hand_", "Eye_"))}
    for prefix in ("Hand", "Eye"):
        pair = [item for name, item in named.items() if name.startswith(f"{prefix}_")]
        if not pair:
            continue
        if len(pair) != 2 or (pair[0]["centre"][0] > 0) == (pair[1]["centre"][0] > 0):
            raise NormaliseError(f"region gate: the {prefix} islands do not sit one per side")
        for item in pair:
            relabelled[f"{prefix}_{'PositiveX' if item['centre'][0] > 0 else 'NegativeX'}"] = item
    _name(relabelled)
    return relabelled


def _transform(objects, matrix: Matrix) -> None:
    for obj in objects:
        for vertex in obj.data.vertices:
            vertex.co = matrix @ (obj.matrix_world @ vertex.co)
        obj.matrix_world.identity()
        obj.data.update()


def _facing(named: dict, height: float) -> dict:
    """Yaw that takes the body's own forward onto Blender's front, which is -Y."""
    body = named["Body"]["points"]
    floor = body[:, 2].min()
    sole = body[body[:, 2] <= floor + height * 0.07]
    sole = sole[sole[:, 0] > 0] if (sole[:, 0] > 0).sum() > 24 else sole
    if len(sole) < 24:
        raise NormaliseError("facing gate: no foot geometry to read a heading from")
    # One foot at a time: both feet together are wider than either is long, and
    # the long axis of the pair is the axis between them, not the heading.
    span = sole[:, :2].max(axis=0) - sole[:, :2].min(axis=0)
    axis = int(np.argmax(span))
    toe = sole[sole[:, axis] >= sole[:, axis].max() - height * 0.02].mean(axis=0)
    heel = sole[sole[:, axis] <= sole[:, axis].min() + height * 0.02].mean(axis=0)
    # A foot is longer than it is wide, so its long axis is the heading; which
    # end is the toe is decided by the face, below.
    foot_cue = np.array([toe[0] - heel[0], toe[1] - heel[1]])

    cues = {"foot": foot_cue / max(np.linalg.norm(foot_cue), 1e-9)}
    eyes = [item["points"] for name, item in named.items() if name.startswith("Eye_")]
    if eyes:
        eye_centre = np.concatenate(eyes).mean(axis=0)
        head_centre = named["Head"]["points"].mean(axis=0)
        face_cue = np.array([eye_centre[0] - head_centre[0], eye_centre[1] - head_centre[1]])
        cues["face"] = face_cue / max(np.linalg.norm(face_cue), 1e-9)
        if float(np.dot(cues["foot"], cues["face"])) < 0:
            cues["foot"] = -cues["foot"]
        agreement = math.degrees(math.acos(max(-1.0, min(1.0, float(np.dot(cues["foot"], cues["face"]))))))
        if agreement > FACING_AGREEMENT_DEGREES:
            raise NormaliseError(
                f"facing gate: the feet and the face disagree by {agreement:.1f} degrees "
                f"(feet {cues['foot'].round(3).tolist()}, face {cues['face'].round(3).tolist()})")
    else:
        agreement = None
    heading = cues.get("face", cues["foot"]) + cues["foot"]
    heading = heading / max(np.linalg.norm(heading), 1e-9)
    yaw = math.atan2(-heading[0], -heading[1]) - math.atan2(0.0, -1.0)
    return {"yawDegrees": round(math.degrees(yaw), 4),
            "cueAgreementDegrees": None if agreement is None else round(agreement, 3),
            "cues": {name: [round(float(value), 4) for value in cue] for name, cue in cues.items()},
            "matrix": Matrix.Rotation(-yaw, 4, "Z")}


def _upright(regions: dict, pivot: Vector, height: float) -> dict:
    """How far the torso axis leans, and the turn about the ankles that fixes it."""
    body = regions["Body"]
    hip, torso = landmark_fitter.torso_lean(body, float(body[:, 1].min()), height)
    axis = np.array(blender_from_runtime(torso - hip))
    axis = axis / max(np.linalg.norm(axis), 1e-9)
    lean = math.degrees(math.acos(max(-1.0, min(1.0, float(axis[2])))))
    turn = Vector(axis).rotation_difference(Vector((0.0, 0.0, 1.0)))
    matrix = Matrix.Translation(pivot) @ turn.to_matrix().to_4x4() @ Matrix.Translation(-pivot)
    return {"leanDegrees": round(lean, 4), "matrix": matrix}


def run(input_path: str, contract: dict) -> dict:
    _import(input_path)
    meshes = [obj for obj in bpy.context.scene.objects if obj.type == "MESH"]
    imported = {"meshObjects": len(meshes),
                "materials": sorted({slot.material.name for obj in meshes for slot in obj.material_slots if slot.material}),
                "images": sorted(image.name for image in bpy.data.images if image.size[0] > 0),
                "uvLayers": {obj.name: [layer.name for layer in obj.data.uv_layers] for obj in meshes}}
    for obj in meshes:
        _select([obj])
        bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    removed = sum(_drop_degenerate(obj) for obj in meshes)

    islands = _split_islands(meshes)
    low, high = _bounds(islands)
    source_height = float(high[2] - low[2])
    named = _classify(islands, source_height)

    facing = _facing(named, source_height)
    _transform([item["object"] for item in named.values()], facing["matrix"])
    for item in named.values():
        item["points"] = _points(item["object"])
        item["centre"] = (item["points"].min(axis=0) + item["points"].max(axis=0)) / 2
    named = _relabel_sides(named)

    keep = {name: item for name, item in named.items() if name != HAIR_REGION}
    missing = [name for name in contract["regions"]["required"] if name not in keep]
    if missing:
        raise NormaliseError(f"region gate: no island classified as {', '.join(missing)}")
    for name in contract["regions"]["excluded"]:
        if name in named:
            bpy.data.objects.remove(named[name]["object"], do_unlink=True)

    kept = [item["object"] for item in keep.values()]
    # Centre and ground first: the torso measurement reads a central slice about
    # x = 0, so it has to be measured on a body that is already on the midline.
    low, high = _bounds(kept)
    _transform(kept, Matrix.Translation(Vector((-(low[0] + high[0]) / 2, -(low[1] + high[1]) / 2, -low[2]))))
    low, high = _bounds(kept)
    body_height = float(high[2] - low[2])
    width = float(high[0] - low[0])
    regions = {name: np.array([runtime_from_blender(point) for point in _points(item["object"])])
               for name, item in keep.items()}
    ankle_band = regions["Body"][:, 1] <= body_height * 0.09
    ankle_pivot = Vector((0.0, 0.0, 0.0))
    if ankle_band.any():
        ankles = regions["Body"][ankle_band].mean(axis=0)
        ankle_pivot = Vector((0.0, -float(ankles[2]), 0.0))

    # One rotation does not settle it: the bands the axis is measured in are
    # relative to the body's own height, so moving the body moves the reading.
    limit = contract["gates"]["uprightDegrees"]
    leans = []
    for _ in range(UPRIGHT_PASSES):
        upright = _upright(regions, ankle_pivot, body_height)
        leans.append(upright["leanDegrees"])
        if upright["leanDegrees"] <= limit:
            break
        _transform(kept, upright["matrix"])
        regions = {name: np.array([runtime_from_blender(point) for point in _points(item["object"])])
                   for name, item in keep.items()}
    else:
        raise NormaliseError(
            f"upright gate: the torso axis did not settle under {limit} degrees in "
            f"{UPRIGHT_PASSES} passes: {leans}")
    upright = {"leanDegrees": leans[0], "passes": len(leans) - 1, "perPassDegrees": leans,
               "limitDegrees": limit, "pivot": [round(float(value), 6) for value in ankle_pivot]}

    low, high = _bounds(kept)
    scale = contract["canonicalHeight"] / float(high[2] - low[2])
    centre = Matrix.Translation(Vector((-(low[0] + high[0]) / 2, -(low[1] + high[1]) / 2, -low[2])))
    _transform(kept, Matrix.Scale(scale, 4) @ centre)

    regions = {name: np.array([runtime_from_blender(point) for point in _points(item["object"])])
               for name, item in keep.items()}
    everything = np.concatenate(list(regions.values()))
    residual = landmark_fitter.torso_lean(regions["Body"], float(everything[:, 1].min()),
                                          contract["canonicalHeight"])
    residual_axis = residual[1] - residual[0]
    residual_lean = math.degrees(math.acos(max(-1.0, min(1.0, float(
        residual_axis[1] / max(np.linalg.norm(residual_axis), 1e-9))))))
    if residual_lean > contract["gates"]["uprightDegrees"]:
        raise NormaliseError(
            f"upright gate: torso axis is {residual_lean:.3f} degrees off vertical, "
            f"limit {contract['gates']['uprightDegrees']}")

    health = {name: _mesh_health(item["object"]) for name, item in keep.items()}
    return {
        "regions": regions,
        "objects": {name: item["object"] for name, item in keep.items()},
        "report": {
            "input": {"path": input_path, **imported, "removedZeroAreaFaces": removed,
                      "sourceHeightMetres": round(source_height, 6)},
            "regionsKept": sorted(keep),
            "regionsExcluded": [name for name in contract["regions"]["excluded"] if name in named],
            "facing": {key: value for key, value in facing.items() if key != "matrix"},
            "upright": {**upright, "residualDegrees": round(residual_lean, 4)},
            "scaleFactor": round(scale, 9),
            "standingHeightMetres": round(float(everything[:, 1].max() - everything[:, 1].min()), 6),
            "groundOffsetMetres": round(float(everything[:, 1].min()), 6),
            "lateralCentreMetres": round(float((everything[:, 0].min() + everything[:, 0].max()) / 2), 6),
            "meshHealth": health,
            "triangles": sum(region["triangles"] for region in health.values()),
        },
    }
