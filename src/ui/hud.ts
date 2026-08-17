import { itemMods, itemScore } from '../sim/items'
import { PASSIVES, canAllocate, xpIntoLevel } from '../sim/progression'
import type { Sim } from '../sim/sim'
import { skill as skillDef } from '../sim/skills'
import { describeMod } from '../sim/stats'
import { EQUIP_SLOTS, type EquipSlot, type Item, type SimEvent, type SkillId } from '../sim/types'
import { RARITY_CSS } from '../render/palette'

interface SkillSlotView {
  root: HTMLElement
  cooldown: HTMLElement
  binding: string
  skill: SkillId
}

const SKILL_BINDINGS: readonly { skill: SkillId; binding: string }[] = [
  { skill: 'cleave', binding: 'LMB' },
  { skill: 'firebolt', binding: 'RMB' },
  { skill: 'frost_nova', binding: 'Q' },
  { skill: 'dash', binding: 'Space' },
]

export class Hud {
  private readonly lifeFill: HTMLElement
  private readonly lifeLabel: HTMLElement
  private readonly manaFill: HTMLElement
  private readonly manaLabel: HTMLElement
  private readonly xpFill: HTMLElement
  private readonly xpLabel: HTMLElement
  private readonly areaLabel: HTMLElement
  private readonly prompt: HTMLElement
  private readonly toasts: HTMLElement
  private readonly skillSlots: SkillSlotView[] = []

  private readonly inventoryPanel: HTMLElement
  private readonly passivePanel: HTMLElement
  private inventoryOpen = false
  private passivesOpen = false

  constructor(
    root: HTMLElement,
    private readonly onEquip: (itemId: number) => void,
    private readonly onAllocate: (nodeId: string) => void,
  ) {
    root.innerHTML = ''

    const topLeft = div('absolute left-5 top-4 flex flex-col gap-1')
    this.areaLabel = div('text-sm font-semibold tracking-wide text-ash-100/90')
    topLeft.append(this.areaLabel)
    root.append(topLeft)

    this.prompt = div(
      'toast absolute left-1/2 top-16 -translate-x-1/2 rounded-md border border-ember/40 bg-ash-900/90 px-4 py-2 text-sm font-semibold text-ember',
    )
    this.prompt.style.display = 'none'
    root.append(this.prompt)

    this.toasts = div('absolute right-5 top-4 flex w-64 flex-col items-end gap-1.5')
    root.append(this.toasts)

    const life = orb('life')
    this.lifeFill = life.fill
    this.lifeLabel = life.label
    life.root.className += ' absolute bottom-6 left-6'
    root.append(life.root)

    const mana = orb('mana')
    this.manaFill = mana.fill
    this.manaLabel = mana.label
    mana.root.className += ' absolute bottom-6 right-6'
    root.append(mana.root)

    const bar = div('absolute bottom-7 left-1/2 flex -translate-x-1/2 flex-col items-center gap-2')
    const slots = div('flex gap-2')
    for (const { skill, binding } of SKILL_BINDINGS) {
      const slot = div('skill-slot')
      const name = div('px-1 text-center text-[10px] font-bold uppercase leading-tight tracking-wide text-ash-100/85')
      name.textContent = skillDef(skill).name
      const key = div('absolute bottom-0.5 right-1 text-[9px] font-semibold text-ash-300')
      key.textContent = binding
      const cooldown = div('skill-cooldown')
      cooldown.style.height = '0%'
      slot.append(name, key, cooldown)
      slots.append(slot)
      this.skillSlots.push({ root: slot, cooldown, binding, skill })
    }

    const xpTrack = div('h-1.5 w-[420px] overflow-hidden rounded-full bg-ash-700')
    this.xpFill = div('h-full bg-gradient-to-r from-ember/70 to-ember')
    this.xpFill.style.width = '0%'
    xpTrack.append(this.xpFill)
    this.xpLabel = div('text-[11px] font-semibold tracking-wide text-ash-300')

    bar.append(slots, xpTrack, this.xpLabel)
    root.append(bar)

    const hint = div('absolute bottom-2 left-1/2 -translate-x-1/2 text-[10px] text-ash-300/60')
    hint.textContent = 'LMB move / attack · RMB firebolt · Q nova · Space dash · E loot · Tab gear · P passives · F portal'
    root.append(hint)

    this.inventoryPanel = div('panel absolute left-1/2 top-1/2 w-[560px] -translate-x-1/2 -translate-y-1/2 p-5')
    this.inventoryPanel.style.display = 'none'
    root.append(this.inventoryPanel)

    this.passivePanel = div('panel absolute left-1/2 top-1/2 h-[520px] w-[560px] -translate-x-1/2 -translate-y-1/2 p-5')
    this.passivePanel.style.display = 'none'
    root.append(this.passivePanel)
  }

