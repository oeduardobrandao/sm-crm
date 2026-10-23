/** Features a blog post may pitch in its closing "No Mesaas" block. The copy
 * lives here, not in the Routine's draft, so the pitch always matches the
 * product page it links to. Pure data: shared by the CRM (rendering) and the
 * Admin (picker), and mirrored by `supabase/functions/_shared/blog-rules.ts`. */

export const BLOG_FEATURE_SLUGS = [
  'aprovacao-de-post',
  'portal-do-cliente',
  'agente-de-conteudo-ia',
] as const;

export type FeatureSlug = (typeof BLOG_FEATURE_SLUGS)[number];

export interface BlogFeature {
  titulo: string;
  frase: string;
  href: string;
}

export const BLOG_FEATURES: Record<FeatureSlug, BlogFeature> = {
  'aprovacao-de-post': {
    titulo: 'Seu cliente aprova o post por link, sem login',
    frase:
      'Ele revisa o post como vai ficar no Instagram, comenta e aprova de qualquer aparelho. Nada de caçar o "aprovado" no WhatsApp.',
    href: '/aprovacao-de-post',
  },
  'portal-do-cliente': {
    titulo: 'Um portal com a marca da sua agência para cada cliente',
    frase:
      'O cliente aprova posts, vê o calendário, responde o briefing e envia ideias, tudo por um link e sem senha.',
    href: '/portal-do-cliente',
  },
  'agente-de-conteudo-ia': {
    titulo: 'Um agente de IA que trabalha dentro do fluxo da sua agência',
    frase:
      'Conectado ao Claude via MCP, ele lê o briefing e a estratégia de cada cliente, escreve com a voz dele e entrega o post pronto para aprovação.',
    href: '/agente-de-conteudo-ia',
  },
};
