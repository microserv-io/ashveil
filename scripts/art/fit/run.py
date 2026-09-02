"""One body, one command, one report. Run by scripts/art/fit.mjs inside Blender.

Every stage is a module with one job; this only decides the order and where the
files land. A stage that fails raises, and the raise is what makes the command
exit non-zero with a named gate rather than writing half a body.
"""

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
from fit import gate, landmarks, normalise, review, skeleton, weights  # noqa: E402
from fit.glb import Glb  # noqa: E402
from fit.skin import Body  # noqa: E402

CONTRACTS = Path(__file__).resolve().parents[1] / "contracts"


def parse(argv: list[str]):
    parser = argparse.ArgumentParser(prog="art:fit")
    parser.add_argument("--input", required=True)
    parser.add_argument("--family", required=True)
    parser.add_argument("--body", required=True)
    parser.add_argument("--outdir", required=True)
    parser.add_argument("--helpers", action="store_true")
    return parser.parse_args(argv)


def run(args) -> dict:
    contract_path = CONTRACTS / f"{args.family}.json"
    if not contract_path.exists():
        raise RuntimeError(f"family gate: no contract at {contract_path}")
    contract = json.loads(contract_path.read_text())

    out = Path(args.outdir)
    out.mkdir(parents=True, exist_ok=True)
    glb_path = str(out / f"{args.body}.glb")

    normalised = normalise.run(args.input, contract)
    fitted = landmarks.fit(normalised["regions"])
    landmarks.check_confidence(fitted, contract["minimumLandmarkConfidence"], contract["landmarks"])
    landmarks.check_symmetry(fitted, contract)
    built = skeleton.build(fitted["landmarks"], contract, args.helpers)
    bound = weights.bind(built["armature"], normalised["objects"], contract)

    exporter.write_glb(glb_path, normalised["objects"], built["armature"])
    rest = exporter.finish(glb_path)

    glb = Glb(glb_path)
    body = Body(glb, contract)
    before = weights.measure(body, body.primary["weights"], contract)
    cleaned, clean_log = weights.clean(body)
    after = weights.measure(body, cleaned, contract)
    weight_gates = weights.gates(after, contract)
    joints, values = weights.pack(cleaned)
    glb.write_accessor(body.primary["attributes"]["JOINTS_0"], joints)
    glb.write_accessor(body.primary["attributes"]["WEIGHTS_0"], values)
    glb.write(glb_path)

    table = {name: [float(value) for value in point] for name, point in fitted["landmarks"].items()}
    source_had = {"uvs": any(normalised["report"]["input"]["uvLayers"].values()),
                  "textures": bool(normalised["report"]["input"]["images"])}
    measured = gate.measure(glb_path, contract, table, source_had)
    frame_gates = gate.gates(measured, contract, args.helpers)
    gates_table = {**weight_gates, **frame_gates}

    report = {
        "schema": "ashveil.body-report.v1",
        "family": contract["family"],
        "body": args.body,
        "helpers": args.helpers,
        "normalise": normalised["report"],
        "landmarks": {"measurements": fitted["measurements"], "bounds": fitted["bounds"],
                      "table": {name: [round(value, 6) for value in point] for name, point in sorted(table.items())}},
        "skeleton": built["report"],
        "weights": {"bind": bound, "clean": clean_log, "before": before, "after": after},
        "rest": rest,
        "runtime": measured,
        "gates": gates_table,
        "gatesPass": all(gates_table.values()),
        "outputs": {"glb": os.path.basename(glb_path), "manifest": f"{args.body}.manifest.json",
                    "review": f"{args.body}.review.png", "sha256": exporter.sha256_file(glb_path)},
    }
    # The report is written whether or not the gates passed: a refusal that says
    # only which gate failed is a refusal nobody can act on.
    exporter.write_json(str(out / f"{args.body}.report.json"), report)
    if not report["gatesPass"]:
        os.remove(glb_path)
        gate.check("body", gates_table)

    budget = {"triangles": measured["triangles"], "materials": measured["materials"],
              "meshes": measured["meshes"], "bones": measured["boneCount"],
              "maxInfluencesPerVertex": after["maxInfluencesPerVertex"]}
    manifest = exporter.manifest(args.body, contract, args.input, fitted["landmarks"], fitted["footprint"],
                                 built["report"], args.helpers, budget, gates_table, glb_path)
    exporter.write_json(str(out / f"{args.body}.manifest.json"), manifest)

    scratch = tempfile.mkdtemp(prefix="ashveil-review-")
    try:
        review.sheet(glb_path, contract, str(out / f"{args.body}.review.png"), scratch)
    finally:
        shutil.rmtree(scratch, ignore_errors=True)
    return report


def main() -> int:
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else sys.argv[1:]
    args = parse(argv)
    try:
        report = run(args)
    except Exception as error:  # noqa: BLE001 - the exit code is the contract with the wrapper
        traceback.print_exc()
        print(f"FIT FAILED: {error}", file=sys.stderr)
        return 1
    print(json.dumps({"body": report["body"], "gatesPass": report["gatesPass"],
                      "gates": report["gates"], "outputs": report["outputs"]}, indent=1))
    return 0


if __name__ == "__main__":
    sys.exit(main())
