import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { hubTokenActive } from "../_shared/hub-token.ts";

Deno.test("hubTokenActive gates on is_active + feature", () => {
  assertEquals(hubTokenActive({ is_active: true }, true), true);
  assertEquals(hubTokenActive({ is_active: true }, false), false); // feature off
  assertEquals(hubTokenActive({ is_active: false }, true), false); // inactive token
});
