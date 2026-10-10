# Mesaas iOS app: plan

**Situation.** The CRM is a React web app at `https://www.mesaas.com.br` with a responsive layout
(bottom nav at 900px and below), `viewport-fit=cover` and a web manifest. Notifications already
exist as rows in `notifications` (per user, with a `link`), surface in the bell, and go out by
email through `notification-email-cron` every 5 minutes, with per-type prefs per channel.

**Complication.** Agency staff miss approvals, client corrections and deadlines because nothing
reaches their phone, and agencies are asking for an app. A plain web wrapper gets rejected by App
Review (4.2), billing can't be sold in-app (3.1.1), and Meta login is blocked inside embedded
web views.

**Question.** How do we ship an App Store app for staff, centred on push, without forking the UI
or slowing web deploys?

**Answer.** A Capacitor 8 shell (`apps/mobile`) loads the live CRM; a CRM module
(`apps/crm/src/native/`) lights up native features only inside the app; push is a second channel
on the existing `notifications` rows, delivered by a new every-minute cron through APNs. Three PRs,
one per layer (see DECISIONS.md D8).

Effort levels: **low** routine, **medium** standard, **high** many edge cases or auth,
**max** security review.

## Phase A: shell prototype (PR 1, `feat/ios-app-shell`)

| # | Step | Effort | Why this level |
|---|------|--------|----------------|
| A1 | Scaffold `apps/mobile`: Capacitor 8, iOS via SPM, `server.url`, `allowNavigation`, offline `www/`, gitignore/lint exclusions | medium | Well-documented tooling, but config mistakes break the whole shell |
| A2 | Build and run in the Simulator, log in, audit the 4 key screens (notifications to post, Entregas + editor, Agenda, Mensagens) at phone width; log issues | medium | Exploratory; output is a list, not code |
| A3 | Shell polish: status bar, splash, safe areas, keyboard resize, edge-swipe back | low | Known recipes |

## Phase B: backend push pipeline (PR 2, deployed dark before merge)

| # | Step | Effort | Why this level |
|---|------|--------|----------------|
| B1 | Spike: does the Supabase edge runtime reach `api.sandbox.push.apple.com` over HTTP/2? (an unauthenticated call must return APNs' JSON 403) | high | Decides APNs vs FCM for everything after it |
| B2 | Migration: `push_devices`, register/unregister RPCs, `notification_push_prefs`, `notifications.pushed_at`, `claim_notification_pushes()` | high | RLS, SECURITY DEFINER, cross-user claim |
| B3 | Extract the per-type renderer to `_shared/notification-render.ts` (email keeps passing) | medium | Pure refactor with existing tests |
| B4 | `_shared/apns.ts` (ES256 JWT, cached) + `notification-push-cron` (group per user, badge, disable dead tokens) + pg_cron schedule | high | Many edge cases: token errors, grouping, missing secrets |
| B5 | Tests: Deno (handler, renderer, APNs fake) + entitlement SQL (RPCs, prefs RLS, claim) | high | Security-relevant behaviour |
| B6 | Deploy dark to staging then prod (needs user OK) | medium | Ordered ops, user-owned |

## Phase C: CRM native module (PR 3)

| # | Step | Effort | Why this level |
|---|------|--------|----------------|
| C0 | Mockups artifact for the new UI (push pre-prompt, Face ID lock, settings column, plan-limit copy, upload hint) | medium | User approves UI from mockups |
| C1 | `native/platform.ts`, Capacitor deps in the CRM; hide sign-up, landing, billing and upgrade CTAs in the app | medium | Many call sites, simple logic |
| C2 | Keychain-backed Supabase session storage in the app | high | Auth: a bug logs everyone out or leaks a session |
| C3 | Push registration, pre-prompt, tap routing, mark-read, "No celular" prefs column, unregister on logout | medium | Clear contract with B2 |
| C4 | OAuth `app` flag: CRM opens Meta/TikTok in an in-app Safari sheet; callbacks redirect to `br.com.mesaas.app://conectado`; app closes sheet and refreshes | high | OAuth state signing, two edge functions, auth |
| C5 | `saveFile()` + route the download call sites through the share sheet | medium | 9 call sites, one helper |
| C6 | Face ID lock overlay, 5-minute background timer, app-switcher blur | medium | Plugin + timer edge cases |
| C7 | Icon badge from the unread count; quick actions via app links | low | Small, isolated |
| C8 | AASA file in `public/.well-known/` + explicit `vercel.json` route; associated domains | medium | Routing traps (no CRM catch-all) |
| C9 | Mobile-layout fixes from A2 | low-medium | Depends on findings |

## Phase D: native integration and release

| # | Step | Effort | Why this level |
|---|------|--------|----------------|
| D1 | Wire plugins in the iOS project: Info.plist strings, entitlements, AppDelegate quick actions | medium | Native config |
| D2 | Simulator end-to-end incl. `xcrun simctl push` for tap routing | medium | Verification |
| D3 | Security review of the whole stack | max | Auth, RLS, OAuth, tokens |
| D4 | Apple Organization enrollment, APNs key, App Store Connect, TestFlight, submission | user-owned | Needs the company's Apple account |
