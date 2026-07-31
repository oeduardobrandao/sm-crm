import { useEffect, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { captureEvent } from '@/lib/analytics';

/**
 * Fires the `instagram_connected` activation milestone when the OAuth callback lands back on
 * the client page.
 *
 * The success leg of the Meta flow redirects to `/clientes/:id?ig_connected=new|reconnect` (see
 * `supabase/functions/instagram-integration/index.ts`). Counting the return leg rather than the
 * button click is the entire point: an abandoned or denied consent screen is not an activation,
 * and `instagram_connect_started` already covers intent.
 *
 * The marker is stripped as soon as it is read, so a refresh, a back-navigation or a pasted URL
 * cannot inflate the milestone. `setSearchParams` rather than `history.replaceState` because the
 * app runs on a data router, which owns the location.
 */
export function useInstagramActivationEvent(clienteId: number): void {
  const [searchParams, setSearchParams] = useSearchParams();
  const fired = useRef(false);

  useEffect(() => {
    if (fired.current || Number.isNaN(clienteId)) return;
    const marker = searchParams.get('ig_connected');
    if (marker !== 'new' && marker !== 'reconnect') return;

    fired.current = true;
    // Both are real connections, so both are worth having: `reconnect` is a token-expiry signal
    // in its own right. Only `new` is an activation, so funnels must filter on this property.
    captureEvent('instagram_connected', {
      cliente_id: clienteId,
      connection_type: marker,
    });

    const next = new URLSearchParams(searchParams);
    next.delete('ig_connected');
    setSearchParams(next, { replace: true });
  }, [clienteId, searchParams, setSearchParams]);
}
