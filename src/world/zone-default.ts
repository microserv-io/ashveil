import type { WorldPoint, ZoneDefinition, ZoneLandmark, ZoneRiverPoint, ZoneRidge } from './zone-types'

const mainRoadPixels = [
  [825, 170], [865, 248], [965, 328], [1030, 370], [1015, 421], [900, 470],
  [795, 519], [690, 600], [620, 636], [590, 696], [550, 720],
] as const

function pixelPolylineLength(points: readonly (readonly [number, number])[]): number {
  let length = 0
  for (let index = 1; index < points.length; index += 1) {
    length += Math.hypot(points[index]![0] - points[index - 1]![0], points[index]![1] - points[index - 1]![1])
  }
  return length
}

export const MAP_ART_BOUNDS = { minX: 13, maxX: 1523, minY: 7, maxY: 847 } as const
export const MAP_CENTER = { x: 768, y: 427 } as const
export const MAP_SCALE = 1_500 / pixelPolylineLength(mainRoadPixels)
const WORLD_WIDTH = Math.ceil((MAP_ART_BOUNDS.maxX - MAP_ART_BOUNDS.minX) * MAP_SCALE / 5) * 5
const WORLD_DEPTH = Math.ceil((MAP_ART_BOUNDS.maxY - MAP_ART_BOUNDS.minY) * MAP_SCALE / 5) * 5

export function mapToWorld(x: number, y: number): WorldPoint {
  return { x: (MAP_CENTER.x - x) * MAP_SCALE, z: (MAP_CENTER.y - y) * MAP_SCALE }
}

export function worldToMap(x: number, z: number): { readonly x: number; readonly y: number } {
  return { x: MAP_CENTER.x - x / MAP_SCALE, y: MAP_CENTER.y - z / MAP_SCALE }
}

function landmark(id: string, label: string, x: number, y: number, radius: number): ZoneLandmark {
  return { id, label, ...mapToWorld(x, y), radius }
}

const mainRoad = mainRoadPixels.map(([x, y]) => mapToWorld(x, y))

