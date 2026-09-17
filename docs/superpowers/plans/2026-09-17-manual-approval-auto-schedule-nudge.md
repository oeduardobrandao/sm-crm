# Manual-Approval Auto-Schedule Nudge — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When someone on the agency team marks a flow post as `aprovado_cliente` directly in the CRM (kanban drag, drawer status dropdown, or "aprovar internamente"), and that client has `auto_publish_on_approval = true`, the CRM offers to schedule the post right there — plus a persistent indicator on the posts already stuck in that state — instead of silently doing nothing because the auto-schedule logic only lives in `hub-approve`.

**Architecture:** No new edge function, table, column or migration. One new pure-logic module (`autoScheduleNudge.ts`) holds the eligibility and gate rules; one new thin module (`scheduleApprovedPost.ts`) holds the platform-routing branch extracted out of `ScheduleButton.handleSchedule`, so the existing "Agendar publicação" button and the three new surfaces all call the same code. Two new dialog components consume those: a single-post prompt (used by the individual-transition nudge and by the persistent per-post indicator) and a batch summary (used by the two "aprovar internamente" call sites). Every surface is gated on three conditions that must all be true: the client's `auto_publish_on_approval`, the plan's `feature_post_scheduling`, and a client-side mirror of `hub-approve`'s `isFinalApprovalCycle` (so a first-cycle post in a dual-approval flow is never offered — that is the PR #400 bug).

**Tech Stack:** React 19 + TypeScript, TanStack Query, shadcn/ui (`AlertDialog`, `DateTimePicker`), `sonner` toasts, Vitest + @testing-library/react. No backend work at all.

## Global Constraints

- **Read the spec first:** `docs/superpowers/specs/2026-09-17-manual-approval-auto-schedule-nudge-design.md`. It carries the full rationale, the production evidence, and the six numbered decisions (two rounds of adversarial review — Fable and Codex — are already folded in). This plan is the *how*; that spec is the *why*. Do not modify the spec file.
- **Rebase before Task 1.** This branch (`claude/anebi-posts-auto-schedule-bug-cb059d`) is 1 commit behind `origin/main` (`2fb80beb`, "Add copy-link actions for fluxos and posts in the CRM (#540)"), which touched `WorkflowDrawer.tsx`, `WorkflowCard.tsx`, `PostProcessCard.tsx` and `StandalonePostDrawer.tsx`. **Every `file:line` citation in this plan is against `origin/main` @ `2fb80beb`.** Run `git rebase origin/main` first — the only local commits are the two spec docs under `docs/`, so it is a clean fast-forward-style rebase with no conflicts.
- **No em-dashes in user-facing copy.** House rule. Use a period, a colon, or a comma instead. This applies to every Portuguese string added below (it does NOT apply to code comments).
- **UI language is Portuguese (pt-BR).** Match the surrounding copy style in `WorkflowDrawer.tsx` / `ScheduleButton.tsx`.
- **Scope is flow posts only** (`workflow_id != null`). Posts avulsos (`workflow_id == null`, `StandalonePostDrawer`) are explicitly out of scope: their approval cycle runs on `post_processes` / `post_process_steps`, a different mechanism (`supabase/functions/hub-approve/handler.ts:45-67`). The gate falls out naturally — an avulso post has no `BoardCard`, so no `allEtapas`, so the final-cycle gate is false and nothing renders. Never "fix" that by defaulting the gate to true.
- **The server stays the source of truth.** The client-side eligibility rule only reduces the frequency of a 422 from `validateForScheduling` (`supabase/functions/_shared/instagram-publish-utils.ts:83-89`); it never replaces it. Any endpoint error is surfaced as a `toast.error(err.message)` and the post stays in `aprovado_cliente`.
- **Four `tsc` projects, not `npm run build`.** See the Verification section. `npm run build` only typechecks the CRM.
- **Deviation from the spec, decided during planning (§2 "Diálogo de resumo na aprovação em lote"):** the spec says the batch dialog's N/M counts come from "o snapshot local de posts que `approvePostsInternally` moveu ... o estado do board já carregado antes da chamada". **That state does not exist at either call site.** `KanbanView` receives only per-workflow *counts* (`KanbanViewBaseProps` at `apps/crm/src/pages/entregas/views/KanbanView.tsx:121-125`: `postsCounts`, `approvedPostsCounts`, `clearedClienteCounts`, `revisaoInternaCounts`, `awaitingClienteCounts`) and `postEntities`/`allPostEntities`, which are individual-process entities (posts avulsos), not the flow's `workflow_posts` rows. `EntregasTab` is the same. So this plan fetches the workflow's posts with the existing `getWorkflowPosts(workflowId)` (`apps/crm/src/store/posts.ts:554-562`) *after* `approvePostsInternally` resolves, from inside the batch dialog. This preserves the spec's intent exactly (offer the M eligible posts), is strictly fresher than a pre-write snapshot, and needs no new store function.
- **Second, smaller deviation from the spec (§Tipagem):** the spec declares `auto_publish_on_approval: boolean` (required) on `Cliente`. This plan declares it **optional** (`auto_publish_on_approval?: boolean`) to match every other nullable column already on that interface (`apps/crm/src/store/clients.ts:4-29`) and because the `clientes_v` row can legitimately arrive without it in a partial select. `AutoScheduleGateInput.autoPublishOnApproval` stays strictly `boolean`, and every call site narrows on the way in with `card.cliente?.auto_publish_on_approval === true` (Tasks 3, 4 and 5), so the behaviour is identical; declaring the column required would instead force a non-null assertion at each of those reads.

---

### Task 1: Foundations — `Cliente` type, the two pure rule helpers, and the shared schedule helper

**Files:**
- Modify: `apps/crm/src/store/clients.ts:4-29` (add `auto_publish_on_approval` to `Cliente`)
- Modify: `apps/crm/src/store/workflows.ts:341-345` (add `isFinalClientApprovalCycle` immediately after `hasLaterApprovalEtapa`)
- Create: `apps/crm/src/pages/entregas/autoScheduleNudge.ts`
- Create: `apps/crm/src/pages/entregas/scheduleApprovedPost.ts`
- Modify: `apps/crm/src/pages/entregas/components/ScheduleButton.tsx:144-148` (delete local `scheduleSuccessMessage`) and `:323-339` (`handleSchedule` calls the shared helper)
- Test: `apps/crm/src/pages/entregas/__tests__/autoScheduleNudge.test.ts` (create)
- Test: `apps/crm/src/pages/entregas/__tests__/scheduleApprovedPost.test.ts` (create)
- Test: `apps/crm/src/store/__tests__/finalApprovalCycle.test.ts` (create)

**Interfaces:**
- Consumes: nothing from other tasks. `scheduleInstagramPost` (`apps/crm/src/services/instagram.ts:195`), `scheduleTikTokPost` (`apps/crm/src/services/tiktok.ts:256`), `WorkflowEtapa` and `WorkflowPost` types from `@/store`, `Platform` from `./components/PlatformSelector` (`= NonNullable<WorkflowPost['platform']>`).
- Produces, and every later task depends on these exact names and signatures:
  - `Cliente.auto_publish_on_approval?: boolean`
  - `isFinalClientApprovalCycle(etapas: WorkflowEtapa[]): boolean` — exported from `apps/crm/src/store/workflows.ts`, therefore reachable as `import { isFinalClientApprovalCycle } from '@/store'` (`apps/crm/src/store/index.ts:9` is `export * from './workflows'`).
  - `SCHEDULE_MIN_FUTURE_MS: number`, `SCHEDULE_SAFETY_MARGIN_MS: number`
  - `isEligibleToScheduleNow(scheduledAt: string | null | undefined, now?: number): boolean`
  - `shouldOfferAutoSchedule(input: AutoScheduleGateInput): boolean` where `AutoScheduleGateInput = { status: string | null | undefined; autoPublishOnApproval: boolean; schedulingFeatureEnabled: boolean; isFinalApprovalCycle: boolean }`
  - `partitionByScheduleEligibility<T extends { scheduled_at: string | null }>(posts: T[], now?: number): { eligible: T[]; missingDate: T[] }`
  - `SchedulablePost = Pick<WorkflowPost, 'id' | 'platform' | 'scheduled_at'>`
  - `scheduleApprovedPost(post: SchedulablePost): Promise<{ ok: boolean; status: string }>`
  - `scheduleSuccessMessage(platform: Platform): string`

**Preconditions already verified — do not re-litigate, but do not silently "fix" either:**
- `clientes_v` (the masking view the CRM reads through) exposes `auto_publish_on_approval`: see the current view definition at `supabase/migrations/20260904000001_client_event_emails.sql:39`. It is also already in `CLIENTE_SAFE_COLUMNS` (`apps/crm/src/store/clients.ts:77`) and the column GRANT (`InstagramSection.tsx:44` reads it off the base table today). So this task adds a *type*, not a data path.
- `POST_CONTEXT_COLUMNS` (`apps/crm/src/store/posts.ts:290-291`) already selects `platform`, `scheduled_at`, `status` and `custom_status_id`, so `ActivePost` on the Publicações kanban carries everything `scheduleApprovedPost` needs.

- [ ] **Step 1: Rebase onto current `origin/main`**

```bash
git -C /Users/eduardosouza/projects/sm-crm/.claude/worktrees/avulsos-history-button-6242bd fetch origin main
git -C /Users/eduardosouza/projects/sm-crm/.claude/worktrees/avulsos-history-button-6242bd rebase origin/main
git -C /Users/eduardosouza/projects/sm-crm/.claude/worktrees/avulsos-history-button-6242bd log --oneline -3
```

Expected: the two spec/plan commits now sit on top of `2fb80beb`. If `git status` is not clean afterwards, stop and report — do not continue onto a conflicted tree.

- [ ] **Step 2: Write the failing test for the pure rule helpers**

Create `apps/crm/src/pages/entregas/__tests__/autoScheduleNudge.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  SCHEDULE_MIN_FUTURE_MS,
  SCHEDULE_SAFETY_MARGIN_MS,
  isEligibleToScheduleNow,
  partitionByScheduleEligibility,
  shouldOfferAutoSchedule,
} from '../autoScheduleNudge';

// Fixed clock so every boundary case is exact; the helpers take `now` as an
// optional argument precisely so these tests need no fake timers.
const NOW = new Date('2026-09-17T12:00:00.000Z').getTime();
const at = (offsetMs: number) => new Date(NOW + offsetMs).toISOString();

describe('isEligibleToScheduleNow', () => {
  it('rejects a null or empty date', () => {
    expect(isEligibleToScheduleNow(null, NOW)).toBe(false);
    expect(isEligibleToScheduleNow(undefined, NOW)).toBe(false);
    expect(isEligibleToScheduleNow('', NOW)).toBe(false);
  });

  it('rejects an unparseable date instead of throwing', () => {
    expect(isEligibleToScheduleNow('not a date', NOW)).toBe(false);
  });

  it('rejects a date already in the past (the 22 stuck posts in production)', () => {
    expect(isEligibleToScheduleNow(at(-3 * 24 * 60 * 60 * 1000), NOW)).toBe(false);
  });

  // Decision 1: the server floor is 10 min (instagram-publish-utils.ts:86). The
  // client adds a 2 min safety margin so a confirm landing at the exact boundary
  // does not arrive at the server already invalid.
  it('rejects the server boundary itself: exactly now + 10 min', () => {
    expect(isEligibleToScheduleNow(at(SCHEDULE_MIN_FUTURE_MS), NOW)).toBe(false);
  });

  it('rejects anything inside the safety margin: now + 11 min', () => {
    expect(isEligibleToScheduleNow(at(11 * 60 * 1000), NOW)).toBe(false);
  });

  it('accepts exactly now + 10 min + the safety margin', () => {
    expect(
      isEligibleToScheduleNow(at(SCHEDULE_MIN_FUTURE_MS + SCHEDULE_SAFETY_MARGIN_MS), NOW),
    ).toBe(true);
  });

  it('accepts a comfortably future date', () => {
    expect(isEligibleToScheduleNow(at(2 * 60 * 60 * 1000), NOW)).toBe(true);
  });
});

describe('shouldOfferAutoSchedule', () => {
  const allTrue = {
    status: 'aprovado_cliente',
    autoPublishOnApproval: true,
    schedulingFeatureEnabled: true,
    isFinalApprovalCycle: true,
  };

  it('is true only when every gate passes', () => {
    expect(shouldOfferAutoSchedule(allTrue)).toBe(true);
  });

  it('is false for any status other than aprovado_cliente', () => {
    expect(shouldOfferAutoSchedule({ ...allTrue, status: 'aprovado_interno' })).toBe(false);
    expect(shouldOfferAutoSchedule({ ...allTrue, status: 'agendado' })).toBe(false);
    expect(shouldOfferAutoSchedule({ ...allTrue, status: null })).toBe(false);
  });

  it('is false when the client does not auto-publish on approval', () => {
    expect(shouldOfferAutoSchedule({ ...allTrue, autoPublishOnApproval: false })).toBe(false);
  });

  it('is false when the plan has no feature_post_scheduling', () => {
    expect(shouldOfferAutoSchedule({ ...allTrue, schedulingFeatureEnabled: false })).toBe(false);
  });

  // Decision 3 / the PR #400 regression: a post in the FIRST cycle of a
  // dual-approval fluxo must never be offered, or it publishes before the
  // second client approval.
  it('is false when this is not the final approval cycle', () => {
    expect(shouldOfferAutoSchedule({ ...allTrue, isFinalApprovalCycle: false })).toBe(false);
  });
});

describe('partitionByScheduleEligibility', () => {
  it('splits eligible posts from the ones needing a date', () => {
    const posts = [
      { id: 1, scheduled_at: at(2 * 60 * 60 * 1000) },
      { id: 2, scheduled_at: null },
      { id: 3, scheduled_at: at(-60 * 60 * 1000) },
      { id: 4, scheduled_at: at(3 * 60 * 60 * 1000) },
    ];
    const { eligible, missingDate } = partitionByScheduleEligibility(posts, NOW);
    expect(eligible.map((p) => p.id)).toEqual([1, 4]);
    expect(missingDate.map((p) => p.id)).toEqual([2, 3]);
  });

  it('returns two empty arrays for an empty input', () => {
    expect(partitionByScheduleEligibility([], NOW)).toEqual({ eligible: [], missingDate: [] });
  });
});
```

- [ ] **Step 3: Run it and confirm it fails for the right reason**

```bash
npx vitest run apps/crm/src/pages/entregas/__tests__/autoScheduleNudge.test.ts
```

Expected: FAIL — `Failed to resolve import "../autoScheduleNudge"`.

- [ ] **Step 4: Implement the pure rule helpers**

Create `apps/crm/src/pages/entregas/autoScheduleNudge.ts`:

