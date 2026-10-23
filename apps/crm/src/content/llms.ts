import type { RouteMeta } from './site-meta';
import type { BlogPost } from './blog.schema';
import { canonicalUrl } from './seo-head';
import { postPath } from './blog';

/** The file is line-oriented: a newline in a title or description (a DB post's
 * h1, say) would start a line of its own. Collapse every whitespace run. */
const oneLine = (s: string): string => s.replace(/\s+/g, ' ').trim();

/** llms.txt (https://llmstxt.org): tells AI crawlers what Mesaas is and where
 * the substantive pages live. Regenerated on every build from the manifest. */
export function buildLlmsTxt(routes: RouteMeta[], posts: BlogPost[] = []): string {
  const pages = routes
    .map((r) => `- [${oneLine(r.title)}](${canonicalUrl(r.path)}): ${oneLine(r.description)}`)
    .join('\n');
  const blog = posts.length
    ? [
        '',
        '## Blog',
        '',
        posts
          .map(
            (p) => `- [${oneLine(p.h1)}](${canonicalUrl(postPath(p))}): ${oneLine(p.description)}`,
          )
          .join('\n'),
      ]
    : [];
  return [
    '# Mesaas',
    '',
    '> CRM para agências e gestores de social media no Brasil: gestão de clientes e contratos, kanban de entregas, calendário editorial, aprovação de posts pelo cliente via link (sem login), agendamento e publicação automática no Instagram pela API oficial do Meta, relatórios de métricas, financeiro e um agente de conteúdo com IA conectado via MCP (Model Context Protocol).',
    '',
    'O produto é 100% web, em português (pt-BR). Plano Free disponível — sem cartão de crédito.',
    '',
    '## Páginas',
    '',
    pages,
    ...blog,
    '',
  ].join('\n');
}
