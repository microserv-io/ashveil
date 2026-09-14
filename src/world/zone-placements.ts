import { projectLegacyPlacement } from './anchored-placement'
import { mapToWorld } from './zone-default'
import type { WorldPoint, ZoneLandmark, ZonePath } from './zone-types'

export interface ProjectedWorldSolid extends WorldPoint { readonly id: string; readonly radius: number }

export interface PlacementZone {
  readonly landmarks: readonly ZoneLandmark[]
  readonly paths: readonly ZonePath[]
  canOccupyPoint(x: number, z: number, radius: number): boolean
}

interface LegacySolid extends ProjectedWorldSolid { readonly home: string; readonly legacyHome: WorldPoint }
const legacy = (home: string, legacyHome: WorldPoint, id: string, x: number, z: number, radius: number): LegacySolid =>
  ({ home, legacyHome, id, x, z, radius })
const REFUGE = { x: -40, z: 25 }
const FARM = { x: -85, z: 20 }
const ORCHARD = { x: -80, z: -35 }
const GROVE = { x: -65, z: -65 }
const WAYSTATION = { x: -15, z: -80 }
const ABUTMENT = { x: 5, z: -80 }
const WAGON = { x: -60, z: -15 }
const wagonMapOffset = {
  x: mapToWorld(1080, 398).x - mapToWorld(1030, 370).x,
  z: mapToWorld(1080, 398).z - mapToWorld(1030, 370).z,
}
const abutmentMapOffset = { x: mapToWorld(402, 660).x - mapToWorld(406, 660).x, z: 0 }

const LEGACY_SOLIDS: readonly LegacySolid[] = [
  legacy('refuge', REFUGE, 'refuge-hall', -52, 29, 6),
  legacy('refuge', REFUGE, 'refuge-cottage-north', -40, 39, 4.5),
  legacy('refuge', REFUGE, 'refuge-cottage-east', -28, 30, 4.5),
  legacy('refuge', REFUGE, 'refuge-workshop', -31, 17, 4),
  legacy('farm', FARM, 'farm-house', -91, 23, 5),
  legacy('farm', FARM, 'farm-barn', -82, 30, 5),
  legacy('waystation', WAYSTATION, 'waystation-gate', -5, -88, 6),
  legacy('bridge-abutment', ABUTMENT, 'bridge-abutment', ABUTMENT.x + abutmentMapOffset.x, ABUTMENT.z, 4),
  legacy('wagon', WAGON, 'wagon', WAGON.x + wagonMapOffset.x, WAGON.z + wagonMapOffset.z, 3),
  ...[-91, -83, -75].flatMap((x, column) => [-46, -38, -30, -22].map((z, row) =>
    legacy('orchard', ORCHARD, `orchard-tree-${String(column * 4 + row + 1).padStart(2, '0')}`,
      column === 2 && (row === 0 || row === 2) ? x + 13 : x, z, 1.15))),
  ...[[-77, -73], [-70, -78], [-61, -77], [-54, -70], [-55, -59], [-63, -54], [-73, -57], [-80, -64], [-67, -67]]
    .map(([x, z], index) => legacy('grove', GROVE, `grove-tree-${String(index + 1).padStart(2, '0')}`,
      index === 8 ? x! - 10 : x!, index === 8 ? z! + 10 : z!, 1.35)),
]

const mapSolids = (prefix: string, radius: number, points: readonly (readonly [number, number])[]): ProjectedWorldSolid[] =>
  points.map(([x, y], index) => ({ id: `${prefix}-${String(index + 1).padStart(2, '0')}`, radius, ...mapToWorld(x, y) }))

function distanceToSegment(point: WorldPoint, from: WorldPoint, to: WorldPoint): number {
  const dx = to.x - from.x
  const dz = to.z - from.z
  const squared = dx * dx + dz * dz
  const t = squared === 0 ? 0 : Math.max(0, Math.min(1, ((point.x - from.x) * dx + (point.z - from.z) * dz) / squared))
  return Math.hypot(point.x - from.x - dx * t, point.z - from.z - dz * t)
}

const authoredForestPixels: readonly (readonly [number, number])[] = [90, 190, 290, 390, 490, 590, 690, 790]
  .flatMap((y, row) => [620, 730, 840, 950, 1060, 1170, 1280, 1390]
    .map((x, column) => [x + (row % 2) * 28, y + (column % 3) * 13] as const))

export function projectZoneSolids(zone: PlacementZone): readonly ProjectedWorldSolid[] {
  const landmarks = zone.landmarks
  const paths = zone.paths
  const anchored = LEGACY_SOLIDS.map(({ home, legacyHome, id, radius, x, z }) => ({
    id, radius, ...projectLegacyPlacement(zone, home, legacyHome, { x, z }),
  }))
  const forest = mapSolids('wild-tree', 1.1, authoredForestPixels).filter((tree) => {
    const routeDistance = paths.reduce((nearest, path) => Math.min(nearest, ...path.points.slice(1)
      .map((point, index) => distanceToSegment(tree, path.points[index]!, point))), Infinity)
    const landmarkDistance = landmarks.reduce((nearest, landmark) => Math.min(nearest,
      Math.hypot(tree.x - landmark.x, tree.z - landmark.z) - landmark.radius), Infinity)
    return zone.canOccupyPoint(tree.x, tree.z, 3) && routeDistance >= 24 && landmarkDistance >= 18
  }).slice(0, 50)
  const bankRocks = mapSolids('bank-rock', 0.7, [
    [520, 70], [500, 130], [520, 230], [555, 300], [520, 390], [430, 500], [420, 580],
    [425, 625], [455, 700], [460, 770], [485, 820], [545, 450], [475, 340], [510, 180], [450, 550],
  ])
  return [...anchored, ...forest, ...bankRocks]
}
