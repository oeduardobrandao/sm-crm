# TikTok audit readiness (design)

## Context

- The TikTok integration (spec `2026-07-17-tiktok-integration-design.md`) is fully merged, and was proven end to end on prod in July with the sandbox app.
- Since then the platform-agnostic layer shipped (P0-P2, spec `2026-09-29-platform-agnostic-posts-design.md`):
  - TikTok is now a destination on `post_targets`.
  - With `feature_multiplatform` on, `TikTokSettingsPanel` lives inside the TikTok caption tab.
- The app has never been submitted for TikTok's review.
  - Submission needs a demo video of the full flow in the real product (OAuth consent, composer, post landing on the account), recorded with the sandbox app.
  - Reviewers check the composer against TikTok's Content Sharing Guidelines (https://developers.tiktok.com/doc/content-sharing-guidelines).
  - A code-and-guideline comparison on 2026-10-08 found the gaps below.
- Codex and Fable reviews are folded in.

This is spec 1 of 2. **Spec 2 is P4** of the platform-agnostic spec (TikTok publish state onto `post_targets`). It runs during TikTok's review window and changes nothing a reviewer sees.

## Goal

A reviewer watching the demo video, or testing the app, finds every Content Sharing Guideline met. The flow has no dead ends, misleading copy or silent landings.

## Non-goals

- **P4:** `mark_target_*` RPCs, target status backfill, rewriting the claim, cron and webhook (spec 2).
- **"Publicar agora" on a post going to Instagram and TikTok (`both`):** the TikTok side 422s because the Instagram side already moved the post to `agendado`.
  - P4 fixes this structurally.
  - TikTok is dark, so no customer can hit it, and the demo uses a TikTok-only post.
- **Per-platform validation in `hub-approve`:** P5 of the platform spec. Until then, A10 is the guard for TikTok posts that a Hub approval schedules.
- **TikTok Business API** (comments, extra analytics).
- **Launch:** flipping `feature_tiktok` on plans and switching to production app credentials. Both happen after approval (C4).

## A. Composer compliance

Each item cites the guideline it satisfies. Copy is pt-BR with no em dashes.

### A0. Panel completeness contract

Today `onCompletenessChange(complete: boolean)` is a bare boolean (`TikTokSettingsPanel.tsx:144`, `PostEditorBody.tsx:247`, `ScheduleButton.tsx:158-163`). The disabled button carries a fixed `title`.

The new contract is `onReadinessChange({ complete: boolean; reason?: string })`, computed by a pure module (`apps/crm/src/pages/entregas/tiktokComposerRules.ts`, `computeTikTokReadiness`):

```
complete = !loading && !loadError && canPost && privacyChosen
           && mediaReady && !disclosureIncomplete && !durationExceeded
           && !brandedPrivateConflict && !mediaLost
```

- `mediaReady` means the `['post-media']` query has resolved. Media readiness fails closed:
  - While media is loading, the panel is incomplete with `reason` "Carregando mídias do post…".
  - If the query fails, `reason` is "Não foi possível carregar as mídias. Reabra o post." A failed query is never treated as "no media".
  - The panel receives `media: PostMedia[] | undefined` plus `mediaError: boolean`.

- `PostEditorBody` destructures `{ data: postMedia, isError: postMediaError }` and passes `media={postMedia}` (never `?? []`) and `mediaError={postMediaError}`.
- `canPost = creatorInfo.can_post !== false && !(creatorInfo.app_audited === false && privacy_level_options includes 'PUBLIC_TO_EVERYONE')`. When both fail, the A6 sentence wins (the account cannot post at all).
- Rules are evaluated in this order; `reason` is the first failing rule's sentence:
  1. `loading`: "Carregando informações do criador no TikTok…"
  2. `loadError`: the panel's existing error message
  3. `can_post === false`: the A6 sentence
  4. unaudited + public account: the A7 sentence
  5. media query failed: "Não foi possível carregar as mídias. Reabra o post."
  6. media loading: "Carregando mídias do post…"
  7. no media / lost media: the A4 sentences
  8. no privacy: "Escolha a privacidade do post no TikTok."
  9. disclosure incomplete (A1), branded + private (A2), duration (A5)
