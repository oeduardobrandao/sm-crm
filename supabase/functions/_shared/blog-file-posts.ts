// The hand-written blog posts that live as files in apps/crm/src/content/blog/
// (not in blog_posts). The MCP tools hand this list to the Routine so new
// drafts don't repeat a slug or a topic already covered. Kept in sync by
// apps/crm/src/content/__tests__/blog-rules-parity.test.ts, which reads this
// literal as text: keep it JSON-like.
export const BLOG_FILE_POSTS: ReadonlyArray<{ slug: string; title: string }> = [
  {
    slug: "alternativa-ao-doo-studio",
    title: "Alternativa ao Doo Studio para agências brasileiras",
  },
  {
    slug: "como-organizar-aprovacao-de-posts",
    title: "Como organizar a aprovação de posts com o seu cliente",
  },
  {
    slug: "mesaas-vs-aprova-post",
    title: "Mesaas ou Aprova Post: qual usar na sua agência em 2026",
  },
  {
    slug: "mesaas-vs-mlabs",
    title: "Mesaas ou mLabs: comparativo para agências em 2026",
  },
  {
    slug: "modelo-de-briefing-para-social-media",
    title: "Modelo de briefing para social media (com checklist)",
  },
  {
    slug: "quanto-cobrar-para-gerenciar-redes-sociais",
    title: "Quanto cobrar para gerenciar redes sociais em 2026",
  },
];
