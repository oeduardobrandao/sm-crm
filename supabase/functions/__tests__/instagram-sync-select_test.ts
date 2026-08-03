import { assertEquals } from "https://deno.land/std@0.208.0/assert/mod.ts";
import { contaIdOf, isEligible, selectAccountsToSync } from "../instagram-sync-cron/select.ts";

const WS_OK = "11111111-1111-1111-1111-111111111111";
const WS_NO_FEATURE = "22222222-2222-2222-2222-222222222222";
const WS_INTERNAL = "33333333-3333-3333-3333-333333333333";

function acct(id: string, wsId: string, lastSynced: string | null) {
  return { id, last_synced_at: lastSynced, clientes: { conta_id: wsId } };
}

const defaults = {
  allowedWorkspaces: new Set([WS_OK]),
  internalWorkspaces: new Set([WS_INTERNAL]),
  limit: 25,
};

Deno.test("contaIdOf reads both PostgREST embed shapes", () => {
  assertEquals(contaIdOf({ clientes: { conta_id: WS_OK } }), WS_OK);
  assertEquals(contaIdOf({ clientes: [{ conta_id: WS_OK }] }), WS_OK);
});

Deno.test("selects stalest accounts first", () => {
  const { selected } = selectAccountsToSync(
    [
      acct("recent", WS_OK, "2026-08-03T05:00:00Z"),
      acct("oldest", WS_OK, "2026-07-01T05:00:00Z"),
      acct("middle", WS_OK, "2026-08-01T05:00:00Z"),
    ],
    { ...defaults, allowedWorkspaces: new Set([WS_OK]) },
  );
  assertEquals(selected.map((a) => a.id), ["oldest", "middle", "recent"]);
});

Deno.test("never-synced accounts sort ahead of every synced account", () => {
  const { selected } = selectAccountsToSync(
    [
      acct("synced-long-ago", WS_OK, "2020-01-01T00:00:00Z"),
      acct("never", WS_OK, null),
    ],
    { ...defaults, allowedWorkspaces: new Set([WS_OK]) },
  );
  assertEquals(selected[0].id, "never");
});

Deno.test("caps the batch at the limit and reports the remainder as deferred", () => {
  const accounts = Array.from({ length: 10 }, (_, i) =>
    acct(`a${i}`, WS_OK, `2026-07-${String(i + 1).padStart(2, "0")}T00:00:00Z`));

  const { selected, deferred } = selectAccountsToSync(accounts, {
    ...defaults,
    allowedWorkspaces: new Set([WS_OK]),
    limit: 4,
  });

  assertEquals(selected.length, 4);
  assertEquals(deferred, 6);
  // The four stalest, not an arbitrary four.
  assertEquals(selected.map((a) => a.id), ["a0", "a1", "a2", "a3"]);
});

Deno.test("a truncated batch rotates instead of starving the tail", () => {
  // Round 1 takes the two stalest; those two then carry a fresh last_synced_at,
  // so round 2 must pick up the ones round 1 deferred.
  const accounts = [
    acct("a", WS_OK, "2026-07-01T00:00:00Z"),
    acct("b", WS_OK, "2026-07-02T00:00:00Z"),
    acct("c", WS_OK, "2026-07-03T00:00:00Z"),
    acct("d", WS_OK, "2026-07-04T00:00:00Z"),
  ];
  const opts = { ...defaults, allowedWorkspaces: new Set([WS_OK]), limit: 2 };

  const round1 = selectAccountsToSync(accounts, opts);
  assertEquals(round1.selected.map((a) => a.id), ["a", "b"]);

  const afterRound1 = accounts.map((a) =>
    round1.selected.some((s) => s.id === a.id)
      ? { ...a, last_synced_at: "2026-08-03T00:00:00Z" }
      : a
  );
  const round2 = selectAccountsToSync(afterRound1, opts);
  assertEquals(round2.selected.map((a) => a.id), ["c", "d"]);
});

