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
