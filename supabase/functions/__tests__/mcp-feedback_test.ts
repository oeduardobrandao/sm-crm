import { assert, assertEquals } from "./assert.ts";
import { listPostFeedback } from "../mcp/queries.ts";
import type { Deps } from "../mcp/queries.ts";
import type { McpKeyContext } from "../_shared/mcp-token.ts";

type Resp = { data: unknown; error: unknown };
type Call = { table: string; method: string; args: unknown[] };

// Recording fake Supabase client: chainable methods record their args; `await`
// pulls the next canned response from that table's queue.
function makeFakeDb(responses: Record<string, Resp[]>) {
  const calls: Call[] = [];
  const queues: Record<string, Resp[]> = {};
  for (const k of Object.keys(responses)) queues[k] = [...responses[k]];

  function recorder(table: string) {
    const rec: Record<string, unknown> = {};
    for (const m of ["select", "eq", "in", "gte", "order", "limit"]) {
      rec[m] = (...args: unknown[]) => {
        calls.push({ table, method: m, args });
        return rec;
      };
    }
    // deno-lint-ignore no-explicit-any
    (rec as any).then = (resolve: (r: Resp) => unknown) => {
      const r = (queues[table] ?? []).shift() ?? { data: [], error: null };
      return Promise.resolve(resolve(r));
    };
    return rec;
  }

  const db = {
    from: (table: string) => {
      calls.push({ table, method: "from", args: [table] });
      return recorder(table);
    },
  };
  return { db, calls };
}

const CTX: McpKeyContext = {
  conta_id: "workspace-A",
  scopes: ["posts:read"],
  key_id: "k1",
  created_by: "u1",
};

function has(calls: Call[], table: string, method: string, args: unknown[]): boolean {
  return calls.some(
    (c) => c.table === table && c.method === method &&
      JSON.stringify(c.args) === JSON.stringify(args),
  );
}

Deno.test("listPostFeedback scopes every read to the workspace", async () => {
  const { db, calls } = makeFakeDb({
    // phase 1 scan, then phase 2a full feedback — cliente_id comes straight off
    // the workflow_posts embed, no separate workflow -> cliente_id lookup.
    post_approvals: [
      { data: [{ post_id: 123, created_at: "2026-06-02T10:00:00Z" }], error: null },
      {
        data: [{
          post_id: 123, action: "correcao", comentario: "x", is_workspace_user: false,
          created_at: "2026-06-02T10:00:00Z",
          workflow_posts: { workflow_id: 55, titulo: "T", status: "correcao_cliente", conta_id: "workspace-A", cliente_id: 7 },
        }],
        error: null,
      },
    ],
    post_status_events: [{ data: [], error: null }],
  });

  const deps = { db, ctx: CTX } as unknown as Deps;
  const out = await listPostFeedback(deps, {
    post_id: 123, client_id: 9, action: "correcao", since: "2026-06-01T00:00:00Z", limit: 10,
  });

  assert(!calls.some((c) => c.table === "workflows"), "never resolves cliente_id via a separate workflow lookup");

  // (11) every post_approvals read carries the inner join + conta_id filter
  const paFroms = calls.filter((c) => c.table === "post_approvals" && c.method === "from").length;
  assertEquals(paFroms, 2, "post_approvals read in both phase 1 and phase 2a");
  const paConta = calls.filter(
    (c) => c.table === "post_approvals" && c.method === "eq" &&
      JSON.stringify(c.args) === JSON.stringify(["workflow_posts.conta_id", "workspace-A"]),
  ).length;
  assertEquals(paConta, 2, "both post_approvals reads filter workflow_posts.conta_id");
  for (const c of calls) {
    if (c.table === "post_approvals" && c.method === "select") {
      assert(String(c.args[0]).includes("workflow_posts!inner"), "select uses inner join");
    }
  }

  // (12) conjunctive post_id + client_id on the feedback reads
  assert(has(calls, "post_approvals", "eq", ["post_id", 123]), "post_id filter applied");
  assert(has(calls, "post_approvals", "eq", ["workflow_posts.cliente_id", 9]), "client filter applied directly on cliente_id");

  // (12b) Phase 2a constrains post_id to the chosen ids
  assert(has(calls, "post_approvals", "in", ["post_id", [123]]), "phase 2a post_id filter");

  // (14) timeline fetch scoped by conta_id + chosen post ids
  assert(has(calls, "post_status_events", "eq", ["conta_id", "workspace-A"]), "timeline conta filter");
  assert(has(calls, "post_status_events", "in", ["post_id", [123]]), "timeline post filter");

  // (15) since + action applied
  assert(has(calls, "post_approvals", "gte", ["created_at", "2026-06-01T00:00:00Z"]), "since filter");
  assert(has(calls, "post_approvals", "eq", ["action", "correcao"]), "action filter");

  // sanity: shaped output
  assertEquals(out.length, 1);
  assertEquals(out[0].post_id, 123);
  assertEquals(out[0].cliente_id, 7);
});

Deno.test("listPostFeedback: client_id with no matches -> [] (no post_approvals rows in the scan)", async () => {
  const { db, calls } = makeFakeDb({
    post_approvals: [{ data: [], error: null }], // phase 1 scan finds nothing for this client
  });
  const deps = { db, ctx: CTX } as unknown as Deps;
  const out = await listPostFeedback(deps, { client_id: 9 });

  assertEquals(out, []);
  assert(has(calls, "post_approvals", "eq", ["workflow_posts.cliente_id", 9]), "client filter applied on the scan too");
  assert(!calls.some((c) => c.table === "workflows"), "never queries workflows");
});

Deno.test("listPostFeedback: includes feedback from an avulso post (workflow_id null), cliente_id straight off the embed", async () => {
  const { db, calls } = makeFakeDb({
    post_approvals: [
      { data: [{ post_id: 456, created_at: "2026-06-05T10:00:00Z" }], error: null },
      {
        data: [{
          post_id: 456, action: "aprovado", comentario: null, is_workspace_user: false,
          created_at: "2026-06-05T10:00:00Z",
          // avulso: workflow_id null, but cliente_id present directly on the post
          workflow_posts: { workflow_id: null, titulo: "Post avulso", status: "aprovado_cliente", conta_id: "workspace-A", cliente_id: 12 },
        }],
        error: null,
      },
    ],
    post_status_events: [{ data: [], error: null }],
  });
  const deps = { db, ctx: CTX } as unknown as Deps;
  const out = await listPostFeedback(deps, { client_id: 12 });

  assert(!calls.some((c) => c.table === "workflows"), "no workflow lookup needed for an avulso row");
  assertEquals(out.length, 1, "avulso feedback row is not dropped");
  assertEquals(out[0].post_id, 456);
  assertEquals(out[0].cliente_id, 12);
});
