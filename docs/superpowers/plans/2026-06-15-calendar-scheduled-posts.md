# Calendar Scheduled-Posts (Publicações) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "Publicações" mode to the Entregas calendar that shows, per day, every active-workflow post scheduled to publish — across all clients — with inline Agendar/Publicar/Cancelar/Retry actions and click-to-open the workflow drawer.

**Architecture:** A new workspace-wide `getScheduledPosts(startISO, endISO)` query + a scoped IG-status query feed a `useScheduledPosts(month, enabled)` hook. `CalendarView` gains a mode toggle (state lifted to `EntregasPage`) that repaints cells with post counts and swaps the side panel for a `PublicacoesPanel` reusing the existing `ScheduleButton`. Day bucketing is by browser-local day to match the rest of the post UI.

**Tech Stack:** React 19, TanStack Query, TypeScript, Supabase JS, Vitest.

**Spec:** `docs/superpowers/specs/2026-06-15-calendar-scheduled-posts-design.md`

---

## Conventions for every task

- Typecheck = `npm run build` (runs `tsc` then vite build). Unit tests = `npm run test` (Vitest).
- Commit after each task. Branch is already `feat/landing-live-subscription-plans`; if the user
  wants an isolated branch, create one first — otherwise commit here.
- Portuguese UI strings, `@/` path alias maps to `apps/crm/src/`.

---

## Task 1: `getScheduledPosts` + `ScheduledPost` type

**Files:**
- Modify: `apps/crm/src/store/posts.ts` (add after `getClientePosts`, ~line 69)
- Test: `apps/crm/src/__tests__/store.posts.test.ts` (append inside the existing `describe('store workflow posts', …)`)

- [ ] **Step 1: Write the failing test**

Append this `it` block inside the existing `describe('store workflow posts', () => { … })` in
`apps/crm/src/__tests__/store.posts.test.ts` (before its closing `});`):

```ts
it('getScheduledPosts maps nested workflow/client and filters by range', async () => {
  mockedSupabase.__queueSupabaseResult('workflow_posts', 'select', {
    data: [
      {
        id: 1,
        workflow_id: 5,
        titulo: 'Post A',
        tipo: 'feed',
        status: 'aprovado_cliente',
        scheduled_at: '2026-06-16T17:00:00.000Z',
        published_at: null,
        ig_caption: 'Legenda',
        instagram_permalink: null,
        publish_error: null,
        ordem: 0,
        responsavel_id: 10,
        workflows: {
          titulo: 'Posts Junho',
          cliente_id: 7,
          status: 'ativo',
          clientes: { nome: 'Yasmin' },
        },
      },
    ],
    error: null,
  });

  const result = await store.getScheduledPosts(
    '2026-06-01T03:00:00.000Z',
    '2026-07-01T03:00:00.000Z',
  );

  expect(result).toHaveLength(1);
  expect(result[0]).toMatchObject({
    id: 1,
    workflow_id: 5,
    cliente_id: 7,
    cliente_nome: 'Yasmin',
    workflow_titulo: 'Posts Junho',
    status: 'aprovado_cliente',
    scheduled_at: '2026-06-16T17:00:00.000Z',
  });
  const call = getCalls('workflow_posts', 'select').at(-1)!;
  expect(call.modifiers).toContainEqual({ method: 'eq', args: ['workflows.status', 'ativo'] });
  expect(call.modifiers).toContainEqual({
    method: 'gte',
    args: ['scheduled_at', '2026-06-01T03:00:00.000Z'],
  });
  expect(call.modifiers).toContainEqual({
    method: 'lt',
    args: ['scheduled_at', '2026-07-01T03:00:00.000Z'],
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- store.posts`
Expected: FAIL — `store.getScheduledPosts is not a function`.

- [ ] **Step 3: Add the type + function**

In `apps/crm/src/store/posts.ts`, immediately after `getClientePosts` (after its closing `}` near
line 69), add:

```ts
export interface ScheduledPost {
  id: number;
  workflow_id: number;
  cliente_id: number | null;
  cliente_nome: string;
  workflow_titulo: string;
  titulo: string;
  tipo: WorkflowPost['tipo'];
  status: WorkflowPost['status'];
  scheduled_at: string; // non-null (range-filtered)
  published_at: string | null;
  ig_caption: string | null;
  instagram_permalink: string | null;
  publish_error: string | null;
  ordem: number;
  responsavel_id: number | null;
}

/**
 * All posts (across active workflows / all clients) whose scheduled_at falls in
 * [startISO, endISO). workflow_posts has only workflow_id as an FK, so the client
 * name is reached through a nested workflows -> clientes join (mirrors
 * getAllActiveEtapas in store/workflows.ts). RLS enforces conta_id.
 */
export async function getScheduledPosts(
  startISO: string,
  endISO: string,
): Promise<ScheduledPost[]> {
  const { data, error } = await supabase
    .from('workflow_posts')
    .select(
      'id, workflow_id, titulo, tipo, status, scheduled_at, published_at, ig_caption, instagram_permalink, publish_error, ordem, responsavel_id, workflows!inner(titulo, cliente_id, status, clientes!inner(nome))',
    )
    .eq('workflows.status', 'ativo')
    .gte('scheduled_at', startISO)
    .lt('scheduled_at', endISO)
    .order('scheduled_at', { ascending: true });
  if (error) throw error;
  return (data || []).map((row: any) => ({
    id: row.id,
    workflow_id: row.workflow_id,
    cliente_id: row.workflows?.cliente_id ?? null,
    cliente_nome: row.workflows?.clientes?.nome ?? '',
    workflow_titulo: row.workflows?.titulo ?? '',
    titulo: row.titulo,
    tipo: row.tipo,
    status: row.status,
    scheduled_at: row.scheduled_at,
    published_at: row.published_at ?? null,
    ig_caption: row.ig_caption ?? null,
    instagram_permalink: row.instagram_permalink ?? null,
    publish_error: row.publish_error ?? null,
    ordem: row.ordem,
    responsavel_id: row.responsavel_id ?? null,
  }));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- store.posts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/crm/src/store/posts.ts apps/crm/src/__tests__/store.posts.test.ts
git commit -m "feat(store): getScheduledPosts workspace-wide publish agenda query"
```

