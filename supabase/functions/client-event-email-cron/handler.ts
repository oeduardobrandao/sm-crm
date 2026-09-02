/**
 * client-event-email-cron: client-facing "pendências do Hub" digest email --
 * pending post approvals + unread messages, sent to the client's own email.
 *
 * Two layers, mirroring the repo's existing cron shapes (notification-email-cron):
 *  - `createClientEventEmailCronHandler`: thin auth wrapper, checks
 *    `x-cron-secret` BEFORE any work and delegates to `run`.
 *  - `runClientEventEmailCron`: dependency-injected business logic, testable
 *    without a network or a real database.
 *
 * Claim-first semantics via ONE atomic `claim_client_event_emails` RPC
 * (Task 1's migration): the SQL does the workspace-toggle / client-opt-out /
 * active-status / plan-entitlement / cursor-age / lease-age filter, orders
 * by `event_claimed_at ASC NULLS FIRST` (never-attempted clients first, then
 * whoever was attempted longest ago -- fair rotation instead of always
 * re-offering the same head of a NULL-cursor queue), and does the
 * `FOR UPDATE SKIP LOCKED` claim, all in one statement capped at
 * CLAIM_BATCH_SIZE. `event_claim_through` is a LEASE, separate from
 * `event_cursor_at` (the point this client's content was actually delivered
 * up to): the RPC always sets BOTH the lease and `event_claimed_at` (the
 * "last attempt" marker) so this handler can compute a stable per-run
 * window, but the cursor only advances after a successful send. Any other
 * outcome (empty content, no Hub link, send failure, a post-send bookkeeping
 * failure) clears ONLY the lease (`event_claim_through`) and leaves both the
 * cursor AND `event_claimed_at` exactly where they were -- the cursor so the
 * same window (or a superset, once GREATEST'd against now()-72h) gets
 * retried, and `event_claimed_at` so the claim RPC's own 30-minute gate
 * becomes a natural backoff for a client that keeps coming up empty, instead
 * of that client being re-claimed and re-queried every 15 minutes forever.
 * A retry after an already-sent email is safe regardless: the idempotency
 * key is deterministic over the exact content set, so Resend dedupes (409)
 * rather than sending twice.
 *
 * Window per client: `(GREATEST(event_cursor_at, now-72h), event_claim_through]`.
 * The 72h floor applies unconditionally -- a client with a NULL cursor (never
 * emailed) or a very old one (rejoined after a long opt-out) never gets a
 * multi-day backlog dumped on them.
 *
 * supabase-js has no DISTINCT ON, so post approvals are deduped over an
 * ordered (created_at ASC, id ASC tiebreak) result in TS: iterating oldest
 * to newest and simply overwriting a Map keyed by post_id leaves the LATEST
 * transition per post once the loop ends -- no "skip if seen" bookkeeping
 * needed. Less SQL surface than a read RPC, per the task brief. Both the
 * approvals and messages queries are capped and ordered ascending (oldest
 * first) so an over-dense window drains oldest-chunk-first across
 * successive ticks instead of stranding a chunk permanently -- see
 * EVENTS_QUERY_CAP's comment for the full reasoning.
 *
 * Per-client failures (a bad query, a Resend rejection, a failed cursor
 * advance after an already-sent email, ...) are caught individually and
 * release that ONE client's lease; they never abort the batch loop,
 * mirroring notification-email-cron's per-user isolation.
 */
import {
  buildClientEventEmail,
  clientEventSubject,
  signUnsubToken,
} from "../_shared/client-event-email.ts";

interface DbError {
  message: string;
}

export interface ClaimedClientEventRow {
  id: number;
  conta_id: string;
  nome: string;
  email: string;
  event_cursor_at: string | null;
  event_claim_through: string;
}

/** Narrow slice of the PostgREST filter-builder chain this function drives
 * (express-post-cleanup-cron's pattern): every read is `.select()` followed
 * by some combination of the operators below, every write is
 * `.update()` followed by `.in()`. */
