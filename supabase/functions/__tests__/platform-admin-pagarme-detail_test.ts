import { assertEquals } from "./assert.ts";
import {
  buildPagarmeLive,
  pagarmeDashboardUrl,
  periodDiffers,
  statusDiffers,
  type PagarmeRemoteSubscription,
} from "../platform-admin/pagarme-detail.ts";

const BASE = "https://dash.pagar.me/merch_pv13W5kwigIKJX8b/acc_4AYdz4NIRHgey7Nk";

// ─── pagarmeDashboardUrl ────────────────────────────────────────────────────

Deno.test("pagarmeDashboardUrl: base + /subscriptions/{id}/info", () => {
  assertEquals(
    pagarmeDashboardUrl(BASE, "sub_nqONBbf4quM0NmbP"),
    `${BASE}/subscriptions/sub_nqONBbf4quM0NmbP/info`,
  );
});

Deno.test("pagarmeDashboardUrl: trailing slashes and whitespace on the base are trimmed", () => {
  assertEquals(pagarmeDashboardUrl(`  ${BASE}//  `, "sub_1"), `${BASE}/subscriptions/sub_1/info`);
});

Deno.test("pagarmeDashboardUrl: null when the base is unset, empty or not https", () => {
  assertEquals(pagarmeDashboardUrl(null, "sub_1"), null);
  assertEquals(pagarmeDashboardUrl(undefined, "sub_1"), null);
  assertEquals(pagarmeDashboardUrl("", "sub_1"), null);
  assertEquals(pagarmeDashboardUrl("http://dash.pagar.me/merch_x/acc_y", "sub_1"), null);
});

Deno.test("pagarmeDashboardUrl: null for an empty id; special characters are encoded", () => {
  assertEquals(pagarmeDashboardUrl(BASE, ""), null);
  assertEquals(pagarmeDashboardUrl(BASE, "sub/1?x"), `${BASE}/subscriptions/sub%2F1%3Fx/info`);
});

// ─── statusDiffers ──────────────────────────────────────────────────────────

Deno.test("statusDiffers: same status is not drift", () => {
  assertEquals(statusDiffers("active", "active"), false);
  assertEquals(statusDiffers("trialing", "trialing"), false);
});

Deno.test("statusDiffers: different status is drift, including a null mirror", () => {
  assertEquals(statusDiffers("active", "canceled"), true);
  assertEquals(statusDiffers(null, "active"), true);
});

Deno.test("statusDiffers: past_due mirror vs active remote is NOT drift (dunning is local truth)", () => {
  assertEquals(statusDiffers("past_due", "active"), false);
});

Deno.test("statusDiffers: unknown remote status (null) never flags drift", () => {
  assertEquals(statusDiffers("active", null), false);
});

// ─── periodDiffers ──────────────────────────────────────────────────────────

Deno.test("periodDiffers: both null is not drift", () => {
  assertEquals(periodDiffers(null, null), false);
});

Deno.test("periodDiffers: null remote period never flags drift (canceled keeps the retained value)", () => {
  assertEquals(periodDiffers("2026-10-03T00:00:00Z", null), false);
});

Deno.test("periodDiffers: mirror null but remote set is drift", () => {
  assertEquals(periodDiffers(null, "2026-10-03T00:00:00Z"), true);
});

Deno.test("periodDiffers: within 24h is not drift (absorbs timezone skew)", () => {
  // "2026-10-03" parses as UTC midnight; the mirror is 3h later (midnight BRT).
  assertEquals(periodDiffers("2026-10-03T03:00:00Z", "2026-10-03"), false);
  assertEquals(periodDiffers("2026-10-03T00:00:00.000Z", "2026-10-03T23:59:59Z"), false);
});

Deno.test("periodDiffers: more than 24h apart is drift", () => {
  assertEquals(periodDiffers("2026-10-03T00:00:00Z", "2027-10-03T00:00:00Z"), true);
  assertEquals(periodDiffers("2026-10-03T00:00:00Z", "2026-10-04T00:00:01Z"), true);
});

Deno.test("periodDiffers: unparsable value counts as different", () => {
  assertEquals(periodDiffers("not-a-date", "2026-10-03T00:00:00Z"), true);
  assertEquals(periodDiffers("2026-10-03T00:00:00Z", "nope"), true);
});

// ─── buildPagarmeLive ───────────────────────────────────────────────────────

const TRIAL_MIRROR = { status: "trialing", current_period_end: "2026-10-03T00:00:00.000Z" };

function remote(over: Partial<PagarmeRemoteSubscription> = {}): PagarmeRemoteSubscription {
  return {
    id: "sub_1",
    status: "future",
    start_at: "2026-10-03T00:00:00Z",
    card: { brand: "visa", last_four_digits: "4242", exp_month: 12, exp_year: 2028 },
    ...over,
  };
}

Deno.test("buildPagarmeLive: future → trialing, next charge = start_at, card mapped, no drift", () => {
  const live = buildPagarmeLive(remote(), TRIAL_MIRROR);
  assertEquals(live.status, "trialing");
  assertEquals(live.remote_status, "future");
  assertEquals(live.next_billing_at, "2026-10-03T00:00:00Z");
  assertEquals(live.start_at, "2026-10-03T00:00:00Z");
  assertEquals(live.canceled_at, null);
  assertEquals(live.card, { brand: "visa", last4: "4242", exp_month: 12, exp_year: 2028 });
  assertEquals(live.drift, null);
});

