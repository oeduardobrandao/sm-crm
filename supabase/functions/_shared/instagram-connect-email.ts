import { LIFECYCLE_FROM, sanitizeSubjectValue, sendViaResend } from "./lifecycle-emails.ts";
import { mesaasEmail } from "./email/shell.ts";
import { button, fallbackLink, heading, paragraph, paragraphHtml, steps, strong } from "./email/blocks.ts";
import { escapeHtml } from "./report-template/escape.ts";
import type { Lang } from "./i18n/lang.ts";
import { instagramConnectText } from "./i18n/catalogs/instagram-connect.ts";

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
/** Portuguese subject; `connectLinkSubject` is the language-aware form the senders use. */
export const CONNECT_LINK_SUBJECT = (agencyName: string): string => connectLinkSubject(agencyName, "pt");

export const CONNECTED_NOTICE_SUBJECT = "Instagram conectado pelo cliente";

export function connectLinkSubject(agencyName: string, lang: Lang): string {
  return instagramConnectText(lang).linkSubject(sanitizeSubjectValue(agencyName));
}

export function connectedNoticeSubject(lang: Lang): string {
  return instagramConnectText(lang).connectedSubject;
}

export function buildConnectLinkEmail(p: {
  agencyName: string;
  clienteName: string;
  connectUrl: string;
  appBaseUrl: string;
  lang: Lang;
}): string {
  const t = instagramConnectText(p.lang);
  return mesaasEmail({
    lang: p.lang,
    preheader: t.linkPreheader(p.agencyName, p.clienteName),
    eyebrow: t.linkEyebrow(p.agencyName),
    sections: [
      heading(t.linkHeading(p.clienteName)) +
        paragraphHtml(t.linkIntro(strong(p.agencyName), strong(p.clienteName)), "body", "0"),
      steps([
        t.step1,
        t.step2(escapeHtml(p.clienteName)),
        t.step3,
      ]),
      button(p.connectUrl, t.linkCta) + fallbackLink(p.connectUrl, p.lang) +
        paragraph(t.linkNotExpected(p.agencyName), "small", "16px 0 0"),
    ],
    footerLines: [t.linkFooter(p.agencyName)],
  });
}

export function buildConnectedNoticeEmail(p: {
  clienteName: string;
  igUsername: string;
  clienteUrl: string;
  appBaseUrl: string;
  lang: Lang;
}): string {
  const t = instagramConnectText(p.lang);
  return mesaasEmail({
    lang: p.lang,
    preheader: t.connectedPreheader(p.igUsername, p.clienteName),
    eyebrow: t.connectedEyebrow,
    sections: [
      heading(t.connectedHeading) +
        paragraphHtml(t.connectedIntro(strong(p.clienteName))) +
        paragraphHtml(t.connectedAccount(strong(`@${p.igUsername}`)), "body", "0"),
      button(p.clienteUrl, t.connectedCta),
    ],
    footerLines: [t.connectedFooter],
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
  lang: Lang;
}): Promise<void> {
  await sendViaResend(
    p.to,
    connectLinkSubject(p.agencyName, p.lang),
    buildConnectLinkEmail(p),
    p.idempotencyKey,
    LIFECYCLE_FROM,
    p.replyTo ?? undefined,
    undefined,
    undefined,
    { type: "instagram_connect" },
  );
}

export async function sendConnectedNoticeEmail(p: {
  to: string;
  clienteName: string;
  igUsername: string;
  clienteUrl: string;
  appBaseUrl: string;
  idempotencyKey: string;
  lang: Lang;
}): Promise<void> {
  await sendViaResend(
    p.to,
    connectedNoticeSubject(p.lang),
    buildConnectedNoticeEmail(p),
    p.idempotencyKey,
    LIFECYCLE_FROM,
    undefined,
    undefined,
    undefined,
    { type: "instagram_connected" },
  );
}
