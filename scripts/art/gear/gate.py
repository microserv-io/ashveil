from __future__ import annotations

import numpy as np

from fit.glb import Glb, rest_orientations
from fit.skin import Body


def _islands(region: dict) -> dict[int, list[int]]:
    """The loose shapes of the exported surface, each as its welded vertex ids.

    The exporter splits a vertex per distinct normal or UV, so index connectivity
    counts one island per triangle; welding by position first counts surfaces.
    """
    welded = np.unique(region["positions"], axis=0, return_inverse=True)[1].reshape(-1)
    triangles = welded[region["triangles"]]
    parent = {int(index): int(index) for index in np.unique(triangles)}

    def root(index: int) -> int:
        while parent[index] != index:
            parent[index] = parent[parent[index]]
            index = parent[index]
        return index

    for triangle in triangles:
        first = root(int(triangle[0]))
        for index in triangle[1:]:
            other = root(int(index))
            if first != other:
                parent[other] = first

    grouped: dict[int, list[int]] = {}
    for index in parent:
        grouped.setdefault(root(index), []).append(index)
    # The welded id is the first vertex sharing that position, so it indexes positions.
    order = np.unique(region["positions"], axis=0, return_index=True)[1]
    return {key: [int(order[index]) for index in members] for key, members in grouped.items()}


def _sides(piece) -> dict:
    """How many islands sit each side of the midline, in the runtime frame (+X is left)."""
    counted = {"L": 0, "R": 0, "islands": 0}
    for region in piece.regions:
        for members in _islands(region).values():
            counted["islands"] += 1
            centre = float(np.mean([region["positions"][index][0] for index in members]))
            counted["L" if centre >= 0.0 else "R"] += 1
    return counted


def measure(piece_path: str, body_path: str, contract: dict, source_had: dict, outside: dict) -> dict:
    piece_glb = Glb(piece_path)
    body_glb = Glb(body_path)
    piece = Body(piece_glb, contract, primary="")
    body = Body(body_glb, contract)
    triangles = sum(len(region["triangles"]) for region in piece.regions)
    weights = np.concatenate([region["weights"] for region in piece.regions])
    influences = (weights > 1e-6).sum(axis=1)
    sums = weights.sum(axis=1)
    document = piece_glb.json
    has_uv = any("TEXCOORD_0" in primitive["attributes"]
                 for mesh in document["meshes"] for primitive in mesh["primitives"])
    inverse_difference = float(np.abs(piece.inverse_bind - body.inverse_bind).max())
    return {
        "bones": piece.names,
        "bodyBones": body.names,
        "inverseBindMaxAbsDifference": round(inverse_difference, 9),
        "triangles": int(triangles),
        "materials": len(document.get("materials", [])),
        "meshes": len(piece.regions),
        "sides": _sides(piece),
        "maxInfluencesPerVertex": int(influences.max(initial=0)),
        "minWeightSum": round(float(sums.min(initial=1.0)), 9),
        "maxWeightSum": round(float(sums.max(initial=1.0)), 9),
        "influencingBones": sorted(piece.names[index] for index in np.flatnonzero((weights > 1e-6).any(axis=0))),
        "hasUvs": has_uv,
        "textures": len(document.get("textures", [])),
        "maxRestRotation": round(max(float(np.abs(matrix - np.eye(3)).max())
                                     for matrix in rest_orientations(piece_glb).values()), 9),
        "sourceHad": source_had,
        "bindClearance": outside,
    }


def gates(measured: dict, slot: dict, facing: dict | None = None) -> dict:
    allowed = set(slot["weights"]["allowedBones"])
    result = {
        "piece_joints_match_the_body": measured["bones"] == measured["bodyBones"],
        "inverse_binds_match_the_body": measured["inverseBindMaxAbsDifference"] < 1e-5,
        "at_most_four_influences_per_vertex": measured["maxInfluencesPerVertex"] <= 4,
        "weights_sum_to_one": abs(measured["minWeightSum"] - 1.0) <= 1e-5
                              and abs(measured["maxWeightSum"] - 1.0) <= 1e-5,
        "every_influence_is_an_allowed_bone": set(measured["influencingBones"]) <= allowed,
        "triangles_within_budget": measured["triangles"] <= slot["budget"]["maxTriangles"],
        "materials_within_budget": measured["materials"] <= slot["budget"]["maxMaterials"],
        "uvs_survived_the_pipeline": measured["hasUvs"] if measured["sourceHad"]["uvs"] else True,
        "textures_survived_the_pipeline": measured["textures"] > 0 if measured["sourceHad"]["textures"] else True,
        "bones_rest_axis_aligned": measured["maxRestRotation"] <= 1e-5,
        "piece_sits_off_the_skin_at_bind":
            measured["bindClearance"]["maxPenetrationMetres"] <= slot["clip"]["depth"],
    }
    if slot["pair"]:
        # A pauldron is plates plus a cloth drape, so a side is any number of shells.
        result["pair_has_both_sides"] = measured["sides"]["L"] > 0 and measured["sides"]["R"] > 0
    else:
        result["piece_is_one_mesh"] = measured["meshes"] == 1
    toes = (facing or {}).get("toes")
    if toes:
        result["toes_point_forward"] = all(side["aheadMetres"] > 0.0 for side in toes.values())
    return result


def check(table: dict) -> None:
    failed = sorted(name for name, passed in table.items() if not passed)
    if failed:
        raise RuntimeError(f"gear gate failed: {', '.join(failed)}")
