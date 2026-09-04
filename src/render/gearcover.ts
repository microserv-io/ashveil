import * as THREE from 'three'
import { hiddenByRegion, hidesByRegion, type RegionHides } from './gearregions'

/**
 * Which parts of one mesh another mesh covers, and the triangle grid both this and
 * the fitter's clip gate search with.
 *
 * Every piece is fitted against the bare body, so a hood's mantle is shaped around
 * a tunic collar rather than instead of it, and wearing both draws two surfaces
 * through each other. The fix is the same one the body already gets: the piece
 * underneath stops drawing the triangles nobody can see. It cannot be baked at fit
 * time, because which pieces are worn together is a runtime question.
 *
 * The body's rule and this one differ, and deliberately. The fitter asks what a
 * garment covers and may answer yes to skin a hair's breadth under a hem, because
 * a garment is meant to be the thing you see there. Here the question is only
 * whether one solid is behind another, so nothing is dropped that a viewer could
 * still find an angle on.
 *
 * This runs on wear, never per frame. Attributes stay shared by reference and only
 * the index is rebuilt, so a covered piece costs one small buffer and no re-skin.
 */

/** How far the search looks for the covering mesh's nearest surface. */
export const COVER_REACH = 0.06
/**
 * How deep inside the covering piece a vertex has to sit before it counts as under
 * it. A normal ray reaching the piece was tried and is wrong: a tunic hem passing
 * near a trouser hip, or a boot cuff near a trouser leg, is caught by the ray while
 * occluding nothing, and the triangles it hid read as holes from an oblique angle.
 * Depth answers the question the eye asks - is this actually behind that - and the
 * threshold keeps a surface grazing another from counting.
 */
export const COVER_DEPTH = 0.004
/**
 * Grid cells are much finer than the reach on purpose. A vertex sitting a
 * millimetre off the surface finds its triangle in the first ring and stops, so the
 * search radius collapses to the answer instead of always sweeping the full reach.
 */
const CELL = 0.02

export interface CoveringMesh {
  readonly positions: Float32Array
  readonly indices: Uint32Array
}

export interface CoveredMesh {
  readonly positions: Float32Array
}

export function boundsOf(points: Float32Array): Float64Array {
  const box = new Float64Array([Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity])
  for (let at = 0; at < points.length; at += 3) {
    for (let lane = 0; lane < 3; lane++) {
      const value = points[at + lane]!
      if (value < box[lane]!) box[lane] = value
      if (value > box[3 + lane]!) box[3 + lane] = value
    }
  }
  return box
}

/**
 * A uniform grid over the triangles that could reach the query points. A triangle is
 * filed in every cell its own bounds touch, which is what lets a query look at a
 * ring of cells and know it has seen everything within that ring's radius.
 */
