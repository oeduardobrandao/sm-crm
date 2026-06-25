import { assert, assertEquals } from "./assert.ts";
import { buildMetricFields, fetchPostInsights } from "../_shared/instagram-metrics.ts";

const ok = (data: unknown) => Promise.resolve({ json: () => Promise.resolve({ data }) } as Response);
const errBody = (msg: string) =>
  Promise.resolve({ json: () => Promise.resolve({ error: { message: msg } }) } as Response);

Deno.test("fetchPostInsights: parses returned metrics, marks the rest absent", async () => {
  const fetchFn = ((_u: string) => ok([
    { name: "reach", values: [{ value: 100 }] },
    { name: "views", values: [{ value: 200 }] },
    { name: "saved", values: [{ value: 5 }] },
    { name: "shares", values: [{ value: 3 }] },
  ])) as typeof fetch;
  const r = await fetchPostInsights(fetchFn, "m1", "tok");
  assertEquals(r.values, { reach: 100, impressions: 200, saved: 5, shares: 3 });
  assert(r.returned.has("shares"));
});

Deno.test("fetchPostInsights: shares rejection -> retry without shares, only shares absent", async () => {
  let calls = 0;
  const fetchFn = ((url: string) => {
    calls++;
    if (url.includes("shares")) return errBody("shares is not supported for this media product type");
    return ok([
      { name: "reach", values: [{ value: 10 }] },
      { name: "views", values: [{ value: 20 }] },
      { name: "saved", values: [{ value: 1 }] },
    ]);
  }) as typeof fetch;
  const r = await fetchPostInsights(fetchFn, "m2", "tok");
  assertEquals(calls, 2);
  assertEquals(r.values.reach, 10);
  assertEquals(r.values.impressions, 20);
  assert(!r.returned.has("shares"));
  assert(r.returned.has("reach"));
});

Deno.test("buildMetricFields: preserve previous on conflict, 0 on new row, mark unavailable", () => {
  // existing row, shares not returned this sync -> preserve previous 7, mark unavailable
  const upd = buildMetricFields(
    { reach: 9, impressions: 90, saved: 2, shares: 7, likes: 4, comments: 1 },
    { values: { reach: 11, impressions: 110, saved: 3 }, returned: new Set(["reach", "impressions", "saved"]) },
    { like_count: 5, comments_count: 1 },
  );
  assertEquals(upd.reach, 11);
  assertEquals(upd.shares, 7);                 // preserved, not 0
  assertEquals(upd.likes, 5);
  assert(upd.unavailable_metrics.includes("shares"));
  assert(!upd.unavailable_metrics.includes("reach"));

  // brand-new row (no existing), shares unavailable -> 0 + marked
  const ins = buildMetricFields(
    null,
    { values: { reach: 1, impressions: 2, saved: 0 }, returned: new Set(["reach", "impressions", "saved"]) },
    { like_count: 0, comments_count: 0 },
  );
  assertEquals(ins.shares, 0);
  assert(ins.unavailable_metrics.includes("shares"));
  assertEquals(ins.likes, 0);
  assert(!ins.unavailable_metrics.includes("likes"));   // like_count present (0) => available
});

Deno.test("buildMetricFields: missing media-node likes/comments are marked unavailable", () => {
  const r = buildMetricFields(
    null,
    { values: { reach: 1, impressions: 2, saved: 0, shares: 0 }, returned: new Set(["reach", "impressions", "saved", "shares"]) },
    {},
  );
  assert(r.unavailable_metrics.includes("likes"));
  assert(r.unavailable_metrics.includes("comments"));
});
