import * as THREE from 'three'
import { describe, expect, it, vi } from 'vitest'
import { loadWorldAssets } from '../src/world/world-assets'

describe('world asset boot ownership', () => {
  it('disposes a successful sky texture when a sibling boot asset fails', async () => {
    const texture = new THREE.Texture()
    const dispose = vi.spyOn(texture, 'dispose')
    const disposeTerrain = vi.fn()
    await expect(loadWorldAssets({
      scenery: async () => { throw new Error('kit failed') },
      character: async () => ({}) as never,
      sky: async () => texture,
      terrain: async () => ({ dispose: disposeTerrain }) as never,
    })).rejects.toThrow('kit failed')
    expect(dispose).toHaveBeenCalledOnce()
    expect(disposeTerrain).toHaveBeenCalledOnce()
  })
})
