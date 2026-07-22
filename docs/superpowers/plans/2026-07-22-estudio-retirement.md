# Estúdio Retirement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the Estúdio design editor and AI image generation from Mesaas entirely — CRM UI, edge functions, shared modules, database objects, and external infrastructure — leaving post media upload/attach fully intact.

**Architecture:** Strict callers-before-callees ordering. CRM UI first (reversible, no data risk), then edge functions, then plan entitlements, then the irreversible database drop, then external infrastructure. Two columns added by the Estúdio migration are **retained** because surviving features depend on them: `hub_brand.logo_file_id` (client brand kit / Hub whitelabel) and `post_file_links.origin` (media pipeline). The MCP connector slice is already complete on branch `claude/mesaas-connector-expiration-9c3bad`.

**Tech Stack:** React 19 + TanStack Query + Vitest (CRM), Deno edge functions + `deno test` (backend), Postgres migrations via Supabase CLI, pg_cron, Cloudflare R2, Vercel.

## Global Constraints

- **All existing design data is test data and is safe to delete** (confirmed by Eduardo, 2026-07-22). No media-preservation migration is required.
- **Never drop `hub_brand.logo_file_id`.** Added by `20260702000001_post_designs.sql` but consumed by the client brand kit: `apps/crm/src/pages/cliente-detalhe/HubTab.tsx`, `apps/crm/src/store/hub.ts`, `supabase/functions/_shared/brand-logo.ts`.
- **Never drop `post_file_links.origin`.** Consumed by `apps/crm/src/store/posts.ts` and the media gallery. Backfill `'design'` → `'manual'` instead.
- **Never delete `supabase/functions/mcp/media.ts`** or the `create_media_upload` / `set_post_media` tools — uploading images and video to a post must keep working.
- Migration filenames MUST use a unique timestamp prefix (the digits before the first `_`). The `migration-version-guard` CI job fails on duplicates.
- Run `npm run lint`, `npm run format:check`, `npm run test`, and `npm run test:functions` before pushing — all four are CI gates.
- `npm run test:functions` dirties root `deno.lock` and pollutes shared `node_modules`. After running it: `git checkout -- deno.lock`, and run `npm ci` before any `tsc`/`vitest` run.
- Prod project ref is `skjzpekeqefvlojenfsw`; staging is `wlyzhyfondykzpsiqsce`. Link state flips — always `cat supabase/.temp/project-ref` and translate before any `--linked` command.

---

### Task 1: Remove the Estúdio page, route, and nav entry

Self-contained: deletes the standalone Estúdio surface. `WorkflowDrawer` still imports from `pages/estudio/` after this task, so those two imports are temporarily preserved by moving the files they need — that move happens in Task 2. To keep this task independently green, delete only the files nothing outside `pages/estudio/` imports.

**Files:**
- Delete: `apps/crm/src/pages/estudio/EstudioPage.tsx`, `EstudioHome.tsx`, `NewDesignDialog.tsx`, `ApplyToPostDialog.tsx`, `embedHost.ts`
- Delete: `apps/crm/src/pages/estudio/__tests__/EstudioPage.test.tsx`, `__tests__/embedHost.test.ts`
- Modify: `apps/crm/src/App.tsx:39` (lazy import), `:135-136` (routes)
- Modify: `apps/crm/src/components/layout/nav-data.ts:85-91` (nav item), `:212-214` (feature flag map)

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `/estudio` and `/estudio/:designId` routes no longer exist; nav id `estudio` no longer exists. `apps/crm/src/pages/estudio/applyEligibility.ts` and `ImportToEstudioDialog.tsx` still exist and are still imported by `WorkflowDrawer` — Task 2 removes them.

- [ ] **Step 1: Confirm the surviving importers before deleting**

Run:
```bash
grep -rn "pages/estudio" apps/crm/src --include="*.ts" --include="*.tsx" | grep -v "^apps/crm/src/pages/estudio/"
```
Expected: exactly three lines — `App.tsx:39`, `WorkflowDrawer.tsx:97` (`applyEligibility`), `WorkflowDrawer.tsx:98` (`ImportToEstudioDialog`). If anything else appears, stop and re-scope.

