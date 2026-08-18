import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { clone as cloneRigged } from 'three/examples/jsm/utils/SkeletonUtils.js'
import { PALETTE } from '../../src/render/palette'
import { areaRng, generateArea, isFloor } from '../../src/sim/mapgen'
import type { AreaMap } from '../../src/sim/types'
import { ASHVEIL_CLIP, STATE_ORDER, type ShownState } from './clips'

/**
 * Does CC0 art hold up in Ashveil's actual camera, on Ashveil's actual dungeon?
 *
 * The geometry here is the real `generateArea` output, not a mocked room, because
 * the question is whether the kit survives corridors the mapgen actually produces.
 * Nothing in `src/` is modified: the spike reads the sim, the way the renderer does.
 */

const SEED = Number(new URLSearchParams(location.search).get('seed') ?? 7)
const DEPTH = Number(new URLSearchParams(location.search).get('depth') ?? 1)

/**
 * KayKit's floor tile is 4 units across and Ashveil's sim tile is 1, so one floor
 * model covers a 4x4 block of sim tiles. Laying one per sim tile instead costs 16x
 * the geometry for no visible gain — that measured 1.78M triangles at 5fps.
 *
 * The sim grid is a collision grid, not a visual one. Nothing requires them to match.
 */
const FLOOR_SPAN = 4
/**
 * Walls are laid on the same 4-unit visual grid as the floor. Squeezing a 4-wide
 * wall onto each 1-unit sim tile instead repeats its carved detail four times over
 * and reads as corrugated stripes, which is what the first pass of this spike did.
 */
const WALL_MODE: 'block' | 'squeezed' = 'block'
/**
 * Sized by height, not by the collision circle. Matching the sim's 0.88 diameter
 * against the model's 1.94 arm span reads as "tiny" — arm span is not body width.
 * A KayKit character is 2.17 units tall, so 0.85 puts it at ~1.85 sim units, which
 * treats one sim unit as roughly one metre and agrees with the 4-unit floor tile.
 */
let characterScale = 0.85

const CHARACTERS = ['player', 'swarm', 'ranged', 'brute'] as const
const PROPS = ['loot_normal', 'loot_magic', 'loot_rare', 'orb'] as const
const TILES = ['floor', 'floor_rocks', 'wall', 'portal'] as const

type AssetName = (typeof CHARACTERS)[number] | (typeof PROPS)[number] | (typeof TILES)[number]

const loader = new GLTFLoader()
const loaded = new Map<AssetName, Awaited<ReturnType<GLTFLoader['loadAsync']>>>()

async function loadAll(): Promise<void> {
  const names: AssetName[] = [...CHARACTERS, ...PROPS, ...TILES]
  const gltfs = await Promise.all(names.map((n) => loader.loadAsync(`./models/${n}.glb`)))
  names.forEach((n, i) => loaded.set(n, gltfs[i]!))
}

// ---------------------------------------------------------------------------
// Scene, matched to src/render/scene.ts so the judgement is honest
// ---------------------------------------------------------------------------

const scene = new THREE.Scene()
scene.background = new THREE.Color(PALETTE.background)
scene.fog = new THREE.Fog(PALETTE.fog, 30, 62)

const camera = new THREE.PerspectiveCamera(38, 1, 0.5, 220)
const CAMERA_OFFSET = new THREE.Vector3(0, 19, 14.5)

const renderer = new THREE.WebGLRenderer({ antialias: true })
renderer.shadowMap.enabled = true
renderer.shadowMap.type = THREE.PCFSoftShadowMap
document.getElementById('stage')!.append(renderer.domElement)

scene.add(new THREE.AmbientLight(0x404a5c, 1.1))
const key = new THREE.DirectionalLight(0xffe6c4, 1.5)
key.position.set(12, 22, 8)
key.castShadow = true
key.shadow.mapSize.set(2048, 2048)
key.shadow.camera.near = 1
key.shadow.camera.far = 90
for (const [side, value] of [['left', -30], ['right', 30], ['top', 30], ['bottom', -30]] as const) {
  ;(key.shadow.camera as unknown as Record<string, number>)[side] = value
}
key.shadow.camera.updateProjectionMatrix()
scene.add(key)
const rim = new THREE.DirectionalLight(0x4a6cff, 0.35)
rim.position.set(-10, 8, -12)
scene.add(rim)

// ---------------------------------------------------------------------------

