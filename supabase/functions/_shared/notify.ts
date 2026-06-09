import { escapeHtml } from "./report-template/escape.ts";

export interface CronFailureDetail {
  total?: number;
  failed?: number;
  errors?: Array<{ accountId?: string; error?: string }>;
  stack?: string;
  context?: Record<string, unknown>;
}

/**
 * Send an enriched cron-failure alert via Resend. Env is read lazily (inside
 * the function) so tests can set it after import. Returns silently if Resend
 * isn't configured. Never throws on a Resend error — logs generically.
 */
export async function sendCronFailureEmail(
  cronName: string,
  detail: CronFailureDetail,
): Promise<void> {
  const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
  const ALERT_EMAIL = Deno.env.get("ALERT_EMAIL");
  if (!RESEND_API_KEY || !ALERT_EMAIL) return;

  const rows = (detail.errors ?? [])
    .map(
      (e) =>
        `<tr><td>${escapeHtml(e.accountId ?? "?")}</td><td>${escapeHtml(e.error ?? "unknown")}</td></tr>`,
    )
    .join("");

  const html = [
    `<p>Cron <strong>${escapeHtml(cronName)}</strong> finished with failures.</p>`,
    `<p><strong>Total:</strong> ${escapeHtml(String(detail.total ?? "?"))} &nbsp; `,
    `<strong>Failed:</strong> ${escapeHtml(String(detail.failed ?? "?"))}<br>`,
    `<strong>Occurred:</strong> ${escapeHtml(new Date().toISOString())}</p>`,
    rows
      ? `<table border="1" cellpadding="4"><tr><th>Account</th><th>Error</th></tr>${rows}</table>`
      : "",
    detail.stack ? `<p><strong>Stack:</strong></p><pre>${escapeHtml(detail.stack)}</pre>` : "",
  ].join("");

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: "Mesaas Alerts <alertas@mesaas.com.br>",
        to: [ALERT_EMAIL],
        subject: `[Mesaas] ${cronName} — ${detail.failed ?? "?"} falha(s)`,
        html,
      }),
    });
    if (!res.ok) {
      console.error(`[notify] Resend error: ${res.status}`);
    }
  } catch (_e) {
    console.error("[notify] Failed to send alert email");
  }
}
