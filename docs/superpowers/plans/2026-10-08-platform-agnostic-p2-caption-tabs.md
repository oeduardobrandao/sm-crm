# Platform-agnostic posts — P2: Destinos row, per-destination caption tabs, board chips

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** With `feature_multiplatform` ON, the post editor shows a "Destinos" toggle row (limited to the board's platforms) and one caption tab per destination (native-format hint, status pill, per-platform counter), the caption no longer depends on a connected Instagram account, and the Publicações board card shows one status chip per destination. With the flag OFF (or still loading) nothing changes.

**Architecture:**
- **Frontend only. No migration, no edge function.** P1 already lets `authenticated` INSERT/UPDATE/DELETE `post_targets` under RLS (`20261010100002`, suite section 4), and the DEFINER sync trigger re-derives `workflow_posts.platform` on every target insert/delete. P2 writes `post_targets` directly from the CRM, the same way P1's deviation 2 intended ("The UI restricts everything else (P2 editor)").
- **Where each caption lives (decided):**
  - Instagram: `workflow_posts.ig_caption`, through the existing `InstagramCaptionField` + `save_ig_caption` RPC. Comments, anchors, versions and edit suggestions stay as they are (spec: they stay Instagram-only).
  - TikTok: `workflow_posts.tiktok_caption`, as today. The TikTok publisher still reads it (`_shared/tiktok-publish-utils.ts:233`, `tiktok-publish/handler.ts:397`) and the spec moves it to `post_targets.caption` only in P4.
  - Geral: `post_targets.caption` (first real writer of that column).
- **Per-destination state** comes from a pure TS resolver (`resolveDestinationState`) over the legacy publish columns plus the target row, shared by the board chips and the tab pills. The `post_targets_resolved` SQL view is deferred again (deviation 1).
- **Gate:** `features?.feature_multiplatform === true` in `PostEditorBody` and in `EntregasPage` (board chips). OFF = today's tree, byte for byte: `PlatformSelector`, a single `InstagramCaptionField` behind `hasInstagramAccount`, the stories note, `TikTokSettingsPanel` with its own caption field.

**Tech Stack:** React 19, TanStack Query, Radix Tabs (shadcn `components/ui/tabs.tsx`), Vitest + Testing Library, psql entitlement suite (test-only addition).

**Spec:** `docs/superpowers/specs/2026-09-29-platform-agnostic-posts-design.md` (phases table row P2; UX items 2 and 3; "Captions are always separate per destination"; "A newly added destination starts from the first destination's caption"; Approval assumption). **Depends on P1** (`#606`, merged as `2d45bb0df`, migrations `20261010100001..7` live).

## Deliberate deviations from the spec (for reviewers)

1. **No `post_targets_resolved` view in P2.** P1 deviation 1 deferred it to "the phase that first reads it". P2's only readers are two CRM surfaces that already load the legacy columns, so the derivation is a pure TS function (`resolveDestinationState` in `apps/crm/src/pages/entregas/postDestinations.ts`), unit-tested, with the exact rules the spec gives for the view (Instagram: `instagram_media_id` = publicado, `publish_error` without media id = falha, never the shared `falha_publicacao`; TikTok: from `tiktok_publish_status`). It prefers `post_targets.status` whenever that is not `pendente`, so it keeps working when P4/P5 start writing target status. The view moves to P3, whose Hub/edge readers (`hub-posts`) need one SQL shape.
2. **No server-side validation of the Destinos row** (consistent with P1 deviation 2). The UI only offers the board's platforms (plus destinations the post already has), TikTok only with `feature_tiktok` and an active TikTok account, never on stories, and hides the row on Post Express. The DB keeps enforcing what P1 enforces (platform CHECK, composite tenant FK, RLS, `z7` drops TikTok on stories). A direct API write could add a destination outside the board, exactly as since P1.
3. **No new DB flag guard on `post_targets` writes.** `feature_multiplatform` gates the UI only. Writes to `post_targets` have been possible for any workspace member since P1; P2 adds no new reachable state for a workspace without the flag.
4. **The "first destination's caption" rule is pinned as:** the first destination the post already has, in registry order (`PLATFORM_IDS`: Instagram, TikTok, Geral), whose caption is non-empty. The copy is cut to the new destination's `captionMaxFor(platform, tipo)` (never splitting a surrogate pair). A destination whose own caption is already non-empty (for example Instagram removed and re-added) keeps it and gets no copy. Listed again under Open questions.
5. **The copy for Instagram/TikTok is two requests, not one transaction:** insert the target, then write the caption (`save_ig_caption` for Instagram, a plain update for TikTok). If the second request fails the destination exists with an empty caption and a toast says so; the user can type it. Geral is a single INSERT carrying the caption.
6. **Geral pill shim.** `post_targets.status` stays `pendente` for Geral until P3 flips it to `disponivel` on approval. P2's resolver shows Geral as "Disponível" when `post.status` is `aprovado_cliente`, `agendado` or `postado`. P3 replaces the shim with the real write; the resolver already prefers the row's own status.
7. **`post_targets.format` stays NULL.** The tabs compute the native format from the registry (`PLATFORM_DEFS[p].nativeFormats[tipo]`). Storing it matters only when publishers read it (P4/P5).
8. **Editor layout is not restructured.** The spec mockup puts media and a "Formato" select on the left. P2 keeps the current single-column drawer layout and the "Tipo" label; the Destinos row takes the `PlatformSelector` slot in the meta row and the tabs take the caption slot under the content editor.
9. **"Baixar conteúdo" is P3.** The Geral tab ships "Copiar legenda" (clipboard only) in P2; the zip/link download needs `file-zip`/`file-manage` work that the spec schedules in P3.
10. **`tiktok_title` stays in `TikTokSettingsPanel`** (photo posts only, as today). The panel itself moves inside the TikTok tab with its caption field hidden (`hideCaption`), so the TikTok tab is the only TikTok caption editor. A per-tab "Título" field is YouTube's (later phase).
11. **The UI never reaches zero destinations.** Turning off the last one shows "O post precisa de pelo menos um destino." (same rule as `PlatformChips`). The DB still allows zero (P1).
12. **`ScheduleButton` gets one flag-ON-only addition:** a short hint when an approved post targets Instagram but the client has no connected Instagram account (today it renders nothing). Its publish/schedule logic is untouched; the "connected account" check already controls only publish/schedule there (`ScheduleButton.tsx:210`).
13. **One query shape changes for every workspace, flag or not:** `getActivePosts` (the Publicações board request) embeds `post_targets(platform, status)` on both arms. It is an indexed lookup through the unique `(post_id, platform)` and nothing renders it without the flag; gating the select on the flag would refetch the board when the limits load. Only the UI is "exactly as today" with the flag off.
14. **Hub is untouched.** The Hub still shows only the Instagram caption; per-destination caption blocks are P3. With the flag dark this is invisible to clients.

## Global Constraints

- **Branch:** `claude/platform-agnostic-p2`, cut from `origin/main` at `2d45bb0df`. Before starting: `git -C <worktree> branch --show-current` must print `claude/platform-agnostic-p2`, and `git log HEAD..origin/main --oneline` must be empty (rebase first if not).
- **No SQL migrations in this phase.** If a task seems to need one, stop and escalate. (If one is ever added, its version must sort above `ls supabase/migrations | tail -1`, today `20261010100007`.)
- **Flag:** `const multiplatform = features?.feature_multiplatform === true;` `features === null/undefined` (loading) is OFF. Every UI task ships a flag-OFF regression test proving the old tree renders and no `post_targets` request is made.
- **Allowed values:** platform ids exactly `'instagram' | 'tiktok' | 'geral'` (`PLATFORM_IDS` from `@mesaas/platforms`); `post_targets.status` exactly `'pendente','agendado','processando','publicado','falha','disponivel'`.
- **Unsaved work:** every new caption editor goes through `useCaptionDraft` (which already calls `useUnsavedWork(draft !== null)` from `@mesaas/app-lifecycle`). Never `useBlocker`. Tab panels use `forceMount` so an inactive tab never unmounts a draft.
- **Mocked `@/store` in existing tests:** `WorkflowDrawer*.test.tsx`, `StandalonePostDrawer.test.tsx` and `PostsKanbanView.test.tsx` mock `@/store` with a fixed export list. New store functions must only be referenced inside closures that run with the flag ON (`queryFn`, `mutationFn`, handlers), and pure helpers used by the card (`postDestinations.ts`, `DestinationStatusPill.tsx`) must import from the store with `import type` only.
- **Copy:** Portuguese, no em dashes in any new user-facing string (the existing TikTok label at `TikTokSettingsPanel.tsx:456` has one: do not copy it). The `→` arrow in the native-format hint is fine.
- **Gates before pushing:**
  - `npm run lint`, `npm run format:check`
  - `npx tsc -p apps/crm/tsconfig.json --noEmit`, `npx tsc -p apps/hub/tsconfig.json --noEmit`, `npx tsc -p apps/admin/tsconfig.json --noEmit`, `npx tsc -p tsconfig.scripts.json`
  - `npm run test`, `npm run check:functions`, `npm run test:functions` (nothing in `supabase/functions` changes, but they are CI gates)
  - `bash scripts/test-entitlements.sh` against a local Supabase on colima (Task 3 adds a section). Never commit per-worktree port overrides in `supabase/config.toml`.
- **Deploy:** nothing to deploy before merge (no migration, no function). Merge deploys the CRM; everything new is behind the flag. Turn it on per workspace with the Admin override `{"feature_multiplatform": true}`.

## File map

| File | Status | Responsibility |
|---|---|---|
| `apps/crm/src/store/postTargets.ts` | create | Types + CRUD for `post_targets`, board platforms, per-destination caption save |
| `apps/crm/src/store/index.ts` | modify | re-export `postTargets` |
| `apps/crm/src/store/posts.ts` | modify | `ScheduledPost.targets`, `getActivePosts` embeds `post_targets(platform, status)` |
| `apps/crm/src/components/platformIcons.ts` | create | `PLATFORM_ICONS` (moved out of `PlatformChips.tsx`) |
| `apps/crm/src/components/PlatformChips.tsx` | modify | import `PLATFORM_ICONS` |
| `apps/crm/src/pages/entregas/postDestinations.ts` | create | Pure rules: state resolver, labels, native-format hint, caption seed, toggle options |
| `apps/crm/src/pages/entregas/components/useCaptionDraft.ts` | modify | `max: number \| null` argument, shrinking allowed above the limit |
| `apps/crm/src/pages/entregas/components/DestinationCaptionField.tsx` | create | Plain caption editor (TikTok, Geral) on top of `useCaptionDraft` |
| `apps/crm/src/pages/entregas/components/InstagramCaptionField.tsx` | modify | handle gains `getText()` |
| `apps/crm/src/pages/entregas/components/TikTokSettingsPanel.tsx` | modify | `hideCaption` prop |
| `apps/crm/src/pages/entregas/components/ScheduleButton.tsx` | modify | `explainMissingInstagramAccount` prop |
| `apps/crm/src/pages/entregas/components/DestinationStatusPill.tsx` | create | Pill + board `DestinationChips` |
| `apps/crm/src/pages/entregas/views/PostsKanbanView.tsx` | modify | `multiplatformEnabled` prop, chips on the card |
| `apps/crm/src/pages/entregas/EntregasPage.tsx` | modify | passes `multiplatformEnabled` |
| `apps/crm/src/pages/entregas/components/DestinationToggles.tsx` | create | "Destinos" toggle row |
| `apps/crm/src/pages/entregas/components/DestinationCaptionTabs.tsx` | create | One tab per destination |
| `apps/crm/src/pages/entregas/hooks/usePostDestinations.ts` | create | Queries + mutations for one post's destinations |
| `apps/crm/src/pages/entregas/components/PostEditorBody.tsx` | modify | Flag gate wiring |
| `supabase/tests/entitlements/99_post_targets.sql` | modify | Section 15: the exact writes P2's CRM makes, as `authenticated` |

## Lanes (what can run in parallel)

| Wave | Tasks (parallel inside a wave) | Depends on |
|---|---|---|
| 1 | **T1** store, **T3** entitlements section, **T4** `useCaptionDraft` max, **T6** `TikTokSettingsPanel.hideCaption`, **T7** `ScheduleButton` hint | nothing |
| 2 | **T2** `postDestinations.ts` + icons | T1 (types) |
| 3 | **T5** `DestinationCaptionField` (needs T4), **T8** board chips (needs T1, T2), **T9** `DestinationToggles` (needs T2) | see column |
| 4 | **T10** `DestinationCaptionTabs` + `usePostDestinations` | T1, T2, T5, T8 (pill) |
| 5 | **T11** `PostEditorBody` integration | T6, T7, T9, T10 |
| 6 | **T12** verification, browser check, PR | all |

File conflicts to watch when running a wave in parallel: T6 and T7 touch different files; T8 is the only task touching `PostsKanbanView.tsx`/`EntregasPage.tsx`; T11 is the only task touching `PostEditorBody.tsx`.

---

### Task 1: Store module `postTargets.ts` + board embed

**Files:**
- Create: `apps/crm/src/store/postTargets.ts`
- Modify: `apps/crm/src/store/index.ts` (append one line)
- Modify: `apps/crm/src/store/posts.ts:246-279` (`ScheduledPost`), `:305-337` (`mapPostContextRow`), `:393-413` (`getActivePosts`)
- Test: `apps/crm/src/store/__tests__/postTargets.test.ts` (create), `apps/crm/src/__tests__/store.posts.test.ts` (add one case)

**Interfaces:**
- Consumes: `supabase` from `./core`; `PLATFORM_IDS`, `PlatformId` from `@mesaas/platforms`.
- Produces:
  - `type PostTargetStatus = 'pendente' | 'agendado' | 'processando' | 'publicado' | 'falha' | 'disponivel'`
  - `interface PostTargetSummary { platform: PlatformId; status: PostTargetStatus }`
  - `interface PostTargetRow extends PostTargetSummary { id: number; post_id: number; caption: string | null }`
  - `sortByPlatformOrder<T extends { platform: PlatformId }>(rows: T[]): T[]`
  - `getPostTargets(postId: number): Promise<PostTargetRow[]>`
  - `getBoardPlatforms(post: { workflow_id: number | null; cliente_id: number }): Promise<PlatformId[]>`
  - `addPostDestination(args: { postId: number; contaId: string; platform: PlatformId; seedCaption: string | null }): Promise<void>`
  - `removePostDestination(postId: number, platform: PlatformId): Promise<void>`
  - `savePostCaption(postId: number, platform: 'tiktok' | 'geral', text: string): Promise<void>`
  - `ScheduledPost.targets?: PostTargetSummary[]` (so `ActivePost.targets` too)

- [ ] **Step 1: Write the failing store tests**

Create `apps/crm/src/store/__tests__/postTargets.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../lib/supabase');

import * as supabaseModule from '../../lib/supabase';
import {
  addPostDestination,
  getBoardPlatforms,
  getPostTargets,
  removePostDestination,
  savePostCaption,
} from '../postTargets';

type MockedSupabaseModule = typeof supabaseModule & {
  __getSupabaseCalls: () => Array<{
    table: string;
    operation: string;
    payload?: unknown;
    selectArgs?: unknown[][];
    modifiers: Array<{ method: string; args: unknown[] }>;
  }>;
  __queueSupabaseResult: (
    table: string,
    operation: 'select' | 'insert' | 'update' | 'delete' | 'upsert',
    ...responses: Array<{ data?: unknown; error?: unknown }>
  ) => void;
  __queueSupabaseRpc: (name: string, ...responses: Array<{ data?: unknown; error?: unknown }>) => void;
  __resetSupabaseMock: () => void;
};
const mocked = supabaseModule as MockedSupabaseModule;
const calls = (table: string, op?: string) =>
  mocked.__getSupabaseCalls().filter((c) => c.table === table && (!op || c.operation === op));

describe('postTargets store', () => {
  beforeEach(() => mocked.__resetSupabaseMock());

  it('getPostTargets reads one post and sorts by registry order', async () => {
    mocked.__queueSupabaseResult('post_targets', 'select', {
      data: [
        { id: 2, post_id: 9, platform: 'geral', status: 'pendente', caption: 'g' },
        { id: 1, post_id: 9, platform: 'instagram', status: 'pendente', caption: null },
      ],
      error: null,
    });
    const rows = await getPostTargets(9);
    expect(rows.map((r) => r.platform)).toEqual(['instagram', 'geral']);
    expect(calls('post_targets', 'select')[0].modifiers).toContainEqual({
      method: 'eq',
      args: ['post_id', 9],
    });
  });

  it('getBoardPlatforms reads the workflow, or the client default for an avulso', async () => {
    mocked.__queueSupabaseResult('workflows', 'select', {
      data: { plataformas: ['instagram', 'geral'] },
      error: null,
    });
    expect(await getBoardPlatforms({ workflow_id: 5, cliente_id: 7 })).toEqual([
      'instagram',
      'geral',
    ]);
    mocked.__queueSupabaseResult('clientes', 'select', {
      data: { plataformas_padrao: ['geral'] },
      error: null,
    });
    expect(await getBoardPlatforms({ workflow_id: null, cliente_id: 7 })).toEqual(['geral']);
  });

  it('getBoardPlatforms falls back to Instagram when the row is missing', async () => {
    mocked.__queueSupabaseResult('workflows', 'select', { data: null, error: null });
    expect(await getBoardPlatforms({ workflow_id: 5, cliente_id: 7 })).toEqual(['instagram']);
  });

  it('adds Geral with its caption in a single insert', async () => {
    mocked.__queueSupabaseResult('post_targets', 'insert', { data: null, error: null });
    await addPostDestination({ postId: 9, contaId: 'ws', platform: 'geral', seedCaption: 'oi' });
    expect(calls('post_targets', 'insert')[0].payload).toEqual({
      conta_id: 'ws',
      post_id: 9,
      platform: 'geral',
      caption: 'oi',
    });
    expect(calls('rpc:save_ig_caption', 'rpc')).toHaveLength(0);
  });

  it('adds Instagram, then seeds ig_caption through save_ig_caption', async () => {
    mocked.__queueSupabaseResult('post_targets', 'insert', { data: null, error: null });
    mocked.__queueSupabaseRpc('save_ig_caption', { data: null, error: null });
    await addPostDestination({ postId: 9, contaId: 'ws', platform: 'instagram', seedCaption: 'x' });
    expect(calls('post_targets', 'insert')[0].payload).toEqual({
      conta_id: 'ws',
      post_id: 9,
      platform: 'instagram',
    });
    expect(calls('rpc:save_ig_caption', 'rpc')[0].payload).toEqual({
      p_post_id: 9,
      p_caption: 'x',
      p_anchors: [],
    });
  });

  it('adds TikTok and seeds tiktok_caption; no seed means no caption write', async () => {
    mocked.__queueSupabaseResult('post_targets', 'insert', { data: null, error: null });
    mocked.__queueSupabaseResult('workflow_posts', 'update', { data: null, error: null });
    await addPostDestination({ postId: 9, contaId: 'ws', platform: 'tiktok', seedCaption: 'tt' });
    expect(calls('workflow_posts', 'update')[0].payload).toEqual({ tiktok_caption: 'tt' });

    mocked.__resetSupabaseMock();
    mocked.__queueSupabaseResult('post_targets', 'insert', { data: null, error: null });
    await addPostDestination({ postId: 9, contaId: 'ws', platform: 'tiktok', seedCaption: null });
    expect(calls('workflow_posts', 'update')).toHaveLength(0);
  });

  it('treats a duplicate destination (23505) as already added', async () => {
    mocked.__queueSupabaseResult('post_targets', 'insert', {
      data: null,
      error: { code: '23505', message: 'duplicate key' },
    });
    await expect(
      addPostDestination({ postId: 9, contaId: 'ws', platform: 'geral', seedCaption: null }),
    ).resolves.toBeUndefined();
  });

  it('removePostDestination deletes one (post, platform) row', async () => {
    mocked.__queueSupabaseResult('post_targets', 'delete', { data: null, error: null });
    await removePostDestination(9, 'tiktok');
    const del = calls('post_targets', 'delete')[0];
    expect(del.modifiers).toContainEqual({ method: 'eq', args: ['post_id', 9] });
    expect(del.modifiers).toContainEqual({ method: 'eq', args: ['platform', 'tiktok'] });
  });

  it('savePostCaption routes TikTok to workflow_posts and Geral to post_targets', async () => {
    mocked.__queueSupabaseResult('workflow_posts', 'update', { data: null, error: null });
    await savePostCaption(9, 'tiktok', 'a');
    expect(calls('workflow_posts', 'update')[0].payload).toEqual({ tiktok_caption: 'a' });

    mocked.__queueSupabaseResult('post_targets', 'update', { data: null, error: null });
    await savePostCaption(9, 'geral', 'b');
    const upd = calls('post_targets', 'update')[0];
    expect(upd.payload).toMatchObject({ caption: 'b' });
    expect(upd.modifiers).toContainEqual({ method: 'eq', args: ['platform', 'geral'] });
  });

  it('throws store errors so the caller can toast', async () => {
    mocked.__queueSupabaseResult('post_targets', 'update', {
      data: null,
      error: { message: 'boom' },
    });
    await expect(savePostCaption(9, 'geral', 'b')).rejects.toBeTruthy();
  });
});
```

Add to `apps/crm/src/__tests__/store.posts.test.ts`, inside `describe('store workflow posts')`, after the two existing `getActivePosts` cases:

```ts
  it('getActivePosts embeds post_targets on both arms and maps them sorted', async () => {
    mockedSupabase.__queueSupabaseResult(
      'workflow_posts',
      'select',
      {
        data: [
          {
            id: 1,
            workflow_id: 5,
            titulo: 'P',
            tipo: 'feed',
            status: 'rascunho',
            scheduled_at: null,
            ordem: 0,
            workflows: { titulo: 'F', cliente_id: 7, status: 'ativo', clientes: { nome: 'Y' } },
            post_targets: [
              { platform: 'geral', status: 'pendente' },
              { platform: 'instagram', status: 'pendente' },
            ],
          },
        ],
        error: null,
      },
      { data: [], error: null },
    );
    const [post] = await store.getActivePosts();
    expect(post.targets?.map((t) => t.platform)).toEqual(['instagram', 'geral']);
    const selects = getCalls('workflow_posts', 'select') as Array<{ selectArgs?: unknown[][] }>;
    for (const call of selects) {
      expect(String(call.selectArgs?.[0]?.[0])).toContain('post_targets(platform, status)');
    }
  });
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `npx vitest run apps/crm/src/store/__tests__/postTargets.test.ts apps/crm/src/__tests__/store.posts.test.ts`
Expected: FAIL (`Cannot find module '../postTargets'`, and `post.targets` undefined).

- [ ] **Step 3: Implement**

Create `apps/crm/src/store/postTargets.ts`:

```ts
import { PLATFORM_IDS, type PlatformId } from '@mesaas/platforms';
import { supabase } from './core';

/**
 * Destinos de um post (tabela post_targets, migration 20261010100002).
 * Spec: docs/superpowers/specs/2026-09-29-platform-agnostic-posts-design.md
 *
 * Onde mora a legenda de cada destino (P2):
 *   instagram -> workflow_posts.ig_caption (save_ig_caption: âncoras, versões, sugestões)
 *   tiktok    -> workflow_posts.tiktok_caption (o publicador do TikTok lê essa coluna até P4)
 *   geral     -> post_targets.caption
 * O banco deriva workflow_posts.platform sozinho a cada INSERT/DELETE aqui
 * (trigger post_targets_sync_platform); nada deste módulo escreve platform.
 */
export type PostTargetStatus =
  | 'pendente'
  | 'agendado'
  | 'processando'
  | 'publicado'
  | 'falha'
  | 'disponivel';

export interface PostTargetSummary {
  platform: PlatformId;
  status: PostTargetStatus;
}

export interface PostTargetRow extends PostTargetSummary {
  id: number;
  post_id: number;
  caption: string | null;
}

export function sortByPlatformOrder<T extends { platform: PlatformId }>(rows: T[]): T[] {
  return [...rows].sort(
    (a, b) => PLATFORM_IDS.indexOf(a.platform) - PLATFORM_IDS.indexOf(b.platform),
  );
}

export async function getPostTargets(postId: number): Promise<PostTargetRow[]> {
  const { data, error } = await supabase
    .from('post_targets')
    .select('id, post_id, platform, status, caption')
    .eq('post_id', postId);
  if (error) throw error;
  return sortByPlatformOrder((data ?? []) as PostTargetRow[]);
}

/** Espelha post_board_platforms() do banco: fluxo, ou o padrão do cliente se avulso. */
export async function getBoardPlatforms(post: {
  workflow_id: number | null;
  cliente_id: number;
}): Promise<PlatformId[]> {
  if (post.workflow_id != null) {
    const { data, error } = await supabase
      .from('workflows')
      .select('plataformas')
      .eq('id', post.workflow_id)
      .maybeSingle();
    if (error) throw error;
    return ((data as { plataformas?: PlatformId[] } | null)?.plataformas ?? [
      'instagram',
    ]) as PlatformId[];
  }
  const { data, error } = await supabase
    .from('clientes')
    .select('plataformas_padrao')
    .eq('id', post.cliente_id)
    .maybeSingle();
  if (error) throw error;
  return ((data as { plataformas_padrao?: PlatformId[] } | null)?.plataformas_padrao ?? [
    'instagram',
  ]) as PlatformId[];
}

/**
 * Liga um destino. `seedCaption` (já cortada no limite da plataforma) só vem quando
 * a legenda própria do destino está vazia (quem decide é seedCaptionFor). Geral leva
 * a legenda no próprio INSERT; Instagram/TikTok gravam a legenda depois, nas colunas
 * legadas (desvio 5 do plano P2: dois requests, sem transação).
 */
export async function addPostDestination(args: {
  postId: number;
  contaId: string;
  platform: PlatformId;
  seedCaption: string | null;
}): Promise<void> {
  const { postId, contaId, platform, seedCaption } = args;
  const row: Record<string, unknown> = { conta_id: contaId, post_id: postId, platform };
  if (platform === 'geral') row.caption = seedCaption;
  const { error } = await supabase.from('post_targets').insert(row);
  // 23505 = o destino já existe (clique duplo, outra aba): nada a fazer.
  if (error && (error as { code?: string }).code !== '23505') throw error;
  if (error || !seedCaption || platform === 'geral') return;

  if (platform === 'instagram') {
    const { error: capErr } = await supabase.rpc('save_ig_caption', {
      p_post_id: postId,
      p_caption: seedCaption,
      p_anchors: [],
    });
    if (capErr) throw capErr;
    return;
  }
  const { error: capErr } = await supabase
    .from('workflow_posts')
    .update({ tiktok_caption: seedCaption })
    .eq('id', postId);
  if (capErr) throw capErr;
}

export async function removePostDestination(postId: number, platform: PlatformId): Promise<void> {
  const { error } = await supabase
    .from('post_targets')
    .delete()
    .eq('post_id', postId)
    .eq('platform', platform);
  if (error) throw error;
}

/** Legenda de TikTok ou Geral. A do Instagram segue em save_ig_caption (comments.ts). */
export async function savePostCaption(
  postId: number,
  platform: 'tiktok' | 'geral',
  text: string,
): Promise<void> {
  if (platform === 'tiktok') {
    const { error } = await supabase
      .from('workflow_posts')
      .update({ tiktok_caption: text })
      .eq('id', postId);
    if (error) throw error;
    return;
  }
  const { error } = await supabase
    .from('post_targets')
    .update({ caption: text, updated_at: new Date().toISOString() })
    .eq('post_id', postId)
    .eq('platform', 'geral');
  if (error) throw error;
}
```

Append to `apps/crm/src/store/index.ts`:

```ts
export * from './postTargets';
```

In `apps/crm/src/store/posts.ts`:
- Add `import { sortByPlatformOrder, type PostTargetSummary } from './postTargets';` next to the other imports (line 2-6).
- In `interface ScheduledPost` (after `board_ordem`, line ~278):

```ts
  /** Destinos do post (embed post_targets). Só getActivePosts preenche: o card do
   *  quadro de Publicações mostra um chip por destino com feature_multiplatform. */
  targets?: PostTargetSummary[];
```

- In `mapPostContextRow` (after `board_ordem: row.board_ordem ?? null,`):

```ts
    targets: Array.isArray(row.post_targets) ? sortByPlatformOrder(row.post_targets) : undefined,
```

- In `getActivePosts`, change both selects to embed the targets (one-to-many through the composite FK `post_targets_post_same_tenant`):

```ts
      .select(
        `${POST_CONTEXT_COLUMNS}, post_targets(platform, status), workflows!inner(titulo, cliente_id, status, clientes(nome))`,
      )
```

```ts
      .select(`${POST_CONTEXT_COLUMNS}, post_targets(platform, status), clientes(nome)`)
```

Do NOT add the embed to `POST_CONTEXT_COLUMNS` itself (it feeds the calendar, Minha fila and processes; only the board renders chips).

- [ ] **Step 4: Verify the embed against a real PostgREST**

The composite FK `(post_id, conta_id) → workflow_posts(id, conta_id)` is load-bearing. With the local stack up (`npx supabase start` on colima, P1 migrations applied), run as the service role:

```bash
curl -s "http://127.0.0.1:54321/rest/v1/workflow_posts?select=id,post_targets(platform,status)&limit=2" \
  -H "apikey: $LOCAL_SERVICE_ROLE_KEY" -H "Authorization: Bearer $LOCAL_SERVICE_ROLE_KEY"
```

(`LOCAL_SERVICE_ROLE_KEY` from `npx supabase status`.) Expected: rows with a `post_targets` array. If PostgREST answers `PGRST200`/`PGRST201`, use the explicit hint `post_targets!post_targets_post_same_tenant(platform, status)` in both selects and in the test's `toContain`.

- [ ] **Step 5: Run the tests and confirm they pass**

Run: `npx vitest run apps/crm/src/store/__tests__/postTargets.test.ts apps/crm/src/__tests__/store.posts.test.ts apps/crm/src/pages/entregas/hooks/__tests__/useActivePosts.test.ts apps/crm/src/pages/entregas/hooks/__tests__/useMinhaFilaData.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/crm/src/store/postTargets.ts apps/crm/src/store/index.ts apps/crm/src/store/posts.ts \
  apps/crm/src/store/__tests__/postTargets.test.ts apps/crm/src/__tests__/store.posts.test.ts
git commit -m "feat(platforms): store de destinos do post e embed no quadro de Publicações (P2)"
```

---

### Task 2: Pure destination rules + shared platform icons

**Files:**
- Create: `apps/crm/src/pages/entregas/postDestinations.ts`
- Create: `apps/crm/src/components/platformIcons.ts`
- Modify: `apps/crm/src/components/PlatformChips.tsx:1-17` (use the shared icons)
- Test: `apps/crm/src/pages/entregas/__tests__/postDestinations.test.ts`

**Interfaces:**
- Consumes: `PostTargetStatus`, `PostTargetSummary` (Task 1, **type-only import**); `WorkflowPost` (type-only); registry exports.
- Produces:
  - `type DestinationState = 'pendente' | 'aguardando_aprovacao' | 'agendado' | 'processando' | 'publicado' | 'falha' | 'disponivel'`
  - `DESTINATION_STATE_LABELS: Record<DestinationState, string>`
  - `type DestinationPostFields = Pick<WorkflowPost, 'status' | 'scheduled_at' | 'instagram_media_id' | 'publish_error' | 'tiktok_publish_status'>`
  - `resolveDestinationState(post: DestinationPostFields, target: PostTargetSummary, now?: Date): DestinationState`
  - `nativeFormatHint(platform: PlatformId, tipo: ContentFormat): string | null`
  - `truncateCaption(text: string, max: number | null): string`
  - `seedCaptionFor(platform: PlatformId, current: PlatformId[], captions: Partial<Record<PlatformId, string | null>>, tipo: ContentFormat): string | null`
  - `interface DestinationToggleOption { platform: PlatformId; on: boolean; disabledReason: string | null }`
  - `destinationToggleOptions(args: { boardPlatforms: PlatformId[]; current: PlatformId[]; tipo: ContentFormat; tiktokFeatureEnabled: boolean; hasActiveTikTokAccount: boolean; isExpress: boolean }): DestinationToggleOption[]`
  - `PLATFORM_ICONS: Record<PlatformId, LucideIcon>` from `@/components/platformIcons`

- [ ] **Step 1: Write the failing test**

Create `apps/crm/src/pages/entregas/__tests__/postDestinations.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  DESTINATION_STATE_LABELS,
  destinationToggleOptions,
  nativeFormatHint,
  resolveDestinationState,
  seedCaptionFor,
  truncateCaption,
  type DestinationPostFields,
} from '../postDestinations';

