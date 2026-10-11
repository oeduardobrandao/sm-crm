# Mesaas iOS app: plan

**Situation.** The CRM is a React web app at `https://www.mesaas.com.br` with a responsive layout
(bottom nav below 768px), `viewport-fit=cover` and a web manifest. Notifications already
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
floating tab bar. It applies below 768px everywhere (app, mobile Safari, Android browsers), so
the redesign fixes mobile web too, and tablet and desktop layouts are unchanged (D16, D17). Native features stay in
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
- **C2 merges before C3.** It is backend + store + the desktop `VistasTabs` switch to async server
  rows; C3's title menu is written once, on top of it.
- **D runs in parallel with C3/C4.** It touches `native/`, auth storage, OAuth and downloads, not
  page layouts. Its push prefs column needs #669 deployed.
- C1, C3 and C4 change nothing at 768px and above. C2 changes desktop saved views (same UI, server
  storage). Each PR description lists the tablet (800px) and desktop screens re-checked.

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

Scope rule for every step: phone layout only, below 768px, the breakpoint `MobileNav` and
`AppLayout`'s `useIsMobile` already use (D17). Each UI PR also updates the tests that render the
mobile branch: jsdom's `matchMedia` stub reports false, so `useIsDesktop()` is false in tests and
today's suites assert the current mobile markup. That cost is listed as its own step per PR.

Cross-cutting rules for C1-C4 (from the plan review):

- **One owner per hold gesture.** On phone cards a long-press opens the context menu; drag starts
  only from a drag handle or in an explicit "Reordenar" mode. dnd-kit's `TouchSensor` (250 ms)
  would otherwise win over any long-press menu.
- **Every sheet and pushed screen gets a history entry** (`useOverlayHistoryEntry`), so iOS
  edge-swipe Back and Android Back close one layer, not the page.
- **Hold targets** set `-webkit-touch-callout: none` and `user-select: none` during the hold, or iOS
  shows its link callout or text selection instead of the menu.
- **Silent updates:** permanently mounted containers (tab bar, keep-mounted panes) must not carry
  `role="dialog"`; `isDocumentBusy` in `packages/app-lifecycle` treats any open dialog as unsaved
  work and would stall deploy swaps.
- **Hub isolation:** the Hub imports `apps/crm/style.css`. Phone tokens use new `--phone-*` names
  scoped under `.app-container`; never redefine shared tokens (`--radius`, `--bg-color`,
  `--card-bg`).
- **Render only what's visible:** one-column boards render the active column only, not every
  column hidden with CSS.

### C0b. Remaining mockups (gates the screens it covers)

| # | Step | Effort | Why this level |
|---|------|--------|----------------|
| C0b | Draw what isn't drawn yet, on the same canvas: tab bar + Mais sheet + notification list (C1); Entregas Calendário, Concluídas, Novo fluxo / Novo post avulso, the forward/revert and client-approval confirmations as action sheets (C3); editor Produção section, thumbnail picker, version history, scheduled/failed bottom bar, the "…" menu, media long-press menu (C4) | medium | User approves UI from mockups before code |

### C1. Phone kit and navigation (PR)

