# Instagram collaborators (collab posts): design

Date: 2026-10-19 · Status: approved mockups, spec under review
Mockups (approved 2026-10-19): https://claude.ai/artifact/A5s9oc4m5CHTFzHDGSYyqv

## Why

A collab post shows up in the feed and on the profile of every account on it, and
adds up their reach. For the agency's clients this is routine: a doctor and her
clinic, a professional and a partner brand. Mesaas schedules and auto-publishes
Instagram posts, but sends no collaborators. So a collab today means publishing by
hand in the Instagram app, which defeats the schedule-and-forget flow the agency
pays for.

## Feasibility (proven before this spec)

Meta's docs list "Collaborator Tags" as a Facebook Login feature, and Mesaas
publishes through Instagram Login (`graph.instagram.com`, `_shared/instagram-graph.ts`).
A spike on 2026-10-19 settled it empirically on staging (account `@mesaas.com.br`,
client 25, image containers only, nothing published, the temp function deleted):

| Container request | Result |
|---|---|
| `image_url` + `caption` | 200, container id |
| same + `collaborators: ["instagram"]` (JSON array in the JSON body) | 200, container id |
| same + `collaborators: ["zz_no_such_user_mesaas_91834"]` | 400, `code 110`, `error_subcode 2207018`, message "Invalid user id", `error_user_title` "Não é possível carregar um usuário com um perfil privado ou nome de usuário inválido", `error_user_msg` "Os seguintes usuários não podem ser acessados: zz_no_such_user_mesaas_91834" |

So the param is recognized and validated **at container creation**, and private or
nonexistent profiles fail synchronously with a stable subcode.

Not proven yet (closed by the staging acceptance test in "Rollout"): that the
published post actually carries the invite, and that Reels and carousel parent
containers accept the param the same way.

