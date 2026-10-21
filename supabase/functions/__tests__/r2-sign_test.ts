// Pina o Content-Disposition do download de referências (post-references GET
// download_url): só com downloadName, RFC 5987, e sem mexer na URL comum.
import { assertEquals } from "./assert.ts";

Deno.env.set("R2_ACCOUNT_ID", "testaccount");
Deno.env.set("R2_ACCESS_KEY_ID", "testkey");
Deno.env.set("R2_SECRET_ACCESS_KEY", "testsecret");
Deno.env.set("R2_BUCKET", "test-bucket");

const { attachmentDisposition, signGetUrl, signPutUrl } = await import("../_shared/r2.ts");

Deno.test("attachmentDisposition: RFC 5987 ext-value, escapes ' ( ) * too", () => {
  assertEquals(
    attachmentDisposition("Relatório final (v2).pdf"),
    "attachment; filename*=UTF-8''Relat%C3%B3rio%20final%20%28v2%29.pdf",
  );
  assertEquals(attachmentDisposition("it's*.png"), "attachment; filename*=UTF-8''it%27s%2A.png");
});

Deno.test("signGetUrl: response-content-disposition only when downloadName is given", async () => {
  const plain = new URL(await signGetUrl("contas/c/files/a.pdf", 3600));
  assertEquals(plain.searchParams.get("response-content-disposition"), null);

  const dl = new URL(await signGetUrl("contas/c/files/a.pdf", 3600, "Relatório final (v2).pdf"));
  assertEquals(
    dl.searchParams.get("response-content-disposition"),
    "attachment; filename*=UTF-8''Relat%C3%B3rio%20final%20%28v2%29.pdf",
  );
  assertEquals(dl.searchParams.get("X-Amz-Expires"), "3600");
});

Deno.test("signPutUrl: binds the declared size as a signed Content-Length", async () => {
  const url = new URL(await signPutUrl("contas/c/files/a.png", "image/png", 5000));
  // Signed header, never hoisted to the query (R2 ignores hoisted headers).
  assertEquals(url.searchParams.get("X-Amz-SignedHeaders"), "content-length;host");
  assertEquals([...url.searchParams.keys()].some((k) => k.toLowerCase() === "content-length"), false);
  assertEquals(url.searchParams.get("X-Amz-Expires"), "900");
  const short = new URL(await signPutUrl("contas/c/files/a.png", "image/png", 5000, 300));
  assertEquals(short.searchParams.get("X-Amz-Expires"), "300");
});

Deno.test("signPutUrl: refuses a size that is not a positive integer", async () => {
  for (const bad of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
    let threw = false;
    try {
      await signPutUrl("contas/c/files/a.png", "image/png", bad);
    } catch {
      threw = true;
    }
    assertEquals(threw, true, `size ${bad} should throw`);
  }
});