- `ScheduleButton` gains `tiktokIncompleteReason?: string` (kept alongside `tiktokSettingsComplete` and `tiktokIncompleteTooltip`, so `PublicacoesPanel` is unchanged). The reason replaces the `'configurações do TikTok'` fragment in the "Falta:" list, with its first letter lowercased and its final period dropped.
- `loading`/`loadError` now block. The guideline requires the latest creator info, and today a failed creator_info call does not block (`TikTokSettingsPanel.tsx:225-231`).
- `musicConfirmed` leaves the formula (A3).
- The `PostEditorBody.tsx:242-246` comment that mentions the ephemeral music confirmation is rewritten.
- **Tooltips:** disabled controls don't show hover tooltips reliably. Radix `SelectItem[data-disabled]` has `pointer-events: none` (`components/ui/select.tsx:109`), and `title` on a disabled `<button>` is unreliable. So every "hover explains why" rule is met two ways:
  - visible text: the inline warning plus the "Falta:" line
  - for the disabled publish/schedule buttons, the `Tooltip` primitive wrapped around a `<span>` that holds the button

### A1. Commercial content disclosure

**Guideline.**
- A master "Content Disclosure Setting" toggle, off by default.
- When on, two checkboxes, "Your brand" and "Branded content". Both can be selected.
- Publishing is blocked while the toggle is on and nothing is checked, and hovering explains why.
- A prompt names the label TikTok will apply.

**Today:** two independent switches, and only the paid-partnership case shows a label.

**New UI:**
- A switch **"Divulgação de conteúdo comercial"**, off by default. Helper: "Indique se este conteúdo promove você, uma marca, um produto ou um serviço."
- When on, two checkboxes:
  - **"Sua marca"**, helper "Você está promovendo a si mesmo ou o seu negócio." Maps to `brand_organic_toggle`.
  - **"Conteúdo de marca"**, helper "Você está promovendo outra marca ou um terceiro." Maps to `brand_content_toggle`.
- The label prompt below them:
  - only "Sua marca": "Seu post será rotulado como **Conteúdo promocional**."
  - any selection that includes "Conteúdo de marca": "Seu post será rotulado como **Parceria paga**."
- Master on with nothing checked:
  - inline warning, which is also the A0 `reason`: "Indique se o conteúdo promove você, um terceiro ou ambos."
  - the panel is incomplete

**State:**
- The persisted shape stays `tiktok_settings.brand_organic_toggle` and `brand_content_toggle`, TikTok's API field names, read by the publisher.
- The master switch is UI state:
  - initialized on mount to `brand_organic_toggle || brand_content_toggle`
  - turning it off persists both toggles as `false`
  - turning it on persists nothing until a checkbox is ticked

### A2. Branded content cannot be private

**Guideline:**
- Branded content is public or friends only.
- If "only me" is chosen, disable "Branded content".
- If "Branded content" is checked, disable "only me" and explain why.

**When the app is audited (`app_audited === true`):**
- With privacy `SELF_ONLY`, the "Conteúdo de marca" checkbox is disabled. Its helper line reads "Conteúdo de marca não pode ter visibilidade privada."
- With "Conteúdo de marca" checked, the `SELF_ONLY` dropdown item is disabled and suffixed "(não disponível para conteúdo de marca)".
- Legacy rows that already have `brand_content_toggle && privacy_level === 'SELF_ONLY'`:
  - show the inline error "A visibilidade de conteúdo de marca não pode ser privada."
  - the panel is incomplete (`brandedPrivateConflict`)

**When the app is unaudited:** only `SELF_ONLY` can post (A7), so branded content is impossible.
- "Conteúdo de marca" is disabled, suffixed "(disponível após a aprovação do app)".
- This avoids a dead end. Otherwise ticking it first would disable `SELF_ONLY`, while A7 already disables everything else.
- A legacy conflict row shows the same A2 inline error.
- In both modes, an already-checked "Conteúdo de marca" checkbox stays uncheckable even when its disabled rule applies, so a legacy conflict row can always be cleared.

**Server, defense in depth:** `validatePrivacyLevel` (`_shared/tiktok-publish-utils.ts`) rejects `brand_content_toggle && privacy_level === 'SELF_ONLY'` with "A visibilidade de conteúdo de marca não pode ser privada."

