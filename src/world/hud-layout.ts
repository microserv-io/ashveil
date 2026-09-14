export type HudLayout = 'keyboard' | 'controller'

interface LayoutStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

const LAYOUT_KEY = 'ashveil-hud-layout'

export function createHudLayoutPreference(storage?: LayoutStorage): { get(): HudLayout; set(layout: HudLayout): void } {
  let current: HudLayout = 'keyboard'
  try { current = storage?.getItem(LAYOUT_KEY) === 'controller' ? 'controller' : 'keyboard' } catch { current = 'keyboard' }
  return {
    get: () => current,
    set: (layout) => {
      current = layout
      try { storage?.setItem(LAYOUT_KEY, layout) } catch { return }
    },
  }
}
