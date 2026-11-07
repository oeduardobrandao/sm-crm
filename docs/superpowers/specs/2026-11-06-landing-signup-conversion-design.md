# Landing + signup conversion fixes

Date: 2026-11-06. Source: PostHog analysis of `www.mesaas.com.br/` (Oct 7 to Nov 6, anonymous
visitors only, analytics-consented only). Mockups: Design canvas "Landing e cadastro: conversão"
(https://claude.ai/artifact/97PiggcESMFGRmtKcbitWE).

## Why

Paid traffic started Oct 31 (Google Ads) and Nov 4 (Meta Ads). Measured funnel, test accounts
excluded: 227 anonymous landing sessions → 61 opened the signup form (27%) → 10 signups (4.4%).
Since Oct 31, 31 phone visitors opened the signup form and none completed it. Google Ads: 76
landing sessions, 62% left without a second page, 27 opened the form, 0 signups.

What the data showed:

- **Conversions start at the top of the page.** Hero "Começar teste grátis" (26 sessions), header
  "Criar conta grátis" (19). Pricing and final-CTA buttons get a handful.
- **The primary CTA is not on the first screen.** Laptop 1470×762: hero CTAs start at y=759
  (fold 762). Phone 384×730 on a first visit: the cookie banner (y 540–714) covers
  "Começar teste grátis" (y 623–679). The 83px promo bar (phone) / 41px (desktop) pushes both down
  and repeats the hero's "30 dias grátis" note; closing it is the top non-CTA click (~20 sessions).
- **Phone abandonment** (sessions that left, n=49): 37% never left the hero, 29% left inside the
  features section (4,247px, about six phone screens, 6 cards).
- **The signup form leaks.** 8 Google Ads sessions pressed "Criar Conta" 19 times with about 3 real
  submits: native `required` validation blocks silently on phones across 6 required fields. A real
  server error surfaces the raw Supabase message.
- **Existing customers on phones log in through the signup CTA** because the phone header has no
  "Entrar" link (seen in recordings), inflating signup-intent numbers.

Phone viewports of anonymous prospects: height p10 663 / p25 695 / p50 736; width p10 360 / p50 392.

## Goals

1. On first visit, the primary hero CTA is fully visible without scrolling, with the cookie banner
   open, at: phone 360×660, 375×667, 384×730, 390×844; laptop 1280×720, 1366×768, 1470×762,
   1440×900.
2. Signup form asks for name, email, password only. Company + phone (required) + WhatsApp opt-in
   move to the existing post-signup workspace step, which is restyled to match the auth page.
3. Phone features section shows 4 cards plus a "Ver todas as funcionalidades" disclosure; a CTA
   follows the section on all viewports.
4. Phone header shows "Entrar".
5. Google Ads final-URL suffix documented (account setting, no code).

## Non-goals

- No backend change: no migration, no edge-function deploy. `handle_new_user` stays as is; the
  signup now sends `empresa: ''` on purpose (see §3).
- No copy rewrite of the hero headline or features, no new sections, no A/B framework.
- No section-view instrumentation (separate follow-up).
- Desktop features keep all 6 cards.
- No change to the Admin, nurture or Loops/Crisp handling of a blank workspace name (see Risks).

## Anti-goals

- Hydration mismatch or layout shift on the prerendered `/` (all new state starts in the same
  value on server and first client render; no `matchMedia`/`innerWidth` reads in render).
- Making "Rejeitar" less prominent than "Aceitar" in the cookie banner (LGPD).
- Losing the plan intent (`?plan=…&interval=…`) or any other deep link on the way through the
  setup step, including across a reload and the email-confirmation round trip.
- Existing accounts being sent to the setup step, or an existing workspace's slug changing (hub
  links already sent to clients embed it).
- New workspaces ending up with a `workspace-<8hex>` client-portal URL.

## Design

### 1. Above-the-fold hero (landing)

- **Remove the promo bar**: `PromoBanner` and its store in `LandingPage.tsx`, its CSS in
  `landing.css`/`landing-v2.css`, the `mesaas_promo_dismissed` pre-paint branch in
  `apps/crm/index.html` (`data-promo-dismissed`), and the related tests. Keep the `SkipLink` first
  in the page.
- **Hero offer note** becomes `30 dias grátis em qualquer plano pago. Cancele quando quiser.`
  (`LANDING.hero.note`), with "30 dias grátis" emphasised. Nothing else in the hero copy changes.
