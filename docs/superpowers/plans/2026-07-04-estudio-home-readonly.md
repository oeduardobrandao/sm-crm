# Estúdio home + read-only mode (slice A2) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps
> use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Finish slice A of the design-first roadmap
(spec: `docs/superpowers/specs/2026-07-04-estudio-design-first-model.md` §Estúdio home):
`/estudio` becomes a real page — design gallery with render thumbnails and client filter,
"Novo design" format picker, per-card actions (abrir, duplicar, **aplicar a um post** with
VISIBLE eligibility, desvincular, excluir) — and locked-post designs open **read-only**
(fork `readOnly=1` + shell banner + "Duplicar" CTA; drawer shows "Ver no Estúdio").

**Architecture:** ZERO backend changes — every route this slice needs shipped in A1
(design-manage: POST /designs, attach/detach/duplicate, DELETE; designs RLS SELECT).
The gallery is a direct RLS select; thumbnails come from `render_manifest` (unattached
designs store it) or the post's design-origin media (attached), signed in one batch via
the existing `sign-r2-urls` flow (`resolveInlineImageUrls`). Read-only is already ENFORCED
server-side (`save_design_blob` → 403 `read_only`); the fork param + shell banner make it
visible instead of a failing autosave.

**Tech Stack:** React 19 + TanStack Query, shadcn/ui (dialog, alert-dialog, select,
dropdown-menu — all present in `components/ui/`), Vitest; fork = Vue 3 + bun (coordinated).

## Parallel-session coordination (READ FIRST)

- **Branch:** create `feat/estudio-home` off `feat/estudio-openpencil` (05b2729 = A1 +
  B-prep merged) in a git worktree. Merge back into `feat/estudio-openpencil` when done.
  NEVER merge to main.
- **The editor fork (`~/Projects/open-pencil-spike`, branch `mesaas`) is shared with the
  MCP/slice-B session.** Task 4 touches it: BEFORE starting Task 4, check whether that
  session is active; if yes, hand it the Task 4 spec verbatim instead of editing the fork
  yourself. The rest of this plan (Tasks 1–3, 5, 6) never touches the fork, `services/
  estudio-render`, or `supabase/functions/mcp/`.
- **Deploys:** none for edge functions. Task 4 redeploys the dark Vercel editor only.

## Global constraints (house rules + gotchas reconfirmed in A1)

- `npm run test:functions` pollutes `node_modules` via deno → run it BEFORE `npm run
  build`/`npm run test`, then `npm ci`. Revert a dirty root `deno.lock`.
- CI gates: `npm run test`, `npm run build`, `npm run lint` (0 errors), `npx prettier
  --write` on touched files.
- Worktrees have NO `.env` (untracked) — the CRM mounts a blank page with only a console
  error. `cp /Users/eduardosouza/Projects/sm-crm/.env <worktree>/` before any dev-server
  work.
- Live E2E: the PREVIEW-HARNESS browser (not claude-in-chrome) holds the prod test session,
  origin-scoped to `localhost:5174` (Vite lands there when 5173 is busy; 5174 is in prod
  `ALLOWED_ORIGINS`). Pick the `sb-skjzpekeqefvlojenfsw-*` localStorage key. In-page API
  probes via `preview_eval` only (never materialize the token into the transcript); anon
  key is public (`sb_publishable_aBuru8OZKei0Gby5-Ba6GQ_kwElYRnF`). Dispatch real
  PointerEvents for React clicks.
- Editable statuses: `rascunho | revisao_interna | correcao_cliente`. Attach-eligibility
  error codes (design-manage): `post_already_designed`, `post_not_editable`,
  `post_tipo_unsupported`, `post_has_video`, `design_already_attached`.
- Prod test data from A1's E2E: design 1 (attached to post 1113, DK TESTE), design 2
  (attached to post 971) — reusable for the gallery E2E.

---

### Task 1: Worktree + store layer (`store/designs.ts` grows reads + action wrappers)

**Files:**
- Modify: `apps/crm/src/store/designs.ts`
- Test: `apps/crm/src/store/__tests__/designs.test.ts` (new — pure helpers only)

