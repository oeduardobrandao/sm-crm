const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
const ALERT_EMAIL = Deno.env.get("ALERT_EMAIL");

export async function notifyCronFailure(
  cronName: string,
  summary: { total?: number; failed?: number; errors?: Array<{ accountId?: string; error?: string }> },
): Promise<void> {
  if (!RESEND_API_KEY || !ALERT_EMAIL) return;

  const errorLines = (summary.errors ?? [])
    .map((e) => `• Account ${e.accountId ?? "?"}: ${e.error ?? "unknown"}`)
    .join("\n");

  const body = [
    `Cron <strong>${cronName}</strong> finished with failures.`,
    `<br><br>`,
    `<strong>Total:</strong> ${summary.total ?? "?"}<br>`,
    `<strong>Failed:</strong> ${summary.failed ?? "?"}<br>`,
    errorLines ? `<br><strong>Details:</strong><br><pre>${errorLines}</pre>` : "",
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
        subject: `[Mesaas] ${cronName} — ${summary.failed} falha(s)`,
        html: body,
      }),
    });
    if (!res.ok) {
      console.error(`[notify] Resend error: ${res.status} ${await res.text()}`);
    }
  } catch (e) {
    console.error("[notify] Failed to send alert email:", e);
  }
}