---

## Task 2: `getInstagramAccountStatuses` + `IgAccountStatus` type

**Files:**
- Modify: `apps/crm/src/store/integrations.ts` (append at end of file)
- Test: `apps/crm/src/__tests__/store.integrations.test.ts` (**new**)

`store/integrations.ts` already imports `supabase` from `./core` (line 1) and `store/index.ts`
already re-exports `./integrations`, so no wiring is needed.

- [ ] **Step 1: Write the failing test**

Create `apps/crm/src/__tests__/store.integrations.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../lib/supabase');

import * as supabaseModule from '../lib/supabase';
import * as store from '../store';

type MockedSupabaseModule = typeof supabaseModule & {
  __getSupabaseCalls: () => Array<{
    table: string;
    operation: string;
    payload?: unknown;
    modifiers: Array<{ method: string; args: unknown[] }>;
  }>;
  __queueSupabaseResult: (
    table: string,
    operation: 'select' | 'insert' | 'update' | 'delete' | 'upsert',
    ...responses: Array<{ data?: unknown; error?: unknown; count?: number | null }>
  ) => void;
  __resetSupabaseMock: () => void;
  __setCurrentProfile: (profile: Record<string, unknown> | null) => void;
};

const mockedSupabase = supabaseModule as MockedSupabaseModule;

describe('getInstagramAccountStatuses', () => {
  beforeEach(() => {
    mockedSupabase.__resetSupabaseMock();
    mockedSupabase.__setCurrentProfile({
      id: 'user-1',
      nome: 'Eduardo Souza',
      role: 'owner',
      conta_id: 'conta-1',
    });
  });

  it('returns an empty map for empty input without querying', async () => {
    const map = await store.getInstagramAccountStatuses([]);
    expect(map.size).toBe(0);
  });

  it('derives revoked / expired / canPublish per client', async () => {
    mockedSupabase.__queueSupabaseResult('instagram_accounts', 'select', {
      data: [
        {
          client_id: 1,
          authorization_status: 'active',
          token_expires_at: '2999-01-01T00:00:00.000Z',
          permissions: ['instagram_business_content_publish'],
        },
        {
          client_id: 2,
          authorization_status: 'revoked',
          token_expires_at: '2999-01-01T00:00:00.000Z',
          permissions: [],
        },
        {
          client_id: 3,
          authorization_status: 'active',
          token_expires_at: '2000-01-01T00:00:00.000Z',
          permissions: ['instagram_business_content_publish'],
        },
      ],
      error: null,
    });

    const map = await store.getInstagramAccountStatuses([1, 2, 3]);

    expect(map.get(1)).toEqual({ revoked: false, expired: false, canPublish: true });
    expect(map.get(2)).toEqual({ revoked: true, expired: false, canPublish: false });
    expect(map.get(3)).toEqual({ revoked: false, expired: true, canPublish: true });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- store.integrations`
Expected: FAIL — `store.getInstagramAccountStatuses is not a function`.

- [ ] **Step 3: Add the type + function**

Append to `apps/crm/src/store/integrations.ts`:

```ts
export interface IgAccountStatus {
  revoked: boolean;
  expired: boolean;
  canPublish: boolean;
}

/**
 * Per-client Instagram account status, scoped to the given client ids. Mirrors the
 * derivation used by WorkflowDrawer's igAccountStatus so inline publish actions gate
 * identically.
 */
export async function getInstagramAccountStatuses(
  clientIds: number[],
): Promise<Map<number, IgAccountStatus>> {
  const result = new Map<number, IgAccountStatus>();
  if (clientIds.length === 0) return result;
  const { data, error } = await supabase
    .from('instagram_accounts')
    .select('client_id, authorization_status, token_expires_at, permissions')
    .in('client_id', clientIds);
  if (error) throw error;
  const now = Date.now();
  for (const row of (data || []) as Array<{
    client_id: number | null;
    authorization_status: string | null;
    token_expires_at: string | null;
    permissions: unknown;
  }>) {
    if (row.client_id == null) continue;
    result.set(row.client_id, {
      revoked: row.authorization_status === 'revoked',
      expired:
        row.authorization_status === 'expired' ||
        (row.token_expires_at ? new Date(row.token_expires_at).getTime() < now : false),
      canPublish:
        Array.isArray(row.permissions) &&
        row.permissions.includes('instagram_business_content_publish'),
    });
  }
  return result;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- store.integrations`
Expected: PASS (both cases).

- [ ] **Step 5: Commit**

```bash
git add apps/crm/src/store/integrations.ts apps/crm/src/__tests__/store.integrations.test.ts
git commit -m "feat(store): scoped getInstagramAccountStatuses for publish gating"
```

---

## Task 3: Extract shared post-date formatters + label maps

Pure refactor (no behavior change) so the new panel can reuse the drawer's date formatter and
status/type labels without duplication.

**Files:**
- Create: `apps/crm/src/utils/postDate.ts`
- Create: `apps/crm/src/pages/entregas/postLabels.ts`
- Modify: `apps/crm/src/pages/entregas/components/WorkflowDrawer.tsx` (remove the local copies, import instead)
- Test: `apps/crm/src/__tests__/postDate.test.ts` (**new**)

- [ ] **Step 1: Write the failing test**

Create `apps/crm/src/__tests__/postDate.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { formatPostDate, formatPostDateFull } from '../utils/postDate';

describe('formatPostDate', () => {
  it('omits the year in the current year and drops minutes when :00', () => {
    const d = new Date(new Date().getFullYear(), 5, 8, 14, 0); // 8 Jun 14:00, current year
    expect(formatPostDate(d.toISOString())).toBe('8 jun · 14h');
  });

  it('shows minutes when non-zero', () => {
    const d = new Date(new Date().getFullYear(), 5, 18, 18, 30);
    expect(formatPostDate(d.toISOString())).toBe('18 jun · 18h30');
  });

  it('returns empty string for an invalid date', () => {
    expect(formatPostDate('not-a-date')).toBe('');
    expect(formatPostDateFull('not-a-date')).toBe('');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- postDate`
