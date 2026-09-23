# Minha fila Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give every team member a "Minha fila" view in Entregas that lists the posts currently with them (by active etapa or by post assignment), ordered by etapa deadline into six buckets, with the publish date and the margin between the two, plus a "Chegando" list of posts whose next etapa is theirs; and a three-item teaser of the same queue on the Dashboard.

**Architecture:** One pure builder `buildMinhaFila({ cards, posts, postEntities }, membroId, now)` in `apps/crm/src/pages/entregas/minhaFila.ts` derives everything from data Entregas already loads (`useEntregasData` cards and post entities, `useActivePosts` posts). A new view component `MinhaFilaView` renders it inside `EntregasPage` as a sixth tab (`?view=fila`, optional `&membro=<id>`). The Dashboard mounts `MinhaFilaCard`, which runs the same builder over a slim `useMinhaFilaData()` hook that observes the same six TanStack Query keys Entregas uses. No backend, schema, RPC or edge-function change.

**Tech Stack:** React 19 + TypeScript, React Router v7 (`useSearchParams`), TanStack Query v5, shadcn/ui (`Select`, `Spinner`), lucide-react, react-i18next (Dashboard only), Vitest + Testing Library (jsdom), PostHog via `captureEvent`.

Spec: `docs/superpowers/specs/2026-09-23-minha-fila-design.md` (read it once before starting; every task below cites the section it implements). Code references are `path:line` relative to `apps/crm/src/` unless stated otherwise.

## Global Constraints

- All user-facing copy is pt-BR and **never contains an em-dash** (use a period, a colon or a middle dot `·` instead). Copy strings in this plan are final; copy them verbatim from the spec's Copy table.
- Before pushing run, from the repo root: `npm run lint`, `npm run format:check` (`npm run format` auto-fixes), the four typecheck runs (`npx tsc -p apps/crm/tsconfig.json --noEmit`, `npx tsc -p apps/hub/tsconfig.json --noEmit`, `npx tsc -p apps/admin/tsconfig.json --noEmit`, `npx tsc -p tsconfig.scripts.json`) and `npm run test`. Nothing under `supabase/functions/` changes, so `check:functions`/`test:functions` are not affected.
- Never use `useBlocker` in the apps (React Router honours only the last registered blocker and `installSilentUpdate` already registers one).
- Ids read from the URL use `parseInt(value, 10)` with an `isNaN` guard, never bare `Number()`.
- No backend or schema change of any kind. No new query key: the six keys the teaser observes (`['workflows']`, `['all-active-etapas']`, `['clientes']`, `['membros']`, `['active-posts']`, `['post-processes','vigentes']`) already exist and keep their exact `queryFn` shape.
- Vitest runs from the repo root (`vitest.config.ts` at the root): `npx vitest run <path>`. `apps/crm/tsconfig.json` excludes `__tests__`, so tests are not type-checked; type consistency is enforced by the four `tsc` runs on source files only.
- Toasts: `toast()` from `sonner`. Icons: `lucide-react` only. Path alias `@/` maps to `apps/crm/src/`.
- Entregas strings are literal pt-BR (no `react-i18next` under `pages/entregas/`). Dashboard strings go through `useTranslation('dashboard')` and **both** `packages/i18n/locales/pt/dashboard.json` and `packages/i18n/locales/en/dashboard.json` (`test/vitest.setup.ts` loads both into the real i18n instance, so component tests assert the real strings).
- Commit after every task with the trailer `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Do not push unless told to.

## File structure

New:
- `apps/crm/src/pages/entregas/minhaFila.ts`: pure builder, bucket/margem helpers, types (Tasks 1 and 2).
- `apps/crm/src/pages/entregas/__tests__/minhaFila.test.ts` (Tasks 1 and 2).
- `apps/crm/src/pages/entregas/hooks/__tests__/useActivePosts.test.ts`, `apps/crm/src/hooks/__tests__/useCurrentMembro.test.tsx` (Task 4).
- `apps/crm/src/pages/entregas/views/MinhaFilaView.tsx` + `views/__tests__/MinhaFilaView.test.tsx` (Task 5).
- `apps/crm/src/pages/entregas/hooks/useMinhaFilaData.ts` + `hooks/__tests__/useMinhaFilaData.test.ts` (Task 7).
- `apps/crm/src/pages/dashboard/components/MinhaFilaCard.tsx` + `components/__tests__/MinhaFilaCard.test.tsx` (Task 7).

Modified:
- `apps/crm/src/pages/entregas/etapaPrazo.ts`, `apps/crm/src/pages/dashboard/todayAgenda.ts`, `apps/crm/src/pages/entregas/__tests__/etapaPrazo.test.ts` (Task 1).
- `apps/crm/src/pages/entregas/viewQuery.ts`, `__tests__/viewQuery.test.ts`, `components/VistasTabs.tsx`, `EntregasPage.tsx` (one line) (Task 3).
- `apps/crm/src/pages/entregas/hooks/useEntregasData.ts`, `hooks/useActivePosts.ts`, `apps/crm/src/hooks/useCurrentMembro.ts`, `hooks/__tests__/useEntregasData.test.ts` (Task 4).
- `apps/crm/style.css` (Task 5).
- `apps/crm/src/pages/entregas/EntregasPage.tsx`, `__tests__/EntregasPage.test.tsx`, `apps/crm/src/lib/analytics.ts` (Task 6).
- `packages/i18n/locales/pt/dashboard.json`, `packages/i18n/locales/en/dashboard.json` (Task 7).
- `apps/crm/src/pages/dashboard/components/AgentPendingSection.tsx`, `components/__tests__/AgentPendingSection.test.tsx`, `DashboardPage.tsx`, `__tests__/DashboardPage.test.tsx` (Task 8).

---

### Task 1: Shared day helpers in `etapaPrazo.ts` + `filaBucketOf` / `margemOf`

Spec: § Margem, § Ordenação e agrupamento (Prazo e bucket), § Arquitetura (Modificados: `etapaPrazo.ts`).

**Files:**
- Modify: `apps/crm/src/pages/entregas/etapaPrazo.ts` (export `addDays` at line 117; add `startOfLocalDay`, `dayDiff` after `dayNum` at line 115).
- Modify: `apps/crm/src/pages/dashboard/todayAgenda.ts` (lines 12 and 139-155: import from `etapaPrazo`, keep the re-export).
- Create: `apps/crm/src/pages/entregas/minhaFila.ts` (bucket + margem part).
- Test: `apps/crm/src/pages/entregas/__tests__/etapaPrazo.test.ts` (append), `apps/crm/src/pages/entregas/__tests__/minhaFila.test.ts` (create).

**Interfaces:**
- Consumes: `dayNum(d: Date): number` (`etapaPrazo.ts:113`), `DeadlineInfo` (`etapaPrazo.ts:75`).
- Produces (all in `etapaPrazo.ts`):
  - `export function startOfLocalDay(d: Date): Date`
  - `export function dayDiff(when: Date, now: Date): number` (whole local days from `now`'s day to `when`'s day, negative = past)
  - `export function addDays(d: Date, n: number): Date` (was private)
- Produces (in `minhaFila.ts`):
  - `export type FilaBucket = 'atrasado' | 'hoje' | 'amanha' | 'proximos7' | 'depois' | 'sem_prazo'`
  - `export const FILA_BUCKET_ORDER: FilaBucket[]`
  - `export const FILA_BUCKET_LABELS: Record<FilaBucket, string>`
  - `export type FilaMargem = { kind: 'sem_margem' | 'dias'; dias: number } | { kind: 'sem_data' } | { kind: 'sem_prazo' }`
  - `export function filaBucketOf(prazoDate: Date | null, deadline: DeadlineInfo, now: Date): FilaBucket`
  - `export function margemOf(scheduledAt: string | null, prazoDate: Date | null): FilaMargem`

- [ ] **Step 1: Write the failing tests**

Append to `apps/crm/src/pages/entregas/__tests__/etapaPrazo.test.ts` (add `addDays, dayDiff, startOfLocalDay` to the existing import from `'../etapaPrazo'`):

```ts
describe('day helpers', () => {
  it('startOfLocalDay drops the time of day', () => {
    const d = startOfLocalDay(new Date(2026, 8, 23, 23, 59, 59));
    expect([d.getFullYear(), d.getMonth(), d.getDate()]).toEqual([2026, 8, 23]);
    expect([d.getHours(), d.getMinutes(), d.getSeconds()]).toEqual([0, 0, 0]);
  });

  it('dayDiff counts whole local days and ignores the hour on both sides', () => {
    const now = new Date(2026, 8, 22, 23, 59);
    expect(dayDiff(new Date(2026, 8, 23, 8, 0), now)).toBe(1);
    expect(dayDiff(new Date(2026, 8, 22, 0, 1), now)).toBe(0);
    expect(dayDiff(new Date(2026, 8, 20, 12, 0), now)).toBe(-2);
  });

  it('addDays returns a new Date and crosses month boundaries', () => {
    const base = new Date(2026, 8, 30, 10, 0);
    const next = addDays(base, 1);
    expect(next).not.toBe(base);
    expect([next.getMonth(), next.getDate()]).toEqual([9, 1]);
  });
});
```

Create `apps/crm/src/pages/entregas/__tests__/minhaFila.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
// minhaFila.ts imports ASSIGNEE_PENDING_POST_STATUSES from the store (Task 2),
// which pulls the supabase client; the auto-mock keeps that import inert.
vi.mock('../../../lib/supabase');
import { FILA_BUCKET_ORDER, FILA_BUCKET_LABELS, filaBucketOf, margemOf } from '../minhaFila';
import type { DeadlineInfo } from '../etapaPrazo';

// Fixed "now": Wednesday 2026-09-23 10:00 local.
const NOW = new Date(2026, 8, 23, 10, 0, 0);
const OK: DeadlineInfo = { diasRestantes: 2, horasRestantes: 0, estourado: false, urgente: false };
const LATE: DeadlineInfo = { diasRestantes: -1, horasRestantes: 0, estourado: true, urgente: false };
/** Local date `n` days from NOW's day at hour `h`. */
const day = (n: number, h = 9) => new Date(2026, 8, 23 + n, h, 0, 0);

describe('FILA_BUCKET_ORDER', () => {
  it('has the six buckets in display order with pt-BR labels', () => {
    expect(FILA_BUCKET_ORDER).toEqual([
      'atrasado',
      'hoje',
      'amanha',
      'proximos7',
      'depois',
      'sem_prazo',
    ]);
    expect(FILA_BUCKET_LABELS.proximos7).toBe('Próximos 7 dias');
    expect(FILA_BUCKET_LABELS.sem_prazo).toBe('Sem prazo');
  });
});

describe('filaBucketOf', () => {
  it('estourado wins even when the deadline day is today', () => {
    expect(filaBucketOf(day(0, 23), LATE, NOW)).toBe('atrasado');
  });

  it('a deadline day in the past without estourado (stale cache) is still atrasado', () => {
    expect(filaBucketOf(day(-1), OK, NOW)).toBe('atrasado');
  });

  it('today is hoje regardless of the hour, tomorrow is amanha', () => {
    expect(filaBucketOf(day(0, 0), OK, NOW)).toBe('hoje');
    expect(filaBucketOf(day(0, 23), OK, NOW)).toBe('hoje');
    expect(filaBucketOf(day(1), OK, NOW)).toBe('amanha');
  });

  it('proximos7 is +2..+7 exclusive of hoje/amanha, depois is +8 and beyond', () => {
    expect(filaBucketOf(day(2), OK, NOW)).toBe('proximos7');
    expect(filaBucketOf(day(7), OK, NOW)).toBe('proximos7');
    expect(filaBucketOf(day(8), OK, NOW)).toBe('depois');
  });

  it('null prazoDate is sem_prazo, even when the fallback DeadlineInfo carries days', () => {
    expect(filaBucketOf(null, { ...OK, diasRestantes: 5 }, NOW)).toBe('sem_prazo');
  });

  it('bucketing at 23:59 gives the same answer as at 10:00 (local day, not ms)', () => {
    const lateNow = new Date(2026, 8, 23, 23, 59, 0);
    expect(filaBucketOf(day(1, 0), OK, lateNow)).toBe('amanha');
    expect(filaBucketOf(day(7, 23), OK, lateNow)).toBe('proximos7');
  });
});

describe('margemOf', () => {
  const prazo = new Date(2026, 8, 22, 23, 59);
  it('counts local calendar days between deadline and publish date, hours ignored', () => {
    expect(margemOf(new Date(2026, 8, 23, 8, 0).toISOString(), prazo)).toEqual({
      kind: 'dias',
      dias: 1,
    });
    expect(margemOf(new Date(2026, 8, 24, 8, 0).toISOString(), prazo)).toEqual({
      kind: 'dias',
      dias: 2,
    });
    expect(margemOf(new Date(2026, 8, 25, 8, 0).toISOString(), prazo)).toEqual({
      kind: 'dias',
      dias: 3,
    });
  });

  it('zero or negative days is sem_margem', () => {
    expect(margemOf(new Date(2026, 8, 22, 8, 0).toISOString(), prazo)).toEqual({
      kind: 'sem_margem',
      dias: 0,
    });
    expect(margemOf(new Date(2026, 8, 20, 8, 0).toISOString(), prazo)).toEqual({
      kind: 'sem_margem',
      dias: -2,
    });
  });

  it('no publish date is sem_data; no deadline is sem_prazo (checked first)', () => {
    expect(margemOf(null, prazo)).toEqual({ kind: 'sem_data' });
    expect(margemOf(new Date(2026, 8, 25).toISOString(), null)).toEqual({ kind: 'sem_prazo' });
    expect(margemOf(null, null)).toEqual({ kind: 'sem_prazo' });
  });
});
```

- [ ] **Step 2: Run the tests and watch them fail**

```bash
npx vitest run apps/crm/src/pages/entregas/__tests__/etapaPrazo.test.ts apps/crm/src/pages/entregas/__tests__/minhaFila.test.ts
```

Expected: `etapaPrazo.test.ts` fails with `SyntaxError: The requested module '../etapaPrazo' does not provide an export named 'addDays'` (or `dayDiff`); `minhaFila.test.ts` fails with `Failed to resolve import "../minhaFila"`.

- [ ] **Step 3: Implement**

In `apps/crm/src/pages/entregas/etapaPrazo.ts`, replace lines 112-121 (`dayNum` and the private `addDays`) with:

```ts
/** Comparable local-day key (yyyymmdd) — avoids ms arithmetic across DST. */
export function dayNum(d: Date): number {
  return d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate();
}

/** Local start of day. Shared with the dashboard agenda (todayAgenda.ts re-exports it). */
export function startOfLocalDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

/** Whole local days from `now`'s day to `when`'s day (negative = past). Hours on
 *  both sides are ignored, so 22 set 23:59 -> 23 set 08:00 is exactly 1. */
export function dayDiff(when: Date, now: Date): number {
  const a = startOfLocalDay(now);
  const b = startOfLocalDay(when);
  return Math.round((b.getTime() - a.getTime()) / 86_400_000);
}

export function addDays(d: Date, n: number): Date {
  const c = new Date(d);
  c.setDate(c.getDate() + n);
  return c;
}
```

In `apps/crm/src/pages/dashboard/todayAgenda.ts`:

Replace line 12 `import { dayNum, etapaDeadlineDateOf } from '../entregas/etapaPrazo';` with:

```ts
import { dayDiff, dayNum, etapaDeadlineDateOf, startOfLocalDay } from '../entregas/etapaPrazo';

// Re-exported: todayAgenda.test.ts and the dashboard hook import them from here.
export { dayDiff, startOfLocalDay };
```

Delete lines 139-155 (the local `startOfLocalDay` and `dayDiff` definitions, with their doc comments). Keep the private `addDays` at 133-137 as is.

Create `apps/crm/src/pages/entregas/minhaFila.ts`:

```ts
import { addDays, dayDiff, dayNum, type DeadlineInfo } from './etapaPrazo';

// Pure logic for the "Minha fila" view and the dashboard teaser. No React, no
// fetching. Spec: docs/superpowers/specs/2026-09-23-minha-fila-design.md.

/** Seções da fila, na ordem de exibição. Tipo próprio: PrazoPreset (filtro)
 *  é serializado em URL e vistas salvas e tem faixas sobrepostas (proximos7
 *  inclui hoje e amanhã); aqui as faixas são disjuntas. */
export type FilaBucket = 'atrasado' | 'hoje' | 'amanha' | 'proximos7' | 'depois' | 'sem_prazo';

export const FILA_BUCKET_ORDER: FilaBucket[] = [
  'atrasado',
  'hoje',
  'amanha',
  'proximos7',
  'depois',
  'sem_prazo',
];

export const FILA_BUCKET_LABELS: Record<FilaBucket, string> = {
  atrasado: 'Atrasado',
  hoje: 'Hoje',
  amanha: 'Amanhã',
  proximos7: 'Próximos 7 dias',
  depois: 'Depois',
  sem_prazo: 'Sem prazo',
};

export type FilaMargem =
  | { kind: 'sem_margem' | 'dias'; dias: number }
  | { kind: 'sem_data' }
  | { kind: 'sem_prazo' };

/**
 * Bucket exclusivo de uma linha. `estourado` vem da flag (getDeadlineInfo trata
 * data_limite como fim do dia; etapaDeadlineDateOf devolve a meia-noite local
 * do mesmo campo, então comparar prazoDate < now marcaria às 00:01 uma etapa
 * que vence hoje). A comparação por dia local depois disso só existe para o
 * cache velho: deadline congelado num refetch de ontem, prazoDate de ontem.
 */
export function filaBucketOf(prazoDate: Date | null, deadline: DeadlineInfo, now: Date): FilaBucket {
  if (deadline.estourado) return 'atrasado';
  if (!prazoDate) return 'sem_prazo';
  const day = dayNum(prazoDate);
  const today = dayNum(now);
  if (day < today) return 'atrasado';
  if (day === today) return 'hoje';
  if (day === dayNum(addDays(now, 1))) return 'amanha';
  if (day <= dayNum(addDays(now, 7))) return 'proximos7';
  return 'depois';
}

/** Dias de calendário locais entre o prazo da etapa e a data de publicação. */
export function margemOf(scheduledAt: string | null, prazoDate: Date | null): FilaMargem {
  if (!prazoDate) return { kind: 'sem_prazo' };
  if (!scheduledAt) return { kind: 'sem_data' };
  const publica = new Date(scheduledAt);
  if (isNaN(publica.getTime())) return { kind: 'sem_data' };
  const dias = dayDiff(publica, prazoDate);
  return dias <= 0 ? { kind: 'sem_margem', dias } : { kind: 'dias', dias };
}
```

- [ ] **Step 4: Run the tests and the dashboard agenda suite**

```bash
npx vitest run apps/crm/src/pages/entregas/__tests__/etapaPrazo.test.ts apps/crm/src/pages/entregas/__tests__/minhaFila.test.ts apps/crm/src/pages/dashboard/__tests__/todayAgenda.test.ts apps/crm/src/pages/dashboard/components/__tests__/TodayCard.test.tsx
npx tsc -p apps/crm/tsconfig.json --noEmit
```

Expected: all four files PASS; `tsc` clean.

- [ ] **Step 5: Commit**

```bash
git add apps/crm/src/pages/entregas/etapaPrazo.ts apps/crm/src/pages/dashboard/todayAgenda.ts apps/crm/src/pages/entregas/minhaFila.ts apps/crm/src/pages/entregas/__tests__/etapaPrazo.test.ts apps/crm/src/pages/entregas/__tests__/minhaFila.test.ts
git commit -m "feat(entregas): buckets e margem da Minha fila + helpers de dia em etapaPrazo

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: `buildMinhaFila` (inclusion, grouping, ordering, Chegando)

Spec: § Regras de inclusão, § Ordenação e agrupamento (Grupos), § Chegando, § Arquitetura (Novos: `minhaFila.ts`).

**Files:**
- Modify: `apps/crm/src/pages/entregas/minhaFila.ts` (append builder + types).
- Test: `apps/crm/src/pages/entregas/__tests__/minhaFila.test.ts` (append).

**Interfaces:**
- Consumes: `postStageOf(card, entity): PostStage | undefined` (`postStage.ts:37`), `ASSIGNEE_PENDING_POST_STATUSES` (`store/posts.ts:571`), `deadlineFromPrazoEfetivo(prazoEfetivo, fallbackDias, now)` (`etapaPrazo.ts:89`), `BoardCard` (`hooks/useEntregasData.ts:32`), `PostEntity` (`boardEntity.ts:45`), `ActivePost` (`store/posts.ts`).
- Produces:

```ts
export interface FilaItem {
  key: `post:${number}`;
  post: ActivePost;
  origem: 'etapa' | 'responsavel';
  stage: PostStage | undefined;
  card: BoardCard | undefined;
  entity: PostEntity | undefined;
  prazoDate: Date | null;
  deadline: DeadlineInfo;
  /** 'etapa' = prazo da etapa; 'publicacao' = fallback por scheduled_at (origem
   *  'responsavel' sem etapa com prazo); null = sem prazo nenhum. */
  prazoOrigem: 'etapa' | 'publicacao' | null;
  bucket: FilaBucket;
  margem: FilaMargem;
}
export interface FilaGroup {
  key: `fluxo:${number}` | `post:${number}`;
  kind: 'fluxo' | 'post';
  card?: BoardCard;
  prazoDate: Date | null;
  deadline: DeadlineInfo;
  items: FilaItem[];
}
export interface FilaSection { bucket: FilaBucket; groups: FilaGroup[]; count: number }
export interface ChegandoItem {
  key: `post:${number}`;
  post: ActivePost;
  card: BoardCard | undefined;
  entity: PostEntity | undefined;
  etapaAtual: string;
  responsavelAtual: string;
  chegaDate: Date | null;
  proximaEtapa: string;
}
export interface MinhaFilaInput { cards: BoardCard[]; posts: ActivePost[]; postEntities: PostEntity[] }
export interface MinhaFila {
  items: FilaItem[];
  top: FilaItem | null;
  sections: FilaSection[];
  chegando: ChegandoItem[];
  counts: { total: number; atrasados: number };
}
export const EMPTY_FILA: MinhaFila;
export function compareScheduledAt(a: { scheduled_at: string | null; id: number }, b: { scheduled_at: string | null; id: number }): number;
export function nextEtapaOf(card: BoardCard | undefined, entity: PostEntity | undefined): { nome: string; responsavelId: number | null } | null;
export function nextEtapaResponsavel(card: BoardCard | undefined, entity: PostEntity | undefined): number | null;
export function buildMinhaFila(input: MinhaFilaInput, membroId: number, now: Date): MinhaFila;
```

