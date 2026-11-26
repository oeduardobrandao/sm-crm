import { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { useUnsavedWork } from '@mesaas/app-lifecycle';
import {
  getWorkspace,
  listPlans,
  setWorkspacePlan,
  unsetWorkspacePlan,
  endReverseTrial,
  resendDemoAccess,
  setWorkspaceOverrides,
  clearWorkspaceOverrides,
  listWorkspaceMcpKeys,
  revokeMcpKey,
  revokeAllMcpKeys,
  listWorkspaceOAuthGrants,
  revokeOAuthGrant,
  revokeAllOAuthGrants,
  listWorkspaceNotes,
  addWorkspaceNote,
  deleteWorkspaceNote,
  FEATURE_FLAG_KEYS,
} from '../lib/api';
import { computeOverridesPayload } from './workspace-overrides';
import { overrideCount, visibleConnections } from './workspace-detail-view';
import { ErrorState } from '../components/ErrorState';
import { Skeleton } from '../components/ui/skeleton';
import { useIsPhone } from '../hooks/useIsPhone';
import { WorkspaceDetailPhone } from './workspace-detail/WorkspaceDetailPhone';
import { WorkspaceDetailDesktop } from './workspace-detail/WorkspaceDetailDesktop';
import { OverridesSheets } from './workspace-detail/OverridesSheets';
import { ExtendTrialDialog } from './workspace-detail/ExtendTrialDialog';
import { DeleteWorkspaceDialog } from './workspace-detail/DeleteWorkspaceDialog';
import { isReverseTrial } from '../lib/reverse-trial';
import type { WorkspaceDetailViewProps } from './workspace-detail/types';

const DISCARD_EDITS_WARNING = 'Descartar as alterações não salvas?';
const COMP_TRIAL_WARNING =
  'Este workspace está no teste sem cartão. Mudar o plano encerra o teste agora (encerrado pelo admin) e aplica o plano escolhido como comp. Continuar?';
const END_TRIAL_WARNING =
  'Encerrar o teste sem cartão agora? O workspace volta ao Free na hora, sem pausa do Hub. Não dá para reiniciar o teste depois.';

type WorkspaceData = Awaited<ReturnType<typeof getWorkspace>>;

/** The editable copy of the resolved limits/features, seeded from the server response. */
function editsFrom(data: WorkspaceData) {
  const resources: Record<string, string> = {};
  for (const [k, v] of Object.entries(data.resolved_limits ?? {})) {
    resources[k] = v != null ? String(v) : '';
  }
  const features: Record<string, boolean> = { ...(data.resolved_features ?? {}) };
  return { resources, features };
}

function sameEdits<T>(a: Record<string, T>, b: Record<string, T>): boolean {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const k of keys) if (a[k] !== b[k]) return false;
  return true;
}

