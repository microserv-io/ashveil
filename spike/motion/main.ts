import '../../src/style.css'
import * as THREE from 'three'
import { disposeActorView, orientActorView, type ActorView } from '../../src/render/actorview'
import { loadModels } from '../../src/render/models'
import { MOTION_CLIPS, POSE_CLIPS, type MotionTimings, type PoseClipName } from '../../src/render/procedural/clips'
import type { RigState } from '../../src/render/rig'
import type { RigInput } from '../../src/render/riginput'
import { SceneHost } from '../../src/render/scene'
import { SKILLS } from '../../src/sim/skills'
import { Sim } from '../../src/sim/sim'
import { DT, HIT_FLASH_DURATION, type Actor } from '../../src/sim/types'
import { advanceCast, castLeft, castLength, castPhase, castTimings, describePhase, recovering } from './cast'
import {
  createReviewBodyView,
  loadReviewBodies,
  REVIEW_BODIES,
  reviewBodyScale,
  type ReviewBodyDefinition,
} from './body'

/**
 * One body, the gameplay camera, and every knob the animation pipeline has.
 *
 * Rocco's rule is that no animation merges until he has watched it, and watching
 * it in a real fight means waiting for the state you care about to happen. This
 * page asks for the state directly instead — through the same `ActorView` and
 * motion-driver contracts the game uses, so the review still exercises the real
 * runtime seams.
 */

const SEED = Number(new URLSearchParams(location.search).get('seed') ?? 7)
/** How far from the spawn the body may wander before it turns back. */
const LEASH = 4.5
/** How fast the turn button sweeps the body, and for how long. */
const TURN_RATE = 2.6
const TURN_DURATION = 0.8
const PANEL_KEY = 'ashveil.motion.panel'
/** Below this the panel would cover the body, so it starts out of the way. */
const NARROW_VIEWPORT = 640

const sim = new Sim({ seed: SEED })
await loadModels('models')
const bodySources = await loadReviewBodies()

const host = new SceneHost(document.getElementById('stage')!)
host.buildTerrain(sim.map)
globalThis.addEventListener('resize', () => host.resize())

const bodies = collectBodies()
const state = element<HTMLSelectElement>('state')
const bodySelect = element<HTMLSelectElement>('body')
const speed = element<HTMLInputElement>('speed')
const scale = element<HTMLInputElement>('scale')
const distance = element<HTMLInputElement>('distance')
const pitch = element<HTMLInputElement>('pitch')
const orbit = element<HTMLInputElement>('orbit')
const readout = element<HTMLPreElement>('readout')
const controls = element('controls')
const toggle = element<HTMLButtonElement>('panel-toggle')

fill(bodySelect, bodies.map((entry) => entry.id))
fill(state, ['idle', 'moving', 'dead', ...Object.keys(SKILLS), ...MOTION_CLIPS])
state.value = 'moving'

const input: RigInput = {
  state: 'moving',
  speed: 3,
  dashing: false,
  facingDelta: 0,
  phase: null,
  hitAge: null,
  ailments: [],
  time: 0,
  seed: 0,
  castLeft: 0,
  recovering: false,
}

let view: ActorView | null = null
let actor: Actor = bodies[0]!.actor
let bodyScale = reviewBodyScale(actor.radius)
let simTime = 0
let facing = 0
let previousFacing = 0
let turnLeft = 0
let hitAge: number | null = null
let castAt = 0
let stepQueued = false
let previous = performance.now()

rebuild()
recentre()

bodySelect.addEventListener('change', rebuild)
element('turn').addEventListener('click', () => (turnLeft = TURN_DURATION))
element('cycle').addEventListener('click', cycle)
state.addEventListener('change', cycle)
element('hit').addEventListener('click', () => (hitAge = 0))
element('step').addEventListener('click', () => (stepQueued = true))
element('recenter').addEventListener('click', recentre)
let panelOpen = readPanelPreference()
toggle.addEventListener('click', () => showPanels(!panelOpen))
showPanels(panelOpen)

// The same convenience the game exposes: the fastest way to poke at a live body.
Object.assign(globalThis, { motion: { host, sim, get view() { return view }, get actor() { return actor }, input } })

requestAnimationFrame(frame)

