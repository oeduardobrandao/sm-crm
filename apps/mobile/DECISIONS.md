# Mesaas iOS app: decision log

What we chose, what we considered and rejected, and why. Newest at the bottom.

## D1. Audience: agency staff (CRM), not Hub clients

- **Chosen:** the app is the CRM for owner/admin/agent users.
- **Rejected:** a Hub (client) app. The Hub is whitelabelled per client (`brand_color`), which is the
  App Store 4.2.6/4.3 template-app rejection pattern, and Hub clients have no Supabase login, so
  they are not in `notifications`. Token links already work in Safari.
- **Why:** the drivers are push notifications for staff and customer (agency) demand.

## D2. Platform: iOS first, Android-ready

- **Chosen:** ship iOS first; nothing iOS-only in the shared layers (`push_devices.platform`,
  provider-agnostic push sender interface).
- **Rejected:** both at launch (two reviews, more testing in v1); iOS-only design (most phones in
  Brazil are Android).

## D3. Approach: Capacitor shell loading the live site (`server.url`)

- **Chosen:** Capacitor 8 app whose web view loads `https://www.mesaas.com.br`. The CRM stays the
  only UI; native features come from Capacitor plugins called from `apps/crm/src/native/`.
- **Rejected:**
  - Capacitor with the web build bundled (`webDir`): origin becomes `capacitor://localhost`, which
    changes `ALLOWED_ORIGINS`, Supabase redirect URLs and every `window.location.origin` link, and
    each deploy needs a live-update vendor (Capgo/Appflow) or a store resubmission.
  - Hand-written Swift shell (WKWebView + custom bridge): same result with more native code and no
    Android reuse.
  - React Native / Expo or native SwiftUI: only `store.ts` would port; the whole shadcn/Tailwind/
    TipTap/dnd-kit UI would be rebuilt.
- **Why:** deploys reach the app instantly, `installSilentUpdate` keeps working, same origin means
  no CORS/auth changes. Capacitor's docs call `server.url` "not intended for production"; accepted
  because App Review cares about native value (push, camera, Face ID), not where HTML is served from.
- **Cost accepted:** a bundled offline page; Meta/TikTok OAuth must leave the web view.

## D4. Host: `www.mesaas.com.br`

- The apex `mesaas.com.br` 308-redirects to `www`, and `app.mesaas.com.br` 404s (checked
  2026-10-10). The app loads `www`, and the AASA file is served on `www` (universal links do not
  follow redirects).

## D5. Login only, no sign-up or billing in the app

- **Chosen:** existing accounts log in; sign-up, plans, checkout, billing settings and upgrade CTAs
  are hidden when `isNativeApp()`. Plan limits show a neutral "Gerencie seu plano pelo site", no link.
- **Rejected:** sign-up with hidden billing (more review risk around wording); researching
  external-purchase rules first (deferred; revisit if in-app upgrade becomes a goal).
- **Consequence:** App Store 5.1.1(v) account deletion does not strictly apply (no account
  creation in the app). Fallback if App Review asks: a "Excluir minha conta" flow.

## D6. v1 native scope

- **Chosen:** push, camera/photo upload (via the existing `<input type="file">`), Face ID lock,
  icon badge, home-screen quick actions, share sheet for downloads.
- **Rejected for v1:** share extension (real native target, more review surface), background
  uploads, custom camera plugin.

## D7. Repo layout: same monorepo, `apps/mobile`

- **Chosen:** `apps/mobile` workspace in this repo.
- **Rejected:** separate repo. Plugin JS (in the CRM bundle) and native plugin code (in the
  installed binary) must stay version-matched; one PR and one lockfile keep them together.
  Cross-layer features (OAuth app flag, push) land as one reviewable change.
- **Mitigations:** only source under `apps/mobile/ios` is committed; Vercel and the eight CI jobs
  ignore it.

## D8. PR shape: one PR per layer

1. `apps/mobile` shell (no web impact, can merge anytime).
2. Backend push pipeline (migration + cron, deployed dark before merge).
3. CRM native module (hidden billing/sign-up, session storage, push registration, OAuth app flag,
   downloads, Face ID, badge, quick actions, mobile-layout fixes).

## D9. Identifiers

- Bundle ID `br.com.mesaas.app`, display name "Mesaas". Permanent after first upload.

## D10. Push transport: APNs direct (pending spike), FCM fallback

- **Chosen (provisional):** `notification-push-cron` calls APNs over HTTP/2 with a `.p8` token key.
- **Fallback:** Firebase Cloud Messaging for iOS too, if the Supabase edge runtime cannot speak
  HTTP/2 to `api.push.apple.com`. FCM is needed for Android anyway, at the cost of the Firebase SDK
  in the app.
- **Delivery model:** every-minute cron claiming rows (`pushed_at`), copied from
  `claim_notification_emails`. Rejected: AFTER INSERT trigger + `pg_net` (instant, but a second
  code path to make idempotent and retry-safe; one minute of latency is acceptable).

## D11. Toolchain

