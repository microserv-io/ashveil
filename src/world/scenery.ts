import * as THREE from 'three'
import { disposeSceneryGeometry, SceneryGeometry } from './scenery-geometry'
import { buildSceneryKitInstances, buildTreeCameraProxies, type SceneryKit } from './scenery-kit'
import {
  routeIsClear,
  type SceneryLandmark,
  type SceneryPath,
  type SceneryPoint,
  type ScenerySolid,
} from './scenery-layout'

export interface SceneryOptions {
  readonly heightAt: (x: number, z: number) => number
  readonly isWaterAt?: (x: number, z: number, radius?: number) => boolean
  readonly landmarks: readonly SceneryLandmark[]
  readonly paths: readonly SceneryPath[]
  readonly solids: readonly ScenerySolid[]
  readonly kit: SceneryKit
}

interface AnchoredProp extends SceneryPoint {
  readonly radius: number
}

export interface BridgeDeckLayout {
  readonly centers: readonly SceneryPoint[]
  readonly direction: SceneryPoint
  readonly yaw: number
  readonly shoreForward: number
}

export interface BuiltScenery {
  readonly root: THREE.Group
  readonly cameraOccluders: THREE.Object3D[]
  readonly treeProxies: THREE.Group
}

export function buildScenery(scene: THREE.Scene, options: SceneryOptions): BuiltScenery {
  const geometry = new SceneryGeometry()
  const solids = new Map(options.solids.map((solid) => [solid.id, solid]))
  const landmarks = new Map(options.landmarks.map((landmark) => [landmark.id, landmark]))

  const wagon = solids.get('wagon')
  if (wagon) addWagon(geometry, options.heightAt, wagon)
  addFarmFields(geometry, options, landmarks.get('farm'))
  addWaystation(geometry, options, solids)
  addFences(geometry, options, landmarks)
  addRocks(geometry, options, solids)
  addRallyMarker(geometry, options.heightAt, landmarks.get('rally'))

  const procedural = geometry.build()
  const instances = buildSceneryKitInstances(options.kit, options)
  const root = new THREE.Group()
  root.name = 'scenery'
  root.add(procedural, instances)
  scene.add(root)
  const treeProxies = buildTreeCameraProxies(options)
  const buildings = instances.children.filter((object) =>
    object.name === 'kit-refuge_hall' || object.name === 'kit-cottage')
  return { root, treeProxies, cameraOccluders: [procedural, ...buildings, treeProxies] }
}

export function disposeScenery(scenery: BuiltScenery): void {
  scenery.root.removeFromParent()
  disposeSceneryGeometry(scenery.root)
  disposeSceneryGeometry(scenery.treeProxies)
}

function addWagon(
  geometry: SceneryGeometry,
  heightAt: SceneryOptions['heightAt'],
  prop: AnchoredProp,
): void {
  const y = heightAt(prop.x, prop.z)
  const yaw = -0.34
  localBox(geometry, 'timber', prop, y, yaw, 0, 1.25, 0, 3.8, 0.55, 2.15)
  localBox(geometry, 'timber', prop, y, yaw, 0, 2.05, 0.95, 3.8, 1.2, 0.18)
  localBox(geometry, 'timber', prop, y, yaw, 0, 2.05, -0.95, 3.8, 1.2, 0.18)
  for (const x of [-1.45, 1.45]) {
    for (const z of [-1.18, 1.18]) {
      const wheel = localPosition(prop, x, z, yaw)
      geometry.torus('timber', wheel.x, y + 0.9, wheel.z, 0.92, 0.13, 0, yaw, 0)
      geometry.box('timber', wheel.x, y + 0.9, wheel.z, 0.12, 1.55, 0.12, 0, yaw, 0)
    }
  }
  for (const x of [-1.55, 0, 1.55]) {
    localBox(geometry, 'timber', prop, y, yaw, x, 2.65, 0, 0.14, 2.7, 2.25)
  }
  localBox(geometry, 'canvas', prop, y, yaw, 0, 3.75, 0, 3.65, 0.18, 2.55)
}


function addFarmFields(
  geometry: SceneryGeometry,
  options: SceneryOptions,
  farm: SceneryLandmark | undefined,
): void {
  if (!farm) return
  for (let row = 0; row < 7; row += 1) {
    for (let stem = 0; stem < 10; stem += 1) {
      const x = farm.x - 19 + stem * 1.5
      const z = farm.z - 4 + row * 1.65
      if (!routeIsClear({ x, z }, 0.45, options.paths)) continue
      const y = options.heightAt(x, z)
      geometry.cylinder('field', x, y + 0.55, z, 0.04, 0.1, 1.1, 5, 0, 0, (stem % 3 - 1) * 0.08)
    }
  }
}

