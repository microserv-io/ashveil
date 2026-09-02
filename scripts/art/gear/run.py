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
from fit.glb import Glb  # noqa: E402
from gear import body, gate, geometry, piece, review, weights  # noqa: E402

ROOT = Path(__file__).resolve().parents[3]
CONTRACT_PATH = ROOT / "scripts" / "art" / "contracts" / "humanoid.v1.json"


def parse(argv: list[str]):
    parser = argparse.ArgumentParser(prog="art:gear")
    parser.add_argument("--input", required=True)
    parser.add_argument("--slot", required=True)
    parser.add_argument("--body", required=True)
    parser.add_argument("--piece", required=True)
    parser.add_argument("--weights", choices=("transfer", "rigid"))
    parser.add_argument("--covers")
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


def _manifest(args, contract: dict, source: dict, covers: list[str], mode: str, alignment: dict,
              measured: dict, gates_table: dict, piece_path: str) -> dict:
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
        "maskBody": any(contract["slots"][name]["region"] for name in covers),
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
    """The slot regions this piece hides, which a sleeve makes wider than its own slot."""
    if args.no_mask:
        return []
    names = [name.strip() for name in args.covers.split(",")] if args.covers else [args.slot]
    for name in names:
        if name not in contract["slots"]:
            raise RuntimeError(f"slot gate: unknown covered slot \"{name}\"")
    return list(dict.fromkeys(names))


def _alignment_rule(rule: dict, proxy: bool) -> dict:
    """A slot's growth factor and offsets describe a garment worn over the skin.

    A proxy is already the body's own shell, so applying them inflates it into
    the limbs the body swings; at 1.0 it stays the shape it was carved from.
    """
    if not proxy:
        return rule
    return {**rule,
            "span": {**rule["span"], "factor": 1.0},
            "anchors": {axis: {**anchor, "offset": 0.0} for axis, anchor in rule["anchors"].items()}}


def run(args) -> dict:
    contract = json.loads(CONTRACT_PATH.read_text())
    if args.slot not in contract["slots"]:
        raise RuntimeError(f"slot gate: unknown slot \"{args.slot}\"")
    slot = contract["slots"][args.slot]
    loaded = body.load(ROOT, args.body)
    covers = _covers(args, contract)
    target = body.joined_target(loaded)
    surface = geometry.Surface(loaded["meshes"], body.hidden_vertices(loaded, covers))
    objects, source_had, source = _source(args, loaded)
    objects, island_report = piece.islands(objects, slot["pair"], args.piece)

    reference_name = slot["align"].get("referenceSlot", args.slot)
    reference = body.region(loaded, reference_name, slot["pair"])
    proxy = args.input.startswith("proxy:")
    rule = _alignment_rule(slot["align"], proxy)
    alignment_report = {}
    for at, obj in enumerate(objects):
        side = ("L", "R")[at] if slot["pair"] else "all"
        measured_side = geometry.align(obj, reference[side], rule, surface,
                                       side if slot["pair"] else None)
        measured_side["proxy"] = proxy
        alignment_report[side] = measured_side
    decimation = geometry.decimate(objects, slot["budget"]["maxTriangles"])
    shrinkwrap = geometry.shrinkwrap(objects, target, slot)
    outside = geometry.outside_measure(objects, surface)
    mode = args.weights or slot["weights"]["mode"]
    weight_report = weights.apply(objects, target, loaded["armature"], slot, mode, slot["pair"])
    fitted = piece.join(objects, args.piece)

    out = Path(args.outdir)
    out.mkdir(parents=True, exist_ok=True)
    glb_path = str(out / f"{args.piece}.glb")
    exporter.write_glb(glb_path, {args.piece: fitted}, loaded["armature"])
    rest = exporter.finish(glb_path)
    measured = gate.measure(glb_path, str(loaded["path"]), contract, source_had, outside)
    gates_table = gate.gates(measured, slot)
    alignment = ({side: {key: value for key, value in report.items()
                         if key in ("scale", "yawDegrees", "translation")}
                  for side, report in alignment_report.items()}
                 if slot["pair"] else
                 {key: value for key, value in alignment_report["all"].items()
                  if key in ("scale", "yawDegrees", "translation")})
    report = {
        "schema": "ashveil.gear-report.v1",
        "family": contract["family"],
        "contractVersion": contract["version"],
        "body": args.body,
        "slot": args.slot,
        "piece": args.piece,
        "covers": covers,
        "source": source,
        "islands": island_report,
        "alignment": alignment_report,
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

    manifest = _manifest(args, contract, source, covers, mode, alignment, measured, gates_table, glb_path)
    exporter.write_json(str(out / f"{args.piece}.manifest.json"), manifest)
    scratch = tempfile.mkdtemp(prefix="ashveil-gear-review-")
    try:
        review.sheet(str(loaded["path"]), glb_path, contract,
                     str(out / f"{args.piece}.review.png"), scratch)
    finally:
        shutil.rmtree(scratch, ignore_errors=True)
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
