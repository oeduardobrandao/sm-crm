# Dashboard Client Health Monitor — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the CRM dashboard's broad operations hub with a per-client health monitor (status badge + metrics + sparkline + pipeline row), keeping a slim ops strip (Hoje + finance KPIs) below.

**Architecture:** A pure scoring module (`lib/health/score.ts`) turns per-client signals into a 0–100 score + status. A Postgres RPC (`get_client_health_aggregates`) does all heavy aggregation server-side (one row per active client). A service (`services/clientHealth.ts`) calls the RPC, maps rows through the scorer, and computes a summary. React components render a filterable card grid. `DashboardPage` becomes a thin shell.

**Tech Stack:** React 19, React Router v7, TanStack Query, TypeScript, Supabase (Postgres RPC + RLS), Vitest + @testing-library/react, i18next (`@mesaas/i18n`), Tailwind + project CSS classes.

**Spec:** `docs/superpowers/specs/2026-06-25-dashboard-health-monitor-design.md`

## Global Constraints

- **No linter/formatter is "configured" but CI enforces eslint, prettier `format:check`, and a coverage ratchet** — run `npm run build`, `npm run test`, and prettier before pushing.
- **Typecheck = `npm run build`** (runs `tsc` then `vite build`). Run after every code change.
- **Roles are `owner | admin | agent`** — gate via `useAuth()` from `context/AuthContext`, never hardcode. Agents never see finance.
- **Path alias `@/` → `apps/crm/src/`.** ES modules only.
- **Edge/SQL:** RPCs use `SECURITY INVOKER` and scope by `conta_id IN (SELECT public.get_my_conta_id())` so RLS applies. Migrations are `supabase/migrations/<UTC-timestamp>_<name>.sql`.
- **Security:** never interpolate user data into raw HTML without `escapeHTML()`; use `sanitizeUrl()` for external hrefs. (New code here uses React/JSX, which escapes by default — no raw `innerHTML`.)
- **Toasts:** `toast` from `sonner` (not the legacy `showToast`).
- **i18n:** all visible strings via `useTranslation('dashboard')`; keys live in `packages/i18n/locales/{pt,en}/dashboard.json`. The Vitest setup (`test/vitest.setup.ts`) imports `dashboard.json` directly, so keys added there are available in tests automatically.
- **Tests:** colocated `*.test.ts(x)` or under `__tests__/`. The supabase mock (`apps/crm/src/lib/__mocks__/supabase.ts`) activates via `vi.mock('../lib/supabase')` and exposes `__resetSupabaseMock`, `__queueSupabaseRpc`, `__queueSupabaseResult`, `__setCurrentProfile`, `__getSupabaseCalls`.

---

## File Structure

**New**
- `apps/crm/src/lib/health/score.ts` — pure scoring + `HealthStatus`/`HealthSignals`/`HealthResult` types + constants.
- `apps/crm/src/lib/health/score.test.ts` — unit tests.
- `apps/crm/src/lib/health/filter.ts` — pure `filterAndSortClients` + filter/sort types.
- `apps/crm/src/lib/health/filter.test.ts` — unit tests.
- `supabase/migrations/20260625130000_client_health_aggregates.sql` — the aggregation RPC.
- `apps/crm/src/services/clientHealth.ts` — `getClientHealthMonitor()` + `ClientHealth*` types.
- `apps/crm/src/services/clientHealth.test.ts` — service tests (mocked RPC rows).
- `apps/crm/src/pages/dashboard/components/Sparkline.tsx`
- `apps/crm/src/pages/dashboard/components/PipelineRow.tsx`
- `apps/crm/src/pages/dashboard/components/ClientHealthCard.tsx`
- `apps/crm/src/pages/dashboard/components/HealthFilterBar.tsx`
- `apps/crm/src/pages/dashboard/components/ClientHealthGrid.tsx`
- `apps/crm/src/pages/dashboard/components/ClientHealthMonitor.tsx`
- `apps/crm/src/pages/dashboard/components/TodayCard.tsx`
- `apps/crm/src/pages/dashboard/components/FinanceKpiStrip.tsx`
- `apps/crm/src/pages/dashboard/components/__tests__/*.test.tsx` — component tests.

**Modified**
- `apps/crm/src/pages/dashboard/DashboardPage.tsx` — reduced to a thin shell.
- `packages/i18n/locales/pt/dashboard.json`, `packages/i18n/locales/en/dashboard.json` — add `health` keys.

---

## Task 1: Pure scoring module (`lib/health/score.ts`)

**Files:**
- Create: `apps/crm/src/lib/health/score.ts`
- Test: `apps/crm/src/lib/health/score.test.ts`

**Interfaces:**
- Produces:
  - `type HealthStatus = 'em_alta'|'saudavel'|'estavel'|'atencao'|'em_queda'|'inativo'|'sem_dados'|'sincronizando'|'sem_sincronizar'|'reconectar'|'desconectado'`
  - `interface HealthSignals { connected: boolean; authorizationStatus: string|null; tokenExpiresAt: string|null; lastSyncedAt: string|null; followerDeltaPct: number; engagementRate: number; reachTrendPct: number; daysSinceLastPost: number|null; hasMinimumData: boolean; pipelineActive: boolean; nowMs: number }`
  - `interface HealthResult { status: HealthStatus; score: number|null }`
  - `function scoreClient(s: HealthSignals): HealthResult`
  - `function growthScore(deltaPct: number): number`, `engagementScore(rate: number): number`, `reachTrendScore(pct: number): number`, `recencyScore(days: number|null): number`
  - consts `HEALTH_WEIGHTS`, `SYNC_STALE_DAYS`, `INACTIVE_DAYS`, `ENGAGEMENT_FULL`

- [ ] **Step 1: Write the failing test**

Create `apps/crm/src/lib/health/score.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  growthScore,
  engagementScore,
  reachTrendScore,
  recencyScore,
  scoreClient,
  type HealthSignals,
} from './score';

const NOW = Date.UTC(2026, 5, 25); // fixed clock for deterministic override tests
const daysAgoIso = (d: number) => new Date(NOW - d * 86400000).toISOString();

const base: HealthSignals = {
  connected: true,
  authorizationStatus: 'active',
  tokenExpiresAt: daysAgoIso(-30), // 30 days in the future
  lastSyncedAt: daysAgoIso(0),
  followerDeltaPct: 0,
  engagementRate: 0,
  reachTrendPct: 0,
  daysSinceLastPost: 0,
  hasMinimumData: true,
  pipelineActive: false,
  nowMs: NOW,
};

describe('normalization', () => {
  it('growthScore is piecewise 0/50/100', () => {
    expect(growthScore(-3)).toBe(0);
    expect(growthScore(-1)).toBe(25);
    expect(growthScore(0)).toBe(50);
    expect(growthScore(2.5)).toBe(75);
    expect(growthScore(10)).toBe(100);
  });
  it('engagementScore caps at 5%', () => {
    expect(engagementScore(0)).toBe(0);
    expect(engagementScore(2.5)).toBe(50);
    expect(engagementScore(5)).toBe(100);
    expect(engagementScore(8)).toBe(100);
  });
  it('reachTrendScore is piecewise around ±30%', () => {
    expect(reachTrendScore(-30)).toBe(0);
    expect(reachTrendScore(-15)).toBe(25);
    expect(reachTrendScore(0)).toBe(50);
    expect(reachTrendScore(15)).toBe(75);
    expect(reachTrendScore(45)).toBe(100);
  });
  it('recencyScore decays with days since last post', () => {
    expect(recencyScore(null)).toBe(0);
    expect(recencyScore(2)).toBe(100);
    expect(recencyScore(7)).toBe(70);
    expect(recencyScore(14)).toBe(40);
    expect(recencyScore(21)).toBe(15);
    expect(recencyScore(40)).toBe(0);
  });
});

describe('scoreClient — override states (priority order)', () => {
  it('not connected → desconectado', () => {
    expect(scoreClient({ ...base, connected: false }).status).toBe('desconectado');
  });
  it('revoked → reconectar', () => {
    expect(scoreClient({ ...base, authorizationStatus: 'revoked' }).status).toBe('reconectar');
  });
  it('expired token date → reconectar', () => {
    expect(scoreClient({ ...base, tokenExpiresAt: daysAgoIso(1) }).status).toBe('reconectar');
  });
  it('never synced (null) → sincronizando, not stale', () => {
    expect(scoreClient({ ...base, lastSyncedAt: null }).status).toBe('sincronizando');
  });
  it('synced > 3d ago → sem_sincronizar', () => {
    expect(scoreClient({ ...base, lastSyncedAt: daysAgoIso(5) }).status).toBe('sem_sincronizar');
  });
  it('insufficient history → sem_dados', () => {
    expect(scoreClient({ ...base, hasMinimumData: false }).status).toBe('sem_dados');
  });
  it('dormant + empty pipeline → inativo', () => {
    expect(scoreClient({ ...base, daysSinceLastPost: 30, pipelineActive: false }).status).toBe(
      'inativo',
    );
  });
  it('dormant but pipeline active → scored, not inativo', () => {
    expect(scoreClient({ ...base, daysSinceLastPost: 30, pipelineActive: true }).status).not.toBe(
      'inativo',
    );
  });
});

describe('scoreClient — tiers', () => {
  it('strong signals → em_alta (100)', () => {
    const r = scoreClient({
      ...base,
      followerDeltaPct: 6,
      engagementRate: 5,
      reachTrendPct: 35,
      daysSinceLastPost: 2,
    });
    expect(r.score).toBe(100);
    expect(r.status).toBe('em_alta');
  });
  it('declining signals → em_queda (low score)', () => {
    const r = scoreClient({
      ...base,
      followerDeltaPct: -3,
      engagementRate: 1,
      reachTrendPct: -30,
      daysSinceLastPost: 18,
    });
    expect(r.status).toBe('em_queda');
    expect(r.score).toBeLessThan(20);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run apps/crm/src/lib/health/score.test.ts`
Expected: FAIL — "Failed to resolve import './score'".

- [ ] **Step 3: Write the implementation**

Create `apps/crm/src/lib/health/score.ts`:

```ts
// Pure, deterministic client-health scoring. No I/O. Tuned via the constants below.
// Weights/thresholds are an internal heuristic — there is no authoritative external source.

export type HealthStatus =
  | 'em_alta'
  | 'saudavel'
  | 'estavel'
  | 'atencao'
  | 'em_queda'
  | 'inativo'
  | 'sem_dados'
  | 'sincronizando'
  | 'sem_sincronizar'
  | 'reconectar'
  | 'desconectado';

export interface HealthSignals {
  connected: boolean;
  authorizationStatus: string | null; // 'active' | 'expired' | 'revoked' | null
  tokenExpiresAt: string | null;
  lastSyncedAt: string | null;
  followerDeltaPct: number; // 28d %
  engagementRate: number; // %
  reachTrendPct: number; // current vs prior 28d %
  daysSinceLastPost: number | null;
  hasMinimumData: boolean;
  pipelineActive: boolean; // agendados + em_producao > 0
  nowMs: number; // injected for deterministic token/sync checks
}

export interface HealthResult {
  status: HealthStatus;
  score: number | null;
}

export const HEALTH_WEIGHTS = { growth: 0.35, engagement: 0.3, reachTrend: 0.2, recency: 0.15 };
export const SYNC_STALE_DAYS = 3;
export const INACTIVE_DAYS = 21;
export const ENGAGEMENT_FULL = 5; // engagement rate (%) that scores 100

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

export function growthScore(p: number): number {
  if (p <= -2) return 0;
  if (p < 0) return ((p + 2) / 2) * 50;
  if (p < 5) return 50 + (p / 5) * 50;
  return 100;
}

export function engagementScore(e: number): number {
  return clamp((e / ENGAGEMENT_FULL) * 100, 0, 100);
}

export function reachTrendScore(r: number): number {
  if (r <= -30) return 0;
  if (r < 0) return ((r + 30) / 30) * 50;
  if (r < 30) return 50 + (r / 30) * 50;
  return 100;
}

export function recencyScore(d: number | null): number {
  if (d === null) return 0;
  if (d <= 3) return 100;
  if (d <= 7) return 100 - ((d - 3) / 4) * 30; // 100 → 70
  if (d <= 14) return 70 - ((d - 7) / 7) * 30; // 70 → 40
  if (d <= 21) return 40 - ((d - 14) / 7) * 25; // 40 → 15
  if (d < 28) return 15 - ((d - 21) / 7) * 15; // 15 → 0
  return 0;
}

export function scoreClient(s: HealthSignals): HealthResult {
  if (!s.connected) return { status: 'desconectado', score: null };

  const tokenExpired = s.tokenExpiresAt ? Date.parse(s.tokenExpiresAt) < s.nowMs : false;
  if (s.authorizationStatus === 'revoked' || s.authorizationStatus === 'expired' || tokenExpired) {
    return { status: 'reconectar', score: null };
  }

  if (!s.lastSyncedAt) return { status: 'sincronizando', score: null };

  const daysSinceSync = (s.nowMs - Date.parse(s.lastSyncedAt)) / 86400000;
  if (daysSinceSync > SYNC_STALE_DAYS) return { status: 'sem_sincronizar', score: null };

  if (!s.hasMinimumData) return { status: 'sem_dados', score: null };

  if (s.daysSinceLastPost !== null && s.daysSinceLastPost > INACTIVE_DAYS && !s.pipelineActive) {
    return { status: 'inativo', score: null };
  }

  const score = Math.round(
    HEALTH_WEIGHTS.growth * growthScore(s.followerDeltaPct) +
      HEALTH_WEIGHTS.engagement * engagementScore(s.engagementRate) +
      HEALTH_WEIGHTS.reachTrend * reachTrendScore(s.reachTrendPct) +
      HEALTH_WEIGHTS.recency * recencyScore(s.daysSinceLastPost),
  );

  const status: HealthStatus =
    score >= 80 ? 'em_alta' : score >= 60 ? 'saudavel' : score >= 40 ? 'estavel' : score >= 20 ? 'atencao' : 'em_queda';

  return { status, score };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run apps/crm/src/lib/health/score.test.ts`
