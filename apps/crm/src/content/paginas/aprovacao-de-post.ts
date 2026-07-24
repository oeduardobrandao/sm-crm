import type { MarketingPageContent } from '../paginas';

export const APROVACAO_DE_POST: MarketingPageContent = {
  slug: 'aprovacao-de-post',
  eyebrow: 'Aprovação de posts',
  h1: 'Sistema de aprovação de post: seu cliente aprova por link, sem login',
  sub: 'Chega de mandar arte por WhatsApp e caçar o "aprovado" na conversa. No Mesaas, o cliente recebe um link, revisa o post como ele vai ficar no Instagram, comenta e aprova — de qualquer aparelho.',
  sections: [
    {
      h2: 'Como funciona a aprovação de conteúdo no Mesaas',
      paragraphs: [
        'Cada cliente da sua agência tem um portal próprio, acessado por um link único — sem conta, sem senha, sem aplicativo. Lá ele vê os posts pendentes exatamente como vão ser publicados: imagem, carrossel, legenda e data.',
      ],
      bullets: [
        'O cliente aprova ou pede ajuste com um toque, direto do celular.',
        'Comentários ficam registrados no post — nada se perde em conversa de WhatsApp.',
        'Você acompanha o status de tudo no kanban de entregas: rascunho, revisão interna, aprovação do cliente, agendado, publicado.',
      ],
    },
    {
      h2: 'Aprovou? O post já sai agendado.',
      paragraphs: [
        'Aprovação e publicação vivem no mesmo fluxo. Quando o cliente aprova, o post segue para o agendamento e é publicado automaticamente no Instagram na data marcada — Feed, Reels ou Carrossel, via API oficial do Meta.',
        'Sem exportar, sem repostar em outra ferramenta, sem retrabalho.',
      ],
    },
    {
      h2: 'Por que sair do WhatsApp e da planilha',
      paragraphs: [
        'Aprovação espalhada em conversa gera versão errada publicada, prazo perdido e discussão sem histórico. Com um sistema de aprovação de post, cada material tem status, responsável, prazo e trilha de comentários — e o cliente ganha uma experiência profissional com a cara da sua agência.',
      ],
    },
  ],
  faq: [
    {
      q: 'Meu cliente precisa criar conta para aprovar?',
      a: 'Não. Ele acessa por um link único que você envia. Abre, revisa, comenta e aprova — sem login, sem senha e sem instalar nada.',
    },
    {
      q: 'O que acontece quando o cliente pede ajuste?',
      a: 'O post volta para a etapa de produção com o comentário do cliente registrado. Sua equipe ajusta e reenvia para aprovação no mesmo link.',
    },
    {
      q: 'Funciona no celular?',
      a: 'Sim. O portal de aprovação foi desenhado para o cliente usar no celular, e o CRM da agência também funciona em qualquer navegador.',
    },
    {
      q: 'A publicação após a aprovação é automática?',
      a: 'Sim. Post aprovado entra no calendário e é publicado automaticamente no Instagram na data e hora marcadas, via API oficial do Meta.',
    },
  ],
  cta: {
    title: 'Pare de aprovar post por WhatsApp',
    sub: 'Crie sua conta grátis e envie o primeiro link de aprovação em minutos.',
  },
};