const post = (over: Partial<DestinationPostFields> = {}): DestinationPostFields => ({
  status: 'rascunho',
  scheduled_at: null,
  instagram_media_id: null,
  publish_error: null,
  tiktok_publish_status: null,
  ...over,
});
const ig = { platform: 'instagram', status: 'pendente' } as const;
const tt = { platform: 'tiktok', status: 'pendente' } as const;
const geral = { platform: 'geral', status: 'pendente' } as const;
const NOW = new Date('2026-10-08T12:00:00Z');

describe('resolveDestinationState', () => {
  it('Instagram: media id wins, then publish_error, never the shared falha_publicacao', () => {
    expect(resolveDestinationState(post({ instagram_media_id: 'm' }), ig, NOW)).toBe('publicado');
    expect(resolveDestinationState(post({ publish_error: 'x' }), ig, NOW)).toBe('falha');
    // TikTok falhou num post "both": status compartilhado não contamina o Instagram
    expect(resolveDestinationState(post({ status: 'falha_publicacao' }), ig, NOW)).toBe(
      'pendente',
    );
  });

  it('TikTok reads tiktok_publish_status', () => {
    expect(resolveDestinationState(post({ tiktok_publish_status: 'published' }), tt, NOW)).toBe(
      'publicado',
    );
    expect(resolveDestinationState(post({ tiktok_publish_status: 'failed' }), tt, NOW)).toBe(
      'falha',
    );
    expect(resolveDestinationState(post({ tiktok_publish_status: 'processing' }), tt, NOW)).toBe(
      'processando',
    );
  });

  it('agendado is processando once due, for auto-publishing destinations only', () => {
    const future = post({ status: 'agendado', scheduled_at: '2026-10-09T12:00:00Z' });
    const due = post({ status: 'agendado', scheduled_at: '2026-10-08T11:00:00Z' });
    expect(resolveDestinationState(future, ig, NOW)).toBe('agendado');
    expect(resolveDestinationState(due, tt, NOW)).toBe('processando');
    expect(resolveDestinationState(future, geral, NOW)).toBe('disponivel');
  });

  it('postado without a media id (manual path, import) is publicado', () => {
    expect(resolveDestinationState(post({ status: 'postado' }), ig, NOW)).toBe('publicado');
  });

  it('Geral is disponivel once the client approved (P2 shim), pending before', () => {
    expect(resolveDestinationState(post({ status: 'aprovado_cliente' }), geral, NOW)).toBe(
      'disponivel',
    );
    expect(resolveDestinationState(post({ status: 'rascunho' }), geral, NOW)).toBe('pendente');
  });

  it('pendente reads as aguardando_aprovacao while the client has the post', () => {
    expect(resolveDestinationState(post({ status: 'enviado_cliente' }), geral, NOW)).toBe(
      'aguardando_aprovacao',
    );
    expect(resolveDestinationState(post({ status: 'enviado_cliente' }), ig, NOW)).toBe(
      'aguardando_aprovacao',
    );
  });

  it('a target status other than pendente wins (P4/P5 write it)', () => {
    expect(resolveDestinationState(post(), { platform: 'tiktok', status: 'falha' }, NOW)).toBe(
      'falha',
    );
    expect(resolveDestinationState(post(), { platform: 'geral', status: 'disponivel' }, NOW)).toBe(
      'disponivel',
    );
  });

  it('labels are Portuguese and have no em dash', () => {
    expect(DESTINATION_STATE_LABELS.falha).toBe('Falhou');
    expect(DESTINATION_STATE_LABELS.aguardando_aprovacao).toBe('Aguardando aprovação');
    for (const label of Object.values(DESTINATION_STATE_LABELS)) expect(label).not.toMatch(/—/);
  });
});