### A3. Consent declaration before the publish button

**Guideline:** before the publish button, show a statement that begins "By posting, you agree to TikTok's" and links the Music Usage Confirmation. When "Branded content" is selected, it also links the Branded Content Policy.

**Today:**
- A required, ephemeral checkbox inside the panel.
- With `feature_multiplatform` on, it sits in the TikTok tab, away from the button.
- The policy is plain text.

**New:** a statement, `TikTokPostingDeclaration`. It replaces the checkbox, because clicking publish or schedule is the consent.
- Without branded content: "Ao publicar, você concorda com a [Confirmação de Uso de Música](https://www.tiktok.com/legal/page/global/music-usage-confirmation/en) do TikTok."
- With branded content: "Ao publicar, você concorda com a [Política de Conteúdo de Marca](https://www.tiktok.com/legal/page/global/bc-policy/en) e a [Confirmação de Uso de Música](…) do TikTok."
- Both URLs are exported constants. The panel's `MUSIC_USAGE_CONFIRMATION_URL` moves there.
- Prop `brandedContent: boolean | undefined`. `undefined` (the caller has no settings) renders the branded variant: over-disclosing is compliant, under-disclosing is not.

**Placement**, always directly above the control that sends:
- **`ScheduleButton`, row:** above the "Agendar" / "Publicar agora" row when the post targets TikTok. "Agendar" sends.
- **`ScheduleButton`, publish-now dialog:** inside `AlertDialogContent`, above `AlertDialogFooter`, when the post targets TikTok. "Publicar agora" (`ScheduleButton.tsx:576-585`) only opens the dialog; its "Publicar" (`:636-641`) is what sends.
- **`AutoSchedulePromptDialog` and `AutoScheduleBatchDialog`:** above the confirm button, when any post in them targets TikTok.
- **"Tentar novamente" (`ScheduleButton` retry, `PublishErrorBlock`):** no declaration. A retry re-sends the same content whose consent was given at the original send; recorded deliberately.

**Data:**
- `ScheduleButton` passes `post.tiktok_settings?.brand_content_toggle`.
- `AutoSchedulePromptPost` gains an optional `tiktok_settings`, filled where the caller's post object has it.
- The batch dialog uses the branded variant if any selected TikTok post has `brand_content_toggle` or has no settings.
- In `ScheduleButton` the declaration renders only while the TikTok gate is open (the post targets TikTok and `tiktokSettingsComplete` is true), i.e. only when a click actually sends. Blocked states show the "Falta:" line instead, as in the mockups.
- `PublicacoesPanel` is left as is: it mounts `ScheduleButton` with `tiktokSettingsComplete={false}` (`PublicacoesPanel.tsx:114-115`), so TikTok posts never publish from there and no declaration renders.

**Hub approval:** it schedules without any of these surfaces.
- `hub-approve` validates only Instagram (`hub-approve/handler.ts:277`).
- A10 is the guard: a TikTok post whose settings are incomplete fails before any media reaches TikTok.

### A4. Content preview

**Guideline:** show a preview of the content to be posted.

A **"Prévia"** block under the creator header shows:
- The post's media in order, up to 5 thumbnails, then "+N". Videos use the cover.
- A duration badge on each video.
- The first 2 lines of the caption that will be sent (`tiktok_caption ?? ig_caption`), with an ellipsis.

Data:
- `PostEditorBody` already loads `postMedia` (`['post-media', post.id]`, `:228-233`) and passes it through a new `media` prop. There is no extra fetch.

Blocking states (`mediaLost`):
- No media: "Adicione mídia ao post para publicar no TikTok."
- Any item with `media_lost_at != null`: "Uma das mídias deste post foi perdida. Substitua-a antes de publicar."

### A5. Video duration check

**Guideline:** check the video against `max_video_post_duration_sec`.

- For video posts, the check fails if any video's `duration_seconds` exceeds the limit (`durationExceeded`):
  - inline error: "Este vídeo tem {X}s. O máximo permitido para esta conta é {Y}s." (the same sentence A10 rule 4 stores)
  - the panel is incomplete
