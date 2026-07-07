# MCP: upload a ready image and set it as a post's media — Design

**Date:** 2026-07-07 · **Connector:** `supabase/functions/mcp/` · **Approach:** presigned PUT
(mirror the web UI) + one atomic set-RPC. **Supersedes:** `attach_image_to_post`.

Consolidates the user's review-hardened spec (P1/P2 incorporated) with two decisions made in
brainstorming and two corrections found by grounding the spec against the code.

## Decisions locked (this design)

- **D0 — Supersede `attach_image_to_post`.** The upload→set flow below is THE media-write path.
  `attach_image_to_post` (appends one existing `file_id`) is dropped from the code; the next
  `mcp` deploy retires the live tool. Its already-applied RPC (`20260707000001`) is left orphaned
  on prod (harmless — nothing calls it; optional `DROP FUNCTION` is a recorded follow-up). The
  `feat/mcp-attach-image` branch is abandoned (never merges). Rationale: `set_post_media` covers the
  existing-file case too (pass its `r2_key`; P2-1 idempotency reuses the `files` row), and the only
  thing attach did that it doesn't — append-without-replace — is explicitly deferred (D1).
- **D1 — `set_post_media` REPLACES all of a post's media** (predictable). An `add_post_media`
  (append) is a later follow-up.
- **D2 — Editable in `DESIGN_ELIGIBLE_STATUSES`** (incl. `enviado_cliente`) **with**
  `correcao_cliente → revisao_interna` on set (P1-5). Parity with `migrations/20260706000001`.
- **D3 — Reuse the `posts:write` scope** (no key re-consent; a new `media:write` scope would force
  re-consent and redeploying every fn that imports `MCP_ALLOWED_SCOPES`).
- **D4 — Auto-sync `tipo`** feed↔carrossel by item count, inside the RPC.
- **Orphan-GC sweep is DEFERRED** to a fast-follow slice (needs R2 listing + reconciliation no
  current fn has). The benign leak — a presigned object PUT but never finalized — does NOT count
  against quota (no `files` row); it just occupies R2 until the follow-up sweep lands.

## Grounding corrections (spec was slightly stale)

- **`get_post` already exposes `file_id`, `link_id`, `is_cover`** (Task 4 of the superseded slice +
  pre-existing `is_cover`). P2-3 therefore reduces to **adding `sort_order`** to the media items.
- **`DESIGN_ELIGIBLE_STATUSES` is already exported** (`mcp/queries.ts:904`) — §7's "export it" is a
  no-op. `signPutUrl`, `headObject`, `effectivePlanLimit` all exist/are-imported as the spec assumed.

## 1. Problem (verified)

