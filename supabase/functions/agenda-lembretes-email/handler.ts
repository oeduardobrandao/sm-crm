/**
 * agenda-lembretes-email: reminder e-mails for Agenda events.
 *
 * Same two layers as notification-email-cron: an auth wrapper that checks
 * `x-cron-secret` BEFORE any work, and a dependency-injected `run`.
 *
 * Delivery is lease-based: `agenda_claim_emails_lembrete` flips ledger rows to
 * 'enviando' with a 2 min lease and bumps `email_tentativas`; each row is then
 * settled through `agenda_marcar_email_lembrete` (ok -> 'enviado'; not ok ->
 * back to 'pendente' until 3 attempts, then 'falhou'). Rows the 50 s deadline
 * keeps us from reaching are left untouched: the lease expires and the next
 * run re-claims them.
 */
import { buildLembreteEmail } from "../_shared/agenda-email.ts";
import type { sendViaResend } from "../_shared/lifecycle-emails.ts";

interface DbError { message: string }

export interface AgendaLembreteRow {
  ocorrencia_id: number;
  user_id: string;
  minutos: number;
  inicio_alvo: string;
  notification_id: string | null;
  titulo: string;
  inicio: string;
  fim: string;
  dia_inteiro: boolean;
  local: string | null;
  link_reuniao: string | null;
  tz: string;
  tentativas: number;
}

export interface AgendaLembreteDb {
  rpc(
    fn: "agenda_claim_emails_lembrete" | "agenda_marcar_email_lembrete",
    args: Record<string, unknown>,
  ): PromiseLike<{ data: unknown; error: DbError | null }>;
  auth: {
    admin: {
      getUserById(userId: string): PromiseLike<{
        data: { user: { email?: string | null } | null } | null;
        error: DbError | null;
      }>;
    };
  };
}

export interface AgendaLembretesEmailDeps {
  db: AgendaLembreteDb;
  sendEmail: typeof sendViaResend;
  appBaseUrl: string;
  now: () => number;
  deadlineMs?: number;
}

const CLAIM_BATCH_SIZE = 100;
const DEADLINE_MS = 50_000;
const FROM = "Mesaas <notificacoes@mesaas.com.br>";

export async function runAgendaLembretesEmail(
  deps: AgendaLembretesEmailDeps,
): Promise<{ enviados: number; falhas: number }> {
  const deadline = deps.deadlineMs ?? DEADLINE_MS;
  const startedAt = deps.now();

  const { data, error } = await deps.db.rpc("agenda_claim_emails_lembrete", { p_limit: CLAIM_BATCH_SIZE });
  if (error) throw new Error(`agenda_claim_emails_lembrete failed: ${error.message}`);
  const rows = (data ?? []) as AgendaLembreteRow[];

  let enviados = 0;
  let falhas = 0;

  const mark = async (r: AgendaLembreteRow, ok: boolean) => {
    const { error: markErr } = await deps.db.rpc("agenda_marcar_email_lembrete", {
      p_ocorrencia_id: r.ocorrencia_id,
      p_user_id: r.user_id,
      p_minutos: r.minutos,
      p_inicio_alvo: r.inicio_alvo,
      p_ok: ok,
    });
    // A failed mark leaves the row 'enviando'; the lease expiry re-claims it.
    if (markErr) console.error(`[agenda-lembretes-email] mark failed ocorrencia=${r.ocorrencia_id} user=${r.user_id}:`, markErr.message);
  };

  for (const r of rows) {
    if (deps.now() - startedAt > deadline) break;
    let ok = false;
    try {
      const { data: userData, error: userErr } = await deps.db.auth.admin.getUserById(r.user_id);
      if (userErr) throw new Error(userErr.message);
      const email = userData?.user?.email;
      if (!email) throw new Error("user has no email on file");

      const { subject, html } = buildLembreteEmail({
        titulo: r.titulo,
        inicio: r.inicio,
        fim: r.fim,
        diaInteiro: r.dia_inteiro,
        local: r.local,
        linkReuniao: r.link_reuniao,
        tz: r.tz,
        minutos: r.minutos,
        abrirUrl: `${deps.appBaseUrl}/calendario?evento=${r.ocorrencia_id}`,
        appBaseUrl: deps.appBaseUrl,
      });
      const key = `agenda-lembrete:${r.ocorrencia_id}:${r.user_id}:${r.minutos}:${Math.floor(Date.parse(r.inicio_alvo) / 1000)}`;
      await deps.sendEmail(email, subject, html, key, FROM);
      ok = true;
    } catch (e) {
      console.error(
        `[agenda-lembretes-email] send failed ocorrencia=${r.ocorrencia_id} user=${r.user_id}:`,
        e instanceof Error ? e.message : String(e),
      );
    }
    if (ok) enviados++; else falhas++;
    await mark(r, ok);
  }

  return { enviados, falhas };
}

// ─── Auth wrapper (notification-email-cron's shape) ─────────────────────────
interface AgendaLembretesEmailHandlerDeps {
  cronSecret: string;
  run: (req: Request) => Promise<Response>;
  timingSafeEqual: (a: string, b: string) => boolean;
}

export function createAgendaLembretesEmailHandler(deps: AgendaLembretesEmailHandlerDeps) {
  return async (req: Request): Promise<Response> => {
    if (!deps.timingSafeEqual(req.headers.get("x-cron-secret") ?? "", deps.cronSecret)) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { "Content-Type": "application/json" },
      });
    }
    return deps.run(req);
  };
}
