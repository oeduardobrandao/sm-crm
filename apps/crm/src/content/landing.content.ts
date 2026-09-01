/** Copy for the marketing landing page (`/`). Pure data module: no imports,
 * consumed by LandingPage.tsx (client render), Task 6's renderer, and the
 * prerender FAQ JSON-LD builder. Keep every string here byte-identical to
 * what actually ships — this is the single source of truth for the copy.
 *
 * Some `description`/`bullets` strings embed literal `<strong>…</strong>`
 * markup (e.g. "<strong>5 etapas padrão</strong> — ideia, ..."). That mirrors
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
  bullets: string[];
}

export interface LandingHowStep {
  n: string;
  title: string;
  description: string;
}

export const LANDING: {
  hero: { titleBefore: string; titleEm: string; titleAfter: string; sub: string; note: string };
  ticker: string[];
  featuresTitle: string;
  featuresSub: string;
  features: LandingFeature[];
  agente: { title: string; paragraphs: string[]; bullets: string[] };
  how: { title: string; steps: LandingHowStep[] };
  faq: LandingFaqItem[];
} = {
  hero: {
    titleBefore: 'Sua agência de social media ',
    titleEm: 'sem caos',
    titleAfter: ', sem planilha, sem grupo de WhatsApp.',
    sub: 'Mesaas é o CRM feito para gestores e agências de social media. Clientes, entregas, aprovações, agendamento automático no Instagram e métricas — em um só lugar.',
    note: '30 dias grátis em qualquer plano. Sem cartão de crédito.',
  },
  ticker: [
    'Clientes + contratos',
    'Kanban de entregas',
    'Agendamento no Instagram',
    'Portal do cliente',
    'Publicação automática',
    'Calendário editorial',
    'Métricas reais',
    'Financeiro',
    'Equipe + tarefas',
    'Aprovações por link',
    'Feed, Reels e Carrossel',
    'Integração Meta API',
  ],
  featuresTitle: 'Tudo que sua agência já faz — só que organizado.',
  featuresSub:
    'Cada módulo foi desenhado com quem passa o dia gerenciando social media. Menos abas abertas, mais entrega.',
  features: [
    {
      title: 'Kanban de entregas que sua equipe entende no primeiro dia',
      description:
        'Arraste cada post pelas etapas — da ideia à publicação. Cada cliente, cada tipo de conteúdo, cada prazo em um só fluxo visual.',
      bullets: [
        '<strong>5 etapas padrão</strong> — ideia, produção, aprovação, agendado, publicado',
        'Cards mostram <strong>cliente, tipo, prazo e status</strong> em um olhar',
        '<strong>Cards atrasados</strong> ficam destacados em vermelho automaticamente',
        'Filtre por cliente ou tipo de conteúdo com um clique',
      ],
    },
    {
      title: 'Agende e publique no Instagram — sem sair do Mesaas.',
      description:
        'Escolha o dia e horário, escreva a legenda e pronto: o Mesaas publica automaticamente no perfil do seu cliente via API oficial do Meta. Feed, Reels e Carrossel — sem aplicativos externos, sem alarmes no celular.',
      bullets: [
        '<strong>Publicação automática</strong> — o post vai ao ar sozinho no dia e hora marcados',
        'Suporta <strong>Feed, Reels e Carrossel</strong> com validação de mídia',
        'Opção de <strong>publicar agora</strong> para posts urgentes',
      ],
    },
    {
      title: 'Métricas reais do Instagram — prontas para o relatório.',
      description:
        'Seguidores, alcance, engajamento e top posts atualizados todo dia. Conecte a conta via API oficial e tenha dados confiáveis para mostrar o valor do seu trabalho ao cliente.',
      bullets: [
        '<strong>API oficial do Meta</strong> — dados confiáveis, sem scraping',
        'Crescimento de seguidores, <strong>alcance e engajamento</strong> por período',
        'Top posts da semana destacados automaticamente',
        'Relatório em PDF para enviar ao cliente em um clique',
      ],
    },
    {
      title: 'Portal do cliente que o cliente realmente usa',
      description:
        'Seu cliente aprova posts, vê o calendário e conversa com a equipe por um link único — <strong>sem login, sem app, sem fricção</strong>. Design editorial pensado para a marca dele, não para a sua CRM.',
      bullets: [
        'Link único <strong>sem necessidade de conta</strong> para o cliente',
        'Aprovar, pedir ajustes ou comentar em cada post',
        'Calendário editorial e biblioteca de <strong>identidade de marca</strong>',
        'Notificação automática quando algo precisa de decisão',
      ],
    },
    {
      title: 'Calendário editorial por cliente ou unificado',
      description:
        'Veja tudo que foi planejado, agendado e publicado em um mês. Troque entre clientes ou visualize toda a operação de uma vez para identificar semanas vazias antes que virem problema.',
      bullets: [
        'Visão <strong>mensal, semanal e por cliente</strong>',
        'Cores por tipo de conteúdo: Feed, Reels, Story, Carrossel',
        'Arraste para <strong>reagendar</strong> em segundos',
        'Integração direta com o agendamento automático',
      ],
    },
    {
      title: 'Comentou a palavra-chave, recebeu no direct. Sozinho.',
      description:
        'Defina um gatilho por post ou para o perfil inteiro. O Mesaas responde o comentário em público e manda a DM com link ou cartão, na hora, 24 por 7. Disponível nos planos Pro e Max.',
      bullets: [
        'Gatilho por <strong>palavra-chave</strong> em Feed e Reels',
        'Respostas públicas com <strong>variações</strong>, sem parecer robô',
        'DM com <strong>cartão, imagem e botão</strong> de link',
        'Configurado direto no post, dentro do Mesaas',
      ],
    },
  ],
  agente: {
    title: 'Um agente de conteúdo que escreve com a voz de cada cliente.',
    paragraphs: [
      'Conecte seu Mesaas ao Claude e gere carrosséis, roteiros de Reels e legendas sob medida — a partir do briefing, da marca e dos posts que mais performaram. Sem sair do seu fluxo.',
    ],
    bullets: [
      'Aprende o briefing e a identidade de cada marca',
      'Usa o que já performou como referência',
      'Conecta com claude.ai, Claude Desktop ou API',
    ],
  },
  how: {
    title: 'Três passos entre você e uma operação organizada.',
    steps: [
      {
        n: '01',
        title: 'Cadastre sua agência',
        description:
          'Crie sua conta grátis, importe seus clientes e configure templates de contrato. Simples como digitar um e-mail.',
      },
      {
        n: '02',
        title: 'Monte o fluxo de entregas',
        description:
          'Arraste os posts pelo kanban. Atribua à equipe, defina prazos, conecte o Instagram de cada cliente.',
      },
      {
        n: '03',
        title: 'Compartilhe o link do Hub',
        description:
          'Seu cliente aprova posts, acompanha o calendário e vê métricas — tudo por um link único, sem precisar criar conta.',
      },
    ],
  },
  faq: [
    {
      q: 'O Mesaas tem plano gratuito?',
      a: 'Sim. O plano Free permite começar sem custo. Para ver os limites, recursos e condições atuais de cada opção, compare os planos exibidos acima e escolha o que melhor atende à sua operação.',
    },
    {
      q: 'Preciso instalar alguma coisa?',
      a: 'Não. O Mesaas é 100% web e funciona em qualquer navegador moderno, no computador ou no celular. Nada para baixar, nada para configurar.',
    },
    {
      q: 'Meu cliente precisa criar uma conta para usar o Hub?',
      a: 'Não. O portal de aprovação é acessado por um link único que você envia ao cliente. Ele abre, aprova, comenta — sem login, sem senha, sem app.',
    },
    {
      q: 'Como funciona a integração com o Instagram?',
      a: 'Você conecta a conta do seu cliente via API oficial do Meta. A partir daí, o Mesaas puxa métricas de seguidores, alcance, engajamento e posts automaticamente. Além disso, você pode agendar posts para publicação automática — escolha o dia e horário, e o sistema publica direto no perfil. Suporta Feed, Reels e Carrossel. Nada de scraping — dados e publicações 100% via API oficial.',
    },
    {
      q: 'Consigo importar meus clientes de uma planilha?',
      a: 'Sim. Você pode cadastrar cliente por cliente em segundos, ou importar via planilha. Em minutos sua base inteira está dentro do sistema.',
    },
    {
      q: 'Funciona para freelancer ou só para agência?',
      a: 'Para os dois. O plano Start atende freelancers começando, e o Max suporta agências com dezenas de clientes e uma equipe inteira.',
    },
    {
      q: 'Posso cancelar quando quiser?',
      a: 'Sim, a qualquer momento. Sem multa, sem burocracia. Seus dados continuam exportáveis por mais 30 dias após o cancelamento.',
    },
  ],
};
