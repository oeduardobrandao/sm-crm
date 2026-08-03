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
// A single bounded candidate query is NOT enough on its own. Ineligible
// accounts are systematically concentrated at the head of the ordering, not
// randomly distributed: an account that never syncs keeps last_synced_at NULL
// forever, and the query sorts NULLs first. Every free-plan or internal
// Instagram connection therefore claims a permanent slot at the front of the
// window. Once they fill one page, filtering yields an empty batch every run
// and no eligible account is ever reached. index.ts pages through candidates
// until the batch fills rather than reading one fixed window.

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

export interface CollectDeps<T> {
  /** Reads one page of candidates, already ordered stalest-first with a total order. */
  fetchPage: (from: number, size: number) => Promise<T[]>;
  /** Returns the subset of `wsIds` holding feature_auto_sync_cron. Called once per
   * workspace across the whole run, never once per account or once per page. */
  resolveAllowedWorkspaces: (wsIds: string[]) => Promise<string[]>;
  internalWorkspaces: Set<string>;
}

export interface CollectOptions {
  pageSize: number;
  maxPages: number;
  /** Stop paging once this many eligible accounts have been seen. */
  targetEligible: number;
}

export interface CollectResult<T> {
  candidates: T[];
  allowedWorkspaces: Set<string>;
  scanned: number;
  pages: number;
  /** Ran out of candidates rather than stopping early. */
  exhausted: boolean;
  /** Hit maxPages without filling the batch or exhausting candidates. */
  cappedByPages: boolean;
}

/**
 * Pages through candidates until `targetEligible` eligible accounts have been
 * seen, candidates run out, or `maxPages` is reached.
 *
 * The paging is the whole point: a single fixed window starves eligible
 * accounts, because ineligible ones cluster at the head of a stalest-first
 * ordering rather than spreading through it. They never sync, so their
 * last_synced_at stays NULL, and NULLs sort first.
 */
export async function collectSyncCandidates<T extends SyncCandidate>(
  { fetchPage, resolveAllowedWorkspaces, internalWorkspaces }: CollectDeps<T>,
  { pageSize, maxPages, targetEligible }: CollectOptions,
): Promise<CollectResult<T>> {
  const allowedWorkspaces = new Set<string>();
  const featureChecked = new Set<string>();
  const candidates: T[] = [];
  let eligibleSoFar = 0;
  let scanned = 0;
  let pages = 0;
  let exhausted = false;

  while (pages < maxPages) {
    const page = await fetchPage(pages * pageSize, pageSize);
    pages++;
    if (!page || page.length === 0) {
      exhausted = true;
      break;
    }
    scanned += page.length;

    const unchecked = [...new Set(page.map(contaIdOf))].filter((ws) => !featureChecked.has(ws));
    if (unchecked.length > 0) {
      for (const ws of unchecked) featureChecked.add(ws);
      for (const ws of await resolveAllowedWorkspaces(unchecked)) allowedWorkspaces.add(ws);
    }

    candidates.push(...page);
    eligibleSoFar += page.filter((a) => isEligible(a, allowedWorkspaces, internalWorkspaces)).length;

    if (eligibleSoFar >= targetEligible) break;
    if (page.length < pageSize) {
      exhausted = true;
      break;
    }
  }

  return {
    candidates,
    allowedWorkspaces,
    scanned,
    pages,
    exhausted,
    cappedByPages: !exhausted && eligibleSoFar < targetEligible,
  };
}

/**
 * Whether an account may be synced. Shared by selectAccountsToSync and by
 * collectSyncCandidates, so the two can never disagree about eligibility.
 */
export function isEligible(
  account: SyncCandidate,
  allowedWorkspaces: Set<string>,
  internalWorkspaces: Set<string>,
): boolean {
  const wsId = contaIdOf(account);
  return !internalWorkspaces.has(wsId) && allowedWorkspaces.has(wsId);
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
