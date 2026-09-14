import { createHash } from 'node:crypto'
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

interface PainterlyManifest {
  readonly version: number
  readonly id: string
  readonly status: string
  readonly textures: readonly {
    readonly surface: string
    readonly file: string
    readonly dimensions: readonly [number, number]
    readonly sha256: string
    readonly promptFile: string
    readonly provenance: string
  }[]
  readonly ashTreatment: string
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

  it('records the approved painterly terrain assets, prompts, and provenance', () => {
    const manifestPath = join(TEXTURE_ROOT, 'painterly-v1.json')
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as PainterlyManifest
    expect(manifest).toEqual(expect.objectContaining({
      version: 1,
      id: 'first-zone-painterly-v1',
      status: 'approved',
    }))
    expect(manifest.textures.map((texture) => texture.surface)).toEqual([
      'living-grass', 'worn-earth', 'ivory-limestone',
    ])
    for (const texture of manifest.textures) {
      const image = readFileSync(join(TEXTURE_ROOT, texture.file))
      expect(pngDimensions(image)).toEqual({ width: 1254, height: 1254 })
      expect(createHash('sha256').update(image).digest('hex')).toBe(texture.sha256)
      expect(readFileSync(join(TEXTURE_ROOT, texture.promptFile), 'utf8')).not.toHaveLength(0)
      expect(texture.provenance).toContain('Built-in ImageGen')
      expect(texture.provenance).toContain('without pixel edits')
    }
    expect(manifest.ashTreatment).toContain('no separate painterly ash albedo')
    expect(existsSync(join(TEXTURE_ROOT, 'ash-ground-painterly-v1.png'))).toBe(false)
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