Expected: PASS (all cases).

- [ ] **Step 5: Commit**

```bash
git add apps/crm/src/lib/health/score.ts apps/crm/src/lib/health/score.test.ts
git commit -m "feat(dashboard): pure client-health scoring module"
```

---

## Task 2: i18n keys (`dashboard.json`)

**Files:**
- Modify: `packages/i18n/locales/pt/dashboard.json`
- Modify: `packages/i18n/locales/en/dashboard.json`

**Interfaces:**
- Produces: a `health` namespace object consumed by all health components via `t('health.…')`.

- [ ] **Step 1: Add the `health` block to the PT file**

In `packages/i18n/locales/pt/dashboard.json`, add a top-level `"health"` key (sibling of `"title"`, `"cards"`, etc.):

```json
"health": {
  "title": "Saúde dos clientes",
  "subtitle_one": "{{total}} cliente ativo · {{attention}} precisam de atenção",
  "subtitle_other": "{{total}} clientes ativos · {{attention}} precisam de atenção",
  "search": "Buscar cliente…",
  "sortLabel": "Ordenar",
  "sort": {
    "atencao": "Precisam de atenção primeiro",
    "engajamento": "Maior engajamento",
    "ultimo_post": "Último post",
    "seguidores": "Mais seguidores",
    "nome": "Nome (A–Z)"
  },
  "chips": {
    "todos": "Todos",
    "atencao": "Atenção",
    "saudaveis": "Saudáveis",
    "estaveis": "Estáveis",
    "conexao": "Conexão"
  },
  "status": {
    "em_alta": "Em alta",
    "saudavel": "Saudável",
    "estavel": "Estável",
    "atencao": "Atenção",
    "em_queda": "Em queda",
    "inativo": "Inativo",
    "sem_dados": "Sem dados",
    "sincronizando": "Sincronizando",
    "sem_sincronizar": "Sem sincronizar",
    "reconectar": "Reconectar",
    "desconectado": "Desconectado"
  },
  "metric": {
    "seguidores": "Seguidores",
    "engajamento": "Engaj.",
    "alcance": "Alcance",
    "ultimoPost": "Últ. post"
  },
  "pipeline": {
    "agendados": "{{count}} agendados",
    "em_producao": "{{count}} em produção",
    "agente": "{{count}} por agente",
    "falha": "{{count}} falha",
    "parado": "Pipeline parado",
    "sem_atividade": "Sem atividade"
  },
  "lastPost": {
    "days": "há {{count}}d",
    "never": "sem posts",
    "noneDays": "sem post {{count}}d"
  },
  "cta": {
    "analytics": "Analytics",
    "detalhe": "Detalhe",
    "conectar": "Conectar Instagram",
    "reconectar": "Reconectar",
    "sincronizar": "Sincronizar agora"
  },
  "syncStale": "Dados desatualizados há {{count}} dias.",
  "reconectarMsg": "Autorização expirada ou revogada — reconecte para retomar a sincronização.",
  "empty": {
    "noClients": "Nenhum cliente ativo ainda.",
    "noneConnected": "Nenhuma conta do Instagram conectada. Conecte uma conta para ver a saúde dos clientes.",
    "filtered": "Nenhum cliente neste filtro."
  },
  "error": "Não foi possível carregar a saúde dos clientes."
}
```

- [ ] **Step 2: Add the same block (English) to the EN file**

In `packages/i18n/locales/en/dashboard.json`, add the parallel `"health"` key:

```json
"health": {
  "title": "Client health",
  "subtitle_one": "{{total}} active client · {{attention}} need attention",
  "subtitle_other": "{{total}} active clients · {{attention}} need attention",
  "search": "Search client…",
  "sortLabel": "Sort",
  "sort": {
    "atencao": "Needs attention first",
    "engajamento": "Highest engagement",
    "ultimo_post": "Last post",
    "seguidores": "Most followers",
    "nome": "Name (A–Z)"
  },
  "chips": {
    "todos": "All",
    "atencao": "Attention",
    "saudaveis": "Healthy",
    "estaveis": "Stable",
    "conexao": "Connection"
  },
  "status": {
    "em_alta": "Thriving",
    "saudavel": "Healthy",
    "estavel": "Stable",
    "atencao": "Attention",
    "em_queda": "Declining",
    "inativo": "Inactive",
    "sem_dados": "No data",
    "sincronizando": "Syncing",
    "sem_sincronizar": "Out of sync",
    "reconectar": "Reconnect",
    "desconectado": "Disconnected"
  },
  "metric": {
    "seguidores": "Followers",
    "engajamento": "Eng.",
    "alcance": "Reach",
    "ultimoPost": "Last post"
  },
  "pipeline": {
    "agendados": "{{count}} scheduled",
    "em_producao": "{{count}} in production",
    "agente": "{{count}} by agent",
    "falha": "{{count}} failed",
    "parado": "Pipeline idle",
    "sem_atividade": "No activity"
  },
  "lastPost": {
    "days": "{{count}}d ago",
    "never": "no posts",
    "noneDays": "no post {{count}}d"
  },
  "cta": {
    "analytics": "Analytics",
    "detalhe": "Details",
    "conectar": "Connect Instagram",
    "reconectar": "Reconnect",
    "sincronizar": "Sync now"
  },
  "syncStale": "Data {{count}} days stale.",
  "reconectarMsg": "Authorization expired or revoked — reconnect to resume syncing.",
  "empty": {
    "noClients": "No active clients yet.",
    "noneConnected": "No Instagram account connected. Connect one to see client health.",
    "filtered": "No clients in this filter."
  },
  "error": "Could not load client health."
}
```

- [ ] **Step 3: Verify the JSON is valid and typechecks**

Run: `node -e "require('./packages/i18n/locales/pt/dashboard.json'); require('./packages/i18n/locales/en/dashboard.json'); console.log('ok')"`
Expected: prints `ok` (no JSON syntax error).

- [ ] **Step 4: Commit**

```bash
git add packages/i18n/locales/pt/dashboard.json packages/i18n/locales/en/dashboard.json
git commit -m "feat(dashboard): i18n keys for client health monitor"
```

---

## Task 3: Aggregation RPC migration

**Files:**
- Create: `supabase/migrations/20260625130000_client_health_aggregates.sql`

**Interfaces:**
- Produces: SQL function `get_client_health_aggregates(p_window_days int) → setof` with columns consumed by Task 4. Column list (exact names/order): `client_id bigint, client_name text, client_sigla text, client_cor text, connected boolean, username text, profile_picture_url text, follower_count int, authorization_status text, token_expires_at timestamptz, last_synced_at timestamptz, follower_first int, follower_points int, follower_series int[], interactions_cur bigint, reach_cur bigint, posts_cur int, reach_prev bigint, posts_56d int, last_post_at timestamptz, pl_agendados int, pl_em_producao int, pl_agente int, pl_falha int`.

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/20260625130000_client_health_aggregates.sql`:

```sql
-- One row per active client with all health aggregates computed server-side.
-- SECURITY INVOKER so RLS applies; scoped to the caller's workspace via get_my_conta_id().
-- Aggregating per-source in CTEs avoids join fan-out and the PostgREST 1000-row cap
-- that raw client-side reads would hit.
CREATE OR REPLACE FUNCTION get_client_health_aggregates(p_window_days int DEFAULT 28)
RETURNS TABLE (
  client_id bigint,
  client_name text,
  client_sigla text,
  client_cor text,
  connected boolean,
  username text,
  profile_picture_url text,
  follower_count int,
  authorization_status text,
  token_expires_at timestamptz,
  last_synced_at timestamptz,
  follower_first int,
  follower_points int,
  follower_series int[],
  interactions_cur bigint,
  reach_cur bigint,
  posts_cur int,
  reach_prev bigint,
  posts_56d int,
  last_post_at timestamptz,
  pl_agendados int,
  pl_em_producao int,
  pl_agente int,
  pl_falha int
)
LANGUAGE sql
SECURITY INVOKER
SET search_path = public
AS $$
WITH cli AS (
  SELECT c.id, c.nome, c.sigla, c.cor
  FROM clientes c
  WHERE c.status = 'ativo'
    AND c.conta_id IN (SELECT public.get_my_conta_id())
),
acc AS (
  SELECT DISTINCT ON (a.client_id)
    a.id AS account_id, a.client_id, a.username, a.profile_picture_url,
    a.follower_count, a.authorization_status, a.token_expires_at, a.last_synced_at
  FROM instagram_accounts a
  WHERE a.client_id IN (SELECT id FROM cli)
  ORDER BY a.client_id, a.id
),
fh AS (
  SELECT h.instagram_account_id AS account_id,
         (array_agg(h.follower_count ORDER BY h.date))[1] AS follower_first,
         count(*)::int AS follower_points,
         array_agg(h.follower_count ORDER BY h.date)::int[] AS follower_series
  FROM instagram_follower_history h
  WHERE h.instagram_account_id IN (SELECT account_id FROM acc)
    AND h.date >= (current_date - (p_window_days || ' days')::interval)
  GROUP BY h.instagram_account_id
),
pc AS (
  SELECT p.instagram_account_id AS account_id,
         sum(coalesce(p.likes,0)+coalesce(p.comments,0)+coalesce(p.saved,0)+coalesce(p.shares,0))::bigint AS interactions_cur,
         sum(coalesce(p.reach,0))::bigint AS reach_cur,
         count(*)::int AS posts_cur
  FROM instagram_posts p
  WHERE p.instagram_account_id IN (SELECT account_id FROM acc)
    AND p.posted_at >= (now() - (p_window_days || ' days')::interval)
  GROUP BY p.instagram_account_id
),
pp AS (
  SELECT p.instagram_account_id AS account_id,
         sum(coalesce(p.reach,0))::bigint AS reach_prev
  FROM instagram_posts p
  WHERE p.instagram_account_id IN (SELECT account_id FROM acc)
    AND p.posted_at >= (now() - ((2*p_window_days) || ' days')::interval)
    AND p.posted_at <  (now() - (p_window_days || ' days')::interval)
  GROUP BY p.instagram_account_id
),
pall AS (
  SELECT p.instagram_account_id AS account_id,
         max(p.posted_at) AS last_post_at,
         count(*)::int AS posts_56d
  FROM instagram_posts p
  WHERE p.instagram_account_id IN (SELECT account_id FROM acc)
    AND p.posted_at >= (now() - ((2*p_window_days) || ' days')::interval)
  GROUP BY p.instagram_account_id
),
pipe AS (
  SELECT w.cliente_id AS client_id,
         count(*) FILTER (WHERE wp.status = 'agendado')::int AS pl_agendados,
         count(*) FILTER (WHERE wp.status IN ('rascunho','revisao_interna','aprovado_interno','enviado_cliente','aprovado_cliente','correcao_cliente'))::int AS pl_em_producao,
         count(*) FILTER (WHERE wp.created_via = 'agent')::int AS pl_agente,
         count(*) FILTER (WHERE wp.status = 'falha_publicacao')::int AS pl_falha
  FROM workflow_posts wp
  JOIN workflows w ON w.id = wp.workflow_id AND w.status = 'ativo'
  WHERE w.cliente_id IN (SELECT id FROM cli)
  GROUP BY w.cliente_id
)
SELECT
  cli.id::bigint,
  cli.nome,
  cli.sigla,
  cli.cor,
  (acc.account_id IS NOT NULL) AS connected,
  acc.username,
  acc.profile_picture_url,
  coalesce(acc.follower_count, 0)::int,
  acc.authorization_status,
  acc.token_expires_at,
  acc.last_synced_at,
  coalesce(fh.follower_first, 0)::int,
  coalesce(fh.follower_points, 0)::int,
  coalesce(fh.follower_series, ARRAY[]::int[]),
  coalesce(pc.interactions_cur, 0)::bigint,
  coalesce(pc.reach_cur, 0)::bigint,
  coalesce(pc.posts_cur, 0)::int,
  coalesce(pp.reach_prev, 0)::bigint,
  coalesce(pall.posts_56d, 0)::int,
  pall.last_post_at,
  coalesce(pipe.pl_agendados, 0)::int,
  coalesce(pipe.pl_em_producao, 0)::int,
  coalesce(pipe.pl_agente, 0)::int,
  coalesce(pipe.pl_falha, 0)::int