Expected: FAIL — cannot resolve `../utils/postDate`.

- [ ] **Step 3: Create `utils/postDate.ts`**

Create `apps/crm/src/utils/postDate.ts` (lifted verbatim from `WorkflowDrawer.tsx`):

```ts
const MESES_ABREV = [
  'jan',
  'fev',
  'mar',
  'abr',
  'mai',
  'jun',
  'jul',
  'ago',
  'set',
  'out',
  'nov',
  'dez',
];

// Compact pt-BR publish-date label, e.g. "8 jun · 14h" or "18 jul · 18h30".
// Minutes show only when non-zero; the year is appended only when it differs from
// the current year, so an off-year date never reads ambiguously.
export function formatPostDate(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  const ano = d.getFullYear() !== new Date().getFullYear() ? ` ${d.getFullYear()}` : '';
  const hh = String(d.getHours()).padStart(2, '0');
  const min = d.getMinutes();
  const hora = min === 0 ? `${hh}h` : `${hh}h${String(min).padStart(2, '0')}`;
  return `${d.getDate()} ${MESES_ABREV[d.getMonth()]}${ano} · ${hora}`;
}

// Full, readable form for tooltips, e.g. "8 de junho de 2026, 14:00".
export function formatPostDateFull(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  return d.toLocaleString('pt-BR', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}
```

- [ ] **Step 4: Create `pages/entregas/postLabels.ts`**

Create `apps/crm/src/pages/entregas/postLabels.ts` (lifted verbatim from `WorkflowDrawer.tsx`):

```ts
import type { WorkflowPost } from '../../store';

export const TIPO_LABELS: Record<WorkflowPost['tipo'], string> = {
  feed: 'Feed',
  reels: 'Reels',
  stories: 'Stories',
  carrossel: 'Carrossel',
};

export const STATUS_LABELS: Record<WorkflowPost['status'], string> = {
  rascunho: 'Rascunho',
  revisao_interna: 'Em revisão',
  aprovado_interno: 'Aprovado internamente',
  enviado_cliente: 'Enviado ao cliente',
  aprovado_cliente: 'Aprovado pelo cliente',
  correcao_cliente: 'Correção solicitada',
  agendado: 'Agendado',
  postado: 'Postado',
  falha_publicacao: 'Falha na publicação',
};

export const STATUS_CLASS: Record<WorkflowPost['status'], string> = {
  rascunho: 'post-status--rascunho',
  revisao_interna: 'post-status--revisao',
  aprovado_interno: 'post-status--aprovado-interno',
  enviado_cliente: 'post-status--enviado',
  aprovado_cliente: 'post-status--aprovado-cliente',
  correcao_cliente: 'post-status--correcao',
  agendado: 'post-status--agendado',
  postado: 'post-status--postado',
  falha_publicacao: 'status-danger',
};
```

- [ ] **Step 5: Remove the local copies in `WorkflowDrawer.tsx` and import**

In `apps/crm/src/pages/entregas/components/WorkflowDrawer.tsx`:

a) **Delete** the local declarations `TIPO_LABELS` (~98), `STATUS_LABELS` (~105),
`STATUS_CLASS` (~117), `MESES_ABREV` (~129), `formatPostDate` (~147), and `formatPostDateFull`
(~158) — i.e. everything in the `// ── Helpers ──` block from `const TIPO_LABELS` through the end
of `formatPostDateFull`.

b) **Add** these imports near the other relative imports (e.g. just after the `./PostEditor`
import group):

```ts
import { TIPO_LABELS, STATUS_LABELS, STATUS_CLASS } from '../postLabels';
import { formatPostDate, formatPostDateFull } from '@/utils/postDate';
```

(The `// ── Helpers ──` comment can stay or go; everything it contained now lives in the two new
modules. No call sites change — names are identical.)

- [ ] **Step 6: Run test + typecheck**

Run: `npm run test -- postDate`
Expected: PASS.
Run: `npm run build`
Expected: tsc passes (no unused-symbol or missing-import errors in `WorkflowDrawer.tsx`).

- [ ] **Step 7: Commit**

```bash
git add apps/crm/src/utils/postDate.ts apps/crm/src/pages/entregas/postLabels.ts \
  apps/crm/src/pages/entregas/components/WorkflowDrawer.tsx apps/crm/src/__tests__/postDate.test.ts
git commit -m "refactor(entregas): extract shared post-date + label helpers"
```

---

## Task 4: Pure scheduled-posts helpers

**Files:**
- Create: `apps/crm/src/pages/entregas/hooks/scheduledPostsUtils.ts`
- Test: `apps/crm/src/__tests__/scheduledPostsUtils.test.ts` (**new**)

- [ ] **Step 1: Write the failing test**

