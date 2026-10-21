/**
 * agenda-cliente-email: drains `agenda_emails_cliente`, the client-facing
 * Agenda e-mail queue (invite / change / cancellation / reschedule outcome,
 * spec §5-§6 of 2026-10-07-agenda-hub-design.md).
 *
 * Same two layers as agenda-lembretes-email: an auth wrapper that checks
 * `x-cron-secret` BEFORE any work, and a dependency-injected `run`.
 *
 * Delivery is lease-based: `agenda_cliente_claim_emails` settles gated items
 * as 'descartado', then flips due items to 'enviando' with a 2 min lease and
 * bumps `tentativas`. Each claimed item is settled through
 * `agenda_cliente_marcar_email(id, versao, ok, erro)` (ok -> 'enviado'; not
 * ok -> back to 'pendente' until 3 attempts, then 'falhou'). Items the 50 s
 * deadline keeps us from reaching are handed back through
 * `agenda_cliente_liberar_emails` (attempt refunded) so a slow run never
 * counts against an item it did not try to send.
 *
 * The idempotency key is `agenda-cliente:<id>:<versao>`: an item under lease
 * never changes, so one key always maps to one content.
 *
 * Two recipient kinds (sub-project 4, spec §3.5/§3.6): the claim tags each
 * item with `destinatario`. A client item keeps today's path (Hub button via
 * `resolveHubUrl`, `{c}` unsubscribe token). A guest item never touches the
 * Hub: its button goes to the public invite page
 * `${APP_BASE_URL}/convite/<token>?ocorrencia=<id>`, its unsubscribe token is
 * `{g}`, and `Reply-To` is the organizer's e-mail while they are a member.
 *
 * There is no RESEND_API_KEY gate here (same as agenda-lembretes-email): a
 * missing key makes every send throw, so items end 'falhou' after 3 attempts
 * instead of silently piling up.
 */
import {
  type AgendaClienteEmailItem,
  ehConvidado,
  montarEmailAgendaCliente,
  varianteAgendaCliente,
} from "../_shared/agenda-cliente-email.ts";
import { signUnsubTokenFor } from "../_shared/client-event-email.ts";
import { sanitizeFromName } from "../_shared/email-headers.ts";
import type { sendViaResend } from "../_shared/lifecycle-emails.ts";

interface DbError {
  message: string;
}

export interface AgendaClienteEmailDb {
  rpc(
    fn: "agenda_cliente_claim_emails" | "agenda_cliente_marcar_email" | "agenda_cliente_liberar_emails",
    args: Record<string, unknown>,
  ): PromiseLike<{ data: unknown; error: DbError | null }>;
}

export interface AgendaClienteEmailDeps {
  db: AgendaClienteEmailDb;
  sendEmail: typeof sendViaResend;
  /** `resolveHubUrl(svc, clienteId, contaId)` from _shared/hub-url.ts ("" when no Hub). */
  resolveHubUrl: (clienteId: number, contaId: string) => Promise<string>;
  /** `appBaseUrl()` from _shared/app-url.ts. Throws when APP_BASE_URL is unset:
   * the guest e-mail then goes out without a button (the .ics stays attached). */
  appBaseUrl: () => string;
  /** TOKEN_ENCRYPTION_KEY, read via a throwing IIFE in index.ts. */
  tokenSecret: string;
  /** SUPABASE_URL -- the unsub link is `${unsubBaseUrl}/functions/v1/client-email-unsub/<token>`. */
  unsubBaseUrl: string;
  now: () => number;
  deadlineMs?: number;
}

export interface AgendaClienteEmailResult {
  enviados: number;
  falhas: number;
}

const CLAIM_BATCH_SIZE = 20;
const DEADLINE_MS = 50_000;

/** Resend dedupes on this for 24 h; `versao` changes whenever the content does. */
export function chaveIdempotenciaAgendaCliente(id: number, versao: number): string {
  return `agenda-cliente:${id}:${versao}`;
}

