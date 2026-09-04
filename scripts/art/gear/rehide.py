"""Re-measure a shipped piece's `hides` block without refitting its geometry.

A mask is a measurement, not geometry: which body vertices a garment stands over
falls out of the fitted piece, the body and the slot's rules, and all three survive
a fit. So when a coverage rule moves, the whole set can be re-masked from the GLBs
already on disk - no Tripo source, no refit, and not a byte of any piece moved. Only
`hides` in the manifest and `coverage` in the report are rewritten.

What it prints is the thing to read: hidden before and after, split by the rule that
claimed each vertex, and how many of them sit further from the piece than any cloth
could be standing over. That last count is the hole test in numbers - away from a
`replaces` rule it has to be zero, because a hidden vertex the garment is nowhere
near is a window onto the inside of the model.

Run: blender --background --factory-startup --python-exit-code 1 \
     --python scripts/art/gear/rehide.py -- --piece warden-tunic [--piece ...] [--dry-run]
"""
from __future__ import annotations

import argparse
import json
import sys
import traceback
from pathlib import Path

import bpy
from mathutils import Vector

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from fit import export as exporter  # noqa: E402
from fit import masks as body_masks  # noqa: E402
from fit.glb import Glb  # noqa: E402
from fit.skin import Body  # noqa: E402
from gear import body, geometry, piece as piece_module  # noqa: E402

ROOT = Path(__file__).resolve().parents[3]
CONTRACT_PATH = ROOT / "scripts" / "art" / "contracts" / "humanoid.v1.json"
# What a hidden vertex may be from the piece before the mask is drawing a window
# rather than hiding skin behind cloth.
STRAY_METRES = 0.025


def parse(argv: list[str]):
    parser = argparse.ArgumentParser(prog="art:rehide")
    parser.add_argument("--piece", action="append", required=True)
    parser.add_argument("--dry-run", action="store_true")
    return parser.parse_args(argv)


def _load_piece(path: Path):
    """The shipped piece exactly as it left the fitter, joined and untouched.

    Deliberately not `piece.import_file`: that is the source path, and it welds seams
    and drops degenerate faces. A re-mask has to ask the geometry the game draws.

    The skinned meshes only. An addon puts a metre-wide helper sphere in the scene on
    every glTF import, and joined into the piece it swallows most of the body.
    """
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=str(path))
    added = [obj for obj in bpy.data.objects if obj not in before]
    rigs = {obj for obj in added if obj.type == "ARMATURE"}
    meshes = [obj for obj in added if obj.type == "MESH"
              and any(modifier.type == "ARMATURE" and modifier.object in rigs
                      for modifier in obj.modifiers)]
    if not meshes:
        raise RuntimeError(f"rehide gate: {path} carries no skinned mesh")
    return piece_module.join(meshes, meshes[0].name) if len(meshes) > 1 else meshes[0]


def _strays(hides: dict[str, list[int]], meshes: dict, tree, replaced: dict) -> dict:
    """Hidden vertices further from the piece than cloth could reach, per rule."""
    counted = {"covered": 0, "replaced": 0, "farthestMetres": 0.0}
    for name, indices in hides.items():
        obj = meshes[name]
        claimed = set(replaced.get(name, []))
        for index in indices:
            world = obj.matrix_world @ obj.data.vertices[index].co
            nearest = tree.find_nearest(Vector(world))
            gap = nearest[3] if nearest[0] is not None else float("inf")
            if gap <= STRAY_METRES:
                continue
            counted["replaced" if index in claimed else "covered"] += 1
            counted["farthestMetres"] = max(counted["farthestMetres"], round(gap, 5))
    return counted


def remask(name: str, contract: dict) -> tuple[dict, list[tuple[str, dict]]]:
    """One piece re-measured: what it now hides, and the two documents that say so."""
    directory = ROOT / "public" / "gear" / name
    manifest = json.loads((directory / f"{name}.manifest.json").read_text())
    report = json.loads((directory / f"{name}.report.json").read_text())
    slot = contract["slots"][manifest["slot"]]

    loaded = body.load(ROOT, manifest["body"])
    fitted = _load_piece(directory / f"{name}.glb")
    hanging = {bone for block in manifest.get("drapes", []) for bone in block["bones"]}
    covered, coverage_report = geometry.coverage(fitted, loaded["meshes"],
                                                 float(slot["coverReach"]), hanging)
    replaced = ({} if not slot["replaces"]
                else body_masks.resolve_rules(Body(Glb(str(loaded["path"])), contract), contract,
                                              loaded["manifest"]["landmarks"], slot["replaces"]))
    union = {mesh: sorted(set(covered.get(mesh, [])) | set(replaced.get(mesh, [])))
             for mesh in sorted(set(covered) | set(replaced))}
    hides = {mesh: indices for mesh, indices in union.items() if indices}

    before = sum(len(indices) for indices in manifest["hides"].values())
    tree = geometry.fixed_shell(fitted, hanging)
    strays = _strays(hides, {obj.name: obj for obj in loaded["meshes"]}, tree, replaced)
    measured = {
        "piece": name,
        "slot": manifest["slot"],
        "reachMetres": float(slot["coverReach"]),
        "hiddenBefore": before,
        "hiddenAfter": sum(len(indices) for indices in hides.values()),
        "ray": coverage_report["rayVertices"],
        "swallowed": coverage_report["swallowedVertices"],
        "replacesOnly": sum(len(indices) for indices in hides.values())
        - sum(len(indices) for indices in covered.values()),
        "strays": strays,
    }

    manifest["hides"] = hides
    report["coverage"] = {
        "reachMetres": float(slot["coverReach"]), **coverage_report,
        "hiddenVertices": {mesh.name: len(hides.get(mesh.name, [])) for mesh in loaded["meshes"]},
        "measuredVertices": {mesh.name: len(covered.get(mesh.name, [])) for mesh in loaded["meshes"]},
        "replacedVertices": {mesh.name: len(replaced.get(mesh.name, [])) for mesh in loaded["meshes"]},
    }
    return measured, [(str(directory / f"{name}.manifest.json"), manifest),
                      (str(directory / f"{name}.report.json"), report)]


def main() -> int:
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else sys.argv[1:]
    args = parse(argv)
    contract = json.loads(CONTRACT_PATH.read_text())
    written = []
    for name in args.piece:
        measured, documents = remask(name, contract)
        if not args.dry_run:
            for path, document in documents:
                exporter.write_json(path, document)
        written.append(measured)
        print(json.dumps(measured, separators=(",", ":")), file=sys.stderr)
    print(json.dumps({"dryRun": args.dry_run, "pieces": written}, indent=2))
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as error:  # noqa: BLE001 - Blender's exit status is the wrapper contract.
        traceback.print_exc()
        print(f"REHIDE FAILED: {error}", file=sys.stderr)
        sys.exit(1)
