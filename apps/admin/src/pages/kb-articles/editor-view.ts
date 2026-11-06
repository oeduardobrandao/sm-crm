import type { ReactNode } from 'react';
import type { KbContextLink } from '../../lib/api';

export type ArticleStatus = 'draft' | 'published';

export const STATUS_LABELS: Record<ArticleStatus, string> = {
  draft: 'Rascunho',
  published: 'Publicado',
};

/** The CRM screens an article can be suggested on (the CRM help widget matches these). */
export const CRM_ROUTES = [
  { value: '/dashboard', label: 'Dashboard' },
  { value: '/clientes', label: 'Clientes' },
  { value: '/equipe', label: 'Equipe' },
  { value: '/tarefas', label: 'Tarefas' },
  { value: '/entregas', label: 'Entregas' },
  { value: '/mensagens', label: 'Mensagens' },
  { value: '/post-express', label: 'Post Express' },
  { value: '/automacoes', label: 'Automações' },
  { value: '/analytics', label: 'Analytics' },
  { value: '/analytics-fluxos', label: 'Analytics de Fluxos' },
  { value: '/relatorios', label: 'Relatórios' },
  { value: '/financeiro', label: 'Financeiro' },
  { value: '/contratos', label: 'Contratos' },
  { value: '/configuracao', label: 'Configuração' },
  { value: '/configuracao/mcp', label: 'Configuração · Agentes (MCP)' },
  { value: '/calendario', label: 'Calendário' },
  { value: '/leads', label: 'Leads' },
  { value: '/ideias', label: 'Ideias' },
  { value: '/importar', label: 'Importar' },
  { value: '/arquivos', label: 'Arquivos' },
];

export const routeLabel = (pattern: string) =>
  CRM_ROUTES.find((r) => r.value === pattern)?.label ?? pattern;

export interface ArticleFieldValues {
  title: string;
  slug: string;
  category: string;
  excerpt: string;
  tags: string;
  displayOrder: string;
  status: ArticleStatus;
  coverUrl: string;
}

export type ArticleFieldSetters = {
  [K in keyof ArticleFieldValues]: (value: ArticleFieldValues[K]) => void;
};

/** What both editor views receive from KbArticleEditorPage, which owns every query and mutation. */
export interface KbArticleEditorViewProps {
  isEdit: boolean;
  /** "Salvo há 2 minutos · Rascunho" (saved status), "Salvando…" or "Ainda não salvo". */
  saveState: string;
  values: ArticleFieldValues;
  set: ArticleFieldSetters;
  slugError: string | null;
  coverPreview: string;
  coverUploading: boolean;
  onCoverFile: (file: File) => void;
  /** The TipTap editor (or its loading line), built by the page. */
  editor: ReactNode;
  /** Context links exist only once the article is saved. */
  contextEnabled: boolean;
  contextLinks: KbContextLink[];
  availableRoutes: Array<{ value: string; label: string }>;
  selectedRoute: string;
  onSelectedRouteChange: (value: string) => void;
  onAddContextLink: () => void;
  onRemoveContextLink: (id: string) => void;
  canSave: boolean;
  saving: boolean;
  onSave: () => void;
  /** Saves with status "published" in one step. */
  onPublish: () => void;
  /** Absent for a new article. Runs the window.confirm itself. */
  onDelete?: () => void;
  deleting: boolean;
}
