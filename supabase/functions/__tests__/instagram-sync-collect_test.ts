import { assertEquals } from "https://deno.land/std@0.208.0/assert/mod.ts";
import { collectSyncCandidates, selectAccountsToSync } from "../instagram-sync-cron/select.ts";

const WS_OK = "11111111-1111-1111-1111-111111111111";
const WS_NO_FEATURE = "22222222-2222-2222-2222-222222222222";
const WS_INTERNAL = "33333333-3333-3333-3333-333333333333";

function acct(id: string, wsId: string, lastAttempt: string | null) {
  return { id, last_sync_attempt_at: lastAttempt, clientes: { conta_id: wsId } };
}

/** Serves a fixed ordered list in pages, and records how it was called. */
function pager(rows: ReturnType<typeof acct>[]) {
  const calls: Array<{ from: number; size: number }> = [];
  return {
    calls,
    fetchPage: (from: number, size: number) => {
      calls.push({ from, size });
      return Promise.resolve(rows.slice(from, from + size));
    },
  };
}

function allowOnly(...wsIds: string[]) {
  return (candidates: string[]) => Promise.resolve(candidates.filter((w) => wsIds.includes(w)));
}

Deno.test("stops after one page when the batch fills immediately", async () => {
  const rows = Array.from({ length: 50 }, (_, i) => acct(`a${i}`, WS_OK, null));
  const { fetchPage, calls } = pager(rows);

  const result = await collectSyncCandidates(
    { fetchPage, resolveAllowedWorkspaces: allowOnly(WS_OK), internalWorkspaces: new Set() },
    { pageSize: 25, maxPages: 10, targetEligible: 25 },
  );

  assertEquals(calls.length, 1);
  assertEquals(result.pages, 1);
  assertEquals(result.scanned, 25);
  assertEquals(result.cappedByPages, false);
});

Deno.test("pages past stale ineligible accounts to reach eligible ones", async () => {
  // First Codex finding. 500 free-plan accounts that are never attempted keep
  // last_sync_attempt_at null, so they sort ahead of every paying account. A
  // single fixed window would return only those and filter down to an empty
  // batch every run, forever.
  const rows = [
    ...Array.from({ length: 500 }, (_, i) => acct(`free-${i}`, WS_NO_FEATURE, null)),
    ...Array.from({ length: 30 }, (_, i) => acct(`paying-${i}`, WS_OK, "2026-07-01T00:00:00Z")),
  ];
  const { fetchPage } = pager(rows);

  const result = await collectSyncCandidates(
    { fetchPage, resolveAllowedWorkspaces: allowOnly(WS_OK), internalWorkspaces: new Set() },
    { pageSize: 200, maxPages: 25, targetEligible: 25 },
  );

  assertEquals(result.cappedByPages, false);

  const { selected, skippedNoFeature } = selectAccountsToSync(result.candidates, {
    allowedWorkspaces: result.allowedWorkspaces,
    internalWorkspaces: new Set(),
    limit: 25,
  });

  assertEquals(selected.length, 25);
  assertEquals(selected.every((a) => a.id.startsWith("paying-")), true);
  assertEquals(skippedNoFeature, 500);
});

Deno.test("internal accounts at the head of the ordering are paged past too", async () => {
  const rows = [
    ...Array.from({ length: 300 }, (_, i) => acct(`test-${i}`, WS_INTERNAL, null)),
    acct("real", WS_OK, "2026-07-01T00:00:00Z"),
  ];
  const { fetchPage } = pager(rows);

  const result = await collectSyncCandidates(
    {
      fetchPage,
      // The internal workspace is ALSO entitled; the internal flag must win.
      resolveAllowedWorkspaces: allowOnly(WS_OK, WS_INTERNAL),
      internalWorkspaces: new Set([WS_INTERNAL]),
    },
    { pageSize: 100, maxPages: 25, targetEligible: 25 },
  );

  const { selected, skippedInternal } = selectAccountsToSync(result.candidates, {
    allowedWorkspaces: result.allowedWorkspaces,
    internalWorkspaces: new Set([WS_INTERNAL]),
    limit: 25,
  });

  assertEquals(selected.map((a) => a.id), ["real"]);
  assertEquals(skippedInternal, 300);
});

Deno.test("exhausting candidates is not reported as a page cap", async () => {
  const rows = [acct("only", WS_OK, null)];
  const { fetchPage } = pager(rows);

  const result = await collectSyncCandidates(
    { fetchPage, resolveAllowedWorkspaces: allowOnly(WS_OK), internalWorkspaces: new Set() },
    { pageSize: 50, maxPages: 25, targetEligible: 25 },
  );

  assertEquals(result.exhausted, true);
  assertEquals(result.cappedByPages, false);
  assertEquals(result.candidates.length, 1);
});

Deno.test("hitting the page cap without filling the batch is flagged, not silent", async () => {
  // Enough ineligible accounts to outrun the page cap entirely.
  const rows = Array.from({ length: 5000 }, (_, i) => acct(`free-${i}`, WS_NO_FEATURE, null));
  const { fetchPage } = pager(rows);

  const result = await collectSyncCandidates(
    { fetchPage, resolveAllowedWorkspaces: allowOnly(WS_OK), internalWorkspaces: new Set() },
    { pageSize: 100, maxPages: 3, targetEligible: 25 },
  );

  assertEquals(result.pages, 3);
  assertEquals(result.scanned, 300);
  assertEquals(result.exhausted, false);
  assertEquals(result.cappedByPages, true);
});

Deno.test("resolves feature_auto_sync_cron once per workspace across all pages", async () => {
  // Same two workspaces repeat on every page; the RPC must not be re-issued.
  const rows = Array.from({ length: 400 }, (_, i) =>
    acct(`a${i}`, i % 2 === 0 ? WS_OK : WS_NO_FEATURE, null));
  const { fetchPage } = pager(rows);

  const asked: string[][] = [];
  await collectSyncCandidates(
    {
      fetchPage,
      resolveAllowedWorkspaces: (wsIds) => {
        asked.push(wsIds);
        return Promise.resolve(wsIds.filter((w) => w === WS_OK));
      },
      internalWorkspaces: new Set(),
    },
    { pageSize: 20, maxPages: 25, targetEligible: 25 },
  );

  assertEquals(asked.length, 1);
  assertEquals([...asked[0]].sort(), [WS_OK, WS_NO_FEATURE].sort());
});

Deno.test("requests contiguous non-overlapping page ranges", async () => {
  const rows = Array.from({ length: 500 }, (_, i) => acct(`free-${i}`, WS_NO_FEATURE, null));
  const { fetchPage, calls } = pager(rows);

  await collectSyncCandidates(
    { fetchPage, resolveAllowedWorkspaces: allowOnly(WS_OK), internalWorkspaces: new Set() },
    { pageSize: 100, maxPages: 4, targetEligible: 25 },
  );

  assertEquals(calls, [
    { from: 0, size: 100 },
    { from: 100, size: 100 },
    { from: 200, size: 100 },
    { from: 300, size: 100 },
  ]);
});
