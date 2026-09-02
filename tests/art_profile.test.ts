import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { familyMapping, offAxisJoints, restCorrections } from '../scripts/art/profile.mjs'

const ROOT = join(import.meta.dirname, '..')
const CONTRACT = JSON.parse(readFileSync(join(ROOT, 'scripts', 'art', 'contracts', 'humanoid.v1.json'), 'utf8'))
const BODY = readFileSync(join(ROOT, 'public', 'bodies', 'masculine-v3', 'masculine-v3.glb'))

/**
 * The point of the bone axis rule is that the runtime never carries a correction.
 * `semanticskeleton.ts` derives one per joint from the bone's rest orientation, so
 * a body this pipeline built has to rest axis-aligned or the rule did not hold.
 */
describe('rest-axis corrections on a fitted body', () => {
  const { required, optional } = familyMapping(CONTRACT)

  it('is the identity for every semantic joint of masculine-v3', () => {
    const corrections = restCorrections(BODY, { ...required, ...optional })
    expect(Object.keys(corrections).sort()).toEqual(Object.keys({ ...required, ...optional }).sort())
    expect(offAxisJoints(corrections)).toEqual([])
  })

  it('rejects a synthetically rotated masculine-v3 joint', () => {
    const quarterTurn = Math.PI / 8
    const corrections: ReturnType<typeof restCorrections> = {
      ...restCorrections(BODY, { ...required, ...optional }),
      spine: [Math.sin(quarterTurn), 0, 0, Math.cos(quarterTurn)],
    }

    expect(offAxisJoints(corrections)).toContain('spine')
  })
})
