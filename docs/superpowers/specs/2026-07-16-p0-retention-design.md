# P0 retention — dunning, radar, instrumentation

Status: approved, not yet implemented
Branch: `claude/customer-retention-strategy-72a637`

## Context — what the audit found

A full retention audit of the product (CRM, Hub, Admin, billing, lifecycle comms) established
that the value loop is built and the system around it is not. The four leaks, in the order they
cost money:

1. **Involuntary churn is unmanaged.** `invoice.payment_failed` records `past_due` and stops.
   No email, no banner, no grace policy. The owner only learns of it by opening the billing page.
2. **Activation rests on one dismissible checklist** whose steps are partly uncompletable (below).
3. **Nothing reaches a user outside the app.** All 14 notification types are in-app only.
4. **None of it is measurable.** No product analytics exist — Sentry errors and Vercel pageviews only.

P0 addresses leaks 1 and 4 head-on (Components 1–3), and fixes three contained bugs found while
designing them: the stale failure count (Component 1), the report email's missing Hub link
(Component 4), and the checklist's paywall steps (Component 5). Leak 2's actual rework and leak 3
in full are P1/P2 and are explicitly out of scope here.

### Findings from the design pass that changed the plan

These were discovered by reading the code, and each one invalidated an assumption the original
plan carried:

- **`global_banners` is the wrong vehicle for a dunning banner.** It targets a *workspace*, not a
  role (`20260502000001_global_banners.sql`), so every agent would see the owner's billing
  failure. It is dismissible, and it is stored state requiring create-on-fail / archive-on-recovery
  lifecycle — a sync bug waiting to happen. Superseded by the derived-state design in Component 1.
- **`failed_payment_count` never resets.** `syncSubscription` upserts without touching it, so a
  workspace that recovers keeps its failure count forever and reads as permanently troubled in the
  admin. Fixed as part of Component 1.
- **The Free plan cannot reach the aha moment.** Free is `is_default = true` and has
  `feature_hub_portal = false` (`seed.sql`). Every self-serve signup lands on a plan where the
  client portal does not exist. See "Flagged, not addressed here".
- **The onboarding checklist routes Free users into paywalls.** See Component 5.
- **Two cron schedules may be silently dead.** See "Deployment notes".

## Goals

- A failed payment reaches the owner, on a defined timeline, with a way to fix it.
- A workspace at risk reaches a human, weekly, without anyone logging in to look.
- The activation funnel becomes measurable.
- The one recurring value email in the product stops shipping a missing link.
- The onboarding checklist stops sending new users into upgrade walls.

## Non-goals

Deliberately excluded. Each is a real item; none belongs in P0:

- **Trial-by-default** and any change to plan feature matrices — a pricing decision (flagged below).
- The P1 onboarding rework (reorienting around the first Hub link, sample data, welcome sequence).
- Notification email fan-out, end-client Hub notifications, digests (P2).
- Cancel intercept, save offers, win-back, upsell nudges (P3).
- A recovery ("payment confirmed") email — Stripe sends its own receipt.
- A post-downgrade ("your plan changed") email — belongs with the P3 win-back work.
- Server-side PostHog capture, reverse-proxying, and Hub-side instrumentation.
- A cookie-consent banner (see "Known limitations").

## Design decisions and their rationale

**The grace period is Stripe's, not ours.** Stripe already owns a dunning state machine: Smart
Retries, a retry schedule, and a terminal action. Building an app-side grace clock would duplicate
it and produce two timelines that disagree about whether someone is paid. Instead Stripe drives
(~4 attempts over ~14 days, then cancel), the existing `customer.subscription.deleted` →
`statusToPlanId` → `defaultPlanId` path performs the downgrade unchanged, and the app's only job
is to *communicate* during the window. The 14 days is dashboard configuration, not code.

**The dunning banner is derived state, not stored state.** Owners already have RLS read on
`workspace_subscriptions` (`workspace_subscriptions_owner_read`). A component that renders from
`status === 'past_due'` is correct by construction: it appears when Stripe says the payment failed
and disappears when Stripe says it recovered. There is no row to create, archive, or reconcile,
and no state that can drift from Stripe's truth.

**Escalation keys off Stripe's own signal.** `invoice.next_payment_attempt === null` is Stripe
stating it will not retry again. That is the "final notice" trigger — more robust than hardcoding
an attempt count against a retry schedule that is configured outside the codebase.

**The dunning email must never throw.** `stripe-webhook` returns 500 on a handler error and Stripe
redelivers; a throwing send would re-send the email on every redelivery. It takes the best-effort
contract of `_shared/notify.ts` (log and swallow), *not* the throwing contract of
`_shared/invite-email.ts` (which is deliberate there — an admin needs to know a resend failed).

