# Client edit suggestions survive team edits (no more auto-reject)

Status: DRAFT v1 (pending Fable review)
Date: 2026-10-29

## Context

Second incident of the same kind:

- **2026-09-28**, post 6573, suggestion 4429: a team member added blank lines to the caption and
  `trg_auto_reject_pending_suggestion` rejected the client's pending copy suggestion. Restored to
  `pending` by hand. The follow-up spec (`2026-09-28-hub-editar-sugestao-diff-design.md`) listed
  "narrowing the trigger / labelling auto-rejects" as out of scope.
- **2026-10-29**, post 11807 (Reimpulso, Centro Hérnias), suggestion 4719: the client changed only
  the carousel text (`conteudo`, two added sentences) on 2026-10-28 23:33 UTC. On 2026-10-29
  11:56 UTC the team rewrote only the caption (`ig_caption`). The trigger rejected the suggestion
  (`reviewed_by` NULL). The two edits never touched the same field, so nothing was in conflict.
  The client's text was recovered by reading the row in prod.

What is wrong today (verified in code):

1. `trg_auto_reject_pending_suggestion` (`20260521000001:271-303`, never redefined) rejects the
   pending suggestion on ANY change to `conteudo`, `ig_caption` or `status`, regardless of which
   field the suggestion changed.
2. It records the result as `status = 'rejected'`, the same value as a deliberate team rejection.
3. The Hub then tells the client "Sua sugestão anterior foi rejeitada pela equipe"
   (`hubPosts.json shared.rejectedSuggestionWarning`, shown via `post.suggestion_rejected_at`
   from `hub-posts/handler.ts:399-407,486-489` and `useEditSuggestion.ts:360`). For an
   auto-reject that sentence is false.
4. The CRM gives no warning before a save discards a pending suggestion, and after it the CRM
   reads only `status = 'pending'` rows (`store/posts.ts:1528-1539`), so the client's text is
   invisible to the team.
5. Even with no trigger, `accept_edit_suggestion` (`20260928150001` §3d) writes
   `ig_caption = suggested_ig_caption` unconditionally and `conteudo` via COALESCE. The
   suggestion row is a full snapshot, so accepting a content-only suggestion after a team caption
   edit would revert the team's caption. This is why the trigger existed.

## Goals

- A team edit never silently discards a client suggestion.
- Edits to different fields combine: the team's caption edit and the client's carousel-text
  suggestion both survive, and accepting applies only what the client changed.
- When the team and the client changed the same field, the team sees it and decides.
- "Rejeitada" in the Hub and the CRM means a person rejected it.

## Non-goals

- Merging two edits inside the same field (character-level three-way merge). Same-field overlap
  is surfaced, not merged.
- TikTok / other destination captions: suggestions cover `conteudo` and `ig_caption` only, as today.
- Showing the client, in the Hub, that the team also edited a field they suggested on.
- Notifying the client when the team accepts or rejects.

## Anti-goals

- Accept overwriting a team edit the reviewer did not see.
- A team member being blocked from editing a post because a suggestion is pending (beyond what
  the CRM already does: the carousel-text editor is replaced by the review card while a
  suggestion is pending, `PostEditorBody.tsx:1564`).

## Design

### Fields

Two logical fields: **texto** (`conteudo` jsonb + `conteudo_plain`, always together) and
**legenda** (`ig_caption`). `changed_fields` keeps its current values (`conteudo`,
`conteudo_plain`, `ig_caption`) for compatibility; every rule below reads "texto changed" as
`changed_fields && '{conteudo,conteudo_plain}'`.

