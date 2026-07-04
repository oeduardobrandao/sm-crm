// Pure, runtime-neutral doc -> satori-tree builder (docs/estudio-design.md §5.2 "render
// contract"). No wasm, no Deno-only APIs, no DOM — only plain object construction plus `fetch`
// (universal in both the Deno edge runtime and the browser), so this module produces a
// byte-identical satori input tree whether it runs in `design-render-core.ts` (edge) or the CRM
// editor's browser preview (aliased `@mesaas/design-render-tree`). That shared construction is
// what makes SVG parity between the two engines a property of the code, not a thing to test for
// after the fact.

import type {
  DesignDoc,
  NormalizedFill,
  NormalizedLayer,
  NormalizedPage,
  NormalizedRun,
  NormalizedShapeLayer,
  NormalizedSolidOrGradient,
  NormalizedTextLayer,
} from "./design-doc.ts";

// Satori's input is a plain object tree shaped like a React element — { type, props: { style,
// children } } — recursively. We don't depend on React or satori's types here (this module has
// zero dependencies), we just produce objects satori itself.
export interface SatoriNode {
  type: string;
  props: Record<string, unknown>;
}

export type SatoriChild = SatoriNode | string;

/** Resolves a `files.id` to whatever `src` satori/the browser `<img>` should load — a `data:`
 * URI on the edge (resvg-wasm cannot fetch URLs itself, per §5.2), a signed URL in the browser.
 * Synchronous and pre-computed: callers resolve every referenced file_id up front (one R2/DB
 * round trip per doc, not per layer) and hand in a plain lookup. */
export type ImageSrcResolver = (fileId: number) => string;

/** Twemoji 17.0.3, pinned per §5.2. Exported so both engines wire the identical
 * `loadAdditionalAsset` callback into their `satori()`/`satori/standalone` call — the shared
 * construction is what keeps emoji rendering WYSIWYG between editor preview and edge render. */
const TWEMOJI_BASE =
  "https://cdn.jsdelivr.net/gh/jdecked/twemoji@17.0.3/assets/svg/";

// Strips the variation-selector-16 codepoint the way Twemoji's own build does, so composite
// emoji (flags, ZWJ sequences) resolve to the asset Twemoji actually shipped.
function twemojiCodePoints(emoji: string): string {
  const codes: string[] = [];
  for (const ch of emoji) {
    const cp = ch.codePointAt(0);
    if (cp === undefined) continue;
    if (cp === 0xfe0f) continue; // VS16
    codes.push(cp.toString(16));
  }
  return codes.join("-");
}

export async function loadTwemojiAsset(
  _code: string,
  text: string,
): Promise<string> {
  const codepoints = twemojiCodePoints(text);
  const url = `${TWEMOJI_BASE}${codepoints}.svg`;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(5_000) });
    if (!res.ok) {
      // A 404 (unmapped/unsupported grapheme) degrades to an empty glyph rather than failing
      // the whole render — logged by the caller, never thrown here (this module has no logger).
      return "";
    }
    return await res.text();
  } catch {
    // A stalled/timed-out fetch degrades the same way a 404 does — one missing emoji glyph is
    // never worth failing an entire page render over.
    return "";
  }
}

/** `{{page}}` / `{{pages}}` token substitution (§2.1) — applied to plain text and to every run's
 * text, always, before satori sees it. `pageIndex` is 0-based; the token is 1-based. */
export function substituteTokens(
  text: string,
  pageIndex: number,
  pageCount: number,
): string {
  return text
    .replaceAll("{{page}}", String(pageIndex + 1))
    .replaceAll("{{pages}}", String(pageCount));
}

/** `#rrggbb` or `#rrggbbaa` -> `rgba()`. Baking alpha into `rgba()` explicitly (rather than
 * handing satori/CSS the 8-digit hex form) is a deliberate render-contract detail (§5.2) — hex
 * alpha support is inconsistent across CSS-in-SVG engines, `rgba()` is not. */
export function hexToRgba(hex: string): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  const a = hex.length === 9 ? parseInt(hex.slice(7, 9), 16) / 255 : 1;
  return `rgba(${r}, ${g}, ${b}, ${Number(a.toFixed(4))})`;
}

function fillToCss(fill: NormalizedSolidOrGradient): Record<string, unknown> {
  if (fill.type === "solid") {
    return { backgroundColor: hexToRgba(fill.color) };
  }
  const stops = fill.stops
    .map((s) => `${hexToRgba(s.color)} ${(s.at * 100).toFixed(2)}%`)
    .join(", ");
  return { backgroundImage: `linear-gradient(${fill.angle}deg, ${stops})` };
}

