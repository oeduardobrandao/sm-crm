import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  listSavedViews,
  removeSavedView,
  renameSavedView,
  saveSavedView,
  updateSavedViewQuery,
  type EntregasSavedView,
} from '@/store/savedViews';
import { importLegacySavedViews, UNKNOWN_CONTA } from '../savedViews';

/** Stable while the query has not resolved (same reason as useActivePosts). */
const EMPTY: EntregasSavedView[] = [];

export const savedViewsKey = (contaId: string) => ['entregas-saved-views', contaId] as const;

/** Lists the server rows, importing this browser's localStorage views first
 * (once per workspace), so the first render already includes them. An import
 * failure does not block the list: the marker stays unset and the next load
 * retries. */
async function fetchSavedViews(contaId: string): Promise<EntregasSavedView[]> {
  const rows = await listSavedViews(contaId);
  try {
    if (await importLegacySavedViews(contaId, rows)) return listSavedViews(contaId);
  } catch (err) {
    console.warn('[entregas] saved views import failed', err);
  }
  return rows;
}

/**
 * The current user's saved Entregas views in workspace `contaId`. Disabled
 * while contaId is the 'unknown' fallback. Mutations update the cache in place
 * (optimistically where the result is known up front) and roll back on error;
 * the caller shows the error toast.
 */
export function useSavedViews(contaId: string) {
  const qc = useQueryClient();
  const enabled = !!contaId && contaId !== UNKNOWN_CONTA;
  const key = savedViewsKey(contaId);

  const query = useQuery({
    queryKey: key,
    queryFn: () => fetchSavedViews(contaId),
    enabled,
    staleTime: 60_000,
  });

  const snapshot = () => qc.getQueryData<EntregasSavedView[]>(key) ?? [];
  const write = (rows: EntregasSavedView[]) => qc.setQueryData(key, rows);
  // After any failure the cache may disagree with the server (a racing tab, a
  // half-done rename): re-list instead of trusting the rollback alone.
  const resync = () => qc.invalidateQueries({ queryKey: key });

  const save = useMutation({
    mutationFn: (v: { name: string; query: string }) => {
      const position = snapshot().reduce((max, r) => Math.max(max, r.position + 1), 0);
      return saveSavedView(contaId, { ...v, position });
    },
    onSuccess: (row) => {
      // Same name = same row (the upsert kept its id); it moves to the end.
      write([...snapshot().filter((r) => r.id !== row.id && r.name !== row.name), row]);
    },
    onError: resync,
  });

  const updateQuery = useMutation({
    mutationFn: (v: { id: string; query: string }) => updateSavedViewQuery(v.id, v.query),
    onMutate: (v) => {
      const prev = snapshot();
      write(prev.map((r) => (r.id === v.id ? { ...r, query: v.query } : r)));
      return { prev };
    },
    onError: (_e, _v, ctx) => {
      if (ctx) write(ctx.prev);
      void resync();
    },
  });

  const rename = useMutation({
    mutationFn: (v: { id: string; name: string; replaceId: string | null }) =>
      renameSavedView(v.id, v.name, v.replaceId),
    onMutate: (v) => {
      const prev = snapshot();
      write(
        prev
          .filter((r) => r.id !== v.replaceId || r.id === v.id)
          .map((r) => (r.id === v.id ? { ...r, name: v.name } : r)),
      );
      return { prev };
    },
    onError: (_e, _v, ctx) => {
      if (ctx) write(ctx.prev);
      void resync();
    },
  });

  const remove = useMutation({
    mutationFn: (id: string) => removeSavedView(id),
    onMutate: (id) => {
      const prev = snapshot();
      write(prev.filter((r) => r.id !== id));
      return { prev };
    },
    onError: (_e, _id, ctx) => {
      if (ctx) write(ctx.prev);
      void resync();
    },
  });

  return {
    views: query.data ?? EMPTY,
    /** True until the first list arrives, including while contaId is unknown. */
    isLoading: !enabled || query.isPending,
    /** Only a failed first load; a failed background refetch keeps the tabs. */
    isError: query.isLoadingError,
    save: save.mutateAsync,
    updateQuery: updateQuery.mutateAsync,
    rename: rename.mutateAsync,
    remove: remove.mutateAsync,
  };
}
