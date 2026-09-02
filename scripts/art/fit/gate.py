"""Stage 5: prove the runtime file, from the runtime file.

Every earlier stage believes its own arithmetic. This one re-measures the bytes
that ship and refuses them by name: the frame is proven from landmarks rather
than from the conversion that produced them, the schema is compared against the
family contract, and the budgets are counted off the glTF.

A gate that cannot say which gate failed is a gate nobody can act on, so each
returns a named boolean and `check` raises with the names that are false.
"""

from __future__ import annotations

import numpy as np

from .glb import Glb, rest_orientations
from .skin import Body

REST_IDENTITY_TOLERANCE = 1e-5


class GateError(RuntimeError):
    pass


def _bone_reach(body: Body, contract: dict, landmarks: dict) -> dict:
    """How far past its own segment each bone pulls a vertex it holds."""
    reach = {}
    for spec in contract["bones"]:
        if not spec["deform"]:
            continue
        at = body.index.get(spec["name"])
        if at is None:
            continue
        head = np.array(landmarks[spec["head"]], dtype=np.float64)
        tail = np.array(landmarks[spec["tail"]], dtype=np.float64)
        segment = tail - head
        worst = 0.0
        for region in body.regions:
            held = region["weights"][:, at] > 0.05
            if not held.any():
                continue
            points = region["positions"][held]
            along = np.clip(((points - head) @ segment) / float(segment @ segment), 0.0, 1.0)
            worst = max(worst, float(np.linalg.norm(points - (head + np.outer(along, segment)), axis=1).max()))
        reach[spec["name"]] = round(worst, 4)
    return reach


def measure(path: str, contract: dict, landmarks: dict, source_had: dict) -> dict:
    glb = Glb(path)
    body = Body(glb, contract)
    document = glb.json
    triangles = sum(document["accessors"][primitive["indices"]]["count"] // 3
                    for mesh in document["meshes"] for primitive in mesh["primitives"])
    uvs = {mesh["name"]: any("TEXCOORD_0" in primitive["attributes"] for primitive in mesh["primitives"])
           for mesh in document["meshes"]}
    lowest = min(float(document["accessors"][primitive["attributes"]["POSITION"]]["min"][1])
                 for mesh in document["meshes"] for primitive in mesh["primitives"])
    highest = max(float(document["accessors"][primitive["attributes"]["POSITION"]]["max"][1])
                  for mesh in document["meshes"] for primitive in mesh["primitives"])

    deform = [spec["name"] for spec in contract["bones"] if spec["deform"]]
    helper_names = {spec["name"] for spec in contract["helpers"]}
    carried = {}
    for name, at in body.index.items():
        carried[name] = int(sum(int((region["weights"][:, at] > 1e-6).sum()) for region in body.regions))

    return {
        "bones": list(body.index),
        "boneCount": len(body.index),
        "landmarkFrame": {
            "headAbovePelvisMetres": round(float(landmarks["head"][1] - landmarks["pelvis"][1]), 6),
            "toeAheadOfHeelMetres": round(float(landmarks["toe_L"][2] - landmarks["heel_L"][2]), 6),
            # The toe is the front of the sole by definition, so it proves nothing on
            # its own. Where the ankle sits along the foot does: it is behind the
            # middle on a body facing forward and ahead of it on one facing backwards.
            "ankleAlongFoot": round(float((landmarks["ankle_L"][2] - landmarks["heel_L"][2])
                                          / (landmarks["toe_L"][2] - landmarks["heel_L"][2])), 4),
            "leftHandLateralMetres": round(float(landmarks["hand_L"][0]), 6),
        },
        "groundOffsetMetres": round(lowest, 6),
        "standingHeightMetres": round(highest - lowest, 6),
        "triangles": int(triangles),
        "materials": len(document.get("materials", [])),
        "meshes": len(document["meshes"]),
        "textures": len(document.get("textures", [])),
        "uvs": uvs,
        "verticesPerBone": carried,
        "starvedDeformBones": sorted(name for name in deform if carried.get(name, 0) == 0),
        "weightedHelpers": sorted(name for name in helper_names if carried.get(name, 0) > 0),
        "boneReachMetres": _bone_reach(body, contract, landmarks),
        "maxRestRotation": round(max(float(np.abs(matrix - np.eye(3)).max())
                                     for matrix in rest_orientations(glb).values()), 9),
        "sourceHad": source_had,
    }


def gates(measured: dict, contract: dict) -> dict:
    limits = contract["gates"]
    budget = contract["budget"]
    expected = [spec["name"] for spec in contract["bones"]]
    frame = measured["landmarkFrame"]
    reach = measured["boneReachMetres"]
    # A leak reads as a bone holding geometry a body-width away; anatomy never
    # does. Both limits are fractions of the family's canonical height so the
    # rule travels to the next body without being retuned.
    limb = {spec["name"] for spec in contract["bones"] if spec.get("chain") == "limb"}
    height = contract["canonicalHeight"]
    overreaching = sorted(f"{name} {value:.3f}m" for name, value in reach.items()
                          if value > height * (limits["maxLimbReachHeight"] if name in limb
                                               else limits["maxSpineReachHeight"]))
    measured["overreachingBones"] = overreaching
    return {
        "head_is_above_the_pelvis": frame["headAbovePelvisMetres"] > 0,
        "toes_are_ahead_of_the_heels": frame["toeAheadOfHeelMetres"] > 0,
        "the_ankle_sits_behind_the_middle_of_the_foot":
            0 < frame["ankleAlongFoot"] < limits["ankleAlongFootMax"],
        "the_left_hand_is_at_positive_x": frame["leftHandLateralMetres"] > 0,
        "the_feet_stand_on_the_ground": abs(measured["groundOffsetMetres"]) <= limits["groundToleranceMetres"],
        "the_body_is_the_canonical_height":
            abs(measured["standingHeightMetres"] - contract["canonicalHeight"])
            <= contract["canonicalHeight"] * limits["heightTolerance"],
        "the_skeleton_matches_the_family_schema":
            all(name in measured["bones"] for name in expected),
        "every_deform_bone_carries_weight": not measured["starvedDeformBones"],
        "helper_bones_carry_no_weight": not measured["weightedHelpers"],
        "no_bone_reaches_outside_its_region": not overreaching,
        "triangles_within_budget": measured["triangles"] <= budget["maxTriangles"],
        "materials_within_budget": measured["materials"] <= budget["maxMaterials"],
        "meshes_within_budget": measured["meshes"] <= budget["maxMeshes"],
        "uvs_survived_the_pipeline":
            all(measured["uvs"].values()) if measured["sourceHad"]["uvs"] else True,
        "textures_survived_the_pipeline":
            measured["textures"] > 0 if measured["sourceHad"]["textures"] else True,
        "bones_rest_axis_aligned": measured["maxRestRotation"] <= REST_IDENTITY_TOLERANCE,
    }


def check(name: str, gates_table: dict) -> None:
    failed = sorted(gate for gate, passed in gates_table.items() if not passed)
    if failed:
        raise GateError(f"{name} gate failed: {', '.join(failed)}")
