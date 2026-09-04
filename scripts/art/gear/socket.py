"""Socket placement: a shoulder cap is a rigid part registered onto the shoulder.

A pauldron is not a garment. It is a plate that sits over the crest of the shoulder,
with hardware bolted through it and cloth hanging off it. The body has an opinion
about where it goes - the top of the shoulder, and the width of the muscle under it -
and no opinion at all about its shape. So nothing here deforms a vertex.

The whole rule, per side: the largest island is the cap, everything else on that side
rides it. The cap is scaled so it spans the deltoid, and is dropped so its own crest -
the highest vertex of its inner face - lands on the body's shoulder crest plus the
slot's clearance. A rigid ICP then turns and slides it until its inner face stands one
clearance off the skin all along, bounded to 45 degrees, and a push out along the
surface normal frees whatever is still buried. One rigid transform per side, applied to
every island of that side alike.

Which way up the cap starts is measured, not assumed. The orientation a Tripo source is
drawn in is one guess among several - a cap can come back presenting its opening at the
camera - and a 45 degree ICP bound cannot walk out of a wrong one. So the whole
placement is run from a grid of seed poses, yaw about the body's vertical crossed with
pitch about the horizontal axis across the arm, and the seeds are scored: the mean gap
of the inner face from its target clearance, plus a millimetre for every percent of the
plate left inside the bare body, less half a millimetre for every percent of the
deltoid the plate covers. Lowest score wins, and the two shoulders must agree on a
seed, because a pair whose sides chose different poses is not a pair.

Measuring it does not settle it. Three derivations - the arm's own tilt, an ICP from
the drawn pose, a scored grid of seeds - each produced a pose that was rejected on
sight, so the orientation is declared instead: `--orient yaw:pitch:roll` turns the cap
about the crest the anchor put it on, `--offset dx:dy:dz` slides it, and the right
shoulder wears the mirror of both without being told twice - or `--orient-right` and
`--offset-right` when the two halves of a source are not the mirrors of each other
they were drawn as. That is how a game attaches a shoulder, and it is what the
pipeline already learned about this slot's neighbours: an orientation is authored per
item, not derived. Declaring one replaces the ICP, because a registration that argues
with the author is not an author.

The plate is measured against what it is worn over as well as what it is worn on:
`hidesPieces` names the vertices of each piece beneath that stand behind the cap, so
the tunic's shoulder stops drawing through the armour. That is a bind-pose fact about
two fitted pieces and cannot be left to burial, which sees one frame.

The tilt this replaced stood the cap up on the upper arm's axis, which is 10 degrees
from vertical where the cap is drawn leaning 35 degrees down the deltoid, and the
anchor put it on the centroid of the muscle rather than the crest above it: together
they hung the plate on the arm like a sleeve and left the top of the shoulder bare.
Both survive behind `--anchor deltoid` because the comparison is the evidence.

This exists because the alignment the shipped pauldrons went through put 61% and 79%
of the piece inside the body and then shrinkwrapped every vertex 2.9 times to get it
out, which is what "the vertices are breaking" looks like from the review camera.
"""

from __future__ import annotations

import argparse
import json
import math
import sys
import traceback
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import bpy  # noqa: E402
import numpy as np  # noqa: E402
from mathutils import Matrix, Vector  # noqa: E402
from mathutils.bvhtree import BVHTree  # noqa: E402
from mathutils.kdtree import KDTree  # noqa: E402

from fit import export as exporter  # noqa: E402
from fit.frame import blender_from_runtime, runtime_from_blender  # noqa: E402
from fit.glb import Glb  # noqa: E402
from fit import normalise  # noqa: E402
from gear import body, drape, gate, geometry, piece, ring, weights  # noqa: E402

ROOT = Path(__file__).resolve().parents[3]
CONTRACT_PATH = ROOT / "scripts" / "art" / "contracts" / "humanoid.v1.json"

# How much wider than the muscle a pauldron reads as armour rather than a pip.
DELTOID_FACTOR = 1.15
# The cap is the fixed part of its island; below this line the same island is cloth,
# and cloth hanging past the elbow must not set the cap's scale.
CAP_FRACTION = 0.5
# The innermost slice of the cap along its own axis: the dome's apex, as a mean rather
# than one vertex, because one vertex of a Tripo mesh is noise.
APEX_FRACTION = 0.05
# The axis and the apex define each other, so they are solved for together.
AXIS_PASSES = 4
# Past this the cap is not the shape the rule assumes and the fallback is honest.
MAX_TILT_DEGREES = 30.0
# Below this a vertex grazes the body rather than sits inside it.
CLEARANCE_DEPTH = 0.002
# What a cleared side keeps beyond the surface it was buried in.
CLEARANCE_MARGIN = 0.003
# The shoulder is not a sphere, so one push out can find a new worst vertex.
CLEARANCE_PASSES = 6
# A rigid cap that cannot be freed inside this is a cap in the wrong place, and
# pushing further hides that by launching it off the shoulder.
MAX_CLEARANCE = 0.04
# The share of the fixed cap the seat is asked to lift clear.
SEAT_PERCENTILE = 95.0
# How far from the joint, horizontally, the shoulder's crest is looked for.
CREST_RADIUS = 0.04
ICP_PASSES = 25
# Past this a nearest point is another limb, not the shoulder this cap sits on.
ICP_REJECT = 0.04
# A tenth of a millimetre is the registration having stopped moving.
ICP_SETTLE = 0.0001
# The cap is placed as drawn; a registration that turns it further than this has
# stopped correcting the drawing and started arguing with it.
ICP_MAX_DEGREES = 45.0
# The share of the cap nearest its own axis, when the shell's normals do not split an
# inner face off an outer one - a single-sided cap has no inner wall to find.
INNER_FRACTION = 0.4
MIN_INNER_VERTICES = 40
PUSH_PASSES = 3
PUSH_LIMIT = 0.03
# An island reaching this close to the midline bridges the chest between the two caps
# rather than sitting on one shoulder, and belongs to neither side's registration.
STRAP_MIDLINE = 0.06
# A shoulders region thinner than this is not a deltoid and cannot set a width.
MIN_REGION_VERTICES = 50
MIN_REGION_WIDTH = 0.04
# How far a body vertex's own normal may travel before a cap over it stops covering it.
COVERAGE_REACH = 0.06
# How far a lower piece's own outward normal may travel before the plate over it
# stops standing in front of it. The cap's clearance is 16 mm and the tunic under it
# is a shell of its own, so a reach shorter than this leaves the cloth showing.
HIDE_REACH = 0.03
RAY_NUDGE = 1e-5
RAY_HIT_LIMIT = 64
RAY_AXES = (Vector((1.0, 0.0, 0.0)), Vector((0.0, 1.0, 0.0)), Vector((0.0, 0.0, 1.0)))
# The orientations the registration is started from. Quarter turns about the body's
# vertical answer "is the cap facing the way it was drawn", and the pitch answers "is
# it presenting its opening rather than its shell"; 45 degrees is the ICP's own bound,
# so neighbouring seeds can reach each other and the grid has no gap in it.
SEED_YAW_DEGREES = (0.0, 90.0, 180.0, 270.0)
SEED_PITCH_DEGREES = (0.0, 45.0, -45.0)
# A millimetre of residual is worth a percent of the plate buried in the body, and two
# percent of the deltoid covered. Coverage is what a pauldron is for, penetration is
# what makes one unshippable, and the residual only says the registration converged.
SCORE_PENETRATION_PER_PERCENT = 1.0
SCORE_COVERAGE_PER_PERCENT = 0.5
UP = np.array([0.0, 1.0, 0.0])
FORWARD = np.array([0.0, 0.0, 1.0])
ACROSS = np.array([1.0, 0.0, 0.0])
# Runtime (+Y up, +Z forward) from Blender (+Z up, -Y forward), as a linear map.
TO_BLENDER = np.array([[1.0, 0.0, 0.0], [0.0, 0.0, -1.0], [0.0, 1.0, 0.0]])


class SocketError(RuntimeError):
    pass


def unit(vector) -> np.ndarray:
    vector = np.asarray(vector, dtype=np.float64)
    return vector / max(float(np.linalg.norm(vector)), 1e-12)


def area_normal(obj) -> np.ndarray:
    """Which way the shell faces, area weighted: a dome's own axis, outward."""
    matrix = obj.matrix_world.to_3x3()
    total = np.zeros(3)
    for face in obj.data.polygons:
        total += np.array(runtime_from_blender(matrix @ face.normal)) * face.area
    return unit(total)


def opening_axis(points: np.ndarray, seed: np.ndarray) -> tuple[np.ndarray, np.ndarray, list[dict]]:
    """The axis from the cap's inner apex through its centroid, and that apex.

    The apex is the innermost slice along the axis and the axis runs from the apex, so
    each is the other's definition; four passes from the shell's own facing settle it.
    The trace is reported because a cap this does not converge on is a cap the rule
    cannot place, and that has to be visible rather than averaged away.
    """
    axis = unit(seed)
    centroid = points.mean(axis=0)
    apex = centroid
    trace = []
    for _ in range(AXIS_PASSES):
        along = points @ axis
        apex = points[along <= np.quantile(along, APEX_FRACTION)].mean(axis=0)
        turned = unit(centroid - apex)
        trace.append({"axis": [round(float(value), 6) for value in turned],
                      "turnDegrees": round(float(np.degrees(np.arccos(np.clip(turned @ axis, -1.0, 1.0)))), 4)})
        axis = turned
    return axis, apex, trace