function addWaystation(
  geometry: SceneryGeometry,
  options: SceneryOptions,
  solids: ReadonlyMap<string, ScenerySolid>,
): void {
  const gate = solids.get('waystation-gate')
  const abutment = solids.get('bridge-abutment')
  if (!gate || !abutment) return
  const gateY = options.heightAt(gate.x, gate.z)
  geometry.box('limestone', gate.x - 4.1, gateY + 2.4, gate.z, 3.4, 4.8, 3.4)
  geometry.box('limestone', gate.x + 4.1, gateY + 2.4, gate.z, 3.4, 4.8, 3.4)
  geometry.box('limestone', gate.x, gateY + 5.2, gate.z, 5.2, 1.4, 3.4)
  for (let index = 0; index < 7; index += 1) {
    const angle = Math.PI * (index / 6)
    geometry.box(
      'ivory',
      gate.x + Math.cos(angle) * 3.25,
      gateY + 3.4 + Math.sin(angle) * 3.25,
      gate.z - 1.76,
      1.1,
      0.65,
      0.35,
      0,
      0,
      angle - Math.PI / 2,
    )
  }
  geometry.box('teal', gate.x, gateY + 6.25, gate.z - 1.95, 2.1, 0.36, 0.25, 0, 0, Math.PI / 4)
  geometry.box('teal', gate.x, gateY + 6.25, gate.z - 1.96, 2.1, 0.36, 0.25, 0, 0, -Math.PI / 4)
  geometry.box('teal', gate.x - 4.8, gateY + 3.75, gate.z - 2.15, 3.8, 0.14, 3.3, -0.18)

  const bridgeY = options.heightAt(abutment.x, abutment.z)
  geometry.box('limestone', abutment.x, bridgeY + 2.1, abutment.z, 5, 4.2, 5.5)
  geometry.box('ivory', abutment.x, bridgeY + 4.4, abutment.z, 6, 0.8, 6.2)
  const layout = bridgeDeckLayout(gate, abutment, options.isWaterAt)
  const bridgePoint = (center: SceneryPoint, lateral = 0): SceneryPoint => ({
    x: center.x - layout.direction.z * lateral,
    z: center.z + layout.direction.x * lateral,
  })
  for (const [index, center] of layout.centers.entries()) {
    geometry.box('timber', center.x, bridgeY + 4.55, center.z, 2.6, 0.34, 4.2, 0, layout.yaw, index === layout.centers.length - 1 ? 0.08 : 0)
  }
  const railStart = layout.centers[0]!
  const railEnd = layout.centers.at(-1)!
  const railCenter = { x: (railStart.x + railEnd.x) * 0.5, z: (railStart.z + railEnd.z) * 0.5 }
  const railLength = Math.hypot(railEnd.x - railStart.x, railEnd.z - railStart.z) + 2.6
  for (const lateral of [-2.35, 2.35]) {
    const rail = bridgePoint(railCenter, lateral)
    geometry.box('timber', rail.x, bridgeY + 5.2, rail.z, railLength, 0.24, 0.24, 0, layout.yaw, 0)
  }
}

const BRIDGE_BOARD_START = 4.5
const BRIDGE_BOARD_LENGTH = 2.6
const BRIDGE_BOARD_PITCH = 2.8
const BRIDGE_OVERHANG = 4.5

export function bridgeDeckLayout(
  gate: SceneryPoint,
  abutment: SceneryPoint,
  isWaterAt: SceneryOptions['isWaterAt'],
): BridgeDeckLayout {
  const approachLength = Math.hypot(abutment.x - gate.x, abutment.z - gate.z) || 1
  const direction = {
    x: (abutment.x - gate.x) / approachLength,
    z: (abutment.z - gate.z) / approachLength,
  }
  const pointAt = (forward: number): SceneryPoint => ({
    x: abutment.x + direction.x * forward,
    z: abutment.z + direction.z * forward,
  })

  // The landmark sits on dry ground. Query the compiled river to find the actual
  // bank along the authored approach, then leave only a short ruined overhang.
  const searchLimit = Math.max(32, approachLength * 0.5)
  let shoreForward = BRIDGE_BOARD_START + BRIDGE_BOARD_PITCH * 4
  if (isWaterAt) {
    let dryForward = 0
    for (let forward = 0.5; forward <= searchLimit; forward += 0.5) {
      if (!isWaterAt(pointAt(forward).x, pointAt(forward).z)) {
        dryForward = forward
        continue
      }
      let low = dryForward
      let high = forward
      for (let iteration = 0; iteration < 10; iteration += 1) {
        const middle = (low + high) * 0.5
        const point = pointAt(middle)
        if (isWaterAt(point.x, point.z)) high = middle
        else low = middle
      }
      shoreForward = high
      break
    }
  }
  const finalCenter = shoreForward + BRIDGE_OVERHANG - BRIDGE_BOARD_LENGTH * 0.5
  const boardCount = Math.max(1, Math.ceil((finalCenter - BRIDGE_BOARD_START) / BRIDGE_BOARD_PITCH) + 1)
  const centers = Array.from({ length: boardCount }, (_, index) => pointAt(BRIDGE_BOARD_START + index * BRIDGE_BOARD_PITCH))
  return { centers, direction, yaw: -Math.atan2(direction.z, direction.x), shoreForward }
}

