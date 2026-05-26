// Server-side SVG chart generators (no DOM, pure string output).
// Designed for embedding in HTML reports that are converted to PDF via Gotenberg.

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Round a number to at most `decimals` decimal places. */
function r(n: number, decimals = 2): number {
  const factor = Math.pow(10, decimals);
  return Math.round(n * factor) / factor;
}

/** Convert polar coordinates to cartesian. */
function polarToCartesian(
  cx: number,
  cy: number,
  radius: number,
  angleDeg: number,
): { x: number; y: number } {
  const rad = ((angleDeg - 90) * Math.PI) / 180;
  return { x: cx + radius * Math.cos(rad), y: cy + radius * Math.sin(rad) };
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
}

export function lineChart(opts: LineChartOptions): string {
  const { data, width, height, color, markers = [] } = opts;

  const PAD_TOP = 16;
  const PAD_BOTTOM = 32;
  const PAD_LEFT = 40;
  const PAD_RIGHT = 16;
  const plotW = width - PAD_LEFT - PAD_RIGHT;
  const plotH = height - PAD_TOP - PAD_BOTTOM;

  // Handle empty or single-point data gracefully
  if (data.length === 0) {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"></svg>`;
  }

  const values = data.map((d) => d.value);
  const maxVal = Math.max(...values);
  const minVal = Math.min(...values);
  const range = maxVal - minVal || 1; // avoid div-by-zero for flat lines

  /** Map a data value to SVG y coordinate (higher value → lower y). */
  const toY = (v: number) =>
    r(PAD_TOP + plotH - ((v - minVal) / range) * plotH);

  /** Map a data index to SVG x coordinate. */
  const toX = (i: number) =>
    r(PAD_LEFT + (data.length === 1 ? plotW / 2 : (i / (data.length - 1)) * plotW));

  // Build polyline points
  const points = data.map((d, i) => `${toX(i)},${toY(d.value)}`).join(" ");

  // Build filled area polygon (close back along baseline)
  const areaPoints = [
    `${toX(0)},${r(PAD_TOP + plotH)}`,
    ...data.map((d, i) => `${toX(i)},${toY(d.value)}`),
    `${toX(data.length - 1)},${r(PAD_TOP + plotH)}`,
  ].join(" ");

  // X-axis labels (show first, last, and evenly spaced up to ~6)
  const labelStep = Math.max(1, Math.ceil(data.length / 6));
  const xLabels = data
    .map((d, i) => {
      if (i % labelStep !== 0 && i !== data.length - 1) return "";
      return `<text x="${toX(i)}" y="${height - 6}" text-anchor="middle" font-size="9" fill="#9ca3af" font-family="DM Mono, monospace">${d.label}</text>`;
    })
    .filter(Boolean)
    .join("");

  // Y-axis labels (min and max)
  const yAxisLabels = `
    <text x="${PAD_LEFT - 4}" y="${r(PAD_TOP + plotH)}" text-anchor="end" font-size="9" fill="#9ca3af" font-family="DM Mono, monospace" dominant-baseline="middle">${r(minVal, 0)}</text>
    <text x="${PAD_LEFT - 4}" y="${PAD_TOP}" text-anchor="end" font-size="9" fill="#9ca3af" font-family="DM Mono, monospace" dominant-baseline="middle">${r(maxVal, 0)}</text>`;

  // Marker lines (vertical dashed lines at matching labels)
  const markerLines = markers
    .map((m) => {
      const idx = data.findIndex((d) => d.label === m.label);
      if (idx === -1) return "";
      const x = toX(idx);
      return `<line x1="${x}" y1="${PAD_TOP}" x2="${x}" y2="${r(PAD_TOP + plotH)}" stroke="${m.color}" stroke-width="1" stroke-dasharray="3,2" opacity="0.7"/>`;
    })
    .join("");

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <!-- grid line -->
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
  <!-- axis labels -->
  ${yAxisLabels}
  ${xLabels}
</svg>`;
}

// ---------------------------------------------------------------------------
// barChart
// ---------------------------------------------------------------------------

interface BarGroup {
  label: string;
  values: { value: number; color: string; label: string }[];
}

interface BarChartOptions {
  groups: BarGroup[];
  width: number;
  height: number;
}

export function barChart(opts: BarChartOptions): string {
  const { groups, width, height } = opts;

  const PAD_TOP = 24;
  const PAD_BOTTOM = 36;
  const PAD_LEFT = 48;
  const PAD_RIGHT = 16;
  const plotW = width - PAD_LEFT - PAD_RIGHT;
  const plotH = height - PAD_TOP - PAD_BOTTOM;

  if (groups.length === 0) {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"></svg>`;
  }

  // Find max value across all groups and all bar series
  let maxVal = 0;
  for (const g of groups) {
    for (const v of g.values) {
      if (v.value > maxVal) maxVal = v.value;
    }
  }
  if (maxVal === 0) maxVal = 1;

  const maxBarsPerGroup = Math.max(...groups.map((g) => g.values.length));
  const groupCount = groups.length;
  const groupGap = 12;
  const barGap = 3;
  const totalGap = groupGap * (groupCount - 1);
  const groupWidth = (plotW - totalGap) / groupCount;
  const barWidth = (groupWidth - barGap * (maxBarsPerGroup - 1)) / maxBarsPerGroup;

  /** Map a value to bar height in pixels. */
  const toBarH = (v: number) => r((v / maxVal) * plotH);
  const baseY = r(PAD_TOP + plotH);

  const bars = groups
    .map((g, gi) => {
      const groupX = r(PAD_LEFT + gi * (groupWidth + groupGap));
      const rects = g.values
        .map((v, vi) => {
          const bx = r(groupX + vi * (barWidth + barGap));
          const bh = toBarH(v.value);
          const by = r(baseY - bh);
          // Format label above bar
          const labelText = v.value >= 1000
            ? `${r(v.value / 1000, 1)}k`
            : String(v.value);
          return `<rect x="${bx}" y="${by}" width="${r(barWidth)}" height="${bh}" fill="${v.color}" rx="3"/>
      <text x="${r(bx + barWidth / 2)}" y="${r(by - 4)}" text-anchor="middle" font-size="9" fill="#9ca3af" font-family="DM Mono, monospace">${labelText}</text>`;
        })
        .join("\n      ");

      // Group label below axis
      const labelX = r(groupX + groupWidth / 2);
      return `${rects}
    <text x="${labelX}" y="${r(baseY + 14)}" text-anchor="middle" font-size="10" fill="#9ca3af" font-family="DM Sans, sans-serif">${g.label}</text>`;
    })
    .join("\n    ");

  // Y-axis ticks (0, 25%, 50%, 75%, 100% of max)
  const ticks = [0, 0.25, 0.5, 0.75, 1]
    .map((pct) => {
      const val = Math.round(maxVal * pct);
      const y = r(baseY - toBarH(val));
      const labelText = val >= 1000 ? `${r(val / 1000, 1)}k` : String(val);
      return `<line x1="${PAD_LEFT}" y1="${y}" x2="${r(PAD_LEFT + plotW)}" y2="${y}" stroke="#1e2430" stroke-width="1"/>
    <text x="${PAD_LEFT - 4}" y="${y}" text-anchor="end" font-size="9" fill="#9ca3af" font-family="DM Mono, monospace" dominant-baseline="middle">${labelText}</text>`;
    })
    .join("\n    ");

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <!-- grid lines & y-axis labels -->
  ${ticks}
  <!-- bars -->
  ${bars}
  <!-- x-axis baseline -->
  <line x1="${PAD_LEFT}" y1="${baseY}" x2="${r(PAD_LEFT + plotW)}" y2="${baseY}" stroke="#374151" stroke-width="1"/>
