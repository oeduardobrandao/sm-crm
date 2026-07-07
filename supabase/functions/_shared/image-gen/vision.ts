// Vision text-extraction (slice C, task 3): given a design's flattened/cropped image, ask a
// vision-capable model to locate every text block and return it as structured layout data the
// design-import pipeline can turn into editable text layers. OpenRouter chat completions on
// google/gemini-3.5-flash (verified against the live OpenRouter catalog 2026-07-06: text+image
// input, text output, structured outputs supported). The lite tier was tried first and returned
// ZERO blocks on a trivially texty poster in two live prod runs — layout extraction needs the
// full flash tier. Mirrors openrouter.ts's
// conventions closely: per-attempt 60s timeout, ONE retry on 429/5xx/timeout, typed errors only,
// raw provider payloads logged internally and never surfaced.
//
// The model is asked for strict JSON (response_format: json_object) but parsing stays TOLERANT
// regardless — models sometimes wrap the JSON in a markdown fence or add prose around it — and
// every block is then validated HARD against the shape below; anything that doesn't fit is
// dropped rather than failing the whole request. An empty list (no text detected) is a VALID
// result, not an error: the caller (design-import) still gets value from the reconstructed
// background even when there are no text layers to place.
const MODEL = "google/gemini-3.5-flash";
const ENDPOINT = "https://openrouter.ai/api/v1/chat/completions";
const ATTEMPT_TIMEOUT_MS = 60_000;
const MAX_BLOCKS = 20;
const ALLOWED_WEIGHTS = [400, 700] as const;
const ALLOWED_ALIGNS = ["left", "center", "right"] as const;
const HEX_COLOR_RE = /^#[0-9a-f]{6}$/i;

export type TextBlockAlign = (typeof ALLOWED_ALIGNS)[number];
export type TextBlockWeight = (typeof ALLOWED_WEIGHTS)[number];

export interface TextBlock {
  text: string;
  bbox: { x: number; y: number; w: number; h: number };
  /** Font size as a fraction of the image height. */
  size: number;
  weight: TextBlockWeight;
  color: string;
  align: TextBlockAlign;
}

export interface VisionInput {
  imageBytes: Uint8Array;
  mime: string;
  apiKey: string;
  /** Pixel dimensions of imageBytes. Used to defensively re-normalize bbox/size values the
   * model returns in PIXELS despite the prompt asking for 0–1 fractions (observed live:
   * gemini mixes the two in one bbox — x normalized, y/h in pixels — which used to drop
   * every block). Omitted → pixel-looking values are dropped as before. */
  width?: number;
  height?: number;
}

/** Any extraction failure (fetch failure, non-2xx after retry, moderation 403, unparsable
 * content). The design-import edge function maps this to `vision_failed`. Raw provider detail is
 * logged internally by the thrower and never carried on the error itself. */
export class VisionError extends Error {}

/** No OpenRouter key configured in this environment. The design-import edge function maps this
 * to `vision_unavailable`. Thrown only by callers that choose to treat resolveVisionConfig()'s
 * null as an exception rather than branching on it directly. */
export class VisionUnavailableError extends Error {}

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

const PROMPT = `You are analyzing a design image to extract every distinct block of text it contains.

For EACH text block, report:
- text: the exact text content (preserve line breaks within the block as \\n)
- bbox: the bounding box of the block, normalized to the image dimensions (0 to 1), as {"x","y","w","h"} where x/y is the top-left corner
- size: the font size as a fraction of the image HEIGHT (0 to 1), e.g. a block whose glyphs are ~8% of the image height is 0.08
- weight: 400 for regular/normal weight, 700 for bold/heavy weight (pick whichever is closer)
- color: the text color as a lowercase 6-digit hex string, e.g. "#ffffff"
- align: the text alignment within its block — one of "left", "center", "right"

Do not include decorative shapes, logos, or icons — only actual readable text. Do not report a
background or watermark unless it is legible text. If the image contains no readable text, return
an empty list.

Respond with ONLY a JSON object of this exact shape, no other prose:
{"blocks": [{"text": string, "bbox": {"x": number, "y": number, "w": number, "h": number}, "size": number, "weight": 400 | 700, "color": string, "align": "left" | "center" | "right"}]}`;

function isFiniteNumberInRange(v: unknown, min: number, max: number): v is number {
  return typeof v === "number" && Number.isFinite(v) && v >= min && v <= max;
}

function nearestWeight(v: number): TextBlockWeight {
  return Math.abs(v - 400) <= Math.abs(v - 700) ? 400 : 700;
}

/** Defensive re-normalization: the prompt asks for 0–1 fractions, but the model sometimes
 * answers in PIXELS — even mixing both inside one bbox (observed live: x normalized, y/h in
 * pixels). Any finite value > 1 is treated as pixels and divided by the matching dimension;
 * values already in [0,1] pass through. Without a dimension to divide by, pixel-looking values
 * stay invalid and the block is dropped by the range check. */
function normalizeFraction(v: unknown, dim: number | undefined): unknown {
  if (typeof v !== "number" || !Number.isFinite(v)) return v;
  if (v > 1 && dim && dim > 0) return v / dim;
  return v;
}

/** Hard validation per the slice C block shape. Returns null for anything that doesn't fit —
 * callers drop invalid blocks rather than failing the whole extraction. fontFamily is
 * deliberately NOT part of this shape: callers always use Inter, so any fontFamily the model
 * hallucinates is discarded here rather than threaded through. */