function buildBackground(
  background: NormalizedFill,
  width: number,
  height: number,
  resolveImageSrc: ImageSrcResolver,
): SatoriNode {
  const fullBleed: Record<string, unknown> = {
    position: "absolute",
    left: 0,
    top: 0,
    width,
    height,
    display: "flex",
  };

  if (background.type === "image") {
    const children: SatoriChild[] = [
      {
        type: "img",
        props: {
          src: resolveImageSrc(background.file_id),
          width,
          height,
          style: {
            position: "absolute",
            left: 0,
            top: 0,
            width,
            height,
            objectFit: background.fit,
            objectPosition: "center",
          },
        },
      },
    ];
    if (background.overlay) {
      children.push({
        type: "div",
        props: {
          style: { ...fullBleed, ...fillToCss(background.overlay) },
        },
      });
    }
    return { type: "div", props: { style: fullBleed, children } };
  }

  return { type: "div", props: { style: { ...fullBleed, ...fillToCss(background) } } };
}

function positionStyle(layer: {
  x: number;
  y: number;
  w: number;
  h?: number;
  rotation: number;
  opacity: number;
}): Record<string, unknown> {
  const style: Record<string, unknown> = {
    position: "absolute",
    left: layer.x,
    top: layer.y,
    width: layer.w,
    display: "flex",
    opacity: layer.opacity,
  };
  if (layer.h !== undefined) style.height = layer.h;
  if (layer.rotation) style.transform = `rotate(${layer.rotation}deg)`;
  return style;
}

function runNode(
  run: NormalizedRun,
  layer: NormalizedTextLayer,
  pageIndex: number,
  pageCount: number,
): SatoriChild {
  const text = substituteTokens(run.text, pageIndex, pageCount);
  const style: Record<string, unknown> = {
    fontWeight: run.font_weight ?? layer.font_weight,
    fontStyle: run.font_style ?? layer.font_style ?? "normal",
    color: hexToRgba(run.color ?? layer.color),
  };
  if (run.highlight) {
    // satori paints inline background per wrapped-line fragment — this is what gives
    // "marca-texto" highlighting its per-line-hugging look without any extra logic here.
    style.backgroundColor = hexToRgba(run.highlight.color);
    style.paddingLeft = run.highlight.padding_x ?? 0;
    style.paddingRight = run.highlight.padding_x ?? 0;
    style.borderRadius = run.highlight.radius ?? 0;
  }
  return { type: "span", props: { style, children: text } };
}

function textBlockChildren(
  layer: NormalizedTextLayer,
  pageIndex: number,
  pageCount: number,
): SatoriChild[] {
  if (layer.runs && layer.runs.length > 0) {
    return layer.runs.map((run) => runNode(run, layer, pageIndex, pageCount));
  }
  return [substituteTokens(layer.text ?? "", pageIndex, pageCount)];
}

// A block-level pill is one rounded rect around the whole text block — but an *authored* `\n`
// must produce one pill per line (satori has no box-decoration-break to hug wrapped lines
// automatically at the block level, only per inline-span backgrounds via `highlight` above), so
// a pill'd layer's plain `text` is split on literal `\n` into stacked per-line pill divs. A
// `pill` + `runs` combination always pills the whole block as one rect instead — `runs[].text`
// is NOT schema-restricted from containing `\n` (design-doc.ts places no such constraint), so an
// authored newline inside a run still wraps visually via `white-space: pre-wrap` on the shared
// text style, it just doesn't get its own separate pill rect. Rare authoring combination
// (pill + runs + an embedded newline inside a run); not worth the added complexity of per-run
// line-splitting for v1.
function buildTextInner(
  layer: NormalizedTextLayer,
  pageIndex: number,
  pageCount: number,
): SatoriNode {
  const textStyle: Record<string, unknown> = {
    display: "flex",
    flexDirection: "column",
    whiteSpace: "pre-wrap",
    wordBreak: "break-word",
    fontFamily: layer.font_key,
    fontSize: layer.font_size,
    lineHeight: layer.line_height,
    letterSpacing: layer.letter_spacing,
    textAlign: layer.align,
    color: hexToRgba(layer.color),
  };
  if (layer.shadow) {
    const s = layer.shadow;
    textStyle.textShadow = `${s.x}px ${s.y}px ${s.blur}px ${hexToRgba(s.color)}`;
  }

  const usesPlainMultilineText = !layer.runs && (layer.text ?? "").includes("\n");

  if (layer.pill && usesPlainMultilineText) {
    const lines = (layer.text ?? "").split("\n");
    return {
      type: "div",
      props: {
        style: { display: "flex", flexDirection: "column" },
        children: lines.map((line) => ({
          type: "div",
          props: {
            style: {
              ...textStyle,
              backgroundColor: hexToRgba(layer.pill!.color),
              paddingLeft: layer.pill!.padding_x,
              paddingRight: layer.pill!.padding_x,
              paddingTop: layer.pill!.padding_y,
              paddingBottom: layer.pill!.padding_y,
              borderRadius: layer.pill!.radius,
            },
            children: [substituteTokens(line, pageIndex, pageCount)],
          },
        })),
      },
    };
  }

  const children = textBlockChildren(layer, pageIndex, pageCount);
  if (layer.pill) {
    return {
      type: "div",
      props: {
        style: {
          ...textStyle,
          backgroundColor: hexToRgba(layer.pill.color),
          paddingLeft: layer.pill.padding_x,
          paddingRight: layer.pill.padding_x,
          paddingTop: layer.pill.padding_y,
          paddingBottom: layer.pill.padding_y,
          borderRadius: layer.pill.radius,
        },
        children,
      },
    };
  }
  return { type: "div", props: { style: textStyle, children } };
}

