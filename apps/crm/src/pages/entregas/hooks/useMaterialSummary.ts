import { useQuery } from '@tanstack/react-query';
import type { MaterialSummaryRow } from '@/store/postReferences';
import { fetchMaterialSummaryMap } from '../materialSummary';

const EMPTY: Map<number, MaterialSummaryRow> = new Map();

/**
 * Material-request summary for a whole list of posts (one request per 200 ids). The key
 * starts with ['post-material-summary', scope], so saving or deleting a reference, which
 * invalidates the ['post-material-summary'] prefix, refreshes every list showing it.
 */
export function useMaterialSummary(
  postIds: number[],
  scope: string | number,
  enabled = true,
): Map<number, MaterialSummaryRow> {
  const { data } = useQuery({
    queryKey: ['post-material-summary', scope, postIds.join(',')],
    queryFn: () => fetchMaterialSummaryMap(postIds),
    enabled: enabled && postIds.length > 0,
  });
  return data ?? EMPTY;
}
