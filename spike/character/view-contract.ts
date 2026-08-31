import {
  CURRENT_PLAYER_RUNTIME_SCALE,
  GAMEPLAY_CAMERA_OFFSET,
  NATIVE_SCALE,
} from './review-contract'

export type CameraPreset = 'gameplay' | 'front' | 'side' | 'back'
export type ScaleMode = 'native' | 'runtime'

export interface CameraPlacement {
  position: readonly [number, number, number]
  target: readonly [number, number, number]
}

export interface YawRoot {
  rotation: { y: number }
}

export function cameraPlacement(preset: CameraPreset, nativeHeight = 1.8): CameraPlacement {
  const middle = nativeHeight / 2
  const inspectionDistance = nativeHeight * 2.4
  if (preset === 'front') return { position: [0, middle, inspectionDistance], target: [0, middle, 0] }
  if (preset === 'side') return { position: [inspectionDistance, middle, 0], target: [0, middle, 0] }
  if (preset === 'back') return { position: [0, middle, -inspectionDistance], target: [0, middle, 0] }
  return { position: GAMEPLAY_CAMERA_OFFSET, target: [0, 0, 0] }
}

export function scaleForMode(mode: ScaleMode): number {
  return mode === 'runtime' ? CURRENT_PLAYER_RUNTIME_SCALE : NATIVE_SCALE
}

export function resetRootYaw(...roots: readonly (YawRoot | null | undefined)[]): void {
  for (const root of roots) {
    if (root) root.rotation.y = 0
  }
}

export function sampleTimeForFrame(
  frame: number,
  framesPerSecond: number,
  durationSeconds: number,
): number {
  if (!Number.isFinite(frame) || !Number.isFinite(framesPerSecond) || framesPerSecond <= 0) {
    throw new Error('Frame sampling requires a finite frame and positive frame rate.')
  }
  const samplingOffset = 0.1 / framesPerSecond
  const requestedTime = frame / framesPerSecond + samplingOffset
  const finalFrame = Math.round(durationSeconds * framesPerSecond)
  return frame >= finalFrame ? durationSeconds + samplingOffset : Math.min(requestedTime, durationSeconds)
}
