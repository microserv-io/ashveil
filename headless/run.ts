import { Harness, POLICIES, measureDps, sweep, type HarnessMetrics } from '../src/sim/harness'
import { PLAYER_SKILLS } from '../src/sim/skills'
import { TICK_RATE } from '../src/sim/types'

/**
 * Headless driver for the deterministic core. Runs the same Sim the browser runs,
 * with a scripted player, so balance can be measured without opening anything.
 *
 *   npm run sim -- playtest --seed 7 --minutes 3
 *   npm run sim -- dps
 *   npm run sim -- sweep --seeds 8 --minutes 2
 */

interface Args {
  command: string
  flags: Map<string, string>
}

function parseArgs(argv: readonly string[]): Args {
  const flags = new Map<string, string>()
  const positional: string[] = []
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i]!
    if (token.startsWith('--')) {
      const [key, inline] = token.slice(2).split('=')
      if (inline !== undefined) flags.set(key!, inline)
      else if (argv[i + 1] && !argv[i + 1]!.startsWith('--')) flags.set(key!, argv[++i]!)
      else flags.set(key!, 'true')
    } else {
      positional.push(token)
    }
  }
  return { command: positional[0] ?? 'playtest', flags }
}

function number(flags: Map<string, string>, key: string, fallback: number): number {
  const raw = flags.get(key)
  if (raw === undefined) return fallback
  const parsed = Number(raw)
  return Number.isFinite(parsed) ? parsed : fallback
}

const args = parseArgs(process.argv.slice(2))
const minutes = number(args.flags, 'minutes', 2)
const ticks = Math.round(minutes * 60 * TICK_RATE)

switch (args.command) {
  case 'playtest':
    playtest()
    break
  case 'dps':
    dps()
    break
  case 'sweep':
    runSweep()
    break
  case 'trace':
    trace()
    break
  default:
    console.error(`unknown command: ${args.command}`)
    console.error('commands: playtest | dps | sweep | trace')
    process.exit(1)
}

function playtest(): void {
  const seed = number(args.flags, 'seed', 1)
  const policyName = args.flags.get('policy') ?? 'brawler'
  const policy = POLICIES[policyName]
  if (!policy) {
    console.error(`unknown policy: ${policyName} (have: ${Object.keys(POLICIES).join(', ')})`)
    process.exit(1)
    return
  }

  const harness = new Harness({
    seed,
    policy,
    decisionInterval: number(args.flags, 'reaction', 3),
  })
  const startedAt = process.hrtime.bigint()
  harness.run(ticks)
  const elapsedMs = Number(process.hrtime.bigint() - startedAt) / 1e6

  const report = harness.report()
  printReport(report)
  console.log('')
  console.log(`  ${ticks} ticks simulated in ${elapsedMs.toFixed(0)}ms (${(ticks / (elapsedMs / 1000) / 1000).toFixed(1)}k ticks/s)`)
}

function printReport(report: HarnessMetrics): void {
  console.log('')
  console.log(`  Ashveil playtest — seed ${report.seed}, policy ${report.policy}`)
  console.log(`  ${'-'.repeat(56)}`)
  row('sim time', `${report.seconds}s (${report.ticks} ticks)`)
  row('in combat', `${report.timeInCombatSeconds}s (${percent(report.timeInCombatSeconds, report.seconds)})`)
  console.log('')
  row('depth reached', String(report.depthReached))
  row('areas cleared', String(report.areasCleared))
  row('current area', `${report.areaMonsterCount} monsters, ${report.monstersRemaining} left`)
  row('clear times', report.clearSeconds.length ? report.clearSeconds.map((s) => `${s}s`).join(', ') : '-')
  console.log('')
  row('level', `${report.level} (${report.xp} xp, ${report.xpPerMinute}/min)`)
  row('kills', `${report.monstersKilled} (${report.killsPerMinute}/min)`)
  row('avg time to kill', `${report.averageTimeToKill}s`)
  row('deaths', String(report.playerDeaths))
  console.log('')
  row('dps', `${report.dps} overall, ${report.combatDps} in combat`)
  row('time split', `idle ${report.stateShare.idle}%, moving ${report.stateShare.moving}%, acting ${report.stateShare.acting}%, dead ${report.stateShare.dead}%`)
  row('damage taken/s', String(report.damageTakenPerSecond))
  row('crit rate', percent(report.crits, report.hits))
  row('low life', `${report.lowLifeSeconds}s (${percent(report.lowLifeSeconds, report.seconds)})`)
  row('mana-blocked casts', String(report.manaBlockedCasts))
  console.log('')
  row('damage by skill', formatShare(report.damageBySkill, report.damageDealt))
  row('drops', `${report.drops.normal} normal, ${report.drops.magic} magic, ${report.drops.rare} rare`)
  row('items equipped', String(report.itemsEquipped))
}

function row(label: string, value: string): void {
  console.log(`  ${label.padEnd(20)} ${value}`)
}

function percent(part: number, whole: number): string {
  if (!whole) return '0%'
  return `${Math.round((part / whole) * 100)}%`
}

function formatShare(byKey: Record<string, number>, total: number): string {
  const entries = Object.entries(byKey).sort((a, b) => b[1] - a[1])
  if (entries.length === 0) return '-'
  return entries.map(([key, value]) => `${key} ${percent(value, total)}`).join(', ')
}

