/**
 * agenda-convite: the public invite page API for external Agenda guests
 * (token auth, no Supabase session, deployed with --no-verify-jwt).
 *
 * The 64-hex guest token is the only credential. Every read and write goes
 * through the service-role `agenda_convite_*` RPCs, which resolve the token
 * themselves and check `feature_agenda`, the guest being active, the series
 * not being private and the occurrence belonging to it. This handler does the
 * transport work only, in this order (plan amendment 15):
 *
 *   1. route check (an unknown path does no work);
 *   2. token format `^[0-9a-f]{64}$`, before any database call;
 *   3. `agenda_convite_resolver(p_token)` -> `{ convidado_id, conta_id }` or
 *      NULL. A malformed or unknown token spends `convite-badtoken:<ip>` and
 *      answers 404;
 *   4. the guest's own budget: `convite-read:<convidado_id>` for GETs,
 *      `convite-write:<convidado_id>` for POSTs;
 *   5. `agenda_convite_ler` / `agenda_convite_ocorrencia` /
 *      `agenda_convite_responder`, with the `agenda_convite:<codigo>` map.
 *
 * Spec: docs/superpowers/specs/2026-10-07-agenda-camadas-convidados-design.md §3.7
 */
import { createJsonResponder } from "../_shared/http.ts";
import { getClientIP } from "../_shared/rate-limit.ts";
import { gerarCalendario, type IcsEvento } from "../_shared/ics.ts";

type DbClient = {
  rpc: (fn: string, params: Record<string, unknown>) => PromiseLike<{ data: unknown; error: unknown }>;
};

export interface AgendaConviteAuditEntry {
  conta_id?: string;
  action: string;
  resource_type: string;
  resource_id?: string;
  metadata?: Record<string, unknown>;
}

export interface AgendaConviteHandlerDeps {
  buildCorsHeaders: (req: Request) => Record<string, string>;
  createDb: () => DbClient;
  now: () => string;
  rateLimit: (db: DbClient, key: string, max: number, windowSeconds: number) => Promise<boolean>;
  /** `insertAuditLog(svc, entry)` wired in index.ts. Failures must never break the write. */
  auditLog: (entry: AgendaConviteAuditEntry) => Promise<void>;
}

/** One occurrence as the convite RPCs return it (the plan's `ConviteItem`). */
interface ConviteItem {
  ocorrencia_id: number;
  sequencia?: number;
  inicio: string;
  fim: string;
  dia_inteiro: boolean;
  data_inicio_local: string | null;
  data_fim_local: string | null;
  titulo: string;
  descricao?: string | null;
  local?: string | null;
  link_reuniao?: string | null;
}

interface ConviteLeitura {
  estado?: string;
  workspace?: unknown;
  organizador_nome?: unknown;
  titulo?: unknown;
  itens?: unknown;
}

const MSG_RATE = "Muitas tentativas. Tente de novo em alguns minutos.";
const MSG_INDISPONIVEL = "Este convite não está mais disponível.";
const MSG_INVALID = "Dados inválidos.";
const MSG_INTERNAL = "Erro interno";

/** `agenda_convite:<codigo>` (RAISE EXCEPTION, P0001) to the HTTP contract. */
const RPC_ERRORS: Record<string, { status: number; message: string }> = {
  nao_encontrado: { status: 404, message: MSG_INDISPONIVEL },
  desligado: { status: 404, message: MSG_INDISPONIVEL },
  horario_mudou: { status: 409, message: "Este evento mudou de horário. Atualize a página." },
  ja_aconteceu: { status: 409, message: "Este evento já aconteceu." },
};

const RPC_CODE_RE = /^\s*agenda_convite:(\w+)\s*$/;
const TOKEN_RE = /^[0-9a-f]{64}$/;
const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})$/;
const OCORRENCIA_ICS_RE = /^(\d+)\.ics$/;

class RpcFailure extends Error {
  constructor(readonly response: { status: number; message: string }) {
    super("rpc failure");
  }
}

/** Positive safe integer from a JSON number or a decimal string, else null. */
function parseId(raw: unknown): number | null {
  if (typeof raw === "number") return Number.isSafeInteger(raw) && raw >= 1 ? raw : null;
  if (typeof raw !== "string" || !/^\d+$/.test(raw)) return null;
  const n = parseInt(raw, 10);
  return Number.isSafeInteger(n) && n >= 1 ? n : null;
}

