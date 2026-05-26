# Monthly Instagram Report Redesign — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the jsPDF monthly report with a branded, multi-page HTML/CSS-to-PDF report featuring AI narrative, workspace branding, Hub portal access, and email delivery.

**Architecture:** Two-phase job model: cron creates `pending` report rows, a worker edge function processes them (data fetch → AI → HTML render → Gotenberg PDF → store → email). HTML template is shared between PDF generation and Hub web view. Workspace branding stored on `workspaces` table, injected as CSS variables.

**Tech Stack:** Deno edge functions, Gotenberg (self-hosted Docker), Gemini 2.5 Flash, Resend email, Supabase Storage, React + TanStack Query (CRM/Hub), Zod validation

**Spec:** `docs/superpowers/specs/2026-05-26-monthly-report-redesign-design.md`

---

## Phase 1: Database & Infrastructure Foundation

### Task 1: Database Migration — Metrics Snapshots Table

**Files:**
- Create: `supabase/migrations/20260526_001_metrics_daily_snapshots.sql`

- [ ] **Step 1: Write the migration file**

```sql
-- Daily snapshots of instagram account metrics for month-over-month report deltas
CREATE TABLE IF NOT EXISTS instagram_account_metrics_daily (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  instagram_account_id uuid NOT NULL REFERENCES instagram_accounts(id) ON DELETE CASCADE,
  snapshot_date date NOT NULL,
  followers_count integer,
  reach_28d integer,
  impressions_28d integer,
  profile_views_28d integer,
  website_clicks_28d integer,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(instagram_account_id, snapshot_date)
);

CREATE INDEX IF NOT EXISTS idx_metrics_daily_account_date
  ON instagram_account_metrics_daily(instagram_account_id, snapshot_date DESC);

ALTER TABLE instagram_account_metrics_daily ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access" ON instagram_account_metrics_daily
  FOR ALL USING (auth.role() = 'service_role');
```

- [ ] **Step 2: Validate migration syntax locally**

Run: `npx supabase db reset --linked 2>&1 | tail -20`
Expected: Migration applies without errors.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260526_001_metrics_daily_snapshots.sql
git commit -m "feat(db): add instagram_account_metrics_daily table for report deltas"
```

---

### Task 2: Database Migration — Workspace Branding & Report Columns

**Files:**
- Create: `supabase/migrations/20260526_002_report_branding_columns.sql`

- [ ] **Step 1: Write the migration file**

```sql
-- Backfill + constrain existing brand_color (now used as CSS variable in reports)
UPDATE workspaces SET brand_color = '#eab308'
  WHERE brand_color IS NULL OR brand_color !~ '^#[0-9a-fA-F]{6}$';

ALTER TABLE workspaces
  ALTER COLUMN brand_color SET NOT NULL,
  ALTER COLUMN brand_color SET DEFAULT '#eab308';

-- Separate statement: can't combine SET NOT NULL and ADD CONSTRAINT in one ALTER
ALTER TABLE workspaces
  ADD CONSTRAINT brand_color_hex CHECK (brand_color ~ '^#[0-9a-fA-F]{6}$');

-- New report branding columns on workspaces
ALTER TABLE workspaces
  ADD COLUMN IF NOT EXISTS report_secondary_color text NOT NULL DEFAULT '#1a1e26'
    CHECK (report_secondary_color ~ '^#[0-9a-fA-F]{6}$'),
  ADD COLUMN IF NOT EXISTS report_accent_color text NOT NULL DEFAULT '#3ecf8e'
    CHECK (report_accent_color ~ '^#[0-9a-fA-F]{6}$'),
  ADD COLUMN IF NOT EXISTS report_font_family text NOT NULL DEFAULT 'DM Sans'
    CHECK (report_font_family IN ('DM Sans', 'Inter', 'Poppins', 'Montserrat', 'Plus Jakarta Sans')),
  ADD COLUMN IF NOT EXISTS report_theme text NOT NULL DEFAULT 'dark'
    CHECK (report_theme IN ('dark', 'light')),
  ADD COLUMN IF NOT EXISTS send_report_email boolean NOT NULL DEFAULT false;

-- Per-client report flags
ALTER TABLE clientes
  ADD COLUMN IF NOT EXISTS send_report_email boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS include_ai_analysis boolean NOT NULL DEFAULT true;

-- New columns on analytics_reports for v2 generator
ALTER TABLE analytics_reports
  ADD COLUMN IF NOT EXISTS html_storage_path text,
  ADD COLUMN IF NOT EXISTS ai_content jsonb,
  ADD COLUMN IF NOT EXISTS ai_status text NOT NULL DEFAULT 'skipped'
    CHECK (ai_status IN ('skipped', 'success', 'validation_failed', 'generation_failed')),
  ADD COLUMN IF NOT EXISTS ai_error text,
  ADD COLUMN IF NOT EXISTS include_ai boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS generation_error text,
  ADD COLUMN IF NOT EXISTS retry_count integer NOT NULL DEFAULT 0
    CHECK (retry_count >= 0 AND retry_count <= 3),
  ADD COLUMN IF NOT EXISTS last_emailed_at timestamptz,
  ADD COLUMN IF NOT EXISTS locked_at timestamptz,
  ADD COLUMN IF NOT EXISTS locked_by text;

-- Status constraint (existing column, new constraint)
ALTER TABLE analytics_reports
  ADD CONSTRAINT status_check
    CHECK (status IN ('pending', 'generating', 'ready', 'failed'));

-- Worker index for finding pending/retryable reports
CREATE INDEX IF NOT EXISTS idx_reports_pending_work
  ON analytics_reports(status, retry_count, generated_at)
  WHERE status IN ('pending', 'failed');
```

- [ ] **Step 2: Validate migration syntax locally**

Run: `npx supabase db reset --linked 2>&1 | tail -20`
Expected: Both migrations apply without errors.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260526_002_report_branding_columns.sql
git commit -m "feat(db): add workspace branding, client report flags, and report v2 columns"
```

---

### Task 3: Add Daily Metrics Snapshot to Sync Cron

**Files:**
- Modify: `supabase/functions/instagram-sync-cron/index.ts` (around line 197, after the `instagram_accounts` UPDATE call)

- [ ] **Step 1: Write the test — verify snapshot INSERT is called**

Create: `supabase/functions/instagram-sync-cron/snapshot.test.ts`