export function buildTriangleGrid(
  points: Float32Array,
  triangles: Uint32Array,
  box: Float64Array,
  reach: number,
): void {
  for (let lane = 0; lane < 3; lane++) {
    origin[lane] = box[lane]! - reach
    dims[lane] = Math.max(1, Math.ceil((box[3 + lane]! + reach - origin[lane]!) / CELL))
  }
  const cells = dims[0]! * dims[1]! * dims[2]!
  const count = triangles.length / 3

  if (starts.length < cells + 1) starts = new Uint32Array(cells + 1)
  else starts.fill(0, 0, cells + 1)
  if (cursor.length < cells) cursor = new Uint32Array(cells)
  if (centres.length < count * 3) centres = new Float32Array(count * 3)
  if (radii.length < count) radii = new Float32Array(count)
  if (seen.length < count) {
    seen = new Uint32Array(count)
    stamp = 0
  }

  if (spans.length < count * 6) spans = new Int32Array(count * 6)

  for (let triangle = 0; triangle < count; triangle++) {
    describe(points, triangles, triangle)
    if (cellSpan()) spans.set(span, triangle * 6)
    else {
      spans[triangle * 6] = 0
      spans[triangle * 6 + 3] = -1
      continue
    }
    for (let z = span[2]!; z <= span[5]!; z++) {
      for (let y = span[1]!; y <= span[4]!; y++) {
        const row = (z * dims[1]! + y) * dims[0]!
        for (let x = span[0]!; x <= span[3]!; x++) starts[row + x + 1] = starts[row + x + 1]! + 1
      }
    }
  }

  for (let cell = 1; cell <= cells; cell++) starts[cell] = starts[cell]! + starts[cell - 1]!
  cursor.set(starts.subarray(0, cells))
  if (items.length < starts[cells]!) items = new Uint32Array(starts[cells]!)

  for (let triangle = 0; triangle < count; triangle++) {
    const at = triangle * 6
    if (spans[at + 3]! < spans[at]!) continue
    for (let z = spans[at + 2]!; z <= spans[at + 5]!; z++) {
      for (let y = spans[at + 1]!; y <= spans[at + 4]!; y++) {
        const row = (z * dims[1]! + y) * dims[0]!
        for (let x = spans[at]!; x <= spans[at + 3]!; x++) items[cursor[row + x]!++] = triangle
      }
    }
  }
}

/**
 * How deep a point sits behind the nearest triangle within `reach`, and zero when
 * that triangle faces it or nothing is near enough. `visible` gates which triangles
 * may answer - a triangle hidden under a worn slot still says which way is out, it
 * just cannot be the answer - and null accepts any.
 *
 * Rings are walked outward and the walk stops as soon as the answer is closer than
 * the radius already covered, so a surface hugging another never pays for the reach.
 * Everything stays in locals: this is the inner loop of a gate that walks two
 * hundred poses of a seventeen-thousand-triangle body.
 */
export function depthBehindNearest(
  points: Float32Array,
  triangles: Uint32Array,
  visible: Uint8Array | null,
  px: number,
  py: number,
  pz: number,
  reach: number,
): number {
  const cx = cellOf(px, 0)
  const cy = cellOf(py, 1)
  const cz = cellOf(pz, 2)
  let nearest = reach * reach
  let radius = reach
  let depth = 0
  stamp++

  const rings = Math.ceil(reach / CELL)
  for (let ring = 0; ring <= rings; ring++) {
    if (ring > 0 && (ring - 1) * CELL >= radius) break
    const lowZ = Math.max(0, cz - ring)
    const highZ = Math.min(dims[2]! - 1, cz + ring)
    for (let z = lowZ; z <= highZ; z++) {
      const edgeZ = Math.abs(z - cz) === ring
      const lowY = Math.max(0, cy - ring)
      const highY = Math.min(dims[1]! - 1, cy + ring)
      for (let y = lowY; y <= highY; y++) {
        const edge = edgeZ || Math.abs(y - cy) === ring
        const row = (z * dims[1]! + y) * dims[0]!
        const lowX = Math.max(0, cx - ring)
        const highX = Math.min(dims[0]! - 1, cx + ring)
        for (let x = lowX; x <= highX; x++) {
          if (!edge && Math.abs(x - cx) !== ring) continue
          const cell = row + x
          for (let at = starts[cell]!; at < starts[cell + 1]!; at++) {
            const triangle = items[at]!
            if (seen[triangle] === stamp) continue
            seen[triangle] = stamp
            const dcx = px - centres[triangle * 3]!
            const dcy = py - centres[triangle * 3 + 1]!
            const dcz = pz - centres[triangle * 3 + 2]!
            const outer = radii[triangle]! + radius
            if (dcx * dcx + dcy * dcy + dcz * dcz > outer * outer) continue

            const a = triangles[triangle * 3]! * 3
            const b = triangles[triangle * 3 + 1]! * 3
            const c = triangles[triangle * 3 + 2]! * 3
            closestOnTriangle(px, py, pz, points, a, b, c, CLOSEST)
            const dx = px - CLOSEST[0]!
            const dy = py - CLOSEST[1]!
            const dz = pz - CLOSEST[2]!
            const distance = dx * dx + dy * dy + dz * dz
            if (distance >= nearest) continue
            nearest = distance
            radius = Math.sqrt(distance)
            const ux = points[b]! - points[a]!
            const uy = points[b + 1]! - points[a + 1]!
            const uz = points[b + 2]! - points[a + 2]!
            const vx = points[c]! - points[a]!
            const vy = points[c + 1]! - points[a + 1]!
            const vz = points[c + 2]! - points[a + 2]!
            const signed =
              dx * (uy * vz - uz * vy) + dy * (uz * vx - ux * vz) + dz * (ux * vy - uy * vx)
            depth = signed < 0 && (visible === null || visible[triangle] === 1) ? radius : 0
          }
        }
      }
    }
  }
  return depth
}

