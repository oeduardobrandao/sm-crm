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
 * deadline keeps us from reaching are left untouched: the lease expires and
 * the next run re-claims them.
 *
 * The idempotency key is `agenda-cliente:<id>:<versao>`: an item under lease
 * never changes, so one key always maps to one content.
 *
 * There is no RESEND_API_KEY gate here (same as agenda-lembretes-email): a
 * missing key makes every send throw, so items end 'falhou' after 3 attempts
 * instead of silently piling up.
 */
import {
  type AgendaClienteEmailItem,
  montarEmailAgendaCliente,
} from "../_shared/agenda-cliente-email.ts";
import { signUnsubToken } from "../_shared/client-event-email.ts";
import { sanitizeFromName } from "../_shared/email-headers.ts";
import type { sendViaResend } from "../_shared/lifecycle-emails.ts";

interface DbError {
  message: string;
}

export interface AgendaClienteEmailDb {
  rpc(
    fn: "agenda_cliente_claim_emails" | "agenda_cliente_marcar_email",
    args: Record<string, unknown>,
  ): PromiseLike<{ data: unknown; error: DbError | null }>;
}

export interface AgendaClienteEmailDeps {
  db: AgendaClienteEmailDb;
  sendEmail: typeof sendViaResend;
  /** `resolveHubUrl(svc, clienteId, contaId)` from _shared/hub-url.ts ("" when no Hub). */
  resolveHubUrl: (clienteId: number, contaId: string) => Promise<string>;
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

  for (const item of items) {
    if (deps.now() - startedAt > deadline) break;
    let ok = false;
    let erro: string | null = null;
    try {
      const to = item.cliente_email?.trim();
      // The claim RPC already discards items without an e-mail; defensive only.
      if (!to) throw new Error("cliente sem e-mail");

      const hubUrl = await deps.resolveHubUrl(item.cliente_id, item.conta_id);
      const unsubToken = await signUnsubToken(item.cliente_id, deps.tokenSecret);
      const unsubUrl = `${deps.unsubBaseUrl}/functions/v1/client-email-unsub/${unsubToken}`;

      const { subject, html, attachments } = montarEmailAgendaCliente(item, {
        hubUrl,
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
        undefined,
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
