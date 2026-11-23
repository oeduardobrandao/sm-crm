/** Shared mock for the `hub_access_context` RPC. Returns null for any other
 *  function so the caller falls through to its own rpc mock. */
export function hubAccessRpc(
  fn: string,
  override?: unknown,
): { data: unknown; error: null } | null {
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
 *  "switch off" context (or `defaultContext`) unless a test queued its own
 *  response with `queueRpc("hub_access_context", ...)`. The call is still
 *  recorded in `db.calls` as `rpc:hub_access_context`. */
export function withHubAccess<M extends QueueableRpcMock>(db: M, defaultContext: unknown = DEFAULT_ACCESS): M {
  let queued = 0;
  const origRpc = db.rpc.bind(db);
  const origQueueRpc = db.queueRpc.bind(db);
  db.queueRpc = (name, ...responses) => {
    if (name === "hub_access_context") queued += responses.length;
    origQueueRpc(name, ...responses);
  };
  db.rpc = (name, params) => {
    if (name === "hub_access_context") {
      if (queued > 0) queued--;
      else origQueueRpc(name, { data: defaultContext, error: null });
    }
    return origRpc(name, params);
  };
  return db;
}
