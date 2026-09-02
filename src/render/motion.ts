import type * as THREE from 'three'
import type { RigInput } from './riginput'

export interface MotionDriver<Profile = unknown> {
  bind(body: THREE.Object3D, profile: Profile): void
  reset(): void
  update(input: RigInput, delta: number): void
  dispose(): void
}

/**
 * A driver after it has been bound, which is all a body ever holds.
 */
export type BoundMotionDriver = Omit<MotionDriver, 'bind'>
