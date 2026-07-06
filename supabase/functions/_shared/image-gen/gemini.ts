// Gemini image provider (design §8, verified against ai.google.dev 2026-07-02): classic
// generateContent on gemini-3.1-flash-image (matching openrouter.ts; the `-lite-image` variant
// was rejected by OpenRouter — see openrouter.ts) with responseModalities ["IMAGE"] and
// responseFormat.image {aspectRatio, imageSize}; the image comes back as base64 PNG in
// candidates[0].content.parts[].inlineData. Per-attempt timeout 60s, ONE retry on 429/5xx
// or timeout. BILLING NOTE: a timed-out first attempt may still have completed (and billed)
// server-side — Gemini has no request idempotency, so the retry can double-charge while the
// ledger logs one cost estimate. Accepted: bounded to at most 2x on a rare path; our own
// idempotency_key prevents CALLER-level retries from multiplying this further.
// Raw provider payloads are logged internally and never surfaced (typed errors only).
// Dimensions: parse the PNG IHDR — never trust the requested imageSize (§8 js-genai bug).
import {
  ImageGenProvider,
  ImageGenRequest,
  ImageGenResult,
  parsePngIhdr,
  ProviderError,
  ProviderSafetyError,
  ProviderTimeoutError,
} from "./provider.ts";

const MODEL = "gemini-3.1-flash-image";
const ENDPOINT = `https://generativelanguage.googleapis.com/v1/models/${MODEL}:generateContent`;
const ATTEMPT_TIMEOUT_MS = 60_000;

// Flash-tier $/image by output size (§8). 0.5K is not offered by this pipeline.
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

export function createGeminiProvider(apiKey: string): ImageGenProvider {
  return {
    name: "gemini",
    model: MODEL,
    async generate(req: ImageGenRequest, signal?: AbortSignal): Promise<ImageGenResult> {
      const parts: Array<Record<string, unknown>> = [{ text: req.prompt }];
      for (const ref of req.references ?? []) {
        parts.push({ inlineData: { mimeType: ref.mime, data: toBase64(ref.bytes) } });
      }
      const body = JSON.stringify({
        contents: [{ parts }],
        generationConfig: {
          responseModalities: ["IMAGE"],
          responseFormat: {
            image: { aspectRatio: req.aspectRatio, imageSize: req.imageSize },
          },
        },
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
            headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
            body,
            signal: attemptSignal,
          });
        } catch (e) {
          const aborted = e instanceof DOMException &&
            (e.name === "AbortError" || e.name === "TimeoutError");
          if (aborted && attempt === 0) continue; // one retry, timeouts included
          if (aborted) throw new ProviderTimeoutError("provider timeout");
          console.error("[image-gen] gemini fetch failed:", (e as Error)?.message);
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
          console.error("[image-gen] gemini error:", res.status, detail.slice(0, 500));
          throw new ProviderError(`provider status ${res.status}`);
        }

        // deno-lint-ignore no-explicit-any
        const payload: any = await res.json().catch(() => null);
        const candidate = payload?.candidates?.[0];
        const imagePart = candidate?.content?.parts?.find(
          // deno-lint-ignore no-explicit-any
          (p: any) => p?.inlineData?.data,
        );
        if (!imagePart) {
          // Block reason or an empty candidate = safety refusal (§8 failure taxonomy).
          console.error(
            "[image-gen] gemini refusal:",
            JSON.stringify({
              blockReason: payload?.promptFeedback?.blockReason,
              finishReason: candidate?.finishReason,
            }),
          );
          throw new ProviderSafetyError("no image in response");
        }

        const bytes = fromBase64(imagePart.inlineData.data as string);
        const ihdr = parsePngIhdr(bytes);
        return {
          bytes,
          mime: (imagePart.inlineData.mimeType as string) ?? "image/png",
          // IHDR wins over anything declared — see module header.
          width: ihdr?.width ?? 0,
          height: ihdr?.height ?? 0,
          model: MODEL,
          outputTokens: payload?.usageMetadata?.candidatesTokenCount as number | undefined,
          costEstimateUsd: COST_BY_SIZE[req.imageSize] ?? COST_BY_SIZE["1K"],
        };
      }
      throw new ProviderError(`provider status ${lastStatus}`);
    },
  };
}
