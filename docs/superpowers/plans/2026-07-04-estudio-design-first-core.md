# Estúdio design-first core (slice A1) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps
> use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace post-keyed design ownership (`post_designs`) with first-class `designs`
(spec: `docs/superpowers/specs/2026-07-04-estudio-design-first-model.md`) — explicit
creation, optional client, 1:1 post attachment with eligibility validated at attach time —
at behavior parity with today's drawer flow, plus complete backend APIs for
attach/detach/duplicate/delete (UI for those lands in slice A2).

**Architecture:** New `designs` table + RPCs replace `post_designs` and its RPCs (rows are
test data; the feature ships dark — wipe freely). New edge function `design-manage`
(modeled on `post-design-manage`, which it replaces) serves the same frozen blob contract
keyed by `design_id` and adds design CRUD + attach/detach/duplicate. `design-render`,
the sweep cron, the publish gate and reel-cover staleness re-point to `designs`; media
application and tipo-sync run only for designs attached to an editable post. The CRM
shell switches to `/estudio/:designId`; the drawer resolves-or-creates a design, then
navigates.

**Tech Stack:** Postgres (SECURITY DEFINER RPCs), Deno edge functions (deps-injected
handlers + `npm run test:functions`), React 19 + TanStack Query, Vitest.

## Parallel-session coordination (READ FIRST)

Another session is concurrently building the MCP/doc-service work on the same initiative.

- **Branch:** create `feat/estudio-design-first` off `feat/estudio-openpencil`, in a git
  worktree (superpowers:using-git-worktrees) so the main checkout stays free. Merge back
  into `feat/estudio-openpencil` when done. NEVER merge to main (the initiative cuts over
  later).
- **Do NOT touch (owned by the other session):** `services/estudio-render/`,
  `supabase/functions/mcp/`, `supabase/functions/_shared/design-doc.ts`,
  `~/Projects/open-pencil-spike` (the editor fork). The deployed v1 MCP design tools will
  be runtime-broken by the table drop — expected and accepted (dark, test-only; slice B
  rewrites them). Their Deno tests stay green (fully mocked) — leave them alone.
- **Deploys:** this plan owns deploying `design-manage`, `design-render`,
  `design-render-sweep-cron`, and every function that imports the shared modules changed
  here. The other session deploys nothing overlapping.

## Global constraints (house rules — violating these has bitten us before)

- Repo's supabase CLI link points at STAGING (`wlyzhyfondykzpsiqsce`). Prod is
  `skjzpekeqefvlojenfsw`. ALWAYS `cat supabase/.temp/project-ref` before any `--linked`
  command. Prod deploys: `npx supabase functions deploy <fn> --use-api --no-verify-jwt
  --project-ref skjzpekeqefvlojenfsw` (local Docker bundler is broken; `--use-api` is
  mandatory).
- Migrations are applied to PROD BY EDUARDO via the SQL editor (db push is blocked by a
  dup-timestamp in history). Write the file, then STOP and ask him to apply it; verify
  after.
- Edge tests: `npm run test:functions` (bare `deno test` breaks on zod resolution). If
  the root `deno.lock` changes, revert it (`git checkout deno.lock`);
  `supabase/functions/deno.lock` may change only for intentional dep adds.
- Frontend: `npm run test` (vitest), `npm run build` (tsc gate). CI also enforces
  `npm run lint` (0 errors; warnings exist and are tolerated) and
  `npx prettier --write` on touched files.
- Blob contract (frozen): `docs/estudio-v2-editor-contract.md` — Bearer auth,
  `x-rev`/`x-expected-rev`, 401/403/404/409/413/422, CORS exposes `x-rev`, allows
  `x-expected-rev`/`x-editor-version`. Do not change semantics, only the key
  (`design_id` instead of `post_id`).
