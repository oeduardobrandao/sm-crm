# Client edit suggestions survive team edits (no more auto-reject)

Status: APPROVED v3 (Codex + Fable reviews folded in; owner decisions below)
Date: 2026-10-29
Mockups: https://claude.ai/artifact/MEBmjJBNoriqTfTu9bDqyo

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

Equality, per field (Fable review: plain text alone loses formatting-only edits and misses team
image edits):

- texto **changed** (client side) = `COALESCE(plain,'')` differs OR `conteudo` jsonb differs,
  compared as `jsonb IS DISTINCT FROM` (not `::text`, so key order does not count). This keeps the
  2026-09-28 behavior where a formatting-only or image-only client edit is still a suggestion
  (`CorrectionPanel.tsx:300-309`).
- texto **conflict** (team side, §1) = `COALESCE(plain,'')` differs OR the set of inline-image
  keys differs (`extractR2Keys` semantics). Formatting-only drift on the team side is not a
  conflict, because TipTap round-trips rewrite jsonb bytes; an added or removed image is.
- legenda: `COALESCE(x, '')` for both.

### 1. `original_*` becomes a per-field base, and changes are measured against it

Today `original_*` is a snapshot taken on the first save and never updated, and `changed_fields`
is recomputed against the LIVE post on every save. New rules, in `upsert_edit_suggestion`
(which already locks the post, `20260928150001` §3a):

- For each field the save **touched** (see §2):
  - If the field is not currently in `changed_fields` (or the row is new), first re-base it to
    **the base the Hub sent for that field** (`p_bases`, §2): `original_X := base X`. Not live:
    the client edited starting from what the Hub fetched, and a team edit between that fetch and
    this save must surface as a conflict (base ≠ live), not be absorbed into the base. (Fable
    review, blocker: re-basing to live at save time let a stale panel's caption overwrite the
    team's caption with no conflict.)
  - Then the field is changed iff `suggested X` differs from `original X` (Fields, above).
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
- Per touched field, the Hub also sends the **raw base** it seeded that field from, as fetched:
  `post.conteudo` + `post.conteudo_plain` for texto and `post.ig_caption` for legenda (never the
  `deriveCaption` display value: on media posts with `ig_caption` NULL that is text derived from
  the LEGENDA block, `postView.ts`, and storing it as the base would make every such caption look
  changed). When the field was seeded from the suggestion itself (already in `changed_fields`),
  no base is needed and the RPC keeps the stored one.
- `upsert_edit_suggestion` gains `p_touched_fields text[] DEFAULT NULL` and
  `p_bases jsonb DEFAULT NULL` (`{"conteudo": …, "conteudo_plain": …, "ig_caption": …}`; a
  touched field not yet in `changed_fields` without a base raises `base_required`).
- `hub-edit-suggestion` runs its new-inline-image check (`hasNewInlineImages(sanitizedConteudo,
  post.conteudo)`) only when texto is touched. Today it compares against live, so after the team
  removes an image a legenda-only save carrying the untouched texto would 400 "Não é permitido
  adicionar imagens".
- `apps/hub/src/components/PostCard.tsx:419` is a second `saveSuggestion` caller: confirm it is
  dead or give it the same `touched_fields` / bases.
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
- Rename to `trg_close_suggestion_on_publish` (drop the old trigger and function), and make it
  **`AFTER UPDATE OF status, custom_status_id`**, testing `NEW.status = 'postado' AND
  OLD.status IS DISTINCT FROM 'postado'`. A BEFORE trigger with that name fires before
  `workflow_posts_z1_reconcile_custom_status` (`20260805000001_post_status_definitions.sql:205-211`,
  name-ordered), which is what turns a CRM move to a custom status (the CRM sends only
  `custom_status_id`, `useUpdatePostStatus.ts`) into `status := behaves_as`; a BEFORE trigger
  would never see a custom status that behaves as `postado`.
- Multi-destination posts: Instagram can be published while the post stays `agendado` /
  `falha_publicacao` until the TikTok leg lands (`tiktok-publish/handler.ts:269`), so a
  suggestion can stay pending after part of the text is out. Accepted: the team still sees it.

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
- Applying texto keeps today's `COALESCE(suggested_conteudo, conteudo)`: rows with a NULL
  jsonb exist (test 95.5 inserts one, `95_post_content_versions_coalescing.sql:222-227`).
- Marks the suggestion `accepted` (partial accepts are still `accepted`; the content-version row
  from `post_content_versions` records what was applied).
- `original_*` now means "per-field base", not "first-submission snapshot". The baseline backfill
  in `20260923000004_post_content_versions_baseline.sql:17-19,158` relied on the old meaning; it
  was a one-time backfill, so nothing breaks at runtime, but its comment is updated.
- DROP + CREATE, restate grants (`authenticated`, `service_role`; revoke `public`, `anon`),
  update `95_post_content_versions_coalescing.sql` if the call shape changes.

`reject_edit_suggestion` changes only by the workspace check above (in the hotfix).

### 6. CRM review card

`getPostEditSuggestions` also selects `original_conteudo`, `original_conteudo_plain`,
`original_ig_caption`. A pure helper computes per logical field: `changed`, `conflict`.

Review card (`PostEditorBody.tsx:1564-1620`, phone `PhoneSuggestionSheet`):

- Non-conflict field: as today (diff live → suggested; live = original here).
- When the team changed a field the client did NOT change since the suggestion was sent, a quiet
  footer line says what accept will and will not touch, e.g. "Aceitar aplica só o texto do post.
  A legenda que a equipe editou em 29 out fica como está." (needs the field's last team edit
  time: the builder may read it from `post_content_versions` or drop the date).