FROM cli
LEFT JOIN acc  ON acc.client_id = cli.id
LEFT JOIN fh   ON fh.account_id = acc.account_id
LEFT JOIN pc   ON pc.account_id = acc.account_id
LEFT JOIN pp   ON pp.account_id = acc.account_id
LEFT JOIN pall ON pall.account_id = acc.account_id
LEFT JOIN pipe ON pipe.client_id = cli.id
ORDER BY cli.nome;
$$;

GRANT EXECUTE ON FUNCTION get_client_health_aggregates(int) TO authenticated;
```

- [ ] **Step 2: Apply to staging and smoke-test the shape**

> Per project memory, `supabase db push --linked` to staging aborts on the orphaned `130000` migration. Apply this single function via the Supabase SQL editor on the **staging** project (`wlyzhyfondykzpsiqsce`), then run:

```sql
select * from get_client_health_aggregates(28) limit 5;
```

Expected: returns up to 5 rows, **one per active client** including clients with no `instagram_accounts` row (`connected = false`, null account columns, zeroed aggregates). Verify column names match the interface list above.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260625130000_client_health_aggregates.sql
git commit -m "feat(dashboard): client health aggregates RPC"
```

---

## Task 4: Client health service (`services/clientHealth.ts`)

**Files:**
- Create: `apps/crm/src/services/clientHealth.ts`
- Test: `apps/crm/src/services/clientHealth.test.ts`

**Interfaces:**
- Consumes: `scoreClient`, `HealthStatus` from `@/lib/health/score`; `supabase` from `@/lib/supabase`.
- Produces:
  - `interface ClientHealth { client_id: number; client_name: string; client_sigla: string; client_cor: string; username: string|null; profile_picture_url: string|null; connected: boolean; follower_count: number; follower_delta: number; follower_delta_pct: number; follower_series: number[]; engagement_rate: number; reach_28d: number; reach_trend_pct: number; days_since_last_post: number|null; pipeline: { agendados: number; em_producao: number; agente: number; falha: number }; authorization_status: string|null; token_expires_at: string|null; last_synced_at: string|null; status: HealthStatus; score: number|null }`
  - `interface ClientHealthSummary { total: number; atencao: number; saudaveis: number; estaveis: number; conexao: number; precisamAtencao: number }`
  - `interface ClientHealthMonitorResult { clients: ClientHealth[]; summary: ClientHealthSummary }`
  - `function getClientHealthMonitor(windowDays?: number): Promise<ClientHealthMonitorResult>`
  - `function downsample(series: number[], max: number): number[]` (exported for reuse by Sparkline tests)

- [ ] **Step 1: Write the failing test**

Create `apps/crm/src/services/clientHealth.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../lib/supabase');

import * as supabaseModule from '../lib/supabase';
import { getClientHealthMonitor, downsample } from './clientHealth';

type Mocked = typeof supabaseModule & {
  __resetSupabaseMock: () => void;
  __queueSupabaseRpc: (name: string, ...r: Array<{ data?: unknown; error?: unknown }>) => void;
};
const mocked = supabaseModule as Mocked;

// A fully-aggregated RPC row with sane defaults; override per test.
const row = (over: Record<string, unknown> = {}) => ({
  client_id: 1,
  client_name: 'Dr. Ana',
  client_sigla: 'DA',
  client_cor: '#7c5cff',
  connected: true,
  username: 'ana',
  profile_picture_url: null,
  follower_count: 1100,
  authorization_status: 'active',
  token_expires_at: new Date(Date.now() + 30 * 86400000).toISOString(),
  last_synced_at: new Date().toISOString(),
  follower_first: 1000,
  follower_points: 5,
  follower_series: [1000, 1020, 1050, 1080, 1100],
  interactions_cur: 400,
  reach_cur: 10000,
  posts_cur: 8,
  reach_prev: 8000,
  posts_56d: 16,
  last_post_at: new Date(Date.now() - 2 * 86400000).toISOString(),
  pl_agendados: 2,
  pl_em_producao: 1,
  pl_agente: 1,
  pl_falha: 0,
  ...over,
});

beforeEach(() => mocked.__resetSupabaseMock());

describe('downsample', () => {
  it('returns the series unchanged when short enough', () => {
    expect(downsample([1, 2, 3], 12)).toEqual([1, 2, 3]);
  });
  it('reduces a long series to at most max points, keeping first and last', () => {
    const out = downsample(Array.from({ length: 100 }, (_, i) => i), 12);
    expect(out.length).toBeLessThanOrEqual(12);
    expect(out[0]).toBe(0);
    expect(out[out.length - 1]).toBe(99);
  });
});

describe('getClientHealthMonitor', () => {
  it('maps an aggregate row into derived metrics + status', async () => {
    mocked.__queueSupabaseRpc('get_client_health_aggregates', { data: [row()], error: null });
    const res = await getClientHealthMonitor();
    const c = res.clients[0];
    expect(c.follower_delta).toBe(100); // 1100 - 1000 (absolute)
    expect(c.follower_delta_pct).toBeCloseTo(10); // 100 / 1000 * 100
    expect(c.engagement_rate).toBeCloseTo(4); // 400 / 10000 * 100
    expect(c.reach_trend_pct).toBeCloseTo(25); // (10000-8000)/8000*100
    expect(c.days_since_last_post).toBe(2);
    expect(c.score).not.toBeNull();
  });

  it('includes disconnected clients (not dropped)', async () => {
    mocked.__queueSupabaseRpc('get_client_health_aggregates', {
      data: [row({ client_id: 9, connected: false, username: null, last_synced_at: null, follower_first: 0, follower_points: 0, posts_56d: 0 })],
      error: null,
    });
    const res = await getClientHealthMonitor();
    expect(res.clients).toHaveLength(1);
    expect(res.clients[0].status).toBe('desconectado');
    expect(res.summary.conexao).toBe(1);
  });

  it('flags revoked auth as reconectar', async () => {
    mocked.__queueSupabaseRpc('get_client_health_aggregates', {
      data: [row({ authorization_status: 'revoked' })],
      error: null,
    });
    const res = await getClientHealthMonitor();
    expect(res.clients[0].status).toBe('reconectar');
  });

  it('treats null last_synced_at as sincronizando, not stale', async () => {
    mocked.__queueSupabaseRpc('get_client_health_aggregates', {
      data: [row({ last_synced_at: null })],
      error: null,
    });
    const res = await getClientHealthMonitor();
    expect(res.clients[0].status).toBe('sincronizando');
  });

  it('null last_post_at → days_since_last_post null and sem_dados when no history', async () => {
    mocked.__queueSupabaseRpc('get_client_health_aggregates', {
      data: [row({ last_post_at: null, posts_56d: 0, follower_points: 1 })],
      error: null,
    });
    const res = await getClientHealthMonitor();
    expect(res.clients[0].days_since_last_post).toBeNull();
    expect(res.clients[0].status).toBe('sem_dados');
  });

  it('builds summary buckets from statuses', async () => {
    mocked.__queueSupabaseRpc('get_client_health_aggregates', {
      data: [
        row({ client_id: 1 }), // healthy/em_alta-ish → saudaveis bucket region
        row({ client_id: 2, connected: false }), // conexao
        row({ client_id: 3, last_post_at: new Date(Date.now() - 40 * 86400000).toISOString(), pl_agendados: 0, pl_em_producao: 0 }), // inativo → atencao
      ],
      error: null,
    });
    const res = await getClientHealthMonitor();
    expect(res.summary.total).toBe(3);
    expect(res.summary.conexao).toBeGreaterThanOrEqual(1);
    expect(res.summary.atencao).toBeGreaterThanOrEqual(1);
  });

  it('returns empty result on RPC error without throwing', async () => {
    mocked.__queueSupabaseRpc('get_client_health_aggregates', { data: null, error: { message: 'boom' } });
    const res = await getClientHealthMonitor();
    expect(res.clients).toEqual([]);
    expect(res.summary.total).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run apps/crm/src/services/clientHealth.test.ts`
Expected: FAIL — "Failed to resolve import './clientHealth'".

- [ ] **Step 3: Write the implementation**

Create `apps/crm/src/services/clientHealth.ts`:

```ts
// Client health monitor data service. Calls the get_client_health_aggregates RPC
// (server-side aggregation) and maps each row through the pure scorer.
import { supabase } from '../lib/supabase';
import { scoreClient, type HealthStatus } from '../lib/health/score';

export interface ClientHealth {
  client_id: number;
  client_name: string;
  client_sigla: string;
  client_cor: string;
  username: string | null;
  profile_picture_url: string | null;
  connected: boolean;
  follower_count: number;
  follower_delta: number; // absolute
  follower_delta_pct: number; // percent (drives scoring)
  follower_series: number[];
  engagement_rate: number; // %
  reach_28d: number;
  reach_trend_pct: number;
  days_since_last_post: number | null;
  pipeline: { agendados: number; em_producao: number; agente: number; falha: number };
  authorization_status: string | null;
  token_expires_at: string | null;
  last_synced_at: string | null;
  status: HealthStatus;
  score: number | null;
}

export interface ClientHealthSummary {
  total: number;
  atencao: number;
  saudaveis: number;
  estaveis: number;
  conexao: number;
  precisamAtencao: number;
}

export interface ClientHealthMonitorResult {
  clients: ClientHealth[];
  summary: ClientHealthSummary;
}

interface AggRow {
  client_id: number;
  client_name: string;
  client_sigla: string;
  client_cor: string;
  connected: boolean;
  username: string | null;
  profile_picture_url: string | null;
  follower_count: number;
  authorization_status: string | null;
  token_expires_at: string | null;
  last_synced_at: string | null;
  follower_first: number;
  follower_points: number;
  follower_series: number[];
  interactions_cur: number;
  reach_cur: number;
  posts_cur: number;
  reach_prev: number;
  posts_56d: number;
  last_post_at: string | null;
  pl_agendados: number;
  pl_em_producao: number;
  pl_agente: number;
  pl_falha: number;
}

const EMPTY_SUMMARY: ClientHealthSummary = {
  total: 0,
  atencao: 0,
  saudaveis: 0,
  estaveis: 0,
  conexao: 0,
  precisamAtencao: 0,
};

export function downsample(series: number[], max: number): number[] {
  if (series.length <= max) return series;
  const out: number[] = [];
  const step = (series.length - 1) / (max - 1);
  for (let i = 0; i < max; i++) out.push(series[Math.round(i * step)]);
  return out;
}

function mapRow(r: AggRow, nowMs: number): ClientHealth {
  const follower_delta = r.follower_points >= 2 ? r.follower_count - r.follower_first : 0;
  const follower_delta_pct =
    r.follower_first > 0 ? (follower_delta / r.follower_first) * 100 : follower_delta > 0 ? 100 : 0;
  const engagement_rate = r.reach_cur > 0 ? (r.interactions_cur / r.reach_cur) * 100 : 0;
  const reach_trend_pct =
    r.reach_prev > 0
      ? ((r.reach_cur - r.reach_prev) / r.reach_prev) * 100
      : r.reach_cur > 0
        ? 100
        : 0;
  const days_since_last_post = r.last_post_at
    ? Math.floor((nowMs - Date.parse(r.last_post_at)) / 86400000)
    : null;
  const hasMinimumData = r.posts_56d > 0 || r.follower_points >= 2;
  const pipelineActive = r.pl_agendados + r.pl_em_producao > 0;

  const { status, score } = scoreClient({
    connected: r.connected,
    authorizationStatus: r.authorization_status,
    tokenExpiresAt: r.token_expires_at,
    lastSyncedAt: r.last_synced_at,
    followerDeltaPct: follower_delta_pct,
    engagementRate: engagement_rate,
    reachTrendPct: reach_trend_pct,
    daysSinceLastPost: days_since_last_post,
    hasMinimumData,
    pipelineActive,
    nowMs,
  });

  return {
    client_id: r.client_id,
    client_name: r.client_name,
    client_sigla: r.client_sigla,
    client_cor: r.client_cor,
    username: r.username,
    profile_picture_url: r.profile_picture_url,
    connected: r.connected,
    follower_count: r.follower_count,
    follower_delta,
    follower_delta_pct,
    follower_series: downsample(r.follower_series ?? [], 12),
    engagement_rate: Math.round(engagement_rate * 100) / 100,
    reach_28d: r.reach_cur,
    reach_trend_pct: Math.round(reach_trend_pct * 10) / 10,
    days_since_last_post,
    pipeline: {
      agendados: r.pl_agendados,
      em_producao: r.pl_em_producao,
      agente: r.pl_agente,
      falha: r.pl_falha,
    },
    authorization_status: r.authorization_status,
    token_expires_at: r.token_expires_at,
    last_synced_at: r.last_synced_at,
    status,
    score,
  };
}

const ATENCAO: HealthStatus[] = ['em_queda', 'atencao', 'inativo'];
const SAUDAVEIS: HealthStatus[] = ['em_alta', 'saudavel'];
const CONEXAO: HealthStatus[] = ['desconectado', 'reconectar', 'sem_sincronizar', 'sincronizando', 'sem_dados'];
const PRECISAM: HealthStatus[] = ['em_queda', 'inativo', 'reconectar', 'sem_sincronizar', 'desconectado'];

function summarize(clients: ClientHealth[]): ClientHealthSummary {
  const has = (set: HealthStatus[], s: HealthStatus) => set.includes(s);
  return {
    total: clients.length,
    atencao: clients.filter((c) => has(ATENCAO, c.status)).length,
    saudaveis: clients.filter((c) => has(SAUDAVEIS, c.status)).length,
    estaveis: clients.filter((c) => c.status === 'estavel').length,
    conexao: clients.filter((c) => has(CONEXAO, c.status)).length,
    precisamAtencao: clients.filter((c) => has(PRECISAM, c.status)).length,
  };
}

export async function getClientHealthMonitor(windowDays = 28): Promise<ClientHealthMonitorResult> {
  const { data, error } = await supabase.rpc('get_client_health_aggregates', {
    p_window_days: windowDays,
  });
  if (error || !data) {
    if (error) console.error('[clientHealth] RPC error', error.message);
    return { clients: [], summary: { ...EMPTY_SUMMARY } };
  }
  const nowMs = Date.now();
  const clients = (data as AggRow[]).map((r) => mapRow(r, nowMs));
  return { clients, summary: summarize(clients) };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run apps/crm/src/services/clientHealth.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/crm/src/services/clientHealth.ts apps/crm/src/services/clientHealth.test.ts
git commit -m "feat(dashboard): client health service over aggregates RPC"
```

---

## Task 5: Filter/sort util (`lib/health/filter.ts`)

**Files:**
- Create: `apps/crm/src/lib/health/filter.ts`
- Test: `apps/crm/src/lib/health/filter.test.ts`

**Interfaces:**
- Consumes: `ClientHealth` from `@/services/clientHealth`; `HealthStatus` from `@/lib/health/score`.
- Produces:
  - `type HealthFilterKey = 'todos'|'atencao'|'saudaveis'|'estaveis'|'conexao'`
  - `type HealthSort = 'atencao'|'engajamento'|'ultimo_post'|'seguidores'|'nome'`
  - `function matchesFilter(status: HealthStatus, key: HealthFilterKey): boolean`
  - `function filterAndSortClients(clients: ClientHealth[], opts: { filter: HealthFilterKey; search: string; sort: HealthSort }): ClientHealth[]`

- [ ] **Step 1: Write the failing test**

Create `apps/crm/src/lib/health/filter.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { filterAndSortClients, matchesFilter } from './filter';
import type { ClientHealth } from '../../services/clientHealth';

const mk = (over: Partial<ClientHealth>): ClientHealth =>
  ({
    client_id: 1,
    client_name: 'X',
    client_sigla: 'X',
    client_cor: '#000',
    username: 'x',
    profile_picture_url: null,
    connected: true,
    follower_count: 0,
    follower_delta: 0,
    follower_delta_pct: 0,
    follower_series: [],
    engagement_rate: 0,
    reach_28d: 0,
    reach_trend_pct: 0,
    days_since_last_post: 0,
    pipeline: { agendados: 0, em_producao: 0, agente: 0, falha: 0 },
    authorization_status: 'active',
    token_expires_at: null,
    last_synced_at: null,
    status: 'estavel',
    score: 50,
    ...over,
  }) as ClientHealth;

describe('matchesFilter', () => {
  it('atencao groups em_queda/atencao/inativo', () => {
    expect(matchesFilter('em_queda', 'atencao')).toBe(true);
    expect(matchesFilter('inativo', 'atencao')).toBe(true);
    expect(matchesFilter('saudavel', 'atencao')).toBe(false);
  });
  it('conexao groups connection states', () => {
    expect(matchesFilter('reconectar', 'conexao')).toBe(true);
    expect(matchesFilter('desconectado', 'conexao')).toBe(true);
    expect(matchesFilter('em_alta', 'conexao')).toBe(false);
  });
  it('todos matches everything', () => {
    expect(matchesFilter('desconectado', 'todos')).toBe(true);
  });
});

describe('filterAndSortClients', () => {
  const list = [
    mk({ client_id: 1, client_name: 'Bravo', status: 'saudavel', score: 70, engagement_rate: 2, follower_count: 100, days_since_last_post: 1 }),
    mk({ client_id: 2, client_name: 'Alpha', status: 'em_queda', score: 10, engagement_rate: 5, follower_count: 300, days_since_last_post: 20 }),
    mk({ client_id: 3, client_name: 'Charlie', status: 'reconectar', score: null, engagement_rate: 0, follower_count: 50, days_since_last_post: 5 }),
  ];

  it('search matches name and @username', () => {
    expect(filterAndSortClients(list, { filter: 'todos', search: 'alph', sort: 'nome' })).toHaveLength(1);
  });

  it('filter narrows to a status group', () => {
    const r = filterAndSortClients(list, { filter: 'atencao', search: '', sort: 'nome' });
    expect(r.map((c) => c.client_id)).toEqual([2]);
  });

  it('default sort (atencao) puts override states and low scores first', () => {
    const r = filterAndSortClients(list, { filter: 'todos', search: '', sort: 'atencao' });
    // reconectar (override, actionable) and em_queda (low score) before saudavel
    expect(r[r.length - 1].client_id).toBe(1); // saudavel last
  });

  it('sort by seguidores is descending', () => {
    const r = filterAndSortClients(list, { filter: 'todos', search: '', sort: 'seguidores' });
    expect(r.map((c) => c.follower_count)).toEqual([300, 100, 50]);
  });

  it('sort by nome is A–Z', () => {
    const r = filterAndSortClients(list, { filter: 'todos', search: '', sort: 'nome' });
    expect(r.map((c) => c.client_name)).toEqual(['Alpha', 'Bravo', 'Charlie']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run apps/crm/src/lib/health/filter.test.ts`
Expected: FAIL — cannot resolve `./filter`.

- [ ] **Step 3: Write the implementation**

Create `apps/crm/src/lib/health/filter.ts`:

```ts
import type { ClientHealth } from '../../services/clientHealth';
import type { HealthStatus } from './score';

export type HealthFilterKey = 'todos' | 'atencao' | 'saudaveis' | 'estaveis' | 'conexao';
export type HealthSort = 'atencao' | 'engajamento' | 'ultimo_post' | 'seguidores' | 'nome';

const GROUPS: Record<Exclude<HealthFilterKey, 'todos'>, HealthStatus[]> = {
  atencao: ['em_queda', 'atencao', 'inativo'],
  saudaveis: ['em_alta', 'saudavel'],
  estaveis: ['estavel'],
  conexao: ['desconectado', 'reconectar', 'sem_sincronizar', 'sincronizando', 'sem_dados'],
};

// Actionable override states sort to the very top under the default sort.
const ATTENTION_OVERRIDES: HealthStatus[] = ['reconectar', 'sem_sincronizar', 'desconectado', 'inativo'];
// Transient/neutral states sort after the scored tiers.
const NEUTRAL_OVERRIDES: HealthStatus[] = ['sincronizando', 'sem_dados'];

export function matchesFilter(status: HealthStatus, key: HealthFilterKey): boolean {
  if (key === 'todos') return true;
  return GROUPS[key].includes(status);
}

// Lower = more urgent (sorts first) for the default "precisam de atenção" order.
function attentionRank(c: ClientHealth): number {
  if (ATTENTION_OVERRIDES.includes(c.status)) return -1; // most urgent
  if (NEUTRAL_OVERRIDES.includes(c.status)) return 200; // least urgent
  return c.score ?? 100; // scored tiers: lower score first
}

export function filterAndSortClients(
  clients: ClientHealth[],
  opts: { filter: HealthFilterKey; search: string; sort: HealthSort },
): ClientHealth[] {
  const q = opts.search.trim().toLowerCase();
  const filtered = clients.filter((c) => {
    if (!matchesFilter(c.status, opts.filter)) return false;
    if (!q) return true;
    return (
      c.client_name.toLowerCase().includes(q) || (c.username ?? '').toLowerCase().includes(q)
    );
  });

  const byName = (a: ClientHealth, b: ClientHealth) =>
    a.client_name.localeCompare(b.client_name, 'pt-BR');

  const sorted = [...filtered];
  switch (opts.sort) {
    case 'atencao':
      sorted.sort((a, b) => attentionRank(a) - attentionRank(b) || byName(a, b));
      break;
    case 'engajamento':
      sorted.sort((a, b) => b.engagement_rate - a.engagement_rate || byName(a, b));
      break;
    case 'ultimo_post':
      // most stale first; nulls (no posts) treated as most stale
      sorted.sort(
        (a, b) => (b.days_since_last_post ?? Infinity) - (a.days_since_last_post ?? Infinity) || byName(a, b),
      );
      break;
    case 'seguidores':
      sorted.sort((a, b) => b.follower_count - a.follower_count || byName(a, b));
      break;
    case 'nome':
      sorted.sort(byName);
      break;
  }
  return sorted;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run apps/crm/src/lib/health/filter.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/crm/src/lib/health/filter.ts apps/crm/src/lib/health/filter.test.ts
git commit -m "feat(dashboard): pure filter/sort util for health monitor"
```

---

## Task 6: Sparkline component

**Files:**
- Create: `apps/crm/src/pages/dashboard/components/Sparkline.tsx`
- Test: `apps/crm/src/pages/dashboard/components/__tests__/Sparkline.test.tsx`

**Interfaces:**
- Produces: `function Sparkline(props: { values: number[]; width?: number; height?: number }): JSX.Element` — renders an SVG `<polyline>`; stroke color green when last ≥ first, red when last < first, gray when flat/insufficient. Renders nothing meaningful (empty `<svg>`) when fewer than 2 points.

- [ ] **Step 1: Write the failing test**

Create `apps/crm/src/pages/dashboard/components/__tests__/Sparkline.test.tsx`:

```tsx
import { render } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { Sparkline } from '../Sparkline';

describe('Sparkline', () => {
  it('renders a polyline for >= 2 points', () => {
    const { container } = render(<Sparkline values={[1, 2, 3]} />);
    expect(container.querySelector('polyline')).toBeTruthy();
  });

  it('uses an up color when trending up', () => {
    const { container } = render(<Sparkline values={[1, 5]} />);
    const stroke = container.querySelector('polyline')?.getAttribute('stroke');
    expect(stroke).toBe('var(--success)');
  });

  it('uses a down color when trending down', () => {
    const { container } = render(<Sparkline values={[5, 1]} />);
    expect(container.querySelector('polyline')?.getAttribute('stroke')).toBe('var(--danger)');
  });

  it('renders no polyline for < 2 points', () => {
    const { container } = render(<Sparkline values={[1]} />);
    expect(container.querySelector('polyline')).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run apps/crm/src/pages/dashboard/components/__tests__/Sparkline.test.tsx`
