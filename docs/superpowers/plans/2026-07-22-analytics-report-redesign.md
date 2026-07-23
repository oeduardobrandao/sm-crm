# Analytics Report V2 Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the monthly client report's visual layer with the Hub-language design (spec `docs/superpowers/specs/2026-07-22-analytics-report-redesign-design.md`), including embedded fonts, splash-art/accent whitelabel, AI recommendations page, previous-period baselines, a validated data-color system, and the reworked Configurações → Relatório Mensal section.

**Architecture:** The edge report pipeline stays as-is (generator → Gotenberg → storage); only `_shared/report-template/*` and the generator's data-assembly change. The CRM side touches one settings section and its preview component, plus one SQL migration. Contract changes are staged additively (old + new fields coexist) so every task lands green, with a final cleanup task removing deprecated fields.

**Tech Stack:** Deno edge functions (report template/renderer), React 19 + shadcn (CRM settings), Supabase storage + Postgres migration, Vitest + `deno test`.

**Visual reference:** `docs/superpowers/specs/2026-07-22-analytics-report-redesign-prototype.html` (committed). The template task derives its HTML/CSS from this file — treat it as the source of truth for markup and styles.

## Global Constraints

- PT-BR copy, sentence case everywhere. No uppercase-tracked labels, no monospace fonts in the report.
- No emoji anywhere in template/renderer output (Gotenberg has no emoji font). Stat markers are text: `alc.` `♥` `com.` `salv.` (♥ is a text glyph, allowed).
- The literal `#eab308` must not appear in `template-string.ts` or `render.ts` after this plan.
- Data palette is FIXED (validated 2026-07-22): Reels `#D97706`, Carrosséis `#0D9488`, Imagens `#A21CAF`; heat ramp `#F5DCAE #F0CF93 #ECC178 #E0A344 #CE8418 #B26A08 #8F5306`; audience tint `#E0A344`; priority-alta `#F7E8CE`/`#8F5306`. Never tinted by `brand_color`. If changed, re-run the dataviz validator (all-pairs, light) before merging.
- Brand accent (`--acc`) appears ONLY on: takeaway dash, post rank chips, "formato líder" chip. Resolution mirrors `apps/hub/src/theme.ts` (`#171717` default, luminance clamps).
- Migration filename must use a unique timestamp prefix (CI `migration-version-guard`). Use `20260722000001`.
- Edge functions are Deno: relative `.ts` imports, `npm:` specifiers only.
- Before pushing: `npm run lint`, `npm run format:check`, `npm run test`, `deno test supabase/functions/_shared/report-template/`. Note: running deno tests dirties the root `deno.lock` — `git checkout -- deno.lock` afterwards.
- Commit messages end with `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.

## File Map

| File | Action | Responsibility |
|---|---|---|
| `supabase/migrations/20260722000001_report_v2_branding.sql` | Create | `report_splash_url` column (public URL, mirrors `logo_url`) + deprecation comments |
| `scripts/build-report-fonts.ts` | Create | One-off Deno script: fetch WOFF2 subsets → generate `fonts.ts` |
| `supabase/functions/_shared/report-template/fonts.ts` | Create (generated) | `REPORT_FONTS_CSS` base64 `@font-face` block |
| `supabase/functions/_shared/report-template/types.ts` | Modify | `KpiValue.prev`, `WorkspaceBranding` v2 fields |
| `supabase/functions/_shared/report-template/theme.ts` | Create | `resolveAccent()` (Hub-parity luminance logic) |
| `supabase/functions/_shared/report-template/charts.ts` | Modify | `lineChart` ticks/annotation/marker; `donutChart` ink+stone; (combo/heatmap deleted in Task 5) |
| `supabase/functions/_shared/report-template/template-string.ts` | Rewrite | V2 REPORT_TEMPLATE (from prototype) |
| `supabase/functions/_shared/report-template/template.html` | Delete | Stale, unused |
| `supabase/functions/_shared/report-template/render.ts` | Rewrite | V2 builders, takeaways, page numbering |
| `supabase/functions/_shared/report-template/render.test.ts`, `charts.test.ts`, `theme.test.ts` | Modify/Create | Deno tests |
| `supabase/functions/instagram-report-generator-v2/index.ts` | Modify | prev KPI values, splash fetch, v2 branding |
| `apps/crm/src/pages/configuracao/ConfiguracaoPage.tsx` | Modify | New Relatório Mensal controls |
| `apps/crm/src/pages/configuracao/reportSplash.ts` | Create | `downscaleImage()` util |
| `apps/crm/src/pages/configuracao/ReportPreview.tsx` | Rewrite | Miniature v2 cover preview |
| `apps/crm/src/pages/configuracao/__tests__/…` | Modify/Create | Vitest coverage |

---

### Task 1: Database migration

**Files:**
- Create: `supabase/migrations/20260722000001_report_v2_branding.sql`

**Interfaces:**
- Produces: `workspaces.report_splash_url text NULL` — stores a PUBLIC URL exactly like `workspaces.logo_url` (bucket `avatars`). Read by Task 6 (generator) and Task 8 (settings UI).

- [ ] **Step 1: Write the migration**

```sql
-- Report v2 branding: splash art upload + deprecate v1-only branding fields
ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS report_splash_url text;

COMMENT ON COLUMN workspaces.report_splash_url IS
  'Public URL of the agency-uploaded report cover splash art (avatars bucket, mirrors logo_url). NULL = typographic cover.';
COMMENT ON COLUMN workspaces.report_secondary_color IS 'DEPRECATED 2026-07-22: unused by report v2 template';
COMMENT ON COLUMN workspaces.report_accent_color   IS 'DEPRECATED 2026-07-22: unused by report v2 template';
COMMENT ON COLUMN workspaces.report_font_family    IS 'DEPRECATED 2026-07-22: unused by report v2 template';
COMMENT ON COLUMN workspaces.report_theme          IS 'DEPRECATED 2026-07-22: unused by report v2 template';
```

- [ ] **Step 2: Verify prefix uniqueness**

Run: `ls supabase/migrations | grep -c "^20260722000001"`
Expected: `1`

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260722000001_report_v2_branding.sql
git commit -m "feat(db): add workspaces.report_splash_url, deprecate v1 report branding columns"
```

*(Do NOT `db push` yet — see Task 10 and the staging/prod link gotcha in the spec §9.)*

---

### Task 2: Embedded fonts pipeline

**Files:**
- Create: `scripts/build-report-fonts.ts`
- Create (generated): `supabase/functions/_shared/report-template/fonts.ts`

**Interfaces:**
- Produces: `export const REPORT_FONTS_CSS: string` — a CSS string of `@font-face` rules with base64 `data:font/woff2` sources. Consumed by Task 5 (`render.ts` replaces `{{FONTS_CSS}}`).

- [ ] **Step 1: Write the build script**

```ts
// scripts/build-report-fonts.ts
// One-off generator: fetches latin WOFF2 subsets from Google Fonts and emits
// supabase/functions/_shared/report-template/fonts.ts with base64 @font-face rules.
// Run manually when fonts change: deno run --allow-net --allow-write scripts/build-report-fonts.ts

const FAMILIES = [
  { css: "Fraunces:opsz,wght@9..144,500;9..144,600", name: "Fraunces", weights: [500, 600] },
  { css: "Instrument+Sans:wght@400;500;600;700", name: "Instrument Sans", weights: [400, 500, 600, 700] },
];
// Chrome UA → Google returns woff2 with unicode-range subsets
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36";

let css = "";
for (const fam of FAMILIES) {
  const res = await fetch(
    `https://fonts.googleapis.com/css2?family=${fam.css}&display=swap`,
    { headers: { "User-Agent": UA } },
  );
  css += await res.text() + "\n";
}