</svg>`;
}

// ---------------------------------------------------------------------------
// heatmapChart
// ---------------------------------------------------------------------------

interface HeatmapOptions {
  data: { day: number; hour: number; value: number }[];
  width: number;
  height: number;
  color: string;
}

export function heatmapChart(opts: HeatmapOptions): string {
  const { data, width, height, color } = opts;

  const DAY_LABELS = ["Seg", "Ter", "Qua", "Qui", "Sex", "Sáb", "Dom"];
  const HOUR_LABELS = ["0", "6", "12", "18"];

  const PAD_TOP = 20;
  const PAD_LEFT = 32;
  const PAD_RIGHT = 8;
  const PAD_BOTTOM = 8;

  const gridW = width - PAD_LEFT - PAD_RIGHT;
  const gridH = height - PAD_TOP - PAD_BOTTOM;
  const cellW = r(gridW / 24);
  const cellH = r(gridH / 7);
  const gap = 1.5;

  // Build lookup map from (day, hour) → value
  const lookup = new Map<string, number>();
  let maxVal = 0;
  for (const d of data) {
    const key = `${d.day},${d.hour}`;
    lookup.set(key, d.value);
    if (d.value > maxVal) maxVal = d.value;
  }
  if (maxVal === 0) maxVal = 1;

  // Render cells
  const cells: string[] = [];
  for (let day = 0; day < 7; day++) {
    for (let hour = 0; hour < 24; hour++) {
      const val = lookup.get(`${day},${hour}`) ?? 0;
      const opacity = r(0.1 + (val / maxVal) * 0.9, 2);
      const x = r(PAD_LEFT + hour * cellW + gap / 2);
      const y = r(PAD_TOP + day * cellH + gap / 2);
      const w = r(cellW - gap);
      const h = r(cellH - gap);
      cells.push(
        `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${color}" opacity="${opacity}" rx="2"/>`,
      );
    }
  }

  // Day labels (left)
  const dayLabels = DAY_LABELS.map((label, i) => {
    const y = r(PAD_TOP + i * cellH + cellH / 2);
    return `<text x="${PAD_LEFT - 4}" y="${y}" text-anchor="end" font-size="9" fill="#9ca3af" font-family="DM Sans, sans-serif" dominant-baseline="middle">${label}</text>`;
  }).join("");

  // Hour labels (top, at hours 0, 6, 12, 18)
  const hourLabels = HOUR_LABELS.map((label, idx) => {
    const hour = idx * 6;
    const x = r(PAD_LEFT + hour * cellW + cellW / 2);
    return `<text x="${x}" y="${PAD_TOP - 6}" text-anchor="middle" font-size="9" fill="#9ca3af" font-family="DM Mono, monospace">${label}</text>`;
  }).join("");

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  ${hourLabels}
  ${dayLabels}
  ${cells.join("\n  ")}
