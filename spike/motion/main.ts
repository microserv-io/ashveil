import '../../src/style.css'
import * as THREE from 'three'
import { disposeActorView, orientActorView, type ActorView } from '../../src/render/actorview'
import {
  applyBodyMasks,
  applyGearMasks,
  removePiece,
  updateWornPieces,
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
import { loadReviewGear, REVIEW_GEAR, type ReviewGearPiece } from './gear'

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
/** The bounds `art:socket` puts on an authored pose, so the page cannot ask for one it refuses. */
const ORIENT_LIMIT = 90
const OFFSET_LIMIT = 0.1
const OFFSET_STEP = 0.005

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
const poseSliders = new Map<PoseKey, HTMLInputElement>()
const socketBinds = new Map<string, BindPose>()
const poseAsked = hasPoseQuery()
const pose = readPoseQuery()
let posed: SocketPiece[] = []

buildGearPanel()
buildSocketPanel()
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
Object.assign(globalThis, {
  motion: {
    host, sim, get view() { return view }, get actor() { return actor }, input,
    socket: {
      set: setPose,
      get pose() { return { ...pose } },
      get flags() { return poseFlags() },
      get pieces() { return posed.map((target) => target.piece) },
    },
  },
})

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
  // After the body's own pose: a drape hangs off a bone that has already moved.
  updateWornPieces(worn, input, delta)

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
  const dressed = REVIEW_GEAR.filter((entry) => wearing.has(entry.piece) && gearSources.has(entry.piece))
  worn = dressed.map((entry) => {
    const loaded = gearSources.get(entry.piece)!
    return wearPiece(body.group, {
      slot: entry.slot,
      scene: loaded.scene,
      covers: loaded.covers,
      hides: loaded.hides,
      drapes: loaded.drapes,
      hidesPieces: loaded.hidesPieces,
      regions: loaded.regions,
      hidesRegions: loaded.hidesRegions,
      hidesBand: loaded.hidesBand,
      hidesProfile: loaded.hidesProfile,
    })
  })
  applyBodyMasks(body.group, worn)
  applyGearMasks(worn)
  viewMaterialsWith(body, bodyMaterials, worn)
  posed = dressed.flatMap((entry, at) => socketPieceOf(entry, worn[at]!))
  showSocketPanel()
  // With nothing asked for, the sliders start where the fit left the piece, so moving
  // one is a change to the pose that shipped rather than to an arbitrary zero.
  if (!poseAsked && posed[0]) setPose(posed[0].fitted)
  else writePose()
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
  element('gear-all').addEventListener('click', () =>
    setGear(REVIEW_GEAR.filter((entry) => !entry.compare).map((entry) => entry.piece)))
  element('gear-bare').addEventListener('click', () => setGear([]))
}

function setGear(pieces: readonly string[]): void {
  wearing.clear()
  for (const piece of pieces) if (gearSources.has(piece)) wearing.add(piece)
  for (const [piece, box] of gearBoxes) box.checked = wearing.has(piece)
  rewear()
}

/**
 * Authoring a shoulder's pose, live.
 *
 * A pauldron's orientation is declared per item rather than derived - three
 * derivations were tried on this one and each landed a pose that was rejected on
 * sight - so the page has to be where it is declared. The sliders carry the same
 * `--orient yaw:pitch:roll --offset dx:dy:dz` the fitter takes, and they are the
 * fitter's own numbers rather than a nudge on top of them: the piece arrives already
 * posed, so what is applied is the difference between where the sliders stand and
 * where the manifest says the fit left it. A slider at the fitted value moves nothing
 * and the readout is the flag string that refits exactly what is on screen.
 *
 * The piece is a `SkinnedMesh` bound to the body's own skeleton, so nothing here may
 * move the mesh: what moves is a copy of its bind-pose positions, and the body's
 * skinning still runs over the result. The cloth's own chain is not re-hung, so a
 * swinging drape still swings about where the fitter hung it - the sliders are how a
 * pose is found, and the refit is what makes it true.
 */
type PoseKey = 'yaw' | 'pitch' | 'roll' | 'x' | 'y' | 'z'

interface BindPose {
  readonly position: Float32Array
  readonly normal: Float32Array | null
}

interface SocketPiece {
  readonly piece: string
  readonly mesh: THREE.SkinnedMesh
  readonly bind: BindPose
  readonly crest: Readonly<Record<'L' | 'R', THREE.Vector3>>
  /** The pose the fitter already applied, which the sliders are stated against. */
  readonly fitted: Record<PoseKey, number>
}

/** A function, not a table: the panel is built above, where a `const` here is still dead. */
function poseRows(): readonly (readonly [PoseKey, string, number, number])[] {
  return [
    ['yaw', 'Yaw', ORIENT_LIMIT, 1], ['pitch', 'Pitch', ORIENT_LIMIT, 1], ['roll', 'Roll', ORIENT_LIMIT, 1],
    ['x', 'Offset X', OFFSET_LIMIT, OFFSET_STEP], ['y', 'Offset Y', OFFSET_LIMIT, OFFSET_STEP],
    ['z', 'Offset Z', OFFSET_LIMIT, OFFSET_STEP],
  ]
}

