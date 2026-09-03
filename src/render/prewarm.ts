import * as THREE from 'three'
import type { BodyMaterial } from './look'
import { meshesOf, spawnModel, type ModelName } from './models'
import type { SceneHost } from './scene'

/**
 * Compiles shaders while the loading screen is still up.
 *
 * Three.js compiles a program the first time it has to draw a material, inside the
 * frame that draws it. So the first skeleton to die stalls a frame by tens of
 * milliseconds — measured at 32ms for the death fade and 118ms for a variant that
 * first appeared minutes into a run. Nothing is wrong with those frames; the work
 * simply happens at the worst possible moment.
 *
 * Building one of everything up front, in both the states a body passes through,
 * moves that cost to load time where a player is already waiting.
 */

/** The bodies that come and go. Terrain compiles on its own when the area is built. */
const WARMED: readonly ModelName[] = [
  'player',
  'swarm',
  'ranged',
  'brute',
  'loot_normal',
  'loot_magic',
  'loot_rare',
  'orb',
]

export function prewarmShaders(host: SceneHost): void {
  const group = new THREE.Group()
  // Far below the map: it must be in the scene to be compiled, never in shot.
  group.position.set(0, -500, 0)

  for (const name of WARMED) {
    group.add(spawnModel(name))
    // Death fades a body out, and a transparent material is a different program.
    const fading = spawnModel(name)
    for (const mesh of meshesOf(fading)) {
      const material = mesh.material as BodyMaterial
      material.transparent = true
      material.opacity = 0.5
    }
    group.add(fading)
  }

  host.scene.add(group)
  host.renderer.compile(host.scene, host.camera)
  // Hidden, but never disposed: three.js frees a program when its last material
  // goes, and freeing one means compiling it again later.
  group.visible = false
}