- [ ] **Step 2: Delete the standalone page files**

```bash
git rm apps/crm/src/pages/estudio/EstudioPage.tsx \
       apps/crm/src/pages/estudio/EstudioHome.tsx \
       apps/crm/src/pages/estudio/NewDesignDialog.tsx \
       apps/crm/src/pages/estudio/ApplyToPostDialog.tsx \
       apps/crm/src/pages/estudio/embedHost.ts \
       apps/crm/src/pages/estudio/__tests__/EstudioPage.test.tsx \
       apps/crm/src/pages/estudio/__tests__/embedHost.test.ts
```

- [ ] **Step 3: Remove the route and lazy import from `App.tsx`**

Delete line 39:
```tsx
const EstudioPage = lazy(() => import('./pages/estudio/EstudioPage'));
```

Delete lines 135-136:
```tsx
                <Route path="/estudio" element={<EstudioPage />} />
                <Route path="/estudio/:designId" element={<EstudioPage />} />
```

- [ ] **Step 4: Remove the nav entry from `nav-data.ts`**

Delete the nav item (lines 85-91):
```ts
      {
        id: 'estudio',
        route: '/estudio',
        label: 'Estúdio',
        labelKey: 'nav.estudio',
        icon: 'ph-magic-wand',
      },
```

Delete the feature-flag map entry (lines 212-214), including its now-orphaned comment:
```ts
  // The nav item itself ships in slice 2 (apps/crm/src/pages/estudio/); this entry lands now
  // so the flag is never `undefined` (which getNavGroups treats as visible) by the time it does.
  estudio: 'feature_estudio',
```

- [ ] **Step 5: Typecheck and test**

Run:
```bash
npx tsc -p apps/crm/tsconfig.json --noEmit && npm run test
```
Expected: tsc silent. Vitest all-pass. If a nav test asserts the Estúdio item exists, update that assertion to assert its absence — do not re-add the item.

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "chore(estudio): remove Estúdio page, route and nav entry"
```

---

### Task 2: Decouple WorkflowDrawer and PostMediaGallery from designs

The surgical task. `WorkflowDrawer` owns the "Abrir no Estúdio" / "Tornar editável" entry points and a design-summary query; `PostMediaGallery` has a whole design-ownership mode that locks media controls. All of it comes out; manual media upload must keep working.

**Files:**
- Delete: `apps/crm/src/pages/estudio/` (the entire remaining directory — `applyEligibility.ts`, `ImportToEstudioDialog.tsx`, `__tests__/applyEligibility.test.ts`, `__tests__/ImportToEstudioDialog.test.tsx`)
- Modify: `apps/crm/src/pages/entregas/components/WorkflowDrawer.tsx` (imports at :97-98, design-summary query ~:951-990, button matrix ~:1283-1320)
- Modify: `apps/crm/src/pages/entregas/components/PostMediaGallery.tsx` (`design` + `onMakeEditable` props, ownership banner, disabled logic)
- Modify: `apps/crm/src/pages/entregas/components/__tests__/PostMediaGallery.test.tsx`

**Interfaces:**
- Consumes: Task 1's removal of the `/estudio` route (nothing may navigate there).
- Produces: `PostMediaGallery` no longer accepts `design` or `onMakeEditable` props. `DesignSummary` is no longer referenced anywhere in `apps/crm/`.

- [ ] **Step 1: Write the regression guard — media controls are never design-locked**

This is a **characterization test, not a red-green TDD cycle** — removal tasks have no
behaviour to drive out. It passes both before and after the change (before: no `design` prop
is passed, so no banner; after: the banner cannot exist). Its job is to fail if anyone
reintroduces design ownership. Do not contort it into failing first.

Add to `apps/crm/src/pages/entregas/components/__tests__/PostMediaGallery.test.tsx`:

```tsx
it('never renders a design-ownership banner', () => {
  render(
    <PostMediaGallery
      postId={1}
      media={[{ id: 10, kind: 'image', origin: 'manual', url: 'https://x/y.jpg' } as never]}
      onChange={vi.fn()}
    />,
  );
  expect(screen.queryByTestId('design-ownership-banner')).toBeNull();
});
```

- [ ] **Step 2: Run it and record the baseline**

Run:
```bash
npx vitest run apps/crm/src/pages/entregas/components/__tests__/PostMediaGallery.test.tsx -t "design-ownership"
```
Expected: PASS. It must still pass after Steps 3-5 — a failure there means the removal changed behaviour it shouldn't have.

- [ ] **Step 3: Strip design ownership from `PostMediaGallery.tsx`**

Remove the `design` and `onMakeEditable` props from the component's props interface (lines ~51-64) and destructuring (lines ~77-79). Delete the derived flags (lines ~89-91):
```tsx
  const designOwned = !!design;
  const fullyOwned = designOwned && !isReel;
  const coverOwned = designOwned && isReel;