/**
 * Only a comparison piece is re-posed: the shipped one in a slot is what it is, and
 * a piece fitted before the crest was written has no point to turn about.
 */
function socketPieceOf(entry: ReviewGearPiece, piece: WornPiece): SocketPiece[] {
  const crests = gearSources.get(entry.piece)?.crests
  if (entry.slot !== 'shoulders' || !entry.compare || !crests) return []
  // The geometry is shared with the loaded source and survives a rewear, so the bind
  // pose is taken the first time the piece is seen and never off an already-posed mesh.
  const geometry = piece.mesh.geometry
  const stored = socketBinds.get(entry.piece) ?? {
    position: Float32Array.from(geometry.getAttribute('position').array as Float32Array),
    normal: geometry.getAttribute('normal')
      ? Float32Array.from(geometry.getAttribute('normal').array as Float32Array)
      : null,
  }
  socketBinds.set(entry.piece, stored)
  return [{
    piece: entry.piece,
    mesh: piece.mesh,
    bind: stored,
    crest: { L: vectorOf(crests.L), R: vectorOf(crests.R) },
    fitted: {
      yaw: crests.orient[0]!, pitch: crests.orient[1]!, roll: crests.orient[2]!,
      x: crests.offset[0]!, y: crests.offset[1]!, z: crests.offset[2]!,
    },
  }]
}

function vectorOf(values: readonly number[]): THREE.Vector3 {
  return new THREE.Vector3(values[0], values[1], values[2])
}

/**
 * The turn one side takes. Mirroring about X negates a rotation about Y and one
 * about Z and leaves one about X alone, so the right shoulder wears the author's own
 * numbers with the yaw and the roll turned round: the same rule `socket.py` applies,
 * spelled the same way, or the page and the fitter would disagree by a mirror.
 */
function poseTurn(hand: number, values: Record<PoseKey, number>): THREE.Matrix4 {
  return new THREE.Matrix4().makeRotationY(radians(hand * values.yaw))
    .multiply(new THREE.Matrix4().makeRotationX(radians(values.pitch)))
    .multiply(new THREE.Matrix4().makeRotationZ(radians(hand * values.roll)))
}

function radians(degrees: number): number {
  return (degrees * Math.PI) / 180
}

/**
 * What is left to apply once the fit's own pose is taken off: `wanted` turned by the
 * inverse of `fitted`, which is exactly what refitting at `wanted` would have done.
 */
function poseDelta(hand: number, fitted: Record<PoseKey, number>): THREE.Matrix4 {
  return poseTurn(hand, pose).multiply(poseTurn(hand, fitted).transpose())
}

/** Both sides at once, since which side a vertex belongs to is the sign of its X. */
function writePose(): void {
  for (const target of posed) {
    const sides = (['L', 'R'] as const).map((side) => {
      const hand = side === 'L' ? 1 : -1
      return { side, hand, turn: poseDelta(hand, target.fitted) }
    })
    const geometry = target.mesh.geometry
    const position = geometry.getAttribute('position') as THREE.BufferAttribute
    const normal = geometry.getAttribute('normal') as THREE.BufferAttribute | undefined
    const shifts = sides.map(({ side, hand, turn }) => target.crest[side].clone()
      .add(new THREE.Vector3(hand * (pose.x - target.fitted.x), pose.y - target.fitted.y,
        pose.z - target.fitted.z))
      .sub(target.crest[side].clone().applyMatrix4(turn)))
    const point = new THREE.Vector3()
    for (let at = 0; at < position.count; at++) {
      const chosen = target.bind.position[at * 3]! >= 0 ? 0 : 1
      point.fromArray(target.bind.position, at * 3).applyMatrix4(sides[chosen]!.turn).add(shifts[chosen]!)
      position.setXYZ(at, point.x, point.y, point.z)
      // A rigid turn carries the normals with it exactly, so nothing here re-averages
      // the source's own shading and turns its hard lame edges soft.
      if (normal && target.bind.normal) {
        point.fromArray(target.bind.normal, at * 3).applyMatrix4(sides[chosen]!.turn)
        normal.setXYZ(at, point.x, point.y, point.z)
      }
    }
    position.needsUpdate = true
    if (normal) normal.needsUpdate = true
    geometry.computeBoundingSphere()
    geometry.computeBoundingBox()
  }
  element('socket-flags').textContent = poseFlags()
}

/** The flags that reproduce what is on screen, spelled the way `art:socket` prints them. */
function poseFlags(): string {
  return `--orient ${short(pose.yaw)}:${short(pose.pitch)}:${short(pose.roll)}`
    + ` --offset ${short(pose.x, 4)}:${short(pose.y, 4)}:${short(pose.z, 4)}`
}

