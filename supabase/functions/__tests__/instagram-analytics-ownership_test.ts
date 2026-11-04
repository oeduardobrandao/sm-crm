// instagram-analytics ownership guards (instagram-analytics/ownership.ts): the client-scope layer of
// acesso por cliente. index.ts is a Deno.serve module, so these guards are tested on their own; the
// wiring (scope loaded once per request, read error -> generic 500) lives in index.ts.
import { assertEquals } from "./assert.ts";
import { createSupabaseQueryMock } from "../../../test/shared/supabaseMock.ts";
import { verifyClientOwnership, verifyPostOwnership, visibleClients } from "../instagram-analytics/ownership.ts";
import { allClientsScope, type ClientScope } from "../_shared/client-scope.ts";

const restricted = (ids: number[]): ClientScope => ({ all: false, ids: new Set(ids), membroIds: new Set([7]) });

async function rejection(p: Promise<unknown>): Promise<string | null> {
  try {
    await p;
    return null;
  } catch (e) {
    return (e as Error).message;
  }
}

Deno.test("instagram-analytics ownership: hidden client throws the same Unauthorized as a foreign one", async () => {
  const foreign = createSupabaseQueryMock();
  foreign.queue("clientes", "select", { data: { conta_id: "ws-OTHER" } });
  assertEquals(await rejection(verifyClientOwnership(foreign, "42", "ws-1", allClientsScope())), "Unauthorized");

  const hidden = createSupabaseQueryMock();
  hidden.queue("clientes", "select", { data: { conta_id: "ws-1" } });
  assertEquals(await rejection(verifyClientOwnership(hidden, "42", "ws-1", restricted([9]))), "Unauthorized");
});

Deno.test("instagram-analytics ownership: assigned client and unrestricted caller pass", async () => {
  for (const scope of [restricted([42]), allClientsScope()]) {
    const db = createSupabaseQueryMock();
    db.queue("clientes", "select", { data: { conta_id: "ws-1" } });
    assertEquals(await rejection(verifyClientOwnership(db, "42", "ws-1", scope)), null);
  }
});

Deno.test("instagram-analytics ownership: post tags follow the post's client, no é dele", async () => {
  const row = { data: { instagram_account_id: "a1", instagram_accounts: { client_id: 42, clientes: { conta_id: "ws-1" } } } };
  const hidden = createSupabaseQueryMock();
  hidden.queue("instagram_posts", "select", row);
  assertEquals(await rejection(verifyPostOwnership(hidden, "p1", "ws-1", restricted([9]))), "Unauthorized");

  const assigned = createSupabaseQueryMock();
  assigned.queue("instagram_posts", "select", row);
  assertEquals(await rejection(verifyPostOwnership(assigned, "p1", "ws-1", restricted([42]))), null);
});

Deno.test("instagram-analytics ownership: listings keep only visible clients", () => {
  const clients = [{ id: 1, nome: "A" }, { id: 2, nome: "B" }];
  assertEquals(visibleClients(clients, restricted([2])), [{ id: 2, nome: "B" }]);
  assertEquals(visibleClients(clients, restricted([])), []);
  assertEquals(visibleClients(clients, allClientsScope()), clients);
  assertEquals(visibleClients(null, allClientsScope()), []);
});
