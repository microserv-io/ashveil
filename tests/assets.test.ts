import { describe, expect, it } from 'vitest'
import {
  ASSETS,
  ASSET_SHA256,
  KAYKIT_REVISIONS,
  validateAssetMetadata,
  verifyAssetBody,
} from '../scripts/fetch-assets.mjs'
import { BODY_MODEL_NAMES, MODEL_NAMES } from '../src/render/models'

/**
 * The renderer awaits every model before the first frame, so a name it asks for
 * that the fetch script does not know about is not a missing mesh: it is a client
 * that never finishes loading.
 */
describe('every model the renderer needs is one the fetch script pulls', () => {
  it('has a fetch row per model name', () => {
    const fetched = Object.keys(ASSETS).map((file) => file.replace(/\.glb$/, ''))
    const fetchedOrCommitted = [...fetched, ...BODY_MODEL_NAMES]
    expect([...MODEL_NAMES].filter((name) => !fetchedOrCommitted.includes(name))).toEqual([])
  })

  it('fetches nothing the renderer never asks for', () => {
    const fetched = Object.keys(ASSETS).map((file) => file.replace(/\.glb$/, ''))
    expect(fetched.filter((name) => !MODEL_NAMES.includes(name as never))).toEqual([])
  })

  it('describes an immutable source and checksum for every asset', () => {
    const sources = Object.values(ASSETS)

    expect(sources.every((source) => !source.url.includes('/main/'))).toBe(true)
    expect(Object.values(KAYKIT_REVISIONS).every((revision) => /^[0-9a-f]{40}$/.test(revision))).toBe(true)
    expect(Object.values(ASSET_SHA256).every((sha256) => /^[0-9a-f]{64}$/.test(sha256))).toBe(true)
    expect(() => validateAssetMetadata('floor.glb', ASSETS['floor.glb']!)).not.toThrow()
  })

  it('rejects a GLB whose checksum does not match', () => {
    expect(() => verifyAssetBody('model.glb', Buffer.from('glTF payload'), '0'.repeat(64))).toThrow(
      /SHA-256 mismatch/,
    )
  })
})
