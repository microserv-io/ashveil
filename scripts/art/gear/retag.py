"""Add region tags to a piece that is already fitted, without refitting it.

The tag is a property of where the shipped GLB's vertices lie against the body, so a
piece fitted before the tags existed can gain them from its own runtime file. It
touches the manifest and nothing else: the GLB, the report and every gate stay as
they were fitted.

    blender --background --factory-startup --python scripts/art/gear/retag.py -- \
        --piece warden-tunic-full --body masculine-v3
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from fit import export as exporter  # noqa: E402
from gear import regions  # noqa: E402

ROOT = Path(__file__).resolve().parents[3]


def run(args) -> dict:
    directory = ROOT / "public" / "gear" / args.piece
    manifest_path = directory / f"{args.piece}.manifest.json"
    body_glb = ROOT / "public" / "bodies" / args.body / f"{args.body}.glb"
    masks_path = ROOT / "public" / "bodies" / args.body / f"{args.body}.masks.json"
    for path in (directory / f"{args.piece}.glb", manifest_path, body_glb, masks_path):
        if not path.exists():
            raise FileNotFoundError(f"retag gate: no file at {path}")

    manifest = json.loads(manifest_path.read_text())
    if manifest["body"] != args.body:
        raise RuntimeError(f"retag gate: {args.piece} is fitted to {manifest['body']}, not {args.body}")
    tagged, report = regions.of_glb(str(directory / f"{args.piece}.glb"), str(body_glb),
                                    json.loads(masks_path.read_text()))
    # After `hides`, where the runtime's own reading of a manifest expects it.
    rewritten = {}
    for key, value in manifest.items():
        rewritten[key] = value
        if key == "hides":
            rewritten["regions"] = tagged
    if "regions" not in rewritten:
        rewritten["regions"] = tagged
    exporter.write_json(str(manifest_path), rewritten)
    return {"piece": args.piece, **report}


def main() -> int:
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else sys.argv[1:]
    parser = argparse.ArgumentParser(prog="art:retag")
    parser.add_argument("--piece", required=True)
    parser.add_argument("--body", required=True)
    print(json.dumps(run(parser.parse_args(argv)), separators=(",", ":")))
    return 0


if __name__ == "__main__":
    sys.exit(main())
