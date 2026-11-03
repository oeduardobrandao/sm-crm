import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import {
  GoogleServiceError,
  isGoogleSyncIncomplete,
  syncGoogleProduct,
  type GoogleProduct,
} from '@/services/google';
import { isYouTubeTabQuery } from '../../analytics-conta/youtube/useYouTubeTabData';
import { isGbpTabQuery } from '../../analytics-conta/google/useGoogleTabData';

// The analytics tabs' own sync messages, so both places say the same thing.
const MESSAGES: Record<
  GoogleProduct,
  {
    success: string;
    incomplete: string;
    rateLimited: string;
    reconnect: string;
    error: string;
  }
> = {
  youtube: {
    success: 'analyticsYoutube:states.syncSuccess',
    incomplete: 'analyticsYoutube:states.syncIncomplete',
    rateLimited: 'analyticsYoutube:states.syncRateLimited',
    reconnect: 'clients:youtube.revokedBanner',
    error: 'analyticsYoutube:states.syncError',
  },
  gbp: {
    success: 'analyticsGoogle:sync.success',
    incomplete: 'analyticsGoogle:sync.incomplete',
    rateLimited: 'analyticsGoogle:sync.rateLimited',
    reconnect: 'clients:gmn.revokedBanner',
    error: 'analyticsGoogle:sync.error',
  },
};

/**
 * "Sincronizar Dados" on the Redes sociais YouTube / Google Meu Negócio cards: the same
 * POST /sync the analytics tabs call. Refreshes the card's summary and that product's
 * analytics queries.
 */
export function useGoogleProductSync(product: GoogleProduct, clientId: number) {
  const qc = useQueryClient();
  const { t } = useTranslation(['clients', 'analyticsYoutube', 'analyticsGoogle']);
  const [syncing, setSyncing] = useState(false);
  const messages = MESSAGES[product];
  const refresh = () =>
    Promise.all([
      qc.invalidateQueries({ queryKey: ['googleSummary', clientId] }),
      qc.invalidateQueries({
        predicate: product === 'youtube' ? isYouTubeTabQuery(clientId) : isGbpTabQuery(clientId),
      }),
    ]);

  const sync = async () => {
    setSyncing(true);
    try {
      const result = await syncGoogleProduct(product, clientId);
      // Quota, approval or a token that died mid-run: the call worked, the sync did not finish.
      if (isGoogleSyncIncomplete(result)) toast.info(t(messages.incomplete));
      else toast.success(t(messages.success));
      await refresh();
    } catch (e) {
      const code = e instanceof GoogleServiceError ? e.code : null;
      const needsReconnect = code === 'reconnect' || code === 'revoked';
      toast.error(
        code === 'rate_limited'
          ? t(messages.rateLimited)
          : needsReconnect
            ? t(messages.reconnect)
            : t(messages.error),
      );
      // The summary carries the authorization status and the units: refetch for the callout.
      if (needsReconnect || code === 'not_connected') await refresh();
    } finally {
      setSyncing(false);
    }
  };

  return { sync, syncing };
}
