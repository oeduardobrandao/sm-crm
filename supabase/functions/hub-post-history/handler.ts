import { createJsonResponder } from "../_shared/http.ts";
import { resolveHubToken } from "../_shared/hub-token.ts";
import { getClientIP } from "../_shared/rate-limit.ts";
import { isClientVisibleApproval } from "../_shared/hub-approvals.ts";

type DbClient = {
  // deno-lint-ignore no-explicit-any
  from: (table: string) => any;
};

// Mirrors apps/hub/src/lib/postView.ts VISIBLE_STATUSES. An event enters the
// response only by its to_status; from_status is never exposed because the
// first send always comes from an internal status.
const VISIBLE_STATUSES = new Set([
  "enviado_cliente",
  "aprovado_cliente",
  "correcao_cliente",
  "agendado",
  "postado",
  "falha_publicacao",
]);

export interface RawStatusEventRow {
  id: number;
  from_status: string | null;
  to_status: string;
  source: string;
  post_approval_id: number | null;
  created_at: string;
  snapshot_conteudo_plain: string | null;
  snapshot_ig_caption: string | null;
  // actor_name / actor_user_id / custom-status columns may be present on the
  // row; they are read here only to be dropped.
  [extra: string]: unknown;
}

export interface HubHistoryEvent {
  id: number;
  to_status: string;
  source: "client" | "team" | "system";
  created_at: string;
  post_approval_id: number | null;
  snapshot: { conteudo_plain: string | null; ig_caption: string | null } | null;
}

export interface HubHistoryApproval {
  id: number;
  action: "aprovado" | "correcao" | "mensagem";
  comentario: string | null;
  motivo: string | null;
  /** Always false for action = "mensagem": team messages never leave this function. */
  is_workspace_user: boolean;
  created_at: string;
}

export interface RawApprovalRow {
  id: number;
  action: string;
  comentario: string | null;
  motivo: string | null;
  is_workspace_user: boolean | null;
  created_at: string;
  [extra: string]: unknown;
}

function compareByCreatedAtThenId(a: { created_at: string; id: number }, b: { created_at: string; id: number }) {
  return a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : a.id - b.id;
}

/**
 * Pure DTO builder. Order (created_at, id); drop from = to rows (custom-status
 * only moves also fire the trigger since 20260805000001); keep only visible
 * to_status; start at the first enviado_cliente event (temporal floor); never
 * copy actor names, from_status or custom-status names.
 */
export function sanitizeHistoryEvents(rows: RawStatusEventRow[]): HubHistoryEvent[] {
  const ordered = [...rows].sort(compareByCreatedAtThenId).filter(
    (r) => r.from_status !== r.to_status && VISIBLE_STATUSES.has(r.to_status),
  );
  const firstSend = ordered.findIndex((r) => r.to_status === "enviado_cliente");
  if (firstSend === -1) return [];
  return ordered.slice(firstSend).map((r) => ({
    id: r.id,
    to_status: r.to_status,
    source: r.source === "client" ? "client" : r.source === "system" ? "system" : "team",
    created_at: r.created_at,
    post_approval_id: r.post_approval_id ?? null,
    snapshot: r.to_status === "enviado_cliente"
      ? { conteudo_plain: r.snapshot_conteudo_plain ?? null, ig_caption: r.snapshot_ig_caption ?? null }
      : null,
  }));
}

/**
 * Pure DTO builder for post_approvals. Two rules, both from spec §1:
 * 1. Team-authored messages (action = 'mensagem' AND is_workspace_user = true,
 *    written by the CRM's replyToPostApproval for internal coordination) are
 *    dropped, without exception. The Hub has no team identity, so every
 *    mensagem this feature writes is is_workspace_user = false by construction.
 * 2. NO temporal floor: aprovado/correcao/mensagem rows written by the client
 *    are safe by definition (the client only answered because the post had
 *    already reached them), and a post may have no enviado_cliente event at
 *    all (pre-20260606000001 or best-effort trigger miss). Filtering them by
 *    the first send event would erase the client's own history.
 * Never copies token or author_user_id.
 */
