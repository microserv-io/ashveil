import type { WorldPoint, ZoneLandform } from './zone-types'

export const BARRIER_CORE_RATIO = 0.32

interface Segment {
  readonly from: WorldPoint
  readonly to: WorldPoint
  readonly minX: number
  readonly maxX: number
  readonly minZ: number
  readonly maxZ: number
}

interface CompiledLandform {
  readonly definition: ZoneLandform
  readonly segments: readonly Segment[]
  readonly phase: number
}

export interface LandformSample {
  readonly hillHeight: number
  readonly barrierHeight: number
  readonly stoneWeight: number
}

function distanceToSegment(x: number, z: number, segment: Segment): number {
  const dx = segment.to.x - segment.from.x
  const dz = segment.to.z - segment.from.z
  const squared = dx * dx + dz * dz
  const t = squared === 0 ? 0 : Math.max(0, Math.min(1, ((x - segment.from.x) * dx + (z - segment.from.z) * dz) / squared))
  return Math.hypot(x - segment.from.x - dx * t, z - segment.from.z - dz * t)
}

function profileWeight(distance: number, halfWidth: number): number {
  if (distance >= halfWidth) return 0
  return (1 + Math.cos(Math.PI * distance / halfWidth)) * 0.5
}

function distanceToLandform(x: number, z: number, landform: CompiledLandform, expansion = 0): number {
  let nearest = Infinity
  for (const segment of landform.segments) {
    if (x < segment.minX - expansion || x > segment.maxX + expansion
      || z < segment.minZ - expansion || z > segment.maxZ + expansion) continue
    nearest = Math.min(nearest, distanceToSegment(x, z, segment))
  }
  return nearest
}

export class CompiledLandforms {
  private readonly landforms: readonly CompiledLandform[]

  constructor(definitions: readonly ZoneLandform[]) {
    this.landforms = definitions.map((definition) => ({
      definition,
      phase: definition.id.split('').reduce((sum, character) => sum + character.charCodeAt(0), 0) * 0.01,
      segments: definition.points.slice(1).map((to, index) => {
        const from = definition.points[index]!
        return {
          from,
          to,
          minX: Math.min(from.x, to.x) - definition.halfWidth,
          maxX: Math.max(from.x, to.x) + definition.halfWidth,
          minZ: Math.min(from.z, to.z) - definition.halfWidth,
          maxZ: Math.max(from.z, to.z) + definition.halfWidth,
        }
      }),
    }))
  }

  sample(x: number, z: number): LandformSample {
    let hillHeight = 0
    let barrierHeight = 0
    let stoneWeight = 0
    for (const landform of this.landforms) {
      const distance = distanceToLandform(x, z, landform)
      const weight = profileWeight(distance, landform.definition.halfWidth)
      if (weight === 0) continue
      if (landform.definition.kind === 'hill') hillHeight = Math.max(hillHeight, landform.definition.height * weight)
      else {
        const noise = (Math.sin(x * 0.067 - z * 0.051 + landform.phase)
          + Math.sin(x * 0.029 + z * 0.083 - landform.phase)) * 0.5
        const breakup = 0.96 + noise * 0.06
        barrierHeight = Math.max(barrierHeight, landform.definition.height * weight * breakup)
        stoneWeight = Math.max(stoneWeight, weight)
      }
    }
    return { hillHeight, barrierHeight, stoneWeight }
  }

  blocks(x: number, z: number, radius: number): boolean {
    return this.landforms.some((landform) => landform.definition.kind === 'barrier'
      && distanceToLandform(x, z, landform, radius) <= landform.definition.halfWidth * BARRIER_CORE_RATIO + radius)
  }

  overlapsBarrierFootprint(point: WorldPoint, radius: number): boolean {
    return this.landforms.some((landform) => landform.definition.kind === 'barrier'
      && distanceToLandform(point.x, point.z, landform, radius) <= landform.definition.halfWidth + radius)
  }
}
