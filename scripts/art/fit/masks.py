"""Resolve family gear slots to the shipped body's cleaned vertices."""

from __future__ import annotations

import json

import numpy as np

from .skin import Body


def _endpoint(spec, landmarks: dict[str, np.ndarray]) -> np.ndarray:
    if isinstance(spec, str):
        return landmarks[spec]
    start = landmarks[spec["from"]]
    end = landmarks[spec["towards"]]
    return start + (end - start) * float(spec["along"])


def _segments(contract: dict, landmarks: dict[str, np.ndarray]) -> dict[str, tuple[np.ndarray, np.ndarray]]:
    result = {}
    for spec in [*contract["bones"], *contract["helpers"]]:
        result[spec["name"]] = (_endpoint(spec["head"], landmarks), _endpoint(spec["tail"], landmarks))
    return result


def _members(region: dict, dominant: np.ndarray, body: Body, rules: list,
             segments: dict) -> np.ndarray:
    members = np.zeros(len(region["positions"]), dtype=bool)
    for rule in rules:
        if rule["bone"] not in body.index:
            continue
        start, end = segments[rule["bone"]]
        segment = end - start
        length_squared = float(segment @ segment)
        if length_squared < 1e-12:
            raise RuntimeError(f"mask gate: bone {rule['bone']} has no length")
        candidates = dominant == body.index[rule["bone"]]
        along = np.clip(((region["positions"] - start) @ segment) / length_squared, 0.0, 1.0)
        lower, upper = rule.get("along", [0.0, 1.0])
        inside = candidates & (along >= lower) & (along <= upper)
        # `forward` takes the back of a bone's skin without its front: a hood
        # wraps the skull behind the ear line but never covers the face.
        near, far = rule.get("forward", [-np.inf, np.inf])
        depth = region["positions"][:, 2] - start[2]
        members |= inside & (depth >= near) & (depth <= far)
    return members


def resolve_rules(body: Body, contract: dict, table: dict, rules: list) -> dict[str, list[int]]:
    """One region-rule list against the shipped body, per mesh.

    The same resolution slots are cut with, so a `replaces` list reads exactly like a
    `region` one and gets `along` and `forward` for free.
    """
    landmarks = {name: np.asarray(point, dtype=np.float64) for name, point in table.items()}
    segments = _segments(contract, landmarks)
    resolved = {}
    for region in body.regions:
        dominant = np.argmax(region["weights"], axis=1)
        members = _members(region, dominant, body, rules, segments)
        resolved[region["name"]] = np.flatnonzero(members).astype(int).tolist()
    return resolved


def resolve(body: Body, contract: dict, table: dict) -> dict:
    landmarks = {name: np.asarray(point, dtype=np.float64) for name, point in table.items()}
    segments = _segments(contract, landmarks)
    resolved = {slot: {region["name"]: [] for region in body.regions} for slot in contract["slots"]}

    for region in body.regions:
        dominant = np.argmax(region["weights"], axis=1)
        for slot, slot_spec in contract["slots"].items():
            members = _members(region, dominant, body, slot_spec["region"], segments)
            resolved[slot][region["name"]] = np.flatnonzero(members).astype(int).tolist()
    return resolved


def _ordered(bound) -> bool:
    return bound is None or (len(bound) == 2 and bound[0] < bound[1])


def gates(resolved: dict, contract: dict, bones: set[str]) -> dict[str, bool]:
    named = all(rule["bone"] in bones and _ordered(rule.get("forward"))
                for spec in contract["slots"].values() for rule in spec["region"])
    all_resolve = all(
        not spec["region"] or any(indices for indices in resolved[slot].values())
        for slot, spec in contract["slots"].items()
    )
    claimed = set()
    overlaps = set()
    for meshes in resolved.values():
        for mesh, indices in meshes.items():
            current = {(mesh, index) for index in indices}
            overlaps.update(claimed & current)
            claimed.update(current)
    return {
        "slot_region_bones_exist": named,
        "every_slot_region_resolves": all_resolve,
        "slot_regions_do_not_overlap": not overlaps,
    }


def write(path: str, body_name: str, contract: dict, resolved: dict) -> None:
    document = {
        "schema": "ashveil.body-masks.v1",
        "body": body_name,
        "family": contract["family"],
        "contractVersion": contract["version"],
        "slots": resolved,
    }
    with open(path, "w") as output:
        json.dump(document, output, indent=2, sort_keys=True)
        output.write("\n")
