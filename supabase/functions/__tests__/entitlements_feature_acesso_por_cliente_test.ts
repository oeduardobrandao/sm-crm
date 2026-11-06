import { assert, assertEquals } from "./assert.ts";
import { FEATURE_COLUMNS, mergeEntitlements } from "../_shared/entitlements.ts";

Deno.test("FEATURE_COLUMNS conhece feature_acesso_por_cliente", () => {
  assert(
    (FEATURE_COLUMNS as readonly string[]).includes("feature_acesso_por_cliente"),
    "feature_acesso_por_cliente precisa estar em FEATURE_COLUMNS para o plano e o override resolverem a flag",
  );
});

Deno.test("feature_acesso_por_cliente nasce falsa no plano e o override a liga", () => {
  const plan = { name: "Max" };
  assertEquals(
    mergeEntitlements(plan, null, null).features.feature_acesso_por_cliente,
    false,
    "plano sem a chave precisa resolver false",
  );
  assertEquals(
    mergeEntitlements(plan, null, { feature_acesso_por_cliente: true }).features.feature_acesso_por_cliente,
    true,
    "override true precisa ligar a flag",
  );
});
