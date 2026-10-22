import { useCallback, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';

/** The two fields a client photo is resolved from. */
export interface ClienteFotoSource {
  id?: number | null;
  foto_url?: string | null;
}

/**
 * Instagram profile pictures keyed by client id, for every client in `clientes`.
 * One query key and one shape for every surface, so the board, the client list and
 * the dashboard share a single cached fetch.
 */
export function useInstagramAvatars(clientes: readonly ClienteFotoSource[]) {
  const ids = useMemo(
    () =>
      [...new Set(clientes.map((c) => c.id).filter((id): id is number => id != null))].sort(
        (a, b) => a - b,
      ),
    [clientes],
  );
  return useQuery({
    queryKey: ['instagram-avatars', ids.join(',')],
    queryFn: async () => {
      const { data } = await supabase
        .from('instagram_accounts')
        .select('client_id, profile_picture_url')
        .in('client_id', ids)
        .not('profile_picture_url', 'is', null);
      const map = new Map<number, string>();
      if (data)
        for (const row of data)
          if (row.client_id && row.profile_picture_url)
            map.set(row.client_id, row.profile_picture_url);
      return map;
    },
    enabled: ids.length > 0,
  });
}

/**
 * A client's photo candidates, best first: the synced Instagram avatar (kept fresh by
 * the sync cron), then the photo uploaded on the client page. Feed the list to
 * `ClienteFoto`, which skips a URL that fails to load (Instagram CDN URLs expire) and
 * shows the initials only when none loads.
 *
 * `fotosDe` also accepts a client that is not in `clientes` (its `foto_url` still
 * counts), and resolves a bare id against `clientes`.
 */
export function useClienteAvatars(clientes: readonly ClienteFotoSource[]) {
  const { data: igAvatars } = useInstagramAvatars(clientes);
  const byId = useMemo(() => {
    const map = new Map<number, ClienteFotoSource>();
    for (const c of clientes) if (c.id != null) map.set(c.id, c);
    return map;
  }, [clientes]);

  const fotosDe = useCallback(
    (cliente: ClienteFotoSource | number | null | undefined): string[] => {
      const c = typeof cliente === 'number' ? byId.get(cliente) : cliente;
      if (!c) return [];
      const manual = c.foto_url ?? (c.id != null ? byId.get(c.id)?.foto_url : null);
      const ig = c.id != null ? igAvatars?.get(c.id) : undefined;
      return [ig, manual].filter((u): u is string => !!u);
    },
    [byId, igAvatars],
  );

  return { igAvatars, fotosDe };
}

/**
 * The photo uploaded for a client, read from the `['clientes']` list the signed-in
 * pages already cache. Never fetches: for rows (client health) whose data comes from
 * an RPC that only carries the Instagram avatar.
 */
export function useCachedClienteFotoUrl(clienteId: number | null | undefined): string | undefined {
  const { data } = useQuery<ClienteFotoSource[]>({ queryKey: ['clientes'], enabled: false });
  if (clienteId == null) return undefined;
  return data?.find((c) => c.id === clienteId)?.foto_url ?? undefined;
}
