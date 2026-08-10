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
 *    .order("id") — the enabled-workspace listing (applies the eq filter for
 *    real so the test proves it is present AND correct).
 *  - .rpc("storage_autoclean_run", { p_workspace }) — scripted per-workspace
 *    results (success payload, skip payload, or error).
 */
interface FakeWorkspace {
  id: string;
  storage_autoclean_enabled: boolean;
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
  const db = {
    rpcCalls,
    from(table: string) {
      assert(table === "workspaces", `unexpected table ${table}`);
      const filters: { eq: Record<string, unknown> } = { eq: {} };
      const chain = {
        eq(column: string, value: unknown) {
          filters.eq[column] = value;
          return chain;
        },
        order(_column: string, _opts: { ascending: boolean }) {
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
          const data = workspaces
            .filter((w) =>
              Object.entries(filters.eq).every(
                (entry) => w[entry[0] as keyof FakeWorkspace] === entry[1],
              )
            )
            .map((w) => ({ id: w.id }));
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
