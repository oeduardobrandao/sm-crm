# Instagram Trial Reels ("Reel de teste") — Design

**Date:** 2026-08-28
**Status:** Approved (rev. 3 — two external review rounds folded in)

## Summary

Let users publish a reels post as an Instagram **Trial Reel**: a reel shown only to
non-followers during a test window, which can later be shared with all followers
("graduated") either manually in the native Instagram app or automatically by
Instagram when it performs well.

This is modeled as an **option on the existing `reels` tipo**, not a fifth tipo.
Meta's API treats a trial reel as a regular reels container plus a `trial_params`
field, and keeping the four-value `tipo` union avoids touching its DB CHECK
constraint, every tipo switch (labels, colors, calendar markers, TikTok guards),
the Hub, and the MCP tools.

## Meta API facts (verified 2026-08-28)

- Container creation (`POST /{ig-user-id}/media`, `media_type=REELS`) accepts
  `trial_params` with one field: `graduation_strategy`, values `"MANUAL"`
  (user graduates in the native app) or `"SS_PERFORMANCE"` (Instagram
  auto-shares to followers if the trial performs well).
  Source: https://developers.facebook.com/docs/instagram-platform/content-publishing/
- Requirements (from Meta docs + third-party schedulers Metricool/PostFast):
  public professional account (Creator or Business), **1,000+ followers**,
  no collaborators. Roughly **20 trial reels/day** via API.
- There is no API to graduate a trial reel after the fact; graduation is either
  MANUAL (native app) or automatic via SS_PERFORMANCE. No in-app graduation UI
  is possible for us.

## Decisions (user-approved)

1. **Toggle on reels posts**, not a new `tipo` value.
2. **Per-post graduation choice**: the user picks MANUAL vs SS_PERFORMANCE when
   the toggle is on.
3. Hub badge included (client sees that the post is a trial reel).

## Data model

One nullable column on `workflow_posts`:

```sql
ALTER TABLE workflow_posts
  ADD COLUMN ig_trial_strategy text
  CHECK (ig_trial_strategy IN ('manual', 'auto'));
```

- `NULL` = normal post (default, no backfill needed).
- `'manual'` = trial reel, MANUAL graduation.
- `'auto'` = trial reel, SS_PERFORMANCE graduation.
- No change to the `tipo` CHECK constraint.

**Server-side invariant (authoritative, not just UI self-heal).** UI field
updates are independent writes, so rapid or concurrent edits can strand a
strategy on a post that is no longer a trial candidate. The same migration adds
a `BEFORE INSERT OR UPDATE` trigger on `workflow_posts` that nulls
`ig_trial_strategy` whenever the row stops satisfying the predicate:

```
tipo = 'reels' AND COALESCE(platform, 'instagram') IN ('instagram', 'both')
```

The "exactly one video" half of the trial predicate lives at publish time (media
links are a separate table; the trigger stays row-local).

**Claim RPC.** The cron does NOT read `workflow_posts` directly for its post
shape — it calls `claim_posts_for_publishing` (canonical definition:
`20260807000002_claim_skip_nonretryable.sql`). The same migration redefines the
RPC: add `ig_trial_strategy text` to `RETURNS TABLE` and the final `SELECT`,
and add `TRIAL_INELIGIBLE` to the retry phase's non-retryable `NOT IN` list
(see Errors below). The redefinition must retain the existing
`REVOKE ALL ... FROM public` + `GRANT EXECUTE ... TO service_role` pair
(REVOKE FROM PUBLIC strips service_role too).

**Explicit selects that must gain the column:**

- CRM: `apps/crm/src/store/posts.ts` (the two select strings, `WorkflowPost`
  type, and the mapper).
- Edge: `validateForScheduling`'s post select in
  `supabase/functions/_shared/instagram-publish-utils.ts` (line ~74) if the
  flag is needed there; the `ClaimedPost` interface in
  `instagram-publish-cron/index.ts`; and `instagram-publish/handler.ts`'s post
  fetch.
- Hub: `supabase/functions/hub-posts/handler.ts` select (line ~136) and the Hub
  app's post type.

**Deployment order:** (1) migration (column + trigger + RPC redefinition),
(2) edge functions, (3) CRM/Hub frontends. Code that selects
`ig_trial_strategy` against the old schema fails at PostgREST, so the migration
always ships first. Rollback is the reverse and must be ordered inside the
database too: (1) drop the trigger AND its trigger function first (a plpgsql
body referencing `NEW.ig_trial_strategy` fails at runtime once the column is
gone), (2) redefine the claim RPC without the column, (3) remove code
references, (4) drop the column last.

## CRM UX (WorkflowDrawer)

