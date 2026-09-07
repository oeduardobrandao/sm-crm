import { assert, assertEquals } from "./assert.ts";
import {
  createStorageAutocleanCronHandler,
  runStorageAutocleanCron,
  type StorageAutocleanCronDeps,
  type StorageAutocleanRunResult,
} from "../storage-autoclean-cron/handler.ts";

/**
 * Fake of the two supabase-js surfaces the handler touches:
 *  - .from("workspaces").select("id").eq("storage_autoclean_enabled", true)
 *    .order(...) — the enabled-workspace listing. The fake applies the eq
 *    filter AND the order keys for real, so the tests prove both are present
 *    and correct. Ordering is what keeps the deadline-truncated tail rotating,
 *    so a fake that ignored .order() would let that regress silently.
 *  - .rpc("storage_autoclean_run", { p_workspace }) — scripted per-workspace
 *    results (success payload, skip payload, or error).
 */
interface FakeWorkspace {
  id: string;
  storage_autoclean_enabled: boolean;
  /** Null/absent = never ran; sorts ahead of every stamped workspace. */
  storage_autoclean_last_run_at?: string | null;
}

interface OrderKey {
  column: string;
  ascending: boolean;
  nullsFirst?: boolean;
}

/** Mirrors PostgREST's multi-key ORDER BY over the fake rows. */
function applyOrder(rows: FakeWorkspace[], keys: OrderKey[]): FakeWorkspace[] {
  return [...rows].sort((a, b) => {
    for (const key of keys) {
      const av = (a as Record<string, unknown>)[key.column] ?? null;
      const bv = (b as Record<string, unknown>)[key.column] ?? null;
      if (av === bv) continue;
      if (av === null) return key.nullsFirst ? -1 : 1;
      if (bv === null) return key.nullsFirst ? 1 : -1;
      const cmp = String(av) < String(bv) ? -1 : 1;
      return key.ascending ? cmp : -cmp;
    }
    return 0;
  });
}

function makeFakeDb(
  workspaces: FakeWorkspace[],
  rpcResults: Record<
    string,
    { data: StorageAutocleanRunResult | null; error: { message: string } | null }
  >,
  opts?: { listError?: { message: string } },
) {
  const rpcCalls: string[] = [];
  const orderKeys: OrderKey[] = [];
  const db = {
    rpcCalls,
    orderKeys,
    from(table: string) {
      assert(table === "workspaces", `unexpected table ${table}`);
      const filters: { eq: Record<string, unknown> } = { eq: {} };
      const chain = {
        eq(column: string, value: unknown) {
          filters.eq[column] = value;
          return chain;
        },
        order(column: string, opts: { ascending: boolean; nullsFirst?: boolean }) {
          orderKeys.push({ column, ...opts });
          return chain;
        },
        then(
          onFulfilled: (v: {
            data: Array<{ id: string }> | null;
            error: { message: string } | null;
          }) => unknown,
        ) {
          if (opts?.listError) {
            return Promise.resolve(onFulfilled({ data: null, error: opts.listError }));
          }
          const filtered = workspaces.filter((w) =>
            Object.entries(filters.eq).every(
              (entry) => w[entry[0] as keyof FakeWorkspace] === entry[1],
            )
          );
          const data = applyOrder(filtered, orderKeys).map((w) => ({ id: w.id }));
          return Promise.resolve(onFulfilled({ data, error: null }));
        },
      };
      return { select: (_cols: string) => chain };
    },
    rpc(fn: string, args: { p_workspace: string }) {
      assertEquals(fn, "storage_autoclean_run");
      rpcCalls.push(args.p_workspace);
      const scripted = rpcResults[args.p_workspace];
      if (!scripted) {
        return Promise.resolve({
          data: { skipped: "disabled" } as StorageAutocleanRunResult,
          error: null,
        });
      }
      return Promise.resolve(scripted);
    },
  };
  return db;
}

function makeDeps(
  db: ReturnType<typeof makeFakeDb>,
  extra?: Partial<StorageAutocleanCronDeps>,
): StorageAutocleanCronDeps {
  return {
    db: db as unknown as StorageAutocleanCronDeps["db"],
    ...extra,
  };
}

// ---------------------------------------------------------------------------
// createStorageAutocleanCronHandler (auth wrapper)
// ---------------------------------------------------------------------------

