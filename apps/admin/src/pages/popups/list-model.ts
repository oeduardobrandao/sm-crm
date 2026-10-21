import type { GlobalPopup } from '../../lib/api';
import type { BadgeProps } from '../../components/ui/badge';

/** Uma linha da lista, já com os rótulos prontos (as duas vistas mostram os mesmos dados). */
export interface PopupRowView {
  popup: GlobalPopup;
  title: string;
  pageCount: number;
  /** "2 páginas". */
  pagesLabel: string;
  metrics: string;
  frequency: string;
  target: string;
  /** Chip do gatilho ("Teste em 3 dias"), nulo sem gatilho. */
  trigger: string | null;
  schedule: string;
  status: { label: string; variant: NonNullable<BadgeProps['variant']> };
  imageKey: string | null;
  draft: boolean;
}

export interface PopupsViewProps {
  rows: PopupRowView[];
  isLoading: boolean;
  statusFilter: string;
  onStatusFilterChange: (value: string) => void;
  search: string;
  onSearchChange: (value: string) => void;
  onCreate: () => void;
  onEdit: (popup: GlobalPopup) => void;
}

/** Valores do filtro de status ('' = todos), os mesmos da query `listPopups`. */
export const STATUS_FILTERS = [
  { value: '', label: 'Todos' },
  { value: 'active', label: 'Ativos' },
  { value: 'draft', label: 'Rascunhos' },
  { value: 'archived', label: 'Arquivados' },
];

export const PAGE_DESCRIPTION = 'Avisos em modal, no máximo uma vez por sessão no CRM';
