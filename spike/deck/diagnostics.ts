import * as THREE from 'three'
import { areaRng, generateArea } from '../../src/sim/mapgen'
import { SceneHost } from '../../src/render/scene'
import { profileFor } from '../../src/render/profiles'

/**
 * Answers whether a given shell can actually run this game on a Steam Deck. It
 * exercises the real render stack rather than a synthetic benchmark, because the
 * question is not "does WebGL exist" but "does *our* scene hold frame rate in
 * *this* webview".
 *
 * Shell-agnostic on purpose: the same suite runs in a browser, in Tauri
 * (WebKitGTK) and in Electron (Chromium), which is what makes the comparison fair.
 */

export interface DiagnosticsReport {
  verdict: 'pass' | 'degraded' | 'fail'
  failures: string[]
  shell: string
  userAgent: string
  webgl: {
    version: 2 | 1 | 0
    vendor: string
    renderer: string
    /** llvmpipe/swiftshader here means software rasterisation: unplayable. */
    softwareRasterised: boolean
    maxTextureSize: number
    instancedArrays: boolean
  }
  performance: {
    seconds: number
    frames: number
    averageFps: number
    /** The number that decides whether it feels smooth. */
    onePercentLowFps: number
    worstFrameMs: number
    drawCalls: number
    triangles: number
  }
  gamepads: {
    id: string
    mapping: string
    buttons: number
    axes: number
    profile: string
    /** True when the device reports the Deck's grips and pads rather than a virtual pad. */
    exposesExtras: boolean
  }[]
  memoryMb: number | null
}

const MEASURE_SECONDS = 10
/** Anything under this is not shippable for an action game. */
const MIN_ONE_PERCENT_LOW = 45
const MIN_AVERAGE = 55

export async function runDiagnostics(mount: HTMLElement, shell: string): Promise<DiagnosticsReport> {
  const failures: string[] = []
  const webgl = probeWebgl()
  if (webgl.version === 0) failures.push('no WebGL context at all')
  if (webgl.softwareRasterised) failures.push(`software rasteriser (${webgl.renderer}) — no GPU acceleration`)
  if (!webgl.instancedArrays) failures.push('no instanced arrays; terrain rendering needs them')

  const performance = await measureScene(mount)
  if (performance.averageFps < MIN_AVERAGE) failures.push(`average ${performance.averageFps}fps below ${MIN_AVERAGE}`)
  if (performance.onePercentLowFps < MIN_ONE_PERCENT_LOW) {
    failures.push(`1% low ${performance.onePercentLowFps}fps below ${MIN_ONE_PERCENT_LOW}`)
  }

  const gamepads = probeGamepads()

  return {
    verdict: failures.length === 0 ? 'pass' : webgl.version === 0 || webgl.softwareRasterised ? 'fail' : 'degraded',
    failures,
    shell,
    userAgent: navigator.userAgent,
    webgl,
    performance,
    gamepads,
    memoryMb: readMemoryMb(),
  }
}

function probeWebgl(): DiagnosticsReport['webgl'] {
  const canvas = document.createElement('canvas')
  const gl2 = canvas.getContext('webgl2')
  const gl = gl2 ?? canvas.getContext('webgl')
  if (!gl) {
    return {
      version: 0,
      vendor: 'none',
      renderer: 'none',
      softwareRasterised: true,
      maxTextureSize: 0,
      instancedArrays: false,
    }
  }

  const debugInfo = gl.getExtension('WEBGL_debug_renderer_info')
  const renderer = String(debugInfo ? gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER))
  const vendor = String(debugInfo ? gl.getParameter(debugInfo.UNMASKED_VENDOR_WEBGL) : gl.getParameter(gl.VENDOR))

  return {
    version: gl2 ? 2 : 1,
    vendor,
    renderer,
    // The Deck's GPU is a Van Gogh RDNA2; anything naming a CPU rasteriser means
    // the webview never reached it.
    softwareRasterised: /llvmpipe|swiftshader|softpipe|software/i.test(renderer),
    maxTextureSize: gl.getParameter(gl.MAX_TEXTURE_SIZE) as number,
    instancedArrays: gl2 !== null || gl.getExtension('ANGLE_instanced_arrays') !== null,
  }
}

/**
 * The real scene: instanced terrain from the real generator, a crowd of bodies,
 * shadows and point lights. A spinning cube would prove nothing.
 */