Equality for texto uses `conteudo_plain` (TipTap round-trips can change the jsonb bytes with
identical text; see the 2026-09-28 spec's diff guard). Equality for legenda uses
`COALESCE(x, '')`.

### 1. `original_*` becomes a per-field base, and changes are measured against it

Today `original_*` is a snapshot taken on the first save and never updated, and `changed_fields`
is recomputed against the LIVE post on every save. New rules, in `upsert_edit_suggestion`
(which already locks the post, `20260928150001` §3a):

- For each field the save **touched** (see §2):
  - If the field is not currently in `changed_fields` (or the row is new), first re-base it:
    `original_X := live X`. The client is starting a change on top of whatever is live now.
  - Then the field is changed iff `suggested X <> original X`.
- For each field the save **did not touch**:
  - If it is in `changed_fields`, keep the stored `suggested_X` and `original_X`.
  - Otherwise set `original_X := live X` and `suggested_X := live X` (keeps the snapshot current
    so the Hub seeds from live, §8).
- A field that ends the save **not changed** (touched and equal to its base, or untouched and not
  in `changed_fields`) is re-based on the spot: `original_X := suggested_X := live X`, even when
  the row stays pending for the other field. Otherwise a field the client reverted after a team
  edit would keep a stale `suggested_X`, the Hub would seed from it (§8) and a later save would
  bring the team's old text back as a client change.
- If no field is changed, delete the pending row (`action: 'deleted'`), as today.
- These rules apply only when the save carries `touched_fields` (§2). A legacy save (no
  `touched_fields`) runs today's upsert unchanged (§2).

Invariant this gives: for every field in `changed_fields`, `original_X` is the text the client
started from. **Conflict** on a field = field in `changed_fields` AND live X differs from
`original_X` (the team or another writer changed it after the client did).

### 2. The Hub says which fields the client touched

Today the Hub sends a full snapshot (`api.ts:186-197`). A client whose panel was open before a
team caption edit would send the old caption back, and §1 would record it as a client change that
reverts the team's edit.

- `submitEditSuggestion` and `hub-edit-suggestion` gain `touched_fields: ('texto' | 'legenda')[]`:
  the fields the client actually edited in the panel since it was opened (dirty tracking in
  `useEditSuggestion`, per field, cleared on successful save only for what that save carried).
- `upsert_edit_suggestion` gains `p_touched_fields text[] DEFAULT NULL`.
- **Legacy saves (NULL) keep today's semantics exactly**: `changed_fields` against live, and
  `original_*` never re-based on an existing row. This covers the deployed function during the
  deploy window and Hub tabs left open across the deploy, which keep sending full snapshots.
  Those saves cannot be told apart from a real edit, so they are not trusted as field intent; the
  safety net is accept (§5): a stale tab that sends the old caption back after a team edit gets
  `ig_caption` into `changed_fields` with `original_ig_caption` (first-save snapshot) different
  from live, which is a conflict, so the team is asked and nothing is overwritten silently. The
  cost is an occasional false conflict prompt on legacy rows, never a lost edit. (Codex review,
  2026-10-29: treating NULL as "all fields touched" with re-basing would have recorded the stale
  caption as a fresh, conflict-free client change.)
- Signature change means DROP + CREATE and restating grants (service_role only), plus updating
  the pin in `supabase/tests/entitlements/96_lockdown_definer_function_grants.sql:51`.

### 3. The trigger stops rejecting

Replace `trg_auto_reject_pending_suggestion`:

- Content or caption changes: **do nothing.** Conflicts are detected at read time (§1 invariant).
- Status changes: do nothing, **except** when the post becomes `postado` (published): the pending
  suggestion is closed with the new status `superseded`, `reviewed_at = now()`,
  `reviewed_by = NULL`. Publication is the one point where the suggestion can no longer change
  what goes out.
- Keep the `app.accepting_edit_suggestion` bypass.
- Rename to `trg_close_suggestion_on_publish` (drop the old trigger and function).

Consequences to keep in mind:

- A team move from `enviado_cliente` back to production, to `aprovado_cliente` or to `agendado`
  leaves the suggestion pending. It stays visible on the CRM review card in any status.
- `upsert_edit_suggestion` still requires `enviado_cliente`, so the client can only edit a
  suggestion while the post is with them.
- `record_client_approval` keeps refusing a client approval/correction while a suggestion is
  pending (`20260928150001` §3b). Its comment about the trigger becomes stale and is updated.

### 4. Status value `superseded`

- `post_edit_suggestions.status` CHECK gains `'superseded'`.
- **Backfill:** `UPDATE ... SET status = 'superseded' WHERE status = 'rejected' AND reviewed_by
  IS NULL`. Team rejections set `reviewed_by = auth.uid()` (`20260525000001:40,77`); NULL means
  the trigger did it, or the reviewer's auth user was deleted (`ON DELETE SET NULL`). The second
  case is rare and the label "não revisada" is acceptable for it.
- `hub-posts` keeps filtering `status = 'rejected'` for the warning, so the false "rejeitada pela
  equipe" disappears for every past auto-reject.
- Mensagens: CRM label `messages:events.suggestion.superseded` = "Sugestão de edição não
  revisada" (pt) / "Edit suggestion not reviewed" (en), and `superseded` added to the
  `SUGGESTION_ACTIONS` allowlist (`mensagensLogic.ts:57`): unlisted values deliberately resolve
  to `generic`, so the key alone would never show. Test the rendered label. The Hub's Mensagens
  row already ignores status (`MensagensPage.tsx:44`).

### 5. Accept applies only changed fields and asks about conflicts

`accept_edit_suggestion(p_suggestion_id, p_expected_updated_at, p_fields text[] DEFAULT NULL)`:

- **Workspace check first.** Today both `accept_edit_suggestion` (`20260928150001` §3d) and
  `reject_edit_suggestion` (`20260525000001:55-80`) are SECURITY DEFINER, granted to
  `authenticated`, and look the row up by id alone: any signed-in user of any workspace can
  accept or reject another workspace's suggestion (ids are a sequential bigserial). Both must
  raise `Suggestion not found` unless the caller belongs to the suggestion's `conta_id`, using the
  same predicate as the table's RLS policy (`conta_id IN (SELECT get_my_conta_id())`,
  `20260521000001:63-69`). This is a live prod issue and ships first as its own hotfix
  migration, ahead of the rest of this spec; this spec's accept keeps the check.
