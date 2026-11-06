/**
 * Nurture sequence for workspace owners who never subscribed (4 emails per
 * track). Pure builders: no I/O. Every user value goes through an escaping
 * block (paragraph, heading, strong, button label); subjects with user data go
 * through sanitizeSubjectValue.
 */
import { mesaasEmail } from "./email/shell.ts";
import {
  button,
  callout,
  featureGrid,
  heading,
  link,
  paragraph,
  paragraphHtml,
  sectionTitle,
  signature,
  spacer,
  steps,
} from "./email/blocks.ts";
import { EMAIL } from "./email/tokens.ts";
import { escapeHtml } from "./report-template/escape.ts";
import { sanitizeSubjectValue } from "./lifecycle-emails.ts";

export type NurtureStep = "a1" | "a2" | "a3" | "a4" | "b1" | "b2" | "b3" | "b4";

export interface NurtureEmailInput {
  step: NurtureStep;
  firstName: string | null;
  workspaceName: string;
  /** ISO date or timestamp; only the YYYY-MM-DD prefix is compared. */
  workspaceCreatedAt: string;
  clientCount: number;
  firstClientName: string | null;
  hasInstagram: boolean;
  appBaseUrl: string;
  unsubUrl: string;
  whatsappUrl: string | null;
}

/** Day the 30-day trial launched; accounts created before it had no free trial. */
export const TRIAL_FIRST_LAUNCH = "2026-10-27";

export const NURTURE_SAMPLE: Omit<NurtureEmailInput, "step" | "appBaseUrl" | "unsubUrl" | "whatsappUrl"> = {
  firstName: "Ana",
  workspaceName: "Agência Aurora",
  workspaceCreatedAt: "2026-09-01",
  clientCount: 2,
  firstClientName: "Studio Bela",
  hasInstagram: false,
};

export function nurtureUtm(appBaseUrl: string, path: string, step: NurtureStep): string {
  return `${appBaseUrl}${path}?utm_source=email&utm_medium=nurture&utm_campaign=nurture_${step}`;
}

const FOOTER_SENTENCE = "Você recebeu este e-mail porque criou uma conta no Mesaas. Não quer mais receber dicas?";

const trialGrid = () =>
  featureGrid([
    { title: "Hub do cliente", text: "Aprovação de posts por link, sem login, com a sua marca." },
    { title: "Equipe", text: "Convide seu time e divida as entregas." },
    { title: "Instagram", text: "Agendamento, métricas e relatórios em PDF." },
    { title: "Clientes sem limite", text: "No Free são 2. No teste, quantos você precisar." },
  ]);

const trialFine = () =>
  paragraph(
    "O teste pede um cartão, mas você só é cobrado no fim dos 30 dias se continuar. Eu te aviso por e-mail antes da cobrança, e dá pra cancelar em dois cliques.",
    "small",
    "14px 0 0",
  );

