import { assert, assertEquals } from "./assert.ts";
import {
  linkDomain,
  mapReferenceRpcError,
  MAX_REFERENCE_NOTE,
  normalizeReferenceLinkTitle,
  normalizeReferenceNote,
  normalizeReferenceUrl,
  parsePositiveId,
  REFERENCE_ERROR_STATUS,
  REFERENCE_MIME,
  referenceMimeSpec,
  sanitizeReferenceName,
  toReferenceItem,
  type ReferenceListRow,
} from "../_shared/post-references.ts";

const sign = async (key: string, _exp?: number, name?: string) =>
  `https://get.example.com/${key}${name ? `?dl=${name}` : ""}`;

function fileRow(fields: Partial<ReferenceListRow> = {}): ReferenceListRow {
  return {
    id: 7, kind: "file", file_id: 70, url: null, link_title: null, note: "Use esta",
    post_approval_id: 501, created_at: "2026-10-08T11:00:00.000Z", can_remove: false,
    name: "foto.png", mime_type: "image/png", file_kind: "image", size_bytes: 5000,
    width: 1080, height: 1350, duration_seconds: null,
    r2_key: "contas/c/files/u.png", thumbnail_r2_key: "contas/c/files/u.thumb.webp",
    blur_data_url: null, ...fields,
  };
}

Deno.test("normalizeReferenceUrl: completes the scheme and returns the parsed href", () => {
  assertEquals(normalizeReferenceUrl("exemplo.com/post"), "https://exemplo.com/post");
  assertEquals(normalizeReferenceUrl("  https://Exemplo.com  "), "https://exemplo.com/");
  assertEquals(normalizeReferenceUrl("http://exemplo.com/a?b=1#c"), "http://exemplo.com/a?b=1#c");
  assertEquals(normalizeReferenceUrl("exemplo.com:8080/x"), "https://exemplo.com:8080/x");
  assertEquals(normalizeReferenceUrl("www.instagram.com/p/abc/"), "https://www.instagram.com/p/abc/");
});

Deno.test("normalizeReferenceUrl: rejects schemes, credentials, whitespace, control chars, length", () => {
  const bad = [
    "", "   ", "javascript:alert(1)", "data:text/html,<b>x</b>", "ftp://exemplo.com/a",
    "mailto:a@b.com", "https://user:pw@exemplo.com", "https://user@exemplo.com",
    "https://exem plo.com", "https://exemplo.com/\tx", "https://exemplo.com/\u0000",
    "https://exemplo.com:99999/", "https://", `https://exemplo.com/${"a".repeat(2048)}`,
  ];
  for (const raw of bad) assertEquals(normalizeReferenceUrl(raw), null, `should reject ${JSON.stringify(raw)}`);
  assertEquals(normalizeReferenceUrl(42 as unknown as string), null);
});

Deno.test("normalizeReferenceNote / LinkTitle: trim, empty to null, code-point cap, type check", () => {
  assertEquals(normalizeReferenceNote(undefined), { ok: true, value: null });
  assertEquals(normalizeReferenceNote(null), { ok: true, value: null });
  assertEquals(normalizeReferenceNote("   "), { ok: true, value: null });
  assertEquals(normalizeReferenceNote("  troca a capa  "), { ok: true, value: "troca a capa" });
  // 500 emoji = 1000 UTF-16 units but 500 code points, which is what char_length counts.
  assertEquals(normalizeReferenceNote("😀".repeat(MAX_REFERENCE_NOTE)).ok, true);
  assertEquals(normalizeReferenceNote("a".repeat(MAX_REFERENCE_NOTE + 1)), { ok: false });
  assertEquals(normalizeReferenceNote(12), { ok: false });
  assertEquals(normalizeReferenceLinkTitle("a".repeat(120)).ok, true);
  assertEquals(normalizeReferenceLinkTitle("a".repeat(121)), { ok: false });
});

Deno.test("referenceMimeSpec: allowlist with per-kind caps; prototype keys are not types", () => {
  assertEquals(referenceMimeSpec("video/quicktime"), { kind: "video", ext: "mov", maxBytes: 200 * 1024 * 1024 });
  assertEquals(referenceMimeSpec("application/pdf")?.maxBytes, 25 * 1024 * 1024);
  assertEquals(referenceMimeSpec("image/gif")?.kind, "image");
  assertEquals(referenceMimeSpec("image/svg+xml"), null);
  assertEquals(referenceMimeSpec("toString"), null);
  assertEquals(referenceMimeSpec(undefined), null);
  assertEquals(Object.keys(REFERENCE_MIME).length, 8);
});

