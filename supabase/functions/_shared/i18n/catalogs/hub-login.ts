/** Hub login code e-mail and the messages the Hub login screen shows (error codes stay as they are). */
import { defineCatalog } from "../catalog.ts";

export const hubLoginText = defineCatalog({
  pt: {
    subject: "Seu código de acesso",
    preheader: "O código vale por 10 minutos.",
    heading: "Seu código de acesso",
    intro: (ws: string) => `Use este código para entrar no portal da ${ws}.`,
    validity: "O código vale por 10 minutos.",
    ignore: "Se você não pediu este código, ignore este e-mail.",
    sentBy: (wsHtml: string) => `Enviado por ${wsHtml} via Mesaas`,
    tooMany: "Muitas tentativas. Aguarde alguns minutos.",
    invalidCode: "Código inválido ou expirado.",
    badRequest: "Requisição inválida.",
    internal: "Erro interno.",
    workspaceNotFound: "Workspace não encontrado.",
    hubDisabled: "Hub desativado.",
  },
  en: {
    subject: "Your access code",
    preheader: "The code is valid for 10 minutes.",
    heading: "Your access code",
    intro: (ws: string) => `Use this code to sign in to the ${ws} portal.`,
    validity: "The code is valid for 10 minutes.",
    ignore: "If you did not request this code, ignore this email.",
    sentBy: (wsHtml: string) => `Sent by ${wsHtml} via Mesaas`,
    tooMany: "Too many attempts. Please wait a few minutes.",
    invalidCode: "Invalid or expired code.",
    badRequest: "Invalid request.",
    internal: "Internal error.",
    workspaceNotFound: "Workspace not found.",
    hubDisabled: "Hub disabled.",
  },
});