Create `apps/crm/src/__tests__/scheduledPostsUtils.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  monthRangeISO,
  dateDayKey,
  localDayKey,
  bucketByLocalDay,
  summarizeDay,
} from '../pages/entregas/hooks/scheduledPostsUtils';
import type { ScheduledPost } from '../store';

function mk(
  partial: Partial<ScheduledPost> & {
    id: number;
    scheduled_at: string;
    status: ScheduledPost['status'];
  },
): ScheduledPost {
  return {
    workflow_id: 1,
    cliente_id: 1,
    cliente_nome: 'C',
    workflow_titulo: 'W',
    titulo: 'T',
    tipo: 'feed',
    published_at: null,
    ig_caption: null,
    instagram_permalink: null,
    publish_error: null,
    ordem: 0,
    responsavel_id: null,
    ...partial,
  };
}

describe('scheduledPostsUtils', () => {
  it('monthRangeISO returns local-midnight bounds for the month', () => {
    const { startISO, endISO } = monthRangeISO(new Date(2026, 5, 1));
    expect(startISO).toBe(new Date(2026, 5, 1).toISOString());
    expect(endISO).toBe(new Date(2026, 6, 1).toISOString());
  });

  it('buckets by LOCAL day (an 11pm-local post stays on its local day)', () => {
    const lateNight = new Date(2026, 5, 16, 23, 0, 0);
    expect(dateDayKey(lateNight)).toBe('2026-5-16');
    expect(localDayKey(lateNight.toISOString())).toBe('2026-5-16');
  });

  it('bucketByLocalDay groups posts by local day key', () => {
    const a = mk({ id: 1, scheduled_at: new Date(2026, 5, 16, 9, 0).toISOString(), status: 'aprovado_cliente' });
    const b = mk({ id: 2, scheduled_at: new Date(2026, 5, 16, 20, 0).toISOString(), status: 'agendado' });
    const c = mk({ id: 3, scheduled_at: new Date(2026, 5, 17, 9, 0).toISOString(), status: 'postado' });
    const map = bucketByLocalDay([a, b, c]);
    expect(map.get('2026-5-16')?.map((p) => p.id)).toEqual([1, 2]);
    expect(map.get('2026-5-17')?.map((p) => p.id)).toEqual([3]);
  });

  it('summarizeDay counts total, postados and falhas', () => {
    const posts = [
      mk({ id: 1, scheduled_at: '2026-06-16T12:00:00.000Z', status: 'aprovado_cliente' }),
      mk({ id: 2, scheduled_at: '2026-06-16T12:00:00.000Z', status: 'postado' }),
      mk({ id: 3, scheduled_at: '2026-06-16T12:00:00.000Z', status: 'postado' }),
      mk({ id: 4, scheduled_at: '2026-06-16T12:00:00.000Z', status: 'falha_publicacao' }),
    ];
    expect(summarizeDay(posts)).toEqual({ total: 4, postados: 2, falhas: 1 });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- scheduledPostsUtils`
Expected: FAIL — cannot resolve the helpers module.

- [ ] **Step 3: Create the helpers**

Create `apps/crm/src/pages/entregas/hooks/scheduledPostsUtils.ts`:

```ts
import type { ScheduledPost } from '../../../store';

/** Local-midnight [start, nextMonthStart) ISO bounds for the given month. */
export function monthRangeISO(month: Date): { startISO: string; endISO: string } {
  const y = month.getFullYear();
  const m = month.getMonth();
  return {
    startISO: new Date(y, m, 1).toISOString(),
    endISO: new Date(y, m + 1, 1).toISOString(),
  };
}

/** Day key from a Date, using LOCAL components: "YYYY-M-D" (month 0-based). */
export function dateDayKey(date: Date): string {
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

/** Day key from an ISO timestamp, bucketed by the viewer's LOCAL day. */
export function localDayKey(iso: string): string {
  return dateDayKey(new Date(iso));
}

export function bucketByLocalDay(posts: ScheduledPost[]): Map<string, ScheduledPost[]> {
  const map = new Map<string, ScheduledPost[]>();
  for (const p of posts) {
    const key = localDayKey(p.scheduled_at);
    const arr = map.get(key);
    if (arr) arr.push(p);
    else map.set(key, [p]);
  }
  return map;
}

/** Cell summary: total scheduled, plus already-posted and failed counts. */
export function summarizeDay(posts: ScheduledPost[]): {
  total: number;
  postados: number;
  falhas: number;
} {
  let postados = 0;
  let falhas = 0;
  for (const p of posts) {
    if (p.status === 'postado') postados++;
    else if (p.status === 'falha_publicacao') falhas++;
  }
  return { total: posts.length, postados, falhas };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- scheduledPostsUtils`
Expected: PASS (all four cases).

- [ ] **Step 5: Commit**

```bash
git add apps/crm/src/pages/entregas/hooks/scheduledPostsUtils.ts \
  apps/crm/src/__tests__/scheduledPostsUtils.test.ts
git commit -m "feat(entregas): pure scheduled-posts bucketing + summary helpers"
```

---

## Task 5: `useScheduledPosts` hook

**Files:**
- Create: `apps/crm/src/pages/entregas/hooks/useScheduledPosts.ts`

No new unit test — the hook is thin glue over the Task-4 helpers (tested) and TanStack Query;
it's verified by typecheck here and the manual checklist in Task 10.

- [ ] **Step 1: Create the hook**

Create `apps/crm/src/pages/entregas/hooks/useScheduledPosts.ts`:

```ts
import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getScheduledPosts, getInstagramAccountStatuses, type IgAccountStatus } from '../../../store';
import { monthRangeISO, bucketByLocalDay } from './scheduledPostsUtils';

/**
 * Workspace-wide scheduled posts for `month`, bucketed by local day, plus a
 * client-scoped Instagram account-status map for inline publish gating.
 *
 * `enabled` MUST be passed explicitly: CalendarView is mounted for the whole
 * Calendar tab regardless of its internal mode, so mounting alone does not gate
 * the fetch. Pass `mode === 'publicacoes'`.
 */
export function useScheduledPosts(month: Date, enabled: boolean) {
  const { startISO, endISO } = monthRangeISO(month);

  const postsQuery = useQuery({
    queryKey: ['scheduled-posts', startISO, endISO],
    queryFn: () => getScheduledPosts(startISO, endISO),
    enabled,
  });

  const posts = useMemo(() => postsQuery.data ?? [], [postsQuery.data]);

  const clientIds = useMemo(
    () =>
      Array.from(
        new Set(posts.map((p) => p.cliente_id).filter((id): id is number => id != null)),
      ).sort((a, b) => a - b),
    [posts],
  );

  const igQuery = useQuery({
    queryKey: ['ig-account-statuses', clientIds.join(',')],
    queryFn: () => getInstagramAccountStatuses(clientIds),
    enabled: enabled && !postsQuery.isLoading && clientIds.length > 0,
  });

  const byDay = useMemo(() => bucketByLocalDay(posts), [posts]);

  return {
    byDay,
    igStatuses: igQuery.data ?? new Map<number, IgAccountStatus>(),
    isLoading: postsQuery.isLoading,
  };
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run build`
Expected: tsc passes.

- [ ] **Step 3: Commit**

```bash
git add apps/crm/src/pages/entregas/hooks/useScheduledPosts.ts
git commit -m "feat(entregas): useScheduledPosts month hook with scoped IG statuses"
```

---

## Task 6: `PublicacoesPanel` component

**Files:**
- Create: `apps/crm/src/pages/entregas/components/PublicacoesPanel.tsx`

