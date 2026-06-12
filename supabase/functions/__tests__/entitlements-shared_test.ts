import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { mergeEntitlements } from "../_shared/entitlements.ts";

Deno.test("mergeEntitlements: overrides win over plan", () => {
  const plan = { name: "Free", max_clients: 2, feature_leads: false };
  const out = mergeEntitlements(plan as never,
    { max_clients: 50 }, { feature_leads: true });
  assertEquals(out.limits.max_clients, 50);
  assertEquals(out.features.feature_leads, true);
  assertEquals(out.planName, "Free");
});
