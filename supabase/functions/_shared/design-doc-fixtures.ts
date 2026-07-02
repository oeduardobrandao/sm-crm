// Shared test fixtures for the Estúdio design-doc schema (design §11 dual-runtime tests).
// Imported by BOTH supabase/functions/__tests__/design-doc-schema_test.ts (Deno) and
// test/design-doc-schema.test.ts (vitest) — one fixture set, so the two runtimes are asserted
// against the identical accept/reject/normalization behavior rather than hand-copied twins.

import type {
  FontVariantLookup,
  FontWeight,
  ValidationContext,
} from "./design-doc.ts";

// ============================================================
// Fake context — a minimal FontVariantLookup + checkFileIds satisfying the decoupled
// interfaces in design-doc.ts, standing in for the real font manifest (ships in a later PR)
// and a real DB file-tenancy query.
// ============================================================

const FAKE_FONT_VARIANTS: Record<
  string,
  Array<{ weight: FontWeight; style: "normal" | "italic" }>
> = {
  "dm-sans": [{ weight: 400, style: "normal" }, {
    weight: 700,
    style: "normal",
  }],
  montserrat: [
    { weight: 400, style: "normal" },
    { weight: 600, style: "normal" },
    { weight: 800, style: "normal" },
  ],
  fraunces: [
    { weight: 400, style: "normal" },
    { weight: 600, style: "normal" },
    { weight: 400, style: "italic" },
  ],
};

export const fakeFonts: FontVariantLookup = {
  allowedKeys: () => Object.keys(FAKE_FONT_VARIANTS),
  hasVariant: (key, weight, style) =>
    (FAKE_FONT_VARIANTS[key] ?? []).some((v) =>
      v.weight === weight && v.style === style
    ),
  variantsFor: (key) => FAKE_FONT_VARIANTS[key] ?? [],
};

/** Files 812 and 900 "exist" for tenant purposes; anything else does not. */
export const fakeCheckFileIds = (ids: number[]): Promise<Set<number>> =>
  Promise.resolve(new Set(ids.filter((id) => id === 812 || id === 900)));

export function makeContext(
  overrides: Partial<ValidationContext> = {},
): ValidationContext {
  return {
    postTipo: "feed",
    postHasVideoMedia: false,
    fonts: fakeFonts,
    checkFileIds: fakeCheckFileIds,
    ...overrides,
  };
}

// ============================================================
// Valid fixtures
// ============================================================

export const VALID_FEED_1x1 = {
  version: 1,
  format: "feed",
  aspect_ratio: "1:1",
  pages: [
    {
      id: "p1",
      background: { type: "solid", color: "#f4efe6" },
      layers: [
        {
          id: "headline",
          type: "text",
          x: 90,
          y: 400,
          w: 900,
          text: "Bom dia",
          font_key: "dm-sans",
          font_weight: 700,
          font_size: 64,
          color: "#12151a",
        },
      ],
    },
  ],
};

// Exercises runs (styled mid-sentence bold), pill (block highlight), a linear-gradient
// overlay on an image background, and {{page}}/{{pages}} counter tokens.
export const VALID_CARROSSEL_4x5 = {
  version: 1,
  format: "carrossel",
  aspect_ratio: "4:5",
  pages: [
    {
      id: "p1",
      background: {
        type: "image",
        file_id: 812,
        fit: "cover",
        overlay: {
          type: "linear_gradient",
          angle: 0,
          stops: [
            { color: "#00000000", at: 0.45 },
            { color: "#000000cc", at: 1 },
          ],
        },
      },
      layers: [
        {
          id: "eyebrow",
          type: "text",
          x: 90,
          y: 780,
          w: 900,
          text: "PROTETOR SOLAR",
          font_key: "montserrat",
          font_weight: 600,
          font_size: 30,
          letter_spacing: 6,
          color: "#f5c343",
        },
        {
          id: "headline",
          type: "text",
          x: 90,
          y: 830,
          w: 900,
          runs: [
            { text: "5 mitos que " },
            { text: "envelhecem", font_weight: 600, color: "#f5c343" },
            { text: " sua pele" },
          ],
          font_key: "fraunces",
          font_weight: 400,
          font_size: 76,
          line_height: 1.1,
          color: "#ffffff",
          pill: { color: "#00000080", padding_x: 12, padding_y: 6, radius: 8 },
        },
        {
          id: "counter",
          type: "text",
          x: 90,
          y: 1240,
          w: 200,
          text: "{{page}}/{{pages}}",
          font_key: "montserrat",
          font_weight: 600,
          font_size: 26,
          color: "#ffffffaa",
        },
      ],
    },
    {
      id: "p2",
      background: { type: "solid", color: "#f4efe6" },
      layers: [
        {
          type: "shape",
          x: 60,
          y: 60,
          w: 200,
          h: 8,
          shape: "rect",
          fill: { type: "solid", color: "#f5c343" },
        },
      ],
    },
  ],
};

