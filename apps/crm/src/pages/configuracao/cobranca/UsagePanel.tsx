import { useWorkspaceLimits } from '@/hooks/useWorkspaceLimits';
import { useWorkspaceUsage } from '@/hooks/useWorkspaceUsage';
import { useIsWorkspaceOwner } from '@/hooks/useIsWorkspaceOwner';
import { UsageMeter } from '@/components/usage/UsageMeter';
import { formatStorageBytes } from '@/components/usage/usage-meter-state';

/**
 * "Uso do plano": every WORKSPACE-WIDE countable limit vs current usage.
 * Per-entity limits (posts per workflow, custom props per template, active
 * workflows per client) and max_workspaces_per_user are deliberately absent.
 */
export function UsagePanel() {
  const { limits, planName, isLoading: limitsLoading, isUnlimited } = useWorkspaceLimits();
  const { usage, isLoading: usageLoading, isError } = useWorkspaceUsage();
  const isOwner = useIsWorkspaceOwner();

  // Self-defending: useIsWorkspaceOwner() is false until membership resolves,
  // so this also hides the panel during the resolution window where
  // CobrancaPage's soft (workspaceRole ?? role) gate can briefly let a stale
  // profile-level owner (actually an agent in the active workspace) through.
  // Do not loosen this to the page's gate -- it must stay the strict rule.
  if (!isOwner) return null;
  if (isUnlimited) return null; // no plan resolved: same skip as ProtectedRoute
  if (limitsLoading || usageLoading) {
    return (
      <div className="card usage-panel" aria-busy="true">
        <h3 className="usage-panel-title">Uso do plano</h3>
        <p className="usage-panel-sub">Carregando...</p>
      </div>
    );
  }
  if (isError || limits === null || usage === null || Object.keys(usage).length === 0) {
    // Empty object is the RPC's fail-safe for no active workspace / a stale
    // pointer -- rendering it would paint every meter as "0 de N" instead of
    // surfacing the real "we don't know" state.
    return (
      <div className="card usage-panel">
        <h3 className="usage-panel-title">Uso do plano</h3>
        <p className="usage-panel-sub">Não foi possível carregar o uso do plano.</p>
      </div>
    );
  }

  const members = usage.team_members ?? 0;
  const pending = usage.pending_invites ?? 0;
  const seatSub =
    pending > 0
      ? `${members} ${members === 1 ? 'membro' : 'membros'} e ${pending} ${
          pending === 1 ? 'convite pendente' : 'convites pendentes'
        }`
      : undefined;

  const meters: Array<{
    label: string;
    used: number;
    limit: number | null;
    format?: (n: number) => string;
    subText?: string;
  }> = [
    { label: 'Clientes', used: usage.clients ?? 0, limit: limits.max_clients },
    {
      label: 'Vagas de equipe',
      used: members + pending,
      limit: limits.max_team_members,
      subText: seatSub,
    },
    {
      label: 'Armazenamento',
      used: usage.storage_used_bytes ?? 0,
      limit: limits.storage_quota_bytes,
      format: formatStorageBytes,
    },
    { label: 'Leads', used: usage.leads ?? 0, limit: limits.max_leads },
    {
      label: 'Modelos de fluxo',
      used: usage.workflow_templates ?? 0,
      limit: limits.max_workflow_templates,
    },
    {
      label: 'Contas de Instagram',
      used: usage.instagram_accounts ?? 0,
      limit: limits.max_instagram_accounts,
    },
    { label: 'Portais do Hub', used: usage.hub_tokens ?? 0, limit: limits.max_hub_tokens },
    { label: 'Chaves MCP', used: usage.mcp_keys ?? 0, limit: limits.max_mcp_keys },
  ];

  return (
    <div className="card usage-panel">
      <h3 className="usage-panel-title">Uso do plano</h3>
      {planName && <p className="usage-panel-sub">Plano {planName}</p>}
      <div className="usage-grid">
        {meters.map((m) => (
          <UsageMeter key={m.label} size="full" showUpgradeCta={isOwner} {...m} />
        ))}
      </div>
    </div>
  );
}
