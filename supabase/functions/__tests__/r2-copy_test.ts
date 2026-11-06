// supabase/functions/__tests__/r2-copy_test.ts
// Pina o contrato de cópia assinada do R2 (copyObjectSigned/trashObject):
// x-amz-copy-source ASSINADO na URL e ENVIADO como header no fetch, e um 200
// sem <CopyObjectResult> no corpo (o R2 tratou como PUT vazio — bug do trash
// 0-byte de 2026-08→09) precisa falhar alto em vez de "dar certo".
// Objetos acima de SINGLE_COPY_MAX_BYTES vão por cópia multipart (UploadPartCopy
// em faixas): uma CopyObject única de um .mp4 de 679 MB estourou o timeout de 30s
// em toda tentativa e mandou a linha 2526 de file_deletions para a dead-letter
// (prod 2026-10-28).
import { assert, assertEquals, assertRejects, assertStringIncludes } from "jsr:@std/assert";

Deno.env.set("R2_ACCOUNT_ID", "testaccount");
Deno.env.set("R2_ACCESS_KEY_ID", "testkey");
Deno.env.set("R2_SECRET_ACCESS_KEY", "testsecret");
Deno.env.set("R2_BUCKET", "test-bucket");

const { copyObjectSigned, copyPartRanges, COPY_PART_BYTES, SINGLE_COPY_MAX_BYTES, trashObject } =
  await import("../_shared/r2.ts");

const COPY_OK_XML =
  `<?xml version="1.0" encoding="UTF-8"?><CopyObjectResult><ETag>"abc"</ETag></CopyObjectResult>`;

interface CapturedRequest {
  url: URL;
  method: string;
  headers: Headers;
  body?: string;
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
      body: typeof init?.body === "string" ? init.body : undefined,
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
  // HEAD para decidir entre cópia única e multipart; sem content-length = cópia única.
  assertEquals(calls.map((c) => c.method), ["HEAD", "PUT"]);
  const req = calls[1];
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
  assertEquals(calls.map((c) => c.method), ["HEAD", "PUT", "DELETE"]);
  assert(calls[1].headers.get("x-amz-copy-source"));
  assertStringIncludes(calls[1].url.pathname, "/trash/post-media/x/y.png");
  assertStringIncludes(calls[2].url.pathname, "/post-media/x/y.png");
});

Deno.test("trashObject NÃO deleta o original quando a cópia degenerou em PUT vazio", async () => {
  const { calls, restore } = withFetchStub(() => new Response("", { status: 200 }));
  try {
    await assertRejects(() => trashObject("post-media/x/y.png"), Error, "r2 trash copy failed");
  } finally {
    restore();
  }
  assertEquals(calls.map((c) => c.method), ["HEAD", "PUT"]);
});

Deno.test("trashObject segue para o delete quando a origem já sumiu (404)", async () => {
  const { calls, restore } = withFetchStub((req) =>
    req.method === "PUT" || req.method === "HEAD"
      ? new Response(req.method === "HEAD" ? null : "<Error><Code>NoSuchKey</Code></Error>", { status: 404 })
      : new Response(null, { status: 204 })
  );
  try {
    await trashObject("post-media/x/y.png");
  } finally {
    restore();
  }
  // HEAD 404 cai na cópia única, que é a resposta autoritativa (404 = já sumiu).
  assertEquals(calls.map((c) => c.method), ["HEAD", "PUT", "DELETE"]);
});

// ---- Cópia multipart (objetos grandes) ----

const BIG = 679_190_000; // o .mp4 da linha 2526
const BIG_KEY = "contas/c/files/v.mp4";

function multipartStub(opts: { size: number; failPart?: number; completeBody?: string }) {
  return withFetchStub((req) => {
    const q = req.url.searchParams;
    if (req.method === "HEAD") {
      return new Response(null, {
        status: 200,
        headers: { "content-length": String(opts.size), "content-type": "video/mp4" },
      });
    }
    if (req.method === "POST" && q.has("uploads")) {
      return new Response("<InitiateMultipartUploadResult><UploadId>up-1</UploadId></InitiateMultipartUploadResult>");
    }
    if (req.method === "PUT" && q.has("partNumber")) {
      const n = Number(q.get("partNumber"));
      if (n === opts.failPart) return new Response("<Error><Code>InternalError</Code></Error>", { status: 500 });
      return new Response(`<CopyPartResult><ETag>&quot;etag-${n}&quot;</ETag></CopyPartResult>`);
    }
    if (req.method === "POST" && q.has("uploadId")) {
      return new Response(
        opts.completeBody ?? "<CompleteMultipartUploadResult><ETag>x</ETag></CompleteMultipartUploadResult>",
      );
    }
    if (req.method === "DELETE") return new Response(null, { status: 204 });
    return new Response(COPY_OK_XML, { status: 200 });
  });
}

