"""Socket placement: a shoulder cap is a rigid part hung on one joint.

A pauldron is not a garment. It is a plate that sits over the deltoid, held by one
joint, with hardware bolted through it and cloth hanging off it. The body has an
opinion about where it goes - the joint's own axis and the width of the muscle under
it - and no opinion at all about its shape. So nothing here deforms a vertex.

The whole rule, per side: the largest island is the cap, everything else on that side
rides it. The cap's own axis is measured (the apex of its dome through its centroid),
turned to the upper arm's axis, scaled so the cap spans the deltoid, and translated so
its inner apex lands on the shoulder's skin plus the slot's clearance. One similarity
transform, applied to every island of that side alike. If the cap still sits inside
the body afterwards, the whole side slides straight back out along that same axis.

This is `ring.py`'s rule with the loop's cross section replaced by a joint's axis, and
it exists because the alignment the shipped pauldrons went through put 61% and 79% of
the piece inside the body and then shrinkwrapped every vertex 2.9 times to get it out,
which is what "the vertices are breaking" looks like from the review camera.
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
# A shoulders region thinner than this is not a deltoid and cannot set a width.
MIN_REGION_VERTICES = 50
MIN_REGION_WIDTH = 0.04
# How far a body vertex's own normal may travel before a cap over it stops covering it.
COVERAGE_REACH = 0.06
RAY_NUDGE = 1e-5
RAY_HIT_LIMIT = 64
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


def place_side(entries: list[tuple], side: str, contract: dict, landmarks: dict,
               region: np.ndarray, dressed: geometry.Surface, clearance: float,
               cap_fraction: float, anchor: str = "deltoid", seat: str = "p95") -> dict:
    """Everything the rule does to one shoulder, in one place, rigidly."""
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
        "side": side,
        "anchor": anchor,
        "seat": seat,
        "armAxis": [round(float(value), 6) for value in axis_arm],
        "jointHead": [round(float(value), 6) for value in joint],
        "capIsland": {"vertices": int(len(cap_points)), "triangles": ring.triangles_of(cap)},
        "openingAxisSource": [round(float(value), 6) for value in axis],
        "openingAxisPlaced": [round(float(value), 6) for value in placed_axis],
        "axisTrace": trace,
        "axisToArmDegrees": round(float(np.degrees(np.arccos(np.clip(axis @ axis_arm, -1.0, 1.0)))), 4),
        "placedAxisToArmDegrees": round(
            float(np.degrees(np.arccos(np.clip(placed_axis @ axis_arm, -1.0, 1.0)))), 4),
        "apexSource": [round(float(value), 6) for value in apex_before],
        "capFraction": cap_fraction,
        "capSpanAlongAxisMetres": round(span, 6),
        "wholeIslandAlongAxisMetres": round(whole, 6),
        "deltoid": muscle,
        "deltoidFactor": DELTOID_FACTOR,
        "scale": round(scale, 6),
        "tiltDegrees": round(tilt, 4),
        "tiltWantedDegrees": round(wanted, 4),
        "tiltClamped": abs(wanted) > MAX_TILT_DEGREES,
        "clearanceMetres": clearance,
        "jointRay": {"direction": [round(float(value), 6) for value in -placed_axis],
                     "crossings": ray["crossings"], "firstHitMetres": ray["firstMetres"],
                     "outerHitMetres": ray["lastMetres"],
                     "outerHit": [round(float(value), 6) for value in ray["point"]]},
        "apexAnchorDestination": [round(float(value), 6) for value in apex_anchor["destination"]],
        "deltoidCentroid": [round(float(value), 6) for value in muscle_centre],
        "fixedCapCentroidSource": [round(float(value), 6) for value in deltoid_anchor["pivot"]],
        "clearanceDirection": [round(float(value), 6) for value in outward],
        "translation": [round(float(value), 6) for value in
                        (chosen["destination"] - scale * rotation @ chosen["pivot"] + moved)],
        "apexPlaced": [round(float(value), 6) for value in apex_now],
        "clearancePasses": len(passes),
        "clearanceSteps": passes,
        "clearanceTranslationMetres": round(float(np.linalg.norm(moved)), 6),
        "clearanceBounded": float(np.linalg.norm(moved)) >= MAX_CLEARANCE - 1e-9,
        "fixedCapVertices": int(is_fixed.sum()),
        "fixedCapDepthBeforeMetres": round(first, 6),
        "fixedCapDepthAfterMetres": round(float(buried.max(initial=0.0)), 6),
        "fixedCapDeeperThan2mm": int((buried > CLEARANCE_DEPTH).sum()),
        "fixedCapSeatDepthMetres": round(worst(buried), 6),
        "seatPercentile": SEAT_PERCENTILE,
    }


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

    sided: dict[str, list[tuple]] = {"L": [], "R": []}
    for obj in islands:
        points = ring.points_of(obj)
        sided["L" if float(points.mean(axis=0)[0]) >= 0.0 else "R"].append((obj, points))
    for side, entries in sided.items():
        if not entries:
            raise SocketError(f"pair gate: no island on side {side}")
        # The cap is the largest island; the rest of the side is hardware or cloth.
        entries.sort(key=lambda entry: (-len(entry[1]), entry[0].name))

    placement = {}
    for side, entries in sided.items():
        placement[side] = place_side(entries, side, contract, landmarks, region[side], dressed,
                                     clearance, args.cap, args.anchor, args.seat)
        placement[side]["islands"] = island_rows(entries)
        # Measured before the join, which is what makes the cap indistinguishable from
        # the hardware and the cloth welded to it. Nothing below moves a vertex again.
        cap = entries[0][0]
        cap_points = ring.points_of(cap)
        cap_dressed = depths(cap_points, dressed)
        cap_bare = depths(cap_points, bare)
        apex = np.array(placement[side]["apexPlaced"])
        placement[side]["capClearance"] = {
            "vertices": int(len(cap_points)),
            "maxDepthDressedMetres": round(float(cap_dressed.max(initial=0.0)), 6),
            "deeperThan2mmDressed": int((cap_dressed > CLEARANCE_DEPTH).sum()),
            "maxDepthBareMetres": round(float(cap_bare.max(initial=0.0)), 6),
            "deeperThan2mmBare": int((cap_bare > CLEARANCE_DEPTH).sum()),
            "apexToTargetMillimetres": round(float(np.linalg.norm(dressed.nearest(apex) - apex)) * 1000.0, 3),
            "apexToBareMillimetres": round(float(np.linalg.norm(bare.nearest(apex) - apex)) * 1000.0, 3),
        }
        placement[side]["coverage"] = coverage(region[side], normals[side], cap_tree_of([cap]),
                                               COVERAGE_REACH)

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
    alignment = {side: {"scale": placement[side]["scale"], "yawDegrees": args.yaw,
                        "translation": placement[side]["translation"]} for side in ("L", "R")}
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
        "hidesPieces": bool(slot.get("hidesPieces", True)),
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
        "placement": placement,
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
    parser.add_argument("--anchor", choices=("deltoid", "apex"), default="deltoid")
    parser.add_argument("--seat", choices=("none", "clear", "p95"), default="p95")
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