- [x] **Step 1:** Worktree/branch off `feat/estudio-openpencil`; copy `.env` in.
- [x] **Step 2:** Extend `DesignSummary` with `cliente_id: number | null`,
  `render_manifest: Array<{ r2_key: string }> | null`, `updated_at: string`. Add:

```ts
/** Gallery list — direct RLS select, conta-scoped by policy. */
export async function listDesigns(clienteId?: number): Promise<DesignSummary[]>
  // .from('designs').select(...).order('updated_at', { ascending: false }).limit(100)
  // + .eq('cliente_id', clienteId) when set
export async function getDesign(designId: number): Promise<DesignSummary | null>
/** Action wrappers over design-manage (authed-fetch pattern already in createDesign): */
export async function duplicateDesign(id: number): Promise<{ design_id: number }>   // POST /designs/:id/duplicate
export async function attachDesign(id: number, postId: number): Promise<{ post_tipo: string }> // POST /designs/:id/attach
export async function detachDesign(id: number): Promise<void>                       // POST /designs/:id/detach → 204
export async function deleteDesign(id: number): Promise<void>                       // DELETE /designs/:id → 204
```

  Refactor the shared authed-fetch into one local `callDesignManage(path, method, body?)`
  helper (204 → no json parse; error body `{error}` → throw with the code as message).
- [x] **Step 3:** Thumbnail source resolution — pure, testable:

```ts
export interface DesignThumbSource { designId: number; r2Key: string | null }
/** Unattached: first render_manifest entry. Attached feed/carrossel: the post's
 * origin='design' cover link. Attached reel_cover: the post video's thumbnail_r2_key.
 * Null → placeholder (failed/never-rendered). */
export function pickThumbKey(design: DesignSummary, attachedMedia?: {
  coverKey?: string | null; videoThumbKey?: string | null }): string | null
```

  Plus `fetchAttachedThumbSources(postIds: number[])`: ONE batched RLS query
  `post_file_links?select=post_id,is_cover,origin,files!inner(r2_key,kind,thumbnail_r2_key)`
  filtered `post_id=in.(...)` → map post_id → { coverKey, videoThumbKey }. Sign all picked
  keys with the existing `resolveInlineImageUrls(keys)` (services/inlineImage.ts) in one
  batch from the page (Task 2), NOT here.
- [x] **Step 4:** Unit-test `pickThumbKey` (manifest wins when present; attached
  feed cover; reel video thumb; null fallback). `npm run test` green. Commit.

### Task 2: Estúdio home — gallery + Novo design

**Files:**
- Create: `apps/crm/src/pages/estudio/EstudioHome.tsx`,
  `apps/crm/src/pages/estudio/NewDesignDialog.tsx`
- Modify: `apps/crm/src/pages/estudio/EstudioPage.tsx` (designId === null → render
  `<EstudioHome/>` instead of the CenteredNotice), `packages/i18n/locales/{pt,en}/estudio.json`

- [x] **Step 1:** `EstudioHome`: `useQuery(['designs', clienteFilter], () =>
  listDesigns(clienteFilter))` + `useQuery(['clientes'], getClientes)` for the filter
  (shadcn Select, "Todos os clientes" default). Grid of cards (`kpi-card` styling family):
  thumbnail (signed URL via one `resolveInlineImageUrls` batch; neutral placeholder when
  null or `render_status==='failed'`), `name`, format badge, client name when set, status
  chip (`rendered`+fresh → nothing; `pending/rendering` or `is_stale` → "Gerando…";
  `failed` → "Falhou" badge-danger), attached indicator ("Post #id"). Card click → abrir
  (`navigate(/estudio/:id)`). Feature gate + empty state ("Nenhum design ainda" + CTA).
- [x] **Step 2:** Card overflow menu (dropdown-menu): **Abrir**, **Duplicar**
  (`duplicateDesign` → toast + navigate to the new id), **Aplicar a um post** (Task 3
  modal; hidden when attached), **Desvincular** (attached only; `detachDesign` → toast
  explaining media stays on the post — reuse spec wording), **Excluir** (alert-dialog
  confirm mentioning the design is permanently deleted, post media stays; `deleteDesign`).
  Every mutation invalidates `['designs']`; attached-post mutations also invalidate
  `['post-design-summary', post_id]`.
