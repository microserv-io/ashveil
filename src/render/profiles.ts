import type { DigitalAction } from './actions'

export type PadLayout = 'xbox' | 'playstation' | 'deck'

/**
 * A trackpad reports an absolute position on two axes and a click/touch button.
 * Untouched pads rest at 0, which is also the centre, so the touch flag is what
 * tells us the reading means anything.
 */
export interface TouchpadBinding {
  axes: readonly [number, number]
  touchButton: number
  /** Where the reading goes: aim like a mouse, or scroll a panel. */
  role: 'aim' | 'navigate'
}

export interface PadProfile {
  id: string
  label: string
  layout: PadLayout
  /** Several sources may drive one action; any of them fires it. */
  buttons: Partial<Record<DigitalAction, readonly number[]>>
  moveAxes: readonly [number, number]
  aimAxes: readonly [number, number]
  touchpads?: readonly TouchpadBinding[]
  /** Shown in the HUD so a player can tell which mapping they got. */
  extras?: readonly string[]
}

/** Standard-mapping indices, the layout every mainstream pad reports. */
const STANDARD = {
  south: 0,
  east: 1,
  west: 2,
  north: 3,
  l1: 4,
  r1: 5,
  l2: 6,
  r2: 7,
  select: 8,
  start: 9,
  dpadUp: 12,
  dpadDown: 13,
  dpadLeft: 14,
  dpadRight: 15,
} as const

const STANDARD_BUTTONS: PadProfile['buttons'] = {
  attack_primary: [STANDARD.r2],
  attack_secondary: [STANDARD.r1],
  skill_nova: [STANDARD.l1],
  skill_dash: [STANDARD.l2],
  interact: [STANDARD.south],
  loot_all: [STANDARD.west],
  panel_gear: [STANDARD.north],
  panel_passives: [STANDARD.start],
  ui_confirm: [STANDARD.south],
  ui_cancel: [STANDARD.east],
  ui_up: [STANDARD.dpadUp],
  ui_down: [STANDARD.dpadDown],
  ui_left: [STANDARD.dpadLeft],
  ui_right: [STANDARD.dpadRight],
  toggle_movement_mode: [STANDARD.select],
}

export const STANDARD_PROFILE: PadProfile = {
  id: 'standard',
  label: 'Gamepad',
  layout: 'xbox',
  buttons: STANDARD_BUTTONS,
  moveAxes: [0, 1],
  aimAxes: [2, 3],
}

export const PLAYSTATION_PROFILE: PadProfile = {
  ...STANDARD_PROFILE,
  id: 'playstation',
  label: 'DualSense',
  layout: 'playstation',
}

/**
 * A Steam Deck presented RAW (desktop mode, Steam Input not intercepting) reports
 * its back grips and trackpads as extra buttons and axes beyond the standard set.
 *
 * Through Steam these never appear — Steam Input binds them onto the standard pad
 * instead, which is why the real fix is the Steamworks backend described in
 * README. Indices past the end of what the device actually reports simply never
 * fire, so a wrong guess here degrades to the standard layout rather than breaking.
 *
 * Back grips carry the actions you need while both thumbs are already busy: evade,
 * loot, and interact are exactly that in this loop.
 */
const DECK = {
  l4: 17,
  r4: 18,
  l5: 19,
  r5: 20,
  leftPadTouch: 21,
  rightPadTouch: 22,
  leftPadAxes: [4, 5] as const,
  rightPadAxes: [6, 7] as const,
} as const

export const DECK_PROFILE: PadProfile = {
  id: 'deck-extended',
  label: 'Steam Deck',
  layout: 'deck',
  buttons: {
    ...STANDARD_BUTTONS,
    skill_dash: [STANDARD.l2, DECK.l4],
    interact: [STANDARD.south, DECK.r4],
    loot_all: [STANDARD.west, DECK.l5],
    panel_gear: [STANDARD.north, DECK.r5],
  },
  moveAxes: [0, 1],
  aimAxes: [2, 3],
  touchpads: [
    { axes: DECK.rightPadAxes, touchButton: DECK.rightPadTouch, role: 'aim' },
    { axes: DECK.leftPadAxes, touchButton: DECK.leftPadTouch, role: 'navigate' },
  ],
  extras: ['L4 dash', 'R4 interact', 'L5 loot', 'R5 gear', 'right pad aims'],
}

/**
 * Capability detection rather than name matching: a device that reports more than
 * the standard set has extras worth binding, whatever it calls itself.
 */
export function profileFor(pad: Gamepad): PadProfile {
  const id = pad.id.toLowerCase()
  const hasExtras = pad.buttons.length > 17 || pad.axes.length > 4
  const looksLikeDeck = id.includes('steam deck') || id.includes('valve')

  if (hasExtras && (looksLikeDeck || id.includes('steam'))) return DECK_PROFILE
  if (id.includes('054c') || id.includes('dualsense') || id.includes('dualshock') || id.includes('playstation')) {
    return PLAYSTATION_PROFILE
  }
  return STANDARD_PROFILE
}

const GLYPHS: Record<PadLayout, Record<string, string>> = {
  xbox: { primary: 'RT', secondary: 'RB', nova: 'LB', dash: 'LT', interact: 'A', loot: 'X', gear: 'Y', passives: 'Menu' },
  deck: { primary: 'R2', secondary: 'R1', nova: 'L1', dash: 'L4', interact: 'R4', loot: 'L5', gear: 'R5', passives: 'Menu' },
  playstation: { primary: 'R2', secondary: 'R1', nova: 'L1', dash: 'L2', interact: '✕', loot: '□', gear: '△', passives: 'Options' },
}

export function glyphFor(profile: PadProfile, slot: string): string {
  return GLYPHS[profile.layout]?.[slot] ?? slot.toUpperCase()
}
