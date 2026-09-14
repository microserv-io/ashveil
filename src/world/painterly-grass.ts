import * as THREE from 'three'

export const PAINTERLY_GRASS_TEXTURE_PATH = 'textures/first-zone/meadow-grass-painterly-v1.png'

interface TextureLoaderLike {
  loadAsync(url: string): Promise<THREE.Texture>
}

export class PainterlyGrassSource {
  private pending: Promise<THREE.Texture> | undefined

  constructor(
    private readonly loader: TextureLoaderLike = new THREE.TextureLoader(),
    private readonly baseUrl: string = import.meta.env.BASE_URL,
  ) {}

  load(): Promise<THREE.Texture> {
    if (this.pending) return this.pending
    this.pending = this.loader.loadAsync(`${this.baseUrl}${PAINTERLY_GRASS_TEXTURE_PATH}`)
      .then((texture) => {
        texture.colorSpace = THREE.SRGBColorSpace
        texture.wrapS = THREE.MirroredRepeatWrapping
        texture.wrapT = THREE.MirroredRepeatWrapping
        return texture
      })
      .catch((cause: unknown) => {
        throw new Error('Could not load the painterly hillside grass.', { cause })
      })
      .finally(() => { this.pending = undefined })
    return this.pending
  }
}

const sharedPainterlyGrassSource = new PainterlyGrassSource()
export function loadPainterlyGrassTexture(): Promise<THREE.Texture> { return sharedPainterlyGrassSource.load() }