describe('nativeFormatHint', () => {
  it('maps the neutral format to the native one', () => {
    expect(nativeFormatHint('instagram', 'reels')).toBe('Vídeo vertical → Reels');
    expect(nativeFormatHint('tiktok', 'feed')).toBe('Imagem → Foto');
    expect(nativeFormatHint('tiktok', 'stories')).toBeNull();
  });

  it('does not repeat a label that is already neutral (Geral)', () => {
    expect(nativeFormatHint('geral', 'reels')).toBe('Vídeo vertical');
  });
});

describe('truncateCaption', () => {
  it('cuts at max and never leaves half a surrogate pair', () => {
    expect(truncateCaption('abcdef', 3)).toBe('abc');
    expect(truncateCaption('abcdef', null)).toBe('abcdef');
    const emoji = 'ab\u{1F600}'; // length 4 in UTF-16
    expect(truncateCaption(emoji, 3)).toBe('ab');
  });
});

describe('seedCaptionFor', () => {
  it('copies the first non-empty caption in registry order', () => {
    expect(
      seedCaptionFor('geral', ['instagram', 'tiktok'], { instagram: '', tiktok: 'do tiktok' }, 'feed'),
    ).toBe('do tiktok');
    expect(
      seedCaptionFor('tiktok', ['geral', 'instagram'], { instagram: 'ig', geral: 'g' }, 'feed'),
    ).toBe('ig');
  });

  it('ignores the destination being added and platforms the post does not have', () => {
    expect(seedCaptionFor('instagram', ['geral'], { instagram: 'velha', tiktok: 't' }, 'feed')).toBe(
      null,
    );
  });

  it('cuts to the new destination limit (TikTok photo 4000 into Instagram 2200)', () => {
    const long = 'x'.repeat(3000);
    expect(seedCaptionFor('instagram', ['tiktok'], { tiktok: long }, 'feed')).toHaveLength(2200);
  });
});