Presentational; reuses existing `.scheduled-panel` / `.scheduled-list` / `.scheduled-item` CSS,
the `ScheduleButton` for actions, and `sanitizeUrl` for the external Instagram permalink (security
rule — `href` from external data MUST be sanitized). Verified by typecheck + Task 10 manual checks.

- [ ] **Step 1: Create the component**

Create `apps/crm/src/pages/entregas/components/PublicacoesPanel.tsx`:

```tsx
import { ExternalLink, ChevronRight } from 'lucide-react';
import type { ScheduledPost, WorkflowPost, IgAccountStatus } from '@/store';
import { ScheduleButton } from './ScheduleButton';
import { formatPostDate } from '@/utils/postDate';
import { TIPO_LABELS, STATUS_LABELS, STATUS_CLASS } from '../postLabels';
import { sanitizeUrl } from '@/router';

interface PublicacoesPanelProps {
  posts: ScheduledPost[];
  igStatuses: Map<number, IgAccountStatus>;
  openableWorkflowIds: Set<number>;
  isLoading: boolean;
  selectedLabel: string | null;
  onPostClick: (workflowId: number, postId: number) => void;
  onStatusChange: () => void;
}

// ScheduleButton only reads id/status/scheduled_at/ig_caption/publish_error; the
// rest are filled with inert defaults so we never fetch the heavy `conteudo`.
function toWorkflowPost(p: ScheduledPost): WorkflowPost {
  return {
    id: p.id,
    workflow_id: p.workflow_id,
    titulo: p.titulo,
    conteudo: null,
    conteudo_plain: '',
    tipo: p.tipo,
    ordem: p.ordem,
    status: p.status,
    responsavel_id: p.responsavel_id,
    scheduled_at: p.scheduled_at,
    ig_caption: p.ig_caption,
    instagram_permalink: p.instagram_permalink,
    published_at: p.published_at,
    publish_error: p.publish_error,
  };
}

export function PublicacoesPanel({
  posts,
  igStatuses,
  openableWorkflowIds,
  isLoading,
  selectedLabel,
  onPostClick,
  onStatusChange,
}: PublicacoesPanelProps) {
  return (
    <div className="scheduled-panel">
      <div className="scheduled-header">
        <h3>Publicações</h3>
        <p>{selectedLabel ?? 'Selecione um dia.'}</p>
      </div>
      <div className="scheduled-list">
        {isLoading ? (
          <div style={{ textAlign: 'center', padding: '2rem 0', color: 'var(--text-muted)' }}>
            <p>Carregando…</p>
          </div>
        ) : posts.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '2rem 0', color: 'var(--text-muted)' }}>
            <p>{selectedLabel ? 'Nenhuma publicação neste dia.' : 'Selecione um dia.'}</p>
          </div>
        ) : (
          posts.map((p) => {
            const openable = openableWorkflowIds.has(p.workflow_id);
            const igStatus = p.cliente_id != null ? (igStatuses.get(p.cliente_id) ?? null) : null;
            const hasInstagramAccount = igStatus != null;
            const safePermalink =
              p.status === 'postado' && p.instagram_permalink
                ? sanitizeUrl(p.instagram_permalink)
                : null;
            return (
              <div
                key={p.id}
                className="scheduled-item"
                style={{ cursor: openable ? 'pointer' : 'default' }}
                onClick={openable ? () => onPostClick(p.workflow_id, p.id) : undefined}
              >
                <div className="item-top">
                  <span className="post-tipo-badge">{TIPO_LABELS[p.tipo]}</span>
                  <span className={`post-status-chip ${STATUS_CLASS[p.status]}`}>
                    {STATUS_LABELS[p.status]}
                  </span>
                </div>
                <div className="item-title">{p.cliente_nome || '—'}</div>
                <div className="item-subtitle">{p.titulo || 'Post sem título'}</div>
                <div className="item-divider" />
                <div className="item-meta">{formatPostDate(p.scheduled_at)}</div>

                {/* Inline actions; ScheduleButton renders nothing when the post is not
                    actionable or the client has no IG account. Stop propagation so its
                    buttons/dialogs don't trigger the row's drawer-open click. */}
                <div onClick={(e) => e.stopPropagation()}>
                  <ScheduleButton
                    post={toWorkflowPost(p)}
                    hasInstagramAccount={hasInstagramAccount}
                    igAccountStatus={igStatus}
                    onStatusChange={onStatusChange}
                  />
                </div>

                {safePermalink && (
                  <a
                    href={safePermalink}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={(e) => e.stopPropagation()}
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 4,
                      fontSize: '0.75rem',
                      color: 'var(--primary-color)',
                      marginTop: 8,
                    }}
                  >
                    <ExternalLink className="h-3 w-3" /> Ver no Instagram
                  </a>
                )}

                {openable && (
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 2,
                      fontSize: '0.7rem',
                      color: 'var(--text-muted)',
                      marginTop: 8,
                    }}
                  >
                    Abrir no fluxo <ChevronRight className="h-3 w-3" />
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run build`
Expected: tsc passes. (If `sanitizeUrl` is not exported from `@/router`, import it from
`@/utils/security` instead — verify with `grep -n "export.*sanitizeUrl" apps/crm/src/router.ts`.)

- [ ] **Step 3: Commit**

```bash
git add apps/crm/src/pages/entregas/components/PublicacoesPanel.tsx
git commit -m "feat(entregas): PublicacoesPanel day list with inline schedule/publish"
```

---

## Task 7: `WorkflowDrawer` accepts `initialPostId`

**Files:**
- Modify: `apps/crm/src/pages/entregas/components/WorkflowDrawer.tsx`

- [ ] **Step 1: Add the prop to the interface**

In `WorkflowDrawerProps` add `initialPostId?: number`:

```ts
interface WorkflowDrawerProps {
  card: BoardCard;
  membros: Membro[];
  onClose: () => void;
  onRefresh: () => void;
  initialPostId?: number;
}
```

- [ ] **Step 2: Destructure and seed `expandedId`**

Change the function signature and the `expandedId` initializer:

```ts
export function WorkflowDrawer({ card, membros, onClose, onRefresh, initialPostId }: WorkflowDrawerProps) {
```

