import { assertEquals } from "./assert.ts";
import { buildHubUrl, resolveHubUrl } from "../_shared/hub-url.ts";
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";

Deno.test("buildHubUrl: assembles the public hub URL", () => {
  assertEquals(
    buildHubUrl("https://app.mesaas.com.br", "agencia-dk", "tok-1"),
    "https://app.mesaas.com.br/agencia-dk/hub/tok-1",
  );
});

Deno.test("buildHubUrl: tolerates a trailing slash on the base", () => {
  assertEquals(
    buildHubUrl("https://app.mesaas.com.br/", "agencia-dk", "tok-1"),
    "https://app.mesaas.com.br/agencia-dk/hub/tok-1",
  );
});

Deno.test("buildHubUrl: returns empty when any part is missing", () => {
  assertEquals(buildHubUrl("https://x.test", null, "tok-1"), "");
  assertEquals(buildHubUrl("https://x.test", "slug", null), "");
});

/** Mirrors the makeDb() stub pattern from hub-bootstrap_test.ts. */
function makeDb(opts: {
  slug: string | null;
  token: string | null;
  featureOn: boolean;
  rpcError?: unknown;
}): SupabaseClient {
  return {
    from: (table: string) => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({ data: opts.slug ? { slug: opts.slug } : null }),
          eq: () => ({
            eq: () => ({
              gt: () => ({
                order: () => ({
                  limit: () => ({
                    maybeSingle: async () => ({
                      data: opts.token ? { token: opts.token } : null,
                    }),
                  }),
                }),
              }),
            }),
          }),
        }),
      }),
      _table: table,
    }),
    rpc: async () =>
      opts.rpcError
        ? { data: null, error: opts.rpcError }
        : { data: opts.featureOn, error: null },
  } as unknown as SupabaseClient;
}

Deno.test("resolveHubUrl: returns a link for a live token on an enabled plan", async () => {
  // appBaseUrl() now throws when APP_BASE_URL is unset — set it explicitly so this test's
  // success path is independent of whatever order the suite runs in.
  Deno.env.set("APP_BASE_URL", "https://app.mesaas.com.br");
  const db = makeDb({ slug: "agencia-dk", token: "tok-1", featureOn: true });
  const url = await resolveHubUrl(db, 7, "ws-1");
  assertEquals(url.endsWith("/agencia-dk/hub/tok-1"), true);
});

Deno.test("resolveHubUrl: returns empty when the workspace has no live token", async () => {
  const db = makeDb({ slug: "agencia-dk", token: null, featureOn: true });
  assertEquals(await resolveHubUrl(db, 7, "ws-1"), "");
});

Deno.test("resolveHubUrl: returns empty when the plan lost feature_hub_portal", async () => {
  // A downgraded workspace can still hold a live token. Emailing the agency's own client a link
  // that hub-bootstrap will reject is worse than omitting the button.
  const db = makeDb({ slug: "agencia-dk", token: "tok-1", featureOn: false });
  assertEquals(await resolveHubUrl(db, 7, "ws-1"), "");
});

Deno.test("resolveHubUrl: returns empty when the workspace has no slug", async () => {
  const db = makeDb({ slug: null, token: "tok-1", featureOn: true });
  assertEquals(await resolveHubUrl(db, 7, "ws-1"), "");
});

Deno.test("resolveHubUrl: returns empty (never throws) when the feature RPC errors", async () => {
  // effectivePlanFeature throws on any RPC error. resolveHubUrl's docstring promises the
  // failure mode stays "no button" rather than an error propagating into the caller
  // (instagram-analytics' manual send, report-worker's monthly auto-send) — verify that holds.
  const db = makeDb({
    slug: "agencia-dk",
    token: "tok-1",
    featureOn: true,
    rpcError: new Error("rpc unavailable"),
  });
  assertEquals(await resolveHubUrl(db, 7, "ws-1"), "");
});
