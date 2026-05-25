# Client Edit Suggestions

Allow Hub clients to edit post text directly and submit changes as suggestions that the internal team reviews via an inline diff in the CRM workflow drawer.

## Problem

Clients currently cannot edit post text in the Hub. To request a text change, they must comment on the post ("Solicitar correção") and describe what they want changed in words. The internal team then manually interprets and applies those changes. This is slow, error-prone, and frustrating for clients.

## Solution

Make the post text always-editable in the Hub when the post is pending client approval (`enviado_cliente`). Client edits are auto-saved as pending suggestions. In the CRM, the editor switches to a diff mode showing inline strikethrough (removed) and green highlight (added) with accept/reject controls.

## Scope

- Applies only to the new Hub app (`apps/hub`) and Hub edge functions (`hub-posts`, `hub-approve`, new `hub-edit-suggestion`)
- The legacy CRM portal route (`apps/crm/src/pages/portal/PortalPage.tsx`) and `portal-data` / `portal-approve` edge functions are unchanged
- Pending suggestions should be visible to the client after reload: the Hub displays the saved suggested draft while the CRM still reviews against the original snapshot

---

## Hub — Client Editing Experience

### Editable Fields
- **Post body** (`conteudo` / TipTap rich text) — editable TipTap editor when present (no toolbar, text editing only)
- **Instagram caption** (`ig_caption`) — editable text input/textarea in media-card views

### When Editable
- Only when post status is `enviado_cliente` (pending client approval)
- All other statuses: read-only as today
- Read-only Hub contexts (for example historical/calendar views) remain read-only even if the post status is `enviado_cliente`

### UI Behavior
- Post text rendered in TipTap with `editable: true` (no formatting toolbar — client edits text only, preserves existing formatting)
- Dashed border + subtle hint: "Clique no texto para editar"
- Info banner: "Suas edições serão enviadas como sugestão para a equipe revisar"
- **Auto-save**: changes saved after 1.5s debounce via `hub-edit-suggestion` edge function
- Save indicator: green dot + "Sugestão salva" text after successful save
- Instagram caption: same auto-save behavior on the `ig_caption` field
- While an autosave is pending, approval/correction buttons are disabled with a "Salvando sugestão..." state
- Once a pending suggestion exists, the existing approve/correction buttons are replaced by a non-status-changing confirmation state ("Sugestão enviada para revisão"). The post remains `enviado_cliente` until the internal team accepts/rejects the suggestion.
- If the client edits the text back to the original content and caption, the pending suggestion is deleted and the normal approval/correction buttons return

### Edit Replacement
- Only one pending suggestion per post at a time
- New edits replace the previous pending suggestion
- The original content snapshot is always preserved for diffing
- The Hub must save and reload the latest pending suggestion as the draft shown to the client

### Components to Modify
- `apps/hub/src/components/InstagramPostCard.tsx` — editable caption for media feed/reels/carousel posts, autosave suggestion state
- `apps/hub/src/components/StoryPostCard.tsx` — editable caption for story posts, autosave suggestion state
- `apps/hub/src/components/TextPostCard.tsx` — editable body/caption behavior for text-only posts
- `apps/hub/src/components/RichTextContent.tsx` — add `editable`, `onUpdate`, and text-only editing support (currently hardcoded to `false`)
- `apps/hub/src/api.ts` — add `submitEditSuggestion()` function
- `apps/hub/src/types.ts` — add `pending_suggestion` to `HubPost`

### Text-Only Editing Guardrails
- No formatting toolbar in the Hub
- Disable inline image upload/paste in Hub editable mode
- Convert rich pasted HTML to plain text or a safe minimal TipTap document
- Preserve existing marks/nodes where possible, but do not expose controls to create new formatting
- Strip or ignore short-lived signed image URLs before persisting; validate any retained `r2Key` belongs to the token workspace

---

## CRM — Diff Visualization

### Post Card Badge
- When a post has a pending suggestion (`status = 'pending'` in `post_edit_suggestions`), show a "Sugestão pendente" badge on the post card in the workflow view
- Badge style: yellow background (`rgba(234,179,8,0.15)`), yellow text (`#eab308`), uppercase, small

### Workflow Drawer — Diff Mode
When a post has a pending suggestion, the editor area switches to **diff mode**:

- **Header bar**: yellow dot + "Sugestão do cliente" label + timestamp + "Rejeitar" / "Aceitar edição" buttons
- **Editor content**: read-only inline diff view
  - Removed text: red background (`rgba(239,68,68,0.15)`), red text (`#fca5a5`), strikethrough
  - Added text: green background (`rgba(34,197,94,0.15)`), green text (`#86efac`)
  - Unchanged text: normal styling
