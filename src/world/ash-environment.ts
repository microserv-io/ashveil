import * as THREE from 'three'
import { ashInfluenceAt } from './terrain-paint'
import type { CompiledZone } from './zone-types'

export const MAX_ASH_MOTES = 169
const CELL_SIZE = 6
const PATCH_RADIUS_CELLS = 6

export interface AshMote {
  readonly x: number
  readonly y: number
  readonly z: number
  readonly influence: number
  readonly phase: number
  readonly size: number
}

export interface BuiltAshEnvironment {
  readonly points: THREE.Points<THREE.BufferGeometry, THREE.ShaderMaterial>
  update(elapsedSeconds: number, cameraPosition: THREE.Vector3): void
  dispose(): void
}

export function ashMotesAround(zone: CompiledZone, x: number, z: number): readonly AshMote[] {
  const centerColumn = Math.floor(x / CELL_SIZE)
  const centerRow = Math.floor(z / CELL_SIZE)
  const motes: AshMote[] = []
  for (let row = centerRow - PATCH_RADIUS_CELLS; row <= centerRow + PATCH_RADIUS_CELLS; row += 1) {
    for (let column = centerColumn - PATCH_RADIUS_CELLS; column <= centerColumn + PATCH_RADIUS_CELLS; column += 1) {
      const density = hash(column, row, 0)
      if (density < 0.42) continue
      const moteX = (column + hash(column, row, 1)) * CELL_SIZE
      const moteZ = (row + hash(column, row, 2)) * CELL_SIZE
      if (moteX < zone.bounds.minX || moteX > zone.bounds.maxX || moteZ < zone.bounds.minZ || moteZ > zone.bounds.maxZ
        || zone.isWaterAt(moteX, moteZ)) continue
      const influence = ashInfluenceAt(zone, moteX, moteZ)
      if (influence < 0.08) continue
      motes.push({
        x: moteX,
        y: zone.heightAt(moteX, moteZ) + 0.35 + hash(column, row, 3) * 2.4,
        z: moteZ,
        influence,
        phase: hash(column, row, 4) * Math.PI * 2,
        size: hash(column, row, 6) > 0.9
          ? 0.7 + hash(column, row, 5) * 0.7
          : 0.08 + hash(column, row, 5) * 0.18,
      })
    }
  }
  return motes
}

export function buildAshEnvironment(zone: CompiledZone): BuiltAshEnvironment {
  const geometry = new THREE.BufferGeometry()
  const positions = new Float32Array(MAX_ASH_MOTES * 3)
  const influence = new Float32Array(MAX_ASH_MOTES)
  const phase = new Float32Array(MAX_ASH_MOTES)
  const size = new Float32Array(MAX_ASH_MOTES)
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  geometry.setAttribute('influence', new THREE.BufferAttribute(influence, 1))
  geometry.setAttribute('phase', new THREE.BufferAttribute(phase, 1))
  geometry.setAttribute('size', new THREE.BufferAttribute(size, 1))
  geometry.setDrawRange(0, 0)

  const material = new THREE.ShaderMaterial({
    name: 'alderbank-ash-motes',
    transparent: true,
    depthWrite: false,
    uniforms: { elapsedSeconds: { value: 0 } },
    vertexShader: `
      attribute float influence;
      attribute float phase;
      attribute float size;
      uniform float elapsedSeconds;
      varying float vOpacity;
      void main() {
        vec3 motePosition = position;
        motePosition.x += sin(elapsedSeconds * 0.19 + phase) * 0.18;
        motePosition.y += sin(elapsedSeconds * 0.31 + phase * 1.7) * 0.12;
        motePosition.z += cos(elapsedSeconds * 0.17 + phase * 0.8) * 0.14;
        vec4 mvPosition = modelViewMatrix * vec4(motePosition, 1.0);
        gl_Position = projectionMatrix * mvPosition;
        gl_PointSize = clamp(size * 220.0 / max(1.0, -mvPosition.z), 1.0, 22.0);
        vOpacity = sqrt(influence) * mix(0.22, 0.035, step(0.5, size));
      }
    `,
    fragmentShader: `
      varying float vOpacity;
      void main() {
        float distanceFromCenter = length(gl_PointCoord - vec2(0.5));
        float softParticle = 1.0 - smoothstep(0.16, 0.5, distanceFromCenter);
        if (softParticle < 0.01) discard;
        gl_FragColor = vec4(0.68, 0.71, 0.67, softParticle * vOpacity);
      }
    `,
  })
  const points = new THREE.Points(geometry, material)
  points.name = 'alderbank-ash-motes'
  points.frustumCulled = false
  points.renderOrder = 3
  let patchColumn = Number.NaN
  let patchRow = Number.NaN

  const refresh = (cameraPosition: THREE.Vector3): void => {
    const nextColumn = Math.floor(cameraPosition.x / CELL_SIZE)
    const nextRow = Math.floor(cameraPosition.z / CELL_SIZE)
    if (nextColumn === patchColumn && nextRow === patchRow) return
    patchColumn = nextColumn
    patchRow = nextRow
    const motes = ashMotesAround(zone, cameraPosition.x, cameraPosition.z)
    motes.forEach((mote, index) => {
      positions.set([mote.x, mote.y, mote.z], index * 3)
      influence[index] = mote.influence
      phase[index] = mote.phase
      size[index] = mote.size
    })
    geometry.setDrawRange(0, motes.length)
    for (const attribute of [geometry.attributes.position, geometry.attributes.influence,
      geometry.attributes.phase, geometry.attributes.size]) attribute!.needsUpdate = true
  }

  return {
    points,
    update: (elapsedSeconds, cameraPosition) => {
      material.uniforms.elapsedSeconds!.value = elapsedSeconds
      refresh(cameraPosition)
    },
    dispose: () => {
      points.removeFromParent()
      geometry.dispose()
      material.dispose()
    },
  }
}

function hash(x: number, z: number, salt: number): number {
  let value = Math.imul(x, 0x1f123bb5) ^ Math.imul(z, 0x5f356495) ^ Math.imul(salt + 1, 0x6c8e9cf5)
  value ^= value >>> 15
  value = Math.imul(value, 0x2c1b3c6d)
  value ^= value >>> 12
  return (value >>> 0) / 0xffffffff
}
