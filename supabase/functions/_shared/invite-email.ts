import { escapeHtml } from "./report-template/escape.ts";

/**
 * Build the HTML body for a "set your password" invite e-mail. All dynamic
 * values are HTML-escaped (the action link too — it carries `&`-joined query
 * params that must be entity-encoded in attribute context).
 */
export function buildInviteEmail(params: { actionLink: string; workspaceName: string }): string {
  const ws = escapeHtml(params.workspaceName);
  const link = escapeHtml(params.actionLink);
  return `<!DOCTYPE html>
<html lang="pt-BR"><body style="margin:0;background:#f5f3ee;font-family:Arial,Helvetica,sans-serif;color:#1a3d2b">
  <table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:32px 16px">
    <table width="440" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:16px;overflow:hidden">
      <tr><td style="background:#1a3d2b;padding:28px;text-align:center;color:#fff;font-size:18px;font-weight:600">
        Você foi convidado para o ${ws}
      </td></tr>
      <tr><td style="padding:28px;font-size:14px;line-height:1.6;color:#444441">
        <p>Para acessar o workspace <strong>${ws}</strong> no Mesaas, defina sua senha:</p>
        <p style="text-align:center;margin:28px 0">
          <a href="${link}" style="display:inline-block;background:#1a3d2b;color:#fff;text-decoration:none;padding:12px 24px;border-radius:8px;font-weight:600">Definir minha senha</a>
        </p>
        <p style="font-size:12px;color:#888780">Se você não esperava este convite, ignore este e-mail.</p>
      </td></tr>
    </table>
  </td></tr></table>
</body></html>`;
}

/**
 * Send the invite e-mail via Resend. Throws on misconfiguration or a non-2xx
 * response — invite-send failures must surface to the admin (unlike best-effort
 * cron alerts), so the caller can report that the resend did not go out.
 */
export async function sendInviteEmail(
  params: { to: string; actionLink: string; workspaceName: string },
): Promise<void> {
  const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
  if (!RESEND_API_KEY) throw new Error("RESEND_API_KEY not configured");

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: "Mesaas <convites@mesaas.com.br>",
      to: [params.to],
      subject: `Seu acesso ao ${params.workspaceName} no Mesaas`,
      html: buildInviteEmail({ actionLink: params.actionLink, workspaceName: params.workspaceName }),
    }),
  });
  if (!res.ok) throw new Error(`Resend send failed: ${res.status}`);
}