function dps(): void {
  const seed = number(args.flags, 'seed', 1)
  const seconds = number(args.flags, 'seconds', 20)
  const level = number(args.flags, 'level', 1)

  console.log('')
  console.log(`  Skill DPS — seed ${seed}, level ${level}, ${seconds}s each, starting gear`)
  console.log(`  ${'-'.repeat(56)}`)
  for (const id of PLAYER_SKILLS) {
    const probe = measureDps({ seed, skill: id, seconds, level })
    if (probe.hitsPerSecond === 0) continue
    row(id, `${probe.dps} dps  (${probe.hitsPerSecond}/s x ${probe.averageHit} avg, ${probe.crits} crits)`)
  }

  console.log('')
  console.log('  With a rare cleaver and the physical passives:')
  console.log(`  ${'-'.repeat(56)}`)
  const geared = measureDps({
    seed,
    skill: 'cleave',
    seconds,
    level: 12,
    gear: [{ baseId: 'cleaver', itemLevel: 14, rarity: 'rare' }],
    passives: ['might_1', 'might_2', 'might_3'],
  })
  row('cleave', `${geared.dps} dps  (${geared.hitsPerSecond}/s x ${geared.averageHit} avg)`)
}

/**
 * Second-by-second readout of what the scripted player is doing. The column that
 * matters is `moved`: a run where the bot is stuck shows state=moving with moved≈0.
 */
function trace(): void {
  const seed = number(args.flags, 'seed', 1)
  const interval = Math.round(number(args.flags, 'every', 1) * TICK_RATE)
  const harness = new Harness({ seed, decisionInterval: number(args.flags, 'reaction', 3) })
  const sim = harness.sim

  console.log('')
  console.log(`  Trace — seed ${seed}, sampling every ${interval} ticks`)
  console.log(`  ${'t'.padEnd(6)}${'state'.padEnd(9)}${'moved'.padEnd(7)}${'life'.padEnd(6)}${'mana'.padEnd(6)}${'path'.padEnd(6)}${'left'.padEnd(6)}${'dmg'.padEnd(6)}target`)

  let lastPos = { ...sim.player.pos }
  let lastDamage = 0
  let damageTotal = 0

  for (let i = 0; i < ticks; i++) {
    harness.step()
    for (const event of sim.events) {
      if (event.kind === 'hit' && event.sourceId === sim.player.id) damageTotal += event.damage.total
    }
    if (sim.tickCount % interval !== 0) continue

    const player = sim.player
    const moved = Math.hypot(player.pos.x - lastPos.x, player.pos.y - lastPos.y)
    const target = player.targetId ? sim.actorById(player.targetId) : sim.nearestHostile(player, 20)
    const gap = target ? Math.hypot(target.pos.x - player.pos.x, target.pos.y - player.pos.y) : 0

    const describeTarget = target
      ? `${target.name} lvl${target.level} ${Math.round((target.life / target.stats.maxLife) * 100)}%hp of ${Math.round(target.stats.maxLife)} @${gap.toFixed(1)}`
      : '-'

    console.log(
      `  ${sim.time.toFixed(0).padEnd(6)}${player.state.padEnd(9)}${moved.toFixed(2).padEnd(7)}${`${Math.round((player.life / player.stats.maxLife) * 100)}%`.padEnd(6)}${`${Math.round((player.mana / player.stats.maxMana) * 100)}%`.padEnd(6)}${`${player.pathCursor}/${player.path.length}`.padEnd(6)}${String(sim.monstersRemaining()).padEnd(6)}${String(Math.round(damageTotal - lastDamage)).padEnd(6)}${describeTarget}`,
    )
    lastPos = { ...player.pos }
    lastDamage = damageTotal
  }
}

function runSweep(): void {
  const seedCount = number(args.flags, 'seeds', 8)
  const seeds = Array.from({ length: seedCount }, (_, i) => i + 1)
  const result = sweep({ seeds, ticks, decisionInterval: number(args.flags, 'reaction', 3) })

  console.log('')
  console.log(`  Sweep — ${seedCount} seeds x ${minutes} min`)
  console.log(`  ${'-'.repeat(72)}`)
  console.log(`  ${'seed'.padEnd(6)}${'depth'.padEnd(7)}${'lvl'.padEnd(5)}${'kills'.padEnd(7)}${'dps'.padEnd(9)}${'taken/s'.padEnd(9)}${'deaths'.padEnd(8)}rares`)
  for (const run of result.runs) {
    console.log(
      `  ${String(run.seed).padEnd(6)}${String(run.depthReached).padEnd(7)}${String(run.level).padEnd(5)}${String(run.monstersKilled).padEnd(7)}${String(run.dps).padEnd(9)}${String(run.damageTakenPerSecond).padEnd(9)}${String(run.playerDeaths).padEnd(8)}${run.drops.rare}`,
    )
  }
  console.log(`  ${'-'.repeat(72)}`)
  console.log(
    `  median  depth ${result.median.depthReached}  lvl ${result.median.level}  dps ${result.median.dps}  kills/min ${result.median.killsPerMinute}  deaths ${result.median.playerDeaths}`,
  )
}
