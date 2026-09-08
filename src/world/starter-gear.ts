import * as THREE from 'three'
import {
  STARTER_GEAR_SLOTS,
  starterGearMaterialDyeChannel,
  type StarterGearDyeChannel,
  type StarterGearMaterial,
  type StarterGearMesh,
  type StarterGearSlot,
  type StarterGearTemplate,
} from './starter-gear-source'

const MATRIX_EPSILON = 1e-5
const TINT_PATTERN = /^#[0-9a-f]{6}$/i

export interface StarterGearSlotAppearance {
  readonly equipped: boolean
  readonly primaryTint: string | null
  readonly trimTint: string | null
}

export type StarterGearAppearance = Readonly<Record<StarterGearSlot, StarterGearSlotAppearance>>

const DEFAULT_SLOT_APPEARANCE: StarterGearSlotAppearance = Object.freeze({
  equipped: true,
  primaryTint: null,
  trimTint: null,
})

export const DEFAULT_STARTER_GEAR_APPEARANCE: StarterGearAppearance = Object.freeze({
  chest: DEFAULT_SLOT_APPEARANCE,
  waist: DEFAULT_SLOT_APPEARANCE,
  legs: DEFAULT_SLOT_APPEARANCE,
  boots: DEFAULT_SLOT_APPEARANCE,
})

interface DyeMaterial {
  readonly material: StarterGearMaterial
  readonly authoredColor: THREE.Color
}

export class StarterGear {
  private readonly slotRoots = new Map<StarterGearSlot, THREE.Group>()
  private readonly materials = new Set<StarterGearMaterial>()
  private readonly dyeMaterials = new Map<StarterGearSlot, ReadonlyMap<StarterGearDyeChannel, DyeMaterial>>()
  private appearance: StarterGearAppearance

  constructor(body: THREE.Object3D, bodySha256: string, private readonly template: StarterGearTemplate) {
    if (template.manifest.bodySha256 !== bodySha256) throw new Error('Starter gear was fitted to a different approved body.')
    this.appearance = initialAppearance(template)
    const bodyMeshes: THREE.SkinnedMesh[] = []
    body.traverse((object) => { if (object instanceof THREE.SkinnedMesh) bodyMeshes.push(object) })
    if (bodyMeshes.length !== 1) throw new Error('Starter gear requires exactly one approved body mesh.')
    const bodyMesh = bodyMeshes[0]!
    if (!bodyMesh.parent) throw new Error('Approved body mesh has no attachment parent.')

    for (const slot of STARTER_GEAR_SLOTS) {
      const sources = template.meshes.get(slot)
      if (!sources) continue
      for (const source of sources) validateBindSpace(bodyMesh, source)
    }
    for (const slot of STARTER_GEAR_SLOTS) {
      const sources = template.meshes.get(slot)
      if (!sources) continue
      const slotRoot = new THREE.Group()
      slotRoot.name = template.manifest.slots.find((record) => record.slot === slot)!.mesh
      bodyMesh.parent.add(slotRoot)
      this.slotRoots.set(slot, slotRoot)
      const materialClones = new Map<StarterGearMaterial, StarterGearMaterial>()
      const slotDyeMaterials = new Map<StarterGearDyeChannel, DyeMaterial>()
      for (const source of sources) {
        const sourceMaterials = Array.isArray(source.material) ? source.material : [source.material]
        const clonedMaterials = sourceMaterials.map((sourceMaterial) => {
          let clone = materialClones.get(sourceMaterial)
          if (!clone) {
            clone = sourceMaterial.clone()
            materialClones.set(sourceMaterial, clone)
            this.materials.add(clone)
          }
          return clone
        })
        const material = Array.isArray(source.material) ? clonedMaterials : clonedMaterials[0]!
        const mesh = new THREE.SkinnedMesh(source.geometry, material)
        mesh.name = source.name
        mesh.bindMode = bodyMesh.bindMode
        mesh.bind(bodyMesh.skeleton, bodyMesh.bindMatrix)
        mesh.castShadow = true
        mesh.receiveShadow = true
        mesh.frustumCulled = false
        slotRoot.add(mesh)

        for (const clonedMaterial of new Set(clonedMaterials)) {
          const channel = starterGearMaterialDyeChannel(clonedMaterial)
          if (!channel) throw new Error(`Starter gear material name is not supported: ${clonedMaterial.name}.`)
          slotDyeMaterials.set(channel, { material: clonedMaterial, authoredColor: clonedMaterial.color.clone() })
        }
      }
      this.dyeMaterials.set(slot, slotDyeMaterials)
    }
  }

