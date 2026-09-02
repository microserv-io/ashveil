#!/usr/bin/env node
/**
 * `npm run art:profile -- --body <name>`
 *
 * Turns a fitted body's manifest and GLB into the two things the renderer reads:
 * the geometry fixture the pose generator solves against, and the skeleton
 * profile that says which bone is which joint. Both are generated, so a body is
 * never hand-transcribed into TypeScript.
 *
 * It refuses a body whose bones do not rest axis-aligned. `semanticskeleton.ts`
 * derives a rest-axis correction per joint from exactly that, and on a body this
 * pipeline built the correction has to be the identity: a non-identity one is a
 * fitter bug reaching the renderer disguised as body data.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { extractRigGeometry } from '../extract-rig-geometry.mjs'

const ROOT = join(import.meta.dirname, '..', '..')
const JSON_CHUNK = 0x4e4f534a
/** A quaternion this far from the identity is a bone the fitter left turned. */
export const AXIS_TOLERANCE = 1e-4

/** Semantic joints the pose generator requires; everything else a family has is optional. */
const REQUIRED_ROLES = new Set([
  'root', 'pelvis', 'spine', 'chest', 'head',
  'shoulder.l', 'elbow.l', 'hand.l', 'shoulder.r', 'elbow.r', 'hand.r',
  'hip.l', 'knee.l', 'foot.l', 'hip.r', 'knee.r', 'foot.r',
])

export class ProfileError extends Error {}

export function familyMapping(contract) {
  const required = {}
  const optional = {}
  for (const bone of contract.bones) {
    if (!bone.role) continue
    ;(REQUIRED_ROLES.has(bone.role) ? required : optional)[bone.role] = bone.name
  }
  const missing = [...REQUIRED_ROLES].filter((role) => !(role in required))
  if (missing.length) throw new ProfileError(`contract gate: no bone plays ${missing.sort().join(', ')}`)
  return { required, optional, helpers: helperMapping(contract) }
}

/** The runtime's four helper slots, from the contract's helper bone names. */
export function helperMapping(contract) {
  const helpers = {}
  for (const spec of contract.helpers ?? []) {
    const match = /^(shoulder_helper|twist_upper_arm)_([LR])$/.exec(spec.name)
    if (!match) throw new ProfileError(`contract gate: helper "${spec.name}" is not a shoulder or twist helper`)
    helpers[`${match[1] === 'shoulder_helper' ? 'shoulder' : 'twist'}.${match[2].toLowerCase()}`] = spec.name
  }
  return helpers
}

function documentOf(body) {
  let offset = 12
  while (offset < body.length) {
    const length = body.readUInt32LE(offset)
    if (body.readUInt32LE(offset + 4) === JSON_CHUNK) {
      return JSON.parse(body.subarray(offset + 8, offset + 8 + length).toString('utf8').trim())
    }
    offset += 8 + length
  }
  throw new ProfileError('glb has no JSON chunk')
}

function multiply(a, b) {
  return [
    a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
    a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
    a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
    a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
  ]
}

function rotationOf(node) {
  if (!node.matrix) return node.rotation ?? [0, 0, 0, 1]
  // A node written as a matrix still carries a rotation; the fitter never emits
  // one, so reading it is only here to notice a file that does.
  const m = node.matrix
  const scale = [0, 1, 2].map((axis) => Math.hypot(m[axis * 4], m[axis * 4 + 1], m[axis * 4 + 2]) || 1)
  const r = [0, 1, 2].map((axis) => [0, 1, 2].map((lane) => m[axis * 4 + lane] / scale[axis]))
  const trace = r[0][0] + r[1][1] + r[2][2]
  if (trace > 0) {
    const s = Math.sqrt(trace + 1) * 2
    return [(r[1][2] - r[2][1]) / s, (r[2][0] - r[0][2]) / s, (r[0][1] - r[1][0]) / s, s / 4]
  }
  throw new ProfileError('glb node uses a matrix with a rotation this reader does not decompose')
}

/** Each named bone's rest rotation in the body frame: the correction the runtime derives. */
export function restCorrections(body, mapping) {
  const document = documentOf(body)
  const parent = new Map()
  document.nodes.forEach((node, at) => (node.children ?? []).forEach((child) => parent.set(child, at)))
  const named = new Map(document.nodes.map((node, at) => [node.name, at]))

  const corrections = {}
  for (const [joint, bone] of Object.entries(mapping)) {
    const at = named.get(bone)
    if (at === undefined) throw new ProfileError(`profile gate: no bone named "${bone}" for joint "${joint}"`)
    let rotation = [0, 0, 0, 1]
    for (let node = at; node !== undefined; node = parent.get(node)) {
      rotation = multiply(rotationOf(document.nodes[node]), rotation)
    }
    corrections[joint] = rotation.map((lane) => Number(lane.toFixed(9)))
  }
  return corrections
}