- [ ] **Step 1: Write the failing tests**

Append to `apps/crm/src/pages/entregas/__tests__/minhaFila.test.ts`. Extend the import from `'../minhaFila'` with `buildMinhaFila, compareScheduledAt, nextEtapaResponsavel` and add these imports after it:

```ts
import { toPostEntity } from '../boardEntity';
import type { BoardCard } from '../hooks/useEntregasData';
import type { ActivePost, PostProcessWithPost, WorkflowEtapa } from '../../../store';
```

Then append:

```ts
// ── Fixtures ────────────────────────────────────────────────────────────────

const ME = 7;
const OTHER = 9;
const iso = (n: number, h = 9) => day(n, h).toISOString();
/** 'YYYY-MM-DD' local, the etapa data_limite format. */
const ymd = (n: number) => {
  const d = day(n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

function post(id: number, over: Partial<ActivePost> = {}): ActivePost {
  return {
    id,
    workflow_id: null,
    cliente_id: 1,
    cliente_nome: 'Cliente A',
    workflow_titulo: null,
    titulo: `Post ${id}`,
    tipo: 'feed',
    status: 'rascunho',
    custom_status_id: null,
    scheduled_at: null,
    published_at: null,
    ig_caption: null,
    instagram_permalink: null,
    publish_error: null,
    publish_error_code: null,
    ordem: 0,
    responsavel_id: null,
    platform: 'instagram',
    tiktok_publish_status: null,
    tiktok_publish_error: null,
    tiktok_post_url: null,
    instagram_media_id: null,
    ig_trial_strategy: null,
    board_ordem: null,
    ...over,
  } as ActivePost;
}

function etapa(over: Partial<WorkflowEtapa> & { workflow_id: number; ordem: number }): WorkflowEtapa {
  return {
    id: over.workflow_id * 100 + over.ordem,
    nome: `Etapa ${over.ordem}`,
    prazo_dias: 2,
    tipo_prazo: 'corridos',
    responsavel_id: null,
    tipo: 'padrao',
    status: over.ordem === 0 ? 'ativo' : 'pendente',
    iniciado_em: null,
    concluido_em: null,
    data_limite: null,
    ...over,
  };
}

/** Fluxo card: etapa ativa `ordem 0` com data_limite `dataLimiteDias` dias a
 *  partir de hoje (null = sem prazo), responsável `resp`; etapa seguinte com
 *  responsável `nextResp`. `deadline` é passado explícito porque getDeadlineInfo
 *  lê o relógio real. */
function card(opts: {
  wf: number;
  titulo?: string;
  resp: number | null;
  nextResp?: number | null;
  dataLimiteDias?: number | null;
  deadline?: DeadlineInfo;
}): BoardCard {
  const ativa = etapa({
    workflow_id: opts.wf,
    ordem: 0,
    nome: 'Design',
    responsavel_id: opts.resp,
    data_limite: opts.dataLimiteDias == null ? null : ymd(opts.dataLimiteDias),
  });
  const proxima = etapa({
    workflow_id: opts.wf,
    ordem: 1,
    nome: 'Revisão',
    responsavel_id: opts.nextResp ?? null,
  });
  return {
    workflow: {
      id: opts.wf,
      titulo: opts.titulo ?? `Fluxo ${opts.wf}`,
      cliente_id: 1,
      status: 'ativo',
      etapa_atual: 0,
    },
    etapa: ativa,
    cliente: { id: 1, nome: 'Cliente A' },
    membro: opts.resp === ME ? { id: ME, nome: 'Eu' } : undefined,
    deadline: opts.deadline ?? (opts.dataLimiteDias == null ? { ...OK, diasRestantes: 2 } : OK),
    totalEtapas: 2,
    etapaIdx: 0,
    allEtapas: [ativa, proxima],
  } as unknown as BoardCard;
}

/** Processo individual de um avulso: step ativa `ordem 0` (prazo_efetivo em
 *  `prazoDias` dias, null = sem prazo) com responsável `resp`; step seguinte
 *  `estado` (default pendente) com responsável `nextResp`. */
function processo(opts: {
  postId: number;
  resp: number | null;
  nextResp?: number | null;
  nextEstado?: 'pendente' | 'ignorado';
  prazoDias?: number | null;
}): PostProcessWithPost {
  const step = (ordem: number, extra: Record<string, unknown>) => ({
    id: opts.postId * 10 + ordem,
    conta_id: 'c',
    process_id: opts.postId,
    ordem,
    nome: ordem === 0 ? 'Copy' : 'Arte',
    tipo: 'padrao',
    responsavel_id: null,
    prazo_dias: null,
    tipo_prazo: null,
    prazo_efetivo: null,
    estado: 'pendente',
    iniciado_em: null,
    concluido_em: null,
    interrompido_em: null,
    origem_etapa_ordem: null,
    origem_etapa_nome: null,
    ...extra,
  });
  return {
    id: opts.postId,
    conta_id: 'c',
    post_id: opts.postId,
    template_id: null,
    template_nome: null,
    assinatura: '',
    origem_workflow_id: null,
    origem_descricao: null,
    estado: 'ativo',
    motivo_encerramento: null,
    etapa_atual: 0,
    modo_prazo: 'padrao',
    board_position: 0,
    revisao: 1,
    created_by: null,
    created_at: '2026-09-10T00:00:00Z',
    updated_at: '2026-09-10T00:00:00Z',
    concluido_em: null,
    steps: [
      step(0, {
        estado: 'ativo',
        responsavel_id: opts.resp,
        prazo_efetivo: opts.prazoDias == null ? null : iso(opts.prazoDias),
      }),
      step(1, { estado: opts.nextEstado ?? 'pendente', responsavel_id: opts.nextResp ?? null }),
    ],
    post: post(opts.postId),
  } as unknown as PostProcessWithPost;
}

const entityOf = (p: PostProcessWithPost) => toPostEntity(p, { clientes: [], membros: [] })!;

const ids = (fila: ReturnType<typeof buildMinhaFila>) => fila.items.map((i) => i.post.id);

// ── Inclusão ────────────────────────────────────────────────────────────────

describe('buildMinhaFila: inclusão', () => {
  it('etapa de fluxo comigo inclui os posts do fluxo, menos agendado e postado', () => {
    const c = card({ wf: 1, resp: ME, dataLimiteDias: 1 });
    const fila = buildMinhaFila(
      {
        cards: [c],
        posts: [
          post(1, { workflow_id: 1 }),
          post(2, { workflow_id: 1, status: 'agendado' }),
          post(3, { workflow_id: 1, status: 'postado' }),
          post(4, { workflow_id: 1, status: 'aprovado_cliente' }),
        ],
        postEntities: [],
      },
      ME,
      NOW,
    );
    expect(ids(fila)).toEqual([1, 4]);
    expect(fila.items.every((i) => i.origem === 'etapa')).toBe(true);
  });

  it('avulso com processo cuja step ativa é minha entra como etapa', () => {
    const p = processo({ postId: 5, resp: ME, prazoDias: 1 });
    const fila = buildMinhaFila(
      { cards: [], posts: [p.post], postEntities: [entityOf(p)] },
      ME,
      NOW,
    );
    expect(ids(fila)).toEqual([5]);
    expect(fila.items[0].origem).toBe('etapa');
    expect(fila.items[0].stage?.etapaNome).toBe('Copy');
  });

  it('responsável pelo post entra só nos quatro status pendentes', () => {
    const posts: ActivePost[] = [
      post(1, { responsavel_id: ME, status: 'rascunho' }),
      post(2, { responsavel_id: ME, status: 'revisao_interna' }),
      post(3, { responsavel_id: ME, status: 'correcao_cliente' }),
      post(4, { responsavel_id: ME, status: 'falha_publicacao' }),
      post(5, { responsavel_id: ME, status: 'aprovado_interno' }),
      post(6, { responsavel_id: ME, status: 'enviado_cliente' }),
      post(7, { responsavel_id: ME, status: 'aprovado_cliente' }),
      post(8, { responsavel_id: OTHER, status: 'rascunho' }),
    ];
    const fila = buildMinhaFila({ cards: [], posts, postEntities: [] }, ME, NOW);
    expect(ids(fila).sort()).toEqual([1, 2, 3, 4]);
    expect(fila.items.every((i) => i.origem === 'responsavel')).toBe(true);
  });

  it('post que casa nas duas regras aparece uma vez, como etapa', () => {
    const c = card({ wf: 1, resp: ME, dataLimiteDias: 1 });
    const fila = buildMinhaFila(
      { cards: [c], posts: [post(1, { workflow_id: 1, responsavel_id: ME })], postEntities: [] },
      ME,
      NOW,
    );
    expect(ids(fila)).toEqual([1]);
    expect(fila.items[0].origem).toBe('etapa');
  });

  it('status customizado com canônico postado sai (a coluna status já é o behaves_as)', () => {
    const c = card({ wf: 1, resp: ME, dataLimiteDias: 1 });
    const fila = buildMinhaFila(
      {
        cards: [c],
        posts: [post(1, { workflow_id: 1, status: 'postado', custom_status_id: 'abc' })],
        postEntities: [],
      },
      ME,
      NOW,
    );
    expect(ids(fila)).toEqual([]);
  });
});

// ── Prazo, bucket e fallback ────────────────────────────────────────────────

describe('buildMinhaFila: prazo da linha', () => {
  it('linha de etapa usa o prazo da etapa (bucket pela data, chip de margem por scheduled_at)', () => {
    const c = card({ wf: 1, resp: ME, dataLimiteDias: 1 });
    const fila = buildMinhaFila(
      { cards: [c], posts: [post(1, { workflow_id: 1, scheduled_at: iso(3) })], postEntities: [] },
      ME,
      NOW,
    );
    const item = fila.items[0];
    expect(item.bucket).toBe('amanha');
    expect(item.prazoOrigem).toBe('etapa');
    expect(item.margem).toEqual({ kind: 'dias', dias: 2 });
  });

  it('etapa de fluxo sem data (não iniciada) cai em sem_prazo mesmo com diasRestantes no fallback', () => {
    const c = card({ wf: 1, resp: ME, dataLimiteDias: null, deadline: { ...OK, diasRestantes: 5 } });
    const fila = buildMinhaFila(
      { cards: [c], posts: [post(1, { workflow_id: 1 })], postEntities: [] },
      ME,
      NOW,
    );
    expect(fila.items[0].bucket).toBe('sem_prazo');
    expect(fila.items[0].prazoDate).toBeNull();
    expect(fila.items[0].margem).toEqual({ kind: 'sem_prazo' });
  });

  it('responsável sem etapa cai em scheduled_at: bucket pela publicação, chip de margem omitido', () => {
    const fila = buildMinhaFila(
      {
        cards: [],
        posts: [
          post(1, { responsavel_id: ME, scheduled_at: iso(2) }),
          post(2, { responsavel_id: ME, scheduled_at: iso(-1) }),
          post(3, { responsavel_id: ME }),
        ],
        postEntities: [],
      },
      ME,
      NOW,
    );
    const by = (id: number) => fila.items.find((i) => i.post.id === id)!;
    expect(by(1).bucket).toBe('proximos7');
    expect(by(1).prazoOrigem).toBe('publicacao');
    expect(by(1).margem).toEqual({ kind: 'sem_prazo' });
    expect(by(2).bucket).toBe('atrasado');
    expect(by(2).deadline.estourado).toBe(true);
    expect(by(3).bucket).toBe('sem_prazo');
    expect(by(3).prazoOrigem).toBeNull();
  });

  it('responsável de um post cuja etapa (de outro membro) tem prazo usa o prazo da etapa', () => {
    const c = card({ wf: 1, resp: OTHER, dataLimiteDias: 0 });
    const fila = buildMinhaFila(
      {
        cards: [c],
        posts: [post(1, { workflow_id: 1, responsavel_id: ME, scheduled_at: iso(9) })],
        postEntities: [],
      },
      ME,
      NOW,
    );
    expect(fila.items[0].origem).toBe('responsavel');
    expect(fila.items[0].prazoOrigem).toBe('etapa');
    expect(fila.items[0].bucket).toBe('hoje');
    expect(fila.sections[1].groups[0].kind).toBe('fluxo');
  });
});

// ── Grupos e ordem ──────────────────────────────────────────────────────────

describe('buildMinhaFila: grupos e ordem', () => {
  it('posts do mesmo fluxo ficam num grupo, ordenados por scheduled_at nulls last e id', () => {
    const c = card({ wf: 1, resp: ME, dataLimiteDias: 1 });
    const fila = buildMinhaFila(
      {
        cards: [c],
        posts: [
          post(3, { workflow_id: 1 }),
          post(2, { workflow_id: 1, scheduled_at: iso(5) }),
          post(1, { workflow_id: 1, scheduled_at: iso(4) }),
          post(4, { workflow_id: 1 }),
        ],
        postEntities: [],
      },
      ME,
      NOW,
    );
    const amanha = fila.sections.find((s) => s.bucket === 'amanha')!;
    expect(amanha.groups).toHaveLength(1);
    expect(amanha.groups[0].key).toBe('fluxo:1');
    expect(amanha.groups[0].items.map((i) => i.post.id)).toEqual([1, 2, 3, 4]);
    expect(amanha.count).toBe(4);
    expect(ids(fila)).toEqual([1, 2, 3, 4]);
  });

  it('grupos ordenam por prazo asc (null último), depois menor scheduled_at, depois título', () => {
    const a = card({ wf: 1, titulo: 'Zeta', resp: ME, dataLimiteDias: 3 });
    const b = card({ wf: 2, titulo: 'Alfa', resp: ME, dataLimiteDias: 3 });
    const c = card({ wf: 3, titulo: 'Beta', resp: ME, dataLimiteDias: 2 });
    const fila = buildMinhaFila(
      {
        cards: [a, b, c],
        posts: [
          post(10, { workflow_id: 1, scheduled_at: iso(4) }),
          post(20, { workflow_id: 2, scheduled_at: iso(6) }),
          post(30, { workflow_id: 3 }),
          post(40, { responsavel_id: ME, scheduled_at: iso(5) }),
          post(50, { responsavel_id: ME }),
        ],
        postEntities: [],
      },
      ME,
      NOW,
    );
    const p7 = fila.sections.find((s) => s.bucket === 'proximos7')!;
    expect(p7.groups.map((g) => g.key)).toEqual(['fluxo:3', 'fluxo:1', 'fluxo:2', 'post:40']);
    expect(fila.sections.find((s) => s.bucket === 'sem_prazo')!.groups.map((g) => g.key)).toEqual([
      'post:50',
    ]);
  });

  it('sections sempre traz as 6 na ordem, top é items[0] e counts batem', () => {
    const c = card({ wf: 1, resp: ME, dataLimiteDias: 1, deadline: LATE });
    const fila = buildMinhaFila(
      {
        cards: [c],
        posts: [post(1, { workflow_id: 1 }), post(2, { responsavel_id: ME, scheduled_at: iso(0) })],
        postEntities: [],
      },
      ME,
      NOW,
    );
    expect(fila.sections.map((s) => s.bucket)).toEqual(FILA_BUCKET_ORDER);
    expect(fila.top).toBe(fila.items[0]);
    expect(fila.top?.post.id).toBe(1);
    expect(fila.counts).toEqual({ total: 2, atrasados: 1 });
    const empty = buildMinhaFila({ cards: [], posts: [], postEntities: [] }, ME, NOW);
    expect(empty.top).toBeNull();
    expect(empty.sections.every((s) => s.count === 0)).toBe(true);
  });

  it('compareScheduledAt: asc, nulls last, id como desempate', () => {
    const rows = [
      { id: 3, scheduled_at: null },
      { id: 2, scheduled_at: iso(1) },
      { id: 1, scheduled_at: iso(1) },
      { id: 4, scheduled_at: iso(0) },
    ];
    expect([...rows].sort(compareScheduledAt).map((r) => r.id)).toEqual([4, 1, 2, 3]);
  });
});

// ── Chegando ────────────────────────────────────────────────────────────────

describe('buildMinhaFila: chegando', () => {
  it('próxima etapa do fluxo minha entra em chegando com etapa atual, responsável e chegaDate', () => {
    const c = card({ wf: 1, resp: OTHER, nextResp: ME, dataLimiteDias: 1 });
    const fila = buildMinhaFila(
      { cards: [c], posts: [post(1, { workflow_id: 1 })], postEntities: [] },
      ME,
      NOW,
    );
    expect(ids(fila)).toEqual([]);
    expect(fila.chegando).toHaveLength(1);
    expect(fila.chegando[0]).toMatchObject({
      etapaAtual: 'Design',
      responsavelAtual: '',
      proximaEtapa: 'Revisão',
    });
    expect(fila.chegando[0].chegaDate?.getDate()).toBe(day(1).getDate());
  });

  it('step pendente seguinte minha entra; step ignorado depois da ativa é pulada', () => {
    const ok = processo({ postId: 5, resp: OTHER, nextResp: ME, prazoDias: null });
    const skip = processo({ postId: 6, resp: OTHER, nextResp: ME, nextEstado: 'ignorado' });
    const fila = buildMinhaFila(
      {
        cards: [],
        posts: [ok.post, skip.post],
        postEntities: [entityOf(ok), entityOf(skip)],
      },
      ME,
      NOW,
    );
    expect(fila.chegando.map((c) => c.post.id)).toEqual([5]);
    expect(fila.chegando[0].chegaDate).toBeNull();
    expect(nextEtapaResponsavel(undefined, entityOf(skip))).toBeNull();
  });

  it('post já na fila e post agendado não entram em chegando', () => {
    const mine = card({ wf: 1, resp: ME, nextResp: ME, dataLimiteDias: 1 });
    const later = card({ wf: 2, resp: OTHER, nextResp: ME, dataLimiteDias: 1 });
    const fila = buildMinhaFila(
      {
        cards: [mine, later],
        posts: [post(1, { workflow_id: 1 }), post(2, { workflow_id: 2, status: 'agendado' })],
        postEntities: [],
      },
      ME,
      NOW,
    );
    expect(ids(fila)).toEqual([1]);
    expect(fila.chegando).toEqual([]);
  });

  it('ordena por scheduled_at, depois chegaDate, ambos nulls last, depois id', () => {
    const soon = card({ wf: 1, resp: OTHER, nextResp: ME, dataLimiteDias: 1 });
    const late = card({ wf: 2, resp: OTHER, nextResp: ME, dataLimiteDias: 4 });
    const none = card({ wf: 3, resp: OTHER, nextResp: ME, dataLimiteDias: null });
    const fila = buildMinhaFila(
      {
        cards: [soon, late, none],
        posts: [
          post(1, { workflow_id: 3 }),
          post(2, { workflow_id: 2 }),
          post(3, { workflow_id: 1 }),
          post(4, { workflow_id: 3, scheduled_at: iso(9) }),
          post(5, { workflow_id: 2, scheduled_at: iso(2) }),
        ],
        postEntities: [],
      },
      ME,
      NOW,
    );
    expect(fila.chegando.map((c) => c.post.id)).toEqual([5, 4, 3, 2, 1]);
  });
});
```

- [ ] **Step 2: Run the test and watch it fail**

```bash
npx vitest run apps/crm/src/pages/entregas/__tests__/minhaFila.test.ts
```

Expected: `SyntaxError: The requested module '../minhaFila' does not provide an export named 'buildMinhaFila'`.

- [ ] **Step 3: Implement**

In `apps/crm/src/pages/entregas/minhaFila.ts`, replace the first import line with:

```ts
import type { ActivePost } from '../../store';
import { ASSIGNEE_PENDING_POST_STATUSES } from '../../store';
import type { BoardCard } from './hooks/useEntregasData';
import type { PostEntity } from './boardEntity';
import { postStageOf, type PostStage } from './postStage';
import {
  addDays,
  dayDiff,
  dayNum,
  deadlineFromPrazoEfetivo,
  type DeadlineInfo,
} from './etapaPrazo';
```

Append at the end of the file:

