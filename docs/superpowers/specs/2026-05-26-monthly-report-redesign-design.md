# Monthly Instagram Report Redesign

## Overview

Redesign the monthly Instagram analytics report from a basic jsPDF-generated single-page PDF to a polished, branded, multi-page HTML/CSS-to-PDF report. Add new distribution channels (Hub portal, email), workspace-level branding, AI-powered narrative analysis, and per-client feature flags.

**Benchmark:** Reportei-level visual polish and data density.

## Report Structure

A4 PDF with exactly 5 pages under normal conditions: 1-page executive summary + 4-page deep dive.

**Overflow rules:** If a client has fewer than 5 posts or no tags, Pages 3 content condenses — the tag section is omitted and top posts expand. If demographics are unavailable (Instagram API didn't return them), Page 4 omits demographics and the heatmap expands. Minimum layout is 3 pages (cover + growth/content + recommendations). No page ever renders empty — sections that lack data are omitted entirely, not shown as empty placeholders.

### Page 1 — Cover + Executive Summary

- Workspace-branded header: logo, gradient using primary + secondary colors, client @handle, report period (month/year)
- AI narrative summary (2-3 sentences) or template-based bullet summary when AI is disabled
- 4 key KPI cards with month-over-month deltas: Followers gained, Reach, Engagement rate, Saves
- Highlight cards: best post of the month, publication breakdown by content type

### Page 2 — Growth & Content Performance

- Follower growth chart: daily follower count line chart with post date markers overlaid
- Content type performance comparison: bar chart comparing Reels vs Carousels vs Images on reach, engagement, and saves
- Detailed KPI cards with month-over-month deltas for metrics that have historical data: followers gained, engagement rate, total reach (from posts), saves rate, publication count. Profile views and website clicks shown as current-period values only (no delta) until monthly snapshots accumulate — see "Monthly Metrics Snapshots" section.

### Page 3 — Top Posts & Tag Performance

- Top 5 posts: each with cached thumbnail (see "Asset Preservation"), content type badge, date, caption preview, reach, engagement, saves
- Tag/topic performance table: grouped by tag, showing avg engagement, avg reach, and post count per tag. Omitted entirely if the client has no tags assigned.

### Page 4 — Audience & Timing

- Demographics: gender split bar, age range distribution chart. Omitted if Instagram API didn't return demographics for this account.
- Location: top 5 cities with horizontal bars, top 5 countries
- Best posting times: 7x24 heatmap grid showing engagement by day and hour, with top 3 slots highlighted

### Page 5 — AI Analysis & Recommendations

- Full AI narrative analysis (2-3 paragraphs) connecting metrics to causes and trends — OR template-based structured analysis when AI is disabled
- 3-5 actionable recommendations with priority indicators (high/medium/low), each with title and description
- 2-3 suggested quantitative goals for next month based on current trajectory

## Workspace Branding System

Workspace owners configure brand settings once; all client reports inherit the look.

### Existing branding columns

The database already has these branding-related structures:

- `workspaces.logo_url` (text) — workspace logo
- `workspaces.brand_color` (text) — single brand color
- `hub_brand` table (per-client) — `logo_url`, `primary_color`, `secondary_color`, `font_primary`, `font_secondary`

### Branding strategy: extend `workspaces`, don't duplicate

Reports are workspace-scoped (not per-client), so branding lives on `workspaces`. We rename/extend the existing `brand_color` to avoid parallel branding knobs:

| Column | Type | Default | Constraint | Description |
|--------|------|---------|------------|-------------|
| `brand_color` | text | (existing) | — | Already exists. Becomes the "primary color" for reports. No rename needed. |
| `report_secondary_color` | text | `#1a1e26` | CHECK matches `^#[0-9a-fA-F]{6}$` | Cover gradient background |
| `report_accent_color` | text | `#3ecf8e` | CHECK matches `^#[0-9a-fA-F]{6}$` | Highlights, positive deltas |
| `report_font_family` | text | `DM Sans` | CHECK in allowed list | Options: DM Sans, Inter, Poppins, Montserrat, Plus Jakarta Sans |
| `report_theme` | text | `dark` | CHECK in (`dark`, `light`) | Report base theme |
| `send_report_email` | boolean | `false` | NOT NULL | Workspace-level email delivery toggle |

The report template reads `brand_color` as primary, `report_secondary_color` as secondary, etc. The `hub_brand` table (per-client) is unrelated — it controls Hub portal appearance, not reports.

### What gets branded

- Cover header gradient (brand_color + report_secondary_color)
- Logo placement in header and footer (workspaces.logo_url)
- KPI card accent colors (brand_color)
- Chart colors (brand_color + report_accent_color)
- Section divider accents
- Font family (if overridden)
- Light/dark base theme
- Footer branding text

### What stays fixed

- Report structure and page layout
- Section ordering
- Semantic colors (green = positive, red = negative)
- Chart types and placement
- Typography scale and hierarchy
- Spacing and grid system

### UI location

Expand the existing Workspace section in Configurações (settings page). Currently has logo + workspace name; add color pickers (pre-populated from `brand_color`), secondary/accent color pickers, font selector, theme toggle, and email delivery toggle. Role-gated to owners/admins (already the case).

## Per-Client Feature Flags

New card on `ClienteDetalhePage.tsx` titled "Relatório Mensal" with two toggles:

| Column (on `clientes`) | Type | Default | Description |
|-------------------------|------|---------|-------------|
| `send_report_email` | boolean | `false` | Whether this client receives the monthly report via email automatically. Only takes effect when workspace-level `send_report_email` is also enabled. **Defaults to `false`** — when a workspace enables email delivery, no existing client is auto-enrolled. Owners must explicitly enable per-client or bulk-enable. |
| `include_ai_analysis` | boolean | `true` | Default for whether AI narrative is included in this client's reports. Can be overridden per-report at manual generation time. |

The card renders similarly to the existing auto-publish toggle in the Instagram section — two rows, each with label, description, and Switch component.

## AI Narrative Design

### Two AI outputs per report

1. **Executive summary** (Page 1): 2-3 sentences highlighting the single biggest win, overall trend direction, and one key audience insight.
2. **Full analysis + recommendations** (Page 5): 2-3 paragraphs connecting metrics to causes, plus 3-5 specific recommendations and 2-3 suggested goals.

### Prompt architecture

**System prompt — role and constraints:**
- Role: social media analytics specialist writing a monthly performance report for a client of a Brazilian social media agency
- Language: Brazilian Portuguese (pt-BR)
- ONLY reference metrics present in the provided data — never invent or estimate numbers
- Use the client's @handle, never their real name
- Be analytical, not promotional — connect data to insights
- When a metric improves: explain what likely caused it
- When a metric declines: explain the context without being alarming
- Compare to previous period only when delta data is provided
- Never reference industry benchmarks unless explicitly provided in the data
- Keep tone professional but accessible — the client may not be a marketer

**Data payload (injected per report):**

```json
{
  "handle": "@drajuliana",
  "specialty": "Dermatologia",
  "period": "Maio 2026",
  "kpis": {
    "followers_gained": { "id": "followers_gained", "value": 347, "unit": "count" },
    "engagement_rate": { "id": "engagement_rate", "value": 4.2, "unit": "pct" },
    "reach": { "id": "reach", "value": 45200, "unit": "count" },
    "profile_views": { "id": "profile_views", "value": 1200, "unit": "count" },
    "website_clicks": { "id": "website_clicks", "value": 89, "unit": "count" },
    "saves": { "id": "saves", "value": 1800, "unit": "count" },
    "posts_count": { "id": "posts_count", "value": 18, "unit": "count" }
  },
  "kpi_deltas": {
    "followers_pct_change": 12.4,
    "engagement_pct_change": -0.3,
    "reach_pct_change": 8.1
  },
  "top_posts": [{ "type": "reel", "reach": 12400, "engagement": 6.8, "saves": 340, "caption_preview": "5 dicas para..." }],
  "content_breakdown": {
    "reels": { "count": 6, "avg_reach": 8200, "avg_engagement": 5.1 },
    "carousels": { "count": 8, "avg_reach": 4100, "avg_engagement": 3.8 },
    "images": { "count": 4, "avg_reach": 2800, "avg_engagement": 2.9 }
  },
  "audience": {
    "gender_split": { "female": 72, "male": 28 },
    "top_cities": [{ "name": "São Paulo", "pct": 34 }],
    "top_age_ranges": [{ "range": "25-34", "pct": 41 }]
  },
  "best_times": [{ "day": "Tuesday", "hour": 19, "avg_engagement": 5.8 }],
  "tags_performance": [{ "tag": "skincare", "avg_engagement": 5.2, "avg_reach": 6100, "count": 5 }],
  "follower_trend": [{ "date": "2026-05-01", "count": 4480 }]
}
```

**Requested output structure (JSON):**

```json
{
  "executive_summary": "string (2-3 sentences)",
  "detailed_analysis": "string (2-3 paragraphs)",
  "recommendations": [
    {
      "title": "string",
      "description": "string",
      "priority": "high|medium|low",
      "based_on_metric": "metric_id from kpis"
    }
  ],
  "suggested_goals": [
    { "metric": "metric_id from kpis", "target": "string", "rationale": "string" }
  ]
}
```

### Anti-hallucination safeguards

**Prevention (in prompt):**
- Explicit instruction: "ONLY use numbers from the provided data"
- No industry benchmarks unless injected
- Structured JSON output format with `based_on_metric` field requiring metric IDs from the input payload
- Request output as JSON for machine-parseable validation

**Validation (post-generation):**
- Parse JSON output — reject if malformed
- Zod schema validation: verify all required fields, types, and enum values
- Verify `based_on_metric` and `metric` fields reference valid metric IDs from the input payload
- Check output length bounds: executive_summary 50-500 chars, detailed_analysis 200-3000 chars, 3-5 recommendations, 2-3 goals
- Store validation result: `ai_status` field (`success`, `validation_failed`, `generation_failed`, `skipped`)
- Store `ai_error` field (text, nullable) for debugging failures
- Fallback: if AI fails or validation rejects, use template-based summary and rule-based recommendations. Report still generates.

### Model and cost

- Model: Gemini 2.5 Flash (already used for existing AI analysis)
- Timing: AI runs during report generation (job worker), not at render time
- Storage: AI output stored in `analytics_reports.ai_content` as JSONB (generated once, rendered many times)
- Cost: ~1 API call per report per month. Flash tier keeps this negligible.
- Retry: if AI generation fails, report still generates with template-based fallback. Can be regenerated later via manual trigger.

## Monthly Metrics Snapshots

**Problem:** The spec requires month-over-month deltas for profile views and website clicks, but only current 28-day rolling values are stored in `instagram_accounts`. No historical snapshots exist. The edge function can fetch live from Instagram API for both periods, but that's unreliable for past data and rate-limited.

**Solution:** Add a daily account metrics snapshot table, populated by the existing `instagram-sync-cron`:

```sql
CREATE TABLE IF NOT EXISTS instagram_account_metrics_daily (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  instagram_account_id bigint NOT NULL REFERENCES instagram_accounts(id) ON DELETE CASCADE,
  snapshot_date date NOT NULL,
  followers_count integer,
  reach_28d integer,
  impressions_28d integer,
  profile_views_28d integer,
  website_clicks_28d integer,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(instagram_account_id, snapshot_date)
);
```

The sync cron already fetches these values daily — it just needs one additional INSERT to snapshot them. Report generation then queries this table for the previous month's end-of-month snapshot to calculate deltas.

**Rollout:** Metrics that lack historical data (profile views, website clicks) show current-period values only (no delta arrow) until at least one previous month's snapshot exists. No fake deltas.

## Distribution Channels

### 1. PDF Download (existing, upgraded)

Same reports table in CRM analytics page (`AnalyticsContaPage.tsx`). Each report row shows: period, status badge, generation date, download button, and new "Enviar" (send email) button for on-demand email delivery.

**Signed URLs:** Never persist signed URLs in the database. Store only `storage_path` and `html_storage_path`. Generate short-lived signed URLs (1 hour) at download time and at email send time. The existing `report_url` column is deprecated — read from `storage_path` and generate a signed URL on demand.

### 2. Hub Portal (new)

New route: `/:workspace/hub/:token/relatorios`

- Report list page: month cards with "Ver online" and "Baixar PDF" options
- "Ver online" renders the stored HTML in a sandboxed iframe (see "Security — HTML Rendering")
- "Baixar PDF" requests a short-lived signed URL from the `hub-reports` edge function
- Token-based auth matching existing Hub pattern: verify `token`, `conta_id`, `is_active`, and `expires_at` from `client_hub_tokens` table, plus workspace slug matching

### 3. Email Delivery (new)

Sent via Resend (already used for cron failure alerts).

**Email content:**
- Workspace-branded header with logo
- Subject: "Seu relatório de {Month} está pronto!"
- 2-4 key KPIs with deltas
- AI narrative snippet (first 1-2 sentences of executive summary), or omitted if AI was disabled
- Two CTAs: "Ver Relatório Completo" (links to Hub report page) and "Baixar PDF" (short-lived signed URL, 7-day expiry for email links)
- Footer: "Enviado por {WorkspaceName} via Mesaas"

**Triggers:**
- **Automatic:** Cron sends email after report generation if `workspaces.send_report_email = true` AND `clientes.send_report_email = true` (both must be true — workspace is the global switch, client is the per-client opt-in)
- **Manual:** "Enviar" button per report row in CRM analytics page. Shows a confirmation dialog with the recipient email address before sending. Requires a `reportId` (not just clientId). Does NOT bypass the client's `send_report_email` flag if set to false — shows a warning instead: "Este cliente optou por não receber relatórios por e-mail. Enviar mesmo assim?" with explicit confirm.
- **Throttling:** Maximum 1 email per report per 24 hours (prevent accidental spam). Tracked via `analytics_reports.last_emailed_at` column.
- **Audit:** Every email send (auto or manual) logged to the existing audit trail via `insertAuditLog()`.

## Security — HTML Rendering

Stored HTML rendered in the Hub is an XSS surface. Mitigations:

### At generation time (server-side)
- All user-supplied text (captions, client names, AI output) escaped via a strict HTML escaper before template injection — same pattern as `escapeHTML()` in the CRM
- No `<script>` tags in generated HTML. Template is static HTML + inline CSS + inline SVG charts only.
- AI output is plain text inserted into `<p>` tags — never rendered as raw HTML
- Post captions truncated and escaped — no user-controlled links or HTML in the report

### At render time (Hub)
- HTML served with `Content-Security-Policy: default-src 'none'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:`
- Hub "Ver online" renders HTML inside a `sandbox` iframe (`sandbox="allow-same-origin"` only — no scripts, no forms, no popups)
- HTML served via the `hub-reports` edge function (token-gated), not directly from public storage
- Storage paths are not guessable (include `conta_id` + `client_id` + month)

## Asset Preservation

Report HTML/PDF must not depend on expiring external URLs at view time.

### Post thumbnails
- During report generation, fetch each top post's thumbnail from Instagram CDN
- Store as base64 data URIs embedded directly in the HTML/PDF (thumbnails are small — ~50-100KB each for 5 posts)
- If a thumbnail fetch fails, use a styled placeholder with the post type icon

### Fonts
- Google Fonts (DM Sans, Inter, etc.) embedded as base64 `@font-face` declarations in the HTML template
- Font files bundled once during edge function deployment, not fetched at render time
- Fallback stack in CSS for graceful degradation

### Workspace logo
- Fetched from Supabase storage at generation time and embedded as base64 data URI
- If logo fetch fails, omit logo area (don't break the layout)

## Technical Architecture

### PDF rendering approach

**Not Puppeteer in Edge Functions.** Deno Deploy (Supabase Edge Function runtime) cannot run Chromium binaries.

**Approach: External PDF rendering service** called from the edge function. The edge function handles data gathering, AI generation, and HTML template rendering. The external service converts the final HTML to PDF.

Options (choose during implementation):
1. **Browserless.io** — hosted headless Chrome API. Send HTML, receive PDF. Pay-per-use, no infra to manage.
2. **Self-hosted Gotenberg** — Docker container with Chromium. Deploy alongside Supabase. More control, fixed cost.
3. **PDFShift** — HTML-to-PDF API. Simpler API surface than Browserless.

All three accept HTML input and return PDF output. The edge function is agnostic to which service is used — it sends HTML via HTTP POST and receives PDF bytes.

**Privacy consideration:** The HTML contains client data (handles, metrics, captions). Choose a service with adequate data handling policies, or self-host Gotenberg for zero data leaving infrastructure.

### Report job model

**Problem:** The current cron loops accounts sequentially and calls the generator inline. Adding AI + HTML rendering + PDF rendering + storage + email in that flow will timeout.

**Solution:** Two-phase architecture:

**Phase 1 — Cron (fast, lightweight):**
- Runs on the 1st of the month
- Queries all active Instagram accounts with connected tokens
- Creates one `analytics_reports` row per account with `status = 'pending'`
- Respects per-client `include_ai_analysis` flag (stored on the row)
- Exits. Total runtime: seconds.

**Phase 2 — Worker (processes pending reports):**
- A separate edge function (`report-worker`) triggered after the cron, or on a short interval (every 5 minutes) while pending reports exist
- Picks up reports with `status = 'pending'`, sets to `'generating'`
- Processes one report at a time (or with configurable concurrency)
- Pipeline per report: fetch data → AI (if enabled) → render HTML → external PDF service → store both → send email (if enabled) → set status `'ready'`
- On failure: set status `'failed'`, store error in `generation_error` column, increment `retry_count`
- Retry policy: up to 3 retries with exponential backoff (5min, 15min, 45min). After 3 failures, status stays `'failed'` and admin is notified via existing Resend alert.
- Idempotency: `UNIQUE(instagram_account_id, report_month)` prevents duplicate reports. Re-generation overwrites the existing row.

**Manual generation** follows the same model: creates/updates the `analytics_reports` row with `status = 'pending'` and the worker picks it up. The CRM UI polls the row status for progress feedback.

### Database changes

**New table: `instagram_account_metrics_daily`**

```sql
CREATE TABLE IF NOT EXISTS instagram_account_metrics_daily (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  instagram_account_id bigint NOT NULL REFERENCES instagram_accounts(id) ON DELETE CASCADE,
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
```

**New columns on `workspaces`:**

```sql
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
```

Note: `brand_color` already exists on `workspaces` — used as the primary color for reports. `logo_url` already exists — used for report header.

**New columns on `clientes`:**

```sql
ALTER TABLE clientes
  ADD COLUMN IF NOT EXISTS send_report_email boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS include_ai_analysis boolean NOT NULL DEFAULT true;
```

Note: `send_report_email` defaults to `false` — existing clients are not auto-enrolled when a workspace enables email delivery.

**Updated columns on `analytics_reports`:**

```sql
ALTER TABLE analytics_reports
  ADD COLUMN IF NOT EXISTS html_storage_path text,
  ADD COLUMN IF NOT EXISTS ai_content jsonb,
  ADD COLUMN IF NOT EXISTS ai_status text NOT NULL DEFAULT 'skipped'
    CHECK (ai_status IN ('skipped', 'success', 'validation_failed', 'generation_failed')),
  ADD COLUMN IF NOT EXISTS ai_error text,
  ADD COLUMN IF NOT EXISTS include_ai boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS generation_error text,
  ADD COLUMN IF NOT EXISTS retry_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_emailed_at timestamptz;
```

Note: the existing `report_url` column is deprecated. New code reads `storage_path` and generates signed URLs on demand. `report_url` is left in place for backwards compatibility with any already-generated reports but not written to by new code.

### Edge functions

| Function | Status | Description |
|----------|--------|-------------|
| `instagram-report-generator-v2/` | NEW | HTML/CSS template rendering + external PDF service call. Processes one report at a time. |
| `report-worker/` | NEW | Picks up pending reports, orchestrates the generation pipeline, handles retries. |
| `analytics-report-cron/` | MODIFIED | Simplified to only create `pending` report rows. No longer calls generator inline. |
| `instagram-analytics/` | MODIFIED | New endpoint `POST /send-report-email` with query param `reportId` for on-demand email. Validates recipient, checks throttle, logs to audit. |
| `hub-reports/` | NEW | Hub endpoint for listing and serving reports. Token-based auth (verify token + conta_id + is_active + expires_at + workspace slug). Serves HTML with CSP headers. Generates signed PDF URLs on demand. |
| `instagram-sync-cron/` | MODIFIED | Add daily INSERT into `instagram_account_metrics_daily` during existing sync flow. |

### Template system

Location: `supabase/functions/_shared/report-template/`

| File | Purpose |
|------|---------|
| `template.html` | Main report template with placeholder tokens, CSS `@page` rules, embedded base64 fonts |
| `charts.ts` | Server-side SVG chart generators (line chart, bar chart, heatmap, donut). Pure string-based SVG — no DOM needed. |
| `render.ts` | Template engine: escapes all user data, injects branding CSS variables, AI content, SVG charts, base64 assets |
| `fallback.ts` | Template-based summary and rule-based recommendations for the no-AI path |
| `escape.ts` | Strict HTML escaper for all user-supplied text (re-exports or mirrors `escapeHTML` pattern) |

### Hub routes

New pages in `apps/hub/src/`:
- `/:workspace/hub/:token/relatorios` — report list (month cards)
- `/:workspace/hub/:token/relatorios/:month` — web view of report (sandboxed iframe loading HTML from `hub-reports` edge function)

Auth: same pattern as existing Hub pages — `hub-reports` edge function verifies `client_hub_tokens.token`, `is_active = true`, `expires_at > now()`, and `conta_id` matches the workspace.

### Storage paths

- PDF: `reports/{conta_id}/{client_id}/{YYYY-MM}.pdf` (existing path convention, unchanged)
- HTML: `reports/{conta_id}/{client_id}/{YYYY-MM}.html` (new)

Never store signed URLs in the database. Generate them on demand with short expiry (1 hour for downloads, 7 days for email links).

### Email integration

Uses Resend (already configured for cron failure alerts at `alertas@mesaas.com.br`). Report emails sent from shared Mesaas sender. Each email send (automatic or manual) is logged via `insertAuditLog()` with action type `report_email_sent`, the report ID, and recipient email.

## CRM UI Changes

### Configurações page

Expand existing Workspace section with:
- Color picker for primary color (pre-populated from existing `brand_color`)
- Color pickers for secondary and accent colors (new fields)
- Font family dropdown (DM Sans, Inter, Poppins, Montserrat, Plus Jakarta Sans)
- Report theme toggle (dark/light)
- Email delivery toggle (workspace-level) with helper text: "Quando ativado, relatórios mensais serão enviados automaticamente para clientes habilitados."

### ClienteDetalhePage

New "Relatório Mensal" card with:
- Toggle: "Enviar relatório por e-mail" (`send_report_email`) — with note that workspace-level toggle must also be enabled
- Toggle: "Incluir análise AI" (`include_ai_analysis`)

### AnalyticsContaPage — Reports section

Updated report list with:
- "Enviar" button per report row for on-demand email (opens confirmation dialog showing recipient email, warns if client opted out)
- "Incluir AI" checkbox on the manual generation dialog
- Status polling: when a report is `pending` or `generating`, show a spinner and poll every 10 seconds until `ready` or `failed`