```
Delete the reel-cover guard branch that calls `toast.error(t('mediaGallery.designOwnsImages'))` (~line 176-181) so a reel accepts manual image uploads again. Delete the ownership banner block (~lines 460-470). Simplify the tile `disabled` prop (line ~494) from:
```tsx
disabled={effectiveDisabled || (designOwned && m.origin === 'design')}
```
to:
```tsx
disabled={effectiveDisabled}
```
Delete the `onMakeEditable` wiring on the tile (~lines 504-506), the `onMakeEditable?: () => void;` prop on the tile component (~line 668), its destructuring (~line 679), and its button block (~lines 749-753).

- [ ] **Step 4: Strip the Estúdio entry points from `WorkflowDrawer.tsx`**

Delete the two imports at lines 97-98:
```tsx
} from '@/pages/estudio/applyEligibility';
import { ImportToEstudioDialog } from '@/pages/estudio/ImportToEstudioDialog';
```
(Keep any non-Estúdio names in that same import statement — read the full statement before cutting.)

Delete `const estudioBlocked = features?.feature_estudio === false;`, the `designSummaryQuery` useQuery block, `const designSummary = designSummaryQuery.data ?? null;`, the create-design mutation whose `onSuccess` navigates to `/estudio/${design_id}`, and the `canMakeEditable` gating. Delete the entire button-matrix block (~lines 1283-1320) including the held-info banner `shouldShowHeldInfoBanner(designSummary)`. Remove the now-unused `design={designSummary}` and `onMakeEditable={...}` props from the `<PostMediaGallery>` call site.

- [ ] **Step 5: Delete the remaining Estúdio directory**

```bash
git rm -r apps/crm/src/pages/estudio
```

- [ ] **Step 6: Verify nothing references designs in the CRM anymore**

Run:
```bash
grep -rn "DesignSummary\|designSummary\|pages/estudio\|feature_estudio" apps/crm/src --include="*.ts" --include="*.tsx"
```
Expected: only `apps/crm/src/hooks/useWorkspaceLimits.ts` and `apps/crm/src/lib/entitlement-errors.ts` (both handled in Task 5). Any other hit means a caller was missed.

- [ ] **Step 7: Typecheck and test**

Run:
```bash
npx tsc -p apps/crm/tsconfig.json --noEmit && npm run test
```
Expected: tsc silent, all tests pass. Update `PostMediaGallery.test.tsx` cases that pass a `design` prop — delete those cases, they test a removed feature.

- [ ] **Step 8: Commit**

```bash
git add -A && git commit -m "chore(estudio): decouple workflow drawer and media gallery from designs"
```

---

### Task 3: Remove the designs store module and rename the i18n namespace

`apps/crm/src/store/designs.ts` is now orphaned. The `estudio` i18n namespace is **not** orphaned: `apps/crm/src/components/shared/ColorPicker.tsx` — a shared component used by the client brand kit — reads `colorPicker.*` from it. Trim the namespace to those keys and rename it so nothing is named after a retired feature.

**Files:**
- Delete: `apps/crm/src/store/designs.ts`
- Modify: `apps/crm/src/store/index.ts:10` — remove `export * from './designs';`
- Rename: `packages/i18n/locales/pt/estudio.json` → `packages/i18n/locales/pt/brand.json` (and the `en` counterpart)
- Modify: `apps/crm/src/main.tsx:19-20` (imports + namespace registration)
- Modify: `apps/crm/src/components/shared/ColorPicker.tsx:143`

**Interfaces:**
- Consumes: Task 2's deletion of `pages/estudio/` (the only importer of `store/designs.ts`).
- Produces: i18n namespace `brand` containing only `colorPicker.*`. No namespace named `estudio` exists.

- [ ] **Step 1: Confirm `store/designs.ts` is orphaned**

Run:
```bash
grep -rn "store/designs" apps/crm/src
```
Expected: no output. If anything appears, that caller must be handled first.

- [ ] **Step 2: Delete it and drop the barrel re-export**

`store/designs.ts` is re-exported by the store barrel, so deleting the file alone breaks
every `@/store` import in the app. Remove line 10 of `apps/crm/src/store/index.ts`:
```ts
export * from './designs';
```
Then:
```bash
git rm apps/crm/src/store/designs.ts
```
`DesignImportError` and `importDesignFromMedia` live in that file and were consumed only by
`ImportToEstudioDialog`, deleted in Task 2 — confirm with:
```bash
grep -rn "importDesignFromMedia\|DesignImportError" apps/crm/src
```
Expected: no output.

- [ ] **Step 3: Trim and rename the locale files**

```bash
git mv packages/i18n/locales/pt/estudio.json packages/i18n/locales/pt/brand.json
git mv packages/i18n/locales/en/estudio.json packages/i18n/locales/en/brand.json
```
Then edit both `brand.json` files to keep **only** the `colorPicker` object. Every other top-level key (`titulo`, `openInEstudio`, `viewInEstudio`, `picker.*`, `toast.*`, `import.*`, `mediaGallery.*`, …) belongs to deleted UI and must go.

- [ ] **Step 4: Update the imports in `main.tsx`**

Replace lines 19-20:
```tsx
import ptEstudio from '../../../packages/i18n/locales/pt/estudio.json';
import enEstudio from '../../../packages/i18n/locales/en/estudio.json';
```
with:
```tsx
import ptBrand from '../../../packages/i18n/locales/pt/brand.json';
import enBrand from '../../../packages/i18n/locales/en/brand.json';
```
Then update the resource registration below it, changing the `estudio:` namespace key to `brand:` and the `ptEstudio`/`enEstudio` values to `ptBrand`/`enBrand`.

- [ ] **Step 5: Point `ColorPicker` at the renamed namespace**

`apps/crm/src/components/shared/ColorPicker.tsx:143`:
```tsx
  const { t } = useTranslation('brand');