Visibility rule: the section renders only when `tipo === 'reels'` AND the post
targets Instagram (`(post.platform ?? 'instagram')` is `'instagram'` or
`'both'`).

- **Switch:** "Reel de teste" with description
  "Publica como teste, visível só para quem não segue a conta."
- **When on, radio pair** (writes `ig_trial_strategy`):
  - `auto`: "Compartilhar com todos automaticamente se performar bem"
  - `manual`: "Eu decido manualmente no app do Instagram"
  - Default when switching on: `auto` (requires no follow-up action from the
    user).
- **Helper text:** "Exige conta profissional pública com pelo menos 1.000
  seguidores. Não funciona com colaboradores no post."
- **Locked while scheduled:** the switch and radio are disabled when
  `isScheduleLocked` (`status === 'agendado'`), exactly like the date and
  caption. Rationale: the cron creates the Instagram container up to 1 hour
  before `scheduled_at`; a strategy change after container creation cannot
  reach the already-created container. Canceling the schedule unlocks it (the
  existing cancel path already clears `instagram_container_id`). Note: `tipo`
  and `platform` remain editable while `agendado` today; that pre-existing
  container-desync window is out of scope here and tracked separately.
- **Self-heal (UX nicety, not the invariant):** if `tipo` changes away from
  `reels` or the platform drops Instagram, the UI clears the flag in the same
  update. The DB trigger above is the authority.
- **Badge:** a small "Teste" chip next to the existing tipo badge in the
  entregas list view and the calendar post detail panel. No new tipo color;
  reuse the reels color at reduced emphasis.
- UI copy contains no em-dashes (house rule).

## Publish pipeline

- **Wire format (decided):** `trial_params` is sent as a JSON-encoded string in
  the container body:
  `trial_params: JSON.stringify({ graduation_strategy: "MANUAL" | "SS_PERFORMANCE" })`.
  Graph API parses string-encoded structured params in JSON bodies; this is the
  documented cURL form. Staging validation verifies this choice; it does not
  reopen it.
- `createContainerForPost` gains an optional trial option (from the post row's
  `ig_trial_strategy`) and threads it into `createVideoContainer`.
- **Media-shape rule (blocking, not silent):** a trial post must be
  `tipo === 'reels'` with exactly one video. A post labeled "Teste" must never
  quietly publish as a normal post, because the client approved a trial.
  Enforced at two layers:
  1. **Validation** — `validateForScheduling` (which runs for both `schedule`
     and `publish-now`, handler lines ~84/~179) adds an error when
     `ig_trial_strategy` is set and the post is not exactly one video with
     `tipo = 'reels'`: "Reel de teste exige exatamente um vídeo. Ajuste a
     mídia ou desligue o Reel de teste." Scheduling/publish-now is blocked
     up front.
  2. **Container creation** — if the flag is still set but the path is not
     single-video reels (media edited after scheduling), `createContainerForPost`
     THROWS with that same message instead of silently omitting `trial_params`.
     The message is a deterministic classifier pattern for `TRIAL_INELIGIBLE`
     (non-retryable), so the post lands in `falha_publicacao` with actionable
     copy rather than publishing to all followers.
  Note the single-video route currently builds a REELS container without
  checking `tipo` (a single-video `feed` post publishes as a reel today); trial
  is keyed on `tipo === 'reels'` explicitly and must not piggyback on that.
  The WorkflowDrawer additionally shows an inline hint when the switch is on
  but the current media does not qualify.
- **All three container-creation paths carry it:**
  1. `instagram-publish` (publish-now) initial container.
  2. `instagram-publish` immediate coverless retry — this path calls
     `createVideoContainer` DIRECTLY (handler.ts line ~288), bypassing
     `createContainerForPost`; it must pass `trial_params` explicitly or trial
     is dropped precisely when a cover fails.
  3. `instagram-publish-cron` Phase 1 container creation, including the
     deferred coverless retry on later cycles.
- TikTok side of a `both` post is unaffected; trial is Instagram-only.

### Errors

- New `publish_error_code`: **`TRIAL_INELIGIBLE`**, non-retryable. The account
  not meeting trial requirements (under 1,000 followers, non-public or
  non-professional account, collaborators) never self-heals within the 3-retry
  window, so auto-retry only burns Graph calls. Mirrored in the three canonical
  places, all already touched by this change:
  1. `_shared/publish-error-codes.ts`: enum value, `NON_RETRYABLE_CODES`,
     classifier rules, and the PT copy defined below.
  2. `apps/crm/src/pages/entregas/publishErrorCopy.ts`: same copy,
     `acao: 'retry'` semantics per the existing map, `mostrarDetalhes: false`.
  3. The claim RPC's retry-phase `NOT IN` list (same migration that redefines
     it for the new column).
