export interface PerfOptions {
  record: boolean
  keepOpen: boolean
  seed: number
  frames: number
  motion: 'clip' | 'procedural'
}

export declare function parsePerfOptions(argv: readonly string[]): PerfOptions
export declare function comparePerfReports(
  report: unknown,
  baseline: unknown,
): { failures: string[]; notes: string[] }
