from __future__ import annotations

import argparse
import json
import os
import shutil
import sys
import tempfile
import traceback
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from fit import export as exporter  # noqa: E402
from fit import masks as body_masks  # noqa: E402
from fit.glb import Glb  # noqa: E402
from fit.skin import Body  # noqa: E402
from gear import body, gate, geometry, piece, review, weights  # noqa: E402

ROOT = Path(__file__).resolve().parents[3]
CONTRACT_PATH = ROOT / "scripts" / "art" / "contracts" / "humanoid.v1.json"


def parse(argv: list[str]):
    parser = argparse.ArgumentParser(prog="art:gear")
    parser.add_argument("--input", required=True)
    parser.add_argument("--slot", required=True)
    parser.add_argument("--body", required=True)
    parser.add_argument("--piece", required=True)
    parser.add_argument("--weights", choices=("transfer", "stiff", "rigid"))
    parser.add_argument("--covers")
    parser.add_argument("--span")
    parser.add_argument("--yaw", choices=("0", "180"), default="0")
    parser.add_argument("--under")
    parser.add_argument("--thumb", choices=("+Z", "-Z", "inward", "outward"), default="+Z")
    parser.add_argument("--no-mask", action="store_true")
    parser.add_argument("--outdir", required=True)
    return parser.parse_args(argv)


def _source(args, loaded: dict) -> tuple[list, dict, dict]:
    if args.input.startswith("proxy:"):
        source_slot = args.input.split(":", 1)[1]
        objects, source_had = piece.proxy(loaded, source_slot)
        return objects, source_had, {
            "file": args.input,
            "sha256": exporter.sha256_file(str(loaded["path"])),
        }
    objects, source_had = piece.import_file(args.input)
    return objects, source_had, {
        "file": os.path.basename(args.input),
        "sha256": exporter.sha256_file(args.input),
    }


def _manifest(args, contract: dict, source: dict, covers: list[str], under: list[str], hides: dict,
              mode: str, alignment: dict, measured: dict, gates_table: dict, piece_path: str) -> dict:
    glb = Glb(piece_path)
    skin = glb.json["skins"][0]
    inverse = glb.accessor(skin["inverseBindMatrices"])
    return {
        "schema": "ashveil.gear-manifest.v1",
        "family": contract["family"],
        "contractVersion": contract["version"],
        "body": args.body,
        "slot": args.slot,
        "piece": args.piece,
        "source": source,
        "bones": [glb.json["nodes"][node]["name"] for node in skin["joints"]],
        "inverseBindSha256": exporter.sha256_array(inverse),
        "covers": covers,
        "under": under,
        "thumb": args.thumb,
        "hides": hides,
        "weights": mode,
        "alignment": alignment,
        "budget": {
            "triangles": measured["triangles"],
            "materials": measured["materials"],
            "meshes": measured["meshes"],
            "maxInfluencesPerVertex": measured["maxInfluencesPerVertex"],
        },
        "gates": gates_table,
        "reportFile": f"{args.piece}.report.json",
    }


def _covers(args, contract: dict) -> list[str]:
    """The slot regions this piece spans, which a sleeve makes wider than its own slot.

    Alignment reference only: what the piece hides is measured off the fitted piece.
    """
    if args.no_mask:
        return []
    names = ([name.strip() for name in args.covers.split(",")] if args.covers
             else list(contract["slots"][args.slot]["defaultCovers"]))
    for name in names:
        if name not in contract["slots"]:
            raise RuntimeError(f"slot gate: unknown covered slot \"{name}\"")
    return list(dict.fromkeys(names))


def _landmark_span(axis: str, start: str, end: str, factor: float, landmarks: dict) -> dict:
    """The distance between two body landmarks along one axis, as the piece's target extent."""
    if axis not in ("X", "Y", "Z"):
        raise RuntimeError(f"span gate: \"{axis}\" is not an axis")
    for name in (start, end):
        if name not in landmarks:
            raise RuntimeError(f"span gate: the body has no landmark \"{name}\"")
    at = {"X": 0, "Y": 1, "Z": 2}[axis]
    metres = abs(float(landmarks[end][at]) - float(landmarks[start][at]))
    if metres <= 1e-9:
        raise RuntimeError(f"span gate: {start} and {end} are the same point along {axis}")
    return {"axis": axis, "from": start, "to": end, "metres": metres, "factor": factor}