Expected: FAIL — cannot resolve `../Sparkline`.

- [ ] **Step 3: Write the implementation**

Create `apps/crm/src/pages/dashboard/components/Sparkline.tsx`:

```tsx
interface SparklineProps {
  values: number[];
  width?: number;
  height?: number;
}

export function Sparkline({ values, width = 72, height = 24 }: SparklineProps) {
  if (values.length < 2) return <svg width={width} height={height} aria-hidden="true" />;

  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const stepX = width / (values.length - 1);
  const points = values
    .map((v, i) => `${(i * stepX).toFixed(1)},${(height - ((v - min) / span) * height).toFixed(1)}`)
    .join(' ');

  const first = values[0];
  const last = values[values.length - 1];
  const stroke =
    last > first ? 'var(--success)' : last < first ? 'var(--danger)' : 'var(--text-muted)';

  return (
    <svg width={width} height={height} aria-hidden="true" style={{ overflow: 'visible' }}>
      <polyline points={points} fill="none" stroke={stroke} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run apps/crm/src/pages/dashboard/components/__tests__/Sparkline.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/crm/src/pages/dashboard/components/Sparkline.tsx apps/crm/src/pages/dashboard/components/__tests__/Sparkline.test.tsx
git commit -m "feat(dashboard): Sparkline component"
```

---

## Task 7: PipelineRow component

**Files:**
- Create: `apps/crm/src/pages/dashboard/components/PipelineRow.tsx`
- Test: `apps/crm/src/pages/dashboard/components/__tests__/PipelineRow.test.tsx`

**Interfaces:**
- Consumes: `ClientHealth['pipeline']` shape `{ agendados; em_producao; agente; falha }`.
- Produces: `function PipelineRow(props: { pipeline: { agendados: number; em_producao: number; agente: number; falha: number } }): JSX.Element` — shows "Pipeline parado" when agendados+em_producao = 0; otherwise lists counts; always appends the agent and falha indicators when > 0. Uses `useTranslation('dashboard')`.

- [ ] **Step 1: Write the failing test**

Create `apps/crm/src/pages/dashboard/components/__tests__/PipelineRow.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { PipelineRow } from '../PipelineRow';

describe('PipelineRow', () => {
  it('shows scheduled and production counts', () => {
    render(<PipelineRow pipeline={{ agendados: 2, em_producao: 1, agente: 0, falha: 0 }} />);
    expect(screen.getByText(/2 agendados/)).toBeTruthy();
    expect(screen.getByText(/1 em produção/)).toBeTruthy();
  });

  it('shows "Pipeline parado" when nothing queued or in production', () => {
    render(<PipelineRow pipeline={{ agendados: 0, em_producao: 0, agente: 0, falha: 0 }} />);
    expect(screen.getByText(/Pipeline parado/)).toBeTruthy();
  });

  it('shows the agent indicator when agent posts exist', () => {
    render(<PipelineRow pipeline={{ agendados: 1, em_producao: 0, agente: 1, falha: 0 }} />);
    expect(screen.getByText(/1 por agente/)).toBeTruthy();
  });

  it('shows the falha flag when failures exist', () => {
    render(<PipelineRow pipeline={{ agendados: 0, em_producao: 0, agente: 0, falha: 2 }} />);
    expect(screen.getByText(/2 falha/)).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run apps/crm/src/pages/dashboard/components/__tests__/PipelineRow.test.tsx`
Expected: FAIL — cannot resolve `../PipelineRow`.

- [ ] **Step 3: Write the implementation**

Create `apps/crm/src/pages/dashboard/components/PipelineRow.tsx`:

```tsx
import { useTranslation } from 'react-i18next';

interface PipelineRowProps {
  pipeline: { agendados: number; em_producao: number; agente: number; falha: number };
}

export function PipelineRow({ pipeline }: PipelineRowProps) {
  const { t } = useTranslation('dashboard');
  const { agendados, em_producao, agente, falha } = pipeline;
  const parts: string[] = [];

  if (agendados + em_producao === 0) {
    parts.push(t('health.pipeline.parado'));
  } else {
    if (agendados > 0) parts.push(t('health.pipeline.agendados', { count: agendados }));
    if (em_producao > 0) parts.push(t('health.pipeline.em_producao', { count: em_producao }));
  }
  if (agente > 0) parts.push('🤖 ' + t('health.pipeline.agente', { count: agente }));
  if (falha > 0) parts.push('⚠ ' + t('health.pipeline.falha', { count: falha }));

  return (
    <div
      style={{
        fontSize: '0.72rem',
        color: 'var(--text-muted)',
        background: 'var(--surface-hover)',
        borderRadius: 8,
        padding: '5px 9px',
        marginTop: 8,
      }}
    >
      {parts.join(' · ')}
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run apps/crm/src/pages/dashboard/components/__tests__/PipelineRow.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/crm/src/pages/dashboard/components/PipelineRow.tsx apps/crm/src/pages/dashboard/components/__tests__/PipelineRow.test.tsx
git commit -m "feat(dashboard): PipelineRow component"
```

---

## Task 8: ClientHealthCard component

**Files:**
- Create: `apps/crm/src/pages/dashboard/components/ClientHealthCard.tsx`
- Test: `apps/crm/src/pages/dashboard/components/__tests__/ClientHealthCard.test.tsx`

**Interfaces:**
- Consumes: `ClientHealth` from `@/services/clientHealth`; `Sparkline`, `PipelineRow`; `getInstagramAuthUrl`, `syncInstagramData` from `@/services/instagram`; `Link` from `react-router-dom`; `useTranslation`.
- Produces: `function ClientHealthCard(props: { client: ClientHealth }): JSX.Element`. Renders status badge (`t('health.status.<status>')`), metrics, Sparkline, PipelineRow, and links: "Analytics" → `/analytics/:id`, "Detalhe" → `/clientes/:id`. For `desconectado` → "Conectar Instagram"; `reconectar` → "Reconectar"; `sem_sincronizar` → "Sincronizar agora".

**Notes:** Card must render inside a router in tests (`MemoryRouter`). Mock `@/services/instagram` so CTA clicks don't hit the network.

- [ ] **Step 1: Write the failing test**

Create `apps/crm/src/pages/dashboard/components/__tests__/ClientHealthCard.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, it, expect, vi } from 'vitest';
import { ClientHealthCard } from '../ClientHealthCard';
import type { ClientHealth } from '../../../../services/clientHealth';

vi.mock('../../../../services/instagram', () => ({
  getInstagramAuthUrl: vi.fn().mockResolvedValue('https://x'),
  syncInstagramData: vi.fn().mockResolvedValue(undefined),
}));

const mk = (over: Partial<ClientHealth>): ClientHealth =>
  ({
    client_id: 7,
    client_name: 'Dr. Ana Costa',
    client_sigla: 'AC',
    client_cor: '#7c5cff',
    username: 'anacosta',
    profile_picture_url: null,
    connected: true,
    follower_count: 12400,
    follower_delta: 312,
    follower_delta_pct: 2.6,
    follower_series: [12000, 12100, 12400],
    engagement_rate: 4.2,
    reach_28d: 38000,
    reach_trend_pct: 10,
    days_since_last_post: 2,
    pipeline: { agendados: 2, em_producao: 1, agente: 1, falha: 0 },
    authorization_status: 'active',
    token_expires_at: null,
    last_synced_at: new Date().toISOString(),
    status: 'saudavel',
    score: 70,
    ...over,
  }) as ClientHealth;

const renderCard = (c: ClientHealth) =>
  render(
    <MemoryRouter>
      <ClientHealthCard client={c} />
    </MemoryRouter>,
  );

describe('ClientHealthCard', () => {
  it('renders name, handle and status badge', () => {
    renderCard(mk({}));
    expect(screen.getByText('Dr. Ana Costa')).toBeTruthy();
    expect(screen.getByText('@anacosta')).toBeTruthy();
    expect(screen.getByText('Saudável')).toBeTruthy();
  });

  it('links to analytics and detail pages', () => {
    renderCard(mk({}));
    const hrefs = Array.from(document.querySelectorAll('a')).map((a) => a.getAttribute('href'));
    expect(hrefs).toContain('/analytics/7');
    expect(hrefs).toContain('/clientes/7');
  });

  it('shows the reconnect CTA for a reconectar client', () => {
    renderCard(mk({ status: 'reconectar', score: null }));
    expect(screen.getByText('Reconectar')).toBeTruthy();
  });

  it('shows the connect CTA for a disconnected client', () => {
    renderCard(mk({ status: 'desconectado', score: null, connected: false, username: null }));
    expect(screen.getByText('Conectar Instagram')).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run apps/crm/src/pages/dashboard/components/__tests__/ClientHealthCard.test.tsx`
Expected: FAIL — cannot resolve `../ClientHealthCard`.

- [ ] **Step 3: Write the implementation**

Create `apps/crm/src/pages/dashboard/components/ClientHealthCard.tsx`:

```tsx
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import type { ClientHealth } from '../../../services/clientHealth';
import type { HealthStatus } from '../../../lib/health/score';
import { getInstagramAuthUrl, syncInstagramData } from '../../../services/instagram';
import { Sparkline } from './Sparkline';
import { PipelineRow } from './PipelineRow';

// status → badge background/text tone (uses project CSS vars)
const TONE: Record<HealthStatus, { bg: string; fg: string }> = {
  em_alta: { bg: '#dff7ea', fg: '#0f7a4d' },
  saudavel: { bg: '#e9f9f1', fg: '#1a8f5e' },
  estavel: { bg: '#eef1f5', fg: '#5b6472' },
  atencao: { bg: '#fef4e6', fg: '#b9791f' },
  em_queda: { bg: '#fdecea', fg: '#c43c28' },
  inativo: { bg: '#eef1f5', fg: '#5b6472' },
  sem_dados: { bg: '#eef1f5', fg: '#5b6472' },
  sincronizando: { bg: '#eef1f5', fg: '#5b6472' },
  sem_sincronizar: { bg: '#eef0ff', fg: '#5b5bd6' },
  reconectar: { bg: '#fdecea', fg: '#c43c28' },
  desconectado: { bg: '#f1f3f6', fg: '#9aa0ab' },
};

const nfmt = (n: number, locale: string) => n.toLocaleString(locale);

export function ClientHealthCard({ client: c }: { client: ClientHealth }) {
  const { t, i18n } = useTranslation('dashboard');
  const locale = i18n.language === 'en' ? 'en-US' : 'pt-BR';
  const [busy, setBusy] = useState(false);
  const tone = TONE[c.status];

  const lastPostLabel =
    c.days_since_last_post === null
      ? t('health.lastPost.never')
      : t('health.lastPost.days', { count: c.days_since_last_post });

  async function handleConnect() {
    setBusy(true);
    try {
      const url = await getInstagramAuthUrl(c.client_id);
      window.location.href = url;
    } catch {
      toast.error(t('health.error'));
      setBusy(false);
    }
  }

  async function handleSync() {
    setBusy(true);
    try {
      await syncInstagramData(c.client_id);
      toast.success(t('health.cta.sincronizar'));
    } catch {
      toast.error(t('health.error'));
    } finally {
      setBusy(false);
    }
  }

  const isConnectState = c.status === 'desconectado';
  const isReconnectState = c.status === 'reconectar';
  const isStaleState = c.status === 'sem_sincronizar';
  const showMetrics = !isConnectState && !isReconnectState;

  return (
    <div className="card" style={{ padding: '13px 15px', borderRadius: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
          {c.profile_picture_url ? (
            <img
              src={c.profile_picture_url}
              alt=""
              style={{ width: 32, height: 32, borderRadius: '50%', objectFit: 'cover' }}
            />
          ) : (
            <span
              className="avatar"
              style={{ width: 32, height: 32, fontSize: '0.7rem', background: c.client_cor }}
            >
              {c.client_sigla}
            </span>
          )}
          <div>
            <div style={{ fontWeight: 700, fontSize: '0.82rem' }}>{c.client_name}</div>
            {c.username && (
              <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>@{c.username}</div>
            )}
          </div>
        </div>
        <span
          style={{
            fontSize: '0.6rem',
            fontWeight: 700,
            letterSpacing: '0.5px',
            textTransform: 'uppercase',
            padding: '2px 7px',
            borderRadius: 3,
            background: tone.bg,
            color: tone.fg,
          }}
        >
          {t(`health.status.${c.status}`)}
        </span>
      </div>

      {showMetrics ? (
        <>
          <div
            style={{
              display: 'flex',
              alignItems: 'flex-end',
              justifyContent: 'space-between',
              marginTop: 10,
            }}
          >
            <div style={{ display: 'flex', gap: 14, fontSize: '0.78rem' }}>
              <Metric label={t('health.metric.seguidores')}>
                {nfmt(c.follower_count, locale)}{' '}
                {c.follower_delta !== 0 && (
                  <span style={{ color: c.follower_delta > 0 ? 'var(--success)' : 'var(--danger)', fontWeight: 700 }}>
                    {c.follower_delta > 0 ? '▲' : '▼'}
                    {Math.abs(c.follower_delta)}
                  </span>
                )}
              </Metric>
              <Metric label={t('health.metric.engajamento')}>{c.engagement_rate}%</Metric>
              <Metric label={t('health.metric.alcance')}>{nfmt(c.reach_28d, locale)}</Metric>
            </div>
            <Sparkline values={c.follower_series} />
          </div>
          <PipelineRow pipeline={c.pipeline} />
          <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: 6 }}>
            {t('health.metric.ultimoPost')}: {lastPostLabel}
          </div>
        </>
      ) : (
        <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: 10 }}>
          {isReconnectState ? t('health.reconectarMsg') : t('health.empty.noneConnected')}
        </div>
      )}

      <div style={{ display: 'flex', gap: 6, marginTop: 11, flexWrap: 'wrap' }}>
        {isConnectState && (
          <button className="btn-primary" disabled={busy} onClick={handleConnect} style={btnStyle}>
            {t('health.cta.conectar')}
          </button>
        )}
        {isReconnectState && (
          <button className="btn-primary" disabled={busy} onClick={handleConnect} style={btnStyle}>
            {t('health.cta.reconectar')}
          </button>
        )}
        {isStaleState && (
          <button className="btn-secondary" disabled={busy} onClick={handleSync} style={btnStyle}>
            {t('health.cta.sincronizar')}
          </button>
        )}
        <Link to={`/analytics/${c.client_id}`} className="btn-primary" style={btnStyle}>
          {t('health.cta.analytics')}
        </Link>
        <Link to={`/clientes/${c.client_id}`} className="btn-secondary" style={btnStyle}>
          {t('health.cta.detalhe')}
        </Link>
      </div>
    </div>
  );
}

const btnStyle: React.CSSProperties = {
  fontSize: '0.7rem',
  padding: '4px 10px',
  borderRadius: 8,
  textDecoration: 'none',
};

function Metric({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <span>
      <span
        style={{
          display: 'block',
          fontSize: '0.6rem',
          textTransform: 'uppercase',
          letterSpacing: '0.3px',
          color: 'var(--text-muted)',
        }}
      >
        {label}
      </span>
      {children}
    </span>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run apps/crm/src/pages/dashboard/components/__tests__/ClientHealthCard.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/crm/src/pages/dashboard/components/ClientHealthCard.tsx apps/crm/src/pages/dashboard/components/__tests__/ClientHealthCard.test.tsx
git commit -m "feat(dashboard): ClientHealthCard component"
```

---

## Task 9: HealthFilterBar component

**Files:**
- Create: `apps/crm/src/pages/dashboard/components/HealthFilterBar.tsx`
- Test: `apps/crm/src/pages/dashboard/components/__tests__/HealthFilterBar.test.tsx`

**Interfaces:**
- Consumes: `ClientHealthSummary` from `@/services/clientHealth`; `HealthFilterKey`, `HealthSort` from `@/lib/health/filter`.
- Produces: `function HealthFilterBar(props: { summary: ClientHealthSummary; filter: HealthFilterKey; onFilter: (k: HealthFilterKey) => void; search: string; onSearch: (s: string) => void; sort: HealthSort; onSort: (s: HealthSort) => void }): JSX.Element`. Renders chips (Todos/Atenção/Saudáveis/Estáveis/Conexão with counts), a search input, and a sort `<select>`.

- [ ] **Step 1: Write the failing test**

Create `apps/crm/src/pages/dashboard/components/__tests__/HealthFilterBar.test.tsx`:

```tsx
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { HealthFilterBar } from '../HealthFilterBar';

const summary = { total: 8, atencao: 3, saudaveis: 3, estaveis: 1, conexao: 1, precisamAtencao: 4 };

const baseProps = {
  summary,
  filter: 'todos' as const,
  onFilter: vi.fn(),
  search: '',
  onSearch: vi.fn(),
  sort: 'atencao' as const,
  onSort: vi.fn(),
};

describe('HealthFilterBar', () => {
  it('renders chips with counts', () => {
    render(<HealthFilterBar {...baseProps} />);
    expect(screen.getByText('Todos')).toBeTruthy();
    expect(screen.getByText('8')).toBeTruthy(); // total
    expect(screen.getByText('Atenção')).toBeTruthy();
  });

  it('calls onFilter when a chip is clicked', () => {
    const onFilter = vi.fn();
    render(<HealthFilterBar {...baseProps} onFilter={onFilter} />);
    fireEvent.click(screen.getByText('Saudáveis'));
    expect(onFilter).toHaveBeenCalledWith('saudaveis');
  });

  it('calls onSearch when typing', () => {
    const onSearch = vi.fn();
    render(<HealthFilterBar {...baseProps} onSearch={onSearch} />);
    fireEvent.change(screen.getByPlaceholderText('Buscar cliente…'), { target: { value: 'ana' } });
    expect(onSearch).toHaveBeenCalledWith('ana');
  });

  it('calls onSort when the select changes', () => {
    const onSort = vi.fn();
    render(<HealthFilterBar {...baseProps} onSort={onSort} />);
    fireEvent.change(screen.getByLabelText('Ordenar'), { target: { value: 'seguidores' } });
    expect(onSort).toHaveBeenCalledWith('seguidores');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run apps/crm/src/pages/dashboard/components/__tests__/HealthFilterBar.test.tsx`
Expected: FAIL — cannot resolve `../HealthFilterBar`.

- [ ] **Step 3: Write the implementation**

Create `apps/crm/src/pages/dashboard/components/HealthFilterBar.tsx`:

```tsx
import { useTranslation } from 'react-i18next';
import type { ClientHealthSummary } from '../../../services/clientHealth';
import type { HealthFilterKey, HealthSort } from '../../../lib/health/filter';

interface Props {
  summary: ClientHealthSummary;
  filter: HealthFilterKey;
  onFilter: (k: HealthFilterKey) => void;
  search: string;
  onSearch: (s: string) => void;
  sort: HealthSort;
  onSort: (s: HealthSort) => void;
}

const CHIPS: { key: HealthFilterKey; countKey: keyof ClientHealthSummary | null }[] = [
  { key: 'todos', countKey: 'total' },
  { key: 'atencao', countKey: 'atencao' },
  { key: 'saudaveis', countKey: 'saudaveis' },
  { key: 'estaveis', countKey: 'estaveis' },
  { key: 'conexao', countKey: 'conexao' },
];

const SORTS: HealthSort[] = ['atencao', 'engajamento', 'ultimo_post', 'seguidores', 'nome'];

export function HealthFilterBar({ summary, filter, onFilter, search, onSearch, sort, onSort }: Props) {
  const { t } = useTranslation('dashboard');
  return (
    <div
      className="card"
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        flexWrap: 'wrap',
        gap: 10,
        padding: '11px 13px',
        borderRadius: 14,
      }}
    >
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {CHIPS.map(({ key, countKey }) => {
          const active = filter === key;
          const count = countKey ? summary[countKey] : 0;
          return (
            <button
              key={key}
              onClick={() => onFilter(key)}
              style={{
                fontSize: '0.72rem',
                fontWeight: 600,
                padding: '5px 11px',
                borderRadius: 20,
                border: active ? '1px solid var(--primary-color)' : '1px solid transparent',
                background: active ? 'var(--primary-color)' : 'var(--surface-hover)',
                color: active ? '#1a1a1a' : 'var(--text-muted)',
                cursor: 'pointer',
              }}
            >
              <span>{t(`health.chips.${key}`)}</span> <strong>{count}</strong>
            </button>
          );
        })}
      </div>
      <div style={{ display: 'flex', gap: 6 }}>
        <input
          className="form-input"
          placeholder={t('health.search')}
          value={search}
          onChange={(e) => onSearch(e.target.value)}
          style={{ fontSize: '0.72rem' }}
        />
        <select
          aria-label={t('health.sortLabel')}
          value={sort}
          onChange={(e) => onSort(e.target.value as HealthSort)}
          className="form-input"
          style={{ fontSize: '0.72rem' }}
        >
          {SORTS.map((s) => (
            <option key={s} value={s}>
              {t(`health.sort.${s}`)}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run apps/crm/src/pages/dashboard/components/__tests__/HealthFilterBar.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/crm/src/pages/dashboard/components/HealthFilterBar.tsx apps/crm/src/pages/dashboard/components/__tests__/HealthFilterBar.test.tsx
git commit -m "feat(dashboard): HealthFilterBar component"
```

---

## Task 10: ClientHealthGrid component

**Files:**
- Create: `apps/crm/src/pages/dashboard/components/ClientHealthGrid.tsx`
- Test: `apps/crm/src/pages/dashboard/components/__tests__/ClientHealthGrid.test.tsx`

**Interfaces:**
- Consumes: `ClientHealth` from `@/services/clientHealth`; `filterAndSortClients`, `HealthFilterKey`, `HealthSort` from `@/lib/health/filter`; `ClientHealthCard`.
- Produces: `function ClientHealthGrid(props: { clients: ClientHealth[]; isLoading: boolean; isError: boolean; filter: HealthFilterKey; search: string; sort: HealthSort }): JSX.Element`. Renders skeletons while loading, an error message on error, empty/no-clients/filtered-empty messages, otherwise the filtered/sorted card grid. Must be rendered in a router (cards contain `Link`s).

- [ ] **Step 1: Write the failing test**

Create `apps/crm/src/pages/dashboard/components/__tests__/ClientHealthGrid.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, it, expect, vi } from 'vitest';
import { ClientHealthGrid } from '../ClientHealthGrid';
import type { ClientHealth } from '../../../../services/clientHealth';

vi.mock('../../../../services/instagram', () => ({
  getInstagramAuthUrl: vi.fn(),
  syncInstagramData: vi.fn(),
}));

const mk = (over: Partial<ClientHealth>): ClientHealth =>
  ({
    client_id: 1,
    client_name: 'Alpha',
    client_sigla: 'A',
    client_cor: '#000',
    username: 'alpha',
    profile_picture_url: null,
    connected: true,
    follower_count: 10,
    follower_delta: 1,
    follower_delta_pct: 1,
    follower_series: [9, 10],
    engagement_rate: 3,
    reach_28d: 100,
    reach_trend_pct: 5,
    days_since_last_post: 2,
    pipeline: { agendados: 1, em_producao: 0, agente: 0, falha: 0 },
    authorization_status: 'active',
    token_expires_at: null,
    last_synced_at: new Date().toISOString(),
    status: 'saudavel',
    score: 70,
    ...over,
  }) as ClientHealth;

const base = {
  clients: [] as ClientHealth[],
  isLoading: false,
  isError: false,
  filter: 'todos' as const,
  search: '',
  sort: 'nome' as const,
};

const renderGrid = (props: Partial<typeof base>) =>
  render(
    <MemoryRouter>
      <ClientHealthGrid {...base} {...props} />
    </MemoryRouter>,
  );

describe('ClientHealthGrid', () => {
  it('shows skeletons while loading', () => {
    const { container } = renderGrid({ isLoading: true });
    expect(container.querySelectorAll('[data-testid="health-skeleton"]').length).toBeGreaterThan(0);
  });

  it('shows an error message on error', () => {
    renderGrid({ isError: true });
    expect(screen.getByText(/Não foi possível carregar/)).toBeTruthy();
  });

  it('shows the no-clients empty state', () => {
    renderGrid({ clients: [] });
    expect(screen.getByText(/Nenhum cliente ativo/)).toBeTruthy();
  });

  it('renders a card per client and applies the filter', () => {
    renderGrid({
      clients: [mk({ client_id: 1, client_name: 'Alpha', status: 'saudavel' }), mk({ client_id: 2, client_name: 'Bravo', status: 'em_queda' })],
      filter: 'atencao',
    });
    expect(screen.queryByText('Alpha')).toBeNull();
    expect(screen.getByText('Bravo')).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run apps/crm/src/pages/dashboard/components/__tests__/ClientHealthGrid.test.tsx`
