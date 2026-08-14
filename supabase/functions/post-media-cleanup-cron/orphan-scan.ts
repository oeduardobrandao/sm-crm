// R2 orphan scan, extracted and hardened after the 2026-08 incident: the previous
// inline version passed the ENTIRE candidate list to four `.in()` queries. Past
// PostgREST's URL limit those queries fail, and `data ?? []` silently produced an
// EMPTY known set — so every aged object in the bucket looked like an orphan and
// was deleted. This module makes the three properties the incident proved
// necessary explicit:
//   1. `.in()` queries run in bounded chunks (KNOWN_CHUNK keys per query);
//   2. ANY query error aborts the scan BEFORE any deletion;
//   3. a non-trivial candidate list with a suspiciously empty known set aborts —
//      deleting "everything" is never a plausible correct outcome.

export const KNOWN_CHUNK = 200;
/** With at least this many aged candidates, an empty known set means the
 * reference queries lied (or the DB is unreachable) — never that every single
 * object is genuinely orphaned. */
export const EMPTY_KNOWN_FLOOR = 50;
/** Hard ceiling on automated removals per run. A legitimate hourly run trims a
 * handful of stragglers; anything near this cap is an anomaly that a human
 * should look at first. The remainder waits for later runs (or the human). */
export const MAX_TRASH_PER_RUN = 50;

interface DbError {
  message: string;
}

export interface OrphanScanDeps {
  db: {
    from(table: "post_media" | "files"): {
      select(columns: string): {
        in(
          column: string,
          values: string[],
        ): PromiseLike<{
          data: Array<{ r2_key: string | null; thumbnail_r2_key: string | null }> | null;
          error: DbError | null;
        }>;
      };
    };
  };
  listOrphanKeys(prefix: string, olderThanMs: number): Promise<string[]>;
  /** Two-phase remove (copy to trash/ then delete) — never a hard delete. */
  trashObject(key: string): Promise<void>;
}

export interface OrphanScanResult {
  candidates: number;
  /** Objects moved to trash/ this run (recoverable for 30 days). */
  trashed: number;
  /** Orphans left for later runs because MAX_TRASH_PER_RUN was hit. */
  capped: number;
  aborted: string | null;
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

export async function runOrphanScan(deps: OrphanScanDeps): Promise<OrphanScanResult> {
  const candidates = await deps.listOrphanKeys("contas/", 24 * 60 * 60 * 1000);
  if (candidates.length === 0) return { candidates: 0, trashed: 0, capped: 0, aborted: null };

  const known = new Set<string>();
  for (const table of ["post_media", "files"] as const) {
    for (const column of ["r2_key", "thumbnail_r2_key"]) {
      for (const batch of chunk(candidates, KNOWN_CHUNK)) {
        const { data, error } = await deps.db
          .from(table)
          .select("r2_key, thumbnail_r2_key")
          .in(column, batch);
        if (error) {
          // Property 2: a failed reference query means the known set is
          // incomplete. Deleting against an incomplete set is how the incident
          // happened — abort with zero deletions.
          console.error("orphan-scan:known-query", table, column, error.message);
          return { candidates: candidates.length, trashed: 0, capped: 0, aborted: `known-query:${table}.${column}` };
        }
        for (const row of data ?? []) {
          if (row.r2_key) known.add(row.r2_key);
          if (row.thumbnail_r2_key) known.add(row.thumbnail_r2_key);
        }
      }
    }
  }

  if (known.size === 0 && candidates.length >= EMPTY_KNOWN_FLOOR) {
    console.error("orphan-scan:empty-known-set", candidates.length, "candidates");
    return { candidates: candidates.length, trashed: 0, capped: 0, aborted: "empty-known-set" };
  }

  let trashed = 0;
  let capped = 0;
  for (const key of candidates) {
    if (known.has(key)) continue;
    if (trashed >= MAX_TRASH_PER_RUN) {
      capped++;
      continue;
    }
    try {
      await deps.trashObject(key);
      trashed++;
    } catch (e) {
      console.error("orphan-scan:trash", key, e); // retried next run
    }
  }
  if (capped > 0) console.error("orphan-scan:capped", capped, "orphans deferred to later runs");
  return { candidates: candidates.length, trashed, capped, aborted: null };
}
