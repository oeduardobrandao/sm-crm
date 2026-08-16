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

Deno.test("opcionais do v1: manage_comments + manage_messages (o POST /messages exige o segundo, apesar da doc de private replies)", () => {
  assertEquals([...IG_OPTIONAL_SCOPES], [
    "instagram_business_manage_comments",
    "instagram_business_manage_messages",
  ]);
  assert(!IG_BASE_SCOPES.includes("instagram_business_manage_messages" as never));
});

Deno.test("buildScopeParam: trio sem a flag; trio + opcionais com a flag", () => {
  assertEquals(buildScopeParam(false), IG_BASE_SCOPES.join(","));
  assertEquals(buildScopeParam(true), IG_ALL_SCOPES.join(","));
});
