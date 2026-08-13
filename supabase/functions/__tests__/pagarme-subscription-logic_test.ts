import { assert, assertEquals } from "./assert.ts";
import { buildCancelColumns, parseSubscriptionBody } from "../pagarme-subscription/logic.ts";

const NOW = new Date("2026-08-13T12:00:00.000Z");
const NOW_ISO = NOW.toISOString();

// ─── parseSubscriptionBody ─────────────────────────────────────────────────

Deno.test("parseSubscriptionBody: non-object bodies are a 400, never a crash", () => {
  for (const body of [null, undefined, "action=cancel", 42, ["cancel"], true]) {
    const r = parseSubscriptionBody(body);
    assertEquals(r.ok, false, String(body));
    if (!r.ok) {
      assertEquals(r.status, 400, String(body));
      assertEquals(r.code, "invalid_request", String(body));
    }
  }
});

Deno.test("parseSubscriptionBody: unknown action is invalid_request", () => {
  const r = parseSubscriptionBody({ action: "delete_everything" });
  assertEquals(r.ok, false);
  if (!r.ok) {
    assertEquals(r.error, "Ação inválida.");
    assertEquals(r.code, "invalid_request");
  }
});

Deno.test("parseSubscriptionBody: cancel is accepted with no other fields required", () => {
  const r = parseSubscriptionBody({ action: "cancel" });
  assert(r.ok);
  assertEquals(r.value, { action: "cancel" });
});

Deno.test("parseSubscriptionBody: cancel ignores extraneous fields", () => {
  const r = parseSubscriptionBody({ action: "cancel", card_token: "should be ignored" });
  assert(r.ok);
  assertEquals(r.value, { action: "cancel" });
});

Deno.test("parseSubscriptionBody: update_card missing card_token fails", () => {
  const r = parseSubscriptionBody({
    action: "update_card",
    billing_address: { cep: "01310100", line_1: "Av. Paulista, 1000", city: "São Paulo", state: "SP" },
  });
  assertEquals(r.ok, false);
  if (!r.ok) assertEquals(r.error, "Dados do cartão inválidos.");
});

Deno.test("parseSubscriptionBody: update_card with blank/non-string card_token fails", () => {
  for (const cardToken of ["  ", 42, undefined, null]) {
    const r = parseSubscriptionBody({
      action: "update_card",
      card_token: cardToken,
      billing_address: { cep: "01310100", line_1: "Av. Paulista, 1000", city: "São Paulo", state: "SP" },
    });
    assertEquals(r.ok, false, String(cardToken));
  }
});

Deno.test("parseSubscriptionBody: update_card rejects malformed billing addresses", () => {
  const validAddr = { cep: "01310100", line_1: "Av. Paulista, 1000", city: "São Paulo", state: "SP" };
  const cases: Array<[Record<string, unknown>, string]> = [
    [{ ...validAddr, cep: "0131010" }, "short cep"],
    [{ ...validAddr, cep: "abcdefgh" }, "non-numeric cep"],
    [{ ...validAddr, line_1: "  " }, "blank line_1"],
    [{ ...validAddr, city: "" }, "blank city"],
    [{ ...validAddr, state: "S1" }, "bad state"],
    [{ ...validAddr, state: "SAO" }, "3-letter state"],
  ];
  for (const [addr, label] of cases) {
    const r = parseSubscriptionBody({ action: "update_card", card_token: "tok_1", billing_address: addr });
    assertEquals(r.ok, false, label);
    if (!r.ok) assertEquals(r.error, "Endereço de cobrança inválido.", label);
  }
});

Deno.test("parseSubscriptionBody: update_card missing billing_address entirely fails", () => {
  const r = parseSubscriptionBody({ action: "update_card", card_token: "tok_1" });
  assertEquals(r.ok, false);
});

Deno.test("parseSubscriptionBody: happy update_card normalizes masked/dirty input", () => {
  const r = parseSubscriptionBody({
    action: "update_card",
    card_token: "  tok_1  ",
    billing_address: {
      cep: "01310-100",
      line_1: "  Av. Paulista, 1000  ",
      city: "  São Paulo  ",
      state: "sp",
    },
  });
  assert(r.ok);
  assertEquals(r.value, {
    action: "update_card",
    cardToken: "tok_1",
    billingAddress: { cep: "01310100", line1: "Av. Paulista, 1000", city: "São Paulo", state: "SP" },
  });
});

// ─── buildCancelColumns ─────────────────────────────────────────────────────

Deno.test("buildCancelColumns: active + stored period end -> paid-through, current_period_end NOT in columns", () => {
  const r = buildCancelColumns({
    observedStatus: "active",
    storedPeriodEnd: "2027-01-01T00:00:00.000Z",
    remotePeriodEnd: null,
    nowIso: NOW_ISO,
  });
  assertEquals(r.columns, {
    status: "canceled",
    cancel_at_period_end: true,
    updated_at: NOW_ISO,
  });
  assert(!("current_period_end" in r.columns), "current_period_end must not be in the payload");
  assertEquals(r.immediateDowngrade, false);
  assertEquals(r.accessUntil, "2027-01-01T00:00:00.000Z");
});

