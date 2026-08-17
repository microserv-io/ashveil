import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const SIM_DIR = join(import.meta.dirname, '..', 'src', 'sim')

/**
 * Comments discuss the banned APIs by name — that is the point of them — so they
 * are removed before scanning. Newlines are preserved to keep line numbers honest.
 */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, (match) => match.replace(/[^\n]/g, ' '))
    .replace(/\/\/.*$/gm, '')
}

function simFiles(dir = SIM_DIR): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) return simFiles(full)
    return full.endsWith('.ts') ? [full] : []
  })
}

/**
 * The sim is the deterministic core: same seed, same run, on any host. These are
 * the rules that keep it that way, enforced mechanically rather than by review.
 */
describe('src/sim stays host-agnostic and deterministic', () => {
  const files = simFiles()

  it('has files to check', () => {
    expect(files.length).toBeGreaterThan(8)
  })

  const banned: readonly { pattern: RegExp; why: string }[] = [
    { pattern: /\bMath\.random\b/, why: 'use the seeded Rng so runs reproduce' },
    { pattern: /\bDate\.now\b/, why: 'use sim.time, not wall-clock' },
    { pattern: /\bnew Date\b/, why: 'use sim.time, not wall-clock' },
    { pattern: /\bperformance\.now\b/, why: 'use sim.time, not wall-clock' },
    { pattern: /\bwindow\./, why: 'the sim must run headless' },
    { pattern: /\bdocument\./, why: 'the sim must run headless' },
    { pattern: /\brequestAnimationFrame\b/, why: 'the sim is driven by fixed ticks' },
  ]

  for (const file of files) {
    const source = readFileSync(file, 'utf8')
    const code = stripComments(source)
    const name = file.slice(SIM_DIR.length + 1)

    for (const rule of banned) {
      it(`${name} does not use ${rule.pattern.source}`, () => {
        const offending = code
          .split('\n')
          .map((line, index) => ({ line, index: index + 1 }))
          .filter(({ line }) => rule.pattern.test(line))
        expect(offending, `${name}: ${rule.why}`).toEqual([])
      })
    }

    it(`${name} does not import rendering or three.js`, () => {
      expect(source).not.toMatch(/from ['"]three/)
      expect(source).not.toMatch(/from ['"]\.\.\/(render|ui)/)
    })
  }
})
