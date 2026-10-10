import { escapeHtml } from "../_shared/report-template/escape.ts";

/** E-mail com o link pessoal do painel do afiliado. Todo valor dinâmico é escapado. */
export function buildAffiliateLinkEmail(params: { nome: string; link: string }): string {
  const nome = escapeHtml(params.nome.split(" ")[0] || params.nome);
  const link = escapeHtml(params.link);
  return `<!DOCTYPE html>
<html lang="pt-BR"><body style="margin:0;background:#f5f3ee;font-family:Arial,Helvetica,sans-serif;color:#1a3d2b">
  <table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:32px 16px">
    <table width="440" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:16px;overflow:hidden">
      <tr><td style="background:#1a3d2b;padding:28px;text-align:center;color:#fff;font-size:18px;font-weight:600">
        Programa de afiliados Mesaas
      </td></tr>
      <tr><td style="padding:28px;font-size:14px;line-height:1.6;color:#444441">
        <p>Olá, ${nome}!</p>
        <p>Este é o link do seu painel de afiliado. Lá você encontra seu link de divulgação, acompanha suas indicações e comissões e cadastra sua chave PIX.</p>
        <p style="text-align:center;margin:28px 0">
          <a href="${link}" style="display:inline-block;background:#1a3d2b;color:#fff;text-decoration:none;padding:12px 24px;border-radius:8px;font-weight:600">Abrir meu painel</a>
        </p>
        <p style="font-size:12px;color:#888780">O link é pessoal: não compartilhe este e-mail. Se você não pediu este acesso, ignore a mensagem.</p>
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
      subject: "Seu painel de afiliado Mesaas",
      html: buildAffiliateLinkEmail({ nome: params.nome, link: params.link }),
    }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`Resend send failed: ${res.status}`);
}
