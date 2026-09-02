/**
 * How far a fitted piece is inside the body it is worn on, in one pose.
 *
 * The measurement is per piece vertex against the nearest body triangle, which is
 * the only definition that survives a piece hanging off the body (a cloak, a
 * pauldron): an inside/outside test on a closed mesh would call the whole skirt
 * "outside" and see nothing.
 *
 * The whole body is searched even where a worn slot hides it, and only the answer
 * is filtered: a chest piece sits over a hole in the visible body, so searching the
 * visible surface alone would sign a vertex resting on the chest by the armpit rim
 * five centimetres away and read a clean piece as buried. A vertex whose nearest
 * triangle is hidden is inside something nobody can see, and counts as clear.
 *
 * Everything runs on flat typed arrays, reused across poses, because the gate walks
 * two hundred poses of a seventeen-thousand-triangle body and a per-pose allocation
 * of that size is most of the run.
 */

/** How far from a piece vertex a body triangle can be and still be its nearest. */
export const REACH = 0.06
/**
 * Grid cells are much finer than the reach on purpose. A vertex sitting a
 * millimetre off the skin finds its triangle in the first ring and stops, so the
 * search radius collapses to the answer instead of always sweeping the full reach.
 */
const CELL = 0.02
const RINGS = Math.ceil(REACH / CELL)

export interface SkinnedVertices {
  /** Rest positions, three per vertex. */
  readonly positions: Float32Array
  /** Four joint indices per vertex, into the skin's own joint order. */
  readonly joints: Uint16Array
  /** Four weights per vertex, matching `joints`. */
  readonly weights: Float32Array
}

export interface Penetration {
  /** Deepest any piece vertex sits inside the body, in metres. Zero when none does. */
  readonly maxDepth: number
  /** How many piece vertices are deeper inside than the slot's `clip.depth`. */
  readonly over: number
}

/** Linear-blend skinning, column-major matrices as glTF and Three.js both store them. */
export function skinVertices(mesh: SkinnedVertices, matrices: Float32Array, out: Float32Array): void {
  const count = mesh.positions.length / 3
  for (let vertex = 0; vertex < count; vertex++) {
    const px = mesh.positions[vertex * 3]!
    const py = mesh.positions[vertex * 3 + 1]!
    const pz = mesh.positions[vertex * 3 + 2]!
    let x = 0
    let y = 0
    let z = 0
    for (let lane = 0; lane < 4; lane++) {
      const weight = mesh.weights[vertex * 4 + lane]!
      if (weight === 0) continue
      const m = mesh.joints[vertex * 4 + lane]! * 16
      x += weight * (matrices[m]! * px + matrices[m + 4]! * py + matrices[m + 8]! * pz + matrices[m + 12]!)
      y += weight * (matrices[m + 1]! * px + matrices[m + 5]! * py + matrices[m + 9]! * pz + matrices[m + 13]!)
      z += weight * (matrices[m + 2]! * px + matrices[m + 6]! * py + matrices[m + 10]! * pz + matrices[m + 14]!)
    }
    out[vertex * 3] = x
    out[vertex * 3 + 1] = y
    out[vertex * 3 + 2] = z
  }
}

/**
 * Every piece vertex against the body it is worn on. `visible` is one flag per
 * triangle: a hidden triangle still answers "which way is out", it just cannot be
 * penetrated. `depth` is the threshold the slot's contract sets: anything deeper
 * than it counts against the gate.
 */
export function measurePenetration(
  body: Float32Array,
  triangles: Uint32Array,
  visible: Uint8Array,
  piece: Float32Array,
  depth: number,
): Penetration {
  build(body, triangles, bounds(piece))
  let maxDepth = 0
  let over = 0

  for (let vertex = 0; vertex < piece.length / 3; vertex++) {
    const found = deepestAt(body, triangles, visible, piece[vertex * 3]!, piece[vertex * 3 + 1]!, piece[vertex * 3 + 2]!)
    if (found <= 0) continue
    if (found > maxDepth) maxDepth = found
    if (found > depth) over++
  }
  return { maxDepth, over }
}