```typescript
import { assertEquals } from "https://deno.land/std@0.208.0/assert/mod.ts";
import { buildSnapshotRow } from "./snapshot.ts";

Deno.test("buildSnapshotRow builds correct row from account metrics", () => {
  const row = buildSnapshotRow("acc-uuid-123", {
    followers_count: 4827,
    reach_28d: 45200,
    impressions_28d: 62000,
    profile_views_28d: 1200,
    website_clicks_28d: 89,
  });
  assertEquals(row.instagram_account_id, "acc-uuid-123");
  assertEquals(row.followers_count, 4827);
  assertEquals(row.reach_28d, 45200);
  assertEquals(row.impressions_28d, 62000);
  assertEquals(row.profile_views_28d, 1200);
  assertEquals(row.website_clicks_28d, 89);
  assertEquals(typeof row.snapshot_date, "string");
});

Deno.test("buildSnapshotRow handles null/undefined metrics gracefully", () => {
  const row = buildSnapshotRow("acc-uuid-456", {
    followers_count: 100,
    reach_28d: null,
    impressions_28d: undefined,
    profile_views_28d: 0,
    website_clicks_28d: null,
  });
  assertEquals(row.followers_count, 100);
  assertEquals(row.reach_28d, null);
  assertEquals(row.impressions_28d, null);
  assertEquals(row.profile_views_28d, 0);
  assertEquals(row.website_clicks_28d, null);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `deno test supabase/functions/instagram-sync-cron/snapshot.test.ts`
Expected: FAIL — `snapshot.ts` module not found.

- [ ] **Step 3: Implement the snapshot helper**

Create: `supabase/functions/instagram-sync-cron/snapshot.ts`

```typescript
interface AccountMetrics {
  followers_count: number | null | undefined;
  reach_28d: number | null | undefined;
  impressions_28d: number | null | undefined;
  profile_views_28d: number | null | undefined;
  website_clicks_28d: number | null | undefined;
}

export interface SnapshotRow {
  instagram_account_id: string;
  snapshot_date: string;
  followers_count: number | null;
  reach_28d: number | null;
  impressions_28d: number | null;
  profile_views_28d: number | null;
  website_clicks_28d: number | null;
}

