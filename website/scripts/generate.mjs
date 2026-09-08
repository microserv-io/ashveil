import { copyFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { optimizeArtwork } from './artwork.mjs'
import { generateBrandAssets } from './brand-assets.mjs'
import { renderDesignMarkdown } from './markdown.mjs'
import { copyLicenseNotices } from '../../scripts/copy-license-notices.mjs'

const websiteRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const repositoryRoot = resolve(websiteRoot, '..')
const defaultOutput = resolve(websiteRoot, '.site')
const defaultPublic = resolve(websiteRoot, 'public')
const siteOrigin = (process.env.SITE_ORIGIN || 'https://microserv-io.github.io').replace(/\/$/, '')

export function normalizeBase(value = '/ashveil/') {
  const withLeadingSlash = value.startsWith('/') ? value : `/${value}`
  return withLeadingSlash.endsWith('/') ? withLeadingSlash : `${withLeadingSlash}/`
}

function escapeHtml(value) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
}

function createPathHelpers(base) {
  const path = (relative = '') => `${base}${relative}`.replace(/\/+/g, '/')
  return {
    path,
    home: path(),
    design: path('design/'),
    story: path('story/first-chapter/'),
    brand: path('brand/'),
    licenses: path('licenses/'),
  }
}

function emblem(path, className = 'brand-mark') {
  return `<img class="${className}" src="${path('brand/ashveil-emblem.svg')}" alt="">`
}

function wordmark(path, className = 'brand-wordmark') {
  return `<img class="${className}" src="${path('brand/ashveil-wordmark.svg')}" alt="Ashveil">`
}

function siteHeader(paths, current) {
  const link = (href, label, key) => `<a href="${href}"${current === key ? ' aria-current="page"' : ''}>${label}</a>`
  return `<header class="site-header">
    <a class="brand-lockup" href="${paths.home}">${emblem(paths.path)}${wordmark(paths.path)}</a>
    <nav aria-label="Main navigation">
      ${link(paths.home, 'World', 'home')}
      ${link(paths.design, 'Design document', 'design')}
      ${link(paths.brand, 'Brand', 'brand')}
    </nav>
  </header>`
}

function siteFooter(paths) {
  return `<footer class="site-footer">
    <section><a class="brand-lockup" href="${paths.home}">${emblem(paths.path, 'footer-mark')}${wordmark(paths.path)}</a><p>A vivid shared world, threatened by ash.</p></section>
    <nav aria-label="Footer navigation"><a href="${paths.design}">Read the GDD</a><a href="${paths.brand}">Brand resources</a><a href="${paths.licenses}">Licenses</a><a href="https://github.com/microserv-io/ashveil">GitHub</a></nav>
    <small>Early development · Concept art shown · Updated 8 September 2026</small>
  </footer>`
}

