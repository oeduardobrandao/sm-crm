import { assert, assertEquals } from "./assert.ts";
import {
  buildMetricFields,
  fetchPostInsights,
  parseBioLinkClicks,
} from "../_shared/instagram-metrics.ts";

const ok = (data: unknown) => Promise.resolve({ json: () => Promise.resolve({ data }) } as Response);
const errBody = (msg: string, code = 100) =>
  Promise.resolve({ json: () => Promise.resolve({ error: { message: msg, code } }) } as Response);

const CORE = [
  { name: "reach", values: [{ value: 100 }] },
  { name: "views", values: [{ value: 200 }] },
  { name: "saved", values: [{ value: 5 }] },
  { name: "shares", values: [{ value: 3 }] },
];
const ACTIONS = [
  { name: "reposts", values: [{ value: 335 }] },
  { name: "follows", values: [{ value: 75 }] },
  { name: "profile_visits", values: [{ value: 328 }] },
];
const BIO = [{
  name: "profile_activity",
  total_value: {
    value: 3,
    breakdowns: [{
      dimension_keys: ["action_type"],
      results: [
        { dimension_values: ["BIO_LINK_CLICKED"], value: 1 },
        { dimension_values: ["email"], value: 2 },
      ],
    }],
  },
}];

const isCore = (u: string) => u.includes("metric=reach");
const isActions = (u: string) => u.includes("metric=reposts") || u.includes("metric=follows");
const isBio = (u: string) => u.includes("metric=profile_activity");

/** Routes each of the three per-post requests to its own handler. */
function router(h: {
  core?: (u: string) => Promise<Response>;
  actions?: (u: string) => Promise<Response>;
  bio?: (u: string) => Promise<Response>;
}) {
  const urls: string[] = [];
  const inits: (RequestInit | undefined)[] = [];
  const fetchFn = ((u: string, init?: RequestInit) => {
    urls.push(u);
    inits.push(init);
    if (isCore(u)) return (h.core ?? (() => ok(CORE)))(u);
    if (isActions(u)) return (h.actions ?? (() => ok(ACTIONS)))(u);
    if (isBio(u)) return (h.bio ?? (() => ok(BIO)))(u);
    throw new Error(`unexpected url ${u}`);
  }) as typeof fetch;
  return { fetchFn, urls, inits };
}

Deno.test("fetchPostInsights: parses all three calls", async () => {
  const { fetchFn } = router({});
  const r = await fetchPostInsights(fetchFn, "m1", "tok");
  assertEquals(r.values, {
    reach: 100, impressions: 200, saved: 5, shares: 3,
    reposts: 335, follows: 75, profile_visits: 328, bio_link_clicks: 1,
  });
  for (const t of ["reach", "impressions", "saved", "shares", "reposts", "follows", "profile_visits", "bio_link_clicks"]) {
    assert(r.returned.has(t), t);
  }
});

Deno.test("fetchPostInsights: every request carries an abort signal", async () => {
  const { fetchFn, inits } = router({});
  await fetchPostInsights(fetchFn, "m1", "tok");
  assertEquals(inits.length, 3);
  for (const init of inits) assert(init?.signal instanceof AbortSignal);
});

Deno.test("fetchPostInsights: shares rejection -> core retried without shares", async () => {
  let coreCalls = 0;
  const { fetchFn } = router({
    core: (u) => {
      coreCalls++;
      if (u.includes("shares")) return errBody("shares is not supported for this media product type");
      return ok(CORE.filter((m) => m.name !== "shares"));
    },
  });
  const r = await fetchPostInsights(fetchFn, "m2", "tok");
  assertEquals(coreCalls, 2);
  assertEquals(r.values.reach, 100);
  assert(!r.returned.has("shares"));
  assert(r.returned.has("reposts"));
});

Deno.test("fetchPostInsights: actions and bio use the pinned Graph version; core stays unversioned", async () => {
  const { fetchFn, urls } = router({});
  await fetchPostInsights(fetchFn, "m1", "tok");
  for (const u of urls.filter((u) => isActions(u) || isBio(u))) {
    assert(u.startsWith("https://graph.instagram.com/v25.0/m1/insights?"), u);
  }
  const core = urls.find(isCore)!;
  assert(core.startsWith("https://graph.instagram.com/m1/insights?"), core);
});

