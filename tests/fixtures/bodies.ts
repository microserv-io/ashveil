import masculine from '../../src/render/procedural/fixtures/masculine.json'
import { buildRigGeometry, type JointTable, type RigGeometry } from '../../src/render/procedural/geometry'

/**
 * The bodies the motion tests measure against, in one place: every file that pins
 * a human number has to pin it against the same human.
 */

/** The person `gait.ts`'s locomotion scales are fitted to. */
export const STANDING_HEIGHT = 1.8
export const HUMAN_LEG_RATIO = 0.48
export const HUMAN_ARM_RATIO = 0.44

/**
 * A synthetic body of a given build. Absolute numbers are asserted against this
 * rather than against a real rig, because "faster than the other one" was how the
 * gait ended up running a human at 3.3 Hz and nobody noticed.
 */
export function humanoid(legRatio: number, armRatio: number): RigGeometry {
  const leg = STANDING_HEIGHT * legRatio
  const arm = STANDING_HEIGHT * armRatio
  const shoulder = STANDING_HEIGHT * 0.76
  const table: JointTable = {
    root: [0, 0, 0],
    pelvis: [0, leg + 0.08, 0],
    spine: [0, shoulder - 0.34, 0],
    chest: [0, shoulder, 0],
    head: [0, STANDING_HEIGHT * 0.9, 0],
    'shoulder.l': [0.16, shoulder, 0],
    'elbow.l': [0.16 + arm * 0.5, shoulder, 0],
    'hand.l': [0.16 + arm, shoulder, 0],
    'shoulder.r': [-0.16, shoulder, 0],
    'elbow.r': [-0.16 - arm * 0.5, shoulder, 0],
    'hand.r': [-0.16 - arm, shoulder, 0],
    'hip.l': [0.1, leg, 0],
    'knee.l': [0.1, leg * 0.5, 0],
    'foot.l': [0.1, 0, 0],
    'hip.r': [-0.1, leg, 0],
    'knee.r': [-0.1, leg * 0.5, 0],
    'foot.r': [-0.1, 0, 0],
  }
  // A foot measured off a real body of this height.
  return buildRigGeometry(table, 1, STANDING_HEIGHT, { heel: 0.066, toe: 0.212, pitch: 0 })
}

export const HUMAN = humanoid(HUMAN_LEG_RATIO, HUMAN_ARM_RATIO)
export const CHIBI = humanoid(0.17, 0.255)
/** The Tripo body, at the scale its own fixture is measured in. */
export const MASCULINE = buildRigGeometry(masculine.joints, 1, masculine.standingHeight, masculine.footprint)