- Editable post statuses: `rascunho | revisao_interna | correcao_cliente`. Saving while
  in `correcao_cliente` flips the post to `revisao_interna` (keep this side effect for
  ATTACHED designs).
- NEVER pass secrets as CLI literals; `supabase secrets set --env-file` needs a RELATIVE
  path.

---

### Task 1: Worktree + migration `20260705000001_designs_first_class.sql`

**Files:**
- Create: `supabase/migrations/20260705000001_designs_first_class.sql`
- Read for reference: `supabase/migrations/20260702000001_post_designs.sql` (v1 table:
  copy FK targets, RLS policy shape, grants, finalize/fail RPC media semantics EXACTLY),
  `supabase/migrations/20260704000001_post_designs_blob.sql` (blob RPC style),
  `supabase/migrations/20260704000002_claim_design_render_blob.sql` (claim + reap logic)

- [ ] **Step 1:** Create the worktree/branch: `git worktree add ../sm-crm-design-first -b
  feat/estudio-design-first feat/estudio-openpencil` and work there.
- [ ] **Step 2:** Read the three reference migrations end-to-end. The new SQL must mirror
  their FK targets, RLS (`authenticated` gets SELECT-only via conta match), grants, and
  the media-link-swap/staleness semantics inside `finalize_design_render`.
- [ ] **Step 3:** Write the migration with these sections (complete logic, adapt names
  from references):

```sql
-- 1. New first-class designs table (test data only in post_designs — dropped, not migrated)
create table public.designs (
  id             bigint generated always as identity primary key,
  conta_id       uuid   not null,                    -- FK target: copy from post_designs
  cliente_id     bigint,                             -- FK: clientes(id), nullable
  post_id        bigint unique,                      -- FK: workflow_posts(id); 1:1 attachment
  name           text   not null default 'Design sem título',
  format         text   not null check (format in ('feed','carrossel','reel_cover','livre')),
  rev            integer not null default 1,
  doc_r2_key     text   not null,
  doc_hash       text   not null,
  doc_bytes      integer not null,
  editor_version text,
  render_status  text   not null default 'pending'
                 check (render_status in ('pending','rendering','rendered','failed')),
  is_stale       boolean not null default true,
  render_error   text,
  render_manifest jsonb,
  render_started_at timestamptz,
  created_by     uuid,
  updated_by     uuid,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index designs_conta_idx on public.designs (conta_id, updated_at desc);
-- RLS: SELECT for authenticated within the conta (copy the post_designs policy verbatim,
-- swap table). All writes go through SECURITY DEFINER RPCs (service role).

-- 2. RPCs (all SECURITY DEFINER, service-role pattern from the reference migrations):
-- create_design(p_conta uuid, p_cliente bigint, p_post bigint, p_format text, p_name text,
--               p_r2_key text, p_doc_hash text, p_doc_bytes int, p_created_by uuid)
--   → inserts rev 1; if p_post not null: assert post belongs to conta, status editable,
--     no other design attached (unique post_id also enforces), copy cliente from post.
--   Returns o_id bigint.
-- save_design_blob(p_conta, p_design_id, p_expected_rev, p_doc_hash, p_r2_key,
--                  p_doc_bytes, p_editor_version, p_updated_by)
--   → rev CAS (raise 'rev_conflict'); if attached: post must be editable else raise
--     'read_only'; correcao_cliente → revisao_interna side effect (attached only);
--     resets render_status='pending', is_stale=true; returns o_rev, o_prev_r2_key.
-- attach_design(p_conta, p_design_id, p_post_id, p_updated_by)
--   → raise 'design_not_found' / 'design_already_attached' / 'post_not_found' /
--     'post_not_editable' / 'post_already_designed'; sets post_id + cliente_id from post;
--     marks is_stale=true, render_status='pending' (media applies on next render);
--     returns o_post_tipo text (for the render trigger).
-- detach_design(p_conta, p_design_id) → post_id := null. (Media already on the post stays;
--   it simply stops updating — document this in a comment.)
-- duplicate_design(p_conta, p_design_id, p_new_r2_key, p_created_by)
--   → inserts a copy (rev 1, post_id null, name || ' (cópia)', render pending/stale);
--     returns o_id. (Handler copies the blob bytes in R2 BEFORE calling.)
-- delete_design(p_conta, p_design_id) → deletes row, returns doc_r2_key + manifest keys
--   for the handler to queue into file_deletions (mirror delete_post_design).
-- claim_design_render(p_design_id) → port claim_design_render_blob 1:1 to designs, with
--   LEFT JOIN workflow_posts: returns doc_r2_key, doc_hash, editor_version, conta_id,
--   rev, post_id (nullable), post_tipo (nullable), post_status (nullable), format.
--   Keep FOR UPDATE, 3-min reclaim, superseded-manifest reap into file_deletions.
-- finalize_design_render(p_design_id, p_claimed_hash, p_manifest) + fail_design_render:
--   recreate against designs. finalize applies media links (origin='design') + returns
--   'rendered'|'stale' EXACTLY as v1 — but ONLY when post_id is not null AND the post is
--   still editable; otherwise store manifest + mark rendered, skip media entirely.

-- 3. Drop the old world: drop table post_designs cascade; drop functions
--    get_or_create_post_design_blob, save_post_design_blob, delete_post_design,
--    claim_design_render_blob (the old finalize/fail get replaced by the new bodies).
```