```

- [ ] **Step 6: Remove the dead design keys from the `posts` namespace**

Surfaced by the Task 2 review: four keys used only by the removed design-ownership UI live in the **`posts`** namespace, not `estudio.json`, so the rename above does not sweep them. Delete from BOTH `packages/i18n/locales/pt/posts.json` and `packages/i18n/locales/en/posts.json` (~lines 81-84):
```
mediaGallery.designOwned
mediaGallery.designOwnedReel
mediaGallery.designOwnsImages
mediaGallery.makeEditable
```
Confirm each is unreferenced before deleting:
```bash
grep -rn "designOwned\|designOwnsImages\|makeEditable" apps/ --include="*.ts" --include="*.tsx"
```
Expected: no output.

- [ ] **Step 7: Verify no stale namespace references**

Run:
```bash
grep -rn "useTranslation('estudio')\|estudio.json" apps/ packages/ --include="*.ts" --include="*.tsx"
```
Expected: no output.

- [ ] **Step 8: Typecheck, test, commit**

```bash
npx tsc -p apps/crm/tsconfig.json --noEmit && npm run test
git add -A && git commit -m "chore(estudio): drop designs store, rename estudio i18n namespace to brand"
```
Expected: tsc silent, all tests pass. The ColorPicker tests exercise `colorPicker.*` and must stay green — if they fail, a key was dropped from `brand.json` that ColorPicker still reads.

---

### Task 4: Delete the Estúdio edge functions and shared modules

**Files:**
- Delete: `supabase/functions/design-import/`, `design-manage/`, `design-render/`, `design-render-sweep-cron/`, `generate-image/`
- Delete: `supabase/functions/_shared/image-gen/`, `_shared/doc-service.ts`, `_shared/design-render-trigger.ts`
- Delete: `supabase/functions/__tests__/design-import_test.ts`, `design-manage_test.ts`, `design-render_test.ts`, `design-render-sweep-cron_test.ts`, `generate-image_test.ts`, `image-gen-core_test.ts`, `image-gen-openrouter_test.ts`, `image-gen-vision_test.ts`
- Modify: `supabase/config.toml` (lines 22, 25, 67, 70 — the four `[functions.design-*]` blocks)

**Interfaces:**
- Consumes: Tasks 1-3 (no CRM caller remains).
- Produces: no edge function references `_shared/image-gen` or `_shared/doc-service.ts`.

- [ ] **Step 1: Confirm nothing outside the deletion set imports these modules**

Run:
```bash
cd supabase/functions && grep -rn "image-gen\|doc-service\|design-render-trigger\|starter-templates" . \
  --include="*.ts" | grep -vE "^\./(design-|generate-image|_shared/image-gen|__tests__/)"