/** The joints whose rest is turned away from the body frame, worst first. */
export function offAxisJoints(corrections, tolerance = AXIS_TOLERANCE) {
  return Object.entries(corrections)
    .map(([joint, q]) => [joint, 2 * Math.acos(Math.min(1, Math.abs(q[3])))])
    .filter(([, angle]) => angle > tolerance)
    .sort((a, b) => b[1] - a[1])
    .map(([joint]) => joint)
}

/** A body's role is its name without the version: the version lives in the manifest. */
export function bodyRole(body) {
  return body.replace(/-v\d+$/, '').replace(/-/g, '_')
}

export function profileSource(role, family, manifest, fixtureName) {
  const constant = `${role.toUpperCase()}_PROFILE`
  const entries = (table) => Object.entries(table)
    .map(([joint, bone]) => `    ${/^[a-z]+$/.test(joint) ? joint : `'${joint}'`}: '${bone}',`).join('\n')
  return `// Generated by \`npm run art:profile -- --body ${manifest.body}\`. Do not edit by hand.
import fixture from '../procedural/fixtures/${fixtureName}'
import type { SkeletonProfile } from './profile'

/**
 * ${manifest.body}, fitted onto ${family.family} by \`npm run art:fit\`.
 *
 * The bones rest axis-aligned, so \`semanticskeleton.ts\` derives an identity
 * rest-axis correction for every joint here. It carries no weapon and states no
 * \`armCarry\`: an A-pose rest is not a carry, so the empty-hand one is computed
 * from the rest directions in \`procedural/arms.ts\`.
 */
export const ${constant}: SkeletonProfile = {
  name: '${family.family}',
  standingHeight: fixture.standingHeight,
  footprint: fixture.footprint,
  bones: {
${entries(manifest.mapping.required)}
  },
  optional: {
${entries(manifest.mapping.optional)}
  },${manifest.helpers ? `
  helpers: {
${entries(manifest.mapping.helpers)}
  },` : ''}
}
`
}

export function generate(bodyName, { root = ROOT } = {}) {
  const bodyDirectory = join(root, 'public', 'bodies', bodyName)
  const manifest = JSON.parse(readFileSync(join(bodyDirectory, `${bodyName}.manifest.json`), 'utf8'))
  const family = JSON.parse(
    readFileSync(join(root, 'scripts', 'art', 'contracts', `${manifest.family}.json`), 'utf8'))
  if (family.version !== manifest.contractVersion) {
    throw new ProfileError(
      `contract gate: ${bodyName} was fitted against ${manifest.family} ${manifest.contractVersion}, ` +
      `and the contract now reads ${family.version}. Refit the body.`)
  }
  const mapping = familyMapping(family)
  const glb = readFileSync(join(bodyDirectory, `${bodyName}.glb`))

  const offAxis = offAxisJoints(restCorrections(glb, { ...mapping.required, ...mapping.optional }))
  if (offAxis.length) {
    throw new ProfileError(
      `axis gate: ${bodyName} rests off-axis at ${offAxis.join(', ')}. The fitter's bone axis rule ` +
      'says the runtime file rests identity; refit the body rather than correcting it in the profile.')
  }

  const role = bodyRole(bodyName)
  const fixtureName = `${role}.json`
  const fixture = {
    body: manifest.body,
    source: `public/bodies/${bodyName}/${bodyName}.glb`,
    note: 'Bind-pose joint positions in the body frame (+Y up, +Z forward, +X left), in model units.',
    armCarryNote: 'No weapon carry measured: the empty-hand carry is computed from the rest pose.',
    ...extractRigGeometry(glb, mapping.required, mapping.optional),
    // The fitter measured the footprint off the sole itself; the extractor's own
    // reading follows bone dominance, which loses the heel on a rig whose ankle
    // sits a fifth of the way along the foot.
    footprint: manifest.footprint,
  }
  const fixturePath = join(root, 'src', 'render', 'procedural', 'fixtures', fixtureName)
  const profilePath = join(root, 'src', 'render', 'profiles', `${role}.ts`)
  writeFileSync(fixturePath, `${JSON.stringify(fixture, null, 2)}\n`)
  writeFileSync(profilePath, profileSource(role, family, { ...manifest, mapping }, fixtureName))
  return { fixturePath, profilePath, corrections: 'identity' }
}

if (process.argv[1] === import.meta.filename) {
  const argv = process.argv.slice(2)
  const at = argv.indexOf('--body')
  if (at < 0 || !argv[at + 1]) {
    console.error('usage: npm run art:profile -- --body <name>')
    process.exit(1)
  }
  try {
    const written = generate(argv[at + 1])
    console.log(`wrote ${written.fixturePath}\nwrote ${written.profilePath}`)
  } catch (error) {
    console.error(error instanceof ProfileError ? error.message : error)
    process.exit(1)
  }
}
