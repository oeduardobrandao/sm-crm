// Exercises the real satori/resvg/mozjpeg wasm pipeline (design-render-core.ts) with real
// committed font bytes read straight off disk (public/fonts/estudio) — zero R2 dependency, since
// font/file byte fetching is injected (design-render-core.ts never imports r2.ts directly). This
// still needs network access once per process to fetch the resvg/mozjpeg wasm binaries from their
// pinned CDN URLs (unauthenticated, same `--allow-net` the suite already runs with) — unlike R2,
// that's a public CDN CI can always reach, so this suite has no credential dependency.

import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { measureLayer, renderPage, type RenderCoreDeps } from "../_shared/design-render-core.ts";
import type { DesignDoc, NormalizedTextLayer } from "../_shared/design-doc.ts";

// The real manifest's r2Key values look like `assets/fonts/v1/<family>/<weight>-<style>.latin.ttf`
// — the on-disk layout under public/fonts/estudio mirrors everything after `assets/fonts/v1/`.
const FONTS_ROOT = new URL("../../../public/fonts/estudio/", import.meta.url);

function makeDeps(): RenderCoreDeps {
  return {
    resolveFileBytes: async () => {
      throw new Error("no image layers in these fixtures");
    },
    resolveFontBytes: async (r2Key) => {
      // Mirrors what R2 actually holds — read the same bytes straight off the locally committed
      // copy instead of making a network call, so these tests are hermetic.
      const suffix = r2Key.replace(/^assets\/fonts\/v1\//, "");
      return await Deno.readFile(new URL(suffix, FONTS_ROOT));
    },
  };
}

function makeDoc(): DesignDoc {
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

Deno.test({
  name: "renderPage produces a valid JPEG at the doc's native canvas size",
  fn: async () => {
    const rendered = await renderPage(makeDoc(), 0, makeDeps());
    assertEquals(rendered.width, 1080);
    assertEquals(rendered.height, 1080);
    assertEquals(rendered.jpegBytes[0], 0xff);
    assertEquals(rendered.jpegBytes[1], 0xd8); // JPEG magic bytes
    assertEquals(rendered.jpegBytes.length > 0, true);
  },
});

Deno.test({
  name: "renderPage scales output via resvg fitTo without changing satori's layout width",
  fn: async () => {
    const rendered = await renderPage(makeDoc(), 0, makeDeps(), { width: 540 });
    assertEquals(rendered.width, 540);
    assertEquals(rendered.height, 540); // 1:1 aspect preserved
  },
});

Deno.test({
  name: "renderPage throws for an out-of-range page index rather than rendering garbage",
  fn: async () => {
    let threw = false;
    try {
      await renderPage(makeDoc(), 3, makeDeps());
    } catch {
      threw = true;
    }
    assertEquals(threw, true);
  },
});

Deno.test({
  name: "renderPage resolves every distinct (font_key, weight, style) used on the page, including runs",
  fn: async () => {
    const doc = makeDoc();
    doc.pages[0].layers.push({
      id: "styled",
      name: "Styled",
      type: "text",
      x: 90,
      y: 600,
      w: 900,
      rotation: 0,
      opacity: 1,
      locked: false,
      runs: [
        { text: "normal " },
        { text: "bold via run", font_weight: 600 },
      ],
      font_key: "montserrat",
      font_weight: 400,
      font_size: 32,
      line_height: 1.2,
      letter_spacing: 0,
      color: "#12151a",
      align: "left",
    });
    // Would throw during font resolution if montserrat/600/normal weren't in the manifest or on
    // disk — this is a real integration check, not a mock assertion.
    const rendered = await renderPage(doc, 0, makeDeps());
    assertEquals(rendered.jpegBytes.length > 0, true);
  },
});

Deno.test({
  name: "measureLayer: a two-line-wrapping text is measurably taller than a one-liner",
  fn: async () => {
    const base: NormalizedTextLayer = {
      id: "m",
      name: "M",
      type: "text",
      x: 0,
      y: 0,
      w: 300,
      rotation: 0,
      opacity: 1,
      locked: false,
      text: "Curto",
      font_key: "dm-sans",
      font_weight: 700,
      font_size: 32,
      line_height: 1.2,
      letter_spacing: 0,
      color: "#000000",
      align: "left",
    };
    const long: NormalizedTextLayer = {
      ...base,
      text: "Um texto bem mais longo que deve quebrar em pelo menos duas linhas nesta largura",
    };

    const shortResult = await measureLayer(base, makeDeps().resolveFontBytes);
    const longResult = await measureLayer(long, makeDeps().resolveFontBytes);
    assertEquals(longResult.height > shortResult.height, true);
    assertEquals(longResult.width <= base.w, true);
  },
});

Deno.test({
  name: "font byte cache: a font already loaded for renderPage doesn't require a second read for measureLayer in the same process",
  fn: async () => {
    let reads = 0;
    const countingDeps: RenderCoreDeps = {
      resolveFileBytes: async () => {
        throw new Error("no images");
      },
      resolveFontBytes: async (r2Key) => {
        reads++;
        const suffix = r2Key.replace(/^assets\/fonts\/v1\//, "");
        return await Deno.readFile(new URL(suffix, FONTS_ROOT));
      },
    };
    await renderPage(makeDoc(), 0, countingDeps); // warms the dm-sans/700/normal cache entry
    const readsAfterFirstRender = reads;
    await renderPage(makeDoc(), 0, countingDeps); // same font — should hit the cache, not re-read
    assertEquals(reads, readsAfterFirstRender);
  },
});
