import { assertEquals } from "./assert.ts";
import { sanitizeZipPath } from "../file-zip/utils.ts";
import { UUID_RE } from "../instagram-analytics/utils.ts";
import { shouldRevokeOnError } from "../instagram-refresh-cron/utils.ts";

// ─── sanitizeZipPath ──────────────────────────────────────────

Deno.test("sanitizeZipPath: strips path traversal sequences", () => {
  assertEquals(sanitizeZipPath("../../etc/passwd"), "_/_/etc/passwd");
});

Deno.test("sanitizeZipPath: strips null bytes", () => {
  assertEquals(sanitizeZipPath("file\0name.txt"), "filename.txt");
});

Deno.test("sanitizeZipPath: strips leading slashes", () => {
  assertEquals(sanitizeZipPath("/etc/shadow"), "etc/shadow");
});

Deno.test("sanitizeZipPath: normalizes backslashes", () => {
  assertEquals(sanitizeZipPath("dir\\file.txt"), "dir/file.txt");
});

Deno.test("sanitizeZipPath: leaves clean paths unchanged", () => {
  assertEquals(sanitizeZipPath("folder/photo.jpg"), "folder/photo.jpg");
});

// ─── UUID_RE ──────────────────────────────────────────────────

Deno.test("UUID_RE: matches valid UUID", () => {
  assertEquals(UUID_RE.test("a1b2c3d4-e5f6-7890-abcd-ef1234567890"), true);
});

Deno.test("UUID_RE: rejects numeric ID", () => {
  assertEquals(UUID_RE.test("12345"), false);
});

Deno.test("UUID_RE: rejects partial UUID", () => {
  assertEquals(UUID_RE.test("abc-123"), false);
});

Deno.test("UUID_RE: rejects empty string", () => {
  assertEquals(UUID_RE.test(""), false);
});

// ─── shouldRevokeOnError ──────────────────────────────────────

Deno.test("shouldRevokeOnError: code 190 (expired token) triggers revoke", () => {
  assertEquals(shouldRevokeOnError(190), true);
});

Deno.test("shouldRevokeOnError: code 10 (permission revoked) triggers revoke", () => {
  assertEquals(shouldRevokeOnError(10), true);
});

Deno.test("shouldRevokeOnError: code 4 (rate limit) does not trigger revoke", () => {
  assertEquals(shouldRevokeOnError(4), false);
});

Deno.test("shouldRevokeOnError: code 2 (temporary error) does not trigger revoke", () => {
  assertEquals(shouldRevokeOnError(2), false);
});

Deno.test("shouldRevokeOnError: undefined code does not trigger revoke", () => {
  assertEquals(shouldRevokeOnError(undefined), false);
});
