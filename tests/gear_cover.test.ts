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

function skinTo(geometry: THREE.BufferGeometry, joint: number): THREE.BufferGeometry {
  const vertices = geometry.getAttribute('position').count
  geometry.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(
    Array.from({ length: vertices * 4 }, (_, at) => at % 4 === 0 ? joint : 0), 4,
  ))
  return geometry
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

  it('uses a draped attachment fixed surface but never its moving triangles', () => {
    const fixedInner = meshOf(shell(0.05))
    applyPieceMasks([
      { layer: SLOT_LAYERS.chest, mesh: fixedInner },
      { layer: SLOT_LAYERS.back, mesh: meshOf(skinTo(shell(0.08), 0)), drapeJoints: 1 },
    ])
    expect(triangles(fixedInner), 'the fixed yoke or backpack may cover').toBe(0)

    const movingInner = meshOf(shell(0.05))
    applyPieceMasks([
      { layer: SLOT_LAYERS.chest, mesh: movingInner },
      { layer: SLOT_LAYERS.back, mesh: meshOf(skinTo(shell(0.08), 1)), drapeJoints: 1 },
    ])
    expect(triangles(movingInner), 'moving cloth never cuts a hole below it').toBeGreaterThan(0)
  })

  /**
   * The authored rule, and the case burial cannot answer: two shells side by side,
   * neither inside the other, the way a belt strap and the tunic hem it lies against
   * sit six millimetres apart and then swap sides at a run.
   */
  describe('by the regions the upper piece hides', () => {
    /** Every vertex of a shell, tagged waist inside a band and legs outside it. */
    function tagged(mesh: THREE.Mesh, band: readonly [number, number]) {
      const position = mesh.geometry.getAttribute('position')
      const waist: number[] = []
      const legs: number[] = []
      for (let vertex = 0; vertex < position.count; vertex++) {
        const y = position.getY(vertex)
        ;(y >= band[0] && y <= band[1] ? waist : legs).push(vertex)
      }
      return { waist, legs }
    }

    /** A belt sits beside the hem it hides, never inside it, so burial finds nothing. */
    const beside = (): THREE.SkinnedMesh => {
      const strap = shell(0.05)
      strap.translate(0, 0, 0.4)
      return meshOf(strap)
    }

    it('drops the tagged triangles inside the band and keeps the rest', () => {
      const lower = meshOf(shell(0.05))
      const whole = triangles(lower)
      const regions = tagged(lower, [0, 0.06])

      applyPieceMasks([
        { layer: SLOT_LAYERS.chest, mesh: lower, regions },
        { layer: SLOT_LAYERS.waist, mesh: beside(), hidesRegions: ['waist'], hidesBand: [0, 0.06] },
      ])
      expect(triangles(lower), 'the band goes, though nothing is buried').toBeLessThan(whole)
      expect(triangles(lower), 'everything below the band stays').toBeGreaterThan(0)

      applyPieceMasks([{ layer: SLOT_LAYERS.chest, mesh: lower, regions }])
      expect(triangles(lower), 'taking the belt off puts the hem back').toBe(whole)
    })

    it('leaves a region the upper piece does not name alone', () => {
      const lower = meshOf(shell(0.05))
      const whole = triangles(lower)
      applyPieceMasks([
        { layer: SLOT_LAYERS.chest, mesh: lower, regions: tagged(lower, [0, 0.06]) },
        { layer: SLOT_LAYERS.waist, mesh: beside(), hidesRegions: ['head'], hidesBand: [0, 0.06] },
      ])
      expect(triangles(lower)).toBe(whole)
    })

    it('keeps a tagged vertex outside the band, so a hem below a strap stays drawn', () => {
      const lower = meshOf(shell(0.05))
      const whole = triangles(lower)
      const waist = Array.from({ length: lower.geometry.getAttribute('position').count }, (_, at) => at)
      applyPieceMasks([
        { layer: SLOT_LAYERS.chest, mesh: lower, regions: { waist } },
        { layer: SLOT_LAYERS.waist, mesh: beside(), hidesRegions: ['waist'], hidesBand: [1, 2] },
      ])
      expect(triangles(lower)).toBe(whole)
    })

    /** A piece the fitter never tagged is still hidden the way it always was. */
    it('falls back to burial for a piece that carries no regions', () => {
      const lower = meshOf(shell(0.05))
      applyPieceMasks([
        { layer: SLOT_LAYERS.chest, mesh: lower },
        { layer: SLOT_LAYERS.waist, mesh: meshOf(shell(0.08)), hidesRegions: ['waist'], hidesBand: [-1, 1] },
      ])
      expect(triangles(lower)).toBe(0)
    })

    /** Layer still decides direction: a belt cannot hide the piece worn over it. */
    it('never reaches up a layer', () => {
      const upper = meshOf(shell(0.05))
      const whole = triangles(upper)
      applyPieceMasks([
        { layer: SLOT_LAYERS.waist, mesh: upper, regions: tagged(upper, [-1, 1]) },
        { layer: SLOT_LAYERS.legs, mesh: beside(), hidesRegions: ['waist'], hidesBand: [-1, 1] },
      ])
      expect(triangles(upper)).toBe(whole)
    })
  })

  it('orders fixed overlap from chest to back to shoulders and headgear', () => {
    expect(SLOT_LAYERS.shoulders).toBe(SLOT_LAYERS.head)
    expect(SLOT_LAYERS.back).toBeGreaterThan(SLOT_LAYERS.chest)
    expect(SLOT_LAYERS.shoulders).toBeGreaterThan(SLOT_LAYERS.back)

    const backInsideChest = meshOf(shell(0.05))
    applyPieceMasks([
      { layer: SLOT_LAYERS.chest, mesh: meshOf(shell(0.08)) },
      { layer: SLOT_LAYERS.back, mesh: backInsideChest },
    ])
    expect(triangles(backInsideChest), 'chest cannot hide back attachments').toBeGreaterThan(0)

    for (const slot of ['shoulders', 'head'] as const) {
      const outerInsideBack = meshOf(shell(0.05))
      applyPieceMasks([
        { layer: SLOT_LAYERS.back, mesh: meshOf(shell(0.08)) },
        { layer: SLOT_LAYERS[slot], mesh: outerInsideBack },
      ])
      expect(triangles(outerInsideBack), `back cannot hide ${slot}`).toBeGreaterThan(0)
    }

    const backInsideShoulder = meshOf(shell(0.05))
    applyPieceMasks([
      { layer: SLOT_LAYERS.back, mesh: backInsideShoulder },
      { layer: SLOT_LAYERS.shoulders, mesh: meshOf(shell(0.08)) },
    ])
    expect(triangles(backInsideShoulder), 'shoulders hide fixed back overlap').toBe(0)
  })
})
