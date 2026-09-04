"""Which body region every vertex of a fitted piece lies against.

A hide rule names contract regions, and those rules apply one layer up as well as
onto the skin: a belt that hides the waist band drops the tunic's triangles under its
strap whatever the pose, instead of asking at runtime whether one surface happens to
be buried in the other. That needs a piece to carry the same tag the body's own
vertices carry, so the tag is taken here, at fit time.

It is read off the exported runtime file rather than off Blender's mesh on purpose:
the runtime masks by the indices the GLB ships, and the glTF exporter splits a vertex
wherever a normal or a UV seam does, so a Blender index is not a runtime one.
"""

from __future__ import annotations

import numpy as np

from fit.glb import Glb

# Past this the nearest body vertex is not what the piece is lying against - a
# hanging sash, a pouch standing off the hip - and the piece vertex is left untagged.
REACH = 0.08
# Wide enough for BLAS to do the work, narrow enough that the distance block stays
# tens of megabytes against a seventeen-thousand-vertex body.
CHUNK = 512
UNTAGGED = "none"


class RegionError(RuntimeError):
    pass


def _positions(glb: Glb, node: dict) -> np.ndarray:
    mesh = glb.json["meshes"][node["mesh"]]
    if len(mesh["primitives"]) != 1:
        raise RegionError(f"region gate: mesh \"{node.get('name')}\" is "
                          f"{len(mesh['primitives'])} primitives, expected one")
    return glb.accessor(mesh["primitives"][0]["attributes"]["POSITION"]).astype(np.float64)


def body_vertices(body_glb: str, masks: dict) -> tuple[np.ndarray, list[str]]:
    """Every body vertex the masks name a mesh for, and the region each one belongs to."""
    glb = Glb(body_glb)
    nodes = {node["name"]: node for node in glb.json["nodes"] if "mesh" in node}
    points: list[np.ndarray] = []
    labels: list[str] = []
    for name in sorted({mesh for slot in masks["slots"].values() for mesh in slot}):
        node = nodes.get(name)
        if node is None:
            raise RegionError(f"region gate: the body has no mesh node \"{name}\"")
        position = _positions(glb, node)
        owner = [UNTAGGED] * len(position)
        for region, meshes in masks["slots"].items():
            for index in meshes.get(name, []):
                if index >= len(position):
                    raise RegionError(f"region gate: {name} mask names vertex {index} "
                                      f"of {len(position)}")
                owner[index] = region
        points.append(position)
        labels.extend(owner)
    return np.concatenate(points), labels


def nearest(points: np.ndarray, body: np.ndarray, chunk: int = CHUNK) -> tuple[np.ndarray, np.ndarray]:
    """For every point, which body vertex is nearest and how far away it is."""
    squared = np.einsum("ij,ij->i", body, body)
    where = np.empty(len(points), dtype=np.int64)
    far = np.empty(len(points), dtype=np.float64)
    for start in range(0, len(points), chunk):
        block = points[start:start + chunk]
        distances = (squared[None, :] - 2.0 * (block @ body.T)
                     + np.einsum("ij,ij->i", block, block)[:, None])
        at = np.argmin(distances, axis=1)
        where[start:start + len(block)] = at
        far[start:start + len(block)] = np.sqrt(
            np.maximum(distances[np.arange(len(block)), at], 0.0))
    return where, far


def tag(points: np.ndarray, body: np.ndarray, labels: list[str], reach: float = REACH) -> list[str]:
    where, far = nearest(points, body)
    return [labels[at] if distance <= reach else UNTAGGED
            for at, distance in zip(where.tolist(), far.tolist())]


def indexed(tags: list[str]) -> dict[str, list[int]]:
    """The tags as the manifest carries them: region to the vertices wearing it."""
    found: dict[str, list[int]] = {}
    for at, region in enumerate(tags):
        if region == UNTAGGED:
            continue
        found.setdefault(region, []).append(at)
    return {region: found[region] for region in sorted(found)}


def of_glb(piece_glb: str, body_glb: str, masks: dict,
           reach: float = REACH) -> tuple[dict[str, list[int]], dict]:
    """One exported piece's region index, and the counts a report shows."""
    glb = Glb(piece_glb)
    meshes = [node for node in glb.json["nodes"] if "mesh" in node]
    if len(meshes) != 1:
        raise RegionError(f"region gate: the piece is {len(meshes)} meshes, expected one")
    points = _positions(glb, meshes[0])
    body, labels = body_vertices(body_glb, masks)
    tags = tag(points, body, labels, reach)
    regions = indexed(tags)
    report = {
        "reachMetres": reach,
        "vertices": int(len(points)),
        "bodyVertices": int(len(body)),
        "counts": {region: len(members) for region, members in regions.items()},
        "untagged": int(sum(1 for region in tags if region == UNTAGGED)),
    }
    return regions, report
