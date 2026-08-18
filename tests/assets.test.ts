import { describe, expect, it } from 'vitest'
import { ASSETS } from '../scripts/fetch-assets.mjs'
import { MODEL_NAMES } from '../src/render/models'

/**
 * The renderer awaits every model before the first frame, so a name it asks for
 * that the fetch script does not know about is not a missing mesh: it is a client
 * that never finishes loading.
 */
describe('every model the renderer needs is one the fetch script pulls', () => {
  it('has a fetch row per model name', () => {
    const fetched = Object.keys(ASSETS).map((file) => file.replace(/\.glb$/, ''))
    expect([...MODEL_NAMES].filter((name) => !fetched.includes(name))).toEqual([])
  })

  it('fetches nothing the renderer never asks for', () => {
    const fetched = Object.keys(ASSETS).map((file) => file.replace(/\.glb$/, ''))
    expect(fetched.filter((name) => !MODEL_NAMES.includes(name as never))).toEqual([])
  })
})
