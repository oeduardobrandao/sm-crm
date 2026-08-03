# Teste grátis como porta de entrada — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the 30-day trial the default path for every new signup, with no promo code to discover and no settings page to find.

**Architecture:** The trial becomes unconditional server-side for any workspace that has never held a Stripe subscription. A new `/comecar` step sits between signup and the dashboard; landing-page plan CTAs carry their choice through signup straight into Stripe Checkout. Anyone who declines lands on Free with a resurfacing dashboard nudge. No migration, no schema change.

**Tech Stack:** React 19 + React Router v7 + TanStack Query (CRM), Deno edge functions, Stripe Checkout, Vitest + `deno test`.

**Spec:** [`docs/superpowers/specs/2026-08-03-free-trial-signup-flow-design.md`](../specs/2026-08-03-free-trial-signup-flow-design.md)

## Global Constraints

- **No em dashes in user-facing copy.** Use a period, a colon, or `·`. Applies to every Portuguese string added here.
- **UI language is Portuguese (pt-BR).** Code, comments, and test names stay in English, matching the codebase.
- **No migration, no schema change** in this plan.
- **CORS:** never a wildcard. `billing-checkout` already uses `buildCorsHeaders(req)`; do not change it.
- **Edge functions never return raw error details** to clients. Generic message out, detail to `console.error`.
- **Prettier and ESLint are CI gates** over `apps/**` and `packages/**` `.ts`/`.tsx`. Run `npm run format` before committing frontend changes.
- **`npm run test:functions` dirties the root `deno.lock`.** Always `git checkout -- deno.lock` before committing.
- **Adding a top-level CRM route requires three edits** (`APP_ROUTE_PREFIXES`, the `vercel.json` rewrite, the `vercel.json` X-Robots-Tag header). Missing them means the route works in dev and 404s in production.
- Icons are `lucide-react`. Toasts are `toast()` from `sonner`.

## File Structure

**Create:**
| File | Responsibility |
|---|---|
| `supabase/functions/_shared/trial.ts` | Pure trial/return-path/idempotency decisions. No Stripe, Supabase, or env. |
| `supabase/functions/__tests__/trial_test.ts` | Deno tests for the above. |
| `apps/crm/src/pages/comecar/plan-intent.ts` | Parse+validate plan intent from a URL. |
| `apps/crm/src/pages/comecar/__tests__/plan-intent.test.ts` | Tests for the parse. |
| `apps/crm/src/pages/comecar/ComecarPage.tsx` | The trial step. Self-guarding. |
| `apps/crm/src/pages/comecar/comecar.css` | Styles for that page only. |
| `apps/crm/src/pages/comecar/__tests__/ComecarPage.test.tsx` | Guard, auto-checkout, and fallback tests. |
| `apps/crm/src/components/billing/TrialNudgeCard.tsx` | Dashboard nudge for people who declined. |
| `apps/crm/src/components/billing/__tests__/TrialNudgeCard.test.tsx` | Eligibility and dismissal-window tests. |
| `apps/crm/src/lib/checkout-analytics.ts` | Single `checkout_started` emitter, shared by both entry points. |
| `apps/crm/src/lib/__tests__/checkout-analytics.test.ts` | Tests for it. |

**Modify:**
| File | Change |
|---|---|
| `supabase/functions/billing-checkout/index.ts` | Unconditional trial, source-based return URLs, idempotency key, active-sub 409. |
| `apps/crm/src/services/billing.ts` | `hasEverSubscribed`, `source` on `startCheckout`, drop `promoCode`. |
| `apps/crm/src/services/__tests__/billing.test.ts` | Replace the promo test; add source + `hasEverSubscribed`. |
| `apps/crm/src/pages/configuracao/cobranca/plan-display.ts` | Add `isSelectableTrialPlan`. |
| `apps/crm/src/pages/configuracao/cobranca/__tests__/plan-display.test.ts` | Tests for it. |
| `apps/crm/src/lib/analytics.ts` | Three new names in the closed `AnalyticsEvent` union. |
| `apps/crm/src/App.tsx` | Register `/comecar`. |
| `apps/crm/src/content/site-meta.ts` | Add `'comecar'` to `APP_ROUTE_PREFIXES`. |
| `vercel.json` | Add `comecar` to the rewrite and the noindex header. |
| `apps/crm/src/pages/landing/PricingSection.tsx` | Trial copy, intent-carrying hrefs, delete `PROMO_CODE`. |
| `apps/crm/src/pages/landing/LandingPage.tsx` | Banner + hero copy. |
| `apps/crm/src/pages/landing/__tests__/LandingPage.test.tsx` | Retarget the `BEMVINDO` assertion. |
| `apps/crm/src/lib/supabase.ts` | `signUp` takes `redirectPath`. |
| `apps/crm/src/pages/login/LoginPage.tsx` | Trim validation, required company, intent forwarding, auto-login nav. |
| `apps/crm/src/pages/workspace-setup/WorkspaceSetupPage.tsx` | Post-save navigate to `/comecar`. |
| `apps/crm/src/pages/dashboard/DashboardPage.tsx` | Mount the nudge, handle `?trial=`. |
| `apps/crm/src/pages/configuracao/cobranca/CobrancaPage.tsx` | Remove promo input, retitle CTA. |
| `apps/crm/src/pages/configuracao/cobranca/cobranca.css` | Remove `.billing-promo` rules. |

---

### Task 1: Pure trial helpers for the edge function

**Files:**
- Create: `supabase/functions/_shared/trial.ts`
- Test: `supabase/functions/__tests__/trial_test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `TRIAL_DAYS: number`, `type CheckoutSource = 'onboarding' | 'billing'`, `interface ReturnPaths { success: string; cancel: string }`, `resolveTrialDays(hasPriorSubscription: boolean): number | undefined`, `resolveReturnPaths(source: unknown): ReturnPaths`, `buildCheckoutIdempotencyKey(workspaceId: string, planId: string, interval: string, nowMs: number): string`.

- [ ] **Step 1: Write the failing test**

Create `supabase/functions/__tests__/trial_test.ts`:

```ts
import { assertEquals } from "./assert.ts";
import {
  buildCheckoutIdempotencyKey,
  resolveReturnPaths,
  resolveTrialDays,
  TRIAL_DAYS,
} from "../_shared/trial.ts";

Deno.test("resolveTrialDays grants the trial only to workspaces that never subscribed", () => {
  assertEquals(resolveTrialDays(false), TRIAL_DAYS);
  assertEquals(resolveTrialDays(true), undefined);
});

Deno.test("resolveReturnPaths sends onboarding back to the dashboard", () => {
  assertEquals(resolveReturnPaths("onboarding"), {
    success: "/dashboard?trial=started",
    cancel: "/dashboard?trial=skipped",
  });
});

Deno.test("resolveReturnPaths falls back to billing for anything unrecognised", () => {
  const billing = {
    success: "/configuracao/cobranca?status=success",
    cancel: "/configuracao/cobranca?status=cancelled",
  };
  assertEquals(resolveReturnPaths("billing"), billing);
  assertEquals(resolveReturnPaths(undefined), billing);
  assertEquals(resolveReturnPaths(null), billing);
  assertEquals(resolveReturnPaths("https://evil.example.com"), billing);
  assertEquals(resolveReturnPaths({ success: "https://evil.example.com" }), billing);
});

Deno.test("buildCheckoutIdempotencyKey is stable inside an hour, different across hours", () => {
  const base = Date.UTC(2026, 7, 3, 10, 0, 0);
  const a = buildCheckoutIdempotencyKey("ws-1", "pro", "month", base);
  const b = buildCheckoutIdempotencyKey("ws-1", "pro", "month", base + 59 * 60_000);
  const c = buildCheckoutIdempotencyKey("ws-1", "pro", "month", base + 61 * 60_000);
  assertEquals(a, b);
  assertEquals(a === c, false);
});

