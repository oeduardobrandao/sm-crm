import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowDown, ArrowUp, BookOpen, Pencil, Plus, Search } from 'lucide-react';
import { toast } from 'sonner';
import { listKbArticles, reorderKbArticles, updateKbArticle, type KbArticle } from '../lib/api';
import { useKbViewStats } from '../lib/kb-view-stats';
import {
  bulkResultMessage,
  groupCheckState,
  runBulk,
  toggleGroup,
  toggleOne,
  visibleSelection,
  type PublishStatus,
} from '../lib/kb-bulk';
import { reorderedItems } from '../lib/kb-video-status';
import {
  KB_CATEGORIES as CATEGORIES,
  ALL_KB_CATEGORIES as ALL_CATEGORIES,
} from '../lib/kb-categories';
import { kbArticleEditPath, kbArticleNewPath } from '../lib/routes';
import { cn } from '../lib/utils';
import { PageHeader } from '../components/PageHeader';
import { EmptyState } from '../components/EmptyState';
import { ErrorState } from '../components/ErrorState';
import { RowLink } from '../components/RowLink';
import { KbViewStats } from '../components/KbViewStats';
import { KbBulkBar } from '../components/KbBulkBar';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { Card } from '../components/ui/card';
import { Checkbox } from '../components/ui/checkbox';
import { Input } from '../components/ui/input';
import { Skeleton } from '../components/ui/skeleton';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../components/ui/select';

const STATUSES = ['draft', 'published'] as const;
const STATUS_LABELS: Record<string, string> = {
  draft: 'Rascunho',
  published: 'Publicado',
};

/** Radix Select rejects '' as an item value; this sentinel stands for "no filter". */
const ALL = '__all__';

const ARTICLES_KEY = ['admin', 'kb-articles', 'all'] as const;
const ROW_GRID = 'md:grid-cols-[1.25rem_2fr_0.7fr_minmax(15rem,1.3fr)_auto_1rem]';

