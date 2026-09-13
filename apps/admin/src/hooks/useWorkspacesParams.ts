// apps/admin/src/hooks/useWorkspacesParams.ts
import { useCallback, useMemo, useRef } from 'react';
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

  // react-router's `setSearchParams` updater form still resolves `prev` from the hook's
  // own render-time closure (see useSearchParams in react-router), so it does NOT advance
  // between two synchronous set() calls in the same tick -- both would read the same stale
  // snapshot and the second call would silently discard the first. This ref tracks the
  // latest composed params synchronously so each set() call builds on the previous one.
  const paramsRef = useRef(params);
  paramsRef.current = params;

  const set = useCallback(
    (patch: Partial<WorkspacesListParams>, opts?: { replace?: boolean }) => {
      const touchesFilterOrSize = Object.keys(patch).some((k) => !KEEP_PAGE_KEYS.has(k));
      // Typing in the search box rewrites the URL on every debounce tick; those must not
      // pile up in history. Everything else is a deliberate navigation.
      const replace = opts?.replace ?? ('q' in patch && Object.keys(patch).length === 1);
      const next: WorkspacesListParams = { ...paramsRef.current, ...patch };
      if (touchesFilterOrSize && patch.pag === undefined) next.pag = 1;
      paramsRef.current = next;
      setSearchParams(serializeWorkspacesParams(next), { replace });
    },
    [setSearchParams],
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
