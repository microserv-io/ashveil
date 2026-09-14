import type * as THREE from 'three'
import { loadApprovedCharacter, type ApprovedCharacterTemplate } from './approved-character'
import { loadSceneryKit, type SceneryKit } from './scenery-kit'
import { loadSkyTexture } from './sky-environment'

export interface WorldAssets {
  readonly scenery: SceneryKit
  readonly character: ApprovedCharacterTemplate
  readonly sky: THREE.Texture
}

interface WorldAssetLoaders {
  readonly scenery: () => Promise<SceneryKit>
  readonly character: () => Promise<ApprovedCharacterTemplate>
  readonly sky: () => Promise<THREE.Texture>
}

const DEFAULT_LOADERS: WorldAssetLoaders = {
  scenery: loadSceneryKit,
  character: loadApprovedCharacter,
  sky: loadSkyTexture,
}

export async function loadWorldAssets(loaders: WorldAssetLoaders = DEFAULT_LOADERS): Promise<WorldAssets> {
  const [scenery, character, sky] = await Promise.allSettled([
    loaders.scenery(), loaders.character(), loaders.sky(),
  ])
  if (scenery.status === 'rejected' || character.status === 'rejected' || sky.status === 'rejected') {
    if (sky.status === 'fulfilled') sky.value.dispose()
    if (scenery.status === 'rejected') throw scenery.reason
    if (character.status === 'rejected') throw character.reason
    if (sky.status === 'rejected') throw sky.reason
    throw new Error('World asset loading failed without a reason.')
  }
  return {
    scenery: scenery.value,
    character: character.value,
    sky: sky.value,
  }
}
