import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { hubMaterialRequestsQuery } from '../queries';
import type { HubMaterialRequest } from '../services/materialRequests';

/**
 * The post's open material request, or null. Reads the shared requests list (same cache entry as
 * the nav badge), not the per-post references list: that one answers `request: null` once the
 * request is concluded, and the list is what the rest of the Hub already keeps fresh.
 */
export function useOpenMaterialRequest(token: string, postId: number): HubMaterialRequest | null {
  const { data } = useQuery(hubMaterialRequestsQuery(token));
  return data?.find((r) => r.post_id === postId) ?? null;
}

/**
 * Keeps a request dialog's entry alive across the refetch that drops it. GET /requests lists
 * only open requests, so an auto-completing upload, a team close or `request_closed` remove the
 * entry while the client is still looking at it (and maybe still uploading to a sibling item).
 * While `active`, the last seen entry for `postId` stays and `closed` says it left the list.
 */
export function useStickyMaterialRequest(
  live: HubMaterialRequest | null,
  postId: number | null,
  active: boolean,
): { entry: HubMaterialRequest | null; closed: boolean } {
  const [snapshot, setSnapshot] = useState<HubMaterialRequest | null>(null);
  useEffect(() => {
    if (!active) setSnapshot(null);
    else if (live) setSnapshot(live);
  }, [active, live]);
  const kept = active && snapshot !== null && snapshot.post_id === postId ? snapshot : null;
  const entry = live ?? kept;
  return { entry, closed: entry !== null && live === null };
}
