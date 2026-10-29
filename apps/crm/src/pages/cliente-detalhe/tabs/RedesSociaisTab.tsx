import { useEffect, useRef, useState } from 'react';
import { useOutletContext, useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { getInstagramSummary, syncInstagramData } from '@/services/instagram';
import { useInstagramActivationEvent } from '@/hooks/useInstagramActivationEvent';
import { captureEvent } from '@/lib/analytics';
import { resolveIgError } from '@/lib/instagram-oauth-errors';
import { InstagramSection } from '../components/InstagramSection';
import { AutomationContactsSection } from '../components/AutomationContactsSection';
import { TikTokSection } from '../TikTokSection';
import { YouTubeSection } from '../YouTubeSection';
import { GoogleBusinessSection } from '../GoogleBusinessSection';
import type { ClienteDetalheOutletContext } from '../clienteTabs.model';

/**
 * "Redes sociais" tab: Instagram + TikTok sections, ported from the pre-split
 * ClienteDetalhePage (see git history at d30adeea), plus the OAuth-callback
 * query-param processing that used to live in that same file's top-level
 * effect.
 *
 * Query isolation: this tab only ever fires `igSummary` directly, plus
 * whatever TikTokSection fires internally (`ttSummary`, gated by
 * `feature_tiktok`) — never Entregas/Hub/Financeiro/dates/addresses queries.
 *
 * OAuth params (`ig_connected`, `ig_error`, `tt_error`, `tt_connected`, and the Google ones
 * `yt_connected`, `yt_error`, `yt_other`, `gbp_pick`, `gmn_error`): historically this
 * page mixed two mechanisms — `useInstagramActivationEvent` already used
 * React Router's `useSearchParams` for `ig_connected`, while a second,
 * separate effect used raw `window.history.replaceState` for `ig_error`/
 * `tt_error`. Porting that second effect to `useSearchParams` too introduces
 * a real hazard: two INDEPENDENT `useSearchParams()` consumers each computing
 * their own `next` snapshot from the SAME pre-navigation `location.search`
 * will race — whichever effect's `setSearchParams` call lands last silently
 * resurrects whatever param the other one just removed (verified empirically
 * with a spike: a plain "each effect deletes only its own param(s))" design
 * left `ig_connected` stuck in the URL forever, since
 * `useInstagramActivationEvent` marks itself "fired" on the very first run
 * and never retries).
 *
 * The fix: `useInstagramActivationEvent(clienteId)` is called FIRST (its
 * effect therefore always registers, and runs, before this component's own),
 * and this component's own effect defensively deletes ALL THREE known
 * OAuth-callback params from ITS OWN (accurate-at-mount) snapshot whenever
 * ANY of them is present — not just the two (`ig_error`/`tt_error`) it
 * actually processes. Since this effect's `setSearchParams` call is
 * guaranteed to run second within the same passive-effect flush, its
 * comprehensive snapshot is always the final write, regardless of whether
 * `useInstagramActivationEvent`'s own removal attempt got clobbered.
 * `ig_connected`'s ANALYTICS side effect (`captureEvent`) still fires
 * unconditionally from inside that hook's own effect body, independent of
 * which write ends up sticking in the URL, so the activation milestone is
 * never at risk from this race — only the URL cleanup was.
 */
const YT_ERROR_CODES = [
  'denied',
  'missing_scope',
  'no_refresh_token',
  'no_channel',
  'channel_in_use',
  'unknown',
] as const;
const GMN_ERROR_CODES = ['denied', 'missing_scope', 'no_refresh_token', 'unknown'] as const;

export default function RedesSociaisTab() {
  const { clienteId, cliente } = useOutletContext<ClienteDetalheOutletContext>();
  const navigate = useNavigate();
  const { t } = useTranslation('clients');
  const [igOffMetaOpen, setIgOffMetaOpen] = useState(false);
  // gbp_pick: connection id the OAuth callback wants the unit picker opened on. Kept in state
  // because the effect below strips the param from the URL.
  const [gbpPick, setGbpPick] = useState<string | null>(null);

  // ig_connected: fires the instagram_connected activation event and strips
  // its own param. Called BEFORE this component's own useSearchParams() below
  // — see the module doc above for why the order matters.
  useInstagramActivationEvent(clienteId);

  const [searchParams, setSearchParams] = useSearchParams();
  const processedOAuthParams = useRef(false);
  useEffect(() => {
    if (processedOAuthParams.current) return;
    const igConnected = searchParams.get('ig_connected');
    const igError = searchParams.get('ig_error');
    const ttError = searchParams.get('tt_error');
    const ttConnected = searchParams.get('tt_connected');
    const ytConnected = searchParams.get('yt_connected');
    const ytError = searchParams.get('yt_error');
    const ytOther = searchParams.get('yt_other');
    const gbpPickParam = searchParams.get('gbp_pick');
    const gmnError = searchParams.get('gmn_error');
    if (
      !igConnected &&
      !igError &&
      !ttError &&
      !ttConnected &&
      !ytConnected &&
      !ytError &&
      !ytOther &&
      !gbpPickParam &&
      !gmnError
    ) {
      return;
    }
    processedOAuthParams.current = true;

    const action = resolveIgError(igError);
    if (action?.kind === 'off_meta') {
      setIgOffMetaOpen(true);
    } else if (action?.kind === 'toast') {
      if (action.level === 'info') toast.info(t(action.i18nKey));
      else toast.error(t(action.i18nKey));
    }
    if (ttError === '1') {
      toast.error(t('detail.ttError'));
    }
    if (ttConnected === '1') {
      toast.success(t('detail.ttConnected'));
      captureEvent('tiktok_connected', { cliente_id: clienteId });
    }

    if (ytConnected === '1') {
      toast.success(t('googleOAuth.ytConnected'));
    }
    if (ytError) {
      const code = YT_ERROR_CODES.find((c) => c === ytError) ?? 'unknown';
      const other = ytOther?.trim().slice(0, 120);
      if (code === 'channel_in_use') {
        toast.error(
          other
            ? t('googleOAuth.ytError.channel_in_use', { nome: other })
            : t('googleOAuth.ytError.channel_in_use_unnamed'),
        );
      } else {
        toast.error(t(`googleOAuth.ytError.${code}`));
      }
    }
    if (gmnError) {
      const code = GMN_ERROR_CODES.find((c) => c === gmnError) ?? 'unknown';
      toast.error(t(`googleOAuth.gmnError.${code}`));
    }
    if (gbpPickParam) setGbpPick(gbpPickParam);

    const next = new URLSearchParams(searchParams);
    next.delete('ig_connected');
    next.delete('ig_error');
    next.delete('tt_error');
    next.delete('tt_connected');
    next.delete('yt_connected');
    next.delete('yt_error');
    next.delete('yt_other');
    next.delete('gbp_pick');
    next.delete('gmn_error');
    setSearchParams(next, { replace: true });
  }, [searchParams, setSearchParams, t, clienteId]);

  const {
    data: igSummary,
    isLoading: loadingIg,
    refetch: refetchIg,
  } = useQuery({
    queryKey: ['igSummary', clienteId],
    queryFn: () => getInstagramSummary(clienteId).catch(() => null),
    enabled: !isNaN(clienteId),
  });

  const igSyncAttempted = useRef(false);
  useEffect(() => {
    if (!igSummary || igSyncAttempted.current) return;
    if (!igSummary.account?.last_synced_at) {
      igSyncAttempted.current = true;
      syncInstagramData(clienteId)
        .then(() => refetchIg())
        .catch(() => refetchIg());
    }
  }, [igSummary, clienteId, refetchIg]);

  return (
    <>
      <InstagramSection
        key={`ig-${clienteId}`}
        clienteId={clienteId}
        clienteEmail={cliente?.email ?? null}
        loadingIg={loadingIg}
        igSummary={igSummary}
        refetchIg={refetchIg}
        onNavigateAnalytics={() => navigate(`/analytics/${clienteId}`)}
      />

      <AutomationContactsSection clienteId={clienteId} clienteNome={cliente?.nome ?? ''} />

      <TikTokSection key={`tt-${clienteId}`} clienteId={clienteId} />

      <YouTubeSection key={`yt-${clienteId}`} clienteId={clienteId} />

      <GoogleBusinessSection
        key={`gmn-${clienteId}`}
        clienteId={clienteId}
        clienteNome={cliente?.nome ?? ''}
        pickConnectionId={gbpPick}
        onPickHandled={() => setGbpPick(null)}
      />

      {/* Instagram off-Meta activity setting blocked the OAuth connection */}
      <AlertDialog open={igOffMetaOpen} onOpenChange={setIgOffMetaOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('detail.igOffMetaTitle')}</AlertDialogTitle>
            <AlertDialogDescription>{t('detail.igOffMetaIntro')}</AlertDialogDescription>
          </AlertDialogHeader>
          <ol className="list-decimal space-y-1.5 pl-5 text-sm text-muted-foreground">
            <li>{t('detail.igOffMetaStep1')}</li>
            <li>{t('detail.igOffMetaStep2')}</li>
            <li>{t('detail.igOffMetaStep3')}</li>
            <li>{t('detail.igOffMetaStep4')}</li>
          </ol>
          <AlertDialogFooter>
            <AlertDialogAction onClick={() => setIgOffMetaOpen(false)}>
              {t('detail.igOffMetaOk')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
