import '../../src/style.css'
import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'

interface TextureCandidate {
  readonly id: string
  readonly label: string
  readonly file: string
  readonly dimensions: readonly [number, number]
  readonly colorSpace: 'srgb'
  readonly maps: readonly ['albedo']
  readonly surface: { readonly metalness: number; readonly roughness: number }
  readonly physicalRepeatMetres: number
  readonly status: 'candidate'
}

interface TextureManifest {
  readonly version: number
  readonly candidates: readonly TextureCandidate[]
}

const stage = element('stage')
const status = element('status')
const materialSelect = element<HTMLSelectElement>('material')
const repeatSlider = element<HTMLInputElement>('repeat')
const repeatValue = element('repeat-value')
const wireframe = element<HTMLInputElement>('wireframe')
const seams = element<HTMLInputElement>('seams')
const physicalScale = element('physical-scale')
const downloads = element('downloads')
const errorPanel = element('error')
const textureRoot = import.meta.env.BASE_URL

const renderer = new THREE.WebGLRenderer({ antialias: true })
renderer.setPixelRatio(Math.min(devicePixelRatio, 2))
renderer.setSize(innerWidth, innerHeight)
renderer.outputColorSpace = THREE.SRGBColorSpace
renderer.toneMapping = THREE.ACESFilmicToneMapping
renderer.toneMappingExposure = 1.05
stage.append(renderer.domElement)

const scene = new THREE.Scene()
scene.background = new THREE.Color(0x0b0d12)
scene.fog = new THREE.Fog(0x0b0d12, 15, 34)

const camera = new THREE.PerspectiveCamera(38, innerWidth / innerHeight, 0.1, 80)
camera.position.set(10, 9, 14)
const controls = new OrbitControls(camera, renderer.domElement)
controls.target.set(0, 0.7, -0.5)
controls.enableDamping = true
controls.minDistance = 5
controls.maxDistance = 28
controls.maxPolarAngle = Math.PI * 0.49

scene.add(new THREE.HemisphereLight(0xe8e0cb, 0x252a2a, 2.2))
const key = new THREE.DirectionalLight(0xffefe0, 3.6)
key.position.set(-6, 10, 5)
scene.add(key)
const rim = new THREE.DirectionalLight(0x829b89, 1.7)
rim.position.set(7, 5, -6)
scene.add(rim)

const base = new THREE.Mesh(
  new THREE.CylinderGeometry(6.4, 6.8, 0.32, 64),
  new THREE.MeshStandardMaterial({ color: 0x171a1c, roughness: 0.82, metalness: 0 }),
)
base.position.set(0, -0.22, -0.6)
scene.add(base)

const ownedTextures: THREE.Texture[] = []
const ownedMaterials: THREE.Material[] = [base.material]
const ownedGeometries: THREE.BufferGeometry[] = [base.geometry]
const selectedMaterials: THREE.MeshStandardMaterial[] = []
let repeat = 3

try {
  const manifest = await loadManifest()
  const textures = await loadTextures(manifest.candidates)
  buildStudy(manifest.candidates, textures)
  buildControls(manifest.candidates)
  selectCandidate(manifest.candidates[0]!)
  status.textContent = 'Ready · four 1254 × 1254 candidates'
} catch (error) {
  const message = error instanceof Error ? error.message : String(error)
  status.textContent = 'Texture load failed'
  errorPanel.textContent = `Could not open this review set. ${message}`
  errorPanel.classList.remove('hidden')
}

addEventListener('resize', resize)
addEventListener('beforeunload', dispose)
renderer.setAnimationLoop(render)

async function loadManifest(): Promise<TextureManifest> {
  const url = `${textureRoot}manifest.json`
  const response = await fetch(url)
  if (!response.ok) throw new Error(`Manifest returned ${response.status}.`)
  return validateManifest(await response.json())
}

