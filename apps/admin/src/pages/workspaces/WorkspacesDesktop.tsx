import type { JSX } from 'react';
import { useNavigate } from 'react-router-dom';
import { PageHeader } from '../../components/PageHeader';
import { GlassPanel } from '../../components/shell/GlassPanel';
import { workspaceDetailPath } from '../../lib/routes';
import type { ColumnPrefs } from '../workspaces-columns';
import { WorkspacesFilterChips } from './WorkspacesFilterChips';
import { WorkspacesListState } from './WorkspacesListState';
import { WorkspacesPagination } from './WorkspacesPagination';
import { WorkspacesTable, WorkspacesTableSkeleton } from './WorkspacesTable';
import { WorkspacesToolbar } from './WorkspacesToolbar';
import type { WorkspacesViewProps } from './view-props';

interface WorkspacesDesktopProps extends WorkspacesViewProps {
  prefs: ColumnPrefs;
  onPrefs: (prefs: ColumnPrefs) => void;
  onExport: () => void;
  exporting: boolean;
}

export function WorkspacesDesktop({
  params,
  set,
  reset,
  plans,
  workspaces,
  total,
  filtered,
  state,
  fetching,
  onRetry,
  onSort,
  now,
  headerDescription,
  prefs,
  onPrefs,
  onExport,
  exporting,
}: WorkspacesDesktopProps) {
  const navigate = useNavigate();

  let body: JSX.Element;
  if (state === 'pending') {
    body = <WorkspacesTableSkeleton visible={prefs.visible} />;
  } else if (state === 'error' || workspaces.length === 0) {
    body = (
      <WorkspacesListState
        kind={state === 'error' ? 'error' : 'empty'}
        total={total ?? 0}
        filtered={filtered}
        onRetry={onRetry}
        onFirstPage={() => set({ pag: 1 })}
        onClearFilters={reset}
      />
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
          now={now}
          busy={fetching}
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
        onExport={onExport}
        exporting={exporting}
      />
      <WorkspacesFilterChips
        params={params}
        plans={plans}
        total={total}
        onChange={set}
        onClear={reset}
      />
      <GlassPanel flush>{body}</GlassPanel>
    </div>
  );
}
