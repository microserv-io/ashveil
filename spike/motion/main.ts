import '../../src/style.css'
import * as THREE from 'three'
import { disposeActorView, orientActorView, type ActorView } from '../../src/render/actorview'
import {
  applyBodyMasks,
  applyGearMasks,
  removePiece,
  viewMaterialsWith,
  wearPiece,
  type WornPiece,
} from '../../src/render/gear'
import { loadModels } from '../../src/render/models'
import type { RigState } from '../../src/render/rig'
import type { RigInput } from '../../src/render/riginput'
import { SceneHost } from '../../src/render/scene'
import { SKILLS } from '../../src/sim/skills'
import { Sim } from '../../src/sim/sim'
import { DT, HIT_FLASH_DURATION, type Actor } from '../../src/sim/types'
import { CAST_LENGTH, castLeft, castPhase, describePhase, recovering } from './cast'
import {
  createReviewBodyView,
  loadReviewBodies,
  REVIEW_BODIES,
  reviewBodyScale,
  type ReviewBodyDefinition,
} from './body'
import { loadReviewGear, REVIEW_GEAR } from './gear'

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
const GEAR_KEY = 'ashveil.motion.gear.off'
/** Below this the panel would cover the body, so it starts out of the way. */
const NARROW_VIEWPORT = 640

const sim = new Sim({ seed: SEED })
await loadModels('models')
const bodySources = await loadReviewBodies()
const gearSources = await loadReviewGear()

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
fill(state, ['idle', 'moving', 'dead', ...Object.keys(SKILLS)])
state.value = 'moving'
applyQuery()

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
let worn: WornPiece[] = []
let bodyMaterials = 0
const wearing = readGearPreference()
// Declared before the panel is built: a `const` below that call is still in its
// temporal dead zone when the first checkbox is made.
const gearBoxes = new Map<string, HTMLInputElement>()

buildGearPanel()
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
  readout.textContent = describe(wall)
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
    castAt = CAST_LENGTH
    return
  }
  // The cast plays once and holds, so a struck pose can be looked at. Cycle runs it again.
  castAt = Math.min(CAST_LENGTH, castAt + delta)
  input.phase = castPhase(castAt)
  input.castLeft = castLeft(castAt)
  input.recovering = recovering(castAt)
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
  // The pieces belong to the reviewer's session, not to one body, so a rebuild
  // puts back whatever was on.
  worn = []
  bodyMaterials = view.materials.length
  rewear()
}

/**
 * Gear rides the body's own skeleton, so wearing is attach-time work: bind the
 * piece, hide the body under it, and hand the worn materials to the view so the
 * hit flash and death fade cover them.
 */
function rewear(): void {
  const body = view!
  for (const piece of worn) removePiece(body.group, piece)
  worn = REVIEW_GEAR.filter((entry) => wearing.has(entry.piece)).flatMap((entry) => {
    const loaded = gearSources.get(entry.piece)
    return loaded
      ? [wearPiece(body.group, {
        slot: entry.slot, scene: loaded.scene, covers: loaded.covers, hides: loaded.hides,
      })]
      : []
  })
  applyBodyMasks(body.group, worn)
  applyGearMasks(worn)
  viewMaterialsWith(body, bodyMaterials, worn)
  saveGear()
}

function buildGearPanel(): void {
  element('gear-panel').hidden = REVIEW_GEAR.length === 0
  element('gear').replaceChildren(
    ...REVIEW_GEAR.map((entry) => {
      const missing = !gearSources.has(entry.piece)
      const label = document.createElement('label')
      label.className = missing ? 'flex items-center gap-2 opacity-40' : 'flex items-center gap-2'
      if (missing) label.title = 'this piece did not load; see the console'
      const box = document.createElement('input')
      box.type = 'checkbox'
      box.disabled = missing
      box.checked = !missing && wearing.has(entry.piece)
      box.className = 'accent-ember'
      box.addEventListener('change', () => {
        if (box.checked) wearing.add(entry.piece)
        else wearing.delete(entry.piece)
        rewear()
      })
      const name = document.createElement('span')
      name.textContent = `${entry.slot} · ${entry.piece}`
      label.append(box, name)
      gearBoxes.set(entry.piece, box)
      return label
    }),
  )
  element('gear-all').addEventListener('click', () => setGear(REVIEW_GEAR.map((entry) => entry.piece)))
  element('gear-bare').addEventListener('click', () => setGear([]))
}

function setGear(pieces: readonly string[]): void {
  wearing.clear()
  for (const piece of pieces) if (gearSources.has(piece)) wearing.add(piece)
  for (const [piece, box] of gearBoxes) box.checked = wearing.has(piece)
  rewear()
}

function wornSlots(): string {
  return worn.length === 0 ? 'bare' : worn.map((piece) => piece.slot).join(' ')
}

function saveGear(): void {
  try {
    const off = REVIEW_GEAR.filter((entry) => !wearing.has(entry.piece)).map((entry) => entry.piece)
    localStorage.setItem(GEAR_KEY, JSON.stringify(off))
  } catch {}
}

/**
 * Dressed unless the reviewer said otherwise, so the bare body is the special case.
 * What is stored is what was taken off, not what was put on: a piece fitted since
 * the reviewer last set this is worn, rather than hidden by a preference written
 * before it existed.
 */
function readGearPreference(): Set<string> {
  const off = new Set<string>()
  try {
    const stored = localStorage.getItem(GEAR_KEY)
    if (stored) for (const piece of JSON.parse(stored) as string[]) off.add(piece)
  } catch {}
  return new Set(REVIEW_GEAR.filter((entry) => !off.has(entry.piece)).map((entry) => entry.piece))
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

function describe(wall: number): string {
  return [
    'driver     procedural',
    `body       ${bodySelect.value}`,
    `bodyScale  ${bodyScale.toFixed(6)}`,
    `gear       ${wornSlots()}`,
    `cast       ${castAt.toFixed(2)}s of ${CAST_LENGTH.toFixed(2)}`,
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

/**
 * `?state=idle&distance=3&pitch=12&orbit=90&speed=2&time=0&panel=closed` sets the
 * page up from the URL, so a screenshot or a phone can land on an exact view.
 */
function applyQuery(): void {
  const query = new URLSearchParams(location.search)
  const sliders: readonly (readonly [string, HTMLInputElement | HTMLSelectElement])[] = [
    ['state', state], ['speed', speed], ['time', scale], ['distance', distance], ['pitch', pitch], ['orbit', orbit],
  ]
  for (const [key, control] of sliders) {
    const value = query.get(key)
    if (value !== null) control.value = value
  }
}

function readPanelPreference(): boolean {
  const query = new URLSearchParams(location.search).get('panel')
  if (query === 'closed') return false
  if (query === 'open') return true
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
