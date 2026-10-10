import type { DunningStage } from "./dunning-logic.ts";
import { mesaasEmail } from "./email/shell.ts";
import { alert, button, detailRows, heading, paragraph, spacer } from "./email/blocks.ts";

export interface DunningCopy {
  subject: string;
  heading: string;
  body: string;
  alerta?: string;
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
  _nextAttemptLabel: string | null,
): DunningCopy {
  switch (stage) {
    case "first":
      return {
        subject: `Não conseguimos processar seu pagamento: ${workspaceName}`,
        heading: "Não conseguimos processar seu pagamento",
        body: `A cobrança da assinatura do ${workspaceName} não foi aprovada. ` +
          `Isso normalmente acontece quando o cartão expirou ou foi substituído.`,
        cta: "Atualizar forma de pagamento",
      };
    case "retry":
      return {
        subject: `Ainda não conseguimos processar seu pagamento: ${workspaceName}`,
        heading: "Ainda não conseguimos processar seu pagamento",
        body: `Continuamos sem conseguir cobrar a assinatura do ${workspaceName}. ` +
          `Atualize sua forma de pagamento para manter o acesso.`,
        cta: "Atualizar forma de pagamento",
      };
    case "final":
      return {
        subject: `Último aviso: o acesso ao ${workspaceName} será reduzido`,
        heading: "Último aviso",
        body: `Não conseguimos processar o pagamento da assinatura do ${workspaceName} após várias tentativas.`,
        alerta: `Sem uma forma de pagamento válida, o workspace será movido para o plano ` +
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
  // Raw values: every block escapes its own text.
  const copy = buildDunningCopy(params.stage, params.workspaceName, params.nextAttemptLabel);
  const final = params.stage === "final";
  const next = final ? null : params.nextAttemptLabel;
  const rows = [{ label: "Workspace", value: params.workspaceName }];
  if (next) rows.push({ label: "Próxima tentativa", value: next });
  const preheader = final
    ? "Sem um pagamento válido, o workspace vai para o plano Free."
    : next
    ? `Vamos tentar novamente em ${next}.`
    : "Atualize sua forma de pagamento para manter o acesso.";
  return mesaasEmail({
    preheader,
    eyebrow: "Assinatura",
    eyebrowTone: final ? "danger" : "brand",
    sections: [
      heading(copy.heading) + paragraph(copy.body, "body", "0"),
      detailRows(rows) + (copy.alerta ? spacer(12) + alert(copy.alerta) : ""),
      button(params.billingUrl, copy.cta) +
        paragraph("Se você já atualizou seu pagamento, pode ignorar este e-mail.", "small", "16px 0 0"),
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
