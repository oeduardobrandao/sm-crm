import { useCallback, useMemo, useState } from 'react';
import type { JSX } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { Building2 } from 'lucide-react';
import { toast } from 'sonner';
import {
  listPlans,
  listWorkspaces,
  type WorkspaceSortKey,
  type WorkspaceSummary,
} from '../lib/api';
import { downloadCSV, toCSV } from '../lib/csv-export';
import { Button } from '../components/ui/button';
import { Card } from '../components/ui/card';
import { EmptyState } from '../components/EmptyState';
import { ErrorState } from '../components/ErrorState';
import { PageHeader } from '../components/PageHeader';
import { useWorkspacesParams } from '../hooks/useWorkspacesParams';
import { WorkspacesFilterChips } from './workspaces/WorkspacesFilterChips';
import { WorkspacesPagination } from './workspaces/WorkspacesPagination';
import { WorkspacesTable, WorkspacesTableSkeleton } from './workspaces/WorkspacesTable';
import { readColumnPrefs, writeColumnPrefs, type ColumnPrefs } from './workspaces-columns';
import { WORKSPACE_EXPORT_COLUMNS, buildWorkspaceExportRows } from './workspaces-export';
import { hasActiveFilters, nextSort, toListWorkspacesRequest } from './workspaces-params';
import { WorkspacesToolbar } from './workspaces/WorkspacesToolbar';
import { workspaceDetailPath } from '../lib/routes';

const EXPORT_PAGE_SIZE = 200;
const EXPORT_MAX_ROWS = 2000;

export default function WorkspacesPage() {
  const navigate = useNavigate();
  const { params, set, reset } = useWorkspacesParams();
  const [prefs, setPrefs] = useState<ColumnPrefs>(() => readColumnPrefs());
  const [exporting, setExporting] = useState(false);

  // The clock is pinned when the "criado" preset changes, not on every params change:
  // paging or sorting must not move the created_since cutoff, or a signup mid-browse
  // shifts every rank and the offset window skips or repeats a row. It stays fixed until
  // the user picks a preset again (the same freeze the CSV export gets from as_of).
  const now = useMemo(() => new Date(), [params.criado]); // eslint-disable-line react-hooks/exhaustive-deps
  const request = useMemo(() => toListWorkspacesRequest(params, now), [params, now]);
  // Display clock for the activity labels: refreshed whenever a fetch lands, so a long
  // session keeps "há N dias" honest while the created_since cutoff above stays pinned.

  const list = useQuery({
    queryKey: ['admin', 'workspaces', request],
    queryFn: () => listWorkspaces(request),
    placeholderData: keepPreviousData,
  });
  const displayNow = useMemo(() => new Date(), [list.dataUpdatedAt]); // eslint-disable-line react-hooks/exhaustive-deps

  const plansQuery = useQuery({ queryKey: ['admin', 'plans'], queryFn: listPlans });
  const plans = plansQuery.data?.plans ?? [];

  const onPrefs = useCallback((next: ColumnPrefs) => {
    setPrefs(next);
    writeColumnPrefs(next);
  }, []);

  const onSort = useCallback((key: WorkspaceSortKey) => set(nextSort(params, key)), [params, set]);

  async function handleExportCsv() {
    setExporting(true);
    try {
      // Freeze the set to this instant so signups mid-export can't shift rows across pages.
      const asOf = new Date().toISOString();
      const all: WorkspaceSummary[] = [];
      let total = Infinity;
      for (let offset = 0; offset < Math.min(total, EXPORT_MAX_ROWS); offset += EXPORT_PAGE_SIZE) {
        const page = await listWorkspaces({
          ...request,
          offset,
          limit: EXPORT_PAGE_SIZE,
          as_of: asOf,
        });
        total = page.total;
        all.push(...page.workspaces);
      }
      if (all.length === 0) {
        toast.error('Nada para exportar');
        return;
      }
      const rows = all.slice(0, EXPORT_MAX_ROWS);
      downloadCSV(
        `workspaces-${new Date().toISOString().slice(0, 10)}.csv`,
        toCSV(buildWorkspaceExportRows(rows), WORKSPACE_EXPORT_COLUMNS),
      );
      if (total > EXPORT_MAX_ROWS) {
        toast.warning(
          `Exportados os primeiros ${EXPORT_MAX_ROWS} de ${total} workspaces. Refine os filtros para exportar o restante.`,
        );
      }
    } catch (err) {
      // The toast stays generic; the console line is what makes a failed export diagnosable.
      console.error('[admin] export CSV failed', err);
      toast.error('Falha ao exportar');
    } finally {
      setExporting(false);
    }
  }

  const total = list.data?.total;
  const workspaces = list.data?.workspaces ?? [];
  const filtered = hasActiveFilters(params);

  // Under active filters `total` is the FILTERED count, so spelling it out here would read as
  // "cadastrados no total". The chips row already reports the filtered count as "N resultados".
  const headerDescription =
    filtered || total === undefined
      ? 'Todos os workspaces cadastrados'
      : total === 1
        ? '1 workspace cadastrado'
        : `${total} workspaces cadastrados`;

  let body: JSX.Element;
  if (list.isPending) {
    body = <WorkspacesTableSkeleton visible={prefs.visible} />;
  } else if (list.isError) {
    body = (
      <ErrorState
        message="Não foi possível carregar os workspaces."
        onRetry={() => list.refetch()}
      />
    );
  } else if (workspaces.length === 0) {
    // Zero rows with a non-zero total means the requested page is past the end of the result
    // set -- nothing clamps `pag` against the page count, and both "nenhum workspace" states
    // would be a dead end here, since neither offers a way back to a page that has rows.
    body =
      (total ?? 0) > 0 ? (
        <EmptyState
          icon={Building2}
          title="Página fora do intervalo"
          description="Esta página não existe mais para os filtros atuais."
          action={
            <Button variant="outline" size="sm" onClick={() => set({ pag: 1 })}>
              Voltar à primeira página
            </Button>
          }
        />
      ) : filtered ? (
        <EmptyState
          icon={Building2}
          title="Nenhum workspace com esses filtros"
          description="Tente ampliar a busca ou remover um dos filtros ativos."
          action={
            <Button variant="outline" size="sm" onClick={reset}>
              Limpar filtros
            </Button>
          }
        />
      ) : (
        <EmptyState icon={Building2} title="Nenhum workspace cadastrado ainda." />
      );
  } else {
    body = (
      <>
        <WorkspacesTable
          workspaces={workspaces}
          visible={prefs.visible}
          density={prefs.density}
          sort={{ ord: params.ord, dir: params.dir }}
          onSort={onSort}
          onOpen={(id) => navigate(workspaceDetailPath(id))}
          now={displayNow}
          busy={list.isFetching}
        />
        <WorkspacesPagination
          total={total ?? 0}
          pag={params.pag}
          por={params.por}
          onPage={(pag) => set({ pag })}
          onPageSize={(por) => set({ por })}
        />
      </>
    );
  }

  return (
    <div>
      <PageHeader title="Workspaces" description={headerDescription} />
      <WorkspacesToolbar
        params={params}
        plans={plans}
        prefs={prefs}
        onChange={set}
        onPrefs={onPrefs}
        onExport={handleExportCsv}
        exporting={exporting}
      />
      <WorkspacesFilterChips
        params={params}
        plans={plans}
        total={total}
        onChange={set}
        onClear={reset}
      />
      <Card className="overflow-hidden">{body}</Card>
    </div>
  );
}