- [ ] **Step 4:** Self-check the SQL against the reference migrations (FK targets, RLS,
  grants, error message strings — handlers map on exact SQLERRM text).
- [ ] **Step 5:** Commit (`feat(estudio): designs first-class — schema + RPCs`). Then ask
  Eduardo to apply it on PROD via the SQL editor and confirm before continuing (later
  tasks deploy functions that require it).

### Task 2: `livre` starter template

**Files:**
- Modify: `scripts/estudio/build-starter-figs.mjs`,
  `supabase/functions/post-design-manage/starter-templates.gen.ts` (regenerated; moves in
  Task 3)

- [ ] **Step 1:** Add a `livre` variant to the generator: page "Canvas", NO frame (free
  canvas). Follow the existing three variants.
- [ ] **Step 2:** Regenerate (`node scripts/estudio/build-starter-figs.mjs`) and change
  the exported helper to `starterTemplateFor(format: 'feed'|'carrossel'|'reel_cover'|'livre')`.
- [ ] **Step 3:** Commit.

### Task 3: `design-manage` edge function (replaces `post-design-manage`)

**Files:**
- Create: `supabase/functions/design-manage/{handler.ts,index.ts,starter-templates.gen.ts}`
  (start by `git mv supabase/functions/post-design-manage supabase/functions/design-manage`)
- Modify: `supabase/config.toml` (rename the `[functions.post-design-manage]` entry to
  `[functions.design-manage]`, keep `verify_jwt = false`)
- Test: `supabase/functions/__tests__/design-manage_test.ts` (rename + rewrite of
  `post-design-manage_test.ts` — 18 existing contract tests are the parity baseline)

Routes (auth preamble, feature gate, CORS override with `x-expected-rev`/
`x-editor-version` + expose `x-rev`, MAX_BLOB_BYTES 413, audit log, `waitUntil` render
trigger — ALL unchanged from the old handler):

