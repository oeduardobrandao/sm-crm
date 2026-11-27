/** Pages of the client/guest unsubscribe function (opened from the footer of the client e-mails). */
import { defineCatalog } from "../catalog.ts";

export const clientUnsubText = defineCatalog({
  pt: {
    htmlLang: "pt-BR",
    title: "Cancelar avisos",
    confirmHeading: "Deixar de receber estes avisos?",
    confirmClient: "Você vai parar de receber e-mails de pendências desta agência.",
    confirmGuest: "Você vai parar de receber convites e avisos de eventos desta agência neste endereço.",
    button: "Cancelar avisos",
    doneTitle: "Pronto",
    doneHeading: "Pronto.",
    doneBody: "Você não vai mais receber estes avisos.",
    invalidTitle: "Link inválido",
    invalidBody: "Este link não é válido.",
    errorTitle: "Algo deu errado",
    errorBody: "Não foi possível processar seu pedido agora. Tente novamente mais tarde.",
  },
  en: {
    htmlLang: "en",
    title: "Stop notices",
    confirmHeading: "Stop receiving these notices?",
    confirmClient: "You will stop receiving pending-item emails from this agency.",
    confirmGuest: "You will stop receiving event invitations and notices from this agency at this address.",
    button: "Stop notices",
    doneTitle: "Done",
    doneHeading: "Done.",
    doneBody: "You will no longer receive these notices.",
    invalidTitle: "Invalid link",
    invalidBody: "This link is not valid.",
    errorTitle: "Something went wrong",
    errorBody: "We could not process your request right now. Please try again later.",
  },
});