```ts
/**
 * As regras puras do aviso de agendamento automático (spec
 * docs/superpowers/specs/2026-09-17-manual-approval-auto-schedule-nudge-design.md).
 *
 * Deliberadamente SEM imports de runtime (nem `@/store`, nem serviços): vários
 * testes de componente mockam '@/store' inteiro com um factory estrito, e um
 * import de valor aqui morreria nesse proxy. Por isso `status` é tipado como
 * string e não como WorkflowPost['status'] -- o literal canônico está citado no
 * comentário de shouldOfferAutoSchedule.
 */

/** Piso do servidor: validateForScheduling rejeita scheduled_at a menos de 10
 *  minutos no futuro (supabase/functions/_shared/instagram-publish-utils.ts:86). */
export const SCHEDULE_MIN_FUTURE_MS = 10 * 60 * 1000;

/**
 * Margem de segurança sobre o piso do servidor (decisão 1 da spec, apontada pela
 * revisão do Codex): sem ela, uma confirmação feita no instante exato do limite
 * chega ao servidor alguns segundos depois já inválida e toma 422. A margem só
 * reduz a frequência disso; o servidor continua sendo a fonte de verdade.
 */
export const SCHEDULE_SAFETY_MARGIN_MS = 2 * 60 * 1000;

/**
 * True quando o post pode ir direto para o endpoint de agendamento sem pedir
 * uma data nova. `now` é injetável só para teste; a produção usa Date.now().
 */
export function isEligibleToScheduleNow(
  scheduledAt: string | null | undefined,
  now: number = Date.now(),
): boolean {
  if (!scheduledAt) return false;
  const at = new Date(scheduledAt).getTime();
  if (Number.isNaN(at)) return false;
  return at >= now + SCHEDULE_MIN_FUTURE_MS + SCHEDULE_SAFETY_MARGIN_MS;
}

export interface AutoScheduleGateInput {
  /** Status canônico do post. Só 'aprovado_cliente' habilita o aviso. */
  status: string | null | undefined;
  /** clientes.auto_publish_on_approval do cliente do post. */
  autoPublishOnApproval: boolean;
  /** useWorkspaceLimits().features?.feature_post_scheduling === true. */
  schedulingFeatureEnabled: boolean;
  /** isFinalClientApprovalCycle(etapas) do fluxo do post. */
  isFinalApprovalCycle: boolean;
}

/**
 * Os três gates obrigatórios da spec (mais o status), num só lugar, para que as
 * três superfícies novas não divirjam. Qualquer um falso = nenhum aviso, nenhuma
 * ação, comportamento de hoje inalterado.
 */
export function shouldOfferAutoSchedule(input: AutoScheduleGateInput): boolean {
  return (
    input.status === 'aprovado_cliente' &&
    input.autoPublishOnApproval &&
    input.schedulingFeatureEnabled &&
    input.isFinalApprovalCycle
  );
}

export interface SchedulePartition<T> {
  /** Já têm data futura com margem: podem ser agendados num clique. */
  eligible: T[];
  /** Sem data ou com data inelegível: precisam de uma data nova antes. */
  missingDate: T[];
}

/** Divide uma lista de posts aprovados nos dois grupos do diálogo de lote. */
export function partitionByScheduleEligibility<T extends { scheduled_at: string | null }>(
  posts: T[],
  now: number = Date.now(),
): SchedulePartition<T> {
  const eligible: T[] = [];
  const missingDate: T[] = [];
  for (const post of posts) {
    if (isEligibleToScheduleNow(post.scheduled_at, now)) eligible.push(post);
    else missingDate.push(post);
  }
  return { eligible, missingDate };
}
```

- [ ] **Step 5: Run the test again**

```bash
npx vitest run apps/crm/src/pages/entregas/__tests__/autoScheduleNudge.test.ts
```

Expected: PASS, 13 tests.

- [ ] **Step 6: Write the failing test for `isFinalClientApprovalCycle`**

These fixtures deliberately mirror the server test's own etapa shapes at `supabase/functions/__tests__/hub-functions_test.ts:801-806` (two open approval etapas → NOT final) and `:851-855` (one `concluido` + one open → final), so a future change to the server rule breaks a test on both sides.

Create `apps/crm/src/store/__tests__/finalApprovalCycle.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { isFinalClientApprovalCycle } from '../workflows';
import type { WorkflowEtapa } from '../workflows';

// Only `tipo` and `status` matter to the rule; the rest is filler so the
// fixtures are real WorkflowEtapa values instead of casts. `prazo_dias` and
// `tipo_prazo` are NOT optional on the interface (store/workflows.ts:246-247),
// so they have to be here or tsc fails.
const etapa = (
  ordem: number,
  tipo: WorkflowEtapa['tipo'],
  status: WorkflowEtapa['status'],
): WorkflowEtapa => ({
  id: ordem * 10,
  workflow_id: 7,
  nome: `Etapa ${ordem}`,
  ordem,
  prazo_dias: 3,
  tipo_prazo: 'uteis',
  tipo,
  status,
});

describe('isFinalClientApprovalCycle', () => {
  it('is true for a fluxo with no client-approval etapa at all (express, legacy)', () => {
    expect(
      isFinalClientApprovalCycle([etapa(1, 'padrao', 'concluido'), etapa(2, 'padrao', 'ativo')]),
    ).toBe(true);
  });

  it('is true with exactly one open client-approval etapa (the single-approval fluxo)', () => {
    expect(
      isFinalClientApprovalCycle([etapa(1, 'padrao', 'concluido'), etapa(2, 'aprovacao_cliente', 'ativo')]),
    ).toBe(true);
  });

  // Mirror of hub-functions_test.ts:851-855: the first approval cycle is done,
  // so the remaining open one IS the final cycle.
  it('is true when an earlier approval etapa is concluido and one remains open', () => {
    expect(
      isFinalClientApprovalCycle([
        etapa(1, 'aprovacao_cliente', 'concluido'),
        etapa(2, 'padrao', 'concluido'),
        etapa(3, 'aprovacao_cliente', 'ativo'),
      ]),
    ).toBe(true);
  });

  // Mirror of hub-functions_test.ts:801-806: TWO open approval etapas means this
  // approval belongs to an earlier cycle. Offering to schedule here is the PR
  // #400 bug (publishes before the second client approval).
  it('is false with two open client-approval etapas (dual approval, first cycle)', () => {
    expect(
      isFinalClientApprovalCycle([
        etapa(1, 'aprovacao_cliente', 'ativo'),
        etapa(2, 'padrao', 'pendente'),
        etapa(3, 'aprovacao_cliente', 'pendente'),
      ]),
    ).toBe(false);
  });

  it('is false with three open client-approval etapas', () => {
    expect(
      isFinalClientApprovalCycle([
        etapa(1, 'aprovacao_cliente', 'ativo'),
        etapa(2, 'aprovacao_cliente', 'pendente'),
        etapa(3, 'aprovacao_cliente', 'pendente'),
      ]),
    ).toBe(false);
  });

  // Fail closed, same as the server: no etapa picture means a later cycle
  // cannot be ruled out. An empty list reaches this helper for a post with no
  // BoardCard (post avulso), which is out of scope for this feature.
  it('is false for an empty etapa list', () => {
    expect(isFinalClientApprovalCycle([])).toBe(false);
  });
});
```

Note on the empty-list case: the server returns `< 2` for an empty list, i.e. `true`. The client helper deliberately returns `false` there, because an empty `allEtapas` on this side means "we have no etapa data for this post" (a post avulso, or a card that has not loaded), not "this fluxo has no approval etapas". The comment in the implementation must say this explicitly.

- [ ] **Step 7: Run it and confirm it fails**

```bash
npx vitest run apps/crm/src/store/__tests__/finalApprovalCycle.test.ts
```

Expected: FAIL — `isFinalClientApprovalCycle is not a function` / no such export.

- [ ] **Step 8: Implement `isFinalClientApprovalCycle`**

In `apps/crm/src/store/workflows.ts`, insert immediately after `hasLaterApprovalEtapa` (`:341-345`):

```ts
/**
 * Espelho no cliente de `isFinalApprovalCycle` do `hub-approve`
 * (supabase/functions/hub-approve/handler.ts:25-43, branch `workflow_id != null`
 * nas linhas 29-43):
 * conta as etapas `aprovacao_cliente` do fluxo que ainda NÃO estão `concluido` e
 * exige menos de 2. Com duas ou mais abertas, a aprovação atual pertence a um
 * ciclo anterior (fluxo de dupla aprovação) e agendar agora publicaria antes da
 * segunda aprovação do cliente -- exatamente o bug do PR #400.
 *
 * MANTENHA OS DOIS EM SINCRONIA. A regra do servidor é a canônica; este espelho
 * existe porque nenhuma escrita de status feita pela CRM passa por `hub-approve`.
 * Os testes de apps/crm/src/store/__tests__/finalApprovalCycle.test.ts usam as
 * mesmas formas de etapa que supabase/functions/__tests__/hub-functions_test.ts.
 *
 * Diferença deliberada em relação ao servidor: lista VAZIA devolve false. No
 * servidor uma lista vazia significa "fluxo sem etapa de aprovação" (express,
 * legado) e é final; aqui significa "não temos as etapas deste post" (post
 * avulso, card não carregado), e aí o aviso não deve aparecer -- fail closed,
 * mesma postura do `return false` do servidor quando o lookup falha.
 */
export function isFinalClientApprovalCycle(etapas: WorkflowEtapa[]): boolean {
  if (etapas.length === 0) return false;
  const openApprovalEtapas = etapas.filter(
    (e) => e.tipo === 'aprovacao_cliente' && e.status !== 'concluido',
  ).length;
  return openApprovalEtapas < 2;
}
```

- [ ] **Step 9: Run the store test again**

```bash
npx vitest run apps/crm/src/store/__tests__/finalApprovalCycle.test.ts
```

Expected: PASS, 6 tests.

- [ ] **Step 10: Write the failing test for `scheduleApprovedPost`**

Create `apps/crm/src/pages/entregas/__tests__/scheduleApprovedPost.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';

const scheduleInstagramPost = vi.fn(async () => ({ ok: true, status: 'agendado' }));
const scheduleTikTokPost = vi.fn(async () => ({ ok: true, status: 'agendado' }));

vi.mock('@/services/instagram', () => ({ scheduleInstagramPost }));
vi.mock('@/services/tiktok', () => ({ scheduleTikTokPost }));

import { scheduleApprovedPost, scheduleSuccessMessage } from '../scheduleApprovedPost';

const FUTURE = '2026-09-18T12:00:00.000Z';

describe('scheduleApprovedPost', () => {
  beforeEach(() => {
    scheduleInstagramPost.mockClear();
    scheduleTikTokPost.mockClear();
  });

  it('routes an instagram post to the Instagram service', async () => {
    await scheduleApprovedPost({ id: 1, platform: 'instagram', scheduled_at: FUTURE });
    expect(scheduleInstagramPost).toHaveBeenCalledWith(1);
    expect(scheduleTikTokPost).not.toHaveBeenCalled();
  });

  it('treats a missing platform as instagram (legacy rows, DB default)', async () => {
    await scheduleApprovedPost({ id: 2, platform: undefined, scheduled_at: FUTURE });
    expect(scheduleInstagramPost).toHaveBeenCalledWith(2);
    expect(scheduleTikTokPost).not.toHaveBeenCalled();
  });

  it('routes a tiktok post to the TikTok service with its date', async () => {
    await scheduleApprovedPost({ id: 3, platform: 'tiktok', scheduled_at: FUTURE });
    expect(scheduleTikTokPost).toHaveBeenCalledWith(3, FUTURE);
    expect(scheduleInstagramPost).not.toHaveBeenCalled();
  });

  // Decision 6: 'both' calls ONLY the TikTok service -- its server validates
  // both platforms. Calling both services here would double-schedule.
  it("routes platform 'both' to the TikTok service only", async () => {
    await scheduleApprovedPost({ id: 4, platform: 'both', scheduled_at: FUTURE });
    expect(scheduleTikTokPost).toHaveBeenCalledWith(4, FUTURE);
    expect(scheduleInstagramPost).not.toHaveBeenCalled();
  });

  it('propagates the service error so callers can toast it', async () => {
    scheduleInstagramPost.mockRejectedValueOnce(new Error('Legenda do Instagram não definida.'));
    await expect(
      scheduleApprovedPost({ id: 5, platform: 'instagram', scheduled_at: FUTURE }),
    ).rejects.toThrow('Legenda do Instagram não definida.');
  });
});

describe('scheduleSuccessMessage', () => {
  it('names the platform(s) the post went to', () => {
    expect(scheduleSuccessMessage('instagram')).toBe('Post agendado para publicação no Instagram');
    expect(scheduleSuccessMessage('tiktok')).toBe('Post agendado para publicação no TikTok');
    expect(scheduleSuccessMessage('both')).toBe(
      'Post agendado para publicação no Instagram e no TikTok',
    );
  });
});
```

- [ ] **Step 11: Run it and confirm it fails**

```bash
npx vitest run apps/crm/src/pages/entregas/__tests__/scheduleApprovedPost.test.ts
```

Expected: FAIL — `Failed to resolve import "../scheduleApprovedPost"`.

- [ ] **Step 12: Implement the shared schedule helper**

Create `apps/crm/src/pages/entregas/scheduleApprovedPost.ts`:

```ts
import { scheduleInstagramPost } from '@/services/instagram';
import { scheduleTikTokPost } from '@/services/tiktok';
import type { WorkflowPost } from '@/store';
import type { Platform } from './components/PlatformSelector';

/** O mínimo que o agendamento precisa de um post. Satisfeito por WorkflowPost
 *  (drawer, retorno de updateWorkflowPost) e por ActivePost (kanban). */
export type SchedulablePost = Pick<WorkflowPost, 'id' | 'platform' | 'scheduled_at'>;

export function scheduleSuccessMessage(platform: Platform): string {
  if (platform === 'both') return 'Post agendado para publicação no Instagram e no TikTok';
  if (platform === 'tiktok') return 'Post agendado para publicação no TikTok';
  return 'Post agendado para publicação no Instagram';
}

/**
 * A única fonte da regra de roteamento por plataforma do agendamento, extraída
 * de ScheduleButton.handleSchedule. `platform === 'both'` chama SÓ o serviço do
 * TikTok: o servidor do TikTok valida as duas plataformas nesse caso (ver o
 * comentário de cabeçalho de ScheduleButton.tsx, linhas 34-43). Chamar os dois
 * agendaria em dobro.
 *
 * O chamador é quem trata o erro: todo erro do endpoint (inclusive os `details`
 * de validateForScheduling) sobe como Error e vira toast.error(err.message).
 */
export async function scheduleApprovedPost(
  post: SchedulablePost,
): Promise<{ ok: boolean; status: string }> {
  const platform: Platform = post.platform ?? 'instagram';
  const targetsTikTok = platform === 'tiktok' || platform === 'both';
  if (targetsTikTok) return scheduleTikTokPost(post.id!, post.scheduled_at!);
  return scheduleInstagramPost(post.id!);
}
```

