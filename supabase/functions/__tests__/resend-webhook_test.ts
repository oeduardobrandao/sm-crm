import { assertEquals } from "./assert.ts";
import { type ApplyEventArgs, handleResendWebhook } from "../resend-webhook/handler.ts";

const KEY_BYTES = new Uint8Array(24).map((_, i) => i + 7);
const SECRET = "whsec_" + btoa(String.fromCharCode(...KEY_BYTES));
const NOW_MS = 1_800_000_000_000;

async function signed(body: string, id = "msg_1"): Promise<Request> {
  const ts = String(NOW_MS / 1000);
  const key = await crypto.subtle.importKey("raw", KEY_BYTES, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = new Uint8Array(
    await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${id}.${ts}.${body}`)),
  );
  return new Request("https://x.test/resend-webhook", {
    method: "POST",
    body,
    headers: {
      "svix-id": id,
      "svix-timestamp": ts,
      "svix-signature": "v1," + btoa(String.fromCharCode(...mac)),
    },
  });
}

function setup(result: boolean | Error = true) {
  const calls: ApplyEventArgs[] = [];
  const deps = {
    secret: SECRET,
    now: () => NOW_MS,
    applyEvent: (a: ApplyEventArgs) => {
      calls.push(a);
      if (result instanceof Error) return Promise.reject(result);
      return Promise.resolve(result);
    },
  };
  return { calls, deps };
}

const payload = (type: string, data: Record<string, unknown>) => JSON.stringify({ type, data });

Deno.test("GET is 405", async () => {
  const { deps } = setup();
  const res = await handleResendWebhook(new Request("https://x.test/", { method: "GET" }), deps);
  assertEquals(res.status, 405);
});

Deno.test("invalid signature is 401 and applyEvent not called", async () => {
  const { deps, calls } = setup();
  const req = await signed(payload("email.sent", {}));
  const bad = new Request(req.url, { method: "POST", body: payload("email.sent", { x: 1 }), headers: req.headers });
  const res = await handleResendWebhook(bad, deps);
  assertEquals(res.status, 401);
  assertEquals(calls.length, 0);
});

Deno.test("non-JSON body with valid signature is 400", async () => {
  const { deps } = setup();
  const res = await handleResendWebhook(await signed("not json"), deps);
  assertEquals(res.status, 400);
});

Deno.test("email.opened is 200 without applyEvent", async () => {
  const { deps, calls } = setup();
  const res = await handleResendWebhook(await signed(payload("email.opened", { email_id: "e1" })), deps);
  assertEquals(res.status, 200);
  assertEquals(calls.length, 0);
});

Deno.test("email.bounced passes PII and classification", async () => {
  const { deps, calls } = setup();
  const body = payload("email.bounced", {
    email_id: "e1",
    created_at: "2026-11-06T10:00:00.000Z",
    from: "Mesaas <no-reply@mesaas.com.br>",
    to: ["a@b.com"],
    subject: "Oi",
    tags: { type: "nurture_a1" },
    bounce: { type: "Permanent", subType: "Suppressed", message: "x" },
  });
  const res = await handleResendWebhook(await signed(body, "msg_9"), deps);
  assertEquals(res.status, 200);
  assertEquals(calls.length, 1);
  const c = calls[0];
  assertEquals(c.svixId, "msg_9");
  assertEquals(c.emailId, "e1");
  assertEquals(c.event, "bounced");
  assertEquals(c.category, "ciclo_de_vida");
  assertEquals(c.type, "nurture_a1");
  assertEquals(c.hasTag, true);
  assertEquals(c.sentAt, "2026-11-06T10:00:00.000Z");
  assertEquals(c.recipient, "a@b.com");
  assertEquals(c.subject, "Oi");
  assertEquals(c.bounceType, "Permanent");
  assertEquals(c.bounceSubtype, "Suppressed");
  assertEquals(c.bounceMessage, "x");
});

Deno.test("email.delivered has null recipient and subject", async () => {
  const { deps, calls } = setup();
  const body = payload("email.delivered", {
    email_id: "e2",
    created_at: "2026-11-06T10:00:00.000Z",
    from: "a@mesaas.com.br",
    to: ["a@b.com"],
    subject: "Oi",
  });
  const res = await handleResendWebhook(await signed(body), deps);
  assertEquals(res.status, 200);
  assertEquals(calls[0].recipient, null);
  assertEquals(calls[0].subject, null);
  assertEquals(calls[0].hasTag, false);
  assertEquals(calls[0].bounceType, null);
});

Deno.test("duplicate (false) is 200", async () => {
  const { deps } = setup(false);
  const res = await handleResendWebhook(
    await signed(payload("email.sent", { email_id: "e", created_at: "2026-11-06T10:00:00Z", from: "a@b", subject: "s" })),
    deps,
  );
  assertEquals(res.status, 200);
});

Deno.test("applyEvent throwing is 500 without the error message", async () => {
  const { deps } = setup(new Error("secret db detail"));
  const res = await handleResendWebhook(
    await signed(payload("email.sent", { email_id: "e", created_at: "2026-11-06T10:00:00Z", from: "a@b", subject: "s" })),
    deps,
  );
  assertEquals(res.status, 500);
  assertEquals((await res.text()).includes("secret db detail"), false);
});

Deno.test("email.failed maps data.failed.reason to bounceMessage", async () => {
  const { deps, calls } = setup();
  const body = payload("email.failed", {
    email_id: "f1",
    created_at: "2026-11-06T10:00:00.000Z",
    from: "a@mesaas.com.br",
    to: ["a@b.com"],
    subject: "Oi",
    failed: { reason: "reached_daily_quota" },
  });
  assertEquals((await handleResendWebhook(await signed(body), deps)).status, 200);
  assertEquals(calls[0].event, "failed");
  assertEquals(calls[0].bounceMessage, "reached_daily_quota");
  assertEquals(calls[0].bounceType, null);
});

Deno.test("email.suppressed maps data.suppressed type and message", async () => {
  const { deps, calls } = setup();
  const body = payload("email.suppressed", {
    email_id: "s1",
    created_at: "2026-11-06T10:00:00.000Z",
    from: "a@mesaas.com.br",
    to: ["a@b.com"],
    subject: "Oi",
    suppressed: { type: "OnAccountSuppressionList", message: "on list" },
  });
  assertEquals((await handleResendWebhook(await signed(body), deps)).status, 200);
  assertEquals(calls[0].event, "suppressed");
  assertEquals(calls[0].bounceType, "OnAccountSuppressionList");
  assertEquals(calls[0].bounceMessage, "on list");
});

Deno.test("unknown tag type is hasTag false", async () => {
  const { deps, calls } = setup();
  const body = payload("email.sent", {
    email_id: "u1",
    created_at: "2026-11-06T10:00:00.000Z",
    from: "a@mesaas.com.br",
    subject: "Oi",
    tags: { type: "not_a_real_type" },
  });
  assertEquals((await handleResendWebhook(await signed(body), deps)).status, 200);
  assertEquals(calls[0].hasTag, false);
});
