import type { Page } from '@playwright/test';

/**
 * Edge functions that act outside the system. Captures run against PROD, so a
 * misclick here sends a real email or publishes to a real Instagram account.
 *
 * Scheduling is deliberately treated as outward-facing: the button looks
 * harmless at click time, but instagram-publish-cron fires it later and
 * publishes for real.
 */
export const BLOCKED_FUNCTIONS = [
  'instagram-publish', // publishes to a real IG account
  'invite-user', // sends a real invite email (Resend)
  'report-worker', // sends report emails (Resend)
  'billing-checkout', // Stripe; prod and staging share one account
  'billing-portal',
] as const;

const FN_SEGMENT = /\/functions\/v1\/([^/?#]+)/;

export function isBlockedUrl(url: string): boolean {
  const match = FN_SEGMENT.exec(url);
  if (!match) return false;
  return (BLOCKED_FUNCTIONS as readonly string[]).includes(match[1]);
}

/**
 * Aborts blocked calls at the network layer.
 *
 * Returns a live array that accumulates any blocked URL. The caller MUST pass
 * it to assertNoViolations() at the end of the test: throwing from inside a
 * route handler does NOT fail the test -- it surfaces as an unhandled
 * rejection, so the run would abort the call but still report green. A silent
 * pass is the one outcome a safety net must never have.
 */
export async function installSafetyNet(page: Page): Promise<string[]> {
  const violations: string[] = [];

  await page.route('**/functions/v1/**', async (route) => {
    const url = route.request().url();
    if (isBlockedUrl(url)) {
      violations.push(url);
      // eslint-disable-next-line no-console
      console.error(`[safety] BLOCKED outward-facing call: ${url}`);
      await route.abort('blockedbyclient');
      return;
    }
    await route.continue();
  });

  return violations;
}

/** Fails the test if the capture attempted any outward-facing call. */
export function assertNoViolations(violations: string[]): void {
  if (violations.length > 0) {
    throw new Error(
      `Capture attempted ${violations.length} blocked outward-facing call(s):\n` +
        violations.map((v) => `  - ${v}`).join('\n'),
    );
  }
}
