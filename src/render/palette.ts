/** One place for the look, so sim data never carries presentation decisions. */
export const PALETTE = {
  background: 0x0b0d12,
  fog: 0x0b0d12,
  floorLow: 0x241f1a,
  floorHigh: 0x342c23,
  wall: 0x14151b,
  wallTop: 0x1d1e26,

  player: 0xd9d3c4,
  playerAccent: 0xf26a1f,

  swarm: 0x6b7a5e,
  ranged: 0x5b6d8f,
  brute: 0x8a5240,

  magic: 0x4a7fd8,
  rare: 0xd8b24a,

  fire: 0xf26a1f,
  cold: 0x7fd8ff,
  lightning: 0xc9a6ff,
  physical: 0xe8e3d6,
  chaos: 0x9be07a,

  orb: 0xff5a4d,
  portal: 0x8f6fff,
} as const

export const RARITY_CSS: Record<string, string> = {
  normal: '#cfcabc',
  magic: '#7aa2ff',
  rare: '#e8c65a',
}

export const DAMAGE_CSS: Record<string, string> = {
  physical: '#e8e3d6',
  fire: '#ff8a3d',
  cold: '#7fd8ff',
  lightning: '#c9a6ff',
  chaos: '#9be07a',
}
