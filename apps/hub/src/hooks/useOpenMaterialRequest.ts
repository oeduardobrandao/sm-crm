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
