/**
 * storage-autoclean-cron: auto-limpeza de mídia de posts publicados.
 *
 * Two layers, mirroring mention-email-cron:
 *  - `createStorageAutocleanCronHandler`: thin auth wrapper, checks
 *    `x-cron-secret` BEFORE any work and delegates to `run`.
 *  - `runStorageAutocleanCron`: dependency-injected business logic, testable
 *    without a network or a real database.
 *
 * All the correctness-critical work (candidate predicate, link/file deletes,
 * accounting, audit_log, notification) lives in the `storage_autoclean_run`
 * SQL function -- one transaction per workspace. This loop only decides WHICH
 * workspaces to visit and aggregates results:
 *  - sequential, ordered by workspace id, so a partial run under the deadline
 *    is deterministic;
 *  - a per-workspace RPC error is recorded and the loop CONTINUES -- one bad
 *    workspace must not starve the rest;
 *  - a soft wall-clock deadline bounds the run (edge isolates get killed, not
 *    warned); workspaces not reached simply wait for tomorrow's 02:30 run.
 *    Nothing is claimed up front, so stopping early leaks no state.
 */

interface DbError {
  message: string;
}

export interface EnabledWorkspaceRow {
  id: string;
}

/** Narrow slice of the PostgREST filter-builder chain the workspace listing drives. */
export interface WorkspacesFilterChain
  extends PromiseLike<{ data: EnabledWorkspaceRow[] | null; error: DbError | null }> {
  eq(column: string, value: boolean): WorkspacesFilterChain;
  order(column: string, opts: { ascending: boolean }): WorkspacesFilterChain;
}

export interface StorageAutocleanRunResult {
  skipped?: string;
  files_deleted?: number;
  bytes_freed?: number;
  posts_stamped?: number;
}

export interface StorageAutocleanDb {
  from(table: "workspaces"): {
    select(columns: string): WorkspacesFilterChain;
  };
  rpc(
    fn: "storage_autoclean_run",
    args: { p_workspace: string },
  ): Promise<{ data: StorageAutocleanRunResult | null; error: DbError | null }>;
}

export interface StorageAutocleanCronDeps {
  db: StorageAutocleanDb;
  /**
   * Wall-clock milliseconds for the soft deadline; injected so tests can
   * simulate a long run without sleeping. Defaults to `Date.now` in index.ts.
   */
  nowMs?: () => number;
  /** Soft wall-clock budget for the whole loop. Defaults to 60s. */
  deadlineMs?: number;
  // `accountId` matches `_shared/triage.ts`'s `CronFailureDetail` shape so
  // `report` can be wired straight to `reportCronFailure`.
  report?: (
    detail: { failed: number; errors: Array<{ accountId?: string; error: string }> },
  ) => Promise<void>;
}

export interface StorageAutocleanCronResult {
  workspaces_checked: number;
  cleaned: number;
  skipped: number;
  deadline_stopped: number;
  files_deleted: number;
  bytes_freed: number;
  errors: Array<{ accountId?: string; error: string }>;
}

const DEFAULT_DEADLINE_MS = 60_000;

export async function runStorageAutocleanCron(
  deps: StorageAutocleanCronDeps,
): Promise<StorageAutocleanCronResult> {
  const nowMs = deps.nowMs ?? (() => Date.now());
  const deadlineMs = deps.deadlineMs ?? DEFAULT_DEADLINE_MS;
  const startedAt = nowMs();

  const result: StorageAutocleanCronResult = {
    workspaces_checked: 0,
    cleaned: 0,
    skipped: 0,
    deadline_stopped: 0,
    files_deleted: 0,
    bytes_freed: 0,
    errors: [],
  };

  const { data: workspaces, error: listError } = await deps.db
    .from("workspaces")
    .select("id")
    .eq("storage_autoclean_enabled", true)
    .order("id", { ascending: true });

  if (listError) {
    throw new Error(`workspace listing failed: ${listError.message}`);
  }

  const rows = workspaces ?? [];
  for (let i = 0; i < rows.length; i++) {
    if (nowMs() - startedAt > deadlineMs) {
      result.deadline_stopped = rows.length - i;
      break;
    }

    const ws = rows[i];
    try {
      const { data, error } = await deps.db.rpc("storage_autoclean_run", {
        p_workspace: ws.id,
      });
      if (error) {
        result.errors.push({ accountId: ws.id, error: error.message });
        continue;
      }
      result.workspaces_checked++;
      if (data?.skipped) {
        result.skipped++;
      } else {
        const files = data?.files_deleted ?? 0;
        if (files > 0) {
          result.cleaned++;
          result.files_deleted += files;
          result.bytes_freed += data?.bytes_freed ?? 0;
        }
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      result.errors.push({ accountId: ws.id, error: message });
    }
  }

  if (result.errors.length > 0 && deps.report) {
    await deps.report({ failed: result.errors.length, errors: result.errors });
  }

  return result;
}

export interface StorageAutocleanCronHandlerDeps {
  cronSecret: string;
  timingSafeEqual: (a: string, b: string) => boolean;
  run: (req: Request) => Promise<Response>;
}

export function createStorageAutocleanCronHandler(
  deps: StorageAutocleanCronHandlerDeps,
) {
  return async (req: Request): Promise<Response> => {
    if (!deps.timingSafeEqual(req.headers.get("x-cron-secret") ?? "", deps.cronSecret)) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    }
    return deps.run(req);
  };
}