/** Grown to fit and then reused: the gate rebuilds this two hundred times. */
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

function bounds(points: Float32Array): Float64Array {
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
 * A uniform grid over the body triangles that could reach the piece. A triangle is
 * filed in every cell its own bounds touch, which is what lets a query look at a
 * ring of cells and know it has seen everything within that ring's radius.
 */
function build(body: Float32Array, triangles: Uint32Array, box: Float64Array): void {
  for (let lane = 0; lane < 3; lane++) {
    origin[lane] = box[lane]! - REACH
    dims[lane] = Math.max(1, Math.ceil((box[3 + lane]! + REACH - origin[lane]!) / CELL))
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
    describe(body, triangles, triangle)
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

/** The triangle's bounding sphere and, in `AABB`, the box the grid files it by. */
const AABB = new Float64Array(6)

function describe(body: Float32Array, triangles: Uint32Array, triangle: number): void {
  let cx = 0
  let cy = 0
  let cz = 0
  for (let lane = 0; lane < 3; lane++) {
    AABB[lane] = Infinity
    AABB[3 + lane] = -Infinity
  }
  for (let corner = 0; corner < 3; corner++) {
    const at = triangles[triangle * 3 + corner]! * 3
    cx += body[at]!
    cy += body[at + 1]!
    cz += body[at + 2]!
    for (let lane = 0; lane < 3; lane++) {
      const value = body[at + lane]!
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
    radius = Math.max(radius, Math.hypot(body[at]! - cx, body[at + 1]! - cy, body[at + 2]! - cz))
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

const CLOSEST = new Float32Array(3)

/**
 * How deep one point sits inside the body, signed by the nearest triangle's normal.
 * Zero when that triangle is hidden under a worn slot: the point is behind gear.
 *
 * Rings are walked outward and the walk stops as soon as the answer is closer than
 * the radius already covered, so a piece hugging the skin never pays for the reach.
 */
function deepestAt(
  body: Float32Array,
  triangles: Uint32Array,
  visible: Uint8Array,
  px: number,
  py: number,
  pz: number,
): number {
  const cx = cellOf(px, 0)
  const cy = cellOf(py, 1)
  const cz = cellOf(pz, 2)
  let nearest = REACH * REACH
  let reach = REACH
  let depth = 0
  stamp++

  for (let ring = 0; ring <= RINGS; ring++) {
    if (ring > 0 && (ring - 1) * CELL >= reach) break
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
            const outer = radii[triangle]! + reach
            if (dcx * dcx + dcy * dcy + dcz * dcz > outer * outer) continue

            const a = triangles[triangle * 3]! * 3
            const b = triangles[triangle * 3 + 1]! * 3
            const c = triangles[triangle * 3 + 2]! * 3
            closestOnTriangle(px, py, pz, body, a, b, c, CLOSEST)
            const dx = px - CLOSEST[0]!
            const dy = py - CLOSEST[1]!
            const dz = pz - CLOSEST[2]!
            const distance = dx * dx + dy * dy + dz * dz
            if (distance >= nearest) continue
            nearest = distance
            reach = Math.sqrt(distance)
            const ux = body[b]! - body[a]!
            const uy = body[b + 1]! - body[a + 1]!
            const uz = body[b + 2]! - body[a + 2]!
            const vx = body[c]! - body[a]!
            const vy = body[c + 1]! - body[a + 1]!
            const vz = body[c + 2]! - body[a + 2]!
            const signed =
              dx * (uy * vz - uz * vy) + dy * (uz * vx - ux * vz) + dz * (ux * vy - uy * vx)
            depth = signed < 0 && visible[triangle] === 1 ? reach : 0
          }
        }
      }
    }
  }
  return depth
}

function cellOf(value: number, lane: number): number {
  return Math.min(dims[lane]! - 1, Math.max(0, Math.floor((value - origin[lane]!) / CELL)))
}

/** Ericson's closest-point-on-triangle, written against a flat vertex array. */
function closestOnTriangle(
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
