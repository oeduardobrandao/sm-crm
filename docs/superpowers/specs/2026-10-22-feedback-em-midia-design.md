# Feedback em mídia: comentários presos a slide, momento e ponto

Date: 2026-10-22 · Status: design, awaiting approval
Mockups: [Feedback em mídia](https://claude.ai/artifact/WeRBm4DBgqmKgUV9kSd3zb) (private canvas; four
artboards: Hub carrossel, Hub vídeo, Hub celular, CRM conversa)

## Why

For text, a client can rewrite the copy (edit suggestion with diff) or comment on it. For media
they can't point at anything. A correction is one free-text comment for the whole post plus a
reason chip (`Mídia`), so clients write "muda a terceira foto" or "na parte em que eu falo...",
or they give up and take the conversation to WhatsApp. The agency then has to work out which
slide or second the client meant, and WhatsApp feedback never makes it back into the post's
history.

Success: a client points at exactly what they mean (a slide, a moment of a video, a spot on
either) without leaving the Hub, and the agency never has to guess.

## Goals

1. In the Hub, a client can leave a **note** pinned to:
   - a slide of a carousel (a single image counts as a one-slide carousel), optionally at a
     **spot** on it;
   - a **moment** of a video, optionally at a spot on that frame.
2. Each note is its own small thread: the agency replies, the client can reply back, and the
   agency resolves it **individually**.
3. The post's main conversation (CRM drawer, Hub history) still shows every note in order,
   with its open/resolved state, so the whole story reads in one place.
4. The agency team can leave the same kind of pinned notes **internally** (team only, never
   shown in the Hub).
5. Notes survive media versions honestly: a note made on a file the agency later replaced
   says it is about an earlier version.

## Non-goals

- Drawing boxes, arrows or freehand marks. A spot is one point.
- Notes on text or caption (text already has edit suggestions and the team's internal text
  threads; this feature does not change them).
- Changing what `Aprovar` / `Pedir correção` do to the post status.
- Blocking auto-publish because notes are open.

## Anti-goals (would count as failure even if it works)

- An internal team note, or anything from it, reaching the client: Hub UI, Hub API payload,
  client e-mail, client notification.
- A pin that lands somewhere else on another screen size, or on a different file than the one
  the client looked at.
- A note silently disappearing when the agency swaps or reorders media.
- The client approving over their own open notes by accident.

## Decided behaviour (from the conversation)

**Anchors.**
- Slide (image) note: which file, optional spot `(x, y)`.
- Video note: which file, moment `t` (seconds), optional spot `(x, y)` on that frame.
- A spot is stored **relative to the media's displayed box** (fractions 0..1 of width and
  height), never pixels, so it lands in the same place on phone, desktop and CRM.
- Pins are a single point. Numbered per slide ("Slide 3 · ponto 1").
- On video, a spot pin shows only while playback is within about a second of its moment
  (exact window: builder's call), and when the viewer jumps to the note.
- A note may also be about the whole slide / that moment with no spot.

**Hub, client side** (mockups: Hub carrossel, Hub vídeo, Hub celular).
- Carousel: tap anywhere on the slide drops a pin and opens the composer ("Comentário no ponto
  marcado do slide 3"); a "Comentar o slide inteiro" button covers the no-spot case.
  Thumbnails show a count of open notes per slide.
- Video: tapping the frame pauses and drops a pin at the current moment; "Comentar em 0:42"
  covers the no-spot case. Notes appear as markers on the timeline; tapping a note seeks.
- Phone: a "Comentar" button floats on the media and the composer is a bottom sheet. Inputs are
  16px (iOS zoom rule).
- A side list ("Comentários na mídia") shows each note with its anchor label, status pill
  (`Em aberto` / `Resolvido`) and replies. Tapping the anchor label jumps to the slide/moment.
- The client can reply to a note. **A client reply on a resolved note reopens it.**
- Only the agency resolves.

**Delivery and approval.**
- Each note is sent on its own and the agency is notified **immediately**, like a client
  message today. A note does not change the post's status.
- `Pedir correção` works as today and moves the post to correção. The correction entry carries
  a snapshot of the notes open at that moment ("2 comentários em aberto: slides 3, 4").
- `Aprovar` with open notes: before approving, the Hub shows "Você tem 2 comentários em aberto.
  Aprovar mesmo assim?". On confirm the post becomes aprovado as usual (auto-scheduling
  included). The open notes stay open, and the CRM flags the post "Aprovado com 2 comentários em
  aberto" on the post and in the conversation, so the agency can check with the client and
  resolve each one.

**CRM, agency side** (mockup: CRM conversa).
- "Conversa com o cliente" interleaves status events, client messages, pinned notes and
  correction requests chronologically. Filters: `Tudo` / `Em aberto` / `Na mídia`.
- Each note: anchor chip (selects the slide in the preview), author, time, status badge,
  replies, a reply box, `Marcar como resolvido` / `Reabrir`.
- The media preview shows the client's pins in place; open pins dark, resolved ones light.
  Thumbnails carry a count of open notes.
- The team can drop **internal** pins on media from the CRM post editor's media area. They are
  visually distinct from client notes (an "Interno" label at least) and never leave the CRM.

**Versions.**
- When the agency replaces a slide or video, notes made on the old file stay in history
  labelled "Comentário sobre a versão anterior" (Hub and CRM), with their pins **not** moved
  onto the new file. Where the old file is still viewable, the builder may show it; otherwise
  the note shows without a media preview.

## Constraints found in the codebase

- **Media identity.** A post's media are `post_file_links` rows (`post_id`, `file_id`,
  `sort_order`, `is_cover`), served to the Hub by `hub-posts` as `HubPostMedia`. A media
  "adjustment" swaps `file_id` on the same link (`post_file_link_replace`, migration
  `20260916000001`). Several other paths **delete and re-insert** links:
  `post_media_set_from_uploads` (deletes all links of the post, used by uploads and MCP
  `set_post_media`), `post-media-manage` / `file-manage` delete routes, the design/estúdio
  RPCs, the storage auto-clean RPCs. So a link id is not a stable anchor.
