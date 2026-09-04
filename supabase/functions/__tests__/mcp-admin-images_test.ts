import { assert, assertEquals } from "./assert.ts";
import { finalizePopupImages, parseImageDims, uploadKbImage, uploadPopupImage, fillImageDims } from "../mcp-admin/images.ts";
import { CTX, expectInputError, has, makeDeps, makeFakeDb, PNG_10x5, rpcPayload } from "./mcp-admin-helpers.ts";

const u16be = (n: number) => [n >> 8, n & 0xff];
const GIF_300x200 = new Uint8Array([71, 73, 70, 56, 57, 97, 300 & 0xff, 300 >> 8, 200 & 0xff, 200 >> 8, 0, 0, 0]);
const JPEG_640x480 = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 4, 0, 0, 0xff, 0xc0, 0, 11, 8, ...u16be(480), ...u16be(640), 3, 0, 0, 0]);
const WEBP_VP8X_16x8 = new Uint8Array([82, 73, 70, 70, 0, 0, 0, 0, 87, 69, 66, 80, 86, 80, 56, 88, 10, 0, 0, 0, 0, 0, 0, 0, 15, 0, 0, 7, 0, 0]);

Deno.test("parseImageDims: PNG, GIF, JPEG (SOF0 após APP0), WebP VP8X; lixo → null", () => {
  assertEquals(parseImageDims(PNG_10x5), { width: 10, height: 5 });
  assertEquals(parseImageDims(GIF_300x200), { width: 300, height: 200 });
  assertEquals(parseImageDims(JPEG_640x480), { width: 640, height: 480 });
  assertEquals(parseImageDims(WEBP_VP8X_16x8), { width: 16, height: 8 });
  assertEquals(parseImageDims(new Uint8Array([1, 2, 3])), null);
  assertEquals(parseImageDims(new Uint8Array([0xff, 0xd8, 0xff])), null);
});

Deno.test("uploadKbImage modo A: baixa com segurança, grava no bucket kb-images e devolve URL pública + dims", async () => {
  const { db, storageCalls } = makeFakeDb({});
  const r = await uploadKbImage(makeDeps(db), { filename: "Tela Inicial.PNG", mime_type: "image/png", source_url: "https://cdn.x/y.png", article_slug: "primeiro-post" });
  assertEquals(r, {
    path: "primeiro-post/00000001-tela-inicial.png",
    public_url: "https://sb/storage/v1/object/public/kb-images/primeiro-post/00000001-tela-inicial.png",
    width: 10, height: 5, size_bytes: PNG_10x5.byteLength,
  });
  assertEquals(storageCalls[0].method, "upload");
  assertEquals(storageCalls[0].args[2], { contentType: "image/png", upsert: false });
});

Deno.test("uploadKbImage modo A: extensão vem do sniff, não do mime declarado; falha de fetch → McpInputError", async () => {
  const { db } = makeFakeDb({});
  const r = await uploadKbImage(makeDeps(db), { filename: "x", mime_type: "image/jpeg", source_url: "https://cdn.x/y" });
  assert("size_bytes" in r && r.path.endsWith(".png"));
  await expectInputError(() => uploadKbImage(makeDeps(db), { filename: "x", mime_type: "image/png", source_url: "http://cdn.x/y" }), "https");
  await expectInputError(() => uploadKbImage(makeDeps(db, { resolveDns: async () => ["10.0.0.1"] }), { filename: "x", mime_type: "image/png", source_url: "https://cdn.x/y" }), "endereço");
});

Deno.test("uploadKbImage modo B: URL assinada, pasta padrão uploads, mime fora da lista rejeitado", async () => {
  const { db, storageCalls } = makeFakeDb({});
  const r = await uploadKbImage(makeDeps(db), { filename: "capa.webp", mime_type: "image/webp" });
  assertEquals(r, {
    path: "uploads/00000001-capa.webp",
    public_url: "https://sb/storage/v1/object/public/kb-images/uploads/00000001-capa.webp",
    upload_url: "https://sb/upload/uploads/00000001-capa.webp?token=t",
    expires_in: 7200,
  });
  assertEquals(storageCalls[0].method, "createSignedUploadUrl");
  await expectInputError(() => uploadKbImage(makeDeps(db), { filename: "a.svg", mime_type: "image/svg+xml" }), "mime_type");
  await expectInputError(() => uploadKbImage(makeDeps(db), { filename: "a.png", mime_type: "image/png", article_slug: "Bad Slug" }), "article_slug");
});

Deno.test("uploadPopupImage modo A: chave sob o conta do admin, PUT no R2, linha em files via RPC", async () => {
  const { db, calls } = makeFakeDb(
    { profiles: [{ data: { conta_id: "11111111-1111-1111-1111-111111111111" }, error: null }], workspaces: [{ data: { storage_quota_bytes: 1000000, storage_used_bytes: 10 }, error: null }] },
    { file_insert_with_quota: [{ data: { id: 7 }, error: null }] },
  );
  const puts: string[] = [];
  const r = await uploadPopupImage(makeDeps(db, { putObject: async (k) => { puts.push(k); } }), { filename: "banner", mime_type: "image/png", source_url: "https://cdn.x/y.png" });
  const key = "contas/11111111-1111-1111-1111-111111111111/files/00000001-0000-4000-8000-000000000000.png";
  assertEquals(r, { image_key: key, width: 10, height: 5, size_bytes: PNG_10x5.byteLength });
  assertEquals(puts, [key]);
  const p = rpcPayload(calls, "file_insert_with_quota")!;
  assertEquals(p.conta_id, "11111111-1111-1111-1111-111111111111");
  assertEquals(p.r2_key, key); assertEquals(p.kind, "image"); assertEquals(p.uploaded_by, CTX.user_id);
  assertEquals(p.width, 10); assertEquals(p.height, 5); assertEquals(p.size_bytes, PNG_10x5.byteLength);
});

