// Image-generation provider adapter (design §8): one interface, typed failure taxonomy, and
// the PNG IHDR parser every caller must trust over provider-declared sizes (a tracked js-genai
// bug reports `imageSize` being ignored on preview builds — actual dimensions win).

export type ImageAspectRatio = "1:1" | "4:5" | "9:16" | "16:9";
export type ImageSize = "1K" | "2K";

export interface ImageGenRequest {
  prompt: string;
  aspectRatio: ImageAspectRatio;
  imageSize: ImageSize;
  /** Reference images (multi-ref consistency, brand logo) as raw bytes + mime. */
  references?: Array<{ bytes: Uint8Array; mime: string }>;
}

export interface ImageGenResult {
  bytes: Uint8Array;
  mime: string;
  width: number;
  height: number;
  model: string;
  outputTokens?: number;
  costEstimateUsd: number;
}

export interface ImageGenProvider {
  /** Ledger attribution for the pending row — recorded BEFORE any result exists, so failed
   * attempts point at the provider/model that actually served them. */
  readonly name?: string;
  readonly model?: string;
  generate(req: ImageGenRequest, signal?: AbortSignal): Promise<ImageGenResult>;
}

/** The provider refused on safety grounds (block reason / no image part). Not retryable with
 * the same prompt; never counts quota. */
export class ProviderSafetyError extends Error {}

/** Timed out after the per-attempt budget + retry. Retryable; never counts quota. */
export class ProviderTimeoutError extends Error {}

/** Any other provider failure (raw detail is LOGGED by the thrower, never surfaced). */
export class ProviderError extends Error {}

/** Minimal PNG IHDR parse: bytes 16..24 of a valid PNG are width/height (big-endian u32),
 * IHDR being mandated first. Returns null when the signature doesn't match. */
export function parsePngIhdr(bytes: Uint8Array): { width: number; height: number } | null {
  if (
    bytes.length < 24 ||
    bytes[0] !== 0x89 || bytes[1] !== 0x50 || bytes[2] !== 0x4e || bytes[3] !== 0x47
  ) {
    return null;
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const width = view.getUint32(16);
  const height = view.getUint32(20);
  if (width === 0 || height === 0) return null;
  return { width, height };
}

/** Minimal JPEG dimension parse: walk the marker segments to the first Start-Of-Frame (SOF0–SOF15,
 * excluding the non-frame markers C4/C8/CC) and read its big-endian 16-bit height then width.
 * Skips APP/other segments by their length; tolerates fill bytes. Null if no SOF / truncated. */
export function parseJpegDimensions(bytes: Uint8Array): { width: number; height: number } | null {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null; // no SOI → not JPEG
  let i = 2;
  while (i + 3 < bytes.length) {
    if (bytes[i] !== 0xff) {
      i++; // resync to the next marker byte
      continue;
    }
    const marker = bytes[i + 1];
    if (marker === 0xff) {
      i++; // fill byte before the real marker
      continue;
    }
    // Standalone markers carry no length payload: SOI/EOI (D8/D9), RSTn (D0–D7), TEM (01).
    if (marker === 0xd8 || marker === 0xd9 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) {
      i += 2;
      continue;
    }
    const len = (bytes[i + 2] << 8) | bytes[i + 3];
    if (len < 2) return null; // malformed segment length
    const isSof = marker >= 0xc0 && marker <= 0xcf &&
      marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (isSof) {
      if (i + 8 >= bytes.length) return null;
      const height = (bytes[i + 5] << 8) | bytes[i + 6];
      const width = (bytes[i + 7] << 8) | bytes[i + 8];
      if (width === 0 || height === 0) return null;
      return { width, height };
    }
    i += 2 + len; // skip this segment
  }
  return null;
}

export type ImageFormatMeta = { mime: string; ext: string; width: number; height: number };

/** Sniffs the TRUE image format from magic bytes — never trust a provider's declared type (the
 * OpenRouter model returns JPEG even for an output_format:"png" request) — and pairs it with the
 * real pixel dims (PNG via IHDR, JPEG via SOF). Null for anything we can't identify. */
export function parseImageMeta(bytes: Uint8Array): ImageFormatMeta | null {
  const png = parsePngIhdr(bytes);
  if (png) return { mime: "image/png", ext: "png", ...png };
  const jpeg = parseJpegDimensions(bytes);
  if (jpeg) return { mime: "image/jpeg", ext: "jpg", ...jpeg };
  return null;
}
