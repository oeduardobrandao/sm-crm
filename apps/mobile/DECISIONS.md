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

## D17. Gate the phone layout by width (below 768px), not by `isNativeApp()`

- **Chosen:** the iOS-style layout renders below 768px, the breakpoint `MobileNav`
  (`style.css` `max-width: 767px`) and `AppLayout`'s `useIsMobile` already use. Same look in the
  app, mobile Safari and Android browsers. Tablet (768-1100px, sidebar drawer) and desktop are
  unchanged. Every iPhone is under 768px in portrait. In landscape most iPhones are wider and
  get the tablet layout; the app can lock portrait on iPhone (E1) if that looks wrong.
- **Rejected:** app-only layout (two phone layouts to maintain; mobile web stays broken); moving
  the phone breakpoint to 900px to match `EntregasPage`'s `useIsDesktop(901)` (changes the iPad
  portrait layout for every page, and the plan review found nothing that needs it). Entregas'
  existing ≤900px sheets (Filtros, Responsáveis) keep working in 768-900.
- **Cost accepted:** Android browsers get an iOS-flavoured look. An Android app later can swap the
  phone tokens; the components don't change.

## D18. Tab bar: Início, Entregas, Agenda, Mensagens, Mais

- **Chosen:** the phone tab bar becomes Início (dashboard), Entregas, Agenda, Mensagens, Mais.
  Clientes and Analytics move to the top of Mais. When a tab's feature or permission is off for
  the user (Agenda: gated in the tab bar on `feature_agenda`, off on Free, not through `nav-data.ts`'s
  global feature map, which would also hide the editorial Calendário on desktop; Mensagens needs `feature_mensagens` and
  `clientes.ver`), Clientes then Analytics take the free slot, so the bar always has five items.
- **Rejected:** keeping Dashboard / Clientes / Analytics / Entregas / Mais. Agenda and Mensagens
  are what staff open on a phone between meetings; Analytics is desk work.
- **Applies to every phone user** (D17), so it ships behind no flag but is called out in the PR.

## D19. Saved views live on the server, per user

- **Chosen:** new table `entregas_saved_views` (per user, per workspace, RLS own rows). The
  existing `localStorage` views are imported once on first load and then ignored.
- **RLS:** `user_id = auth.uid() AND conta_id = get_my_conta_id()` on USING and WITH CHECK, so a
  view can't be written into a workspace the user left.
- **Rejected:** keep `localStorage` (views don't follow the user from desktop to the app); a column
  on `membros` (column-grant allowlist, migration 20260728000002); shared workspace views (a
  sharing model nobody asked for yet; the table can grow a `shared` flag later).

## D20. Phone patterns for Entregas

- **Lista and posts list** render as grouped rows with swipe actions on phones; the tables stay on
  desktop.
- **Long-press is the menu; drag is explicit.** On phone cards a hold opens the context menu.
  Drag starts from a handle or in a "Reordenar" mode, using `TouchSensor` (`delay: 250,
  tolerance: 8`, the values `WorkflowCalendarView` and `PostsKanbanView` use) on `KanbanView`,
  `WorkflowDrawer`, `SortableEtapaList` and `PostMediaGallery`. Rejected: long-press-to-drag
  everywhere, because dnd-kit's 250 ms sensor fires before any long-press menu and the card menu
  would be unreachable.
- **Fluxos board** shows one etapa at a time with chips, rendering only that column; moves stay
  adjacent-only with the same confirmations, shown as action sheets. **Status board** drops onto
  status targets that expand from the chip row into a grid while dragging.
- **Guided tour** is off below 768px: its anchors are desktop columns.

## D21. Post editor: 4 tabs on phones, one page on desktop

- **Chosen:** Conteúdo / Detalhes / Publicar / Comentários with a bottom bar whose primary action
  follows the post status. On phones the post opens as its own pushed screen with its own history
  entry; on desktop it stays expanded inline in the Fluxo or standalone drawer.
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

## D24. Editor bottom bar material; landscape stays on the tablet layout

- **Chosen (2026-10-11, owner):** the post editor's bottom bar uses the kit's iOS glass (78% fill
  plus blur, like system toolbars) instead of a near-opaque fill. Warnings on it are weight 600,
  and browsers without `backdrop-filter` get the opaque fill.
- **Landscape:** keep the 768px gate from D17 for now. A phone in landscape gets the tablet layout,
  so rotating with the editor open falls back to the inline editor. Revisit in E1 (portrait lock).

## D25. Every in-shell screen gets the phone layout before phase D

- **Chosen (2026-10-11, owner):** port every route inside `AppLayout` to the iOS idiom below 768px
  (phase F) before starting the native module. Public marketing pages are out of scope.
- **Breakpoint:** phone = `!useIsDesktop(768)`, matching the shell. Page-level 900/901 branches stay
  only as the 768-900 tablet fallback.

## D26. One header row on phones

- **Chosen:** root screens show one 44px row with the page's actions and the shell's bell and help
  links, above the large title. Pushed screens show a nav bar (back, title, actions).
- **Rejected:** keeping `PhoneShellHeader` as its own bar above each page header: two stacked bars
  is the main reason unported screens read as desktop.
- **Rollout:** routes opt in as their PR lands, so unported routes keep today's bar meanwhile.

## D27. Report editor is view and export only on phones

- **Chosen:** on phones `/relatorios/:id` and the template pages render the report read-only with
  Exportar PDF, Atualizar dados, Ver como cliente and Aplicar template.
- **Why:** editing is built for an 880px/A4 layout: block toolbars are hover-gated, the layers
  rail is hidden below 1280px, and widths collapse below 720px so the layout can't be previewed.

## D28. Dialogs become sheets on phones, in the primitive

- **Chosen:** `DialogContent` renders as a large bottom sheet below 768px and `AlertDialogContent`
  as an action-sheet confirm, with an opt-out for dialogs that must stay fullscreen
  (EventoFormDialog, the automation form). One change converts ~40 dialogs.
- **Must keep:** `confirmClose`, `useUnsavedWork`, `trackUnsavedWork` and focus return.

## D29. Help is tappable

- **Chosen:** `HelpTooltip`, `[data-tooltip]` and `title=`-only information get a tap path on
  touch (info button opening a small sheet) or move into visible subtitles and footers.

## D30. Drag only in Reordenar mode, everywhere

- Extends D20 to Tarefas boards and calendar, Briefing, Páginas, statuses and Arquivos: long-press
  opens the menu; drag starts from a handle in Reordenar mode; every move also exists as a menu
  action. The Agenda turns drag off on phones and moves events through the form.

## D31. Instagram and TikTok cards are restyled, not rewritten

- **Chosen:** the cliente Redes sociais tab keeps the imperative innerHTML renderers and gets a
  kit layout around them. A React rewrite is out of F's scope.
