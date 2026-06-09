import { describe, it, expect } from 'vitest';
import { gather } from './gather.mjs';

describe('gather', () => {
  it('includes the cron index + its resolved _shared imports', () => {
    const r = gather('instagram-refresh-cron');
    const paths = r.files.map((f) => f.path);
    expect(paths.some((p) => p.endsWith('instagram-refresh-cron/index.ts'))).toBe(true);
    // index.ts -> ../_shared/triage.ts (direct) -> ./notify.ts (transitive)
    expect(paths.some((p) => p.endsWith('_shared/triage.ts'))).toBe(true);
    expect(paths.some((p) => p.endsWith('_shared/notify.ts'))).toBe(true); // transitive BFS
    expect(r.cronName).toBe('instagram-refresh-cron');
  });
  it('caps total size', () => {
    const r = gather('instagram-refresh-cron', 500);
    const total = r.files.reduce((n, f) => n + f.content.length, 0);
    expect(total).toBeLessThanOrEqual(600); // cap + small truncation-marker slack
  });
});
