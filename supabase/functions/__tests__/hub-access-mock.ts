/** Shared mock for the `hub_access_context` RPC (and `hub_workspace_paused`,
 *  answered `false`: the reverse-trial pause is off). Returns null for any
 *  other function so the caller falls through to its own rpc mock. */
export function hubAccessRpc(
  fn: string,
  override?: unknown,
): { data: unknown; error: null } | null {
  if (fn === "hub_workspace_paused") return { data: false, error: null };
  if (fn !== "hub_access_context") return null;
  return { data: override ?? { require_login: false, person: null }, error: null };
}

const DEFAULT_ACCESS = { require_login: false, person: null };

type QueueableRpcMock = {
  // deno-lint-ignore no-explicit-any
  rpc: (name: string, params: Record<string, unknown>) => any;
  // deno-lint-ignore no-explicit-any
  queueRpc: (name: string, ...responses: any[]) => void;
};

/** Wraps a `createSupabaseQueryMock()` so `hub_access_context` answers the
 *  "switch off" context (or `defaultContext`) and `hub_workspace_paused`
 *  answers `false`, unless a test queued its own response with `queueRpc`.
 *  The calls are still recorded in `db.calls` as `rpc:<name>`. */
export function withHubAccess<M extends QueueableRpcMock>(db: M, defaultContext: unknown = DEFAULT_ACCESS): M {
  const queued: Record<string, number> = { hub_access_context: 0, hub_workspace_paused: 0 };
  const defaults: Record<string, unknown> = { hub_access_context: defaultContext, hub_workspace_paused: false };
  const origRpc = db.rpc.bind(db);
  const origQueueRpc = db.queueRpc.bind(db);
  db.queueRpc = (name, ...responses) => {
    if (name in queued) queued[name] += responses.length;
    origQueueRpc(name, ...responses);
  };
  db.rpc = (name, params) => {
    if (name in queued) {
      if (queued[name] > 0) queued[name]--;
      else origQueueRpc(name, { data: defaults[name], error: null });
    }
    return origRpc(name, params);
  };
  return db;
}
