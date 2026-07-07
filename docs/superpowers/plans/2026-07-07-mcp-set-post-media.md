# MCP `set_post_media` (upload + set) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Two MCP tools — `create_media_upload` (presigned PUT URLs) and `set_post_media` (finalize
uploaded images + set them as a post's media via one atomic RPC) — so a skill can put an
externally-produced flat JPG onto a post with zero manual steps. Supersedes `attach_image_to_post`.

**Architecture:** Mirror the web UI's presigned flow. `create_media_upload` quota-prechecks then signs
R2 PUT URLs. The client PUTs bytes. `set_post_media` HEAD-checks each object (TS, R2 is outside the DB)
then calls a new `SECURITY DEFINER` RPC `post_media_set_from_uploads` that does lookup+lock, eligibility,
replace-all, idempotent file reuse, old-file GC, and tipo/status sync in ONE transaction under
`SELECT … FOR UPDATE` on the post. Both tools ride the existing `posts:write` scope. `get_post` media is
extended with `file_id`/`link_id`/`sort_order`.

**Tech Stack:** Deno edge functions (`supabase/functions/mcp`), Postgres SECURITY DEFINER RPC, zod tool
schemas via the in-house `register()` helper, Deno tests (`npm run test:functions`).

## Global Constraints

- Design of record: `docs/superpowers/specs/2026-07-07-mcp-set-post-media-design.md` (decisions D0–D4,
  P1/P2 items). Every task inherits it.
- **Migration version = `20260707000002`.** `20260707000001` is the attach RPC ALREADY APPLIED to prod —
  reusing that version would collide. Migrations are applied to PROD by Eduardo via the SQL editor
  (db push blocked by dup-timestamp); validate on a real Postgres (pgTAP) first, then STOP and ask.
- **The `mcp` deploy retires the live `attach_image_to_post` tool** (D0). Deploy:
  `npx supabase functions deploy mcp --use-api --no-verify-jwt --project-ref skjzpekeqefvlojenfsw`
  (Docker bundler broken; `--use-api` mandatory; `--no-verify-jwt` because mcp does its own key auth —
  omitting it would flip on gateway JWT and break every MCP client).
- Edge tests: `npm run test:functions` (bare `deno test` breaks on zod). Root `deno.lock`: always revert
  (`git checkout deno.lock`). If Deno pollutes node_modules, `npm ci`.
- PT user-facing errors via `McpInputError` only; NEVER raw provider/db internals (logged internally).
- Audit metadata = aggregated only: never filename, r2_key, or upload_url.
- Scope: reuse `posts:write` (no new scope → no cross-function redeploy).
- Image cap **8 MB** (IG publish limit); carousel **≤ 10**; `kind` fixed `image`.
- Editable = `DESIGN_ELIGIBLE_STATUSES` (`rascunho|revisao_interna|correcao_cliente|enviado_cliente`),
  with `correcao_cliente → revisao_interna` on set; `enviado_cliente` stays.
- Tenant: every `r2_key` must start with `contas/${ctx.conta_id}/files/`; all reads/writes conta-scoped.

## Design decisions locked (raise before deviating)