export interface FilterChain<T>
  extends PromiseLike<{ data: T[] | null; error: DbError | null }> {
  eq(column: string, value: unknown): FilterChain<T>;
  gt(column: string, value: unknown): FilterChain<T>;
  lte(column: string, value: unknown): FilterChain<T>;
  order(column: string, opts: { ascending: boolean }): FilterChain<T>;
  limit(count: number): FilterChain<T>;
}

export interface MutationChain {
  in(column: string, values: unknown[]): PromiseLike<{ error: DbError | null }>;
}

export interface ClientEventEmailDb {
  rpc(
    fn: "claim_client_event_emails",
    args: { p_now: string; p_limit: number },
  ): Promise<{ data: ClaimedClientEventRow[] | null; error: DbError | null }>;
  from(table: string): {
    // deno-lint-ignore no-explicit-any
    select(columns: string): FilterChain<any>;
    update(patch: Record<string, unknown>): MutationChain;
  };
}

interface PostStatusEventRow {
  id: number;
  post_id: number;
  created_at: string;
  workflow_posts: { titulo: string };
}

interface MensagemRow {
  id: number;
  created_at: string;
}

interface PendingPost {
  titulo: string;
}

export interface ClientEventEmailCronDeps {
  db: ClientEventEmailDb;
  now: () => Date;
  nowMs?: () => number;
  resendEnabled: boolean;
  /** TOKEN_ENCRYPTION_KEY, read via a throwing IIFE in index.ts. */
  tokenSecret: string;
  /** SUPABASE_URL -- the unsub link is `${unsubBaseUrl}/functions/v1/client-email-unsub/<token>`. */
  unsubBaseUrl: string;
  resolveHubUrl: (clienteId: number, contaId: string) => Promise<string>;
  sendEmail: (p: {
    to: string;
    subject: string;
    html: string;
    idempotencyKey: string;
    from: string;
    headers: Record<string, string>;
  }) => Promise<void>;
  auditLog: (entry: {
    conta_id: string;
    action: string;
    resource_type: string;
    resource_id: string;
    metadata: Record<string, unknown>;
  }) => Promise<void>;
  report?: (
    detail: { failed: number; errors: Array<{ accountId?: string; error: string }> },
  ) => Promise<void>;
}

export interface ClientEventEmailCronResult {
  claimed: number;
  emailed: number;
  skippedNoContent: number;
  skippedNoHub: number;
  failed: number;
  released: number;
  skipped?: boolean;
}

const SEVENTY_TWO_HOURS_MS = 72 * 3600_000;
const CLAIM_BATCH_SIZE = 50;
const SEND_DEADLINE_MS = 60_000;
/**
 * Explicit cap on both the approvals and messages queries. PostgREST itself
 * enforces a response-row ceiling (commonly 1000) on an unbounded select --
 * without an explicit `.limit()` here, an over-dense window (a client with
 * more than that many post-status transitions or workspace messages inside
 * one digest window) would silently come back truncated to that implicit
 * cap, and this handler had no way to tell "truncated" apart from "that's
 * really everything." Naming the cap explicitly makes truncation detectable
 * (`rows.length === EVENTS_QUERY_CAP`) so the cursor-advance logic below can
 * react to it instead of blindly trusting an empty/short-of-1000 result.
 *
 * Both queries order ascending (oldest first, `created_at` then `id` as a
 * deterministic tiebreak) and cap at this count. Under the cap, the fetched
 * set IS the whole window and the cursor advances to `upper` as usual. At
 * the cap, the fetched set is only the OLDEST EVENTS_QUERY_CAP rows --
 * `(lower, lastReturned]` where `lastReturned` is the last row's
 * created_at -- so the cursor advances only to `lastReturned` instead of
 * `upper`. The unprocessed remainder, `(lastReturned, upper]`, is strictly
 * NEWER, and the next tick's window starts exactly at `lastReturned` and
 * extends forward to that tick's own (later) claim_through -- so the
 * remainder is naturally swept up next time, and nothing strands. (An
 * earlier version of this fix ordered DESCENDING and advanced to the
 * oldest FETCHED row -- that stranded the un-fetched OLDER remainder below
 * the new cursor, since every future window only ever moves forward. That
 * was a design bug in the fix itself, caught in review before it shipped;
 * ascending order is the correct oldest-first drain.)
 *
 * Two follow-on subtleties, both caught in a later review pass:
 *
 *  1. The LIMIT cuts on a composite (created_at, id), but `lastReturned`
 *     above is created_at-ONLY. A transaction-stable `now()` makes it common
 *     for several rows (a batch of status transitions, e.g. bulk-approving
 *     posts) to share the exact same created_at -- if the cap happens to
 *     cut through the MIDDLE of that tied group, the excluded siblings share
 *     created_at with `lastReturned` and can never satisfy `gt(created_at,
 *     lastReturned)` on any future tick: stranded permanently, same failure
 *     mode as the DESC bug above just one level down. The repo already
 *     names and fixes this exact trap for a different query -- a composite
 *     keyset cursor, see supabase/migrations/20260731000003_mensagens_consolidadas.sql:253-258.
 *     Same fix here: when a query hits the cap, `appendTiedTail` issues ONE
 *     supplementary fetch (`created_at = lastTs AND id > lastId`, ordered by
 *     id) to complete the tied group before trusting `lastTs` as a
 *     `gt()`-safe boundary.
 *  2. When only ONE of the two queries hits the cap, the OTHER one's items
 *     newer than the folded safe bound still get fetched, built into the
 *     email, and sent THIS tick -- but the cursor only advances to the
 *     (more conservative) folded bound, so the next tick's window still
 *     covers them and re-mails the same items. Both item sets are trimmed
 *     to `created_at <= bound` right after the bound is finalized (a no-op
 *     under cap, where bound === upper) so whatever ships in a digest is
 *     always fully covered by that digest's own cursor advance.
 */