async function loadTextures(candidates: readonly TextureCandidate[]): Promise<Map<string, THREE.Texture>> {
  const loader = new THREE.TextureLoader()
  const entries = await Promise.all(
    candidates.map(async (candidate) => {
      const url = `${textureRoot}${candidate.file}`
      let texture: THREE.Texture
      try {
        texture = await loader.loadAsync(url)
      } catch {
        throw new Error(`Failed to load ${candidate.label} from ${url}.`)
      }
      texture.colorSpace = THREE.SRGBColorSpace
      texture.name = candidate.id
      texture.wrapS = THREE.MirroredRepeatWrapping
      texture.wrapT = THREE.MirroredRepeatWrapping
      texture.anisotropy = renderer.capabilities.getMaxAnisotropy()
      ownedTextures.push(texture)
      return [candidate.id, texture] as const
    }),
  )
  return new Map(entries)
}

function validateManifest(value: unknown): TextureManifest {
  if (!value || typeof value !== 'object') throw new Error('Manifest is not an object.')
  const manifest = value as Partial<TextureManifest>
  if (manifest.version !== 1 || !Array.isArray(manifest.candidates) || manifest.candidates.length !== 4) {
    throw new Error('Manifest must contain exactly four version 1 candidates.')
  }
  for (const candidate of manifest.candidates) {
    const surface = candidate?.surface
    if (
      !candidate || typeof candidate.id !== 'string' || typeof candidate.label !== 'string' ||
      typeof candidate.file !== 'string' || !candidate.file.endsWith('.png') || candidate.file.includes('/') ||
      candidate.colorSpace !== 'srgb' || candidate.status !== 'candidate' ||
      candidate.maps?.length !== 1 || candidate.maps[0] !== 'albedo' ||
      !surface || !Number.isFinite(surface.metalness) || !Number.isFinite(surface.roughness) ||
      !Number.isFinite(candidate.physicalRepeatMetres) || candidate.physicalRepeatMetres <= 0
    ) {
      throw new Error(`Manifest candidate ${candidate?.id ?? '(unknown)'} is invalid.`)
    }
  }
  return manifest as TextureManifest
}

function buildStudy(candidates: readonly TextureCandidate[], textures: ReadonlyMap<string, THREE.Texture>): void {
  const swatchGeometry = new THREE.PlaneGeometry(2.6, 2.6)
  ownedGeometries.push(swatchGeometry)
  const swatchGroup = new THREE.Group()
  swatchGroup.position.set(0, 0.02, 2.15)

  candidates.forEach((candidate, index) => {
    const map = cloneTexture(textures.get(candidate.id)!, 3)
    const material = makeMaterial(candidate, map)
    const swatch = new THREE.Mesh(swatchGeometry, material)
    swatch.rotation.x = -Math.PI / 2
    swatch.position.x = (index - 1.5) * 2.85
    swatchGroup.add(swatch)
  })
  scene.add(swatchGroup)

  const sphereGeometry = new THREE.SphereGeometry(1.55, 64, 40)
  const planeGeometry = new THREE.PlaneGeometry(3.2, 3.2, 3, 3)
  ownedGeometries.push(sphereGeometry, planeGeometry)
  const sphere = new THREE.Mesh(sphereGeometry, new THREE.MeshStandardMaterial())
  sphere.position.set(-2.2, 1.55, -2.3)
  sphere.name = 'selected-sphere'
  const plane = new THREE.Mesh(planeGeometry, new THREE.MeshStandardMaterial())
  plane.position.set(2.1, 1.65, -2.5)
  plane.rotation.y = -0.18
  plane.name = 'selected-plane'
  scene.add(sphere, plane)
}

