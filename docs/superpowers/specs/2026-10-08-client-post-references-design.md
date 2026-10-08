# Referências do cliente no post (Hub → editor do post)

Date: 2026-10-08
Status: design approved by the user (mockups + four decisions), pending Fable review
Mockups: https://claude.ai/artifact/6VVsAAMQz99mTAV3jw94KC

## Problem

Clients review posts in the Hub and ask for changes, but the material behind a change
(the photo they want used, a video clip, a PDF with updated numbers, a post they like)
arrives by WhatsApp or e-mail and gets separated from the post. The Hub has no way to
attach anything to a post: `hub-edit-suggestion` deliberately rejects inline images, and
`post_approvals` comments are text only.

## Goal

A client opening a post in the Hub can attach **references** (images, videos, PDFs and
links), each with an optional note, while the post waits for their approval. The team
sees them in the CRM post editor, next to the post's own media, and is notified.

## Non-goals (v1)

- "Usar no post" (copy a reference into the post's publishable media). Mocked as optional;
  not built. If built later it must COPY the R2 object into a new `files` row (see
  Invariants).
- "Baixar todas" (zip). Shown in the mockup header; dropped from v1. Per-item download only.
- Link previews (fetching the site's title/image). Phase 2; needs an SSRF-hardened fetcher.
- Team-added references. The team already has post media and Arquivos.
- Attachments on plain comments (`mensagem`). Only the correction composer and the
  Referências tab attach.
- References showing up in Arquivos. They are owned by the post, like ideia images.
- Cloudflare Stream for reference videos (decision 3).

## Decisions (approved 2026-10-08)

1. **Write gate.** The client can add, edit the note of, or remove references only while
   `workflow_posts.status = 'enviado_cliente'` (the same gate as Corrigir /
   `hub-edit-suggestion`). In any other client-visible status the list is read-only.
2. **Client removal.** A client may remove (or edit the note of) a reference while the
   write gate holds AND no team reply exists after it: no `post_approvals` row with
   `is_workspace_user = true` for the post with `created_at > reference.created_at`.
3. **Video.** Stored as a plain R2 file, never copied to Cloudflare Stream. Thumbnail
   (poster) generated in the browser. 200 MB cap. Images and PDFs 25 MB.
4. **Links.** v1 stores URL, optional title, optional note, and shows the domain. No fetch.

## Limits

| | Value |
|---|---|
| References per post (files + links) | 10 |
| Image (jpeg, png, webp, gif) | 25 MB |
| PDF | 25 MB |
| Video (mp4, quicktime, webm) | 200 MB |
| Thumbnail (webp) | 512 KB |
| Note | 500 chars |
| Link title | 120 chars |
| URL | 2048 chars, `http`/`https` only, no credentials |

## Data model

Migration `2026101000000N_post_references.sql` (version must sort above `main`'s tail at
PR time; re-check before `gh pr create`).

```sql
CREATE TABLE post_references (
  id               bigserial PRIMARY KEY,
  post_id          bigint NOT NULL,
  conta_id         uuid   NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  cliente_id       bigint NOT NULL,           -- the post's client at insert time (Hub filter)
  kind             text   NOT NULL CHECK (kind IN ('file', 'link')),
  file_id          bigint,
  url              text,
  link_title       text CHECK (link_title IS NULL OR char_length(link_title) <= 120),
  note             text CHECK (note IS NULL OR char_length(note) <= 500),
  post_approval_id bigint REFERENCES post_approvals(id) ON DELETE SET NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT post_references_post_fk
    FOREIGN KEY (post_id, conta_id) REFERENCES workflow_posts(id, conta_id) ON DELETE CASCADE,
  CONSTRAINT post_references_file_fk
    FOREIGN KEY (file_id, conta_id) REFERENCES files(id, conta_id) ON DELETE CASCADE,
  CONSTRAINT post_references_shape CHECK (
    (kind = 'file' AND file_id IS NOT NULL AND url IS NULL AND link_title IS NULL) OR
    (kind = 'link' AND file_id IS NULL AND url IS NOT NULL)),
  CONSTRAINT post_references_url_shape CHECK (
    url IS NULL OR (char_length(url) <= 2048 AND url ~* '^https?://'))
);
CREATE INDEX post_references_post_idx ON post_references (post_id, created_at);
CREATE UNIQUE INDEX post_references_file_uq ON post_references (file_id) WHERE file_id IS NOT NULL;
CREATE INDEX post_references_approval_idx ON post_references (post_approval_id)
  WHERE post_approval_id IS NOT NULL;
```

The composite FKs reuse `workflow_posts_id_conta_uq` (20260820000002) and
`files_id_conta_uq` (20260626000001), pinning post and file to the row's workspace.
There is no composite FK for `post_approval_id`; the linking step (below) enforces
`post_approvals.post_id = post_references.post_id`.

**RLS.** Enabled. `SELECT` for `conta_id IN (SELECT get_my_conta_id())` (the CRM drawer
badge reads counts directly). No INSERT/UPDATE/DELETE policy for `authenticated`: every
write goes through an edge function using the service role. Service-role bypass policy as
in `ideia_files`. Before relying on table grants, confirm in the migration that
`authenticated` holds SELECT (default privileges) and `anon` holds nothing (revoke
explicitly; see memory on REVOKE FROM PUBLIC).

**`files` rows.** File references reuse `files` for quota, thumbnails and R2 cleanup:
`folder_id NULL` (not a file-manager asset), `uploaded_by NULL` (Hub upload),
`kind` from MIME (`image | video | document`), `duration_seconds` for video,
`thumbnail_r2_key` required for image and video (the existing
`files_video_requires_thumbnail` CHECK already enforces video), none for PDF.
Keys follow the ideia pattern: `contas/{conta}/files/{uuid}.{ext}` and
`…/{uuid}.thumb.webp`.

**Stream opt-out.** `post-media-cleanup-cron`'s ingest catch-up copies to Stream every
`files` row with `kind = 'video' AND stream_uid IS NULL AND stream_status IS NULL OR
'pending'` older than 10 minutes. Reference videos must not match: extend the
`files.stream_status` CHECK (20260814000002) to allow `'skipped'` and insert reference
videos with `stream_status = 'skipped'`. The plan must grep every reader of
`files.stream_status` (CRM playback, `file-manage`, Stream webhook, settle/reap sweeps)
and confirm `'skipped'` falls through to plain R2 playback or is ignored, never treated as
an error or retried.

**Triggers.**
- `file_update_reference_count()` AFTER INSERT/DELETE on `post_references`, only when
  `file_id IS NOT NULL` (wrap or guard; the shared function reads `NEW/OLD.file_id`).
- `post_reference_cleanup_orphan()` AFTER DELETE: when `OLD.file_id IS NOT NULL` and no
  row in `post_references`, `ideia_files`, `post_file_links` or `report_document_files`
  still points at it, `DELETE FROM files WHERE id = OLD.file_id`. That fires the existing
  R2 delete enqueue and quota refund (`file_enqueue_delete`, `file_update_used_bytes`).
  SECURITY DEFINER, `SET search_path = public, pg_temp`. Deleting the post cascades to
  `post_references` and runs this per row.
- `updated_at` touch on UPDATE.

**Invariant.** A `files` row created for a reference is never linked from any other table.
That is why `ideia_file_cleanup_orphan` and `storage_autoclean_candidates` need no change
(autoclean only considers files with a `post_file_links` row). A future "Usar no post"
copies the object to a new key and a new `files` row.

### RPCs (SECURITY DEFINER, `REVOKE ALL … FROM public, anon, authenticated`, `GRANT EXECUTE … TO service_role`)

- `post_reference_file_insert(p jsonb) RETURNS post_references`: locks the post row
  (`SELECT … FROM workflow_posts WHERE id = p.post_id AND conta_id = p.conta_id AND
  cliente_id = p.cliente_id FOR UPDATE`), raises `post_not_found`, `post_not_pending`
  (status ≠ `enviado_cliente`), `reference_limit` (≥ 10 rows), `quota_exceeded`
  (same plan-quota logic as `ideia_file_insert_with_quota`, charges `size_bytes` only),
  inserts `files` (with `stream_status = 'skipped'` for video) and the reference, charges
  `storage_used_bytes`.
- `post_reference_link_insert(p jsonb) RETURNS post_references`: same lock and gate,
  limit check, inserts a `link` row. URL already validated by the handler; the CHECK is
  the backstop.
- `create_post_reference_notification(p_post_id bigint) RETURNS integer`: targets from
  `resolve_notification_targets(conta, responsavel_id, ARRAY['owner','admin'])` (same as
  edit suggestions), link `/entregas?post=` or `/entregas?drawer=` (same CASE), metadata
  `{client_name, post_title, workflow_id, post_id}`. **Coalesces:** skips a target who
  already has an unread `post_client_reference` notification with the same `post_id`
  created in the last 15 minutes, so ten uploads in a row make one notification.

### Notification type

New type `post_client_reference`. Copy the latest `notifications_type_check` and
`notification_inapp_prefs_type_check` definitions (currently
`20261008000002_agenda_convidados.sql`; re-check for a newer one at implementation time)
and append it. Not added to e-mail prefs (no e-mail in v1). CRM:
`store/notifications.ts` union, `lib/notification-config.ts` case
(icon `Paperclip`, text "{cliente} enviou referências em {post}"), and the in-app
preferences list label "Referências do cliente".

## Edge functions

### `hub-post-references` (new, Hub token, deploy `--no-verify-jwt`)

Auth exactly like `hub-ideias`: `resolveHubToken`, bad-token limiter
(`hub-badtoken:{ip}` 30/600s), CORS via `buildCorsHeaders`. Ownership is the post's own
`cliente_id`/`conta_id` against the token (works for avulso posts), as in `hub-approve`.

Rate limits: GET debits `hub-read:{conta}:{cliente}` (300/300s). Every write debits ONLY
`hub-write:hub-post-references:{conta}:{cliente}`, 60 per 3600s (one file = presign +
finalize = 2). Writes do not debit `hub-read` (memory: writes must not debit hub-read).

| Route | Body | Behaviour |
|---|---|---|
| `GET ?token&post_id` | | 404 unless the post is owned and in `HUB_VISIBLE_STATUSES` (share the constant with `hub-approve`). Returns `{ can_add, items: [...] }`; each item `{id, kind, name, mime_type, size_bytes, duration_seconds, width, height, url, thumbnail_url, link_url, link_title, link_domain, note, post_approval_id, created_at, can_remove}`; signed GET URLs 3600s. `can_add` = status gate and count < 10. `can_remove` per decision 2. |
| `POST /upload-url` | `post_id, filename, mime_type, size_bytes, thumbnail?{mime_type,size_bytes}` | Ownership + `enviado_cliente` + best-effort count and quota (authoritative in RPC). MIME allowlist and per-kind size caps. Thumbnail required (webp ≤ 512 KB) for image/video, forbidden for PDF. Returns presigned PUT URLs. |
| `POST /files` | `post_id, r2_key, thumbnail_r2_key?, mime_type, size_bytes, thumbnail_bytes?, name, width?, height?, duration_seconds?, blur_data_url?, note?` | Prefix check `contas/{conta}/files/`, HEAD both objects (size and content-type match, as `finalizeIdeiaImage`), RPC insert, then notification RPC (failure logged, not fatal). Returns the item shape. |
| `POST /links` | `post_id, url, title?, note?` | Normalise: trim, prepend `https://` when no scheme, `new URL()` must parse, `http`/`https` only, no credentials, ≤ 2048 (reuse `_shared/safe-href.ts`). RPC insert, notification. |
| `PATCH /:id` | `note` | Allowed when `can_remove` holds; trims, ≤ 500, empty → NULL. |
| `DELETE /:id` | | Allowed when `can_remove` holds. Single statement with the gate inside the WHERE (status and no-later-team-reply via EXISTS) so a race with the team's reply cannot delete. Returns 409 when the gate fails. |

Known RPC errors map to 404/409/413 with generic client copy; anything else logs and
returns 500 "internal error" (security rule: no raw DB errors to clients).

### `post-references` (new, CRM, JWT)

Same auth shape as `ideia-media-manage` (service-role client + `getUser`, conta from
`profiles`). Every query filters `conta_id`.

- `GET ?post_id` → same item shape (signed URLs), plus `download_url` per file signed with
  `ResponseContentDisposition: attachment; filename="<name>"` (add an optional
  `downloadName` argument to `_shared/r2.ts` `signGetUrl`; RFC 5987 encode the name).
- `DELETE /:id` → team removal. Requires the same permission as editing the post
  (`hasPermissionFor`, the one `post-media-manage` uses for media removal). Frees quota
  through the orphan trigger.

### `hub-approve` (changed)

Accepts optional `reference_ids: number[]` (≤ 10, integers) on `action = 'correcao'`.
After `record_client_approval` returns the approval id, one UPDATE:
`post_references SET post_approval_id = :approval WHERE id = ANY(:ids) AND post_id = :post
AND conta_id = :conta AND cliente_id = :cliente AND post_approval_id IS NULL`.
Failure is logged, not fatal: the correction stands and the references stay post-level.
Ignored for `aprovado`/`mensagem`.

### Unchanged on purpose

`hub-posts` (no count added: the Hub loads references lazily when a post opens, keeping
the first-load path untouched), `hub-post-history` (the Hub joins references to approvals
client-side by `post_approval_id`), `hub-edit-suggestion` (still rejects images; references
are the only client media channel), `post_file_links` and everything reading it.

## Hub UI (`apps/hub`)

**Tab.** `PostDetailDialog` gets a `references` tab, label "Referências" with a count pill
once loaded, ordered Legenda | Texto do post | Referências | Histórico e comentários.
Shown when `can_add` OR the list is non-empty; hidden otherwise (a published post with no
references shows no tab). The list loads when the dialog opens for that post (TanStack
Query, key `['hub-post-references', postId]`, `staleTime` 30s) so the count appears
without visiting the tab.

**List (`PostReferencesPanel`).** Rows per the mockup: 56px thumbnail (image thumb; video
poster with play glyph and duration; PDF tile; link tile), name or link title (link opens
in a new tab via `sanitizeExternalUrl`, `rel="noopener noreferrer"`), domain for links,
note, "Você · {data}" and size. Trash button (`aria-label="Remover referência"`) only when
`can_remove`; removal asks "Remover referência?" in a confirm. Tapping an image or video
opens a simple viewer dialog (image, or `<video controls playsinline preload="metadata">`
from the signed URL); PDFs open in a new tab. When `can_add`: two secondary buttons on md+
("Adicionar arquivo", "Adicionar link"), one "Adicionar referência" on phones that opens
the bottom sheet ("Foto, vídeo ou PDF" / "Link"), and the hint "N de 10 por post. Fotos e
PDFs até 25 MB, vídeos até 200 MB." Read-only state shows "Post publicado. As referências
ficam aqui para consulta." when `postado`, a neutral "As referências ficam aqui para
consulta." otherwise. Empty + `can_add` shows the empty state from the mockup.

**Upload (`services/postReferences.ts`).** Mirrors `services/ideiaMedia.ts`: client-side
validation (type, size), thumbnail generation (images: webp ≤ 512 KB + blur placeholder,
reusing the ideia helpers; video: first-frame webp via the CRM's `utils/videoFrame.ts`
moved to a shared package or duplicated if it has CRM-only deps; when frame capture fails,
e.g. HEVC in Chrome, draw a neutral poster with a play glyph so the
`files_video_requires_thumbnail` CHECK still holds), presign, XHR PUT with progress and
abort, finalize. The whole upload promise is wrapped in `trackUnsavedWork`. Rows show
"Enviando X MB de Y MB. Não feche esta tela." with a progress bar and a cancel button
(abort; the orphan scan reaps half-uploaded keys). After finalize the row expands the note
field "O que mudar com isso? (opcional)" with "Salvar nota". Inputs are 16px on phones.
Several files can be chosen at once (`multiple`); each becomes its own row, uploads run
two at a time.

**Link form.** Bottom sheet (phone) or dialog (md+): "Endereço" (`type="url"`,
`inputmode="url"`, hint "Vamos completar com https:// se faltar."), "Título (opcional)",
"O que a equipe deve ver aqui? (opcional)", submit "Adicionar link".

**Approve while uploading.** "Aprovar" is disabled while any reference upload for the post
is in flight: approval moves the post out of `enviado_cliente` and the finalize would 409.

**Correction composer.** `CorrectionPanel`'s "Solicitar correção" section gains
"Anexar referência" (paperclip) under the comment, opening the same picker. Each file or
link uploads immediately as a normal reference (it shows up in the tab at once) and is
staged in the composer as a chip with "Tirar {nome} da correção" (unstages, does not
delete). "Enviar correção" sends `reference_ids` with the correction. Helper line: "As
referências anexadas também ficam na aba Referências deste post." Staged ids are dropped
if their upload fails or the item is removed.

**History.** `PostHistoryPanel` renders, under a client correction bubble, 72px tiles for
the references whose `post_approval_id` matches, plus "N referências anexadas".

**Errors (inline, `role="alert"`).**
- "O vídeo tem {n} MB e o limite é 200 MB. Envie uma versão menor ou um link." (and the
  25 MB variant for photos and PDFs)
- "Esse tipo de arquivo não é aceito. Envie foto, vídeo ou PDF."
- "Este post já tem 10 referências. Remova uma para adicionar outra."
- "Não foi possível enviar agora: o espaço de arquivos da agência acabou. Avise a equipe."
- "Este post não está mais aguardando sua aprovação." (409 gate)
- "Informe um endereço válido, começando com http ou https."
- Generic: "Algo deu errado. Tente novamente."

All copy pt-BR, sentence case, no em dashes (add a test asserting no "—" in the new
strings). New keys go through the Hub's i18n `t()` like the rest of the dialog.

## CRM UI (`apps/crm`)

**Section (`PostClientReferences`)** rendered by `PostEditorBody` directly after
`PostMediaGallery`, only when the post has references (the team cannot add, so no empty
state). Loads via `post-references` GET when the editor mounts (TanStack Query key
`['post-references', postId]`). Header: paperclip, "Referências do cliente", count Badge,
"Enviadas pelo Hub". Grid of square tiles (4 columns in the drawer, 3 under 900px):
image thumbnail, video poster with play and duration, PDF tile, link tile with domain.
Under each: name (link title linked, `sanitizeUrl`, new tab), note, "Cliente · {data}"
plus size, and a warning Badge "Na correção" when `post_approval_id` is set. Hover/focus
overlay: "Abrir" (viewer dialog for image/video, new tab for PDF/link), "Baixar"
(`download_url`), and a trash "Excluir referência" behind an AlertDialog "Excluir
referência?" (confirm "Excluir"). Works in both hosts (`WorkflowDrawer`,
`StandalonePostDrawer`) since both render `PostEditorBody`. Dark mode via the existing
tokens.

**Comments.** `PostApprovalBubble` shows chips (32px thumb + name) for references with a
matching `post_approval_id`; clicking opens the same viewer. The references list is
passed down from the section's query (single fetch per post).

**Drawer card badge.** `WorkflowDrawer` fetches reference counts for its posts in one
query (`store`: `getPostReferenceCounts(postIds)` selecting `post_id` under RLS, counted
client-side) and shows an info Badge "N referências" with a paperclip on the collapsed
card, next to the existing "Sugestão pendente" badge. Invalidated with the section query.

**Notification.** Central de Notificações renders `post_client_reference` as specified
above; clicking navigates by the existing `link`.

## Security

- Token-scoped writes check the post's own `cliente_id`/`conta_id`; RPCs recheck under
  `FOR UPDATE`. CRM function filters `conta_id` from the caller's profile.
- R2 keys must start with `contas/{conta}/files/`; HEAD-verified size and type at finalize.
- URLs: scheme allowlist, no credentials, length cap server-side; rendered with
  `sanitizeExternalUrl` (Hub) / `sanitizeUrl` (CRM), never `dangerouslySetInnerHTML`.
- No raw DB errors returned. CORS via `buildCorsHeaders`.
- Storage quota charged on finalize; refunded by the existing triggers on delete.
- SVG is not in the allowlist (script risk when opened directly).

## Testing

- **Deno** (`supabase/functions/__tests__/` or alongside, following the repo's layout):
  `hub-post-references` routes (token, ownership, avulso post, status gate, cap, quota,
  MIME/size rejection, thumbnail rules, HEAD mismatch, link normalisation and rejection,
  `can_remove` after a team reply, write limiter key, no `hub-read` debit on writes);
  `post-references` (auth, conta filter, permission on delete, download disposition);
  `hub-approve` with `reference_ids` (links only own, unlinked, same-post ids; ignored for
  other actions; link failure non-fatal). Run `npm run check:functions` too.
- **SQL** (`supabase/tests/entitlements/`, CI-gated): RLS isolation of `post_references`
  across workspaces; anon has no access; RPC gate/cap/quota errors; orphan trigger deletes
  the `files` row and refunds quota; post delete cascades; `stream_status = 'skipped'`
  accepted and excluded from the ingest predicate.
- **Vitest**: Hub tab visibility rules, list states, upload progress/cancel, approve
  disabled during upload, correction staging sends `reference_ids`, error copy; CRM
  section render, "Na correção" badge, bubble chips, drawer badge; no em dash in new copy.
- **Browser**: Hub at :5175 against a seeded post (phone and desktop), CRM editor
  section, light and dark.

## Rollout

Migration and both new functions deploy before merging (merge deploys the frontend):
`db push` (staging, then prod), deploy `hub-post-references` (`--no-verify-jwt`),
`post-references`, `hub-approve`, and redeploy `post-media-cleanup-cron` only if the plan
finds it needs a change for `'skipped'` (the CHECK change alone does not require it).
Add `hub-post-references` to the CLAUDE.md `--no-verify-jwt` list.

## Open risks

- 200 MB single-PUT uploads on weak mobile connections may fail late; the cancel/retry
  UX covers it, resumable uploads are out of scope.
- A reference video's codec may not play in every browser (HEVC `.mov`). The viewer shows
  "Não foi possível reproduzir aqui. Baixe o arquivo." on `error` with the download link.
