# Cookie consent (opt-in gate) — design

Status: revised after external review (Fable: 11 findings, Codex: 1, all applied). Pending user
review. Date: 2026-09-19.

## Problem

The CRM bundle (which also serves the landing page and every prerendered marketing route) loads
non-essential third-party trackers for every visitor with no consent step:

| Tool | Where it starts | What it does |
|---|---|---|
| PostHog | `apps/crm/src/main.tsx` → `initAnalytics()` (`lib/analytics.ts`) | Pageviews, exception capture, anonymous ID persisted in cookie/localStorage, and **session replay + heatmaps** (enabled on the PostHog project, started by `posthog.init` from remote config) |
| Sentry | `main.tsx` → `initSentry()` (`lib/sentry.ts`) | Error reporting and tracing. `replaysOnErrorSampleRate` is set but **inert**: no replay integration is installed |
| Crisp | inline snippet in `apps/crm/index.html` | Support chat widget, sets its own cookies |
| Vercel Analytics | `<Analytics />` in `apps/crm/src/App.tsx` (also Hub, Admin) | Cookieless page views; still receives IP and a hashed visitor id |

Under LGPD and ANPD's cookie guidance, non-essential cookies/storage need opt-in consent. Today
`/lgpd` and `/politica-de-privacidade` do not mention cookies at all.

Vercel Analytics is cookieless and stays on under legitimate interest, but it is disclosed on
`/lgpd`. Hub and Admin load nothing else: out of scope for the gate.

## Decisions (already made with the user)

1. **Opt-in gate.** Nothing non-essential runs until the user accepts.
2. **Crisp is gated** like the rest, including for logged-in users. No "essential support" carve-out.
3. Two consent categories: **analytics** (PostHog, including its session replay and heatmaps) and
   **support** (Crisp).
4. **PostHog session replay stays enabled** (no `disable_session_recording` added), gated by the
   analytics toggle and disclosed by name in the dialog and on `/lgpd`. `analytics.ts` sets no
   override today, so this preserves current behaviour. *Open for the user to confirm at spec
   review: if replay is not actually wanted, disabling it shrinks the consent surface and the
   disclosure.*

## Design

### 1. Consent store — `apps/crm/src/lib/consent.ts`

- Persists `consent_v1` in localStorage: `{ analytics: boolean, support: boolean, decidedAt: string }`.
  Absent key means "undecided". The `_v1` suffix lets a future category change re-prompt everyone.
- API: `getConsent(): Consent | null`, `setConsent(next)`, `subscribe(listener)` (also listens to the
  `storage` event so a decision in one tab reaches the others), plus `openConsentPreferences()`.
- Every storage access wrapped in try/catch (private mode, blocked storage), same discipline as
  `lib/crispSession.ts`. When storage is unavailable the store keeps the decision in memory for the
  session; nothing loads without an explicit choice.
- Plain module, no React dependency, so `main.tsx` and non-React code can use it.
- **Reactive binding for React consumers** lives in a separate `lib/useConsent.ts`
  (`useSyncExternalStore` over `subscribe`/`getConsent`), which keeps `consent.ts` React-free.
  Who uses what:
  - non-React (`main.tsx` boot listener, `crispLoader`, `analytics.ts`): `subscribe()` directly;
  - React (`AuthContext`, `TopBarActions`, `MobileNav`, banner, dialog): `useConsent()`.
  `AuthContext`'s Crisp identify effect lists `useConsent().support` in its dependencies, so a
  same-tab grant through the dialog re-triggers it; this is the trigger the tests assert on.
- **Legacy identifiers.** Every existing user already holds a PostHog `ph_*` identifier (localStorage
  + cookie, from `persistence: 'localStorage+cookie'` defaults) and a Crisp session cookie, from
  before this ships. On launch `consent_v1` is absent, so the common path is "Rejeitar todos"
  before any SDK initialised this session, where `opt_out_capturing()`/`reset()` would be no-ops.
  So: whenever effective consent for a category is not granted at boot or on reject, run an
  idempotent `purgeLegacyStorage(category)` that deletes the tool's storage directly, without
  initialising the SDK: analytics → localStorage keys starting `ph_`, and `ph_*` cookies;
  support → Crisp cookies (see section 2) and `crisp_session_v1`. Runs before/independently of any
  SDK call.

### 2. Gating

**Analytics (PostHog)** — `lib/analytics.ts`
Verified against posthog-js 1.402.3 (`node_modules/posthog-js/dist/module.js`); these details are
load-bearing.