// Keep only latin subset blocks (comment marker `/* latin */` precedes each)
const blocks = css.split("/*").filter((b) => b.startsWith(" latin */"));
let out = "";
for (const block of blocks) {
  const face = "/*" + block;
  const m = face.match(/url\((https:[^)]+\.woff2)\)/);
  if (!m) continue;
  const bin = new Uint8Array(await (await fetch(m[1])).arrayBuffer());
  let b64 = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bin.length; i += CHUNK) {
    b64 += String.fromCharCode(...bin.subarray(i, i + CHUNK));
  }
  b64 = btoa(b64);
  out += face
    .replace(/\/\* latin \*\/\s*/, "")
    .replace(m[1], `data:font/woff2;base64,${b64}`)
    .trim() + "\n";
}

const file = `// GENERATED by scripts/build-report-fonts.ts — do not edit by hand.
// Fraunces 500/600 + Instrument Sans 400/500/600/700, latin subset, base64 woff2.
export const REPORT_FONTS_CSS = ${JSON.stringify(out)};
`;
await Deno.writeTextFile(
  "supabase/functions/_shared/report-template/fonts.ts",
  file,
);
console.log(`fonts.ts written: ${(file.length / 1024).toFixed(0)}KB`);
```

- [ ] **Step 2: Run it and sanity-check output**

Run: `deno run --allow-net --allow-write scripts/build-report-fonts.ts`
Expected: `fonts.ts written: NNNKB` with NNN ≤ ~450. Then:

Run: `grep -c "font-family: 'Fraunces'" supabase/functions/_shared/report-template/fonts.ts && grep -c "font-family: 'Instrument Sans'" supabase/functions/_shared/report-template/fonts.ts`
Expected: `2` and `4` (one face per weight).

- [ ] **Step 3: Revert deno.lock if dirtied**

Run: `git status --short deno.lock && git checkout -- deno.lock 2>/dev/null; true`

- [ ] **Step 4: Commit**

```bash
git add scripts/build-report-fonts.ts supabase/functions/_shared/report-template/fonts.ts
git commit -m "feat(report): embed Fraunces + Instrument Sans as base64 woff2 subsets"
```

---

### Task 3: Contract additions + accent resolver (additive, non-breaking)

**Files:**
- Modify: `supabase/functions/_shared/report-template/types.ts`
- Create: `supabase/functions/_shared/report-template/theme.ts`
- Create: `supabase/functions/_shared/report-template/theme.test.ts`

**Interfaces:**
- Produces: `KpiValue.prev?: number | null`; `ReportData.report_month: string` ("YYYY-MM"); `WorkspaceBranding.splash_base64?: string | null` and `WorkspaceBranding.accent_color?: string` (optional for now — old fields stay until Task 7); `resolveAccent(hex: string | null | undefined): { acc: string; accFg: string }` from `theme.ts`.
- Consumed by: Tasks 5 (render), 6 (generator), 7 (cleanup).

- [ ] **Step 1: Write failing tests for the accent resolver**

```ts
// supabase/functions/_shared/report-template/theme.test.ts
import { assertEquals } from "https://deno.land/std@0.208.0/assert/mod.ts";
import { resolveAccent } from "./theme.ts";

Deno.test("resolveAccent: missing/invalid → neutral ink", () => {
  assertEquals(resolveAccent(null), { acc: "#171717", accFg: "#ffffff" });
  assertEquals(resolveAccent("banana"), { acc: "#171717", accFg: "#ffffff" });
  assertEquals(resolveAccent("#fff"), { acc: "#171717", accFg: "#ffffff" }); // only 6-digit hex
});

Deno.test("resolveAccent: too-light brand clamps to ink on light surface", () => {
  assertEquals(resolveAccent("#FFFDF0").acc, "#171717");
});

Deno.test("resolveAccent: dark brand kept, white foreground", () => {
  assertEquals(resolveAccent("#7C2D12"), { acc: "#7C2D12", accFg: "#ffffff" });
});

