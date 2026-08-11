import { assert, assertEquals } from "./assert.ts";
import { buildPagarmeAuthHeader, PagarmeApiError } from "../_shared/pagarme.ts";

Deno.test("buildPagarmeAuthHeader produces correct Basic auth header", () => {
  // Test with a known secret key value
  const secretKey = "sk_test_12345";
  const header = buildPagarmeAuthHeader(secretKey);

  // Expected: "Basic " + base64("sk_test_12345:")
  // btoa("sk_test_12345:") should produce "c2tfdGVzdF8xMjM0NTo="
  const expected = "Basic c2tfdGVzdF8xMjM0NTo=";
  assertEquals(header, expected);

  // Verify structure
  assert(header.startsWith("Basic "), "Header must start with 'Basic '");
  assert(header.includes(btoa(secretKey + ":")), "Header must contain base64-encoded secret with colon");
});

Deno.test("buildPagarmeAuthHeader with different secret keys", () => {
  const key1 = "sk_live_abc123";
  const key2 = "sk_live_def456";

  const header1 = buildPagarmeAuthHeader(key1);
  const header2 = buildPagarmeAuthHeader(key2);

  // Different keys should produce different headers
  assert(header1 !== header2, "Different secret keys must produce different headers");

  // Both should start with "Basic "
  assert(header1.startsWith("Basic "), "Header 1 must start with 'Basic '");
  assert(header2.startsWith("Basic "), "Header 2 must start with 'Basic '");
});

Deno.test("PagarmeApiError preserves status and body", () => {
  const status = 400;
  const body = { errors: [{ message: "Invalid request" }] };

  const error = new PagarmeApiError(status, body);

  assertEquals(error.status, status);
  assertEquals(error.body, body);
  assertEquals(error.name, "PagarmeApiError");
  assertEquals(error instanceof Error, true);
});

Deno.test("PagarmeApiError message does not include the body or secret", () => {
  const status = 401;
  const body = { error: "Unauthorized" };

  const error = new PagarmeApiError(status, body);

  // Message should only contain status, not the body
  assert(error.message.includes("401"), "Message should include the status code");
  assert(error.message.includes("Pagar.me API error"), "Message should identify Pagar.me API error");

  // Should NOT include the full body in the message
  assert(!error.message.includes("Unauthorized"), "Message should not include body details");
});

Deno.test("PagarmeApiError with null body", () => {
  const status = 500;
  const body = null;

  const error = new PagarmeApiError(status, body);

  assertEquals(error.status, status);
  assertEquals(error.body, null);
  assert(error.message.includes("500"), "Message should include the status code");
});

Deno.test("buildPagarmeAuthHeader edge case: empty secret", () => {
  // Edge case: empty string secret (not a real scenario, but tests the encoding)
  const header = buildPagarmeAuthHeader("");
  const expected = "Basic " + btoa(":");
  assertEquals(header, expected);
  assert(header.startsWith("Basic "), "Header must start with 'Basic '");
});
