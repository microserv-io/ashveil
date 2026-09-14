import * as THREE from 'three'

export interface NpcPickCandidate {
  readonly id: string
  readonly name: string
  readonly root: THREE.Object3D
}

export interface PickedNpc {
  readonly id: string
  readonly name: string
}

export function pickNpcFromCamera(
  camera: THREE.Camera,
  pointer: THREE.Vector2,
  candidates: readonly NpcPickCandidate[],
  blockers: readonly THREE.Object3D[],
): PickedNpc | null {
  const raycaster = new THREE.Raycaster()
  raycaster.setFromCamera(pointer, camera)
  return pickNpc(raycaster, candidates, blockers)
}

export function pickNpc(
  raycaster: THREE.Raycaster,
  candidates: readonly NpcPickCandidate[],
  blockers: readonly THREE.Object3D[],
): PickedNpc | null {
  const visibleCandidates = candidates.filter((candidate) => candidate.root.visible)
  const roots = [...visibleCandidates.map((candidate) => candidate.root), ...blockers.filter((blocker) => blocker.visible)]
  const hits = raycaster.intersectObjects(roots, true)
  for (const hit of hits) {
    if (!isVisibleHit(hit.object)) continue
    const candidate = visibleCandidates.find((item) => contains(item.root, hit.object))
    if (candidate) return { id: candidate.id, name: candidate.name }
    if (blockers.some((blocker) => contains(blocker, hit.object))) return null
  }
  return null
}

function isVisibleHit(object: THREE.Object3D): boolean {
  for (let current: THREE.Object3D | null = object; current; current = current.parent) {
    if (!current.visible) return false
  }
  if (!(object instanceof THREE.Mesh)) return true
  const materials = Array.isArray(object.material) ? object.material : [object.material]
  return materials.some((material) => material.visible)
}

function contains(root: THREE.Object3D, object: THREE.Object3D): boolean {
  for (let current: THREE.Object3D | null = object; current; current = current.parent) {
    if (current === root) return true
  }
  return false
}