Deno.test("buildCancelColumns: active + null stored + remote end -> paid-through, FILLS current_period_end", () => {
  const r = buildCancelColumns({
    observedStatus: "active",
    storedPeriodEnd: null,
    remotePeriodEnd: "2027-02-01T00:00:00.000Z",
    nowIso: NOW_ISO,
  });
  assertEquals(r.columns, {
    status: "canceled",
    cancel_at_period_end: true,
    updated_at: NOW_ISO,
    current_period_end: "2027-02-01T00:00:00.000Z",
  });
  assertEquals(r.immediateDowngrade, false);
  assertEquals(r.accessUntil, "2027-02-01T00:00:00.000Z");
});

Deno.test("buildCancelColumns: active + null stored + null remote -> immediate downgrade", () => {
  const r = buildCancelColumns({
    observedStatus: "active",
    storedPeriodEnd: null,
    remotePeriodEnd: null,
    nowIso: NOW_ISO,
  });
  assertEquals(r.columns, {
    status: "canceled",
    cancel_at_period_end: false,
    updated_at: NOW_ISO,
  });
  assert(!("current_period_end" in r.columns));
  assertEquals(r.immediateDowngrade, true);
  assertEquals(r.accessUntil, null);
});

Deno.test("buildCancelColumns: stored wins over remote when both present, and remote is never written", () => {
  const r = buildCancelColumns({
    observedStatus: "active",
    storedPeriodEnd: "2027-01-01T00:00:00.000Z",
    remotePeriodEnd: "2027-06-01T00:00:00.000Z",
    nowIso: NOW_ISO,
  });
  assertEquals(r.accessUntil, "2027-01-01T00:00:00.000Z");
  assert(!("current_period_end" in r.columns), "a stored value must never be overwritten by the remote one");
});

Deno.test("buildCancelColumns: active + PAST stored period end -> no remaining paid window, immediate downgrade", () => {
  const r = buildCancelColumns({
    observedStatus: "active",
    storedPeriodEnd: "2026-01-01T00:00:00.000Z", // before NOW (2026-08-13)
    remotePeriodEnd: null,
    nowIso: NOW_ISO,
  });
  assertEquals(r.columns, {
    status: "canceled",
    cancel_at_period_end: false,
    updated_at: NOW_ISO,
  });
  assert(!("current_period_end" in r.columns));
  assertEquals(r.immediateDowngrade, true);
  assertEquals(r.accessUntil, null, "a past date must never be returned as access_until");
});

Deno.test("buildCancelColumns: active + PAST remote period end (null stored) -> no remaining paid window, immediate downgrade", () => {
  const r = buildCancelColumns({
    observedStatus: "active",
    storedPeriodEnd: null,
    remotePeriodEnd: "2026-01-01T00:00:00.000Z", // before NOW
    nowIso: NOW_ISO,
  });
  assertEquals(r.immediateDowngrade, true);
  assertEquals(r.accessUntil, null);
  assert(!("current_period_end" in r.columns), "an elapsed remote end must not be filled in either");
});

Deno.test("buildCancelColumns: active + unparseable stored period end string -> treated as no provable window, immediate downgrade", () => {
  const r = buildCancelColumns({
    observedStatus: "active",
    storedPeriodEnd: "not-a-date",
    remotePeriodEnd: null,
    nowIso: NOW_ISO,
  });
  assertEquals(r.immediateDowngrade, true);
  assertEquals(r.accessUntil, null);
  assert(!("current_period_end" in r.columns));
});

Deno.test("buildCancelColumns: trialing -> immediate downgrade, cancel_at_period_end false, no current_period_end", () => {
  const r = buildCancelColumns({
    observedStatus: "trialing",
    storedPeriodEnd: null,
    remotePeriodEnd: null,
    nowIso: NOW_ISO,
  });
  assertEquals(r.columns, {
    status: "canceled",
    cancel_at_period_end: false,
    updated_at: NOW_ISO,
  });
  assertEquals(r.immediateDowngrade, true);
  assertEquals(r.accessUntil, null);
});

Deno.test("buildCancelColumns: past_due -> immediate downgrade, cancel_at_period_end false, no current_period_end", () => {
  const r = buildCancelColumns({
    observedStatus: "past_due",
    storedPeriodEnd: "2027-01-01T00:00:00.000Z", // even a stored end does not matter off "active"
    remotePeriodEnd: null,
    nowIso: NOW_ISO,
  });
  assertEquals(r.columns, {
    status: "canceled",
    cancel_at_period_end: false,
    updated_at: NOW_ISO,
  });
  assert(!("current_period_end" in r.columns));
  assertEquals(r.immediateDowngrade, true);
  assertEquals(r.accessUntil, null);
});