1. **RPC reads `filename`, not `name`** (resolves a mismatch in the spec's §5 snippet, which read
   `v_item->>'name'` while the tool's item field is `filename`). The tool passes `args.items` verbatim as
   `p_items`; the RPC derives the files-row name from `v_item->>'filename'`. No TS remap.
2. **`storageQuota` is an injected dep** (`Deps.storageQuota?`) wired to
   `effectivePlanLimit(db, contaId, "storage_quota_bytes")`, so `create_media_upload`'s quota precheck is
   unit-testable. The `storage_used_bytes` read goes through `deps.db` (mockable).
3. **`set_post_media` returns `getPost(deps, {post_id})`** so the agent sees the final ordered media.
4. **Off `main`:** `get_post` currently exposes only `is_cover`; this slice adds `file_id`, `link_id`,
   `sort_order` (Task 4 of the abandoned attach slice does not carry over).

## File structure

- Create: `supabase/migrations/20260707000002_post_media_set_from_uploads.sql` — the RPC.
- Create: `supabase/tests/post_media_set_from_uploads.sql` — pgTAP-style validation.
- Create: `supabase/functions/mcp/media.ts` — `createMediaUpload` + `setPostMedia` + `mapSetMediaError`.
- Create: `supabase/functions/__tests__/mcp-media_test.ts` — Deno tests.
- Modify: `supabase/functions/mcp/queries.ts` — `Deps += signPutUrl/headObject/storageQuota`; `getPost`
  media `+ file_id/link_id/sort_order`.
- Modify: `supabase/functions/mcp/index.ts` — import `signPutUrl`/`headObject`; inject the 3 deps.
- Modify: `supabase/functions/mcp/tools.ts` — `register(...)` the 2 tools + `auditArgs`.
- Modify: `supabase/functions/mcp/capabilities.ts` — announce the new capability.

---

### Task 1: RPC migration `post_media_set_from_uploads` + pgTAP

**Files:**
- Create: `supabase/migrations/20260707000002_post_media_set_from_uploads.sql`
- Create: `supabase/tests/post_media_set_from_uploads.sql`

**Interfaces:**
- Consumes: tables `workflow_posts`, `designs`, `files`, `post_file_links`; RPC
  `file_insert_with_quota(jsonb) → files` (`20260425000002:221`); the auto-cover + ref-count triggers.
- Produces: `post_media_set_from_uploads(p_conta_id uuid, p_post_id bigint, p_uploaded_by uuid, p_items
  jsonb) RETURNS jsonb` (`{post_id, item_count, tipo, status}`), granted to `service_role`. Task 4 calls
  it. Coded P0001 exceptions: `post_not_found`, `post_not_editable:<status>`, `tipo_not_image:<tipo>`,
  `design_attached`, and `quota_exceeded` (bubbled from `file_insert_with_quota`).

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/20260707000002_post_media_set_from_uploads.sql`:

```sql
-- Atomically set a post's media from already-uploaded R2 objects (MCP set_post_media). Everything
-- under the post-row lock: eligibility, replace-all, idempotent files reuse, old-file GC, tipo/status
-- sync. Mirrors finalize_design_render's write pattern (20260705000001:411). Coded P0001 exceptions are
-- mapped to PT in mcp/media.ts.
CREATE OR REPLACE FUNCTION post_media_set_from_uploads(
  p_conta_id uuid, p_post_id bigint, p_uploaded_by uuid, p_items jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_post workflow_posts;
  v_item jsonb;
  i int := 0;
  v_new_tipo text;
  v_old bigint[];
  v_new bigint[] := '{}';
  v_fid bigint;
BEGIN
  SELECT * INTO v_post FROM workflow_posts
    WHERE id = p_post_id AND conta_id = p_conta_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'post_not_found' USING ERRCODE = 'P0001'; END IF;

  IF v_post.status NOT IN ('rascunho','revisao_interna','correcao_cliente','enviado_cliente') THEN
    RAISE EXCEPTION 'post_not_editable:%', v_post.status USING ERRCODE = 'P0001';
  END IF;
  IF v_post.tipo NOT IN ('feed','carrossel') THEN
    RAISE EXCEPTION 'tipo_not_image:%', v_post.tipo USING ERRCODE = 'P0001';
  END IF;
  IF EXISTS (SELECT 1 FROM designs WHERE post_id = p_post_id AND conta_id = p_conta_id) THEN
    RAISE EXCEPTION 'design_attached' USING ERRCODE = 'P0001';
  END IF;

  v_new_tipo := CASE WHEN jsonb_array_length(p_items) > 1 THEN 'carrossel' ELSE 'feed' END;

  SELECT COALESCE(array_agg(file_id), '{}') INTO v_old
    FROM post_file_links WHERE post_id = p_post_id AND conta_id = p_conta_id;
  DELETE FROM post_file_links WHERE post_id = p_post_id AND conta_id = p_conta_id;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    SELECT id INTO v_fid FROM files                                        -- P2-1 idempotent reuse
      WHERE conta_id = p_conta_id AND r2_key = v_item->>'r2_key' LIMIT 1;
    IF v_fid IS NULL THEN
      v_fid := (file_insert_with_quota(jsonb_build_object(
        'conta_id', p_conta_id, 'r2_key', v_item->>'r2_key',
        'name', COALESCE(v_item->>'filename', 'post-'||p_post_id||'-'||(i+1)),
        'kind','image', 'mime_type', v_item->>'mime_type',
        'size_bytes', (v_item->>'size_bytes')::bigint,
        'width', COALESCE(v_item->>'width',''), 'height', COALESCE(v_item->>'height',''),
        'uploaded_by', p_uploaded_by))).id;                                -- raises 'quota_exceeded'
    END IF;
    INSERT INTO post_file_links(post_id, conta_id, file_id, origin, sort_order, is_cover)
      VALUES (p_post_id, p_conta_id, v_fid, 'manual', i, i = 0);
    v_new := v_new || v_fid; i := i + 1;
  END LOOP;

  DELETE FROM files                                                        -- P2-2 GC old unreused
    WHERE conta_id = p_conta_id AND id = ANY(v_old) AND id <> ALL(v_new) AND reference_count = 0;

  UPDATE workflow_posts SET
    tipo = v_new_tipo,
    status = CASE WHEN status = 'correcao_cliente' THEN 'revisao_interna' ELSE status END
  WHERE id = p_post_id;

  RETURN jsonb_build_object('post_id', p_post_id, 'item_count', i, 'tipo', v_new_tipo,
                            'status', (SELECT status FROM workflow_posts WHERE id = p_post_id));
END; $$;

REVOKE ALL ON FUNCTION post_media_set_from_uploads(uuid, bigint, uuid, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION post_media_set_from_uploads(uuid, bigint, uuid, jsonb) TO service_role;
```

Note the `is_cover=(i=0)` on the first insert plus the BEFORE-INSERT auto-cover trigger are consistent
(no double cover). This DELETEs-then-INSERTs — it never does a one-statement cover *reassign*, so the
non-deferrable partial-unique-index trap (`reference_post_file_links_cover_flip_trap`) does not apply.

- [ ] **Step 2: Write the pgTAP validation test**

Create `supabase/tests/post_media_set_from_uploads.sql` (rolled-back txn; fill fixtures to satisfy live
NOT NULL/FK/CHECK — `workspaces` needs a generous storage quota so `file_insert_with_quota` passes;
`workflows` needs `user_id`+`cliente_id`; use status `aprovado_interno` for the not-editable case):

```sql
\set ON_ERROR_STOP on
begin;
do $$
declare
  v_ws uuid := gen_random_uuid(); v_wf bigint; v_post bigint; v_res jsonb;
  v_u uuid := gen_random_uuid(); v_cli bigint;
begin
  insert into auth.users (id) values (v_u) on conflict do nothing;
  insert into workspaces (id, name, storage_quota_bytes, storage_used_bytes)
    values (v_ws, 'set-media-test', 999999999, 0) on conflict do nothing;
  insert into clientes (conta_id, user_id, nome, sigla) values (v_ws, v_u, 'C', 'C') returning id into v_cli;
  insert into workflows (conta_id, cliente_id, user_id, titulo, status)
    values (v_ws, v_cli, v_u, 'wf', 'ativo') returning id into v_wf;
  insert into workflow_posts (workflow_id, conta_id, titulo, tipo, status)
    values (v_wf, v_ws, 'p', 'feed', 'rascunho') returning id into v_post;

  -- (1) set 3 items → 3 links, sort 0..2, cover=item0, tipo carrossel
  v_res := post_media_set_from_uploads(v_ws, v_post, v_u, jsonb_build_array(
    jsonb_build_object('r2_key','contas/'||v_ws||'/files/a.jpg','size_bytes',10,'mime_type','image/jpeg'),
    jsonb_build_object('r2_key','contas/'||v_ws||'/files/b.jpg','size_bytes',10,'mime_type','image/jpeg'),
    jsonb_build_object('r2_key','contas/'||v_ws||'/files/c.jpg','size_bytes',10,'mime_type','image/jpeg')));
  assert (v_res->>'item_count')::int = 3, 'item_count 3';
  assert v_res->>'tipo' = 'carrossel', 'tipo carrossel';
  assert (select count(*) from post_file_links where post_id = v_post) = 3, '3 links';
  assert (select count(*) from post_file_links where post_id = v_post and is_cover) = 1, '1 cover';
  assert (select sort_order from post_file_links l join files f on f.id=l.file_id
          where l.post_id=v_post and f.r2_key='contas/'||v_ws||'/files/a.jpg') = 0, 'a is sort 0';

  -- (3) idempotent resend of the SAME r2_keys → no new files, storage unchanged
  declare v_used_before bigint; v_files_before int; begin
    select storage_used_bytes into v_used_before from workspaces where id = v_ws;
    select count(*) into v_files_before from files where conta_id = v_ws;
    perform post_media_set_from_uploads(v_ws, v_post, v_u, jsonb_build_array(
      jsonb_build_object('r2_key','contas/'||v_ws||'/files/a.jpg','size_bytes',10,'mime_type','image/jpeg'),
      jsonb_build_object('r2_key','contas/'||v_ws||'/files/b.jpg','size_bytes',10,'mime_type','image/jpeg'),
      jsonb_build_object('r2_key','contas/'||v_ws||'/files/c.jpg','size_bytes',10,'mime_type','image/jpeg')));
    assert (select storage_used_bytes from workspaces where id=v_ws) = v_used_before, 'storage unchanged on resend';
    assert (select count(*) from files where conta_id=v_ws) = v_files_before, 'no new files on resend';
  end;

  -- (4) replace with DIFFERENT images → old unreused files GC'd (reference_count hit 0)
  perform post_media_set_from_uploads(v_ws, v_post, v_u, jsonb_build_array(
    jsonb_build_object('r2_key','contas/'||v_ws||'/files/x.jpg','size_bytes',10,'mime_type','image/jpeg')));
  assert not exists (select 1 from files where conta_id=v_ws and r2_key='contas/'||v_ws||'/files/b.jpg'),
    'old file b GC-deleted';
  assert (select tipo from workflow_posts where id=v_post) = 'feed', 'tipo back to feed (1 item)';

  -- (6) status flip: correcao_cliente → revisao_interna; enviado_cliente stays
  update workflow_posts set status='correcao_cliente' where id=v_post;
  perform post_media_set_from_uploads(v_ws, v_post, v_u, jsonb_build_array(
    jsonb_build_object('r2_key','contas/'||v_ws||'/files/y.jpg','size_bytes',10,'mime_type','image/jpeg')));
  assert (select status from workflow_posts where id=v_post) = 'revisao_interna', 'correcao→revisao';
  update workflow_posts set status='enviado_cliente' where id=v_post;
  perform post_media_set_from_uploads(v_ws, v_post, v_u, jsonb_build_array(
    jsonb_build_object('r2_key','contas/'||v_ws||'/files/z.jpg','size_bytes',10,'mime_type','image/jpeg')));
  assert (select status from workflow_posts where id=v_post) = 'enviado_cliente', 'enviado stays';

  -- (7) rejections
  declare v_threw boolean; begin
    update workflow_posts set status='aprovado_interno' where id=v_post;
    v_threw := false;
    begin perform post_media_set_from_uploads(v_ws, v_post, v_u, jsonb_build_array(
      jsonb_build_object('r2_key','contas/'||v_ws||'/files/q.jpg','size_bytes',10,'mime_type','image/jpeg')));
    exception when sqlstate 'P0001' then assert sqlerrm like 'post_not_editable:%'; v_threw:=true; end;
    assert v_threw, 'not-editable rejected';
    -- design attached
    update workflow_posts set status='rascunho' where id=v_post;
    insert into designs (conta_id, post_id, format, doc_r2_key, doc_hash, doc_bytes)
      values (v_ws, v_post, 'feed', 'dk','dh',10);
    v_threw := false;
    begin perform post_media_set_from_uploads(v_ws, v_post, v_u, jsonb_build_array(
      jsonb_build_object('r2_key','contas/'||v_ws||'/files/w.jpg','size_bytes',10,'mime_type','image/jpeg')));
    exception when sqlstate 'P0001' then assert sqlerrm like 'design_attached%'; v_threw:=true; end;
    assert v_threw, 'design_attached rejected';
  end;

  raise notice 'post_media_set_from_uploads: all cases passed';
end $$;
rollback;
```

- [ ] **Step 3: Validate.** No local Postgres here (Docker down) and staging/prod applies are out of
  scope for this task, so validate by MANUAL TRACE of each pgTAP case against the RPC control flow (as
  with the attach RPC). In the report, mark pgTAP execution PENDING (run at the pre-apply gate, Task 6).
  It is NOT a reason to report BLOCKED.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260707000002_post_media_set_from_uploads.sql supabase/tests/post_media_set_from_uploads.sql
git commit -m "feat(mcp): post_media_set_from_uploads RPC — atomic set-media-from-uploads"
```

---

### Task 2: `get_post` media exposes `file_id` + `link_id` + `sort_order` (TDD)

**Files:**
- Modify: `supabase/functions/mcp/queries.ts` (`getPost` media query + mapping, ~line 416)
- Test: `supabase/functions/__tests__/mcp-media_test.ts` (create it here)

**Interfaces:**
- Produces: each `get_post` media item additionally carries `file_id: number`, `link_id: number`,
  `sort_order: number`. Task 4's E2E and `set_post_media`'s return rely on these.

- [ ] **Step 1: Write the failing test** — create `mcp-media_test.ts`. Use a small self-contained fake db
  (mirror the `makeFakeDb` pattern in `mcp-writes_test.ts`: a `from(table)` recorder that shifts canned
  responses off a per-table queue, `maybeSingle`/`order`/`then` resolving the next). Queue the
  `post_file_links` read with a row shaped `{ id: 55, is_cover: true, sort_order: 0, files: { id: 88,
  kind:'image', mime_type:'image/jpeg', width:1080, height:1350, duration_seconds:null, r2_key:'k',
  thumbnail_r2_key:null } }` and stub `signUrl`. Assert:

```ts
Deno.test("get_post media exposes file_id, link_id, sort_order", async () => {
  const post = await getPost(deps, { post_id: 10 }); // deps: fake db queued per getPost's read order
  assertEquals(post.media[0].file_id, 88);
  assertEquals(post.media[0].link_id, 55);
  assertEquals(post.media[0].sort_order, 0);
  assertEquals(post.media[0].is_cover, true); // unchanged
});
```

(Queue getPost's other reads — `workflow_posts` select→maybeSingle, prop/metric reads, `workflows`
select→maybeSingle — with minimal rows so it reaches the media mapping. Mirror how `mcp-metrics_test.ts`
sets up a `getPost` call.)

- [ ] **Step 2: Run to verify failure**

Run: `npm run test:functions -- --filter "get_post media exposes"`
Expected: FAIL — `file_id`/`link_id`/`sort_order` are `undefined`.

- [ ] **Step 3: Implement.** In `getPost`'s media query add `id` and `files(id, …)` to the select, and add
  the three fields to the mapping:

```ts
    .select("id, is_cover, sort_order, files!inner(id, r2_key, thumbnail_r2_key, kind, mime_type, width, height, duration_seconds)")
```
```ts
    (links ?? []).map(async (l: any) => ({
      link_id: l.id,
      file_id: l.files.id,
      sort_order: l.sort_order,
      kind: l.files.kind,
      mime_type: l.files.mime_type,
      width: l.files.width,
      height: l.files.height,
      duration_seconds: l.files.duration_seconds ?? null,
      is_cover: l.is_cover,
      url: await signUrl(l.files.r2_key),
      thumbnail_url: l.files.thumbnail_r2_key ? await signUrl(l.files.thumbnail_r2_key) : null,
    })),
```

- [ ] **Step 4: Run to verify pass**

Run: `npm run test:functions` (full — additive fields must not break any existing `getPost` assertion;
grep `supabase/functions/__tests__` for exact-object media assertions and extend if any). `deno.lock` clean.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/mcp/queries.ts supabase/functions/__tests__/mcp-media_test.ts
git commit -m "feat(mcp): get_post media exposes file_id + link_id + sort_order"
```

---

### Task 3: Deps wiring + `create_media_upload` (TDD)

**Files:**
- Modify: `supabase/functions/mcp/queries.ts` (`Deps` interface, ~line 49)
- Modify: `supabase/functions/mcp/index.ts` (r2 import ~line 14; deps object ~line 130)
- Create: `supabase/functions/mcp/media.ts`
- Modify: `supabase/functions/mcp/tools.ts` (register)
- Test: `supabase/functions/__tests__/mcp-media_test.ts`

**Interfaces:**
- Consumes: `Deps` (`db`, `ctx`, `randomUUID?`), `McpInputError`, `effectivePlanLimit`, `signPutUrl`.
- Produces: `Deps.signPutUrl?/headObject?/storageQuota?`; `createMediaUpload(d: Deps, args: {files:
  Array<{filename:string; mime_type:'image/jpeg'|'image/png'; size_bytes:number}>}) → {uploads:
  Array<{r2_key:string; upload_url:string; mime_type:string; size_bytes:number}>}`; MCP tool
  `create_media_upload` under `posts:write`.

- [ ] **Step 1: Add the deps to the `Deps` interface** (`queries.ts`):

```ts
  /** Presigned R2 PUT URL for direct client upload (create_media_upload). */
  signPutUrl?: (key: string, mimeType: string) => Promise<string>;
  /** R2 object HEAD for finalize integrity check (set_post_media). */
  headObject?: (key: string) => Promise<{ contentLength: number; contentType: string | null } | null>;
  /** Plan storage quota in bytes (null = unlimited). */
  storageQuota?: (contaId: string) => Promise<number | null>;
```

- [ ] **Step 2: Write the failing tests** (`mcp-media_test.ts`), fake `Deps` = `{ db, ctx, storageQuota,
  signPutUrl, randomUUID }` with stubs (fake db answers `workspaces.select(storage_used_bytes).eq.single`):

```ts
const CTX = { conta_id: "ws-A", scopes: ["posts:write"], key_id: "k", created_by: "u" };

Deno.test("create_media_upload signs a PUT url per file with a tenant-scoped r2_key", async () => {
  const deps = fakeDeps({ used: 0, quota: 1_000_000, uuid: "uuu" });
  const out = await createMediaUpload(deps, { files: [
    { filename: "a.jpg", mime_type: "image/jpeg", size_bytes: 100 }] });
  assertEquals(out.uploads.length, 1);
  assertEquals(out.uploads[0].r2_key, "contas/ws-A/files/uuu.jpg");
  assert(out.uploads[0].upload_url.includes("uuu.jpg")); // stub returns a url embedding the key
  assertEquals(out.uploads[0].size_bytes, 100);
});

Deno.test("create_media_upload rejects when used + Σsize exceeds quota, WITHOUT signing", async () => {
  const signed: string[] = [];
  const deps = fakeDeps({ used: 900, quota: 1000, onSign: (k) => signed.push(k) });
  let threw = false;
  try { await createMediaUpload(deps, { files: [{ filename:"a.jpg", mime_type:"image/jpeg", size_bytes: 200 }] }); }
  catch (e) { threw = e instanceof McpInputError; }
  assert(threw); assertEquals(signed.length, 0, "must not sign when over quota");
});

Deno.test("create_media_upload treats null quota as unlimited", async () => {
  const deps = fakeDeps({ used: 10 ** 12, quota: null, uuid: "u2" });
  const out = await createMediaUpload(deps, { files: [{ filename:"a.png", mime_type:"image/png", size_bytes: 5 }] });
  assertEquals(out.uploads[0].r2_key, "contas/ws-A/files/u2.png");
});
```

- [ ] **Step 3: Run to verify failure**

Run: `npm run test:functions -- --filter "create_media_upload"`
Expected: FAIL — `createMediaUpload` not defined.

- [ ] **Step 4: Implement `media.ts`**

```ts
// MCP media tools: presigned upload (create_media_upload) + set-post-media (set_post_media). Mirrors the
// web UI's file-upload-url → PUT → finalize flow; all DB mutation for set lives in the
// post_media_set_from_uploads RPC. Own-auth via MCP key scopes (posts:write).
import { McpInputError } from "../_shared/mcp-token.ts";
import { getPost, type Deps } from "./queries.ts";

const EXT: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png" };

export async function createMediaUpload(
  d: Deps,
  args: { files: Array<{ filename: string; mime_type: string; size_bytes: number }> },
): Promise<{ uploads: Array<{ r2_key: string; upload_url: string; mime_type: string; size_bytes: number }> }> {
  // Quota precheck BEFORE signing (mirror file-upload-url:90) — no orphan object on overage.
  const total = args.files.reduce((s, f) => s + f.size_bytes, 0);
  const quota = d.storageQuota ? await d.storageQuota(d.ctx.conta_id) : null;
  const { data: ws } = await d.db.from("workspaces").select("storage_used_bytes").eq("id", d.ctx.conta_id).single();
  const used = Number((ws as { storage_used_bytes?: number } | null)?.storage_used_bytes ?? 0);
  if (quota !== null && used + total > quota) {
    throw new McpInputError("Cota de armazenamento excedida — libere espaço em Arquivos.");
  }
  const uploads = [];
  for (const f of args.files) {
    const ext = EXT[f.mime_type] ?? "bin";
    const uuid = d.randomUUID ? d.randomUUID() : crypto.randomUUID();
    const r2_key = `contas/${d.ctx.conta_id}/files/${uuid}.${ext}`;
    const upload_url = await d.signPutUrl!(r2_key, f.mime_type);
    uploads.push({ r2_key, upload_url, mime_type: f.mime_type, size_bytes: f.size_bytes });
  }
  return { uploads };
}
```

- [ ] **Step 5: Wire deps in `index.ts`** — extend the r2 import and add three deps to the `registerTools`
  object:

```ts
import { deleteObject, getObjectBytes, headObject, putObject, signGetUrl, signPutUrl } from "../_shared/r2.ts";
```
```ts
    signPutUrl: (key: string, mime: string) => signPutUrl(key, mime),
    headObject: (key: string) => headObject(key),
    storageQuota: (contaId: string) => effectivePlanLimit(db as never, contaId, "storage_quota_bytes"),
```

- [ ] **Step 6: Register the tool** in `tools.ts` (import `createMediaUpload` from `./media.ts`):

```ts
  register(server, deps, "create_media_upload", "posts:write",
    "Gera URL(s) de upload presigned (PUT) para subir imagens JPG/PNG prontas ao workspace (cota checada antes de assinar). Depois use set_post_media com os r2_key retornados para colocá-las como mídia de um post. Máx 10 arquivos, ≤ 8MB cada.",
    { files: z.array(z.object({
        filename: z.string().trim().min(1).max(200),
        mime_type: z.enum(["image/jpeg", "image/png"]),
        size_bytes: z.number().int().positive().max(8 * 1024 * 1024),
      })).min(1).max(10) },
    (a) => createMediaUpload(deps, a),
    (a) => ({ file_count: a.files.length, total_bytes: a.files.reduce((s: number, f: any) => s + f.size_bytes, 0),
              mime_types: [...new Set(a.files.map((f: any) => f.mime_type))] }));
```

- [ ] **Step 7: Run to verify pass** — `npm run test:functions -- --filter "create_media_upload"` PASS,
  then full `npm run test:functions` green; `deno.lock` clean.

- [ ] **Step 8: Commit**

```bash
git add supabase/functions/mcp/queries.ts supabase/functions/mcp/index.ts supabase/functions/mcp/media.ts supabase/functions/mcp/tools.ts supabase/functions/__tests__/mcp-media_test.ts
git commit -m "feat(mcp): create_media_upload — presigned PUT with quota precheck"
```

---

### Task 4: `set_post_media` (TDD)

**Files:**
- Modify: `supabase/functions/mcp/media.ts` (add `setPostMedia` + `mapSetMediaError`)
- Modify: `supabase/functions/mcp/tools.ts` (register)
- Test: `supabase/functions/__tests__/mcp-media_test.ts`

**Interfaces:**
- Consumes: the RPC from Task 1 via `d.db.rpc("post_media_set_from_uploads", {...})` → `{data, error}`;
  `d.headObject`; `getPost` (Task 2). Coded RPC exceptions per Task 1.
- Produces: `setPostMedia(d: Deps, args: {post_id:number; items: Array<{r2_key:string; size_bytes:number;
  mime_type:'image/jpeg'|'image/png'; width?:number; height?:number; filename?:string}>}) →
  <getPost result>`; MCP tool `set_post_media` under `posts:write`.

- [ ] **Step 1: Write the failing tests** (add an `rpc(fn, params)` recorder to the fake db —
  same shape as `mcp-writes_test.ts`'s: record the call, resolve the queued `rpc:<fn>` response):

```ts
const ITEM = (k: string) => ({ r2_key: `contas/ws-A/files/${k}`, size_bytes: 10, mime_type: "image/jpeg" });

Deno.test("set_post_media rejects a foreign-tenant r2_key without calling the RPC", async () => {
  const { deps, calls } = fakeSetDeps({ head: { contentLength: 10, contentType: "image/jpeg" } });
  let threw = false;
  try { await setPostMedia(deps, { post_id: 5, items: [{ r2_key: "contas/OTHER/files/x.jpg", size_bytes: 10, mime_type: "image/jpeg" }] }); }
  catch (e) { threw = e instanceof McpInputError; }
  assert(threw); assert(!calls.some((c) => c.table === "rpc:post_media_set_from_uploads"));
});

Deno.test("set_post_media rejects a size mismatch (headObject) without calling the RPC", async () => {
  const { deps, calls } = fakeSetDeps({ head: { contentLength: 999, contentType: "image/jpeg" } });
  let threw = false;
  try { await setPostMedia(deps, { post_id: 5, items: [ITEM("a.jpg")] }); }
  catch (e) { threw = e instanceof McpInputError; }
  assert(threw); assert(!calls.some((c) => c.table === "rpc:post_media_set_from_uploads"));
});

Deno.test("set_post_media calls the RPC with mapped params on valid uploads", async () => {
  const { deps, calls } = fakeSetDeps({
    head: { contentLength: 10, contentType: "image/jpeg" },
    rpc: { data: { post_id: 5, item_count: 2, tipo: "carrossel", status: "revisao_interna" }, error: null },
    // queue getPost's reads so the final return resolves (mirror mcp-metrics getPost setup)
  });
  await setPostMedia(deps, { post_id: 5, items: [ITEM("a.jpg"), ITEM("b.jpg")] });
  const rpc = calls.find((c) => c.table === "rpc:post_media_set_from_uploads");
  assertEquals(rpc?.args[0], { p_conta_id: "ws-A", p_post_id: 5, p_uploaded_by: "u",
    p_items: [ITEM("a.jpg"), ITEM("b.jpg")] });
});

Deno.test("set_post_media maps coded RPC exceptions to PT McpInputError", async () => {
  for (const [code, needle] of [
    ["post_not_found", "não encontrado"], ["post_not_editable:aprovado_interno", "aprovado_interno"],
    ["tipo_not_image:reels", "reels"], ["design_attached", "design"], ["quota_exceeded", "Cota"],
  ] as Array<[string, string]>) {
    const { deps } = fakeSetDeps({ head: { contentLength: 10, contentType: "image/jpeg" },
      rpc: { data: null, error: { message: code } } });
    let msg = "", isInput = false;
    try { await setPostMedia(deps, { post_id: 5, items: [ITEM("a.jpg")] }); }
    catch (e) { isInput = e instanceof McpInputError; msg = (e as Error).message; }
    assert(isInput, code); assert(msg.includes(needle), `${code} → ${msg}`);
  }
});

Deno.test("set_post_media never leaks a raw db error", async () => {
  const { deps } = fakeSetDeps({ head: { contentLength: 10, contentType: "image/jpeg" },
    rpc: { data: null, error: { message: "deadlock detected 0x…" } } });
  let msg = "";
  try { await setPostMedia(deps, { post_id: 5, items: [ITEM("a.jpg")] }); } catch (e) { msg = (e as Error).message; }
  assert(!msg.includes("deadlock"));
});
```

- [ ] **Step 2: Run to verify failure** — `npm run test:functions -- --filter "set_post_media"` FAIL.

- [ ] **Step 3: Implement** (append to `media.ts`):

```ts
function mapSetMediaError(message: string): McpInputError {
  if (message === "post_not_found") return new McpInputError("Post não encontrado neste workspace.");
  if (message.startsWith("post_not_editable:")) {
    return new McpInputError(`Post em estado '${message.slice("post_not_editable:".length)}' não pode receber mídia pelo agente.`);
  }
  if (message.startsWith("tipo_not_image:")) {
    return new McpInputError(`Posts do tipo '${message.slice("tipo_not_image:".length)}' não recebem imagens (suportados: feed, carrossel).`);
  }
  if (message === "design_attached") {
    return new McpInputError("A mídia deste post é gerida por um design — edite o design com update_design.");
  }
  if (message === "quota_exceeded") return new McpInputError("Cota de armazenamento excedida.");
  return new McpInputError("Não foi possível definir a mídia do post.");
}

export async function setPostMedia(
  d: Deps,
  args: {
    post_id: number;
    items: Array<{ r2_key: string; size_bytes: number; mime_type: string; width?: number; height?: number; filename?: string }>;
  },
): Promise<unknown> {
  // Integrity precheck (TS — R2 is outside the DB). All eligibility/mutation is in the RPC.
  const prefix = `contas/${d.ctx.conta_id}/files/`;
  for (const it of args.items) {
    if (!it.r2_key.startsWith(prefix)) {
      throw new McpInputError("Upload não encontrado ou divergente. Gere os uploads com create_media_upload.");
    }
    const head = d.headObject ? await d.headObject(it.r2_key) : null;
    if (!head || head.contentLength !== it.size_bytes ||
        (head.contentType && it.mime_type && head.contentType !== it.mime_type)) {
      throw new McpInputError("Upload não encontrado ou divergente. Gere os uploads com create_media_upload.");
    }
  }
  // RETURNS jsonb (scalar) → { data, error } directly (no .single()); we ignore data and re-read
  // via getPost so the agent gets the full ordered media back.
  const { error } = await d.db.rpc("post_media_set_from_uploads", {
    p_conta_id: d.ctx.conta_id, p_post_id: args.post_id, p_uploaded_by: d.ctx.created_by, p_items: args.items,
  });
  if (error) throw mapSetMediaError((error as { message?: string }).message ?? "");
  return await getPost(d, { post_id: args.post_id });
}
```

- [ ] **Step 4: Register the tool** in `tools.ts` (import `setPostMedia`):

```ts
  register(server, deps, "set_post_media", "posts:write",
    "Define a mídia de um post (feed/carrossel) a partir de imagens já enviadas (r2_key de create_media_upload). SUBSTITUI toda a mídia atual, na ordem dada (capa = 1º item), sincroniza o tipo (feed/carrossel) e devolve o post atualizado. Rejeita posts com design (edite o design). Máx 10 itens.",
    { post_id: z.number().int().positive(),
      items: z.array(z.object({
        r2_key: z.string(), size_bytes: z.number().int().positive(),
        mime_type: z.enum(["image/jpeg", "image/png"]),
        width: z.number().int().positive().optional(), height: z.number().int().positive().optional(),
        filename: z.string().max(200).optional(),
      })).min(1).max(10) },
    (a) => setPostMedia(deps, a),
    (a) => ({ post_id: a.post_id, item_count: a.items.length,
              total_bytes: a.items.reduce((s: number, i: any) => s + i.size_bytes, 0) }));
```

- [ ] **Step 5: Run to verify pass** — `npm run test:functions` green; `deno.lock` clean.

- [ ] **Step 6: Commit**

```bash
git add supabase/functions/mcp/media.ts supabase/functions/mcp/tools.ts supabase/functions/__tests__/mcp-media_test.ts
git commit -m "feat(mcp): set_post_media — finalize uploads + atomic set via RPC"
```

---

### Task 5: Announce the capability

**Files:**
- Modify: `supabase/functions/mcp/capabilities.ts`
- Test: `supabase/functions/__tests__/mcp-capabilities_test.ts` (only if it asserts the capability list)

**Interfaces:** consumes nothing new; surfaces the two tools in `get_design_capabilities`'s discovery
output (or the connector's capability announcement — match whatever `capabilities.ts` already lists).

- [ ] **Step 1:** Read `capabilities.ts` and find where tools/capabilities are enumerated. If it lists a
  media/post capability, add a line describing the upload→set flow (`create_media_upload` +
  `set_post_media`, JPG/PNG ≤ 8 MB, ≤ 10, replace-all, tipo-sync). If `capabilities.ts` does NOT
  enumerate write tools (it may only cover Estúdio design capabilities), make NO change and record in the
  report that no capability surface applies — do not invent one. (YAGNI: don't add an announcement
  mechanism that isn't already there.)

- [ ] **Step 2:** If you changed it and a test asserts the capability shape, update/extend that test; run
  `npm run test:functions`. If no change, skip to commit-less completion and note it.

- [ ] **Step 3: Commit (if changed)**

```bash
git add supabase/functions/mcp/capabilities.ts supabase/functions/__tests__/mcp-capabilities_test.ts
git commit -m "feat(mcp): announce upload+set media capability"
```

---

### Task 6: Gates + rollout + E2E

**Files:** none (operations)

- [ ] **Step 1: Gates.** `npm run test:functions` (full, green), root `deno.lock` clean
  (`git diff deno.lock` empty; revert if not). No `apps/`/`packages/` changes → CRM prettier/tsc/vitest
  gates N/A.

- [ ] **Step 2: pgTAP on a real Postgres.** Build a self-contained validator (as with the attach slice):
  `begin; <migration 20260707000002 body> <pgTAP do-block from supabase/tests/post_media_set_from_uploads.sql, minus \set/begin/rollback> rollback;` and run it against STAGING via
  `psql "<staging conn>" -f <file>` (fixtures roll back; zero residue). Expect `NOTICE:
  post_media_set_from_uploads: all cases passed`. Fix any real-DB surprise before prod apply.

- [ ] **Step 3: STOP — Eduardo applies** `20260707000002_post_media_set_from_uploads.sql` to PROD via the
  SQL editor; record the version. Additive (new function), safe ahead of the deploy.

- [ ] **Step 4: Deploy** `npx supabase functions deploy mcp --use-api --no-verify-jwt --project-ref
  skjzpekeqefvlojenfsw`. **This same deploy retires the live `attach_image_to_post` tool** (it is not in
  this branch). Confirm afterward via a reconnected client that `set_post_media`/`create_media_upload`
  are listed and `attach_image_to_post` is gone.

- [ ] **Step 5: Live E2E (DK TESTE, disposable post).** With a reconnected MCP key (`posts:write`):
  1. `create_media_upload({files:[{filename,mime_type:'image/jpeg',size_bytes}]})` → `uploads[]` with a
     `contas/<conta>/files/…` `r2_key`. HTTP PUT a real small JPG to `upload_url` (Content-Type = mime) →
     200. Quota path: a bogus huge `size_bytes` → `quota_exceeded`, no object.
  2. `set_post_media({post_id, items:[{r2_key,size_bytes,mime_type,width,height}]})` on a disposable
     `rascunho` post → `get_post` shows the image, `is_cover`, `sort_order` 0, `tipo=feed`; art visible in
     the web app.
  3. Carousel: two items → `get_post` 2 media, order 0/1, cover slide 1, `tipo=carrossel`.
  4. Idempotent resend (same `r2_key`s) → media unchanged, no storage recharge.
  5. Negatives: foreign-tenant `r2_key`; size≠HEAD; 11 items; a `stories` post (`tipo_not_image`); a
     design-attached post (`design_attached`); `posts:read`-only key → scope refusal.
  6. Status: a `correcao_cliente` post → after set, `revisao_interna`; an `enviado_cliente` post stays.
  7. Delete ALL residue (post + any files surfaced in Arquivos).

- [ ] **Step 6: PR** `feat/mcp-set-post-media` → main with E2E evidence; Eduardo merges.

- [ ] **Step 7: Memory/docs.** Update `project_mcp_attach_image_to_post` (attach superseded/retired) +
  add a note for the new tools; record follow-ups: **orphan-GC sweep**, **`add_post_media`** (append),
  optional **`DROP FUNCTION attach_image_to_post`** on prod.

## Error taxonomy

| source | code → PT (`McpInputError`) |
|---|---|
| `create_media_upload` | quota precheck → "Cota de armazenamento excedida…" |
| `set_post_media` TS | prefix/HEAD mismatch → "Upload não encontrado ou divergente…" |
| RPC | `post_not_found` / `post_not_editable:<st>` / `tipo_not_image:<t>` / `design_attached` / `quota_exceeded` → mapped PT (Task 4); unknown → "Não foi possível definir a mídia do post." |

## Out of scope (recorded follow-ups)

- **Orphan-GC sweep** — cron deleting `contas/*/files/*` R2 objects with no `files` row, older than N h
  (own slice; needs R2 listing).
- **`add_post_media`** — append without replace.
- **`DROP FUNCTION attach_image_to_post`** on prod (orphaned after this deploy retires the tool).

## Self-review notes

- Spec coverage: §4.1→Task 3, §4.2→Task 4, §5→Task 1, P2-3→Task 2, §6 deps→Task 3, capabilities→Task 5,
  rollout/E2E→Task 6. All design sections mapped.
- Decision 1 (RPC reads `filename`) applied consistently in Task 1 SQL + Task 4 params (items passed
  verbatim; RPC reads `filename`).
- Types consistent: `Deps.signPutUrl/headObject/storageQuota` defined Task 3, used Tasks 3–4; RPC name
  `post_media_set_from_uploads` and exception tokens identical in Task 1 (raise) and Task 4 (map).
