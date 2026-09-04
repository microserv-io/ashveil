"""Full source detail: the shell is fitted, the hardware rides it.

The old fitter deletes every island under 2% of the piece and then decimates what
is left to the slot's budget, which is what took the tunic's chest star, the belt's
buckle and the boots' rivets. Full detail keeps all of it, and the question that
raises is what to do with a rivet when the shell it is bolted to is straightened,
rolled, tube-fitted, shrinkwrapped and hugged onto a body: deforming it with the
shell smears it, and leaving it where it was tears it off.

So the hardware takes the placement and stops there. The global similarity - uniform
scale, yaw and the anchors - is the whole of the transform every island gets in
common, and after the shell's non-rigid stages each hardware part is translated by
the mean of what moved under it. That is `ring.rigid_transport`'s rule with the
strap generalised to "the shell", and the clustering is `ring.island_clusters`
unchanged, so a buckle and its tongue travel as one part.
"""

from __future__ import annotations

import numpy as np
from mathutils import Vector
from mathutils.kdtree import KDTree

from fit.frame import blender_from_runtime, runtime_from_blender
from gear import ring

# How close a hardware vertex has to sit to the shell to count as welded to it.
ATTACH_RADIUS = 0.02
# How close two hardware islands come before they are one part: a buckle and its
# tongue, a rivet and its washer.
CLUSTER_RADIUS = 0.005


def points_of(obj) -> np.ndarray:
    matrix = obj.matrix_world
    return np.array([runtime_from_blender(matrix @ vertex.co) for vertex in obj.data.vertices],
                    dtype=np.float64)


def triangles_of(obj) -> int:
    return sum(max(0, len(face.vertices) - 2) for face in obj.data.polygons)


def _slide(obj, shift: np.ndarray) -> None:
    local = obj.matrix_world.to_3x3().inverted() @ Vector(blender_from_runtime(shift))
    for vertex in obj.data.vertices:
        vertex.co = vertex.co + local
    obj.data.update()


def transport(shell, before: np.ndarray, hardware: list, radius: float = ATTACH_RADIUS,
              cluster_radius: float = CLUSTER_RADIUS) -> dict:
    """Move every hardware part by what the shell under it moved, and nothing else.

    `before` is the shell after the similarity and before its first non-rigid stage,
    which is the frame the hardware is still standing in. Attachment is measured
    there, not against the fitted shell, or a part welded to a sleeve that travelled
    3 cm would look for its shell where the shell no longer is.
    """
    if not hardware:
        return {"islands": 0, "clusters": 0, "attachRadiusMetres": radius,
                "clusterRadiusMetres": cluster_radius, "table": []}
    after = points_of(shell)
    displacement = after - before

    tree = KDTree(len(before))
    for at, point in enumerate(before):
        tree.insert(Vector(tuple(point)), at)
    tree.balance()

    island_points = [points_of(obj) for obj in hardware]
    points = np.concatenate(island_points)
    members: list[list[int]] = []
    at = 0
    for island in island_points:
        members.append(list(range(at, at + len(island))))
        at += len(island)
    # The shell is no candidate for clustering, and an empty member list is how
    # `island_clusters` is told to leave one out.
    members.append([])
    clusters = ring.island_clusters(points, members, len(members) - 1, cluster_radius)

    rows = []
    for cluster in clusters:
        indices = [index for island in cluster for index in members[island]]
        touching: set[int] = set()
        nearest_distance, nearest_slot = float("inf"), 0
        for index in indices:
            point = Vector(tuple(points[index]))
            for _, slot, _ in tree.find_range(point, radius):
                touching.add(slot)
            found = tree.find(point)
            if found[2] is not None and found[2] < nearest_distance:
                nearest_distance, nearest_slot = float(found[2]), found[1]
        borrowed = not touching
        if borrowed:
            touching = {nearest_slot}
        attached = np.array(sorted(touching), dtype=int)
        shift = displacement[attached].mean(axis=0)
        for island in cluster:
            _slide(hardware[island], shift)
        rows.append({
            "islands": cluster,
            "triangles": int(sum(triangles_of(hardware[island]) for island in cluster)),
            "vertices": int(len(indices)),
            "attachmentVertices": int(len(attached)),
            "fromNearestShellVertex": borrowed,
            "nearestShellMetres": round(nearest_distance, 6),
            "translationMetres": round(float(np.linalg.norm(shift)), 6),
            "translation": [round(float(value), 6) for value in shift],
        })
    rows.sort(key=lambda entry: -entry["triangles"])
    return {
        "islands": len(hardware),
        "clusters": len(clusters),
        "attachRadiusMetres": radius,
        "clusterRadiusMetres": cluster_radius,
        "fromNearestShellVertex": sum(1 for row in rows if row["fromNearestShellVertex"]),
        "maxTranslationMetres": round(max((row["translationMetres"] for row in rows), default=0.0), 6),
        "shellMoveMaxMetres": round(float(np.linalg.norm(displacement, axis=1).max(initial=0.0)), 6),
        "shellMoveMeanMetres": round(float(np.linalg.norm(displacement, axis=1).mean()), 6),
        "table": rows,
    }
