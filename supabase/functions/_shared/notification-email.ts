import { escapeHtml } from "./report-template/escape.ts";
import { appBaseUrl } from "./app-url.ts";
import { getPublishErrorDisplay } from "./publish-error-codes.ts";

export interface DigestItem {
  priority: number;
  heading: string;
  body?: string;
  context?: string;
  link: string;
}

const DIGEST_FROM = "Mesaas <notificacoes@mesaas.com.br>";

function s(metadata: Record<string, unknown> | null, key: string): string | undefined {
  const v = metadata?.[key];
  return typeof v === "string" && v.length > 0 ? v : undefined;
}

function ctx(a?: string, b?: string): string | undefined {
  return [a, b].filter(Boolean).join(" · ") || undefined;
}

/** Map a claimed notification row to a rendered digest item. Metadata keys are
 * read defensively (verified against the emitting triggers); anything missing
 * degrades to a generic line rather than throwing. Priority = urgency order. */
export function resolveDigestItem(
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
    default:
      return { priority: 9, heading: "Nova notificação no Mesaas", context: undefined, link };
  }
}

export function digestSubject(items: DigestItem[]): string {
  if (items.length === 1) {
    // Name the single item by its heading (already em-dash-free).
    return `${items[0].heading} no Mesaas`;
  }
  return `Você tem ${items.length} novidades no Mesaas`;
}

function itemRow(it: DigestItem, appBase: string): string {
  const link = escapeHtml(`${appBase}${it.link}`);
  const heading = escapeHtml(it.heading);
  const context = it.context
    ? `<p style="margin:2px 0 0;font-size:12px;color:#888780">${escapeHtml(it.context)}</p>`
    : "";
  const body = it.body
    ? `<p style="margin:6px 0 0;padding:10px 12px;background:#f5f3ee;border-radius:8px;font-size:13px;color:#444441">${escapeHtml(it.body)}</p>`
    : "";
  return `<tr><td style="padding:14px 0;border-bottom:1px solid #ece9e2">
    <p style="margin:0;font-size:14px;color:#1a3d2b"><strong>${heading}</strong></p>
    ${context}${body}
    <p style="margin:8px 0 0"><a href="${link}" style="color:#1a3d2b;font-weight:700;font-size:13px;text-decoration:none">Abrir no Mesaas &rarr;</a></p>
  </td></tr>`;
}

/** Same visual family as _shared/mention-email.ts / lifecycle-emails.ts. */
export function buildDigestHtml(items: DigestItem[], appBase: string): string {
  const rows = items.map((it) => itemRow(it, appBase)).join("");
  return `<!DOCTYPE html>
<html lang="pt-BR"><body style="margin:0;background:#f5f3ee;font-family:Arial,Helvetica,sans-serif;color:#1a3d2b">
  <table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:32px 16px">
    <table width="520" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:16px;overflow:hidden">
      <tr><td style="background:#1a3d2b;padding:26px 28px;text-align:center;color:#ffffff;font-size:18px;font-weight:700">Novidades no Mesaas</td></tr>
      <tr><td style="padding:24px 28px"><table width="100%" cellpadding="0" cellspacing="0">${rows}</table></td></tr>
      <tr><td style="padding:18px 28px;background:#f5f3ee;text-align:center;font-size:11px;color:#888780;line-height:1.5">
        Você recebeu este e-mail porque tem notificações não lidas no Mesaas. Ajuste em Configurações · Notificações.<br>Mesaas · gestão inteligente para social media managers
      </td></tr>
    </table>
  </td></tr></table>
</body></html>`;
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
