import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { createHubBootstrapHandler } from "../hub-bootstrap/handler.ts";

const cors = () => ({});
const NOW = "2026-07-16T12:00:00.000Z";
const TOKEN = "49ded0d7-0c34-4b88-8a60-f9d459113f3c";

function makeDb(tokenRow: unknown) {
  return {
    from: (table: string) => ({
      select: () => ({
        eq: () => ({
          eq: () => ({ maybeSingle: async () => ({ data: tokenRow }) }),
          maybeSingle: async () => ({
            data: table === "workspaces"
              ? { id: "ws-1", name: "WS", logo_url: null, brand_color: "#111", hub_enabled: true }
              : tokenRow,
          }),
          gt: () => ({
            eq: () => ({ maybeSingle: async () => ({ data: tokenRow }) }),
            maybeSingle: async () => ({ data: tokenRow }),
          }),
          single: async () => ({ data: { nome: "Vanessa" } }),
        }),
      }),
      // effective_plan_feature is reached through rpc, below
    }),
    rpc: async () => ({ data: true, error: null }),
  };
}

const req = () =>
  new Request(`https://x/?workspace=dk-marketing-medico&token=${TOKEN}`, { method: "GET" });

Deno.test("touchToken is called when the token resolves", async () => {
  const calls: string[] = [];
  const handler = createHubBootstrapHandler({
    buildCorsHeaders: cors,
    createDb: () => makeDb({ cliente_id: 15, conta_id: "ws-1", is_active: true }) as any,
    now: () => NOW,
    touchToken: async (t: string) => { calls.push(t); },
  });
  const res = await handler(req());
  assertEquals(res.status, 200);
  assertEquals(calls, [TOKEN]);
});

Deno.test("touchToken is NOT called when the token does not resolve", async () => {
  const calls: string[] = [];
  const handler = createHubBootstrapHandler({
    buildCorsHeaders: cors,
    createDb: () => makeDb(null) as any,
    now: () => NOW,
    touchToken: async (t: string) => { calls.push(t); },
  });
  const res = await handler(req());
  assertEquals(res.status, 404);
  assertEquals(calls, []);
});

Deno.test("a throwing touchToken must NOT break the client's portal", async () => {
  const handler = createHubBootstrapHandler({
    buildCorsHeaders: cors,
    createDb: () => makeDb({ cliente_id: 15, conta_id: "ws-1", is_active: true }) as any,
    now: () => NOW,
    touchToken: async () => { throw new Error("renewal exploded"); },
  });
  const res = await handler(req());
  assertEquals(res.status, 200);
});
