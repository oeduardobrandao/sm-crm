/** Workspace invite e-mail (the "set your password" mail for an existing auth user). */
import { defineCatalog } from "../catalog.ts";

export const inviteText = defineCatalog({
  pt: {
    workspaceFallback: "seu workspace",
    subject: (ws: string) => `Seu acesso ao ${ws} no Mesaas`,
    preheader: (ws: string) => `Defina sua senha para entrar no ${ws}.`,
    eyebrow: "Convite",
    heading: (ws: string) => `Você foi convidado para o ${ws}`,
    intro: (wsHtml: string) => `Para acessar o workspace ${wsHtml} no Mesaas, defina sua senha:`,
    cta: "Definir minha senha",
    ignore: "Se você não esperava este convite, ignore este e-mail.",
  },
  en: {
    workspaceFallback: "your workspace",
    subject: (ws: string) => `Your access to ${ws} on Mesaas`,
    preheader: (ws: string) => `Set your password to join ${ws}.`,
    eyebrow: "Invitation",
    heading: (ws: string) => `You have been invited to ${ws}`,
    intro: (wsHtml: string) => `To access the ${wsHtml} workspace on Mesaas, set your password:`,
    cta: "Set my password",
    ignore: "If you were not expecting this invitation, ignore this email.",
  },
});
