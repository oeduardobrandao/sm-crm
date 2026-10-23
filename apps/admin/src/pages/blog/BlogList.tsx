import { useNavigate } from 'react-router-dom';
import { ImageOff, Newspaper } from 'lucide-react';
import { EmptyState } from '../../components/EmptyState';
import { ErrorState } from '../../components/ErrorState';
import { RowLink } from '../../components/RowLink';
import { Badge } from '../../components/ui/badge';
import { Skeleton } from '../../components/ui/skeleton';
import { blogPostPath } from '../../lib/routes';
import { cn } from '../../lib/utils';
import {
  CATEGORY_LABEL,
  chipsFor,
  formatDateTime,
  type BlogPostRow,
  type BlogTab,
} from './blog-view';

const EMPTY: Record<BlogTab, { title: string; description: string }> = {
  aguardando: {
    title: 'Nada para revisar',
    description: 'Os rascunhos novos da rotina aparecem aqui.',
  },
  publicados: { title: 'Nenhum post publicado', description: 'Os posts aprovados ficam aqui.' },
  rejeitados: { title: 'Nenhum post rejeitado', description: 'Os posts rejeitados ficam aqui.' },
};

export interface BlogListProps {
  rows: BlogPostRow[];
  tab: BlogTab;
  selectedId: string | null;
  now: Date;
  isLoading: boolean;
  isError: boolean;
  onRetry: () => void;
  /** Set while leaving the open post needs a confirmation (an edited draft); it gets the
   * target instead of the router. */
  onOpen?: (to: string) => void;
}

export function BlogList({
  rows,
  tab,
  selectedId,
  now,
  isLoading,
  isError,
  onRetry,
  onOpen,
}: BlogListProps) {
  const navigate = useNavigate();

  if (isLoading) {
    return (
      <div className="flex flex-col gap-3 px-[18px] py-6" aria-label="Carregando posts">
        <Skeleton className="h-4 w-64" />
        <Skeleton className="h-4 w-56" />
        <Skeleton className="h-4 w-60" />
      </div>
    );
  }
  if (isError)
    return <ErrorState message="Não foi possível carregar os posts." onRetry={onRetry} />;
  if (rows.length === 0) {
    return (
      <EmptyState icon={Newspaper} title={EMPTY[tab].title} description={EMPTY[tab].description} />
    );
  }

  return (
    <ul aria-label="Posts">
      {rows.map((r) => {
        const to = blogPostPath(r.id, tab);
        const selected = r.id === selectedId;
        const chips = chipsFor(r, now);
        return (
          <li
            key={r.id}
            onClick={() => (onOpen && r.id !== selectedId ? onOpen(to) : navigate(to))}
            aria-current={selected ? 'true' : undefined}
            className={cn(
              'flex cursor-pointer gap-3 border-t border-border/60 px-[18px] py-3 transition-colors first:border-t-0 hover:bg-foreground/[0.04]',
              selected && 'bg-primary/[0.09] hover:bg-primary/[0.12]',
            )}
          >
            <div className="flex h-14 w-20 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-secondary text-muted-foreground">
              {r.cover_image ? (
                <img
                  src={r.cover_image.url}
                  alt=""
                  loading="lazy"
                  decoding="async"
                  className="h-full w-full object-cover"
                />
              ) : (
                <ImageOff size={18} aria-hidden="true" />
              )}
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
                <span className="font-semibold uppercase tracking-[0.04em]">
                  {CATEGORY_LABEL[r.category] ?? r.category}
                </span>
                <span aria-hidden="true">·</span>
                <span className="tabular-nums">{formatDateTime(r.created_at)}</span>
              </div>
              <RowLink
                to={to}
                onClick={(e) => {
                  if (onOpen && r.id !== selectedId) {
                    e.preventDefault();
                    onOpen(to);
                  }
                }}
                className="mt-0.5 line-clamp-2 block text-sm leading-snug"
              >
                {r.title}
              </RowLink>
              {chips.length > 0 && (
                <div className="mt-1.5 flex flex-wrap gap-1">
                  {chips.map((c) => (
                    <Badge key={c.label} variant={c.tone} size="sm">
                      {c.label}
                    </Badge>
                  ))}
                </div>
              )}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
