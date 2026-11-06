import type { ReactNode } from 'react';
import type { KbArticle, KbViewStatsResponse } from '../../lib/api';

export type StatusFilter = '' | 'published' | 'draft';

/** Segmented filter values: `all` stands for "no status filter" (a segment needs a value). */
export const STATUS_SEGMENTS = [
  { value: 'all', label: 'Todos' },
  { value: 'published', label: 'Publicados' },
  { value: 'draft', label: 'Rascunhos' },
] as const;
export type StatusSegment = (typeof STATUS_SEGMENTS)[number]['value'];

export const toSegment = (s: StatusFilter): StatusSegment => (s === '' ? 'all' : s);
export const fromSegment = (s: StatusSegment): StatusFilter => (s === 'all' ? '' : s);

export function statusBadge(status: string): { label: string; variant: 'success' | 'neutral' } {
  if (status === 'published') return { label: 'Publicado', variant: 'success' };
  return { label: 'Rascunho', variant: 'neutral' };
}

export interface ArticleGroup {
  category: string;
  /** Every article of the category, in display order (reordering works on this list). */
  articles: KbArticle[];
  /** The ones the search and status filter let through. */
  visible: KbArticle[];
}

/** What both list views receive from KbArticlesPage, which owns every query and mutation. */
export interface KbArticlesViewProps {
  total: number;
  isLoading: boolean;
  isError: boolean;
  onRetry: () => void;
  /** Every category that has articles, for the phone's category chips. */
  categories: string[];
  visibleGroups: ArticleGroup[];
  search: string;
  onSearchChange: (value: string) => void;
  statusFilter: StatusFilter;
  onStatusFilterChange: (value: StatusFilter) => void;
  categoryFilter: string;
  onCategoryFilterChange: (value: string) => void;
  hasFilters: boolean;
  onClearFilters: () => void;
  canReorder: boolean;
  reorderPending: boolean;
  onMove: (list: KbArticle[], index: number, delta: -1 | 1) => void;
  selected: Set<string>;
  /** Selected ids the current filters still show: what the bulk actions apply to. */
  actionableCount: number;
  onToggleOne: (id: string) => void;
  onToggleGroup: (ids: string[]) => void;
  /** Phone selection mode (desktop rows always carry their checkbox). */
  selectMode: boolean;
  onToggleSelectMode: () => void;
  viewStats: { data: KbViewStatsResponse | undefined; isLoading: boolean; isError: boolean };
  /** The bulk action bar, rendered by the view after the list and outside every panel. */
  bulkBar: ReactNode;
}
