import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { corSegura, linkSeguro } from "../_shared/email/safe.ts";
import { BADGE_TONES, EMAIL } from "../_shared/email/tokens.ts";

function lum(hex: string): number {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((v) => (v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}
function ratio(a: string, b: string): number {
  const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m);
  return (x + 0.05) / (y + 0.05);
}

Deno.test("linkSeguro: accepts http(s), trims, rejects everything else", () => {
  assertEquals(linkSeguro(" https://a.test/x?y=1&z=2 "), "https://a.test/x?y=1&z=2");
  assertEquals(linkSeguro("http://a.test"), "http://a.test");
  for (const bad of ["javascript:alert(1)", "data:text/html,x", "", "   ", null, undefined, "https://a.test/\nx", "//a.test", "mailto:a@b.c"]) {
    assertEquals(linkSeguro(bad), null, `should reject ${JSON.stringify(bad)}`);
  }
});

Deno.test("corSegura: only #rrggbb, else the default yellow", () => {
  assertEquals(corSegura("#7C3AED"), "#7C3AED");
  for (const bad of ["red", "#fff", "#7c3aed;background:url(x)", "", null, undefined]) {
    assertEquals(corSegura(bad), "#eab308");
  }
});

Deno.test("text pairs reach 4.5:1 on their background", () => {
  const pairs: Array<[string, string, string]> = [
    ["ink on card", EMAIL.ink, EMAIL.card],
    ["text on card", EMAIL.text, EMAIL.card],
    ["muted on card", EMAIL.muted, EMAIL.card],
    ["muted on page", EMAIL.muted, EMAIL.page],
    ["text on callout", EMAIL.text, EMAIL.calloutBg],
    ["alert text on alert bg", EMAIL.alertText, EMAIL.alertBg],
    ["white on ink button", "#ffffff", EMAIL.ink],
    ["positive delta on card", EMAIL.positive, EMAIL.card],
    ["neutral delta on card", EMAIL.deltaNeutral, EMAIL.card],
  ];
  for (const t of Object.values(BADGE_TONES)) pairs.push(["badge", t.fg, t.bg]);
  for (const [name, fg, bg] of pairs) {
    assert(ratio(fg, bg) >= 4.5, `${name}: ${ratio(fg, bg).toFixed(2)} < 4.5`);
  }
});