const EVENTS_QUERY_CAP = 1000;

/**
 * Completes a tied created_at group that the cap may have cut through (see
 * point 1 above). `tied` is the supplementary fetch's result
 * (`created_at = lastTs AND id > lastId`, ordered by id, capped the same
 * way); appends it to `rows`. If the supplementary fetch ITSELF hits the
 * cap -- meaning a single created_at is shared by more than 2x
 * EVENTS_QUERY_CAP rows for one client, an astronomically rare volume --
 * this can't fully resolve without real pagination; it logs and proceeds
 * with a possibly-incomplete tied group rather than looping indefinitely.
 */
function appendTiedTail<T>(rows: T[], tied: T[], logLabel: string, tiedAtIso: string): T[] {
  if (tied.length === EVENTS_QUERY_CAP) {
    console.warn(
      `[client-event-email-cron] ${logLabel}: tied created_at group at ${tiedAtIso} exceeds ` +
        `${EVENTS_QUERY_CAP * 2} rows -- proceeding with a possibly-incomplete tied group (documented residual).`,
    );
  }
  return rows.concat(tied);
}

/** GREATEST(iso, floor) -- iso may be null (never delivered). */
function maxDate(iso: string | null, floor: Date): Date {
  if (!iso) return floor;
  const d = new Date(iso);
  return d.getTime() > floor.getTime() ? d : floor;
}

/**
 * `workspaceName` is tenant-editable free text, interpolated into the From
 * display name (`"${name}" <notificacoes@mesaas.com.br>`). CR/LF could break
 * out of the header into a second header (header injection) regardless of
 * quoting, so control characters are still stripped outright. But a name
 * containing an RFC 5322 "special" (`, ; : @ ( ) [ ] \ "` -- e.g. "Silva,
 * Souza & Cia") is NOT dangerous by itself: it only becomes ambiguous in an
 * UNQUOTED display name, where a comma reads as a second address. Stripping
 * those characters (the previous approach) mangles legitimate business
 * names for no safety benefit. The correct, always-valid fix is what RFC
 * 5322 itself provides: wrap the whole name in a quoted-string, escaping
 * only the two characters that are structurally special INSIDE a
 * quoted-string (`\` and `"`) -- everything else, including `<`, `>`, `,`,
 * `;`, `(`, `)`, is just literal text there. The HTML body's own copy of
 * workspaceName is untouched -- buildClientEventEmail already escapes it
 * for that (unrelated) context.
 */
