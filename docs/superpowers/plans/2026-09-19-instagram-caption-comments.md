# Instagram Caption Comments Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let agency members leave internal comment threads on selected text in the Instagram caption (`workflow_posts.ig_caption`), with a highlight in the field, in the CRM post editor.

**Architecture:** Caption threads reuse `post_comment_threads` / `post_comments` with new columns (`field`, `anchor_start`, `anchor_end`, `orphaned`). A plain textarea holds no marks, so anchors are UTF-16 offsets stored in the DB and tracked in the client by a pure module (`captionAnchors.ts`). The caption text and its anchors are saved atomically by a new `save_ig_caption` RPC. A mirror `<div>` behind a transparent textarea paints the highlights.

**Tech Stack:** React 19 + TypeScript, TanStack Query, shadcn `Textarea`/`Button`, Supabase (Postgres RPC + RLS), Vitest + Testing Library, psql entitlement suites.

**Spec:** `docs/superpowers/specs/2026-09-19-instagram-caption-comments-design.md`

## Global Constraints

- Offsets are **UTF-16 code-unit indices** into the caption string (what `selectionStart`/`selectionEnd` return). Never code points.
- Caption threads are **internal only**: the Hub never sees them; no Hub/edge-function/MCP changes.
- Commenting stays enabled while the caption is locked (status `agendado`). The lock swaps `disabled` for `readOnly` on the textarea. **Do not** copy `PostEditor`'s `readOnly={disabled}` on `PostCommentPopover`.
- Orphaning is terminal in `remapAnchors`/`validateAnchors`; only "text equals the last persisted text" resets anchors to the persisted ones.
- Caption text + anchors commit atomically via `save_ig_caption`; `onFieldChange('ig_caption', ...)` is no longer used for the caption.
- Portuguese UI copy; **no em-dashes in user-facing copy** (period or colon instead). Toasts via `sonner`.
- Migration version prefix must be unique and above main's tail (`20260925000015` at planning time; re-check `ls supabase/migrations | tail -3` and renumber before opening the PR).
- Icons: `lucide-react` only. Never use `useBlocker`.
- Before pushing: `npm run lint`, `npm run format:check`, the four `tsc` commands, `npm run test`, `npm run check:functions`, `npm run test:functions`.

## File Structure

| File | Responsibility |
|---|---|
| `supabase/migrations/20260925000016_post_comment_threads_caption_anchors.sql` | Columns + CHECK on `post_comment_threads`; `save_ig_caption` RPC |
| `supabase/tests/entitlements/98_caption_comment_anchors.sql` | psql suite: CHECK, RPC atomicity, tenant isolation, grants |
| `apps/crm/src/store/comments.ts` | Thread type fields, `createCommentThread(..., anchor?)`, `saveIgCaption` |
| `apps/crm/src/pages/entregas/utils/captionAnchors.ts` | Pure anchor logic: remap, validate, mirror segments, hit pick |
| `apps/crm/src/pages/entregas/components/useCaptionDraft.ts` | Debounced draft + anchors + serialized atomic saves |
| `apps/crm/src/pages/entregas/components/AddCommentPopover.tsx` | Extracted "add comment" popover shared by both editors |
| `apps/crm/src/pages/entregas/components/InstagramCaptionField.tsx` | Rewritten field: mirror, Comentar button, thread popover, `focusThread` |
| `apps/crm/src/pages/entregas/components/PostEditor.tsx` | Uses `AddCommentPopover` (behavior unchanged) |
| `apps/crm/src/pages/entregas/components/PostCommentSummary.tsx` | "Legenda" chip + "texto removido" badge |
| `apps/crm/src/pages/entregas/components/PostEditorBody.tsx` | Threads new props into the field, `onThreadClick` |
| `apps/crm/src/pages/entregas/components/WorkflowDrawer.tsx`, `StandalonePostDrawer.tsx` | `onSaveCaption` + anchor-aware `handleCreateComment` |
| `apps/crm/style.css` | `.caption-mirror` styles |

## Interfaces (shared names, used across tasks)

```ts
// store/comments.ts
export interface CommentAnchor { field: 'ig_caption'; start: number; end: number }
export interface CaptionAnchorPatch {
  id: number;
  anchor_start: number | null;
  anchor_end: number | null;
  orphaned: boolean;
  quoted_text?: string;
}
export function createCommentThread(postId: number, quotedText: string, firstComment: string, anchor?: CommentAnchor): Promise<CommentThreadWithComments>;
export function saveIgCaption(postId: number, caption: string, anchors: CaptionAnchorPatch[]): Promise<void>;

// utils/captionAnchors.ts
export interface CaptionAnchor { id: number; start: number; end: number; quotedText: string; orphaned: boolean }
export function anchorsFromThreads(threads: CommentThread[]): CaptionAnchor[];
export function remapAnchors(oldText: string, newText: string, anchors: CaptionAnchor[]): CaptionAnchor[];
export function validateAnchors(text: string, anchors: CaptionAnchor[]): CaptionAnchor[];
export function patchesFromAnchors(anchors: CaptionAnchor[]): CaptionAnchorPatch[];
export interface MirrorSegment { text: string; threadIds: number[] }
export function buildMirrorSegments(text: string, ranges: { id: number; start: number; end: number }[]): MirrorSegment[];
export function pickThreadId(hits: number[][]): number | null;

// useCaptionDraft.ts
export const MAX_CAPTION_CHARS = 2200;
export function useCaptionDraft(args: { value: string; threads: CommentThread[]; onSave: (text: string, anchors: CaptionAnchorPatch[]) => Promise<void> }):
  { text: string; anchors: CaptionAnchor[]; change(next: string): void; flush(): Promise<boolean>; getText(): string };

// InstagramCaptionField.tsx
export interface InstagramCaptionFieldHandle { focusThread(threadId: number): void }
```

---

### Task 1: Migration, RPC and psql suite

**Files:**
- Create: `supabase/migrations/20260925000016_post_comment_threads_caption_anchors.sql`
- Create: `supabase/tests/entitlements/98_caption_comment_anchors.sql`

**Interfaces:**
- Produces: columns `post_comment_threads.{field,anchor_start,anchor_end,orphaned}`; RPC `public.save_ig_caption(p_post_id bigint, p_caption text, p_anchors jsonb) returns void`.

- [ ] **Step 1: Confirm the version prefix is free**

Run: `git fetch origin main && git ls-tree origin/main --name-only supabase/migrations/ | tail -3`
Expected: tail is `20260925000015_*`. If higher, use the next free prefix in both file names below.

- [ ] **Step 2: Write the failing psql suite**

Create `supabase/tests/entitlements/98_caption_comment_anchors.sql`:

```sql
\set ON_ERROR_STOP on
\i supabase/tests/entitlements/_helpers.sql

-- Suite for 20260925000016_post_comment_threads_caption_anchors.sql:
--   1. The anchor CHECK constraint (NULL anchor_end must be rejected).
--   2. save_ig_caption updates the caption and the listed threads' anchors in one call.
--   3. Tenant isolation: a member of conta A can neither save a caption on, nor
--      re-anchor threads of, conta B.
--   4. Grants: anon has no EXECUTE.

-- =====================================================================
-- 1. CHECK constraint
-- =====================================================================
begin;
select et_grant_hosted_parity();
do $$
declare
  v_ws uuid; v_user uuid := gen_random_uuid();
  v_cli bigint; v_post bigint; v_rejected boolean;
begin
  v_ws := et_make_workspace('pro');
  insert into auth.users (id) values (v_user);
  insert into workspace_members (user_id, workspace_id, role) values (v_user, v_ws, 'owner');
  update profiles set conta_id = v_ws, active_workspace_id = v_ws where id = v_user;
  insert into clientes (user_id, conta_id, nome, sigla, cor) values (v_user, v_ws, 'A', 'A', '#000') returning id into v_cli;
  insert into workflow_posts (conta_id, cliente_id, status) values (v_ws, v_cli, 'rascunho') returning id into v_post;

  -- valid caption thread
  insert into post_comment_threads (post_id, conta_id, quoted_text, created_by, field, anchor_start, anchor_end)
    values (v_post, v_ws, 'abc', v_user, 'ig_caption', 0, 3);
  -- valid orphaned caption thread with NULL offsets
  insert into post_comment_threads (post_id, conta_id, quoted_text, created_by, field, orphaned)
    values (v_post, v_ws, 'abc', v_user, 'ig_caption', true);
  -- valid legacy content thread (defaults)
  insert into post_comment_threads (post_id, conta_id, quoted_text, created_by)
    values (v_post, v_ws, 'abc', v_user);

  -- caption thread with NULL anchor_end must be rejected
  v_rejected := false;
  begin
    insert into post_comment_threads (post_id, conta_id, quoted_text, created_by, field, anchor_start, anchor_end)
      values (v_post, v_ws, 'abc', v_user, 'ig_caption', 0, null);
  exception when check_violation then v_rejected := true; end;
  assert v_rejected, 'caption thread with NULL anchor_end must violate the CHECK';

  -- caption thread with empty / inverted range must be rejected
  v_rejected := false;
  begin
    insert into post_comment_threads (post_id, conta_id, quoted_text, created_by, field, anchor_start, anchor_end)
      values (v_post, v_ws, 'abc', v_user, 'ig_caption', 4, 4);
  exception when check_violation then v_rejected := true; end;
  assert v_rejected, 'caption thread with anchor_end <= anchor_start must violate the CHECK';

  -- content thread carrying offsets must be rejected
  v_rejected := false;
  begin
    insert into post_comment_threads (post_id, conta_id, quoted_text, created_by, field, anchor_start, anchor_end)
      values (v_post, v_ws, 'abc', v_user, 'conteudo', 0, 3);
  exception when check_violation then v_rejected := true; end;
  assert v_rejected, 'content thread with offsets must violate the CHECK';

  raise notice 'PASS 98.1 anchor CHECK constraint';
end $$;
rollback;

-- =====================================================================
-- 2 + 3. save_ig_caption: atomic update and tenant isolation
-- =====================================================================
begin;
select et_grant_hosted_parity();
do $$
declare
  v_ws_a uuid; v_ws_b uuid; v_user uuid := gen_random_uuid();
  v_cli_a bigint; v_cli_b bigint; v_post_a bigint; v_post_b bigint;
  v_t_a bigint; v_t_a_content bigint; v_t_b bigint;
  v_caption text; v_s int; v_e int; v_orph boolean; v_q text; v_rejected boolean;
begin
  v_ws_a := et_make_workspace('pro');
  v_ws_b := et_make_workspace('pro');
  insert into auth.users (id) values (v_user);
  insert into workspace_members (user_id, workspace_id, role) values (v_user, v_ws_a, 'owner');
  update profiles set conta_id = v_ws_a, active_workspace_id = v_ws_a where id = v_user;
  insert into clientes (user_id, conta_id, nome, sigla, cor) values (v_user, v_ws_a, 'A', 'A', '#000') returning id into v_cli_a;
  insert into clientes (user_id, conta_id, nome, sigla, cor) values (v_user, v_ws_b, 'B', 'B', '#000') returning id into v_cli_b;
  insert into workflow_posts (conta_id, cliente_id, status, ig_caption) values (v_ws_a, v_cli_a, 'rascunho', 'hello world') returning id into v_post_a;
  insert into workflow_posts (conta_id, cliente_id, status, ig_caption) values (v_ws_b, v_cli_b, 'rascunho', 'other') returning id into v_post_b;
  insert into post_comment_threads (post_id, conta_id, quoted_text, created_by, field, anchor_start, anchor_end)
    values (v_post_a, v_ws_a, 'world', v_user, 'ig_caption', 6, 11) returning id into v_t_a;
  insert into post_comment_threads (post_id, conta_id, quoted_text, created_by)
    values (v_post_a, v_ws_a, 'content', v_user) returning id into v_t_a_content;
  insert into post_comment_threads (post_id, conta_id, quoted_text, created_by, field, anchor_start, anchor_end)
    values (v_post_b, v_ws_b, 'other', v_user, 'ig_caption', 0, 5) returning id into v_t_b;

  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', v_user)::text, true);

  -- 2. atomic update: caption + anchors together, content threads untouched
  perform save_ig_caption(v_post_a, 'oh hello world!', jsonb_build_array(
    jsonb_build_object('id', v_t_a, 'anchor_start', 9, 'anchor_end', 14, 'orphaned', false, 'quoted_text', 'world'),
    jsonb_build_object('id', v_t_a_content, 'anchor_start', 1, 'anchor_end', 2, 'orphaned', false)));
  reset role;

  select ig_caption into v_caption from workflow_posts where id = v_post_a;
  assert v_caption = 'oh hello world!', format('caption not saved: %s', v_caption);
  select anchor_start, anchor_end, orphaned, quoted_text into v_s, v_e, v_orph, v_q
    from post_comment_threads where id = v_t_a;
  assert v_s = 9 and v_e = 14 and not v_orph and v_q = 'world', 'caption thread anchors not updated';
  select anchor_start into v_s from post_comment_threads where id = v_t_a_content;
  assert v_s is null, 'content thread must not be touched by save_ig_caption';

  -- orphaning nulls offsets and keeps quoted_text
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', v_user)::text, true);
  perform save_ig_caption(v_post_a, 'oh hi!', jsonb_build_array(
    jsonb_build_object('id', v_t_a, 'anchor_start', null, 'anchor_end', null, 'orphaned', true)));
  reset role;
  select anchor_start, anchor_end, orphaned, quoted_text into v_s, v_e, v_orph, v_q
    from post_comment_threads where id = v_t_a;
  assert v_s is null and v_e is null and v_orph and v_q = 'world', 'orphaned thread must have NULL offsets and keep quoted_text';

  -- 3. tenant isolation: cannot save a caption on conta B's post
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', v_user)::text, true);
  v_rejected := false;
  begin
    perform save_ig_caption(v_post_b, 'hijacked', '[]'::jsonb);
  exception when others then v_rejected := true; end;
  reset role;
  assert v_rejected, 'save_ig_caption on another workspace''s post must raise';
  select ig_caption into v_caption from workflow_posts where id = v_post_b;
  assert v_caption = 'other', 'conta B caption must be untouched';

  -- a thread of another post listed in p_anchors is ignored
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', v_user)::text, true);
  perform save_ig_caption(v_post_a, 'oh hi!', jsonb_build_array(
    jsonb_build_object('id', v_t_b, 'anchor_start', 1, 'anchor_end', 2, 'orphaned', false, 'quoted_text', 'x')));
  reset role;
  select anchor_start into v_s from post_comment_threads where id = v_t_b;
  assert v_s = 0, 'thread of another post must not be re-anchored';

  raise notice 'PASS 98.2/98.3 save_ig_caption atomic update and isolation';
end $$;
rollback;

-- =====================================================================
-- 4. Grants
-- =====================================================================
begin;
do $$
begin
  assert not has_function_privilege('anon', 'public.save_ig_caption(bigint,text,jsonb)', 'execute'),
    'anon must not execute save_ig_caption';
  assert has_function_privilege('authenticated', 'public.save_ig_caption(bigint,text,jsonb)', 'execute'),
    'authenticated must execute save_ig_caption';
  raise notice 'PASS 98.4 grants';
end $$;
rollback;
```

