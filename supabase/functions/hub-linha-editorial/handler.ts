/**
 * hub-linha-editorial: the client portal's side of the linha editorial (token auth,
 * no Supabase session).
 *
 * GET  ?token=  the client's linhas (enviada, ajustes, aprovada) from 3 months back to
 *               3 months ahead, with items, client-visible columns and the current
 *               rodada's respostas.
 * POST {token, linha_id, acao, item_id?, comentario?}
 *               acao comentario  -> record_linha_comment
 *               acao aprovado|ajustes -> record_linha_decision, then
 *               create_linha_notification (non-fatal) and the audit log.
 *
 * conta_id and cliente_id always come from the token, never from the body; the RPCs
 * scope the linha by both before anything else, so a guessed linha_id of another
 * client is a 404.
 *
 * Spec: docs/superpowers/specs/2026-10-26-linha-editorial-design.md (sections 4, 5.2, 8.1)
 */
import { createJsonResponder } from "../_shared/http.ts";
import { resolveHubToken } from "../_shared/hub-token.ts";
import { getClientIP } from "../_shared/rate-limit.ts";
import { effectivePlanFeature } from "../_shared/entitlements-rpc.ts";

type DbClient = {
  // deno-lint-ignore no-explicit-any
  from: (table: string) => any;
  rpc: (fn: string, params: Record<string, unknown>) => PromiseLike<{ data: unknown; error: unknown }>;
};

export interface HubLinhaAuditEntry {
  conta_id?: string;
  action: string;
  resource_type: string;
  resource_id?: string;
  metadata?: Record<string, unknown>;
}

export interface HubLinhaEditorialHandlerDeps {
  buildCorsHeaders: (req: Request) => Record<string, string>;
  createDb: () => DbClient;
  now: () => string;
  rateLimit: (db: DbClient, key: string, max: number, windowSeconds: number) => Promise<boolean>;
  /** `insertAuditLog(svc, entry)` wired in index.ts. Failures must never break the write. */
  auditLog: (entry: HubLinhaAuditEntry) => Promise<void>;
}

// ── Response shapes (mirrored by apps/hub/src/types.ts) ────────────────────

export interface HubLinhaItem {
  id: string;
  data: string | null;
  tipo: string;
  titulo: string;
  direcao: string;
  valores: Record<string, unknown>;
}

export interface HubLinhaColuna {
  id: string;
  nome: string;
  tipo: string;
  config: unknown;
  ordem: number;
}

export interface HubLinhaResposta {
  id: string;
  item_id: string | null;
  acao: string;
  comentario: string | null;
  is_workspace_user: boolean;
  created_at: string;
}

export interface HubLinha {
  id: string;
  periodo: string;
  status: string;
  enviada_at: string | null;
  decidida_at: string | null;
  rodada: number;
  itens: HubLinhaItem[];
  colunas: HubLinhaColuna[];
  respostas: HubLinhaResposta[];
}

// ── Constants ──────────────────────────────────────────────────────────────

const FEATURE = "feature_linha_editorial";
const READ_MAX = 300;
const READ_WINDOW = 300;
// Writes debit ONLY this pool, never the shared hub-read (spec 8.1): a client
// commenting on 20 rows must not hit the limit.
const WRITE_MAX = 60;
const WRITE_WINDOW = 3600;
const MAX_COMENTARIO = 2000;
const WINDOW_MONTHS = 3;
const VISIBLE_STATUSES = ["enviada", "ajustes", "aprovada"];

const MSG_GENERIC = "Não foi possível concluir. Tente novamente.";
const MSG_INVALID = "Dados inválidos.";
const MSG_RATE = "Muitas tentativas. Aguarde alguns minutos.";
const MSG_BAD_TOKEN = "Link inválido.";
const FEATURE_DISABLED_BODY = { error: "feature_disabled", feature: FEATURE };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ACOES = ["comentario", "aprovado", "ajustes"] as const;
type Acao = typeof ACOES[number];

/** RPC raise codes (P0001) to HTTP status. Matched as a substring: context may wrap them. */
const RPC_ERROR_STATUS: Array<[string, number]> = [
  ["nao_encontrada", 404],
  ["status_invalido", 409],
  ["comentario_obrigatorio", 422],
];

const isUuid = (v: unknown): v is string => typeof v === "string" && UUID_RE.test(v);

