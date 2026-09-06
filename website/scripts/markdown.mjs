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

export function renderDesignMarkdown(markdown, {
  headingOffset = 0,
  includeLevelOne = false,
  tocDepths = [2],
  transformLink,
} = {}) {
  const headings = []
  const slug = makeSlugger()
  const marked = new Marked({ gfm: true })

  marked.use({
    renderer: {
      heading(token) {
        const label = token.text.replace(/[*_`]/g, '')
        const id = slug(label)
        if (token.depth === 1 && !includeLevelOne) return ''
        const depth = Math.min(token.depth + headingOffset, 6)
        if (tocDepths.includes(token.depth)) headings.push({ id, label, depth })
        return `<h${depth} id="${id}">${this.parser.parseInline(token.tokens)}<a class="heading-link" href="#${id}" aria-label="Link to ${escapeHtml(label)}">#</a></h${depth}>`
      },
      link(token) {
        const href = transformLink ? transformLink(token.href) : token.href
        const title = token.title ? ` title="${escapeHtml(token.title)}"` : ''
        return `<a href="${escapeHtml(href)}"${title}>${this.parser.parseInline(token.tokens)}</a>`
      },
    },
  })

  const html = marked.parse(markdown)
    .replaceAll('<table>', '<div class="table-region" role="region" aria-label="Scrollable design table" tabindex="0"><table>')
    .replaceAll('</table>', '</table></div>')

  return { html, headings }
}
