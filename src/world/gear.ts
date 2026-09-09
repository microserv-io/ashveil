import * as THREE from 'three'
import {
  createGearCollisionInstance,
  gearCollisionProfile,
  type GearCollisionProfile,
  type GearCollisionInstance,
} from './gear-collision'
import {
  GEAR_DYE_CHANNELS,
  MAX_GEAR_SET_INSTANCE_MATERIALS,
  VISUAL_GEAR_SLOTS,
  type GearDyeChannel,
  type GearMaterial,
  type GearMesh,
  type GearSetId,
  type GearSetTemplate,
  type VisualGearSlot,
} from './gear-source'

const TINT_PATTERN = /^#[0-9a-f]{6}$/i
const MATRIX_EPSILON = 1e-5

export interface GearSlotDyes {
  readonly primaryTint: string | null
  readonly trimTint: string | null
}

export interface GearLoadout {
  readonly selected: Readonly<Record<VisualGearSlot, GearSetId | null>>
  readonly dyes: Readonly<Partial<Record<GearSetId, Partial<Record<VisualGearSlot, GearSlotDyes>>>>>
}

interface DyeMaterial {
  readonly material: GearMaterial
  readonly authoredColor: THREE.Color
}

interface GearSlotInstance {
  readonly roots: readonly THREE.Object3D[]
  readonly materials: ReadonlySet<GearMaterial>
  readonly dyes: ReadonlyMap<GearDyeChannel, readonly DyeMaterial[]>
}

interface GearSetInstance {
  readonly slots: ReadonlyMap<VisualGearSlot, GearSlotInstance>
}

export class GearWardrobe {
  private readonly bodyMesh: THREE.SkinnedMesh
  private readonly sets = new Map<GearSetId, GearSetInstance>()
  private readonly collisions: GearCollisionInstance[] = []
  private selected: Record<VisualGearSlot, GearSetId | null> = emptySelection()
  private dyes: Partial<Record<GearSetId, Partial<Record<VisualGearSlot, GearSlotDyes>>>> = {}

  constructor(body: THREE.Object3D, private readonly bodySha256: string) {
    const bodyMeshes: THREE.SkinnedMesh[] = []
    body.traverse((object) => { if (object instanceof THREE.SkinnedMesh) bodyMeshes.push(object) })
    if (bodyMeshes.length !== 1) throw new Error('Gear wardrobe requires exactly one approved body mesh.')
    this.bodyMesh = bodyMeshes[0]!
    if (!this.bodyMesh.parent) throw new Error('Approved body mesh has no gear attachment parent.')
    body.updateMatrixWorld(true)
  }

  get appearanceState(): GearLoadout {
    return { selected: { ...this.selected }, dyes: structuredClone(this.dyes) }
  }

  get setIds(): readonly GearSetId[] { return [...this.sets.keys()] }

  availableSets(slot: VisualGearSlot): readonly GearSetId[] {
    return [...this.sets].flatMap(([id, set]) => set.slots.has(slot) ? [id] : [])
  }

  dyeChannels(slot: VisualGearSlot): ReadonlySet<GearDyeChannel> {
    const id = this.selected[slot]
    return new Set(id ? this.sets.get(id)?.slots.get(slot)?.dyes.keys() : [])
  }

  addSet(template: GearSetTemplate): void {
    const id = template.manifest.id
    if (this.sets.has(id)) throw new Error(`Gear set is already loaded: ${id}.`)
    if (template.manifest.bodySha256 !== this.bodySha256) throw new Error(`Gear set ${id} was fitted to a different approved body.`)

    const stagedRoots: THREE.Object3D[] = []
    const stagedMaterials = new Set<GearMaterial>()
    const stagedCollisions: GearCollisionInstance[] = []
    try {
      const slots = new Map<VisualGearSlot, GearSlotInstance>()
      for (const [slot, parts] of template.parts) {
        const materialClones = new Map<GearMaterial, GearMaterial>()
        const roots: THREE.Object3D[] = []
        const collisionParts: Array<{ readonly profile: GearCollisionProfile; readonly root: THREE.Object3D }> = []
        for (const part of parts) {
          let root: THREE.Object3D
          try {
            root = part.manifest.deformation.kind === 'skinned'
              ? this.createSkinnedPart(id, slot, part.manifest.node, part.meshes, materialClones)
              : this.createRigidPart(
                id,
                slot,
                part.root,
                part.manifest.deformation.joint,
                template.manifest.jointNames,
                materialClones,
              )
          } catch (error) {
            for (const material of materialClones.values()) stagedMaterials.add(material)
            throw error
          }
          root.visible = false
          roots.push(root)
          stagedRoots.push(root)
          for (const material of materialClones.values()) stagedMaterials.add(material)
          const profile = gearCollisionProfile(this.bodySha256, id, part.manifest.node)
          if (profile) collisionParts.push({ profile, root })
        }
        for (const collision of collisionParts) {
          stagedCollisions.push(createGearCollisionInstance(
            collision.profile, this.bodyMesh, collision.root, roots,
          ))
        }
        const dyes = new Map<GearDyeChannel, readonly DyeMaterial[]>()
        for (const channel of GEAR_DYE_CHANNELS) {
          const source = template.dyeMaterials.get(slot)?.get(channel) ?? []
          const channelMaterials = [...new Set(source.map((material) => materialClones.get(material)).filter((material): material is GearMaterial => !!material))]
          if (channelMaterials.length > 0) dyes.set(channel, channelMaterials.map((material) => ({
            material,
            authoredColor: material.color.clone(),
          })))
        }
        for (const material of materialClones.values()) stagedMaterials.add(material)
        slots.set(slot, { roots, materials: new Set(materialClones.values()), dyes })
      }
      if (stagedMaterials.size > MAX_GEAR_SET_INSTANCE_MATERIALS) {
        throw new Error(`Gear set ${id} exceeds the per-character material budget.`)
      }
      if (stagedMaterials.size !== template.manifest.budget.instanceMaterials) {
        throw new Error(`Gear set ${id} instance material count does not match its manifest.`)
      }
      this.sets.set(id, { slots })
      this.collisions.push(...stagedCollisions)
      this.updateCollisionEnvelopes()
    } catch (error) {
      for (const collision of stagedCollisions) collision.dispose()
      for (const root of stagedRoots) root.removeFromParent()
      for (const material of stagedMaterials) material.dispose()
      throw error
    }
  }

