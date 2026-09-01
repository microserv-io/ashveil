import { existsSync } from 'node:fs'
import { join } from 'node:path'
import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { KAYKIT_KNIGHT_GEOMETRY, restDirection } from '../src/render/procedural/geometry'
import { Joint } from '../src/render/procedural/joints'
import { createPose, setJointAxisAngle } from '../src/render/procedural/pose'
import { KAYKIT_PROFILE } from '../src/render/profiles/kaykit'
import { bindSkeleton } from '../src/render/semanticskeleton'
import { loadGlbSkeleton } from './fixtures/glbskeleton'

const PLAYER = join(import.meta.dirname, '..', 'public', 'models', 'player.glb')
/** `PLAYER_RADIUS * HEIGHT_PER_RADIUS`: the scale `actorview.ts` gives the knight. */
const GAMEPLAY_SCALE = 0.44 * 1.93

const DRIVEN = Object.values(KAYKIT_PROFILE.bones)

function knight(scale: number): THREE.Object3D {
  const body = loadGlbSkeleton(PLAYER)
  body.scale.setScalar(scale)
  body.updateMatrixWorld(true)
  return body
}

function boneOf(body: THREE.Object3D, name: string): THREE.Bone {
  const found = body.getObjectByName(name)
  if (!found) throw new Error(`no bone named ${name}`)
  return found as THREE.Bone
}

function worldOf(body: THREE.Object3D, name: string): THREE.Vector3 {
  body.updateMatrixWorld(true)
  return boneOf(body, name).getWorldPosition(new THREE.Vector3())
}