```
Expected: no output. A hit outside the deletion set means a surviving function depends on this code — stop and re-scope.

- [ ] **Step 2: Delete the functions, shared modules and tests**

```bash
cd supabase/functions
git rm -r design-import design-manage design-render design-render-sweep-cron generate-image \
          _shared/image-gen _shared/doc-service.ts _shared/design-render-trigger.ts
git rm __tests__/design-import_test.ts __tests__/design-manage_test.ts \
       __tests__/design-render_test.ts __tests__/design-render-sweep-cron_test.ts \
       __tests__/generate-image_test.ts __tests__/image-gen-core_test.ts \
       __tests__/image-gen-openrouter_test.ts __tests__/image-gen-vision_test.ts
```

- [ ] **Step 3: Remove the config.toml entries**

Delete all four blocks from `supabase/config.toml`:
```toml
[functions.design-render]
[functions.design-render-sweep-cron]
[functions.design-manage]
[functions.design-import]
```
(each with its `verify_jwt` / `import_map` lines).

- [ ] **Step 4: Run the Deno suite**

Run:
```bash
cd /Users/eduardosouza/Projects/sm-crm && npm run test:functions 2>&1 | tail -5 && git checkout -- deno.lock
```
Expected: all pass, 0 failed. Then restore npm state: `npm ci`.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "chore(estudio): delete design + image-gen edge functions and shared modules"
```

---

### Task 5: Remove the Estúdio plan entitlements

`feature_estudio`, `feature_ai_images` and `rate_ai_images_per_month` are plan columns. `_shared/entitlements.ts` is the single source of truth — the admin app previously kept a drifted copy, so verify both.

**Files:**
- Modify: `supabase/functions/_shared/entitlements.ts`
- Modify: `apps/crm/src/hooks/useWorkspaceLimits.ts:45`
- Modify: `apps/crm/src/lib/entitlement-errors.ts:35`
- Create: `supabase/migrations/20260722000001_drop_estudio_plan_columns.sql`

**Interfaces:**
- Consumes: Task 4 (no edge function reads these flags).
- Produces: no `feature_estudio` / `feature_ai_images` / `rate_ai_images_per_month` anywhere in the codebase or the `plans` table.

- [ ] **Step 1: Find every reference**