  select(slot: VisualGearSlot, id: GearSetId | null): void {
    const next = id ? this.sets.get(id)?.slots.get(slot) : undefined
    if (id && !next) throw new Error(`Gear set ${id} has no ${slot} appearance.`)
    const currentId = this.selected[slot]
    if (currentId === id) return
    const current = currentId ? this.sets.get(currentId)?.slots.get(slot) : undefined
    for (const root of current?.roots ?? []) root.visible = false
    for (const root of next?.roots ?? []) root.visible = true
    this.selected = { ...this.selected, [slot]: id }
    if (slot === 'legs' || slot === 'boots') this.updateCollisionEnvelopes()
  }

  equipSet(id: GearSetId): void {
    const set = this.sets.get(id)
    if (!set) throw new Error(`Gear set is not loaded: ${id}.`)
    const next = Object.fromEntries(VISUAL_GEAR_SLOTS.map((slot) => [slot, set.slots.has(slot) ? id : null])) as Record<VisualGearSlot, GearSetId | null>
    for (const slot of VISUAL_GEAR_SLOTS) {
      const currentId = this.selected[slot]
      if (currentId === next[slot]) continue
      const current = currentId ? this.sets.get(currentId)?.slots.get(slot) : undefined
      for (const root of current?.roots ?? []) root.visible = false
    }
    for (const slot of VISUAL_GEAR_SLOTS) for (const root of set.slots.get(slot)?.roots ?? []) root.visible = true
    this.selected = next
    this.updateCollisionEnvelopes()
  }

  setDye(slot: VisualGearSlot, channel: GearDyeChannel, tint: string | null): void {
    const normalized = normalizeTint(tint)
    const id = this.selected[slot]
    if (!id) throw new Error(`No gear appearance is selected for ${slot}.`)
    const materials = this.sets.get(id)?.slots.get(slot)?.dyes.get(channel)
    if (!materials?.length) throw new Error(`Gear set ${id} slot ${slot} has no ${channel} dye channel.`)
    const current = this.dyes[id]?.[slot] ?? { primaryTint: null, trimTint: null }
    const key = channel === 'primary' ? 'primaryTint' : 'trimTint'
    if (current[key] === normalized) return
    for (const dye of materials) {
      if (normalized) dye.material.color.set(normalized)
      else dye.material.color.copy(dye.authoredColor)
    }
    this.dyes = {
      ...this.dyes,
      [id]: {
        ...this.dyes[id],
        [slot]: { ...current, [key]: normalized },
      },
    }
  }

  dispose(): void {
    for (const collision of this.collisions) collision.dispose()
    this.collisions.length = 0
    for (const set of this.sets.values()) for (const slot of set.slots.values()) {
      for (const root of slot.roots) root.removeFromParent()
      for (const material of slot.materials) material.dispose()
    }
    this.sets.clear()
    this.selected = emptySelection()
    this.dyes = {}
  }

