# Workspace language: English app, Hub and emails (US launch, part 3)

Part 3 of the US launch. Part 1 (USD billing, #879) and part 2 (`/en` site and signup, #881,
#882) are merged and deployed. A US agency can now sign up through `/en`, pay in USD and land in
an English app, but much of what it and its clients see after that is still Portuguese.

## Intent

A US agency that signs up through `/en` gets the whole product in English: the signed-in CRM, the
emails Mesaas sends to the agency team, the Hub its clients use, and the emails and documents
those clients receive. A Portuguese approval email reaching an American agency's client reads as a
broken product and costs the agency its credibility, so the client-facing side matters as much as
the agency side.

## Goals

- One language per workspace, `pt` or `en`, stored on the server.
- New `/en` signups get `en` automatically; existing USD workspaces are backfilled to `en`.
- The workspace owner can change it in Configurações.
- Every email Mesaas sends on behalf of a workspace, to the team or to the agency's clients, is in
  the workspace language, with dates and money formatted for it.
- iOS push notifications follow the same language.
- The Hub opens in the workspace language.
- The CRM app starts in the workspace language in a browser that has no saved choice.
- The remaining hard-coded Portuguese in the signed-in CRM is moved into the translation files.

## Non-goals

- Per-person language (option B in the conversation). It can be layered on later: a nullable
  `profiles.language` that overrides the workspace one for that person's team emails.
- Languages other than `pt` and `en`.
- Translating user-generated content (post captions, briefings, client names, task titles).
- The platform Admin app and Mesaas-internal emails (retention radar, affiliate program, the Resend
  backfill in `platform-admin`): they serve the Mesaas team or Brazilian affiliates.
- The public Portuguese site and its legal pages (`/lgpd`, `/termos-de-uso`,
  `/politica-de-privacidade`): Brazil-only by design; `/en` has its own.
- The blog, the Central de Ajuda (KB articles) and the in-app tutorial videos.

## Anti-goals

- A Brazilian workspace receiving anything in English that nobody asked for. Default is `pt`, and
  every path that cannot resolve a language falls back to `pt`. A person's own pt/EN toggle in their
  browser is a deliberate preference and is honored over the workspace language for their screen
  only; it never changes what the workspace sends.
- Coupling language to billing currency. A USD workspace can be `pt` and a BRL one `en`; only the
  initial default and the backfill read the currency/market.
- A workspace-language change silently overriding a choice a person made with the pt/EN toggle in
  their browser.

## Decisions taken in the conversation

- Scope covers the agency AND its clients (Hub, client emails).
- Option A: one language per workspace. Not per person, not derived from currency.

## Approaches considered

| | Where the language lives | Trade-off |
|---|---|---|
| **A (chosen)** | `workspaces.language` | One setting; every sender reads one column. A Brazilian freelancer in a US agency gets English emails. |
| B | `profiles.language` for team emails + workspace language for clients | Right for mixed teams; two settings and every team sender resolves per recipient, ~1.5x the work. Can be added on top of A later. |
| C | Derived from `billing_currency` | No migration, but money and language are welded together; dropped. |

## Design

### 1. Storage

- `workspaces.language text not null default 'pt' check (language in ('pt','en'))`.
- Set to `en` at signup when `raw_user_meta_data ->> 'market' = 'us'`, in the same path that sets
  `billing_currency = 'usd'` (trigger `on_auth_user_created_zz_billing_market`) and in
  `billing_market_apply()` (the fallback the `/en` signup calls). Setting the language never fails
  the signup: same WARNING-and-continue behavior as the currency.
- Backfill: `update workspaces set language = 'en' where billing_currency = 'usd'`.
- CRM writes go through an RPC `workspace_set_language(p_language text)` (owner of the active
  workspace only). The RPC alone is not enough: the `ws_update_owner_admin` policy lets any member
  with `configuracoes:editar` (admins too) UPDATE `workspaces` directly. Extend the existing
  `workspaces_guard_billing_columns()` pattern (refuses changes from `anon`/`authenticated`) to
  `language`, so only the SECURITY DEFINER RPC and the service role can change it. The CRM reads it with the active workspace row; add the
  column to whatever select or view feeds that.
- Edge functions read it with the service role next to the data they already load (by `conta_id`).

### 2. CRM app

- Two browser keys instead of one (shared by the CRM and the Hub, same origin):
  - `mesaas-language`: an **explicit** choice, written only by the pt/EN toggle (CRM sidebar, Hub
    sidebar and mobile nav) and by the Configurações select.
  - `mesaas-site-language`: a **hint**, written by visiting `/en` (`EnglishPage`) and by the `/en`
    signup (`signupMarket.ts`), which today write `mesaas-language`.
  - `getSavedLanguage()` keeps returning `pt` for "nothing stored"; add a read that says whether an
    explicit choice exists, and one for the hint.
  - One-time migration on boot: an existing `mesaas-language` value is moved to the hint key, since
    today it cannot be told apart from an `/en` visit. Cost: someone who toggled to English before
    this ships sees the workspace language once and toggles again.
- Resolution:
  - Signed-in app: explicit → workspace language → hint → `pt`. Until the workspace loads, the app
    renders with explicit → hint → `pt` and then switches if the workspace says otherwise (the
    workspace row is already loaded before the shell renders its content in practice).
  - Pre-auth pages (login, configurar-senha, conectar): explicit → hint → `pt`.
  - `/en` pages: always `en`; Portuguese-only public pages: always `pt` (#882).
  - The workspace language and the hint are applied with the non-saving `i18n.changeLanguage`.
- Settings: a workspace-language select in Configurações (workspace section), owner only, with a
  line saying it sets the language of emails and the Hub for the team and the clients. Changing it
  also applies and saves it in the owner's current browser.
- Move the remaining hard-coded Portuguese of the signed-in app into
  `packages/i18n/locales/{pt,en}`. Known clusters: account analytics (desktop and phone), analytics
  phone, report editor, import wizard, flows analytics, in-app guide
  (`components/guide/guideContent.tsx`), MCP consent page (`pages/oauth/ConsentPage.tsx`),
  configurar-senha, contratos, paywall lock screen, the cookie-preferences button on `/login`, and
  date-fns calls hard-wired to `ptBR` (switch to `useDateFnsLocale()`). The locale parity test
  covers the new keys.
- A guard test that fails on new hard-coded Portuguese in signed-in CRM `.tsx` files (accented JSX
  text or string literals), with an allowlist for the Brazil-only public pages, so the gap does not
  reopen.

### 3. Hub

- `hub-bootstrap` returns `language` (the workspace's) in both the success payload and the
  `login_required` payload (`login.workspace`), so the Hub login screen is translated too. The Hub applies it on boot with the
  non-saving change unless an explicit choice exists (the Hub already has a pt/EN toggle in
  `HubSidebar` and `HubMobileNav`, which call `changeLanguage` and so write the explicit key).
- The Hub locale files exist; fill any untranslated Hub strings found while testing.
- The Hub login-code email (`hub-auth/email.ts`) uses the workspace language: `hub-auth`'s
  `resolveLink` adds `language` to its `workspaces` select and passes it to the sender, and its own
  response messages to the login screen follow it.

### 4. Emails and push

- New `_shared/i18n/` in edge functions: `Lang = 'pt' | 'en'`, `resolveLang(value): Lang` (unknown
  → `pt`), `intlLocale(lang)` (`pt-BR` / `en-US`), date and money formatters, and one copy catalog
  per email family with a pt/en key-parity test. Edge functions cannot import `packages/i18n`
  (bundle boundary), so the catalogs live here.
- The shared shell (`_shared/email/shell.ts`) takes `lang` for `<html lang>` and its footer copy.
- Every sender in scope loads the workspace language and passes it down:
  - Agency team: `notify.ts` / `notification-email.ts` / `notification-render.ts` (digest),
    `notification-push-cron` (APNs title and body), `invite-email.ts` (member invites),
    `dunning-email.ts`, `lifecycle-emails.ts` (welcome, thank-you, trial reminder, nurture,
    reverse-trial emails), `instagram-connect-email.ts`, and the report-ready emails from
    `report-worker` and `instagram-analytics`.
  - Agency clients: `client-event-email-cron` / `client-event-email.ts`, `agenda-cliente-email`,
    `agenda-lembretes-email` / `agenda-email.ts` (external invitees included), `hub-auth/email.ts`.
- The Resend `type` tag (email metrics) does not change with language.
- Nurture: English copy variants. The `nurture-unsub` confirmation page resolves the language the
  same way as the nurture send (the profile's owned workspace, oldest if several), so the signed
  token (`{u}`) does not change and already-sent links keep working.
- Supabase Auth templates (Reset password, Invite user, Magic link) branch on `.Data.language`, the
  way "Confirm sign up" already branches on `.Data.market`; a missing value renders Portuguese
  (`printf "%v"` guard, as today). `raw_user_meta_data.language` is per user, so its source is fixed:
  - the workspace the user **owns** (the oldest if several; set at signup from `market`, rewritten when
    the owner changes the workspace language);
  - otherwise the workspace that **invited** them, written by `invite-actions.ts` in the
    `inviteUserByEmail` data and on resend; a later invite from another workspace overwrites it.
  - Removing a member does not rewrite it. Changing workspace A's language rewrites only A's
    owner's metadata, never a member's.
  - Accepted limitation: these Auth emails (password reset, magic link) run without any workspace
    context, so for someone in workspaces of two languages they follow one rule above, not the
    workspace they were thinking of. That is a per-person language in disguise and stays a
    best-effort until per-person language exists (non-goal). Template edits are a dashboard step in the runbook,
    staging then prod.
- Owner-addressed emails without an event workspace (welcome, trial reminder, nurture,
  reverse-trial) use the workspace the owner owns; one is created at signup
  (`on_auth_user_created_workspace`), and an owner of several uses the oldest. Event emails use the event's workspace.

### 5. Client-facing documents and AI text

- Block reports (`report-docs`, `_shared/report-template`, PDF via Gotenberg) render their fixed
  labels in the workspace language at render time. `report-docs` does not load `workspaces` today
  (`generate.ts`), so the language is loaded once per request and threaded through generate,
  refresh-data and PDF export; the print page reads it from the document's workspace. A stored PDF (`pdf_storage_path`) is not
  invalidated by a language change; the next export renders in the new language.
- AI narratives in reports (Gemini, client-facing) use the workspace language. The comments
  analysis (Workers AI) is read only by the agency inside the CRM, so it keeps its current contract:
  the CRM sends `?lang=` with the requester's UI language, which after section 2 already defaults to
  the workspace language. Text already stored in `data_snapshot` or in saved analyses
  stays in the language it was generated in until the user regenerates it.
- Out of scope: error and status strings that edge functions return to the CRM (Instagram,
  TikTok, Google, import, MCP). The CRM shows its own translated message for known error codes;
  remaining raw server strings are a follow-up.

## Constraints

- Default and every failure path is `pt`.
- `<html lang>` follows the rendered language (CRM through the existing `languageChanged` sync,
  emails through the shell).
- No em-dashes in user-facing copy, in either language.
- Edge functions never return raw errors; a language lookup failure logs and falls back to `pt`,
  never fails a send.
- Deploy order: migration → edge functions → Auth templates (staging, then prod) → merge of the
  frontend that reads the column. Each later PR states its own order.

## Calls made after review (not discussed in the conversation)

- `/en` visits are a hint, not a choice: only the toggle and the Configurações select count as
  explicit (section 2). Otherwise a Brazilian owner who once browsed `/en` would be stuck in English.
- Auth metadata language follows the owned workspace, else the inviting one (section 4).
- Owner lifecycle emails use the owned workspace (section 4).
- Stored PDFs and stored AI text are not regenerated on a language change (section 5).
- Server error strings shown in the CRM are out of scope (section 5).
- After an external review: an admin cannot change the language by a direct UPDATE (section 1);
  the Hub login screen and the Hub login-code flow get the language (section 3); nurture
  unsubscribe resolves the language without a token change (section 4); the comments analysis keeps
  the requester's `?lang=` (section 5).
- The hard-coded-Portuguese guard ships with a shrinking baseline.

## Left to the builder

- Key names and namespace split for the new CRM strings.
- Placement and exact copy of the Configurações select.
- How the edge catalogs are split per email family.
- Whether the guard is a Vitest file scan or an ESLint rule. It starts from a baseline list of the
  files that still have hard-coded Portuguese and fails on any file outside it; each sweep PR
  shrinks the list, so the guard can land in the first PR.

## Open risks

- Volume: about 30 CRM files plus about 15 email senders. The plan should split into independent
  PRs (storage + settings + Hub; emails and push; CRM string sweep; reports and AI) that ship and
  get reviewed alone, storage first.
- Recurring emails (digests, nurture) switch language on the next send after the backfill;
  acceptable.
