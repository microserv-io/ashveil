import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { familyMapping, offAxisJoints, restCorrections } from '../scripts/art/profile.mjs'

const ROOT = join(import.meta.dirname, '..')
const CONTRACT = JSON.parse(readFileSync(join(ROOT, 'scripts', 'art', 'contracts', 'humanoid.v1.json'), 'utf8'))
const V2 = readFileSync(join(ROOT, 'public', 'bodies', 'masculine-v3', 'masculine-v3.glb'))
const V1 = readFileSync(join(ROOT, 'public', 'bodies', 'masculine-v1.glb'))

/**
 * The point of the bone axis rule is that the runtime never carries a correction.
 * `semanticskeleton.ts` derives one per joint from the bone's rest orientation, so
 * a body this pipeline built has to rest axis-aligned or the rule did not hold.
 */
describe('rest-axis corrections on a fitted body', () => {
  const { required, optional } = familyMapping(CONTRACT)

  it('is the identity for every semantic joint of masculine-v3', () => {
    const corrections = restCorrections(V2, { ...required, ...optional })
    expect(Object.keys(corrections).sort()).toEqual(Object.keys({ ...required, ...optional }).sort())
    expect(offAxisJoints(corrections)).toEqual([])
  })

  it('names the joints that are off-axis, so the assertion can fail loudly', () => {
    // masculine-v1 came off a fitter that exported Blender's own bone axes: every
    // joint needs a correction there, which is what this pipeline set out to end.
    const v1 = {
      pelvis: 'pelvis', spine: 'spine', chest: 'chest', head: 'head',
      'shoulder.l': 'upper_arm.L', 'hip.l': 'thigh.L', 'knee.l': 'shin.L',
    }
    const offAxis = offAxisJoints(restCorrections(V1, v1))
    expect(offAxis).toContain('hip.l')
    expect(offAxis.length).toBeGreaterThan(4)
  })
})
