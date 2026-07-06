// OpenRouter image provider — same underlying model as gemini.ts (Gemini 3.1 Flash Image /
// gemini-3.1-flash-image) routed through OpenRouter's Unified Image API
// (verified against openrouter.ai/docs 2026-07-05: POST /api/v1/images takes model/prompt/
// aspect_ratio/resolution, reference images ride as `input_references` data URLs, and the
// image returns as base64 in data[0].b64_json). Mirrors gemini.ts's contract exactly:
// per-attempt timeout 60s, ONE retry on 429/5xx or timeout, raw provider payloads logged
// internally and never surfaced (typed errors only), PNG IHDR dims win over anything declared.
// BILLING NOTE (same as gemini.ts): no request idempotency upstream — a timed-out first
// attempt may still bill; bounded 2x, and our own idempotency_key stops caller-level retries
// from multiplying it further.
import {
  ImageGenProvider,
  ImageGenRequest,
  ImageGenResult,
  parsePngIhdr,
  ProviderError,
  ProviderSafetyError,
  ProviderTimeoutError,
} from "./provider.ts";

// Gemini 3.1 Flash Image — the slug LIVE-VERIFIED E2E over OpenRouter on 2026-07-05. The
// `-lite-image` ("Nano Banana 2 Lite") variant was swapped in unvalidated and OpenRouter rejects
// it (prod ledger 2026-07-06: provider_error, ~8.5s, no image), so we stay on the verified slug.
// Re-introducing Lite requires confirming its real OpenRouter slug against a live generation first.
const MODEL = "google/gemini-3.1-flash-image";
const ENDPOINT = "https://openrouter.ai/api/v1/images";
const ATTEMPT_TIMEOUT_MS = 60_000;

// Flash-tier $/image by output size (mirrors gemini.ts). Feeds internal cost accounting, not billing.
const COST_BY_SIZE: Record<string, number> = { "1K": 0.068, "2K": 0.102 };

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function fromBase64(b64: string): Uint8Array {
  const binary = atob(b64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

/** Extracts the base64 payload whether OpenRouter returned `b64_json` (documented default) or a
 * `data:` URL under `url` (some routes normalize to the chat-API image shape). Null when neither. */
// deno-lint-ignore no-explicit-any
function extractImageB64(entry: any): string | null {
  if (typeof entry?.b64_json === "string" && entry.b64_json.length > 0) return entry.b64_json;
  const url = entry?.url ?? entry?.image_url?.url;
  if (typeof url === "string" && url.startsWith("data:")) {
    const comma = url.indexOf(",");
    if (comma > 0 && url.slice(0, comma).includes("base64")) return url.slice(comma + 1);
  }
  return null;
}

export function createOpenRouterProvider(apiKey: string): ImageGenProvider {
  return {
    name: "openrouter",
    model: MODEL,
    async generate(req: ImageGenRequest, signal?: AbortSignal): Promise<ImageGenResult> {
      const body = JSON.stringify({
        model: MODEL,
        prompt: req.prompt,
        aspect_ratio: req.aspectRatio,
        resolution: req.imageSize,
        output_format: "png",
        ...(req.references && req.references.length > 0
          ? {
            input_references: req.references.map((ref) => ({
              type: "image_url",
              image_url: { url: `data:${ref.mime};base64,${toBase64(ref.bytes)}` },
            })),
          }
          : {}),
      });

      let lastStatus = 0;
      for (let attempt = 0; attempt < 2; attempt++) {
        const attemptSignal = signal
          ? AbortSignal.any([signal, AbortSignal.timeout(ATTEMPT_TIMEOUT_MS)])
          : AbortSignal.timeout(ATTEMPT_TIMEOUT_MS);
        let res: Response;
        try {
          res = await fetch(ENDPOINT, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${apiKey}`,
            },
            body,
            signal: attemptSignal,
          });
        } catch (e) {
          const aborted = e instanceof DOMException &&
            (e.name === "AbortError" || e.name === "TimeoutError");
          if (aborted && attempt === 0) continue; // one retry, timeouts included
          if (aborted) throw new ProviderTimeoutError("provider timeout");
          console.error("[image-gen] openrouter fetch failed:", (e as Error)?.message);
          throw new ProviderError("provider fetch failed");
        }

        if (res.status === 429 || res.status >= 500) {
          lastStatus = res.status;
          await res.body?.cancel().catch(() => undefined);
          if (attempt === 0) continue;
          throw new ProviderError(`provider status ${lastStatus}`);
        }
        if (!res.ok) {
          const detail = await res.text().catch(() => "");
          console.error("[image-gen] openrouter error:", res.status, detail.slice(0, 500));
          // OpenRouter surfaces input moderation as 403 with a moderation-flagged error body —
          // same "not retryable with this prompt, never counts quota" bucket as a block reason.
          if (res.status === 403 && /moderat|flagged/i.test(detail)) {
            throw new ProviderSafetyError("input flagged by moderation");
          }
          throw new ProviderError(`provider status ${res.status}`);
        }

        // deno-lint-ignore no-explicit-any
        const payload: any = await res.json().catch(() => null);
        const b64 = extractImageB64(payload?.data?.[0]);
        if (!b64) {
          // 200 with no image = refusal (mirrors gemini.ts's empty-candidate taxonomy).
          console.error(
            "[image-gen] openrouter refusal:",
            JSON.stringify({
              dataLen: Array.isArray(payload?.data) ? payload.data.length : null,
              error: payload?.error?.message?.slice?.(0, 200) ?? null,
            }),
          );
          throw new ProviderSafetyError("no image in response");
        }

        const bytes = fromBase64(b64);
        const ihdr = parsePngIhdr(bytes);
        return {
          bytes,
          mime: "image/png",
          // IHDR wins over anything declared — see module header.
          width: ihdr?.width ?? 0,
          height: ihdr?.height ?? 0,
          model: (payload?.model as string) ?? MODEL,
          costEstimateUsd: COST_BY_SIZE[req.imageSize] ?? COST_BY_SIZE["1K"],
        };
      }
      throw new ProviderError(`provider status ${lastStatus}`);
    },
  };
}
