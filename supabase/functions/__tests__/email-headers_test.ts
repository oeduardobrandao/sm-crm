import { assert, assertEquals } from "./assert.ts";
import { sanitizeFromName } from "../_shared/email-headers.ts";

Deno.test("sanitizeFromName: strips CR/LF and other control chars (header injection)", () => {
  const out = sanitizeFromName("Evil\r\nBcc: attacker@evil.test\x00\x7f");
  assert(!out.includes("\r"), "carriage return survived");
  assert(!out.includes("\n"), "newline survived");
  assert(!out.includes("\x00") && !out.includes("\x7f"), "control char survived");
  assertEquals(out, '"Evil Bcc: attacker@evil.test"');
});

Deno.test("sanitizeFromName: <, > and \" cannot forge a different address; always a quoted-string", () => {
  const out = sanitizeFromName('Forged" <attacker@evil.test> "');
  assertEquals(out, '"Forged\\" <attacker@evil.test> \\""');
  // Quotes inside are escaped, so the quoted-string spans the whole name and
  // the angle brackets stay literal text rather than starting an addr-spec.
  const unescapedQuotes = out.slice(1, -1).replace(/\\["\\]/g, "");
  assert(!unescapedQuotes.includes('"'), "unescaped quote inside the quoted-string");
});

Deno.test("sanitizeFromName: backslashes are escaped so they cannot neutralise the closing quote", () => {
  assertEquals(sanitizeFromName('Weird\\Co"'), '"Weird\\\\Co\\""');
});

Deno.test("sanitizeFromName: legitimate specials (comma, parens, &) survive verbatim", () => {
  assertEquals(sanitizeFromName("Silva, Souza & Cia (Oficial)"), '"Silva, Souza & Cia (Oficial)"');
});

Deno.test("sanitizeFromName: collapses whitespace, trims, and falls back to Mesaas when empty", () => {
  assertEquals(sanitizeFromName("  DK   Marketing\t Médico  "), '"DK Marketing Médico"');
  assertEquals(sanitizeFromName(""), '"Mesaas"');
  assertEquals(sanitizeFromName("   \r\n\t "), '"Mesaas"');
});