Deno.test("fetchPostInsights: rejected reposts doesn't take follows/profile_visits down", async () => {
  const actionUrls: string[] = [];
  const { fetchFn } = router({
    actions: (u) => {
      actionUrls.push(u);
      if (u.includes("reposts")) return errBody("(#100) metric[0] must be one of the following values", 100);
      return ok(ACTIONS.filter((m) => m.name !== "reposts"));
    },
  });
  const r = await fetchPostInsights(fetchFn, "m3", "tok");
  assertEquals(actionUrls.length, 3); // combined, then follows,profile_visits + reposts
  assert(actionUrls.some((u) => u.includes("metric=follows,profile_visits&")));
  assert(actionUrls.some((u) => u.includes("metric=reposts&")));
  assertEquals(r.values.follows, 75);
  assertEquals(r.values.profile_visits, 328);
  assert(!r.returned.has("reposts"));
  assertEquals(r.values.reach, 100); // core untouched
});

Deno.test("fetchPostInsights: unsupported follows/profile_visits -> reposts still returned", async () => {
  const { fetchFn } = router({
    actions: (u) => {
      if (u.includes("follows")) return errBody("metric follows not supported for REELS", 100);
      return ok([{ name: "reposts", values: [{ value: 12 }] }]);
    },
  });
  const r = await fetchPostInsights(fetchFn, "m3b", "tok");
  assertEquals(r.values.reposts, 12);
  assert(!r.returned.has("follows"));
  assert(!r.returned.has("profile_visits"));
});

Deno.test("fetchPostInsights: transient/auth action errors are not retried", async () => {
  for (const code of [1, 2, 4, 9, 17, 32, 613, 190, 80002]) {
    let actionCalls = 0;
    const { fetchFn } = router({
      actions: () => {
        actionCalls++;
        return errBody("Application request limit reached", code);
      },
    });
    const r = await fetchPostInsights(fetchFn, "m4", "tok");
    assertEquals(actionCalls, 1, `code ${code}`);
    assert(!r.returned.has("reposts"));
    assertEquals(r.values.reach, 100);
  }
});

Deno.test("fetchPostInsights: actions error without a numeric code -> split retry", async () => {
  const actionUrls: string[] = [];
  const { fetchFn } = router({
    actions: (u) => {
      actionUrls.push(u);
      if (u.includes("follows")) {
        return Promise.resolve({ json: () => Promise.resolve({ error: { message: "x" } }) } as Response);
      }
      return ok([{ name: "reposts", values: [{ value: 12 }] }]);
    },
  });
  const r = await fetchPostInsights(fetchFn, "m6", "tok");
  assertEquals(actionUrls.length, 3);
  assertEquals(r.values.reposts, 12);
  assert(!r.returned.has("follows"));
  assertEquals(r.values.reach, 100);
});

Deno.test("fetchPostInsights: a throwing actions/bio call never removes core values", async () => {
  const { fetchFn } = router({
    actions: () => Promise.reject(new DOMException("timed out", "TimeoutError")),
    bio: () => Promise.reject(new Error("network")),
  });
  const r = await fetchPostInsights(fetchFn, "m5", "tok");
  assertEquals(r.values, { reach: 100, impressions: 200, saved: 5, shares: 3 });
  assert(!r.returned.has("bio_link_clicks"));
});

Deno.test("fetchPostInsights: a throwing core call never removes action values", async () => {
  const { fetchFn } = router({ core: () => Promise.reject(new Error("network")) });
  const r = await fetchPostInsights(fetchFn, "m6", "tok");
  assert(!r.returned.has("reach"));
  assertEquals(r.values.follows, 75);
  assertEquals(r.values.bio_link_clicks, 1);
});

Deno.test("fetchPostInsights: action metrics also accept total_value.value", async () => {
  const { fetchFn } = router({
    actions: () => ok([{ name: "follows", total_value: { value: 9 } }]),
  });
  const r = await fetchPostInsights(fetchFn, "m7", "tok");
  assertEquals(r.values.follows, 9);
});

