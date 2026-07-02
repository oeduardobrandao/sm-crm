import { assert, assertEquals } from "./assert.ts";
import {
  toDesignValidationError,
  validateDesignDoc,
} from "../_shared/design-doc.ts";
import {
  makeBigIntDoc,
  makeCircularDoc,
  makeContext,
  makeOversizedDoc,
  REJECT_FIXTURES,
  VALID_CARROSSEL_4x5,
  VALID_FEED_1x1,
  VALID_REEL_COVER_9x16,
  VALID_WITH_EDGE_CASES,
} from "../_shared/design-doc-fixtures.ts";

Deno.test("valid feed 1:1 doc normalizes cleanly", async () => {
  const result = await validateDesignDoc(VALID_FEED_1x1, makeContext());
  assert(result.ok, "expected ok:true");
  if (!result.ok) return;
  assertEquals(result.doc.canvas, { width: 1080, height: 1080 });
  assertEquals(result.doc.pages[0].layers[0].id, "headline");
  // Defaults materialized explicitly.
  assertEquals(
    (result.doc.pages[0].layers[0] as { align: string }).align,
    "left",
  );
  assertEquals(
    (result.doc.pages[0].layers[0] as { line_height: number }).line_height,
    1.2,
  );
  assertEquals(result.doc.fileIds, []);
  assertEquals(result.warnings, []);
});

Deno.test("valid carrossel 4:5 doc: runs, pill, gradient overlay, gradient stops sorted", async () => {
  const result = await validateDesignDoc(VALID_CARROSSEL_4x5, makeContext());
  assert(result.ok, "expected ok:true");
  if (!result.ok) return;
  assertEquals(result.doc.canvas, { width: 1080, height: 1350 });
  assertEquals(result.doc.pages.length, 2);
  const headline = result.doc.pages[0].layers[1];
  assert(headline.type === "text");
  assertEquals(headline.runs?.length, 3);
  assertEquals(headline.runs?.[1].font_weight, 600);
  assert(headline.pill != null, "expected pill to survive normalization");
  const bg = result.doc.pages[0].background;
  assert(bg.type === "image");
  assertEquals(bg.file_id, 812);
  assert(bg.overlay?.type === "linear_gradient");
  // Stops given out of order (.45, 1) are already sorted here — assert sort is a no-op AND
  // a genuinely-unsorted input gets sorted (covered by the unit-level normalize behavior).
  assertEquals(bg.overlay.stops.map((s) => s.at), [0.45, 1]);
  assertEquals(result.doc.fileIds, [812]);
});

Deno.test("gradient stops out of order get sorted by `at`", async () => {
  const doc = {
    ...VALID_FEED_1x1,
    pages: [
      {
        ...VALID_FEED_1x1.pages[0],
        background: {
          type: "linear_gradient",
          angle: 0,
          stops: [
            { color: "#000000", at: 1 },
            { color: "#ffffff", at: 0 },
          ],
        },
      },
    ],
  };
  const result = await validateDesignDoc(doc, makeContext());
  assert(result.ok, "expected ok:true");
  if (!result.ok) return;
  const bg = result.doc.pages[0].background;
  assert(bg.type === "linear_gradient");
  assertEquals(bg.stops.map((s) => s.at), [0, 1]);
});

Deno.test("valid reel_cover 9:16 doc", async () => {
  const result = await validateDesignDoc(
    VALID_REEL_COVER_9x16,
    makeContext({ postTipo: "reels" }),
  );
  assert(result.ok, "expected ok:true");
  if (!result.ok) return;
  assertEquals(result.doc.canvas, { width: 1080, height: 1920 });
  assertEquals(result.doc.fileIds, [900]);
});

Deno.test("server mints ids for a doc that omits them", async () => {
  const result = await validateDesignDoc(
    VALID_REEL_COVER_9x16,
    makeContext({ postTipo: "reels" }),
  );
  assert(result.ok, "expected ok:true");
  if (!result.ok) return;
  assert(result.doc.pages[0].id.startsWith("page-"));
  assert(result.doc.pages[0].layers[0].id.startsWith("layer-"));
});

Deno.test("auto-names an unnamed layer", async () => {
  const result = await validateDesignDoc(VALID_FEED_1x1, makeContext());
  assert(result.ok, "expected ok:true");
  if (!result.ok) return;
  assertEquals(result.doc.pages[0].layers[0].name, "Texto 1");
});

Deno.test("oversized doc (>256KB) is rejected before any structural parse", async () => {
  const result = await validateDesignDoc(makeOversizedDoc(), makeContext());
  assert(!result.ok, "expected ok:false");
  if (result.ok) return;
  assertEquals(result.issues.length, 1);
  assertEquals(result.issues[0].code, "doc_too_large");
});

Deno.test("text layer with both text and runs is rejected (XOR violation)", async () => {
  const doc = {
    ...VALID_FEED_1x1,
    pages: [
      {
        ...VALID_FEED_1x1.pages[0],
        layers: [{
          ...VALID_FEED_1x1.pages[0].layers[0],
          runs: [{ text: "x" }],
        }],
      },
    ],
  };
  const result = await validateDesignDoc(doc, makeContext());
  assert(!result.ok, "expected ok:false");
});