- [ ] **Step 3: Run the suite to verify it fails**

Run: `supabase start` (if not running; local Supabase runs on colima, see memory) then `bash scripts/test-entitlements.sh 2>&1 | grep -A3 98_`
Expected: `98_caption_comment_anchors.sql` FAIL (column `field` does not exist).

- [ ] **Step 4: Write the migration**

Create `supabase/migrations/20260925000016_post_comment_threads_caption_anchors.sql`:

```sql
-- Comment threads on the Instagram caption (workflow_posts.ig_caption).
-- The caption is a plain textarea, so unlike TipTap threads (anchored by a mark
-- inside conteudo) these carry their anchor in the row: UTF-16 code-unit offsets.

ALTER TABLE public.post_comment_threads
  ADD COLUMN field text NOT NULL DEFAULT 'conteudo'
    CHECK (field IN ('conteudo', 'ig_caption')),
  ADD COLUMN anchor_start int,
  ADD COLUMN anchor_end int,
  ADD COLUMN orphaned boolean NOT NULL DEFAULT false,
  ADD CONSTRAINT post_comment_threads_anchor_chk CHECK (
    (field = 'conteudo' AND anchor_start IS NULL AND anchor_end IS NULL AND NOT orphaned)
    OR (field = 'ig_caption' AND (
      orphaned
      OR (anchor_start IS NOT NULL AND anchor_end IS NOT NULL
          AND anchor_start >= 0 AND anchor_end > anchor_start)
    ))
  );

-- Saves the caption and re-anchors its comment threads in ONE transaction, so the
-- text and the offsets stored in the DB can never disagree. SECURITY INVOKER:
-- workflow_posts / post_comment_threads RLS (conta_id) applies to the caller.
-- p_anchors: [{ id, anchor_start, anchor_end, orphaned, quoted_text? }, ...].
-- Only threads of THIS post with field = 'ig_caption' are touched.
CREATE OR REPLACE FUNCTION public.save_ig_caption(
  p_post_id bigint,
  p_caption text,
  p_anchors jsonb
) RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  a jsonb;
BEGIN
  UPDATE workflow_posts SET ig_caption = p_caption WHERE id = p_post_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'post_not_found' USING ERRCODE = 'P0002';
  END IF;

  FOR a IN SELECT * FROM jsonb_array_elements(COALESCE(p_anchors, '[]'::jsonb)) LOOP
    UPDATE post_comment_threads SET
      anchor_start = CASE WHEN (a->>'orphaned')::boolean THEN NULL ELSE (a->>'anchor_start')::int END,
      anchor_end   = CASE WHEN (a->>'orphaned')::boolean THEN NULL ELSE (a->>'anchor_end')::int END,
      orphaned     = (a->>'orphaned')::boolean,
      quoted_text  = COALESCE(a->>'quoted_text', quoted_text)
    WHERE id = (a->>'id')::bigint
      AND post_id = p_post_id
      AND field = 'ig_caption';
  END LOOP;
END;
$$;

-- Name every role: REVOKE FROM PUBLIC alone does not strip anon/authenticated
-- on hosted Supabase (default privileges grant them directly).
REVOKE ALL ON FUNCTION public.save_ig_caption(bigint, text, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_ig_caption(bigint, text, jsonb) TO authenticated, service_role;
```

- [ ] **Step 5: Apply and run the suite to verify it passes**

Run: `npx supabase db reset` (or `npx supabase migration up`), then `bash scripts/test-entitlements.sh 2>&1 | grep -B1 -A3 98_`
Expected: `98_caption_comment_anchors.sql` PASS with notices `PASS 98.1` through `PASS 98.4`. If the local DB is unavailable (needs Docker/colima), note it and rely on CI's `entitlement-tests` job; do not skip writing the suite.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20260925000016_post_comment_threads_caption_anchors.sql supabase/tests/entitlements/98_caption_comment_anchors.sql
git commit -m "feat(db): caption comment thread anchors and save_ig_caption RPC

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 2: Pure anchor logic (`captionAnchors.ts`)

**Files:**
- Create: `apps/crm/src/pages/entregas/utils/captionAnchors.ts`
- Test: `apps/crm/src/pages/entregas/utils/__tests__/captionAnchors.test.ts`

