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

Deno.test("Gotenberg sheet is never smaller than the template's 210x297mm page box", () => {
  const { formData } = buildGotenbergRequest("<html></html>", "http://gotenberg:3000");
  const mm = (inches: string) => Number(inches) * 25.4;
  const width = mm(formData.get("paperWidth") as string);
  const height = mm(formData.get("paperHeight") as string);

  // A sheet SHORTER than the page box leaves the body colour showing along the
  // bottom of the full-bleed cover; a sheet much TALLER wastes a margin and a
  // page box taller than the sheet spills onto a blank one. Keep it just over.
  assertEquals(width >= 210, true);
  assertEquals(height >= 297, true);
  assertEquals(width < 210.5, true);
  assertEquals(height < 297.5, true);

  // Zero margins: the .page box owns all its own padding.
  for (const side of ["marginTop", "marginBottom", "marginLeft", "marginRight"]) {
    assertEquals(formData.get(side), "0");
  }
});