Deno.test("buildPagarmeLive: active prefers next_billing_at, falls back to current_cycle.billing_at", () => {
  const mirror = { status: "active", current_period_end: "2027-10-03T00:00:00Z" };
  const cycle = { end_at: "2027-10-03T00:00:00Z", billing_at: "2027-10-02T00:00:00Z" };
  const a = buildPagarmeLive(
    remote({ status: "active", next_billing_at: "2027-10-03T00:00:00Z", current_cycle: cycle }),
    mirror,
  );
  assertEquals(a.next_billing_at, "2027-10-03T00:00:00Z");
  const b = buildPagarmeLive(
    remote({ status: "active", next_billing_at: null, current_cycle: cycle }),
    mirror,
  );
  assertEquals(b.next_billing_at, "2027-10-02T00:00:00Z");
  assertEquals(b.drift, null);

  // Only the sandbox-observed cycle shape ({ end_at }): the next charge is the cycle boundary.
  const c = buildPagarmeLive(
    remote({ status: "active", next_billing_at: null, current_cycle: { end_at: "2027-10-03T00:00:00Z" } }),
    mirror,
  );
  assertEquals(c.next_billing_at, "2027-10-03T00:00:00Z");
  assertEquals(c.drift, null);
});

Deno.test("buildPagarmeLive: canceled and failed → canceled, next charge null, canceled_at kept", () => {
  const mirror = { status: "canceled", current_period_end: "2027-10-03T00:00:00Z" };
  const c = buildPagarmeLive(
    remote({ status: "canceled", start_at: null, canceled_at: "2026-09-05T10:00:00Z" }),
    mirror,
  );
  assertEquals(c.status, "canceled");
  assertEquals(c.next_billing_at, null);
  assertEquals(c.canceled_at, "2026-09-05T10:00:00Z");
  assertEquals(c.drift, null); // period null on the remote side never flags
  const f = buildPagarmeLive(remote({ status: "failed" }), mirror);
  assertEquals(f.status, "canceled");
});

Deno.test("buildPagarmeLive: unknown remote status → status null, raw value exposed, no drift", () => {
  const live = buildPagarmeLive(remote({ status: "paused" }), TRIAL_MIRROR);
  assertEquals(live.status, null);
  assertEquals(live.remote_status, "paused");
  assertEquals(live.next_billing_at, null);
  assertEquals(live.drift, null);
});

Deno.test("buildPagarmeLive: missing card → null; partial card keeps what exists", () => {
  assertEquals(buildPagarmeLive(remote({ card: null }), TRIAL_MIRROR).card, null);
  assertEquals(buildPagarmeLive(remote({ card: undefined }), TRIAL_MIRROR).card, null);
  assertEquals(
    buildPagarmeLive(remote({ card: { brand: "mastercard" } }), TRIAL_MIRROR).card,
    { brand: "mastercard", last4: null, exp_month: null, exp_year: null },
  );
});

Deno.test("buildPagarmeLive: documented subscription card shape (masked_number, no brand/last4) still yields last4", () => {
  // Official "criar assinatura" example: card has holder_name, masked_number, exp_month,
  // exp_year, status; no brand, no last_four_digits.
  const live = buildPagarmeLive(
    remote({ card: { masked_number: "424242******4242", exp_month: 12, exp_year: 2028 } }),
    TRIAL_MIRROR,
  );
  assertEquals(live.card, { brand: null, last4: "4242", exp_month: 12, exp_year: 2028 });
});

Deno.test("buildPagarmeLive: last_four_digits wins over masked_number; a short or non-numeric mask gives null", () => {
  const a = buildPagarmeLive(
    remote({ card: { last_four_digits: "1111", masked_number: "424242******4242" } }),
    TRIAL_MIRROR,
  );
  assertEquals(a.card?.last4, "1111");
  const b = buildPagarmeLive(remote({ card: { masked_number: "****" } }), TRIAL_MIRROR);
  assertEquals(b.card?.last4, null);
  const c = buildPagarmeLive(remote({ card: { masked_number: "42" } }), TRIAL_MIRROR);
  assertEquals(c.card?.last4, null);
});

Deno.test("buildPagarmeLive: status drift is reported with both sides", () => {
  const live = buildPagarmeLive(
    remote({ status: "canceled", start_at: null, canceled_at: "2026-09-05T10:00:00Z" }),
    { status: "active", current_period_end: "2027-10-03T00:00:00Z" },
  );
  assertEquals(live.drift, { status: { mirror: "active", live: "canceled" }, period: null });
});

Deno.test("buildPagarmeLive: period drift is reported with both sides", () => {
  const live = buildPagarmeLive(
    remote({
      status: "active",
      next_billing_at: "2027-10-03T00:00:00Z",
      current_cycle: { end_at: "2027-10-03T00:00:00Z" },
    }),
    { status: "active", current_period_end: "2026-10-03T00:00:00Z" },
  );
  assertEquals(live.drift, {
    status: null,
    period: { mirror: "2026-10-03T00:00:00Z", live: "2027-10-03T00:00:00Z" },
  });
});

Deno.test("buildPagarmeLive: past_due mirror with active remote reports no status drift", () => {
  const live = buildPagarmeLive(
    remote({ status: "active", next_billing_at: "2027-10-03T00:00:00Z" }),
    { status: "past_due", current_period_end: "2027-10-03T00:00:00Z" },
  );
  assertEquals(live.drift, null);
});