export function sanitizeHistoryApprovals(rows: RawApprovalRow[]): HubHistoryApproval[] {
  return [...rows]
    .sort(compareByCreatedAtThenId)
    .filter(isClientVisibleApproval)
    .map((r) => ({
      id: r.id,
      action: r.action as HubHistoryApproval["action"],
      comentario: r.comentario ?? null,
      motivo: r.motivo ?? null,
      is_workspace_user: r.is_workspace_user === true,
      created_at: r.created_at,
    }));
}

interface HubPostHistoryHandlerDeps {
  buildCorsHeaders: (req: Request) => Record<string, string>;
  createDb: () => DbClient;
  now: () => string;
  rateLimit: (db: DbClient, key: string, max: number, windowSeconds: number) => Promise<boolean>;
}

export function createHubPostHistoryHandler(deps: HubPostHistoryHandlerDeps) {
  return async (req: Request): Promise<Response> => {
    const cors = deps.buildCorsHeaders(req);
    const json = createJsonResponder(cors);

    if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
    if (req.method !== "GET") return json({ error: "Method not allowed" }, 405);

    const url = new URL(req.url);
    const token = url.searchParams.get("token");
    const postId = Number.parseInt(url.searchParams.get("post_id") ?? "", 10);
    if (!token || Number.isNaN(postId) || postId <= 0) {
      return json({ error: "token and post_id required" }, 400);
    }

    const db = deps.createDb();

    // deno-lint-ignore no-explicit-any
    const hubToken = await resolveHubToken(db as any, token, deps.now());
    if (!hubToken) {
      const okBadToken = await deps.rateLimit(db, `hub-badtoken:${getClientIP(req)}`, 30, 600);
      if (!okBadToken) return json({ error: "Muitas tentativas. Aguarde alguns minutos." }, 429);
      return json({ error: "Link inválido." }, 404);
    }

    const okRead = await deps.rateLimit(
      db, `hub-read:${hubToken.conta_id}:${hubToken.cliente_id}`, 300, 300,
    );
    if (!okRead) return json({ error: "Muitas tentativas. Aguarde alguns minutos." }, 429);

    // P0: resolve the post through the token's own client/workspace BEFORE
    // reading any history. Same pattern as hub-approve.
    const { data: post } = await db
      .from("workflow_posts")
      .select("id, cliente_id, conta_id")
      .eq("id", postId)
      .maybeSingle();
    if (!post) return json({ error: "Post não encontrado." }, 404);
    if (post.cliente_id !== hubToken.cliente_id || post.conta_id !== hubToken.conta_id) {
      return json({ error: "Não autorizado." }, 403);
    }

    const { data: events, error: eventsError } = await db
      .from("post_status_events")
      .select("id, from_status, to_status, source, post_approval_id, created_at, snapshot_conteudo_plain, snapshot_ig_caption")
      .eq("post_id", postId)
      .order("created_at", { ascending: true })
      .order("id", { ascending: true });
    if (eventsError) {
      console.error("[hub-post-history] events lookup failed:", eventsError);
      return json({ error: "Erro ao carregar histórico." }, 500);
    }

    const { data: approvals, error: approvalsError } = await db
      .from("post_approvals")
      .select("id, action, comentario, motivo, is_workspace_user, created_at")
      .eq("post_id", postId)
      .order("created_at", { ascending: true })
      .order("id", { ascending: true });
    if (approvalsError) {
      console.error("[hub-post-history] approvals lookup failed:", approvalsError);
      return json({ error: "Erro ao carregar histórico." }, 500);
    }

    return json({
      events: sanitizeHistoryEvents((events ?? []) as RawStatusEventRow[]),
      approvals: sanitizeHistoryApprovals((approvals ?? []) as RawApprovalRow[]),
    });
  };
}