Run:
```bash
grep -rn "feature_estudio\|feature_ai_images\|rate_ai_images_per_month" apps/ supabase/ --include="*.ts" --include="*.tsx" --include="*.sql" | grep -v node_modules
```
Record the list — every non-migration hit must be gone by Step 4.

- [ ] **Step 2: Remove the keys from the entitlement definitions**

Delete the three keys from the plan-column arrays/types in `supabase/functions/_shared/entitlements.ts`, the `feature_estudio: boolean;` field at `apps/crm/src/hooks/useWorkspaceLimits.ts:45` (plus `feature_ai_images` / `rate_ai_images_per_month` if present), and the `feature_estudio: 'Estúdio',` label at `apps/crm/src/lib/entitlement-errors.ts:35` (plus the AI-images label).

- [ ] **Step 3: Write the migration**

Create `supabase/migrations/20260722000001_drop_estudio_plan_columns.sql`:
```sql
-- Estúdio retirement: the editor, its edge functions and its MCP tools are gone, so these
-- plan gates no longer gate anything. Dropping them keeps effective_plan_feature() honest.
ALTER TABLE plans DROP COLUMN IF EXISTS feature_estudio;
ALTER TABLE plans DROP COLUMN IF EXISTS feature_ai_images;
ALTER TABLE plans DROP COLUMN IF EXISTS rate_ai_images_per_month;
```
If any workspace-level override table carries the same columns, drop them there too — check with:
```bash
grep -rn "feature_estudio" supabase/migrations/ | grep -i "workspace\|override"
```

- [ ] **Step 4: Verify, test, commit**

```bash
grep -rn "feature_estudio\|feature_ai_images\|rate_ai_images_per_month" apps/ supabase/functions/ --include="*.ts" --include="*.tsx"
npx tsc -p apps/crm/tsconfig.json --noEmit && npm run test
npm run test:functions 2>&1 | tail -3 && git checkout -- deno.lock && npm ci
git add -A && git commit -m "chore(estudio): drop feature_estudio, feature_ai_images and the AI image quota"
```
Expected: the grep returns nothing; tsc silent; both suites pass.

---

### Task 6: Drop the Estúdio database objects

**Irreversible.** Do this only after Tasks 1-5 are merged and deployed, so nothing can call a dropped RPC. Unschedule the cron *before* dropping the function it invokes.

**Files:**
- Create: `supabase/migrations/20260722000002_drop_estudio_objects.sql`

**Interfaces:**
- Consumes: Tasks 1-5 (all callers removed).
- Produces: `post_designs`, `design_asset_refs` and every `*_design_*` RPC are gone. `hub_brand.logo_file_id` and `post_file_links.origin` survive.

- [ ] **Step 1: Confirm no code calls the design RPCs**

Run:
```bash
grep -rn "post_design\|design_asset_refs\|claim_design_render\|finalize_design_render\|fail_design_render\|create_post_design\|update_post_design\|get_or_create_post_design\|delete_post_design" apps/ supabase/functions/ --include="*.ts" --include="*.tsx"
```
Expected: no output.

- [ ] **Step 2: Write the migration**

