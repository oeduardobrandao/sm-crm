import { assert, assertEquals } from "./assert.ts";
import { resolveGrantedPermissions } from "../_shared/instagram-permissions.ts";
import { IG_BASE_SCOPES } from "../_shared/instagram-scopes.ts";

Deno.test("sem permissions da Meta: fallback otimista SÓ do trio, nunca do opcional", () => {
  for (const reported of [undefined, null, [], "x"]) {
    const out = resolveGrantedPermissions(reported);
    assertEquals(out.permissions, [...IG_BASE_SCOPES]);
    assertEquals(out.hasCommentsScope, false);
  }
});

Deno.test("com permissions explícitas: registra o que veio e detecta o escopo", () => {
  const out = resolveGrantedPermissions([...IG_BASE_SCOPES, "instagram_business_manage_comments"]);
  assert(out.hasCommentsScope);
  assert(out.permissions.includes("instagram_business_manage_comments"));
  const sem = resolveGrantedPermissions([...IG_BASE_SCOPES]);
  assertEquals(sem.hasCommentsScope, false);
});