function sanitizeFromName(name: string): string {
  // deno-lint-ignore no-control-regex
  const cleaned = name.replace(/[\x00-\x1f\x7f]+/g, " ").replace(/\s+/g, " ").trim() || "Mesaas";
  const escaped = cleaned.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  return `"${escaped}"`;
}

/**
 * Stable per (cliente, exact composite id set); order-insensitive. Mirrors
 * buildDigestIdempotencyKey's sha1-16 approach (_shared/notification-email.ts)
 * over sorted composite ids ("pse:<id>" / "msg:<id>").
 */
export async function buildClientEventIdempotencyKey(clienteId: number, ids: string[]): Promise<string> {
  const payload = [...ids].sort().join(",");
  const digest = await crypto.subtle.digest("SHA-1", new TextEncoder().encode(payload));
  const hex = Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
  return `client-events:${clienteId}:${hex.slice(0, 16)}`;
}

/**
 * Clears ONLY the claim lease (`event_claim_through`). `event_claimed_at` is
 * deliberately left untouched -- it is the "last attempt" marker (set on
 * EVERY claim, success or not), which the claim RPC's own 30-minute gate
 * (`event_claimed_at < p_now - interval '30 minutes'`) turns into a natural
 * backoff for a client that keeps coming up empty (no content, no Hub link):
 * without this, releasing claimed_at back to NULL would let the very next
 * run re-claim and re-query the same empty client every 15 minutes forever.
 * The claim RPC also orders by `event_claimed_at ASC NULLS FIRST`, so
 * leaving it set doubles as the fair-rotation key -- a client that just had
 * an attempt sinks behind clients that haven't been tried yet.
 */
async function releaseLease(db: ClientEventEmailDb, ids: number[]): Promise<void> {
  const { error } = await db.from("clientes")
    .update({ event_claim_through: null })
    .in("id", ids);
  if (error) {
    console.error(`[client-event-email-cron] release failed for ${ids.length} ids:`, error.message);
  }
}