def _span(args, landmarks: dict) -> dict | None:
    """`AXIS:FROM:TO[:FACTOR]`: measure the piece against two landmarks, not the region."""
    if not args.span:
        return None
    parts = args.span.split(":")
    if len(parts) not in (3, 4):
        raise RuntimeError(f"span gate: \"{args.span}\" is not AXIS:FROM:TO[:FACTOR]")
    return _landmark_span(parts[0], parts[1], parts[2],
                          float(parts[3]) if len(parts) == 4 else 1.0, landmarks)


def _slot_span(slot: dict, landmarks: dict) -> dict | None:
    """A slot whose span names two landmarks measures itself, so a hood needs no flag.

    A proxy is skipped by the caller: it is the region's own shell, and measuring it
    against anything but that region stretches the body's shape out of itself.
    """
    rule = slot["align"]["span"]
    if ("from" in rule) != ("to" in rule):
        raise RuntimeError("span gate: a slot span names both \"from\" and \"to\" or neither")
    if "from" not in rule:
        return None
    return _landmark_span(rule["axis"], rule["from"], rule["to"], float(rule["factor"]), landmarks)


def _alignment_rule(rule: dict, proxy: bool) -> dict:
    """A slot's growth factor and offsets describe a garment worn over the skin.

    A proxy is already the body's own shell, so applying them inflates it into
    the limbs the body swings; at 1.0 it stays the shape it was carved from. The
    limb swing goes with them: a shell carved off this body already lies on its
    bones, and turning it onto them again only moves it off.
    """
    if not proxy:
        return rule
    return {key: value for key, value in rule.items()
            if key not in ("limb", "roll", "tube", "enclose")} | {
        "span": {**rule["span"], "factor": 1.0},
        "anchors": {axis: {**anchor, "offset": 0.0} for axis, anchor in rule["anchors"].items()}}


def _bone_line(named, side: str | None, contract: dict, landmarks: dict) -> tuple[str, list, list]:
    """A bone as a point and a direction, from the contract's own head and tail landmarks."""
    bone = named[side] if isinstance(named, dict) else named
    spec = next((entry for entry in contract["bones"] if entry["name"] == bone), None)
    if spec is None:
        raise RuntimeError(f"bone gate: the family has no bone \"{bone}\"")
    for name in (spec["head"], spec["tail"]):
        if name not in landmarks:
            raise RuntimeError(f"bone gate: {bone} has no landmark \"{name}\"")
    head = [float(value) for value in landmarks[spec["head"]]]
    tail = [float(value) for value in landmarks[spec["tail"]]]
    if all(abs(a - b) < 1e-9 for a, b in zip(head, tail)):
        raise RuntimeError(f"bone gate: {bone} has no length between {spec['head']} and {spec['tail']}")
    return bone, head, tail


def _roll(rule: dict, side: str | None, contract: dict, landmarks: dict,
          worn: str | None, said: str, tube: dict | None = None) -> dict | None:
    """The line a piece is turned about to find which way round it goes.

    The tube's axis when the slot has one, because the stations the tube measures
    have to survive the roll: a forearm 11.5 degrees off the hand's own axis moved
    the fingertip station 3.6cm and stretched the cuff to twice its length.
    """
    roll = rule.get("roll")
    if not roll:
        return None
    bone, head, tail = _bone_line(roll["bone"], side, contract, landmarks)
    resolved = {"bone": bone,
                "direction": list(tube["axis"]) if tube else [a - b for a, b in zip(head, tail)],
                "stepDegrees": float(roll["stepDegrees"])}
    if worn:
        resolved["prior"] = {"piece": _thumb_axis(said, side), "body": _thumb_axis(worn, side)}
    return resolved


