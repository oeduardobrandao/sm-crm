# Reverse trial: 14 days of Pro without a card

Status: draft for approval · 2026-11-24
For new signups, this replaces the card-first offer in `2026-10-27-trial-first-onboarding-design.md`
(Part 1 routing and Part 2 screen). That spec's Part 3 (trial reminder) and Part 4 (plan claims
audit) stay in force and are reused here.

Mockups: artifact "Teste Pro sem cartão" (countdown banner, end-of-trial prompt, downgrade
state, paused Hub, iOS variants).

## Why

Production data, pulled 2026-11-24:

- 15 owners saw `/comecar` since it shipped. 3 ever started a trial or paid; 1 of them within an
  hour of seeing it. 5 clicked "Continuar no Free" explicitly.
- Today's two ad signups both saw the offer, started nothing and created nothing in the app.
- `TrialNudgeCard` got 1 click in 45 days.
- Plan distribution: Free 77 workspaces, Start 9, Pro 16, Max 15.

Hypothesis: asking for a card at minute two, before the owner has seen any value, is the main
barrier. A reverse trial removes the ask: every new owner starts on Pro, sees what the paid
product does with their own clients, and is asked for a card only when there is something to
lose.

Baseline to beat: 3 of 15 (20%) offer viewers ever on a paid trial or plan; 1 of 15 within an
hour.

## Decisions made (product owner, 2026-11-24)

| Decision | Choice |
|---|---|
| Mechanism | Reverse trial, app-side (not Stripe `if_required`, not an optional card on `/comecar`) |
| Plan | Pro |
| Length | 14 days |
| Day 14 without a card | Drop to Free. All data kept and readable. Creating past Free limits blocked. Hub links pause after a 7-day grace. |
| Card added during the trial | First charge on the trial end date, no second trial on top. After the trial has ended, checkout charges at once. |
| Existing Free workspaces that never trialed | Opt-in: one click on the dashboard card starts the same 14 days. No automatic plan change. |

## Goals

1. Every eligible new owner lands in the app on Pro, without a card, with a visible end date.
2. The owner always knows how many days are left and what happens at the end.
3. Adding a card is one click from anywhere in the trial and never costs trial days.
4. Day 14 is predictable: nothing is deleted, the workspace is on Free, and the owner sees what
   changed and how to get Pro back.
5. One reverse trial per person, ever, across all their workspaces.
6. The funnel (trial started, card added, paid, downgraded) is measurable from the database,
   not only from PostHog.

## Non-goals

- Price, plan limit or plan catalog changes.
- Pix or boleto at checkout.
- Hub and Admin redesigns. Admin gets only what it needs to see and manage a trial.
- Changing what a churned paying customer experiences (see "Hub pause" scope).

## Anti-goals (a failure even if it works)

- Data deleted, hidden or made unreachable at day 14.
- A charge the owner did not explicitly set up, or a charge earlier than the date shown.
- Fake urgency: countdowns that reset, timers in seconds, guilt copy on the Free path.
- Any purchase flow, link or price inside the iOS app.
- The agency's own client hitting a broken or embarrassing Hub screen without the agency being
  warned first.
- A second free Pro period obtainable by creating another workspace.
- Copy that still promises "30 dias grátis" or "sem cartão" where it is no longer true.

## Approaches considered

| | Reverse trial (chosen) | (a) Stripe Checkout trial, `payment_method_collection: 'if_required'` | (b) Keep `/comecar`, card optional |
|---|---|---|---|
| Friction at minute two | None: owner lands in the app on Pro | Still a plan screen and a Stripe page | Still a plan screen |
| Providers | Provider-agnostic | Stripe only; the Pagar.me 12x path has no no-card trial | Needs (a) or the reverse-trial machinery for its no-card branch |
| Data model | New `plan_source = 'trial'` plus dates on `workspaces` | A real `trialing` subscription row without a payment method | Both |
| Side effects | Contained to the `plan_source` call sites in Part 6 | `trialing` rows reach the trial reminder (it would promise a charge that cannot happen), the nurture exclusion, Admin's "teste" filter and the MRR reads; trial end behaviour (`cancel` or `pause`) has to be wired into the webhooks | Same as (a) |
| End of trial | Our sweep, our copy, our timing | Stripe cancels or pauses; webhook fallback write | Same as (a) |

