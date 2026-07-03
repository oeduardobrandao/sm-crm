// T2.13 parity fixture — EDGE engine side (merge-blocking drift alarm).
// Renders the shared fixture through `npm:satori`'s default entry — the EXACT import
// design-render-core ships — and asserts the SVG is byte-identical to the committed golden.
// The browser engine re-asserts the same golden in test/estudio-render-parity.test.ts; see that
// file's header for the drift/regeneration protocol.
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import satori from "npm:satori@0.26.0";
import { buildPageTree } from "../_shared/design-render-tree.ts";
import { PARITY_CANVAS, PARITY_DOC, PARITY_FONT_FILES } from "../_shared/parity-fixture.ts";

const FONTS_ROOT = new URL("../../../public/fonts/estudio/", import.meta.url);
const GOLDEN_URL = new URL("../../../test/parity/estudio-parity-golden.svg", import.meta.url);

Deno.test("estudio render parity (edge engine: npm:satori) matches the committed golden byte-for-byte", async () => {
  const fonts = [];
  for (const f of PARITY_FONT_FILES) {
    fonts.push({
      name: f.family,
      data: await Deno.readFile(new URL(f.path, FONTS_ROOT)),
      weight: f.weight,
      style: f.style,
    });
  }

  const tree = buildPageTree(PARITY_DOC, 0, () => {
    throw new Error("parity fixture has no image layers");
  });

  // deno-lint-ignore no-explicit-any
  const svg = await satori(tree as any, {
    width: PARITY_CANVAS.width,
    height: PARITY_CANVAS.height,
    // deno-lint-ignore no-explicit-any
    fonts: fonts as any,
  });

  const golden = await Deno.readTextFile(GOLDEN_URL);
  // Length first: a byte diff between two 70KB strings is unreadable — the sizes localize it.
  assertEquals(svg.length, golden.length);
  assertEquals(svg, golden);
});
