// supabase/functions/__tests__/r2-copy_test.ts
// Pina o contrato de cópia assinada do R2 (copyObjectSigned/trashObject):
// x-amz-copy-source ASSINADO na URL e ENVIADO como header no fetch, e um 200
// sem <CopyObjectResult> no corpo (o R2 tratou como PUT vazio — bug do trash
// 0-byte de 2026-08→09) precisa falhar alto em vez de "dar certo".
import { assert, assertEquals, assertRejects, assertStringIncludes } from "jsr:@std/assert";

Deno.env.set("R2_ACCOUNT_ID", "testaccount");
Deno.env.set("R2_ACCESS_KEY_ID", "testkey");
Deno.env.set("R2_SECRET_ACCESS_KEY", "testsecret");
Deno.env.set("R2_BUCKET", "test-bucket");

const { copyObjectSigned, trashObject } = await import("../_shared/r2.ts");

const COPY_OK_XML =
  `<?xml version="1.0" encoding="UTF-8"?><CopyObjectResult><ETag>"abc"</ETag></CopyObjectResult>`;

interface CapturedRequest {
  url: URL;
  method: string;
  headers: Headers;
}

function withFetchStub(
  respond: (req: CapturedRequest) => Response,
): { calls: CapturedRequest[]; restore: () => void } {
  const calls: CapturedRequest[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = ((input: Request | URL | string, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    const req: CapturedRequest = {
      url,
      method: init?.method ?? (input instanceof Request ? input.method : "GET"),
      headers: new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined)),
    };
    calls.push(req);
    return Promise.resolve(respond(req));
  }) as typeof fetch;
  return { calls, restore: () => (globalThis.fetch = original) };
}

Deno.test("copyObjectSigned assina x-amz-copy-source e o envia como header", async () => {
  const { calls, restore } = withFetchStub(() => new Response(COPY_OK_XML, { status: 200 }));
  try {
    await copyObjectSigned("tmp/a/b.png", "final/a/b.png");
  } finally {
    restore();
  }
  assertEquals(calls.length, 1);
  const req = calls[0];
  assertEquals(req.method, "PUT");
  // Header presente e apontando para a origem dentro do bucket.
  const headerVal = req.headers.get("x-amz-copy-source");
  assert(headerVal, "x-amz-copy-source deve ir como header no fetch");
  assertStringIncludes(headerVal!, "test-bucket/tmp/a/b.png");
  // E assinado: SignedHeaders da URL inclui o header; a query NÃO carrega o
  // copy-source (a forma hoistada é a que o R2 ignora silenciosamente).
  assertStringIncludes(
    req.url.searchParams.get("X-Amz-SignedHeaders") ?? "",
    "x-amz-copy-source",
  );
  assertEquals(req.url.searchParams.get("x-amz-copy-source"), null);
});

Deno.test("copyObjectSigned lança em 200 sem <CopyObjectResult> (PUT vazio disfarçado)", async () => {
  const { restore } = withFetchStub(() => new Response("", { status: 200 }));
  try {
    await assertRejects(
      () => copyObjectSigned("tmp/a/b.png", "final/a/b.png"),
      Error,
      "r2 copy failed",
    );
  } finally {
    restore();
  }
});

Deno.test("copyObjectSigned lança em status de erro com o corpo no diagnóstico", async () => {
  const { restore } = withFetchStub(() =>
    new Response("<Error><Code>SignatureDoesNotMatch</Code></Error>", { status: 403 })
  );
  try {
    await assertRejects(
      () => copyObjectSigned("tmp/a/b.png", "final/a/b.png"),
      Error,
      "SignatureDoesNotMatch",
    );
  } finally {
    restore();
  }
});

Deno.test("trashObject copia com header assinado e só então deleta o original", async () => {
  const { calls, restore } = withFetchStub((req) =>
    req.method === "PUT" ? new Response(COPY_OK_XML, { status: 200 }) : new Response(null, { status: 204 })
  );
  try {
    await trashObject("post-media/x/y.png");
  } finally {
    restore();
  }
  assertEquals(calls.map((c) => c.method), ["PUT", "DELETE"]);
  assert(calls[0].headers.get("x-amz-copy-source"));
  assertStringIncludes(calls[0].url.pathname, "/trash/post-media/x/y.png");
  assertStringIncludes(calls[1].url.pathname, "/post-media/x/y.png");
});

Deno.test("trashObject NÃO deleta o original quando a cópia degenerou em PUT vazio", async () => {
  const { calls, restore } = withFetchStub(() => new Response("", { status: 200 }));
  try {
    await assertRejects(() => trashObject("post-media/x/y.png"), Error, "r2 trash copy failed");
  } finally {
    restore();
  }
  assertEquals(calls.map((c) => c.method), ["PUT"]);
});

Deno.test("trashObject segue para o delete quando a origem já sumiu (404)", async () => {
  const { calls, restore } = withFetchStub((req) =>
    req.method === "PUT"
      ? new Response("<Error><Code>NoSuchKey</Code></Error>", { status: 404 })
      : new Response(null, { status: 204 })
  );
  try {
    await trashObject("post-media/x/y.png");
  } finally {
    restore();
  }
  assertEquals(calls.map((c) => c.method), ["PUT", "DELETE"]);
});
