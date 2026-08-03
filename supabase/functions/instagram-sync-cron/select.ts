// supabase/functions/instagram-sync-cron/select.ts
//
// Pure batch-selection for instagram-sync-cron, extracted from index.ts so the
// ordering / exclusion / limit rules are unit-testable without a PostgREST mock.
//
// Why the limit is applied AFTER the workspace filters rather than as a
// `.limit()` on the account query: an account whose workspace lacks
// feature_auto_sync_cron (or is flagged internal) never syncs, so its
// last_synced_at never advances. Ordered stalest-first, those rows would sit
// permanently at the head of a DB-side LIMIT window and starve every eligible
// account behind them. Filtering first, then slicing, means the limit only ever
// bounds work that is actually going to be performed.
//
// index.ts still passes a generous CANDIDATE_LIMIT to the query as a memory
// guard. That degenerates into the same head-of-line problem only if the number
// of simultaneously-stale ineligible accounts exceeds it, which is far above
// current volume (67 active accounts total as of 2026-08-03).

export interface SyncCandidate {
  last_synced_at?: string | null;
  clientes: { conta_id: string } | Array<{ conta_id: string }>;
}

export interface SelectOptions {
  /** Workspaces whose plan grants feature_auto_sync_cron. */
  allowedWorkspaces: Set<string>;
  /** Workspaces flagged is_internal; their accounts are never synced. */
  internalWorkspaces: Set<string>;
  /** Maximum accounts to process in this invocation. */
  limit: number;
}

export interface SelectResult<T> {
  /** Accounts to sync this run, stalest first. */
  selected: T[];
  /** Eligible accounts left for the next run because the batch was full. */
  deferred: number;
  /** Accounts dropped for lacking feature_auto_sync_cron. */
  skippedNoFeature: number;
  /** Accounts dropped for belonging to an internal workspace. */
  skippedInternal: number;
}

/** PostgREST returns an embedded to-one relation as an object or a 1-element array. */
export function contaIdOf(account: SyncCandidate): string {
  const c = account.clientes;
  return Array.isArray(c) ? c[0]?.conta_id : c?.conta_id;
}

/** Oldest last_synced_at first; never-synced (null) accounts sort ahead of all. */
function byStalest(a: SyncCandidate, b: SyncCandidate): number {
  const at = a.last_synced_at ? Date.parse(a.last_synced_at) : Number.NEGATIVE_INFINITY;
  const bt = b.last_synced_at ? Date.parse(b.last_synced_at) : Number.NEGATIVE_INFINITY;
  if (Number.isNaN(at) && Number.isNaN(bt)) return 0;
  if (Number.isNaN(at)) return -1;
  if (Number.isNaN(bt)) return 1;
  return at - bt;
}

export function selectAccountsToSync<T extends SyncCandidate>(
  candidates: T[],
  { allowedWorkspaces, internalWorkspaces, limit }: SelectOptions,
): SelectResult<T> {
  let skippedInternal = 0;
  let skippedNoFeature = 0;

  const eligible = candidates.filter((account) => {
    const wsId = contaIdOf(account);
    if (internalWorkspaces.has(wsId)) {
      skippedInternal++;
      return false;
    }
    if (!allowedWorkspaces.has(wsId)) {
      skippedNoFeature++;
      return false;
    }
    return true;
  });

  // Re-sort locally rather than trusting the query's ORDER BY. The rule that
  // matters (stalest first, so a truncated batch rotates instead of starving a
  // fixed tail) is then guaranteed by this module's own tests.
  eligible.sort(byStalest);

  const safeLimit = Math.max(0, limit);
  return {
    selected: eligible.slice(0, safeLimit),
    deferred: Math.max(0, eligible.length - safeLimit),
    skippedNoFeature,
    skippedInternal,
  };
}
