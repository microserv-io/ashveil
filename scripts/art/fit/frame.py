"""The one place a coordinate frame is converted, and the axis rule for bones.

Three frames meet in this pipeline and every past sign bug lived in the gap
between them, so the conversion exists once, here, and nowhere else.

    Blender   +Z up, -Y front, +X the character's left
    runtime   +Y up, +Z forward, +X the character's left   (glTF, and joints.ts)

`runtime_from_blender` is exactly what the glTF exporter's `export_yup=True`
does, so a value converted here and a value the exporter wrote agree by
construction rather than by luck. `gate.py` then proves the frame again off the
exported file from landmarks alone, because a conversion nobody re-measures is
a conversion nobody trusts.

BONE ORIENTATION RULE
---------------------
In Blender a bone's local +Y runs head to tail, so pointing a bone at its child
sets the primary axis. The roll picks the secondary axis, local +Z:

  * limb bones (arms, legs) roll so local +X lies along the body's lateral axis
    (world +X, the character's left). That makes the knee and the elbow hinge
    about one local axis instead of two, which is what a bend axis has to be.
    Expressed as a roll target: local +Z = lateral x direction.
  * spine-chain bones (root, pelvis, spine, chest, neck, head, clavicles) roll
    so local +Z faces runtime forward, which is Blender -Y.

The runtime never sees any of this. `export.py` neutralises the exported bone
rest orientations to identity so that `semanticskeleton.ts` derives an identity
rest-axis correction for every semantic joint; the orientation above is what
makes the rig workable in Blender and the gates poseable about a real hinge.
"""

from __future__ import annotations

BLENDER_FORWARD = (0.0, -1.0, 0.0)
BLENDER_UP = (0.0, 0.0, 1.0)
BLENDER_LATERAL = (1.0, 0.0, 0.0)

RUNTIME_FORWARD = (0.0, 0.0, 1.0)
RUNTIME_UP = (0.0, 1.0, 0.0)
RUNTIME_LATERAL = (1.0, 0.0, 0.0)


def runtime_from_blender(point) -> tuple[float, float, float]:
    x, y, z = point
    return (float(x), float(z), float(-y))


def blender_from_runtime(point) -> tuple[float, float, float]:
    x, y, z = point
    return (float(x), float(-z), float(y))


def rounded(point, digits: int = 6) -> list[float]:
    """Serialised coordinates are rounded once, here, so hashes are reproducible."""
    return [round(float(value) + 0.0, digits) for value in point]
