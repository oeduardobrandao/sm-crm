import { assertEquals, assertStringIncludes } from "https://deno.land/std@0.208.0/assert/mod.ts";
import { lineChart, barChart, heatmapChart, donutChart } from "./charts.ts";

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

Deno.test("barChart renders grouped bars", () => {
  const svg = barChart({
    groups: [
      { label: "Reels", values: [{ value: 8200, color: "#eab308", label: "Alcance" }] },
      { label: "Carrossel", values: [{ value: 4100, color: "#3ecf8e", label: "Alcance" }] },
    ],
    width: 500,
    height: 250,
  });
  assertStringIncludes(svg, "<svg");
  assertStringIncludes(svg, "<rect");
  assertStringIncludes(svg, "Reels");
});

Deno.test("heatmapChart renders 7x24 grid", () => {
  const data: { day: number; hour: number; value: number }[] = [];
  for (let d = 0; d < 7; d++) {
    for (let h = 0; h < 24; h++) {
      data.push({ day: d, hour: h, value: Math.random() * 5 });
    }
  }
  const svg = heatmapChart({ data, width: 600, height: 200, color: "#eab308" });
  assertStringIncludes(svg, "<svg");
  assertStringIncludes(svg, "<rect");
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