- Locks post then suggestion (order from `20260928150001` §3d), keeps the `suggestion_changed`
  check on `updated_at`.
- Computes changed logical fields from `changed_fields`, and conflicts per §1.
- `p_fields` NULL = all changed fields **if there is no conflict**; if there is any conflict and
  `p_fields` is NULL, raise `suggestion_conflict` (P0001). The CRM always passes `p_fields`
  explicitly; NULL exists only so a stale CRM tab cannot overwrite a team edit.
- Applies only the fields in `p_fields ∩ changed`. A field not applied keeps the live value.
  An empty intersection raises `no_fields`.
- Marks the suggestion `accepted` (partial accepts are still `accepted`; the content-version row
  from `post_content_versions` records what was applied).
- DROP + CREATE, restate grants (`authenticated`, `service_role`; revoke `public`, `anon`),
  update `95_post_content_versions_coalescing.sql` if the call shape changes.

`reject_edit_suggestion` changes only by the workspace check above (in the hotfix).

### 6. CRM review card

`getPostEditSuggestions` also selects `original_conteudo`, `original_conteudo_plain`,
`original_ig_caption`. A pure helper computes per logical field: `changed`, `conflict`.

Review card (`PostEditorBody.tsx:1564-1620`, phone `PhoneSuggestionSheet`):

- Non-conflict field: as today (diff live → suggested; live = original here).
- Conflict field: amber line "A equipe editou {o texto | a legenda} depois desta sugestão." The
  diff shows what accepting would do (live → suggested), with a toggle "Ver só o que o cliente
  mudou" (original → suggested).
