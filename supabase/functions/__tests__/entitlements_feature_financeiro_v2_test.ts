import { assert, assertEquals } from "./assert.ts";
import { FEATURE_COLUMNS, mergeEntitlements } from "../_shared/entitlements.ts";

Deno.test("FEATURE_COLUMNS conhece feature_financeiro_v2", () => {
  assert(
    (FEATURE_COLUMNS as readonly string[]).includes("feature_financeiro_v2"),
    "feature_financeiro_v2 precisa estar em FEATURE_COLUMNS para o plano e o override resolverem a flag",
  );
});

Deno.test("feature_financeiro_v2 nasce falsa no plano e o override a liga", () => {
  const plan = { name: "Max" };
  assertEquals(
    mergeEntitlements(plan, null, null).features.feature_financeiro_v2,
    false,
    "plano sem a chave precisa resolver false",
  );
  assertEquals(
    mergeEntitlements(plan, null, { feature_financeiro_v2: true }).features.feature_financeiro_v2,
    true,
    "override true precisa ligar a flag",
  );
});
