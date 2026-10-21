/**
 * Drains a PostgREST-style paginated query. Supabase caps any single select at
 * the server's max-rows (1000 by default) SILENTLY, so unbounded reads must
 * page with .range(from, to) until a short page signals the end.
 */
export async function fetchAllPaged<T>(
  fetchPage: (from: number, to: number) => Promise<T[]>,
  pageSize = 1000,
): Promise<T[]> {
  const all: T[] = [];
  for (let from = 0; ; from += pageSize) {
    const page = await fetchPage(from, from + pageSize - 1);
    all.push(...page);
    if (page.length < pageSize) return all;
  }
}

/**
 * Max ids per `.in()` filter. The list travels in the request URL, so a
 * workspace with hundreds of workflows needs several requests, not one huge one.
 */
export const IN_FILTER_CHUNK = 150;

/**
 * Bulk read keyed by an id list: one paged query per chunk of IN_FILTER_CHUNK
 * ids (chunks in parallel), instead of one request per id. Duplicate ids are
 * dropped. Rows come back chunk by chunk, each chunk in the query's own order.
 */
export async function fetchAllPagedByIds<T, Id extends string | number>(
  ids: Id[],
  fetchPage: (chunk: Id[], from: number, to: number) => Promise<T[]>,
): Promise<T[]> {
  const unique = [...new Set(ids)];
  const chunks: Id[][] = [];
  for (let i = 0; i < unique.length; i += IN_FILTER_CHUNK) {
    chunks.push(unique.slice(i, i + IN_FILTER_CHUNK));
  }
  const results = await Promise.all(
    chunks.map((chunk) => fetchAllPaged((from, to) => fetchPage(chunk, from, to))),
  );
  return results.flat();
}