Meta limits, per the `POST /{ig-user-id}/media` reference: up to **3** usernames,
Feed image, Reels and Carousel only, **not Stories**. (A different Meta page says 5;
we use 3, the publishing limit.) Trial reels cannot have collaborators (already in
`TrialReelPanel`'s copy and the 2026-08-28 trial-reels spec).

## Goals

- An agency member can add up to 3 Instagram @usernames to a Feed, Carrossel or
  Reels post that targets Instagram, from the post editor (desktop drawer and phone
  editor), and Mesaas sends them as `collaborators` when it creates the container.
- Invalid input is caught while typing; an account Instagram refuses at publish
  time produces a specific, actionable publish error that names the account.
- The client sees the partner accounts in the Hub before approving.
- The team sees which posts are collabs in the post list and the calendar panel.

## Non-goals (v1)

- Showing whether each invite was accepted. `GET /{ig-media-id}/collaborators`
  (invite_status `Accepted`/`Pending`) is documented only for Facebook Login
  (`pages_read_engagement`) and would need a sync job. Later phase, after a spike.
- Stories (API does not support it), TikTok (no equivalent), trial reels (Meta
  forbids the combination).
- Pre-validating that a username exists before publish. Business Discovery only
  sees business/creator accounts, so it would wrongly reject personal profiles.
  Creating a throwaway container to validate would burn the account's container
  budget. Publish-time validation plus a clear error is the v1 answer.
- Collaborator autocomplete or a per-client list of frequent partners.
- MCP tools (`create_post`/`update_post`), Post Express and the Hub writing
  collaborators. Read-only in the Hub. MCP is a small follow-up.
- Post version history tracking of the field.

## Anti-goals

- Never silently publish a collab post without its collaborators. If Instagram
  rejects a collaborator, the post fails with a clear error; it does not retry
  without them unless a human chooses "Publicar sem colaboradores".
- Never block publishing of posts that have no collaborators (zero regression to
  the existing pipeline; the param is omitted entirely when the list is empty).

## Data model

Migration (next free version above main's tail; main ends at `20261016000001`):

- `workflow_posts.ig_collaborators text[] NOT NULL DEFAULT '{}'`.
  `COMMENT`: Instagram usernames (no `@`, lowercase) sent as `collaborators`.
- `CHECK` (named `workflow_posts_ig_collaborators_valid`):
  `cardinality(ig_collaborators) <= 3` and every element matches
  `^[a-z0-9._]{1,30}$` (an `IMMUTABLE` SQL helper or an `array_to_string` regex;
  builder's call) and no duplicates.
- `CHECK` (named `workflow_posts_ig_collab_trial_exclusive`):
  `ig_trial_strategy IS NULL OR cardinality(ig_collaborators) = 0`.
- Extend the invariant trigger. `workflow_posts_clear_ig_trial()` (trigger
  `workflow_posts_z5_clear_ig_trial`, `20260829000001`) clears the trial flag when the
  post stops being reels or stops targeting Instagram. Add the same for
  collaborators: clear `ig_collaborators` to `'{}'` when `NEW.tipo = 'stories'` or
  `COALESCE(NEW.platform,'instagram') NOT IN ('instagram','both')`. The UI self-heal
  mirrors it and shows a toast (below). Builder decides whether to extend the
  existing function or add a sibling trigger; the trigger name must sort before any
  trigger that reads the column, and it must run before the CHECK (BEFORE triggers
  always do).
- `claim_posts_for_publishing(text, int)`: add `ig_collaborators text[]` to
  `RETURNS TABLE` (shape change, so `DROP` + `CREATE`, copying the canonical body of
  `20260925000013_claim_publishing_order_by_scheduled_at.sql` with two edits: the new
  column in the final `SELECT`, and `'COLLABORATOR_INVALID'` added to the retry
  phase's `NOT IN` list). Re-grant: `REVOKE ALL ... FROM public, anon, authenticated;
  GRANT EXECUTE ... TO service_role`.
- `duplicate_post` (canonical body: `20261010100006_duplicate_post_targets.sql`):
  copy `ig_collaborators` alongside `ig_trial_strategy`.
- Check every other function that `INSERT`s into `workflow_posts` with an explicit
  column list copied from a source post (grep `ig_trial_strategy` across migrations)
  and decide per function whether collaborators should carry over. Default: carry
  over wherever the trial flag carries over.

No new grants are needed: `workflow_posts` has no column-level `GRANT` allowlist.
Verify that assumption against the latest migrations during planning.

## Publish pipeline (edge functions)

`_shared/instagram-publish-utils.ts`:

- `createSingleImageContainer`, `createVideoContainer` (REELS) and
  `createCarouselParentContainer` accept an optional `collaborators: string[]`.
  When non-empty, the JSON body gets `collaborators: [...]` (array, as the spike
  sent it). When empty or absent, the key is omitted.
- Carousel **children** never get the param; only the parent.
- Stories helpers never get it (defensive: the DB invariant already empties it).
- `createContainerForPost` and `advanceCarouselContainer` thread it through.
- `throwGraphError` (`_shared/instagram-graph.ts`) also keeps
  `error_user_msg` on the thrown error (`err.graphUserMsg`), so the failure path can
  store the account names Meta lists.
- Defensive guard: if a post has collaborators AND a trial strategy, or collaborators
  on a stories post, throw before calling Meta (should be unreachable given the DB
  checks).

`instagram-publish-cron/index.ts` and `instagram-publish/handler.ts` (manual
"publicar agora"/retry path): read `ig_collaborators` (cron from the claim RPC, the
handler from its own `select`) and pass it to container creation in every branch
(image, reels, carousel) on the first attempt **and** on retries. Unlike the cover,
collaborators are never dropped on retry.

`_shared/publish-error-codes.ts` and its frontend mirror
`apps/crm/src/pages/entregas/publishErrorCopy.ts`:

- New code `COLLABORATOR_INVALID`, matched by `graphSubcode === 2207018` (placed
  before the generic rules), added to `NON_RETRYABLE_CODES` and to the claim's retry
  `NOT IN` list (above).
- Copy: titulo "O Instagram recusou um colaborador"; explicacao "Confira se o @ está
  certo e se o perfil é público. Edite os colaboradores e tente novamente." No em
  dashes. Action: the existing retry button plus the two collaborator actions below.
- On this failure, `publish_error` stores Meta's `error_user_msg` when present
  (it names the refused accounts), else the message, still sliced to 500 chars.
- Wherever else the code list is enumerated (alert e-mail copy in
  `notification-email.ts`/`notify.ts`, any exhaustive `Record<PublishErrorCode,…>`),
  add the new entry. The TypeScript `Record` types make the compiler find them.

Platform-agnostic posts (`post_targets`, `feature_multiplatform`): collaborators
belong to the Instagram destination only and live on `workflow_posts` like
`ig_caption` and `ig_trial_strategy` do. No change to `post_targets`.

## CRM UI

Reference: the mockups. All copy pt-BR, sentence case, no em dashes.

### `InstagramCollaboratorsField` (new component, `pages/entregas/components/`)

- Label "Colaboradores" with a lucide `Users` icon; counter "N de 3".
- A tag input: each username is a removable chip ("@usuario" with an `X` button,
  `aria-label="Remover @usuario"`), followed by a text input with placeholder
  "Adicionar @usuário".
- Adding: Enter, comma, space, blur with text, or paste (a pasted list splits on
  commas, spaces and newlines). Normalize: trim, strip one leading `@`, lowercase,
  and extract the username from a pasted profile URL
  (`instagram.com/<user>` with optional `www.`, query or trailing slash).
- Validation messages (below the field, `--danger-text`, `aria-invalid` on input):
  - not matching `^[a-z0-9._]{1,30}$`: "Use só letras, números, ponto e sublinhado, sem espaços."
  - duplicate: "@x já está na lista."
  - the client's own connected account, when the editor knows its username:
    "Este é o perfil do próprio cliente."
  - over the limit: the input disappears at 3 and the help line reads
    "Limite de 3 colaboradores por post. Remova um para trocar."
- Backspace on an empty input removes the last chip.
- Help line: "Cada conta recebe um convite quando o post for publicado e precisa
  aceitar no próprio Instagram. Só contas públicas."
- Persists through the existing `onFieldChange('ig_collaborators', next)` path on
  every add/remove (same save model as the other post fields).
- `disabled` (schedule-locked): chips without `X`, no input, lock line
  "Cancelar agendamento para editar" (same as caption and trial reel).
- Trial reel on: whole field disabled, with "Reels de teste não aceitam
  colaboradores. Desligue o Reel de teste para convidar."
- Failed with `COLLABORATOR_INVALID`: chips whose username appears in
  `post.publish_error` are drawn in the danger style with an alert icon, and the line
  under the field reads "O Instagram não encontrou este perfil, ou ele é privado."
- Renders nothing when: no connected Instagram account, `tipo === 'stories'`, or the
  post does not target Instagram.

### Placement

- Desktop drawer, single-platform: directly below the Instagram caption field,
  above `TrialReelPanel`.
- Desktop drawer, multiplatform: inside the Instagram tab of
  `DestinationCaptionTabs`, below the caption.
- Phone editor, Publicar tab: in the "Instagram" section, above the trial-reel row.
  That section's gate changes from `tipo === 'reels'` to "any non-stories post
  targeting Instagram"; the trial-reel row inside it keeps its own reels-only gate.

### Mutual exclusion with Reel de teste

`TrialReelPanel` gets a "has collaborators" input: the switch is disabled with
"Indisponível com colaboradores no post. Remova os colaboradores para publicar como
teste." The collaborators field is disabled while the trial is on (above). The DB
CHECK is the backstop.

### Self-heal on tipo / platform change

Where `PostEditorBody` already nulls `ig_trial_strategy` on a tipo change away from
reels or a switch to TikTok-only, it also clears `ig_collaborators` when the change
makes collaborators impossible (tipo → stories, platform → tiktok), and shows
`toast.info("Colaboradores removidos: Stories não aceitam colaboradores.")` or
"Colaboradores removidos: o post não vai mais para o Instagram." Only when the list
was non-empty.

### Indicators

- `PostsListView` tipo column: after the tipo badge, a "Collab N" pill (info tint,
  `Users` icon) with `title="Colaboradores: @a, @b"`, next to where "Teste" shows.
  Desktop and phone list variants.
- `CalendarPostDetailPanel`: a "Colaboradores" row listing the @usernames.
- Only where the post object already carries the field. The data loaders must
  select `ig_collaborators` (`store/posts.ts` column lists, `POST_CONTEXT_COLUMNS`,
  board/list mappers). Treat `null`/missing as `[]`.

### Publish error block

`PublishErrorBlock` for `COLLABORATOR_INVALID`: the copy above, plus:
- "Editar colaboradores": focuses the collaborators field (switching to the
  Instagram tab in multiplatform, or the Publicar tab on phone).
- "Publicar sem colaboradores": confirms with an AlertDialog ("Publicar sem
  colaboradores?" / body "O post será publicado só no perfil do cliente." / confirm
  "Publicar sem colaboradores"), then clears `ig_collaborators` and calls the
  existing retry (`retryInstagramPublish`).

## Hub (client portal)

- `hub-posts` handler: add `ig_collaborators` to its `select`.
- `apps/hub/src/types.ts`: `ig_collaborators?: string[]`.
- `PostDetailDialog`: under the type/platform line, when non-empty, a line with the
  `Users` icon: "Em parceria com @a e @b" (pt) / "In partnership with @a and @b"
  (en), formatted with a list formatter for 1, 2 or 3 names; plus a small note
  "No Instagram, o post vai aparecer também no perfil dessas contas, se elas
  aceitarem o convite." New keys in `packages/i18n/locales/{pt,en}/hubPosts.json`.
- Read-only. No collab indicator on Hub list cards in v1.

## Testing

- **Vitest (CRM):** the field's normalization (`@`, case, URL extraction, paste
  splitting), validation messages, limit, duplicate, own-account, backspace, disabled
  and trial-disabled states, error-chip highlighting from `publish_error`;
  `TrialReelPanel` disabled with collaborators; `PostEditorBody` self-heal toast;
  list pill and calendar row; `PublishErrorBlock` actions; `publishErrorCopy` has the
  new code.
- **Vitest (Hub):** `PostDetailDialog` partnership line for 1, 2, 3 names and none.
- **Deno:** each container builder sends `collaborators` only when non-empty and
  never on carousel children; cron and handler pass it on first attempt and retry;
  `classifyPublishError` maps subcode 2207018; `throwGraphError` keeps
  `error_user_msg`; the defensive trial/stories guard.
- **psql entitlement/RLS suite** (`supabase/tests/entitlements/`): the CHECKs
  (4 items, bad chars, duplicates, trial+collab), the trigger clearing on stories
  and tiktok-only, `duplicate_post` copying the field, the claim returning it.
- Update existing tests that build `WorkflowPost` fixtures or assert exact select
  strings / claim shapes (grep both `__tests__` trees for `ig_trial_strategy`).

## Rollout

1. Apply the migration to staging, deploy the changed functions to staging
   (`instagram-publish-cron`, `instagram-publish`, `hub-posts`, plus any function
   whose bundle includes the changed `_shared` modules and is redeployed by the
   usual rollout list).
2. **Staging acceptance test (needs the user's OK, it publishes for real):** on
   `@mesaas.com.br`, schedule one Reels and one Carrossel with one collaborator the
   user controls, let the cron publish, and confirm the invite arrives in that
   account's Instagram. Also schedule one with a nonexistent username and confirm
   the post lands in `falha_publicacao` with `COLLABORATOR_INVALID` and the error
   block names the account.
3. Production: migration and functions before merging the frontend (merge deploys
   the frontend immediately). No feature flag: the field is additive and empty by
   default.

Ordering hazard: the new claim RPC's shape changes. A cron still on the old code
reading the new RPC just ignores the extra column, so migration-first is safe. The
new cron against the old RPC would read `ig_collaborators` as undefined and must
treat it as `[]` (code defensively).

## Left to the builder

- Exact component split and prop names; whether the field lives in its own file
  (expected) and how it receives "the client's own username".
- Where the client's connected Instagram username comes from in the editor
  (it may already be on the account status object; if not, the own-account check
  can be skipped rather than adding a fetch).
- Helper function vs inline regex in the CHECK.
- Whether to extend `workflow_posts_clear_ig_trial()` or add a sibling trigger.
