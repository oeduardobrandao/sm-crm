import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { getWorkflows, attachPostToWorkflow } from '../../../store';

interface AttachToFluxoDialogProps {
  open: boolean;
  onClose: () => void;
  postId: number;
  clienteId: number;
  /** Fires after a successful attach (post already re-parented + caches
   *  invalidated), so the caller can open the target WorkflowDrawer at this
   *  post and close whatever standalone surface had it open. */
  onAttached: (workflowId: number, postId: number) => void;
}

function getErrorIdentifier(err: unknown): string {
  if (err && typeof err === 'object' && 'message' in err) {
    const message = (err as { message?: unknown }).message;
    if (typeof message === 'string') return message;
  }
  return '';
}

/** Maps attach_posts_to_flow's identifier-style RPC errors (see
 *  supabase/migrations/20260830000004_post_detach_attach_rpcs.sql) to PT
 *  copy. The dialog's own fluxo list already filters to active fluxos of the
 *  post's client, so `workflow_not_active` and `post_belongs_to_another_client`
 *  should only ever surface from a stale cache racing a concurrent change --
 *  still handled here rather than left to the generic fallback. */
function getAttachErrorToast(err: unknown): string {
  const identifier = getErrorIdentifier(err);
  if (identifier === 'workflow_not_active') {
    return 'Este fluxo não está mais ativo. Escolha outro fluxo.';
  }
  if (identifier === 'post_belongs_to_another_client') {
    return 'Este post pertence a outro cliente.';
  }
  if (identifier === 'plan_limit_exceeded:max_posts_per_workflow') {
    return 'Limite de posts por fluxo do plano atual atingido.';
  }
  return 'Erro ao vincular post ao fluxo';
}

/** Attaches a post avulso to one of the client's own active fluxos. The fluxo
 *  list reuses the ['workflows'] cache getWorkflows() already seeds elsewhere
 *  (useGuideSignals, GlobalSearchTrigger, CalendarioPage, useEntregasData) --
 *  filtered client-side to this post's cliente_id and status 'ativo', so
 *  opening this dialog is a cache hit whenever any of those already loaded. */
export function AttachToFluxoDialog({
  open,
  onClose,
  postId,
  clienteId,
  onAttached,
}: AttachToFluxoDialogProps) {
  const qc = useQueryClient();
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);

  const { data: workflows = [] } = useQuery({
    queryKey: ['workflows'],
    queryFn: getWorkflows,
    enabled: open,
  });

  useEffect(() => {
    if (open) setSelectedId(null);
  }, [open]);

  const activeFluxos = workflows
    .filter((w) => w.status === 'ativo' && w.cliente_id === clienteId)
    .sort((a, b) => a.titulo.localeCompare(b.titulo));

  const handleConfirm = async () => {
    if (selectedId == null) return;
    const workflow = activeFluxos.find((w) => w.id === selectedId);
    if (!workflow) return;
    setSaving(true);
    try {
      await attachPostToWorkflow(postId, selectedId);
      toast.success(`Post vinculado a "${workflow.titulo}"`);
      qc.invalidateQueries({ queryKey: ['active-posts'] });
      qc.invalidateQueries({ queryKey: ['workflow-posts-with-props', selectedId] });
      qc.invalidateQueries({ queryKey: ['workflow-posts-counts'] });
      // The board's per-workflow status counts (kanban column headers) read the
      // post's new workflow too -- without these the target fluxo's counts stay
      // stale until some other action happens to invalidate them.
      qc.invalidateQueries({ queryKey: ['workflow-approved-posts-counts'] });
      qc.invalidateQueries({ queryKey: ['workflow-cleared-cliente-counts'] });
      qc.invalidateQueries({ queryKey: ['workflow-revisao-interna-counts'] });
      qc.invalidateQueries({ queryKey: ['workflow-awaiting-cliente-counts'] });
      qc.invalidateQueries({ queryKey: ['clientePosts', clienteId] });
      onAttached(selectedId, postId);
      onClose();
    } catch (err) {
      toast.error(getAttachErrorToast(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-[420px]">
        <DialogHeader>
          <DialogTitle>Vincular a um fluxo</DialogTitle>
          <DialogDescription className="sr-only">
            Escolha um fluxo ativo deste cliente para anexar o post
          </DialogDescription>
        </DialogHeader>
        {activeFluxos.length === 0 ? (
          <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
            Nenhum fluxo ativo para este cliente
          </p>
        ) : (
          <div className="flex flex-col gap-2 max-h-72 overflow-y-auto">
            {activeFluxos.map((w) => (
              <label
                key={w.id}
                className="flex items-center gap-2 rounded-md border border-input px-3 py-2 text-sm cursor-pointer"
              >
                <input
                  type="radio"
                  name="attach-fluxo"
                  value={w.id}
                  checked={selectedId === w.id}
                  onChange={() => setSelectedId(w.id!)}
                />
                {w.titulo}
              </label>
            ))}
          </div>
        )}
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose} disabled={saving}>
            Cancelar
          </Button>
          <Button type="button" onClick={handleConfirm} disabled={saving || selectedId == null}>
            {saving ? 'Vinculando...' : 'Vincular'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
