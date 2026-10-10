import { escapeHtml } from "./report-template/escape.ts";
import { appBaseUrl } from "./app-url.ts";
import { getPublishErrorDisplay } from "./publish-error-codes.ts";
import { mesaasEmail } from "./email/shell.ts";
import { badge, callout, heading, link, paragraph, spacer } from "./email/blocks.ts";
import type { BadgeTone } from "./email/tokens.ts";

export interface DigestItem {
  priority: number;
  heading: string;
  body?: string;
  context?: string;
  link: string;
  /** Optional: absent renders the neutral "Notificação" badge. */
  badge?: { tone: BadgeTone; label: string };
}

const DIGEST_BADGES: Record<string, { tone: BadgeTone; label: string }> = {
  post_publish_failed: { tone: "danger", label: "Falha na publicação" },
  post_correction: { tone: "warning", label: "Correção" },
  post_approved: { tone: "success", label: "Aprovado" },
  post_message: { tone: "info", label: "Mensagem" },
  client_message: { tone: "info", label: "Mensagem" },
  mention: { tone: "info", label: "Menção" },
  deadline_approaching: { tone: "warning", label: "Prazo" },
  task_assigned: { tone: "neutral", label: "Tarefa" },
  post_assigned: { tone: "neutral", label: "Post" },
  event_invited: { tone: "neutral", label: "Agenda" },
  event_updated: { tone: "neutral", label: "Agenda" },
  event_cancelled: { tone: "neutral", label: "Agenda" },
  event_client_rsvp: { tone: "info", label: "Resposta" },
  event_guest_rsvp: { tone: "info", label: "Resposta" },
  event_reschedule_requested: { tone: "warning", label: "Remarcação" },
};
const DEFAULT_BADGE = { tone: "neutral" as const, label: "Notificação" };

const DIGEST_FROM = "Mesaas <notificacoes@mesaas.com.br>";

function s(metadata: Record<string, unknown> | null, key: string): string | undefined {
  const v = metadata?.[key];
  return typeof v === "string" && v.length > 0 ? v : undefined;
}

function ctx(a?: string, b?: string): string | undefined {
  return [a, b].filter(Boolean).join(" · ") || undefined;
}

function eventHeading(prefix: string, titulo?: string): string {
  return titulo ? `${prefix}: ${titulo}` : prefix;
}

/** Map a claimed notification row to a rendered digest item. Metadata keys are
 * read defensively (verified against the emitting triggers); anything missing
 * degrades to a generic line rather than throwing. Priority = urgency order. */
function resolveDigestItemBase(
  row: { type: string; metadata: Record<string, unknown> | null; link: string | null },
): DigestItem {
  const m = row.metadata;
  const link = row.link ?? "/";
  switch (row.type) {
    case "post_publish_failed": {
      const d = getPublishErrorDisplay(s(m, "publish_error_code"));
      return { priority: 1, heading: d.titulo, body: d.explicacao, context: ctx(s(m, "client_name"), s(m, "post_title")), link };
    }
    case "post_correction":
      return { priority: 2, heading: "Correção solicitada pelo cliente", body: s(m, "comentario"), context: ctx(s(m, "client_name"), s(m, "post_title")), link };
    case "post_message":
      return { priority: 2, heading: "Nova mensagem no post", body: s(m, "comentario"), context: ctx(s(m, "client_name"), s(m, "post_title")), link };
    case "client_message":
      return { priority: 2, heading: "Nova mensagem do cliente", body: s(m, "comentario"), context: s(m, "client_name"), link };
    case "deadline_approaching":
      return { priority: 3, heading: "Prazo se aproximando", body: ctx(s(m, "workflow_title"), s(m, "step_name")), context: s(m, "client_name"), link };
    case "task_assigned":
      return { priority: 4, heading: "Tarefa atribuída a você", body: s(m, "task_title"), context: s(m, "client_name"), link };
    case "post_assigned":
      return { priority: 4, heading: "Post atribuído a você", body: s(m, "post_title"), context: s(m, "client_name"), link };
    case "mention":
      return { priority: 5, heading: `${s(m, "actor_name") ?? "Alguém"} mencionou você`, body: s(m, "excerpt"), context: s(m, "context_title"), link };
    case "post_approved":
      return { priority: 6, heading: "Post aprovado pelo cliente", body: s(m, "comentario"), context: ctx(s(m, "client_name"), s(m, "post_title")), link };
    case "event_invited":
      return { priority: 4, heading: `${s(m, "ator_nome") ?? "Alguém"} convidou você para um evento`, body: s(m, "titulo"), context: m?.recorrente === true ? "Evento recorrente" : undefined, link };
    case "event_updated":
      return { priority: 3, heading: eventHeading("Evento alterado", s(m, "titulo")), context: m?.recorrente === true ? "Evento recorrente" : undefined, link };
    case "event_cancelled": {
      // metadata.motivo is an enum ('removido' = you were taken off the event), never display text.
      const heading = s(m, "motivo") === "removido"
        ? `Você foi removido de ${s(m, "titulo") ?? "um evento"}`
        : eventHeading("Evento cancelado", s(m, "titulo"));
      return { priority: 3, heading, context: m?.recorrente === true ? "Evento recorrente" : undefined, link };
    }
    // The two client-side Agenda types have no actor (the Hub client is not a
    // user): the copy reads `cliente_nome` and never `ator_nome`. The metadata
    // carries no time zone, so `inicio`/`inicio_sugerido` are not rendered.
    case "event_client_rsvp": {
      const resposta = s(m, "resposta");
      const prefix = resposta === "sim"
        ? "Cliente confirmou presença"
        : resposta === "nao"
        ? "Cliente recusou o evento"
        : "Cliente respondeu ao evento";
      return { priority: 4, heading: eventHeading(prefix, s(m, "titulo")), context: s(m, "cliente_nome"), link };
    }
    // External guest answered on the public invite page (sub-project 4, spec
    // §3.8). Like the client types there is no actor: the guest is named by
    // `convidado_nome`, falling back to the address they were invited at.
    case "event_guest_rsvp": {
      const quem = s(m, "convidado_nome") ?? s(m, "convidado_email") ?? "Convidado";
      const resposta = s(m, "resposta");
      const prefix = resposta === "sim"
        ? `${quem} confirmou presença`
        : resposta === "nao"
        ? `${quem} recusou o evento`
        : `${quem} respondeu ao evento`;
      return { priority: 4, heading: eventHeading(prefix, s(m, "titulo")), context: "Convidado externo", link };
    }
    case "event_reschedule_requested":
      return {
        priority: 2,
        heading: eventHeading("Cliente pediu para remarcar", s(m, "titulo")),
        context: s(m, "cliente_nome"),
        link,
      };
    default:
      return { priority: 9, heading: "Nova notificação no Mesaas", context: undefined, link };
  }
}

