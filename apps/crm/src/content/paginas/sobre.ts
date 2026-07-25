import type { MarketingPageContent } from '../paginas';

export const SOBRE: MarketingPageContent = {
  slug: 'sobre',
  eyebrow: 'Sobre',
  h1: 'O CRM que nasceu dentro de uma agência de social media',
  sub: 'O Mesaas existe para acabar com a operação espalhada em planilhas, Drive e grupos de WhatsApp — o problema que vivemos na prática antes de escrever a primeira linha de código.',
  sections: [
    {
      h2: 'O que é o Mesaas',
      paragraphs: [
        'O Mesaas é uma plataforma brasileira de gestão para agências e gestores de social media. Em um único lugar: cadastro de clientes e contratos, kanban de entregas, calendário editorial, aprovação de posts pelo cliente, agendamento e publicação automática no Instagram, relatórios de métricas e financeiro.',
        'O produto é 100% web, em português, e atende de freelancers a micro-agências com equipes completas.',
      ],
    },
    {
      h2: 'No que acreditamos',
      paragraphs: [
        'Ferramenta de trabalho boa é a que desaparece na tarefa. O caos da operação para aqui: a interface é calma, os fluxos são diretos e o cliente final aprova conteúdo sem precisar criar conta ou baixar aplicativo.',
      ],
      bullets: [
        'Transparência com o cliente da agência: tudo que ele precisa ver está no portal dele.',
        'Automação de verdade: aprovou, agendou, publicou — sem retrabalho.',
        'Dados via API oficial do Meta, nunca scraping.',
      ],
    },
    {
      h2: 'Fale com a gente',
      paragraphs: [
        'Suporte e dúvidas: contato@mesaas.com.br — ou pelo chat dentro da plataforma. Assuntos de privacidade e dados: privacidade@mesaas.com.br. Para acompanhar a evolução do produto, veja a página de novidades, atualizada toda semana.',
      ],
    },
  ],
  faq: [],
  cta: {
    title: 'Conheça o Mesaas por dentro',
    sub: 'Crie uma conta grátis e veja em minutos como sua operação fica organizada.',
  },
};
