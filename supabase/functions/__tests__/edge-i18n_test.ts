import { assertEquals, assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { formatDate, formatMoney, intlLocale, resolveLang } from "../_shared/i18n/lang.ts";
import { ownerLang, workspaceLang } from "../_shared/i18n/workspace-lang.ts";
import { defineCatalog } from "../_shared/i18n/catalog.ts";
import { brandedEmail, mesaasEmail } from "../_shared/email/shell.ts";

const fixture = (n: string) => Deno.readTextFileSync(new URL(`./fixtures/${n}`, import.meta.url));

const mesaasInput = {
  preheader: "Pre",
  eyebrow: "Aviso",
  sections: ["<p>Oi</p>", "<p>Dois</p>"],
  footerLines: ["Linha 1"],
  footerHtml: ['<a href="https://x.y">x</a>'],
};
const brandedInput = {
  preheader: "Pre",
  workspaceName: "Agencia",
  brandColor: "#112233",
  logoUrl: "https://x.y/l.png",
  sections: ["<p>Oi</p>"],
  footerHtml: ["<i>f</i>"],
};

Deno.test("resolveLang_unknown_is_pt", () => {
  for (const v of [undefined, null, "es", "EN", 1, {}]) assertEquals(resolveLang(v), "pt");
  assertEquals(resolveLang("en"), "en");
  assertEquals(resolveLang("pt"), "pt");
});

Deno.test("intlLocale", () => {
  assertEquals(intlLocale("pt"), "pt-BR");
  assertEquals(intlLocale("en"), "en-US");
});

Deno.test("formatMoney", () => {
  assertEquals(formatMoney(12345, "usd", "en"), "$123.45");
  assertEquals(
    formatMoney(12345, "brl", "pt"),
    new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(123.45),
  );
});

Deno.test("formatDate default time zone per language", () => {
  const iso = "2026-03-01T02:30:00Z"; // Feb 28 in both zones
  assertEquals(formatDate(iso, "pt"), "28/02/2026");
  assertEquals(formatDate(iso, "en"), "2/28/2026");
  assertEquals(formatDate("2026-03-01T12:00:00Z", "en", { timeZone: "UTC" }), "3/1/2026");
});

function dbWith(result: { data?: unknown; error?: unknown }) {
  const calls: unknown[] = [];
  const chain: Record<string, unknown> = {};
  const self = new Proxy(chain, {
    get(_t, prop) {
      if (prop === "then") return (res: (v: unknown) => void) => res(result);
      return (...args: unknown[]) => {
        calls.push([prop, ...args]);
        return self;
      };
    },
  });
  return { db: { from: () => self }, calls };
}

Deno.test("workspaceLang reads the column", async () => {
  const { db } = dbWith({ data: { language: "en" }, error: null });
  assertEquals(await workspaceLang(db, "c1"), "en");
});

Deno.test("workspaceLang falls back to pt on db error", async () => {
  const { db } = dbWith({ data: null, error: { message: "boom" } });
  assertEquals(await workspaceLang(db, "c1"), "pt");
});

Deno.test("workspaceLang falls back to pt on throw or missing row", async () => {
  assertEquals(await workspaceLang({ from: () => { throw new Error("x"); } }, "c1"), "pt");
  const { db } = dbWith({ data: null, error: null });
  assertEquals(await workspaceLang(db, "c1"), "pt");
});

Deno.test("ownerLang picks the oldest owned workspace", async () => {
  const { db } = dbWith({
    data: [
      { workspaces: { created_at: "2026-05-01T00:00:00Z", language: "pt" } },
      { workspaces: { created_at: "2026-01-01T00:00:00Z", language: "en" } },
      { workspaces: { created_at: "2026-03-01T00:00:00Z", language: "pt" } },
    ],
    error: null,
  });
  assertEquals(await ownerLang(db, "u1"), "en");
});

Deno.test("ownerLang: none or error is pt", async () => {
  assertEquals(await ownerLang(dbWith({ data: [], error: null }).db, "u1"), "pt");
  assertEquals(await ownerLang(dbWith({ data: null, error: { message: "x" } }).db, "u1"), "pt");
});

Deno.test("defineCatalog picks by lang", () => {
  const c = defineCatalog({ pt: { a: "olá" }, en: { a: "hi" } });
  assertEquals(c("pt").a, "olá");
  assertEquals(c("en").a, "hi");
});

Deno.test("shell pt output unchanged", () => {
  assertEquals(mesaasEmail(mesaasInput), fixture("shell-pt-mesaas.html"));
  assertEquals(mesaasEmail({ ...mesaasInput, lang: "pt" }), fixture("shell-pt-mesaas.html"));
  assertEquals(brandedEmail(brandedInput), fixture("shell-pt-branded.html"));
});

Deno.test("shell lang en sets html lang en and tagline", () => {
  const html = mesaasEmail({ ...mesaasInput, lang: "en" });
  assertStringIncludes(html, '<html lang="en">');
  assertStringIncludes(html, "Mesaas · Management platform for social media agencies");
  assertEquals(html.includes("Plataforma de gestão"), false);
  assertStringIncludes(brandedEmail({ ...brandedInput, lang: "en" }), '<html lang="en">');
});
