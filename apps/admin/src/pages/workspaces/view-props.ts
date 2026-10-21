import type { Plan, WorkspaceSortKey, WorkspaceSummary } from '../../lib/api';
import type { WorkspacesListParams } from '../workspaces-params';

/** What WorkspacesPage hands to its desktop and phone views. The page owns every query. */
export interface WorkspacesViewProps {
  params: WorkspacesListParams;
  set: (patch: Partial<WorkspacesListParams>, opts?: { replace?: boolean }) => void;
  reset: () => void;
  plans: Plan[];
  workspaces: WorkspaceSummary[];
  /** Rows matching the current filters across all pages; undefined until the first load. */
  total: number | undefined;
  filtered: boolean;
  /** `pending`: first load; `error`: the fetch failed; `ready`: data (possibly empty). */
  state: 'pending' | 'error' | 'ready';
  /** A refetch is in flight; the previous rows stay on screen, dimmed. */
  fetching: boolean;
  onRetry: () => void;
  onSort: (key: WorkspaceSortKey) => void;
  /** Display clock for the activity labels. */
  now: Date;
  headerDescription: string;
}
