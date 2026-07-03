// Shared wasm render core (docs/estudio-design.md §5.2). Wraps satori + resvg-wasm +
// @jsquash/jpeg around the pure `design-render-tree.ts` builder. Consumers: the `design-render`
// edge function (full-page renders, this PR) and later the `mcp` function (measure pass +
// `preview_design`, slice 5). Everything here is Deno/wasm-only — never aliased into the CRM
// (the browser uses `satori/standalone` directly per design §6.3, not this module).
//
// Wasm binaries are always fetched from a pinned CDN URL and initialized explicitly at
// module scope (once per worker), never left to each package's own default asset resolution —
// `supabase functions deploy --use-api` ships no static files alongside the function bundle, so
// any wasm loading that assumes a co-located local file is unproven until it's fetched over the
// network like everything else here. Verified locally end-to-end (satori -> resvg -> mozjpeg,
// real TTFs) before writing this module; the real proof is this PR's staging deploy smoke test.

// deno-lint-ignore no-explicit-any
import satori from "npm:satori@0.26.0";
import { Resvg, initWasm as initResvgWasm } from "npm:@resvg/resvg-wasm@2.6.2";
import encodeJpegImpl, {
  init as initJpegWasm,
} from "npm:@jsquash/jpeg@1.6.0/encode.js";
import { encodeBase64 } from "jsr:@std/encoding@1/base64";

import type { DesignDoc, NormalizedTextLayer } from "./design-doc.ts";
import {
  buildPageTree,
  buildTextMeasurementTree,
  loadTwemojiAsset,
  type SatoriNode,
} from "./design-render-tree.ts";
import manifest from "./fonts/manifest.json" with { type: "json" };
import type { FontManifest } from "./fonts/types.ts";

const RESVG_WASM_URL =
  "https://cdn.jsdelivr.net/npm/@resvg/resvg-wasm@2.6.2/index_bg.wasm";
const JPEG_WASM_URL =
  "https://cdn.jsdelivr.net/npm/@jsquash/jpeg@1.6.0/codec/enc/mozjpeg_enc.wasm";

const FONT_MANIFEST = manifest as unknown as FontManifest;
const FALLBACK_FONT_KEY = FONT_MANIFEST.fallbackKey;

// ============================================================
// Module-scope wasm init (once per worker) — every render/measure call awaits this, but the
// underlying fetch+compile only happens once; subsequent calls resolve the same promise.
// ============================================================

let wasmInitPromise: Promise<void> | null = null;

// No fetch here is allowed to hang indefinitely — an edge function invocation has its own
// platform-side hard timeout, and an unbounded fetch that stalls (vs. cleanly erroring) would
// burn that entire budget silently instead of failing fast into the retry-on-next-call path
// `ensureWasmInit`'s rejection-reset already provides.
const WASM_FETCH_TIMEOUT_MS = 10_000;

function ensureWasmInit(): Promise<void> {
  if (!wasmInitPromise) {
    wasmInitPromise = (async () => {
      const [resvgRes, jpegRes] = await Promise.all([
        fetch(RESVG_WASM_URL, { signal: AbortSignal.timeout(WASM_FETCH_TIMEOUT_MS) }),
        fetch(JPEG_WASM_URL, { signal: AbortSignal.timeout(WASM_FETCH_TIMEOUT_MS) }),
      ]);
      if (!resvgRes.ok) {
        throw new Error(`resvg wasm fetch failed: ${resvgRes.status}`);
      }
      if (!jpegRes.ok) {
        throw new Error(`mozjpeg wasm fetch failed: ${jpegRes.status}`);
      }
      const jpegModule = await WebAssembly.compileStreaming(jpegRes);
      await Promise.all([
        initResvgWasm(resvgRes),
        initJpegWasm(jpegModule),
      ]);
    })().catch((e) => {
      // A rejected promise is still a truthy object, so without this reset a single transient
      // CDN blip (a momentary jsdelivr 5xx, a network hiccup) would permanently wedge this
      // worker: every future render/measure call on it would replay the same cached rejection
      // forever instead of retrying, until the worker happens to cold-start again.
      //
      // No automated regression test for this specific reset: `wasmInitPromise` is module-scope
      // singleton state shared across every test in the batched suite, so by the time a test
      // could inject a failure, earlier tests have usually already warmed it to a resolved
      // promise, making the failure path unreachable without a test-only reset hook. Verified
      // manually instead (isolated process, monkey-patched `fetch` failing the first resvg
      // fetch, confirmed a second `renderPage` call retries rather than replaying the rejection).
      wasmInitPromise = null;
      throw e;
    });
  }
  return wasmInitPromise;
}

