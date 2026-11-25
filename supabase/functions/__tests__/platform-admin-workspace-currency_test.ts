import { assertEquals } from "./assert.ts";
import { makeFakeDb, type Resp } from "./mcp-admin-helpers.ts";
import { handleSetWorkspaceCurrency } from "../platform-admin/workspace-currency.ts";

const HEADERS = { "Content-Type": "application/json" };
const ACTOR = "admin-user-1";
const WS = { data: { id: "ws-1", billing_currency: "brl" }, error: null };

async function run(
  body: Record<string, unknown>,
  responses: Record<string, Resp[]>,
  rpc: Record<string, Resp[]> = {},
) {
  const t = makeFakeDb(responses, rpc);
  const res = await handleSetWorkspaceCurrency(t.db as never, body as never, ACTOR, HEADERS);
  return { t, status: res.status, body: await res.json() };
}

const audit = (t: Awaited<ReturnType<typeof run>>["t"]) =>
  t.calls.find((c) => c.table === "audit_log" && c.method === "insert")?.args[0] as Record<string, unknown> | undefined;

Deno.test("set-workspace-currency: updates through the RPC and audits", async () => {
  const r = await run(
    { workspace_id: "ws-1", currency: "usd" },
    { workspaces: [WS] },
    { billing_currency_set: [{ data: true, error: null }] },
  );
  assertEquals(r.status, 200);
  assertEquals(r.body, { ok: true });
  const rpc = r.t.calls.find((c) => c.table === "rpc:billing_currency_set");
  assertEquals(rpc?.args[0], { p_workspace_id: "ws-1", p_currency: "usd" });
  const a = audit(r.t);
  assertEquals(a?.action, "admin-set-workspace-currency");
  assertEquals(a?.conta_id, "ws-1");
  assertEquals(a?.actor_user_id, ACTOR);
  assertEquals(a?.metadata, { old_currency: "brl", new_currency: "usd" });
});

Deno.test("set-workspace-currency: locked currency answers 409 and writes no audit", async () => {
  const r = await run(
    { workspace_id: "ws-1", currency: "usd" },
    { workspaces: [WS] },
    { billing_currency_set: [{ data: false, error: null }] },
  );
  assertEquals(r.status, 409);
  assertEquals(r.body, { error: "currency_locked" });
  assertEquals(audit(r.t), undefined);
});

Deno.test("set-workspace-currency: bad input answers 400 without touching the db", async () => {
  for (const body of [
    { workspace_id: "ws-1", currency: "eur" },
    { workspace_id: "ws-1", currency: "USD" },
    { workspace_id: "ws-1" },
    { currency: "usd" },
    { workspace_id: 5, currency: "usd" },
  ]) {
    const r = await run(body, { workspaces: [WS] });
    assertEquals(r.status, 400);
    assertEquals(r.t.calls.length, 0);
  }
});

Deno.test("set-workspace-currency: unknown workspace answers 404", async () => {
  const r = await run({ workspace_id: "nope", currency: "usd" }, { workspaces: [{ data: null, error: null }] });
  assertEquals(r.status, 404);
});

Deno.test("set-workspace-currency: RPC failure answers a generic 500", async () => {
  const r = await run(
    { workspace_id: "ws-1", currency: "usd" },
    { workspaces: [WS] },
    { billing_currency_set: [{ data: null, error: { message: "boom secret" } }] },
  );
  assertEquals(r.status, 500);
  assertEquals(JSON.stringify(r.body).includes("secret"), false);
});
