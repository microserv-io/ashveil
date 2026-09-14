import * as THREE from 'three'
import { describe, expect, it, vi } from 'vitest'
import { hillsideReviewRoute } from '../src/world/hillside-review'
import { PainterlyGrassSource } from '../src/world/painterly-grass'

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

  it('clears a failed candidate load so review can retry before selecting it', async () => {
    const texture = new THREE.Texture()
    const loadAsync = vi.fn()
      .mockRejectedValueOnce(new Error('missing'))
      .mockResolvedValueOnce(texture)
    const source = new PainterlyGrassSource({ loadAsync }, '/ashveil/')

    await expect(source.load()).rejects.toThrow('Could not load the painterly hillside grass.')
    await expect(source.load()).resolves.toBe(texture)
    expect(loadAsync).toHaveBeenNthCalledWith(2, '/ashveil/textures/first-zone/meadow-grass-painterly-v1.png')
    expect(texture.colorSpace).toBe(THREE.SRGBColorSpace)
    expect(texture.wrapS).toBe(THREE.MirroredRepeatWrapping)
    expect(texture.wrapT).toBe(THREE.MirroredRepeatWrapping)
  })
})