| Route | Behavior |
|---|---|
| `POST /designs` | body `{format, cliente_id?, post_id?, name?}`. If `post_id`: post must exist in conta (404), tipo != stories + supported (422 `post_tipo_unsupported`), no video media for feed/carrossel (422 `post_has_video`), editable status (403 `post_not_editable`); format derives from post tipo (feed→feed, carrossel→carrossel, reels→reel_cover) overriding body. Puts starter blob at `designs/{conta}/{design_id}-r1.fig` — NOTE: id unknown before insert, so: call `create_design` with a PLACEHOLDER key, then put blob at the real key and UPDATE… simpler and race-free: put starter at `designs/{conta}/tmp-{uuid}.fig`, call RPC with that key — the first save re-keys to `-r2`; OR pre-generate `crypto.randomUUID()` key permanently (`designs/{conta}/{uuid}-r1.fig`). CHOOSE: uuid-keyed blobs (`designs/{conta}/{uuid}-r{rev}.fig`) — drop the id-coupling entirely, keep rev suffix. Returns 201 `{design_id}`. Fires render trigger. |
| `GET /blob?design_id=` | plain fetch (404 if no row) — minting is gone. 200 + `x-rev` + bytes. |
| `PUT /blob?design_id=` | unchanged contract; `save_design_blob` errors map: `rev_conflict`→409, `read_only`→403 `{error:"read_only"}`, `post_not_editable`→403. New blob key `designs/{conta}/{uuid}-r{expected+1}.fig`; best-effort delete of prev key; re-fires render. |
| `POST /designs/:id/attach` | body `{post_id}`. Handler pre-checks video media (422 `post_has_video`) + tipo supported (422), then `attach_design` RPC (its errors → 403/404/409 `post_already_designed`). Fires render (media applies on finalize). 200 `{post_tipo}`. |
| `POST /designs/:id/detach` | 204. |
| `POST /designs/:id/duplicate` | fetch blob → put at new uuid r1 key → `duplicate_design` → 201 `{design_id}`. |
| `DELETE /designs/:id` | `delete_design` → queue returned keys into `file_deletions` → 204. (Replaces old `DELETE ?post_id=`.) |
| `POST /brand-logo` | keep EXACTLY as-is (client-scoped, unrelated to the model change). |

- [ ] **Step 1:** `git mv`, rename the exported factory to `createDesignManageHandler`,
  update `config.toml`.
- [ ] **Step 2:** Rewrite the deps interface: replace `getOrCreateDesignBlob`/
  `saveDesignBlob(post…)`/`deleteDesign` with `createDesign`, `saveDesignBlob(designId…)`,
  `attachDesign`, `detachDesign`, `duplicateDesign`, `deleteDesign`, and
  `getDesign(designId, contaId)` (RLS-equivalent service read returning
  `{id, rev, doc_r2_key, post_id, format}`). Keep `getPost`, `hasVideoMedia`,
  `clienteExists`, blob/trigger/audit deps.
- [ ] **Step 3:** Implement routes per the table. Wire `index.ts` to the new RPCs
  (`create_design`, `save_design_blob`, `attach_design`, `detach_design`,
  `duplicate_design`, `delete_design`) following the existing `.rpc(...)` wiring style.
- [ ] **Step 4:** Rewrite the test file: keep the 18 parity cases (renamed to design_id
  semantics; GET-mints cases become POST /designs cases) and ADD: POST with post_id on
  non-editable post → 403; POST on stories → 422; attach happy path fires trigger with
  new rev; attach to already-designed post → 409; PUT on design attached to locked post →
  403 read_only; duplicate returns new id and copies blob (spy `fetchBlob`+`putBlob`);
  DELETE queues manifest keys. Follow the existing deps-injected mock style — e.g.:

```ts
Deno.test("POST /designs with post_id on approved post → 403 post_not_editable", async () => {
  const deps = makeDeps({ post: { id: 9, tipo: "feed", status: "aprovado" } });
  const res = await handler(req("POST", "/designs", { post_id: 9, format: "feed" }));
  assertEquals(res.status, 403);
  assertEquals((await res.json()).error, "post_not_editable");
});
```

- [ ] **Step 5:** `npm run test:functions` → all green (design-manage tests + the
  untouched suites). Revert root `deno.lock` if dirty. Commit.

### Task 4: `design-render` + sweep cron on `designs`