// Reply-To must be one plain address: anything with whitespace or control
// characters (header smuggling) is dropped rather than forwarded.
const REPLY_TO_RE = /^[^@\s<>",;]+@[^@\s<>",;]+\.[^@\s<>",;]+$/;

function replyToSeguro(v: string | null | undefined): string | undefined {
  const t = v?.trim();
  return t && t.length <= 254 && REPLY_TO_RE.test(t) ? t : undefined;
}

/** First still-active occurrence of the snapshot (the button's deep link). */
function primeiraAtiva(item: AgendaClienteEmailItem): number | null {
  return (item.ocorrencias ?? []).find((o) => o.estado === "ativa")?.ocorrencia_id ?? null;
}

/** Guest button: the public invite page, or null (cancellation, removed guest, no APP_BASE_URL). */
function botaoConvidado(item: AgendaClienteEmailItem, appBaseUrl: () => string): string | null {
  const token = item.convidado_token?.trim();
  if (!token || varianteAgendaCliente(item) === "cancelamento") return null;
  let base: string;
  try {
    base = appBaseUrl().replace(/\/+$/, "");
  } catch (e) {
    // Same degradation as resolveHubUrl: a missing env is a logged omission, never a broken link.
    console.error("[agenda-cliente-email] appBaseUrl unavailable:", e instanceof Error ? e.message : "unknown");
    return null;
  }
  if (!base) return null;
  const ocorrencia = primeiraAtiva(item);
  const destino = `${base}/convite/${encodeURIComponent(token)}`;
  return ocorrencia === null ? destino : `${destino}?ocorrencia=${ocorrencia}`;
}

export async function runAgendaClienteEmail(
  deps: AgendaClienteEmailDeps,
): Promise<AgendaClienteEmailResult> {
  const deadline = deps.deadlineMs ?? DEADLINE_MS;
  const startedAt = deps.now();

  const { data, error } = await deps.db.rpc("agenda_cliente_claim_emails", { p_limit: CLAIM_BATCH_SIZE });
  if (error) throw new Error(`agenda_cliente_claim_emails failed: ${error.message}`);
  const items = (Array.isArray(data) ? data : []) as AgendaClienteEmailItem[];

  let enviados = 0;
  let falhas = 0;

  const marcar = async (item: AgendaClienteEmailItem, ok: boolean, erro: string | null) => {
    const { error: markErr } = await deps.db.rpc("agenda_cliente_marcar_email", {
      p_id: item.id,
      p_versao: item.versao,
      p_ok: ok,
      p_erro: erro,
    });
    // A failed mark leaves the item 'enviando'; the lease expiry re-claims it
    // and the idempotency key keeps a resend from reaching the client twice.
    if (markErr) console.error(`[agenda-cliente-email] mark failed item=${item.id}:`, markErr.message);
  };

  for (const [i, item] of items.entries()) {
    if (deps.now() - startedAt > deadline) {
      const ids = items.slice(i).map((it) => it.id);
      const { error: relErr } = await deps.db.rpc("agenda_cliente_liberar_emails", { p_ids: ids });
      // Not fatal: the lease expires and the next run re-claims them anyway.
      if (relErr) console.error("[agenda-cliente-email] release failed:", relErr.message);
      break;
    }
    let ok = false;
    let erro: string | null = null;
    try {
      let to: string | undefined;
      let unsubToken: string;
      let replyTo: string | undefined;
      let ctxBotao: { hubUrl: string; botaoUrl?: string | null };

      if (ehConvidado(item)) {
        to = item.email?.trim();
        // The claim RPC guarantees both; defensive only.
        if (!to) throw new Error("convidado sem e-mail");
        if (typeof item.convidado_id !== "number") throw new Error("convidado sem id");
        unsubToken = await signUnsubTokenFor({ g: item.convidado_id }, deps.tokenSecret);
        replyTo = replyToSeguro(item.organizador_email);
        // Never resolveHubUrl: a guest has no Hub.
        ctxBotao = { hubUrl: "", botaoUrl: botaoConvidado(item, deps.appBaseUrl) };
      } else {
        to = (item.cliente_email ?? item.email)?.trim();
        // The claim RPC already discards items without an e-mail; defensive only.
        if (!to) throw new Error("cliente sem e-mail");
        if (typeof item.cliente_id !== "number") throw new Error("cliente sem id");
        unsubToken = await signUnsubTokenFor({ c: item.cliente_id }, deps.tokenSecret);
        ctxBotao = { hubUrl: await deps.resolveHubUrl(item.cliente_id, item.conta_id) };
      }
      const unsubUrl = `${deps.unsubBaseUrl}/functions/v1/client-email-unsub/${unsubToken}`;

      const { subject, html, attachments } = montarEmailAgendaCliente(item, {
        ...ctxBotao,
        unsubUrl,
        agora: new Date(deps.now()),
      });
      const workspaceName = item.workspace_nome?.trim() || "Mesaas";

      await deps.sendEmail(
        to,
        subject,
        html,
        chaveIdempotenciaAgendaCliente(item.id, item.versao),
        `${sanitizeFromName(workspaceName)} <notificacoes@mesaas.com.br>`,
        // Positional Reply-To (6th arg), never a header: the organizer while still a member.
        replyTo,
        {
          // RFC 8058 one-click unsubscribe, same token as the Hub digest.
          "List-Unsubscribe": `<${unsubUrl}>`,
          "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
        },
        attachments,
      );
      ok = true;
    } catch (e) {
      // Only the error's name is persisted (ultimo_erro); the message goes to the log.
      erro = e instanceof Error ? e.name : "Error";
      console.error(
        `[agenda-cliente-email] send failed item=${item.id} versao=${item.versao}:`,
        e instanceof Error ? e.message : String(e),
      );
    }
    if (ok) enviados++;
    else falhas++;
    await marcar(item, ok, erro);
  }

  return { enviados, falhas };
}

// ─── Auth wrapper (agenda-lembretes-email's shape) ──────────────────────────
interface AgendaClienteEmailHandlerDeps {
  cronSecret: string;
  run: (req: Request) => Promise<Response>;
  timingSafeEqual: (a: string, b: string) => boolean;
}

export function createAgendaClienteEmailHandler(deps: AgendaClienteEmailHandlerDeps) {
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
