import { assert, assertEquals } from "./assert.ts";
import { FEATURE_COLUMNS, mergeEntitlements } from "../_shared/entitlements.ts";

Deno.test("FEATURE_COLUMNS conhece feature_crm_vidro", () => {
  assert(
    (FEATURE_COLUMNS as readonly string[]).includes("feature_crm_vidro"),
    "feature_crm_vidro precisa estar em FEATURE_COLUMNS para o plano e o override resolverem a flag",
  );
});

Deno.test("feature_crm_vidro nasce falsa no plano e o override a liga", () => {
  const plan = { name: "Max" };
  assertEquals(
    mergeEntitlements(plan, null, null).features.feature_crm_vidro,
    false,
    "plano sem a chave precisa resolver false",
  );
  assertEquals(
    mergeEntitlements(plan, null, { feature_crm_vidro: true }).features.feature_crm_vidro,
    true,
    "override true precisa ligar a flag",
  );
});
