import { assert } from "./assert.ts";
import { FEATURE_COLUMNS } from "../_shared/entitlements.ts";

Deno.test("FEATURE_COLUMNS conhece feature_post_processes", () => {
  assert(
    (FEATURE_COLUMNS as readonly string[]).includes("feature_post_processes"),
    "feature_post_processes precisa estar em FEATURE_COLUMNS para o plano e o override resolverem a flag",
  );
});
