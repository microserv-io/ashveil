import { MAP_ART_BOUNDS, MAP_SCALE, mapToWorld, worldToMap } from '../world/zone-default'
import type { CompiledZone, ZoneDefinition } from '../world/zone-types'
import type { EditorControl } from './editor-state'

export const REFERENCE_MAP_URL = new URL(
  '../../docs/art-pipeline/concepts/opening-chapter/starting-zone-map-v1.png',
  import.meta.url,
).href

const MAP_WIDTH = MAP_ART_BOUNDS.maxX - MAP_ART_BOUNDS.minX
const MAP_HEIGHT = MAP_ART_BOUNDS.maxY - MAP_ART_BOUNDS.minY

function terrainColor(height: number, water: boolean): readonly [number, number, number] {
  if (water) return [53, 103, 119]
  const light = Math.max(0, Math.min(1, (height + 8) / 72))
  return [Math.round(74 + light * 76), Math.round(91 + light * 73), Math.round(58 + light * 55)]
}

export function loadReferenceMap(): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error('The Alderbank reference map could not be loaded.'))
    image.src = REFERENCE_MAP_URL
  })
}

export function drawTerrainMap(
  canvas: HTMLCanvasElement,
  zone: CompiledZone,
  reference?: HTMLImageElement,
  referenceOpacity = 0.3,
): void {
  const width = 360
  const height = Math.round(width * MAP_HEIGHT / MAP_WIDTH)
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d')
  if (!context) return
  const pixels = context.createImageData(width, height)
  for (let row = 0; row < height; row += 1) {
    for (let column = 0; column < width; column += 1) {
      const mapX = MAP_ART_BOUNDS.minX + (column + 0.5) / width * MAP_WIDTH
      const mapY = MAP_ART_BOUNDS.minY + (row + 0.5) / height * MAP_HEIGHT
      const point = mapToWorld(mapX, mapY)
      const color = terrainColor(zone.heightAt(point.x, point.z), zone.isWaterAt(point.x, point.z))
      const offset = (row * width + column) * 4
      pixels.data[offset] = color[0]
      pixels.data[offset + 1] = color[1]
      pixels.data[offset + 2] = color[2]
      pixels.data[offset + 3] = 255
    }
  }
  context.putImageData(pixels, 0, 0)
  if (reference && referenceOpacity > 0) {
    context.globalAlpha = Math.max(0, Math.min(1, referenceOpacity))
    context.drawImage(
      reference,
      MAP_ART_BOUNDS.minX,
      MAP_ART_BOUNDS.minY,
      MAP_WIDTH,
      MAP_HEIGHT,
      0,
      0,
      width,
      height,
    )
    context.globalAlpha = 1
  }
}

function pointList(points: readonly { readonly x: number; readonly z: number }[]): string {
  return points.map((point) => {
    const mapped = worldToMap(point.x, point.z)
    return `${mapped.x},${mapped.y}`
  }).join(' ')
}

function selected(control: EditorControl | null, kind: EditorControl['kind'], id?: string, index?: number): string {
  return control?.kind === kind && ('id' in control ? control.id === id : true)
    && ('index' in control ? control.index === index : index === undefined) ? ' is-selected' : ''
}

function circle(kind: EditorControl['kind'], point: { readonly x: number; readonly z: number }, id?: string, index?: number, active?: EditorControl | null): string {
  const mapped = worldToMap(point.x, point.z)
  const idAttribute = id === undefined ? '' : ` data-id="${id}"`
  const indexAttribute = index === undefined ? '' : ` data-index="${index}"`
  const label = `${kind}${id ? ` ${id}` : ''}${index === undefined ? '' : ` point ${index + 1}`}`
  return `<circle class="map-control map-control-${kind}${selected(active ?? null, kind, id, index)}" cx="${mapped.x}" cy="${mapped.y}" r="6" tabindex="0" role="button" aria-label="${label}" data-kind="${kind}"${idAttribute}${indexAttribute}><title>${label}</title></circle>`
}

export function renderControlOverlay(svg: SVGSVGElement, definition: ZoneDefinition, active: EditorControl | null): void {
  svg.setAttribute('viewBox', `${MAP_ART_BOUNDS.minX} ${MAP_ART_BOUNDS.minY} ${MAP_WIDTH} ${MAP_HEIGHT}`)
  const paths = definition.paths.map((path) => `<polyline class="map-path" points="${pointList(path.points)}" />`).join('')
  const ridges = definition.ridges.map((ridge) => `<polyline class="map-ridge" style="stroke-width:${Math.max(8, ridge.halfWidth * 2 / MAP_SCALE)}" points="${pointList(ridge.points)}" />`).join('')
  const riverWidth = definition.river.points.reduce((sum, point) => sum + point.halfWidth, 0) / definition.river.points.length * 2 / MAP_SCALE
  const river = `<polyline class="map-river" style="stroke-width:${riverWidth}" points="${pointList(definition.river.points)}" />`
  const controls = [
    ...definition.landmarks.map((landmark) => circle('landmark', landmark, landmark.id, undefined, active)),
    ...definition.paths.flatMap((path) => path.points.slice(1, -1).map((point, index) => circle('path', point, path.id, index + 1, active))),
    ...definition.ridges.flatMap((ridge) => ridge.points.map((point, index) => circle('ridge', point, ridge.id, index, active))),
    ...definition.river.points.map((point, index) => circle('river', point, undefined, index, active)),
  ].join('')
  svg.innerHTML = `${ridges}${river}${paths}${controls}`
}

export function eventWorldPoint(svg: SVGSVGElement, event: PointerEvent): { x: number; z: number } | null {
  const transform = svg.getScreenCTM()
  if (!transform) return null
  const point = new DOMPoint(event.clientX, event.clientY).matrixTransform(transform.inverse())
  return mapToWorld(point.x, point.y)
}