export default function WorkspaceDetailPage() {
  const { id } = useParams<{ id: string }>();
  const isPhone = useIsPhone();
  const queryClient = useQueryClient();

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['admin', 'workspace', id],
    queryFn: () => getWorkspace(id!),
    enabled: !!id,
  });

  const { data: plansData } = useQuery({
    queryKey: ['admin', 'plans'],
    queryFn: listPlans,
  });

  const { data: mcpKeysData } = useQuery({
    queryKey: ['admin', 'workspace', id, 'mcp-keys'],
    queryFn: () => listWorkspaceMcpKeys(id!),
    enabled: !!id,
  });
  const mcpKeys = mcpKeysData?.keys;
  const [showRevokedKeys, setShowRevokedKeys] = useState(false);

  const revokeMcpKeyMutation = useMutation({
    mutationFn: (keyId: string) => revokeMcpKey(id!, keyId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'workspace', id, 'mcp-keys'] });
      toast.success('Chave revogada');
    },
    onError: (e: unknown) => toast.error((e as Error).message),
  });
  const revokeAllMcpKeysMutation = useMutation({
    mutationFn: () => revokeAllMcpKeys(id!),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'workspace', id, 'mcp-keys'] });
      toast.success('Todas as chaves revogadas');
    },
    onError: (e: unknown) => toast.error((e as Error).message),
  });

  const notesQuery = useQuery({
    queryKey: ['admin', 'workspace', id, 'notes'],
    queryFn: () => listWorkspaceNotes(id!),
    enabled: !!id,
  });

  const { data: oauthGrantsData } = useQuery({
    queryKey: ['admin', 'workspace', id, 'oauth-grants'],
    queryFn: () => listWorkspaceOAuthGrants(id!),
    enabled: !!id,
  });
  const oauthGrants = oauthGrantsData?.grants;
  const [showRevokedGrants, setShowRevokedGrants] = useState(false);

  const revokeOAuthGrantMutation = useMutation({
    mutationFn: (grantId: string) => revokeOAuthGrant(id!, grantId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'workspace', id, 'oauth-grants'] });
      toast.success('Conexão revogada');
    },
    onError: (e: unknown) => toast.error((e as Error).message),
  });
  const revokeAllOAuthGrantsMutation = useMutation({
    mutationFn: () => revokeAllOAuthGrants(id!),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'workspace', id, 'oauth-grants'] });
      toast.success('Todas as conexões revogadas');
    },
    onError: (e: unknown) => toast.error((e as Error).message),
  });

  const [resourceEdits, setResourceEdits] = useState<Record<string, string>>({});
  const [featureEdits, setFeatureEdits] = useState<Record<string, boolean>>({});
  const [noteDraft, setNoteDraft] = useState('');
  const [selectedPlanId, setSelectedPlanId] = useState('');
  const [openPanel, setOpenPanel] = useState<'limits' | 'features' | null>(null);
  const [extendOpen, setExtendOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  useEffect(() => {
    if (data) {
      setSelectedPlanId(data.plan?.id || '');
      const edits = editsFrom(data);
      setResourceEdits(edits.resources);
      setFeatureEdits(edits.features);
    }
  }, [data]);

  const setPlanMutation = useMutation({
    mutationFn: (planId: string) => setWorkspacePlan(id!, planId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'workspace', id] });
      toast.success('Plano atualizado');
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const saveOverridesMutation = useMutation({
    mutationFn: () => {
      const plan = plansData?.plans?.find((p) => p.id === selectedPlanId);
      if (!plan) throw new Error('Nenhum plano selecionado');

      const { resource_overrides, feature_overrides } = computeOverridesPayload(
        plan,
        resourceEdits,
        featureEdits,
      );

      // Always send the objects, even when empty: an empty object clears a stale
      // override (e.g. a feature toggled back to the plan's own default), while
      // `undefined` tells the server to leave the existing override untouched.
      return setWorkspaceOverrides({
        workspace_id: id!,
        resource_overrides,
        feature_overrides,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'workspace', id] });
      setOpenPanel(null);
      toast.success('Overrides salvos');
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const addNoteMutation = useMutation({
    mutationFn: (body: string) => addWorkspaceNote(id!, body),
    onSuccess: () => {
      setNoteDraft('');
      queryClient.invalidateQueries({ queryKey: ['admin', 'workspace', id, 'notes'] });
      toast.success('Nota adicionada');
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const deleteNoteMutation = useMutation({
    mutationFn: (noteId: string) => deleteWorkspaceNote(noteId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'workspace', id, 'notes'] });
      toast.success('Nota excluída');
    },
    onError: (err: Error) => toast.error(err.message),
  });

  // Rascunho da nota ou envio em voo seguram a troca silenciosa de versão.
  useUnsavedWork(noteDraft.trim() !== '' || addNoteMutation.isPending);

  const clearMutation = useMutation({
    mutationFn: () => clearWorkspaceOverrides(id!),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'workspace', id] });
      setOpenPanel(null);
      toast.success('Overrides removidos');
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const unsetMutation = useMutation({
    mutationFn: () => unsetWorkspacePlan(id!),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'workspace', id] });
      toast.success(
        data?.workspace.plan_source === 'demo'
          ? 'Demo encerrada. Workspace volta à cobrança normal'
          : 'Comp removido. Workspace volta à cobrança normal',
      );
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const endTrialMutation = useMutation({
    mutationFn: () => endReverseTrial(id!),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'workspace', id] });
      queryClient.invalidateQueries({ queryKey: ['admin', 'workspaces'] });
      toast.success('Teste encerrado. Workspace voltou ao Free');
    },
    onError: (err: Error) => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'workspace', id] });
      toast.error(err.message);
    },
  });

  const resendMutation = useMutation({
    mutationFn: () => resendDemoAccess(id!),
    onSuccess: () => toast.success('Acesso reenviado'),
    onError: (err: Error) => toast.error(err.message),
  });

  if (isError) {
    return (
      <ErrorState message="Não foi possível carregar o workspace." onRetry={() => refetch()} />
    );
  }
  if (isLoading || !data) {
    return (
      <div className="flex flex-col gap-4">
        <Skeleton className="h-8 w-24" />
        <Skeleton className="h-12 w-72" />
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  const plans = plansData?.plans ?? [];
  const plan = plans.find((p) => p.id === selectedPlanId);

  const isOverridden = (key: string, type: 'resource' | 'feature') => {
    if (!data.override) return false;
    if (type === 'resource') return data.override.resource_overrides?.[key] !== undefined;
    return data.override.feature_overrides?.[key] !== undefined;
  };

  const initialEdits = editsFrom(data);
  const editsDirty =
    !sameEdits(resourceEdits, initialEdits.resources) ||
    !sameEdits(featureEdits, initialEdits.features);

  // Closing a panel discards its unsaved edits: both panels feed one save payload, so a
  // half-edited limit left behind would otherwise ride along on the next features save.
  /** True when the panel may close: nothing to lose, or the user confirmed discarding. */
  const confirmDiscard = () => !editsDirty || window.confirm(DISCARD_EDITS_WARNING);
  /** Resets both panels' edits (they share one save payload) and closes. */
  const discardAndClose = () => {
    setResourceEdits(initialEdits.resources);
    setFeatureEdits(initialEdits.features);
    setOpenPanel(null);
  };

  const keysView = visibleConnections(mcpKeys, showRevokedKeys);
  const grantsView = visibleConnections(oauthGrants, showRevokedGrants);

  const view: WorkspaceDetailViewProps = {
    workspaceId: id!,
    data,
    plans,
    plan,
    selectedPlanId,
    onPlanChange: (planId) => {
      // Confirm before touching the Select: cancelling must leave it on the current plan.
      if (isReverseTrial(data.workspace.plan_source) && !window.confirm(COMP_TRIAL_WARNING)) {
        return;
      }
      setSelectedPlanId(planId);
      setPlanMutation.mutate(planId);
    },
    onUnsetComp: () => unsetMutation.mutate(),
    unsetPending: unsetMutation.isPending,
    onExtendTrial: () => setExtendOpen(true),
    onEndTrial: () => {
      if (!endTrialMutation.isPending && window.confirm(END_TRIAL_WARNING)) {
        endTrialMutation.mutate();
      }
    },
    endTrialPending: endTrialMutation.isPending,
    onResendAccess: () => resendMutation.mutate(),
    resendPending: resendMutation.isPending,
    onDeleteWorkspace: () => setDeleteOpen(true),
    notes: {
      items: notesQuery.data?.notes,
      loadError: notesQuery.isError,
      draft: noteDraft,
      onDraftChange: setNoteDraft,
      onAdd: () => {
        const body = noteDraft.trim();
        if (body && !addNoteMutation.isPending) addNoteMutation.mutate(body);
      },
      addPending: addNoteMutation.isPending,
      onDelete: (noteId) => {
        if (window.confirm('Excluir esta nota? Ela some para todos os admins.')) {
          deleteNoteMutation.mutate(noteId);
        }
      },
      deletingId: deleteNoteMutation.isPending ? (deleteNoteMutation.variables ?? null) : null,
    },
    onOpenLimits: () => setOpenPanel('limits'),
    onOpenFeatures: () => setOpenPanel('features'),
    resourceOverrideCount: overrideCount(data.override?.resource_overrides),
    featureOverrideCount: overrideCount(data.override?.feature_overrides),
    activeFeatureCount: FEATURE_FLAG_KEYS.filter((k) => data.resolved_features?.[k]).length,
    isOverridden,
    mcpKeys: {
      ...keysView,
      showRevoked: showRevokedKeys,
      onToggleRevoked: () => setShowRevokedKeys((v) => !v),
      onRevoke: (keyId) => revokeMcpKeyMutation.mutate(keyId),
      revokePending: revokeMcpKeyMutation.isPending,
      onRevokeAll: () => revokeAllMcpKeysMutation.mutate(),
      revokeAllPending: revokeAllMcpKeysMutation.isPending,
    },
    oauthGrants: {
      ...grantsView,
      showRevoked: showRevokedGrants,
      onToggleRevoked: () => setShowRevokedGrants((v) => !v),
      onRevoke: (grantId) => revokeOAuthGrantMutation.mutate(grantId),
      revokePending: revokeOAuthGrantMutation.isPending,
      onRevokeAll: () => revokeAllOAuthGrantsMutation.mutate(),
      revokeAllPending: revokeAllOAuthGrantsMutation.isPending,
    },
  };

  return (
    <>
      {isPhone ? <WorkspaceDetailPhone {...view} /> : <WorkspaceDetailDesktop {...view} />}
      <OverridesSheets
        openPanel={openPanel}
        plan={plan}
        resourceEdits={resourceEdits}
        setResourceEdits={setResourceEdits}
        featureEdits={featureEdits}
        setFeatureEdits={setFeatureEdits}
        isOverridden={isOverridden}
        editsDirty={editsDirty}
        confirmDiscard={confirmDiscard}
        discardAndClose={discardAndClose}
        onSave={() => saveOverridesMutation.mutate()}
        savePending={saveOverridesMutation.isPending}
        onClear={() => clearMutation.mutate()}
        clearPending={clearMutation.isPending}
      />
      <DeleteWorkspaceDialog
        workspaceId={id!}
        workspaceName={data.workspace.name}
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
      />
      {isReverseTrial(data.workspace.plan_source) &&
      data.workspace.reverse_trial_started_at &&
      data.workspace.reverse_trial_ends_at ? (
        <ExtendTrialDialog
          workspaceId={id!}
          startedAt={data.workspace.reverse_trial_started_at}
          endsAt={data.workspace.reverse_trial_ends_at}
          open={extendOpen}
          onOpenChange={setExtendOpen}
        />
      ) : null}
    </>
  );
}