Deno.test("sanitizeReferenceName: strips control chars and slashes, falls back by extension", () => {
  assertEquals(sanitizeReferenceName("  ../foto\u0000final.png ", "png"), ".._fotofinal.png");
  assertEquals(sanitizeReferenceName("", "pdf"), "referencia.pdf");
  assertEquals(sanitizeReferenceName(undefined, "mp4"), "referencia.mp4");
  assertEquals(sanitizeReferenceName("x".repeat(300), "png").length, 200);
});

Deno.test("parsePositiveId and linkDomain", () => {
  assertEquals(parsePositiveId(7), 7);
  assertEquals(parsePositiveId("7"), 7);
  assertEquals(parsePositiveId(0), null);
  assertEquals(parsePositiveId(-1), null);
  assertEquals(parsePositiveId(1.5), null);
  assertEquals(parsePositiveId("7a"), null);
  assertEquals(parsePositiveId(null), null);
  assertEquals(linkDomain("https://www.exemplo.com/a"), "exemplo.com");
  assertEquals(linkDomain("not a url"), null);
});

Deno.test("toReferenceItem: file signs url/thumb; download only when asked", async () => {
  const hub = await toReferenceItem(fileRow(), sign, { includeDownload: false });
  assertEquals(hub.kind, "file");
  assertEquals(hub.url, "https://get.example.com/contas/c/files/u.png");
  assertEquals(hub.thumbnail_url, "https://get.example.com/contas/c/files/u.thumb.webp");
  assertEquals(hub.download_url, null);
  assertEquals(hub.post_approval_id, 501);
  assertEquals(hub.can_remove, false);
  assertEquals(hub.link_url, null);

  const crm = await toReferenceItem(fileRow(), sign, { includeDownload: true });
  assertEquals(crm.download_url, "https://get.example.com/contas/c/files/u.png?dl=foto.png");

  const pdf = await toReferenceItem(
    fileRow({ mime_type: "application/pdf", file_kind: "document", thumbnail_r2_key: null }),
    sign, { includeDownload: false },
  );
  assertEquals(pdf.thumbnail_url, null);
  assertEquals(pdf.file_kind, "document");
});

Deno.test("toReferenceItem: link has link fields and never a download", async () => {
  const item = await toReferenceItem(
    fileRow({
      kind: "link", file_id: null, url: "https://www.exemplo.com/post", link_title: "Inspiração",
      name: null, mime_type: null, file_kind: null, size_bytes: null, width: null, height: null,
      r2_key: null, thumbnail_r2_key: null,
    }),
    sign, { includeDownload: true },
  );
  assertEquals(item.kind, "link");
  assertEquals(item.link_url, "https://www.exemplo.com/post");
  assertEquals(item.link_title, "Inspiração");
  assertEquals(item.link_domain, "exemplo.com");
  assertEquals(item.url, null);
  assertEquals(item.download_url, null);
  assertEquals(item.file_kind, null);
});

Deno.test("mapReferenceRpcError: known RAISE codes map; anything else is a generic 500", () => {
  assertEquals(mapReferenceRpcError({ message: "post_not_found" }, "t"), { status: 404, body: { error: "not_found" } });
  assertEquals(mapReferenceRpcError({ message: "post_not_pending" }, "t"), { status: 409, body: { error: "post_not_pending" } });
  assertEquals(mapReferenceRpcError({ message: "reference_limit" }, "t"), { status: 409, body: { error: "reference_limit" } });
  assertEquals(mapReferenceRpcError({ message: "quota_exceeded" }, "t"), { status: 413, body: { error: "quota_exceeded" } });
  assertEquals(mapReferenceRpcError({ message: "upload_mismatch" }, "t"), { status: 400, body: { error: "upload_mismatch" } });
  const raw = mapReferenceRpcError({ message: 'duplicate key value violates unique constraint "x"' }, "t");
  assertEquals(raw, { status: 500, body: { error: "internal" } });
  assertEquals(mapReferenceRpcError(null, "t").status, 500);
});

Deno.test("REFERENCE_ERROR_STATUS covers the HTTP mapping in the contract", () => {
  assertEquals(REFERENCE_ERROR_STATUS.unsupported_type, 415);
  assertEquals(REFERENCE_ERROR_STATUS.too_large, 413);
  assertEquals(REFERENCE_ERROR_STATUS.locked, 409);
  assertEquals(REFERENCE_ERROR_STATUS.rate_limited, 429);
  assertEquals(REFERENCE_ERROR_STATUS.internal, 500);
  assert(Object.values(REFERENCE_ERROR_STATUS).every((s) => [400, 404, 409, 413, 415, 429, 500].includes(s)));
});
