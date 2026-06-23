import { useState, useEffect, type ReactNode } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, ExternalLink } from 'lucide-react';
import { toast } from 'sonner';
import {
  statusMeta,
  toneBadgeClass,
  hasSubscription,
  intervalLabel,
  intervalSuffix,
  formatMoney,
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

const ALL_LIMIT_KEYS = [...RESOURCE_LIMIT_KEYS, ...RATE_LIMIT_KEYS];
const ALL_LIMIT_LABELS = { ...RESOURCE_LIMIT_LABELS, ...RATE_LIMIT_LABELS };

export default function WorkspaceDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({
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

  const revokeMcpKeyMutation = useMutation({
    mutationFn: (keyId: string) => revokeMcpKey(id!, keyId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'workspace', id, 'mcp-keys'] });
      toast.success('Key revoked');
    },
    onError: (e: unknown) => toast.error((e as Error).message),
  });
  const revokeAllMcpKeysMutation = useMutation({
    mutationFn: () => revokeAllMcpKeys(id!),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'workspace', id, 'mcp-keys'] });
      toast.success('All keys revoked');
    },
    onError: (e: unknown) => toast.error((e as Error).message),
  });

  const { data: oauthGrantsData } = useQuery({
    queryKey: ['admin', 'workspace', id, 'oauth-grants'],
    queryFn: () => listWorkspaceOAuthGrants(id!),
    enabled: !!id,
  });
  const oauthGrants = oauthGrantsData?.grants;

  const revokeOAuthGrantMutation = useMutation({
    mutationFn: (grantId: string) => revokeOAuthGrant(id!, grantId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'workspace', id, 'oauth-grants'] });
      toast.success('Connection revoked');
    },
    onError: (e: unknown) => toast.error((e as Error).message),
  });
  const revokeAllOAuthGrantsMutation = useMutation({
    mutationFn: () => revokeAllOAuthGrants(id!),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'workspace', id, 'oauth-grants'] });
      toast.success('All connections revoked');
    },
    onError: (e: unknown) => toast.error((e as Error).message),
  });

  const [resourceEdits, setResourceEdits] = useState<Record<string, string>>({});
  const [featureEdits, setFeatureEdits] = useState<Record<string, boolean>>({});
  const [notes, setNotes] = useState('');
  const [selectedPlanId, setSelectedPlanId] = useState('');

  useEffect(() => {
    if (data) {
      setSelectedPlanId(data.plan?.id || '');
      setNotes(data.override?.notes || '');
      const rEdits: Record<string, string> = {};
      if (data.resolved_limits) {
        for (const [k, v] of Object.entries(data.resolved_limits)) {
          rEdits[k] = v != null ? String(v) : '';
        }
      }
      setResourceEdits(rEdits);

      const fEdits: Record<string, boolean> = {};
      if (data.resolved_features) {
        for (const [k, v] of Object.entries(data.resolved_features)) {
          fEdits[k] = v;
        }
      }
      setFeatureEdits(fEdits);
    }
  }, [data]);

  const setPlanMutation = useMutation({
    mutationFn: (planId: string) => setWorkspacePlan(id!, planId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'workspace', id] });
      toast.success('Plan updated');
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const saveOverridesMutation = useMutation({
    mutationFn: () => {
      const plan = plansData?.plans?.find((p) => p.id === selectedPlanId);
      if (!plan) throw new Error('No plan selected');

      const resOverrides: Record<string, number> = {};
      for (const key of ALL_LIMIT_KEYS) {
        const parsed = parseInt(resourceEdits[key], 10);
        const planVal = (plan[key as keyof typeof plan] as number | null) ?? 0;
        if (!isNaN(parsed) && parsed !== planVal) {
          resOverrides[key] = parsed;
        }
      }

      const featOverrides: Record<string, boolean> = {};
      for (const key of FEATURE_FLAG_KEYS) {
        const planVal = (plan[key] as boolean) ?? false;
        if (featureEdits[key] !== planVal) {
          featOverrides[key] = featureEdits[key];
        }
      }

      return setWorkspaceOverrides({
        workspace_id: id!,
        resource_overrides: Object.keys(resOverrides).length > 0 ? resOverrides : undefined,
        feature_overrides: Object.keys(featOverrides).length > 0 ? featOverrides : undefined,
        notes: notes || undefined,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'workspace', id] });
      toast.success('Overrides saved');
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const clearMutation = useMutation({
    mutationFn: () => clearWorkspaceOverrides(id!),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'workspace', id] });
      toast.success('Overrides cleared');
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const unsetMutation = useMutation({
    mutationFn: () => unsetWorkspacePlan(id!),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'workspace', id] });
      toast.success('Comp removido — workspace volta à cobrança normal');
    },
    onError: (err: Error) => toast.error(err.message),
  });

  if (isLoading || !data) {
    return <p className="text-dim-foreground">Loading...</p>;
  }

  const plan = plansData?.plans?.find((p) => p.id === selectedPlanId);

  const isOverridden = (key: string, type: 'resource' | 'feature') => {
    if (!data.override) return false;
    if (type === 'resource') return data.override.resource_overrides?.[key] !== undefined;
    return data.override.feature_overrides?.[key] !== undefined;
  };

  return (
    <div className="w-full min-w-0 max-w-full overflow-x-hidden">
      <button
        onClick={() => navigate('/admin/workspaces')}
        className="flex items-center gap-2 text-sm text-muted-foreground hover:text-primary mb-4 transition-colors"
      >
        <ArrowLeft size={16} /> Back
      </button>

      <div className="flex min-w-0 flex-col gap-4 mb-8 sm:flex-row sm:items-center">
        <div className="flex min-w-0 flex-1 items-center gap-4">
          <div className="w-12 h-12 bg-secondary rounded-xl flex items-center justify-center text-lg font-bold text-foreground shrink-0">
            {data.workspace.name.charAt(0).toUpperCase()}
          </div>
          <div className="min-w-0">
            <h1 className="font-['Playfair_Display'] text-xl font-bold break-words">
              {data.workspace.name}
            </h1>
            <p className="text-sm text-muted-foreground truncate">
              Owner: {data.owner?.email || '—'} · Created{' '}
              {new Date(data.workspace.created_at).toLocaleDateString('pt-BR')}
            </p>
          </div>
        </div>

        <div className="flex flex-col items-stretch gap-1 sm:items-end">
          <select
            value={selectedPlanId}
            onChange={(e) => {
              setSelectedPlanId(e.target.value);
              setPlanMutation.mutate(e.target.value);
            }}
            className="w-full min-w-0 max-w-full rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground focus:border-primary focus:outline-none sm:w-auto"
          >
            <option value="">No plan</option>
            {plansData?.plans?.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          {data?.workspace.plan_source === 'manual' && (
            <button
              type="button"
              onClick={() => unsetMutation.mutate()}
              disabled={unsetMutation.isPending}
              className="mt-1 text-sm underline text-muted-foreground hover:text-foreground disabled:opacity-50 text-right"
            >
              Remover comp (voltar à cobrança)
            </button>
          )}
        </div>
      </div>

      {/* Stripe subscription — the customer's real billing, even when an admin has
          manually comped the effective plan above. */}
      <div className="min-w-0 bg-card border border-border rounded-2xl p-5 mb-6">
        <div className="flex items-center justify-between gap-3 mb-4">
          <h2 className="font-semibold">Assinatura Stripe</h2>
          {data.subscription?.stripe_dashboard_url && (
            <a
              href={data.subscription.stripe_dashboard_url}
              target="_blank"
              rel="noreferrer"
              className="inline-flex shrink-0 items-center gap-1 text-sm text-primary hover:underline"
            >
              Abrir no Stripe <ExternalLink size={14} />
            </a>
          )}
        </div>

        {hasSubscription(data.subscription) ? (
          <>
            <div className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-4">
              <Field label="Status">
                <span
                  className={`inline-block text-xs font-semibold uppercase px-2 py-0.5 rounded-sm ${toneBadgeClass(statusMeta(data.subscription.status).tone)}`}
                >
                  {statusMeta(data.subscription.status).label}
                </span>
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
                <span className="font-['DM_Sans'] text-sm">
                  {formatMoney(data.subscription.amount_cents, data.subscription.currency)}
                  {intervalSuffix(data.subscription.interval)}
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
                  {data.subscription.current_period_end
                    ? new Date(data.subscription.current_period_end).toLocaleDateString('pt-BR', {
                        day: '2-digit',
                        month: 'long',
                        year: 'numeric',
                      })
                    : '—'}
                </span>
              </Field>
              {data.subscription.failed_payment_count > 0 && (
                <Field label="Pagamentos falhos">
                  <span className="text-sm text-warning">
                    {data.subscription.failed_payment_count}
                  </span>
                </Field>
              )}
            </div>
            {data.workspace.plan_source === 'manual' && (
              <p className="mt-4 text-xs text-muted-foreground">
                O plano efetivo foi ajustado manualmente (comp). Os dados acima refletem a
                assinatura real do cliente no Stripe.
              </p>
            )}
          </>
        ) : (
          <p className="text-sm text-muted-foreground">Sem assinatura Stripe.</p>
        )}
      </div>

      <div className="grid min-w-0 max-w-full grid-cols-1 gap-6 mb-6 md:grid-cols-2">
        <div className="bg-card border border-border rounded-2xl p-5 min-w-0">
          <h2 className="font-semibold mb-4">Resource Limits</h2>
          <div className="flex flex-col gap-2">
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
          </div>

          <h3 className="font-semibold mt-5 mb-3 text-sm text-muted-foreground">Rate Limits</h3>
          <div className="flex flex-col gap-2">
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
          </div>
        </div>

        <div className="bg-card border border-border rounded-2xl p-5 min-w-0 overflow-hidden">
          <h2 className="font-semibold mb-4">Feature Flags</h2>
          <div className="flex flex-col gap-2">
            {FEATURE_FLAG_KEYS.map((key) => (
              <div key={key} className="flex items-center justify-between gap-2 overflow-hidden">
                <span className="text-sm text-muted-foreground truncate">
                  {FEATURE_FLAG_LABELS[key]}
                </span>
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    onClick={() => setFeatureEdits((prev) => ({ ...prev, [key]: !prev[key] }))}
                    className={`text-sm font-medium ${featureEdits[key] ? 'text-success' : 'text-destructive'}`}
                  >
                    {featureEdits[key] ? 'ON' : 'OFF'}
                  </button>
                  {isOverridden(key, 'feature') && (
                    <span
                      className="w-1.5 h-1.5 rounded-full bg-warning shrink-0"
                      title={`override (plan: ${plan?.[key] ? 'ON' : 'OFF'})`}
                    />
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* MCP API Keys */}
      <div className="min-w-0 bg-card border border-border rounded-2xl p-5 mb-6">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-semibold">MCP API Keys</h2>
          {mcpKeys?.some((k) => !k.revoked_at) && (
            <button
              onClick={() => revokeAllMcpKeysMutation.mutate()}
              disabled={revokeAllMcpKeysMutation.isPending}
              className="text-xs font-medium text-destructive hover:underline disabled:opacity-50"
            >
              Revoke all
            </button>
          )}
        </div>
        {!mcpKeys || mcpKeys.length === 0 ? (
          <p className="text-sm text-muted-foreground">No keys.</p>
        ) : (
          <div className="flex flex-col gap-2">
            {mcpKeys.map((k) => (
              <div key={k.id} className="flex items-center justify-between gap-2 text-sm">
                <div className="min-w-0 truncate">
                  <span className="font-medium">{k.name}</span>
                  <span className="text-muted-foreground"> …{k.token_suffix}</span>
                  <span className="ml-2 text-xs text-muted-foreground">{k.scopes.join(', ')}</span>
                </div>
                {k.revoked_at ? (
                  <span className="shrink-0 text-xs text-muted-foreground">revoked</span>
                ) : (
                  <button
                    onClick={() => revokeMcpKeyMutation.mutate(k.id)}
                    disabled={revokeMcpKeyMutation.isPending}
                    className="shrink-0 text-xs font-medium text-destructive hover:underline disabled:opacity-50"
                  >
                    Revoke
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* MCP OAuth Connections (Claude) */}
      <div className="min-w-0 bg-card border border-border rounded-2xl p-5 mb-6">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-semibold">MCP OAuth Connections</h2>
          {oauthGrants?.some((g) => !g.revoked_at) && (
            <button
              onClick={() => revokeAllOAuthGrantsMutation.mutate()}
              disabled={revokeAllOAuthGrantsMutation.isPending}
              className="text-xs font-medium text-destructive hover:underline disabled:opacity-50"
            >
              Revoke all
            </button>
          )}
        </div>
        {!oauthGrants || oauthGrants.length === 0 ? (
          <p className="text-sm text-muted-foreground">No connections.</p>
        ) : (
          <div className="flex flex-col gap-2">
            {oauthGrants.map((g) => (
              <div key={g.id} className="flex items-center justify-between gap-2 text-sm">
                <div className="min-w-0 truncate">
                  <span className="font-medium">{g.connected_by ?? 'Claude'}</span>
                  <span className="ml-2 text-xs text-muted-foreground">{g.scopes.join(', ')}</span>
                </div>
                {g.revoked_at ? (
                  <span className="shrink-0 text-xs text-muted-foreground">revoked</span>
                ) : (
                  <button
                    onClick={() => revokeOAuthGrantMutation.mutate(g.id)}
                    disabled={revokeOAuthGrantMutation.isPending}
                    className="shrink-0 text-xs font-medium text-destructive hover:underline disabled:opacity-50"
                  >
                    Revoke
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="min-w-0 bg-card border border-border rounded-2xl p-5 mb-6">
        <h2 className="font-semibold mb-3">Notes</h2>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Admin notes..."
          rows={2}
          className="w-full px-3 py-2 rounded-lg bg-secondary border border-transparent text-sm text-foreground placeholder-dim-foreground focus:outline-none focus:border-primary resize-none"
        />
      </div>

      <div className="flex min-w-0 flex-col gap-3 mb-8 sm:flex-row">
        <button
          onClick={() => saveOverridesMutation.mutate()}
          disabled={saveOverridesMutation.isPending}
          className="w-full px-6 py-2.5 rounded-lg bg-primary text-primary-foreground font-semibold text-sm hover:bg-primary-hover transition-colors disabled:opacity-50 sm:w-auto"
        >
          {saveOverridesMutation.isPending ? 'Saving...' : 'Save Overrides'}
        </button>
        <button
          onClick={() => clearMutation.mutate()}
          disabled={clearMutation.isPending}
          className="w-full px-6 py-2.5 rounded-lg border border-border text-sm text-muted-foreground hover:border-primary hover:text-primary transition-colors disabled:opacity-50 sm:w-auto"
        >
          Reset to Plan Defaults
        </button>
      </div>

      <div className="min-w-0 overflow-hidden bg-card border border-border rounded-2xl p-5">
        <h2 className="font-semibold mb-4">Members ({data.members.length})</h2>
        {/* Desktop table header */}
        <div className="hidden md:grid grid-cols-[2fr_2fr_1fr_1fr] gap-2 text-[0.7rem] text-muted-foreground uppercase tracking-wider pb-3 border-b border-border">
          <span>Name</span>
          <span>Email</span>
          <span>Role</span>
          <span>Joined</span>
        </div>
        {data.members.map((m) => (
          <div
            key={m.user_id}
            className="min-w-0 border-b border-border/50 py-2.5 md:grid md:grid-cols-[2fr_2fr_1fr_1fr] md:gap-2"
          >
            {/* Mobile card */}
            <div className="flex min-w-0 items-center justify-between gap-3 md:hidden">
              <div className="flex min-w-0 flex-col gap-0.5">
                <span className="truncate text-sm">{m.name}</span>
                <span className="truncate text-xs text-muted-foreground">{m.email}</span>
              </div>
              <span
                className={`shrink-0 text-xs font-medium ${m.role === 'owner' ? 'text-foreground font-semibold' : 'text-muted-foreground'}`}
              >
                {m.role}
              </span>
            </div>
            {/* Desktop row */}
            <span className="hidden truncate text-sm md:inline">{m.name}</span>
            <span className="hidden truncate text-sm text-muted-foreground md:inline">
              {m.email}
            </span>
            <span
              className={`hidden md:inline text-sm ${m.role === 'owner' ? 'text-foreground font-semibold' : 'text-muted-foreground'}`}
            >
              {m.role}
            </span>
            <span className="hidden md:inline text-sm text-muted-foreground">
              {new Date(m.joined_at).toLocaleDateString('pt-BR', {
                day: '2-digit',
                month: 'short',
              })}
            </span>
          </div>
        ))}
      </div>
    </div>
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
  return (
    <div className="flex items-center justify-between gap-2 min-w-0">
      <span className="text-sm text-muted-foreground truncate">{label}</span>
      <div className="flex items-center gap-2 shrink-0">
        <input
          type="number"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className={`w-20 px-2 py-1 rounded text-right font-['DM_Sans'] text-sm bg-secondary border focus:outline-none focus:border-primary ${
            isOverridden ? 'border-primary/30 text-primary' : 'border-transparent text-foreground'
          }`}
        />
        {isOverridden ? (
          <span
            className="w-1.5 h-1.5 rounded-full bg-warning shrink-0"
            title={`plan: ${planValue ?? '—'}`}
          />
        ) : (
          <span className="text-[0.7rem] text-dim-foreground hidden sm:inline whitespace-nowrap">
            plan: {planValue ?? '—'}
          </span>
        )}
      </div>
    </div>
  );
}
