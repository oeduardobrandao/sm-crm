import { assert, assertEquals } from "./assert.ts";
import {
  buildDigestHtml,
  buildDigestIdempotencyKey,
  digestSubject,
  resolveDigestItem,
  sendNotificationDigestEmail,
} from "../_shared/notification-email.ts";

Deno.test("resolveDigestItem: publish failure reuses getPublishErrorDisplay copy", () => {
  const item = resolveDigestItem({
    type: "post_publish_failed",
    metadata: { publish_error_code: "TOKEN_EXPIRED", client_name: "ACME", post_title: "Lançamento" },
    link: "/entregas?drawer=1&post=2",
  });
  assertEquals(item.priority, 1);
  assertEquals(item.heading, "Conexão com o Instagram expirou");
  assert(item.body!.includes("Reconecte"));
  assertEquals(item.context, "ACME · Lançamento");
  assertEquals(item.link, "/entregas?drawer=1&post=2");
});

Deno.test("resolveDigestItem: mention priority is last, uses actor + excerpt", () => {
  const item = resolveDigestItem({
    type: "mention",
    metadata: { actor_name: "Ana", context_title: "Post A", excerpt: "veja isso" },
    link: "/x",
  });
  assertEquals(item.priority, 5);
  assertEquals(item.heading, "Ana mencionou você");
  assertEquals(item.body, "veja isso");
  assertEquals(item.context, "Post A");
});

Deno.test("resolveDigestItem: unknown/missing metadata degrades gracefully, no throw", () => {
  const item = resolveDigestItem({ type: "task_assigned", metadata: null, link: null });
  assertEquals(item.priority, 4);
  assertEquals(item.link, "/");
  assert(item.heading.length > 0);
});

Deno.test("digestSubject: single vs multiple", () => {
  const one = digestSubject([{ priority: 1, heading: "x", link: "/" }]);
  const many = digestSubject([
    { priority: 1, heading: "x", link: "/" },
    { priority: 2, heading: "y", link: "/" },
    { priority: 5, heading: "z", link: "/" },
  ]);
  assert(!one.includes("—"), "no em dash in subject");
  assertEquals(many, "Você tem 3 novidades no Mesaas");
});

Deno.test("buildDigestIdempotencyKey: stable for same id set, differs when it changes", async () => {
  const a = await buildDigestIdempotencyKey("u1", ["b", "a"]);
  const b = await buildDigestIdempotencyKey("u1", ["a", "b"]); // order-insensitive
  const c = await buildDigestIdempotencyKey("u1", ["a", "b", "c"]);
  assertEquals(a, b);
  assert(a !== c);
  assert(a.startsWith("notif-digest:u1:"));
});

Deno.test("sendNotificationDigestEmail: treats Resend 409 (key already accepted) as a deduped success, not a failure", async () => {
  const prevKey = Deno.env.get("RESEND_API_KEY");
  const prevBase = Deno.env.get("APP_BASE_URL");
  Deno.env.set("RESEND_API_KEY", "test-key");
  Deno.env.set("APP_BASE_URL", "https://app.example.test");
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (() =>
    Promise.resolve(new Response('{"name":"invalid_idempotent_request"}', { status: 409 }))) as typeof fetch;
  try {
    // Must NOT throw: a 409 means a prior retry already delivered this exact
    // digest under this idempotency key, so the claim should still be marked
    // sent (skipped: false), not released for a re-send loop.
    const result = await sendNotificationDigestEmail({
      to: "a@b.test",
      items: [{ priority: 1, heading: "x", link: "/" }],
      idempotencyKey: "notif-digest:u1:abc123",
    });
    assertEquals(result, { skipped: false });
  } finally {
    globalThis.fetch = originalFetch;
    if (prevKey === undefined) Deno.env.delete("RESEND_API_KEY");
    else Deno.env.set("RESEND_API_KEY", prevKey);
    if (prevBase === undefined) Deno.env.delete("APP_BASE_URL");
    else Deno.env.set("APP_BASE_URL", prevBase);
  }
});

Deno.test("sendNotificationDigestEmail: a genuine non-2xx (500) still throws", async () => {
  const prevKey = Deno.env.get("RESEND_API_KEY");
  const prevBase = Deno.env.get("APP_BASE_URL");
  Deno.env.set("RESEND_API_KEY", "test-key");
  Deno.env.set("APP_BASE_URL", "https://app.example.test");
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (() => Promise.resolve(new Response("nope", { status: 500 }))) as typeof fetch;
  let threw = false;
  try {
    await sendNotificationDigestEmail({
      to: "a@b.test",
      items: [{ priority: 1, heading: "x", link: "/" }],
      idempotencyKey: "notif-digest:u1:abc123",
    });
  } catch {
    threw = true;
  } finally {
    globalThis.fetch = originalFetch;
    if (prevKey === undefined) Deno.env.delete("RESEND_API_KEY");
    else Deno.env.set("RESEND_API_KEY", prevKey);
    if (prevBase === undefined) Deno.env.delete("APP_BASE_URL");
    else Deno.env.set("APP_BASE_URL", prevBase);
  }
  assert(threw, "expected a genuine non-2xx (500) to throw, not be swallowed like 409");
});

Deno.test("buildDigestHtml: escapes user-controlled heading/body, no raw <script> in output", () => {
  const html = buildDigestHtml(
    [
      {
        priority: 1,
        heading: '<script>alert(1)</script>',
        body: 'aspas " & "e-comercial"',
        link: "/x",
      },
    ],
    "https://app.example.test",
  );
  assert(!html.includes("<script>alert(1)</script>"), "raw <script> leaked into digest HTML unescaped");
  assert(html.includes("&lt;script&gt;"), "expected escaped heading in output");
  assert(html.includes("&amp;"), "expected escaped ampersand in output");
  assert(html.includes("&quot;"), "expected escaped quote in output");
});