```ts
// ── Tipos ───────────────────────────────────────────────────────────────────

export interface FilaItem {
  key: `post:${number}`;
  post: ActivePost;
  /** 'etapa': a etapa ativa em que o post está é minha. 'responsavel': só o
   *  workflow_posts.responsavel_id é meu (num status pendente para a equipe). */
  origem: 'etapa' | 'responsavel';
  /** postStageOf(card, entity); undefined para avulso sem processo. */
  stage: PostStage | undefined;
  /** Card do fluxo quando o post é amarrado (cabeçalho do grupo, onFluxoClick). */
  card: BoardCard | undefined;
  entity: PostEntity | undefined;
  prazoDate: Date | null;
  deadline: DeadlineInfo;
  /** 'etapa' = prazo da etapa; 'publicacao' = fallback por scheduled_at (origem
   *  'responsavel' sem etapa com prazo); null = sem prazo nenhum. */
  prazoOrigem: 'etapa' | 'publicacao' | null;
  bucket: FilaBucket;
  margem: FilaMargem;
}

export interface FilaGroup {
  key: `fluxo:${number}` | `post:${number}`;
  kind: 'fluxo' | 'post';
  /** Só em kind 'fluxo'. */
  card?: BoardCard;
  prazoDate: Date | null;
  deadline: DeadlineInfo;
  items: FilaItem[];
}

export interface FilaSection {
  bucket: FilaBucket;
  groups: FilaGroup[];
  count: number;
}

export interface ChegandoItem {
  key: `post:${number}`;
  post: ActivePost;
  card: BoardCard | undefined;
  entity: PostEntity | undefined;
  etapaAtual: string;
  /** '' quando a etapa atual não tem responsável. */
  responsavelAtual: string;
  /** prazoDate da etapa ATUAL: quando ela vence, o post chega. */
  chegaDate: Date | null;
  proximaEtapa: string;
}

export interface MinhaFilaInput {
  cards: BoardCard[];
  posts: ActivePost[];
  postEntities: PostEntity[];
}

export interface MinhaFila {
  /** Lista plana na ordem final (seção -> grupo -> filho). */
  items: FilaItem[];
  /** items[0]. */
  top: FilaItem | null;
  /** Sempre as 6, na ordem de FILA_BUCKET_ORDER. */
  sections: FilaSection[];
  chegando: ChegandoItem[];
  counts: { total: number; atrasados: number };
}

/** Estável: a página passa isto enquanto a vista não é a fila. */
export const EMPTY_FILA: MinhaFila = {
  items: [],
  top: null,
  sections: FILA_BUCKET_ORDER.map((bucket) => ({ bucket, groups: [], count: 0 })),
  chegando: [],
  counts: { total: 0, atrasados: 0 },
};

// ── Helpers ─────────────────────────────────────────────────────────────────

const PENDING_FOR_ASSIGNEE = ASSIGNEE_PENDING_POST_STATUSES as readonly string[];

/** Mesma ordem de compareScheduledAtAscNullsLast (store/posts.ts): scheduled_at
 *  asc, nulls por último, id como desempate. */
export function compareScheduledAt(
  a: { scheduled_at: string | null; id: number },
  b: { scheduled_at: string | null; id: number },
): number {
  if (a.scheduled_at == null && b.scheduled_at == null) return a.id - b.id;
  if (a.scheduled_at == null) return 1;
  if (b.scheduled_at == null) return -1;
  if (a.scheduled_at < b.scheduled_at) return -1;
  if (a.scheduled_at > b.scheduled_at) return 1;
  return a.id - b.id;
}

/** Só scheduled_at, nulls por último; 0 quando iguais (ou ambos nulos). */
function compareScheduledOnly(a: string | null, b: string | null): number {
  if (a == null && b == null) return 0;
  if (a == null) return 1;
  if (b == null) return -1;
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * Próxima etapa depois da ativa. Fluxo: primeira com ordem maior, sem olhar
 * status (revertEtapa devolve a etapa que deixa para 'pendente', então tudo
 * depois da ativa é pendente). Processo: primeira pendente com ordem maior
 * (ignorado/herdado ficam antes da ativa; o filtro protege contra estados
 * futuros).
 */
export function nextEtapaOf(
  card: BoardCard | undefined,
  entity: PostEntity | undefined,
): { nome: string; responsavelId: number | null } | null {
  if (card) {
    const next = [...card.allEtapas]
      .sort((a, b) => a.ordem - b.ordem)
      .find((e) => e.ordem > card.etapa.ordem);
    return next ? { nome: next.nome, responsavelId: next.responsavel_id ?? null } : null;
  }
  if (entity) {
    const next = [...entity.process.steps]
      .sort((a, b) => a.ordem - b.ordem)
      .find((s) => s.ordem > entity.step.ordem && s.estado === 'pendente');
    return next ? { nome: next.nome, responsavelId: next.responsavel_id } : null;
  }
  return null;
}

export function nextEtapaResponsavel(
  card: BoardCard | undefined,
  entity: PostEntity | undefined,
): number | null {
  return nextEtapaOf(card, entity)?.responsavelId ?? null;
}

function makeItem(
  post: ActivePost,
  origem: FilaItem['origem'],
  stage: PostStage | undefined,
  card: BoardCard | undefined,
  entity: PostEntity | undefined,
  now: Date,
): FilaItem {
  let prazoDate: Date | null;
  let deadline: DeadlineInfo;
  let prazoOrigem: FilaItem['prazoOrigem'];
  if (stage && stage.prazoDate) {
    prazoDate = stage.prazoDate;
    deadline = stage.deadline;
    prazoOrigem = 'etapa';
  } else if (origem === 'responsavel' && post.scheduled_at) {
    // deadlineFromPrazoEfetivo é a única fábrica de DeadlineInfo a partir de um
    // instante; semântica de instante (publicou-deveria-ter e não publicou).
    prazoDate = new Date(post.scheduled_at);
    deadline = deadlineFromPrazoEfetivo(post.scheduled_at, null, now);
    prazoOrigem = 'publicacao';
  } else {
    prazoDate = null;
    deadline = stage ? stage.deadline : deadlineFromPrazoEfetivo(null, null, now);
    prazoOrigem = null;
  }
  const bucket = filaBucketOf(prazoDate, deadline, now);
  // Prazo = a própria publicação: margem seria zero por definição; chip omitido.
  const margem: FilaMargem =
    prazoOrigem === 'publicacao' ? { kind: 'sem_prazo' } : margemOf(post.scheduled_at, prazoDate);
  return {
    key: `post:${post.id}`,
    post,
    origem,
    stage,
    card,
    entity,
    prazoDate,
    deadline,
    prazoOrigem,
    bucket,
    margem,
  };
}

/** Um post amarrado agrupa pelo fluxo sempre que o prazo NÃO veio do fallback
 *  de publicação (mesmo sem prazo: os posts de um fluxo sem data ficam juntos
 *  em "Sem prazo"). Avulsos, com ou sem processo, ficam soltos. */
function groupKeyOf(item: FilaItem): FilaGroup['key'] {
  return item.card && item.prazoOrigem !== 'publicacao'
    ? `fluxo:${item.card.workflow.id!}`
    : `post:${item.post.id}`;
}

function groupTitle(g: FilaGroup): string {
  return g.card ? g.card.workflow.titulo : g.items[0].post.titulo;
}

/** prazo asc (null último) -> menor scheduled_at dos filhos (já ordenados) ->
 *  título. */
function compareGroups(a: FilaGroup, b: FilaGroup): number {
  const ad = a.prazoDate?.getTime() ?? Infinity;
  const bd = b.prazoDate?.getTime() ?? Infinity;
  if (ad !== bd) return ad - bd;
  const bySched = compareScheduledOnly(a.items[0].post.scheduled_at, b.items[0].post.scheduled_at);
  if (bySched !== 0) return bySched;
  return groupTitle(a).localeCompare(groupTitle(b), 'pt-BR');
}

/** scheduled_at asc (nulls last); sem publicação nos dois, chegaDate asc
 *  (nulls last); depois id. */
function compareChegando(a: ChegandoItem, b: ChegandoItem): number {
  const as = a.post.scheduled_at;
  const bs = b.post.scheduled_at;
  if (as != null || bs != null) {
    const c = compareScheduledOnly(as, bs);
    if (c !== 0) return c;
  } else {
    const ad = a.chegaDate?.getTime() ?? Infinity;
    const bd = b.chegaDate?.getTime() ?? Infinity;
    if (ad !== bd) return ad - bd;
  }
  return a.post.id - b.post.id;
}

// ── Builder ─────────────────────────────────────────────────────────────────

/**
 * Um loop sobre os posts (spec § Regras de inclusão): a etapa em que o post
 * está vem de postStageOf exatamente como filteredPosts de EntregasPage a lê
 * (card só para amarrado, entity só para avulso). agendado/postado saem antes
 * de tudo; a regra da etapa vence a do responsável; quem não entrou na fila
 * ainda pode entrar em Chegando pela próxima etapa.
 */
export function buildMinhaFila(input: MinhaFilaInput, membroId: number, now: Date): MinhaFila {
  const cardsByWorkflowId = new Map<number, BoardCard>();
  for (const c of input.cards) if (c.workflow.id != null) cardsByWorkflowId.set(c.workflow.id, c);
  const postEntityByPostId = new Map<number, PostEntity>();
  for (const e of input.postEntities) postEntityByPostId.set(e.process.post_id, e);

  const raw: FilaItem[] = [];
  const chegando: ChegandoItem[] = [];
  for (const post of input.posts) {
    if (post.status === 'agendado' || post.status === 'postado') continue;
    const card = post.workflow_id != null ? cardsByWorkflowId.get(post.workflow_id) : undefined;
    const entity = post.workflow_id == null ? postEntityByPostId.get(post.id) : undefined;
    const stage = postStageOf(card, entity);

    let origem: FilaItem['origem'] | null = null;
    if (stage && stage.responsavelId === membroId) origem = 'etapa';
    else if (post.responsavel_id === membroId && PENDING_FOR_ASSIGNEE.includes(post.status))
      origem = 'responsavel';

    if (origem) {
      raw.push(makeItem(post, origem, stage, card, entity, now));
      continue;
    }
    if (!stage) continue;
    const next = nextEtapaOf(card, entity);
    if (next && next.responsavelId === membroId) {
      chegando.push({
        key: `post:${post.id}`,
        post,
        card,
        entity,
        etapaAtual: stage.etapaNome,
        responsavelAtual: stage.responsavelNome,
        chegaDate: stage.prazoDate,
        proximaEtapa: next.nome,
      });
    }
  }

  const sections: FilaSection[] = FILA_BUCKET_ORDER.map((bucket) => {
    const groups = new Map<FilaGroup['key'], FilaGroup>();
    for (const item of raw) {
      if (item.bucket !== bucket) continue;
      const key = groupKeyOf(item);
      let group = groups.get(key);
      if (!group) {
        const isFluxo = key.startsWith('fluxo:');
        group = {
          key,
          kind: isFluxo ? 'fluxo' : 'post',
          card: isFluxo ? item.card : undefined,
          prazoDate: item.prazoDate,
          deadline: item.deadline,
          items: [],
        };
        groups.set(key, group);
      }
      group.items.push(item);
    }
    const sorted = [...groups.values()];
    for (const g of sorted) g.items.sort((a, b) => compareScheduledAt(a.post, b.post));
    sorted.sort(compareGroups);
    return { bucket, groups: sorted, count: sorted.reduce((n, g) => n + g.items.length, 0) };
  });

  const items = sections.flatMap((s) => s.groups.flatMap((g) => g.items));
  chegando.sort(compareChegando);

  return {
    items,
    top: items[0] ?? null,
    sections,
    chegando,
    counts: {
      total: items.length,
      atrasados: sections[0].count,
    },
  };
}
```

- [ ] **Step 4: Run the tests**

```bash
npx vitest run apps/crm/src/pages/entregas/__tests__/minhaFila.test.ts
npx tsc -p apps/crm/tsconfig.json --noEmit
```

Expected: PASS (all describes); `tsc` clean.

- [ ] **Step 5: Commit**

```bash
git add apps/crm/src/pages/entregas/minhaFila.ts apps/crm/src/pages/entregas/__tests__/minhaFila.test.ts
git commit -m "feat(entregas): buildMinhaFila com inclusão, grupos, ordem e Chegando

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: `viewQuery` learns `view=fila` and `membro=`

Spec: § UX (Aba), § Arquitetura (Modificados: `viewQuery.ts`, `VistasTabs.tsx`), § Membro selecionado (serialization rules only; the page-side reconciliation is Task 6).

**Files:**
- Modify: `apps/crm/src/pages/entregas/viewQuery.ts` (lines 9, 17, 20-27, 37-42, 63-65, 102).
- Modify: `apps/crm/src/pages/entregas/components/VistasTabs.tsx` (lines 3, 17-23).
- Modify: `apps/crm/src/pages/entregas/EntregasPage.tsx` (line 432-440: add `filaMembro: null` so the page compiles; Task 6 wires the real value).
- Test: `apps/crm/src/pages/entregas/__tests__/viewQuery.test.ts`.

**Interfaces:**
- Consumes: nothing new.
- Produces:
  - `export type ActiveView = 'kanban' | 'chart' | 'calendar' | 'list' | 'concluded' | 'fila'`
  - `EntregasViewState.filaMembro: number | null` (explicit member for `view === 'fila'`; `null` = the logged-in user)
  - `serializeEntregasQuery` writes `membro=<id>` only when `view === 'fila'` and `filaMembro != null`; `parseEntregasQuery` returns `filaMembro` only when `view === 'fila'` and the value is a valid integer, else `null`.

- [ ] **Step 1: Write the failing tests**

In `apps/crm/src/pages/entregas/__tests__/viewQuery.test.ts`, add `filaMembro: null` to the three literal state objects that already exist (the `serializes the default state` call, the `state` in `round-trips a fully loaded state`, and the `state` in `round-trips custom status keys`): `parseEntregasQuery` will now always return the key, and `toEqual` treats a missing key and `null` as different. Then append inside the `describe('viewQuery', ...)` block:

```ts
  it('round-trips view=fila with an explicit membro', () => {
    const state = {
      view: 'fila' as const,
      mode: 'entregas' as const,
      entidade: 'fluxos' as const,
      filaMembro: 12,
      filters: EMPTY_FILTERS,
    };
    const qs = serializeEntregasQuery(state);
    expect(qs).toBe('view=fila&membro=12');
    expect(parseEntregasQuery(new URLSearchParams(qs))).toEqual(state);
  });

  it('omits membro for the own fila (null) and ignores it outside view=fila', () => {
    expect(
      serializeEntregasQuery({
        view: 'fila',
        mode: 'entregas',
        entidade: 'fluxos',
        filaMembro: null,
        filters: EMPTY_FILTERS,
      }),
    ).toBe('view=fila');
    expect(
      serializeEntregasQuery({
        view: 'kanban',
        mode: 'entregas',
        entidade: 'fluxos',
        filaMembro: 12,
        filters: EMPTY_FILTERS,
      }),
    ).toBe('');
    expect(parseEntregasQuery(new URLSearchParams('view=list&membro=12')).filaMembro).toBeNull();
  });

  it('drops a malformed membro', () => {
    expect(parseEntregasQuery(new URLSearchParams('view=fila&membro=abc')).filaMembro).toBeNull();
    expect(parseEntregasQuery(new URLSearchParams('view=fila&membro=')).filaMembro).toBeNull();
    expect(parseEntregasQuery(new URLSearchParams('view=fila')).filaMembro).toBeNull();
  });
```

- [ ] **Step 2: Run the test and watch it fail**

```bash
npx vitest run apps/crm/src/pages/entregas/__tests__/viewQuery.test.ts
```

Expected: `round-trips view=fila with an explicit membro` fails with `expected '' to be 'view=fila&membro=12'` (unknown view falls back to kanban; `membro` is not serialized).

- [ ] **Step 3: Implement**

`apps/crm/src/pages/entregas/viewQuery.ts`:

Line 9:

```ts
export type ActiveView = 'kanban' | 'chart' | 'calendar' | 'list' | 'concluded' | 'fila';
```

Line 17:

```ts
const VIEWS: readonly ActiveView[] = ['kanban', 'chart', 'calendar', 'list', 'concluded', 'fila'];
```

Lines 20-27 (`EntregasViewState`):

```ts
export interface EntregasViewState {
  view: ActiveView;
  /** Mode of the ACTIVE view (only meaningful for kanban/calendar/list). */
  mode: EntregasMode;
  /** Only meaningful for kanban/list in mode 'entregas'. */
  entidade: EntidadeFilter;
  /** Only meaningful for view 'fila': the member chosen EXPLICITLY in the
   *  picker. null = the logged-in user's own fila, which is what a URL or a
   *  saved vista without `membro=` means for whoever opens it. */
  filaMembro: number | null;
  filters: FilterState;
}
```

After line 41 (`if (state.entidade !== 'fluxos') ...`) in `serializeEntregasQuery`:

```ts
  if (state.view === 'fila' && state.filaMembro != null) p.set('membro', String(state.filaMembro));
```

In `parseEntregasQuery`, after the `entidade` block (line 70) add:

```ts
  const rawMembro = p.get('membro');
  const parsedMembro = rawMembro ? parseInt(rawMembro, 10) : NaN;
  const filaMembro = view === 'fila' && !isNaN(parsedMembro) ? parsedMembro : null;
```

and change the return (line 102) to `return { view, mode, entidade, filaMembro, filters };`.

`apps/crm/src/pages/entregas/components/VistasTabs.tsx`: add `ListChecks` to the lucide import on line 3 and the entry in `VIEW_ICONS` (line 17-23):

```ts
  concluded: <Archive className="h-3.5 w-3.5" />,
  fila: <ListChecks className="h-3.5 w-3.5" />,
```

`apps/crm/src/pages/entregas/EntregasPage.tsx` line 432-440, add the key to the object passed to `serializeEntregasQuery` (right after `mode: activeMode,`):

```ts
    // Task 6 substitui pelo estado real do seletor de membro.
    filaMembro: null,
```

- [ ] **Step 4: Run the tests and typecheck**

```bash
npx vitest run apps/crm/src/pages/entregas/__tests__/viewQuery.test.ts apps/crm/src/pages/entregas/components/__tests__/VistasTabs.test.tsx apps/crm/src/pages/entregas/__tests__/EntregasPage.test.tsx
npx tsc -p apps/crm/tsconfig.json --noEmit
```

Expected: PASS; `tsc` clean (a missing `VIEW_ICONS.fila` would fail here with `Property 'fila' is missing in type`).

- [ ] **Step 5: Commit**

```bash
git add apps/crm/src/pages/entregas/viewQuery.ts apps/crm/src/pages/entregas/__tests__/viewQuery.test.ts apps/crm/src/pages/entregas/components/VistasTabs.tsx apps/crm/src/pages/entregas/EntregasPage.tsx
git commit -m "feat(entregas): view=fila e membro= na query de Entregas

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Hook refactors (`buildBoardCards`, `fetchEtapasMap`, `isError`, `EMPTY_POSTS`, `useCurrentMembro` flags)

Spec: § Teaser (Custo de dados: "Armadilha da chave compartilhada"), § Estados (Dependências obrigatórias), § Arquitetura (Modificados: `useEntregasData.ts`, `useActivePosts.ts`, `hooks/useCurrentMembro.ts`).

**Files:**
- Modify: `apps/crm/src/pages/entregas/hooks/useEntregasData.ts` (lines 232-239, 255-267, 411-454, 479, 489-511).
- Modify: `apps/crm/src/pages/entregas/hooks/useActivePosts.ts` (whole file, 28 lines).
- Modify: `apps/crm/src/hooks/useCurrentMembro.ts` (whole file, 14 lines).
- Test: `apps/crm/src/pages/entregas/hooks/__tests__/useEntregasData.test.ts` (append), create `apps/crm/src/pages/entregas/hooks/__tests__/useActivePosts.test.ts`, create `apps/crm/src/hooks/__tests__/useCurrentMembro.test.tsx`.

**Interfaces:**
- Consumes: `getAllActiveEtapas`, `getDeadlineInfo`, `getWorkflowCovers`, `buildUsableTokenMap`, `getWorkspaceSlug` (already imported in the hook).
- Produces (in `useEntregasData.ts`):
  - `export async function fetchEtapasMap(): Promise<Map<number, WorkflowEtapa[]>>` (the exact `queryFn` of `['all-active-etapas']`, so any other observer of that key shares the same cached shape)
  - `export interface BoardCardExtras { covers?: Map<number, PostMedia[]>; clienteAvatars?: Map<number, string>; hubTokens?: Map<number, string>; workspaceSlug?: string | null }`
  - `export function buildBoardCards(activeWorkflows: Workflow[], etapasMap: Map<number, WorkflowEtapa[]>, clientes: Cliente[], membros: Membro[], extras?: BoardCardExtras): BoardCard[]`
  - `useEntregasData()` return gains `isError: boolean` (`workflows || all-active-etapas || post-processes` query errors).
- Produces (in `useActivePosts.ts`): `useActivePosts(enabled: boolean): { posts: ActivePost[]; isLoading: boolean; isError: boolean }` with a module-level `EMPTY_POSTS` so `posts` is referentially stable while unresolved.
- Produces (in `useCurrentMembro.ts`): `useCurrentMembro(): { membro: Membro | null; isLoading: boolean; isError: boolean; isSuccess: boolean }`.

- [ ] **Step 1: Write the failing tests**

Append to `apps/crm/src/pages/entregas/hooks/__tests__/useEntregasData.test.ts` (add `buildBoardCards, fetchEtapasMap` to the import from `'../useEntregasData'` at the top of the file):

