import { assert, assertEquals } from "https://deno.land/std@0.208.0/assert/mod.ts";
import { exportReportPdf, PDF_RENDERER_VERSION, type PdfDeps } from "./pdf.ts";
import { DocActionError, PDF_BUCKET } from "./errors.ts";
import { verifyPrintToken } from "../_shared/report-docs/print-token.ts";

// Fake db própria deste arquivo (mesmo idioma de refresh.test.ts/delete-doc.test.ts):
// select().eq().maybeSingle() devolve `row`; update(patch) grava em db.updates.
function makeDb(row: Record<string, unknown> | null) {
  const updates: Record<string, unknown>[] = [];
  return {
    updates,
    from: (table: string) => {
      if (table !== "report_documents") throw new Error(`unexpected table ${table}`);
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: () => Promise.resolve({ data: row, error: null }),
          }),
        }),
        update: (patch: Record<string, unknown>) => {
          updates.push(patch);
          return { eq: () => Promise.resolve({ error: null }) };
        },
      };
    },
    // deno-lint-ignore no-explicit-any
  } as any;
}

// Storage fake: grava toda chamada de upload()/createSignedUrl() nos arrays
// abaixo. `signedUrl` configura a URL devolvida por createSignedUrl.
// `uploadError` faz upload() resolver com {error}. `signedUrlError` faz
// createSignedUrl() resolver com {error}; com `signedUrlFailFirst`, só a
// PRIMEIRA chamada falha (isola o sign do caminho de cache do sign final da
// regeneração -- ambos usam o mesmo mock).
function makeStorage(
  opts: {
    signedUrl?: string;
    signedUrlError?: { message: string } | null;
    signedUrlFailFirst?: boolean;
    uploadError?: { message: string } | null;
  } = {},
) {
  const uploadCalls: {
    bucket: string;
    path: string;
    body: Uint8Array;
    opts: { contentType: string; upsert: boolean };
  }[] = [];
  const signCalls: { bucket: string; path: string; ttl: number }[] = [];
  let signCallCount = 0;
  return {
    uploadCalls,
    signCalls,
    from: (bucket: string) => ({
      upload: (path: string, body: Uint8Array, o: { contentType: string; upsert: boolean }) => {
        uploadCalls.push({ bucket, path, body, opts: o });
        return Promise.resolve({ error: opts.uploadError ?? null });
      },
      createSignedUrl: (path: string, ttl: number) => {
        signCalls.push({ bucket, path, ttl });
        signCallCount++;
        const failThisCall = opts.signedUrlError &&
          (opts.signedUrlFailFirst ? signCallCount === 1 : true);
        if (failThisCall) return Promise.resolve({ data: null, error: opts.signedUrlError! });
        return Promise.resolve({
          data: { signedUrl: opts.signedUrl ?? `https://signed.test${path}` },
          error: null,
        });
      },
    }),
  };
}

// Spy de deps.convert: nunca toca rede, grava toda chamada em `.calls`.
function makeConvert(opts: { throws?: boolean; bytes?: Uint8Array } = {}) {
  const calls: { pageUrl: string; gotenbergUrl: string }[] = [];
  const convert = (pageUrl: string, gotenbergUrl: string) => {
    calls.push({ pageUrl, gotenbergUrl });
    if (opts.throws) return Promise.reject(new Error("gotenberg boom"));
    return Promise.resolve(opts.bytes ?? new Uint8Array([1, 2, 3]));
  };
  return { convert, calls };
}

const FIXED_NOW = new Date("2026-08-20T12:00:00.000Z");
const VALID_ENV = { gotenbergUrl: "https://g.test", printBase: "https://mesaas.test", internalSecret: "shh" };

