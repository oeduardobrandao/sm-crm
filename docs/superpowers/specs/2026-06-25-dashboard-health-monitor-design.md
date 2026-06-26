# Dashboard → Client Health Monitor — Design

- **Date:** 2026-06-25
- **Status:** Approved (design); pending implementation plan
- **Branch:** `feat/dashboard-health-monitor`
- **App:** CRM (`apps/crm/`)

## Context & problem

The current dashboard (`apps/crm/src/pages/dashboard/DashboardPage.tsx`, ~840 lines) is a broad "agency operations hub": a grid of cards linking to Today, Leads, Analytics, Entregas, Contracts, Team, Finances, Calendar, plus a KPI strip. It tries to surface everything and, as a result, users don't get much focused value from it — each card is a thin teaser of a page that already exists in the nav.

As Mesaas moves toward an automated model (content created/published via Claude and other AI agents through the MCP server), the highest-value thing the dashboard can answer is: **"Across all my clients, who is healthy, who is stalling, and who needs me right now?"** — with one click to act.

This redesign refocuses the dashboard into a **client health monitor** as the hero, keeping only a slim strip of genuinely-daily operational info below.

## Goals

- At-a-glance verdict per client (a status badge) plus the supporting evidence on the same card.
- Surface improving / stable / stalling / declining / inactive clients, and data/connection problems, distinctly.
- Tie health to the automation vision: each card shows the **content pipeline** state (queued, in production, agent-created, publish failures).
- One click from any client to its **per-client analytics** (`/analytics/:id`) and **client detail** (`/clientes/:id`).
- Filter/triage to "who needs attention" without losing the overall view.

## Non-goals (this iteration)

- No AI-generated health narrative on the monitor — AI analysis stays on the drill-in analytics page (`getAccountAIAnalysis`). The monitor's score is deterministic and code-computed.
- No historical health-over-time charts or health-change alerts.
- No in-UI weight customization — weights/thresholds are named constants, tuned in code.
- No changes to the Hub (client portal).

## Users & roles

