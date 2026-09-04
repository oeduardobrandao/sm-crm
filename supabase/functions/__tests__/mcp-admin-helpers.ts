// Fake de supabase-js para os testes do mcp-admin: from(table) com fila de respostas por
// tabela (mesmo padrão de mcp-writes_test.ts) + rpc + storage.from(bucket).
import type { Deps } from "../mcp-admin/deps.ts";
import type { AdminMcpContext } from "../_shared/mcp-admin-auth.ts";

export type Resp = { data: unknown; error: unknown };
export type Call = { table: string; method: string; args: unknown[] };

export function makeFakeDb(responses: Record<string, Resp[]>, rpc: Record<string, Resp[]> = {}) {
  const calls: Call[] = [];
  const queues: Record<string, Resp[]> = {};
  for (const k of Object.keys(responses)) queues[k] = [...responses[k]];
  const rpcQueues: Record<string, Resp[]> = {};
  for (const k of Object.keys(rpc)) rpcQueues[k] = [...rpc[k]];
  function recorder(table: string) {
    // deno-lint-ignore no-explicit-any
    const rec: any = {};
    const next = (): Resp => (queues[table] ?? []).shift() ?? { data: null, error: null };
    for (const m of ["select", "eq", "in", "is", "gte", "order", "limit", "range", "insert", "update", "upsert", "delete", "ilike"]) {
      rec[m] = (...args: unknown[]) => { calls.push({ table, method: m, args }); return rec; };
    }
    rec.single = () => { calls.push({ table, method: "single", args: [] }); return Promise.resolve(next()); };
    rec.maybeSingle = () => { calls.push({ table, method: "maybeSingle", args: [] }); return Promise.resolve(next()); };
    rec.then = (resolve: (r: Resp) => unknown) => Promise.resolve(resolve(next()));
    return rec;
  }
  const storageCalls: Array<{ bucket: string; method: string; args: unknown[] }> = [];
  const db = {
    from: (t: string) => { calls.push({ table: t, method: "from", args: [t] }); return recorder(t); },
    rpc: (name: string, params: unknown) => {
      calls.push({ table: `rpc:${name}`, method: "rpc", args: [params] });
      const r = (rpcQueues[name] ?? []).shift() ?? { data: null, error: null };
      return Promise.resolve(r);
    },
    storage: {
      from: (bucket: string) => ({
        upload: (path: string, bytes: Uint8Array, opts: unknown) => {
          storageCalls.push({ bucket, method: "upload", args: [path, bytes.byteLength, opts] });
          return Promise.resolve({ data: { path }, error: null });
        },
        createSignedUploadUrl: (path: string) => {
          storageCalls.push({ bucket, method: "createSignedUploadUrl", args: [path] });
          return Promise.resolve({ data: { signedUrl: `https://sb/upload/${path}?token=t`, token: "t", path }, error: null });
        },
        getPublicUrl: (path: string) => ({ data: { publicUrl: `https://sb/storage/v1/object/public/${bucket}/${path}` } }),
      }),
    },
    auth: { getUser: () => Promise.resolve({ data: { user: null }, error: null }) },
  };
  return { db, calls, storageCalls };
}

export const CTX: AdminMcpContext = {
  admin_id: "adm-1", user_id: "user-1", scopes: ["banners:read", "banners:write", "popups:read", "popups:write", "kb:read", "kb:write", "platform:read"],
  key_id: "oauth:c1",
};

export const PNG_10x5 = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 73, 72, 68, 82,
  0, 0, 0, 10, 0, 0, 0, 5, 8, 6, 0, 0, 0, 0, 0, 0, 0,
]);

export function makeDeps(db: unknown, over: Partial<Deps> = {}): Deps {
  let n = 0;
  return {
    db,
    ctx: CTX,
    now: () => "2026-09-04T12:00:00.000Z",
    randomUUID: () => `0000000${++n}-0000-4000-8000-000000000000`,
    signPutUrl: async (key) => `https://r2/put/${key}`,
    headObject: async () => ({ contentLength: PNG_10x5.byteLength, contentType: "image/png" }),
    putObject: async () => {},
    deleteObject: async () => {},
    resolveDns: async (_h, t) => (t === "A" ? ["93.184.216.34"] : []),
    fetchUrl: async () => new Response(PNG_10x5, { status: 200, headers: { "content-type": "image/png" } }),
    storageQuota: async () => null,
    ...over,
  };
}

export function insertPayload(calls: Call[], table: string): Record<string, unknown> | undefined {
  return calls.find((x) => x.table === table && x.method === "insert")?.args[0] as Record<string, unknown> | undefined;
}
export function updatePayload(calls: Call[], table: string): Record<string, unknown> | undefined {
  return calls.find((x) => x.table === table && x.method === "update")?.args[0] as Record<string, unknown> | undefined;
}
export function rpcPayload(calls: Call[], name: string): Record<string, unknown> | undefined {
  const call = calls.find((x) => x.table === `rpc:${name}`);
  const args = call?.args as [Record<string, unknown> | undefined] | undefined;
  return (args?.[0] as { p?: Record<string, unknown> } | undefined)?.p ?? args?.[0];
}
export function has(calls: Call[], table: string, method: string, args: unknown[]): boolean {
  return calls.some((c) => c.table === table && c.method === method && JSON.stringify(c.args) === JSON.stringify(args));
}
export async function expectInputError(fn: () => Promise<unknown>, needle: string) {
  const { McpInputError } = await import("../_shared/mcp-token.ts");
  let caught: unknown;
  try { await fn(); } catch (e) { caught = e; }
  if (!(caught instanceof McpInputError)) throw new Error(`esperava McpInputError, veio ${String(caught)}`);
  if (!caught.message.includes(needle)) throw new Error(`mensagem "${caught.message}" sem "${needle}"`);
}
