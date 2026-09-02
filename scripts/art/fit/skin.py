"""A skinned body as numbers: dense weights, bind transforms, and stress poses.

Everything downstream of the export measures the runtime file rather than the
Blender scene, because the runtime file is what ships. This is the view of it:
one dense vertex-by-bone weight matrix per mesh region, the bind transforms
from the skin itself, and the poses the deformation gates are measured in.

Poses are built as world-space rotations about a pivot, so nothing here depends
on a bone's local axes and the gates read the same before and after the rest
orientation is neutralised.
"""

from __future__ import annotations

import math

import numpy as np

from .glb import Glb

FRONT = np.array([0.0, 0.0, 1.0])
LATERAL = np.array([1.0, 0.0, 0.0])
# The fraction of the upper arm's rotation a shoulder helper takes, matched in
# src/render/semanticskeleton.ts; the gates measure what the runtime will show.
HELPER_SHARE = 0.5


def rotation_about(axis: np.ndarray, angle: float, pivot: np.ndarray) -> np.ndarray:
    axis = axis / np.linalg.norm(axis)
    cosine, sine = math.cos(angle), math.sin(angle)
    cross = np.array([[0, -axis[2], axis[1]], [axis[2], 0, -axis[0]], [-axis[1], axis[0], 0]])
    turn = np.eye(3) * cosine + sine * cross + (1 - cosine) * np.outer(axis, axis)
    matrix = np.eye(4)
    matrix[:3, :3] = turn
    matrix[:3, 3] = pivot - turn @ pivot
    return matrix