Create `supabase/migrations/20260722000002_drop_estudio_objects.sql`:
```sql
-- Estúdio retirement. All existing design data is test data (confirmed 2026-07-22).
--
-- RETAINED ON PURPOSE — both were added by 20260702000001_post_designs.sql but are consumed by
-- surviving features:
--   hub_brand.logo_file_id   → client brand kit / Hub whitelabel (brand-logo.ts, HubTab.tsx)
--   post_file_links.origin   → media pipeline (store/posts.ts); 'design' rows backfilled below

-- 1. Stop the render sweep before its target disappears. pg_cron failures are SILENT, so an
--    orphaned schedule (it POSTs to /functions/v1/design-render-sweep-cron every 2 min) would
--    fail invisibly forever. The job name must match 20260702000005 EXACTLY — a typo no-ops
--    under IF EXISTS and leaves the schedule running.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'design-render-sweep-cron') THEN
    PERFORM cron.unschedule('design-render-sweep-cron');
  END IF;
END $$;

-- 2. No link may claim design provenance once designs are gone.
UPDATE post_file_links SET origin = 'manual' WHERE origin = 'design';

-- 3. RPCs (drop before the tables they read).
DROP FUNCTION IF EXISTS finalize_design_render(bigint, jsonb, text);
DROP FUNCTION IF EXISTS fail_design_render(bigint, text);
DROP FUNCTION IF EXISTS claim_design_render(bigint);
DROP FUNCTION IF EXISTS delete_post_design(uuid, bigint);
DROP FUNCTION IF EXISTS get_or_create_post_design(uuid, bigint, jsonb);
DROP FUNCTION IF EXISTS update_post_design(uuid, bigint, jsonb, integer);
DROP FUNCTION IF EXISTS create_post_design(uuid, bigint, jsonb);
DROP FUNCTION IF EXISTS post_design_diff_asset_refs(bigint, jsonb);
DROP FUNCTION IF EXISTS post_design_check_and_sync(uuid, bigint, jsonb);
DROP FUNCTION IF EXISTS set_post_designs_doc_state();

-- 4. Tables (design_asset_refs first — its DELETE trigger decrements files.reference_count,
--    so dropping the table rather than deleting rows leaves counts untouched by design).
DROP TABLE IF EXISTS design_asset_refs;
DROP TABLE IF EXISTS post_designs;

-- 5. The AI image ledger.
DROP TABLE IF EXISTS ai_image_generations;
```

**Before running:** confirm each `DROP FUNCTION` signature against the source migrations — a wrong signature silently no-ops under `IF EXISTS`. Verify with:
```bash
grep -n "CREATE OR REPLACE FUNCTION" supabase/migrations/20260702000001_post_designs.sql \
  supabase/migrations/20260702000004_*.sql supabase/migrations/20260704000002_*.sql \
  supabase/migrations/20260705000001_*.sql supabase/migrations/20260706000002_*.sql
```
The cron job name is `design-render-sweep-cron` (verified against `20260702000005_design_render_sweep_cron_schedule.sql:24`, schedule `*/2 * * * *`). Re-confirm before running:
```bash
grep -A1 "cron.schedule" supabase/migrations/20260702000005_design_render_sweep_cron_schedule.sql
```

- [ ] **Step 3: Apply to staging first**

```bash
cat supabase/.temp/project-ref
```
Translate the ref (prod `skjzpekeqefvlojenfsw` / staging `wlyzhyfondykzpsiqsce`). Link to **staging**, then:
```bash
npx supabase db push --linked
```
Expected: migration applies cleanly. If `db push` aborts on unrelated history drift, apply this single migration via the SQL editor and record its version manually.

- [ ] **Step 4: Verify the retained columns survived on staging**

Run in the SQL editor:
```sql
SELECT column_name FROM information_schema.columns
WHERE (table_name = 'hub_brand'        AND column_name = 'logo_file_id')
   OR (table_name = 'post_file_links'  AND column_name = 'origin');
```
Expected: **two rows**. Zero or one row means the migration overreached — stop and fix before touching prod.

- [ ] **Step 5: Confirm the cron is gone and nothing else broke**

```sql
SELECT jobname FROM cron.job WHERE jobname LIKE '%design%';
SELECT to_regclass('post_designs'), to_regclass('design_asset_refs');
```
Expected: no cron rows; both `to_regclass` values NULL.

- [ ] **Step 6: Smoke-test the surviving media path on staging**

In the CRM against staging, open a post in the workflow drawer, upload an image, and confirm it attaches and renders. This is the regression this whole plan must not cause.

- [ ] **Step 7: Apply to prod, then commit**

Re-link to prod, `npx supabase db push --linked`, repeat Steps 4-5 against prod, then:
```bash
git add -A && git commit -m "chore(estudio): drop post_designs, design RPCs, render cron and AI image ledger"
```

---

### Task 7: Decommission external infrastructure and clean up docs

Not code — a runbook. Several steps need Eduardo's credentials and must not be attempted autonomously.

