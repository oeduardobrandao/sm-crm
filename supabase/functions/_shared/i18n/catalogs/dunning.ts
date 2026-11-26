/** Failed-payment (dunning) e-mail to the workspace owner. */
import { defineCatalog } from "../catalog.ts";

export const dunningText = defineCatalog({
  pt: {
    workspaceFallback: "seu workspace",
    first: {
      subject: (ws: string) => `Não conseguimos processar seu pagamento: ${ws}`,
      heading: "Não conseguimos processar seu pagamento",
      body: (ws: string) =>
        `A cobrança da assinatura do ${ws} não foi aprovada. ` +
        `Isso normalmente acontece quando o cartão expirou ou foi substituído.`,
      cta: "Atualizar forma de pagamento",
    },
    retry: {
      subject: (ws: string) => `Ainda não conseguimos processar seu pagamento: ${ws}`,
      heading: "Ainda não conseguimos processar seu pagamento",
      body: (ws: string) =>
        `Continuamos sem conseguir cobrar a assinatura do ${ws}. ` +
        `Atualize sua forma de pagamento para manter o acesso.`,
      cta: "Atualizar forma de pagamento",
    },
    final: {
      subject: (ws: string) => `Último aviso: o acesso ao ${ws} será reduzido`,
      heading: "Último aviso",
      body: (ws: string) =>
        `Não conseguimos processar o pagamento da assinatura do ${ws} após várias tentativas.`,
      alerta: `Sem uma forma de pagamento válida, o workspace será movido para o plano ` +
        `Free e os recursos do seu plano atual deixarão de funcionar.`,
      cta: "Regularizar agora",
    },
    eyebrow: "Assinatura",
    rowWorkspace: "Workspace",
    rowNextAttempt: "Próxima tentativa",
    preheaderFinal: "Sem um pagamento válido, o workspace vai para o plano Free.",
    preheaderNext: (next: string) => `Vamos tentar novamente em ${next}.`,
    preheaderDefault: "Atualize sua forma de pagamento para manter o acesso.",
    ignore: "Se você já atualizou seu pagamento, pode ignorar este e-mail.",
  },
  en: {
    workspaceFallback: "your workspace",
    first: {
      subject: (ws: string) => `We could not process your payment: ${ws}`,
      heading: "We could not process your payment",
      body: (ws: string) =>
        `The charge for the ${ws} subscription was declined. ` +
        `This usually happens when the card expired or was replaced.`,
      cta: "Update payment method",
    },
    retry: {
      subject: (ws: string) => `We still could not process your payment: ${ws}`,
      heading: "We still could not process your payment",
      body: (ws: string) =>
        `We are still unable to charge the ${ws} subscription. ` +
        `Update your payment method to keep your access.`,
      cta: "Update payment method",
    },
    final: {
      subject: (ws: string) => `Final notice: access to ${ws} will be reduced`,
      heading: "Final notice",
      body: (ws: string) =>
        `We could not process the payment for the ${ws} subscription after several attempts.`,
      alerta: `Without a valid payment method, the workspace will be moved to the Free plan ` +
        `and the features of your current plan will stop working.`,
      cta: "Fix it now",
    },
    eyebrow: "Subscription",
    rowWorkspace: "Workspace",
    rowNextAttempt: "Next attempt",
    preheaderFinal: "Without a valid payment, the workspace moves to the Free plan.",
    preheaderNext: (next: string) => `We will try again on ${next}.`,
    preheaderDefault: "Update your payment method to keep your access.",
    ignore: "If you already updated your payment, you can ignore this email.",
  },
});
