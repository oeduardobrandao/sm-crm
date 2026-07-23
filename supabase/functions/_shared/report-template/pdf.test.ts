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

Deno.test("Gotenberg request honours the template's 795x1123px page box", () => {
  const { formData } = buildGotenbergRequest("<html></html>", "http://gotenberg:3000");

  // preferCssPageSize makes the template's @page the layout viewport. The
  // template declares 795x1123px — just past the sheet Gotenberg actually
  // emits (794.56x1122.56px, pinned regardless of request) — so every page
  // paints edge to edge and the sheet clips the overhang. Without the flag
  // the viewport is the floored sheet width and an unpaintable seam shows
  // beside the full-bleed ink cover.
  assertEquals(formData.get("preferCssPageSize"), "true");

  // Fallback paper size: never smaller than the 210.34x297.13mm page box (a
  // shorter sheet leaves body colour along the cover's bottom edge); not much
  // taller either, or the page box spills onto a blank sheet.
  const mm = (inches: string) => Number(inches) * 25.4;
  const width = mm(formData.get("paperWidth") as string);
  const height = mm(formData.get("paperHeight") as string);
  assertEquals(width >= 210.344, true);
  assertEquals(height >= 297.128, true);
  assertEquals(width < 210.9, true);
  assertEquals(height < 297.5, true);

  // Zero margins: the .page box owns all its own padding.
  for (const side of ["marginTop", "marginBottom", "marginLeft", "marginRight"]) {
    assertEquals(formData.get(side), "0");
  }
});
