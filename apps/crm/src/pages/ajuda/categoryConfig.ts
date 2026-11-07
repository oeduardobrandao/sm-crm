import { isNativeApp } from '@/native/platform';

export const CATEGORY_LABELS: Record<string, string> = {
  'primeiros-passos': 'Primeiros Passos',
  'claude-e-ia': 'Claude & IA',
  clientes: 'Clientes',
  equipe: 'Equipe',
  tarefas: 'Tarefas',
  'entregas-e-fluxos': 'Entregas & Fluxos',
  'hub-do-cliente': 'Hub do Cliente',
  mensagens: 'Mensagens',
  'instagram-e-analytics': 'Instagram & Analytics',
  relatorios: 'Relatórios',
  'post-express': 'Post Express',
  automacoes: 'Automações',
  financeiro: 'Financeiro',
  cobranca: 'Cobrança & Plano',
  arquivos: 'Arquivos',
};

/** Billing help is website-only: the iOS app never shows it (apps/mobile DECISIONS.md D33). */
const WEB_ONLY_CATEGORIES = new Set(['cobranca']);

// Read once at module load: the app shell injects its bridge before any page script runs,
// and isNativeApp() is false in Node (SSR prerender). The label above stays, so an article
// already filed under a hidden category still resolves its name.
export const ALL_CATEGORIES = Object.keys(CATEGORY_LABELS).filter(
  (cat) => !(WEB_ONLY_CATEGORIES.has(cat) && isNativeApp()),
);
