import type { PickedNpc } from './npc-picker'

export const HUD_TARGET_FRAME = `<section id="hud-target-frame" class="hud-target-frame" aria-label="Selected NPC" hidden>
  <header><strong id="hud-target-name"></strong><span>NPC · Lv —</span></header>
  <div class="hud-frame-meter" aria-label="Target health unavailable"><i aria-hidden="true"></i><b>—</b></div>
</section>`

export const HUD_CHAT_PLACEHOLDER = '<section class="hud-chat-placeholder" aria-label="Chat unavailable"><p><strong>[System]</strong> Chat unavailable.</p></section>'

export const HUD_PLAYER_FRAME = `<section class="hud-player-frame" aria-label="Player status placeholder">
  <header><strong>Adventurer</strong><span>Lv —</span></header>
  <div class="hud-player-meters">
    <div aria-label="Player health unavailable"><span>HP</span><i aria-hidden="true"></i><b>—</b></div>
    <div aria-label="Player resource unavailable"><span>Resource</span><i aria-hidden="true"></i><b>—</b></div>
  </div>
</section>`

export function createTargetFrame(root: ParentNode): (target: PickedNpc | null) => void {
  const frame = required<HTMLElement>(root, '#hud-target-frame')
  const name = required<HTMLElement>(root, '#hud-target-name')
  return (target) => {
    frame.hidden = target === null
    name.textContent = target?.name ?? ''
    frame.setAttribute('aria-label', target ? `Selected NPC: ${target.name}. Level and health unavailable.` : 'Selected NPC')
  }
}

function required<T extends Element>(root: ParentNode, selector: string): T {
  const element = root.querySelector<T>(selector)
  if (!element) throw new Error(`Missing HUD frame: ${selector}`)
  return element
}
