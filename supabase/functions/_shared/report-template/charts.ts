// Server-side SVG chart generators (no DOM, pure string output).
// Designed for embedding in HTML reports that are converted to PDF via Gotenberg.

import { escapeHtml } from "./escape.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const MONTHS_PT = [
  "jan", "fev", "mar", "abr", "mai", "jun",
  "jul", "ago", "set", "out", "nov", "dez",
];

/** Format an ISO `YYYY-MM-DD` label as pt-BR short date, e.g. "1 jun". Falls back to the raw label. */
function fmtTick(label: string): string {
  const m = label.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return label;
  return `${parseInt(m[3], 10)} ${MONTHS_PT[parseInt(m[2], 10) - 1]}`;
}

/** Round a number to at most `decimals` decimal places. */
function r(n: number, decimals = 2): number {
  const factor = Math.pow(10, decimals);
  return Math.round(n * factor) / factor;
}

// ---------------------------------------------------------------------------
// lineChart
// ---------------------------------------------------------------------------

interface LineChartOptions {
  data: { label: string; value: number }[];
  width: number;
  height: number;
  color: string;
  markers?: { label: string; color: string }[];
  /** Pill annotation anchored at the last data point, e.g. "+482 no mês". */
  annotation?: string;
  /** Hollow dot + label above one data point, e.g. a post-publish spike. */
  eventMarker?: { index: number; label: string };
}

