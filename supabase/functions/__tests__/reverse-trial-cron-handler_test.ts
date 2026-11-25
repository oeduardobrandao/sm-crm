import { assert, assertEquals } from "./assert.ts";
import {
  BATCH_LIMIT,
  createReverseTrialCronHandler,
  type ReverseTrialCronDeps,
  runReverseTrialCron,
} from "../reverse-trial-cron/handler.ts";

const NOW = new Date("2026-12-08T15:00:00Z");

interface Row {
  id: string;
  created_by: string | null;
  plan_source: string;
  reverse_trial_ends_at: string;
}

// Fake db: the select applies the eq/lte filters to `rows`; rpc results per workspace id.
function makeDeps(rows: Row[], rpc: Record<string, { data?: unknown; error?: { message: string } }> = {}) {
  const calls = {
    filters: [] as Array<[string, string, unknown]>,
    limit: 0,
    rpcs: [] as Array<{ name: string; args: Record<string, unknown> }>,
    captured: [] as Array<{ event: string; distinctId: string; props: Record<string, unknown> }>,
  };
  // deno-lint-ignore no-explicit-any
  const q: any = {
    select: () => q,
    eq: (c: string, v: unknown) => {
      calls.filters.push(["eq", c, v]);
      return q;
    },
    lte: (c: string, v: unknown) => {
      calls.filters.push(["lte", c, v]);
      return q;
    },
    order: () => q,
    limit: (n: number) => {
      calls.limit = n;
      return q;
    },
    abortSignal: () => q,
    then: (resolve: (r: unknown) => unknown) => {
      const lte = calls.filters.find((f) => f[0] === "lte")?.[2] as string;
      const data = rows.filter((r) =>
        r.plan_source === "trial" && new Date(r.reverse_trial_ends_at) <= new Date(lte)
      );
      return Promise.resolve(resolve({ data, error: null }));
    },
  };
  const deps: ReverseTrialCronDeps = {
    // deno-lint-ignore no-explicit-any
    db: {
      from: () => q,
      rpc: (name: string, args: Record<string, unknown>) => {
        calls.rpcs.push({ name, args });
        const r = rpc[args.p_workspace as string] ?? { data: true };
        // deno-lint-ignore no-explicit-any
        const p: any = {
          abortSignal: () => p,
          then: (resolve: (x: unknown) => unknown) =>
            Promise.resolve(resolve({ data: r.data ?? null, error: r.error ?? null })),
        };
        return p;
      },
    } as any,
    now: () => NOW,
    capture: (event, distinctId, props) => {
      calls.captured.push({ event, distinctId, props });
      return Promise.resolve();
    },
  };
  return { deps, calls };
}

const trial = (id: string, ends: string, owner: string | null = `u-${id}`): Row => ({
  id,
  created_by: owner,
  plan_source: "trial",
  reverse_trial_ends_at: ends,
});

Deno.test("ends_expired_trials", async () => {
  const { deps, calls } = makeDeps([
    trial("ws-1", "2026-12-08T14:00:00Z"),
    trial("ws-2", "2026-12-08T15:00:00Z"),
  ]);
  const res = await runReverseTrialCron(deps);
  assertEquals(res, { ended: 2, skipped: 0, errors: [] });
  assertEquals(calls.rpcs, [
    { name: "end_reverse_trial", args: { p_workspace: "ws-1", p_outcome: "downgraded" } },
    { name: "end_reverse_trial", args: { p_workspace: "ws-2", p_outcome: "downgraded" } },
  ]);
  assert(calls.filters.some((f) => f[0] === "eq" && f[1] === "plan_source" && f[2] === "trial"));
  assertEquals(calls.limit, BATCH_LIMIT);
  assertEquals(calls.captured.map((c) => [c.event, c.distinctId, c.props.outcome]), [
    ["reverse_trial_ended", "u-ws-1", "downgraded"],
    ["reverse_trial_ended", "u-ws-2", "downgraded"],
  ]);
});

Deno.test("skips_future_trials", async () => {
  const { deps, calls } = makeDeps([trial("ws-1", "2026-12-08T15:00:01Z")]);
  const res = await runReverseTrialCron(deps);
  assertEquals(res, { ended: 0, skipped: 0, errors: [] });
  assertEquals(calls.rpcs, []);
});

Deno.test("a false return (paid sub in force, already ended) is skipped, not an error", async () => {
  const { deps, calls } = makeDeps([trial("ws-1", "2026-12-01T00:00:00Z")], {
    "ws-1": { data: false },
  });
  const res = await runReverseTrialCron(deps);
  assertEquals(res, { ended: 0, skipped: 1, errors: [] });
  assertEquals(calls.captured, []);
});

Deno.test("one_failure_does_not_stop_batch", async () => {
  const { deps } = makeDeps(
    [trial("ws-1", "2026-12-01T00:00:00Z"), trial("ws-2", "2026-12-02T00:00:00Z")],
    { "ws-1": { error: { message: "boom" } } },
  );
  const res = await runReverseTrialCron(deps);
  assertEquals(res.ended, 1);
  assertEquals(res.errors.length, 1);
  assert(res.errors[0].includes("ws-1"));
});

Deno.test("a PostHog failure or a missing owner never fails the run", async () => {
  const { deps } = makeDeps([
    trial("ws-1", "2026-12-01T00:00:00Z"),
    trial("ws-2", "2026-12-01T00:00:00Z", null),
  ]);
  let captures = 0;
  deps.capture = () => {
    captures++;
    return Promise.reject(new Error("posthog down"));
  };
  const res = await runReverseTrialCron(deps);
  assertEquals(res, { ended: 2, skipped: 0, errors: [] });
  assertEquals(captures, 1);
});

Deno.test("rejects_missing_cron_secret", async () => {
  let ran = 0;
  const handler = createReverseTrialCronHandler({
    cronSecret: "s3cret",
    timingSafeEqual: (a: string, b: string) => a === b,
    run: () => {
      ran++;
      return Promise.resolve(new Response("{}", { status: 200 }));
    },
  });
  const missing = await handler(new Request("https://x/functions/v1/reverse-trial-cron", { method: "POST" }));
  assertEquals(missing.status, 401);
  const wrong = await handler(
    new Request("https://x/functions/v1/reverse-trial-cron", {
      method: "POST",
      headers: { "x-cron-secret": "nope" },
    }),
  );
  assertEquals(wrong.status, 401);
  assertEquals(ran, 0);
  const ok = await handler(
    new Request("https://x/functions/v1/reverse-trial-cron", {
      method: "POST",
      headers: { "x-cron-secret": "s3cret" },
    }),
  );
  assertEquals(ok.status, 200);
  assertEquals(ran, 1);
});
