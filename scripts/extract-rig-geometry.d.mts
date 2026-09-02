export type JointPositions = Record<string, [number, number, number]>

export interface ExtractedRigGeometry {
  joints: JointPositions
  optional: JointPositions
}

export declare const KAYKIT_JOINTS: Record<string, string>
export declare const KAYKIT_OPTIONAL_JOINTS: Record<string, string>
export declare const KAYKIT_STANDING_HEIGHT: number
export declare const KAYKIT_ARM_CARRY: {
  right: {
    shoulder: [number, number, number, number]
    elbow: [number, number, number, number]
    swingScale: number
  }
}
export declare function readGlb(body: Buffer): { json: unknown; bin: Buffer }
export declare function bindPosePositions(body: Buffer): JointPositions
export declare function extractRigGeometry(
  body: Buffer,
  mapping?: Record<string, string>,
  optional?: Record<string, string>,
): ExtractedRigGeometry