Deno.test("parseBioLinkClicks: case-insensitive match, 0 when absent, undefined when malformed", () => {
  assertEquals(parseBioLinkClicks(BIO), 1);
  const lower = [{ name: "profile_activity", total_value: { value: 4, breakdowns: [{ results: [{ dimension_values: ["bio_link_clicked"], value: 4 }] }] } }];
  assertEquals(parseBioLinkClicks(lower), 4);
  const none = [{ name: "profile_activity", total_value: { value: 2, breakdowns: [{ results: [{ dimension_values: ["email"], value: 2 }] }] } }];
  assertEquals(parseBioLinkClicks(none), 0);
  const noBreakdowns = [{ name: "profile_activity", total_value: { value: 0 } }];
  assertEquals(parseBioLinkClicks(noBreakdowns), 0);
  // zero-activity posts can come back with only `values`
  assertEquals(parseBioLinkClicks([{ name: "profile_activity", values: [{ value: 0 }] }]), 0);
  assertEquals(parseBioLinkClicks([{ name: "profile_activity", values: [{ value: 3 }] }]), undefined);
  const breakdownMissingButActivityExists = [{ name: "profile_activity", total_value: { value: 5 } }];
  assertEquals(parseBioLinkClicks(breakdownMissingButActivityExists), undefined);
  const nonNumberValue = [{ name: "profile_activity", total_value: { value: 1, breakdowns: [{ results: [{ dimension_values: ["BIO_LINK_CLICKED"], value: "1" }] }] } }];
  assertEquals(parseBioLinkClicks(nonNumberValue), undefined);
  assertEquals(parseBioLinkClicks(undefined), undefined);
  assertEquals(parseBioLinkClicks([]), undefined);
  assertEquals(parseBioLinkClicks([{ name: "profile_activity" }]), undefined);
});

Deno.test("fetchPostInsights: bio error body -> absent", async () => {
  const { fetchFn } = router({ bio: () => errBody("breakdown not supported") });
  const r = await fetchPostInsights(fetchFn, "m8", "tok");
  assert(!r.returned.has("bio_link_clicks"));
  assertEquals(r.values.follows, 75);
});

Deno.test("buildMetricFields: preserve previous on conflict, 0 on new row, mark unavailable", () => {
  const upd = buildMetricFields(
    { reach: 9, impressions: 90, saved: 2, shares: 7, likes: 4, comments: 1 },
    { values: { reach: 11, impressions: 110, saved: 3 }, returned: new Set(["reach", "impressions", "saved"]) },
    { like_count: 5, comments_count: 1 },
  );
  assertEquals(upd.reach, 11);
  assertEquals(upd.shares, 7);
  assertEquals(upd.likes, 5);
  assert(upd.unavailable_metrics.includes("shares"));
  assert(!upd.unavailable_metrics.includes("reach"));

  const ins = buildMetricFields(
    null,
    { values: { reach: 1, impressions: 2, saved: 0 }, returned: new Set(["reach", "impressions", "saved"]) },
    { like_count: 0, comments_count: 0 },
  );
  assertEquals(ins.shares, 0);
  assert(ins.unavailable_metrics.includes("shares"));
  assertEquals(ins.likes, 0);
  assert(!ins.unavailable_metrics.includes("likes"));
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

Deno.test("buildMetricFields: action metrics fresh, preserved, or null (never 0)", () => {
  const fresh = buildMetricFields(
    null,
    {
      values: { reach: 1, impressions: 1, saved: 0, shares: 0, reposts: 0, follows: 75, profile_visits: 328, bio_link_clicks: 1 },
      returned: new Set(["reach", "impressions", "saved", "shares", "reposts", "follows", "profile_visits", "bio_link_clicks"]),
    },
    { like_count: 1, comments_count: 1 },
  );
  assertEquals(fresh.reposts, 0); // a real 0 is kept
  assertEquals(fresh.follows, 75);
  assertEquals(fresh.profile_visits, 328);
  assertEquals(fresh.bio_link_clicks, 1);
  assertEquals(fresh.unavailable_metrics, []);

  const preserved = buildMetricFields(
    { reach: 1, impressions: 1, saved: 0, shares: 0, likes: 1, comments: 1, reposts: 5, follows: 7, profile_visits: 9, bio_link_clicks: null },
    { values: { reach: 2, impressions: 2, saved: 0, shares: 0 }, returned: new Set(["reach", "impressions", "saved", "shares"]) },
    { like_count: 1, comments_count: 1 },
  );
  assertEquals(preserved.reposts, 5);
  assertEquals(preserved.follows, 7);
  assertEquals(preserved.profile_visits, 9);
  assertEquals(preserved.bio_link_clicks, null);
  for (const t of ["reposts", "follows", "profile_visits", "bio_link_clicks"]) {
    assert(preserved.unavailable_metrics.includes(t), t);
  }

  const brandNew = buildMetricFields(
    null,
    { values: { reach: 1, impressions: 1, saved: 0, shares: 0 }, returned: new Set(["reach", "impressions", "saved", "shares"]) },
    { like_count: 1, comments_count: 1 },
  );
  assertEquals(brandNew.reposts, null);
  assertEquals(brandNew.follows, null);
  assertEquals(brandNew.profile_visits, null);
  assertEquals(brandNew.bio_link_clicks, null);
});
