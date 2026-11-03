import { assert, assertEquals } from "./assert.ts";
import { FEATURE_COLUMNS, mergeEntitlements } from "../_shared/entitlements.ts";

Deno.test("FEATURE_COLUMNS conhece feature_instagram_comments_ai", () => {
  assert(
    (FEATURE_COLUMNS as readonly string[]).includes("feature_instagram_comments_ai"),
    "feature_instagram_comments_ai precisa estar em FEATURE_COLUMNS para o plano e o override resolverem a flag",
  );
});

Deno.test("feature_instagram_comments_ai nasce falsa no plano e o override a liga", () => {
  const plan = { name: "Max" };
  assertEquals(
    mergeEntitlements(plan, null, null).features.feature_instagram_comments_ai,
    false,
    "plano sem a chave precisa resolver false",
  );
  assertEquals(
    mergeEntitlements(plan, null, { feature_instagram_comments_ai: true }).features.feature_instagram_comments_ai,
    true,
    "override true precisa ligar a flag",
  );
});
