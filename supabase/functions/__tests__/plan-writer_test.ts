import { assertEquals } from "./assert.ts";
import { writeWorkspacePlan } from "../_shared/plan-writer.ts";
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";

// Fake svc: the read returns the given plan_source, updates are recorded.
function makeSvc(planSource: string | null) {
  const updates: Record<string, unknown>[] = [];
  // deno-lint-ignore no-explicit-any
  const chain: any = {};
  chain.select = () => chain;
  chain.eq = () => chain;
  chain.abortSignal = () => chain;
  chain.single = () =>
    Promise.resolve({ data: { plan_source: planSource }, error: null });
  chain.update = (p: Record<string, unknown>) => {
    updates.push(p);
    return chain;
  };
  chain.then = (resolve: (r: unknown) => unknown) =>
    Promise.resolve(resolve({ data: null, error: null }));
  return { svc: { from: () => chain } as unknown as SupabaseClient, updates };
}

Deno.test("writeWorkspacePlan replaces a demo on a subscribed write", async () => {
  const { svc, updates } = makeSvc("demo");
  await writeWorkspacePlan(svc, "ws-1", "pro", "stripe", "subscribed");
  assertEquals(updates, [{ plan_id: "pro", plan_source: "stripe" }]);
});

Deno.test("writeWorkspacePlan skips a demo on a fallback write", async () => {
  const { svc, updates } = makeSvc("demo");
  await writeWorkspacePlan(svc, "ws-1", "free", "stripe", "fallback");
  assertEquals(updates, []);
});

Deno.test("writeWorkspacePlan still skips manual on a subscribed write", async () => {
  const { svc, updates } = makeSvc("manual");
  await writeWorkspacePlan(svc, "ws-1", "pro", "stripe", "subscribed");
  assertEquals(updates, []);
});

Deno.test("writeWorkspacePlan writes system/stripe sources on a fallback write", async () => {
  for (const src of ["system", "stripe"]) {
    const { svc, updates } = makeSvc(src);
    await writeWorkspacePlan(svc, "ws-1", "free", "stripe", "fallback");
    assertEquals(updates, [{ plan_id: "free", plan_source: "stripe" }]);
  }
});

Deno.test("writeWorkspacePlan writes a null plan_source on a fallback write", async () => {
  const { svc, updates } = makeSvc(null);
  await writeWorkspacePlan(svc, "ws-1", "free", "stripe", "fallback");
  assertEquals(updates, [{ plan_id: "free", plan_source: "stripe" }]);
});

// ---- teste reverso -------------------------------------------------------------------------
// Fake svc with the full workspace row and an rpc recorder; rpc results by name.
function makeTrialSvc(
  row: Record<string, unknown>,
  rpcResults: Record<string, unknown> = {},
) {
  const updates: Record<string, unknown>[] = [];
  const rpcs: Array<{ name: string; args: Record<string, unknown> }> = [];
  // deno-lint-ignore no-explicit-any
  const chain: any = {};
  chain.select = () => chain;
  chain.eq = () => chain;
  chain.abortSignal = () => chain;
  chain.single = () => Promise.resolve({ data: row, error: null });
  chain.update = (p: Record<string, unknown>) => {
    updates.push(p);
    return chain;
  };
  chain.then = (resolve: (r: unknown) => unknown) =>
    Promise.resolve(resolve({ data: null, error: null }));
  const svc = {
    from: () => chain,
    rpc: (name: string, args: Record<string, unknown>) => {
      rpcs.push({ name, args });
      // deno-lint-ignore no-explicit-any
      const q: any = {
        abortSignal: () => q,
        then: (resolve: (r: unknown) => unknown) =>
          Promise.resolve(resolve({ data: rpcResults[name] ?? null, error: null })),
      };
      return q;
    },
  } as unknown as SupabaseClient;
  return { svc, updates, rpcs };
}

const NOW = new Date("2026-12-01T12:00:00Z");
const future = "2026-12-05T12:00:00Z";
const past = "2026-11-30T12:00:00Z";

Deno.test("subscribed_on_trial_calls_convert", async () => {
  const { svc, updates, rpcs } = makeTrialSvc(
    { plan_source: "trial", reverse_trial_outcome: null },
    { convert_reverse_trial: "converted" },
  );
  await writeWorkspacePlan(svc, "ws-1", "pro", "stripe", "subscribed", NOW);
  assertEquals(rpcs, [{
    name: "convert_reverse_trial",
    args: { p_workspace: "ws-1", p_plan: "pro", p_source: "stripe" },
  }]);
  assertEquals(updates, []);
});