```ts
// Expanded post id (accordion). Seeded from initialPostId when opened from the
// calendar; the call site keys the drawer by initialPostId so a new target remounts.
const [expandedId, setExpandedId] = useState<number | null>(initialPostId ?? null);
```

(The element is remounted via `key` in Task 9, so the initial value is honored on each open. No
effect is required.)

- [ ] **Step 3: Typecheck**

Run: `npm run build`
Expected: tsc passes.

- [ ] **Step 4: Commit**

```bash
git add apps/crm/src/pages/entregas/components/WorkflowDrawer.tsx
git commit -m "feat(entregas): WorkflowDrawer initialPostId to pre-expand a post"
```

---

## Task 8: `CalendarView` mode toggle + Publicações branch

**Files:**
- Modify (full rewrite): `apps/crm/src/pages/entregas/views/CalendarView.tsx`

- [ ] **Step 1: Replace the file contents**

Overwrite `apps/crm/src/pages/entregas/views/CalendarView.tsx` with:

```tsx
import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { isSameDay } from 'date-fns';
import type { BoardCard } from '../hooks/useEntregasData';
import { computeDeadlineDate, computeWorkflowDeadlineDate } from '../hooks/useEntregasData';
import { MonthGrid } from '@/components/ui/month-grid';
import { useScheduledPosts } from '../hooks/useScheduledPosts';
import { dateDayKey, summarizeDay } from '../hooks/scheduledPostsUtils';
import { PublicacoesPanel } from '../components/PublicacoesPanel';

export type CalendarMode = 'entregas' | 'publicacoes';

interface CalendarViewProps {
  cards: BoardCard[];
  onCardClick: (card: BoardCard) => void;
  mode: CalendarMode;
  onModeChange: (mode: CalendarMode) => void;
  openableWorkflowIds: Set<number>;
  onPostClick: (workflowId: number, postId: number) => void;
}

interface CalendarEvent {
  card: BoardCard;
  type: 'etapa' | 'workflow';
  date: Date;
}

const monthNames = [
  'Janeiro',
  'Fevereiro',
  'Março',
  'Abril',
  'Maio',
  'Junho',
  'Julho',
  'Agosto',
  'Setembro',
  'Outubro',
  'Novembro',
  'Dezembro',
];

export function CalendarView({
  cards,
  onCardClick,
  mode,
  onModeChange,
  openableWorkflowIds,
  onPostClick,
}: CalendarViewProps) {
  const qc = useQueryClient();
  const today = new Date();
  const [currentDate, setCurrentDate] = useState(
    new Date(today.getFullYear(), today.getMonth(), 1),
  );
  const [selectedDay, setSelectedDay] = useState<number | null>(today.getDate());

  const year = currentDate.getFullYear();
  const month = currentDate.getMonth();

  // ── Entregas mode: etapa / workflow deadline events ──
  const events: CalendarEvent[] = [];
  for (const card of cards) {
    if (card.etapa.iniciado_em) {
      const etapaDeadline = computeDeadlineDate(
        card.etapa.iniciado_em,
        card.etapa.prazo_dias,
        card.etapa.tipo_prazo,
      );
      if (etapaDeadline.getFullYear() === year && etapaDeadline.getMonth() === month) {
        events.push({ card, type: 'etapa', date: etapaDeadline });
      }
      const wfDeadline = computeWorkflowDeadlineDate(card.allEtapas, card.etapa);
      if (wfDeadline && wfDeadline.getFullYear() === year && wfDeadline.getMonth() === month) {
        if (!isSameDay(wfDeadline, etapaDeadline)) {
          events.push({ card, type: 'workflow', date: wfDeadline });
        }
      }
    }
  }
  const selectedEvents = selectedDay
    ? events.filter(
        (e) =>
          e.date.getDate() === selectedDay &&
          e.date.getMonth() === month &&
          e.date.getFullYear() === year,
      )
    : [];

  // ── Publicações mode: scheduled posts ──
  const { byDay, igStatuses, isLoading: postsLoading } = useScheduledPosts(
    currentDate,
    mode === 'publicacoes',
  );
  const selectedPosts =
    selectedDay != null ? (byDay.get(`${year}-${month}-${selectedDay}`) ?? []) : [];
  const selectedLabel = selectedDay ? `${selectedDay} de ${monthNames[month]}, ${year}` : null;

  const handleStatusChange = () => {
    qc.invalidateQueries({ queryKey: ['scheduled-posts'] });
    qc.invalidateQueries({ queryKey: ['workflow-posts-counts'] });
    qc.invalidateQueries({ queryKey: ['workflow-posts-with-props'] });
  };

  const toggle = (
    <div
      style={{
        display: 'flex',
        gap: '0.25rem',
        background: 'var(--surface-2)',
        padding: '0.25rem',
        borderRadius: 8,
        width: 'fit-content',
      }}
    >
      {(
        [
          ['entregas', 'Entregas'],
          ['publicacoes', 'Publicações'],
        ] as const
      ).map(([id, label]) => (
        <button
          key={id}
          onClick={() => onModeChange(id)}
          style={{
            padding: '0.35rem 0.85rem',
            borderRadius: 6,
            border: 'none',
            cursor: 'pointer',
            fontSize: '0.8rem',
            background: mode === id ? '#000' : 'transparent',
            color: mode === id ? '#fff' : 'var(--text-secondary)',
            fontWeight: mode === id ? 600 : 400,
          }}
        >
          {label}
        </button>
      ))}
    </div>
  );

  if (mode === 'entregas' && cards.length === 0) {
    return (
      <div
        className="animate-up"
        style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}
      >
        {toggle}
        <div
          className="card"
          style={{ textAlign: 'center', padding: '3rem', color: 'var(--text-muted)' }}
        >
          <p>Nenhuma entrega encontrada. Ajuste os filtros.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="animate-up" style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
      {toggle}
      <div className="calendar-layout">
        <div className="calendar-main">
          <MonthGrid
            currentMonth={currentDate}
            onMonthChange={(d) => {
              setCurrentDate(d);
              setSelectedDay(null);
            }}
            renderCell={(date, isCurrentMonth) => {
              if (!isCurrentMonth) return <div className="calendar-day empty" />;
              const d = date.getDate();
              const isToday = isSameDay(date, today);
              const selectedCls = selectedDay === d ? 'selected' : '';

              if (mode === 'entregas') {
                const dayEvents = events.filter((e) => isSameDay(e.date, date));
                const hasEvents = dayEvents.length > 0;
                const etapaCount = dayEvents.filter((e) => e.type === 'etapa').length;
                const wfCount = dayEvents.filter((e) => e.type === 'workflow').length;
                return (
                  <div
                    className={`calendar-day ${isToday ? 'today' : ''} ${selectedCls} ${hasEvents ? 'has-events' : ''}`}
                    onClick={() => setSelectedDay(d)}
                  >
                    <span className="day-number">{d}</span>
                    <div className="day-events">
                      {etapaCount > 0 && (
                        <div className="event-pill deadline">
                          ⚑ {etapaCount} Etapa{etapaCount > 1 ? 's' : ''}
                        </div>
                      )}
                      {wfCount > 0 && (
                        <div
                          className="event-pill"
                          style={{
                            background: 'rgba(249, 115, 22, 0.12)',
                            color: '#f97316',
                            fontWeight: 600,
                          }}
                        >
                          ◎ {wfCount} Conclus.
                        </div>
                      )}
                    </div>
                  </div>
                );
              }

              const dayPosts = byDay.get(dateDayKey(date)) ?? [];
              const { total, postados, falhas } = summarizeDay(dayPosts);
              return (
                <div
                  className={`calendar-day ${isToday ? 'today' : ''} ${selectedCls} ${total > 0 ? 'has-events' : ''}`}
                  onClick={() => setSelectedDay(d)}
                >
                  <span className="day-number">{d}</span>
                  <div className="day-events">
                    {total > 0 && (
                      <div
                        className="event-pill"
                        style={{
                          background: 'rgba(168, 85, 247, 0.12)',
                          color: '#a855f7',
                          fontWeight: 600,
                        }}
                      >
                        📷 {total} post{total > 1 ? 's' : ''}
                      </div>
                    )}
                    {postados > 0 && (
                      <div
                        className="event-pill"
                        style={{
                          background: 'rgba(62, 207, 142, 0.12)',
                          color: '#3ecf8e',
                          fontWeight: 600,
                        }}
                      >
                        ✓ {postados}
                      </div>
                    )}
                    {falhas > 0 && (
                      <div
                        className="event-pill"
                        style={{
                          background: 'rgba(245, 90, 66, 0.12)',
                          color: '#f55a42',
                          fontWeight: 600,
                        }}
                      >
                        ⚠ {falhas}
                      </div>
                    )}
                  </div>
                </div>
              );
            }}
          />
        </div>

        {mode === 'entregas' ? (
          <div className="scheduled-panel">
            <div className="scheduled-header">
              <h3>Entregas</h3>
              <p>
                {selectedDay
                  ? `${selectedDay} de ${monthNames[month]}, ${year}`
                  : `${monthNames[month]} ${year}`}
              </p>
            </div>
            <div className="scheduled-list">
              {selectedEvents.length === 0 ? (
                <div
                  style={{ textAlign: 'center', padding: '2rem 0', color: 'var(--text-muted)' }}
                >
                  <p>{selectedDay ? 'Nenhuma entrega neste dia.' : 'Selecione um dia.'}</p>
                </div>
              ) : (
                selectedEvents.map((ev, i) => (
                  <div
                    key={i}
                    className="scheduled-item"
                    style={{ cursor: 'pointer' }}
                    onClick={() => onCardClick(ev.card)}
                  >
                    <div className="item-top">
                      <div
                        className="item-badge"
                        style={{ background: ev.type === 'etapa' ? '#a855f7' : '#f97316' }}
                      />
                      <span className="badge" style={{ fontSize: '0.65rem' }}>
                        {ev.type === 'etapa' ? '⚑ PRAZO DA ETAPA' : '◎ CONCLUSÃO PREVISTA'}
                      </span>
                    </div>
                    <div className="item-title">{ev.card.workflow.titulo}</div>
                    <div className="item-subtitle">
                      {ev.card.cliente?.nome || '—'} · ETAPA: {ev.card.etapa.nome}
                    </div>
                    <div className="item-divider" />
                    <div className="item-meta">{ev.date.toLocaleDateString('pt-BR')}</div>
                  </div>
                ))
              )}
            </div>
          </div>
        ) : (
          <PublicacoesPanel
            posts={selectedPosts}
            igStatuses={igStatuses}
            openableWorkflowIds={openableWorkflowIds}
            isLoading={postsLoading}
            selectedLabel={selectedLabel}
            onPostClick={onPostClick}
            onStatusChange={handleStatusChange}
          />
        )}
      </div>

      {mode === 'entregas' && (
        <div
          style={{
            display: 'flex',
            gap: '1.5rem',
            fontSize: '0.75rem',
            color: 'var(--text-muted)',
          }}
        >
          <span style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
            <span
              style={{
                width: 10,
                height: 10,
                borderRadius: '50%',
                background: '#a855f7',
                display: 'inline-block',
              }}
            />{' '}
            Prazo da etapa
          </span>
          <span style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
            <span
              style={{
                width: 10,
                height: 10,
                borderRadius: '50%',
                background: '#f97316',
                display: 'inline-block',
              }}
            />{' '}
            Conclusão prevista
          </span>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run build`