export function buildSnapshotRow(
  accountId: string,
  metrics: AccountMetrics,
): SnapshotRow {
  const today = new Date().toISOString().split("T")[0];
  return {
    instagram_account_id: accountId,
    snapshot_date: today,
    followers_count: metrics.followers_count ?? null,
    reach_28d: metrics.reach_28d ?? null,
    impressions_28d: metrics.impressions_28d ?? null,
    profile_views_28d: metrics.profile_views_28d ?? null,
    website_clicks_28d: metrics.website_clicks_28d ?? null,
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `deno test supabase/functions/instagram-sync-cron/snapshot.test.ts`
Expected: 2 tests PASS.

- [ ] **Step 5: Integrate snapshot into sync cron**

Modify `supabase/functions/instagram-sync-cron/index.ts`. After the existing `instagram_accounts` UPDATE (around line 199), add:

```typescript
import { buildSnapshotRow } from "./snapshot.ts";

// ... inside the per-account processing, right after the instagram_accounts update:

// Daily metrics snapshot for report deltas
const snapshotRow = buildSnapshotRow(account.id, {
  followers_count: latestFollowerCount,
  reach_28d: totalReach,
  impressions_28d: totalImpressions,
  profile_views_28d: totalViews,
  website_clicks_28d: totalWebsiteClicks,
});
await svc.from("instagram_account_metrics_daily")
  .upsert(snapshotRow, { onConflict: "instagram_account_id,snapshot_date" });
```

The exact variable names (`totalReach`, `totalImpressions`, `totalViews`, `totalWebsiteClicks`, `latestFollowerCount`) must match the existing variables at that point in the sync cron. Read the sync cron's processing block (lines 105-200) to confirm the names before inserting.

- [ ] **Step 6: Commit**

```bash
git add supabase/functions/instagram-sync-cron/snapshot.ts \
       supabase/functions/instagram-sync-cron/snapshot.test.ts \
       supabase/functions/instagram-sync-cron/index.ts
git commit -m "feat(sync-cron): add daily metrics snapshot for report deltas"
```

---

## Phase 2: Report Template System (Backend Core)

### Task 4: HTML Escaper Utility

**Files:**
- Create: `supabase/functions/_shared/report-template/escape.ts`
- Create: `supabase/functions/_shared/report-template/escape.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
import { assertEquals } from "https://deno.land/std@0.208.0/assert/mod.ts";
import { escapeHtml } from "./escape.ts";

Deno.test("escapes HTML special characters", () => {
  assertEquals(escapeHtml('<script>alert("xss")</script>'), '&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;');
});

Deno.test("escapes ampersands", () => {
  assertEquals(escapeHtml("Tom & Jerry"), "Tom &amp; Jerry");
});

Deno.test("escapes single quotes", () => {
  assertEquals(escapeHtml("it's"), "it&#39;s");
});

Deno.test("returns empty string for null/undefined", () => {
  assertEquals(escapeHtml(null as unknown as string), "");
  assertEquals(escapeHtml(undefined as unknown as string), "");
});

Deno.test("does not double-escape already-escaped entities", () => {
  assertEquals(escapeHtml("&amp;"), "&amp;amp;");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `deno test supabase/functions/_shared/report-template/escape.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement escapeHtml**

```typescript
const ESCAPE_MAP: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

const ESCAPE_RE = /[&<>"']/g;

export function escapeHtml(str: string): string {
  if (str == null) return "";
  return String(str).replace(ESCAPE_RE, (ch) => ESCAPE_MAP[ch]);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `deno test supabase/functions/_shared/report-template/escape.test.ts`
Expected: All 5 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/_shared/report-template/escape.ts \
       supabase/functions/_shared/report-template/escape.test.ts
git commit -m "feat(report): add HTML escape utility for report template"
```

---

### Task 5: SVG Chart Generators

**Files:**
- Create: `supabase/functions/_shared/report-template/charts.ts`
- Create: `supabase/functions/_shared/report-template/charts.test.ts`

This task builds four server-side SVG chart generators that produce SVG strings (no DOM). They are used by the report template renderer.

- [ ] **Step 1: Write failing tests for all four chart types**

```typescript
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `deno test supabase/functions/_shared/report-template/charts.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement all four chart generators**

Create `charts.ts` with the four exported functions. Each generates a self-contained SVG string.

**Guidelines for implementation:**
- `lineChart`: SVG `<polyline>` for the data series. Optional `markers` array renders vertical dashed lines at specified labels (for post date overlays). X-axis labels from `data[].label`. Y-axis auto-scaled.
- `barChart`: SVG `<rect>` groups. Each group has a label and one or more colored bars. Values auto-scaled. Bar labels above bars.
- `heatmapChart`: 7 rows (days) × 24 columns (hours). Each cell is a `<rect>` with opacity proportional to `value / maxValue`. Color from the `color` param. Day labels (Seg, Ter, ...) on the left, hour labels (0-23) on top.
- `donutChart`: SVG `<path>` arcs. Segments proportional to `value / total`. Labels outside the donut with connector lines. Use `d` attribute with arc commands.

All functions return a complete `<svg>` string with `xmlns="http://www.w3.org/2000/svg"`.

This is a substantial implementation (~200-300 lines). Focus on correctness and readability. Use helper functions for coordinate math.

- [ ] **Step 4: Run tests to verify they pass**

Run: `deno test supabase/functions/_shared/report-template/charts.test.ts`
Expected: All 5 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/_shared/report-template/charts.ts \
       supabase/functions/_shared/report-template/charts.test.ts
git commit -m "feat(report): add server-side SVG chart generators (line, bar, heatmap, donut)"
```

---

### Task 6: Template-Based Fallback (No-AI Path)

**Files:**
- Create: `supabase/functions/_shared/report-template/fallback.ts`
- Create: `supabase/functions/_shared/report-template/fallback.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
import { assertEquals, assertStringIncludes } from "https://deno.land/std@0.208.0/assert/mod.ts";
import { buildFallbackSummary, buildFallbackRecommendations } from "./fallback.ts";
import type { ReportData } from "./types.ts";

// Uses a fixture matching the ReportData shape from the spec
const fixture: ReportData = {
  handle: "@drajuliana",
  specialty: "Dermatologia",
  period: "Maio 2026",
  kpis: {
    followers_gained: { id: "followers_gained", value: 347, unit: "count" },
    engagement_rate: { id: "engagement_rate", value: 4.2, unit: "pct" },
    reach: { id: "reach", value: 45200, unit: "count" },
    profile_views: { id: "profile_views", value: 1200, unit: "count" },
    website_clicks: { id: "website_clicks", value: 89, unit: "count" },
    saves: { id: "saves", value: 1800, unit: "count" },
    posts_count: { id: "posts_count", value: 18, unit: "count" },
  },
  kpi_deltas: { followers_pct_change: 12.4, engagement_pct_change: -0.3, reach_pct_change: 8.1 },
  top_posts: [{ type: "reel", reach: 12400, engagement: 6.8, saves: 340, caption_preview: "5 dicas para..." }],
  content_breakdown: {
    reels: { count: 6, avg_reach: 8200, avg_engagement: 5.1 },
    carousels: { count: 8, avg_reach: 4100, avg_engagement: 3.8 },
    images: { count: 4, avg_reach: 2800, avg_engagement: 2.9 },
  },
  audience: null,
  best_times: [],
  tags_performance: [],
  follower_trend: [],
};

Deno.test("buildFallbackSummary returns bullet-point summary", () => {
  const summary = buildFallbackSummary(fixture);
  assertStringIncludes(summary, "347");
  assertStringIncludes(summary, "45.200");
  assertStringIncludes(summary, "4,2%");
  assertStringIncludes(summary, "18");
});

Deno.test("buildFallbackRecommendations returns 3-5 items", () => {
  const recs = buildFallbackRecommendations(fixture);
  assertEquals(recs.length >= 3 && recs.length <= 5, true);
  for (const rec of recs) {
    assertEquals(typeof rec.title, "string");
    assertEquals(typeof rec.description, "string");
    assertEquals(["high", "medium", "low"].includes(rec.priority), true);
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `deno test supabase/functions/_shared/report-template/fallback.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 3: Create the shared ReportData type**

Create: `supabase/functions/_shared/report-template/types.ts`

Define the `ReportData` interface matching the spec's data payload structure. Also define `AIOutput`, `Recommendation`, `SuggestedGoal`, and `WorkspaceBranding` types used throughout the template system.

```typescript
export interface KpiValue {
  id: string;
  value: number;
  unit: "count" | "pct";
}

export interface KpiDeltas {
  followers_pct_change?: number;
  engagement_pct_change?: number;
  reach_pct_change?: number;
  saves_pct_change?: number;
  profile_views_pct_change?: number;
  website_clicks_pct_change?: number;
}

export interface TopPost {
  type: "reel" | "carousel" | "image";
  reach: number;
  engagement: number;
  saves: number;
  caption_preview: string;
  date?: string;
  thumbnail_base64?: string | null;
  permalink?: string;
}

export interface ContentBreakdown {
  reels?: { count: number; avg_reach: number; avg_engagement: number };
  carousels?: { count: number; avg_reach: number; avg_engagement: number };
  images?: { count: number; avg_reach: number; avg_engagement: number };
}

export interface AudienceData {
  gender_split: { female: number; male: number };
  top_cities: { name: string; pct: number }[];
  top_age_ranges: { range: string; pct: number }[];
  top_countries?: { name: string; pct: number }[];
}

export interface BestTimeSlot {
  day: string;
  hour: number;
  avg_engagement: number;
}

export interface TagPerformance {
  tag: string;
  avg_engagement: number;
  avg_reach: number;
  count: number;
}

export interface FollowerTrendPoint {
  date: string;
  count: number;
}

export interface ReportData {
  handle: string;
  specialty: string;
  period: string;
  kpis: Record<string, KpiValue>;
  kpi_deltas: KpiDeltas;
  top_posts: TopPost[];
  content_breakdown: ContentBreakdown;
  audience: AudienceData | null;
  best_times: BestTimeSlot[];
  tags_performance: TagPerformance[];
  follower_trend: FollowerTrendPoint[];
}

export interface Recommendation {
  title: string;
  description: string;
  priority: "high" | "medium" | "low";
  based_on_metric?: string;
}

export interface SuggestedGoal {
  metric: string;
  target: string;
  rationale: string;
}

export interface AIOutput {
  executive_summary: string;
  detailed_analysis: string;
  recommendations: Recommendation[];
  suggested_goals: SuggestedGoal[];
}

export interface WorkspaceBranding {
  logo_base64: string | null;
  workspace_name: string;
  primary_color: string;
  secondary_color: string;
  accent_color: string;
  font_family: string;
  theme: "dark" | "light";
}
```

- [ ] **Step 4: Implement fallback functions**

Create `fallback.ts`. Two exported functions:

- `buildFallbackSummary(data: ReportData): string` — Returns a bullet-point HTML string summarizing the month: followers gained, total reach, engagement rate, posts published. Uses `escapeHtml` for any interpolated data. Formats numbers with pt-BR locale (dot for thousands, comma for decimals).
- `buildFallbackRecommendations(data: ReportData): Recommendation[]` — Returns 3-5 rule-based recommendations. Logic: if Reels have higher avg_engagement than other types, recommend more Reels. If engagement is declining (negative delta), recommend reviewing content strategy. If saves rate is high, recommend more educational content. Each recommendation references a `based_on_metric` ID.

- [ ] **Step 5: Run tests to verify they pass**

Run: `deno test supabase/functions/_shared/report-template/fallback.test.ts`
Expected: All tests PASS.

- [ ] **Step 6: Commit**

```bash
git add supabase/functions/_shared/report-template/types.ts \
       supabase/functions/_shared/report-template/fallback.ts \
       supabase/functions/_shared/report-template/fallback.test.ts
git commit -m "feat(report): add shared types and template-based fallback for no-AI path"
```

---

### Task 7: AI Narrative Generator

**Files:**
- Create: `supabase/functions/_shared/report-template/ai.ts`
- Create: `supabase/functions/_shared/report-template/ai.test.ts`

- [ ] **Step 1: Write failing tests**

Test the prompt builder and the output validator separately from the actual Gemini call. The Gemini call itself is tested via integration.

```typescript
import { assertEquals, assertRejects } from "https://deno.land/std@0.208.0/assert/mod.ts";
import { buildAIPrompt, validateAIOutput } from "./ai.ts";
import type { ReportData } from "./types.ts";

const fixture: ReportData = {
  handle: "@drajuliana",
  specialty: "Dermatologia",
  period: "Maio 2026",
  kpis: {
    followers_gained: { id: "followers_gained", value: 347, unit: "count" },
    engagement_rate: { id: "engagement_rate", value: 4.2, unit: "pct" },
    reach: { id: "reach", value: 45200, unit: "count" },
    profile_views: { id: "profile_views", value: 1200, unit: "count" },
    website_clicks: { id: "website_clicks", value: 89, unit: "count" },
    saves: { id: "saves", value: 1800, unit: "count" },
    posts_count: { id: "posts_count", value: 18, unit: "count" },
  },
  kpi_deltas: { followers_pct_change: 12.4, engagement_pct_change: -0.3, reach_pct_change: 8.1 },
  top_posts: [{ type: "reel", reach: 12400, engagement: 6.8, saves: 340, caption_preview: "5 dicas para..." }],
  content_breakdown: {
    reels: { count: 6, avg_reach: 8200, avg_engagement: 5.1 },
    carousels: { count: 8, avg_reach: 4100, avg_engagement: 3.8 },
    images: { count: 4, avg_reach: 2800, avg_engagement: 2.9 },
  },
  audience: null,
  best_times: [],
  tags_performance: [],
  follower_trend: [],
};

Deno.test("buildAIPrompt includes system role and data payload", () => {
  const { systemPrompt, userPrompt } = buildAIPrompt(fixture);
  assertEquals(systemPrompt.includes("social media analytics specialist"), true);
  assertEquals(systemPrompt.includes("pt-BR"), true);
  assertEquals(systemPrompt.includes("ONLY use numbers from the provided data"), true);
  assertEquals(userPrompt.includes("@drajuliana"), true);
  assertEquals(userPrompt.includes("Maio 2026"), true);
});

Deno.test("validateAIOutput accepts valid output", () => {
  const valid = {
    executive_summary: "Este mês o perfil apresentou crescimento de 12% em seguidores.",
    detailed_analysis: "A análise detalhada mostra que os Reels tiveram melhor desempenho, com alcance médio de 8.200. O engajamento geral ficou em 4,2%, uma leve queda de 0,3% em relação ao período anterior.",
    recommendations: [
      { title: "Aumentar Reels", description: "Reels tiveram 40% mais alcance", priority: "high", based_on_metric: "reach" },
      { title: "Melhorar legendas", description: "Legendas mais longas geram mais saves", priority: "medium", based_on_metric: "saves" },
      { title: "Postar às terças 19h", description: "Melhor horário identificado", priority: "low", based_on_metric: "engagement_rate" },
    ],
    suggested_goals: [
      { metric: "followers_gained", target: "5000 seguidores", rationale: "Crescimento de 12% mantido" },
      { metric: "reach", target: "50.000 alcance", rationale: "Tendência de alta de 8%" },
    ],
  };
  const result = validateAIOutput(valid, Object.keys(fixture.kpis));
  assertEquals(result.valid, true);
});

Deno.test("validateAIOutput rejects missing fields", () => {
  const invalid = { executive_summary: "text" };
  const result = validateAIOutput(invalid, Object.keys(fixture.kpis));
  assertEquals(result.valid, false);
});

Deno.test("validateAIOutput rejects too-short executive_summary", () => {
  const invalid = {
    executive_summary: "Curto",
    detailed_analysis: "A".repeat(200),
    recommendations: [
      { title: "A", description: "B", priority: "high", based_on_metric: "reach" },
      { title: "C", description: "D", priority: "medium", based_on_metric: "saves" },
      { title: "E", description: "F", priority: "low", based_on_metric: "reach" },
    ],
    suggested_goals: [
      { metric: "reach", target: "50k", rationale: "reason" },
      { metric: "saves", target: "2k", rationale: "reason" },
    ],
  };
  const result = validateAIOutput(invalid, Object.keys(fixture.kpis));
  assertEquals(result.valid, false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `deno test supabase/functions/_shared/report-template/ai.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement AI prompt builder and validator**

Create `ai.ts` with:
- `buildAIPrompt(data: ReportData): { systemPrompt: string; userPrompt: string }` — Builds the system prompt (from spec section "Prompt architecture") and the user prompt with the serialized data payload.
- `validateAIOutput(raw: unknown, validMetricIds: string[]): { valid: boolean; error?: string; output?: AIOutput }` — Validates shape, field types, length bounds (executive_summary 50-500 chars, detailed_analysis 200-3000 chars, 3-5 recommendations, 2-3 goals), and that `based_on_metric`/`metric` fields reference valid metric IDs.
- `generateAINarrative(data: ReportData, apiKey: string): Promise<{ output: AIOutput; status: "success" } | { output: null; status: "validation_failed" | "generation_failed"; error: string }>` — Calls Gemini 2.5 Flash API, parses JSON response, validates, returns structured result. On any failure (network, parse, validation), returns the error status without throwing.

- [ ] **Step 4: Run tests to verify they pass**

Run: `deno test supabase/functions/_shared/report-template/ai.test.ts`
Expected: All 4 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/_shared/report-template/ai.ts \
       supabase/functions/_shared/report-template/ai.test.ts
git commit -m "feat(report): add AI narrative generator with Gemini 2.5 Flash + validation"
```

---

### Task 8: PDF Conversion Client (Gotenberg)

**Files:**
- Create: `supabase/functions/_shared/report-template/pdf.ts`
- Create: `supabase/functions/_shared/report-template/pdf.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
import { assertEquals, assertRejects } from "https://deno.land/std@0.208.0/assert/mod.ts";
import { buildGotenbergRequest } from "./pdf.ts";

Deno.test("buildGotenbergRequest creates correct FormData", () => {
  const { url, formData } = buildGotenbergRequest(
    "<html><body>Hello</body></html>",
    "http://gotenberg:3000",
  );
  assertEquals(url, "http://gotenberg:3000/forms/chromium/convert/html");
  assertEquals(formData instanceof FormData, true);
  assertEquals(formData.has("files"), true);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `deno test supabase/functions/_shared/report-template/pdf.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement PDF client**

```typescript
export function buildGotenbergRequest(
  html: string,
  gotenbergUrl: string,
): { url: string; formData: FormData } {
  const url = `${gotenbergUrl}/forms/chromium/convert/html`;
  const formData = new FormData();
  const htmlBlob = new Blob([html], { type: "text/html" });
  formData.append("files", htmlBlob, "index.html");
  formData.append("paperWidth", "8.27");
  formData.append("paperHeight", "11.69");
  formData.append("marginTop", "0");
  formData.append("marginBottom", "0");
  formData.append("marginLeft", "0");
  formData.append("marginRight", "0");
  formData.append("printBackground", "true");
  return { url, formData };
}

export async function convertHtmlToPdf(
  html: string,
  gotenbergUrl: string,
): Promise<Uint8Array> {
  const { url, formData } = buildGotenbergRequest(html, gotenbergUrl);
  const res = await fetch(url, { method: "POST", body: formData });
  if (!res.ok) {
    const body = await res.text().catch(() => "unknown error");
    throw new Error(`Gotenberg PDF conversion failed (${res.status}): ${body}`);
  }
  const buffer = await res.arrayBuffer();
  return new Uint8Array(buffer);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `deno test supabase/functions/_shared/report-template/pdf.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/_shared/report-template/pdf.ts \
       supabase/functions/_shared/report-template/pdf.test.ts
git commit -m "feat(report): add Gotenberg PDF conversion client"
```

---

### Task 9: HTML Report Template + Renderer

**Files:**
- Create: `supabase/functions/_shared/report-template/template.html`
- Create: `supabase/functions/_shared/report-template/render.ts`
- Create: `supabase/functions/_shared/report-template/render.test.ts`

This is the largest single task — the HTML template and the engine that populates it.

- [ ] **Step 1: Write failing tests for the renderer**

```typescript
import { assertStringIncludes, assertEquals } from "https://deno.land/std@0.208.0/assert/mod.ts";
import { renderReport } from "./render.ts";
import type { ReportData, WorkspaceBranding, AIOutput } from "./types.ts";

const branding: WorkspaceBranding = {
  logo_base64: null,
  workspace_name: "Agência Teste",
  primary_color: "#eab308",
  secondary_color: "#1a1e26",
  accent_color: "#3ecf8e",
  font_family: "DM Sans",
  theme: "dark",
};

const data: ReportData = {
  handle: "@drajuliana",
  specialty: "Dermatologia",
  period: "Maio 2026",
  kpis: {
    followers_gained: { id: "followers_gained", value: 347, unit: "count" },
    engagement_rate: { id: "engagement_rate", value: 4.2, unit: "pct" },
    reach: { id: "reach", value: 45200, unit: "count" },
    saves: { id: "saves", value: 1800, unit: "count" },
    posts_count: { id: "posts_count", value: 18, unit: "count" },
    profile_views: { id: "profile_views", value: 1200, unit: "count" },
    website_clicks: { id: "website_clicks", value: 89, unit: "count" },
  },
  kpi_deltas: { followers_pct_change: 12.4, engagement_pct_change: -0.3, reach_pct_change: 8.1 },
  top_posts: [{ type: "reel", reach: 12400, engagement: 6.8, saves: 340, caption_preview: "5 dicas para..." }],
  content_breakdown: { reels: { count: 6, avg_reach: 8200, avg_engagement: 5.1 } },
  audience: null,
  best_times: [],
  tags_performance: [],
  follower_trend: [],
};

Deno.test("renderReport produces valid HTML document", () => {
  const html = renderReport({ data, branding, aiOutput: null });
  assertStringIncludes(html, "<!DOCTYPE html>");
  assertStringIncludes(html, "</html>");
});

Deno.test("renderReport escapes user data in output", () => {
  const xssData = { ...data, handle: '<script>alert("xss")</script>' };
  const html = renderReport({ data: xssData, branding, aiOutput: null });
  assertEquals(html.includes("<script>alert"), false);
  assertStringIncludes(html, "&lt;script&gt;");
});

Deno.test("renderReport injects branding CSS variables", () => {
  const html = renderReport({ data, branding, aiOutput: null });
  assertStringIncludes(html, "--primary: #eab308");
  assertStringIncludes(html, "--secondary: #1a1e26");
  assertStringIncludes(html, "--accent: #3ecf8e");
});

Deno.test("renderReport includes AI output when provided", () => {
  const ai: AIOutput = {
    executive_summary: "Este mês foi excelente para o perfil.",
    detailed_analysis: "Análise detalhada do desempenho mensal com todos os dados.",
    recommendations: [{ title: "Mais Reels", description: "Reels performaram melhor", priority: "high", based_on_metric: "reach" }],
    suggested_goals: [{ metric: "reach", target: "50k", rationale: "crescimento" }],
  };
  const html = renderReport({ data, branding, aiOutput: ai });
  assertStringIncludes(html, "Este mês foi excelente para o perfil.");
});

Deno.test("renderReport uses fallback when aiOutput is null", () => {
  const html = renderReport({ data, branding, aiOutput: null });
  assertStringIncludes(html, "347");
  assertStringIncludes(html, "svg");
});

Deno.test("renderReport omits demographics section when audience is null", () => {
  const html = renderReport({ data: { ...data, audience: null }, branding, aiOutput: null });
  assertEquals(html.includes("Demografia"), false);
});

Deno.test("renderReport omits tags section when tags_performance is empty", () => {
  const html = renderReport({ data: { ...data, tags_performance: [] }, branding, aiOutput: null });
  assertEquals(html.includes("Performance por Tópico"), false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `deno test supabase/functions/_shared/report-template/render.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Create the HTML template file**

Create `template.html` — a complete A4 multi-page HTML document. This file uses `{{PLACEHOLDER}}` tokens that the renderer replaces. Key structure:

```
Page 1: Cover header + executive summary + KPI cards + highlights
Page 2: Follower chart + content type chart + detailed KPIs
Page 3: Top posts + tag performance table
Page 4: Demographics + location + heatmap
Page 5: AI analysis + recommendations + suggested goals
```

CSS uses:
- `@page { size: A4; margin: 0; }` for print/PDF layout
- `page-break-after: always` between page divs
- CSS variables: `--primary`, `--secondary`, `--accent`, `--font-main`
- Base64 `@font-face` for the configured font (DM Sans as default, embedded)
- Dark/light theme via `[data-theme]` attribute on `<html>`

Tokens: `{{BRANDING_CSS}}`, `{{THEME}}`, `{{COVER_HTML}}`, `{{EXECUTIVE_SUMMARY}}`, `{{KPI_CARDS}}`, `{{HIGHLIGHTS}}`, `{{FOLLOWER_CHART}}`, `{{CONTENT_CHART}}`, `{{DETAILED_KPIS}}`, `{{TOP_POSTS}}`, `{{TAGS_TABLE}}`, `{{DEMOGRAPHICS}}`, `{{LOCATION}}`, `{{HEATMAP}}`, `{{AI_ANALYSIS}}`, `{{RECOMMENDATIONS}}`, `{{GOALS}}`, `{{FOOTER}}`

Sections with conditional content (demographics, tags) are wrapped in `{{#IF_HAS_AUDIENCE}}...{{/IF_HAS_AUDIENCE}}` and `{{#IF_HAS_TAGS}}...{{/IF_HAS_TAGS}}` blocks that the renderer strips when data is absent.

- [ ] **Step 4: Implement the renderer**

Create `render.ts` with one exported function:

```typescript
export function renderReport(opts: {
  data: ReportData;
  branding: WorkspaceBranding;
  aiOutput: AIOutput | null;
}): string
```

The renderer:
1. Reads `template.html` (bundled as a string constant or via `Deno.readTextFileSync` relative to the module)
2. Generates SVG charts using `charts.ts` functions
3. Builds KPI card HTML, top posts HTML, etc. — all using `escapeHtml` for user data
4. If `aiOutput` is provided, injects it. Otherwise calls `buildFallbackSummary` / `buildFallbackRecommendations`
5. Replaces all `{{PLACEHOLDER}}` tokens in the template
6. Strips conditional blocks where data is absent
7. Returns the complete HTML string

- [ ] **Step 5: Run tests to verify they pass**

Run: `deno test supabase/functions/_shared/report-template/render.test.ts --allow-read`
Expected: All 7 tests PASS.

- [ ] **Step 6: Commit**

```bash
git add supabase/functions/_shared/report-template/template.html \
       supabase/functions/_shared/report-template/render.ts \
       supabase/functions/_shared/report-template/render.test.ts
git commit -m "feat(report): add HTML template and renderer with branding, charts, and conditional sections"
```

---

## Phase 3: Edge Functions — Generator & Worker

### Task 10: Report Generator V2 Edge Function

**Files:**
- Create: `supabase/functions/instagram-report-generator-v2/index.ts`

This function is called by the worker. It receives a `reportId`, fetches all data, runs AI (if enabled), renders HTML, converts to PDF, stores both, and returns.

- [ ] **Step 1: Create the edge function entry point**

The function:
1. Validates `x-cron-secret` header
2. Reads `reportId` from request body
3. Fetches the `analytics_reports` row (gets `instagram_account_id`, `client_id`, `conta_id`, `report_month`, `include_ai`)
4. Fetches all report data: KPIs, posts, follower history, demographics, best times, tags, metrics snapshots for deltas
5. Fetches workspace branding (brand_color, report_secondary_color, etc. from `workspaces`) + logo as base64
6. Fetches top post thumbnails as base64 (with fallback to null on failure)
7. If `include_ai`, calls `generateAINarrative()` and stores result
8. Calls `renderReport()` with all data
9. Calls `convertHtmlToPdf()` with the HTML
10. Uploads HTML and PDF to Supabase Storage
11. Updates `analytics_reports` row with paths, AI content, status

Key patterns to follow (from existing codebase):
- Auth: `x-cron-secret` header check (same as existing cron functions)
- CORS: `buildCorsHeaders(req)` from `_shared/cors.ts`
- Storage: upload to `analytics-reports` bucket (same as existing generator)
- Error handling: catch all, update report status to `'failed'` with `generation_error`
- Environment variables: `GOTENBERG_URL`, `GEMINI_API_KEY` (new), plus existing `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `CRON_SECRET`

- [ ] **Step 2: Test locally with mock data**

Run: `npx supabase functions serve instagram-report-generator-v2`

Test via curl with a mock reportId (requires a seeded analytics_reports row). This is an integration test — verify the function starts, authenticates, and returns a response.

- [ ] **Step 3: Commit**

```bash
git add supabase/functions/instagram-report-generator-v2/index.ts
git commit -m "feat(report): add report generator v2 edge function (HTML/CSS + Gotenberg)"
```

---

### Task 11: Report Worker Edge Function

**Files:**
- Create: `supabase/functions/report-worker/index.ts`

- [ ] **Step 1: Implement the worker**

The worker:
1. Validates `x-cron-secret` header
2. Generates a `worker_id` (UUID) for this invocation
3. Atomically claims one pending report using SQL:

```sql
UPDATE analytics_reports
SET status = 'generating', locked_at = now(), locked_by = $1
WHERE id = (
  SELECT id FROM analytics_reports
  WHERE (status = 'pending' OR (status = 'failed' AND retry_count < 3) OR (status = 'generating' AND locked_at < now() - interval '10 minutes'))
  ORDER BY
    CASE status WHEN 'pending' THEN 0 WHEN 'generating' THEN 1 ELSE 2 END,
    generated_at ASC NULLS FIRST
  LIMIT 1
  FOR UPDATE SKIP LOCKED
)
RETURNING *;
```

4. If no row returned, responds 200 with `{ processed: false, reason: "no_pending_reports" }`
5. Calls `instagram-report-generator-v2` via internal HTTP (same pattern as existing cron→generator call using `X-Internal-Token`)
6. On success: report status already set to `'ready'` by the generator
7. On failure: sets status `'failed'`, increments `retry_count`, stores error
8. If `retry_count >= 3`, sends failure alert via Resend

- [ ] **Step 2: Test locally**

Run: `npx supabase functions serve report-worker`
Verify it starts, returns `no_pending_reports` when no work exists.

- [ ] **Step 3: Commit**

```bash
git add supabase/functions/report-worker/index.ts
git commit -m "feat(report): add report-worker edge function with atomic claiming and retry"
```

---

### Task 12: Update Analytics Report Cron

**Files:**
- Modify: `supabase/functions/analytics-report-cron/index.ts`

- [ ] **Step 1: Simplify the cron to Phase 1 only**

Replace the existing inline generator call loop with:
1. Query all active Instagram accounts with connected tokens
2. For each, UPSERT into `analytics_reports` with `status = 'pending'`, `include_ai` from `clientes.include_ai_analysis`
3. After all rows created, call the `report-worker` function once (it processes one report per invocation; subsequent calls can be triggered by pg_cron or manual schedule)
4. Return count of reports queued

Remove the direct call to `instagram-report-generator` and the per-account generation loop.

- [ ] **Step 2: Test locally**

Run: `npx supabase functions serve analytics-report-cron`
Verify it creates `pending` rows without calling the old generator.

- [ ] **Step 3: Commit**

```bash
git add supabase/functions/analytics-report-cron/index.ts
git commit -m "refactor(cron): simplify report cron to phase-1 (queue pending rows only)"
```

---

## Phase 4: CRM UI

### Task 13: Workspace Branding Settings UI

**Files:**
- Modify: `apps/crm/src/pages/configuracao/ConfiguracaoPage.tsx` (Workspace section, around line 414)
- Modify: `apps/crm/src/store.ts` (add `updateWorkspaceBranding` function)

- [ ] **Step 1: Add store function for workspace branding update**

In `store.ts`, add:

```typescript
export async function getWorkspaceBranding(): Promise<{
  brand_color: string;
  report_secondary_color: string;
  report_accent_color: string;
  report_font_family: string;
  report_theme: string;
  send_report_email: boolean;
} | null> {
  const { contaId } = getCachedProfile();
  const { data } = await supabase
    .from('workspaces')
    .select('brand_color, report_secondary_color, report_accent_color, report_font_family, report_theme, send_report_email')
    .eq('id', contaId)
    .single();
  return data;
}

export async function updateWorkspaceBranding(fields: {
  brand_color?: string;
  report_secondary_color?: string;
  report_accent_color?: string;
  report_font_family?: string;
  report_theme?: string;
  send_report_email?: boolean;
}) {
  const { contaId } = getCachedProfile();
  const { error } = await supabase
    .from('workspaces')
    .update(fields)
    .eq('id', contaId);
  if (error) throw error;
}
```

- [ ] **Step 2: Add branding UI to Configurações page**

After the existing Workspace name section (~line 447), add:
- Color picker for "Cor primária" (brand_color) — use an `<input type="color">` styled with existing form patterns
- Color picker for "Cor secundária" (report_secondary_color)
- Color picker for "Cor de destaque" (report_accent_color)
- Select for "Fonte do relatório" (report_font_family) — options: DM Sans, Inter, Poppins, Montserrat, Plus Jakarta Sans
- Toggle for "Tema do relatório" (report_theme) — dark / light
- Toggle for "Enviar relatórios por e-mail" (send_report_email) with helper text

Use `useQuery` to fetch branding, `useMutation` to save. Show toast on save success/error.

- [ ] **Step 3: Run typecheck**

Run: `npm run build 2>&1 | head -30`
Expected: No TypeScript errors.

- [ ] **Step 4: Test in browser**

Run: `npm run dev`
Navigate to `/configuracao`. Verify the branding section appears with color pickers, font selector, and toggles. Change values and save. Verify values persist on reload.

- [ ] **Step 5: Commit**

```bash
git add apps/crm/src/store.ts apps/crm/src/pages/configuracao/ConfiguracaoPage.tsx
git commit -m "feat(settings): add workspace branding configuration for reports"
```

---

### Task 14: Per-Client Report Flags on Client Detail Page

**Files:**
- Modify: `apps/crm/src/pages/cliente-detalhe/ClienteDetalhePage.tsx` (add report settings card)

- [ ] **Step 1: Add the "Relatório Mensal" card**

In `ClienteDetalhePage.tsx`, after the Instagram section (~line 1003) and before the Hub section, add a new card:

```tsx
{/* Relatório Mensal Settings */}
{!isAgent && cliente && (
  <ReportSettingsCard clienteId={clienteId} cliente={cliente} />
)}
```

Create a `ReportSettingsCard` component (can be inline in the same file or extracted). It:
1. Reads `send_report_email` and `include_ai_analysis` from the `cliente` object (already fetched in the parent query)
2. Renders two toggle rows using the existing `Switch` component
3. On toggle change, calls `updateCliente(clienteId, { send_report_email: value })` or `updateCliente(clienteId, { include_ai_analysis: value })`
4. Shows toast on success

Model after the existing auto-publish toggle pattern at lines 1596-1610.

- [ ] **Step 2: Run typecheck**

Run: `npm run build 2>&1 | head -30`
Expected: No TypeScript errors.

- [ ] **Step 3: Test in browser**

Navigate to `/clientes/:id`. Verify the "Relatório Mensal" card appears with two toggles. Toggle values and verify they persist.

- [ ] **Step 4: Commit**

```bash
git add apps/crm/src/pages/cliente-detalhe/ClienteDetalhePage.tsx
git commit -m "feat(client-detail): add per-client report email and AI toggles"
```

---

### Task 15: Updated Reports Section in Analytics Page

**Files:**
- Modify: `apps/crm/src/pages/analytics-conta/AnalyticsContaPage.tsx` (reports section, around lines 1156-1176)
- Modify: `apps/crm/src/services/analytics.ts` (update AnalyticsReport type, add sendReportEmail, update generateReport)

- [ ] **Step 1: Update the AnalyticsReport type and service functions**

In `analytics.ts`:

1. Update `AnalyticsReport` type to include new fields:
```typescript
export interface AnalyticsReport {
  id: number;
  report_month: string;
  storage_path: string | null;
  html_storage_path: string | null;
  status: 'pending' | 'generating' | 'ready' | 'failed';
  generated_at: string | null;
  include_ai: boolean;
  ai_status: string;
  generation_error: string | null;
  retry_count: number;
  last_emailed_at: string | null;
}
```

2. Update `generateReport` to pass `includeAI` param:
```typescript
export async function generateReport(clientId: number, month: string, includeAI: boolean): Promise<{ reportId: number; status: string }> {
  // POST to instagram-analytics edge function generate-report endpoint
  // Body: { month, force: true, includeAI }
}
```

3. Add `sendReportEmail` function:
```typescript
export async function sendReportEmail(reportId: number): Promise<void> {
  // POST to instagram-analytics /send-report-email?reportId=...
}
```

4. Add `getReportDownloadUrl` function:
```typescript
export async function getReportDownloadUrl(storagePath: string): Promise<string> {
  // Generate signed URL from storage_path with 1-hour expiry
}
```

- [ ] **Step 2: Update the reports section UI**

In `AnalyticsContaPage.tsx`, update the reports section to:
1. Show status badges: "Pendente" (yellow), "Gerando..." (blue spinner), "Pronto" (green), "Falha" (red)
2. For `pending` / `generating` reports, poll every 10 seconds using `refetchInterval` on the query
3. Add "Incluir AI" checkbox to the generate report dialog
4. Add "Enviar" button per ready report row (calls `sendReportEmail`, shows confirmation dialog with client email)
5. Download button generates signed URL on click (not pre-stored)

- [ ] **Step 3: Run typecheck**

Run: `npm run build 2>&1 | head -30`
Expected: No TypeScript errors.

- [ ] **Step 4: Commit**

```bash
git add apps/crm/src/services/analytics.ts \
       apps/crm/src/pages/analytics-conta/AnalyticsContaPage.tsx
git commit -m "feat(analytics): update reports section with status polling, email send, and AI toggle"
```

---

## Phase 5: Distribution — Hub Portal & Email

### Task 16: Hub Reports Edge Function

**Files:**
- Create: `supabase/functions/hub-reports/index.ts`

- [ ] **Step 1: Implement the edge function**

Endpoints:
- `GET /list?token=...&workspace=...` — Returns list of reports for the client associated with the token. Auth: verify token in `client_hub_tokens` (is_active, expires_at, conta_id match). Returns `{ reports: [{ month, status, has_pdf, has_html }] }`
- `GET /html/:month?token=...&workspace=...` — Serves the stored HTML for the given month. Sets CSP headers: `Content-Security-Policy: default-src 'none'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:`. Content-Type: `text/html`.
- `GET /pdf-url/:month?token=...&workspace=...` — Returns a 1-hour signed URL for the PDF. Response: `{ url: "..." }`

Auth pattern for all endpoints (matching existing Hub functions):
```typescript
const { data: hubToken } = await svc.from('client_hub_tokens')
  .select('cliente_id, conta_id, is_active, expires_at')
  .eq('token', token)
  .single();

if (!hubToken || !hubToken.is_active || new Date(hubToken.expires_at) < new Date()) {
  return json({ error: 'Invalid or expired token' }, 401);
}
// Verify workspace slug matches conta_id
```

Deploy with `--no-verify-jwt` (Hub functions handle their own auth).

- [ ] **Step 2: Test locally**

Run: `npx supabase functions serve hub-reports`
Test the `/list` endpoint with a valid hub token.

- [ ] **Step 3: Commit**

```bash
git add supabase/functions/hub-reports/index.ts
git commit -m "feat(hub): add hub-reports edge function for report listing and serving"
```

---

### Task 17: Hub Reports Pages (React)

**Files:**
- Create: `apps/hub/src/pages/Relatorios.tsx`
- Create: `apps/hub/src/pages/RelatorioView.tsx`
- Modify: `apps/hub/src/router.tsx` (add routes)

- [ ] **Step 1: Add routes to Hub router**

In `router.tsx`, add two new child routes under HubShell:

```tsx
{ path: "relatorios", lazy: () => import("./pages/Relatorios") },
{ path: "relatorios/:month", lazy: () => import("./pages/RelatorioView") },
```

- [ ] **Step 2: Create the report list page**

`Relatorios.tsx` — fetches report list from `hub-reports/list`, renders month cards in a grid. Each card shows month/year, "Ver online" link (to `relatorios/:month`), and "Baixar PDF" button (fetches signed URL, triggers download).

Follow existing Hub page patterns (check other Hub pages like `Aprovacoes.tsx` for layout, styling, and data fetching patterns).

- [ ] **Step 3: Create the report viewer page**

`RelatorioView.tsx` — fetches HTML from `hub-reports/html/:month`, renders it in a sandboxed iframe:

```tsx
<iframe
  srcDoc={reportHtml}
  sandbox="allow-same-origin"
  style={{ width: '100%', height: '100vh', border: 'none' }}
  title={`Relatório ${month}`}
/>
```

Back button to return to report list. "Baixar PDF" button.

- [ ] **Step 4: Run typecheck**

Run: `npm run build:hub 2>&1 | head -30`
Expected: No TypeScript errors.

- [ ] **Step 5: Test in browser**

Run: `npm run dev:hub`
Navigate to `/:workspace/hub/:token/relatorios`. Verify report list renders. Click "Ver online" and verify the HTML report renders in the iframe.

- [ ] **Step 6: Commit**

```bash
git add apps/hub/src/pages/Relatorios.tsx \
       apps/hub/src/pages/RelatorioView.tsx \
       apps/hub/src/router.tsx
git commit -m "feat(hub): add report list and viewer pages"
```

---

### Task 18: Email Delivery — Send Report Email Endpoint

**Files:**
- Modify: `supabase/functions/instagram-analytics/index.ts` (add `/send-report-email` endpoint)

- [ ] **Step 1: Add the endpoint**

In the existing `instagram-analytics` router, add a new `POST /send-report-email` handler:

1. Auth: JWT (existing pattern — extract user, verify workspace ownership)
2. Read `reportId` from query param
3. Fetch the report row — verify it belongs to the user's workspace, status is `'ready'`
4. Throttle check: if `last_emailed_at` is within 24 hours, return 429
5. Fetch client email from `clientes` table
6. Check `clientes.send_report_email` flag — if false, return `{ warning: "client_opted_out" }` (CRM UI handles the override confirmation)
7. Generate 7-day signed URL for PDF
8. Build email HTML with KPI teaser, AI snippet (from `ai_content`), Hub link, PDF download CTA
9. Send via Resend
10. Update `analytics_reports.last_emailed_at`
11. Call `insertAuditLog` with action `report_email_sent`

- [ ] **Step 2: Build the email HTML template**

Create a helper function that builds the email HTML. Keep it inline in the handler file or extract to `_shared/report-template/email.ts`. The email should be:
- Simple HTML email (table-based layout for email client compatibility)
- Workspace logo at top
- Subject: "Seu relatório de {Month} está pronto!"
- 2-4 KPI cards with deltas
- AI executive summary snippet (first 2 sentences), or omit if AI was disabled
- Two CTA buttons: "Ver Relatório Completo" → Hub URL, "Baixar PDF" → signed URL
- Footer: "Enviado por {WorkspaceName} via Mesaas"

- [ ] **Step 3: Test locally**

Run: `npx supabase functions serve instagram-analytics`
Test the endpoint with a valid report ID via curl. Verify email is sent (check Resend dashboard or use test mode).

- [ ] **Step 4: Commit**

```bash
git add supabase/functions/instagram-analytics/index.ts
git commit -m "feat(analytics): add send-report-email endpoint with throttling and audit"
```

---

### Task 19: Auto-Email in Report Worker

**Files:**
- Modify: `supabase/functions/report-worker/index.ts`

- [ ] **Step 1: Add email sending to the worker pipeline**

After the generator returns successfully (status `'ready'`):

1. Check `workspaces.send_report_email` (workspace-level flag)
2. Check `clientes.send_report_email` (client-level flag)
3. If both true, call the same email-building logic from Task 18 (extract to shared helper if not already done)
4. Send via Resend
5. Update `last_emailed_at`
6. Audit log

If email fails, log the error but don't fail the report — the report itself is already `'ready'`.

- [ ] **Step 2: Commit**

```bash
git add supabase/functions/report-worker/index.ts
git commit -m "feat(worker): add auto-email delivery after successful report generation"
```

---

## Phase 6: Integration & Verification

### Task 20: End-to-End Integration Test

**Files:**
- No new files — manual verification

- [ ] **Step 1: Deploy migrations to staging**

Run: `npx supabase db push --linked`
Expected: All migrations apply cleanly.

- [ ] **Step 2: Deploy edge functions to staging**

```bash
npx supabase functions deploy instagram-sync-cron --no-verify-jwt
npx supabase functions deploy instagram-report-generator-v2 --no-verify-jwt
npx supabase functions deploy report-worker --no-verify-jwt
npx supabase functions deploy analytics-report-cron --no-verify-jwt
npx supabase functions deploy hub-reports --no-verify-jwt
npx supabase functions deploy instagram-analytics --no-verify-jwt
```

- [ ] **Step 3: Verify daily snapshot (sync cron)**

Trigger the sync cron manually. Check `instagram_account_metrics_daily` table for new rows.

- [ ] **Step 4: Generate a test report (manual trigger)**

From the CRM analytics page, trigger report generation for a test client. Verify:
- Report row created with `status = 'pending'`
- Worker picks it up, transitions to `'generating'` then `'ready'`
- PDF downloads correctly from the CRM
- HTML renders correctly in the Hub portal

- [ ] **Step 5: Test email delivery**

From the CRM reports section, click "Enviar" on the generated report. Verify:
- Confirmation dialog shows client email
- Email arrives with correct branding, KPIs, and CTAs
- Links in email work (Hub view and PDF download)
- Throttle prevents re-send within 24 hours

- [ ] **Step 6: Test branding**

Change workspace branding colors in Configurações. Generate a new report. Verify the new colors appear in the PDF and Hub view.

- [ ] **Step 7: Test AI toggle**

Generate a report with AI disabled (uncheck "Incluir AI"). Verify the report uses fallback text instead of AI narrative.

- [ ] **Step 8: Run full test suite**

Run: `npm run test`
Run: `npm run build`
Run: `npm run build:hub`
Expected: All pass with no regressions.

- [ ] **Step 9: Final commit — update CLAUDE.md if needed**

If any new environment variables, commands, or gotchas were discovered during integration, update CLAUDE.md.

```bash
git add -A
git commit -m "test: verify end-to-end report generation pipeline"
```
