import { useTranslation } from 'react-i18next';
import { useWorkspaceLimits } from '@/hooks/useWorkspaceLimits';
import { useWorkspaceUsage } from '@/hooks/useWorkspaceUsage';
import { useIsWorkspaceOwner } from '@/hooks/useIsWorkspaceOwner';
import { UsageMeter } from '@/components/usage/UsageMeter';
import { formatStorageBytes } from '@/components/usage/usage-meter-state';
import { Skeleton } from '@/components/ui/skeleton';
import { SkeletonStatus } from '@/components/ui/skeletons';

/**
 * "Uso do plano": every WORKSPACE-WIDE countable limit vs current usage.
 * Per-entity limits (posts per workflow, custom props per template, active
 * workflows per client) and max_workspaces_per_user are deliberately absent.
 */
export function UsagePanel() {
  const { t } = useTranslation('billing');
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
      <div className="card usage-panel">
        <h3 className="usage-panel-title">{t('usagePanel.title')}</h3>
        <SkeletonStatus>
          <Skeleton className="h-3 w-28 mb-4" />
          <div className="usage-grid">
            {Array.from({ length: 8 }, (_, i) => (
              <div key={i} style={{ minWidth: 0 }}>
                <div className="flex items-center justify-between gap-2 mb-2">
                  <Skeleton className="h-3.5" style={{ width: i % 2 ? '45%' : '58%' }} />
                  <Skeleton className="h-3 w-12" />
                </div>
                <Skeleton className="h-[5px] w-full rounded-full" />
              </div>
            ))}
          </div>
        </SkeletonStatus>
      </div>
    );
  }
  if (isError || limits === null || usage === null || Object.keys(usage).length === 0) {
    // Empty object is the RPC's fail-safe for no active workspace / a stale
    // pointer -- rendering it would paint every meter as "0 de N" instead of
    // surfacing the real "we don't know" state.
    return (
      <div className="card usage-panel">
        <h3 className="usage-panel-title">{t('usagePanel.title')}</h3>
        <p className="usage-panel-sub">{t('usagePanel.loadError')}</p>
      </div>
    );
  }

  const members = usage.team_members ?? 0;
  const pending = usage.pending_invites ?? 0;
  const seatSub =
    pending > 0
      ? t('usagePanel.seatSub', {
          members: t('usagePanel.members', { count: members }),
          invites: t('usagePanel.pendingInvites', { count: pending }),
        })
      : undefined;

  const meters: Array<{
    label: string;
    used: number;
    limit: number | null;
    format?: (n: number) => string;
    subText?: string;
  }> = [
    { label: t('usagePanel.meters.clients'), used: usage.clients ?? 0, limit: limits.max_clients },
    {
      label: t('usagePanel.meters.seats'),
      used: members + pending,
      limit: limits.max_team_members,
      subText: seatSub,
    },
    {
      label: t('usagePanel.meters.storage'),
      used: usage.storage_used_bytes ?? 0,
      limit: limits.storage_quota_bytes,
      format: formatStorageBytes,
    },
    { label: t('usagePanel.meters.leads'), used: usage.leads ?? 0, limit: limits.max_leads },
    {
      label: t('usagePanel.meters.workflowTemplates'),
      used: usage.workflow_templates ?? 0,
      limit: limits.max_workflow_templates,
    },
    {
      label: t('usagePanel.meters.instagramAccounts'),
      used: usage.instagram_accounts ?? 0,
      limit: limits.max_instagram_accounts,
    },
    {
      label: t('usagePanel.meters.hubPortals'),
      used: usage.hub_tokens ?? 0,
      limit: limits.max_hub_tokens,
    },
    {
      label: t('usagePanel.meters.mcpKeys'),
      used: usage.mcp_keys ?? 0,
      limit: limits.max_mcp_keys,
    },
  ];

  return (
    <div className="card usage-panel">
      <h3 className="usage-panel-title">{t('usagePanel.title')}</h3>
      {planName && (
        <p className="usage-panel-sub">{t('usagePanel.planName', { name: planName })}</p>
      )}
      <div className="usage-grid">
        {meters.map((m) => (
          <UsageMeter key={m.label} size="full" showUpgradeCta={isOwner} {...m} />
        ))}
      </div>
    </div>
  );
}
