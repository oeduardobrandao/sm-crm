import { useState, useEffect, type ReactNode } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, ExternalLink } from 'lucide-react';
import { toast } from 'sonner';
import {
  statusMeta,
  STATUS_BADGE_VARIANT,
  hasSubscription,
  intervalLabel,
  intervalSuffix,
  formatMoney,
  providerLabel,
  type SubscriptionInfo,
} from '../lib/subscription';
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
  RESOURCE_LIMIT_KEYS,
  RESOURCE_LIMIT_LABELS,
  FEATURE_FLAG_KEYS,
  FEATURE_FLAG_LABELS,
  RATE_LIMIT_KEYS,
  RATE_LIMIT_LABELS,
} from '../lib/api';
import { sanitizeExternalUrl } from '../lib/security';
import { computeOverridesPayload } from './workspace-overrides';
import { describeDrift, formatCard, formatLongDay } from './workspace-subscription';
import WorkspaceInvitesCard from './WorkspaceInvitesCard';
import WorkspaceEventsCard from './WorkspaceEventsCard';
import {
  formatBytes,
  limitCaption,
  overrideCount,
  visibleConnections,
} from './workspace-detail-view';
import { ErrorState } from '../components/ErrorState';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../components/ui/dialog';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Skeleton } from '../components/ui/skeleton';
import { Switch } from '../components/ui/switch';
import { Textarea } from '../components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../components/ui/table';
import { cn } from '../lib/utils';

