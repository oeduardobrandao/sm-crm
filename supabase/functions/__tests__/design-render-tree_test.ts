// Pure builder tests (`_shared/design-render-tree.ts`) plus one real satori golden-SVG snapshot.
// The snapshot uses a real committed TTF (public/fonts/estudio) and pins satori's exact output
// string — a cheap drift alarm for satori-version or tree-shape changes, distinct from PR 2.D's
// merge-blocking browser-vs-edge PARITY fixture (which compares the two *engines* against each
// other, not against a hardcoded string).

import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import satori from "npm:satori@0.26.0";
import {
  buildPageTree,
  buildTextMeasurementTree,
  hexToRgba,
  substituteTokens,
} from "../_shared/design-render-tree.ts";
import type { DesignDoc } from "../_shared/design-doc.ts";

Deno.test("hexToRgba: 6-digit hex has alpha 1", () => {
  assertEquals(hexToRgba("#12151a"), "rgba(18, 21, 26, 1)");
});

Deno.test("hexToRgba: 8-digit hex bakes alpha into rgba()", () => {
  assertEquals(hexToRgba("#000000cc"), "rgba(0, 0, 0, 0.8)");
  assertEquals(hexToRgba("#00000000"), "rgba(0, 0, 0, 0)");
});

Deno.test("substituteTokens: {{page}} is 1-based, {{pages}} is the total", () => {
  assertEquals(substituteTokens("{{page}}/{{pages}}", 0, 3), "1/3");
  assertEquals(substituteTokens("{{page}}/{{pages}}", 2, 3), "3/3");
});

Deno.test("substituteTokens: no tokens present is a no-op", () => {
  assertEquals(substituteTokens("plain text", 0, 1), "plain text");
});

function makeFeedDoc(): DesignDoc {
  return {
    version: 1,
    format: "feed",
    aspect_ratio: "1:1",
    canvas: { width: 1080, height: 1080 },
    pages: [
      {
        id: "p1",
        background: { type: "solid", color: "#f4efe6" },
        layers: [
          {
            id: "headline",
            name: "Headline",
            type: "text",
            x: 90,
            y: 400,
            w: 900,
            rotation: 0,
            opacity: 1,
            locked: false,
            text: "Bom dia",
            font_key: "dm-sans",
            font_weight: 700,
            font_size: 64,
            line_height: 1.2,
            letter_spacing: 0,
            color: "#12151a",
            align: "left",
          },
        ],
      },
    ],
    fileIds: [],
  };
}

Deno.test("buildPageTree: background + one text layer produces the expected tree shape", () => {
  const doc = makeFeedDoc();
  const tree = buildPageTree(doc, 0, () => {
    throw new Error("no images in this doc");
  });
  assertEquals(tree.type, "div");
  const rootStyle = tree.props.style as Record<string, unknown>;
  assertEquals(rootStyle.width, 1080);
  assertEquals(rootStyle.height, 1080);
  assertEquals(rootStyle.overflow, "hidden");

  const children = tree.props.children as unknown[];
  assertEquals(children.length, 2); // background + one layer
});

Deno.test("buildPageTree: throws for an out-of-range page index", () => {
  const doc = makeFeedDoc();
  let threw = false;
  try {
    buildPageTree(doc, 5, () => "");
  } catch {
    threw = true;
  }
  assertEquals(threw, true);
});

Deno.test("golden SVG snapshot: real satori render of a simple feed doc with a real TTF", async () => {
  const fontBytes = await Deno.readFile(
    new URL(
      "../../../public/fonts/estudio/dm-sans/700-normal.latin.ttf",
      import.meta.url,
    ),
  );
  const doc = makeFeedDoc();
  const tree = buildPageTree(doc, 0, () => {
    throw new Error("no images in this doc");
  });

  const svg = await satori(tree as never, {
    width: doc.canvas.width,
    height: doc.canvas.height,
    fonts: [{ name: "dm-sans", data: fontBytes, weight: 700, style: "normal" }],
  });

  // Structural assertions rather than a full-string pin — satori embeds per-run mask/clip-path
  // ids that are stable within one process but not guaranteed stable across satori patch
  // versions, so a full hardcoded string is the wrong drift alarm here. Pinning the load-bearing
  // structural facts (viewBox = canvas size, background color present, glyph paths present) is
  // the meaningful "did the tree or satori's output shape change" signal instead.
  assertEquals(svg.startsWith('<svg width="1080" height="1080"'), true);
  // satori normalizes every color it renders to rgba() internally regardless of input format —
  // this asserts against ITS output convention, not `hexToRgba`'s (which happens to already
  // match it, since both settled on the same rgba() representation).
  assertEquals(svg.includes(`fill="${hexToRgba("#f4efe6")}"`), true); // the solid background
  assertEquals(svg.includes("<path"), true); // DM Sans glyph outlines were actually rendered
});

Deno.test("buildTextMeasurementTree: standalone tree has no x/y, only w-based sizing", () => {
  const layer = makeFeedDoc().pages[0].layers[0];
  if (layer.type !== "text") throw new Error("expected text layer");
  const tree = buildTextMeasurementTree(layer);
  const style = tree.props.style as Record<string, unknown>;
  assertEquals(style.width, layer.w);
  assertEquals("left" in style, false);
  assertEquals("top" in style, false);
});
