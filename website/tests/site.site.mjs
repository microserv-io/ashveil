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
const storySourcePaths = [
  'opening-chapter.md',
  'opening-msq.md',
  'opening-side-quests.md',
].map((filename) => resolve(repositoryRoot, 'docs/story', filename))
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
    for (const relative of ['index.html', 'design/index.html', 'story/first-chapter/index.html', 'brand/index.html', 'licenses/index.html', '404.html']) {
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
  assert.doesNotMatch(rendered, /These action-RPG foundations predate the MMORPG direction/)
})

test('downloaded Markdown is byte-for-byte identical to its source', async () => {
  const source = await readFile(sourcePath)
  const download = await readFile(resolve(builds.get('/ashveil/'), 'downloads/game-design-document.md'))
  assert.deepEqual(download, source)
})

test('GDD story link is useful in both source Markdown and the generated site', async () => {
  const source = await readFile(sourcePath, 'utf8')
  const reference = source.match(/\[first-chapter draft\]\(([^)]+)\)/)
  assert.ok(reference, 'GDD must link its first-chapter companion')
  assert.ok((await stat(resolve(dirname(sourcePath), reference[1]))).isFile(), 'source Markdown story link does not resolve')
})

test('first chapter renders all quest anchors with a complete contents list', async () => {
  const rendered = await readFile(resolve(builds.get('/ashveil/'), 'story/first-chapter/index.html'), 'utf8')
  const questHeadings = (await Promise.all(storySourcePaths.map((path) => readFile(path, 'utf8'))))
    .flatMap((source) => [...source.matchAll(/^## ([MS]\d{2})\b/gm)].map((match) => match[1]))
  const questIds = [...rendered.matchAll(/<h3 id="([^"]+)">([MS]\d{2})\b/g)]
    .map(([, id]) => id)
  assert.equal(questHeadings.length, 30, 'story sources must define ten MSQs and twenty side quests')
  assert.equal(questIds.length, 30, 'all thirty quests must render with IDs')
  assert.equal(new Set(questIds).size, 30, 'quest IDs must be unique')
  for (const id of questIds) {
    assert.equal(occurrences(rendered, new RegExp(`href="#${id}"`, 'g')), 3, `#${id} must appear in both contents lists and its heading link`)
  }
  assert.match(rendered, /Authored story draft/)
  assert.match(rendered, /planned content, not implemented gameplay/)
})

test('first chapter preserves all authored source blocks and section headings', async () => {
  const sources = await Promise.all(storySourcePaths.map((path) => readFile(path, 'utf8')))
  const sourceMarkdown = `${sources.map((source) => source.trimEnd()).join('\n\n')}\n`
  const reference = new Marked({ gfm: true }).parse(sourceMarkdown)
  const rendered = await readFile(resolve(builds.get('/ashveil/'), 'story/first-chapter/index.html'), 'utf8')
  for (const tag of ['p', 'table', 'li']) {
    const sourceBlocks = textBlocks(reference, tag)
    const renderedBlocks = textBlocks(rendered, tag)
    for (const [text, count] of sourceBlocks) {
      assert.ok((renderedBlocks.get(text) || 0) >= count, `${tag} content was lost: ${text.slice(0, 90)}`)
    }
  }
  for (const heading of sourceMarkdown.matchAll(/^#{1,4} (.+)$/gm)) {
    assert.ok(stripMarkup(rendered).includes(heading[1]), `missing story section ${heading[1]}`)
  }
})

test('first chapter download is composed byte-for-byte from the three story sources', async () => {
  const sources = await Promise.all(storySourcePaths.map((path) => readFile(path, 'utf8')))
  const expected = Buffer.from(`${sources.map((source) => source.trimEnd()).join('\n\n')}\n`)
  const download = await readFile(resolve(builds.get('/ashveil/'), 'downloads/first-chapter.md'))
  assert.deepEqual(download, expected)
})

test('first chapter presents the four proposed scene concepts before the story script', async () => {
  const rendered = await readFile(resolve(builds.get('/ashveil/'), 'story/first-chapter/index.html'), 'utf8')
  const galleryStart = rendered.indexOf('<section class="chapter-concepts" id="concept-art"')
  const scriptStart = rendered.indexOf('<section class="document-layout story-layout">')
  assert.ok(galleryStart > -1, 'chapter concept gallery is missing')
  assert.ok(galleryStart < scriptStart, 'chapter concept gallery must precede the story script')
  assert.equal(occurrences(rendered.slice(galleryStart, scriptStart), /<figure>/g), 4)
  assert.match(rendered, /concept art, not gameplay footage or settled environment design/)
  assert.doesNotMatch(rendered, /concept art[^<]*game screenshot/i)
})

for (const [base, root] of builds) {
  test(`${base} chapter gallery uses base-aware responsive and full-size artwork`, async () => {
    const rendered = await readFile(resolve(root, 'story/first-chapter/index.html'), 'utf8')
    for (const name of ['alderbank-refuge', 'orchard-and-wagon-road', 'broken-waystation', 'ward-engine']) {
      for (const suffix of ['960.webp', '1600.webp', '960.jpg', '1600.jpg']) {
        assert.match(rendered, new RegExp(`${base.replaceAll('/', '\\/')}media\\/chapter\\/${name}-${suffix.replace('.', '\\.')}`))
        assert.ok((await stat(resolve(root, 'media/chapter', `${name}-${suffix}`))).isFile())
      }
      assert.match(rendered, new RegExp(`href="${base.replaceAll('/', '\\/')}media\\/chapter\\/${name}-1600\\.jpg"`))
    }
  })
}

for (const [base, root] of builds) {
  test(`${base} GDD and first chapter use base-aware reciprocal links and story metadata`, async () => {
    const design = await readFile(resolve(root, 'design/index.html'), 'utf8')
    const story = await readFile(resolve(root, 'story/first-chapter/index.html'), 'utf8')
    const storyUrl = `${base}story/first-chapter/`.replace(/\/+/g, '/')
    assert.match(design, new RegExp(`href="${storyUrl}"`))
    assert.match(story, new RegExp(`href="${base}design/"`))
    assert.match(story, new RegExp(`<link rel="canonical" href="https://microserv-io.github.io${storyUrl}">`))
    assert.match(story, /<title>The first chapter · Ashveil<\/title>/)
    assert.doesNotMatch(story, /<script(?:\s|>)/)
  })
}

test('all heading IDs and document fragments are unique and valid', async () => {
  const rendered = await readFile(resolve(builds.get('/ashveil/'), 'design/index.html'), 'utf8')
  const ids = [...rendered.matchAll(/\sid="([^"]+)"/g)].map((match) => match[1])
  assert.equal(new Set(ids).size, ids.length, 'duplicate IDs found')
  for (const fragment of rendered.matchAll(/href="#([^"]+)"/g)) {
    assert.ok(ids.includes(fragment[1]), `fragment #${fragment[1]} has no target`)
  }
  assert.ok(ids.includes('decided'))
  assert.ok(ids.includes('decided-2'))
  assert.ok(ids.includes('historical-action-rpg-prototype'))
})

test('public site output contains no game models or runtime scripts', async () => {
  for (const root of builds.values()) {
    const files = await listFiles(root)
    assert.equal(files.some((file) => /\.(?:glb|gltf|js|mjs)$/.test(file)), false)
  }
})

test('public site carries the full split-scope notices and links them from every footer', async () => {
  const noticeNames = ['LICENSE', 'LICENSE-CODE', 'LICENSE-ASSETS', 'THIRD_PARTY_NOTICES.md']
  for (const [base, root] of builds) {
    for (const name of noticeNames) {
      assert.deepEqual(await readFile(resolve(root, name)), await readFile(resolve(repositoryRoot, name)))
    }
    const licensePage = await readFile(resolve(root, 'licenses/index.html'), 'utf8')
    assert.match(licensePage, /Ashveil Asset License/)
    assert.match(licensePage, /MIT License/)
    assert.match(licensePage, /KayKit Dungeon Remastered/)
    for (const name of noticeNames) assert.match(licensePage, new RegExp(`href="${base.replaceAll('/', '\\/')}${name.replace('.', '\\.') }"`))
    for (const relative of ['index.html', 'design/index.html', 'story/first-chapter/index.html', 'brand/index.html', 'licenses/index.html', '404.html']) {
      const rendered = await readFile(resolve(root, relative), 'utf8')
      assert.match(rendered, new RegExp(`href="${base.replaceAll('/', '\\/')}licenses/"`))
    }
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
