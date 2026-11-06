import { assert, assertEquals } from "./assert.ts";
import {
  signNurtureUnsubToken,
  verifyNurtureUnsubToken,
  nurtureUnsubUrl,
} from "../_shared/nurture-unsub-token.ts";
import { createNurtureUnsubHandler, type NurtureUnsubDb } from "../nurture-unsub/handler.ts";

const NOW = new Date("2026-11-06T12:00:00.000Z");
const SECRET = "test-secret";
const UID = "123e4567-e89b-42d3-a456-426614174000";
const cors = () => ({ "Access-Control-Allow-Origin": "https://app.mesaas.com" });

function b64url(s: string): string {
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function signRaw(payloadObj: unknown, secret: string): Promise<string> {
  const enc = new TextEncoder();
  const payload = b64url(JSON.stringify(payloadObj));
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(payload)));
  let s = "";
  for (const b of sig) s += String.fromCharCode(b);
  return `${payload}.${b64url(s)}`;
}

function makeFakeDb(error: { message: string } | null = null) {
  const calls: Array<{ patch: unknown; col: string; id: string; isCol: string; isVal: unknown }> = [];
  const db: NurtureUnsubDb = {
    from(_t: "profiles") {
      return {
        update(patch) {
          return {
            eq(col, id) {
              return {
                is(isCol, isVal) {
                  calls.push({ patch, col, id, isCol, isVal });
                  return Promise.resolve({ error });
                },
              };
            },
          };
        },
      };
    },
  };
  return { db, calls };
}

function makeHandler(db: NurtureUnsubDb) {
  return createNurtureUnsubHandler({ db, tokenSecret: SECRET, now: () => NOW, buildCorsHeaders: cors });
}

const reqFor = (method: string, token: string) =>
  new Request(`https://x.supabase.co/functions/v1/nurture-unsub/${token}`, { method });

Deno.test("token round-trips and rejects tampering", async () => {
  const t = await signNurtureUnsubToken(UID, SECRET);
  assertEquals(await verifyNurtureUnsubToken(t, SECRET), UID);
  const flipped = t.slice(0, -1) + (t.endsWith("A") ? "B" : "A");
  assertEquals(await verifyNurtureUnsubToken(flipped, SECRET), null);
  assertEquals(await verifyNurtureUnsubToken(await signNurtureUnsubToken(UID, "other"), SECRET), null);
  assertEquals(await verifyNurtureUnsubToken(await signRaw({ u: "not-a-uuid" }, SECRET), SECRET), null);
  for (const bad of ["", "a.", ".b"]) assertEquals(await verifyNurtureUnsubToken(bad, SECRET), null);
});

Deno.test("nurtureUnsubUrl builds the function path", () => {
  assertEquals(nurtureUnsubUrl("https://x.supabase.co", "tok"), "https://x.supabase.co/functions/v1/nurture-unsub/tok");
});

Deno.test("GET valid token renders confirmation and never writes", async () => {
  const { db, calls } = makeFakeDb();
  const token = await signNurtureUnsubToken(UID, SECRET);
  const res = await makeHandler(db)(reqFor("GET", token));
  assertEquals(res.status, 200);
  assert(res.headers.get("Content-Type")!.includes("text/html"));
  const body = await res.text();
  assert(body.includes('<form method="post">'));
  assert(!body.includes("—"));
  assertEquals(calls.length, 0);
});

Deno.test("POST valid token stamps opt-out", async () => {
  const { db, calls } = makeFakeDb();
  const token = await signNurtureUnsubToken(UID, SECRET);
  const res = await makeHandler(db)(reqFor("POST", token));
  assertEquals(res.status, 200);
  const body = await res.text();
  assert(!body.includes("—"));
  assertEquals(calls.length, 1);
  assertEquals(calls[0].patch, { nurture_opt_out_at: NOW.toISOString() });
  assertEquals(calls[0].col, "id");
  assertEquals(calls[0].id, UID);
  assertEquals(calls[0].isCol, "nurture_opt_out_at");
  assertEquals(calls[0].isVal, null);
});

Deno.test("POST replay is idempotent", async () => {
  const { db } = makeFakeDb();
  const h = makeHandler(db);
  const token = await signNurtureUnsubToken(UID, SECRET);
  assertEquals((await h(reqFor("POST", token))).status, 200);
  assertEquals((await h(reqFor("POST", token))).status, 200);
});

Deno.test("bad token is 404 and never writes", async () => {
  const { db, calls } = makeFakeDb();
  const h = makeHandler(db);
  const token = await signNurtureUnsubToken(UID, "other");
  for (const m of ["GET", "POST"]) {
    const res = await h(reqFor(m, token));
    assertEquals(res.status, 404);
    assert(!(await res.text()).includes("—"));
  }
  assertEquals(calls.length, 0);
});

Deno.test("db error is a generic 500", async () => {
  const { db } = makeFakeDb({ message: "boom" });
  const token = await signNurtureUnsubToken(UID, SECRET);
  const res = await makeHandler(db)(reqFor("POST", token));
  assertEquals(res.status, 500);
  const body = await res.text();
  assert(!body.includes("boom"));
  assert(!body.includes("—"));
});

Deno.test("OPTIONS returns cors, other methods 405", async () => {
  const { db } = makeFakeDb();
  const h = makeHandler(db);
  const opt = await h(reqFor("OPTIONS", "x"));
  assert(opt.status === 200 || opt.status === 204);
  assertEquals(opt.headers.get("Access-Control-Allow-Origin"), "https://app.mesaas.com");
  assertEquals((await h(reqFor("PUT", "x"))).status, 405);
});