Expected: tsc fails ONLY in `EntregasPage.tsx` (CalendarView now requires `mode`,
`onModeChange`, `openableWorkflowIds`, `onPostClick`). That is fixed in Task 9. CalendarView
itself should have no errors.

- [ ] **Step 3: Commit**

```bash
git add apps/crm/src/pages/entregas/views/CalendarView.tsx
git commit -m "feat(entregas): calendar Entregas/Publicações mode toggle + post cells"
```

---

## Task 9: Wire `EntregasPage`

**Files:**
- Modify: `apps/crm/src/pages/entregas/EntregasPage.tsx`

- [ ] **Step 1: Add mode + initial-post state**

After `const [recurringWfId, setRecurringWfId] = useState<number | null>(null);` (~line 52), add:

```tsx
  const [calendarMode, setCalendarMode] = useState<'entregas' | 'publicacoes'>('entregas');
  const [drawerInitialPostId, setDrawerInitialPostId] = useState<number | null>(null);
```

- [ ] **Step 2: Add memoized maps + handlers**

After the `etapaNames` `useMemo` block (ends ~line 95), add:

```tsx
  // Resolve a post's workflow back to its board card (O(1)) for drawer opening.
  // Built from the UNFILTERED cards so a filtered-out workflow's post is still openable.
  const cardsByWorkflowId = useMemo(
    () => new Map(cards.map((c) => [c.workflow.id!, c])),
    [cards],
  );
  const openableWorkflowIds = useMemo(
    () => new Set(cards.map((c) => c.workflow.id!)),
    [cards],
  );

  const handleCardClick = (card: BoardCard) => {
    setDrawerInitialPostId(null);
    setDrawerCard(card);
  };
  const handlePostClick = (workflowId: number, postId: number) => {
    const card = cardsByWorkflowId.get(workflowId);
    if (!card) return;
    setDrawerInitialPostId(postId);
    setDrawerCard(card);
  };
```

