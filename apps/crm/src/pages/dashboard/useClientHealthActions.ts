import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import type { ClientHealth } from '../../services/clientHealth';
import { getInstagramAuthUrl, syncInstagramData } from '../../services/instagram';

/** Conectar/Reconectar (Instagram OAuth) and Sincronizar of a client health card, shared
 *  by the desktop card and the phone detail sheet. */
export function useClientHealthActions(c: ClientHealth) {
  const { t } = useTranslation('dashboard');
  const [busy, setBusy] = useState(false);

  async function handleConnect() {
    setBusy(true);
    try {
      const url = await getInstagramAuthUrl(c.client_id);
      window.location.href = url;
    } catch {
      toast.error(t('health.error'));
      setBusy(false);
    }
  }

  async function handleSync() {
    setBusy(true);
    try {
      await syncInstagramData(c.client_id);
      toast.success(t('health.success.sincronizar'));
    } catch {
      toast.error(t('health.error'));
    } finally {
      setBusy(false);
    }
  }

  return { busy, handleConnect, handleSync };
}
