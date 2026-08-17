import type { Sim } from '../sim/sim'
import { skill as skillDef } from '../sim/skills'
import { AIM_DEADZONE } from '../sim/targeting'
import type { Actor, EntityId, Intent, SkillId, Vec2 } from '../sim/types'
import { ActionState, type DigitalAction } from './actions'
import { GamepadBackend } from './gamepad'
import { KeyboardMouseBackend } from './keyboard'
import type { PadProfile } from './profiles'
import type { SceneHost } from './scene'

const MONSTER_PICK_RADIUS = 1.1
const PORTAL_INTERACT_RANGE = 2.4
const LOOT_RANGE = 2.5

export type Scheme = 'mouse' | 'gamepad'

export type UiAction = Extract<
  DigitalAction,
  'panel_gear' | 'panel_passives' | 'ui_confirm' | 'ui_cancel' | 'ui_up' | 'ui_down' | 'ui_left' | 'ui_right'
>

const UI_ACTIONS: readonly UiAction[] = [
  'panel_gear',
  'panel_passives',
  'ui_confirm',
  'ui_cancel',
  'ui_up',
  'ui_down',
  'ui_left',
  'ui_right',
]

export interface PollResult {
  intents: Intent[]
  ui: UiAction[]
}

export interface AimPreview {
  point: Vec2 | null
  targetId: EntityId | null
}

/**
 * Turns the frame's actions into Intents. It knows nothing about buttons — that
 * is the backends' job — so a new device is a profile, never a change here.
 *
 * Movement defaults to direct (stick or WASD). Click-to-move is still there for
 * anyone who wants the older feel; M toggles it.
 */
export class Controls {
  scheme: Scheme = 'mouse'
  movementMode: 'direct' | 'click' = 'direct'
  aimPreview: AimPreview = { point: null, targetId: null }

  private readonly state = new ActionState()
  private readonly pad = new GamepadBackend()
  private readonly keyboard: KeyboardMouseBackend
  private pointer: Vec2 | null = null
  private lastMoveAt = -1
  private lastMoveTarget: Vec2 | null = null

  constructor(element: HTMLElement, private readonly host: SceneHost) {
    this.keyboard = new KeyboardMouseBackend(element)
    element.addEventListener('pointermove', (event) => {
      const bounds = element.getBoundingClientRect()
      const ndcX = ((event.clientX - bounds.left) / bounds.width) * 2 - 1
      const ndcY = -((event.clientY - bounds.top) / bounds.height) * 2 + 1
      this.pointer = this.host.pointerToGround(ndcX, ndcY)
      this.scheme = 'mouse'
    })
  }

  get profile(): PadProfile {
    return this.pad.profile
  }

  get padConnected(): boolean {
    return this.pad.connected
  }

  poll(sim: Sim, panelOpen: boolean): PollResult {
    this.state.beginFrame()

    // Pad first: whatever it wrote is pad input, before the keyboard composes on top.
    this.pad.update(this.state)
    const padSpoke = this.state.anyInput
    this.keyboard.update(this.state)

    // Last device to say something owns the glyphs and the aiming model.
    if (this.keyboard.takeActivity()) this.scheme = 'mouse'
    else if (padSpoke && this.pad.connected) this.scheme = 'gamepad'

    const ui = UI_ACTIONS.filter((action) => this.state.justPressed(action))
    if (this.state.justPressed('toggle_movement_mode')) {
      this.movementMode = this.movementMode === 'direct' ? 'click' : 'direct'
    }

    if (panelOpen || sim.player.dead) {
      this.aimPreview = { point: null, targetId: null }
      return { intents: [], ui }
    }

    return { intents: this.gameplayIntents(sim), ui }
  }

