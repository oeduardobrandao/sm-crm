import { assertEquals, assertThrows } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { appBaseUrl } from "../_shared/app-url.ts";

// Order matters: this test deletes APP_BASE_URL, so it must run BEFORE the test that
// sets it — leaving the env SET when the file finishes, so it can't leak an unset
// APP_BASE_URL into another test file that happens to run afterward.
Deno.test("appBaseUrl: throws when APP_BASE_URL is unset", () => {
  Deno.env.delete("APP_BASE_URL");
  assertThrows(() => appBaseUrl());
});

Deno.test("appBaseUrl: returns the configured base when set", () => {
  Deno.env.set("APP_BASE_URL", "https://app.mesaas.com.br");
  assertEquals(appBaseUrl(), "https://app.mesaas.com.br");
});