- A null `duration_seconds` (legacy upload) doesn't block the UI.
- The authoritative check is A10, because Hub approval and the auto-schedule dialogs never mount the panel.

### A6. Creator cannot post right now

**Guideline:** if creator info says the creator can't post, stop and tell the user to try later.

**Signal:**
- creator_info answers HTTP 200 with one of these `error.code` values:
  - `spam_risk_too_many_posts`
  - `spam_risk_user_banned_from_posting`
  - `reached_active_user_cap`
- `tiktokFetch` throws `TikTokApiError` with that code (`_shared/tiktok.ts:149-158`).
- No `data` comes with it, so there is no nickname or avatar either.

**`creator-info` route (`tiktok-publish/handler.ts`):**
- catches the three codes and returns 200 `{ can_post: false, cannot_post_reason: <code>, app_audited }`; today it returns a generic 500
- every successful response adds `can_post: true`
- other errors stay 500

**The panel:**
- with `can_post: false`, shows the notice below in place of the nickname header, and is incomplete
- treats a missing `can_post` as `true` (older deploy)

**pt-BR map.** It lives in one runtime-neutral module, `supabase/functions/_shared/tiktok-messages.ts`: pure data and functions, no Deno or npm imports.
- The CRM imports it through a `@mesaas/tiktok-messages` alias wired exactly like `@mesaas/platforms` (`apps/crm/vite.config.ts:21`, `apps/crm/tsconfig.json:13`, `vitest.config.ts:17`).
- The edge functions import it relatively.
- Besides the code map it exports every sentence shared by client and server, so each has exactly one source: `TIKTOK_MSG.privacyMissing`, `privacyMismatch`, `brandedPrivate` (A2 panel and `validatePrivacyLevel`), `mediaLost` and `mediaMissing` (A4 and A10), `publicAccountInTestMode` (A7) and `durationExceeded(x, y)` (A5 and A10).

The map:

| Code | Message |
|---|---|
| `spam_risk_too_many_posts` | Esta conta atingiu o limite diário de publicações do TikTok. Tente novamente amanhã. |
| `spam_risk_user_banned_from_posting` | O TikTok bloqueou novas publicações desta conta. Verifique a conta no app do TikTok. |
| `reached_active_user_cap` | O limite diário de contas publicando pelo Mesaas foi atingido. Tente novamente mais tarde. |
| `unaudited_client_can_only_post_to_private_accounts` | Em modo de teste, a conta do TikTok precisa estar privada. Altere no app do TikTok e tente novamente. |
| `privacy_level_option_mismatch` | A privacidade escolhida não está disponível para esta conta. Escolha outra e tente novamente. |
| `url_ownership_unverified` | O TikTok não reconheceu o endereço da mídia. Fale com o suporte. |

**Publish failures:**
- When these codes come from publish init, the stored `tiktok_publish_error` is the pt-BR sentence, not TikTok's raw English. This covers the cron init catch (`tiktok-publish-cron/core.ts:242`) and the publish-now catch (see A10, Publish-now).
- **All of them fail non-retryably** (`retry_count = 3`). The init catch passes `{ failReason: err.code }` when `err instanceof TikTokApiError`, which today it doesn't, so `spam_risk_*` is retried 3 times. The code joins the non-retryable path of `markTikTokPublishFailed`.
- The retry claim has no backoff. The cron runs every minute, so retrying a daily cap would burn 3 retries in about 3 minutes.
- Manual "Tentar novamente" still works later. The retry route resets `tiktok_publish_status` to NULL (`tiktok-publish/handler.ts:325-329`), and the init claim does not filter on `retry_count`.

### A7. Test mode, shown up front

**Guideline:** unaudited clients can only post `SELF_ONLY`. Spec `2026-07-17` (L123, L196) intended the lock to be visible up front; today the code only reacts after a 422.