function buildTextLayer(
  layer: NormalizedTextLayer,
  pageIndex: number,
  pageCount: number,
): SatoriNode {
  return {
    type: "div",
    props: {
      style: positionStyle(layer),
      children: [buildTextInner(layer, pageIndex, pageCount)],
    },
  };
}

/** §2.5 text measurement: a standalone tree for exactly one text layer, sized only by its
 * declared `w` (no `x`/`y`/rotation — measurement cares about intrinsic block size, not canvas
 * placement). Wrapped in a root with a generous, effectively-unbounded height so satori/yoga
 * never clips the block being measured; the caller reads the *content* bbox back out via
 * `resvg.getBBox()`, not this wrapper's size. `pageIndex`/`pageCount` default to a stable 0/1 so
 * `{{page}}/{{pages}}` still substitutes to something deterministic during measurement. */
export function buildTextMeasurementTree(
  layer: NormalizedTextLayer,
  pageIndex = 0,
  pageCount = 1,
): SatoriNode {
  return {
    type: "div",
    props: {
      // alignItems flex-start is LOAD-BEARING: flexbox's default `stretch` would stretch the
      // inner block to this wrapper's full 100000px cross size. Transparent text gets away with
      // it (getBBox only sees glyph ink), but a pill'd layer PAINTS its stretched background —
      // the measured height became ~100000 and every pill'd text layer's selection outline /
      // MCP layout height read as effectively infinite.
      style: { display: "flex", alignItems: "flex-start", width: layer.w, height: 100000 },
      children: [buildTextInner(layer, pageIndex, pageCount)],
    },
  };
}

function buildImageLayer(
  layer: Extract<NormalizedLayer, { type: "image" }>,
  resolveImageSrc: ImageSrcResolver,
): SatoriNode {
  const inner: Record<string, unknown> = {
    width: layer.w,
    height: layer.h,
    objectFit: layer.fit,
    objectPosition: "center",
  };
  if (layer.radius) inner.borderRadius = layer.radius;
  if (layer.border) {
    inner.border = `${layer.border.width}px solid ${hexToRgba(layer.border.color)}`;
  }
  return {
    type: "div",
    props: {
      style: positionStyle(layer),
      children: [
        {
          type: "img",
          props: { src: resolveImageSrc(layer.file_id), style: inner },
        },
      ],
    },
  };
}

function buildShapeLayer(layer: NormalizedShapeLayer): SatoriNode {
  const inner: Record<string, unknown> = {
    width: layer.w,
    height: layer.h,
    display: "flex",
  };
  if (layer.fill) Object.assign(inner, fillToCss(layer.fill));
  if (layer.shape === "ellipse") {
    inner.borderRadius = "50%";
  } else if (layer.radius) {
    inner.borderRadius = layer.radius;
  }
  if (layer.stroke) {
    inner.border = `${layer.stroke.width}px solid ${hexToRgba(layer.stroke.color)}`;
  }
  return {
    type: "div",
    props: {
      style: positionStyle(layer),
      children: [{ type: "div", props: { style: inner } }],
    },
  };
}

function buildLayer(
  layer: NormalizedLayer,
  pageIndex: number,
  pageCount: number,
  resolveImageSrc: ImageSrcResolver,
): SatoriNode {
  switch (layer.type) {
    case "text":
      return buildTextLayer(layer, pageIndex, pageCount);
    case "image":
      return buildImageLayer(layer, resolveImageSrc);
    case "shape":
      return buildShapeLayer(layer);
  }
}

/** Builds the full satori input tree for one page of a normalized design doc. `resolveImageSrc`
 * must already cover every `file_id` referenced by the page (background image + image layers) —
 * callers resolve the doc's full `fileIds` set up front. */
export function buildPageTree(
  doc: DesignDoc,
  pageIndex: number,
  resolveImageSrc: ImageSrcResolver,
): SatoriNode {
  const page: NormalizedPage | undefined = doc.pages[pageIndex];
  if (!page) {
    throw new Error(`design-render-tree: page index ${pageIndex} out of range`);
  }
  const { width, height } = doc.canvas;
  const pageCount = doc.pages.length;

  return {
    type: "div",
    props: {
      style: {
        display: "flex",
        position: "relative",
        width,
        height,
        overflow: "hidden",
        backgroundColor: "#ffffff",
      },
      children: [
        buildBackground(page.background, width, height, resolveImageSrc),
        ...page.layers.map((layer) =>
          buildLayer(layer, pageIndex, pageCount, resolveImageSrc)
        ),
      ],
    },
  };
}
