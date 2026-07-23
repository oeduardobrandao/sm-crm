# Analytics Report Redesign — Design Spec

**Date:** 2026-07-22
**Status:** Approved prototype, pending implementation plan
**Prototype:** [`2026-07-22-analytics-report-redesign-prototype.html`](./2026-07-22-analytics-report-redesign-prototype.html) (open in a browser; resize below 860px for the Hub mobile layer)

## 1. Context

The monthly client report (`instagram-report-generator-v2` + `_shared/report-template/`) has structural design problems: fonts are whitelisted but never loaded (every PDF renders in Helvetica), Mesaas yellow is hardcoded into "whitelabel" styles, fixed page slots leave 25–40% dead space on several pages, the AI's `detailed_analysis`/`recommendations`/`suggested_goals` are generated and stored but never rendered, and the fixed 210mm layout is unusable in the Hub's mobile iframe.

This spec replaces the report's visual layer with a design derived from the Client Hub's design language (PR #230), adds an agency-editable cover (logo + splash art), surfaces the dropped AI content, adds previous-period baselines, and introduces a validated data-color system. It also reshapes **Configurações → Relatório Mensal** to match the new, smaller branding surface.

## 2. Goals / non-goals

**Goals**

1. Report artifact (HTML + PDF) restyled to the Hub language; readable on mobile inside the Hub iframe.
2. Fonts actually embedded (Fraunces + Instrument Sans, base64 WOFF2 subsets).
3. Whitelabel = one accent color (shared with the Hub's `brand_color`) + logo + splash art. No hardcoded Mesaas yellow anywhere in the template.
4. AI narrative fully rendered: executive summary, per-section takeaways, recommendations page, suggested goals.
5. Previous-period raw values shown next to every % delta.
6. Data-color system: validated categorical trio for content formats, sequential amber ramp for the heatmap, single tint for audience bars, amber status tone for priority. Semantic green/red reserved for deltas.
7. Configurações → Relatório Mensal reworked: splash upload, single accent color, live preview; font/theme/secondary-color controls removed.

**Non-goals (tracked separately, not in this slice)**

- Demographics/best-times fallback fetch when `instagram_analytics_cache` is empty.
- Email PDF-link expiry mismatch (7d email vs 1h hub).
- Month picker / report regeneration UX in `AnalyticsContaPage`.
- Reels/Stories-specific metrics.
- Dark report theme (see §7 — `report_theme` is deprecated in v2).
- Deleting the dead client-side `buildReportHtml` in `AnalyticsContaPage.tsx` (separate cleanup PR; zero risk, no dependency).

## 3. Visual system

### 3.1 Tokens

Mirrors `apps/hub/src/theme.ts` + `apps/hub/index.html`:

| Token | Value | Notes |
|---|---|---|
| `--font-display` | Fraunces (serif) | headings, big numbers, cover handle; optical sizing, −0.01em |
| `--font-sans` | Instrument Sans | everything else; `font-feature-settings: 'ss01','cv11'` |
| `--paper` | `#FAFAF7` | page background |
| `--card` | `#FFFFFF` | cards; border `rgba(231,229,228,.9)`, radius 12px, Hub card shadow |
| `--ink` | `#1C1917` | text, charts, cover background |
| `--tx2` / `--tx3` | `#525252` / `#8A8A8A` | secondary / muted text |
| `--acc` | workspace `brand_color`, default `#171717` | resolved exactly like `resolveHubTheme`: luminance-clamped, `--acc-fg` picked by luminance |
| `--up` / `--down` | `#1a7f4b` / `#b3423a` | delta chips only — reserved |

No uppercase-tracked labels, no monospace. Sentence case throughout. Numbers use `font-variant-numeric: tabular-nums`.

**Two color systems, never mixed:**

- **Brand accent (`--acc`, arbitrary hue):** structural marks only — takeaway dash, post rank chips, "formato líder" chip. Never encodes data.
- **Data palette (fixed, CVD-validated):** formats trio, heatmap ramp, audience tint, priority tone, delta green/red. Never tinted by the brand.

### 3.2 Data palette (validated 2026-07-22, light surface, all-pairs)

| Role | Value |
|---|---|
| Formato Reels | `#D97706` (amber) |
| Formato Carrosséis | `#0D9488` (teal) |
| Formato Imagens | `#A21CAF` (plum) |
| Heatmap ramp (7 steps, light→dark) | `#F5DCAE` `#F0CF93` `#ECC178` `#E0A344` `#CE8418` `#B26A08` `#8F5306` |
| Audience bar tint | `#E0A344` (ramp step 400) |
| Priority-alta tone | bg `#F7E8CE`, text `#8F5306` |

Trio validation result (dataviz skill validator, `--pairs all --mode light`): worst CVD ΔE 12.5 (target ≥8), worst normal-vision ΔE 24.3 (floor 15), all ≥3:1 vs surface. **Rule:** format colors appear as small marks (dots, bars) next to ink text — text never wears the series color. If the trio is ever changed, re-run the validator before merging.

### 3.3 Page structure (6 pages)

1. **Capa** — ink-black panel. Top: logo on light plate (§3.4) + workspace name, "Relatório mensal / Instagram" kicker right. Middle: month (dash prefix), client handle in Fraunces ~54px, specialty. **Splash art window** (flex-fills the middle, radius 14px). Bottom: 3-metric teaser strip with delta + previous value.
2. **Resumo do mês** — takeaway, executive summary card, 4 KPI cards, Destaques (best post + content mix with format dots), "Neste relatório" index strip.
3. **Crescimento e formatos** — follower line chart (pt-BR ticks "1 jun", ≤4 x-ticks, net-gain annotation pill, event marker on spike); 3 format cards (reach bar in format color + engagement %, "formato líder" highlight); 3 complementary KPI cards (only the ones not on page 2 — no duplicates).
4. **Publicações do mês** — takeaway; top-6 as cards (2-line captions ≥10px, format dot in type badge, rank chip in `--acc`); ranks 7–15 as compact list rows with format dots; topics table (bars stay ink).
5. **Quem é a sua audiência** — donut (ink + stone, no pink/blue), age bars, cities/countries bars (all `#E0A344`); heatmap with amber ramp + "1º/2º/3º" chips inheriting the darkest ramp steps.
6. **Recomendações para julho** — takeaway; recommendation cards (Fraunces number, title, description, priority tag); 3 goal cards (dashed border); closing contact banner (ink background, agency contact).

Every content page: footer with workspace name · handle+month · page number "n / total". Every section: title row with hairline rule + "NN / 05" index.

**Signature element — "Leitura do mês":** each section opens with a one-sentence takeaway in Fraunces (~15.5px), key number bolded and underlined, preceded by a small gray label with an 18×2px dash in `--acc`.

Conditional sections collapse exactly as today (audience, heatmap, tags); pages that lose all content are dropped and page numbers renumber accordingly.

### 3.4 Cover branding

- **Logo:** `branding.logo_base64` (existing pipeline) rendered on a light plate (`#FAFAF7`, radius 10px, padding 9×14px, logo height 26px, max-width 150px, `object-fit: contain`). The plate guarantees legibility for any logo color on the ink cover. No logo → no plate, wordmark text only.
- **Splash art (NEW):** full-width art window between title block and teaser strip. `object-fit: cover`, suggested ~21:9 landscape. No upload → block not rendered; cover falls back to the typographic layout (this is the default). Additionally, the contour-lines pattern from the prototype ships as one selectable preset in the upload card ("Usar padrão Mesaas") — choosing it stores the built-in asset path; it is never applied implicitly.

### 3.5 Charts

- All static (inline SVG or plain HTML/CSS) — Gotenberg has no JS.
- Follower chart stays SVG (`charts.ts` `lineChart`, extended: pt-BR tick formatting, max 4 x-ticks, end-point annotation pill "+N no mês", optional event marker).
- `comboChart` is **retired**; format comparison becomes the 3 HTML format cards.
- Heatmap becomes an HTML `<table>` with ramp-colored cells + ranked chips (replaces `heatmapChart` SVG).
- Donut stays SVG, recolored ink + stone.
- Stat markers are text/CSS (dots, "alc./com./salv." abbreviations) — **no emoji** (Gotenberg has no emoji font).

### 3.6 Fonts

- Embed as base64 WOFF2 `@font-face` in the template: Fraunces 500/600 + Instrument Sans 400/500/600/700, latin subset.
- Generated once by a repo script (`scripts/build-report-fonts.ts` → `_shared/report-template/fonts.ts` exporting `REPORT_FONTS_CSS`); committed, not fetched at runtime. Budget: ≤ ~350KB total; check PDF size stays reasonable (thumbnails already dominate).
- `report_font_family` is deprecated (§7): typography is part of the product's report design, like the Hub.

### 3.7 Mobile layer (Hub iframe)

`@media screen and (max-width: 860px)`: pages become auto-height cards, footers hidden, grids stack (KPI 2-col, formats/goals 1-col, posts 2-col), heatmap horizontally scrollable, cover teaser stacks. Print/PDF output unaffected (`@media screen` only). No Hub app changes required — `RelatorioView`'s sandboxed `srcDoc` iframe renders the same HTML.

## 4. Data contract changes

### 4.1 `ReportData` (types.ts)

```ts
export interface KpiValue {
  id: string;
  value: number;
  unit: "count" | "pct";
  prev?: number | null;   // NEW — previous month's raw value, same unit
}
```

- The generator already fetches both monthly snapshots from `instagram_account_metrics_daily` to compute `kpi_deltas`; it now also carries the previous raw values through. `followers_gained` prev comes from the previous month's follower history window.
- `render.ts` shows `prev` in the delta note: `maio: 142,3 mil` (previous month name resolved from `report_month`). Missing `prev` → note falls back to `vs. maio 2026`.
- Cover teaser format: `▲ +28,9% · maio: 142,3 mil`.

### 4.2 AI content (already generated, now rendered)

`AIOutput` is unchanged — the renderer finally consumes all of it:

- `executive_summary` → Resumo card (existing).
- `recommendations[]` → page 6 cards. `priority: "high"` → "Prioridade alta" (amber tone); `"medium"`/`"low"` → neutral tag.
- `suggested_goals[]` → page 6 goal cards (`metric`, `target`, `rationale`).
- `detailed_analysis` → NOT a separate wall of text: it is dropped from the layout (kept in storage). Per-section takeaways are **deterministic** in v1 (see below). Revisit AI-written takeaways later.
- No `ai_content` (includeAI=false or ai_status=failed) → page 6 renders goals/recommendations empty-state-free: the page is dropped, page count renumbers; Resumo uses `buildFallbackSummary` as today.

**Deterministic takeaways (v1)** — one sentence per section computed in `render.ts` from the data (no AI dependency), e.g.:

- Resumo: metric with the largest positive pct delta ("O alcance cresceu X% — o melhor resultado do mês.")
- Crescimento: `+N seguidores` net.
- Formatos: leader format vs weakest ("Reels alcançam N× mais que imagens únicas.")
- Publicações: top-3 reach share of total.
- Audiência: dominant gender + age range + city.
- Templates live in `render.ts` with the numbers interpolated; sections missing data drop their takeaway line.

### 4.3 `WorkspaceBranding`

```ts
export interface WorkspaceBranding {
  logo_base64: string | null;
  splash_base64: string | null;      // NEW
  workspace_name: string;
  accent_color: string;              // = workspaces.brand_color; replaces primary/secondary/accent trio
}
```

Accent resolution (in `render.ts`, mirroring `resolveHubTheme`): invalid/missing → `#171717`; luminance > 0.85 on light surface → clamp to `#171717`; `--acc-fg` = luminance > 0.55 ? `#171717` : `#ffffff`.

## 5. Database migration

One migration (unique timestamp prefix — see CI guard):

```sql
ALTER TABLE workspaces ADD COLUMN report_splash_path text;
COMMENT ON COLUMN workspaces.report_secondary_color IS 'DEPRECATED 2026-07-22: unused by report v2 template';
COMMENT ON COLUMN workspaces.report_accent_color   IS 'DEPRECATED 2026-07-22: unused by report v2 template';
COMMENT ON COLUMN workspaces.report_font_family    IS 'DEPRECATED 2026-07-22: unused by report v2 template';
COMMENT ON COLUMN workspaces.report_theme          IS 'DEPRECATED 2026-07-22: unused by report v2 template';
```

Columns are kept (rollback safety + admin UI may still read them); nothing else reads them after this slice. `brand_color` already exists (Hub whitelabel, migration 20260721000001) and is reused as the single accent.

## 6. Configurações → Relatório Mensal (CRM)

File: `apps/crm/src/pages/configuracao/ConfiguracaoPage.tsx` (section at ~L714) + `ReportPreview.tsx`. Owner/admin only (unchanged).

### 6.1 Controls — after

| Control | Behavior |
|---|---|
| **Cor de destaque** | Single color picker bound to `workspaces.brand_color`. Helper text: "A mesma cor de destaque do Hub do Cliente. Usada em marcações do relatório — nunca nos gráficos de dados." Live hex shown. |
| **Arte da capa (splash)** | Upload card, same pattern as the existing workspace logo upload (file input → storage → save path). Accepts JPEG/PNG/WebP ≤ 4MB; client-side downscale to max 1920px width, re-encode JPEG q≈82 before upload (keeps the embedded base64 ≤ ~500KB). Stored in the existing public branding bucket at `workspaces/{id}/report-splash.jpg`; `report_splash_path` saved on the workspace. Actions: Substituir / Remover (with confirm dialog, mirroring logo removal). Empty state shows the built-in pattern thumbnail + "Sem arte, a capa fica só tipográfica." |
| **Enviar por e-mail automaticamente** | Unchanged (`send_report_email`). |
| **Removed** | Cor primária/secundária pickers, font selector, theme (dark/light) selector. |

Copy note: keep PT-BR sentence case, e.g. "Arte da capa", "Cor de destaque", "Pré-visualização".

### 6.2 Preview

`ReportPreview.tsx` is rewritten to render a miniature of the **new cover + one content strip** (pure JSX/CSS approximation, not the real template): ink cover with logo plate, splash image (live from the uploaded file), accent-colored dash/rank chip, and a KPI row. It must update live as the user picks a color or uploads art — this is the safety valve for bad splash crops (§3.4). Fraunces/Instrument Sans are NOT added to the CRM app; the preview uses `Georgia, serif` / system sans as stand-ins with a note "fontes ilustrativas".

### 6.3 Save path

Existing `updateWorkspace` flow; new field `report_splash_path` piggybacks on the same call. Splash upload happens before save (same as logo). No new edge function needed — the generator reads the path server-side, fetches the public URL, embeds base64 (identical to `logo_base64` handling; enforce ≤ 900KB fetch guard like thumbnails).

## 7. Renderer changes (edge)

| File | Change |
|---|---|
| `_shared/report-template/template-string.ts` | Full rewrite from the prototype (tokens §3.1, 6-page structure §3.3, mobile layer §3.7, fonts CSS import). Delete the stale unused `template.html`. |
| `_shared/report-template/render.ts` | New builders: cover (logo plate + splash), takeaways, format cards, ranked post list (7–15), heatmap HTML table + chips, recommendations/goals page, page-number/footer pass, prev-value delta notes, accent resolution. Remove `{{AI_ANALYSIS}}`-era placeholders. Page renumbering when conditional pages drop. |
| `_shared/report-template/charts.ts` | `lineChart`: pt-BR ticks, ≤4 x-ticks, annotation pill, event marker. `donutChart`: ink+stone. Delete `comboChart` and `heatmapChart`. |
| `_shared/report-template/fonts.ts` (NEW) | Generated base64 `@font-face` CSS (§3.6). |
| `instagram-report-generator-v2/index.ts` | Fetch splash (public URL from `report_splash_path`) → base64; carry `prev` KPI values; pass new `WorkspaceBranding` shape. |
| `_shared/report-template/email.ts` | Optional (same slice, small): sentence-case labels, accent from `brand_color`. No structural change. |

PDF conversion (Gotenberg) and storage paths unchanged. Reports regenerate on the next cron/manual run — no backfill; old stored reports keep their old look.

## 8. Testing

- `render.test.ts`: update fixtures for new placeholders; add cases — splash present/absent, logo present/absent, accent clamping (light color → `#171717`), prev-value formatting, AI page drop + renumbering, conditional audience/heatmap drops, no emoji in output, no `#eab308` literal in output.
- `charts.test.ts`: lineChart tick/annotation cases; remove combo/heatmap tests.
- Contract-change sweep (per repo memory): grep `apps/**/__tests__` and `supabase/functions/__tests__` for the old `WorkspaceBranding`/`KpiValue` shapes; run `npm run test` **and** `deno test supabase/functions/`.
- CRM: `ConfiguracaoPage` tests for the new controls (upload validation, removal dialog, brand_color save); `ReportPreview` snapshot.
- Manual: generate a real report on staging for a client with and without splash/logo/AI; open in Hub on a phone viewport; download PDF and check fonts embedded + size.

## 9. Rollout

1. Migration → staging (`npx supabase db push --linked` after ref check), then prod SQL editor if needed (per repo convention).
2. Deploy `instagram-report-generator-v2` (`--use-api`).
3. Deploy CRM (Vercel) with the Configurações changes.
4. Announce internally: next monthly cron (1st, 06:00) ships the new design; agencies can force-regenerate current month via "Gerar" to preview with real data.

## 10. Follow-ups (explicitly deferred)

Demographics cache fallback · email PDF link expiry · month picker + report preview in AnalyticsContaPage · Reels/Stories metrics · dark-theme ramp validation (`--mode dark`) · AI-written takeaways · dead `buildReportHtml` removal · custom email sending domain.