/**
 * Whether a point is inside a mesh, by ray parity along the three axes.
 *
 * The nearest triangle's own normal is not enough and was the first attempt: a
 * garment is an open shell - a neck hole, a hem - and everything under an upward
 * facing sheet reads as behind it, which is how the trousers lost their hips to a
 * tunic hem that was merely above them. Parity does not care what a surface faces.
 *
 * A ray straight down a shared edge meets both triangles and counts two crossings
 * where there is one, so each ray starts a fraction of a millimetre off its axes,
 * by a different amount per axis, and three of them vote.
 */
function insideByParity(points: Float32Array, triangles: Uint32Array, px: number, py: number, pz: number): boolean {
  let odd = 0
  for (let axis = 0; axis < 3; axis++) {
    const nudge = NUDGE[axis]!
    if (crossings(points, triangles, px + nudge[0]!, py + nudge[1]!, pz + nudge[2]!, axis) % 2 === 1) odd++
  }
  return odd >= 2
}

/** Off both perpendicular axes, differently per ray, and far under the depth rule. */
const NUDGE = [
  [0, 1.7e-4, 0.9e-4],
  [0.9e-4, 0, 1.3e-4],
  [1.3e-4, 0.7e-4, 0],
] as const

/** How often the ray from a point along +axis meets the mesh the grid holds. */
function crossings(
  points: Float32Array,
  triangles: Uint32Array,
  px: number,
  py: number,
  pz: number,
  axis: number,
): number {
  const cx = cellOf(px, 0)
  const cy = cellOf(py, 1)
  const cz = cellOf(pz, 2)
  stamp++
  let count = 0
  // A triangle is filed in every cell its own bounds touch, so a hit inside the grid
  // is a hit in one of the cells the ray walks; past the grid there is no geometry.
  for (let step = axis === 0 ? cx : axis === 1 ? cy : cz; step < dims[axis]!; step++) {
    const x = axis === 0 ? step : cx
    const y = axis === 1 ? step : cy
    const z = axis === 2 ? step : cz
    const cell = (z * dims[1]! + y) * dims[0]! + x
    for (let at = starts[cell]!; at < starts[cell + 1]!; at++) {
      const triangle = items[at]!
      if (seen[triangle] === stamp) continue
      seen[triangle] = stamp
      if (metByAxisRay(points, triangles, triangle, px, py, pz, axis)) count++
    }
  }
  return count
}

