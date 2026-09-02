"""Clean the shoulder, deltoid and back skin weights on a humanoid.v1 base body.

Bone-heat auto weights let upper_arm and clavicle reach into the latissimus and
the rear shoulder, so raising the arms drags the back up into wing-like flaps and
shears the deltoid cap. This rebuilds JOINTS_0/WEIGHTS_0 for the Body mesh by
region, deterministically, and patches them back into the GLB in place so every
other byte of the file survives untouched.

Run headless:
  blender --background --python scripts/art/clean-weights.py -- \
      --input body.glb --outdir out/ [--stage all|diagnose|clean|measure|render|verify]
"""

from __future__ import annotations

import argparse
import json
import math
import os
import struct
import sys

import numpy as np

# ---------------------------------------------------------------- glTF access

COMPONENT_DTYPE = {5120: "<i1", 5121: "<u1", 5122: "<i2", 5123: "<u2", 5125: "<u4", 5126: "<f4"}
TYPE_COUNT = {"SCALAR": 1, "VEC2": 2, "VEC3": 3, "VEC4": 4, "MAT4": 16}


class Glb:
    def __init__(self, path: str) -> None:
        self.path = path
        self.raw = bytearray(open(path, "rb").read())
        if bytes(self.raw[:4]) != b"glTF":
            raise SystemExit(f"not a GLB: {path}")
        off, self.chunks = 12, []
        while off < len(self.raw):
            length, kind = struct.unpack_from("<II", self.raw, off)
            off += 8
            self.chunks.append((kind, off, length))
            off += length
        json_chunk = next(c for c in self.chunks if c[0] == 0x4E4F534A)
        bin_chunk = next(c for c in self.chunks if c[0] == 0x004E4942)
        self.json = json.loads(bytes(self.raw[json_chunk[1]:json_chunk[1] + json_chunk[2]]))
        self.bin_start = bin_chunk[1]

    def accessor(self, index: int) -> np.ndarray:
        acc = self.json["accessors"][index]
        view = self.json["bufferViews"][acc["bufferView"]]
        if view.get("byteStride") not in (None, 0):
            raise SystemExit("interleaved buffer views are not supported")
        dtype = np.dtype(COMPONENT_DTYPE[acc["componentType"]])
        n = TYPE_COUNT[acc["type"]]
        start = self.bin_start + view.get("byteOffset", 0) + acc.get("byteOffset", 0)
        flat = np.frombuffer(bytes(self.raw[start:start + acc["count"] * n * dtype.itemsize]), dtype=dtype)
        return flat.reshape(acc["count"], n) if n > 1 else flat

    def accessor_span(self, index: int) -> tuple[int, int]:
        acc = self.json["accessors"][index]
        view = self.json["bufferViews"][acc["bufferView"]]
        dtype = np.dtype(COMPONENT_DTYPE[acc["componentType"]])
        start = self.bin_start + view.get("byteOffset", 0) + acc.get("byteOffset", 0)
        return start, acc["count"] * TYPE_COUNT[acc["type"]] * dtype.itemsize

    def mesh_node(self, name: str) -> dict:
        return next(n for n in self.json["nodes"] if n.get("name") == name)

    def write_patched(self, out_path: str, patches: list[tuple[int, bytes]]) -> None:
        data = bytearray(self.raw)
        for start, blob in patches:
            data[start:start + len(blob)] = blob
        with open(out_path, "wb") as f:
            f.write(bytes(data))