- [ ] **Step 3: Hide the filter bar in Publicações mode**

Change the filters guard (~line 225) from:

```tsx
      {activeView !== 'concluded' && (
        <EntregasFilters
```

to:

```tsx
      {activeView !== 'concluded' &&
        !(activeView === 'calendar' && calendarMode === 'publicacoes') && (
        <EntregasFilters
```

(The closing `)}` for this block is unchanged.)

- [ ] **Step 4: Pass the new props to CalendarView**

Change the calendar render (~line 252) from:

```tsx
      {activeView === 'calendar' && (
        <CalendarView cards={filteredCards} onCardClick={setDrawerCard} />
      )}
```

to:

```tsx
      {activeView === 'calendar' && (
        <CalendarView
          cards={filteredCards}
          onCardClick={handleCardClick}
          mode={calendarMode}
          onModeChange={setCalendarMode}
          openableWorkflowIds={openableWorkflowIds}
          onPostClick={handlePostClick}
        />
      )}
```

- [ ] **Step 5: Key the drawer + pass `initialPostId` + clear on close**

Change the drawer render (~line 298) from:

```tsx
      {drawerCard && (
        <WorkflowDrawer
          card={drawerCard}
          membros={membros}
          onClose={() => setDrawerCard(null)}
          onRefresh={refresh}
        />
      )}
```

to:

```tsx
      {drawerCard && (
        <WorkflowDrawer
          key={`${drawerCard.workflow.id}:${drawerInitialPostId ?? ''}`}
          card={drawerCard}
          initialPostId={drawerInitialPostId ?? undefined}
          membros={membros}
          onClose={() => {
            setDrawerCard(null);
            setDrawerInitialPostId(null);
          }}
          onRefresh={refresh}
        />
      )}
```

- [ ] **Step 6: Typecheck + full test run**

Run: `npm run build`
Expected: tsc + vite build pass (no errors).
Run: `npm run test`
Expected: all suites pass (including the three new tests from Tasks 1–4).

- [ ] **Step 7: Commit**

```bash
git add apps/crm/src/pages/entregas/EntregasPage.tsx
git commit -m "feat(entregas): wire calendar Publicações mode + post-click drawer"
```

---

## Task 10: Verification & manual smoke test

**Files:** none (verification only).

- [ ] **Step 1: Build + test + format/lint green**

Run: `npm run build`  → Expected: pass.
Run: `npm run test`   → Expected: pass.
Run (CI gates per project memory): `npm run format:check && npm run lint` if present → fix any
issues in the touched files.

- [ ] **Step 2: Manual smoke (run `npm run dev`, open Entregas → Calendário)**

Per-status row behavior in Publicações mode (must match the spec bucket table):
- `aprovado_cliente` (with `scheduled_at` + caption + connected IG) → **Agendar publicação** +
  **Publicar agora**; clicking Publicar shows the confirm + progress dialog.
- `agendado` → **Agendado** + **Cancelar**.
- `falha_publicacao` → **Tentar novamente** with the error text.
- `postado` → no action buttons; **Ver no Instagram** link.
- not-ready (`rascunho`/`revisao_interna`/`aprovado_interno`/`enviado_cliente`/`correcao_cliente`)
  → status chip only, no action buttons.
- Client with **no** IG account → no schedule/publish buttons (ScheduleButton renders nothing).

General:
- Toggling **Entregas / Publicações** hides/shows the top filter bar.
- Publicações cell pill counts (`📷 N`, `✓ N`, `⚠ N`) match the selected day's rows.
- An inline Agendar/Publicar/Cancelar/Retry action refreshes both the cell counts and the open
  day's rows (via the prefix invalidations).
- Clicking a row whose workflow is active opens the drawer **pre-expanded to that post**; doing
  it twice for different posts opens the correct one each time (key-based remount).
- A row whose `workflow_id` is not in `openableWorkflowIds` is non-clickable and shows no
  "Abrir no fluxo" affordance.
- A near-midnight post (e.g. 23:30 local) appears on its **local** day, matching the time the
  drawer shows.

---

## Self-review notes (coverage map)

- Spec "Data layer / getScheduledPosts" → Task 1. "IG-status query" → Task 2.
- "Timezone / day bucketing" + "summary buckets" → Task 4 (+ used in Tasks 5/8).
- "useScheduledPosts(month, enabled)" → Task 5.
- "PublicacoesPanel" + ScheduleButton reuse + no-IG behavior + sanitized permalink → Task 6.
- "WorkflowDrawer initialPostId" → Task 7; "key, not mounted-fresh" → Task 9 Step 5.
- "CalendarView mode toggle / cell pills / panel branch / invalidation" → Task 8.
- "Lift mode to EntregasPage; hide filter bar; unfiltered cards for resolution" → Task 9.
- "Extract formatPostDate" + DRY labels → Task 3.
- Tests + manual matrix → Tasks 1–4, 10.
```