function isIso(v: unknown): v is string {
  return typeof v === "string" && ISO_RE.test(v) && !Number.isNaN(Date.parse(v));
}

// The three helpers below mirror hub-agenda/handler.ts (same download naming
// and the same .ics shape). Copied, not imported: edge functions deploy as
// independent bundles and a cross-function import is not a pattern this repo uses.

/** Lowercase ASCII-only file stem; "evento" when nothing survives (e.g. emoji-only titles). */
function slugAscii(titulo: string): string {
  const slug = titulo
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^A-Za-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase()
    .slice(0, 60)
    .replace(/-+$/g, "");
  return slug || "evento";
}

/** RFC 5987 attr-char encoding: encodeURIComponent plus the chars it leaves bare. */
function encodeRfc5987(v: string): string {
  return encodeURIComponent(v).replace(/['()*]/g, (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase());
}

function contentDisposition(titulo: string): string {
  const stem = Array.from(titulo.trim()).slice(0, 80).join("") || "evento";
  return `attachment; filename="${slugAscii(titulo)}.ics"; filename*=UTF-8''${encodeRfc5987(stem)}.ics`;
}

function paraIcs(i: ConviteItem): IcsEvento {
  return {
    uid: `agenda-oc-${i.ocorrencia_id}@mesaas.com.br`,
    inicio: new Date(i.inicio),
    fim: new Date(i.fim),
    diaInteiro: i.dia_inteiro,
    dataInicio: i.data_inicio_local ?? undefined,
    dataFim: i.data_fim_local ?? undefined,
    titulo: i.titulo,
    descricao: i.descricao,
    local: i.local,
    url: i.link_reuniao,
    // The same SEQUENCE the e-mails carried, or a calendar app would ignore this file.
    sequencia: i.sequencia,
  };
}

/** `agenda_convite_resolver` result, validated. */
function lerResolucao(data: unknown): { convidado_id: number; conta_id: string } | null {
  if (!data || typeof data !== "object") return null;
  const r = data as { convidado_id?: unknown; conta_id?: unknown };
  const convidadoId = parseId(r.convidado_id);
  if (convidadoId === null || typeof r.conta_id !== "string" || r.conta_id === "") return null;
  return { convidado_id: convidadoId, conta_id: r.conta_id };
}

export function createAgendaConviteHandler(deps: AgendaConviteHandlerDeps) {
  return async (req: Request): Promise<Response> => {
    const cors = deps.buildCorsHeaders(req);
    const json = createJsonResponder(cors);
    const fail = (status: number, message: string) => json({ error: message }, status);

    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    if (req.method !== "GET" && req.method !== "POST") return fail(405, "Método não permitido.");

    const url = new URL(req.url);
    const pathParts = url.pathname.split("/").filter(Boolean);
    const idx = pathParts.indexOf("agenda-convite");
    const seg = idx >= 0 ? pathParts.slice(idx + 1) : [];

    // Route first: an unknown path does no database work at all.
    let icsId: number | null = null;
    let isIcsRoute = false;
    if (seg.length === 2 && seg[0] === "ocorrencia") {
      const m = OCORRENCIA_ICS_RE.exec(seg[1]);
      if (!m || req.method !== "GET") return fail(404, "Não encontrado");
      isIcsRoute = true;
      icsId = parseId(m[1]);
      if (icsId === null) return fail(404, "Não encontrado");
    } else if (seg.length !== 0) {
      return fail(404, "Não encontrado");
    }

    // The body is read once; the token may live in it (POST) or in the query.
    let body: Record<string, unknown> | null = null;
    if (req.method === "POST") {
      const parsed = await req.json().catch(() => null);
      body = parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : null;
    }

    const rawToken = url.searchParams.get("token") ?? body?.token;
    // No token at all is a malformed request, not a guess: no budget spent.
    if (typeof rawToken !== "string" || rawToken === "") return fail(400, MSG_INVALID);

    const db = deps.createDb();

    const tokenRuim = async (): Promise<Response> => {
      const ok = await deps.rateLimit(db, `convite-badtoken:${getClientIP(req)}`, 30, 600);
      if (!ok) return fail(429, MSG_RATE);
      return fail(404, MSG_INDISPONIVEL);
    };

    // Format check before any RPC: a malformed token never reaches Postgres.
    if (!TOKEN_RE.test(rawToken)) return await tokenRuim();
    const token = rawToken;

    /** Runs an RPC; throws RpcFailure with the mapped response on any error. */
    const rpc = async (fn: string, params: Record<string, unknown>): Promise<unknown> => {
      const { data, error } = await db.rpc(fn, params);
      if (!error) return data;
      const e = error as { code?: unknown; message?: unknown };
      const m = typeof e.message === "string" ? RPC_CODE_RE.exec(e.message) : null;
      const mapped = m ? RPC_ERRORS[m[1]] : undefined;
      // Only the code is logged: the message can carry row data.
      console.error(`[agenda-convite] ${fn} failed:`, m ? m[1] : String(e.code ?? "unknown"));
      throw new RpcFailure(mapped ?? { status: 500, message: MSG_INTERNAL });
    };

    const audit = async (entry: AgendaConviteAuditEntry) => {
      try {
        await deps.auditLog(entry);
      } catch (e) {
        console.error("[agenda-convite] audit failed:", e instanceof Error ? e.message : "unknown");
      }
    };

    try {
      const resolucao = lerResolucao(await rpc("agenda_convite_resolver", { p_token: token }));
      if (!resolucao) return await tokenRuim();
      const { convidado_id: convidadoId, conta_id: contaId } = resolucao;

      if (req.method === "GET") {
        const okRead = await deps.rateLimit(db, `convite-read:${convidadoId}`, 300, 300);
        if (!okRead) return fail(429, MSG_RATE);
      } else {
        const okWrite = await deps.rateLimit(db, `convite-write:${convidadoId}`, 20, 600);
        if (!okWrite) return fail(429, MSG_RATE);
      }

      // ---- GET /ocorrencia/<id>.ics?token= ---------------------------------
      if (isIcsRoute) {
        const item = await rpc("agenda_convite_ocorrencia", {
          p_token: token,
          p_ocorrencia: icsId,
        }) as ConviteItem | null;
        if (!item) return fail(404, MSG_INDISPONIVEL);

        const corpo = gerarCalendario({
          nome: item.titulo,
          eventos: [paraIcs(item)],
          agora: new Date(deps.now()),
        });
        return new Response(corpo, {
          status: 200,
          headers: {
            ...cors,
            "Content-Type": "text/calendar; charset=utf-8",
            "Content-Disposition": contentDisposition(item.titulo),
            "Cache-Control": "private, no-store",
          },
        });
      }

      // ---- GET ?token= -------------------------------------------------------
      if (req.method === "GET") {
        const leitura = await rpc("agenda_convite_ler", { p_token: token }) as ConviteLeitura | null;
        if (!leitura || leitura.estado !== "ok") return fail(404, MSG_INDISPONIVEL);
        // Exactly the public contract: `estado`, `convidado_id` and `conta_id`
        // stay server-side.
        return json({
          workspace: leitura.workspace ?? null,
          organizador_nome: leitura.organizador_nome ?? null,
          titulo: leitura.titulo ?? null,
          itens: Array.isArray(leitura.itens) ? leitura.itens : [],
        });
      }

      // ---- POST { token, acao: "responder", ... } ----------------------------
      if (!body || body.acao !== "responder") return fail(400, MSG_INVALID);

      const ocorrenciaId = parseId(body.ocorrencia_id);
      const resposta = body.resposta;
      if (ocorrenciaId === null || (resposta !== "sim" && resposta !== "nao") || !isIso(body.inicio_visto)) {
        return fail(400, MSG_INVALID);
      }
      const item = await rpc("agenda_convite_responder", {
        p_token: token,
        p_ocorrencia: ocorrenciaId,
        p_resposta: resposta,
        p_inicio_visto: body.inicio_visto,
      });
      // Never the token or the guest's e-mail in the audit trail.
      await audit({
        conta_id: contaId,
        action: "agenda_convite_responder",
        resource_type: "agenda_ocorrencia",
        resource_id: String(ocorrenciaId),
        metadata: { convidado_id: convidadoId, resposta },
      });
      return json({ item });
    } catch (e) {
      if (e instanceof RpcFailure) return fail(e.response.status, e.response.message);
      console.error("[agenda-convite] unexpected error:", e instanceof Error ? e.message : "unknown");
      return fail(500, MSG_INTERNAL);
    }
  };
}
