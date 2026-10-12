import type { ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowDown, ArrowUp, BookOpen, Check, ChevronRight, Plus, Search } from 'lucide-react';
import {
  Chip,
  ChipRow,
  GroupedList,
  PhoneIconButton,
  SegmentedControl,
  SwipeRow,
  type SwipeAction,
} from '@mesaas/ios-kit';
import type { KbArticle } from '../../lib/api';
import { groupCheckState } from '../../lib/kb-bulk';
import { formatPeople, formatViews } from '../../lib/kb-view-stats';
import { KB_CATEGORIES as CATEGORIES } from '../../lib/kb-categories';
import { kbArticleEditPath, kbArticleNewPath } from '../../lib/routes';
import { cn } from '../../lib/utils';
import { PageHeader } from '../../components/PageHeader';
import { EmptyState } from '../../components/EmptyState';
import { ErrorState } from '../../components/ErrorState';
import { Button } from '../../components/ui/button';
import { Skeleton } from '../../components/ui/skeleton';
import {
  STATUS_SEGMENTS,
  fromSegment,
  statusBadge,
  toSegment,
  type KbArticlesViewProps,
} from './list-view';

const articleCount = (n: number) => (n === 1 ? '1 artigo' : `${n} artigos`);
const selectedCount = (n: number) =>
  n === 0 ? 'Nenhum selecionado' : n === 1 ? '1 selecionado' : `${n} selecionados`;

function SelectCircle({ checked }: { checked: boolean }) {
  return checked ? (
    <span
      aria-hidden="true"
      className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground"
    >
      <Check size={14} strokeWidth={3.4} />
    </span>
  ) : (
    <span
      aria-hidden="true"
      className="h-[22px] w-[22px] shrink-0 rounded-full border-2 border-muted-foreground/40"
    />
  );
}