  private gameplayIntents(sim: Sim): Intent[] {
    const intents: Intent[] = []
    const usingPad = this.scheme === 'gamepad'
    const aimStick = this.state.vector('aim_x', 'aim_y')
    const aiming = Math.hypot(aimStick.x, aimStick.y) >= AIM_DEADZONE

    // With a cursor the player has exact aim, so no assistance is applied. With a
    // stick there is no exact point, so the soft target resolves it.
    const explicitAim = usingPad ? null : this.pointer
    const stick = usingPad && aiming ? aimStick : null

    intents.push(...this.movement(sim, explicitAim, aiming ? aimStick : null))

    for (const [action, id] of SKILL_ACTIONS) {
      if (!this.state.isHeld(action)) continue
      intents.push({ kind: 'use_skill', skill: id, aim: this.aimFor(sim, id, explicitAim, stick) })
    }

    if (this.state.justPressed('interact')) intents.push(...this.interact(sim))
    if (this.state.justPressed('loot_all')) intents.push(...lootInRange(sim))

    this.aimPreview = usingPad ? previewFor(sim, stick) : { point: null, targetId: null }
    return intents
  }

  private movement(sim: Sim, cursor: Vec2 | null, aimStick: Vec2 | null): Intent[] {
    const direction = this.state.vector('move_x', 'move_y')

    if (this.movementMode === 'click' && this.scheme === 'mouse') {
      if (!this.state.isHeld('attack_primary') || !cursor) return []
      const target = this.monsterUnderCursor(sim)
      const reach = skillDef('cleave').range
      if (target && distanceBetween(target.pos, sim.player.pos) <= reach + target.radius) return []
      const destination = target ? target.pos : cursor
      return this.shouldRepath(sim, destination) ? [{ kind: 'move', to: destination }] : []
    }

    // Sent every frame: the sim lapses direct input, so silence means stop.
    const facing = aimStick
      ? Math.atan2(aimStick.y, aimStick.x)
      : cursor
        ? Math.atan2(cursor.y - sim.player.pos.y, cursor.x - sim.player.pos.x)
        : undefined
    return [{ kind: 'move_direction', direction, ...(facing === undefined ? {} : { facing }) }]
  }

  private aimFor(sim: Sim, id: SkillId, cursor: Vec2 | null, stick: Vec2 | null): Vec2 {
    if (cursor) return id === 'frost_nova' ? sim.player.pos : cursor
    return sim.aimFor(sim.player, id, stick).aim
  }

  private interact(sim: Sim): Intent[] {
    if (sim.areaCleared && distanceBetween(sim.player.pos, sim.map.portal) <= PORTAL_INTERACT_RANGE) {
      return [{ kind: 'enter_portal' }]
    }
    return lootInRange(sim)
  }

  private monsterUnderCursor(sim: Sim): Actor | null {
    if (!this.pointer) return null
    let best: Actor | null = null
    let bestGap = MONSTER_PICK_RADIUS
    for (const actor of sim.actors) {
      if (actor.kind !== 'monster' || actor.dead) continue
      const gap = distanceBetween(actor.pos, this.pointer) - actor.radius
      if (gap < bestGap) {
        best = actor
        bestGap = gap
      }
    }
    return best
  }

  /** A held button would otherwise request a fresh A* every frame. */
  private shouldRepath(sim: Sim, destination: Vec2): boolean {
    const drifted = !this.lastMoveTarget || distanceBetween(destination, this.lastMoveTarget) > 0.75
    if (!drifted && sim.time - this.lastMoveAt < 0.12) return false
    this.lastMoveAt = sim.time
    this.lastMoveTarget = { ...destination }
    return true
  }

  rumble(strong: number, weak: number, durationMs: number): void {
    if (this.scheme === 'gamepad') this.pad.rumble(strong, weak, durationMs)
  }
}

const SKILL_ACTIONS: readonly (readonly [DigitalAction, SkillId])[] = [
  ['attack_primary', 'cleave'],
  ['attack_secondary', 'firebolt'],
  ['skill_nova', 'frost_nova'],
  ['skill_dash', 'dash'],
]

function previewFor(sim: Sim, stick: Vec2 | null): AimPreview {
  const { aim, target } = sim.aimFor(sim.player, 'cleave', stick)
  return { point: aim, targetId: target?.id ?? null }
}

function lootInRange(sim: Sim): Intent[] {
  const intents: Intent[] = []
  for (const ground of sim.groundItems) {
    if (distanceBetween(ground.pos, sim.player.pos) <= LOOT_RANGE) {
      intents.push({ kind: 'pickup', itemId: ground.id })
    }
  }
  return intents
}

function distanceBetween(a: Vec2, b: Vec2): number {
  return Math.hypot(a.x - b.x, a.y - b.y)
}
