import { assert, assertEquals } from "https://deno.land/std@0.208.0/assert/mod.ts";
import { signPrintToken, verifyPrintToken } from "./print-token.ts";

const SECRET = "test-secret";

Deno.test("round-trip: token assinado verifica para o mesmo docId dentro do prazo", async () => {
  const t = await signPrintToken("doc-1", 1_000_000, SECRET);
  assert(await verifyPrintToken(t, "doc-1", 999_999, SECRET));
});

Deno.test("expirado: exp <= now falha", async () => {
  const t = await signPrintToken("doc-1", 1_000_000, SECRET);
  assertEquals(await verifyPrintToken(t, "doc-1", 1_000_000, SECRET), false);
});

Deno.test("docId diferente falha", async () => {
  const t = await signPrintToken("doc-1", 1_000_000, SECRET);
  assertEquals(await verifyPrintToken(t, "doc-2", 1, SECRET), false);
});

Deno.test("assinatura adulterada falha", async () => {
  const t = await signPrintToken("doc-1", 1_000_000, SECRET);
  const [payload] = t.split(".");
  assertEquals(await verifyPrintToken(`${payload}.AAAA`, "doc-1", 1, SECRET), false);
});

Deno.test("payload adulterado falha", async () => {
  const t = await signPrintToken("doc-1", 1_000_000, SECRET);
  const sig = t.split(".")[1];
  const forged = btoa(JSON.stringify({ docId: "doc-1", exp: 9_999_999_999 }))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  assertEquals(await verifyPrintToken(`${forged}.${sig}`, "doc-1", 1, SECRET), false);
});

Deno.test("segredo diferente falha", async () => {
  const t = await signPrintToken("doc-1", 1_000_000, SECRET);
  assertEquals(await verifyPrintToken(t, "doc-1", 1, "outro"), false);
});

Deno.test("malformado (sem ponto, base64 inválido) devolve false sem lançar", async () => {
  assertEquals(await verifyPrintToken("garbage", "doc-1", 1, SECRET), false);
  assertEquals(await verifyPrintToken("a.b", "doc-1", 1, SECRET), false);
  assertEquals(await verifyPrintToken(".", "doc-1", 1, SECRET), false);
});
