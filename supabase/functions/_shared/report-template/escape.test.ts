import { assertEquals } from "https://deno.land/std@0.208.0/assert/mod.ts";
import { escapeHtml } from "./escape.ts";

Deno.test("escapes HTML special characters", () => {
  assertEquals(escapeHtml('<script>alert("xss")</script>'), '&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;');
});

Deno.test("escapes ampersands", () => {
  assertEquals(escapeHtml("Tom & Jerry"), "Tom &amp; Jerry");
});

Deno.test("escapes single quotes", () => {
  assertEquals(escapeHtml("it's"), "it&#39;s");
});

Deno.test("returns empty string for null/undefined", () => {
  assertEquals(escapeHtml(null as unknown as string), "");
  assertEquals(escapeHtml(undefined as unknown as string), "");
});

Deno.test("does not double-escape already-escaped entities", () => {
  assertEquals(escapeHtml("&amp;"), "&amp;amp;");
});
