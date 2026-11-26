import { escapeHtml } from "../_shared/report-template/escape.ts";
import { brandedEmail } from "../_shared/email/shell.ts";
import { callout, heading, paragraph } from "../_shared/email/blocks.ts";
import { EMAIL } from "../_shared/email/tokens.ts";
import { sanitizeFromName } from "../_shared/email-headers.ts";
import { sendViaResend } from "../_shared/lifecycle-emails.ts";
import type { Lang } from "../_shared/i18n/lang.ts";
import { hubLoginText } from "../_shared/i18n/catalogs/hub-login.ts";

export interface LoginCodeEmailInput {
  code: string;
  workspaceName: string;
  brandColor: string | null;
  logoUrl: string | null;
  /** Language of the client's workspace. */
  lang: Lang;
}

/** Client-facing login code, laid out like the other agency-branded client e-mails. */
export function buildLoginCodeEmail(input: LoginCodeEmailInput): { subject: string; html: string } {
  const t = hubLoginText(input.lang);
  const codeHtml = `<p style="margin: 0; text-align: center; font-size: 32px; line-height: 40px; ` +
    `font-weight: 700; letter-spacing: 0.3em; color: ${EMAIL.ink};">${escapeHtml(input.code)}</p>`;
  const html = brandedEmail({
    preheader: t.preheader,
    workspaceName: input.workspaceName,
    brandColor: input.brandColor,
    logoUrl: input.logoUrl,
    sections: [
      heading(t.heading) +
      paragraph(t.intro(input.workspaceName), "body", "0"),
      callout(codeHtml),
      paragraph(t.validity, "body", "0") +
      paragraph(t.ignore, "small", "8px 0 0"),
    ],
    footerHtml: [t.sentBy(escapeHtml(input.workspaceName))],
    lang: input.lang,
  });
  return { subject: t.subject, html };
}

/**
 * Sends the code. Errors thrown here never carry the code: sendViaResend only
 * reports the HTTP status or the missing key, and the idempotency key is random.
 */
export async function sendLoginCodeEmail(input: LoginCodeEmailInput & { to: string }): Promise<void> {
  const { subject, html } = buildLoginCodeEmail(input);
  await sendViaResend(
    input.to,
    subject,
    html,
    `hub-login-code:${crypto.randomUUID()}`,
    `${sanitizeFromName(input.workspaceName)} <notificacoes@mesaas.com.br>`,
    undefined,
    undefined,
    undefined,
    { type: "hub_login_code" },
  );
}