function frame(now: number): void {
  const wall = Math.min(0.1, (now - previous) / 1000)
  previous = now

  const timeScale = Number(scale.value)
  let delta = wall * timeScale
  // One click of Step is one sim tick, so a pose can be walked frame by frame
  // with the time scale at zero.
  if (stepQueued) delta = DT
  stepQueued = false
  simTime += delta

  if (turnLeft > 0) {
    turnLeft = Math.max(0, turnLeft - delta)
    facing += TURN_RATE * delta
  }

  writeInput(delta)
  const body = view!
  actor.facing = facing
  travel(delta)
  body.group.position.set(actor.pos.x, 0, actor.pos.y)
  orientActorView(body, actor)
  body.driver.update(input, delta)

  host.followPlayer(actor.pos, wall)
  placeCamera()
  host.render()

  element('summary').textContent =
    `procedural · ${input.state} · ${input.speed.toFixed(1)} m/s · ${describePhase(input.phase)}`
  element('distance-value').textContent = Number(distance.value).toFixed(1)
  element('pitch-value').textContent = Number(pitch.value).toFixed(0)
  element('orbit-value').textContent = Number(orbit.value).toFixed(0)
  element('speed-value').textContent = Number(speed.value).toFixed(1)
  element('scale-value').textContent = timeScale.toFixed(2)
  readout.textContent = describe(wall, castTimings(input.state))
  requestAnimationFrame(frame)
}

/**
 * The sliders start at the game's own camera, so the first question — does it read
 * at the distance a player sits — is answered before anything is touched. Then they
 * come down and in, because a body forty pixels tall and seen from overhead
 * cannot be judged for foot slide at all.
 */
function placeCamera(): void {
  const away = Number(distance.value)
  if (away >= GAMEPLAY_DISTANCE) return
  const angle = (Number(pitch.value) * Math.PI) / 180
  // Orbit is measured off the body's own facing, so the view a reviewer picked —
  // profile, front, over the shoulder — survives the body turning around.
  const around = facing + (Number(orbit.value) * Math.PI) / 180
  const target = CAMERA_TARGET.set(actor.pos.x, actor.radius * MID_BODY, actor.pos.y)
  const flat = Math.cos(angle) * away
  host.camera.position.set(target.x + Math.cos(around) * flat, target.y + Math.sin(angle) * away, target.z + Math.sin(around) * flat)
  host.camera.lookAt(target)
}

/** Aim at the chest while keeping the feet in frame. */
const MID_BODY = 1.9
/** The length of `scene.ts`'s own camera offset: the slider's top end is the real thing. */
const GAMEPLAY_DISTANCE = Math.hypot(19, 14.5)
const CAMERA_TARGET = new THREE.Vector3()

/** The body walks the ground it is standing on: foot slide is invisible in place. */
function travel(delta: number): void {
  if (input.state !== 'moving' && !input.dashing) return
  actor.pos.x += Math.cos(facing) * input.speed * delta
  actor.pos.y += Math.sin(facing) * input.speed * delta
  steerHome(delta)
}

/**
 * A body walking in a straight line leaves the room in a couple of seconds and
 * spends the rest of the review inside a wall. Past the leash it turns back, which
 * paces it around the spawn and puts a real turn in front of the reviewer for free.
 */
function steerHome(delta: number): void {
  const away = Math.hypot(actor.pos.x - sim.map.spawn.x, actor.pos.y - sim.map.spawn.y)
  if (away < LEASH) return
  const home = Math.atan2(sim.map.spawn.y - actor.pos.y, sim.map.spawn.x - actor.pos.x)
  const arc = Math.atan2(Math.sin(home - facing), Math.cos(home - facing))
  facing += Math.sign(arc) * Math.min(Math.abs(arc), TURN_RATE * delta)
}

