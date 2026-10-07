/**
 * hub-agenda: the client portal's Agenda API (token auth, no Supabase session).
 *
 * Every read and write goes through the service-role `agenda_hub_*` RPCs, which
 * receive the `conta_id` / `cliente_id` resolved from the token (never from the
 * request) and check `feature_agenda`, the client's status, ownership and the
 * share flag themselves. This handler does the transport work only: token and
 * rate-limit gates, body validation, the `agenda_hub:<codigo>` error map, the
 * per-occurrence `.ics` download and the audit trail for writes.
 *
 * Spec: docs/superpowers/specs/2026-10-07-agenda-hub-design.md (sections 6, 7)
 */
import { createJsonResponder } from "../_shared/http.ts";
import { resolveHubToken } from "../_shared/hub-token.ts";
import { getClientIP } from "../_shared/rate-limit.ts";
import { gerarCalendario, type IcsEvento } from "../_shared/ics.ts";

type DbClient = {
  from: (table: string) => any;
  rpc: (fn: string, params: Record<string, unknown>) => PromiseLike<{ data: unknown; error: unknown }>;
};

export interface HubAgendaAuditEntry {
  conta_id?: string;
  action: string;
  resource_type: string;
  resource_id?: string;
  metadata?: Record<string, unknown>;
}

export interface HubAgendaHandlerDeps {
  buildCorsHeaders: (req: Request) => Record<string, string>;
  createDb: () => DbClient;
  now: () => string;
  rateLimit: (db: DbClient, key: string, max: number, windowSeconds: number) => Promise<boolean>;
  /** `insertAuditLog(svc, entry)` wired in index.ts. Failures must never break the write. */
  auditLog: (entry: HubAgendaAuditEntry) => Promise<void>;
}

/** One occurrence as the Hub RPCs return it (see the plan's `Item`). */
interface HubAgendaItem {
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

const MSG_RATE = "Muitas tentativas. Aguarde alguns minutos.";
const MSG_NOT_FOUND = "Evento não encontrado.";
const MSG_INVALID = "Dados inválidos.";
const MSG_INTERNAL = "Erro interno";
const MAX_MENSAGEM = 1000;

/** `agenda_hub:<codigo>` (RAISE EXCEPTION, P0001) to the HTTP contract. */
const RPC_ERRORS: Record<string, { status: number; message: string }> = {
  nao_encontrado: { status: 404, message: MSG_NOT_FOUND },
  desligado: { status: 404, message: MSG_NOT_FOUND },
  horario_mudou: { status: 409, message: "Este evento mudou de horário. Atualize a página." },
  ja_aconteceu: { status: 409, message: "Este evento já aconteceu." },
  sugestao_passada: { status: 400, message: "Escolha um horário no futuro." },
  hora_obrigatoria: { status: 400, message: "Informe o horário." },
  pedido_pendente: { status: 409, message: "Já existe um pedido de remarcação para este evento." },
  ja_resolvido: { status: 409, message: "Este pedido já foi resolvido." },
};

const RPC_CODE_RE = /^\s*agenda_hub:(\w+)\s*$/;
const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})$/;
const DATA_RE = /^\d{4}-\d{2}-\d{2}$/;
const HORA_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
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

/** A real calendar date, not just four-two-two digits (rejects 2026-02-31). */
function isDataValida(v: unknown): v is string {
  if (typeof v !== "string" || !DATA_RE.test(v)) return false;
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
}

// The two helpers below mirror agenda-feed/handler.ts (same download naming).
// They are copied, not imported: edge functions deploy as independent bundles
// and a cross-function import is not a pattern this repo uses.

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