- `creator-info` returns `app_audited: boolean`, which is `Deno.env.get('TIKTOK_APP_AUDITED') === 'true'`.
- When `app_audited` is false:
  - A test-mode banner is always visible: "App em modo de teste: até a aprovação do TikTok, as publicações saem como privadas." The privacy option label stays the existing `PRIVACY_LABELS.SELF_ONLY`.
  - Every option other than `SELF_ONLY` stays listed but disabled, suffixed "(disponível após a aprovação do app)". The dropdown still mirrors `privacy_level_options`, still with no default.
  - "Conteúdo de marca" is disabled (A2).
  - If `privacy_level_options` includes `PUBLIC_TO_EVERYONE`, the account is public and unaudited posting will fail. TikTok only offers that option to public accounts. Show a blocking warning that is also the A0 `reason` (`canPost` false): "Em modo de teste, a conta do TikTok precisa estar privada. Altere no app do TikTok e reabra o post."
- The reactive 422 path in `ScheduleButton` stays as a fallback for stale clients. The banner renders when `creatorInfo?.app_audited === false || showTestModeBanner`; the prop and `onTikTokUnaudited` stay.

### A8. "May take a few minutes" notice

**Guideline:** tell users the content may take a few minutes to appear on the profile.

- After a successful TikTok publish-now, whether the result is `published` or `processing`, the toast reads: "Enviado ao TikTok. Pode levar alguns minutos para aparecer no perfil."
- While the TikTok state is `initiated` or `processing`, `PlatformStatusRow` (the chip row inside `ScheduleButton.tsx:95-128`) shows a `text-xs` line under the chips: "Processando no TikTok. Pode levar alguns minutos."

### A9. Already compliant (no change, re-verified 2026-10-08)

- creator_info is fetched fresh on every panel mount, with `no-store`.
- The nickname is shown.
- The privacy dropdown has no default, and its options come from `privacy_level_options`.
- Comment, Duet and Stitch:
  - unchecked by default, disabled per creator
  - photo posts only show Comment
  - on a private account, creator_info reports duet and stitch disabled, so they render greyed out, which is correct
- Caption and title are editable.
- No watermark.
- Status is followed through the cron status phase and the webhook.

### A10. Pre-init creator check (server, authoritative)

A new `_shared/tiktok-precheck.ts` holds `fetchCreatorCheck(tiktokFetch, token)` (creator_info with the token already held, right before `/post/publish/.../init/`), `fetchPrecheckMedia(svc, postId)` and the pure `evaluateTikTokPrecheck({ tipo, settings, media, creator })`.

Where it runs:
- **Cron `init` phase:** once per account per run. The cron already groups by account (`tiktok-publish-cron/core.ts:172-192`, `MAX_INIT_PER_ACCOUNT = 5`). The one response is applied to each of that account's posts.
- **Publish-now:** once, inside the claimed `try` in `tiktok-publish/handler.ts`, after the token is fetched and before media URLs are built. It reuses `validation.media` (the validator now selects `media_lost_at`) instead of `fetchPrecheckMedia`. A failure throws a `TikTokUserFacingError(message)`. The existing catch (`:497-535`) gains one branch: for that error, or a `TikTokApiError` whose code is in the A6 map, it stores the pt-BR sentence, sets `tiktok_publish_retry_count = 3`, keeps its own `record_post_status_change` (`workspace_user` + actor), and returns **422 `{ error: <sentence> }`**, which `ScheduleButton` toasts. All other errors keep today's `+1` and generic 500.

**Media contract.** In the cron, `fetchPrecheckMedia` runs its own query:

```
post_file_links → files!inner(kind, duration_seconds, media_lost_at)
  where post_id = …
```

The cron's existing `fetchPostMedia()` (`_shared/instagram-publish-utils.ts:345`) selects neither `duration_seconds` nor `media_lost_at`, and stays as it is. The scheduling validator (`validateForTikTokScheduling`) also adds `media_lost_at` to its select and rejects lost media.

Rules, in order. In the cron every failure goes through `markTikTokPublishFailed(..., { nonRetryable: true })` with the pt-BR message; publish-now uses its own catch (above):

1. **`privacy_level` missing** in `tiktok_settings`, as with a Hub-approved post whose agency never opened the panel: "Configurações do TikTok incompletas. Abra o post e defina a privacidade."
2. **A cannot-post code:** the A6 sentence.
3. **`privacy_level` not in `privacy_level_options`:** the `privacy_level_option_mismatch` sentence.
4. **A video post whose longest `duration_seconds` exceeds `max_video_post_duration_sec`:** the A5 sentence, "Este vídeo tem {X}s. O máximo permitido para esta conta é {Y}s."
5. **No media:** "Adicione mídia ao post para publicar no TikTok." **Any media with `media_lost_at` set:** "Uma das mídias deste post foi perdida. Substitua-a antes de publicar."