The "Mesaas Instagram Visual Designer" skill produces a post as a **flat finished image** (JPG, text
already baked). Today no MCP path puts that image on a post: `generate_image` mints a `file_id` but
never attaches; `set_post_property` doesn't touch media; `create/update_post` are text-only; and
`attach_design` needs an editor design (can't import a flat image → `image_not_found`). Upload is
manual in the web UI. `attach_image_to_post` (just shipped) does not solve this either: a skill's flat
JPG has **no `file_id`** — the bytes were never uploaded to the workspace.

## 2. The capability already exists — it just isn't in the MCP

The web app already uploads an image and attaches it to a post via a presigned flow:
`file-upload-url` (validate MIME/size/**quota** → presigned PUT URL) → client PUTs bytes to R2 →
`file-upload-finalize` (`headObject` confirms, `file_insert_with_quota` creates the `files` row, and
with `post_id`+`sort_order` inserts `post_file_links`). The connector's `get_post` reads exactly that
(`files` + `post_file_links`). The fix = **expose two MCP tools reusing this plumbing**. No new
storage, no new tables, no data migration. (Legacy `post_media` is unused by the connector — ignore.)

## 3. Data model (real names, confirmed against migrations)

- **`files`** (`20260425000001:37–56`): `id, conta_id, folder_id, r2_key, thumbnail_r2_key, name,
  kind('image'|'video'|'document'), mime_type, size_bytes, width, height, duration_seconds,
  uploaded_by, reference_count, created_at`. `r2_key` is **not** unique.
- **`post_file_links`** (`20260425000001:72–80` + `20260702000001:127`): `id, post_id,
  file_id (ON DELETE RESTRICT), conta_id, is_cover (1/post, partial unique index), sort_order (0-based),
  origin('manual'|'design'), created_at`.
- **RPC `file_insert_with_quota(p jsonb) → files`** (`20260425000002:221`): locks the workspace,
  checks quota, inserts `files`, adds `storage_used_bytes`. Always inserts (no dedup by `r2_key`).
- **Trigger facts (confirmed, `20260425000002`):** `reference_count` is symmetric — `+1` AFTER INSERT
  / `−1` AFTER DELETE on `post_file_links` (`:149–155`). Deleting a `files` row **enqueues R2 deletion**
  (`file_deletions`, `:205–216`) **and** returns quota (`file_update_used_bytes`, `:264`). Cover is
  trigger-managed: BEFORE-INSERT auto-cover on the first link (`:160–174`), AFTER-DELETE reassign
  (`:176–200`). **Reassigning a cover must be two statements** (the `one_cover` partial unique index is
  non-deferrable — see `reference_post_file_links_cover_flip_trap`); this design never reassigns in one
  statement (it deletes then re-inserts with `is_cover=(i=0)`, which is safe).

Canonical write pattern = `finalize_design_render` (`20260705000001:411–533`): capture old ids → delete
links → per item `file_insert_with_quota` + insert link → delete old unreused `files` (fires R2 queue).
The RPC below mirrors it.

## 4. The two tools

### 4.1 `create_media_upload` — presigned PUT URL(s) (mirrors `file-upload-url`)

Scope `posts:write`. Registered in `mcp/tools.ts` via `register(...)`.

```ts
// zod shape
{ files: z.array(z.object({
    filename:   z.string().trim().min(1).max(200),
    mime_type:  z.enum(["image/jpeg", "image/png"]),
    size_bytes: z.number().int().positive().max(8 * 1024 * 1024), // 8MB = IG publish cap
  })).min(1).max(10) }
```

**run:** (1) **Quota precheck (P1-2)** — read `workspaces.storage_used_bytes` for `ctx.conta_id` +
`effectivePlanLimit(db, conta_id, "storage_quota_bytes")`; if `quota !== null && used + Σsize_bytes >
quota` → `McpInputError('quota_exceeded')` **before** signing (no orphan object). (2) per file:
`uuid`; `r2_key = contas/${ctx.conta_id}/files/${uuid}.${ext}`; `upload_url = signPutUrl(r2_key,
mime_type)`.
**returns:** `{ uploads: [{ r2_key, upload_url, mime_type, size_bytes }] }`.
**auditArgs (P1-3):** `{ file_count, total_bytes, mime_types: uniq(mime) }` — never filename/r2_key/url.

### 4.2 `set_post_media` — finalize + set media in carousel order

Scope `posts:write`. The TS does only the R2 integrity precheck (external to the DB); **all DB mutation
is inside the atomic RPC** (§5).

```ts
// zod shape
{ post_id: z.number().int().positive(),
  items: z.array(z.object({
    r2_key: z.string(), size_bytes: z.number().int().positive(),
    mime_type: z.enum(["image/jpeg","image/png"]),
    width: z.number().int().positive().optional(),
    height: z.number().int().positive().optional(),
    filename: z.string().max(200).optional(),
  })).min(1).max(10) }
```

**run:** (1) **Integrity per item (TS — R2 is outside the DB):** `r2_key` must start with
`contas/${ctx.conta_id}/files/`; `head = headObject(r2_key)`; require `head && head.contentLength ===
size_bytes` (and `contentType === mime_type` when present) → else
`McpInputError('upload_not_found_or_size_mismatch')`. (2) call
`post_media_set_from_uploads(p_conta_id, p_post_id, p_uploaded_by=ctx.created_by, p_items)` (§5); map RPC
errors → `McpInputError`: `post_not_found | post_not_editable:<st> | tipo_not_image:<t> |
design_attached | quota_exceeded`. (3) return `getPost(deps, { post_id })`.
**auditArgs (P1-3):** `{ post_id, item_count, total_bytes }`.

**get_post (P2-3):** add `sort_order` to the media items (`file_id`/`link_id`/`is_cover` already present
after Task 4). Same query already orders by `sort_order`.

## 5. RPC `post_media_set_from_uploads` — the transactional boundary

New migration; **no table changes**. Everything under the post-row lock. (Body carried verbatim from
the user's spec — it is grounded against `20260425000002`; the reviewer's line-by-line confirmations in
the spec hold.)

```sql
CREATE OR REPLACE FUNCTION post_media_set_from_uploads(
  p_conta_id uuid, p_post_id bigint, p_uploaded_by uuid, p_items jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_post workflow_posts; v_item jsonb; i int := 0;
        v_new_tipo text; v_old bigint[]; v_new bigint[] := '{}'; v_fid bigint;
BEGIN
  SELECT * INTO v_post FROM workflow_posts
    WHERE id = p_post_id AND conta_id = p_conta_id FOR UPDATE;           -- (P1-1) lock
  IF NOT FOUND THEN RAISE EXCEPTION 'post_not_found'; END IF;

  IF v_post.status NOT IN ('rascunho','revisao_interna','correcao_cliente','enviado_cliente')
    THEN RAISE EXCEPTION 'post_not_editable:%', v_post.status; END IF;
  IF v_post.tipo NOT IN ('feed','carrossel')
    THEN RAISE EXCEPTION 'tipo_not_image:%', v_post.tipo; END IF;
  IF EXISTS (SELECT 1 FROM designs WHERE post_id = p_post_id AND conta_id = p_conta_id)
    THEN RAISE EXCEPTION 'design_attached'; END IF;

  v_new_tipo := CASE WHEN jsonb_array_length(p_items) > 1 THEN 'carrossel' ELSE 'feed' END;

  SELECT COALESCE(array_agg(file_id), '{}') INTO v_old
    FROM post_file_links WHERE post_id = p_post_id AND conta_id = p_conta_id;
  DELETE FROM post_file_links WHERE post_id = p_post_id AND conta_id = p_conta_id;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    SELECT id INTO v_fid FROM files                                        -- (P2-1) idempotent reuse
      WHERE conta_id = p_conta_id AND r2_key = v_item->>'r2_key' LIMIT 1;
    IF v_fid IS NULL THEN
      v_fid := (file_insert_with_quota(jsonb_build_object(
        'conta_id', p_conta_id, 'r2_key', v_item->>'r2_key',
        'name', COALESCE(v_item->>'name', 'post-'||p_post_id||'-'||(i+1)),
        'kind','image', 'mime_type', v_item->>'mime_type', 'size_bytes', (v_item->>'size_bytes')::bigint,
        'width', COALESCE(v_item->>'width',''), 'height', COALESCE(v_item->>'height',''),
        'uploaded_by', p_uploaded_by))).id;                                -- raises 'quota_exceeded'
    END IF;
    INSERT INTO post_file_links(post_id, conta_id, file_id, origin, sort_order, is_cover)
      VALUES (p_post_id, p_conta_id, v_fid, 'manual', i, i = 0);
    v_new := v_new || v_fid; i := i + 1;
  END LOOP;

  DELETE FROM files                                                        -- (P2-2) GC old unreused
    WHERE conta_id = p_conta_id AND id = ANY(v_old) AND id <> ALL(v_new) AND reference_count = 0;

  UPDATE workflow_posts SET                                                -- (P1-5/D4) tipo + status
    tipo = v_new_tipo,
    status = CASE WHEN status = 'correcao_cliente' THEN 'revisao_interna' ELSE status END
  WHERE id = p_post_id;

  RETURN jsonb_build_object('post_id', p_post_id, 'item_count', i, 'tipo', v_new_tipo,
                            'status', (SELECT status FROM workflow_posts WHERE id = p_post_id));
END; $$;

REVOKE ALL ON FUNCTION post_media_set_from_uploads(uuid, bigint, uuid, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION post_media_set_from_uploads(uuid, bigint, uuid, jsonb) TO service_role;
```

Cover safety: the RPC DELETEs all links then INSERTs fresh with `is_cover = (i = 0)`; the auto-cover
trigger also fires on the first insert (consistent, no double cover). No one-statement cover *reassign*
occurs → the partial-unique-index trap does not apply.

## 6. Deps wiring (`mcp/`)

- `mcp/index.ts`: import `{ signPutUrl, headObject }` from `../_shared/r2.ts`; inject into
  `registerTools(...)`: `signPutUrl: (k,m)=>signPutUrl(k,m)`, `headObject: (k)=>headObject(k)`, and a
  `storageQuota: (c)=>effectivePlanLimit(db,c,'storage_quota_bytes')` (or call inline).
- `mcp/queries.ts`: extend `Deps` with `signPutUrl?`, `headObject?`; add `sort_order` to `getPost` media.

## 7. Files to touch

| File | Change |
|---|---|
| `mcp/index.ts` | import + inject `signPutUrl`/`headObject`/quota (§6) |
| `mcp/queries.ts` | `Deps += signPutUrl/headObject`; `getPost` media `+ sort_order` (P2-3) |
| `mcp/media.ts` (**new**) | `createMediaUpload` + `setPostMedia` (§4) |
| `mcp/tools.ts` | `register(...)` the 2 tools + `auditArgs` (P1-3). (No attach removal here — this branch is off `main`, which never had it; the deploy retires the live tool per D0.) |
| `migrations/…_post_media_set_from_uploads.sql` (**new**) | the RPC §5 |
| `mcp/capabilities.ts` | announce the new capability |
| `__tests__/mcp-media_test.ts` (**new**) | §9 |

## 8. Validations (reuse; don't reinvent)

Quota: precheck in `create_media_upload` (P1-2) + `file_insert_with_quota` inside the RPC (real gate).
Size ≤ 8 MB/image (P1-4). Editable: `DESIGN_ELIGIBLE_STATUSES` + `correcao_cliente→revisao_interna`
(P1-5). Tenant: `r2_key` must start with `contas/${ctx.conta_id}/files/`; everything conta-scoped. One
design per post → reject if `designs.post_id`. Carousel ≤ 10. `kind` fixed `image`. Audit: aggregated
metadata only (P1-3).

## 9. Test plan (integration; mirror `__tests__/mcp-design_test.ts`)

1. `create_media_upload` → valid `upload_url`; quota-exceeded in precheck → `quota_exceeded`, **no** R2
   object. 2. `set_post_media(rascunho, 5 items)` → `get_post` shows 5 media in `sort_order` 0..4, cover
   = item 0, `tipo=carrossel`. 3. **Idempotency (P2-1):** resend same `r2_key`s → no new `files`,
   `storage_used_bytes` unchanged, links replaced not duplicated. 4. **Cleanup (P2-2):** resend with
   different images → old `files` at `reference_count=0` deleted (R2 queue), reused kept. 5.
   **Concurrency (P1-1):** `attach_design` racing `set_post_media` on one post → one loses cleanly under
   the lock; final state is design XOR manual media, never both. 6. **Status (P1-5):** `correcao_cliente`
   → `revisao_interna` after set; `enviado_cliente` stays. 7. **Rejections:** scheduled/published post;
   design attached; foreign-tenant `r2_key`; size ≠ `headObject`; 11 items; `tipo=reels/stories`; image
   > 8 MB. 8. **get_post (P2-3):** media items include `sort_order` (+ existing `file_id/link_id/is_cover`).

Note the RPC's DB behavior (locks, GC, quota, cover trigger) is only fully exercised against a real
Postgres — the Deno tests mock `db.rpc`, so include a pgTAP-style validation file for the RPC (as with
the attach slice) and run it against a real DB before prod apply.

## 10. Rollout

1. RPC migration (no downtime, additive). Validated on a real Postgres (pgTAP) before prod apply;
   applied to prod by Eduardo via SQL editor (db push blocked by dup-timestamp). 2. Deploy `mcp`
   (`--use-api --no-verify-jwt`) — this same deploy **retires the live `attach_image_to_post` tool**
   (D0). 3. Update `capabilities`. 4. No data migration. 5. Wire the skill (replaces the manual step).

## 11. Skill end-to-end

```
1) create_media_upload({ files:[{filename,mime_type,size_bytes}×N] }) → uploads[]
2) per upload: HTTP PUT upload_url  (body = JPG bytes, Content-Type = mime)
3) set_post_media({ post_id, items:[{r2_key,size_bytes,mime_type,width,height}×N] })
4) get_post(post_id) → ordered media; done (nothing manual).
```

## 12. Deferred follow-ups (recorded)

- **Orphan-GC sweep** (P1-2 / §10.5): a cron that deletes R2 objects under `contas/*/files/*` with no
  `files` row, older than N hours. Own slice (needs R2 listing + reconciliation).
- **`add_post_media`** (append without replace) — the append primitive attach used to provide.
- **Optional `DROP FUNCTION attach_image_to_post`** on prod (orphaned after D0).

## 13. Acceptance

An MCP key with `posts:write`, no UI: uploads N JPGs (presigned PUT, quota checked first), calls
`set_post_media`, and `get_post` returns the N images as the post's media — in order, cover on slide 1,
`tipo` synced, `correcao_cliente→revisao_interna` (and `enviado_cliente` intact) — and the art shows in
the web app. Idempotent resend (§9.3), old-file GC (§9.4), race resolved under lock (§9.5), audit with
aggregated metadata only, rejections + quota per §9. The superseded `attach_image_to_post` tool is gone
from the connector after deploy. **Zero manual steps.**
