import { assertEquals } from "https://deno.land/std@0.208.0/assert/mod.ts";
import { buildGotenbergRequest } from "./pdf.ts";

Deno.test("buildGotenbergRequest creates correct FormData", () => {
  const { url, formData } = buildGotenbergRequest(
    "<html><body>Hello</body></html>",
    "http://gotenberg:3000",
  );
  assertEquals(url, "http://gotenberg:3000/forms/chromium/convert/html");
  assertEquals(formData instanceof FormData, true);
  assertEquals(formData.has("files"), true);
});

Deno.test("Gotenberg sheet matches the template's 794x1123px page box", () => {
  const { formData } = buildGotenbergRequest("<html></html>", "http://gotenberg:3000");

  // The template's @page is sized in integer CSS pixels so the sheet and
  // Chromium's whole-pixel layout viewport coincide — without this flag the
  // sheet is 794.56px and the floored-out 0.56px shows as a body-colour seam
  // beside the full-bleed ink cover.
  assertEquals(formData.get("preferCssPageSize"), "true");

  // Fallback paper size: never smaller than the 210.06x297.13mm page box (a
  // shorter sheet leaves body colour along the cover's bottom edge); not much
  // taller either, or the page box spills onto a blank sheet.
  const mm = (inches: string) => Number(inches) * 25.4;
  const width = mm(formData.get("paperWidth") as string);
  const height = mm(formData.get("paperHeight") as string);
  assertEquals(width >= 210.061, true);
  assertEquals(height >= 297.128, true);
  assertEquals(width < 210.5, true);
  assertEquals(height < 297.5, true);

  // Zero margins: the .page box owns all its own padding.
  for (const side of ["marginTop", "marginBottom", "marginLeft", "marginRight"]) {
    assertEquals(formData.get(side), "0");
  }
});
