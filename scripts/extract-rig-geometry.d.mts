export type JointPositions = Record<string, [number, number, number]>
export interface ExtractedRigGeometry {
  standingHeight: number
  footprint: { heel: number; toe: number; lift: number; pitch: number }
  joints: JointPositions
  optional: JointPositions
}
export declare function readGlb(body: Buffer): { json: unknown; bin: Buffer }
export declare function bindPoseHeight(body: Buffer): number
export declare function bindPosePositions(body: Buffer): JointPositions
export declare function extractRigGeometry(
  body: Buffer,
  mapping: Record<string, string>,
  optional?: Record<string, string>,
): ExtractedRigGeometry
