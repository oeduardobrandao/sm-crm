import { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  getWorkspace,
  listPlans,
  setWorkspacePlan,
  unsetWorkspacePlan,
  setWorkspaceOverrides,
  clearWorkspaceOverrides,
  listWorkspaceMcpKeys,
  revokeMcpKey,
  revokeAllMcpKeys,
  listWorkspaceOAuthGrants,
  revokeOAuthGrant,
  revokeAllOAuthGrants,
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
import type { WorkspaceDetailViewProps } from './workspace-detail/types';

const DISCARD_EDITS_WARNING = 'Descartar as alterações não salvas?';

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
  const [notes, setNotes] = useState('');
  const [selectedPlanId, setSelectedPlanId] = useState('');
  const [openPanel, setOpenPanel] = useState<'limits' | 'features' | null>(null);

  useEffect(() => {
    if (data) {
      setSelectedPlanId(data.plan?.id || '');
      setNotes(data.override?.notes || '');
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
        notes,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'workspace', id] });
      setOpenPanel(null);
      toast.success('Overrides salvos');
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const saveNotesMutation = useMutation({
    mutationFn: () => setWorkspaceOverrides({ workspace_id: id!, notes }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'workspace', id] });
      toast.success('Notas salvas');
    },
    onError: (err: Error) => toast.error(err.message),
  });

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
      toast.success('Comp removido. Workspace volta à cobrança normal');
    },
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
      setSelectedPlanId(planId);
      setPlanMutation.mutate(planId);
    },
    onUnsetComp: () => unsetMutation.mutate(),
    unsetPending: unsetMutation.isPending,
    notes,
    onNotesChange: setNotes,
    onSaveNotes: () => saveNotesMutation.mutate(),
    saveNotesPending: saveNotesMutation.isPending,
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
    </>
  );
}
