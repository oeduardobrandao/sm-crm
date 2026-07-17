import { describe, it, expect } from 'vitest';
import { isBlockedUrl, BLOCKED_FUNCTIONS, assertNoViolations } from '../safety';

const FN = 'https://xyz.supabase.co/functions/v1';

describe('capture safety net', () => {
  it('blocks outward-facing edge functions', () => {
    expect(isBlockedUrl(`${FN}/instagram-publish`)).toBe(true);
    expect(isBlockedUrl(`${FN}/invite-user`)).toBe(true);
    expect(isBlockedUrl(`${FN}/billing-checkout`)).toBe(true);
    expect(isBlockedUrl(`${FN}/billing-portal`)).toBe(true);
    expect(isBlockedUrl(`${FN}/report-worker`)).toBe(true);
  });

  it('allows read paths needed for screenshots', () => {
    expect(isBlockedUrl(`${FN}/sign-r2-urls`)).toBe(false);
    expect(isBlockedUrl(`${FN}/hub-dashboard`)).toBe(false);
    expect(isBlockedUrl('https://xyz.supabase.co/rest/v1/clientes?select=*')).toBe(false);
  });

  it('does not blocklist by loose substring', () => {
    // instagram-publish-cron is cron-only and never called from the browser,
    // but a substring matcher would also catch e.g. a future
    // "instagram-publish-preview" read endpoint. Match the segment exactly.
    expect(isBlockedUrl(`${FN}/instagram-published-posts`)).toBe(false);
  });

  it('exposes the blocked list for documentation', () => {
    expect(BLOCKED_FUNCTIONS).toContain('instagram-publish');
  });

  it('assertNoViolations throws when a blocked call was attempted', () => {
    expect(() => assertNoViolations([`${FN}/instagram-publish`])).toThrow(/instagram-publish/);
  });

  it('assertNoViolations passes on a clean run', () => {
    expect(() => assertNoViolations([])).not.toThrow();
  });
});