describe('destinationToggleOptions', () => {
  type Args = Parameters<typeof destinationToggleOptions>[0];
  const base: Args = {
    boardPlatforms: ['instagram', 'geral'],
    current: ['instagram'],
    tipo: 'feed',
    tiktokFeatureEnabled: true,
    hasActiveTikTokAccount: true,
    isExpress: false,
  };
  const opts = (over: Partial<Args> = {}) => destinationToggleOptions({ ...base, ...over });

  it('offers only the board platforms, in registry order', () => {
    expect(opts().map((o) => [o.platform, o.on])).toEqual([
      ['instagram', true],
      ['geral', false],
    ]);
  });

  it('keeps a destination the post already has even if the board dropped it', () => {
    expect(opts({ current: ['instagram', 'tiktok'] }).map((o) => o.platform)).toEqual([
      'instagram',
      'tiktok',
      'geral',
    ]);
  });

  it('TikTok: needs the plan flag to be offered, never on stories, needs an active account', () => {
    const board: Args['boardPlatforms'] = ['instagram', 'tiktok'];
    expect(opts({ boardPlatforms: board, tiktokFeatureEnabled: false }).map((o) => o.platform)).toEqual(
      ['instagram'],
    );
    expect(
      opts({ boardPlatforms: board, tipo: 'stories' }).find((o) => o.platform === 'tiktok')
        ?.disabledReason,
    ).toBe('Stories não são suportados no TikTok');
    expect(
      opts({ boardPlatforms: board, hasActiveTikTokAccount: false }).find(
        (o) => o.platform === 'tiktok',
      )?.disabledReason,
    ).toBe('Cliente sem conta TikTok ativa');
  });

  it('Post Express has no Destinos row', () => {
    expect(opts({ isExpress: true })).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npx vitest run apps/crm/src/pages/entregas/__tests__/postDestinations.test.ts`
Expected: FAIL (`Cannot find module '../postDestinations'`).

- [ ] **Step 3: Implement**

Create `apps/crm/src/components/platformIcons.ts`:

```ts
import { FileDown, Instagram, Music2 } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { PlatformId } from '@mesaas/platforms';

/** Ícone de cada plataforma (chips de quadro, Destinos, abas de legenda, card). */
export const PLATFORM_ICONS: Record<PlatformId, LucideIcon> = {
  instagram: Instagram,
  tiktok: Music2,
  geral: FileDown,
};
```

In `apps/crm/src/components/PlatformChips.tsx`: replace the `lucide-react` import with `import { Check, Youtube } from 'lucide-react';`, drop the `LucideIcon` type import and the local `ICONS` constant, add `import { PLATFORM_ICONS } from './platformIcons';`, and change `const Icon = ICONS[p];` to `const Icon = PLATFORM_ICONS[p];`.

Create `apps/crm/src/pages/entregas/postDestinations.ts`:

```ts
import {
  CONTENT_FORMAT_LABELS,
  PLATFORM_DEFS,
  PLATFORM_IDS,
  captionMaxFor,
  supportsFormat,
  type ContentFormat,
  type PlatformId,
} from '@mesaas/platforms';
// type-only: PostsKanbanView.test mocks '@/store' com uma lista fixa de exports.
import type { PostTargetSummary } from '@/store/postTargets';
import type { WorkflowPost } from '@/store/posts';

// Regras dos destinos de um post (P2). Spec 2026-09-29-platform-agnostic-posts.
// O estado de cada destino é derivado aqui, e não numa view SQL (desvio 1 do plano P2):
// os publicadores ainda escrevem as colunas legadas até P4 (TikTok) e P5 (Instagram).

export type DestinationState =
  | 'pendente'
  | 'aguardando_aprovacao'
  | 'agendado'
  | 'processando'
  | 'publicado'
  | 'falha'
  | 'disponivel';

export const DESTINATION_STATE_LABELS: Record<DestinationState, string> = {
  pendente: 'Pendente',
  aguardando_aprovacao: 'Aguardando aprovação',
  agendado: 'Agendado',
  processando: 'Publicando',
  publicado: 'Publicado',
  falha: 'Falhou',
  disponivel: 'Disponível',
};

export type DestinationPostFields = Pick<
  WorkflowPost,
  'status' | 'scheduled_at' | 'instagram_media_id' | 'publish_error' | 'tiktok_publish_status'
>;

// Geral fica "Disponível" depois da aprovação do cliente. Shim de P2: P3 grava
// post_targets.status = 'disponivel' na aprovação e a linha passa a mandar.
const GERAL_AVAILABLE = new Set<WorkflowPost['status']>(['aprovado_cliente', 'agendado', 'postado']);

export function resolveDestinationState(
  post: DestinationPostFields,
  target: PostTargetSummary,
  now: Date = new Date(),
): DestinationState {
  // P4/P5 movem o estado de publicação para post_targets: fora de 'pendente', a linha manda.
  if (target.status !== 'pendente') return target.status;

  if (target.platform === 'instagram') {
    if (post.instagram_media_id) return 'publicado';
    // Nunca status = 'falha_publicacao': uma falha do TikTok num post "both" também o grava.
    if (post.publish_error) return 'falha';
  } else if (target.platform === 'tiktok') {
    const s = post.tiktok_publish_status;
    if (s === 'published') return 'publicado';
    if (s === 'failed') return 'falha';
    if (s === 'initiated' || s === 'processing') return 'processando';
  } else if (GERAL_AVAILABLE.has(post.status)) {
    return 'disponivel';
  }

  if (PLATFORM_DEFS[target.platform].autoPublish) {
    if (post.status === 'postado') return 'publicado';
    if (post.status === 'agendado') {
      const due = !!post.scheduled_at && new Date(post.scheduled_at) <= now;
      return due ? 'processando' : 'agendado';
    }
  }
  return post.status === 'enviado_cliente' ? 'aguardando_aprovacao' : 'pendente';
}

/** "Vídeo vertical → Reels"; só o rótulo neutro quando o nativo é igual (Geral);
 *  null quando a plataforma não aceita o formato. */
export function nativeFormatHint(platform: PlatformId, tipo: ContentFormat): string | null {
  const native = PLATFORM_DEFS[platform].nativeFormats[tipo];
  if (!native) return null;
  const neutral = CONTENT_FORMAT_LABELS[tipo];
  return native.label === neutral ? neutral : `${neutral} → ${native.label}`;
}

/** Corta em `max` unidades UTF-16 sem deixar meio par substituto (emoji) no fim. */
export function truncateCaption(text: string, max: number | null): string {
  if (max == null || text.length <= max) return text;
  let out = text.slice(0, max);
  const last = out.charCodeAt(out.length - 1);
  if (last >= 0xd800 && last <= 0xdbff) out = out.slice(0, -1);
  return out;
}

/**
 * Legenda com que um destino recém-ligado começa (spec: "A newly added destination
 * starts from the first destination's caption"). Primeiro destino que o post JÁ tem,
 * na ordem do registro, com legenda não vazia; cortada no limite do destino novo.
 * Quem chama só usa o resultado se a legenda própria do destino estiver vazia.
 */
export function seedCaptionFor(
  platform: PlatformId,
  current: PlatformId[],
  captions: Partial<Record<PlatformId, string | null>>,
  tipo: ContentFormat,
): string | null {
  for (const p of PLATFORM_IDS) {
    if (p === platform || !current.includes(p)) continue;
    const text = captions[p];
    if (text && text.trim()) return truncateCaption(text, captionMaxFor(platform, tipo));
  }
  return null;
}

export interface DestinationToggleOption {
  platform: PlatformId;
  on: boolean;
  /** Por que não dá para LIGAR este destino; null = pode. Desligar é sempre possível
   *  (o componente só recusa o último destino). */
  disabledReason: string | null;
}

export function destinationToggleOptions(args: {
  boardPlatforms: PlatformId[];
  current: PlatformId[];
  tipo: ContentFormat;
  tiktokFeatureEnabled: boolean;
  hasActiveTikTokAccount: boolean;
  isExpress: boolean;
}): DestinationToggleOption[] {
  const { boardPlatforms, current, tipo, tiktokFeatureEnabled, hasActiveTikTokAccount } = args;
  // Post Express é só Instagram (P1 desvio 8): sem linha de Destinos.
  if (args.isExpress) return [];
  return PLATFORM_IDS.filter((p) => {
    if (current.includes(p)) return true;
    if (!boardPlatforms.includes(p)) return false;
    return PLATFORM_DEFS[p].planFeature !== 'feature_tiktok' || tiktokFeatureEnabled;
  }).map((p) => {
    const on = current.includes(p);
    let disabledReason: string | null = null;
    if (!on) {
      if (p === 'tiktok' && tipo === 'stories') {
        disabledReason = 'Stories não são suportados no TikTok';
      } else if (!supportsFormat(p, tipo)) {
        disabledReason = `${PLATFORM_DEFS[p].label} não aceita ${CONTENT_FORMAT_LABELS[tipo]}`;
      } else if (p === 'tiktok' && !hasActiveTikTokAccount) {
        disabledReason = 'Cliente sem conta TikTok ativa';
      }
    }
    return { platform: p, on, disabledReason };
  });
}
```

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `npx vitest run apps/crm/src/pages/entregas/__tests__/postDestinations.test.ts apps/crm/src/components/__tests__/PlatformChips.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/crm/src/pages/entregas/postDestinations.ts apps/crm/src/components/platformIcons.ts \
  apps/crm/src/components/PlatformChips.tsx apps/crm/src/pages/entregas/__tests__/postDestinations.test.ts
git commit -m "feat(platforms): regras puras dos destinos (estado, semente da legenda, Destinos) (P2)"
```

---

### Task 3: Entitlements section 15, the CRM's exact writes as `authenticated`

No SQL changes in P2, but the editor now depends on four direct writes. Pin them.

**Files:**
- Modify: `supabase/tests/entitlements/99_post_targets.sql` (append section 15; update the header comment to say "Seções 1-13 e 15")

**Interfaces:**
- Consumes: P1 helpers `et_make_workspace`, `et_grant_hosted_parity`; RPC `save_ig_caption(bigint, text, jsonb)`.
- Produces: nothing new.

- [ ] **Step 1: Append the section**

```sql
-- 15. Editor de destinos (P2): as escritas diretas do CRM como authenticated.
-- Sem migration em P2; isto prende o contrato de que o CRM depende.
begin;
update plans set feature_multiplatform = true;
select et_grant_hosted_parity(array['post_targets']);
do $$
declare
  v_ws uuid; v_uid uuid := gen_random_uuid(); v_cli bigint; v_wf bigint; v_p bigint;
  v_plat text; v_cap text; v_arr text[];
begin
  v_ws := et_make_workspace('start');
  insert into auth.users (id) values (v_uid);
  insert into workspace_members (user_id, workspace_id, role) values (v_uid, v_ws, 'owner');
  update profiles set conta_id = v_ws, active_workspace_id = v_ws where id = v_uid;
  insert into clientes (user_id, conta_id, nome, sigla, cor, plataformas_padrao)
    values (v_uid, v_ws, 'C', 'C', '#000', array['geral']) returning id into v_cli;
  insert into workflows (user_id, conta_id, cliente_id, titulo, status, plataformas)
    values (v_uid, v_ws, v_cli, 'W', 'ativo', array['instagram','geral']) returning id into v_wf;
  insert into workflow_posts (workflow_id, conta_id, titulo, tipo)
    values (v_wf, v_ws, 'p', 'feed') returning id into v_p;

  perform set_config('request.jwt.claims',
    json_build_object('sub', v_uid, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';

  -- getBoardPlatforms: authenticated lê as duas listas
  select plataformas into v_arr from workflows where id = v_wf;
  assert v_arr = array['instagram','geral'], format('workflows.plataformas: %s', v_arr);
  select plataformas_padrao into v_arr from clientes where id = v_cli;
  assert v_arr = array['geral'], format('clientes.plataformas_padrao: %s', v_arr);

  -- removePostDestination('instagram'): platform vira 'other'
  delete from post_targets where post_id = v_p and platform = 'instagram';
  select platform into v_plat from workflow_posts where id = v_p;
  assert v_plat = 'other', format('depois de tirar Instagram: %s', v_plat);

  -- addPostDestination('instagram', semente): INSERT + save_ig_caption
  insert into post_targets (conta_id, post_id, platform) values (v_ws, v_p, 'instagram');
  perform save_ig_caption(v_p, 'semente', '[]'::jsonb);
  select platform, ig_caption into v_plat, v_cap from workflow_posts where id = v_p;
  assert v_plat = 'instagram' and v_cap = 'semente', format('IG religado: %s / %s', v_plat, v_cap);

  -- savePostCaption('geral'): só a legenda muda, platform não
  update post_targets set caption = 'texto geral', updated_at = now()
   where post_id = v_p and platform = 'geral';
  select caption into v_cap from post_targets where post_id = v_p and platform = 'geral';
  assert v_cap = 'texto geral', format('legenda Geral: %s', v_cap);
  select platform into v_plat from workflow_posts where id = v_p;
  assert v_plat = 'instagram', format('legenda Geral mexeu em platform: %s', v_plat);

  -- savePostCaption('tiktok'): coluna legada, editável pelo membro
  update workflow_posts set tiktok_caption = 'tt' where id = v_p;
  select tiktok_caption into v_cap from workflow_posts where id = v_p;
  assert v_cap = 'tt', format('tiktok_caption: %s', v_cap);
end $$;
rollback;
```

- [ ] **Step 2: Run the suite**

Run: `psql postgresql://postgres:postgres@127.0.0.1:54322/postgres -f supabase/tests/entitlements/99_post_targets.sql` (local stack on colima, P1 migrations applied), then `bash scripts/test-entitlements.sh`.
Expected: no assertion failure; the script prints PASS for `99_post_targets.sql`. Since nothing in the schema changes, this should pass on the first run; if it fails, the CRM's write path in Task 1 is wrong, stop and investigate.

- [ ] **Step 3: Commit**

```bash
git add supabase/tests/entitlements/99_post_targets.sql
git commit -m "test(platforms): suíte prende as escritas diretas do editor de destinos (P2)"
```

---

### Task 4: `useCaptionDraft` takes a per-platform limit

**Files:**
- Modify: `apps/crm/src/pages/entregas/components/useCaptionDraft.ts:21-25` (`Args`), `:41` (signature), `:65-69` (`latest`), `:110-112` (`change`)
- Test: `apps/crm/src/pages/entregas/components/__tests__/useCaptionDraft.test.tsx` (append cases)

**Interfaces:**
- Produces: `useCaptionDraft({ value, threads, onSave, max? })` where `max?: number | null` (default `MAX_CAPTION_CHARS` = 2200; `null` = no limit). Above the limit only a shrinking edit is accepted.

- [ ] **Step 1: Write the failing tests** (append inside `describe('useCaptionDraft')`)

```ts
  it('max: null accepts any length (Geral)', () => {
    const { result } = renderHook(() =>
      useCaptionDraft({ value: '', threads: [], onSave: vi.fn(), max: null }),
    );
    act(() => result.current.change('x'.repeat(5000)));
    expect(result.current.text).toHaveLength(5000);
  });

  it('a custom max rejects growth past it', () => {
    const { result } = renderHook(() =>
      useCaptionDraft({ value: '', threads: [], onSave: vi.fn(), max: 10 }),
    );
    act(() => result.current.change('x'.repeat(10)));
    act(() => result.current.change('x'.repeat(11)));
    expect(result.current.text).toHaveLength(10);
  });

  it('above the limit (format changed) the user can still delete text', () => {
    const { result } = renderHook(() =>
      useCaptionDraft({ value: 'x'.repeat(15), threads: [], onSave: vi.fn(), max: 10 }),
    );
    act(() => result.current.change('x'.repeat(14)));
    expect(result.current.text).toHaveLength(14);
    act(() => result.current.change('x'.repeat(16)));
    expect(result.current.text).toHaveLength(14);
  });
```

- [ ] **Step 2: Run and confirm failure**

Run: `npx vitest run apps/crm/src/pages/entregas/components/__tests__/useCaptionDraft.test.tsx`
Expected: FAIL on the three new cases (5000 rejected; 14 rejected).

- [ ] **Step 3: Implement**

In `Args` add:

```ts
  /** Limite em unidades UTF-16 (String.length). Default = Instagram (2200); null = sem limite. */
  max?: number | null;
```

Signature: `export function useCaptionDraft({ value, threads, onSave, max = MAX_CAPTION_CHARS }: Args) {`

`latest` ref: `const latest = useRef({ value, serverAnchors, onSave, max });` and the effect `latest.current = { value, serverAnchors, onSave, max };`.

In `change`, replace `if (next.length > MAX_CAPTION_CHARS) return;` with:

```ts
      const limit = latest.current.max;
      if (limit != null && next.length > limit) {
        // Acima do limite (ex.: o formato mudou e o limite caiu) só aceita encurtar,
        // senão o usuário ficaria preso sem conseguir apagar.
        const current = draftRef.current?.text ?? latest.current.value;
        if (next.length >= current.length) return;
      }
```

- [ ] **Step 4: Run and confirm pass (old cases included)**

Run: `npx vitest run apps/crm/src/pages/entregas/components/__tests__/useCaptionDraft.test.tsx apps/crm/src/pages/entregas/components/__tests__/InstagramCaptionField.test.tsx`
Expected: PASS, including the existing "rejects text over 2200 chars" and "accepts exactly 2200 chars and rejects 2201".

- [ ] **Step 5: Commit**

```bash
git add apps/crm/src/pages/entregas/components/useCaptionDraft.ts \
  apps/crm/src/pages/entregas/components/__tests__/useCaptionDraft.test.tsx
git commit -m "feat(platforms): useCaptionDraft aceita limite por plataforma (P2)"
```

---

### Task 5: `DestinationCaptionField` + `getText()` on the Instagram handle

**Files:**
- Create: `apps/crm/src/pages/entregas/components/DestinationCaptionField.tsx`
- Modify: `apps/crm/src/pages/entregas/components/InstagramCaptionField.tsx:34-36` (handle type), `:185-202` (`useImperativeHandle`)
- Test: `apps/crm/src/pages/entregas/components/__tests__/DestinationCaptionField.test.tsx` (create); `InstagramCaptionField.test.tsx` (one case)

**Interfaces:**
- Consumes: `useCaptionDraft` with `max` (Task 4).
- Produces:
  - `interface DestinationCaptionFieldHandle { getText(): string }`
  - `DestinationCaptionField` props: `{ id: string; label: string; value: string; max: number | null; placeholder: string; hint?: string; disabled?: boolean; lockedMessage?: string; showCopy?: boolean; onSave: (text: string) => Promise<void> }`
  - `InstagramCaptionFieldHandle` gains `getText(): string`

- [ ] **Step 1: Write the failing tests**

Create `apps/crm/src/pages/entregas/components/__tests__/DestinationCaptionField.test.tsx`:

```tsx
import { createRef } from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@mesaas/app-lifecycle', () => ({ useUnsavedWork: vi.fn() }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { toast } from 'sonner';
import { useUnsavedWork } from '@mesaas/app-lifecycle';
import {
  DestinationCaptionField,
  type DestinationCaptionFieldHandle,
} from '../DestinationCaptionField';

const base = {
  id: 'cap-1',
  label: 'Legenda do TikTok',
  value: 'oi',
  max: 2200 as number | null,
  placeholder: 'Texto',
};

describe('DestinationCaptionField', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('shows the per-platform counter, or a plain count without a limit', () => {
    const { rerender } = render(<DestinationCaptionField {...base} onSave={vi.fn()} />);
    expect(screen.getByText('2 / 2200')).toBeInTheDocument();
    rerender(<DestinationCaptionField {...base} max={null} onSave={vi.fn()} />);
    expect(screen.getByText('2 caracteres')).toBeInTheDocument();
  });

  it('autosaves after the debounce and registers unsaved work while dirty', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(<DestinationCaptionField {...base} onSave={onSave} />);
    fireEvent.change(screen.getByLabelText('Legenda do TikTok'), { target: { value: 'oi!' } });
    expect(vi.mocked(useUnsavedWork)).toHaveBeenLastCalledWith(true);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1500);
    });
    expect(onSave).toHaveBeenCalledWith('oi!');
  });

  it('is read-only when disabled', () => {
    render(<DestinationCaptionField {...base} disabled onSave={vi.fn()} />);
    expect(screen.getByLabelText('Legenda do TikTok')).toHaveAttribute('readonly');
  });

  it('exposes getText() with the unsaved draft', () => {
    const ref = createRef<DestinationCaptionFieldHandle>();
    render(<DestinationCaptionField ref={ref} {...base} onSave={vi.fn()} />);
    fireEvent.change(screen.getByLabelText('Legenda do TikTok'), { target: { value: 'novo' } });
    expect(ref.current!.getText()).toBe('novo');
  });

  it('copies the caption', async () => {
    vi.useRealTimers();
    const writeText = vi.fn().mockResolvedValue(undefined);
    // jsdom expõe navigator.clipboard só com getter: Object.assign quebraria.
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    render(<DestinationCaptionField {...base} showCopy onSave={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /Copiar legenda/ }));
    await vi.waitFor(() => expect(writeText).toHaveBeenCalledWith('oi'));
    await vi.waitFor(() => expect(toast.success).toHaveBeenCalledWith('Legenda copiada.'));
  });
});
```

Append to `InstagramCaptionField.test.tsx` (inside its top-level describe, next to the `focusThread` case; reuse that file's `caption` constant):

```tsx
  it('getText returns the current draft', () => {
    const ref = createRef<InstagramCaptionFieldHandle>();
    render(<InstagramCaptionField ref={ref} value={caption} threads={[]} onSave={vi.fn()} />);
    fireEvent.change(textarea(), { target: { value: 'outra legenda' } });
    expect(ref.current!.getText()).toBe('outra legenda');
  });
```

(If `fireEvent` is not already imported there, add it to the existing `@testing-library/react` import.)

- [ ] **Step 2: Run and confirm failure**

Run: `npx vitest run apps/crm/src/pages/entregas/components/__tests__/DestinationCaptionField.test.tsx apps/crm/src/pages/entregas/components/__tests__/InstagramCaptionField.test.tsx`
Expected: FAIL (module missing; `getText is not a function`).

- [ ] **Step 3: Implement**

Create `apps/crm/src/pages/entregas/components/DestinationCaptionField.tsx`:

```tsx
import { forwardRef, useImperativeHandle } from 'react';
import { Copy, Lock } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import type { CommentThread } from '@/store';
import { useCaptionDraft } from './useCaptionDraft';

export interface DestinationCaptionFieldHandle {
  /** Texto atual, rascunho não salvo incluso (semente da legenda de outro destino). */
  getText(): string;
}

interface DestinationCaptionFieldProps {
  id: string;
  label: string;
  value: string;
  /** Limite do registro (captionMaxFor); null = sem limite (Geral). */
  max: number | null;
  placeholder: string;
  hint?: string;
  disabled?: boolean;
  lockedMessage?: string;
  /** Botão "Copiar legenda" (Geral). */
  showCopy?: boolean;
  /** Rejeita = falhou (quem chama mostra o toast); o rascunho fica e o próximo
   *  caractere tenta de novo (contrato de useCaptionDraft). */
  onSave: (text: string) => Promise<void>;
}

// Identidade estável: useCaptionDraft memoiza as âncoras pelas threads.
const NO_THREADS: CommentThread[] = [];

/**
 * Legenda de um destino que não é o Instagram (TikTok, Geral): sem comentários nem
 * âncoras, com o mesmo autosave serializado e o mesmo registro de trabalho não
 * salvo da legenda do Instagram (useCaptionDraft). Uma instância por post
 * (key={post.id} em quem monta), como InstagramCaptionField.
 */
export const DestinationCaptionField = forwardRef<
  DestinationCaptionFieldHandle,
  DestinationCaptionFieldProps
>(function DestinationCaptionField(
  { id, label, value, max, placeholder, hint, disabled, lockedMessage, showCopy, onSave },
  ref,
) {
  const { text, change, getText } = useCaptionDraft({
    value,
    threads: NO_THREADS,
    onSave: (t) => onSave(t),
    max,
  });
  useImperativeHandle(ref, () => ({ getText }), [getText]);

  const over = max != null && text.length > max;
  const copy = () => {
    navigator.clipboard.writeText(getText()).then(
      () => toast.success('Legenda copiada.'),
      () => toast.error('Não foi possível copiar a legenda.'),
    );
  };

  return (
    <div className="flex flex-col gap-1">
      <div className="flex flex-wrap items-center gap-2">
        <label
          htmlFor={id}
          className="whitespace-nowrap text-sm font-semibold"
          style={{ color: 'var(--text-main)' }}
        >
          {label}
        </label>
        {disabled && lockedMessage && (
          <Lock
            className="h-3.5 w-3.5"
            style={{ color: 'var(--text-light)' }}
            aria-label={lockedMessage}
          />
        )}
        {showCopy && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="ml-auto mb-0 h-7 gap-1 px-2 text-xs"
            onClick={copy}
            disabled={!text}
          >
            <Copy className="h-3.5 w-3.5" />
            Copiar legenda
          </Button>
        )}
        <span
          className={showCopy ? 'whitespace-nowrap text-xs' : 'ml-auto whitespace-nowrap text-xs'}
          style={{
            color: over ? 'var(--danger-text)' : 'var(--text-light)',
            fontFamily: 'var(--font-mono)',
          }}
        >
          {max == null ? `${text.length} caracteres` : `${text.length} / ${max}`}
        </span>
      </div>
      <Textarea
        id={id}
        value={text}
        onChange={(e) => {
          if (!disabled) change(e.target.value);
        }}
        readOnly={disabled}
        placeholder={placeholder}
        className="min-h-[80px] resize-y read-only:cursor-default read-only:opacity-70"
        style={{ fontFamily: 'var(--font-mono)', fontSize: '0.85rem' }}
      />
      {hint && (
        <p className="text-xs" style={{ color: 'var(--text-light)' }}>
          {hint}
        </p>
      )}
    </div>
  );
});
```

In `InstagramCaptionField.tsx`:

```ts
export interface InstagramCaptionFieldHandle {
  focusThread(threadId: number): void;
  /** Texto atual, rascunho não salvo incluso (semente da legenda de outro destino). */
  getText(): string;
}
```

and inside the `useImperativeHandle` object, after `focusThread`, add `getText,` (the hook's `getText` is stable, so the existing `[anchors, comments]` deps stay as they are).

- [ ] **Step 4: Run and confirm pass**

Run: same command as Step 2.
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/crm/src/pages/entregas/components/DestinationCaptionField.tsx \
  apps/crm/src/pages/entregas/components/InstagramCaptionField.tsx \
  apps/crm/src/pages/entregas/components/__tests__/DestinationCaptionField.test.tsx \
  apps/crm/src/pages/entregas/components/__tests__/InstagramCaptionField.test.tsx
git commit -m "feat(platforms): campo de legenda por destino (TikTok, Geral) (P2)"
```

---

### Task 6: `TikTokSettingsPanel` can hide its caption field

**Files:**
- Modify: `apps/crm/src/pages/entregas/components/TikTokSettingsPanel.tsx:137-160` (props), `:452-472` (caption block)
- Test: `apps/crm/src/pages/entregas/components/__tests__/TikTokSettingsPanel.test.tsx` (append)

**Interfaces:**
- Produces: `TikTokSettingsPanelProps.hideCaption?: boolean` (default `false`). The title field (photo posts) stays.

- [ ] **Step 1: Write the failing tests** (append; reuse the file's `renderPanel`)

```tsx
describe('hideCaption (P2: a aba do TikTok é dona da legenda)', () => {
  it('shows the caption field by default (flag off path)', async () => {
    renderPanel();
    expect(await screen.findByText(/Legenda do TikTok/)).toBeInTheDocument();
  });

  it('hides only the caption field when hideCaption is set', async () => {
    renderPanel({ tipo: 'feed' }, { hideCaption: true });
    await screen.findByLabelText('Permitir comentários');
    expect(screen.queryByText(/Legenda do TikTok/)).toBeNull();
    expect(screen.getByText('Título do TikTok (opcional)')).toBeInTheDocument();
  });
});
```

(If `basePost.tipo` is not `feed`, the override above makes the title field render.)

- [ ] **Step 2: Run and confirm failure**

Run: `npx vitest run apps/crm/src/pages/entregas/components/__tests__/TikTokSettingsPanel.test.tsx`
Expected: FAIL on the second case (caption label still present).

- [ ] **Step 3: Implement**

Props interface:

```ts
  /** Com feature_multiplatform a legenda do TikTok mora na aba do TikTok
   *  (DestinationCaptionTabs); o painel fica só com as configurações. */
  hideCaption?: boolean;
```

Destructure `hideCaption = false`, and wrap the `{/* Caption override */}` block (the `<div className="flex flex-col gap-1">` that holds the `tt-caption-` label and textarea) in `{!hideCaption && ( … )}`. Do not touch the caption state/timers above: they stay inert when the field is hidden.

- [ ] **Step 4: Run and confirm pass**

Run: same as Step 2. Expected: PASS (all old cases too).

- [ ] **Step 5: Commit**

```bash
git add apps/crm/src/pages/entregas/components/TikTokSettingsPanel.tsx \
  apps/crm/src/pages/entregas/components/__tests__/TikTokSettingsPanel.test.tsx
git commit -m "feat(platforms): painel do TikTok sem a legenda quando a aba é dona dela (P2)"
```

---

### Task 7: `ScheduleButton` explains a missing Instagram account (flag ON only)

**Files:**
- Modify: `apps/crm/src/pages/entregas/components/ScheduleButton.tsx:148-172` (props), `:210` (the `!hasInstagramAccount` early return)
- Test: `apps/crm/src/pages/entregas/components/__tests__/ScheduleButton.test.tsx` (append)

**Interfaces:**
- Produces: `ScheduleButtonProps.explainMissingInstagramAccount?: boolean` (default `false`).

- [ ] **Step 1: Write the failing tests** (append; reuse the file's `makePost`)

```tsx
describe('explainMissingInstagramAccount (P2)', () => {
  it('flag off: an approved Instagram post without account renders nothing (unchanged)', () => {
    const { container } = render(
      <ScheduleButton
        post={makePost({ status: 'aprovado_cliente' })}
        hasInstagramAccount={false}
        onStatusChange={vi.fn()}
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('flag on: explains why there is no Agendar', () => {
    render(
      <ScheduleButton
        post={makePost({ status: 'aprovado_cliente' })}
        hasInstagramAccount={false}
        explainMissingInstagramAccount
        onStatusChange={vi.fn()}
      />,
    );
    expect(
      screen.getByText('Conecte a conta do Instagram do cliente para agendar ou publicar este post.'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Agendar/ })).toBeNull();
  });

  it('flag on: nothing for a post that is not approved yet', () => {
    const { container } = render(
      <ScheduleButton
        post={makePost({ status: 'rascunho' })}
        hasInstagramAccount={false}
        explainMissingInstagramAccount
        onStatusChange={vi.fn()}
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});
```

- [ ] **Step 2: Run and confirm failure**

Run: `npx vitest run apps/crm/src/pages/entregas/components/__tests__/ScheduleButton.test.tsx`
Expected: FAIL on "flag on: explains why".

- [ ] **Step 3: Implement**

Props (with the other props, documented):

```ts
  /** feature_multiplatform: a legenda aparece sem conta do Instagram, então o botão
   *  explica por que não há "Agendar" em vez de sumir calado. */
  explainMissingInstagramAccount?: boolean;
```

Destructure it with default `false`, and replace line 210:

```ts
  if (targetsInstagram && !hasInstagramAccount) {
    if (explainMissingInstagramAccount && post.status === 'aprovado_cliente') {
      return (
        <p className="mt-3 text-xs" style={{ color: 'var(--text-light)' }}>
          Conecte a conta do Instagram do cliente para agendar ou publicar este post.
        </p>
      );
    }
    return null;
  }
```

- [ ] **Step 4: Run and confirm pass**

Run: same as Step 2. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/crm/src/pages/entregas/components/ScheduleButton.tsx \
  apps/crm/src/pages/entregas/components/__tests__/ScheduleButton.test.tsx
git commit -m "feat(platforms): agendar explica a falta de conta do Instagram com a flag (P2)"
```

---

### Task 8: Status pill + board chips on the Publicações card

**Files:**
- Create: `apps/crm/src/pages/entregas/components/DestinationStatusPill.tsx`
- Modify: `apps/crm/src/pages/entregas/views/PostsKanbanView.tsx` (every `tiktokEnabled` site: lines ~176, 194, 207, 383, 394, 429, 459, 490, 611, 650, 1029, 1037-1048; and the card body after `<div className="item-title">` at ~306)
- Modify: `apps/crm/src/pages/entregas/EntregasPage.tsx:170` (flag const) and `:1575` (prop)
- Test: `apps/crm/src/pages/entregas/components/__tests__/DestinationStatusPill.test.tsx` (create), `apps/crm/src/pages/entregas/views/__tests__/PostsKanbanView.test.tsx` (append)

**Interfaces:**
- Consumes: `resolveDestinationState`, `DESTINATION_STATE_LABELS`, `DestinationState`, `DestinationPostFields` (Task 2); `PLATFORM_ICONS` (Task 2); `PostTargetSummary` (Task 1, type-only); `ActivePost.targets` (Task 1).
- Produces:
  - `DestinationStatusPill({ platform, state, hideLabelWhenPending? }: { platform: PlatformId; state: DestinationState; hideLabelWhenPending?: boolean })`
  - `DestinationChips({ post }: { post: DestinationPostFields & { targets?: PostTargetSummary[] } })` (renders `null` without targets)
  - `PostsKanbanViewProps.multiplatformEnabled?: boolean`

- [ ] **Step 1: Write the failing tests**

Create `apps/crm/src/pages/entregas/components/__tests__/DestinationStatusPill.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { DestinationChips, DestinationStatusPill } from '../DestinationStatusPill';

const post = {
  status: 'aprovado_cliente' as const,
  scheduled_at: null,
  instagram_media_id: 'm1',
  publish_error: null,
  tiktok_publish_status: null,
};

describe('DestinationStatusPill', () => {
  it('names platform and state for assistive tech', () => {
    render(<DestinationStatusPill platform="instagram" state="publicado" />);
    expect(screen.getByLabelText('Instagram: Publicado')).toHaveTextContent('Publicado');
  });

  it('can hide the label of a pending destination (icon only)', () => {
    render(<DestinationStatusPill platform="geral" state="pendente" hideLabelWhenPending />);
    expect(screen.getByLabelText('Geral: Pendente')).not.toHaveTextContent('Pendente');
  });
});

describe('DestinationChips', () => {
  it('one chip per destination, in registry order', () => {
    render(
      <DestinationChips
        post={{
          ...post,
          targets: [
            { platform: 'geral', status: 'pendente' },
            { platform: 'instagram', status: 'pendente' },
          ],
        }}
      />,
    );
    const chips = screen.getAllByLabelText(/: /);
    expect(chips.map((c) => c.getAttribute('aria-label'))).toEqual([
      'Instagram: Publicado',
      'Geral: Disponível',
    ]);
  });

  it('renders nothing without targets', () => {
    const { container } = render(<DestinationChips post={post} />);
    expect(container).toBeEmptyDOMElement();
  });
});
```

Append to `PostsKanbanView.test.tsx`:

```tsx
describe('destination chips (P2, feature_multiplatform)', () => {
  const withTargets = () =>
    makePost({
      status: 'aprovado_cliente',
      instagram_media_id: 'm1',
      targets: [
        { platform: 'instagram', status: 'pendente' },
        { platform: 'geral', status: 'pendente' },
      ],
    });

  it('flag off: no chips (unchanged card)', () => {
    renderWithQuery(<PostsKanbanView {...baseProps} posts={[withTargets()]} />);
    expect(screen.queryByTestId('destination-chips')).toBeNull();
  });

  it('flag on: one chip per destination', () => {
    renderWithQuery(
      <PostsKanbanView {...baseProps} posts={[withTargets()]} multiplatformEnabled />,
    );
    const chips = screen.getByTestId('destination-chips');
    expect(within(chips).getByLabelText('Instagram: Publicado')).toBeInTheDocument();
    expect(within(chips).getByLabelText('Geral: Disponível')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run and confirm failure**

Run: `npx vitest run apps/crm/src/pages/entregas/components/__tests__/DestinationStatusPill.test.tsx apps/crm/src/pages/entregas/views/__tests__/PostsKanbanView.test.tsx`
Expected: FAIL (module missing; no `destination-chips`).

- [ ] **Step 3: Implement**

Create `apps/crm/src/pages/entregas/components/DestinationStatusPill.tsx`:

```tsx
import { PLATFORM_DEFS, type PlatformId } from '@mesaas/platforms';
import { PLATFORM_ICONS } from '@/components/platformIcons';
// type-only: PostsKanbanView.test mocks '@/store'.
import type { PostTargetSummary } from '@/store/postTargets';
import {
  DESTINATION_STATE_LABELS,
  resolveDestinationState,
  type DestinationPostFields,
  type DestinationState,
} from '../postDestinations';

// Cor só no ponto; o texto fica em --text-muted para passar AA (o verde e o
// laranja do sistema não passam como cor de texto em fundo claro).
const DOT: Record<DestinationState, string> = {
  pendente: 'var(--text-light)',
  aguardando_aprovacao: 'var(--warning)',
  agendado: 'var(--teal)',
  processando: 'var(--teal)',
  publicado: 'var(--success)',
  falha: 'var(--danger)',
  disponivel: 'var(--success)',
};

export function DestinationStatusPill({
  platform,
  state,
  hideLabelWhenPending = false,
}: {
  platform: PlatformId;
  state: DestinationState;
  hideLabelWhenPending?: boolean;
}) {
  const Icon = PLATFORM_ICONS[platform];
  const label = DESTINATION_STATE_LABELS[state];
  const name = `${PLATFORM_DEFS[platform].label}: ${label}`;
  const showLabel = !(hideLabelWhenPending && state === 'pendente');
  return (
    <span
      aria-label={name}
      title={name}
      className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-medium"
      style={{ background: 'var(--surface-hover)', color: 'var(--text-muted)' }}
    >
      <Icon size={11} aria-hidden="true" style={{ flexShrink: 0 }} />
      {showLabel && <span aria-hidden="true">{label}</span>}
      <span
        aria-hidden="true"
        className="inline-block h-1.5 w-1.5 rounded-full"
        style={{ background: DOT[state] }}
      />
    </span>
  );
}

/** Um chip por destino no card do quadro de Publicações (spec UX 3). */
export function DestinationChips({
  post,
}: {
  post: DestinationPostFields & { targets?: PostTargetSummary[] };
}) {
  if (!post.targets || post.targets.length === 0) return null;
  return (
    <span
      data-testid="destination-chips"
      style={{ display: 'inline-flex', flexWrap: 'wrap', gap: '0.25rem', marginTop: '0.25rem' }}
    >
      {post.targets.map((t) => (
        <DestinationStatusPill
          key={t.platform}
          platform={t.platform}
          state={resolveDestinationState(post, t)}
          hideLabelWhenPending
        />
      ))}
    </span>
  );
}
```

(`post.targets` is already sorted by `mapPostContextRow`.)

In `PostsKanbanView.tsx`:
- Add `import { DestinationChips } from '../components/DestinationStatusPill';`.
- Next to every `tiktokEnabled?: boolean;` prop declaration add `multiplatformEnabled?: boolean;` (with a one-line doc on `PostsKanbanViewProps`: `/** feature_multiplatform: um chip por destino no card (P2). */`), next to every destructured `tiktokEnabled,` add `multiplatformEnabled,`, and next to every `tiktokEnabled={tiktokEnabled}` JSX prop add `multiplatformEnabled={multiplatformEnabled}`. Use `grep -n tiktokEnabled apps/crm/src/pages/entregas/views/PostsKanbanView.tsx` to hit all of them, including the `DragOverlay` clone (`PostBoardCardContent` around line 1037) and both `PostBoardColumn` call sites.
- In `PostBoardCardContent`, right after `<div className="item-title">{post.titulo || 'Post sem título'}</div>`:

```tsx
      {multiplatformEnabled && <DestinationChips post={post} />}
```

In `EntregasPage.tsx` after line 170:

```ts
  // Plataformas por fluxo (P2): chips por destino no card. Dark por plano.
  const multiplatformEnabled = features?.feature_multiplatform === true;
```

and next to `tiktokEnabled={tiktokEnabled}` on `<PostsKanbanView` (line ~1575) add `multiplatformEnabled={multiplatformEnabled}`.

- [ ] **Step 4: Run and confirm pass**

Run: `npx vitest run apps/crm/src/pages/entregas/components/__tests__/DestinationStatusPill.test.tsx apps/crm/src/pages/entregas/views/__tests__/` and `npx tsc -p apps/crm/tsconfig.json --noEmit`
Expected: PASS; tsc clean.

- [ ] **Step 5: Commit**

```bash
git add apps/crm/src/pages/entregas/components/DestinationStatusPill.tsx \
  apps/crm/src/pages/entregas/views/PostsKanbanView.tsx apps/crm/src/pages/entregas/EntregasPage.tsx \
  apps/crm/src/pages/entregas/components/__tests__/DestinationStatusPill.test.tsx \
  apps/crm/src/pages/entregas/views/__tests__/PostsKanbanView.test.tsx
git commit -m "feat(platforms): chips de status por destino no card de Publicações (P2)"
```

---

### Task 9: "Destinos" toggle row

**Files:**
- Create: `apps/crm/src/pages/entregas/components/DestinationToggles.tsx`
- Test: `apps/crm/src/pages/entregas/components/__tests__/DestinationToggles.test.tsx`

**Interfaces:**
- Consumes: `DestinationToggleOption` (Task 2), `PLATFORM_ICONS` (Task 2). Reuses the `.platform-chip`, `.platform-chip--on` CSS from P1.
- Produces: `DestinationToggles({ options, lockedReason, pending, onToggle }: { options: DestinationToggleOption[]; lockedReason: string | null; pending: boolean; onToggle: (platform: PlatformId, on: boolean) => void })`. Renders `null` for an empty `options`.

- [ ] **Step 1: Write the failing test**

```tsx
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { DestinationToggles } from '../DestinationToggles';

const opts = [
  { platform: 'instagram' as const, on: true, disabledReason: null },
  { platform: 'tiktok' as const, on: false, disabledReason: 'Stories não são suportados no TikTok' },
  { platform: 'geral' as const, on: false, disabledReason: null },
];

describe('DestinationToggles', () => {
  it('renders one pressed/unpressed toggle per option inside a Destinos group', () => {
    render(<DestinationToggles options={opts} lockedReason={null} pending={false} onToggle={vi.fn()} />);
    const group = screen.getByRole('group', { name: 'Destinos' });
    expect(group).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Instagram/ })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: /Geral/ })).toHaveAttribute('aria-pressed', 'false');
  });

  it('turns a destination on and off', () => {
    const onToggle = vi.fn();
    render(
      <DestinationToggles
        options={[...opts.slice(0, 1), { ...opts[2], on: true }]}
        lockedReason={null}
        pending={false}
        onToggle={onToggle}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /Geral/ }));
    expect(onToggle).toHaveBeenCalledWith('geral', false);
  });

  it('disables an option that cannot be turned on, with the reason as title', () => {
    render(<DestinationToggles options={opts} lockedReason={null} pending={false} onToggle={vi.fn()} />);
    const tt = screen.getByRole('button', { name: /TikTok/ });
    expect(tt).toBeDisabled();
    expect(tt.parentElement).toHaveAttribute('title', 'Stories não são suportados no TikTok');
  });

  it('refuses to turn off the last destination', () => {
    const onToggle = vi.fn();
    render(
      <DestinationToggles options={[opts[0]]} lockedReason={null} pending={false} onToggle={onToggle} />,
    );
    fireEvent.click(screen.getByRole('button', { name: /Instagram/ }));
    expect(onToggle).not.toHaveBeenCalled();
    expect(screen.getByText('O post precisa de pelo menos um destino.')).toBeInTheDocument();
  });

  it('locks every toggle while scheduled', () => {
    render(
      <DestinationToggles
        options={opts}
        lockedReason="Cancelar agendamento para editar"
        pending={false}
        onToggle={vi.fn()}
      />,
    );
    for (const b of screen.getAllByRole('button')) expect(b).toBeDisabled();
  });

  it('renders nothing for an Express post (no options)', () => {
    const { container } = render(
      <DestinationToggles options={[]} lockedReason={null} pending={false} onToggle={vi.fn()} />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});
```

- [ ] **Step 2: Run and confirm failure**

Run: `npx vitest run apps/crm/src/pages/entregas/components/__tests__/DestinationToggles.test.tsx`
Expected: FAIL (module missing).

- [ ] **Step 3: Implement**

```tsx
import { useId, useState } from 'react';
import { Check } from 'lucide-react';
import { PLATFORM_DEFS, type PlatformId } from '@mesaas/platforms';
import { PLATFORM_ICONS } from '@/components/platformIcons';
import type { DestinationToggleOption } from '../postDestinations';

/**
 * Linha "Destinos" do editor de post (spec UX 2, P2). Só aparece com
 * feature_multiplatform; substitui o PlatformSelector. As opções vêm de
 * destinationToggleOptions (plataformas do quadro + destinos que o post já tem).
 * Nunca deixa o post sem destino (mesma regra de PlatformChips).
 */
export function DestinationToggles({
  options,
  lockedReason,
  pending,
  onToggle,
}: {
  options: DestinationToggleOption[];
  /** Agendado ou já publicado: nada muda. */
  lockedReason: string | null;
  /** Escrita em voo ou destinos carregando. */
  pending: boolean;
  onToggle: (platform: PlatformId, on: boolean) => void;
}) {
  const [lastHint, setLastHint] = useState(false);
  // Único por instância: o WorkflowDrawer pode ter vários posts expandidos.
  const labelId = useId();
  if (options.length === 0) return null;
  const onCount = options.filter((o) => o.on).length;

  return (
    <div className="drawer-post-field drawer-post-field--destinos">
      <label id={labelId}>Destinos</label>
      <div
        role="group"
        aria-labelledby={labelId}
        style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}
      >
        {options.map((o) => {
          const Icon = PLATFORM_ICONS[o.platform];
          const reason = lockedReason ?? (o.on ? null : o.disabledReason);
          return (
            // span: title não aparece em botão desabilitado (sem pointer events)
            <span key={o.platform} title={reason ?? undefined}>
              <button
                type="button"
                aria-pressed={o.on}
                disabled={pending || reason !== null}
                className={`platform-chip${o.on ? ' platform-chip--on' : ''}`}
                onClick={() => {
                  if (o.on && onCount === 1) {
                    setLastHint(true);
                    return;
                  }
                  setLastHint(false);
                  onToggle(o.platform, !o.on);
                }}
              >
                <Icon size={14} aria-hidden="true" />
                {PLATFORM_DEFS[o.platform].label}
                {o.on && <Check size={14} aria-hidden="true" />}
              </button>
            </span>
          );
        })}
      </div>
      {lastHint && (
        <p style={{ fontSize: '0.72rem', color: 'var(--danger-text)', margin: '0.35rem 0 0' }}>
          O post precisa de pelo menos um destino.
        </p>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Run and confirm pass**

Run: same as Step 2. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/crm/src/pages/entregas/components/DestinationToggles.tsx \
  apps/crm/src/pages/entregas/components/__tests__/DestinationToggles.test.tsx
git commit -m "feat(platforms): linha Destinos do editor de post (P2)"
```

---

### Task 10: Caption tabs + `usePostDestinations`

**Files:**
- Create: `apps/crm/src/pages/entregas/components/DestinationCaptionTabs.tsx`
- Create: `apps/crm/src/pages/entregas/hooks/usePostDestinations.ts`
- Test: `apps/crm/src/pages/entregas/components/__tests__/DestinationCaptionTabs.test.tsx`, `apps/crm/src/pages/entregas/hooks/__tests__/usePostDestinations.test.tsx`

**Interfaces:**
- Consumes: Task 1 store functions and types; Task 2 `nativeFormatHint`, `resolveDestinationState`; Task 5 `DestinationCaptionField`; Task 8 `DestinationStatusPill`; `captionMaxFor`, `PLATFORM_DEFS` from the registry; shadcn `Tabs`.
- Produces:
  - `usePostDestinations(post: WorkflowPost, enabled: boolean, onRefresh: () => void): { targets: PostTargetRow[] | undefined; boardPlatforms: PlatformId[] | undefined; isLoading: boolean; toggle: UseMutationResult<void, Error, { platform: PlatformId; on: boolean; seedCaption: string | null }>; saveCaption: (platform: 'tiktok' | 'geral', text: string) => Promise<void> }`
  - `DestinationCaptionTabs` props:
    ```ts
    {
      post: WorkflowPost;
      targets: PostTargetRow[];
      loading: boolean;
      activeTab: PlatformId | null;
      onActiveTabChange: (p: PlatformId) => void;
      /** Agendado: Instagram e TikTok travados (Geral não publica, fica editável). */
      locked: boolean;
      instagramCaption: ReactNode;   // InstagramCaptionField, ou o aviso de Stories
      tiktokSettings: ReactNode;     // TikTokSettingsPanel com hideCaption
      tiktokFieldRef: Ref<DestinationCaptionFieldHandle>;
      geralFieldRef: Ref<DestinationCaptionFieldHandle>;
      onSaveCaption: (platform: 'tiktok' | 'geral', text: string) => Promise<void>;
    }
    ```

- [ ] **Step 1: Write the failing tests**

`apps/crm/src/pages/entregas/hooks/__tests__/usePostDestinations.test.tsx`:

```tsx
import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
vi.mock('@/store', () => ({
  getPostTargets: vi.fn(async () => [
    { id: 1, post_id: 42, platform: 'instagram', status: 'pendente', caption: null },
  ]),
  getBoardPlatforms: vi.fn(async () => ['instagram', 'geral']),
  addPostDestination: vi.fn(async () => {}),
  removePostDestination: vi.fn(async () => {}),
  savePostCaption: vi.fn(async () => {}),
}));

import { toast } from 'sonner';
import * as store from '@/store';
import { usePostDestinations } from '../usePostDestinations';
import type { WorkflowPost } from '@/store/posts';

const post = {
  id: 42,
  conta_id: 'ws-1',
  workflow_id: 10,
  cliente_id: 7,
} as WorkflowPost;

function wrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
}

describe('usePostDestinations', () => {
  beforeEach(() => vi.clearAllMocks());

  it('does not query anything while disabled (flag off)', () => {
    renderHook(() => usePostDestinations(post, false, vi.fn()), { wrapper: wrapper() });
    expect(store.getPostTargets).not.toHaveBeenCalled();
    expect(store.getBoardPlatforms).not.toHaveBeenCalled();
  });

  it('loads targets and board platforms when enabled', async () => {
    const { result } = renderHook(() => usePostDestinations(post, true, vi.fn()), {
      wrapper: wrapper(),
    });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.targets?.map((t) => t.platform)).toEqual(['instagram']);
    expect(result.current.boardPlatforms).toEqual(['instagram', 'geral']);
  });

  it('refetches targets when the derived platform changes (z7 dropped TikTok on stories)', async () => {
    const { result, rerender } = renderHook(
      ({ p }: { p: WorkflowPost }) => usePostDestinations(p, true, vi.fn()),
      { wrapper: wrapper(), initialProps: { p: { ...post, platform: 'both' } as WorkflowPost } },
    );
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    rerender({ p: { ...post, platform: 'instagram' } as WorkflowPost });
    await waitFor(() => expect(store.getPostTargets).toHaveBeenCalledTimes(2));
  });

  it('toggle on adds with the seed and refreshes the post', async () => {
    const onRefresh = vi.fn();
    const { result } = renderHook(() => usePostDestinations(post, true, onRefresh), {
      wrapper: wrapper(),
    });
    await act(async () => {
      await result.current.toggle.mutateAsync({ platform: 'geral', on: true, seedCaption: 'oi' });
    });
    expect(store.addPostDestination).toHaveBeenCalledWith({
      postId: 42,
      contaId: 'ws-1',
      platform: 'geral',
      seedCaption: 'oi',
    });
    expect(onRefresh).toHaveBeenCalled();
  });

  it('toggle off removes', async () => {
    const { result } = renderHook(() => usePostDestinations(post, true, vi.fn()), {
      wrapper: wrapper(),
    });
    await act(async () => {
      await result.current.toggle.mutateAsync({ platform: 'geral', on: false, seedCaption: null });
    });
    expect(store.removePostDestination).toHaveBeenCalledWith(42, 'geral');
  });

  it('saveCaption toasts and rethrows on failure (draft stays)', async () => {
    vi.mocked(store.savePostCaption).mockRejectedValueOnce(new Error('x'));
    const { result } = renderHook(() => usePostDestinations(post, true, vi.fn()), {
      wrapper: wrapper(),
    });
    await expect(result.current.saveCaption('geral', 't')).rejects.toThrow();
    expect(toast.error).toHaveBeenCalledWith('Não foi possível salvar a legenda.');
  });
});
```

`apps/crm/src/pages/entregas/components/__tests__/DestinationCaptionTabs.test.tsx`:

```tsx
import { createRef } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@mesaas/app-lifecycle', () => ({ useUnsavedWork: vi.fn() }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { DestinationCaptionTabs } from '../DestinationCaptionTabs';
import type { DestinationCaptionFieldHandle } from '../DestinationCaptionField';
import type { WorkflowPost } from '@/store/posts';
import type { PostTargetRow } from '@/store/postTargets';

const post = {
  id: 42,
  tipo: 'reels',
  status: 'rascunho',
  scheduled_at: null,
  instagram_media_id: null,
  publish_error: null,
  tiktok_publish_status: null,
  tiktok_caption: 'do tiktok',
} as unknown as WorkflowPost;

const t = (platform: PostTargetRow['platform'], caption: string | null = null): PostTargetRow => ({
  id: platform.length,
  post_id: 42,
  platform,
  status: 'pendente',
  caption,
});

function renderTabs(over: Partial<Parameters<typeof DestinationCaptionTabs>[0]> = {}) {
  const props = {
    post,
    targets: [t('instagram'), t('tiktok'), t('geral', 'texto geral')],
    loading: false,
    activeTab: null,
    onActiveTabChange: vi.fn(),
    locked: false,
    instagramCaption: <div data-testid="ig-field" />,
    tiktokSettings: <div data-testid="tt-settings" />,
    tiktokFieldRef: createRef<DestinationCaptionFieldHandle>(),
    geralFieldRef: createRef<DestinationCaptionFieldHandle>(),
    onSaveCaption: vi.fn(async () => {}),
    ...over,
  };
  return { ...render(<DestinationCaptionTabs {...props} />), props };
}

describe('DestinationCaptionTabs', () => {
  it('one tab per destination with its status pill; first tab active by default', () => {
    renderTabs();
    const tabs = screen.getAllByRole('tab');
    expect(tabs.map((x) => x.textContent)).toEqual([
      expect.stringContaining('Instagram'),
      expect.stringContaining('TikTok'),
      expect.stringContaining('Geral'),
    ]);
    expect(tabs[0]).toHaveAttribute('data-state', 'active');
    expect(screen.getByLabelText('Instagram: Pendente')).toBeInTheDocument();
  });

  it('every panel stays mounted (forceMount) so no draft is dropped', () => {
    renderTabs();
    expect(screen.getByTestId('ig-field')).toBeInTheDocument();
    expect(screen.getByLabelText('Legenda do TikTok')).toHaveValue('do tiktok');
    expect(screen.getByLabelText('Legenda (Geral)')).toHaveValue('texto geral');
    expect(screen.getByTestId('tt-settings')).toBeInTheDocument();
  });

  it('shows the native-format hint and the per-platform counter', () => {
    renderTabs();
    expect(screen.getByText('Formato: Vídeo vertical → Reels')).toBeInTheDocument();
    expect(screen.getByText('Formato: Vídeo vertical → Vídeo TikTok')).toBeInTheDocument();
    expect(screen.getByText('9 / 2200')).toBeInTheDocument(); // "do tiktok" (reels: 2200)
    expect(screen.getByText('11 caracteres')).toBeInTheDocument(); // Geral sem limite
  });

  it('is controlled: switching tabs reports the platform', () => {
    const { props } = renderTabs();
    fireEvent.mouseDown(screen.getByRole('tab', { name: /Geral/ }));
    expect(props.onActiveTabChange).toHaveBeenCalledWith('geral');
  });

  it('honours a controlled activeTab', () => {
    renderTabs({ activeTab: 'geral' });
    expect(screen.getByRole('tab', { name: /Geral/ })).toHaveAttribute('data-state', 'active');
  });

  it('locks the TikTok caption while scheduled; Geral stays editable', () => {
    renderTabs({ locked: true });
    expect(screen.getByLabelText('Legenda do TikTok')).toHaveAttribute('readonly');
    expect(screen.getByLabelText('Legenda (Geral)')).not.toHaveAttribute('readonly');
  });

  it('Geral offers Copiar legenda', () => {
    renderTabs();
    expect(screen.getByRole('button', { name: /Copiar legenda/ })).toBeInTheDocument();
  });

  it('empty and loading states', () => {
    const { rerender, props } = renderTabs({ targets: [] });
    expect(screen.getByText('Este post não tem destinos. Ative um em Destinos.')).toBeInTheDocument();
    rerender(<DestinationCaptionTabs {...props} targets={[]} loading />);
    expect(screen.getByText('Carregando destinos…')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run and confirm failure**

Run: `npx vitest run apps/crm/src/pages/entregas/hooks/__tests__/usePostDestinations.test.tsx apps/crm/src/pages/entregas/components/__tests__/DestinationCaptionTabs.test.tsx`
Expected: FAIL (modules missing).

- [ ] **Step 3: Implement the hook**

`apps/crm/src/pages/entregas/hooks/usePostDestinations.ts`:

```ts
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { PlatformId } from '@mesaas/platforms';
import {
  addPostDestination,
  getBoardPlatforms,
  getPostTargets,
  removePostDestination,
  savePostCaption,
  type WorkflowPost,
} from '@/store';

/**
 * Destinos de UM post no editor (P2, feature_multiplatform). `enabled` = flag ligada
 * e post expandido: desligado, nenhuma query roda e nada do store é tocado (os testes
 * dos drawers mockam '@/store' com uma lista fixa; por isso todo acesso ao store fica
 * dentro de closures).
 */
export function usePostDestinations(post: WorkflowPost, enabled: boolean, onRefresh: () => void) {
  const qc = useQueryClient();
  const postId = post.id ?? null;

  const targetsQuery = useQuery({
    // platform na chave: o banco muda destinos sem passar por aqui (z7 tira o TikTok
    // quando o tipo vira stories, a2/z8 em outros caminhos) e platform é derivado
    // deles, então toda mudança de Instagram/TikTok vira chave nova e refaz a busca.
    // Geral não mexe em platform: as escritas daqui invalidam o prefixo explicitamente.
    queryKey: ['post-targets', postId, post.platform ?? null],
    queryFn: () => getPostTargets(postId!),
    enabled: enabled && postId != null,
    // Chave nova não pisca "Carregando destinos…": mostra os destinos anteriores até chegar.
    placeholderData: (prev) => prev,
  });
  const boardQuery = useQuery({
    queryKey: ['board-platforms', post.workflow_id ?? null, post.cliente_id],
    queryFn: () =>
      getBoardPlatforms({ workflow_id: post.workflow_id ?? null, cliente_id: post.cliente_id }),
    enabled,
    staleTime: 60_000,
  });

  const toggle = useMutation({
    mutationFn: (v: { platform: PlatformId; on: boolean; seedCaption: string | null }) => {
      if (postId == null) throw new Error('post sem id');
      if (!v.on) return removePostDestination(postId, v.platform);
      if (!post.conta_id) throw new Error('post sem conta_id');
      return addPostDestination({
        postId,
        contaId: post.conta_id,
        platform: v.platform,
        seedCaption: v.seedCaption,
      });
    },
    onError: () => toast.error('Não foi possível atualizar os destinos.'),
    // Também em erro: o INSERT pode ter passado e só a cópia da legenda falhado.
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: ['post-targets', postId] });
      void qc.invalidateQueries({ queryKey: ['active-posts'] });
      // platform (derivado no banco), ig_caption e tiktok_caption vêm da query do drawer.
      onRefresh();
    },
  });

  const saveCaption = async (platform: 'tiktok' | 'geral', text: string) => {
    if (postId == null) return;
    try {
      await savePostCaption(postId, platform, text);
    } catch (err) {
      toast.error('Não foi possível salvar a legenda.');
      throw err;
    }
    // useCaptionDraft só larga o rascunho quando o valor das props alcança o salvo.
    if (platform === 'geral') await qc.invalidateQueries({ queryKey: ['post-targets', postId] });
    else onRefresh();
  };

  return {
    targets: targetsQuery.data,
    boardPlatforms: boardQuery.data,
    isLoading: enabled && (targetsQuery.isLoading || boardQuery.isLoading),
    toggle,
    saveCaption,
  };
}
```

Confirm `WorkflowPost` is re-exported from `@/store` (it is: `store/index.ts` re-exports `./posts`).

- [ ] **Step 4: Implement the tabs**

`apps/crm/src/pages/entregas/components/DestinationCaptionTabs.tsx`:

```tsx
import type { ReactNode, Ref } from 'react';
import { PLATFORM_DEFS, captionMaxFor, type PlatformId } from '@mesaas/platforms';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { PLATFORM_ICONS } from '@/components/platformIcons';
import type { WorkflowPost } from '@/store/posts';
import type { PostTargetRow } from '@/store/postTargets';
import { nativeFormatHint, resolveDestinationState } from '../postDestinations';
import { DestinationStatusPill } from './DestinationStatusPill';
import { DestinationCaptionField, type DestinationCaptionFieldHandle } from './DestinationCaptionField';

interface DestinationCaptionTabsProps {
  post: WorkflowPost;
  targets: PostTargetRow[];
  loading: boolean;
  activeTab: PlatformId | null;
  onActiveTabChange: (p: PlatformId) => void;
  locked: boolean;
  instagramCaption: ReactNode;
  tiktokSettings: ReactNode;
  tiktokFieldRef: Ref<DestinationCaptionFieldHandle>;
  geralFieldRef: Ref<DestinationCaptionFieldHandle>;
  onSaveCaption: (platform: 'tiktok' | 'geral', text: string) => Promise<void>;
}

/**
 * Uma aba de legenda por destino (spec UX 2, P2). Legendas sempre separadas:
 * Instagram em ig_caption (campo com comentários, montado pelo PostEditorBody),
 * TikTok em tiktok_caption, Geral em post_targets.caption.
 *
 * forceMount + hidden: trocar de aba nunca desmonta um rascunho (useCaptionDraft
 * registra trabalho não salvo e tem debounce em voo). O auto-grow do campo do
 * Instagram mede scrollHeight; escondido mede 0 e reajusta pelo ResizeObserver ao
 * aparecer (conferir no browser, ver Task 12).
 */
export function DestinationCaptionTabs({
  post,
  targets,
  loading,
  activeTab,
  onActiveTabChange,
  locked,
  instagramCaption,
  tiktokSettings,
  tiktokFieldRef,
  geralFieldRef,
  onSaveCaption,
}: DestinationCaptionTabsProps) {
  if (loading) {
    return (
      <p className="mt-3 text-xs" style={{ color: 'var(--text-light)' }}>
        Carregando destinos…
      </p>
    );
  }
  if (targets.length === 0) {
    return (
      <p className="mt-3 text-xs" style={{ color: 'var(--text-light)' }}>
        Este post não tem destinos. Ative um em Destinos.
      </p>
    );
  }
  const value =
    activeTab && targets.some((t) => t.platform === activeTab) ? activeTab : targets[0].platform;
  const geral = targets.find((t) => t.platform === 'geral');

  return (
    <Tabs
      value={value}
      onValueChange={(v) => onActiveTabChange(v as PlatformId)}
      className="mt-3 rounded-lg border-2 p-3"
      style={{ borderColor: 'var(--border-color)', background: 'var(--surface-hover)' }}
    >
      <TabsList className="h-auto flex-wrap justify-start gap-1">
        {targets.map((t) => {
          const Icon = PLATFORM_ICONS[t.platform];
          return (
            <TabsTrigger key={t.platform} value={t.platform} className="gap-1.5">
              <Icon className="h-3.5 w-3.5" aria-hidden="true" />
              {PLATFORM_DEFS[t.platform].label}
              <DestinationStatusPill
                platform={t.platform}
                state={resolveDestinationState(post, t)}
              />
            </TabsTrigger>
          );
        })}
      </TabsList>

      {targets.map((t) => {
        const hint = nativeFormatHint(t.platform, post.tipo);
        return (
          <TabsContent
            key={t.platform}
            value={t.platform}
            forceMount
            className="data-[state=inactive]:hidden"
          >
            {hint && (
              <p className="mb-2 text-xs" style={{ color: 'var(--text-light)' }}>
                Formato: {hint}
              </p>
            )}
            {t.platform === 'instagram' && instagramCaption}
            {t.platform === 'tiktok' && (
              <div className="flex flex-col gap-3">
                <DestinationCaptionField
                  key={post.id}
                  ref={tiktokFieldRef}
                  id={`tt-dest-caption-${post.id}`}
                  label="Legenda do TikTok"
                  value={post.tiktok_caption ?? ''}
                  max={captionMaxFor('tiktok', post.tipo)}
                  placeholder="Texto exato que será publicado no TikTok."
                  disabled={locked}
                  lockedMessage="Cancelar agendamento para editar"
                  onSave={(text) => onSaveCaption('tiktok', text)}
                />
                {tiktokSettings}
              </div>
            )}
            {t.platform === 'geral' && geral && (
              <DestinationCaptionField
                key={post.id}
                ref={geralFieldRef}
                id={`geral-caption-${post.id}`}
                label="Legenda (Geral)"
                value={geral.caption ?? ''}
                max={null}
                placeholder="Legenda que acompanha o conteúdo para baixar."
                hint="Geral não é publicado automaticamente: o conteúdo fica disponível para baixar."
                showCopy
                onSave={(text) => onSaveCaption('geral', text)}
              />
            )}
          </TabsContent>
        );
      })}
    </Tabs>
  );
}
```

- [ ] **Step 5: Run and confirm pass**

Run: same as Step 2, then `npx tsc -p apps/crm/tsconfig.json --noEmit`.
Expected: PASS; tsc clean. If Radix ignores `fireEvent.mouseDown` in jsdom, use `fireEvent.mouseDown(tab, { button: 0, ctrlKey: false })` (Radix Tabs activates on left mousedown).

- [ ] **Step 6: Commit**

```bash
git add apps/crm/src/pages/entregas/components/DestinationCaptionTabs.tsx \
  apps/crm/src/pages/entregas/hooks/usePostDestinations.ts \
  apps/crm/src/pages/entregas/components/__tests__/DestinationCaptionTabs.test.tsx \
  apps/crm/src/pages/entregas/hooks/__tests__/usePostDestinations.test.tsx
git commit -m "feat(platforms): abas de legenda por destino e hook dos destinos do post (P2)"
```

---

### Task 11: Wire it into `PostEditorBody` behind the flag

**Files:**
- Modify: `apps/crm/src/pages/entregas/components/PostEditorBody.tsx` (imports ~1-58; state after line 194; meta row 387-400; caption area 624-680; `ScheduleButton` 682-691; `PostCommentSummary.onThreadClick` 706-709)
- Test: `apps/crm/src/pages/entregas/components/__tests__/PostEditorBody.destinations.test.tsx` (create)

**Interfaces:**
- Consumes: everything above. No prop of `PostEditorBodyProps` changes, so `WorkflowDrawer` and `StandalonePostDrawer` need no edits.
- Produces: nothing new for other tasks.

- [ ] **Step 1: Write the failing test (flag OFF regression + flag ON behaviour)**

```tsx
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));
vi.mock('@mesaas/app-lifecycle', () => ({ useUnsavedWork: vi.fn() }));
vi.mock('@/lib/supabase');

const limitsMock = vi.hoisted(() => ({ features: null as Record<string, boolean> | null }));
vi.mock('@/hooks/useWorkspaceLimits', () => ({
  useWorkspaceLimits: () => ({ features: limitsMock.features, limits: null, isLoading: false }),
}));
vi.mock('@/hooks/useStatusRegistry', async () => {
  const { buildStatusRegistry } = await import('../../statusRegistry');
  return { useStatusRegistry: () => buildStatusRegistry([]) };
});
vi.mock('@/store', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/store')>()),
  getPostTargets: vi.fn(),
  getBoardPlatforms: vi.fn(),
  addPostDestination: vi.fn(async () => {}),
  removePostDestination: vi.fn(async () => {}),
  savePostCaption: vi.fn(async () => {}),
}));
vi.mock('@/services/postMedia', () => ({ listPostMedia: vi.fn(async () => []) }));
vi.mock('@/services/inlineImage', () => ({
  uploadInlineImage: vi.fn(),
  extractR2Keys: vi.fn(() => []),
  injectSignedUrls: vi.fn((c: unknown) => c),
  stripSignedUrls: vi.fn((c: unknown) => c),
  resolveInlineImageUrls: vi.fn(async () => ({})),
}));
vi.mock('@/pages/entregas/components/PostEditor', () => ({ PostEditor: () => <div /> }));
vi.mock('@/pages/entregas/components/PropertyPanel', () => ({ PropertyPanel: () => null }));
vi.mock('@/pages/entregas/components/PostCommentSummary', () => ({ default: () => null }));
vi.mock('@/pages/entregas/components/PostMediaGallery', () => ({
  PostMediaGallery: () => null,
  hasVideoMissingThumbnail: () => false,
}));
vi.mock('@/pages/entregas/components/InstagramCaptionField', () => ({
  InstagramCaptionField: () => <div data-testid="ig-caption-stub" />,
}));
vi.mock('@/pages/entregas/components/PlatformSelector', () => ({
  PlatformSelector: () => <div data-testid="platform-selector-stub" />,
}));
vi.mock('@/pages/entregas/components/TikTokSettingsPanel', () => ({
  TikTokSettingsPanel: ({ hideCaption }: { hideCaption?: boolean }) => (
    <div data-testid="tiktok-settings-stub" data-hide-caption={String(!!hideCaption)} />
  ),
}));
vi.mock('@/pages/entregas/components/TrialReelPanel', () => ({ TrialReelPanel: () => null }));
vi.mock('@/pages/entregas/components/ScheduleButton', () => ({
  ScheduleButton: ({ explainMissingInstagramAccount }: { explainMissingInstagramAccount?: boolean }) => (
    <div data-testid="schedule-stub" data-explain={String(!!explainMissingInstagramAccount)} />
  ),
}));
vi.mock('@/pages/entregas/components/PostAutomationSection', () => ({
  PostAutomationSection: () => null,
}));
vi.mock('@/pages/entregas/components/PublishErrorBlock', () => ({ PublishErrorBlock: () => null }));
vi.mock('@/pages/entregas/components/SuggestTimeButton', () => ({ SuggestTimeButton: () => null }));
vi.mock('@/pages/entregas/components/PostVersionHistorySheet', () => ({
  PostVersionHistorySheet: () => null,
}));
vi.mock('@/components/ui/date-time-picker', () => ({ DateTimePicker: () => null }));

import * as store from '@/store';
import { PostEditorBody, type PostEditorBodyProps } from '../PostEditorBody';
import type { WorkflowPost } from '@/store';

const basePost = {
  id: 42,
  workflow_id: 10,
  conta_id: 'ws-1',
  cliente_id: 7,
  titulo: 'Post',
  conteudo: null,
  conteudo_plain: '',
  tipo: 'feed',
  ordem: 0,
  status: 'rascunho',
  platform: 'instagram',
  ig_caption: 'Legenda IG',
  tiktok_caption: null,
  is_express: false,
} as WorkflowPost;

function renderBody(over: Partial<PostEditorBodyProps> = {}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const props: PostEditorBodyProps = {
    post: basePost,
    templateId: undefined,
    workflowId: 10,
    clienteId: 7,
    clientePosts: [],
    isExpanded: true,
    approvals: [],
    statusEvents: [],
    editSuggestion: null,
    membros: [],
    replyText: '',
    sendingReply: false,
    commentThreads: [],
    currentUserId: 'user-1',
    currentUserRole: 'owner',
    canManageAutomations: false,
    workspaceUsers: [],
    hasInstagramAccount: false,
    igAccountStatus: null,
    hasActiveTikTokAccount: false,
    ttAccountStatus: null,
    onFieldChange: vi.fn(),
    onContentUpdate: vi.fn(),
    onReplyChange: vi.fn(),
    onReplySend: vi.fn(),
    onRefresh: vi.fn(),
    onCreateComment: vi.fn(async () => 1),
    onSaveCaption: vi.fn(async () => {}),
    onReplyToComment: vi.fn(async () => {}),
    onResolveThread: vi.fn(async () => {}),
    onReopenThread: vi.fn(async () => {}),
    onEditComment: vi.fn(async () => {}),
    onDeleteComment: vi.fn(async () => {}),
    editorVersion: 0,
    onAcceptSuggestion: vi.fn(),
    onRejectSuggestion: vi.fn(),
    ...over,
  };
  return render(
    <QueryClientProvider client={qc}>
      <PostEditorBody {...props} />
    </QueryClientProvider>,
  );
}

const target = (platform: 'instagram' | 'tiktok' | 'geral', caption: string | null = null) => ({
  id: platform.length,
  post_id: 42,
  platform,
  status: 'pendente' as const,
  caption,
});

describe('PostEditorBody, feature_multiplatform OFF (regressão: igual a hoje)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    limitsMock.features = { feature_tiktok: true };
  });

  it('keeps PlatformSelector, no Destinos row, no tabs, no post_targets request', () => {
    renderBody();
    expect(screen.getByTestId('platform-selector-stub')).toBeInTheDocument();
    expect(screen.queryByRole('group', { name: 'Destinos' })).toBeNull();
    expect(screen.queryByRole('tablist')).toBeNull();
    expect(store.getPostTargets).not.toHaveBeenCalled();
    expect(store.getBoardPlatforms).not.toHaveBeenCalled();
  });

  it('hides the caption without a connected Instagram account, shows it with one', () => {
    const { unmount } = renderBody({ hasInstagramAccount: false });
    expect(screen.queryByTestId('ig-caption-stub')).toBeNull();
    unmount();
    renderBody({ hasInstagramAccount: true });
    expect(screen.getByTestId('ig-caption-stub')).toBeInTheDocument();
  });

  it('TikTok panel keeps its own caption field and the schedule hint stays off', () => {
    renderBody({ post: { ...basePost, platform: 'both' } });
    expect(screen.getByTestId('tiktok-settings-stub')).toHaveAttribute('data-hide-caption', 'false');
    expect(screen.getByTestId('schedule-stub')).toHaveAttribute('data-explain', 'false');
  });

  it('still loading limits (features null) behaves as OFF', () => {
    limitsMock.features = null;
    renderBody();
    expect(screen.getByTestId('platform-selector-stub')).toBeInTheDocument();
    expect(store.getPostTargets).not.toHaveBeenCalled();
  });
});

describe('PostEditorBody, feature_multiplatform ON', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    limitsMock.features = { feature_tiktok: true, feature_multiplatform: true };
    vi.mocked(store.getBoardPlatforms).mockResolvedValue(['instagram', 'geral']);
  });

  it('caption tabs appear without a connected Instagram account; PlatformSelector is gone', async () => {
    vi.mocked(store.getPostTargets).mockResolvedValue([
      target('instagram'),
      target('geral', 'Texto geral'),
    ]);
    renderBody({ hasInstagramAccount: false });
    expect(await screen.findByRole('tab', { name: /Instagram/ })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /Geral/ })).toBeInTheDocument();
    expect(screen.getByTestId('ig-caption-stub')).toBeInTheDocument();
    expect(screen.queryByTestId('platform-selector-stub')).toBeNull();
    expect(screen.getByTestId('schedule-stub')).toHaveAttribute('data-explain', 'true');
  });

  it('turning Geral on copies the first destination caption', async () => {
    vi.mocked(store.getPostTargets).mockResolvedValue([target('instagram')]);
    renderBody();
    const geral = await screen.findByRole('button', { name: /Geral/ });
    await waitFor(() => expect(geral).not.toBeDisabled());
    fireEvent.click(geral);
    await waitFor(() =>
      expect(store.addPostDestination).toHaveBeenCalledWith({
        postId: 42,
        contaId: 'ws-1',
        platform: 'geral',
        seedCaption: 'Legenda IG',
      }),
    );
  });

  it('turning Instagram back on does not overwrite a caption it already has', async () => {
    vi.mocked(store.getPostTargets).mockResolvedValue([target('geral', 'G')]);
    renderBody(); // basePost.ig_caption = 'Legenda IG'
    const ig = await screen.findByRole('button', { name: /Instagram/ });
    await waitFor(() => expect(ig).not.toBeDisabled());
    fireEvent.click(ig);
    await waitFor(() =>
      expect(store.addPostDestination).toHaveBeenCalledWith(
        expect.objectContaining({ platform: 'instagram', seedCaption: null }),
      ),
    );
  });

  it('turning a destination off removes it', async () => {
    vi.mocked(store.getPostTargets).mockResolvedValue([target('instagram'), target('geral')]);
    renderBody();
    const geral = await screen.findByRole('button', { name: /Geral/ });
    await waitFor(() => expect(geral).not.toBeDisabled());
    fireEvent.click(geral);
    await waitFor(() => expect(store.removePostDestination).toHaveBeenCalledWith(42, 'geral'));
  });

  it('TikTok settings move into the TikTok tab without their caption field', async () => {
    vi.mocked(store.getBoardPlatforms).mockResolvedValue(['instagram', 'tiktok']);
    vi.mocked(store.getPostTargets).mockResolvedValue([target('instagram'), target('tiktok')]);
    renderBody({ post: { ...basePost, platform: 'both' }, hasActiveTikTokAccount: true });
    expect(await screen.findByRole('tab', { name: /TikTok/ })).toBeInTheDocument();
    const panels = screen.getAllByTestId('tiktok-settings-stub');
    expect(panels).toHaveLength(1);
    expect(panels[0]).toHaveAttribute('data-hide-caption', 'true');
  });

  it('Post Express: no Destinos row', async () => {
    vi.mocked(store.getPostTargets).mockResolvedValue([target('instagram')]);
    renderBody({ post: { ...basePost, is_express: true } });
    await screen.findByRole('tab', { name: /Instagram/ });
    expect(screen.queryByRole('group', { name: 'Destinos' })).toBeNull();
  });
});
```

- [ ] **Step 2: Run and confirm failure**

Run: `npx vitest run apps/crm/src/pages/entregas/components/__tests__/PostEditorBody.destinations.test.tsx`
Expected: the OFF block passes already (regression baseline); the ON block FAILS (no tabs).

- [ ] **Step 3: Implement**

Imports (add):

```ts
import type { PlatformId } from '@mesaas/platforms';
import { usePostDestinations } from '../hooks/usePostDestinations';
import { DestinationToggles } from './DestinationToggles';
import { DestinationCaptionTabs } from './DestinationCaptionTabs';
import type { DestinationCaptionFieldHandle } from './DestinationCaptionField';
import { destinationToggleOptions, seedCaptionFor } from '../postDestinations';
```

After `const [versionHistoryOpen, setVersionHistoryOpen] = useState(false);` (line 194), still above the `if (!isExpanded) return null;` early return:

```ts
  // Plataformas por fluxo (P2), dark atrás de feature_multiplatform. Desligada ou
  // carregando = a árvore de hoje: PlatformSelector, uma legenda do Instagram só com
  // conta conectada, painel do TikTok com a própria legenda.
  const multiplatform = features?.feature_multiplatform === true;
  const destinations = usePostDestinations(post, multiplatform && isExpanded, onRefresh);
  const [captionTab, setCaptionTab] = useState<PlatformId | null>(null);
  const tiktokCaptionRef = useRef<DestinationCaptionFieldHandle>(null);
  const geralCaptionRef = useRef<DestinationCaptionFieldHandle>(null);
```

After `const statusAutomationHint = getStatusAutomationHint(post);` (line 339):

```ts
  const targets = destinations.targets ?? [];
  const currentPlatforms = targets.map((t) => t.platform);
  const destinationLockReason =
    post.status === 'agendado'
      ? 'Cancelar agendamento para editar'
      : post.status === 'postado'
        ? 'Post já publicado'
        : null;

  const handleDestinationToggle = (platform: PlatformId, on: boolean) => {
    const ownCaption =
      platform === 'instagram'
        ? post.ig_caption
        : platform === 'tiktok'
          ? post.tiktok_caption
          : null;
    // Destino que já tem legenda própria (ex.: Instagram tirado e religado) não recebe cópia.
    const seedCaption =
      on && !ownCaption?.trim()
        ? seedCaptionFor(
            platform,
            currentPlatforms,
            {
              instagram: captionRef.current?.getText() ?? post.ig_caption ?? null,
              tiktok: tiktokCaptionRef.current?.getText() ?? post.tiktok_caption ?? null,
              geral:
                geralCaptionRef.current?.getText() ??
                targets.find((t) => t.platform === 'geral')?.caption ??
                null,
            },
            post.tipo,
          )
        : null;
    destinations.toggle.mutate({ platform, on, seedCaption });
    if (on) setCaptionTab(platform);
  };

  const storiesNote = (
    <p className="mt-3 text-xs" style={{ color: 'var(--text-light)' }}>
      Stories: uma ou mais mídias (cada uma vira um segmento), sem legenda, formato vertical
      9:16.
    </p>
  );
  const instagramCaptionField = (
    <InstagramCaptionField
      key={post.id}
      ref={captionRef}
      value={post.ig_caption ?? ''}
      threads={commentThreads}
      disabled={isScheduleLocked}
      lockedMessage="Cancelar agendamento para editar"
      onSave={(text, anchors) => onSaveCaption(post.id!, text, anchors)}
      comments={
        currentUserId
          ? {
              membros,
              workspaceUsers,
              currentUserId,
              onCreateThread: (quotedText, comment, anchor) =>
                onCreateComment(post.id!, quotedText, comment, anchor),
              onReply: onReplyToComment,
              onResolve: onResolveThread,
              onReopen: onReopenThread,
              onEditComment,
              onDeleteComment,
            }
          : undefined
      }
    />
  );
  const tiktokSettingsPanel = (hideCaption: boolean) => (
    <TikTokSettingsPanel
      clientId={clienteId}
      post={post}
      onFieldChange={onFieldChange}
      onCompletenessChange={setTiktokSettingsComplete}
      showTestModeBanner={tiktokTestModeBanner}
      hideCaption={hideCaption}
    />
  );
```

(The two consts are the exact JSX that sits at lines 624-655 today; the flag-OFF branch below reuses them, so its output does not change.)

Meta row, replace the `<PlatformSelector … />` element (lines 387-400) with:

```tsx
        {multiplatform ? (
          <DestinationToggles
            options={destinationToggleOptions({
              boardPlatforms: destinations.boardPlatforms ?? [],
              current: currentPlatforms,
              tipo: post.tipo,
              tiktokFeatureEnabled: features?.feature_tiktok === true,
              hasActiveTikTokAccount,
              isExpress: post.is_express === true,
            })}
            lockedReason={destinationLockReason}
            pending={destinations.toggle.isPending || destinations.isLoading}
            onToggle={handleDestinationToggle}
          />
        ) : (
          <PlatformSelector
            value={post.platform ?? 'instagram'}
            tipo={post.tipo}
            tiktokFeatureEnabled={features?.feature_tiktok === true}
            hasActiveTikTokAccount={hasActiveTikTokAccount}
            disabled={isScheduleLocked}
            isExpress={post.is_express === true}
            onChange={(platform) => {
              onFieldChange('platform', platform);
              if (platform === 'tiktok' && post.ig_trial_strategy) {
                onFieldChange('ig_trial_strategy', null);
              }
            }}
          />
        )}
```

Caption area, replace lines 624-655 (`{isStoryPost ? (…) : hasInstagramAccount ? (…) : null}`) with:

```tsx
      {multiplatform ? (
        <DestinationCaptionTabs
          post={post}
          targets={targets}
          loading={destinations.isLoading}
          activeTab={captionTab}
          onActiveTabChange={setCaptionTab}
          locked={isScheduleLocked}
          instagramCaption={isStoryPost ? storiesNote : instagramCaptionField}
          tiktokSettings={tiktokSettingsPanel(true)}
          tiktokFieldRef={tiktokCaptionRef}
          geralFieldRef={geralCaptionRef}
          onSaveCaption={destinations.saveCaption}
        />
      ) : isStoryPost ? (
        storiesNote
      ) : hasInstagramAccount ? (
        instagramCaptionField
      ) : null}
```

TikTok panel block (lines 672-680) becomes flag-OFF only:

```tsx
      {!multiplatform && (post.platform === 'tiktok' || post.platform === 'both') &&
        tiktokSettingsPanel(false)}
```

(Keep the existing comment above it.)

`ScheduleButton` gains `explainMissingInstagramAccount={multiplatform}`.

`PostCommentSummary.onThreadClick` becomes:

```tsx
        onThreadClick={(threadId) => {
          const thread = commentThreads.find((t) => t.id === threadId);
          if (thread?.field !== 'ig_caption') return;
          if (multiplatform) {
            if (!currentPlatforms.includes('instagram')) return;
            setCaptionTab('instagram');
            // A aba do Instagram pode estar escondida (forceMount + hidden) e o popover
            // se posiciona pelos retângulos do texto: foca depois de revelar a aba.
            requestAnimationFrame(() => captionRef.current?.focusThread(threadId));
            return;
          }
          captionRef.current?.focusThread(threadId);
        }}
```

- [ ] **Step 4: Run the new test and the existing drawer suites**

Run:
```bash
npx vitest run apps/crm/src/pages/entregas/components/__tests__/PostEditorBody.destinations.test.tsx \
  apps/crm/src/pages/entregas/components/__tests__/StandalonePostDrawer.test.tsx \
  apps/crm/src/pages/entregas/components/__tests__/WorkflowDrawer.test.tsx \
  apps/crm/src/pages/entregas/components/__tests__/WorkflowDrawerAutoComplete.test.tsx \
  apps/crm/src/pages/entregas/components/__tests__/WorkflowDrawerAutoScheduleNudge.test.tsx \
  apps/crm/src/pages/entregas/components/__tests__/WorkflowDrawer.duplicate.test.tsx
npx tsc -p apps/crm/tsconfig.json --noEmit
```
Expected: all PASS (the drawer suites run with the flag off and mock `@/store` without the new functions; they must not notice anything), tsc clean.

- [ ] **Step 5: Commit**

```bash
git add apps/crm/src/pages/entregas/components/PostEditorBody.tsx \
  apps/crm/src/pages/entregas/components/__tests__/PostEditorBody.destinations.test.tsx
git commit -m "feat(platforms): editor de post com Destinos e abas de legenda atrás da flag (P2)"
```

---

### Task 12: Gates, browser check, PR

- [ ] **Step 1: Full gates** (from Global Constraints). `npm run format` first if `format:check` fails, then re-run. Run `npm ci` before judging gates if `ls node_modules/.deno` exists (Deno runs swap prettier).

- [ ] **Step 2: Browser check.** Local stack on colima with the P1 migrations, CRM via `preview_start` (`npm run dev:env` with `.env` pointing at local; worktrees have no `.env.staging`, and `:staging` scripts fall back to PROD there). Log in with the seed-login helper and stub `workspace-limits` if the page spins (see memory notes "Seed login p/ verificação no Browser pane" and "Local browser verify: stub edge fns"). Enable the flag for the test workspace: `insert into workspace_plan_overrides (workspace_id, feature_overrides) values ('<ws>', '{"feature_multiplatform": true}') on conflict (workspace_id) do update set feature_overrides = excluded.feature_overrides;` via `npx supabase db query` locally. Check, with screenshots of 1, 2 and 6:
  1. A client **without** a connected Instagram account, board `{instagram, geral}`: the post shows "Destinos" (Instagram, Geral) and caption tabs; typing in the Instagram tab autosaves (reload keeps it); "Agendar" is replaced by the account hint once the post is `aprovado_cliente`.
  2. Turning Geral on copies the Instagram caption into the Geral tab; "Copiar legenda" puts it on the clipboard; the counter reads "N caracteres".
  3. A `{instagram, tiktok}` board, TikTok plan, active TikTok account: turning TikTok on shows the TikTok tab with the caption field, "Formato: … → Vídeo TikTok" for reels, and the TikTok settings panel without a second caption field. Switch `Tipo` to Stories: the TikTok destination disappears (trigger `z7`) and its toggle shows the stories reason.
  4. Hidden-tab behaviour: type in the Geral tab, switch to Instagram within 1.5 s, wait: the Geral text is saved. Switch back to Instagram: the textarea height is right (auto-grow after reveal). Click a caption comment in the summary while on Geral: the tab switches and the popover lands on the quoted text.
  5. Scheduled post: Destinos and the Instagram/TikTok captions are locked; Geral stays editable.
  6. Publicações board: each card shows one chip per destination (icon only when pending, "Publicado"/"Disponível"/"Agendado" otherwise).
  7. Flag off (delete the override, reload): the editor and the board look exactly like `main` (PlatformSelector, caption only with a connected account, no chips).
  8. Light and dark theme for the tabs and chips; drawer at a narrow width (tabs wrap). `InstagramCaptionField` draws its own `rounded-lg border-2 p-3` box and a "Legenda do Instagram" header, and it now sits inside the tabs frame under a tab already called Instagram: expect a double border and a redundant header. Decide here whether to drop the frame on the `Tabs` root or give `InstagramCaptionField` a `frameless` prop (flag-ON only; the flag-OFF render must not change).

- [ ] **Step 3: PR** (ask the user before pushing; the deploy needs no DB or function step)

```bash
git fetch origin main && git log HEAD..origin/main --oneline   # rebase first if not empty
git push -u origin claude/platform-agnostic-p2
gh pr create --title "feat(platforms): P2 Destinos, abas de legenda por destino e chips no quadro" --body "$(cat <<'EOF'
Fase P2 da spec docs/superpowers/specs/2026-09-29-platform-agnostic-posts-design.md (plano em docs/superpowers/plans/2026-10-08-platform-agnostic-p2-caption-tabs.md, com os desvios da spec no topo).

Tudo atrás de `feature_multiplatform` (dark). Com a flag desligada o editor e o quadro ficam iguais à main.

- Editor de post: linha "Destinos" (plataformas do quadro), uma aba de legenda por destino com formato nativo, status e contador por plataforma. A legenda não depende mais de conta do Instagram conectada; a conta só controla agendar/publicar.
- Destino novo começa com a legenda do primeiro destino que tem legenda (cortada no limite da plataforma).
- Legendas: Instagram em `ig_caption` (comentários e versões como antes), TikTok em `tiktok_caption` (o publicador lê essa coluna até P4), Geral em `post_targets.caption`.
- Quadro de Publicações: um chip de status por destino.

Sem migration e sem edge function: o merge só publica o frontend.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Open questions (not resolved by the spec; the plan's working choice is in brackets)

1. **"First destination's caption" when the first destination's caption is empty.** [Skip to the next destination in registry order that has a caption; copy nothing if none.] The spec says "the first destination's caption" without saying what "first" means (registry order vs. creation order) or what to do when it is empty.
2. **Copy longer than the new destination's limit** (TikTok photo 4000 or Geral unlimited into Instagram 2200). [Cut at the limit, no toast.] Alternative: copy nothing and warn.
3. **TikTok destination without an active TikTok account.** [Disabled, mirroring `PlatformSelector` today.] The spec's principle ("the connected-account check now controls only publish/schedule") would allow writing a TikTok caption without an account, but `ScheduleButton` has no "no TikTok account" guard (only revoked/expired), so allowing it would expose a schedule path that fails server-side.
4. **What the board chip says for `pendente`.** [Icon only; "Aguardando aprovação" when the post is `enviado_cliente`.] The spec lists five pill labels (Publicado / Agendado / Falhou / Disponível / Aguardando aprovação) and none for a draft or an approved-but-unscheduled post.
5. **Geral "Disponível" before P3.** [TS shim: approved, scheduled or posted = Disponível.] Confirm this is wanted in P2, or keep Geral "Pendente" until P3 writes the real status.
6. **Workspace that loses `feature_multiplatform`** with Geral-only posts: the editor falls back to today's tree, so their Geral caption is invisible and, without an Instagram account, no caption shows at all. `PlatformChips` has an escape hatch for the board lists; the editor does not. [Accepted for the pilot, like P1's deviation 11.]
7. **Locked Destinos on `postado`.** [Locked: "Post já publicado".] Adding a Geral destination to an already published post could be useful (download after the fact); P3's export may want it unlocked.
8. **Removing a destination that already published** (Instagram with `instagram_media_id`) is blocked only through the `postado` lock; a `both` post with Instagram published and TikTok failed (`falha_publicacao`) can still drop Instagram. [Allowed: the legacy columns keep the publish record.]
9. **Layout and label.** The spec mockup has media + "Formato" on the left; P2 keeps the current layout and the "Tipo" label (deviation 8). Confirm that is acceptable for the pilot.