export function KbArticlesPhone(p: KbArticlesViewProps) {
  const navigate = useNavigate();
  const selecting = p.selectMode;
  const stats = p.viewStats;

  /** "Publicado · 48 visualizações · 12 pessoas" (views drop out while loading or failed). */
  const subtitle = (a: KbArticle): ReactNode => {
    const badge = statusBadge(a.status);
    const entry = stats.data?.articles[a.id];
    let views: string | null = null;
    if (!stats.isLoading && !stats.isError) {
      views =
        entry && entry.views_total > 0
          ? `${formatViews(entry.views_30d)} · ${formatPeople(entry.users_30d)}`
          : 'Sem visualizações';
    }
    return (
      <>
        <span className={cn(a.status === 'published' && 'text-success')}>{badge.label}</span>
        {views && ` · ${views}`}
      </>
    );
  };

  let body: ReactNode;
  if (p.isLoading) {
    body = (
      <div className="flex flex-col gap-3 px-4 py-6">
        <Skeleton className="h-4 w-64" />
        <Skeleton className="h-4 w-56" />
        <Skeleton className="h-4 w-48" />
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
            <Button variant="secondary" onClick={p.onClearFilters}>
              Limpar filtros
            </Button>
          ) : undefined
        }
      />
    );
  } else {
    body = p.visibleGroups.map(({ category, articles: all, visible }) => {
      const catLabel = CATEGORIES[category] ?? category;
      const groupIds = visible.map((a) => a.id);
      const groupState = groupCheckState(p.selected, groupIds);
      return (
        <div key={category}>
          <div className="mx-4 mb-1.5 flex items-center justify-between gap-3 pl-4">
            <div className="flex min-w-0 items-baseline gap-1.5 text-[13px] font-semibold uppercase tracking-[0.02em] text-muted-foreground">
              <h2 className="truncate">{catLabel}</h2>
              <span className="tabular-nums">· {visible.length}</span>
            </div>
            {selecting && (
              <button
                type="button"
                role="checkbox"
                aria-checked={groupState === 'indeterminate' ? 'mixed' : groupState}
                aria-label={`Selecionar todos os artigos de ${catLabel}`}
                onClick={() => p.onToggleGroup(groupIds)}
                className="shrink-0 text-[13px] font-semibold text-primary"
              >
                {groupState === true ? 'Desmarcar todos' : 'Selecionar todos'}
              </button>
            )}
          </div>
          <GroupedList aria-label={`Artigos de ${catLabel}`}>
            {visible.map((a) => {
              const text = (
                <span className="phone-cell__text">
                  <span className="phone-cell__label">{a.title}</span>
                  <span className="phone-cell__subtitle">{subtitle(a)}</span>
                </span>
              );

              if (selecting) {
                const checked = p.selected.has(a.id);
                return (
                  <li key={a.id} className="phone-cell">
                    <button
                      type="button"
                      role="checkbox"
                      aria-checked={checked}
                      className="phone-cell__main min-h-16"
                      onClick={() => p.onToggleOne(a.id)}
                    >
                      <span className="phone-cell__icon">
                        <SelectCircle checked={checked} />
                      </span>
                      <span className="phone-cell__body">{text}</span>
                    </button>
                  </li>
                );
              }

              // Reordering stays a swipe away, and only while nothing is hidden by a filter
              // (a move swaps neighbours in the full category list).
              const index = all.indexOf(a);
              const actions: SwipeAction[] = [];
              if (p.canReorder && !p.reorderPending) {
                if (index > 0) {
                  actions.push({
                    label: 'Subir',
                    icon: <ArrowUp />,
                    onAction: () => p.onMove(all, index, -1),
                  });
                }
                if (index < all.length - 1) {
                  actions.push({
                    label: 'Descer',
                    icon: <ArrowDown />,
                    onAction: () => p.onMove(all, index, 1),
                  });
                }
              }
              return (
                <SwipeRow key={a.id} as="li" className="phone-cell" trailingActions={actions}>
                  <Link to={kbArticleEditPath(a.id)} className="phone-cell__main min-h-16">
                    <span className="phone-cell__body">
                      {text}
                      <ChevronRight className="phone-cell__chevron" aria-hidden="true" />
                    </span>
                  </Link>
                </SwipeRow>
              );
            })}
          </GroupedList>
        </div>
      );
    });
  }

  return (
    <>
      <PageHeader
        title="Artigos"
        description={
          selecting
            ? selectedCount(p.actionableCount)
            : `Central de Ajuda do CRM · ${articleCount(p.total)}`
        }
        phoneActions={
          <>
            <button
              type="button"
              aria-label={selecting ? 'Concluir seleção' : 'Selecionar artigos'}
              aria-pressed={selecting}
              onClick={p.onToggleSelectMode}
              className="h-9 rounded-full bg-foreground/[0.12] px-3.5 text-[15px] font-semibold text-foreground"
            >
              {selecting ? 'Concluir' : 'Selecionar'}
            </button>
            {!selecting && (
              <PhoneIconButton
                label="Novo artigo"
                variant="ink"
                onClick={() => navigate(kbArticleNewPath())}
              >
                <Plus aria-hidden="true" />
              </PhoneIconButton>
            )}
          </>
        }
      >
        <SegmentedControl
          aria-label="Filtrar por status"
          options={STATUS_SEGMENTS.map((s) => ({ value: s.value, label: s.label }))}
          value={toSegment(p.statusFilter)}
          onChange={(v) => p.onStatusFilterChange(fromSegment(v))}
        />
        <label className="mt-2.5 flex h-9 items-center gap-2 rounded-[10px] bg-foreground/[0.12] px-2.5 text-muted-foreground">
          <Search size={16} aria-hidden="true" className="shrink-0" />
          <span className="sr-only">Buscar artigos</span>
          <input
            type="search"
            placeholder="Buscar artigos…"
            value={p.search}
            onChange={(e) => p.onSearchChange(e.target.value)}
            className="min-w-0 flex-1 bg-transparent text-[17px] text-foreground outline-none placeholder:text-muted-foreground"
          />
        </label>
        {p.categories.length > 1 && (
          <ChipRow aria-label="Categoria" className="mt-2.5">
            <Chip
              label="Todas"
              selected={p.categoryFilter === ''}
              onClick={() => p.onCategoryFilterChange('')}
            />
            {p.categories.map((c) => (
              <Chip
                key={c}
                label={CATEGORIES[c] ?? c}
                selected={p.categoryFilter === c}
                onClick={() => p.onCategoryFilterChange(p.categoryFilter === c ? '' : c)}
              />
            ))}
          </ChipRow>
        )}
      </PageHeader>

      {body}

      {p.bulkBar}
    </>
  );
}
