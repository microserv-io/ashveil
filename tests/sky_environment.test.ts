import * as THREE from 'three'
import { resolve } from 'node:path'
import sharp from 'sharp'
import { describe, expect, it, vi } from 'vitest'
import {
  SkyTextureSource,
  buildSkyEnvironment,
  cloudCoverageFromLinearRgb,
  sampleSkyState,
} from '../src/world/sky-environment'

describe('sky environment', () => {
  it('samples smooth finite opposing celestial directions throughout the day', () => {
    const samples = Array.from({ length: 241 }, (_, index) => sampleSkyState(index / 10))
    for (const state of samples) {
      const numbers = [
        ...state.sunDirection.toArray(), ...state.moonDirection.toArray(),
        state.sunIntensity, state.moonIntensity, state.hemisphereIntensity,
        ...state.fogColor.toArray(), ...state.sunColor.toArray(), ...state.moonColor.toArray(),
        ...state.hemisphereSkyColor.toArray(), ...state.hemisphereGroundColor.toArray(), state.starOpacity,
      ]
      expect(numbers.every(Number.isFinite)).toBe(true)
      expect(state.sunDirection.dot(state.moonDirection)).toBeCloseTo(-1, 10)
    }
    for (let index = 1; index < samples.length; index += 1) {
      expect(colorDistance(samples[index]!.fogColor, samples[index - 1]!.fogColor)).toBeLessThan(0.05)
    }
    expect(colorDistance(samples[0]!.fogColor, samples[240]!.fogColor)).toBeLessThan(1e-10)
  })

  it('retains readable blue ambient and moon lighting at midnight', () => {
    const midnight = sampleSkyState(0)
    expect(midnight.hemisphereIntensity).toBeGreaterThanOrEqual(1.5)
    expect(midnight.moonIntensity).toBeGreaterThanOrEqual(1.1)
    expect(midnight.starOpacity).toBeGreaterThan(0.7)
    expect(midnight.sunIntensity).toBe(0)
  })

  it('allocates a fixed three-light environment and disposes every owned resource', () => {
    const scene = new THREE.Scene()
    const texture = new THREE.Texture()
    const textureDispose = vi.spyOn(texture, 'dispose')
    const environment = buildSkyEnvironment(scene, texture, 0.002)
    const skyMaterial = (scene.getObjectByName('painterly-sky') as THREE.Mesh).material as THREE.ShaderMaterial
    expect(texture.colorSpace).toBe(THREE.SRGBColorSpace)
    expect(skyMaterial.fragmentShader.match(/tonemapping_fragment/g)).toHaveLength(1)
    expect(skyMaterial.fragmentShader.match(/colorspace_fragment/g)).toHaveLength(1)
    expect(skyMaterial.fragmentShader).not.toContain('sRGBTransferEOTF')
    expect(scene.children.filter((child) => child instanceof THREE.Light)).toHaveLength(3)
    for (const name of ['night-stars', 'sun-disc', 'moon-disc']) {
      const material = (scene.getObjectByName(name) as THREE.Points | THREE.Mesh).material as THREE.ShaderMaterial
      expect(material.depthTest).toBe(true)
      expect(material.depthWrite).toBe(false)
      expect(material.vertexShader).toContain('gl_Position.z = gl_Position.w')
      if (name.endsWith('disc')) {
        expect(material.uniforms.skyMap!.value).toBe(texture)
        expect(material.vertexShader).toContain('worldPosition.xyz - cameraPosition')
        expect(material.fragmentShader).toContain('uniform sampler2D skyMap')
        expect(material.fragmentShader).toContain('panoramaCloudCoverage')
        expect(material.fragmentShader).toContain('(1.0 - cloudCoverage)')
      }
    }
    environment.update(sampleSkyState(12), new THREE.Vector3(4, 5, 6), { x: 2, y: 3, z: 4 })
    expect(environment.sun.target.position.toArray()).toEqual([2, 3, 4])
    expect(environment.sun.position.clone().sub(environment.sun.target.position).normalize()
      .dot(sampleSkyState(12).sunDirection)).toBeCloseTo(1, 10)
    environment.update(sampleSkyState(0), new THREE.Vector3(), { x: 0, y: 0, z: 0 })
    expect(scene.children.filter((child) => child instanceof THREE.Light)).toHaveLength(3)
    environment.setFogDensity(0.0002)
    expect((scene.fog as THREE.FogExp2).density).toBe(0.0002)
    environment.dispose()
    expect(scene.children.filter((child) => child instanceof THREE.Light)).toHaveLength(0)
    expect(textureDispose).toHaveBeenCalledOnce()
  })

  it('allows a failed texture load to be retried', async () => {
    const texture = new THREE.Texture()
    const loader = { loadAsync: vi.fn()
      .mockRejectedValueOnce(new Error('network'))
      .mockResolvedValueOnce(texture) }
    const source = new SkyTextureSource(loader)
    await expect(source.load()).rejects.toThrow(/sky/)
    await expect(source.load()).resolves.toBe(texture)
    expect(loader.loadAsync).toHaveBeenCalledTimes(2)
  })

  it('separates clear sky, cloud shadow and dense cloud from the active panorama pixels', async () => {
    const image = sharp(resolve(import.meta.dirname, '../public/textures/sky/ashveil-sky-day-v2.png'))
    const coverage = async (x: number, y: number): Promise<number> => {
      const pixel = await image.clone().extract({ left: x, top: y, width: 1, height: 1 }).raw().toBuffer()
      return cloudCoverageFromLinearRgb(
        srgbByteToLinear(pixel[0]!),
        srgbByteToLinear(pixel[1]!),
        srgbByteToLinear(pixel[2]!),
      )
    }
    const clearSky = await coverage(887, 100)
    const cloudShadow = await coverage(350, 370)
    const denseCloud = await coverage(400, 230)
    expect(clearSky).toBeLessThan(0.05)
    expect(cloudShadow).toBeGreaterThan(0.5)
    expect(cloudShadow).toBeLessThan(denseCloud)
    expect(denseCloud).toBeGreaterThan(0.95)
    expect(cloudCoverageFromLinearRgb(0.8, 0.8, 0.8, 0.05)).toBeLessThan(0.25)
  })
})

function colorDistance(first: THREE.Color, second: THREE.Color): number {
  return Math.hypot(first.r - second.r, first.g - second.g, first.b - second.b)
}

function srgbByteToLinear(channel: number): number {
  const value = channel / 255
  return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
}