function paraIcs(i: HubAgendaItem): IcsEvento {
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

export function createHubAgendaHandler(deps: HubAgendaHandlerDeps) {
  return async (req: Request): Promise<Response> => {
    const cors = deps.buildCorsHeaders(req);
    const json = createJsonResponder(cors);
    const fail = (status: number, message: string) => json({ error: message }, status);

    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    if (req.method !== "GET" && req.method !== "POST") return fail(405, "Method not allowed");

    const url = new URL(req.url);
    const pathParts = url.pathname.split("/").filter(Boolean);
    const idx = pathParts.indexOf("hub-agenda");
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
    if (typeof rawToken !== "string" || rawToken === "") return fail(400, MSG_INVALID);
    const token = rawToken;

    const db = deps.createDb();

    const hubToken = await resolveHubToken(db as any, token, deps.now());
    if (!hubToken) {
      const okBadToken = await deps.rateLimit(db, `hub-badtoken:${getClientIP(req)}`, 30, 600);
      if (!okBadToken) return fail(429, MSG_RATE);
      return fail(404, "Link inválido.");
    }

    const contaId = hubToken.conta_id;
    const clienteId = hubToken.cliente_id;

    const okRead = await deps.rateLimit(db, `hub-read:${contaId}:${clienteId}`, 300, 300);
    if (!okRead) return fail(429, MSG_RATE);

    if (req.method === "POST") {
      const okWrite = await deps.rateLimit(db, `hub-write:hub-agenda:${contaId}:${clienteId}`, 60, 3600);
      if (!okWrite) return fail(429, MSG_RATE);
    }

    /** Runs an RPC; throws RpcFailure with the mapped response on any error. */
    const rpc = async (fn: string, params: Record<string, unknown>): Promise<unknown> => {
      const { data, error } = await db.rpc(fn, params);
      if (!error) return data;
      const e = error as { code?: unknown; message?: unknown };
      const m = typeof e.message === "string" ? RPC_CODE_RE.exec(e.message) : null;
      const mapped = m ? RPC_ERRORS[m[1]] : undefined;
      // Only the code is logged: the message can carry row data.
      console.error(`[hub-agenda] ${fn} failed:`, m ? m[1] : String(e.code ?? "unknown"));
      throw new RpcFailure(mapped ?? { status: 500, message: MSG_INTERNAL });
    };

    const audit = async (entry: HubAgendaAuditEntry) => {
      try {
        await deps.auditLog(entry);
      } catch (e) {
        console.error("[hub-agenda] audit failed:", e instanceof Error ? e.message : "unknown");
      }
    };

    try {
      // ---- GET /ocorrencia/<id>.ics ---------------------------------------
      if (isIcsRoute) {
        const item = await rpc("agenda_hub_ocorrencia", {
          p_conta: contaId,
          p_cliente: clienteId,
          p_ocorrencia: icsId,
        }) as HubAgendaItem | null;
        if (!item) return fail(404, MSG_NOT_FOUND);

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

      // ---- GET ?token=[&ocorrencia=N | &apos_inicio=&apos_id=] ------------
      if (req.method === "GET") {
        const ocParam = url.searchParams.get("ocorrencia");
        if (ocParam !== null) {
          const id = parseId(ocParam);
          if (id === null) return fail(400, MSG_INVALID);
          const item = await rpc("agenda_hub_ocorrencia", {
            p_conta: contaId,
            p_cliente: clienteId,
            p_ocorrencia: id,
          });
          if (!item) return fail(404, MSG_NOT_FOUND);
          return json({ item });
        }

        const aposInicio = url.searchParams.get("apos_inicio");
        const aposIdRaw = url.searchParams.get("apos_id");
        let aposId: number | null = null;
        // The keyset cursor is (inicio, id): both halves or neither.
        if ((aposInicio === null) !== (aposIdRaw === null)) return fail(400, MSG_INVALID);
        if (aposInicio !== null) {
          aposId = parseId(aposIdRaw);
          if (!isIso(aposInicio) || aposId === null) return fail(400, MSG_INVALID);
        }

        const lista = await rpc("agenda_hub_listar", {
          p_conta: contaId,
          p_cliente: clienteId,
          p_apos_inicio: aposInicio,
          p_apos_id: aposId,
        }) as { estado?: string; itens?: unknown[]; proximo?: unknown } | null;
        if (!lista || lista.estado !== "ok") return fail(404, MSG_NOT_FOUND);
        return json({ itens: lista.itens ?? [], proximo: lista.proximo ?? null });
      }

      // ---- POST { acao } ---------------------------------------------------
      if (!body) return fail(400, MSG_INVALID);
      const acao = body.acao;

      if (acao === "responder") {
        const ocorrenciaId = parseId(body.ocorrencia_id);
        const resposta = body.resposta;
        if (
          ocorrenciaId === null || (resposta !== "sim" && resposta !== "nao") || !isIso(body.inicio_visto)
        ) {
          return fail(400, MSG_INVALID);
        }
        const item = await rpc("agenda_hub_responder", {
          p_conta: contaId,
          p_cliente: clienteId,
          p_ocorrencia: ocorrenciaId,
          p_resposta: resposta,
          p_inicio_visto: body.inicio_visto,
        });
        await audit({
          conta_id: contaId,
          action: "hub_agenda_responder",
          resource_type: "agenda_ocorrencia",
          resource_id: String(ocorrenciaId),
          metadata: { cliente_id: clienteId, resposta },
        });
        return json({ item });
      }

      if (acao === "remarcar") {
        const ocorrenciaId = parseId(body.ocorrencia_id);
        const hora = body.hora ?? null;
        const mensagemRaw = body.mensagem ?? "";
        if (
          ocorrenciaId === null ||
          !isDataValida(body.data) ||
          (hora !== null && (typeof hora !== "string" || !HORA_RE.test(hora))) ||
          typeof mensagemRaw !== "string" ||
          mensagemRaw.length > MAX_MENSAGEM
        ) {
          return fail(400, MSG_INVALID);
        }
        const mensagem = mensagemRaw.trim();
        const item = await rpc("agenda_hub_remarcar", {
          p_conta: contaId,
          p_cliente: clienteId,
          p_ocorrencia: ocorrenciaId,
          p_data: body.data,
          p_hora: hora,
          p_mensagem: mensagem === "" ? null : mensagem,
        });
        await audit({
          conta_id: contaId,
          action: "hub_agenda_remarcar",
          resource_type: "agenda_ocorrencia",
          resource_id: String(ocorrenciaId),
          metadata: { cliente_id: clienteId, data: body.data, hora },
        });
        return json({ item });
      }

      if (acao === "cancelar_remarcacao") {
        const remarcacaoId = parseId(body.remarcacao_id);
        if (remarcacaoId === null) return fail(400, MSG_INVALID);
        await rpc("agenda_hub_cancelar_remarcacao", {
          p_conta: contaId,
          p_cliente: clienteId,
          p_remarcacao: remarcacaoId,
        });
        // The RPC returns void, so the occurrence id is not known here.
        await audit({
          conta_id: contaId,
          action: "hub_agenda_cancelar_remarcacao",
          resource_type: "agenda_ocorrencia",
          metadata: { cliente_id: clienteId, remarcacao_id: remarcacaoId },
        });
        return json({ ok: true });
      }

      return fail(400, MSG_INVALID);
    } catch (e) {
      if (e instanceof RpcFailure) return fail(e.response.status, e.response.message);
      console.error("[hub-agenda] unexpected error:", e instanceof Error ? e.message : "unknown");
      return fail(500, MSG_INTERNAL);
    }
  };
}
