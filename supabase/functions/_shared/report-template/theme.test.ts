import { assertEquals } from "https://deno.land/std@0.208.0/assert/mod.ts";
import { resolveAccent } from "./theme.ts";

Deno.test("resolveAccent: missing/invalid → neutral ink", () => {
  assertEquals(resolveAccent(null), { acc: "#171717", accFg: "#ffffff" });
  assertEquals(resolveAccent("banana"), { acc: "#171717", accFg: "#ffffff" });
  assertEquals(resolveAccent("#fff"), { acc: "#171717", accFg: "#ffffff" }); // only 6-digit hex
});

Deno.test("resolveAccent: too-light brand clamps to ink on light surface", () => {
  assertEquals(resolveAccent("#FFFDF0").acc, "#171717");
});

Deno.test("resolveAccent: dark brand kept, white foreground", () => {
  assertEquals(resolveAccent("#7C2D12"), { acc: "#7C2D12", accFg: "#ffffff" });
});

Deno.test("resolveAccent: light-ish brand kept, ink foreground", () => {
  // luminance between 0.55 and 0.85 → keep hue, dark text on it
  assertEquals(resolveAccent("#FFBF30"), { acc: "#FFBF30", accFg: "#171717" });
});