/** Whether any triangle the grid holds is within `limit` of a point. */
function nearerThan(
  points: Float32Array,
  triangles: Uint32Array,
  px: number,
  py: number,
  pz: number,
  limit: number,
): boolean {
  const squared = limit * limit
  stamp++
  for (let z = cellOf(pz - limit, 2); z <= cellOf(pz + limit, 2); z++) {
    for (let y = cellOf(py - limit, 1); y <= cellOf(py + limit, 1); y++) {
      const row = (z * dims[1]! + y) * dims[0]!
      for (let x = cellOf(px - limit, 0); x <= cellOf(px + limit, 0); x++) {
        const cell = row + x
        for (let at = starts[cell]!; at < starts[cell + 1]!; at++) {
          const triangle = items[at]!
          if (seen[triangle] === stamp) continue
          seen[triangle] = stamp
          const a = triangles[triangle * 3]! * 3
          const b = triangles[triangle * 3 + 1]! * 3
          const c = triangles[triangle * 3 + 2]! * 3
          closestOnTriangle(px, py, pz, points, a, b, c, CLOSEST)
          const dx = px - CLOSEST[0]!
          const dy = py - CLOSEST[1]!
          const dz = pz - CLOSEST[2]!
          if (dx * dx + dy * dy + dz * dz < squared) return true
        }
      }
    }
  }
  return false
}

/**
 * The vertices of one mesh that sit inside another by more than `depth`.
 *
 * Inside is the whole test: a piece is hidden under another only where it is
 * actually behind it, never merely near it. The depth keeps a surface grazing
 * another - a hem crossing a hip, a boot cuff meeting a trouser leg - from taking
 * the triangles it grazed, which read as holes the moment the camera moves off axis.
 */
export function coveredVertices(
  inner: CoveredMesh,
  outer: CoveringMesh,
  depth = COVER_DEPTH,
): Set<number> {
  const covered = new Set<number>()
  if (outer.indices.length === 0 || inner.positions.length === 0) return covered
  // Parity counts crossings all the way out, so every triangle has to be in the grid,
  // not only the ones near the mesh being tested.
  buildTriangleGrid(outer.positions, outer.indices, union(inner.positions, outer.positions), COVER_DEPTH)

  for (let vertex = 0; vertex < inner.positions.length / 3; vertex++) {
    const px = inner.positions[vertex * 3]!
    const py = inner.positions[vertex * 3 + 1]!
    const pz = inner.positions[vertex * 3 + 2]!
    if (nearerThan(outer.positions, outer.indices, px, py, pz, depth)) continue
    if (insideByParity(outer.positions, outer.indices, px, py, pz)) covered.add(vertex)
  }
  return covered
}

function union(first: Float32Array, second: Float32Array): Float64Array {
  const box = boundsOf(first)
  const other = boundsOf(second)
  for (let lane = 0; lane < 3; lane++) {
    box[lane] = Math.min(box[lane]!, other[lane]!)
    box[3 + lane] = Math.max(box[3 + lane]!, other[3 + lane]!)
  }
  return box
}

export interface LayeredMesh extends RegionHides {
  /** The slot's layer: a higher one is worn over a lower one and hides it. */
  readonly layer: number
  readonly mesh: THREE.SkinnedMesh
  /**
   * False for an open piece that covers nothing below it however it is layered.
   * Moving drape triangles are excluded independently from the fixed surface.
   */
  readonly hidesPieces?: boolean
  /**
   * Where this piece's drape bones start in its skin, if it has any. Cloth that
   * swings cannot be trusted to keep covering what was behind it a frame ago, so
   * its triangles are left out of the covering surface even when the rest hides.
   */
  readonly drapeJoints?: number
}

/**
 * Hides each worn piece under the pieces worn over it, by layer and never by the
 * order they were put on. A triangle goes only when all three of its vertices are
 * hidden; a piece nothing covers gets its own geometry straight back, so taking the
 * outer piece off restores what it hid. Which of the two rules answers "hidden" is
 * `gearregions.ts`: the authored one wherever both sides carry what it needs, burial
 * everywhere else.
 */
export function applyPieceMasks(worn: readonly LayeredMesh[]): void {
  for (const wear of worn) {
    const base = baseGeometryOf(wear.mesh)
    const covered = new Set<number>()
    const inner = attributesOf(base)
    for (const other of worn) {
      if (other.layer <= wear.layer || other.mesh === wear.mesh) continue
      if (other.hidesPieces === false) continue
      const hidden = hidesByRegion(wear, other)
        ? hiddenByRegion(inner.positions, wear.regions!, other)
        : coveredVertices(inner, coveringOf(other))
      for (const vertex of hidden) covered.add(vertex)
    }
    wear.mesh.geometry = covered.size === 0 ? base : maskedGeometry(base, covered)
  }
}

