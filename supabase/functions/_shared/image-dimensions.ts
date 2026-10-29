// Largura/altura de uma imagem lidas só do cabeçalho, sem decodificar. Movido de
// mcp-admin/images.ts (corpo idêntico, que o re-exporta) para servir também ao mcp
// (attach_image_to_post). Desconhecido → null: `files.width/height` aceitam NULL.

/** PNG (IHDR), GIF, WebP (VP8X/VP8L/VP8) e JPEG (varredura até o primeiro SOF). */
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

/** Dimensões de um PNG ou JPEG já identificado pelo sniff: o formato dos bytes tem que bater
 * com `mime`, senão null. */
export function imageDimensions(
  bytes: Uint8Array,
  mime: "image/png" | "image/jpeg",
): { width: number; height: number } | null {
  const isPng = bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e &&
    bytes[3] === 0x47;
  const isJpeg = bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (mime === "image/png" ? !isPng : !isJpeg) return null;
  return parseImageDims(bytes);
}