  get appearanceState(): StarterGearAppearance { return this.appearance }
  get dyeChannels(): StarterGearTemplate['dyeChannels'] { return this.template.dyeChannels }

  setEquipped(slot: StarterGearSlot, equipped: boolean): void {
    const slotRoot = this.slotRoots.get(slot)
    if (!slotRoot) throw new Error(`Unknown starter gear slot: ${slot}.`)
    if (this.appearance[slot].equipped === equipped) return
    slotRoot.visible = equipped
    this.updateAppearance(slot, { equipped })
  }

  setDye(slot: StarterGearSlot, channel: StarterGearDyeChannel, tint: string | null): void {
    const normalizedTint = normalizeTint(tint)
    const dyeMaterial = this.dyeMaterials.get(slot)?.get(channel)
    if (!dyeMaterial) {
      if (normalizedTint === null && this.appearance[slot]) return
      throw new Error(`Starter gear slot ${slot} has no ${channel} dye channel.`)
    }
    const key = channel === 'primary' ? 'primaryTint' : 'trimTint'
    if (this.appearance[slot][key] === normalizedTint) return
    if (normalizedTint) dyeMaterial.material.color.set(normalizedTint)
    else dyeMaterial.material.color.copy(dyeMaterial.authoredColor)
    this.updateAppearance(slot, { [key]: normalizedTint })
  }

  clearDyes(slot: StarterGearSlot): void {
    this.setDye(slot, 'primary', null)
    this.setDye(slot, 'trim', null)
  }

  dispose(): void {
    for (const root of this.slotRoots.values()) {
      root.clear()
      root.removeFromParent()
    }
    for (const material of this.materials) material.dispose()
    this.slotRoots.clear()
    this.materials.clear()
    this.dyeMaterials.clear()
  }

  private updateAppearance(slot: StarterGearSlot, update: Partial<StarterGearSlotAppearance>): void {
    this.appearance = Object.freeze({
      ...this.appearance,
      [slot]: Object.freeze({ ...this.appearance[slot], ...update }),
    })
  }
}

function normalizeTint(tint: string | null): string | null {
  if (tint === null) return null
  if (!TINT_PATTERN.test(tint)) throw new Error(`Invalid starter gear dye tint: ${tint}.`)
  return tint.toLowerCase()
}

function initialAppearance(template: StarterGearTemplate): StarterGearAppearance {
  if (STARTER_GEAR_SLOTS.every((slot) => template.meshes.has(slot))) return DEFAULT_STARTER_GEAR_APPEARANCE
  return Object.freeze(Object.fromEntries(STARTER_GEAR_SLOTS.map((slot) => [
    slot,
    Object.freeze({ ...DEFAULT_SLOT_APPEARANCE, equipped: template.meshes.has(slot) }),
  ])) as Record<StarterGearSlot, StarterGearSlotAppearance>)
}

function validateBindSpace(body: THREE.SkinnedMesh, gear: StarterGearMesh): void {
  if (body.skeleton.bones.length !== gear.skeleton.bones.length
    || body.skeleton.bones.some((bone, index) => bone.name !== gear.skeleton.bones[index]?.name)) {
    throw new Error(`Starter gear mesh ${gear.name} does not match the approved skeleton.`)
  }
  if (body.skeleton.boneInverses.length !== gear.skeleton.boneInverses.length
    || body.skeleton.boneInverses.some((matrix, index) => !sameMatrix(matrix, gear.skeleton.boneInverses[index]))) {
    throw new Error(`Starter gear mesh ${gear.name} inverse binds do not match the approved body.`)
  }
  if (!sameMatrix(body.bindMatrix, gear.bindMatrix) || !sameMatrix(body.bindMatrixInverse, gear.bindMatrixInverse)) {
    throw new Error(`Starter gear mesh ${gear.name} bind space does not match the approved body.`)
  }
}

function sameMatrix(left: THREE.Matrix4, right: THREE.Matrix4 | undefined): boolean {
  return !!right && left.elements.every((value, index) => Number.isFinite(value)
    && Number.isFinite(right.elements[index]) && Math.abs(value - right.elements[index]!) <= MATRIX_EPSILON)
}
