import { assertEquals } from "https://deno.land/std@0.208.0/assert/mod.ts";
import { dropUnselectedPlatformBlocks } from "./platform-filter.ts";
import type { ReportLayout } from "./layout.ts";

const layout: ReportLayout = {
  version: 1,
  theme: "editorial",
  blocks: [
    { id: "c", type: "cover", size: "full" },
    { id: "s", type: "ai_summary", size: "full", text: { type: "doc", content: [] } },
    { id: "h1", type: "section_header", size: "full", config: { title: "Instagram" } },
    { id: "k1", type: "kpi_reach", size: "third" },
    { id: "d", type: "divider", size: "full" },
    { id: "t1", type: "tiktok_kpi_views", size: "third" },
    { id: "t2", type: "tiktok_top_posts", size: "full", config: { count: 4 } },
    { id: "i", type: "image", size: "half", config: { ratio: "4:5" } },
    { id: "x", type: "text", size: "full", text: { type: "doc", content: [] } },
    { id: "p", type: "top_posts", size: "full", config: { count: 6 } },
  ],
} as ReportLayout;

const ids = (l: ReportLayout) => l.blocks.map((b) => b.id);

Deno.test("dropUnselectedPlatformBlocks keeps neutral blocks", () => {
  assertEquals(ids(dropUnselectedPlatformBlocks(layout, ["instagram"])), ["c", "s", "h1", "k1", "d", "i", "x", "p"]);
  assertEquals(ids(dropUnselectedPlatformBlocks(layout, ["tiktok"])), ["c", "s", "h1", "d", "t1", "t2", "i", "x"]);
});

Deno.test("dropUnselectedPlatformBlocks with every platform returns the same blocks", () => {
  assertEquals(dropUnselectedPlatformBlocks(layout, ["instagram", "tiktok"]), layout);
});

Deno.test("dropUnselectedPlatformBlocks keeps the layout fields and leaves blocks untouched", () => {
  const out = dropUnselectedPlatformBlocks(layout, ["tiktok"]);
  assertEquals(out.version, 1);
  assertEquals((out as { theme?: string }).theme, "editorial");
  // Config/text dos blocos que ficam passam como vieram (nada de reescrever o template).
  assertEquals(out.blocks.find((b) => b.id === "t2"), layout.blocks.find((b) => b.id === "t2"));
  // Não muta a entrada.
  assertEquals(layout.blocks.length, 10);
});
