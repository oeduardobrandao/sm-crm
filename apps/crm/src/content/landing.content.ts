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
    titleBefore: 'Chega de gerenciar clientes de social media em planilha e grupo de WhatsApp.',
    titleEm: '',
    titleAfter: '',
    sub: 'O Mesaas reúne clientes, entregas, aprovações, agendamento no Instagram e métricas em um único lugar. Feito para quem gerencia social media, sozinho ou com equipe.',
    note: '30 dias grátis, sem cartão de crédito.',
  },
  ticker: [
    'Clientes + contratos',
    'Kanban de entregas',
    'Agendamento no Instagram',
    'Portal do cliente',
    'Publicação automática',
    'Calendário editorial',
    'Métricas do Instagram',
    'Financeiro',
    'Equipe + tarefas',
    'Aprovações por link',
    'Feed, Reels e Carrossel',
    'API oficial do Meta',
  ],
  featuresTitle: 'Tudo que você já faz hoje. Só que organizado.',
  featuresSub:
    'Cada módulo foi criado com quem vive de social media. Menos abas abertas, mais tempo para produzir.',
  features: [
    {
      title: 'Kanban de entregas que sua equipe entende no primeiro dia',
      description:
        'Arraste cada post da ideia até a publicação. Todos os clientes, formatos e prazos em um único fluxo visual.',
      bullets: [
        '5 etapas prontas: ideia, produção, aprovação, agendado, publicado',
        'Cliente, formato, prazo e status visíveis no card',
        'Post atrasado fica vermelho sozinho, sem você precisar conferir',
        'Filtre por cliente ou tipo de conteúdo com um clique',
      ],
    },
    {
      title: 'Agende e publique no Instagram sem sair do Mesaas.',
      description:
        'Escolha dia e horário, escreva a legenda e pronto: o post vai ao ar no perfil do seu cliente pela API oficial do Meta. Feed, Reels e Carrossel, sem app de terceiros e sem alarme no celular.',
      bullets: [
        'O post é publicado sozinho na data e hora marcadas',
        'Feed, Reels e Carrossel, com a mídia validada antes de agendar',
        'Botão de publicar agora para os urgentes',
      ],
    },
    {
      title: 'Métricas do Instagram prontas para o relatório do cliente.',
      description:
        'Seguidores, alcance, engajamento e top posts atualizados todo dia, direto da API oficial. Dados confiáveis para provar o resultado do seu trabalho.',
      bullets: [
        'Dados da API oficial do Meta, sem scraping',
        'Crescimento de seguidores, <strong>alcance e engajamento</strong> por período',
        'Top posts da semana em destaque',
        'Relatório em PDF gerado em um clique',
      ],
    },
    {
      title: 'Seu cliente aprova por um link. Sem login, sem app.',
      description:
        'Seu cliente aprova posts, acompanha o calendário e fala com a equipe por um link único. O portal leva a marca dele, não a do Mesaas, e ele nunca precisa criar conta.',
      bullets: [
        'Acesso por link único, sem criar conta',
        'Aprova, pede ajuste ou comenta em cada post',
        'Calendário editorial e biblioteca de marca do cliente',
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
        'Arraste para reagendar',
        'Reagendou no calendário, a publicação automática acompanha',
      ],
    },
    {
      title: 'Comentou a palavra-chave, o link chega no direct. Sem ninguém precisar responder.',
      description:
        'Crie um gatilho para um post ou para o perfil inteiro. O Mesaas responde o comentário em público e envia a DM com link ou cartão na mesma hora, a qualquer horário do dia. Disponível nos planos Pro e Max.',
      bullets: [
        'Gatilho por <strong>palavra-chave</strong> em Feed e Reels',
        'Respostas públicas variadas, para não soar automático',
        'DM com <strong>cartão, imagem e botão</strong> de link',
        'Tudo configurado no próprio post, dentro do Mesaas',
      ],
    },
  ],
  agente: {
    title: 'Um agente de conteúdo que escreve com a voz de cada cliente.',
    paragraphs: [
      'Conecte o Mesaas ao Claude e gere carrosséis, roteiros de Reels e legendas a partir do briefing, da identidade e dos posts que mais performaram de cada cliente. Sem sair do seu fluxo de trabalho.',
    ],
    bullets: [
      'Aprende o briefing e a identidade de cada marca',
      'Usa os posts que mais performaram como referência',
      'Funciona com claude.ai, Claude Desktop ou via API',
    ],
  },
  how: {
    title: 'Três passos para organizar sua operação.',
    steps: [
      {
        n: '01',
        title: 'Cadastre sua agência',
        description:
          'Crie sua conta grátis, importe seus clientes por planilha e configure os modelos de contrato.',
      },
      {
        n: '02',
        title: 'Monte o fluxo de entregas',
        description:
          'Conecte o Instagram de cada cliente, distribua as tarefas para a equipe e defina os prazos no kanban.',
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
      q: 'Consigo importar meus clientes de uma planilha?',
      a: 'Sim. Dá para cadastrar um por um ou importar todos de uma vez por planilha. Em poucos minutos sua base inteira está no Mesaas.',
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
};
