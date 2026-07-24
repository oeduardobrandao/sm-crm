import type { RouteMeta } from './site-meta';
import { canonicalUrl } from './seo-head';

/** llms.txt (https://llmstxt.org): tells AI crawlers what Mesaas is and where
 * the substantive pages live. Regenerated on every build from the manifest. */
export function buildLlmsTxt(routes: RouteMeta[]): string {
  const pages = routes
    .map((r) => `- [${r.title}](${canonicalUrl(r.path)}): ${r.description}`)
    .join('\n');
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
    '',
  ].join('\n');
}
