import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import * as THREE from 'three'
import { describe, expect, it, vi } from 'vitest'
import { isBodyMaterial, LOOK, stylise, toonRamp } from '../src/render/look'

function meshMaterial(mesh: THREE.Mesh): THREE.Material {
  if (Array.isArray(mesh.material)) throw new Error('expected one material')
  return mesh.material
}

describe('the painterly look', () => {
  it('uses one nearest-filtered ascending toon ramp', () => {
    const ramp = toonRamp()
    if (!ramp.image.data) throw new Error('expected ramp texels')
    const texels = Array.from(ramp.image.data)

    expect(toonRamp()).toBe(ramp)
    expect(ramp.image.width).toBe(LOOK.ramp.length)
    expect(ramp.image.height).toBe(1)
    expect(ramp.minFilter).toBe(THREE.NearestFilter)
    expect(ramp.magFilter).toBe(THREE.NearestFilter)
    expect(ramp.generateMipmaps).toBe(false)
    expect(ramp.colorSpace).toBe(THREE.NoColorSpace)
    expect(texels).toEqual(LOOK.ramp.map((step) => Math.round(step * 255)))
    expect(texels.at(-1)).toBe(255)
    expect(texels.every((step, index) => index === 0 || step > texels[index - 1]!)).toBe(true)
  })

  it('converts physical materials while preserving authored surface properties', () => {
    const map = new THREE.Texture()
    const source = new THREE.MeshPhysicalMaterial({
      map,
      color: 0x6f3d91,
      transparent: true,
      opacity: 0.5,
      side: THREE.DoubleSide,
      emissive: 0x28143f,
    })
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(), source)
    const group = new THREE.Group().add(mesh)

    expect(stylise(group)).toBe(group)
    const material = meshMaterial(mesh)
    expect(isBodyMaterial(material)).toBe(true)
    if (!isBodyMaterial(material)) throw new Error('expected a toon material')
    expect(material.map).toBe(map)
    expect(material.color.getHex()).toBe(source.color.getHex())
    expect(material.transparent).toBe(true)
    expect(material.opacity).toBe(0.5)
    expect(material.side).toBe(THREE.DoubleSide)
    expect(material.emissive.getHex()).toBe(source.emissive.getHex())
    expect(material.gradientMap).toBe(toonRamp())
  })

  it('keeps a skinned mesh and its skeleton intact', () => {
    const bone = new THREE.Bone()
    const skeleton = new THREE.Skeleton([bone])
    const mesh = new THREE.SkinnedMesh(new THREE.BoxGeometry(), new THREE.MeshPhysicalMaterial())
    mesh.add(bone)
    mesh.bind(skeleton)
    const group = new THREE.Group().add(mesh)

    stylise(group)

    expect(group.children[0]).toBe(mesh)
    expect(mesh.skeleton).toBe(skeleton)
    expect(meshMaterial(mesh)).toBeInstanceOf(THREE.MeshToonMaterial)
  })

  it('converts material arrays entry by entry', () => {
    const physical = new THREE.MeshPhysicalMaterial()
    const basic = new THREE.MeshBasicMaterial()
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(), [physical, basic])

    stylise(mesh)

    expect(Array.isArray(mesh.material)).toBe(true)
    if (!Array.isArray(mesh.material)) throw new Error('expected a material array')
    expect(mesh.material[0]).toBeInstanceOf(THREE.MeshToonMaterial)
    expect(mesh.material[1]).toBe(basic)
  })

  it('leaves non-body materials untouched', () => {
    const basic = new THREE.MeshBasicMaterial()
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(), basic)

    stylise(mesh)

    expect(meshMaterial(mesh)).toBe(basic)
  })

  it('is idempotent once a material is toon', () => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial())
    stylise(mesh)
    const first = meshMaterial(mesh)

    stylise(mesh)

    expect(meshMaterial(mesh)).toBe(first)
  })

  it('shares its ramp and shader hooks across separately stylised meshes', () => {
    const first = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial())
    const second = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial())
    stylise(first)
    stylise(second)
    const firstMaterial = meshMaterial(first)
    const secondMaterial = meshMaterial(second)
    if (!isBodyMaterial(firstMaterial) || !isBodyMaterial(secondMaterial)) {
      throw new Error('expected toon materials')
    }

    expect(firstMaterial.gradientMap).toBe(secondMaterial.gradientMap)
    expect(firstMaterial.onBeforeCompile).toBe(secondMaterial.onBeforeCompile)
    expect(firstMaterial.customProgramCacheKey()).toBe(secondMaterial.customProgramCacheKey())
    expect(firstMaterial.customProgramCacheKey()).toContain(String(LOOK.saturation))
  })

  it('disposes the material it replaces', () => {
    const source = new THREE.MeshStandardMaterial()
    const dispose = vi.spyOn(source, 'dispose')

    stylise(new THREE.Mesh(new THREE.BoxGeometry(), source))

    expect(dispose).toHaveBeenCalledOnce()
  })
})

function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, (match) => match.replace(/[^\n]/g, ' '))
    .replace(/\/\/.*$/gm, '')
}

function typeScriptFiles(dir: string, recursive: boolean): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) return recursive ? typeScriptFiles(full, true) : []
    return full.endsWith('.ts') ? [full] : []
  })
}

describe('body material architecture', () => {
  it('types loaded bodies, gear and props as toon materials', () => {
    const root = join(import.meta.dirname, '..')
    const render = join(root, 'src', 'render')
    const files = [
      ...typeScriptFiles(render, true),
      ...typeScriptFiles(join(root, 'spike', 'motion'), false),
    ].filter((file) => file !== join(render, 'look.ts'))
    const offenders = files.flatMap((file) => {
      const code = stripComments(readFileSync(file, 'utf8'))
      return /as THREE\.MeshStandardMaterial|MeshStandardMaterial\[\]/.test(code)
        ? [file.slice(root.length + 1)]
        : []
    })

    expect(
      offenders,
      'bodies, gear and props are toon: type them BodyMaterial from src/render/look.ts and load them through stylise()',
    ).toEqual([])
  })
})
