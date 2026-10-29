// Fake de supabase-js para os testes das ferramentas do Financeiro do MCP (copiado de
// mcp-admin-helpers.ts): from(table) com fila de respostas por tabela + rpc com fila por
// nome de função. `effective_plan_feature` responde `true` quando nenhuma fila é dada, para que
// o gate do `register` (feature_financial / feature_financeiro_v2) passe sem boilerplate.
import type { Deps, RegisteredTool } from "../mcp/queries.ts";
import type { McpKeyContext } from "../_shared/mcp-token.ts";

// registerTools with cards on + OAuth signs send nonces and throws at registration without the key.
if (!Deno.env.get("TOKEN_ENCRYPTION_KEY")) Deno.env.set("TOKEN_ENCRYPTION_KEY", "test-secret-key-for-mcp-tests-32chars!");

export type Resp = { data: unknown; error: unknown };
export type Call = { table: string; method: string; args: unknown[] };

// Queue keys: `table` serves every query on that table in FIFO order. A key of the form
// `table[col=value]` serves only the queries on that table that called `.eq(col, value)`, and
// takes precedence over the plain table queue when the test provides it.
export function makeFakeDb(responses: Record<string, Resp[]>, rpc: Record<string, Resp[]> = {}) {
  const calls: Call[] = [];
  const queues: Record<string, Resp[]> = {};
  for (const k of Object.keys(responses)) queues[k] = [...responses[k]];
  const rpcQueues: Record<string, Resp[]> = {};
  for (const k of Object.keys(rpc)) rpcQueues[k] = [...rpc[k]];
  function recorder(table: string) {
    // deno-lint-ignore no-explicit-any
    const rec: any = {};
    const eqKeys: string[] = [];
    const next = (): Resp => {
      const key = eqKeys.find((k) => k in queues) ?? table;
      return (queues[key] ?? []).shift() ?? { data: null, error: null };
    };
    for (
      const m of [
        "select", "eq", "neq", "in", "is", "gte", "lt", "lte", "like", "order", "limit", "range",
        "insert", "update", "upsert", "delete", "ilike",
      ]
    ) {
      rec[m] = (...args: unknown[]) => {
        calls.push({ table, method: m, args });
        if (m === "eq") eqKeys.push(`${table}[${String(args[0])}=${String(args[1])}]`);
        return rec;
      };
    }
    rec.single = () => { calls.push({ table, method: "single", args: [] }); return Promise.resolve(next()); };
    rec.maybeSingle = () => { calls.push({ table, method: "maybeSingle", args: [] }); return Promise.resolve(next()); };
    rec.then = (resolve: (r: Resp) => unknown) => Promise.resolve(resolve(next()));
    return rec;
  }
  const db = {
    from: (t: string) => { calls.push({ table: t, method: "from", args: [t] }); return recorder(t); },
    rpc: (name: string, params: unknown) => {
      calls.push({ table: `rpc:${name}`, method: "rpc", args: [params] });
      const queued = (rpcQueues[name] ?? []).shift();
      if (queued) return Promise.resolve(queued);
      if (name === "effective_plan_feature" && !(name in rpcQueues)) {
        return Promise.resolve({ data: true, error: null });
      }
      return Promise.resolve({ data: null, error: null });
    },
    auth: {
      getUser: () => Promise.resolve({ data: { user: null }, error: null }),
    },
  };
  return { db, calls };
}

/** Records `server.registerTool(name, config, handler)` registrations, like the MCP SDK server. */
export function fakeServer() {
  const handlers: Record<string, (a: unknown) => Promise<{ content: { type: string; text: string }[]; isError?: boolean }>> = {};
  const descriptions: Record<string, string> = {};
  const shapes: Record<string, Record<string, unknown>> = {};
  return {
    handlers,
    descriptions,
    shapes,
    // deno-lint-ignore no-explicit-any
    registerTool(name: string, config: any, handler: any) {
      handlers[name] = handler;
      descriptions[name] = config.description;
      shapes[name] = config.inputSchema;
    },
  };
}

export const OWNER_CTX: McpKeyContext = {
  conta_id: "workspace-A",
  scopes: ["financeiro:read", "financeiro:write", "clientes:write", "membros:write"],
  key_id: "k1",
  created_by: "user-1",
  role: "owner",
};

/** `registry` opts the deps into tool collection (the structural tests); production never passes one. */
export function makeDeps(db: unknown, ctx: Partial<McpKeyContext> = {}, registry?: RegisteredTool[]): Deps {
  return { db, ctx: { ...OWNER_CTX, ...ctx }, ...(registry ? { registry } : {}) } as unknown as Deps;
}

export function insertPayload(calls: Call[], table: string): Record<string, unknown> | undefined {
  return calls.find((x) => x.table === table && x.method === "insert")?.args[0] as Record<string, unknown> | undefined;
}
export function updatePayload(calls: Call[], table: string): Record<string, unknown> | undefined {
  return calls.find((x) => x.table === table && x.method === "update")?.args[0] as Record<string, unknown> | undefined;
}
export function rpcArgs(calls: Call[], name: string): Record<string, unknown> | undefined {
  return calls.find((x) => x.table === `rpc:${name}`)?.args[0] as Record<string, unknown> | undefined;
}
export function has(calls: Call[], table: string, method: string, args: unknown[]): boolean {
  return calls.some((c) => c.table === table && c.method === method && JSON.stringify(c.args) === JSON.stringify(args));
}
