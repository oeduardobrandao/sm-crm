import type { Page } from '@playwright/test';

/**
 * Edge functions that act outside the system. Captures run against PROD, so a
 * misclick here sends a real email or publishes to a real Instagram account.
 *
 * Scheduling is deliberately treated as outward-facing: the button looks
 * harmless at click time, but instagram-publish-cron fires it later and
 * publishes for real. Scheduling a post happens via a raw PostgREST write
 * (workflow_posts), not an edge function -- see isSchedulingWrite() below.
 */
export const BLOCKED_FUNCTIONS = [
  'instagram-publish', // publishes to a real IG account
  'tiktok-publish', // schedules/publishes to a real TikTok account. The
  // schedule path (tiktok-publish/schedule/:id, services/tiktok.ts:261) is an
  // edge function, so isSchedulingWrite() -- which only inspects PostgREST
  // writes to workflow_posts -- structurally cannot see it. This function also
  // serves reads (creator-info/:clientId, tiktok.ts:248); no current capture
  // spec needs them, so the whole function is blocked. If a future spec does,
  // narrow this to BLOCKED_FUNCTION_SUBPATHS with prefix 'schedule' instead.
  'invite-user', // sends a real invite email (Resend)
  'report-worker', // sends report emails (Resend). Defense-in-depth only:
  // this function is also reached server-to-server (edge-to-edge, an
  // unawaited fetch from instagram-analytics), a hop this browser-layer net
  // cannot see regardless of this entry -- see the residual-risk note below.
  'billing-checkout', // Stripe; prod and staging share one account
  'billing-portal',
] as const;

/**
 * Functions that are otherwise legitimate -- they serve reads the capture
 * specs need, so they must NOT be blocklisted wholesale -- but have specific
 * sub-paths that trigger a real outward action. Block only the sub-path.
 */
const BLOCKED_FUNCTION_SUBPATHS: ReadonlyArray<{ fn: string; prefix: string }> = [
  // Queues a report; instagram-analytics then fires an unawaited
  // server-to-server fetch to report-worker. Blocking this browser-originated
  // first hop stops the chain before it starts.
  { fn: 'instagram-analytics', prefix: 'generate-report' },
  // Emails the ready report to the real client via Resend directly from this
  // handler -- no second hop involved, fully browser-originated.
  { fn: 'instagram-analytics', prefix: 'send-report-email' },
];

const FN_SEGMENT = /\/functions\/v1\/([^/?#]+)(?:\/([^?#]*))?/;

export function isBlockedUrl(url: string): boolean {
  const match = FN_SEGMENT.exec(url);
  if (!match) return false;
  const [, fn, subpath = ''] = match;
  if ((BLOCKED_FUNCTIONS as readonly string[]).includes(fn)) return true;
  return BLOCKED_FUNCTION_SUBPATHS.some((b) => b.fn === fn && subpath.startsWith(b.prefix));
}

const REST_TABLE_SEGMENT = /\/rest\/v1\/([^/?#]+)/;
const WRITE_METHODS = new Set(['POST', 'PATCH', 'PUT']);

/**
 * True when a PostgREST write schedules a workflow post for real publishing
 * later: a POST/PATCH/PUT to workflow_posts whose body sets
 * status = 'agendado', or sets scheduled_at to a non-null value.
 *
 * Everything else is a reversible in-app write and MUST be left alone --
 * other tables, other fields on workflow_posts, and unscheduling
 * (scheduled_at: null) all pass through untouched. This harness's capture
 * specs rely on being able to create clients, transactions, and fluxos via
 * this same REST path; blanket-blocking writes would break them.
 *
 * Matches what @supabase/postgrest-js actually sends (verified against
 * node_modules/@supabase/postgrest-js/src/PostgrestQueryBuilder.ts +
 * PostgrestBuilder.ts): `.update(p)`/`.insert(p)` issue a PATCH/POST to
 * `{SUPABASE_URL}/rest/v1/<table>` with `JSON.stringify(p)` as the body and
 * `Content-Type: application/json` -- filters like `.eq('id', id)` become
 * query params, not body fields, so the row id never needs to appear here.
 */
export function isSchedulingWrite(url: string, method: string, body: unknown): boolean {
  if (!WRITE_METHODS.has(method.toUpperCase())) return false;
  const match = REST_TABLE_SEGMENT.exec(url);
  if (!match || match[1] !== 'workflow_posts') return false;
  if (!body || typeof body !== 'object') return false;
  const patch = body as Record<string, unknown>;
  if (patch.status === 'agendado') return true;
  if (Object.prototype.hasOwnProperty.call(patch, 'scheduled_at') && patch.scheduled_at != null) {
    return true;
  }
  return false;
}

/**
 * Aborts blocked calls at the network layer.
 *
 * Routes both `**\/functions/v1/**` (blocklisted edge functions, incl.
 * path-aware sub-path blocking) and `**\/rest/v1/**` (raw PostgREST writes
 * that schedule a post -- see isSchedulingWrite()).
 *
 * Returns a live array that accumulates any blocked URL. The caller MUST pass
 * it to assertNoViolations() at the end of the test: throwing from inside a
 * route handler does NOT fail the test -- it surfaces as an unhandled
 * rejection, so the run would abort the call but still report green. A silent
 * pass is the one outcome a safety net must never have. If a spec forgets to
 * call assertNoViolations(), a blocked call is still aborted (the network
 * effect is prevented) but the test itself silently downgrades from
 * fail-loud to log-and-continue -- wiring assertNoViolations() at the end of
 * every capture spec is not optional.
 *
 * RESIDUAL RISK: this net operates at the browser network layer. It can only
 * see requests the page itself issues. It structurally cannot see
 * server-to-server chains kicked off *inside* an allowed function -- e.g.
 * instagram-analytics' unawaited fetch to report-worker never crosses
 * page.route, and blocklisting report-worker's own function name does not
 * help. There may be other instances of this shape we haven't found. This
 * net is a backstop for mistakes, not a guarantee against every consequence
 * of clicking the wrong control -- Control 1 for capture-spec authors
 * remains: never click the destructive control (schedule/publish/send/pay)
 * on a production workspace, net or no net.
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

  await page.route('**/rest/v1/**', async (route) => {
    const request = route.request();
    const url = request.url();
    const method = request.method();
    let body: unknown = null;
    if (WRITE_METHODS.has(method.toUpperCase())) {
      try {
        body = request.postDataJSON();
      } catch {
        body = null;
      }
    }
    if (isSchedulingWrite(url, method, body)) {
      violations.push(url);
      // eslint-disable-next-line no-console
      console.error(`[safety] BLOCKED scheduling write: ${method} ${url}`);
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