/** The unmasked geometry, so taking a piece off restores what it covered. */
const BASE_GEOMETRY = new WeakMap<THREE.Mesh, THREE.BufferGeometry>()

export function baseGeometryOf(mesh: THREE.Mesh): THREE.BufferGeometry {
  const base = BASE_GEOMETRY.get(mesh) ?? mesh.geometry
  BASE_GEOMETRY.set(mesh, base)
  return base
}

/**
 * The same geometry without the triangles whose three vertices are all hidden. The
 * attributes are the originals, shared by reference: only the index differs.
 * Nothing built here may ever be disposed: disposing a geometry frees the buffers
 * of its attributes, and these are the unmasked mesh's.
 */
export function maskedGeometry(
  base: THREE.BufferGeometry,
  hidden: ReadonlySet<number>,
): THREE.BufferGeometry {
  const index = base.getIndex()
  if (!index) return base
  const kept: number[] = []
  // A multi-material mesh draws its groups, not its index, so dropping triangles
  // without moving the group boundaries with them would draw the wrong ones.
  const ranges = base.groups.length > 0 ? base.groups : [{ start: 0, count: index.count, materialIndex: 0 }]
  const regrouped = ranges.map((range) => {
    const from = kept.length
    const until = Math.min(index.count, range.start + range.count)
    for (let at = range.start; at + 2 < until; at += 3) {
      const a = index.getX(at)
      const b = index.getX(at + 1)
      const c = index.getX(at + 2)
      if (hidden.has(a) && hidden.has(b) && hidden.has(c)) continue
      kept.push(a, b, c)
    }
    return { start: from, count: kept.length - from, materialIndex: range.materialIndex ?? 0 }
  })
  if (kept.length === index.count) return base

  const geometry = new THREE.BufferGeometry()
  for (const [name, attribute] of Object.entries(base.attributes)) {
    geometry.setAttribute(name, attribute as THREE.BufferAttribute)
  }
  geometry.setIndex(kept)
  if (base.groups.length > 0) {
    for (const group of regrouped) geometry.addGroup(group.start, group.count, group.materialIndex)
  }
  // The masked mesh is a subset, so the original bounds still contain it.
  geometry.boundingBox = base.boundingBox
  geometry.boundingSphere = base.boundingSphere
  return geometry
}

/** Grown to fit and then reused: a cover pass rebuilds this once per worn pair. */
let starts = new Uint32Array(0)
let cursor = new Uint32Array(0)
let items = new Uint32Array(0)
let centres = new Float32Array(0)
let radii = new Float32Array(0)
let spans = new Int32Array(0)
let seen = new Uint32Array(0)
let stamp = 0
const origin = new Float64Array(3)
const dims = new Int32Array(3)
const span = new Int32Array(6)
const AABB = new Float64Array(6)
const CLOSEST = new Float32Array(3)
const ATTRIBUTES = new WeakMap<THREE.BufferGeometry, CoveringMesh & CoveredMesh>()

/**
 * The surface a piece covers with. Everything but its drape: a triangle a chain
 * carries is somewhere else by the next frame, so what it happened to be over when
 * the pieces were put on is not a hole anyone should cut.
 */
function coveringOf(piece: LayeredMesh): CoveringMesh {
  const base = baseGeometryOf(piece.mesh)
  const whole = attributesOf(base)
  if (piece.drapeJoints === undefined) return whole
  const cached = SETTLED.get(base)
  if (cached) return cached
  const skin = base.getAttribute('skinIndex')
  const kept: number[] = []
  for (let at = 0; at < whole.indices.length; at += 3) {
    if (!swings(skin, whole.indices, at, piece.drapeJoints)) kept.push(...whole.indices.subarray(at, at + 3))
  }
  const settled = { positions: whole.positions, indices: new Uint32Array(kept) }
  SETTLED.set(base, settled)
  return settled
}

