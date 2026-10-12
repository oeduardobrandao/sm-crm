import type { ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { format } from 'date-fns';
import { ArrowDown, ArrowUp, BookOpen, Plus, Search } from 'lucide-react';
import { SegmentedControl } from '@mesaas/ios-kit';
import { groupCheckState } from '../../lib/kb-bulk';
import {
  KB_CATEGORIES as CATEGORIES,
  ALL_KB_CATEGORIES as ALL_CATEGORIES,
} from '../../lib/kb-categories';
import { kbArticleEditPath, kbArticleNewPath } from '../../lib/routes';
import { cn } from '../../lib/utils';
import { PageHeader } from '../../components/PageHeader';
import { EmptyState } from '../../components/EmptyState';
import { ErrorState } from '../../components/ErrorState';
import { RowLink } from '../../components/RowLink';
import { KbViewStats } from '../../components/KbViewStats';
import { GlassPanel } from '../../components/shell/GlassPanel';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { Checkbox } from '../../components/ui/checkbox';
import { Input } from '../../components/ui/input';
import { Skeleton } from '../../components/ui/skeleton';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../components/ui/select';
import {
  STATUS_SEGMENTS,
  fromSegment,
  statusBadge,
  toSegment,
  type KbArticlesViewProps,
} from './list-view';

/** Radix Select rejects '' as an item value; this sentinel stands for "no filter". */
const ALL = '__all__';

const ROW_GRID =
  'grid grid-cols-[1.25rem_minmax(0,1fr)_6.5rem_minmax(12rem,15rem)_4.5rem_4.5rem] items-center gap-3.5';

const ROUND_CHECK = 'h-5 w-5 rounded-full border-[1.5px] border-muted-foreground/50';

const articleCount = (n: number) => (n === 1 ? '1 artigo' : `${n} artigos`);

function updatedLabel(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : format(d, 'dd/MM/yy');
}

export function KbArticlesDesktop(p: KbArticlesViewProps) {
  const navigate = useNavigate();
  const stats = p.viewStats;

  let body: ReactNode;
  if (p.isLoading) {
    body = (
      <div className="flex flex-col gap-3 px-[18px] py-6">
        <Skeleton className="h-4 w-72" />
        <Skeleton className="h-4 w-64" />
        <Skeleton className="h-4 w-60" />
      </div>
    );
  } else if (p.isError) {
    body = <ErrorState message="Não foi possível carregar os artigos." onRetry={p.onRetry} />;
  } else if (p.visibleGroups.length === 0) {
    body = (
      <EmptyState
        icon={BookOpen}
        title="Nenhum artigo encontrado"
        description={p.hasFilters ? 'Nenhum artigo bate com os filtros atuais.' : undefined}
        action={
          p.hasFilters ? (
            <Button variant="outline" size="sm" onClick={p.onClearFilters}>
              Limpar filtros
            </Button>
          ) : undefined
        }
      />
    );
  } else {
    body = (
      <>
        {!p.canReorder && (
          <p className="px-[18px] pb-2 text-xs text-muted-foreground">
            Limpe a busca e o filtro de status para reordenar os artigos.
          </p>
        )}
        <div
          className={cn(
            ROW_GRID,
            'border-t border-border px-[18px] py-2 text-[11px] font-semibold uppercase tracking-[0.04em] text-muted-foreground',
          )}
        >
          <span />
          <span>Título</span>
          <span>Status</span>
          <span>Visualizações</span>
          <span className="text-right">Atualizado</span>
          <span className="sr-only">Ordem</span>
        </div>
        {p.visibleGroups.map(({ category, articles: all, visible }) => {
          const catLabel = CATEGORIES[category] ?? category;
          const groupIds = visible.map((a) => a.id);
          const groupState = groupCheckState(p.selected, groupIds);
          return (
            <section key={category} aria-labelledby={`kb-cat-${category}`}>
              <div className="flex items-center justify-between gap-3 border-t border-border px-[18px] py-2">
                <div className="flex min-w-0 items-baseline gap-1.5 text-[11px] font-semibold uppercase tracking-[0.04em] text-muted-foreground">
                  <h2 id={`kb-cat-${category}`} className="truncate">
                    {catLabel}
                  </h2>
                  <span className="tabular-nums">· {visible.length}</span>
                </div>
                <button
                  type="button"
                  role="checkbox"
                  aria-checked={groupState === 'indeterminate' ? 'mixed' : groupState}
                  aria-label={`Selecionar todos os artigos de ${catLabel}`}
                  onClick={() => p.onToggleGroup(groupIds)}
                  className="shrink-0 rounded-sm text-xs font-semibold text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {groupState === true ? 'Desmarcar todos' : 'Selecionar todos'}
                </button>
              </div>
              <ul>
                {visible.map((a) => {
                  const badge = statusBadge(a.status);
                  const to = kbArticleEditPath(a.id);
                  const index = all.indexOf(a);
                  const isSelected = p.selected.has(a.id);
                  return (
                    <li
                      key={a.id}
                      // The whole row is a mouse target; the title link is the keyboard/AT target.
                      onClick={() => navigate(to)}
                      className={cn(
                        ROW_GRID,
                        'min-h-[50px] cursor-pointer border-t border-border/60 px-[18px] py-1.5 transition-colors hover:bg-foreground/[0.04]',
                        isSelected && 'bg-primary/[0.07] hover:bg-primary/[0.1]',
                      )}
                    >
                      <div className="flex" onClick={(e) => e.stopPropagation()}>
                        <Checkbox
                          aria-label={`Selecionar ${a.title}`}
                          checked={isSelected}
                          onCheckedChange={() => p.onToggleOne(a.id)}
                          className={ROUND_CHECK}
                        />
                      </div>
                      <div className={cn('min-w-0', a.status === 'draft' && 'opacity-60')}>
                        <RowLink to={to} className="block truncate text-sm">
                          {a.title}
                        </RowLink>
                        <div className="truncate text-xs text-muted-foreground">/{a.slug}</div>
                      </div>
                      <Badge variant={badge.variant} size="sm" className="w-fit">
                        {badge.label}
                      </Badge>
                      <KbViewStats
                        className="[&>div]:truncate"
                        stats={stats.data?.articles[a.id]}
                        loading={stats.isLoading}
                        failed={stats.isError}
                      />
                      <span className="text-right text-[13px] tabular-nums text-muted-foreground">
                        {updatedLabel(a.updated_at)}
                      </span>
                      <div className="flex justify-end" onClick={(e) => e.stopPropagation()}>
                        {p.canReorder && (
                          <>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8"
                              aria-label={`Mover ${a.title} para cima`}
                              disabled={index === 0 || p.reorderPending}
                              onClick={() => p.onMove(all, index, -1)}
                            >
                              <ArrowUp aria-hidden="true" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8"
                              aria-label={`Mover ${a.title} para baixo`}
                              disabled={index === all.length - 1 || p.reorderPending}
                              onClick={() => p.onMove(all, index, 1)}
                            >
                              <ArrowDown aria-hidden="true" />
                            </Button>
                          </>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            </section>
          );
        })}
      </>
    );
  }

  return (
    // Room under the last row so the floating selection bar never covers it.
    <div className={cn(p.actionableCount > 0 && 'pb-20')}>
      <PageHeader
        title="Artigos"
        description={`Central de Ajuda do CRM · ${articleCount(p.total)}`}
        actions={
          <Button asChild>
            <Link to={kbArticleNewPath()}>
              <Plus aria-hidden="true" />
              Novo artigo
            </Link>
          </Button>
        }
      />

      <GlassPanel flush>
        <div className="flex flex-wrap items-center gap-2.5 px-[18px] py-3">
          <SegmentedControl
            aria-label="Filtrar por status"
            options={STATUS_SEGMENTS.map((s) => ({ value: s.value, label: s.label }))}
            value={toSegment(p.statusFilter)}
            onChange={(v) => p.onStatusFilterChange(fromSegment(v))}
            className="inline-flex [&>button]:px-3"
          />
          <span id="kb-category-label" className="sr-only">
            Categoria
          </span>
          <Select
            value={p.categoryFilter === '' ? ALL : p.categoryFilter}
            onValueChange={(v) => p.onCategoryFilterChange(v === ALL ? '' : v)}
          >
            <SelectTrigger
              id="kb-category-trigger"
              aria-labelledby="kb-category-label kb-category-trigger"
              className="h-8 w-auto gap-2"
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
          <div className="relative ml-auto min-w-[200px] flex-1 sm:max-w-xs">
            <Search
              size={14}
              aria-hidden="true"
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
            />
            <Input
              type="search"
              placeholder="Buscar artigos…"
              aria-label="Buscar artigos"
              value={p.search}
              onChange={(e) => p.onSearchChange(e.target.value)}
              className="h-8 pl-8"
            />
          </div>
        </div>
        {body}
      </GlassPanel>

      {p.bulkBar}
    </div>
  );
}
