import { assertEquals, assertStringIncludes } from "https://deno.land/std@0.208.0/assert/mod.ts";
import { donutChart, lineChart } from "./charts.ts";

Deno.test("lineChart returns valid SVG with correct data points", () => {
  const svg = lineChart({
    data: [
      { label: "01", value: 100 },
      { label: "15", value: 150 },
      { label: "30", value: 120 },
    ],
    width: 600,
    height: 200,
    color: "#eab308",
    markers: [{ label: "15", color: "#f542c8" }],
  });
  assertStringIncludes(svg, "<svg");
  assertStringIncludes(svg, "</svg>");
  assertStringIncludes(svg, "#eab308");
  assertStringIncludes(svg, "<polyline");
});

Deno.test("lineChart handles empty data", () => {
  const svg = lineChart({ data: [], width: 600, height: 200, color: "#eab308" });
  assertStringIncludes(svg, "<svg");
  assertStringIncludes(svg, "</svg>");
});

Deno.test("donutChart renders segments", () => {
  const svg = donutChart({
    segments: [
      { label: "Feminino", value: 72, color: "#f542c8" },
      { label: "Masculino", value: 28, color: "#42c8f5" },
    ],
    size: 150,
  });
  assertStringIncludes(svg, "<svg");
  assertStringIncludes(svg, "<path");
});

Deno.test("lineChart: pt-BR tick labels, max 4 ticks", () => {
  const data = Array.from({ length: 30 }, (_, i) => ({
    label: `2026-06-${String(i + 1).padStart(2, "0")}`,
    value: 100 + i,
  }));
  const svg = lineChart({ data, width: 660, height: 200, color: "#1C1917" });
  assertStringIncludes(svg, ">1 jun<");
  assertStringIncludes(svg, ">30 jun<");
  assertEquals((svg.match(/class="axis-x"/g) || []).length <= 4, true);
});

Deno.test("lineChart: annotation pill and event marker", () => {
  const data = [
    { label: "2026-06-01", value: 10 },
    { label: "2026-06-15", value: 20 },
    { label: "2026-06-30", value: 40 },
  ];
  const svg = lineChart({
    data, width: 660, height: 200, color: "#1C1917",
    annotation: "+30 no mês",
    eventMarker: { index: 1, label: "Reel · dia 15" },
  });
  assertStringIncludes(svg, "+30 no mês");
  assertStringIncludes(svg, "Reel · dia 15");
});