function writeInput(delta: number): void {
  const chosen = state.value as RigState
  const acting = chosen !== 'idle' && chosen !== 'moving' && chosen !== 'dead'
  const timings = castTimings(chosen)
  const loop = chosen in POSE_CLIPS && POSE_CLIPS[chosen as PoseClipName].loop

  input.state = chosen
  input.speed = chosen === 'moving' ? Number(speed.value) : 0
  input.dashing = chosen === 'dash'
  input.facingDelta = Math.atan2(Math.sin(facing - previousFacing), Math.cos(facing - previousFacing))
  previousFacing = facing
  input.time = simTime
  input.seed = actor.id

  if (hitAge !== null) hitAge = hitAge + delta > HIT_FLASH_DURATION ? null : hitAge + delta
  input.hitAge = hitAge

  if (!acting) {
    input.phase = null
    input.castLeft = 0
    input.recovering = false
    castAt = castLength(timings)
    return
  }
  castAt = advanceCast(castAt, delta, timings, loop)
  input.phase = castPhase(castAt, timings)
  input.castLeft = castLeft(castAt, timings)
  input.recovering = recovering(castAt, timings)
}

function cycle(): void {
  castAt = 0
}

function rebuild(): void {
  const chosen = bodies.find((entry) => entry.id === bodySelect.value) ?? bodies[0]!
  if (view) {
    host.scene.remove(view.group)
    disposeActorView(view)
  }
  actor = chosen.actor
  view = createReviewBodyView(actor, bodySources.get(chosen.definition.id)!, chosen.definition)
  bodyScale = reviewBodyScale(actor.radius)
  host.scene.add(view.group)
}

function recentre(): void {
  actor.pos.x = sim.map.spawn.x
  actor.pos.y = sim.map.spawn.y
  host.followPlayer(actor.pos, 1)
}

interface ReviewBody {
  readonly id: string
  readonly actor: Actor
  readonly definition: ReviewBodyDefinition
}

/** Real actors from a real run, so nothing here has to invent a body the game never builds. */
function collectBodies(): ReviewBody[] {
  return REVIEW_BODIES.map((body) => ({ id: body.id, actor: sim.player, definition: body }))
}

function describe(wall: number, timings: MotionTimings): string {
  return [
    'driver     procedural',
    `body       ${bodySelect.value}`,
    `bodyScale  ${bodyScale.toFixed(6)}`,
    `cast       ${castAt.toFixed(2)}s of ${castLength(timings).toFixed(2)} (windup ${timings.windup.toFixed(2)}, recovery ${timings.recovery.toFixed(2)})`,
    `frame      ${(wall * 1000).toFixed(1)}ms`,
    '',
    `state      ${input.state}`,
    `speed      ${input.speed.toFixed(2)} m/s`,
    `dashing    ${input.dashing}`,
    `facing     ${facing.toFixed(2)} rad`,
    `facingΔ    ${input.facingDelta.toFixed(4)}`,
    `phase      ${describePhase(input.phase)}`,
    `hitAge     ${input.hitAge === null ? 'null' : input.hitAge.toFixed(3)}`,
    `time       ${input.time.toFixed(2)}s`,
    `seed       ${input.seed}`,
    `castLeft   ${input.castLeft.toFixed(2)}`,
    `recovering ${input.recovering}`,
  ].join('\n')
}

/**
 * The page is reviewed on a phone as often as on a desktop, and there the controls
 * cover the body they exist to show. Collapsed, everything folds into the top bar
 * and the camera keeps the body centred, so the toggle is the whole layout story.
 */
function showPanels(open: boolean): void {
  panelOpen = open
  controls.hidden = !open
  readout.hidden = !open
  toggle.setAttribute('aria-expanded', String(open))
  toggle.setAttribute('aria-label', open ? 'Hide controls' : 'Show controls')
  element('panel-toggle-icon').textContent = open ? '\u00d7' : '\u2261'
  // A viewer with no storage at all still gets a working page.
  try {
    localStorage.setItem(PANEL_KEY, open ? 'open' : 'closed')
  } catch {}
}

function readPanelPreference(): boolean {
  try {
    const stored = localStorage.getItem(PANEL_KEY)
    if (stored !== null) return stored === 'open'
  } catch {}
  return globalThis.innerWidth >= NARROW_VIEWPORT
}

function fill(select: HTMLSelectElement, values: readonly string[]): void {
  select.replaceChildren(
    ...values.map((value) => {
      const option = document.createElement('option')
      option.value = value
      option.textContent = value
      return option
    }),
  )
}

function element<T extends HTMLElement = HTMLElement>(id: string): T {
  const node = document.getElementById(id)
  if (!node) throw new Error(`missing #${id}`)
  return node as T
}
