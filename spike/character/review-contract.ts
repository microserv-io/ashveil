export const GAMEPLAY_CAMERA_FOV = 38
export const GAMEPLAY_CAMERA_OFFSET = [0, 19, 14.5] as const

export const NATIVE_SCALE = 1
export const CURRENT_PLAYER_RUNTIME_SCALE = 0.44 * 1.93

export const POSE_FRAMES = {
  bind: 0,
  'overhead-reach': 10,
  'horizontal-attack': 20,
  'deep-elbow-bend': 30,
  'long-stride': 40,
  'head-turn': 50,
} as const

export const REQUIRED_SEMANTIC_MESHES = [
  'Body',
  'Head',
  'Hand_NegativeX',
  'Hand_PositiveX',
  'Eye_NegativeX',
  'Eye_PositiveX',
  'Facial_Feature_01',
] as const

export type SemanticMeshName = (typeof REQUIRED_SEMANTIC_MESHES)[number]

export interface CharacterAssetSummary {
  skins: number
  joints: number
  clips: { name: string; duration: number }[]
  semanticMeshes: Record<string, { skinned: boolean }>
  bounds: {
    minimum: [number, number, number]
    maximum: [number, number, number]
  }
}

const EXPECTED_NATIVE_HEIGHT = 1.8
const BOUNDS_TOLERANCE = 0.02

export function assertCharacterAssetSummary(summary: CharacterAssetSummary): void {
  const failures: string[] = []
  if (summary.skins < 1) failures.push('at least one skin is required')
  if (summary.joints < 1) failures.push('the skin must contain joints')

  const clipNames = summary.clips.map((clip) => clip.name)
  if (new Set(clipNames).size !== clipNames.length) failures.push('animation clip names must be unique')
  const stressClip = summary.clips.find((clip) => clip.name === 'Ashveil_RigStress')
  if (!stressClip) failures.push('Ashveil_RigStress is required')
  else if (!Number.isFinite(stressClip.duration) || stressClip.duration <= 0) {
    failures.push('Ashveil_RigStress must have positive duration')
  }

  for (const name of REQUIRED_SEMANTIC_MESHES) {
    const mesh = summary.semanticMeshes[name]
    if (!mesh) failures.push(`${name} is missing`)
    else if (!mesh.skinned) failures.push(`${name} must be a SkinnedMesh`)
  }

  const values = [...summary.bounds.minimum, ...summary.bounds.maximum]
  if (!values.every(Number.isFinite)) {
    failures.push('world bounds must be finite')
  } else {
    const height = summary.bounds.maximum[1] - summary.bounds.minimum[1]
    if (Math.abs(height - EXPECTED_NATIVE_HEIGHT) > BOUNDS_TOLERANCE) {
      failures.push(`native height must be ${EXPECTED_NATIVE_HEIGHT.toFixed(2)} m (±${BOUNDS_TOLERANCE.toFixed(2)} m)`)
    }
    if (Math.abs(summary.bounds.minimum[1]) > BOUNDS_TOLERANCE) {
      failures.push('feet must be grounded at world Y=0')
    }
  }

  if (failures.length > 0) throw new Error(failures.join('\n'))
}
