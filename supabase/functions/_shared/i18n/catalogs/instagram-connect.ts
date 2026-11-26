/**
 * Instagram connect e-mails: the link sent to the agency's client, and the
 * "connected" notice sent to the member who generated the link. Values that
 * end in `Html` receive already-escaped HTML; the rest receive raw text.
 */
import { defineCatalog } from "../catalog.ts";

export const instagramConnectText = defineCatalog({
  pt: {
    agencyFallback: "Sua agência",
    clienteFallback: "seu perfil",
    linkSubject: (agency: string) => `${agency} precisa conectar seu Instagram`,
    connectedSubject: "Instagram conectado pelo cliente",
    linkPreheader: (agency: string, cliente: string) => `${agency} pediu para conectar o Instagram de ${cliente}.`,
    linkEyebrow: (agency: string) => `A pedido de ${agency}`,
    linkHeading: (cliente: string) => `Conecte o Instagram de ${cliente}`,
    linkIntro: (agencyHtml: string, clienteHtml: string) =>
      `${agencyHtml} pediu para conectar o Instagram de ${clienteHtml} ao Mesaas, a ferramenta que a agência usa para agendar publicações e acompanhar resultados.`,
    step1: "Abra o link abaixo.",
    step2: (clienteHtml: string) => `Entre com a conta do Instagram de ${clienteHtml}.`,
    step3: "Pronto. A agência não vê sua senha em momento algum.",
    linkCta: "Conectar Instagram",
    linkNotExpected: (agency: string) => `Não esperava este pedido? Responda este e-mail e fale direto com ${agency}.`,
    linkFooter: (agency: string) => `Enviado a pedido de ${agency}`,
    connectedPreheader: (ig: string, cliente: string) => `@${ig} foi conectado a ${cliente}.`,
    connectedEyebrow: "Instagram",
    connectedHeading: "Instagram conectado",
    connectedIntro: (clienteHtml: string) => `O cliente ${clienteHtml} concluiu a conexão do Instagram.`,
    connectedAccount: (igHtml: string) => `Conta conectada: ${igHtml}`,
    connectedCta: "Ver o cliente",
    connectedFooter: "Notificação automática do Mesaas",
  },
  en: {
    agencyFallback: "Your agency",
    clienteFallback: "your profile",
    linkSubject: (agency: string) => `${agency} needs to connect your Instagram`,
    connectedSubject: "Instagram connected by the client",
    linkPreheader: (agency: string, cliente: string) => `${agency} asked to connect the Instagram account of ${cliente}.`,
    linkEyebrow: (agency: string) => `On behalf of ${agency}`,
    linkHeading: (cliente: string) => `Connect the Instagram account of ${cliente}`,
    linkIntro: (agencyHtml: string, clienteHtml: string) =>
      `${agencyHtml} asked to connect the Instagram account of ${clienteHtml} to Mesaas, the tool the agency uses to schedule posts and track results.`,
    step1: "Open the link below.",
    step2: (clienteHtml: string) => `Sign in with the Instagram account of ${clienteHtml}.`,
    step3: "Done. The agency never sees your password.",
    linkCta: "Connect Instagram",
    linkNotExpected: (agency: string) => `Not expecting this request? Reply to this email to talk directly with ${agency}.`,
    linkFooter: (agency: string) => `Sent on behalf of ${agency}`,
    connectedPreheader: (ig: string, cliente: string) => `@${ig} was connected to ${cliente}.`,
    connectedEyebrow: "Instagram",
    connectedHeading: "Instagram connected",
    connectedIntro: (clienteHtml: string) => `The client ${clienteHtml} completed the Instagram connection.`,
    connectedAccount: (igHtml: string) => `Connected account: ${igHtml}`,
    connectedCta: "View the client",
    connectedFooter: "Automatic notification from Mesaas",
  },
});
