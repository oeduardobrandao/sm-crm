// Single source for KB category slugs/labels in the admin app. Keep in sync
// with the CRM-facing labels in apps/crm/src/pages/ajuda/categoryConfig.ts —
// the slugs must match exactly; only the (English) labels differ.
export const KB_CATEGORIES: Record<string, string> = {
  'primeiros-passos': 'Getting Started',
  'claude-e-ia': 'Claude & AI',
  clientes: 'Clients',
  equipe: 'Team',
  tarefas: 'Tasks',
  'entregas-e-fluxos': 'Deliveries & Flows',
  'hub-do-cliente': 'Client Hub',
  mensagens: 'Messages',
  'instagram-e-analytics': 'Instagram & Analytics',
  relatorios: 'Reports',
  'post-express': 'Post Express',
  automacoes: 'Automations',
  financeiro: 'Financial',
  cobranca: 'Billing & Plan',
  arquivos: 'Files',
};

export const ALL_KB_CATEGORIES = Object.keys(KB_CATEGORIES);