def spin_z(degrees: float) -> np.ndarray:
    """A tilt about the runtime forward axis, which is the one a shoulder needs."""
    angle = math.radians(degrees)
    cos, sin = math.cos(angle), math.sin(angle)
    return np.array([[cos, -sin, 0.0], [sin, cos, 0.0], [0.0, 0.0, 1.0]])


def turn_about(axis: np.ndarray, degrees: float) -> np.ndarray:
    """A rotation about any axis, Rodrigues, exactly the identity at zero."""
    axis = unit(axis)
    angle = math.radians(degrees)
    cross = np.array([[0.0, -axis[2], axis[1]],
                      [axis[2], 0.0, -axis[0]],
                      [-axis[1], axis[0], 0.0]])
    return np.eye(3) + math.sin(angle) * cross + (1.0 - math.cos(angle)) * (cross @ cross)


def triple(text: str, flag: str) -> np.ndarray:
    """`a:b:c` as three numbers, or a named gate rather than a stack trace."""
    parts = text.split(":")
    if len(parts) != 3:
        raise SocketError(f"{flag} gate: \"{text}\" is not three values separated by colons")
    try:
        return np.array([float(part) for part in parts], dtype=np.float64)
    except ValueError as error:
        raise SocketError(f"{flag} gate: \"{text}\" has a value that is not a number") from error


def hand_of(side: str) -> float:
    return 1.0 if side == "L" else -1.0


def declared(orient: np.ndarray, side: str) -> np.ndarray:
    """A pose that is stated rather than searched for: yaw, then pitch, then roll.

    Yaw turns the cap about the body's vertical, pitch tips it about the axis across
    the body, roll rocks it about forward. Mirroring about X negates a rotation about
    Y and one about Z and leaves one about X alone, so the right shoulder wears the
    author's own numbers with the yaw and the roll turned round and is the mirror of
    the left rather than a second guess at the same piece.
    """
    hand = hand_of(side)
    return (turn_about(UP, hand * float(orient[0])) @ turn_about(ACROSS, float(orient[1]))
            @ turn_about(FORWARD, hand * float(orient[2])))


def declared_offset(offset: np.ndarray, side: str) -> np.ndarray:
    return offset * np.array([hand_of(side), 1.0, 1.0])


def seed_grid(side: str, axis_arm: np.ndarray, mode: str) -> list[dict]:
    """The poses the registration starts from, named so the two sides share the names.

    Yaw turns the cap about the body's vertical, pitch tips it about the horizontal
    axis across the arm. Mirroring a rotation negates its axis' X and its angle, and
    the pitch axis already flips with the arm, so only the yaw is negated on the right:
    seed y90p45 on one shoulder is then the mirror of y90p45 on the other rather than a
    different pose wearing the same name, and "did the sides agree" is a name test.
    """
    pitch_axis = unit(np.cross(UP, axis_arm))
    hand = 1.0 if side == "L" else -1.0
    yaws = SEED_YAW_DEGREES if mode == "grid" else (0.0,)
    pitches = SEED_PITCH_DEGREES if mode == "grid" else (0.0,)
    return [{"label": f"y{int(yaw)}p{int(pitch)}", "yawDegrees": yaw, "pitchDegrees": pitch,
             "pitchAxis": rounded_list(pitch_axis),
             "rotation": turn_about(UP, hand * yaw) @ turn_about(pitch_axis, pitch)}
            for yaw in yaws for pitch in pitches]


def faces_of(obj) -> list[tuple[int, int, int]]:
    """One object's triangles as vertex indices, so a moved copy can be a tree."""
    faces: list[tuple[int, int, int]] = []
    for face in obj.data.polygons:
        corners = list(face.vertices)
        faces.extend((corners[0], corners[at], corners[at + 1])
                     for at in range(1, len(corners) - 1))
    return faces


def tree_of_points(points: np.ndarray, faces: list) -> BVHTree:
    """A cap's tree where a seed would put it, without moving the cap to find out."""
    return BVHTree.FromPolygons([blender_from_runtime(point) for point in points],
                                faces, all_triangles=True)


def tilt_degrees(axis: np.ndarray, target: np.ndarray) -> float:
    """How far about Z the cap's axis has to turn to lie under the arm's, signed."""
    turn = math.atan2(target[1], target[0]) - math.atan2(axis[1], axis[0])
    return math.degrees(math.atan2(math.sin(turn), math.cos(turn)))


def outer_hit(tree: BVHTree, origin: np.ndarray, direction: np.ndarray) -> dict:
    """The last surface a ray leaving a bone crosses: the outside of everything worn.

    The first hit from inside the body is the skin, and the piece goes over the tunic,
    so the surface that matters is the far side of the whole dressed target rather
    than the first one the ray meets.
    """
    step = Vector(blender_from_runtime(direction))
    at = Vector(blender_from_runtime(origin))
    hits = []
    while len(hits) <= RAY_HIT_LIMIT:
        hit, _, _, _ = tree.ray_cast(at, step)
        if hit is None:
            break
        hits.append(np.array(runtime_from_blender(hit), dtype=np.float64))
        at = hit + step * RAY_NUDGE
    if not hits:
        raise SocketError("socket gate: the ray from the joint never leaves the body")
    return {"point": hits[-1], "crossings": len(hits),
            "firstMetres": round(float(np.linalg.norm(hits[0] - origin)), 6),
            "lastMetres": round(float(np.linalg.norm(hits[-1] - origin)), 6)}


def apply_similarity(objects: list, scale: float, rotation: np.ndarray, pivot: np.ndarray,
                     destination: np.ndarray) -> None:
    """One scale, one rotation, one translation, on every island of a side alike."""
    linear = TO_BLENDER @ (scale * rotation) @ TO_BLENDER.T
    offset = TO_BLENDER @ destination - linear @ (TO_BLENDER @ pivot)
    matrix = Matrix.Translation(Vector(tuple(offset))) @ Matrix(
        [list(row) for row in linear]).to_4x4()
    for obj in objects:
        obj.matrix_world = matrix @ obj.matrix_world
        bpy.ops.object.select_all(action="DESELECT")
        obj.select_set(True)
        bpy.context.view_layer.objects.active = obj
        bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)


def slide(objects: list, shift: np.ndarray) -> None:
    for obj in objects:
        obj.matrix_world = (Matrix.Translation(Vector(blender_from_runtime(shift)))
                            @ obj.matrix_world)
        bpy.ops.object.select_all(action="DESELECT")
        obj.select_set(True)
        bpy.context.view_layer.objects.active = obj
        bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)


def normals_of(obj) -> np.ndarray:
    """One object's vertex normals in the runtime frame."""
    rotation = obj.matrix_world.to_3x3().inverted().transposed()
    return np.array([unit(runtime_from_blender(rotation @ vertex.normal))
                     for vertex in obj.data.vertices], dtype=np.float64)


def skin_points(meshes: list) -> np.ndarray:
    points: list = []
    for obj in meshes:
        matrix = obj.matrix_world
        points.extend(runtime_from_blender(matrix @ vertex.co) for vertex in obj.data.vertices)
    return np.array(points, dtype=np.float64)


def crest_of(skin: np.ndarray, joint: np.ndarray, radius: float) -> np.ndarray:
    """The top of the shoulder: the highest skin standing over the joint.

    Horizontally around the joint rather than nearest to it, because the nearest
    surface to a joint buried in a deltoid is the side of the arm.
    """
    flat = np.linalg.norm(skin[:, [0, 2]] - joint[[0, 2]], axis=1)
    near = skin[flat <= radius]
    if len(near) == 0:
        raise SocketError(f"crest gate: no skin within {radius} m of the joint")
    return near[int(np.argmax(near[:, 1]))]


def inner_face(points: np.ndarray, normals: np.ndarray, axis: np.ndarray,
               apex: np.ndarray, rule: str = "nearest") -> tuple[np.ndarray, str]:
    """The side of the cap that looks at the shoulder: its concave wall.

    A cap is a shell with two walls, and only the one facing the body has anything to
    say about where the body is. Which wall that is, is the sign of a vertex normal
    against the direction out of the cap's own axis: the inner wall faces the hollow
    the shoulder fills. A cap drawn as a single surface has no such wall, and the
    fraction nearest the axis is the honest fallback rather than a silent half.
    """
    along = (points - apex) @ axis
    radial = points - apex - np.outer(along, axis)
    reach = np.linalg.norm(radial, axis=1)
    outward = radial / np.maximum(reach, 1e-12)[:, None]
    facing = np.einsum("ij,ij->i", normals, outward)
    chosen = (facing < 0.0) & (reach > 1e-4)
    if rule == "normals" and int(chosen.sum()) >= MIN_INNER_VERTICES:
        return chosen, "vertex normals that face the cap's own axis"
    return reach <= float(np.quantile(reach, INNER_FRACTION)), (
        f"the {INNER_FRACTION:.0%} of the cap nearest its own axis")


def nearest_surface(tree: BVHTree, point: np.ndarray):
    """The closest point on a target, its outward normal, and the distance to it."""
    hit, normal, _, distance = tree.find_nearest(Vector(blender_from_runtime(point)))
    if hit is None:
        return None
    return (np.array(runtime_from_blender(hit), dtype=np.float64),
            unit(runtime_from_blender(normal)), float(distance))


