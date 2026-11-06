import { Building2 } from 'lucide-react';
import { Button } from '../../components/ui/button';
import { EmptyState } from '../../components/EmptyState';
import { ErrorState } from '../../components/ErrorState';

interface WorkspacesListStateProps {
  /** `error` for a failed fetch; `empty` for a loaded list with no rows. */
  kind: 'error' | 'empty';
  /** Matching rows across all pages (a page past the end has rows elsewhere). */
  total: number;
  filtered: boolean;
  onRetry: () => void;
  onFirstPage: () => void;
  onClearFilters: () => void;
}

/** What replaces the rows when there are none to show. Shared by the desktop and phone lists. */
export function WorkspacesListState({
  kind,
  total,
  filtered,
  onRetry,
  onFirstPage,
  onClearFilters,
}: WorkspacesListStateProps) {
  if (kind === 'error') {
    return <ErrorState message="Não foi possível carregar os workspaces." onRetry={onRetry} />;
  }
  // Zero rows with a non-zero total means the requested page is past the end of the result
  // set -- nothing clamps `pag` against the page count, and both "nenhum workspace" states
  // would be a dead end here, since neither offers a way back to a page that has rows.
  if (total > 0) {
    return (
      <EmptyState
        icon={Building2}
        title="Página fora do intervalo"
        description="Esta página não existe mais para os filtros atuais."
        action={
          <Button variant="outline" size="sm" onClick={onFirstPage}>
            Voltar à primeira página
          </Button>
        }
      />
    );
  }
  if (filtered) {
    return (
      <EmptyState
        icon={Building2}
        title="Nenhum workspace com esses filtros"
        description="Tente ampliar a busca ou remover um dos filtros ativos."
        action={
          <Button variant="outline" size="sm" onClick={onClearFilters}>
            Limpar filtros
          </Button>
        }
      />
    );
  }
  return <EmptyState icon={Building2} title="Nenhum workspace cadastrado ainda." />;
}
