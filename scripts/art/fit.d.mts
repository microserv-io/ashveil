export declare class FitError extends Error {}

export interface FitPlan {
  input: string
  family: string
  body: string
  helpers: boolean
  outdir: string
}

export declare function parseArgs(argv: string[]): Record<string, string | boolean>
export declare function resolvePlan(
  parsed: Record<string, string | boolean>,
  options?: { root?: string; exists?: (path: string) => boolean },
): FitPlan
export declare function familyContract(family: string): string
export declare function blenderArgs(plan: FitPlan, runner?: string): string[]
