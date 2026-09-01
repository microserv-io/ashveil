import type * as THREE from 'three'
import type { RigInput } from './riginput'

export interface MotionDriver<Profile = unknown> {
  bind(body: THREE.Object3D, profile: Profile): void
  /** Only procedural motion restores the bind pose because clip reuse preserves its crossfade. */
  reset(): void
  update(input: RigInput, delta: number): void
  dispose(): void
}
