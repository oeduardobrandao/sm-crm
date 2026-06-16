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

  const points = data.map((d, i) => `${toX(i)},${toY(d.value)}`).join(" ");

  // Area fills from data line down to the lowest data value, not to the axis baseline
  const areaBottom = toY(paddedMin);
  const areaPoints = [
    `${toX(0)},${areaBottom}`,
    ...data.map((d, i) => `${toX(i)},${toY(d.value)}`),
    `${toX(data.length - 1)},${areaBottom}`,
  ].join(" ");

  // X-axis labels
  const labelStep = Math.max(1, Math.ceil(data.length / 6));
  const lastStepIdx = Math.floor((data.length - 1) / labelStep) * labelStep;
  const xLabels = data
    .map((d, i) => {
      const isLast = i === data.length - 1;
      const isStep = i % labelStep === 0;
      if (!isStep && !isLast) return "";
      if (isLast && !isStep && (data.length - 1 - lastStepIdx) < labelStep * 0.6) return "";
      return `<text x="${toX(i)}" y="${height - 6}" text-anchor="${isLast ? "end" : "middle"}" font-size="9" fill="#9ca3af" font-family="DM Sans, sans-serif">${d.label}</text>`;
    })
    .filter(Boolean)
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
    <text x="${PAD_LEFT - 4}" y="${y}" text-anchor="end" font-size="9" fill="#9ca3af" font-family="DM Sans, sans-serif" dominant-baseline="middle">${label}</text>`;
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
</svg>`;
}

// ---------------------------------------------------------------------------
// comboChart — bars (left Y-axis) + line (right Y-axis, %)
// ---------------------------------------------------------------------------

interface ComboItem {
  label: string;
  barValue: number;
  lineValue: number;
  barColor: string;
}

interface ComboChartOptions {
  items: ComboItem[];
  width: number;
  height: number;
  lineColor: string;
  barLabel: string;
  lineLabel: string;
}

