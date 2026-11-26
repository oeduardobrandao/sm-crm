/** Copy for the marketing landing page (`/`). Pure data module: no imports,
 * consumed by LandingPage.tsx (client render), Task 6's renderer, and the
 * prerender FAQ JSON-LD builder. Keep every string here byte-identical to
 * what actually ships — this is the single source of truth for the copy.
 *
 * Some `description`/`bullets` strings embed literal `<strong>…</strong>`
 * markup (e.g. "<strong>5 etapas prontas</strong>: ideia, ..."). That mirrors
 * the original inline JSX emphasis in these spots. LandingPage.tsx parses
 * that literal markup into real `<strong>` elements when rendering — it is
 * never used with dangerouslySetInnerHTML.
 */

export interface LandingFaqItem {
  q: string;
  a: string;
}

export interface LandingFeature {
  title: string;
  description: string;
  /** Extra detail. Rendered only when `showBullets` is true; the SEO mirror
   * follows the same flag so crawlers never see copy visitors do not. */
  bullets: string[];
  showBullets?: boolean;
}

export interface LandingHowStep {
  n: string;
  title: string;
  description: string;
}

export interface LandingMetricTile {
  label: string;
  value: string;
  delta: string;
}

export interface LandingPlanMarketing {
  description: string;
  cta: string;
  highlight?: boolean;
}

export interface LandingContent {
  hero: {
    titleBefore: string;
    titleEm: string;
    titleAfter: string;
    sub: string;
    note: string;
    /** The part of `note` the hero pill emphasises. Must be a prefix of `note`. */
    noteStrong: string;
    ctaStart: string;
    ctaSignedIn: string;
    ctaSecondary: string;
  };
  ticker: string[];
  featuresTitle: string;
  featuresSub: string;
  features: LandingFeature[];
  /** Eyebrow label per feature, positional against `features`. */
  featureEyebrows: string[];
  featuresMore: { button: string; note: string; ctaTitle: string };
  /** Mock dashboard tiles of the metrics card (illustrative numbers). */
  metricTiles: LandingMetricTile[];
  /** Mock DM exchange of the automations card. */
  dmVisual: { comment: string; commentTag: string; reply: string; button: string };
  shotAlts: { entregas: string; analytics: string; hub: string; calendario: string };
  /** Alt text of the hero device mockups. */
  heroAlts: { macbook: string; iphone: string };
  faqTitle: string;
  agente: { eyebrow: string; title: string; paragraphs: string[]; bullets: string[]; cta: string };
  how: { title: string; sub: string; steps: LandingHowStep[] };
  faq: LandingFaqItem[];
  finalCta: {
    signedInTitle: string;
    signedInBody: string;
    titleBefore: string;
    titleEm: string;
    body: string;
    signIn: string;
  };
  nav: { id: string; label: string }[];
  chrome: {
    skipLink: string;
    signIn: string;
    createAccount: string;
    createAccountShort: string;
    createAccountAria: string;
    openDashboard: string;
    toggleTheme: string;
    logoLabel: string;
  };
  footer: {
    tagline: string;
    productLabel: string;
    legalLabel: string;
    product: string[];
    legal: string[];
    /** Bottom line; `{year}` is replaced by the build year. */
    copyright: string;
    cookieSettings: string;
    /** CCPA opt-out entry; only markets that need it (en) carry it. */
    doNotSell?: string;
    /** Label of the link to the other language version. */
    otherLanguage: string;
    instagramLabel: string;
    linkedinLabel: string;
    youtubeLabel: string;
  };
  pricing: {
    title: string;
    /** Pinned promo sentence; the section paragraph is `${promo} ${body}`. */
    promo: string;
    body: string;
    promoNote: string;
    periodLabel: string;
    monthly: string;
    yearly: string;
    loading: string;
    loadError: string;
    retry: string;
    unavailable: string;
    popular: string;
    onRequest: string;
    perMonth: string;
    trialNote: string;
    unlimited: string;
    unlimitedSuffix: string;
    client: [string, string];
    user: [string, string];
    openDashboard: string;
    subscribeTemplate: string;
    discoverTemplate: string;
    billedAnnuallyTemplate: string;
    /** Brazil-only 12x installment copy; absent for markets without Pagar.me. */
    installments?: { noInterestTemplate: string; offTemplate: string };
    /** Shown when no paid plan has a price in the market's currency (en: USD not set yet). */
    comingSoon?: string;
  };
  planComparison: {
    title: string;
    sub: string;
    swipeHint: string;
    regionLabel: string;
    caption: string;
    featureColumn: string;
    capacityGroup: string;
    featuresGroup: string;
    included: string;
    notIncluded: string;
    choosePlan: string;
    capacityRows: Record<
      | 'max_instagram_accounts'
      | 'storage_quota_bytes'
      | 'max_workflow_templates'
      | 'max_hub_tokens'
      | 'rate_report_generations_per_month',
      string
    >;
    featureRows: Record<
      | 'feature_post_scheduling'
      | 'feature_tiktok'
      | 'feature_leads'
      | 'feature_financial'
      | 'feature_contracts'
      | 'feature_brand_customization'
      | 'feature_mcp'
      | 'feature_instagram_automation'
      | 'feature_briefing_audio',
      string
    >;
  };
  /** Marketing copy per plan id (free, start, pro, max). */
  planMarketing: Record<string, LandingPlanMarketing>;
}