</svg>`;
}

// ---------------------------------------------------------------------------
// donutChart
// ---------------------------------------------------------------------------

interface DonutSegment {
  label: string;
  value: number;
  color: string;
}

interface DonutChartOptions {
  segments: DonutSegment[];
  size: number;
}

export function donutChart(opts: DonutChartOptions): string {
  const { segments, size } = opts;

  if (segments.length === 0) {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}"></svg>`;
  }

  const cx = size / 2;
  const cy = size / 2;
  const outerR = size * 0.4;
  const innerR = size * 0.24; // ~40% of outer for donut hole
  const labelR = outerR + 14; // radius for label anchors

  const total = segments.reduce((sum, s) => sum + s.value, 0) || 1;

  let startAngle = 0;
  const paths: string[] = [];
  const labels: string[] = [];

  for (const seg of segments) {
    const pct = seg.value / total;
    const sweep = pct * 360;
    const endAngle = startAngle + sweep;
    const largeArc = sweep > 180 ? 1 : 0;

    const p1 = polarToCartesian(cx, cy, outerR, startAngle);
    const p2 = polarToCartesian(cx, cy, outerR, endAngle);
    const p3 = polarToCartesian(cx, cy, innerR, endAngle);
    const p4 = polarToCartesian(cx, cy, innerR, startAngle);

    const d = [
      `M ${r(p1.x)} ${r(p1.y)}`,
      `A ${r(outerR)} ${r(outerR)} 0 ${largeArc} 1 ${r(p2.x)} ${r(p2.y)}`,
      `L ${r(p3.x)} ${r(p3.y)}`,
      `A ${r(innerR)} ${r(innerR)} 0 ${largeArc} 0 ${r(p4.x)} ${r(p4.y)}`,
      "Z",
    ].join(" ");

    paths.push(`<path d="${d}" fill="${seg.color}"/>`);

    // Label at midpoint angle
    const midAngle = startAngle + sweep / 2;
    const lp = polarToCartesian(cx, cy, labelR, midAngle);
    const anchor = lp.x > cx + 2 ? "start" : lp.x < cx - 2 ? "end" : "middle";
    const pctStr = `${Math.round(pct * 100)}%`;
    labels.push(
      `<text x="${r(lp.x)}" y="${r(lp.y - 4)}" text-anchor="${anchor}" font-size="9" fill="#9ca3af" font-family="DM Sans, sans-serif" dominant-baseline="middle">${seg.label}</text>`,
      `<text x="${r(lp.x)}" y="${r(lp.y + 8)}" text-anchor="${anchor}" font-size="10" font-weight="700" fill="${seg.color}" font-family="DM Mono, monospace" dominant-baseline="middle">${pctStr}</text>`,
    );

    startAngle = endAngle;
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  ${paths.join("\n  ")}
  ${labels.join("\n  ")}
</svg>`;
}