```ts
describe('buildBoardCards / fetchEtapasMap', () => {
  const clientes = [{ id: 10, nome: 'Cliente A' }] as any[];
  const membros = [{ id: 7, nome: 'Ana' }] as any[];
  const wf = (id: number, etapa_atual = 0) =>
    ({ id, cliente_id: 10, titulo: `WF-${id}`, status: 'ativo', etapa_atual }) as any;
  const et = (workflow_id: number, ordem: number, status: 'ativo' | 'pendente') =>
    ({
      id: workflow_id * 10 + ordem,
      workflow_id,
      ordem,
      nome: `E${ordem}`,
      prazo_dias: 2,
      tipo_prazo: 'corridos',
      status,
      responsavel_id: 7,
    }) as WorkflowEtapa;

  it('uses the ativo etapa, resolves cliente and membro, and skips a workflow without etapas', () => {
    const map = new Map<number, WorkflowEtapa[]>([[1, [et(1, 0, 'pendente'), et(1, 1, 'ativo')]]]);
    const cards = buildBoardCards([wf(1), wf(2)], map, clientes, membros);
    expect(cards).toHaveLength(1);
    expect(cards[0].etapa.ordem).toBe(1);
    expect(cards[0].etapaIdx).toBe(1);
    expect(cards[0].totalEtapas).toBe(2);
    expect(cards[0].cliente?.nome).toBe('Cliente A');
    expect(cards[0].membro?.nome).toBe('Ana');
    expect(cards[0].hubUrl).toBeUndefined();
  });

  it('falls back to etapas[etapa_atual] when no etapa is ativo', () => {
    const map = new Map<number, WorkflowEtapa[]>([[1, [et(1, 0, 'pendente'), et(1, 1, 'pendente')]]]);
    const cards = buildBoardCards([wf(1, 1)], map, clientes, membros);
    expect(cards[0].etapa.ordem).toBe(1);
  });

  it('builds hubUrl only with both a token and a slug', () => {
    const map = new Map<number, WorkflowEtapa[]>([[1, [et(1, 0, 'ativo')]]]);
    const withBoth = buildBoardCards([wf(1)], map, clientes, membros, {
      hubTokens: new Map([[10, 'tok']]),
      workspaceSlug: 'agencia',
    });
    expect(withBoth[0].hubUrl).toBe(`${window.location.origin}/agencia/hub/tok`);
    const noSlug = buildBoardCards([wf(1)], map, clientes, membros, {
      hubTokens: new Map([[10, 'tok']]),
      workspaceSlug: null,
    });
    expect(noSlug[0].hubUrl).toBeUndefined();
  });

  it('fetchEtapasMap groups getAllActiveEtapas rows by workflow_id', async () => {
    const map = await fetchEtapasMap();
    expect([...map.keys()].sort()).toEqual([1, 2]);
    expect(map.get(1)?.[0].id).toBe(100);
  });
});

describe('useEntregasData: isError', () => {
  it('is false while everything resolves and true when workflows fail', async () => {
    const { useEntregasData } = await import('../useEntregasData');
    const store = await import('../../../../store');

    const ok = renderHook(() => useEntregasData(), { wrapper: createWrapper().Wrapper });
    await waitFor(() => expect(ok.result.current.isLoading).toBe(false));
    expect(ok.result.current.isError).toBe(false);

    (store.getWorkflows as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('boom'));
    const failed = renderHook(() => useEntregasData(), { wrapper: createWrapper().Wrapper });
    await waitFor(() => expect(failed.result.current.isError).toBe(true));
  });
});
```

Create `apps/crm/src/pages/entregas/hooks/__tests__/useActivePosts.test.ts`:

```ts
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement, type ReactNode } from 'react';

const store = vi.hoisted(() => ({ getActivePosts: vi.fn() }));
vi.mock('../../../../store', () => store);
vi.mock('../../../../lib/supabase');

import { useActivePosts } from '../useActivePosts';

function wrapper() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return ({ children }: { children: ReactNode }) =>
    createElement(QueryClientProvider, { client }, children);
}

describe('useActivePosts', () => {
  beforeEach(() => {
    store.getActivePosts.mockReset();
  });

  it('does not fetch while disabled and serves a stable empty array', () => {
    const { result, rerender } = renderHook(() => useActivePosts(false), { wrapper: wrapper() });
    const before = result.current.posts;
    expect(before).toEqual([]);
    expect(result.current.isLoading).toBe(false);
    expect(result.current.isError).toBe(false);
    rerender();
    expect(result.current.posts).toBe(before);
    expect(store.getActivePosts).not.toHaveBeenCalled();
  });

  it('reports isError when the fetch rejects', async () => {
    store.getActivePosts.mockRejectedValue(new Error('boom'));
    const { result } = renderHook(() => useActivePosts(true), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.posts).toEqual([]);
  });

  it('returns the posts once resolved', async () => {
    store.getActivePosts.mockResolvedValue([{ id: 1, status: 'rascunho', scheduled_at: null }]);
    const { result } = renderHook(() => useActivePosts(true), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.posts).toHaveLength(1));
    expect(result.current.isError).toBe(false);
  });
});
```

Create `apps/crm/src/hooks/__tests__/useCurrentMembro.test.tsx`:

```tsx
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React, { type ReactNode } from 'react';

const store = vi.hoisted(() => ({ getMembros: vi.fn() }));
vi.mock('@/store', () => store);
vi.mock('@/context/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'user-1' } }),
}));

import { useCurrentMembro } from '../useCurrentMembro';

function wrapper() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
}

describe('useCurrentMembro', () => {
  beforeEach(() => {
    store.getMembros.mockReset();
  });

  it('resolves the membro linked by crm_user_id and reports isSuccess', async () => {
    store.getMembros.mockResolvedValue([
      { id: 1, nome: 'Outra', crm_user_id: 'user-2' },
      { id: 7, nome: 'Eu', crm_user_id: 'user-1' },
    ]);
    const { result } = renderHook(() => useCurrentMembro(), { wrapper: wrapper() });
    expect(result.current.isSuccess).toBe(false);
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.membro?.id).toBe(7);
    expect(result.current.isError).toBe(false);
  });

  it('returns null membro with isSuccess when nobody is linked', async () => {
    store.getMembros.mockResolvedValue([{ id: 1, nome: 'Outra', crm_user_id: null }]);
    const { result } = renderHook(() => useCurrentMembro(), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.membro).toBeNull();
  });

  it('reports isError when getMembros rejects', async () => {
    store.getMembros.mockRejectedValue(new Error('boom'));
    const { result } = renderHook(() => useCurrentMembro(), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.isSuccess).toBe(false);
    expect(result.current.membro).toBeNull();
  });
});
```

- [ ] **Step 2: Run the tests and watch them fail**

```bash
npx vitest run apps/crm/src/pages/entregas/hooks/__tests__/useEntregasData.test.ts apps/crm/src/pages/entregas/hooks/__tests__/useActivePosts.test.ts apps/crm/src/hooks/__tests__/useCurrentMembro.test.tsx
```

Expected: `useEntregasData.test.ts` fails with `does not provide an export named 'buildBoardCards'`; `useActivePosts.test.ts` fails on `expect(result.current.isError).toBe(false)` (`undefined`); `useCurrentMembro.test.tsx` fails on `expect(result.current.isSuccess).toBe(true)` (`undefined`).

- [ ] **Step 3: Implement**

`apps/crm/src/pages/entregas/hooks/useEntregasData.ts`:

Replace lines 232-239 (the `workflows` query destructuring) with:

```ts
  const wfQuery = useQuery({
    queryKey: ['workflows'],
    queryFn: getWorkflows,
  });
  const workflows: Workflow[] = wfQuery.data ?? EMPTY_WORKFLOWS;
  const loadingWf = wfQuery.isLoading;
  const fetchingWf = wfQuery.isFetching;
```

Replace lines 255-267 (`etapasQuery`) with:

```ts
  const etapasQuery = useQuery({
    queryKey: ['all-active-etapas'],
    queryFn: fetchEtapasMap,
  });
```

Replace lines 411-454 (the `cards` `useMemo`) with:

```ts
  const cards: BoardCard[] = useMemo(
    () =>
      buildBoardCards(activeWorkflows, etapasMap, clientes, membros, {
        covers,
        clienteAvatars,
        hubTokens,
        workspaceSlug,
      }),
    [activeWorkflows, etapasMap, clientes, membros, covers, clienteAvatars, hubTokens, workspaceSlug],
  );
```

After line 479 (`const isLoading = ...`) add:

```ts
  /** Erro em qualquer dependência obrigatória da fila (spec Minha fila § Estados).
   *  Só a vista fila lê isto; as demais vistas mantêm o comportamento atual. */
  const isError = wfQuery.isError || etapasQuery.isError || vigenteQuery.isError;
```

and add `isError,` to the returned object right after `isFetching,` (line 509).

Insert, before `export interface UseEntregasDataOptions` (line 220), the two extracted functions:

```ts
/**
 * queryFn de ['all-active-etapas']: linhas -> Map por workflow_id. Exportado
 * porque o cache do TanStack é por chave, não por observer: quem mais observar
 * esta chave (useMinhaFilaData no Dashboard) PRECISA usar esta mesma função,
 * senão o primeiro a montar decide a forma e o outro consumidor quebra.
 */
export async function fetchEtapasMap(): Promise<Map<number, WorkflowEtapa[]>> {
  const rows = await getAllActiveEtapas();
  const map = new Map<number, WorkflowEtapa[]>();
  for (const row of rows) {
    const list = map.get(row.workflow_id);
    if (list) list.push(row);
    else map.set(row.workflow_id, [row]);
  }
  return map;
}

export interface BoardCardExtras {
  covers?: Map<number, PostMedia[]>;
  clienteAvatars?: Map<number, string>;
  hubTokens?: Map<number, string>;
  workspaceSlug?: string | null;
}

/**
 * Cards do quadro a partir dos fluxos ativos e do mapa de etapas. Puro: a
 * página (via useMemo) e o teaser do Dashboard (sem capas/tokens) chamam a
 * mesma função. `getDeadlineInfo` lê o relógio, então um card é tão fresco
 * quanto a última chamada.
 */
export function buildBoardCards(
  activeWorkflows: Workflow[],
  etapasMap: Map<number, WorkflowEtapa[]>,
  clientes: Cliente[],
  membros: Membro[],
  extras: BoardCardExtras = {},
): BoardCard[] {
  const { covers, clienteAvatars, hubTokens, workspaceSlug } = extras;
  const out: BoardCard[] = [];
  for (const w of activeWorkflows) {
    const etapas = etapasMap.get(w.id!) || [];
    let activeEtapa = etapas.find((e) => e.status === 'ativo');
    if (!activeEtapa && etapas.length > 0) {
      activeEtapa = etapas[w.etapa_atual] || etapas[0];
    }
    if (!activeEtapa) continue;
    const cliente = clientes.find((c) => c.id === w.cliente_id);
    const membro = activeEtapa.responsavel_id
      ? membros.find((m) => m.id === activeEtapa!.responsavel_id)
      : undefined;
    const deadline = getDeadlineInfo(activeEtapa);
    const hubToken = w.cliente_id ? hubTokens?.get(w.cliente_id) : undefined;
    const hubUrl =
      hubToken && workspaceSlug
        ? `${window.location.origin}/${workspaceSlug}/hub/${hubToken}`
        : undefined;
    out.push({
      workflow: w,
      etapa: activeEtapa,
      cliente,
      membro,
      deadline,
      totalEtapas: etapas.length,
      etapaIdx: activeEtapa.ordem,
      allEtapas: etapas,
      postCovers: covers?.get(w.id!),
      clienteAvatarUrl: w.cliente_id ? clienteAvatars?.get(w.cliente_id) : undefined,
      hubUrl,
    });
  }
  return out;
}
```

`apps/crm/src/pages/entregas/hooks/useActivePosts.ts` (whole file):

```ts
import { useQuery } from '@tanstack/react-query';
import { getActivePosts, type ActivePost } from '../../../store';
import { getPostPublishState } from '../postLabels';

/** Estável enquanto a query não resolveu: um `?? []` novo a cada render
 *  invalidaria todo useMemo que lê `posts` (mesmo aviso de useEntregasData). */
const EMPTY_POSTS: ActivePost[] = [];

/**
 * Every post of every active workflow (scheduled or not), for the Kanban/Lista
 * "Publicações" modes, the "Sem processo" section and the "Minha fila" view.
 *
 * `enabled` MUST be passed explicitly: EntregasPage mounts this hook regardless
 * of the active view/mode, so mounting alone does not gate the fetch. Pass
 * true only while one of those consumers is actually visible.
 */
export function useActivePosts(enabled: boolean) {
  const query = useQuery({
    queryKey: ['active-posts'],
    queryFn: getActivePosts,
    enabled,
    // While any post is mid-publishing (agendado + scheduled time passed), poll so
    // the board flips to "Postado" on its own. Stops once nothing is publishing.
    refetchInterval: (query) =>
      (query.state.data ?? []).some((p) => getPostPublishState(p) === 'publicando') ? 15000 : false,
  });

  return {
    posts: query.data ?? EMPTY_POSTS,
    isLoading: query.isLoading,
    isError: query.isError,
  };
}
```

`apps/crm/src/hooks/useCurrentMembro.ts` (whole file):

```ts
import { useQuery } from '@tanstack/react-query';
import { getMembros, type Membro } from '@/store';
import { useAuth } from '@/context/AuthContext';

/**
 * Resolves the membro row linked to the logged-in user via membros.crm_user_id.
 * Returns null when the user has no linked membro (an admin links it in Equipe).
 * `isSuccess`/`isError` are the ['membros'] query's own flags: "no membro" only
 * means something once `isSuccess` is true (Minha fila reads them to know when
 * a `membro=<id>` deep link can be validated against the list).
 */
export function useCurrentMembro(): {
  membro: Membro | null;
  isLoading: boolean;
  isError: boolean;
  isSuccess: boolean;
} {
  const { user } = useAuth();
  const {
    data: membros,
    isLoading,
    isError,
    isSuccess,
  } = useQuery({ queryKey: ['membros'], queryFn: getMembros });
  const membro = user ? ((membros ?? []).find((m) => m.crm_user_id === user.id) ?? null) : null;
  return { membro, isLoading, isError, isSuccess };
}
```

- [ ] **Step 4: Run the tests and typecheck**

```bash
npx vitest run apps/crm/src/pages/entregas/hooks/__tests__ apps/crm/src/hooks/__tests__/useCurrentMembro.test.tsx apps/crm/src/pages/entregas/__tests__/EntregasPage.test.tsx apps/crm/src/pages/dashboard
npx tsc -p apps/crm/tsconfig.json --noEmit
```

Expected: PASS, including the pre-existing `keeps cards and the lookup maps stable across a re-render` case (the `useMemo` deps did not change); `tsc` clean.

- [ ] **Step 5: Commit**

```bash
git add apps/crm/src/pages/entregas/hooks/useEntregasData.ts apps/crm/src/pages/entregas/hooks/useActivePosts.ts apps/crm/src/hooks/useCurrentMembro.ts apps/crm/src/pages/entregas/hooks/__tests__/useEntregasData.test.ts apps/crm/src/pages/entregas/hooks/__tests__/useActivePosts.test.ts apps/crm/src/hooks/__tests__/useCurrentMembro.test.tsx
git commit -m "refactor(entregas): buildBoardCards, fetchEtapasMap e flags de erro nos hooks da fila

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: `MinhaFilaView` component + styles

Spec: § UX (Layout da vista, Responsivo, Copy), § Margem (chip), § Chegando (grouping in the view), § Estados (Vista column).

**Files:**
- Create: `apps/crm/src/pages/entregas/views/MinhaFilaView.tsx`.
- Modify: `apps/crm/style.css` (append a `.fila-*` block at the end of the file).
- Test: `apps/crm/src/pages/entregas/views/__tests__/MinhaFilaView.test.tsx`.

**Interfaces:**
- Consumes: `MinhaFila`, `FilaItem`, `FilaGroup`, `ChegandoItem`, `FILA_BUCKET_ORDER`, `FILA_BUCKET_LABELS`, `FilaBucket` (Task 2); `formatEtapaPrazo`, `formatEtapaDeadlineDay` (`etapaPrazo.ts:186,192`); `formatPostDate` (`utils/postDate.ts:19`); `PostStatusChip` (`components/PostStatusChip.tsx:24`); `TIPO_LABELS` (`postLabels.ts:4`); `StatusRegistry`; `Membro`, `ActivePost`; shadcn `Select`, `Spinner`.
- Produces:

```ts
export interface MinhaFilaViewProps {
  fila: MinhaFila;
  membros: Membro[];
  /** Membro efetivo (explícito ou o próprio). null = login sem membro e nada escolhido. */
  membroId: number | null;
  currentMembroId: number | null;
  registry: StatusRegistry;
  isLoading: boolean;
  isError: boolean;
  /** null = "o próprio usuário" (escolher a si mesmo no seletor). */
  onMembroChange: (membroId: number | null) => void;
  onPostClick: (post: ActivePost) => void;
  onFluxoClick: (workflowId: number) => void;
}
export function MinhaFilaView(props: MinhaFilaViewProps): JSX.Element;
```

- [ ] **Step 1: Write the failing test**

Create `apps/crm/src/pages/entregas/views/__tests__/MinhaFilaView.test.tsx`:

```tsx
import React from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../../../lib/supabase');

// Radix Select needs pointer/portal machinery jsdom lacks; render it as a
// native select (same shim as NovaIdeiaDialog.test.tsx).
vi.mock('@/components/ui/select', () => ({
  Select: ({
    value,
    onValueChange,
    children,
  }: {
    value: string;
    onValueChange: (v: string) => void;
    children: React.ReactNode;
  }) => (
    <select aria-label="Fila de" value={value} onChange={(e) => onValueChange(e.target.value)}>
      <option value="">Escolha um membro</option>
      {children}
    </select>
  ),
  SelectTrigger: () => null,
  SelectValue: () => null,
  SelectContent: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  SelectItem: ({ value, children }: { value: string; children: React.ReactNode }) => (
    <option value={value}>{children}</option>
  ),
}));

import { MinhaFilaView } from '../MinhaFilaView';
import { buildMinhaFila, EMPTY_FILA } from '../../minhaFila';
import { buildStatusRegistry } from '../../statusRegistry';
import type { BoardCard } from '../../hooks/useEntregasData';
import type { ActivePost, Membro, WorkflowEtapa } from '../../../../store';

const NOW = new Date(2026, 8, 23, 10, 0, 0);
const ME = 7;
const OTHER = 9;
const registry = buildStatusRegistry([]);
const membros = [
  { id: ME, nome: 'Ana Souza' },
  { id: OTHER, nome: 'Bruno Lima' },
] as Membro[];