export const DEFAULT_ZONE: ZoneDefinition = {
  schemaVersion: 1,
  id: 'alderbank-opening-zone',
  bounds: {
    minX: -WORLD_WIDTH / 2,
    maxX: WORLD_WIDTH / 2,
    minZ: -WORLD_DEPTH / 2,
    maxZ: WORLD_DEPTH / 2,
  },
  cellSize: 5,
  spawn: { landmarkId: 'safe-landing', offset: { x: 86, z: 0 } },
  mainRoute: ['refuge-road', 'lower-road', 'waystation-descent'],
  landmarks: [
    landmark('refuge', 'Alderbank Refuge', 825, 170, 30),
    landmark('safe-landing', 'Safe Landing', 540, 175, 12),
    landmark('wagon', 'Stranded Wagon', 1030, 370, 9),
    landmark('farm', 'Westmere Farm', 1270, 200, 22),
    landmark('orchard', 'Old Orchard', 1340, 500, 20),
    landmark('grove', 'Alder Grove', 1110, 675, 18),
    landmark('rally', 'Lower Road', 690, 600, 12),
    landmark('waystation', 'Broken Waystation', 550, 720, 14),
    landmark('bridge-abutment', 'Broken Bridge', 406, 660, 8),
  ],
  paths: [
    { id: 'refuge-road', from: 'refuge', to: 'wagon', width: 8, points: mainRoad.slice(0, 4) },
    { id: 'lower-road', from: 'wagon', to: 'rally', width: 8, points: mainRoad.slice(3, 8) },
    { id: 'waystation-descent', from: 'rally', to: 'waystation', width: 8, points: mainRoad.slice(7) },
    { id: 'farm-loop-a', from: 'refuge', to: 'farm', width: 5, points: [mainRoad[0]!, mainRoad[1]!, mapToWorld(1030, 145), mapToWorld(1270, 200)] },
    { id: 'farm-loop-b', from: 'farm', to: 'wagon', width: 5, points: [mapToWorld(1270, 200), mapToWorld(1190, 315), mapToWorld(1030, 370)] },
    { id: 'orchard-loop-a', from: 'wagon', to: 'orchard', width: 5, points: [mapToWorld(1030, 370), mapToWorld(1200, 420), mapToWorld(1340, 500)] },
    { id: 'orchard-loop-b', from: 'orchard', to: 'grove', width: 5, points: [mapToWorld(1340, 500), mapToWorld(1280, 600), mapToWorld(1110, 675)] },
    { id: 'grove-return', from: 'grove', to: 'rally', width: 5, points: [mapToWorld(1110, 675), mapToWorld(920, 640), mapToWorld(690, 600)] },
    { id: 'landing-road', from: 'refuge', to: 'safe-landing', width: 5, points: [mainRoad[0]!, mainRoad[1]!, mapToWorld(680, 250), mapToWorld(540, 175)] },
    { id: 'bridge-approach', from: 'waystation', to: 'bridge-abutment', width: 6, points: [mapToWorld(550, 720), mapToWorld(500, 690), mapToWorld(406, 660)] },
  ],
  ridges: [
    { id: 'north-ridge', halfWidth: 72, height: 128, points: [
      mapToWorld(1490, 35), mapToWorld(1340, 68), mapToWorld(1180, 28), mapToWorld(1010, 74),
      mapToWorld(835, 38), mapToWorld(660, 82), mapToWorld(490, 35),
    ] },
    { id: 'east-ridge', halfWidth: 78, height: 142, points: [
      mapToWorld(1490, 35), mapToWorld(1445, 170), mapToWorld(1495, 315), mapToWorld(1438, 455),
      mapToWorld(1492, 600), mapToWorld(1450, 715), mapToWorld(1490, 815),
    ] },
    { id: 'south-ridge', halfWidth: 76, height: 136, points: [
      mapToWorld(1490, 815), mapToWorld(1320, 780), mapToWorld(1140, 830), mapToWorld(960, 792),
      mapToWorld(790, 834), mapToWorld(610, 790), mapToWorld(430, 815),
    ] },
  ] satisfies readonly ZoneRidge[],
  river: {
    waterLevel: -1.5,
    points: ([
      [395, 850, 55], [365, 760, 55], [330, 655, 65], [345, 520, 60], [445, 420, 50],
      [490, 300, 45], [440, 230, 48], [410, 100, 52], [445, 0, 55],
    ] as const).map(([x, y, halfWidth]) => ({ ...mapToWorld(x, y), halfWidth: halfWidth * MAP_SCALE, depth: 7 })) as ZoneRiverPoint[],
  },
  terrain: {
    baseHeight: 4,
    strokes: [],
    landforms: [
      { kind: 'hill', id: 'refuge-bench', halfWidth: 80, height: 14, points: [
        mapToWorld(760, 145), mapToWorld(825, 170), mapToWorld(935, 200),
      ] },
      { kind: 'barrier', id: 'refuge-west-bluff', halfWidth: 32, height: 22, points: [
        mapToWorld(660, 82), mapToWorld(650, 170), mapToWorld(720, 210), mapToWorld(805, 220), mapToWorld(840, 235),
      ] },
      { kind: 'hill', id: 'lower-road-west-hills', halfWidth: 90, height: 20, points: [
        mapToWorld(650, 340), mapToWorld(730, 390), mapToWorld(790, 440),
      ] },
      { kind: 'barrier', id: 'lower-road-rock-face-north', halfWidth: 25, height: 15, points: [
        mapToWorld(650, 350), mapToWorld(700, 365),
      ] },
      { kind: 'barrier', id: 'lower-road-rock-face-south', halfWidth: 25, height: 14, points: [
        mapToWorld(735, 415), mapToWorld(780, 430),
      ] },
      { kind: 'hill', id: 'farm-rolling-fields', halfWidth: 90, height: 16, points: [
        mapToWorld(1_040, 210), mapToWorld(1_160, 260), mapToWorld(1_250, 330),
      ] },
      { kind: 'hill', id: 'orchard-terraces', halfWidth: 80, height: 14, points: [
        mapToWorld(1_190, 440), mapToWorld(1_300, 520), mapToWorld(1_240, 590),
      ] },
      { kind: 'hill', id: 'grove-rally-rise', halfWidth: 90, height: 16, points: [
        mapToWorld(900, 610), mapToWorld(1_020, 650), mapToWorld(1_120, 690),
      ] },
    ],
  },
}