Expected: FAIL — cannot resolve `../ClientHealthGrid`.

- [ ] **Step 3: Write the implementation**

Create `apps/crm/src/pages/dashboard/components/ClientHealthGrid.tsx`:

```tsx
import { useTranslation } from 'react-i18next';
import type { ClientHealth } from '../../../services/clientHealth';
import { filterAndSortClients, type HealthFilterKey, type HealthSort } from '../../../lib/health/filter';
import { ClientHealthCard } from './ClientHealthCard';

interface Props {
  clients: ClientHealth[];
  isLoading: boolean;
  isError: boolean;
  filter: HealthFilterKey;
  search: string;
  sort: HealthSort;
}

const gridStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))',
  gap: 12,
  marginTop: 12,
};

export function ClientHealthGrid({ clients, isLoading, isError, filter, search, sort }: Props) {
  const { t } = useTranslation('dashboard');

  if (isLoading) {
    return (
      <div style={gridStyle}>
        {Array.from({ length: 6 }).map((_, i) => (
          <div
            key={i}
            data-testid="health-skeleton"
            className="card"
            style={{ height: 150, borderRadius: 16, opacity: 0.5 }}
          />
        ))}
      </div>
    );
  }

  if (isError) {
    return (
      <p style={{ color: 'var(--text-muted)', padding: '1.5rem', textAlign: 'center' }}>
        {t('health.error')}
      </p>
    );
  }

  if (clients.length === 0) {
    return (
      <p style={{ color: 'var(--text-muted)', padding: '1.5rem', textAlign: 'center' }}>
        {t('health.empty.noClients')}
      </p>
    );
  }

  const anyConnected = clients.some((c) => c.connected);
  if (!anyConnected) {
    return (
      <p style={{ color: 'var(--text-muted)', padding: '1.5rem', textAlign: 'center' }}>
        {t('health.empty.noneConnected')}
      </p>
    );
  }

  const visible = filterAndSortClients(clients, { filter, search, sort });
  if (visible.length === 0) {
    return (
      <p style={{ color: 'var(--text-muted)', padding: '1.5rem', textAlign: 'center' }}>
        {t('health.empty.filtered')}
      </p>
    );
  }

  return (
    <div style={gridStyle}>
      {visible.map((c) => (
        <ClientHealthCard key={c.client_id} client={c} />
      ))}
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run apps/crm/src/pages/dashboard/components/__tests__/ClientHealthGrid.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/crm/src/pages/dashboard/components/ClientHealthGrid.tsx apps/crm/src/pages/dashboard/components/__tests__/ClientHealthGrid.test.tsx
git commit -m "feat(dashboard): ClientHealthGrid with states"
```

---

## Task 11: ClientHealthMonitor section (wiring)

**Files:**
- Create: `apps/crm/src/pages/dashboard/components/ClientHealthMonitor.tsx`
- Test: `apps/crm/src/pages/dashboard/components/__tests__/ClientHealthMonitor.test.tsx`

**Interfaces:**
- Consumes: `getClientHealthMonitor` from `@/services/clientHealth`; `HealthFilterBar`, `ClientHealthGrid`; `HealthFilterKey`, `HealthSort` from `@/lib/health/filter`; `useQuery` from `@tanstack/react-query`.
- Produces: `function ClientHealthMonitor(): JSX.Element` — owns `useQuery(['clientHealth'], () => getClientHealthMonitor())` with `staleTime: 5 * 60_000`, local state `{ filter, search, sort }` (sort default `'atencao'`, filter default `'todos'`), renders the header (title + subtitle with counts), `HealthFilterBar`, and `ClientHealthGrid`.

- [ ] **Step 1: Write the failing test**

Create `apps/crm/src/pages/dashboard/components/__tests__/ClientHealthMonitor.test.tsx`:

```tsx
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, it, expect, vi } from 'vitest';

vi.mock('../../../../services/instagram', () => ({
  getInstagramAuthUrl: vi.fn(),
  syncInstagramData: vi.fn(),
}));
vi.mock('../../../../services/clientHealth', () => ({
  getClientHealthMonitor: vi.fn().mockResolvedValue({
    clients: [
      {
        client_id: 1,
        client_name: 'Dr. Ana',
        client_sigla: 'DA',
        client_cor: '#000',
        username: 'ana',
        profile_picture_url: null,
        connected: true,
        follower_count: 100,
        follower_delta: 10,
        follower_delta_pct: 11,
        follower_series: [90, 100],
        engagement_rate: 4,
        reach_28d: 1000,
        reach_trend_pct: 5,
        days_since_last_post: 2,
        pipeline: { agendados: 1, em_producao: 0, agente: 0, falha: 0 },
        authorization_status: 'active',
        token_expires_at: null,
        last_synced_at: new Date().toISOString(),
        status: 'saudavel',
        score: 70,
      },
    ],
    summary: { total: 1, atencao: 0, saudaveis: 1, estaveis: 0, conexao: 0, precisamAtencao: 0 },
  }),
}));

import { ClientHealthMonitor } from '../ClientHealthMonitor';

function renderMonitor() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <ClientHealthMonitor />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('ClientHealthMonitor', () => {
  it('renders the title and a client card after loading', async () => {
    renderMonitor();
    expect(screen.getByText('Saúde dos clientes')).toBeTruthy();
    await waitFor(() => expect(screen.getByText('Dr. Ana')).toBeTruthy());
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run apps/crm/src/pages/dashboard/components/__tests__/ClientHealthMonitor.test.tsx`
Expected: FAIL — cannot resolve `../ClientHealthMonitor`.

- [ ] **Step 3: Write the implementation**

Create `apps/crm/src/pages/dashboard/components/ClientHealthMonitor.tsx`:

```tsx
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { getClientHealthMonitor } from '../../../services/clientHealth';
import { HealthFilterBar } from './HealthFilterBar';
import { ClientHealthGrid } from './ClientHealthGrid';
import type { HealthFilterKey, HealthSort } from '../../../lib/health/filter';

const EMPTY_SUMMARY = {
  total: 0,
  atencao: 0,
  saudaveis: 0,
  estaveis: 0,
  conexao: 0,
  precisamAtencao: 0,
};

export function ClientHealthMonitor() {
  const { t } = useTranslation('dashboard');
  const [filter, setFilter] = useState<HealthFilterKey>('todos');
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<HealthSort>('atencao');

  const { data, isLoading, isError } = useQuery({
    queryKey: ['clientHealth'],
    queryFn: () => getClientHealthMonitor(),
    staleTime: 5 * 60_000,
    retry: 1,
  });

  const clients = data?.clients ?? [];
  const summary = data?.summary ?? EMPTY_SUMMARY;

  return (
    <section style={{ marginBottom: '1.5rem' }}>
      <div style={{ marginBottom: 12 }}>
        <h1>{t('health.title')}</h1>
        <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', margin: 0 }}>
          {t('health.subtitle', { count: summary.total, total: summary.total, attention: summary.precisamAtencao })}
        </p>
      </div>
      <HealthFilterBar
        summary={summary}
        filter={filter}
        onFilter={setFilter}
        search={search}
        onSearch={setSearch}
        sort={sort}
        onSort={setSort}
      />
      <ClientHealthGrid
        clients={clients}
        isLoading={isLoading}
        isError={isError}
        filter={filter}
        search={search}
        sort={sort}
      />
    </section>
  );
}
```

> Note: the `subtitle` key uses i18next plural form. With `count` provided, i18next resolves `health.subtitle_one` / `health.subtitle_other` from Task 2. The extra `total`/`attention` vars feed the interpolation.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run apps/crm/src/pages/dashboard/components/__tests__/ClientHealthMonitor.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/crm/src/pages/dashboard/components/ClientHealthMonitor.tsx apps/crm/src/pages/dashboard/components/__tests__/ClientHealthMonitor.test.tsx
git commit -m "feat(dashboard): ClientHealthMonitor section wiring"
```

---

## Task 12: Extract TodayCard + FinanceKpiStrip from DashboardPage

This task extracts the two surviving operational pieces into standalone components so the shell stays small. It's a behavior-preserving refactor of existing code in `DashboardPage.tsx`.

**Files:**
- Create: `apps/crm/src/pages/dashboard/components/TodayCard.tsx`
- Create: `apps/crm/src/pages/dashboard/components/FinanceKpiStrip.tsx`
- Test: `apps/crm/src/pages/dashboard/components/__tests__/FinanceKpiStrip.test.tsx`
- Read for reference: `apps/crm/src/pages/dashboard/DashboardPage.tsx` (current "What's happening today" card, lines ~122–208 + 237–343; finance KPI grid lines ~709–797 & 799–837)

**Interfaces:**
- Produces:
  - `function TodayCard(props: { events: TodayEvent[] }): JSX.Element` where `interface TodayEvent { kind: 'income'|'expense'|'deadline'|'birthday'|'data'; label: string; sublabel: string }`. (The shell computes the events array; the card just renders it — keeps the card pure and testable.)
  - `function FinanceKpiStrip(props: { aReceber: number; aPagar: number; saldoProjetado: number; receitaMensal: number }): JSX.Element`. Uses `formatBRL` from `@/store`.

- [ ] **Step 1: Write the failing test (FinanceKpiStrip — the one with logic worth asserting)**

Create `apps/crm/src/pages/dashboard/components/__tests__/FinanceKpiStrip.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { FinanceKpiStrip } from '../FinanceKpiStrip';

describe('FinanceKpiStrip', () => {
  it('renders the four KPI labels and formatted BRL values', () => {
    render(<FinanceKpiStrip aReceber={18400} aPagar={7100} saldoProjetado={11300} receitaMensal={24000} />);
    expect(screen.getByText('A receber')).toBeTruthy();
    expect(screen.getByText('A pagar')).toBeTruthy();
    // formatBRL renders e.g. "R$ 18.400,00"
    expect(screen.getByText(/18\.400/)).toBeTruthy();
  });
});
```

> This test relies on `dashboard.json` having `kpi.aReceber`, `kpi.aPagar`, `kpi.saldo`, `kpi.receitaMensal` (they already exist — they back the current dashboard). If a label key differs, read the current `kpi` block and reuse the exact keys.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run apps/crm/src/pages/dashboard/components/__tests__/FinanceKpiStrip.test.tsx`
Expected: FAIL — cannot resolve `../FinanceKpiStrip`.

- [ ] **Step 3: Write FinanceKpiStrip**

Create `apps/crm/src/pages/dashboard/components/FinanceKpiStrip.tsx`:

```tsx
import { useTranslation } from 'react-i18next';
import { formatBRL } from '../../../store';

interface Props {
  aReceber: number;
  aPagar: number;
  saldoProjetado: number;
  receitaMensal: number;
}

export function FinanceKpiStrip({ aReceber, aPagar, saldoProjetado, receitaMensal }: Props) {
  const { t } = useTranslation('dashboard');
  const items = [
    { label: t('kpi.aReceber'), value: formatBRL(aReceber), color: 'var(--success)' },
    { label: t('kpi.aPagar'), value: formatBRL(aPagar), color: 'var(--danger)' },
    { label: t('kpi.saldo'), value: formatBRL(saldoProjetado), color: undefined },
    { label: t('kpi.receitaMensal'), value: formatBRL(receitaMensal), color: undefined },
  ];
  return (
    <div className="kpi-grid" style={{ marginTop: '1rem' }}>
      {items.map((it) => (
        <div key={it.label} className="kpi-card">
          <span className="kpi-label">{it.label}</span>
          <span className="kpi-value" style={{ fontSize: '1.1rem', color: it.color }}>
            {it.value}
          </span>
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 4: Write TodayCard**

Create `apps/crm/src/pages/dashboard/components/TodayCard.tsx`:

```tsx
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { EmptyStateGuide } from '../../../components/help/EmptyStateGuide';

export interface TodayEvent {
  kind: 'income' | 'expense' | 'deadline' | 'birthday' | 'data';
  label: string;
  sublabel: string;
}

