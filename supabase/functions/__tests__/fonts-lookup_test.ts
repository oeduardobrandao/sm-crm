import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { manifestFontLookup } from "../_shared/fonts/lookup.ts";
import { FONT_KEYS } from "../_shared/fonts/keys.ts";

Deno.test("allowedKeys returns every family key from the manifest, matching FONT_KEYS", () => {
  const keys = manifestFontLookup.allowedKeys();
  assertEquals(new Set(keys), new Set(FONT_KEYS));
});

Deno.test("hasVariant is true for a real (key, weight, style) combination", () => {
  assertEquals(manifestFontLookup.hasVariant("dm-sans", 400, "normal"), true);
  assertEquals(manifestFontLookup.hasVariant("dm-sans", 700, "normal"), true);
});

Deno.test("hasVariant is false for a weight the family doesn't ship", () => {
  assertEquals(manifestFontLookup.hasVariant("dm-sans", 900, "normal"), false);
});

Deno.test("hasVariant is false for an unknown font key", () => {
  assertEquals(manifestFontLookup.hasVariant("not-a-real-font", 400, "normal"), false);
});

Deno.test("variantsFor lists the real shipped variants for a known key", () => {
  const variants = manifestFontLookup.variantsFor("dm-sans");
  assertEquals(variants, [{ weight: 400, style: "normal" }, { weight: 700, style: "normal" }]);
});

Deno.test("variantsFor returns an empty array for an unknown key", () => {
  assertEquals(manifestFontLookup.variantsFor("not-a-real-font"), []);
});