**Interfaces:**
- Consumes: `CommentThread`, `CaptionAnchorPatch` from `@/store` (Task 3 adds the new fields; until then this task's tests define local thread fixtures and cast, and Task 3 makes types line up. To avoid a typecheck gap, **do Task 3 Steps 1-3 first if `tsc` complains**; otherwise proceed in order).
- Produces: everything under `// utils/captionAnchors.ts` in the Interfaces block above.

- [ ] **Step 1: Write the failing tests**

Create `apps/crm/src/pages/entregas/utils/__tests__/captionAnchors.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  anchorsFromThreads,
  buildMirrorSegments,
  patchesFromAnchors,
  pickThreadId,
  remapAnchors,
  validateAnchors,
  type CaptionAnchor,
} from '../captionAnchors';

const a = (id: number, start: number, end: number, text: string): CaptionAnchor => ({
  id,
  start,
  end,
  quotedText: text.slice(start, end),
  orphaned: false,
});

describe('remapAnchors', () => {
  const old = 'hello brave new world';
  // "brave" = [6, 11)
  const anchors = [a(1, 6, 11, old)];

  it('returns the same anchors when the text is unchanged', () => {
    expect(remapAnchors(old, old, anchors)).toBe(anchors);
  });

  it('leaves a range untouched for an edit after it', () => {
    const next = old + '!!';
    expect(remapAnchors(old, next, anchors)[0]).toMatchObject({ start: 6, end: 11 });
  });

  it('shifts a range for an insertion before it', () => {
    const next = 'oh hello brave new world';
    const [r] = remapAnchors(old, next, anchors);
    expect(r).toMatchObject({ start: 9, end: 14, quotedText: 'brave', orphaned: false });
  });

  it('shifts (does not grow) for an insertion exactly at the start', () => {
    const next = 'hello XXbrave new world';
    const [r] = remapAnchors(old, next, anchors);
    expect(r).toMatchObject({ start: 8, end: 13, quotedText: 'brave' });
  });

  it('grows for an insertion exactly at the end', () => {
    const next = 'hello braveXX new world';
    const [r] = remapAnchors(old, next, anchors);
    expect(r).toMatchObject({ start: 6, end: 13, quotedText: 'braveXX' });
  });

  it('grows for an insertion inside and refreshes quotedText', () => {
    const next = 'hello bra--ve new world';
    const [r] = remapAnchors(old, next, anchors);
    expect(r).toMatchObject({ start: 6, end: 13, quotedText: 'bra--ve' });
  });

  it('shifts left for a deletion before it', () => {
    const next = 'brave new world';
    const [r] = remapAnchors(old, next, anchors);
    expect(r).toMatchObject({ start: 0, end: 5, quotedText: 'brave' });
  });

  it('clamps when the tail is deleted', () => {
    const next = 'hello bra new world';
    const [r] = remapAnchors(old, next, anchors);
    expect(r).toMatchObject({ start: 6, end: 9, quotedText: 'bra', orphaned: false });
  });

  it('clamps when the head is deleted', () => {
    const next = 'hello ve new world';
    const [r] = remapAnchors(old, next, anchors);
    expect(r).toMatchObject({ start: 6, end: 8, quotedText: 've', orphaned: false });
  });

  it('orphans a range whose whole passage is deleted', () => {
    const next = 'hello  new world';
    const [r] = remapAnchors(old, next, anchors);
    expect(r.orphaned).toBe(true);
    expect(r.quotedText).toBe('brave');
  });

  it('orphans a range whose whole passage is replaced', () => {
    const next = 'hello NICE new world';
    const [r] = remapAnchors(old, next, anchors);
    expect(r.orphaned).toBe(true);
  });

  it('never revives an orphaned anchor', () => {
    const orphan: CaptionAnchor = { ...anchors[0], orphaned: true };
    expect(remapAnchors(old, 'hello brave new world!', [orphan])[0].orphaned).toBe(true);
  });

  it('treats "aa" -> "aaa" as an insertion, not a delete', () => {
    const [r] = remapAnchors('aa', 'aaa', [a(1, 0, 2, 'aa')]);
    expect(r.orphaned).toBe(false);
    expect(r).toMatchObject({ start: 0, end: 3 });
  });

  it('does not split a surrogate pair when one emoji replaces another', () => {
    const before = 'x \u{1F600} y';
    const after = 'x \u{1F603} y';
    const [r] = remapAnchors(before, after, [a(1, 2, 4, before)]);
    expect(r.orphaned).toBe(true); // the whole emoji was replaced
    const partial = remapAnchors(before, 'x \u{1F600}\u{1F603} y', [a(1, 2, 4, before)])[0];
    expect(partial.quotedText).toBe(partial.quotedText.normalize()); // no lone surrogate
    expect(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/.test(partial.quotedText)).toBe(false);
  });
});

describe('validateAnchors', () => {
  const text = 'hello brave new world';

  it('keeps anchors whose slice still matches', () => {
    const list = [a(1, 6, 11, text)];
    expect(validateAnchors(text, list)).toEqual(list);
  });

  it('re-anchors on a unique match of quotedText', () => {
    const list = [{ ...a(1, 6, 11, text), start: 0, end: 5 }]; // stale offsets
    expect(validateAnchors(text, list)[0]).toMatchObject({ start: 6, end: 11, orphaned: false });
  });

  it('orphans when quotedText is missing', () => {
    const list = [{ ...a(1, 6, 11, text), quotedText: 'gone' }];
    expect(validateAnchors(text, list)[0].orphaned).toBe(true);
  });

  it('orphans when quotedText is ambiguous', () => {
    const t = 'la la land';
    const list = [{ id: 1, start: 0, end: 2, quotedText: 'zz', orphaned: false }];
    expect(validateAnchors(t, list)[0].orphaned).toBe(true);
    const dup = [{ id: 2, start: 5, end: 7, quotedText: 'la', orphaned: false }]; // slice(5,7)="la"? "la la land": 5..7 = "la"
    expect(validateAnchors(t, dup)[0].orphaned).toBe(false); // slice matches, so kept
    const stale = [{ id: 3, start: 0, end: 3, quotedText: 'la', orphaned: false }]; // slice "la " != "la", "la" occurs 3x
    expect(validateAnchors(t, stale)[0].orphaned).toBe(true);
  });

  it('orphans out-of-range offsets', () => {
    const list = [{ id: 1, start: 50, end: 60, quotedText: 'brave', orphaned: false }];
    expect(validateAnchors(text, list)[0]).toMatchObject({ start: 6, end: 11 });
  });

  it('skips already orphaned anchors', () => {
    const list = [{ id: 1, start: 0, end: 0, quotedText: 'brave', orphaned: true }];
    expect(validateAnchors(text, list)[0].orphaned).toBe(true);
  });
});

describe('anchorsFromThreads / patchesFromAnchors', () => {
  const base = {
    post_id: 1,
    conta_id: 'c',
    status: 'active' as const,
    created_by: 'u',
    resolved_by: null,
    created_at: '',
    resolved_at: null,
  };

  it('keeps only caption threads and maps DB columns', () => {
    const anchors = anchorsFromThreads([
      { ...base, id: 1, quoted_text: 'x', field: 'conteudo', anchor_start: null, anchor_end: null, orphaned: false },
      { ...base, id: 2, quoted_text: 'brave', field: 'ig_caption', anchor_start: 6, anchor_end: 11, orphaned: false },
      { ...base, id: 3, quoted_text: 'gone', field: 'ig_caption', anchor_start: null, anchor_end: null, orphaned: true },
    ]);
    expect(anchors).toEqual([
      { id: 2, start: 6, end: 11, quotedText: 'brave', orphaned: false },
      { id: 3, start: 0, end: 0, quotedText: 'gone', orphaned: true },
    ]);
  });

  it('builds RPC patches; orphans carry null offsets and no quoted_text', () => {
    expect(
      patchesFromAnchors([
        { id: 2, start: 6, end: 11, quotedText: 'brave', orphaned: false },
        { id: 3, start: 0, end: 0, quotedText: 'gone', orphaned: true },
      ]),
    ).toEqual([
      { id: 2, anchor_start: 6, anchor_end: 11, orphaned: false, quoted_text: 'brave' },
      { id: 3, anchor_start: null, anchor_end: null, orphaned: true },
    ]);
  });
});

describe('buildMirrorSegments / pickThreadId', () => {
  it('splits text around ranges', () => {
    expect(buildMirrorSegments('hello world', [{ id: 1, start: 6, end: 11 }])).toEqual([
      { text: 'hello ', threadIds: [] },
      { text: 'world', threadIds: [1] },
    ]);
  });

  it('unions overlapping ranges into per-interval id lists', () => {
    expect(
      buildMirrorSegments('abcdef', [
        { id: 1, start: 0, end: 4 },
        { id: 2, start: 2, end: 6 },
      ]),
    ).toEqual([
      { text: 'ab', threadIds: [1] },
      { text: 'cd', threadIds: [1, 2] },
      { text: 'ef', threadIds: [2] },
    ]);
  });

  it('returns no segments for empty text and clamps out-of-range ends', () => {
    expect(buildMirrorSegments('', [])).toEqual([]);
    expect(buildMirrorSegments('abc', [{ id: 1, start: 1, end: 99 }])).toEqual([
      { text: 'a', threadIds: [] },
      { text: 'bc', threadIds: [1] },
    ]);
  });

  it('picks the most recent (highest id) thread among hits', () => {
    expect(pickThreadId([[1, 2], [2, 5]])).toBe(5);
    expect(pickThreadId([])).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run apps/crm/src/pages/entregas/utils/__tests__/captionAnchors.test.ts`
Expected: FAIL ("Cannot find module '../captionAnchors'").

- [ ] **Step 3: Write the implementation**

Create `apps/crm/src/pages/entregas/utils/captionAnchors.ts`:

```ts
import type { CaptionAnchorPatch, CommentThread } from '@/store';

/** A comment anchor on the Instagram caption. Offsets are UTF-16 code-unit indices. */
export interface CaptionAnchor {
  id: number;
  start: number;
  end: number;
  quotedText: string;
  orphaned: boolean;
}

export interface MirrorSegment {
  text: string;
  threadIds: number[];
}

const isHighSurrogate = (c: string | undefined) => !!c && c >= '\uD800' && c <= '\uDBFF';
const isLowSurrogate = (c: string | undefined) => !!c && c >= '\uDC00' && c <= '\uDFFF';

export function anchorsFromThreads(threads: CommentThread[]): CaptionAnchor[] {
  return threads
    .filter((t) => t.field === 'ig_caption')
    .map((t) => ({
      id: t.id,
      start: t.anchor_start ?? 0,
      end: t.anchor_end ?? 0,
      quotedText: t.quoted_text,
      orphaned: t.orphaned || t.anchor_start == null || t.anchor_end == null,
    }));
}

export function patchesFromAnchors(anchors: CaptionAnchor[]): CaptionAnchorPatch[] {
  return anchors.map((a) =>
    a.orphaned
      ? { id: a.id, anchor_start: null, anchor_end: null, orphaned: true }
      : {
          id: a.id,
          anchor_start: a.start,
          anchor_end: a.end,
          orphaned: false,
          quoted_text: a.quotedText,
        },
  );
}

/**
 * Common prefix / suffix diff. The suffix is bounded by what the prefix left over
 * (so "aa" -> "aaa" is an insertion), and both edges are backed off so an edit never
 * splits a surrogate pair.
 */
function diffWindow(oldText: string, newText: string) {
  const max = Math.min(oldText.length, newText.length);
  let prefix = 0;
  while (prefix < max && oldText[prefix] === newText[prefix]) prefix++;
  if (prefix > 0 && isHighSurrogate(oldText[prefix - 1])) prefix--;

  const maxSuffix = max - prefix;
  let suffix = 0;
  while (
    suffix < maxSuffix &&
    oldText[oldText.length - 1 - suffix] === newText[newText.length - 1 - suffix]
  ) {
    suffix++;
  }
  if (suffix > 0 && isLowSurrogate(oldText[oldText.length - suffix])) suffix--;

  return { p: prefix, oldEnd: oldText.length - suffix, newEnd: newText.length - suffix };
}

/**
 * Moves anchors through a single text edit (used on every keystroke).
 * Boundaries match the content editor's mark: an insertion exactly at `start` shifts
 * the range, an insertion exactly at `end` grows it. A range whose whole passage is
 * removed or replaced is orphaned; orphaning is terminal.
 */
export function remapAnchors(
  oldText: string,
  newText: string,
  anchors: CaptionAnchor[],
): CaptionAnchor[] {
  if (oldText === newText) return anchors;
  const { p, oldEnd, newEnd } = diffWindow(oldText, newText);
  const d = newEnd - oldEnd;
  const isInsertion = oldEnd === p;

  return anchors.map((a) => {
    if (a.orphaned) return a;
    let start = a.start;
    let end = a.end;

    if (isInsertion) {
      if (p <= a.start) {
        start += d;
        end += d;
      } else if (p <= a.end) {
        end += d;
      }
    } else if (oldEnd <= a.start) {
      start += d;
      end += d;
    } else if (p < a.end) {
      const left = Math.max(0, p - a.start);
      const right = Math.max(0, a.end - oldEnd);
      if (left === 0 && right === 0) return { ...a, orphaned: true };
      start = left > 0 ? a.start : newEnd;
      end = right > 0 ? a.end + d : p;
      if (end <= start) return { ...a, orphaned: true };
    }
    return { ...a, start, end, quotedText: newText.slice(start, end) };
  });
}

/**
 * For text that arrived without being remapped edit by edit (drawer open, another
 * writer such as MCP `update_post`, an accepted Hub suggestion): keep an anchor whose
 * slice still equals its quote, re-anchor on a unique occurrence of the quote,
 * otherwise orphan it.
 */
export function validateAnchors(text: string, anchors: CaptionAnchor[]): CaptionAnchor[] {
  return anchors.map((a) => {
    if (a.orphaned) return a;
    if (
      a.start >= 0 &&
      a.end > a.start &&
      a.end <= text.length &&
      text.slice(a.start, a.end) === a.quotedText
    ) {
      return a;
    }
    const first = a.quotedText ? text.indexOf(a.quotedText) : -1;
    if (first !== -1 && text.indexOf(a.quotedText, first + 1) === -1) {
      return { ...a, start: first, end: first + a.quotedText.length };
    }
    return { ...a, orphaned: true };
  });
}

/** Splits `text` at every range boundary; each segment lists the threads covering it. */
export function buildMirrorSegments(
  text: string,
  ranges: { id: number; start: number; end: number }[],
): MirrorSegment[] {
  const clamp = (n: number) => Math.min(Math.max(n, 0), text.length);
  const points = new Set<number>([0, text.length]);
  for (const r of ranges) {
    points.add(clamp(r.start));
    points.add(clamp(r.end));
  }
  const sorted = [...points].sort((x, y) => x - y);
  const segments: MirrorSegment[] = [];
  for (let i = 0; i < sorted.length - 1; i++) {
    const from = sorted[i];
    const to = sorted[i + 1];
    if (to <= from) continue;
    const threadIds = ranges
      .filter((r) => clamp(r.start) <= from && clamp(r.end) >= to)
      .map((r) => r.id);
    segments.push({ text: text.slice(from, to), threadIds });
  }
  return segments;
}

/** `hits` = the thread-id list of every highlight under the pointer. Newest (highest id) wins. */
export function pickThreadId(hits: number[][]): number | null {
  const ids = hits.flat();
  return ids.length ? Math.max(...ids) : null;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run apps/crm/src/pages/entregas/utils/__tests__/captionAnchors.test.ts`
Expected: PASS. If the surrogate test fails, fix `diffWindow`, not the test (the invariant is "no lone surrogate in `quotedText`").

- [ ] **Step 5: Commit**

```bash
git add apps/crm/src/pages/entregas/utils
git commit -m "feat(entregas): pure caption anchor remap/validate logic

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 3: Store layer (types, anchored thread creation, `saveIgCaption`)

**Files:**
- Modify: `apps/crm/src/store/comments.ts:11-30` (types), `:57-90` (`createCommentThread`), append `saveIgCaption`
- Modify: test fixtures that build `CommentThread`/`CommentThreadWithComments` (found by `tsc`, see Step 6)
- Test: `apps/crm/src/__tests__/store.comments.test.ts`

**Interfaces:**
- Produces: `CommentAnchor`, `CaptionAnchorPatch`, new `CommentThread` fields, `createCommentThread(..., anchor?)`, `saveIgCaption`.

- [ ] **Step 1: Write the failing tests**

Add inside `describe('comment thread store', ...)` in `apps/crm/src/__tests__/store.comments.test.ts` (after the `createCommentThread inserts thread and first comment` test):

```ts
  it('createCommentThread inserts caption anchor columns when an anchor is given', async () => {
    const thread = {
      id: 6, post_id: 10, conta_id: 'conta-1', quoted_text: 'brave', status: 'active',
      created_by: 'user-1', resolved_by: null, created_at: '2026-04-23T00:00:00Z', resolved_at: null,
      field: 'ig_caption', anchor_start: 6, anchor_end: 11, orphaned: false,
    };
    mockedSupabase.__queueSupabaseResult('post_comment_threads', 'insert', { data: thread, error: null });
    mockedSupabase.__queueSupabaseResult('post_comments', 'insert', {
      data: { id: 9, thread_id: 6, author_id: 'user-1', content: 'x', created_at: '', updated_at: null },
      error: null,
    });
    await store.createCommentThread(10, 'brave', 'x', { field: 'ig_caption', start: 6, end: 11 });
    expect(getCalls('post_comment_threads', 'insert').at(-1)!.payload).toEqual({
      post_id: 10,
      conta_id: 'conta-1',
      quoted_text: 'brave',
      created_by: 'user-1',
      field: 'ig_caption',
      anchor_start: 6,
      anchor_end: 11,
    });
  });

  it('createCommentThread without an anchor keeps the legacy payload', async () => {
    mockedSupabase.__queueSupabaseResult('post_comment_threads', 'insert', {
      data: { id: 7, post_id: 10, quoted_text: 'q' },
      error: null,
    });
    mockedSupabase.__queueSupabaseResult('post_comments', 'insert', {
      data: { id: 10, thread_id: 7, author_id: 'user-1', content: 'x', created_at: '', updated_at: null },
      error: null,
    });
    await store.createCommentThread(10, 'q', 'x');
    expect(getCalls('post_comment_threads', 'insert').at(-1)!.payload).toEqual({
      post_id: 10,
      conta_id: 'conta-1',
      quoted_text: 'q',
      created_by: 'user-1',
    });
  });

  it('saveIgCaption calls the save_ig_caption RPC with the caption and anchors', async () => {
    mockedSupabase.__queueSupabaseRpc('save_ig_caption', { data: null, error: null });
    const anchors = [
      { id: 6, anchor_start: 9, anchor_end: 14, orphaned: false, quoted_text: 'brave' },
    ];
    await store.saveIgCaption(10, 'oh hello brave', anchors);
    expect(getCalls('rpc:save_ig_caption', 'rpc').at(-1)!.payload).toEqual({
      p_post_id: 10,
      p_caption: 'oh hello brave',
      p_anchors: anchors,
    });
  });

  it('saveIgCaption throws when the RPC errors', async () => {
    mockedSupabase.__queueSupabaseRpc('save_ig_caption', { data: null, error: { message: 'boom' } });
    await expect(store.saveIgCaption(10, 'x', [])).rejects.toBeTruthy();
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run apps/crm/src/__tests__/store.comments.test.ts`
Expected: FAIL (`saveIgCaption is not a function`; anchor payload missing).

- [ ] **Step 3: Implement**

In `apps/crm/src/store/comments.ts`, replace the `CommentThread` interface and extend `createCommentThread`:

```ts
export interface CommentThread {
  id: number;
  post_id: number;
  conta_id: string;
  quoted_text: string;
  status: 'active' | 'resolved';
  created_by: string;
  resolved_by: string | null;
  created_at: string;
  resolved_at: string | null;
  /** 'conteudo' = TipTap mark inside conteudo; 'ig_caption' = offsets into ig_caption. */
  field: 'conteudo' | 'ig_caption';
  /** UTF-16 code-unit offsets into ig_caption. Null for 'conteudo' threads and orphans. */
  anchor_start: number | null;
  anchor_end: number | null;
  /** Caption threads only: the anchored passage no longer exists in the caption. */
  orphaned: boolean;
}

export interface CommentAnchor {
  field: 'ig_caption';
  start: number;
  end: number;
}

/** One entry of save_ig_caption's `p_anchors`. Orphans carry null offsets and no quoted_text. */
export interface CaptionAnchorPatch {
  id: number;
  anchor_start: number | null;
  anchor_end: number | null;
  orphaned: boolean;
  quoted_text?: string;
}
```

Change the signature and insert payload of `createCommentThread`:

```ts
export async function createCommentThread(
  postId: number,
  quotedText: string,
  firstComment: string,
  anchor?: CommentAnchor,
): Promise<CommentThreadWithComments> {
  const profile = await getCurrentProfile();
  if (!profile) throw new Error('No profile');

  const { data: thread, error: threadErr } = await supabase
    .from('post_comment_threads')
    .insert({
      post_id: postId,
      conta_id: profile.conta_id,
      quoted_text: quotedText,
      created_by: profile.id,
      ...(anchor
        ? { field: anchor.field, anchor_start: anchor.start, anchor_end: anchor.end }
        : {}),
    })
    .select()
    .single();
```
(leave the rest of the function unchanged.) Append at the end of the file:

```ts
/**
 * Saves the Instagram caption AND re-anchors its comment threads in one
 * transaction (RPC), so the stored offsets can never describe text the DB doesn't hold.
 */
export async function saveIgCaption(
  postId: number,
  caption: string,
  anchors: CaptionAnchorPatch[],
): Promise<void> {
  const { error } = await supabase.rpc('save_ig_caption', {
    p_post_id: postId,
    p_caption: caption,
    p_anchors: anchors,
  });
  if (error) throw error;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run apps/crm/src/__tests__/store.comments.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck and fix fixtures**

Run: `npx tsc -p apps/crm/tsconfig.json --noEmit`
Expected: errors in test files that build `CommentThread`/`CommentThreadWithComments` literals (missing `field`, `anchor_start`, `anchor_end`, `orphaned`). For each, add `field: 'conteudo', anchor_start: null, anchor_end: null, orphaned: false` to the literal (find them with `grep -rln "post_comments:" apps/crm/src --include='*.test.ts*'`). Re-run until it exits 0. Also run `npx tsc -p apps/hub/tsconfig.json --noEmit` and `npx tsc -p apps/admin/tsconfig.json --noEmit` (they import CRM store types in places).

- [ ] **Step 6: Commit**

```bash
git add apps/crm/src
git commit -m "feat(store): anchored comment threads and saveIgCaption RPC wrapper

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 4: `useCaptionDraft` hook

**Files:**
- Create: `apps/crm/src/pages/entregas/components/useCaptionDraft.ts`
- Test: `apps/crm/src/pages/entregas/components/__tests__/useCaptionDraft.test.tsx`

**Interfaces:**
- Consumes: `anchorsFromThreads`, `patchesFromAnchors`, `remapAnchors`, `validateAnchors`, `CaptionAnchor` (Task 2); `CaptionAnchorPatch`, `CommentThread` (Task 3); `useUnsavedWork` from `@mesaas/app-lifecycle`.
- Produces: `useCaptionDraft`, `MAX_CAPTION_CHARS`.

Behavior contract (from the spec):
- `text`/`anchors` come from props (validated) until the user types; then from a local **draft**.
- While a draft exists, inbound `value`/`threads` props never overwrite it.
- Typing back to exactly the persisted `value` drops the draft (anchors reset to the persisted ones, no save).
- Saves are debounced 1.5s, serialized (one in flight), and read the draft **when they fire**. `flush()` saves now and resolves `true`/`false`.
- The draft is dropped once props catch up (`value === draft.text`) and nothing is pending.

- [ ] **Step 1: Write the failing tests**

Create `apps/crm/src/pages/entregas/components/__tests__/useCaptionDraft.test.tsx`:

```tsx
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CommentThread } from '@/store';
import { useCaptionDraft } from '../useCaptionDraft';

vi.mock('@mesaas/app-lifecycle', () => ({ useUnsavedWork: vi.fn() }));

const thread = (over: Partial<CommentThread> = {}): CommentThread => ({
  id: 1,
  post_id: 10,
  conta_id: 'c',
  quoted_text: 'brave',
  status: 'active',
  created_by: 'u',
  resolved_by: null,
  created_at: '',
  resolved_at: null,
  field: 'ig_caption',
  anchor_start: 6,
  anchor_end: 11,
  orphaned: false,
  ...over,
});

describe('useCaptionDraft', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('exposes the (validated) prop value and anchors before any edit', () => {
    const { result } = renderHook(() =>
      useCaptionDraft({ value: 'hello brave world', threads: [thread()], onSave: vi.fn() }),
    );
    expect(result.current.text).toBe('hello brave world');
    expect(result.current.anchors).toEqual([
      { id: 1, start: 6, end: 11, quotedText: 'brave', orphaned: false },
    ]);
  });

  it('remaps anchors while typing and saves once after the debounce', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() =>
      useCaptionDraft({ value: 'hello brave world', threads: [thread()], onSave }),
    );
    act(() => result.current.change('oh hello brave world'));
    expect(result.current.text).toBe('oh hello brave world');
    expect(result.current.anchors[0]).toMatchObject({ start: 9, end: 14 });
    expect(onSave).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1500);
    });
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave).toHaveBeenCalledWith('oh hello brave world', [
      { id: 1, anchor_start: 9, anchor_end: 14, orphaned: false, quoted_text: 'brave' },
    ]);
  });

  it('saves the latest draft, not the keystroke that armed the timer', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() =>
      useCaptionDraft({ value: 'hello', threads: [], onSave }),
    );
    act(() => result.current.change('hello a'));
    act(() => result.current.change('hello ab'));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1500);
    });
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave.mock.calls[0][0]).toBe('hello ab');
  });

  it('ignores inbound props while a draft is pending', () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    const { result, rerender } = renderHook(
      (p: { value: string }) => useCaptionDraft({ value: p.value, threads: [], onSave }),
      { initialProps: { value: 'hello' } },
    );
    act(() => result.current.change('hello there'));
    rerender({ value: 'server changed' });
    expect(result.current.text).toBe('hello there');
  });

  it('drops the draft and skips the save when typed back to the persisted text', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() =>
      useCaptionDraft({ value: 'hello brave world', threads: [thread()], onSave }),
    );
    act(() => result.current.change('hello  world')); // delete "brave" -> orphaned locally
    expect(result.current.anchors[0].orphaned).toBe(true);
    act(() => result.current.change('hello brave world')); // undo
    expect(result.current.anchors[0]).toMatchObject({ start: 6, end: 11, orphaned: false });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    expect(onSave).not.toHaveBeenCalled();
  });

  it('rejects text over 2200 chars', () => {
    const { result } = renderHook(() =>
      useCaptionDraft({ value: 'a', threads: [], onSave: vi.fn() }),
    );
    act(() => result.current.change('x'.repeat(2201)));
    expect(result.current.text).toBe('a');
  });

  it('flush saves immediately and resolves true; false when the save fails', async () => {
    const onSave = vi.fn().mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('x'));
    const { result } = renderHook(() =>
      useCaptionDraft({ value: 'hello', threads: [], onSave }),
    );
    act(() => result.current.change('hello 1'));
    let ok = false;
    await act(async () => {
      ok = await result.current.flush();
    });
    expect(ok).toBe(true);
    expect(onSave).toHaveBeenCalledTimes(1);

    act(() => result.current.change('hello 12'));
    await act(async () => {
      ok = await result.current.flush();
    });
    expect(ok).toBe(false);
    expect(result.current.text).toBe('hello 12'); // draft kept for the next attempt
  });

  it('serializes saves: a second save waits for the first', async () => {
    let release!: () => void;
    const onSave = vi
      .fn()
      .mockImplementationOnce(() => new Promise<void>((r) => (release = r)))
      .mockResolvedValue(undefined);
    const { result } = renderHook(() =>
      useCaptionDraft({ value: 'a', threads: [], onSave }),
    );
    act(() => result.current.change('ab'));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1500);
    });
    act(() => result.current.change('abc'));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1500);
    });
    expect(onSave).toHaveBeenCalledTimes(1); // second is queued behind the first
    await act(async () => {
      release();
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(onSave).toHaveBeenCalledTimes(2);
    expect(onSave.mock.calls[1][0]).toBe('abc');
  });

  it('adopts the server value again once props catch up with a saved draft', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    const { result, rerender } = renderHook(
      (p: { value: string }) => useCaptionDraft({ value: p.value, threads: [], onSave }),
      { initialProps: { value: 'hello' } },
    );
    act(() => result.current.change('hello!'));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1500);
    });
    rerender({ value: 'hello!' });
    rerender({ value: 'hello! (edited elsewhere)' });
    expect(result.current.text).toBe('hello! (edited elsewhere)');
  });

  it('getText returns the draft text, else the prop value', () => {
    const { result } = renderHook(() =>
      useCaptionDraft({ value: 'hello', threads: [], onSave: vi.fn() }),
    );
    expect(result.current.getText()).toBe('hello');
    act(() => result.current.change('hello!'));
    expect(result.current.getText()).toBe('hello!');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run apps/crm/src/pages/entregas/components/__tests__/useCaptionDraft.test.tsx`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement the hook**

Create `apps/crm/src/pages/entregas/components/useCaptionDraft.ts`:

```ts
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useUnsavedWork } from '@mesaas/app-lifecycle';
import type { CaptionAnchorPatch, CommentThread } from '@/store';
import {
  anchorsFromThreads,
  patchesFromAnchors,
  remapAnchors,
  validateAnchors,
  type CaptionAnchor,
} from '../utils/captionAnchors';

export const MAX_CAPTION_CHARS = 2200;
const SAVE_DEBOUNCE_MS = 1500;

interface Draft {
  text: string;
  anchors: CaptionAnchor[];
}

interface Args {
  value: string;
  threads: CommentThread[];
  onSave: (text: string, anchors: CaptionAnchorPatch[]) => Promise<void>;
}

/**
 * Local edit state for the Instagram caption and its comment anchors.
 *
 * Until the user types, text/anchors come from props (anchors validated against the
 * text). Typing creates a draft that shadows props; inbound props never overwrite it
 * while it exists. Saves are debounced, serialized, read the draft when they RUN, and
 * commit text + anchors together through `onSave`.
 */
export function useCaptionDraft({ value, threads, onSave }: Args) {
  const serverAnchors = useMemo(
    () => validateAnchors(value, anchorsFromThreads(threads)),
    [value, threads],
  );

  const [draft, setDraft] = useState<Draft | null>(null);
  const [, setTick] = useState(0);
  const draftRef = useRef<Draft | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const inFlightRef = useRef(false);
  const chainRef = useRef<Promise<unknown>>(Promise.resolve());
  const latest = useRef({ value, serverAnchors, onSave });

  useEffect(() => {
    latest.current = { value, serverAnchors, onSave };
  });

  const setDraftBoth = useCallback((next: Draft | null) => {
    draftRef.current = next;
    setDraft(next);
  }, []);

  const runSave = useCallback(async (): Promise<boolean> => {
    const d = draftRef.current;
    if (!d) return true;
    inFlightRef.current = true;
    try {
      await latest.current.onSave(d.text, patchesFromAnchors(d.anchors));
      return true;
    } catch {
      return false;
    } finally {
      inFlightRef.current = false;
      setTick((t) => t + 1);
    }
  }, []);

  const enqueueSave = useCallback((): Promise<boolean> => {
    const next = chainRef.current.then(runSave);
    chainRef.current = next;
    return next;
  }, [runSave]);

  const change = useCallback(
    (next: string) => {
      if (next.length > MAX_CAPTION_CHARS) return;
      const persisted = latest.current.value;

      if (timerRef.current !== undefined) {
        clearTimeout(timerRef.current);
        timerRef.current = undefined;
      }

      // Back to exactly what is persisted (e.g. an undo inside the debounce window):
      // nothing to save, and anchors reset to the persisted ones.
      if (next === persisted) {
        setDraftBoth(null);
        return;
      }

      const prev = draftRef.current ?? {
        text: persisted,
        anchors: latest.current.serverAnchors,
      };
      setDraftBoth({ text: next, anchors: remapAnchors(prev.text, next, prev.anchors) });
      timerRef.current = setTimeout(() => {
        timerRef.current = undefined;
        void enqueueSave();
      }, SAVE_DEBOUNCE_MS);
    },
    [enqueueSave, setDraftBoth],
  );

  const flush = useCallback((): Promise<boolean> => {
    if (timerRef.current !== undefined) {
      clearTimeout(timerRef.current);
      timerRef.current = undefined;
    }
    return enqueueSave();
  }, [enqueueSave]);

  const getText = useCallback(() => draftRef.current?.text ?? latest.current.value, []);

  // Props caught up with a saved draft: go back to reading from props.
  useEffect(() => {
    if (
      draft &&
      value === draft.text &&
      timerRef.current === undefined &&
      !inFlightRef.current
    ) {
      setDraftBoth(null);
    }
  });

  useUnsavedWork(draft !== null);

  return {
    text: draft?.text ?? value,
    anchors: draft?.anchors ?? serverAnchors,
    change,
    flush,
    getText,
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run apps/crm/src/pages/entregas/components/__tests__/useCaptionDraft.test.tsx`
Expected: PASS. The test "adopts the server value again once props catch up" documents the known limit: a draft that was saved and then caught up releases; if props never equal the saved text the draft stays (acceptable, see spec Risks).

- [ ] **Step 5: Commit**

```bash
git add apps/crm/src/pages/entregas/components/useCaptionDraft.ts apps/crm/src/pages/entregas/components/__tests__/useCaptionDraft.test.tsx
git commit -m "feat(entregas): useCaptionDraft hook (debounced, serialized, anchor-aware)

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 5: Extract `AddCommentPopover` from `PostEditor`

**Files:**
- Create: `apps/crm/src/pages/entregas/components/AddCommentPopover.tsx`
- Modify: `apps/crm/src/pages/entregas/components/PostEditor.tsx` (state at `:86-97`, click-outside `:295-299`, `handleAddComment` `:377-392`, JSX `:756-795`)
- Test: `apps/crm/src/pages/entregas/components/__tests__/AddCommentPopover.test.tsx`

**Interfaces:**
- Produces:
```ts
export interface AddCommentPopoverProps {
  position: { top: number; left: number };
  onSubmit: (text: string) => Promise<void>;
  onClose: () => void;
  /** Elements whose mousedown must not count as "outside" (the trigger button). */
  ignoreRefs?: React.RefObject<HTMLElement | null>[];
}
export function AddCommentPopover(props: AddCommentPopoverProps): React.ReactPortal;
```
It owns the text state, the submitting flag, Enter/Escape handling, and click-outside close. It renders the same markup/classes as today's inline JSX (`comment-add-popover`, `comment-add-label`, `comment-add-input`, `comment-add-submit`) so no CSS changes.

- [ ] **Step 1: Write the failing test**

Create `apps/crm/src/pages/entregas/components/__tests__/AddCommentPopover.test.tsx` (reuse the QueryClient wrapper pattern from `PostCommentPopover.test.tsx`, since `MentionTextarea` calls `useQuery`; mock `@/store` and `@/store/posts` the same way as that file, and `@/context/AuthContext` with `makeCan`):

```tsx
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render as rtlRender, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { makeCan, fakeMembership } from '@/test/makeCan';

vi.mock('@/context/AuthContext', () => ({
  useAuth: vi.fn(() => ({ can: makeCan(fakeMembership({ role: 'owner' })) })),
}));
vi.mock('@/store', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getMembros: vi.fn().mockResolvedValue([]),
  getClientes: vi.fn().mockResolvedValue([]),
  getTarefas: vi.fn().mockResolvedValue([]),
}));
vi.mock('@/store/posts', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  searchPostsForMention: vi.fn().mockResolvedValue([]),
}));

import { AddCommentPopover } from '../AddCommentPopover';

function render(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return rtlRender(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

const position = { top: 10, left: 10 };

describe('AddCommentPopover', () => {
  it('disables submit until there is text, then submits the trimmed text', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(<AddCommentPopover position={position} onSubmit={onSubmit} onClose={vi.fn()} />);
    const submit = screen.getByRole('button', { name: 'Comentar' });
    expect(submit).toBeDisabled();
    fireEvent.change(screen.getByPlaceholderText('Escreva seu comentário...'), {
      target: { value: '  ajustar o gancho  ' },
    });
    expect(submit).toBeEnabled();
    fireEvent.click(submit);
    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith('ajustar o gancho'));
  });

  it('closes on Escape', () => {
    const onClose = vi.fn();
    render(<AddCommentPopover position={position} onSubmit={vi.fn()} onClose={onClose} />);
    fireEvent.keyDown(screen.getByPlaceholderText('Escreva seu comentário...'), { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });

  it('closes on an outside mousedown but not on an ignored element', () => {
    const onClose = vi.fn();
    const trigger = document.createElement('button');
    document.body.appendChild(trigger);
    render(
      <AddCommentPopover
        position={position}
        onSubmit={vi.fn()}
        onClose={onClose}
        ignoreRefs={[{ current: trigger }]}
      />,
    );
    fireEvent.mouseDown(trigger);
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.mouseDown(document.body);
    expect(onClose).toHaveBeenCalledTimes(1);
    trigger.remove();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run apps/crm/src/pages/entregas/components/__tests__/AddCommentPopover.test.tsx`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement the component**

Create `apps/crm/src/pages/entregas/components/AddCommentPopover.tsx`:

```tsx
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { MentionTextarea } from '@/components/mentions/MentionTextarea';

export interface AddCommentPopoverProps {
  position: { top: number; left: number };
  onSubmit: (text: string) => Promise<void>;
  onClose: () => void;
  /** Elements whose mousedown must not count as "outside" (e.g. the trigger button). */
  ignoreRefs?: React.RefObject<HTMLElement | null>[];
}

/** "Adicionar comentário" popover shared by the content editor and the caption field. */
export function AddCommentPopover({
  position,
  onSubmit,
  onClose,
  ignoreRefs = [],
}: AddCommentPopoverProps) {
  const [text, setText] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const ignoreRef = useRef(ignoreRefs);
  ignoreRef.current = ignoreRefs;

  useEffect(() => {
    const onMouseDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (rootRef.current?.contains(target)) return;
      if (ignoreRef.current.some((r) => r.current?.contains(target))) return;
      onClose();
    };
    document.addEventListener('mousedown', onMouseDown);
    return () => document.removeEventListener('mousedown', onMouseDown);
  }, [onClose]);

  const submit = async () => {
    const value = text.trim();
    if (!value || submitting) return;
    setSubmitting(true);
    try {
      await onSubmit(value);
    } finally {
      setSubmitting(false);
    }
  };

  return createPortal(
    <div
      ref={rootRef}
      className="comment-add-popover"
      style={{ position: 'fixed', top: position.top, left: position.left, zIndex: 9999 }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <div className="comment-add-label">Adicionar comentário</div>
      <MentionTextarea
        className="comment-add-input"
        placeholder="Escreva seu comentário..."
        value={text}
        onValueChange={setText}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            void submit();
          }
          if (e.key === 'Escape') onClose();
        }}
        autoFocus
      />
      <button
        type="button"
        className="comment-add-submit"
        onClick={() => void submit()}
        disabled={!text.trim() || submitting}
      >
        Comentar
      </button>
    </div>,
    document.body,
  );
}
```

Note: the `onMouseDown={(e) => e.stopPropagation()}` matches today's inline popover, but React's stopPropagation does not stop the native `document` listener; the `rootRef.contains` check is what keeps inside clicks from closing it.

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run apps/crm/src/pages/entregas/components/__tests__/AddCommentPopover.test.tsx`
Expected: PASS.

- [ ] **Step 5: Switch `PostEditor` to the shared component**

In `apps/crm/src/pages/entregas/components/PostEditor.tsx`:

1. Add `import { AddCommentPopover } from './AddCommentPopover';`.
2. Delete the `commentAddText`/`setCommentAddText` and `commentSubmitting`/`setCommentSubmitting` state (`:86-97` region), the `commentAddRef` ref, and the `commentAddOpen` branch of the click-outside effect (`:295-299`), and remove `commentAddOpen` from that effect's dependency array. Keep `commentAddOpen`, `commentAddPos`, `commentAddWrapperRef`, `commentBtnRef` (the trigger button and its wrapper still need them).
3. Replace `handleAddComment` (`:377-392`) with a version that takes the text:

```tsx
  const handleAddComment = useCallback(
    async (text: string) => {
      if (!editor || !onCreateComment) return;
      const { from, to } = editor.state.selection;
      const quotedText = editor.state.doc.textBetween(from, to, ' ');
      if (!quotedText.trim()) return;
      const threadId = await onCreateComment(quotedText, text);
      editor.chain().focus().setCommentHighlight({ threadId }).run();
      setCommentAddOpen(false);
    },
    [editor, onCreateComment],
  );
```
4. Replace the `{commentAddOpen && commentAddPos && createPortal(...)}` block (`:756-795`) with:

```tsx
      {commentAddOpen && commentAddPos && (
        <AddCommentPopover
          position={commentAddPos}
          onSubmit={handleAddComment}
          onClose={() => setCommentAddOpen(false)}
          ignoreRefs={[commentAddWrapperRef]}
        />
      )}
```
5. Remove now-unused imports (`MentionTextarea` if no longer used elsewhere in the file: check with `grep -n MentionTextarea PostEditor.tsx`).

- [ ] **Step 6: Typecheck, lint, and run related tests**

Run: `npx tsc -p apps/crm/tsconfig.json --noEmit && npx eslint apps/crm/src/pages/entregas/components/PostEditor.tsx apps/crm/src/pages/entregas/components/AddCommentPopover.tsx && npx vitest run apps/crm/src/pages/entregas`
Expected: exit 0 / all PASS.

- [ ] **Step 7: Verify in the browser (content editor regression)**

Run `npm run dev:env` (worktree has no `.env`), open a workflow post, select text in the content editor, click the toolbar comment button, add a comment: the popover looks and behaves as before (Enter submits, Escape closes, click outside closes, highlight appears, thread opens on click).

- [ ] **Step 8: Commit**

```bash
git add apps/crm/src/pages/entregas/components/AddCommentPopover.tsx apps/crm/src/pages/entregas/components/PostEditor.tsx apps/crm/src/pages/entregas/components/__tests__/AddCommentPopover.test.tsx
git commit -m "refactor(entregas): extract AddCommentPopover from PostEditor

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 6: Rewrite `InstagramCaptionField`

**Files:**
- Modify (rewrite): `apps/crm/src/pages/entregas/components/InstagramCaptionField.tsx`
- Modify: `apps/crm/style.css` (add after the `.comment-highlight` dark rules, near line 8345)
- Test: `apps/crm/src/pages/entregas/components/__tests__/InstagramCaptionField.test.tsx`

**Interfaces:**
- Consumes: `useCaptionDraft`, `MAX_CAPTION_CHARS` (Task 4); `buildMirrorSegments`, `pickThreadId` (Task 2); `AddCommentPopover` (Task 5); `PostCommentPopover` (existing, props unchanged); `CommentAnchor`, `CaptionAnchorPatch`, `CommentThreadWithComments`, `Membro` from `@/store`.
- Produces:
```ts
export interface CaptionCommentHandlers {
  membros: Membro[];
  workspaceUsers: { id: string; nome: string; avatar_url: string }[];
  currentUserId: string;
  onCreateThread: (quotedText: string, comment: string, anchor: CommentAnchor) => Promise<number>;
  onReply: (threadId: number, content: string) => Promise<void>;
  onResolve: (threadId: number) => Promise<void>;
  onReopen: (threadId: number) => Promise<void>;
  onEditComment: (commentId: number, content: string) => Promise<void>;
  onDeleteComment: (commentId: number, threadId: number) => Promise<void>;
}
export interface InstagramCaptionFieldHandle { focusThread(threadId: number): void }
export const InstagramCaptionField: ForwardRefExoticComponent<{
  value: string;
  threads: CommentThreadWithComments[];   // this post's threads; non-caption ones are ignored
  disabled?: boolean;                      // locked: textarea readOnly, commenting still works
  lockedMessage?: string;
  onSave: (text: string, anchors: CaptionAnchorPatch[]) => Promise<void>;
  comments?: CaptionCommentHandlers;       // absent: no comment UI (highlight still painted)
} & RefAttributes<InstagramCaptionFieldHandle>>;
```

- [ ] **Step 1: Write the failing tests**

Create `apps/crm/src/pages/entregas/components/__tests__/InstagramCaptionField.test.tsx`. Same wrapper/mocks as `AddCommentPopover.test.tsx` (QueryClient + `@/context/AuthContext` + `@/store` + `@/store/posts` mocks) plus `vi.mock('@mesaas/app-lifecycle', ...)`. Helpers:

```tsx
const caption = 'hello brave new world';
const threadFor = (over = {}): CommentThreadWithComments => ({
  id: 1, post_id: 10, conta_id: 'c', quoted_text: 'brave', status: 'active', created_by: 'user-1',
  resolved_by: null, created_at: '2026-01-01T00:00:00Z', resolved_at: null,
  field: 'ig_caption', anchor_start: 6, anchor_end: 11, orphaned: false,
  post_comments: [{ id: 1, thread_id: 1, author_id: 'user-1', content: 'trocar', created_at: '2026-01-01T00:00:00Z', updated_at: null }],
  ...over,
});
const handlers = (over = {}) => ({
  membros: [], workspaceUsers: [], currentUserId: 'user-1',
  onCreateThread: vi.fn().mockResolvedValue(2), onReply: vi.fn(), onResolve: vi.fn(),
  onReopen: vi.fn(), onEditComment: vi.fn(), onDeleteComment: vi.fn(), ...over,
});
const textarea = () => screen.getByPlaceholderText(/Texto exato/) as HTMLTextAreaElement;
```

Cases (write each as its own `it`):

1. **paints active highlights in the mirror**: render with `threads=[threadFor()]`; `document.querySelector('.caption-mirror mark[data-thread-ids="1"]')` has text `brave`.
2. **does not paint resolved or orphaned threads**: `status: 'resolved'` and `orphaned: true, anchor_start: null, anchor_end: null` each → no `mark`.
3. **ignores content threads**: `field: 'conteudo', anchor_start: null, anchor_end: null` → no `mark`.
4. **Comentar button is disabled without a selection and enabled with one**: `screen.getByRole('button', { name: /Comentar/ })` disabled; then `textarea().setSelectionRange(6, 11); fireEvent.select(textarea())` → enabled.
5. **creates an anchored thread**: select `[6, 11]` → click Comentar → type in the popover placeholder `Escreva seu comentário...` → click the popover's submit (the second "Comentar" button: `screen.getAllByRole('button', { name: 'Comentar' }).at(-1)`) → `onCreateThread` called with `('brave', 'ajustar', { field: 'ig_caption', start: 6, end: 11 })`. Also assert `onSave` was called first only if there was a draft (here no draft, so `onSave` not called).
6. **flushes a pending edit before creating the thread**: `fireEvent.change(textarea(), { target: { value: 'oh ' + caption } })` (use fake timers not needed), then select `[9, 14]`, comment; assert `onSave` was called (with text starting `oh hello`) **before** `onCreateThread` (compare `mock.invocationCallOrder`).
7. **aborts and toasts when the flush fails**: `onSave` rejects → `onCreateThread` not called (`vi.mock('sonner', () => ({ toast: { error: vi.fn() } }))`, assert `toast.error` called).
8. **opens the thread popover on a click inside a highlight**: stub `HTMLElement.prototype.getClientRects` for the mark to `[{ left: 0, right: 100, top: 0, bottom: 20 }]` (`vi.spyOn(mark, 'getClientRects').mockReturnValue([...] as unknown as DOMRectList)`), collapsed selection, `fireEvent.click(textarea(), { clientX: 10, clientY: 10 })` → `screen.getByText('trocar')` visible (PostCommentPopover content).
9. **does not open the popover for a click that ends a drag selection** (selection start ≠ end).
10. **locked field is readOnly, not disabled, and still allows commenting**: `disabled` prop true → `expect(textarea()).toHaveAttribute('readonly')`, `expect(textarea()).not.toBeDisabled()`, Comentar enabled after a selection; typing (`fireEvent.change`) does not call `onSave` after 1.5s. The lock icon renders when `lockedMessage` given.
11. **char counter and 2200 cap**: counter shows `21 / 2200`.
12. **focusThread**: with a ref, `act(() => ref.current!.focusThread(1))` selects `[6, 11]` (`textarea().selectionStart === 6`) and shows the thread popover.

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run apps/crm/src/pages/entregas/components/__tests__/InstagramCaptionField.test.tsx`
Expected: FAIL (props/markup don't exist).

- [ ] **Step 3: Add the mirror CSS**

In `apps/crm/style.css`, after the `[data-theme='dark'] .comment-highlight[data-resolved='true']:hover { ... }` rule (before the `/* ── Comment thread popover */` comment), add:

```css
/* ── Instagram caption: comment highlight mirror ────────────── */
/* Sits behind a transparent textarea and repeats its text so only the
   highlight backgrounds are visible; the textarea's own text shows through. */
.caption-mirror {
  color: transparent;
  overflow-wrap: break-word;
}
.caption-mirror mark {
  color: transparent;
}
```

- [ ] **Step 4: Implement the component**

Rewrite `apps/crm/src/pages/entregas/components/InstagramCaptionField.tsx`:

```tsx
import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
} from 'react';
import { createPortal } from 'react-dom';
import { Instagram, Lock, MessageSquare } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from '@/components/ui/tooltip';
import type {
  CaptionAnchorPatch,
  CommentAnchor,
  CommentThreadWithComments,
  Membro,
} from '@/store';
import { buildMirrorSegments, pickThreadId } from '../utils/captionAnchors';
import PostCommentPopover from './PostCommentPopover';
import { AddCommentPopover } from './AddCommentPopover';
import { MAX_CAPTION_CHARS, useCaptionDraft } from './useCaptionDraft';

export interface CaptionCommentHandlers {
  membros: Membro[];
  workspaceUsers: { id: string; nome: string; avatar_url: string }[];
  currentUserId: string;
  onCreateThread: (quotedText: string, comment: string, anchor: CommentAnchor) => Promise<number>;
  onReply: (threadId: number, content: string) => Promise<void>;
  onResolve: (threadId: number) => Promise<void>;
  onReopen: (threadId: number) => Promise<void>;
  onEditComment: (commentId: number, content: string) => Promise<void>;
  onDeleteComment: (commentId: number, threadId: number) => Promise<void>;
}

export interface InstagramCaptionFieldHandle {
  focusThread(threadId: number): void;
}

interface InstagramCaptionFieldProps {
  value: string;
  threads: CommentThreadWithComments[];
  /** Locked (e.g. scheduled): the textarea is readOnly, but commenting still works. */
  disabled?: boolean;
  lockedMessage?: string;
  onSave: (text: string, anchors: CaptionAnchorPatch[]) => Promise<void>;
  comments?: CaptionCommentHandlers;
}

const POPOVER_W = 320;
const POPOVER_H = 400;

// Same box, font and wrapping classes as the textarea so the mirror wraps identically.
const FIELD_CLASS = 'min-h-[80px] w-full rounded-md border px-3 py-2 text-base md:text-sm';
const FIELD_STYLE = { fontFamily: 'var(--font-mono)', fontSize: '0.85rem' } as const;

export const InstagramCaptionField = forwardRef<
  InstagramCaptionFieldHandle,
  InstagramCaptionFieldProps
>(function InstagramCaptionField(
  { value, threads, disabled, lockedMessage, onSave, comments },
  ref,
) {
  const { text, anchors, change, flush, getText } = useCaptionDraft({ value, threads, onSave });
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const mirrorRef = useRef<HTMLDivElement>(null);
  const lastWidthRef = useRef<number | null>(null);
  const popoverRef = useRef<HTMLDivElement>(null);

  const [selection, setSelection] = useState<{ start: number; end: number } | null>(null);
  const [adding, setAdding] = useState<{
    start: number;
    end: number;
    quoted: string;
    top: number;
    left: number;
  } | null>(null);
  const [activeThreadId, setActiveThreadId] = useState<number | null>(null);
  const [popoverPos, setPopoverPos] = useState<{ top: number; left: number } | null>(null);

  const threadsById = useMemo(() => new Map(threads.map((t) => [t.id, t])), [threads]);

  const paintable = useMemo(
    () =>
      anchors
        .filter((a) => !a.orphaned && threadsById.get(a.id)?.status === 'active')
        .map((a) => ({ id: a.id, start: a.start, end: a.end })),
    [anchors, threadsById],
  );
  const segments = useMemo(() => buildMirrorSegments(text, paintable), [text, paintable]);

  // ── auto-grow (unchanged behavior: no inner scroll, height follows content) ──
  const resize = () => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  };
  useEffect(() => {
    resize();
  }, [text]);
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width;
      if (width === undefined) return;
      if (lastWidthRef.current !== null && Math.abs(width - lastWidthRef.current) < 0.5) return;
      lastWidthRef.current = width;
      resize();
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // ── selection tracking (drives the header "Comentar" button) ──
  const syncSelection = () => {
    const el = textareaRef.current;
    if (!el) return;
    setSelection(
      el.selectionStart !== el.selectionEnd
        ? { start: el.selectionStart, end: el.selectionEnd }
        : null,
    );
  };

  // ── thread popover placement + outside click ──
  const placeNear = (rect: { top: number; bottom: number; left: number }) => {
    const left = Math.max(8, Math.min(rect.left, window.innerWidth - POPOVER_W - 16));
    const top =
      rect.bottom + 6 + POPOVER_H > window.innerHeight
        ? Math.max(8, rect.top - POPOVER_H - 6)
        : rect.bottom + 6;
    return { top, left };
  };

  const openThread = (threadId: number) => {
    const mark = mirrorRef.current?.querySelector(`mark[data-thread-ids~="${threadId}"]`);
    const rect = (mark ?? textareaRef.current)?.getBoundingClientRect();
    if (!rect) return;
    setPopoverPos(placeNear(rect));
    setActiveThreadId(threadId);
    setAdding(null);
  };

  useEffect(() => {
    if (activeThreadId == null) return;
    const onMouseDown = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        setActiveThreadId(null);
      }
    };
    document.addEventListener('mousedown', onMouseDown);
    return () => document.removeEventListener('mousedown', onMouseDown);
  }, [activeThreadId]);

  const handleClick = (e: ReactMouseEvent<HTMLTextAreaElement>) => {
    const el = e.currentTarget;
    if (el.selectionStart !== el.selectionEnd) return; // end of a drag-select, not a click
    const hits: number[][] = [];
    mirrorRef.current?.querySelectorAll<HTMLElement>('mark[data-thread-ids]').forEach((mark) => {
      const inside = Array.from(mark.getClientRects()).some(
        (r) => e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom,
      );
      if (inside) hits.push((mark.dataset.threadIds ?? '').split(' ').map(Number));
    });
    const id = pickThreadId(hits);
    if (id != null && comments) openThread(id);
  };

  useImperativeHandle(
    ref,
    () => ({
      focusThread(threadId: number) {
        const el = textareaRef.current;
        if (!el) return;
        el.scrollIntoView?.({ block: 'center', behavior: 'smooth' });
        const a = anchors.find((x) => x.id === threadId);
        if (a && !a.orphaned) {
          el.focus({ preventScroll: true });
          el.setSelectionRange(a.start, a.end);
        }
        if (comments) openThread(threadId);
      },
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [anchors, comments],
  );

  // ── add comment ──
  const openAdd = (e: ReactMouseEvent<HTMLButtonElement>) => {
    if (!selection || !comments) return;
    const quoted = text.slice(selection.start, selection.end);
    if (!quoted.trim()) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const left = Math.max(8, Math.min(rect.left, window.innerWidth - 280 - 16));
    setAdding({ ...selection, quoted, top: rect.bottom + 6, left });
    setActiveThreadId(null);
  };

  const submitAdd = async (comment: string) => {
    if (!adding || !comments) return;
    // The new thread row must reference text the server already has.
    const saved = await flush();
    if (!saved) {
      toast.error('Não foi possível salvar a legenda. Tente de novo.');
      return;
    }
    if (getText().slice(adding.start, adding.end) !== adding.quoted) {
      toast.error('O texto mudou. Selecione o trecho de novo.');
      setAdding(null);
      return;
    }
    await comments.onCreateThread(adding.quoted, comment, {
      field: 'ig_caption',
      start: adding.start,
      end: adding.end,
    });
    setAdding(null);
    setSelection(null);
  };

  const activeThread = activeThreadId != null ? threadsById.get(activeThreadId) : undefined;

  return (
    <div
      className="mt-3 rounded-lg border-2 p-3"
      style={{ borderColor: 'var(--border-color)', background: 'var(--surface-hover)' }}
    >
      <div className="flex items-center gap-2 mb-2">
        <Instagram className="h-4 w-4" style={{ color: '#E1306C' }} />
        <span className="text-sm font-semibold" style={{ color: 'var(--text-main)' }}>
          Legenda do Instagram
        </span>
        {disabled && lockedMessage && (
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Lock className="h-3.5 w-3.5 ml-auto" style={{ color: 'var(--text-light)' }} />
              </TooltipTrigger>
              <TooltipContent>{lockedMessage}</TooltipContent>
            </Tooltip>
          </TooltipProvider>
        )}
        {comments && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="ml-auto h-7 gap-1 px-2 text-xs"
            disabled={!selection}
            onMouseDown={(e) => e.preventDefault()}
            onClick={openAdd}
            title="Selecione um trecho da legenda para comentar"
          >
            <MessageSquare className="h-3.5 w-3.5" />
            Comentar
          </Button>
        )}
        <span
          className={comments ? 'text-xs' : 'ml-auto text-xs'}
          style={{ color: 'var(--text-light)', fontFamily: 'var(--font-mono)' }}
        >
          {text.length} / {MAX_CAPTION_CHARS}
        </span>
      </div>

      <div className="relative rounded-md bg-background">
        <div
          ref={mirrorRef}
          aria-hidden="true"
          className={`caption-mirror pointer-events-none absolute inset-0 overflow-hidden whitespace-pre-wrap border-transparent ${FIELD_CLASS}`}
          style={FIELD_STYLE}
        >
          {segments.map((seg, i) =>
            seg.threadIds.length ? (
              <mark
                key={i}
                className="comment-highlight"
                data-thread-ids={seg.threadIds.join(' ')}
              >
                {seg.text}
              </mark>
            ) : (
              <span key={i}>{seg.text}</span>
            ),
          )}
          {'​'}
        </div>
        <Textarea
          ref={textareaRef}
          value={text}
          onChange={(e) => change(e.target.value)}
          onSelect={syncSelection}
          onKeyUp={syncSelection}
          onMouseUp={syncSelection}
          onClick={handleClick}
          readOnly={disabled}
          placeholder="Texto exato que será publicado no Instagram. Suporta emojis e hashtags."
          className="relative min-h-[80px] resize-none overflow-hidden bg-transparent read-only:cursor-default read-only:opacity-70"
          style={FIELD_STYLE}
        />
      </div>
      <p className="text-xs mt-1" style={{ color: 'var(--text-light)' }}>
        Texto exato que será publicado no Instagram. Suporta emojis e hashtags.
      </p>

      {adding && comments && (
        <AddCommentPopover
          position={{ top: adding.top, left: adding.left }}
          onSubmit={submitAdd}
          onClose={() => setAdding(null)}
        />
      )}

      {activeThread &&
        popoverPos &&
        comments &&
        createPortal(
          <div
            ref={popoverRef}
            style={{ position: 'fixed', top: popoverPos.top, left: popoverPos.left, zIndex: 9999 }}
          >
            <PostCommentPopover
              thread={activeThread}
              membros={comments.membros}
              workspaceUsers={comments.workspaceUsers}
              currentUserId={comments.currentUserId}
              onReply={comments.onReply}
              onResolve={comments.onResolve}
              onReopen={comments.onReopen}
              onEditComment={comments.onEditComment}
              onDeleteComment={comments.onDeleteComment}
              onClose={() => setActiveThreadId(null)}
            />
          </div>,
          document.body,
        )}
    </div>
  );
});
```

Notes for the implementer:
- `mark` gets `className="comment-highlight"` for the existing yellow highlight; `.caption-mirror mark { color: transparent }` (Step 3) hides its glyphs. Hover styling is irrelevant (the mirror has `pointer-events-none`).
- The mirror's `border-transparent` + the shared `FIELD_CLASS` (`border px-3 py-2 text-base md:text-sm min-h-[80px]`) give it the same box as the `Textarea`; `bg-background` moved from the textarea to the wrapper (`Textarea` gets `bg-transparent`, merged by `cn`).
- The `useImperativeHandle` eslint-disable is intentional: `openThread` only reads refs and setters.

- [ ] **Step 5: Run to verify tests pass**

Run: `npx vitest run apps/crm/src/pages/entregas/components/__tests__/InstagramCaptionField.test.tsx`
Expected: PASS. If case 8 fails only because jsdom returns no client rects, confirm the `getClientRects` stub is applied to the actual `mark` element found via `document.querySelector`.

- [ ] **Step 6: Commit**

```bash
git add apps/crm/src/pages/entregas/components/InstagramCaptionField.tsx apps/crm/src/pages/entregas/components/__tests__/InstagramCaptionField.test.tsx apps/crm/style.css
git commit -m "feat(entregas): comment on Instagram caption text with highlights

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

