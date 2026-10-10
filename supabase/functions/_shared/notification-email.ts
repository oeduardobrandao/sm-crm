import { escapeHtml } from "./report-template/escape.ts";
import { appBaseUrl } from "./app-url.ts";
import { mesaasEmail } from "./email/shell.ts";
import { badge, callout, heading, link, paragraph, spacer } from "./email/blocks.ts";
import { type BadgeTone, EMAIL } from "./email/tokens.ts";
import { type NotificationRow, type RenderedNotification, renderNotification } from "./notification-render.ts";

export interface DigestItem extends RenderedNotification {
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

export function resolveDigestItem(row: NotificationRow): DigestItem {
  // Object.hasOwn: a type like "constructor" must not hit Object.prototype.
  const b = Object.hasOwn(DIGEST_BADGES, row.type) ? DIGEST_BADGES[row.type] : DEFAULT_BADGE;
  return { ...renderNotification(row), badge: b };
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

/** Comment bodies are unbounded; the full text is one click away in the app. */
const BODY_MAX = 300;
const clamp = (t: string) => (t.length > BODY_MAX ? `${t.slice(0, BODY_MAX).trimEnd()}…` : t);

function itemRow(it: DigestItem, appBase: string, last: boolean): string {
  const b = it.badge ?? DEFAULT_BADGE;
  const bd = last ? "" : `border-bottom: 1px solid ${EMAIL.divider};`;
  return `<tr><td style="padding: 20px 0; ${bd}">
    <p style="margin: 0 0 10px;">${badge(b.tone, b.label)}</p>
    <p style="margin: 0; font-size: 15px; line-height: 22px; font-weight: 700; color: ${EMAIL.ink}; word-break: break-word;">${escapeHtml(it.heading)}</p>
    ${it.context ? paragraph(it.context, "small", "2px 0 0") : ""}
    ${it.body ? spacer(10) + callout(escapeHtml(clamp(it.body))) : ""}
    <p style="margin: 12px 0 0; font-size: 14px;">${link(`${appBase}${it.link}`, "Abrir no Mesaas")}</p>
  </td></tr>`;
}

/** Items rendered in one digest. Each row is ~1.4 KB; past ~67 the HTML
 * crosses Gmail's 102 KB clip and the footer disappears. The rest are
 * summarised in one line that links to the app. */
export const DIGEST_RENDER_CAP = 30;

export function buildDigestHtml(items: DigestItem[], appBase: string): string {
  const n = items.length;
  const shown = items.slice(0, DIGEST_RENDER_CAP);
  const extra = n - shown.length;
  const rows = shown.map((it, i) => itemRow(it, appBase, i === shown.length - 1)).join("");
  return mesaasEmail({
    preheader: digestPreheader(items),
    eyebrow: "Resumo de notificações",
    sections: [
      heading(n === 1 ? "Você tem 1 novidade" : `Você tem ${n} novidades`),
      `<table role="presentation" width="100%" cellpadding="0" cellspacing="0">${rows}</table>`,
      ...(extra > 0
        ? [paragraph(extra === 1 ? "E mais 1 notificação." : `E mais ${extra} notificações.`, "body", "0 0 12px") + link(`${appBase}/dashboard`, "Ver todas no Mesaas")]
        : []),
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
