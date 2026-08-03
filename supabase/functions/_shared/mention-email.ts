import { escapeHtml } from "./report-template/escape.ts";
import { appBaseUrl } from "./app-url.ts";

/** One pending mention to render in the digest. `link` is a CRM-relative path (e.g. `/entregas?drawer=12`). */
export interface MentionEmailItem {
  actorName: string;
  contextTitle: string;
  excerpt?: string;
  link: string;
}

export interface SendMentionEmailResult {
  skipped: boolean;
}

const MENTION_EMAIL_FROM = "Mesaas <notificacoes@mesaas.com.br>";

/** One mention row: actor + title + optional excerpt + absolute link. Args pre-escaped except appBase. */
function mentionRow(m: MentionEmailItem, appBase: string): string {
  const actor = escapeHtml(m.actorName);
  const title = escapeHtml(m.contextTitle);
  const link = escapeHtml(`${appBase}${m.link}`);
  const excerpt = m.excerpt
    ? `<p style="margin:6px 0 0;padding:10px 12px;background:#f5f3ee;border-radius:8px;font-size:13px;color:#444441">${
      escapeHtml(m.excerpt)
    }</p>`
    : "";
  return `<tr><td style="padding:14px 0;border-bottom:1px solid #ece9e2">
    <p style="margin:0;font-size:14px;color:#1a3d2b"><strong>${actor}</strong> mencionou você em «${title}»</p>
    ${excerpt}
    <p style="margin:8px 0 0"><a href="${link}" style="color:#1a3d2b;font-weight:700;font-size:13px;text-decoration:none">Ver menção &rarr;</a></p>
  </td></tr>`;
}

/**
 * Same visual family as the other transactional emails (green #1a3d2b header
 * on a cream #f5f3ee page, white 16px card): see `_shared/lifecycle-emails.ts`
 * and `_shared/invite-email.ts`. Kept self-contained here since those modules
 * don't export their layout helpers.
 */
export function buildMentionEmailHtml(mentions: MentionEmailItem[], appBase: string): string {
  const rows = mentions.map((m) => mentionRow(m, appBase)).join("");
  return `<!DOCTYPE html>
<html lang="pt-BR"><body style="margin:0;background:#f5f3ee;font-family:Arial,Helvetica,sans-serif;color:#1a3d2b">
  <table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:32px 16px">
    <table width="520" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:16px;overflow:hidden">
      <tr><td style="background:#1a3d2b;padding:26px 28px;text-align:center;color:#ffffff;font-size:18px;font-weight:700">
        Você foi mencionado
      </td></tr>
      <tr><td style="padding:24px 28px">
        <table width="100%" cellpadding="0" cellspacing="0">${rows}</table>
      </td></tr>
      <tr><td style="padding:18px 28px;background:#f5f3ee;text-align:center;font-size:11px;color:#888780;line-height:1.5">
        Você recebeu este e-mail porque tem uma menção não lida no Mesaas.<br>Mesaas · gestão inteligente para social media managers
      </td></tr>
    </table>
  </td></tr></table>
</body></html>`;
}

function mentionEmailSubject(count: number): string {
  return count === 1 ? "Você foi mencionado no Mesaas" : `${count} novas menções`;
}

/**
 * Direct Resend send for the unread-mention digest (courtesy copy of the bell
 * notification, per mention-email-cron). Returns `{ skipped: true }` without
 * sending when `RESEND_API_KEY` is unset (e.g. staging has no key) instead of
 * throwing, so a misconfigured environment degrades to "no email" rather than
 * a hard failure. Bounded by AbortSignal: an unbounded fetch can outlive the
 * edge isolate in ways that bypass `catch` (repo-documented failure mode).
 */
export async function sendMentionEmail(
  params: { to: string; mentions: MentionEmailItem[] },
): Promise<SendMentionEmailResult> {
  const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
  if (!RESEND_API_KEY) return { skipped: true };
  if (params.mentions.length === 0) return { skipped: true };

  const base = appBaseUrl();
  const subject = mentionEmailSubject(params.mentions.length);
  const html = buildMentionEmailHtml(params.mentions, base);

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: MENTION_EMAIL_FROM,
      to: [params.to],
      subject,
      html,
    }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`Resend send failed: ${res.status}`);
  return { skipped: false };
}