/** A triangle swings when any corner carries any influence from the chain. */
function swings(skin: THREE.BufferAttribute | THREE.InterleavedBufferAttribute, indices: Uint32Array, at: number, from: number): boolean {
  for (let corner = 0; corner < 3; corner++) {
    const vertex = indices[at + corner]!
    for (let lane = 0; lane < 4; lane++) if (skin.getComponent(vertex, lane) >= from) return true
  }
  return false
}

const SETTLED = new WeakMap<THREE.BufferGeometry, CoveringMesh>()

function attributesOf(geometry: THREE.BufferGeometry): CoveringMesh & CoveredMesh {
  const cached = ATTRIBUTES.get(geometry)
  if (cached) return cached
  const index = geometry.getIndex()
  const built = {
    positions: new Float32Array(geometry.getAttribute('position').array),
    indices: index ? new Uint32Array(index.array) : new Uint32Array(0),
  }
  ATTRIBUTES.set(geometry, built)
  return built
}

/** Möller-Trumbore against an axis-aligned ray, forward only. */
function metByAxisRay(
  points: Float32Array,
  triangles: Uint32Array,
  triangle: number,
  px: number,
  py: number,
  pz: number,
  axis: number,
): boolean {
  const a = triangles[triangle * 3]! * 3
  const b = triangles[triangle * 3 + 1]! * 3
  const c = triangles[triangle * 3 + 2]! * 3
  const ux = points[b]! - points[a]!
  const uy = points[b + 1]! - points[a + 1]!
  const uz = points[b + 2]! - points[a + 2]!
  const vx = points[c]! - points[a]!
  const vy = points[c + 1]! - points[a + 1]!
  const vz = points[c + 2]! - points[a + 2]!
  const dx = axis === 0 ? 1 : 0
  const dy = axis === 1 ? 1 : 0
  const dz = axis === 2 ? 1 : 0
  const hx = dy * vz - dz * vy
  const hy = dz * vx - dx * vz
  const hz = dx * vy - dy * vx
  const determinant = ux * hx + uy * hy + uz * hz
  if (determinant > -1e-12 && determinant < 1e-12) return false
  const inverse = 1 / determinant
  const sx = px - points[a]!
  const sy = py - points[a + 1]!
  const sz = pz - points[a + 2]!
  const u = (sx * hx + sy * hy + sz * hz) * inverse
  if (u < 0 || u > 1) return false
  const qx = sy * uz - sz * uy
  const qy = sz * ux - sx * uz
  const qz = sx * uy - sy * ux
  const v = (dx * qx + dy * qy + dz * qz) * inverse
  if (v < 0 || u + v > 1) return false
  return (vx * qx + vy * qy + vz * qz) * inverse > 1e-9
}

/** The triangle's bounding sphere and, in `AABB`, the box the grid files it by. */
function describe(points: Float32Array, triangles: Uint32Array, triangle: number): void {
  let cx = 0
  let cy = 0
  let cz = 0
  for (let lane = 0; lane < 3; lane++) {
    AABB[lane] = Infinity
    AABB[3 + lane] = -Infinity
  }
  for (let corner = 0; corner < 3; corner++) {
    const at = triangles[triangle * 3 + corner]! * 3
    cx += points[at]!
    cy += points[at + 1]!
    cz += points[at + 2]!
    for (let lane = 0; lane < 3; lane++) {
      const value = points[at + lane]!
      if (value < AABB[lane]!) AABB[lane] = value
      if (value > AABB[3 + lane]!) AABB[3 + lane] = value
    }
  }
  cx /= 3
  cy /= 3
  cz /= 3
  let radius = 0
  for (let corner = 0; corner < 3; corner++) {
    const at = triangles[triangle * 3 + corner]! * 3
    radius = Math.max(radius, Math.hypot(points[at]! - cx, points[at + 1]! - cy, points[at + 2]! - cz))
  }
  centres[triangle * 3] = cx
  centres[triangle * 3 + 1] = cy
  centres[triangle * 3 + 2] = cz
  radii[triangle] = radius
}