def kabsch(source: np.ndarray, goal: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """The rotation and translation that best carry one point set onto another."""
    source_centre, goal_centre = source.mean(axis=0), goal.mean(axis=0)
    covariance = (source - source_centre).T @ (goal - goal_centre)
    left, _, right = np.linalg.svd(covariance)
    flip = np.diag([1.0, 1.0, float(np.sign(np.linalg.det(right.T @ left.T)) or 1.0)])
    rotation = right.T @ flip @ left.T
    return rotation, goal_centre - rotation @ source_centre


def axis_angle(rotation: np.ndarray) -> tuple[np.ndarray, float]:
    """A rotation as the axis it turns about and how far, in degrees."""
    angle = math.degrees(math.acos(max(-1.0, min(1.0, (float(np.trace(rotation)) - 1.0) * 0.5))))
    axis = np.array([rotation[2, 1] - rotation[1, 2], rotation[0, 2] - rotation[2, 0],
                     rotation[1, 0] - rotation[0, 1]])
    if float(np.linalg.norm(axis)) < 1e-9:
        values, vectors = np.linalg.eig(rotation)
        axis = np.real(vectors[:, int(np.argmin(np.abs(values - 1.0)))])
    return unit(axis), angle


def register(points: np.ndarray, normals: np.ndarray, tree: BVHTree,
             clearance: float) -> dict:
    """Turn and slide a rigid inner face until it stands one clearance off the skin.

    The correspondence test is that the two shells face each other, not that the
    target's normal faces the vertex: a cap that starts buried has every nearest
    normal pointing away from it, and the literal front-face test would starve the
    first pass of exactly the vertices that need moving. How many pairs would have
    passed that test too is counted rather than assumed.
    """
    rotation, shift = np.eye(3), np.zeros(3)
    placed = points.copy()
    trace: list[dict] = []
    residual = None
    bounded = False
    for _ in range(ICP_PASSES):
        turned = normals @ rotation.T
        sources, goals, front = [], [], 0
        for at, point in enumerate(placed):
            found = nearest_surface(tree, point)
            if found is None:
                continue
            surface, normal, distance = found
            if distance > ICP_REJECT or float(turned[at] @ normal) >= 0.0:
                continue
            if float((point - surface) @ normal) > 0.0:
                front += 1
            sources.append(point)
            goals.append(surface + normal * clearance)
        if len(sources) < MIN_INNER_VERTICES:
            trace.append({"pairs": len(sources), "stopped": "too few correspondences"})
            break
        step, offset = kabsch(np.array(sources), np.array(goals))
        wanted = step @ rotation
        _, turned_by = axis_angle(wanted)
        if turned_by > ICP_MAX_DEGREES:
            bounded = True
            trace.append({"pairs": len(sources), "wantedDegrees": round(turned_by, 4),
                          "stopped": f"past the {ICP_MAX_DEGREES:.0f} degree bound"})
            break
        rotation, shift = wanted, step @ shift + offset
        placed = points @ rotation.T + shift
        gaps = np.array([nearest_surface(tree, point)[2] for point in placed])
        moved = np.abs(gaps - clearance)
        settled = residual is not None and abs(residual - float(moved.mean())) < ICP_SETTLE
        residual = float(moved.mean())
        trace.append({"pairs": len(sources), "frontFacingPairs": front,
                      "meanResidualMillimetres": round(residual * 1000.0, 4),
                      "rotationDegrees": round(turned_by, 4)})
        if settled:
            break
    gaps = np.array([nearest_surface(tree, point)[2] for point in placed])
    moved = np.abs(gaps - clearance)
    axis, degrees = axis_angle(rotation)
    return {"rotation": rotation, "translation": shift, "placed": placed,
            "iterations": len(trace), "bounded": bounded, "trace": trace,
            "axis": [round(float(value), 6) for value in axis],
            "degrees": round(degrees, 4),
            "residualMeanMillimetres": round(float(moved.mean()) * 1000.0, 4),
            "residualP95Millimetres": round(float(np.percentile(moved, 95.0)) * 1000.0, 4)}


def _declare(plan: dict, wall: np.ndarray, crest: np.ndarray) -> dict:
    """The authored pose, in the shape a registration returns.

    Three attempts to derive this cap's orientation from the geometry each landed a
    pose the eye rejects, which is the ordinary answer: a shoulder's offset is
    authored per item, the way a game attaches one. So the turn is read off the flags
    and taken, about the crest the anchor has already placed, and the residual is
    still measured - a declared pose earns the same numbers a searched one does.
    """
    rotation = declared(plan["orient"], plan["side"])
    offset = declared_offset(plan["offset"], plan["side"])
    shift = crest - rotation @ crest + offset
    placed = wall @ rotation.T + shift
    gaps = np.array([nearest_surface(plan["dressed"].every, point)[2] for point in placed])
    moved = np.abs(gaps - plan["clearance"])
    axis, degrees = axis_angle(rotation)
    return {"rotation": rotation, "translation": shift, "placed": placed,
            "iterations": 0, "bounded": False, "trace": [], "axis": rounded_list(axis),
            "degrees": round(degrees, 4),
            "residualMeanMillimetres": round(float(moved.mean()) * 1000.0, 4),
            "residualP95Millimetres": round(float(np.percentile(moved, 95.0)) * 1000.0, 4)}


def push_out(placed: np.ndarray, tree: BVHTree, surface: geometry.Surface) -> tuple[np.ndarray, list]:
    """Lift a rigid part off whatever it is still buried in, along the skin's own normal."""
    moved = np.zeros(3)
    passes: list[dict] = []
    for _ in range(PUSH_PASSES):
        buried = depths(placed + moved, surface)
        worst = float(buried.max(initial=0.0))
        if worst <= CLEARANCE_DEPTH:
            break
        found = nearest_surface(tree, placed[int(np.argmax(buried))] + moved)
        step = min(worst + CLEARANCE_MARGIN, PUSH_LIMIT - float(np.linalg.norm(moved)))
        if found is None or step <= 0.0:
            break
        moved = moved + found[1] * step
        passes.append({"pushMetres": round(step, 6),
                       "alongNormal": [round(float(value), 6) for value in found[1]],
                       "depthBeforeMetres": round(worst, 6),
                       "depthAfterMetres": round(
                           float(depths(placed + moved, surface).max(initial=0.0)), 6)})
    return moved, passes


def depths(points: np.ndarray, surface: geometry.Surface) -> np.ndarray:
    """How deep each vertex sits in what a viewer sees.

    `geometry.Surface.probe`, not a plain parity test: the tunic is an open shell, and
    parity alone calls a point well outboard of the arm "inside" it through the sleeve
    hole. The lateral seat below chases that reading for ever - it pushed the cap 11 cm
    off the shoulder before the nearest-normal agreement was put back in.
    """
    return np.array([surface.penetration(point) for point in points])


def region_normals(loaded: dict, region: dict[str, np.ndarray]) -> dict[str, np.ndarray]:
    """Each region point's own outward normal, looked up on the body it came from."""
    points, normals = [], []
    for obj in loaded["meshes"]:
        matrix = obj.matrix_world
        rotation = matrix.to_3x3().inverted().transposed()
        for vertex in obj.data.vertices:
            points.append(runtime_from_blender(matrix @ vertex.co))
            normals.append(runtime_from_blender(rotation @ vertex.normal))
    tree = KDTree(len(points))
    for at, point in enumerate(points):
        tree.insert(Vector(tuple(point)), at)
    tree.balance()
    found = {}
    for side, wanted in region.items():
        found[side] = np.array([unit(normals[tree.find(Vector(tuple(point)))[1]])
                                for point in wanted], dtype=np.float64)
    return found


def coverage(region: np.ndarray, normals: np.ndarray, cap_tree: BVHTree, reach: float) -> dict:
    """How much of the deltoid a cap stands over: the rigid answer to `regionEnclosed`.

    A rigid cap encloses nothing - that is the point of it - so the measurement that
    replaces enclosure is whether the muscle's own outward direction runs into the
    plate before it has gone six centimetres.
    """
    hits = 0
    distances = []
    for point, normal in zip(region, normals):
        origin = Vector(blender_from_runtime(point + normal * RAY_NUDGE))
        hit, _, _, distance = cap_tree.ray_cast(origin, Vector(blender_from_runtime(normal)), reach)
        if hit is not None:
            hits += 1
            distances.append(float(distance))
    return {"regionVertices": int(len(region)), "coveredVertices": hits,
            "coveredFraction": round(hits / max(1, len(region)), 6),
            "reachMetres": reach,
            "medianGapMetres": round(float(np.median(distances)), 6) if distances else None}


def fixed_cap_tree(plan: dict) -> tuple[BVHTree, tuple]:
    """The plate alone, where it landed. The cloth on its island covers nothing fixed."""
    points = ring.points_of(plan["cap"])
    fixed = plan["isFixed"]
    faces = [face for face in plan["faces"] if all(fixed[corner] for corner in face)]
    return tree_of_points(points, faces), bounds_of(points[fixed])


def bounds_of(points: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    return points.min(axis=0) - HIDE_REACH, points.max(axis=0) + HIDE_REACH


def under_cap(tree: BVHTree, box: tuple, points: np.ndarray, normals: np.ndarray) -> list[int]:
    """Which vertices of a piece worn beneath the plate stand behind it.

    Two answers, because one alone leaves holes. A vertex whose own outward normal
    runs into the plate within reach is behind it, which is the ordinary case: cloth
    lying under a shoulder. And a vertex inside the plate outright is behind it
    however its normal points, which is the tunic's own shoulder seam, pressed
    against the cap's inner wall with its normal running along the plate rather than
    into it. Parity for the second, not a nearest-face sign: a nearest face reads the
    wrong side inside every concavity, and a cap is one.
    """
    low, high = box
    inside_box = np.all((points >= low) & (points <= high), axis=1)
    found: list[int] = []
    for at in np.flatnonzero(inside_box).tolist():
        origin = Vector(blender_from_runtime(points[at]))
        hit, _, _, _ = tree.ray_cast(origin, Vector(blender_from_runtime(normals[at])), HIDE_REACH)
        if hit is not None or _encloses(tree, origin):
            found.append(at)
    return found


def _encloses(tree: BVHTree, origin: Vector) -> bool:
    """Ray parity against the plate's shell: is this vertex inside the plate?"""
    odd = 0
    for direction in RAY_AXES:
        crossings, at = 0, origin.copy()
        while crossings <= RAY_HIT_LIMIT:
            hit, _, _, _ = tree.ray_cast(at, direction)
            if hit is None:
                break
            crossings += 1
            at = hit + direction * RAY_NUDGE
        if crossings % 2 == 1:
            odd += 1
    return odd >= 2


def piece_vertices(glb_path: str) -> tuple[np.ndarray, np.ndarray]:
    """One fitted piece's positions and normals, in the order the runtime masks by.

    Off the exported file rather than off Blender's mesh, for the reason `regions.py`
    gives: the exporter splits a vertex wherever a normal seam does, so a Blender
    index is not a runtime one and a mask written in Blender indices hides the wrong
    triangles.
    """
    glb = Glb(glb_path)
    nodes = [node for node in glb.json["nodes"] if "mesh" in node]
    if len(nodes) != 1:
        raise SocketError(f"hide gate: {Path(glb_path).name} is {len(nodes)} meshes, expected one")
    attributes = glb.json["meshes"][nodes[0]["mesh"]]["primitives"][0]["attributes"]
    return (glb.accessor(attributes["POSITION"]).astype(np.float64),
            glb.accessor(attributes["NORMAL"]).astype(np.float64))


def hidden_under_caps(root: Path, names: list[str], plans: dict) -> tuple[dict, dict]:
    """The footprint each cap leaves on every piece worn under it, and its counts.

    A pauldron stands off the shoulder, so it hides no skin - but it sits *on* the
    tunic, and the tunic's shoulder drawn through a plate is what "the cloth pokes
    through the armour" looks like from the review camera. Measured here rather than
    at runtime because the answer is a bind-pose fact about two fitted pieces, and
    burial cannot see it: two surfaces six millimetres apart at bind cross at a run.
    """
    hides, counts = {}, {}
    trees = {side: fixed_cap_tree(plan) for side, plan in plans.items() if "faces" in plan}
    for name in names:
        points, normals = piece_vertices(str(root / "public" / "gear" / name / f"{name}.glb"))
        per_side = {side: under_cap(tree, box, points, normals) for side, (tree, box) in trees.items()}
        found = sorted({at for side in per_side.values() for at in side})
        if found:
            hides[name] = found
        counts[name] = {"vertices": int(len(points)), "hidden": len(found),
                        **{side: len(members) for side, members in per_side.items()}}
    return hides, counts


def cap_tree_of(objects: list) -> BVHTree:
    vertices: list[tuple[float, float, float]] = []
    faces: list[tuple[int, int, int]] = []
    for obj in objects:
        base = len(vertices)
        matrix = obj.matrix_world
        vertices.extend(tuple(matrix @ vertex.co) for vertex in obj.data.vertices)
        for face in obj.data.polygons:
            corners = list(face.vertices)
            for at in range(1, len(corners) - 1):
                faces.append((base + corners[0], base + corners[at], base + corners[at + 1]))
    return BVHTree.FromPolygons(vertices, faces, all_triangles=True)


def arm_axis(landmarks: dict, contract: dict, side: str) -> tuple[np.ndarray, np.ndarray]:
    """The upper arm's direction and its head, from the contract's own bone definition.

    Not from the armature: `export.py` neutralises every exported bone's rest
    orientation, so a body GLB comes back with every bone pointing at world up and a
    tail that says nothing about which way a limb runs.
    """
    named = {bone["name"]: bone for bone in contract["bones"]}
    bone = named.get(f"upper_arm_{side}")
    if bone is None:
        raise SocketError(f"socket gate: the contract has no upper_arm_{side}")
    head = np.array(landmarks[bone["head"]], dtype=np.float64)
    tail = np.array(landmarks[bone["tail"]], dtype=np.float64)
    return unit(tail - head), head


def deltoid_width(region: np.ndarray, axis: np.ndarray, anchor: np.ndarray, side: str,
                  surface: geometry.Surface) -> dict:
    """How wide the muscle is along the arm, and the fallback when the region is thin."""
    along = region @ axis
    width = float(along.max() - along.min())
    lateral = np.array([1.0 if side == "L" else -1.0, 0.0, 0.0])
    hit, _, _, distance = surface.every.ray_cast(Vector(blender_from_runtime(anchor)),
                                                Vector(blender_from_runtime(lateral)))
    doubled = float(distance) * 2.0 if hit is not None else None
    measured = {"regionVertices": int(len(region)),
                "regionWidthMetres": round(width, 6),
                "helperToSkinTwiceMetres": None if doubled is None else round(doubled, 6)}
    if len(region) >= MIN_REGION_VERTICES and width >= MIN_REGION_WIDTH:
        return {**measured, "source": "shoulders region", "widthMetres": width}
    if doubled is None:
        raise SocketError("socket gate: the shoulders region is thin and no skin ray hit")
    return {**measured, "source": "shoulder helper to outer skin, doubled", "widthMetres": doubled}


def bridges_chest(points: np.ndarray) -> bool:
    """An island that crosses the midline, or sits on it, bridges the two caps."""
    return bool(points[:, 0].min() < 0.0 < points[:, 0].max()
                or abs(float(points[:, 0].mean())) < STRAP_MIDLINE)


def carry_straps(straps: list[tuple], placement: dict, dressed: geometry.Surface,
                 bare: geometry.Surface) -> dict:
    """Chest straps keep the pose they were drawn in, between the two caps.

    A strap belongs to neither shoulder, so neither shoulder's registration can own
    it; the mean of the two carries it and it stays where the drawing put it relative
    to both. Inside the torso is where a strap that bridges a chest ends up, and it is
    hidden there, so the depth is reported rather than seated.
    """
    if not straps:
        return {"islands": 0,
                "rule": f"no island crosses the midline or centres within {STRAP_MIDLINE} m of it"}
    scale = float(np.mean([placement[side]["scale"] for side in ("L", "R")]))
    mean = np.mean([np.array(placement[side]["rotationMatrix"]) for side in ("L", "R")], axis=0)
    left, _, right = np.linalg.svd(mean)
    rotation = left @ right
    translation = np.mean([np.array(placement[side]["translation"]) for side in ("L", "R")], axis=0)
    apply_similarity([obj for obj, _ in straps], scale, rotation, np.zeros(3), translation)
    points = np.concatenate([ring.points_of(obj) for obj, _ in straps])
    inside, outside = depths(points, dressed), depths(points, bare)
    return {"islands": len(straps), "vertices": int(len(points)),
            "rule": "the mean of both sides' rigid transforms",
            "scale": round(scale, 6), "translation": rounded_list(translation),
            "rotationDegrees": round(axis_angle(rotation)[1], 4),
            "maxDepthDressedMetres": round(float(inside.max(initial=0.0)), 6),
            "deeperThan2mmDressed": int((inside > CLEARANCE_DEPTH).sum()),
            "maxDepthBareMetres": round(float(outside.max(initial=0.0)), 6),
            "deeperThan2mmBare": int((outside > CLEARANCE_DEPTH).sum())}


def island_rows(entries: list[tuple]) -> list[dict]:
    """Every island of a side on one line, where it came from and where it landed."""
    rows = []
    for at, (obj, source) in enumerate(entries):
        placed = ring.points_of(obj)
        rows.append({"island": at, "role": "cap" if at == 0 else "rides the cap",
                     "vertices": int(len(placed)), "triangles": ring.triangles_of(obj),
                     "sourceCentroid": [round(float(value), 6) for value in source.mean(axis=0)],
                     "centroid": [round(float(value), 6) for value in placed.mean(axis=0)]})
    return rows


def plan_side(entries: list[tuple], side: str, contract: dict, landmarks: dict,
              region: np.ndarray, region_normals: np.ndarray, dressed: geometry.Surface,
              bare: geometry.Surface, skin: np.ndarray, clearance: float,
              cap_fraction: float, anchor: str = "crest", seat: str = "p95",
              stage: str = "push", inner: str = "nearest", seeds: str = "grid",
              orient: np.ndarray | None = None,
              offset: np.ndarray | None = None) -> dict:
    """Everything measurable about one shoulder, before a vertex has been moved.

    Split from the commit because the seed the pair wears is a decision about the pair:
    one shoulder cannot know whether its own best pose is the one the other shoulder
    found, and a piece whose sides chose different orientations is not a pair.
    """
    axis_arm, joint = arm_axis(landmarks, contract, side)
    cap, cap_points = entries[0]
    axis, apex, trace = opening_axis(cap_points, -area_normal(cap))

    low, high = float(cap_points[:, 1].min()), float(cap_points[:, 1].max())
    # The cloth hanging off the cap is on the same island as the cap, and it is not
    # the cap: it must set neither the scale nor the clearance, because at runtime it
    # swings on its own chain and the fitter's job stops at the plate.
    is_fixed = cap_points[:, 1] >= low + cap_fraction * (high - low)
    fixed = cap_points[is_fixed]
    if len(fixed) < 8:
        raise SocketError(f"socket gate: the {side} cap has no fixed part above the cloth line")
    span = float((fixed @ axis).max() - (fixed @ axis).min())
    whole = float((cap_points @ axis).max() - (cap_points @ axis).min())

    muscle = deltoid_width(region, axis_arm, joint, side, dressed)
    scale = muscle["widthMetres"] * DELTOID_FACTOR / span

    shared = {"side": side, "anchor": anchor, "armAxis": rounded_list(axis_arm),
              "jointHead": rounded_list(joint),
              "capIsland": {"vertices": int(len(cap_points)), "triangles": ring.triangles_of(cap)},
              "openingAxisSource": rounded_list(axis), "axisTrace": trace,
              "apexSource": rounded_list(apex), "capFraction": cap_fraction,
              "capSpanAlongAxisMetres": round(span, 6),
              "wholeIslandAlongAxisMetres": round(whole, 6),
              "deltoid": muscle, "deltoidFactor": DELTOID_FACTOR, "scale": round(scale, 6),
              "clearanceMetres": clearance, "fixedCapVertices": int(is_fixed.sum())}
    plan = {"side": side, "entries": entries, "anchor": anchor, "seat": seat, "stage": stage,
            "cap": cap, "capPoints": cap_points, "isFixed": is_fixed, "axis": axis,
            "apex": apex, "scale": scale, "armAxis": axis_arm, "joint": joint,
            "region": region, "regionNormals": region_normals, "dressed": dressed,
            "bare": bare, "clearance": clearance, "shared": shared, "seeds": seeds,
            "orient": orient, "offset": offset}
    if anchor != "crest":
        # The first rule is one pose by construction: it turns the cap onto the arm.
        plan["trials"] = [{"label": "y0p0", "yawDegrees": 0.0, "pitchDegrees": 0.0,
                           "rotation": np.eye(3), "score": 0.0}]
        return plan

    normals = normals_of(cap)
    is_inner, inner_rule = inner_face(cap_points, normals, axis, apex, inner)
    # The plate registers; the cloth on the same island hangs off it and would drag
    # the plate down the arm if it were allowed a say in where the plate goes.
    is_inner = is_inner & is_fixed
    if int(is_inner.sum()) < MIN_INNER_VERTICES:
        raise SocketError(f"socket gate: the {side} cap has no inner face to register")
    plan["isInner"], plan["innerRule"] = is_inner, inner_rule
    plan["normals"] = normals
    plan["crestBody"] = crest_of(skin, joint, CREST_RADIUS)
    plan["faces"] = faces_of(cap)
    # A declared pose is not a searched one: the seeds exist to guess an orientation,
    # and once one is written down there is nothing left for them to choose between.
    plan["trials"] = [{**seed, **_crest_trial(plan, seed["rotation"])}
                      for seed in seed_grid(side, axis_arm,
                                            "none" if orient is not None else seeds)]
    return plan


def rounded_list(values) -> list[float]:
    return [round(float(value), 6) for value in values]


def _crest_trial(plan: dict, seed: np.ndarray) -> dict:
    """One seed all the way through: crest anchor, ICP, push out, and what it scored.

    Nothing here touches the scene. A trial is the transform it would apply and the
    numbers that transform earns, so twelve of them cost twelve registrations rather
    than twelve rounds of moving a mesh and putting it back.
    """
    cap_points, is_inner, scale = plan["capPoints"], plan["isInner"], plan["scale"]
    clearance, dressed = plan["clearance"], plan["dressed"]
    wall = (cap_points @ seed.T)[is_inner] * scale
    crest_source = wall[int(np.argmax(wall[:, 1]))]
    crest_at = plan["crestBody"] + np.array([0.0, clearance, 0.0])
    seated = crest_at - crest_source
    if plan["orient"] is not None:
        registered = _declare(plan, wall + seated, crest_at)
    elif plan["stage"] in ("icp", "push"):
        registered = register(wall + seated, (plan["normals"] @ seed.T)[is_inner],
                              dressed.every, clearance)
    else:
        registered = {"rotation": np.eye(3), "translation": np.zeros(3), "placed": wall + seated,
                      "iterations": 0, "bounded": False, "trace": [], "axis": [0.0, 1.0, 0.0],
                      "degrees": 0.0, "residualMeanMillimetres": None,
                      "residualP95Millimetres": None}
    rotation, shift = registered["rotation"], registered["translation"]
    lifted, passes = (push_out(registered["placed"], dressed.every, dressed)
                      if plan["stage"] == "push" else (np.zeros(3), []))
    trial = {"registered": registered, "pushSteps": passes, "lifted": lifted,
             "seated": seated, "crestSource": crest_source,
             "total": rotation @ seed, "translation": rotation @ seated + shift + lifted}
    return {**trial, **_score_trial(plan, trial)}


def _score_trial(plan: dict, trial: dict) -> dict:
    """What a seed earned: how well it registered, what it buried, what it covers.

    Measured where the trial would leave the cap, on the cap alone, and against the
    bare body rather than the dressed one - a plate inside the tunic is a plate inside
    the shoulder, and the tunic is not what holds it off the skin.
    """
    placed = plan["capPoints"] @ (plan["scale"] * trial["total"]).T + trial["translation"]
    gaps = np.array([nearest_surface(plan["dressed"].every, point)[2]
                     for point in placed[plan["isInner"]]])
    residual = np.abs(gaps - plan["clearance"])
    buried = depths(placed[plan["isFixed"]], plan["bare"])
    deeper = int((buried > CLEARANCE_DEPTH).sum())
    inside = 100.0 * deeper / max(1, int(plan["isFixed"].sum()))
    covered = coverage(plan["region"], plan["regionNormals"],
                       tree_of_points(placed, plan["faces"]), COVERAGE_REACH)
    score = (float(residual.mean()) * 1000.0 + inside * SCORE_PENETRATION_PER_PERCENT
             - covered["coveredFraction"] * 100.0 * SCORE_COVERAGE_PER_PERCENT)
    return {
        "iterations": trial["registered"]["iterations"],
        "icpBounded": trial["registered"]["bounded"],
        "icpDegrees": trial["registered"]["degrees"],
        "pushMetres": round(float(np.linalg.norm(trial["lifted"])), 6),
        "residualMeanMillimetres": round(float(residual.mean()) * 1000.0, 4),
        "residualP95Millimetres": round(float(np.percentile(residual, 95.0)) * 1000.0, 4),
        "fixedCapDeeperThan2mmBare": deeper,
        "fixedCapMaxDepthBareMetres": round(float(buried.max(initial=0.0)), 6),
        "fixedCapInsidePercent": round(inside, 4),
        "coveredFraction": covered["coveredFraction"],
        "coveragePercent": round(covered["coveredFraction"] * 100.0, 4),
        "score": round(score, 4),
    }


def choose_seed(plans: dict) -> dict:
    """The one seed the pair wears, and whether the two shoulders asked for it.

    Each side is scored on its own, and the sides are named so that agreeing on a name
    is agreeing on a mirrored pose. When they disagree the better score wins the pair,
    because a pauldron that faces one way on the left and another on the right is a
    bug the eye finds before the numbers do.
    """
    best = {side: min(plan["trials"], key=lambda row: row["score"]) for side, plan in plans.items()}
    agreed = len({row["label"] for row in best.values()}) == 1
    winner = min(best, key=lambda side: best[side]["score"])
    # What the same seed cost both shoulders together, reported and not obeyed: the rule
    # is the better single score, and the pair sum is how far that rule reached.
    pair = {label: round(sum(scores), 4) for label, scores in _pair_scores(plans).items()}
    return {"chosen": best[winner]["label"], "sidesAgreed": agreed,
            "bestPerSide": {side: row["label"] for side, row in best.items()},
            "bestScorePerSide": {side: row["score"] for side, row in best.items()},
            "decidedBy": "both sides" if agreed else f"the better score, on {winner}",
            "bestPairSeed": min(pair, key=pair.get), "pairScores": pair}


def _pair_scores(plans: dict) -> dict:
    scores: dict[str, list[float]] = {}
    for plan in plans.values():
        for row in plan["trials"]:
            scores.setdefault(row["label"], []).append(row["score"])
    return scores


def orientation_of(plan: dict, placed: np.ndarray) -> dict:
    """Where the cap opens and where its cloth hangs, in body axes rather than a picture.

    The opening is the direction from the cap's own inner apex to the middle of its
    inner face: the way a hollow shell looks. The drape is the cloth's centroid against
    the plate's. Both are said in the body's own axes so the pose can be read without
    the render, and so a wrong one is a number rather than an argument.
    """
    lateral = np.array([1.0 if plan["side"] == "L" else -1.0, 0.0, 0.0])
    apex = plan["scale"] * plan["chosen"]["total"] @ plan["apex"] + plan["chosen"]["translation"]
    opening = unit(placed[plan["isInner"]].mean(axis=0) - apex)
    skirt = placed[~plan["isFixed"]]
    hang = (skirt.mean(axis=0) - placed[plan["isFixed"]].mean(axis=0)
            if len(skirt) else np.zeros(3))
    return {
        "openingApex": rounded_list(apex),
        "opening": rounded_list(opening),
        "openingDownTheArm": round(float(opening @ plan["armAxis"]), 4),
        "openingForward": round(float(opening @ FORWARD), 4),
        "openingOutward": round(float(opening @ lateral), 4),
        "openingUp": round(float(opening @ UP), 4),
        "openingFaces": _facing_words(opening, plan["armAxis"], lateral),
        "drapeVertices": int(len(skirt)),
        "drapeFromCapCentimetres": [round(float(value) * 100.0, 2) for value in hang],
        "drapeBehindCentimetres": round(float(-hang @ FORWARD) * 100.0, 2),
        "drapeOutwardCentimetres": round(float(hang @ lateral) * 100.0, 2),
        "drapeBelowCentimetres": round(float(-hang @ UP) * 100.0, 2),
    }


def _facing_words(direction: np.ndarray, axis_arm: np.ndarray, lateral: np.ndarray) -> str:
    """The three body components of a direction, largest first, as words."""
    named = [("down the arm", float(direction @ axis_arm)), ("up", float(direction @ UP)),
             ("forward", float(direction @ FORWARD)), ("outward", float(direction @ lateral))]
    ordered = sorted(named, key=lambda pair: -abs(pair[1]))[:2]
    return ", ".join(f"{'' if value >= 0 else 'anti-'}{name} {abs(value):.2f}"
                     for name, value in ordered)


def commit_side(plan: dict, label: str) -> dict:
    """Move the side onto the seed the pair chose, and report where it landed."""
    if plan["anchor"] != "crest":
        return {**plan["shared"],
                **_deltoid_side(plan["entries"], plan["side"], plan["cap"], plan["capPoints"],
                                plan["isFixed"], plan["axis"], plan["apex"], plan["scale"],
                                plan["armAxis"], plan["joint"], plan["region"], plan["dressed"],
                                plan["clearance"], plan["seat"], plan["anchor"])}
    chosen = next(row for row in plan["trials"] if row["label"] == label)
    plan["chosen"] = chosen
    scale, entries = plan["scale"], plan["entries"]
    registered, lifted = chosen["registered"], chosen["lifted"]
    apply_similarity([obj for obj, _ in entries], scale, chosen["total"], np.zeros(3),
                     chosen["translation"])
    placed = ring.points_of(plan["cap"])
    settled = depths(placed[plan["isFixed"]], plan["dressed"])
    return {
        **plan["shared"],
        "rule": ("crest anchor and the authored orientation" if plan["orient"] is not None
                 else "multi-start seeds, crest and rigid ICP"),
        "stage": plan["stage"],
        "authored": _authored_report(plan),
        "innerFace": {"vertices": int(plan["isInner"].sum()), "rule": plan["innerRule"],
                      "ofCapVertices": int(len(plan["capPoints"]))},
        "seedRule": ("the source's own orientation, then the authored turn"
                     if plan["orient"] is not None
                     else f"yaw {list(SEED_YAW_DEGREES)} by pitch {list(SEED_PITCH_DEGREES)}"
                     if plan["seeds"] == "grid" else "the source's own orientation only"),
        "seedChosen": label,
        "seedYawDegrees": chosen["yawDegrees"],
        "seedPitchDegrees": chosen["pitchDegrees"],
        "seedPitchAxis": chosen.get("pitchAxis"),
        "seedRotationMatrix": [rounded_list(row) for row in chosen["rotation"]],
        "seedScore": chosen["score"],
        "seedTable": [_seed_row(row) for row in plan["trials"]],
        "crestSource": rounded_list(chosen["rotation"].T @ (chosen["crestSource"] / scale)),
        "crestSourceSeeded": rounded_list(chosen["crestSource"] / scale),
        "crestSourceScaled": rounded_list(chosen["crestSource"]),
        "crestBody": rounded_list(plan["crestBody"]),
        "crestRadiusMetres": CREST_RADIUS,
        "initialTranslation": rounded_list(chosen["seated"]),
        "icpIterations": registered["iterations"],
        "icpBounded": registered["bounded"],
        "icpMaxDegrees": ICP_MAX_DEGREES,
        "icpTrace": registered["trace"],
        "icpRotationAxis": registered["axis"],
        "icpRotationDegrees": registered["degrees"],
        "rotationAxis": rounded_list(axis_angle(chosen["total"])[0]),
        "rotationDegrees": round(axis_angle(chosen["total"])[1], 4),
        "rotationMatrix": [rounded_list(row) for row in chosen["total"]],
        "residualMeanMillimetres": chosen["residualMeanMillimetres"],
        "residualP95Millimetres": chosen["residualP95Millimetres"],
        "pushPasses": len(chosen["pushSteps"]),
        "pushSteps": chosen["pushSteps"],
        "pushMetres": round(float(np.linalg.norm(lifted)), 6),
        "pushBounded": float(np.linalg.norm(lifted)) >= PUSH_LIMIT - 1e-9,
        "translation": rounded_list(chosen["translation"]),
        "crestPlaced": rounded_list(
            registered["rotation"] @ (chosen["crestSource"] + chosen["seated"])
            + registered["translation"] + lifted),
        "orientation": orientation_of(plan, placed),
        "fixedCapDepthAfterMetres": round(float(settled.max(initial=0.0)), 6),
        "fixedCapDeeperThan2mm": int((settled > CLEARANCE_DEPTH).sum()),
        "fixedCapDeeperThan2mmBare": chosen["fixedCapDeeperThan2mmBare"],
    }


def _authored_report(plan: dict) -> dict | None:
    """What the flags asked for, what this side actually took, and where it turned."""
    if plan["orient"] is None:
        return None
    orient, offset = plan["orient"], plan["offset"]
    applied_orient = orient * np.array([hand_of(plan["side"]), 1.0, hand_of(plan["side"])])
    return {
        "flags": flag_string(orient, offset, "" if plan["side"] == "L" else "-right"),
        "yawDegrees": float(orient[0]), "pitchDegrees": float(orient[1]),
        "rollDegrees": float(orient[2]),
        "offsetMetres": rounded_list(offset),
        "appliedYawDegrees": float(applied_orient[0]),
        "appliedPitchDegrees": float(applied_orient[1]),
        "appliedRollDegrees": float(applied_orient[2]),
        "appliedOffsetMetres": rounded_list(declared_offset(offset, plan["side"])),
        "order": "yaw about up, then pitch about across, then roll about forward",
        "pivot": rounded_list(plan["crestBody"] + np.array([0.0, plan["clearance"], 0.0])),
        "mirrored": plan["side"] == "R",
    }


def flag_string(orient: np.ndarray, offset: np.ndarray, suffix: str = "") -> str:
    """The two flags that reproduce this placement, spelled the way they are typed."""
    return (f"--orient{suffix} {_short(orient[0])}:{_short(orient[1])}:{_short(orient[2])}"
            f" --offset{suffix} {_short(offset[0], 4)}:{_short(offset[1], 4)}:{_short(offset[2], 4)}")


def authored_poses(args) -> dict | None:
    """The pose each shoulder was authored at, or nothing when none was.

    The right shoulder wears the mirror of the left unless it is given its own
    numbers. Two halves of one Tripo mesh are not exact mirrors of each other, and
    the pose the eye accepted on this pair sits eleven degrees apart between them, so
    a pair is allowed to be two poses - said in the same authored convention, so the
    right's numbers still mean "and mirrored" rather than "in the other frame".
    """
    stated = {name: triple(getattr(args, name.replace("-", "_")), name)
              for name in ("orient", "offset", "orient-right", "offset-right")
              if getattr(args, name.replace("-", "_"))}
    if not stated:
        return None
    left = {"orient": stated.get("orient", np.zeros(3)), "offset": stated.get("offset", np.zeros(3))}
    return {"L": left,
            "R": {"orient": stated.get("orient-right", left["orient"]),
                  "offset": stated.get("offset-right", left["offset"])}}


def pair_flags(authored: dict) -> str:
    """Every flag the pair took: one pose when the sides share it, two when they do not."""
    left = flag_string(authored["L"]["orient"], authored["L"]["offset"])
    if all(np.array_equal(authored["L"][name], authored["R"][name]) for name in ("orient", "offset")):
        return left
    return f"{left} {flag_string(authored['R']['orient'], authored['R']['offset'], '-right')}"


def _short(value: float, places: int = 2) -> str:
    return f"{float(value):.{places}f}".rstrip("0").rstrip(".") or "0"


SEED_COLUMNS = ("label", "iterations", "icpDegrees", "icpBounded", "pushMetres",
                "residualMeanMillimetres", "residualP95Millimetres",
                "fixedCapDeeperThan2mmBare", "fixedCapMaxDepthBareMetres",
                "fixedCapInsidePercent", "coveragePercent", "score")


def _seed_row(trial: dict) -> dict:
    return {name: trial[name] for name in SEED_COLUMNS}


def _deltoid_side(entries: list[tuple], side: str, cap, cap_points: np.ndarray,
                  is_fixed: np.ndarray, axis: np.ndarray, apex: np.ndarray, scale: float,
                  axis_arm: np.ndarray, joint: np.ndarray, region: np.ndarray,
                  dressed: geometry.Surface, clearance: float, seat: str,
                  anchor: str) -> dict:
    """The first rule, kept for the comparison: stand the cap on the arm's own axis."""
    fixed = cap_points[is_fixed]
    wanted = tilt_degrees(axis, axis_arm)
    tilt = max(-MAX_TILT_DEGREES, min(MAX_TILT_DEGREES, wanted))
    rotation = spin_z(tilt)
    placed_axis = unit(rotation @ axis)
    lateral = np.array([1.0 if side == "L" else -1.0, 0.0, 0.0])

    # Two anchors, one used. `apex` is the rule as drawn: the cap's inner apex on the
    # skin a ray from the joint leaves by. On this body that ray runs up the arm axis,
    # which is 22 degrees inboard of vertical, so it leaves through the trapezius 6 cm
    # from the joint and lands the cap on the neck. `deltoid` puts the fixed cap over
    # the muscle it armours and lets the lateral seat below find the standoff.
    ray = outer_hit(dressed.every, joint, -placed_axis)
    apex_anchor = {"pivot": apex, "destination": ray["point"] - placed_axis * clearance}
    muscle_centre = region.mean(axis=0)
    deltoid_anchor = {"pivot": fixed.mean(axis=0), "destination": muscle_centre}
    chosen = apex_anchor if anchor == "apex" else deltoid_anchor
    apex_before = apex.copy()
    apply_similarity([obj for obj, _ in entries], scale, rotation, chosen["pivot"],
                     chosen["destination"])
    placed_apex = chosen["destination"] + scale * rotation @ (apex_before - chosen["pivot"])
    # The seat runs sideways, never along the cap's axis. Pushing a cap up its own axis
    # slides it along the shoulder it is stuck in rather than off it: the first run of
    # this rule went 2.1 cm, 7.8 cm, 3.0 cm, 3.3 cm deep and never converged, and by
    # then the cap was on the neck. Sideways is the way out of a shoulder.
    outward = lateral

    def measure() -> np.ndarray:
        return depths(ring.points_of(cap)[is_fixed], dressed)

    # What the seat is asked to clear. The whole cap cannot be: its inboard wall wraps
    # the side of the arm the chest is against, so a rigid cap has vertices inside the
    # torso at every offset and a "nothing deeper than 2 mm" seat chases them off the
    # shoulder. The percentile is the same compromise the old layer seat made with its
    # band, said out loud.
    def worst(values: np.ndarray) -> float:
        return float(values.max(initial=0.0)) if seat == "clear" else float(
            np.percentile(values, SEAT_PERCENTILE))

    buried = measure()
    first = float(buried.max(initial=0.0))
    passes = []
    moved = np.zeros(3)
    while (seat != "none" and len(passes) < CLEARANCE_PASSES and worst(buried) > CLEARANCE_DEPTH
           and float(np.linalg.norm(moved)) < MAX_CLEARANCE):
        push = min(worst(buried) + CLEARANCE_MARGIN, MAX_CLEARANCE - float(np.linalg.norm(moved)))
        slide([obj for obj, _ in entries], outward * push)
        moved = moved + outward * push
        buried = measure()
        passes.append({"pushMetres": round(push, 6),
                       "maxDepthAfterMetres": round(float(buried.max(initial=0.0)), 6),
                       "seatDepthAfterMetres": round(worst(buried), 6)})

    apex_now = placed_apex + moved
    return {
        "rule": "arm axis tilt and deltoid centroid",
        "seat": seat,
        "openingAxisPlaced": rounded_list(placed_axis),
        "axisToArmDegrees": round(float(np.degrees(np.arccos(np.clip(axis @ axis_arm, -1.0, 1.0)))), 4),
        "placedAxisToArmDegrees": round(
            float(np.degrees(np.arccos(np.clip(placed_axis @ axis_arm, -1.0, 1.0)))), 4),
        "tiltDegrees": round(tilt, 4),
        "tiltWantedDegrees": round(wanted, 4),
        "tiltClamped": abs(wanted) > MAX_TILT_DEGREES,
        "rotationMatrix": [rounded_list(row) for row in rotation],
        "jointRay": {"direction": rounded_list(-placed_axis),
                     "crossings": ray["crossings"], "firstHitMetres": ray["firstMetres"],
                     "outerHitMetres": ray["lastMetres"],
                     "outerHit": rounded_list(ray["point"])},
        "apexAnchorDestination": rounded_list(apex_anchor["destination"]),
        "deltoidCentroid": rounded_list(muscle_centre),
        "fixedCapCentroidSource": rounded_list(deltoid_anchor["pivot"]),
        "clearanceDirection": rounded_list(outward),
        "translation": rounded_list(chosen["destination"] - scale * rotation @ chosen["pivot"] + moved),
        "apexPlaced": rounded_list(apex_now),
        "clearancePasses": len(passes),
        "clearanceSteps": passes,
        "clearanceTranslationMetres": round(float(np.linalg.norm(moved)), 6),
        "clearanceBounded": float(np.linalg.norm(moved)) >= MAX_CLEARANCE - 1e-9,
        "fixedCapDepthBeforeMetres": round(first, 6),
        "fixedCapDepthAfterMetres": round(float(buried.max(initial=0.0)), 6),
        "fixedCapDeeperThan2mm": int((buried > CLEARANCE_DEPTH).sum()),
        "fixedCapSeatDepthMetres": round(worst(buried), 6),
        "seatPercentile": SEAT_PERCENTILE,
    }


def print_seed_tables(plans: dict, choice: dict) -> None:
    """Every seed on one line per side, because the losers are the evidence."""
    header = ("seed      iters  icpDeg  push_mm  res_mean  res_p95  inside  maxDepth_mm"
              "  inside%  cover%   score")
    for side in ("L", "R"):
        rows = sorted(plans[side]["trials"], key=lambda row: row["score"])
        print(f"SEEDS {side} best={choice['bestPerSide'][side]} chosen={choice['chosen']}")
        print(header)
        for row in rows:
            print(f"{row['label']:<9} {row['iterations']:>5}  {row['icpDegrees']:>6.2f}"
                  f"  {row['pushMetres'] * 1000:>7.1f}  {row['residualMeanMillimetres']:>8.2f}"
                  f"  {row['residualP95Millimetres']:>7.2f}"
                  f"  {row['fixedCapDeeperThan2mmBare']:>6}"
                  f"  {row['fixedCapMaxDepthBareMetres'] * 1000:>11.1f}"
                  f"  {row['fixedCapInsidePercent']:>7.2f}  {row['coveragePercent']:>6.2f}"
                  f"  {row['score']:>7.2f}")
    print("SEEDCHOICE " + json.dumps(choice, separators=(",", ":")))


def run(args) -> dict:
    contract = json.loads(CONTRACT_PATH.read_text())
    if args.slot not in contract["slots"]:
        raise SocketError(f"slot gate: unknown slot \"{args.slot}\"")
    slot = contract["slots"][args.slot]
    if not slot["pair"]:
        raise SocketError(f"socket gate: {args.slot} is not a paired slot")
    clearance = float(slot["clearance"])
    drape_specs = [drape.parse(spec) for spec in (args.drape or [])]
    for spec in drape_specs:
        for side in ("L", "R"):
            bone = drape.sided(spec, side)["attachBone"]
            if bone not in slot["weights"]["allowedBones"]:
                raise SocketError(f"drape gate: {bone} is not a bone the {args.slot} slot weights to")

    authored = authored_poses(args)
    if authored is not None and args.anchor != "crest":
        raise SocketError("orient gate: an authored pose turns about the crest anchor")

    loaded = body.load(ROOT, args.body)
    landmarks = loaded["manifest"]["landmarks"]
    worn_under = [name.strip() for name in (args.under or "").split(",") if name.strip()]
    beneath = piece.under(ROOT, worn_under)
    dressed_target = body.joined_target(loaded, beneath)
    dressed = geometry.Surface(loaded["meshes"] + beneath)
    bare = geometry.Surface(loaded["meshes"])
    region = body.region(loaded, [args.slot], True)
    normals = region_normals(loaded, region)

    objects, source_had = piece.import_file(args.input)
    islands = normalise._split_islands(objects)
    raw = {"islands": len(islands), "triangles": sum(ring.triangles_of(obj) for obj in islands),
           "vertices": sum(len(obj.data.vertices) for obj in islands)}

    skin = skin_points(loaded["meshes"] + beneath)
    sided: dict[str, list[tuple]] = {"L": [], "R": []}
    straps: list[tuple] = []
    for obj in islands:
        points = ring.points_of(obj)
        if bridges_chest(points):
            straps.append((obj, points))
            continue
        sided["L" if float(points.mean(axis=0)[0]) >= 0.0 else "R"].append((obj, points))
    for side, entries in sided.items():
        if not entries:
            raise SocketError(f"pair gate: no island on side {side}")
        # The cap is the largest island; the rest of the side is hardware or cloth.
        entries.sort(key=lambda entry: (-len(entry[1]), entry[0].name))

    plans = {side: plan_side(entries, side, contract, landmarks, region[side], normals[side],
                             dressed, bare, skin, clearance, args.cap, args.anchor, args.seat,
                             args.register, args.inner, args.seeds,
                             None if authored is None else authored[side]["orient"],
                             None if authored is None else authored[side]["offset"])
             for side, entries in sided.items()}
    choice = choose_seed(plans)
    print_seed_tables(plans, choice)

    placement = {}
    for side, entries in sided.items():
        placement[side] = commit_side(plans[side], choice["chosen"])
        placement[side]["seedChoice"] = choice
        placement[side]["islands"] = island_rows(entries)
        # Measured before the join, which is what makes the cap indistinguishable from
        # the hardware and the cloth welded to it. Nothing below moves a vertex again.
        cap = entries[0][0]
        cap_points = ring.points_of(cap)
        cap_dressed = depths(cap_points, dressed)
        cap_bare = depths(cap_points, bare)
        landed = np.array(placement[side].get("crestPlaced") or placement[side]["apexPlaced"])
        placement[side]["capClearance"] = {
            "vertices": int(len(cap_points)),
            "maxDepthDressedMetres": round(float(cap_dressed.max(initial=0.0)), 6),
            "deeperThan2mmDressed": int((cap_dressed > CLEARANCE_DEPTH).sum()),
            "maxDepthBareMetres": round(float(cap_bare.max(initial=0.0)), 6),
            "deeperThan2mmBare": int((cap_bare > CLEARANCE_DEPTH).sum()),
            "anchorToTargetMillimetres": round(
                float(np.linalg.norm(dressed.nearest(landed) - landed)) * 1000.0, 3),
            "anchorToBareMillimetres": round(
                float(np.linalg.norm(bare.nearest(landed) - landed)) * 1000.0, 3),
        }
        placement[side]["coverage"] = coverage(region[side], normals[side], cap_tree_of([cap]),
                                               COVERAGE_REACH)

    # Before the join, while the plate is still its own island and the cloth on it
    # still separable: what the caps stand in front of on everything worn beneath.
    hides_under, hides_report = hidden_under_caps(ROOT, worn_under, plans)

    strap_report = carry_straps(straps, placement, dressed, bare)
    if straps:
        sided["L"].extend(straps)
    per_side = [piece.join([obj for obj, _ in sided[side]], f"{args.piece}_{side}")
                for side in ("L", "R")]

    mode = args.weights or slot["weights"]["mode"]
    weight_report = weights.apply(per_side, dressed_target, loaded["armature"], slot, mode, True)

    drapes, drape_report = [], []
    collider_proxies = drape.collider_proxies(loaded["meshes"], loaded["armature"]) if drape_specs else []
    body_anchors = drape.body_anchors(loaded["meshes"]) if drape_specs else None
    for at, obj in enumerate(per_side):
        side_drapes = []
        specs = [drape.sided(spec, ("L", "R")[at]) for spec in drape_specs]
        bands = drape.partition_bands(obj, specs, loaded["armature"])
        for spec, selected in sorted(zip(specs, bands), key=lambda item: -(item[0]["to"] - item[0]["from"])):
            block, measured = drape.build(obj, spec, loaded["armature"], dressed,
                                          None if len(specs) == 1 else selected)
            block["colliders"] = collider_proxies
            drapes.append(block)
            side_drapes.append(block)
            drape_report.append(measured)
        if drape_specs:
            drape.tidy(obj)
            chains = [block["bones"] for block in side_drapes]
            for owner, block in enumerate(side_drapes):
                block["supports"] = drape.require_surface_supports(
                    block["name"], drape.surface_supports(
                        obj, block["bones"], body_anchors,
                        None if len(chains) == 1 else chains, owner))

    fitted = piece.join(per_side, args.piece)

    out = Path(args.outdir)
    out.mkdir(parents=True, exist_ok=True)
    glb_path = str(out / f"{args.piece}.glb")
    exporter.write_glb(glb_path, {args.piece: fitted}, loaded["armature"])
    if drapes:
        drape.order_joints(glb_path, loaded["manifest"]["bones"],
                           [name for block in drapes for name in block["bones"]])
    rest = exporter.finish(glb_path)

    after = ring.points_of(fitted)
    dressed_depths = depths(after, dressed)
    bare_depths = depths(after, bare)
    outside = {"insideVertices": int((dressed_depths > 0).sum()),
               "maxPenetrationMetres": round(float(dressed_depths.max(initial=0.0)), 9),
               "deeperThan2mm": int((dressed_depths > CLEARANCE_DEPTH).sum())}
    bare_outside = {"insideVertices": int((bare_depths > 0).sum()),
                    "maxPenetrationMetres": round(float(bare_depths.max(initial=0.0)), 9),
                    "deeperThan2mm": int((bare_depths > CLEARANCE_DEPTH).sum())}

    measured = gate.measure(glb_path, str(loaded["path"]), contract, source_had, outside)
    gates_table = gate.gates(measured, slot, None, drapes)
    # The crest is where the piece was turned about, and the pose is what it was turned
    # by: together they let a further turn - the review page's sliders, or the next
    # author - be stated in the same numbers this run took rather than as a delta.
    alignment = {side: {"scale": placement[side]["scale"], "yawDegrees": args.yaw,
                        "translation": placement[side]["translation"],
                        **({"crest": placement[side]["crestPlaced"]}
                           if "crestPlaced" in placement[side] else {}),
                        **({} if authored is None
                           else {"orient": rounded_list(authored[side]["orient"]),
                                 "offset": rounded_list(authored[side]["offset"])})}
                 for side in ("L", "R")}
    manifest = {
        "schema": "ashveil.gear-manifest.v1",
        "family": contract["family"],
        "contractVersion": contract["version"],
        "body": args.body,
        "slot": args.slot,
        "piece": args.piece,
        "source": {"file": Path(args.input).name, "sha256": exporter.sha256_file(args.input)},
        "bones": _bone_names(glb_path),
        "inverseBindSha256": _inverse_bind_sha(glb_path),
        "covers": [args.slot],
        "under": worn_under,
        # Named vertices where the caps were measured against what they are worn over,
        # and the plain "hides whatever is buried in it" where they were not.
        "hidesPieces": hides_under or bool(slot.get("hidesPieces", True)),
        # A cap standing 16 mm off the shoulder hides nothing: the skin under it is
        # skin the camera can still see past the plate's edge.
        "hides": {},
        "weights": mode,
        "alignment": alignment,
        "budget": {"triangles": measured["triangles"], "materials": measured["materials"],
                   "meshes": measured["meshes"],
                   "maxInfluencesPerVertex": measured["maxInfluencesPerVertex"]},
        "gates": gates_table,
        "reportFile": f"{args.piece}.report.json",
    }
    if drapes:
        manifest["drapes"] = drapes
    report = {
        "schema": "ashveil.gear-report.v1",
        "rule": "socket",
        "family": contract["family"],
        "contractVersion": contract["version"],
        "body": args.body,
        "slot": args.slot,
        "piece": args.piece,
        "under": worn_under,
        "source": manifest["source"],
        "raw": raw,
        "authored": None if authored is None else {
            "flags": pair_flags(authored),
            "orientDegrees": rounded_list(authored["L"]["orient"]),
            "offsetMetres": rounded_list(authored["L"]["offset"]),
            "orientRightDegrees": rounded_list(authored["R"]["orient"]),
            "offsetRightMetres": rounded_list(authored["R"]["offset"]),
            "perSide": {side: placement[side]["authored"] for side in ("L", "R")},
        },
        "seeds": {"mode": args.seeds, "yawDegrees": list(SEED_YAW_DEGREES),
                  "pitchDegrees": list(SEED_PITCH_DEGREES),
                  "scoreRule": ("mean inner-face residual in millimetres"
                                f" + {SCORE_PENETRATION_PER_PERCENT} per percent of the fixed cap"
                                f" deeper than {CLEARANCE_DEPTH * 1000:.0f} mm in the bare body"
                                f" - {SCORE_COVERAGE_PER_PERCENT} per percent of deltoid covered"),
                  **choice,
                  "table": {side: [_seed_row(row) for row in plans[side]["trials"]]
                            for side in ("L", "R")}},
        "placement": placement,
        "hidesPieces": {"reachMetres": HIDE_REACH, "pieces": hides_report},
        "chestStraps": strap_report,
        "weights": weight_report,
        "drapes": drape_report,
        "rest": rest,
        "bindClearance": outside,
        "bareBodyClearance": bare_outside,
        "runtime": measured,
        "gates": gates_table,
        "gatesPass": all(gates_table.values()),
        "outputs": {"glb": f"{args.piece}.glb", "manifest": f"{args.piece}.manifest.json",
                    "report": f"{args.piece}.report.json",
                    "sha256": exporter.sha256_file(glb_path)},
    }
    if not report["gatesPass"]:
        report["gatesFailed"] = sorted(name for name, passed in gates_table.items() if not passed)
    exporter.write_json(str(out / f"{args.piece}.manifest.json"), manifest)
    exporter.write_json(str(out / f"{args.piece}.report.json"), report)
    return report


def _bone_names(glb_path: str) -> list[str]:
    glb = Glb(glb_path)
    return [glb.json["nodes"][node]["name"] for node in glb.json["skins"][0]["joints"]]


def _inverse_bind_sha(glb_path: str) -> str:
    glb = Glb(glb_path)
    return exporter.sha256_array(glb.accessor(glb.json["skins"][0]["inverseBindMatrices"]))


def parse(argv: list[str]):
    parser = argparse.ArgumentParser(prog="art:socket")
    parser.add_argument("--input", required=True)
    parser.add_argument("--slot", default="shoulders")
    parser.add_argument("--body", required=True)
    parser.add_argument("--piece", required=True)
    parser.add_argument("--under", default="")
    parser.add_argument("--weights", choices=("transfer", "stiff", "rigid"), default="stiff")
    parser.add_argument("--yaw", type=int, choices=(0, 180), default=0)
    parser.add_argument("--cap", type=float, default=CAP_FRACTION)
    parser.add_argument("--anchor", choices=("crest", "deltoid", "apex"), default="crest")
    parser.add_argument("--seat", choices=("none", "clear", "p95"), default="p95")
    parser.add_argument("--register", choices=("crest", "icp", "push"), default="push")
    parser.add_argument("--inner", choices=("normals", "nearest"), default="nearest")
    parser.add_argument("--seeds", choices=("grid", "none"), default="grid")
    parser.add_argument("--orient", default="")
    parser.add_argument("--offset", default="")
    parser.add_argument("--orient-right", default="")
    parser.add_argument("--offset-right", default="")
    parser.add_argument("--drape", action="append", default=[])
    parser.add_argument("--outdir", required=True)
    return parser.parse_args(argv)


def main() -> int:
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else sys.argv[1:]
    args = parse(argv)
    try:
        report = run(args)
    except Exception as error:  # noqa: BLE001 - Blender's exit status is the wrapper contract.
        traceback.print_exc()
        print(f"SOCKET FIT FAILED: {error}", file=sys.stderr)
        return 1
    print(json.dumps({"piece": report["piece"], "gatesPass": report["gatesPass"],
                      "gates": report["gates"], "outputs": report["outputs"]}, separators=(",", ":")))
    return 0


if __name__ == "__main__":
    sys.exit(main())
