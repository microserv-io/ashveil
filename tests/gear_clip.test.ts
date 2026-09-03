import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import {
  bodySurface,
  clipDrape,
  clipLimits,
  forEachClipPose,
  loadClipBody,
  loadClipPiece,
  matchJoints,
  measureClip,
  runSetAdvisory,
  type BodySurface,
  type ClipBody,
  type ClipMotion,
  type ClipPiece,
} from '../scripts/art/gear/clip'
import { loadGlbSkeleton, readGlb } from '../scripts/art/glb'
import type { DrapeDefinition } from '../src/render/drapebones'
import { measurePenetration, skinVertices } from '../scripts/art/gear/penetration'
import { createPose } from '../src/render/procedural/pose'
import type { GlbSkinnedMesh } from '../scripts/art/glb'

/**
 * The clipping gate, measured against the one shape whose answer is known in
 * advance: the body itself.
 *
 * A shell of the body pushed a centimetre out along its own normals must read as
 * outside it and the same shell pushed in must read a centimetre deep, or the gate
 * would pass a piece that saws through a shoulder and no fixture would catch it.
 *
 * "Outside" is not "zero", and that is the body rather than the measurement: an
 * armpit crease closes on itself in well under a centimetre, so a shell offset
 * across one lands in the opposing wall. Brute force agrees with the grid there.
 * What is asserted is the discrimination — a fraction of a percent outward against
 * four-fifths of the shell inward, at the offset that was applied.
 */

const BODY = 'masculine-v3'
const FIXTURES = join(import.meta.dirname, 'fixtures', 'gear')
const OFFSET = 0.01
const PHASES = 32
/** Two gaits and four clips. */
const MOTION_CYCLES = 6
/** Bind, one abduction, two arm flexions, two twists, a torso flex and a hip flex. */
const STRESS_POSES = 8
/** Abduction past 90: measured, reported, and gating nothing. */
const ADVISORY_POSES = 1
/** The body's own skin, the one closed mesh on it; the head is a shell with sockets. */
const SKIN = 'Body'

const body = loadClipBody(BODY)
const limits = clipLimits('chest')
const skin = body.meshes.find((mesh) => mesh.name === SKIN)!
/** A real mask to measure with: the chest region the body sidecar resolved. */
const CHEST: Record<string, number[]> = JSON.parse(
  readFileSync(join(import.meta.dirname, '..', 'public', 'bodies', BODY, `${BODY}.masks.json`), 'utf8'),
).slots.chest
/** The gate against one mesh of the body, so the reference is that mesh alone. */
const skinBody: ClipBody = { ...body, meshes: [skin] }

function shell(metres: number): GlbSkinnedMesh {
  const positions = new Float32Array(skin.positions.length)
  for (let at = 0; at < skin.positions.length; at++) positions[at] = skin.positions[at]! + skin.normals[at]! * metres
  return { ...skin, positions }
}

function shellPiece(metres: number, jointNames = body.jointNames): ClipPiece {
  return {
    name: `shell${metres}`,
    slot: 'chest',
    // The shell covers the whole mesh, so hiding any of it would hide the very
    // triangles the measurement needs.
    covers: [],
    hides: {},
    body: body.name,
    jointNames,
    meshes: [shell(metres)],
  }
}

function sampledShellPiece(metres: number, samples = 24): ClipPiece {
  const source = shell(metres)
  const positions = new Float32Array(samples * 3)
  const normals = new Float32Array(samples * 3)
  const joints = new Uint16Array(samples * 4)
  const weights = new Float32Array(samples * 4)
  const vertices = source.positions.length / 3
  for (let at = 0; at < samples; at++) {
    const vertex = Math.floor(((at + 0.5) * vertices) / samples)
    positions.set(source.positions.subarray(vertex * 3, vertex * 3 + 3), at * 3)
    normals.set(source.normals.subarray(vertex * 3, vertex * 3 + 3), at * 3)
    joints.set(source.joints.subarray(vertex * 4, vertex * 4 + 4), at * 4)
    weights.set(source.weights.subarray(vertex * 4, vertex * 4 + 4), at * 4)
  }
  return { ...shellPiece(metres), meshes: [{ ...source, positions, normals, joints, weights, indices: new Uint32Array() }] }
}