Deno.test("buildCheckoutIdempotencyKey separates workspace, plan and interval", () => {
  const now = Date.UTC(2026, 7, 3, 10, 0, 0);
  const a = buildCheckoutIdempotencyKey("ws-1", "pro", "month", now);
  assertEquals(a === buildCheckoutIdempotencyKey("ws-2", "pro", "month", now), false);
  assertEquals(a === buildCheckoutIdempotencyKey("ws-1", "max", "month", now), false);
  assertEquals(a === buildCheckoutIdempotencyKey("ws-1", "pro", "year", now), false);
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npm run test:functions
```

Expected: FAIL — `Module not found "../_shared/trial.ts"`.

- [ ] **Step 3: Write the implementation**

Create `supabase/functions/_shared/trial.ts`:

```ts
// Pure decisions for the trial-first checkout flow. No Stripe/Supabase/env
// dependencies — unit-testable in isolation, mirroring dunning-logic.ts.

export const TRIAL_DAYS = 30;

export type CheckoutSource = "onboarding" | "billing";

export interface ReturnPaths {
  success: string;
  cancel: string;
}

const RETURN_PATHS: Record<CheckoutSource, ReturnPaths> = {
  onboarding: {
    success: "/dashboard?trial=started",
    cancel: "/dashboard?trial=skipped",
  },
  billing: {
    success: "/configuracao/cobranca?status=success",
    cancel: "/configuracao/cobranca?status=cancelled",
  },
};

/**
 * Trial days for a checkout session, or undefined once the workspace has
 * subscribed before. Eligibility is per workspace and permanent: the webhook
 * only ever writes stripe_subscription_id and never clears it, so cancelling
 * does not buy a second trial.
 */
export function resolveTrialDays(hasPriorSubscription: boolean): number | undefined {
  return hasPriorSubscription ? undefined : TRIAL_DAYS;
}

/**
 * Where Stripe returns the user. The caller supplies a SOURCE, never a URL, and
 * anything unrecognised falls back to billing — so a hostile request body cannot
 * turn this into an open redirect.
 */
export function resolveReturnPaths(source: unknown): ReturnPaths {
  return source === "onboarding" ? RETURN_PATHS.onboarding : RETURN_PATHS.billing;
}

/**
 * Idempotency key for checkout session creation. Two tabs racing inside the same
 * hour get the SAME Stripe session back rather than two separately completable
 * ones. The hour bucket stops a legitimate later retry from being pinned to a
 * stale session (Stripe retains keys for 24h).
 */
export function buildCheckoutIdempotencyKey(
  workspaceId: string,
  planId: string,
  interval: string,
  nowMs: number,
): string {
  const bucket = Math.floor(nowMs / 3_600_000);
  return `co_${workspaceId}_${planId}_${interval}_${bucket}`;
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
npm run test:functions
```

Expected: PASS, all 5 new tests green.

- [ ] **Step 5: Revert the lockfile churn and commit**

```bash
git checkout -- deno.lock
git add supabase/functions/_shared/trial.ts supabase/functions/__tests__/trial_test.ts
git commit -m "feat(billing): pure helpers for trial days, return paths and checkout idempotency"
```

---

### Task 2: Make the trial unconditional in billing-checkout

**Files:**
- Modify: `supabase/functions/billing-checkout/index.ts`

**Interfaces:**
- Consumes: `resolveTrialDays`, `resolveReturnPaths`, `buildCheckoutIdempotencyKey` from Task 1.
- Produces: request body contract `{ plan_id: string, interval: 'month'|'year', source?: 'onboarding'|'billing' }`; `promo_code` is accepted but ignored. Responds 409 when a subscription is already active.

- [ ] **Step 1: Replace the promo constant with the helper import**

Delete the `LAUNCH_PROMO` block (lines 10–14) and add to the imports at the top:

```ts
import {
  buildCheckoutIdempotencyKey,
  resolveReturnPaths,
  resolveTrialDays,
} from "../_shared/trial.ts";
```

- [ ] **Step 2: Drop the promo parse from the body**

Delete this line:

```ts
const promoCode = String(body.promo_code || "").trim().toUpperCase();
```

`body.promo_code` is now simply never read, so an older client that still sends it gets a normal checkout instead of a 400.

- [ ] **Step 3: Select `status` too, and reject an already-active subscription**

Replace the `subRow` query and add the guard immediately after it:

```ts
    const { data: subRow } = await svc
      .from("workspace_subscriptions")
      .select("stripe_customer_id, stripe_subscription_id, status")
      .eq("workspace_id", workspaceId).maybeSingle();

    // A workspace mid-subscription belongs in the billing portal, not a second
    // checkout. Without this, a stale tab could open a duplicate subscription
    // against the same customer.
    if (subRow?.status === "active" || subRow?.status === "trialing") {
      return json({ error: "Este workspace já tem uma assinatura ativa." }, 409, headers);
    }
```

- [ ] **Step 4: Replace the promo validation block with the unconditional trial**

Delete the whole `if (promoCode) { … }` block (the `isFirstTimeSubscriber` / `trialDays` section, lines 68–84) and replace with:

```ts
    // Every workspace that has never subscribed gets the trial. No code, no gate.
    const trialDays = resolveTrialDays(Boolean(subRow?.stripe_subscription_id));
    const returnPaths = resolveReturnPaths(body.source);
```

- [ ] **Step 5: Use the return paths and the idempotency key on session creation**

Replace the `stripe.checkout.sessions.create({ … })` call with:

```ts
    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer: customerId,
      client_reference_id: workspaceId,
      line_items: [{ price: priceId, quantity: 1 }],
      subscription_data: {
        metadata: { workspace_id: workspaceId, plan_id: planId },
        ...(trialDays ? { trial_period_days: trialDays } : {}),
      },
      // Stripe's own promo box stays open for any real future coupon.
      allow_promotion_codes: true,
      // Always collect the card: a trial has to convert on day 30.
      payment_method_collection: "always",
      success_url: `${appBaseUrl}${returnPaths.success}`,
      cancel_url: `${appBaseUrl}${returnPaths.cancel}`,
    }, {
      // Two tabs racing inside the hour resolve to one session, not two.
      idempotencyKey: buildCheckoutIdempotencyKey(workspaceId, planId, interval, Date.now()),
    });
```

- [ ] **Step 6: Typecheck the function**

```bash
npx deno check --node-modules-dir=auto supabase/functions/billing-checkout/index.ts
```

Expected: no errors. (`npm run test:functions` runs with `--no-check`, so it will not catch a type error here — this step is the gate.)

- [ ] **Step 7: Confirm the helper suite still passes, then commit**

```bash
npm run test:functions
git checkout -- deno.lock
git add supabase/functions/billing-checkout/index.ts
git commit -m "feat(billing): unconditional 30-day trial, source-based return urls, idempotent checkout"
```

---

### Task 3: Client billing contract

**Files:**
- Modify: `apps/crm/src/services/billing.ts`
- Test: `apps/crm/src/services/__tests__/billing.test.ts`

**Interfaces:**
- Consumes: the request contract from Task 2.
- Produces: `type CheckoutSource = 'onboarding' | 'billing'`; `WorkspaceSubscription` gains `hasEverSubscribed: boolean`; `startCheckout(planId: string, interval: BillingInterval, source?: CheckoutSource): Promise<string>`.

- [ ] **Step 1: Write the failing tests**

In `apps/crm/src/services/__tests__/billing.test.ts`, add `getWorkspaceSubscription` to the import list at the top:

```ts
import {
  listPublicPricingPlans,
  startCheckout,
  openBillingPortal,
  getWorkspaceSubscription,
} from '../billing';
```

Replace the whole `it('startCheckout includes promo_code only when provided', …)` block with:

```ts
  it('startCheckout sends the checkout source and never a promo code', async () => {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => ({ url: 'https://checkout.stripe.com/abc' }),
    });
    await startCheckout('pro', 'month', 'onboarding');
    const [, opts] = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(JSON.parse(opts.body)).toEqual({
      plan_id: 'pro',
      interval: 'month',
      source: 'onboarding',
    });
  });

  it('startCheckout defaults the source to billing', async () => {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => ({ url: 'https://checkout.stripe.com/abc' }),
    });
    await startCheckout('pro', 'year');
    const [, opts] = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(JSON.parse(opts.body)).toEqual({
      plan_id: 'pro',
      interval: 'year',
      source: 'billing',
    });
  });
```

The earlier test `startCheckout posts plan+interval and returns the url` asserts `toEqual({ plan_id: 'pro', interval: 'year' })`; update that expectation to include `source: 'billing'`.

Then append these to the same `describe` block:

```ts
  function mockSubscriptionRow(row: Record<string, unknown> | null) {
    const maybeSingle = vi.fn().mockResolvedValue({ data: row, error: null });
    const subEq = vi.fn().mockReturnValue({ maybeSingle });
    const subSelect = vi.fn().mockReturnValue({ eq: subEq });
    const profileSingle = vi.fn().mockResolvedValue({ data: { conta_id: 'ws-1' }, error: null });
    const profileEq = vi.fn().mockReturnValue({ single: profileSingle });
    const profileSelect = vi.fn().mockReturnValue({ eq: profileEq });
    vi.mocked(supabase.auth.getUser).mockResolvedValue({
      data: { user: { id: 'user-1' } },
    } as never);
    from.mockImplementation((table: string) =>
      table === 'profiles' ? { select: profileSelect } : { select: subSelect },
    );
    return { subSelect };
  }

  it('derives hasEverSubscribed and hides the raw stripe id', async () => {
    const { subSelect } = mockSubscriptionRow({
      status: 'active',
      plan_id: 'pro',
      current_period_end: null,
      cancel_at_period_end: false,
      past_due_since: null,
      next_payment_attempt: null,
      stripe_subscription_id: 'sub_123',
    });
    const result = await getWorkspaceSubscription();
    expect(result?.hasEverSubscribed).toBe(true);
    expect(result).not.toHaveProperty('stripe_subscription_id');
    expect(subSelect).toHaveBeenCalledWith(
      'status, plan_id, current_period_end, cancel_at_period_end, past_due_since, next_payment_attempt, stripe_subscription_id',
    );
  });

  it('treats an abandoned-checkout row as never subscribed', async () => {
    mockSubscriptionRow({
      status: null,
      plan_id: null,
      current_period_end: null,
      cancel_at_period_end: false,
      past_due_since: null,
      next_payment_attempt: null,
      stripe_subscription_id: null,
    });
    const result = await getWorkspaceSubscription();
    expect(result?.hasEverSubscribed).toBe(false);
  });
```

Add `getUser` to the `supabase.auth` mock at the top of the file:

```ts
vi.mock('../../lib/supabase', () => ({
  supabase: {
    auth: {
      getSession: vi.fn().mockResolvedValue({ data: { session: { access_token: 'tok' } } }),
      getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'user-1' } } }),
    },
    from,
  },
}));
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
npx vitest run apps/crm/src/services/__tests__/billing.test.ts
```

Expected: FAIL — `source` missing from the request body, `hasEverSubscribed` undefined.

- [ ] **Step 3: Implement the contract change**

In `apps/crm/src/services/billing.ts`, add `hasEverSubscribed` to the interface:

```ts
export interface WorkspaceSubscription {
  status: string | null;
  plan_id: string | null;
  current_period_end: string | null;
  cancel_at_period_end: boolean;
  past_due_since: string | null;
  next_payment_attempt: string | null;
  /**
   * True once the workspace has ever held a Stripe subscription — the trial
   * eligibility flag. The raw stripe_subscription_id is deliberately dropped in
   * the service and never reaches component state.
   */
  hasEverSubscribed: boolean;
}