Deno.test("doc de outro workspace: not_found", async () => {
  const db = makeDb({
    id: "d1", conta_id: "OUTRA", status: "ready", updated_at: "2026-08-01T00:00:00.000Z",
    pdf_storage_path: null, pdf_generated_at: null, pdf_renderer_version: null,
  });
  const { convert, calls } = makeConvert();
  const storage = makeStorage();
  const deps: PdfDeps = { convert, storage, now: () => FIXED_NOW, env: VALID_ENV };
  let err: unknown;
  try {
    await exportReportPdf(db, deps, "c", "d1");
  } catch (e) { err = e; }
  assert(err instanceof DocActionError && err.code === "not_found");
  assertEquals(calls.length, 0);
  assertEquals(db.updates.length, 0);
});

Deno.test("doc status != ready: not_found", async () => {
  const db = makeDb({
    id: "d1", conta_id: "c", status: "draft", updated_at: "2026-08-01T00:00:00.000Z",
    pdf_storage_path: null, pdf_generated_at: null, pdf_renderer_version: null,
  });
  const { convert, calls } = makeConvert();
  const storage = makeStorage();
  const deps: PdfDeps = { convert, storage, now: () => FIXED_NOW, env: VALID_ENV };
  let err: unknown;
  try {
    await exportReportPdf(db, deps, "c", "d1");
  } catch (e) { err = e; }
  assert(err instanceof DocActionError && err.code === "not_found");
  assertEquals(calls.length, 0);
});

Deno.test("env incompleta (gotenbergUrl vazio): pdf_not_configured, sem chamada de convert", async () => {
  const db = makeDb({
    id: "d1", conta_id: "c", status: "ready", updated_at: "2026-08-01T00:00:00.000Z",
    pdf_storage_path: null, pdf_generated_at: null, pdf_renderer_version: null,
  });
  const { convert, calls } = makeConvert();
  const storage = makeStorage();
  const deps: PdfDeps = {
    convert, storage, now: () => FIXED_NOW,
    env: { gotenbergUrl: "", printBase: "https://mesaas.test", internalSecret: "shh" },
  };
  let err: unknown;
  try {
    await exportReportPdf(db, deps, "c", "d1");
  } catch (e) { err = e; }
  assert(err instanceof DocActionError && err.code === "pdf_not_configured");
  assertEquals(calls.length, 0);
});

Deno.test("cache válido (pdf_generated_at >= updated_at e renderer version bate): retorna signed URL sem convert", async () => {
  const db = makeDb({
    id: "d1", conta_id: "c", status: "ready", updated_at: "2026-08-01T00:00:00.000Z",
    pdf_storage_path: "docs/c/d1.pdf", pdf_generated_at: "2026-08-02T00:00:00.000Z",
    pdf_renderer_version: PDF_RENDERER_VERSION,
  });
  const { convert, calls } = makeConvert();
  const storage = makeStorage({ signedUrl: "https://signed.test/docs/c/d1.pdf" });
  // Env deliberadamente vazio: o caminho de cache não deve nem olhar para ele.
  const deps: PdfDeps = { convert, storage, now: () => FIXED_NOW, env: { gotenbergUrl: "", printBase: "", internalSecret: "" } };
  const result = await exportReportPdf(db, deps, "c", "d1");
  assertEquals(result.url, "https://signed.test/docs/c/d1.pdf");
  assertEquals(calls.length, 0);
  assertEquals(storage.uploadCalls.length, 0);
  assertEquals(storage.signCalls.length, 1);
  assertEquals(storage.signCalls[0].bucket, PDF_BUCKET);
  assertEquals(storage.signCalls[0].path, "docs/c/d1.pdf");
  assertEquals(db.updates.length, 0);
});

