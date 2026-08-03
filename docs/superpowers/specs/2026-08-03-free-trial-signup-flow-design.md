# Teste grátis como porta de entrada — signup → trial flow

## Context

Starting a free trial today takes ten steps and requires the user to know a
secret word. The funnel:

1. Landing banner announces the `BEMVINDO` code (`PricingSection.tsx:8`,
   `LandingPage.tsx:94`).
2. CTA goes to `/login?tab=register`.
3. Signup shows a "confira seu e-mail" screen (`LoginPage.tsx:189`).
4. User leaves the browser for their inbox.
5. Confirms, returns, logs in.
6. Owners who left the optional `empresa` field blank get bounced to
   `/workspace-setup` and retype their name and company (`ProtectedRoute.tsx:58`).
7. They land on the dashboard on the Free plan.
8. To start a trial they must find Configurações → Plano e Cobrança, a nav item
   buried in the config group and owner-only (`nav-data.ts:231`).
9. They must type `BEMVINDO` into a small input in the page toolbar
   (`CobrancaPage.tsx:226`) — **not** in Stripe Checkout, because the code maps
   to `trial_period_days` server-side (`billing-checkout/index.ts:14`) and
   Stripe's own promo box cannot grant it.
10. Only then does "Fazer upgrade" produce a trial.

Anyone who misses any of these lands on Free with no trial, or abandons with no
account at all. Nothing in the product ever presents a trial as a call to
action; the only verb offered is "Fazer upgrade".

Goal: **the 30-day trial becomes the default path for every new signup**, with
no code to discover and no settings page to find.

## Decisions made with the user (brainstorming)

- **Trial is the front door.** Every new signup is led to a trial; Free becomes
  the fallback for people who decline, not the default landing spot.
- **Card stays required upfront.** Trials continue to run through Stripe
  Checkout with `payment_method_collection: "always"`. No in-app trial state,
  no expiry cron, no new downgrade path.
- **Plan choice: intent if present, step if not.** Landing plan CTAs carry
  `?plan=` through signup straight to Stripe; generic CTAs fall through to an
  in-app plan step.
- **Bail-out is soft.** Cancelling or ignoring Checkout lands the user in the
  app on Free with a persistent, resurfacing dashboard nudge. Nobody is locked
  out.
- **`BEMVINDO` is retired.** The trial becomes unconditional for first-time
  subscribers. Accepted business shift: 30 free days stops being a launch promo
  and becomes the standing offer.
- **Email confirmation is dropped** so signup lands directly in the app. This is
  a Supabase Auth dashboard toggle, not code (see Deploy steps).

