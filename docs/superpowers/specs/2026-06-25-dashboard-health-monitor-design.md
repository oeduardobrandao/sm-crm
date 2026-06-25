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
| **connection/sync** — connected & fresh | presence of `instagram_accounts` row + `last_synced_at` |

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

1. **Desconectado** — no `instagram_accounts` row for the client. (A setup gap; itself a health signal. Card CTA: "Conectar Instagram".)
2. **Sem sincronizar** — connected but `last_synced_at` is null or older than **3 days** (sync/token problem; data is stale, not necessarily declining). Card CTA: "Reconectar".
3. **Sem dados** — connected & syncing, but insufficient history to score (no posts in 56d **and** < 2 follower-history points, e.g. a brand-new account). Neutral; avoids a misleading "Em queda" on new accounts.
4. **Inativo** — has history but dormant: no post in **21 days** **and** pipeline empty (0 queued, 0 in production).

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
  follower_delta: number;          // 28d
  follower_series: number[];       // ~30d, for Sparkline
  engagement_rate: number;         // %
  reach_28d: number;
  reach_trend_pct: number;
  days_since_last_post: number | null;
  pipeline: { agendados: number; em_producao: number; agente: number; falha: number };
  status: HealthStatus;            // tier or override
  score: number | null;            // null for override/no-data states
  last_synced_at: string | null;
}

interface ClientHealthMonitorResult {
  clients: ClientHealth[];
  summary: {
    total: number;
    atencao: number;     // Em queda + Atenção + Inativo
    saudaveis: number;   // Em alta + Saudável
    estaveis: number;    // Estável
    semSync: number;     // Sem sincronizar + Desconectado + Sem dados
    precisamAtencao: number; // headline: Em queda + Inativo + Sem sincronizar + Desconectado
  };
}
```

The service runs ~4 batched Supabase queries (RLS-scoped to the conta) over all `status='ativo'` clients:

1. clients + their `instagram_accounts`.
2. `instagram_follower_history` last ~30–56d → delta + sparkline series.
3. `instagram_posts` last 56d → engagement, reach (split into two 28d windows for trend), last-post date.
4. `workflow_posts` of active workflows, grouped by client + status → pipeline counts.

This reuses the query logic already present in `services/analytics.ts` `getPortfolioSummary`. Shared helpers/types are extracted/reused rather than duplicated; `getPortfolioSummary` and the analytics pages keep working unchanged.

`scoreClient()` is pure and lives in **`lib/health/score.ts`** (no I/O) so it is unit-tested and tuned in isolation. The service maps each client's signals through it.

TanStack Query `staleTime` ~5 min (data is cron-synced ~daily, so frequent refetch is wasteful).

---

## Filtering & sort (client-side, no refetch)

- **Chips** filter the in-memory list; counts come from `summary`:
  - Todos · ⚠ Atenção `{Em queda, Atenção, Inativo}` · ▲ Saudáveis `{Em alta, Saudável}` · ● Estáveis `{Estável}` · ⟳ Sem sync `{Sem sincronizar, Desconectado, Sem dados}`.
- **Sort** options: **Precisam de atenção primeiro** (score asc, override-states first) [default] · Maior engajamento · Último post (mais antigo) · Mais seguidores · Nome (A–Z).
- **Search** matches client name + @username.

---

## Card actions

- **Analytics** → `/analytics/:client_id` (per-client analytics page).
- **Detalhe** → `/clientes/:id` (client detail).
- **Desconectado / Sem sincronizar** → primary CTA "Conectar" / "Reconectar" pointing at the client's Instagram connect flow.

---

## States

- **Loading:** skeleton cards in the grid.
- **No clients:** existing onboarding/empty guide (`EmptyStateGuide` / `OnboardingBanner`).
- **Clients but none connected:** grid of **Desconectado** cards, each with a "Conectar Instagram" CTA — turns the dashboard into a setup funnel.
- **Query error:** inline non-crashing message in the hero; slim ops below still render. No raw error details surfaced.

---

## Files

**New**
- `apps/crm/src/lib/health/score.ts` — pure `scoreClient()`, `HealthStatus` type, weight/threshold constants.
- `apps/crm/src/lib/health/score.test.ts` — unit tests.
- `apps/crm/src/services/clientHealth.ts` — `getClientHealthMonitor()`.
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

- **Unit (TDD) — `lib/health/score.ts`:** tier boundaries; override priority (Desconectado > Sem sync > Sem dados > Inativo > score); normalization edge cases (zero start followers, no posts, negative growth, stale sync, falha flag); composite rounding.
- **Component (RTL):** `ClientHealthCard` renders correct badge/metrics/pipeline; `HealthFilterBar` filtering + sort; grid loading/empty/error/none-connected states.
- **Verification:** `npm run build` (tsc), `npm run test`, plus CI gates (eslint, prettier `format:check`, coverage) before pushing. Update any existing dashboard tests that assert the old card layout (grep both app test suites).

---

## Open tunables (documented, not blockers)

- Weights `{growth .35, engagement .30, reachTrend .20, recency .15}`.
- Thresholds: sync-stale 3d, inactive 21d, engagement band (5% = 100), growth/reach trend bounds.
- Sparkline window (30d) and whether to show it for accounts with sparse history.

## Future (out of scope)

- AI health narrative / "what to do" suggestions on the monitor.
- Health-over-time trend and change alerts (e.g. "dropped from Saudável to Atenção this week").
- Surfacing agent-created content volume as a first-class metric.
- Client-facing health view in the Hub.