- **Two flags, not one.** `analytics.ts` today uses a single `enabled` boolean as both "initialized"
  and "capturing". Split it: `initialized` (a `posthog.init` has run, never resets) and `capturing`
  (helpers may send). `captureEvent`/`identify*` check `capturing`. This is what makes
  accept → reject → accept safe, with exactly one path per state:
  - never initialized + grant → `posthog.init(...)` (idle-deferred as today), then
    `if (posthog.has_opted_out_capturing()) posthog.opt_in_capturing()`. The `__ph_opt_in_out_<token>`
    flag persists across page loads, so a user who revoked yesterday and accepts today would
    otherwise get an initialized but still opted-out SDK. `opt_in_capturing()` emits a `$opt_in`
    event by default; pass `{ captureEventName: false }`.
  - initialized + grant → `opt_in_capturing({ captureEventName: false })` only. Never a second `init`.
  - grant at boot (consent already stored) → same first path.
- **Revoke order is `posthog.reset()` first, then `posthog.opt_out_capturing()`.** `reset()` calls
  `consent.reset()`, which deletes the opt-in/out flag; the reverse order silently un-revokes and
  the SDK's own emitters (`$pageview`, `capture_exceptions`, autocapture, session recording) resume
  even though our helpers are off.
- **Add `opt_out_persistence_by_default: true` to `posthog.init`.** With the defaults, opt-out stops
  capture but leaves the `ph_<token>_posthog` identifier (distinct_id, device_id) in storage.
  With this option, opting out clears persistence.
- **Session replay and heatmaps are part of the analytics category.** They start from remote config
  inside `init` and are gated by the same opt-out check, so the one toggle covers them. The banner,
  dialog copy and `/lgpd` table must say "gravação de sessão e mapas de calor", not just "métricas".
- **Mid-session grant re-identifies.** `identifyWorkspaceUser` runs once, during profile hydration
  (`AuthContext.tsx:357`), and no-ops while not capturing. Under `person_profiles: 'identified_only'`
  a logged-in user who accepts later would be personless for the rest of the session. The grant
  handler re-runs identify (and `posthog.group`) from the current auth state, the same way the
  Crisp grant re-runs its identify effect.
- Consequence to accept: a signup completed without consent is not attributed in PostHog.

**Sentry** — `lib/sentry.ts`
- Error reporting and tracing stay on as legitimate interest (they keep the app debuggable and
  carry no cross-site tracking). Sentry replay is **not installed** (verified: no
  `replayIntegration`, and the default integrations contain none), so there is nothing to gate.
  **Delete the inert `replaysOnErrorSampleRate` option** rather than gate it; adding replay later
  is a new consent decision and needs a spec amendment.
- `tracesSampleRate` / `browserTracingIntegration` stay as-is (no personal storage).
- Data minimisation, small and adjacent: `httpContextIntegration` sends the page URL and
  `/conectar/:token` carries an invite token in the path. Scrub it in `beforeSend`/`beforeBreadcrumb`
  as part of this work, since the spec claims legitimate interest for Sentry.
- `Sentry.ErrorBoundary` in `App.tsx` is unaffected.

**Crisp** — `apps/crm/index.html` + new `lib/crispLoader.ts`
- The inline loader in `index.html` is reduced to `window.$crisp=[]; window.CRISP_WEBSITE_ID=…`.
  The queue is kept on purpose: `AuthContext`, `TopBarActions`, `MobileNav`, `AppLayout` and
  `LoginPage` push to `window.$crisp` and must stay harmless when the widget is not loaded.
- `loadCrisp()` injects `https://client.crisp.chat/l.js` once, on support consent (idle-deferred as
  today). Because prerender derives every static route from `dist/index.html`
  (`scripts/seo/prerender.tsx`), the one edit covers the landing and all marketing pages.
- Revoke: the loader cannot be unloaded cleanly, so revoke is best effort until reload. It must
  mirror `AuthContext`'s existing `signOut` teardown (`AuthContext.tsx:979-1000` and `:286-297`),
  in this order, or the documented `crisp-identity` race reopens:
  1. bump `crispResetGeneration` (an in-flight `crisp-identity` response must be discarded);
  2. null `window.CRISP_TOKEN_ID` and `clearCrispSessionCache()` (`crisp_session_v1` is
     Mesaas-owned, so a leftover would make the `matches` check at `:518` skip the rebind on
     re-grant);
  3. push `['do', 'session:reset']`, hide the chat;
  4. delete Crisp-owned storage. Crisp's documentation says its session is cookie-based
     (`crisp-client/*` family, first-party, shared across subdomains only via
     `CRISP_COOKIE_DOMAIN`), not localStorage; that could not be verified offline. So the
     implementation **enumerates `document.cookie` and `localStorage` in the Browser pane with the
     widget loaded, and deletes exactly what it finds**, rather than trusting either claim. Cookie
     expiry must use the same `domain=`/`path=` Crisp set, or it silently no-ops.
  The consent store is a plain module, so `AuthContext` subscribes to consent changes and performs
  1 to 3 itself; the identify effect additionally re-checks `getConsent()?.support` after its
  `await` in addition to the generation guard. The UI states the limit: "aplicado por completo ao
  recarregar a página".
