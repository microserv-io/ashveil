import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js'
import { HEIGHT_PER_RADIUS, type ActorView } from '../../src/render/actorview'
import { meshesOf } from '../../src/render/models'
import { ProceduralDriver } from '../../src/render/proceduraldriver'
import { MASCULINE_PROFILE } from '../../src/render/profiles/masculine'
import type { SkeletonProfile } from '../../src/render/profiles/profile'
import { createRigInputOwner } from '../../src/render/riginput'
import type { Actor } from '../../src/sim/types'

export interface ReviewBodyDefinition {
  readonly id: string
  readonly path: string
  readonly profile: SkeletonProfile
}

/** The stylised mannequin from the concept sheet: one `npm run art:fit` from Tripo's GLB. */
export const MASCULINE_V3_BODY: ReviewBodyDefinition = {
  id: 'masculine-v3',
  path: '/bodies/masculine-v3/masculine-v3.glb',
  profile: MASCULINE_PROFILE,
}

export const REVIEW_BODIES: readonly ReviewBodyDefinition[] = [MASCULINE_V3_BODY]

export function reviewBodyScale(radius: number): number {
  return radius * HEIGHT_PER_RADIUS
}

export async function loadReviewBody(body: ReviewBodyDefinition): Promise<THREE.Object3D> {
  return (await new GLTFLoader().loadAsync(body.path)).scene
}

export async function loadReviewBodies(
  bodies: readonly ReviewBodyDefinition[] = REVIEW_BODIES,
): Promise<Map<string, THREE.Object3D>> {
  const loaded = await Promise.all(bodies.map(async (body) => [body.id, await loadReviewBody(body)] as const))
  return new Map(loaded)
}

export function createReviewBodyView(
  actor: Actor,
  source: THREE.Object3D,
  body: ReviewBodyDefinition,
): ActorView {
  const group = new THREE.Group()
  const model = cloneSkinned(source)
  model.scale.setScalar(reviewBodyScale(actor.radius))
  model.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return
    child.castShadow = true
    child.receiveShadow = true
    child.material = (child.material as THREE.Material).clone()
  })
  group.add(model)

  const materials = meshesOf(model).map((mesh) => mesh.material as THREE.MeshStandardMaterial)
  const driver = new ProceduralDriver()
  driver.bind(model, body.profile)
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