  toggleInventory(): void {
    this.inventoryOpen = !this.inventoryOpen
    if (this.inventoryOpen) this.passivesOpen = false
  }

  togglePassives(): void {
    this.passivesOpen = !this.passivesOpen
    if (this.passivesOpen) this.inventoryOpen = false
  }

  consume(events: readonly SimEvent[]): void {
    for (const event of events) {
      switch (event.kind) {
        case 'level_up':
          this.toast(`Level ${event.level}`, 'text-ember border-ember/50', `${event.passivePoints} passive point${event.passivePoints === 1 ? '' : 's'} — press P`)
          break
        case 'item_picked_up':
          this.toast(event.name, `border-white/10`, 'picked up', RARITY_CSS[event.rarity])
          break
        case 'item_equipped':
          this.toast('Equipped', 'border-white/10', event.slot)
          break
        case 'area_cleared':
          this.toast('Area cleared', 'text-ember border-ember/50', `${event.monstersKilled} slain in ${event.seconds}s`)
          break
        case 'area_entered':
          this.toast(`Depth ${event.depth}`, 'text-arcane border-arcane/50', 'deeper into the ash')
          break
        case 'player_died':
          this.toast('You died', 'text-blood border-blood/60', 'rising again shortly')
          break
        default:
          break
      }
    }
  }

  private toast(title: string, classes: string, detail?: string, colour?: string): void {
    const element = div(`toast rounded-md border bg-ash-900/92 px-3 py-1.5 text-right ${classes}`)
    const heading = div('text-xs font-bold tracking-wide')
    heading.textContent = title
    if (colour) heading.style.color = colour
    element.append(heading)
    if (detail) {
      const sub = div('text-[10px] text-ash-300')
      sub.textContent = detail
      element.append(sub)
    }
    this.toasts.append(element)
    globalThis.setTimeout(() => element.remove(), 3200)
    while (this.toasts.childElementCount > 6) this.toasts.firstElementChild?.remove()
  }

  update(sim: Sim): void {
    const player = sim.player
    const lifeFraction = Math.max(0, player.life / player.stats.maxLife)
    this.lifeFill.style.height = `${lifeFraction * 100}%`
    this.lifeLabel.textContent = `${Math.max(0, Math.ceil(player.life))}`

    const manaFraction = player.stats.maxMana === 0 ? 0 : player.mana / player.stats.maxMana
    this.manaFill.style.height = `${manaFraction * 100}%`
    this.manaLabel.textContent = `${Math.floor(player.mana)}`

    const { into, needed } = xpIntoLevel(sim.progress.xp, sim.progress.level)
    this.xpFill.style.width = needed === 0 ? '100%' : `${(into / needed) * 100}%`
    this.xpLabel.textContent =
      needed === 0 ? `Level ${sim.progress.level} — max` : `Level ${sim.progress.level} — ${into} / ${needed} xp`

    const remaining = sim.monstersRemaining()
    this.areaLabel.textContent = `Depth ${sim.depth} · ${remaining} of ${sim.areaMonsterCount} remaining`

    if (sim.areaCleared) {
      const gap = Math.hypot(sim.map.portal.x - player.pos.x, sim.map.portal.y - player.pos.y)
      this.prompt.style.display = ''
      this.prompt.textContent = gap <= 2.5 ? 'Press F to descend' : 'Area cleared — find the portal'
    } else {
      this.prompt.style.display = 'none'
    }

    for (const slot of this.skillSlots) {
      const def = skillDef(slot.skill)
      const remainingCooldown = sim.cooldownRemaining(player, slot.skill)
      slot.cooldown.style.height = def.cooldown === 0 ? '0%' : `${(remainingCooldown / def.cooldown) * 100}%`
      slot.root.classList.toggle('unaffordable', player.mana < def.manaCost)
    }

    this.inventoryPanel.style.display = this.inventoryOpen ? '' : 'none'
    this.passivePanel.style.display = this.passivesOpen ? '' : 'none'
    if (this.inventoryOpen) this.renderInventory(sim)
    if (this.passivesOpen) this.renderPassives(sim)
  }