- **ig_caption diff**: shown separately below the main diff if the caption was also edited
- Editor is **read-only** while in diff mode (team cannot edit while reviewing suggestion)
- The normal content editor and Instagram caption input are hidden/disabled until the suggestion is accepted or rejected

### Diff Algorithm
- Word-level diff computed on `conteudo_plain` (plain text) using `diff-match-patch` library
- TipTap JSON content is stored but diff is rendered from plain text comparison for simplicity
- For `ig_caption`: same word-level plain text diff

### Accept / Reject Actions
- **Accept**: copies the complete suggested body/caption state into `workflow_posts`. Marks suggestion as `accepted`. Post stays in `enviado_cliente`.
- **Reject**: marks suggestion as `rejected`. Post content unchanged. Post stays in `enviado_cliente`.
- After either action, the editor exits diff mode and returns to normal editable state.
- Accept/reject should be implemented as RPCs/edge-safe transactions so the post update and suggestion status update cannot diverge

### Components to Modify
- `apps/crm/src/pages/entregas/components/WorkflowDrawer.tsx` — fetch pending suggestions, pass to PostEditor
- `apps/crm/src/pages/entregas/components/PostEditor.tsx` — add diff mode rendering with accept/reject header
- `apps/crm/src/pages/entregas/components/WorkflowDrawer.tsx` / inline `SortablePostItem` — show "Sugestão pendente" badge
- `apps/crm/src/store/posts.ts` — add functions: `getPostEditSuggestions()`, `acceptEditSuggestion()`, `rejectEditSuggestion()`

### Notifications
- When the first pending suggestion is created for a post, create a CRM notification
- Notification type: `post_edit_suggestion`
- Target users: post `responsavel_id` when present, plus workspace owners/admins (same targeting philosophy as post approval/correction notifications)
- Notification title/body:
  - Title: "Sugestão de edição"
  - Body: "{client_name} sugeriu alterações em {post_title}"
- Link target should open the workflow drawer/post context when possible
- Replacement autosaves on the same pending suggestion should not spam notifications; only the first pending insert creates a notification
- Accept/reject may optionally mark related notifications as read/resolved, but this is not required for v1

---

## Data Model

### New Table: `post_edit_suggestions`

```sql
CREATE TABLE post_edit_suggestions (
  id                      bigserial PRIMARY KEY,
  post_id                 bigint NOT NULL REFERENCES workflow_posts(id) ON DELETE CASCADE,
  conta_id                uuid NOT NULL,
  token                   text NOT NULL,
  -- Original content snapshot (at time of first edit)
  original_conteudo       jsonb,
  original_conteudo_plain text,
  original_ig_caption     text,
  -- Suggested content from client
  suggested_conteudo      jsonb,
  suggested_conteudo_plain text,
  suggested_ig_caption    text,
  changed_fields          text[] NOT NULL DEFAULT '{}',
  -- Status tracking
  status                  text NOT NULL DEFAULT 'pending'
                          CHECK (status IN ('pending', 'accepted', 'rejected')),
  reviewed_by             uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  reviewed_at             timestamptz,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now()
);

-- Only one pending suggestion per post
CREATE UNIQUE INDEX idx_post_edit_suggestions_pending
  ON post_edit_suggestions (post_id) WHERE status = 'pending';

-- RLS: workspace isolation (matches existing pattern)
ALTER TABLE post_edit_suggestions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "workspace_edit_suggestions_all"
  ON post_edit_suggestions FOR ALL
  USING (conta_id IN (SELECT public.get_my_conta_id()))
  WITH CHECK (conta_id IN (SELECT public.get_my_conta_id()));

CREATE POLICY "service_role_edit_suggestions_all"
  ON post_edit_suggestions FOR ALL
  TO service_role USING (true) WITH CHECK (true);
```

### Key Constraints
- Unique partial index ensures only one pending suggestion per post
- Replacement must be done via SQL RPC/transaction, not plain Supabase `.upsert()`, because the uniqueness is a partial index:
  - `INSERT ... ON CONFLICT (post_id) WHERE status = 'pending' DO UPDATE ...`
  - or explicit select/update/insert with unique-conflict retry
- Original content snapshot taken on first suggestion creation (not updated on subsequent edits)
- `suggested_*` fields store the complete suggested state for the post, not just changed fields, so accepting does not wipe unchanged body/caption values
- `changed_fields` is derived server-side from original vs suggested values and used for rendering/deleting no-op suggestions