- Classifier rules for `TRIAL_INELIGIBLE`, in two tiers:
  1. **Deterministic, ships day one:** our own media-shape guard message
     ("reel de teste exige exatamente um vídeo"), thrown by
     `createContainerForPost` (see Media-shape rule). Fully under our control
     and unit-testable immediately — the code is implementable without waiting
     on Meta.
  2. **Meta account ineligibility (under 1,000 followers, non-public or
     non-professional account, collaborators):** the pattern is added only
     from a captured real error. Concrete gate: record the exact Graph
     `code`, `error_subcode`, and normalized message in the implementation PR
     (or a follow-up PR) from a staging/prod publish attempt on an ineligible
     account. Until captured, Meta-side ineligibility falls to `UNKNOWN` —
     the defined interim behavior: 3 retries, generic copy, raw detail only
     in the CRM-internal "Detalhes técnicos" expander. Implementers must not
     invent regexes for Meta's wording.
- `TRIAL_INELIGIBLE` copy covers both tiers: "Reel de teste não aceito"
  ("O post precisa de exatamente um vídeo e a conta precisa ser profissional,
  pública e ter 1.000+ seguidores. Ajuste o post ou a conta, ou desligue o
  Reel de teste, e tente novamente.").
- **Daily trial cap (~20/day) — defined outcome:** classifies as `RATE_LIMIT`
  (Meta rate-limit graph codes 4/9/17/32/613). The cron will burn its up-to-3
  minute-scale retries without the quota recovering, then park the post in
  `falha_publicacao` with the existing "Tentar novamente" button — the user
  retries the next day. This matches how the ordinary IG daily publish cap
  already behaves platform-wide; a delayed-retry/reset scheduler is explicitly
  out of scope for this feature. If a distinct trial-cap subcode shows up in
  practice, revisit with its own copy.
- Client-facing copy stays mapped; raw Meta details remain in internal logs and
  the CRM-internal technical-details expander only (existing pattern).

## Hub

- `hub-posts` payload includes `ig_trial_strategy`.
- The chip renders in **both card variants the pages actually mount**
  (`pickPostCardKind` in `apps/hub/src/lib/postView.ts` routes every
  non-story post with media to `InstagramPostCard`, and media-less posts to
  `TextPostCard`; these are what PostagensPage, AprovacoesPage and
  PostagemFocoPage render):
  - `apps/hub/src/components/InstagramPostCard.tsx` — next to its status
    chip (the card has no tipo label today; the trial chip is added
    standalone).
  - `apps/hub/src/components/TextPostCard.tsx` (line ~115) — next to the
    existing tipo label.
  - `PostCard.tsx` is NOT a target: no page mounts it as a card (it only
    exports shared helpers like `TIPO_LABEL`). Do not add the badge there.
  The compact surfaces (PostCalendar day detail, HubPostChip in mensagens)
  intentionally do not carry it. No graduation detail is shown to the client.

## Out of scope (v1)

- MCP `create_post` / `set_post_property` support for the flag.
- Post Express page (toggle lives only in the WorkflowDrawer editor).
- Trial-specific analytics/insights.
- In-app graduation (impossible via API).
- Pre-validating the 1,000-follower requirement client-side.
- Locking `tipo`/`platform` while `agendado` (pre-existing desync window,
  tracked separately).

## Testing

- **Deno** (`supabase/functions/__tests__/`):
  - container body includes stringified `trial_params` for a single-video
    reels post with the flag, and omits it when the flag is NULL;
  - `createContainerForPost` THROWS the media-shape message when the flag is
    set on carousel/stories/single-image paths or a single-video non-reels
    tipo (never silently drops trial);
  - `validateForScheduling` returns the media-shape error for a flagged post
    that is not exactly one video;
  - the publish-now immediate coverless retry preserves `trial_params`;
  - the cron's deferred coverless rebuild preserves `trial_params`;
  - `classifyPublishError` returns `TRIAL_INELIGIBLE` for the media-shape
    guard message (deterministic tier) and it is in `NON_RETRYABLE_CODES`;
    the Meta-pattern tier gets a test when its pattern is captured.
- **SQL** (entitlement/trigger suite or migration test): the trigger nulls
  `ig_trial_strategy` on tipo change away from `reels` and on platform
  `tiktok`; keeps it for `instagram`/`both`/NULL platform.
- **Vitest**: toggle visibility rules (reels + Instagram only), disabled state
  while `agendado`, self-heal on tipo/platform change, badge rendering (CRM
  and both Hub card variants).
- Contract sweep: grep `apps/**/__tests__` and `supabase/functions/__tests__`
  for post-select and claim-RPC shape assertions before changing them
  (house rule: contract changes break existing tests in both suites).