(a) keeps the step we believe is the barrier and cannot serve the 12x path. (b) keeps the
screen and still needs one of the other two underneath. The reverse trial reuses the pattern
that `plan_source = 'demo'` established: every entitlement check reads `workspaces.plan_id`,
so flipping it grants Pro everywhere at once.

## How the effective plan works today

- `workspaces.plan_id` (null = the `is_default` plan, Free) and `workspaces.plan_source`
  (`system | stripe | manual | pagarme | demo`) are the single source.
- SQL: `effective_plan_feature(ws, key)` and `effective_plan_limit(ws, key)` read `plan_id`,
  then `workspace_plan_overrides` (no expiry), then the `plans` row. The plan triggers
  (`enforce_plan_feature`, `enforce_plan_count_limit`) call them, and all fire `before insert`
  only (brand customization also on update).
- Edge: `_shared/entitlements.ts` `resolveEntitlements()` does the same.
- CRM: `services/billing.ts` `fetchEffectivePlan()` reads `plan_id, plan_source,
  demo_created_at, trial_offer_seen_at`; `useWorkspaceLimits` reads entitlements.
- Writers: `_shared/plan-writer.ts` `writeWorkspacePlan()` (Stripe webhook, Pagar.me checkout and
  subscription) never overrides `manual`, and a `fallback` write never ends a `demo`.
  `grant_pagarme_plan` (SQL) has the same rules. `platform-admin` writes `manual` (comp) and
  restores via `revert-target.ts`.
- Trial eligibility: `hasEverSubscribed()` (edge), `hasUsedTrial()` and `isTrialOfferEligible()`
  (CRM), the nurture RPC's `paid_ws` CTE.
- Hub links check only `feature_hub_portal` (`_shared/hub-token.ts`), which is `true` on Free.
  So today a downgraded workspace keeps every Hub link it created.

Free today (live row): 2 clients, 1 user, 1 workflow template, 2 Instagram accounts, 10 leads,
0 Hub links, 2 reports/month, 0 AI analyses, auto sync 2/day, 1 GB, 1 workspace per person; no
financeiro, contratos, chat da equipe, respostas automáticas, briefing em áudio or TikTok.
Pro: 15 clients, 5 users, 15 Hub links, 15 reports/month, 15 AI analyses, TikTok, automações,
briefing em áudio, 40 GB, 5 workspaces per person. Copy about "what you lose" is derived from
these rows at runtime, never hard-coded.

## Part 1: data model

New nullable columns on `workspaces`:

| Column | Meaning |
|---|---|
| `reverse_trial_started_at timestamptz` | When the 14 days began. Never cleared. |
| `reverse_trial_ends_at timestamptz` | Scheduled end. Admin can move it. |
| `reverse_trial_plan_id text` | Plan granted (Pro at launch). Kept for history and Admin. |
| `reverse_trial_ended_at timestamptz` | When it actually ended. |
| `reverse_trial_outcome text` | `converted`, `downgraded` or `ended_by_admin` (check constraint). |
| `reverse_trial_card_added_at timestamptz` | When a paid subscription was first bound during the trial (funnel). |

The `plan_source` check constraint gains `'trial'`. While the trial runs: `plan_id =
reverse_trial_plan_id`, `plan_source = 'trial'`.

Per-person marker, so another workspace never gets another trial: `profiles.reverse_trial_used_at
timestamptz`, set on the owner who started it. All writes go through the SQL functions below,
never directly from the client. The builder checks the `workspaces` and `profiles` grants so the
owner can read the new columns (the CRM selects `trial_offer_seen_at` directly today) and cannot
write them.

