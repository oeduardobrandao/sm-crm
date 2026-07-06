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
