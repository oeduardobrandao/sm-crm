# Paywall Plan 3 — Storage Quota Unification

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the plan the single source of truth for storage quota — every quota reader resolves it via `effective_plan_limit(conta_id,'storage_quota_bytes')`, normalized to `NULL`=unlimited / `0`=blocked.

**Architecture:** Three layers read quota today, all from `workspaces.storage_quota_bytes`: the presign functions, the authoritative finalize RPCs, and `file-manage` (copy/duplicate + display). Each switches to the resolver so presign, finalize, copy, and display agree. `storage_used_bytes` (the atomic counter) is untouched. `workspaces.storage_quota_bytes` becomes unread (deprecated, not dropped).

**Tech Stack:** Postgres/PL-pgSQL, Deno. Tests: SQL via local Supabase + `psql`; Deno for the edge functions.

**Depends on:** Plan 1 (`effective_plan_limit`, `_shared/entitlements-rpc.ts`'s `effectivePlanLimit`, the `psql` harness + `et_make_workspace`). Uses `$LOCAL_DB`.

**Spec:** `docs/superpowers/specs/2026-06-11-paywall-feature-gating-design.md` (§9).

---

## File Structure

- Create: `supabase/migrations/20260611150001_storage_quota_from_plan.sql` (CREATE OR REPLACE both finalize RPCs)
- Modify: `supabase/functions/post-media-upload-url/index.ts`, `supabase/functions/file-upload-url/handler.ts`, `supabase/functions/file-manage/handler.ts`
- Create: `supabase/tests/entitlements/20_storage_rpcs.sql`

---

## Task 1: Finalize RPCs read quota from the plan

**Files:**
- Create: `supabase/migrations/20260611150001_storage_quota_from_plan.sql`
- Create: `supabase/tests/entitlements/20_storage_rpcs.sql`

- [ ] **Step 1: Write the failing assertion**

Create `supabase/tests/entitlements/20_storage_rpcs.sql`. It proves the gate uses the *plan* quota, not `workspaces.storage_quota_bytes` (which is set huge to prove it's ignored). The over-quota path RAISEs before any INSERT, so no FK fixtures are needed:

```sql
\set ON_ERROR_STOP on
\i supabase/tests/entitlements/_helpers.sql
begin;
do $$
declare v_ws uuid; v_blocked boolean := false;
begin
  v_ws := et_make_workspace('free'); -- plan storage_quota_bytes = 104857600 (100MB)
  -- set the (now-deprecated) column huge + used at the plan quota
  update workspaces set storage_quota_bytes = 999999999999, storage_used_bytes = 104857600 where id = v_ws;

  begin
    perform post_media_insert_with_quota(jsonb_build_object(
      'conta_id', v_ws::text, 'size_bytes', '1', 'post_id', '1',
      'r2_key', 'k', 'kind', 'image', 'mime_type', 'image/png',
      'original_filename', 'x.png', 'is_cover', 'false', 'uploaded_by', gen_random_uuid()::text));
  exception when sqlstate 'P0001' then
    assert sqlerrm like 'quota_exceeded%', format('wrong msg: %s', sqlerrm);
    v_blocked := true;
  end;
  assert v_blocked, 'post_media over PLAN quota must block (column ignored)';

  v_blocked := false;
  begin
    perform file_insert_with_quota(jsonb_build_object(
      'conta_id', v_ws::text, 'size_bytes', '1', 'r2_key', 'k', 'name', 'x',
      'kind', 'image', 'mime_type', 'image/png', 'uploaded_by', gen_random_uuid()::text));
  exception when sqlstate 'P0001' then v_blocked := true; end;
  assert v_blocked, 'file over PLAN quota must block (column ignored)';

  raise notice 'PASS 20_storage_rpcs';
end $$;
rollback;
```

- [ ] **Step 2: Run to verify it fails**

Run: `psql "$LOCAL_DB" -f supabase/tests/entitlements/20_storage_rpcs.sql`
Expected: the DO block ERRORS — today the RPC reads the huge column, so the quota check passes and execution reaches the INSERT, which dies on the `post_id` FK violation (SQLSTATE 23503 — NOT caught by the `P0001` handler). That FK error, not a clean assert message, is the red step here. (After the migration the over-quota path raises *before* the INSERT, so no FK fixtures are needed. `file_insert_with_quota` also currently raises with no errcode, which the `sqlstate 'P0001'` handler won't catch — another reason it fails today.)

- [ ] **Step 3: Write the migration (CREATE OR REPLACE both RPCs)**

Create `supabase/migrations/20260611150001_storage_quota_from_plan.sql`:

```sql
-- Storage quota now resolves from the plan (effective_plan_limit), not workspaces.storage_quota_bytes.
-- NULL = unlimited, 0 = blocked. Errcode standardized to P0001.

create or replace function post_media_insert_with_quota(p jsonb)
returns post_media
language plpgsql
security definer
set search_path = public
as $$
declare
  v_conta_id uuid := (p->>'conta_id')::uuid;
  v_needed   bigint := (p->>'size_bytes')::bigint;
  v_quota    bigint;
  v_used     bigint;
  v_row      post_media;
begin
  select storage_used_bytes into v_used from workspaces where id = v_conta_id for update;
  v_quota := effective_plan_limit(v_conta_id, 'storage_quota_bytes');

  if v_quota is not null and (coalesce(v_used,0) + v_needed) > v_quota then
    raise exception 'quota_exceeded' using errcode = 'P0001';
  end if;

  insert into post_media (
    post_id, conta_id, r2_key, thumbnail_r2_key, kind, mime_type, size_bytes,
    original_filename, width, height, duration_seconds, is_cover, uploaded_by
  ) values (
    (p->>'post_id')::bigint, v_conta_id, p->>'r2_key', nullif(p->>'thumbnail_r2_key',''),
    p->>'kind', p->>'mime_type', v_needed, p->>'original_filename',
    nullif(p->>'width','')::int, nullif(p->>'height','')::int,
    nullif(p->>'duration_seconds','')::int, (p->>'is_cover')::boolean, (p->>'uploaded_by')::uuid
  ) returning * into v_row;

  return v_row;
end;
$$;

create or replace function file_insert_with_quota(p jsonb)
returns files
language plpgsql
security definer
set search_path = public  -- previously missing; its sibling RPC already pins it
as $$
declare
  v_conta_id uuid := (p->>'conta_id')::uuid;
  v_quota  bigint;
  v_used   bigint;
  v_row    files;
begin
  select storage_used_bytes into v_used from workspaces where id = v_conta_id for update;
  v_quota := effective_plan_limit(v_conta_id, 'storage_quota_bytes');

  if v_quota is not null and coalesce(v_used,0) + (p->>'size_bytes')::bigint > v_quota then
    raise exception 'quota_exceeded' using errcode = 'P0001';
  end if;

  insert into files (
    conta_id, folder_id, r2_key, thumbnail_r2_key, name, kind, mime_type,
    size_bytes, width, height, duration_seconds, uploaded_by
  ) values (
    v_conta_id, nullif(p->>'folder_id','')::bigint, p->>'r2_key', nullif(p->>'thumbnail_r2_key',''),
    p->>'name', p->>'kind', p->>'mime_type', (p->>'size_bytes')::bigint,
    nullif(p->>'width','')::int, nullif(p->>'height','')::int,
    nullif(p->>'duration_seconds','')::int, nullif(p->>'uploaded_by','')::uuid
  ) returning * into v_row;

  update workspaces set storage_used_bytes = storage_used_bytes + v_row.size_bytes
   where id = v_row.conta_id;

  return v_row;
end;
$$;
```

- [ ] **Step 4: Reset + verify pass**

Run: `npx supabase db reset && psql "$LOCAL_DB" -f supabase/tests/entitlements/20_storage_rpcs.sql`
Expected: `NOTICE: PASS 20_storage_rpcs`.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260611150001_storage_quota_from_plan.sql supabase/tests/entitlements/20_storage_rpcs.sql
git commit -m "feat(paywall): storage finalize RPCs resolve quota from plan (P0001)"
```

---

## Task 2: Presign functions resolve quota from the plan

**Files:**
- Modify: `supabase/functions/post-media-upload-url/index.ts`, `supabase/functions/file-upload-url/handler.ts`
- Modify (tests): `supabase/functions/__tests__/file-upload-url_test.ts`

- [ ] **Step 1: Update the file-upload-url quota check**

In `supabase/functions/file-upload-url/handler.ts`, replace the quota block (lines 89-99). Read `storage_used_bytes` from workspaces, resolve quota from the plan:

```ts
import { effectivePlanLimit } from "../_shared/entitlements-rpc.ts";
// ...replacing lines 89-99:
const { data: ws } = await svc.from("workspaces")
  .select("storage_used_bytes").eq("id", profile.conta_id).single();
const quota = await effectivePlanLimit(svc, profile.conta_id, "storage_quota_bytes"); // null=unlimited
if (quota !== null) {
  const used = Number(ws?.storage_used_bytes ?? 0);
  const needed = size_bytes + (thumbnail?.size_bytes ?? 0);
  if (used + needed > quota) {
    return json({ error: "quota_exceeded", used, quota }, 413);
  }
}
```

- [ ] **Step 2: Update post-media-upload-url identically**

In `supabase/functions/post-media-upload-url/index.ts`, apply the same replacement to its quota block (lines 76-86).

- [ ] **Step 3: Update the existing Deno test to mock the rpc**

In `supabase/functions/__tests__/file-upload-url_test.ts`, the over-quota cases (lines ~177, 184) currently queue a workspace row with `storage_quota_bytes`. Update them to (a) queue a workspace row with only `storage_used_bytes`, and (b) stub `svc.rpc("effective_plan_limit", ...)` to return the quota number (or `null` for the unlimited case at line ~193). Follow the mock-DB helper's `rpc` support; if the mock lacks `rpc`, add a minimal stub returning a queued value.

- [ ] **Step 4: Run the tests**

Run: `deno test --no-check --allow-env --allow-read --allow-net supabase/functions/__tests__/file-upload-url_test.ts`
Expected: PASS (quota_exceeded when used+needed>quota; allowed when rpc returns null).

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/post-media-upload-url/index.ts supabase/functions/file-upload-url/handler.ts supabase/functions/__tests__/file-upload-url_test.ts
git commit -m "feat(paywall): presign quota checks resolve from plan"
```

---

## Task 3: `file-manage` copy/duplicate + display read from the plan

**Files:**
- Modify: `supabase/functions/file-manage/handler.ts`
- Modify (tests): `supabase/functions/__tests__/file-manage_test.ts` (and `file-manage-bulk_test.ts` if it covers copy)

- [ ] **Step 1: Fix the display block (lines 170-183)**

Resolve the quota from the plan; the displayed `quota_bytes` should reflect the plan (use `0` only as the "no quota info" sentinel the UI already handles, but prefer the resolved value):

```ts
import { effectivePlanLimit } from "../_shared/entitlements-rpc.ts";
// replacing lines 170-183's workspace select + storage block:
const { data: workspace } = await svc.from("workspaces")
  .select("storage_used_bytes").eq("id", contaId).single();
const quota = await effectivePlanLimit(svc, contaId, "storage_quota_bytes");
return json({
  folder, subfolders: subfoldersWithSize, files: signedFiles, breadcrumbs,
  storage: {
    used_bytes: workspace?.storage_used_bytes ?? 0,
    // NOTE: the UI's legacy display sentinel is 0 = "unlimited/unknown", which now
    // CONFLICTS with the resolver's 0 = fail-closed-blocked. Keep this comment in
    // the code so nobody "aligns" the quota checks to this display semantic.
    quota_bytes: quota ?? 0,
  },
});
```

- [ ] **Step 2: Fix the copy-folder check (lines 277-280) — normalize NULL=unlimited**

```ts
const { data: ws } = await svc.from("workspaces").select("storage_used_bytes").eq("id", contaId).single();
const quota = await effectivePlanLimit(svc, contaId, "storage_quota_bytes");
if (quota !== null && (Number(ws?.storage_used_bytes ?? 0) + totalBytes) > quota) {
  return json({ error: "quota_exceeded", used: ws?.storage_used_bytes ?? 0, quota, copy_bytes: totalBytes }, 413);
}
```

- [ ] **Step 3: Fix the copy/duplicate-file check (lines 389-392) identically**

```ts
const { data: ws } = await svc.from("workspaces").select("storage_used_bytes").eq("id", contaId).single();
const quota = await effectivePlanLimit(svc, contaId, "storage_quota_bytes");
if (quota !== null && (Number(ws?.storage_used_bytes ?? 0) + source.size_bytes) > quota) {
  return json({ error: "quota_exceeded", used: ws?.storage_used_bytes ?? 0, quota, copy_bytes: source.size_bytes }, 413);
}
```

(Critical: the old `ws.storage_quota_bytes > 0` treated `0` as unlimited — backwards. The new `quota !== null` is the correct "unlimited" test.)

- [ ] **Step 4: Update file-manage tests**

In `supabase/functions/__tests__/file-manage_test.ts` (and bulk test if applicable), the copy quota cases queue a workspace with `storage_quota_bytes`. Update to queue `storage_used_bytes` only and stub `rpc("effective_plan_limit")` to return the quota (or `null`). Add a regression: `quota=0` (fail-closed) now **blocks** a copy (previously `0` wrongly meant unlimited).

- [ ] **Step 5: Run tests + commit**

Run: `deno test --no-check --allow-env --allow-read --allow-net supabase/functions/__tests__/file-manage_test.ts supabase/functions/__tests__/file-manage-bulk_test.ts`
Expected: PASS, incl. the `quota=0` blocks-copy regression.

```bash
git add supabase/functions/file-manage/handler.ts supabase/functions/__tests__/file-manage_test.ts supabase/functions/__tests__/file-manage-bulk_test.ts
git commit -m "feat(paywall): file-manage copy/display read quota from plan; fix 0=unlimited bug"
```

---

## Final verification

- [ ] SQL: `npx supabase db reset && psql "$LOCAL_DB" -f supabase/tests/entitlements/20_storage_rpcs.sql` → `PASS`.
- [ ] Deno: `deno test --no-check --allow-env --allow-read --allow-net supabase/functions/__tests__/{file-upload-url,file-manage,file-manage-bulk}_test.ts` → green. Then `git checkout deno.lock && npm ci` if needed.
- [ ] Manual: a free workspace at its 100MB plan quota cannot upload **and** cannot duplicate files/folders; both return `413 quota_exceeded`. The Arquivos page shows the plan-derived quota.

## Self-review notes

- **Spec coverage (§9):** presign (T2), authoritative finalize RPCs (T1), file-manage copy + display (T3), all switched to `effective_plan_limit` with `NULL`=unlimited / `0`=blocked; errcode standardized to `P0001`; the backwards `>0` comparison fixed.
- **Type consistency:** `effectivePlanLimit(svc, ws, 'storage_quota_bytes')` returns `number|null` and is compared with `quota !== null` everywhere. The SQL `effective_plan_limit` (Plan 1) is invoked unchanged inside the RPCs.
- **Untouched:** `storage_used_bytes` accounting and the `FOR UPDATE` row lock in the RPCs remain; only the quota *source* changes.