export async function runClientEventEmailCron(
  deps: ClientEventEmailCronDeps,
): Promise<ClientEventEmailCronResult> {
  if (!deps.resendEnabled) {
    return { claimed: 0, emailed: 0, skippedNoContent: 0, skippedNoHub: 0, failed: 0, released: 0, skipped: true };
  }

  const clockNow = deps.nowMs ?? Date.now;
  const startedAt = clockNow();
  const now = deps.now();

  const { data, error } = await deps.db.rpc("claim_client_event_emails", {
    p_now: now.toISOString(),
    p_limit: CLAIM_BATCH_SIZE,
  });
  if (error) throw new Error(`claim_client_event_emails failed: ${error.message}`);
  const rows = data ?? [];
  if (rows.length === 0) {
    return { claimed: 0, emailed: 0, skippedNoContent: 0, skippedNoHub: 0, failed: 0, released: 0 };
  }

  let emailed = 0, skippedNoContent = 0, skippedNoHub = 0, failed = 0, released = 0;
  const errors: Array<{ accountId?: string; error: string }> = [];

  for (let i = 0; i < rows.length; i++) {
    if (clockNow() - startedAt > SEND_DEADLINE_MS) {
      const remainingIds = rows.slice(i).map((r) => r.id);
      released += remainingIds.length;
      await releaseLease(deps.db, remainingIds);
      break;
    }

    const row = rows[i];
    try {
      const floor = new Date(now.getTime() - SEVENTY_TWO_HOURS_MS);
      const lower = maxDate(row.event_cursor_at, floor);
      const upper = new Date(row.event_claim_through);
      const lowerIso = lower.toISOString();
      const upperIso = upper.toISOString();

      // ---- pending approvals -------------------------------------------------
      // Ascending order (oldest first) + a deterministic `id` tiebreak (two
      // transitions can share a created_at at whatever timestamp precision
      // Postgres stores) -- see EVENTS_QUERY_CAP's comment for why ascending,
      // not descending, is what makes an over-dense window drain safely.
      const { data: eventRows, error: eventsErr } = await deps.db
        .from("post_status_events")
        .select("id, post_id, created_at, workflow_posts!inner(titulo)")
        .eq("conta_id", row.conta_id)
        .eq("to_status", "enviado_cliente")
        .eq("workflow_posts.cliente_id", row.id)
        .eq("workflow_posts.status", "enviado_cliente")
        .gt("created_at", lowerIso)
        .lte("created_at", upperIso)
        .order("created_at", { ascending: true })
        .order("id", { ascending: true })
        .limit(EVENTS_QUERY_CAP);
      if (eventsErr) throw new Error(`post_status_events query failed: ${eventsErr.message}`);
      let eventRowsArr = (eventRows ?? []) as PostStatusEventRow[];

      // The cap was hit -- the window holds MORE than EVENTS_QUERY_CAP events
      // and the query (ordered created_at ASC) only returned the OLDEST
      // slice: `(lower, lastReturned]`. Complete any tied created_at group
      // the cap cut through (EVENTS_QUERY_CAP's comment, point 1 -- the
      // mensagens_consolidadas composite-keyset-cursor precedent) before
      // trusting the boundary, then track it so the cursor advances only up
      // to it below -- the newer, un-fetched remainder `(lastReturned,
      // upper]` is left for the next tick's window, which picks up right
      // where this one stopped.
      let safeUpperMs: number | null = null;
      if (eventRowsArr.length === EVENTS_QUERY_CAP) {
        const last = eventRowsArr[eventRowsArr.length - 1];
        const { data: tiedEventRows, error: tiedEventsErr } = await deps.db
          .from("post_status_events")
          .select("id, post_id, created_at, workflow_posts!inner(titulo)")
          .eq("conta_id", row.conta_id)
          .eq("to_status", "enviado_cliente")
          .eq("workflow_posts.cliente_id", row.id)
          .eq("workflow_posts.status", "enviado_cliente")
          .eq("created_at", last.created_at)
          .gt("id", last.id)
          .order("id", { ascending: true })
          .limit(EVENTS_QUERY_CAP);
        if (tiedEventsErr) {
          throw new Error(`post_status_events tie-completion query failed: ${tiedEventsErr.message}`);
        }
        eventRowsArr = appendTiedTail(
          eventRowsArr,
          (tiedEventRows ?? []) as PostStatusEventRow[],
          "post_status_events",
          last.created_at,
        );
        safeUpperMs = new Date(last.created_at).getTime();
      }

      // ---- unread messages -----------------------------------------------------
      const { data: seenRows, error: seenErr } = await deps.db
        .from("mensagens_last_seen")
        .select("last_seen_at")
        .eq("conta_id", row.conta_id)
        .eq("cliente_id", row.id);
      if (seenErr) throw new Error(`mensagens_last_seen query failed: ${seenErr.message}`);
      const lastSeenAt = (seenRows?.[0] as { last_seen_at: string } | undefined)?.last_seen_at ?? null;
      // created_at > window_lower AND created_at > last_seen_at
      //   == created_at > GREATEST(window_lower, last_seen_at)
      const msgLower = maxDate(lastSeenAt, lower);

      const { data: msgRows, error: msgErr } = await deps.db
        .from("mensagens")
        .select("id, created_at")
        .eq("conta_id", row.conta_id)
        .eq("cliente_id", row.id)
        .eq("is_workspace_user", true)
        .gt("created_at", msgLower.toISOString())
        .lte("created_at", upperIso)
        .order("created_at", { ascending: true })
        .order("id", { ascending: true })
        .limit(EVENTS_QUERY_CAP);
      if (msgErr) throw new Error(`mensagens query failed: ${msgErr.message}`);
      let messages = (msgRows ?? []) as MensagemRow[];

      // Same truncation guard + tie-completion as the approvals query above
      // -- fold its bound into the same safeUpperMs. Math.min, not max: the
      // cursor can only advance as far as whichever of the two queries
      // drained LESS of the window, otherwise the slower query's un-fetched
      // remainder would be falsely marked delivered.
      if (messages.length === EVENTS_QUERY_CAP) {
        const last = messages[messages.length - 1];
        const { data: tiedMsgRows, error: tiedMsgErr } = await deps.db
          .from("mensagens")
          .select("id, created_at")
          .eq("conta_id", row.conta_id)
          .eq("cliente_id", row.id)
          .eq("is_workspace_user", true)
          .eq("created_at", last.created_at)
          .gt("id", last.id)
          .order("id", { ascending: true })
          .limit(EVENTS_QUERY_CAP);
        if (tiedMsgErr) throw new Error(`mensagens tie-completion query failed: ${tiedMsgErr.message}`);
        messages = appendTiedTail(messages, (tiedMsgRows ?? []) as MensagemRow[], "mensagens", last.created_at);
        const msgSafeUpperMs = new Date(last.created_at).getTime();
        safeUpperMs = safeUpperMs === null ? msgSafeUpperMs : Math.min(safeUpperMs, msgSafeUpperMs);
      }

      // The bound is now final (folded across both queries, tie-completed).
      // Trim BOTH item sets to it: if only ONE query capped, the OTHER
      // query's items newer than the folded bound would otherwise still
      // ship in THIS digest while the cursor only advances to the bound --
      // the next tick's window still covers them and would re-mail the same
      // items. Under cap (bound === upper) every fetched row already
      // satisfies `created_at <= upper` by construction, so this is a no-op.
      //
      // The comparison itself MUST be numeric (epoch ms via Date.getTime()),
      // not a raw string compare of `created_at <= boundIso`: PostgREST can
      // render created_at in a different textual format than the ISO string
      // this handler builds (production has returned `+00:00`-suffixed,
      // microsecond-precision timestamps rather than `Z`-suffixed
      // millisecond ones) -- ASCII comparison of two differently-formatted
      // strings representing the same or nearby instants can misorder them.
      // Date.parse() normalizes both sides before comparing. This still
      // truncates to millisecond precision (JS Date has no microsecond
      // field), so two distinct Postgres rows that differ only in their
      // sub-millisecond digits would compare equal here -- an accepted,
      // documented residual, not something this fix resolves.
      const boundMs = safeUpperMs ?? upper.getTime();
      const boundIso = new Date(boundMs).toISOString();
      eventRowsArr = eventRowsArr.filter((e) => new Date(e.created_at).getTime() <= boundMs);
      messages = messages.filter((m) => new Date(m.created_at).getTime() <= boundMs);

      // supabase-js can't DISTINCT ON: dedupe by post_id over the
      // created_at-ASC, bound-trimmed result. Iterating oldest-to-newest and
      // simply overwriting a Map on every encounter (no "skip if seen")
      // leaves each post's LATEST transition WITHIN THE BOUND once the loop
      // ends, since a later iteration always overwrites an earlier one for
      // the same key. (titulo doesn't actually vary between a post's own
      // transitions -- it's read fresh off workflow_posts on every row --
      // so what the dedupe really picks is which event `id` represents this
      // post in the idempotency key below.)
      const latestByPost = new Map<number, { id: number; titulo: string }>();
      for (const e of eventRowsArr) {
        latestByPost.set(e.post_id, { id: e.id, titulo: e.workflow_posts.titulo });
      }
      const pendingPosts: PendingPost[] = Array.from(latestByPost.values()).map((p) => ({ titulo: p.titulo }));
      const approvalIds: string[] = Array.from(latestByPost.values()).map((p) => `pse:${p.id}`);
      const messageIds = messages.map((m) => `msg:${m.id}`);

      if (pendingPosts.length === 0 && messages.length === 0) {
        skippedNoContent++;
        await releaseLease(deps.db, [row.id]);
        continue;
      }

      // ---- hub link --------------------------------------------------------------
      const hubUrl = await deps.resolveHubUrl(row.id, row.conta_id);
      if (!hubUrl) {
        skippedNoHub++;
        await releaseLease(deps.db, [row.id]);
        continue;
      }

      // ---- workspace branding ---------------------------------------------------
      const { data: wsRows, error: wsErr } = await deps.db
        .from("workspaces")
        .select("name, brand_color, logo_url")
        .eq("id", row.conta_id);
      if (wsErr) throw new Error(`workspaces query failed: ${wsErr.message}`);
      const branding = wsRows?.[0] as
        | { name: string | null; brand_color: string | null; logo_url: string | null }
        | undefined;
      const workspaceName = branding?.name ?? "Mesaas";
      const brandColor = branding?.brand_color ?? "#eab308";
      const logoUrl = branding?.logo_url ?? null;

      const unsubToken = await signUnsubToken(row.id, deps.tokenSecret);
      const unsubUrl = `${deps.unsubBaseUrl}/functions/v1/client-email-unsub/${unsubToken}`;

      const html = buildClientEventEmail({
        clienteNome: row.nome,
        workspaceName,
        brandColor,
        logoUrl,
        pendingPosts,
        unreadMessages: messages.length,
        hubUrl,
        unsubUrl,
      });
      const idempotencyKey = await buildClientEventIdempotencyKey(row.id, [...approvalIds, ...messageIds]);

      await deps.sendEmail({
        to: row.email,
        subject: clientEventSubject(workspaceName),
        html,
        idempotencyKey,
        from: `${sanitizeFromName(workspaceName)} <notificacoes@mesaas.com.br>`,
        headers: {
          // RFC 8058 one-click unsubscribe.
          "List-Unsubscribe": `<${unsubUrl}>`,
          "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
        },
      });

      // `boundIso` (computed above, right after the tie-completed/folded
      // safeUpperMs) is exactly what was fetched, trimmed, and just sent --
      // normally `upper` (claim_through), or the more conservative capped
      // bound when either query was over-dense. Advancing the cursor to it
      // (never past it) is what keeps the un-fetched/trimmed-out remainder
      // for the next tick's window instead of falsely marking it delivered.
      // boundIso is always > lowerIso by construction (it comes from a row
      // that already passed the `gt` filter, or is `upper` itself), so this
      // can never move the cursor backwards.
      //
      // The email is already sent at this point -- a cursor-advance failure
      // below must still release the lease (so the client isn't stuck)
      // rather than silently swallow it, but a retry is harmless: the
      // idempotency key above is deterministic, so Resend dedupes (409)
      // instead of resending. event_claimed_at is left as-is (see
      // releaseLease's comment) -- it still marks "last attempt" for the
      // 30-minute lease gate and the rotation order on the next claim.
      const { error: successErr } = await deps.db.from("clientes")
        .update({ event_cursor_at: boundIso, event_claim_through: null })
        .in("id", [row.id]);
      if (successErr) throw new Error(`cursor advance failed: ${successErr.message}`);

      // Delivery + cursor advance define "emailed"; the audit trail is
      // best-effort from here on and must never recast an already-delivered,
      // already-advanced client as a failure (which would also needlessly
      // release its -- already cleared -- lease and page on-call).
      emailed++;
      try {
        await deps.auditLog({
          conta_id: row.conta_id,
          action: "client_event_email_sent",
          resource_type: "cliente",
          resource_id: String(row.id),
          metadata: { posts: pendingPosts.length, messages: messages.length },
        });
      } catch (auditErr) {
        const auditMessage = auditErr instanceof Error ? auditErr.message : String(auditErr);
        console.error(`[client-event-email-cron] audit log failed for cliente=${row.id}:`, auditMessage);
      }
    } catch (e) {
      failed++;
      const message = e instanceof Error ? e.message : String(e);
      errors.push({ accountId: String(row.id), error: message });
      console.error(`[client-event-email-cron] failed for cliente=${row.id}:`, message);
      await releaseLease(deps.db, [row.id]);
    }
  }

  if (errors.length > 0 && deps.report) await deps.report({ failed: errors.length, errors });

  return { claimed: rows.length, emailed, skippedNoContent, skippedNoHub, failed, released };
}

// ─── Auth wrapper (mirrors notification-email-cron's) ──────────────────────
interface ClientEventEmailCronHandlerDeps {
  cronSecret: string;
  run: (req: Request) => Promise<Response>;
  timingSafeEqual: (a: string, b: string) => boolean;
}

export function createClientEventEmailCronHandler(deps: ClientEventEmailCronHandlerDeps) {
  return async (req: Request): Promise<Response> => {
    if (!deps.timingSafeEqual(req.headers.get("x-cron-secret") ?? "", deps.cronSecret)) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    }
    return deps.run(req);
  };
}
