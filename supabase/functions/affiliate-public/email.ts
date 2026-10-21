import { mesaasEmail } from "../_shared/email/shell.ts";
import { button, heading, paragraph } from "../_shared/email/blocks.ts";

/** E-mail com o link pessoal do painel do afiliado. Os blocos escapam os valores dinâmicos. */
export function buildAffiliateLinkEmail(params: { nome: string; link: string }): string {
  const first = params.nome.split(" ")[0] || params.nome;
  return mesaasEmail({
    preheader: "Seu link de acesso ao painel de afiliado. Vale por 15 minutos.",
    eyebrow: "Programa de afiliados",
    sections: [
      heading(`Olá, ${first}!`) +
        paragraph("Use o botão abaixo para entrar no seu painel de afiliado. O link vale por 15 minutos e funciona uma vez.", "body", "0"),
      button(params.link, "Entrar no painel") +
        paragraph("Para entrar de novo depois, peça outro link em mesaas.com.br/afiliados. O link é pessoal: não encaminhe este e-mail. Se você não pediu este acesso, ignore a mensagem.", "small", "16px 0 0"),
    ],
    footerLines: [],
  });
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