**Files:**
- Modify: `supabase/functions/design-render/{handler.ts,index.ts}`,
  `supabase/functions/design-render-sweep-cron/index.ts`
- Test: `supabase/functions/__tests__/design-render_test.ts`

- [ ] **Step 1:** `index.ts`: `claim_design_render_blob` → `claim_design_render`; claim
  row now carries nullable `post_id`/`post_tipo`/`post_status` + `format`.
- [ ] **Step 2:** `handler.ts`: tipo for the render-service call =
  `post_tipo ?? ({feed:'feed', carrossel:'carrossel', reel_cover:'reels', livre:'carrossel'})[format]`.
  After finalize: run `syncPostTipo` ONLY when `post_id != null` and post editable and
  derived tipo differs (as today). Unattached designs whose frames fail validation (e.g.
  empty `livre` canvas) → `fail_design_render` with the tenant message, exactly like
  today — gallery shows a placeholder; acceptable for A1.
- [ ] **Step 3:** Sweep cron `index.ts`: `.from("post_designs")` → `.from("designs")`
  (same columns).
- [ ] **Step 4:** Update the 9 design-render tests (claim shape) + add: unattached design
  renders → no media application (spy), no tipo-sync; attached-but-locked post → finalize
  skips media (matches the RPC branch). `npm run test:functions` green. Commit.

### Task 5: Publish gate + reel-cover staleness on `designs`

**Files:**
- Modify: `supabase/functions/_shared/instagram-publish-utils.ts` (`checkDesignReadiness`),
  `supabase/functions/_shared/reel-cover-staleness.ts`
- Test: `instagram-publish-gate_test.ts`, `instagram-publish-validate_test.ts`,
  `instagram-publish-validation_test.ts`, `reel-cover-staleness_test.ts`,
  `file-upload-finalize_test.ts`, `shared_test.ts`, `config-audit_test.ts` (update any
  `post_designs`/`post-design-manage` expectations)

- [ ] **Step 1:** `checkDesignReadiness`: `.from("designs")` — same columns/semantics (a
  post with an ATTACHED design must be rendered+fresh; no attached design → ready).
- [ ] **Step 2:** `reel-cover-staleness.ts` — this module still reads v1 columns
  (`doc->>format`, writes `rendered_doc_hash`) that no longer exist: REWORK, don't just
  rename. New logic: select `id, rev, format` from `designs` where `post_id = X`; if
  `format === 'reel_cover'` → `update designs set is_stale = true` (v2 staleness).
- [ ] **Step 3:** Fix all listed tests' mock shapes; `npm run test:functions` fully green.
  Commit.

### Task 6: CRM rewire — store, drawer, shell

**Files:**
- Create: `apps/crm/src/store/designs.ts` (replaces `store/postDesigns.ts` — delete it)
- Modify: `apps/crm/src/store/index.ts` (export swap),
  `apps/crm/src/pages/entregas/components/WorkflowDrawer.tsx`,
  `apps/crm/src/pages/estudio/EstudioPage.tsx`, `apps/crm/src/pages/estudio/embedHost.ts`,
  `apps/crm/src/App.tsx` (route param), `packages/i18n/locales/{pt,en}/estudio.json`
- Test: `apps/crm/src/pages/estudio/__tests__/embedHost.test.ts`

- [ ] **Step 1:** `store/designs.ts`:

```ts
export interface DesignSummary {
  id: number; rev: number; render_status: 'pending'|'rendering'|'rendered'|'failed';
  is_stale: boolean; post_id: number | null; format: string; name: string;
}
/** RLS select — never the edge fn (creation is explicit now). Null = post has no design. */
export async function getDesignForPost(postId: number): Promise<DesignSummary | null> { /* .from('designs').eq('post_id', postId).maybeSingle() */ }
/** POST design-manage/designs with the user's token — mirror the authed-fetch pattern in services/postMedia.ts. */
export async function createDesign(input: { post_id?: number; format?: string }): Promise<{ design_id: number }> { … }
```