- **Chat entry points must not silently fail.** `TopBarActions.openCrisp` and the `MobileNav`
  chat action currently push `chat:open`; with no widget loaded that is a dead click. Both go
  through a new `openSupportChat()` helper: if support consent is granted it does what they do
  today, otherwise it opens the consent dialog pre-scrolled to the support toggle with copy
  explaining that the chat needs the cookie. Grant → load Crisp → open chat.
- The `AuthContext` identify effect (`crisp-identity` invoke, `crispSession` cache) should skip its
  network call and cache writes while support consent is absent, and run once when consent is
  granted mid-session. Implementation must confirm the existing generation-counter logic
  (`crispResetGeneration`) still holds when the effect is re-triggered by a consent change.

### 3. UI — `apps/crm/src/components/consent/`

- `CookieConsent` (mounted once at the app root in `App.tsx`, outside route trees so it shows on
  the landing and on `/login`): bottom banner, visible only while `getConsent()` is null.
  Buttons: **Aceitar todos**, **Rejeitar todos**, **Personalizar**. Reject and Accept have equal
  visual weight (no dark pattern).
- `CookiePreferencesDialog` (shadcn `Dialog`): one switch per category with a one-line purpose,
  plus a read-only "Essenciais (sempre ativos)" row listing: Supabase auth token, language
  (`mesaas-language`), theme (`theme`), deploy-reload guard (`mesaas:deploy-reload-at`) and this
  consent choice. The many `entregas_*` / `guia_*` / `tour_done` / `mesaas_popup_*` localStorage
  keys are functional UI-preference state, not tracking; the `/lgpd` copy says so.
  Saves via `setConsent`.
- Re-entry points (withdrawal must be as easy as granting, LGPD art. 8 §5): link "Preferências de
  cookies" in the landing footer. `LandingChrome`/`LandingFooter` is only used by landing, precos,
  marketing and blog, so the legal pages (`/lgpd`, `/politica-de-privacidade`, `/termos-de-uso`),
  `/novidades` and `/login`, which render bare, get their own link or button. Logged-in: a row in
  `pages/configuracao` under the `perfil` tab (`configTabs.ts:55`, the only tab every role sees),
  plus the chat entry points above. The `/lgpd` cookie section's "how to revoke" is a live
  `<button onClick={openConsentPreferences}>`, not prose. All call `openConsentPreferences()`.
- Layout: banner respects the mobile bottom nav (offset by its height ≤900px) and `z-index` stays
  below dialogs. `position: fixed` anchored to the bottom only, so the sidebar breakpoint rules in
  DESIGN_SYSTEM.md do not apply. Tailwind + existing tokens, light and dark. Icons from
  `lucide-react`. Copy is pt-BR with no em-dashes; banner/dialog strings via the existing i18n
  `common` namespace (`useTranslation()` with no namespace argument, as in `MobileNav.tsx`), pt + en.
  Landing and legal copy is hardcoded pt, so the banner is the only translated element there;
  accepted.
- Accessibility: banner is a `role="region"` with a label, not a modal trap; dialog uses Radix
  focus management; both are keyboard operable.
- **Prerender and hydration.** `main.tsx` uses `createRoot().render`, not `hydrateRoot`, so the
  prerendered `#root` markup is replaced on load and a banner that appears only after JS runs
  causes no mismatch. Conversely, `scripts/seo/prerender.tsx` imports `LgpdPage` and runs it through
  `renderToStaticMarkup` in Node under `tsconfig.scripts.json` (`types: ["node"]`, which includes
  `apps/crm/src/pages/lgpd/**`). Anything `LgpdPage` imports (`lib/consent.ts`, the preferences
  button) must therefore have **no `window`/`localStorage`/`import.meta.env` access at module
  scope**; touch them only inside functions/effects. The banner is never rendered in prerender.

### 4. Legal copy

