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
// reference table(s)/column(s) and its OWN MAX_TRASH_PER_RUN budget: a single
// shared budget let a busy contas/ starve briefing-audio/ forever (first target
// wins the whole cap, later ones reap nothing every run). Per-target totals are
// reported in `targets` so the cron alert can name which prefix was capped or
// aborted instead of collapsing them into one number.
//
// --- Paging + checkpoint (2026-09) ------------------------------------------
// The scan used to materialise every key under the prefix before looking at any
// of them, so its cost tracked the SIZE OF THE BUCKET rather than the amount of
// work to do. On prod that died with WORKER_RESOURCE_LIMIT (2026-08-13) and,
// because the scan is the last stage of post-media-cleanup-cron, the run died
// with it.
//
// Now each run spends a fixed budget of listing pages (`pagesPerRun`, ~1000 keys
// each) and persists the R2 ContinuationToken in `cron_scan_state`, so the next
// run resumes where this one stopped. Memory per run is bounded by the page
// size, not by the bucket. A full sweep of a prefix therefore takes several runs
// — that is the intended trade, and it costs nothing in reaping throughput
// because MAX_TRASH_PER_RUN already caps removals far below what one run can
// find. `cycle_started_at` in that table is how you tell whether a sweep is
// taking too long: if it keeps growing, raise ORPHAN_SCAN_PAGES_PER_RUN.
//
// Resuming means a sweep is eventually-consistent rather than a point-in-time
// snapshot: objects written during a sweep may land behind its cursor and only
// be examined on the next cycle. That is safe — the age filter already ignores
// anything younger than 24h, and the known-set check happens at trash time, not
// at listing time.

export const KNOWN_CHUNK = 50;
/** With at least this many aged candidates, an empty known set means the
 * reference queries lied (or the DB is unreachable) — never that every single
 * object is genuinely orphaned.
 *
 * Applied PER PAGE since the scan went paged. That makes the breaker strictly
 * more sensitive than the whole-bucket version it replaces (a full page is
 * ~1000 keys, far above the floor), which is the safe direction to err in. */
export const EMPTY_KNOWN_FLOOR = 50;
/** Hard ceiling on automated removals per run, applied PER SCAN TARGET.
 * A legitimate run trims a handful of stragglers; anything near this cap
 * is an anomaly that a human should look at first. The remainder waits for
 * later runs (or the human). */
export const MAX_TRASH_PER_RUN = 50;
/** Listing pages consumed per target per run. Paired with MAX_TRASH_PER_RUN:
 * ~1000 keys per page against a 50-removal ceiling, so 10 pages already finds
 * far more orphans than a run is allowed to act on. Raising this makes a full
 * sweep finish sooner; it does NOT make the cron reap faster. */
export const DEFAULT_PAGES_PER_RUN = 10;
/** Objects younger than this are never candidates: an upload whose finalize
 * call has not landed yet is not an orphan. */
export const CANDIDATE_AGE_MS = 24 * 60 * 60 * 1000;

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

/** Primary key in `cron_scan_state`. One row per prefix. */
export function scanKeyFor(prefix: string): string {
  return `orphan-scan:${prefix}`;
}

export interface OrphanKeyPage {
  keys: string[];
  nextToken: string | null;
}

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
  /** ONE page of the prefix. `token` null starts at the beginning. */
  listOrphanKeyPage(
    prefix: string,
    olderThanMs: number,
    token: string | null,
  ): Promise<OrphanKeyPage>;
  /** Two-phase remove (copy to trash/ then delete) — never a hard delete. */
  trashObject(key: string): Promise<void>;
  /** Resume position for this scan key, or null to start a fresh cycle.
   * Required rather than optional on purpose: a wiring mistake that dropped
   * checkpointing would leave the scan re-reading page 1 forever, which is
   * silent — the cron would look healthy and never reach the rest of the
   * bucket. Making it required means that mistake cannot compile. */
  readCheckpoint(scanKey: string): Promise<string | null>;
  writeCheckpoint(
    scanKey: string,
    token: string | null,
    opts: { cycleCompleted: boolean },
  ): Promise<void>;
  /** Listing pages per target this run. Defaults to DEFAULT_PAGES_PER_RUN. */
  pagesPerRun?: number;
}

/** Per-prefix outcome. One entry per SCAN_TARGETS entry, always, even when the
 * target had zero candidates. */
export interface OrphanScanTargetResult {
  prefix: string;
  candidates: number;
  trashed: number;
  capped: number;
  aborted: string | null;
  /** Listing pages consumed this run. */
  pages: number;
  /** True when this run picked up mid-prefix from a stored checkpoint. */
  resumed: boolean;
  /** True when this run reached the end of the prefix; the next run restarts. */
  cycleCompleted: boolean;
}

