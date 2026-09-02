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
  // The tick coordinator. Still the largest file in the repo; skills, movement and
  // actor construction are the remaining extraction targets, and none of them need
  // the tick's private state either.
  'src/sim/sim.ts': 1290,
  // Metrics and probes. The policies moved to policies.ts when the kiter landed.
  'src/sim/harness.ts': 420,
  'src/sim/policies.ts': 400,
  'src/ui/hud.ts': 520,
  // Actor bodies moved to actorview.ts and terrain to terrain.ts when art landed.
  'src/render/views.ts': 290,
  'src/render/clipdriver.ts': 110,
  // Binding a pose onto a real skeleton: the resolve, the units and the axis
  // correction. All of it is bind-time work around one small per-frame loop.
  'src/render/semanticskeleton.ts': 155,
  'src/render/helperbones.ts': 130,
  'src/render/skeletonbones.ts': 60,
  'src/render/riginput.ts': 100,
  // The procedural pose generator. `clips.ts` is the pose table and so exempt;
  // these are the maths around it, and the limb solvers already moved to limbs.ts.
  'src/render/procedural/gait.ts': 215,
  // Where one foot goes over one stride: the stance line, the swing arc, the roll.
  'src/render/procedural/stride.ts': 95,
  'src/render/procedural/foot.ts': 65,
  'src/render/procedural/arms.ts': 120,
  'src/render/procedural/armpace.ts': 70,
  'src/render/procedural/stances.ts': 95,
  // The pose-clip player. The key format and its compiler are in posekeys.ts.
  'src/render/procedural/poses.ts': 130,
  'src/render/procedural/posekeys.ts': 130,
  'src/render/procedural/geometry.ts': 187,
  'src/render/procedural/generator.ts': 145,
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
