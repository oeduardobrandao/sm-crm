// Imagens do mcp-admin (spec §7): artigos → bucket público kb-images; popups → R2 sob o
// workspace pessoal do admin + linha em files (senão o orphan-scan recolhe o objeto).
import { McpInputError } from "../_shared/mcp-token.ts";
import { fetchImageSafely, type SafeFetchFailReason } from "../_shared/safe-image-fetch.ts";
import { adminContaId } from "../_shared/admin-popups.ts";
import { SLUG_RE } from "../_shared/admin-kb.ts";
import type { Deps } from "./deps.ts";
import type { TiptapNode } from "./markdown.ts";

export const IMAGE_MIMES = ["image/jpeg", "image/png", "image/webp", "image/gif"];
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const KB_BUCKET = "kb-images";
const EXT: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif" };
const FETCH_TIMEOUT_MS = 20_000;
const PROBE_BYTES = 64 * 1024;
const PROBE_TIMEOUT_MS = 5_000;

const FAIL_MESSAGES: Record<SafeFetchFailReason, string> = {
  invalid_url: "source_url inválida.",
  not_https: "source_url precisa ser https.",
  ip_literal_host: "source_url não pode apontar para um endereço IP.",
  dns_resolution_failed: "source_url: host não resolveu (dns_resolution_failed).",
  private_address: "source_url resolve para um endereço privado; não permitido.",
  redirect_rejected: "source_url redireciona; informe a URL final.",
  timeout: "source_url: tempo esgotado ao baixar.",
  fetch_failed: "source_url: não foi possível baixar a imagem.",
  not_an_image: "source_url não é uma imagem PNG/JPEG/WebP/GIF.",
  too_large: "Imagem maior que 10 MB.",
};

// ---------------------------------------------------------------------------
// Dimensões (header parsing; sem decodificar)
// ---------------------------------------------------------------------------

export function parseImageDims(b: Uint8Array): { width: number; height: number } | null {
  const u16be = (i: number) => (b[i] << 8) | b[i + 1];
  const u16le = (i: number) => b[i] | (b[i + 1] << 8);
  const u24le = (i: number) => b[i] | (b[i + 1] << 8) | (b[i + 2] << 16);
  const u32be = (i: number) => ((b[i] << 24) | (b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3]) >>> 0;
  const ascii = (from: number, to: number) => String.fromCharCode(...b.slice(from, to));
  const ok = (width: number, height: number) => (width > 0 && height > 0 ? { width, height } : null);

  if (b.length >= 24 && b[0] === 0x89 && ascii(1, 4) === "PNG") return ok(u32be(16), u32be(20));
  if (b.length >= 10 && (ascii(0, 6) === "GIF87a" || ascii(0, 6) === "GIF89a")) return ok(u16le(6), u16le(8));
  if (b.length >= 30 && ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") {
    const chunk = ascii(12, 16);
    if (chunk === "VP8X") return ok(1 + u24le(24), 1 + u24le(27));
    if (chunk === "VP8L") {
      const b0 = b[21], b1 = b[22], b2 = b[23], b3 = b[24];
      return ok(1 + (((b1 & 0x3f) << 8) | b0), 1 + (((b3 & 0x0f) << 10) | (b2 << 2) | ((b1 & 0xc0) >> 6)));
    }
    if (chunk === "VP8 ") return ok(u16le(26) & 0x3fff, u16le(28) & 0x3fff);
    return null;
  }
  if (b.length >= 4 && b[0] === 0xff && b[1] === 0xd8) {
    let i = 2;
    while (i + 9 < b.length) {
      if (b[i] !== 0xff) return null;
      const marker = b[i + 1];
      if (marker === 0xff) { i++; continue; }
      if ((marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) { i += 2; continue; }
      const isSof = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
      if (isSof) return ok(u16be(i + 7), u16be(i + 5));
      i += 2 + u16be(i + 2);
    }
    return null;
  }
  return null;
}

export async function probeImageDims(d: Deps, url: string): Promise<{ width: number; height: number } | null> {
  const r = await fetchImageSafely({ resolveDns: d.resolveDns, fetchUrl: d.fetchUrl }, url, {
    maxBytes: PROBE_BYTES, timeoutMs: PROBE_TIMEOUT_MS, truncate: true,
  });
  return r.ok ? parseImageDims(r.bytes) : null;
}

/** Copia o doc preenchendo width/height dos inlineImage (r2Key null, src https) sem dims. */
export async function fillImageDims(d: Deps, doc: TiptapNode): Promise<TiptapNode> {
  const copy = JSON.parse(JSON.stringify(doc)) as TiptapNode;
  const walk = async (n: TiptapNode) => {
    if (n.type === "inlineImage" && n.attrs && n.attrs.r2Key === null && typeof n.attrs.src === "string" &&
        (n.attrs.width == null || n.attrs.height == null)) {
      const dims = await probeImageDims(d, n.attrs.src);
      n.attrs.width = dims?.width ?? null;
      n.attrs.height = dims?.height ?? null;
    }
    for (const c of n.content ?? []) await walk(c);
  };
  await walk(copy);
  return copy;
}

// ---------------------------------------------------------------------------
// Nomes
// ---------------------------------------------------------------------------

function safeName(filename: string): string {
  const base = filename.replace(/\.[a-z0-9]+$/i, "").normalize("NFD").replace(/[̀-ͯ]/g, "")
    .toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);
  return base || "imagem";
}

