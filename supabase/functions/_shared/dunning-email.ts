import { escapeHtml } from "./report-template/escape.ts";
import type { DunningStage } from "./dunning-logic.ts";

export interface DunningCopy {
  subject: string;
  heading: string;
  body: string;
  cta: string;
}

/**
 * PT-BR copy per stage.
 *
 * `first` deliberately does not threaten: the overwhelmingly common cause of a failed charge is
 * an expired or re-issued card, and treating a healthy customer like a delinquent one costs more
 * goodwill than the mail recovers.
 */
export function buildDunningCopy(
  stage: DunningStage,
  workspaceName: string,
  nextAttemptLabel: string | null,
): DunningCopy {
  const retrySentence = nextAttemptLabel
    ? ` Vamos tentar novamente em ${nextAttemptLabel}.`
    : "";

  switch (stage) {
    case "first":
      return {
        subject: `Não conseguimos processar seu pagamento — ${workspaceName}`,
        heading: "Não conseguimos processar seu pagamento",
        body:
          `A cobrança da assinatura do ${workspaceName} não foi aprovada. ` +
          `Isso normalmente acontece quando o cartão expirou ou foi substituído.` +
          retrySentence,
        cta: "Atualizar forma de pagamento",
      };
    case "retry":
      return {
        subject: `Ainda não conseguimos processar seu pagamento — ${workspaceName}`,
        heading: "Ainda não conseguimos processar seu pagamento",
        body:
          `Continuamos sem conseguir cobrar a assinatura do ${workspaceName}.` +
          retrySentence +
          ` Atualize sua forma de pagamento para manter o acesso.`,
        cta: "Atualizar forma de pagamento",
      };
    case "final":
      return {
        subject: `Último aviso: o acesso ao ${workspaceName} será reduzido`,
        heading: "Último aviso",
        body:
          `Não conseguimos processar o pagamento da assinatura do ${workspaceName} após várias ` +
          `tentativas. Sem uma forma de pagamento válida, o workspace será movido para o plano ` +
          `Free e os recursos do seu plano atual deixarão de funcionar.`,
        cta: "Regularizar agora",
      };
  }
}

export function buildDunningEmail(params: {
  stage: DunningStage;
  workspaceName: string;
  nextAttemptLabel: string | null;
  billingUrl: string;
}): string {
  const copy = buildDunningCopy(
    params.stage,
    escapeHtml(params.workspaceName),
    params.nextAttemptLabel ? escapeHtml(params.nextAttemptLabel) : null,
  );
  const link = escapeHtml(params.billingUrl);
  const accent = params.stage === "final" ? "#f55a42" : "#1a3d2b";

  return `<!DOCTYPE html>
<html lang="pt-BR"><body style="margin:0;background:#f5f3ee;font-family:Arial,Helvetica,sans-serif;color:#1a3d2b">
  <table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:32px 16px">
    <table width="440" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:16px;overflow:hidden">
      <tr><td style="background:${accent};padding:28px;text-align:center;color:#fff;font-size:18px;font-weight:600">
        ${copy.heading}
      </td></tr>
      <tr><td style="padding:28px;font-size:14px;line-height:1.6;color:#444441">
        <p>${copy.body}</p>
        <p style="text-align:center;margin:28px 0">
          <a href="${link}" style="display:inline-block;background:${accent};color:#fff;text-decoration:none;padding:12px 24px;border-radius:8px;font-weight:600">${copy.cta}</a>
        </p>
        <p style="font-size:12px;color:#888780">Se você já atualizou seu pagamento, pode ignorar este e-mail.</p>
      </td></tr>
    </table>
  </td></tr></table>
</body></html>`;
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
}): Promise<void> {
  const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
  if (!RESEND_API_KEY) return;

  const copy = buildDunningCopy(params.stage, params.workspaceName, params.nextAttemptLabel);

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
        }),
      }),
      signal: AbortSignal.timeout(RESEND_TIMEOUT_MS),
    });
    if (!res.ok) console.error(`[dunning-email] Resend error: ${res.status}`);
  } catch (_e) {
    console.error("[dunning-email] Failed to send dunning email");
  }
}