export interface OrphanScanResult {
  /** Sum across targets. */
  candidates: number;
  /** Objects moved to trash/ this run (recoverable for 30 days), all targets. */
  trashed: number;
  /** Orphans left for later runs because a target hit MAX_TRASH_PER_RUN. */
  capped: number;
  /** "prefix: reason" for every aborted target, joined with "; " — null when
   * none aborted. An abort in a later target is never hidden by an earlier one. */
  aborted: string | null;
  /** Listing pages consumed across all targets. */
  pages: number;
  /** Prefixes fully swept this run. */
  cyclesCompleted: number;
  targets: OrphanScanTargetResult[];
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

/** Builds the known set for one page of candidates. Returns the abort reason
 * (properties 2 and 3) or null when the set can be trusted. */
async function buildKnownSet(
  deps: OrphanScanDeps,
  target: ScanTarget,
  candidates: string[],
): Promise<{ known: Set<string>; aborted: string | null }> {
  const known = new Set<string>();

  for (const ref of target.refs) {
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
          return { known, aborted: `known-query:${ref.table}.${column}` };
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

  if (known.size === 0 && candidates.length >= EMPTY_KNOWN_FLOOR) {
    console.error("orphan-scan:empty-known-set", target.prefix, candidates.length, "candidates");
    return { known, aborted: "empty-known-set" };
  }

  return { known, aborted: null };
}

export async function runOrphanScan(deps: OrphanScanDeps): Promise<OrphanScanResult> {
  const pagesPerRun = Math.max(1, deps.pagesPerRun ?? DEFAULT_PAGES_PER_RUN);
  const targets: OrphanScanTargetResult[] = [];

  for (const target of SCAN_TARGETS) {
    const outcome: OrphanScanTargetResult = {
      prefix: target.prefix,
      candidates: 0,
      trashed: 0,
      capped: 0,
      aborted: null,
      pages: 0,
      resumed: false,
      cycleCompleted: false,
    };
    targets.push(outcome);

    const scanKey = scanKeyFor(target.prefix);

    let token: string | null;
    try {
      token = await deps.readCheckpoint(scanKey);
    } catch (e) {
      // No resume position means the only safe alternative is restarting the
      // cycle, which would re-scan pages already swept and could take the same
      // budget forever. Skip the target instead and let the next run retry.
      console.error("orphan-scan:checkpoint-read", target.prefix, e);
      outcome.aborted = "checkpoint-read";
      continue;
    }
    outcome.resumed = token !== null;

    // Where the NEXT run should resume. Advances only past pages that were
    // fully processed; a page cut short by the trash cap or an abort is left
    // for the next run to re-read.
    let nextCheckpoint: string | null = token;

    while (outcome.pages < pagesPerRun) {
      const pageToken = token;
      let page: OrphanKeyPage;
      try {
        page = await deps.listOrphanKeyPage(target.prefix, CANDIDATE_AGE_MS, pageToken);
      } catch (e) {
        console.error("orphan-scan:list", target.prefix, e);
        // A continuation token can go stale (R2 rejects it) in a way that a
        // retry cannot fix — it would fail identically every run and wedge the
        // sweep at this position forever. Dropping it costs one re-sweep of
        // ground already covered; keeping it costs the whole prefix.
        outcome.aborted = pageToken ? "list:stale-token" : "list";
        nextCheckpoint = null;
        break;
      }
      outcome.pages++;
      outcome.candidates += page.keys.length;

      if (page.keys.length > 0) {
        const { known, aborted } = await buildKnownSet(deps, target, page.keys);
        if (aborted) {
          // Re-read this page next run: nothing was deleted from it.
          outcome.aborted = aborted;
          nextCheckpoint = pageToken;
          break;
        }

        for (const key of page.keys) {
          if (known.has(key)) continue;
          // Budget is per target: a contas/ flood must not starve briefing-audio/.
          if (outcome.trashed >= MAX_TRASH_PER_RUN) {
            outcome.capped++;
            continue;
          }
          try {
            await deps.trashObject(key);
            outcome.trashed++;
          } catch (e) {
            console.error("orphan-scan:trash", key, e); // retried next run
          }
        }

        if (outcome.trashed >= MAX_TRASH_PER_RUN) {
          // This page still holds orphans we were not allowed to touch. Point
          // the next run back at it rather than past it: the objects trashed
          // just now are gone from the listing, so re-reading the same token
          // returns the remainder plus whatever follows. The sweep still
          // advances, one cap's worth at a time.
          nextCheckpoint = pageToken;
          break;
        }
      }

      if (page.nextToken === null) {
        outcome.cycleCompleted = true;
        nextCheckpoint = null;
        break;
      }
      token = page.nextToken;
      nextCheckpoint = page.nextToken;
    }

    if (outcome.capped > 0) {
      console.error("orphan-scan:capped", target.prefix, outcome.capped, "orphans deferred to later runs");
    }

    try {
      await deps.writeCheckpoint(scanKey, nextCheckpoint, {
        cycleCompleted: outcome.cycleCompleted,
      });
    } catch (e) {
      // Losing the write means the next run re-reads from the old position:
      // wasted work, never wrong work. Not worth failing the run over.
      console.error("orphan-scan:checkpoint-write", target.prefix, e);
    }
  }

  const abortedList = targets.filter((t) => t.aborted).map((t) => `${t.prefix}: ${t.aborted}`);
  const sum = (pick: (t: OrphanScanTargetResult) => number) => targets.reduce((n, t) => n + pick(t), 0);
  return {
    candidates: sum((t) => t.candidates),
    trashed: sum((t) => t.trashed),
    capped: sum((t) => t.capped),
    aborted: abortedList.length > 0 ? abortedList.join("; ") : null,
    pages: sum((t) => t.pages),
    cyclesCompleted: targets.filter((t) => t.cycleCompleted).length,
    targets,
  };
}