Deno.test("handler: 401 on missing x-cron-secret without touching run", async () => {
  let runCalled = false;
  const handler = createStorageAutocleanCronHandler({
    cronSecret: "secret",
    timingSafeEqual: (a, b) => a === b,
    run: () => {
      runCalled = true;
      return Promise.resolve(new Response("ok"));
    },
  });
  const res = await handler(new Request("http://localhost/"));
  assertEquals(res.status, 401);
  assertEquals(runCalled, false);
});

Deno.test("handler: 401 on wrong secret without touching run", async () => {
  let runCalled = false;
  const handler = createStorageAutocleanCronHandler({
    cronSecret: "secret",
    timingSafeEqual: (a, b) => a === b,
    run: () => {
      runCalled = true;
      return Promise.resolve(new Response("ok"));
    },
  });
  const res = await handler(
    new Request("http://localhost/", { headers: { "x-cron-secret": "nope" } }),
  );
  assertEquals(res.status, 401);
  assertEquals(runCalled, false);
});

Deno.test("handler: delegates to run on correct secret", async () => {
  const handler = createStorageAutocleanCronHandler({
    cronSecret: "secret",
    timingSafeEqual: (a, b) => a === b,
    run: () => Promise.resolve(new Response("ok", { status: 200 })),
  });
  const res = await handler(
    new Request("http://localhost/", { headers: { "x-cron-secret": "secret" } }),
  );
  assertEquals(res.status, 200);
  assertEquals(await res.text(), "ok");
});

// ---------------------------------------------------------------------------
// runStorageAutocleanCron (business loop)
// ---------------------------------------------------------------------------

Deno.test("run: visits only enabled workspaces and aggregates results", async () => {
  const db = makeFakeDb(
    [
      { id: "ws-a", storage_autoclean_enabled: true },
      { id: "ws-b", storage_autoclean_enabled: false },
      { id: "ws-c", storage_autoclean_enabled: true },
      { id: "ws-d", storage_autoclean_enabled: true },
    ],
    {
      "ws-a": {
        data: { files_deleted: 3, bytes_freed: 300, posts_stamped: 2 },
        error: null,
      },
      "ws-c": { data: { skipped: "below_threshold" }, error: null },
      "ws-d": {
        data: { files_deleted: 0, bytes_freed: 0, posts_stamped: 0 },
        error: null,
      },
    },
  );
  const result = await runStorageAutocleanCron(makeDeps(db));

  assertEquals(db.rpcCalls, ["ws-a", "ws-c", "ws-d"]);
  assertEquals(result.workspaces_checked, 3);
  assertEquals(result.cleaned, 1);
  assertEquals(result.skipped, 1);
  assertEquals(result.files_deleted, 3);
  assertEquals(result.bytes_freed, 300);
  assertEquals(result.deadline_stopped, 0);
  assertEquals(result.errors.length, 0);
});

Deno.test("run: continues past a per-workspace error and reports once", async () => {
  const db = makeFakeDb(
    [
      { id: "ws-a", storage_autoclean_enabled: true },
      { id: "ws-b", storage_autoclean_enabled: true },
      { id: "ws-c", storage_autoclean_enabled: true },
    ],
    {
      "ws-a": { data: null, error: { message: "boom" } },
      "ws-b": {
        data: { files_deleted: 1, bytes_freed: 50, posts_stamped: 1 },
        error: null,
      },
      "ws-c": { data: null, error: { message: "kaput" } },
    },
  );
  const reports: Array<{ failed: number; errors: Array<{ accountId?: string; error: string }> }> =
    [];
  const result = await runStorageAutocleanCron(makeDeps(db, {
    report: (detail) => {
      reports.push(detail);
      return Promise.resolve();
    },
  }));

  // Both failures recorded, the middle workspace still processed.
  assertEquals(db.rpcCalls, ["ws-a", "ws-b", "ws-c"]);
  assertEquals(result.errors, [
    { accountId: "ws-a", error: "boom" },
    { accountId: "ws-c", error: "kaput" },
  ]);
  assertEquals(result.cleaned, 1);
  assertEquals(result.files_deleted, 1);
  // Exactly one report call carrying every error.
  assertEquals(reports.length, 1);
  assertEquals(reports[0].failed, 2);
});

Deno.test("run: no report call when there are no errors", async () => {
  const db = makeFakeDb(
    [{ id: "ws-a", storage_autoclean_enabled: true }],
    { "ws-a": { data: { skipped: "disabled" }, error: null } },
  );
  let reported = false;
  await runStorageAutocleanCron(makeDeps(db, {
    report: () => {
      reported = true;
      return Promise.resolve();
    },
  }));
  assertEquals(reported, false);
});