- `/lgpd` gets a "Cookies e armazenamento" section, and `/politica-de-privacidade` a short pointer
  to it. Table: tool, purpose, data, retention, provider/location, category. Rows: PostHog
  (analytics, **including session recording and heatmaps**), Crisp (support), Sentry (error
  reporting, legitimate interest, no replay), Vercel Analytics (cookieless, legitimate interest),
  essential storage. Includes how to revoke (live button) and the ANPD/LGPD basis (art. 7, I).
  **The exact retention periods and provider locations are filled from each vendor's settings, not
  guessed; unknown values are flagged to the user, not invented.**
- Logged-in help-center articles can embed third-party iframes (YouTube via TipTap `Youtube` and a
  generic `IframeExtension`, `pages/ajuda/ArtigoPage.tsx:62-63`). Switch the YouTube embed to
  `youtube-nocookie.com` if the extension allows it; otherwise list it in the legal table as a
  known third-party embed. Small, in scope only for the disclosure.

### 5. Out of scope

- Hub and Admin (cookieless Vercel Analytics).
- Server-side PostHog capture in edge functions (no browser storage).
- Auth/session/theme storage (essential).
- Third-party requests that are not cookie-based but still transmit IP: Google Fonts
  (`fonts.googleapis.com`) and `unpkg.com/@phosphor-icons/web` in `index.html`. Known LGPD/GDPR
  discussion point; flagged for a follow-up, not part of this work.
- Geo-targeting the banner. It shows to everyone.

## Testing

- Vitest, `consent.ts`: read/write/version bump, storage-unavailable fallback, cross-tab `storage`
  event, subscribe/unsubscribe.
- Vitest, `analytics.ts`: no `posthog.init` before consent; init on grant; `reset()` then
  `opt_out_capturing()` on revoke, in that order; accept → reject → accept calls `init` exactly once
  and `opt_in_capturing` on the re-grant; a stored opt-out flag from a previous session is cleared
  on a fresh grant; mid-session grant re-identifies; all helpers no-op while not capturing.
  Existing `analytics.test.ts` must keep passing.
- Vitest, `crispLoader`: script injected once, only after consent; chat entry point opens the
  dialog when consent is missing and opens the chat when present.
- Component tests: banner visible only when undecided; accept/reject/customize persist the right
  values; equal-weight buttons; preferences link reopens the dialog after a decision.
- `AuthContext` tests: no `crisp-identity` invoke without support consent; one invoke after grant;
  revoke bumps the generation and clears the cache; an in-flight identify response after revoke is
  discarded.
- **Existing tests that break unless updated in the same change:**
  - `apps/crm/src/context/__tests__/AuthContext.test.tsx` (the "Crisp identification" cases,
    ~485-793): assert `user:email` pushes with no consent seeded; `beforeEach` must write
    `consent_v1` with `support: true`.
  - `apps/crm/src/__tests__/App.test.tsx`: the banner now renders in all cases; mock set gains a
    consent dependency.
  - `e2e/screenshots/landing-hero.spec.ts`, `landing-features.spec.ts`, `kb-agosto.spec.ts`: seed
    consent via `addInitScript` or the banner lands in marketing screenshots.
  - `LoginPage.test.tsx` and the `AppLayout` `chat:hide` pushes keep passing only because the
    `window.$crisp` queue stays in `index.html`; keep that decision.
- Browser verification (Browser pane, desktop + mobile widths, light + dark): with a clean profile,
  the network panel shows **zero** requests to `posthog` and `crisp.chat` before consent, and they
  appear after Accept; Reject keeps them absent across reload; revoke from the footer link stops
  PostHog capture and leaves no `ph_*_posthog` key in storage. Sentry error/tracing envelopes are
  expected before consent (legitimate interest); the check for Sentry is only that no **replay**
  envelope is ever sent.
- Before pushing: `npm run lint`, `npm run format:check`, the four `tsc` projects, `npm run test`.

## Risks

- **Attribution loss.** Signups that reject analytics are invisible to PostHog funnels. Expected
  and accepted; note it for the retention/activation dashboards.
- **Crisp unload is best-effort** (see above); the UI copy must not overpromise.
- **Consent is per browser, not per account.** It lives in localStorage only. A logged-in user on
  a new device or browser sees the banner again and has no support chat until they accept
  (direct consequence of decision 2). Accepted; syncing consent to the account (and the
  audit-trail value of that) is a possible follow-up, out of scope here.
- **Launch-day banner for everyone**, including long-standing users, because no prior consent is on
  record. Expected.
- **PostHog revoke correctness depends on call order and init options** (section 2); a test pins
  both because the wrong order fails silently.
- **Banner over CLS/perf.** The banner must not shift layout (fixed position) so the landing's
  PageSpeed work (`idle` init of PostHog/Crisp) is not regressed.
