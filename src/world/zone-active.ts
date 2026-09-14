import { compileZone } from './zone-compiler'
import { DEFAULT_ZONE } from './zone-default'
import type { CompiledZone } from './zone-types'

let activeZone: CompiledZone | undefined

export function installActiveZone(zone: CompiledZone): void {
  if (activeZone) throw new Error('The active zone is already installed')
  activeZone = zone
}

export function getActiveZone(): CompiledZone {
  activeZone ??= compileZone(DEFAULT_ZONE)
  return activeZone
}
