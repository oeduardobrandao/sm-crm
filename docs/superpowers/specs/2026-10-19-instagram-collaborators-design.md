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

Known timing limit (accepted): a refused username surfaces when the container is
created. For a post scheduled more than 1 hour out that is about 1 hour before the
publish time (the claim's container phase is `scheduled_at <= now() + 1h`, and the
schedule action's front-load swallows its own error, `instagram-publish/handler.ts:131-136`).
For "publicar agora", or a schedule within the hour, it surfaces immediately.
Schedule-time checks catch everything else synchronously (see `validateForScheduling`).

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
  `cardinality(ig_collaborators) <= 3`, **`array_position(ig_collaborators, NULL) IS NULL`**
  (a `CHECK` passes on unknown, and `array_to_string` silently drops nulls, so `{NULL}`
  would otherwise pass), every element matches `^[a-z0-9._]{1,30}$`, and no
  duplicates. Implement as one `IMMUTABLE` SQL helper
  `ig_collaborators_valid(text[]) RETURNS boolean` that returns `false` (never `NULL`)
  for any bad input, used by the CHECK.
- `workflow_posts.ig_collaborators_refused text[] NOT NULL DEFAULT '{}'`: the
  subset of `ig_collaborators` Instagram refused on the last failed attempt. Written
  only by the publish failure path (below); cleared by the `retry` action's reset
  and by the clearing trigger whenever `ig_collaborators` changes
  (`NEW.ig_collaborators IS DISTINCT FROM OLD.ig_collaborators` on UPDATE), so a
  fixed list never shows a stale red chip. Not cleared on a successful publish (that
  would mean copying `mark_platform_published` forward); harmless because the UI
  only reads it while `status = 'falha_publicacao' AND publish_error_code =
  'COLLABORATOR_INVALID'`.
- `CHECK` (named `workflow_posts_ig_collab_trial_exclusive`):
  `ig_trial_strategy IS NULL OR cardinality(ig_collaborators) = 0`.
- Extend the invariant trigger. `workflow_posts_clear_ig_trial()` (trigger
  `workflow_posts_z5_clear_ig_trial`, `20260829000001`) clears the trial flag when the
  post stops being reels or stops targeting Instagram. Add the same for
  collaborators: clear `ig_collaborators` to `'{}'` when `NEW.tipo = 'stories'` or
  `COALESCE(NEW.platform,'instagram') NOT IN ('instagram','both')`. The UI self-heal
  mirrors it and shows a toast (below). **Extend `workflow_posts_clear_ig_trial()`**
  (keep the trigger name `workflow_posts_z5_clear_ig_trial`): z5 already sorts after
  `workflow_posts_a2_platform_to_targets` (rewrites `NEW.platform`,
  `20261014000001:168-237`) and `workflow_posts_z4b_platform_on_insert`
  (`20261010100002:185-202`), which is the ordering that matters. No trigger reads
  the new column. The same function clears `ig_collaborators_refused` as described
  above.
- `claim_posts_for_publishing(text, int)`: add `ig_collaborators text[]` to
  `RETURNS TABLE` (shape change, so `DROP` + `CREATE`, copying the canonical body of
  `20260925000013_claim_publishing_order_by_scheduled_at.sql` with two edits: the new
  column in the final `SELECT`, and `'COLLABORATOR_INVALID'` added to the retry
  phase's `NOT IN` list). Re-grant: `REVOKE ALL ... FROM public, anon, authenticated;
  GRANT EXECUTE ... TO service_role`.
- `duplicate_post` (canonical body: `20261010100006_duplicate_post_targets.sql`):
  copy `ig_collaborators` at **both** sites where the trial flag is copied: the
  `INSERT` column list (`:93-104`) and the re-apply `UPDATE ... SET platform =
  v_derived, ig_trial_strategy = s.ig_trial_strategy` (`:125`). The second one is
  mandatory: the insert lands with the board's derived platform, z5 empties the array
  when that board has no Instagram, and the re-derive UPDATE must restore it. Never
  copy `ig_collaborators_refused`.
- `trg_notify_post_publish_failed` (canonical copy
  `20260830000003_avulso_notifications_folders_views.sql:325-333`): it only notifies
  for a hardcoded `publish_error_code IN (...)` list or when `publish_retry_count`
  crosses 3. A non-retryable code stays at retry count 1, so without a change
  `COLLABORATOR_INVALID` would produce no Central de Notificações entry and no digest
  e-mail. Copy the function forward with `'COLLABORATOR_INVALID'` added to both
  `IN` lists. Same copy-forward also adds the three non-retryable codes that have the
  same gap today (`TRIAL_INELIGIBLE`, `CAPTION_TOO_LONG`, `ACCOUNT_RESTRICTED`), so
  the list equals `NON_RETRYABLE_CODES` (my call; a one-line, low-risk fix of a real
  silent gap).
- Check every other function that `INSERT`s into `workflow_posts` with an explicit
  column list copied from a source post (grep `ig_trial_strategy` across migrations)
  and decide per function whether collaborators should carry over. Default: carry
  over wherever the trial flag carries over.

No new grants are needed: `workflow_posts` has no column-level `GRANT` allowlist.
Verify that assumption against the latest migrations during planning.

## Publish pipeline (edge functions)

`_shared/instagram-publish-utils.ts`:

- `createSingleImageContainer`, `createVideoContainer` (REELS) and
  `createCarouselParentContainer` accept collaborators through an **options object
  that replaces the trailing positional `timeoutMs`**:
  `opts?: { timeoutMs?: number; collaborators?: string[] }` (for
  `createVideoContainer` the bag also absorbs `coverUrl` and `trialStrategy`). Today
  they are positional with `timeoutMs` last (`instagram-publish-utils.ts:187-193`,
  `:209-217`, `:311-317`); inserting another positional arg would silently shift
  `handler.ts:346`. `deno check` finds every call site after the change. When
  `collaborators` is non-empty the JSON body gets `collaborators: [...]` (array, as
  the spike sent it); empty or absent, the key is omitted.
- Carousel **children** never get the param; only the parent.
- Stories helpers never get it (defensive: the DB invariant already empties it).
- `createContainerForPost` and `advanceCarouselContainer` thread it through.
- `throwGraphError` (`_shared/instagram-graph.ts`) also keeps
  `error_user_msg` on the thrown error (`err.graphUserMsg`), so the failure path can
  store the account names Meta lists.
- `validateForScheduling` (`instagram-publish-utils.ts:85-148`, already selects
  `ig_trial_strategy` and 422s on trial shape at `:143`): also select
  `ig_collaborators` and reject collaborators + trial and collaborators on stories,
  so "Agendar" fails synchronously. Copy: "Reels de teste não aceitam colaboradores."
  / "Stories não aceitam colaboradores." Unreachable given the DB checks; cheap and
  visible defense.
- Defensive guard at container creation for the same two cases (throws before
  calling Meta).

Every container-creating call site passes `ig_collaborators` (treat `null` or a
missing field as `[]`, so a new function against an old RPC is safe), in every
branch (image, reels, carousel parent), on the first attempt **and** on retries.
Unlike the cover, collaborators are never dropped on retry.

- `instagram-publish-cron/index.ts`: `ClaimedPost` type (`:66`) gains the field
  from the claim RPC; `processContainerCreation` (`:158-222`, both the carousel and
  the single-container branches).
- `instagram-publish/handler.ts`: the post `select` (`:64`), the `schedule` action's
  1-hour front-load (`:110-136`, `createContainerForPost`), publish-now's first
  attempt, and publish-now's coverless retry (`:342-348`), which calls
  `createVideoContainer` directly. The `retry` action (`:164-186`) creates no
  container; it only gains the `clearCollaborators` flag (below).

`_shared/publish-error-codes.ts` and its frontend mirror
`apps/crm/src/pages/entregas/publishErrorCopy.ts`:

- New code `COLLABORATOR_INVALID`, matched by `graphSubcode === 2207018` (placed
  before the generic rules), added to `NON_RETRYABLE_CODES` and to the claim's retry
  `NOT IN` list (above).
- Copy: titulo "O Instagram recusou um colaborador"; explicacao "Confira se o @ está
  certo e se o perfil é público. Edite os colaboradores e tente novamente." No em
  dashes. Frontend display: **`acao: 'collaborators'`** (a new
  `PublishErrorAction` value, `publishErrorCopy.ts:20`; `PublishErrorBlock` renders
  for it "Tentar novamente" plus the two collaborator buttons below) and
  **`mostrarDetalhes: false`** (Meta's localized text names partner accounts; the red
  chips already show which ones).
- Refused accounts: on this failure the writer computes
  `refused = ig_collaborators ∩ tokens(error_user_msg)`, where tokens are
  `error_user_msg` lowercased, split on `[^a-z0-9._]+`, exact-token match (so `ana`
  never matches `anamaria`). It stores `refused` in `ig_collaborators_refused`.
  If the intersection is empty (Meta changed wording, or `error_user_msg` absent),
  store `'{}'`: the block still shows the generic copy and no chip is red. That
  fallback is the defined behavior, not an error. `publish_error` keeps today's
  content (the message, sliced to 500).
- Write sites: cron `markFailed` (`index.ts:87-150`), cron `collectFailure` for the
  operator alert (`:405-414`, which may include the refused names), and the handler's
  catch (`handler.ts:~407`).
- Sites the compiler finds: `PUBLISH_ERROR_COPY` (`Record<PublishErrorCode,…>`), the
  frontend mirror. Sites it does **not** find: the claim's retry `NOT IN` list and
  `trg_notify_post_publish_failed` (both in the migration above). Check
  `notification-email.ts` and `notify.ts` for any other hand-written list.

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
- Failed with `COLLABORATOR_INVALID`: chips listed in
  `post.ig_collaborators_refused` are drawn in the danger style with an alert icon,
  and the line under the field reads "O Instagram não encontrou este perfil, ou ele é
  privado." (plural form when more than one: "O Instagram não encontrou estes perfis,
  ou eles são privados."). Empty `ig_collaborators_refused`: no red chip, no line.
- Disabled-state precedence: schedule lock wins (chips without `X`, no input,
  "Cancelar agendamento para editar"), then trial-on (the trial message). Never both
  lines.
- Renders nothing when: no connected Instagram account, `tipo === 'stories'`, or the
  post does not target Instagram.

### Placement

- Desktop drawer, single-platform: directly below the Instagram caption field,
  above `TrialReelPanel`.
- Desktop drawer, multiplatform: inside the Instagram tab of
  `DestinationCaptionTabs`, below the caption.
- Phone editor, Publicar tab: in the "Instagram" section, above the trial-reel row.
  That section's gate (`PostEditorBody.tsx:965`, `post.tipo === 'reels' &&
  isInstagramPost(post.platform)`) changes to "any non-stories post targeting
  Instagram, with a connected account"; the trial-reel row inside it keeps its own
  reels-only gate (`TrialReelPanel` self-gates). The section's
  `aria-label="Reel de teste"` (`:966`) becomes `"Instagram"`.

### Mutual exclusion with Reel de teste

`TrialReelPanel` gets a new prop `collaboratorsCount: number`. Precedence of its
disabled reasons: schedule lock first (existing `disabled` prop and its
"Cancelar agendamento para editar" line, unchanged), then collaborators: when
`collaboratorsCount > 0` and the trial is off, the switch is disabled with
"Indisponível com colaboradores no post. Remova os colaboradores para publicar como
teste." (If both a trial and collaborators somehow exist, the DB CHECK forbids it;
render the trial as on and the collaborators field disabled.) The collaborators field
is disabled while the trial is on (above). The DB CHECK is the backstop.

### Self-heal on tipo / platform change

`PostEditorBody` nulls `ig_trial_strategy` at four sites: phone tipo change (`:798`),
phone platform change (`:830`), desktop tipo change (`:1151`), desktop platform
change (`:1181`). At each, also clear `ig_collaborators` when the change makes
collaborators impossible (tipo → stories; platform → tiktok), and show
`toast.info("Colaboradores removidos: Stories não aceitam colaboradores.")` or
`toast.info("Colaboradores removidos: o post não vai mais para o Instagram.")`, only
when the list was non-empty.

Multiplatform (`feature_multiplatform`): removing Instagram goes through
`handleDestinationToggle` (`:452+`) and `usePostDestinations`, and the DB derives
`platform` from `post_targets` (`post_targets_sync_platform`,
`20261010100002:244-277`), so z5 clears the array server-side and the legacy sites
above never run. In the toggle's success path, when Instagram was removed and the
post had collaborators, show the same "o post não vai mais para o Instagram" toast
and make sure the post is refetched/invalidated so the editor drops the stale list.
(The trial flag has the same pre-existing gap; fix it in the same place.)

### Indicators

- `PostsListView` tipo column: after the tipo badge, a "Collab N" pill (info tint,
  `Users` icon) with `title="Colaboradores: @a, @b"`, next to where "Teste" shows.
  Desktop and phone list variants.
- `CalendarPostDetailPanel`: a "Colaboradores" row listing the @usernames.
- Data loading (`store/posts.ts`): `WorkflowPost` type (`:121`), and the column
  lists `CLIENTE_POST_COLUMNS` (`:141`, mapper `:156`), `POST_CONTEXT_COLUMNS`
  (`:365`, mapper `:399`), `ASSIGNED_PENDING_POST_COLUMNS` (`:668`), plus wherever the
  drawer loads the full post. `ig_collaborators_refused` only where the editor and
  error block read the post. Treat `null`/missing as `[]`. Persisting needs no store
  change: `updateWorkflowPost` (`:960-971`) is a raw `.update(p)` with no allowlist.

### Publish error block

`PublishErrorBlock` for `COLLABORATOR_INVALID`: the copy above, plus:
- "Editar colaboradores": focuses the collaborators field (switching to the
  Instagram tab in multiplatform, or the Publicar tab on phone).
- "Publicar sem colaboradores": confirms with an AlertDialog ("Publicar sem
  colaboradores?" / body "O post será publicado só no perfil do cliente." / confirm
  "Publicar sem colaboradores"), then calls
  `retryInstagramPublish(postId, { clearCollaborators: true })`. **Atomic,
  server-side:** the `instagram-publish` `retry` action accepts
  `clearCollaborators: boolean` and sets `ig_collaborators = '{}'` and
  `ig_collaborators_refused = '{}'` **before** the `record_post_status_change`
  reset, while the post is still `falha_publicacao` (no claim phase takes a
  `COLLABORATOR_INVALID` post, so nothing can race it; `record_post_status_change`'s
  `p_fields` allowlist does not include these columns). If the clear fails, the
  handler returns an error and does not reset the status. No
  client-side clear followed by a retry (that races: the async field save and the
  retry reset are separate requests, and the retry could recreate the container with
  the old list). On failure the existing retry error toast shows and nothing changed.
  Success refetches the post like today's retry.

## Hub (client portal)

- `hub-posts` handler: add `ig_collaborators` to its `select` (`:167`), never
  `ig_collaborators_refused`. That select also carries `publish_error`, which the
  Hub renders nowhere; leave it as is (it keeps today's content, which does not
  gain partner names under this design).
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
  (4 items, `{NULL}`, `{'ok',NULL}`, bad chars, uppercase, duplicates,
  trial+collab), the trigger clearing on stories and tiktok-only and clearing
  `ig_collaborators_refused` when the list changes, `duplicate_post` copying the
  field including into a board without Instagram (the `:125` re-apply), the claim
  returning it and skipping `COLLABORATOR_INVALID` on retry, and
  `trg_notify_post_publish_failed` firing for `COLLABORATOR_INVALID`.
- **Deno, error path:** the refused-set computation (exact token, case, empty
  fallback), the `retry` action's `clearCollaborators` clearing both columns in the
  reset update, `validateForScheduling` rejecting the two invalid combinations.
- Update existing tests that build `WorkflowPost` fixtures or assert exact select
  strings / claim shapes (grep both `__tests__` trees for `ig_trial_strategy`).

## Rollout

1. Apply the migration to staging, deploy the changed functions to staging with
   `--use-api` (`instagram-publish-cron` and `hub-posts` with `--no-verify-jwt`, per
   CLAUDE.md; `instagram-publish` as it is deployed today), plus every other function
   that imports a changed `_shared` module (`instagram-publish-utils.ts`,
   `instagram-graph.ts`, `publish-error-codes.ts`; e.g. `hub-approve` imports
   `validateForScheduling`). The plan lists them from a grep.
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
reading the new RPC just ignores the extra column, so migration-first is safe (no
post can hold collaborators before the frontend ships, so an old cron can never
publish a collab post without them). The
new cron against the old RPC would read `ig_collaborators` as undefined and must
treat it as `[]` (code defensively).

## Left to the builder

- Exact component split and prop names; whether the field lives in its own file
  (expected) and how it receives "the client's own username".
- Where the client's connected Instagram username comes from in the editor
  (it may already be on the account status object; if not, the own-account check
  can be skipped rather than adding a fetch).

## Review log

- 2026-10-19, Fable review: folded in the notification trigger list, both
  `duplicate_post` sites, the three handler container sites, the options-object
  builder signature, `acao: 'collaborators'` + `mostrarDetalhes: false`, the exact
  write sites, exact-token matching, z5 trigger ordering, the four self-heal sites
  plus the multiplatform toggle path, deploy flags, failure timing, and the
  `validateForScheduling` check.
- 2026-10-19, Codex review: folded in the `NULL`-member CHECK, the atomic
  server-side "Publicar sem colaboradores", the multiplatform self-heal path, a
  structured `ig_collaborators_refused` column instead of parsing `publish_error`,
  and `TrialReelPanel`'s prop and disabled-state precedence. Nothing rejected.