- Capacitor 8.5.x, iOS dependencies via Swift Package Manager (CocoaPods is not installed and SPM
  is Capacitor 8's default).
- Xcode 27 is at `/Applications/Xcode.app` but `xcode-select` points at the Command Line Tools;
  build commands set `DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer`.

## D12. Push transport confirmed for Deno; hosted runtime pending (B1)

- Deno 2.7 `fetch` negotiates HTTP/2 with APNs: an unauthenticated POST to
  `api.sandbox.push.apple.com` returns APNs' JSON `403 MissingProviderToken` (2026-10-10).
- Not yet observed from the hosted Supabase edge runtime (deploy needs approval). If it fails
  there, D10's FCM fallback applies.

## D13. Which notifications push (PR #669)

- **Chosen:** the email digest's types plus `event_reminder`, `post_edit_suggestion`,
  `post_client_reference`, `idea_submitted`, `briefing_answered`: things a client or teammate did
  that need this user.
- **Rejected:** every bell type. Step churn (`step_activated`/`step_completed`), membership and
  role changes, automation and storage reports would make the phone buzz for things nobody acts on.

## D14. One push per user per minute; no retries

- **Chosen:** several claimed rows for one user in a run become one summary push; a failed send
  is reported and not retried. Dead tokens (410, BadDeviceToken, DeviceTokenNotForTopic) disable
  the device.
- **Rejected:** per-row pushes (a burst of client comments would buzz five times); retrying
  failures (a push a minute late is worth less than the risk of a duplicate).
- **Exception:** the soft deadline releases claims for users the run never reached.

## D15. Push prefs in a third table

- **Chosen:** `notification_push_prefs`, same shape as the email and in-app tables.
- **Rejected:** a `channel` column on an existing prefs table: old CRM bundles still in browsers
  read and upsert `notification_email_prefs` by `(user_id, type)` with no channel filter.

## D16. Native look through the web layout (option C)

- **Chosen:** keep the Capacitor shell (D3) and redesign the CRM's phone layout in the iOS idiom:
  grouped lists, sheets, segmented controls, long-press menus, swipe actions, a floating tab bar.
  Every feature of the desktop page stays reachable (Entregas parity table in the mockups canvas).
- **Rejected:** option A, Expo/React Native screens for the main flows with a web fallback for the
  rest. More native feel, but two UIs to keep in step, every feature rebuilt, and an app release
  for each UI change.
- **Rejected:** shipping the current phone layout. Too much text, sideways tables, drag that
  doesn't work on touch, no notification list (AUDIT.md).
- **Why:** one UI, deploys reach the app instantly, and mobile web users get the same fixes.
- **Supersedes D8's third PR:** the CRM work is now five PRs (C1 kit + navigation, C2 saved views,
  C3 Entregas, C4 post editor, D native module), see PLAN.md.

## D17. Gate the phone layout by width, not by `isNativeApp()`

- **Chosen:** the iOS-style layout renders at 900px and below, the breakpoint `MobileNav` and
  `EntregasPage` (`useIsDesktop(901)`) already use. Same look in the app, mobile Safari and Android
  browsers. Desktop is unchanged.
- **Rejected:** app-only layout (two phone layouts to maintain; mobile web stays broken); a new
  breakpoint (a third one would leave 768-900px half converted).
- **Cost accepted:** Android browsers get an iOS-flavoured look. An Android app later can swap the
  phone tokens; the components don't change.
- **Tablets:** 768-900px gets the phone layout with content centred, as it already gets the
  bottom nav.

## D18. Tab bar: Início, Entregas, Agenda, Mensagens, Mais

- **Chosen:** the phone tab bar becomes Início (dashboard), Entregas, Agenda, Mensagens, Mais.
  Clientes and Analytics move to the top of Mais. When a tab's feature or permission is off for
  the user (Agenda needs `feature_agenda`, off on Free; Mensagens needs `feature_mensagens` and
  `clientes.ver`), Clientes then Analytics take the free slot, so the bar always has five items.
- **Rejected:** keeping Dashboard / Clientes / Analytics / Entregas / Mais. Agenda and Mensagens
  are what staff open on a phone between meetings; Analytics is desk work.
- **Applies to every phone user** (D17), so it ships behind no flag but is called out in the PR.

## D19. Saved views live on the server, per user

- **Chosen:** new table `entregas_saved_views` (per user, per workspace, RLS own rows). The
  existing `localStorage` views are imported once on first load and then ignored.
- **Rejected:** keep `localStorage` (views don't follow the user from desktop to the app); a column
  on `membros` (column-grant allowlist, migration 20260728000002); shared workspace views (a
  sharing model nobody asked for yet; the table can grow a `shared` flag later).

## D20. Phone patterns for Entregas

- **Lista and posts list** render as grouped rows with swipe actions on phones; the tables stay on
  desktop.
- **Drag on touch:** `TouchSensor` with `delay: 250, tolerance: 8` next to `PointerSensor`, the
  pattern `WorkflowCalendarView` and `PostsKanbanView` already use. Added to `KanbanView`,
  `WorkflowDrawer`, `SortableEtapaList` and `PostMediaGallery`.
- **Fluxos board** shows one etapa at a time with chips; moves stay adjacent-only with the same
  confirmations, shown as action sheets. **Status board** drops onto status chips.

## D21. Post editor: 4 tabs on phones, one page on desktop

- **Chosen:** Conteúdo / Detalhes / Publicar / Comentários with a bottom bar whose primary action
  follows the post status.
- **Rejected:** reviving PR #429 (5 tabs on desktop too; closed, 233 commits behind main). Used as
  reference only.

## D22. Copy for the app's notification settings and plan limits

- Notification prefs columns read **Sino / E-mail / Celular**.
- Plan limits in the app show the limit and "Entendi", no upgrade link (D5).

## D23. Phone components without a new dependency

- **Chosen:** bottom sheets, action sheets and context menus are built on the Radix primitives
  already in the CRM (`dialog`, `dropdown-menu`) plus pointer events.
- **Rejected:** `vaul` or a gesture library: another dependency to age past Deno/npm minimum-age
  rules, and Radix already handles focus and dismissal.
