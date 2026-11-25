// Recording fake Supabase client for the platform-admin reverse-trial tests. Every builder call
// and every rpc() is recorded in order, so tests can assert call ORDER (comp must end the trial
// before writing plan_source='manual'). Responses are queued per table / per rpc name.

export type Resp = { data: unknown; error: unknown; count?: number | null };
export type Call = { table: string; method: string; args: unknown[] };

export function makeFakeDb(
  responses: Record<string, Resp[]> = {},
  rpcResponses: Record<string, Resp[]> = {},
) {
  const calls: Call[] = [];
  const queues: Record<string, Resp[]> = {};
  for (const k of Object.keys(responses)) queues[k] = [...responses[k]];
  const rpcQueues: Record<string, Resp[]> = {};
  for (const k of Object.keys(rpcResponses)) rpcQueues[k] = [...rpcResponses[k]];

  function recorder(table: string) {
    // deno-lint-ignore no-explicit-any
    const rec: any = {};
    const next = (): Resp => (queues[table] ?? []).shift() ?? { data: null, error: null };
    for (
      const m of [
        "select", "eq", "neq", "in", "is", "not", "gte", "gt", "lt", "lte", "order", "limit", "range",
        "insert", "update", "upsert", "delete",
      ]
    ) {
      rec[m] = (...args: unknown[]) => {
        calls.push({ table, method: m, args });
        return rec;
      };
    }
    rec.single = () => {
      calls.push({ table, method: "single", args: [] });
      return Promise.resolve(next());
    };
    rec.maybeSingle = () => {
      calls.push({ table, method: "maybeSingle", args: [] });
      return Promise.resolve(next());
    };
    rec.then = (resolve: (r: Resp) => unknown, reject?: (e: unknown) => unknown) =>
      Promise.resolve(next()).then(resolve, reject);
    return rec;
  }

  const db = {
    from: (t: string) => {
      calls.push({ table: t, method: "from", args: [t] });
      return recorder(t);
    },
    rpc: (name: string, args: unknown) => {
      calls.push({ table: `rpc:${name}`, method: "rpc", args: [args] });
      return Promise.resolve((rpcQueues[name] ?? []).shift() ?? { data: null, error: null });
    },
  };
  return { db, calls };
}

export function callsTo(calls: Call[], table: string, method: string): Call[] {
  return calls.filter((c) => c.table === table && c.method === method);
}

export function indexOfCall(calls: Call[], table: string, method: string): number {
  return calls.findIndex((c) => c.table === table && c.method === method);
}

export const HEADERS = { "Content-Type": "application/json" };