Deno.test("business-rule issues are aggregated, not fail-fast (multiple defects -> multiple issues)", async () => {
  const doc = {
    ...VALID_FEED_1x1,
    pages: [
      {
        ...VALID_FEED_1x1.pages[0],
        layers: [
          { ...VALID_FEED_1x1.pages[0].layers[0], font_key: "helvetica" },
          {
            type: "image",
            x: 0,
            y: 0,
            w: 10,
            h: 10,
            file_id: 99999,
            fit: "cover",
          },
        ],
      },
    ],
  };
  const result = await validateDesignDoc(doc, makeContext());
  assert(!result.ok, "expected ok:false");
  if (result.ok) return;
  const codes = result.issues.map((i) => i.code);
  assert(
    codes.includes("unknown_font"),
    "expected unknown_font among aggregated issues",
  );
  assert(
    codes.includes("file_not_found"),
    "expected file_not_found among aggregated issues",
  );
  assertEquals(result.truncated, false);
});

Deno.test("issue list is capped at 20 with truncated:true", async () => {
  const manyBadLayers = Array.from({ length: 25 }, (_, i) => ({
    id: `bad-${i}`,
    type: "image",
    x: 0,
    y: 0,
    w: 10,
    h: 10,
    file_id: 99999 - i,
    fit: "cover",
  }));
  const doc = {
    ...VALID_FEED_1x1,
    pages: [{ ...VALID_FEED_1x1.pages[0], layers: manyBadLayers }],
  };
  const result = await validateDesignDoc(doc, makeContext());
  assert(!result.ok, "expected ok:false");
  if (result.ok) return;
  assertEquals(result.issues.length, 20);
  assertEquals(result.issueCount, 25);
  assertEquals(result.truncated, true);
});

Deno.test("toDesignValidationError builds the §2.4 envelope shape", async () => {
  const result = await validateDesignDoc(
    { ...VALID_FEED_1x1, extra: true },
    makeContext(),
  );
  assert(!result.ok, "expected ok:false");
  if (result.ok) return;
  const envelope = toDesignValidationError(result);
  assertEquals(envelope.error, "design_invalid");
  assertEquals(envelope.doc_version, 1);
  assert(Array.isArray(envelope.issues));
});

Deno.test("opacity:0 survives normalization (?? not || for the default)", async () => {
  const result = await validateDesignDoc(VALID_WITH_EDGE_CASES, makeContext());
  assert(result.ok, "expected ok:true");
  if (!result.ok) return;
  assertEquals(result.doc.pages[0].layers[0].opacity, 0);
});

Deno.test("coordinates round to 2 decimals", async () => {
  const result = await validateDesignDoc(VALID_WITH_EDGE_CASES, makeContext());
  assert(result.ok, "expected ok:true");
  if (!result.ok) return;
  assertEquals(result.doc.pages[0].layers[0].x, 90.13);
  assertEquals(result.doc.pages[0].layers[0].y, 400.99);
});

Deno.test("italic font_style survives normalization", async () => {
  const result = await validateDesignDoc(VALID_WITH_EDGE_CASES, makeContext());
  assert(result.ok, "expected ok:true");
  if (!result.ok) return;
  const layer = result.doc.pages[0].layers[0];
  assert(layer.type === "text");
  assertEquals(layer.font_style, "italic");
});

Deno.test("empty_text and layer_off_canvas warnings actually fire", async () => {
  const result = await validateDesignDoc(VALID_WITH_EDGE_CASES, makeContext());
  assert(result.ok, "expected ok:true");
  if (!result.ok) return;
  const codes = result.warnings.map((w) => w.code);
  assert(
    codes.includes("empty_text"),
    `expected empty_text among [${codes.join(", ")}]`,
  );
  assert(
    codes.includes("layer_off_canvas"),
    `expected layer_off_canvas among [${codes.join(", ")}]`,
  );
});

Deno.test("reel_cover format is exempt from post_has_video_media", async () => {
  const result = await validateDesignDoc(
    VALID_REEL_COVER_9x16,
    makeContext({ postTipo: "reels", postHasVideoMedia: true }),
  );
  assert(result.ok, "expected ok:true — reel_cover must be exempt from rule 6");
});

Deno.test("circular reference doc returns a clean issue, never an unhandled rejection", async () => {
  const result = await validateDesignDoc(makeCircularDoc(), makeContext());
  assert(!result.ok, "expected ok:false");
  if (result.ok) return;
  assertEquals(result.issues[0].code, "doc_unserializable");
});

Deno.test("BigInt-containing doc returns a clean issue, never an unhandled rejection", async () => {
  const result = await validateDesignDoc(makeBigIntDoc(), makeContext());
  assert(!result.ok, "expected ok:false");
  if (result.ok) return;
  assertEquals(result.issues[0].code, "doc_unserializable");
});

for (const fixture of REJECT_FIXTURES) {
  Deno.test(`reject fixture: ${fixture.description}`, async () => {
    const result = await validateDesignDoc(
      fixture.doc,
      makeContext(fixture.context),
    );
    assert(!result.ok, `expected ok:false for: ${fixture.description}`);
    if (result.ok) return;
    const codes = result.issues.map((i) => i.code);
    assert(
      codes.includes(fixture.expectedCode),
      `expected code '${fixture.expectedCode}' among [${
        codes.join(", ")
      }] for: ${fixture.description}`,
    );
  });
}
