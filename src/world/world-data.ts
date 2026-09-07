export interface WorldPoint { readonly x: number; readonly z: number }
export interface Landmark extends WorldPoint { readonly id: string; readonly label: string; readonly radius: number }
export interface WorldPath { readonly id: string; readonly from: string; readonly to: string; readonly width: number; readonly points: readonly WorldPoint[] }
export interface WorldSolid extends WorldPoint { readonly id: string; readonly radius: number }

export const SPAWN = { x: -40, z: 25 } as const

export const LANDMARKS: readonly Landmark[] = [
  { id: 'refuge', label: 'Alderbank Refuge', x: -40, z: 25, radius: 11 },
  { id: 'wagon', label: 'Stranded Wagon', x: -60, z: -15, radius: 7 },
  { id: 'orchard', label: 'Old Orchard', x: -80, z: -35, radius: 8 },
  { id: 'farm', label: 'Westmere Farm', x: -85, z: 20, radius: 9 },
  { id: 'grove', label: 'Alder Grove', x: -65, z: -65, radius: 8 },
  { id: 'rally', label: 'Lower Road', x: -25, z: -60, radius: 7 },
  { id: 'waystation', label: 'Broken Waystation', x: -15, z: -80, radius: 7 },
] as const

export const PATHS: readonly WorldPath[] = [
  { id: 'refuge-road', from: 'refuge', to: 'wagon', width: 5, points: [SPAWN, { x: -46, z: 10 }, { x: -55.2, z: -10.2 }] },
  { id: 'farm-loop-a', from: 'refuge', to: 'farm', width: 3.5, points: [SPAWN, { x: -43, z: 15 }, { x: -64, z: 12 }, { x: -78, z: 22 }] },
  { id: 'farm-loop-b', from: 'farm', to: 'wagon', width: 3.5, points: [{ x: -78, z: 22 }, { x: -74, z: 1 }, { x: -55.2, z: -10.2 }] },
  { id: 'orchard-loop-a', from: 'wagon', to: 'orchard', width: 3.5, points: [{ x: -55.2, z: -10.2 }, { x: -54.5, z: -20 }, { x: -69, z: -20 }, { x: -72, z: -34 }] },
  { id: 'orchard-loop-b', from: 'orchard', to: 'grove', width: 3.5, points: [{ x: -72, z: -34 }, { x: -61, z: -43 }, { x: -49, z: -53 }, { x: -48, z: -79 }, { x: -57, z: -83 }, { x: -55, z: -76 }, { x: -60, z: -71 }, { x: -63.5, z: -65 }] },
  { id: 'lower-road', from: 'wagon', to: 'rally', width: 5, points: [{ x: -55.2, z: -10.2 }, { x: -49, z: -34 }, { x: -38, z: -48 }, { x: -25, z: -60 }] },
  { id: 'grove-return', from: 'grove', to: 'rally', width: 3.5, points: [{ x: -63.5, z: -65 }, { x: -45, z: -70 }, { x: -25, z: -60 }] },
  { id: 'waystation-descent', from: 'rally', to: 'waystation', width: 5, points: [{ x: -25, z: -60 }, { x: -22, z: -69 }, { x: -20, z: -76 }] },
] as const

export const SOLIDS: readonly WorldSolid[] = [
  { id: 'refuge-hall', x: -52, z: 29, radius: 6 },
  { id: 'refuge-cottage-north', x: -40, z: 39, radius: 4.5 },
  { id: 'refuge-cottage-east', x: -28, z: 30, radius: 4.5 },
  { id: 'refuge-workshop', x: -31, z: 17, radius: 4 },
  { id: 'farm-house', x: -91, z: 23, radius: 5 },
  { id: 'farm-barn', x: -82, z: 30, radius: 5 },
  { id: 'waystation-gate', x: -11, z: -84, radius: 6 },
  { id: 'bridge-abutment', x: 5, z: -80, radius: 4 },
  { id: 'wagon', x: -60, z: -15, radius: 3 },
  ...[-91, -83, -75].flatMap((x, column) => [-46, -38, -30, -22].map((z, row) => ({
    id: `orchard-tree-${String(column * 4 + row + 1).padStart(2, '0')}`, x, z, radius: 1.15,
  }))),
  ...[[-77, -73], [-70, -78], [-61, -77], [-54, -70], [-55, -59], [-63, -54], [-73, -57], [-80, -64], [-67, -67]]
    .map(([x, z], index) => ({ id: `grove-tree-${String(index + 1).padStart(2, '0')}`, x: x!, z: z!, radius: 1.35 })),
  ...[[-104, 44], [-101, 5], [-93, -7], [-73, 45], [-60, 48], [-17, 42], [-7, 23], [-7, -34], [-3, -55], [-31, -88], [-49, -88], [-92, -82]]
    .map(([x, z], index) => ({ id: `wild-tree-${String(index + 1).padStart(2, '0')}`, x: x!, z: z!, radius: 1.1 })),
  ...[[-20, 47], [-14, 43], [-8, 37], [-4, 12], [-2, -3], [0, -20], [1, -39], [3, -57], [4, -69], [-25, -88], [-36, -88], [-52, -88], [-106, -62], [-108, -32], [-109, 12]]
    .map(([x, z], index) => ({ id: `bank-rock-${String(index + 1).padStart(2, '0')}`, x: x!, z: z!, radius: 0.7 })),
] as const

export function nearestLandmark(x: number, z: number): Landmark {
  return LANDMARKS.reduce((nearest, landmark) =>
    Math.hypot(landmark.x - x, landmark.z - z) < Math.hypot(nearest.x - x, nearest.z - z)
      ? landmark : nearest)
}
