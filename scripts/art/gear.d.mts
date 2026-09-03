export declare class GearError extends Error {}

export interface GearPlan {
  input: string
  slot: string
  body: string
  piece: string
  weights?: 'transfer' | 'rigid'
  covers: string[]
  span?: string
  yaw?: '0' | '180'
  noMask: boolean
  outdir: string
}

export declare function parseArgs(argv: string[]): Record<string, string | boolean>
export declare function resolvePlan(
  parsed: Record<string, string | boolean>,
  options?: { root?: string; exists?: (path: string) => boolean },
): GearPlan
export declare function blenderArgs(plan: GearPlan, runner?: string): string[]
export declare function run(plan: GearPlan): number
export declare function mergeClip(plan: GearPlan, gates: Record<string, boolean>): void
