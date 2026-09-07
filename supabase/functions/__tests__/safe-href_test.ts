import { assert } from "./assert.ts";
import { isSafeHref } from "../_shared/safe-href.ts";

Deno.test("isSafeHref: relativo, https, http opcional, rejeita //, /\\, controle/espaço e vazio", () => {
  assert(isSafeHref("/ajuda"));
  assert(isSafeHref("https://x.y/z"));
  assert(!isSafeHref("http://x.y"));
  assert(isSafeHref("http://x.y", { allowHttp: true }));
  assert(!isSafeHref("//evil"));
  assert(!isSafeHref("/\\evil.com"));
  assert(!isSafeHref("/\t\\evil.com"));
  assert(!isSafeHref("/a b"));
  assert(!isSafeHref("https://x.y/\n"));
  assert(!isSafeHref(""));
  assert(!isSafeHref("javascript:alert(1)"));
  assert(!isSafeHref("/" + "x".repeat(2048)));
});
