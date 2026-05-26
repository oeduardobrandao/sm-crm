# Monthly Instagram Report Redesign

## Overview

Redesign the monthly Instagram analytics report from a basic jsPDF-generated single-page PDF to a polished, branded, multi-page HTML/CSS-to-PDF report. Add new distribution channels (Hub portal, email), workspace-level branding, AI-powered narrative analysis, and per-client feature flags.

**Benchmark:** Reportei-level visual polish and data density.

## Report Structure

5-page PDF (A4): 1-page executive summary + 3-5 page deep dive.

### Page 1 — Cover + Executive Summary

- Workspace-branded header: logo, gradient using primary + secondary colors, client @handle, report period (month/year)
- AI narrative summary (2-3 sentences) or template-based bullet summary when AI is disabled
- 4 key KPI cards with month-over-month deltas: Followers gained, Reach, Engagement rate, Saves
- Highlight cards: best post of the month, publication breakdown by content type

### Page 2 — Growth & Content Performance

- Follower growth chart: daily follower count line chart with post date markers overlaid
- Content type performance comparison: bar chart comparing Reels vs Carousels vs Images on reach, engagement, and saves
- 7 detailed KPI cards with month-over-month deltas (followers gained, engagement rate, total reach, profile views, website clicks, saves rate, publication count)

### Page 3 — Top Posts & Tag Performance

- Top 5 posts: each with thumbnail, content type badge, date, caption preview, reach, engagement, saves
- Tag/topic performance table: grouped by tag, showing avg engagement, avg reach, and post count per tag

### Page 4 — Audience & Timing

- Demographics: gender split bar, age range distribution chart
- Location: top 5 cities with horizontal bars, top 5 countries
- Best posting times: 7x24 heatmap grid showing engagement by day and hour, with top 3 slots highlighted

### Page 5 — AI Analysis & Recommendations

- Full AI narrative analysis (2-3 paragraphs) connecting metrics to causes and trends — OR template-based structured analysis when AI is disabled
- 3-5 actionable recommendations with priority indicators (high/medium/low), each with title and description
- 2-3 suggested quantitative goals for next month based on current trajectory

## Workspace Branding System

Workspace owners configure brand settings once; all client reports inherit the look.

### Brand settings (stored on `workspaces` table)

| Column | Type | Default | Description |
|--------|------|---------|-------------|
| `primary_color` | text | `#eab308` | Cover gradient, KPI accents, chart primary |
| `secondary_color` | text | `#1a1e26` | Cover gradient background |
| `accent_color` | text | `#3ecf8e` | Highlights, positive deltas |
| `font_family` | text | `DM Sans` | Options: DM Sans, Inter, Poppins, Montserrat, Plus Jakarta Sans |
| `report_theme` | text | `dark` | `dark` or `light` base theme |
| `send_report_email` | boolean | `false` | Workspace-level email delivery toggle |

### What gets branded

- Cover header gradient (primary + secondary)
- Logo placement in header and footer
- KPI card accent colors (primary)
- Chart colors (primary + accent)
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

Expand the existing Workspace section in Configurações (settings page). Currently has logo + workspace name; add color pickers, font selector, theme toggle, and email delivery toggle. Role-gated to owners/admins (already the case).

## Per-Client Feature Flags

New card on `ClienteDetalhePage.tsx` titled "Relatório Mensal" with two toggles:

| Column (on `clientes`) | Type | Default | Description |
|-------------------------|------|---------|-------------|
| `send_report_email` | boolean | `true` | Whether this client receives the monthly report via email. Only takes effect when workspace-level `send_report_email` is also enabled. |
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
  "kpis": { "followers_gained": 347, "engagement_rate": 4.2, "reach": 45200, "profile_views": 1200, "website_clicks": 89, "saves": 1800, "posts_count": 18 },
  "kpi_deltas": { "followers_pct_change": 12.4, "engagement_pct_change": -0.3, "reach_pct_change": 8.1 },
  "top_posts": [{ "type": "reel", "reach": 12400, "engagement": 6.8, "saves": 340, "caption_preview": "5 dicas para..." }],
  "content_breakdown": { "reels": { "count": 6, "avg_reach": 8200, "avg_engagement": 5.1 }, "carousels": { "count": 8, "avg_reach": 4100, "avg_engagement": 3.8 }, "images": { "count": 4, "avg_reach": 2800, "avg_engagement": 2.9 } },
  "audience": { "gender_split": { "female": 72, "male": 28 }, "top_cities": [{ "name": "São Paulo", "pct": 34 }], "top_age_ranges": [{ "range": "25-34", "pct": 41 }] },
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
    { "title": "string", "description": "string", "priority": "high|medium|low" }
  ],
  "suggested_goals": [
    { "metric": "string", "target": "string", "rationale": "string" }
  ]
}
```

### Anti-hallucination safeguards

**Prevention (in prompt):**
- Explicit instruction: "ONLY use numbers from the provided data"
- No industry benchmarks unless injected
- Structured JSON output format
- Request output as JSON for machine-parseable validation

**Validation (post-generation):**
- Parse JSON output — reject if malformed
- Verify mentioned numbers exist in input data
- Check output length bounds (min/max per section)
- Fallback: use template-based summary and rule-based recommendations if AI fails

### Model and cost

- Model: Gemini 2.5 Flash (already used for existing AI analysis)
- Timing: AI runs during report generation (cron or on-demand), not at render time
- Storage: AI output stored in `analytics_reports.ai_content` as JSONB (generated once, rendered many times)
- Cost: ~1 API call per report per month. Flash tier keeps this negligible.
- Retry: if AI generation fails, report still generates with template-based fallback. Can be regenerated later.

## Distribution Channels

### 1. PDF Download (existing, upgraded)

Same reports table in CRM analytics page (`AnalyticsContaPage.tsx`). Each report row shows: period, status badge, generation date, download button, and new "Enviar" (send email) button for on-demand email delivery.

### 2. Hub Portal (new)

New route: `/:workspace/hub/:token/relatorios`

- Report list page: month cards with "Ver online" and "Baixar PDF" options
- "Ver online" renders the same HTML template used for PDF — responsive, interactive version
- "Baixar PDF" downloads the stored PDF via signed URL
- Token-based auth (same as existing Hub pages, no login required)

### 3. Email Delivery (new)

Sent via Resend (already used for cron failure alerts).

**Email content:**
- Workspace-branded header with logo
- Subject: "Seu relatório de {Month} está pronto!"
- 2-4 key KPIs with deltas
- AI narrative snippet (first 1-2 sentences of executive summary)
- Two CTAs: "Ver Relatório Completo" (links to Hub report page) and "Baixar PDF" (signed download URL)
- Footer: "Enviado por {WorkspaceName} via Mesaas"

**Triggers:**
- Automatic: cron sends email after report generation if `workspaces.send_report_email = true` AND `clientes.send_report_email = true` (both must be true — workspace is the global switch, client is the per-client opt-out)
- Manual: "Enviar" button per report in CRM analytics page (bypasses both flags — explicit user action)

## Technical Architecture

### Generation approach

HTML/CSS template rendered by headless Chromium (Puppeteer) in a Supabase Edge Function. The same HTML template powers both the PDF export and the Hub portal web view.

### Generation pipeline

1. **Trigger:** Cron (1st of month) or manual button. Params: `clientId`, `month`, `includeAI: boolean`.
2. **Fetch data:** Edge function gathers KPIs + deltas, posts analytics, follower history, audience demographics, best posting times, tag performance, and workspace branding.
3. **AI generation (conditional):** If `includeAI === true`, send data to Gemini 2.5 Flash, parse and validate JSON response, store in `analytics_reports.ai_content`. If `includeAI === false`, generate template-based summary and rule-based recommendations.
4. **Render HTML:** Populate HTML/CSS template with data, AI content (or fallback), and workspace branding. Charts rendered server-side as SVGs. Branding applied via CSS variables.
5. **PDF generation:** Puppeteer renders HTML to multi-page A4 PDF. CSS `@page` rules handle page breaks.
6. **Store & distribute:** Save HTML to storage (for Hub), save PDF to storage (for download), update `analytics_reports` row, send email if enabled.

### Database changes

**New columns on `workspaces`:**

```sql
ALTER TABLE workspaces
  ADD COLUMN primary_color text DEFAULT '#eab308',
  ADD COLUMN secondary_color text DEFAULT '#1a1e26',
  ADD COLUMN accent_color text DEFAULT '#3ecf8e',
  ADD COLUMN font_family text DEFAULT 'DM Sans',
  ADD COLUMN report_theme text DEFAULT 'dark',
  ADD COLUMN send_report_email boolean DEFAULT false;