function buildControls(candidates: readonly TextureCandidate[]): void {
  for (const candidate of candidates) {
    const option = document.createElement('option')
    option.value = candidate.id
    option.textContent = candidate.label
    materialSelect.append(option)

    const link = document.createElement('a')
    link.href = `${textureRoot}${candidate.file}`
    link.download = candidate.file
    link.textContent = candidate.label
    link.className = 'rounded border border-ash-600 bg-ash-700 px-2 py-1.5 text-center text-[11px] text-ash-100 hover:border-ember'
    downloads.append(link)
  }

  materialSelect.addEventListener('change', () => {
    const candidate = candidates.find(({ id }) => id === materialSelect.value)
    if (candidate) selectCandidate(candidate)
  })
  repeatSlider.addEventListener('input', () => setRepeat(Number(repeatSlider.value)))
  for (const button of document.querySelectorAll<HTMLButtonElement>('[data-repeat]')) {
    button.addEventListener('click', () => setRepeat(Number(button.dataset.repeat)))
  }
  wireframe.addEventListener('change', () => {
    for (const material of selectedMaterials) material.wireframe = wireframe.checked
  })
  seams.addEventListener('change', updateWrapping)
}

function selectCandidate(candidate: TextureCandidate): void {
  const source = ownedTextures.find((texture) => texture.name === candidate.id)
  if (!source) return
  for (const material of selectedMaterials) {
    material.map?.dispose()
    material.dispose()
  }
  selectedMaterials.length = 0

  for (const objectName of ['selected-sphere', 'selected-plane']) {
    const mesh = scene.getObjectByName(objectName) as THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>
    const material = makeMaterial(candidate, cloneTexture(source, repeat))
    material.wireframe = wireframe.checked
    mesh.material.dispose()
    mesh.material = material
    selectedMaterials.push(material)
  }
  materialSelect.value = candidate.id
  physicalScale.textContent = `${candidate.physicalRepeatMetres} m / repeat (suggested)`
}

function makeMaterial(candidate: TextureCandidate, map: THREE.Texture): THREE.MeshStandardMaterial {
  const material = new THREE.MeshStandardMaterial({
    map,
    metalness: candidate.surface.metalness,
    roughness: candidate.surface.roughness,
  })
  ownedMaterials.push(material)
  return material
}

function cloneTexture(source: THREE.Texture, textureRepeat: number): THREE.Texture {
  const texture = source.clone()
  texture.needsUpdate = true
  texture.repeat.set(textureRepeat, textureRepeat)
  ownedTextures.push(texture)
  return texture
}

function setRepeat(next: number): void {
  repeat = next
  repeatSlider.value = String(next)
  repeatValue.textContent = `${next} × ${next}`
  for (const material of selectedMaterials) material.map?.repeat.set(next, next)
  for (const button of document.querySelectorAll<HTMLButtonElement>('[data-repeat]')) {
    const active = Number(button.dataset.repeat) === next
    button.classList.toggle('border-ember', active)
    button.classList.toggle('bg-ember/15', active)
    button.classList.toggle('border-ash-600', !active)
    button.classList.toggle('bg-ash-700', !active)
  }
}

function updateWrapping(): void {
  const wrapping = seams.checked ? THREE.RepeatWrapping : THREE.MirroredRepeatWrapping
  for (const material of selectedMaterials) {
    if (!material.map) continue
    material.map.wrapS = wrapping
    material.map.wrapT = wrapping
    material.map.needsUpdate = true
  }
  status.textContent = seams.checked
    ? 'Ordinary repeat · raw edge joins exposed'
    : 'Mirrored repeat · candidate review mode'
}

function render(): void {
  controls.update()
  renderer.render(scene, camera)
}

function resize(): void {
  camera.aspect = innerWidth / innerHeight
  camera.updateProjectionMatrix()
  renderer.setSize(innerWidth, innerHeight)
}

function dispose(): void {
  renderer.setAnimationLoop(null)
  removeEventListener('resize', resize)
  controls.dispose()
  for (const texture of new Set(ownedTextures)) texture.dispose()
  for (const material of new Set(ownedMaterials)) material.dispose()
  for (const geometry of new Set(ownedGeometries)) geometry.dispose()
  renderer.dispose()
}

function element<T extends HTMLElement = HTMLElement>(id: string): T {
  const found = document.getElementById(id)
  if (!found) throw new Error(`Missing #${id}`)
  return found as T
}