**Files:**
- Modify: `package.json:15-17` (`dev:estudio` script and both `dev:all` chains)
- Modify: `apps/crm/vite.config.ts:27-30` (dead `/estudio-fn` dev proxy)
- Modify: `CLAUDE.md` (Estúdio commands and env vars)
- Delete: `docs/estudio-mcp-guide.md`

**Interfaces:**
- Consumes: Tasks 1-6.
- Produces: no build script, doc, or env var references Estúdio.

- [ ] **Step 1: Remove the dev scripts and the dead vite proxy**

In `package.json`, delete the `dev:estudio` script (line 15) and remove `"npm:dev:estudio"` plus its `estudio` entry from the `-n` / `-c` lists in both `dev:all` (line 16) and `dev:all:staging` (line 17).

Then delete the `/estudio-fn` dev proxy block from `apps/crm/vite.config.ts` (~lines 27-30). Its only consumer was `embedHost.ts`'s dev-mode `buildDocUrl`, deleted in Task 1 — surfaced by the Task 1 review. Confirm it is dead first:
```bash
grep -rn "estudio-fn" apps/ packages/ --include="*.ts" --include="*.tsx"
```
Expected: only the `vite.config.ts` definition itself.

Also delete the dead `nav.estudio` key from BOTH `packages/i18n/locales/pt/common.json` and `packages/i18n/locales/en/common.json` — the nav item it labelled was removed in Task 1 (surfaced by the Task 3 implementer). Confirm first:
```bash
grep -rn "nav.estudio" apps/ packages/ --include="*.ts" --include="*.tsx"
```
Expected: no output.

- [ ] **Step 2: Update `CLAUDE.md`**

Remove the `npm run dev:estudio` line and the `dev:all` description's Estúdio mention from the Commands block. Remove `GEMINI_API_KEY` and `OPEN_ROUTER_API_KEY` from the edge-function env var list if nothing else consumes them — verify first:
```bash
grep -rn "GEMINI_API_KEY\|OPEN_ROUTER_API_KEY" supabase/functions/ --include="*.ts"
```
Expected after Task 4: no output. If so, both env vars are dead and their lines should go.

- [ ] **Step 3: Delete the stale user-facing guide**

```bash
git rm docs/estudio-mcp-guide.md
```
Leave `docs/estudio-design.md`, `docs/estudio-plan.md`, `docs/estudio-spike-notes.md` and the `docs/superpowers/specs/2026-07-04-openpencil-*` files in place — they are historical design records, not instructions.

- [ ] **Step 4: Verify and commit**

```bash
npm run lint && npm run format:check && npm run test
git add -A && git commit -m "chore(estudio): remove dev scripts, env vars and the MCP guide"
```

- [ ] **Step 5: Manual decommission — hand these to Eduardo**

These need dashboard access and are **not** for an agent to perform:

1. **Vercel** — delete the `estudio-render` service (the OpenPencil doc/render service).
2. **Supabase secrets** — unset `RENDER_SERVICE_URL`, `RENDER_SERVICE_SECRET`, and `GEMINI_API_KEY` / `OPEN_ROUTER_API_KEY` if Step 2 confirmed they are dead.
3. **Supabase edge functions** — delete the five deployed functions (`design-import`, `design-manage`, `design-render`, `design-render-sweep-cron`, `generate-image`); removing them from the repo does **not** undeploy them.
4. **Cloudflare R2** — the design `.fig` blobs under the design key prefix are now unreachable. Confirm the prefix before deleting anything, and leave `contas/{conta_id}/files/` alone — that is live post media.
5. **GitHub** — archive or delete the OpenPencil fork if it serves nothing else.

- [ ] **Step 6: Final full-repo sweep**

```bash
grep -rni "estudio\|design_id\|post_designs" apps/ supabase/functions/ packages/ --include="*.ts" --include="*.tsx" | grep -v node_modules
```
Expected: no output. Anything left is either a genuine miss or a deliberate survivor — justify each one before closing the branch.
