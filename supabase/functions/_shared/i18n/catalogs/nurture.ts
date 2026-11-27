/**
 * Copy of the nurture sequence (owners who never subscribed). Entries named
 * `*Html` embed trusted markup (`<strong>`); everything else is raw text that
 * the blocks escape.
 */
import { defineCatalog } from "../catalog.ts";

export const nurtureText = defineCatalog({
  pt: {
    common: {
      greetNamed: (name: string) => `Oi, ${name},`,
      greetAnon: "Oi,",
      waButton: "Prefiro falar no WhatsApp",
      footerSentence: "Você recebeu este e-mail porque criou uma conta no Mesaas. Não quer mais receber dicas?",
      unsubscribe: "Descadastrar",
      eyebrowTrial: "Teste grátis",
      eyebrowRecover: "Recupere o Pro",
      eyebrowTip: "Dica",
      eyebrowLastQuestion: "Uma pergunta",
      lastQuestionPreheader: "Uma pergunta rápida, e prometo que é a última.",
      recoverButton: "Recuperar o Pro",
      trialButton: "Começar meu teste grátis",
      questionsHtml: "Ficou alguma dúvida sobre o plano? É só <strong>responder este e-mail</strong>.",
      trialGrid: [
        { title: "Hub do cliente", text: "Aprovação de posts por link, sem login, com a sua marca." },
        { title: "Equipe", text: "Convide seu time e divida as entregas." },
        { title: "Instagram", text: "Agendamento, métricas e relatórios em PDF." },
        { title: "Clientes sem limite", text: "No Free são 2. No teste, quantos você precisar." },
      ],
      proGrid: [
        { title: "Hub do cliente", text: "Aprovação de posts por link, sem login, com a sua marca." },
        { title: "Equipe", text: "Convide seu time e divida as entregas." },
        { title: "Instagram", text: "Agendamento, métricas e relatórios em PDF." },
        { title: "Mais clientes", text: "No Free são 2. No Pro, cabe a carteira da sua agência." },
      ],
      shotAlt: {
        clientes: "Tela de clientes do Mesaas no celular, com seis clientes cadastrados.",
        aprovacoes: "Hub do cliente no celular: quatro posts aguardando aprovação.",
        aprovar: "Post aberto no Hub do cliente, com os botões Corrigir e Aprovar.",
        hub: "Página inicial do Hub do cliente no celular, com posts do mês e aprovações pendentes.",
        relatorios: "Relatórios mensais prontos no Hub do cliente, com opção de baixar o PDF.",
      },
      recoverFine:
        "Como o seu teste do Pro já foi usado, a assinatura começa na hora: a primeira cobrança é feita ao assinar, e dá pra cancelar quando quiser.",
      trialFine:
        "O teste pede um cartão, mas você só é cobrado no fim dos 30 dias se continuar. Eu te aviso por e-mail antes da cobrança, e dá pra cancelar em dois cliques.",
    },
    subject: {
      a1: "Seu primeiro cliente no Mesaas leva 3 minutos",
      a2: "Como as agências aprovam posts sem WhatsApp",
      a3: "Teste tudo do Mesaas por 30 dias",
      a3Ex: "Recupere o Pro no Mesaas",
      b1Ex: "Recupere o Pro para a sua agência",
      b1Zero: "Teste tudo do Mesaas por 30 dias",
      b1N: (n: number) =>
        `Você já tem ${n} ${n === 1 ? "cliente" : "clientes"} no Mesaas. Teste o resto por 30 dias`,
      b2: "Seu cliente aprova o post pelo celular",
      b3: "Relatório de Instagram pronto para mandar ao cliente",
      a4b4: "Posso parar de te escrever?",
    },
    a1: {
      preheader: "Cadastre um cliente e o resto do Mesaas começa a fazer sentido.",
      eyebrow: "Primeiros passos",
      p1: "Vi que você criou sua conta no Mesaas mas ainda não cadastrou nenhum cliente. É normal: a parte chata é começar.",
      p2: "Com um cliente cadastrado você já consegue montar o calendário editorial dele, organizar as entregas no kanban e guardar briefing e contrato num lugar só.",
      title: "Dois jeitos de começar",
      stepManualHtml: "<strong>Na mão</strong>: nome, Instagram e pronto. Leva uns 3 minutos.",
      btnManual: "Cadastrar meu primeiro cliente",
      stepImportHtml:
        "<strong>Importando</strong>: se seus clientes estão no Notion, Trello, ClickUp ou numa planilha, a gente traz tudo.",
      btnImport: "Importar meus clientes",
      closingHtml: "Travou em alguma coisa? É só <strong>responder este e-mail</strong>. Eu leio e respondo pessoalmente.",
    },
    a2: {
      preheader: "Um link, o cliente aprova pelo celular, sem login.",
      p1: 'A parte que mais toma tempo de quem faz social media para cliente não é criar o post. É conseguir a aprovação: print no WhatsApp, áudio de 4 minutos, "pode trocar a cor?" três dias depois.',
      p2: "No Mesaas cada cliente ganha um Hub: um link com a sua marca onde ele vê os posts da semana, aprova ou pede ajuste em cada um, direto do celular e sem criar conta.",
      callout:
        "Cada aprovação ou pedido de ajuste já atualiza o status do post no seu kanban. Você para de caçar resposta no WhatsApp.",
      p3: "Para usar, o primeiro passo é ter um cliente cadastrado.",
      btn: "Cadastrar um cliente",
    },
    a3: {
      recoverPreheader: "Seus dados continuam lá. Com um cartão, o Pro volta na hora.",
      recoverHeadingNamed: (name: string) => `${name}, o Pro continua a um cartão de distância.`,
      recoverHeadingAnon: "O Pro continua a um cartão de distância.",
      recoverP1:
        "Seu teste de 14 dias do Pro terminou e o workspace voltou para o plano Free. Nada foi apagado: clientes, posts e relatórios continuam lá.",
      recoverP2:
        "Com o Pro de volta, você recupera o portal do cliente, a equipe e os relatórios, e os links do portal voltam a abrir.",
      recoverClosingHtml: "Ficou alguma dúvida sobre o plano? É só <strong>responder este e-mail</strong>.",
      preheader: "Hub, equipe, Instagram e relatórios liberados por 30 dias.",
      headingNamed: (name: string) => `${name}, você pode testar tudo por 30 dias.`,
      headingAnon: "Você pode testar tudo por 30 dias.",
      leadNew: "Dá pra testar o Mesaas inteiro por 30 dias, com todos os recursos dos planos pagos liberados.",
      leadOld:
        "Quando você criou sua conta, o Mesaas ainda não tinha teste grátis. Agora tem: 30 dias com todos os recursos dos planos pagos liberados.",
      closingHtml:
        "Se ainda não sabe se o Mesaas serve para a sua agência, <strong>me responde contando como você trabalha hoje</strong> que eu digo com sinceridade.",
    },
    a4: {
      p1: "Te mandei algumas dicas sobre o Mesaas nas últimas semanas e não quero lotar sua caixa de entrada.",
      p2: 'Se puder, me responde com uma linha só: o que faltou para o Mesaas servir para você? Pode ser "não é o momento", "faltou tal coisa" ou "achei caro". Eu leio todas e isso muda o que a gente constrói.',
      p3: "Este é o último e-mail desta série. Sua conta continua lá, do jeito que você deixou.",
    },
    b1: {
      exPreheaderLimit: "Seu Free parou em 2 clientes. O Pro libera o resto.",
      exPreheader: "O Pro libera o portal do cliente, a equipe e os relatórios.",
      preheaderLimit: "Seu Free parou em 2 clientes. O teste libera tudo.",
      preheader: "O teste libera tudo do Mesaas por 30 dias.",
      headingWsNamed: (name: string, ws: string) => `${name}, ${ws} já está no Mesaas.`,
      headingWs: (ws: string) => `${ws} já está no Mesaas.`,
      headingNoWsNamed: (name: string) => `${name}, sua agência já está no Mesaas.`,
      headingNoWs: "Sua agência já está no Mesaas.",
      exLimit: (n: number) =>
        `Você já cadastrou ${n} clientes, e esse é o limite do plano Free. Com o Pro de volta, você segue crescendo e recupera o portal do cliente, a equipe e os relatórios.`,
      exFirst:
        "Você já cadastrou seu primeiro cliente. Com o Pro de volta, você recupera o portal do cliente, a equipe e os relatórios.",
      limit: (n: number) =>
        `Você já cadastrou ${n} clientes, e esse é o limite do plano Free. Para seguir crescendo, e para usar o que o Mesaas tem de melhor, dá pra testar tudo por 30 dias.`,
      first:
        "Você já cadastrou seu primeiro cliente. Para usar o que o Mesaas tem de melhor, dá pra testar tudo por 30 dias.",
    },
    b2: {
      preheaderWho: (who: string) => `${who} pode aprovar a semana inteira num link.`,
      preheader: "Seu cliente pode aprovar a semana inteira num link.",
      p1Who: (who: string) =>
        `Imagina mandar um link só, com os posts da semana, para o seu cliente ${who}. Ele abre no celular, aprova os que estão bons e comenta nos que precisam de ajuste. Sem login, sem print, sem áudio.`,
      p1: "Imagina mandar um link só, com os posts da semana, para o seu cliente. Ele abre no celular, aprova os que estão bons e comenta nos que precisam de ajuste. Sem login, sem print, sem áudio.",
      p2: "Esse é o Hub do cliente. Ele vem com a sua marca, e cada aprovação já atualiza o status do post no seu kanban.",
      calloutRecover: "O Hub, a equipe e o Instagram fazem parte do Pro.",
      calloutTrial: "O Hub, a equipe e o Instagram fazem parte do teste grátis de 30 dias.",
      btnTrial: "Testar o Hub com meu cliente",
    },
    b3: {
      preheader: "Métricas do mês num PDF com a sua marca, sem montar no Canva.",
      p1: "Todo fim de mês alguém da agência para um dia para montar o relatório de cada cliente. No Mesaas ele sai pronto: alcance, engajamento, melhores posts e crescimento, num PDF com a sua marca.",
      p2IgRecover:
        "O Instagram de um cliente seu já está conectado, então as métricas já estão sendo atualizadas sozinhas. No Pro, o relatório em PDF com a sua marca sai pronto todo mês.",
      p2IgTrial:
        "O Instagram de um cliente seu já está conectado, então as métricas já estão sendo atualizadas sozinhas. No teste, o relatório em PDF com a sua marca sai pronto todo mês.",
      p2NoIg:
        "Você conecta o Instagram do cliente uma vez e as métricas passam a ser atualizadas sozinhas, com os melhores horários para postar.",
    },
    b4: {
      p1: "Vi que você já usa o Mesaas com seus clientes, mas ainda não testou os planos pagos. Não quero insistir.",
      p2: "Se puder, me responde com uma linha só: o que faltou para testar? Preço, um recurso, o momento? Eu leio todas e isso muda o que a gente constrói.",
      p3: "Este é o último e-mail desta série. Seu plano Free continua funcionando normalmente.",
    },
  },
  en: {
    common: {
      greetNamed: (name: string) => `Hi, ${name},`,
      greetAnon: "Hi,",
      waButton: "I'd rather talk on WhatsApp",
      footerSentence: "You received this email because you created a Mesaas account. Don't want to receive tips anymore?",
      unsubscribe: "Unsubscribe",
      eyebrowTrial: "Free trial",
      eyebrowRecover: "Get Pro back",
      eyebrowTip: "Tip",
      eyebrowLastQuestion: "One question",
      lastQuestionPreheader: "One quick question, and I promise it is the last.",
      recoverButton: "Get Pro back",
      trialButton: "Start my free trial",
      questionsHtml: "Any questions about the plan? Just <strong>reply to this email</strong>.",
      trialGrid: [
        { title: "Client Hub", text: "Post approval by link, no login, with your brand." },
        { title: "Team", text: "Invite your team and split the deliverables." },
        { title: "Instagram", text: "Scheduling, metrics and PDF reports." },
        { title: "Unlimited clients", text: "On Free it is 2. During the trial, as many as you need." },
      ],
      proGrid: [
        { title: "Client Hub", text: "Post approval by link, no login, with your brand." },
        { title: "Team", text: "Invite your team and split the deliverables." },
        { title: "Instagram", text: "Scheduling, metrics and PDF reports." },
        { title: "More clients", text: "On Free it is 2. On Pro, there is room for your agency's whole portfolio." },
      ],
      shotAlt: {
        clientes: "Mesaas clients screen on a phone, with six clients added.",
        aprovacoes: "Client Hub on a phone: four posts waiting for approval.",
        aprovar: "Post open in the client Hub, with the Fix and Approve buttons.",
        hub: "Client Hub home page on a phone, with the month's posts and pending approvals.",
        relatorios: "Monthly reports ready in the client Hub, with the option to download the PDF.",
      },
      recoverFine:
        "Since your Pro trial has already been used, the subscription starts right away: the first charge is made when you subscribe, and you can cancel any time.",
      trialFine:
        "The trial asks for a card, but you are only charged at the end of the 30 days if you continue. I will email you before the charge, and you can cancel in two clicks.",
    },
    subject: {
      a1: "Your first client on Mesaas takes 3 minutes",
      a2: "How agencies approve posts without WhatsApp",
      a3: "Try everything in Mesaas free for 30 days",
      a3Ex: "Get Pro back on Mesaas",
      b1Ex: "Get Pro back for your agency",
      b1Zero: "Try everything in Mesaas free for 30 days",
      b1N: (n: number) =>
        `You already have ${n} ${n === 1 ? "client" : "clients"} on Mesaas. Try the rest free for 30 days`,
      b2: "Your client approves the post from their phone",
      b3: "Instagram report ready to send to your client",
      a4b4: "Can I stop writing to you?",
    },
    a1: {
      preheader: "Add one client and the rest of Mesaas starts to make sense.",
      eyebrow: "Getting started",
      p1: "I saw that you created your Mesaas account but haven't added any clients yet. That's normal: the hard part is getting started.",
      p2: "With one client added you can already build their editorial calendar, organize deliverables on the kanban and keep the brief and contract in one place.",
      title: "Two ways to get started",
      stepManualHtml: "<strong>By hand</strong>: name, Instagram and done. Takes about 3 minutes.",
      btnManual: "Add my first client",
      stepImportHtml:
        "<strong>Importing</strong>: if your clients are in Notion, Trello, ClickUp or a spreadsheet, we bring everything over.",
      btnImport: "Import my clients",
      closingHtml: "Stuck on something? Just <strong>reply to this email</strong>. I read and answer personally.",
    },
    a2: {
      preheader: "One link, the client approves on their phone, no login.",
      p1: 'The part that takes the most time for anyone doing social media for clients is not creating the post. It is getting approval: a screenshot on WhatsApp, a 4-minute voice note, "can you change the color?" three days later.',
      p2: "In Mesaas every client gets a Hub: a link with your brand where they see the week's posts, approve or request changes on each one, right from their phone and without creating an account.",
      callout:
        "Every approval or change request already updates the post status on your kanban. You stop chasing replies on WhatsApp.",
      p3: "To use it, the first step is having a client added.",
      btn: "Add a client",
    },
    a3: {
      recoverPreheader: "Your data is still there. With a card, Pro is back right away.",
      recoverHeadingNamed: (name: string) => `${name}, Pro is one card away.`,
      recoverHeadingAnon: "Pro is one card away.",
      recoverP1:
        "Your 14-day Pro trial ended and the workspace went back to the Free plan. Nothing was deleted: clients, posts and reports are still there.",
      recoverP2:
        "With Pro back, you get the client portal, the team and the reports again, and the portal links open again.",
      recoverClosingHtml: "Any questions about the plan? Just <strong>reply to this email</strong>.",
      preheader: "Hub, team, Instagram and reports unlocked for 30 days.",
      headingNamed: (name: string) => `${name}, you can try everything for 30 days.`,
      headingAnon: "You can try everything for 30 days.",
      leadNew: "You can try all of Mesaas for 30 days, with every feature of the paid plans unlocked.",
      leadOld:
        "When you created your account, Mesaas did not have a free trial yet. Now it does: 30 days with every feature of the paid plans unlocked.",
      closingHtml:
        "If you are not sure yet whether Mesaas fits your agency, <strong>reply and tell me how you work today</strong> and I will give you an honest answer.",
    },
    a4: {
      p1: "I sent you a few Mesaas tips over the last few weeks and I don't want to fill your inbox.",
      p2: 'If you can, reply with just one line: what was missing for Mesaas to work for you? It can be "not the right time", "it lacked this feature" or "I found it expensive". I read every reply and it changes what we build.',
      p3: "This is the last email in this series. Your account is still there, just as you left it.",
    },
    b1: {
      exPreheaderLimit: "Your Free plan stopped at 2 clients. Pro unlocks the rest.",
      exPreheader: "Pro unlocks the client portal, the team and reports.",
      preheaderLimit: "Your Free plan stopped at 2 clients. The trial unlocks everything.",
      preheader: "The trial unlocks all of Mesaas for 30 days.",
      headingWsNamed: (name: string, ws: string) => `${name}, ${ws} is already on Mesaas.`,
      headingWs: (ws: string) => `${ws} is already on Mesaas.`,
      headingNoWsNamed: (name: string) => `${name}, your agency is already on Mesaas.`,
      headingNoWs: "Your agency is already on Mesaas.",
      exLimit: (n: number) =>
        `You have already added ${n} clients, and that is the Free plan limit. With Pro back, you keep growing and get the client portal, the team and the reports again.`,
      exFirst:
        "You have already added your first client. With Pro back, you get the client portal, the team and the reports again.",
      limit: (n: number) =>
        `You have already added ${n} clients, and that is the Free plan limit. To keep growing, and to use the best of Mesaas, you can try everything for 30 days.`,
      first:
        "You have already added your first client. To use the best of Mesaas, you can try everything for 30 days.",
    },
    b2: {
      preheaderWho: (who: string) => `${who} can approve the whole week with one link.`,
      preheader: "Your client can approve the whole week with one link.",
      p1Who: (who: string) =>
        `Imagine sending just one link, with the week's posts, to your client ${who}. They open it on their phone, approve the ones that look good and comment on the ones that need changes. No login, no screenshots, no voice notes.`,
      p1: "Imagine sending just one link, with the week's posts, to your client. They open it on their phone, approve the ones that look good and comment on the ones that need changes. No login, no screenshots, no voice notes.",
      p2: "This is the client Hub. It comes with your brand, and every approval already updates the post status on your kanban.",
      calloutRecover: "The Hub, the team and Instagram are part of Pro.",
      calloutTrial: "The Hub, the team and Instagram are part of the 30-day free trial.",
      btnTrial: "Try the Hub with my client",
    },
    b3: {
      preheader: "Monthly metrics in a PDF with your brand, no building it in Canva.",
      p1: "At the end of every month someone at the agency stops for a day to build each client's report. In Mesaas it comes out ready: reach, engagement, top posts and growth, in a PDF with your brand.",
      p2IgRecover:
        "One of your clients' Instagram accounts is already connected, so the metrics are already updating on their own. On Pro, the PDF report with your brand comes out ready every month.",
      p2IgTrial:
        "One of your clients' Instagram accounts is already connected, so the metrics are already updating on their own. On the trial, the PDF report with your brand comes out ready every month.",
      p2NoIg:
        "You connect a client's Instagram once and the metrics start updating on their own, with the best times to post.",
    },
    b4: {
      p1: "I saw that you already use Mesaas with your clients, but haven't tried the paid plans yet. I don't want to push.",
      p2: "If you can, reply with just one line: what was missing for you to try it? Price, a feature, the timing? I read every reply and it changes what we build.",
      p3: "This is the last email in this series. Your Free plan keeps working normally.",
    },
  },
});