def quat_matrix(q) -> np.ndarray:
    x, y, z, w = q
    return np.array([
        [1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
        [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
        [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)],
    ])


def node_matrix(node: dict) -> np.ndarray:
    if "matrix" in node:
        return np.array(node["matrix"], dtype=np.float64).reshape(4, 4).T
    m = np.eye(4)
    m[:3, :3] = quat_matrix(node.get("rotation", [0, 0, 0, 1])) * np.array(node.get("scale", [1, 1, 1]))
    m[:3, 3] = node.get("translation", [0, 0, 0])
    return m


def rest_globals(glb: Glb) -> dict[int, np.ndarray]:
    parent = {}
    for i, n in enumerate(glb.json["nodes"]):
        for c in n.get("children", []):
            parent[c] = i
    out: dict[int, np.ndarray] = {}

    def resolve(i: int) -> np.ndarray:
        if i not in out:
            local = node_matrix(glb.json["nodes"][i])
            out[i] = local if i not in parent else resolve(parent[i]) @ local
        return out[i]

    for i in range(len(glb.json["nodes"])):
        resolve(i)
    return out


def rotation_about(axis: np.ndarray, angle: float, pivot: np.ndarray) -> np.ndarray:
    axis = axis / np.linalg.norm(axis)
    c, s = math.cos(angle), math.sin(angle)
    k = np.array([[0, -axis[2], axis[1]], [axis[2], 0, -axis[0]], [-axis[1], axis[0], 0]])
    r = np.eye(3) * c + s * k + (1 - c) * np.outer(axis, axis)
    m = np.eye(4)
    m[:3, :3] = r
    m[:3, 3] = pivot - r @ pivot
    return m


# ------------------------------------------------------------------- the rig

class Rig:
    """Bind-space geometry of the skinned Body mesh, in the GLB's own Y-up frame."""

    FRONT = np.array([0.0, 0.0, 1.0])
    UP = np.array([0.0, 1.0, 0.0])
    RIGHT = np.array([1.0, 0.0, 0.0])  # +X is the character's left

    def __init__(self, glb: Glb, mesh_name: str = "Body") -> None:
        self.glb = glb
        node = glb.mesh_node(mesh_name)
        prim = glb.json["meshes"][node["mesh"]]["primitives"][0]
        self.attrs = prim["attributes"]
        self.pos = glb.accessor(self.attrs["POSITION"]).astype(np.float64)
        self.nrm = glb.accessor(self.attrs["NORMAL"]).astype(np.float64)
        self.joints = glb.accessor(self.attrs["JOINTS_0"]).astype(np.int32)
        self.weights = glb.accessor(self.attrs["WEIGHTS_0"]).astype(np.float64)
        self.tris = glb.accessor(prim["indices"]).astype(np.int64).reshape(-1, 3)

        skin = glb.json["skins"][node["skin"]]
        self.joint_nodes = skin["joints"]
        self.names = [glb.json["nodes"][n].get("name") for n in self.joint_nodes]
        self.index = {n: i for i, n in enumerate(self.names)}
        self.ibm = glb.accessor(skin["inverseBindMatrices"]).astype(np.float64).reshape(-1, 4, 4).transpose(0, 2, 1)
        self.rest = rest_globals(glb)
        self.gbind = np.stack([self.rest[n] for n in self.joint_nodes])

        self.dense = np.zeros((len(self.pos), len(self.names)))
        for k in range(4):
            np.add.at(self.dense, (np.arange(len(self.pos)), self.joints[:, k]), self.weights[:, k])

        self.extras = []
        for other in glb.json["nodes"]:
            if "mesh" not in other or other.get("name") == mesh_name:
                continue
            attrs = glb.json["meshes"][other["mesh"]]["primitives"][0]["attributes"]
            prim_other = glb.json["meshes"][other["mesh"]]["primitives"][0]
            ep = glb.accessor(attrs["POSITION"]).astype(np.float64)
            ej = glb.accessor(attrs["JOINTS_0"]).astype(np.int32)
            ew = glb.accessor(attrs["WEIGHTS_0"]).astype(np.float64)
            dense = np.zeros((len(ep), len(self.names)))
            for k in range(4):
                np.add.at(dense, (np.arange(len(ep)), ej[:, k]), ew[:, k])
            self.extras.append({"name": other["name"], "pos": ep, "weights": dense,
                                "tris": glb.accessor(prim_other["indices"]).astype(np.int64).reshape(-1, 3)})

        self.head = {n: self.rest[self.joint_nodes[i]][:3, 3] for n, i in self.index.items()}
        self.tail = {}
        for name, i in self.index.items():
            kids = glb.json["nodes"][self.joint_nodes[i]].get("children", [])
            joint_kids = [k for k in kids if k in self.joint_nodes]
            if joint_kids:
                self.tail[name] = self.rest[joint_kids[0]][:3, 3]
            else:  # leaf: extend along the bone's own local +Y
                self.tail[name] = (self.rest[self.joint_nodes[i]] @ np.array([0, 0.2, 0, 1.0]))[:3]

    # -- skinning ---------------------------------------------------------
    def skin_matrices(self, pose: dict[str, np.ndarray] | None = None) -> np.ndarray:
        g = self.gbind.copy()
        for name, world in (pose or {}).items():
            g[self.index[name]] = world @ g[self.index[name]]
        return g @ self.ibm

    def skinned(self, weights: np.ndarray, pose=None) -> tuple[np.ndarray, np.ndarray]:
        skin = self.skin_matrices(pose)
        pos = np.einsum("vj,jab,vb->va", weights, skin[:, :3, :3], self.pos)
        pos += weights @ skin[:, :3, 3]
        nrm = np.einsum("vj,jab,vb->va", weights, skin[:, :3, :3], self.nrm)
        norms = np.linalg.norm(nrm, axis=1, keepdims=True)
        return pos, nrm / np.where(norms < 1e-9, 1.0, norms)

    # -- arm frame --------------------------------------------------------
    def axis(self, side: str) -> tuple[np.ndarray, np.ndarray, float]:
        a, e = self.head[f"upper_arm.{side}"], self.head[f"forearm.{side}"]
        d = e - a
        length = float(np.linalg.norm(d))
        return a, d / length, length

    def arm_coords(self, side: str, pts: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
        a, d, _ = self.axis(side)
        rel = pts - a
        s = rel @ d
        return s, np.linalg.norm(rel - np.outer(s, d), axis=1)

    def chain_distance(self, side: str, pts: np.ndarray) -> np.ndarray:
        """Distance to the whole arm polyline: shoulder -> elbow -> wrist -> fingertip."""
        nodes = [self.head[f"upper_arm.{side}"], self.head[f"forearm.{side}"],
                 self.head[f"hand.{side}"], self.tail[f"hand.{side}"]]
        best = np.full(len(pts), np.inf)
        for p, q in zip(nodes, nodes[1:]):
            seg = q - p
            t = np.clip(((pts - p) @ seg) / float(seg @ seg), 0.0, 1.0)
            best = np.minimum(best, np.linalg.norm(pts - (p + np.outer(t, seg)), axis=1))
        return best

    # -- poses ------------------------------------------------------------
    def abduction_delta(self, side: str, degrees: float) -> float:
        """Rotation needed to take the rest arm to `degrees` of abduction from hanging down."""
        _, d, _ = self.axis(side)
        rest = math.degrees(math.atan2(abs(d[0]), -d[1]))
        return math.radians(degrees - rest)

    def pose_abduct(self, degrees: float, sides=("L", "R")) -> dict[str, np.ndarray]:
        pose = {}
        for side in sides:
            a, _, _ = self.axis(side)
            sign = 1.0 if side == "L" else -1.0
            world = rotation_about(self.FRONT * sign, self.abduction_delta(side, degrees), a)
            for bone in (f"upper_arm.{side}", f"forearm.{side}", f"hand.{side}"):
                pose[bone] = world
        return pose

    def pose_flex(self, degrees: float, side: str = "L") -> dict[str, np.ndarray]:
        a, _, _ = self.axis(side)
        sign = -1.0 if side == "L" else 1.0
        world = rotation_about(self.RIGHT * sign, math.radians(degrees), a)
        return {f"upper_arm.{side}": world, f"forearm.{side}": world, f"hand.{side}": world}

    def pose_abduct_rhythm(self, degrees: float, clavicle_share: float) -> dict[str, np.ndarray]:
        """Abduction with the clavicle carrying its share, the way a shoulder actually moves."""
        pose = {}
        for side in ("L", "R"):
            a, _, _ = self.axis(side)
            sign = 1.0 if side == "L" else -1.0
            delta = self.abduction_delta(side, degrees)
            axis = self.FRONT * sign
            clavicle = rotation_about(axis, delta * clavicle_share, self.head[f"clavicle.{side}"])
            arm = rotation_about(axis, delta * (1.0 - clavicle_share), a)
            pose[f"clavicle.{side}"] = clavicle
            for bone in (f"upper_arm.{side}", f"forearm.{side}", f"hand.{side}"):
                pose[bone] = clavicle @ arm
        return pose

    def poses(self) -> dict[str, dict]:
        return {
            "bind": {},
            "abduct90": self.pose_abduct(90.0),
            "abduct150": self.pose_abduct(150.0),
            "flex60": self.pose_flex(60.0, "L"),
            "abduct150_rhythm": self.pose_abduct_rhythm(150.0, 0.5),
        }


# ------------------------------------------------------------------ topology

def weld(pos: np.ndarray, tol: int = 5) -> np.ndarray:
    """Map split (normal-seam) vertices onto shared positions."""
    keys = np.round(pos, tol)
    _, inverse = np.unique(keys, axis=0, return_inverse=True)
    return inverse.ravel()


def adjacency(tris: np.ndarray, weld_id: np.ndarray, n_welded: int):
    edges = np.vstack([tris[:, [0, 1]], tris[:, [1, 2]], tris[:, [2, 0]]])
    e = weld_id[edges]
    e = np.vstack([e, e[:, ::-1]])
    e = np.unique(e, axis=0)
    e = e[e[:, 0] != e[:, 1]]
    order = np.argsort(e[:, 0], kind="stable")
    e = e[order]
    starts = np.searchsorted(e[:, 0], np.arange(n_welded + 1))
    return e[:, 1], starts


# ------------------------------------------------------------------ analysis

def smoothstep(x: np.ndarray) -> np.ndarray:
    t = np.clip(x, 0.0, 1.0)
    return t * t * (3.0 - 2.0 * t)


def influence_table(rig: Rig, weights: np.ndarray, threshold: float = 0.01) -> list[dict]:
    rows = []
    for name, j in rig.index.items():
        mask = weights[:, j] > threshold
        row = {"bone": name, "verts": int(mask.sum()), "weight_sum": round(float(weights[:, j].sum()), 2)}
        if mask.any():
            p = rig.pos[mask]
            row["bbox_min"] = [round(float(v), 4) for v in p.min(axis=0)]
            row["bbox_max"] = [round(float(v), 4) for v in p.max(axis=0)]
        rows.append(row)
    return rows


def reach_table(rig: Rig, weights: np.ndarray, threshold: float = 0.05) -> list[dict]:
    rows = []
    for side in ("L", "R"):
        a, _, _ = rig.axis(side)
        sign = 1.0 if side == "L" else -1.0
        for bone in (f"clavicle.{side}", f"upper_arm.{side}"):
            mask = weights[:, rig.index[bone]] > threshold
            if not mask.any():
                rows.append({"bone": bone, "verts": 0})
                continue
            p = rig.pos[mask]
            medial = sign * p[:, 0]
            rows.append({
                "bone": bone,
                "verts": int(mask.sum()),
                "behind_shoulder_cm": round(float((a[2] - p[:, 2]).max()) * 100, 1),
                "medial_min_x_cm": round(float(medial.min()) * 100, 1),
                "below_shoulder_cm": round(float((a[1] - p[:, 1]).max()) * 100, 1),
                "off_chain_verts": int((rig.chain_distance(side, p) > 0.12).sum()),
                "off_chain_max_cm": round(float(rig.chain_distance(side, p).max()) * 100, 1),
            })
    return rows


def deltoid_ring(rig: Rig, side: str, radius: float) -> np.ndarray:
    """Cap band: a short way above the joint down to a third of the upper arm."""
    s, r = rig.arm_coords(side, rig.pos)
    return (s > -0.045) & (s < 0.075) & (r < radius * 1.35)


def deltoid_mix(rig: Rig, weights: np.ndarray, radius: dict) -> list[dict]:
    rows = []
    for side in ("L", "R"):
        ring = deltoid_ring(rig, side, radius[side])
        w = weights[ring]
        share = w.mean(axis=0)
        top = np.argsort(-share)[:6]
        rows.append({
            "side": side,
            "ring_verts": int(ring.sum()),
            "mean_weight": {rig.names[j]: round(float(share[j]), 3) for j in top if share[j] > 0.002},
        })
    return rows


def far_field(rig: Rig) -> np.ndarray:
    """Vertices that belong to neither arm: >12 cm from both arm chains."""
    return (rig.chain_distance("L", rig.pos) > 0.12) & (rig.chain_distance("R", rig.pos) > 0.12)


def displacement(rig: Rig, weights: np.ndarray, pose: dict, subset: np.ndarray) -> dict:
    posed, _ = rig.skinned(weights, pose)
    d = np.linalg.norm(posed[subset] - rig.pos[subset], axis=1)
    return {"verts": int(subset.sum()), "max_cm": round(float(d.max()) * 100, 2),
            "p95_cm": round(float(np.percentile(d, 95)) * 100, 2)}


def armpit_gap(rig: Rig, weights: np.ndarray, pose: dict, side: str, radius: float) -> float:
    """Closest approach between the arm's medial skin and the ribcage under the armpit.

    Measured on a fixed vertex pair-set chosen in bind space, so bind and posed
    numbers are comparable. Sampled below the armpit apex, where the two surfaces
    are actually distinct: at the apex itself they are one continuous sheet and any
    distance measured there is the mesh's edge length, not a gap.
    """
    a, _, _ = rig.axis(side)
    sign = 1.0 if side == "L" else -1.0
    s_arm, r = rig.arm_coords(side, rig.pos)
    slab = (rig.pos[:, 1] > a[1] - 0.19) & (rig.pos[:, 1] < a[1] - 0.07)
    arm_side = slab & (r < radius * 1.2) & (s_arm > 0)
    lateral = sign * rig.pos[:, 0]
    torso_side = slab & (r > radius * 1.6) & (lateral > 0.0) & (lateral < sign * a[0]) & (np.abs(rig.pos[:, 2]) < 0.2)
    if not arm_side.any() or not torso_side.any():
        return float("nan")
    posed, _ = rig.skinned(weights, pose)
    d = np.linalg.norm(posed[arm_side][:, None, :] - posed[torso_side][None, :, :], axis=2)
    return float(d.min())


RING_BAND = (0.02, 0.09)
RING_MEDIAL_EXCLUSION = math.radians(40.0)
RING_BUCKETS = 16


def ring_indices(rig: Rig, side: str, radius: float) -> np.ndarray:
    """The deltoid ring: the arm's own skin over the cap, medial sector dropped.

    Medially the deltoid merges into the trapezius, so that sector has no ring to
    measure; the remaining sectors are the cap surface proper.
    """
    a, d, _ = rig.axis(side)
    s, r = rig.arm_coords(side, rig.pos)
    u = np.cross(d, Rig.UP)
    u /= np.linalg.norm(u)
    v = np.cross(d, u)
    perp = (rig.pos - a) - np.outer(s, d)
    az = np.arctan2(perp @ v, perp @ u)
    medial = -np.sign(a[0]) * Rig.RIGHT
    medial = medial - (medial @ d) * d
    medial /= np.linalg.norm(medial)
    med_az = math.atan2(medial @ v, medial @ u)
    delta = np.abs(((az - med_az + np.pi) % (2 * np.pi)) - np.pi)
    band = (s > RING_BAND[0]) & (s < RING_BAND[1]) & (r < radius * 1.45) & (delta > RING_MEDIAL_EXCLUSION)
    return np.where(band)[0]


def ring_roundness(rig: Rig, weights: np.ndarray, pose: dict, side: str, radius: float) -> dict:
    """Max/min outer radius of the deltoid ring about the posed upper-arm axis."""
    ring = ring_indices(rig, side, radius)
    posed, _ = rig.skinned(weights, pose)
    a, d, _ = rig.axis(side)
    world = pose.get(f"upper_arm.{side}", np.eye(4))
    a_p = (world @ np.append(a, 1.0))[:3]
    d_p = world[:3, :3] @ d
    u = np.cross(d_p, Rig.UP)
    u /= np.linalg.norm(u)
    v = np.cross(d_p, u)
    rel = posed[ring] - a_p
    perp = rel - np.outer(rel @ d_p, d_p)
    r = np.linalg.norm(perp, axis=1)
    az = np.arctan2(perp @ v, perp @ u)
    bucket = np.clip(np.digitize(az, np.linspace(-np.pi, np.pi, RING_BUCKETS + 1)) - 1, 0, RING_BUCKETS - 1)
    outer = np.array([r[bucket == k].max() for k in range(RING_BUCKETS) if (bucket == k).any()])
    return {"verts": len(ring), "sectors": len(outer),
            "ratio": round(float(outer.max() / max(outer.min(), 1e-6)), 3),
            "min_cm": round(float(outer.min()) * 100, 2), "max_cm": round(float(outer.max()) * 100, 2)}


def normal_inversions(rig: Rig, weights: np.ndarray, pose: dict, side: str, radius: float) -> int:
    """Cap vertices whose posed geometric normal has flipped against the skinned bind normal."""
    ring = deltoid_ring(rig, side, radius)
    posed, lbs = rig.skinned(weights, pose)
    tri = rig.tris
    e1 = posed[tri[:, 1]] - posed[tri[:, 0]]
    e2 = posed[tri[:, 2]] - posed[tri[:, 0]]
    face = np.cross(e1, e2)
    geo = np.zeros_like(posed)
    for k in range(3):
        np.add.at(geo, tri[:, k], face)
    n = np.linalg.norm(geo, axis=1, keepdims=True)
    geo = geo / np.where(n < 1e-12, 1.0, n)
    return int((np.einsum("va,va->v", geo[ring], lbs[ring]) < 0).sum())


# ------------------------------------------------------------------ cleaning

def arm_radius(rig: Rig, side: str) -> float:
    """Upper-arm thickness read off the vertices the rig already agrees are arm."""
    s, r = rig.arm_coords(side, rig.pos)
    core = (rig.dense[:, rig.index[f"upper_arm.{side}"]] > 0.9) & (s > 0.5 * rig.axis(side)[2])
    if core.sum() < 20:
        core = (rig.dense[:, rig.index[f"upper_arm.{side}"]] > 0.7) & (s > 0.4 * rig.axis(side)[2])
    return float(np.percentile(r[core], 98))


def normalise_top4(weights: np.ndarray) -> np.ndarray:
    w = np.clip(weights, 0.0, None)
    keep = np.argsort(-w, axis=1)[:, :4]
    out = np.zeros_like(w)
    rows = np.arange(len(w))[:, None]
    out[rows, keep] = w[rows, keep]
    total = out.sum(axis=1, keepdims=True)
    return out / np.where(total < 1e-12, 1.0, total)


def redistribute(rig: Rig, w: np.ndarray, freed: np.ndarray, band: float = 0.06) -> None:
    """Give reclaimed weight back to chest (upper back / pectoral) or spine (lower back)."""
    split_y = rig.head["chest"][1]
    to_chest = smoothstep((rig.pos[:, 1] - (split_y - band)) / (2 * band))
    w[:, rig.index["chest"]] += freed * to_chest
    w[:, rig.index["spine"]] += freed * (1.0 - to_chest)


def shoulder_keep(rig: Rig, side: str, radius: float, params: dict) -> dict:
    """Where upper_arm and clavicle are allowed to hold weight at all."""
    a, d, length = rig.axis(side)
    sign = 1.0 if side == "L" else -1.0
    s, r = rig.arm_coords(side, rig.pos)
    deltoid_top = -params["deltoid_reach"]

    # The capsule is elliptical, not round: the deltoid bulges laterally, while
    # medially the chest starts within a few centimetres of the joint.
    perp = (rig.pos - a) - np.outer(s, d)
    lateral = np.sign(a[0]) * Rig.RIGHT
    lateral = lateral - (lateral @ d) * d
    lateral /= np.linalg.norm(lateral)
    facing = (perp @ lateral) / np.maximum(r, 1e-9)
    cap_r = radius * (params["capsule_scale"] + params["capsule_bulge"] * np.clip(facing, 0.0, 1.0))

    # upper_arm: a capsule around its own bone, reaching a short way up into the deltoid
    radial = 1.0 - smoothstep((r - cap_r) / params["radial_fade"])
    axial = smoothstep((s - deltoid_top) / params["axial_fade"])
    keep_ua = np.clip(radial * axial, 0.0, 1.0)
    distal = s > 0.25 * length
    keep_ua[distal] = np.maximum(keep_ua[distal], radial[distal])

    # clavicle: shoulder cap and collarbone only - nothing under the armpit line and
    # nothing on the back below the scapula line
    armpit_y = a[1] - params["armpit_drop"]
    scapula_y = a[1] - params["scapula_drop"]
    above_armpit = smoothstep((rig.pos[:, 1] - armpit_y) / params["armpit_fade"])
    on_back = smoothstep((a[2] - params["back_plane"] - rig.pos[:, 2]) / params["back_fade"])
    below_scapula = 1.0 - smoothstep((rig.pos[:, 1] - scapula_y) / params["armpit_fade"])
    own_side = 1.0 - smoothstep((-sign * rig.pos[:, 0] - params["clavicle_crossover"]) / params["clavicle_crossover_fade"])
    keep_cl = np.clip(above_armpit * (1.0 - on_back * below_scapula) * own_side, 0.0, 1.0)

    cap = (s > deltoid_top) & (s < params["cap_bottom"]) & (r < cap_r)
    return {"keep_ua": keep_ua, "keep_cl": keep_cl, "cap": cap, "s": s, "r": r,
            "cap_r": cap_r, "deltoid_top": deltoid_top, "radius": radius,
            "armpit_y": armpit_y, "scapula_y": scapula_y}


def confine(rig: Rig, w: np.ndarray, side: str, keep: dict, ceiling: dict | None) -> np.ndarray:
    """Strip out-of-region weight and hand it to chest or spine. Idempotent when a
    ceiling from the first pass is supplied, so weight smoothing cannot re-grow it."""
    ua, cl = rig.index[f"upper_arm.{side}"], rig.index[f"clavicle.{side}"]
    if ceiling is None:
        new_ua, new_cl = w[:, ua] * keep["keep_ua"], w[:, cl] * keep["keep_cl"]
    else:
        new_ua = np.minimum(w[:, ua], ceiling["ua"])
        new_cl = np.minimum(w[:, cl], ceiling["cl"])
    freed = (w[:, ua] - new_ua) + (w[:, cl] - new_cl)
    w[:, ua], w[:, cl] = new_ua, new_cl
    redistribute(rig, w, freed)
    return freed


def blend_cap(rig: Rig, w: np.ndarray, side: str, keep: dict, params: dict) -> None:
    """The deltoid cap becomes a clean clavicle -> upper_arm blend with chest fading out."""
    cap, s, r = keep["cap"], keep["s"], keep["r"]
    if not cap.any():
        return
    ua, cl = rig.index[f"upper_arm.{side}"], rig.index[f"clavicle.{side}"]
    t = smoothstep((s[cap] - keep["deltoid_top"]) / (params["clavicle_handoff"] - keep["deltoid_top"]))
    inner = keep["radius"] * params["cap_core"]
    mix = np.clip(1.0 - smoothstep((r[cap] - inner) / np.maximum(keep["cap_r"][cap] - inner, 1e-6)), 0.0, 1.0)
    mix *= params["cap_authority"]
    target = np.zeros((int(cap.sum()), w.shape[1]))
    target[:, ua] = t
    target[:, cl] = 1.0 - t
    w[cap] = w[cap] * (1.0 - mix[:, None]) + target * mix[:, None]


def clean_hip(rig: Rig, w: np.ndarray, side: str, params: dict) -> dict:
    """Same capsule confinement at the hip: thigh keeps the leg plus a margin into the glute."""
    hip, knee = rig.head[f"thigh.{side}"], rig.head[f"shin.{side}"]
    d = knee - hip
    length = float(np.linalg.norm(d))
    d = d / length
    rel = rig.pos - hip
    s = rel @ d
    r = np.linalg.norm(rel - np.outer(s, d), axis=1)
    th = rig.index[f"thigh.{side}"]
    core = (rig.dense[:, th] > 0.9) & (s > 0.4 * length)
    radius = float(np.percentile(r[core], 98)) if core.sum() > 20 else 0.11
    cap_r = radius * params["capsule_scale"]
    radial = 1.0 - smoothstep((r - cap_r) / params["radial_fade"])
    keep = np.clip(radial * smoothstep((s + params["glute_reach"]) / params["axial_fade"]), 0.0, 1.0)
    distal = s > 0.25 * length
    keep[distal] = np.maximum(keep[distal], radial[distal])
    stripped = int(((w[:, th] > 0.05) & (keep < 0.5)).sum())
    freed = w[:, th] * (1.0 - keep)
    w[:, th] *= keep
    w[:, rig.index["pelvis"]] += freed
    return {"thigh_stripped": stripped, "thigh_radius_cm": round(radius * 100, 2),
            "capsule_cm": round(cap_r * 100, 2)}


def smooth_band(rig: Rig, w: np.ndarray, centres: list[np.ndarray], reach: float, iterations: int) -> None:
    weld_id = weld(rig.pos)
    n_welded = int(weld_id.max()) + 1
    nbr, starts = adjacency(rig.tris, weld_id, n_welded)
    counts = np.diff(starts)

    dist = np.full(len(rig.pos), np.inf)
    for c in centres:
        dist = np.minimum(dist, np.linalg.norm(rig.pos - c, axis=1))
    strength = 1.0 - smoothstep((dist - reach * 0.55) / (reach * 0.45))

    # collapse onto welded vertices so seams smooth as one surface
    welded = np.zeros((n_welded, w.shape[1]))
    np.add.at(welded, weld_id, w)
    shares = np.bincount(weld_id, minlength=n_welded)[:, None]
    welded /= shares
    w_strength = np.zeros(n_welded)
    np.maximum.at(w_strength, weld_id, strength)

    src = np.repeat(np.arange(n_welded), counts)
    for _ in range(iterations):
        summed = np.zeros_like(welded)
        np.add.at(summed, src, welded[nbr])
        avg = summed / np.maximum(counts, 1)[:, None]
        welded = welded + w_strength[:, None] * (avg - welded)
    w[:] = welded[weld_id]


# -------------------------------------------------------------------- render

# eye and target in the GLB's own frame: Y up, +Z the way the body faces
CAMERAS = {
    "back": ((0.0, 1.05, -2.60), (0.0, 1.05, 0.0), 45.0),
    "front34": ((-1.70, 1.25, 2.00), (0.0, 1.05, 0.0), 45.0),
    "shoulder_above_behind": ((0.45, 1.95, -0.70), (0.19, 1.35, -0.02), 50.0),
}


def render_pose(rig: Rig, weights: np.ndarray, pose: dict, camera: str, out_path: str, res: int = 720) -> None:
    import bpy

    for kind in (bpy.data.objects, bpy.data.meshes, bpy.data.cameras, bpy.data.lights):
        for item in list(kind):
            kind.remove(item)
    scene = bpy.context.scene
    mat = bpy.data.materials.new("Clay")
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes["Principled BSDF"]
    bsdf.inputs["Base Color"].default_value = (0.62, 0.60, 0.58, 1.0)
    bsdf.inputs["Roughness"].default_value = 0.55

    skin = rig.skin_matrices(pose)
    parts = [("Body", rig.pos, weights, rig.tris)]
    parts += [(e["name"], e["pos"], e["weights"], e["tris"]) for e in rig.extras]
    for name, rest_pos, part_weights, tris in parts:
        posed = np.einsum("vj,jab,vb->va", part_weights, skin[:, :3, :3], rest_pos)
        posed += part_weights @ skin[:, :3, 3]
        verts = np.stack([posed[:, 0], -posed[:, 2], posed[:, 1]], axis=1)  # glTF Y-up -> Blender Z-up
        mesh = bpy.data.meshes.new(name)
        mesh.from_pydata([tuple(v) for v in verts], [], [tuple(t) for t in tris])
        mesh.update()
        mesh.shade_smooth()
        obj = bpy.data.objects.new(name, mesh)
        obj.data.materials.append(mat)
        scene.collection.objects.link(obj)

    eye, target, lens = CAMERAS[camera]
    eye_b = (eye[0], -eye[2], eye[1])
    tgt_b = (target[0], -target[2], target[1])
    cam_data = bpy.data.cameras.new("Cam")
    cam_data.lens = lens
    cam = bpy.data.objects.new("Cam", cam_data)
    cam.location = eye_b
    direction = np.array(tgt_b) - np.array(eye_b)
    import mathutils
    cam.rotation_euler = mathutils.Vector(direction).to_track_quat('-Z', 'Y').to_euler()
    scene.collection.objects.link(cam)
    scene.camera = cam

    for loc, energy in (((2.5, -3.0, 3.5), 900.0), ((-3.0, 2.5, 2.0), 400.0), ((0.0, 3.0, 1.5), 300.0)):
        light = bpy.data.lights.new("L", type='POINT')
        light.energy = energy
        lo = bpy.data.objects.new("L", light)
        lo.location = loc
        scene.collection.objects.link(lo)

    scene.render.engine = 'BLENDER_EEVEE_NEXT' if 'BLENDER_EEVEE_NEXT' in \
        {i.identifier for i in bpy.types.RenderSettings.bl_rna.properties['engine'].enum_items} else 'BLENDER_WORKBENCH'
    scene.render.resolution_x = res
    scene.render.resolution_y = res
    scene.render.film_transparent = False
    scene.world = bpy.data.worlds.new("W")
    scene.world.use_nodes = True
    scene.world.node_tree.nodes["Background"].inputs[0].default_value = (0.09, 0.10, 0.12, 1.0)
    scene.render.filepath = out_path
    scene.render.image_settings.file_format = 'PNG'
    bpy.ops.render.render(write_still=True)


def contact_sheet(paths: list[list[str]], out_path: str) -> None:
    import bpy

    rows = []
    for row in paths:
        tiles = []
        for p in row:
            img = bpy.data.images.load(p)
            w, h = img.size
            px = np.array(img.pixels[:]).reshape(h, w, 4)
            tiles.append(px)
            bpy.data.images.remove(img)
        rows.append(np.concatenate(tiles, axis=1))
    sheet = np.concatenate(rows[::-1], axis=0)  # bpy pixel rows run bottom-up
    out = bpy.data.images.new("sheet", width=sheet.shape[1], height=sheet.shape[0], alpha=True)
    out.pixels = sheet.ravel().tolist()
    out.filepath_raw = out_path
    out.file_format = 'PNG'
    out.save()
    bpy.data.images.remove(out)


# --------------------------------------------------------------------- verify

def verify(original: str, cleaned: str) -> dict:
    a, b = Glb(original), Glb(cleaned)
    issues = []
    if len(a.raw) != len(b.raw):
        issues.append(f"file length {len(a.raw)} != {len(b.raw)}")
    ja, jb = json.dumps(a.json, sort_keys=True), json.dumps(b.json, sort_keys=True)
    if ja != jb:
        issues.append("glTF JSON chunk differs")
    node = a.mesh_node("Body")
    prim_a = a.json["meshes"][node["mesh"]]["primitives"][0]
    changed = {prim_a["attributes"]["JOINTS_0"], prim_a["attributes"]["WEIGHTS_0"]}
    for i in range(len(a.json["accessors"])):
        if i in changed:
            continue
        x, y = a.accessor(i), b.accessor(i)
        if x.shape != y.shape:
            issues.append(f"accessor {i} shape changed")
        elif x.dtype.kind == "f":
            delta = float(np.abs(x.astype(np.float64) - y.astype(np.float64)).max()) if x.size else 0.0
            if delta > 1e-6:
                issues.append(f"accessor {i} float delta {delta}")
        elif not np.array_equal(x, y):
            issues.append(f"accessor {i} bytes changed")
    skin_a, skin_b = a.json["skins"][0], b.json["skins"][0]
    if skin_a["joints"] != skin_b["joints"]:
        issues.append("joint list changed")
    ibm_a = a.accessor(skin_a["inverseBindMatrices"]).astype(np.float64)
    ibm_b = b.accessor(skin_b["inverseBindMatrices"]).astype(np.float64)
    ibm_delta = float(np.abs(ibm_a - ibm_b).max())
    pos_a = a.accessor(prim_a["attributes"]["POSITION"])
    pos_b = b.accessor(prim_a["attributes"]["POSITION"])
    names_a = [n.get("name") for n in a.json["nodes"]]
    names_b = [n.get("name") for n in b.json["nodes"]]
    new_j = b.accessor(prim_a["attributes"]["JOINTS_0"]).astype(np.int32)
    new_w = b.accessor(prim_a["attributes"]["WEIGHTS_0"]).astype(np.float64)
    old_w = a.accessor(prim_a["attributes"]["WEIGHTS_0"]).astype(np.float64)
    weight_sum_error = float(np.abs(new_w.sum(axis=1) - 1.0).max())
    if weight_sum_error > 1e-5:
        issues.append(f"weights do not sum to 1 (max error {weight_sum_error})")
    if int(new_j.max()) >= len(skin_b["joints"]):
        issues.append("joint index out of range")
    spans = sorted(a.accessor_span(prim_a["attributes"][k]) for k in ("JOINTS_0", "WEIGHTS_0"))
    allowed = bytearray(len(a.raw))
    for start, length in spans:
        allowed[start:start + length] = b"\x01" * length
    stray = [i for i in range(min(len(a.raw), len(b.raw))) if a.raw[i] != b.raw[i] and not allowed[i]]
    if stray:
        issues.append(f"{len(stray)} bytes changed outside JOINTS_0/WEIGHTS_0, first at {stray[0]}")
    return {
        "bytes_changed_outside_skin_data": len(stray),
        "skin_data_byte_spans": [[start, length] for start, length in spans],
        "vertices_reweighted": int((np.abs(new_w - old_w).max(axis=1) > 1e-6).sum()),
        "weight_sum_max_error": weight_sum_error,
        "max_influences_per_vertex": int((new_w > 0).sum(axis=1).max()),
        "node_names_identical": names_a == names_b,
        "joint_list_identical": skin_a["joints"] == skin_b["joints"],
        "inverse_bind_max_delta": ibm_delta,
        "positions_bitwise_identical": bool(np.array_equal(pos_a, pos_b)),
        "json_chunk_identical": ja == jb,
        "file_size": [len(a.raw), len(b.raw)],
        "issues": issues,
        "ok": not issues and ibm_delta <= 1e-6 and bool(np.array_equal(pos_a, pos_b)),
    }


# ----------------------------------------------------------------------- main

PARAMS = {
    "capsule_scale": 1.20,
    "capsule_bulge": 0.90,
    "radial_fade": 0.045,
    "deltoid_reach": 0.070,
    "axial_fade": 0.055,
    "cap_bottom": 0.100,
    "clavicle_handoff": 0.050,
    "cap_authority": 0.70,
    "cap_core": 0.60,
    "clavicle_crossover": 0.010,
    "clavicle_crossover_fade": 0.045,
    "armpit_drop": 0.075,
    "armpit_fade": 0.045,
    "scapula_drop": 0.020,
    "back_plane": 0.020,
    "back_fade": 0.050,
    "glute_reach": 0.040,
    "smooth_reach": 0.13,
    "smooth_iterations": 8,
    "smooth_cycles": 3,
}


def build_clean(rig: Rig, params: dict) -> tuple[np.ndarray, dict]:
    w = rig.dense.copy()
    radius = {side: arm_radius(rig, side) for side in ("L", "R")}
    keeps = {side: shoulder_keep(rig, side, radius[side], params) for side in ("L", "R")}
    log = {"arm_radius_cm": {s: round(radius[s] * 100, 2) for s in radius}, "shoulder": {}, "hip": {}}

    for side in ("L", "R"):
        keep = keeps[side]
        ua, cl = rig.index[f"upper_arm.{side}"], rig.index[f"clavicle.{side}"]
        before_ua, before_cl = w[:, ua].copy(), w[:, cl].copy()
        confine(rig, w, side, keep, None)
        blend_cap(rig, w, side, keep, params)
        log["shoulder"][side] = {
            "upper_arm_stripped": int(((before_ua > 0.05) & (keep["keep_ua"] < 0.5)).sum()),
            "clavicle_stripped": int(((before_cl > 0.05) & (keep["keep_cl"] < 0.5)).sum()),
            "cap_verts": int(keep["cap"].sum()),
            "arm_radius_cm": round(radius[side] * 100, 2),
            "capsule_cm": [round(float(keep["cap_r"].min()) * 100, 2), round(float(keep["cap_r"].max()) * 100, 2)],
            "armpit_y": round(float(keep["armpit_y"]), 4),
            "scapula_y": round(float(keep["scapula_y"]), 4),
        }
    for side in ("L", "R"):
        log["hip"][side] = clean_hip(rig, w, side, params)
    w = normalise_top4(w)

    ceiling = {side: {"ua": np.maximum(w[:, rig.index[f"upper_arm.{side}"]], keeps[side]["keep_ua"]),
                      "cl": np.maximum(w[:, rig.index[f"clavicle.{side}"]], keeps[side]["keep_cl"])}
               for side in ("L", "R")}
    centres = [rig.head[f"upper_arm.{s}"] for s in ("L", "R")]
    for _ in range(params["smooth_cycles"]):
        smooth_band(rig, w, centres, params["smooth_reach"], params["smooth_iterations"])
        for side in ("L", "R"):
            confine(rig, w, side, keeps[side], ceiling[side])
            blend_cap(rig, w, side, keeps[side], params)
        w = normalise_top4(w)
    return w, log


def pack(rig: Rig, w: np.ndarray) -> tuple[bytes, bytes]:
    order = np.argsort(-w, axis=1, kind="stable")[:, :4]
    rows = np.arange(len(w))[:, None]
    vals = w[rows, order]
    total = vals.sum(axis=1, keepdims=True)
    vals = vals / np.where(total < 1e-12, 1.0, total)
    joints = np.where(vals > 0, order, 0).astype(np.uint8)
    return joints.tobytes(), vals.astype(np.float32).tobytes()


def main() -> None:
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else sys.argv[1:]
    ap = argparse.ArgumentParser()
    ap.add_argument("--input", required=True)
    ap.add_argument("--outdir", required=True)
    ap.add_argument("--stage", default="all")
    ap.add_argument("--no-render", action="store_true")
    args = ap.parse_args(argv)

    os.makedirs(args.outdir, exist_ok=True)
    glb = Glb(args.input)
    rig = Rig(glb)
    radius = {s: arm_radius(rig, s) for s in ("L", "R")}
    poses = rig.poses()
    field = far_field(rig)
    report: dict = {"input": args.input, "body_verts": int(len(rig.pos))}

    check = np.abs(rig.skinned(rig.dense, {})[0] - rig.pos).max()
    report["bind_roundtrip_max_error"] = float(check)

    def measure(weights: np.ndarray) -> dict:
        return {
            "influence": influence_table(rig, weights),
            "reach": reach_table(rig, weights),
            "deltoid_mix": deltoid_mix(rig, weights, radius),
            "displacement": {k: displacement(rig, weights, p, field) for k, p in poses.items()
                             if k not in ("bind", "abduct150_rhythm")},
            "armpit_gap_cm": {k: {s: round(armpit_gap(rig, weights, poses[k], s, radius[s]) * 100, 2)
                                  for s in ("L", "R")} for k in ("bind", "abduct90", "abduct150")},
            "ring": {f"{k}_{s}": ring_roundness(rig, weights, poses[k], s, radius[s])
                     for k in ("bind", "abduct90", "abduct150") for s in ("L", "R")},
            "normal_inversions": {f"{k}_{s}": normal_inversions(rig, weights, poses[k], s, radius[s])
                                  for k in ("abduct90", "abduct150", "abduct150_rhythm") for s in ("L", "R")},
        }

    report["before"] = measure(rig.dense)
    report["before"]["far_field_verts"] = int(field.sum())
    cleaned, log = build_clean(rig, PARAMS)
    report["params"] = PARAMS
    report["clean_log"] = log
    report["after"] = measure(cleaned)

    after = report["after"]
    bind_ring = max(v["ratio"] for k, v in after["ring"].items() if k.startswith("bind"))
    posed_ring = max(v["ratio"] for k, v in after["ring"].items() if k.startswith("abduct9"))
    gates = {
        "displacement_90_max_under_3cm": after["displacement"]["abduct90"]["max_cm"] <= 3.0,
        "displacement_150_max_under_5cm": after["displacement"]["abduct150"]["max_cm"] <= 5.0,
        "displacement_flex60_max_under_5cm": after["displacement"]["flex60"]["max_cm"] <= 5.0,
        "armpit_gap_90_over_1cm": all(v > 1.0 for v in after["armpit_gap_cm"]["abduct90"].values()),
        "ring_ratio_90_under_1_4": posed_ring < 1.4,
        "ring_ratio_90_no_worse_than_bind": posed_ring <= bind_ring * 1.10,
        "no_normal_inversions_90": all(v == 0 for k, v in after["normal_inversions"].items() if k.startswith("abduct90")),
        "no_normal_inversions_150_rigid_clavicle": all(after["normal_inversions"][f"abduct150_{s}"] == 0 for s in ("L", "R")),
        "no_normal_inversions_150_shoulder_rhythm": all(after["normal_inversions"][f"abduct150_rhythm_{s}"] == 0 for s in ("L", "R")),
    }
    report["gates"] = gates
    report["gates_pass"] = all(gates.values())
    report["bind_ring_ratio"] = bind_ring

    joints_blob, weights_blob = pack(rig, cleaned)
    out_glb = os.path.join(args.outdir, os.path.basename(args.input))
    glb.write_patched(out_glb, [
        (glb.accessor_span(rig.attrs["JOINTS_0"])[0], joints_blob),
        (glb.accessor_span(rig.attrs["WEIGHTS_0"])[0], weights_blob),
    ])
    report["output_glb"] = out_glb
    report["verify"] = verify(args.input, out_glb)

    if not args.no_render:
        shots = []
        for tag, weights in (("before", rig.dense), ("after", cleaned)):
            for pose_name in ("bind", "abduct90", "abduct150", "flex60"):
                for cam in ("back", "front34", "shoulder_above_behind"):
                    path = os.path.join(args.outdir, f"{tag}-{pose_name}-{cam}.png")
                    render_pose(rig, weights, poses[pose_name], cam, path)
                    shots.append(path)
        report["renders"] = shots
        for cam in ("back", "front34", "shoulder_above_behind"):
            contact_sheet(
                [[os.path.join(args.outdir, f"{t}-{p}-{cam}.png") for p in ("bind", "abduct90", "abduct150", "flex60")]
                 for t in ("before", "after")],
                os.path.join(args.outdir, f"contact-{cam}.png"))

    with open(os.path.join(args.outdir, "report.json"), "w") as f:
        json.dump(report, f, indent=1)
    print(json.dumps({k: report[k] for k in ("gates", "gates_pass", "verify")}, indent=1))
    print("REPORT", os.path.join(args.outdir, "report.json"))


if __name__ == "__main__":
    main()
