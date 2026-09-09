export function gearMotionReviewEnabled(development: boolean, search: string): boolean {
  return development && new URLSearchParams(search).get('gearReview') === '1'
}

export type GearReviewCameraPreset = 'front' | 'back' | 'left' | 'right'

export function gearReviewCameraYaw(preset: GearReviewCameraPreset, facing: number): number {
  const offset: Record<GearReviewCameraPreset, number> = {
    front: 0,
    back: Math.PI,
    left: -Math.PI / 2,
    right: Math.PI / 2,
  }
  return facing + offset[preset]
}

export function cameraMinimumDistance(gearReview: boolean): number {
  return gearReview ? 2.3 : 4.8
}

export function cameraTargetHeight(gearReview: boolean): number {
  return gearReview ? 0.95 : 1.35
}
