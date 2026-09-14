import * as THREE from 'three'

export interface TerrainTextureSet {
  readonly grass: THREE.Texture
  readonly earth: THREE.Texture
  readonly limestone: THREE.Texture
  readonly ash?: THREE.Texture
  dispose(): void
}

interface TextureLoaderLike {
  loadAsync(url: string): Promise<THREE.Texture>
}

const PAINTERLY_FILES = {
  grass: 'meadow-grass-painterly-v1.png',
  earth: 'worn-earth-painterly-v1.png',
  limestone: 'ivory-limestone-painterly-v1.png',
} as const

const BASELINE_FILES = {
  grass: 'meadow-grass.png',
  earth: 'worn-earth.png',
  limestone: 'ivory-limestone.png',
  ash: 'ash-ground.png',
} as const

export class TerrainTextureSource {
  private pending: Promise<TerrainTextureSet> | undefined

  constructor(
    private readonly files: Readonly<Record<string, string>>,
    private readonly loader: TextureLoaderLike = new THREE.TextureLoader(),
    private readonly baseUrl: string = import.meta.env.BASE_URL,
  ) {}

  load(): Promise<TerrainTextureSet> {
    if (this.pending) return this.pending
    this.pending = loadTextureSet(this.files, this.loader, this.baseUrl)
      .finally(() => { this.pending = undefined })
    return this.pending
  }
}

async function loadTextureSet(
  files: Readonly<Record<string, string>>,
  loader: TextureLoaderLike,
  baseUrl: string,
): Promise<TerrainTextureSet> {
  const entries = Object.entries(files)
  const results = await Promise.allSettled(entries.map(([, file]) =>
    loader.loadAsync(`${baseUrl}textures/first-zone/${file}`)))
  const failed = results.find((result) => result.status === 'rejected')
  if (failed) {
    for (const result of results) if (result.status === 'fulfilled') result.value.dispose()
    throw new Error('Could not load the terrain textures.', { cause: failed.reason })
  }
  const textures = Object.fromEntries(entries.map(([name], index) => {
    const texture = (results[index] as PromiseFulfilledResult<THREE.Texture>).value
    texture.colorSpace = THREE.SRGBColorSpace
    texture.wrapS = THREE.MirroredRepeatWrapping
    texture.wrapT = THREE.MirroredRepeatWrapping
    return [name, texture]
  })) as Record<string, THREE.Texture>
  return {
    grass: textures.grass!,
    earth: textures.earth!,
    limestone: textures.limestone!,
    ash: textures.ash,
    dispose: () => { for (const texture of Object.values(textures)) texture.dispose() },
  }
}

const painterlySource = new TerrainTextureSource(PAINTERLY_FILES)
const baselineSource = new TerrainTextureSource(BASELINE_FILES)

export function loadPainterlyTerrainTextures(): Promise<TerrainTextureSet> { return painterlySource.load() }
export function loadBaselineTerrainTextures(): Promise<TerrainTextureSet> { return baselineSource.load() }