Deno.test("resolveAccent: light-ish brand kept, ink foreground", () => {
  // luminance between 0.55 and 0.85 → keep hue, dark text on it
  assertEquals(resolveAccent("#FFBF30"), { acc: "#FFBF30", accFg: "#171717" });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `deno test supabase/functions/_shared/report-template/theme.test.ts`
Expected: FAIL (module `./theme.ts` not found)

- [ ] **Step 3: Implement `theme.ts` (port of `apps/hub/src/theme.ts` logic, light mode only)**

```ts
// supabase/functions/_shared/report-template/theme.ts
// Accent resolution for report v2 — mirrors apps/hub/src/theme.ts (light mode).
const HEX_RE = /^#[0-9a-fA-F]{6}$/;

function relativeLuminance(hex: string): number {
  const int = parseInt(hex.slice(1), 16);
  const [r, g, b] = [(int >> 16) & 255, (int >> 8) & 255, int & 255].map((c) => c / 255);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function resolveAccent(
  hex: string | null | undefined,
): { acc: string; accFg: string } {
  let acc = hex && HEX_RE.test(hex) ? hex : "#171717";
  if (relativeLuminance(acc) > 0.85) acc = "#171717"; // unreadable on light paper
  const accFg = relativeLuminance(acc) > 0.55 ? "#171717" : "#ffffff";
  return { acc, accFg };
}
```

- [ ] **Step 4: Run tests**

Run: `deno test supabase/functions/_shared/report-template/theme.test.ts`
Expected: 4 passed

- [ ] **Step 5: Additive type changes**

In `types.ts`, change `KpiValue` and `WorkspaceBranding` to:

```ts
export interface KpiValue {
  id: string;
  value: number;
  unit: "count" | "pct";
  prev?: number | null; // previous month's raw value, same unit
}
```

Also add a machine-readable month to `ReportData` (its existing `period` is the PT-BR label "Junho 2026" and cannot be parsed reliably). Add this field to the `ReportData` interface:

```ts
  report_month: string; // "YYYY-MM" — drives previous-month labels
```

```ts
export interface WorkspaceBranding {
  logo_base64: string | null;
  workspace_name: string;
  // v2 fields (Task 7 makes these required and removes the v1 fields below)
  splash_base64?: string | null;
  accent_color?: string;
  // v1 fields — DEPRECATED, removed in Task 7
  primary_color: string;
  secondary_color: string;
  font_family: string;
  theme: "dark" | "light";
}
```

Note: v1 `accent_color` already exists as required — keep it required here (it becomes the single v2 accent in Task 7).

- [ ] **Step 6: Verify nothing broke**

Run: `deno test supabase/functions/_shared/report-template/`
Expected: all existing tests still pass. Then `git checkout -- deno.lock`.

- [ ] **Step 7: Commit**

```bash
git add supabase/functions/_shared/report-template/types.ts supabase/functions/_shared/report-template/theme.ts supabase/functions/_shared/report-template/theme.test.ts
git commit -m "feat(report): KpiValue.prev + splash branding fields + resolveAccent (hub parity)"
```

---

### Task 4: Chart upgrades (`lineChart`, `donutChart`)

**Files:**
- Modify: `supabase/functions/_shared/report-template/charts.ts` (`lineChart` at ~L37, `donutChart` at ~L489; leave `comboChart`/`heatmapChart`/`barChart` untouched — deleted in Task 5)
- Modify: `supabase/functions/_shared/report-template/charts.test.ts`

**Interfaces:**
- Produces:
  - `LineChartOptions` gains `annotation?: string` and `eventMarker?: { index: number; label: string }`.
  - `lineChart` formats ISO `YYYY-MM-DD` x-labels as pt-BR short (`1 jun`) and renders at most 4 x-ticks (first, ~1/3, ~2/3, last).
  - `DonutChartOptions.segments[i].color` still respected — callers (Task 5) pass ink/stone.
- Consumed by: Task 5 `render.ts`.

- [ ] **Step 1: Write failing tests**

Append to `charts.test.ts` (imports already at top of file):

```ts
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
```

- [ ] **Step 2: Run to verify failure**

Run: `deno test supabase/functions/_shared/report-template/charts.test.ts`
Expected: FAIL (no `annotation` option / no pt-BR labels)

- [ ] **Step 3: Implement in `charts.ts`**

Add to `LineChartOptions`:

```ts
  annotation?: string;                              // pill at the last point, e.g. "+482 no mês"
  eventMarker?: { index: number; label: string };   // hollow dot + label above one point
```

Inside `lineChart`, add a label formatter and tick selection (adapt to the existing scale code in the function — the existing body already computes point x/y arrays):

```ts
const MONTHS_PT = ["jan","fev","mar","abr","mai","jun","jul","ago","set","out","nov","dez"];
function fmtTick(label: string): string {
  const m = label.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return label;
  return `${parseInt(m[3], 10)} ${MONTHS_PT[parseInt(m[2], 10) - 1]}`;
}
const n = opts.data.length;
const tickIdx = n <= 4 ? opts.data.map((_, i) => i)
  : [0, Math.round(n / 3), Math.round((2 * n) / 3), n - 1];
```

Render x-labels only for `tickIdx` (give each `class="axis-x"`), using `fmtTick`. After the polyline, append:

```ts
if (opts.eventMarker) {
  const p = pts[opts.eventMarker.index]; // pts = computed {x,y} array in existing code
  svg += `<circle cx="${p.x}" cy="${p.y}" r="3.5" fill="#FAFAF7" stroke="${opts.color}" stroke-width="2"/>`;
  svg += `<text x="${p.x}" y="${p.y - 12}" text-anchor="middle" class="axis">${escapeHtml(opts.eventMarker.label)}</text>`;
}
if (opts.annotation) {
  const last = pts[pts.length - 1];
  const w = opts.annotation.length * 6.2 + 18;
  const rx = Math.min(last.x - w - 10, opts.width - w - 8);
  svg += `<circle cx="${last.x}" cy="${last.y}" r="4" fill="${opts.color}"/>`;
  svg += `<rect x="${rx}" y="${Math.max(last.y - 24, 6)}" rx="10" width="${w}" height="21" fill="#1C1917"/>`;
  svg += `<text x="${rx + w / 2}" y="${Math.max(last.y - 24, 6) + 14}" text-anchor="middle" style="font-family:'Instrument Sans',sans-serif;font-size:10px;font-weight:600;fill:#FAFAF7">${escapeHtml(opts.annotation)}</text>`;
}
```

(Use `style="…"` on annotation text — a CSS `.axis` class fill would override an SVG `fill` attribute; that bug bit the prototype.) In `donutChart`, no signature change — but replace any default/hardcoded segment colors so callers control all colors, and set center-label fills to `#1C1917`/`#8A8A8A`.

- [ ] **Step 4: Run tests**

Run: `deno test supabase/functions/_shared/report-template/charts.test.ts`
Expected: all pass (old + 2 new). `git checkout -- deno.lock`.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/_shared/report-template/charts.ts supabase/functions/_shared/report-template/charts.test.ts
git commit -m "feat(report): lineChart pt-BR ticks, annotation pill, event marker; neutral donut"
```

---

### Task 5: Template + renderer rewrite (the core task)

**Files:**
- Rewrite: `supabase/functions/_shared/report-template/template-string.ts`
- Rewrite: `supabase/functions/_shared/report-template/render.ts`
- Rewrite: `supabase/functions/_shared/report-template/render.test.ts`
- Modify: `supabase/functions/_shared/report-template/charts.ts` (delete `comboChart` + `heatmapChart` + their option interfaces and tests)
- Delete: `supabase/functions/_shared/report-template/template.html`

**Interfaces:**
- Consumes: `REPORT_FONTS_CSS` (Task 2), `resolveAccent` (Task 3), `lineChart`/`donutChart` (Task 4), `buildFallbackSummary` (existing), `escapeHtml` (existing).
- Produces: `renderReport(opts: { data: ReportData; branding: WorkspaceBranding; aiOutput: AIOutput | null }): string` — signature unchanged; output is the v2 document.

**Template derivation rule:** Start from `docs/superpowers/specs/2026-07-22-analytics-report-redesign-prototype.html`. Keep ALL CSS (minus the Google Fonts `<link>` tags and the `@media screen` body background/shadow, which stay — they only affect Hub view). Replace the fixture content regions with placeholders per this table (every fixture value must end up behind a placeholder — grep the final template for `marina`, `Dermatologia`, `DK Marketing`, `142,3`, `melasma` to confirm none remain):

| Prototype region | Placeholder |
|---|---|
| Google Fonts `<link>` tags + prototype comment | `<style>{{FONTS_CSS}}</style>` |
| `:root` `--acc`/`--acc-fg` values | `{{ACCENT_VARS}}` (renderer emits `--acc: …; --acc-fg: …;`) |
| `<title>` content | `Relatório — {{HANDLE}} — {{PERIOD}}` |
| Cover top-left (logo plate + brand div) | `{{COVER_BRAND}}` |
| Cover month/handle/spec block | `{{COVER_MID}}` |
| Whole `<div class="cover-art">…</div>` incl. placeholder SVG | `{{COVER_ART}}` (empty string when no splash) |
| The 3 teaser cells | `{{COVER_TEASER}}` |
| Each "Leitura do mês" takeaway block (5×) | `{{TAKEAWAY_RESUMO}}` `{{TAKEAWAY_CRESCIMENTO}}` `{{TAKEAWAY_FORMATOS}}` `{{TAKEAWAY_POSTS}}` `{{TAKEAWAY_AUDIENCIA}}` `{{TAKEAWAY_PLANO}}` (formatos gets its own; empty string = block omitted) |
| Summary card inner text | `{{EXECUTIVE_SUMMARY}}` |
| 4 KPI cards | `{{KPI_CARDS}}` |
| Destaques 2 cards | `{{HIGHLIGHTS}}` |
| 4 TOC items | `{{TOC_ITEMS}}` |
| Follower chart `<svg>` | `{{FOLLOWER_CHART}}` |
| 3 format cards | `{{FORMAT_CARDS}}` |
| 3 complementary KPI cards | `{{AUX_KPIS}}` |
| 6 post cards | `{{TOP_POST_CARDS}}` |
| `post-rest` rows | `{{POST_LIST_ROWS}}` (whole `<div class="post-rest">` wrapped in `{{#IF_HAS_LIST}}…{{/IF_HAS_LIST}}`) |
| Topics table body + section | wrap section in `{{#IF_HAS_TAGS}}…{{/IF_HAS_TAGS}}`, body `{{TAGS_TABLE}}` |
| Audience page | wrap page in `{{#IF_HAS_AUDIENCE}}…{{/IF_HAS_AUDIENCE}}`; donut+age `{{DEMOGRAPHICS}}`; cities/countries `{{LOCATION}}`; heatmap section wrapped in `{{#IF_HAS_HEATMAP}}…{{/IF_HAS_HEATMAP}}` with `{{HEATMAP_TABLE}}` and `{{HEAT_CHIPS}}` |
| Page 6 (recommendations) | wrap page in `{{#IF_HAS_AI}}…{{/IF_HAS_AI}}`; `{{RECO_CARDS}}`, `{{GOAL_CARDS}}`, `{{CLOSING}}` |
| Every `.page-footer` | `{{FOOTER}}` (single token, `replaceAll` — contains `{{PAGE_NO}}`) |
| Footer page number `2 / 6` etc. | inside footer builder: `{{PAGE_NO}} / {{PAGE_TOTAL}}` |
| Section index `01 / 05` etc. | `{{SEC_NO}} / {{SEC_TOTAL}}` tokens in each `.sec .idx` |

- [ ] **Step 1: Rewrite `render.test.ts` first (failing)** — replace the whole file:

```ts
import {
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.208.0/assert/mod.ts";
import { renderReport } from "./render.ts";
import type { AIOutput, ReportData, WorkspaceBranding } from "./types.ts";

const branding: WorkspaceBranding = {
  logo_base64: null,
  splash_base64: null,
  workspace_name: "Agência Teste",
  accent_color: "#7C2D12",
  // v1 fields still present until Task 7:
  primary_color: "#7C2D12",
  secondary_color: "#1a1e26",
  font_family: "DM Sans",
  theme: "light",
};

function makeData(): ReportData {
  return {
    handle: "@drajuliana",
    specialty: "Dermatologia",
    period: "Junho 2026",
    report_month: "2026-06",
    kpis: {
      followers_gained: { id: "followers_gained", value: 347, unit: "count", prev: 310 },
      engagement_rate: { id: "engagement_rate", value: 4.2, unit: "pct", prev: 4.3 },
      reach: { id: "reach", value: 45200, unit: "count", prev: 35100 },
      saves: { id: "saves", value: 1800, unit: "count", prev: 1275 },
      posts_count: { id: "posts_count", value: 18, unit: "count", prev: 18 },
      profile_views: { id: "profile_views", value: 1200, unit: "count" },
      website_clicks: { id: "website_clicks", value: 89, unit: "count", prev: 91 },
    },
    kpi_deltas: {
      followers_pct_change: 12.4,
      engagement_pct_change: -0.3,
      reach_pct_change: 28.9,
      saves_pct_change: 41.2,
    },
    top_posts: Array.from({ length: 12 }, (_, i) => ({
      type: (["reel", "carousel", "image"] as const)[i % 3],
      reach: 12400 - i * 800,
      engagement: 6.8 - i * 0.3,
      saves: 220 - i * 10,
      likes: 900 - i * 40,
      comments: 40 - i,
      caption_preview: `Post número ${i + 1} sobre skincare`,
      thumbnail_base64: null,
    })),
    content_breakdown: {
      reels: { count: 6, avg_reach: 9800, avg_engagement: 0.058 },
      carousels: { count: 8, avg_reach: 5200, avg_engagement: 0.047 },
      images: { count: 4, avg_reach: 2100, avg_engagement: 0.031 },
    },
    audience: {
      gender_split: { female: 71.2, male: 28.8 },
      top_age_ranges: [{ range: "25-34", pct: 41.0 }],
      top_cities: [{ name: "Fortaleza", pct: 38.2 }],
      top_countries: [{ name: "Brasil", pct: 95.1 }],
    },
    best_times: [
      { day: "qua", hour: 19, avg_engagement: 6.3 },
      { day: "qui", hour: 20, avg_engagement: 5.8 },
      { day: "seg", hour: 19, avg_engagement: 5.2 },
    ],
    tags_performance: [{ tag: "Melasma", avg_engagement: 6.1, avg_reach: 18300, count: 4 }],
    follower_trend: Array.from({ length: 30 }, (_, i) => ({
      date: `2026-06-${String(i + 1).padStart(2, "0")}`,
      count: 24000 + i * 12,
    })),
  };
}

const ai: AIOutput = {
  executive_summary: "Resumo executivo de teste.",
  detailed_analysis: "Análise detalhada (não renderizada).",
  recommendations: [
    { title: "Dobrar Reels", description: "Porque sim.", priority: "high" },
    { title: "Rever imagens", description: "Rendem pouco.", priority: "medium" },
  ],
  suggested_goals: [
    { metric: "Alcance", target: "50 mil", rationale: "Continuidade." },
  ],
};

Deno.test("renders v2 skeleton: fonts, accent vars, no v1 yellow, no emoji, no leftover placeholders", () => {
  const html = renderReport({ data: makeData(), branding, aiOutput: ai });
  assertStringIncludes(html, "font-family: 'Fraunces'");
  assertStringIncludes(html, "--acc: #7C2D12");
  assertEquals(html.includes("#eab308"), false);
  assertEquals(/\p{Extended_Pictographic}/u.test(html), false);
  assertEquals(/{{[A-Z_#/]+}}/.test(html), false);
});

Deno.test("prev values render as previous-month notes; cover teaser carries baseline", () => {
  const html = renderReport({ data: makeData(), branding, aiOutput: ai });
  assertStringIncludes(html, "maio: 35,1"); // reach prev, pt-BR compact
  assertStringIncludes(html, "maio: 310");
});

Deno.test("AI page renders recommendations, goals, priorities", () => {
  const html = renderReport({ data: makeData(), branding, aiOutput: ai });
  assertStringIncludes(html, "Dobrar Reels");
  assertStringIncludes(html, "Prioridade alta");
  assertStringIncludes(html, "50 mil");
  assertEquals(html.includes("Análise detalhada"), false); // detailed_analysis not rendered
});

Deno.test("no AI → plan page dropped and pages renumber", () => {
  const html = renderReport({ data: makeData(), branding, aiOutput: null });
  assertEquals(html.includes("Recomendações"), false);
  assertStringIncludes(html, "2 / 5"); // 5 pages total without the plan page
});

Deno.test("no audience → audience page dropped", () => {
  const data = makeData();
  data.audience = null;
  data.best_times = [];
  const html = renderReport({ data, branding, aiOutput: ai });
  assertEquals(html.includes("Quem é a sua audiência"), false);
});

Deno.test("splash art embedded when present, absent otherwise", () => {
  const withSplash = renderReport({
    data: makeData(),
    branding: { ...branding, splash_base64: "data:image/jpeg;base64,AAAA" },
    aiOutput: ai,
  });
  assertStringIncludes(withSplash, 'class="cover-art"');
  const without = renderReport({ data: makeData(), branding, aiOutput: ai });
  assertEquals(without.includes('class="cover-art"'), false);
});

Deno.test("format colors present as dots; heatmap uses ramp", () => {
  const html = renderReport({ data: makeData(), branding, aiOutput: ai });
  assertStringIncludes(html, "#D97706");
  assertStringIncludes(html, "#0D9488");
  assertStringIncludes(html, "#A21CAF");
  assertStringIncludes(html, "#8F5306"); // darkest ramp step (1º chip / hottest cell)
});

Deno.test("posts 7+ render as list rows", () => {
  const html = renderReport({ data: makeData(), branding, aiOutput: ai });
  assertStringIncludes(html, 'class="post-rest"');
  assertStringIncludes(html, "Post número 12");
});
```

- [ ] **Step 2: Run to verify failure**

Run: `deno test supabase/functions/_shared/report-template/render.test.ts`
Expected: FAIL (old renderer/template)

- [ ] **Step 3: Rewrite `template-string.ts`**

Apply the derivation rule + placeholder table above to the committed prototype. Structural notes:
- 6 `.page` divs; pages 5 (`IF_HAS_AUDIENCE`) and 6 (`IF_HAS_AI`) fully wrapped in conditionals; heatmap section nested `IF_HAS_HEATMAP` inside audience page.
- Keep the prototype's `@media screen and (max-width: 860px)` block verbatim.
- `.sec .idx` tokens: use literal `{{SEC_NO}} / {{SEC_TOTAL}}` on each section header that has an index; renderer substitutes sequentially.
- Footer block appears once per content page as `{{FOOTER}}`.

- [ ] **Step 4: Rewrite `render.ts`**

Skeleton (all builders in this one file; complete the HTML bodies by copying the corresponding block from the prototype and interpolating):

```ts
import type { AIOutput, KpiValue, ReportData, TopPost, WorkspaceBranding } from "./types.ts";
import { escapeHtml } from "./escape.ts";
import { donutChart, lineChart } from "./charts.ts";
import { buildFallbackSummary } from "./fallback.ts";
import { resolveAccent } from "./theme.ts";
import { REPORT_FONTS_CSS } from "./fonts.ts";
import { REPORT_TEMPLATE } from "./template-string.ts";

// ── fixed data palette (validated 2026-07-22 — see spec §3.2; re-validate if changed)
const FMT = { reel: "#D97706", carousel: "#0D9488", image: "#A21CAF" } as const;
const HEAT = ["#F5DCAE", "#F0CF93", "#ECC178", "#E0A344", "#CE8418", "#B26A08", "#8F5306"];
const AUDIENCE_TINT = "#E0A344";

const MONTHS_PT_FULL = ["janeiro","fevereiro","março","abril","maio","junho","julho","agosto","setembro","outubro","novembro","dezembro"];

function fmtNum(n: number, d = 0): string {
  return n.toLocaleString("pt-BR", { minimumFractionDigits: d, maximumFractionDigits: d });
}
function fmtCompact(n: number): string {
  if (n >= 1_000_000) return fmtNum(n / 1_000_000, 1) + " mi";
  if (n >= 1_000) return fmtNum(n / 1_000, 1) + " mil";
  return fmtNum(n);
}
function fmtKpi(kpi: KpiValue, v: number): string {
  return kpi.unit === "pct" ? fmtNum(v, 1) + "%" : fmtCompact(v);
}
// previous-month name from ReportData.report_month ("2026-06" → "maio")
export function prevMonthName(reportMonth: string): string {
  const m = parseInt(reportMonth.split("-")[1], 10);
  if (!m || m < 1 || m > 12) return "mês anterior";
  return MONTHS_PT_FULL[(m + 10) % 12];
}
function deltaNote(kpi: KpiValue, prevName: string): string {
  if (kpi.prev === undefined || kpi.prev === null) return `<span class="delta-note">vs. ${escapeHtml(prevName)}</span>`;
  return `<span class="delta-note">${escapeHtml(prevName)}: ${escapeHtml(fmtKpi(kpi, kpi.prev))}</span>`;
}
function deltaChip(delta: number | undefined): string { /* ▲/▼/= chip, classes delta up|down|flat, as prototype */ }

// section builders — each returns final HTML for its placeholder
function buildCoverBrand(b: Required2) { /* logo plate (if logo_base64) + workspace name */ }
function buildCoverMid(d: ReportData) { /* dash month + Fraunces handle + specialty */ }
function buildCoverArt(b) { return b.splash_base64 ? `<div class="cover-art"><img src="${escapeHtml(b.splash_base64)}" alt=""></div>` : ""; }
function buildCoverTeaser(d) { /* reach, followers_gained, saves w/ delta + prev inline */ }
function buildTakeaways(d: ReportData): Record<string, string> { /* deterministic sentences per spec §4.2; missing data → "" */ }
function buildKpiCards(d) { /* 4 primary; uses deltaChip + deltaNote */ }
function buildHighlights(d) { /* best post + content mix with <i class="dot reel|car|img"> */ }
function buildTocItems(hasAudience: boolean, hasAi: boolean) { /* renumbered entries */ }
function buildFollowerChart(d) { /* lineChart({ ..., color: "#1C1917", annotation: `+${fmtNum(gain)} no mês`, eventMarker: peakDayOrUndefined }) */ }
function buildFormatCards(d) { /* three .fmt cards; leader = max avg_reach gets classes "fmt lead fmt--reel" etc + chip */ }
function buildAuxKpis(d, prevName) { /* posts_count, profile_views, website_clicks */ }
function buildTopPostCards(posts: TopPost[]) { /* first 6; dot in type badge; stats alc/♥/com./salv. */ }
function buildPostListRows(posts: TopPost[]) { /* ranks 7..15 */ }
function buildTagsTable(d) { /* ink bars, widths proportional to max avg_reach */ }
function buildDemographics(d) { /* donutChart ink #1C1917 + track #EDECEA; age bars AUDIENCE_TINT */ }
function buildLocation(d) { /* cities + countries bars, AUDIENCE_TINT */ }
function buildHeatmapTable(d) { /* HTML table 8h–21h; cell step = round(6 * value/maxValue) → HEAT[step]; empty = var(--soft) */ }
function buildHeatChips(d) { /* top-3 slots sorted desc; 1º chip bg HEAT[6], others rampdot HEAT[5], HEAT[4] */ }
function buildRecoCards(ai: AIOutput) { /* priority "high" → "Prioridade alta" amber tone; else "Prioridade média" neutral */ }
function buildGoalCards(ai: AIOutput) { /* metric/target/rationale */ }
function buildClosing(b) { /* ink banner, workspace name; contact line = workspace name only (no email field exists — copy: "Fale com a equipe {name}") */ }
function buildFooter(b, d) { /* returns footer HTML containing literal {{PAGE_NO}} / {{PAGE_TOTAL}} */ }

// sequential numbering after conditional stripping
export function numberPages(html: string): string {
  const total = (html.match(/class="page[ "]/g) || []).length;
  let page = 0;
  html = html.replace(/{{PAGE_NO}}/g, () => String(++page + 1)); // footers start on page 2
  html = html.replaceAll("{{PAGE_TOTAL}}", String(total));
  let sec = 0;
  const secTotal = (html.match(/{{SEC_NO}}/g) || []).length;
  html = html.replace(/{{SEC_NO}}/g, () => String(++sec).padStart(2, "0"));
  html = html.replaceAll("{{SEC_TOTAL}}", String(secTotal).padStart(2, "0"));
  return html;
}

export function renderReport(opts: {
  data: ReportData; branding: WorkspaceBranding; aiOutput: AIOutput | null;
}): string {
  const { data, aiOutput } = opts;
  const { acc, accFg } = resolveAccent(opts.branding.accent_color ?? opts.branding.primary_color);
  // …assemble every placeholder, strip {{#IF_*}} blocks exactly like v1 did (regex pattern preserved),
  // replaceAll {{FOOTER}}, then return numberPages(html).
}
```

Conditional stripping keeps the v1 regex approach (`/\{\{#IF_X\}\}[\s\S]*?\{\{\/IF_X\}\}/g`). Conditions: `IF_HAS_TAGS` (tags_performance.length), `IF_HAS_AUDIENCE` (audience !== null), `IF_HAS_HEATMAP` (best_times.length), `IF_HAS_LIST` (top_posts.length > 6), `IF_HAS_AI` (aiOutput !== null && (recommendations.length || suggested_goals.length)).

Deterministic takeaway templates (v1 wording, PT-BR — implement in `buildTakeaways`, each guarded by data presence):
- resumo: `O ${bestMetricLabel} cresceu <span class="hit">${pct}%</span> — o melhor resultado do mês.` (largest positive delta; if none positive: `Mês de consolidação: ${posts_count} publicações mantiveram a presença do perfil.`)
- crescimento: `Crescimento de <span class="hit">${sign}${fmtNum(gain)} seguidores</span> no período.`
- formatos: `${leaderLabel} alcançam <span class="hit">${ratio}× mais</span> que ${weakestLabel} — o formato merece prioridade.` (ratio = leader.avg_reach / weakest.avg_reach, 1 decimal; omit line if <2 formats)
- posts: `As 3 melhores publicações somam <span class="hit">${fmtCompact(top3)} de alcance</span> (${share}% do total).`
- audiencia: `${genderLabel} de ${topAge} anos em ${topCity} são <span class="hit">o núcleo da audiência</span>.`
- plano: `${n} recomendações para transformar os resultados do mês em <span class="hit">tendência sustentada</span>.`

- [ ] **Step 5: Delete dead code**

Remove `comboChart`, `heatmapChart` (+ their `Options` interfaces) from `charts.ts`, their cases from `charts.test.ts`, and delete `template.html`.

Run: `grep -rn "comboChart\|heatmapChart\|template.html" supabase/functions/ | grep -v ".test."`
Expected: no output.

- [ ] **Step 6: Run the full template suite**

Run: `deno test supabase/functions/_shared/report-template/`
Expected: all pass. `git checkout -- deno.lock`.

- [ ] **Step 7: Visual smoke check**

Write `/tmp` script rendering `makeData()` fixture to HTML, open in a browser, compare against the committed prototype page by page (cover, 6 pages, mobile at <860px). Fix regressions before committing.

- [ ] **Step 8: Commit**

```bash
git add -A supabase/functions/_shared/report-template/
git commit -m "feat(report): v2 template + renderer (Hub language, takeaways, AI page, data palette)"
```

---

### Task 6: Generator changes

**Files:**
- Modify: `supabase/functions/instagram-report-generator-v2/index.ts` (branding assembly ~L480, KPI assembly ~L525, snapshot deltas ~L556, workspace select ~L418)

**Interfaces:**
- Consumes: `workspaces.report_splash_url` (Task 1), `WorkspaceBranding` v2 fields (Task 3).
- Produces: `ReportData.kpis[*].prev` populated; `branding.splash_base64`/`accent_color` populated.

- [ ] **Step 1: Extend the workspace select (~L418)**

```ts
"name, logo_url, brand_color, report_splash_url",
```

(drop `report_secondary_color, report_accent_color, report_font_family, report_theme` from the select).

- [ ] **Step 2: Fetch splash like the logo**

Immediately after the existing `logoBase64` fetch block, add (reusing the same fetch-to-base64 helper/pattern and its ≤900KB guard):

Directly below the existing logo fetch at ~L476 (`const logoBase64 = ws?.logo_url ? await fetchImageAsBase64(ws.logo_url) : null;`), add the exact same shape — the column already holds a public URL, so no storage API call is needed:

```ts
const splashBase64 = ws?.report_splash_url
  ? await fetchImageAsBase64(ws.report_splash_url)
  : null;
```

`fetchImageAsBase64` is the existing helper at ~L85; it already enforces the size guard. Do not add a second helper.

- [ ] **Step 3: New branding assembly (~L480)**

```ts
const branding: WorkspaceBranding = {
  logo_base64: logoBase64,
  splash_base64: splashBase64,
  workspace_name: workspaceName,
  accent_color: ws?.brand_color || "#171717",
  // v1 fields until Task 7 removes them from the type:
  primary_color: ws?.brand_color || "#171717",
  secondary_color: "#1e2430",
  font_family: "DM Sans",
  theme: "light",
};
```

- [ ] **Step 4: Pass `report_month` into ReportData (~L805)**

Next to the existing `period: periodLabel,` line, add:

```ts
      report_month: month, // "2026-06" — already computed at ~L334
```

- [ ] **Step 5: Populate `prev` on KPIs (~L525 + ~L556)**

After `prevSnapshot` is loaded, thread raw previous values into the `kpis` map:

```ts
if (prevSnapshot) {
  kpis.reach.prev = prevSnapshot.reach ?? null;
  kpis.engagement_rate.prev = prevSnapshot.engagement_rate ?? null;
  kpis.saves.prev = prevSnapshot.saves ?? null;
  kpis.profile_views.prev = prevSnapshot.profile_views ?? null;
  kpis.website_clicks.prev = prevSnapshot.website_clicks ?? null;
  kpis.posts_count.prev = prevSnapshot.posts_count ?? null;
}
// followers_gained baseline: previous month's net gain needs the month-before snapshot;
// derive from the two snapshots we already have (current month start vs prev month start):
if (prevSnapshot && currSnapshot) {
  kpis.followers_gained.prev = (currSnapshot.follower_count ?? 0) - (prevSnapshot.follower_count ?? 0);
}
```

(Check the actual snapshot row columns at ~L556 — use exactly the fields the delta code reads; if `posts_count` isn't in the snapshot, skip that line.)

- [ ] **Step 6: Type-check + test sweep**

Run: `cd supabase/functions && deno check instagram-report-generator-v2/index.ts`
Expected: OK.
Run: `grep -rn "report_font_family\|report_theme\|report_secondary_color\|report_accent_color" supabase/functions/ apps/ | grep -v ".test.\|__tests__\|migrations\|admin"`
Expected: only `ConfiguracaoPage.tsx` hits (handled in Task 8). If the admin app reads these columns, leave it — columns still exist.

- [ ] **Step 7: Commit**

```bash
git add supabase/functions/instagram-report-generator-v2/index.ts
git commit -m "feat(report): generator feeds splash art, single accent, prev-period KPI values"
```

---

### Task 7: Contract cleanup (remove v1 branding fields)

**Files:**
- Modify: `supabase/functions/_shared/report-template/types.ts`
- Modify: `supabase/functions/instagram-report-generator-v2/index.ts`
- Modify: `supabase/functions/_shared/report-template/render.ts`, `render.test.ts` (fixture)
- Check: `supabase/functions/_shared/report-template/email.ts` + any `__tests__` referencing the old shape

**Interfaces:**
- Produces (final): `WorkspaceBranding { logo_base64: string | null; splash_base64: string | null; workspace_name: string; accent_color: string; }`

- [ ] **Step 1: Tighten the type** (make `splash_base64`/`accent_color` required, delete `primary_color`, `secondary_color`, `font_family`, `theme`).
- [ ] **Step 2: Sweep** — per repo memory, contract changes break both suites:

Run: `grep -rn "primary_color\|font_family\|theme:" supabase/functions/_shared/report-template/ supabase/functions/instagram-report-generator-v2/ supabase/functions/__tests__/ 2>/dev/null`

Fix every hit (generator assembly from Task 6 drops the four v1 lines; test fixtures drop them; `render.ts` reads only `accent_color`). If `email.ts` reads any removed field, switch it to `accent_color`.

- [ ] **Step 3: Full edge suite**

Run: `deno test supabase/functions/_shared/report-template/ && cd supabase/functions && deno check instagram-report-generator-v2/index.ts`
Expected: green. `git checkout -- deno.lock`.

- [ ] **Step 4: Commit**

```bash
git add -A supabase/functions/
git commit -m "refactor(report): WorkspaceBranding v2 — single accent, drop font/theme/secondary"
```

---

### Task 8: Configurações → Relatório Mensal controls

**Files:**
- Create: `apps/crm/src/pages/configuracao/reportSplash.ts`
- Create: `apps/crm/src/pages/configuracao/__tests__/reportSplash.test.ts`
- Modify: `apps/crm/src/pages/configuracao/ConfiguracaoPage.tsx` (state ~L290–310, section ~L714–830)
- Modify: existing ConfiguracaoPage tests if they cover removed controls

**Interfaces:**
- Consumes: `updateWorkspace(id, patch)` (existing, from store), logo-upload storage pattern at ~L231 (bucket + `getPublicUrl`), `workspaces.report_splash_url` (Task 1).
- Produces: `downscaleImage(file: File, maxWidth?: number, quality?: number): Promise<Blob>`; settings save `brand_color` + `report_splash_url`.

- [ ] **Step 1: Failing test for the downscale util**

```ts
// apps/crm/src/pages/configuracao/__tests__/reportSplash.test.ts
import { describe, expect, it, vi } from 'vitest';
import { downscaleImage } from '../reportSplash';

function fakeBitmap(w: number, h: number) {
  return { width: w, height: h, close: vi.fn() } as unknown as ImageBitmap;
}

describe('downscaleImage', () => {
  it('scales width down to max and keeps aspect', async () => {
    const drawImage = vi.fn();
    const toBlob = vi.fn((cb: (b: Blob | null) => void) => cb(new Blob(['x'], { type: 'image/jpeg' })));
    vi.stubGlobal('createImageBitmap', vi.fn(async () => fakeBitmap(3840, 2160)));
    const canvas = { width: 0, height: 0, getContext: () => ({ drawImage }), toBlob } as unknown as HTMLCanvasElement;
    vi.spyOn(document, 'createElement').mockReturnValue(canvas as HTMLElement & HTMLCanvasElement);

    await downscaleImage(new File(['x'], 'a.png', { type: 'image/png' }), 1920, 0.82);
    expect(canvas.width).toBe(1920);
    expect(canvas.height).toBe(1080);
    expect(toBlob).toHaveBeenCalledWith(expect.any(Function), 'image/jpeg', 0.82);
  });

  it('does not upscale small images', async () => {
    const toBlob = vi.fn((cb: (b: Blob | null) => void) => cb(new Blob(['x'], { type: 'image/jpeg' })));
    vi.stubGlobal('createImageBitmap', vi.fn(async () => fakeBitmap(800, 400)));
    const canvas = { width: 0, height: 0, getContext: () => ({ drawImage: vi.fn() }), toBlob } as unknown as HTMLCanvasElement;
    vi.spyOn(document, 'createElement').mockReturnValue(canvas as HTMLElement & HTMLCanvasElement);
    await downscaleImage(new File(['x'], 'a.png', { type: 'image/png' }));
    expect(canvas.width).toBe(800);
  });
});
```

- [ ] **Step 2: Run to verify failure** — `npm run test -- reportSplash` → FAIL (module missing).

- [ ] **Step 3: Implement `reportSplash.ts`**

```ts
// Client-side downscale for report splash uploads: max 1920px wide, JPEG q0.82.
export async function downscaleImage(
  file: File,
  maxWidth = 1920,
  quality = 0.82,
): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, maxWidth / bitmap.width);
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close?.();
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error('Falha ao processar a imagem'))),
      'image/jpeg',
      quality,
    );
  });
}
```

- [ ] **Step 4: Run test** — `npm run test -- reportSplash` → PASS.

- [ ] **Step 5: Rework the settings section**

In `ConfiguracaoPage.tsx`:

State (~L290): remove `secondaryColor`, `accentColor`, `reportFont`, `reportTheme` state + their setters/initializers; add:

```tsx
const [splashUrl, setSplashUrl] = useState<string | null>(null);
const [splashUploading, setSplashUploading] = useState(false);
const splashInputRef = useRef<HTMLInputElement>(null);
// init from branding load: setSplashUrl(branding.report_splash_url ?? null);
```

Save handler (~L305): patch becomes `{ brand_color: brandColor, send_report_email: sendReportEmail }` — the splash URL is persisted by its own upload/remove handlers (mirroring the logo), not by the Salvar button.

Upload handler (mirror the logo handler at ~L231, same bucket):

```tsx
const handleSplashUpload = async (file: File) => {
  if (!workspace) return;
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
    toast.error('Use uma imagem JPEG, PNG ou WebP.');
    return;
  }
  if (file.size > 4 * 1024 * 1024) {
    toast.error('Imagem muito grande (máx. 4MB).');
    return;
  }
  setSplashUploading(true);
  try {
    const blob = await downscaleImage(file);
    const path = `workspaces/${workspace.id}/report-splash.jpg`;
    const { error } = await supabase.storage.from('avatars')
      .upload(path, blob, { upsert: true, contentType: 'image/jpeg' });
    if (error) throw error;
    const { data: urlData } = supabase.storage.from('avatars').getPublicUrl(path);
    const publicUrl = urlData.publicUrl + '?t=' + Date.now(); // cache-bust, same as logo
    setSplashUrl(publicUrl);
    await updateWorkspace(workspace.id, { report_splash_url: publicUrl });
    toast.success('Arte da capa atualizada.');
  } catch (err) {
    toast.error('Erro ao enviar a arte: ' + (err as Error).message);
  } finally {
    setSplashUploading(false);
  }
};
```

Section JSX (~L714): replace the three color pickers + font selector + theme selector with:

```tsx
<div>
  <Label style={{ display: 'block', marginBottom: 6 }}>Cor de destaque</Label>
  <input type="color" value={brandColor} onChange={(e) => setBrandColor(e.target.value)}
    style={{ width: 48, height: 36, padding: 2, borderRadius: 6,
             border: '1px solid var(--border-color)', cursor: 'pointer', background: 'none' }} />
  <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: 4 }}>
    {brandColor} · a mesma cor de destaque do Hub do Cliente. Usada em marcações do
    relatório — nunca nos gráficos de dados.
  </div>
</div>

<div style={{ marginTop: '1.25rem' }}>
  <Label style={{ display: 'block', marginBottom: 6 }}>Arte da capa</Label>
  {splashUrl ? (
    <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
      <img src={splashUrl} alt="Arte da capa"
        style={{ width: 168, height: 72, objectFit: 'cover', borderRadius: 8,
                 border: '1px solid var(--border-color)' }} />
      <Button variant="outline" onClick={() => splashInputRef.current?.click()} disabled={splashUploading}>
        Substituir
      </Button>
      <Button variant="ghost" onClick={() => setSplashRemoveOpen(true)}>Remover</Button>
    </div>
  ) : (
    <div>
      <Button variant="outline" onClick={() => splashInputRef.current?.click()} disabled={splashUploading}>
        {splashUploading ? 'Enviando…' : 'Enviar imagem'}
      </Button>
      <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: 4 }}>
        Aparece na capa do relatório (formato paisagem, ~21:9). Sem arte, a capa fica só tipográfica.
      </div>
    </div>
  )}
  <input ref={splashInputRef} type="file" accept="image/jpeg,image/png,image/webp" hidden
    onChange={(e) => e.target.files?.[0] && handleSplashUpload(e.target.files[0])} />
</div>
```

Plus a `splashRemoveOpen` AlertDialog mirroring the logo-removal dialog (~L1207) whose confirm action calls `updateWorkspace(workspace.id, { report_splash_url: null })` and `setSplashUrl(null)`.

**Scope note:** the "Usar padrão Mesaas" preset from the spec is NOT built in this task — it needs a hosted asset and adds no capability the upload lacks. Ship upload + remove only; the preset is a follow-up.

- [ ] **Step 6: Update/verify CRM tests**

Run: `npm run test -- configuracao`
Fix any tests referencing the removed font/theme controls. Expected: green.

- [ ] **Step 7: Commit**

```bash
git add apps/crm/src/pages/configuracao/
git commit -m "feat(config): report v2 branding — single accent + splash art upload, drop font/theme pickers"
```

---

### Task 9: ReportPreview rewrite

**Files:**
- Rewrite: `apps/crm/src/pages/configuracao/ReportPreview.tsx`
- Create/Modify: `apps/crm/src/pages/configuracao/__tests__/ReportPreview.test.tsx`

**Interfaces:**
- Produces: `<ReportPreview accentColor={string} splashUrl={string | null} logoUrl={string | null} workspaceName={string} />` — pure presentational miniature of the v2 cover + one KPI strip. ConfiguracaoPage passes live state (Task 8 wires the props at the existing `<ReportPreview …/>` call site).

- [ ] **Step 1: Failing test**

```tsx
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import ReportPreview from '../ReportPreview';

describe('ReportPreview v2', () => {
  it('renders workspace name, accent chip and splash when provided', () => {
    render(<ReportPreview accentColor="#7C2D12" splashUrl="https://x/y.jpg"
      logoUrl={null} workspaceName="Agência Teste" />);
    expect(screen.getByText('Agência Teste')).toBeInTheDocument();
    expect(screen.getByTestId('preview-splash')).toHaveAttribute('src', 'https://x/y.jpg');
    expect(screen.getByTestId('preview-rank-chip')).toHaveStyle({ backgroundColor: '#7C2D12' });
  });

  it('typographic cover without splash; note about illustrative fonts', () => {
    render(<ReportPreview accentColor="#171717" splashUrl={null} logoUrl={null} workspaceName="A" />);
    expect(screen.queryByTestId('preview-splash')).not.toBeInTheDocument();
    expect(screen.getByText(/fontes ilustrativas/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run to verify failure** — `npm run test -- ReportPreview` → FAIL (old props/markup).

- [ ] **Step 3: Implement** — pure JSX/inline-style miniature (~240px wide): ink `#1C1917` cover card with logo plate (when `logoUrl`), workspace name, `Georgia, serif` stand-in handle "@seucliente", splash `<img data-testid="preview-splash">` (when `splashUrl`), teaser row with three fake numbers, then a small paper strip with a takeaway dash + rank chip (`data-testid="preview-rank-chip"`, background `accentColor`) and caption `Pré-visualização · fontes ilustrativas`. No data fetching, no state.

- [ ] **Step 4: Run test** — PASS. Then wire props at the call site in `ConfiguracaoPage.tsx` (pass `brandColor`, `splashUrl`, `wsLogoUrl`, `wsName`) and run `npm run test -- configuracao` again.

- [ ] **Step 5: Commit**

```bash
git add apps/crm/src/pages/configuracao/ReportPreview.tsx apps/crm/src/pages/configuracao/__tests__/ReportPreview.test.tsx apps/crm/src/pages/configuracao/ConfiguracaoPage.tsx
git commit -m "feat(config): live v2 report preview (cover miniature, accent + splash aware)"
```

---

### Task 10: Full verification + rollout prep

**Files:** none new.

- [ ] **Step 1: Full local gates**

```bash
npm run lint
npm run format:check   # npm run format first if it fails
npm run test
deno test supabase/functions/_shared/report-template/
git checkout -- deno.lock
npm run build
```

All green before pushing.

- [ ] **Step 2: Push + PR**

Push branch, open PR against `main` titled `feat: analytics report v2 (Hub design, splash whitelabel, AI plan page)`, body linking the spec + prototype files. PR body ends with the standard generated-with footer.

- [ ] **Step 3: Staging deploy (after review/merge — follow repo conventions)**

```bash
cat supabase/.temp/project-ref   # TRANSLATE: wlyzhyfondykzpsiqsce = staging, skjzpekeqefvlojenfsw = prod — never assume
npx supabase db push --linked    # only when linked ref = staging
npx supabase functions deploy instagram-report-generator-v2 --use-api
```

- [ ] **Step 4: Manual staging verification checklist**

- Generate a report ("Gerar" in AnalyticsContaPage) for a client WITH logo+splash+AI and one WITHOUT any of them.
- Open the HTML in the Hub (Relatórios → Ver online) on a phone-sized viewport — mobile layer active, no horizontal scroll.
- Download the PDF: Fraunces/Instrument Sans render (not Helvetica), page numbers correct, file size sane (< ~6MB with thumbnails).
- Configurações: pick a light accent (e.g. `#FFFDF0`) → generated report clamps to ink; upload a 4000px splash → stored ≤1920px; remove splash → typographic cover.
- Confirm delta notes show previous-month raw values where snapshots exist, and fall back to "vs. <mês>" where they don't.

- [ ] **Step 5: Prod rollout** — per spec §9: migration (SQL editor if db push blocked), deploy generator `--use-api` on prod ref, Vercel auto-deploys CRM on merge. Next monthly cron picks the new design automatically.

---

## Self-Review Notes

- Spec coverage: §3 visual system → Tasks 2/4/5; §4 contracts → Tasks 3/5/6/7; §5 migration → Task 1; §6 Configurações → Tasks 8/9; §7 renderer table → Tasks 4/5/6; §8 testing → embedded per task + Task 10; §9 rollout → Task 10. Email polish (spec §7 "optional") intentionally dropped — YAGNI; revisit with the email-expiry follow-up.
- Type consistency: `WorkspaceBranding` evolves additively (Task 3) → final shape (Task 7); `render.test.ts` fixture in Task 5 uses the transitional shape on purpose and is tightened in Task 7's sweep.
- `numberPages` assumes footers start on page 2 (cover has no footer) — matches template structure.