// ============================================================
// Font byte cache (module-scope, ~32 MB cap per §5.2) — keyed by "font_key/weight/style",
// shared across renders on the same warm worker. Simple LRU-by-insertion-order: evict oldest
// entries once the cap is exceeded, since font TTFs are fetched whole (no partial eviction
// needed) and re-fetching a cold entry costs one R2 GET, not a correctness issue.
// ============================================================

const FONT_CACHE_MAX_BYTES = 32 * 1024 * 1024;
const fontCache = new Map<string, Uint8Array>();
let fontCacheBytes = 0;

function fontCacheKey(fontKey: string, weight: number, style: string): string {
  return `${fontKey}/${weight}/${style}`;
}

function fontCacheSet(key: string, bytes: Uint8Array): void {
  fontCache.set(key, bytes);
  fontCacheBytes += bytes.byteLength;
  while (fontCacheBytes > FONT_CACHE_MAX_BYTES && fontCache.size > 1) {
    const oldestKey = fontCache.keys().next().value as string;
    const oldest = fontCache.get(oldestKey);
    if (oldest) fontCacheBytes -= oldest.byteLength;
    fontCache.delete(oldestKey);
  }
}

/** Fetches one font asset's raw bytes by its manifest `r2Key`. Injected rather than a direct
 * `r2.ts` call — same reasoning as `FileBytesResolver`: it decouples this module from live R2
 * network access, which matters even though every real caller wires the same R2-backed
 * implementation, because it lets `renderPage`/`measureLayer` be exercised in tests with real
 * wasm and real (locally committed) font bytes, with zero network dependency and without
 * requiring R2 credentials in CI. */
export type FontBytesResolver = (r2Key: string) => Promise<Uint8Array>;

/** Resolves one (font_key, weight, style) to satori `fonts[]` entries — latin always, latin-ext
 * only when the variant ships it (per §5.2 "latin-ext per-glyph fallback" — both entries share
 * the same `name`/`weight`/`style` so satori's own per-glyph fallback picks whichever file
 * actually contains a given codepoint). Throws if the variant isn't in the manifest — callers
 * are expected to have already validated `(font_key, weight, style)` via `design-doc.ts`'s
 * `FontVariantLookup`, so reaching an unknown variant here means a doc slipped through
 * unvalidated, which should fail loudly rather than silently fall back mid-render.
 */
async function loadFontEntries(
  fontKey: string,
  weight: number,
  style: "normal" | "italic",
  resolveFontBytes: FontBytesResolver,
  // deno-lint-ignore no-explicit-any
): Promise<any[]> {
  const family = FONT_MANIFEST.families.find((f) => f.key === fontKey);
  const variant = family?.variants.find(
    (v) => v.weight === weight && v.style === style,
  );
  if (!family || !variant) {
    throw new Error(`unknown font variant: ${fontKey} ${weight} ${style}`);
  }

  const entries = [];
  for (const [subset, file] of [
    ["latin", variant.files.latin],
    ["latinExt", variant.files.latinExt],
  ] as const) {
    if (!file) continue;
    const cacheKey = `${fontCacheKey(fontKey, weight, style)}/${subset}`;
    let bytes = fontCache.get(cacheKey);
    if (!bytes) {
      bytes = await resolveFontBytes(file.r2Key);
      fontCacheSet(cacheKey, bytes);
    }
    entries.push({ name: fontKey, data: bytes, weight, style });
  }
  return entries;
}

