import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js'
import { HEIGHT_PER_RADIUS, type ActorView } from '../../src/render/actorview'
import { meshesOf } from '../../src/render/models'
import type { MotionMode } from '../../src/render/motionmode'
import { ProceduralDriver } from '../../src/render/proceduraldriver'
import { HUMANOID_V1_PROFILE } from '../../src/render/profiles/humanoid_v1'
import { createRigInputOwner } from '../../src/render/riginput'
import type { Actor } from '../../src/sim/types'

export interface ReviewBodyDefinition {
  readonly id: string
  readonly path: string
  readonly standingHeight: number
  readonly clipDriver: boolean
}

export const MASCULINE_V1_BODY: ReviewBodyDefinition = {
  id: 'masculine-v1',
  path: '/bodies/masculine-v1.glb',
  standingHeight: HUMANOID_V1_PROFILE.standingHeight,
  clipDriver: false,
}

export function reviewBodyScale(radius: number, body: ReviewBodyDefinition): number {
  return radius * HEIGHT_PER_RADIUS / body.standingHeight
}

export function supportsMotionMode(body: ReviewBodyDefinition, mode: MotionMode): boolean {
  return mode === 'procedural' || body.clipDriver
}

export function motionModeForBody(body: ReviewBodyDefinition, requested: MotionMode): MotionMode {
  return supportsMotionMode(body, requested) ? requested : 'procedural'
}

export async function loadReviewBody(body: ReviewBodyDefinition): Promise<THREE.Object3D> {
  return (await new GLTFLoader().loadAsync(body.path)).scene
}

export function createReviewBodyView(
  actor: Actor,
  source: THREE.Object3D,
  body: ReviewBodyDefinition,
): ActorView {
  const group = new THREE.Group()
  const model = cloneSkinned(source)
  model.scale.setScalar(reviewBodyScale(actor.radius, body))
  model.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return
    child.castShadow = true
    child.receiveShadow = true
    child.material = (child.material as THREE.Material).clone()
  })
  group.add(model)

  const materials = meshesOf(model).map((mesh) => mesh.material as THREE.MeshStandardMaterial)
  const driver = new ProceduralDriver()
  driver.bind(model, HUMANOID_V1_PROFILE)
  return {
    group,
    materials,
    baseColours: materials.map((material) => material.color.clone()),
    baseTransparent: materials.map((material) => material.transparent),
    driver,
    fadeLeft: 0,
    key: `${body.id}|${actor.radius.toFixed(2)}`,
    ...createRigInputOwner(),
  }
}
