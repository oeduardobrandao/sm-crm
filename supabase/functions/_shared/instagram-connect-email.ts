import { LIFECYCLE_FROM, sanitizeSubjectValue, sendViaResend } from "./lifecycle-emails.ts";
import { mesaasEmail } from "./email/shell.ts";
import { button, fallbackLink, heading, paragraph, paragraphHtml, steps, strong } from "./email/blocks.ts";
import { escapeHtml } from "./report-template/escape.ts";

/**
 * O cliente final recebe este e-mail de um domínio com o qual não tem relação.
 * Isso tem formato de phishing, então: o assunto e a primeira linha abrem com o
 * nome da agência e com o nome do próprio cliente, e o reply-to aponta para o
 * membro que gerou o link, não para o vazio.
 *
 * agencyName vem do nome do workspace, que o usuário controla. escapeHtml
 * protege só o corpo: um caractere de controle no assunto faz a Resend recusar
 * o envio. sanitizeSubjectValue é o mesmo tratamento que
 * buildFounderSubscriptionNotice já aplica a este mesmo campo.
 */
export const CONNECT_LINK_SUBJECT = (agencyName: string): string =>
  `${sanitizeSubjectValue(agencyName)} precisa conectar seu Instagram`;

export const CONNECTED_NOTICE_SUBJECT = "Instagram conectado pelo cliente";

export function buildConnectLinkEmail(p: {
  agencyName: string;
  clienteName: string;
  connectUrl: string;
  appBaseUrl: string;
}): string {
  return mesaasEmail({
    preheader: `${p.agencyName} pediu para conectar o Instagram de ${p.clienteName}.`,
    eyebrow: `A pedido de ${p.agencyName}`,
    sections: [
      heading(`Conecte o Instagram de ${p.clienteName}`) +
        paragraphHtml(`${strong(p.agencyName)} pediu para conectar o Instagram de ${strong(p.clienteName)} ao Mesaas, a ferramenta que a agência usa para agendar publicações e acompanhar resultados.`, "body", "0"),
      steps([
        "Abra o link abaixo.",
        `Entre com a conta do Instagram de ${escapeHtml(p.clienteName)}.`,
        "Pronto. A agência não vê sua senha em momento algum.",
      ]),
      button(p.connectUrl, "Conectar Instagram") + fallbackLink(p.connectUrl) +
        paragraph(`Não esperava este pedido? Responda este e-mail e fale direto com ${p.agencyName}.`, "small", "16px 0 0"),
    ],
    footerLines: [`Enviado a pedido de ${p.agencyName}`],
  });
}

export function buildConnectedNoticeEmail(p: {
  clienteName: string;
  igUsername: string;
  clienteUrl: string;
  appBaseUrl: string;
}): string {
  return mesaasEmail({
    preheader: `@${p.igUsername} foi conectado a ${p.clienteName}.`,
    eyebrow: "Instagram",
    sections: [
      heading("Instagram conectado") +
        paragraphHtml(`O cliente ${strong(p.clienteName)} concluiu a conexão do Instagram.`) +
        paragraphHtml(`Conta conectada: ${strong(`@${p.igUsername}`)}`, "body", "0"),
      button(p.clienteUrl, "Ver o cliente"),
    ],
    footerLines: ["Notificação automática do Mesaas"],
  });
}

export async function sendConnectLinkEmail(p: {
  to: string;
  replyTo: string | null;
  agencyName: string;
  clienteName: string;
  connectUrl: string;
  appBaseUrl: string;
  idempotencyKey: string;
}): Promise<void> {
  await sendViaResend(
    p.to,
    CONNECT_LINK_SUBJECT(p.agencyName),
    buildConnectLinkEmail(p),
    p.idempotencyKey,
    LIFECYCLE_FROM,
    p.replyTo ?? undefined,
  );
}

export async function sendConnectedNoticeEmail(p: {
  to: string;
  clienteName: string;
  igUsername: string;
  clienteUrl: string;
  appBaseUrl: string;
  idempotencyKey: string;
}): Promise<void> {
  await sendViaResend(
    p.to,
    CONNECTED_NOTICE_SUBJECT,
    buildConnectedNoticeEmail(p),
    p.idempotencyKey,
  );
}