```

**New columns on `clientes`:**

```sql
ALTER TABLE clientes
  ADD COLUMN send_report_email boolean DEFAULT true,
  ADD COLUMN include_ai_analysis boolean DEFAULT true;
```

**New/updated columns on `analytics_reports`:**

```sql
ALTER TABLE analytics_reports
  ADD COLUMN html_url text,
  ADD COLUMN html_storage_path text,
  ADD COLUMN ai_content jsonb,
  ADD COLUMN include_ai boolean DEFAULT true;
```

### Edge functions

| Function | Status | Description |
|----------|--------|-------------|
| `instagram-report-generator-v2/` | NEW | HTML/CSS-based report generator with Puppeteer PDF rendering |
| `analytics-report-cron/` | MODIFIED | Updated to use v2 generator, respect per-client AI and email flags |
| `instagram-analytics/` | MODIFIED | New endpoint `POST /send-report-email/:clientId` for on-demand email |
| `hub-reports/` | NEW | Hub endpoint for listing and serving reports (token-based auth) |

### Template system

Location: `supabase/functions/_shared/report-template/`

| File | Purpose |
|------|---------|
| `template.html` | Main report template with placeholder tokens and CSS `@page` rules |
| `charts.ts` | Server-side SVG chart generators (line chart, bar chart, heatmap, donut) |
| `render.ts` | Template engine: injects data, branding CSS variables, AI content, SVG charts |
| `fallback.ts` | Template-based summary and rule-based recommendations for the no-AI path |

### Hub route

New page in `apps/hub/src/`:
- `/:workspace/hub/:token/relatorios` — report list (month cards)
- `/:workspace/hub/:token/relatorios/:month` — web view of report (renders stored HTML)

### Storage paths

- PDF: `reports/{conta_id}/{client_id}/{YYYY-MM}.pdf` (existing path, unchanged)
- HTML: `reports/{conta_id}/{client_id}/{YYYY-MM}.html` (new)

### Email integration

Uses Resend (already configured for cron failure alerts at `alertas@mesaas.com.br`). Report emails sent from workspace-branded sender or shared Mesaas sender, depending on Resend plan capabilities.

## CRM UI Changes

### Configurações page

Expand existing Workspace section with:
- Color pickers for primary, secondary, accent colors
- Font family dropdown (DM Sans, Inter, Poppins, Montserrat, Plus Jakarta Sans)
- Report theme toggle (dark/light)
- Email delivery toggle (workspace-level)

### ClienteDetalhePage

New "Relatório Mensal" card with:
- Toggle: "Enviar relatório por e-mail" (`send_report_email`)
- Toggle: "Incluir análise AI" (`include_ai_analysis`)

### AnalyticsContaPage — Reports section

Updated report list with:
- "Enviar" button per report row for on-demand email
- "Incluir AI" checkbox on the manual generation dialog