- [ ] **Step 2:** WorkflowDrawer: query key `['post-design-summary', post.id]` keeps its
  options but calls `getDesignForPost`; button handler becomes: design exists →
  `navigate(\`/estudio/\${design.id}\`)`; none → `createDesign({post_id})` mutation
  (button shows `t('picker.creating')` while pending, toast on error) → navigate to the
  returned id. `PostMediaGallery` keeps receiving the summary (same fields it uses).
- [ ] **Step 3:** Shell: route + param `:postId`→`:designId` (App.tsx + EstudioPage),
  `buildDocUrl(designId…)` → `…/design-manage/blob?design_id=`, header chip `#designId`.
  Update `embedHost.test.ts` URL expectations. Vite proxy needs NO change (path-agnostic).
- [ ] **Step 4:** `npm run test`, `npm run build`, prettier+lint on touched files. Commit.

### Task 7: Delete the old function + full-suite gate

- [ ] **Step 1:** Confirm `post-design-manage` dir is gone (Task 3 mv), no stray imports:
  `grep -rn "post-design-manage\|post_designs\|postDesigns" apps/ supabase/functions/ packages/ --include="*.ts*" | grep -v mcp/ | grep -v design-doc` → ONLY hits in docs/spike
  history and the migration itself.
- [ ] **Step 2:** Full gates: `npm run test`, `npm run test:functions`, `npm run build`,
  `npm run lint` (0 errors), `npx prettier --check` on touched files. Commit fixes if any.

### Task 8: Deploy to prod + live E2E + docs

- [ ] **Step 1:** Confirm with Eduardo that the Task 1 migration is applied on prod.
- [ ] **Step 2:** Enumerate deploy set: `design-manage`, `design-render`,
  `design-render-sweep-cron`, plus every fn importing the changed shared modules:
  `grep -rln "instagram-publish-utils\|reel-cover-staleness" supabase/functions --include="*.ts" | cut -d/ -f3 | sort -u` (expect instagram-publish, file-upload-finalize,
  post-media-manage, hub fns…). Deploy each:
  `npx supabase functions deploy <fn> --use-api --no-verify-jwt --project-ref skjzpekeqefvlojenfsw`.
  Note: `instagram-publish` keeps its gateway JWT — deploy it WITHOUT `--no-verify-jwt`
  (it is NOT in config.toml; check before deploying).
- [ ] **Step 3:** Delete the orphaned prod fn:
  `npx supabase functions delete post-design-manage --project-ref skjzpekeqefvlojenfsw`.
- [ ] **Step 4:** Live E2E on prod (preview harness; login = test@mesaas.com / DK TESTE;
  pick the PROD `sb-skjzpekeqefvlojenfsw-auth-token` localStorage key — a stale staging
  key coexists; Vite may grab a different port than the harness reports — read the
  server log). Verify: (a) drawer on a designless editable post → creates design +
  editor opens + autosave bumps rev + render lands as post media; (b) POST /designs
  standalone (in-page fetch) → design row, render runs, NO post media touched;
  (c) attach it to an editable post (in-page fetch) → render applies media + tipo-sync;
  (d) PUT with stale rev → 409; (e) drawer on a post with a design → opens same design.
  All API probes run IN-PAGE via `preview_eval` (never materialize the token into the
  transcript).
- [ ] **Step 5:** Update `docs/estudio-v2-editor-contract.md` (docUrl shape →
  `design-manage/blob?design_id=`), append findings to `spike/openpencil/NOTES.md`,
  update the memory file `project_estudio_openpencil_pivot.md` (A1 done, A2 next).
  Commit. Tell Eduardo A1 is done and offer to write the A2 plan (Estúdio home gallery +
  novo design + aplicar picker + fork readOnly mode — fork work must be coordinated with
  the MCP session first).