/** One instanced draw per distinct tile model, the way the real terrain should do it. */
function buildTerrain(map: AreaMap): THREE.Group {
  const group = new THREE.Group()
  const floors: THREE.Matrix4[] = []
  const rocky: THREE.Matrix4[] = []
  const walls: THREE.Matrix4[] = []

  for (let by = 0; by < map.height; by += FLOOR_SPAN) {
    for (let bx = 0; bx < map.width; bx += FLOOR_SPAN) {
      if (!blockHasFloor(map, bx, by)) continue
      const at = new THREE.Matrix4().setPosition(bx + FLOOR_SPAN / 2, 0, by + FLOOR_SPAN / 2)
      // A scatter of the rocky variant stops a large room reading as graph paper.
      ;((bx * 7 + by * 13) % 9 === 0 ? rocky : floors).push(at)
    }
  }

  if (WALL_MODE === 'block') {
    for (let by = 0; by < map.height; by += FLOOR_SPAN) {
      for (let bx = 0; bx < map.width; bx += FLOOR_SPAN) {
        if (blockHasFloor(map, bx, by) || !blockTouchesFloor(map, bx, by)) continue
        walls.push(new THREE.Matrix4().setPosition(bx + FLOOR_SPAN / 2, 0, by + FLOOR_SPAN / 2))
      }
    }
  } else {
    for (let ty = 0; ty < map.height; ty++) {
      for (let tx = 0; tx < map.width; tx++) {
        if (isFloor(map, tx, ty) || !touchesFloor(map, tx, ty)) continue
        walls.push(
          new THREE.Matrix4().compose(
            new THREE.Vector3(tx + 0.5, 0, ty + 0.5),
            new THREE.Quaternion(),
            new THREE.Vector3(0.25, 0.65, 1),
          ),
        )
      }
    }
  }

  // A flat floor casts nothing worth seeing, and shadow-casting doubles its cost.
  for (const [name, matrices, casts] of [
    ['floor', floors, false],
    ['floor_rocks', rocky, false],
    ['wall', walls, true],
  ] as const) {
    if (!matrices.length) continue
    group.add(instanced(name, matrices, casts))
  }
  return group
}

function blockHasFloor(map: AreaMap, bx: number, by: number): boolean {
  for (let dy = 0; dy < FLOOR_SPAN; dy++) {
    for (let dx = 0; dx < FLOOR_SPAN; dx++) if (isFloor(map, bx + dx, by + dy)) return true
  }
  return false
}

/**
 * Cardinal neighbours only. Including diagonals adds corner tiles that are never
 * visible from this camera and cost as much to draw as a wall the player can see.
 */
function blockTouchesFloor(map: AreaMap, bx: number, by: number): boolean {
  for (const [dx, dy] of [[-FLOOR_SPAN, 0], [FLOOR_SPAN, 0], [0, -FLOOR_SPAN], [0, FLOOR_SPAN]] as const) {
    if (blockHasFloor(map, bx + dx, by + dy)) return true
  }
  return false
}

function touchesFloor(map: AreaMap, tx: number, ty: number): boolean {
  return isFloor(map, tx - 1, ty) || isFloor(map, tx + 1, ty) || isFloor(map, tx, ty - 1) || isFloor(map, tx, ty + 1)
}

function instanced(name: AssetName, matrices: THREE.Matrix4[], castShadow = true): THREE.Group {
  const group = new THREE.Group()
  const source = loaded.get(name)!.scene
  source.updateMatrixWorld(true)

  source.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return
    const mesh = new THREE.InstancedMesh(child.geometry, child.material, matrices.length)
    mesh.castShadow = castShadow
    mesh.receiveShadow = true
    const local = child.matrixWorld.clone()
    matrices.forEach((m, i) => mesh.setMatrixAt(i, m.clone().multiply(local)))
    mesh.instanceMatrix.needsUpdate = true
    group.add(mesh)
  })
  return group
}

interface Rigged {
  root: THREE.Object3D
  mixer: THREE.AnimationMixer
  clips: Map<string, THREE.AnimationClip>
  current?: THREE.AnimationAction
  label: string
}

const rigged: Rigged[] = []

function placeCharacter(name: (typeof CHARACTERS)[number], at: THREE.Vector3, label: string): Rigged {
  const gltf = loaded.get(name)!
  const root = cloneRigged(gltf.scene)
  root.position.copy(at)
  root.scale.setScalar(characterScale)
  root.traverse((child) => {
    if (child instanceof THREE.Mesh) {
      child.castShadow = true
      child.receiveShadow = true
    }
  })
  scene.add(root)

  const mixer = new THREE.AnimationMixer(root)
  const clips = new Map(gltf.animations.map((c) => [c.name, c]))
  const entry: Rigged = { root, mixer, clips, label }
  rigged.push(entry)
  return entry
}