Deno.test("run: deadline bail leaves remaining workspaces untouched", async () => {
  const db = makeFakeDb(
    [
      { id: "ws-a", storage_autoclean_enabled: true },
      { id: "ws-b", storage_autoclean_enabled: true },
      { id: "ws-c", storage_autoclean_enabled: true },
    ],
    {
      "ws-a": {
        data: { files_deleted: 1, bytes_freed: 10, posts_stamped: 1 },
        error: null,
      },
    },
  );
  // Each nowMs() call advances 40s: start=0, ws-a check=40s (under 60s),
  // ws-b check=80s (over) -> bail with ws-b and ws-c unprocessed.
  let t = -40_000;
  const result = await runStorageAutocleanCron(makeDeps(db, {
    nowMs: () => {
      t += 40_000;
      return t;
    },
  }));

  assertEquals(db.rpcCalls, ["ws-a"]);
  assertEquals(result.workspaces_checked, 1);
  assertEquals(result.deadline_stopped, 2);
});

Deno.test("run: throws when the workspace listing fails", async () => {
  const db = makeFakeDb([], {}, { listError: { message: "db down" } });
  let threw = false;
  try {
    await runStorageAutocleanCron(makeDeps(db));
  } catch (e) {
    threw = true;
    assert(String(e).includes("workspace listing failed"));
  }
  assert(threw, "expected runStorageAutocleanCron to throw");
  assertEquals(db.rpcCalls.length, 0);
});

// ---------------------------------------------------------------------------
// Ordering: what keeps the deadline-truncated tail from starving
// ---------------------------------------------------------------------------

Deno.test("run: orders stalest-first with never-run workspaces ahead", async () => {
  const db = makeFakeDb(
    [
      { id: "ws-a", storage_autoclean_enabled: true, storage_autoclean_last_run_at: "2026-09-06T02:30:00Z" },
      { id: "ws-b", storage_autoclean_enabled: true, storage_autoclean_last_run_at: null },
      { id: "ws-c", storage_autoclean_enabled: true, storage_autoclean_last_run_at: "2026-08-30T02:30:00Z" },
      { id: "ws-d", storage_autoclean_enabled: true },
    ],
    {},
  );

  await runStorageAutocleanCron(makeDeps(db));

  // Never-run (null) first, id-tiebroken; then the stamped ones oldest-first.
  assertEquals(db.rpcCalls, ["ws-b", "ws-d", "ws-c", "ws-a"]);
  // The id key must survive as the LAST order key: without it two workspaces
  // stamped in the same run come back in an arbitrary order and the run stops
  // being reproducible.
  assertEquals(db.orderKeys, [
    { column: "storage_autoclean_last_run_at", ascending: true, nullsFirst: true },
    { column: "id", ascending: true },
  ]);
});

Deno.test("run: the deadline tail rotates across runs instead of starving", async () => {
  // Two workspaces, budget for one. Night 1 visits the stalest; night 2, with
  // that one stamped, must visit the OTHER. Ordering by id (the original
  // behaviour) would visit ws-early both nights and never clean ws-late.
  const budgetForOne = () => {
    let t = -40_000;
    return () => {
      t += 40_000;
      return t;
    };
  };
  const cleaned = { data: { files_deleted: 1, bytes_freed: 10 }, error: null };

  const night1 = makeFakeDb(
    [
      { id: "ws-early", storage_autoclean_enabled: true, storage_autoclean_last_run_at: "2026-09-01T02:30:00Z" },
      { id: "ws-late", storage_autoclean_enabled: true, storage_autoclean_last_run_at: "2026-09-05T02:30:00Z" },
    ],
    { "ws-early": cleaned, "ws-late": cleaned },
  );
  const r1 = await runStorageAutocleanCron(makeDeps(night1, { nowMs: budgetForOne() }));
  assertEquals(night1.rpcCalls, ["ws-early"]);
  assertEquals(r1.deadline_stopped, 1);

  // ws-early's stamp advanced past ws-late's, so the queue head swaps.
  const night2 = makeFakeDb(
    [
      { id: "ws-early", storage_autoclean_enabled: true, storage_autoclean_last_run_at: "2026-09-06T02:30:00Z" },
      { id: "ws-late", storage_autoclean_enabled: true, storage_autoclean_last_run_at: "2026-09-05T02:30:00Z" },
    ],
    { "ws-early": cleaned, "ws-late": cleaned },
  );
  const r2 = await runStorageAutocleanCron(makeDeps(night2, { nowMs: budgetForOne() }));
  assertEquals(night2.rpcCalls, ["ws-late"]);
  assertEquals(r2.deadline_stopped, 1);
});
