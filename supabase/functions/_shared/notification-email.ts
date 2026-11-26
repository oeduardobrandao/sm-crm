import { escapeHtml } from "./report-template/escape.ts";
import { appBaseUrl } from "./app-url.ts";
import { mesaasEmail } from "./email/shell.ts";
import { badge, callout, heading, link, paragraph, spacer } from "./email/blocks.ts";
import { type BadgeTone, EMAIL } from "./email/tokens.ts";
import type { Lang } from "./i18n/lang.ts";
import { notificationsText } from "./i18n/catalogs/notifications.ts";
import { type NotificationRow, type RenderedNotification, renderNotification } from "./notification-render.ts";

export interface DigestItem extends RenderedNotification {
  /** Optional: absent renders the neutral "Notificação" badge. */
  badge?: { tone: BadgeTone; label: string };
}

type BadgeKey = keyof ReturnType<typeof notificationsText>["badges"];

const DIGEST_BADGES: Record<string, { tone: BadgeTone; key: BadgeKey }> = {
  post_publish_failed: { tone: "danger", key: "post_publish_failed" },
  post_correction: { tone: "warning", key: "post_correction" },
  post_approved: { tone: "success", key: "post_approved" },
  post_message: { tone: "info", key: "message" },
  client_message: { tone: "info", key: "message" },
  mention: { tone: "info", key: "mention" },
  deadline_approaching: { tone: "warning", key: "deadline_approaching" },
  task_assigned: { tone: "neutral", key: "task_assigned" },
  post_assigned: { tone: "neutral", key: "post_assigned" },
  event_invited: { tone: "neutral", key: "agenda" },
  event_updated: { tone: "neutral", key: "agenda" },
  event_cancelled: { tone: "neutral", key: "agenda" },
  event_client_rsvp: { tone: "info", key: "rsvp" },
  event_guest_rsvp: { tone: "info", key: "rsvp" },
  event_reschedule_requested: { tone: "warning", key: "reschedule" },
  linha_editorial_aprovada: { tone: "success", key: "linha_aprovada" },
  linha_editorial_ajustes: { tone: "warning", key: "linha_ajustes" },
};

function defaultBadge(lang: Lang): { tone: BadgeTone; label: string } {
  return { tone: "neutral", label: notificationsText(lang).badges.default };
}

const DIGEST_FROM = "Mesaas <notificacoes@mesaas.com.br>";

export function resolveDigestItem(row: NotificationRow, lang: Lang): DigestItem {
  // Object.hasOwn: a type like "constructor" must not hit Object.prototype.
  const def = Object.hasOwn(DIGEST_BADGES, row.type) ? DIGEST_BADGES[row.type] : null;
  const badge = def ? { tone: def.tone, label: notificationsText(lang).badges[def.key] } : defaultBadge(lang);
  return { ...renderNotification(row, lang), badge };
}

export function digestSubject(items: DigestItem[], lang: Lang): string {
  const t = notificationsText(lang);
  if (items.length === 1) {
    // Name the single item by its heading (already em-dash-free).
    return t.subjectOne(items[0].heading);
  }
  return t.subjectMany(items.length);
}

export function digestPreheader(items: DigestItem[], lang: Lang): string {
  const t = notificationsText(lang);
  const titles = items.slice(0, 3).map((i) => i.heading);
  const rest = items.length - titles.length;
  if (rest > 0) return t.preheaderMore(titles.join(", "), rest);
  if (titles.length <= 1) return `${titles[0] ?? t.preheaderEmpty}.`;
  const init = titles.slice(0, -1);
  return t.preheaderAnd(init.join(", "), titles[titles.length - 1], init.length);
}

/** Comment bodies are unbounded; the full text is one click away in the app. */
const BODY_MAX = 300;
const clamp = (t: string) => (t.length > BODY_MAX ? `${t.slice(0, BODY_MAX).trimEnd()}…` : t);

function itemRow(it: DigestItem, appBase: string, last: boolean, lang: Lang): string {
  const b = it.badge ?? defaultBadge(lang);
  const bd = last ? "" : `border-bottom: 1px solid ${EMAIL.divider};`;
  return `<tr><td style="padding: 20px 0; ${bd}">
    <p style="margin: 0 0 10px;">${badge(b.tone, b.label)}</p>
    <p style="margin: 0; font-size: 15px; line-height: 22px; font-weight: 700; color: ${EMAIL.ink}; word-break: break-word;">${escapeHtml(it.heading)}</p>
    ${it.context ? paragraph(it.context, "small", "2px 0 0") : ""}
    ${it.body ? spacer(10) + callout(escapeHtml(clamp(it.body))) : ""}
    <p style="margin: 12px 0 0; font-size: 14px;">${link(`${appBase}${it.link}`, notificationsText(lang).openApp)}</p>
  </td></tr>`;
}

/** Items rendered in one digest. Each row is ~1.4 KB; past ~67 the HTML
 * crosses Gmail's 102 KB clip and the footer disappears. The rest are
 * summarised in one line that links to the app. */
export const DIGEST_RENDER_CAP = 30;

export function buildDigestHtml(items: DigestItem[], appBase: string, lang: Lang): string {
  const t = notificationsText(lang);
  const n = items.length;
  const shown = items.slice(0, DIGEST_RENDER_CAP);
  const extra = n - shown.length;
  const rows = shown.map((it, i) => itemRow(it, appBase, i === shown.length - 1, lang)).join("");
  return mesaasEmail({
    preheader: digestPreheader(items, lang),
    eyebrow: t.eyebrow,
    sections: [
      heading(n === 1 ? t.headingOne : t.headingMany(n)),
      `<table role="presentation" width="100%" cellpadding="0" cellspacing="0">${rows}</table>`,
      ...(extra > 0
        ? [paragraph(extra === 1 ? t.moreOne : t.moreMany(extra), "body", "0 0 12px") + link(`${appBase}/dashboard`, t.seeAll)]
        : []),
    ],
    footerLines: [t.footer],
    lang,
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
  p: { to: string; items: DigestItem[]; idempotencyKey: string; lang: Lang },
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
      subject: digestSubject(p.items, p.lang),
      html: buildDigestHtml(p.items, base, p.lang),
      tags: [{ name: "type", value: "notification_digest" }],
    }),
    signal: AbortSignal.timeout(10_000),
  });
  // 409 = this Idempotency-Key was already accepted (a prior retry landed this
  // exact digest). Treat as a successful, deduped send, not a failure.
  if (res.status === 409) return { skipped: false };
  if (!res.ok) throw new Error(`Resend send failed: ${res.status}`);
  return { skipped: false };
}
