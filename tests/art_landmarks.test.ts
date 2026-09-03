import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { readGlb, type GlbContents } from '../scripts/art/glb'

const ROOT = join(import.meta.dirname, '..')
const BODY = 'masculine-v3'
const DIRECTORY = join(ROOT, 'public', 'bodies', BODY)
const MANIFEST = JSON.parse(readFileSync(join(DIRECTORY, `${BODY}.manifest.json`), 'utf8'))
const HEIGHT: number = MANIFEST.canonicalHeight
const GLB = readGlb(join(DIRECTORY, `${BODY}.glb`))

// Anatomical hand length is about 0.108 x stature and forearm length about
// 0.146 x; the bands allow a stylised body to differ without letting a landmark
// land in the wrong anatomy altogether.
const HAND_LENGTH = [0.09, 0.12] as const
const FOREARM_LENGTH = [0.14, 0.17] as const

type Point = readonly [number, number, number]

function landmark(name: string): Point {
  const point = MANIFEST.landmarks[name]
  expect(point, `no ${name} landmark in the manifest`).toBeDefined()
  return point as Point
}

function distance(from: Point, to: Point): number {
  return Math.hypot(to[0] - from[0], to[1] - from[1], to[2] - from[2])
}

/** The lowest skin the arm chain owns: the fingertips, wherever the wrist landed. */
function lowestArmSkin(glb: GlbContents, side: 'L' | 'R'): number {
  const chain = new Set([`forearm_${side}`, `hand_${side}`])
  const owned = glb.skin.jointNames.map((name) => chain.has(name))
  let lowest = Number.POSITIVE_INFINITY
  for (const mesh of glb.meshes) {
    for (let vertex = 0; vertex < mesh.positions.length / 3; vertex++) {
      let dominant = -1
      let heaviest = 0
      for (let lane = 0; lane < 4; lane++) {
        const weight = mesh.weights[vertex * 4 + lane]!
        if (weight > heaviest) {
          heaviest = weight
          dominant = mesh.joints[vertex * 4 + lane]!
        }
      }
      if (dominant < 0 || !owned[dominant]) continue
      lowest = Math.min(lowest, mesh.positions[vertex * 3 + 1]!)
    }
  }
  expect(lowest, `no skin is dominated by the ${side} forearm or hand`).toBeLessThan(Number.POSITIVE_INFINITY)
  return lowest
}

/**
 * Where the wrist sits along the arm, measured off the shipped body.
 *
 * The fitter reads the wrist as a narrow section of the forearm, and a palm that
 * is wider than the forearm has a narrow section of its own at the knuckles. A
 * wrist that lands there gives the hand bone the fingers only: the hand pivots at
 * the knuckles and a glove seats its cuff over the palm. Both lengths are
 * measured against canonical height so the gate reads the same on any body.
 */
describe('the wrist sits above the palm', () => {
  it.each(['L', 'R'] as const)('leaves a whole hand below the %s wrist', (side) => {
    const wrist = landmark(`wrist_${side}`)
    const fingertip = lowestArmSkin(GLB, side)
    const hand = (wrist[1] - fingertip) / HEIGHT
    expect(hand).toBeGreaterThanOrEqual(HAND_LENGTH[0])
    expect(hand).toBeLessThanOrEqual(HAND_LENGTH[1])
  })

  it.each(['L', 'R'] as const)('keeps the %s forearm the length of a forearm', (side) => {
    const forearm = distance(landmark(`elbow_${side}`), landmark(`wrist_${side}`)) / HEIGHT
    expect(forearm).toBeGreaterThanOrEqual(FOREARM_LENGTH[0])
    expect(forearm).toBeLessThanOrEqual(FOREARM_LENGTH[1])
  })

  it('gives the hand bone the palm and the fingers, not the fingers alone', () => {
    const hand = distance(landmark('wrist_L'), landmark('hand_L')) / HEIGHT
    expect(hand).toBeGreaterThanOrEqual(HAND_LENGTH[0] * 0.6)
  })
})
