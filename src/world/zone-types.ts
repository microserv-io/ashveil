export interface WorldPoint { readonly x: number; readonly z: number }

export interface ZoneBounds {
  readonly minX: number
  readonly maxX: number
  readonly minZ: number
  readonly maxZ: number
}

export interface ZoneLandmark extends WorldPoint {
  readonly id: string
  readonly label: string
  readonly radius: number
}

export interface ZonePath {
  readonly id: string
  readonly from: string
  readonly to: string
  readonly width: number
  readonly points: readonly WorldPoint[]
}

export interface ZoneRidge {
  readonly id: string
  readonly halfWidth: number
  readonly height: number
  readonly points: readonly WorldPoint[]
}

export interface ZoneRiverPoint extends WorldPoint {
  readonly halfWidth: number
  readonly depth: number
}

export interface ZoneRiver {
  readonly waterLevel: number
  readonly points: readonly ZoneRiverPoint[]
}

export type TerrainStrokeMode = 'raise' | 'lower' | 'smooth'

export interface TerrainStroke extends WorldPoint {
  readonly id: string
  readonly mode: TerrainStrokeMode
  readonly radius: number
  readonly amount: number
}

export interface ZoneLandform {
  readonly kind: 'hill' | 'barrier'
  readonly id: string
  readonly points: readonly WorldPoint[]
  readonly halfWidth: number
  readonly height: number
}

export interface ZoneDefinition {
  readonly schemaVersion: 1
  readonly id: string
  readonly bounds: ZoneBounds
  readonly cellSize: number
  readonly spawn: { readonly landmarkId: string; readonly offset: WorldPoint }
  readonly mainRoute: readonly string[]
  readonly landmarks: readonly ZoneLandmark[]
  readonly paths: readonly ZonePath[]
  readonly ridges: readonly ZoneRidge[]
  readonly river: ZoneRiver
  readonly terrain: {
    readonly baseHeight: number
    readonly strokes: readonly TerrainStroke[]
    readonly landforms?: readonly ZoneLandform[]
  }
}

export interface TerrainVertex extends WorldPoint { readonly y: number }
export interface WeightedTerrainVertex extends TerrainVertex { readonly weight: number }

export interface TerrainGeometryData {
  readonly vertices: readonly TerrainVertex[]
  readonly indices: readonly number[]
  readonly colors: readonly [number, number, number][]
  readonly stoneWeights: readonly number[]
  readonly columns: number
}

export interface CompiledRouteMetrics {
  readonly pathIds: readonly string[]
  readonly length: number
  readonly runSeconds: number
}

export interface CompiledZone {
  readonly definition: ZoneDefinition
  readonly bounds: ZoneBounds
  readonly cellSize: number
  readonly landmarks: readonly ZoneLandmark[]
  readonly paths: readonly ZonePath[]
  readonly ridges: readonly ZoneRidge[]
  readonly spawn: WorldPoint
  readonly mainRoute: CompiledRouteMetrics
  heightAt(x: number, z: number): number
  terrainTriangleAt(x: number, z: number): readonly WeightedTerrainVertex[]
  geometry(): TerrainGeometryData
  riverCenterAt(z: number): number
  riverHalfWidthAt(z: number): number
  riverDepthAt(z: number): number
  waterLevelAt(x: number, z: number): number | undefined
  isWaterAt(x: number, z: number, radius?: number): boolean
  canOccupyPoint(x: number, z: number, radius: number): boolean
}