Roles are `owner | admin | agent` (via `AuthContext`). The health grid and the "Hoje" card are visible to everyone. The finance KPI strip is **owner/admin only** (agents already don't see finance), reusing existing role gating.

---

## Page structure

The page becomes a thin shell. `DashboardPage.tsx` is refactored from a 840-line monolith into focused, independently-understandable units.

```
DashboardPage (thin shell)
├── OnboardingBanner            (existing, kept; non-agent)
├── ClientHealthMonitor         (HERO)
│   ├── HealthFilterBar         (status chips w/ counts · search · sort)
│   └── ClientHealthGrid
│       └── ClientHealthCard[]  (avatar · status badge · metrics · Sparkline · PipelineRow · actions)
└── Slim ops (below the hero)
    ├── TodayCard               (extracted from current DashboardPage)
    └── FinanceKpiStrip         (owner/admin only; extracted)
```

Everything else currently on the dashboard (Leads, Entregas, Contratos, Equipe, Calendário, and the old Analytics teaser card) is **removed** — each already has a dedicated page in the nav.

---

## Health model

### Signals (per client, 28-day window unless noted)

| Signal | Source |
|---|---|
| **growth** — follower Δ% over 28d | `instagram_follower_history` (first vs last in window) |
| **engagement** — avg engagement rate of posts in window | `instagram_posts` (likes+comments+saved+shares)/reach |
| **reachTrend** — reach in current 28d vs prior 28d | `instagram_posts` reach, split into two 28d windows (56d fetch) |
| **recency** — days since last post | latest `instagram_posts.posted_at` |
| **pipeline** — queued / in-production / agent / failed | `workflow_posts` of the client's active workflows |
| **connection/sync** — connected, authorized, fresh | `instagram_accounts` presence + `authorization_status` + `token_expires_at` + `last_synced_at` |

### Sub-score normalization (each → 0–100)

Concrete starting heuristics (constants in `score.ts`, tunable):

- **growthScore** from follower Δ% `p`: `p ≤ -2%` → 0; `-2%..0%` → linear 0–50; `0%..+5%` → linear 50–100; `> +5%` → 100.
- **engagementScore** from engagement rate `e` (%): `clamp(e / 5 * 100, 0, 100)` (i.e. 5%+ → 100), with documented bands.
- **reachTrendScore** from reach Δ% `r` (current vs prior 28d): `r ≤ -30%` → 0; `-30%..0%` → linear 0–50; `0%..+30%` → linear 50–100; `> +30%` → 100.
- **recencyScore** from days since last post `d`: `d ≤ 3` → 100; piecewise linear down to `d = 7` → 70, `14` → 40, `21` → 15, `≥ 28` → 0.

### Composite

```
score = round(0.35·growthScore + 0.30·engagementScore
            + 0.20·reachTrendScore + 0.15·recencyScore)
```

| Score | Tier (badge) | Color |
|---|---|---|
| 80–100 | **Em alta** | bright green |
| 60–79 | **Saudável** | green |
| 40–59 | **Estável** | neutral |
| 20–39 | **Atenção** | amber |
| 0–19 | **Em queda** | red |

### Override statuses (evaluated first, in priority order — skip the score)

Connection state must distinguish **authorization** problems from **sync/data** problems — they have different meaning and different fixes. The existing codebase already separates these: `authorization_status ∈ {'revoked','expired'}` and `token_expires_at < now` are reconnect signals (InstagramOverviewCard.ts:28–31, integrations.ts:105–108), while `last_synced_at === null` means *initial sync in progress*, not stale (ClienteDetalhePage.tsx:2459).

1. **Desconectado** — no `instagram_accounts` row for the client. A setup gap. Card CTA: "Conectar Instagram".
2. **Reconectar** — `authorization_status = 'revoked'` **or** `'expired'` **or** `token_expires_at < now`. Authorization is broken; data can't refresh until the user re-auths. **Danger** styling. Card CTA: "Reconectar".
3. **Sincronizando** — account exists and is authorized, but `last_synced_at IS NULL` (first sync hasn't completed yet). Neutral/transient; **not** an alarm. No CTA beyond a subtle spinner/label.
4. **Sem sincronizar** — authorized and has synced before, but `last_synced_at` is older than **3 days** (cron/data-flow problem; data is stale, not necessarily declining). Indigo. CTA: "Sincronizar agora".
5. **Sem dados** — syncing fine, but insufficient history to score (no posts in 56d **and** < 2 follower-history points, e.g. a brand-new connected account). Neutral; avoids a misleading "Em queda" on new accounts.
6. **Inativo** — has history but dormant: no post in **21 days** **and** pipeline empty (0 queued, 0 in production).

If none apply, the score-based tier is used.

### Flag overlay (independent of status)

- **falha** — any `workflow_posts.status = 'falha_publicacao'` for the client → a ⚠ "falha" flag on the card, regardless of tier.

These thresholds (sync 3d, inactive 21d) and weights are an internal heuristic — there is no authoritative external source for "health," consistent with how the project treats IG ranking weights. All live as named constants for easy tuning.

---

## Pipeline row

Reads real state from `workflow_posts` joined to active (`status='ativo'`) workflows for the client:

- **agendados** = count of `status = 'agendado'`.
- **em produção** = count of `status ∈ {rascunho, revisao_interna, aprovado_interno, enviado_cliente, aprovado_cliente, correcao_cliente}`.
- **agente** = count with `created_via = 'agent'` (shown as 🤖 — ties to the automation vision).
- **falha** = count of `status = 'falha_publicacao'`.
- If `agendados = 0 && em produção = 0` → render **"Pipeline parado"** (amber if Atenção+, red if Em queda).

---

## Data layer

A single `useQuery(['clientHealth'])` backed by **`services/clientHealth.ts` → `getClientHealthMonitor()`**, returning:

```ts
interface ClientHealth {
  client_id: number;
  client_name: string;
  client_sigla: string;
  client_cor: string;
  username: string | null;
  profile_picture_url: string | null;
  connected: boolean;
  follower_count: number;
  follower_delta: number;          // 28d, ABSOLUTE follower count change (for display) — matches analytics.ts
  follower_delta_pct: number;      // 28d, PERCENT change (drives growthScore) — never conflate with the absolute
  follower_series: number[];       // downsampled ~8–12 points over 30d, for Sparkline
  engagement_rate: number;         // %
  reach_28d: number;
  reach_trend_pct: number;
  days_since_last_post: number | null;
  pipeline: { agendados: number; em_producao: number; agente: number; falha: number };
  // connection inputs (drive the override states)
  authorization_status: string | null;  // 'active' | 'expired' | 'revoked' | null
  token_expires_at: string | null;
  last_synced_at: string | null;
  status: HealthStatus;            // tier or override
  score: number | null;            // null for override/no-data states
}

// HealthStatus =
//   'em_alta' | 'saudavel' | 'estavel' | 'atencao' | 'em_queda'   (score tiers)
//   | 'inativo' | 'sem_dados' | 'sincronizando'
//   | 'sem_sincronizar' | 'reconectar' | 'desconectado'           (overrides)

interface ClientHealthMonitorResult {
  clients: ClientHealth[];
  summary: {
    total: number;
    atencao: number;     // Em queda + Atenção + Inativo
    saudaveis: number;   // Em alta + Saudável
    estaveis: number;    // Estável
    conexao: number;     // Desconectado + Reconectar + Sem sincronizar + Sincronizando + Sem dados
    precisamAtencao: number; // headline (actionable now): Em queda + Inativo + Reconectar + Sem sincronizar + Desconectado
  };
}
```

> Units caveat (review finding): `follower_delta` is an **absolute** count (consistent with `getPortfolioSummary`, analytics.ts:341); `growthScore` is computed from **`follower_delta_pct`**. Keeping them as separate fields prevents scoring an absolute follower gain as if it were a percentage.

**Aggregation must happen server-side — raw row reads do not scale (review finding, High).** Postgres/PostgREST caps result sets (default `db-max-rows` = 1000). Aggregating in the client the way `getPortfolioSummary` does (analytics.ts:296–315 reads raw `instagram_posts`, follower history, and an unbounded `latestPosts`) silently truncates at scale — e.g. follower history alone is ≈ accounts × 56 days (30 accounts ≈ 1,680 rows > 1,000), so deltas, recency, trend, and pipeline counts would be computed from a partial set and be **wrong without erroring**. (This is a pre-existing latent bug in `getPortfolioSummary`; noted for follow-up below, out of scope here.)

The service therefore calls a dedicated **Postgres RPC** that returns exactly one row per active client, with all aggregation done in SQL:

```
get_client_health_aggregates(p_window_days int default 28)
  → one row per clientes WHERE status='ativo' (RLS-scoped to conta), LEFT JOIN instagram_accounts
```

Each row provides: account presence + `authorization_status`, `token_expires_at`, `last_synced_at`; follower first/last in window (→ absolute delta + pct) and a downsampled `follower_series` array (~8–12 points); engagement and reach aggregated over current vs prior 28d windows (→ engagement_rate, reach_28d, reach_trend_pct); `max(posted_at)` (→ days_since_last_post, null if none); and `workflow_posts` counts grouped by status class (agendados / em_producao / agente / falha). One round trip, bounded payload, correct regardless of post volume.

- **Build the client list from `clientes` (all `status='ativo'`), LEFT-joined to accounts** — NOT from `PortfolioSummary.accounts`, which returns only *connected* accounts (analytics.ts:274) and would drop **Desconectado** clients entirely. Reuse from `analytics.ts` means shared **types/helpers**, not its result shape.
- `getPortfolioSummary` and the analytics pages are untouched by this work.

`scoreClient()` is pure and lives in **`lib/health/score.ts`** (no I/O) so it is unit-tested and tuned in isolation. The service maps each RPC row's signals through it to derive `status` + `score`.

TanStack Query `staleTime` ~5 min (data is cron-synced ~daily, so frequent refetch is wasteful).

---

## Filtering & sort (client-side, no refetch)

- **Chips** filter the in-memory list; counts come from `summary`:
  - Todos · ⚠ Atenção `{Em queda, Atenção, Inativo}` · ▲ Saudáveis `{Em alta, Saudável}` · ● Estáveis `{Estável}` · 🔌 Conexão `{Desconectado, Reconectar, Sem sincronizar, Sincronizando, Sem dados}`.
- **Sort** options: **Precisam de atenção primeiro** (default) · Maior engajamento · Último post (mais antigo) · Mais seguidores · Nome (A–Z). For the default, actionable override states (Reconectar, Sem sincronizar, Desconectado, Inativo) sort to the top, then score ascending; transient/neutral states (Sincronizando, Sem dados) sort after the scored tiers.
- **Search** matches client name + @username.

---

## Card actions

- **Analytics** → `/analytics/:client_id` (per-client analytics page).
- **Detalhe** → `/clientes/:id` (client detail).
- **Desconectado** → "Conectar Instagram"; **Reconectar** (revoked/expired) → "Reconectar" (re-auth flow); **Sem sincronizar** → "Sincronizar agora". All point at the client's existing Instagram connect/sync actions.

---

## States

- **Loading:** skeleton cards in the grid.
- **No clients:** existing onboarding/empty guide (`EmptyStateGuide` / `OnboardingBanner`).
- **Clients but none connected:** grid of **Desconectado** cards, each with a "Conectar Instagram" CTA — turns the dashboard into a setup funnel.
- **Query error:** inline non-crashing message in the hero; slim ops below still render. No raw error details surfaced.

---

## Files

**New**
- `supabase/migrations/<ts>_client_health_aggregates.sql` — `get_client_health_aggregates(p_window_days)` RPC (SQL-side aggregation, RLS-scoped via `conta_id`; `SECURITY INVOKER` so RLS applies).
- `apps/crm/src/lib/health/score.ts` — pure `scoreClient()`, `HealthStatus` type, weight/threshold constants.
- `apps/crm/src/lib/health/score.test.ts` — unit tests.
- `apps/crm/src/services/clientHealth.ts` — `getClientHealthMonitor()` (calls the RPC, maps rows through `scoreClient`).
- `apps/crm/src/services/clientHealth.test.ts` — service tests (mocked RPC rows).
- `apps/crm/src/pages/dashboard/components/ClientHealthMonitor.tsx`
- `apps/crm/src/pages/dashboard/components/ClientHealthGrid.tsx`
- `apps/crm/src/pages/dashboard/components/ClientHealthCard.tsx`
- `apps/crm/src/pages/dashboard/components/HealthFilterBar.tsx`
- `apps/crm/src/pages/dashboard/components/PipelineRow.tsx`
- `apps/crm/src/pages/dashboard/components/Sparkline.tsx` (small reusable SVG)
- `apps/crm/src/pages/dashboard/components/TodayCard.tsx` (extracted)
- `apps/crm/src/pages/dashboard/components/FinanceKpiStrip.tsx` (extracted)

**Modified**
- `apps/crm/src/pages/dashboard/DashboardPage.tsx` — reduced to a thin shell composing the above.
- `services/analytics.ts` — extract/share query helpers if it reduces duplication (no behavior change to existing exports).
- i18n: dashboard namespace keys for statuses, chips, sort labels, pipeline strings (pt-BR + en).

---

## Testing

- **Unit (TDD) — `lib/health/score.ts`:** tier boundaries; override priority (Desconectado > Reconectar > Sincronizando > Sem sincronizar > Sem dados > Inativo > score); reconnect detection (`revoked` / `expired` / `token_expires_at < now`) vs `last_synced_at === null` initial-sync vs >3d stale; normalization edge cases (zero start followers, no posts, negative growth %, falha flag); growth uses `follower_delta_pct` not the absolute; composite rounding.
- **Service — `services/clientHealth.test.ts` (mocked RPC rows, review finding):** disconnected clients are **included** (not dropped); revoked/expired → Reconectar; `last_synced_at` null → Sincronizando; stale → Sem sincronizar; no-post / null `max(posted_at)` → days_since_last_post null & Sem dados/Inativo as appropriate; pipeline status grouping (agendados / em_producao / agente / falha); aggregates correct for large row counts (the RPC returns one row per client regardless of underlying post/follower volume — assert no truncation behavior).
- **Component (RTL):** `ClientHealthCard` renders correct badge/metrics/pipeline and the right CTA per connection state; `HealthFilterBar` filtering + sort; grid loading/empty/error/none-connected states.
- **Verification:** `npm run build` (tsc), `npm run test`, plus CI gates (eslint, prettier `format:check`, coverage) before pushing. Update any existing dashboard tests that assert the old card layout (grep both app test suites).

---

## Open tunables (documented, not blockers)

- Weights `{growth .35, engagement .30, reachTrend .20, recency .15}`.
- Thresholds: sync-stale 3d, inactive 21d, engagement band (5% = 100), growth/reach trend bounds.
- Sparkline window (30d) and whether to show it for accounts with sparse history.

## Future (out of scope)

- **Fix the latent truncation in `getPortfolioSummary`** (analytics.ts) — same row-cap risk this spec avoids via the RPC; the `/analytics` portfolio page still uses the client-side aggregation. Track separately; could reuse the new RPC.
- AI health narrative / "what to do" suggestions on the monitor.
- Health-over-time trend and change alerts (e.g. "dropped from Saudável to Atenção this week").
- Surfacing agent-created content volume as a first-class metric.
- Client-facing health view in the Hub.
