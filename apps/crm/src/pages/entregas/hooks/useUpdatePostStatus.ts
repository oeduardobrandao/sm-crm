import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { updateWorkflowPost, type ActivePost, type WorkflowPost } from '../../../store';
import { statusKeyToPatch, type StatusKey } from '../statusRegistry';

export interface UpdatePostStatusVars {
  id: number;
  /** Owning workflow, so onSettled can also invalidate that workflow's own
   *  drawer query. Always present today; posts avulsos will make this
   *  nullable, hence the `!= null` guard in onSettled rather than a bare check. */
  workflowId: number | null;
  key: StatusKey;
  /** Canonical status `key` resolves to — the optimistic patch's `status`
   *  field, mirroring what the DB trigger forces for a custom pointer. */
  canonical: WorkflowPost['status'];
}

const ACTIVE_POSTS_KEY = ['active-posts'] as const;

/**
 * Drives a post's status write from drag-and-drop on the Publicações kanban
 * (and anywhere else that wants a status change without opening the drawer).
 *
 * Optimistic: the card jumps to its target column immediately, off a snapshot
 * of `['active-posts']` — the one query every Publicações surface reads — and
 * rolls back on failure. The write itself mirrors WorkflowDrawer's plain
 * status write (`statusKeyToPatch` sends only the pointer for a custom key;
 * the DB trigger forces `status` to the definition's `behaves_as`), but that
 * write alone would leave the UI showing the old column until the refetch
 * lands, hence the cache patch here.
 */
export function useUpdatePostStatus() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: ({ id, key }: UpdatePostStatusVars) =>
      updateWorkflowPost(id, statusKeyToPatch(key)),

    onMutate: async ({ id, key, canonical }: UpdatePostStatusVars) => {
      await qc.cancelQueries({ queryKey: ACTIVE_POSTS_KEY });
      const previous = qc.getQueryData<ActivePost[]>(ACTIVE_POSTS_KEY);
      const patch = { ...statusKeyToPatch(key), status: canonical };
      qc.setQueryData<ActivePost[]>(ACTIVE_POSTS_KEY, (old) =>
        (old ?? []).map((p) => (p.id === id ? { ...p, ...patch } : p)),
      );
      return { previous };
    },

    onError: (_err, _vars, context) => {
      if (context?.previous) qc.setQueryData(ACTIVE_POSTS_KEY, context.previous);
      toast.error('Erro ao atualizar status');
    },

    onSettled: (_data, _err, vars: UpdatePostStatusVars) => {
      qc.invalidateQueries({ queryKey: ACTIVE_POSTS_KEY });
      if (vars.workflowId != null) {
        qc.invalidateQueries({ queryKey: ['workflow-posts-with-props', vars.workflowId] });
      }
      qc.invalidateQueries({ queryKey: ['workflow-posts-counts'] });
      qc.invalidateQueries({ queryKey: ['workflow-approved-posts-counts'] });
      qc.invalidateQueries({ queryKey: ['workflow-cleared-cliente-counts'] });
      qc.invalidateQueries({ queryKey: ['workflow-revisao-interna-counts'] });
      qc.invalidateQueries({ queryKey: ['workflow-awaiting-cliente-counts'] });
    },
  });
}