- [x] **Step 3:** `NewDesignDialog`: 4 format options (feed 4:5, carrossel 4:5,
  reel_cover 9:16, livre — small visual aspect hints) + optional client Select + optional
  name input → `createDesign({format, cliente_id?, name?})` → navigate to the editor.
  Pending state reuses `picker.creating`.
- [x] **Step 4:** i18n: add `home.*` keys (pt + en): title/subtitle reuse existing,
  `home.newDesign`, `home.allClients`, `home.empty`, `home.emptyCta`, `home.generating`,
  `home.renderFailed`, `home.attachedTo`, `home.actions.{open,duplicate,apply,detach,delete}`,
  `home.detachDone`, `home.deleteConfirm{Title,Body,Cta}`, `home.formats.{feed,carrossel,
  reel_cover,livre}` (+ short descriptions). Portuguese first-person product voice, match
  existing file tone.
- [x] **Step 5:** `npm run test`, `npm run build`, prettier+lint. Commit.

### Task 3: "Aplicar a um post" modal — eligibility made visible

**Files:**
- Create: `apps/crm/src/pages/estudio/ApplyToPostDialog.tsx`,
  `apps/crm/src/pages/estudio/applyEligibility.ts` (pure)
- Test: `apps/crm/src/pages/estudio/__tests__/applyEligibility.test.ts`
- Modify: `packages/i18n/locales/{pt,en}/estudio.json`

- [x] **Step 1:** `applyEligibility.ts` — the reason mapper the spec demands ("invalid
  targets are listed disabled WITH the reason — eligibility becomes visible, not a 403"):

```ts
export type IneligibleReason =
  | 'already_designed' | 'not_editable' | 'tipo_unsupported' | 'has_video' | null;
export function postEligibility(post: { id: number; tipo: string; status: string },
  designedPostIds: Set<number>, videoPostIds: Set<number>): IneligibleReason
```

  Order the checks exactly like the backend (tipo → status → designed → video) so the
  disabled reason always matches what the RPC would raise.
- [x] **Step 2:** Dialog flow: client Select (`getClientes`) → workflow Select
  (`getWorkflows()` filtered cliente + `status==='ativo'`) → post list
  (`getWorkflowPosts(workflowId)`), each row: title/tipo/status + enabled radio OR
  disabled row with the translated reason chip. Data for reasons, batched per workflow:
  `designs?select=post_id&post_id=in.(...)` and the video-media RLS query from Task 1's
  `fetchAttachedThumbSources` shape (`files.kind=eq.video`). Info line: applying re-renders
  and REPLACES the post's media; tipo will follow the design's frames (tipo-sync).
- [x] **Step 3:** Confirm → `attachDesign(designId, postId)`; success toast with
  `post_tipo`; RPC error codes → same translated reasons (belt for races). Invalidate
  `['designs']` + `['post-design-summary', postId]`.
- [x] **Step 4:** Unit-test `postEligibility` (each reason + eligible). i18n
  `apply.*` keys (title, steps, reasons.{already_designed,not_editable,tipo_unsupported,
  has_video}, confirm, success, info). Gates. Commit.

### Task 4: Fork `readOnly=1` embed param — COORDINATED (see header)

**Files (fork `~/Projects/open-pencil-spike`, branch `mesaas` — NOT this repo):**
- embedConfig plumbing (their existing `embed=1` param parsing), toolbar/canvas
  interaction gating, autosave scheduler, bridge `save` handler; `UPSTREAM.md`

- [x] **Step 1:** COORDINATION GATE: if the MCP/slice-B session is active, hand it this
  task and wait; otherwise proceed yourself following the fork's conventions (`// MESAAS:`
  markers, changes gated on `embedConfig`, `bun test tests/engine/`, oxlint strict, build
  `bun --bun`).
- [x] **Step 2:** `readOnly=1` URL param → `embedConfig.readOnly`: canvas tools locked to
  select/pan (no create/edit/delete mutations), autosave scheduler never arms, incoming
  bridge `save` message ignored; doc load + `doc:loaded` + zoom/pan unchanged. No `dirty`
  events ever emitted.
- [x] **Step 3:** Fork tests green; redeploy the dark Vercel editor; smoke an
  `embed=1&readOnly=1&docUrl=…` boot locally (editor on :1420) confirming edits are
  impossible and no PUT ever fires (network tab clean).
