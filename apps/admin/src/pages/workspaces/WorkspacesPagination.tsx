import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '../../components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../components/ui/select';
import { PAGE_SIZES, type PageSize } from '../workspaces-params';
import { pageWindow } from '../workspaces-pagination';

interface WorkspacesPaginationProps {
  total: number;
  pag: number;
  por: PageSize;
  onPage: (pag: number) => void;
  onPageSize: (por: PageSize) => void;
}

export function WorkspacesPagination({
  total,
  pag,
  por,
  onPage,
  onPageSize,
}: WorkspacesPaginationProps) {
  if (total === 0) return null;
  const totalPages = Math.max(1, Math.ceil(total / por));
  const current = Math.min(Math.max(1, pag), totalPages);
  const start = (current - 1) * por + 1;
  const end = Math.min(total, current * por);

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-4 py-2.5 text-xs text-muted-foreground">
      <div className="flex items-center gap-2">
        <span className="tabular-nums">
          {start}–{end} de {total}
        </span>
        <span aria-hidden>·</span>
        <Select value={String(por)} onValueChange={(v) => onPageSize(Number(v) as PageSize)}>
          <SelectTrigger className="h-7 w-[7.5rem] text-xs" aria-label="Itens por página">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {PAGE_SIZES.map((n) => (
              <SelectItem key={n} value={String(n)}>
                {n} por página
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {totalPages > 1 ? (
        <nav aria-label="Paginação" className="flex items-center gap-1">
          <Button
            variant="outline"
            size="icon"
            className="h-7 w-7"
            disabled={current <= 1}
            onClick={() => onPage(current - 1)}
            aria-label="Página anterior"
          >
            <ChevronLeft />
          </Button>
          {pageWindow(current, totalPages).map((p, i) =>
            p === 'gap' ? (
              <span key={`gap-${i}`} className="px-1">
                …
              </span>
            ) : (
              <Button
                key={p}
                variant={p === current ? 'ink' : 'outline'}
                size="sm"
                className="h-7 min-w-7 px-2 text-xs"
                aria-current={p === current ? 'page' : undefined}
                onClick={() => onPage(p)}
              >
                {p}
              </Button>
            ),
          )}
          <Button
            variant="outline"
            size="icon"
            className="h-7 w-7"
            disabled={current >= totalPages}
            onClick={() => onPage(current + 1)}
            aria-label="Próxima página"
          >
            <ChevronRight />
          </Button>
        </nav>
      ) : null}
    </div>
  );
}