export function lineChart(opts: LineChartOptions): string {
  const { data, width, height, color, markers = [], annotation, eventMarker } = opts;

  const PAD_TOP = 16;
  const PAD_BOTTOM = 32;
  const PAD_LEFT = 48;
  const PAD_RIGHT = 16;
  const plotW = width - PAD_LEFT - PAD_RIGHT;
  const plotH = height - PAD_TOP - PAD_BOTTOM;

  if (data.length === 0) {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"></svg>`;
  }

  const values = data.map((d) => d.value);
  const rawMax = Math.max(...values);
  const rawMin = Math.min(...values);
  const rawRange = rawMax - rawMin || 1;

  // Add 10% padding below and 5% above so the line doesn't sit on the baseline
  const paddedMin = Math.max(0, rawMin - rawRange * 0.1);
  const paddedMax = rawMax + rawRange * 0.05;
  const range = paddedMax - paddedMin || 1;

  const toY = (v: number) =>
    r(PAD_TOP + plotH - ((v - paddedMin) / range) * plotH);

  const toX = (i: number) =>
    r(PAD_LEFT + (data.length === 1 ? plotW / 2 : (i / (data.length - 1)) * plotW));

  const pts = data.map((d, i) => ({ x: toX(i), y: toY(d.value) }));
  const points = pts.map((p) => `${p.x},${p.y}`).join(" ");

  // Area fills from data line down to the lowest data value, not to the axis baseline
  const areaBottom = toY(paddedMin);
  const areaPoints = [
    `${toX(0)},${areaBottom}`,
    ...data.map((d, i) => `${toX(i)},${toY(d.value)}`),
    `${toX(data.length - 1)},${areaBottom}`,
  ].join(" ");

  // X-axis labels: at most 4 ticks (first, ~1/3, ~2/3, last), pt-BR short dates
  const n = data.length;
  const tickIdx = n <= 4
    ? data.map((_, i) => i)
    : [0, Math.round(n / 3), Math.round((2 * n) / 3), n - 1];
  const xLabels = tickIdx
    .map((i) => {
      const isLast = i === n - 1;
      return `<text x="${toX(i)}" y="${height - 6}" text-anchor="${isLast ? "end" : "middle"}" font-size="9" fill="#8A8A8A" font-family="'Instrument Sans', sans-serif" class="axis-x">${escapeHtml(fmtTick(data[i].label))}</text>`;
    })
    .join("");

  // Y-axis: compute 4 nice tick values spanning the padded range
  const tickCount = 4;
  const rawStep = range / tickCount;
  const magnitude = Math.pow(10, Math.floor(Math.log10(rawStep)));
  const niceStep = Math.ceil(rawStep / magnitude) * magnitude;
  const tickStart = Math.floor(paddedMin / niceStep) * niceStep;

  const yTicks: number[] = [];
  for (let v = tickStart; v <= paddedMax + niceStep * 0.5; v += niceStep) {
    if (v >= paddedMin && v <= paddedMax) yTicks.push(v);
  }
  if (yTicks.length < 2) {
    yTicks.length = 0;
    for (let i = 0; i <= tickCount; i++) {
      yTicks.push(Math.round(paddedMin + (range * i) / tickCount));
    }
  }

  const gridLines = yTicks
    .map((v) => {
      const y = toY(v);
      const label = v >= 10000 ? `${r(v / 1000, 1)}k` : String(Math.round(v));
      return `<line x1="${PAD_LEFT}" y1="${y}" x2="${r(PAD_LEFT + plotW)}" y2="${y}" stroke="#9ca3af" stroke-width="0.5" opacity="0.3"/>
    <text x="${PAD_LEFT - 4}" y="${y}" text-anchor="end" font-size="9" fill="#8A8A8A" font-family="'Instrument Sans', sans-serif" dominant-baseline="middle">${label}</text>`;
    })
    .join("\n    ");

  const markerLines = markers
    .map((m) => {
      const idx = data.findIndex((d) => d.label === m.label);
      if (idx === -1) return "";
      const x = toX(idx);
      return `<line x1="${x}" y1="${PAD_TOP}" x2="${x}" y2="${r(PAD_TOP + plotH)}" stroke="${m.color}" stroke-width="1" stroke-dasharray="3,2" opacity="0.7"/>`;
    })
    .join("");

  // Event marker: hollow dot + label above a specific point (e.g. a spike from a published post)
  let eventMarkerSvg = "";
  if (eventMarker && pts[eventMarker.index]) {
    const p = pts[eventMarker.index];
    // anchor away from the plot edges so the label never overflows the viewBox
    const anchor = eventMarker.index === 0 ? "start" : eventMarker.index === n - 1 ? "end" : "middle";
    const labelY = Math.max(p.y - 12, PAD_TOP - 4);
    eventMarkerSvg = `<circle cx="${p.x}" cy="${p.y}" r="3.5" fill="#FAFAF7" stroke="${color}" stroke-width="2"/>
  <text x="${p.x}" y="${labelY}" text-anchor="${anchor}" font-size="9" fill="#8A8A8A" font-family="'Instrument Sans', sans-serif" class="axis">${escapeHtml(eventMarker.label)}</text>`;
  }

  // Annotation pill: net-change callout anchored at the last data point.
  // Positioned to the LEFT of the last point (never past the right edge, since the
  // last point sits at/near the plot's right edge) and clamped on both axes so it
  // can't fall outside the SVG viewBox or slide behind the y-axis on a narrow chart.
  let annotationSvg = "";
  if (annotation) {
    const last = pts[pts.length - 1];
    const w = annotation.length * 6.2 + 18;
    const rx = Math.max(4, Math.min(last.x - w - 10, width - w - 8));
    const ry = Math.max(last.y - 24, 6);
    // Note: the pill label's fill MUST be set via inline style, not a class — a
    // shared `.axis` CSS rule (gray fill) would override a presentation `fill`
    // attribute on the same element and silently render gray-on-dark, unreadable.
    annotationSvg = `<circle cx="${last.x}" cy="${last.y}" r="4" fill="${color}"/>
  <rect x="${rx}" y="${ry}" rx="10" width="${w}" height="21" fill="#1C1917"/>
  <text x="${rx + w / 2}" y="${ry + 14}" text-anchor="middle" style="font-family:'Instrument Sans',sans-serif;font-size:10px;font-weight:600;fill:#FAFAF7">${escapeHtml(annotation)}</text>`;
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <!-- grid lines & y-axis labels -->
  ${gridLines}
  <!-- axes -->
  <line x1="${PAD_LEFT}" y1="${PAD_TOP}" x2="${PAD_LEFT}" y2="${r(PAD_TOP + plotH)}" stroke="#374151" stroke-width="1"/>
  <line x1="${PAD_LEFT}" y1="${r(PAD_TOP + plotH)}" x2="${r(PAD_LEFT + plotW)}" y2="${r(PAD_TOP + plotH)}" stroke="#374151" stroke-width="1"/>
  <!-- filled area -->
  <polygon points="${areaPoints}" fill="${color}" opacity="0.12"/>
  <!-- marker lines -->
  ${markerLines}
  <!-- data line -->
  <polyline points="${points}" fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>
  <!-- data dots -->
  ${data.length <= 31 ? data.map((d, i) => `<circle cx="${toX(i)}" cy="${toY(d.value)}" r="2.5" fill="${color}"/>`).join("") : ""}
  ${xLabels}
  <!-- event marker -->
  ${eventMarkerSvg}
  <!-- annotation pill -->
  ${annotationSvg}
</svg>`;
}
