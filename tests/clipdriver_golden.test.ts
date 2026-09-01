import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { ClipDriver } from '../src/render/clipdriver'
import { RIG_CLIPS, type RigState } from '../src/render/rig'
import { createRigInputOwner } from '../src/render/riginput'
import type { ActorState } from '../src/sim/types'

interface PoseStep {
  state: RigState
  recovery: number
  windup: number
  actorState: ActorState
  delta: number
  reset?: boolean
}

const SCRIPT: readonly PoseStep[] = [
  { state: 'idle', recovery: 0, windup: 0, actorState: 'idle', delta: 0.11 },
  { state: 'moving', recovery: 0, windup: 0, actorState: 'moving', delta: 0.17 },
  { state: 'moving', recovery: 0, windup: 0, actorState: 'moving', delta: 0.09 },
  { state: 'cleave', recovery: 0.42, windup: 0.08, actorState: 'acting', delta: 0.07 },
  { state: 'firebolt', recovery: 0.36, windup: 0.05, actorState: 'acting', delta: 0.06 },
  { state: 'frost_nova', recovery: 0.48, windup: 0.04, actorState: 'acting', delta: 0.08 },
  { state: 'dash', recovery: 0.25, windup: 0, actorState: 'acting', delta: 0.05 },
  { state: 'monster_bite', recovery: 0.4, windup: 0.06, actorState: 'acting', delta: 0.07 },
  { state: 'monster_bolt', recovery: 0.44, windup: 0.03, actorState: 'acting', delta: 0.06 },
  { state: 'monster_slam', recovery: 0.52, windup: 0.1, actorState: 'acting', delta: 0.09 },
  { state: 'dead', recovery: 0, windup: 0, actorState: 'dead', delta: 0.6 },
  { state: 'idle', recovery: 0, windup: 0, actorState: 'idle', delta: 1 / 60, reset: true },
  { state: 'idle', recovery: 0, windup: 0, actorState: 'idle', delta: 0.04 },
]

interface TestRig {
  body: THREE.SkinnedMesh
  root: THREE.Bone
  child: THREE.Bone
  clips: THREE.AnimationClip[]
}

function makeTestRig(): TestRig {
  const root = new THREE.Bone()
  root.name = 'root'
  const child = new THREE.Bone()
  child.name = 'child'
  child.position.y = 1
  root.add(child)
  root.updateMatrixWorld(true)
  const skeleton = new THREE.Skeleton([root, child])
  skeleton.calculateInverses()
  const body = new THREE.SkinnedMesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial())
  body.add(root)
  body.bind(skeleton)

  const clips = Object.keys(RIG_CLIPS).map((state, index) => {
    const name = RIG_CLIPS[state as RigState][0]!
    const duration = 0.7 + index * 0.09
    const angle = 0.18 + index * 0.07
    return new THREE.AnimationClip(name, duration, [
      new THREE.VectorKeyframeTrack('root.position', [0, duration], [0, 0, 0, index + 1, 0, 0]),
      new THREE.QuaternionKeyframeTrack(
        'child.quaternion',
        [0, duration],
        [0, 0, 0, 1, 0, Math.sin(angle / 2), 0, Math.cos(angle / 2)],
      ),
    ])
  })

  return { body, root, child, clips }
}

function numbersOf(root: THREE.Bone, child: THREE.Bone): number[] {
  return [...root.position.toArray(), ...root.quaternion.toArray(), ...child.position.toArray(), ...child.quaternion.toArray()]
}

function driveClipDriver(): number[][] {
  const { body, root, child, clips } = makeTestRig()
  const driver = new ClipDriver()
  const input = createRigInputOwner().rigInput
  driver.bind(body, { clips })
  const poses: number[][] = []

  for (const step of SCRIPT) {
    if (step.reset) driver.reset()
    input.state = step.state
    input.castLeft = step.recovery + step.windup
    input.recovering = step.actorState === 'acting' && step.recovery > 0
    driver.update(input, step.delta)
    poses.push(numbersOf(root, child))
  }

  driver.dispose()
  return poses
}

const FIXTURE = JSON.parse(
  readFileSync(join(import.meta.dirname, 'fixtures', 'clipdriver_golden.json'), 'utf8'),
) as number[][]

describe('clip driver golden poses', () => {
  it('pins the current rig across every state, same-state updates, and pool reset', () => {
    expect(driveClipDriver()).toEqual(FIXTURE)
    expect(FIXTURE[11]?.[0]).toBeCloseTo(1.854837, 6)
  })
})
