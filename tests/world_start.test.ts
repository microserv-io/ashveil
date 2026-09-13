import { describe, expect, it } from 'vitest'
import { compileZone } from '../src/world/zone-compiler'
import { DEFAULT_ZONE } from '../src/world/zone-default'
import { worldStartPresentation } from '../src/world/world-start'

describe('world start presentation', () => {
  it('names the default shore start and landing reset', () => {
    const zone = compileZone(DEFAULT_ZONE)
    expect(worldStartPresentation(zone)).toEqual({
      locationLabel: 'Safe Landing',
      resetLabel: 'Return to landing',
    })
  })

  it('uses the authored landmark label and a generic reset for an old custom spawn', () => {
    const refugeSpawn = compileZone({ ...DEFAULT_ZONE, spawn: { landmarkId: 'refuge', offset: { x: 0, z: 0 } } })
    expect(worldStartPresentation(refugeSpawn)).toEqual({
      locationLabel: 'Alderbank Refuge',
      resetLabel: 'Return to start',
    })
  })
})
