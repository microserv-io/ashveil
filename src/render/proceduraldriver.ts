import type * as THREE from 'three'
import type { MotionDriver } from './motion'
import { createPoseGenerator, type PoseGenerator } from './procedural/generator'
import { createPose } from './procedural/pose'
import type { SkeletonProfile } from './profiles/profile'
import type { RigInput } from './riginput'
import { bindSkeleton, type SemanticSkeleton } from './semanticskeleton'

/**
 * Motion with no clips: the generator solves a pose from what the sim says the
 * body is doing, and the binding writes it onto the bones.
 *
 * The render delta is deliberately unused. The generator integrates its gait
 * against `RigInput.time`, which is sim time, so two clients fed the same inputs
 * walk the same stride whatever their frame rates are.
 */
export class ProceduralDriver implements MotionDriver<SkeletonProfile> {
  private skeleton: SemanticSkeleton | null = null
  private generator: PoseGenerator | null = null
  private readonly pose = createPose()

  bind(body: THREE.Object3D, profile: SkeletonProfile): void {
    this.skeleton = bindSkeleton(body, profile)
    this.generator = createPoseGenerator(this.skeleton.geometry)
  }

  /** A pooled body keeps its bones: the bind pose has to be put back by hand. */
  reset(): void {
    this.skeleton?.restore()
    this.generator?.reset()
  }

  update(input: RigInput, _delta: number): void {
    const skeleton = this.skeleton
    const generator = this.generator
    if (!skeleton || !generator) throw new Error('ProceduralDriver.update called before bind')
    generator.generate(input, this.pose)
    skeleton.apply(this.pose)
  }

  dispose(): void {
    this.skeleton = null
    this.generator = null
  }
}