Deno.test("copyPartRanges cobre todos os bytes, partes iguais e a última menor", () => {
  const r = copyPartRanges(BIG);
  assertEquals(r.length, Math.ceil(BIG / COPY_PART_BYTES));
  assertEquals(r[0], [0, COPY_PART_BYTES - 1]);
  assertEquals(r[r.length - 1][1], BIG - 1);
  for (let i = 1; i < r.length; i++) assertEquals(r[i][0], r[i - 1][1] + 1);
});

Deno.test("objeto no limite usa a cópia única", async () => {
  const { calls, restore } = multipartStub({ size: SINGLE_COPY_MAX_BYTES });
  try {
    await trashObject(BIG_KEY);
  } finally {
    restore();
  }
  assertEquals(calls.map((c) => c.method), ["HEAD", "PUT", "DELETE"]);
});

Deno.test("trashObject de objeto grande: multipart com headers de cópia ASSINADOS, depois delete", async () => {
  const { calls, restore } = multipartStub({ size: BIG });
  try {
    await trashObject(BIG_KEY);
  } finally {
    restore();
  }
  const parts = calls.filter((c) => c.method === "PUT" && c.url.searchParams.has("partNumber"));
  assertEquals(parts.length, Math.ceil(BIG / COPY_PART_BYTES));
  for (const p of parts) {
    assertStringIncludes(p.url.pathname, `/trash/${BIG_KEY}`);
    assertStringIncludes(p.headers.get("x-amz-copy-source") ?? "", `test-bucket/${BIG_KEY}`);
    assert(p.headers.get("x-amz-copy-source-range")?.startsWith("bytes="));
    const signed = p.url.searchParams.get("X-Amz-SignedHeaders") ?? "";
    assertStringIncludes(signed, "x-amz-copy-source");
    assertStringIncludes(signed, "x-amz-copy-source-range");
    assertEquals(p.url.searchParams.get("x-amz-copy-source"), null);
  }
  const complete = calls.find((c) => c.method === "POST" && c.url.searchParams.has("uploadId"))!;
  assertEquals((complete.body!.match(/<Part>/g) ?? []).length, parts.length);
  assertStringIncludes(complete.body!, `<PartNumber>${parts.length}</PartNumber><ETag>&quot;etag-${parts.length}&quot;</ETag>`);
  // Nenhuma CopyObject única, e o original só é apagado no fim.
  assertEquals(calls.some((c) => c.method === "PUT" && !c.url.searchParams.has("partNumber")), false);
  const last = calls[calls.length - 1];
  assertEquals(last.method, "DELETE");
  assertEquals(last.url.searchParams.get("uploadId"), null);
  assertStringIncludes(last.url.pathname, `/${BIG_KEY}`);
});

Deno.test("parte com falha: aborta o upload, NÃO deleta o original e lança", async () => {
  const { calls, restore } = multipartStub({ size: BIG, failPart: 3 });
  try {
    await assertRejects(() => trashObject(BIG_KEY), Error, "r2 part copy 3/");
  } finally {
    restore();
  }
  const deletes = calls.filter((c) => c.method === "DELETE");
  assertEquals(deletes.length, 1);
  assertEquals(deletes[0].url.searchParams.get("uploadId"), "up-1");
  assertStringIncludes(deletes[0].url.pathname, `/trash/${BIG_KEY}`);
});

Deno.test("complete com 200 e corpo de erro é falha; original preservado", async () => {
  const { calls, restore } = multipartStub({
    size: BIG,
    completeBody: "<Error><Code>InternalError</Code></Error>",
  });
  try {
    await assertRejects(() => trashObject(BIG_KEY), Error, "r2 multipart complete failed");
  } finally {
    restore();
  }
  assertEquals(
    calls.some((c) => c.method === "DELETE" && c.url.searchParams.get("uploadId") === null),
    false,
  );
});