Deno.test("uploadPopupImage: admin sem conta_id, quota excedida, e falha no insert apaga o objeto", async () => {
  await expectInputError(() => uploadPopupImage(makeDeps(makeFakeDb({ profiles: [{ data: null, error: null }] }).db), { filename: "x", mime_type: "image/png", size_bytes: 10 }), "workspace");
  await expectInputError(() => uploadPopupImage(makeDeps(makeFakeDb({
    profiles: [{ data: { conta_id: "11111111-1111-1111-1111-111111111111" }, error: null }],
    workspaces: [{ data: { storage_quota_bytes: 100, storage_used_bytes: 95 }, error: null }],
  }).db), { filename: "x", mime_type: "image/png", size_bytes: 10 }), "Cota");
  const deleted: string[] = [];
  const { db } = makeFakeDb(
    { profiles: [{ data: { conta_id: "11111111-1111-1111-1111-111111111111" }, error: null }], workspaces: [{ data: { storage_quota_bytes: null, storage_used_bytes: 0 }, error: null }] },
    { file_insert_with_quota: [{ data: null, error: { message: "quota_exceeded" } }] },
  );
  await expectInputError(() => uploadPopupImage(makeDeps(db, { deleteObject: async (k) => { deleted.push(k); } }), { filename: "x", mime_type: "image/png", source_url: "https://cdn.x/y.png" }), "Cota");
  assertEquals(deleted.length, 1);
});

Deno.test("uploadPopupImage modo B: exige size_bytes; devolve upload_url pré-assinada (900 s)", async () => {
  const { db } = makeFakeDb({ profiles: [{ data: { conta_id: "11111111-1111-1111-1111-111111111111" }, error: null }], workspaces: [{ data: { storage_quota_bytes: null, storage_used_bytes: 0 }, error: null }] });
  await expectInputError(() => uploadPopupImage(makeDeps(db), { filename: "x", mime_type: "image/png" }), "size_bytes");
  const { db: db2 } = makeFakeDb({ profiles: [{ data: { conta_id: "11111111-1111-1111-1111-111111111111" }, error: null }], workspaces: [{ data: { storage_quota_bytes: null, storage_used_bytes: 0 }, error: null }] });
  const r = await uploadPopupImage(makeDeps(db2), { filename: "x", mime_type: "image/png", size_bytes: 1234 });
  assertEquals(r, { image_key: "contas/11111111-1111-1111-1111-111111111111/files/00000001-0000-4000-8000-000000000000.png", upload_url: "https://r2/put/contas/11111111-1111-1111-1111-111111111111/files/00000001-0000-4000-8000-000000000000.png", expires_in: 900 });
});

Deno.test("finalizePopupImages: linha existente pula; ausente → headObject + RPC; sem objeto ou tipo errado → McpInputError", async () => {
  const conta = "11111111-1111-1111-1111-111111111111";
  const k1 = `contas/${conta}/files/a.png`, k2 = `contas/${conta}/files/b.png`;
  const { db, calls } = makeFakeDb({ files: [{ data: { id: 1 }, error: null }, { data: null, error: null }] }, { file_insert_with_quota: [{ data: { id: 9 }, error: null }] });
  const heads: string[] = [];
  await finalizePopupImages(makeDeps(db, { headObject: async (k) => { heads.push(k); return { contentLength: 50, contentType: "image/png" }; } }), [k1, k2], conta);
  assertEquals(heads, [k2]);
  const p = rpcPayload(calls, "file_insert_with_quota")!;
  assertEquals(p.r2_key, k2); assertEquals(p.size_bytes, 50); assertEquals(p.mime_type, "image/png");
  assert(has(calls, "files", "eq", ["r2_key", k1]));

  await expectInputError(() => finalizePopupImages(makeDeps(makeFakeDb({ files: [{ data: null, error: null }] }).db, { headObject: async () => null }), [k2], conta), "ainda não enviada");
  await expectInputError(() => finalizePopupImages(makeDeps(makeFakeDb({ files: [{ data: null, error: null }] }).db, { headObject: async () => ({ contentLength: 50, contentType: "text/html" }) }), [k2], conta), "tipo");
  await expectInputError(() => finalizePopupImages(makeDeps(makeFakeDb({ files: [{ data: null, error: null }] }).db, { headObject: async () => ({ contentLength: 11 * 1024 * 1024, contentType: "image/png" }) }), [k2], conta), "10 MB");
});

Deno.test("fillImageDims: preenche width/height de inlineImage sem dims via probe; falha deixa null", async () => {
  const img = (src: string) => ({ type: "inlineImage", attrs: { r2Key: null, src, alt: null, width: null, height: null, blurSrc: null, displayWidth: null, loading: false } });
  const doc = { type: "doc", content: [img("https://cdn.x/ok.png"), { type: "blockquote", content: [img("https://cdn.x/fail.png")] }] };
  const d = makeDeps(makeFakeDb({}).db, {
    fetchUrl: async (u) => u.includes("fail") ? new Response("x", { status: 500 }) : new Response(PNG_10x5, { status: 200, headers: { "content-type": "image/png" } }),
  });
  const out = await fillImageDims(d, doc);
  assertEquals(out.content![0].attrs!.width, 10);
  assertEquals(out.content![0].attrs!.height, 5);
  assertEquals(out.content![1].content![0].attrs!.width, null);
  assertEquals(doc.content[0].attrs.width, null); // entrada não é mutada
});
