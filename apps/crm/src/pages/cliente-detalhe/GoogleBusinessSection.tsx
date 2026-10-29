import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { AlertTriangle, Loader2, Store } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ReportSkeleton } from '@/components/ui/skeletons';
import { useWorkspaceLimits } from '../../hooks/useWorkspaceLimits';
import { getGoogleAuthUrl, getGoogleSummary } from '../../services/google';
import { GbpUnitsDialog } from './GbpUnitsDialog';

// Google Meu Negócio card for the "Redes sociais" tab (Phase 1: connect + unit picker).
// Same rule as TikTokSection/YouTubeSection: renders nothing, fetches nothing, unless the
// `feature_google_business` entitlement is on. Shares the ['googleSummary', id] query with
// the YouTube card (one /summary call serves both halves).
export function GoogleBusinessSection({
  clienteId,
  clienteNome = '',
  pickConnectionId,
  onPickHandled,
}: {
  clienteId: number;
  /** Client name for the picker title. */
  clienteNome?: string;
  pickConnectionId: string | null;
  onPickHandled: () => void;
}) {
  const { t, i18n } = useTranslation('clients');
  const { features } = useWorkspaceLimits();
  const enabled = !!features?.feature_google_business;
  const [dialogOpen, setDialogOpen] = useState(false);
  const [dialogConnectionId, setDialogConnectionId] = useState<string | null>(null);
  const [redirecting, setRedirecting] = useState(false);

  const {
    data: summary,
    isLoading,
    isError,
  } = useQuery({
    queryKey: ['googleSummary', clienteId],
    queryFn: () => getGoogleSummary(clienteId),
    enabled: enabled && !isNaN(clienteId),
  });

  const gmn = summary?.gmn ?? null;
  const activeConnections = (gmn?.connections ?? []).filter((c) => c.status === 'active');
  const units = (gmn?.locations ?? []).filter((l) => l.status !== 'disconnected');
  const hasRevoked = units.some((l) => l.status === 'revoked');

  // Return from OAuth with ?gbp_pick=<connection>: open the picker once the summary is in.
  useEffect(() => {
    if (!enabled || !pickConnectionId || !summary) return;
    if (activeConnections.length > 0) {
      setDialogConnectionId(
        activeConnections.some((c) => c.id === pickConnectionId)
          ? pickConnectionId
          : activeConnections[0].id,
      );
      setDialogOpen(true);
    }
    onPickHandled();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- one shot per pick + summary load
  }, [enabled, pickConnectionId, summary]);

  async function handleConnect() {
    setRedirecting(true);
    try {
      window.location.href = await getGoogleAuthUrl(clienteId, 'gbp');
    } catch (err) {
      setRedirecting(false);
      const code = (err as { code?: string }).code;
      toast.error(code === 'feature_disabled' ? t('gmn.featureDisabled') : t('gmn.connectError'));
    }
  }

  if (!enabled) return null;

  const numberFormat = new Intl.NumberFormat(i18n.language, {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  });

  const connectButton = (label: string, variant: 'default' | 'outline' | 'ghost' = 'default') => (
    <Button
      type="button"
      variant={variant}
      size={variant === 'default' ? 'default' : 'sm'}
      onClick={handleConnect}
      disabled={redirecting}
    >
      {redirecting && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />}
      {redirecting ? t('gmn.connecting') : label}
    </Button>
  );

  return (
    <section
      className="card"
      data-testid="gmn-section"
      aria-labelledby="gmn-card-title"
      style={{ padding: '1.25rem', marginBottom: '1.5rem' }}
    >
      {isLoading && <ReportSkeleton />}

      {!isLoading && isError && (
        <p role="alert" style={{ margin: 0, fontSize: '0.875rem', color: 'var(--danger-text)' }}>
          {t('gmn.loadError')}
        </p>
      )}

      {!isLoading && !isError && units.length === 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <Store size={24} color="#2563eb" aria-hidden="true" />
            <h3 id="gmn-card-title" style={{ margin: 0, fontSize: '1rem', fontWeight: 600 }}>
              {t('gmn.connectTitle')}
            </h3>
          </div>
          <p style={{ margin: 0, fontSize: '0.875rem', lineHeight: 1.5 }}>
            {t('gmn.connectDescription')}
          </p>
          <ul
            style={{
              margin: 0,
              paddingLeft: 18,
              fontSize: '0.8125rem',
              lineHeight: 1.7,
              color: 'var(--text-light)',
            }}
          >
            <li>{t('gmn.connectBullet1')}</li>
            <li>{t('gmn.connectBullet2')}</li>
          </ul>
          <div>{connectButton(t('gmn.connectButton'))}</div>
        </div>
      )}

      {!isLoading && !isError && units.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <Store size={24} color="#2563eb" aria-hidden="true" />
            <h3 id="gmn-card-title" style={{ margin: 0, fontSize: '1rem', fontWeight: 600 }}>
              {t('gmn.title')}
            </h3>
            <Badge variant="success">{t('gmn.unitsBadge', { count: units.length })}</Badge>
          </div>

          {hasRevoked && (
            <div
              role="alert"
              // `.badge-warning` (app.css) defines --badge-bg/fg/border for light and dark.
              className="badge-warning"
              style={{
                display: 'flex',
                flexWrap: 'wrap',
                gap: 12,
                alignItems: 'flex-start',
                padding: '14px 16px',
                borderRadius: 12,
                background: 'var(--badge-bg)',
                border: '1px solid var(--badge-border)',
                color: 'var(--badge-fg)',
              }}
            >
              <AlertTriangle size={18} aria-hidden="true" style={{ flexShrink: 0, marginTop: 1 }} />
              <div style={{ flex: '1 1 200px', fontSize: '0.875rem', lineHeight: 1.5 }}>
                {t('gmn.revokedBanner')}
              </div>
              {connectButton(t('gmn.reconnect'), 'outline')}
            </div>
          )}

          {activeConnections.length > 0 && (
            <p style={{ margin: 0, fontSize: '0.8125rem', color: 'var(--text-light)' }}>
              {t('gmn.account', { email: activeConnections.map((c) => c.email).join(', ') })}
            </p>
          )}

          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {units.map((unit) => (
              <div
                key={unit.id}
                data-testid="gmn-unit"
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 12,
                  padding: '12px 14px',
                  borderRadius: 10,
                  background: 'var(--surface-1)',
                }}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 600, fontSize: '0.875rem' }}>{unit.title}</div>
                  {unit.addressLine && (
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-light)' }}>
                      {unit.addressLine}
                    </div>
                  )}
                </div>
                <div style={{ textAlign: 'right' }}>
                  {unit.averageRating != null ? (
                    <>
                      <div style={{ fontWeight: 700, fontSize: '0.9375rem' }}>
                        {`★ ${numberFormat.format(unit.averageRating)}`}
                      </div>
                      <div style={{ fontSize: '0.75rem', color: 'var(--text-light)' }}>
                        {t('gmn.reviewsCount', { count: unit.totalReviewCount ?? 0 })}
                      </div>
                    </>
                  ) : (
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-light)' }}>
                      {t('gmn.noReviews')}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>

          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {activeConnections.length > 0 && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => {
                  setDialogConnectionId(activeConnections[0].id);
                  setDialogOpen(true);
                }}
              >
                {t('gmn.manageUnits')}
              </Button>
            )}
            {connectButton(t('gmn.useOtherAccount'), 'ghost')}
          </div>
        </div>
      )}

      {activeConnections.length > 0 && (
        <GbpUnitsDialog
          clienteId={clienteId}
          clienteNome={clienteNome}
          connections={activeConnections}
          initialConnectionId={dialogConnectionId}
          open={dialogOpen}
          onOpenChange={setDialogOpen}
        />
      )}
    </section>
  );
}