- **Desktop sizing**: reduce `.hero-title` (now `clamp(2.6rem, 7.4vw, 6.4rem)`, about 102px at
  1470), its max-width, `.hero-sub` and the vertical gaps so both CTAs end at least 24px above the
  fold at every laptop size in Goal 1 (mockup: title about 68px, max-width about 1000px, sub about
  20px, CTAs ending near y=500 at 1470×762, the product mockup visible below). Exact values are
  the builder's call, verified in the browser at each size.
- **Phone sizing** (≤720px): smaller title (about 36px at 384, 33px at 360) and sub (about 16px),
  tighter `.lp2-offer` padding and 50px buttons, so the primary CTA ends above the compact cookie
  banner's top edge at every phone size in Goal 1.

### 2. Compact cookie banner (global, `components/consent/CookieConsent.tsx`)

- Applies on every page (one component, mounted in `App.tsx`).
- Phone: no visible title (the region keeps `aria-label` from `cookies.banner.title`), one short
  sentence plus the LGPD link, then the three buttons in one row (Personalizar · Rejeitar · Aceitar),
  same variants as today. New key `cookies.banner.bodyShort` (pt and en):
  `Usamos cookies para análise de uso, incluindo gravação de sessão, chat de suporte e medição de anúncios.`
  with link text `Detalhes` → `/lgpd`. Session recording stays named because it is the most
  sensitive processing. Button labels shorten to `Rejeitar` / `Aceitar` (new keys or updated
  ones, pt and en). Target height about 110px at 360px wide.
- ≥640px: one row, the short sentence left, buttons right.
- Banner keeps `fixed bottom` placement and z-index. Behaviour (consent storage, dialog, focus
  return) is unchanged; `CookieConsent.test.tsx` keeps passing with copy updates only. Banner
  rules stay in `style.css` (core); the now-unused title rule may be removed.

### 3. Shorter signup form (`pages/login/LoginPage.tsx`)

- Fields: Nome completo, E-mail, Senha (existing `PasswordInput` with show/hide, help text
  "Mínimo de 8 caracteres."). Remove Empresa, Telefone + hint, Confirmar senha and the marketing
  opt-in checkbox from this form. Keep the input ids `reg-nome`, `reg-email`, `reg-password`
  (`signupStarted` and tests rely on them).
- A short line under the button: `Depois de confirmar o e-mail, você informa o nome da agência e o telefone.`
- `noValidate` on the form; validate on submit, then on blur/change after the first attempt:
  nome non-blank, email format, senha ≥ 8 chars. Errors render under each field in
  `--danger-text` (`aria-invalid`, `aria-describedby`), focus moves to the first invalid field.
  No toast for field errors. Copy: `Informe seu nome.`, `Informe um e-mail válido, como nome@empresa.com.`,
  `A senha precisa ter pelo menos 8 caracteres.`
- Server errors map to Portuguese messages: rate limit, weak/short password, invalid email, and a
  generic fallback. Never show raw `error.message`. The existing-account and unconfirmed branches
  stay as they are.
- `signUp` metadata: `nome`, `empresa: ''`, `ref_code` (if any). No `telefone`, no
  `marketing_opt_in`. Why `''`: `handle_new_user` does `COALESCE(empresa, 'Meu Workspace')`, so
  omitting the key would name the workspace "Meu Workspace" and make `profiles.empresa` truthy,
  skipping setup. With `''` the trigger writes `''` to `workspaces.name`, `contas.nome` and
  `profiles.empresa`, and the slug becomes `workspace-<8hex>` (its `'' → 'workspace'` fallback).
  The existing `needsSetup` check (`!profile.empresa`) then routes the owner to setup with no new
  flag, and this is rollback-safe: old frontend code applies the same check. No CHECK constraint
  exists on `workspaces.name` or `contas.nome`. Update the `signUp` meta type if needed.
- Analytics unchanged: `identifySignup` → `signup_completed`, Meta `CompleteRegistration`,
  `markSignupStarted`.