function requireMime(mime: string): string {
  if (!IMAGE_MIMES.includes(mime)) throw new McpInputError(`mime_type deve ser um de: ${IMAGE_MIMES.join(", ")}`);
  return mime;
}

async function fetchImage(d: Deps, sourceUrl: string) {
  const r = await fetchImageSafely({ resolveDns: d.resolveDns, fetchUrl: d.fetchUrl }, sourceUrl, {
    maxBytes: MAX_IMAGE_BYTES, timeoutMs: FETCH_TIMEOUT_MS,
  });
  if (!r.ok) throw new McpInputError(FAIL_MESSAGES[r.reason]);
  return r;
}

// ---------------------------------------------------------------------------
// Artigos: bucket público kb-images
// ---------------------------------------------------------------------------

export async function uploadKbImage(
  d: Deps,
  args: { filename: string; mime_type: string; source_url?: string; article_slug?: string },
) {
  const mime = requireMime(args.mime_type);
  const folder = args.article_slug ?? "uploads";
  if (!SLUG_RE.test(folder)) throw new McpInputError("article_slug deve ser um slug (letras minúsculas, números e hífens).");
  const stem = `${folder}/${d.randomUUID().slice(0, 8)}-${safeName(args.filename)}`;
  const bucket = d.db.storage.from(KB_BUCKET);
  const publicUrl = (p: string) => bucket.getPublicUrl(p).data.publicUrl as string;

  if (args.source_url) {
    const img = await fetchImage(d, args.source_url);
    const path = `${stem}.${img.ext}`;
    const { error } = await bucket.upload(path, img.bytes, { contentType: img.mime, upsert: false });
    if (error) throw error;
    const dims = parseImageDims(img.bytes);
    return { path, public_url: publicUrl(path), width: dims?.width ?? null, height: dims?.height ?? null, size_bytes: img.bytes.byteLength };
  }

  const path = `${stem}.${EXT[mime]}`;
  const { data, error } = await bucket.createSignedUploadUrl(path);
  if (error || !data) throw error ?? new Error("createSignedUploadUrl returned nothing");
  return { path, public_url: publicUrl(path), upload_url: data.signedUrl as string, expires_in: 7200 };
}

// ---------------------------------------------------------------------------
// Popups: R2 sob o conta do admin + files
// ---------------------------------------------------------------------------

async function requireAdminConta(d: Deps): Promise<string> {
  const conta = await adminContaId(d.db, d.ctx.user_id);
  if (!conta) throw new McpInputError("Seu usuário não tem workspace no CRM; imagens de popup ficam no seu workspace pessoal.");
  return conta;
}

async function assertQuota(d: Deps, contaId: string, needed: number) {
  // Quota vem do plano (effective_plan_limit); workspaces só guarda o consumo.
  const quota = await d.storageQuota(contaId);
  const { data } = await d.db.from("workspaces").select("storage_used_bytes").eq("id", contaId).single();
  const used = Number(data?.storage_used_bytes ?? 0);
  if (quota != null && used + needed > quota) throw new McpInputError("Cota de armazenamento do seu workspace excedida; libere espaço em Arquivos.");
}