- **Aceitar** with no conflict: one call, `p_fields` = all changed. With conflicts: a confirm
  dialog listing each conflicting field with two choices, "Usar a versão do cliente" / "Manter a
  versão da equipe" (default: keep the team's); non-conflict fields are applied automatically.
  If the resulting set of fields to apply is empty, the confirm button is disabled; the user
  closes the dialog or rejects explicitly.
- Error handling: `suggestion_conflict` (the stale-tab case) refetches suggestions and the post,
  and toasts "O post mudou desde que você abriu. Revise a sugestão de novo."

### 7. CRM warnings before a team edit

- Caption field (`InstagramCaptionField`): when the pending suggestion changed legenda, an inline
  note above the field: "O cliente sugeriu uma nova legenda. Revise a sugestão antes de editar."
  Not blocking.
- **Every** manual CRM status move into `agendado` or `postado` while a suggestion is pending
  asks first: dialog "Mover para {Agendado | Postado}?", body "Há uma sugestão do cliente não
  revisada neste post.", buttons "Cancelar" / "Mover mesmo assim". One shared guarded action,
  so the same move behaves the same on every screen. Known surfaces today: `WorkflowDrawer`,
  `StandalonePostDrawer`, the Entregas Kanban, and `cliente-detalhe/tabs/EntregasTab.tsx:412`,
  which calls `updateWorkflowPost(postId, { status: newStatus })` directly; the builder greps
  every `updateWorkflowPost` / status write in `apps/crm/src` and routes the manual ones through
  the guard. MCP, the publisher and automations are not prompted.

### 8. Hub

- Seeding: a field not in `changed_fields` seeds from live (§1 keeps `suggested_X` equal to live
  for those anyway, so `useEditSuggestion.ts:173-186` keeps working; verify the caption path
  through `suggestionAwareCaption`).
- Dirty tracking + `touched_fields` (§2).
- No new copy. The "rejeitada pela equipe" warning now only follows a real rejection.

## Deploy order

0. Hotfix, separate PR, first: workspace check in `accept_edit_suggestion` and
   `reject_edit_suggestion` (§5), signatures unchanged.
1. Migration (new trigger, CHECK, backfill, new RPC signatures with defaults). The deployed Hub
   (no `touched_fields`) and CRM (two-argument accept) keep working: `p_touched_fields` NULL =
   today's upsert (§2), `p_fields` NULL = all changed fields unless there is a conflict, in which
   case the old CRM gets its generic accept error instead of overwriting a team edit.
2. `hub-edit-suggestion` (passes `touched_fields` through when present).
3. Merge (CRM + Hub deploy).

Rollback: frontend first, then the function. The migration does not need to be rolled back; if it
were, restore the old trigger before the old CRM accept is relied on again (otherwise accept can
revert a team caption edit, anti-goal).

## One-time recovery of past auto-rejects (decision for the user)

Option: in the same migration, re-open auto-rejected suggestions where the post is still
`enviado_cliente`, the row is the newest suggestion of that post and no pending row exists
(e.g. 4719). Recommended: **no**. The team may already have acted on them out of band (as in
11807), a re-open would put a stale suggestion back in front of the client in the Hub, and the
backfill to `superseded` already removes the false message. If wanted later, a CRM "Ver sugestão
não revisada" view is a separate small feature.

## Tests

- SQL (entitlements suite): upsert per-field rebase and touched/untouched rules; conflict
  detection; trigger no-op on content/caption/status, `superseded` on `postado`; accept partial,
  `suggestion_conflict`, `no_fields`, grant pins; backfill only touches `reviewed_by IS NULL`.
- Deno: `hub-edit-suggestion` forwards `touched_fields` and validates values.
- Vitest: conflict helper; review card conflict line and dialog; accept passes `p_fields`;
  Hub dirty tracking sends only touched fields; Mensagens `superseded` label.
- Regression for 11807's shape: content-only suggestion, then team caption edit, then accept:
  the post has the team's caption and the client's text.
