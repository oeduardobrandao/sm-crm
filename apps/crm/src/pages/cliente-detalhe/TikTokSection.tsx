import { useEffect, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Spinner } from '@/components/ui/spinner';
import { useWorkspaceLimits } from '../../hooks/useWorkspaceLimits';
import { getTikTokSummary } from '../../services/tiktok';
import { renderTikTokConnectButton } from '../../components/tiktok/TikTokConnectButton';
import { renderTikTokOverviewCard } from '../../components/tiktok/TikTokOverviewCard';
import { renderTikTokFollowerChart } from '../../components/tiktok/TikTokFollowerChart';
import { renderTikTokPostsTable } from '../../components/tiktok/TikTokPostsTable';

// Isolated component for imperative TikTok widgets, mirroring InstagramSection
// (ClienteDetalhePage.tsx). Extracted to its own file — unlike InstagramSection —
// so the feature-flag gate is directly testable in isolation.
//
// Renders nothing (and fetches nothing) unless the `feature_tiktok` entitlement
// is on: this is Phase A of the TikTok integration and ships dark on all plans.
// Never conditionally mounts/unmounts its ref divs — React never touches their
// children; the imperative renderers own that DOM once mounted.
export function TikTokSection({ clienteId }: { clienteId: number }) {
  const { t, i18n } = useTranslation('clients');
  const { features } = useWorkspaceLimits();
  const enabled = !!features?.feature_tiktok;

  const {
    data: ttSummary,
    isLoading: loadingTt,
    refetch: refetchTt,
  } = useQuery({
    queryKey: ['ttSummary', clienteId],
    queryFn: () => getTikTokSummary(clienteId).catch(() => null),
    enabled: enabled && !isNaN(clienteId),
  });

  const overviewRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<HTMLDivElement>(null);
  const postsRef = useRef<HTMLDivElement>(null);
  const connectRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!enabled) return;
    if (loadingTt) return;
    if (!ttSummary) {
      if (connectRef.current && !isNaN(clienteId)) {
        renderTikTokConnectButton(connectRef.current, clienteId);
      }
      return;
    }
    if (ttSummary.account?.last_synced_at) {
      if (overviewRef.current) {
        renderTikTokOverviewCard(overviewRef.current, clienteId, ttSummary.account, refetchTt);
      }
      if (chartRef.current) {
        renderTikTokFollowerChart(chartRef.current, ttSummary.follower_history ?? []);
      }
      if (postsRef.current) {
        renderTikTokPostsTable(postsRef.current, clienteId);
      }
    }
  }, [enabled, loadingTt, ttSummary, clienteId, refetchTt, i18n.language]);

  if (!enabled) return null;

  return (
    <div id="tiktok-container" style={{ marginBottom: '1.5rem' }}>
      {loadingTt && (
        <div className="flex justify-center p-4">
          <Spinner size="lg" />
        </div>
      )}
      {!loadingTt && ttSummary && !ttSummary.account?.last_synced_at && (
        <div className="card" style={{ padding: '2rem', textAlign: 'center' }}>
          <Spinner size="lg" />
          <p style={{ color: 'var(--text-muted)', marginTop: 8 }}>{t('detail.ttSyncing')}</p>
        </div>
      )}
      <div ref={overviewRef} />
      <div ref={chartRef} />
      <div ref={postsRef} />
      <div ref={connectRef} />
    </div>
  );
}
