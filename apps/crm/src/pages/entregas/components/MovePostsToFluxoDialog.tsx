import { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { mapEntitlementError, entitlementMessage } from '@/lib/entitlement-errors';
import {
  getWorkflows,
  movePostsToNewFlow,
  movePostsToExistingFlow,
  type Workflow,
  type WorkflowEtapa,
} from '../../../store';

type Destino = 'novo' | 'existente';

interface MovePostsToFluxoDialogProps {
  open: boolean;
  onClose: () => void;
  postIds: number[];
  sourceWorkflow: Workflow;
  sourceEtapas: WorkflowEtapa[];
  /** True when postIds covers every post currently in the source flow -- only
   *  then does archiving the emptied source make sense, so only then does the
   *  dialog offer the checkbox (same rule as the detach confirm). */
  isTotalSelection: boolean;
  /** Fires after a successful move (posts re-parented + caches invalidated) so
   *  the caller can open the target flow's drawer. */
  onMoved: (targetWorkflowId: number, archived: boolean) => void;
}

/** Eligible "fluxo existente" targets: the client's other ACTIVE flows sharing
 *  the source's template. Template equality is strict and non-null -- a source
 *  without a template has no "same model" siblings by definition (the RPC
 *  enforces the same rule with workflow_template_mismatch). */
export function filterMoveTargets(workflows: Workflow[], source: Workflow): Workflow[] {
  if (source.template_id == null) return [];
  return workflows
    .filter(
      (w) =>
        w.status === 'ativo' &&
        w.cliente_id === source.cliente_id &&
        w.id !== source.id &&
        w.template_id === source.template_id,
    )
    .sort((a, b) => a.titulo.localeCompare(b.titulo));
}

function getErrorIdentifier(err: unknown): string {
  if (err && typeof err === 'object' && 'message' in err) {
    const message = (err as { message?: unknown }).message;
    if (typeof message === 'string') return message;
  }
  return '';
}

/** Maps move_posts_to_new_flow / move_posts_to_existing_flow identifier-style
 *  RPC errors (see supabase/migrations/20260901110000_move_posts_between_flows.sql)
 *  to PT copy. Plan-limit errors go through the house entitlement wording
 *  first -- both max_posts_per_workflow and max_active_workflows_per_client
 *  can surface here. */
export function getMoveErrorToast(err: unknown): string {
  const entitlement = mapEntitlementError(err);
  if (entitlement) return entitlementMessage(entitlement);
  const identifier = getErrorIdentifier(err);
  if (identifier === 'workflow_not_found') {
    return 'Fluxo de destino não encontrado.';
  }
  if (identifier === 'workflow_not_active') {
    return 'O fluxo de destino não está mais ativo.';
  }
  if (identifier === 'workflow_different_client') {
    return 'O fluxo de destino pertence a outro cliente.';
  }
  if (identifier === 'workflow_template_mismatch') {
    return 'O fluxo de destino precisa usar o mesmo modelo do fluxo atual.';
  }
  if (identifier === 'post_not_found') {
    return 'Um ou mais posts não foram encontrados.';
  }
  if (
    identifier === 'post_not_in_source_flow' ||
    identifier === 'post_not_in_flow' ||
    identifier === 'posts_in_multiple_flows'
  ) {
    return 'Os posts selecionados precisam estar todos neste fluxo.';
  }
  if (identifier === 'invalid_start_etapa') {
    return 'Escolha uma etapa válida para o novo fluxo.';
  }
  if (identifier === 'titulo_required') {
    return 'Informe um nome para o novo fluxo.';
  }
  return 'Erro ao mover posts para outro fluxo';
}

/** Moves a batch of posts out of their flow into another one: a NEW flow
 *  cloned from the source (user names it and picks the starting etapa) or an
 *  EXISTING active flow of the same client and template. The fluxo list reuses
 *  the ['workflows'] cache, same as AttachToFluxoDialog. */
export function MovePostsToFluxoDialog({
  open,
  onClose,
  postIds,
  sourceWorkflow,
  sourceEtapas,
  isTotalSelection,
  onMoved,
}: MovePostsToFluxoDialogProps) {
  const qc = useQueryClient();
  const sourceWorkflowId = sourceWorkflow.id!;
  const clienteId = sourceWorkflow.cliente_id;

  const orderedEtapas = useMemo(
    () => [...sourceEtapas].sort((a, b) => a.ordem - b.ordem),
    [sourceEtapas],
  );
  const defaultStartOrdem =
    orderedEtapas.find((e) => e.status === 'ativo')?.ordem ?? orderedEtapas[0]?.ordem ?? 0;

  const [destino, setDestino] = useState<Destino>('novo');
  const [titulo, setTitulo] = useState('');
  const [startOrdem, setStartOrdem] = useState<number>(defaultStartOrdem);
  const [selectedTargetId, setSelectedTargetId] = useState<number | null>(null);
  const [archiveEmptyFlow, setArchiveEmptyFlow] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setDestino('novo');
      setTitulo(`${sourceWorkflow.titulo} (continuação)`);
      setStartOrdem(defaultStartOrdem);
      setSelectedTargetId(null);
      setArchiveEmptyFlow(false);
    }
    // defaultStartOrdem/titulo are derived from the (stable-while-open) source
    // card; re-seeding only on open keeps user edits from being clobbered.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const { data: workflows = [] } = useQuery({
    queryKey: ['workflows'],
    queryFn: getWorkflows,
    enabled: open && destino === 'existente',
  });
  const targetFluxos = useMemo(
    () => filterMoveTargets(workflows, sourceWorkflow),
    [workflows, sourceWorkflow],
  );

  const canConfirm =
    !saving && (destino === 'novo' ? titulo.trim().length > 0 : selectedTargetId != null);

  const handleConfirm = async () => {
    if (!canConfirm) return;
    const archive = isTotalSelection && archiveEmptyFlow;
    setSaving(true);
    try {
      const result =
        destino === 'novo'
          ? await movePostsToNewFlow(postIds, sourceWorkflowId, {
              titulo: titulo.trim(),
              startOrdem,
              archiveEmptyFlow: archive,
            })
          : await movePostsToExistingFlow(postIds, sourceWorkflowId, selectedTargetId!, archive);
      const n = result.moved;
      const targetTitulo =
        destino === 'novo'
          ? titulo.trim()
          : (targetFluxos.find((w) => w.id === selectedTargetId)?.titulo ?? '');
      toast.success(
        `${n} post${n === 1 ? '' : 's'} movido${n === 1 ? '' : 's'} para "${targetTitulo}"`,
      );
      qc.invalidateQueries({ queryKey: ['active-posts'] });
      qc.invalidateQueries({ queryKey: ['workflow-posts-with-props', sourceWorkflowId] });
      qc.invalidateQueries({ queryKey: ['workflow-posts-with-props', result.target_workflow_id] });
      qc.invalidateQueries({ queryKey: ['workflow-posts-counts'] });
      qc.invalidateQueries({ queryKey: ['workflow-approved-posts-counts'] });
      qc.invalidateQueries({ queryKey: ['workflow-cleared-cliente-counts'] });
      qc.invalidateQueries({ queryKey: ['workflow-revisao-interna-counts'] });
      qc.invalidateQueries({ queryKey: ['workflow-awaiting-cliente-counts'] });
      qc.invalidateQueries({ queryKey: ['clientePosts', clienteId] });
      qc.invalidateQueries({ queryKey: ['workflows'] });
      qc.invalidateQueries({ queryKey: ['all-active-etapas'] });
      qc.invalidateQueries({ queryKey: ['workflow-covers'] });
      qc.invalidateQueries({ queryKey: ['workflow-post-responsaveis'] });
      qc.invalidateQueries({ queryKey: ['workflow-events', sourceWorkflowId] });
      onMoved(result.target_workflow_id, result.archived_workflow_ids.length > 0);
      onClose();
    } catch (err) {
      toast.error(getMoveErrorToast(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle>Mover para outro fluxo</DialogTitle>
          <DialogDescription className="sr-only">
            Mova os posts selecionados para um novo fluxo ou para um fluxo existente do mesmo modelo
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <label className="flex items-center gap-2 text-sm font-medium cursor-pointer">
              <input
                type="radio"
                name="move-destino"
                value="novo"
                checked={destino === 'novo'}
                onChange={() => setDestino('novo')}
              />
              Novo fluxo
            </label>
            <div className="ml-6 flex flex-col gap-2">
              <Input
                value={titulo}
                onChange={(e) => setTitulo(e.target.value)}
                placeholder="Nome do novo fluxo"
                disabled={destino !== 'novo'}
                aria-label="Nome do novo fluxo"
              />
              <div className="flex flex-col gap-1">
                <Select
                  value={String(startOrdem)}
                  onValueChange={(v) => setStartOrdem(parseInt(v, 10))}
                  disabled={destino !== 'novo'}
                >
                  <SelectTrigger aria-label="Começar na etapa">
                    <SelectValue placeholder="Começar na etapa" />
                  </SelectTrigger>
                  <SelectContent>
                    {orderedEtapas.map((e) => (
                      <SelectItem key={e.ordem} value={String(e.ordem)}>
                        {e.nome}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                  Etapas anteriores entram como concluídas.
                </p>
              </div>
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <label className="flex items-center gap-2 text-sm font-medium cursor-pointer">
              <input
                type="radio"
                name="move-destino"
                value="existente"
                checked={destino === 'existente'}
                onChange={() => setDestino('existente')}
                disabled={sourceWorkflow.template_id == null}
              />
              Fluxo existente
            </label>
            <div className="ml-6">
              {sourceWorkflow.template_id == null ? (
                <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
                  Este fluxo não usa um modelo. Para mover os posts, crie um novo fluxo.
                </p>
              ) : destino === 'existente' && targetFluxos.length === 0 ? (
                <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
                  Nenhum outro fluxo ativo com o mesmo modelo para este cliente.
                </p>
              ) : destino === 'existente' ? (
                <div className="flex flex-col gap-2 max-h-48 overflow-y-auto">
                  {targetFluxos.map((w) => (
                    <label
                      key={w.id}
                      className="flex items-center gap-2 rounded-md border border-input px-3 py-2 text-sm cursor-pointer"
                    >
                      <input
                        type="radio"
                        name="move-target-fluxo"
                        value={w.id}
                        checked={selectedTargetId === w.id}
                        onChange={() => setSelectedTargetId(w.id!)}
                      />
                      {w.titulo}
                    </label>
                  ))}
                </div>
              ) : null}
            </div>
          </div>

          {isTotalSelection && (
            <div className="flex items-center gap-2">
              <Checkbox
                id="move-archive-empty-flow"
                checked={archiveEmptyFlow}
                onCheckedChange={(checked) => setArchiveEmptyFlow(checked === true)}
                aria-label="Arquivar o fluxo de origem depois de mover"
              />
              <Label htmlFor="move-archive-empty-flow">
                Arquivar o fluxo de origem depois de mover
              </Label>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose} disabled={saving}>
            Cancelar
          </Button>
          <Button type="button" onClick={handleConfirm} disabled={!canConfirm}>
            {saving ? 'Movendo...' : 'Mover'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
