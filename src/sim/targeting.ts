import { angleDelta, angleOf, fromAngle, normalize, sub, type Vec2 } from './vec2'

/**
 * Aiming without a cursor. A controller has no point to click, so the game has to
 * decide what you meant: the stick when you push it, otherwise whatever you are
 * facing. This lives in the sim rather than the input layer because it decides who
 * gets hit, which makes it gameplay and therefore testable.
 */

export interface Targetable {
  id: number
  pos: Vec2
  radius: number
  dead: boolean
}

/** Below this, a stick is at rest and the game aims for you. */
export const AIM_DEADZONE = 0.25

export interface SoftTargetOptions {
  range: number
  coneDegrees: number
  /** World units charged per radian off-centre. Higher favours what you face. */
  angleWeight?: number
}

/**
 * Nearest enemy weighted by how far off-centre it is, so the thing you are looking
 * at wins over something marginally closer behind your shoulder.
 */
export function softTarget<T extends Targetable>(
  candidates: readonly T[],
  origin: Vec2,
  facing: number,
  options: SoftTargetOptions,
): T | null {
  const halfCone = (options.coneDegrees * Math.PI) / 360
  const angleWeight = options.angleWeight ?? 3.5

  let best: T | null = null
  let bestScore = Infinity

  for (const candidate of candidates) {
    if (candidate.dead) continue
    const offset = sub(candidate.pos, origin)
    const gap = Math.hypot(offset.x, offset.y) - candidate.radius
    if (gap > options.range) continue

    const off = Math.abs(angleDelta(facing, angleOf(offset)))
    if (off > halfCone) continue

    const score = Math.max(0, gap) + off * angleWeight
    if (score < bestScore) {
      best = candidate
      bestScore = score
    }
  }

  return best
}

/**
 * Where a skill is aimed. An explicit stick beats assistance; with no stick the
 * soft target is used; with neither, straight ahead so the skill still fires.
 */
export function aimPoint(
  origin: Vec2,
  facing: number,
  stick: Vec2 | null,
  range: number,
  target: Targetable | null,
): Vec2 {
  if (stick) {
    const magnitude = Math.hypot(stick.x, stick.y)
    if (magnitude >= AIM_DEADZONE) {
      const direction = normalize(stick)
      return { x: origin.x + direction.x * range, y: origin.y + direction.y * range }
    }
  }
  if (target) return { x: target.pos.x, y: target.pos.y }
  const forward = fromAngle(facing, range)
  return { x: origin.x + forward.x, y: origin.y + forward.y }
}

/**
 * Melee assists across almost the full circle so a swing does not whiff on
 * something you are clearly standing in; projectiles stay honest to your facing.
 */
export function assistCone(shape: 'melee_arc' | 'nova' | 'projectile' | 'dash'): number {
  switch (shape) {
    case 'melee_arc':
      return 200
    case 'projectile':
      return 110
    default:
      return 150
  }
}

/** Radial deadzone with rescaling, so the first millimetre of travel is usable. */
export function applyDeadzone(input: Vec2, deadzone: number): Vec2 {
  const magnitude = Math.hypot(input.x, input.y)
  if (magnitude <= deadzone) return { x: 0, y: 0 }
  const scaled = Math.min(1, (magnitude - deadzone) / (1 - deadzone))
  return { x: (input.x / magnitude) * scaled, y: (input.y / magnitude) * scaled }
}