export const LANDING: LandingContent = {
  hero: {
    titleBefore: 'Chega de gerenciar clientes de social media ',
    titleEm: 'em planilha e grupo de WhatsApp',
    titleAfter: '.',
    sub: 'O Mesaas reúne clientes, entregas, aprovações, agendamento no Instagram e no TikTok e métricas em um único lugar. Feito para quem gerencia social media, sozinho ou com equipe.',
    note: '14 dias de Pro grátis, sem cartão. No fim, você escolhe se continua.',
    noteStrong: '14 dias de Pro grátis, sem cartão.',
    ctaStart: 'Começar teste grátis',
    ctaSignedIn: 'Acessar painel',
    ctaSecondary: 'Ver como funciona',
  },
  ticker: [
    'Clientes + contratos',
    'Kanban de entregas',
    'Agendamento no Instagram',
    'Publicação no TikTok',
    'Portal do cliente',
    'Publicação automática',
    'Calendário editorial',
    'Métricas do Instagram',
    'Métricas do TikTok',
    'Financeiro',
    'Equipe + tarefas',
    'Aprovações por link',
    'Feed, Reels e Carrossel',
    'API oficial do Meta',
  ],
  featuresTitle: 'Tudo que você já faz hoje. Só que organizado.',
  featuresSub:
    'Cada módulo foi criado com quem vive de social media. Menos abas abertas, mais tempo para produzir.',
  featureEyebrows: [
    'Entregas',
    'Agendamento',
    'Métricas',
    'Portal do cliente',
    'Calendário',
    'Automações',
  ],
  featuresMore: {
    button: 'Ver todas as funcionalidades',
    note: 'Calendário editorial e resposta automática a comentários',
    ctaTitle: 'Teste tudo isso na sua agência.',
  },
  metricTiles: [
    { label: 'Seguidores', value: '45.798', delta: '+12%' },
    { label: 'Alcance (28d)', value: '96.826', delta: '+8%' },
    { label: 'Engajamento', value: '4,6%', delta: '+0,4 pp' },
    { label: 'Visualizações', value: '242.080', delta: '+19%' },
  ],
  dmVisual: {
    comment: 'quero',
    commentTag: '(comentário)',
    reply: 'Oi! Tá aqui o guia do cardápio de inverno. Baixe grátis e escolha o seu favorito.',
    button: 'Abrir link',
  },
  shotAlts: {
    entregas: 'Kanban de entregas do Mesaas com fluxos por etapa',
    analytics: 'Métricas do Instagram no Mesaas: seguidores, alcance e engajamento',
    hub: 'Portal do cliente do Mesaas com aprovações por link',
    calendario: 'Calendário editorial mensal do Mesaas',
  },
  heroAlts: {
    macbook:
      'MacBook com o quadro de entregas do Mesaas: fluxos por etapa, do briefing à aprovação do cliente',
    iphone: 'iPhone com o Hub do cliente: aprovações pendentes e próximo post',
  },
  faqTitle: 'Perguntas frequentes',
  features: [
    {
      title: 'Kanban de entregas que sua equipe entende no primeiro dia',
      description:
        'Arraste cada post da ideia até a publicação. Todos os clientes, formatos e prazos em um único fluxo visual.',
      bullets: [
        '<strong>5 etapas prontas</strong>: ideia, produção, aprovação, agendado, publicado',
        '<strong>Cliente, formato, prazo e status</strong> visíveis no card',
        '<strong>Post atrasado</strong> fica vermelho sozinho, sem você precisar conferir',
        'Filtre por cliente ou tipo de conteúdo com um clique',
      ],
    },
    {
      title: 'Agende e publique no Instagram e no TikTok sem sair do Mesaas.',
      showBullets: true,
      description:
        'Escolha dia e horário, escreva a legenda e pronto: o post vai ao ar no perfil do seu cliente pelas APIs oficiais do Meta e do TikTok. Um post só pode sair nas duas redes, sem app de terceiros e sem alarme no celular.',
      bullets: [
        'O post é <strong>publicado sozinho</strong> na data e hora marcadas',
        '<strong>Feed, Reels e Carrossel</strong> no Instagram e <strong>vídeos no TikTok</strong>, com a mídia validada antes de agendar',
        '<strong>Um post, duas redes</strong>: a legenda de cada rede no mesmo post, com uma aprovação só do cliente',
        'TikTok nos planos <strong>Pro e Max</strong>',
        'Botão de <strong>publicar agora</strong> para os urgentes',
      ],
    },
    {
      title: 'Métricas do Instagram e do TikTok prontas para o relatório do cliente.',
      description:
        'Seguidores, alcance, visualizações, engajamento e top posts atualizados todo dia nos planos pagos, direto das APIs oficiais. Dados confiáveis para provar o resultado do seu trabalho.',
      bullets: [
        'Dados das <strong>APIs oficiais do Meta e do TikTok</strong>, sem scraping',
        'Crescimento de seguidores, <strong>alcance e engajamento</strong> por período',
        'Top posts da semana em destaque',
        'Relatório em PDF com <strong>uma seção para cada rede</strong>, gerado em um clique',
      ],
    },
    {
      title: 'Seu cliente aprova por um link. Sem login, sem app.',
      description:
        'Seu cliente aprova posts, acompanha o calendário e fala com a equipe por um <strong>link único</strong>. O portal leva a marca dele, não a do Mesaas, e ele nunca precisa criar conta.',
      bullets: [
        'Acesso por link único, <strong>sem criar conta</strong>',
        'Aprova, pede ajuste ou comenta em cada post',
        'Calendário editorial e <strong>biblioteca de marca</strong> do cliente',
        'Aviso automático quando um post está esperando a decisão dele',
      ],
    },
    {
      title: 'Calendário editorial por cliente ou da operação inteira',
      description:
        'Veja o que foi planejado, agendado e publicado no mês. Alterne entre clientes ou enxergue toda a operação de uma vez e descubra semanas vazias antes que virem problema.',
      bullets: [
        'Visão <strong>mensal, semanal e por cliente</strong>',
        'Uma cor para cada formato: Feed, Reels, Story e Carrossel',
        'Arraste para <strong>reagendar</strong>',
        'Reagendou no calendário, a publicação automática acompanha',
      ],
    },
    {
      title: 'Comentou a palavra-chave, o link chega no direct. Sem ninguém precisar responder.',
      showBullets: true,
      description:
        'Crie um gatilho para um post ou para o perfil inteiro. O Mesaas responde o comentário em público e envia a DM com link ou cartão na mesma hora, a qualquer horário do dia. Disponível nos planos Pro e Max.',
      bullets: [
        'Gatilho por <strong>palavra-chave</strong> em Feed e Reels',
        'Respostas públicas <strong>variadas</strong>, para não soar automático',
        'DM com <strong>cartão, imagem e botão</strong> de link',
        'Tudo configurado no próprio post, dentro do Mesaas',
      ],
    },
  ],
  agente: {
    eyebrow: 'Agente de conteúdo',
    title: 'Um agente de conteúdo que escreve com a voz de cada cliente.',
    paragraphs: [
      'Conecte o Mesaas ao Claude ou ao ChatGPT e gere carrosséis, roteiros de Reels e legendas a partir do briefing, da identidade e dos posts que mais performaram de cada cliente. Sem sair do seu fluxo de trabalho.',
    ],
    bullets: [
      'Aprende o briefing e a identidade de cada marca',
      'Usa os posts que mais performaram como referência',
      'Funciona com Claude, ChatGPT ou via API',
    ],
    cta: 'Começar teste grátis',
  },
  how: {
    title: 'Três passos para organizar sua operação.',
    sub: 'Do zero ao primeiro post agendado em 5 minutos.',
    steps: [
      {
        n: '01',
        title: 'Cadastre sua agência',
        description:
          'Comece com 14 dias de Pro grátis, sem cartão, importe seus clientes por planilha e configure os modelos de contrato.',
      },
      {
        n: '02',
        title: 'Monte o fluxo de entregas',
        description:
          'Conecte o Instagram e o TikTok de cada cliente, distribua as tarefas para a equipe e defina os prazos no kanban.',
      },
      {
        n: '03',
        title: 'Envie o link do portal para o cliente',
        description:
          'Ele aprova posts, acompanha o calendário e vê as métricas por um único link, sem criar conta.',
      },
    ],
  },
  faq: [
    {
      q: 'O Mesaas tem plano gratuito?',
      a: 'Sim. O plano Free não tem custo e serve para conhecer a plataforma. Os limites e recursos de cada plano estão na tabela acima.',
    },
    {
      q: 'Preciso instalar alguma coisa?',
      a: 'Não. O Mesaas roda no navegador, no computador ou no celular. Não tem nada para baixar nem instalar.',
    },
    {
      q: 'Meu cliente precisa criar uma conta para usar o portal?',
      a: 'Não. Você envia um link único para o cliente. Ele abre, aprova e comenta, sem login e sem senha.',
    },
    {
      q: 'Como funciona a integração com o Instagram?',
      a: 'Você conecta a conta do cliente pela API oficial do Meta. A partir daí, o Mesaas puxa seguidores, alcance, engajamento e posts automaticamente, e você pode agendar publicações de Feed, Reels e Carrossel para sair direto no perfil no dia e horário escolhidos. Nada de scraping: métricas e publicações passam 100% pela API oficial.',
    },
    {
      q: 'O Mesaas publica no TikTok?',
      a: 'Sim, nos planos Pro e Max. Você conecta a conta do TikTok do cliente pela API oficial do TikTok e agenda vídeos para sair no perfil no dia e horário escolhidos. O mesmo post pode ir para o Instagram e para o TikTok, com a legenda de cada rede, e o cliente aprova uma vez só. As métricas dos vídeos (visualizações, curtidas, comentários e compartilhamentos) aparecem no Mesaas e entram nos relatórios.',
    },
    {
      q: 'Consigo importar meus clientes de uma planilha?',
      a: 'Sim. Dá para cadastrar um por um ou importar todos de uma vez por planilha. Em poucos minutos sua base inteira está no Mesaas.',
    },
    {
      q: 'Uso Notion, ClickUp ou Trello hoje. Consigo migrar meus dados?',
      a: 'Sim. O Mesaas importa direto o export do Notion, do Trello e do ClickUp, além de qualquer planilha em CSV. Você envia o arquivo, confere como as colunas foram mapeadas e confirma. Seus clientes e entregas entram no sistema sem precisar recadastrar nada. Se preferir, peça ao seu agente de IA (Claude ou ChatGPT) conectado ao Mesaas para fazer a migração por você.',
    },
    {
      q: 'Funciona para freelancer ou só para agência?',
      a: 'Para os dois. O Start atende freelancers que estão começando; o Max, agências com dezenas de clientes e equipe completa.',
    },
    {
      q: 'Posso cancelar quando quiser?',
      a: 'Sim, a qualquer momento, sem multa. Seus dados ficam disponíveis para exportar por 30 dias após o cancelamento.',
    },
  ],
  finalCta: {
    signedInTitle: 'Bem-vindo de volta!',
    signedInBody: 'Sua conta está ativa. Acesse o painel e continue de onde parou.',
    titleBefore: 'Pronto para sair ',
    titleEm: 'das planilhas?',
    body: 'Use o Pro por 14 dias, sem cartão, e organize seus clientes ainda hoje. No fim, você escolhe se continua.',
    signIn: 'Entrar',
  },
  nav: [
    { id: 'features', label: 'Funcionalidades' },
    { id: 'agente', label: 'Agente IA' },
    { id: 'how', label: 'Como funciona' },
    { id: 'pricing', label: 'Preços' },
    { id: 'faq', label: 'FAQ' },
  ],
  chrome: {
    skipLink: 'Pular para o conteúdo',
    signIn: 'Entrar',
    createAccount: 'Criar conta grátis',
    createAccountShort: 'Criar conta',
    createAccountAria: 'Criar conta grátis',
    openDashboard: 'Acessar painel',
    toggleTheme: 'Alternar tema',
    logoLabel: 'Mesaas',
  },
  footer: {
    tagline: 'Gestão para quem vive de social media. Feito no Brasil.',
    productLabel: 'Produto',
    legalLabel: 'Legal',
    product: [
      'Funcionalidades',
      'Como funciona',
      'Preços',
      'FAQ',
      'Aprovação de posts',
      'Portal do cliente',
      'Agente de conteúdo IA',
      'Sobre',
      'Novidades',
      'Blog',
    ],
    legal: ['Privacidade', 'Termos de uso', 'LGPD'],
    copyright:
      '© {year} Mesaas. Todos os direitos reservados. · CNPJ 63.758.902/0001-01 — EBS IT SOLUTIONS',
    cookieSettings: 'Preferências de cookies',
    otherLanguage: 'English',
    instagramLabel: 'Instagram do Mesaas',
    linkedinLabel: 'LinkedIn do Mesaas',
    youtubeLabel: 'YouTube do Mesaas',
  },
  pricing: {
    title: 'Comece pequeno e cresça sem trocar de ferramenta.',
    promo: 'Crie sua conta e use o Pro por 14 dias, sem cartão.',
    body: 'Se preferir escolher o plano agora, os planos pagos têm 30 dias grátis com cartão. Sem fidelidade, cancele quando quiser.',
    promoNote: '14 dias de Pro grátis, sem cartão. Sem cupom.',
    periodLabel: 'Período de cobrança',
    monthly: 'Mensal',
    yearly: 'Anual',
    loading: 'Carregando planos',
    loadError: 'Não foi possível carregar os planos agora.',
    retry: 'Tentar novamente',
    unavailable: 'Os planos estão temporariamente indisponíveis.',
    popular: 'Mais popular',
    onRequest: 'Sob consulta',
    perMonth: '/mês',
    trialNote: '30 dias grátis com cartão',
    unlimited: 'Ilimitado',
    unlimitedSuffix: 'ilimitados',
    client: ['cliente', 'clientes'],
    user: ['usuário', 'usuários'],
    openDashboard: 'Acessar painel',
    subscribeTemplate: 'Assinar {plan}',
    discoverTemplate: 'Conheça o plano {plan}.',
    billedAnnuallyTemplate: 'cobrado anualmente ({total}/ano)',
    installments: {
      noInterestTemplate: '12x no cartão, sem juros · ou {total} à vista',
      offTemplate: ' ({pct}% off)',
    },
  },
  planComparison: {
    title: 'Compare os planos',
    sub: 'Veja o que cada plano inclui.',
    swipeHint: 'Deslize para comparar →',
    regionLabel: 'Tabela comparativa de planos',
    caption: 'Comparação detalhada dos planos',
    featureColumn: 'Recurso',
    capacityGroup: 'Capacidade',
    featuresGroup: 'Recursos',
    included: 'Incluído',
    notIncluded: 'Não incluído',
    choosePlan: 'Escolha seu plano',
    capacityRows: {
      max_instagram_accounts: 'Contas do Instagram',
      storage_quota_bytes: 'Armazenamento',
      max_workflow_templates: 'Templates de fluxo',
      max_hub_tokens: 'Portais do cliente',
      rate_report_generations_per_month: 'Relatórios por mês',
    },
    featureRows: {
      feature_post_scheduling: 'Agendamento de posts',
      feature_tiktok: 'TikTok',
      feature_leads: 'Leads',
      feature_financial: 'Financeiro',
      feature_contracts: 'Contratos',
      feature_brand_customization: 'Personalização de marca',
      feature_mcp: 'Integração com agentes (MCP)',
      feature_instagram_automation: 'Automações',
      feature_briefing_audio: 'Briefing por áudio',
    },
  },
  planMarketing: {
    free: { description: 'Para conhecer a plataforma.', cta: 'Usar o Free' },
    start: { description: 'Para freelancers montando a carteira.', cta: 'Começar teste grátis' },
    pro: {
      description: 'Para freelancers com a carteira cheia.',
      cta: 'Começar teste grátis',
      highlight: true,
    },
    max: { description: 'Para agências com equipe.', cta: 'Começar teste grátis' },
  },
};
