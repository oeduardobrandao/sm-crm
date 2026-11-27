import type { DunningStage } from "./dunning-logic.ts";
import { mesaasEmail } from "./email/shell.ts";
import { alert, button, detailRows, heading, paragraph, spacer } from "./email/blocks.ts";
import type { Lang } from "./i18n/lang.ts";
import { dunningText } from "./i18n/catalogs/dunning.ts";

export interface DunningCopy {
  subject: string;
  heading: string;
  body: string;
  alerta?: string;
  cta: string;
}

/**
 * Copy per stage and language (catalog `i18n/catalogs/dunning.ts`).
 *
 * `first` deliberately does not threaten: the overwhelmingly common cause of a failed charge is
 * an expired or re-issued card, and treating a healthy customer like a delinquent one costs more
 * goodwill than the mail recovers.
 */
export function buildDunningCopy(
  stage: DunningStage,
  workspaceName: string,
  _nextAttemptLabel: string | null,
  lang: Lang,
): DunningCopy {
  const t = dunningText(lang);
  switch (stage) {
    case "first":
      return {
        subject: t.first.subject(workspaceName),
        heading: t.first.heading,
        body: t.first.body(workspaceName),
        cta: t.first.cta,
      };
    case "retry":
      return {
        subject: t.retry.subject(workspaceName),
        heading: t.retry.heading,
        body: t.retry.body(workspaceName),
        cta: t.retry.cta,
      };
    case "final":
      return {
        subject: t.final.subject(workspaceName),
        heading: t.final.heading,
        body: t.final.body(workspaceName),
        alerta: t.final.alerta,
        cta: t.final.cta,
      };
  }
}

export function buildDunningEmail(params: {
  stage: DunningStage;
  workspaceName: string;
  nextAttemptLabel: string | null;
  billingUrl: string;
  lang: Lang;
}): string {
  // Raw values: every block escapes its own text.
  const t = dunningText(params.lang);
  const copy = buildDunningCopy(params.stage, params.workspaceName, params.nextAttemptLabel, params.lang);
  const final = params.stage === "final";
  const next = final ? null : params.nextAttemptLabel;
  const rows = [{ label: t.rowWorkspace, value: params.workspaceName }];
  if (next) rows.push({ label: t.rowNextAttempt, value: next });
  const preheader = final ? t.preheaderFinal : next ? t.preheaderNext(next) : t.preheaderDefault;
  return mesaasEmail({
    lang: params.lang,
    preheader,
    eyebrow: t.eyebrow,
    eyebrowTone: final ? "danger" : "brand",
    sections: [
      heading(copy.heading) + paragraph(copy.body, "body", "0"),
      detailRows(rows) + (copy.alerta ? spacer(12) + alert(copy.alerta) : ""),
      button(params.billingUrl, copy.cta) + paragraph(t.ignore, "small", "16px 0 0"),
    ],
    footerLines: [],
  });
}

/**
 * Send the dunning e-mail via Resend.
 *
 * Best-effort by design, mirroring _shared/notify.ts and NOT _shared/invite-email.ts: stripe-webhook
 * returns 500 on a handler throw and Stripe redelivers the event, so a throwing send would re-send
 * the mail on every redelivery. Returns silently when Resend is not configured.
 */
const RESEND_TIMEOUT_MS = 10_000;

export async function sendDunningEmail(params: {
  to: string;
  stage: DunningStage;
  workspaceName: string;
  nextAttemptLabel: string | null;
  billingUrl: string;
  lang: Lang;
}): Promise<void> {
  const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
  if (!RESEND_API_KEY) return;

  const copy = buildDunningCopy(params.stage, params.workspaceName, params.nextAttemptLabel, params.lang);

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: "Mesaas <cobranca@mesaas.com.br>",
        to: [params.to],
        subject: copy.subject,
        html: buildDunningEmail({
          stage: params.stage,
          workspaceName: params.workspaceName,
          nextAttemptLabel: params.nextAttemptLabel,
          billingUrl: params.billingUrl,
          lang: params.lang,
        }),
      }),
      signal: AbortSignal.timeout(RESEND_TIMEOUT_MS),
    });
    if (!res.ok) console.error(`[dunning-email] Resend error: ${res.status}`);
  } catch (_e) {
    console.error("[dunning-email] Failed to send dunning email");
  }
}