Deno.test("cache inválido por updated_at mais novo: convert chamado, upload upsert, update grava pdf_*, retorna signed URL", async () => {
  const db = makeDb({
    id: "d1", conta_id: "c", status: "ready", updated_at: "2026-08-05T00:00:00.000Z",
    pdf_storage_path: "docs/c/d1.pdf", pdf_generated_at: "2026-08-02T00:00:00.000Z",
    pdf_renderer_version: PDF_RENDERER_VERSION,
  });
  const { convert, calls } = makeConvert({ bytes: new Uint8Array([9, 9, 9]) });
  const storage = makeStorage({ signedUrl: "https://signed.test/docs/c/d1.pdf" });
  const deps: PdfDeps = { convert, storage, now: () => FIXED_NOW, env: VALID_ENV };

  const result = await exportReportPdf(db, deps, "c", "d1");

  assertEquals(calls.length, 1);
  const call = calls[0];
  assertEquals(call.gotenbergUrl, VALID_ENV.gotenbergUrl);
  assert(call.pageUrl.startsWith(`${VALID_ENV.printBase}/relatorios/print/d1?pt=`));
  const token = decodeURIComponent(call.pageUrl.split("?pt=")[1]);
  const nowEpochS = Math.floor(FIXED_NOW.getTime() / 1000);
  assert(await verifyPrintToken(token, "d1", nowEpochS, VALID_ENV.internalSecret));

  assertEquals(storage.uploadCalls.length, 1);
  assertEquals(storage.uploadCalls[0].bucket, PDF_BUCKET);
  assertEquals(storage.uploadCalls[0].path, "docs/c/d1.pdf");
  assertEquals(storage.uploadCalls[0].opts.upsert, true);
  assertEquals(storage.uploadCalls[0].opts.contentType, "application/pdf");

  assertEquals(db.updates.length, 1);
  const patch = db.updates[0] as {
    pdf_storage_path?: unknown; pdf_generated_at?: unknown; pdf_renderer_version?: unknown;
  };
  assertEquals(patch.pdf_storage_path, "docs/c/d1.pdf");
  assertEquals(patch.pdf_renderer_version, PDF_RENDERER_VERSION);
  assertEquals(typeof patch.pdf_generated_at, "string");

  assertEquals(result.url, "https://signed.test/docs/c/d1.pdf");
});

Deno.test("cache inválido por pdf_renderer_version diferente: convert chamado", async () => {
  const db = makeDb({
    id: "d1", conta_id: "c", status: "ready", updated_at: "2026-08-01T00:00:00.000Z",
    pdf_storage_path: "docs/c/d1.pdf", pdf_generated_at: "2026-08-02T00:00:00.000Z",
    pdf_renderer_version: 0,
  });
  const { convert, calls } = makeConvert();
  const storage = makeStorage({ signedUrl: "https://signed.test/docs/c/d1.pdf" });
  const deps: PdfDeps = { convert, storage, now: () => FIXED_NOW, env: VALID_ENV };
  await exportReportPdf(db, deps, "c", "d1");
  assertEquals(calls.length, 1);
});

Deno.test("convert lança: DocActionError pdf_failed, nenhum update gravado", async () => {
  const db = makeDb({
    id: "d1", conta_id: "c", status: "ready", updated_at: "2026-08-01T00:00:00.000Z",
    pdf_storage_path: null, pdf_generated_at: null, pdf_renderer_version: null,
  });
  const { convert } = makeConvert({ throws: true });
  const storage = makeStorage();
  const deps: PdfDeps = { convert, storage, now: () => FIXED_NOW, env: VALID_ENV };
  const originalError = console.error;
  console.error = () => {};
  let err: unknown;
  try {
    await exportReportPdf(db, deps, "c", "d1");
  } catch (e) {
    err = e;
  } finally {
    console.error = originalError;
  }
  assert(err instanceof DocActionError && err.code === "pdf_failed");
  assertEquals(db.updates.length, 0);
  assertEquals(storage.uploadCalls.length, 0);
});

