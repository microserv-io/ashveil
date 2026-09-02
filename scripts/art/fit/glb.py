"""Reading, editing and rewriting a GLB, and the one edit that matters.

`neutralise_rest` is that edit: it turns every bone's rest orientation in the
exported file into identity while leaving every joint exactly where it was, so
that `semanticskeleton.ts` derives an identity rest-axis correction. Skinning
is untouched by construction - a joint's global bind transform and its inverse
bind matrix are rewritten as one pair, so their product is still the identity
the bind pose is defined by.

Blender keeps its own bone axes (see the rule in frame.py); the runtime file
does not need them and every one it carries is a rotation some later reader has
to undo.
"""

from __future__ import annotations

import json
import struct

import numpy as np

JSON_CHUNK = 0x4E4F534A
BIN_CHUNK = 0x004E4942
COMPONENT_DTYPE = {5120: "<i1", 5121: "<u1", 5122: "<i2", 5123: "<u2", 5125: "<u4", 5126: "<f4"}
TYPE_COUNT = {"SCALAR": 1, "VEC2": 2, "VEC3": 3, "VEC4": 4, "MAT4": 16}
IDENTITY_TOLERANCE = 1e-5


class GlbError(RuntimeError):
    pass


class Glb:
    def __init__(self, path: str) -> None:
        raw = open(path, "rb").read()
        if raw[:4] != b"glTF":
            raise GlbError(f"{path} is not a GLB")
        offset, self.json, self.bin = 12, None, bytearray()
        while offset < len(raw):
            length, kind = struct.unpack_from("<II", raw, offset)
            chunk = raw[offset + 8:offset + 8 + length]
            if kind == JSON_CHUNK:
                self.json = json.loads(chunk.decode("utf-8").rstrip("\x00 "))
            elif kind == BIN_CHUNK:
                self.bin = bytearray(chunk)
            offset += 8 + length
        if self.json is None:
            raise GlbError(f"{path} has no JSON chunk")

    def accessor(self, index: int) -> np.ndarray:
        accessor = self.json["accessors"][index]
        view = self.json["bufferViews"][accessor["bufferView"]]
        if view.get("byteStride"):
            raise GlbError("interleaved buffer views are not supported")
        dtype = np.dtype(COMPONENT_DTYPE[accessor["componentType"]])
        lanes = TYPE_COUNT[accessor["type"]]
        start = view.get("byteOffset", 0) + accessor.get("byteOffset", 0)
        flat = np.frombuffer(bytes(self.bin[start:start + accessor["count"] * lanes * dtype.itemsize]), dtype=dtype)
        return flat.reshape(accessor["count"], lanes) if lanes > 1 else flat.copy()

    def write_accessor(self, index: int, values: np.ndarray) -> None:
        accessor = self.json["accessors"][index]
        view = self.json["bufferViews"][accessor["bufferView"]]
        dtype = np.dtype(COMPONENT_DTYPE[accessor["componentType"]])
        start = view.get("byteOffset", 0) + accessor.get("byteOffset", 0)
        blob = np.ascontiguousarray(values, dtype=dtype).tobytes()
        if len(blob) != accessor["count"] * TYPE_COUNT[accessor["type"]] * dtype.itemsize:
            raise GlbError(f"accessor {index} rewrite changes its length")
        self.bin[start:start + len(blob)] = blob

    def parents(self) -> dict[int, int]:
        found = {}
        for at, node in enumerate(self.json["nodes"]):
            for child in node.get("children", []):
                found[child] = at
        return found

    def globals(self) -> list[np.ndarray]:
        parent = self.parents()
        resolved: dict[int, np.ndarray] = {}

        def resolve(at: int) -> np.ndarray:
            if at not in resolved:
                local = node_matrix(self.json["nodes"][at])
                resolved[at] = local if at not in parent else resolve(parent[at]) @ local
            return resolved[at]

        return [resolve(at) for at in range(len(self.json["nodes"]))]

    def write(self, path: str) -> None:
        document = json.dumps(self.json, separators=(",", ":"), sort_keys=False).encode("utf-8")
        document += b" " * (-len(document) % 4)
        payload = bytes(self.bin)
        payload += b"\x00" * (-len(payload) % 4)
        self.json.setdefault("buffers", [{}])
        with open(path, "wb") as out:
            out.write(b"glTF" + struct.pack("<II", 2, 12 + 8 + len(document) + 8 + len(payload)))
            out.write(struct.pack("<II", len(document), JSON_CHUNK) + document)
            out.write(struct.pack("<II", len(payload), BIN_CHUNK) + payload)


def quaternion_matrix(rotation) -> np.ndarray:
    x, y, z, w = rotation
    return np.array([
        [1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
        [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
        [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)],
    ])


def node_matrix(node: dict) -> np.ndarray:
    if "matrix" in node:
        return np.array(node["matrix"], dtype=np.float64).reshape(4, 4).T
    matrix = np.eye(4)
    matrix[:3, :3] = quaternion_matrix(node.get("rotation", [0, 0, 0, 1])) * np.array(node.get("scale", [1, 1, 1]))
    matrix[:3, 3] = node.get("translation", [0, 0, 0])
    return matrix


def rest_orientations(glb: Glb) -> dict[str, np.ndarray]:
    """Every skin joint's rest rotation, as the 3x3 the runtime would correct for."""
    world = glb.globals()
    return {glb.json["nodes"][node]["name"]: world[node][:3, :3] for node in glb.json["skins"][0]["joints"]}


def neutralise_rest(glb: Glb) -> dict:
    """Rewrite the skin so every bone rests axis-aligned, without moving a joint."""
    skin = glb.json["skins"][0]
    world = glb.globals()
    parent = glb.parents()
    joints = set(skin["joints"])
    before = max(float(np.abs(world[node][:3, :3] - np.eye(3)).max()) for node in skin["joints"])

    for node in skin["joints"]:
        above = parent.get(node)
        if above is not None and above not in joints:
            rotation = world[above][:3, :3]
            if float(np.abs(rotation - np.eye(3)).max()) > IDENTITY_TOLERANCE:
                raise GlbError(
                    f"rest gate: bone {glb.json['nodes'][node]['name']} hangs under a rotated node, "
                    "so its rest cannot be neutralised without moving it")

    for node in skin["joints"]:
        above = parent.get(node)
        origin = world[above][:3, 3] if above is not None else np.zeros(3)
        translation = world[node][:3, 3] - origin
        definition = glb.json["nodes"][node]
        definition.pop("matrix", None)
        definition.pop("rotation", None)
        definition.pop("scale", None)
        definition["translation"] = [float(value) for value in translation]

    inverse = np.repeat(np.eye(4, dtype=np.float64)[None, :, :], len(skin["joints"]), axis=0)
    for at, node in enumerate(skin["joints"]):
        inverse[at][:3, 3] = -world[node][:3, 3]
    glb.write_accessor(skin["inverseBindMatrices"], inverse.transpose(0, 2, 1).reshape(-1, 16))

    after = max(float(np.abs(matrix - np.eye(3)).max()) for matrix in rest_orientations(glb).values())
    if after > IDENTITY_TOLERANCE:
        raise GlbError(f"rest gate: bone rest orientations are still {after:.2e} off identity")
    return {"maxRestRotationBefore": round(before, 6), "maxRestRotationAfter": round(after, 9),
            "joints": len(skin["joints"])}