- [ ] **Step 13: Run the helper test again**

```bash
npx vitest run apps/crm/src/pages/entregas/__tests__/scheduleApprovedPost.test.ts
```

Expected: PASS, 6 tests.

- [ ] **Step 14: Add `auto_publish_on_approval` to the `Cliente` interface**

In `apps/crm/src/store/clients.ts`, inside `interface Cliente` (ends at `:29`), add right before `send_event_email`:

```ts
  /**
   * Agenda a publicação sozinho quando o CLIENTE aprova pelo Hub
   * (supabase/functions/hub-approve/handler.ts:152-185). Já vinha selecionado em
   * CLIENTE_SAFE_COLUMNS e exposto por clientes_v; só faltava no tipo. A CRM lê
   * este campo para avisar quando uma aprovação manual deveria ter agendado.
   */
  auto_publish_on_approval?: boolean;
```

- [ ] **Step 15: Point `ScheduleButton` at the shared helper**

In `apps/crm/src/pages/entregas/components/ScheduleButton.tsx`:

Delete the local helper at `:144-148`:

```ts
function scheduleSuccessMessage(platform: Platform): string {
  if (platform === 'both') return 'Post agendado para publicação no Instagram e no TikTok';
  if (platform === 'tiktok') return 'Post agendado para publicação no TikTok';
  return 'Post agendado para publicação no Instagram';
}
```

Add to the imports (after the `services/tiktok` import block that ends at `:32`):

```ts
import { scheduleApprovedPost, scheduleSuccessMessage } from '../scheduleApprovedPost';
```

Replace the body of `handleSchedule` (`:323-339`):

```ts
  const handleSchedule = async () => {
    setLoading(true);
    try {
      if (targetsTikTok) {
        await scheduleTikTokPost(post.id!, post.scheduled_at!);
      } else {
        await scheduleInstagramPost(post.id!);
      }
      toast.success(scheduleSuccessMessage(platform));
      onStatusChange();
    } catch (err: any) {
      flagUnauditedIfPresent(err.message);
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  };
```

with:

```ts
  const handleSchedule = async () => {
    setLoading(true);
    try {
      // Mesma regra de plataforma que os avisos de agendamento automático usam
      // (pages/entregas/scheduleApprovedPost.ts) -- uma fonte só.
      await scheduleApprovedPost(post);
      toast.success(scheduleSuccessMessage(platform));
      onStatusChange();
    } catch (err: any) {
      flagUnauditedIfPresent(err.message);
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  };
```

`scheduleTikTokPost` and `scheduleInstagramPost` are still imported and used elsewhere in the file? Check: `scheduleInstagramPost` (`:22`) and `scheduleTikTokPost` (`:28`) are used ONLY by `handleSchedule`. Remove both names from their import lists (keep `cancelInstagramSchedule`, `retryInstagramPublish`, `publishInstagramPostNow`; keep `cancelTikTokSchedule`, `publishTikTokPostNow`, `retryTikTokPublish`) or `npm run lint` fails on unused imports.

- [ ] **Step 16: Run the existing ScheduleButton / publishing tests plus the three new files**

```bash
npx vitest run apps/crm/src/pages/entregas/__tests__/autoScheduleNudge.test.ts \
  apps/crm/src/pages/entregas/__tests__/scheduleApprovedPost.test.ts \
  apps/crm/src/store/__tests__/finalApprovalCycle.test.ts
npx vitest run apps/crm/src/pages/entregas
npx tsc -p apps/crm/tsconfig.json --noEmit
npm run lint
```

Expected: all green. If a pre-existing `entregas` test fails with `No "scheduleApprovedPost" export is defined on the mock` or similar, add the missing key to that file's mock factory (this is the same class of breakage Task 3 handles systematically — see its Step 1).

- [ ] **Step 17: Commit**

```bash
git add apps/crm/src/store/clients.ts apps/crm/src/store/workflows.ts \
  apps/crm/src/pages/entregas/autoScheduleNudge.ts \
  apps/crm/src/pages/entregas/scheduleApprovedPost.ts \
  apps/crm/src/pages/entregas/components/ScheduleButton.tsx \
  apps/crm/src/pages/entregas/__tests__/autoScheduleNudge.test.ts \
  apps/crm/src/pages/entregas/__tests__/scheduleApprovedPost.test.ts \
  apps/crm/src/store/__tests__/finalApprovalCycle.test.ts
git commit -m "$(cat <<'EOF'
feat(entregas): shared auto-schedule rules and schedule helper

Extracts ScheduleButton's platform-routing branch into scheduleApprovedPost,
adds the pure eligibility/gate rules, and mirrors hub-approve's
isFinalApprovalCycle on the client. No UI change yet.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: The single-post nudge dialog

**Files:**
- Create: `apps/crm/src/pages/entregas/components/AutoSchedulePromptDialog.tsx`
- Test: `apps/crm/src/pages/entregas/components/__tests__/AutoSchedulePromptDialog.test.tsx` (create)

**Interfaces:**
- Consumes from Task 1: `isEligibleToScheduleNow`, `scheduleApprovedPost`, `scheduleSuccessMessage`, `SchedulablePost`. Also `updateWorkflowPost` (`apps/crm/src/store/posts.ts:894-916`, returns `Promise<WorkflowPost>`), `DateTimePicker` (`apps/crm/src/components/ui/date-time-picker.tsx:47`), `AlertDialog` primitives (`apps/crm/src/components/ui/alert-dialog`), `toast` from `sonner`.
- Produces, used by Tasks 3 and 5:

```ts
export interface AutoSchedulePromptPost {
  id: number;
  titulo: string;
  platform?: 'instagram' | 'tiktok' | 'both';
  scheduled_at: string | null;
}

export interface AutoSchedulePromptDialogProps {
  /** null fecha o diálogo. Não-null abre para esse post. */
  post: AutoSchedulePromptPost | null;
  onClose: () => void;
  /** Chamado só depois de um agendamento bem-sucedido, para o caller invalidar
   *  suas queries. O diálogo não sabe nada sobre cache. */
  onScheduled: () => void;
}

export function AutoSchedulePromptDialog(props: AutoSchedulePromptDialogProps): JSX.Element | null;
```

**Design notes the implementer must not re-derive:**
- Two branches, one dialog. `isEligibleToScheduleNow(post.scheduled_at)` true → a plain confirm naming the formatted date. False → the same dialog body swaps in a `DateTimePicker` pre-filled with the stale date when there is one, and the action becomes "Definir e agendar".
- **The `updated`-row rule (a specific Codex-caught defect).** In the date branch, `scheduleApprovedPost` must receive the row `updateWorkflowPost` returned, never the `post` prop: for `tiktok`/`both` the helper reads `post.scheduled_at` and would send the OLD date (or `null`) in the request body, which the TikTok endpoint requires and would reject.
- `DateTimePicker` with `futureOnly` already floors its own selection at `MIN_SCHEDULE_MINUTES = 15` (`apps/crm/src/components/ui/date-time-picker.tsx:10`), which is above this feature's 12-minute eligibility floor. So a date chosen through this dialog is always eligible and no second eligibility check is needed after the picker.
- **Error handling is a toast, not inline state** (Codex correction): `ScheduleButton` has no inline error pattern to reuse; both `handleSchedule` (`:333-336`) and the publish-now dialog (`:311-315`) close and `toast.error(err.message)`. Do the same here. The post stays in `aprovado_cliente` either way (a failed schedule call never changes the status), and the persistent indicator from Task 5 keeps offering the action.
- Use `formatPostDateFull` if a shared formatter exists in `apps/crm/src/pages/entregas/postLabels.ts`; otherwise format with `date-fns` `format(date, "dd/MM/yyyy 'às' HH:mm", { locale: ptBR })`. Grep `postLabels.ts` for `formatPostDateFull` before writing the import.

- [ ] **Step 1: Write the failing component test**

Create `apps/crm/src/pages/entregas/components/__tests__/AutoSchedulePromptDialog.test.tsx`:

```tsx
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const toastError = vi.fn();
const toastSuccess = vi.fn();
vi.mock('sonner', () => ({ toast: { error: toastError, success: toastSuccess, info: vi.fn() } }));

const updateWorkflowPost = vi.fn();
vi.mock('@/store', () => ({ updateWorkflowPost }));

const scheduleApprovedPost = vi.fn();
vi.mock('../../scheduleApprovedPost', () => ({
  scheduleApprovedPost,
  scheduleSuccessMessage: () => 'Post agendado para publicação no Instagram',
}));

// The real DateTimePicker is a Popover + Calendar; in jsdom it is simpler and
// more robust to drive a stub that exposes one button emitting a fixed Date.
const PICKED = new Date('2026-09-20T15:00:00.000Z');
vi.mock('@/components/ui/date-time-picker', () => ({
  DateTimePicker: ({
    value,
    onChange,
  }: {
    value?: Date;
    onChange?: (d: Date | undefined) => void;
  }) => (
    <div>
      <span data-testid="picker-value">{value ? value.toISOString() : 'empty'}</span>
      <button onClick={() => onChange?.(PICKED)}>escolher data</button>
    </div>
  ),
}));

import { AutoSchedulePromptDialog } from '../AutoSchedulePromptDialog';

const FUTURE = new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString();
const PAST = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString();

