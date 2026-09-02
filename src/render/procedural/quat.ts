/**
 * Quaternion maths on flat `Float32Array` storage, xyzw, addressed by element
 * offset so a whole pose lives in one buffer and nothing on the frame path
 * allocates. No `three`: this module runs in Node.
 *
 * `noUncheckedIndexedAccess` is on repo-wide, so typed-array reads carry a `!`.
 * The arrays are fixed-length and the offsets are bounded by the caller.
 */

const EPSILON = 1e-8

export function quatIdentity(out: Float32Array, o: number): void {
  out[o] = 0
  out[o + 1] = 0
  out[o + 2] = 0
  out[o + 3] = 1
}

export function quatSet(out: Float32Array, o: number, x: number, y: number, z: number, w: number): void {
  out[o] = x
  out[o + 1] = y
  out[o + 2] = z
  out[o + 3] = w
}

export function quatFromAxisAngle(out: Float32Array, o: number, ax: number, ay: number, az: number, angle: number): void {
  const length = Math.hypot(ax, ay, az)
  if (length < EPSILON) return quatIdentity(out, o)
  const half = angle * 0.5
  const scale = Math.sin(half) / length
  quatSet(out, o, ax * scale, ay * scale, az * scale, Math.cos(half))
}

/** The inverse of a unit quaternion. Safe to alias `out` with the input. */
export function quatConjugate(q: Float32Array, qo: number, out: Float32Array, oo: number): void {
  quatSet(out, oo, -q[qo]!, -q[qo + 1]!, -q[qo + 2]!, q[qo + 3]!)
}

/** out = a * b, applying b first. Safe to alias `out` with either input. */
export function quatMultiply(a: Float32Array, ao: number, b: Float32Array, bo: number, out: Float32Array, oo: number): void {
  const ax = a[ao]!
  const ay = a[ao + 1]!
  const az = a[ao + 2]!
  const aw = a[ao + 3]!
  const bx = b[bo]!
  const by = b[bo + 1]!
  const bz = b[bo + 2]!
  const bw = b[bo + 3]!
  quatSet(
    out,
    oo,
    aw * bx + ax * bw + ay * bz - az * by,
    aw * by - ax * bz + ay * bw + az * bx,
    aw * bz + ax * by - ay * bx + az * bw,
    aw * bw - ax * bx - ay * by - az * bz,
  )
}

/** Writes the rotated vector into the first three elements of `out`. */
export function quatRotate(q: Float32Array, qo: number, vx: number, vy: number, vz: number, out: Float32Array): void {
  const x = q[qo]!
  const y = q[qo + 1]!
  const z = q[qo + 2]!
  const w = q[qo + 3]!
  const tx = 2 * (y * vz - z * vy)
  const ty = 2 * (z * vx - x * vz)
  const tz = 2 * (x * vy - y * vx)
  out[0] = vx + w * tx + y * tz - z * ty
  out[1] = vy + w * ty + z * tx - x * tz
  out[2] = vz + w * tz + x * ty - y * tx
}

/**
 * The shortest rotation taking direction `a` onto direction `b`. Degenerate inputs
 * (zero length, antiparallel) resolve to identity and a well-defined half turn
 * rather than to NaN, because an IK target can legitimately land on its own hip.
 */
export function rotationBetween(
  ax: number,
  ay: number,
  az: number,
  bx: number,
  by: number,
  bz: number,
  out: Float32Array,
  o: number,
): void {
  const al = Math.hypot(ax, ay, az)
  const bl = Math.hypot(bx, by, bz)
  if (al < EPSILON || bl < EPSILON) return quatIdentity(out, o)
  const nax = ax / al
  const nay = ay / al
  const naz = az / al
  const nbx = bx / bl
  const nby = by / bl
  const nbz = bz / bl
  const dot = nax * nbx + nay * nby + naz * nbz
  if (dot > 1 - EPSILON) return quatIdentity(out, o)
  if (dot < -1 + EPSILON) {
    // Any perpendicular axis is a correct half turn; cross with the least
    // parallel cardinal so the cross product stays well conditioned.
    const sideways = Math.abs(nax) < 0.9
    const px = sideways ? 1 : 0
    const py = sideways ? 0 : 1
    const cx = nay * 0 - naz * py
    const cy = naz * px - nax * 0
    const cz = nax * py - nay * px
    const cl = Math.hypot(cx, cy, cz)
    return quatSet(out, o, cx / cl, cy / cl, cz / cl, 0)
  }
  const cx = nay * nbz - naz * nby
  const cy = naz * nbx - nax * nbz
  const cz = nax * nby - nay * nbx
  const w = 1 + dot
  const inverse = 1 / Math.hypot(cx, cy, cz, w)
  quatSet(out, o, cx * inverse, cy * inverse, cz * inverse, w * inverse)
}

/**
 * Normalised lerp along the shortest arc. Slerp buys nothing at the blend
 * durations used here and costs two trig calls per joint per frame.
 */
export function quatNlerp(
  a: Float32Array,
  ao: number,
  b: Float32Array,
  bo: number,
  t: number,
  out: Float32Array,
  oo: number,
): void {
  const ax = a[ao]!
  const ay = a[ao + 1]!
  const az = a[ao + 2]!
  const aw = a[ao + 3]!
  const sign = ax * b[bo]! + ay * b[bo + 1]! + az * b[bo + 2]! + aw * b[bo + 3]! < 0 ? -1 : 1
  const x = ax + (sign * b[bo]! - ax) * t
  const y = ay + (sign * b[bo + 1]! - ay) * t
  const z = az + (sign * b[bo + 2]! - az) * t
  const w = aw + (sign * b[bo + 3]! - aw) * t
  const length = Math.hypot(x, y, z, w)
  if (length < EPSILON) return quatIdentity(out, oo)
  quatSet(out, oo, x / length, y / length, z / length, w / length)
}

export function quatLength(q: Float32Array, o: number): number {
  return Math.hypot(q[o]!, q[o + 1]!, q[o + 2]!, q[o + 3]!)
}

/** The angle of the rotation taking `a` to `b`, in radians. */
export function quatAngleBetween(a: Float32Array, ao: number, b: Float32Array, bo: number): number {
  const dot = a[ao]! * b[bo]! + a[ao + 1]! * b[bo + 1]! + a[ao + 2]! * b[bo + 2]! + a[ao + 3]! * b[bo + 3]!
  return 2 * Math.acos(Math.min(1, Math.abs(dot)))
}
