/**
 * Loops REST client. Pure I/O: no candidate selection, no ledger writes.
 *
 * Every call is bounded by AbortSignal.timeout — the edge runtime kills isolates
 * on unbounded I/O in ways that bypass catch entirely (documented repo failure
 * mode), and a hang must surface as a normal retryable throw instead.
 */

const BASE = "https://app.loops.so/api/v1";

function apiKey(): string {
  const key = Deno.env.get("LOOPS_API_KEY");
  if (!key) throw new Error("LOOPS_API_KEY not configured");
  return key;
}

async function post(
  path: string,
  body: unknown,
  opts: { idempotencyKey?: string; okStatuses?: number[] },
  fetchImpl: typeof fetch,
): Promise<Response> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${apiKey()}`,
    "Content-Type": "application/json",
  };
  if (opts.idempotencyKey) headers["Idempotency-Key"] = opts.idempotencyKey;

  const res = await fetchImpl(`${BASE}${path}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10_000),
  });
  if (res.ok || (opts.okStatuses ?? []).includes(res.status)) return res;
  // Status only. Loops error bodies can echo the contact's email, and this
  // message reaches cron_failures.
  throw new Error(`Loops ${path} failed: ${res.status}`);
}

/**
 * Upsert a contact. Loops keys contacts by email and expects custom properties
 * flattened alongside `email`, not nested.
 */
export async function updateContact(
  p: { email: string; traits: Record<string, unknown> },
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  await post("/contacts/update", { email: p.email, ...p.traits }, {}, fetchImpl);
}

/**
 * Remove a contact. 404 means "already absent", which IS the goal state — the
 * revocation sweep would otherwise retry an unresolvable delete to the cap.
 * Deletes by email (not userId) so a post-email-change or post-account-deletion
 * cleanup can still target the old address recorded in loops_contacts.
 */
export async function deleteContact(
  p: { email: string },
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  await post("/contacts/delete", { email: p.email }, { okStatuses: [404] }, fetchImpl);
}

/**
 * Fire a trigger event. 409 means this Idempotency-Key was already accepted
 * within Loops' 24h window: the event happened, so this is success and the
 * caller marks the claim delivered. Mirrors the Resend 409 branch in
 * _shared/lifecycle-emails.ts.
 */
export async function sendEvent(
  p: {
    email: string;
    eventName: string;
    properties: Record<string, unknown>;
    idempotencyKey: string;
  },
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  await post(
    "/events/send",
    { email: p.email, eventName: p.eventName, eventProperties: p.properties },
    { idempotencyKey: p.idempotencyKey, okStatuses: [409] },
    fetchImpl,
  );
}
