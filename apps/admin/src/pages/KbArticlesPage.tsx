import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { listKbArticles, reorderKbArticles, updateKbArticle, type KbArticle } from '../lib/api';
import { useKbViewStats } from '../lib/kb-view-stats';
import {
  bulkResultMessage,
  runBulk,
  toggleGroup,
  toggleOne,
  visibleSelection,
  type PublishStatus,
} from '../lib/kb-bulk';
import { reorderedItems } from '../lib/kb-video-status';
import { ALL_KB_CATEGORIES as ALL_CATEGORIES } from '../lib/kb-categories';
import { useIsPhone } from '../hooks/useIsPhone';
import { KbBulkBar } from '../components/KbBulkBar';
import { KbArticlesDesktop } from './kb-articles/KbArticlesDesktop';
import { KbArticlesPhone } from './kb-articles/KbArticlesPhone';
import type { KbArticlesViewProps, StatusFilter } from './kb-articles/list-view';

const ARTICLES_KEY = ['admin', 'kb-articles', 'all'] as const;

/** The CRM lists articles per category by display_order; ties fall back to a stable key. */
function byDisplayOrder(a: KbArticle, b: KbArticle): number {
  return (
    a.display_order - b.display_order ||
    a.created_at.localeCompare(b.created_at) ||
    a.id.localeCompare(b.id)
  );
}

/** Known categories in their canonical order, then any legacy slug the admin doesn't know. */
function groupByCategory(
  articles: KbArticle[],
): Array<{ category: string; articles: KbArticle[] }> {
  const map = new Map<string, KbArticle[]>();
  for (const a of articles) {
    const list = map.get(a.category);
    if (list) list.push(a);
    else map.set(a.category, [a]);
  }
  const order = [...ALL_CATEGORIES, ...[...map.keys()].filter((c) => !ALL_CATEGORIES.includes(c))];
  return order
    .filter((c) => map.has(c))
    .map((c) => ({ category: c, articles: map.get(c)!.sort(byDisplayOrder) }));
}

export default function KbArticlesPage() {
  const isPhone = useIsPhone();
  const qc = useQueryClient();
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  // Phone selection mode. A selection made on desktop keeps it on after a rotation.
  const [selectMode, setSelectMode] = useState(false);
  const selecting = selectMode || selected.size > 0;

  const viewStats = useKbViewStats();
  // Always the full list, filtered here: reordering renumbers a whole category, so it has to see
  // the rows a status filter would hide.
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ARTICLES_KEY,
    queryFn: () => listKbArticles(),
  });

  const groups = useMemo(() => groupByCategory(data?.articles ?? []), [data]);
  const needle = search.toLowerCase();
  const visibleGroups = groups
    .filter((g) => !categoryFilter || g.category === categoryFilter)
    .map((g) => ({
      ...g,
      visible: g.articles.filter(
        (a) =>
          (!statusFilter || a.status === statusFilter) &&
          (!needle || a.title.toLowerCase().includes(needle)),
      ),
    }))
    .filter((g) => g.visible.length > 0);
  const visibleIds = visibleGroups.flatMap((g) => g.visible.map((a) => a.id));
  const actionable = visibleSelection(selected, visibleIds);

  const hasFilters = search !== '' || statusFilter !== '' || categoryFilter !== '';
  // A move swaps neighbours in the full category list; with rows hidden that isn't what the
  // admin sees, so the arrows wait for the search and status filters to be cleared.
  const canReorder = search === '' && statusFilter === '';
  const clearFilters = () => {
    setSearch('');
    setStatusFilter('');
    setCategoryFilter('');
  };

  const reorderMut = useMutation({
    mutationFn: (items: Array<{ id: string; display_order: number }>) => reorderKbArticles(items),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin', 'kb-articles'] }),
    onError: () => toast.error('Não foi possível reordenar.'),
  });

  const bulkMut = useMutation({
    mutationFn: ({ ids, status }: { ids: string[]; status: PublishStatus }) =>
      runBulk(ids, (id) => updateKbArticle({ article_id: id, status })),
    onSuccess: (result, { status }) => {
      const message = bulkResultMessage(status, result);
      if (result.failed > 0) toast.error(message);
      else toast.success(message);
      setSelected(new Set());
      setSelectMode(false);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ['admin', 'kb-articles'] }),
  });

  const move = (list: KbArticle[], index: number, delta: -1 | 1) => {
    const items = reorderedItems(list, index, delta);
    if (items) reorderMut.mutate(items);
  };

  const toggleSelectMode = () => {
    if (selecting) {
      setSelectMode(false);
      setSelected(new Set());
    } else {
      setSelectMode(true);
    }
  };

  const view: KbArticlesViewProps = {
    total: data?.articles.length ?? 0,
    isLoading,
    isError,
    onRetry: () => refetch(),
    categories: groups.map((g) => g.category),
    visibleGroups,
    search,
    onSearchChange: setSearch,
    statusFilter,
    onStatusFilterChange: setStatusFilter,
    categoryFilter,
    onCategoryFilterChange: setCategoryFilter,
    hasFilters,
    onClearFilters: clearFilters,
    canReorder,
    reorderPending: reorderMut.isPending,
    onMove: move,
    selected,
    actionableCount: actionable.length,
    onToggleOne: (id) => setSelected((prev) => toggleOne(prev, id)),
    onToggleGroup: (ids) => setSelected((prev) => toggleGroup(prev, ids)),
    selectMode: selecting,
    onToggleSelectMode: toggleSelectMode,
    viewStats: { data: viewStats.data, isLoading: viewStats.isLoading, isError: viewStats.isError },
    bulkBar: (
      <KbBulkBar
        count={actionable.length}
        pending={bulkMut.isPending}
        onSetStatus={(status) => bulkMut.mutate({ ids: actionable, status })}
        onClear={() => setSelected(new Set())}
      />
    ),
  };

  return isPhone ? <KbArticlesPhone {...view} /> : <KbArticlesDesktop {...view} />;
}
