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

  if (isUnlimited) return null; // no plan resolved: same skip as ProtectedRoute
  if (limitsLoading || usageLoading) {
    return (
      <div className="card usage-panel" aria-busy="true">
        <h3 className="usage-panel-title">Uso do plano</h3>
        <p className="usage-panel-sub">Carregando...</p>
      </div>
    );
  }
  if (isError || limits === null || usage === null) {
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
      label: 'Templates de workflow',
      used: usage.workflow_templates ?? 0,
      limit: limits.max_workflow_templates,
    },
    {
      label: 'Contas de Instagram',
      used: usage.instagram_accounts ?? 0,
      limit: limits.max_instagram_accounts,
    },
    { label: 'Tokens do Hub', used: usage.hub_tokens ?? 0, limit: limits.max_hub_tokens },
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
