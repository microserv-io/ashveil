import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * The monolith ratchet.
 *
 * Coordinators grow because appending to one is always the path of least
 * resistance, and nobody notices until the file is unreviewable and every task
 * conflicts in it. So the ceiling is mechanical: a file over budget fails the
 * suite, and the fix is extraction rather than a bigger number.
 *
 * The ratchet only turns one way. **After extracting, lower the ceiling** to just
 * above the new size. Raising one is a deliberate decision that belongs in a commit
 * message explaining why extraction was not possible.
 *
 * Data tables are exempt and deliberately absent from this list: skills, monsters,
 * affixes and passives are correctly large. This is about logic, never data.
 */
const BUDGETS: Readonly<Record<string, number>> = {
  // The tick coordinator. The largest file in the repo and the top extraction
  // target: loot, progression, equipment and area transitions all still live here
  // and none of them need the tick's private state.
  'src/sim/sim.ts': 1400,
  // Bot policies plus metrics. The policies want their own module.
  'src/sim/harness.ts': 700,
  'src/ui/hud.ts': 520,
  // Actor bodies moved to actorview.ts and terrain to terrain.ts when art landed.
  'src/render/views.ts': 290,
  'src/sim/pathfind.ts': 300,
  'headless/run.ts': 280,
  'src/render/scene.ts': 200,
  'src/render/input.ts': 260,
  'src/sim/mapgen.ts': 260,
}

const ROOT = join(import.meta.dirname, '..')

describe('monolith budget', () => {
  for (const [path, ceiling] of Object.entries(BUDGETS)) {
    it(`${path} stays under ${ceiling} lines`, () => {
      const lines = readFileSync(join(ROOT, path), 'utf8').split('\n').length
      expect(
        lines,
        `${path} is ${lines} lines, over its ${ceiling} ceiling. Extract a module behind an ` +
          'existing seam rather than raising this number, then lower the ceiling.',
      ).toBeLessThanOrEqual(ceiling)
    })
  }

  it('has a ceiling within reach of every file it guards', () => {
    // A ceiling far above the file it guards has stopped ratcheting: it would let a
    // file double before anyone noticed. Lower it when you extract.
    for (const [path, ceiling] of Object.entries(BUDGETS)) {
      const lines = readFileSync(join(ROOT, path), 'utf8').split('\n').length
      expect(ceiling - lines, `${path}'s ceiling has drifted ${ceiling - lines} lines above it`).toBeLessThan(120)
    }
  })
})
