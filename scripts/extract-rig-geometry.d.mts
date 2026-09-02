export type JointPositions = Record<string, [number, number, number]>
export type Quaternion = [number, number, number, number]

export interface ExtractedRigGeometry {
  standingHeight: number
  armCarry: { right: { shoulder: Quaternion; elbow: Quaternion; swingScale: number } }
  joints: JointPositions
  optional: JointPositions
}

export declare const KAYKIT_JOINTS: Record<string, string>
export declare const KAYKIT_OPTIONAL_JOINTS: Record<string, string>
export declare const KAYKIT_CARRY_CLIP: string
export declare const KAYKIT_CARRY_SWING_SCALE: number
export declare function readGlb(body: Buffer): { json: unknown; bin: Buffer }
export declare function bindPoseHeight(body: Buffer): number
export declare function averageBoneRotation(body: Buffer, clip: string, bone: string): Quaternion
export declare function bindPosePositions(body: Buffer): JointPositions
export declare function extractRigGeometry(
  body: Buffer,
  mapping?: Record<string, string>,
  optional?: Record<string, string>,
): ExtractedRigGeometry