/** Walks a set of `(font_key, weight, style)` triples used in a doc/layer and resolves every one
 * to satori font entries, always appending the manifest's fallback family (400/normal, latin
 * only) last so satori has a last-resort glyph source per §5.2. */
async function loadFontsForVariants(
  variants: Iterable<{ fontKey: string; weight: number; style: "normal" | "italic" }>,
  resolveFontBytes: FontBytesResolver,
  // deno-lint-ignore no-explicit-any
): Promise<any[]> {
  const seen = new Set<string>();
  // deno-lint-ignore no-explicit-any
  const fonts: any[] = [];
  for (const v of variants) {
    const key = fontCacheKey(v.fontKey, v.weight, v.style);
    if (seen.has(key)) continue;
    seen.add(key);
    fonts.push(...(await loadFontEntries(v.fontKey, v.weight, v.style, resolveFontBytes)));
  }
  const fallbackKey = fontCacheKey(FALLBACK_FONT_KEY, 400, "normal");
  if (!seen.has(fallbackKey)) {
    fonts.push(
      ...(await loadFontEntries(FALLBACK_FONT_KEY, 400, "normal", resolveFontBytes)),
    );
  }
  return fonts;
}

function collectPageFontVariants(
  doc: DesignDoc,
  pageIndex: number,
): Array<{ fontKey: string; weight: number; style: "normal" | "italic" }> {
  const page = doc.pages[pageIndex];
  const out: Array<{ fontKey: string; weight: number; style: "normal" | "italic" }> = [];
  for (const layer of page.layers) {
    if (layer.type !== "text") continue;
    out.push({
      fontKey: layer.font_key,
      weight: layer.font_weight,
      style: layer.font_style ?? "normal",
    });
    for (const run of layer.runs ?? []) {
      out.push({
        fontKey: layer.font_key,
        weight: run.font_weight ?? layer.font_weight,
        style: run.font_style ?? layer.font_style ?? "normal",
      });
    }
  }
  return out;
}

function collectPageFileIds(doc: DesignDoc, pageIndex: number): number[] {
  const page = doc.pages[pageIndex];
  const ids = new Set<number>();
  if (page.background.type === "image") ids.add(page.background.file_id);
  for (const layer of page.layers) {
    if (layer.type === "image") ids.add(layer.file_id);
  }
  return [...ids];
}

/** Injected by the caller (`design-render`'s edge function code) — resolves a `files.id` to its
 * bytes + mime type. Deliberately NOT owned by this module: doing so would require a Supabase DB
 * client and tenancy checks here, exactly the coupling `design-doc.ts`'s `CheckFileIds` pattern
 * was designed to avoid. Core only knows how to turn bytes into a data URI. */
export type FileBytesResolver = (
  fileId: number,
) => Promise<{ bytes: Uint8Array; mimeType: string }>;

export interface RenderCoreDeps {
  resolveFileBytes: FileBytesResolver;
  resolveFontBytes: FontBytesResolver;
}

async function buildImageSrcMap(
  fileIds: number[],
  resolveFileBytes: FileBytesResolver,
): Promise<Map<number, string>> {
  const map = new Map<number, string>();
  for (const fileId of fileIds) {
    const { bytes, mimeType } = await resolveFileBytes(fileId);
    map.set(fileId, `data:${mimeType};base64,${encodeBase64(bytes)}`);
  }
  return map;
}

export interface RenderPageResult {
  jpegBytes: Uint8Array;
  width: number;
  height: number;
}

export interface RenderPageOptions {
  /** Output raster width in px; defaults to the doc's native canvas width. satori always lays
   * out at the doc's native canvas size (text wrap widths are canvas-pixel values, so re-laying
   * out at a different size would change wrapping) — a smaller `width` here only scales the
   * final raster via resvg's `fitTo`, it never re-runs layout. */
  width?: number;
  quality?: number;
}

/** Renders one page of a normalized design doc to a JPEG. This is the full §5.2 step-3 pipeline:
 * resolve referenced files to data URIs, build the satori tree, satori -> SVG, resvg -> RGBA
 * pixels, mozjpeg -> JPEG bytes (no PNG intermediate). */
