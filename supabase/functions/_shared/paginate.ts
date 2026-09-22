// Paginated reads for edge functions.
//
// PostgREST silently truncates any un-limited select at db-max-rows (1000 on
// hosted Supabase) with NO error — the audit found seven crons/endpoints that
// would return silently wrong data past that. fetchAllRows drains a query via
// .range() pages instead.
//
// CONTRACT for callers:
// - The underlying query MUST have a total order ending in an `id` tiebreak,
//   or .range() can skip/repeat rows across pages (see
//   instagram-sync-cron/index.ts selection comment).
// - Advancement is by rows RECEIVED, and the loop stops only on an EMPTY
//   page: correct even when db-max-rows is smaller than pageSize.
// - Any page error throws. Callers that must not act on a partial set (e.g.
//   billing sweeps) rely on this: never catch-and-continue around it.
export async function fetchAllRows<T>(
  fetchPage: (
    from: number,
    to: number,
  ) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
  pageSize = 1000,
): Promise<T[]> {
  const all: T[] = [];
  let from = 0;
  while (true) {
    const { data, error } = await fetchPage(from, from + pageSize - 1);
    if (error) throw new Error(`paginated read failed at offset ${from}: ${error.message}`);
    const rows = data ?? [];
    if (rows.length === 0) break;
    all.push(...rows);
    from += rows.length;
  }
  return all;
}

/** Keyset-paginated drain for correctness-critical sets. Offset (.range)
 * pagination can SKIP rows when a concurrent write removes a row from the
 * filtered set between pages (rows shift left). Keyset pagination re-anchors
 * each page on the last key actually seen, so concurrent removals can never
 * cause a skip. `fetchPage` must apply: .gt(keyCol, after) when after != null,
 * .order(keyCol asc) and .limit(pageSize). Throws on any page error. */
export async function fetchAllRowsKeyset<T>(
  fetchPage: (
    after: string | null,
  ) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
  getKey: (row: T) => string,
  pageSize = 1000,
): Promise<T[]> {
  const all: T[] = [];
  let after: string | null = null;
  while (true) {
    const { data, error } = await fetchPage(after);
    if (error) {
      throw new Error(`keyset paginated read failed after key ${after ?? "<start>"}: ${error.message}`);
    }
    const rows = data ?? [];
    if (rows.length === 0) break;
    all.push(...rows);
    const lastKey = getKey(rows[rows.length - 1]);
    if (lastKey === after) {
      throw new Error(`keyset paginated read did not advance past key ${lastKey}: possible infinite loop`);
    }
    after = lastKey;
  }
  return all;
}

/** Splits `.in(...)` id lists so neither the request URL nor the response can
 * hit PostgREST limits. 500 matches data-import's IN_CHUNK. */
export function chunk<T>(items: T[], size = 500): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}