/** Radix Select rejects '' as an item value; this sentinel stands for "Sem plano". */
const NO_PLAN = '__none__';
const HEAD_CLASS = 'text-[0.7rem] uppercase tracking-wider';
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
  const navigate = useNavigate();
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

  const plan = plansData?.plans?.find((p) => p.id === selectedPlanId);

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
  const closePanel = () => {
    if (editsDirty && !window.confirm(DISCARD_EDITS_WARNING)) return;
    setResourceEdits(initialEdits.resources);
    setFeatureEdits(initialEdits.features);
    setOpenPanel(null);
  };

  const resourceOverrideCount = overrideCount(data.override?.resource_overrides);
  const featureOverrideCount = overrideCount(data.override?.feature_overrides);
  const activeFeatureCount = FEATURE_FLAG_KEYS.filter((k) => data.resolved_features?.[k]).length;
  const keysView = visibleConnections(mcpKeys, showRevokedKeys);
  const grantsView = visibleConnections(oauthGrants, showRevokedGrants);

  const panelFooter = (
    <DialogFooter>
      <Button
        variant="ghost"
        onClick={() => clearMutation.mutate()}
        disabled={clearMutation.isPending}
        className="sm:mr-auto"
      >
        Restaurar padrões do plano
      </Button>
      <Button variant="outline" onClick={closePanel}>
        Cancelar
      </Button>
      <Button
        onClick={() => saveOverridesMutation.mutate()}
        disabled={saveOverridesMutation.isPending || !editsDirty}
      >
        {saveOverridesMutation.isPending ? 'Salvando…' : 'Salvar overrides'}
      </Button>
    </DialogFooter>
  );

  return (
    <div className="w-full min-w-0 max-w-full overflow-x-hidden">
      <Button
        variant="ghost"
        size="sm"
        onClick={() => navigate('/admin/workspaces')}
        className="mb-4 -ml-2 text-muted-foreground"
      >
        <ArrowLeft />
        Voltar
      </Button>

      <div className="flex min-w-0 flex-col gap-4 mb-8 sm:flex-row sm:items-center">
        <div className="flex min-w-0 flex-1 items-center gap-4">
          <div className="w-12 h-12 bg-secondary rounded-xl flex items-center justify-center text-lg font-bold text-foreground shrink-0">
            {data.workspace.name.charAt(0).toUpperCase()}
          </div>
          <div className="min-w-0">
            <h1 className="font-sf text-xl font-bold break-words">{data.workspace.name}</h1>
            <p className="text-sm text-muted-foreground truncate">
              Dono: {data.owner?.email || '—'}
              {data.owner?.telefone ? ` · ${data.owner.telefone}` : ''} · Criado em{' '}
              {new Date(data.workspace.created_at).toLocaleDateString('pt-BR')}
            </p>
          </div>
        </div>

        <div className="flex flex-col items-stretch gap-1 sm:items-end">
          <span id="workspace-plan-label" className="sr-only">
            Plano do workspace
          </span>
          <Select
            value={selectedPlanId === '' ? NO_PLAN : selectedPlanId}
            onValueChange={(v) => {
              const planId = v === NO_PLAN ? '' : v;
              setSelectedPlanId(planId);
              setPlanMutation.mutate(planId);
            }}
          >
            <SelectTrigger
              id="workspace-plan-trigger"
              aria-labelledby="workspace-plan-label workspace-plan-trigger"
              className="w-full sm:w-auto"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NO_PLAN}>Sem plano</SelectItem>
              {plansData?.plans?.map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {p.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {data?.workspace.plan_source === 'manual' && (
            <Button
              type="button"
              variant="link"
              size="sm"
              onClick={() => unsetMutation.mutate()}
              disabled={unsetMutation.isPending}
              className="h-auto px-0 text-muted-foreground"
            >
              Remover comp (voltar à cobrança)
            </Button>
          )}
        </div>
      </div>

      <BrandMetrics data={data} />

      {/* Provider subscription — the customer's real billing, even when an admin has
          manually comped the effective plan above. */}
      <Card className="mb-6 min-w-0">
        <CardHeader>
          <CardTitle>
            {data.subscription?.provider === 'pagarme'
              ? 'Assinatura Pagar.me'
              : 'Assinatura Stripe'}
          </CardTitle>
          {data.subscription?.stripe_dashboard_url && (
            <a
              href={sanitizeExternalUrl(data.subscription.stripe_dashboard_url)}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex shrink-0 items-center gap-1 text-sm text-primary hover:underline"
            >
              Abrir no Stripe <ExternalLink size={14} />
            </a>
          )}
          {data.subscription?.pagarme_dashboard_url && (
            <a
              href={sanitizeExternalUrl(data.subscription.pagarme_dashboard_url)}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex shrink-0 items-center gap-1 text-sm text-primary hover:underline"
            >
              Abrir no Pagar.me <ExternalLink size={14} />
            </a>
          )}
        </CardHeader>
        <CardContent>
          {hasSubscription(data.subscription) ? (
            <>
              <div className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-4">
                <Field label="Status">
                  <Badge variant={STATUS_BADGE_VARIANT[statusMeta(data.subscription.status).tone]}>
                    {statusMeta(data.subscription.status).label}
                  </Badge>
                </Field>
                <Field label="Plano">
                  <span className="text-sm">
                    {data.subscription.plan_name ?? '—'}
                    {intervalLabel(data.subscription.interval)
                      ? ` (${intervalLabel(data.subscription.interval)})`
                      : ''}
                  </span>
                </Field>
                <Field label="Valor">
                  <span className="font-sf text-sm">
                    {formatMoney(data.subscription.amount_cents, data.subscription.currency)}
                    {intervalSuffix(data.subscription.interval)}
                    {data.subscription.installments != null &&
                      data.subscription.installments > 1 &&
                      ` · ${data.subscription.installments}x`}
                  </span>
                  {data.subscription.gross_cents != null && (
                    <span className="ml-2 text-xs text-muted-foreground line-through">
                      {formatMoney(data.subscription.gross_cents, data.subscription.currency)}
                    </span>
                  )}
                  {data.subscription.discount_label && (
                    <div className="text-[0.7rem] text-muted-foreground">
                      {data.subscription.discount_label}
                    </div>
                  )}
                  {data.subscription.amount_source === 'catalog' && (
                    <div className="text-[0.7rem] text-muted-foreground">preço de tabela</div>
                  )}
                </Field>
                <Field label={data.subscription.cancel_at_period_end ? 'Cancela em' : 'Renova em'}>
                  <span className="text-sm">
                    {formatLongDay(
                      data.subscription.current_period_end,
                      data.subscription.provider === 'pagarme',
                    )}
                  </span>
                </Field>
                {data.subscription.failed_payment_count > 0 && (
                  <Field label="Pagamentos falhos">
                    <span className="text-sm text-warning">
                      {data.subscription.failed_payment_count}
                    </span>
                  </Field>
                )}
                {data.subscription.provider === 'pagarme' && data.subscription.pagarme_live && (
                  <>
                    <Field label="Cartão">
                      <span className="text-sm">
                        {formatCard(data.subscription.pagarme_live.card)}
                      </span>
                    </Field>
                    <Field label="Próxima cobrança">
                      <span className="text-sm">
                        {formatLongDay(data.subscription.pagarme_live.next_billing_at, true)}
                      </span>
                    </Field>
                  </>
                )}
              </div>
              {data.subscription.provider === 'pagarme' && (
                <PagarmeLiveNotes subscription={data.subscription} />
              )}
              {data.workspace.plan_source === 'manual' && (
                <p className="mt-4 text-xs text-muted-foreground">
                  O plano efetivo foi ajustado manualmente (comp). Os dados acima refletem a
                  assinatura real do cliente no {providerLabel(data.subscription.provider)}.
                </p>
              )}
            </>
          ) : (
            <p className="text-sm text-muted-foreground">Sem assinatura.</p>
          )}
        </CardContent>
      </Card>

      <div className="mb-6 grid min-w-0 max-w-full grid-cols-1 gap-6 md:grid-cols-2">
        <SummaryCard
          title="Limites de recursos"
          summary={`${RESOURCE_LIMIT_KEYS.length + RATE_LIMIT_KEYS.length} limites`}
          overrides={resourceOverrideCount}
          onOpen={() => setOpenPanel('limits')}
        />
        <SummaryCard
          title="Funcionalidades"
          summary={`${activeFeatureCount} de ${FEATURE_FLAG_KEYS.length} ativas`}
          overrides={featureOverrideCount}
          onOpen={() => setOpenPanel('features')}
        />
      </div>

      <Dialog open={openPanel === 'limits'} onOpenChange={(open) => !open && closePanel()}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>Limites de recursos</DialogTitle>
            <DialogDescription>
              Valores diferentes do plano viram override deste workspace.
            </DialogDescription>
          </DialogHeader>
          <DialogBody className="grid auto-rows-max gap-2">
            {RESOURCE_LIMIT_KEYS.map((key) => (
              <LimitRow
                key={key}
                label={RESOURCE_LIMIT_LABELS[key]}
                fieldKey={key}
                value={resourceEdits[key] ?? ''}
                planValue={plan ? (plan[key] as number | null) : null}
                isOverridden={isOverridden(key, 'resource')}
                onChange={(val) => setResourceEdits((prev) => ({ ...prev, [key]: val }))}
              />
            ))}
            <h3 className="mt-3 text-sm font-semibold text-muted-foreground">Limites de taxa</h3>
            {RATE_LIMIT_KEYS.map((key) => (
              <LimitRow
                key={key}
                label={RATE_LIMIT_LABELS[key]}
                fieldKey={key}
                value={resourceEdits[key] ?? ''}
                planValue={plan ? (plan[key] as number | null) : null}
                isOverridden={isOverridden(key, 'resource')}
                onChange={(val) => setResourceEdits((prev) => ({ ...prev, [key]: val }))}
              />
            ))}
          </DialogBody>
          {panelFooter}
        </DialogContent>
      </Dialog>

      <Dialog open={openPanel === 'features'} onOpenChange={(open) => !open && closePanel()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Funcionalidades</DialogTitle>
            <DialogDescription>
              O ponto amarelo marca um override; passe o mouse para ver o valor do plano.
            </DialogDescription>
          </DialogHeader>
          <DialogBody className="grid auto-rows-max gap-3">
            {FEATURE_FLAG_KEYS.map((key) => {
              const id = `feature-${key}`;
              return (
                <div key={key} className="flex items-center justify-between gap-2 overflow-hidden">
                  <Label
                    htmlFor={id}
                    className="truncate text-sm font-normal text-muted-foreground"
                  >
                    {FEATURE_FLAG_LABELS[key]}
                  </Label>
                  <div className="flex shrink-0 items-center gap-2">
                    {isOverridden(key, 'feature') && (
                      <span
                        className="h-1.5 w-1.5 shrink-0 rounded-full bg-warning"
                        title={`override (plano: ${plan?.[key] ? 'ATIVO' : 'INATIVO'})`}
                      />
                    )}
                    <Switch
                      id={id}
                      checked={!!featureEdits[key]}
                      onCheckedChange={(checked) =>
                        setFeatureEdits((prev) => ({ ...prev, [key]: checked }))
                      }
                    />
                  </div>
                </div>
              );
            })}
          </DialogBody>
          {panelFooter}
        </DialogContent>
      </Dialog>

      <Card className="mb-6 min-w-0">
        <CardHeader>
          <CardTitle>Chaves de API do MCP</CardTitle>
          <div className="flex items-center gap-1">
            {keysView.revokedCount > 0 && (
              <RevokedToggle
                shown={showRevokedKeys}
                count={keysView.revokedCount}
                onToggle={() => setShowRevokedKeys((v) => !v)}
              />
            )}
            {keysView.activeCount > 0 && (
              <Button
                variant="ghost"
                size="sm"
                className="text-destructive hover:text-destructive"
                onClick={() => revokeAllMcpKeysMutation.mutate()}
                disabled={revokeAllMcpKeysMutation.isPending}
              >
                Revogar todas
              </Button>
            )}
          </div>
        </CardHeader>
        {keysView.visible.length === 0 ? (
          <CardContent>
            <p className="text-sm text-muted-foreground">Nenhuma chave ativa.</p>
          </CardContent>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className={HEAD_CLASS}>Nome</TableHead>
                <TableHead className={HEAD_CLASS}>Escopos</TableHead>
                <TableHead className={cn(HEAD_CLASS, 'w-28 text-right')}>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {keysView.visible.map((k) => (
                <TableRow key={k.id}>
                  <TableCell className="text-sm">
                    <span className="font-medium">{k.name}</span>
                    <span className="text-muted-foreground"> …{k.token_suffix}</span>
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {k.scopes.join(', ')}
                  </TableCell>
                  <TableCell className="text-right">
                    {k.revoked_at ? (
                      <Badge variant="neutral">revogada</Badge>
                    ) : (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-destructive hover:text-destructive"
                        onClick={() => revokeMcpKeyMutation.mutate(k.id)}
                        disabled={revokeMcpKeyMutation.isPending}
                      >
                        Revogar
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>

      <Card className="mb-6 min-w-0">
        <CardHeader>
          <CardTitle>Conexões OAuth do MCP</CardTitle>
          <div className="flex items-center gap-1">
            {grantsView.revokedCount > 0 && (
              <RevokedToggle
                shown={showRevokedGrants}
                count={grantsView.revokedCount}
                onToggle={() => setShowRevokedGrants((v) => !v)}
              />
            )}
            {grantsView.activeCount > 0 && (
              <Button
                variant="ghost"
                size="sm"
                className="text-destructive hover:text-destructive"
                onClick={() => revokeAllOAuthGrantsMutation.mutate()}
                disabled={revokeAllOAuthGrantsMutation.isPending}
              >
                Revogar todas
              </Button>
            )}
          </div>
        </CardHeader>
        {grantsView.visible.length === 0 ? (
          <CardContent>
            <p className="text-sm text-muted-foreground">Nenhuma conexão ativa.</p>
          </CardContent>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className={HEAD_CLASS}>Conectado por</TableHead>
                <TableHead className={HEAD_CLASS}>Escopos</TableHead>
                <TableHead className={cn(HEAD_CLASS, 'w-28 text-right')}>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {grantsView.visible.map((g) => (
                <TableRow key={g.id}>
                  <TableCell className="text-sm font-medium">
                    {g.connected_by ?? 'Claude'}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {g.scopes.join(', ')}
                  </TableCell>
                  <TableCell className="text-right">
                    {g.revoked_at ? (
                      <Badge variant="neutral">revogada</Badge>
                    ) : (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-destructive hover:text-destructive"
                        onClick={() => revokeOAuthGrantMutation.mutate(g.id)}
                        disabled={revokeOAuthGrantMutation.isPending}
                      >
                        Revogar
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>

      <Card className="mb-6 min-w-0">
        <CardHeader>
          <CardTitle>Notas</CardTitle>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => saveNotesMutation.mutate()}
            disabled={saveNotesMutation.isPending || !plan}
            title={!plan ? 'Atribua um plano ao workspace para salvar notas' : undefined}
          >
            {saveNotesMutation.isPending ? 'Salvando…' : 'Salvar'}
          </Button>
        </CardHeader>
        <CardContent>
          <Textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Notas do admin…"
            aria-label="Notas do admin"
            rows={2}
            className="min-h-0 resize-none"
          />
        </CardContent>
      </Card>

      <Card className="min-w-0 overflow-hidden">
        <CardHeader>
          <CardTitle>Membros ({data.members.length})</CardTitle>
        </CardHeader>
        <Table className="hidden md:table">
          <TableHeader>
            <TableRow>
              <TableHead className={HEAD_CLASS}>Nome</TableHead>
              <TableHead className={HEAD_CLASS}>E-mail</TableHead>
              <TableHead className={HEAD_CLASS}>Telefone</TableHead>
              <TableHead className={HEAD_CLASS}>Papel</TableHead>
              <TableHead className={HEAD_CLASS}>Entrou em</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.members.map((m) => (
              <TableRow key={m.user_id}>
                <TableCell className="text-sm">{m.name}</TableCell>
                <TableCell className="text-sm text-muted-foreground">{m.email}</TableCell>
                <TableCell className="text-sm text-muted-foreground">
                  {m.telefone ? (
                    <span className="inline-flex items-center gap-1.5">
                      {m.telefone}
                      {m.marketing_opt_in && (
                        <Badge variant="success" size="sm" title="Aceitou contato de marketing">
                          MKT
                        </Badge>
                      )}
                    </span>
                  ) : (
                    <span className="text-dim-foreground">—</span>
                  )}
                </TableCell>
                <TableCell
                  className={cn(
                    'text-sm',
                    m.role === 'owner' ? 'font-semibold text-foreground' : 'text-muted-foreground',
                  )}
                >
                  {m.role}
                </TableCell>
                <TableCell className="text-sm text-muted-foreground">
                  {new Date(m.joined_at).toLocaleDateString('pt-BR', {
                    day: '2-digit',
                    month: 'short',
                  })}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        <ul className="flex flex-col md:hidden">
          {data.members.map((m) => (
            <li
              key={m.user_id}
              className="flex min-w-0 items-center justify-between gap-3 border-b border-border/50 px-5 py-3 last:border-0"
            >
              <div className="flex min-w-0 flex-col gap-0.5">
                <span className="truncate text-sm">{m.name}</span>
                <span className="truncate text-xs text-muted-foreground">{m.email}</span>
                {m.telefone && (
                  <span className="flex items-center gap-1.5 truncate text-xs text-muted-foreground">
                    {m.telefone}
                    {m.marketing_opt_in && (
                      <Badge variant="success" size="sm">
                        MKT
                      </Badge>
                    )}
                  </span>
                )}
              </div>
              <span
                className={cn(
                  'shrink-0 text-xs font-medium',
                  m.role === 'owner' ? 'font-semibold text-foreground' : 'text-muted-foreground',
                )}
              >
                {m.role}
              </span>
            </li>
          ))}
        </ul>
      </Card>

      <WorkspaceInvitesCard workspaceId={id!} />
      <WorkspaceEventsCard workspaceId={id!} />
    </div>
  );
}

/** Brand-level usage: the numbers the CRM's "Uso do plano" panel shows, against this workspace's limits. */
function BrandMetrics({ data }: { data: WorkspaceData }) {
  const limits = data.resolved_limits;
  const { usage } = data;
  const igTotal = usage.instagram_account_count;
  const igActive = usage.instagram_account_count_active;
  const igNeedingReauth = igTotal != null && igActive != null ? igTotal - igActive : 0;
  const tiles: { label: string; value: string | number; caption: string; warn?: string }[] = [
    {
      label: 'Clientes',
      value: usage.client_count,
      caption: limitCaption(limits?.max_clients),
    },
    {
      label: 'Membros',
      value: usage.member_count,
      caption: limitCaption(limits?.max_team_members),
    },
    {
      label: 'Contas do Instagram',
      value: igTotal ?? '—',
      caption: limitCaption(limits?.max_instagram_accounts),
      warn:
        igNeedingReauth > 0
          ? `${igNeedingReauth} ${igNeedingReauth === 1 ? 'precisa reconectar' : 'precisam reconectar'}`
          : undefined,
    },
    {
      label: 'Armazenamento',
      value: usage.storage_used_bytes != null ? formatBytes(usage.storage_used_bytes) : '—',
      caption: limitCaption(limits?.storage_quota_bytes, formatBytes),
    },
  ];
  return (
    <div className="mb-6 grid min-w-0 grid-cols-2 gap-4 lg:grid-cols-4">
      {tiles.map((t) => (
        <div
          key={t.label}
          data-testid="brand-metric"
          className="glass-surface min-w-0 rounded-2xl border border-border bg-card p-5"
        >
          <p className="mb-2 text-xs uppercase tracking-wider text-muted-foreground">{t.label}</p>
          <p className="break-words font-sf text-2xl font-bold sm:text-3xl">{t.value}</p>
          <p className="mt-1 text-xs text-muted-foreground">{t.caption}</p>
          {t.warn && <p className="mt-0.5 text-xs text-warning">{t.warn}</p>}
        </div>
      ))}
    </div>
  );
}

function SummaryCard({
  title,
  summary,
  overrides,
  onOpen,
}: {
  title: string;
  summary: string;
  overrides: number;
  onOpen: () => void;
}) {
  return (
    <Card className="min-w-0">
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <Button variant="ghost" size="sm" className="text-primary" onClick={onOpen}>
          Ver e editar
        </Button>
      </CardHeader>
      <CardContent className="flex flex-wrap items-center gap-2 py-4">
        <span className="text-sm text-muted-foreground">{summary}</span>
        {overrides > 0 ? (
          <Badge variant="warning" size="sm">
            {overrides} {overrides === 1 ? 'override' : 'overrides'}
          </Badge>
        ) : (
          <span className="text-xs text-dim-foreground">padrão do plano</span>
        )}
      </CardContent>
    </Card>
  );
}

function RevokedToggle({
  shown,
  count,
  onToggle,
}: {
  shown: boolean;
  count: number;
  onToggle: () => void;
}) {
  return (
    <Button
      variant="ghost"
      size="sm"
      className="text-muted-foreground"
      aria-pressed={shown}
      onClick={onToggle}
    >
      {shown ? 'Ocultar revogadas' : `Mostrar revogadas (${count})`}
    </Button>
  );
}

/** Drift warning + live-read failure note for a Pagar.me subscription (display only). */
function PagarmeLiveNotes({ subscription }: { subscription: SubscriptionInfo }) {
  const lines = describeDrift(subscription.pagarme_live?.drift);
  return (
    <>
      {lines.length > 0 && (
        <div className="mt-4 rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-xs text-warning">
          <div className="font-semibold">Espelho desatualizado</div>
          <ul className="mt-1 list-disc pl-4">
            {lines.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </div>
      )}
      {subscription.pagarme_live_error && (
        <p className="mt-4 text-xs text-muted-foreground">
          Sem resposta do Pagar.me, exibindo o espelho local.
        </p>
      )}
    </>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <div className="text-[0.65rem] uppercase tracking-wider text-muted-foreground mb-1">
        {label}
      </div>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

function LimitRow({
  label,
  fieldKey,
  value,
  planValue,
  isOverridden,
  onChange,
}: {
  label: string;
  fieldKey: string;
  value: string;
  planValue: number | null;
  isOverridden: boolean;
  onChange: (val: string) => void;
}) {
  const id = `limit-${fieldKey}`;
  // Byte quotas are unreadable as raw digits; show them humanized next to the input.
  const isBytes = fieldKey.endsWith('_bytes');
  const fmt = (n: number | null) => (n == null ? '—' : isBytes ? formatBytes(n) : String(n));
  const current = value.trim() === '' ? null : Number(value);
  return (
    <div className="flex min-w-0 items-center justify-between gap-2">
      <Label htmlFor={id} className="min-w-0 text-sm font-normal text-muted-foreground">
        <span className="block truncate">{label}</span>
        {isBytes && current != null && Number.isFinite(current) && (
          <span className="block text-[0.7rem] text-dim-foreground">{formatBytes(current)}</span>
        )}
      </Label>
      <div className="flex shrink-0 items-center gap-2">
        <Input
          id={id}
          type="number"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className={cn(
            'h-8 text-right font-sf text-sm',
            isBytes ? 'w-36' : 'w-20',
            isOverridden && 'border-primary/40 text-primary',
          )}
        />
        <span
          className={cn(
            'hidden w-24 items-center gap-1.5 whitespace-nowrap text-[0.7rem] sm:inline-flex',
            isOverridden ? 'text-warning' : 'text-dim-foreground',
          )}
          title={isOverridden ? 'override deste workspace' : undefined}
        >
          {isOverridden && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-warning" />}
          plano: {fmt(planValue)}
        </span>
        {isOverridden && (
          <span
            className="h-1.5 w-1.5 shrink-0 rounded-full bg-warning sm:hidden"
            title={`plano: ${fmt(planValue)}`}
          />
        )}
      </div>
    </div>
  );
}