async function measureScene(mount: HTMLElement): Promise<DiagnosticsReport['performance']> {
  const host = new SceneHost(mount)
  const { map } = generateArea(areaRng(7, 3), 3)
  host.buildTerrain(map)

  const bodies: THREE.Mesh[] = []
  const geometry = new THREE.CapsuleGeometry(0.44, 0.85, 6, 14)
  for (let i = 0; i < 60; i++) {
    const mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ color: 0x8a5240 }))
    mesh.castShadow = true
    mesh.position.set(map.spawn.x + (i % 10) * 1.2 - 6, 0.8, map.spawn.y + Math.floor(i / 10) * 1.2 - 3)
    host.scene.add(mesh)
    bodies.push(mesh)
  }
  // Emissive point lights are the most expensive thing the game does per frame.
  for (let i = 0; i < 4; i++) {
    const light = new THREE.PointLight(0xf26a1f, 4, 10, 2)
    light.position.set(map.spawn.x + i * 2, 1.5, map.spawn.y)
    host.scene.add(light)
  }

  const frameTimes: number[] = []
  const start = performance.now()
  let previous = start
  let angle = 0

  await new Promise<void>((resolve) => {
    // A backgrounded or occluded window has rAF throttled to ~1fps or suspended
    // outright. Without this the suite hangs instead of reporting, which is
    // exactly the wrong behaviour when it is being driven over SSH.
    const bail = setTimeout(() => resolve(), MEASURE_SECONDS * 1000 + 5000)
    function frame(): void {
      const now = performance.now()
      frameTimes.push(now - previous)
      previous = now

      angle += 0.01
      for (const [index, body] of bodies.entries()) {
        body.position.y = 0.8 + Math.sin(angle * 2 + index) * 0.15
      }
      host.followPlayer({ x: map.spawn.x + Math.cos(angle) * 3, y: map.spawn.y + Math.sin(angle) * 3 }, 1 / 60)
      host.render()

      if (now - start < MEASURE_SECONDS * 1000) requestAnimationFrame(frame)
      else {
        clearTimeout(bail)
        resolve()
      }
    }
    requestAnimationFrame(frame)
  })

  // Discard the first second: shader compilation and texture upload are not the
  // steady state a player experiences.
  const settled = frameTimes.slice(60)
  if (settled.length < 30) {
    return {
      seconds: MEASURE_SECONDS,
      frames: settled.length,
      averageFps: 0,
      onePercentLowFps: 0,
      worstFrameMs: 0,
      drawCalls: 0,
      triangles: 0,
    }
  }
  const sorted = [...settled].sort((a, b) => a - b)
  const onePercentIndex = Math.max(0, Math.floor(sorted.length * 0.99) - 1)
  const total = settled.reduce((sum, value) => sum + value, 0)

  const info = host.renderer.info.render
  const report = {
    seconds: MEASURE_SECONDS,
    frames: settled.length,
    averageFps: round(1000 / (total / settled.length)),
    onePercentLowFps: round(1000 / (sorted[onePercentIndex] ?? 1)),
    worstFrameMs: round(sorted[sorted.length - 1] ?? 0),
    drawCalls: info.calls,
    triangles: info.triangles,
  }

  host.renderer.dispose()
  mount.innerHTML = ''
  return report
}

/**
 * Also settles the question left open when the gamepad profiles were written: does
 * a Deck report its grips and trackpads, or the 17-button virtual pad Steam Input
 * presents? Only real hardware can answer it.
 */
function probeGamepads(): DiagnosticsReport['gamepads'] {
  const pads = navigator.getGamepads?.() ?? []
  const out: DiagnosticsReport['gamepads'] = []
  for (const pad of pads) {
    if (!pad) continue
    out.push({
      id: pad.id,
      mapping: pad.mapping,
      buttons: pad.buttons.length,
      axes: pad.axes.length,
      profile: profileFor(pad).id,
      exposesExtras: pad.buttons.length > 17 || pad.axes.length > 4,
    })
  }
  return out
}

function readMemoryMb(): number | null {
  const memory = (performance as { memory?: { usedJSHeapSize: number } }).memory
  return memory ? Math.round(memory.usedJSHeapSize / 1024 / 1024) : null
}

function round(value: number): number {
  return Math.round(value * 10) / 10
}

export function formatReport(report: DiagnosticsReport): string {
  const lines = [
    `verdict            ${report.verdict.toUpperCase()}`,
    `shell              ${report.shell}`,
    `webgl              v${report.webgl.version} ${report.webgl.renderer}`,
    `software raster    ${report.webgl.softwareRasterised ? 'YES — unplayable' : 'no'}`,
    `average fps        ${report.performance.averageFps}`,
    `1% low fps         ${report.performance.onePercentLowFps}`,
    `worst frame        ${report.performance.worstFrameMs}ms`,
    `draw calls / tris  ${report.performance.drawCalls} / ${report.performance.triangles}`,
    `memory             ${report.memoryMb === null ? 'n/a' : `${report.memoryMb}MB`}`,
  ]
  for (const pad of report.gamepads) {
    lines.push(`gamepad            ${pad.id} — ${pad.buttons}b/${pad.axes}a, profile ${pad.profile}, extras ${pad.exposesExtras}`)
  }
  if (report.gamepads.length === 0) lines.push('gamepad            none detected')
  for (const failure of report.failures) lines.push(`FAIL               ${failure}`)
  return lines.join('\n')
}