  private createSkinnedPart(
    id: GearSetId,
    slot: VisualGearSlot,
    partNode: string,
    sources: readonly GearMesh[],
    materials: Map<GearMaterial, GearMaterial>,
  ): THREE.Object3D {
    const root = new THREE.Group()
    root.name = `gear:${id}:${slot}:skinned:${partNode}`
    for (const source of sources) {
      if (!(source instanceof THREE.SkinnedMesh)) throw new Error(`Skinned gear part contains a rigid mesh: ${source.name}.`)
      validateBindSpace(this.bodyMesh, source)
      const mesh = new THREE.SkinnedMesh(source.geometry, cloneMaterials(source, materials))
      mesh.name = `${root.name}:${source.name}`
      mesh.bindMode = this.bodyMesh.bindMode
      mesh.bind(this.bodyMesh.skeleton, this.bodyMesh.bindMatrix)
      mesh.castShadow = true
      mesh.receiveShadow = true
      mesh.frustumCulled = false
      root.add(mesh)
    }
    this.bodyMesh.parent!.add(root)
    return root
  }

  private updateCollisionEnvelopes(): void {
    for (const collision of this.collisions) collision.setEquipment(this.selected.legs, this.selected.boots)
  }

  private createRigidPart(
    id: GearSetId,
    slot: VisualGearSlot,
    source: THREE.Object3D,
    rawJoint: string,
    jointNames: readonly string[],
    materials: Map<GearMaterial, GearMaterial>,
  ): THREE.Object3D {
    const jointIndex = jointNames.indexOf(rawJoint)
    if (jointIndex < 0) throw new Error(`Rigid gear joint is not declared: ${rawJoint}.`)
    const jointName = THREE.PropertyBinding.sanitizeNodeName(rawJoint)
    const target = this.bodyMesh.skeleton.bones[jointIndex]
    if (!target || target.name !== jointName) throw new Error(`Rigid gear target joint is missing: ${rawJoint}.`)
    if (!source.parent || source.parent.name !== jointName || !sameMatrix(source.parent.matrixWorld, target.matrixWorld)) {
      throw new Error(`Rigid gear target joint rest space does not match the approved body: ${rawJoint}.`)
    }
    const clone = source.clone(true)
    const sourceMeshes: GearMesh[] = []
    const clonedMeshes: GearMesh[] = []
    source.traverse((object) => { if (object instanceof THREE.Mesh) sourceMeshes.push(object as GearMesh) })
    clone.traverse((object) => { if (object instanceof THREE.Mesh) clonedMeshes.push(object as GearMesh) })
    if (sourceMeshes.length !== clonedMeshes.length) throw new Error(`Rigid gear part could not be cloned: ${source.name}.`)
    sourceMeshes.forEach((mesh, index) => {
      const cloned = clonedMeshes[index]!
      cloned.material = cloneMaterials(mesh, materials)
      cloned.castShadow = true
      cloned.receiveShadow = true
      cloned.frustumCulled = false
    })
    clone.name = `gear:${id}:${slot}:rigid:${source.name}`
    target.add(clone)
    return clone
  }
}

function cloneMaterials(source: GearMesh, clones: Map<GearMaterial, GearMaterial>): GearMaterial | GearMaterial[] {
  const sourceMaterials = Array.isArray(source.material) ? source.material : [source.material]
  const result = sourceMaterials.map((material) => {
    let clone = clones.get(material)
    if (!clone) {
      clone = material.clone()
      clones.set(material, clone)
    }
    return clone
  })
  return Array.isArray(source.material) ? result : result[0]!
}

function validateBindSpace(body: THREE.SkinnedMesh, gear: THREE.SkinnedMesh): void {
  if (body.skeleton.bones.length !== gear.skeleton.bones.length
    || body.skeleton.bones.some((bone, index) => bone.name !== gear.skeleton.bones[index]?.name)) {
    throw new Error(`Gear mesh ${gear.name} does not match the approved skeleton.`)
  }
  if (body.skeleton.boneInverses.length !== gear.skeleton.boneInverses.length
    || body.skeleton.boneInverses.some((matrix, index) => !sameMatrix(matrix, gear.skeleton.boneInverses[index]))) {
    throw new Error(`Gear mesh ${gear.name} inverse binds do not match the approved body.`)
  }
  if (!sameMatrix(body.bindMatrix, gear.bindMatrix) || !sameMatrix(body.bindMatrixInverse, gear.bindMatrixInverse)) {
    throw new Error(`Gear mesh ${gear.name} bind space does not match the approved body.`)
  }
}

function emptySelection(): Record<VisualGearSlot, GearSetId | null> {
  return Object.fromEntries(VISUAL_GEAR_SLOTS.map((slot) => [slot, null])) as Record<VisualGearSlot, GearSetId | null>
}

function normalizeTint(tint: string | null): string | null {
  if (tint === null) return null
  if (!TINT_PATTERN.test(tint)) throw new Error(`Invalid gear dye tint: ${tint}.`)
  return tint.toLowerCase()
}

function sameMatrix(left: THREE.Matrix4, right: THREE.Matrix4 | undefined): boolean {
  return !!right && left.elements.every((value, index) => Number.isFinite(value)
    && Number.isFinite(right.elements[index]) && Math.abs(value - right.elements[index]!) <= MATRIX_EPSILON)
}
