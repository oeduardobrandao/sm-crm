# TikTok audit readiness (design)

## Context

The TikTok integration (spec `2026-07-17-tiktok-integration-design.md`) is fully merged and was proven end to end on prod in July with the sandbox app. Since then the platform-agnostic layer shipped (P0-P2, spec `2026-09-29-platform-agnostic-posts-design.md`): TikTok is now a destination on `post_targets`, and with `feature_multiplatform` on, `TikTokSettingsPanel` lives inside the TikTok caption tab.

The app has never been submitted for TikTok's review. Submission needs a demo video of the full flow in the real product (OAuth consent, composer, post landing on the account), recorded with the sandbox app. Reviewers check the composer against TikTok's Content Sharing Guidelines (https://developers.tiktok.com/doc/content-sharing-guidelines). A code and guideline comparison on 2026-10-08 found the gaps listed below.

This is spec 1 of 2. **Spec 2 is P4** of the platform-agnostic spec (TikTok publish state onto `post_targets`). It runs during TikTok's review window and changes nothing a reviewer sees.

## Goal

A reviewer watching the demo video, or testing the app, finds every Content Sharing Guideline met. The flow has no dead ends, misleading copy or silent landings.

## Non-goals

- P4: `mark_target_*` RPCs, target status backfill, claim/cron/webhook rewrite (spec 2).
- `both` post + "Publicar agora": the TikTok side 422s because the Instagram side moved the post to `agendado`. P4 fixes it structurally. TikTok is dark, so no customer can hit it, and the demo uses a TikTok-only post.
- TikTok Business API (comments, extra analytics).
- Launch: flipping `feature_tiktok` on plans, switching to the production app credentials (after approval, see Rollout).

## A. Composer compliance (`TikTokSettingsPanel` + publish surfaces)

Each item cites the guideline it satisfies.

### A1. Commercial content disclosure

Guideline: a master "Content Disclosure Setting" toggle, off by default. When it is on, two checkboxes, "Your brand" and "Branded content", allow multiple selections. Publishing is blocked while the toggle is on and nothing is checked, and hovering explains why. A prompt names the label TikTok will apply.

Today: two independent switches, and only the paid-partnership case shows a label.

New UI:
- Switch **"Divulgação de conteúdo comercial"**, off by default, with the helper "Indique se este conteúdo promove você, uma marca, um produto ou um serviço."
- When on, two checkboxes:
  - **"Sua marca"**, helper "Você está promovendo a si mesmo ou o seu negócio." It maps to `brand_organic_toggle`.
  - **"Conteúdo de marca"**, helper "Você está promovendo outra marca ou um terceiro." It maps to `brand_content_toggle`.
- Label prompt below the checkboxes:
  - Only "Sua marca": "Seu post será rotulado como **Conteúdo promocional**."
  - "Conteúdo de marca", alone or with "Sua marca": "Seu post será rotulado como **Parceria paga**."
- Master on with nothing checked:
  - Inline warning: "Indique se o conteúdo promove você, um terceiro ou ambos."
  - The panel reports incomplete.
  - The disabled publish/schedule buttons show the same text as their tooltip.

State:
- The persisted shape stays `tiktok_settings.brand_organic_toggle` and `brand_content_toggle`, which are TikTok's API field names and are what the publisher reads.
- The master switch is UI state:
  - On mount it is initialized to `brand_organic_toggle || brand_content_toggle`.
  - Turning it off persists both toggles as `false`.
  - Turning it on persists nothing until a checkbox is ticked. So a reopened post with the master on and nothing checked comes back with the master off, which is consistent.

### A2. Branded content cannot be private

Guideline: branded content may only be public or friends. If the user picks "only me", either disable "Branded content" or switch the visibility. If "Branded content" is checked, disable "only me", and hovering explains why.

- Privacy is `SELF_ONLY`:
  - The "Conteúdo de marca" checkbox is disabled.
  - Its tooltip reads "Conteúdo de marca não pode ter visibilidade privada."
- "Conteúdo de marca" is checked:
  - The `SELF_ONLY` item in the privacy dropdown is disabled.
  - Its suffix and tooltip read "A visibilidade de conteúdo de marca não pode ser privada."
- Server defense in depth: `validatePrivacyLevel` in `_shared/tiktok-publish-utils.ts` also rejects `brand_content_toggle && privacy_level === 'SELF_ONLY'` with that message.
- While the app is unaudited, A7 restricts posting to `SELF_ONLY`, so branded content is effectively unavailable in test mode. That is correct and matches TikTok's rules.

### A3. Consent declaration before the publish button

Guideline: before the publish button, a statement that begins "By posting, you agree to TikTok's", linking the Music Usage Confirmation. If "Branded content" is selected, it also links the Branded Content Policy.

Today: a required, ephemeral checkbox inside the panel. With `feature_multiplatform` on, that checkbox sits in the TikTok tab, away from the button. The policy is plain text.

New:
- The declaration becomes a **statement rendered directly above the TikTok publish actions**, on every surface that sends a TikTok post to be published.
- The checkbox is removed. The guideline asks for a statement, and the act of clicking publish/schedule is the consent. Removing it also removes the ephemeral state that forced a re-tick on every open.
- Copy, from `tiktok_settings` at render time:
  - Without branded content: "Ao publicar, você concorda com a [Confirmação de Uso de Música](https://www.tiktok.com/legal/page/global/music-usage-confirmation/en) do TikTok."
  - With branded content: "Ao publicar, você concorda com a [Política de Conteúdo de Marca](https://www.tiktok.com/legal/page/global/bc-policy/en) e a [Confirmação de Uso de Música](…) do TikTok."
- One shared component, `TikTokPostingDeclaration`, exports both URLs as constants. The panel's current `MUSIC_USAGE_CONFIRMATION_URL` moves there.
- Surfaces:
  - `ScheduleButton`, above its actions when the post targets TikTok. This covers the editor and `PublicacoesPanel`.
  - `AutoSchedulePromptDialog` and `AutoScheduleBatchDialog`, above the confirm button, when any post in them targets TikTok.
- Data contract:
  - The component takes `brandedContent: boolean | undefined`.
  - `undefined` (the caller has no settings) renders the **branded variant**, which carries both links. Over-disclosing is compliant; under-disclosing is not.
  - `ScheduleButton` passes `post.tiktok_settings?.brand_content_toggle`.
  - `PublicacoesPanel`'s query (`ScheduledPost`) adds `tiktok_settings`, and `toWorkflowPost` passes it through. Today it strips it.
  - `AutoSchedulePromptPost` gains an optional `tiktok_settings` field, filled where the caller's post object has it.
  - `AutoScheduleBatchDialog` uses the branded variant if any selected TikTok post has `brand_content_toggle` or lacks settings.
- Known limit, documented and not changed: a client approval in the Hub can auto-schedule a post whose TikTok settings the agency already completed. The agency consented when it configured the post. The Hub never sends media without the agency having set the privacy level.

### A4. Content preview

Guideline: show a preview of the content to be posted.

- The panel gets a **"Prévia"** block under the creator header.
- Contents:
  - A horizontal strip of the post's media in order (up to 5 thumbnails, then "+N"). The cover is used for video.
  - A duration badge on each video.
  - The first 2 lines of the caption that will be sent (`tiktok_caption ?? ig_caption`), with an ellipsis.
- Data: `PostEditorBody` already loads `postMedia` (`['post-media', post.id]`) and passes it in through a new `media` prop. The block uses no extra fetch.
- An empty media list shows "Adicione mídia ao post para publicar no TikTok."

### A5. Video duration check

Guideline: check the video against `max_video_post_duration_sec` from creator info.

- For video posts, if any video's `duration_seconds` exceeds `max_video_post_duration_sec`:
  - Inline error: "Este vídeo tem {X}s. O máximo permitido para esta conta é {Y}s."
  - The panel reports incomplete.
- A null `duration_seconds` (legacy upload) doesn't block in the UI.
- Server check (A10): the panel is not the only path to publishing. Hub approval and the auto-schedule dialogs schedule without mounting it, so the authoritative check runs right before TikTok init.

### A6. Creator cannot post right now

Guideline: if creator info says the creator can't post, stop the attempt and tell the user to try later.

Creator info signals this with HTTP 200 and `error.code` set to one of:
- `spam_risk_too_many_posts`
- `spam_risk_user_banned_from_posting`
- `reached_active_user_cap`

`tiktokFetch` throws `TikTokApiError` with that code.

The `creator-info` route in `tiktok-publish/handler.ts` catches those three codes and returns 200 with `{ can_post: false, cannot_post_reason: <code> }` plus the nickname and avatar if available. Today it returns a generic 500. Every successful response includes `can_post: true`.

The panel shows a blocking notice by reason and reports incomplete:
- `spam_risk_too_many_posts`: "Esta conta atingiu o limite diário de publicações do TikTok. Tente novamente amanhã."
- `spam_risk_user_banned_from_posting`: "O TikTok bloqueou novas publicações desta conta. Verifique a conta no app do TikTok."
- `reached_active_user_cap`: "O limite diário de contas publicando pelo Mesaas foi atingido. Tente novamente mais tarde."

The same three codes, when they come from publish init (cron or publish-now) or from the A10 pre-init check, map to those PT-BR sentences in `tiktok_publish_error`, instead of the raw code.

### A10. Pre-init creator check (server, authoritative)

Both init paths call creator_info with the token they already hold, immediately before `/post/publish/.../init/`: the cron `init` phase (`tiktok-publish-cron/core.ts`) and publish-now (`tiktok-publish/handler.ts`). One shared helper, `checkCreatorBeforeInit` in `_shared/tiktok-publish-utils.ts`, implements it.

- **A cannot-post code** (A6): fail through `markTikTokPublishFailed` with A6's PT-BR sentence.
  - `spam_risk_too_many_posts` and `reached_active_user_cap` are daily caps, so they stay retryable. The cron's existing 3-retry budget picks them up on a later run.
  - `spam_risk_user_banned_from_posting` is non-retryable.
- **A video post whose longest `duration_seconds` exceeds `max_video_post_duration_sec`:** fail non-retryably with "O vídeo tem {X}s. O máximo permitido para esta conta no TikTok é {Y}s."
- **The privacy level is no longer in `privacy_level_options`**, for example because the account went private after scheduling: fail non-retryably with "A privacidade escolhida não está mais disponível para esta conta. Escolha outra e agende de novo."
- **Any other creator_info error** (network, 5xx, rate limit): do not fail the post. Skip the check and proceed to init, which surfaces real problems itself.
  - This is a deliberate fail-open: the check adds a guard and must not add an outage dependency.
- **Cost:** one extra call per publish. TikTok allows 20 requests per minute per user token, and the cron publishes at most a handful per account per run.

### A7. Test mode, shown up front

Guideline: unaudited clients may only post `SELF_ONLY`. Spec `2026-07-17` (L123, L196) already intended the lock to be shown up front. The code only reacts after a 422.

- `creator-info` returns `app_audited: boolean` (`Deno.env.get('TIKTOK_APP_AUDITED') === 'true'`).
- When `app_audited` is false:
  - The test-mode banner is always visible: "App em modo de teste: até a aprovação do TikTok, as publicações saem como privadas (Somente eu)."
  - Every privacy option other than `SELF_ONLY` stays listed but is disabled, suffixed "disponível após a aprovação do app". The dropdown still mirrors `privacy_level_options`, and there is still no default.
- The reactive 422 path in `ScheduleButton` stays as a fallback for stale clients.

### A8. "May take a few minutes" notice

Guideline: tell users the content may take a few minutes to process and appear on the profile.

- After a successful TikTok publish-now, whether `published` or `processing`, the toast reads: "Enviado ao TikTok. Pode levar alguns minutos para aparecer no perfil."
- `PlatformStatusRow` in `ScheduleButton` shows "Processando no TikTok. Pode levar alguns minutos." while the TikTok state is `initiated` or `processing`.

### A9. Already compliant (no change, re-verified 2026-10-08)

- creator_info is fetched fresh on every panel mount, with `no-store`.
- The nickname is shown.
- The privacy dropdown has no default and its options come from `privacy_level_options`.
- Comment, Duet and Stitch are unchecked by default and disabled per creator. Photo posts only show Comment.
- The caption and title are editable.
- No watermark is applied to media.
- Status is followed through the cron status phase and the webhook.

## B. Flow fixes a reviewer would hit

- **B1. Connect landing.**
  - Problem: `tiktok-integration` `handleCallback` redirects to `/clientes/{id}` with no param, so the user lands on Visão geral silently.
  - Fix:
    - Redirect with `?tt_connected=1`.
    - `ClienteDetalheIndexRedirect` adds `tt_connected` to its OAuth param list.
    - `RedesSociaisTab` toasts "Conta do TikTok conectada.", fires a `tiktok_connected` PostHog capture and strips the param.
    - All three happen **inside the tab's existing consolidated OAuth-param effect** (`RedesSociaisTab.tsx:33-97`), which exists because separate `useSearchParams` effects raced and left params stuck in the URL. There is no separate TikTok hook. The strip removes `tt_connected` in the same `setSearchParams` call as the other params.
- **B2. Auth URL errors.**
  - Problem: `getTikTokAuthUrl` reads `data.message`, but the gate answers `{ error: 'feature_disabled' }`.
  - Fix: map `feature_disabled` to "O TikTok não está disponível no seu plano." and otherwise use `data.error ?? data.message`.
- **B3. ScheduleButton copy and color.**
  - The missing-caption reason says "legenda do Instagram" on TikTok-only posts. The reason names the platform(s) whose caption is actually empty.
  - The publish button uses Instagram pink for every platform. Pink stays for Instagram-only posts; any post with TikTok uses the neutral primary button.
- **B4. Dead nav entry.**
  - Remove `analytics-tiktok` from `nav-data.ts`, along with its i18n keys, its CSS and its `nav-data.test.ts` expectation. It has no route and would resolve to `/analytics/tiktok`.
  - The superseded branch `feat/tiktok-nav-coming-soon` is deleted by the owner (local and remote).
- **B5. Photo post URL.**
  - Problem: `tiktok_post_url` is built as `/@user/video/{id}` for every post type.
  - Fix: photo posts (`feed`, `carrossel`) use `/@user/photo/{id}`. A shared helper `buildTikTokPostUrl(username, id, tipo)` replaces the three builders:
    - `tiktok-publish/handler.ts:453`
    - `_shared/tiktok-publish-utils.ts:626`
    - `tiktok-webhook/handler.ts:269`
  - The `tipo` has to reach all three completion paths:
    - **Publish-now** already loads the post. It passes `tipo`.
    - **Cron status confirmation:** `ConfirmAndApplyPublishStatusPost` (`_shared/tiktok-publish-utils.ts:565`) gains `tipo`. The claim `claim_posts_for_tiktok_publishing` already returns it (`20260830000002:146,192`), so `tiktok-publish-cron/core.ts:283` only passes it on. No migration.
    - **The `publicly_available` webhook** adds `tipo` to its post select (`tiktok-webhook/handler.ts:117-124`).
- **B6. Drop the unused `video.upload` scope.**
  - `TIKTOK_SCOPES` (`_shared/tiktok.ts:13`) requests it, but only `DIRECT_POST` (`video.publish`) is used; the inbox/draft mode is never called.
  - Requesting a scope the demo doesn't show is a common rejection reason.
  - Tokens already issued keep working; they just carry an extra grant.
  - This is an implementation step before recording. Update `TIKTOK_SCOPES`, plus any test or fixture that asserts the auth URL's `scope` parameter (`tiktok-integration_test.ts`, `tiktok-shared_test.ts`).

## C. Demo and submission kit (owner tasks)

### C1. Demo environment (prod, sandbox credentials)

1. Workspace DK TESTE override. The table is keyed by `workspace_id`, and `feature_overrides` may be NULL:
   ```sql
   insert into workspace_plan_overrides (workspace_id, plan_id, feature_overrides)
   values ('<DK TESTE workspace_id>', '<its current plan_id>',
           '{"feature_tiktok": true, "feature_post_scheduling": true, "feature_multiplatform": true}')
   on conflict (workspace_id) do update
   set feature_overrides = coalesce(workspace_plan_overrides.feature_overrides, '{}'::jsonb)
     || excluded.feature_overrides,
       updated_at = now();
   ```
   Or set the same three keys in the Admin workspace page's overrides editor. Afterwards, check `workspace-limits` for the workspace returns all three as `true`.
2. A board in DK TESTE with `plataformas = {tiktok}` or `{instagram,tiktok}`. Existing boards are `{instagram}` and new posts only seed TikTok from the board.
3. Set the TikTok test account to **private** in the TikTok app, which unaudited posting requires.
4. Reconnect the account during the recording. The expired token from July is irrelevant, and the video must show the OAuth consent screen anyway.

### C2. Demo script (one take, under 50 MB, 1080p screen recording)

1. Cliente → Redes sociais → "Conectar TikTok" → TikTok consent screen showing the requested scopes → back in Mesaas, with the toast (B1).
2. The TikTok section with the imported videos and follower metrics. This demonstrates `video.list`, `user.info.basic`, `user.info.profile` and `user.info.stats`.
3. Entregas → the TikTok board → open a post (video, `reels`) → TikTok tab:
   - the creator nickname
   - the preview (A4) and the duration limit
   - the privacy dropdown with no default, set to "Somente eu"
   - the interaction checkboxes, unchecked
   - the disclosure toggle demonstrated on and off (A1)
   - the test-mode banner (A7)
4. Mark the post approved, then show the declaration (A3) above the publish button → "Publicar agora".
5. The status chip goes "Publicando" → "Publicado", with the "pode levar alguns minutos" notice (A8).
6. Cut to the TikTok app: the post appears on the account as private.
7. Optional: a scheduled post shows the same composer, then the cron publishes it.

### C3. Portal submission (developers.tiktok.com → Manage apps)

- **App description:** EN, from the 2026-08-20 dossiê (https://claude.ai/code/artifact/0444d973-63e3-4cdd-8888-de8c0fad397b).
- **Scope justifications:** one line each for `user.info.basic`, `user.info.profile`, `user.info.stats`, `video.list`, `video.publish`. Every scope must appear in the video. B6 drops `video.upload`.
- **Policy pages:** Terms of Service at https://mesaas.com.br/termos-de-uso, Privacy at https://mesaas.com.br/politica-de-privacidade.
- **Redirect URI:** must exactly match `TIKTOK_REDIRECT_URI`.
- **URL-prefix verification:** the `tiktok-media` proxy host, already verified in July.
- **Usage estimates:** these become the caps after the audit. Estimate from the expected number of paying TikTok workspaces, with headroom.

### C4. After approval

1. Set `TIKTOK_APP_AUDITED=true`, then redeploy `tiktok-publish` and `tiktok-publish-cron`. `creator-info` lives in `tiktok-publish`.
2. Switch to the production app's `TIKTOK_CLIENT_KEY`/`TIKTOK_CLIENT_SECRET`. The production portal config uses the same redirect URI and URL prefix. Existing sandbox-issued tokens stop working, so the connected accounts reconnect.
3. Launch (flipping `feature_tiktok` per plan) is a separate decision.

## Deploy order

No migration. Edge functions go out before merge, because merge deploys the frontend:

| Function | Why | Flag |
|---|---|---|
| `tiktok-publish` | A2 server check, A6, A7, A10, B5 | keeps `verify_jwt=true` |
| `tiktok-publish-cron` | A2 via utils, A6 messages, A10, B5 | `--no-verify-jwt` |
| `tiktok-webhook` | B5 | `--no-verify-jwt` |
| `tiktok-integration` | B1, B6 | `--no-verify-jwt` |

The new response fields are additive (`can_post`, `app_audited`). The frontend treats missing fields as `can_post: true` and `app_audited: true`, which is today's behavior, so either deploy order is safe.

## Testing

- **Vitest, `TikTokSettingsPanel`:**
  - disclosure master/checkbox rules and label prompts
  - `SELF_ONLY` and branded mutual disabling
  - the duration error
  - the `can_post:false` notices
  - unaudited: options disabled and the banner always shown
  - preview rendering, including the empty state
  - completeness transitions
- **Vitest, `TikTokPostingDeclaration`:** both copies and the links.
- **Vitest, `ScheduleButton`:**
  - the declaration only when TikTok is targeted
  - per-platform missing-caption copy
  - the button variant
  - the processing notice
  - the toast after publish-now
- **Vitest, auto-schedule dialogs:** the declaration shows when TikTok is present.
- **Vitest, connect flow:** `ClienteDetalheIndexRedirect` and `RedesSociaisTab` (`tt_connected` toast and strip).
- **Vitest, `services/tiktok`:** `feature_disabled` mapping. Also the nav-data test.
- **Deno:**
  - `creator-info` with `can_post` per code, `app_audited`, and the other errors still 500
  - the validator's branded + `SELF_ONLY` rule
  - `buildTikTokPostUrl` per tipo across all three call sites
  - init failure messages for the three codes
  - `checkCreatorBeforeInit` in both init paths: can't-post codes (retryable vs. not), duration over the limit, privacy no longer offered, fail-open on other errors
  - the status-confirmation path receives `tipo`
- **Browser (local, creator-info stubbed):** walk C2 steps 3-5 in light and dark, and check that the panel works at drawer widths.