- i18n: add the error keys (pt and en). `register.phoneHint` and `register.marketingOptIn` move
  with the fields; delete other unused `register.*` keys or leave them (builder's call).

### 4. Post-signup step (`pages/workspace-setup/WorkspaceSetupPage.tsx`)

- **When shown**: unchanged. `ProtectedRoute` `needsSetup` stays
  `role === 'owner' && profile !== null && !profile.empresa`, excluding `/workspace-setup`.
  Existing accounts with a company name never see it; legacy owners with a blank company already
  see it today.
- **Deep link kept, reload-safe**: the redirect goes to `/workspace-setup?next=<encoded path+search>`
  of the page that was requested (query, not router state, so it survives a reload and a cold
  open). On success the page continues to `next` when it is a same-origin path (starts with `/`,
  not `//`, not `/workspace-setup`), else to `/comecar` as today. So `/comecar?plan=…&interval=…`
  from the email-confirmation login keeps its intent, and other targets (for example
  `/oauth/consent?…`) are not dropped. `useTrialOfferRedirect` still runs after setup as today.
- **Fields**: Seu nome (prefilled from the profile, editable), Nome da empresa ou agência
  (required, starts empty), Telefone / WhatsApp (required, `type="tel"`, `inputMode="tel"`,
  `autoComplete="tel"`, hint `Usaremos para enviar informações da sua conta por SMS e WhatsApp.`;
  valid when it has 10 to 13 digits after stripping non-digits), marketing opt-in checkbox
  (unchecked, same copy as the old form). Inline field errors like the signup form.
- **Save** (writes are idempotent; the setup gate is written last, so a retry after a partial
  failure converges):
  1. `workspaces`: `name` and, only when the current slug is exactly the signup placeholder
     `workspace-<first 8 hex of the workspace id>`, `slug = slugify(company) + '-' + <same 8 hex>`.
     `slugify` approximates the trigger's `unaccent` rule: a small map for letters NFD does not
     decompose (`ß→ss`, `æ→ae`, `œ→oe`, `ø→o`, `ł→l`, `đ→d`, `þ→th`), then NFD normalize, strip
     combining marks, lowercase, `[^a-z0-9]+ → '-'`, trim `-`, `'' → 'workspace'`. Byte-for-byte
     parity with `unaccent` is not required: the slug only has to be readable and valid, and the
     id suffix keeps the unique index `idx_workspaces_slug` safe. The placeholder check means no slug that may already be in a sent
     hub link is ever rewritten (`needsSetup` blocks every other route, so a placeholder slug has
     no hub links yet). The owner may update `workspaces` (`ws_update_owner_admin`); no trigger
     guards `slug`.
  2. `contas`: `nome` and, under the same placeholder condition, the same new `slug`, best-effort
     with the result ignored, as today's `contas.nome` write. `contas` has no policies or grants
     in the repo migrations (the table was adopted from prod), so making this write blocking could
     lock every new owner out of setup on a grant we cannot see. The mirror matters only for
     `getWorkspaceSlug()` (`store/hub.ts`), which falls back to `contas.slug` when the
     `workspaces` lookup returns no slug; hub-bootstrap and `_shared/hub-url.ts` read
     `workspaces.slug` only.
  3. `profiles`: `nome`, `telefone`, `marketing_opt_in` and `empresa` in one UPDATE (all in the
     authenticated UPDATE column grant). `empresa` is the gate, so it lands with or after the rest.
  4. Apply the written values to the profile, then navigate. Do not use `refetchProfile()`: it
     sets the global `loading` (`ProtectedRoute` swaps the page for a skeleton and remounts it),
     and a failed forced fetch silently returns the cached pre-setup profile, which would bounce
     the owner straight back to setup with no error. Instead add one authoritative API,
     `patchProfile(patch)` on `AuthContext`, that updates both the React state and the
     module-level cache in `lib/supabase.ts` (`patchCachedProfile(patch)`) synchronously, with no
     `loading` change. The save calls it with `{ nome, empresa, telefone, marketing_opt_in }`
     only after every required write succeeded. On any write error: inline error message, the
     form keeps what the user typed, no navigation.
- **Success**: drop the 2.8s success screen and go straight to the target; `/comecar` is the
  confirmation moment now.
- **Analytics**: new `workspace_setup_completed` event (add to the `AnalyticsEvent` union).
- **Look**: the auth page look (`auth-card`, black logo, form spacing, primary button, the
  yellow gradient background) as in the "Passo 2 de 2" mockup: a "Passo 2 de 2" label, heading
  "Falta pouco", sub "Conte um pouco sobre sua agência para configurarmos seu espaço.", footer
  "Você pode alterar essas informações depois em Configurações." Drop the emoji and the green
  palette. Keep the current page's `100dvh` + safe-area handling (from `workspace-setup.css`):
  port it to a setup-page modifier of `.auth-wrapper`, without changing `/login`.

### 5. Phone features section (`LandingPage.tsx` `Features`)

- ≤900px (where the bento is one column): cards 5 and 6 (Calendário, Automações) are hidden until
  the visitor taps "Ver todas as funcionalidades" (`aria-expanded`, `aria-controls`), with the
  line "Calendário editorial e resposta automática a comentários" under it. All six cards stay in
  the DOM at all times (the `.reveal` IntersectionObserver is attached once at mount and must see
  them); the collapse is CSS only, for example an `lp2-card--extra` class hidden under
  `@media (max-width: 900px)` while the bento lacks `data-expanded`. The button is hidden above
  900px. Initial state collapsed on server and client.
- After the bento, on every viewport: a CTA block ("Teste tudo isso na sua agência.", the offer
  note, button). Anonymous: "Começar teste grátis" → `/login?tab=register`. Signed in: "Acessar
  painel" → `/dashboard`. Same `useLandingAuth` gating as the hero.

### 6. Phone header "Entrar" (`LandingChrome.tsx` `LandingHeader`, landing and subpages)

- ≤820px: show the existing "Entrar" link (icon hidden on phones), compact padding.
- ≤400px: the primary button reads "Criar conta" (long label "Criar conta grátis" above that).
  Both labels are in the markup and CSS picks one, so SSR stays stable; the button gets an
  explicit accessible name ("Criar conta grátis") and the short span is `aria-hidden="true"`, so
  screen readers and tests read one name.
- Logo, link and button must fit on one row at 360px, including the subpage variant with the
  theme toggle.

### 7. Google Ads final-URL suffix (no code)

Google Ads → Administrador → Configurações da conta → Rastreamento → **Sufixo do URL final**:
`utm_source=google&utm_medium=cpc&utm_campaign={campaignid}&utm_content={creative}&utm_term={keyword}`.
(As a tracking template it would need `{lpurl}?` in front.) PostHog then classifies these visits
as Paid Search with campaign, ad and keyword breakdowns. Delivered as instructions in the final
summary.

## Risks and accepted effects

- Between signup and setup, and for owners who never finish setup, `workspaces.name` and
  `profiles.empresa` are `''` instead of a company name. Nurture copy already treats a blank name
  like the default (`nurtureWorkspaceName`); lifecycle and Loops use `nome`; the Admin workspace
  list shows a blank name for those rows. Accepted.
- `contas.nome`/`contas.slug` can diverge from `workspaces` if the best-effort mirror write is
  refused (as `contas.nome` can today). Only `getWorkspaceSlug()` reads `contas.slug`, and only
  when the `workspaces` row has no slug; after setup it always has one. Accepted.
- A pre-existing workspace whose name slugified to nothing has a `workspace-<8hex>` slug and, if
  its owner has a blank `profiles.empresa`, gets its slug rewritten on setup. Requires both a
  symbol-only company name and a blank profile company; accepted.

## Testing and verification

- Unit (Vitest): landing render/hydration/SSR tests without the promo bar
  (`LandingHydration`, `LandingSsr`, `LandingPage` incl. the CTA count, `prePaintScript`);
  features disclosure toggling with all six cards present in the DOM; header renders "Entrar"
  and one accessible name for the CTA; LoginPage register form (3 fields, inline errors, no
  submit with invalid fields, metadata `empresa: ''` and no `telefone`); ProtectedRoute redirects
  a blank-company owner with `next`; setup page: validation, saves all fields, slug rewritten only
  from the placeholder, keeps `next` intent, no navigation and typed values kept on error,
  fires the event; `CookieConsent` copy updates.
- Typecheck all five projects, lint, format, prerender smoke (`vite build` + `npm run prerender`)
  because `/` is server-rendered.
- Browser: measure CTA position with the cookie banner open at every size in Goal 1, after the
  `lp2-rise` entrance animation finishes; walk the signup form on phone width (empty submit, bad
  email, short password); setup step layout on phone and desktop.

## Rollout

Frontend only, one PR. Merge deploys it. Rollback is a Vercel rollback: accounts created in
between have a blank company, and the old frontend's identical `needsSetup` check sends them to
the old setup page, which asks for the company only (no phone) and leaves their slug as
`workspace-<8hex>`.

## Builder's calls

Exact sizes and spacing, error copy wording beyond what is quoted, whether unused i18n keys are
deleted, test file layout.