Rules 1 and 5 need no creator_info and always run, before rules 2-4 (the evaluator checks 1, then 5, then 2-4). Rules 2-4 run only when creator_info answered.

On any other creator_info error:
- **Network, 5xx or rate limit:** fail open. Skip the check and proceed to init, which surfaces real problems itself. The check is a guard and must not become an outage dependency.
- **`TOKEN_INVALID` or `REVOKED`:** `fetchCreatorCheck` rethrows. In the cron, every post of that account is marked failed with `tokenErrorMessage(err)`, retryable (`+1`), exactly like the `getFreshTikTokToken` catch (`core.ts:184-192`). In publish-now it falls through to the generic catch.

## B. Flow fixes a reviewer would hit

- **B1. Connect landing.**
  - `tiktok-integration` `handleCallback` redirects to `/clientes/{id}?tt_connected=1`; today it redirects with no param and lands silently on Visão geral.
  - `ClienteDetalheIndexRedirect` adds `tt_connected` to its OAuth param list.
  - Inside the existing consolidated OAuth-param effect in `RedesSociaisTab` (`:33-97`), `RedesSociaisTab`:
    - toasts "Conta do TikTok conectada." via a new i18n key `detail.ttConnected` (pt and en `clients.json`, next to `detail.ttError`)
    - fires a `tiktok_connected` PostHog capture
    - removes `tt_connected` in the same `setSearchParams` call as the other params
  - There is no separate hook: separate `useSearchParams` effects race (documented there).
- **B2. Auth URL errors.**
  - `getTikTokAuthUrl` maps `data.error === 'feature_disabled'` to "O TikTok não está disponível no seu plano."
  - Otherwise it uses `typeof data.error === 'string' ? data.error : data.message`. Non-gate errors are `{ error: true, message }` (`tiktok-integration/handlers.ts:101,113`).
- **B3. ScheduleButton copy and color.**
  - Copy: the missing-caption reason names the platform or platforms whose caption is empty. Today it says "legenda do Instagram" even on TikTok-only posts (`:548`).
  - Color: Instagram pink `#E1306C` stays only on Instagram-only posts. Any post targeting TikTok uses an inverted ink style, `background: var(--text-main); color: var(--bg-color)` (dark on light, light on dark; the default `Button` variant is the yellow primary and would match "Agendar"), on four spots:
    - the row button (`:581`)
    - the dialog confirm (`:638`)
    - the progress bar below 100% (`:627`)
    - the `agendado` "Publicando…" pill (`:450-455`), as `var(--surface-hover)` background with `var(--text-main)` text
  - "Agendar" keeps `#eab308`.
- **B4. The "TikTok · Em breve" analytics nav item.**
  - `nav-data.ts:174-181` renders a disabled "TikTok" entry tagged "Em breve" in the sidebar.
  - In a demo of a working TikTok integration it contradicts what the video shows, so it is removed with its `nav.tiktok` i18n key (`common.json:22`, used only there) and its `nav-data.test.ts` expectation.
  - `sidebar.comingSoon` and the generic disabled branch in `Sidebar.tsx` / `MobileNav.tsx` stay.
  - The `sidebar-sub-link--disabled` CSS is generic and stays.
- **B5. Photo post URL.**
  - Today `tiktok_post_url` is always built as `/@user/video/{id}`.
  - Photo posts (`feed`, `carrossel`) switch to `/@user/photo/{id}`.
    - This format is not in TikTok's API docs. Verify it against a real photo post on the July test account before relying on it, and keep `/video/` if it doesn't resolve.
  - A shared `buildTikTokPostUrl(username, id, tipo)` replaces the three builders:
    - `tiktok-publish/handler.ts:453`
    - `_shared/tiktok-publish-utils.ts:626`
    - `tiktok-webhook/handler.ts:269`
  - `tipo` reaches all three completion paths:
    - **publish-now** already loads the post
    - **cron status confirmation:** `ConfirmAndApplyPublishStatusPost` (`_shared/tiktok-publish-utils.ts:565`) gains `tipo`; the TikTok claim already returns it (`20260830000002:146,192`), and `tiktok-publish-cron/core.ts:282-290` passes it on
    - **the `publicly_available` webhook** adds `tipo` to its post select (`:117-124`) and to its `FoundPost` type
