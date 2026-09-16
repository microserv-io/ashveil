export function blurActiveElement(doc: Document = document): void {
  const active = doc.activeElement as HTMLElement | null
  if (active && typeof active.blur === 'function') active.blur()
}