class Body:
    """The skinned regions of a GLB, keyed by the family's semantic roles."""

    def __init__(self, glb: Glb, contract: dict, primary: str = "Body") -> None:
        self.glb = glb
        self.bone = {spec["role"]: spec["name"] for spec in contract["bones"] if spec.get("role")}
        skinned = [node for node in glb.json["nodes"] if node.get("skin") is not None]
        if not skinned:
            raise RuntimeError("skin gate: the file has no skinned mesh")
        skin = glb.json["skins"][skinned[0]["skin"]]
        self.names = [glb.json["nodes"][node].get("name") for node in skin["joints"]]
        self.index = {name: at for at, name in enumerate(self.names)}
        self.inverse_bind = glb.accessor(skin["inverseBindMatrices"]).astype(np.float64).reshape(-1, 4, 4).transpose(0, 2, 1)
        world = glb.globals()
        self.global_bind = np.stack([world[node] for node in skin["joints"]])
        self.head = {name: self.global_bind[at][:3, 3] for name, at in self.index.items()}

        self.regions = []
        for node in skinned:
            name = node.get("name", "")
            primitive = glb.json["meshes"][node["mesh"]]["primitives"][0]
            attributes = primitive["attributes"]
            positions = glb.accessor(attributes["POSITION"]).astype(np.float64)
            joints = glb.accessor(attributes["JOINTS_0"]).astype(np.int32)
            weights = glb.accessor(attributes["WEIGHTS_0"]).astype(np.float64)
            dense = np.zeros((len(positions), len(self.names)))
            for lane in range(joints.shape[1]):
                np.add.at(dense, (np.arange(len(positions)), joints[:, lane]), weights[:, lane])
            self.regions.append({
                "name": name,
                "attributes": attributes,
                "positions": positions,
                "normals": glb.accessor(attributes["NORMAL"]).astype(np.float64),
                "triangles": glb.accessor(primitive["indices"]).astype(np.int64).reshape(-1, 3),
                "weights": dense,
            })
        self.primary = next((region for region in self.regions if region["name"].startswith(primary)),
                            self.regions[0])
        self.positions = self.primary["positions"]
        self.normals = self.primary["normals"]
        self.triangles = self.primary["triangles"]

    def skin_matrices(self, pose: dict | None = None) -> np.ndarray:
        posed = self.global_bind.copy()
        for name, world in (pose or {}).items():
            posed[self.index[name]] = world @ posed[self.index[name]]
        return posed @ self.inverse_bind

    def skinned(self, weights: np.ndarray, pose=None, positions=None, normals=None):
        matrices = self.skin_matrices(pose)
        source = self.positions if positions is None else positions
        moved = np.einsum("vj,jab,vb->va", weights, matrices[:, :3, :3], source) + weights @ matrices[:, :3, 3]
        if normals is None:
            normals = self.normals if positions is None else None
        if normals is None:
            return moved, None
        turned = np.einsum("vj,jab,vb->va", weights, matrices[:, :3, :3], normals)
        length = np.linalg.norm(turned, axis=1, keepdims=True)
        return moved, turned / np.where(length < 1e-9, 1.0, length)

    # -- the arm frame the stress poses and the region clean both work in ----
    def arm_axis(self, side: str):
        shoulder = self.head[self.bone[f"shoulder.{side.lower()}"]]
        elbow = self.head[self.bone[f"elbow.{side.lower()}"]]
        direction = elbow - shoulder
        length = float(np.linalg.norm(direction))
        return shoulder, direction / length, length

    def arm_coords(self, side: str, points: np.ndarray):
        shoulder, direction, _ = self.arm_axis(side)
        relative = points - shoulder
        along = relative @ direction
        return along, np.linalg.norm(relative - np.outer(along, direction), axis=1)

    def chain_distance(self, side: str, points: np.ndarray) -> np.ndarray:
        lowered = side.lower()
        nodes = [self.head[self.bone[f"{role}.{lowered}"]] for role in ("shoulder", "elbow", "hand")]
        nodes.append(nodes[-1] + (nodes[-1] - nodes[-2]) * 0.6)
        best = np.full(len(points), np.inf)
        for start, end in zip(nodes, nodes[1:]):
            segment = end - start
            along = np.clip(((points - start) @ segment) / float(segment @ segment), 0.0, 1.0)
            best = np.minimum(best, np.linalg.norm(points - (start + np.outer(along, segment)), axis=1))
        return best

    def far_field(self) -> np.ndarray:
        """Vertices that belong to neither arm, and so must not move when one does."""
        return (self.chain_distance("L", self.positions) > 0.12) & (self.chain_distance("R", self.positions) > 0.12)

    # -- stress poses -------------------------------------------------------
    def _abduction_delta(self, side: str, degrees: float) -> float:
        _, direction, _ = self.arm_axis(side)
        rest = math.degrees(math.atan2(abs(direction[0]), -direction[1]))
        return math.radians(degrees - rest)

    def _arm_bones(self, side: str) -> list[str]:
        lowered = side.lower()
        return [self.bone[f"{role}.{lowered}"] for role in ("shoulder", "elbow", "hand")]

    def helper_names(self, side: str) -> dict[str, str]:
        """The helpers this body carries for one arm, keyed shoulder or twist."""
        found = {}
        for kind, prefix in (("shoulder", "shoulder_helper_"), ("twist", "twist_upper_arm_")):
            name = f"{prefix}{side}"
            if name in self.index:
                found[kind] = name
        return found

    def _arm_pose(self, pose: dict, side: str, axis: np.ndarray, angle: float, pivot: np.ndarray,
                  frame: np.ndarray | None = None) -> None:
        """Turn one arm about a pivot, the way the runtime drives it.

        The shoulder helper turns by half the angle so the cap it carries follows
        the arm at half rate; the twist helper is rigid with the upper arm, since
        a turn about a pivot carries no axial twist.
        """
        full = rotation_about(axis, angle, pivot)
        half = rotation_about(axis, angle * HELPER_SHARE, pivot)
        if frame is not None:
            full, half = frame @ full, frame @ half
        for bone in self._arm_bones(side):
            pose[bone] = full
        helpers = self.helper_names(side)
        if "twist" in helpers:
            pose[helpers["twist"]] = full
        if "shoulder" in helpers:
            pose[helpers["shoulder"]] = half

    def abduct(self, degrees: float) -> dict:
        pose = {}
        for side in ("L", "R"):
            shoulder, _, _ = self.arm_axis(side)
            self._arm_pose(pose, side, FRONT * (1.0 if side == "L" else -1.0),
                           self._abduction_delta(side, degrees), shoulder)
        return pose

    def abduct_with_clavicle(self, degrees: float, share: float) -> dict:
        pose = {}
        for side in ("L", "R"):
            shoulder, _, _ = self.arm_axis(side)
            axis = FRONT * (1.0 if side == "L" else -1.0)
            delta = self._abduction_delta(side, degrees)
            clavicle_bone = self.bone[f"clavicle.{side.lower()}"]
            clavicle = rotation_about(axis, delta * share, self.head[clavicle_bone])
            pose[clavicle_bone] = clavicle
            self._arm_pose(pose, side, axis, delta * (1.0 - share), shoulder, frame=clavicle)
        return pose

    def flex(self, degrees: float, side: str = "L") -> dict:
        shoulder, _, _ = self.arm_axis(side)
        pose = {}
        self._arm_pose(pose, side, LATERAL * (-1.0 if side == "L" else 1.0), math.radians(degrees), shoulder)
        return pose

    def poses(self, share: float) -> dict:
        return {"bind": {}, "abduct90": self.abduct(90.0), "abduct150": self.abduct(150.0),
                "abduct180": self.abduct(180.0), "flex60": self.flex(60.0, "L"),
                "abduct150_rhythm": self.abduct_with_clavicle(150.0, share),
                "abduct180_rhythm": self.abduct_with_clavicle(180.0, share)}
