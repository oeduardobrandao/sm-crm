import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { Switch } from '@/components/ui/switch';
import { supabase } from '@/lib/supabase';
import { renderInstagramOverviewCard } from '@/components/instagram/InstagramOverviewCard';
import { renderInstagramFollowerChart } from '@/components/instagram/InstagramFollowerChart';
import { renderInstagramConnectButton } from '@/components/instagram/InstagramConnectButton';
import { LatestInstagramPosts } from '@/components/instagram/LatestInstagramPosts';
import { ConnectLinkRow } from '@/components/instagram/ConnectLinkDialog';

// Isolated component for imperative Instagram widgets. Extracted verbatim from
// the pre-split ClienteDetalhePage (see git history at d30adeea) into its own
// file as part of the cliente-detalhe tabs split (Task 5).
// Keyed by clienteId (by the caller) so it fully remounts on navigation.
// Never conditionally mounts/unmounts its ref divs — React never touches their children.
export function InstagramSection({
  clienteId,
  clienteEmail,
  loadingIg,
  igSummary,
  refetchIg,
  onNavigateAnalytics,
}: {
  clienteId: number;
  clienteEmail: string | null;
  loadingIg: boolean;
  igSummary: any;
  refetchIg: () => void;
  onNavigateAnalytics: () => void;
}) {
  const { t, i18n } = useTranslation('clients');
  const igOverviewRef = useRef<HTMLDivElement>(null);
  const igChartRef = useRef<HTMLDivElement>(null);
  const igConnectRef = useRef<HTMLDivElement>(null);

  const [autoPublish, setAutoPublish] = useState(false);
  const [autoPublishLoading, setAutoPublishLoading] = useState(false);

  useEffect(() => {
    supabase
      .from('clientes')
      .select('auto_publish_on_approval')
      .eq('id', clienteId)
      .single()
      .then(({ data }) => {
        if (data) setAutoPublish(data.auto_publish_on_approval);
      });
  }, [clienteId]);

  const handleAutoPublishToggle = async (checked: boolean) => {
    setAutoPublishLoading(true);
    try {
      await supabase
        .from('clientes')
        .update({ auto_publish_on_approval: checked })
        .eq('id', clienteId);
      setAutoPublish(checked);
    } catch {
      /* ignore */
    } finally {
      setAutoPublishLoading(false);
    }
  };

  useEffect(() => {
    if (loadingIg) return;
    if (!igSummary) {
      if (igConnectRef.current && !isNaN(clienteId)) {
        renderInstagramConnectButton(igConnectRef.current, clienteId);
      }
      return;
    }
    if (igSummary.account?.last_synced_at) {
      if (igOverviewRef.current)
        renderInstagramOverviewCard(igOverviewRef.current, clienteId, igSummary.account, refetchIg);
      if (igChartRef.current)
        renderInstagramFollowerChart(igChartRef.current, igSummary.history ?? []);
    }
  }, [loadingIg, igSummary, clienteId, refetchIg, i18n.language]);

  return (
    <div id="ig-container" style={{ marginBottom: '1.5rem' }}>
      {loadingIg && (
        <div className="flex justify-center p-4">
          <Spinner size="lg" />
        </div>
      )}
      {!loadingIg && igSummary && !igSummary.account?.last_synced_at && (
        <div className="card" style={{ padding: '2rem', textAlign: 'center' }}>
          <Spinner size="lg" />
          <p style={{ color: 'var(--text-muted)', marginTop: 8 }}>{t('detail.igSyncing')}</p>
        </div>
      )}
      <div ref={igOverviewRef} />
      <div ref={igChartRef} />
      {!loadingIg && igSummary?.account?.last_synced_at && (
        <LatestInstagramPosts clienteId={clienteId} />
      )}
      {!loadingIg && igSummary?.account?.last_synced_at && (
        <div
          style={{
            display: 'flex',
            justifyContent: 'center',
            marginTop: '1.5rem',
            marginBottom: '1rem',
          }}
        >
          <Button onClick={onNavigateAnalytics}>{t('detail.viewFullAnalytics')}</Button>
        </div>
      )}
      {igSummary?.account?.last_synced_at && (
        <div className="card" style={{ padding: '1.25rem', marginTop: '1rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div>
              <div style={{ color: 'var(--text-main)', fontSize: '0.85rem', fontWeight: 500 }}>
                {t('detail.autoPublishTitle')}
              </div>
              <div
                style={{ color: 'var(--text-light)', fontSize: '0.75rem', marginTop: '0.25rem' }}
              >
                {t('detail.autoPublishDesc')}
              </div>
            </div>
            <Switch
              checked={autoPublish}
              onCheckedChange={handleAutoPublishToggle}
              disabled={autoPublishLoading}
            />
          </div>
        </div>
      )}
      <div ref={igConnectRef} />
      {!loadingIg && !isNaN(clienteId) && (
        <ConnectLinkRow clienteId={clienteId} clienteEmail={clienteEmail} />
      )}
    </div>
  );
}