export const VALID_REEL_COVER_9x16 = {
  version: 1,
  format: "reel_cover",
  aspect_ratio: "9:16",
  pages: [
    {
      background: { type: "solid", color: "#123f3a" },
      layers: [
        {
          type: "text",
          x: 90,
          y: 800,
          w: 900,
          text: "Antes de postar, leia isto",
          font_key: "fraunces",
          font_weight: 600,
          font_size: 80,
          color: "#f2fbf8",
        },
        {
          type: "image",
          x: 900,
          y: 1700,
          w: 100,
          h: 100,
          file_id: 900,
          fit: "contain",
        },
      ],
    },
  ],
};

// Exercises: opacity 0 (must survive, not default to 1), non-round coordinates (must round to
// 2 decimals), italic font_style, and one off-canvas + one empty-text layer (must produce
// `layer_off_canvas` / `empty_text` warnings, not errors).
export const VALID_WITH_EDGE_CASES = {
  version: 1,
  format: "feed",
  aspect_ratio: "1:1",
  pages: [
    {
      id: "p1",
      background: { type: "solid", color: "#ffffff" },
      layers: [
        {
          id: "faint",
          type: "text",
          x: 90.126,
          y: 400.994,
          w: 900,
          text: "Quase invisível",
          font_key: "fraunces",
          font_weight: 400,
          font_style: "italic",
          font_size: 40,
          color: "#000000",
          opacity: 0,
        },
        {
          id: "empty",
          type: "text",
          x: 10,
          y: 10,
          w: 100,
          text: "   ",
          font_key: "dm-sans",
          font_weight: 400,
          font_size: 20,
          color: "#000000",
        },
        {
          id: "offcanvas",
          type: "text",
          x: 5000,
          y: 5000,
          w: 100,
          text: "fora",
          font_key: "dm-sans",
          font_weight: 400,
          font_size: 20,
          color: "#000000",
        },
      ],
    },
  ],
};

// ============================================================
// Reject fixtures — [doc, expectedCode, description]
// ============================================================

export interface RejectFixture {
  description: string;
  doc: unknown;
  context?: Partial<ValidationContext>;
  expectedCode: string;
}

