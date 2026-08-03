import { assert, assertEquals } from "./assert.ts";
import {
  createProfile,
  deleteProfile,
  getProfile,
  saveData,
  saveProfile,
} from "../_shared/crisp.ts";

Deno.env.set("CRISP_IDENTIFIER", "test-id");
Deno.env.set("CRISP_KEY", "test-key");
Deno.env.set("CRISP_WEBSITE_ID", "ws-abc");

function stubFetch(
  status: number,
  body: unknown = { error: false, data: {} },
  capture?: { req?: Request },
) {
  return (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    if (capture) capture.req = new Request(input as string, init);
    return Promise.resolve(
      new Response(JSON.stringify(body), {
        status,
        headers: { "Content-Type": "application/json" },
      }),
    );
  };
}

Deno.test("getProfile sends plugin auth headers and returns data", async () => {
  const cap: { req?: Request } = {};
  const profile = await getProfile(
    "ana@example.com",
    stubFetch(200, { error: false, data: { people_id: "p-1", segments: ["vip"] } }, cap),
  );

  assertEquals(profile!.people_id, "p-1");
  assertEquals(profile!.segments, ["vip"]);
  assertEquals(cap.req!.headers.get("X-Crisp-Tier"), "plugin");
  assertEquals(cap.req!.headers.get("Authorization"), `Basic ${btoa("test-id:test-key")}`);
  assert(
    cap.req!.url.includes("/website/ws-abc/people/profile/"),
    `unexpected url: ${cap.req!.url}`,
  );
});

Deno.test("getProfile returns null on 404 instead of throwing", async () => {
  assertEquals(await getProfile("nobody@example.com", stubFetch(404)), null);
});

Deno.test("createProfile returns the new people_id", async () => {
  const id = await createProfile(
    { email: "a@b.com", person: { nickname: "Ana" }, segments: ["owner"] },
    stubFetch(201, { error: false, data: { people_id: "p-2" } }),
  );
  assertEquals(id, "p-2");
});

Deno.test("createProfile returns null on 409 so the caller can re-read", async () => {
  const id = await createProfile(
    { email: "a@b.com", person: {}, segments: [] },
    stubFetch(409, { error: true, reason: "people_exists" }),
  );
  assertEquals(id, null);
});

Deno.test("deleteProfile treats 404 as success (already absent)", async () => {
  await deleteProfile("gone@b.com", stubFetch(404));
});

Deno.test("saveData PATCHes the people/data route with a wrapped data object", async () => {
  const cap: { req?: Request } = {};
  await saveData("p-1", { plano: "Pro" }, stubFetch(200, { error: false, data: {} }, cap));

  assertEquals(cap.req!.method, "PATCH");
  assert(
    cap.req!.url.includes("/website/ws-abc/people/data/p-1"),
    `unexpected url: ${cap.req!.url}`,
  );
  assertEquals(await cap.req!.json(), { data: { plano: "Pro" } });
});

Deno.test("errors never leak the response body or the interpolated path", async () => {
  let message = "";
  try {
    await getProfile(
      "secret@customer.com",
      stubFetch(500, { error: true, reason: "secret@customer.com not allowed" }),
    );
  } catch (e) {
    message = e instanceof Error ? e.message : String(e);
  }

  assert(message.includes("500"), `expected the status in: ${message}`);
  assert(!message.includes("secret@customer.com"), `email leaked: ${message}`);
  assert(message.includes(":ref"), `expected the static route shape in: ${message}`);
});

Deno.test("missing credentials throw before any fetch is attempted", async () => {
  const saved = Deno.env.get("CRISP_KEY")!;
  Deno.env.delete("CRISP_KEY");
  let threw = false;
  try {
    await getProfile("a@b.com", () => {
      throw new Error("fetch must not be called");
    });
  } catch (e) {
    threw = (e as Error).message.includes("Crisp credentials not configured");
  } finally {
    Deno.env.set("CRISP_KEY", saved);
  }
  assert(threw, "expected a credentials error");
});
