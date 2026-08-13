import { escapeHtml } from "./report-template/escape.ts";
import { getPublishErrorDisplay } from "./publish-error-codes.ts";

export interface CronFailureError {
  accountId?: string;
  error?: string;
  errorCode?: string;
  postId?: number;
  postCaption?: string;
  clientId?: number;
  clientName?: string;
  workspaceName?: string;
}

export interface CronFailureDetail {
  total?: number;
  failed?: number;
  errors?: CronFailureError[];
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

  const errors = detail.errors ?? [];
  const hasEnrichedErrors = errors.some((e) => e.errorCode);

  let tableHtml: string;
  if (hasEnrichedErrors) {
    const rows = errors
      .map((e) => {
        const display = getPublishErrorDisplay(e.errorCode);
        const caption = e.postCaption
          ? escapeHtml(e.postCaption.length > 60 ? e.postCaption.slice(0, 57) + "..." : e.postCaption)
          : "";
        const postLabel = e.postId ? `#${e.postId}` : "?";
        const clientLabel = e.clientName
          ? escapeHtml(e.clientName)
          : e.clientId ? `#${e.clientId}` : "";
        const workspaceLabel = e.workspaceName ? escapeHtml(e.workspaceName) : "";
        const codeLabel = e.errorCode ? escapeHtml(e.errorCode) : "";

        return [
          "<tr>",
          `<td style="padding:8px;border:1px solid #ddd;vertical-align:top;">`,
          workspaceLabel ? `<span style="display:inline-block;padding:1px 6px;border-radius:3px;background:#f0f0f0;color:#555;font-size:11px;font-weight:600;margin-bottom:2px;">${workspaceLabel}</span><br>` : "",
          `<strong>Post ${escapeHtml(postLabel)}</strong>`,
          clientLabel ? `<br><span style="color:#666;font-size:12px;">Cliente ${clientLabel}</span>` : "",
          caption ? `<br><span style="color:#888;font-size:12px;">${caption}</span>` : "",
          "</td>",
          `<td style="padding:8px;border:1px solid #ddd;vertical-align:top;">`,
          `<span style="display:inline-block;padding:2px 8px;border-radius:4px;background:#fee2e2;color:#991b1b;font-size:12px;font-weight:600;">${escapeHtml(display.titulo)}</span>`,
          codeLabel ? `<br><span style="color:#999;font-size:11px;font-family:monospace;">${codeLabel}</span>` : "",
          "</td>",
          `<td style="padding:8px;border:1px solid #ddd;vertical-align:top;">`,
          `<span style="color:#374151;font-size:13px;">${escapeHtml(display.explicacao)}</span>`,
          "</td>",
          `<td style="padding:8px;border:1px solid #ddd;vertical-align:top;font-size:12px;color:#666;">`,
          escapeHtml(e.error ?? ""),
          "</td>",
          "</tr>",
        ].join("");
      })
      .join("");

    tableHtml = [
      `<table style="border-collapse:collapse;width:100%;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;margin-top:16px;">`,
      `<tr style="background:#f9fafb;">`,
      `<th style="padding:8px;border:1px solid #ddd;text-align:left;font-size:13px;">Post</th>`,
      `<th style="padding:8px;border:1px solid #ddd;text-align:left;font-size:13px;">Causa</th>`,
      `<th style="padding:8px;border:1px solid #ddd;text-align:left;font-size:13px;">Solução</th>`,
      `<th style="padding:8px;border:1px solid #ddd;text-align:left;font-size:13px;">Erro técnico</th>`,
      "</tr>",
      rows,
      "</table>",
    ].join("");
  } else {
    const rows = errors
      .map(
        (e) =>
          `<tr><td style="padding:8px;border:1px solid #ddd;">${escapeHtml(e.accountId ?? "?")}</td><td style="padding:8px;border:1px solid #ddd;">${escapeHtml(e.error ?? "unknown")}</td></tr>`,
      )
      .join("");

    tableHtml = rows
      ? [
          `<table style="border-collapse:collapse;width:100%;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;margin-top:16px;">`,
          `<tr style="background:#f9fafb;"><th style="padding:8px;border:1px solid #ddd;text-align:left;">Account</th><th style="padding:8px;border:1px solid #ddd;text-align:left;">Error</th></tr>`,
          rows,
          "</table>",
        ].join("")
      : "";
  }

  const html = [
    `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:800px;">`,
    `<p>Cron <strong>${escapeHtml(cronName)}</strong> finished with failures.</p>`,
    `<p><strong>Total:</strong> ${escapeHtml(String(detail.total ?? "?"))} &nbsp; `,
    `<strong>Failed:</strong> ${escapeHtml(String(detail.failed ?? "?"))}<br>`,
    `<strong>Occurred:</strong> ${escapeHtml(new Date().toISOString())}</p>`,
    tableHtml,
    detail.stack ? `<p style="margin-top:16px;"><strong>Stack:</strong></p><pre style="background:#f3f4f6;padding:12px;border-radius:6px;overflow-x:auto;font-size:12px;">${escapeHtml(detail.stack)}</pre>` : "",
    "</div>",
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
      // Bound this I/O: a stalled Resend call in the failure-reporting path
      // would otherwise run until the edge runtime kills the isolate, bypassing
      // the catch below entirely (documented repo failure mode).
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      console.error(`[notify] Resend error: ${res.status}`);
    }
  } catch (_e) {
    console.error("[notify] Failed to send alert email");
  }
}
