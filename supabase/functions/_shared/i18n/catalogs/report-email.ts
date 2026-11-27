/** Monthly report e-mail sent to the agency's client. Footer receives escaped HTML. */
import { defineCatalog } from "../catalog.ts";

export const reportEmailText = defineCatalog({
  pt: {
    kpiViews: "Visualizações",
    kpiInteractions: "Interações",
    kpiFollowers: "Seguidores",
    eyebrow: (monthHtml: string) => `Relatório mensal · ${monthHtml}`,
    hello: (first: string) => `Olá, ${first}!`,
    highlight: "Destaque do mês",
    cta: "Ver relatório completo",
    pdf: "Baixar em PDF",
    preheaderViews: (delta: string, month: string) => `Visualizações ${delta} em ${month}. Veja o relatório completo.`,
    preheaderReady: (month: string) => `Seu relatório de ${month} está pronto.`,
    subject: (monthName: string) => `Seu relatório de ${monthName} está pronto!`,
    footer: (wsHtml: string) => `Enviado por ${wsHtml} via Mesaas`,
  },
  en: {
    kpiViews: "Views",
    kpiInteractions: "Interactions",
    kpiFollowers: "Followers",
    eyebrow: (monthHtml: string) => `Monthly report · ${monthHtml}`,
    hello: (first: string) => `Hi, ${first}!`,
    highlight: "Highlight of the month",
    cta: "View full report",
    pdf: "Download PDF",
    preheaderViews: (delta: string, month: string) => `Views ${delta} in ${month}. See the full report.`,
    preheaderReady: (month: string) => `Your ${month} report is ready.`,
    subject: (monthName: string) => `Your ${monthName} report is ready!`,
    footer: (wsHtml: string) => `Sent by ${wsHtml} via Mesaas`,
  },
});
