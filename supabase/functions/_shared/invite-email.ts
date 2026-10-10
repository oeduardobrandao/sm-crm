import { mesaasEmail } from "./email/shell.ts";
import { button, fallbackLink, heading, paragraph, paragraphHtml, strong } from "./email/blocks.ts";

/**
 * Build the HTML body for a "set your password" invite e-mail. Text blocks escape their own
 * values (workspace name included), and the button and fallback link escape the action link
 * (it carries `&`-joined query params that must be entity-encoded in attribute context).
 */
export function buildInviteEmail(params: { actionLink: string; workspaceName: string }): string {
  return mesaasEmail({
    preheader: `Defina sua senha para entrar no ${params.workspaceName}.`,
    eyebrow: "Convite",
    sections: [
      heading(`Você foi convidado para o ${params.workspaceName}`) +
        paragraphHtml(`Para acessar o workspace ${strong(params.workspaceName)} no Mesaas, defina sua senha:`, "body", "0"),
      button(params.actionLink, "Definir minha senha") + fallbackLink(params.actionLink) +
        paragraph("Se você não esperava este convite, ignore este e-mail.", "small", "16px 0 0"),
    ],
    footerLines: [],
  });
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
