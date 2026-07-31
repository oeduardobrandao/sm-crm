import { assertEquals } from "./assert.ts";
import { createPaywallReportHandler, type PaywallReportDeps } from "../paywall-report/handler.ts";

function makeDeps(over: Partial<PaywallReportDeps> = {}): PaywallReportDeps {
  return {
    getUser: () => Promise.resolve({ id: "user-1" }),
    isMember: () => Promise.resolve(true),
    insertHit: () => Promise.resolve(),
    ...over,
  };
}

function req(body: unknown, auth = "Bearer tok"): Request {
  return new Request("https://x/paywall-report", {
    method: "POST",
    headers: { Authorization: auth, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

Deno.test("rejects a request with no Authorization header", async () => {
  const res = await createPaywallReportHandler(makeDeps())(
    new Request("https://x/paywall-report", { method: "POST", body: "{}" }),
  );
  assertEquals(res.status, 401);
});

Deno.test("rejects when the token resolves to no user", async () => {
  const deps = makeDeps({ getUser: () => Promise.resolve(null) });
  const res = await createPaywallReportHandler(deps)(req({ workspace_id: "ws-1", feature: "f" }));
  assertEquals(res.status, 401);
});

Deno.test("rejects a workspace the caller is not a member of", async () => {
  let inserted = false;
  const deps = makeDeps({
    isMember: () => Promise.resolve(false),
    insertHit: () => {
      inserted = true;
      return Promise.resolve();
    },
  });
  const res = await createPaywallReportHandler(deps)(
    req({ workspace_id: "someone-elses-ws", feature: "feature_hub_portal" }),
  );
  assertEquals(res.status, 403);
  assertEquals(inserted, false, "must not insert for a non-member");
});

Deno.test("membership is checked against the AUTHENTICATED user id, not the body", async () => {
  const seen: Array<{ userId: string; workspaceId: string }> = [];
  const deps = makeDeps({
    getUser: () => Promise.resolve({ id: "real-user" }),
    isMember: (userId, workspaceId) => {
      seen.push({ userId, workspaceId });
      return Promise.resolve(true);
    },
  });
  await createPaywallReportHandler(deps)(
    req({ workspace_id: "ws-1", feature: "f", user_id: "spoofed-user" }),
  );
  assertEquals(seen, [{ userId: "real-user", workspaceId: "ws-1" }]);
});

Deno.test("rejects a body missing workspace_id or feature", async () => {
  const res = await createPaywallReportHandler(makeDeps())(req({ feature: "f" }));
  assertEquals(res.status, 400);
});

Deno.test("inserts the hit for a valid member and defaults clicked_upgrade to false", async () => {
  const rows: Array<Record<string, unknown>> = [];
  const deps = makeDeps({
    insertHit: (row) => {
      rows.push(row);
      return Promise.resolve();
    },
  });
  const res = await createPaywallReportHandler(deps)(
    req({ workspace_id: "ws-1", feature: "feature_hub_portal" }),
  );
  assertEquals(res.status, 200);
  assertEquals(rows, [{
    workspace_id: "ws-1",
    user_id: "user-1",
    feature: "feature_hub_portal",
    clicked_upgrade: false,
  }]);
});

Deno.test("passes clicked_upgrade through when set", async () => {
  const rows: Array<Record<string, unknown>> = [];
  const deps = makeDeps({ insertHit: (row) => { rows.push(row); return Promise.resolve(); } });
  await createPaywallReportHandler(deps)(
    req({ workspace_id: "ws-1", feature: "f", clicked_upgrade: true }),
  );
  assertEquals(rows[0].clicked_upgrade, true);
});
