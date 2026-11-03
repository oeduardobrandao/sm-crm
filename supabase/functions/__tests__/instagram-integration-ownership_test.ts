// instagram-integration/ownership.ts: client ownership + acesso por cliente for the JWT routes
// (/auth, /sync, /refresh, /disconnect, /summary, /posts, /published-media). index.ts is a
// Deno.serve module; it maps `false` to each route's existing 403 and ClientScopeUnavailableError
// to a generic 500 at the top of its catch.
import { assertEquals } from "./assert.ts";
import { createSupabaseQueryMock } from "../../../test/shared/supabaseMock.ts";
import { ClientScopeUnavailableError, makeClientAccessCheck } from "../instagram-integration/ownership.ts";
import { allClientsScope, type ClientScope } from "../_shared/client-scope.ts";

const restricted = (ids: number[]) => () =>
  Promise.resolve<ClientScope>({ all: false, ids: new Set(ids), membroIds: new Set() });

function ownedDb(conta = "ws-1") {
  const db = createSupabaseQueryMock();
  db.queue("clientes", "select", { data: { conta_id: conta } });
  return db;
}

Deno.test("instagram-integration ownership: foreign and hidden clients both fail the same way", async () => {
  assertEquals(await makeClientAccessCheck("u1", () => Promise.resolve(allClientsScope()))(ownedDb("ws-2"), "42", "ws-1"), false);
  assertEquals(await makeClientAccessCheck("u1", restricted([9]))(ownedDb(), "42", "ws-1"), false);
});

Deno.test("instagram-integration ownership: assigned client and unrestricted caller pass", async () => {
  assertEquals(await makeClientAccessCheck("u1", restricted([42]))(ownedDb(), "42", "ws-1"), true);
  assertEquals(await makeClientAccessCheck("u1", () => Promise.resolve(allClientsScope()))(ownedDb(), "42", "ws-1"), true);
});

Deno.test("instagram-integration ownership: no user (callback) never passes", async () => {
  assertEquals(await makeClientAccessCheck(null, () => Promise.resolve(allClientsScope()))(ownedDb(), "42", "ws-1"), false);
});

Deno.test("instagram-integration ownership: a scope read error raises ClientScopeUnavailableError, never true", async () => {
  // The underlying message mentions "expired": the sentinel keeps it away from the TOKEN_EXPIRED path.
  const check = makeClientAccessCheck("u1", () => Promise.reject(new Error("JWT expired")));
  let caught: unknown = null;
  try {
    await check(ownedDb(), "42", "ws-1");
  } catch (e) {
    caught = e;
  }
  assertEquals(caught instanceof ClientScopeUnavailableError, true);
  assertEquals((caught as Error).message.includes("expired"), false);
});
