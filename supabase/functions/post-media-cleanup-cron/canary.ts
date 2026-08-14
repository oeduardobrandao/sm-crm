// Integrity canary: samples recent files rows and HEADs their R2 objects.
// A DB row whose object is missing means something destroyed storage out from
// under the database — exactly the signal that stayed invisible for months in
// the 2026-08 incident (the immutable edge cache masked it from users).
// Runs hourly inside post-media-cleanup-cron; any miss is reported to cron
// triage by the caller.

export const CANARY_POOL = 500; // newest rows form the sampling pool
export const CANARY_SAMPLE = 25;

interface DbError {
  message: string;
}

export interface CanaryDeps {
  db: {
    from(table: "files"): {
      select(columns: string): {
        order(
          column: string,
          opts: { ascending: boolean },
        ): {
          limit(n: number): PromiseLike<{
            data: Array<{ id: number; r2_key: string }> | null;
            error: DbError | null;
          }>;
        };
      };
    };
  };
  headObject(key: string): Promise<{ contentLength: number } | null>;
  /** Injectable RNG for tests; defaults to Math.random. */
  random?: () => number;
}

export interface CanaryResult {
  checked: number;
  missing: Array<{ id: number; r2_key: string }>;
}

export async function runIntegrityCanary(deps: CanaryDeps): Promise<CanaryResult> {
  const rng = deps.random ?? Math.random;
  const { data, error } = await deps.db
    .from("files")
    .select("id, r2_key")
    .order("id", { ascending: false })
    .limit(CANARY_POOL);
  if (error) throw error;

  const pool = (data ?? []).filter((r) => r.r2_key);
  // Sample without replacement, recency-biased by construction of the pool:
  // recent rows are both the most user-visible and the most likely to exist,
  // so a miss here is a high-signal alarm, not archive noise.
  const picked: typeof pool = [];
  const seen = new Set<number>();
  while (picked.length < Math.min(CANARY_SAMPLE, pool.length)) {
    const idx = Math.floor(rng() * pool.length);
    if (seen.has(idx)) continue;
    seen.add(idx);
    picked.push(pool[idx]);
  }

  const missing: CanaryResult["missing"] = [];
  let checked = 0;
  for (const row of picked) {
    // Watchdog independent of the SDK's own signal handling (the edge runtime
    // has ignored SDK-level timeouts before): a HEAD that answers neither way
    // within 10 s is SKIPPED — a timeout is not evidence of a missing object,
    // and one stall must never wedge the whole canary.
    const head = await Promise.race([
      deps.headObject(row.r2_key),
      new Promise<"timeout">((resolve) => setTimeout(() => resolve("timeout"), 10_000)),
    ]);
    if (head === "timeout") continue;
    checked++;
    if (head === null) missing.push({ id: row.id, r2_key: row.r2_key });
  }
  return { checked, missing };
}