export type CheckoutSource = 'onboarding' | 'billing';
```

Replace the query and return in `getWorkspaceSubscription`:

```ts
  const { data, error } = await supabase
    .from('workspace_subscriptions')
    .select(
      'status, plan_id, current_period_end, cancel_at_period_end, past_due_since, next_payment_attempt, stripe_subscription_id',
    )
    .eq('workspace_id', profile.conta_id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;
  const { stripe_subscription_id: subscriptionId, ...rest } = data as Record<string, unknown>;
  return {
    ...(rest as Omit<WorkspaceSubscription, 'hasEverSubscribed'>),
    hasEverSubscribed: Boolean(subscriptionId),
  };
```

Replace `startCheckout`:

```ts
export async function startCheckout(
  planId: string,
  interval: BillingInterval,
  source: CheckoutSource = 'billing',
): Promise<string> {
  const res = await fetch(`${FUNCTIONS_BASE}/billing-checkout`, {
    method: 'POST',
    headers: await authHeaders(),
    body: JSON.stringify({ plan_id: planId, interval, source }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Erro ${res.status}`);
  return data.url as string;
}
```

- [ ] **Step 4: Fix the one existing caller so the app still typechecks**

`CobrancaPage.tsx:135` currently passes a promo argument. Change it to:

```ts
      const url = await startCheckout(planId, interval, 'billing');
```

Leave the rest of that page alone; it is cleaned up in Task 11.

- [ ] **Step 5: Run the tests and the typecheck**

```bash
npx vitest run apps/crm/src/services/__tests__/billing.test.ts
```

Expected: PASS.

```bash
npx tsc -p apps/crm/tsconfig.json --noEmit
```

Expected: no errors.

- [ ] **Step 6: Commit**

```bash
npm run format
git add apps/crm/src/services/billing.ts apps/crm/src/services/__tests__/billing.test.ts apps/crm/src/pages/configuracao/cobranca/CobrancaPage.tsx
git commit -m "feat(billing): expose hasEverSubscribed and a checkout source, drop the promo code"
```

---

### Task 4: A predicate for trial-selectable plans

**Files:**
- Modify: `apps/crm/src/pages/configuracao/cobranca/plan-display.ts`
- Test: `apps/crm/src/pages/configuracao/cobranca/__tests__/plan-display.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `isSelectableTrialPlan(plan: { id: string; price_brl: number | null }): boolean`.

- [ ] **Step 1: Write the failing test**

Append to `apps/crm/src/pages/configuracao/cobranca/__tests__/plan-display.test.ts` (add `isSelectableTrialPlan` to the existing import from `../plan-display`):

```ts
describe('isSelectableTrialPlan', () => {
  it('accepts a paid self-serve plan', () => {
    expect(isSelectableTrialPlan({ id: 'pro', price_brl: 9990 })).toBe(true);
  });

  it('rejects Free — declining is a link, not a card', () => {
    expect(isSelectableTrialPlan({ id: 'free', price_brl: 0 })).toBe(false);
  });

  it('rejects internal comp plans', () => {
    expect(isSelectableTrialPlan({ id: 'lifetime', price_brl: 0 })).toBe(false);
  });

  it('rejects a zero-priced plan that is not Free', () => {
    expect(isSelectableTrialPlan({ id: 'beta', price_brl: 0 })).toBe(false);
  });

  it('rejects a plan with no price configured', () => {
    expect(isSelectableTrialPlan({ id: 'beta', price_brl: null })).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npx vitest run apps/crm/src/pages/configuracao/cobranca/__tests__/plan-display.test.ts
```

Expected: FAIL — `isSelectableTrialPlan is not a function`.

- [ ] **Step 3: Implement it**

Append to `apps/crm/src/pages/configuracao/cobranca/plan-display.ts`:

```ts
/**
 * Plans offered as a trial on the /comecar step. `isPlanVisible` is NOT a
 * substitute: it only filters internal plans, so Free would still render a card
 * even though declining is a secondary link there, not a plan choice. The
 * price check is belt-and-braces — a future zero-priced catalog entry must not
 * silently become something you can start a trial on.
 */
export function isSelectableTrialPlan(plan: {
  id: string;
  price_brl: number | null;
}): boolean {
  return plan.id !== 'free' && !isInternalPlan(plan.id) && (plan.price_brl ?? 0) > 0;
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
npx vitest run apps/crm/src/pages/configuracao/cobranca/__tests__/plan-display.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
npm run format
git add apps/crm/src/pages/configuracao/cobranca/plan-display.ts apps/crm/src/pages/configuracao/cobranca/__tests__/plan-display.test.ts
git commit -m "feat(billing): add isSelectableTrialPlan predicate"
```

---

### Task 5: Parse plan intent from the URL

**Files:**
- Create: `apps/crm/src/pages/comecar/plan-intent.ts`
- Test: `apps/crm/src/pages/comecar/__tests__/plan-intent.test.ts`

**Interfaces:**
- Consumes: `BillingInterval` from `@/services/billing`.
- Produces: `interface PlanIntent { planId: string; interval: BillingInterval }`, `parsePlanIntent(search: string): PlanIntent | null`, `buildPlanIntentQuery(planId: string, interval: BillingInterval): string`.

- [ ] **Step 1: Write the failing test**

Create `apps/crm/src/pages/comecar/__tests__/plan-intent.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { buildPlanIntentQuery, parsePlanIntent } from '../plan-intent';

describe('parsePlanIntent', () => {
  it('reads a valid plan and interval', () => {
    expect(parsePlanIntent('?plan=pro&interval=year')).toEqual({
      planId: 'pro',
      interval: 'year',
    });
  });

  it('defaults a missing or unknown interval to month', () => {
    expect(parsePlanIntent('?plan=start')).toEqual({ planId: 'start', interval: 'month' });
    expect(parsePlanIntent('?plan=start&interval=weekly')).toEqual({
      planId: 'start',
      interval: 'month',
    });
  });

  it('rejects a plan id outside the self-serve set', () => {
    expect(parsePlanIntent('?plan=lifetime')).toBeNull();
    expect(parsePlanIntent('?plan=free')).toBeNull();
    expect(parsePlanIntent('?plan=../../etc/passwd')).toBeNull();
  });

  it('returns null when no plan is present', () => {
    expect(parsePlanIntent('')).toBeNull();
    expect(parsePlanIntent('?tab=register')).toBeNull();
  });
});

describe('buildPlanIntentQuery', () => {
  it('round-trips through parsePlanIntent', () => {
    const query = buildPlanIntentQuery('max', 'year');
    expect(parsePlanIntent(`?${query}`)).toEqual({ planId: 'max', interval: 'year' });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npx vitest run apps/crm/src/pages/comecar/__tests__/plan-intent.test.ts
```

Expected: FAIL — cannot resolve `../plan-intent`.

- [ ] **Step 3: Implement it**

Create `apps/crm/src/pages/comecar/plan-intent.ts`:

```ts
import type { BillingInterval } from '@/services/billing';

/** Plans a visitor can pick for themselves. Mirrors PAID_PLANS in billing-checkout. */
const SELECTABLE_PLAN_IDS = new Set(['start', 'pro', 'max']);

export interface PlanIntent {
  planId: string;
  interval: BillingInterval;
}

/**
 * Reads the plan choice carried from the landing page through signup.
 *
 * This runs on a URL the user can edit, so nothing unrecognised is passed
 * through. It is not the security boundary — billing-checkout validates the
 * plan id again server-side — but failing here keeps a tampered link from
 * rendering a nonsense page or firing a doomed checkout.
 */
export function parsePlanIntent(search: string): PlanIntent | null {
  const params = new URLSearchParams(search);
  const planId = params.get('plan');
  if (!planId || !SELECTABLE_PLAN_IDS.has(planId)) return null;
  const interval: BillingInterval = params.get('interval') === 'year' ? 'year' : 'month';
  return { planId, interval };
}

/** The query string half of a plan intent, without the leading `?`. */
export function buildPlanIntentQuery(planId: string, interval: BillingInterval): string {
  return new URLSearchParams({ plan: planId, interval }).toString();
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
npx vitest run apps/crm/src/pages/comecar/__tests__/plan-intent.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
npm run format
git add apps/crm/src/pages/comecar/plan-intent.ts apps/crm/src/pages/comecar/__tests__/plan-intent.test.ts
git commit -m "feat(onboarding): parse and build plan intent query params"
```

---

### Task 5b: Analytics events and one shared checkout event

**Files:**
- Modify: `apps/crm/src/lib/analytics.ts`
- Create: `apps/crm/src/lib/checkout-analytics.ts`
- Test: `apps/crm/src/lib/__tests__/checkout-analytics.test.ts`

**Interfaces:**
- Consumes: `BillingInterval`, `CheckoutSource` from `@/services/billing` (Task 3).
- Produces: `captureCheckoutStarted(planId: string, interval: BillingInterval, source: CheckoutSource): void`; three new `AnalyticsEvent` names.

`AnalyticsEvent` is a **closed union** with a compile-time guard beneath it. Emitting a name that is not in the union fails `tsc`, so this task must land before Tasks 6 and 10.

- [ ] **Step 1: Write the failing test**

Create `apps/crm/src/lib/__tests__/checkout-analytics.test.ts`:

```ts
import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('../analytics', () => ({ captureEvent: vi.fn() }));

import { captureEvent } from '../analytics';
import { captureCheckoutStarted } from '../checkout-analytics';

beforeEach(() => {
  vi.mocked(captureEvent).mockClear();
});

describe('captureCheckoutStarted', () => {
  it('emits checkout_started with the same source the request carries', () => {
    captureCheckoutStarted('pro', 'year', 'onboarding');
    expect(captureEvent).toHaveBeenCalledWith(
      'checkout_started',
      { plan_id: 'pro', billing_interval: 'year', source: 'onboarding' },
      { sendInstantly: true },
    );
  });

  it('carries the billing source too', () => {
    captureCheckoutStarted('start', 'month', 'billing');
    expect(captureEvent).toHaveBeenCalledWith(
      'checkout_started',
      { plan_id: 'start', billing_interval: 'month', source: 'billing' },
      { sendInstantly: true },
    );
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npx vitest run apps/crm/src/lib/__tests__/checkout-analytics.test.ts
```

Expected: FAIL — cannot resolve `../checkout-analytics`.

- [ ] **Step 3: Extend the event union**

In `apps/crm/src/lib/analytics.ts`, add three names to `AnalyticsEvent`, replacing the final `| 'checkout_started';`:

```ts
  | 'checkout_started'
  | 'trial_step_viewed'
  | 'trial_skipped'
  | 'trial_nudge_clicked';
```

- [ ] **Step 4: Add the shared emitter**

Create `apps/crm/src/lib/checkout-analytics.ts`:

```ts
import { captureEvent } from './analytics';
import type { BillingInterval, CheckoutSource } from '@/services/billing';

/**
 * The single emitter for checkout_started. Both the onboarding step and the
 * billing page go through here so the analytics funnel and the checkout
 * request can never disagree about what `source` means.
 */
export function captureCheckoutStarted(
  planId: string,
  interval: BillingInterval,
  source: CheckoutSource,
): void {
  captureEvent(
    'checkout_started',
    { plan_id: planId, billing_interval: interval, source },
    { sendInstantly: true },
  );
}
```

- [ ] **Step 5: Run the test to verify it passes**

```bash
npx vitest run apps/crm/src/lib/__tests__/checkout-analytics.test.ts
```

Expected: PASS.

- [ ] **Step 6: Typecheck and commit**

```bash
npx tsc -p apps/crm/tsconfig.json --noEmit
npm run format
git add apps/crm/src/lib/analytics.ts apps/crm/src/lib/checkout-analytics.ts apps/crm/src/lib/__tests__/checkout-analytics.test.ts
git commit -m "feat(analytics): trial events and a single checkout_started emitter"
```

---

### Task 6: The /comecar trial step

**Files:**
- Create: `apps/crm/src/pages/comecar/ComecarPage.tsx`, `apps/crm/src/pages/comecar/comecar.css`
- Test: `apps/crm/src/pages/comecar/__tests__/ComecarPage.test.tsx`
- Modify: `apps/crm/src/App.tsx`, `apps/crm/src/content/site-meta.ts`, `vercel.json`

**Interfaces:**
- Consumes: `parsePlanIntent` (Task 5), `isSelectableTrialPlan` (Task 4), `startCheckout` / `getWorkspaceSubscription` / `listActivePlans` (Task 3).
- Produces: the route `/comecar`, default-exported `ComecarPage`.

- [ ] **Step 1: Write the failing test**

Create `apps/crm/src/pages/comecar/__tests__/ComecarPage.test.tsx`:

```tsx
import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('@/context/AuthContext', () => ({ useAuth: vi.fn() }));
vi.mock('@/services/billing', () => ({
  listActivePlans: vi.fn(),
  getWorkspaceSubscription: vi.fn(),
  startCheckout: vi.fn(),
}));
vi.mock('@/lib/analytics', () => ({ captureEvent: vi.fn() }));

import { useAuth } from '@/context/AuthContext';
import { getWorkspaceSubscription, listActivePlans, startCheckout } from '@/services/billing';
import ComecarPage from '../ComecarPage';

const assign = vi.fn();

const PLANS = [
  { id: 'free', name: 'Free', price_brl: 0, price_brl_annual: 0, sort_order: 0,
    max_clients: 1, max_team_members: 1, storage_quota_bytes: null,
    feature_hub_portal: false, feature_analytics_reports: false,
    feature_brand_customization: false },
  { id: 'pro', name: 'Pro', price_brl: 9990, price_brl_annual: 95900, sort_order: 2,
    max_clients: 20, max_team_members: 3, storage_quota_bytes: null,
    feature_hub_portal: true, feature_analytics_reports: true,
    feature_brand_customization: true },
];

const NEVER_SUBSCRIBED = {
  status: null, plan_id: null, current_period_end: null, cancel_at_period_end: false,
  past_due_since: null, next_payment_attempt: null, hasEverSubscribed: false,
};

beforeEach(() => {
  assign.mockReset();
  vi.stubGlobal('location', { ...window.location, assign });
  vi.mocked(useAuth).mockReturnValue({ role: 'owner', loading: false } as never);
  vi.mocked(listActivePlans).mockResolvedValue(PLANS as never);
  vi.mocked(getWorkspaceSubscription).mockResolvedValue(NEVER_SUBSCRIBED as never);
  vi.mocked(startCheckout).mockResolvedValue('https://checkout.stripe.com/abc');
});

function renderPage(search = '') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[`/comecar${search}`]}>
        <Routes>
          <Route path="/comecar" element={<ComecarPage />} />
          <Route path="/dashboard" element={<div>Painel</div>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('ComecarPage', () => {
  it('redirects a non-owner to the dashboard', async () => {
    vi.mocked(useAuth).mockReturnValue({ role: 'agent', loading: false } as never);
    renderPage();
    expect(await screen.findByText('Painel')).toBeInTheDocument();
  });

  it('redirects a workspace that has subscribed before', async () => {
    vi.mocked(getWorkspaceSubscription).mockResolvedValue({
      ...NEVER_SUBSCRIBED,
      hasEverSubscribed: true,
    } as never);
    renderPage();
    expect(await screen.findByText('Painel')).toBeInTheDocument();
  });

  it('stays on the step after an abandoned checkout left a status-less row', async () => {
    renderPage();
    expect(await screen.findByText('Comece com 30 dias grátis')).toBeInTheDocument();
  });

  it('lists paid plans only, never Free', async () => {
    renderPage();
    expect(await screen.findByText('Pro')).toBeInTheDocument();
    expect(screen.queryByText('Free')).not.toBeInTheDocument();
  });

  it('starts checkout exactly once when the url carries an intent', async () => {
    renderPage('?plan=pro&interval=year');
    await waitFor(() => expect(assign).toHaveBeenCalledWith('https://checkout.stripe.com/abc'));
    expect(startCheckout).toHaveBeenCalledTimes(1);
    expect(startCheckout).toHaveBeenCalledWith('pro', 'year', 'onboarding');
  });

  it('falls back to the plan list when the intent checkout fails', async () => {
    vi.mocked(startCheckout).mockRejectedValue(new Error('Stripe indisponível'));
    renderPage('?plan=pro&interval=month');
    expect(await screen.findByText('Comece com 30 dias grátis')).toBeInTheDocument();
    expect(assign).not.toHaveBeenCalled();
  });

  it('ignores an intent naming a plan nobody can self-serve', async () => {
    renderPage('?plan=lifetime');
    expect(await screen.findByText('Comece com 30 dias grátis')).toBeInTheDocument();
    expect(startCheckout).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npx vitest run apps/crm/src/pages/comecar/__tests__/ComecarPage.test.tsx
```

Expected: FAIL — cannot resolve `../ComecarPage`.

- [ ] **Step 3: Write the page**

Create `apps/crm/src/pages/comecar/ComecarPage.tsx`:

```tsx
import { useEffect, useRef, useState } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Check, Loader2 } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import {
  getWorkspaceSubscription,
  listActivePlans,
  startCheckout,
  type BillingInterval,
  type BillingPlan,
} from '@/services/billing';
import { isSelectableTrialPlan } from '@/pages/configuracao/cobranca/plan-display';
import { captureEvent } from '@/lib/analytics';
import { captureCheckoutStarted } from '@/lib/checkout-analytics';
import { parsePlanIntent } from './plan-intent';
import './comecar.css';

const RECOMMENDED_ID = 'pro';

/** plans.price_brl is stored in centavos (e.g. 9990 = R$ 99,90). */
function formatBRL(centavos: number): string {
  return (centavos / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function planHighlights(p: BillingPlan): string[] {
  const out: string[] = [];
  out.push(p.max_clients == null ? 'Clientes ilimitados' : `${p.max_clients} clientes`);
  out.push(
    p.max_team_members == null ? 'Usuários ilimitados' : `${p.max_team_members} usuários`,
  );
  if (p.feature_hub_portal) out.push('Portal de aprovação do cliente');
  return out;
}

export default function ComecarPage() {
  const { role, loading: authLoading } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [interval, setInterval] = useState<BillingInterval>('month');
  const [busy, setBusy] = useState<string | null>(null);
  const [intent, setIntent] = useState(() => parsePlanIntent(location.search));
  // Latches so the auto-checkout and the view event fire once per mount. React's
  // double-invoke in development would otherwise open two Stripe sessions.
  const autoStarted = useRef(false);
  const viewLogged = useRef(false);

  const isOwner = role === 'owner';

  const { data: subscription, isLoading: subLoading } = useQuery({
    queryKey: ['billing', 'subscription'],
    queryFn: getWorkspaceSubscription,
    enabled: isOwner,
  });
  const { data: plans, isLoading: plansLoading } = useQuery({
    queryKey: ['billing', 'plans'],
    queryFn: listActivePlans,
    enabled: isOwner,
  });

  // Hooks cannot sit behind the early returns below, so the effects re-check
  // readiness themselves. `ready` is what keeps them from firing against
  // undefined data mid-load.
  const ready = !authLoading && isOwner && !subLoading && !plansLoading;
  const eligible = ready && subscription?.hasEverSubscribed !== true;

  useEffect(() => {
    if (!eligible || viewLogged.current) return;
    viewLogged.current = true;
    captureEvent('trial_step_viewed', { has_intent: Boolean(intent) });
  }, [eligible, intent]);

  useEffect(() => {
    if (!eligible || !intent || autoStarted.current) return;
    autoStarted.current = true;
    void (async () => {
      try {
        const url = await startCheckout(intent.planId, intent.interval, 'onboarding');
        captureCheckoutStarted(intent.planId, intent.interval, 'onboarding');
        window.location.assign(url);
      } catch (err) {
        toast.error('Não foi possível abrir o checkout: ' + (err as Error).message);
        setIntent(null);
      }
    })();
  }, [eligible, intent]);

  if (authLoading || (isOwner && (subLoading || plansLoading))) {
    return (
      <div className="comecar-shell comecar-shell--center">
        <Loader2 className="comecar-spin" size={24} aria-hidden="true" />
      </div>
    );
  }
  if (!isOwner) return <Navigate to="/dashboard" replace />;
  if (subscription?.hasEverSubscribed) return <Navigate to="/dashboard" replace />;

  const intentPlan = intent ? plans?.find((p) => p.id === intent.planId) : undefined;
  if (intent) {
    return (
      <div className="comecar-shell comecar-shell--center">
        <div className="comecar-standby">
          <Loader2 className="comecar-spin" size={24} aria-hidden="true" />
          <h1>Preparando seu teste do plano {intentPlan?.name ?? intent.planId}</h1>
          <p>
            Levamos você ao pagamento seguro do Stripe. Nada é cobrado nos próximos 30 dias.
          </p>
          <button type="button" className="comecar-link" onClick={() => setIntent(null)}>
            Escolher outro plano
          </button>
        </div>
      </div>
    );
  }

  const selectable = (plans ?? []).filter(isSelectableTrialPlan);

  async function handleStart(planId: string) {
    setBusy(planId);
    try {
      const url = await startCheckout(planId, interval, 'onboarding');
      captureCheckoutStarted(planId, interval, 'onboarding');
      window.location.assign(url);
    } catch (err) {
      toast.error('Não foi possível abrir o checkout: ' + (err as Error).message);
      setBusy(null);
    }
  }

  function handleSkip() {
    captureEvent('trial_skipped');
    navigate('/dashboard', { replace: true });
  }

  return (
    <div className="comecar-shell">
      <div className="comecar-inner">
        <header className="comecar-head">
          <h1>Comece com 30 dias grátis</h1>
          <p>
            Escolha o plano do seu teste. Você só é cobrado depois de 30 dias e pode cancelar
            quando quiser.
          </p>
        </header>

        <div className="comecar-toggle" role="group" aria-label="Período de cobrança">
          <button aria-pressed={interval === 'month'} onClick={() => setInterval('month')}>
            Mensal
          </button>
          <button aria-pressed={interval === 'year'} onClick={() => setInterval('year')}>
            Anual
          </button>
        </div>

        <div className="comecar-grid">
          {selectable.map((p) => {
            const isYear = interval === 'year';
            const monthly =
              isYear && p.price_brl_annual != null ? p.price_brl_annual / 12 : p.price_brl;
            return (
              <div
                key={p.id}
                className={`comecar-card${p.id === RECOMMENDED_ID ? ' is-recommended' : ''}`}
              >
                <div className="comecar-card__top">
                  <span className="comecar-card__name">{p.name}</span>
                  {p.id === RECOMMENDED_ID && <span className="comecar-tag">Recomendado</span>}
                </div>
                <p className="comecar-card__trial">30 dias grátis</p>
                <p className="comecar-card__price">
                  depois {monthly != null ? formatBRL(monthly) : '—'}/mês
                </p>
                <ul className="comecar-card__features">
                  {planHighlights(p).map((f) => (
                    <li key={f}>
                      <Check size={14} aria-hidden="true" />
                      {f}
                    </li>
                  ))}
                </ul>
                <button
                  type="button"
                  className="comecar-cta"
                  onClick={() => handleStart(p.id)}
                  disabled={busy === p.id}
                >
                  {busy === p.id ? 'Aguarde…' : 'Começar teste'}
                </button>
              </div>
            );
          })}
        </div>

        <footer className="comecar-foot">
          <p>Pedimos o cartão agora, mas nada é cobrado nos primeiros 30 dias.</p>
          <button type="button" className="comecar-link" onClick={handleSkip}>
            Prefiro continuar no plano Free por enquanto
          </button>
        </footer>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Write the stylesheet**

Create `apps/crm/src/pages/comecar/comecar.css`:

```css
.comecar-shell {
  min-height: 100vh;
  background: var(--bg-color);
  padding: 3rem 1rem;
}
.comecar-shell--center {
  display: flex;
  align-items: center;
  justify-content: center;
}
.comecar-inner {
  max-width: 60rem;
  margin: 0 auto;
}
.comecar-spin {
  animation: comecar-rotate 1s linear infinite;
  color: var(--text-muted);
}
@keyframes comecar-rotate {
  to {
    transform: rotate(360deg);
  }
}
.comecar-standby {
  max-width: 24rem;
  text-align: center;
}
.comecar-standby h1 {
  font-size: 1.1rem;
  margin: 0.75rem 0 0.35rem;
  color: var(--text-main);
}
.comecar-standby p {
  font-size: 0.88rem;
  color: var(--text-muted);
  margin: 0 0 1rem;
}
.comecar-head {
  text-align: center;
  margin-bottom: 1.75rem;
}
.comecar-head h1 {
  font-family: var(--font-heading);
  font-size: 1.6rem;
  margin: 0 0 0.5rem;
  color: var(--text-main);
}
.comecar-head p {
  color: var(--text-muted);
  font-size: 0.95rem;
  max-width: 34rem;
  margin: 0 auto;
}
.comecar-toggle {
  display: flex;
  justify-content: center;
  gap: 0.25rem;
  margin-bottom: 1.75rem;
}
.comecar-toggle button {
  border: 1px solid var(--border-color);
  background: var(--surface-main);
  color: var(--text-muted);
  padding: 0.4rem 1.1rem;
  border-radius: 999px;
  font-size: 0.85rem;
  cursor: pointer;
}
.comecar-toggle button[aria-pressed='true'] {
  background: var(--primary-color);
  border-color: var(--primary-color);
  color: var(--dark);
  font-weight: 600;
}
.comecar-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(15rem, 1fr));
  gap: 1rem;
  margin-bottom: 1.75rem;
}
.comecar-card {
  background: var(--card-bg);
  border: 1px solid var(--border-color);
  border-radius: var(--radius);
  padding: 1.25rem;
  display: flex;
  flex-direction: column;
}
.comecar-card.is-recommended {
  border-color: var(--primary-color);
}
.comecar-card__top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 0.75rem;
}
.comecar-card__name {
  font-weight: 600;
  color: var(--text-main);
}
.comecar-tag {
  background: var(--primary-color);
  color: var(--dark);
  font-size: 0.68rem;
  font-weight: 600;
  padding: 0.15rem 0.5rem;
  border-radius: 999px;
}
.comecar-card__trial {
  color: var(--success);
  font-weight: 600;
  font-size: 0.9rem;
  margin: 0 0 0.15rem;
}
.comecar-card__price {
  color: var(--text-muted);
  font-size: 0.85rem;
  margin: 0 0 1rem;
}
.comecar-card__features {
  list-style: none;
  padding: 0;
  margin: 0 0 1.25rem;
  display: grid;
  gap: 0.4rem;
}
.comecar-card__features li {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  font-size: 0.83rem;
  color: var(--text-muted);
}
.comecar-cta {
  margin-top: auto;
  width: 100%;
  padding: 0.6rem;
  border-radius: var(--radius);
  border: 1px solid var(--primary-color);
  background: var(--primary-color);
  color: var(--dark);
  font-weight: 600;
  font-size: 0.88rem;
  cursor: pointer;
}
.comecar-cta:disabled {
  opacity: 0.6;
  cursor: default;
}
.comecar-foot {
  text-align: center;
  border-top: 1px solid var(--border-color);
  padding-top: 1rem;
}
.comecar-foot p {
  color: var(--text-muted);
  font-size: 0.83rem;
  margin: 0 0 0.4rem;
}
.comecar-link {
  background: none;
  border: none;
  padding: 0;
  color: var(--text-light);
  font-size: 0.83rem;
  text-decoration: underline;
  cursor: pointer;
}
```

- [ ] **Step 5: Run the tests to verify they pass**

```bash
npx vitest run apps/crm/src/pages/comecar/__tests__/ComecarPage.test.tsx
```

Expected: PASS, all 7 tests.

- [ ] **Step 6: Register the route in App.tsx**

Add the lazy import beside the other page imports:

```tsx
const ComecarPage = lazy(() => import('./pages/comecar/ComecarPage'));
```

And add the route immediately after the `/workspace-setup` route block:

```tsx
              <Route
                path="/comecar"
                element={
                  <ProtectedRoute>
                    <ComecarPage />
                  </ProtectedRoute>
                }
              />
```

- [ ] **Step 7: Register the prefix and the production routing**

In `apps/crm/src/content/site-meta.ts`, add `'comecar',` to `APP_ROUTE_PREFIXES` (put it next to `'workspace-setup'`).

In `vercel.json`, add `comecar` to the alternation in **both** places — the X-Robots-Tag header source (line 38) and the app-shell rewrite source (line 70). Both strings must end up identical:

```
"/(login|configurar-senha|workspace-setup|comecar|oauth|dashboard|clientes|financeiro|contratos|leads|equipe|configuracao|calendario|entregas|tarefas|post-express|arquivos|analytics-fluxos|analytics|ideias|mensagens|ajuda|importar)(/.*)?"
```

- [ ] **Step 8: Verify the routing contract test passes**

```bash
npx vitest run apps/crm/src/content/__tests__/vercel-routing.test.ts
```

Expected: PASS. If it fails on `prefix comecar missing from app-shell rewrite`, you edited only one of the two `vercel.json` strings.

- [ ] **Step 9: Typecheck and commit**

```bash
npx tsc -p apps/crm/tsconfig.json --noEmit
npm run format
git add apps/crm/src/pages/comecar apps/crm/src/App.tsx apps/crm/src/content/site-meta.ts vercel.json
git commit -m "feat(onboarding): add the /comecar trial step and register its route"
```

---

### Task 7: Landing copy and plan intent

**Files:**
- Modify: `apps/crm/src/pages/landing/PricingSection.tsx`, `apps/crm/src/pages/landing/LandingPage.tsx`
- Test: `apps/crm/src/pages/landing/__tests__/LandingPage.test.tsx`

**Interfaces:**
- Consumes: `buildPlanIntentQuery` (Task 5).
- Produces: paid-plan hrefs of the form `/login?tab=register&plan=<id>&interval=<month|year>`.

- [ ] **Step 1: Update the failing banner test**

In `apps/crm/src/pages/landing/__tests__/LandingPage.test.tsx`, replace the `BEMVINDO` assertion (line 192) with:

```ts
    expect(banner).toHaveTextContent('30 dias');
    expect(banner).not.toHaveTextContent('BEMVINDO');
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npx vitest run apps/crm/src/pages/landing/__tests__/LandingPage.test.tsx
```

Expected: FAIL — the banner still says `BEMVINDO`.

- [ ] **Step 3: Rewrite the promo banner**

In `apps/crm/src/pages/landing/LandingPage.tsx`, replace the `<span className="promo-banner-text">…</span>` and the CTA label inside `PromoBanner`:

```tsx
      <span className="promo-banner-text">
        <strong>30 dias grátis</strong> em qualquer plano pago. Sem código, cancele quando
        quiser.
      </span>
      <a href="/login?tab=register" className="promo-banner-cta">
        Começar teste grátis
      </a>
```

Remove the now-unused `PROMO_CODE` import from this file.

- [ ] **Step 4: Update the hero and closing CTA copy**

In the same file, change the three logged-out CTA labels (near lines 144, 247 and 337) from `Criar conta grátis` / `Começar agora` to:

```tsx
                  Começar teste grátis
```

Leave the two logged-in `/dashboard` CTAs untouched.

- [ ] **Step 5: Carry plan intent from the pricing cards**

In `apps/crm/src/pages/landing/PricingSection.tsx`, delete the `export const PROMO_CODE = 'BEMVINDO';` line and its comment, add the import:

```ts
import { buildPlanIntentQuery } from '@/pages/comecar/plan-intent';
```

Replace `planHref` so it closes over the selected period:

```tsx
  // Visitors must sign up before checkout. Paid plans carry the choice through
  // signup so the trial starts without another plan decision.
  const planHref = (id: string) => {
    if (id === 'free') return user ? '/dashboard' : '/login?tab=register';
    if (user) return '/configuracao/cobranca';
    return `/login?tab=register&${buildPlanIntentQuery(id, period)}`;
  };
```

Replace the `pricing-promo-note` block with:

```tsx
          <div className="pricing-promo-note">
            30 dias grátis em qualquer plano pago. Sem código, cancele quando quiser.
          </div>
```

Add the trial line to each paid plan card, immediately above `<div className="plan-tag">`:

```tsx
                  {!isFree && <div className="plan-trial-note">30 dias grátis para começar</div>}
```

Change the paid entries in `PLAN_MARKETING` so every `cta` reads `'Começar teste grátis'`, leaving `free` as `'Começar grátis'`.

- [ ] **Step 6: Add the style for the new line**

Append to `apps/crm/src/pages/landing/landing.css`:

```css
.plan-trial-note {
  color: var(--success);
  font-weight: 600;
  font-size: 0.82rem;
  margin-bottom: 0.35rem;
}
```

- [ ] **Step 7: Run the landing tests**

```bash
npx vitest run apps/crm/src/pages/landing
```

Expected: PASS.

- [ ] **Step 8: Typecheck and commit**

```bash
npx tsc -p apps/crm/tsconfig.json --noEmit
npm run format
git add apps/crm/src/pages/landing
git commit -m "feat(landing): trial-first copy and plan intent on the pricing CTAs"
```

---

### Task 8: Signup lands in the app, carrying intent

**Files:**
- Modify: `apps/crm/src/lib/supabase.ts`, `apps/crm/src/pages/login/LoginPage.tsx`
- Test: `apps/crm/src/pages/login/__tests__/LoginPage.test.tsx`

**Interfaces:**
- Consumes: `parsePlanIntent`, `buildPlanIntentQuery` (Task 5).
- Produces: `signUp(email, password, meta?, redirectPath?)`; after signup with a session, navigation to `/comecar` preserving intent.

- [ ] **Step 1: Write the failing tests**

`apps/crm/src/pages/login/__tests__/LoginPage.test.tsx` already mocks `sonner` and `../../../lib/supabase`, and already imports `fireEvent`, `render`, `screen`, `waitFor`, `MemoryRouter`, `Route`, `Routes` and `useLocation`. Reuse all of that. It exposes `mockedSignUp`; its own `renderLoginPage` has no `/comecar` route and its `PathProbe` prints only `pathname`, so these tests need their own local helpers.

Add these helpers below the existing `renderLoginPage` definition. Selectors go through element `id`s rather than label text, because the form labels come from i18n and would make the tests translation-dependent:

```tsx
function SearchProbe() {
  const location = useLocation();
  return <div data-testid="probe">{location.pathname + location.search}</div>;
}

function renderRegister(initialEntry: string) {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <Routes>
        <Route
          path="/login"
          element={
            <>
              <LoginPage />
              <SearchProbe />
            </>
          }
        />
        <Route path="/comecar" element={<SearchProbe />} />
        <Route path="/dashboard" element={<SearchProbe />} />
      </Routes>
    </MemoryRouter>,
  );
}

function fillRegisterForm(
  container: HTMLElement,
  overrides: { nome?: string; empresa?: string } = {},
) {
  const set = (id: string, value: string) =>
    fireEvent.change(container.querySelector(`#${id}`)!, { target: { value } });
  set('reg-nome', overrides.nome ?? 'Ana Souza');
  set('reg-empresa', overrides.empresa ?? 'Studio Ana');
  set('reg-email', 'ana@example.com');
  set('reg-telefone', '11999999999');
  set('reg-password', 'senha12345');
  set('reg-confirm', 'senha12345');
}

// jsdom does not run HTML constraint validation on a programmatic submit, so
// this reaches the handler and exercises the trim guard rather than being
// blocked by `required`.
function submitRegister(container: HTMLElement) {
  fireEvent.submit(container.querySelector('form.auth-form')!);
}
```

Then append these tests inside the existing `describe('LoginPage', …)` block:

```tsx
  it('rejects a whitespace-only company name instead of submitting it', () => {
    const { container } = renderRegister('/login?tab=register');
    fillRegisterForm(container, { empresa: '   ' });
    submitRegister(container);
    expect(mockedSignUp).not.toHaveBeenCalled();
  });

  it('trims the name and company before sending them to signUp', async () => {
    mockedSignUp.mockResolvedValue({
      data: { session: { access_token: 't' } },
      error: null,
    } as never);
    const { container } = renderRegister('/login?tab=register');
    fillRegisterForm(container, { nome: '  Ana  ', empresa: '  Studio  ' });
    submitRegister(container);
    await waitFor(() => expect(mockedSignUp).toHaveBeenCalled());
    expect(mockedSignUp.mock.calls[0][2]).toMatchObject({ nome: 'Ana', empresa: 'Studio' });
  });

  it('sends a signed-up user to /comecar carrying the plan intent', async () => {
    mockedSignUp.mockResolvedValue({
      data: { session: { access_token: 't' } },
      error: null,
    } as never);
    const { container } = renderRegister('/login?tab=register&plan=pro&interval=year');
    fillRegisterForm(container);
    submitRegister(container);
    await waitFor(() =>
      expect(screen.getByTestId('probe')).toHaveTextContent('/comecar?plan=pro&interval=year'),
    );
  });

  it('passes the intent through emailRedirectTo when confirmation is still on', async () => {
    mockedSignUp.mockResolvedValue({ data: { session: null }, error: null } as never);
    const { container } = renderRegister('/login?tab=register&plan=pro&interval=month');
    fillRegisterForm(container);
    submitRegister(container);
    await waitFor(() => expect(mockedSignUp).toHaveBeenCalled());
    expect(mockedSignUp.mock.calls[0][3]).toBe('/login?plan=pro&interval=month');
  });
```

Existing register-tab tests in this file assert on `signUp` being called with three arguments and on the check-your-email screen. They keep passing: the fourth argument is additive, and a `null` session still routes to that screen. If any of them stubs `signUp` with a bare `{ error: null }`, add `data: { session: null }` so the new destructuring in `handleRegister` does not read from `undefined`.

- [ ] **Step 2: Run the tests to verify they fail**

```bash
npx vitest run apps/crm/src/pages/login/__tests__/LoginPage.test.tsx
```

Expected: FAIL — `signUp` receives untrimmed values and only three arguments.

- [ ] **Step 3: Let signUp take a redirect path**

In `apps/crm/src/lib/supabase.ts`, replace `signUp`:

```ts
export async function signUp(
  email: string,
  password: string,
  meta?: { nome?: string; empresa?: string; telefone?: string; marketing_opt_in?: boolean },
  redirectPath = '/login',
) {
  return supabase.auth.signUp({
    email,
    password,
    // Carries the plan intent across the confirmation email when email
    // confirmation is enabled; without it the user's plan choice is silently
    // dropped between signup and their return.
    options: { data: meta, emailRedirectTo: window.location.origin + redirectPath },
  });
}
```

- [ ] **Step 4: Trim, require, and route in LoginPage**

In `apps/crm/src/pages/login/LoginPage.tsx`, add the imports:

```tsx
import { parsePlanIntent, buildPlanIntentQuery } from '@/pages/comecar/plan-intent';
```

Add near the other `location.search` reads:

```tsx
  const planIntent = parsePlanIntent(location.search);
  const intentQuery = planIntent
    ? buildPlanIntentQuery(planIntent.planId, planIntent.interval)
    : '';
```

Replace `handleRegister`:

```tsx
  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    if (regPassword !== regConfirm) {
      toast.error(t('register.passwordMismatch'));
      return;
    }
    // HTML `required` accepts whitespace, and the workspace name comes straight
    // from this value — a blank-looking company would create a blank-named
    // workspace AND skip /workspace-setup, because ' ' is truthy.
    const nome = regNome.trim();
    const empresa = regEmpresa.trim();
    if (!nome || !empresa) {
      toast.error('Preencha seu nome e o nome da empresa.');
      return;
    }
    setLoading(true);
    const { data, error } = await signUp(
      regEmail,
      regPassword,
      { nome, empresa, telefone: regTelefone, marketing_opt_in: regMarketingOptIn },
      intentQuery ? `/login?${intentQuery}` : '/login',
    );
    setLoading(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    captureEvent('signup_completed');
    // With email confirmation disabled signUp returns a live session, so the
    // user goes straight to the trial step. When it is enabled there is no
    // session yet and the check-your-email screen still applies.
    if (data?.session) {
      navigate(intentQuery ? `/comecar?${intentQuery}` : '/comecar', { replace: true });
      return;
    }
    setRegisterSuccess(true);
    setRegNome('');
    setRegEmpresa('');
    setRegEmail('');
    setRegTelefone('');
    setRegPassword('');
    setRegConfirm('');
    setRegMarketingOptIn(false);
  };
```

Make the company input required (`apps/crm/src/pages/login/LoginPage.tsx`, the `reg-empresa` `<Input>`):

```tsx
                    onChange={(e) => setRegEmpresa(e.target.value)}
                    required
```

Finally, forward the intent after a successful login so a confirmation-email return lands on the trial step. In `handleLogin`, replace `navigate(from, { replace: true })` with:

```tsx
      navigate(intentQuery ? `/comecar?${intentQuery}` : from, { replace: true });
```

- [ ] **Step 5: Run the tests to verify they pass**

```bash
npx vitest run apps/crm/src/pages/login/__tests__/LoginPage.test.tsx
```

Expected: PASS.

- [ ] **Step 6: Typecheck and commit**

```bash
npx tsc -p apps/crm/tsconfig.json --noEmit
npm run format
git add apps/crm/src/lib/supabase.ts apps/crm/src/pages/login
git commit -m "feat(auth): land signups in the app and carry plan intent through confirmation"
```

---

### Task 9: Workspace setup hands off to the trial step

**Files:**
- Modify: `apps/crm/src/pages/workspace-setup/WorkspaceSetupPage.tsx`

**Interfaces:**
- Consumes: the `/comecar` route (Task 6), which self-guards ineligible visitors onward.
- Produces: nothing new.

- [ ] **Step 1: Change the post-save destination**

At `apps/crm/src/pages/workspace-setup/WorkspaceSetupPage.tsx:53`, replace:

```tsx
      setTimeout(() => navigate('/dashboard'), 2800);
```

with:

```tsx
      // /comecar self-guards: a workspace that already subscribed, or a
      // non-owner, is bounced straight to the dashboard from there.
      setTimeout(() => navigate('/comecar'), 2800);
```

- [ ] **Step 2: Verify the existing suite still passes**

```bash
npx vitest run apps/crm/src/pages/workspace-setup
```

Expected: PASS (or "no test files found", which is fine — this page has no test today).

- [ ] **Step 3: Commit**

```bash
npm run format
git add apps/crm/src/pages/workspace-setup/WorkspaceSetupPage.tsx
git commit -m "feat(onboarding): send workspace setup to the trial step"
```

---

### Task 10: Dashboard nudge and checkout return

**Files:**
- Create: `apps/crm/src/components/billing/TrialNudgeCard.tsx`
- Test: `apps/crm/src/components/billing/__tests__/TrialNudgeCard.test.tsx`
- Modify: `apps/crm/src/pages/dashboard/DashboardPage.tsx`

**Interfaces:**
- Consumes: `getWorkspaceSubscription`, `getEffectivePlanId` (Task 3).
- Produces: `<TrialNudgeCard />`, self-gating; dashboard handling of `?trial=started|skipped`.

- [ ] **Step 1: Write the failing test**

Create `apps/crm/src/components/billing/__tests__/TrialNudgeCard.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('@/context/AuthContext', () => ({ useAuth: vi.fn() }));
vi.mock('@/services/billing', () => ({
  getWorkspaceSubscription: vi.fn(),
  getEffectivePlanId: vi.fn(),
}));
vi.mock('@/lib/analytics', () => ({ captureEvent: vi.fn() }));

import { useAuth } from '@/context/AuthContext';
import { getEffectivePlanId, getWorkspaceSubscription } from '@/services/billing';
import { TrialNudgeCard } from '../TrialNudgeCard';

const NEVER_SUBSCRIBED = { hasEverSubscribed: false } as never;

beforeEach(() => {
  localStorage.clear();
  vi.mocked(useAuth).mockReturnValue({ role: 'owner', profile: { conta_id: 'ws-1' } } as never);
  vi.mocked(getEffectivePlanId).mockResolvedValue('free');
  vi.mocked(getWorkspaceSubscription).mockResolvedValue(NEVER_SUBSCRIBED);
});

function renderCard() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <TrialNudgeCard />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const TITLE = /30 dias grátis ainda estão disponíveis/i;

describe('TrialNudgeCard', () => {
  it('shows for a never-subscribed Free owner', async () => {
    renderCard();
    expect(await screen.findByText(TITLE)).toBeInTheDocument();
  });

  it('hides for a non-owner', async () => {
    vi.mocked(useAuth).mockReturnValue({ role: 'agent', profile: { conta_id: 'ws-1' } } as never);
    renderCard();
    expect(screen.queryByText(TITLE)).not.toBeInTheDocument();
  });

  it('hides on a paid plan', async () => {
    vi.mocked(getEffectivePlanId).mockResolvedValue('pro');
    renderCard();
    await new Promise((r) => setTimeout(r, 0));
    expect(screen.queryByText(TITLE)).not.toBeInTheDocument();
  });

  it('hides for a workspace that subscribed before', async () => {
    vi.mocked(getWorkspaceSubscription).mockResolvedValue({ hasEverSubscribed: true } as never);
    renderCard();
    await new Promise((r) => setTimeout(r, 0));
    expect(screen.queryByText(TITLE)).not.toBeInTheDocument();
  });

  it('stays hidden within seven days of a dismissal', async () => {
    const twoDaysAgo = new Date(Date.now() - 2 * 86_400_000).toISOString();
    localStorage.setItem('trial_nudge_dismissed_ws-1', twoDaysAgo);
    renderCard();
    await new Promise((r) => setTimeout(r, 0));
    expect(screen.queryByText(TITLE)).not.toBeInTheDocument();
  });

  it('resurfaces more than seven days after a dismissal', async () => {
    const longAgo = new Date(Date.now() - 8 * 86_400_000).toISOString();
    localStorage.setItem('trial_nudge_dismissed_ws-1', longAgo);
    renderCard();
    expect(await screen.findByText(TITLE)).toBeInTheDocument();
  });

  it('shows when the stored dismissal value is unparseable', async () => {
    localStorage.setItem('trial_nudge_dismissed_ws-1', 'not-a-date');
    renderCard();
    expect(await screen.findByText(TITLE)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npx vitest run apps/crm/src/components/billing/__tests__/TrialNudgeCard.test.tsx
```

Expected: FAIL — cannot resolve `../TrialNudgeCard`.

- [ ] **Step 3: Implement the card**

Create `apps/crm/src/components/billing/TrialNudgeCard.tsx`:

```tsx
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Timer, X } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { getEffectivePlanId, getWorkspaceSubscription } from '@/services/billing';
import { captureEvent } from '@/lib/analytics';

const DISMISS_DAYS = 7;

/**
 * True when the stored dismissal is still inside its window. A missing or
 * unparseable value counts as "never dismissed" — a corrupt entry should fail
 * toward showing the card, not toward hiding it forever.
 */
function isDismissalActive(raw: string | null): boolean {
  if (!raw) return false;
  const at = new Date(raw).getTime();
  if (Number.isNaN(at)) return false;
  return Date.now() - at < DISMISS_DAYS * 86_400_000;
}

export function TrialNudgeCard() {
  const { role, profile } = useAuth();
  const isOwner = role === 'owner';
  const storageKey = `trial_nudge_dismissed_${profile?.conta_id ?? 'unknown'}`;

  const [dismissed, setDismissed] = useState(() =>
    isDismissalActive(localStorage.getItem(storageKey)),
  );

  const { data: planId } = useQuery({
    queryKey: ['billing', 'effective-plan'],
    queryFn: getEffectivePlanId,
    enabled: isOwner && !dismissed,
  });
  const { data: subscription } = useQuery({
    queryKey: ['billing', 'subscription'],
    queryFn: getWorkspaceSubscription,
    enabled: isOwner && !dismissed,
  });

  if (!isOwner || dismissed) return null;
  // Wait for both answers before deciding: rendering on partial data would flash
  // the card at a paying customer.
  if (planId === undefined || subscription === undefined) return null;
  if (planId !== 'free') return null;
  if (subscription?.hasEverSubscribed) return null;

  function handleDismiss() {
    localStorage.setItem(storageKey, new Date().toISOString());
    setDismissed(true);
  }

  return (
    <div className="card trial-nudge">
      <Timer size={22} aria-hidden="true" className="trial-nudge__icon" />
      <div className="trial-nudge__body">
        <p className="trial-nudge__title">Seus 30 dias grátis ainda estão disponíveis</p>
        <p className="trial-nudge__text">
          Você está no plano Free. Ative o teste para liberar relatórios, portal do cliente e
          agendamento.
        </p>
      </div>
      <Link
        to="/comecar"
        className="btn-primary trial-nudge__cta"
        onClick={() => captureEvent('trial_nudge_clicked')}
      >
        Ativar teste
      </Link>
      <button type="button" onClick={handleDismiss} aria-label="Fechar aviso" className="trial-nudge__close">
        <X size={16} />
      </button>
    </div>
  );
}
```

- [ ] **Step 4: Style it**

Append to `apps/crm/style.css`:

```css
.trial-nudge {
  display: flex;
  align-items: center;
  gap: 0.9rem;
  margin-bottom: 1.5rem;
  border: 1px solid var(--primary-color);
}
.trial-nudge__icon {
  color: var(--primary-hover);
  flex-shrink: 0;
}
.trial-nudge__body {
  flex: 1;
}
.trial-nudge__title {
  font-weight: 600;
  color: var(--text-main);
  margin: 0 0 0.15rem;
}
.trial-nudge__text {
  color: var(--text-muted);
  font-size: 0.85rem;
  margin: 0;
}
.trial-nudge__cta {
  white-space: nowrap;
  text-decoration: none;
}
.trial-nudge__close {
  background: none;
  border: none;
  color: var(--text-light);
  cursor: pointer;
  padding: 0;
}
```

- [ ] **Step 5: Run the tests to verify they pass**

```bash
npx vitest run apps/crm/src/components/billing/__tests__/TrialNudgeCard.test.tsx
```

Expected: PASS, all 7 tests.

- [ ] **Step 6: Mount it and handle the checkout return**

In `apps/crm/src/pages/dashboard/DashboardPage.tsx`, add the imports:

```tsx
import { useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { TrialNudgeCard } from '../../components/billing/TrialNudgeCard';
```

Add inside `DashboardPage`, next to the other hooks:

```tsx
  const [searchParams, setSearchParams] = useSearchParams();
  const queryClient = useQueryClient();

  // Stripe returns here after an onboarding checkout. The plan lands via webhook,
  // so re-read a few times rather than trusting the first response — same
  // treatment CobrancaPage gives its own return.
  useEffect(() => {
    const trial = searchParams.get('trial');
    if (!trial) return;
    if (trial === 'started') {
      toast.success('Teste de 30 dias ativado! Atualizando seu plano…');
      let tries = 0;
      const id = window.setInterval(() => {
        tries += 1;
        queryClient.invalidateQueries({ queryKey: ['billing'] });
        queryClient.invalidateQueries({ queryKey: ['workspaceLimits'] });
        if (tries >= 5) window.clearInterval(id);
      }, 2000);
      setSearchParams({}, { replace: true });
      return () => window.clearInterval(id);
    }
    setSearchParams({}, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
```

Render the card above `OnboardingBanner` inside the existing `!isAgent` area:

```tsx
      {!isAgent && <TrialNudgeCard />}
      {!isAgent && (
        <OnboardingBanner
```

- [ ] **Step 7: Run the dashboard tests, typecheck and commit**

```bash
npx vitest run apps/crm/src/pages/dashboard
npx tsc -p apps/crm/tsconfig.json --noEmit
```

Expected: PASS, no type errors.

```bash
npm run format
git add apps/crm/src/components/billing apps/crm/src/pages/dashboard/DashboardPage.tsx apps/crm/style.css
git commit -m "feat(onboarding): trial nudge card and checkout return handling on the dashboard"
```

---

### Task 11: Clean up the billing page

**Files:**
- Modify: `apps/crm/src/pages/configuracao/cobranca/CobrancaPage.tsx`, `apps/crm/src/pages/configuracao/cobranca/cobranca.css`

**Interfaces:**
- Consumes: `hasEverSubscribed` (Task 3).
- Produces: nothing new.

- [ ] **Step 1: Remove the promo input**

In `CobrancaPage.tsx`, delete the `const [promo, setPromo] = useState('');` line and the whole `<div className="billing-promo">…</div>` block (lines 226–237). Replace that block with a first-time hint:

```tsx
        {!subscription?.hasEverSubscribed && (
          <span className="billing-save-hint">
            <i className="ph ph-tag" aria-hidden="true" />
            Seus primeiros 30 dias são grátis
          </span>
        )}
```

- [ ] **Step 2: Retitle the CTA for first-time subscribers**

Replace the upgrade branch inside `renderCta`:

```tsx
    if (canUpgradeTo(p.id, currentPlanId, hasActiveSub)) {
      const firstTime = !subscription?.hasEverSubscribed;
      return (
        <button
          className="btn-primary"
          onClick={() => handleUpgrade(p.id)}
          disabled={busy === p.id}
        >
          {busy === p.id
            ? 'Aguarde…'
            : firstTime
              ? 'Começar teste de 30 dias'
              : 'Fazer upgrade'}
        </button>
      );
    }
```

- [ ] **Step 3: Route the checkout event through the shared emitter**

Replace the inline `captureEvent('checkout_started', …)` call in `handleUpgrade` (`CobrancaPage.tsx:136`) with:

```ts
      captureCheckoutStarted(planId, interval, 'billing');
```

Swap the import at the top of the file from `import { captureEvent } from '@/lib/analytics';` to:

```ts
import { captureCheckoutStarted } from '@/lib/checkout-analytics';
```

If `captureEvent` is not used anywhere else in this file, removing its import is required — an unused import fails `npm run lint`.

- [ ] **Step 4: Drop the dead CSS**

In `apps/crm/src/pages/configuracao/cobranca/cobranca.css`, delete the `.billing-promo`, `.billing-promo label`, `.billing-promo input`, `.billing-promo input:focus` and `.billing-promo input::placeholder` rules (lines 92–122).

- [ ] **Step 5: Verify nothing references the promo any more**

```bash
grep -rn "BEMVINDO\|promo_code\|PROMO_CODE\|billing-promo" apps supabase vercel.json
```

Expected: no matches outside `docs/`.

- [ ] **Step 6: Run the suite, typecheck and commit**

```bash
npx vitest run apps/crm/src/pages/configuracao
npx tsc -p apps/crm/tsconfig.json --noEmit
```

Expected: PASS, no type errors.

```bash
npm run format
git add apps/crm/src/pages/configuracao/cobranca
git commit -m "refactor(billing): drop the promo code input and retitle the first-time CTA"
```

---

### Task 12: Full verification

**Files:** none modified — this task proves the branch is CI-clean.

- [ ] **Step 1: Run the frontend suite**

```bash
npm run test
```

Expected: PASS, no failures.

- [ ] **Step 2: Run the edge-function suite and revert the lockfile**

```bash
npm run test:functions
git checkout -- deno.lock
```

Expected: PASS.

- [ ] **Step 3: Typecheck all four projects the CI checks**

```bash
npx tsc -p apps/crm/tsconfig.json --noEmit && npx tsc -p apps/hub/tsconfig.json --noEmit && npx tsc -p apps/admin/tsconfig.json --noEmit && npx tsc -p tsconfig.scripts.json
```

Expected: no output.

- [ ] **Step 4: Lint and format gates**

```bash
npm run lint && npm run format:check
```

Expected: both clean. If `format:check` fails, run `npm run format` and amend.

- [ ] **Step 5: Confirm the working tree is clean apart from intended changes**

```bash
git status --short
```

Expected: empty. A modified `deno.lock` here means step 2's revert was skipped.

---

## Deploy steps (after merge, not part of any task)

1. **Supabase Auth → disable "Confirm email"** on prod and staging. Until flipped, `signUp` returns no session and Task 8's fallback keeps the check-your-email screen, so the ordering is safe either way.
2. Deploy the edge function to both projects. Check `supabase/.temp/project-ref` first — link state flips between prod (`skjzpekeqefvlojenfsw`) and staging (`wlyzhyfondykzpsiqsce`):

```bash
npx supabase functions deploy billing-checkout --use-api
```

3. The frontend ships with the Vercel deploy on merge.

## Notes for the implementer

- **The `/comecar` route needs three registrations, not one.** Task 6 steps 6–7 cover `App.tsx`, `APP_ROUTE_PREFIXES` and both `vercel.json` strings. The guard test catches only the rewrite half; the header half is on you.
- **`npm run test:functions` runs with `--no-check`.** It will not catch a type error in an edge function. Task 2 step 6 is the only typecheck that covers `billing-checkout`.
- **`AnalyticsEvent` is a closed union with a compile-time guard.** Any new event name must be added there first (Task 5b) or `tsc` fails, and `npm run test` will not catch it — Vitest transpiles without typechecking.
- **Trial eligibility is `hasEverSubscribed`, never row presence or `status`.** An abandoned checkout leaves a real row with `status = null`; treating that as "has a subscription" would deny the trial to exactly the users this feature targets.
