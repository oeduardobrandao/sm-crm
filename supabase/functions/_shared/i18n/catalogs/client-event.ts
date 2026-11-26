/** Hub "you have pending items" digest e-mail sent to an agency's client. */
import { defineCatalog } from "../catalog.ts";

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

export const clientEventText = defineCatalog({
  pt: {
    months: [
      "janeiro", "fevereiro", "março", "abril", "maio", "junho",
      "julho", "agosto", "setembro", "outubro", "novembro", "dezembro",
    ],
    subject: (ws: string) => `Você tem pendências com ${ws}`,
    remindersHeading: "Eventos aguardando sua confirmação",
    linhaCustom: (titulo: string) => `${titulo} aguardando sua aprovação`,
    linhaMonth: (mes: string) => `Linha editorial de ${mes} aguardando sua aprovação`,
    linhaNoMonth: "Linha editorial aguardando sua aprovação",
    titlePosts: (n: number) => (n === 1 ? "1 post espera sua aprovação" : `${n} posts esperam sua aprovação`),
    titleLinhas: (n: number) =>
      n === 1 ? "1 linha editorial espera sua aprovação" : `${n} linhas editoriais esperam sua aprovação`,
    titleEvents: (n: number) => (n === 1 ? "1 evento aguarda sua confirmação" : `${n} eventos aguardam sua confirmação`),
    titleMessages: (n: number) => (n === 1 ? "1 mensagem espera você" : `${n} mensagens esperam você`),
    titleNone: "Você tem novidades",
    preheaderPosts: (n: number) => (n === 1 ? "1 post aguardando sua aprovação" : `${n} posts aguardando sua aprovação`),
    preheaderLinhas: (n: number) =>
      n === 1 ? "1 linha editorial aguardando sua aprovação" : `${n} linhas editoriais aguardando sua aprovação`,
    preheaderEvents: (n: number) =>
      n === 1 ? "1 evento aguardando sua confirmação" : `${n} eventos aguardando sua confirmação`,
    preheaderMessages: (n: number) => (n === 1 ? "1 mensagem" : `${n} mensagens`),
    preheaderNone: "Você tem novidades.",
    preheaderJoin: " e ",
    greetingPosts: (first: string) => `Olá, ${first}! Quando puder, dá uma olhada no que a equipe preparou:`,
    greetingEvents: (first: string) => `Olá, ${first}! Confirme sua presença nos próximos eventos:`,
    greetingPlain: (first: string) => `Olá, ${first}!`,
    morePosts: (n: number) => `e mais ${n} posts aguardando aprovação.`,
    unreadOne: "<strong>1 mensagem não lida</strong> da equipe esperando você.",
    unreadMany: (n: number) => `<strong>${n} mensagens não lidas</strong> da equipe esperando você.`,
    ctaReview: "Revisar e aprovar",
    ctaConfirm: "Confirmar presença",
    ctaMessages: "Ver mensagens",
    sentBy: (wsHtml: string) => `Enviado por ${wsHtml} via Mesaas`,
    unsub: "Não quero mais receber esses avisos",
  },
  en: {
    months: [
      "January", "February", "March", "April", "May", "June",
      "July", "August", "September", "October", "November", "December",
    ],
    subject: (ws: string) => `You have pending items with ${ws}`,
    remindersHeading: "Events waiting for your confirmation",
    linhaCustom: (titulo: string) => `${titulo} is waiting for your approval`,
    linhaMonth: (mes: string) => `Editorial line for ${mes} is waiting for your approval`,
    linhaNoMonth: "Editorial line is waiting for your approval",
    titlePosts: (n: number) => (n === 1 ? "1 post is waiting for your approval" : `${n} posts are waiting for your approval`),
    titleLinhas: (n: number) =>
      n === 1 ? "1 editorial line is waiting for your approval" : `${n} editorial lines are waiting for your approval`,
    titleEvents: (n: number) =>
      n === 1 ? "1 event is waiting for your confirmation" : `${n} events are waiting for your confirmation`,
    titleMessages: (n: number) => (n === 1 ? "1 message is waiting for you" : `${n} messages are waiting for you`),
    titleNone: "You have news",
    preheaderPosts: (n: number) => `${n} ${plural(n, "post", "posts")} waiting for your approval`,
    preheaderLinhas: (n: number) => `${n} editorial ${plural(n, "line", "lines")} waiting for your approval`,
    preheaderEvents: (n: number) => `${n} ${plural(n, "event", "events")} waiting for your confirmation`,
    preheaderMessages: (n: number) => `${n} ${plural(n, "message", "messages")}`,
    preheaderNone: "You have news.",
    preheaderJoin: " and ",
    greetingPosts: (first: string) => `Hi ${first}! When you have a moment, take a look at what the team prepared:`,
    greetingEvents: (first: string) => `Hi ${first}! Please confirm your attendance at the upcoming events:`,
    greetingPlain: (first: string) => `Hi ${first}!`,
    morePosts: (n: number) => `and ${n} more posts waiting for approval.`,
    unreadOne: "<strong>1 unread message</strong> from the team is waiting for you.",
    unreadMany: (n: number) => `<strong>${n} unread messages</strong> from the team are waiting for you.`,
    ctaReview: "Review and approve",
    ctaConfirm: "Confirm attendance",
    ctaMessages: "View messages",
    sentBy: (wsHtml: string) => `Sent by ${wsHtml} via Mesaas`,
    unsub: "I no longer want to receive these notices",
  },
});