describe.skipIf(!existsSync(PLAYER))('semantic skeleton binding', () => {
  it('leaves the model in its bind pose under an identity pose', () => {
    const body = knight(GAMEPLAY_SCALE)
    const before = DRIVEN.map((name) => boneOf(body, name).quaternion.clone())
    const rootBefore = boneOf(body, 'root').position.clone()

    bindSkeleton(body, KAYKIT_PROFILE).apply(createPose())

    DRIVEN.forEach((name, at) => {
      expect(boneOf(body, name).quaternion.angleTo(before[at]!), `${name} left its bind pose`).toBeLessThan(1e-6)
    })
    expect(boneOf(body, 'root').position.distanceTo(rootBefore)).toBeLessThan(1e-9)
  })

  /**
   * The generator solves in sim metres, so a scale error here shows up as feet
   * sliding by exactly that ratio rather than as anything that looks like a bug.
   */
  it('builds its geometry in sim metres, and agrees with the committed fixture', () => {
    const unscaled = bindSkeleton(knight(1), KAYKIT_PROFILE).geometry
    for (let axis = 0; axis < Joint.Count * 3; axis++) {
      expect(unscaled.rest[axis]!).toBeCloseTo(KAYKIT_KNIGHT_GEOMETRY.rest[axis]!, 4)
    }

    const scaled = bindSkeleton(knight(GAMEPLAY_SCALE), KAYKIT_PROFILE).geometry
    expect(scaled.legLength).toBeCloseTo(unscaled.legLength * GAMEPLAY_SCALE, 6)
    expect(scaled.hipHeight).toBeCloseTo(unscaled.hipHeight * GAMEPLAY_SCALE, 6)
    // A knight who reads as roughly human: about 1.8 metres of sim world.
    expect(scaled.height).toBeGreaterThan(0.9)
    expect(scaled.height).toBeLessThan(1.3)
  })

  /**
   * The one that catches an axis correction applied on the wrong side or about the
   * wrong axis: both leave every quaternion finite and normalised, and both render
   * as a twisted limb. So the assertion is where the ankle ended up in the world.
   */
  it('puts the ankle where a 90 degree knee bend puts it', () => {
    const body = knight(GAMEPLAY_SCALE)
    const skeleton = bindSkeleton(body, KAYKIT_PROFILE)
    const pose = createPose()

    skeleton.apply(pose)
    const kneeRest = worldOf(body, 'lowerleg.l')
    const ankleRest = worldOf(body, 'foot.l')
    expect(ankleRest.y, 'the ankle should start below the knee').toBeLessThan(kneeRest.y - 0.1)

    // Positive about +X is the way a knee actually folds: the shin swings backward.
    setJointAxisAngle(pose, Joint.KneeL, 1, 0, 0, Math.PI / 2)
    skeleton.apply(pose)
    const knee = worldOf(body, 'lowerleg.l')
    const ankle = worldOf(body, 'foot.l')

    expect(knee.distanceTo(kneeRest), 'nothing above the bent joint may move').toBeLessThan(1e-6)

    const shin = skeleton.geometry.shin
    const direction = new Float32Array(3)
    restDirection(skeleton.geometry, Joint.KneeL, direction)
    const expected = knee
      .clone()
      .add(
        new THREE.Vector3(direction[0]!, direction[1]!, direction[2]!)
          .applyAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI / 2)
          .multiplyScalar(shin),
      )

    expect(ankle.x).toBeCloseTo(expected.x, 4)
    expect(ankle.y).toBeCloseTo(expected.y, 4)
    expect(ankle.z).toBeCloseTo(expected.z, 4)

    // Read without the maths: the shin is now level, pointing behind the knee. The
    // rest shin is raked a few degrees off vertical, so "level" has a little slack.
    expect(Math.abs(ankle.y - knee.y)).toBeLessThan(0.05)
    expect(knee.z - ankle.z).toBeCloseTo(shin, 2)
    expect(ankle.distanceTo(knee), 'the shin may not stretch').toBeCloseTo(shin, 5)
  })

  /**
   * The knee and its correction both turn about X, and rotations about one axis
   * commute — so the knee alone cannot tell `q * correction` from `correction * q`.
   * The elbow can: KayKit rakes the arm bones a quarter turn off the body frame.
   */
  it('puts the hand where a 90 degree elbow bend puts it', () => {
    const body = knight(GAMEPLAY_SCALE)
    const skeleton = bindSkeleton(body, KAYKIT_PROFILE)
    const pose = createPose()

    skeleton.apply(pose)
    const elbowRest = worldOf(body, 'lowerarm.l')
    const handRest = worldOf(body, 'hand.l')
    expect(handRest.x, 'the arm is authored out along +X').toBeGreaterThan(elbowRest.x + 0.05)

    setJointAxisAngle(pose, Joint.ElbowL, 0, 1, 0, Math.PI / 2)
    skeleton.apply(pose)
    const elbow = worldOf(body, 'lowerarm.l')
    const hand = worldOf(body, 'hand.l')

    expect(elbow.distanceTo(elbowRest)).toBeLessThan(1e-6)

    const forearm = skeleton.geometry.foreArm
    const direction = new Float32Array(3)
    restDirection(skeleton.geometry, Joint.ElbowL, direction)
    const expected = elbow
      .clone()
      .add(
        new THREE.Vector3(direction[0]!, direction[1]!, direction[2]!)
          .applyAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 2)
          .multiplyScalar(forearm),
      )

    expect(hand.x).toBeCloseTo(expected.x, 4)
    expect(hand.y).toBeCloseTo(expected.y, 4)
    expect(hand.z).toBeCloseTo(expected.z, 4)
    expect(hand.distanceTo(elbow), 'the forearm may not stretch').toBeCloseTo(forearm, 5)
  })

  it('moves the root by the pose offset, in sim metres', () => {
    const body = knight(GAMEPLAY_SCALE)
    const skeleton = bindSkeleton(body, KAYKIT_PROFILE)
    const pose = createPose()
    const restPelvis = worldOf(body, 'hips')

    pose.offset[1] = -0.2
    skeleton.apply(pose)
    expect(worldOf(body, 'hips').y).toBeCloseTo(restPelvis.y - 0.2, 5)

    skeleton.restore()
    expect(worldOf(body, 'hips').distanceTo(restPelvis)).toBeLessThan(1e-9)
  })

  /**
   * `GLTFLoader` strips the characters `PropertyBinding` reserves, so the rig the
   * browser hands us calls the left shoulder `upperarml`, not `upperarm.l`. Binding
   * against the raw glTF names works in Node and fails on the page, which is
   * exactly what happened the first time this ran in a browser.
   */
  it('binds the bone names three actually produces', () => {
    const body = knight(GAMEPLAY_SCALE)
    const raw = bindSkeleton(body, KAYKIT_PROFILE).geometry

    const sanitised = knight(GAMEPLAY_SCALE)
    sanitised.traverse((child) => {
      child.name = THREE.PropertyBinding.sanitizeNodeName(child.name)
    })
    const loaded = bindSkeleton(sanitised, KAYKIT_PROFILE).geometry

    expect(THREE.PropertyBinding.sanitizeNodeName('upperarm.l')).not.toBe('upperarm.l')
    expect([...loaded.rest]).toEqual([...raw.rest])
  })

  it('names the profile and the joint when a required bone is missing', () => {
    const body = knight(1)
    const broken = { ...KAYKIT_PROFILE, bones: { ...KAYKIT_PROFILE.bones, 'knee.l': 'shin.l' } }
    expect(() => bindSkeleton(body, broken)).toThrow(/kaykit[\s\S]*knee\.l/)
  })
})