function short(value: number, places = 2): string {
  const text = value.toFixed(places).replace(/0+$/, '').replace(/\.$/, '')
  return text === '' || text === '-0' ? '0' : text
}

function buildSocketPanel(): void {
  const panel = document.createElement('div')
  panel.id = 'socket-panel'
  panel.className = 'space-y-1 border-t border-ash-600 pt-2'
  const title = document.createElement('span')
  title.className = 'text-ash-300 text-[11px] uppercase tracking-wide'
  title.textContent = 'Shoulder pose'
  const flags = document.createElement('code')
  flags.id = 'socket-flags'
  flags.className = 'block bg-ash-800 border border-ash-600 rounded px-2 py-1 text-[11px] break-all'
  const copy = document.createElement('button')
  copy.className = 'w-full bg-ash-700 hover:bg-ash-600 border border-ash-600 rounded px-2 py-1'
  copy.textContent = 'Copy flags'
  copy.addEventListener('click', () => {
    navigator.clipboard?.writeText(poseFlags()).catch(() => {})
    copy.textContent = 'Copied'
    setTimeout(() => (copy.textContent = 'Copy flags'), 1200)
  })
  panel.append(title, ...poseRows().map(poseSlider), flags, copy)
  element('gear-panel').after(panel)
}

function poseSlider([key, label, limit, step]: readonly [PoseKey, string, number, number]): HTMLElement {
  const wrapper = document.createElement('label')
  wrapper.className = 'block space-y-1'
  const name = document.createElement('span')
  name.className = 'text-ash-300 text-[11px] uppercase tracking-wide'
  const slider = document.createElement('input')
  slider.type = 'range'
  slider.min = String(-limit)
  slider.max = String(limit)
  slider.step = String(step)
  slider.value = String(pose[key])
  slider.className = 'w-full accent-ember'
  const show = () => (name.textContent = `${label} ${short(pose[key], step < 1 ? 3 : 0)}`)
  slider.addEventListener('input', () => {
    pose[key] = Number(slider.value)
    show()
    writePose()
  })
  show()
  poseSliders.set(key, slider)
  wrapper.append(name, slider)
  return wrapper
}

function showSocketPanel(): void {
  element('socket-panel').hidden = posed.length === 0
}

function hasPoseQuery(): boolean {
  const query = new URLSearchParams(location.search)
  return query.has('orient') || query.has('offset')
}

/** `?orient=12:-8:0&offset=0.01:0:-0.005` lands the page on a pose already dialled. */
function readPoseQuery(): Record<PoseKey, number> {
  const query = new URLSearchParams(location.search)
  const read = (name: string, limit: number): number[] => {
    const parts = (query.get(name) ?? '').split(':').map(Number)
    return parts.length === 3 && parts.every((value) => Number.isFinite(value))
      ? parts.map((value) => Math.max(-limit, Math.min(limit, value)))
      : [0, 0, 0]
  }
  const [yaw, pitch, roll] = read('orient', ORIENT_LIMIT)
  const [x, y, z] = read('offset', OFFSET_LIMIT)
  return { yaw: yaw!, pitch: pitch!, roll: roll!, x: x!, y: y!, z: z! }
}

/** The same pose from the console, for a sweep no hand wants to drag out one step at a time. */
function setPose(next: Partial<Record<PoseKey, number>>): string {
  for (const [key, limit] of [['yaw', ORIENT_LIMIT], ['pitch', ORIENT_LIMIT], ['roll', ORIENT_LIMIT],
    ['x', OFFSET_LIMIT], ['y', OFFSET_LIMIT], ['z', OFFSET_LIMIT]] as const) {
    const value = next[key]
    if (value === undefined) continue
    pose[key] = Math.max(-limit, Math.min(limit, value))
    const slider = poseSliders.get(key)
    if (slider) {
      slider.value = String(pose[key])
      slider.dispatchEvent(new Event('input', { bubbles: true }))
    }
  }
  writePose()
  return poseFlags()
}

/**
 * The first chain of each draped piece, in degrees from hanging straight down. It
 * is the one number that says whether the cloth is swinging, trailing or stuck
 * against a clamp, and reading it beats guessing from a body forty pixels tall.
 */
function drapeLines(): string[] {
  return worn.flatMap((piece) => {
    const chain = piece.drapes[0]
    if (!chain) return []
    const swing = [...chain.state.swing].map((angle) => degrees(angle)).join(' ')
    const side = [...chain.state.side].map((angle) => degrees(angle)).join(' ')
    return [`${chain.name.padEnd(10).slice(0, 10)} swing ${swing} · side ${side}`]
  })
}

function degrees(radians: number): string {
  return ((radians * 180) / Math.PI).toFixed(1).padStart(6)
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
 * A comparison entry is the exception and starts off: two pieces in one slot are a
 * side by side, not an outfit.
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
  return new Set(REVIEW_GEAR.filter((entry) => !entry.compare && !off.has(entry.piece))
    .map((entry) => entry.piece))
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
    ...drapeLines(),
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
