import type { MarketingPageContent } from '../paginas';

export const AGENTE_DE_CONTEUDO_IA: MarketingPageContent = {
  slug: 'agente-de-conteudo-ia',
  eyebrow: 'Agente de conteúdo IA',
  h1: 'Um agente de IA que trabalha dentro do fluxo da sua agência',
  sub: 'Não é mais um chat para copiar e colar. O Mesaas se conecta ao Claude via MCP: o agente lê o briefing e a estratégia de cada cliente, escreve com a voz dele e entrega o post pronto no seu fluxo de aprovação.',
  sections: [
    {
      h2: 'O que o agente de conteúdo faz',
      paragraphs: [
        'Conectado ao seu workspace, o agente tem acesso ao contexto real de cada cliente — briefing, estratégia de conteúdo, marca e posts que mais performaram. Com isso ele produz conteúdo específico, não texto genérico de IA.',
      ],
      bullets: [
        'Cria pautas e transforma pauta em post: legenda, roteiro de Reels ou carrossel.',
        'Escreve com a voz de cada cliente, aprendendo com o histórico do que performou.',
        'Envia e anexa as imagens do post pelo próprio agente — mídia definida sem sair do fluxo.',
        'Cria o rascunho já dentro do Mesaas — pronto para revisão e aprovação do cliente.',
      ],
    },
    {
      h2: 'Integração oficial com o Claude via MCP',
      paragraphs: [
        'O Mesaas expõe um conector MCP (Model Context Protocol) — o padrão aberto para conectar assistentes de IA a ferramentas de trabalho. Você conecta o Claude ao seu workspace em minutos e conversa com seus dados: "crie a pauta da semana com base na estratégia do cliente".',
        'O acesso respeita seu workspace e suas permissões, com chaves que você controla e pode revogar.',
      ],
    },
    {
      h2: 'IA dentro do fluxo, não fora dele',
      paragraphs: [
        'A diferença entre usar um chat de IA e ter um agente de conteúdo é o fluxo. Aqui o resultado não morre numa conversa: vira rascunho no kanban, passa pela sua revisão, vai para aprovação do cliente e sai publicado no Instagram — com o mesmo controle de sempre.',
      ],
    },
  ],
  faq: [
    {
      q: 'Preciso saber programar para usar o agente?',
      a: 'Não. A conexão com o Claude é guiada dentro do Mesaas, em poucos cliques. Depois é conversar em português com o agente.',
    },
    {
      q: 'A IA publica sozinha sem revisão?',
      a: 'Não. O agente cria rascunhos dentro do seu fluxo. Publicação só acontece depois da sua revisão e da aprovação do cliente, como em qualquer post.',
    },
    {
      q: 'O agente aprende a voz de cada cliente?',
      a: 'Sim. Ele usa o briefing, a estratégia de conteúdo e os posts de melhor desempenho de cada cliente como referência de tom e formato.',
    },
    {
      q: 'O que é MCP?',
      a: 'Model Context Protocol é o padrão aberto que conecta assistentes de IA, como o Claude, a ferramentas de trabalho. O Mesaas oferece um conector MCP nativo — seus dados ficam no seu workspace, sob suas permissões.',
    },
  ],
  cta: {
    title: 'Coloque um agente de conteúdo no seu time',
    sub: 'Crie sua conta grátis e conecte o Claude ao seu workspace.',
  },
};