/** One pose, measured straight through the primitives the gate is built from. */
function atBind(
  piece: GlbSkinnedMesh,
  depth: number,
  slide = 0,
): { maxDepth: number; over: number; vertices: number } {
  const pose = createPose()
  body.apply(pose)
  const reference = new Float32Array(skin.positions.length)
  const worn = new Float32Array(piece.positions.length)
  skinVertices(skin, body.skinMatrices, reference)
  skinVertices(piece, body.skinMatrices, worn)
  for (let at = 0; at < worn.length; at += 3) worn[at] = worn[at]! + slide
  const triangles = new Uint32Array(skin.indices)
  const visible = new Uint8Array(triangles.length / 3).fill(1)
  const found = measurePenetration(reference, triangles, visible, worn, depth)
  return { ...found, vertices: piece.positions.length / 3 }
}

function hiddenTriangles(surface: BodySurface): number {
  return surface.visible.filter((flag) => flag === 0).length
}

function atBindAgainst(surface: BodySurface, piece: GlbSkinnedMesh, depth: number): ReturnType<typeof atBind> {
  const pose = createPose()
  body.apply(pose)
  const reference = new Float32Array(surface.positions.length)
  const worn = new Float32Array(piece.positions.length)
  skinVertices(surface, body.skinMatrices, reference)
  skinVertices(piece, body.skinMatrices, worn)
  const found = measurePenetration(reference, surface.indices, surface.visible, worn, depth)
  return { ...found, vertices: piece.positions.length / 3 }
}

const outward = measureClip(skinBody, shellPiece(OFFSET), limits)

/**
 * A cape the fitter could have hung off the chest: two bones behind the back, with
 * a scrap of cloth skinned only to them. Nothing draped exists yet, so this is the
 * one way to hold the gate to what it will have to do — walk the drape through the
 * cycles rather than leaving it frozen in its bind pose.
 */
const CAPE: DrapeDefinition = {
  name: 'cape',
  attachBone: 'chest',
  bones: ['drape_cape_1', 'drape_cape_2'],
  segmentLength: 0.2,
  toward: [0, 0, 1],
}
/** Far enough behind the back that the chain hangs clear of the torso capsule. */
const BEHIND = -0.3

function drapedPiece(drape: DrapeDefinition = CAPE): ClipPiece {
  const tree = loadGlbSkeleton(join(import.meta.dirname, '..', 'public', 'bodies', BODY, `${BODY}.glb`))
  let above = tree.getObjectByName(drape.attachBone)!
  const bones = drape.bones.map((name, at) => {
    const bone = new THREE.Bone()
    bone.name = name
    bone.position.set(0, at === 0 ? 0 : -drape.segmentLength, at === 0 ? BEHIND : 0)
    above.add(bone)
    above = bone
    return bone
  })
  tree.updateMatrixWorld(true)

  const positions: number[] = []
  const inverses = new Float32Array(body.inverseBinds.length + bones.length * 16)
  inverses.set(body.inverseBinds)
  bones.forEach((bone, at) => {
    new THREE.Matrix4().copy(bone.matrixWorld).invert().toArray(inverses, (body.jointNames.length + at) * 16)
    const origin = new THREE.Vector3().setFromMatrixPosition(bone.matrixWorld)
    for (const side of [-0.15, 0.15]) positions.push(origin.x + side, origin.y, origin.z)
  })
  const joints = new Uint16Array([...bones.flatMap((_, at) => {
    const index = body.jointNames.length + at
    return [index, 0, 0, 0, index, 0, 0, 0]
  })])
  const weights = new Float32Array(positions.length / 3 * 4)
  for (let vertex = 0; vertex < positions.length / 3; vertex++) weights[vertex * 4] = 1

  return {
    name: 'proxy-cape',
    slot: 'back',
    covers: [],
    hides: {},
    body: body.name,
    jointNames: [...body.jointNames, ...drape.bones],
    meshes: [{
      name: 'cape',
      positions: new Float32Array(positions),
      normals: new Float32Array(positions.length),
      indices: new Uint32Array([0, 1, 2, 2, 1, 3]),
      joints,
      weights,
    }],
    drapes: [drape],
    root: tree,
    inverseBinds: inverses,
  }
}

