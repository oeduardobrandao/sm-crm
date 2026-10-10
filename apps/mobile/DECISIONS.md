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
