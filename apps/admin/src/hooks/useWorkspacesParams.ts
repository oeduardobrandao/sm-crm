// apps/admin/src/hooks/useWorkspacesParams.ts
import { useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  DEFAULT_PARAMS,
  FILTER_KEYS,
  parseWorkspacesParams,
  serializeWorkspacesParams,
  type WorkspacesListParams,
} from '../pages/workspaces-params';

/** Keys whose change does NOT send the user back to page 1. */
const KEEP_PAGE_KEYS: ReadonlySet<string> = new Set(['pag', 'ord', 'dir']);

export function useWorkspacesParams() {
  const [searchParams, setSearchParams] = useSearchParams();
  const params = useMemo(() => parseWorkspacesParams(searchParams), [searchParams]);

  const set = useCallback(
    (patch: Partial<WorkspacesListParams>, opts?: { replace?: boolean }) => {
      const next: WorkspacesListParams = { ...params, ...patch };
      const touchesFilterOrSize = Object.keys(patch).some((k) => !KEEP_PAGE_KEYS.has(k));
      if (touchesFilterOrSize && patch.pag === undefined) next.pag = 1;
      // Typing in the search box rewrites the URL on every debounce tick; those must not
      // pile up in history. Everything else is a deliberate navigation.
      const replace = opts?.replace ?? ('q' in patch && Object.keys(patch).length === 1);
      setSearchParams(serializeWorkspacesParams(next), { replace });
    },
    [params, setSearchParams],
  );

  const reset = useCallback(() => {
    const cleared: Partial<WorkspacesListParams> = { pag: 1 };
    FILTER_KEYS.forEach((key) => {
      (cleared as Record<string, unknown>)[key] = DEFAULT_PARAMS[key];
    });
    set(cleared);
  }, [set]);

  return { params, set, reset };
}
