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
 * active-status / cursor-age / lease-age filter and the
 * `FOR UPDATE SKIP LOCKED` claim in a single statement, capped at
 * CLAIM_BATCH_SIZE. `event_claim_through` is a LEASE, separate from
 * `event_cursor_at` (the point this client's content was actually delivered
 * up to): the RPC always sets the lease so this handler can compute a stable
 * per-run window, but the cursor only advances after a successful send. Any
 * other outcome (empty content, no Hub link, send failure, a post-send
 * bookkeeping failure) clears the lease and leaves the cursor exactly where
 * it was, so the same window -- or a superset of it, once GREATEST'd against
 * now()-72h on the next run -- gets retried. A retry after an already-sent
 * email is safe: the idempotency key is deterministic over the exact content
 * set, so Resend dedupes it (409) rather than sending twice.
 *
 * Window per client: `(GREATEST(event_cursor_at, now-72h), event_claim_through]`.
 * The 72h floor applies unconditionally -- a client with a NULL cursor (never
 * emailed) or a very old one (rejoined after a long opt-out) never gets a
 * multi-day backlog dumped on them.
 *
 * supabase-js has no DISTINCT ON, so post approvals are deduped over an
 * ordered (created_at DESC) result in TS, keeping the first (=latest)
 * transition per post -- less SQL surface than a read RPC, per the task brief.
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
  gt(column: string, value: string): FilterChain<T>;
  lte(column: string, value: string): FilterChain<T>;
  order(column: string, opts: { ascending: boolean }): FilterChain<T>;
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

/** GREATEST(iso, floor) -- iso may be null (never delivered). */
function maxDate(iso: string | null, floor: Date): Date {
  if (!iso) return floor;
  const d = new Date(iso);
  return d.getTime() > floor.getTime() ? d : floor;
}

/**
 * `workspaceName` is tenant-editable free text, interpolated into the From
 * display name (`"${name} <notificacoes@mesaas.com.br>"`). CR/LF could break
 * out of the header into a second header (header injection); `<`, `>` and `"`
 * could close the display name early and forge a different address inside
 * the same From value. Strip both classes before composing the header. The
 * HTML body's own copy of workspaceName is untouched -- buildClientEventEmail
 * already escapes it for that context.
 */
function sanitizeFromName(name: string): string {
  // deno-lint-ignore no-control-regex
  const cleaned = name.replace(/[\x00-\x1f\x7f]+/g, " ").replace(/[<>"]/g, "").replace(/\s+/g, " ").trim();
  return cleaned || "Mesaas";
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

async function releaseLease(db: ClientEventEmailDb, ids: number[]): Promise<void> {
  const { error } = await db.from("clientes")
    .update({ event_claim_through: null, event_claimed_at: null })
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
      const { data: eventRows, error: eventsErr } = await deps.db
        .from("post_status_events")
        .select("id, post_id, created_at, workflow_posts!inner(titulo)")
        .eq("conta_id", row.conta_id)
        .eq("to_status", "enviado_cliente")
        .eq("workflow_posts.cliente_id", row.id)
        .eq("workflow_posts.status", "enviado_cliente")
        .gt("created_at", lowerIso)
        .lte("created_at", upperIso)
        .order("created_at", { ascending: false });
      if (eventsErr) throw new Error(`post_status_events query failed: ${eventsErr.message}`);

      // supabase-js can't DISTINCT ON: dedupe over the created_at-DESC result,
      // keeping the first (= latest) transition seen per post.
      const seenPosts = new Set<number>();
      const pendingPosts: PendingPost[] = [];
      const approvalIds: string[] = [];
      for (const e of (eventRows ?? []) as PostStatusEventRow[]) {
        if (seenPosts.has(e.post_id)) continue;
        seenPosts.add(e.post_id);
        pendingPosts.push({ titulo: e.workflow_posts.titulo });
        approvalIds.push(`pse:${e.id}`);
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
        .lte("created_at", upperIso);
      if (msgErr) throw new Error(`mensagens query failed: ${msgErr.message}`);
      const messages = (msgRows ?? []) as MensagemRow[];
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

      // The email is already sent at this point -- a cursor-advance failure
      // below must still release the lease (so the client isn't stuck)
      // rather than silently swallow it, but a retry is harmless: the
      // idempotency key above is deterministic, so Resend dedupes (409)
      // instead of resending.
      const { error: successErr } = await deps.db.from("clientes")
        .update({ event_cursor_at: upperIso, event_claim_through: null, event_claimed_at: null })
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