function cellSpan(): boolean {
  for (let lane = 0; lane < 3; lane++) {
    const from = Math.floor((AABB[lane]! - origin[lane]!) / CELL)
    const to = Math.floor((AABB[3 + lane]! - origin[lane]!) / CELL)
    if (to < 0 || from >= dims[lane]!) return false
    span[lane] = Math.max(0, from)
    span[3 + lane] = Math.min(dims[lane]! - 1, to)
  }
  return true
}

function cellOf(value: number, lane: number): number {
  return Math.min(dims[lane]! - 1, Math.max(0, Math.floor((value - origin[lane]!) / CELL)))
}

/** Ericson's closest-point-on-triangle, written against a flat vertex array. */
export function closestOnTriangle(
  px: number,
  py: number,
  pz: number,
  points: Float32Array,
  a: number,
  b: number,
  c: number,
  out: Float32Array,
): void {
  const ax = points[a]!
  const ay = points[a + 1]!
  const az = points[a + 2]!
  const abx = points[b]! - ax
  const aby = points[b + 1]! - ay
  const abz = points[b + 2]! - az
  const acx = points[c]! - ax
  const acy = points[c + 1]! - ay
  const acz = points[c + 2]! - az
  const apx = px - ax
  const apy = py - ay
  const apz = pz - az

  const d1 = abx * apx + aby * apy + abz * apz
  const d2 = acx * apx + acy * apy + acz * apz
  if (d1 <= 0 && d2 <= 0) return write(out, ax, ay, az)

  const bpx = px - points[b]!
  const bpy = py - points[b + 1]!
  const bpz = pz - points[b + 2]!
  const d3 = abx * bpx + aby * bpy + abz * bpz
  const d4 = acx * bpx + acy * bpy + acz * bpz
  if (d3 >= 0 && d4 <= d3) return write(out, points[b]!, points[b + 1]!, points[b + 2]!)

  const vc = d1 * d4 - d3 * d2
  if (vc <= 0 && d1 >= 0 && d3 <= 0) {
    const t = d1 / (d1 - d3)
    return write(out, ax + abx * t, ay + aby * t, az + abz * t)
  }

  const cpx = px - points[c]!
  const cpy = py - points[c + 1]!
  const cpz = pz - points[c + 2]!
  const d5 = abx * cpx + aby * cpy + abz * cpz
  const d6 = acx * cpx + acy * cpy + acz * cpz
  if (d6 >= 0 && d5 <= d6) return write(out, points[c]!, points[c + 1]!, points[c + 2]!)

  const vb = d5 * d2 - d1 * d6
  if (vb <= 0 && d2 >= 0 && d6 <= 0) {
    const t = d2 / (d2 - d6)
    return write(out, ax + acx * t, ay + acy * t, az + acz * t)
  }

  const va = d3 * d6 - d5 * d4
  if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) {
    const t = (d4 - d3) / (d4 - d3 + (d5 - d6))
    return write(
      out,
      points[b]! + (points[c]! - points[b]!) * t,
      points[b + 1]! + (points[c + 1]! - points[b + 1]!) * t,
      points[b + 2]! + (points[c + 2]! - points[b + 2]!) * t,
    )
  }

  const denominator = va + vb + vc
  const v = vb / denominator
  const w = vc / denominator
  write(out, ax + abx * v + acx * w, ay + aby * v + acy * w, az + abz * v + acz * w)
}

function write(out: Float32Array, x: number, y: number, z: number): void {
  out[0] = x
  out[1] = y
  out[2] = z
}