# Runtime axes: +X is the body's left, +Z is forward. `inward` is toward the midline,
# which is the opposite side for each hand, so a pair's declaration is one word.
THUMB_AXES = {"+Z": (0.0, 0.0, 1.0), "-Z": (0.0, 0.0, -1.0)}


def _thumb_axis(named: str, side: str | None) -> list[float]:
    """A thumb direction as a runtime vector, for the body or for the piece's own frame."""
    if named in THUMB_AXES:
        return list(THUMB_AXES[named])
    if named not in ("inward", "outward"):
        raise RuntimeError(f"thumb gate: \"{named}\" is not a thumb direction")
    if side is None:
        raise RuntimeError(f"thumb gate: \"{named}\" only means something on a pair")
    toward_midline = -1.0 if side == "L" else 1.0
    return [toward_midline if named == "inward" else -toward_midline, 0.0, 0.0]


def _tube(rule: dict, side: str | None, loaded: dict, slots: list[str], landmarks: dict,
          clearance: float) -> dict | None:
    """Deform the piece onto the limb: one source, every body the game grows."""
    tube = rule.get("tube")
    if not tube:
        return None

    def named(value):
        return value[side] if isinstance(value, dict) and side else value

    for key in ("axisFrom", "axisTo"):
        if named(tube[key]) not in landmarks:
            raise RuntimeError(f"tube gate: the body has no landmark \"{named(tube[key])}\"")
    origin = [float(value) for value in landmarks[named(tube["axisFrom"])]]
    end = [float(value) for value in landmarks[named(tube["axisTo"])]]
    if all(abs(a - b) < 1e-9 for a, b in zip(origin, end)):
        raise RuntimeError("tube gate: the axis landmarks are the same point")
    resolved = {"axis": [b - a for a, b in zip(origin, end)], "origin": origin,
                "sliceMetres": float(tube.get("sliceMetres", 0.02)),
                "smooth": int(tube.get("smooth", 3)), "clearance": clearance}
    if "band" in tube:
        resolved["band"] = list(tube["band"])
        resolved["fade"] = float(tube.get("fade", 0.0))
    stretch = tube.get("stretch")
    if stretch:
        bones = stretch["bone"] if isinstance(stretch["bone"], dict) else {"all": stretch["bone"]}
        held = body.region(loaded, slots, side is not None, bones)
        waist = named(stretch["waist"])
        if waist not in landmarks:
            raise RuntimeError(f"tube gate: the body has no landmark \"{waist}\"")
        resolved["stretch"] = {"tipRegion": held[side or "all"],
                               "waistPoint": [float(value) for value in landmarks[waist]]}
    return resolved


def _enclose(rule: dict, side: str | None, loaded: dict, slots: list[str]) -> dict | None:
    """Grow until the region is inside the piece: a glove has to hold the whole hand."""
    settings = rule.get("enclose")
    if not settings:
        return None
    resolved = {key: value for key, value in settings.items() if key != "bone"}
    named = settings.get("bone")
    if named:
        bones = named if isinstance(named, dict) else {"all": named}
        held = body.region(loaded, slots, side is not None, bones)
        resolved["bone"] = bones[side] if side else bones["all"]
        resolved["region"] = held[side or "all"]
    return resolved


def _limb(rule: dict, side: str | None, contract: dict, landmarks: dict) -> dict | None:
    """The bone a slot's limb section is swung onto, as a line through two landmarks.

    The runtime file carries identity bone rest orientations by design, so an
    imported armature has no direction to read: the contract's own head and tail
    landmarks are where a bone still points.

    A bone points at its child, so tail to head runs up the limb away from the
    extremity the piece hangs off - the ankle to the knee, the wrist to the elbow.
    The band is a fraction along that, so 1.0 is always the cuff and 0.0 the toe or
    the fingertip, whichever slot is being fitted.
    """
    limb = rule.get("limb")
    if not limb:
        return None
    bone, head, tail = _bone_line(limb["bone"], side, contract, landmarks)
    return {"bone": bone, "joint": tail, "direction": [a - b for a, b in zip(head, tail)],
            "band": list(limb["band"]), "fade": float(limb["fade"])}


