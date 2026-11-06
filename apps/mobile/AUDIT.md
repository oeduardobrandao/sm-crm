# Phone-screen audit (A2)

iPhone 18 Pro Simulator (402×874 pt), iOS 27, app loading prod `www.mesaas.com.br`, logged in as the
owner. Read-only browsing on 2026-10-10. Feeds step C9 (CRM fixes) and A3 (shell fixes).

## Findings

| # | Where | Finding | Severity | Fix in |
|---|-------|---------|----------|--------|
| 1 | Every page | **No notification center on phones.** `AppLayout` renders `TopBar` (which holds `NotificationBell`) only when `!isMobile`, and `MobileNav` has no bell. The push-centred app has no in-app list of notifications. | High | C9 (bell in the mobile header or a "Notificações" entry in Mais, with unread count) |
| 2 | "Mais" sheet | The sheet ignores the top safe area: avatar, name and the close button sit under the status bar and Dynamic Island. | Medium | C9 (`padding-top: env(safe-area-inset-top)` on the sheet) |
| 3 | Every page | The floating guide chip (book + count, top right) overlaps content: the "Ver tour novamente" link on Entregas, the first card on Dashboard, the conversation tabs in Mensagens. | Medium | C9 (move it or hide it in the app) |
| 4 | Mensagens thread | Event rows use three narrow columns; timestamps wrap onto 3-4 lines ("· 28 / de / set., / 17:03"). | Low | C9 |
| 5 | Links | Long-press on a link opened Safari's link preview ("Open Link", "Add to Reading List"); "Open Link" leaves the app. | Medium | A3, done (`allowsLinkPreview = false`) |
| 6 | Login | "Criar Conta" tab is visible. | Required | C1 (hide sign-up in the app) |
| 7 | Links | Absolute links to the apex `mesaas.com.br` would open in Safari (apex not in `allowNavigation`). | Low | A3, done |
| 8 | Route changes | 2-4 s before a new route paints on first visit (lazy chunks fetched from prod). Not a layout bug; worth a skeleton check later. | Note | - |

## Looked fine at phone width

Dashboard ("Hoje"), Clientes list and detail, Entregas kanban (horizontal lanes, next lane peeks),
workflow panel, post editor (only the status select truncates its label), Agenda (list view),
Mensagens list, bottom navigation and the home indicator area.

## Not covered

Keyboard with the message composer, uploads from the photo library, dark mode, the Mensagens
reply flow (would write to prod).