const ICON: Record<TodayEvent['kind'], { icon: string; color: string }> = {
  income: { icon: 'ph ph-arrow-up-right', color: 'var(--success)' },
  expense: { icon: 'ph ph-arrow-down-left', color: 'var(--danger)' },
  deadline: { icon: 'ph ph-flag', color: 'var(--warning)' },
  birthday: { icon: 'ph ph-cake', color: 'var(--pink, #ec4899)' },
  data: { icon: 'ph ph-star', color: 'var(--info, #6366f1)' },
};

export function TodayCard({ events }: { events: TodayEvent[] }) {
  const { t } = useTranslation('dashboard');
  return (
    <Link to="/calendario" style={{ textDecoration: 'none', color: 'inherit' }}>
      <div className="card dashboard-hub-card animate-up">
        <div className="dashboard-hub-card-header">
          <h3>
            <i className="ph ph-calendar-check" style={{ marginRight: 8 }} />
            {t('cards.today')}
          </h3>
          <i className="ph ph-arrow-right" />
        </div>
        {events.length === 0 ? (
          <EmptyStateGuide
            icon="📅"
            title={t('empty.noEventsToday')}
            description=""
            actionLabel="Clientes"
            actionHref="/clientes"
          />
        ) : (
          <div className="dashboard-hub-list">
            {events.map((e, i) => (
              <div key={i} className="dashboard-hub-row">
                <span style={{ fontSize: '0.85rem' }}>
                  <i className={ICON[e.kind].icon} style={{ color: ICON[e.kind].color, marginRight: 4 }} />
                  {e.label}
                </span>
                <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>{e.sublabel}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </Link>
  );
}
```

- [ ] **Step 5: Run the tests and typecheck**

Run: `npx vitest run apps/crm/src/pages/dashboard/components/__tests__/FinanceKpiStrip.test.tsx`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/crm/src/pages/dashboard/components/TodayCard.tsx apps/crm/src/pages/dashboard/components/FinanceKpiStrip.tsx apps/crm/src/pages/dashboard/components/__tests__/FinanceKpiStrip.test.tsx
git commit -m "feat(dashboard): extract TodayCard and FinanceKpiStrip"
```

---

## Task 13: Rewrite DashboardPage as the thin shell

Replace the body of `DashboardPage.tsx` with: `OnboardingBanner` (non-agent) + `ClientHealthMonitor` (everyone) + slim ops (`TodayCard` for everyone, `FinanceKpiStrip` for owner/admin only). Remove the old Leads / Analytics teaser / Entregas / Contratos / Equipe / Financeiro / Calendário cards and the old KPI grid. **Preserve** the existing data queries that feed `TodayCard` (today's events) and `FinanceKpiStrip` (a receber / a pagar / saldo / receita) — reuse the current computation logic from the file, now feeding the extracted components.

**Files:**
- Modify: `apps/crm/src/pages/dashboard/DashboardPage.tsx`
- Read for reference: the current file (today-events computation lines ~122–208; finance figures lines ~76–83 & ~799–837).

**Interfaces:**
- Consumes: `ClientHealthMonitor`, `TodayCard` (+ `TodayEvent`), `FinanceKpiStrip` from `./components/*`; existing `getDashboardStats`, `getClientes`, `getMembros`, `getWorkflows`, `getWorkflowEtapas`, `getAllClienteDatas` from `@/store`; `useAuth`.

- [ ] **Step 1: Write the implementation (full file replacement)**

Replace `apps/crm/src/pages/dashboard/DashboardPage.tsx` with:

```tsx
import { useQueries, useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
  getDashboardStats,
  getClientes,
  getMembros,
  getWorkflows,
  getWorkflowEtapas,
  getAllClienteDatas,
  getLeads,
  type Membro,
  type Cliente,
  type Workflow,
  type Lead,
} from '../../store';
import { getPortfolioSummary, type PortfolioSummary } from '../../services/analytics';
import { useAuth } from '../../context/AuthContext';
import { OnboardingBanner } from '../../components/OnboardingBanner';
import { ClientHealthMonitor } from './components/ClientHealthMonitor';
import { TodayCard, type TodayEvent } from './components/TodayCard';
import { FinanceKpiStrip } from './components/FinanceKpiStrip';

export default function DashboardPage() {
  const { role } = useAuth();
  const { t } = useTranslation('dashboard');
  const isAgent = role === 'agent';

  const results = useQueries({
    queries: [
      { queryKey: ['dashboardStats'], queryFn: getDashboardStats, retry: 1 },
      { queryKey: ['membros'], queryFn: getMembros, retry: 1 },
      { queryKey: ['clientes'], queryFn: getClientes, retry: 1 },
      { queryKey: ['workflows'], queryFn: getWorkflows, retry: 1 },
      { queryKey: ['leads'], queryFn: getLeads, retry: 1 },
      { queryKey: ['portfolioSummary'], queryFn: () => getPortfolioSummary(), retry: 1 },
    ],
  });
  const [statsRes, membrosRes, clientesRes, workflowsRes, leadsRes, portfolioRes] = results;
  const stats = statsRes.data ?? null;
  const membros: Membro[] = membrosRes.data ?? [];
  const clientes: Cliente[] = clientesRes.data ?? [];
  const workflows: Workflow[] = workflowsRes.data ?? [];
  const leads: Lead[] = leadsRes.data ?? [];
  const portfolio: PortfolioSummary | undefined = portfolioRes.data;

  const { data: datasImportantes = [] } = useQuery({
    queryKey: ['allClienteDatas'],
    queryFn: getAllClienteDatas,
    retry: 1,
  });
  const { data: deadlineEvents = [] } = useQuery({
    queryKey: ['calendar-deadlines', workflows.map((w) => w.id).join(',')],
    queryFn: async () => {
      const activeWfs = workflows.filter((w) => w.status === 'ativo');
      const etapasResults = await Promise.all(activeWfs.map((w) => getWorkflowEtapas(w.id!)));
      const now = new Date();
      const events: { etapaNome: string; clienteNome: string; deadlineDate: Date }[] = [];
      activeWfs.forEach((w, idx) => {
        const activeEtapa = etapasResults[idx].find((e) => e.status === 'ativo');
        if (!activeEtapa || !activeEtapa.iniciado_em) return;
        const deadlineDate = new Date(activeEtapa.iniciado_em);
        if (activeEtapa.tipo_prazo === 'uteis') {
          let added = 0;
          while (added < activeEtapa.prazo_dias) {
            deadlineDate.setDate(deadlineDate.getDate() + 1);
            const dow = deadlineDate.getDay();
            if (dow !== 0 && dow !== 6) added++;
          }
        } else {
          deadlineDate.setDate(deadlineDate.getDate() + activeEtapa.prazo_dias);
        }
        const cliente = clientes.find((c) => c.id === w.cliente_id);
        events.push({ etapaNome: activeEtapa.nome, clienteNome: cliente?.nome || '—', deadlineDate });
      });
      return events;
    },
    enabled: workflows.length > 0,
  });

  // ---- today's events ----
  const now = new Date();
  const todayDay = now.getDate();
  const todayMonth = now.getMonth();
  const todayYear = now.getFullYear();
  const sameDay = (d: Date) =>
    d.getDate() === todayDay && d.getMonth() === todayMonth && d.getFullYear() === todayYear;

  const todayEvents: TodayEvent[] = [];
  if (!isAgent) {
    clientes
      .filter((c) => c.data_pagamento === todayDay && c.status === 'ativo')
      .forEach((c) => todayEvents.push({ kind: 'income', label: c.nome, sublabel: t('events.recebimento') }));
    membros
      .filter((m) => m.data_pagamento === todayDay)
      .forEach((m) => todayEvents.push({ kind: 'expense', label: m.nome, sublabel: t('events.despesa') }));
  }
  deadlineEvents
    .filter((d) => sameDay(d.deadlineDate))
    .forEach((d) => todayEvents.push({ kind: 'deadline', label: d.etapaNome, sublabel: d.clienteNome }));
  clientes
    .filter((c) => {
      if (!c.data_aniversario) return false;
      const [mm, dd] = c.data_aniversario.split('-').map(Number);
      return mm - 1 === todayMonth && dd === todayDay;
    })
    .forEach((c) => todayEvents.push({ kind: 'birthday', label: c.nome, sublabel: t('events.aniversario') }));
  datasImportantes
    .filter((d) => sameDay(new Date(d.data + 'T00:00:00')))
    .forEach((d) =>
      todayEvents.push({
        kind: 'data',
        label: d.titulo,
        sublabel: clientes.find((c) => c.id === d.cliente_id)?.nome ?? '',
      }),
    );

  // ---- finance figures ----
  const transacoes = stats?.transacoes ?? [];
  const aReceber = transacoes
    .filter((tx) => tx.tipo === 'entrada' && tx.status === 'agendado')
    .reduce((s, tx) => s + Number(tx.valor), 0);
  const aPagar = transacoes
    .filter((tx) => tx.tipo === 'saida' && tx.status === 'agendado')
    .reduce((s, tx) => s + Number(tx.valor), 0);

  return (
    <div>
      {!isAgent && (
        <OnboardingBanner
          clientes={clientes}
          leads={leads}
          membros={membros}
          portfolioAccounts={portfolio?.accounts ?? []}
          workflows={workflows}
        />
      )}

      <ClientHealthMonitor />

      <div className="dashboard-hub" style={{ marginTop: '1.5rem' }}>
        <TodayCard events={todayEvents} />
      </div>

      {!isAgent && stats && (
        <FinanceKpiStrip
          aReceber={aReceber}
          aPagar={aPagar}
          saldoProjetado={stats.saldo}
          receitaMensal={stats.receitaMensal}
        />
      )}
    </div>
  );
}
```

> Before finalizing: open the current `DashboardPage.tsx` and confirm the field names used above (`stats.saldo`, `stats.receitaMensal`, `stats.transacoes[].tipo/status/valor`, `Membro.data_pagamento`, `Cliente.data_aniversario`, `getAllClienteDatas` row `.data/.titulo/.cliente_id`) match — they are copied from the existing file. `OnboardingBanner` keeps its real `leads` + `portfolioAccounts` data so onboarding-step detection is unchanged; `getPortfolioSummary` is fetched here solely for the banner (non-agent).

- [ ] **Step 2: Typecheck**

Run: `npm run build`
Expected: `tsc` passes (no type errors), vite build completes. Fix any prop/field mismatches surfaced.

- [ ] **Step 3: Run the full frontend test suite**

Run: `npm run test`
Expected: PASS. If `App.test.tsx` asserted any old dashboard card text, update it to the new shell (it currently smoke-tests routing; adjust only if it references removed cards).

- [ ] **Step 4: Manual verification**

Run: `npm run dev:staging` and open `/dashboard`. Confirm: health grid renders with chips/sort/search; cards link to `/analytics/:id` and `/clientes/:id`; Hoje card + finance KPIs show for owner; finance hidden when logged in as an agent.

- [ ] **Step 5: Commit**

```bash
git add apps/crm/src/pages/dashboard/DashboardPage.tsx apps/crm/src/__tests__/App.test.tsx
git commit -m "feat(dashboard): health monitor hero + slim ops shell"
```

---

## Task 14: Final verification gate

- [ ] **Step 1: Full build + tests + format**

```bash
npm run build
npm run test
npx prettier --check "apps/crm/src/**/*.{ts,tsx}" "packages/i18n/locales/**/*.json"
```

Expected: build passes, all tests green, prettier reports no formatting issues (run `npx prettier --write` on any flagged files, then re-run tests).

- [ ] **Step 2: Confirm no Deno/node_modules pollution**

If `supabase functions deploy` or `deno` was run at any point, restore the lockfile per project guidance:

```bash
git checkout deno.lock 2>/dev/null || true
npm ci
```

- [ ] **Step 3: Final commit (if prettier changed anything)**

```bash
git add -A
git commit -m "chore(dashboard): formatting + lockfile hygiene" || echo "nothing to commit"
```

---

## Self-Review notes (for the implementer)

- **RPC not unit-tested in JS:** Task 3's correctness is validated by Step 2's staging smoke query plus Task 4's service tests (which mock the RPC rows). When the RPC is applied to prod, re-run the smoke query there.
- **`now()` vs injected `nowMs`:** the RPC uses SQL `now()`/`current_date` for windowing; the JS scorer uses `Date.now()` for token/sync/recency. Tests inject `nowMs` for determinism — keep that seam.
- **Plural subtitle:** `health.subtitle` resolves via i18next `_one/_other` from the `count` arg; do not add a literal `health.subtitle` key.