## Part 2: who gets it and when

### Eligibility: one SQL function, `reverse_trial_eligible(workspace, user)`

All of:
- The user is the workspace's owner.
- The workspace is on Free (`coalesce(plan_id, default) = default`), `plan_source` is not
  `manual`, it is not a demo (`demo_created_at is null`), it never subscribed (the
  `hasEverSubscribed` predicate: `ever_subscribed_at`, `stripe_subscription_id`,
  `pagarme_subscription_id`, or status in `active/trialing/past_due`) and it never had a reverse
  trial (`reverse_trial_started_at is null`).
- The person never had a reverse trial (`profiles.reverse_trial_used_at is null`) and owns no
  other workspace that ever subscribed or ever had a reverse trial (same shape as the nurture
  RPC's per-person rule).
- The kill switch is on: a `reverse_trial_enabled` setting the function reads, changeable
  without a deploy. Off means nobody new starts; running trials continue to their end.

### Start paths

- **New signup (automatic).** The first time an eligible owner reaches the app,
  `ProtectedRoute` calls `start_reverse_trial()` instead of redirecting to `/comecar`. Starting
  from the app, not from the `auth.users` trigger, keeps invited members, demos and
  admin-created workspaces out by construction, and a never-confirmed email never starts a
  clock. The owner then sees a one-time welcome dialog ("Seu workspace está no Pro por 14
  dias").
- **Existing Free workspace (opt-in).** `TrialNudgeCard` becomes "Teste o Pro por 14 dias, sem
  cartão" with one button that calls the same RPC, under the same eligibility.
- **Landing intent** (`?plan=…&interval=…`): unchanged, goes straight to checkout with today's
  30-day card trial. A checkout from intent never starts a reverse trial.

`start_reverse_trial()` (SECURITY DEFINER, `authenticated`): re-checks eligibility under a row
lock on the workspace, writes the columns, sets `plan_id/plan_source`, stamps
`profiles.reverse_trial_used_at` and `trial_offer_seen_at` (so the old redirect stays inert),
and returns the end date. Idempotent: a second call returns the running trial. Generic errors
only.

### `/comecar` after this ships

- New signups never land on it automatically.
- It stays reachable (pricing, Cobrança, "Ver planos") as the plan picker for people who want to
  pay. During a reverse trial its copy says the first charge is on the trial end date. After a
  reverse trial it drops "Pedimos o cartão agora, mas nada é cobrado nos primeiros 30 dias",
  because the charge is immediate.
- `useTrialOfferRedirect` stops redirecting while the kill switch is on. With the switch off it
  works as today, so the card-first flow is the fallback.

## Part 3: during the trial

**Countdown banner** (owner and admins; agents see nothing). A slim bar under the top bar on
desktop, a compact row above the content on the phone shell:

- Days 14 to 4 left: neutral. "Pro grátis: faltam {n} dias. Adicione um cartão para continuar no
  Pro depois de {data}." Button "Adicionar cartão". Dismissible for the session.
- 3 to 1 days left: emphasis colour (amber, not red). "Seu teste do Pro termina em {n} dias
  ({data}). Sem cartão, o workspace volta para o Free." Not dismissible.
- Last day: "Seu teste do Pro termina hoje às {hora}."
- Card added: "Pro garantido. Primeira cobrança de {valor} em {data}." for 3 days, then hidden.
- Days left are whole days, rounded down, against `reverse_trial_ends_at` in
  `America/Sao_Paulo`. The number only goes down.

**End-of-trial prompt** (modal, owner only): once per session in the last 3 days. It shows what
they used on Pro (clients over 2, Hub links, members, reports, from counts already available),
what changes on Free (from the plan rows), the primary "Adicionar cartão e continuar no Pro",
the secondary "Ver outros planos" and a tertiary text link "Decidir depois". The amount and date
come from the plan price and `reverse_trial_ends_at`.

**Cobrança page**: a trial section with the end date, the plan and the same CTA.

**Emails** (lifecycle-email-cron sweeps, `lifecycle_emails` ledger, new `email_type`s, to the
primary owner, idempotency keyed by workspace and `reverse_trial_ends_at`):
- `reverse_trial_ending`, 3 days before the end: what ends, the date, an add-card link.
- `reverse_trial_ended`, at the downgrade: you are on Free, nothing was deleted, your Hub links
  pause on {data + 7}, add a card to get Pro back.
- `reverse_trial_hub_pausing`, the day before the Hub pause, only if the workspace has active
  Hub links.
- The existing welcome email: for workspaces in a reverse trial, replace the "teste grátis de 30
  dias" block with "Seu workspace está no Pro até {data}".

**iOS app** (`isNativeApp()`, `apps/mobile/DECISIONS.md` D5): the banner shows the days left and
the end date with no button, price or link ("Pro até {data}. Gerencie seu plano pelo site."). No
end-of-trial modal. The welcome dialog and the downgrade notice are text only.

## Part 4: card added during the trial

"Adicionar cartão" opens the existing plan picker preselected on Pro monthly, with Start, Max
and the 12x path one click away.

- **Stripe**: `billing-checkout` sends `subscription_data.trial_end = max(reverse_trial_ends_at,
  now + 48h)` instead of `trial_period_days` while the workspace is in a reverse trial.
  `payment_method_collection` stays `always`. The 48h floor is Stripe's documented minimum for
  Checkout `trial_end` (builder verifies in the Stripe docs); it can add up to 2 days of Pro to a
  last-day card, which is accepted.
- **Pagar.me 12x**: `pagarme-checkout` sends `start_at` = the trial end date (date-only, ceiling
  to UTC midnight, as `resolveStartAt` does).
- On bind, the webhook or checkout calls `writeWorkspacePlan(..., 'subscribed')`, which ends the
  trial: `plan_source` becomes `stripe` or `pagarme`, `reverse_trial_ended_at = now()`,
  `reverse_trial_outcome = 'converted'`, `reverse_trial_card_added_at = now()`. Choosing Start or
  Max is a normal subscribed write: the plan changes at once, the first charge is still on the
  trial end date.
- The existing trial reminder (`get_trial_reminder_candidates`) picks these rows up as
  `trialing`, with the correct first-charge date. A card added with fewer than 7 days left
  falls into its catch-up path (3 days or more) or its cutoff (under 3 days). For a row that is a
  reverse-trial conversion, the cutoff is expected and logs at info, not error: the checkout and
  the banner already showed the amount and date.

**Checkout rules** (`billing-checkout`, `pagarme-checkout`):
- In a reverse trial: trial until its end (above).
- Reverse trial used and now on Free: no trial, charge at once. `hasEverSubscribed` treats
  `reverse_trial_started_at` as a spent trial.
- Never had one and arrives by landing intent: unchanged, 30-day card trial.

## Part 5: day 14 (downgrade)

**Sweep**: a new leg E in `billing-downgrade-cron` (already monitored by `cron-health-cron` and
triage), with its schedule raised from daily to hourly so the end lands within the hour. The
builder may instead create a dedicated `reverse-trial-cron`; it must then be registered with
`cron-health-cron` and scheduled only after it is deployed.

Leg E, for workspaces with `plan_source = 'trial'` and `reverse_trial_ends_at <= now()`, calls
`end_reverse_trial(ws)` (service_role only), which under a row lock:
- does nothing if a paid subscription is already in force (the subscribed write ends the trial);
- otherwise sets `plan_id = default`, `plan_source = 'system'`, `reverse_trial_ended_at = now()`,
  `reverse_trial_outcome = 'downgraded'`.

**What happens to their data**:
- Nothing is deleted or hidden. Clients 3 to 15, members 2 to 5, contracts, financeiro entries,
  automations and reports created on Pro stay readable and editable.
- Creating rows past Free's limits is blocked by the existing insert triggers, which the CRM's
  `FeatureGate` and limit dialogs already handle.
- Members beyond Free's 1 user keep access (the seats trigger is insert-only), the same as for a
  churned payer today. The downgrade dialog lists them so the owner can decide.
- Rate limits (reports, AI analyses, syncs per day) drop to Free's at once.
- Instagram auto-sync of accounts beyond Free's 2: the builder confirms what
  `instagram-sync-cron` does today for over-limit accounts and keeps that rule.

**Hub pause** (the only new enforcement): starting 7 days after `reverse_trial_ended_at`, Hub
links of a workspace with `reverse_trial_outcome = 'downgraded'` that is still on Free stop
opening.
- Choke point: `resolveHubAccess` (`_shared/hub-token.ts`), which every `hub-*` function already
  goes through (structural test). `hub_access_context` returns `paused: true`, `resolveHubAccess`
  returns `{ ok: false, reason: 'paused' }`, and `hubAccessDenied` answers with a dedicated code
  the Hub renders as a neutral page: "Este portal está pausado. Fale com {nome da agência} para
  voltar a acessar." No mention of plans or payment. `hub-auth` (login code) answers the same
  way for a paused workspace.
- Scope: ex-reverse-trial workspaces only. Churned paying customers keep today's behaviour;
  extending the pause to them is a separate decision.
- The pause lifts at once when the workspace gets any paid plan or a comp.
- Hub tokens are not deactivated or deleted; the same links work again after upgrading.
- The agency is warned before the pause three ways: the `reverse_trial_ended` email, the
  downgrade banner with the pause date, and the `reverse_trial_hub_pausing` email the day before.

**Downgrade state in the CRM** (owner and admins): a persistent banner "Seu workspace voltou para
o Free em {data}. Nada foi apagado." with "Recuperar o Pro". Before the Hub pause it adds "Seus
links do portal pausam em {data}."; after, "Os links do portal estão pausados." A one-time dialog
on the first visit after the downgrade lists what changed, from the plan rows and current usage
(for example "8 clientes: os 8 continuam aqui, mas o Free só cadastra até 2"). iOS: text only.

## Part 6: every place that special-cases `plan_source`

| Place | Change |
|---|---|
| `workspaces_plan_source_check` | add `'trial'` |
| `_shared/plan-writer.ts` | a `subscribed` write ends a trial and stamps the outcome; a `fallback` write never ends it (same as `demo`) |
| `grant_pagarme_plan` (SQL) | same rule as the writer; stamps the outcome on conversion |
| `platform-admin` comp (`index.ts` ~519) and `revert-target.ts` | comping a trial workspace ends the trial with `ended_by_admin`; reverting a comp never restores a trial |
| `pagarme-checkout/handler.ts` ~170 and ~620 | treat `trial` like Free for the switch gate and effective plan; `start_at` per Part 4 |
| `billing-checkout` | `trial_end` and `hasEverSubscribed` per Part 4 |
| `isTrialOfferEligible`, `hasUsedTrial` (CRM) | a reverse trial counts as used; no `/comecar` redirect while enabled |
| `get_nurture_candidates` | exclude `plan_source = 'trial'`; after the downgrade nurture may resume, with step a3 ("Teste tudo do Mesaas por 30 dias") replaced by a "Recupere o Pro" variant for ex-trial workspaces |
| `get_trial_reminder_candidates` | query unchanged; log level per Part 4 |
| Loops and Crisp sync RPCs (`20260803000004`, `20260804000011`) | they bucket on "effective free plan"; send trial workspaces as their own segment (`plan_source = trial`, `trial_ends_at`) so audiences don't treat them as paying Pro |
| `admin_list_workspaces` and Admin workspace detail | show "Teste Pro sem cartão até {data}"; a "teste sem cartão" filter; actions to extend the end date or end now |
| Admin metrics | MRR reads subscriptions and is unaffected; plan counts must not show trial workspaces as Pro customers |
| Demo workspaces | never eligible |

The builder also greps for direct `plan_id` writes outside `plan-writer.ts` (today only
`platform-admin`) and for any reader that equates "not Free" with "paying".

## Part 7: copy

Use the October audit as the map of every trial and card claim. Changes:
- Landing hero note, pricing headline, final CTA, `precos.content.ts`, `site-meta.ts`,
  `MarketingPage`: the signup CTA says "14 dias de Pro grátis, sem cartão". Paid-plan CTAs that
  go to checkout keep their own wording.
- Welcome email: Part 3. Nurture a3: Part 6.
- `TermosPage` trial clause: describe both the 14-day no-card trial (ends on Free, nothing
  charged) and the card trial (charged on the date shown, reminder 7 days before when there is
  time). Legal text: the frontend merge waits for the product owner to approve the wording.
- pt-BR, sentence case, no em dashes. Days and dates in `America/Sao_Paulo`.

## Part 8: measurement

The database is the source of truth (PostHog sees about 10% of `/` because of the consent
gate): the `reverse_trial_*` columns give started, card added, outcome and timing for every
workspace. The Admin dashboard gets one funnel card: started, activated by day 7 (at least one
client and one post), card added, paid after the first charge, downgraded.

PostHog events, for behaviour inside the app:
- `reverse_trial_started` (`source`: `signup` or `nudge`), after the RPC succeeds.
- `reverse_trial_banner_viewed` (`days_left`, `phase`), at most once a day.
- `reverse_trial_add_card_clicked` (`surface`: `banner`, `modal`, `cobranca` or `email` via UTM).
- `checkout_started` gains `reverse_trial: true` and `days_left`.
- `reverse_trial_ended` (`outcome`), server-side via `_shared/posthog.ts` from the sweep and the
  conversion path.
- `hub_paused_viewed`, from the Hub paused page, with no client identifiers.

Targets for the first 60 days of new signups: 60% or more of trial owners create a client
during the trial; a card is added on 15% or more of trials; 10% or more are paid after the first
charge. If card-added is under 8% after 40 finished trials, revisit the length and the Hub
pause.

## Deploy order and rollback

1. Migration (additive): columns, `'trial'` in the check, `reverse_trial_eligible`,
   `start_reverse_trial`, `end_reverse_trial`, the kill switch (off), `paused` in
   `hub_access_context`, the nurture, Loops, Crisp and Admin RPC changes, `grant_pagarme_plan`.
2. Edge functions: `billing-downgrade-cron` (leg E), `billing-checkout`, `pagarme-checkout`,
   `stripe-webhook`, `pagarme-webhook`, `pagarme-subscription` (plan-writer), every `hub-*`
   function plus `hub-auth` (they bundle `hub-token.ts`; all `--no-verify-jwt`),
   `lifecycle-email-cron`, `platform-admin`, `loops-sync-cron`, `crisp-sync-cron`.
3. Raise the downgrade cron's schedule to hourly (only after step 2).
4. Frontend merge (CRM, Hub, Admin). Legal copy approved first.
5. Turn the kill switch on.

Rollback: turn the kill switch off, so nobody new starts. Running trials keep their end date and
the sweep ends them. If the sweep itself must be rolled back, end every running trial first with
`end_reverse_trial`. With the switch off the frontend can roll back freely. Never clear the
`reverse_trial_*` or `reverse_trial_used_at` columns: they are the one-per-person record.

## Left to the builder

Component structure, banner placement per shell, the sweep cadence (hourly or tighter), where
the kill switch lives, email HTML, the Admin UI layout and how the "what you used" counts are
fetched. Anything that changes the decisions table, the goals, the anti-goals or the Hub pause
scope goes back to the product owner.
