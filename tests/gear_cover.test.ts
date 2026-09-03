import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { applyPieceMasks, coveredVertices, COVER_DEPTH } from '../src/render/gearcover'
import { SLOT_LAYERS } from '../src/render/gear'

/**
 * Piece over piece: the hiding the fitter cannot bake, because which pieces are
 * worn together is only known at wear time.
 *
 * The shapes here are synthetic on purpose. A shell inside a shell is the whole
 * question, and a real garment would only make the assertion about a real garment.
 */

/** A box shell of a given half-extent, centred on the origin. */
function shell(half: number): THREE.BufferGeometry {
  const geometry = new THREE.BoxGeometry(half * 2, half * 2, half * 2, 3, 3, 3)
  // BoxGeometry ships one group per face; a fitted piece is one plain index.
  geometry.clearGroups()
  return geometry
}

function meshOf(geometry: THREE.BufferGeometry): THREE.SkinnedMesh {
  return new THREE.SkinnedMesh(geometry, new THREE.MeshStandardMaterial())
}

function triangles(mesh: THREE.Mesh): number {
  return (mesh.geometry.getIndex()?.count ?? 0) / 3
}

function attributesOf(geometry: THREE.BufferGeometry) {
  return {
    positions: new Float32Array(geometry.getAttribute('position').array),
    indices: new Uint32Array(geometry.getIndex()!.array),
  }
}

describe('one piece covering another', () => {
  it('counts a vertex well inside the covering shell as covered', () => {
    const inner = attributesOf(shell(0.05))
    const outer = attributesOf(shell(0.08))
    expect(coveredVertices(inner, outer).size).toBe(inner.positions.length / 3)
  })

  it('counts nothing when the covering shell is elsewhere', () => {
    const inner = attributesOf(shell(0.05))
    const far = shell(0.05)
    far.translate(0, 1, 0)
    expect(coveredVertices(inner, attributesOf(far)).size).toBe(0)
  })

  /** A hem grazing a hip occludes nothing, and hiding what it grazed reads as a hole. */
  it('does not count a vertex the covering shell only just contains', () => {
    const inner = attributesOf(shell(0.05))
    const barely = attributesOf(shell(0.05 + COVER_DEPTH / 2))
    expect(coveredVertices(inner, barely).size).toBe(0)
  })

  it('does not count a vertex under a wall standing off it, however close', () => {
    // The normal ray used to call this covered, and a trouser hip under a tunic hem
    // is exactly this shape: near, in front, occluding nothing from an oblique angle.
    const inner = attributesOf(shell(0.05))
    const plate = new THREE.PlaneGeometry(0.4, 0.4)
    plate.rotateX(-Math.PI / 2)
    plate.translate(0, 0.05 + 0.005, 0)
    expect(coveredVertices(inner, attributesOf(plate)).size).toBe(0)
  })
})

describe('hiding a worn piece under the pieces over it', () => {
  it('drops the covered triangles and puts them back when the outer piece goes', () => {
    const lower = meshOf(shell(0.05))
    const upper = meshOf(shell(0.08))
    const whole = triangles(lower)

    applyPieceMasks([{ layer: 1, mesh: lower }, { layer: 2, mesh: upper }])
    expect(triangles(lower)).toBe(0)
    // The outer piece is over everything, so nothing hides it.
    expect(triangles(upper)).toBe(triangles(meshOf(shell(0.08))))

    applyPieceMasks([{ layer: 1, mesh: lower }])
    expect(triangles(lower)).toBe(whole)
  })

  it('shares the attributes of the piece it masks rather than copying them', () => {
    const lower = meshOf(shell(0.05))
    const position = lower.geometry.getAttribute('position')
    applyPieceMasks([{ layer: 1, mesh: lower }, { layer: 2, mesh: meshOf(shell(0.08)) }])
    expect(lower.geometry.getAttribute('position')).toBe(position)
  })

  it('hides by layer and not by the order the pieces were put on', () => {
    const first = meshOf(shell(0.05))
    const second = meshOf(shell(0.08))
    const worn = [{ layer: 2, mesh: second }, { layer: 1, mesh: first }]

    applyPieceMasks(worn)
    expect(triangles(first)).toBe(0)
    expect(triangles(second)).toBeGreaterThan(0)
  })

  it('hides neither of two pieces on the same layer', () => {
    const inner = meshOf(shell(0.05))
    const outer = meshOf(shell(0.08))
    const whole = triangles(inner)

    applyPieceMasks([{ layer: 3, mesh: inner }, { layer: 3, mesh: outer }])
    expect(triangles(inner)).toBe(whole)
  })

  it('layers shoulders above chest at the same tier as headgear', () => {
    expect(SLOT_LAYERS.shoulders).toBe(SLOT_LAYERS.head)
    expect(SLOT_LAYERS.shoulders).toBeGreaterThan(SLOT_LAYERS.chest)

    const shoulderInsideChest = meshOf(shell(0.05))
    applyPieceMasks([
      { layer: SLOT_LAYERS.chest, mesh: meshOf(shell(0.08)) },
      { layer: SLOT_LAYERS.shoulders, mesh: shoulderInsideChest },
    ])
    expect(triangles(shoulderInsideChest), 'chest cannot hide shoulders').toBeGreaterThan(0)

    const chestInsideShoulder = meshOf(shell(0.05))
    const shoulder = meshOf(shell(0.08))
    applyPieceMasks([
      { layer: SLOT_LAYERS.chest, mesh: chestInsideShoulder },
      { layer: SLOT_LAYERS.shoulders, mesh: shoulder },
    ])
    expect(triangles(chestInsideShoulder), 'shoulders hide lower layers').toBe(0)
    expect(triangles(shoulder)).toBeGreaterThan(0)
  })
})
