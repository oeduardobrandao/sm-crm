/**
 * Copy of the owner lifecycle e-mails (welcome, thank-you, trial reminder,
 * reverse trial). Values are raw copy; `*Html` entries and entries that embed a
 * `<strong>` are trusted HTML fragments, and the builder passes already escaped
 * or already built-link arguments to the functions.
 */
import { defineCatalog } from "../catalog.ts";

export const lifecycleText = defineCatalog({
  pt: {
    welcome: {
      subject: "Boas-vindas ao Mesaas 👋",
      preheader: "Três passos para deixar sua agência rodando.",
      eyebrow: "Boas-vindas",
      reverseLead: "Ao entrar, seu workspace fica no Pro por 14 dias, sem cartão.",
      trialLeadReverse: "Ao entrar, seu workspace fica no Pro por 14 dias, sem cartão. Nesse período você também tem:",
      trialLeadCard: "No teste grátis de 30 dias dos planos pagos você também tem:",
      enterApp: "Entrar no Mesaas",
      startTrial: "Começar meu teste grátis",
      greetNamed: (name: string) => `Olá, ${name}! Que bom ter você aqui.`,
      greetAnon: "Olá! Que bom ter você aqui.",
      intro1: "Aqui é o Eduardo, do Mesaas. Obrigado por criar sua conta.",
      intro2Html:
        "O Mesaas é uma <strong>plataforma de gestão para agências de social media</strong>: clientes, entregas e calendário editorial em um lugar só.",
      stepsTitle: "Comece em 3 passos",
      step1: "Cadastre seu primeiro cliente.",
      step2Html: "<strong>Importe seus dados</strong>: trazemos tudo do Notion, Trello, ClickUp ou CSV em poucos cliques.",
      importButton: "Importar meus dados",
      step3: "Crie sua primeira entrega e organize o calendário editorial.",
      featClientsTitle: "Clientes & CRM",
      featClientsText: "Todos os seus clientes, briefings e contratos organizados.",
      featDeliveriesTitle: "Entregas",
      featDeliveriesText: "kanban de workflows + calendário editorial.",
      featHubTitle: "Aprovações pelo Hub do cliente",
      featHubText: "Portal whitelabel, sem login, com a sua marca.",
      featTeamTitle: "Equipe",
      featTeamText: "Convide seu time e trabalhe junto nas entregas.",
      featIgTitle: "Analytics de Instagram",
      featIgText: "Métricas e relatórios prontos para enviar.",
      helpLabel: "Central de Ajuda",
      newsLabel: "Novidades",
      callout: (help: string, news: string) =>
        `Dúvidas? A ${help} tem guias passo a passo, e as ${news} mostram o que estamos lançando.`,
      closingWa:
        "Qualquer dúvida, é só <strong>responder este e-mail</strong>. Eu leio e respondo pessoalmente, e se preferir WhatsApp, é só clicar no botão abaixo.",
      closingNoWa: "Qualquer dúvida, é só <strong>responder este e-mail</strong>. Eu leio e respondo pessoalmente.",
      waButton: "Falar no WhatsApp",
      footer: "Você recebeu este e-mail porque criou uma conta no Mesaas.",
    },
    thanks: {
      subject: "Obrigado pela confiança 💚",
      preheader: "Obrigado pela confiança no Mesaas.",
      eyebrow: "Assinatura",
      greetNamed: (name: string) => `Olá, ${name}!`,
      greetAnon: "Olá!",
      introHtml: (ws: string) =>
        `Aqui é o Eduardo, do Mesaas. Vi que o <strong>${ws}</strong> acabou de ativar um plano e queria agradecer pessoalmente.`,
      thanks:
        "Obrigado por depositar essa confiança no Mesaas. Vamos trabalhar todos os dias para merecer essa escolha e cuidar bem da operação da sua agência.",
      stepsTitle: "Para aproveitar ao máximo",
      step1: "Conecte o Instagram dos seus clientes e acompanhe as métricas.",
      step2Html: (importLink: string) => `Traga seus dados de outras ferramentas: ${importLink}.`,
      importLabel: "importe do Notion, Trello, ClickUp ou CSV",
      step3: "Ative o Hub para os seus clientes aprovarem posts sem precisar de login.",
      settingsLabel: "Configurações",
      settingsHtml: (settingsLink: string) =>
        `Seu plano fica em ${settingsLink}, e você pode ajustá-lo quando quiser.`,
      askHtml: "Me conta: o que faria o Mesaas ser ainda melhor para a sua agência? É só <strong>responder este e-mail</strong>.",
      footer: (ws: string) => `Você recebeu este e-mail porque o workspace ${ws} ativou um plano no Mesaas.`,
    },
    reminder: {
      subject: (planName: string, daysLeft: number) =>
        `Seu teste do Mesaas${planName ? ` ${planName}` : ""} termina em ${daysLeft} dias`,
      greetNamed: (name: string) => `Oi, ${name},`,
      greetAnon: "Oi,",
      leadPlan: (plan: string) => `Seu teste grátis do plano ${plan} no workspace`,
      leadNoPlan: "Seu teste grátis no workspace",
      ends: (lead: string, ws: string, date: string) => `${lead} ${ws} termina em ${date}.`,
      chargeAmount: (amount: string) => `Nesse dia fazemos a primeira cobrança de ${amount} no cartão cadastrado.`,
      chargeNoAmount: "Nesse dia fazemos a primeira cobrança do valor do seu plano no cartão cadastrado.",
      preheader: (date: string) => `Sua primeira cobrança será em ${date}.`,
      eyebrow: "Seu teste grátis",
      keepGoing: "Se quiser continuar, não precisa fazer nada.",
      button: "Ver meu plano",
      cancelHtml: (billingLink: string) =>
        `Se preferir cancelar ou trocar de plano, é só acessar Plano e cobrança antes dessa data: ${billingLink}.`,
      freeNote: "No plano Free você volta a ter 2 clientes, só você na conta e nenhum portal de aprovação ou relatório.",
      footer: (ws: string) => `Você recebeu este e-mail porque o workspace ${ws} está em teste grátis no Mesaas.`,
    },
    reverse: {
      endedSubject: "Seu workspace voltou para o plano Free",
      hubPausingSubject: "Os links do portal dos seus clientes pausam amanhã",
      endingSubject: (date: string) => `Seu teste do Pro termina em ${date}`,
      greetNamed: (name: string) => `Oi, ${name},`,
      greetAnon: "Oi,",
      footer: (ws: string) => `Você recebeu este e-mail porque é dono do workspace ${ws} no Mesaas.`,
      perMonth: (money: string) => `${money} por mês`,
      addCard: "Adicionar cartão",
      endingPreheader: (date: string) => `Sem cartão, o workspace volta para o plano Free em ${date}.`,
      endingEyebrow: "Seu teste do Pro",
      endingLead: (plan: string, ws: string, date: string) =>
        `O teste grátis do ${plan} no workspace ${ws} termina em ${date}.`,
      endingPrice: (plan: string, price: string) =>
        `Para continuar no ${plan}, adicione um cartão. Nada é cobrado agora: a primeira cobrança, de ${price}, nunca acontece antes do fim do teste.`,
      endingNoPrice: (plan: string) =>
        `Para continuar no ${plan}, adicione um cartão. Nada é cobrado agora: a primeira cobrança nunca acontece antes do fim do teste.`,
      endingSmall:
        "Sem cartão, o workspace volta para o plano Free nesse dia: até 2 clientes, só você na conta, sem portal do cliente e sem relatórios. Nada é apagado.",
      endedPreheader: "Nada foi apagado. Adicione um cartão para recuperar o Pro.",
      endedEyebrow: "Plano Free",
      endedLead: (plan: string, ws: string, date: string) =>
        `O teste grátis do ${plan} no workspace ${ws} terminou em ${date}, e o workspace voltou para o plano Free.`,
      endedBody:
        "Nada foi apagado: seus clientes, posts, entregas e relatórios continuam lá. No Free, cadastrar além dos limites do plano fica bloqueado, e Financeiro e Contratos ficam só para consulta.",
      endedHubCallout: (date: string, plan: string) =>
        `Os links do portal dos seus clientes pausam em ${date}. Recuperando o ${plan} antes disso, eles continuam funcionando.`,
      recover: (plan: string) => `Recuperar o ${plan}`,
      endedSmall: (plan: string) => `Para recuperar o ${plan}, é só adicionar um cartão em Plano e cobrança.`,
      hubPreheader: (date: string) => `A partir de ${date}, os links do portal deixam de abrir.`,
      hubEyebrow: "Portal do cliente",
      hubLead: (date: string, ws: string) =>
        `Amanhã, ${date}, os links do portal dos clientes do workspace ${ws} deixam de abrir. Seus clientes vão ver um aviso de que o portal está pausado.`,
      hubBody: (plan: string) =>
        `Nada foi apagado. Assim que você recuperar o ${plan}, os mesmos links voltam a funcionar, sem precisar enviar links novos.`,
    },
  },
  en: {
    welcome: {
      subject: "Welcome to Mesaas 👋",
      preheader: "Three steps to get your agency up and running.",
      eyebrow: "Welcome",
      reverseLead: "When you sign in, your workspace gets 14 days of Pro, no card needed.",
      trialLeadReverse: "When you sign in, your workspace gets 14 days of Pro, no card needed. During that time you also get:",
      trialLeadCard: "With the 30-day free trial of the paid plans you also get:",
      enterApp: "Go to Mesaas",
      startTrial: "Start my free trial",
      greetNamed: (name: string) => `Hi, ${name}! So glad you're here.`,
      greetAnon: "Hi! So glad you're here.",
      intro1: "This is Eduardo from Mesaas. Thanks for creating your account.",
      intro2Html:
        "Mesaas is a <strong>management platform for social media agencies</strong>: clients, deliverables and the editorial calendar in one place.",
      stepsTitle: "Get started in 3 steps",
      step1: "Add your first client.",
      step2Html: "<strong>Import your data</strong>: we bring everything over from Notion, Trello, ClickUp or CSV in a few clicks.",
      importButton: "Import my data",
      step3: "Create your first deliverable and organize the editorial calendar.",
      featClientsTitle: "Clients & CRM",
      featClientsText: "All your clients, briefs and contracts in one organized place.",
      featDeliveriesTitle: "Deliverables",
      featDeliveriesText: "Workflow kanban + editorial calendar.",
      featHubTitle: "Approvals through the client Hub",
      featHubText: "White-label portal, no login, with your brand.",
      featTeamTitle: "Team",
      featTeamText: "Invite your team and work on deliverables together.",
      featIgTitle: "Instagram analytics",
      featIgText: "Metrics and reports ready to send.",
      helpLabel: "Help Center",
      newsLabel: "What's New",
      callout: (help: string, news: string) =>
        `Questions? The ${help} has step-by-step guides, and ${news} shows what we are launching.`,
      closingWa:
        "Any questions, just <strong>reply to this email</strong>. I read and answer personally, and if you prefer WhatsApp, just click the button below.",
      closingNoWa: "Any questions, just <strong>reply to this email</strong>. I read and answer personally.",
      waButton: "Chat on WhatsApp",
      footer: "You received this email because you created a Mesaas account.",
    },
    thanks: {
      subject: "Thanks for trusting us 💚",
      preheader: "Thanks for trusting Mesaas.",
      eyebrow: "Subscription",
      greetNamed: (name: string) => `Hi, ${name}!`,
      greetAnon: "Hi!",
      introHtml: (ws: string) =>
        `This is Eduardo from Mesaas. I saw that <strong>${ws}</strong> just activated a plan and wanted to thank you personally.`,
      thanks:
        "Thank you for putting your trust in Mesaas. We will work every day to earn that choice and take good care of your agency's operations.",
      stepsTitle: "Make the most of it",
      step1: "Connect your clients' Instagram accounts and follow the metrics.",
      step2Html: (importLink: string) => `Bring your data from other tools: ${importLink}.`,
      importLabel: "import from Notion, Trello, ClickUp or CSV",
      step3: "Turn on the Hub so your clients can approve posts without needing to log in.",
      settingsLabel: "Settings",
      settingsHtml: (settingsLink: string) =>
        `Your plan lives in ${settingsLink}, and you can adjust it whenever you like.`,
      askHtml: "Tell me: what would make Mesaas even better for your agency? Just <strong>reply to this email</strong>.",
      footer: (ws: string) => `You received this email because the workspace ${ws} activated a plan on Mesaas.`,
    },
    reminder: {
      subject: (planName: string, daysLeft: number) =>
        `Your Mesaas${planName ? ` ${planName}` : ""} trial ends in ${daysLeft} days`,
      greetNamed: (name: string) => `Hi, ${name},`,
      greetAnon: "Hi,",
      leadPlan: (plan: string) => `Your free ${plan} plan trial in the workspace`,
      leadNoPlan: "Your free trial in the workspace",
      ends: (lead: string, ws: string, date: string) => `${lead} ${ws} ends on ${date}.`,
      chargeAmount: (amount: string) => `On that day we make the first charge of ${amount} to the card on file.`,
      chargeNoAmount: "On that day we make the first charge for the price of your plan to the card on file.",
      preheader: (date: string) => `Your first charge will be on ${date}.`,
      eyebrow: "Your free trial",
      keepGoing: "If you want to continue, you don't need to do anything.",
      button: "View my plan",
      cancelHtml: (billingLink: string) =>
        `If you prefer to cancel or switch plans, just go to Plan &amp; Billing before that date: ${billingLink}.`,
      freeNote: "On the Free plan you go back to 2 clients, only you on the account, and no approval portal or reports.",
      footer: (ws: string) => `You received this email because the workspace ${ws} is on a free trial at Mesaas.`,
    },
    reverse: {
      endedSubject: "Your workspace went back to the Free plan",
      hubPausingSubject: "Your clients' portal links pause tomorrow",
      endingSubject: (date: string) => `Your Pro trial ends on ${date}`,
      greetNamed: (name: string) => `Hi, ${name},`,
      greetAnon: "Hi,",
      footer: (ws: string) => `You received this email because you own the workspace ${ws} on Mesaas.`,
      perMonth: (money: string) => `${money} per month`,
      addCard: "Add card",
      endingPreheader: (date: string) => `Without a card, the workspace goes back to the Free plan on ${date}.`,
      endingEyebrow: "Your Pro trial",
      endingLead: (plan: string, ws: string, date: string) =>
        `The free ${plan} trial in the workspace ${ws} ends on ${date}.`,
      endingPrice: (plan: string, price: string) =>
        `To continue on ${plan}, add a card. Nothing is charged now: the first charge, of ${price}, never happens before the trial ends.`,
      endingNoPrice: (plan: string) =>
        `To continue on ${plan}, add a card. Nothing is charged now: the first charge never happens before the trial ends.`,
      endingSmall:
        "Without a card, the workspace goes back to the Free plan that day: up to 2 clients, only you on the account, no client portal and no reports. Nothing is deleted.",
      endedPreheader: "Nothing was deleted. Add a card to get Pro back.",
      endedEyebrow: "Free plan",
      endedLead: (plan: string, ws: string, date: string) =>
        `The free ${plan} trial in the workspace ${ws} ended on ${date}, and the workspace went back to the Free plan.`,
      endedBody:
        "Nothing was deleted: your clients, posts, deliverables and reports are still there. On Free, adding anything beyond the plan limits is blocked, and Finances and Contracts are read-only.",
      endedHubCallout: (date: string, plan: string) =>
        `Your clients' portal links pause on ${date}. If you get ${plan} back before then, they keep working.`,
      recover: (plan: string) => `Get ${plan} back`,
      endedSmall: (plan: string) => `To get ${plan} back, just add a card in Plan & Billing.`,
      hubPreheader: (date: string) => `From ${date}, the portal links stop opening.`,
      hubEyebrow: "Client portal",
      hubLead: (date: string, ws: string) =>
        `Tomorrow, ${date}, the portal links for the clients of the workspace ${ws} stop opening. Your clients will see a notice that the portal is paused.`,
      hubBody: (plan: string) =>
        `Nothing was deleted. As soon as you get ${plan} back, the same links work again, with no need to send new links.`,
    },
  },
});
