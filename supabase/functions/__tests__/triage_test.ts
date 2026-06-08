import { assert, assertEquals } from "./assert.ts";
import { computeSignature } from "../_shared/triage.ts";

Deno.test("computeSignature collapses volatile IDs to one signature+hash", () => {
  const a = computeSignature(
    "instagram-sync-cron",
    "Token expired for account 7f3a1c2b-1111-2222-3333-444455556666 at 2026-06-08T10:00:00Z (attempt 3)",
  );
  const b = computeSignature(
    "instagram-sync-cron",
    "Token expired for account 0a0a0a0a-9999-8888-7777-666655554444 at 2026-06-08T11:30:12Z (attempt 7)",
  );
  assertEquals(a.signature, b.signature);
  assertEquals(a.hash, b.hash);
});

Deno.test("computeSignature distinguishes genuinely different errors", () => {
  const a = computeSignature("instagram-sync-cron", "Token expired");
  const b = computeSignature("instagram-sync-cron", "Rate limit exceeded");
  assert(a.signature !== b.signature);
  assert(a.hash !== b.hash);
});

Deno.test("computeSignature hash is short and label-safe", () => {
  const { hash } = computeSignature("c", "some error 123");
  assert(/^[a-z0-9]+$/.test(hash), `hash not label-safe: ${hash}`);
  assert(hash.length <= 12, `hash too long: ${hash.length}`);
  assert(("cron-triage:" + hash).length <= 50);
});

import { renderFailureReport } from "../_shared/triage.ts";

Deno.test("renderFailureReport includes cron, signature, hash, errors, stack", () => {
  const { signature, hash } = computeSignature("report-worker", "boom");
  const text = renderFailureReport(
    "report-worker",
    {
      total: 1,
      failed: 1,
      errors: [{ accountId: "42", error: "Network error after 3 attempts" }],
      stack: "Error: boom\n  at x",
    },
    signature,
    hash,
  );
  assert(text.includes("report-worker"));
  assert(text.includes(signature));
  assert(text.includes(hash));
  assert(text.includes("42"));
  assert(text.includes("Network error after 3 attempts"));
  assert(text.includes("Error: boom"));
});

import { reportCronFailure } from "../_shared/triage.ts";
import { createSupabaseQueryMock } from "../../../test/shared/supabaseMock.ts";

function stubFetch(handler: (url: string, init?: RequestInit) => Promise<Response>) {
  const original = globalThis.fetch;
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  globalThis.fetch = ((input: unknown, init?: RequestInit) => {
    calls.push({ url: String(input), init });
    return handler(String(input), init);
  }) as typeof fetch;
  return { calls, restore: () => { globalThis.fetch = original; } };
}

Deno.test("reportCronFailure fires the routine when the claim is won", async () => {
  Deno.env.set("TRIAGE_ROUTINE_URL", "https://api.anthropic.test/routines/x/fire");
  Deno.env.set("TRIAGE_ROUTINE_TOKEN", "sk-ant-oat01-test");
  Deno.env.set("RESEND_API_KEY", ""); // suppress email path in this test
  const db = createSupabaseQueryMock();
  db.queue("cron_failures", "insert", { data: null, error: null });
  db.queueRpc("claim_cron_triage", { data: true, error: null });
  const f = stubFetch(() => Promise.resolve(new Response("{}", { status: 200 })));
  try {
    await reportCronFailure(db as never, "instagram-sync-cron", {
      total: 3, failed: 1, errors: [{ accountId: "9", error: "Token expired" }],
    });
  } finally { f.restore(); }
  const fires = f.calls.filter((c) => c.url.includes("/fire"));
  assertEquals(fires.length, 1);
  const body = JSON.parse(String(fires[0].init?.body));
  assert(typeof body.text === "string" && body.text.includes("instagram-sync-cron"));
});

Deno.test("reportCronFailure skips the routine when within cooldown", async () => {
  Deno.env.set("TRIAGE_ROUTINE_URL", "https://api.anthropic.test/routines/x/fire");
  Deno.env.set("TRIAGE_ROUTINE_TOKEN", "sk-ant-oat01-test");
  Deno.env.set("RESEND_API_KEY", "");
  const db = createSupabaseQueryMock();
  db.queue("cron_failures", "insert", { data: null, error: null });
  db.queueRpc("claim_cron_triage", { data: null, error: null });
  const f = stubFetch(() => Promise.resolve(new Response("{}", { status: 200 })));
  try {
    await reportCronFailure(db as never, "instagram-sync-cron", {
      total: 1, failed: 1, errors: [{ error: "x" }],
    });
  } finally { f.restore(); }
  assertEquals(f.calls.filter((c) => c.url.includes("/fire")).length, 0);
});

Deno.test("reportCronFailure still emails when the insert rejects", async () => {
  Deno.env.set("TRIAGE_ROUTINE_URL", ""); // no fire
  Deno.env.set("TRIAGE_ROUTINE_TOKEN", "");
  Deno.env.set("RESEND_API_KEY", "test-key");
  Deno.env.set("ALERT_EMAIL", "alerts@example.test");
  const db = createSupabaseQueryMock();
  db.queue("cron_failures", "insert", { data: null, error: { message: "db down" } });
  const f = stubFetch(() => Promise.resolve(new Response("{}", { status: 200 })));
  try {
    await reportCronFailure(db as never, "report-worker", {
      total: 1, failed: 1, errors: [{ error: "x" }],
    });
  } finally { f.restore(); }
  assert(
    f.calls.some((c) => c.url.includes("api.resend.com")),
    "email not attempted after insert error",
  );
});

Deno.test("reportCronFailure never throws when rpc and fetch reject", async () => {
  Deno.env.set("TRIAGE_ROUTINE_URL", "https://api.anthropic.test/routines/x/fire");
  Deno.env.set("TRIAGE_ROUTINE_TOKEN", "sk-ant-oat01-test");
  Deno.env.set("RESEND_API_KEY", "");
  const db = createSupabaseQueryMock();
  db.queue("cron_failures", "insert", () => { throw new Error("insert blew up"); });
  db.queueRpc("claim_cron_triage", () => { throw new Error("rpc blew up"); });
  const f = stubFetch(() => Promise.reject(new Error("network down")));
  let threw = false;
  try {
    await reportCronFailure(db as never, "instagram-sync-cron", {
      total: 1, failed: 1, errors: [{ error: "x" }],
    });
  } catch {
    threw = true;
  } finally { f.restore(); }
  assertEquals(threw, false);
});
