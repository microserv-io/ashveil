/**
 * The frames and conventions every module under `procedural/` obeys. They are the
 * contract with slice 2b's skeleton binding, so they are written down here rather
 * than rediscovered from the maths.
 *
 * **Body frame.** Right-handed, +Y up, +Z forward (the direction the actor faces),
 * +X to the actor's left. The fitted bodies use this frame and face +Z
 * (`actorview.ts`).
 *
 * **Canonical joint frame.** A joint's rest direction is the unit vector from its
 * own rest position to its child's, in the body frame. Identity means the bone
 * points along that rest direction. A joint's pose rotation is **absolute in the
 * body frame**, not relative to its parent: `direction = q * restDirection`.
 *
 * Absolute rather than hierarchical because everything this module computes is a
 * body-frame quantity — foot targets that must not slide against world velocity,
 * a ground plane at y = 0, a lean into acceleration. Absolute rotations let each
 * joint be written once with no forward-kinematics pass, make blending correct
 * per joint, and give a level foot for free (identity is flat on the ground).
 * The cost lands on slice 2b, which converts to bone-local at write time:
 *
 *     boneLocal(j) = inverse(parentBodyRotation) * q(j) * correction(j)
 *
 * where `correction(j)` maps the canonical rest direction onto the skeleton's own
 * bone axis. Nothing here knows about a concrete skeleton's bone axes.
 *
 * **Positions.** `geometry.ts` holds rest positions in the body frame with the
 * ground at y = 0. Lengths are in whatever unit `RigInput.speed` is in — slice 2b
 * scales the skeleton's rest pose into sim units so a body-frame displacement is a
 * world displacement, which is what makes the no-slide gait work.
 *
 * **Angles** are radians. **Time** is `RigInput.time`, which is sim time; render
 * delta is never accumulated here.
 *
 * **What a positive number does.** More work here has gone the wrong way on a
 * sign than on anything else — an arm crossing outward instead of in, a pelvis
 * leading the wrong leg, a toe rolling into the floor — and none of it was
 * visible in the maths. Read this before touching a sign;
 * `tests/procedural_handedness.test.ts` holds every line of it to a landmark
 * measured off the body, on both fixtures and through the real binding.
 *
 * | Positive… | moves |
 * |---|---|
 * | shoulder swing (`arms.ts`) | that hand **forward** (+Z) |
 * | abduction (`armpace.out`) | that hand **away** from the centre line |
 * | crossing (`armpace.cross`) | that hand **towards** the centre line |
 * | elbow bend (`armpace.bend`) | that hand **up and forward** |
 * | turn about +X at a **down**-pointing bone (hip, knee) | its tip **back** |
 * | turn about +X at an **up**-pointing bone (spine, chest) | its tip **forward** |
 * | pitch on a foot (`writeLeg`) | the toes **down**, the heel **up** |
 * | `footRoll` excursion | +1 the foot **ahead** of the hip (rolls onto its heel), -1 **behind** it (over its toe) |
 * | yaw about +Y (`writeTorso`) | the body to its **left**: the left hip back, the right hip forward |
 * | roll about +Z (`writeTorso`) | the body's **left side down** |
 * | `pose.offset` +Z | the whole body **forward** |
 *
 * Two of those read backwards against the anatomy and are worth saying twice.
 * **Hip flexion** — bringing the foot forward — is a *negative* turn about +X,
 * because the thigh hangs down and the same turn that tips a chest forward swings
 * a thigh back. And a *positive* pelvis yaw does **not** lead with the left leg:
 * it turns the body left, which carries the left hip backwards.
 */

/** The 17 required semantic joints. Every skeleton family must resolve all of them. */
export const enum Joint {
  Root,
  Pelvis,
  Spine,
  Chest,
  Head,
  ShoulderL,
  ElbowL,
  HandL,
  ShoulderR,
  ElbowR,
  HandR,
  HipL,
  KneeL,
  FootL,
  HipR,
  KneeR,
  FootR,
  Count,
}

/**
 * Joints a family may or may not have. They are never required to resolve, and the
 * pose generator never writes one, so a skeleton missing them poses correctly.
 */
export const enum OptionalJoint {
  Neck,
  ClavicleL,
  ClavicleR,
  ToesL,
  ToesR,
  WristL,
  WristR,
  Tail,
  Count,
}

export const JOINT_NAMES: readonly string[] = [
  'root',
  'pelvis',
  'spine',
  'chest',
  'head',
  'shoulder.l',
  'elbow.l',
  'hand.l',
  'shoulder.r',
  'elbow.r',
  'hand.r',
  'hip.l',
  'knee.l',
  'foot.l',
  'hip.r',
  'knee.r',
  'foot.r',
]

export const OPTIONAL_JOINT_NAMES: readonly string[] = [
  'neck',
  'clavicle.l',
  'clavicle.r',
  'toes.l',
  'toes.r',
  'wrist.l',
  'wrist.r',
  'tail',
]

/**
 * Parent per joint, root parented to itself. Every entry is lower than its own
 * index so a single forward pass resolves positions.
 */
export const JOINT_PARENT: readonly Joint[] = [
  Joint.Root,
  Joint.Root,
  Joint.Pelvis,
  Joint.Spine,
  Joint.Chest,
  Joint.Chest,
  Joint.ShoulderL,
  Joint.ElbowL,
  Joint.Chest,
  Joint.ShoulderR,
  Joint.ElbowR,
  Joint.Pelvis,
  Joint.HipL,
  Joint.KneeL,
  Joint.Pelvis,
  Joint.HipR,
  Joint.KneeR,
]

/** Left is +X, so the left side's lateral sign is +1 and the right side's is -1. */
export const LEFT = 1
export const RIGHT = -1