Rejected: reusing `CobrancaPage` in an `?onboarding=1` mode (that page already
serves steady-state billing with upgrade/downgrade logic and would grow two
audiences in one component); a first-run modal over the dashboard (competes with
`OnboardingBanner` and is trivially dismissed, undercutting "trial is the front
door").

## Existing infrastructure to reuse (do not rebuild)

- `billing-checkout` edge fn — Stripe customer find-or-create, owner check,
  `checkout_attempts` marketing signal, `EdgeRuntime.waitUntil` pattern.
- `isFirstTimeSubscriber` = `!subRow?.stripe_subscription_id`. **Verified
  durable:** `stripe-webhook/index.ts:141` only ever writes that column and
  never clears it, so a workspace cannot re-trial by cancelling.
- `services/billing.ts` — `startCheckout`, `listActivePlans`,
  `getWorkspaceSubscription` (needs one column added, see section 1),
  `getEffectivePlanId`.
- `plan-display.ts` — `isPlanVisible`, `canUpgradeTo`, `resolveCurrentPlanId`.
- `handle_new_user` trigger — `raw_user_meta_data->>'empresa'` already becomes
  the workspace name (`20260421000001_defer_invited_user_workspace_membership.sql:48`).
- `WorkspaceSetupPage` as the precedent for a full-page step outside the app
  shell.
- `captureEvent` from `lib/analytics`.
- `OnboardingBanner`'s `conta_id`-keyed localStorage dismissal pattern.

## Design

### 1. Trial eligibility, server and client

**Server.** In `supabase/functions/billing-checkout/index.ts`:

- Delete the `LAUNCH_PROMO` constant (line 14), the `promoCode` parse
  (line 39), and the whole promo validation block (lines 68–84).
- Replace with `const TRIAL_DAYS = 30;` and
  `const trialDays = isFirstTimeSubscriber ? TRIAL_DAYS : undefined;`
- The function keeps reading `body.promo_code` but **ignores** it, so an
  in-flight old client cannot 400.
- `allow_promotion_codes: true` stays, so Stripe's own promo box still works for
  any real future coupon.
- `payment_method_collection` simplifies to `"always"`: every first-time session
  now carries a trial, and returning subscribers should give a card anyway.

`startCheckout` in `apps/crm/src/services/billing.ts:140` drops its third
`promoCode` parameter and stops sending `promo_code`. It gains a
`source: 'onboarding' | 'billing'` argument (see below).

**Return URLs must depend on where checkout started.** Today both `success_url`
and `cancel_url` are hardcoded to `/configuracao/cobranca`
(`index.ts:101-102`). Left alone, a user who cancels the onboarding checkout
lands on the settings billing page, which is the exact surface this whole spec
exists to keep new users out of.

The request body gains `source`, and the server maps it through a **fixed
lookup table**. The client never supplies a URL, so this cannot become an open
redirect:

```ts
const RETURN_PATHS = {
  onboarding: { success: "/dashboard?trial=started", cancel: "/dashboard?trial=skipped" },
  billing:    { success: "/configuracao/cobranca?status=success",
                cancel:  "/configuracao/cobranca?status=cancelled" },
};
const source = body.source === "onboarding" ? "onboarding" : "billing";
```

Both are still prefixed with `resolveAllowedOrigin(req)` as today. Defaulting an
unrecognised value to `billing` preserves current behaviour for any older client.

`DashboardPage` handles the two new params: `trial=started` shows a success
toast and invalidates the plan/entitlement queries on the same 5×2s poll
`CobrancaPage` already uses for webhook lag (`CobrancaPage.tsx:86-104`);
`trial=skipped` shows nothing, since `TrialNudgeCard` renders on its own. Both
strip the param with `setSearchParams({}, { replace: true })`.

**Duplicate-session race.** The first-time check reads
`stripe_subscription_id` and then creates a session with no lock and no
idempotency key. Two tabs, or a refresh of the auto-checkout state, can create
two sessions that could both be completed, leaving one live subscription the
`workspace_id`-keyed mirror row does not point at. This race exists today on
`CobrancaPage`, but auto-starting checkout on page load raises the exposure, so
it gets fixed here:

- Pass a Stripe idempotency key on session creation:
  `` `co_${workspaceId}_${planId}_${interval}_${Math.floor(Date.now() / 3_600_000)}` ``.
  Concurrent callers get the *same* session back rather than two. Stripe retains
  keys for 24h; the hour bucket keeps a legitimate later retry from being pinned
  to a stale session.
- Reject outright when `subRow.status` is `active` or `trialing`, with a 409 and
  a generic message. Such a user belongs in the billing portal, not a second
  checkout.

**Explicitly not built:** a durable pending-checkout table with expiry and
rollback. The residual window it would close is a user completing checkout and
starting another in a different hour bucket before the webhook lands, typically
a few seconds. That does not justify a migration in a spec that otherwise needs
none. If duplicate subscriptions ever show up in practice, that table is the
next step.

**Client.** Both the `/comecar` guard and the dashboard nudge need to know
whether the workspace has ever subscribed, and today they cannot:
`getWorkspaceSubscription` (`billing.ts:128`) selects only
`status, plan_id, current_period_end, cancel_at_period_end, past_due_since,
next_payment_attempt`. `stripe_subscription_id` is not among them.

Reading it is permitted — `workspace_subscriptions` has RLS but no column-level
GRANT allowlist, and `workspace_subscriptions_owner_read`
(`20260609120003_workspace_subscriptions.sql:22`) lets the owner select any
column on their own row. So: add `stripe_subscription_id` to the select and have
the service map it to a derived boolean on `WorkspaceSubscription`:

```ts
hasEverSubscribed: Boolean(data.stripe_subscription_id)
```

The raw Stripe id is discarded in the service and never reaches component state.
That keeps the exposed surface to a boolean without needing a migration.

**A row's existence does not mean a subscription exists.** `billing-checkout`
upserts a row carrying only `stripe_customer_id` the first time a user reaches
checkout, so an abandoned checkout leaves a row with `status = null` and no
subscription id. Eligibility must test `hasEverSubscribed`, never row presence
or `status`.

### 2. Plan intent from landing to checkout

`planHref` in `PricingSection.tsx:91` returns, for paid plans and logged-out
visitors, `/login?tab=register&plan=<id>&interval=<month|year>`. The `free` plan
and logged-in users keep today's targets.

`LoginPage` reads `plan` and `interval` from the query string and, after a
successful `signUp`, navigates to `/comecar` preserving them.

**Intent must survive the email-confirmation fallback.** `signUp` hardcodes
`emailRedirectTo: window.location.origin + '/login'` (`supabase.ts:228`), and a
login with no `from` target goes to `/dashboard` (`LoginPage.tsx:27`). So if
confirmation is ever enabled, the user's chosen plan is silently dropped between
signup and return. `signUp` therefore takes an optional `redirectPath`, and
`LoginPage` passes `/login?plan=…&interval=…` when an intent exists. On the way
back in, `LoginPage` re-parses its own search params through `parsePlanIntent`
and routes to `/comecar` with them. Same validated parse on both legs, so a
tampered confirmation link is no more dangerous than a tampered landing link.

**Validation happens at both ends.** Client side, a new
`apps/crm/src/pages/comecar/plan-intent.ts` exports
`parsePlanIntent(search: string): { planId: string; interval: BillingInterval } | null`,
accepting only `start | pro | max` and `month | year` and returning null on
anything else. Server side, `billing-checkout` already rejects unknown plans via
`PAID_PLANS.includes(planId)` (`index.ts:40`) and coerces `interval`
(`index.ts:38`), so a hand-edited URL cannot push an arbitrary `plan_id` into a
Stripe session even if the client guard were bypassed. The client parse exists
to fail early and render a sane page, not as the security boundary.
Unit-tested directly.

### 3. New route `/comecar`

A full-page step outside the app shell, in
`apps/crm/src/pages/comecar/ComecarPage.tsx`, lazy-loaded and registered in
`App.tsx` behind `ProtectedRoute`.

**Guards, evaluated on mount, in this order. The order is load-bearing:** the
loading check must come first, or `role` and `subscription` are still undefined
and a legitimate owner gets redirected away before their data arrives.

| # | Condition | Action |
|---|---|---|
| 1 | auth or subscription query still loading | spinner |
| 2 | `role !== 'owner'` | `<Navigate to="/dashboard" replace />` |
| 3 | `subscription?.hasEverSubscribed` | `<Navigate to="/dashboard" replace />` |

Being self-guarding is what lets other surfaces (e.g. `WorkspaceSetupPage`) link
here unconditionally without duplicating eligibility logic.

**State B — valid `?plan=` present.** Renders "Preparando seu teste do plano
{Nome}" and calls `startCheckout` immediately, then `window.location.assign`.
On error: `toast.error`, clear the intent, fall through to state A rather than
stranding the user.

The auto-checkout effect **must** be guarded by a `useRef` latch. React's
double-invoke in development would otherwise create two Stripe sessions, and
`checkout_attempts.stripe_session_id` is UNIQUE per session, so two sessions
become two rows, not a dedupe.

**State A — no intent.** Header "Comece com 30 dias grátis" plus the subhead
"Escolha o plano do seu teste. Você só é cobrado depois de 30 dias e pode
cancelar quando quiser." A `month | year` toggle, then one card per paid plan
from `listActivePlans`, each showing "30 dias grátis" above "depois {preço}/mês"
and a "Começar teste" CTA.

**The existing `isPlanVisible` is not the right filter here.** It only excludes
internal plans (`plan-display.ts:35`), so `free` — which `listActivePlans`
returns like any other active catalog row — would still render a card, directly
contradicting "Free is the secondary link, not a card". Add an explicit
predicate to `plan-display.ts`:

```ts
export function isSelectableTrialPlan(plan: { id: string; price_brl: number | null }): boolean {
  return plan.id !== 'free' && !isInternalPlan(plan.id) && (plan.price_brl ?? 0) > 0;
}
```

The `price_brl > 0` clause is deliberate belt-and-braces: a future zero-priced
plan added to the catalog must not silently appear as something you can start a
trial on. Unit-tested against `free`, `lifetime`, a paid plan, and a
zero-priced non-free plan.

Below the grid: "Pedimos o cartão agora, mas nada é cobrado nos primeiros 30
dias." and a secondary link "Prefiro continuar no plano Free por enquanto" →
`/dashboard`.

Prices come from the `plans` table; no price is hardcoded.

### 4. Signup and workspace-setup

- `empresa` becomes `required` in the register form (`LoginPage.tsx:226`). It
  already feeds the workspace name through `handle_new_user`, so requiring it
  makes `/workspace-setup` unreachable for new signups.
- **HTML `required` alone is not enough.** Whitespace satisfies it, and the
  trigger takes the raw value:
  `COALESCE(NEW.raw_user_meta_data ->> 'empresa', 'Meu Workspace')`
  (`20260719000002_signup_marketing_opt_in.sql:91`). A user submitting spaces
  gets a whitespace-named workspace *and* skips `/workspace-setup`, because
  `' '` is truthy in the `!profile.empresa` check (`ProtectedRoute.tsx:61`).
  So `handleRegister` trims `regEmpresa`, rejects an empty result with a toast,
  and sends the trimmed value. Same treatment for `regNome`.
- Deliberately **not** hardened at the trigger. `NULLIF(btrim(...), '')` there
  would be a one-line migration, but every signup goes through this form, and
  the spec otherwise needs no migration. Worth revisiting only if signups ever
  arrive through the Auth API directly.
- The `registerSuccess` "confira seu e-mail" branch is replaced by a direct
  navigation to `/comecar` once the session exists. Keep a fallback: if
  `signUp` returns no session (i.e. confirmation is still enabled server-side),
  show the existing check-your-email screen. **This makes the PR safe to merge
  before the Supabase toggle is flipped, and safe if it is ever flipped back.**
- `/workspace-setup` stays for legacy accounts; its post-save
  `navigate('/dashboard')` (`WorkspaceSetupPage.tsx:53`) becomes
  `navigate('/comecar')`, which self-guards onward for anyone ineligible.

### 5. Trial nudge on the dashboard

New `apps/crm/src/components/billing/TrialNudgeCard.tsx`, rendered on the
dashboard above `OnboardingBanner`. Deliberately a separate component: its
eligibility and lifecycle differ from the onboarding checklist.

Shown when **all** hold: `role === 'owner'`, `getEffectivePlanId()` is `free`,
and `hasEverSubscribed` is false (see section 1).

Copy: "Seus 30 dias grátis ainda estão disponíveis" / "Você está no plano Free.
Ative o teste para liberar relatórios, portal do cliente e agendamento." CTA
"Ativar teste" → `/comecar`.

Dismissal writes an ISO timestamp to `trial_nudge_dismissed_<conta_id>`; the card
resurfaces once the stored timestamp is more than 7 days old. That cadence is
what makes it persistent without being a wall. A malformed or unparseable stored
value is treated as "never dismissed", so a corrupt entry fails toward showing
the card rather than silently hiding it forever.

### 6. Plano e Cobrança page

- Remove the `promo` state and the entire `billing-promo` block
  (`CobrancaPage.tsx:226-237`), plus its CSS in `cobranca.css`.
- Replace it in the toolbar with a static hint, shown only to first-time
  subscribers: "Seus primeiros 30 dias são grátis".
- `renderCta` reads "Começar teste de 30 dias" when the workspace has never
  subscribed, and keeps "Fazer upgrade" otherwise.

### 7. Landing copy

- `PromoBanner` (`LandingPage.tsx:94`): "Teste o Mesaas por 30 dias sem pagar
  nada. Sem código, cancele quando quiser." CTA "Começar teste grátis".
- `PricingSection` `pricing-promo-note`: "30 dias grátis em qualquer plano pago.
  Sem código, cancele quando quiser."
- Paid-plan card CTAs in `PLAN_MARKETING` become "Começar teste grátis"; add
  "30 dias grátis para começar" above the description.
- Delete the exported `PROMO_CODE` constant.
- Hero CTA copy (`LandingPage.tsx:144`, `:247`, `:337`) becomes "Começar teste
  grátis".

Per project convention, none of this copy uses em dashes.

### 8. Routing registration

Adding a top-level route touches three places, and a guard test enforces two of
them:

1. `APP_ROUTE_PREFIXES` in `apps/crm/src/content/site-meta.ts:18` — add
   `'comecar'`.
2. The app-shell rewrite in `vercel.json:38`.
3. The `X-Robots-Tag` header pattern in `vercel.json:70`.

`content/__tests__/vercel-routing.test.ts` fails if the prefix is added without
the rewrite. Missing this entirely means the route works in dev and 404s in
production.

### 9. Analytics

`captureEvent` calls: `trial_step_viewed` (with `has_intent`), `trial_skipped`
on the Free link, `trial_nudge_clicked`. The existing `checkout_started` event
in `CobrancaPage.tsx:136` moves into a shared helper so `/comecar` emits it too,
with `{ plan_id, billing_interval, source }` reusing the same
`'onboarding' | 'billing'` values the checkout request sends, so the analytics
funnel and the return-path contract cannot drift apart.

## Tests

Contract changes break existing tests in both suites; these are the known ones:

- `apps/crm/src/services/__tests__/billing.test.ts:109` — "startCheckout includes
  promo_code only when provided" is deleted and replaced with an assertion that
  the body carries only `plan_id` and `interval`.
- `apps/crm/src/pages/landing/__tests__/LandingPage.test.tsx:192` — asserts the
  banner contains `BEMVINDO`; retarget to the new trial copy.

New tests:

- `plan-intent.test.ts` — accepts valid pairs, rejects unknown plan ids,
  rejects unknown intervals, returns null on empty input.
- `getWorkspaceSubscription` — derives `hasEverSubscribed` true when
  `stripe_subscription_id` is present and false when null, and does not leak the
  raw id onto the returned object. (There is no existing test for this function,
  so adding the column breaks nothing; the new one is the guard.)
- `ComecarPage.test.tsx` — redirects non-owners; redirects workspaces where
  `hasEverSubscribed` is true; renders the page (not a redirect) for a
  workspace whose row exists with `status = null` from an abandoned checkout;
  renders paid plans without intent; calls
  `startCheckout` exactly once with intent (asserting the double-invoke latch);
  falls back to the plan list on checkout error.
- `TrialNudgeCard.test.tsx` — visible for a never-subscribed Free owner; hidden
  for non-owners, paid plans, and previously-subscribed workspaces; hidden
  within 7 days of dismissal and visible after; visible when the stored
  dismissal value is malformed.
- `isSelectableTrialPlan` — rejects `free`, rejects `lifetime`, rejects a
  zero-priced non-free plan, accepts a paid plan.
- `LoginPage` — whitespace-only `empresa` is rejected rather than submitted;
  the value reaching `signUp` is trimmed; plan intent is forwarded to
  `/comecar` after signup, and forwarded through `emailRedirectTo` when the
  no-session fallback path is taken.
- `DashboardPage` — `?trial=started` toasts and invalidates the plan queries
  then strips the param; `?trial=skipped` strips silently and leaves
  `TrialNudgeCard` to render.
- `startCheckout` sends `source`, and omits `promo_code` entirely.
- `CobrancaPage` CTA copy for first-time versus returning subscribers.

No edge-function test currently covers `billing-checkout`'s promo logic
(`config-audit_test.ts` only asserts it appears in the `verify_jwt = false`
list, and is unaffected). Extract the three new decisions as pure helpers in
`_shared/` so they are testable under `deno test` without a live Stripe call:

- `resolveTrialDays(hasPriorSubscription: boolean)`
- `resolveReturnPaths(source: unknown)` — asserts the lookup table, and that an
  unknown/absent/hostile `source` falls back to `billing` rather than producing
  an attacker-chosen URL.
- `buildCheckoutIdempotencyKey(workspaceId, planId, interval, now)` — stable
  within an hour bucket, different across buckets. `now` is injected so the test
  needs no clock control.

Full suite before pushing: `npm run test`, `npm run test:functions`,
`npm run lint`, `npm run format:check`, plus the four `tsc` projects the CI runs
(crm, hub, admin, scripts). `deno test` dirties the root `deno.lock`; revert it.

## Deploy steps (not code)

1. **Supabase Auth → disable "Confirm email"** on prod and staging. Until this is
   flipped, `signUp` returns no session and the flow correctly falls back to the
   check-your-email screen, so ordering is not critical.
2. `npx supabase functions deploy billing-checkout --use-api` on both projects.
   Check `supabase/.temp/project-ref` first: link state flips between prod
   (`skjzpekeqefvlojenfsw`) and staging (`wlyzhyfondykzpsiqsce`).
3. Frontend ships with the Vercel deploy on merge.

No migration. No schema change.

## Out of scope / known limits

- **Repeat trials across workspaces.** Eligibility is per workspace, so one
  person can get another 30 days by signing up a fresh workspace with a new
  email. Stripe-side card-fingerprint dedupe is the real mitigation and is not
  attempted here.
- **Trial-ending communication.** Reminder emails before day 30 are a
  `lifecycle-emails` concern, not this spec.
- **Making Plano e Cobrança easier to find in the nav.** The `/comecar` step and
  the dashboard nudge remove the need to find it during onboarding; the
  steady-state nav question stands on its own.
- **No in-app trial state.** Trial status continues to come from Stripe via
  `workspace_subscriptions.status === 'trialing'`.
- **Durable pending-checkout ledger.** The idempotency key and the
  active-subscription rejection (section 1) close the practical duplicate-session
  races. The remaining window is completing checkout and starting another in a
  different hour bucket before the webhook lands. Accepted; a pending-checkout
  table with expiry and rollback is the fix if it ever bites.
- **Trigger-level `empresa` hardening.** Trimming happens at the signup form.
  A caller hitting the Supabase Auth API directly could still create a
  whitespace-named workspace; no such caller exists today.