describe('the clipping gate against the body itself', () => {
  it('walks every motion cycle and every stress pose', () => {
    const seen: string[] = []
    forEachClipPose(body.geometry, createPose(), (group, name) => seen.push(`${group}/${name}`))
    expect(seen).toHaveLength(PHASES * MOTION_CYCLES + STRESS_POSES + ADVISORY_POSES)
    expect(new Set(seen)).toEqual(
      new Set([
        'motion/walk',
        'motion/run',
        'motion/cleave',
        'motion/firebolt',
        'motion/frost_nova',
        'motion/dead',
        'stress/bind',
        'stress/abduct90',
        'advisory/abduct150',
        'stress/armflex60',
        'stress/armflex90',
        'stress/twist45',
        'stress/twist-45',
        'stress/torsoflex45',
        'stress/hipflex90',
      ]),
    )
    expect(outward.poses).toBe(PHASES * MOTION_CYCLES + STRESS_POSES + ADVISORY_POSES)
  })

  it('leaves the arm overhead out: at 180 the body folds through its own shoulder', () => {
    const seen: string[] = []
    forEachClipPose(body.geometry, createPose(), (_group, name) => seen.push(name))
    expect(seen, 'linear skinning there measures the body, not the piece').not.toContain('abduct180')
  })

  /** No skill abducts an arm past 90, so 150 is reported and gates nothing. */
  it('measures abduction past 90 as advisory rather than gating on it', () => {
    const groups = new Map<string, string>()
    forEachClipPose(body.geometry, createPose(), (group, name) => groups.set(name, group))
    expect(groups.get('abduct90')).toBe('stress')
    expect(groups.get('abduct150')).toBe('advisory')
    expect(Object.keys(outward.cycles).sort()).toEqual(['advisory', 'motion', 'stress'])
    expect(Object.keys(outward.gates)).toEqual([
      'clears_the_body_through_motion_cycles', 'clears_the_body_through_stress_poses',
    ])
  })

  it('finds nothing at all when the shell is moved clear of the body', () => {
    const clear = atBind(shell(OFFSET), 0, 3)
    expect(clear.over).toBe(0)
    expect(clear.maxDepth).toBe(0)
  })

  it('reads a shell a centimetre off the skin as outside it', () => {
    const off = atBind(shell(OFFSET), limits.depth)
    expect(off.over / off.vertices, 'only the creases that close inside a centimetre').toBeLessThan(0.01)
    expect(outward.cycles.motion.fraction, `worst at ${outward.cycles.motion.pose}`).toBeLessThan(0.02)
    expect(outward.cycles.stress.fraction, `worst at ${outward.cycles.stress.pose}`).toBeLessThan(0.02)
  })

  it('reads a centimetre of penetration for a shell a centimetre inside it', () => {
    const inside = atBind(shell(-OFFSET), limits.depth)
    expect(inside.maxDepth).toBeGreaterThan(OFFSET * 0.95)
    expect(inside.maxDepth).toBeLessThan(OFFSET * 1.05)
    expect(inside.over / inside.vertices, 'nearly all of the shell is inside').toBeGreaterThan(0.8)
  })

  it('fails both gates for a sampled shell inside the body', () => {
    const inside = measureClip(skinBody, sampledShellPiece(-OFFSET), limits)
    expect(inside.cycles.motion.maxDepth).toBeGreaterThan(limits.depth)
    expect(inside.gates.clears_the_body_through_motion_cycles).toBe(false)
    expect(inside.gates.clears_the_body_through_stress_poses).toBe(false)
  })

  it('records the body and empty mask it measured with', () => {
    expect(outward.schema).toBe('ashveil.gear-clip.v1')
    expect(outward.body).toBe(BODY)
    expect(outward.hides, 'this shell hides nothing').toEqual({})
  })

  /**
   * The rim rule: the game drops a triangle only when all three of its vertices are
   * hidden, but one hidden corner is enough to stop the gate counting it. Skin the
   * garment already ate is skin nothing can be seen clipping through.
   */
  it('stops counting a triangle at its first hidden vertex', () => {
    const whole = bodySurface(skinBody, {})
    const covered = bodySurface(skinBody, CHEST)
    expect(covered.indices).toHaveLength(whole.indices.length)
    expect(hiddenTriangles(whole)).toBe(0)
    expect(hiddenTriangles(covered), 'the chest mask covers whole triangles').toBeGreaterThan(0)

    const hidden = new Set(CHEST[SKIN] ?? [])
    let all = 0
    for (let at = 0; at < skin.indices.length; at += 3) {
      if (hidden.has(skin.indices[at]!) && hidden.has(skin.indices[at + 1]!) && hidden.has(skin.indices[at + 2]!)) all++
    }
    expect(hiddenTriangles(covered), 'the rim is uncounted too').toBeGreaterThan(all)
  })

  /**
   * The hole a worn slot leaves is not a wall. Signing a vertex by the visible
   * surface alone put the nearest triangle at the rim of the mask, centimetres away
   * and facing anywhere, which read a piece resting on the chest as buried in it.
   */
  it('never reads deeper for hiding the body under the piece', () => {
    const whole = atBindAgainst(bodySurface(skinBody, {}), shell(OFFSET), limits.depth)
    const covered = atBindAgainst(bodySurface(skinBody, CHEST), shell(OFFSET), limits.depth)
    expect(covered.over).toBeLessThanOrEqual(whole.over)
    expect(covered.maxDepth).toBeLessThanOrEqual(whole.maxDepth)
  })

  it('names the joint when the piece was exported against a different bone order', () => {
    const reordered = [...body.jointNames]
    ;[reordered[1], reordered[2]] = [reordered[2]!, reordered[1]!]
    expect(() => measureClip(skinBody, shellPiece(OFFSET, reordered), limits))
      .toThrow(/joint 1 is "spine", masculine-v3 has "pelvis"/)
  })

  it('reads every slot’s clip rule off the family contract', () => {
    for (const slot of ['feet', 'legs', 'waist', 'chest', 'back', 'hands', 'shoulders', 'head'] as const) {
      const rule = clipLimits(slot)
      expect(rule.depth, slot).toBeGreaterThan(0)
      expect(rule.fraction, slot).toBeGreaterThan(0)
    }
  })
})

