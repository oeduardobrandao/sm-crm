# Mesaas iOS app: plan

**Situation.** The CRM is a React web app at `https://www.mesaas.com.br` with a responsive layout
(bottom nav at 900px and below), `viewport-fit=cover` and a web manifest. Notifications already
exist as rows in `notifications` (per user, with a `link`), surface in the bell, and go out by
email through `notification-email-cron` every 5 minutes, with per-type prefs per channel. The
Capacitor shell (PR #668) and the push backend (PR #669) are built.

**Complication.** Agency staff miss approvals, client corrections and deadlines because nothing
reaches their phone, and agencies are asking for an app. A plain web wrapper gets rejected by App
Review (4.2), billing can't be sold in-app (3.1.1), and Meta login is blocked inside embedded
web views. On top of that, the phone layout of the CRM is a shrunken desktop: too much text,
tables that scroll sideways, drag that doesn't work on touch, no notification list. An app that
shows those screens won't feel made for the iPhone.

**Question.** How do we ship an App Store app for staff that looks native, keeps every feature of
feature-rich pages like Entregas, and doesn't fork the UI or slow web deploys?

**Answer.** Keep the Capacitor shell loading the live CRM (D3) and give the CRM a real phone layout
in the iOS idiom: grouped lists, sheets, segmented controls, long-press menus, swipe actions, a
floating tab bar. It applies at phone width everywhere (app, mobile Safari, Android browsers), so
the redesign fixes mobile web too, and desktop is unchanged (D16, D17). Native features stay in
`apps/crm/src/native/`; push stays a second channel on `notifications`. Mockups:
[Mesaas iOS App Screens](https://claude.ai/artifact/DedPuJQkW8YKCKoDxzAVJq), pages "Entregas
completo (opção C)" and "Editor de post (opção C)".

Effort levels: **low** routine, **medium** standard, **high** many edge cases or auth,
**max** security review.

## Status (2026-10-10)

| Phase | State |
|---|---|
| A. Shell | Built, PR #668 open |
| B. Push backend | B1-B5 built, PR #669 open. B6 (deploy) waits for the user's OK |
| C. Phone UI | Mockups for Entregas (8 screens) and the post editor (7) approved as direction |
| D. Native module | Not started; its mockups (push pre-prompt, Face ID, prefs, plan limit) are drawn |
| E. Release | Apple enrollment is user-owned |

## PR map and order

```
#668 shell ─────────────────────────────────────────────┐
#669 push backend ── B6 deploy (user OK) ───────────────┤
C1 phone kit + navigation ──┬── C3 Entregas phone ──────┤
C2 saved views on server ───┘   C4 post editor phone ───┤── E release
D native module (parallel with C3/C4) ──────────────────┘
```

- **C1 blocks C3 and C4** (they build on its components). C3 and C4 run in parallel after C1.
- **C2 is independent** (backend + store). C3's saved-views menu reads it, so C2 merges first or C3
  ships the menu on the current localStorage store and C2 switches it.
- **D runs in parallel with C3/C4.** It touches `native/`, auth storage, OAuth and downloads, not
  page layouts. Its push prefs column needs #669 deployed.
- Every C PR is a no-op above 900px. Each PR description lists the desktop screens re-checked.

## Phase A: shell prototype (PR #668, `feat/ios-app-shell`)

| # | Step | Effort | Why this level |
|---|------|--------|----------------|
| A1 | Scaffold `apps/mobile`: Capacitor 8, iOS via SPM, `server.url`, `allowNavigation`, offline `www/`, gitignore/lint exclusions | medium | Well-documented tooling, but config mistakes break the whole shell |
| A2 | Build and run in the Simulator, audit key screens at phone width (AUDIT.md) | medium | Exploratory; output is a list, not code |
| A3 | Shell polish: status bar, splash, safe areas, keyboard resize, edge-swipe back, no link previews | low | Known recipes |

## Phase B: backend push pipeline (PR #669, deployed dark before merge)

| # | Step | Effort | Why this level |
|---|------|--------|----------------|
| B1 | Spike: Deno reaches APNs over HTTP/2 (D12); hosted runtime checked at B6 | high | Decides APNs vs FCM |
| B2 | Migration: `push_devices`, register/unregister RPCs, `notification_push_prefs`, `notifications.pushed_at`, `claim_notification_pushes()` | high | RLS, SECURITY DEFINER, cross-user claim |
| B3 | Extract the per-type renderer to `_shared/notification-render.ts` | medium | Pure refactor with existing tests |
| B4 | `_shared/apns.ts` + `notification-push-cron` + pg_cron schedule | high | Token errors, grouping, missing secrets |
| B5 | Tests: Deno + entitlement SQL | high | Security-relevant behaviour |
| B6 | Deploy dark: staging `db push` of 20261015000001, deploy `notification-push-cron` (`--no-verify-jwt --use-api --project-ref`), then 20261015000002; repeat on prod. Needs the user's OK | medium | Ordered ops, user-owned |

## Phase C: phone UI in the iOS idiom (option C)

Scope rule for every step: phone layout only, gated by the existing breakpoints (D17). Each UI PR
also updates the tests that render the mobile branch: jsdom's `matchMedia` stub reports false, so
`useIsDesktop()` is false in tests and today's suites assert the current mobile markup. That cost
is listed as its own step per PR.

### C0b. Remaining mockups (gates the screens it covers)

| # | Step | Effort | Why this level |
|---|------|--------|----------------|
| C0b | Draw what isn't drawn yet, on the same canvas: tab bar + Mais sheet + notification list (C1); Entregas Calendário, Concluídas, Novo fluxo / Novo post avulso, the forward/revert and client-approval confirmations as action sheets (C3); editor Produção section, thumbnail picker, version history, scheduled/failed bottom bar, the "…" menu, media long-press menu (C4) | medium | User approves UI from mockups before code |

### C1. Phone kit and navigation (PR)

| # | Step | Effort | Why this level |
|---|------|--------|----------------|
| C1.1 | Phone tokens in `style.css` scoped to `@media (max-width: 900px)`: grouped background, cell, separator, iOS type scale (34/22/17/15/13), sheet radius, light + dark | low | Tokens only, no behaviour |
| C1.2 | `components/mobile/`: `LargeTitleHeader`, `GroupedList`/`Cell` (chevron, value, switch, destructive), `SegmentedControl`, `ActionSheet`, `BottomSheet` (on the existing Radix Dialog, drag handle, detents medium/large, no new dependency), `ContextMenu` (long-press preview + actions, also on right-click), `SwipeRow` (leading/trailing actions), `BottomActionBar`, `ChipRow`. Each with unit tests | high | Gesture and focus edge cases: long-press vs scroll, swipe vs horizontal scroll, focus return on sheet close (Radix controlled-dialog trap), safe areas |
| C1.3 | Tab bar: extend `MobileNav`'s `mobile-nav-glass` to Início / Entregas / Agenda / Mensagens / Mais with per-plan and per-role fallbacks (D18); Clientes and Analytics move to the top of Mais | medium | Feature gating (`useEffectiveNavFeatures`, `routePermissions`) decides which tabs exist |
| C1.4 | Notification list on phones (AUDIT #1): bell in the large-title header of each tab root with the unread count, opening a full-screen list that reuses `NotificationList` | medium | Reuses data hooks; new layout |
| C1.5 | Shell fixes from AUDIT: Mais sheet top safe area (#2), guide chip overlap (#3), Mensagens timestamp wrapping (#4) | low | Known CSS fixes |
| C1.6 | Update tests that assert the old mobile nav markup | low-medium | Mechanical, but spread across suites |

### C2. Saved views on the server (PR, deploy migration before merge)

| # | Step | Effort | Why this level |
|---|------|--------|----------------|
| C2.1 | Migration: `entregas_saved_views (id, conta_id, user_id, name, query, position, created_at)`, RLS = own rows in own workspace, unique `(user_id, conta_id, name)`. Version renumbered above main's tail at PR-open time | high | RLS + workspace scoping |
| C2.2 | Entitlement SQL suite: own rows only, cross-workspace denied, anon denied | medium | CI-gated security test |
| C2.3 | `store/savedViews.ts` + `useSavedViews` (TanStack Query); `savedViews.ts` becomes a one-time importer: on first load, upload localStorage views not on the server, then stop reading localStorage | medium | Import must be idempotent across tabs and devices |
| C2.4 | Deploy order: staging `db push`, prod `db push` (user OK), then merge | medium | Merge ships the frontend instantly |

### C3. Entregas phone layout (PR)

| # | Step | Effort | Why this level |
|---|------|--------|----------------|
| C3.1 | Header: large title with the title menu (saved views, "Exibir como" the 6 views, "Mostrar" entity), Etapas/Status segmented control, counters line | medium | Wires to the existing `viewQuery` URL state; no new state |
| C3.2 | Filters sheet: every filter in `EntregasFilters` (Status, Cliente, Responsável, Responsável do post, Etapas, Templates, Prazo da etapa incl. Personalizado; Status do post and Tipo in Status mode) as chips + drill-in lists, "Limpar" and "Ver N" | medium | Same filter model, new layout |
| C3.3 | Kanban (Fluxos): one column at a time with etapa chips, template switch, column sort, card ✓ "Concluir etapa e avançar" honouring adjacent-only moves and the forward/revert and `ClientApprovalChoiceDialog` confirmations as action sheets | high | Move rules and confirmations must match desktop exactly |
| C3.4 | Kanban (Status): drag a card onto a status chip; undo toast; locked statuses refuse the drop | high | Drop targets change shape on phones |
| C3.5 | Card long-press menu (open, advance, move, duplicate, copy link, remove) shared by Kanban, Lista, Fila | medium | One menu, many entry points |
| C3.6 | Lista and posts list as grouped rows (sections Atrasado/Hoje/Amanhã, Agrupar, Responsáveis, Mostrar postados), swipe Avançar / Mais | medium | Replaces sideways tables on phones |
| C3.7 | Fluxo sheet (`WorkflowDrawer` phone): Posts / Grade / Calendário / Histórico, selection mode with "Mover para outro fluxo" / "Desmembrar" | high | 1.6k-line component, multi-select state |
| C3.8 | Visão geral, Minha fila, Calendário, Concluídas phone layouts | medium | Mostly presentational |
| C3.9 | Touch drag: add `TouchSensor` (`delay: 250, tolerance: 8`, the pattern in `WorkflowCalendarView` and `PostsKanbanView`) to `KanbanView`, `WorkflowDrawer`, `SortableEtapaList` | low | Copy of an existing pattern |
| C3.10 | Update Entregas tests for the new mobile branch; add tests for chip drop, swipe actions, filter sheet | medium | Many suites render the mobile branch |

### C4. Post editor phone layout (PR)

Desktop keeps one long page. PR #429 (5-tab editor, closed, 233 commits behind main) is reference
only; its UI is not reused.

| # | Step | Effort | Why this level |
|---|------|--------|----------------|
| C4.1 | Shell: header (back, title, status chip menu, "…"), Conteúdo / Detalhes / Publicar / Comentários segmented tabs, keep-mounted panes, `BottomActionBar` whose primary action follows status (Enviar ao cliente, Agendar, Agendado · Cancelar, Tentar novamente) | high | Unsaved-work tracking (`useUnsavedWork`) and caption drafts must survive tab switches |
| C4.2 | Conteúdo: media strip ("N de 10", Capa, Adicionar), long-press menu (reorder, Ajustar proporção, Escolher thumbnail, Usar como capa do Reel, Baixar, Remover), caption tabs per destination with comment highlights and count, Versões, Roteiro e briefing and Referências rows | high | Media reorder on touch (`PostMediaGallery` gets `TouchSensor`), comment anchors |
| C4.3 | Full-screen text editing for Roteiro and captions: TipTap formatting bar above the keyboard (`visualViewport`), selection menu with Comentar / Link | high | iOS keyboard and selection behaviour in WKWebView |
| C4.4 | Detalhes: grouped list for Título, Tipo, Destinos, Status, Responsável, Data + Melhor horário, Propriedades (each type), Produção (individual posts) | medium | Reuses `PropertyValue`, `SuggestTimeButton` |
| C4.5 | Publicar: "Antes de agendar" checklist from `ScheduleButton`'s missing items, TikTok settings, Trial reel (Reels only), comment automation, Publicar agora / Agendar | medium | Checklist logic already exists |
| C4.6 | Comentários: Com o cliente / Equipe, bubbles, approval events, reply composer; suggestion sheet with diff and Rejeitar / Aceitar | medium | Reuses `DiffView` and comment hooks |
| C4.7 | Sheets: crop editor (`MediaAdjustmentDialog` full-screen dark layout), thumbnail picker, version history | medium | Layout over existing logic |
| C4.8 | Update editor tests for the mobile branch | medium | `PostEditor` suites are large |

## Phase D: CRM native module (PR, parallel with C3/C4)

| # | Step | Effort | Why this level |
|---|------|--------|----------------|
| D1 | `native/platform.ts`, Capacitor deps in the CRM; hide sign-up, landing, billing and upgrade CTAs in the app | medium | Many call sites, simple logic |
| D2 | Keychain-backed Supabase session storage in the app | high | Auth: a bug logs everyone out or leaks a session |
| D3 | Push registration, pre-prompt, tap routing, mark-read, "Celular" prefs column (columns Sino / E-mail / Celular), unregister on logout | medium | Clear contract with B2 |
| D4 | OAuth `app` flag: Meta/TikTok in an in-app Safari sheet; callbacks redirect to `br.com.mesaas.app://conectado` | high | OAuth state signing, two edge functions, auth |
| D5 | `saveFile()` + route the download call sites through the share sheet | medium | 9 call sites, one helper |
| D6 | Face ID lock overlay, 5-minute background timer, app-switcher blur | medium | Plugin + timer edge cases |
| D7 | Icon badge from the unread count; quick actions via app links | low | Small, isolated |
| D8 | AASA file in `public/.well-known/` + explicit `vercel.json` route; associated domains | medium | Routing traps (no CRM catch-all) |

## Phase E: native integration and release

| # | Step | Effort | Why this level |
|---|------|--------|----------------|
| E1 | Wire plugins in the iOS project: Info.plist strings, entitlements, AppDelegate quick actions | medium | Native config |
| E2 | Simulator end-to-end incl. `xcrun simctl push`, and a phone-width pass over every C screen in the app and in mobile Safari | medium | Verification |
| E3 | Security review of the whole stack | max | Auth, RLS, OAuth, tokens |
| E4 | Apple Organization enrollment, APNs key, App Store Connect, TestFlight, submission | user-owned | Needs the company's Apple account |