- **Client authorship.** Hub clients have no auth user; they act through a hub token.
  `post_approvals` records authorship as `is_workspace_user` plus the token. The existing
  internal text threads (`post_comment_threads` / `post_comments`) require
  `created_by uuid NOT NULL`, so they do not fit client authors as they stand.
- **Hub sanitization.** `hub-post-history` strips actor names and internal data server-side on
  purpose; the Hub's `CommentHighlightReadonly` deliberately drops internal thread marks.
  Internal-only data must be filtered **server-side**, not just not-rendered.
- **Notifications.** Client actions notify through `create_post_approval_notification`
  (called by `hub-approve`). Notification `type` is a CHECK constraint repeated across several
  migrations (`notification_center_phase1`, `mensagens_consolidadas`, e-mail prefs, claim
  RPC); adding a type means touching all of them.
- **Rate limits.** Hub writes have their own budget and must not debit `hub-read`
  (`hub-approve` shows the pattern: `hub-read:`, write key, bad-token key).
- **Hub endpoints** deploy with `--no-verify-jwt` (token auth), CORS via `buildCorsHeaders`,
  workspace ownership checked against the token's `conta_id`/`cliente_id`.
- **Silent updates.** Any composer with unsent text outside a modal calls
  `useUnsavedWork(condition)`; never `useBlocker`.
- **Copy** is pt-BR, sentence case, no em dashes. Hub copy never mentions internal states.
- **CI.** New Hub/CRM code must pass the four `tsc` projects, lint, format, Vitest, `deno
  check` + `deno test`; new tables with RLS get an entitlement/RLS psql suite if the existing
  pattern calls for it. Migration version prefixes must be unique (renumber above main's tail
  before opening the PR).
- The Hub's `hub-*` CSS rules apply (no Tailwind variants on `hub-*` classes).

## Builder's calls already made (check these)

