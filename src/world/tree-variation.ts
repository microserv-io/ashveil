import * as THREE from 'three'

const MIN_WIDTH_SCALE = 0.82
const MAX_WIDTH_SCALE = 1.08
const MIN_HEIGHT_SCALE = 0.82
const MAX_HEIGHT_SCALE = 1.18
const MIN_TINT = 0.94
const MAX_TINT = 1

export interface TreeInstanceVariation {
  readonly yaw: number
  readonly widthScale: number
  readonly heightScale: number
  readonly tint: THREE.Color
}

interface GroundProfile {
  readonly heights: readonly number[]
  readonly radii: readonly number[]
}

const groundProfiles = new WeakMap<THREE.BufferGeometry, GroundProfile>()

function stableUnit(id: string, channel: string): number {
  const value = `${channel}:${id}`
  let hash = 2166136261
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  hash ^= hash >>> 16
  hash = Math.imul(hash, 0x85ebca6b)
  hash ^= hash >>> 13
  hash = Math.imul(hash, 0xc2b2ae35)
  hash ^= hash >>> 16
  return (hash >>> 0) / 0xffffffff
}

function within(unit: number, minimum: number, maximum: number): number {
  return minimum + unit * (maximum - minimum)
}

function clampTint(channel: number): number {
  return Math.max(MIN_TINT, Math.min(MAX_TINT, channel))
}

function groundProfile(geometry: THREE.BufferGeometry): GroundProfile {
  const cached = groundProfiles.get(geometry)
  if (cached) return cached
  const positions = geometry.getAttribute('position')
  const samples: { readonly height: number; readonly radius: number }[] = []
  for (let index = 0; index < positions.count; index += 1) {
    samples.push({
      height: positions.getY(index),
      radius: Math.hypot(positions.getX(index), positions.getZ(index)),
    })
  }
  samples.sort((left, right) => left.height - right.height)
  const heights: number[] = []
  const radii: number[] = []
  let radius = 0
  for (const sample of samples) {
    radius = Math.max(radius, sample.radius)
    heights.push(sample.height)
    radii.push(radius)
  }
  const profile = { heights, radii }
  groundProfiles.set(geometry, profile)
  return profile
}

export function measureTreeGroundRadius(
  geometry: THREE.BufferGeometry,
  heightScale: number,
  groundZoneCutoff: number,
): number {
  const profile = groundProfile(geometry)
  const maximumSourceHeight = groundZoneCutoff / heightScale
  let lower = 0
  let upper = profile.heights.length
  while (lower < upper) {
    const middle = Math.floor((lower + upper) / 2)
    if (profile.heights[middle]! <= maximumSourceHeight) lower = middle + 1
    else upper = middle
  }
  return lower > 0 ? profile.radii[lower - 1]! : 0
}

export function fitTreeWidthToGroundZone(
  geometry: THREE.BufferGeometry,
  collisionRadius: number,
  desiredWidth: number,
  heightScale: number,
  groundZoneCutoff: number,
): number {
  const measuredRadius = measureTreeGroundRadius(geometry, heightScale, groundZoneCutoff)
  return measuredRadius > 0
    ? Math.max(Number.EPSILON, Math.min(desiredWidth, collisionRadius / measuredRadius))
    : Math.max(Number.EPSILON, desiredWidth)
}

export function treeInstanceVariation(
  id: string,
  geometry: THREE.BufferGeometry,
  collisionRadius: number,
  groundZoneCutoff: number,
): TreeInstanceVariation {
  const desiredWidth = within(stableUnit(id, 'width'), MIN_WIDTH_SCALE, MAX_WIDTH_SCALE)
  const heightScale = within(stableUnit(id, 'height'), MIN_HEIGHT_SCALE, MAX_HEIGHT_SCALE)
  const widthScale = fitTreeWidthToGroundZone(
    geometry,
    collisionRadius,
    desiredWidth,
    heightScale,
    groundZoneCutoff,
  )
  const shade = within(stableUnit(id, 'shade'), MIN_TINT, MAX_TINT - 0.02)
  const warmth = within(stableUnit(id, 'warmth'), -0.02, 0.02)
  return {
    yaw: stableUnit(id, 'yaw') * Math.PI * 2,
    widthScale,
    heightScale,
    tint: new THREE.Color(
      clampTint(shade + warmth),
      clampTint(shade),
      clampTint(shade - warmth),
    ),
  }
}