export async function renderPage(
  doc: DesignDoc,
  pageIndex: number,
  deps: RenderCoreDeps,
  opts: RenderPageOptions = {},
): Promise<RenderPageResult> {
  if (!doc.pages[pageIndex]) {
    throw new Error(`design-render-core: page index ${pageIndex} out of range`);
  }
  await ensureWasmInit();

  const fileIds = collectPageFileIds(doc, pageIndex);
  const imageSrcMap = await buildImageSrcMap(fileIds, deps.resolveFileBytes);
  const tree: SatoriNode = buildPageTree(doc, pageIndex, (fileId) => {
    const src = imageSrcMap.get(fileId);
    if (!src) {
      throw new Error(`design-render-core: unresolved file_id ${fileId}`);
    }
    return src;
  });

  const fonts = await loadFontsForVariants(
    collectPageFontVariants(doc, pageIndex),
    deps.resolveFontBytes,
  );

  const { width: canvasWidth, height: canvasHeight } = doc.canvas;
  // deno-lint-ignore no-explicit-any
  const svg = await satori(tree as any, {
    width: canvasWidth,
    height: canvasHeight,
    fonts,
    loadAdditionalAsset: loadTwemojiAsset,
  });

  const outputWidth = opts.width ?? canvasWidth;
  const resvg = new Resvg(svg, { fitTo: { mode: "width", value: outputWidth } });
  const rendered = resvg.render();

  // resvg's `pixels` is a plain Uint8Array; @jsquash/jpeg's `encode()` types its input as the
  // full DOM `ImageData` interface but its implementation only ever reads `.data`/`.width`/
  // `.height` (verified against the installed encode.js — no `colorSpace`/`pixelFormat` access,
  // and no assignment through a real `ImageData` constructor either). A zero-copy
  // Uint8ClampedArray view over resvg's buffer plus a plain `{data, width, height}` object is
  // the correct runtime shape; the cast exists only because `dom` lib's `ImageData` type is
  // stricter than the object jsquash actually needs.
  const clampedPixels = new Uint8ClampedArray(
    rendered.pixels.buffer,
    rendered.pixels.byteOffset,
    rendered.pixels.byteLength,
  );
  const jpegBuf = await encodeJpegImpl(
    {
      data: clampedPixels,
      width: rendered.width,
      height: rendered.height,
    } as unknown as ImageData,
    { quality: opts.quality ?? 85 },
  );

  return {
    jpegBytes: new Uint8Array(jpegBuf),
    width: rendered.width,
    height: rendered.height,
  };
}

export interface MeasureLayerResult {
  width: number;
  height: number;
}

/** §2.5 text measurement — renders just one text layer's subtree through satori and reads the
 * geometry back via `resvg.getBBox()` (SVG-parse only; the expensive rasterize step in
 * `renderPage` never runs here). Not called by `design-render` itself (text layers already omit
 * `h` and size naturally under satori's own flex layout at render time) — owned by this PR per
 * the plan so slice-2's measurement cache and slice-5's MCP `layout` array can consume it
 * directly without touching this module again. */
export async function measureLayer(
  layer: NormalizedTextLayer,
  resolveFontBytes: FontBytesResolver,
): Promise<MeasureLayerResult> {
  await ensureWasmInit();

  const tree = buildTextMeasurementTree(layer);
  const fonts = await loadFontsForVariants(
    [
      { fontKey: layer.font_key, weight: layer.font_weight, style: layer.font_style ?? "normal" },
      ...(layer.runs ?? []).map((run) => ({
        fontKey: layer.font_key,
        weight: run.font_weight ?? layer.font_weight,
        style: run.font_style ?? layer.font_style ?? "normal",
      })),
    ],
    resolveFontBytes,
  );

  // deno-lint-ignore no-explicit-any
  const svg = await satori(tree as any, {
    width: layer.w,
    height: 100000,
    fonts,
    loadAdditionalAsset: loadTwemojiAsset,
  });

  const resvg = new Resvg(svg);
  const bbox = resvg.getBBox();
  return { width: bbox?.width ?? 0, height: bbox?.height ?? 0 };
}
