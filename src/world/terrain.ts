import { getActiveZone } from './zone-active'
import type { TerrainGeometryData, TerrainVertex, WeightedTerrainVertex } from './zone-types'

export type { TerrainGeometryData, TerrainVertex, WeightedTerrainVertex } from './zone-types'

const zone = getActiveZone()

export const WORLD_BOUNDS = zone.bounds
export const TERRAIN_CELL_SIZE = zone.cellSize

export function riverCenterAt(z: number): number { return zone.riverCenterAt(z) }
export function riverHalfWidthAt(z: number): number { return zone.riverHalfWidthAt(z) }
export function riverDepthAt(z: number): number { return zone.riverDepthAt(z) }
export function waterLevelAt(x: number, z: number): number | undefined { return zone.waterLevelAt(x, z) }
export function isWaterAt(x: number, z: number, radius = 0): boolean { return zone.isWaterAt(x, z, radius) }
export function terrainAllowsOccupancy(x: number, z: number, radius: number): boolean { return zone.canOccupyPoint(x, z, radius) }
export function terrainVertices(): readonly TerrainVertex[] { return zone.geometry().vertices }
export function terrainTriangleAt(x: number, z: number): readonly WeightedTerrainVertex[] { return zone.terrainTriangleAt(x, z) }
export function heightAt(x: number, z: number): number { return zone.heightAt(x, z) }
export function createTerrainGeometryData(): TerrainGeometryData { return zone.geometry() }