/**
 * The proxy pieces the Blender fitter produces. They are the only end-to-end
 * evidence that a real fitted piece clears the body, and they arrive with the
 * Python half of the slice.
 */
describe.each(['proxy-feet', 'proxy-head'])(
  '%s', (fixture) => {
  const dir = join(FIXTURES, fixture)
  const missing = !existsSync(dir)
  const piece = missing ? null : loadClipPiece(dir)
  const result = missing ? null : JSON.parse(readFileSync(join(dir, `${fixture}.clip.json`), 'utf8'))

  it.skipIf(missing)('ships a reproduced clip report that clears every pose', () => {
    matchJoints(piece!, body)
    expect(result!.gates.clears_the_body_through_motion_cycles, `worst ${result!.cycles.motion.pose}`).toBe(true)
    expect(result!.gates.clears_the_body_through_stress_poses, `worst ${result!.cycles.stress.pose}`).toBe(true)
  })
})


/**
 * A draped piece carries joints the body has not, and the cloth on them only reads
 * right if the gate swings it: a chain frozen at bind measures a pose nothing plays.
 */
describe('the clipping gate on a piece with a drape', () => {
  const caped = drapedPiece()
  const result = JSON.parse(readFileSync(join(FIXTURES, 'proxy-cape', 'proxy-cape.clip.json'), 'utf8'))

  it('accepts the joints a drape declares and refuses any other extra', () => {
    expect(() => matchJoints(caped, body)).not.toThrow()
    expect(() => matchJoints({ ...caped, drapes: [] }, body))
      .toThrow(/carries 26 joints, masculine-v3 has 24 and the manifest declares 0/)
    expect(() => matchJoints({ ...caped, jointNames: [...body.jointNames, 'drape_cape_1', 'spare'] }, body))
      .toThrow(/extra joint "spare" no drape declares/)
  })

  it('ships a reproduced report for every pose, settling on top of them', () => {
    expect(result.poses).toBe(outward.poses)
    expect(result.gates.clears_the_body_through_motion_cycles, `worst ${result.cycles.motion.pose}`).toBe(true)
    expect(result.gates.clears_the_body_through_stress_poses, `worst ${result.cycles.stress.pose}`).toBe(true)
  })

  it('walks every cycle twice when something has to settle through it', () => {
    const passes: string[] = []
    forEachClipPose(body.geometry, createPose(), (group, name, _phase, motion) => {
      passes.push(`${group}/${name}/${motion.settling}`)
    }, 2)
    const settling = passes.filter((entry) => entry.endsWith('true'))
    expect(settling).toHaveLength(PHASES * MOTION_CYCLES)
    expect(passes).toHaveLength(PHASES * MOTION_CYCLES * 2 + STRESS_POSES + ADVISORY_POSES)
    expect(new Set(settling.map((entry) => entry.split('/')[1]))).toEqual(
      new Set(['walk', 'run', 'cleave', 'firebolt', 'frost_nova', 'dead']),
    )
  })

  /**
   * A corpse lands on its back on its own cloak. No pendulum models cloth crushed
   * under a body, and the death fade has hidden both inside 1.6 s, so the cloth's
   * own vertices are the one thing `dead` does not count. Everything else still does.
   */
  it('counts the cloth everywhere but under a body that fell on it', () => {
    const drape = clipDrape(body, caped)!
    expect([...drape.owned].filter((flag) => flag === 1)).toHaveLength(caped.meshes[0]!.positions.length / 3)
    expect(result.exempt).toBeGreaterThan(0)

    // A cape scrap weighted to the body rather than the chain is nobody's exemption.
    const plain = { ...caped, drapes: caped.drapes, meshes: caped.meshes.map((mesh) => ({
      ...mesh, joints: new Uint16Array(mesh.joints.length),
    })) }
    expect([...clipDrape(body, plain)!.owned].filter((flag) => flag === 1)).toHaveLength(0)
  })

  /** A held pose is cloth that has hung there, not cloth caught mid-drop. */
  it('lets the chain fall into a held pose before reading it', () => {
    const drape = clipDrape(body, caped)!
    const pose = createPose()
    const held: ClipMotion = { step: 0, speed: 0, settling: false }
    const at = (body.jointNames.length + 1) * 16

    forEachClipPose(body.geometry, pose, (_group, name) => {
      if (name !== 'torsoflex45') return
      body.apply(pose)
      drape.step(name, held)
    })
    const settled = drape.matrices.slice(at, at + 16)

    // The same pose reached without the settle: the chain is still on its rest line.
    forEachClipPose(body.geometry, pose, (_group, name) => {
      if (name !== 'armflex60') return
      body.apply(pose)
      drape.step(name, held)
    })
    expect(settled, 'a settled chain is not the chain at bind').not.toEqual(drape.matrices.slice(at, at + 16))
  })

  it('swings the chain through a cycle and hangs it still on a held pose', () => {
    const drape = clipDrape(body, caped)!
    const pose = createPose()
    const walking: ClipMotion = { step: 1 / 1.6 / PHASES, speed: 1.6, settling: false }
    const held: ClipMotion = { step: 0, speed: 0, settling: false }
    const at = (body.jointNames.length + 1) * 16

    body.apply(pose)
    drape.step('bind', held)
    const rest = drape.matrices.slice(at, at + 16)

    for (let sample = 0; sample < PHASES * 2; sample++) {
      body.apply(pose)
      drape.step('walk', walking)
    }
    const moved = drape.matrices.slice(at, at + 16)
    expect(moved, 'a walking body has to move the cloth on its back').not.toEqual(rest)

    body.apply(pose)
    drape.step('bind', held)
    expect([...drape.matrices.slice(at, at + 16)]).toEqual([...rest])
  })
})

