/**
 * The smallest JSON Schema checker that can hold the art contracts honest.
 *
 * The repo keeps a small dependency set on purpose, and a validator that
 * supports what the two schemas here actually use is a hundred lines. It returns
 * a list of paths and reasons rather than throwing, so a caller can report every
 * problem at once instead of the first one.
 */

const TYPES = {
  object: (value) => typeof value === 'object' && value !== null && !Array.isArray(value),
  array: Array.isArray,
  string: (value) => typeof value === 'string',
  number: (value) => typeof value === 'number' && Number.isFinite(value),
  integer: (value) => Number.isInteger(value),
  boolean: (value) => typeof value === 'boolean',
  null: (value) => value === null,
}

export function validate(schema, value, path = '', root = schema) {
  const at = path || '/'
  const problems = []
  if (schema.$ref) return validate(dereference(schema.$ref, root), value, path, root)
  const types = schema.type === undefined ? [] : [schema.type].flat()
  if (types.length && !types.some((type) => TYPES[type]?.(value))) {
    return [`${at}: expected ${types.join(' or ')}, found ${describe(value)}`]
  }
  if ('const' in schema && value !== schema.const) {
    problems.push(`${at}: expected the constant ${JSON.stringify(schema.const)}`)
  }
  if (schema.enum && !schema.enum.includes(value)) {
    problems.push(`${at}: expected one of ${schema.enum.map((each) => JSON.stringify(each)).join(', ')}`)
  }
  if (schema.pattern && typeof value === 'string' && !new RegExp(schema.pattern).test(value)) {
    problems.push(`${at}: "${value}" does not match ${schema.pattern}`)
  }
  if (typeof value === 'number') {
    if (schema.minimum !== undefined && value < schema.minimum) problems.push(`${at}: below ${schema.minimum}`)
    if (schema.maximum !== undefined && value > schema.maximum) problems.push(`${at}: above ${schema.maximum}`)
  }
  if (schema.oneOf) {
    const matching = schema.oneOf.filter((branch) => validate(branch, value, path, root).length === 0)
    if (matching.length !== 1) {
      problems.push(`${at}: matches ${matching.length} of the ${schema.oneOf.length} allowed shapes, not one`)
    }
  }
  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems) {
      problems.push(`${at}: needs at least ${schema.minItems} items`)
    }
    if (schema.maxItems !== undefined && value.length > schema.maxItems) {
      problems.push(`${at}: takes at most ${schema.maxItems} items`)
    }
    if (schema.uniqueItems && new Set(value.map((each) => JSON.stringify(each))).size !== value.length) {
      problems.push(`${at}: has repeated items`)
    }
    if (schema.items) {
      value.forEach((each, index) => problems.push(...validate(schema.items, each, `${path}/${index}`, root)))
    }
  }
  if (TYPES.object(value)) {
    for (const required of schema.required ?? []) {
      if (!(required in value)) problems.push(`${at}: missing required property "${required}"`)
    }
    for (const [key, child] of Object.entries(schema.properties ?? {})) {
      if (key in value) problems.push(...validate(child, value[key], `${path}/${key}`, root))
    }
    const known = new Set(Object.keys(schema.properties ?? {}))
    for (const key of Object.keys(value)) {
      if (known.has(key)) continue
      if (schema.additionalProperties === false) problems.push(`${at}: unexpected property "${key}"`)
      else if (TYPES.object(schema.additionalProperties)) {
        problems.push(...validate(schema.additionalProperties, value[key], `${path}/${key}`, root))
      }
    }
  }
  return problems
}

/** Only the local `#/$defs/...` form the contracts here use; anything else is a typo. */
function dereference(reference, root) {
  const found = reference.startsWith('#/')
    ? reference.slice(2).split('/').reduce((node, key) => (node === undefined ? node : node[key]), root)
    : undefined
  if (!TYPES.object(found)) throw new Error(`schema gate: cannot resolve ${reference}`)
  return found
}

function describe(value) {
  if (value === null) return 'null'
  if (Array.isArray(value)) return 'array'
  return typeof value
}
