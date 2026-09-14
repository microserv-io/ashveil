export type HudPanel = 'character' | 'pack' | 'map' | 'journal' | 'finder' | 'social' | 'settings'
export type HudShortcut = { readonly kind: 'interact' } | { readonly kind: 'close' } | { readonly kind: 'open'; readonly panel: HudPanel } | { readonly kind: 'none' }

const PANELS: Readonly<Record<string, HudPanel>> = {
  KeyC: 'character', KeyB: 'pack', KeyM: 'map', KeyJ: 'journal',
  KeyG: 'finder', KeyO: 'social', KeyU: 'settings',
}

export function resolveHudShortcut(
  code: string,
  context: { readonly repeat: boolean; readonly editable: boolean; readonly modalOpen: boolean; readonly activePanel: HudPanel | null },
): HudShortcut {
  if (context.repeat || context.editable) return { kind: 'none' }
  if (code === 'KeyF') return context.modalOpen ? { kind: 'none' } : { kind: 'interact' }
  const panel = PANELS[code]
  if (!panel) return { kind: 'none' }
  return context.modalOpen && context.activePanel === panel ? { kind: 'close' } : { kind: 'open', panel }
}