Deno.test("upload falha (regeneração, cache stale): pdf_failed, nenhum update gravado", async () => {
  const db = makeDb({
    id: "d1", conta_id: "c", status: "ready", updated_at: "2026-08-05T00:00:00.000Z",
    pdf_storage_path: "docs/c/d1.pdf", pdf_generated_at: "2026-08-02T00:00:00.000Z",
    pdf_renderer_version: PDF_RENDERER_VERSION,
  });
  const { convert, calls } = makeConvert();
  const storage = makeStorage({ uploadError: { message: "upload boom" } });
  const deps: PdfDeps = { convert, storage, now: () => FIXED_NOW, env: VALID_ENV };
  const originalError = console.error;
  console.error = () => {};
  let err: unknown;
  try {
    await exportReportPdf(db, deps, "c", "d1");
  } catch (e) {
    err = e;
  } finally {
    console.error = originalError;
  }
  assert(err instanceof DocActionError && err.code === "pdf_failed");
  // Cache estava stale (updated_at > pdf_generated_at): nada de sign de cache.
  assertEquals(calls.length, 1);
  assertEquals(storage.signCalls.length, 0);
  assertEquals(storage.uploadCalls.length, 1);
  assertEquals(db.updates.length, 0);
});

Deno.test("sign final falha após upload+update (regeneração, cache stale): pdf_failed, MAS metadata já foi gravada", async () => {
  const db = makeDb({
    id: "d1", conta_id: "c", status: "ready", updated_at: "2026-08-05T00:00:00.000Z",
    pdf_storage_path: "docs/c/d1.pdf", pdf_generated_at: "2026-08-02T00:00:00.000Z",
    pdf_renderer_version: PDF_RENDERER_VERSION,
  });
  const { convert, calls } = makeConvert();
  const storage = makeStorage({ signedUrlError: { message: "sign boom" } });
  const deps: PdfDeps = { convert, storage, now: () => FIXED_NOW, env: VALID_ENV };
  let err: unknown;
  try {
    await exportReportPdf(db, deps, "c", "d1");
  } catch (e) { err = e; }
  assert(err instanceof DocActionError && err.code === "pdf_failed");
  assertEquals(calls.length, 1);
  assertEquals(storage.uploadCalls.length, 1);
  // Cache stale => só o sign FINAL é chamado (nenhum sign de cache antes).
  assertEquals(storage.signCalls.length, 1);
  assertEquals(db.updates.length, 1);
  const patch = db.updates[0] as {
    pdf_storage_path?: unknown; pdf_generated_at?: unknown; pdf_renderer_version?: unknown;
  };
  assertEquals(patch.pdf_storage_path, "docs/c/d1.pdf");
  assertEquals(patch.pdf_renderer_version, PDF_RENDERER_VERSION);
  assertEquals(typeof patch.pdf_generated_at, "string");
});

Deno.test("cache fresco mas objeto sumiu do bucket: sign de cache falha, cai em regeneração e devolve URL fresca", async () => {
  const db = makeDb({
    id: "d1", conta_id: "c", status: "ready", updated_at: "2026-08-01T00:00:00.000Z",
    pdf_storage_path: "docs/c/d1.pdf", pdf_generated_at: "2026-08-02T00:00:00.000Z",
    pdf_renderer_version: PDF_RENDERER_VERSION,
  });
  const { convert, calls } = makeConvert();
  const storage = makeStorage({
    signedUrl: "https://signed.test/docs/c/d1.pdf",
    signedUrlError: { message: "objeto sumiu" },
    signedUrlFailFirst: true,
  });
  const deps: PdfDeps = { convert, storage, now: () => FIXED_NOW, env: VALID_ENV };

  const result = await exportReportPdf(db, deps, "c", "d1");

  assertEquals(result.url, "https://signed.test/docs/c/d1.pdf");
  // Convert só roda depois que o sign de cache falhou -- exatamente uma vez.
  assertEquals(calls.length, 1);
  assertEquals(storage.uploadCalls.length, 1);
  // Dois signs: o de cache (falhou) e o final da regeneração (deu certo).
  assertEquals(storage.signCalls.length, 2);
  assertEquals(db.updates.length, 1);
});