**The radar reuses `admin_workspace_last_activity` rather than reimplementing it.** That RPC's
`GREATEST` over real work artifacts is subtle and hard-won (see its migration's header comment).
The cron passes it every workspace id and joins subscriptions in TypeScript. No SQL is duplicated.

## Component 1 — dunning

### Migration

Add to `workspace_subscriptions`:

- `past_due_since timestamptz` — first failure of the current dunning episode.
- `next_payment_attempt timestamptz` — Stripe's next retry, for display.

### `_shared/dunning-logic.ts` (pure, unit-tested)

```ts
export type DunningStage = 'first' | 'retry' | 'final';

export function selectDunningStage(
  attemptCount: number,
  nextPaymentAttempt: number | null,
): DunningStage;
```

`nextPaymentAttempt === null` → `'final'`; `attemptCount <= 1` → `'first'`; otherwise `'retry'`.
No Stripe or Supabase imports, mirroring `_shared/billing-logic.ts`.

### `_shared/dunning-email.ts`

`buildDunningEmail({ workspaceName, stage, nextAttemptAt, billingUrl })` returns HTML in the house
style of `invite-email.ts` (PT-BR, escaped via `report-template/escape.ts`). Copy escalates:

| Stage | Subject | Tone |
|---|---|---|
| `first` | Não conseguimos processar seu pagamento | Soft — the common case is an expired card |
| `retry` | Ainda não conseguimos processar seu pagamento | Firmer, names the next attempt date |
| `final` | Último aviso — seu acesso será reduzido | States the consequence plainly |

`sendDunningEmail(...)` posts to Resend from `Mesaas <cobranca@mesaas.com.br>`, reads env lazily,
returns silently when unconfigured, and never throws.

### `stripe-webhook` changes

`handlePaymentFailed` already reads the subscription row to resolve `workspace_id`, but selects
only that column — **widen the select to include `past_due_since`** so the coalesce below can read
its own prior value. Then:

- `past_due_since: existing.past_due_since ?? now()` (idempotent across redeliveries).
- `next_payment_attempt` from the invoice.
- `failed_payment_count: invoice.attempt_count` (unchanged).
- Resolve the owner and the workspace name, then `await sendDunningEmail(...)`.

In `syncSubscription`, when `sub.status` is `active` or `trialing`, clear the episode:
`past_due_since: null, next_payment_attempt: null, failed_payment_count: 0`. This is the
stale-counter fix.

**Resolving the owner's email.** `profiles` has no `email` column (`20260301_baseline_schema.sql`).
Use the path `platform-admin` already uses: `workspace_members` where
`workspace_id = <id> and role = 'owner'` → `user_id` → `svc.auth.admin.getUserById(user_id)` →
`user.email`. `workspace_members` is preferred over `profiles.conta_id` here because it is
workspace-scoped; `conta_id` is the legacy single-workspace field and the two can disagree now that
`max_workspaces_per_user` exists. Workspace name comes from `workspaces.name`.

Recipient is the workspace **owner** only — the sole role that can act (`billing-checkout` and
`billing-portal` are already owner-gated).

### CRM banner

Reuse the existing read path rather than adding a second one: `services/billing.ts` already
exports `getWorkspaceSubscription()` and a `WorkspaceSubscription` interface. Widen both to carry
`past_due_since` and `next_payment_attempt`. `CobrancaPage` continues to consume it unchanged.

`apps/crm/src/components/billing/DunningBanner.tsx`, rendered in `AppLayout` above content:

- Reads via `getWorkspaceSubscription()` wrapped in `useQuery`; renders only for `role === 'owner'`
  and `status === 'past_due'`. RLS already restricts the row to owners, so the role check is a UI
  concern, not the security boundary.
- Non-dismissible. Critical styling per `DESIGN_SYSTEM.md` (`--danger`).
- Copy names `next_payment_attempt` when present; CTA links to `/configuracao/cobranca`.

### Stripe dashboard configuration (not code)

Smart Retries enabled, ~4 attempts across ~14 days, terminal action **cancel subscription**.
Stripe's own failed-payment emails enabled. Recorded here because the app's timeline is
meaningless without it.

## Component 2 — at-risk radar

`supabase/functions/retention-radar-cron/` split `index.ts` (env + secret) and `handler.ts`
(injectable `cronSecret`, `timingSafeEqual`, `run`), following `notification-deadline-cron`.

### `_shared/radar-logic.ts` (pure, unit-tested)

```ts
export type RadarBucket = 'past_due' | 'trial_ending' | 'dormant' | 'cooling';

export function bucketWorkspace(
  row: { status: string | null; currentPeriodEnd: string | null; lastActivityAt: string | null },
  now: Date,
): RadarBucket | null;
```

Precedence, most urgent first — a workspace appears once, under its worst signal:

1. `past_due` — `status === 'past_due'`.
2. `trial_ending` — `status === 'trialing'` and `current_period_end` within 7 days.
3. `dormant` — `lastActivityAt` older than 30 days, or never.
4. `cooling` — `lastActivityAt` between 7 and 30 days.

Thresholds match `apps/admin/src/pages/workspace-activity.ts` so admin and radar never disagree.

### Scope and schedule

Covers workspaces with `status in ('active','trialing','past_due')` only. Dormant Free workspaces
are activation failures, not churn risk, and would flood the list; measuring them is Component 3's
job. Schedule `0 12 * * 1` — Monday 12:00 UTC (09:00 Brasília), the same hour as the existing
deadline cron. Sends to `ALERT_EMAIL`, sectioned by bucket, each row: workspace, owner email, plan,
status, last activity, failed payment count. Owner email resolves the same way as Component 1
(`workspace_members` → `auth.admin.getUserById`).

The schedule migration **must** use `(SELECT decrypted_secret FROM vault.decrypted_secrets WHERE
name = ...)`. The `vault.decrypted_secret(...)` function form does not exist on this instance
(`20260428000003`), and pg_cron-layer failures are silent.

## Component 3 — PostHog instrumentation

`posthog-js` in the CRM only, EU cloud (`https://eu.i.posthog.com`), keyed by
`VITE_POSTHOG_KEY` / `VITE_POSTHOG_HOST`. No-ops when the key is absent so local and CI are unaffected.

Init alongside Sentry in `main.tsx`; `identify` on auth with workspace id, plan id, and role as
properties; PostHog **group analytics** keyed by workspace, since retention is a workspace
property, not a user one.

Eight events, all capturable from the CRM:

| Event | Fires from |
|---|---|
| `signup_completed` | `pages/login/LoginPage.tsx` |
| `workspace_setup_completed` | `pages/workspace-setup/WorkspaceSetupPage.tsx` |
| `client_created` | `pages/clientes/ClientesPage.tsx` |
| `instagram_connected` | OAuth return handler |
| `workflow_created` | `pages/entregas/EntregasPage.tsx` |
| `hub_link_copied` | `pages/cliente-detalhe/HubTab.tsx` |
| `report_generated` | `pages/analytics-conta/AnalyticsContaPage.tsx` |
| `invite_sent` | `pages/configuracao/ConfiguracaoPage.tsx` |

Note a correction from the approved outline: it listed "first client approval". That is an
end-client action inside the Hub and is not observable from a CRM-only SDK. `hub_link_copied` is
the honest proxy for the activation milestone; capturing the approval itself requires Hub
instrumentation, which is a follow-up.

Ships with a privacy-policy update (`pages/politica-privacidade/`) naming PostHog as a processor
and disclosing the international transfer, per LGPD. Configured with
`person_profiles: 'identified_only'` to avoid building profiles for anonymous visitors.

## Component 4 — report email Hub link

`_shared/hub-url.ts`:

```ts
export async function resolveHubUrl(
  svc: SupabaseClient,
  clienteId: number,
  contaId: string,
): Promise<string>;
```

Reads the workspace slug and the client's `client_hub_tokens` row, requiring `is_active` and
`expires_at > now()`. Returns `''` when there is no live token — `buildReportEmail` already hides
the button on an empty string (`report-template/email.ts`), so the failure mode is the current
behaviour rather than a dead link. URL shape `${APP_BASE_URL}/${slug}/hub/${token}` mirrors
`HubTab.tsx`.

New env var `APP_BASE_URL`. `OAUTH_REDIRECT_BASE` is not overloaded — it means something else and
would couple two unrelated concerns.

Both send paths call it: `instagram-analytics` (the manual "Enviar" action) and `report-worker`
(the monthly auto-send).

Deliberately not checked: whether the plan still has `feature_hub_portal`. A live token on a
downgraded plan yields a link that `hub-bootstrap` rejects. Accepted for P0 — the token lifecycle
work already surfaces expiry in the CRM, and the extra join is not worth it until it is observed
to bite.

## Component 5 — checklist feature-awareness

`OnboardingBanner` never consults entitlements. On Free (`feature_leads = false`,
`feature_analytics_reports = false`), "Criar primeiro lead" → `/leads` and "Conectar conta do
Instagram" → `/analytics` are both nav-hidden and gated: two of six steps are permanently
uncompletable, so the list never reaches 6/6, never auto-dismisses, and routes new users into
upgrade walls.

Filter `steps` through `useEntitlements().hasFeature` before rendering, so the checklist offers
only steps the current plan can complete. Progress and auto-dismiss then compute against the
filtered list.

Scope discipline: this fixes the bug and nothing else. Reordering the steps around the Hub, the
persistent-until-done behaviour, and the `--accent`/indigo styling that does not match
`DESIGN_SYSTEM.md` all belong to the P1 rework.

This replaces the originally-planned "point the team step at invites" fix, which was not the
one-liner it appeared to be: changing `to:` without changing `done:` (computed from `membros`, the
cost registry, not workspace users) creates a step that can never tick. Surfacing invites is P2.

## Error handling

| Failure | Behaviour |
|---|---|
| Resend down during dunning | Logged, swallowed. DB state is still written; the banner still shows. |
| Webhook redelivery | `past_due_since` coalesces; `failed_payment_count` is assigned, never incremented. A duplicate email is possible and accepted. |
| Radar cron fails | Existing `reportCronFailure` path → internal alert. |
| PostHog unreachable / key absent | SDK no-ops. Never blocks a render. |
| No live hub token | `resolveHubUrl` returns `''`; email sends without the button. |
| Entitlements not loaded | Checklist renders unfiltered — same as today, no regression. |

## Testing

Deno (`supabase/functions/__tests__/`, alongside `billing-logic_test.ts`):

- `dunning-logic_test.ts` — stage selection across attempt counts and a null next-attempt.
- `radar-logic_test.ts` — bucket precedence, boundaries at exactly 7 and 30 days, never-active.
- `hub-url_test.ts` — live token, expired token, inactive token, missing slug.
- `stripe-webhook` — `past_due_since` set once across redeliveries; recovery clears all three fields.

Vitest / RTL (`apps/crm`):

- `DunningBanner` — renders for owner + `past_due`; hidden for agent, admin, and non-`past_due`.
- `OnboardingBanner` — steps hidden when their feature flag is false; progress counts the
  filtered list; a Free-plan workspace can reach 100%.

Per `CLAUDE.md`, `npm run build` typechecks. Per memory, a contract change breaks tests in both
suites — grep both `apps/**/__tests__` and `supabase/functions/__tests__` for the old shape.

## Deployment notes

**Verify the cron layer first.** `analytics-report-cron` (`20260416000001`) and
`notification-deadline-cron` (`20260430000002`) both schedule with the broken
`vault.decrypted_secret(...)` function form. Two other crons hit this and were repaired
(`20260428000003`, `20260525130000`); these two were not. If they are dead in prod, the monthly
report email is not sending at all — which makes Component 4 moot until the schedule is fixed.
Confirm with `SELECT jobname, schedule, active FROM cron.job;` **before** starting Component 4,
and check for a recent successful run in `cron.job_run_details`.

Ordering: Component 1 first (it is the revenue fix; it should not queue behind analytics review).
Then 2, 3, 5 in any order. Component 4 after the cron verification.

- Check `supabase/.temp/project-ref` before any `--linked` command — the repo defaults to **prod**.
- Deploy edge functions with `--use-api` (the local Docker bundler is broken).
- `retention-radar-cron` needs `verify_jwt = false` in `config.toml`, deployed **before** its
  schedule migration is applied (the schedule fires immediately).
- New secrets: `APP_BASE_URL` (edge). New CRM env: `VITE_POSTHOG_KEY`, `VITE_POSTHOG_HOST`
  (Vercel, both apps' build envs as applicable).
- Five PRs, one per component.

## Known limitations

- **A duplicate dunning email is possible.** Stripe redelivery after a post-send handler error
  re-sends. Making this exact requires a send ledger; not worth it at this volume.
- **The radar covers paying and trialing workspaces only.** Free-tier activation failure is
  measured by Component 3, not emailed.
- **No cookie-consent banner.** PostHog is disclosed in the privacy policy and configured for
  identified-only profiles. Whether LGPD requires consent here rather than legitimate interest is
  a legal question, flagged rather than answered.
- **The 14-day window lives in the Stripe dashboard**, not in version control. The spec is its
  only record.

## Flagged, not addressed here

**The default plan cannot reach the aha moment.** Free is `is_default = true` with
`feature_hub_portal = false`. Every self-serve signup lands where the client portal — the
product's strongest retention asset and the intended activation milestone — does not exist. The
30-day trial exists but only via the `BEMVINDO` promo code at checkout, so it is not the default
path either.

This makes trial-by-default (or putting a limited Hub on Free) a **precondition** for the P1
activation work, not the growth tweak the original plan called it: instrumenting a funnel whose
final step is unreachable will measure a wall. It is a pricing decision and is left open.
