import { assert, assertEquals } from "./assert.ts";
import { FEATURE_COLUMNS, mergeEntitlements } from "../_shared/entitlements.ts";

Deno.test("FEATURE_COLUMNS conhece feature_linha_editorial", () => {
  assert(
    (FEATURE_COLUMNS as readonly string[]).includes("feature_linha_editorial"),
    "feature_linha_editorial precisa estar em FEATURE_COLUMNS para o plano e o override resolverem a flag",
  );
});

Deno.test("feature_linha_editorial nasce falsa no plano e o override a liga", () => {
  const plan = { name: "Max" };
  assertEquals(
    mergeEntitlements(plan, null, null).features.feature_linha_editorial,
    false,
    "plano sem a chave precisa resolver false",
  );
  assertEquals(
    mergeEntitlements(plan, null, { feature_linha_editorial: true }).features.feature_linha_editorial,
    true,
    "override true precisa ligar a flag",
  );
});
