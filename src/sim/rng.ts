/**
 * The only source of randomness the sim may use. `Math.random` is banned in
 * src/sim (see tests/architecture.test.ts) so any run is reproducible from a seed.
 */
export class Rng {
  private s: number

  constructor(seed: number) {
    this.s = (seed >>> 0) || 0x9e3779b9
  }

  next(): number {
    this.s = (this.s + 0x6d2b79f5) >>> 0
    let t = this.s
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }

  float(min: number, max: number): number {
    return min + this.next() * (max - min)
  }

  /** Inclusive on both ends. */
  int(min: number, max: number): number {
    return Math.floor(this.float(min, max + 1))
  }

  chance(probability: number): boolean {
    return this.next() < probability
  }

  pick<T>(items: readonly T[]): T {
    if (items.length === 0) throw new Error('Rng.pick on empty array')
    return items[Math.floor(this.next() * items.length)]!
  }

  weighted<T>(entries: readonly { readonly weight: number; readonly value: T }[]): T {
    let total = 0
    for (const e of entries) total += e.weight
    if (total <= 0) throw new Error('Rng.weighted with no positive weight')
    let roll = this.next() * total
    for (const e of entries) {
      roll -= e.weight
      if (roll <= 0) return e.value
    }
    return entries[entries.length - 1]!.value
  }

  shuffled<T>(items: readonly T[]): T[] {
    const out = items.slice()
    for (let i = out.length - 1; i > 0; i--) {
      const j = Math.floor(this.next() * (i + 1))
      const a = out[i]!
      out[i] = out[j]!
      out[j] = a
    }
    return out
  }

  /**
   * A derived stream. Lets a subsystem (map gen, a loot roll) draw without
   * shifting the sequence every other subsystem sees.
   */
  fork(salt: number): Rng {
    return new Rng(Math.imul(this.s ^ salt, 0x85ebca6b) >>> 0)
  }

  get state(): number {
    return this.s
  }

  set state(value: number) {
    this.s = value >>> 0
  }
}
