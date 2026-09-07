import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'

export type SceneryMaterial =
  | 'ivory'
  | 'limestone'
  | 'timber'
  | 'terracotta'
  | 'terracottaLight'
  | 'teal'
  | 'leafDark'
  | 'leafMid'
  | 'leafLight'
  | 'fruit'
  | 'field'
  | 'canvas'

const COLORS: Readonly<Record<SceneryMaterial, number>> = {
  ivory: 0xd8cba7,
  limestone: 0xbeb89e,
  timber: 0x4d3828,
  terracotta: 0x9f4f31,
  terracottaLight: 0xc06a3e,
  teal: 0x2f7773,
  leafDark: 0x344a30,
  leafMid: 0x59703a,
  leafLight: 0x7e843f,
  fruit: 0xc27732,
  field: 0xb59645,
  canvas: 0xd1b976,
}

export function transform(
  x: number,
  y: number,
  z: number,
  scaleX: number,
  scaleY: number,
  scaleZ: number,
  rotationX = 0,
  rotationY = 0,
  rotationZ = 0,
): THREE.Matrix4 {
  const quaternion = new THREE.Quaternion().setFromEuler(
    new THREE.Euler(rotationX, rotationY, rotationZ, 'YXZ'),
  )
  return new THREE.Matrix4().compose(
    new THREE.Vector3(x, y, z),
    quaternion,
    new THREE.Vector3(scaleX, scaleY, scaleZ),
  )
}

export class SceneryGeometry {
  readonly #parts = new Map<SceneryMaterial, THREE.BufferGeometry[]>()

  add(material: SceneryMaterial, geometry: THREE.BufferGeometry, matrix: THREE.Matrix4): void {
    const part = geometry.index ? geometry.toNonIndexed() : geometry
    if (part !== geometry) geometry.dispose()
    part.applyMatrix4(matrix)
    const parts = this.#parts.get(material)
    if (parts) parts.push(part)
    else this.#parts.set(material, [part])
  }

  box(
    material: SceneryMaterial,
    x: number,
    y: number,
    z: number,
    width: number,
    height: number,
    depth: number,
    rotationX = 0,
    rotationY = 0,
    rotationZ = 0,
  ): void {
    this.add(
      material,
      new THREE.BoxGeometry(1, 1, 1),
      transform(x, y, z, width, height, depth, rotationX, rotationY, rotationZ),
    )
  }

  cylinder(
    material: SceneryMaterial,
    x: number,
    y: number,
    z: number,
    radiusTop: number,
    radiusBottom: number,
    height: number,
    radialSegments = 7,
    rotationX = 0,
    rotationY = 0,
    rotationZ = 0,
  ): void {
    this.add(
      material,
      new THREE.CylinderGeometry(radiusTop, radiusBottom, height, radialSegments),
      transform(x, y, z, 1, 1, 1, rotationX, rotationY, rotationZ),
    )
  }

  crown(
    material: SceneryMaterial,
    x: number,
    y: number,
    z: number,
    radius: number,
    stretchY = 0.8,
  ): void {
    this.add(
      material,
      new THREE.IcosahedronGeometry(1, 1),
      transform(x, y, z, radius, radius * stretchY, radius),
    )
  }

  torus(
    material: SceneryMaterial,
    x: number,
    y: number,
    z: number,
    radius: number,
    tube: number,
    rotationX: number,
    rotationY: number,
    rotationZ: number,
  ): void {
    this.add(
      material,
      new THREE.TorusGeometry(radius, tube, 5, 12),
      transform(x, y, z, 1, 1, 1, rotationX, rotationY, rotationZ),
    )
  }

  build(): THREE.Group {
    const group = new THREE.Group()
    group.name = 'first-zone-scenery'

    for (const [name, parts] of this.#parts) {
      const merged = mergeGeometries(parts, false)
      for (const part of parts) part.dispose()
      if (!merged) throw new Error(`Could not merge ${name} scenery geometry`)

      const material = new THREE.MeshStandardMaterial({
        color: COLORS[name],
        roughness: name === 'teal' ? 0.72 : 0.9,
        metalness: 0,
        flatShading: true,
      })
      const mesh = new THREE.Mesh(merged, material)
      mesh.name = `scenery-${name}`
      mesh.castShadow = true
      mesh.receiveShadow = name === 'limestone' || name === 'ivory'
      group.add(mesh)
    }

    return group
  }
}

export function disposeSceneryGeometry(group: THREE.Object3D): void {
  const geometries = new Set<THREE.BufferGeometry>()
  const materials = new Set<THREE.Material>()
  group.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return
    geometries.add(object.geometry)
    const objectMaterials = Array.isArray(object.material) ? object.material : [object.material]
    for (const material of objectMaterials) materials.add(material)
  })
  for (const geometry of geometries) geometry.dispose()
  for (const material of materials) material.dispose()
}