const day = (n: number, h = 9) => new Date(2026, 8, 23 + n, h, 0, 0);
const iso = (n: number, h = 9) => day(n, h).toISOString();
const ymd = (n: number) => {
  const d = day(n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

function post(id: number, over: Partial<ActivePost> = {}): ActivePost {
  return {
    id,
    workflow_id: null,
    cliente_id: 1,
    cliente_nome: 'Dra. Marina',
    workflow_titulo: null,
    titulo: `Post ${id}`,
    tipo: 'feed',
    status: 'rascunho',
    custom_status_id: null,
    scheduled_at: null,
    published_at: null,
    ig_caption: null,
    instagram_permalink: null,
    publish_error: null,
    publish_error_code: null,
    ordem: 0,
    responsavel_id: null,
    platform: 'instagram',
    tiktok_publish_status: null,
    tiktok_publish_error: null,
    tiktok_post_url: null,
    instagram_media_id: null,
    ig_trial_strategy: null,
    board_ordem: null,
    ...over,
  } as ActivePost;
}

function card(opts: {
  wf: number;
  resp: number | null;
  nextResp?: number | null;
  dataLimiteDias: number | null;
  estourado?: boolean;
}): BoardCard {
  const mk = (ordem: number, nome: string, responsavel_id: number | null): WorkflowEtapa => ({
    id: opts.wf * 100 + ordem,
    workflow_id: opts.wf,
    ordem,
    nome,
    prazo_dias: 2,
    tipo_prazo: 'corridos',
    responsavel_id,
    tipo: 'padrao',
    status: ordem === 0 ? 'ativo' : 'pendente',
    iniciado_em: null,
    concluido_em: null,
    data_limite: ordem === 0 && opts.dataLimiteDias != null ? ymd(opts.dataLimiteDias) : null,
  });
  const ativa = mk(0, 'Design', opts.resp);
  const proxima = mk(1, 'Revisão', opts.nextResp ?? null);
  return {
    workflow: { id: opts.wf, titulo: `Fluxo ${opts.wf}`, cliente_id: 1, status: 'ativo', etapa_atual: 0 },
    etapa: ativa,
    cliente: { id: 1, nome: 'Dra. Marina' },
    membro: membros.find((m) => m.id === opts.resp),
    deadline: {
      diasRestantes: opts.estourado ? -1 : 2,
      horasRestantes: 0,
      estourado: opts.estourado ?? false,
      urgente: false,
    },
    totalEtapas: 2,
    etapaIdx: 0,
    allEtapas: [ativa, proxima],
  } as unknown as BoardCard;
}

/** Atrasado: fluxo 1 (2 posts) · Hoje: avulso responsável · Próximos 7: fluxo 3 ·
 *  Chegando: fluxo 4 (2 posts) + nada mais. */
function fixture() {
  return buildMinhaFila(
    {
      cards: [
        card({ wf: 1, resp: ME, dataLimiteDias: -1, estourado: true }),
        card({ wf: 3, resp: ME, dataLimiteDias: 3 }),
        card({ wf: 4, resp: OTHER, nextResp: ME, dataLimiteDias: 2 }),
      ],
      posts: [
        // Etapa do fluxo 1 venceu ontem: post 11 publica ontem (margem 0 = "sem
        // margem"), post 12 publica amanhã (margem 2d).
        post(11, { workflow_id: 1, titulo: 'Carrossel dia das mães', scheduled_at: iso(-1, 14) }),
        post(12, { workflow_id: 1, titulo: 'Reels bastidores', scheduled_at: iso(1, 10) }),
        post(20, { titulo: 'Post avulso X', responsavel_id: ME, scheduled_at: iso(0, 18) }),
        post(31, { workflow_id: 3, titulo: 'Stories evento', scheduled_at: iso(5) }),
        post(41, { workflow_id: 4, titulo: 'Chegando A', scheduled_at: iso(6) }),
        post(42, { workflow_id: 4, titulo: 'Chegando B' }),
      ],
      postEntities: [],
    },
    ME,
    NOW,
  );
}

function renderView(over: Partial<React.ComponentProps<typeof MinhaFilaView>> = {}) {
  const props = {
    fila: fixture(),
    membros,
    membroId: ME,
    currentMembroId: ME,
    registry,
    isLoading: false,
    isError: false,
    onMembroChange: vi.fn(),
    onPostClick: vi.fn(),
    onFluxoClick: vi.fn(),
    ...over,
  };
  return { ...render(<MinhaFilaView {...props} />), props };
}

describe('MinhaFilaView', () => {
  it('renders the six sections with counts and expands only Atrasado, Hoje and Amanhã', () => {
    renderView();
    const heads = screen.getAllByRole('button', { name: /\(\d+\)$/ });
    expect(heads.map((h) => h.textContent)).toEqual([
      'Atrasado (2)',
      'Hoje (1)',
      'Amanhã (0)',
      'Próximos 7 dias (1)',
      'Depois (0)',
      'Sem prazo (0)',
    ]);
    expect(screen.getByRole('button', { name: 'Atrasado (2)' })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
    expect(screen.getByRole('button', { name: 'Amanhã (0)' })).toHaveAttribute(
      'aria-disabled',
      'true',
    );
    // Collapsed by default: the row is not in the DOM until the header is clicked.
    expect(screen.queryByText('Stories evento')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Próximos 7 dias (1)' }));
    expect(screen.getByText('Stories evento')).toBeInTheDocument();
  });

  it('shows the summary and the "Comece por aqui" card with the first item', () => {
    renderView();
    expect(screen.getByTestId('fila-summary')).toHaveTextContent('4 posts · 2 atrasados');
    const top = screen.getByTestId('fila-top');
    expect(within(top).getByText('Comece por aqui')).toBeInTheDocument();
    expect(within(top).getByText('Carrossel dia das mães')).toBeInTheDocument();
    expect(within(top).getByText('Dra. Marina · Fluxo 1 · Design')).toBeInTheDocument();
    expect(within(top).getByText('sem margem')).toBeInTheDocument();
  });

  it('groups fluxo posts under a clickable header and marks assignee rows', () => {
    const { props } = renderView();
    // The "Comece por aqui" card carries the same context string; the group
    // header is the one that also announces the post count.
    const header = screen.getByRole('button', { name: /Dra\. Marina · Fluxo 1 · Design.*2 posts/ });
    fireEvent.click(header);
    expect(props.onFluxoClick).toHaveBeenCalledWith(1);

    // Avulso row (origem responsavel): assignee tag + second line; fluxo rows: no tag.
    const avulso = screen.getByRole('button', { name: /Post avulso X/ });
    expect(within(avulso).getByText('responsável pelo post')).toBeInTheDocument();
    expect(within(avulso).getByText('Dra. Marina')).toBeInTheDocument();
    const wired = screen.getAllByRole('button', { name: /Reels bastidores/ })[0];
    expect(within(wired).queryByText('responsável pelo post')).not.toBeInTheDocument();
    expect(within(wired).getByText('margem 2d')).toBeInTheDocument();

    fireEvent.click(wired);
    expect(props.onPostClick).toHaveBeenCalledWith(expect.objectContaining({ id: 12 }));
  });

  it('groups Chegando by fluxo, collapsed, with the current etapa and the arrival date', () => {
    renderView();
    expect(screen.getByText('Chegando')).toBeInTheDocument();
    const head = screen.getByRole('button', { name: /Fluxo 4 · agora em Design \(Bruno Lima\)/ });
    expect(head).toHaveTextContent('2 posts');
    expect(head).toHaveTextContent(/chega ~/);
    expect(screen.queryByText('Chegando A')).not.toBeInTheDocument();
    fireEvent.click(head);
    expect(screen.getByText('Chegando A')).toBeInTheDocument();
    expect(screen.getByText('Chegando B')).toBeInTheDocument();
  });

  it('changes the member through the picker; picking yourself emits null', () => {
    const { props } = renderView();
    const select = screen.getByLabelText('Fila de');
    fireEvent.change(select, { target: { value: String(OTHER) } });
    expect(props.onMembroChange).toHaveBeenLastCalledWith(OTHER);
    fireEvent.change(select, { target: { value: String(ME) } });
    expect(props.onMembroChange).toHaveBeenLastCalledWith(null);
  });

  it('renders loading, error, no-membro and the two empty states', () => {
    const { unmount: u1, container } = renderView({ isLoading: true, fila: EMPTY_FILA });
    expect(container.querySelector('.animate-spin')).not.toBeNull();
    expect(screen.queryByText(/Nada na sua fila/)).not.toBeInTheDocument();
    u1();

    const { unmount: u2 } = renderView({ isError: true, fila: EMPTY_FILA });
    expect(
      screen.getByText('Não foi possível carregar a fila. Recarregue a página.'),
    ).toBeInTheDocument();
    u2();

    const { unmount: u3 } = renderView({ membroId: null, currentMembroId: null, fila: EMPTY_FILA });
    expect(screen.getByText(/ainda não está vinculado a um membro da equipe/)).toBeInTheDocument();
    expect(screen.getByLabelText('Fila de')).toHaveValue('');
    u3();

    const { unmount: u4 } = renderView({ fila: EMPTY_FILA });
    expect(screen.getByText(/^Nada na sua fila\./)).toBeInTheDocument();
    u4();

    renderView({ fila: EMPTY_FILA, membroId: OTHER });
    expect(screen.getByText('Nada na fila de Bruno Lima.')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the test and watch it fail**

```bash
npx vitest run apps/crm/src/pages/entregas/views/__tests__/MinhaFilaView.test.tsx
```

Expected: `Failed to resolve import "../MinhaFilaView"`.

- [ ] **Step 3: Implement**

Create `apps/crm/src/pages/entregas/views/MinhaFilaView.tsx`:

```tsx
import { useMemo, useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Spinner } from '@/components/ui/spinner';
import type { ActivePost, Membro } from '../../../store';
import { formatPostDate } from '@/utils/postDate';
import { formatEtapaDeadlineDay, formatEtapaPrazo, type DeadlineInfo } from '../etapaPrazo';
import { TIPO_LABELS } from '../postLabels';
import { PostStatusChip } from '../components/PostStatusChip';
import type { StatusRegistry } from '../statusRegistry';
import {
  FILA_BUCKET_LABELS,
  type ChegandoItem,
  type FilaBucket,
  type FilaGroup,
  type FilaItem,
  type MinhaFila,
} from '../minhaFila';

export interface MinhaFilaViewProps {
  fila: MinhaFila;
  membros: Membro[];
  /** Membro efetivo (explícito ou o próprio). null = login sem membro e nada escolhido. */
  membroId: number | null;
  currentMembroId: number | null;
  registry: StatusRegistry;
  isLoading: boolean;
  isError: boolean;
  /** null = "o próprio usuário" (escolher a si mesmo no seletor). */
  onMembroChange: (membroId: number | null) => void;
  onPostClick: (post: ActivePost) => void;
  onFluxoClick: (workflowId: number) => void;
}

const OPEN_BY_DEFAULT: FilaBucket[] = ['atrasado', 'hoje', 'amanha'];

function prazoClass(deadline: DeadlineInfo): string {
  if (deadline.estourado) return 'deadline-overdue';
  if (deadline.urgente) return 'deadline-warning';
  return 'deadline-ok';
}

/** Chip de prazo só com data resolvida: sem ela o DeadlineInfo é um fallback
 *  (prazo_dias de uma etapa não iniciada, ou zerado) que leria "5d restantes". */
function PrazoChip({ prazoDate, deadline }: { prazoDate: Date | null; deadline: DeadlineInfo }) {
  if (!prazoDate) return null;
  return (
    <span className={`board-card-deadline ${prazoClass(deadline)}`}>
      {formatEtapaPrazo(deadline).label}
    </span>
  );
}

function MargemChip({ margem }: { margem: FilaItem['margem'] }) {
  if (margem.kind === 'sem_prazo' || margem.kind === 'sem_data') return null;
  if (margem.kind === 'sem_margem')
    return <span className="fila-margem fila-margem--sem">sem margem</span>;
  return (
    <span className={`fila-margem ${margem.dias <= 2 ? 'fila-margem--curta' : 'fila-margem--ok'}`}>
      margem {margem.dias}d
    </span>
  );
}

function publicaLabel(post: ActivePost): string {
  return post.scheduled_at ? `publica ${formatPostDate(post.scheduled_at)}` : 'sem data de publicação';
}

function joinDot(...parts: (string | null | undefined)[]): string {
  return parts.filter((p) => p && p.trim().length > 0).join(' · ');
}

/** Contexto de uma linha: onde o post está. Fluxo em grupo já tem cabeçalho,
 *  então a linha solta é que carrega cliente/fluxo/etapa. */
function rowContext(item: FilaItem, inGroup: boolean): string | null {
  if (inGroup) return null;
  if (item.entity) return joinDot(item.post.cliente_nome, 'Individual', item.stage?.etapaNome);
  if (item.card) return joinDot(item.post.cliente_nome, item.card.workflow.titulo);
  return item.post.cliente_nome || null;
}

function PostRow({
  item,
  inGroup,
  isTop,
  registry,
  onClick,
}: {
  item: FilaItem;
  inGroup: boolean;
  isTop: boolean;
  registry: StatusRegistry;
  onClick: () => void;
}) {
  const context = rowContext(item, inGroup);
  return (
    <button type="button" className={`fila-row${isTop ? ' is-top' : ''}`} onClick={onClick}>
      <span className="fila-row-main">
        <span className="fila-row-title">{item.post.titulo}</span>
        <span className="fila-tag">{TIPO_LABELS[item.post.tipo]}</span>
        <PostStatusChip post={item.post} registry={registry} />
        {item.origem === 'responsavel' && <span className="fila-tag">responsável pelo post</span>}
        {context && <span className="fila-row-sub">{context}</span>}
      </span>
      <span className="fila-row-meta">
        <span>{publicaLabel(item.post)}</span>
        <MargemChip margem={item.margem} />
      </span>
    </button>
  );
}

function GroupBlock({
  group,
  topKey,
  registry,
  onPostClick,
  onFluxoClick,
}: {
  group: FilaGroup;
  topKey: string | null;
  registry: StatusRegistry;
  onPostClick: (post: ActivePost) => void;
  onFluxoClick: (workflowId: number) => void;
}) {
  const rows = group.items.map((item) => (
    <PostRow
      key={item.key}
      item={item}
      inGroup={group.kind === 'fluxo'}
      isTop={item.key === topKey}
      registry={registry}
      onClick={() => onPostClick(item.post)}
    />
  ));
  if (group.kind !== 'fluxo' || !group.card) return <div className="fila-group">{rows}</div>;
  const card = group.card;
  const n = group.items.length;
  return (
    <div className="fila-group">
      <button
        type="button"
        className="fila-group-head"
        onClick={() => onFluxoClick(card.workflow.id!)}
      >
        <span>{joinDot(card.cliente?.nome, card.workflow.titulo, card.etapa.nome)}</span>
        <PrazoChip prazoDate={group.prazoDate} deadline={group.deadline} />
        <span className="fila-tag">{n === 1 ? '1 post' : `${n} posts`}</span>
      </button>
      {rows}
    </div>
  );
}

function ChegandoGroups({
  chegando,
  onPostClick,
}: {
  chegando: ChegandoItem[];
  onPostClick: (post: ActivePost) => void;
}) {
  // Agrupamento é da vista (spec § Chegando): o builder devolve a lista plana
  // ordenada; os filhos de um fluxo compartilham etapa atual e chegaDate.
  const groups = useMemo(() => {
    const out: { key: string; card: ChegandoItem['card']; items: ChegandoItem[] }[] = [];
    const byKey = new Map<string, (typeof out)[number]>();
    for (const item of chegando) {
      const key = item.card ? `fluxo:${item.card.workflow.id}` : item.key;
      let g = byKey.get(key);
      if (!g) {
        g = { key, card: item.card, items: [] };
        byKey.set(key, g);
        out.push(g);
      }
      g.items.push(item);
    }
    return out;
  }, [chegando]);
  const [open, setOpen] = useState<Set<string>>(() => new Set());
  const toggle = (key: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const agoraEm = (item: ChegandoItem) =>
    `agora em ${item.etapaAtual} (${item.responsavelAtual || 'sem responsável'})`;
  const chega = (item: ChegandoItem) =>
    item.chegaDate ? `chega ~${formatEtapaDeadlineDay(item.chegaDate)}` : 'sem previsão';

  return (
    <section className="fila-section" data-testid="fila-chegando">
      <h3 className="fila-section-title">Chegando</h3>
      <p className="fila-section-sub">Posts cuja próxima etapa é sua.</p>
      {groups.map((g) => {
        if (!g.card) {
          const item = g.items[0];
          return (
            <div key={g.key} className="fila-group">
              <button type="button" className="fila-row" onClick={() => onPostClick(item.post)}>
                <span className="fila-row-main">
                  <span className="fila-row-title">{item.post.titulo}</span>
                  <span className="fila-row-sub">
                    {joinDot(item.post.cliente_nome, item.entity ? 'Individual' : null, agoraEm(item))}
                  </span>
                </span>
                <span className="fila-row-meta">{chega(item)}</span>
              </button>
            </div>
          );
        }
        const first = g.items[0];
        const isOpen = open.has(g.key);
        const n = g.items.length;
        return (
          <div key={g.key} className="fila-group">
            <button
              type="button"
              className="fila-group-head"
              aria-expanded={isOpen}
              onClick={() => toggle(g.key)}
            >
              {isOpen ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
              <span>{joinDot(g.card.cliente?.nome, g.card.workflow.titulo, agoraEm(first))}</span>
              <span className="fila-row-meta">{chega(first)}</span>
              <span className="fila-tag">{n === 1 ? '1 post' : `${n} posts`}</span>
            </button>
            {isOpen &&
              g.items.map((item) => (
                <button
                  key={item.key}
                  type="button"
                  className="fila-row"
                  onClick={() => onPostClick(item.post)}
                >
                  <span className="fila-row-main">
                    <span className="fila-row-title">{item.post.titulo}</span>
                  </span>
                  <span className="fila-row-meta">{publicaLabel(item.post)}</span>
                </button>
              ))}
          </div>
        );
      })}
    </section>
  );
}

export function MinhaFilaView({
  fila,
  membros,
  membroId,
  currentMembroId,
  registry,
  isLoading,
  isError,
  onMembroChange,
  onPostClick,
  onFluxoClick,
}: MinhaFilaViewProps) {
  const [open, setOpen] = useState<Set<FilaBucket>>(() => new Set(OPEN_BY_DEFAULT));
  const toggle = (b: FilaBucket) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(b)) next.delete(b);
      else next.add(b);
      return next;
    });

  const isSelf = membroId != null && membroId === currentMembroId;
  const membroNome = membros.find((m) => m.id === membroId)?.nome ?? '';
  const { total, atrasados } = fila.counts;
  const topKey = fila.top?.key ?? null;
  const showBody = !isLoading && !isError && membroId != null;
  const empty = showBody && fila.items.length === 0;

  return (
    <div className="fila animate-up">
      <div className="fila-head">
        <span className="fila-head-label">Fila de</span>
        <div className="fila-head-select">
          <Select
            value={membroId != null ? String(membroId) : ''}
            onValueChange={(v) => {
              const id = parseInt(v, 10);
              if (isNaN(id)) return;
              onMembroChange(id === currentMembroId ? null : id);
            }}
          >
            <SelectTrigger className="h-8 rounded-full text-xs" aria-label="Fila de">
              <SelectValue placeholder="Escolha um membro" />
            </SelectTrigger>
            <SelectContent>
              {membros.map((m) => (
                <SelectItem key={m.id} value={String(m.id)}>
                  {m.nome}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {showBody && (
          <span className="fila-summary" data-testid="fila-summary">
            {`${total} ${total === 1 ? 'post' : 'posts'}`}
            {atrasados > 0 && (
              <span style={{ color: 'var(--danger)', fontWeight: 600 }}>
                {` · ${atrasados} ${atrasados === 1 ? 'atrasado' : 'atrasados'}`}
              </span>
            )}
          </span>
        )}
      </div>

      {isError && (
        <p className="fila-note">Não foi possível carregar a fila. Recarregue a página.</p>
      )}

      {!isError && isLoading && (
        <div style={{ textAlign: 'center', padding: '2rem' }}>
          <Spinner size="md" />
        </div>
      )}

      {!isError && !isLoading && membroId == null && (
        <p className="fila-note">
          Seu usuário ainda não está vinculado a um membro da equipe. Peça a um administrador
          para fazer o vínculo na página Equipe. Você ainda pode ver a fila de outra pessoa
          pelo seletor acima.
        </p>
      )}

      {empty && (
        <p className="fila-note">
          {isSelf
            ? 'Nada na sua fila. Quando uma etapa ou um post for atribuído a você, ele aparece aqui.'
            : `Nada na fila de ${membroNome}.`}
        </p>
      )}

      {showBody && fila.top && (
        <button
          type="button"
          className="fila-top"
          data-testid="fila-top"
          onClick={() => onPostClick(fila.top!.post)}
        >
          <span className="fila-top-label">Comece por aqui</span>
          <span className="fila-row-main">
            <span className="fila-row-title">{fila.top.post.titulo}</span>
            <span className="fila-row-sub">
              {joinDot(
                fila.top.post.cliente_nome,
                fila.top.card?.workflow.titulo ?? (fila.top.entity ? 'Individual' : null),
                fila.top.stage?.etapaNome,
              )}
            </span>
          </span>
          <span className="fila-row-meta">
            {fila.top.prazoDate && (
              <span>etapa vence {formatEtapaDeadlineDay(fila.top.prazoDate)}</span>
            )}
            <PrazoChip prazoDate={fila.top.prazoDate} deadline={fila.top.deadline} />
            <span>{publicaLabel(fila.top.post)}</span>
            <MargemChip margem={fila.top.margem} />
          </span>
        </button>
      )}

      {showBody &&
        fila.items.length > 0 &&
        fila.sections.map((section) => {
          const isOpen = section.count > 0 && open.has(section.bucket);
          const label = `${FILA_BUCKET_LABELS[section.bucket]} (${section.count})`;
          return (
            <section key={section.bucket} className="fila-section" data-bucket={section.bucket}>
              <button
                type="button"
                className={`fila-section-head${section.bucket === 'atrasado' && section.count > 0 ? ' is-danger' : ''}`}
                aria-expanded={isOpen}
                aria-disabled={section.count === 0}
                onClick={() => section.count > 0 && toggle(section.bucket)}
              >
                {isOpen ? (
                  <ChevronDown className="h-3.5 w-3.5" />
                ) : (
                  <ChevronRight className="h-3.5 w-3.5" />
                )}
                {label}
              </button>
              {isOpen &&
                section.groups.map((group) => (
                  <GroupBlock
                    key={group.key}
                    group={group}
                    topKey={topKey}
                    registry={registry}
                    onPostClick={onPostClick}
                    onFluxoClick={onFluxoClick}
                  />
                ))}
            </section>
          );
        })}

      {showBody && fila.chegando.length > 0 && (
        <ChegandoGroups chegando={fila.chegando} onPostClick={onPostClick} />
      )}
    </div>
  );
}
```

Append to the end of `apps/crm/style.css`:

```css
/* ── Minha fila (Entregas) ───────────────────────────────────────────────── */
.fila {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}
.fila-head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.75rem;
}
.fila-head-label {
  font-size: 0.8rem;
  color: var(--text-muted);
}
.fila-head-select {
  min-width: 220px;
}
.fila-summary {
  margin-left: auto;
  font-size: 0.8rem;
  color: var(--text-muted);
}
.fila-note {
  font-size: 0.85rem;
  color: var(--text-muted);
  max-width: 60ch;
}
.fila-top {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 0.35rem;
  width: 100%;
  text-align: left;
  padding: 0.9rem 1rem;
  border-radius: 12px;
  border: 1px solid var(--border-color);
  border-left: 3px solid var(--primary-color);
  background: var(--surface-1);
  color: inherit;
  font: inherit;
  cursor: pointer;
}
.fila-top-label {
  font-size: 0.68rem;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--text-muted);
}
.fila-section-title {
  margin: 0;
  font-size: 0.95rem;
  font-weight: 600;
}
.fila-section-sub {
  margin: 0 0 0.5rem;
  font-size: 0.78rem;
  color: var(--text-muted);
}
.fila-section-head {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  width: 100%;
  padding: 0.4rem 0;
  background: none;
  border: none;
  cursor: pointer;
  font-size: 0.72rem;
  font-weight: 700;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  color: var(--text-muted);
  text-align: left;
}
.fila-section-head[aria-disabled='true'] {
  cursor: default;
  opacity: 0.55;
}
.fila-section-head.is-danger {
  color: var(--danger-text);
}
.fila-group {
  border: 1px solid var(--border-color);
  border-radius: 10px;
  background: var(--card-bg);
  overflow: hidden;
}
.fila-group + .fila-group {
  margin-top: 0.5rem;
}
.fila-group-head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.5rem;
  width: 100%;
  padding: 0.5rem 0.75rem;
  background: var(--surface-hover);
  border: none;
  border-bottom: 1px solid var(--border-color);
  cursor: pointer;
  font-size: 0.78rem;
  font-weight: 600;
  color: var(--text-main);
  text-align: left;
}
.fila-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.5rem 0.75rem;
  width: 100%;
  padding: 0.55rem 0.75rem;
  background: none;
  border: none;
  border-bottom: 1px solid var(--border-color);
  cursor: pointer;
  text-align: left;
  color: inherit;
  font: inherit;
}
.fila-row:last-child {
  border-bottom: none;
}
.fila-row:hover {
  background: var(--surface-hover);
}
.fila-row.is-top {
  box-shadow: inset 3px 0 0 var(--primary-color);
}
.fila-row-main {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.4rem;
  flex: 1 1 260px;
  min-width: 0;
}
.fila-row-title {
  font-size: 0.85rem;
  font-weight: 500;
  color: var(--text-main);
}
.fila-row-sub {
  flex-basis: 100%;
  font-size: 0.72rem;
  color: var(--text-muted);
}
.fila-row-meta {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-size: 0.75rem;
  color: var(--text-muted);
  white-space: nowrap;
}
.fila-tag {
  font-size: 0.68rem;
  padding: 0.1rem 0.45rem;
  border-radius: 999px;
  border: 1px solid var(--border-color);
  color: var(--text-muted);
  white-space: nowrap;
}
.fila-margem {
  font-size: 0.7rem;
  font-weight: 600;
  padding: 0.15rem 0.5rem;
  border-radius: 999px;
  white-space: nowrap;
}
.fila-margem--sem {
  background: rgba(245, 90, 66, 0.16);
  color: var(--danger-text);
}
.fila-margem--curta {
  background: rgba(245, 163, 66, 0.2);
  color: var(--text-main);
}
.fila-margem--ok {
  background: rgba(62, 207, 142, 0.18);
  color: var(--text-main);
}
/* Abaixo do breakpoint da barra de filtros (min-[901px]) a data de
   publicação e a margem descem para uma segunda linha sob o título, e o
   seletor ocupa a largura toda. */
@media (max-width: 900px) {
  .fila-head-select {
    flex-basis: 100%;
  }
  .fila-row-meta {
    flex-basis: 100%;
    white-space: normal;
    flex-wrap: wrap;
  }
}
```

- [ ] **Step 4: Run the test, typecheck, format**

```bash
npx vitest run apps/crm/src/pages/entregas/views/__tests__/MinhaFilaView.test.tsx
npx tsc -p apps/crm/tsconfig.json --noEmit
npx prettier --check apps/crm/src/pages/entregas/views/MinhaFilaView.tsx apps/crm/style.css
```

Expected: PASS; `tsc` clean; prettier clean (run `npm run format` if not).

- [ ] **Step 5: Commit**

```bash
git add apps/crm/src/pages/entregas/views/MinhaFilaView.tsx apps/crm/src/pages/entregas/views/__tests__/MinhaFilaView.test.tsx apps/crm/style.css
git commit -m "feat(entregas): componente MinhaFilaView com seções, grupos, margem e Chegando

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Wire the tab into `EntregasPage` (gating, `filaMembro`, reconciliation, saved vistas, analytics)

Spec: § UX (Aba), § Arquitetura (Modificados: `EntregasPage.tsx`, `lib/analytics.ts`), § Membro selecionado, § Gating de dados na vista, § Estados (Vista column), § Analytics.

**Files:**
- Modify: `apps/crm/src/lib/analytics.ts` (line 29, the `AnalyticsEvent` union).
- Modify: `apps/crm/src/pages/entregas/EntregasPage.tsx` (imports 4-17, 53-59, 67; `VIEW_TABS` 105-111; state after line 184; `useEntregasData` destructure 227-246; `currentQuery` 432-440; `applySavedView` 696-704; `useActivePosts` 710-720; `showFilters` 731-732; new memo after `postEntityByPostId` 737-740; render after `ConcludedView` 1365-1374).
- Test: `apps/crm/src/pages/entregas/__tests__/EntregasPage.test.tsx`.

**Interfaces:**
- Consumes: `buildMinhaFila`, `EMPTY_FILA` (Task 2); `MinhaFilaView` (Task 5); `useCurrentMembro` with `isSuccess`/`isError` (Task 4); `useActivePosts(...).isError`, `useEntregasData().isError` (Task 4); `useStatusRegistry` (`hooks/useStatusRegistry.ts`); `captureEvent`.
- Produces:
  - `AnalyticsEvent` union += `'minha_fila_opened' | 'minha_fila_teaser_clicked'`.
  - Page state `filaMembro: number | null` (explicit pick; `null` = self), effective `filaMembroId = filaMembro ?? currentMembro?.id ?? null`.
  - Reconciliation effect: only once `useCurrentMembro().isSuccess`; an explicit `filaMembro` equal to the own id or absent from `membros` is reset to `null` (which the URL sync then drops).

- [ ] **Step 1: Write the failing tests**

In `apps/crm/src/pages/entregas/__tests__/EntregasPage.test.tsx`, add after the existing `vi.mock('@/hooks/useStatusRegistry', ...)` block (it already exists in this file, around line 505; `useStatusRegistry` needs no new mock):

```tsx
// useCurrentMembro reads getMembros from `@/store` (the same module the literal
// `../../../store` mock above replaces, without getMembros): stub the hook.
const currentMembroMock = vi.hoisted(() => ({
  membro: null as { id: number; nome: string } | null,
  isLoading: false,
  isError: false,
  isSuccess: true,
}));
vi.mock('@/hooks/useCurrentMembro', () => ({
  useCurrentMembro: () => ({ ...currentMembroMock }),
}));

vi.mock('../views/MinhaFilaView', () => ({
  MinhaFilaView: ({
    fila,
    membroId,
    currentMembroId,
    isLoading,
    isError,
    onMembroChange,
  }: {
    fila: { items: unknown[] };
    membroId: number | null;
    currentMembroId: number | null;
    isLoading: boolean;
    isError: boolean;
    onMembroChange: (id: number | null) => void;
  }) => (
    <div>
      <div>
        Fila view: membro {membroId ?? 'none'} / self {currentMembroId ?? 'none'}
      </div>
      <div>Fila state: {isError ? 'error' : isLoading ? 'loading' : 'ready'}</div>
      <div>Fila items: {fila.items.length}</div>
      <button onClick={() => onMembroChange(12)}>Pick member 12</button>
      <button onClick={() => onMembroChange(null)}>Pick self</button>
    </div>
  ),
}));
```

In the top-level `beforeEach` of `describe('EntregasPage', ...)` add, after `mockedUseActivePosts.mockReturnValue({ posts: [], isLoading: false });`:

```ts
    mockedUseActivePosts.mockReturnValue({ posts: [], isLoading: false, isError: false });
    currentMembroMock.membro = { id: 7, nome: 'Ana' };
    currentMembroMock.isLoading = false;
    currentMembroMock.isError = false;
    currentMembroMock.isSuccess = true;
```

(replace the original `mockReturnValue({ posts: [], isLoading: false })` line with the three-field one). Then append a new `describe` at the end of the file:

```tsx
describe('EntregasPage: Minha fila', () => {
  const membros = [
    { id: 7, nome: 'Ana' },
    { id: 12, nome: 'Bruno' },
  ];
  function renderFila(entry = '/entregas?view=fila', over: Record<string, unknown> = {}) {
    mockedUseEntregasData.mockReturnValue({
      clientes: [],
      membros,
      templates: [],
      cards: [makeCard()],
      activeWorkflows: [wfFixture],
      postEntities: [],
      processByPostId: new Map(),
      concludedPostProcesses: [],
      activePostProcessCount: 0,
      postProcessesVisible: false,
      isLoading: false,
      isError: false,
      refresh: vi.fn(),
      ...over,
    } as never);
    return renderPage(entry);
  }

  it('has the tab, hides toggles and filters, enables active-posts and writes view=fila', () => {
    renderFila('/entregas');
    fireEvent.click(screen.getByRole('tab', { name: 'Minha fila' }));
    expect(screen.getByText('Fila view: membro 7 / self 7')).toBeInTheDocument();
    expect(screen.getByText('Fila state: ready')).toBeInTheDocument();
    expect(screen.queryByText('Etapas')).not.toBeInTheDocument();
    expect(screen.queryByText('Posts individuais')).not.toBeInTheDocument();
    expect(screen.queryByText(/Filters:/)).not.toBeInTheDocument();
    expect(mockedUseActivePosts).toHaveBeenLastCalledWith(true);
    expect(screen.getByTestId('current-path')).toHaveTextContent(/^\/entregas\?view=fila$/);
  });

  it('keeps membro=12 from the URL once membros resolved and shows that member', () => {
    renderFila('/entregas?view=fila&membro=12');
    expect(screen.getByText('Fila view: membro 12 / self 7')).toBeInTheDocument();
    expect(screen.getByTestId('current-path')).toHaveTextContent(
      /^\/entregas\?view=fila&membro=12$/,
    );
  });

  it('normalizes the own id and an unknown id out of the URL', () => {
    const own = renderFila('/entregas?view=fila&membro=7');
    expect(screen.getByText('Fila view: membro 7 / self 7')).toBeInTheDocument();
    expect(screen.getByTestId('current-path')).toHaveTextContent(/^\/entregas\?view=fila$/);
    own.unmount();

    renderFila('/entregas?view=fila&membro=999');
    expect(screen.getByText('Fila view: membro 7 / self 7')).toBeInTheDocument();
    expect(screen.getByTestId('current-path')).toHaveTextContent(/^\/entregas\?view=fila$/);
  });

  it('does not touch membro= while membros are still loading, and reports loading', () => {
    currentMembroMock.membro = null;
    currentMembroMock.isSuccess = false;
    currentMembroMock.isLoading = true;
    renderFila('/entregas?view=fila&membro=12', { membros: [] });
    expect(screen.getByText('Fila state: loading')).toBeInTheDocument();
    expect(screen.getByTestId('current-path')).toHaveTextContent(
      /^\/entregas\?view=fila&membro=12$/,
    );
  });

  it('reports an error when membros or active-posts fail, and keeps the URL intact', () => {
    currentMembroMock.isSuccess = false;
    currentMembroMock.isError = true;
    renderFila('/entregas?view=fila&membro=12', { membros: [] });
    expect(screen.getByText('Fila state: error')).toBeInTheDocument();
    expect(screen.getByTestId('current-path')).toHaveTextContent(
      /^\/entregas\?view=fila&membro=12$/,
    );
  });

  it('reports an error when active-posts fails', () => {
    mockedUseActivePosts.mockReturnValue({ posts: [], isLoading: false, isError: true });
    renderFila();
    expect(screen.getByText('Fila state: error')).toBeInTheDocument();
  });

  it('picking a member writes membro=; picking yourself drops it', () => {
    renderFila();
    fireEvent.click(screen.getByText('Pick member 12'));
    expect(screen.getByText('Fila view: membro 12 / self 7')).toBeInTheDocument();
    expect(screen.getByTestId('current-path')).toHaveTextContent(
      /^\/entregas\?view=fila&membro=12$/,
    );
    fireEvent.click(screen.getByText('Pick self'));
    expect(screen.getByTestId('current-path')).toHaveTextContent(/^\/entregas\?view=fila$/);
  });

  it('a saved vista with membro=12 selects that member', () => {
    localStorage.setItem(
      'entregas_saved_views_conta-1',
      JSON.stringify([{ name: 'Fila do Bruno', query: 'view=fila&membro=12' }]),
    );
    renderFila('/entregas');
    fireEvent.click(screen.getByRole('button', { name: /Fila do Bruno/ }));
    expect(screen.getByText('Fila view: membro 12 / self 7')).toBeInTheDocument();
    expect(screen.getByTestId('current-path')).toHaveTextContent(
      /^\/entregas\?view=fila&membro=12$/,
    );
  });

  it('builds the fila from the page data and passes it to the view', () => {
    mockedUseActivePosts.mockReturnValue({
      posts: [
        {
          id: 1,
          workflow_id: 1,
          cliente_id: 10,
          cliente_nome: 'Cliente',
          workflow_titulo: 'Fluxo Editorial',
          titulo: 'Post do fluxo',
          tipo: 'feed',
          status: 'rascunho',
          custom_status_id: null,
          scheduled_at: null,
          responsavel_id: null,
        },
      ],
      isLoading: false,
      isError: false,
    } as never);
    // makeCard(): etapa.responsavel_id 7 = the logged-in membro.
    renderFila('/entregas?view=fila', {
      cards: [makeCard({ allEtapas: [], etapa: { ordem: 0, nome: 'Design', responsavel_id: 7 } })],
    });
    expect(screen.getByText('Fila items: 1')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the test and watch it fail**

```bash
npx vitest run apps/crm/src/pages/entregas/__tests__/EntregasPage.test.tsx -t "Minha fila"
```

Expected: the first case fails with `Unable to find an accessible element with the role "tab" and name "Minha fila"`.

- [ ] **Step 3: Implement**

`apps/crm/src/lib/analytics.ts`, after line 29 (`| 'entregas_explainer_dismissed'`):

```ts
  // "Minha fila": one per mount of the view (and per member switch), and the
  // dashboard teaser's clicks (item row vs "Ver minha fila").
  | 'minha_fila_opened'
  | 'minha_fila_teaser_clicked'
```

`apps/crm/src/pages/entregas/EntregasPage.tsx`:

1. Imports. Add `ListChecks` to the lucide import (line 4-17). After line 59 (`import { ConcludedView } ...`) add:

```ts
import { MinhaFilaView } from './views/MinhaFilaView';
import { buildMinhaFila, EMPTY_FILA } from './minhaFila';
import { useCurrentMembro } from '@/hooks/useCurrentMembro';
import { useStatusRegistry } from '@/hooks/useStatusRegistry';
```

2. `VIEW_TABS` (line 105-111): append after the `concluded` entry:

```ts
  { id: 'fila', label: 'Minha fila', icon: <ListChecks className="h-4 w-4" /> },
```

3. After the `entidade` state (line 184) add:

```ts
  // Minha fila (spec 2026-09-23): membro escolhido EXPLICITAMENTE no seletor
  // ou vindo de `?membro=`. null = "o próprio usuário", que é o que uma URL ou
  // vista salva sem `membro=` significa para quem a abre. O id efetivo é
  // `filaMembroId` abaixo; a reconciliação com a lista de membros roda só
  // depois de ['membros'] resolver (efeito após useEntregasData).
  const [filaMembro, setFilaMembro] = useState<number | null>(initialQuery.filaMembro);
  const {
    membro: currentMembro,
    isSuccess: membrosReady,
    isError: membrosError,
  } = useCurrentMembro();
  const currentMembroId = currentMembro?.id ?? null;
  const filaMembroId = filaMembro ?? currentMembroId;
  const registry = useStatusRegistry();
```

4. `useEntregasData` destructure (line 227-246): add `isError: entregasError,` after `isFetching,`. Right after the destructuring statement (after line 246) add:

```ts
  // Só valida `membro=<id>` com a lista carregada: antes disso `membros` é []
  // e todo deep link válido pareceria desconhecido. O próprio id vira null
  // (o serializador então omite `membro=`); id desconhecido idem. Com erro em
  // ['membros'] nada é reescrito.
  useEffect(() => {
    if (!membrosReady || filaMembro == null) return;
    if (filaMembro === currentMembroId || !membros.some((m) => m.id === filaMembro)) {
      setFilaMembro(null);
    }
  }, [membrosReady, filaMembro, currentMembroId, membros]);
```

5. `currentQuery` (line 432-440): replace the Task 3 placeholder `filaMembro: null,` with:

```ts
    filaMembro: activeView === 'fila' ? filaMembro : null,
```

6. `applySavedView` (line 696-704): add `setFilaMembro(parsed.filaMembro);` right after `setFilters(parsed.filters);`. `parsed.filaMembro` is `null` for any non-fila vista (Task 3's parser), so applying a Kanban vista also clears an explicit member pick; that is the same thing arriving through a URL without `membro=` does, so it is deliberate.

7. `useActivePosts` (line 710-720): change the gate and the destructuring:

```ts
  const filaView = activeView === 'fila';
  const {
    posts: activePosts,
    isLoading: activePostsLoading,
    isError: activePostsError,
  } = useActivePosts(postsMode || semProcessoMode || filaView);
```

8. `showFilters` (line 731-732):

```ts
  const showFilters =
    activeView !== 'concluded' &&
    activeView !== 'fila' &&
    !(activeView === 'calendar' && mode === 'publicacoes');
```

9. After `postEntityByPostId` (line 737-740) add:

```ts
  // Minha fila: derivada só quando a vista está ativa e há um membro efetivo.
  // EMPTY_FILA é estável para não invalidar o memo da vista à toa.
  const fila = useMemo(
    () =>
      filaView && filaMembroId != null
        ? buildMinhaFila({ cards, posts: activePosts, postEntities }, filaMembroId, new Date())
        : EMPTY_FILA,
    [filaView, filaMembroId, cards, activePosts, postEntities],
  );
  // Dependências obrigatórias da fila (spec § Estados): o spinner de página já
  // cobre workflows/etapas/processos carregando; aqui entram active-posts e
  // membros. Qualquer erro mostra o erro, nunca o vazio.
  const filaLoading = filaView && (activePostsLoading || (!membrosReady && !membrosError));
  const filaError = filaView && (!!entregasError || activePostsError || membrosError);

  // Um evento por montagem da vista com dados prontos; de novo ao trocar o membro.
  const filaOpenedFor = useRef<number | null>(null);
  useEffect(() => {
    if (!filaView || filaLoading || filaError || filaMembroId == null) return;
    if (filaOpenedFor.current === filaMembroId) return;
    filaOpenedFor.current = filaMembroId;
    captureEvent('minha_fila_opened', {
      membro_is_self: filaMembroId === currentMembroId,
      total: fila.counts.total,
      atrasados: fila.counts.atrasados,
      chegando: fila.chegando.length,
    });
  }, [filaView, filaLoading, filaError, filaMembroId, currentMembroId, fila]);
```

10. Render, after the `{activeView === 'concluded' && (<ConcludedView .../>)}` block (line 1365-1374):

```tsx
      {activeView === 'fila' && (
        <MinhaFilaView
          fila={fila}
          membros={membros}
          membroId={filaMembroId}
          currentMembroId={currentMembroId}
          registry={registry}
          isLoading={filaLoading}
          isError={filaError}
          onMembroChange={setFilaMembro}
          onPostClick={handlePostClick}
          onFluxoClick={handleFluxoClick}
        />
      )}
```

- [ ] **Step 4: Run the page suite and typecheck**

```bash
npx vitest run apps/crm/src/pages/entregas/__tests__/EntregasPage.test.tsx
npx tsc -p apps/crm/tsconfig.json --noEmit
npx eslint apps/crm/src/pages/entregas/EntregasPage.tsx apps/crm/src/lib/analytics.ts
```

Expected: the whole file PASSES (the pre-existing tests still see `Kanban` first and the toggles where they were); `tsc` and eslint clean (no unused `summary`, exhaustive deps satisfied).

- [ ] **Step 5: Commit**

```bash
git add apps/crm/src/lib/analytics.ts apps/crm/src/pages/entregas/EntregasPage.tsx apps/crm/src/pages/entregas/__tests__/EntregasPage.test.tsx
git commit -m "feat(entregas): aba Minha fila em Entregas com seletor de membro e deep link

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: `useMinhaFilaData` + `MinhaFilaCard` (Dashboard teaser) + i18n pt/en

Spec: § Teaser do Dashboard (Conteúdo, Custo de dados), § Estados (Teaser column), § Analytics (`minha_fila_teaser_clicked`), § i18n.

**Files:**
- Create: `apps/crm/src/pages/entregas/hooks/useMinhaFilaData.ts`.
- Create: `apps/crm/src/pages/dashboard/components/MinhaFilaCard.tsx`.
- Modify: `packages/i18n/locales/pt/dashboard.json`, `packages/i18n/locales/en/dashboard.json` (insert a `minhaFila` block right after the `agentPending` block, lines 3-12).
- Test: create `apps/crm/src/pages/entregas/hooks/__tests__/useMinhaFilaData.test.ts`, create `apps/crm/src/pages/dashboard/components/__tests__/MinhaFilaCard.test.tsx`.

**Interfaces:**
- Consumes: `buildBoardCards`, `fetchEtapasMap` (Task 4); `toPostEntity` (`boardEntity.ts:153`); `getWorkflows`, `getClientes`, `getMembros`, `getActivePosts`, `getVigentePostProcesses` (store); `buildMinhaFila`, `EMPTY_FILA`, `FilaItem` (Task 2); `useCurrentMembro` (Task 4); `formatEtapaPrazo`, `formatPostDate`; `captureEvent`; `useAuth().workspaceRole ?? role`.
- Produces:

```ts
// hooks/useMinhaFilaData.ts
export interface UseMinhaFilaDataOptions { enabled: boolean }
export interface MinhaFilaData {
  cards: BoardCard[];
  posts: ActivePost[];
  postEntities: PostEntity[];
  /** OR of the six queries' isLoading (false while disabled). */
  isLoading: boolean;
  /** OR of the six queries' isError. */
  isError: boolean;
}
export function useMinhaFilaData(options: UseMinhaFilaDataOptions): MinhaFilaData;

// dashboard/components/MinhaFilaCard.tsx
export function MinhaFilaCard(): JSX.Element;
```

- [ ] **Step 1: Write the failing tests**

Create `apps/crm/src/pages/entregas/hooks/__tests__/useMinhaFilaData.test.ts`:

```ts
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement, type ReactNode } from 'react';

vi.mock('../../../../lib/supabase');

const store = vi.hoisted(() => ({
  getWorkflows: vi.fn(),
  getClientes: vi.fn(),
  getMembros: vi.fn(),
  getActivePosts: vi.fn(),
  getVigentePostProcesses: vi.fn(),
  getAllActiveEtapas: vi.fn(),
}));
vi.mock('../../../../store', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  ...store,
}));

import { useMinhaFilaData } from '../useMinhaFilaData';

function wrapper() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return ({ children }: { children: ReactNode }) =>
    createElement(QueryClientProvider, { client }, children);
}

const processo = {
  id: 9,
  conta_id: 'c',
  post_id: 77,
  template_id: null,
  template_nome: null,
  assinatura: '',
  origem_workflow_id: null,
  origem_descricao: null,
  estado: 'ativo',
  motivo_encerramento: null,
  etapa_atual: 0,
  modo_prazo: 'padrao',
  board_position: 0,
  revisao: 1,
  created_by: null,
  created_at: '2026-09-10T00:00:00Z',
  updated_at: '2026-09-10T00:00:00Z',
  concluido_em: null,
  steps: [
    {
      id: 1,
      conta_id: 'c',
      process_id: 9,
      ordem: 0,
      nome: 'Copy',
      tipo: 'padrao',
      responsavel_id: 7,
      prazo_dias: null,
      tipo_prazo: null,
      prazo_efetivo: null,
      estado: 'ativo',
      iniciado_em: null,
      concluido_em: null,
      interrompido_em: null,
      origem_etapa_ordem: null,
      origem_etapa_nome: null,
    },
  ],
  post: { id: 77, workflow_id: null, cliente_id: 10, titulo: 'Post X', status: 'rascunho' },
};

describe('useMinhaFilaData', () => {
  beforeEach(() => {
    for (const fn of Object.values(store)) fn.mockReset();
    store.getWorkflows.mockResolvedValue([
      { id: 1, cliente_id: 10, titulo: 'WF-1', status: 'ativo', etapa_atual: 0 },
      { id: 2, cliente_id: 10, titulo: 'WF-2', status: 'concluido', etapa_atual: 0 },
    ]);
    store.getClientes.mockResolvedValue([{ id: 10, nome: 'Cliente A' }]);
    store.getMembros.mockResolvedValue([{ id: 7, nome: 'Ana' }]);
    store.getActivePosts.mockResolvedValue([{ id: 1, workflow_id: 1, status: 'rascunho' }]);
    store.getVigentePostProcesses.mockResolvedValue([
      processo,
      { ...processo, id: 10, post_id: 78, estado: 'concluido' },
    ]);
    store.getAllActiveEtapas.mockResolvedValue([
      {
        id: 100,
        workflow_id: 1,
        ordem: 0,
        nome: 'Design',
        prazo_dias: 2,
        tipo_prazo: 'corridos',
        status: 'ativo',
        responsavel_id: 7,
      },
    ]);
  });

  it('fetches nothing while disabled and reports neither loading nor error', () => {
    const { result } = renderHook(() => useMinhaFilaData({ enabled: false }), {
      wrapper: wrapper(),
    });
    expect(result.current.isLoading).toBe(false);
    expect(result.current.isError).toBe(false);
    expect(result.current.cards).toEqual([]);
    expect(store.getWorkflows).not.toHaveBeenCalled();
    expect(store.getActivePosts).not.toHaveBeenCalled();
  });

  it('builds cards for active workflows and entities for active processes', async () => {
    const { result } = renderHook(() => useMinhaFilaData({ enabled: true }), {
      wrapper: wrapper(),
    });
    expect(result.current.isLoading).toBe(true);
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.cards.map((c) => c.workflow.id)).toEqual([1]);
    expect(result.current.cards[0].membro?.nome).toBe('Ana');
    expect(result.current.cards[0].hubUrl).toBeUndefined();
    expect(result.current.postEntities.map((e) => e.process.post_id)).toEqual([77]);
    expect(result.current.posts).toHaveLength(1);
    expect(result.current.isError).toBe(false);
  });

  it('reports isError when any of the six queries fails', async () => {
    store.getActivePosts.mockRejectedValue(new Error('boom'));
    const { result } = renderHook(() => useMinhaFilaData({ enabled: true }), {
      wrapper: wrapper(),
    });
    await waitFor(() => expect(result.current.isError).toBe(true));
  });
});
```

Create `apps/crm/src/pages/dashboard/components/__tests__/MinhaFilaCard.test.tsx`:

```tsx
import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../../lib/supabase');

const auth = vi.hoisted(() => ({ role: 'owner', workspaceRole: 'owner' as string | null }));
vi.mock('../../../../context/AuthContext', () => ({ useAuth: () => ({ ...auth }) }));

const membroMock = vi.hoisted(() => ({
  membro: null as { id: number; nome: string } | null,
  isLoading: false,
  isError: false,
  isSuccess: true,
}));
vi.mock('../../../../hooks/useCurrentMembro', () => ({
  useCurrentMembro: () => ({ ...membroMock }),
}));

const dataMock = vi.hoisted(() => ({
  cards: [] as unknown[],
  posts: [] as unknown[],
  postEntities: [] as unknown[],
  isLoading: false,
  isError: false,
  enabledSeen: null as boolean | null,
}));
vi.mock('../../../entregas/hooks/useMinhaFilaData', () => ({
  useMinhaFilaData: ({ enabled }: { enabled: boolean }) => {
    dataMock.enabledSeen = enabled;
    return { ...dataMock };
  },
}));

const captureEvent = vi.hoisted(() => vi.fn());
vi.mock('@/lib/analytics', () => ({ captureEvent }));

import { MinhaFilaCard } from '../MinhaFilaCard';

const ME = 7;
const tomorrow = (() => {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
})();

function fluxoCard(id: number) {
  const etapa = {
    id: id * 100,
    workflow_id: id,
    ordem: 0,
    nome: 'Design',
    prazo_dias: 2,
    tipo_prazo: 'corridos',
    responsavel_id: ME,
    tipo: 'padrao',
    status: 'ativo',
    iniciado_em: null,
    data_limite: tomorrow,
  };
  return {
    workflow: { id, titulo: `Fluxo ${id}`, cliente_id: 1, status: 'ativo', etapa_atual: 0 },
    etapa,
    cliente: { id: 1, nome: 'Dra. Marina' },
    membro: { id: ME, nome: 'Ana' },
    deadline: { diasRestantes: 1, horasRestantes: 4, estourado: false, urgente: false },
    totalEtapas: 1,
    etapaIdx: 0,
    allEtapas: [etapa],
  };
}

function post(id: number, over: Record<string, unknown> = {}) {
  return {
    id,
    workflow_id: 1,
    cliente_id: 1,
    cliente_nome: 'Dra. Marina',
    workflow_titulo: 'Fluxo 1',
    titulo: `Post ${id}`,
    tipo: 'feed',
    status: 'rascunho',
    custom_status_id: null,
    scheduled_at: null,
    responsavel_id: null,
    platform: 'instagram',
    ...over,
  };
}

function renderCard() {
  return render(
    <MemoryRouter>
      <MinhaFilaCard />
    </MemoryRouter>,
  );
}

describe('MinhaFilaCard', () => {
  beforeEach(() => {
    auth.role = 'owner';
    auth.workspaceRole = 'owner';
    membroMock.membro = { id: ME, nome: 'Ana' };
    membroMock.isLoading = false;
    membroMock.isError = false;
    membroMock.isSuccess = true;
    dataMock.cards = [];
    dataMock.posts = [];
    dataMock.postEntities = [];
    dataMock.isLoading = false;
    dataMock.isError = false;
    dataMock.enabledSeen = null;
    captureEvent.mockReset();
  });

  it('without a linked membro shows the link card: /equipe link for owner/admin, none for agent', () => {
    membroMock.membro = null;
    const owner = renderCard();
    expect(screen.getByText('Minha fila')).toBeInTheDocument();
    expect(
      screen.getByText('Vincule seu usuário a um membro da equipe para ver sua fila aqui.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Vincular na Equipe' })).toHaveAttribute(
      'href',
      '/equipe',
    );
    expect(dataMock.enabledSeen).toBe(false);
    owner.unmount();

    auth.workspaceRole = 'agent';
    renderCard();
    expect(
      screen.getByText('Peça a um administrador para vincular seu usuário na página Equipe.'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Vincular na Equipe' })).not.toBeInTheDocument();
  });

  it('lists the first three items with view=fila deep links and the "+n na fila" line', () => {
    dataMock.cards = [fluxoCard(1)];
    dataMock.posts = [
      post(1, { scheduled_at: new Date(2030, 0, 3, 10).toISOString() }),
      post(2, { scheduled_at: new Date(2030, 0, 1, 10).toISOString() }),
      post(3),
      post(4, {
        workflow_id: null,
        workflow_titulo: null,
        responsavel_id: ME,
        scheduled_at: new Date(2030, 0, 2, 10).toISOString(),
      }),
    ];
    renderCard();
    expect(dataMock.enabledSeen).toBe(true);
    const links = screen.getAllByRole('link').filter((l) => /^Post \d/.test(l.textContent ?? ''));
    expect(links.map((l) => l.textContent?.slice(0, 6))).toEqual(['Post 2', 'Post 1', 'Post 3']);
    expect(links[0]).toHaveAttribute('href', '/entregas?view=fila&drawer=1&post=2');
    expect(screen.getByText('+1 na fila')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Ver minha fila/ })).toHaveAttribute(
      'href',
      '/entregas?view=fila',
    );
    expect(screen.getAllByText('1d restantes').length).toBeGreaterThan(0);
    expect(screen.getByText('sem data de publicação')).toBeInTheDocument();
  });

  it('links an avulso through the universal ?post= form', () => {
    dataMock.posts = [
      post(4, {
        workflow_id: null,
        workflow_titulo: null,
        responsavel_id: ME,
        scheduled_at: new Date(2030, 0, 2, 10).toISOString(),
      }),
    ];
    renderCard();
    expect(screen.getByRole('link', { name: /Post 4/ })).toHaveAttribute(
      'href',
      '/entregas?view=fila&post=4',
    );
  });

  it('captures the teaser clicks', () => {
    dataMock.cards = [fluxoCard(1)];
    dataMock.posts = [post(1)];
    renderCard();
    fireEvent.click(screen.getByRole('link', { name: /Post 1/ }));
    expect(captureEvent).toHaveBeenCalledWith(
      'minha_fila_teaser_clicked',
      { target: 'item', position: 0 },
      { sendInstantly: true },
    );
    fireEvent.click(screen.getByRole('link', { name: /Ver minha fila/ }));
    expect(captureEvent).toHaveBeenCalledWith(
      'minha_fila_teaser_clicked',
      { target: 'ver_fila' },
      { sendInstantly: true },
    );
  });

  it('renders empty, loading and error states', () => {
    const empty = renderCard();
    expect(screen.getByText('Nada na sua fila.')).toBeInTheDocument();
    empty.unmount();

    dataMock.isLoading = true;
    const loading = renderCard();
    expect(loading.container.querySelector('.animate-spin')).not.toBeNull();
    expect(screen.queryByText('Nada na sua fila.')).not.toBeInTheDocument();
    loading.unmount();

    dataMock.isLoading = false;
    dataMock.isError = true;
    const failed = renderCard();
    expect(
      screen.getByText('Não foi possível carregar a fila. Recarregue a página.'),
    ).toBeInTheDocument();
    failed.unmount();

    dataMock.isError = false;
    membroMock.isError = true;
    renderCard();
    expect(
      screen.getByText('Não foi possível carregar a fila. Recarregue a página.'),
    ).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the tests and watch them fail**

```bash
npx vitest run apps/crm/src/pages/entregas/hooks/__tests__/useMinhaFilaData.test.ts apps/crm/src/pages/dashboard/components/__tests__/MinhaFilaCard.test.tsx
```

Expected: both fail with `Failed to resolve import` for `../useMinhaFilaData` and `../MinhaFilaCard`.

- [ ] **Step 3: Implement**

`packages/i18n/locales/pt/dashboard.json`: replace the end of the `agentPending` block (lines 10-12)

```json
    "verTodas": "Ver todas",
    "verEntregas": "Ver entregas"
  },
```

with

```json
    "verTodas": "Ver todas"
  },
  "minhaFila": {
    "title": "Minha fila",
    "verFila": "Ver minha fila",
    "vazio": "Nada na sua fila.",
    "mais": "+{{n}} na fila",
    "publica": "publica {{data}}",
    "semData": "sem data de publicação",
    "erro": "Não foi possível carregar a fila. Recarregue a página.",
    "semMembro": "Vincule seu usuário a um membro da equipe para ver sua fila aqui.",
    "abrirEquipe": "Vincular na Equipe",
    "semMembroAgent": "Peça a um administrador para vincular seu usuário na página Equipe."
  },
```

and delete the now-unused `"etapas"` and `"posts"` lines from `agentPending` (lines 8-9; `semVinculo` stays, `TodayCard` reads it).

`packages/i18n/locales/en/dashboard.json`: same edit with

```json
    "verTodas": "See all"
  },
  "minhaFila": {
    "title": "My queue",
    "verFila": "See my queue",
    "vazio": "Nothing in your queue.",
    "mais": "+{{n}} in the queue",
    "publica": "publishes {{data}}",
    "semData": "no publish date",
    "erro": "Could not load your queue. Reload the page.",
    "semMembro": "Link your user to a team member to see your queue here.",
    "abrirEquipe": "Link on the Team page",
    "semMembroAgent": "Ask an administrator to link your user on the Team page."
  },
```

Create `apps/crm/src/pages/entregas/hooks/useMinhaFilaData.ts`:

```ts
import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  getActivePosts,
  getClientes,
  getMembros,
  getVigentePostProcesses,
  getWorkflows,
  type ActivePost,
  type Cliente,
  type Membro,
  type PostProcessWithPost,
  type Workflow,
  type WorkflowEtapa,
} from '../../../store';
import { buildBoardCards, fetchEtapasMap, type BoardCard } from './useEntregasData';
import { toPostEntity, type PostEntity } from '../boardEntity';

/**
 * Dados mínimos para buildMinhaFila fora de Entregas (teaser do Dashboard).
 * Observa as MESMAS seis chaves que useEntregasData/useActivePosts, com o
 * mesmo queryFn (fetchEtapasMap para ['all-active-etapas']: o cache é por
 * chave, e a forma tem de ser a mesma para todo observer). staleTime só aqui:
 * a volta ao Dashboard não refaz tudo; Entregas mantém o padrão dela.
 */
export interface UseMinhaFilaDataOptions {
  enabled: boolean;
}

export interface MinhaFilaData {
  cards: BoardCard[];
  posts: ActivePost[];
  postEntities: PostEntity[];
  /** OR do isLoading das seis queries (false enquanto desligadas). */
  isLoading: boolean;
  /** OR do isError das seis queries. */
  isError: boolean;
}

const STALE_MS = 60_000;
const EMPTY_WORKFLOWS: Workflow[] = [];
const EMPTY_CLIENTES: Cliente[] = [];
const EMPTY_MEMBROS: Membro[] = [];
const EMPTY_POSTS: ActivePost[] = [];
const EMPTY_PROCESSES: PostProcessWithPost[] = [];
const EMPTY_CARDS: BoardCard[] = [];
const EMPTY_ENTITIES: PostEntity[] = [];
const EMPTY_ETAPAS: Map<number, WorkflowEtapa[]> = new Map();

export function useMinhaFilaData({ enabled }: UseMinhaFilaDataOptions): MinhaFilaData {
  const common = { enabled, staleTime: STALE_MS } as const;
  const wf = useQuery({ queryKey: ['workflows'], queryFn: getWorkflows, ...common });
  const etapas = useQuery({ queryKey: ['all-active-etapas'], queryFn: fetchEtapasMap, ...common });
  const clientes = useQuery({ queryKey: ['clientes'], queryFn: getClientes, ...common });
  const membros = useQuery({ queryKey: ['membros'], queryFn: getMembros, ...common });
  // Sem refetchInterval: o poll de publicação é do useActivePosts de Entregas.
  const posts = useQuery({ queryKey: ['active-posts'], queryFn: getActivePosts, ...common });
  const vigentes = useQuery({
    queryKey: ['post-processes', 'vigentes'],
    queryFn: getVigentePostProcesses,
    ...common,
  });

  const workflows = wf.data ?? EMPTY_WORKFLOWS;
  const etapasMap = etapas.data ?? EMPTY_ETAPAS;
  const clientesList = clientes.data ?? EMPTY_CLIENTES;
  const membrosList = membros.data ?? EMPTY_MEMBROS;
  const processes = vigentes.data ?? EMPTY_PROCESSES;

  const activeWorkflows = useMemo(
    () => (workflows.length ? workflows.filter((w) => w.status === 'ativo') : EMPTY_WORKFLOWS),
    [workflows],
  );
  const cards = useMemo(
    () =>
      activeWorkflows.length
        ? buildBoardCards(activeWorkflows, etapasMap, clientesList, membrosList)
        : EMPTY_CARDS,
    [activeWorkflows, etapasMap, clientesList, membrosList],
  );
  const postEntities = useMemo(() => {
    if (processes.length === 0) return EMPTY_ENTITIES;
    const out: PostEntity[] = [];
    for (const p of processes) {
      if (p.estado !== 'ativo') continue;
      const e = toPostEntity(p, { clientes: clientesList, membros: membrosList });
      if (e) out.push(e);
    }
    return out;
  }, [processes, clientesList, membrosList]);

  const all = [wf, etapas, clientes, membros, posts, vigentes];
  return {
    cards,
    posts: posts.data ?? EMPTY_POSTS,
    postEntities,
    isLoading: all.some((q) => q.isLoading),
    isError: all.some((q) => q.isError),
  };
}
```

Create `apps/crm/src/pages/dashboard/components/MinhaFilaCard.tsx`:

```tsx
import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ArrowRight, ListChecks } from 'lucide-react';
import { Spinner } from '@/components/ui/spinner';
import { useAuth } from '../../../context/AuthContext';
import { useCurrentMembro } from '../../../hooks/useCurrentMembro';
import { useMinhaFilaData } from '../../entregas/hooks/useMinhaFilaData';
import { buildMinhaFila, EMPTY_FILA, type FilaItem } from '../../entregas/minhaFila';
import { formatEtapaPrazo, type DeadlineInfo } from '../../entregas/etapaPrazo';
import { formatPostDate } from '@/utils/postDate';
import { captureEvent } from '@/lib/analytics';

const MAX_ROWS = 3;

function prazoClass(deadline: DeadlineInfo): string {
  if (deadline.estourado) return 'deadline-overdue';
  if (deadline.urgente) return 'deadline-warning';
  return 'deadline-ok';
}

/** Mesmo deep link de todayAgenda.postHref, mais `view=fila` para cair na
 *  fila (consumeParams em EntregasPage só remove drawer/post). */
function itemHref(item: FilaItem): string {
  const p = item.post;
  return p.workflow_id != null
    ? `/entregas?view=fila&drawer=${p.workflow_id}&post=${p.id}`
    : `/entregas?view=fila&post=${p.id}`;
}

/**
 * Teaser "Minha fila" do Dashboard (spec 2026-09-23 § Teaser): os três
 * primeiros itens da mesma fila de Entregas, para qualquer papel. Sem membro
 * vinculado vira o card "vincule seu usuário". Queries component-local
 * (DashboardPage.test.tsx mocka useQueries por índice; nada entra naquele
 * batch).
 */
export function MinhaFilaCard() {
  const { t } = useTranslation('dashboard');
  const { role, workspaceRole } = useAuth();
  const canManageTeam = (workspaceRole ?? role) !== 'agent';
  const { membro, isLoading: membroLoading, isError: membroError } = useCurrentMembro();
  const membroId = membro?.id ?? null;
  const data = useMinhaFilaData({ enabled: membroId != null });

  const fila = useMemo(
    () =>
      membroId != null
        ? buildMinhaFila(
            { cards: data.cards, posts: data.posts, postEntities: data.postEntities },
            membroId,
            new Date(),
          )
        : EMPTY_FILA,
    [membroId, data.cards, data.posts, data.postEntities],
  );

  const title = (
    <div className="today-head" style={{ marginBottom: '0.75rem' }}>
      <h3 className="today-title">
        <ListChecks className="h-4 w-4" aria-hidden />
        {t('minhaFila.title', 'Minha fila')}
      </h3>
      {membroId != null && (
        <Link
          to="/entregas?view=fila"
          className="today-cal-link"
          onClick={() =>
            captureEvent('minha_fila_teaser_clicked', { target: 'ver_fila' }, { sendInstantly: true })
          }
        >
          {t('minhaFila.verFila', 'Ver minha fila')}{' '}
          <ArrowRight className="h-3.5 w-3.5" aria-hidden />
        </Link>
      )}
    </div>
  );

  let body: React.ReactNode;
  if (membroLoading || (membroId != null && data.isLoading)) {
    body = (
      <div style={{ textAlign: 'center', padding: '1.5rem' }}>
        <Spinner size="md" />
      </div>
    );
  } else if (membroError || data.isError) {
    body = (
      <p className="today-note">
        {t('minhaFila.erro', 'Não foi possível carregar a fila. Recarregue a página.')}
      </p>
    );
  } else if (membroId == null) {
    body = canManageTeam ? (
      <p className="today-note">
        {t('minhaFila.semMembro', 'Vincule seu usuário a um membro da equipe para ver sua fila aqui.')}{' '}
        <Link to="/equipe" style={{ fontWeight: 600 }}>
          {t('minhaFila.abrirEquipe', 'Vincular na Equipe')}
        </Link>
      </p>
    ) : (
      <p className="today-note">
        {t(
          'minhaFila.semMembroAgent',
          'Peça a um administrador para vincular seu usuário na página Equipe.',
        )}
      </p>
    );
  } else if (fila.items.length === 0) {
    body = <p className="today-note">{t('minhaFila.vazio', 'Nada na sua fila.')}</p>;
  } else {
    const rows = fila.items.slice(0, MAX_ROWS);
    const rest = fila.items.length - rows.length;
    body = (
      <>
        <div className="today-list">
          {rows.map((item, position) => (
            <Link
              key={item.key}
              to={itemHref(item)}
              className="today-row"
              onClick={() =>
                captureEvent(
                  'minha_fila_teaser_clicked',
                  { target: 'item', position },
                  { sendInstantly: true },
                )
              }
            >
              <span className="today-row-title">{item.post.titulo}</span>
              <span className="today-row-context">{item.post.cliente_nome}</span>
              <span className="today-row-end">
                {item.prazoDate && (
                  <span className={`board-card-deadline ${prazoClass(item.deadline)}`}>
                    {formatEtapaPrazo(item.deadline).label}
                  </span>
                )}
                <span className="today-row-context">
                  {item.post.scheduled_at
                    ? t('minhaFila.publica', { data: formatPostDate(item.post.scheduled_at) })
                    : t('minhaFila.semData', 'sem data de publicação')}
                </span>
              </span>
            </Link>
          ))}
        </div>
        {rest > 0 && (
          <p className="today-note" style={{ marginTop: '0.5rem' }}>
            {t('minhaFila.mais', { n: rest })}
          </p>
        )}
      </>
    );
  }

  return (
    <div className="card today-card animate-up" data-testid="minha-fila-card">
      {title}
      {body}
    </div>
  );
}
```

- [ ] **Step 4: Run the tests, typecheck, format**

```bash
npx vitest run apps/crm/src/pages/entregas/hooks/__tests__/useMinhaFilaData.test.ts apps/crm/src/pages/dashboard/components/__tests__/MinhaFilaCard.test.tsx apps/crm/src/pages/dashboard
npx tsc -p apps/crm/tsconfig.json --noEmit
npx prettier --check packages/i18n/locales/pt/dashboard.json packages/i18n/locales/en/dashboard.json apps/crm/src/pages/dashboard/components/MinhaFilaCard.tsx apps/crm/src/pages/entregas/hooks/useMinhaFilaData.ts
```

Expected: PASS (the `TodayCard`/`AgentPendingSection` suites keep passing: `agentPending.semVinculo` and `agentPending.tarefas` remain in both JSON files); `tsc` and prettier clean.

- [ ] **Step 5: Commit**

```bash
git add apps/crm/src/pages/entregas/hooks/useMinhaFilaData.ts apps/crm/src/pages/entregas/hooks/__tests__/useMinhaFilaData.test.ts apps/crm/src/pages/dashboard/components/MinhaFilaCard.tsx apps/crm/src/pages/dashboard/components/__tests__/MinhaFilaCard.test.tsx packages/i18n/locales/pt/dashboard.json packages/i18n/locales/en/dashboard.json
git commit -m "feat(dashboard): teaser Minha fila com useMinhaFilaData e card de vínculo de membro

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Trim `AgentPendingSection`, mount `MinhaFilaCard` on the Dashboard

Spec: § Teaser do Dashboard (Decisão), § Arquitetura (Modificados: `DashboardPage.tsx`, `AgentPendingSection.tsx`).

**Files:**
- Modify: `apps/crm/src/pages/dashboard/components/AgentPendingSection.tsx` (imports 1-15; queries 143-157; the `!membro` branch 167-184; the `minhasEtapas`/`meusPosts`/`etapaBadge` derivations 191-205; the two sections 251-302).
- Modify: `apps/crm/src/pages/dashboard/DashboardPage.tsx` (import after line 12; render after line 78).
- Test: `apps/crm/src/pages/dashboard/components/__tests__/AgentPendingSection.test.tsx` (rewrite the three affected cases), `apps/crm/src/pages/dashboard/__tests__/DashboardPage.test.tsx` (mock + two assertions).

**Interfaces:**
- Consumes: `MinhaFilaCard` (Task 7).
- Produces: `AgentPendingSection` renders `null` without a linked membro, and only the "Tarefas" section (plus the loading spinner and the `vazio` copy) with one; it no longer queries `agent-pending-etapas` / `agent-pending-posts`. `DashboardPage` renders `<MinhaFilaCard />` right after `<TodayCard />` for every role.

- [ ] **Step 1: Write the failing tests**

`apps/crm/src/pages/dashboard/components/__tests__/AgentPendingSection.test.tsx`: replace the first two `it(...)` cases (`shows the unlinked-membro message...` and `lists my tasks, etapas and pending posts...`) and delete the last two (`links a pending post...`, `links a pending post avulso...`) so the file's `describe` body becomes:

```tsx
  it('renders nothing when the user has no linked membro (the teaser owns that state)', async () => {
    getMembrosMock.mockResolvedValue([{ id: 7, nome: 'Ana', crm_user_id: null }]);

    const { container } = renderSection();

    // While ['membros'] is in flight the spinner card is rendered; the null
    // render only lands once the query resolves.
    await waitFor(() => expect(container.firstChild).toBeNull());
    expect(getTarefasMock).not.toHaveBeenCalled();
    expect(getEtapasMock).not.toHaveBeenCalled();
    expect(getPostsMock).not.toHaveBeenCalled();
  });

  it('lists only my open tasks, and never queries etapas or posts', async () => {
    getMembrosMock.mockResolvedValue([{ id: 7, nome: 'Ana', crm_user_id: 'user-1' }]);
    getTarefasMock.mockResolvedValue([
      {
        id: 1,
        titulo: 'Gravar reels',
        status: 'pendente',
        responsavel_id: 7,
        cliente_nome: 'Dra. Marina',
        data_limite: null,
        tags: [],
        subtarefas_total: 0,
        subtarefas_concluidas: 0,
        serie: null,
      },
      {
        id: 2,
        titulo: 'Tarefa de outro membro',
        status: 'pendente',
        responsavel_id: 9,
        cliente_nome: null,
        data_limite: null,
        tags: [],
        subtarefas_total: 0,
        subtarefas_concluidas: 0,
        serie: null,
      },
    ]);

    renderSection();

    expect(await screen.findByText('Minhas pendências')).toBeInTheDocument();
    expect(await screen.findByText('Gravar reels')).toBeInTheDocument();
    expect(screen.queryByText('Tarefa de outro membro')).not.toBeInTheDocument();
    expect(screen.queryByText(/Entregas · etapas/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Entregas · posts/)).not.toBeInTheDocument();
    expect(getEtapasMock).not.toHaveBeenCalled();
    expect(getPostsMock).not.toHaveBeenCalled();
  });

  it('shows the empty copy when there are no open tasks', async () => {
    getMembrosMock.mockResolvedValue([{ id: 7, nome: 'Ana', crm_user_id: 'user-1' }]);
    renderSection();
    expect(
      await screen.findByText('Tudo em dia! Nenhuma pendência atribuída a você.'),
    ).toBeInTheDocument();
  });
```

(add `waitFor` to the `@testing-library/react` import on line 2). Keep the `vi.mock('../../../../store', ...)` block unchanged; the unused mocks are harmless.

`apps/crm/src/pages/dashboard/__tests__/DashboardPage.test.tsx`: after the `TodayCard` mock (line 54-56) add:

```tsx
// MinhaFilaCard owns its queries (useMinhaFilaData) and is tested separately
vi.mock('../components/MinhaFilaCard', () => ({
  MinhaFilaCard: () => <div data-testid="minha-fila-card">Minha fila</div>,
}));
```

and append inside `describe('DashboardPage', ...)`:

```tsx
  it('renders MinhaFilaCard right after TodayCard for admins and agents alike', () => {
    renderDashboardPage();
    const today = screen.getByTestId('today-card');
    const fila = screen.getByTestId('minha-fila-card');
    expect(today.compareDocumentPosition(fila) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    const health = screen.getByTestId('client-health-monitor');
    expect(fila.compareDocumentPosition(health) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    mockedUseAuth.mockReturnValue({
      role: 'agent',
      workspaceRole: 'agent',
      canSeeFinancials: false,
    } as never);
    renderDashboardPage();
    expect(screen.getAllByTestId('minha-fila-card')).toHaveLength(2);
    expect(screen.getByTestId('agent-pending-section')).toBeInTheDocument();
  });
```

- [ ] **Step 2: Run the tests and watch them fail**

```bash
npx vitest run apps/crm/src/pages/dashboard/components/__tests__/AgentPendingSection.test.tsx apps/crm/src/pages/dashboard/__tests__/DashboardPage.test.tsx
```

Expected: `renders nothing when the user has no linked membro` fails (`container.firstChild` is the card with the "não está vinculado" copy); `lists only my open tasks` fails on `expect(getEtapasMock).not.toHaveBeenCalled()`; the DashboardPage case fails with `Unable to find an element by: [data-testid="minha-fila-card"]`.

- [ ] **Step 3: Implement**

`apps/crm/src/pages/dashboard/components/AgentPendingSection.tsx`:

Replace the imports (lines 1-15) with:

```tsx
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ArrowRight, ClipboardList } from 'lucide-react';
import { Spinner } from '@/components/ui/spinner';
import { getTarefas, type TarefaWithRelations } from '../../../store';
import { useCurrentMembro } from '../../../hooks/useCurrentMembro';
import { dueBadge, sortTarefas } from '../../tarefas/tarefasLogic';
```

Replace the component's doc comment and body from line 132 to the end with:

```tsx
/**
 * Agent dashboard: the open tasks assigned to the logged-in user's membro.
 * Etapas and posts moved to MinhaFilaCard (spec 2026-09-23 § Teaser), which
 * also owns the "vincule seu usuário" state, so this renders nothing without
 * a membro. Queries are component-local on purpose: DashboardPage's
 * useQueries batch is mocked by index in its test, so nothing may be appended
 * there.
 */
export function AgentPendingSection() {
  const { t } = useTranslation('dashboard');
  const { membro, isLoading: membroLoading } = useCurrentMembro();
  const membroId = membro?.id ?? null;

  const { data: tarefas = [], isLoading: tarefasLoading } = useQuery({
    queryKey: ['tarefas'],
    queryFn: getTarefas,
    enabled: membroId != null,
  });

  if (membroLoading) {
    return (
      <div className="card" style={{ padding: '2rem', textAlign: 'center', borderRadius: '12px' }}>
        <Spinner size="md" />
      </div>
    );
  }

  if (!membro) return null;

  const now = new Date();
  const minhasTarefas = tarefas
    .filter((task) => task.responsavel_id === membroId && task.status !== 'concluida')
    .sort(sortTarefas)
    .slice(0, MAX_ROWS);
  const nothingPending = !tarefasLoading && minhasTarefas.length === 0;
  const tarefaBadgeOf = (task: TarefaWithRelations) => dueBadge(task, now);

  return (
    <div className="card animate-up" style={{ padding: '1.25rem', borderRadius: '12px' }}>
      <h2 style={{ fontSize: '1rem', marginBottom: '1rem' }}>
        {t('agentPending.title', 'Minhas pendências')}
      </h2>

      {tarefasLoading && (
        <div style={{ textAlign: 'center', padding: '1.5rem' }}>
          <Spinner size="md" />
        </div>
      )}

      {nothingPending && (
        <p style={{ fontSize: '0.82rem', color: 'var(--text-muted)' }}>
          {t('agentPending.vazio', 'Tudo em dia! Nenhuma pendência atribuída a você.')}
        </p>
      )}

      {minhasTarefas.length > 0 && (
        <div>
          <SectionLabel
            icon={<ClipboardList className="h-3.5 w-3.5" />}
            to="/tarefas"
            linkLabel={t('agentPending.verTodas', 'Ver todas')}
          >
            {t('agentPending.tarefas', 'Tarefas')}
          </SectionLabel>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
            {minhasTarefas.map((task) => (
              <Row
                key={task.id}
                to={`/tarefas?tarefa=${task.id}`}
                title={task.titulo}
                context={task.cliente_nome ?? undefined}
                badge={tarefaBadgeOf(task)}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
```

(`MAX_ROWS`, `SectionLabel` and `Row` above the component stay as they are.)

`apps/crm/src/pages/dashboard/DashboardPage.tsx`: add after line 12 (`import { TodayCard } ...`):

```ts
import { MinhaFilaCard } from './components/MinhaFilaCard';
```

and after `<TodayCard />` (line 78):

```tsx
      <MinhaFilaCard />
```

- [ ] **Step 4: Run the dashboard suites, typecheck, lint**

```bash
npx vitest run apps/crm/src/pages/dashboard
npx tsc -p apps/crm/tsconfig.json --noEmit
npx eslint apps/crm/src/pages/dashboard
```

Expected: PASS; `tsc` clean; eslint clean (no unused imports left in `AgentPendingSection.tsx`: `Kanban`, `Send`, `getAllActiveEtapas`, `getAssignedPendingPosts`, `getDeadlineInfo`, `POST_STATUS_LABELS` were all removed).

- [ ] **Step 5: Commit**

```bash
git add apps/crm/src/pages/dashboard/components/AgentPendingSection.tsx apps/crm/src/pages/dashboard/components/__tests__/AgentPendingSection.test.tsx apps/crm/src/pages/dashboard/DashboardPage.tsx apps/crm/src/pages/dashboard/__tests__/DashboardPage.test.tsx
git commit -m "feat(dashboard): monta o teaser Minha fila e enxuga Minhas pendências para tarefas

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Final verification (CI gates + browser pass)

Spec: § Testes (Browser), plus every CI gate listed in Global Constraints.

**Files:**
- No source change expected. If a gate fails, fix it in the task that owns the file and amend that task's commit message scope (do not squash).

**Interfaces:**
- Consumes: everything above.
- Produces: a green local run of every gate `ci.yml` runs on this diff, and a browser checklist ticked off.

- [ ] **Step 1: Run the CI gates**

```bash
npm run lint
npm run format:check
npx tsc -p apps/crm/tsconfig.json --noEmit
npx tsc -p apps/hub/tsconfig.json --noEmit
npx tsc -p apps/admin/tsconfig.json --noEmit
npx tsc -p tsconfig.scripts.json
npm run test
npm run coverage:check
```

Expected: every command exits 0. `npm run format` fixes a `format:check` failure; commit the fix with `style(entregas): prettier` and the same trailer.

- [ ] **Step 2: Grep the diff for forbidden copy**

```bash
git diff --name-only 2ab24d8b..HEAD -- apps packages | xargs grep -n "—" || echo "no em-dash"
```

Expected: `no em-dash` (or only hits inside code comments, never inside a JSX text node or a string literal that reaches the UI).

- [ ] **Step 3: Browser pass (read-only against production data)**

`npm run dev:env` loads the main checkout's `.env`, which points at **production**: look, never write (no status changes, no drawer saves). Start the server in the background and open the Browser pane on it (`.claude/launch.json`'s `crm` entry runs plain `npm run dev`, which has no env in a worktree, so do not use it here):

```bash
npm run dev:env   # run_in_background; note the port Vite prints (5173 unless taken)
```

Then `preview_start` with `url: http://localhost:5173/dashboard`, sign in through the seed-login procedure in memory (`reference_seed_login_browser_verification.md`), and tick each line:

- Dashboard, owner account: the "Minha fila" card sits right under "Hoje"; with a linked membro it lists at most 3 rows with a prazo chip and a "publica ..." label and a "+N na fila" line when there are more; "Ver minha fila" lands on `/entregas?view=fila`.
- Dashboard, account whose user has no linked membro: the card shows "Vincule seu usuário a um membro da equipe para ver sua fila aqui." with the "Vincular na Equipe" link (owner/admin) or the "Peça a um administrador ..." copy (agent; use `resize_window` is not enough here, switch account or temporarily unlink in staging if a prod account is not available and note it).
- `/entregas?view=fila`: sixth tab active, no Etapas/Status toggle, no Todos/Fluxos toggle, no filter pills, no search input; six section headers with counts; Atrasado/Hoje/Amanhã expanded; "Comece por aqui" card equals the first row; margem chips in the three colours; the fluxo header opens the WorkflowDrawer; a post row opens the WorkflowDrawer at that post (wired) or the StandalonePostDrawer (avulso).
- Member switch: pick another member; URL becomes `?view=fila&membro=<id>`; pick yourself; `membro=` disappears. Reload with `?view=fila&membro=<id>` and confirm that member is selected. Reload with `?view=fila&membro=999999`: falls back to yourself and the param disappears.
- Deep link from the teaser: click a teaser row; Entregas opens on the fila tab with the drawer over it; closing the drawer leaves `?view=fila` in the URL.
- Chegando: a fluxo group header with "agora em <etapa> (<responsável>) · chega ~<data>" and a post count, collapsed; expanding lists the posts.
- Dark mode (`resize_window` with `colorScheme: 'dark'`): chips and the "Comece por aqui" card keep readable contrast.
- 375px (`resize_window` preset `mobile`, then reload): the picker spans the row, "publica ..." and the margem chip wrap under the title, no horizontal scroll on the page; the fluxo header wraps to two lines.
- Empty fila (a member with nothing assigned): "Nada na fila de <nome>." for another member; "Nada na sua fila. Quando uma etapa ou um post for atribuído a você, ele aparece aqui." for yourself.

Stop the background server when done and `git status` must show a clean tree (no `.claude/launch.json` change, no `.env` file).

- [ ] **Step 4: No commit**

Nothing to commit unless Step 1 or 2 required a fix. Report the gate output and the checklist to the person reviewing.

---

## Self-review

### Spec coverage

| Spec section | Task |
|---|---|
| Contexto e objetivo / Não-objetivos | scoped by the plan header; nothing in Tasks 1-9 adds filters, DnD or backend |
| UX · Aba (`VIEW_TABS`, `ActiveView`, `VIEW_ICONS`, toggles untouched, `showFilters`) | Tasks 3 and 6 |
| UX · Layout da vista (header, picker, summary, "Comece por aqui", six sections, group header, row, assignee tag, Chegando placement) | Task 5 |
| UX · Responsivo (`max-width: 900px` block, no `position: fixed`) | Task 5 (style.css) |
| UX · Copy table (Entregas strings literal; teaser strings in pt/en JSON) | Tasks 5 and 7 |
| Regras de inclusão (status exclusion on canonical column, etapa rule, responsável rule, once-only) | Task 2 (`buildMinhaFila`, tests "inclusão") |
| Ordenação · Prazo e bucket (exclusive buckets, `estourado` first, stale-cache day rule, `deadlineFromPrazoEfetivo` fallback, prazo chip gated on `prazoDate`) | Task 1 (`filaBucketOf`), Task 2 (`makeItem`), Task 5 (`PrazoChip`) |
| Ordenação · Grupos (fluxo vs post groups, group order, child order, flat `items`, `top`) | Task 2 |
| Margem (`dayDiff` in `etapaPrazo.ts`, thresholds, chip omitted cases, `--danger-text`) | Task 1 (`margemOf`), Task 5 (`MargemChip` + `.fila-margem--sem`) |
| Chegando (next etapa rules, row copy, `scheduled_at` then `chegaDate` order, grouping by fluxo in the view) | Task 2 (`nextEtapaOf`, `compareChegando`), Task 5 (`ChegandoGroups`) |
| Teaser · Decisão (all roles, "vincule" card, `AgentPendingSection` trimmed) | Tasks 7 and 8 |
| Teaser · Conteúdo (3 rows, chip, publica, `+n`, deep links with `view=fila`, no-membro variants) | Task 7 |
| Teaser · Custo de dados (six keys, `staleTime` only on the teaser, no `refetchInterval`, `fetchEtapasMap` shared shape, `enabled` gate) | Tasks 4 and 7 |
| Arquitetura · Novos (`minhaFila.ts`, `useMinhaFilaData.ts`, `MinhaFilaView.tsx`, `MinhaFilaCard.tsx`) | Tasks 1-2, 7, 5, 7 |
| Arquitetura · Modificados (`viewQuery.ts`, `useEntregasData.ts`, `useActivePosts.ts`, `EntregasPage.tsx`, `VistasTabs.tsx`, `etapaPrazo.ts`, `useCurrentMembro.ts`, `DashboardPage.tsx`, `AgentPendingSection.tsx`, i18n JSON, `analytics.ts`) | Tasks 3, 4, 4, 6, 3, 1, 4, 8, 8, 7, 6 |
| Membro selecionado (default, URL wins, reconcile only after `isSuccess`, own id normalized, URL-only persistence, saved vistas) | Task 6 |
| Gating de dados na vista (`useActivePosts` third trigger) | Task 6 |
| Estados (vista: loading/error/no-membro/empty self/empty other; teaser: spinner/error/vincule/empty; aggregated loading and error) | Tasks 5, 6, 7 |
| Testes (every file the spec names) | Tasks 1-8 |
| Analytics (`minha_fila_opened` once per mount and per member switch; `minha_fila_teaser_clicked` with `sendInstantly`) | Tasks 6 and 7 |
| i18n (Entregas literal, Dashboard pt + en) | Tasks 5 and 7 |
| Lacunas conhecidas | not implementation work; unchanged |
| Decisões / divergências, Decisões do usuário | honoured as written (aprovado_cliente kept; tag only on `origem: 'responsavel'`; teaser for all roles; Chegando order and grouping) |

### Placeholder scan

Every task carries literal test code and literal implementation code; no step says "similar to", "as in Task N", "TODO" or "implement accordingly". The two places that reference another task's code do so by exact export name (`buildBoardCards`, `fetchEtapasMap`, `EMPTY_FILA`), which are defined with their full bodies in Tasks 2 and 4.

### Type consistency

- `FilaItem.margem` is `FilaMargem` (Task 1) everywhere; Task 5's `MargemChip` takes `FilaItem['margem']`, the same type.
- `FilaItem.prazoOrigem: 'etapa' | 'publicacao' | null` is declared in Task 2's interface and set in `makeItem`; Task 5 never reads it (grouping was decided in the builder), Task 2's tests assert it.
- `MinhaFila.sections` is always six entries; Task 5 indexes `FILA_BUCKET_LABELS[section.bucket]` and Task 2 sets `counts.atrasados = sections[0].count` (index 0 is `'atrasado'` by `FILA_BUCKET_ORDER`).
- `useCurrentMembro` returns `{ membro, isLoading, isError, isSuccess }` (Task 4); Task 6 destructures `isSuccess`/`isError`, Task 7 destructures `isLoading`/`isError`, the two test mocks (Tasks 6 and 7) expose all four.
- `useActivePosts` returns `{ posts, isLoading, isError }` (Task 4); Task 6 destructures all three and its `beforeEach` mock returns all three.
- `useEntregasData` returns `isError` (Task 4); Task 6 reads it as `entregasError` with `!!` because the page test's mocked return omits it in older cases.
- `EntregasViewState.filaMembro` (Task 3) is written by `EntregasPage` in Task 6 with the same name; `parseEntregasQuery(...).filaMembro` is consumed by `applySavedView` and `initialQuery`.
- `BoardCardExtras.covers` is `Map<number, PostMedia[]>`, matching `getWorkflowCovers`' return (`services/postMedia.ts:183`); `hubTokens` matches `buildUsableTokenMap` (`lib/hubTokenMap.ts:1-4`); `workspaceSlug` matches `getWorkspaceSlug` (`store/hub.ts:283`, `string | null`).
- `AnalyticsEvent` gains both names in Task 6 before Task 7's card uses the second.
