import { assert, assertEquals } from "./assert.ts";
import { deleteContact, sendEvent, updateContact } from "../_shared/loops.ts";

Deno.env.set("LOOPS_API_KEY", "test-key");

function stubFetch(status: number, capture?: { req?: Request }) {
  return (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    if (capture) capture.req = new Request(input as string, init);
    return Promise.resolve(new Response(JSON.stringify({ success: status < 300 }), { status }));
  };
}

Deno.test("sendEvent posts eventName and the idempotency key", async () => {
  const cap: { req?: Request } = {};
  await sendEvent({
    email: "a@b.com",
    eventName: "paywall_hit",
    properties: { feature: "feature_hub_portal" },
    idempotencyKey: "paywall_hit/ws-1",
  }, stubFetch(200, cap));

  assertEquals(cap.req!.headers.get("Idempotency-Key"), "paywall_hit/ws-1");
  assertEquals(cap.req!.headers.get("Authorization"), "Bearer test-key");
  const body = await cap.req!.json();
  assertEquals(body.eventName, "paywall_hit");
  assertEquals(body.email, "a@b.com");
  assertEquals(body.eventProperties.feature, "feature_hub_portal");
});

Deno.test("sendEvent treats 409 as success (key already accepted)", async () => {
  await sendEvent({
    email: "a@b.com",
    eventName: "paywall_hit",
    properties: {},
    idempotencyKey: "paywall_hit/ws-1",
  }, stubFetch(409));
});

Deno.test("sendEvent throws on 500 so the claim stays undelivered", async () => {
  let threw = false;
  try {
    await sendEvent({
      email: "a@b.com",
      eventName: "paywall_hit",
      properties: {},
      idempotencyKey: "k",
    }, stubFetch(500));
  } catch {
    threw = true;
  }
  assert(threw, "expected a throw on 500");
});

Deno.test("deleteContact treats 404 as success (already absent)", async () => {
  await deleteContact({ email: "gone@b.com" }, stubFetch(404));
});

Deno.test("deleteContact throws on 500", async () => {
  let threw = false;
  try {
    await deleteContact({ email: "a@b.com" }, stubFetch(500));
  } catch {
    threw = true;
  }
  assert(threw, "expected a throw on 500");
});

Deno.test("updateContact posts email plus traits flattened at the top level", async () => {
  const cap: { req?: Request } = {};
  await updateContact({ email: "a@b.com", traits: { firstName: "Ana", anyFree: true } }, stubFetch(200, cap));
  const body = await cap.req!.json();
  assertEquals(body.email, "a@b.com");
  assertEquals(body.firstName, "Ana");
  assertEquals(body.anyFree, true);
});
