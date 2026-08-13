import { assertEquals } from "https://deno.land/std@0.208.0/assert/mod.ts";
import { createCrmReorderHandler } from "./handler.ts";

const CONTA = "11111111-1111-1111-1111-111111111111";

interface FakeOpts {
  user?: { id: string } | null;
  authError?: boolean;
  profileConta?: string | null;
  clienteConta?: string | null | undefined;
  rpc?: { data?: unknown; error?: { message: string } | null };
}

function makeDb(opts: FakeOpts) {
  const rpcCalls: { fn: string; params: Record<string, unknown> }[] = [];
  const db = {
    auth: {
      getUser: (_token: string) =>
        Promise.resolve({
          data: { user: opts.authError ? null : (opts.user ?? { id: "user-1" }) },
          error: opts.authError ? { message: "bad token" } : null,
        }),
    },
    from: (table: string) => {
      const row =
        table === "profiles"
          ? { conta_id: opts.profileConta === undefined ? CONTA : opts.profileConta }
          : table === "clientes"
            ? opts.clienteConta === undefined
              ? { conta_id: CONTA }
              : opts.clienteConta === null
                ? null
                : { conta_id: opts.clienteConta }
            : null;
      const builder = {
        select: () => builder,
        eq: () => builder,
        single: () => Promise.resolve({ data: row }),
      };
      return builder;
    },
    rpc: (fn: string, params: Record<string, unknown>) => {
      rpcCalls.push({ fn, params });
      return Promise.resolve(opts.rpc ?? { data: { ok: true, updated: 2 }, error: null });
    },
  };
  return { db, rpcCalls };
}

function makeReq(body: unknown, withAuth = true): Request {
  return new Request("https://x/crm-reorder-post-schedules", {
    method: "POST",
    headers: withAuth
      ? { Authorization: "Bearer jwt", "Content-Type": "application/json" }
      : { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

const okBody = {
  cliente_id: 7,
  updates: [
    { post_id: 1, scheduled_at: "2099-01-01T12:00:00Z" },
    { post_id: 2, scheduled_at: "2099-01-02T12:00:00Z" },
  ],
};

Deno.test("rejects a request with no Authorization header", async () => {
  const { db } = makeDb({});
  const handler = createCrmReorderHandler({ buildCorsHeaders: () => ({}), createDb: () => db });
  const res = await handler(makeReq(okBody, false));
  assertEquals(res.status, 401);
});

Deno.test("rejects a body without a numeric cliente_id", async () => {
  const { db } = makeDb({});
  const handler = createCrmReorderHandler({ buildCorsHeaders: () => ({}), createDb: () => db });
  const res = await handler(makeReq({ updates: okBody.updates }));
  assertEquals(res.status, 400);
});

Deno.test("rejects a malformed update entry", async () => {
  const { db } = makeDb({});
  const handler = createCrmReorderHandler({ buildCorsHeaders: () => ({}), createDb: () => db });
  const res = await handler(makeReq({ cliente_id: 7, updates: [{ post_id: 1 }] }));
  assertEquals(res.status, 400);
});

Deno.test("rejects a cliente in another account (cross-tenant)", async () => {
  const { db, rpcCalls } = makeDb({ clienteConta: "22222222-2222-2222-2222-222222222222" });
  const handler = createCrmReorderHandler({ buildCorsHeaders: () => ({}), createDb: () => db });
  const res = await handler(makeReq(okBody));
  assertEquals(res.status, 403);
  assertEquals(rpcCalls.length, 0);
});

Deno.test("happy path calls the RPC scoped to the caller's account and allowlist", async () => {
  const { db, rpcCalls } = makeDb({});
  const handler = createCrmReorderHandler({ buildCorsHeaders: () => ({}), createDb: () => db });
  const res = await handler(makeReq(okBody));
  assertEquals(res.status, 200);
  assertEquals(rpcCalls.length, 1);
  assertEquals(rpcCalls[0].fn, "reorder_post_schedules");
  assertEquals(rpcCalls[0].params.p_cliente_id, 7);
  assertEquals(rpcCalls[0].params.p_conta_id, CONTA);
  assertEquals(
    (rpcCalls[0].params.p_allowed_statuses as string[]).includes("rascunho"),
    true,
  );
});

Deno.test("maps a LOCKED rpc error to 409 with locked_post_ids", async () => {
  const { db } = makeDb({ rpc: { error: { message: "LOCKED: publishing in progress: {2,3}" } } });
  const handler = createCrmReorderHandler({ buildCorsHeaders: () => ({}), createDb: () => db });
  const res = await handler(makeReq(okBody));
  assertEquals(res.status, 409);
  const json = await res.json();
  assertEquals(json.locked_post_ids, [2, 3]);
});

Deno.test("maps a BAD_REQUEST rpc error to 400", async () => {
  const { db } = makeDb({ rpc: { error: { message: "BAD_REQUEST: agendado needs a future date" } } });
  const handler = createCrmReorderHandler({ buildCorsHeaders: () => ({}), createDb: () => db });
  const res = await handler(makeReq(okBody));
  assertEquals(res.status, 400);
});
