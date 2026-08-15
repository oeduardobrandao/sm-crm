import { assert, assertEquals } from "./assert.ts";
import {
  buildScopeParam, IG_ALL_SCOPES, IG_BASE_SCOPES, IG_OPTIONAL_SCOPES,
} from "../_shared/instagram-scopes.ts";

Deno.test("base scopes são exatamente o trio historicamente pedido", () => {
  assertEquals([...IG_BASE_SCOPES], [
    "instagram_business_basic",
    "instagram_business_manage_insights",
    "instagram_business_content_publish",
  ]);
});

Deno.test("único escopo opcional do v1 é manage_comments (nunca manage_messages)", () => {
  assertEquals([...IG_OPTIONAL_SCOPES], ["instagram_business_manage_comments"]);
  assert(!IG_ALL_SCOPES.includes("instagram_business_manage_messages"));
});

Deno.test("buildScopeParam: trio sem a flag; trio + opcionais com a flag", () => {
  assertEquals(buildScopeParam(false), IG_BASE_SCOPES.join(","));
  assertEquals(buildScopeParam(true), IG_ALL_SCOPES.join(","));
});
