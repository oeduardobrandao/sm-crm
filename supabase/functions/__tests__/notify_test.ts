import { assert } from "./assert.ts";
import { sendCronFailureEmail } from "../_shared/notify.ts";

Deno.test("sendCronFailureEmail escapes error text in the HTML body", async () => {
  const original = globalThis.fetch;
  Deno.env.set("RESEND_API_KEY", "test-key");
  Deno.env.set("ALERT_EMAIL", "alerts@example.test");
  let capturedBody = "";
  globalThis.fetch = ((_input: unknown, init?: RequestInit) => {
    capturedBody = String(init?.body ?? "");
    return Promise.resolve(new Response("{}", { status: 200 }));
  }) as typeof fetch;
  try {
    await sendCronFailureEmail("instagram-sync-cron", {
      total: 2,
      failed: 1,
      errors: [{ accountId: "1", error: "<script>alert(1)</script>" }],
      stack: "Error: <b>bad</b>",
    });
  } finally {
    globalThis.fetch = original;
  }
  const payload = JSON.parse(capturedBody);
  assert(typeof payload.html === "string");
  assert(payload.html.includes("&lt;script&gt;"), "error text not escaped");
  assert(!payload.html.includes("<script>alert"), "raw script tag leaked into html");
});
