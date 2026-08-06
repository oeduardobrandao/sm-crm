import { assertEquals } from "./assert.ts";
import { classifyOAuthError, isAppConfigError } from "../instagram-integration/oauth-error.ts";

const noParams = new URLSearchParams();

Deno.test("classifyOAuthError: user cancelled via redirect params", () => {
  assertEquals(classifyOAuthError("", new URLSearchParams("error=access_denied&error_reason=user_denied")), "cancelled");
});

Deno.test("classifyOAuthError: user cancelled via message", () => {
  assertEquals(classifyOAuthError("Error: user_denied the request", noParams), "cancelled");
});

Deno.test("classifyOAuthError: missing permissions marker", () => {
  assertEquals(classifyOAuthError("MISSING_PERMISSIONS: instagram_business_content_publish", noParams), "missing_permissions");
});

Deno.test("classifyOAuthError: off-Meta activity, pt and en", () => {
  assertEquals(classifyOAuthError("O histórico de atividade futura da sua conta fora das tecnologias da Meta está desativado.", noParams), "off_meta_activity");
  assertEquals(classifyOAuthError("Your future off-Meta activity is turned off.", noParams), "off_meta_activity");
});

Deno.test("classifyOAuthError: expired oauth state", () => {
  assertEquals(classifyOAuthError("OAuth state expired or already used", noParams), "state_expired");
});

Deno.test("classifyOAuthError: not a business account", () => {
  assertEquals(classifyOAuthError("This user is not a business or creator account", noParams), "no_business_account");
});

Deno.test("classifyOAuthError: scope names do not trigger business-account case", () => {
  assertEquals(classifyOAuthError("Invalid scope: instagram_business_basic", noParams), "1");
});

Deno.test("classifyOAuthError: restricted account", () => {
  assertEquals(classifyOAuthError("Sorry, this account is restricted. Complete the checkpoint to continue.", noParams), "account_restricted");
});

Deno.test("classifyOAuthError: rate limited", () => {
  assertEquals(classifyOAuthError("(#4) Application request limit reached", noParams), "rate_limited");
});

Deno.test("classifyOAuthError: unknown errors stay generic", () => {
  assertEquals(classifyOAuthError("Something exploded", noParams), "1");
  assertEquals(classifyOAuthError("", noParams), "1");
});

Deno.test("isAppConfigError: dev-mode and inactive app", () => {
  assertEquals(isAppConfigError("App is in development mode"), true);
  assertEquals(isAppConfigError("App not active"), true);
  assertEquals(isAppConfigError("Something exploded"), false);
});

Deno.test("classifyOAuthError: signed-state lifetime expiry", () => {
  assertEquals(classifyOAuthError("State expired", noParams), "state_expired");
});