Deno.test("excludes internal workspaces even when the plan grants the feature", () => {
  const { selected, skippedInternal } = selectAccountsToSync(
    [
      acct("test-account", WS_INTERNAL, null),
      acct("real-account", WS_OK, "2026-08-01T00:00:00Z"),
    ],
    {
      ...defaults,
      // Internal workspace is ALSO entitled — the internal flag must still win.
      allowedWorkspaces: new Set([WS_OK, WS_INTERNAL]),
      internalWorkspaces: new Set([WS_INTERNAL]),
    },
  );

  assertEquals(selected.map((a) => a.id), ["real-account"]);
  assertEquals(skippedInternal, 1);
});

Deno.test("internal accounts do not consume batch slots", () => {
  // The regression this guards: internal accounts are never synced, so their
  // last_synced_at stays null and they sort first forever. If they were counted
  // against the limit they would starve every real account behind them.
  const accounts = [
    acct("internal-1", WS_INTERNAL, null),
    acct("internal-2", WS_INTERNAL, null),
    acct("real", WS_OK, "2026-08-01T00:00:00Z"),
  ];

  const { selected, deferred, skippedInternal } = selectAccountsToSync(accounts, {
    allowedWorkspaces: new Set([WS_OK, WS_INTERNAL]),
    internalWorkspaces: new Set([WS_INTERNAL]),
    limit: 2,
  });

  assertEquals(selected.map((a) => a.id), ["real"]);
  assertEquals(deferred, 0);
  assertEquals(skippedInternal, 2);
});

Deno.test("accounts without feature_auto_sync_cron are counted separately", () => {
  const { selected, skippedNoFeature, skippedInternal } = selectAccountsToSync(
    [
      acct("no-feature", WS_NO_FEATURE, null),
      acct("ok", WS_OK, null),
    ],
    { ...defaults, allowedWorkspaces: new Set([WS_OK]) },
  );

  assertEquals(selected.map((a) => a.id), ["ok"]);
  assertEquals(skippedNoFeature, 1);
  assertEquals(skippedInternal, 0);
});

Deno.test("isEligible agrees with the filter selectAccountsToSync applies", () => {
  const allowed = new Set([WS_OK, WS_INTERNAL]);
  const internal = new Set([WS_INTERNAL]);

  assertEquals(isEligible(acct("a", WS_OK, null), allowed, internal), true);
  assertEquals(isEligible(acct("b", WS_INTERNAL, null), allowed, internal), false);
  assertEquals(isEligible(acct("c", WS_NO_FEATURE, null), allowed, internal), false);

  // The paging loop in index.ts counts eligibility with isEligible and then
  // hands the accumulated rows to selectAccountsToSync. If the two disagreed,
  // the loop would stop early on a batch that selection then rejects.
  const rows = [acct("a", WS_OK, null), acct("b", WS_INTERNAL, null), acct("c", WS_NO_FEATURE, null)];
  const { selected } = selectAccountsToSync(rows, {
    allowedWorkspaces: allowed,
    internalWorkspaces: internal,
    limit: 25,
  });
  assertEquals(
    selected.map((r) => r.id),
    rows.filter((r) => isEligible(r, allowed, internal)).map((r) => r.id),
  );
});

Deno.test("stale ineligible accounts at the head of the ordering do not starve eligible ones", () => {
  // The Codex finding, as data. Ineligible accounts never sync, so their
  // last_synced_at stays null and they sort FIRST. Here 500 of them precede the
  // only eligible account. Selection must still reach it, which is what the
  // paging loop in index.ts guarantees by scanning past them.
  const ineligible = Array.from({ length: 500 }, (_, i) => acct(`free-${i}`, WS_NO_FEATURE, null));
  const candidates = [...ineligible, acct("paying", WS_OK, "2026-07-01T00:00:00Z")];

  const { selected, skippedNoFeature } = selectAccountsToSync(candidates, {
    ...defaults,
    allowedWorkspaces: new Set([WS_OK]),
    limit: 25,
  });

  assertEquals(selected.map((a) => a.id), ["paying"]);
  assertEquals(skippedNoFeature, 500);
});

Deno.test("empty candidate list is a no-op", () => {
  const result = selectAccountsToSync([], { ...defaults, allowedWorkspaces: new Set([WS_OK]) });
  assertEquals(result.selected, []);
  assertEquals(result.deferred, 0);
});