(This commit will not typecheck the callers yet: `PostEditorBody` still passes the old props. Do Task 7 immediately; do not push between.)

---

### Task 7: Wiring (`PostEditorBody`, both drawers, summary list)

**Files:**
- Modify: `apps/crm/src/pages/entregas/components/PostCommentSummary.tsx`
- Modify: `apps/crm/src/pages/entregas/components/PostEditorBody.tsx` (`:119` prop type, `:160` destructure, `:590`, `:605-611`, `:659-663`)
- Modify: `apps/crm/src/pages/entregas/components/WorkflowDrawer.tsx` (`:69` import, `:769` handler, `:1064`, `:1268`, `:1321`, `:1493`)
- Modify: `apps/crm/src/pages/entregas/components/StandalonePostDrawer.tsx` (`:40` import, `:425` handler, `:672`)
- Modify: mocks in `__tests__/StandalonePostDrawer.test.tsx`, `WorkflowDrawer.test.tsx`, `WorkflowDrawerAutoComplete.test.tsx`, `WorkflowDrawerAutoScheduleNudge.test.tsx` (add `saveIgCaption: vi.fn()` next to `createCommentThread: vi.fn()`)
- Test: `__tests__/PostCommentSummary.test.tsx`

**Interfaces:**
- Consumes: `InstagramCaptionField`, `InstagramCaptionFieldHandle`, `CaptionCommentHandlers` (Task 6); `saveIgCaption`, `createCommentThread(..., anchor?)`, `CommentAnchor`, `CaptionAnchorPatch` (Task 3).
- Produces: `PostEditorBody` prop `onSaveCaption: (postId: number, text: string, anchors: CaptionAnchorPatch[]) => Promise<void>`; `onCreateComment` gains a 4th optional `anchor?: CommentAnchor`.

