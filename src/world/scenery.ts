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
  readonly landmarks: readonly SceneryLandmark[]
  readonly paths: readonly SceneryPath[]
  readonly solids: readonly ScenerySolid[]
  readonly kit: SceneryKit
}

interface AnchoredProp extends SceneryPoint {
  readonly radius: number
}

export interface BuiltScenery {
  readonly root: THREE.Group
  readonly cameraOccluders: readonly THREE.Object3D[]
  readonly treeProxies: THREE.Group
}

export function buildScenery(scene: THREE.Scene, options: SceneryOptions): BuiltScenery {
  const geometry = new SceneryGeometry()
  const solids = new Map(options.solids.map((solid) => [solid.id, solid]))
  const landmarks = new Map(options.landmarks.map((landmark) => [landmark.id, landmark]))

  const wagon = solids.get('wagon')
  if (wagon) addWagon(geometry, options.heightAt, wagon)
  addFarmFields(geometry, options)
  addWaystation(geometry, options.heightAt, solids)
  addFences(geometry, options)
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


function addFarmFields(geometry: SceneryGeometry, options: SceneryOptions): void {
  for (let row = 0; row < 7; row += 1) {
    for (let stem = 0; stem < 10; stem += 1) {
      const x = -104 + stem * 1.5
      const z = 16 + row * 1.65
      if (!routeIsClear({ x, z }, 0.45, options.paths)) continue
      const y = options.heightAt(x, z)
      geometry.cylinder('field', x, y + 0.55, z, 0.04, 0.1, 1.1, 5, 0, 0, (stem % 3 - 1) * 0.08)
    }
  }
}

function addWaystation(
  geometry: SceneryGeometry,
  heightAt: SceneryOptions['heightAt'],
  solids: ReadonlyMap<string, ScenerySolid>,
): void {
  const gate = solids.get('waystation-gate')
  const abutment = solids.get('bridge-abutment')
  if (!gate || !abutment) return
  const gateY = heightAt(gate.x, gate.z)
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

  const bridgeY = heightAt(abutment.x, abutment.z)
  geometry.box('limestone', abutment.x, bridgeY + 2.1, abutment.z, 5, 4.2, 5.5)
  geometry.box('ivory', abutment.x, bridgeY + 4.4, abutment.z, 6, 0.8, 6.2)
  for (const x of [8.5, 11.5, 14.2]) {
    const deckY = heightAt(abutment.x, abutment.z) + 4.55
    geometry.box('timber', x, deckY, abutment.z, 2.6, 0.34, 4.2, 0, 0, x === 14.2 ? 0.08 : 0)
  }
  for (const z of [-2.35, 2.35]) {
    geometry.box('timber', 11.2, bridgeY + 5.2, abutment.z + z, 8.5, 0.24, 0.24)
  }
}

function addFences(geometry: SceneryGeometry, options: SceneryOptions): void {
  const lines: readonly [SceneryPoint, SceneryPoint][] = [
    [{ x: -96, z: -50 }, { x: -70, z: -50 }],
    [{ x: -96, z: -18 }, { x: -84, z: -18 }],
    [{ x: -76, z: -18 }, { x: -70, z: -18 }],
    [{ x: -96, z: -50 }, { x: -96, z: -26 }],
    [{ x: -70, z: -42 }, { x: -70, z: -18 }],
    [{ x: -108, z: 12 }, { x: -108, z: 32 }],
    [{ x: -108, z: 32 }, { x: -96, z: 32 }],
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
  const rally = landmark ?? { x: -25, z: -60, radius: 5 }
  const y = heightAt(rally.x, rally.z)
  geometry.box('timber', rally.x - 3.3, y + 2.2, rally.z + 1.8, 0.22, 4.4, 0.22)
  geometry.box('teal', rally.x - 2.2, y + 3.4, rally.z + 1.8, 2.1, 1.1, 0.08, 0, 0, -0.08)
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
