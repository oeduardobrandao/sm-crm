// T2.13 render-parity fixture (docs/estudio-design.md §6.3 "Pinned parity", plan §3 T2.13).
// ONE deterministic, fully-normalized doc + ONE pinned font list, imported by BOTH engines'
// parity tests — test/estudio-render-parity.test.ts (browser engine: `satori/standalone` +
// satori's packaged yoga.wasm, the exact pair useSatoriRenderer ships) and
// supabase/functions/__tests__/estudio-render-parity_test.ts (edge engine: `npm:satori`, the
// exact import design-render-core ships). Both must produce a BYTE-IDENTICAL SVG equal to the
// committed golden (test/parity/estudio-parity-golden.svg). These tests are the merge-blocking
// drift alarm: if a satori/yoga/tree-builder/font change makes either engine draw one glyph
// differently, one of the suites fails before it can merge.
//
// The fixture deliberately exercises the text features whose layout is easiest to drift:
// mid-sentence run overrides (bold 700 + color), letter-spacing, multi-line wrap at a fixed
// width, an embedded "\n" hard break, center alignment, a layer pill, and a shape layer. No
// image layers — fonts stay the only external bytes, pinned to the committed TTFs under
// public/fonts/estudio (the same files the deno render-core tests read).
import type { DesignDoc } from "./design-doc.ts";

export const PARITY_CANVAS = { width: 1080, height: 1080 } as const;

export const PARITY_DOC = {
  version: 1,
  format: "feed",
  aspect_ratio: "1:1",
  canvas: { width: 1080, height: 1080 },
  fileIds: [],
  pages: [
    {
      id: "parity-page",
      background: { type: "solid", color: "#f4efe6" },
      layers: [
        {
          id: "rule",
          name: "Regra",
          type: "shape",
          x: 90,
          y: 96,
          w: 200,
          h: 8,
          rotation: 0,
          opacity: 1,
          locked: false,
          shape: "rect",
          fill: { type: "solid", color: "#eab308" },
        },
        {
          id: "eyebrow",
          name: "Eyebrow",
          type: "text",
          x: 90,
          y: 140,
          w: 900,
          rotation: 0,
          opacity: 1,
          locked: false,
          text: "PARIDADE DE RENDER",
          font_key: "inter",
          font_weight: 400,
          font_size: 30,
          line_height: 1.2,
          letter_spacing: 6,
          color: "#ca8a04",
          align: "left",
          pill: { color: "#12151a14", padding_x: 12, padding_y: 6, radius: 8 },
        },
        {
          id: "headline",
          name: "Headline",
          type: "text",
          x: 90,
          y: 240,
          w: 900,
          rotation: 0,
          opacity: 1,
          locked: false,
          runs: [
            { text: "O mesmo pixel " },
            { text: "nos dois motores", font_weight: 700, color: "#ca8a04" },
            { text: " — sempre" },
          ],
          font_key: "playfair-display",
          font_weight: 400,
          font_size: 72,
          line_height: 1.15,
          letter_spacing: 0,
          color: "#12151a",
          align: "left",
        },
        {
          id: "body",
          name: "Body",
          type: "text",
          x: 90,
          y: 620,
          w: 900,
          rotation: 0,
          opacity: 1,
          locked: false,
          text: "Se este SVG mudar em um motor só,\neste teste barra o merge.",
          font_key: "inter",
          font_weight: 400,
          font_size: 34,
          line_height: 1.4,
          letter_spacing: 0,
          color: "#374151",
          align: "center",
        },
      ],
    },
  ],
} as unknown as DesignDoc;

/** Pinned font inputs, in the exact order both engines must hand them to satori. `path` is
 * relative to public/fonts/estudio/ (the committed mirror of the R2 `assets/fonts/v1/` tree). */
export const PARITY_FONT_FILES = [
  { family: "inter", weight: 400, style: "normal", path: "inter/400-normal.latin.ttf" },
  {
    family: "playfair-display",
    weight: 400,
    style: "normal",
    path: "playfair-display/400-normal.latin.ttf",
  },
  {
    family: "playfair-display",
    weight: 700,
    style: "normal",
    path: "playfair-display/700-normal.latin.ttf",
  },
] as const;
