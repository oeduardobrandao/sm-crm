// Pina o Content-Disposition do download de referências (post-references GET
// download_url): só com downloadName, RFC 5987, e sem mexer na URL comum.
import { assertEquals } from "./assert.ts";

Deno.env.set("R2_ACCOUNT_ID", "testaccount");
Deno.env.set("R2_ACCESS_KEY_ID", "testkey");
Deno.env.set("R2_SECRET_ACCESS_KEY", "testsecret");
Deno.env.set("R2_BUCKET", "test-bucket");

const { attachmentDisposition, signGetUrl } = await import("../_shared/r2.ts");

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
