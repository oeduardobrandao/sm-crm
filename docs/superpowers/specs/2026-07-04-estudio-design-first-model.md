# Estúdio — design-first model + image-to-editable

**Status: APPROVED 2026-07-04** (decisions confirmed by Eduardo). Amends
`2026-07-04-openpencil-estudio-design.md`: everything about the editor fork, the blob
contract mechanics, the render service and the publish gate stands; what changes is
**ownership** — designs stop being a property of a post and become first-class.

## Motivation

Slices 1–4 kept v1's assumption that a design belongs to a post. That surfaced as broken
UX: post lifecycle (status, media kind) gated *opening the editor* (403 behind a spinner),
you couldn't create a design without a post, and attaching was implicit. The end goal also
demands design-first: AI-created designs and raw-image imports don't start from a post.

## Decisions (locked)

1. **Designs are first-class, workspace-owned; `cliente_id` optional.** Brand kit panels
   activate when a client is set. Attaching to a post fills the client automatically.
2. **Locked post (non-editable status) + attached design → read-only.** The editor opens
   in view-only mode with a banner and a "Duplicar" CTA. What the client approved never
   silently diverges.
3. **A design attaches to at most ONE post (1:1 while attached).** "Duplicar" clones for
   reuse — same mental model as workflow templates.
4. **Image→editable entry point: post media.** A raw image uploaded on a post gets a
   "Tornar editável no Estúdio" action. (Arquivos/home entry points can come later.)

## Data model

- New `designs` table: `id, conta_id, cliente_id NULL, post_id NULL UNIQUE, name,
  rev, doc_r2_key, doc_hash, doc_bytes, editor_version, render_status, is_stale,
  render_error, render_manifest, updated_by, created_at, updated_at`.
  `post_id` nullable+unique = attachment (1:1 when attached). Replaces `post_designs`
  (rows are test data, ships dark — wipe and reshape freely).
- R2 keys decouple from posts: `designs/{conta}/{design_id}-r{rev}.fig`; render keys
  `contas/{conta}/designs/{design_id}/{rev}/{frame_id}.jpg` (unchanged scheme).

## Endpoints (post-design-manage → design-manage)

- **Creation becomes explicit** (no more mint-on-GET): `POST /designs
  {format: feed|carrossel|reel_cover|livre, cliente_id?, post_id?}` → starter template →
  201 {design_id}. GET /blob?design_id= is a plain fetch (404 if absent).
- `PUT /blob?design_id=` — same rev contract; **403 read_only** when attached post is
  locked.
- `POST /designs/:id/attach {post_id}` — ALL eligibility checks live here with coded
  errors (`post_not_editable`, `post_has_video`, `post_tipo_unsupported`,
  `post_already_designed`); sets cliente from post; fires render application.
- `POST /designs/:id/detach`, `POST /designs/:id/duplicate`, `DELETE /designs/:id`.
- Feature gate (`feature_estudio`) unchanged, enforced on everything.

## Render semantics

- Save → render, always (gallery thumbnails + parity), pipeline unchanged.
- **Media application only when attached AND post editable**: finalize replaces post
  media links (origin='design') + tipo-sync, exactly as today. Unattached: finalize
  stores the manifest only. Publish gate untouched (attached designs must be fresh).

## Editor shell + fork

- Shell URL param becomes `design_id`; docUrl `.../design-manage/blob?design_id=`.
- **Fork grows `readOnly=1` embed param**: tools/autosave disabled, `save` bridge message
  ignored. Shell shows read-only banner + "Duplicar".

## Estúdio home (`/estudio`)

Real page instead of a signpost: design gallery (render thumbnails, client filter),
**"Novo design"** (format picker), per-card actions (abrir, duplicar, **aplicar a um
post**, excluir). The apply modal walks client → workflow → post; invalid targets are
listed disabled WITH the reason — eligibility becomes visible, not a 403.

Drawer keeps "Abrir no Estúdio" as a shortcut: no design → create pre-attached (editable
posts only, button hidden otherwise as today); design exists → open; locked post with
design → "Ver no Estúdio" (read-only).

## Image → editable design (north star)

Pipeline, all pieces already in the stack:

1. **Vision pass** (OpenRouter): extract text blocks — content, bbox, size, weight,
   color, alignment.
2. **Background reconstruction** (OpenRouter image-edit, same provider as generate-image):
   "remove all text" → clean background. Consumes 1 unit of the AI-image quota; gated
   behind `feature_ai_images` + `feature_estudio`.
3. **Headless composition** in the Vercel doc service (fresh scene graph: background
   image fill + text layers → write .fig — fresh-graph building is the proven-safe
   headless path). The same service grows the MCP mutation endpoint; three roadmap items
   converge there.

Import creates the design **attached but stale**: post media is NOT replaced until the
user's first save in the editor — the user confirms fidelity before the design takes
over the post.

## MCP (rewritten against this model)

`create_design` (format/template, optional cliente/post), `get_design`, `update_design`
(ops via doc service), `preview_design`, `attach_design`, `list_designs`,
`get_design_capabilities`; `import_image_as_design` after slice C. Scopes unchanged
(designs:read/write, images:generate).

## Reshaped roadmap

- **A — design-first core**: migration + design-manage + shell/drawer rewire (parity with
  today, minus eligibility-at-open), then Estúdio home (gallery, novo, aplicar/detach/
  duplicar) + fork read-only mode.
- **B — MCP rewrite** on the new model (doc-service mutation endpoint solves the
  .fig write-after-read gotcha).
- **C — image→editable** (vision + inpaint + compose + drawer entry point).
- **D — cutover** (unchanged: drop legacy, wire prod editor origin + ALLOWED_ORIGINS).
