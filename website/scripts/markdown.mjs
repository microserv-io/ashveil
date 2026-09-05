import { Marked } from 'marked'

function escapeHtml(value) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
}

function makeSlugger() {
  const counts = new Map()
  return (value) => {
    const root = value
      .toLowerCase()
      .replace(/<[^>]+>/g, '')
      .replace(/&[^;]+;/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '') || 'section'
    const count = counts.get(root) || 0
    counts.set(root, count + 1)
    return count === 0 ? root : `${root}-${count + 1}`
  }
}

function legacyNote(copy) {
  return `<aside class="legacy-note"><strong>Legacy baseline</strong><span>${copy}</span></aside>`
}

export function renderDesignMarkdown(markdown) {
  const headings = []
  const slug = makeSlugger()
  const marked = new Marked({ gfm: true })

  marked.use({
    renderer: {
      heading(token) {
        const label = token.text.replace(/[*_`]/g, '')
        const id = slug(label)
        if (token.depth === 1) return ''
        if (token.depth === 2) headings.push({ id, label })
        return `<h${token.depth} id="${id}">${this.parser.parseInline(token.tokens)}<a class="heading-link" href="#${id}" aria-label="Link to ${escapeHtml(label)}">#</a></h${token.depth}>`
      },
    },
  })

  let html = marked.parse(markdown)
  html = html
    .replace(
      /(<h2 id="product-foundation"[^>]*>.*?<\/h2>)/,
      `$1${legacyNote('These action-RPG foundations predate the MMORPG direction and await review.')}`,
    )
    .replace(
      /(<h2 id="camera-and-combat-presentation"[^>]*>.*?<\/h2>)/,
      `$1${legacyNote('Camera and combat assumptions are recorded for continuity, not carried forward as MMORPG commitments.')}`,
    )
    .replace(
      /(<h3 id="product-and-competition"[^>]*>.*?<\/h3>)/,
      `$1${legacyNote('Positioning questions were framed around ARPG competitors and will be reframed for the shared-world direction.')}`,
    )
    .replaceAll('<table>', '<div class="table-region" role="region" aria-label="Scrollable design table" tabindex="0"><table>')
    .replaceAll('</table>', '</table></div>')

  return { html, headings }
}
