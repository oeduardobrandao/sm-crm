import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { AlertTriangle, Clock, Loader2, Unplug, Youtube } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ReportSkeleton } from '@/components/ui/skeletons';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { sanitizeUrl } from '@/utils/security';
import { useWorkspaceLimits } from '../../hooks/useWorkspaceLimits';
import { disconnectYouTube, getGoogleAuthUrl, getGoogleSummary } from '../../services/google';

// maximumFractionDigits: 1 is needed for "12,4 mil": bare compact notation keeps only two
// significant digits for values under 100 mil ("12 mil").
const compactNumber = new Intl.NumberFormat('pt-BR', {
  notation: 'compact',
  maximumFractionDigits: 1,
});

function formatCount(value: number | null | undefined): string {
  return value == null ? '-' : compactNumber.format(value);
}

function channelUrl(handle: string | null, channelId: string): string {
  if (handle) {
    const clean = handle.replace(/^@/, '');
    return `https://www.youtube.com/@${encodeURIComponent(clean)}`;
  }
  return `https://www.youtube.com/channel/${encodeURIComponent(channelId)}`;
}

// YouTube connection card for the "Redes sociais" tab (Phase 1: connect / disconnect only).
// Follows the TikTokSection rule: renders nothing, fetches nothing, unless the
// `feature_youtube` entitlement is on. The query key is shared with the Google Meu
// Negócio section: both halves come from one /summary call.
export function YouTubeSection({ clienteId }: { clienteId: number }) {
  const { t } = useTranslation('clients');
  const queryClient = useQueryClient();
  const { features } = useWorkspaceLimits();
  const enabled = !!features?.feature_youtube;
  const validId = !isNaN(clienteId);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [redirecting, setRedirecting] = useState(false);

  const {
    data: summary,
    isLoading,
    isError,
  } = useQuery({
    queryKey: ['googleSummary', clienteId],
    queryFn: () => getGoogleSummary(clienteId),
    enabled: enabled && validId,
  });

  const disconnect = useMutation({
    mutationFn: () => disconnectYouTube(clienteId),
    onSuccess: () => {
      setConfirmOpen(false);
      toast.success(t('youtube.disconnectSuccess'));
      queryClient.invalidateQueries({ queryKey: ['googleSummary', clienteId] });
    },
    onError: () => {
      toast.error(t('youtube.disconnectError'));
    },
  });

  async function handleConnect() {
    setRedirecting(true);
    try {
      const url = await getGoogleAuthUrl(clienteId, 'youtube');
      window.location.href = url;
    } catch (err) {
      setRedirecting(false);
      const code = (err as { code?: string }).code;
      toast.error(
        code === 'feature_disabled' ? t('youtube.featureDisabled') : t('youtube.connectError'),
      );
    }
  }

  if (!enabled) return null;

  const channel = summary?.youtube ?? null;
  const revoked = channel?.authorizationStatus === 'revoked';

  const connectButton = (label: string, variant: 'default' | 'outline' = 'default') => (
    <Button
      type="button"
      variant={variant}
      size={variant === 'outline' ? 'sm' : 'default'}
      onClick={handleConnect}
      disabled={redirecting}
    >
      {redirecting && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />}
      {redirecting ? t('youtube.connecting') : label}
    </Button>
  );

  return (
    <section
      className="card"
      data-testid="youtube-section"
      aria-label={t('youtube.title')}
      style={{ padding: '1.25rem', marginBottom: '1.5rem' }}
    >
      {isLoading && <ReportSkeleton />}

      {!isLoading && isError && (
        <p role="alert" style={{ margin: 0, fontSize: '0.875rem', color: 'var(--danger-text)' }}>
          {t('youtube.loadError')}
        </p>
      )}

      {!isLoading && !isError && !channel && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <Youtube size={24} color="#dc2626" aria-hidden="true" />
            <h3 id="youtube-card-title" style={{ margin: 0, fontSize: '1rem', fontWeight: 600 }}>
              {t('youtube.connectTitle')}
            </h3>
          </div>
          <p style={{ margin: 0, fontSize: '0.875rem', lineHeight: 1.5 }}>
            {t('youtube.connectDescription')}
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
            <li>{t('youtube.connectBullet1')}</li>
            <li>{t('youtube.connectBullet2')}</li>
          </ul>
          <div>{connectButton(t('youtube.connectButton'))}</div>
        </div>
      )}

      {!isLoading && !isError && channel && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <Youtube size={24} color="#dc2626" aria-hidden="true" />
            <h3 id="youtube-card-title" style={{ margin: 0, fontSize: '1rem', fontWeight: 600 }}>
              {t('youtube.title')}
            </h3>
            {!revoked && <Badge variant="success">{t('youtube.connected')}</Badge>}
            <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
              <Button
                type="button"
                variant="outline"
                size="icon"
                aria-label={t('youtube.disconnectTooltip')}
                title={t('youtube.disconnectTooltip')}
                onClick={() => setConfirmOpen(true)}
              >
                <Unplug className="h-4 w-4" aria-hidden="true" />
              </Button>
            </div>
          </div>

          {revoked && (
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
                {t('youtube.revokedBanner')}
              </div>
              {connectButton(t('youtube.reconnect'), 'outline')}
            </div>
          )}

          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            {channel.avatarUrl && (
              <img
                src={sanitizeUrl(channel.avatarUrl)}
                alt={t('youtube.channelAvatarAlt', { name: channel.title ?? '' })}
                width={40}
                height={40}
                referrerPolicy="no-referrer"
                style={{ borderRadius: '50%', objectFit: 'cover' }}
              />
            )}
            <div style={{ minWidth: 0 }}>
              <div style={{ fontWeight: 600, fontSize: '0.9375rem' }}>{channel.title}</div>
              <a
                href={sanitizeUrl(channelUrl(channel.handle, channel.channelId))}
                target="_blank"
                rel="noopener noreferrer"
                style={{ fontSize: '0.8125rem' }}
              >
                {channel.handle
                  ? `youtube.com/@${channel.handle.replace(/^@/, '')}`
                  : `youtube.com/channel/${channel.channelId}`}
              </a>
            </div>
          </div>

          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
              gap: 12,
              padding: 14,
              borderRadius: 10,
              background: 'var(--surface-1)',
            }}
          >
            <Stat value={formatCount(channel.subscriberCount)} label={t('youtube.subscribers')} />
            <Stat value={formatCount(channel.viewCount)} label={t('youtube.totalViews')} />
            <Stat value={formatCount(channel.videoCount)} label={t('youtube.videos')} />
          </div>

          <p
            style={{
              margin: 0,
              fontSize: '0.75rem',
              display: 'flex',
              gap: 6,
              alignItems: 'center',
              color: 'var(--text-light)',
            }}
          >
            <Clock size={14} aria-hidden="true" />
            {t('youtube.delayNote')}
          </p>
        </div>
      )}

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('youtube.disconnectTitle')}</AlertDialogTitle>
            <AlertDialogDescription>{t('youtube.disconnectBody')}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={disconnect.isPending}>
              {t('youtube.disconnectCancel')}
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={disconnect.isPending}
              onClick={(e) => {
                // Keep the dialog open until the request settles (onSuccess closes it).
                e.preventDefault();
                disconnect.mutate();
              }}
            >
              {t('youtube.disconnectConfirm')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <div>
      <div style={{ fontSize: '1.25rem', fontWeight: 700, letterSpacing: '-0.02em' }}>{value}</div>
      <div style={{ fontSize: '0.75rem', color: 'var(--text-light)' }}>{label}</div>
    </div>
  );
}