- [ ] **Step 1: Write the failing summary tests**

Append to `apps/crm/src/pages/entregas/components/__tests__/PostCommentSummary.test.tsx` (use the file's existing thread factory/`defaultProps`; add the four new fields to that factory as `field: 'conteudo', anchor_start: null, anchor_end: null, orphaned: false` if Task 3 Step 5 has not already):

```tsx
  it('shows a "Legenda" chip on caption threads only', () => {
    render(
      <PostCommentSummary
        {...defaultProps}
        threads={[
          makeThread({ id: 1, field: 'ig_caption', anchor_start: 0, anchor_end: 3 }),
          makeThread({ id: 2 }),
        ]}
      />,
    );
    expect(screen.getAllByText('Legenda')).toHaveLength(1);
  });

  it('shows "texto removido" for an orphaned caption thread', () => {
    render(
      <PostCommentSummary
        {...defaultProps}
        threads={[
          makeThread({ id: 1, field: 'ig_caption', anchor_start: null, anchor_end: null, orphaned: true }),
        ]}
      />,
    );
    expect(screen.getByText('texto removido')).toBeInTheDocument();
  });
```
(`makeThread` = whatever the file's existing helper is called; open the file and use its real name and override style.)

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run apps/crm/src/pages/entregas/components/__tests__/PostCommentSummary.test.tsx`
Expected: FAIL (`Legenda` not found).

- [ ] **Step 3: Update `PostCommentSummary`**

In the `comment-summary-content` block, before the quote line, add:

```tsx
                  {thread.field === 'ig_caption' && (
                    <span className="comment-summary-badges">
                      <span className="comment-summary-chip">Legenda</span>
                      {thread.orphaned && (
                        <span className="comment-summary-chip comment-summary-chip--muted">
                          texto removido
                        </span>
                      )}
                    </span>
                  )}
```
and add to `apps/crm/style.css` next to the other `.comment-summary-*` rules:

```css
.comment-summary-badges {
  display: flex;
  gap: 6px;
  align-items: center;
}
.comment-summary-chip {
  font-size: 10px;
  font-weight: 600;
  padding: 1px 6px;
  border-radius: 999px;
  background: var(--surface-2, #eceef2);
  color: var(--text-muted);
}
.comment-summary-chip--muted {
  font-weight: 500;
  opacity: 0.85;
}
```
(find the rules with `grep -n "comment-summary-quote" apps/crm/style.css` and put these right after.)

- [ ] **Step 4: Run summary tests to verify they pass**

Run: `npx vitest run apps/crm/src/pages/entregas/components/__tests__/PostCommentSummary.test.tsx`
Expected: PASS.

- [ ] **Step 5: `PostEditorBody`**

1. Imports: `import { useRef } from 'react'` (merge with the existing React import), `import { InstagramCaptionField, type InstagramCaptionFieldHandle } from './InstagramCaptionField';` (replace the existing import), `import type { CaptionAnchorPatch, CommentAnchor } from '@/store';` (merge with the existing `@/store` type import).
2. Prop types (`:119`):

```ts
  onCreateComment: (
    postId: number,
    quotedText: string,
    comment: string,
    anchor?: CommentAnchor,
  ) => Promise<number>;
  onSaveCaption: (postId: number, text: string, anchors: CaptionAnchorPatch[]) => Promise<void>;
```
   and add `onSaveCaption,` to the destructured props next to `onCreateComment,` (`:160`).
3. Inside the component body, near the other hooks: `const captionRef = useRef<InstagramCaptionFieldHandle>(null);`
4. Replace the `InstagramCaptionField` usage (`:605-611`):

```tsx
        <InstagramCaptionField
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
```
   (`commentThreads` is already this post's threads: `WorkflowDrawer.tsx:1039` filters by `post_id`; `StandalonePostDrawer` only loads its own post's.)
5. Replace `onThreadClick={() => {}}` on the `PostCommentSummary` (`:662`) with:

```tsx
        onThreadClick={(threadId) => {
          const thread = commentThreads.find((t) => t.id === threadId);
          if (thread?.field === 'ig_caption') captionRef.current?.focusThread(threadId);
        }}
```
   (The ref is unset where the field isn't mounted (Stories, no IG account), so the click is a no-op there.)

- [ ] **Step 6: `WorkflowDrawer`**

1. Add `saveIgCaption` and the `CommentAnchor`/`CaptionAnchorPatch` types to the existing `@/store` import (`:69` region: `createCommentThread,` is imported there; add `saveIgCaption,` and `type CaptionAnchorPatch, type CommentAnchor,`).
2. Replace `handleCreateComment` (`:766-773`):

```ts
  const handleCreateComment = useCallback(
    async (postId: number, quotedText: string, comment: string, anchor?: CommentAnchor) => {
      const thread = await createCommentThread(postId, quotedText, comment, anchor);
      await refetchComments();
      return thread.id;
    },
    [refetchComments],
  );

  // Caption text + anchors commit atomically; awaited BEFORE the refetch so the
  // highlights never snap back to pre-save offsets.
  const handleSaveCaption = useCallback(
    async (postId: number, text: string, anchors: CaptionAnchorPatch[]) => {
      try {
        await saveIgCaption(postId, text, anchors);
      } catch (err) {
        toast.error('Erro ao atualizar post');
        throw err;
      }
      refresh();
      await refetchComments();
    },
    [refresh, refetchComments],
  );
```
3. At the four sites: pass `onSaveCaption={handleSaveCaption}` next to `onCreateComment={handleCreateComment}` (`:1064`); widen the row prop type at `:1268` to

```ts
  onCreateComment: (
    postId: number,
    quotedText: string,
    comment: string,
    anchor?: CommentAnchor,
  ) => Promise<number>;
  onSaveCaption: (postId: number, text: string, anchors: CaptionAnchorPatch[]) => Promise<void>;
```
   add `onSaveCaption,` to the row's destructure (`:1321`), and `onSaveCaption={onSaveCaption}` next to `onCreateComment={onCreateComment}` (`:1493`).

- [ ] **Step 7: `StandalonePostDrawer`**

Same two changes: import `saveIgCaption`, `CommentAnchor`, `CaptionAnchorPatch`; replace `handleCreateComment` (`:422-429`) with the anchor-aware version using `targetPostId`:

```ts
  const handleCreateComment = useCallback(
    async (targetPostId: number, quotedText: string, comment: string, anchor?: CommentAnchor) => {
      const thread = await createCommentThread(targetPostId, quotedText, comment, anchor);
      await refetchComments();
      return thread.id;
    },
    [refetchComments],
  );

  const handleSaveCaption = useCallback(
    async (targetPostId: number, text: string, anchors: CaptionAnchorPatch[]) => {
      try {
        await saveIgCaption(targetPostId, text, anchors);
      } catch (err) {
        toast.error('Erro ao atualizar post');
        throw err;
      }
      refresh();
      await refetchComments();
    },
    [refresh, refetchComments],
  );
```
and pass `onSaveCaption={handleSaveCaption}` next to `onCreateComment={handleCreateComment}` (`:672`). Confirm `refresh` (`:226`) is defined above these callbacks (it is: `useCallback` at `:226`).

- [ ] **Step 8: Update the existing test mocks**

In each of `StandalonePostDrawer.test.tsx`, `WorkflowDrawer.test.tsx`, `WorkflowDrawerAutoComplete.test.tsx`, `WorkflowDrawerAutoScheduleNudge.test.tsx`, add `saveIgCaption: vi.fn(),` on the line after `createCommentThread: vi.fn(),`.

- [ ] **Step 9: Typecheck, lint, test**

Run:
```bash
npx tsc -p apps/crm/tsconfig.json --noEmit
npx tsc -p apps/hub/tsconfig.json --noEmit
npx tsc -p apps/admin/tsconfig.json --noEmit
npx tsc -p tsconfig.scripts.json
npm run lint
npx vitest run apps/crm/src/pages/entregas apps/crm/src/__tests__/store.comments.test.ts
```
Expected: all exit 0 / PASS. Fix any remaining fixture type errors by adding the four new thread fields.

- [ ] **Step 10: Commit**

```bash
git add apps/crm
git commit -m "feat(entregas): wire caption comments through drawers and summary

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 8: Browser verification, spec sync, full gates

**Files:**
- Modify: `docs/superpowers/specs/2026-09-19-instagram-caption-comments-design.md` (already synced before the plan; re-read once and fix any drift found while verifying)

- [ ] **Step 1: Apply the migration to staging-equivalent local and start the dev server**

Run: `npx supabase db reset` (local) then `npm run dev:env`. If verifying against staging instead, the migration must be pushed to staging first (`npx supabase db push --linked` from a worktree linked to staging: check `supabase/.temp/project-ref` is `wlyzhyfondykzpsiqsce`), **never prod**.

- [ ] **Step 2: Verify in the Browser pane** (`mcp__Claude_Browser__*`; seed login per memory `reference_seed_login_browser_verification`)

Check each, with a screenshot for the visual ones:
1. Open a post with an Instagram account. Select words in the caption: the header **Comentar** button enables; deselect: it disables.
2. Comment on the selection: highlight appears; the thread shows in "Comentários internos" with the **Legenda** chip; clicking the row scrolls to the caption, selects the range and opens the thread.
3. Click inside the highlight (no selection): thread popover opens; reply, resolve (highlight disappears), reopen (returns).
4. Type text before the highlighted words, wait 2s, reload: highlight is on the same words. Type inside it: it grows. Delete the whole passage: after save the thread shows **texto removido** and no highlight.
5. Undo (Cmd+Z) within 1.5s after deleting the passage: highlight is back, no orphan.
6. Alignment: a long caption that wraps over 4+ lines, a long unbroken URL, emoji, blank lines and a trailing newline: highlight sits exactly under the words. Resize the drawer / window: still aligned. Mobile preset (375px): still aligned; Comentar button reachable.
7. Locked: schedule the post (status `agendado`): the caption is dimmed and read-only; you can still select, comment and open threads.
8. `PostEditor` (content) comments still work (Task 5 regression).
9. Dark mode: highlight visible on the caption.
10. Console has no errors; the `save_ig_caption` request is a single POST to `/rpc/save_ig_caption` per save (`read_network_requests`).

Reset any emulated viewport with `resize_window` preset `desktop` when done.

- [ ] **Step 3: Full CI-equivalent gates**

Run:
```bash
npm run lint
npm run format:check      # npm run format to auto-fix, then re-check
npx tsc -p apps/crm/tsconfig.json --noEmit
npx tsc -p apps/hub/tsconfig.json --noEmit
npx tsc -p apps/admin/tsconfig.json --noEmit
npx tsc -p tsconfig.scripts.json
npm run test
npm run check:functions
npm run test:functions
```
Expected: all pass. (`npm run test:db` / `scripts/test-entitlements.sh` needs Docker; if unavailable, CI's `entitlement-tests` covers suite 98.)

- [ ] **Step 4: Renumber check and commit**

Run `git fetch origin main && git ls-tree origin/main --name-only supabase/migrations/ | tail -3`. If main's tail is now `>= 20260925000016`, rename the migration to the next free prefix (and update its reference in `98_caption_comment_anchors.sql`'s header comment and the spec), then:

```bash
git add -A && git commit -m "chore: renumber caption anchors migration

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```
Otherwise nothing to commit.

- [ ] **Step 5: Deploy order note for the PR description**

Frontend deploys on merge (`feedback_merge_deploys_frontend_migrations_first`): the **migration must be applied to prod before merging**, or the new field will call a missing RPC and the `createCommentThread` insert with `field`/`anchor_*` will fail. No edge-function deploy is needed. Existing rows default to `field='conteudo'`, so applying the migration first is safe with the old frontend.

---

## Self-Review Notes (spec coverage)

| Spec requirement | Task |
|---|---|
| Columns + hardened CHECK (NULL `anchor_end`) | 1 |
| `save_ig_caption` atomic RPC, grants, isolation | 1 |
| `remapAnchors` (boundaries, surrogate pairs, `aa`→`aaa`), `validateAnchors`, `quoted_text` refresh | 2 |
| Store: anchored `createCommentThread` (optional 4th param), `saveIgCaption` | 3 |
| Debounce reads state at fire time, props don't override pending draft, flush before thread creation, serialized saves, undo-to-persisted resets anchors | 4, 6 |
| Extract `AddCommentPopover` | 5 |
| Mirror overlay, header Comentar button, click hit-test, `readOnly` lock, deliberate divergence from `PostEditor` | 6 |
| "Legenda" chip, "texto removido" badge, functional `onThreadClick` for caption threads, no-op elsewhere | 6, 7 |
| Both drawers + `PostEditorBody` threading, await save before refetch | 7 |
| Existing test mocks updated | 3, 7 |
| Browser verification (alignment, mobile, locked, dark) | 8 |
| Migration renumber + deploy order | 1, 8 |

Deliberate deviations from the spec text (spec is updated to match): click target uses a **pointer hit-test against the mirror's `<mark>` client rects** (a caret offset is ambiguous at range edges); anchors are remapped **incrementally per keystroke** with a reset to the persisted anchors when the text returns to the persisted text (atomic save makes baseline-diffing unnecessary); **no `updateThreadAnchors`** (corrections from `validateAnchors` persist on the next save through the RPC, nothing is written just from viewing).