- [x] **Step 4:** Document the param in `docs/estudio-v2-editor-contract.md` (embed URL
  shape + bridge behavior deltas) — commit in THIS repo.

### Task 5: Shell read-only + drawer "Ver no Estúdio"

**Files:**
- Modify: `apps/crm/src/pages/estudio/EstudioPage.tsx`,
  `apps/crm/src/pages/estudio/embedHost.ts` (`buildEditorUrl` grows `readOnly` flag),
  `apps/crm/src/pages/entregas/components/WorkflowDrawer.tsx`,
  `packages/i18n/locales/{pt,en}/estudio.json`
- Test: `apps/crm/src/pages/estudio/__tests__/embedHost.test.ts`

- [x] **Step 1:** EstudioPage: `useQuery(['design-meta', designId], () =>
  getDesign(designId))`; when `post_id` set, fetch the post's status (one RLS select).
  `readOnly = attached && !EDITABLE_STATUSES.includes(post.status)`. Editor URL gets
  `readOnly=1` (new `buildEditorUrl` arg; update tests). Hide save pill + "Salvar agora";
  show an amber banner: `t('editor.readOnlyBanner')` ("Este design pertence a um post
  aprovado — somente leitura.") + **Duplicar** button (`duplicateDesign` → navigate new id,
  which opens EDITABLE since the copy is detached). Keep the dirty guards inert (editor
  never emits dirty in readOnly).
- [x] **Step 2:** WorkflowDrawer button matrix (spec parity):
  - designless + editable → "Abrir no Estúdio" (create-attached; unchanged)
  - designless + locked → button HIDDEN
  - designed + editable → "Abrir no Estúdio" (open; unchanged)
  - designed + locked → label `t('viewInEstudio')` ("Ver no Estúdio"), same navigate.
- [x] **Step 3:** i18n (`editor.readOnlyBanner`, `editor.duplicate`, `viewInEstudio`).
  Belt check: with a fork WITHOUT readOnly support (param ignored), the shell banner still
  renders and a stray autosave gets the backend 403 `read_only` → editor toast — accepted
  degraded mode; note it in the contract doc.
- [x] **Step 4:** Gates (vitest incl. embedHost URL tests, build, lint, prettier). Commit.

### Task 6: Full gates + live E2E + docs/memory

- [x] **Step 1:** Full suite order: `npm run test:functions` (should be UNTOUCHED — no
  edge changes; still run it) → revert `deno.lock` → `npm ci` → `npm run test` →
  `npm run build` → `npm run lint` → prettier check.
- [x] **Step 2:** Live E2E on prod (preview harness, DK TESTE): (a) `/estudio` gallery
  lists designs 1+2 with real thumbnails + client filter works; (b) Novo design `livre` →
  editor opens, gallery shows it "Gerando…" → placeholder-or-thumb (empty livre fails
  render by design — placeholder accepted); (c) Duplicar design 1 → new detached copy
  opens editable; (d) Aplicar: pick the copy → DK TESTE → workflow → post list shows
  disabled reasons (post 1113/971 = "já tem design"; stories post = tipo; aprovado post =
  status) → attach to an eligible post → media lands after render; (e) Desvincular →
  post media stays, design card shows detached; (f) Excluir the livre design → gone from
  gallery, `file_deletions` got its doc key (in-page RLS check); (g) read-only: flip an
  attached design's post to a locked status via the drawer STATUS select → design opens
  with banner + no editing + Duplicar works → flip the status back; (h) drawer on that
  locked post showed "Ver no Estúdio".
- [x] **Step 3:** Update `docs/estudio-v2-editor-contract.md` (readOnly param — if not
  already in Task 4), append findings to `spike/openpencil/NOTES.md`, update memory
  `project_estudio_openpencil_pivot.md` (**SLICE A COMPLETE** — A2 done; next = slice B
  MCP rewrite, then C image→editable). Merge back into `feat/estudio-openpencil`
  (fast-forward from the main checkout if clean; otherwise merge openpencil in first,
  re-run gates, then ff). Tell Eduardo slice A is done and offer the slice B/C planning.