| # | Step | Effort | Why this level |
|---|------|--------|----------------|
| C1.1 | Phone tokens in `style.css`: new `--phone-*` names under `@media (max-width: 767px)` scoped to `.app-container` (the Hub imports this stylesheet): grouped background, cell, separator, iOS type scale (34/22/17/15/13), sheet radius, light + dark | low | Tokens only, no behaviour |
| C1.2 | `components/mobile/`: `LargeTitleHeader`, `GroupedList`/`Cell` (chevron, value, switch, destructive), `SegmentedControl`, `ActionSheet`, `BottomSheet` (on the existing Radix Dialog, drag handle, detents medium/large, history entry, no new dependency), `ContextMenu` (long-press preview + actions, also on right-click; touch-callout and selection suppressed during the hold), `SwipeRow` (leading/trailing actions), `BottomActionBar`, `ChipRow`. Each with unit tests | high | Gesture and focus edge cases: long-press vs scroll, swipe vs horizontal scroll, focus return on sheet close (Radix controlled-dialog trap), safe areas |
| C1.3 | Tab bar: extend `MobileNav`'s `mobile-nav-glass` to Início / Entregas / Agenda / Mensagens / Mais with per-plan and per-role fallbacks (D18): the Agenda tab is gated locally on `feature_agenda` (not in `nav-data.ts`'s global map, which would hide the editorial Calendário from Free users on desktop); Clientes and Analytics move to the top of Mais | medium | Feature gating (`useEffectiveNavFeatures`, `routePermissions`) decides which tabs exist |
| C1.4 | Notification list on phones (AUDIT #1): bell in the large-title header of each tab root with the unread count, opening a full-screen list that reuses `NotificationList` | medium | Reuses data hooks; new layout |
| C1.5 | Shell fixes from AUDIT: Mais sheet top safe area (#2), guide chip overlap (#3), Mensagens timestamp wrapping (#4) | low | Known CSS fixes |
| C1.6 | Update tests that assert the old mobile nav markup | low-medium | Mechanical, but spread across suites |

### C2. Saved views on the server (PR, deploy migration before merge)

| # | Step | Effort | Why this level |
|---|------|--------|----------------|
| C2.1 | Migration (version ≥ 20261016000001: #669 holds 20261015000001/2; recheck main's tail at PR-open time): `entregas_saved_views (id, conta_id, user_id, name, query, position, created_at)`, unique `(user_id, conta_id, name)`. RLS on USING and WITH CHECK: `user_id = auth.uid() AND conta_id = public.get_my_conta_id()`. Explicit `REVOKE ALL ... FROM PUBLIC, anon` and `GRANT SELECT, INSERT, UPDATE, DELETE ... TO authenticated` (plus sequence), as `20261005000001_agenda_eventos.sql` does | high | RLS + workspace scoping |
| C2.2 | Entitlement SQL suite: own rows only; insert/update into another workspace refused by WITH CHECK; someone else's rows invisible; anon denied | medium | CI-gated security test |
| C2.3 | `store/savedViews.ts` + `useSavedViews` (TanStack Query). Importer: only the active workspace's `entregas_saved_views_<contaId>` key, skipped while `contaId` is the `'unknown'` fallback; insert with `ON CONFLICT (user_id, conta_id, name) DO NOTHING`; write a per-conta "imported" marker; keep the localStorage key (no delete) | medium | Idempotent across tabs and devices |
| C2.4 | Desktop switch: `VistasTabs` goes from synchronous `loadSavedViews()` to async rows keyed by `id` (initial `activeName` match, rename, remove); update `VistasTabs.test.tsx` and `EntregasPage.test.tsx`; check desktop in the browser | medium | Changes desktop behaviour with existing tests |
| C2.5 | Deploy order: staging `db push`, prod `db push` (user OK), then merge | medium | Merge ships the frontend instantly |

### C3. Entregas phone layout (PR)

| # | Step | Effort | Why this level |
|---|------|--------|----------------|
| C3.1 | Header: large title with the title menu (saved views, "Exibir como" the 6 views, "Mostrar" entity honouring the `postProcessesVisible` gate), Etapas/Status segmented control, counters line; a `+` menu for Novo fluxo / Post avulso and the Templates entry (`TemplatesModal`); search field; Minha fila's member and order pickers and Concluídas' client search move from VistasTabs' trailing slot into their views | medium | Wires to the existing `viewQuery` URL state (`applySavedView` reusable); no new state |
| C3.2 | Filters sheet (restyle of the existing ≤900px Filtros `Sheet` in `EntregasFilters`): every filter in `EntregasFilters` (Status, Cliente, Responsável, Responsável do post, Etapas, Templates, Prazo da etapa incl. Personalizado; Status do post and Tipo in Status mode) as chips + drill-in lists, "Limpar" and "Ver N" | low-medium | Restyle of an existing sheet |
| C3.3 | Kanban (Fluxos): one column at a time (only the active column rendered) with etapa chips, template switch, column sort, per-row "+ Novo" (fluxo / post individual) and "Criar template" CTA, `SemProcessoSection` below; card ✓ "Concluir etapa e avançar" honouring adjacent-only moves and the forward/revert and `ClientApprovalChoiceDialog` confirmations as action sheets | high | Move rules and confirmations must match desktop exactly |
| C3.4 | Kanban (Status): in Reordenar mode or from the handle, drag a card onto a status target; chips (incl. custom statuses from the registry) expand into a grid on drag start, since a chip row can't scroll mid-drag; undo toast; locked statuses refuse the drop; same-column manual order via the same mode | high | Drop targets change shape on phones |
| C3.5 | Card long-press menu (also the card's "…" button) carrying everything the desktop card has. Fluxo card (`WorkflowCard`): Abrir posts, Editar, Concluir etapa, Voltar etapa, Atribuir responsável, Copiar link, Abrir no Hub, Abrir cliente, Duplicar, Excluir; Recorrente badge kept. Post process card (`PostProcessCard`): Avançar/Concluir, Voltar, Encerrar processo, Duplicar, Excluir. Shared by Kanban, Lista, Fila | medium | One menu, many entry points, two card types |
| C3.6 | Lista and posts list as grouped rows (sections Atrasado/Hoje/Amanhã, Agrupar, Responsáveis, Mostrar postados), swipe Avançar / Mais | medium | Replaces sideways tables on phones |
| C3.7 | Fluxo sheet (`WorkflowDrawer` phone): Posts / Grade / Calendário / Histórico; header actions (Enviar N posts aprovados ao cliente, Copiar link) and the auto-schedule prompt/batch dialogs; per-post menu (Copiar link, Duplicar, Mover, Desmembrar, Remover); selection mode with "Mover para outro fluxo" / "Desmembrar"; post reorder in Reordenar mode | high | 1.6k-line component, multi-select state |
| C3.8 | Visão geral, Minha fila, Calendário, Concluídas phone layouts | medium | Mostly presentational |
| C3.9 | Touch drag: `TouchSensor` (`delay: 250, tolerance: 8`, the pattern in `WorkflowCalendarView` and `PostsKanbanView`) for `KanbanView`, `WorkflowDrawer`, `SortableEtapaList`, active only on drag handles / Reordenar mode on phones so it doesn't fight the long-press menu (also fixes `PostsKanbanView`, which has the conflict today) | medium | Gesture ownership, not just a sensor |
| C3.11 | Guided tour and help: the driver.js tour auto-starts on first visit and anchors desktop columns (`entregasTour.ts`); turn it off below 768px (and hide "Ver tour novamente"); `ComoFuncionaPanel` opens as a sheet | low | Avoid a broken tour on phones |
| C3.12 | Dialogs re-checked at phone width, unchanged unless broken: `WorkflowModals`, wizard, `NewAvulsoDialog`, `ApplyProcessDialog`, `DuplicateDialog`, Attach/Move/Detach, `MigrateTemplateDialog`, recurring settings; fixes go in this PR, a redesign doesn't | medium | Big surface, mostly forms that already fit |
| C3.10 | Update Entregas tests for the new mobile branch; add tests for chip drop, swipe actions, filter sheet, menu vs drag ownership | high | Every Entregas suite renders the mobile branch |

### C4. Post editor phone layout (PR)

On desktop the editor is `PostEditorBody` expanded inline inside `WorkflowDrawer` or
`StandalonePostDrawer`; that stays. On phones the expanded post becomes its own pushed screen with
its own history entry (today both drawers share one entry, `EntregasPage.tsx:550`, so edge-swipe
Back would close both layers). `?post=` deep links, which today set `expandedId`/`scrollTargetId`
in the drawer, open that screen directly. PR #429 (5-tab editor, closed, 233 commits behind main)
is reference only; its UI is not reused.

| # | Step | Effort | Why this level |
|---|------|--------|----------------|
| C4.1 | Shell: pushed screen with its own history entry, `?post=` deep-link entry; header (back, title, status chip menu, "…" with Copiar link, Duplicar, Histórico de versões, Aplicar processo, Anexar a fluxo, Mover, Desmembrar, Excluir as the context allows), Conteúdo / Detalhes / Publicar / Comentários segmented tabs, keep-mounted panes, `BottomActionBar` whose primary action follows status (Enviar ao cliente, Agendar, Agendado · Cancelar, Tentar novamente) | high | Caption drafts already register `useUnsavedWork` (`useCaptionDraft`); keep-mounted panes keep that true across tab switches |
| C4.2 | Conteúdo: media strip ("N de 10", Capa, Adicionar), long-press menu (reorder, Ajustar proporção, Escolher thumbnail, Usar como capa do Reel, Baixar, Remover), caption tabs per destination with comment highlights and count, Versões, Roteiro e briefing and Referências rows | high | Media reorder on touch (`PostMediaGallery` gets `TouchSensor`), comment anchors |
| C4.3 | Full-screen text editing for Roteiro and captions: TipTap formatting bar above the keyboard, positioned from `visualViewport` against the `#app` scroll container; selection menu with Comentar / Link. Verify separately in the app (`Keyboard.resize: 'native'`), mobile Safari and Chrome Android (`interactive-widget=resizes-content`) | high | Three different keyboard models |
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
| E1 | Wire plugins in the iOS project: Info.plist strings, entitlements, AppDelegate quick actions; decide portrait lock on iPhone (D17) | medium | Native config |
| E2 | Simulator end-to-end incl. `xcrun simctl push`, a phone-width pass over every C screen in the app, mobile Safari and Chrome Android, an 800px tablet pass, and a large-board performance check (many fluxos/posts) on a real iPhone | medium | Verification |
| E3 | Security review of the whole stack | max | Auth, RLS, OAuth, tokens |
| E4 | Apple Organization enrollment, APNs key, App Store Connect, TestFlight, submission | user-owned | Needs the company's Apple account |