- **B6. Drop the unused `video.upload` scope.**
  - `TIKTOK_SCOPES` (`_shared/tiktok.ts:13`) requests it, but only `DIRECT_POST` (`video.publish`) is used.
  - Requesting a scope the demo doesn't show is a common rejection reason.
  - The callback only stores `scope.split(",")` (`handlers.ts:214`), and nothing compares granted scopes, so existing tokens keep working.
  - Update `TIKTOK_SCOPES`. No existing test asserts it; the B6 test in Testing is new.
  - This must ship before recording.

## C. Demo and submission kit (owner tasks)

### C1. Demo environment (prod, sandbox credentials)

1. **Workspace DK TESTE override.** The table is keyed by `workspace_id`, and `feature_overrides` can be NULL:
   ```sql
   insert into workspace_plan_overrides (workspace_id, plan_id, feature_overrides)
   values ('<DK TESTE workspace_id>', '<its current plan_id>',
           '{"feature_tiktok": true, "feature_post_scheduling": true, "feature_multiplatform": true}')
   on conflict (workspace_id) do update
   set feature_overrides = coalesce(workspace_plan_overrides.feature_overrides, '{}'::jsonb)
     || excluded.feature_overrides,
       updated_at = now();
   ```
   You can also use the Admin workspace overrides editor. Then confirm that `workspace-limits` returns all three as `true`.
2. **A board in DK TESTE** with `plataformas = {tiktok}` or `{instagram,tiktok}`. Existing boards are `{instagram}`, and new posts seed TikTok only from the board.
3. **The demo client has `auto_publish_on_approval` off.** A Hub approval should not schedule during the recording.
4. **TikTok portal: the test account is listed as a sandbox target user.** A sandbox app only accepts those users.
5. **The TikTok test account is set to private in the TikTok app.** A7 warns if you forget.
6. **Reconnect the account during the recording.** The expired token from July doesn't matter, and the video must show the OAuth consent screen anyway.

### C2. Demo script

One take, under 50 MB, 1080p screen recording.

1. **Connect.** Cliente → Redes sociais → "Conectar TikTok" → TikTok consent screen listing the requested scopes → back in Mesaas, with the toast (B1).
2. **TikTok section.** It shows the imported videos and the follower metrics. This demonstrates `video.list`, `user.info.basic`, `user.info.profile` and `user.info.stats`.
3. **Composer.** Entregas → the TikTok board → open a video post (`reels`) → TikTok tab. Show:
   - the creator nickname
   - the preview (A4) and the duration limit
   - the test-mode banner (A7)
   - the privacy dropdown with no default, set to the `SELF_ONLY` option
   - the interaction checkboxes unchecked. Duet and Stitch are greyed out because the account is private; that is expected.
   - the disclosure toggle switched on, showing the "Sua marca" label prompt, then switched off (A1)
4. **Publish.** Mark the post approved → "Publicar agora" → the confirmation dialog with the declaration (A3) → "Publicar".
5. **Status.** The chip goes "Publicando" → "Publicado", with the notice (A8).
6. **On TikTok.** Cut to the TikTok app: the post appears on the account as private.
7. **Optional.** A scheduled post shows the declaration above "Agendar", then the cron publishes it.

### C3. Portal submission (developers.tiktok.com → Manage apps)

