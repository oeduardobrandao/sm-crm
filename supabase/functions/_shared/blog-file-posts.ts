// The hand-written blog posts that live as files in apps/crm/src/content/blog/
// (not in blog_posts). The MCP tools hand slug and title to the Routine so new
// drafts don't repeat a slug or a topic already covered; the blog metrics
// (view counter, Search Console sync) use slug and date to know what is live.
// Kept in sync by apps/crm/src/content/__tests__/blog-rules-parity.test.ts,
// which reads this literal as text: keep it JSON-like.
export const BLOG_FILE_POSTS: ReadonlyArray<{
  slug: string;
  title: string;
  description: string;
  category: string;
  date: string;
}> = [
  {
    slug: "alternativa-ao-doo-studio",
    title: "Alternativa ao Doo Studio para agências brasileiras",
    description: "O que avaliar antes de trocar o Doo Studio: aprovação do cliente sem login, agendamento no Instagram, portal com sua marca e gestão financeira.",
    category: "comparativo",
    date: "2026-07-27",
  },
  {
    slug: "como-organizar-aprovacao-de-posts",
    title: "Como organizar a aprovação de posts com o seu cliente",
    description: "Um fluxo de aprovação de posts que acaba com o vai e volta no WhatsApp: quem aprova, em quantas rodadas, com prazo e histórico registrado.",
    category: "guia",
    date: "2026-07-27",
  },
  {
    slug: "mesaas-vs-aprova-post",
    title: "Mesaas ou Aprova Post: qual usar na sua agência em 2026",
    description: "Comparamos Mesaas e Aprova Post na aprovação de posts com o cliente: link sem login, fluxo de revisão, agendamento no Instagram e gestão da agência.",
    category: "comparativo",
    date: "2026-07-25",
  },
  {
    slug: "mesaas-vs-mlabs",
    title: "Mesaas ou mLabs: comparativo para agências em 2026",
    description: "mLabs ou Mesaas? Veja a diferença entre uma ferramenta de agendamento e um CRM de agência com aprovação do cliente, entregas e financeiro.",
    category: "comparativo",
    date: "2026-07-27",
  },
  {
    slug: "modelo-de-briefing-para-social-media",
    title: "Modelo de briefing para social media (com checklist)",
    description: "Modelo de briefing para social media pronto para usar: as perguntas que evitam retrabalho, o que perguntar na reunião e como manter tudo atualizado.",
    category: "guia",
    date: "2026-07-27",
  },
  {
    slug: "quanto-cobrar-para-gerenciar-redes-sociais",
    title: "Quanto cobrar para gerenciar redes sociais em 2026",
    description: "Como calcular quanto cobrar para gerenciar redes sociais: custo por hora, escopo, número de posts e reajuste. Com exemplos e erros que corroem a margem.",
    category: "guia",
    date: "2026-07-27",
  },
];