function statusBadge(status: string): { label: string; variant: 'success' | 'neutral' } {
  if (status === 'published') return { label: 'Publicado', variant: 'success' };
  return { label: 'Rascunho', variant: 'neutral' };
}

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
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [selected, setSelected] = useState<Set<string>>(() => new Set());

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
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ['admin', 'kb-articles'] }),
  });

  const move = (list: KbArticle[], index: number, delta: -1 | 1) => {
    const items = reorderedItems(list, index, delta);
    if (items) reorderMut.mutate(items);
  };

  return (
    // Room under the last row so the floating bulk bar never covers it.
    <div className={cn(actionable.length > 0 && 'pb-20')}>
      <PageHeader
        title="Base de conhecimento"
        description="Gerencie os artigos de ajuda do CRM"
        actions={
          <Button asChild>
            <Link to={kbArticleNewPath()}>
              <Plus />
              Novo artigo
            </Link>
          </Button>
        }
      />

      <div className="mb-6 flex flex-col gap-3 sm:flex-row">
        <div className="relative flex-1">
          <Search
            size={14}
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            type="search"
            placeholder="Buscar artigos…"
            aria-label="Buscar artigos"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-8"
          />
        </div>
        <span id="kb-category-label" className="sr-only">
          Categoria
        </span>
        <Select
          value={categoryFilter === '' ? ALL : categoryFilter}
          onValueChange={(v) => setCategoryFilter(v === ALL ? '' : v)}
        >
          <SelectTrigger
            id="kb-category-trigger"
            aria-labelledby="kb-category-label kb-category-trigger"
            className="w-auto gap-2"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>Todas as categorias</SelectItem>
            {ALL_CATEGORIES.map((c) => (
              <SelectItem key={c} value={c}>
                {CATEGORIES[c]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <span id="kb-status-label" className="sr-only">
          Status
        </span>
        <Select
          value={statusFilter === '' ? ALL : statusFilter}
          onValueChange={(v) => setStatusFilter(v === ALL ? '' : v)}
        >
          <SelectTrigger
            id="kb-status-trigger"
            aria-labelledby="kb-status-label kb-status-trigger"
            className="w-auto gap-2"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>Todos os status</SelectItem>
            {STATUSES.map((s) => (
              <SelectItem key={s} value={s}>
                {STATUS_LABELS[s]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <KbBulkBar
        count={actionable.length}
        pending={bulkMut.isPending}
        onSetStatus={(status) => bulkMut.mutate({ ids: actionable, status })}
        onClear={() => setSelected(new Set())}
      />

      {isLoading ? (
        <Card className="p-5">
          <div className="flex flex-col gap-3 py-4">
            <Skeleton className="h-4 w-72" />
            <Skeleton className="h-4 w-64" />
            <Skeleton className="h-4 w-60" />
          </div>
        </Card>
      ) : isError ? (
        <Card className="p-5">
          <ErrorState message="Não foi possível carregar os artigos." onRetry={() => refetch()} />
        </Card>
      ) : visibleGroups.length === 0 ? (
        <Card className="p-5">
          <EmptyState
            icon={BookOpen}
            title="Nenhum artigo encontrado"
            description={hasFilters ? 'Nenhum artigo bate com os filtros atuais.' : undefined}
            action={
              hasFilters ? (
                <Button variant="outline" size="sm" onClick={clearFilters}>
                  Limpar filtros
                </Button>
              ) : undefined
            }
          />
        </Card>
      ) : (
        <div className="flex flex-col gap-5">
          {!canReorder && (
            <p className="text-xs text-muted-foreground">
              Limpe a busca e o filtro de status para reordenar os artigos.
            </p>
          )}
          {visibleGroups.map(({ category, articles: all, visible }) => {
            const catLabel = CATEGORIES[category] ?? category;
            const groupIds = visible.map((a) => a.id);
            return (
              <Card key={category} className="p-5">
                <div className="mb-1 flex items-center gap-3 border-b border-border pb-3">
                  <Checkbox
                    aria-label={`Selecionar todos os artigos de ${catLabel}`}
                    checked={groupCheckState(selected, groupIds)}
                    onCheckedChange={() => setSelected((prev) => toggleGroup(prev, groupIds))}
                  />
                  <h2 className="truncate text-base font-semibold">{catLabel}</h2>
                  <span className="text-xs tabular-nums text-muted-foreground">
                    {visible.length}
                  </span>
                </div>
                <div
                  className={cn(
                    'hidden py-2 text-[0.7rem] uppercase tracking-wider text-muted-foreground md:grid md:gap-3',
                    ROW_GRID,
                  )}
                >
                  <span></span>
                  <span>Título</span>
                  <span>Status</span>
                  <span>Visualizações</span>
                  <span className="sr-only">Ordem</span>
                  <span></span>
                </div>
                {visible.map((a) => {
                  const badge = statusBadge(a.status);
                  const to = kbArticleEditPath(a.id);
                  const index = all.indexOf(a);
                  const checkbox = (
                    <Checkbox
                      aria-label={`Selecionar ${a.title}`}
                      checked={selected.has(a.id)}
                      onCheckedChange={() => setSelected((prev) => toggleOne(prev, a.id))}
                    />
                  );
                  const arrows = canReorder && (
                    <div className="flex gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={`Mover ${a.title} para cima`}
                        disabled={index === 0 || reorderMut.isPending}
                        onClick={() => move(all, index, -1)}
                      >
                        <ArrowUp size={14} />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={`Mover ${a.title} para baixo`}
                        disabled={index === all.length - 1 || reorderMut.isPending}
                        onClick={() => move(all, index, 1)}
                      >
                        <ArrowDown size={14} />
                      </Button>
                    </div>
                  );
                  return (
                    <div
                      key={a.id}
                      onClick={() => navigate(to)}
                      className="-mx-5 cursor-pointer border-b border-border/50 px-5 py-3 transition-colors last:border-b-0 hover:bg-secondary/30"
                    >
                      {/* The whole row is a mouse target; the title link below is the keyboard/AT target. */}
                      <div className="flex items-start gap-3 md:hidden">
                        <div className="pt-0.5" onClick={(e) => e.stopPropagation()}>
                          {checkbox}
                        </div>
                        <div
                          className={cn(
                            'flex min-w-0 flex-1 flex-col gap-1.5',
                            a.status === 'draft' && 'opacity-50',
                          )}
                        >
                          <RowLink to={to} className="truncate text-sm">
                            {a.title}
                          </RowLink>
                          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                            <Badge variant={badge.variant} size="sm">
                              {badge.label}
                            </Badge>
                          </div>
                          <KbViewStats
                            stats={viewStats.data?.articles[a.id]}
                            loading={viewStats.isLoading}
                            failed={viewStats.isError}
                          />
                        </div>
                        <div onClick={(e) => e.stopPropagation()}>{arrows}</div>
                      </div>
                      <div className={cn('hidden items-center gap-3 md:grid', ROW_GRID)}>
                        <div className="flex" onClick={(e) => e.stopPropagation()}>
                          {checkbox}
                        </div>
                        <div className={cn('min-w-0', a.status === 'draft' && 'opacity-50')}>
                          <RowLink to={to} className="block truncate text-sm">
                            {a.title}
                          </RowLink>
                          <div className="mt-0.5 text-xs text-muted-foreground">/{a.slug}</div>
                        </div>
                        <Badge variant={badge.variant} size="sm" className="w-fit">
                          {badge.label}
                        </Badge>
                        <KbViewStats
                          className="[&>div]:whitespace-nowrap"
                          stats={viewStats.data?.articles[a.id]}
                          loading={viewStats.isLoading}
                          failed={viewStats.isError}
                        />
                        <div onClick={(e) => e.stopPropagation()}>{arrows}</div>
                        <span className="text-muted-foreground hover:text-primary">
                          <Pencil size={14} />
                        </span>
                      </div>
                    </div>
                  );
                })}
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