function playState(entry: Rigged, state: ShownState): void {
  const wanted = ASHVEIL_CLIP[state]
  const clip = wanted.map((n) => entry.clips.get(n)).find(Boolean)
  if (!clip) return
  const next = entry.mixer.clipAction(clip)
  next.reset().setLoop(THREE.LoopRepeat, Infinity).fadeIn(0.18).play()
  entry.current?.fadeOut(0.18)
  entry.current = next
}

// ---------------------------------------------------------------------------

let state: ShownState = 'moving'
const panel = document.getElementById('panel')!

function setState(next: ShownState): void {
  state = next
  for (const entry of rigged) playState(entry, state)
}

function rescale(delta: number): void {
  characterScale = Math.max(0.15, Math.min(1.2, +(characterScale + delta).toFixed(2)))
  for (const entry of rigged) entry.root.scale.setScalar(characterScale)
}

async function main(): Promise<void> {
  await loadAll()

  const map = generateArea(areaRng(SEED, DEPTH), DEPTH).map
  scene.add(buildTerrain(map))

  const spawn = new THREE.Vector3(map.spawn.x, 0, map.spawn.y)
  camera.position.copy(spawn).add(CAMERA_OFFSET)
  camera.lookAt(spawn)

  placeCharacter('player', spawn, 'player (Knight)')
  const ring: [(typeof CHARACTERS)[number], string][] = [
    ['swarm', 'swarm (Skeleton_Minion)'],
    ['ranged', 'ranged (Skeleton_Rogue)'],
    ['brute', 'brute (Skeleton_Warrior)'],
  ]
  ring.forEach(([name, label], i) => {
    const angle = (i / ring.length) * Math.PI * 2 + Math.PI / 4
    placeCharacter(name, spawn.clone().add(new THREE.Vector3(Math.cos(angle) * 2.6, 0, Math.sin(angle) * 2.6)), label)
  })

  // Props stand in for ground items and orbs, to see whether loot reads at this camera.
  PROPS.forEach((name, i) => {
    const prop = loaded.get(name)!.scene.clone(true)
    prop.position.copy(spawn).add(new THREE.Vector3(-3.2 + i * 1.5, 0, 3.4))
    prop.scale.setScalar(0.3)
    prop.traverse((c) => {
      if (c instanceof THREE.Mesh) c.castShadow = true
    })
    scene.add(prop)
  })

  setState(state)
  resize()
  requestAnimationFrame(frame)
  ;(globalThis as Record<string, unknown>).artSpike = { scene, camera, renderer, rigged, setState, rescale, map }
}

const clock = new THREE.Clock()
let frames = 0
let fpsAt = 0
let fps = 0

function frame(now: number): void {
  const delta = clock.getDelta()
  for (const entry of rigged) entry.mixer.update(delta)

  frames++
  if (now - fpsAt > 500) {
    fps = Math.round((frames * 1000) / (now - fpsAt))
    frames = 0
    fpsAt = now
  }

  renderer.render(scene, camera)
  const info = renderer.info
  panel.textContent = [
    `seed ${SEED} depth ${DEPTH}`,
    `state    ${state}   (1-${STATE_ORDER.length} to switch)`,
    `clip     ${ASHVEIL_CLIP[state][0]}`,
    `char x${characterScale.toFixed(2)}   span ${FLOOR_SPAN}   walls ${WALL_MODE}   ([ / ] to rescale)`,
    ``,
    `draws    ${info.render.calls}`,
    `tris     ${info.render.triangles.toLocaleString()}`,
    `geoms    ${info.memory.geometries}   textures ${info.memory.textures}`,
    `fps      ${fps}`,
  ].join('\n')
  requestAnimationFrame(frame)
}

function resize(): void {
  camera.aspect = innerWidth / innerHeight
  camera.updateProjectionMatrix()
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2))
  renderer.setSize(innerWidth, innerHeight)
}

addEventListener('resize', resize)
addEventListener('keydown', (event) => {
  const index = Number(event.key) - 1
  if (index >= 0 && index < STATE_ORDER.length) setState(STATE_ORDER[index]!)
  if (event.key === '[') rescale(-0.05)
  if (event.key === ']') rescale(0.05)
})

void main()