// deno-lint-ignore no-explicit-any
function validateBlock(raw: any, width?: number, height?: number): TextBlock | null {
  if (!raw || typeof raw !== "object") return null;
  if (typeof raw.text !== "string" || raw.text.length === 0) return null;

  const bbox = raw.bbox;
  if (!bbox || typeof bbox !== "object") return null;
  const x = normalizeFraction(bbox.x, width);
  const y = normalizeFraction(bbox.y, height);
  const w = normalizeFraction(bbox.w, width);
  const bh = normalizeFraction(bbox.h, height);
  if (
    !isFiniteNumberInRange(x, 0, 1) ||
    !isFiniteNumberInRange(y, 0, 1) ||
    !isFiniteNumberInRange(w, 0, 1) ||
    !isFiniteNumberInRange(bh, 0, 1)
  ) {
    return null;
  }

  const size = normalizeFraction(raw.size, height);
  if (!isFiniteNumberInRange(size, 0, 1)) return null;
  if (typeof raw.weight !== "number" || !Number.isFinite(raw.weight)) return null;
  if (typeof raw.color !== "string" || !HEX_COLOR_RE.test(raw.color)) return null;
  if (!ALLOWED_ALIGNS.includes(raw.align)) return null;

  return {
    text: raw.text,
    bbox: { x, y, w, h: bh },
    size,
    weight: nearestWeight(raw.weight),
    color: raw.color.toLowerCase(),
    align: raw.align,
  };
}

/** Extracts the first top-level JSON value from arbitrary model output: strips a ```json fence
 * if present, else scans for the first balanced {...} or [...] span. Models asked for strict JSON
 * still sometimes add a fence or a sentence of prose around it, so this stays tolerant even
 * though we requested response_format: json_object. */
function extractJson(content: string): unknown {
  const fenced = content.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidates = fenced ? [fenced[1], content] : [content];
  for (const candidate of candidates) {
    const trimmed = candidate.trim();
    try {
      return JSON.parse(trimmed);
    } catch {
      // fall through to a balanced-span scan below
    }
    const start = trimmed.search(/[[{]/);
    if (start === -1) continue;
    const open = trimmed[start];
    const close = open === "{" ? "}" : "]";
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let i = start; i < trimmed.length; i++) {
      const ch = trimmed[i];
      if (inString) {
        if (escaped) {
          escaped = false;
        } else if (ch === "\\") {
          escaped = true;
        } else if (ch === '"') {
          inString = false;
        }
        continue;
      }
      if (ch === '"') {
        inString = true;
      } else if (ch === open) {
        depth++;
      } else if (ch === close) {
        depth--;
        if (depth === 0) {
          try {
            return JSON.parse(trimmed.slice(start, i + 1));
          } catch {
            break;
          }
        }
      }
    }
  }
  throw new VisionError("no parsable JSON in vision model response");
}

function parseBlocks(content: string, width?: number, height?: number): TextBlock[] {
  const parsed = extractJson(content);
  const rawBlocks = Array.isArray(parsed)
    ? parsed
    : Array.isArray((parsed as { blocks?: unknown })?.blocks)
    ? (parsed as { blocks: unknown[] }).blocks
    : null;
  if (!rawBlocks) throw new VisionError("vision model response missing a blocks array");

  const blocks: TextBlock[] = [];
  for (const raw of rawBlocks) {
    if (blocks.length >= MAX_BLOCKS) break;
    const block = validateBlock(raw, width, height);
    if (block) blocks.push(block);
  }
  if (blocks.length === 0) {
    // Zero validated blocks is a legal outcome (image may have no text) but it is also the
    // signature of a model/prompt regression — log a truncated sample internally (same
    // convention as openrouter.ts's refusal logging) so prod runs are diagnosable.
    console.error(
      "[image-gen] vision returned 0 valid blocks:",
      JSON.stringify({ rawCount: rawBlocks.length, sample: content.slice(0, 300) }),
    );
  }
  return blocks;
}

export async function extractTextBlocks(
  input: VisionInput,
  signal?: AbortSignal,
): Promise<TextBlock[]> {
  const body = JSON.stringify({
    model: MODEL,
    response_format: { type: "json_object" },
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: PROMPT },
          {
            type: "image_url",
            image_url: { url: `data:${input.mime};base64,${toBase64(input.imageBytes)}` },
          },
        ],
      },
    ],
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
          Authorization: `Bearer ${input.apiKey}`,
        },
        body,
        signal: attemptSignal,
      });
    } catch (e) {
      const aborted = e instanceof DOMException &&
        (e.name === "AbortError" || e.name === "TimeoutError");
      if (aborted && attempt === 0) continue; // one retry, timeouts included
      if (aborted) throw new VisionError("vision provider timeout");
      console.error("[image-gen] vision fetch failed:", (e as Error)?.message);
      throw new VisionError("vision provider fetch failed");
    }

    if (res.status === 429 || res.status >= 500) {
      lastStatus = res.status;
      await res.body?.cancel().catch(() => undefined);
      if (attempt === 0) continue;
      throw new VisionError(`vision provider status ${lastStatus}`);
    }
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      console.error("[image-gen] vision error:", res.status, detail.slice(0, 500));
      // Moderation-style 403 is still a failure here (not a safety-refusal class): nothing was
      // generated, there's no "block reason" taxonomy to preserve — it just means extraction
      // didn't happen.
      throw new VisionError(`vision provider status ${res.status}`);
    }

    // deno-lint-ignore no-explicit-any
    const payload: any = await res.json().catch(() => null);
    const content = payload?.choices?.[0]?.message?.content;
    if (typeof content !== "string" || content.length === 0) {
      console.error(
        "[image-gen] vision empty response:",
        JSON.stringify({ hasChoices: Array.isArray(payload?.choices) }),
      );
      throw new VisionError("vision provider returned no content");
    }

    return parseBlocks(content, input.width, input.height);
  }
  throw new VisionError(`vision provider status ${lastStatus}`);
}