export function resolveDigestItem(
  row: { type: string; metadata: Record<string, unknown> | null; link: string | null },
): DigestItem {
  // Object.hasOwn: a type like "constructor" must not hit Object.prototype.
  const b = Object.hasOwn(DIGEST_BADGES, row.type) ? DIGEST_BADGES[row.type] : DEFAULT_BADGE;
  return { ...resolveDigestItemBase(row), badge: b };
}

export function digestSubject(items: DigestItem[]): string {
  if (items.length === 1) {
    // Name the single item by its heading (already em-dash-free).
    return `${items[0].heading} no Mesaas`;
  }
  return `Você tem ${items.length} novidades no Mesaas`;
}

export function digestPreheader(items: DigestItem[]): string {
  const titles = items.slice(0, 3).map((i) => i.heading);
  const rest = items.length - titles.length;
  if (rest > 0) return `${titles.join(", ")} e mais ${rest}.`;
  if (titles.length <= 1) return `${titles[0] ?? "Você tem novidades no Mesaas"}.`;
  return `${titles.slice(0, -1).join(", ")} e ${titles[titles.length - 1]}.`;
}

function itemRow(it: DigestItem, appBase: string, last: boolean): string {
  const b = it.badge ?? DEFAULT_BADGE;
  const bd = last ? "" : "border-bottom: 1px solid #eef0f3;";
  return `<tr><td style="padding: 20px 0; ${bd}">
    <p style="margin: 0 0 10px;">${badge(b.tone, b.label)}</p>
    <p style="margin: 0; font-size: 15px; line-height: 22px; font-weight: 700; color: #12151a; word-break: break-word;">${escapeHtml(it.heading)}</p>
    ${it.context ? paragraph(it.context, "small", "2px 0 0") : ""}
    ${it.body ? spacer(10) + callout(escapeHtml(it.body)) : ""}
    <p style="margin: 12px 0 0; font-size: 14px;">${link(`${appBase}${it.link}`, "Abrir no Mesaas")}</p>
  </td></tr>`;
}

export function buildDigestHtml(items: DigestItem[], appBase: string): string {
  const n = items.length;
  const rows = items.map((it, i) => itemRow(it, appBase, i === n - 1)).join("");
  return mesaasEmail({
    preheader: digestPreheader(items),
    eyebrow: "Resumo de notificações",
    sections: [
      heading(n === 1 ? "Você tem 1 novidade" : `Você tem ${n} novidades`),
      `<table role="presentation" width="100%" cellpadding="0" cellspacing="0">${rows}</table>`,
    ],
    footerLines: ["Você recebeu este e-mail porque tem notificações não lidas no Mesaas. Ajuste em Configurações · Notificações."],
  });
}

/** Stable per (user, exact claimed id set); order-insensitive. Used as the
 * Resend Idempotency-Key so a transient-retry re-claim of the same batch is
 * 409'd (deduped) rather than re-sent. */
export async function buildDigestIdempotencyKey(userId: string, ids: string[]): Promise<string> {
  const payload = [...ids].sort().join(",");
  const digest = await crypto.subtle.digest("SHA-1", new TextEncoder().encode(payload));
  const hex = Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
  return `notif-digest:${userId}:${hex.slice(0, 16)}`;
}

export async function sendNotificationDigestEmail(
  p: { to: string; items: DigestItem[]; idempotencyKey: string },
): Promise<{ skipped: boolean }> {
  const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
  if (!RESEND_API_KEY) return { skipped: true };
  if (p.items.length === 0) return { skipped: true };

  const base = appBaseUrl();
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${RESEND_API_KEY}`,
      "Content-Type": "application/json",
      "Idempotency-Key": p.idempotencyKey,
    },
    body: JSON.stringify({
      from: DIGEST_FROM,
      to: [p.to],
      subject: digestSubject(p.items),
      html: buildDigestHtml(p.items, base),
    }),
    signal: AbortSignal.timeout(10_000),
  });
  // 409 = this Idempotency-Key was already accepted (a prior retry landed this
  // exact digest). Treat as a successful, deduped send, not a failure.
  if (res.status === 409) return { skipped: false };
  if (!res.ok) throw new Error(`Resend send failed: ${res.status}`);
  return { skipped: false };
}
