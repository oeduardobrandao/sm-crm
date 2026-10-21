import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { brandedEmail, MESAAS_TAGLINE, mesaasEmail } from "../_shared/email/shell.ts";

const m = mesaasEmail({ preheader: "Prévia <b>", eyebrow: "Convite", sections: ["<p>A</p>", "<p>B</p>"], footerLines: ["Motivo <x>"] });
const b = brandedEmail({ preheader: "Prévia", workspaceName: "Agência <Lume>", brandColor: "#7c3aed", logoUrl: "javascript:alert(1)", sections: ["<p>A</p>"], footerHtml: ["Enviado por X via Mesaas"] });

Deno.test("both shells: light scheme pinned, 560 card, explicit backgrounds, mobile css, no em-dash", () => {
  for (const h of [m, b]) {
    assert(h.startsWith("<!DOCTYPE html>"));
    assert(h.includes(`<meta name="color-scheme" content="light">`));
    assert(h.includes(`<meta name="supported-color-schemes" content="light">`));
    assert(h.includes(`width="560"`) && h.includes("max-width: 560px"));
    assert(h.includes(`bgcolor="#f5f6f8"`) && h.includes(`bgcolor="#ffffff"`));
    assert(h.includes("@media (max-width: 600px)"));
    assert(!h.includes("—"));
    assert(!/display:\s*(flex|grid)/.test(h));
  }
});

Deno.test("mesaasEmail: logo with styled alt, eyebrow, escaped preheader and footer, tagline", () => {
  assert(m.includes(`src="https://www.mesaas.com.br/logo-black-email.png"`));
  assert(m.includes(`alt="Mesaas"`) && /alt="Mesaas"[^>]*font-weight: 700/.test(m), "alt must be styled for blocked images");
  assert(m.includes("Convite"));
  assert(m.includes("Prévia &lt;b&gt;") && m.includes("Motivo &lt;x&gt;"));
  assert(m.includes(MESAAS_TAGLINE));
  assert(!m.includes("gestão inteligente"));
  assertEquals((m.match(/<p>A<\/p>/g) ?? []).length, 1);
});

Deno.test("brandedEmail: brand band kept, unsafe logo dropped, bad colour defaulted, no Mesaas logo", () => {
  assert(b.includes("background: #7c3aed"), "brand band colour missing");
  assert(b.includes("Agência &lt;Lume&gt;"));
  assert(!b.includes("javascript:"), "unsafe logo leaked");
  assert(!b.includes("logo-black-email.png"));
  const bad = brandedEmail({ preheader: "p", workspaceName: "W", brandColor: "nope", logoUrl: null, sections: [], footerHtml: [] });
  assert(bad.includes("background: #eab308"));
  assert(!b.includes("box-shadow"), "card shadow should be gone");
});
