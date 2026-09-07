import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { buildScenery, disposeScenery } from '../src/world/scenery'
import { LANDMARKS, PATHS, SOLIDS } from '../src/world/world-data'
import { heightAt } from '../src/world/terrain'

describe('first-zone scenery', () => {
  it('builds one merged mesh per material and disposes cleanly', () => {
    const scene = new THREE.Scene()
    const scenery = buildScenery(scene, { heightAt, landmarks: LANDMARKS, paths: PATHS, solids: SOLIDS })

    const meshes: THREE.Mesh[] = []
    scenery.traverse((object) => {
      if (object instanceof THREE.Mesh) meshes.push(object)
    })
    expect(meshes.length).toBeGreaterThan(6)
    expect(meshes.length).toBeLessThanOrEqual(12)
    expect(scene.children).toContain(scenery)

    disposeScenery(scenery)
    expect(scene.children).not.toContain(scenery)
  })
})
