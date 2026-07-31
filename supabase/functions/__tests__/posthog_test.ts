import { assertEquals } from "./assert.ts";
import { capturePostHog } from "../_shared/posthog.ts";

function stubFetch(status: number, calls: number[]) {
  return (_input: RequestInfo | URL, _init?: RequestInit): Promise<Response> => {
    calls.push(1);
    return Promise.resolve(new Response(JSON.stringify({ status: 1 }), { status }));
  };
}

Deno.test("capturePostHog is a silent no-op when POSTHOG_PROJECT_KEY is unset", async () => {
  Deno.env.delete("POSTHOG_PROJECT_KEY");
  const calls: number[] = [];
  await capturePostHog("lifecycle_email_triggered", "user-1", { workspace_id: "ws-1" }, stubFetch(200, calls));
  assertEquals(calls.length, 0, "no fetch should be made when the key is unset");
});

Deno.test("capturePostHog posts to /capture/ with the key, distinct_id and properties when configured", async () => {
  Deno.env.set("POSTHOG_PROJECT_KEY", "test-project-key");
  const calls: number[] = [];
  let captured: Request | undefined;
  const fetchImpl = (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    calls.push(1);
    captured = new Request(input as string, init);
    return Promise.resolve(new Response(JSON.stringify({ status: 1 }), { status: 200 }));
  };
  await capturePostHog(
    "lifecycle_email_triggered",
    "user-1",
    { workspace_id: "ws-1", $groups: { workspace: "ws-1" } },
    fetchImpl,
  );
  assertEquals(calls.length, 1);
  assertEquals(captured!.url.endsWith("/capture/"), true);
  const body = await captured!.json();
  assertEquals(body.api_key, "test-project-key");
  assertEquals(body.distinct_id, "user-1");
  assertEquals(body.event, "lifecycle_email_triggered");
  assertEquals(body.properties.workspace_id, "ws-1");
  assertEquals(body.properties.$groups.workspace, "ws-1");
  Deno.env.delete("POSTHOG_PROJECT_KEY");
});

Deno.test("capturePostHog throws on a non-ok response so the caller can log it", async () => {
  Deno.env.set("POSTHOG_PROJECT_KEY", "test-project-key");
  let threw = false;
  try {
    await capturePostHog("lifecycle_email_triggered", "user-1", {}, stubFetch(500, []));
  } catch {
    threw = true;
  }
  assertEquals(threw, true);
  Deno.env.delete("POSTHOG_PROJECT_KEY");
});
