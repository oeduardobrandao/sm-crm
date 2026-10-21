import { assert } from "./assert.ts";
import { FEATURE_COLUMNS } from "../_shared/entitlements.ts";

Deno.test("FEATURE_COLUMNS conhece feature_multiplatform", () => {
  assert(
    (FEATURE_COLUMNS as readonly string[]).includes("feature_multiplatform"),
    "feature_multiplatform precisa estar em FEATURE_COLUMNS para o plano e o override resolverem a flag",
  );
});