- Conflict field: amber line "A equipe editou {o texto | a legenda} depois desta sugestão." The
  diff shows what accepting would do (live → suggested), with a toggle "Ver só o que o cliente
  mudou" (original → suggested).
- **Aceitar** with no conflict: one call, `p_fields` = all changed. With conflicts the button
  reads "Aceitar…" and opens a dialog "Aceitar a sugestão?" listing each conflicting field with
  two choices, "Manter a versão da equipe" (default) / "Usar a versão do cliente"; non-conflict
  fields are listed as applied. Buttons "Cancelar" / "Aceitar sugestão".
  If the resulting set of fields to apply is empty, the confirm button is disabled; the user
  closes the dialog or rejects explicitly.
- Error handling: `suggestion_conflict` (the stale-tab case) refetches suggestions and the post,
  and toasts "O post mudou desde que você abriu. Revise a sugestão de novo."
- **Mentions after a partial accept.** `WorkflowDrawer.tsx:960-969` and
  `StandalonePostDrawer.tsx:528-561` re-sync mentions from `suggested_conteudo` whenever
  `changed_fields` has `conteudo`. Sync only when texto is in the applied `p_fields`; otherwise
  keeping the team's texto would wipe its live mentions.
- `PostEditSuggestion.status` union (`store/posts.ts:1525`) gains `'superseded'`.

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
- The same guard covers manual moves into `aprovado_cliente` (from there the approval-exit
  automation can schedule, `20261023000002:187-194`). The bulk "aprovar todos"
  (`advance_workflow_from_approval`, `20261023000001:148-150`) does not prompt per post; its
  confirm dialog adds a line with the count when any post in the batch has a pending suggestion:
  "{n} post(s) com sugestão do cliente não revisada." (my call; see owner questions).
- **i18n:** every new CRM string in this spec (conflict line, footer line, accept dialog, "Ver só
  o que o cliente mudou", caption note, status confirm, bulk count, the `superseded` Mensagens
  label in `packages/i18n/locales/{pt,en}/messages.json:35-40`) ships in pt and en.

### 8. Hub

- **Seeding is gated on `changed_fields`.** Today `useEditSuggestion.ts:172-186` and
  `suggestionAwareCaption` (`postView.ts:178-184`) seed from `suggested_X` whenever it is
  non-null. §1 keeps `suggested_X` equal to live only as of the client's last save, so after a
  later team edit the client would keep seeing the old text. A field not in `changed_fields` seeds
  from the live post (`post.conteudo` / `post.ig_caption`, through `deriveCaption` for display);
  only a field in `changed_fields` seeds from `suggested_X`. The base sent on first touch (§2)
  closes the remaining window between fetch and save.