export function buildNurtureEmail(p: NurtureEmailInput): { subject: string; html: string } {
  const u = (path: string) => nurtureUtm(p.appBaseUrl, path, p.step);
  const greet = paragraph(p.firstName ? `Oi, ${p.firstName},` : "Oi,");
  const waBtn = p.whatsappUrl ? button(p.whatsappUrl, "Prefiro falar no WhatsApp", "outline") + spacer(24) : "";

  let subject = "";
  let preheader = "";
  let eyebrow = "";
  let sections: string[] = [];

  switch (p.step) {
    case "a1":
      subject = "Seu primeiro cliente no Mesaas leva 3 minutos";
      preheader = "Cadastre um cliente e o resto do Mesaas começa a fazer sentido.";
      eyebrow = "Primeiros passos";
      sections = [
        greet +
        paragraph(
          "Vi que você criou sua conta no Mesaas mas ainda não cadastrou nenhum cliente. É normal: a parte chata é começar.",
        ) +
        paragraph(
          "Com um cliente cadastrado você já consegue montar o calendário editorial dele, organizar as entregas no kanban e guardar briefing e contrato num lugar só.",
        ),
        sectionTitle("Dois jeitos de começar") +
        steps([
          `<strong>Na mão</strong>: nome, Instagram e pronto. Leva uns 3 minutos.${spacer(12)}${button(u("/clientes"), "Cadastrar meu primeiro cliente")}`,
          `<strong>Importando</strong>: se seus clientes estão no Notion, Trello, ClickUp ou numa planilha, a gente traz tudo.${spacer(12)}${button(u("/importar"), "Importar meus clientes", "outline")}`,
        ]),
        paragraphHtml(
          "Travou em alguma coisa? É só <strong>responder este e-mail</strong>. Eu leio e respondo pessoalmente.",
          "body",
          "0 0 18px",
        ) + signature(),
      ];
      break;
    case "a2":
      subject = "Como as agências aprovam posts sem WhatsApp";
      preheader = "Um link, o cliente aprova pelo celular, sem login.";
      eyebrow = "Dica";
      sections = [
        greet +
        paragraph(
          'A parte que mais toma tempo de quem faz social media para cliente não é criar o post. É conseguir a aprovação: print no WhatsApp, áudio de 4 minutos, "pode trocar a cor?" três dias depois.',
        ) +
        paragraph(
          "No Mesaas cada cliente ganha um Hub: um link com a sua marca onde ele vê os posts da semana, aprova ou pede ajuste em cada um, direto do celular e sem criar conta.",
        ),
        callout(
          "Cada aprovação ou pedido de ajuste já atualiza o status do post no seu kanban. Você para de caçar resposta no WhatsApp.",
        ),
        paragraph("Para usar, o primeiro passo é ter um cliente cadastrado.", "body", "0 0 18px") +
        button(u("/clientes"), "Cadastrar um cliente") + spacer(24) + signature(),
      ];
      break;
    case "a3": {
      const trialFirst = p.workspaceCreatedAt.slice(0, 10) >= TRIAL_FIRST_LAUNCH;
      subject = "Teste tudo do Mesaas por 30 dias";
      preheader = "Hub, equipe, Instagram e relatórios liberados por 30 dias.";
      eyebrow = "Teste grátis";
      sections = [
        heading(p.firstName ? `${p.firstName}, você pode testar tudo por 30 dias.` : "Você pode testar tudo por 30 dias.") +
        paragraph(
          trialFirst
            ? "Dá pra testar o Mesaas inteiro por 30 dias, com todos os recursos dos planos pagos liberados."
            : "Quando você criou sua conta, o Mesaas ainda não tinha teste grátis. Agora tem: 30 dias com todos os recursos dos planos pagos liberados.",
        ) +
        trialGrid() + spacer(8) + button(u("/comecar"), "Começar meu teste grátis") + trialFine(),
        paragraphHtml(
          "Se ainda não sabe se o Mesaas serve para a sua agência, <strong>me responde contando como você trabalha hoje</strong> que eu digo com sinceridade.",
          "body",
          "0 0 18px",
        ) + signature(),
      ];
      break;
    }
    case "a4":
      subject = "Posso parar de te escrever?";
      preheader = "Uma pergunta rápida, e prometo que é a última.";
      eyebrow = "Uma pergunta";
      sections = [
        greet +
        paragraph("Te mandei algumas dicas sobre o Mesaas nas últimas semanas e não quero lotar sua caixa de entrada.") +
        paragraph(
          'Se puder, me responde com uma linha só: o que faltou para o Mesaas servir para você? Pode ser "não é o momento", "faltou tal coisa" ou "achei caro". Eu leio todas e isso muda o que a gente constrói.',
        ) +
        paragraph("Este é o último e-mail desta série. Sua conta continua lá, do jeito que você deixou.", "body", "0 0 18px") +
        waBtn + signature(),
      ];
      break;
    case "b1": {
      const n = Math.max(0, Math.floor(p.clientCount));
      const atLimit = n >= 2;
      subject = n === 0
        ? "Teste tudo do Mesaas por 30 dias"
        : `Você já tem ${n} ${n === 1 ? "cliente" : "clientes"} no Mesaas. Teste o resto por 30 dias`;
      preheader = atLimit ? "Seu Free parou em 2 clientes. O teste libera tudo." : "O teste libera tudo do Mesaas por 30 dias.";
      eyebrow = "Teste grátis";
      sections = [
        heading(p.firstName ? `${p.firstName}, a ${p.workspaceName} já está no Mesaas.` : `A ${p.workspaceName} já está no Mesaas.`) +
        paragraph(
          atLimit
            ? `Você já cadastrou ${n} clientes, e esse é o limite do plano Free. Para seguir crescendo, e para usar o que o Mesaas tem de melhor, dá pra testar tudo por 30 dias.`
            : "Você já cadastrou seu primeiro cliente. Para usar o que o Mesaas tem de melhor, dá pra testar tudo por 30 dias.",
        ) +
        trialGrid() + spacer(8) + button(u("/comecar"), "Começar meu teste grátis") + trialFine(),
        paragraphHtml("Ficou alguma dúvida sobre o plano? É só <strong>responder este e-mail</strong>.", "body", "0 0 18px") +
        signature(),
      ];
      break;
    }
    case "b2": {
      const who = p.firstClientName;
      subject = "Seu cliente aprova o post pelo celular";
      preheader = who ? `O ${who} pode aprovar a semana inteira num link.` : "Seu cliente pode aprovar a semana inteira num link.";
      eyebrow = "Dica";
      sections = [
        greet +
        paragraph(
          `Imagina mandar para ${who ?? "o seu cliente"} um link só, com os posts da semana. Ele abre no celular, aprova os que estão bons e comenta nos que precisam de ajuste. Sem login, sem print, sem áudio.`,
        ) +
        paragraph(
          "Esse é o Hub do cliente. Ele vem com a sua marca, e cada aprovação já atualiza o status do post no seu kanban.",
        ),
        callout("O Hub, a equipe e o Instagram fazem parte do teste grátis de 30 dias."),
        button(u("/comecar"), who ? `Testar o Hub com o ${who}` : "Testar o Hub com meu cliente") + spacer(24) + signature(),
      ];
      break;
    }
    case "b3":
      subject = "Relatório de Instagram pronto para mandar ao cliente";
      preheader = "Métricas do mês num PDF com a sua marca, sem montar no Canva.";
      eyebrow = "Dica";
      sections = [
        greet +
        paragraph(
          "Todo fim de mês alguém da agência para um dia para montar o relatório de cada cliente. No Mesaas ele sai pronto: alcance, engajamento, melhores posts e crescimento, num PDF com a sua marca.",
        ) +
        paragraph(
          p.hasInstagram
            ? "O Instagram de um cliente seu já está conectado, então as métricas já estão sendo atualizadas sozinhas. No teste, o relatório em PDF com a sua marca sai pronto todo mês."
            : "Você conecta o Instagram do cliente uma vez e as métricas passam a ser atualizadas sozinhas, com os melhores horários para postar.",
        ),
        button(u("/comecar"), "Começar meu teste grátis") + trialFine() + spacer(18) + signature(),
      ];
      break;
    case "b4":
      subject = "Posso parar de te escrever?";
      preheader = "Uma pergunta rápida, e prometo que é a última.";
      eyebrow = "Uma pergunta";
      sections = [
        greet +
        paragraph(
          `Vi que a ${p.workspaceName} já usa o Mesaas com seus clientes, mas ainda não testou os planos pagos. Não quero insistir.`,
        ) +
        paragraph(
          "Se puder, me responde com uma linha só: o que faltou para testar? Preço, um recurso, o momento? Eu leio todas e isso muda o que a gente constrói.",
        ) +
        paragraph("Este é o último e-mail desta série. Seu plano Free continua funcionando normalmente.", "body", "0 0 18px") +
        waBtn + signature(),
      ];
      break;
  }

  const html = mesaasEmail({
    preheader,
    eyebrow,
    sections,
    footerLines: [],
    footerHtml: [`${escapeHtml(FOOTER_SENTENCE)} ${link(p.unsubUrl, "Descadastrar", EMAIL.muted)}`],
  });
  return { subject: sanitizeSubjectValue(subject), html };
}
