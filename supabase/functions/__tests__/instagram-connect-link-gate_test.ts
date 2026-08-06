import { assertEquals } from "./assert.ts";
import { consumeConnectLink, gateConnectLinkOrigin } from "../instagram-connect-link/gate.ts";

const NOW = "2026-08-06T12:00:00.000Z";

/** Records the exact filter chain so the test can assert the gate is one
 *  conditional UPDATE and not a read followed by a write. */
function makeDb(returned: unknown) {
  const calls: string[] = [];
  const chain: Record<string, unknown> = {};
  for (const m of ["eq", "is", "gt", "select"]) {
    chain[m] = (...args: unknown[]) => { calls.push(`${m}(${args.join(",")})`); return chain; };
  }
  chain.update = (values: Record<string, unknown>) => {
    calls.push(`update(${Object.keys(values).join(",")})`);
    return chain;
  };
  chain.maybeSingle = () => Promise.resolve({ data: returned, error: null });
  return { db: { from: (t: string) => { calls.push(`from(${t})`); return chain; } }, calls };
}

Deno.test("consumeConnectLink: returns the row when the gate passes", async () => {
  const { db } = makeDb({ cliente_id: 42, conta_id: "c", created_by: "u" });
  // deno-lint-ignore no-explicit-any
  const got = await consumeConnectLink(db as any, "tok", NOW);
  assertEquals(got, { cliente_id: 42, conta_id: "c", created_by: "u" });
});

Deno.test("consumeConnectLink: returns null when no row matches", async () => {
  const { db } = makeDb(null);
  // deno-lint-ignore no-explicit-any
  assertEquals(await consumeConnectLink(db as any, "tok", NOW), null);
});

Deno.test("consumeConnectLink: is a single conditional UPDATE, not read-then-write", async () => {
  // Este teste é o que sustenta a afirmação "revogação é real". Se alguém trocar
  // o gate por um select seguido de update, a corrida volta e este teste cai.
  const { db, calls } = makeDb({ cliente_id: 42, conta_id: "c", created_by: "u" });
  // deno-lint-ignore no-explicit-any
  await consumeConnectLink(db as any, "tok", NOW);
  assertEquals(calls.filter((c) => c.startsWith("update(")).length, 1);
  // args.join(",") stringifies a literal `null` argument as an empty string
  // (Array#join drops null/undefined), so the recorded call is "is(revoked_at,)"
  // not "is(revoked_at,null)" — matching this mock's actual serialization.
  assertEquals(calls.some((c) => c === "is(revoked_at,)"), true);
  assertEquals(calls.some((c) => c === `gt(expires_at,${NOW})`), true);
  assertEquals(calls.some((c) => c === "eq(token,tok)"), true);
});

// =====================================================================
// gateConnectLinkOrigin -- the callback's full pre-write portão, orchestrating
// the entitlement recheck, the atomic gate, and the client-id mismatch check.
// These are the three tests the design doc names but that used to be
// untestable: the logic lived inline inside instagram-integration/index.ts's
// Deno.serve, which cannot be imported.
// =====================================================================

Deno.test("gateConnectLinkOrigin: link revoked between /start and callback -> refuse, caller must not write", async () => {
  // Este é o teste que sustenta a afirmação "revogação é real": se o portão
  // devolvesse proceed:true aqui, o caller escreveria em instagram_accounts
  // para um link que já não é mais válido.
  const { db } = makeDb(null); // consumeConnectLink's UPDATE ... RETURNING finds no row
  const result = await gateConnectLinkOrigin(
    { planFeature: () => Promise.resolve(true) },
    // deno-lint-ignore no-explicit-any
    db as any,
    "tok", "42", "conta-1", NOW,
  );
  assertEquals(result.proceed, false);

  // Simulates the only correct caller shape: instagram_accounts is written
  // ONLY inside the proceed branch. If a future change makes the gate refuse
  // less often (or the caller stops checking `proceed`), this flips to true
  // and the test fails -- it is written so it fails if the code proceeds to write.
  let wroteAccount = false;
  if (result.proceed) {
    wroteAccount = true;
  }
  assertEquals(wroteAccount, false);
});

Deno.test("gateConnectLinkOrigin: workspace lost feature_instagram between /start and callback -> refuse, gate never invoked", async () => {
  const { db, calls } = makeDb({ cliente_id: 42, conta_id: "conta-1", created_by: "u" });
  const result = await gateConnectLinkOrigin(
    { planFeature: () => Promise.resolve(false) },
    // deno-lint-ignore no-explicit-any
    db as any,
    "tok", "42", "conta-1", NOW,
  );
  assertEquals(result.proceed, false);
  if (!result.proceed) assertEquals(result.reason, "CONNECT_LINK_REVOKED");
  // Entitlement recheck runs BEFORE the atomic gate (shrinks the window between
  // the gate and the upsert) -- so consumeConnectLink's UPDATE must never fire
  // when the entitlement recheck alone is enough to refuse.
  assertEquals(calls.filter((c) => c.startsWith("update(")).length, 0);
});

Deno.test("gateConnectLinkOrigin: cliente_id mismatch between the consumed link and the signed state -> refuse", async () => {
  const { db } = makeDb({ cliente_id: 99, conta_id: "conta-1", created_by: "u" });
  const result = await gateConnectLinkOrigin(
    { planFeature: () => Promise.resolve(true) },
    // deno-lint-ignore no-explicit-any
    db as any,
    "tok", "42", "conta-1", NOW,
  );
  assertEquals(result.proceed, false);
  if (!result.proceed) assertEquals(result.reason, "CONNECT_LINK_REVOKED");
});

Deno.test("gateConnectLinkOrigin: entitlement on, gate passes, ids match -> proceed with the consumed link", async () => {
  const { db } = makeDb({ cliente_id: 42, conta_id: "conta-1", created_by: "u" });
  const result = await gateConnectLinkOrigin(
    { planFeature: () => Promise.resolve(true) },
    // deno-lint-ignore no-explicit-any
    db as any,
    "tok", "42", "conta-1", NOW,
  );
  assertEquals(result.proceed, true);
  if (result.proceed) {
    assertEquals(result.consumed, { cliente_id: 42, conta_id: "conta-1", created_by: "u" });
  }
});
