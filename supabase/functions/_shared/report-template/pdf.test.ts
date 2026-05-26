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
