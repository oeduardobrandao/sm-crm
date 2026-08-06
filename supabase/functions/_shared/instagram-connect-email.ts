import { escapeHtml } from "./report-template/escape.ts";
import { layout, LIFECYCLE_FROM, sanitizeSubjectValue, sendViaResend } from "./lifecycle-emails.ts";

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

function ctaButton(href: string, label: string): string {
  return `<a href="${href}" style="display:inline-block;background:#1a3d2b;color:#ffffff;text-decoration:none;padding:11px 22px;border-radius:8px;font-weight:700;font-size:13px">${label}</a>`;
}

export function buildConnectLinkEmail(p: {
  agencyName: string;
  clienteName: string;
  connectUrl: string;
  appBaseUrl: string;
}): string {
  const agency = escapeHtml(p.agencyName);
  const cliente = escapeHtml(p.clienteName);
  const url = escapeHtml(p.connectUrl);
  const base = escapeHtml(p.appBaseUrl);

  const body = `
    <p style="margin:0 0 14px"><strong>${agency}</strong> pediu para conectar o Instagram de <strong>${cliente}</strong> ao Mesaas, a ferramenta que a agência usa para agendar publicações e acompanhar resultados.</p>
    <p style="margin:0 0 14px">Para autorizar, abra o link abaixo e entre com a conta do Instagram de ${cliente}. A agência não vê sua senha em momento algum.</p>
    <p style="margin:0 0 20px">${ctaButton(url, "Conectar Instagram")}</p>
    <p style="margin:0 0 14px;font-size:12px;color:#888780">Se o botão não funcionar, copie e cole este endereço no navegador:<br><span style="word-break:break-all">${url}</span></p>
    <p style="margin:0;font-size:12px;color:#888780">Não esperava este pedido? Responda este e-mail e fale direto com ${agency}.</p>`;

  return layout(body, `Enviado a pedido de ${agency}`, base);
}

export function buildConnectedNoticeEmail(p: {
  clienteName: string;
  igUsername: string;
  clienteUrl: string;
  appBaseUrl: string;
}): string {
  const cliente = escapeHtml(p.clienteName);
  const user = escapeHtml(p.igUsername);
  const url = escapeHtml(p.clienteUrl);
  const base = escapeHtml(p.appBaseUrl);

  const body = `
    <p style="margin:0 0 14px">O cliente <strong>${cliente}</strong> concluiu a conexão do Instagram.</p>
    <p style="margin:0 0 20px">Conta conectada: <strong>@${user}</strong></p>
    <p style="margin:0">${ctaButton(url, "Ver o cliente")}</p>`;

  return layout(body, "Notificação automática do Mesaas", base);
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