function shell({ base, current, canonicalPath, description, title, content, bodyClass = '' }) {
  const paths = createPathHelpers(base)
  const pageTitle = title ? `${title} · Ashveil` : 'Ashveil · A world worth defending'
  const resolvedCanonicalPath = canonicalPath || (current === 'design' ? paths.design : current === 'brand' ? paths.brand : paths.home)
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${pageTitle}</title>
  <meta name="description" content="${escapeHtml(description)}">
  <meta name="theme-color" content="#102f29">
  <meta property="og:title" content="${pageTitle}">
  <meta property="og:description" content="${escapeHtml(description)}">
  <meta property="og:type" content="website">
  <meta property="og:url" content="${siteOrigin}${resolvedCanonicalPath}">
  <meta property="og:image" content="${siteOrigin}${paths.path('media/ember-world-social.jpg')}">
  <meta property="og:image:alt" content="A party overlooking Ashveil's sunlit valleys and city">
  <meta name="twitter:card" content="summary_large_image">
  <link rel="canonical" href="${siteOrigin}${resolvedCanonicalPath}">
  <link rel="icon" href="${paths.path('brand/ashveil-emblem.svg')}" type="image/svg+xml">
  <link rel="stylesheet" href="/styles.css">
</head>
<body class="${bodyClass}">
  <a class="skip-link" href="#main">Skip to content</a>
  ${siteHeader(paths, current)}
  <main id="main">${content}</main>
  ${siteFooter(paths)}
</body>
</html>`
}

function responsivePicture(paths, name, alt, className = '') {
  return `<picture class="${className}">
    <source type="image/webp" srcset="${paths.path(`media/${name}-960.webp`)} 960w, ${paths.path(`media/${name}-1600.webp`)} 1600w" sizes="(max-width: 900px) 100vw, 1440px">
    <img src="${paths.path(`media/${name}-1600.webp`)}" width="1600" height="900" alt="${escapeHtml(alt)}">
  </picture>`
}

const chapterConcepts = [
  {
    name: 'alderbank-refuge',
    alt: 'Proposed Alderbank Refuge concept showing travellers and survivors gathering in a sunlit riverside settlement',
    caption: 'Alderbank Refuge · a proposed haven for the chapter’s survivors',
  },
  {
    name: 'orchard-and-wagon-road',
    alt: 'Proposed orchard and wagon road concept with fruit trees, a stopped covered wagon and travellers beside a warm rural lane',
    caption: 'Orchard and wagon road · a proposed route through the chapter’s lived-in countryside',
  },
  {
    name: 'broken-waystation',
    alt: 'Proposed broken waystation concept with four travellers descending into riverside ruins among collapsed bridges and old pipes',
    caption: 'Broken waystation · a proposed threshold where the road begins to fail',
  },
  {
    name: 'ward-engine',
    alt: 'Proposed ward engine concept with four travellers facing three handwheel regulators around a cyan and violet fault in an old stone chamber',
    caption: 'Ward engine · a proposed visual direction for the first dungeon’s central mechanism',
  },
]

function chapterConceptGallery(paths) {
  const figures = chapterConcepts.map(({ name, alt, caption }) => `<figure>
        <a href="${paths.path(`media/chapter/${name}-1600.jpg`)}" aria-label="View full-size concept art: ${escapeHtml(caption)}">
          <picture>
            <source type="image/webp" srcset="${paths.path(`media/chapter/${name}-960.webp`)} 960w, ${paths.path(`media/chapter/${name}-1600.webp`)} 1600w" sizes="(max-width: 800px) 100vw, 42rem">
            <img src="${paths.path(`media/chapter/${name}-960.jpg`)}" srcset="${paths.path(`media/chapter/${name}-960.jpg`)} 960w, ${paths.path(`media/chapter/${name}-1600.jpg`)} 1600w" sizes="(max-width: 800px) 100vw, 42rem" width="1600" height="900" alt="${escapeHtml(alt)}" loading="lazy" decoding="async">
          </picture>
        </a>
        <figcaption>${escapeHtml(caption)}</figcaption>
      </figure>`).join('')
  return `<section class="chapter-concepts" id="concept-art" aria-labelledby="concept-art-title">
      <header><p class="eyebrow">Early visual development</p><h2 id="concept-art-title">Places along the first journey</h2><p>Four proposed scene studies for the opening chapter. These images explore atmosphere and location; they are concept art, not gameplay footage or settled environment design.</p></header>
      <section class="chapter-concept-grid" aria-label="First chapter concept art">${figures}</section>
    </section>`
}

function homePage(base) {
  const paths = createPathHelpers(base)
  const content = `<section class="hero">
      ${responsivePicture(paths, 'ember-world', 'Five travellers overlook a luminous valley, river towns and a distant hilltop city', 'hero-art')}
      <span class="hero-shade" aria-hidden="true"></span>
      <section class="hero-copy">
        <p class="eyebrow">A new shared-world fantasy</p>
        <h1 class="hero-title">${wordmark(paths.path, 'hero-wordmark')}</h1>
        <p class="hero-line">Where colour endures,<br>hope gathers.</p>
        <a class="button button-gold" href="${paths.design}">Read the design document <span aria-hidden="true">→</span></a>
      </section>
      <p class="art-label">Early visual-development concept art</p>
    </section>
    <section class="intro page-band">
      <p class="eyebrow">In early development</p>
      <h2>A world meant to be shared.</h2>
      <p class="lede">Ashveil is a social MMORPG in development: a vivid mythic world where communities grow beneath a slow, colourless threat. Its living design record separates decisions from directions and open questions.</p>
      <a class="text-link" href="${paths.design}">Explore the living GDD <span aria-hidden="true">↗</span></a>
    </section>
    <section class="world-feature">
      ${responsivePicture(paths, 'where-colour-fades', 'A stone bridge crosses from a flowering village into a silent ash-grey landscape', 'world-art')}
      <article>
        <p class="eyebrow">The world’s central contrast</p>
        <h2>Life remembers its colour.</h2>
        <p>Warm fields, old stone and places worth caring about stand against the Veil. Ash does more than darken the horizon: it stills familiar things and drains them of life.</p>
        <p class="caption">Concept art — visual direction, not in-game footage.</p>
      </article>
    </section>
    <section class="pillars page-band">
      <header><p class="eyebrow">A direction taking root</p><h2>Wonder, threatened.</h2></header>
      <ol>
        <li><span>01</span><h3>A vivid world</h3><p>Warmth and beauty give the darkness something meaningful to take away.</p></li>
        <li><span>02</span><h3>Shared horizons</h3><p>The MMORPG direction begins with a world that feels inhabited, social and worth returning to.</p></li>
        <li><span>03</span><h3>Readable craft</h3><p>Every promise enters the design record with a clear status: decided, directional or open.</p></li>
      </ol>
    </section>
    <section class="gdd-invite">
      <p class="eyebrow">Read the work in progress</p>
      <h2>The design is a living record.</h2>
      <p>The first MMORPG design pass covers the whole game at planning depth, from one-character class switching and social life to crafting, group play and the questions still open.</p>
      <a class="button button-gold" href="${paths.design}">Open the GDD <span aria-hidden="true">→</span></a>
    </section>`
  return shell({ base, current: 'home', description: 'Ashveil is an early MMORPG concept: a vivid shared fantasy world threatened by ash.', content, bodyClass: 'home-page' })
}

function documentContents(headings) {
  return `<ol>${headings.map(({ id, label, depth }) => `<li${depth > 2 ? ` class="toc-depth-${depth}"` : ''}><a href="#${id}">${escapeHtml(label)}</a></li>`).join('')}</ol>`
}

function designPage(base, markdown) {
  const paths = createPathHelpers(base)
  const rendered = renderDesignMarkdown(markdown, {
    transformLink: (href) => href === 'story/opening-chapter.md' ? paths.story : href,
  })
  const toc = documentContents(rendered.headings)
  const content = `<header class="document-hero">
      <p class="eyebrow">First MMORPG design pass · 5 September 2026</p>
      <h1>Game design document</h1>
      <p>What Ashveil currently knows, what it is testing, and what still needs a decision.</p>
      <nav aria-label="Document actions"><a class="button button-gold" href="${paths.path('downloads/game-design-document.md')}" download>Download Markdown</a><a class="text-link" href="${paths.story}">Read the first chapter</a><button class="text-link print-button" type="button" onclick="window.print()">Print document</button></nav>
    </header>
    <details class="mobile-toc"><summary>On this page</summary>${toc}</details>
    <section class="document-layout">
      <aside class="desktop-toc"><p>On this page</p>${toc}</aside>
      <article class="prose">${rendered.html}</article>
    </section>`
  return shell({ base, current: 'design', title: 'Game design document', description: 'Read Ashveil’s living game design document, including its MMORPG transition and open proposals.', content, bodyClass: 'document-page' })
}

function storyPage(base, markdown) {
  const paths = createPathHelpers(base)
  const rendered = renderDesignMarkdown(markdown, {
    headingOffset: 1,
    includeLevelOne: true,
    tocDepths: [1, 2],
  })
  const toc = documentContents(rendered.headings)
  const content = `<header class="document-hero story-hero">
      <p class="eyebrow">Authored story draft · First Early Access chapter</p>
      <h1>The first chapter</h1>
      <p>A long-form quest script for Ashveil’s opening journey. Story beats and working names may change; this draft describes planned content, not implemented gameplay.</p>
      <nav aria-label="Document actions"><a class="button button-gold" href="${paths.path('downloads/first-chapter.md')}" download>Download Markdown</a><a class="text-link" href="#concept-art">View concept art</a><a class="text-link" href="${paths.design}">Return to the GDD</a><button class="text-link print-button" type="button" onclick="window.print()">Print chapter</button></nav>
    </header>
    ${chapterConceptGallery(paths)}
    <details class="mobile-toc"><summary>Chapter contents</summary>${toc}</details>
    <section class="document-layout story-layout">
      <aside class="desktop-toc"><p>Chapter contents</p>${toc}</aside>
      <article class="prose story-prose">${rendered.html}</article>
    </section>`
  return shell({
    base,
    current: 'story',
    canonicalPath: paths.story,
    title: 'The first chapter',
    description: 'Read the authored draft of Ashveil’s first story chapter: its opening main quests, local side stories and first dungeon.',
    content,
    bodyClass: 'document-page story-page',
  })
}

function brandPage(base) {
  const paths = createPathHelpers(base)
  const content = `<header class="brand-hero">
      <section><p class="eyebrow">Identity study 03 · selected 5 September 2026</p><h1>Ember<br><i>&amp;</i> Bloom</h1><p>Warmth held against the ash. A literary identity for a shared mythic world.</p></section>
      <figure>${emblem(paths.path, 'brand-hero-mark')}<figcaption>The botanical ember</figcaption></figure>
    </header>
    <section class="brand-section wordmark-study">
      <header><span>01</span><p class="eyebrow">Wordmark</p><h2>Ashveil</h2></header>
      <p>The original selected lettering pairs a larger initial A with strong, sharp serifs. Use generous space and let the letterforms carry the moment.</p>
      ${wordmark(paths.path, 'wordmark-sample')}
    </section>
    <section class="brand-section emblem-study">
      <header><span>02</span><p class="eyebrow">Emblem</p><h2>Guard the ember.</h2></header>
      <p>Two forest leaves cradle a living flame. The mark holds Ashveil’s central tension in one small shape: life sheltering light.</p>
      <section class="mark-grid"><figure class="mark-light">${emblem(paths.path, 'mark-specimen')}<figcaption>Original selected artwork</figcaption></figure></section>
      <nav class="download-row" aria-label="Brand artwork downloads"><a class="button button-outline" href="${paths.path('brand/ashveil-emblem.svg')}" download>Original emblem artwork</a><a class="button button-outline" href="${paths.path('brand/ashveil-wordmark.svg')}" download>Original wordmark artwork</a></nav>
      <aside class="asset-note"><strong>Approved study artwork</strong><span>These SVG containers preserve the exact raster pixels and parchment ground from the selected identity board. They are not vector paths. A production vector and single-colour mark remain future brand work.</span></aside>
    </section>
    <section class="brand-section type-study">
      <header><span>03</span><p class="eyebrow">Supporting typography</p><h2>Stories with roots.</h2></header>
      <p>The website uses these self-hosted faces around the original wordmark artwork. Neither is presented as the wordmark’s source typeface.</p>
      <section class="type-grid"><article><p class="type-name">Alegreya · Editorial display</p><p class="alegreya-specimen">A vivid world<br>worth caring for.</p><p>Regular · Medium · Bold · Extra Bold</p></article><article><p class="type-name">Source Sans 3 · Reading</p><p class="source-specimen">Clear at a glance, comfortable over a long journey. Source Sans carries navigation, detail and the living design record.</p><p>Regular · Medium · SemiBold · Bold</p></article></section>
    </section>
    <section class="brand-section palette-study">
      <header><span>04</span><p class="eyebrow">Palette</p><h2>Earth, leaf, flame.</h2></header>
      <ol class="swatches"><li class="forest"><strong>Deep forest</strong><code>#102F29</code></li><li class="leaf"><strong>Forest leaf</strong><code>#255B48</code></li><li class="ivory"><strong>Warm ivory</strong><code>#F6F0DF</code></li><li class="terra"><strong>Terracotta</strong><code>#A94F37</code></li><li class="gold"><strong>Ember gold</strong><code>#E2AD3F</code></li></ol>
    </section>
    <section class="brand-section art-study">
      <header><span>05</span><p class="eyebrow">World imagery</p><h2>Beauty gives ash its meaning.</h2></header>
      <p>The art direction begins with lived-in warmth, wide shared horizons and a visible threshold where colour fades.</p>
      <section class="art-pair"><figure>${responsivePicture(paths, 'ember-world', 'Five travellers overlook Ashveil’s luminous valleys and distant city')}<figcaption>Shared horizons · concept art</figcaption></figure><figure>${responsivePicture(paths, 'where-colour-fades', 'A flowering village gives way to a still grey landscape beyond a bridge')}<figcaption>Where the colour fades · concept art</figcaption></figure></section>
      <aside class="provenance-note"><strong>Concept art, not gameplay.</strong><span>Generated with OpenAI’s built-in image generation tool on 5 September 2026 for early visual development. Font licence files are included with the self-hosted fonts.</span></aside>
    </section>`
  return shell({ base, current: 'brand', title: 'Brand', description: 'The selected Ember & Bloom identity for Ashveil: emblem, typography, palette and concept artwork.', content, bodyClass: 'brand-page' })
}

function notFoundPage(base) {
  const paths = createPathHelpers(base)
  const content = `<section class="not-found">${emblem(paths.path, 'not-found-mark')}<p class="eyebrow">404 · The path fades here</p><h1>Beyond the known veil.</h1><p>This page has gone quiet. The living world is still close.</p><a class="button button-gold" href="${paths.home}">Return to Ashveil</a></section>`
  return shell({ base, title: 'Page not found', description: 'The requested Ashveil page could not be found.', content, bodyClass: 'not-found-page' })
}

function licensesPage(base, notices) {
  const paths = createPathHelpers(base)
  const sections = notices.map(({ name, body }) => `<section class="license-copy"><h2>${name}</h2><p><a href="${paths.path(name)}">Download the original file</a></p><pre>${escapeHtml(body)}</pre></section>`).join('')
  const content = `<section class="document-hero"><p class="eyebrow">Legal</p><h1>Licenses and notices</h1><p>Ashveil source code and ordinary documentation use the MIT License. Project-controlled art and asset data have separate terms, and third-party material keeps its own license.</p></section><article class="license-document">${sections}</article>`
  return shell({ base, current: 'licenses', canonicalPath: paths.licenses, title: 'Licenses', description: 'Ashveil code, asset, and third-party license notices.', content, bodyClass: 'document-page license-page' })
}

async function writePage(output, relative, html) {
  const file = resolve(output, relative)
  await mkdir(dirname(file), { recursive: true })
  await writeFile(file, html)
}

export async function generateSite({
  base = process.env.SITE_BASE || '/ashveil/',
  outputDir = defaultOutput,
  publicDir = defaultPublic,
  clean = true,
} = {}) {
  const normalizedBase = normalizeBase(base)
  const markdown = await readFile(resolve(repositoryRoot, 'docs/game-design-document.md'), 'utf8')
  const storySources = await Promise.all([
    'opening-chapter.md',
    'opening-msq.md',
    'opening-side-quests.md',
  ].map((filename) => readFile(resolve(repositoryRoot, 'docs/story', filename), 'utf8')))
  const storyMarkdown = `${storySources.map((source) => source.trimEnd()).join('\n\n')}\n`
  const licenseNotices = await Promise.all(['LICENSE', 'LICENSE-CODE', 'LICENSE-ASSETS', 'THIRD_PARTY_NOTICES.md'].map(async (name) => ({
    name,
    body: await readFile(resolve(repositoryRoot, name), 'utf8'),
  })))
  if (clean) await rm(outputDir, { recursive: true, force: true })
  await Promise.all([
    optimizeArtwork(websiteRoot, publicDir),
    generateBrandAssets(websiteRoot, publicDir),
    copyLicenseNotices(publicDir, repositoryRoot),
  ])
  await mkdir(outputDir, { recursive: true })
  await copyFile(resolve(websiteRoot, 'src/styles.css'), resolve(outputDir, 'styles.css'))
  await mkdir(resolve(publicDir, 'downloads'), { recursive: true })
  await copyFile(
    resolve(repositoryRoot, 'docs/game-design-document.md'),
    resolve(publicDir, 'downloads/game-design-document.md'),
  )
  await writeFile(resolve(publicDir, 'downloads/first-chapter.md'), storyMarkdown)
  await Promise.all([
    writePage(outputDir, 'index.html', homePage(normalizedBase)),
    writePage(outputDir, 'design/index.html', designPage(normalizedBase, markdown)),
    writePage(outputDir, 'story/first-chapter/index.html', storyPage(normalizedBase, storyMarkdown)),
    writePage(outputDir, 'brand/index.html', brandPage(normalizedBase)),
    writePage(outputDir, 'licenses/index.html', licensesPage(normalizedBase, licenseNotices)),
    writePage(outputDir, '404.html', notFoundPage(normalizedBase)),
  ])
  return { base: normalizedBase, outputDir, publicDir }
}

const invokedDirectly = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (invokedDirectly) {
  const result = await generateSite()
  process.stdout.write(`Generated Ashveil site for ${result.base}\n`)
}