describe('AutoSchedulePromptDialog', () => {
  beforeEach(() => {
    updateWorkflowPost.mockReset();
    scheduleApprovedPost.mockReset();
    toastError.mockReset();
    toastSuccess.mockReset();
    scheduleApprovedPost.mockResolvedValue({ ok: true, status: 'agendado' });
  });

  it('renders nothing when post is null', () => {
    const { container } = render(
      <AutoSchedulePromptDialog post={null} onClose={vi.fn()} onScheduled={vi.fn()} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('confirm branch: schedules the post as-is when the date is already eligible', async () => {
    const onScheduled = vi.fn();
    render(
      <AutoSchedulePromptDialog
        post={{ id: 11, titulo: 'Post A', platform: 'instagram', scheduled_at: FUTURE }}
        onClose={vi.fn()}
        onScheduled={onScheduled}
      />,
    );
    expect(screen.queryByText('escolher data')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /^Agendar$/ }));
    await waitFor(() => expect(scheduleApprovedPost).toHaveBeenCalledTimes(1));
    expect(scheduleApprovedPost).toHaveBeenCalledWith(
      expect.objectContaining({ id: 11, scheduled_at: FUTURE }),
    );
    expect(updateWorkflowPost).not.toHaveBeenCalled();
    expect(onScheduled).toHaveBeenCalled();
    expect(toastSuccess).toHaveBeenCalled();
  });

  it('date branch: offers the picker pre-filled with the stale date', () => {
    render(
      <AutoSchedulePromptDialog
        post={{ id: 12, titulo: 'Post B', platform: 'instagram', scheduled_at: PAST }}
        onClose={vi.fn()}
        onScheduled={vi.fn()}
      />,
    );
    expect(screen.getByTestId('picker-value')).toHaveTextContent(new Date(PAST).toISOString());
    expect(screen.getByRole('button', { name: /Definir e agendar/ })).toBeDisabled();
  });

  it('date branch: an empty scheduled_at opens the picker with no value', () => {
    render(
      <AutoSchedulePromptDialog
        post={{ id: 13, titulo: 'Post C', platform: 'instagram', scheduled_at: null }}
        onClose={vi.fn()}
        onScheduled={vi.fn()}
      />,
    );
    expect(screen.getByTestId('picker-value')).toHaveTextContent('empty');
  });

  // The specific regression Codex caught: for tiktok/both, scheduleApprovedPost
  // reads scheduled_at off the object it is handed. Handing it the closure's
  // original post would send the OLD date (or null) to the TikTok endpoint.
  it('date branch: schedules with the row updateWorkflowPost returned, not the original post', async () => {
    updateWorkflowPost.mockResolvedValue({
      id: 14,
      titulo: 'Post D',
      platform: 'both',
      scheduled_at: PICKED.toISOString(),
      status: 'aprovado_cliente',
    });
    render(
      <AutoSchedulePromptDialog
        post={{ id: 14, titulo: 'Post D', platform: 'both', scheduled_at: PAST }}
        onClose={vi.fn()}
        onScheduled={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByText('escolher data'));
    fireEvent.click(screen.getByRole('button', { name: /Definir e agendar/ }));
    await waitFor(() => expect(scheduleApprovedPost).toHaveBeenCalledTimes(1));
    expect(updateWorkflowPost).toHaveBeenCalledWith(14, {
      scheduled_at: PICKED.toISOString(),
    });
    expect(scheduleApprovedPost).toHaveBeenCalledWith(
      expect.objectContaining({ id: 14, platform: 'both', scheduled_at: PICKED.toISOString() }),
    );
    // Guard against a regression that passes the prop object instead.
    expect(scheduleApprovedPost).not.toHaveBeenCalledWith(
      expect.objectContaining({ scheduled_at: PAST }),
    );
  });

  it('an endpoint error closes the dialog and toasts the message', async () => {
    const onClose = vi.fn();
    const onScheduled = vi.fn();
    scheduleApprovedPost.mockRejectedValueOnce(new Error('Legenda do Instagram não definida.'));
    render(
      <AutoSchedulePromptDialog
        post={{ id: 15, titulo: 'Post E', platform: 'instagram', scheduled_at: FUTURE }}
        onClose={onClose}
        onScheduled={onScheduled}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /^Agendar$/ }));
    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith('Legenda do Instagram não definida.'),
    );
    expect(onClose).toHaveBeenCalled();
    expect(onScheduled).not.toHaveBeenCalled();
  });

  it('Cancelar closes without scheduling', () => {
    const onClose = vi.fn();
    render(
      <AutoSchedulePromptDialog
        post={{ id: 16, titulo: 'Post F', platform: 'instagram', scheduled_at: FUTURE }}
        onClose={onClose}
        onScheduled={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /Cancelar/ }));
    expect(onClose).toHaveBeenCalled();
    expect(scheduleApprovedPost).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

```bash
npx vitest run apps/crm/src/pages/entregas/components/__tests__/AutoSchedulePromptDialog.test.tsx
```

Expected: FAIL — `Failed to resolve import "../AutoSchedulePromptDialog"`.

- [ ] **Step 3: Implement the dialog**

Create `apps/crm/src/pages/entregas/components/AutoSchedulePromptDialog.tsx`:

```tsx
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { DateTimePicker } from '@/components/ui/date-time-picker';
import { updateWorkflowPost } from '@/store';
import { isEligibleToScheduleNow } from '../autoScheduleNudge';
import { scheduleApprovedPost, scheduleSuccessMessage } from '../scheduleApprovedPost';

export interface AutoSchedulePromptPost {
  id: number;
  titulo: string;
  platform?: 'instagram' | 'tiktok' | 'both';
  scheduled_at: string | null;
}

export interface AutoSchedulePromptDialogProps {
  /** null fecha o diálogo; não-null abre para esse post. */
  post: AutoSchedulePromptPost | null;
  onClose: () => void;
  /** Só após sucesso, para o caller invalidar as próprias queries. */
  onScheduled: () => void;
}

/**
 * Aviso de agendamento automático para UM post (peças 1 e 3 da spec
 * 2026-09-17-manual-approval-auto-schedule-nudge-design.md). Quem decide se
 * deve aparecer é o caller, via shouldOfferAutoSchedule(); este componente só
 * cuida dos dois caminhos de agendar.
 *
 * Erro do endpoint fecha e mostra toast.error, sem estado de erro inline: é o
 * mesmo padrão do ScheduleButton (handleSchedule e o diálogo de publicar
 * agora). O post continua em aprovado_cliente, e o indicador persistente segue
 * oferecendo a ação.
 */
export function AutoSchedulePromptDialog({
  post,
  onClose,
  onScheduled,
}: AutoSchedulePromptDialogProps) {
  const [loading, setLoading] = useState(false);
  const [pickedDate, setPickedDate] = useState<Date | undefined>(undefined);

  // Pré-preenche o picker com a data antiga (decisão 1) a cada post novo, e
  // limpa a escolha anterior para o diálogo não reaproveitar a data de outro post.
  useEffect(() => {
    setPickedDate(post?.scheduled_at ? new Date(post.scheduled_at) : undefined);
  }, [post?.id, post?.scheduled_at]);

  if (!post) return null;

  const eligible = isEligibleToScheduleNow(post.scheduled_at);
  const platform = post.platform ?? 'instagram';

  const finish = (err?: unknown) => {
    setLoading(false);
    onClose();
    if (err) toast.error((err as Error).message || 'Erro ao agendar');
    else {
      toast.success(scheduleSuccessMessage(platform));
      onScheduled();
    }
  };

  const handleScheduleNow = async () => {
    setLoading(true);
    try {
      await scheduleApprovedPost(post);
      finish();
    } catch (err) {
      finish(err);
    }
  };

  const handleSetDateAndSchedule = async () => {
    if (!pickedDate) return;
    setLoading(true);
    try {
      // A linha DEVOLVIDA pela escrita, nunca o `post` capturado antes da
      // escolha: para tiktok/both, scheduleApprovedPost lê scheduled_at do
      // objeto e mandaria a data antiga (ou null) no corpo do request.
      const updated = await updateWorkflowPost(post.id, {
        scheduled_at: pickedDate.toISOString(),
      });
      await scheduleApprovedPost(updated);
      finish();
    } catch (err) {
      finish(err);
    }
  };

  const formattedDate = post.scheduled_at
    ? format(new Date(post.scheduled_at), "dd/MM/yyyy 'às' HH:mm", { locale: ptBR })
    : null;

  return (
    <AlertDialog
      open
      onOpenChange={(open) => {
        if (!open && !loading) onClose();
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Agendar a publicação agora?</AlertDialogTitle>
          <AlertDialogDescription>
            {eligible
              ? `Este cliente agenda a publicação automaticamente quando um post é aprovado. Deseja agendar "${post.titulo || 'Post sem título'}" para ${formattedDate}?`
              : `Este cliente agenda a publicação automaticamente quando um post é aprovado, mas este post não tem uma data válida. Escolha uma data para agendar "${post.titulo || 'Post sem título'}".`}
          </AlertDialogDescription>
        </AlertDialogHeader>

        {!eligible && (
          <div className="px-1">
            <DateTimePicker
              value={pickedDate}
              onChange={setPickedDate}
              futureOnly
              className="w-full"
            />
          </div>
        )}

        <AlertDialogFooter>
          <AlertDialogCancel disabled={loading}>Cancelar</AlertDialogCancel>
          {eligible ? (
            <Button onClick={handleScheduleNow} disabled={loading}>
              Agendar
            </Button>
          ) : (
            <Button
              onClick={handleSetDateAndSchedule}
              disabled={loading || !pickedDate || !isEligibleToScheduleNow(pickedDate.toISOString())}
            >
              Definir e agendar
            </Button>
          )}
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
```

Note on the disabled condition of "Definir e agendar": `pickedDate` starts pre-filled with the STALE date, which is exactly the date that failed eligibility, so the button must stay disabled until the user actually picks a valid one. That is what the second `isEligibleToScheduleNow` call guards, and it is why the test asserts the button is disabled on first render of the date branch.

- [ ] **Step 4: Run the dialog test**

```bash
npx vitest run apps/crm/src/pages/entregas/components/__tests__/AutoSchedulePromptDialog.test.tsx
npx tsc -p apps/crm/tsconfig.json --noEmit
```

Expected: PASS, 7 tests; tsc clean.

- [ ] **Step 5: Commit**

```bash
git add apps/crm/src/pages/entregas/components/AutoSchedulePromptDialog.tsx \
  apps/crm/src/pages/entregas/components/__tests__/AutoSchedulePromptDialog.test.tsx
git commit -m "$(cat <<'EOF'
feat(entregas): single-post auto-schedule nudge dialog

Two branches: confirm an already-eligible date, or pick a new one. The date
branch schedules with the row updateWorkflowPost returns, so tiktok/both never
send the stale date.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Piece 1 — the nudge on an individual status transition

**Files:**
- Modify: `apps/crm/src/pages/entregas/components/WorkflowDrawer.tsx` — `handleFieldChange`'s status branch (`:427-450`, the write at `:441`) and `handleConfirmStatusChange` (`:456-466`, the write at `:461`); render the dialog near the existing `AlertDialog`s (the status-confirm dialog's `AlertDialogAction` is at `:1092`)
- Modify: `apps/crm/src/pages/entregas/views/PostsKanbanView.tsx` — `applyStatusChange` (`:650-688`), add `schedulingEnabled` to `PostsKanbanViewProps` (`:132-155`)
- Modify: `apps/crm/src/pages/entregas/EntregasPage.tsx` — pass `schedulingEnabled` (it already holds `features` at `:132`)
- Modify (test mocks only): `apps/crm/src/pages/entregas/views/__tests__/PostsKanbanView.test.tsx:17`, `apps/crm/src/pages/entregas/views/__tests__/KanbanMixedColumnDragEnd.test.tsx:98`, `apps/crm/src/pages/entregas/views/__tests__/KanbanQuickAddDropdown.test.tsx:66`, `apps/crm/src/pages/entregas/components/__tests__/WorkflowDrawer.test.tsx:81`, `apps/crm/src/pages/entregas/components/__tests__/WorkflowDrawerAutoComplete.test.tsx:46`, `apps/crm/src/pages/entregas/__tests__/EntregasPage.test.tsx:19`
- Test: `apps/crm/src/pages/entregas/views/__tests__/PostsKanbanAutoScheduleNudge.test.tsx` (create)
- Test: `apps/crm/src/pages/entregas/components/__tests__/WorkflowDrawerAutoScheduleNudge.test.tsx` (create)

**Interfaces:**
- Consumes from Task 1: `shouldOfferAutoSchedule`, `isFinalClientApprovalCycle`. From Task 2: `AutoSchedulePromptDialog`, `AutoSchedulePromptPost`.
- Produces: `PostsKanbanViewProps.schedulingEnabled?: boolean`. Nothing else new; Tasks 4 and 5 do not depend on this task's internals.

**Why a prop and not the hook, in the kanban:** `useWorkspaceLimits` is already called by `WorkflowDrawer` (`:163`) and by `EntregasPage` (`:132`), and `EntregasPage` already threads a plan flag down to the boards as a plain optional prop (`postProcessesEnabled`, `KanbanView.tsx:132-134`). Following that precedent for `schedulingEnabled` keeps eleven existing Kanban test files from needing a new `vi.mock('@/hooks/useWorkspaceLimits')`, and an omitted prop defaults to `false`, i.e. today's behavior.

- [ ] **Step 1: Add the new store export to every strict `@/store` mock that renders these components**

Introducing `isFinalClientApprovalCycle` into `WorkflowDrawer.tsx` and `PostsKanbanView.tsx` breaks any test that replaces the store module with a strict factory: accessing a key the factory does not define throws (this is the exact trap documented at `apps/crm/src/pages/entregas/approvalAdvance.ts:31-36`). Add `isFinalClientApprovalCycle: vi.fn(() => true)` to each factory below.

**One other import-graph effect to be aware of, in case a harness misbehaves.** Importing `AutoSchedulePromptDialog` into `PostsKanbanView` (and `AutoScheduleBatchDialog` into `KanbanView`, Task 4) adds a transitive edge these two components do not have today: `scheduleApprovedPost.ts` → `@/services/instagram` + `@/services/tiktok` → `@/lib/supabase`, which builds a Supabase client at module load and *throws* when `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` are missing (`apps/crm/src/lib/supabase.ts:6-13`). **Under Vitest this is already safe** — `vitest.config.ts:20-21` defines both values for every test file, so the client is constructed with dummy credentials and nothing throws at import. So no pre-emptive change is needed here. But if any kanban harness suddenly fails *at import* with a Supabase or service-module error, the cause is this new edge and not the store mock: fix it by adding `vi.mock('../../scheduleApprovedPost', () => ({ scheduleApprovedPost: vi.fn(), scheduleSuccessMessage: vi.fn(() => '') }))` to that file (path relative to the test's location), not by touching the `@/store` factory.

- `apps/crm/src/pages/entregas/views/__tests__/PostsKanbanView.test.tsx:17` — currently `vi.mock('@/store', () => ({ updateWorkflowPost: vi.fn(), reorderBoardPosts: vi.fn() }));`
- `apps/crm/src/pages/entregas/views/__tests__/KanbanMixedColumnDragEnd.test.tsx:98` — `vi.mock('../../../../store', () => store);`, add the key to the `store` object literal above it
- `apps/crm/src/pages/entregas/views/__tests__/KanbanQuickAddDropdown.test.tsx:66` — same shape
- `apps/crm/src/pages/entregas/components/__tests__/WorkflowDrawer.test.tsx:81` — `vi.mock('@/store', () => ({ ... }))`
- `apps/crm/src/pages/entregas/components/__tests__/WorkflowDrawerAutoComplete.test.tsx:46` — `vi.mock('../../../../store', () => store);`
- `apps/crm/src/pages/entregas/__tests__/EntregasPage.test.tsx:19` — `vi.mock('../../../store', () => storeMocks);`

Return value `true` is the right default: it keeps the *other* gates (auto-publish, feature flag) as the thing that decides, and those default off in every one of these files, so no existing assertion changes.

- [ ] **Step 2: Run the affected suites to confirm they still pass before any behavior change**

```bash
npx vitest run apps/crm/src/pages/entregas apps/crm/src/pages/cliente-detalhe
```

Expected: PASS (same counts as before the mock edits).

- [ ] **Step 3: Write the failing kanban-drag nudge test**

Create `apps/crm/src/pages/entregas/views/__tests__/PostsKanbanAutoScheduleNudge.test.tsx`. Follow the mock header of the existing `PostsKanbanView.test.tsx` (read it first — it already stubs dnd-kit, sonner, and `@/store`); this file adds the nudge assertions. The behavior under test lives in `applyStatusChange`, so drive it through the same path that file uses to simulate a drop.

```tsx
// Reuse PostsKanbanView.test.tsx's harness verbatim for the mocks, then:

it('opens the nudge after a drag into Aprovado pelo cliente when every gate passes', async () => {
  // card for workflow 7 with a single OPEN aprovacao_cliente etapa -> final cycle
  // cliente.auto_publish_on_approval = true, schedulingEnabled prop = true
  // post.scheduled_at = 3h in the future -> confirm branch
  // updateWorkflowPost resolves with { ...post, status: 'aprovado_cliente' }
  // assert: the dialog's "Agendar" button is in the document
});

it('does not open the nudge when the client has auto_publish_on_approval false', async () => {
  // same as above with auto_publish_on_approval: false -> no dialog
});

it('does not open the nudge when schedulingEnabled is false', async () => {
  // same with schedulingEnabled={false} -> no dialog
});

// PR #400 regression on a brand-new surface.
it('does not open the nudge in the first cycle of a dual-approval fluxo', async () => {
  // card.allEtapas = two OPEN aprovacao_cliente etapas -> isFinalClientApprovalCycle false
  // -> no dialog
});

it('does not open the nudge for a drag into any other status', async () => {
  // drop into revisao_interna -> no dialog
});

it('does not open the nudge for a post avulso (no BoardCard)', async () => {
  // post.workflow_id null, cardsByWorkflowId empty -> no dialog
});

it('closes an open nudge when Desfazer moves the post back out of aprovado_cliente', async () => {
  // click the sonner "Desfazer" action -> dialog gone
});
```

Write each of these out fully against the real harness — the comments above are the specification of what to assert, not a substitute for the code. Mock `../../components/AutoSchedulePromptDialog` with a stub that renders `post ? <div data-testid="nudge">{post.id}</div> : null` if driving the real dialog through jsdom proves noisy; Task 2 already covers the dialog's own behavior, so this file only needs to prove *whether* it is opened and with which post.

- [ ] **Step 4: Run it and confirm it fails**

```bash
npx vitest run apps/crm/src/pages/entregas/views/__tests__/PostsKanbanAutoScheduleNudge.test.tsx
```

Expected: FAIL — no `nudge` testid ever appears (the prop and the wiring do not exist yet).

- [ ] **Step 5: Wire the kanban drag**

In `apps/crm/src/pages/entregas/views/PostsKanbanView.tsx`:

Add to `PostsKanbanViewProps` (`:132-155`):

```ts
  /** features?.feature_post_scheduling === true, vindo da EntregasPage. Gate do
   *  aviso de agendamento automático: instagram-publish devolve 403
   *  feature_disabled para action "schedule" sem esse flag no plano
   *  (supabase/functions/instagram-publish/handler.ts:70-77), então um aviso que
   *  termina em erro é pior do que nenhum aviso. Ausente = desligado. */
  schedulingEnabled?: boolean;
```

Add to the destructuring in the component signature and to the imports:

```ts
import { isFinalClientApprovalCycle } from '@/store';
import { shouldOfferAutoSchedule } from '../autoScheduleNudge';
import {
  AutoSchedulePromptDialog,
  type AutoSchedulePromptPost,
} from '../components/AutoSchedulePromptDialog';
```

Add state next to the existing `pendingConfirm` state (`:561-572`):

```ts
  /** Post cujo aviso de agendamento automático está aberto (peça 1 da spec). */
  const [nudgePost, setNudgePost] = useState<AutoSchedulePromptPost | null>(null);
```

In `applyStatusChange` (`:651`), add an `onSuccess` beside the existing `onError` on the forward mutate:

```ts
    updateStatus.mutate(move.forward, {
      onError: () =>
        persistPlacement([{ id: move.forward.id, board_ordem: move.previousBoardOrdem }]),
      // Aviso de agendamento automático (spec peça 1). A linha devolvida pela
      // escrita é a fonte do status: o trigger do banco força `status` a partir
      // de um custom_status_id, então um status custom que se comporta como
      // aprovado_cliente também cai aqui, sem consultar o registry.
      onSuccess: (updated) => {
        const card = post.workflow_id != null ? cardsByWorkflowId.get(post.workflow_id) : undefined;
        const offer = shouldOfferAutoSchedule({
          status: updated?.status ?? move.forward.canonical,
          autoPublishOnApproval: card?.cliente?.auto_publish_on_approval === true,
          schedulingFeatureEnabled: schedulingEnabled === true,
          isFinalApprovalCycle: card ? isFinalClientApprovalCycle(card.allEtapas) : false,
        });
        if (!offer) return;
        setNudgePost({
          id: post.id,
          titulo: post.titulo,
          platform: post.platform,
          scheduled_at: updated?.scheduled_at ?? post.scheduled_at,
        });
      },
    });
```

In the same function's "Desfazer" handler, after the backward `updateStatus.mutate(...)` call, close a nudge that is still open for this post — a post being undone out of `aprovado_cliente` must not keep an offer to schedule it:

```ts
          // O post está voltando para fora de aprovado_cliente; um aviso aberto
          // para ele ficaria oferecendo agendar um post que já não está aprovado.
          setNudgePost((current) => (current?.id === move.forward.id ? null : current));
```

Render the dialog at the end of the component's JSX (as a sibling of the existing `AlertDialog` for `pendingConfirm`):

```tsx
      <AutoSchedulePromptDialog
        post={nudgePost}
        onClose={() => setNudgePost(null)}
        onScheduled={() => {
          setNudgePost(null);
          qc.invalidateQueries({ queryKey: ACTIVE_POSTS_KEY });
          qc.invalidateQueries({ queryKey: ['workflow-posts-counts'] });
          qc.invalidateQueries({ queryKey: ['workflow-approved-posts-counts'] });
          qc.invalidateQueries({ queryKey: ['workflow-cleared-cliente-counts'] });
        }}
      />
```

Those three count keys plus `ACTIVE_POSTS_KEY` are the subset of `useUpdatePostStatus.onSettled`'s list (`apps/crm/src/pages/entregas/hooks/useUpdatePostStatus.ts:66-76`) that a schedule actually changes: the post leaves the `aprovado_cliente` column for `agendado`.

- [ ] **Step 6: Pass the prop from `EntregasPage`**

In `apps/crm/src/pages/entregas/EntregasPage.tsx`, next to `postProcessesEnabled` (`:137`):

```ts
  const schedulingEnabled = features?.feature_post_scheduling === true;
```

and pass `schedulingEnabled={schedulingEnabled}` to `<PostsKanbanView ... />`. (`KanbanView` gets the same prop in Task 4.)

- [ ] **Step 7: Run the kanban nudge test**

```bash
npx vitest run apps/crm/src/pages/entregas/views/__tests__/PostsKanbanAutoScheduleNudge.test.tsx
```

Expected: PASS, 7 tests.

- [ ] **Step 8: Write the failing drawer-dropdown nudge test**

Create `apps/crm/src/pages/entregas/components/__tests__/WorkflowDrawerAutoScheduleNudge.test.tsx`, reusing `WorkflowDrawer.test.tsx`'s harness (it already mocks `@/store`, `@/hooks/useWorkspaceLimits` with a mutable `mockFeatures` at `:32-44`, dnd-kit, sonner and `@/lib/supabase`). Cases:

```tsx
it('opens the nudge after the status dropdown writes aprovado_cliente', async () => {
  // mockFeatures = { feature_post_scheduling: true }
  // card.cliente.auto_publish_on_approval = true
  // card.allEtapas = one open aprovacao_cliente
  // updateWorkflowPost resolves { ...post, status: 'aprovado_cliente', scheduled_at: <+3h> }
  // assert the nudge stub is rendered with that post id
});

it('opens the nudge from the "post aprovado" confirm path too', async () => {
  // statusChangeNeedsConfirm -> pendingStatusChange -> Confirmar -> nudge
  // (handleConfirmStatusChange at WorkflowDrawer.tsx:456 is the SECOND write site)
});

it('does not open the nudge when feature_post_scheduling is off', async () => {
  // mockFeatures = { feature_post_scheduling: false } -> no nudge
});

it('does not open the nudge when the client does not auto-publish', async () => {});

it('does not open the nudge in the first cycle of a dual-approval fluxo', async () => {
  // two open aprovacao_cliente etapas -> no nudge (PR #400 regression)
});

it('does not open the nudge for a write to another status', async () => {});
```

- [ ] **Step 9: Run it and confirm it fails**

```bash
npx vitest run apps/crm/src/pages/entregas/components/__tests__/WorkflowDrawerAutoScheduleNudge.test.tsx
```

Expected: FAIL — the nudge never renders.

- [ ] **Step 10: Wire the drawer's two status write sites**

In `apps/crm/src/pages/entregas/components/WorkflowDrawer.tsx`, add the imports (`isFinalClientApprovalCycle` joins the existing `@/store` import list; the drawer already has `features` from `useWorkspaceLimits()` at `:163`):

```ts
import { shouldOfferAutoSchedule } from '../autoScheduleNudge';
import {
  AutoSchedulePromptDialog,
  type AutoSchedulePromptPost,
} from './AutoSchedulePromptDialog';
```

Add, next to `keepStepsEnabled` (`:164`):

```ts
  const schedulingEnabled = features?.feature_post_scheduling === true;
  const [nudgePost, setNudgePost] = useState<AutoSchedulePromptPost | null>(null);

  /** Um só lugar para os três gates da spec, usado pelos dois pontos de escrita
   *  de status abaixo e pelo indicador persistente da linha do post. */
  const offerAutoSchedule = (updated: WorkflowPost): boolean =>
    shouldOfferAutoSchedule({
      status: updated.status,
      autoPublishOnApproval: card.cliente?.auto_publish_on_approval === true,
      schedulingFeatureEnabled: schedulingEnabled,
      isFinalApprovalCycle: isFinalClientApprovalCycle(card.allEtapas),
    });

  const maybeNudge = (updated: WorkflowPost) => {
    if (!offerAutoSchedule(updated)) return;
    setNudgePost({
      id: updated.id!,
      titulo: updated.titulo,
      platform: updated.platform,
      scheduled_at: updated.scheduled_at ?? null,
    });
  };
```

Change the status branch of `handleFieldChange` (`:439-445`) from:

```ts
      try {
        await updateWorkflowPost(id, statusKeyToPatch(key));
        refresh();
      } catch {
        toast.error('Erro ao atualizar post');
      }
      return;
```

to:

```ts
      try {
        const updated = await updateWorkflowPost(id, statusKeyToPatch(key));
        refresh();
        maybeNudge(updated);
      } catch {
        toast.error('Erro ao atualizar post');
      }
      return;
```

Change `handleConfirmStatusChange` (`:456-466`) the same way:

```ts
    try {
      const updated = await updateWorkflowPost(id, statusKeyToPatch(newStatusKey));
      refresh();
      maybeNudge(updated);
    } catch {
      toast.error('Erro ao atualizar status');
    }
```

Render the dialog next to the existing status-confirm `AlertDialog` (whose action button is at `:1092`):

```tsx
      <AutoSchedulePromptDialog
        post={nudgePost}
        onClose={() => setNudgePost(null)}
        onScheduled={() => {
          setNudgePost(null);
          refresh();
        }}
      />
```

`refresh()` is the drawer's own invalidation helper, already used by every other write in the file.

- [ ] **Step 11: Run the drawer nudge test plus the full entregas + cliente-detalhe suites**

```bash
npx vitest run apps/crm/src/pages/entregas/components/__tests__/WorkflowDrawerAutoScheduleNudge.test.tsx
npx vitest run apps/crm/src/pages/entregas apps/crm/src/pages/cliente-detalhe
npx tsc -p apps/crm/tsconfig.json --noEmit
npm run lint
```

Expected: all green. Any `No "X" export is defined on the mock` failure means one more store mock factory needs the new key — add it and re-run.

- [ ] **Step 12: Commit**

```bash
git add apps/crm/src/pages/entregas/views/PostsKanbanView.tsx \
  apps/crm/src/pages/entregas/components/WorkflowDrawer.tsx \
  apps/crm/src/pages/entregas/EntregasPage.tsx \
  apps/crm/src/pages/entregas/views/__tests__ \
  apps/crm/src/pages/entregas/components/__tests__ \
  apps/crm/src/pages/entregas/__tests__/EntregasPage.test.tsx
git commit -m "$(cat <<'EOF'
feat(entregas): nudge to schedule after a manual client approval

Kanban drag and the drawer's two status writes now offer to schedule when the
client auto-publishes on approval, the plan allows scheduling, and this is the
final approval cycle.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: Piece 2 — the batch summary dialog for "aprovar internamente"

**Files:**
- Create: `apps/crm/src/pages/entregas/components/AutoScheduleBatchDialog.tsx`
- Modify: `apps/crm/src/pages/entregas/views/KanbanView.tsx` — `handleApproveInternally` (`:1089-1102`); add `schedulingEnabled?: boolean` to `KanbanViewBaseProps` (`:89-136`)
- Modify: `apps/crm/src/pages/entregas/EntregasPage.tsx` — pass `schedulingEnabled` to `<KanbanView />`
- Modify: `apps/crm/src/pages/cliente-detalhe/tabs/EntregasTab.tsx` — `handleApproveInternally` (`:449-466`); call `useWorkspaceLimits()`
- Modify (test mock only): `apps/crm/src/pages/cliente-detalhe/tabs/__tests__/EntregasTab.test.tsx` — add a `@/hooks/useWorkspaceLimits` mock
- Test: `apps/crm/src/pages/entregas/components/__tests__/AutoScheduleBatchDialog.test.tsx` (create)
- Test: `apps/crm/src/pages/entregas/views/__tests__/KanbanBatchAutoScheduleNudge.test.tsx` (create)

**Interfaces:**
- Consumes from Task 1: `partitionByScheduleEligibility`, `scheduleApprovedPost`. Plus `getWorkflowPosts` (`apps/crm/src/store/posts.ts:554-562`), `approvalChoice.willRearm` (already held in state at `KanbanView.tsx:1076` and `EntregasTab.tsx:429`, computed by `decideApprovalAdvance`, `apps/crm/src/pages/entregas/approvalAdvance.ts:24-29`).
- Produces:

```ts
export interface AutoScheduleBatchDialogProps {
  /** null fecha. Não-null abre e busca os posts desse fluxo. */
  workflowId: number | null;
  onClose: () => void;
  onScheduled: () => void;
}
export function AutoScheduleBatchDialog(props: AutoScheduleBatchDialogProps): JSX.Element | null;
```

**The gate here is `!approvalChoice.willRearm`, not the etapa helper** (decision 3): that signal is already computed by `decideApprovalAdvance` before any write, from the etapa type and the fluxo's counts — recomputing it would duplicate a calculation the advance flow already did. The other two gates (`auto_publish_on_approval`, `feature_post_scheduling`) still apply.

**Open the dialog as soon as `approvePostsInternally` resolves** (decision 4). Do NOT wait for `advanceEtapa` / `completeEtapaForAdvance`: in `KanbanView` `advanceEtapa` (`:1019-1060`) swallows its own error, toasts, and returns `void`, so `await advanceEtapa(...)` always fulfils and carries no success signal. The guarantee the old ordering tried to protect comes from `willRearm` instead: `resetApprovedPostsForNextCycle` only runs inside a rearm that `willRearm` already predicted, and the gate requires `!willRearm`. In `EntregasTab.handleApproveInternally` the two awaits share one `try` block, so the dialog-open statement must sit *between* them — a `completeEtapaForAdvance` throw must not skip it.

- [ ] **Step 1: Write the failing batch-dialog test**

Create `apps/crm/src/pages/entregas/components/__tests__/AutoScheduleBatchDialog.test.tsx`:

```tsx
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const toastSuccess = vi.fn();
const toastError = vi.fn();
vi.mock('sonner', () => ({ toast: { success: toastSuccess, error: toastError, info: vi.fn() } }));

const getWorkflowPosts = vi.fn();
vi.mock('@/store', () => ({ getWorkflowPosts }));

const scheduleApprovedPost = vi.fn();
vi.mock('../../scheduleApprovedPost', () => ({
  scheduleApprovedPost,
  scheduleSuccessMessage: () => 'Post agendado para publicação no Instagram',
}));

import { AutoScheduleBatchDialog } from '../AutoScheduleBatchDialog';

const future = (h: number) => new Date(Date.now() + h * 60 * 60 * 1000).toISOString();
const past = () => new Date(Date.now() - 60 * 60 * 1000).toISOString();

const wrap = (ui: React.ReactElement) => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
};

describe('AutoScheduleBatchDialog', () => {
  beforeEach(() => {
    getWorkflowPosts.mockReset();
    scheduleApprovedPost.mockReset();
    toastSuccess.mockReset();
    toastError.mockReset();
    scheduleApprovedPost.mockResolvedValue({ ok: true, status: 'agendado' });
  });

  it('renders nothing when workflowId is null and never fetches', () => {
    const { container } = wrap(
      <AutoScheduleBatchDialog workflowId={null} onClose={vi.fn()} onScheduled={vi.fn()} />,
    );
    expect(container).toBeEmptyDOMElement();
    expect(getWorkflowPosts).not.toHaveBeenCalled();
  });

  it('counts only aprovado_cliente posts, split by date eligibility', async () => {
    getWorkflowPosts.mockResolvedValue([
      { id: 1, titulo: 'A', status: 'aprovado_cliente', platform: 'instagram', scheduled_at: future(3) },
      { id: 2, titulo: 'B', status: 'aprovado_cliente', platform: 'instagram', scheduled_at: null },
      { id: 3, titulo: 'C', status: 'aprovado_cliente', platform: 'instagram', scheduled_at: past() },
      { id: 4, titulo: 'D', status: 'agendado', platform: 'instagram', scheduled_at: future(5) },
      { id: 5, titulo: 'E', status: 'rascunho', platform: 'instagram', scheduled_at: future(5) },
    ]);
    wrap(<AutoScheduleBatchDialog workflowId={7} onClose={vi.fn()} onScheduled={vi.fn()} />);
    // 3 aprovado_cliente, of which 1 is eligible
    await waitFor(() => expect(screen.getByText(/3 posts aprovados/)).toBeInTheDocument());
    expect(screen.getByText(/1 já tem data/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Agendar 1 post/ })).toBeEnabled();
    // The two that cannot go are listed by name.
    expect(screen.getByText(/B/)).toBeInTheDocument();
    expect(screen.getByText(/C/)).toBeInTheDocument();
  });

  it('schedules every eligible post and reports the counts', async () => {
    getWorkflowPosts.mockResolvedValue([
      { id: 1, titulo: 'A', status: 'aprovado_cliente', platform: 'instagram', scheduled_at: future(3) },
      { id: 2, titulo: 'B', status: 'aprovado_cliente', platform: 'tiktok', scheduled_at: future(4) },
    ]);
    const onScheduled = vi.fn();
    wrap(<AutoScheduleBatchDialog workflowId={7} onClose={vi.fn()} onScheduled={onScheduled} />);
    const btn = await screen.findByRole('button', { name: /Agendar 2 posts/ });
    fireEvent.click(btn);
    await waitFor(() => expect(scheduleApprovedPost).toHaveBeenCalledTimes(2));
    expect(scheduleApprovedPost).toHaveBeenNthCalledWith(1, expect.objectContaining({ id: 1 }));
    expect(scheduleApprovedPost).toHaveBeenNthCalledWith(2, expect.objectContaining({ id: 2 }));
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith('2 posts agendados.'));
    expect(onScheduled).toHaveBeenCalled();
  });

  it('a failure in the loop does not stop the rest and is reported', async () => {
    getWorkflowPosts.mockResolvedValue([
      { id: 1, titulo: 'A', status: 'aprovado_cliente', platform: 'instagram', scheduled_at: future(3) },
      { id: 2, titulo: 'B', status: 'aprovado_cliente', platform: 'instagram', scheduled_at: future(4) },
    ]);
    scheduleApprovedPost
      .mockRejectedValueOnce(new Error('Legenda do Instagram não definida.'))
      .mockResolvedValueOnce({ ok: true, status: 'agendado' });
    wrap(<AutoScheduleBatchDialog workflowId={7} onClose={vi.fn()} onScheduled={vi.fn()} />);
    fireEvent.click(await screen.findByRole('button', { name: /Agendar 2 posts/ }));
    await waitFor(() => expect(scheduleApprovedPost).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(toastError).toHaveBeenCalledWith('1 post agendado, 1 falhou.'));
  });

  it('closes itself when the fluxo has no aprovado_cliente post left', async () => {
    getWorkflowPosts.mockResolvedValue([
      { id: 9, titulo: 'X', status: 'agendado', platform: 'instagram', scheduled_at: future(5) },
    ]);
    const onClose = vi.fn();
    wrap(<AutoScheduleBatchDialog workflowId={7} onClose={onClose} onScheduled={vi.fn()} />);
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });
});
```

Copy for the counts, written once here so the implementation and the test agree (no em-dashes):
- Title: `Agendar os posts aprovados?`
- Body: `` `${approved.length} posts aprovados. ${eligible.length} já tem data definida e pode ser agendado agora.` `` — use `já tem` / `já têm` and `post` / `posts` agreeing with the number; write a tiny local `plural(n, singular, plural)` helper rather than shipping `1 posts`.
- Action: `` `Agendar ${eligible.length} post(s)` `` with the same agreement helper.
- The non-eligible list header: `Sem data válida, agende manualmente:` followed by the titles.
- Result toasts: all succeeded → `` `${n} posts agendados.` ``; some failed → `` `${ok} post agendado, ${fail} falhou.` `` (again with agreement).

- [ ] **Step 2: Run it and confirm it fails**

```bash
npx vitest run apps/crm/src/pages/entregas/components/__tests__/AutoScheduleBatchDialog.test.tsx
```

Expected: FAIL — `Failed to resolve import "../AutoScheduleBatchDialog"`.

- [ ] **Step 3: Implement the batch dialog**

Create `apps/crm/src/pages/entregas/components/AutoScheduleBatchDialog.tsx`:

```tsx
import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { getWorkflowPosts } from '@/store';
import { partitionByScheduleEligibility } from '../autoScheduleNudge';
import { scheduleApprovedPost } from '../scheduleApprovedPost';

function plural(n: number, one: string, many: string): string {
  return n === 1 ? one : many;
}

export interface AutoScheduleBatchDialogProps {
  /** null fecha o diálogo. Não-null abre e busca os posts desse fluxo. */
  workflowId: number | null;
  onClose: () => void;
  onScheduled: () => void;
}

/**
 * Resumo da aprovação em lote (peça 2 da spec). Os gates (auto_publish_on_approval,
 * feature_post_scheduling, !willRearm) são do caller; aqui só a contagem e o loop.
 *
 * Por que buscar em vez de usar um snapshot do board: nem KanbanView nem
 * EntregasTab têm as linhas de workflow_posts do fluxo (só contagens por fluxo),
 * e approvePostsInternally devolve void. A busca depois da escrita também é mais
 * fresca do que qualquer snapshot anterior a ela. Ver a nota de desvio no plano
 * docs/superpowers/plans/2026-09-17-manual-approval-auto-schedule-nudge.md.
 *
 * Sem endpoint de lote no backend: loop sequencial, aceitável porque
 * max_posts_per_workflow já limita N por fluxo.
 */
export function AutoScheduleBatchDialog({
  workflowId,
  onClose,
  onScheduled,
}: AutoScheduleBatchDialogProps) {
  const [running, setRunning] = useState(false);

  const { data: posts, isLoading } = useQuery({
    queryKey: ['auto-schedule-batch-posts', workflowId],
    queryFn: () => getWorkflowPosts(workflowId!),
    enabled: workflowId != null,
    // staleTime 0 + gcTime 0: os dois são necessários. Sem gcTime 0, reabrir o
    // diálogo para o MESMO fluxo depois de um lote bem-sucedido renderiza a
    // lista em cache (a de antes do agendamento) com isLoading já false, e um
    // clique rápido em "Agendar todos" manda posts já agendados para o servidor
    // -> 422. Com gcTime 0 o cache é descartado ao desmontar e a reabertura
    // sempre começa em isLoading.
    staleTime: 0,
    gcTime: 0,
  });

  const approved = (posts ?? []).filter((p) => p.status === 'aprovado_cliente');
  const { eligible, missingDate } = partitionByScheduleEligibility(
    approved.map((p) => ({ ...p, scheduled_at: p.scheduled_at ?? null })),
  );

  // Nada aprovado (aprovação em lote sem efeito, ou tudo já agendado): não vale
  // um diálogo vazio.
  useEffect(() => {
    if (workflowId != null && !isLoading && posts && approved.length === 0) onClose();
  }, [workflowId, isLoading, posts, approved.length, onClose]);

  if (workflowId == null) return null;

  const handleScheduleAll = async () => {
    setRunning(true);
    let ok = 0;
    let fail = 0;
    for (const post of eligible) {
      try {
        await scheduleApprovedPost(post);
        ok++;
      } catch {
        // Um post inválido (legenda, mídia) não deve interromper os outros; a
        // contagem final é o relatório, o post continua em aprovado_cliente e o
        // indicador persistente segue oferecendo a ação.
        fail++;
      }
    }
    setRunning(false);
    onClose();
    if (fail === 0) {
      toast.success(`${ok} ${plural(ok, 'post agendado', 'posts agendados')}.`);
    } else {
      toast.error(
        `${ok} ${plural(ok, 'post agendado', 'posts agendados')}, ${fail} ${plural(fail, 'falhou', 'falharam')}.`,
      );
    }
    if (ok > 0) onScheduled();
  };

  return (
    <AlertDialog
      open
      onOpenChange={(open) => {
        if (!open && !running) onClose();
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Agendar os posts aprovados?</AlertDialogTitle>
          <AlertDialogDescription>
            {isLoading
              ? 'Carregando os posts do fluxo…'
              : `${approved.length} ${plural(approved.length, 'post aprovado', 'posts aprovados')}. ${eligible.length} ${plural(eligible.length, 'já tem data definida e pode', 'já têm data definida e podem')} ser agendado agora. Este cliente agenda a publicação automaticamente quando o próprio cliente aprova pelo portal.`}
          </AlertDialogDescription>
        </AlertDialogHeader>

        {missingDate.length > 0 && (
          <div className="px-1 text-xs" style={{ color: 'var(--text-muted)' }}>
            <p className="font-semibold">Sem data válida, agende manualmente:</p>
            <ul>
              {missingDate.map((p) => (
                <li key={p.id}>{p.titulo || 'Post sem título'}</li>
              ))}
            </ul>
          </div>
        )}

        <AlertDialogFooter>
          <AlertDialogCancel disabled={running}>Agora não</AlertDialogCancel>
          <Button onClick={handleScheduleAll} disabled={running || eligible.length === 0}>
            {`Agendar ${eligible.length} ${plural(eligible.length, 'post', 'posts')}`}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
```

- [ ] **Step 4: Run the batch dialog test**

```bash
npx vitest run apps/crm/src/pages/entregas/components/__tests__/AutoScheduleBatchDialog.test.tsx
```

Expected: PASS, 5 tests.

- [ ] **Step 5: Write the failing KanbanView batch-wiring test**

Create `apps/crm/src/pages/entregas/views/__tests__/KanbanBatchAutoScheduleNudge.test.tsx`, modelled on the existing `KanbanRearm.test.tsx` (read it first: it already drives the approval-choice dialog and mocks `../../../../store` with `approvePostsInternally`, `hasLaterApprovalEtapa`, and `completeEtapaForAdvance`). Stub `../../components/AutoScheduleBatchDialog` with `({ workflowId }) => workflowId ? <div data-testid="batch-nudge">{workflowId}</div> : null`. Cases:

```tsx
it('opens the batch dialog right after approvePostsInternally resolves', async () => {
  // gates all true, willRearm false -> testid present
});

// Decision 4 / the Codex correction: advanceEtapa swallows its own error and
// returns void, so the dialog must not depend on it.
it('still opens the dialog when completeEtapaForAdvance rejects afterwards', async () => {
  // completeEtapaForAdvance.mockRejectedValue(new Error('db offline'))
  // -> the dialog is still there; the advance's own error toast also fired
});

it('never opens the dialog when willRearm is true', async () => {
  // hasLaterApprovalEtapa -> true so decideApprovalAdvance yields willRearm: true
  // -> no testid, EVEN THOUGH approvePostsInternally succeeded
});

it('never opens the dialog when the client does not auto-publish on approval', async () => {});

it('never opens the dialog when schedulingEnabled is false', async () => {});

it('never opens the dialog when approvePostsInternally itself fails', async () => {
  // approvePostsInternally.mockRejectedValue(...) -> no testid, error toast only
});
```

- [ ] **Step 6: Run it and confirm it fails**

```bash
npx vitest run apps/crm/src/pages/entregas/views/__tests__/KanbanBatchAutoScheduleNudge.test.tsx
```

Expected: FAIL — no `batch-nudge` testid.

- [ ] **Step 7: Wire `KanbanView.handleApproveInternally`**

Add `schedulingEnabled?: boolean` to `KanbanViewBaseProps` (same doc comment as in Task 3), destructure it, and import the dialog. Add state:

```ts
  /** Fluxo cujo resumo de agendamento em lote está aberto (peça 2 da spec). */
  const [batchScheduleWfId, setBatchScheduleWfId] = useState<number | null>(null);
```

Replace `handleApproveInternally` (`:1089-1102`):

```ts
  const handleApproveInternally = async () => {
    if (!approvalChoice) return;
    const card = approvalChoice.card;
    setApprovalChoice(null);
    try {
      await approvePostsInternally(card.workflow.id!);
    } catch (err: unknown) {
      pendingInsertRef.current = null;
      toast.error((err as Error).message || 'Erro ao aprovar internamente');
      return;
    }
    await advanceEtapa(card, 'Posts aprovados internamente — etapa concluída!');
  };
```

with:

```ts
  const handleApproveInternally = async () => {
    if (!approvalChoice) return;
    const card = approvalChoice.card;
    const { willRearm } = approvalChoice;
    setApprovalChoice(null);
    try {
      await approvePostsInternally(card.workflow.id!);
    } catch (err: unknown) {
      // The advance never runs, so the drag's captured drop position must not
      // survive to reorder a later, unrelated advance of this workflow.
      pendingInsertRef.current = null;
      toast.error((err as Error).message || 'Erro ao aprovar internamente');
      return;
    }
    // Aviso de agendamento em lote (spec peça 2), aberto AQUI e não depois de
    // advanceEtapa: advanceEtapa captura o próprio erro e devolve void, então
    // não existe sinal de sucesso para esperar (decisão 4). O gate !willRearm já
    // garante que nenhum rearm vai devolver estes posts para rascunho.
    if (
      !willRearm &&
      schedulingEnabled === true &&
      card.cliente?.auto_publish_on_approval === true
    ) {
      setBatchScheduleWfId(card.workflow.id!);
    }
    await advanceEtapa(card, 'Posts aprovados internamente — etapa concluída!');
  };
```

Note: leave the existing success message string exactly as it is — it already contains an em-dash and rewriting unrelated copy is out of scope for this change.

Render next to the other modals:

```tsx
      <AutoScheduleBatchDialog
        workflowId={batchScheduleWfId}
        onClose={() => setBatchScheduleWfId(null)}
        onScheduled={() => {
          setBatchScheduleWfId(null);
          onRefresh();
        }}
      />
```

Pass `schedulingEnabled={schedulingEnabled}` from `EntregasPage.tsx` to `<KanbanView />` (the constant was added in Task 3, Step 6).

- [ ] **Step 8: Wire `EntregasTab.handleApproveInternally`**

In `apps/crm/src/pages/cliente-detalhe/tabs/EntregasTab.tsx`, add:

```ts
import { useWorkspaceLimits } from '@/hooks/useWorkspaceLimits';
import { AutoScheduleBatchDialog } from '@/pages/entregas/components/AutoScheduleBatchDialog';
```

and inside the component:

```ts
  const { features } = useWorkspaceLimits();
  const schedulingEnabled = features?.feature_post_scheduling === true;
  const [batchScheduleWfId, setBatchScheduleWfId] = useState<number | null>(null);
```

Replace `handleApproveInternally` (`:449-466`):

```ts
  const handleApproveInternally = async () => {
    const card = approvalChoice?.card;
    setApprovalChoice(null);
    if (!card) return;
    try {
      await approvePostsInternally(card.workflow.id!);
      const result = await completeEtapaForAdvance(card.workflow.id!, card.etapa.id!);
      ...
```

with (note where the dialog-open statement sits — **between** the two awaits, inside the same `try`, so a `completeEtapaForAdvance` throw cannot skip it):

```ts
  const handleApproveInternally = async () => {
    const card = approvalChoice?.card;
    const willRearm = approvalChoice?.willRearm === true;
    setApprovalChoice(null);
    if (!card) return;
    try {
      await approvePostsInternally(card.workflow.id!);
      // Spec peça 2 / decisão 4: assim que a escrita de aprovação resolve. Fica
      // ANTES do avanço de etapa de propósito -- se completeEtapaForAdvance
      // lançar, o catch abaixo mostra o erro do avanço, mas os posts já estão
      // aprovados e o aviso de agendamento continua válido.
      if (!willRearm && schedulingEnabled && card.cliente?.auto_publish_on_approval === true) {
        setBatchScheduleWfId(card.workflow.id!);
      }
      const result = await completeEtapaForAdvance(card.workflow.id!, card.etapa.id!);
      if (result.workflow.status === 'concluido' && card.workflow.recorrente) {
        setRecurringWfId(card.workflow.id!);
      } else {
        refreshCards();
        toast.success(t('detail.stepCompleted'));
      }
      notifyRearmOutcome(result);
    } catch (err: unknown) {
      toast.error(t('detail.stepError', { error: (err as Error).message }));
    }
  };
```

Render the dialog alongside the tab's other dialogs:

```tsx
      <AutoScheduleBatchDialog
        workflowId={batchScheduleWfId}
        onClose={() => setBatchScheduleWfId(null)}
        onScheduled={() => {
          setBatchScheduleWfId(null);
          refreshCards();
        }}
      />
```

- [ ] **Step 9: Add the `useWorkspaceLimits` mock to `EntregasTab.test.tsx`**

`apps/crm/src/pages/cliente-detalhe/tabs/__tests__/EntregasTab.test.tsx` mocks `@/store` strictly (`:6`) but has no `useWorkspaceLimits` mock. Add one following the mutable-features pattern from `WorkflowDrawer.test.tsx:32-44`:

```tsx
let mockFeatures: Record<string, boolean> | null = null;
vi.mock('@/hooks/useWorkspaceLimits', () => ({
  useWorkspaceLimits: () => ({
    limits: null,
    get features() {
      return mockFeatures;
    },
    planName: null,
    isLoading: false,
    isUnlimited: true,
  }),
}));
```

`EntregasTab` already imports `getWorkflowPosts` from `@/store` today, so that key is already in the factory — but confirm it, and add it if not.

- [ ] **Step 10: Run the batch tests and the neighbouring suites**

```bash
npx vitest run apps/crm/src/pages/entregas/views/__tests__/KanbanBatchAutoScheduleNudge.test.tsx
npx vitest run apps/crm/src/pages/entregas apps/crm/src/pages/cliente-detalhe
npx tsc -p apps/crm/tsconfig.json --noEmit
npm run lint
```

Expected: all green, including the pre-existing `KanbanRearm.test.tsx` and `EntregasTabRearm.test.tsx`.

- [ ] **Step 11: Commit**

```bash
git add apps/crm/src/pages/entregas/components/AutoScheduleBatchDialog.tsx \
  apps/crm/src/pages/entregas/components/__tests__/AutoScheduleBatchDialog.test.tsx \
  apps/crm/src/pages/entregas/views/KanbanView.tsx \
  apps/crm/src/pages/entregas/views/__tests__/KanbanBatchAutoScheduleNudge.test.tsx \
  apps/crm/src/pages/entregas/EntregasPage.tsx \
  apps/crm/src/pages/cliente-detalhe/tabs/EntregasTab.tsx \
  apps/crm/src/pages/cliente-detalhe/tabs/__tests__/EntregasTab.test.tsx
git commit -m "$(cat <<'EOF'
feat(entregas): batch auto-schedule summary after aprovar internamente

Opens as soon as approvePostsInternally resolves (advanceEtapa carries no
success signal), gated on !willRearm, and loops scheduleApprovedPost over the
posts whose date is still valid.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: Piece 3 — the persistent indicator for the existing backlog

**Files:**
- Create: `apps/crm/src/pages/entregas/components/AutoScheduleBadge.tsx`
- Modify: `apps/crm/src/pages/entregas/components/WorkflowDrawer.tsx` — `SortablePostItemProps` (`:1152-1199`), the collapsed row's right side (next to `<PostStatusChip .../>`, `:1350`), and the posts section header (`:897-903`, where `{approvedCount} de {clientFacingCount} aprovados pelo cliente` renders; the counts are computed at `:784-786`)
- Modify: `apps/crm/src/pages/entregas/views/PostsKanbanView.tsx` — `PostBoardCardContent` (`:172-300`)
- Modify: `apps/crm/style.css` — one small rule set for the badge
- Test: `apps/crm/src/pages/entregas/components/__tests__/AutoScheduleBadge.test.tsx` (create)
- Test: extend `apps/crm/src/pages/entregas/components/__tests__/WorkflowDrawerAutoScheduleNudge.test.tsx` (from Task 3) with the indicator cases

**Interfaces:**
- Consumes from Tasks 1-2: `shouldOfferAutoSchedule`, `isEligibleToScheduleNow`, `isFinalClientApprovalCycle`, `AutoSchedulePromptDialog`.
- Produces:

```ts
export interface AutoScheduleBadgeProps {
  /** Ausente/undefined torna o badge estático (usado no clone do DragOverlay). */
  onClick?: () => void;
  /** Muda só o tooltip: com data válida o clique agenda direto, sem data o
   *  clique abre o seletor de data primeiro. */
  needsDate: boolean;
}
export function AutoScheduleBadge(props: AutoScheduleBadgeProps): JSX.Element;
```

**The gate this piece must not forget (Codex P0):** all three gates, `isFinalClientApprovalCycle` included. Without it, a post in the FIRST cycle of a dual-approval fluxo gets an always-visible "Agendar" action and publishes before the second approval — the PR #400 bug reintroduced through a new surface. Neither publish endpoint applies `isFinalApprovalCycle` on its own (it exists only inside `hub-approve`), so this check has to come from the indicator's side. The etapas are already in hand at both surfaces: `card.allEtapas` in the kanban (via `cardsByWorkflowId`) and `card.allEtapas` in the drawer. No new round trip.

**Note that `isEligibleToScheduleNow` does NOT gate visibility here** — it only decides what the click does (schedule directly vs. open the date picker first). The whole point of this piece is reaching the stuck posts, most of which have a date in the past.

- [ ] **Step 1: Write the failing badge test**

Create `apps/crm/src/pages/entregas/components/__tests__/AutoScheduleBadge.test.tsx`:

```tsx
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { AutoScheduleBadge } from '../AutoScheduleBadge';

describe('AutoScheduleBadge', () => {
  it('is a button that fires onClick when interactive', () => {
    const onClick = vi.fn();
    render(<AutoScheduleBadge onClick={onClick} needsDate={false} />);
    fireEvent.click(screen.getByRole('button', { name: /Agendar/ }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('renders a static, non-button badge with no onClick (DragOverlay clone)', () => {
    render(<AutoScheduleBadge needsDate={false} />);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(screen.getByText(/Agendar/)).toBeInTheDocument();
  });

  it('stops pointerdown from reaching a dnd-kit drag listener', () => {
    const onClick = vi.fn();
    const onPointerDown = vi.fn();
    render(
      <div onPointerDown={onPointerDown}>
        <AutoScheduleBadge onClick={onClick} needsDate={false} />
      </div>,
    );
    fireEvent.pointerDown(screen.getByRole('button', { name: /Agendar/ }));
    expect(onPointerDown).not.toHaveBeenCalled();
  });

  it('explains in its title that a date is needed first', () => {
    render(<AutoScheduleBadge onClick={vi.fn()} needsDate />);
    expect(screen.getByRole('button', { name: /Agendar/ })).toHaveAttribute(
      'title',
      expect.stringMatching(/data/i),
    );
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

```bash
npx vitest run apps/crm/src/pages/entregas/components/__tests__/AutoScheduleBadge.test.tsx
```

Expected: FAIL — unresolved import.

- [ ] **Step 3: Implement the badge**

Create `apps/crm/src/pages/entregas/components/AutoScheduleBadge.tsx`:

```tsx
import { CalendarClock } from 'lucide-react';

export interface AutoScheduleBadgeProps {
  /** Sem onClick o badge é estático: é assim que ele aparece no clone do
   *  DragOverlay do kanban, onde um botão seria inerte e confuso. */
  onClick?: () => void;
  /** Só muda o tooltip: sem data válida o clique abre o seletor de data antes. */
  needsDate: boolean;
}

const TITLE_READY = 'Este cliente agenda automaticamente. Clique para agendar este post.';
const TITLE_NEEDS_DATE =
  'Este cliente agenda automaticamente, mas este post não tem data válida. Clique para definir a data e agendar.';

/**
 * Indicador persistente da peça 3 da spec: aparece em todo post em
 * aprovado_cliente que passou os três gates e está esperando um agendamento que
 * nunca vai acontecer sozinho. Quem decide a visibilidade é o caller
 * (shouldOfferAutoSchedule); este componente é só a superfície.
 */
export function AutoScheduleBadge({ onClick, needsDate }: AutoScheduleBadgeProps) {
  const title = needsDate ? TITLE_NEEDS_DATE : TITLE_READY;
  if (!onClick) {
    return (
      <span className="auto-schedule-badge" title={title}>
        <CalendarClock className="h-3 w-3" aria-hidden="true" /> Agendar
      </span>
    );
  }
  return (
    <button
      type="button"
      className="auto-schedule-badge auto-schedule-badge--action"
      title={title}
      // O badge vive dentro de um card arrastável (kanban) e de uma linha
      // clicável (drawer): sem parar os dois eventos, o clique inicia um drag
      // ou expande o acordeão em vez de abrir o aviso.
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
    >
      <CalendarClock className="h-3 w-3" aria-hidden="true" /> Agendar
    </button>
  );
}
```

Add to `apps/crm/style.css` (near the other `board-post-*` / `drawer-post-*` rules — grep for `.board-post-prazo-pill` and put it next to that):

```css
.auto-schedule-badge {
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
  padding: 0.1rem 0.35rem;
  border-radius: 6px;
  font-size: 10px;
  font-weight: 600;
  color: #f5a342;
  background: rgba(245, 163, 66, 0.12);
  border: none;
  white-space: nowrap;
}
.auto-schedule-badge--action {
  cursor: pointer;
}
.auto-schedule-badge--action:hover {
  background: rgba(245, 163, 66, 0.22);
}
```

`#f5a342` is the legacy `--warning` token value (see DESIGN_SYSTEM.md); use the literal to match the neighbouring pills in this file, which do the same.

- [ ] **Step 4: Run the badge test**

```bash
npx vitest run apps/crm/src/pages/entregas/components/__tests__/AutoScheduleBadge.test.tsx
```

Expected: PASS, 4 tests.

- [ ] **Step 5: Extend the drawer nudge test with the indicator cases**

Add to `apps/crm/src/pages/entregas/components/__tests__/WorkflowDrawerAutoScheduleNudge.test.tsx`:

```tsx
describe('persistent indicator (spec piece 3)', () => {
  it('shows the badge on an aprovado_cliente post when every gate passes', async () => {
    // one open aprovacao_cliente etapa, auto_publish true, feature on,
    // post.status 'aprovado_cliente' with a date in the PAST (the backlog case)
    // -> badge present
  });

  // The P0 the Codex review caught missing from this section of the spec.
  it('hides the badge in the first cycle of a dual-approval fluxo', async () => {
    // card.allEtapas = two OPEN aprovacao_cliente etapas -> no badge
  });

  it('hides the badge when feature_post_scheduling is off', async () => {});
  it('hides the badge when the client does not auto-publish on approval', async () => {});
  it('hides the badge for a post in any other status', async () => {});

  it('clicking the badge opens the same nudge dialog', async () => {
    // -> the AutoSchedulePromptDialog stub receives that post id
  });

  it('shows the header summary with the count of waiting posts', async () => {
    // 2 of 3 posts eligible for the indicator -> "2 aguardando agendamento automático"
  });

  it('omits the header summary when no post qualifies', async () => {});

  it('the header action opens the batch dialog for this fluxo', async () => {
    // -> AutoScheduleBatchDialog stub receives workflowId
  });
});
```

- [ ] **Step 6: Run it and confirm the new cases fail**

```bash
npx vitest run apps/crm/src/pages/entregas/components/__tests__/WorkflowDrawerAutoScheduleNudge.test.tsx
```

Expected: the Task-3 cases still pass; the nine new ones fail.

- [ ] **Step 7: Wire the drawer row badge and the header summary**

In `WorkflowDrawer.tsx`:

Add two props to `SortablePostItemProps` (`:1152`):

```ts
  /** True quando este post passou os três gates do aviso de agendamento
   *  automático (spec peça 3). Calculado pelo drawer, não pela linha. */
  showAutoScheduleBadge: boolean;
  /** Abre o aviso para este post. */
  onAutoScheduleClick: () => void;
```

Pass them where `SortablePostItem` is rendered (`:967`):

```tsx
                          showAutoScheduleBadge={offerAutoSchedule(post)}
                          onAutoScheduleClick={() => maybeNudge(post)}
```

`offerAutoSchedule` and `maybeNudge` are the helpers added in Task 3, Step 10. `maybeNudge` already re-checks the gates, so a stale prop can never open a dialog it should not.

Inside `SortablePostItem`'s collapsed row, right after `<PostStatusChip post={post} registry={statusRegistry} />` (`:1350`):

```tsx
          {showAutoScheduleBadge && (
            <AutoScheduleBadge
              onClick={onAutoScheduleClick}
              needsDate={!isEligibleToScheduleNow(post.scheduled_at)}
            />
          )}
```

For the header summary, add next to `approvedCount` / `clientFacingCount` (`:784-786`):

```ts
  /** Posts que passaram os três gates e estão esperando um agendamento que não
   *  vai acontecer sozinho (spec peça 3, resumo do cabeçalho). */
  const awaitingAutoScheduleCount = orderedPosts.filter((p) => offerAutoSchedule(p)).length;
```

and extend the header (`:897-903`):

```tsx
                  {clientFacingCount > 0 && (
                    <span className="drawer-post-count">
                      {approvedCount} de {clientFacingCount} aprovados pelo cliente
                    </span>
                  )}
                  {awaitingAutoScheduleCount > 0 && (
                    <button
                      type="button"
                      className="auto-schedule-badge auto-schedule-badge--action"
                      onClick={() => setBatchScheduleWfId(workflowId)}
                      title="Agendar de uma vez os posts aprovados que ainda têm data válida."
                    >
                      <CalendarClock className="h-3 w-3" aria-hidden="true" />
                      {awaitingAutoScheduleCount} aguardando agendamento automático
                    </button>
                  )}
```

The header action reuses `AutoScheduleBatchDialog` from Task 4, so the drawer also needs its own `batchScheduleWfId` state and a render of that dialog:

```ts
  const [batchScheduleWfId, setBatchScheduleWfId] = useState<number | null>(null);
```

```tsx
      <AutoScheduleBatchDialog
        workflowId={batchScheduleWfId}
        onClose={() => setBatchScheduleWfId(null)}
        onScheduled={() => {
          setBatchScheduleWfId(null);
          refresh();
        }}
      />
```

Imports to add in this file: `CalendarClock` from `lucide-react`, `AutoScheduleBadge` from `./AutoScheduleBadge`, `AutoScheduleBatchDialog` from `./AutoScheduleBatchDialog`, `isEligibleToScheduleNow` from `../autoScheduleNudge`.

- [ ] **Step 8: Wire the kanban card face**

In `PostsKanbanView.tsx`, add to `PostBoardCardContent`'s props (`:173-183`):

```ts
  /** Abre o aviso de agendamento automático para este post. Ausente no clone do
   *  DragOverlay, que renderiza o badge estático. */
  onAutoScheduleClick?: () => void;
  schedulingEnabled?: boolean;
```

Compute inside it (it already receives `card`, which carries `cliente` and `allEtapas`):

```ts
  const offerAutoSchedule = shouldOfferAutoSchedule({
    status: post.status,
    autoPublishOnApproval: card?.cliente?.auto_publish_on_approval === true,
    schedulingFeatureEnabled: schedulingEnabled === true,
    isFinalApprovalCycle: card ? isFinalClientApprovalCycle(card.allEtapas) : false,
  });
```

Render it inside the `item-top` right-hand `<span>` (`:192` opens `item-top`; the span holds the "Publicando…" pill and the prazo pill), immediately before the `locked` lock icon at `:213`:

```tsx
          {offerAutoSchedule && (
            <AutoScheduleBadge
              onClick={onAutoScheduleClick}
              needsDate={!isEligibleToScheduleNow(post.scheduled_at)}
            />
          )}
```

At the real card's render site pass `schedulingEnabled={schedulingEnabled}` and `onAutoScheduleClick={() => setNudgePost({ id: post.id, titulo: post.titulo, platform: post.platform, scheduled_at: post.scheduled_at })}` (`setNudgePost` and the dialog already exist from Task 3). At the `DragOverlay` clone's render site pass `schedulingEnabled` but **not** `onAutoScheduleClick`, so the clone gets the static badge.

- [ ] **Step 9: Run everything touched**

```bash
npx vitest run apps/crm/src/pages/entregas apps/crm/src/pages/cliente-detalhe
npx tsc -p apps/crm/tsconfig.json --noEmit
npm run lint
npm run format
```

Expected: all green.

- [ ] **Step 10: Commit**

```bash
git add apps/crm/src/pages/entregas/components/AutoScheduleBadge.tsx \
  apps/crm/src/pages/entregas/components/__tests__/AutoScheduleBadge.test.tsx \
  apps/crm/src/pages/entregas/components/WorkflowDrawer.tsx \
  apps/crm/src/pages/entregas/components/__tests__/WorkflowDrawerAutoScheduleNudge.test.tsx \
  apps/crm/src/pages/entregas/views/PostsKanbanView.tsx \
  apps/crm/style.css
git commit -m "$(cat <<'EOF'
feat(entregas): persistent auto-schedule indicator on stuck approved posts

Badge on the drawer post row and the kanban card face, plus a per-fluxo summary
in the drawer header. Gated on the final-approval-cycle check so a first-cycle
post in a dual-approval fluxo never gets a schedule action.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: Full verification sweep and browser check

**Files:** none (verification only), unless a gate fails.

**Interfaces:** consumes everything from Tasks 1-5.

- [ ] **Step 1: Run every gate CI runs, in CI's order**

`.github/workflows/ci.yml` is the source of truth; `npm run build` is NOT the typecheck (it only covers the CRM).

```bash
npm run lint
npx tsc -p apps/crm/tsconfig.json   --noEmit
npx tsc -p apps/hub/tsconfig.json   --noEmit
npx tsc -p apps/admin/tsconfig.json --noEmit
npx tsc -p tsconfig.scripts.json
npm run test
npm run check:functions
npm run test:functions
npm run format:check
```

Notes:
- The Hub imports `apps/crm/style.css` wholesale (`apps/hub/src/main.tsx`), so the new `.auto-schedule-badge` rules land in the Hub bundle too. They are scoped to a new class nothing in the Hub uses, but the Hub `tsc` and a quick Hub smoke check are still required.
- `npm run test:functions` and `npm run check:functions` should be unaffected (this plan touches no edge function), but they are cheap and they are CI gates.
- If `npm run test:functions` leaves `deno.lock` dirty, restore it: `git checkout deno.lock`. If a Deno run created `node_modules/.deno`, run `npm ci` before trusting the Vitest results.

- [ ] **Step 2: Confirm the whole Vitest suite, not just the touched folders**

```bash
npm run test 2>&1 | tail -30
```

Expected: the same pass/fail shape as `origin/main`, plus the new files. Any `No "X" export is defined on the mock` failure anywhere in the repo is a store mock that needs `isFinalClientApprovalCycle: vi.fn(() => true)` — the list in Task 3 Step 1 covers the known ones, but the suite is authoritative.

- [ ] **Step 3: Manual browser verification against staging**

The responsive/feature-gated behavior here cannot be proven in jsdom. Start the CRM against staging and check the three surfaces with a client that has `auto_publish_on_approval = true` on a plan that includes `feature_post_scheduling`:

```bash
npm run dev:staging
```

Worktree caveat: worktrees do not carry `.env.staging`, so `:staging` silently hits PROD from here. Copy `.env.staging` in from the main checkout first (never commit it) and run `npm ci` inside the worktree if `node_modules` looks off.

Check, in order:
1. Publicações kanban: drag a post of that client into "Aprovado pelo cliente" → the nudge opens; "Agendar" moves it to "Agendado".
2. Same drag, then hit "Desfazer" on the toast while the dialog is open → the dialog closes.
3. A post whose date is in the past: the nudge shows the date picker, "Definir e agendar" is disabled until a new date is picked.
4. A fluxo with TWO client-approval etapas, post in the first cycle → **no** nudge, **no** badge. This is the PR #400 regression check and it is the single most important manual case.
5. Fluxo drawer: change a post's status to "Aprovado pelo cliente" via the dropdown → nudge; the header shows "N aguardando agendamento automático" for a fluxo with stuck posts; the header action opens the batch summary.
6. Drag the fluxo card forward on the Fluxos board so the approval choice dialog appears → "Aprovar internamente" → the batch summary lists the eligible posts and the ones without a date.
7. Switch to a client with `auto_publish_on_approval = false` → nothing appears anywhere.

- [ ] **Step 4: Commit any fixes the sweep produced, then report**

```bash
git status
git log --oneline origin/main..HEAD
```

Report the branch, the commits, and any manual case that could not be exercised on staging (for example: no dual-approval fluxo available there — say so rather than claiming the check passed).

---

## Verification and CI gates (reference)

| Gate | Command | Why it matters here |
|---|---|---|
| ESLint | `npm run lint` | Unused `scheduleInstagramPost` / `scheduleTikTokPost` imports in `ScheduleButton.tsx` after Task 1 fail here |
| CRM types | `npx tsc -p apps/crm/tsconfig.json --noEmit` | All the new props and the `Cliente` field |
| Hub types | `npx tsc -p apps/hub/tsconfig.json --noEmit` | The Hub imports the CRM stylesheet and shares `@/store` types |
| Admin types | `npx tsc -p apps/admin/tsconfig.json --noEmit` | CI gate; untouched but must stay green |
| Scripts types | `npx tsc -p tsconfig.scripts.json` | CI gate |
| Vitest | `npm run test` | Every new test plus the store-mock fallout |
| Coverage | `npm run coverage:check` | `coverage-threshold` is its own CI job |
| Deno check | `npm run check:functions` | No function changed, but it is a gate |
| Deno tests | `npm run test:functions` | Same; also the `hub-functions_test.ts` mirror fixtures live there |
| Prettier | `npm run format:check` (`npm run format` fixes) | `format-check` is its own CI job |

### The five Codex-review-caught defects, and the test that guards each

| # | Defect the review caught | Guarding test |
|---|---|---|
| 1 | A bare `!!scheduled_at` eligibility check 422s on the very posts that motivated the work; an exact 10-minute client boundary goes invalid during request latency | `autoScheduleNudge.test.ts`: "rejects the server boundary itself: exactly now + 10 min", "rejects anything inside the safety margin: now + 11 min", "accepts exactly now + 10 min + the safety margin" (Task 1, Step 2) |
| 2 | `useWorkspaceLimits()` exposes the flag inside `features`, not at the root, so a root-level read is always `undefined` and the gate silently never fires | `PostsKanbanAutoScheduleNudge.test.tsx` "does not open the nudge when schedulingEnabled is false" + `WorkflowDrawerAutoScheduleNudge.test.tsx` "does not open the nudge when feature_post_scheduling is off", both driven through the real `features?.feature_post_scheduling` read (Task 3, Steps 3 and 8) |
| 3 | Waiting for `advanceEtapa` to "resolve successfully" before opening the batch dialog is impossible: it swallows its error and returns `void` | `KanbanBatchAutoScheduleNudge.test.tsx` "still opens the dialog when completeEtapaForAdvance rejects afterwards" and "never opens the dialog when willRearm is true" (Task 4, Step 5) |
| 4 | The date branch handing `scheduleApprovedPost` the closure's original `post` sends the stale (or null) date to the TikTok endpoint | `AutoSchedulePromptDialog.test.tsx` "date branch: schedules with the row updateWorkflowPost returned, not the original post", including the negative assertion against the old date (Task 2, Step 1) |
| 5 | **P0:** the persistent indicator's first draft forgot the final-approval-cycle gate, reintroducing the PR #400 premature-publish bug on a new surface | `finalApprovalCycle.test.ts` "is false with two open client-approval etapas" (Task 1, Step 6) + `WorkflowDrawerAutoScheduleNudge.test.tsx` "hides the badge in the first cycle of a dual-approval fluxo" + `PostsKanbanAutoScheduleNudge.test.tsx` "does not open the nudge in the first cycle of a dual-approval fluxo" (Tasks 3 and 5) + manual case 4 in Task 6 Step 3 |

Plus the spec's other named test requirements: `scheduleApprovedPost` platform routing including `both` (Task 1, Step 10), the mirror fixtures shared with `hub-functions_test.ts` (Task 1, Step 6), the batch N/M counts and the "no valid date" list (Task 4, Step 1), and the indicator appearing/disappearing per gate (Task 5, Step 5).

---

## Self-Review Notes

**Spec coverage.** Every section of `2026-09-17-manual-approval-auto-schedule-nudge-design.md` maps to a task:

| Spec section | Task |
|---|---|
| "Peça já existente sendo reaproveitada" / `scheduleApprovedPost` helper | Task 1, Steps 10-15 |
| Decision 1 (eligibility with a 2-minute safety margin) | Task 1, Steps 2-5; used in Tasks 2, 4, 5 |
| Decision 2 (cover both future approvals and the existing backlog) | Tasks 3 and 4 (future), Task 5 (backlog) |
| Decision 3 (mirror `isFinalApprovalCycle`; use `!willRearm` for the batch) | Task 1, Steps 6-9 (mirror); Task 4, Steps 7-8 (`willRearm`) |
| Decision 4 (batch dialog opens right after `approvePostsInternally`) | Task 4, Steps 7-8, with the ordering spelled out in both call sites |
| Decision 5 (`features?.feature_post_scheduling` gate everywhere) | Task 3, Steps 5-6 and 10; Task 4, Steps 7-8; Task 5, Step 8 |
| Decision 6 (`platform === 'both'` uses the TikTok service only) | Task 1, Steps 10-12 |
| Design técnico §1 (individual transition dialog) | Tasks 2 and 3 |
| Design técnico §2 (batch summary) | Task 4 |
| Design técnico §3 (persistent indicator, both places) | Task 5 |
| "Tipagem" (`Cliente.auto_publish_on_approval`) | Task 1, Step 14 |
| "Testes" (all seven bullets) | The table above maps each one |
| "Fora de escopo" (posts avulsos, auto-enforcement, batch endpoint, reminders, backfill) | Global Constraints; nothing in any task touches them |

**Two deviations, stated in Global Constraints and repeated here so they cannot be missed.** (1) The batch dialog fetches the fluxo's posts with `getWorkflowPosts(workflowId)` instead of reading a board snapshot, because no per-post state exists at either call site (`KanbanView` and `EntregasTab` both receive per-fluxo counts only). Intent preserved, mechanism changed, nothing else in the spec affected. (2) `Cliente.auto_publish_on_approval` is declared optional rather than the spec's required `boolean`, matching the interface's existing nullable columns; call sites narrow with `=== true`, so behaviour is unchanged. Both are worth folding back into the spec if it is ever revised; this plan does not edit it.

**Placeholder scan.** The only steps that describe tests instead of spelling them out line-for-line are Task 3 Steps 3 and 8, Task 4 Step 5, and Task 5 Step 5, where the test bodies depend on a large existing harness (`PostsKanbanView.test.tsx`, `WorkflowDrawer.test.tsx`, `KanbanRearm.test.tsx`) that must be read and reused rather than retyped. Each of those steps names the harness file to copy, the stub to substitute for the dialog under test, and the exact assertion for every case. No step says "add error handling", "handle edge cases", or "write tests for the above".

**Type and name consistency.** Checked across tasks: `isFinalClientApprovalCycle` (not `isFinalApprovalCycle`, which is the server's name) is used identically in Tasks 1, 3 and 5; `shouldOfferAutoSchedule` takes the same four-field `AutoScheduleGateInput` at all four call sites; `AutoSchedulePromptPost` is the dialog's post shape in Tasks 2, 3 and 5; `AutoScheduleBatchDialog` takes `workflowId | null` in Tasks 4 and 5; `schedulingEnabled` is the prop name on both `PostsKanbanViewProps` (Task 3) and `KanbanViewBaseProps` (Task 4), and the local constant in `EntregasPage` / `WorkflowDrawer` / `EntregasTab`; `SchedulablePost` is satisfied by both `WorkflowPost` and `ActivePost` because both carry `id`, `platform` and `scheduled_at` (`apps/crm/src/store/posts.ts:86-89`, `:262`, and `POST_CONTEXT_COLUMNS` at `:290-291`).

**Deliberate divergence from the server, documented in code:** `isFinalClientApprovalCycle([])` returns `false` while the server's `isFinalApprovalCycle` would return `true` for an empty etapa list. On the server an empty list means "fluxo with no approval etapa" (express, legacy) and is genuinely final; on the client it means "we have no etapas for this post", which for this feature must fail closed. The implementation comment and the test both say so, so a future reader does not "fix" the mirror into agreeing.