  private renderInventory(sim: Sim): void {
    this.inventoryPanel.innerHTML = ''
    this.inventoryPanel.append(panelTitle('Gear', 'Tab to close'))

    const columns = div('grid grid-cols-2 gap-4')

    const equipped = div('flex flex-col gap-1')
    equipped.append(sectionLabel('Equipped'))
    for (const slot of EQUIP_SLOTS) {
      const item = sim.progress.equipment.get(slot)
      equipped.append(itemRow(slot, item, null))
    }

    const carried = div('flex flex-col gap-1')
    carried.append(sectionLabel(`Carried (${sim.progress.inventory.length})`))
    if (sim.progress.inventory.length === 0) {
      const empty = div('px-2 py-1 text-[11px] text-ash-300/60')
      empty.textContent = 'Nothing carried. Click loot or press E.'
      carried.append(empty)
    }
    for (const item of sim.progress.inventory) {
      const equippedItem = sim.progress.equipment.get(item.slot === 'ring1' ? 'ring1' : item.slot)
      const delta = itemScore(item) - (equippedItem ? itemScore(equippedItem) : 0)
      carried.append(itemRow(item.slot, item, () => this.onEquip(item.id), delta))
    }

    columns.append(equipped, carried)
    this.inventoryPanel.append(columns)
    this.inventoryPanel.append(statSummary(sim))
  }

  private renderPassives(sim: Sim): void {
    this.passivePanel.innerHTML = ''
    this.passivePanel.append(
      panelTitle('Passives', `${sim.progress.passivePoints} point${sim.progress.passivePoints === 1 ? '' : 's'} · P to close`),
    )

    const board = div('relative mt-2 h-[430px] w-full')
    const centreX = 50
    const centreY = 42

    for (const node of PASSIVES) {
      if (!node.requires) continue
      const parent = PASSIVES.find((p) => p.id === node.requires)!
      const line = document.createElement('div')
      line.className = 'absolute origin-left bg-ash-600'
      const x1 = centreX + parent.position.x * 26
      const y1 = centreY + parent.position.y * 30
      const x2 = centreX + node.position.x * 26
      const y2 = centreY + node.position.y * 30
      const dx = x2 - x1
      const dy = y2 - y1
      line.style.left = `${x1}%`
      line.style.top = `${y1}%`
      line.style.width = `${Math.hypot(dx, dy)}%`
      line.style.height = '2px'
      line.style.transform = `rotate(${Math.atan2(dy * 4.3, dx) * (180 / Math.PI)}deg)`
      if (sim.progress.allocated.has(node.id)) line.className = 'absolute origin-left bg-ember/70'
      board.append(line)
    }

    for (const node of PASSIVES) {
      const allocated = sim.progress.allocated.has(node.id)
      const available = canAllocate(node.id, sim.progress.allocated, sim.progress.passivePoints)
      const element = document.createElement('button')
      element.className = `passive-node absolute -translate-x-1/2 -translate-y-1/2 rounded-full border-2 px-2 py-1 text-[10px] font-bold ${
        allocated
          ? 'border-ember bg-ember/25 text-ash-100'
          : available
            ? 'border-ember/60 bg-ash-800 text-ember'
            : 'border-ash-600 bg-ash-800/70 text-ash-300/60'
      }`
      element.style.left = `${centreX + node.position.x * 26}%`
      element.style.top = `${centreY + node.position.y * 30}%`
      element.textContent = node.name
      element.title = node.description
      if (available) element.addEventListener('click', () => this.onAllocate(node.id))
      board.append(element)
    }

    this.passivePanel.append(board)
  }
}

function div(className: string): HTMLElement {
  const element = document.createElement('div')
  element.className = className
  return element
}

