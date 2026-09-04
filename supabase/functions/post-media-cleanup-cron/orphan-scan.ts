// R2 orphan scan, extracted and hardened after the 2026-08 incident: the previous
// inline version passed the ENTIRE candidate list to four `.in()` queries. Past
// PostgREST's URL limit those queries fail, and `data ?? []` silently produced an
// EMPTY known set — so every aged object in the bucket looked like an orphan and
// was deleted. This module makes the three properties the incident proved
// necessary explicit:
//   1. `.in()` queries run in bounded chunks (KNOWN_CHUNK keys per query);
//   2. ANY query error aborts the SCAN TARGET it belongs to BEFORE any deletion
//      in that target (a failure in one target never blocks another target);
//   3. a non-trivial candidate list with a suspiciously empty known set aborts
//      that target — deleting "everything" is never a plausible correct outcome.
//
// The scan runs over multiple R2 prefixes ("scan targets"), each with its own
// reference table(s)/column(s). MAX_TRASH_PER_RUN is a single budget shared
// across every target in a run.

export const KNOWN_CHUNK = 50;
/** With at least this many aged candidates, an empty known set means the
 * reference queries lied (or the DB is unreachable) — never that every single
 * object is genuinely orphaned. */
export const EMPTY_KNOWN_FLOOR = 50;
/** Hard ceiling on automated removals per run, shared across ALL scan targets.
 * A legitimate hourly run trims a handful of stragglers; anything near this cap
 * is an anomaly that a human should look at first. The remainder waits for
 * later runs (or the human). */
export const MAX_TRASH_PER_RUN = 50;

interface DbError {
  message: string;
}

export type ScanTable = "post_media" | "files" | "hub_briefing_questions";

export type ScanTarget = {
  prefix: string;
  refs: Array<{ table: ScanTable; columns: string[] }>;
};

export const SCAN_TARGETS: ScanTarget[] = [
  {
    prefix: "contas/",
    refs: [
      { table: "post_media", columns: ["r2_key", "thumbnail_r2_key"] },
      { table: "files", columns: ["r2_key", "thumbnail_r2_key"] },
    ],
  },
  // Áudio do briefing vive fora de contas/ de propósito (ver migration
  // 20260907000001); sem este alvo, uploads pré-assinados sem finalize
  // ficariam no bucket para sempre.
  {
    prefix: "briefing-audio/",
    refs: [{ table: "hub_briefing_questions", columns: ["audio_r2_key"] }],
  },
];

export interface OrphanScanDeps {
  db: {
    from(table: ScanTable): {
      select(columns: string): {
        in(
          column: string,
          values: string[],
        ): PromiseLike<{
          data: Array<Record<string, string | null>> | null;
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
  let candidatesTotal = 0;
  let trashedTotal = 0;
  let cappedTotal = 0;
  let aborted: string | null = null;

  for (const target of SCAN_TARGETS) {
    const candidates = await deps.listOrphanKeys(target.prefix, 24 * 60 * 60 * 1000);
    candidatesTotal += candidates.length;
    if (candidates.length === 0) continue;

    const known = new Set<string>();
    let targetAborted: string | null = null;

    columnLoop: for (const ref of target.refs) {
      for (const column of ref.columns) {
        for (const batch of chunk(candidates, KNOWN_CHUNK)) {
          const { data, error } = await deps.db
            .from(ref.table)
            .select(ref.columns.join(", "))
            .in(column, batch);
          if (error) {
            // Property 2: a failed reference query means this target's known
            // set is incomplete. Deleting against an incomplete set is how the
            // incident happened — abort THIS TARGET with zero deletions, but
            // let the remaining targets still run.
            console.error("orphan-scan:known-query", ref.table, column, error.message);
            targetAborted = `known-query:${ref.table}.${column}`;
            break columnLoop;
          }
          for (const row of data ?? []) {
            for (const col of ref.columns) {
              const value = row[col];
              if (typeof value === "string" && value) known.add(value);
            }
          }
        }
      }
    }

    if (targetAborted) {
      if (aborted === null) aborted = targetAborted;
      continue;
    }

    if (known.size === 0 && candidates.length >= EMPTY_KNOWN_FLOOR) {
      console.error("orphan-scan:empty-known-set", target.prefix, candidates.length, "candidates");
      if (aborted === null) aborted = "empty-known-set";
      continue;
    }

    for (const key of candidates) {
      if (known.has(key)) continue;
      if (trashedTotal >= MAX_TRASH_PER_RUN) {
        cappedTotal++;
        continue;
      }
      try {
        await deps.trashObject(key);
        trashedTotal++;
      } catch (e) {
        console.error("orphan-scan:trash", key, e); // retried next run
      }
    }
  }

  if (cappedTotal > 0) console.error("orphan-scan:capped", cappedTotal, "orphans deferred to later runs");
  return { candidates: candidatesTotal, trashed: trashedTotal, capped: cappedTotal, aborted };
}
