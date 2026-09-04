import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtemp, readFile, readdir, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import test from 'node:test'
import { Marked } from 'marked'

const exec = promisify(execFile)
const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const vite = resolve(repositoryRoot, 'node_modules/.bin/vite')
const config = resolve(repositoryRoot, 'website/vite.config.mjs')
const generate = resolve(repositoryRoot, 'website/scripts/generate.mjs')
const sourcePath = resolve(repositoryRoot, 'docs/game-design-document.md')
const temporaryRoot = await mkdtemp(join(tmpdir(), 'ashveil-site-'))
const builds = new Map()

async function buildForBase(base, name) {
  const output = resolve(temporaryRoot, name)
  const env = { ...process.env, SITE_BASE: base, SITE_OUT_DIR: output }
  await exec(process.execPath, [generate], { cwd: repositoryRoot, env })
  await exec(vite, ['build', '--config', config], { cwd: repositoryRoot, env })
  builds.set(base, output)
}

await buildForBase('/ashveil/', 'repository-base')
await buildForBase('/', 'root-base')

test.after(async () => {
  await rm(temporaryRoot, { recursive: true, force: true })
})

function occurrences(value, pattern) {
  return [...value.matchAll(pattern)].length
}

function stripMarkup(value) {
  return value
    .replace(/<[^>]+>/g, ' ')
    .replace(/&(?:amp|#39|quot);/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function textBlocks(html, tag) {
  const blocks = new Map()
  for (const match of html.matchAll(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, 'g'))) {
    const text = stripMarkup(match[1])
    blocks.set(text, (blocks.get(text) || 0) + 1)
  }
  return blocks
}

async function listFiles(root, current = root) {
  const entries = await readdir(current, { withFileTypes: true })
  const nested = await Promise.all(entries.map((entry) => {
    const path = resolve(current, entry.name)
    return entry.isDirectory() ? listFiles(root, path) : path
  }))
  return nested.flat()
}

function publicTarget(root, base, reference, fromFile) {
  const withoutFragment = reference.split('#')[0].split('?')[0]
  if (!withoutFragment) return fromFile
  if (/^(?:https?:|mailto:|tel:|data:)/.test(withoutFragment)) return null
  if (withoutFragment.startsWith('/')) {
    assert.ok(withoutFragment.startsWith(base), `${reference} is outside configured base ${base}`)
    const relative = withoutFragment.slice(base.length)
    return resolve(root, relative)
  }
  return resolve(dirname(fromFile), withoutFragment)
}

for (const [base, root] of builds) {
  test(`${base} build contains every public route`, async () => {
    for (const relative of ['index.html', 'design/index.html', 'brand/index.html', '404.html']) {
      assert.ok((await stat(resolve(root, relative))).isFile(), `${relative} is missing`)
    }
  })

  test(`${base} build resolves internal links and assets`, async () => {
    const files = await listFiles(root)
    const inspectable = files.filter((file) => /\.(?:html|css)$/.test(file))
    for (const file of inspectable) {
      const body = await readFile(file, 'utf8')
      const references = [
        ...body.matchAll(/(?:href|src)="([^"]+)"/g),
        ...body.matchAll(/url\((?:"|')?([^"')]+)(?:"|')?\)/g),
      ].map((match) => match[1])
      for (const srcset of body.matchAll(/srcset="([^"]+)"/g)) {
        references.push(...srcset[1].split(',').map((candidate) => candidate.trim().split(/\s+/)[0]))
      }
      for (const reference of references) {
        const target = publicTarget(root, base, reference, file)
        if (!target) continue
        const routeTarget = reference.endsWith('/') ? resolve(target, 'index.html') : target
        assert.ok((await stat(routeTarget)).isFile(), `${reference} in ${file} does not resolve`)
      }
    }
  })
}

test('rendered GDD preserves source paragraphs, tables and list items', async () => {
  const source = await readFile(sourcePath, 'utf8')
  const reference = new Marked({ gfm: true }).parse(source)
  const rendered = await readFile(resolve(builds.get('/ashveil/'), 'design/index.html'), 'utf8')
  for (const tag of ['p', 'table', 'li']) {
    const sourceBlocks = textBlocks(reference, tag)
    const renderedBlocks = textBlocks(rendered, tag)
    assert.ok(occurrences(rendered, new RegExp(`<${tag}(?:\\s|>)`, 'g')) >= sourceBlocks.size)
    for (const [text, count] of sourceBlocks) {
      assert.ok((renderedBlocks.get(text) || 0) >= count, `${tag} content was lost: ${text.slice(0, 90)}`)
    }
  }
  for (const heading of source.matchAll(/^## (.+)$/gm)) {
    assert.ok(stripMarkup(rendered).includes(heading[1]), `missing section ${heading[1]}`)
  }
  assert.match(rendered, /Final Fantasy XIV/)
  assert.match(rendered, /World of Warcraft/)
  assert.match(rendered, /PR #32/)
  assert.match(rendered, /PR #35/)
})

test('downloaded Markdown is byte-for-byte identical to its source', async () => {
  const source = await readFile(sourcePath)
  const download = await readFile(resolve(builds.get('/ashveil/'), 'downloads/game-design-document.md'))
  assert.deepEqual(download, source)
})

test('all heading IDs and document fragments are unique and valid', async () => {
  const rendered = await readFile(resolve(builds.get('/ashveil/'), 'design/index.html'), 'utf8')
  const ids = [...rendered.matchAll(/\sid="([^"]+)"/g)].map((match) => match[1])
  assert.equal(new Set(ids).size, ids.length, 'duplicate IDs found')
  for (const fragment of rendered.matchAll(/href="#([^"]+)"/g)) {
    assert.ok(ids.includes(fragment[1]), `fragment #${fragment[1]} has no target`)
  }
  assert.ok(ids.includes('decided'))
  assert.ok(ids.includes('decided-2'))
})

test('public site output contains no game models or runtime scripts', async () => {
  for (const root of builds.values()) {
    const files = await listFiles(root)
    assert.equal(files.some((file) => /\.(?:glb|gltf|js|mjs)$/.test(file)), false)
  }
})

test('brand wrappers embed the exact selected identity board bytes', async () => {
  const source = await readFile(resolve(repositoryRoot, 'website/assets/source/identity-studies.png'))
  const sourceHash = createHash('sha256').update(source).digest('hex')
  const expectations = new Map([
    ['ashveil-wordmark.svg', '1054 176 450 94'],
    ['ashveil-emblem.svg', '1160 278 208 220'],
  ])
  for (const [filename, viewBox] of expectations) {
    const wrapper = await readFile(resolve(builds.get('/ashveil/'), 'brand', filename), 'utf8')
    assert.match(wrapper, new RegExp(`viewBox="${viewBox}"`))
    const encoded = wrapper.match(/base64,([^"']+)/)?.[1]
    assert.ok(encoded, `${filename} has no embedded board data`)
    const embeddedHash = createHash('sha256').update(Buffer.from(encoded, 'base64')).digest('hex')
    assert.equal(embeddedHash, sourceHash)
  }
})
