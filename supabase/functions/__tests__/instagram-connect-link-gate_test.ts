import { assertEquals } from "./assert.ts";
import { consumeConnectLink } from "../instagram-connect-link/gate.ts";

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