1. **New tables, not the internal text threads.** `post_media_notes` (one row per note) and
   `post_media_note_replies`, with an author shape like `post_approvals`: `author_kind
   ('client' | 'team')`, `author_user_id uuid NULL` (team), hub token reference for client
   rows. A `visibility ('client' | 'internal')` column on the note only.
   Reason: client authors have no user id, and internal text threads are anchored by TipTap
   marks / caption offsets, a different model.
   **Visibility/author matrix, enforced in the database** (CHECK constraints plus the write
   paths, not only in Hub selects): a client-authored note is always `visibility = 'client'`;
   a team-created note is always `visibility = 'internal'` (the team does not start
   client-visible notes in this version, it replies to the client's); replies carry no
   visibility of their own and always inherit the parent note's; a client reply on an internal
   note is impossible (the Hub never learns internal note ids, and the write path rejects it).
   **Tenant-safe anchors:** `post_id` and `file_id` are tied to the row's `conta_id` with
   composite FKs, following `post_references` (migration `20261011000001`:
   `(post_id, conta_id) → workflow_posts(id, conta_id)`, `(file_id, conta_id) → files(id,
   conta_id)`).
2. **Anchor on the file, not the link.** A note stores `post_id`, `file_id` (the file the
   author was looking at), a `slide_index_at_creation` snapshot, optional `t_seconds`, optional
   `x`, `y` (both or neither, each 0..1, CHECK-constrained), `media_kind`. A note is
   **current** when a link of the same post currently points at that `file_id`; its slide label
   is computed from that link's current `sort_order`, never stored. Otherwise it is "versão
   anterior" and its label uses the snapshot ("era o slide 3"). This survives in-place replace,
   delete-and-reinsert and reordering without touching any of the media-write paths.
   `post_file_links` is unique on `(post_id, file_id)`, so the match is unambiguous.
   **The client never sends a file id.** `HubPostMedia.id` is the `post_file_links.id` and the
   Hub DTO has no `file_id`; it stays that way. The Hub sends the link id it is showing, and the
   write path resolves it server-side to the file, rejecting a link that is not currently on
   that authorized post. The read DTO for notes gives the Hub what it needs to place a note
   (current link id or "versão anterior" with the snapshot label), never raw file ids.
3. **File lifetime.** `file_id` must not cascade-delete the note when a file is trashed or
   purged: nullable / no cascade, with the note degrading to "versão anterior, mídia removida".
   The builder checks how `files` deletion and `file_deletions` work and picks the FK action.
   The note must not keep a file alive (no `reference_count` bump).
4. **Correction / approval snapshot.** When the client sends `correcao` or `aprovado`, the
   note ids that are **open and client-visible** at that moment are linked to the approval row
   (a join table). Internal notes never enter the snapshot, the Hub warning, or its counts.
   The snapshot is taken **in the same locked transaction as the approval**
   (`record_client_approval` or a wrapper RPC that locks the post and its notes), not as a
   follow-up request the way `hub-approve` links `reference_ids` after the approval commits;
   otherwise a concurrent reply/reopen makes it wrong. The "2 comentários em aberto: slides 3,
   4" line and the "Aprovado com comentários em aberto" flag read that snapshot, not a live
   count. The CRM flag may additionally show how many are still open now.
5. **Notification type.** Reuse `post_message` through `create_post_approval_notification`,
   rather than adding a new type (avoids touching every migration that repeats the CHECK list
   and Mensagens consolidadas). That RPC hardcodes the destination to the post, so the
   notification **opens the post**, not the note; deep-linking to the note would need an RPC
   contract change and is out of scope for this version. Internal notes do not create
   client-facing notifications; whether they create team notifications (like `mention`) is
   left to the builder, default none.
6. **Endpoints.** A new hub function (e.g. `hub-media-notes`: create note, reply) with its own
   write rate-limit key, and the notes included in `hub-posts` (or fetched alongside) for the
   client. Its writes require, besides post/client/workspace ownership from the token, the
   same client-visible-status gate `hub-approve` applies to `mensagem` (`HUB_VISIBLE_STATUSES`:
   `enviado_cliente`, `aprovado_cliente`, `correcao_cliente`, `agendado`, `postado`,
   `falha_publicacao`), so a client can never write on a draft it cannot see. CRM
   reads/writes go through RLS-scoped Supabase calls in `store/` (reply, resolve, reopen,
   internal note create), like `store/comments.ts`. Resolve is team-only by RLS and by
   endpoint (the hub endpoint has no resolve action).
7. **Internal filtering is server-side with a test**: `hub-posts`, `hub-post-history` and the new
   hub endpoint select only `visibility = 'client'`, and a test proves an internal note never
   appears in any Hub payload.
8. **History integration.** The Hub's `PostHistoryPanel` and the CRM's post conversation
   (`WorkflowDrawer`, `StandalonePostDrawer`, `HistoryDrawer` where they show approvals)
   interleave notes as entries. Exact component split is the builder's.
9. **MCP.** `list_post_feedback` gains the client notes (anchor, status, replies) so content
   agents see them. Internal notes included only if the existing tool already exposes internal
   data; otherwise excluded. No new scope.
10. **All media post types** with images or videos get notes, Stories included.
11. **Plan gating:** see open questions.

## Left to the builder

- Exact component structure in `PostDetailDialog` / `PostMediaPane` / lightbox and in the CRM
  post editor's media area; how pin placement coexists with the carousel's swipe/drag (tap vs
  drag threshold) and the lightbox.
- Computing `(x, y)` against the media's rendered box (object-fit letterboxing must not shift
  pins), and the video spot-pin visibility window.
- Hub video element integration (HLS playback via `playback.hls`) for pausing and reading
  `currentTime`.
- Empty, error, offline and lost-media (`media_lost_at`) states.
- Whether the CRM shows the old file of a "versão anterior" note when it still exists.
- Indexes, RLS policy shapes, and test layout.

## Open questions (theirs)

To be settled with the product owner before planning; recorded here with the default that ships
if nobody objects.

1. Plan gating: every plan, or behind an entitlement? Default: every plan.
2. Do agency replies and resolutions notify or e-mail the client, or does the client see them
   on the next visit? Default: next visit only.
3. Agency names on replies in the Hub: "Agência" (today's rule) or the team member's first
   name? Default: "Agência".