function panelTitle(title: string, hint: string): HTMLElement {
  const wrapper = div('mb-3 flex items-baseline justify-between border-b border-ash-600 pb-2')
  const heading = div('text-base font-bold tracking-wide')
  heading.textContent = title
  const sub = div('text-[10px] uppercase tracking-widest text-ash-300/70')
  sub.textContent = hint
  wrapper.append(heading, sub)
  return wrapper
}

function sectionLabel(text: string): HTMLElement {
  const label = div('mb-1 text-[10px] uppercase tracking-widest text-ash-300/70')
  label.textContent = text
  return label
}

function itemRow(slot: EquipSlot, item: Item | undefined, onClick: (() => void) | null, delta?: number): HTMLElement {
  const row = document.createElement(onClick ? 'button' : 'div')
  row.className = `w-full rounded border border-ash-600/70 bg-ash-800/60 px-2 py-1 text-left ${
    onClick ? 'cursor-pointer hover:border-ember/60 hover:bg-ash-700/70' : ''
  }`
  if (onClick) row.addEventListener('click', onClick)

  const head = div('flex items-baseline justify-between gap-2')
  const name = div('text-[11px] font-bold')
  name.textContent = item ? item.name : '—'
  name.style.color = item ? (RARITY_CSS[item.rarity] ?? '#fff') : '#5c6270'
  const slotLabel = div('text-[9px] uppercase tracking-wider text-ash-300/60')
  slotLabel.textContent = slot
  head.append(name, slotLabel)
  row.append(head)

  if (item) {
    if (item.weapon) {
      const line = div('text-[10px] text-ash-300')
      line.textContent = `${item.weapon.physicalMin}–${item.weapon.physicalMax} phys · ${item.weapon.attacksPerSecond.toFixed(2)}/s`
      row.append(line)
    }
    for (const mod of itemMods(item).slice(0, 4)) {
      const line = div('text-[10px] text-arcane/85')
      line.textContent = describeMod(mod)
      row.append(line)
    }
  }

  if (delta !== undefined && delta !== 0) {
    const badge = div(`text-[10px] font-bold ${delta > 0 ? 'text-emerald-400' : 'text-ash-300/60'}`)
    badge.textContent = delta > 0 ? `▲ upgrade (+${delta.toFixed(0)})` : `▼ ${delta.toFixed(0)}`
    row.append(badge)
  }

  return row
}

function statSummary(sim: Sim): HTMLElement {
  const stats = sim.player.stats
  const wrapper = div('mt-4 grid grid-cols-3 gap-x-4 gap-y-1 border-t border-ash-600 pt-3 text-[10px] text-ash-300')
  const weapon = sim.weaponOf(sim.player)
  const entries: readonly [string, string][] = [
    ['life', `${Math.round(stats.maxLife)}`],
    ['mana', `${Math.round(stats.maxMana)}`],
    ['armour', `${Math.round(stats.armour)}`],
    ['attack rate', `${stats.attackSpeed.toFixed(2)}/s`],
    ['cast speed', `${stats.castSpeed.toFixed(2)}x`],
    ['crit', `${(stats.critChance * 100).toFixed(1)}% / ${stats.critMulti.toFixed(2)}x`],
    ['move speed', stats.moveSpeed.toFixed(1)],
    ['weapon', weapon ? `${weapon.physicalMin}–${weapon.physicalMax}` : '—'],
    [
      'resists',
      `${Math.round(stats.resistances.fire * 100)}/${Math.round(stats.resistances.cold * 100)}/${Math.round(stats.resistances.lightning * 100)}`,
    ],
  ]
  for (const [label, value] of entries) {
    const cell = div('flex justify-between gap-2')
    const key = div('text-ash-300/60')
    key.textContent = label
    const val = div('font-semibold text-ash-100/90')
    val.textContent = value
    cell.append(key, val)
    wrapper.append(cell)
  }
  return wrapper
}

function orb(kind: 'life' | 'mana'): { root: HTMLElement; fill: HTMLElement; label: HTMLElement } {
  const root = div(`orb orb-${kind}`)
  const fill = div('orb-fill')
  fill.style.height = '100%'
  const label = div('orb-label')
  root.append(fill, label)
  return { root, fill, label }
}
