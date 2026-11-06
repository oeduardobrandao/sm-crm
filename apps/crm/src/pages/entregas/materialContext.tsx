import { createContext, useContext } from 'react';
import type { MaterialSummaryRow } from '@/store/postReferences';
import { MaterialBadge } from './components/MaterialBadge';
import { materialBadge } from './materialSummary';

const EMPTY: ReadonlyMap<number, MaterialSummaryRow> = new Map();

/**
 * The page fetches the material summary ONCE for the whole list (chunks of 200) and the
 * cards read their row from here, so no card ever issues its own request.
 */
export const MaterialSummaryContext = createContext<ReadonlyMap<number, MaterialSummaryRow>>(EMPTY);

export function PostMaterialBadge({ postId, status }: { postId: number; status: string }) {
  const rows = useContext(MaterialSummaryContext);
  const badge = materialBadge(rows.get(postId), status);
  return badge ? <MaterialBadge {...badge} /> : null;
}
