# Instagram Collaborators Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a post carry up to 3 Instagram collaborator usernames that Mesaas sends as `collaborators` when it creates the media container, with editor UI, list/calendar/Hub indicators and a specific publish error.

**Architecture:** New `workflow_posts.ig_collaborators text[]` (+ `ig_collaborators_refused`) guarded by a CHECK and the existing z5 invariant trigger; the Instagram claim RPC returns it; every container builder takes it via an options object; a new `COLLABORATOR_INVALID` error code (subcode 2207018) is non-retryable. CRM gets a tag-input field placed with the Instagram caption; the Hub shows "Em parceria com".

**Tech Stack:** Postgres/Supabase migrations + psql suites, Deno edge functions, React 19 + TanStack Query + shadcn (CRM), React (Hub), Vitest, `deno test`.

**Spec:** `docs/superpowers/specs/2026-10-19-instagram-collaborators-design.md` (read it first; this plan does not repeat its copy or rationale). Mockups: https://claude.ai/artifact/A5s9oc4m5CHTFzHDGSYyqv

## Global Constraints

- Worktree: `/Users/eduardosouza/projects/sm-crm/.claude/worktrees/mesaas-instagram-collab-posts-2ad70d`. Run `pwd` and `git branch --show-current` (expect `claude/mesaas-instagram-collab-posts-2ad70d`) before any edit. Never `cd` to the main checkout.
- Parallel agents share this worktree: run `npx prettier --write` / `npx eslint --fix` **only on your own file paths**, never repo-wide; commit with an explicit pathspec (`git commit -- <paths>`), never `git add -A` / `git commit -a`.
- Never run `git stash`. Never push. Never deploy. Never touch `.env*`.
- All UI copy pt-BR, sentence case, **no em dashes** (use a period or colon). Copy strings are fixed by the spec; copy them verbatim.
- Username rule (everywhere): lowercase, no `@`, regex `^[a-z0-9._]{1,30}$`, max 3, no duplicates, no NULL members.
- `ig_collaborators` null/missing is always treated as `[]` in TS and Deno code.
- Icons: `lucide-react` (`Users`, `X`, `AlertCircle`, `Lock`). Toasts: `toast` from `sonner`.
- Migration version: `20261019000001` (main's tail is `20261016000001`). Before opening the PR, re-check `git fetch && ls supabase/migrations | tail` on `origin/main` and renumber above its tail if needed.
- `npm run test:functions` dirties `deno.lock` and Deno runs can pollute `node_modules`: after any Deno run, `git checkout -- deno.lock` if it changed and you did not mean to change it; if `ls node_modules/.deno` exists, run `npm ci` before judging Vitest/prettier results.

## Review Focus

1. Pasting `"@Dra.Julia, @clinicaviva\nhttps://www.instagram.com/nutri.ana/?hl=pt"` into the field: expect three chips `dra.julia`, `clinicaviva`, `nutri.ana` (test in Task 4).
2. A carousel that failed with `COLLABORATOR_INVALID` after its children were persisted, then retried after the list is fixed: the new **parent** container carries the new list and children never carry it (test in Task 2).
3. A legacy post row where `ig_collaborators` is missing from an old cached query (`undefined`): no crash in list, calendar, editor, Hub (tests in Tasks 5, 6, 7 render a fixture without the field).
4. Multiplatform post with collaborators, user turns Instagram off in Destinos: list is cleared server-side, toast shows, editor no longer shows stale chips (test in Task 5).
5. Old cron code reading the new claim RPC, and new code reading a row where the claim returned `null` for the column: container body omits `collaborators` (test in Task 2).

---

## Execution waves

- **Wave 1 (parallel, disjoint files):** Task 1 (DB), Task 2 (edge publish pipeline), Task 3 (CRM data + error copy + service), Task 4 (CRM field component), Task 7 (Hub).
- **Wave 2 (parallel, after Wave 1):** Task 5 (editor integration + error block), Task 6 (list + calendar indicators).
- **Wave 3:** Task 8 (whole-branch gates).

---

### Task 1: Migration + psql suite

**Files:**
- Create: `supabase/migrations/20261019000001_ig_collaborators.sql`
- Create: `supabase/tests/entitlements/31_ig_collaborators.sql` (pattern: `30_ig_trial_strategy.sql`)

**Interfaces:**
- Produces: columns `workflow_posts.ig_collaborators text[] NOT NULL DEFAULT '{}'`, `workflow_posts.ig_collaborators_refused text[] NOT NULL DEFAULT '{}'`; function `public.ig_collaborators_valid(text[]) RETURNS boolean IMMUTABLE`; constraints `workflow_posts_ig_collaborators_valid`, `workflow_posts_ig_collab_trial_exclusive`; `claim_posts_for_publishing(p_phase text, p_limit int DEFAULT 25)` RETURNS TABLE gains a final column `ig_collaborators text[]`.

The migration, in order (each a section with a header comment naming its canonical source, like `20260829000001`):
1. Helper `ig_collaborators_valid(p text[])`: `false` when `p IS NULL`, `cardinality(p) > 3`, `array_position(p, NULL) IS NOT NULL`, any element not matching `^[a-z0-9._]{1,30}$`, or `cardinality(p) <> (SELECT count(DISTINCT x) FROM unnest(p) x)`; else `true`. Never returns NULL (wrap with `COALESCE(..., false)`).
2. Columns + `COMMENT ON COLUMN` (text in spec) + the two CHECKs (`CHECK (ig_collaborators_valid(ig_collaborators))`; `CHECK (ig_trial_strategy IS NULL OR cardinality(ig_collaborators) = 0)`).
3. `CREATE OR REPLACE FUNCTION workflow_posts_clear_ig_trial()` (canonical: `20260829000001:22-32`) keeping the trial logic and adding: clear `NEW.ig_collaborators := '{}'` when `NEW.tipo = 'stories' OR COALESCE(NEW.platform,'instagram') NOT IN ('instagram','both')`; clear `NEW.ig_collaborators_refused := '{}'` when `TG_OP = 'UPDATE' AND NEW.ig_collaborators IS DISTINCT FROM OLD.ig_collaborators`. Trigger name unchanged.
4. `DROP FUNCTION claim_posts_for_publishing(text, integer)` + `CREATE` copying `20260925000013_claim_publishing_order_by_scheduled_at.sql` verbatim except: `ig_collaborators text[]` appended to RETURNS TABLE and `u.ig_collaborators` to the final SELECT; `'COLLABORATOR_INVALID'` appended to the retry `NOT IN`. Grants: `REVOKE ALL ... FROM public, anon, authenticated; GRANT EXECUTE ... TO service_role;`.
5. `CREATE OR REPLACE` `duplicate_post` copying `20261010100006_duplicate_post_targets.sql` with `ig_collaborators` added to the INSERT column list and `s.ig_collaborators` to its SELECT (`:93-104`), and `ig_collaborators = s.ig_collaborators` added to the re-apply UPDATE (`:125`). Keep its grants exactly as the canonical file sets them.
6. `CREATE OR REPLACE` the notification trigger function behind `trg_notify_post_publish_failed` copying `20260830000003_avulso_notifications_folders_views.sql:~300-345` with both `publish_error_code IN (...)` lists extended by `'TRIAL_INELIGIBLE','CAPTION_TOO_LONG','ACCOUNT_RESTRICTED','COLLABORATOR_INVALID'`.
7. Before writing, grep `ig_trial_strategy` across `supabase/migrations/` for any other function that copies post columns from a source post; if one exists that is still the live definition, carry `ig_collaborators` over in the same way and list it in the commit message. (Known: only `duplicate_post`.)

- [ ] **Step 1: Write `31_ig_collaborators.sql`** with `assert` blocks (inside `begin; ... rollback;` like file 30) for:
  - insert feed + instagram with `'{dra.julia,clinicaviva}'` keeps it;
  - each rejected by CHECK (use `begin ... exception when check_violation then ... end` and assert it raised): 4 items; `'{NULL}'`; `'{ok,NULL}'`; `'{Dra.Julia}'`; `'{dra julia}'`; `'{a,a}'`; 31-char name; trial `'auto'` + one collaborator on reels;
  - `update ... set tipo='stories'` clears to `'{}'`; `set platform='tiktok'` clears; insert stories with collaborators lands `'{}'`;
  - set `ig_collaborators_refused='{clinicaviva}'` then change `ig_collaborators` → refused is `'{}'`; an update that changes only `status` keeps refused;
  - `duplicate_post` on a post with collaborators copies them, including into a board whose platform derivation excludes Instagram then re-applies (mirror whatever setup `99_post_targets.sql` / the duplicate tests use; assert the copy has the list after the call);
  - `claim_posts_for_publishing('container', 25)` returns `ig_collaborators` for an `agendado` post scheduled in 30 min (needs an `instagram_accounts` row; follow the claim tests in the existing suites, grep `claim_posts_for_publishing` under `supabase/tests`); a `falha_publicacao` post with `publish_error_code='COLLABORATOR_INVALID'` is NOT returned by `'retry'`;
  - updating a post to `status='falha_publicacao', publish_error_code='COLLABORATOR_INVALID', publish_retry_count=1` inserts a notification row (assert by whatever table `trg_notify_post_publish_failed` writes; read its body).
- [ ] **Step 2: Run** `bash scripts/test-entitlements.sh` (needs local Supabase on colima; see memory/README). If Docker is unavailable, say so in the report and rely on CI's `entitlement-tests` job, but at minimum run the migration SQL through `npx supabase db query --local` or `psql` against a local db if one is up. Expected before the migration exists: FAIL on missing column.
- [ ] **Step 3: Write the migration** as specified above.
- [ ] **Step 4: Run** the suite again. Expected: PASS, and every other suite still passes (`claim`/`duplicate_post`/notification suites).
- [ ] **Step 5: Commit** `git commit -m "feat(db): ig_collaborators on workflow_posts" -- supabase/migrations/20261019000001_ig_collaborators.sql supabase/tests/entitlements/31_ig_collaborators.sql`

---

### Task 2: Edge publish pipeline

**Files:**
- Modify: `supabase/functions/_shared/instagram-graph.ts` (`throwGraphError`)
- Modify: `supabase/functions/_shared/publish-error-codes.ts`
- Modify: `supabase/functions/_shared/instagram-publish-utils.ts` (builders `:187-330`, `validateForScheduling :85-148`, `advanceCarouselContainer :693`, `createContainerForPost :748`)
- Create: `supabase/functions/_shared/instagram-collaborators.ts`
- Modify: `supabase/functions/instagram-publish-cron/index.ts` (`ClaimedPost :66`, `markFailed :87-150`, `processContainerCreation :158-222`, `collectFailure :405-414`)
- Modify: `supabase/functions/instagram-publish/handler.ts` (select `:64`, schedule front-load `:110-136`, retry `:164-186`, publish-now first attempt and coverless retry `:290-350`, catch `:~407`)
- Check: `supabase/functions/_shared/notify.ts`, `notification-email.ts` for hand-written code lists
- Test: `supabase/functions/__tests__/instagram-collaborators_test.ts` (new) and update existing `instagram-publish-*_test.ts` files that call the builders positionally

**Interfaces:**
- Produces:
  - `throwGraphError` sets `err.graphUserMsg: string` when `data.error.error_user_msg` is a string.
  - `PublishErrorCode` gains `"COLLABORATOR_INVALID"`; `classifyPublishError` returns it when `graphSubcode === 2207018` (rule placed right after the TOKEN_EXPIRED rule); it is in `NON_RETRYABLE_CODES`; `PUBLISH_ERROR_COPY.COLLABORATOR_INVALID = { titulo: "O Instagram recusou um colaborador", explicacao: "Confira se o @ está certo e se o perfil é público. Edite os colaboradores e tente novamente." }`.
  - `_shared/instagram-collaborators.ts`: `export function normalizeCollaborators(v: unknown): string[]` (non-array/null → `[]`, keeps only strings) and `export function refusedCollaborators(collaborators: string[], userMsg: string | undefined | null): string[]` (lowercase `userMsg`, split on `/[^a-z0-9._]+/`, return collaborators present as an exact token, in list order; `[]` when no msg).
  - Builders: `createSingleImageContainer(igUserId, token, imageUrl, caption, opts?: { timeoutMs?: number; collaborators?: string[] })`, `createVideoContainer(igUserId, token, videoUrl, caption, opts?: { coverUrl?: string; trialStrategy?: IgTrialStrategy | null; timeoutMs?: number; collaborators?: string[] })`, `createCarouselParentContainer(igUserId, token, childIds, caption, opts?: { timeoutMs?: number; collaborators?: string[] })`. Body gets `collaborators` only when the array is non-empty. Child and story builders unchanged.
  - `createContainerForPost` / `advanceCarouselContainer` opts gain `collaborators?: string[] | null`.
  - Guard: `createContainerForPost` and `advanceCarouselContainer` throw `Error("Reels de teste não aceitam colaboradores.")` when collaborators non-empty and trialStrategy set, and `Error("Stories não aceitam colaboradores.")` when non-empty and `tipo === 'stories'`, before any fetch. `validateForScheduling` adds the same two messages to `errors` (selects `ig_collaborators`).
  - Handler `retry` action reads an optional JSON body `{ clearCollaborators?: boolean }` (`await req.json().catch(() => ({}))`, ignore non-boolean). When true, BEFORE the `record_post_status_change` call (the post is still `falha_publicacao`, which no claim phase takes for this code), `update workflow_posts set ig_collaborators='{}', ig_collaborators_refused='{}'`; if that update errors, return the handler's generic 500 and do not change status. When false/absent, still clear `ig_collaborators_refused` in the existing `carousel_children` update.
  - Failure writers: when `classifyPublishError(err) === "COLLABORATOR_INVALID"`, also write `ig_collaborators_refused: refusedCollaborators(post's collaborators, err.graphUserMsg)` in the same update as `publish_error_code` (cron `markFailed` gets a new optional `collaborators?: string[]` param; handler catch has the post row). `collectFailure`'s alert may append the refused names.
- Consumes: Task 1's claim column `ig_collaborators` (read defensively via `normalizeCollaborators`).

- [ ] **Step 1: Write failing tests** in `instagram-collaborators_test.ts` (stub `fetch` like `instagram-publish-container_test.ts`):
  - `normalizeCollaborators` → `null`→`[]`, `["a", 3, null]`→`["a"]`.
  - `refusedCollaborators(["ana","clinicaviva"], "Os seguintes usuários não podem ser acessados: clinicaviva")` → `["clinicaviva"]`; `(["ana"], "... anamaria")` → `[]`; `(["ana"], undefined)` → `[]`; case-insensitive `"CLINICAVIVA"` matches.
  - `classifyPublishError({ graphCode: 110, graphSubcode: 2207018, message: "Invalid user id" })` → `"COLLABORATOR_INVALID"`; it is in `NON_RETRYABLE_CODES`.
  - `throwGraphError({ error: { message: "Invalid user id", code: 110, error_subcode: 2207018, error_user_msg: "x" } })` throws with `graphUserMsg === "x"`.
  - Each builder: with `collaborators: ["a","b"]` the fetched body has `collaborators: ["a","b"]`; with `[]` or omitted the body has no `collaborators` key; `opts.timeoutMs` still honored (assert no throw with explicit value).
  - `createContainerForPost` for feed, reels, and `advanceCarouselContainer` for a 2-item carousel: parent body has `collaborators`, child bodies never do; with persisted children and a new list, the new parent body has the new list (Review Focus 2).
  - Guards: trial+collab and stories+collab throw the exact messages and make zero fetch calls.
- [ ] **Step 2: Run** `deno test --no-check supabase/functions/__tests__/instagram-collaborators_test.ts` → FAIL (missing module/exports).
- [ ] **Step 3: Implement** the Interfaces above. Update every builder call site (`deno check` lists them): cron, handler (including `:346` coverless retry passing `collaborators`), `createContainerForPost`, `advanceCarouselContainer`, and existing tests that pass `timeoutMs` positionally.
- [ ] **Step 4: Add handler/cron tests** to the existing suites that cover the handler and cron (grep `__tests__` for `instagram-publish/handler` and `instagram-publish-cron`): cron passes claimed `ig_collaborators` on first attempt and on `publish_retry_count > 0`; cron with claim row lacking the field sends no `collaborators` (Review Focus 5); `markFailed` on a 2207018 error writes `publish_error_code: "COLLABORATOR_INVALID"` and `ig_collaborators_refused`; handler retry with `{clearCollaborators:true}` issues the clearing update before `record_post_status_change` (assert call order on the fake db); retry without the flag does not touch `ig_collaborators`; `validateForScheduling` returns the two new errors.
- [ ] **Step 5: Run** `npm run check:functions` (PASS) and `npm run test:functions` (all PASS). Restore `deno.lock` if dirtied.
- [ ] **Step 6: Commit** with a pathspec of every file touched in this task: `feat(publish): send Instagram collaborators and classify refusals`.

---

### Task 3: CRM data layer, error copy, retry service

**Files:**
- Modify: `apps/crm/src/store/posts.ts` (`WorkflowPost :121`, the row type at `:275`, `CLIENTE_POST_COLUMNS :141` + mapper `:156`, `POST_CONTEXT_COLUMNS :365` + mapper `:399`, `ASSIGNED_PENDING_POST_COLUMNS :668`, and the drawer's full-post select if it is an explicit list)
- Modify: `apps/crm/src/pages/entregas/publishErrorCopy.ts`
- Modify: `apps/crm/src/services/instagram.ts` (`retryInstagramPublish :262`)
- Test: `apps/crm/src/__tests__/store.posts.test.ts`, existing `publishErrorCopy` test if any (grep), new `apps/crm/src/services/__tests__/instagram.retry.test.ts` if no retry test exists

**Interfaces:**
- Produces: `WorkflowPost.ig_collaborators?: string[]` and `WorkflowPost.ig_collaborators_refused?: string[]`; mappers set `ig_collaborators: row.ig_collaborators ?? []` (refused likewise where selected); `PublishErrorCode` gains `'COLLABORATOR_INVALID'`; `PublishErrorAction` gains `'collaborators'`; `PUBLISH_ERROR_COPY.COLLABORATOR_INVALID = { titulo: 'O Instagram recusou um colaborador', explicacao: 'Confira se o @ está certo e se o perfil é público. Edite os colaboradores e tente novamente.', acao: 'collaborators', mostrarDetalhes: false }`; `retryInstagramPublish(postId: number, opts?: { clearCollaborators?: boolean }): Promise<{ ok: boolean }>` sends `body: JSON.stringify({ clearCollaborators: true })` only when set.
- `ig_collaborators_refused` is selected only in the lists the drawer/editor uses (`POST_CONTEXT_COLUMNS` and the full-post load), not in board/list column lists.

- [ ] **Step 1: Write failing tests**: column-string tests (existing `store.posts.test.ts` asserts exact strings: update them to include `ig_collaborators`); mapper maps `undefined` → `[]`; `getPublishErrorDisplay('COLLABORATOR_INVALID')` returns the copy above; `retryInstagramPublish(1, { clearCollaborators: true })` posts that JSON body and `retryInstagramPublish(1)` posts no `clearCollaborators`.
- [ ] **Step 2: Run** `npx vitest run apps/crm/src/__tests__/store.posts.test.ts <other test paths>` → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the same → PASS. Then `npx tsc -p apps/crm/tsconfig.json --noEmit` and fix any exhaustive switch/Record on `PublishErrorAction`/`PublishErrorCode` the compiler flags (but leave `PublishErrorBlock.tsx` rendering to Task 5; a `default` that renders nothing for `'collaborators'` is enough here if the compiler forces it).
- [ ] **Step 5: Commit** pathspec: `feat(crm): load ig_collaborators and add COLLABORATOR_INVALID copy`.

---

### Task 4: `InstagramCollaboratorsField` component

**Files:**
- Create: `apps/crm/src/pages/entregas/collaborators.ts` (pure helpers)
- Create: `apps/crm/src/pages/entregas/components/InstagramCollaboratorsField.tsx`
- Test: `apps/crm/src/pages/entregas/__tests__/collaborators.test.ts`, `apps/crm/src/pages/entregas/components/__tests__/InstagramCollaboratorsField.test.tsx`
- Styles: Tailwind utilities + existing tokens (`var(--danger-text)`, `var(--text-muted)`, `var(--border-color)`, `var(--surface-2)`); add CSS to `apps/crm/style.css` only if a rule cannot be expressed inline, under a `/* Instagram collaborators field */` block.

**Interfaces:**
- Produces:
  - `export const MAX_COLLABORATORS = 3`
  - `export function parseCollaboratorInput(raw: string): string[]` splits on commas, whitespace and newlines; for each piece: trim, extract `<user>` from `(https?://)?(www\.)?instagram\.com/<user>(/...|?...)`, strip one leading `@`, lowercase; drops empties.
  - `export function validateCollaborator(u: string, current: string[]): 'invalid' | 'duplicate' | 'limit' | null` (`invalid` when not `^[a-z0-9._]{1,30}$`; `duplicate` when in `current`; `limit` when `current.length >= 3`).
  - `export const COLLAB_ERROR_COPY: Record<'invalid'|'duplicate', (u: string) => string>` → `'Use só letras, números, ponto e sublinhado, sem espaços.'` and `` `@${u} já está na lista.` ``.
  - `export function InstagramCollaboratorsField(props: { value: string[]; onChange: (next: string[]) => void; locked?: boolean; trialOn?: boolean; refused?: string[]; inputRef?: React.Ref<HTMLInputElement>; idPrefix: string }): JSX.Element` (pure presentational; it never decides whether it should render; the parent gates it).
- Behavior (copy verbatim from the spec, "CRM UI" section): counter `N de 3`; chips with remove button `aria-label="Remover @u"`; input placeholder `Adicionar @usuário`; add on Enter / `,` / space / blur / paste (paste adds all valid pieces, reports the first error); input hidden at 3 with the limit help line; backspace on empty input removes the last chip; `locked` → chips without remove, no input, lock line `Cancelar agendamento para editar` (wins over `trialOn`); `trialOn` → whole field disabled with the trial line; chips in `refused` get the danger style + `AlertCircle` and the singular/plural refused line; `onChange` fires once per add/remove with the full next array. The own-account check from the spec is **not** implemented: the editor has no client username today (spec allows skipping).

- [ ] **Step 1: Write failing helper tests**: Review Focus 1 paste → `['dra.julia','clinicaviva','nutri.ana']`; `'instagram.com/clinicaviva'` → `['clinicaviva']`; `'@@x'` → `['@x']` (only one `@` stripped, then invalid); validate cases for each code including 30 vs 31 chars.
- [ ] **Step 2: Write failing component tests** (Testing Library + `userEvent`): typing `clinicaviva{enter}` calls `onChange(['clinicaviva'])`; `dra julia` shows the invalid copy and sets `aria-invalid`; duplicate copy; at 3 the input is gone and limit line shows; backspace removes last; remove button removes that chip; `locked` hides remove buttons and input and shows the lock line even with `trialOn`; `trialOn` shows the trial line; `refused={['clinicaviva']}` renders that chip with the refused line (singular) and two refused → plural; renders with `value={[]}`.
- [ ] **Step 3: Run** `npx vitest run apps/crm/src/pages/entregas/__tests__/collaborators.test.ts apps/crm/src/pages/entregas/components/__tests__/InstagramCollaboratorsField.test.tsx` → FAIL.
- [ ] **Step 4: Implement** both files; match the mockup's look (desktop board) with existing tokens.
- [ ] **Step 5: Run** → PASS; `npx eslint <your files>`; `npx prettier --check <your files>`.
- [ ] **Step 6: Commit** pathspec: `feat(crm): Instagram collaborators tag field`.

---

### Task 5: Editor integration, trial exclusion, self-heal, error block

**Files:**
- Modify: `apps/crm/src/pages/entregas/components/PostEditorBody.tsx` (placement near `instagramCaptionField :518`, phone section `:965-976`, self-heal `:798, :830, :1151, :1181`, `handleDestinationToggle :453`, desktop `TrialReelPanel :1441`)
- Modify: `apps/crm/src/pages/entregas/components/TrialReelPanel.tsx`
- Modify: `apps/crm/src/pages/entregas/components/PublishErrorBlock.tsx`
- Modify only if the multiplatform tab needs it: `DestinationCaptionTabs.tsx` (it takes an `instagramCaption: ReactNode` slot; prefer passing a fragment of caption + field through that slot and not touching this file)
- Test: `TrialReelPanel.test.tsx`, `PublishErrorBlock` test (grep or create `components/__tests__/PublishErrorBlock.test.tsx`), and the existing `PostEditorBody` tests (grep `__tests__` for `PostEditorBody`)

**Interfaces:**
- Consumes: Task 3 (`WorkflowPost.ig_collaborators`, `ig_collaborators_refused`, `retryInstagramPublish(id, { clearCollaborators: true })`, `acao: 'collaborators'`), Task 4 (`InstagramCollaboratorsField`).
- Produces: `TrialReelPanel` prop `collaboratorsCount: number` (required); `PublishErrorBlock` new optional prop `onEditCollaborators?: () => void`.

Rules:
- Gate for the field: `hasInstagramAccount && post.tipo !== 'stories' && isInstagramPost(post.platform)`. Value `post.ig_collaborators ?? []`; `onChange` → `onFieldChange('ig_collaborators', next)`; `locked={isScheduleLocked}`; `trialOn={!!post.ig_trial_strategy}`; `refused` only when `post.status === 'falha_publicacao' && post.publish_error_code === 'COLLABORATOR_INVALID'`.
- Desktop single-platform: render right after `instagramCaptionField(false)`, before `TrialReelPanel`. Desktop multiplatform: pass `<>{instagramCaptionField(true)}<InstagramCollaboratorsField …/></>` as `instagramCaption` (not for stories, which keep `storiesNote`). Phone: the Instagram section gate becomes the field gate above; `aria-label="Instagram"`; field first, then `TrialReelPanel` (which self-gates to reels).
- Self-heal at the four sites: when the new tipo is `stories` or the new platform is `tiktok` and `(post.ig_collaborators ?? []).length > 0`, call `onFieldChange('ig_collaborators', [])` and `toast.info` with the spec's exact string for that case.
- Multiplatform toggle: in `handleDestinationToggle`, when `platform === 'instagram' && !on` and the post had collaborators, after the toggle's mutation succeeds show `toast.info('Colaboradores removidos: o post não vai mais para o Instagram.')` and invalidate/refetch the post query the drawer uses (find the key the drawer reads; reuse `onRefresh` if it already refetches). Same for a set trial flag is out of scope (do not change trial behavior here).
- `TrialReelPanel`: precedence exactly as the spec's "Mutual exclusion" section.
- `PublishErrorBlock` for `acao === 'collaborators'`: "Tentar novamente" (existing `handleRetry`), "Editar colaboradores" (calls `onEditCollaborators`; the editor passes a callback that switches `captionTab` to `'instagram'` in multiplatform or `phoneTab` to `'publicar'` on phone, then focuses the field's input via `inputRef` in a `requestAnimationFrame`), and "Publicar sem colaboradores" opening an `AlertDialog` (shadcn, `components/ui/alert-dialog`) with the spec's title/body/confirm; confirm calls `retryInstagramPublish(post.id, { clearCollaborators: true })`, then the same success toast and `onStatusChange()` as retry; error → same error toast.

- [ ] **Step 1: Write failing tests**: `TrialReelPanel` with `collaboratorsCount={2}` → switch disabled + collaborators line; with `disabled` and `collaboratorsCount={2}` → lock line wins; `PublishErrorBlock` with `COLLABORATOR_INVALID` shows the three buttons, "Publicar sem colaboradores" → dialog → confirm calls `retryInstagramPublish` with `{ clearCollaborators: true }` (mock the service), "Editar colaboradores" calls the callback; `PostEditorBody`: feed + instagram renders the field, stories does not, tiktok-only does not, no account does not, fixture without `ig_collaborators` renders (Review Focus 3); tipo → stories with collaborators calls `onFieldChange('ig_collaborators', [])` and the toast; multiplatform toggle-off of Instagram with collaborators shows the toast after success (Review Focus 4).
- [ ] **Step 2: Run** those test files → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** → PASS; also run the whole `apps/crm/src/pages/entregas` Vitest folder to catch fixture breaks (`npx vitest run apps/crm/src/pages/entregas`). Add `collaboratorsCount` to any other `TrialReelPanel` call site.
- [ ] **Step 5: Commit** pathspec: `feat(crm): collaborators in the post editor`.

---

### Task 6: List and calendar indicators

**Files:**
- Modify: `apps/crm/src/pages/entregas/views/PostsListView.tsx` (desktop row `:311`, phone variant `:397`)
- Modify: `apps/crm/src/pages/entregas/components/CalendarPostDetailPanel.tsx` (`:98`)
- Test: `views/__tests__/PostsListView.test.tsx`, `PostsListViewPhone.test.tsx`, `components/__tests__/CalendarPostDetailPanel.test.tsx`

**Interfaces:**
- Consumes: Task 3 `WorkflowPost.ig_collaborators?: string[]` (and whatever list row type `PostsListView` uses; extend its mapper if it builds its own shape).
- Produces: nothing for later tasks.

Rules: desktop list renders, after the tipo badge and the "Teste" badge, `<span className="post-tipo-badge post-tipo-badge--collab" title="Colaboradores: @a, @b"><Users …/>Collab N</span>` when N > 0; add `.post-tipo-badge--collab` next to `.post-tipo-badge--trial` in `apps/crm/style.css` using the info badge tokens of that file (`grep -n "post-tipo-badge--trial" apps/crm/style.css`; mirror for dark mode the same way). Phone list: where `'Teste'` is pushed into the meta parts (`:397`), push `` `Collab ${n}` ``. Calendar panel: a "Colaboradores" row listing `@a, @b` in the panel's existing detail-row pattern, only when N > 0.

- [ ] **Step 1: Write failing tests**: list row with `ig_collaborators: ['a','b']` shows `Collab 2` with that title; none for `[]` or missing; phone meta contains `Collab 2`; calendar panel shows `@a, @b` under "Colaboradores", nothing when missing.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** pathspec: `feat(crm): collab badge in post list and calendar`.

---

### Task 7: Hub

**Files:**
- Modify: `supabase/functions/hub-posts/handler.ts` (`:167` select)
- Modify: `apps/hub/src/types.ts` (`:81`)
- Modify: `apps/hub/src/components/posts/PostDetailDialog.tsx` (near `:552-565`)
- Modify: `packages/i18n/locales/pt/hubPosts.json`, `packages/i18n/locales/en/hubPosts.json`
- Test: `supabase/functions/__tests__/hub-posts-modes_test.ts` (select assertion, if it asserts the select), `apps/hub/src/components/posts/__tests__/PostDetailDialog.test.tsx`

**Interfaces:**
- Produces: Hub `Post.ig_collaborators?: string[]`; i18n keys `hubPosts.collab.partnership` ("Em parceria com {{names}}" / "In partnership with {{names}}") and `hubPosts.collab.note` (pt: "No Instagram, o post vai aparecer também no perfil dessas contas, se elas aceitarem o convite." / en: "On Instagram, the post will also appear on these accounts' profiles once they accept the invite."). Names formatted with `Intl.ListFormat(locale, { style: 'long', type: 'conjunction' })` over `@`-prefixed names (pt yields "@a e @b", "@a, @b e @c").

- [ ] **Step 1: Write failing tests**: dialog shows "Em parceria com @a" (1), "@a e @b" (2), "@a, @b e @c" (3) and the note; nothing when `[]` or missing; hub-posts select includes `ig_collaborators` and not `ig_collaborators_refused`.
- [ ] **Step 2: Run** `npx vitest run apps/hub/src/components/posts/__tests__/PostDetailDialog.test.tsx` and `deno test --no-check supabase/functions/__tests__/hub-posts-modes_test.ts` → FAIL.
- [ ] **Step 3: Implement** (line with lucide `Users` icon under the type/platform line, `hub-tx2` text class like its neighbors).
- [ ] **Step 4: Run** → PASS; `npx tsc -p apps/hub/tsconfig.json --noEmit`.
- [ ] **Step 5: Commit** pathspec: `feat(hub): show Instagram collaborators on post detail`.

---

### Task 8: Whole-branch gates

- [ ] **Step 1:** `ls node_modules/.deno 2>/dev/null && npm ci` (Deno pollution), then run, all must pass:
  - `npm run lint`
  - `npm run format:check` (fix with `npx prettier --write <changed files>` only)
  - `npx tsc -p apps/crm/tsconfig.json --noEmit`, `npx tsc -p apps/hub/tsconfig.json --noEmit`, `npx tsc -p apps/admin/tsconfig.json --noEmit`, `npx tsc -p tsconfig.scripts.json`
  - `npm run test`
  - `npm run check:functions`, `npm run test:functions` (then restore `deno.lock` if dirtied)
  - `bash scripts/test-entitlements.sh` if local Supabase is available
- [ ] **Step 2:** `grep -rn "—" <every changed .tsx/.ts/.json/.sql file>` limited to user-facing strings: none added.
- [ ] **Step 3:** Commit any fixes with a pathspec.
