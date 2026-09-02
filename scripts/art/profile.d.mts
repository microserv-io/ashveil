import type { ExtractedRigGeometry, JointPositions } from '../extract-rig-geometry.d.mts'

export interface FamilyMapping {
  required: Record<string, string>
  optional: Record<string, string>
}

export interface BodyFixture extends ExtractedRigGeometry {
  body: string
  source: string
  note: string
  armCarryNote: string
}

export declare const AXIS_TOLERANCE: number
export declare class ProfileError extends Error {}
export declare function familyMapping(contract: unknown): FamilyMapping
export declare function restCorrections(
  body: Buffer,
  mapping: Record<string, string>,
): Record<string, [number, number, number, number]>
export declare function offAxisJoints(
  corrections: Record<string, [number, number, number, number]>,
  tolerance?: number,
): string[]
export declare function bodyRole(body: string): string
export declare function generate(
  body: string,
  options?: { root?: string },
): { fixturePath: string; profilePath: string; corrections: string }