- Dirty tracking + `touched_fields` + bases (§2).
- Until the new Hub ships, the LEGENDA phantom stays: `CorrectionPanel.tsx:306-309` sends
  `stagedCaption`, seeded from `deriveCaption`, so on media posts with `ig_caption` NULL an
  untouched caption is recorded as an `ig_caption` change on the legacy path. It shows as a
  caption change on the CRM card, as today; §2's raw base fixes it.
- `hub-approve/handler.ts:251-256`: comment cites the auto-reject trigger; update it (the
  `pending_suggestion` guard itself survives, called through `record_client_approval_with_notes`,
  `20261026000002:246`).
- No new copy. The "rejeitada pela equipe" warning now only follows a real rejection.

## Deploy order

0. Hotfix, separate PR, first: workspace check in `accept_edit_suggestion` and
   `reject_edit_suggestion` (§5), signatures unchanged.
1. Migration (new trigger, CHECK, backfill, new RPC signatures with defaults). The deployed Hub
   (no `touched_fields`) and CRM (two-argument accept) keep working: `p_touched_fields` NULL =
   today's upsert (§2), `p_fields` NULL = all changed fields unless there is a conflict, in which
   case the old CRM gets its generic accept error instead of overwriting a team edit.
2. `hub-edit-suggestion` (passes `touched_fields` and `bases` through when present).
3. Merge (CRM + Hub deploy).

During the window the old CRM gets `suggestion_conflict` on its generic accept toast
(`WorkflowDrawer.tsx:988-993` only matches `suggestion_changed`). Accepted. Both RPCs stay
resolvable by name from their old callers (6 named args → 8 with defaults; 2 → 3). No migration
here uses `NOTIFY pgrst`; DROP + CREATE relies on the schema reload the push does, so check both
old call shapes on staging before deploying the function.

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
- Regression for the stale-panel case (Fable blocker): text-only suggestion pending, team edits
  caption, client edits caption from a base fetched before the team edit: accept reports a
  caption conflict.
- Trigger: a move to a custom status whose `behaves_as` is `postado` supersedes.
- Tests that change with this spec: `apps/crm/src/__tests__/store.editSuggestions.test.ts:87,99`
  (payload gains `p_fields`), `apps/hub/src/__tests__/api.test.ts:261` (body gains
  `touched_fields` / `bases`), `CorrectionPanel.test.tsx:162,293,435,592,609` (`saveSuggestion`
  arity), `useEditSuggestion.test.tsx`, `PostEditorBody.phone.test.tsx`, the
  `WorkflowDrawer*.test.tsx` suites (card markup), `mensagensLogic*.test.ts`, and the
  `96_lockdown_definer_function_grants.sql:51` pin. There is no Deno test for
  `hub-edit-suggestion` yet; add one.

## Considered and not chosen

Fable's simpler alternative: keep `touched_fields` and "accept applies only changed fields", drop
the per-field bases, read-time conflicts and the partial-accept dialog, and narrow the trigger to
supersede only when the team changes a field that IS in `changed_fields`. It fixes both incidents
(different-field cases) with less surface. Not chosen because a same-field clash would still
close the client's suggestion without a person deciding, which is the behavior the owner called
wrong on 2026-10-29. If the owner prefers less surface over that, this is the fallback design.

## Owner decisions (2026-10-29)

1. Same-field clash: **the team chooses per field in the CRM** (decided by the owner).
2. Manual `aprovado_cliente` moves and the bulk approve: guarded as in §7 (recommendation, not
   contested).
3. Re-open past auto-rejects such as 4719: **no** (recommendation, not contested).

## Known, out of scope

- The Hub "rejeitada" warning picks the newest `rejected` row with no time bound
  (`hub-posts/handler.ts:486-489,577`), so a months-old real rejection still shows when the post
  is re-sent. Pre-existing.
