"""Stage 6: write the runtime file, then say exactly what it is.

Two rules the runtime cares about are enforced here rather than hoped for.
Node names carry no dots, because `GLTFLoader` strips the characters
`PropertyBinding` reserves and a profile written against the artist's name then
misses; underscores survive the trip unchanged. And the bones rest axis-aligned
(`glb.neutralise_rest`), so the rest-axis correction the runtime derives is the
identity and a profile never has to carry one.

The manifest is the per-body half of the contract: the family schema says what
a humanoid is, this says what this humanoid measured.
"""

from __future__ import annotations

import hashlib
import json
import os

import numpy as np

from .frame import rounded
from .glb import Glb, neutralise_rest

MANIFEST_SCHEMA = "ashveil.body-manifest.v1"


class ExportError(RuntimeError):
    pass


def sha256_file(path: str) -> str:
    digest = hashlib.sha256()
    with open(path, "rb") as source:
        for chunk in iter(lambda: source.read(1 << 20), b""):
            digest.update(chunk)
    return digest.hexdigest()


def sha256_array(values: np.ndarray) -> str:
    return hashlib.sha256(np.ascontiguousarray(values, dtype=np.float32).tobytes()).hexdigest()


def write_glb(path: str, regions: dict, armature) -> None:
    import bpy

    bpy.ops.object.select_all(action="DESELECT")
    for obj in regions.values():
        obj.select_set(True)
    armature.select_set(True)
    bpy.context.view_layer.objects.active = armature
    bpy.ops.export_scene.gltf(
        filepath=path,
        export_format="GLB",
        use_selection=True,
        export_yup=True,
        export_skins=True,
        export_animations=False,
        export_morph=False,
        export_all_influences=False,
        export_apply=False,
    )


def finish(path: str) -> dict:
    """Neutralise the bone rest orientations in the written file, in place."""
    glb = Glb(path)
    dotted = sorted({node["name"] for node in glb.json["nodes"] if "." in node.get("name", "")})
    if dotted:
        raise ExportError(f"name gate: node names carry dots that Three.js strips: {', '.join(dotted)}")
    rest = neutralise_rest(glb)
    glb.write(path)
    return rest


def manifest(body: str, contract: dict, source: str, landmarks: dict, skeleton: dict,
             helpers: bool, budget: dict, gates: dict, glb_path: str) -> dict:
    inverse = Glb(glb_path)
    skin = inverse.json["skins"][0]
    return {
        "schema": MANIFEST_SCHEMA,
        "family": contract["family"],
        "contractVersion": contract["version"],
        "body": body,
        # The name and the hash, never the path: a manifest is compared across
        # machines and a checkout path is not a property of the body.
        "source": {"file": os.path.basename(source), "sha256": sha256_file(source)},
        "canonicalHeight": contract["canonicalHeight"],
        "helpers": helpers,
        "bones": [inverse.json["nodes"][node]["name"] for node in skin["joints"]],
        "landmarks": {name: rounded(point) for name, point in sorted(landmarks.items())},
        "restSignatureSha256": skeleton["restSignatureSha256"],
        "inverseBindSha256": sha256_array(inverse.accessor(skin["inverseBindMatrices"])),
        "budget": budget,
        "gates": gates,
        "reportFile": f"{body}.report.json",
    }


def write_json(path: str, document: dict) -> None:
    with open(path, "w") as out:
        json.dump(document, out, indent=2, sort_keys=False)
        out.write("\n")
