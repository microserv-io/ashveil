import * as THREE from 'three'

/**
 * A fixed set of point lights, reused every frame.
 *
 * Three.js bakes the number of lights into every shader program it compiles, so a
 * projectile that brings its own light recompiles every material in the scene the
 * first time that many lights are on screen at once. Measured at 85ms in a fight:
 * a visible hitch, and the single largest thing standing between this game and a
 * held 60fps.
 *
 * So the count never changes. Lights are claimed for a frame and the leftovers are
 * turned down to nothing, which costs a little fill rate and buys a stable frame.
 */

/** Enough for a volley and a couple of orbs. Beyond this the nearest ones win. */
const POOL_SIZE = 8

export class LightPool {
  private readonly lights: THREE.PointLight[] = []
  private claimed = 0

  constructor(scene: THREE.Scene) {
    for (let i = 0; i < POOL_SIZE; i++) {
      // Intensity zero rather than `visible = false`: an invisible light leaves the
      // scene's light count, which is the recompile this class exists to avoid.
      const light = new THREE.PointLight(0xffffff, 0, 1, 2)
      light.visible = true
      scene.add(light)
      this.lights.push(light)
    }
  }

  /** Call once per frame before placing any light. */
  begin(): void {
    this.claimed = 0
  }

  /** Lights the given world point, if the pool has one left this frame. */
  place(x: number, y: number, z: number, colour: number, intensity: number, distance: number): void {
    const light = this.lights[this.claimed]
    if (!light) return
    this.claimed++
    light.position.set(x, y, z)
    light.color.setHex(colour)
    light.intensity = intensity
    light.distance = distance
  }

  /** Call once per frame after the last `place`. */
  end(): void {
    for (let i = this.claimed; i < this.lights.length; i++) this.lights[i]!.intensity = 0
  }
}