Deno.test("subscribed on a downgraded trial: late conversion via convert, win-back writes normally", async () => {
  const late = makeTrialSvc(
    { plan_source: "system", reverse_trial_outcome: "downgraded" },
    { convert_reverse_trial: "rewritten_late" },
  );
  await writeWorkspacePlan(late.svc, "ws-1", "pro", "stripe", "subscribed", NOW);
  assertEquals(late.rpcs.map((r) => r.name), ["convert_reverse_trial"]);
  assertEquals(late.updates, []);

  const winback = makeTrialSvc(
    { plan_source: "system", reverse_trial_outcome: "downgraded" },
    { convert_reverse_trial: "not_trial" },
  );
  await writeWorkspacePlan(winback.svc, "ws-1", "pro", "stripe", "subscribed", NOW);
  assertEquals(winback.updates, [{ plan_id: "pro", plan_source: "stripe" }]);
});

Deno.test("subscribed on a running trial that convert refuses writes nothing", async () => {
  const { svc, updates } = makeTrialSvc(
    { plan_source: "trial" },
    { convert_reverse_trial: "not_trial" },
  );
  await writeWorkspacePlan(svc, "ws-1", "pro", "stripe", "subscribed", NOW);
  assertEquals(updates, []);
});

Deno.test("fallback_on_trial_is_noop", async () => {
  const { svc, updates, rpcs } = makeTrialSvc({ plan_source: "trial" });
  await writeWorkspacePlan(svc, "ws-1", "free", "stripe", "fallback", NOW);
  assertEquals(updates, []);
  assertEquals(rpcs, []);
});

Deno.test("cancel_inside_window_reverts_to_trial", async () => {
  const { svc, updates, rpcs } = makeTrialSvc(
    {
      plan_source: "stripe",
      reverse_trial_outcome: "converted",
      reverse_trial_ends_at: future,
      reverse_trial_first_paid_at: null,
    },
    { revert_reverse_trial_conversion: true },
  );
  await writeWorkspacePlan(svc, "ws-1", "free", "stripe", "fallback", NOW);
  assertEquals(rpcs, [{ name: "revert_reverse_trial_conversion", args: { p_workspace: "ws-1" } }]);
  assertEquals(updates, []);
});

Deno.test("fallback_on_never_paid_trial_conversion_marks_downgraded", async () => {
  const { svc, updates, rpcs } = makeTrialSvc(
    {
      plan_source: "stripe",
      reverse_trial_outcome: "converted",
      reverse_trial_ends_at: past,
      reverse_trial_first_paid_at: null,
    },
    { mark_reverse_trial_unpaid: true },
  );
  await writeWorkspacePlan(svc, "ws-1", "free", "stripe", "fallback", NOW);
  assertEquals(updates, [{ plan_id: "free", plan_source: "stripe" }]);
  assertEquals(rpcs, [{ name: "mark_reverse_trial_unpaid", args: { p_workspace: "ws-1" } }]);
});

Deno.test("fallback_on_paid_customer_unchanged", async () => {
  const { svc, updates, rpcs } = makeTrialSvc({
    plan_source: "stripe",
    reverse_trial_outcome: "converted",
    reverse_trial_ends_at: past,
    reverse_trial_first_paid_at: past,
  });
  await writeWorkspacePlan(svc, "ws-1", "free", "stripe", "fallback", NOW);
  assertEquals(updates, [{ plan_id: "free", plan_source: "stripe" }]);
  assertEquals(rpcs, []);
});

Deno.test("manual_still_never_overridden (trial fields present)", async () => {
  const { svc, updates, rpcs } = makeTrialSvc(
    { plan_source: "manual", reverse_trial_outcome: "converted", reverse_trial_first_paid_at: null },
  );
  await writeWorkspacePlan(svc, "ws-1", "pro", "stripe", "subscribed", NOW);
  await writeWorkspacePlan(svc, "ws-1", "free", "stripe", "fallback", NOW);
  assertEquals(updates, []);
  assertEquals(rpcs, []);
});

Deno.test("an rpc error throws (webhook redelivers)", async () => {
  // deno-lint-ignore no-explicit-any
  const chain: any = {};
  chain.select = () => chain;
  chain.eq = () => chain;
  chain.abortSignal = () => chain;
  chain.single = () => Promise.resolve({ data: { plan_source: "trial" }, error: null });
  const svc = {
    from: () => chain,
    rpc: () => ({
      abortSignal: () => Promise.resolve({ data: null, error: { message: "boom" } }),
    }),
  } as unknown as SupabaseClient;
  let threw = false;
  try {
    await writeWorkspacePlan(svc, "ws-1", "pro", "stripe", "subscribed", NOW);
  } catch {
    threw = true;
  }
  assertEquals(threw, true);
});

Deno.test("invoice_paid_marks_first_paid", async () => {
  const { markReverseTrialFirstPaid } = await import("../_shared/plan-writer.ts");
  const { svc, rpcs } = makeTrialSvc({});
  await markReverseTrialFirstPaid(svc, "ws-1");
  assertEquals(rpcs, [{ name: "mark_reverse_trial_first_paid", args: { p_workspace: "ws-1" } }]);
});