def run(args) -> dict:
    contract = json.loads(CONTRACT_PATH.read_text())
    if args.slot not in contract["slots"]:
        raise RuntimeError(f"slot gate: unknown slot \"{args.slot}\"")
    slot = contract["slots"][args.slot]
    loaded = body.load(ROOT, args.body)
    covers = _covers(args, contract)
    worn_under = [name.strip() for name in args.under.split(",") if name.strip()] if args.under else []
    beneath = piece.under(ROOT, worn_under)
    # What a piece is worn over is body as far as fitting goes: it is pushed out of
    # those shells too. Coverage stays body-only - gear never masks gear here.
    target = body.joined_target(loaded, beneath)
    surface = geometry.Surface(loaded["meshes"] + beneath, body.region_vertices(loaded, covers))
    objects, source_had, source = _source(args, loaded)
    objects, island_report = piece.islands(objects, slot["pair"], args.piece)

    proxy = args.input.startswith("proxy:")
    span = _span(args, loaded["manifest"]["landmarks"]) or (
        None if proxy else _slot_span(slot, loaded["manifest"]["landmarks"]))
    named = slot["align"].get("referenceSlot")
    # A proxy is the shell of one region, so it is measured against that region;
    # a garment is measured against everything it covers.
    reference_slots = ([args.input.split(":", 1)[1]] if proxy
                       else [named] if named else (covers or [args.slot]))
    reference = body.region(loaded, reference_slots, slot["pair"])
    rule = _alignment_rule(slot["align"], proxy)
    alignment_report = {}
    for at, obj in enumerate(objects):
        side = ("L", "R")[at] if slot["pair"] else "all"
        chosen = side if slot["pair"] else None
        landmarks = loaded["manifest"]["landmarks"]
        tube = _tube(rule, chosen, loaded, reference_slots, landmarks, float(slot["clearance"]))
        measured_side = geometry.align(obj, reference[side], rule, surface, chosen, span,
                                       int(args.yaw), _limb(rule, chosen, contract, landmarks),
                                       _roll(rule, chosen, contract, landmarks,
                                             slot.get("thumb"), args.thumb, tube),
                                       tube,
                                       _enclose(rule, chosen, loaded, reference_slots))
        measured_side["proxy"] = proxy
        measured_side["reference"] = reference_slots
        alignment_report[side] = measured_side
    faces = geometry.facing(objects, reference, slot, contract, loaded["manifest"]["landmarks"])
    decimation = geometry.decimate(objects, slot["budget"]["maxTriangles"])
    shrinkwrap = geometry.shrinkwrap(objects, target, slot, surface, span)
    mode = args.weights or slot["weights"]["mode"]
    weight_report = weights.apply(objects, target, loaded["armature"], slot, mode, slot["pair"])
    fitted = piece.join(objects, args.piece)

    enclosed = geometry.enclosure(fitted, reference)
    covered = ({} if args.no_mask
               else geometry.coverage(fitted, loaded["meshes"], float(slot["coverReach"])))
    # A glove replaces the hand rather than covering it, so the skin it stands in for
    # goes whether the garment reaches it or not: a fingertip the glove is a little
    # short of is still a gloved finger, not a bare one poking through.
    replaced = ({} if args.no_mask or not slot["replaces"]
                else body_masks.resolve_rules(Body(Glb(str(loaded["path"])), contract), contract,
                                              loaded["manifest"]["landmarks"], slot["replaces"]))
    # Sorted, because a set of mesh names iterates in a different order every process
    # and the fitter has to write the same bytes twice.
    union = {name: sorted(set(covered.get(name, [])) | set(replaced.get(name, [])))
             for name in sorted(set(covered) | set(replaced))}
    hides = {name: indices for name, indices in union.items() if indices}
    hidden = {name: set(indices) for name, indices in hides.items()}
    outside = geometry.outside_measure([fitted], geometry.Surface(loaded["meshes"] + beneath, hidden))

    out = Path(args.outdir)
    out.mkdir(parents=True, exist_ok=True)
    glb_path = str(out / f"{args.piece}.glb")
    exporter.write_glb(glb_path, {args.piece: fitted}, loaded["armature"])
    rest = exporter.finish(glb_path)
    measured = gate.measure(glb_path, str(loaded["path"]), contract, source_had, outside)
    gates_table = gate.gates(measured, slot, faces)
    kept = ("scale", "yawDegrees", "translation", "spanOverride", "limb", "roll", "tube", "enclose")
    # The region it grew against is thousands of points, and the manifest is a contract.
    alignment = ({side: {key: value for key, value in report.items() if key in kept}
                  for side, report in alignment_report.items()}
                 if slot["pair"] else
                 {key: value for key, value in alignment_report["all"].items()
                  if key in kept})
    report = {
        "schema": "ashveil.gear-report.v1",
        "family": contract["family"],
        "contractVersion": contract["version"],
        "body": args.body,
        "slot": args.slot,
        "piece": args.piece,
        "covers": covers,
        "under": worn_under,
        "referenceRegions": reference_slots,
        "coverage": {"reachMetres": float(slot["coverReach"]),
                     "hiddenVertices": {mesh.name: len(hides.get(mesh.name, []))
                                        for mesh in loaded["meshes"]},
                     "measuredVertices": {mesh.name: len(covered.get(mesh.name, []))
                                          for mesh in loaded["meshes"]},
                     "replacedVertices": {mesh.name: len(replaced.get(mesh.name, []))
                                          for mesh in loaded["meshes"]}},
        "replaces": slot["replaces"],
        "source": source,
        "islands": island_report,
        "alignment": alignment_report,
        "facing": faces,
        "regionEnclosed": enclosed,
        "decimation": decimation,
        "shrinkwrap": shrinkwrap,
        "weights": weight_report,
        "rest": rest,
        "runtime": measured,
        "gates": gates_table,
        "gatesPass": all(gates_table.values()),
        "outputs": {
            "glb": f"{args.piece}.glb",
            "manifest": f"{args.piece}.manifest.json",
            "report": f"{args.piece}.report.json",
            "review": f"{args.piece}.review.png",
            "sha256": exporter.sha256_file(glb_path),
        },
    }
    exporter.write_json(str(out / f"{args.piece}.report.json"), report)
    if not report["gatesPass"]:
        os.remove(glb_path)
        gate.check(gates_table)

    manifest = _manifest(args, contract, source, covers, worn_under, hides, mode, alignment,
                         measured, gates_table, glb_path)
    exporter.write_json(str(out / f"{args.piece}.manifest.json"), manifest)
    scratch = tempfile.mkdtemp(prefix="ashveil-gear-review-")
    try:
        report["review"] = {"bodyVerticesInsideThePiece": review.sheet(
            str(loaded["path"]), glb_path, contract, str(out / f"{args.piece}.review.png"),
            scratch, hidden)}
    finally:
        shutil.rmtree(scratch, ignore_errors=True)
    exporter.write_json(str(out / f"{args.piece}.report.json"), report)
    return report


def main() -> int:
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else sys.argv[1:]
    args = parse(argv)
    try:
        report = run(args)
    except Exception as error:  # noqa: BLE001 - Blender's exit status is the wrapper contract.
        glb_path = Path(args.outdir) / f"{args.piece}.glb"
        if glb_path.exists():
            glb_path.unlink()
        traceback.print_exc()
        print(f"GEAR FIT FAILED: {error}", file=sys.stderr)
        return 1
    print(json.dumps({"piece": report["piece"], "gatesPass": report["gatesPass"],
                      "gates": report["gates"], "outputs": report["outputs"]}, separators=(",", ":")))
    return 0


if __name__ == "__main__":
    sys.exit(main())