export function comboChart(opts: ComboChartOptions): string {
  const { items, width, height, lineColor, barLabel, lineLabel } = opts;

  const PAD_TOP = 36;
  const PAD_BOTTOM = 36;
  const PAD_LEFT = 48;
  const PAD_RIGHT = 48;
  const plotW = width - PAD_LEFT - PAD_RIGHT;
  const plotH = height - PAD_TOP - PAD_BOTTOM;

  if (items.length === 0) {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"></svg>`;
  }

  // Left Y-axis: bar values (reach)
  let barMax = Math.max(...items.map((d) => d.barValue));
  if (barMax === 0) barMax = 1;

  // Right Y-axis: line values (engagement %)
  let lineMax = Math.max(...items.map((d) => d.lineValue));
  if (lineMax === 0) lineMax = 1;
  lineMax = Math.ceil(lineMax / 5) * 5; // round up to nearest 5%

  const baseY = r(PAD_TOP + plotH);
  const barGap = 24;
  const barCount = items.length;
  const barWidth = Math.min(80, (plotW - barGap * (barCount + 1)) / barCount);
  const totalBarsWidth = barCount * barWidth + (barCount - 1) * barGap;
  const startX = PAD_LEFT + (plotW - totalBarsWidth) / 2;

  const toBarH = (v: number) => r((v / barMax) * plotH);
  const toLineY = (v: number) => r(PAD_TOP + plotH - (v / lineMax) * plotH);

  // Legend
  const legend = `<rect x="${PAD_LEFT}" y="8" width="10" height="10" rx="2" fill="${items[0]?.barColor ?? "#888"}"/>
    <text x="${PAD_LEFT + 14}" y="17" font-size="9" fill="#9ca3af" font-family="DM Sans, sans-serif">${barLabel}</text>
    <line x1="${PAD_LEFT + 130}" y1="13" x2="${PAD_LEFT + 148}" y2="13" stroke="${lineColor}" stroke-width="2"/>
    <circle cx="${PAD_LEFT + 139}" cy="13" r="3" fill="${lineColor}"/>
    <text x="${PAD_LEFT + 152}" y="17" font-size="9" fill="#9ca3af" font-family="DM Sans, sans-serif">${lineLabel}</text>`;

  // Left Y-axis ticks (reach)
  const leftTicks = [0, 0.25, 0.5, 0.75, 1].map((pct) => {
    const val = Math.round(barMax * pct);
    const y = r(baseY - toBarH(val));
    const label = val >= 1000 ? `${r(val / 1000, 1)}k` : String(val);
    return `<line x1="${PAD_LEFT}" y1="${y}" x2="${r(PAD_LEFT + plotW)}" y2="${y}" stroke="#9ca3af" stroke-width="0.5" opacity="0.3"/>
    <text x="${PAD_LEFT - 4}" y="${y}" text-anchor="end" font-size="9" fill="#9ca3af" font-family="DM Sans, sans-serif" dominant-baseline="middle">${label}</text>`;
  }).join("\n    ");

  // Right Y-axis ticks (engagement %)
  const rightTicks = [0, 0.25, 0.5, 0.75, 1].map((pct) => {
    const val = r(lineMax * pct, 1);
    const y = r(baseY - (pct * plotH));
    return `<text x="${r(PAD_LEFT + plotW + 4)}" y="${y}" text-anchor="start" font-size="9" fill="${lineColor}" font-family="DM Sans, sans-serif" dominant-baseline="middle">${val}%</text>`;
  }).join("\n    ");

  // Line points (computed first for collision detection)
  const linePoints = items.map((item, i) => {
    const cx = r(startX + i * (barWidth + barGap) + barWidth / 2);
    const cy = toLineY(item.lineValue);
    const barTopY = r(baseY - toBarH(item.barValue));
    return { cx, cy, value: item.lineValue, barTopY };
  });

  const polyline = linePoints.map((p) => `${p.cx},${p.cy}`).join(" ");

  // Bars (rects + category labels only)
  const bars = items.map((item, i) => {
    const bx = r(startX + i * (barWidth + barGap));
    const bh = toBarH(item.barValue);
    const by = r(baseY - bh);
    return `<rect x="${bx}" y="${by}" width="${r(barWidth)}" height="${bh}" fill="${item.barColor}" rx="3"/>
    <text x="${r(bx + barWidth / 2)}" y="${r(baseY + 14)}" text-anchor="middle" font-size="10" fill="#9ca3af" font-family="DM Sans, sans-serif">${item.label}</text>`;
  }).join("\n    ");

  // Bar value labels (separate layer, with collision avoidance against line dots)
  const barValueLabels = items.map((item, i) => {
    const p = linePoints[i];
    const label = item.barValue >= 1000
      ? `${r(item.barValue / 1000, 1)}k`
      : String(Math.round(item.barValue));
    let labelY = r(p.barTopY + 14);
    if (Math.abs(labelY - p.cy) < 18) {
      const belowLine = p.cy + 22;
      const aboveLine = p.cy - 14;
      labelY = belowLine < baseY - 8
        ? r(belowLine)
        : r(Math.max(p.barTopY + 14, aboveLine));
    }
    return `<text x="${p.cx}" y="${labelY}" text-anchor="middle" font-size="9" font-weight="600" fill="#fff" font-family="DM Sans, sans-serif">${label}</text>`;
  }).join("\n    ");

  // Line dot circles (rendered between bars and labels)
  const dotCircles = linePoints.map((p) => {
    return `<circle cx="${p.cx}" cy="${p.cy}" r="4" fill="${lineColor}" stroke="#fff" stroke-width="2"/>`;
  }).join("\n    ");

  // Engagement % pills (topmost layer, with collision avoidance)
  const dotPills = linePoints.map((p) => {
    const label = `${r(p.value, 1)}%`;
    const pillW = label.length * 6.5 + 8;
    const pillH = 16;
    let labelY = r(p.cy - 12);
    const barLabelY = p.barTopY + 14;
    if (Math.abs(labelY - barLabelY) < 18) {
      labelY = r(p.barTopY - 8);
    }
    return `<rect x="${r(p.cx - pillW / 2)}" y="${r(labelY - pillH / 2)}" width="${pillW}" height="${pillH}" rx="8" fill="${lineColor}"/>
    <text x="${p.cx}" y="${r(labelY + 1)}" text-anchor="middle" font-size="8.5" font-weight="700" fill="#fff" font-family="DM Sans, sans-serif" dominant-baseline="middle">${label}</text>`;
  }).join("\n    ");

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  ${legend}
  ${leftTicks}
  ${rightTicks}
  <line x1="${PAD_LEFT}" y1="${baseY}" x2="${r(PAD_LEFT + plotW)}" y2="${baseY}" stroke="#374151" stroke-width="1"/>
  ${bars}
  <polyline points="${polyline}" fill="none" stroke="${lineColor}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>
  ${dotCircles}
  ${barValueLabels}
  ${dotPills}
</svg>`;
}

// ---------------------------------------------------------------------------
// barChart
// ---------------------------------------------------------------------------

interface BarGroup {
  label: string;
  values: { value: number; color: string; label: string; suffix?: string }[];
}

interface LegendItem {
  label: string;
  color: string;
}

interface BarChartOptions {
  groups: BarGroup[];
  width: number;
  height: number;
  legend?: LegendItem[];
}

export function barChart(opts: BarChartOptions): string {
  const { groups, width, height, legend } = opts;

  const PAD_TOP = legend ? 36 : 24;
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
          const suffix = v.suffix ?? "";
          const labelText = v.value >= 1000
            ? `${r(v.value / 1000, 1)}k${suffix}`
            : `${r(v.value, 1)}${suffix}`;
          return `<rect x="${bx}" y="${by}" width="${r(barWidth)}" height="${bh}" fill="${v.color}" rx="3"/>
      <text x="${r(bx + barWidth / 2)}" y="${r(by - 4)}" text-anchor="middle" font-size="9" fill="#9ca3af" font-family="DM Sans, sans-serif">${labelText}</text>`;
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
      return `<line x1="${PAD_LEFT}" y1="${y}" x2="${r(PAD_LEFT + plotW)}" y2="${y}" stroke="#9ca3af" stroke-width="0.5" opacity="0.3"/>
    <text x="${PAD_LEFT - 4}" y="${y}" text-anchor="end" font-size="9" fill="#9ca3af" font-family="DM Sans, sans-serif" dominant-baseline="middle">${labelText}</text>`;
    })
    .join("\n    ");

  const legendSvg = legend
    ? legend.map((item, i) => {
        const lx = PAD_LEFT + i * 140;
        return `<rect x="${lx}" y="8" width="10" height="10" rx="2" fill="${item.color}"/>
    <text x="${lx + 14}" y="17" font-size="9" fill="#9ca3af" font-family="DM Sans, sans-serif">${item.label}</text>`;
      }).join("\n    ")
    : "";

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <!-- legend -->
  ${legendSvg}
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
    return `<text x="${x}" y="${PAD_TOP - 6}" text-anchor="middle" font-size="9" fill="#9ca3af" font-family="DM Sans, sans-serif">${label}</text>`;
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

  // Add padding for labels outside the donut
  const pad = 50;
  const svgW = size + pad * 2;
  const svgH = size + pad;

  if (segments.length === 0) {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${svgW}" height="${svgH}" viewBox="0 0 ${svgW} ${svgH}"></svg>`;
  }

  const cx = svgW / 2;
  const cy = size / 2 + 4;
  const outerR = size * 0.4;
  const innerR = size * 0.24;
  const labelR = outerR + 18;

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

    const midAngle = startAngle + sweep / 2;
    const lp = polarToCartesian(cx, cy, labelR, midAngle);
    const anchor = lp.x > cx + 2 ? "start" : lp.x < cx - 2 ? "end" : "middle";
    const pctStr = `${Math.round(pct * 100)}%`;
    labels.push(
      `<text x="${r(lp.x)}" y="${r(lp.y - 4)}" text-anchor="${anchor}" font-size="9" fill="#9ca3af" font-family="DM Sans, sans-serif" dominant-baseline="middle">${seg.label}</text>`,
      `<text x="${r(lp.x)}" y="${r(lp.y + 8)}" text-anchor="${anchor}" font-size="10" font-weight="700" fill="${seg.color}" font-family="DM Sans, sans-serif" dominant-baseline="middle">${pctStr}</text>`,
    );

    startAngle = endAngle;
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${svgW}" height="${svgH}" viewBox="0 0 ${svgW} ${svgH}">
  ${paths.join("\n  ")}
  ${labels.join("\n  ")}
</svg>`;
}
