import { assert, assertEquals } from "https://deno.land/std@0.208.0/assert/mod.ts";
import { buildGotenbergUrlRequest } from "./pdf-url.ts";

Deno.test("convert/url: endpoint, url alvo e waitForExpression de prontidão", () => {
  const { url, formData } = buildGotenbergUrlRequest("https://x.test/relatorios/print/d1?pt=t", "https://g.test");
  assertEquals(url, "https://g.test/forms/chromium/convert/url");
  assertEquals(formData.get("url"), "https://x.test/relatorios/print/d1?pt=t");
  assertEquals(formData.get("waitForExpression"), "window.__REPORT_READY === true");
  assertEquals(formData.get("printBackground"), "true");
  // A4 explícito: o default do chromium é Letter.
  assertEquals(formData.get("paperWidth"), "8.27");
  assertEquals(formData.get("paperHeight"), "11.7");
  assert(formData.get("marginTop") !== null);
});
