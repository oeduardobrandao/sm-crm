# Instagram Trial Reels ("Reel de teste") — Design

**Date:** 2026-08-28
**Status:** Approved

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
- Migration version prefix must be re-verified against `origin/main`'s tail at
  PR-open time (migration-version-guard).

The column must be added to every explicit select list that feeds a surface
showing or publishing the flag:

- CRM: `apps/crm/src/store/posts.ts` (the two select strings, `WorkflowPost`
  type, and the mapper).
- Edge: `fetchPostForPublish` in
  `supabase/functions/_shared/instagram-publish-utils.ts` (line ~74), plus the
  post selects in `instagram-publish` and `instagram-publish-cron` if they
  select fields independently.
- Hub: `supabase/functions/hub-posts/handler.ts` select (line ~136) and the Hub
  app's post type.

## CRM UX (WorkflowDrawer)

Visibility rule: the section renders only when `tipo === 'reels'` AND the post
targets Instagram (`platform` is `'instagram'` or `'both'` or null-default).

- **Switch:** "Reel de teste" with description
  "Publica como teste, visível só para quem não segue a conta."
- **When on, radio pair** (writes `ig_trial_strategy`):
  - `auto`: "Compartilhar com todos automaticamente se performar bem"
  - `manual`: "Eu decido manualmente no app do Instagram"
  - Default when switching on: `auto` (matches Meta's SS_PERFORMANCE showcase
    and requires no follow-up action from the user).
- **Helper text:** "Exige conta profissional pública com pelo menos 1.000
  seguidores. Não funciona com colaboradores no post."
- **Self-heal:** if `tipo` changes away from `reels` or the platform drops
  Instagram, the flag resets to NULL (same pattern PlatformSelector uses to heal
  `tiktok`/`both` on stories posts).
- **Badge:** a small "Teste" chip next to the existing tipo badge in the
  entregas list view and the calendar post detail panel. No new tipo color;
  reuse the reels color at reduced emphasis.
- UI copy contains no em-dashes (house rule).

## Publish pipeline

- `createContainerForPost` gains an optional trial parameter (from the post
  row's `ig_trial_strategy`) and threads it into `createVideoContainer`, which
  adds to the container body:
  `trial_params: JSON.stringify({ graduation_strategy: 'MANUAL' | 'SS_PERFORMANCE' })`
  (Graph API accepts stringified nested params; verify empirically on staging
  whether the raw object also works and prefer whichever succeeds).
- **Server-side guard:** trial applies only on the single-video reels path.
  For stories, carousels, and single-image posts the flag is ignored (never an
  error): the container is built as today.
- Both callers pass it: `instagram-publish` (publish-now) and
  `instagram-publish-cron` (scheduled, including the deferred coverless retry
  path, which must preserve `trial_params` when rebuilding the container).
- TikTok side of a `both` post is unaffected; trial is Instagram-only.
- **Errors** (e.g., account under 1,000 followers, daily trial cap): surface
  through the existing `falha_publicacao` flow with the raw-classified message.
  No new `publish_error_code` enum value in v1 (that enum is mirrored in three
  places; only add one if a distinct, documented Meta subcode for trial
  ineligibility shows up in practice).

## Hub

- `hub-posts` payload includes `ig_trial_strategy`.
- The client-facing post detail shows a "Reel de teste" chip next to the tipo
  label so the client knows what they are approving. No graduation detail shown
  to the client.

## Out of scope (v1)

- MCP `create_post` / `set_post_property` support for the flag.
- Post Express page (toggle lives only in the WorkflowDrawer editor).
- Trial-specific analytics/insights.
- In-app graduation (impossible via API).
- Pre-validating the 1,000-follower requirement client-side.

## Testing

- **Deno** (`supabase/functions/__tests__/`): container body includes
  `trial_params` for a single-video reels post with the flag; omits it when the
  flag is NULL; ignores it on carousel/stories/single-image paths; the
  coverless-retry rebuild preserves it.
- **Vitest**: toggle visibility rules (reels + Instagram only), self-heal on
  tipo/platform change, badge rendering.
- Contract sweep: grep `apps/**/__tests__` and `supabase/functions/__tests__`
  for post-select shape assertions before changing the select strings
  (house rule: contract changes break existing tests in both suites).
