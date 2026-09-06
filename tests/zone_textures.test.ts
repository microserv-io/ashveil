import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOT = join(import.meta.dirname, '..')
const TEXTURE_ROOT = join(ROOT, 'public', 'textures', 'first-zone')
const MANIFEST_PATH = join(TEXTURE_ROOT, 'manifest.json')

interface TextureCandidate {
  readonly id: string
  readonly file: string
  readonly colorSpace: string
  readonly maps: readonly string[]
  readonly physicalRepeatMetres: number
  readonly dimensions: readonly [number, number]
  readonly status: string
}

interface TextureManifest {
  readonly version: number
  readonly tiling: {
    readonly status: string
    readonly reviewDefault: string
  }
  readonly candidates: readonly TextureCandidate[]
}

describe('first-zone texture candidates', () => {
  it('publishes the four bounded albedo candidates', () => {
    const manifest = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8')) as TextureManifest

    expect(manifest.version).toBe(1)
    expect(manifest.tiling).toEqual(expect.objectContaining({
      status: 'nonseamless',
      reviewDefault: 'mirrored-repeat',
    }))
    expect(manifest.candidates.map((candidate) => candidate.id)).toEqual([
      'meadow-grass',
      'worn-earth',
      'ivory-limestone',
      'ash-ground',
    ])

    for (const candidate of manifest.candidates) {
      expect(candidate.file).toBe(`${candidate.id}.png`)
      expect(candidate.colorSpace).toBe('srgb')
      expect(candidate.maps).toEqual(['albedo'])
      expect(candidate.physicalRepeatMetres).toBeGreaterThan(0)
      expect(candidate.dimensions).toEqual([1254, 1254])
      expect(candidate.status).toBe('candidate')
      expect(existsSync(join(TEXTURE_ROOT, candidate.file))).toBe(true)
    }
  })

  it('keeps every source texture square and consistently sized', async () => {
    const manifest = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8')) as TextureManifest
    const metadata = manifest.candidates.map((candidate) =>
      pngDimensions(readFileSync(join(TEXTURE_ROOT, candidate.file))),
    )

    for (const image of metadata) {
      expect(image.width).toBe(1254)
      expect(image.height).toBe(1254)
    }
  })

  it('has an isolated Vite entry and package scripts', () => {
    const packageJson = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as {
      scripts: Record<string, string>
    }
    const html = readFileSync(join(ROOT, 'spike', 'zone-textures', 'index.html'), 'utf8')
    const config = readFileSync(join(ROOT, 'spike', 'zone-textures', 'vite.config.ts'), 'utf8')

    expect(packageJson.scripts['texture:dev']).toContain('spike/zone-textures/vite.config.ts')
    expect(packageJson.scripts['texture:build']).toContain('spike/zone-textures/vite.config.ts')
    expect(html).toContain('src="./main.ts"')
    expect(config).toContain("port: 5297")
    expect(config).toContain("host: '0.0.0.0'")
  })

  it('publishes the two clearly labelled scene concepts', () => {
    const concepts = ['village-edge.png', 'ash-boundary.png']
    for (const concept of concepts) {
      expect(pngDimensions(readFileSync(join(TEXTURE_ROOT, 'concepts', concept)))).toEqual({
        width: 1672,
        height: 941,
      })
    }

    const html = readFileSync(join(ROOT, 'spike', 'zone-textures', 'index.html'), 'utf8')
    expect(html).toContain('Scene concepts · not engine')
  })
})

function pngDimensions(image: Buffer): { width: number; height: number } {
  expect(image.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  return { width: image.readUInt32BE(16), height: image.readUInt32BE(20) }
}