function fileInsertPayload(contaId: string, key: string, name: string, mime: string, size: number, dims: { width: number; height: number } | null, uploadedBy: string) {
  return {
    conta_id: contaId, folder_id: "", r2_key: key, thumbnail_r2_key: "", name, kind: "image",
    mime_type: mime, size_bytes: size, width: dims?.width ?? "", height: dims?.height ?? "",
    duration_seconds: "", uploaded_by: uploadedBy,
  };
}

async function insertFileRow(d: Deps, payload: Record<string, unknown>) {
  const { error } = await d.db.rpc("file_insert_with_quota", { p: payload });
  if (error) {
    if (String(error.message ?? "").includes("quota_exceeded")) {
      throw new McpInputError("Cota de armazenamento do seu workspace excedida; libere espaço em Arquivos.");
    }
    throw error;
  }
}

export async function uploadPopupImage(
  d: Deps,
  args: { filename: string; mime_type: string; size_bytes?: number; source_url?: string },
) {
  const mime = requireMime(args.mime_type);
  const contaId = await requireAdminConta(d);
  const name = safeName(args.filename);

  if (args.source_url) {
    const img = await fetchImage(d, args.source_url);
    await assertQuota(d, contaId, img.bytes.byteLength);
    const key = `contas/${contaId}/files/${d.randomUUID()}.${img.ext}`;
    await d.putObject(key, img.bytes, img.mime);
    const dims = parseImageDims(img.bytes);
    try {
      await insertFileRow(d, fileInsertPayload(contaId, key, `${name}.${img.ext}`, img.mime, img.bytes.byteLength, dims, d.ctx.user_id));
    } catch (e) {
      await d.deleteObject(key).catch((err) => console.error("[mcp-admin] cleanup after insert failure:", err));
      throw e;
    }
    return { image_key: key, width: dims?.width ?? null, height: dims?.height ?? null, size_bytes: img.bytes.byteLength };
  }

  const size = args.size_bytes;
  if (!Number.isInteger(size) || (size as number) <= 0 || (size as number) > MAX_IMAGE_BYTES) {
    throw new McpInputError("size_bytes (inteiro, até 10 MB) é obrigatório sem source_url.");
  }
  await assertQuota(d, contaId, size as number);
  const key = `contas/${contaId}/files/${d.randomUUID()}.${EXT[mime]}`;
  const upload_url = await d.signPutUrl(key, mime, 900);
  return { image_key: key, upload_url, expires_in: 900 };
}

/** Modo B dos popups: no persist, garante a linha em files para cada image_key nova. */
export async function finalizePopupImages(d: Deps, keys: string[], contaId: string): Promise<void> {
  for (const key of keys) {
    const { data: existing } = await d.db.from("files").select("id").eq("r2_key", key).maybeSingle();
    if (existing) continue;
    const head = await d.headObject(key);
    if (!head) throw new McpInputError(`Imagem ${key} ainda não enviada: faça o PUT na upload_url antes de usar a image_key.`);
    const mime = head.contentType ?? "";
    if (!IMAGE_MIMES.includes(mime)) throw new McpInputError(`Imagem ${key}: tipo ${mime || "desconhecido"} não permitido (PNG/JPEG/WebP/GIF).`);
    if (head.contentLength <= 0 || head.contentLength > MAX_IMAGE_BYTES) throw new McpInputError(`Imagem ${key}: tamanho fora do limite de 10 MB.`);
    // Modo B: a cota foi checada na emissão contra o size_bytes declarado pelo chamador, mas o
    // PUT pré-assinado não vincula Content-Length -- reconfere aqui contra o tamanho real do
    // objeto (head.contentLength) antes de gravar a linha em files.
    await assertQuota(d, contaId, head.contentLength);
    const name = key.slice(key.lastIndexOf("/") + 1);
    await insertFileRow(d, fileInsertPayload(contaId, key, name, mime, head.contentLength, null, d.ctx.user_id));
  }
}
