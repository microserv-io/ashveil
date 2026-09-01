import { readFileSync } from 'node:fs'
import * as THREE from 'three'

const JSON_CHUNK = 0x4e4f534a

interface GltfNode {
  name?: string
  children?: number[]
  translation?: number[]
  rotation?: number[]
  scale?: number[]
  matrix?: number[]
}

/**
 * The bone tree `GLTFLoader` would build, without a DOM or a fetch.
 *
 * glTF nodes carry their authored TRS, and that is exactly the rest pose the
 * loader hands the renderer before any mixer runs — so a binding tested against
 * this is tested against the skeleton the browser binds against.
 */
export function loadGlbSkeleton(path: string): THREE.Object3D {
  const body = readFileSync(path)
  let offset = 12
  let json: { nodes: GltfNode[]; skins: { joints: number[] }[] } | null = null
  while (offset < body.length && !json) {
    const length = body.readUInt32LE(offset)
    if (body.readUInt32LE(offset + 4) === JSON_CHUNK) {
      json = JSON.parse(body.subarray(offset + 8, offset + 8 + length).toString('utf8').trim())
    }
    offset += 8 + length
  }
  if (!json) throw new Error(`${path} has no JSON chunk`)

  const skinned = new Set(json.skins.flatMap((skin) => skin.joints))
  const nodes = json.nodes.map((node, at) => {
    const object = skinned.has(at) ? new THREE.Bone() : new THREE.Object3D()
    object.name = node.name ?? ''
    if (node.matrix) object.applyMatrix4(new THREE.Matrix4().fromArray(node.matrix))
    if (node.translation) object.position.fromArray(node.translation)
    if (node.rotation) object.quaternion.fromArray(node.rotation)
    if (node.scale) object.scale.fromArray(node.scale)
    return object
  })

  const parented = new Set(json.nodes.flatMap((node) => node.children ?? []))
  const root = new THREE.Object3D()
  json.nodes.forEach((node, at) => {
    for (const child of node.children ?? []) nodes[at]!.add(nodes[child]!)
    if (!parented.has(at)) root.add(nodes[at]!)
  })
  root.updateMatrixWorld(true)
  return root
}
