import * as THREE from 'three'
import { describe, expect, it, vi } from 'vitest'
import { hillsideReviewRoute } from '../src/world/hillside-review'
import { TerrainTextureSource } from '../src/world/terrain-textures'
import { createWorldMaterial } from '../src/world/world-material'
import { compileZone } from '../src/world/zone-compiler'
import { DEFAULT_ZONE } from '../src/world/zone-default'

describe('hillside material review route', () => {
  it('leaves the ordinary and draft routes unchanged without the explicit opt-in', () => {
    expect(hillsideReviewRoute('')).toEqual({ enabled: false, loadZoneDraft: false })
    expect(hillsideReviewRoute('?zoneDraft=1')).toEqual({ enabled: false, loadZoneDraft: true })
    expect(hillsideReviewRoute('?hillsideReview=0&zoneDraft=1')).toEqual({ enabled: false, loadZoneDraft: true })
  })

  it('gives the committed comparison scene precedence over a saved draft', () => {
    expect(hillsideReviewRoute('?hillsideReview=1')).toEqual({ enabled: true, loadZoneDraft: false })
    expect(hillsideReviewRoute('?zoneDraft=1&hillsideReview=1')).toEqual({ enabled: true, loadZoneDraft: false })
  })

  it('clears a failed texture-set load, disposes siblings, and retries', async () => {
    const grass = new THREE.Texture()
    const earth = new THREE.Texture()
    const limestone = new THREE.Texture()
    const disposeGrass = vi.spyOn(grass, 'dispose')
    const loadAsync = vi.fn()
      .mockResolvedValueOnce(grass)
      .mockRejectedValueOnce(new Error('missing'))
      .mockResolvedValueOnce(limestone)
      .mockResolvedValueOnce(grass)
      .mockResolvedValueOnce(earth)
      .mockResolvedValueOnce(limestone)
    const source = new TerrainTextureSource({
      grass: 'grass.png', earth: 'earth.png', limestone: 'limestone.png',
    }, { loadAsync }, '/ashveil/')

    await expect(source.load()).rejects.toThrow('Could not load the terrain textures.')
    expect(disposeGrass).toHaveBeenCalledOnce()
    const textures = await source.load()
    expect(loadAsync).toHaveBeenNthCalledWith(5, '/ashveil/textures/first-zone/earth.png')
    expect(textures.earth).toBe(earth)
    expect(earth.colorSpace).toBe(THREE.SRGBColorSpace)
    expect(earth.wrapS).toBe(THREE.MirroredRepeatWrapping)
    expect(earth.wrapT).toBe(THREE.MirroredRepeatWrapping)
  })

  it('uses the approved grass globally and applies ash after painterly ground composition', () => {
    const textures = {
      grass: new THREE.Texture(), earth: new THREE.Texture(), limestone: new THREE.Texture(), dispose: vi.fn(),
    }
    const controller = createWorldMaterial(textures, compileZone(DEFAULT_ZONE))
    const shader = {
      uniforms: {},
      vertexShader: '#include <common>\n#include <begin_vertex>',
      fragmentShader: '#include <common>\n#include <map_fragment>\n#include <color_fragment>',
    }
    controller.material.onBeforeCompile(shader as never, {} as never)

    expect(controller.material.map).toBe(textures.grass)
    expect(shader.fragmentShader).toContain('vec2 painterlyUv = vTerrainWorldPosition / 5.2')
    expect(shader.fragmentShader).toContain('vec2(-painterlyUv.y, painterlyUv.x) * 0.83 + vec2(0.37, 0.61)')
    expect(shader.fragmentShader).not.toContain('hillsideMask')
    expect(shader.fragmentShader).not.toContain('terrainPainterlyAshMap')
    expect(shader.fragmentShader.indexOf('diffuseColor *= vec4(painterlyGround'))
      .toBeLessThan(shader.fragmentShader.indexOf('#include <color_fragment>'))
    expect(shader.fragmentShader.indexOf('#include <color_fragment>'))
      .toBeLessThan(shader.fragmentShader.indexOf('terrainDrainedAsh'))
    expect(controller.materialFor('baseline')).toBeUndefined()
    expect(controller.materialFor('painterly')).toBe(controller.material)
  })
})