function rpcErrorMessage(error: unknown): string {
  const message = (error as { message?: unknown } | null)?.message;
  return typeof message === "string" ? message : "";
}

/**
 * First day of (current month + offset) as YYYY-MM-DD, where "current month" is
 * São Paulo's. The edge runtime is UTC, so Date#getMonth would be a month off
 * between 21:00 and 24:00 local on the last day of a month.
 */
function monthStart(nowIso: string, offset: number): string {
  const local = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(nowIso));
  const [y, m] = local.split("-").map((p) => parseInt(p, 10));
  const total = y * 12 + (m - 1) + offset;
  const year = Math.floor(total / 12);
  const month = (total % 12) + 1;
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-01`;
}

type ParsedPost =
  | { ok: true; linhaId: string; acao: Acao; itemId: string | null; comentario: string | null }
  | { ok: false; status: number; message: string };

/** Shape validation; runs before any DB round-trip so a bad payload costs nothing. */
function parsePost(body: Record<string, unknown>): ParsedPost {
  const { linha_id, acao, item_id, comentario } = body;
  if (!isUuid(linha_id)) return { ok: false, status: 400, message: MSG_INVALID };
  if (typeof acao !== "string" || !(ACOES as readonly string[]).includes(acao)) {
    return { ok: false, status: 400, message: MSG_INVALID };
  }
  const parsedAcao = acao as Acao;

  let itemId: string | null = null;
  if (item_id !== undefined && item_id !== null) {
    if (!isUuid(item_id)) return { ok: false, status: 400, message: MSG_INVALID };
    // A decision is always about the whole linha (its row has item_id null).
    if (parsedAcao !== "comentario") return { ok: false, status: 400, message: MSG_INVALID };
    itemId = item_id;
  }

  let texto: string | null = null;
  if (comentario !== undefined && comentario !== null) {
    if (typeof comentario !== "string") return { ok: false, status: 400, message: MSG_INVALID };
    const trimmed = comentario.trim();
    if (trimmed.length > MAX_COMENTARIO) return { ok: false, status: 422, message: MSG_GENERIC };
    texto = trimmed === "" ? null : trimmed;
  }
  if (parsedAcao === "comentario" && texto === null) {
    return { ok: false, status: 422, message: MSG_GENERIC };
  }

  return { ok: true, linhaId: linha_id, acao: parsedAcao, itemId, comentario: texto };
}

// Row shapes as selected (explicit column lists below).
interface LinhaRow {
  id: string;
  periodo: string;
  status: string;
  enviada_at: string | null;
  decidida_at: string | null;
  rodada: number;
}
interface ItemRow {
  id: string;
  linha_id: string;
  data: string | null;
  tipo: string;
  titulo: string;
  direcao: string;
  valores: Record<string, unknown> | null;
}
interface ColunaRow {
  id: string;
  nome: string;
  tipo: string;
  config: unknown;
  ordem: number;
}
interface RespostaRow {
  id: string;
  linha_id: string;
  item_id: string | null;
  acao: string;
  comentario: string | null;
  rodada: number;
  is_workspace_user: boolean;
  created_at: string;
}

class ReadFailure extends Error {}

export function createHubLinhaEditorialHandler(deps: HubLinhaEditorialHandlerDeps) {
  return async (req: Request): Promise<Response> => {
    const cors = deps.buildCorsHeaders(req);
    const json = createJsonResponder(cors);
    const fail = (status: number, message: string) => json({ error: message }, status);

    if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
    if (req.method !== "GET" && req.method !== "POST") return fail(405, "Método não permitido.");

    const url = new URL(req.url);

    let parsed: Extract<ParsedPost, { ok: true }> | null = null;
    let token: string | null;
    if (req.method === "POST") {
      const raw = await req.json().catch(() => null);
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) return fail(400, MSG_INVALID);
      const body = raw as Record<string, unknown>;
      token = typeof body.token === "string" && body.token !== "" ? body.token : null;
      if (!token) return fail(400, MSG_INVALID);
      const result = parsePost(body);
      if (!result.ok) return fail(result.status, result.message);
      parsed = result;
    } else {
      token = url.searchParams.get("token");
      if (!token) return fail(400, MSG_INVALID);
    }

    const db = deps.createDb();
    // deno-lint-ignore no-explicit-any
    const hubToken = await resolveHubToken(db as any, token, deps.now());
    if (!hubToken) {
      const okBadToken = await deps.rateLimit(db, `hub-badtoken:${getClientIP(req)}`, 30, 600);
      if (!okBadToken) return fail(429, MSG_RATE);
      return fail(404, MSG_BAD_TOKEN);
    }
    const contaId = hubToken.conta_id;
    const clienteId = hubToken.cliente_id;

    const allowed = req.method === "GET"
      ? await deps.rateLimit(db, `hub-read:${contaId}:${clienteId}`, READ_MAX, READ_WINDOW)
      : await deps.rateLimit(db, `hub-write:hub-linha-editorial:${contaId}:${clienteId}`, WRITE_MAX, WRITE_WINDOW);
    if (!allowed) return fail(429, MSG_RATE);

    // Fails closed: an error reading the flag is the same as the flag off.
    let featureOn = false;
    try {
      featureOn = await effectivePlanFeature(db as never, contaId, FEATURE);
    } catch (e) {
      console.error("[hub-linha-editorial] flag check failed:", rpcErrorMessage(e) || "unknown");
    }
    if (!featureOn) return json(FEATURE_DISABLED_BODY, 403);

    if (req.method === "GET") {
      try {
        const linhas = await loadLinhas(db, contaId, clienteId, deps.now());
        return json({ linhas });
      } catch (e) {
        console.error("[hub-linha-editorial] read failed:", e instanceof Error ? e.message : "unknown");
        return fail(500, MSG_GENERIC);
      }
    }

    const p = parsed!;

    /** Maps an RPC error to a response; only the code is logged (the message can carry row data). */
    const rpcFailure = (fn: string, error: unknown): Response => {
      const message = rpcErrorMessage(error);
      if (message.includes(`feature_disabled:${FEATURE}`)) return json(FEATURE_DISABLED_BODY, 403);
      const mapped = RPC_ERROR_STATUS.find(([code]) => message.includes(code));
      const code = (error as { code?: unknown } | null)?.code;
      console.error(`[hub-linha-editorial] ${fn} failed:`, mapped ? mapped[0] : String(code ?? "unknown"));
      return fail(mapped ? mapped[1] : 500, MSG_GENERIC);
    };

    try {
      if (p.acao === "comentario") {
        const { error } = await db.rpc("record_linha_comment", {
          p_linha_id: p.linhaId,
          p_item_id: p.itemId,
          p_conta_id: contaId,
          p_cliente_id: clienteId,
          p_token: token,
          p_comentario: p.comentario,
        });
        if (error) return rpcFailure("record_linha_comment", error);
        // Comments notify nobody: the decision carries the count (spec 5.2).
        return json({ ok: true });
      }

      const { data, error } = await db.rpc("record_linha_decision", {
        p_linha_id: p.linhaId,
        p_conta_id: contaId,
        p_cliente_id: clienteId,
        p_token: token,
        p_acao: p.acao,
        p_comentario: p.comentario,
      });
      if (error) return rpcFailure("record_linha_decision", error);
      const result = (data && typeof data === "object" ? data : {}) as { status?: unknown; comentarios?: unknown };
      const status = typeof result.status === "string" ? result.status : undefined;

      // After the decision committed, as hub-approve does: a notification failure
      // never rolls back or fails the client's decision.
      try {
        const { error: notifErr } = await db.rpc("create_linha_notification", {
          p_linha_id: p.linhaId,
          p_acao: p.acao,
        });
        if (notifErr) {
          console.error("[hub-linha-editorial] notification failed:", rpcErrorMessage(notifErr) || "unknown");
        }
      } catch (e) {
        console.error("[hub-linha-editorial] notification threw:", e instanceof Error ? e.message : "unknown");
      }

      try {
        await deps.auditLog({
          conta_id: contaId,
          action: `hub_linha_editorial_${p.acao}`,
          resource_type: "linha_editorial",
          resource_id: p.linhaId,
          metadata: {
            cliente_id: clienteId,
            acao: p.acao,
            status: status ?? null,
            comentarios: typeof result.comentarios === "number" ? result.comentarios : null,
          },
        });
      } catch (e) {
        console.error("[hub-linha-editorial] audit failed:", e instanceof Error ? e.message : "unknown");
      }

      return json(status ? { ok: true, status } : { ok: true });
    } catch (e) {
      console.error("[hub-linha-editorial] unexpected error:", e instanceof Error ? e.message : "unknown");
      return fail(500, MSG_GENERIC);
    }
  };
}

/** The GET payload. Every select is an explicit column list; output objects are built field by field. */
async function loadLinhas(db: DbClient, contaId: string, clienteId: number, nowIso: string): Promise<HubLinha[]> {
  const { data: linhaData, error: linhaErr } = await db.from("linhas_editoriais")
    .select("id, periodo, status, enviada_at, decidida_at, rodada")
    .eq("conta_id", contaId)
    .eq("cliente_id", clienteId)
    .in("status", VISIBLE_STATUSES)
    .gte("periodo", monthStart(nowIso, -WINDOW_MONTHS))
    .lte("periodo", monthStart(nowIso, WINDOW_MONTHS))
    .order("periodo", { ascending: false });
  if (linhaErr) throw new ReadFailure(`linhas: ${rpcErrorMessage(linhaErr) || "unknown"}`);
  const linhas = (linhaData ?? []) as LinhaRow[];
  if (linhas.length === 0) return [];
  const ids = linhas.map((l) => l.id);

  const [colRes, itemRes, respRes] = await Promise.all([
    // Only visivel_cliente. `oculta` hides a column from the CRM table only (spec 4.2).
    db.from("linha_editorial_colunas")
      .select("id, nome, tipo, config, ordem")
      .eq("conta_id", contaId)
      .eq("visivel_cliente", true)
      .order("ordem", { ascending: true }),
    db.from("linha_editorial_itens")
      .select("id, linha_id, data, tipo, titulo, direcao, valores, ordem")
      .eq("conta_id", contaId)
      .in("linha_id", ids)
      .order("data", { ascending: true, nullsFirst: false })
      .order("ordem", { ascending: true }),
    db.from("linha_editorial_respostas")
      .select("id, linha_id, item_id, acao, comentario, rodada, is_workspace_user, created_at")
      .eq("conta_id", contaId)
      .in("linha_id", ids)
      .order("created_at", { ascending: true }),
  ]);
  if (colRes.error) throw new ReadFailure(`colunas: ${rpcErrorMessage(colRes.error) || "unknown"}`);
  if (itemRes.error) throw new ReadFailure(`itens: ${rpcErrorMessage(itemRes.error) || "unknown"}`);
  if (respRes.error) throw new ReadFailure(`respostas: ${rpcErrorMessage(respRes.error) || "unknown"}`);

  const colunas: HubLinhaColuna[] = ((colRes.data ?? []) as ColunaRow[]).map((c) => ({
    id: c.id,
    nome: c.nome,
    tipo: c.tipo,
    config: c.config,
    ordem: c.ordem,
  }));
  const visible = new Set(colunas.map((c) => c.id));

  const itensByLinha = new Map<string, HubLinhaItem[]>();
  for (const i of (itemRes.data ?? []) as ItemRow[]) {
    // Keys of hidden, deleted or unknown columns never reach the client.
    const valores: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(i.valores ?? {})) {
      if (visible.has(k)) valores[k] = v;
    }
    const list = itensByLinha.get(i.linha_id) ?? [];
    list.push({ id: i.id, data: i.data, tipo: i.tipo, titulo: i.titulo, direcao: i.direcao, valores });
    itensByLinha.set(i.linha_id, list);
  }

  const rodadaOf = new Map(linhas.map((l) => [l.id, l.rodada]));
  const respostasByLinha = new Map<string, HubLinhaResposta[]>();
  for (const r of (respRes.data ?? []) as RespostaRow[]) {
    if (r.rodada !== rodadaOf.get(r.linha_id)) continue;
    const list = respostasByLinha.get(r.linha_id) ?? [];
    list.push({
      id: r.id,
      item_id: r.item_id,
      acao: r.acao,
      comentario: r.comentario,
      is_workspace_user: r.is_workspace_user,
      created_at: r.created_at,
    });
    respostasByLinha.set(r.linha_id, list);
  }

  return linhas.map((l) => ({
    id: l.id,
    periodo: l.periodo,
    status: l.status,
    enviada_at: l.enviada_at,
    decidida_at: l.decidida_at,
    rodada: l.rodada,
    itens: itensByLinha.get(l.id) ?? [],
    colunas,
    respostas: respostasByLinha.get(l.id) ?? [],
  }));
}
