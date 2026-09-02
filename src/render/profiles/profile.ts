import type { FootPrint } from '../procedural/geometry'

export interface ArmCarryPose {
  readonly shoulder: readonly [number, number, number, number]
  readonly elbow: readonly [number, number, number, number]
  readonly swingScale?: number
}

export interface ArmCarry {
  readonly left?: ArmCarryPose
  readonly right?: ArmCarryPose
}

/**
 * A skeleton family's answer to "which bone is the left knee".
 *
 * The pose generator only ever speaks in the semantic joints of
 * `procedural/joints.ts`; a profile is the one place a real bone name appears, so
 * a new body family is a new table here rather than a branch in the driver.
 */
export interface SkeletonProfile {
  /** Named in the error when a required joint fails to resolve. */
  readonly name: string
  /** Every name in `JOINT_NAMES` to its bone. All of them are required. */
  readonly bones: Readonly<Record<string, string>>
  /** Names from `OPTIONAL_JOINT_NAMES` the family happens to have. Never required. */
  readonly optional: Readonly<Record<string, string>>
  /** Measured bind-pose height of the skinned body, in model units. */
  readonly standingHeight: number
  /** Where the skinned foot touches down, measured off the mesh, in model units. */
  readonly footprint?: FootPrint
  /** Absolute body-frame arm rotations; an omitted side uses the relaxed hang. */
  readonly armCarry?: ArmCarry
  /**
   * Bones the runtime derives rather than poses: `shoulder.l`, `shoulder.r`,
   * `twist.l`, `twist.r`. A shoulder helper turns by half its upper arm's turn
   * relative to the clavicle; a twist helper by half the forearm's axial twist.
   */
  readonly helpers?: Readonly<Record<string, string>>
}
