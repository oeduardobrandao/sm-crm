/** Copy of the nurture opt-out page served by `nurture-unsub`. */
import { defineCatalog } from "../catalog.ts";

export const nurtureUnsubText = defineCatalog({
  pt: {
    htmlLang: "pt-BR",
    confirmTitle: "Parar de receber",
    confirmHeading: "Parar de receber as dicas do Mesaas?",
    confirmBody:
      "Você vai parar de receber os e-mails de dicas. E-mails da sua conta (convites, cobrança, avisos do teste) continuam chegando.",
    confirmButton: "Parar de receber",
    doneTitle: "Pronto",
    doneHeading: "Pronto.",
    doneBody: "Você não vai mais receber as dicas por e-mail. Dá pra religar em Configurações &gt; Notificações.",
    invalidTitle: "Link inválido",
    invalidHeading: "Link inválido",
    invalidBody: "Este link não é válido.",
    errorTitle: "Algo deu errado",
    errorHeading: "Algo deu errado",
    errorBody: "Não foi possível processar seu pedido agora. Tente novamente mais tarde.",
  },
  en: {
    htmlLang: "en",
    confirmTitle: "Stop receiving",
    confirmHeading: "Stop receiving Mesaas tips?",
    confirmBody:
      "You will stop receiving the tips emails. Account emails (invites, billing, trial notices) keep arriving.",
    confirmButton: "Stop receiving",
    doneTitle: "Done",
    doneHeading: "Done.",
    doneBody: "You will no longer receive the tips by email. You can turn them back on in Settings &gt; Notifications.",
    invalidTitle: "Invalid link",
    invalidHeading: "Invalid link",
    invalidBody: "This link is not valid.",
    errorTitle: "Something went wrong",
    errorHeading: "Something went wrong",
    errorBody: "We could not process your request right now. Please try again later.",
  },
});
