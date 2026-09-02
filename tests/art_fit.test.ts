import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { blenderArgs, familyContract, FitError, parseArgs, resolvePlan } from '../scripts/art/fit.mjs'

const ROOT = join(import.meta.dirname, '..')
const everythingExists = () => true

/**
 * The wrapper holds no judgment, so what it owes is a refusal that names itself.
 * Every case here is an argument that would otherwise reach Blender and fail
 * three stages later with a stack trace instead of a sentence.
 */
describe('the art:fit wrapper', () => {
  it('reads a full command line', () => {
    const parsed = parseArgs(['--input', 'raw.fbx', '--family', 'humanoid', '--body', 'ash-wolf', '--helpers'])
    expect(parsed).toEqual({ input: 'raw.fbx', family: 'humanoid', body: 'ash-wolf', helpers: true })
  })

  it.each([
    [['--family', 'humanoid', '--body', 'x'], 'argument gate: --input is required'],
    [['--input', 'a.fbx', '--body', 'x'], 'argument gate: --family is required'],
    [['--input', 'a.fbx', '--family', 'humanoid'], 'argument gate: --body is required'],
    [['--input'], 'argument gate: --input needs a value'],
    [['--wat', '1'], 'argument gate: unknown argument "--wat"'],
    [['--input', 'a.fbx', '--family', 'humanoid', '--body', '../escape'],
      'argument gate: --body "../escape" is not a lowercase name a path can carry'],
  ])('refuses %j by name', (argv, message) => {
    expect(() => parseArgs(argv)).toThrow(new FitError(message))
  })

  it('names a family without its version and resolves the contract that carries it', () => {
    expect(familyContract('humanoid')).toBe('humanoid.v1')
    expect(familyContract('humanoid.v2')).toBe('humanoid.v2')
  })

  it('puts a body in its own directory under public/bodies', () => {
    const plan = resolvePlan(parseArgs(['--input', 'raw.fbx', '--family', 'humanoid', '--body', 'masculine-v3']),
      { root: ROOT, exists: everythingExists })
    expect(plan.outdir).toBe(join(ROOT, 'public', 'bodies', 'masculine-v3'))
    expect(plan.family).toBe('humanoid.v1')
    expect(plan.helpers).toBe(false)
  })

  it('refuses an input that is not there, and a family with no contract', () => {
    const parsed = parseArgs(['--input', 'nowhere.fbx', '--family', 'humanoid', '--body', 'x'])
    expect(() => resolvePlan(parsed, { root: ROOT, exists: () => false })).toThrow(/input gate: no file at/)
    const missing = parseArgs(['--input', 'raw.fbx', '--family', 'lizard', '--body', 'x'])
    expect(() => resolvePlan(missing, { root: ROOT, exists: (path: string) => !path.includes('contracts') }))
      .toThrow(/family gate: no contract at/)
  })

  it('makes Blender exit non-zero when the pipeline raises', () => {
    const plan = resolvePlan(parseArgs(['--input', 'raw.fbx', '--family', 'humanoid', '--body', 'x', '--helpers']),
      { root: ROOT, exists: everythingExists })
    const args = blenderArgs(plan, '/runner.py')
    expect(args.slice(0, 6)).toEqual(['--background', '--factory-startup', '--python-exit-code', '1',
      '--python', '/runner.py'])
    expect(args).toContain('--helpers')
    expect(args[args.indexOf('--family') + 1]).toBe('humanoid.v1')
  })
})