- **App description:** EN, from the 2026-08-20 dossiê (https://claude.ai/code/artifact/0444d973-63e3-4cdd-8888-de8c0fad397b).
- **Scope justifications:** one line each for `user.info.basic`, `user.info.profile`, `user.info.stats`, `video.list` and `video.publish`. Each must be visible in the video.
- **Terms of service:** https://mesaas.com.br/termos-de-uso. **Privacy policy:** https://mesaas.com.br/politica-de-privacidade.
- **Redirect URI:** exactly equal to `TIKTOK_REDIRECT_URI`.
- **URL-prefix verification:** the `tiktok-media` proxy host, already verified in July.
- **Usage estimates:** these become the post-audit caps. Estimate from the expected number of TikTok workspaces, with headroom.
- **pt-BR → EN crib of the compliance strings** (in the submission notes), so the reviewer can match the UI to the guideline:

| UI (pt-BR) | Guideline |
|---|---|
| Divulgação de conteúdo comercial | Content Disclosure Setting |
| Sua marca | Your brand |
| Conteúdo de marca | Branded content |
| Conteúdo promocional | Promotional content |
| Parceria paga | Paid partnership |
| Indique se o conteúdo promove você, um terceiro ou ambos. | You need to indicate if your content promotes yourself, a third party, or both. |
| Ao publicar, você concorda com a Confirmação de Uso de Música do TikTok. | By posting, you agree to TikTok's Music Usage Confirmation. |
| Pode levar alguns minutos para aparecer no perfil. | Content may take a few minutes to process and appear on your profile. |

### C4. After approval

1. Set `TIKTOK_APP_AUDITED=true`. No redeploy is needed, because secrets are read at request time (`creator-info` and the validator in `tiktok-publish`, and the utils).
2. Switch `TIKTOK_CLIENT_KEY` and `TIKTOK_CLIENT_SECRET` to the production app.
   - The production portal config uses the same redirect URI and URL prefix.
   - Sandbox-issued tokens stop working, so connected accounts must reconnect.
3. Launch (`feature_tiktok` per plan) is a separate decision.

## Deploy order

There is no migration. Edge functions deploy before merge, because the merge deploys the frontend.

| Function | Why | Flag |
|---|---|---|
| `tiktok-publish` | A2 validator, A6, A7, A10, B5 | keeps `verify_jwt=true` |
| `tiktok-publish-cron` | A6 failReason and messages, A10, B5 | `--no-verify-jwt` |
| `tiktok-webhook` | B5 | `--no-verify-jwt` |
| `tiktok-integration` | B1, B6 | `--no-verify-jwt` |

New response fields are additive (`can_post`, `app_audited`, `cannot_post_reason`). The frontend treats missing fields as today's behavior, so either order is safe.

## Testing

**Vitest:**
- **`TikTokSettingsPanel`:**
  - the A0 formula and `reason` for each rule
  - disclosure master/checkbox rules and label prompts
  - A2 mutual disabling when audited
  - A2 branded disabled when unaudited, and a legacy conflict row
  - duration error
  - `can_post: false` notices
  - unaudited: non-`SELF_ONLY` options disabled, banner always on, public-account warning
  - preview, including the empty and lost-media states
  - loading and error block completeness
- **`TikTokPostingDeclaration`:** both variants, the links, and `undefined` rendering the branded variant.
- **`ScheduleButton`:**
  - the declaration above the row and inside the publish-now dialog, only when TikTok is targeted
  - `reason` in "Falta:"
  - per-platform missing-caption copy
  - the ink style on the button, the dialog confirm, the progress bar and the Publicando pill
  - the processing notice and the publish-now toast
- **Auto-schedule dialogs:** the declaration when TikTok is present, and the branded variant for a mixed batch.
- **Connect flow:** `ClienteDetalheIndexRedirect` and `RedesSociaisTab` (`tt_connected` toast, capture and strip in one `setSearchParams`).
- **`services/tiktok`:** `feature_disabled` and `{ error: true, message }` mapping.
- **`nav-data` test.**

**Deno:**
- **`creator-info`:** `can_post: false` per code, `app_audited`, other errors still 500.
- **The validator's branded + `SELF_ONLY` rule.**
- **`buildTikTokPostUrl`** per `tipo`, across publish-now, cron status confirmation and the webhook.
- **The init catch:** passes `failReason` and stores the pt-BR message, non-retryable, for each mapped code.
- **`evaluateTikTokPrecheck` / `fetchCreatorCheck`:**
  - each of the five rules
  - fail-open on network, 5xx and 429
  - fail on `TOKEN_INVALID`
  - one creator_info call per account per cron run
- **B6:** the auth URL `scope` param.

**Browser** (local, creator-info stubbed): walk C2 steps 3-5 in light and dark, at drawer width and at 390px.
