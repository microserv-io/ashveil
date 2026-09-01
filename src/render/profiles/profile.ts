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
}
