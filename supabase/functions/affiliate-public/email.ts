import { escapeHtml } from "../_shared/report-template/escape.ts";

/** E-mail com o link pessoal do painel do afiliado. Todo valor dinâmico é escapado. */
export function buildAffiliateLinkEmail(params: { nome: string; link: string }): string {
  const nome = escapeHtml(params.nome.split(" ")[0] || params.nome);
  const link = escapeHtml(params.link);
  return `<!DOCTYPE html>
<html lang="pt-BR"><body style="margin:0;background:#fdfdfd;font-family:-apple-system,BlinkMacSystemFont,'SF Pro Text','Segoe UI',Helvetica,Arial,sans-serif;color:#12151a">
  <table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:32px 16px">
    <table width="460" cellpadding="0" cellspacing="0" style="background:#ffffff;border:1px solid #e5e7eb;border-radius:12px">
      <tr><td style="padding:32px 32px 8px;font-size:20px;font-weight:800;letter-spacing:-0.03em">mesaas</td></tr>
      <tr><td style="padding:8px 32px 32px;font-size:14px;line-height:1.6;color:#374151">
        <p>Olá, ${nome}!</p>
        <p>Use o botão abaixo para entrar no seu painel de afiliado. O link vale por 15 minutos e funciona uma vez.</p>
        <p style="margin:28px 0">
          <a href="${link}" style="display:inline-block;background:#12151a;color:#ffffff;text-decoration:none;padding:12px 24px;border-radius:10px;font-weight:600">Entrar no painel</a>
        </p>
        <p style="font-size:13px;color:#4b5563">Para entrar de novo depois, peça outro link em mesaas.com.br/afiliados. O link é pessoal: não encaminhe este e-mail. Se você não pediu este acesso, ignore a mensagem.</p>
      </td></tr>
    </table>
  </td></tr></table>
</body></html>`;
}

/** Envia pelo Resend. Lança em configuração ausente ou resposta não-2xx. */
export async function sendAffiliateLinkEmail(
  params: { to: string; nome: string; link: string },
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
      from: "Mesaas <afiliados@mesaas.com.br>",
      to: [params.to],
      reply_to: "eduardo@mesaas.com.br",
      subject: "Seu link de acesso ao painel de afiliado Mesaas",
      html: buildAffiliateLinkEmail({ nome: params.nome, link: params.link }),
    }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`Resend send failed: ${res.status}`);
}
