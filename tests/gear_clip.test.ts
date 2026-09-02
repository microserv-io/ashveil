import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  bodySurface,
  clipLimits,
  forEachClipPose,
  loadClipBody,
  loadClipPiece,
  maskedSlots,
  matchJoints,
  measureClip,
  type BodySurface,
  type ClipBody,
  type ClipPiece,
} from '../scripts/art/gear/clip'
import { measurePenetration, skinVertices } from '../scripts/art/gear/penetration'
import type { GearSlot } from '../src/render/gear'
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
/** Bind, two abductions, two arm flexions, two twists, a torso flex and a hip flex. */
const STRESS_POSES = 9
/** The body's own skin, the one closed mesh on it; the head is a shell with sockets. */
const SKIN = 'Body'

const body = loadClipBody(BODY)
const limits = clipLimits('chest')
const skin = body.meshes.find((mesh) => mesh.name === SKIN)!
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
    // The shell covers the whole mesh, so hiding a slot under it would hide the
    // very triangles the measurement needs.
    covers: [],
    maskBody: false,
    body: body.name,
    jointNames,
    meshes: [shell(metres)],
  }
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

/** The same piece, pushed bodily along one axis, for a gate that has to say no. */
function moved(piece: ClipPiece, dy: number): ClipPiece {
  return {
    ...piece,
    meshes: piece.meshes.map((mesh) => {
      const positions = new Float32Array(mesh.positions)
      for (let at = 1; at < positions.length; at += 3) positions[at] = positions[at]! + dy
      return { ...mesh, positions }
    }),
  }
}

const outward = measureClip(skinBody, shellPiece(OFFSET), limits)

describe('the clipping gate against the body itself', () => {
  it('walks every motion cycle and every stress pose', () => {
    const seen: string[] = []
    forEachClipPose(body.geometry, createPose(), (group, name) => seen.push(`${group}/${name}`))
    expect(seen).toHaveLength(PHASES * MOTION_CYCLES + STRESS_POSES)
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
        'stress/abduct150',
        'stress/armflex60',
        'stress/armflex90',
        'stress/twist45',
        'stress/twist-45',
        'stress/torsoflex45',
        'stress/hipflex90',
      ]),
    )
    expect(outward.poses).toBe(PHASES * MOTION_CYCLES + STRESS_POSES)
  })

  it('leaves the arm overhead out: at 180 the body folds through its own shoulder', () => {
    const seen: string[] = []
    forEachClipPose(body.geometry, createPose(), (_group, name) => seen.push(name))
    expect(seen, 'linear skinning there measures the body, not the piece').not.toContain('abduct180')
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

  it('fails both gates for a shell that is inside the body everywhere', () => {
    const inside = measureClip(skinBody, shellPiece(-OFFSET), limits)
    expect(inside.cycles.motion.maxDepth).toBeGreaterThan(limits.depth)
    expect(inside.gates.clears_the_body_through_motion_cycles).toBe(false)
    expect(inside.gates.clears_the_body_through_stress_poses).toBe(false)
  })

  it('records what the piece hid, and hides nothing without a masks sidecar', () => {
    expect(outward.schema).toBe('ashveil.gear-clip.v1')
    expect(outward.body).toBe(BODY)
    expect(outward.maskedSlots, 'this shell wears maskBody false').toEqual([])

    const masking: ClipPiece = { ...shellPiece(OFFSET), covers: ['chest'], maskBody: true }
    expect(maskedSlots(skinBody, masking)).toEqual(body.hasMasks ? ['chest'] : [])
    expect(maskedSlots({ ...skinBody, hasMasks: false, masks: { slots: {} } }, masking)).toEqual([])
  })

  it.skipIf(!body.hasMasks)('flags the triangles a worn slot hides, and keeps them to measure by', () => {
    const whole = bodySurface(skinBody, new Set<GearSlot>())
    const covered = bodySurface(skinBody, new Set<GearSlot>(['chest']))
    expect(covered.indices).toHaveLength(whole.indices.length)
    expect(covered.visible.filter((flag) => flag === 1)).toHaveLength(
      whole.visible.filter((flag) => flag === 1).length - hiddenTriangles(covered),
    )
    expect(hiddenTriangles(covered), 'the chest mask covers whole triangles').toBeGreaterThan(0)
  })

  /**
   * The hole a worn slot leaves is not a wall. Signing a vertex by the visible
   * surface alone put the nearest triangle at the rim of the mask, centimetres away
   * and facing anywhere, which read a piece resting on the chest as buried in it.
   */
  it.skipIf(!body.hasMasks)('never reads deeper for hiding the body under the piece', () => {
    const masked = measureClip(skinBody, { ...shellPiece(OFFSET), covers: ['chest'], maskBody: true }, limits)
    expect(masked.maskedSlots).toEqual(['chest'])
    expect(masked.cycles.motion.fraction, `worst at ${masked.cycles.motion.pose}`)
      .toBeLessThanOrEqual(outward.cycles.motion.fraction)
    expect(masked.cycles.stress.fraction, `worst at ${masked.cycles.stress.pose}`)
      .toBeLessThanOrEqual(outward.cycles.stress.fraction)
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
/**
 * Past the 14cm of shin the feet mask hides, and past the legs waistband: inside a
 * hidden region nothing shows, so a shallower push measures no penetration at all.
 */
const SUNK = 0.08

describe.each(['proxy-feet', 'proxy-legs'])('%s', (fixture) => {
  const dir = join(FIXTURES, fixture)
  const missing = !existsSync(dir)

  it.skipIf(missing)('clears the body through every pose', () => {
    const piece = loadClipPiece(dir)
    matchJoints(piece, body)
    const result = measureClip(body, piece, clipLimits(piece.slot))
    expect(result.gates.clears_the_body_through_motion_cycles, `worst ${result.cycles.motion.pose}`).toBe(true)
    expect(result.gates.clears_the_body_through_stress_poses, `worst ${result.cycles.stress.pose}`).toBe(true)
  })

  /** The gate has to fail something, or passing the fitted piece proves nothing. */
  it.skipIf(missing)(`fails once the same piece is pushed ${SUNK * 100}cm up into the body`, () => {
    const piece = loadClipPiece(dir)
    const result = measureClip(body, moved(piece, SUNK), clipLimits(piece.slot))
    expect(result.cycles.motion.maxDepth).toBeGreaterThan(clipLimits(piece.slot).depth)
    expect(result.gates.clears_the_body_through_motion_cycles).toBe(false)
  })
})
