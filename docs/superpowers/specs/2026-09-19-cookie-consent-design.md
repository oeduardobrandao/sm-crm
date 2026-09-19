# Cookie consent (opt-in gate) — design

Status: draft, pending review. Date: 2026-09-19.

## Problem

The CRM bundle (which also serves the landing page and every prerendered marketing route) loads
non-essential third-party trackers for every visitor with no consent step:

| Tool | Where it starts | What it does |
|---|---|---|
| PostHog | `apps/crm/src/main.tsx` → `initAnalytics()` (`lib/analytics.ts`) | Pageviews, exception capture, anonymous ID persisted in cookie/localStorage |
| Sentry | `main.tsx` → `initSentry()` (`lib/sentry.ts`) | Error reporting, tracing, `replaysOnErrorSampleRate: 1.0` |
| Crisp | inline snippet in `apps/crm/index.html` | Support chat widget, sets its own cookies |

Under LGPD and ANPD's cookie guidance, non-essential cookies/storage need opt-in consent. Today
`/lgpd` and `/politica-de-privacidade` do not mention cookies at all.

Hub and Admin only use `@vercel/analytics`, which is cookieless: out of scope.

## Decisions (already made with the user)

1. **Opt-in gate.** Nothing non-essential runs until the user accepts.
2. **Crisp is gated** like the rest, including for logged-in users. No "essential support" carve-out.
3. Two consent categories: **analytics** (PostHog + Sentry replay) and **support** (Crisp).

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

### 2. Gating

**Analytics (PostHog)** — `lib/analytics.ts`
- `main.tsx` calls `initAnalytics()` only when `getConsent()?.analytics` is true, both at boot and
  on a later grant via `subscribe`. The existing idle-callback deferral is kept.
- On revoke: `posthog.opt_out_capturing()` then `posthog.reset()`, and the module's `enabled` flag
  goes false so `captureEvent`/`identify*` no-op again. A later re-grant calls
  `posthog.opt_in_capturing()` instead of re-running `posthog.init`.
- `identifySignup` / `identifyWorkspaceUser` keep working unchanged: they already no-op when
  `enabled` is false. Consequence to accept: a signup completed without consent is not attributed
  in PostHog.

**Sentry** — `lib/sentry.ts`
- Error reporting stays on as legitimate interest (it is what keeps the app debuggable and carries
  no cross-site tracking). **Replay is the consent-gated part**: `replayIntegration` is added only
  when analytics consent is granted, and removed/closed on revoke. If the current config does not
  actually enable a replay integration, `replaysOnErrorSampleRate` is inert today and the gate is a
  no-op to verify during implementation, not to invent.
- `tracesSampleRate` / `browserTracingIntegration` stay as-is (no personal storage).

**Crisp** — `apps/crm/index.html` + new `lib/crispLoader.ts`
- The inline loader in `index.html` is reduced to `window.$crisp=[]; window.CRISP_WEBSITE_ID=…`.
  The queue is kept on purpose: `AuthContext`, `TopBarActions`, `MobileNav`, `AppLayout` and
  `LoginPage` push to `window.$crisp` and must stay harmless when the widget is not loaded.
- `loadCrisp()` injects `https://client.crisp.chat/l.js` once, on support consent (idle-deferred as
  today). Because prerender derives every static route from `dist/index.html`
  (`scripts/seo/prerender.tsx`), the one edit covers the landing and all marketing pages.
- Revoke: the loader cannot be unloaded cleanly. Push `['do', 'session:reset']`, hide the chat,
  delete Crisp cookies/storage keys it owns (`crisp-client/*` in localStorage, `crisp-client*`
  cookies), and set a flag so the widget stays hidden. A full effect is guaranteed on next load;
  the UI states this ("aplicado por completo ao recarregar a página").
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
  plus a read-only "Essenciais (sempre ativos)" row for auth session, theme and this choice.
  Saves via `setConsent`.
- Re-entry points: link "Preferências de cookies" in the landing footer (`LandingChrome.tsx`), a
  row in the logged-in app settings (`pages/configuracao`), and the chat entry points above.
  All call `openConsentPreferences()`.
- Layout: banner respects the mobile bottom nav (offset by its height ≤900px) and `z-index` stays
  below dialogs. `position: fixed` anchored to the bottom only, so the sidebar breakpoint rules in
  DESIGN_SYSTEM.md do not apply. Tailwind + existing tokens, light and dark. Icons from
  `lucide-react`. Copy is pt-BR with no em-dashes; strings via the existing i18n `common`
  namespace (pt + en).
- Accessibility: banner is a `role="region"` with a label, not a modal trap; dialog uses Radix
  focus management; both are keyboard operable.

### 4. Legal copy

- `/lgpd` gets a "Cookies e armazenamento" section, and `/politica-de-privacidade` a short pointer
  to it. Table: tool, purpose, data, retention, provider/location, category. Includes how to revoke
  and the ANPD/LGPD basis (art. 7, I). **The exact retention periods and provider locations are
  filled from each vendor's settings, not guessed; unknown values are flagged to the user, not
  invented.**

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
- Vitest, `analytics.ts`: no `posthog.init` before consent; init on grant; opt-out + reset on
  revoke; re-grant does not double-init; all helpers no-op while disabled. Existing
  `analytics.test.ts` must keep passing.
- Vitest, `crispLoader`: script injected once, only after consent; chat entry point opens the
  dialog when consent is missing and opens the chat when present.
- Component tests: banner visible only when undecided; accept/reject/customize persist the right
  values; equal-weight buttons; preferences link reopens the dialog after a decision.
- `AuthContext` tests: no `crisp-identity` invoke without support consent; one invoke after grant.
- Browser verification (Browser pane, desktop + mobile widths, light + dark): with a clean profile,
  network panel shows **zero** requests to `posthog`, `crisp.chat` and Sentry replay endpoints
  before consent, and they appear after Accept; Reject keeps them absent across reload; revoke
  from the footer link stops PostHog capture.
- Before pushing: `npm run lint`, `npm run format:check`, the four `tsc` projects, `npm run test`.

## Risks

- **Attribution loss.** Signups that reject analytics are invisible to PostHog funnels. Expected
  and accepted; note it for the retention/activation dashboards.
- **Crisp unload is best-effort** (see above); the UI copy must not overpromise.
- **Sentry replay** assumption needs verification against the real config (see section 2).
- **Banner over CLS/perf.** The banner must not shift layout (fixed position) so the landing's
  PageSpeed work (`idle` init of PostHog/Crisp) is not regressed.