export const REJECT_FIXTURES: RejectFixture[] = [
  {
    description: "unknown top-level key is rejected by .strict()",
    doc: { ...VALID_FEED_1x1, extra_field: "nope" },
    expectedCode: "unrecognized_keys",
  },
  {
    description: "bad hex color format",
    doc: {
      ...VALID_FEED_1x1,
      pages: [{
        ...VALID_FEED_1x1.pages[0],
        background: { type: "solid", color: "rgb(0,0,0)" },
      }],
    },
    expectedCode: "invalid_format",
  },
  {
    description: "11 pages exceeds the carrossel max of 10",
    doc: {
      version: 1,
      format: "carrossel",
      aspect_ratio: "4:5",
      pages: Array.from({ length: 11 }, (_, i) => ({
        id: `p${i}`,
        background: { type: "solid", color: "#ffffff" },
        layers: [],
      })),
    },
    expectedCode: "too_big",
  },
  {
    description: "'stories' post tipo is always rejected",
    doc: VALID_FEED_1x1,
    context: { postTipo: "stories" },
    expectedCode: "unsupported_post_tipo",
  },
  {
    description: "unknown font_key",
    doc: {
      ...VALID_FEED_1x1,
      pages: [
        {
          ...VALID_FEED_1x1.pages[0],
          layers: [{
            ...VALID_FEED_1x1.pages[0].layers[0],
            font_key: "helvetica",
          }],
        },
      ],
    },
    expectedCode: "unknown_font",
  },
  {
    description: "RTL script (Hebrew) is rejected",
    doc: {
      ...VALID_FEED_1x1,
      pages: [
        {
          ...VALID_FEED_1x1.pages[0],
          layers: [{ ...VALID_FEED_1x1.pages[0].layers[0], text: "שלום" }],
        },
      ],
    },
    expectedCode: "rtl_unsupported",
  },
  {
    description: "feed format on a post with video media",
    doc: VALID_FEED_1x1,
    context: { postHasVideoMedia: true },
    expectedCode: "post_has_video_media",
  },
  {
    description: "aspect_ratio not valid for format (9:16 on a feed)",
    doc: { ...VALID_FEED_1x1, aspect_ratio: "9:16" },
    expectedCode: "invalid_aspect_ratio_for_format",
  },
  {
    description: "foreign/missing file_id",
    doc: {
      ...VALID_FEED_1x1,
      pages: [
        {
          ...VALID_FEED_1x1.pages[0],
          layers: [{
            type: "image",
            x: 0,
            y: 0,
            w: 100,
            h: 100,
            file_id: 99999,
            fit: "cover",
          }],
        },
      ],
    },
    expectedCode: "file_not_found",
  },
  {
    description:
      "author-supplied `canvas` key is rejected (unknown key, .strict())",
    doc: { ...VALID_FEED_1x1, canvas: { width: 1080, height: 1080 } },
    expectedCode: "unrecognized_keys",
  },
  {
    description: "empty pages array",
    doc: { version: 1, format: "feed", aspect_ratio: "1:1", pages: [] },
    expectedCode: "too_small",
  },
  {
    description: "duplicate page id",
    doc: {
      version: 1,
      format: "carrossel",
      aspect_ratio: "4:5",
      pages: [
        {
          id: "dup",
          background: { type: "solid", color: "#ffffff" },
          layers: [],
        },
        {
          id: "dup",
          background: { type: "solid", color: "#ffffff" },
          layers: [],
        },
      ],
    },
    expectedCode: "duplicate_id",
  },
  {
    description: "duplicate layer id",
    doc: {
      ...VALID_FEED_1x1,
      pages: [
        {
          ...VALID_FEED_1x1.pages[0],
          layers: [
            VALID_FEED_1x1.pages[0].layers[0],
            { ...VALID_FEED_1x1.pages[0].layers[0], x: 200 },
          ],
        },
      ],
    },
    expectedCode: "duplicate_id",
  },
  {
    description: "known font_key but unsupported weight/style variant",
    doc: {
      ...VALID_FEED_1x1,
      pages: [
        {
          ...VALID_FEED_1x1.pages[0],
          layers: [{
            ...VALID_FEED_1x1.pages[0].layers[0],
            font_key: "dm-sans",
            font_weight: 900,
          }],
        },
      ],
    },
    expectedCode: "unsupported_font_variant",
  },
];

/** A doc whose serialized size exceeds MAX_DESIGN_DOC_BYTES (256 KB) — built, not hand-typed. */
export function makeOversizedDoc(): unknown {
  return {
    ...VALID_FEED_1x1,
    pages: [
      {
        ...VALID_FEED_1x1.pages[0],
        layers: [{
          ...VALID_FEED_1x1.pages[0].layers[0],
          text: "x".repeat(260 * 1024),
        }],
      },
    ],
  };
}

/** A doc containing a circular reference — JSON.stringify throws on this by construction. */
export function makeCircularDoc(): unknown {
  // deno-lint-ignore no-explicit-any
  const doc: any = { ...VALID_FEED_1x1 };
  doc.self = doc;
  return doc;
}

/** A doc containing a BigInt value — JSON.stringify throws on this by construction. */
export function makeBigIntDoc(): unknown {
  return { ...VALID_FEED_1x1, huge: 10n };
}