function addFences(
  geometry: SceneryGeometry,
  options: SceneryOptions,
  landmarks: ReadonlyMap<string, SceneryLandmark>,
): void {
  const orchard = landmarks.get('orchard')
  const farm = landmarks.get('farm')
  const lines: readonly (readonly [SceneryPoint, SceneryPoint])[] = [
    ...(orchard ? [
      [offsetPoint(orchard, -16, -15), offsetPoint(orchard, 10, -15)],
      [offsetPoint(orchard, -16, 17), offsetPoint(orchard, -4, 17)],
      [offsetPoint(orchard, 4, 17), offsetPoint(orchard, 10, 17)],
      [offsetPoint(orchard, -16, -15), offsetPoint(orchard, -16, 9)],
      [offsetPoint(orchard, 10, -7), offsetPoint(orchard, 10, 17)],
    ] as const : []),
    ...(farm ? [
      [offsetPoint(farm, -23, -8), offsetPoint(farm, -23, 12)],
      [offsetPoint(farm, -23, 12), offsetPoint(farm, -11, 12)],
    ] as const : []),
  ]
  for (const [start, end] of lines) addFenceLine(geometry, options, start, end)
}

function addFenceLine(
  geometry: SceneryGeometry,
  options: SceneryOptions,
  start: SceneryPoint,
  end: SceneryPoint,
): void {
  const dx = end.x - start.x
  const dz = end.z - start.z
  const length = Math.hypot(dx, dz)
  const yaw = Math.atan2(dx, dz)
  const count = Math.max(1, Math.ceil(length / 3.6))
  for (let index = 0; index <= count; index += 1) {
    const t = index / count
    const x = start.x + dx * t
    const z = start.z + dz * t
    if (!routeIsClear({ x, z }, 0.6, options.paths)) continue
    const y = options.heightAt(x, z)
    geometry.box('timber', x, y + 0.75, z, 0.2, 1.5, 0.2, 0, yaw, (index % 3 - 1) * 0.04)
  }
  const center = { x: (start.x + end.x) * 0.5, z: (start.z + end.z) * 0.5 }
  if (!routeIsClear(center, 0.6, options.paths)) return
  const y = (options.heightAt(start.x, start.z) + options.heightAt(end.x, end.z)) * 0.5
  geometry.box('timber', center.x, y + 0.62, center.z, 0.16, 0.16, length, 0, yaw, 0)
  geometry.box('timber', center.x, y + 1.08, center.z, 0.14, 0.14, length, 0, yaw, 0)
}

function addRocks(
  geometry: SceneryGeometry,
  options: SceneryOptions,
  solids: ReadonlyMap<string, ScenerySolid>,
): void {
  matchingSolids(solids, 'bank-rock-').forEach((solid, index) => {
    if (!routeIsClear(solid, 1.25, options.paths)) return
    const y = options.heightAt(solid.x, solid.z)
    const size = Math.min(solid.radius, 0.55 + stableVariation(`rock-${index}`) * 0.25)
    geometry.crown('limestone', solid.x, y + size * 0.36, solid.z, size, 0.58)
  })
}

function addRallyMarker(
  geometry: SceneryGeometry,
  heightAt: SceneryOptions['heightAt'],
  landmark: SceneryLandmark | undefined,
): void {
  if (!landmark) return
  const rally = landmark
  const y = heightAt(rally.x, rally.z)
  geometry.box('timber', rally.x - 3.3, y + 2.2, rally.z + 1.8, 0.22, 4.4, 0.22)
  geometry.box('teal', rally.x - 2.2, y + 3.4, rally.z + 1.8, 2.1, 1.1, 0.08, 0, 0, -0.08)
}

function offsetPoint(root: SceneryPoint, x: number, z: number): SceneryPoint {
  return { x: root.x + x, z: root.z + z }
}

function localBox(
  geometry: SceneryGeometry,
  material: Parameters<SceneryGeometry['box']>[0],
  root: SceneryPoint,
  groundY: number,
  yaw: number,
  localX: number,
  localY: number,
  localZ: number,
  width: number,
  height: number,
  depth: number,
  rotationX = 0,
  rotationY = 0,
  rotationZ = 0,
): void {
  const point = localPosition(root, localX, localZ, yaw)
  geometry.box(material, point.x, groundY + localY, point.z, width, height, depth, rotationX, yaw + rotationY, rotationZ)
}

function localPosition(root: SceneryPoint, localX: number, localZ: number, yaw: number): SceneryPoint {
  const sin = Math.sin(yaw)
  const cos = Math.cos(yaw)
  return {
    x: root.x + localX * cos + localZ * sin,
    z: root.z - localX * sin + localZ * cos,
  }
}

function stableVariation(value: string): number {
  let hash = 2166136261
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0) / 0xffffffff
}

function matchingSolids(
  solids: ReadonlyMap<string, ScenerySolid>,
  prefix: string,
): ScenerySolid[] {
  return [...solids.values()]
    .filter((solid) => solid.id.startsWith(prefix))
    .sort((left, right) => left.id.localeCompare(right.id))
}