describe('the fitted Warden pauldrons', () => {
  const directory = join(import.meta.dirname, '..', 'public', 'gear', 'warden-pauldrons')
  const clip = JSON.parse(readFileSync(join(directory, 'warden-pauldrons.clip.json'), 'utf8'))
  const manifest = JSON.parse(readFileSync(join(directory, 'warden-pauldrons.manifest.json'), 'utf8'))
  const fitted = readGlb(join(directory, 'warden-pauldrons.glb'))

  it('keeps the exact frost-nova and shoulder-helper regressions observable and clear', () => {
    expect(clip.samples['frost_nova@0.375'].fraction).toBeLessThanOrEqual(clip.clip.fraction)
    expect(clip.samples['abduct90@0'].fraction).toBeLessThanOrEqual(clip.clip.fraction)
    expect(clip.gates.clears_the_body_through_motion_cycles).toBe(true)
    expect(clip.gates.clears_the_body_through_stress_poses).toBe(true)
  })

  it('ships fitted torso and shoulder-girdle collider coverage', () => {
    for (const drape of manifest.drapes) {
      expect(drape.colliders).toEqual(expect.arrayContaining([
        expect.objectContaining({ from: 'chest', to: 'neck' }),
        expect.objectContaining({ from: 'clavicle_L', to: 'upper_arm_L' }),
        expect.objectContaining({ from: 'clavicle_R', to: 'upper_arm_R' }),
      ]))
    }
  })

  it('records the lower chest layer and the measured cap seating', () => {
    expect(manifest.under).toEqual(['warden-tunic'])
    for (const side of ['L', 'R']) {
      const seat = manifest.alignment[side].layerSeat
      const direction = side === 'L' ? 1 : -1
      expect(seat.axis).toBe('X')
      expect(seat.bandAxis).toBe('Y')
      expect(seat.direction).toBe(direction)
      expect(seat.translationMetres[0] * direction).toBeGreaterThanOrEqual(seat.minimumMetres)
      expect(seat.after.minimumClearanceMetres).toBeGreaterThanOrEqual(seat.clearanceMetres)
    }
  })

  it('keeps the seated caps outside the tunic through bind and gait', () => {
    const tunic = join(import.meta.dirname, '..', 'public', 'gear', 'warden-tunic')
    const overlap = runSetAdvisory([tunic, directory])

    for (const motion of ['bind', 'walk', 'run']) {
      expect(overlap.worst[motion]).toEqual([
        expect.objectContaining({ outer: 'warden-pauldrons', inner: 'warden-tunic', count: 0 }),
      ])
    }
  })

  it('keeps shoulder-helper transfer on the fixed cap when the cloth chain attaches to the upper arm', () => {
    expect(manifest.weights).toBe('transfer')
    expect(manifest.drapes.map((drape: { attachBone: string }) => drape.attachBone))
      .toEqual(['upper_arm_L', 'upper_arm_R'])
    const helperJoints = new Set(['shoulder_helper_L', 'shoulder_helper_R']
      .map((name) => fitted.skin.jointNames.indexOf(name)))
    const drapeJoints = new Set(manifest.drapes.flatMap((drape: { bones: string[] }) => drape.bones)
      .map((name: string) => fitted.skin.jointNames.indexOf(name)))
    let fixedHelperVertices = 0
    for (const mesh of fitted.meshes) {
      for (let vertex = 0; vertex < mesh.positions.length / 3; vertex++) {
        let helperWeight = 0
        let drapeWeight = 0
        for (let lane = 0; lane < 4; lane++) {
          const joint = mesh.joints[vertex * 4 + lane]!
          const weight = mesh.weights[vertex * 4 + lane]!
          if (helperJoints.has(joint)) helperWeight += weight
          if (drapeJoints.has(joint)) drapeWeight += weight
        }
        if (helperWeight > 0 && drapeWeight === 0) fixedHelperVertices++
      }
    }
    expect(fixedHelperVertices).toBeGreaterThan(0)
  })
})
