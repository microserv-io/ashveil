import type * as THREE from 'three'
import type { RigInput } from './riginput'

export interface MotionDriver<Profile = unknown> {
  bind(body: THREE.Object3D, profile: Profile): void
  /** Only procedural motion restores the bind pose because clip reuse preserves its crossfade. */
  reset(): void
  update(input: RigInput, delta: number): void
  dispose(): void
}

/**
 * A driver after it has been bound, which is all a body ever holds. Dropping `bind`
 * is what lets one body type hold either driver: the two are bound to different
 * profiles and only ever agree from here on.
 */
export type BoundMotionDriver = Omit<MotionDriver, 'bind'>
