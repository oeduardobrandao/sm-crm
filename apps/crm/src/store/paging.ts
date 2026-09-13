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
