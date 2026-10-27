import type { DownscalePlan, DownscaleResult, DownscaleSupport } from './downscalePlan';

export type { DownscaleEngine, DownscaleSupport, DownscaleResult } from './downscalePlan';

// Stub: Task 2 replaces the bodies.
export async function inspectForDownscale(
  _file: File,
  _plan: DownscalePlan,
): Promise<DownscaleSupport> {
  throw new Error('not implemented');
}

export async function downscaleVideo(
  _file: File,
  _plan: DownscalePlan,
  _opts: { forStories: boolean; signal: AbortSignal; onProgress: (pct: number) => void },
): Promise<DownscaleResult> {
  throw new Error('not implemented');
}
