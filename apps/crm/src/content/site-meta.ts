/** Single source of truth for public-route SEO metadata. Consumed by the
 * usePageMeta hook (client), the prerender script (build), the sitemap and
 * llms.txt builders. Update `lastmod` whenever a page's content changes. */

export const SITE_URL = 'https://www.mesaas.com.br';
export const SITE_NAME = 'Mesaas';
export const DEFAULT_OG_IMAGE = `${SITE_URL}/og-image.png`;

/** Real brand profiles for the Organization sameAs. Add new networks here
 * (LinkedIn etc.) as they are created. */
export const SOCIAL_PROFILES: string[] = ['https://www.instagram.com/mesaas.com.br/'];

/** Top-level SPA-only route prefixes served by app.html (noindex). Adding a
 * new top-level route in App.tsx? Add its prefix here AND to the app-shell
 * rewrite + X-Robots-Tag header in vercel.json — the guard test in
 * vercel-routing.test.ts enforces the rewrite half. Longer prefixes that
 * share a stem (analytics-fluxos vs analytics) must come first. */
export const APP_ROUTE_PREFIXES = [
  'login',
  'configurar-senha',
  'workspace-setup',
  'oauth',
  'dashboard',
  'clientes',
  'financeiro',
  'contratos',
  'leads',
  'equipe',
  'configuracao',
  'calendario',
  'entregas',
  'tarefas',
  'post-express',
  'arquivos',
  'analytics-fluxos',
  'analytics',
  'ideias',
  'ajuda',
  'importar',
] as const;

export interface RouteMeta {
  /** Route path, e.g. '/precos'. */
  path: string;
  /** Prerender output filename under dist/. */
  file?: string;
  /** 50–60 chars (audit SERP range). */
  title: string;
  /** 120–160 chars (audit SERP range). */
  description: string;
  /** YYYY-MM-DD, bumped when the page content changes. */
  lastmod: string;
  ogImage?: string;
  /** Open Graph object type. Defaults to 'website'; blog posts use 'article'. */
  ogType?: 'article';
}

export const PUBLIC_ROUTES: RouteMeta[] = [
  {
    path: '/',
    file: 'index.html',
    title: 'Mesaas — CRM para agências e gestores de social media',
    description:
      'CRM para social media: clientes, aprovação de posts por link, agendamento automático no Instagram, relatórios e financeiro em um só lugar. Comece grátis.',
    lastmod: '2026-07-24',
  },
  {
    path: '/precos',
    file: 'precos.html',
    title: 'Preços do Mesaas — planos para agências de social media',
    description:
      'Compare os planos Free, Start, Pro e Max do Mesaas. Comece grátis, sem cartão de crédito, e evolua conforme sua agência cresce. Cancele quando quiser.',
    lastmod: '2026-07-24',
  },
  {
    path: '/aprovacao-de-post',
    file: 'aprovacao-de-post.html',
    title: 'Aprovação de post por link, sem login do cliente | Mesaas',
    description:
      'Sistema de aprovação de posts para agências: o cliente recebe um link, revisa, comenta e aprova sem criar conta. Aprovou, o post já sai agendado no Instagram.',
    lastmod: '2026-07-24',
  },
  {
    path: '/portal-do-cliente',
    file: 'portal-do-cliente.html',
    title: 'Portal do cliente para agências de social media | Mesaas',
    description:
      'Um hub com a marca da sua agência onde o cliente aprova posts, acompanha o calendário, responde briefing e envia ideias — por link, sem senha e sem app.',
    lastmod: '2026-07-24',
  },
  {
    path: '/agente-de-conteudo-ia',
    file: 'agente-de-conteudo-ia.html',
    title: 'Agente de conteúdo com IA no fluxo da agência | Mesaas',
    description:
      'Conecte o Claude ao Mesaas via MCP: o agente lê briefing e estratégia, escreve com a voz de cada cliente e entrega o post no seu fluxo de aprovação.',
    lastmod: '2026-07-24',
  },
  {
    path: '/blog',
    file: 'blog.html',
    title: 'Blog do Mesaas — gestão de social media na prática',
    description:
      'Guias práticos para agências e gestores de social media: aprovação de posts, briefing, precificação, relatórios e rotina de entregas.',
    lastmod: '2026-07-25',
  },
  {
    path: '/sobre',
    file: 'sobre.html',
    title: 'Sobre o Mesaas — quem constrói o CRM para social media',
    description:
      'O Mesaas nasceu dentro de uma agência para acabar com o caos de planilhas e grupos de WhatsApp. Conheça o produto, a proposta e como falar com a gente.',
    lastmod: '2026-07-24',
  },
  {
    path: '/novidades',
    file: 'novidades.html',
    title: 'Novidades do Mesaas — melhorias e recursos toda semana',
    description:
      'Acompanhe as novidades do Mesaas: melhorias no agendamento do Instagram, no portal de aprovação do cliente, nos relatórios e muito mais — toda semana.',
    lastmod: '2026-07-24',
  },
  {
    path: '/politica-de-privacidade',
    file: 'politica-de-privacidade.html',
    title: 'Política de Privacidade do Mesaas — CRM para social media',
    description:
      'Como o Mesaas coleta, usa e protege os dados da sua agência e dos seus clientes. Política de privacidade completa, em conformidade com a LGPD.',
    lastmod: '2026-07-24',
  },
  {
    path: '/termos-de-uso',
    file: 'termos-de-uso.html',
    title: 'Termos de Uso do Mesaas — CRM para social media no Brasil',
    description:
      'Condições de uso da plataforma Mesaas: contas, planos, pagamentos, responsabilidades e cancelamento. Leia os termos completos do serviço.',
    lastmod: '2026-07-24',
  },
  {
    path: '/lgpd',
    file: 'lgpd.html',
    title: 'LGPD no Mesaas — proteção de dados no CRM de social media',
    description:
      'Como o Mesaas atende à Lei Geral de Proteção de Dados: bases legais, direitos dos titulares, segurança da informação e canal de contato do DPO.',
    lastmod: '2026-07-24',
  },
];

export function routeMetaFor(path: string): RouteMeta | undefined {
  return PUBLIC_ROUTES.find((r) => r.path === path);
}
