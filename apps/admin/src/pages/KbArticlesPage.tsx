import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router-dom';
import { BookOpen, Pencil, Plus, Search } from 'lucide-react';
import { listKbArticles } from '../lib/api';
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
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { Card } from '../components/ui/card';
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

function statusBadge(status: string): { label: string; variant: 'success' | 'neutral' } {
  if (status === 'published') return { label: 'Publicado', variant: 'success' };
  return { label: 'Rascunho', variant: 'neutral' };
}

export default function KbArticlesPage() {
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['admin', 'kb-articles', statusFilter, categoryFilter],
    queryFn: () =>
      listKbArticles({
        ...(statusFilter ? { status: statusFilter } : {}),
        ...(categoryFilter ? { category: categoryFilter } : {}),
      }),
  });

  const articles = (data?.articles || []).filter(
    (a) => !search || a.title.toLowerCase().includes(search.toLowerCase()),
  );
  const hasFilters = search !== '' || statusFilter !== '' || categoryFilter !== '';
  const clearFilters = () => {
    setSearch('');
    setStatusFilter('');
    setCategoryFilter('');
  };

  return (
    <div>
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
        <Select
          value={categoryFilter === '' ? ALL : categoryFilter}
          onValueChange={(v) => setCategoryFilter(v === ALL ? '' : v)}
        >
          <SelectTrigger aria-label="Categoria" className="w-auto gap-2">
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
        <Select
          value={statusFilter === '' ? ALL : statusFilter}
          onValueChange={(v) => setStatusFilter(v === ALL ? '' : v)}
        >
          <SelectTrigger aria-label="Status" className="w-auto gap-2">
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

      <Card className="p-5">
        <div className="hidden border-b border-border pb-3 text-[0.7rem] uppercase tracking-wider text-muted-foreground md:grid md:grid-cols-[2fr_1fr_0.7fr_0.7fr_0.5fr] md:gap-2">
          <span>Título</span>
          <span>Categoria</span>
          <span>Status</span>
          <span>Ordem</span>
          <span></span>
        </div>

        {isLoading ? (
          <div className="flex flex-col gap-3 py-4">
            <Skeleton className="h-4 w-72" />
            <Skeleton className="h-4 w-64" />
            <Skeleton className="h-4 w-60" />
          </div>
        ) : isError ? (
          <ErrorState message="Não foi possível carregar os artigos." onRetry={() => refetch()} />
        ) : articles.length === 0 ? (
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
        ) : (
          articles.map((a) => {
            const badge = statusBadge(a.status);
            const catLabel = CATEGORIES[a.category] ?? a.category;
            const to = kbArticleEditPath(a.id);
            return (
              <div
                key={a.id}
                onClick={() => navigate(to)}
                className={cn(
                  '-mx-5 cursor-pointer border-b border-border/50 px-5 py-3 transition-colors hover:bg-secondary/30',
                  a.status === 'draft' && 'opacity-50',
                )}
              >
                {/* The whole row is a mouse target; the title link below is the keyboard/AT target. */}
                <div className="flex flex-col gap-1.5 md:hidden">
                  <RowLink to={to} className="truncate text-sm">
                    {a.title}
                  </RowLink>
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                    <span>{catLabel}</span>
                    <Badge variant={badge.variant} size="sm">
                      {badge.label}
                    </Badge>
                  </div>
                </div>
                <div className="hidden items-center gap-2 md:grid md:grid-cols-[2fr_1fr_0.7fr_0.7fr_0.5fr]">
                  <div className="min-w-0">
                    <RowLink to={to} className="block truncate text-sm">
                      {a.title}
                    </RowLink>
                    <div className="mt-0.5 text-xs text-muted-foreground">/{a.slug}</div>
                  </div>
                  <span className="text-sm text-muted-foreground">{catLabel}</span>
                  <Badge variant={badge.variant} size="sm" className="w-fit">
                    {badge.label}
                  </Badge>
                  <span className="text-sm text-muted-foreground">{a.display_order}</span>
                  <span className="text-muted-foreground hover:text-primary">
                    <Pencil size={14} />
                  </span>
                </div>
              </div>
            );
          })
        )}
      </Card>
    </div>
  );
}
