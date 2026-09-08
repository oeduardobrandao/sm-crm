import { assertEquals, assertStringIncludes, assert } from "jsr:@std/assert";
import {
  pickHeaderTextColor, buildBrandHeaderBand, buildPreheader, formatCompactPtBr,
} from "../_shared/report-template/brand-header.ts";

Deno.test("pickHeaderTextColor: escura -> branco, pálida -> escuro", () => {
  assertEquals(pickHeaderTextColor("#e11d48"), "#ffffff");
  assertEquals(pickHeaderTextColor("#1a3d2b"), "#ffffff");
  assertEquals(pickHeaderTextColor("#fef3c7"), "#171717");
});
Deno.test("pickHeaderTextColor: default #eab308 -> ESCURO (âncora, lum ~0.70)", () => {
  assertEquals(pickHeaderTextColor("#eab308"), "#171717");
});
Deno.test("pickHeaderTextColor: hex maiúsculo aceito", () => {
  assertEquals(pickHeaderTextColor("#FEF3C7"), "#171717");
});
Deno.test("band: fundo é sempre literalmente a brandColor; nunca flex", () => {
  const html = buildBrandHeaderBand({ workspaceName: "DK", brandColor: "#fef3c7", logoUrl: null });
  assertStringIncludes(html, "background: #fef3c7");
  assert(!html.includes("display: flex") && !html.includes("display:flex"));
});
Deno.test("band: avatar sse logoUrl; alt vazio; nome sempre presente", () => {
  const sem = buildBrandHeaderBand({ workspaceName: "DK", brandColor: "#e11d48", logoUrl: null });
  const com = buildBrandHeaderBand({ workspaceName: "DK", brandColor: "#e11d48", logoUrl: "https://x/l.png" });
  assert(!sem.includes("<img"));
  assertStringIncludes(com, 'alt=""');
  assertStringIncludes(com, "https://x/l.png");
  for (const h of [sem, com]) assertStringIncludes(h, "DK");
});
Deno.test("band: nome/logoUrl hostis saem escapados", () => {
  const h = buildBrandHeaderBand({
    workspaceName: '<script>x</script>"&', brandColor: "#e11d48",
    logoUrl: 'https://x/"onerror="a',
  });
  assert(!h.includes("<script>"));
  assert(!h.includes('"onerror="'));
});
Deno.test("preheader: contém o texto, oculto, com enchimento", () => {
  const p = buildPreheader("Visualizações +18% em agosto.");
  assertStringIncludes(p, "Visualizações +18% em agosto.");
  assertStringIncludes(p, "display:none");
  assertStringIncludes(p, "&zwnj;");
});
Deno.test("formatCompactPtBr", () => {
  assertEquals(formatCompactPtBr(48200), "48,2 mil");
  assertEquals(formatCompactPtBr(1240), "1.240");
  assertEquals(formatCompactPtBr(312), "312");
  assertEquals(formatCompactPtBr(1200000), "1,2 mi");
});