---

## Edge Functions

### `hub-edit-suggestion` (new)
- **Method**: POST
- **Auth**: Hub client token (`client_hub_tokens`, same token model as `hub-approve` / `hub-posts`)
- **Body**: `{ post_id, suggested_conteudo, suggested_conteudo_plain, suggested_ig_caption }` where fields represent the complete current draft state
- **Behavior**:
  1. Verify Hub client token and post ownership
  2. Verify post status is `enviado_cliente`
  3. Sanitize/validate TipTap JSON:
     - No new inline images from the Hub
     - Any retained inline image `r2Key` must belong to the workspace
     - Do not persist short-lived signed image URLs as authoritative data
  4. Insert/update pending suggestion via SQL RPC/transaction:
     - If no pending suggestion exists: insert with original content snapshot from `workflow_posts`
     - If pending suggestion exists: update `suggested_*` fields and `updated_at`
     - If the suggested state matches the original snapshot: delete or mark the pending suggestion as rejected/no-op
  5. On first pending insert only, create `post_edit_suggestion` notification
  6. Return success plus the saved `pending_suggestion`

### Modified: `hub-posts`
- Include pending edit suggestion (if any) in the response for each post
- Add `pending_suggestion: { id, suggested_conteudo, suggested_conteudo_plain, suggested_ig_caption, changed_fields, updated_at } | null` to post objects
- When `pending_suggestion` exists, Hub UI displays the suggested draft values while preserving original/current post values for future diffing on the server

### Not Modified
- `portal-data`
- `portal-approve`
- legacy `apps/crm/src/pages/portal/PortalPage.tsx`

### CRM Data Functions / RPCs
- `getPostEditSuggestions(postIds)` fetches pending suggestions for workflow drawer posts
- `acceptEditSuggestion(suggestionId)` transaction:
  1. Re-check suggestion is pending
  2. Re-check post still belongs to workspace and is reviewable
  3. Update `workflow_posts` with the complete suggested body/caption state
  4. Mark suggestion `accepted`, set `reviewed_by`, `reviewed_at`
- `rejectEditSuggestion(suggestionId)` transaction marks suggestion `rejected`, set `reviewed_by`, `reviewed_at`
- Team edits to body/caption/status while a pending suggestion exists must auto-reject that pending suggestion before or inside the post update transaction

---

## Libraries

### `diff-match-patch`
- Used in the CRM app for computing word-level diffs
- Install: `npm install diff-match-patch` + `@types/diff-match-patch`
- Usage: compare `original_conteudo_plain` vs `suggested_conteudo_plain`
- Render diff segments as spans with appropriate strikethrough/highlight classes

---

## Verification Plan

1. **Hub editing**: Open Hub portal with a post in `enviado_cliente` → edit text → verify auto-save indicator appears → verify suggestion saved in database
2. **Hub read-only**: Verify posts in other statuses remain read-only
3. **Edit replacement**: Edit text → wait for save → edit again → verify only one pending suggestion exists
4. **CRM badge**: Open CRM workflow view → verify "Sugestão pendente" badge on post with pending suggestion
5. **CRM diff mode**: Open workflow drawer → verify editor shows inline diff with correct strikethrough/highlight
6. **Accept**: Click "Aceitar edição" → verify post content updated → verify editor exits diff mode
7. **Reject**: Click "Rejeitar" → verify post content unchanged → verify editor exits diff mode
8. **ig_caption**: Edit Instagram caption in Hub → verify diff shown separately in CRM
9. **Revert to original**: Client edits text back to match original → pending suggestion should be auto-deleted (no empty diff)
10. **Team edits while pending**: If the team edits the post in the CRM while a pending suggestion exists, the pending suggestion should be auto-rejected (original snapshot is now stale)
11. **Status change while pending**: If the post status changes away from `enviado_cliente` while a suggestion is pending, the suggestion should be auto-rejected on next load
12. **Hub reload**: Client refreshes Hub after autosave → edited draft is still shown from `pending_suggestion`
13. **Notification**: First pending suggestion creates exactly one CRM notification; repeated autosaves replace the suggestion without creating additional notifications
14. **Legacy portal unchanged**: Existing `/portal/:token`, `portal-data`, and `portal-approve` behavior remains unchanged
15. **Approve race**: Client cannot approve/correct while autosave is pending or while a saved suggestion is awaiting internal review
