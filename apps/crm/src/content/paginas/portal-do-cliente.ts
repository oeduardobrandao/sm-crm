import type { MarketingPageContent } from '../paginas';

export const PORTAL_DO_CLIENTE: MarketingPageContent = {
  slug: 'portal-do-cliente',
  eyebrow: 'Portal do cliente',
  h1: 'Portal do cliente para agências de social media',
  sub: 'Um hub com a marca da sua agência onde cada cliente acompanha o próprio conteúdo: aprova posts, vê o calendário, responde briefing e envia ideias — tudo por um link, sem senha.',
  sections: [
    {
      h2: 'O que o seu cliente encontra no portal',
      paragraphs: [
        'O portal reúne tudo que o cliente precisa ver — e nada do que ele não precisa. Cada seção foi desenhada para quem não é do marketing: direto, visual e no celular.',
      ],
      bullets: [
        'Aprovações: posts pendentes com preview real de feed, carrossel e Reels.',
        'Postagens: o calendário do que está agendado e do que já foi publicado.',
        'Briefing: as respostas do cliente organizadas, reutilizáveis pela equipe.',
        'Marca: cores, logos e materiais de referência num lugar só.',
        'Ideias: o cliente sugere pautas e a agência transforma em conteúdo.',
      ],
    },
    {
      h2: 'Com a cara da sua agência',
      paragraphs: [
        'O portal usa a cor e a identidade da sua marca — a experiência é da sua agência, não de uma ferramenta terceira. Profissionalize a relação com o cliente sem construir nada do zero.',
      ],
    },
    {
      h2: 'Acesso por link, sem fricção',
      paragraphs: [
        'Cada cliente recebe um link exclusivo e seguro. Nada de criar conta, recuperar senha ou instalar aplicativo — a barreira de adoção que faz portais de cliente fracassarem simplesmente não existe.',
      ],
    },
  ],
  faq: [
    {
      q: 'O portal do cliente é cobrado à parte?',
      a: 'Não. O portal faz parte dos planos do Mesaas — veja na página de preços qual plano libera o recurso para a sua operação.',
    },
    {
      q: 'Posso usar a identidade visual da minha agência?',
      a: 'Sim. O portal aplica a cor da sua marca e sua identidade, para o cliente viver uma experiência da sua agência.',
    },
    {
      q: 'O link do portal é seguro?',
      a: 'Sim. Cada cliente tem um token único e você pode revogar o acesso a qualquer momento pelo CRM.',
    },
    {
      q: 'O cliente vê os outros clientes da agência?',
      a: 'Nunca. Cada portal é isolado: o cliente vê apenas o próprio conteúdo, calendário e materiais.',
    },
  ],
  cta: {
    title: 'Dê um portal profissional para cada cliente',
    sub: 'Crie sua conta grátis e gere o primeiro link de portal em minutos.',
  },
};
