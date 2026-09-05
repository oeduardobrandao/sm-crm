# Pagar.me no Admin (paridade com a Stripe) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give Pagar.me subscriptions the same Admin treatment Stripe already has: a dashboard deep link, a display-only live read with a drift warning, provider labels in the list and CSV, and corrected copy.

**Architecture:** A new pure module in `platform-admin` (`pagarme-detail.ts`) owns the URL builder, the live view-model and the drift rules; `workspace-detail.ts` calls it from the Pagar.me branch behind the existing `readOnly` gate and never writes to `workspace_subscriptions`. The Admin frontend mirrors the new fields in `lib/subscription.ts`, formats them in a pure helper module, and renders them in the detail card, the list cell and the CSV. One migration adds `provider` to the list RPC's subscription JSON.

**Tech Stack:** Deno edge functions (Supabase), `_shared/pagarme.ts` client, Postgres SQL RPC, React 19 + TanStack Query (Admin), Vitest, `deno test`, psql SQL suites.

**Spec:** `docs/superpowers/specs/2026-09-05-pagarme-admin-parity-design.md`

## Global Constraints

- The branch is `claude/pagar-me-admin-integration-83c14f`, already reset onto `origin/main` (c7d51b56). Run every command from the worktree root `/Users/eduardosouza/Projects/sm-crm/.claude/worktrees/pagar-me-admin-integration-83c14f`.
- **Never write to `workspace_subscriptions` from the Pagar.me branch of `buildSubscriptionDetail`**, in any case (spec §2 step 5).
- **`opts.readOnly` (mcp-admin) must never trigger an outbound Pagar.me call and must not expose the dashboard link** (spec §2 step 2, §6).
- Never return Pagar.me error bodies to the client; only the boolean `pagarme_live_error` (spec §6).
- Dashboard link pattern: `${PAGARME_DASHBOARD_BASE}/subscriptions/${sub_id}/info`; base must start with `https://`; link omitted when unset/invalid (spec §1).
- Period drift = absolute difference between instants greater than 24 hours; unparsable value counts as different (spec §1 rule 2).
- Status drift exception: mirror `past_due` with remote `active` is NOT drift (spec §1 rule 1).
- All user-facing copy in Portuguese. **No em-dashes** in user-facing strings (use ":" or "," instead).
- Migration version prefix must be above `origin/main`'s tail. At plan time the tail is `20260909000001`; the plan uses `20260910000001`. Re-verify with `git ls-tree --name-only origin/main:supabase/migrations | tail -3` right before opening the PR and renumber if something newer landed.
- `npm run test:functions` dirties the root `deno.lock`; run `git checkout deno.lock` before every commit.
- Commit messages end with `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.
- Deviation from spec §4 (documented here on purpose): dates are formatted with `toLocaleDateString('pt-BR')`, the convention the detail page already uses for "Renova em", rather than `date-fns`, so neighbouring fields can never disagree by a timezone day.
- The Pagar.me `card` shape is **not validated anywhere in this repo**. The official response example shows `card` at the top level with `holder_name`, `masked_number` (e.g. `424242******4242`), `exp_month`, `exp_year`, `status`, and no `brand`/`last_four_digits`. The mapper must therefore derive `last4` from `masked_number` when `last_four_digits` is absent, tolerate a missing brand, and the staging browser check in Task 8 must see real card values rendered. A "—" on an active subscription blocks the merge until the mapper is fixed.
- New env vars are added to `.env.example` as well as `CLAUDE.md` (AGENTS.md rule). `.env.e2e.local.example` is untouched: the variable plays no part in E2E.

**Single-file test commands used throughout:**

```bash
# Deno, one file
deno test --no-check --node-modules-dir=auto --allow-env --allow-read --allow-net --allow-sys supabase/functions/__tests__/<file>_test.ts

# Vitest, one file (run from the repo root)
npx vitest run apps/admin/src/<path>/__tests__/<file>.test.ts
```

## File Structure

| File | Responsibility |
|---|---|
| `supabase/functions/platform-admin/pagarme-detail.ts` (create) | Pure view-model: types, `pagarmeDashboardUrl`, `statusDiffers`, `periodDiffers`, `buildPagarmeLive`; plus the injectable `createPagarmeDetailGateway` port |
| `supabase/functions/__tests__/platform-admin-pagarme-detail_test.ts` (create) | Unit tests for the pure module |
| `supabase/functions/platform-admin/workspace-detail.ts` (modify) | Pagar.me branch calls the live read behind `readOnly`; three new response fields |
| `supabase/functions/__tests__/platform-admin-workspace-detail_test.ts` (create) | Integration tests with fake db + fake gateway |
| `supabase/migrations/20260910000001_admin_list_workspaces_provider.sql` (create) | RPC v6: `'provider'` key in the subscription JSON |
| `supabase/tests/entitlements/79_admin_list_workspaces_provider.sql` (create) | SQL regression for the new key |
| `apps/admin/src/lib/subscription.ts` (modify) | Types for the new fields + `providerLabel` |
| `apps/admin/src/lib/__tests__/subscription.test.ts` (modify) | `providerLabel` tests |
| `apps/admin/src/pages/workspace-subscription.ts` (create) | Pure formatters: `formatDay`, `formatCard`, `describeDrift` |
| `apps/admin/src/pages/__tests__/workspace-subscription.test.ts` (create) | Formatter tests |
| `apps/admin/src/pages/WorkspaceDetailPage.tsx` (modify) | Link, two new fields, drift/error notes, copy fixes |
| `apps/admin/src/pages/workspaces/WorkspacesTable.tsx` (modify) | Provider caption in `SubscriptionCell` |
| `apps/admin/src/pages/__tests__/WorkspacesTable.test.tsx` (modify) | Caption test + fixture |
| `apps/admin/src/pages/workspaces-export.ts` (modify) | "Provedor" CSV column |
| `apps/admin/src/pages/__tests__/workspaces-export.test.ts` (modify) | Column tests + fixtures |
| `apps/admin/src/pages/__tests__/dashboard-risk.test.ts`, `DashboardPage.test.tsx` (modify) | Add `provider` to subscription fixtures (type completeness) |
| `CLAUDE.md` (modify) | Document `PAGARME_DASHBOARD_BASE` |

---

### Task 1: Pure module `pagarme-detail.ts` (URL, drift rules, live view-model)

**Files:**
- Create: `supabase/functions/platform-admin/pagarme-detail.ts`
- Test: `supabase/functions/__tests__/platform-admin-pagarme-detail_test.ts`

**Interfaces:**
- Consumes: `normalizePagarmeStatus`, `mapPagarmeTemporalFields` from `supabase/functions/_shared/pagarme-logic.ts`; `pagarmeFetch` from `supabase/functions/_shared/pagarme.ts`.
- Produces (used by Task 2):
  - `interface PagarmeRemoteSubscription`, `interface PagarmeLiveCard`, `interface PagarmeDrift`, `interface PagarmeLive`, `interface PagarmeDetailGateway { fetchSubscription(subId: string): Promise<PagarmeRemoteSubscription> }`
  - `pagarmeDashboardUrl(base: string | null | undefined, subId: string): string | null`
  - `statusDiffers(mirror: string | null, live: "trialing" | "active" | "canceled" | null): boolean`
  - `periodDiffers(mirror: string | null, live: string | null): boolean`
  - `buildPagarmeLive(remote: PagarmeRemoteSubscription, mirror: { status: string | null; current_period_end: string | null }): PagarmeLive`
  - `createPagarmeDetailGateway(): PagarmeDetailGateway`

- [ ] **Step 1: Write the failing tests**

Create `supabase/functions/__tests__/platform-admin-pagarme-detail_test.ts`:

```ts
import { assertEquals } from "./assert.ts";
import {
  buildPagarmeLive,
  pagarmeDashboardUrl,
  periodDiffers,
  statusDiffers,
  type PagarmeRemoteSubscription,
} from "../platform-admin/pagarme-detail.ts";

const BASE = "https://dash.pagar.me/merch_pv13W5kwigIKJX8b/acc_4AYdz4NIRHgey7Nk";

// ─── pagarmeDashboardUrl ────────────────────────────────────────────────────

Deno.test("pagarmeDashboardUrl: base + /subscriptions/{id}/info", () => {
  assertEquals(
    pagarmeDashboardUrl(BASE, "sub_nqONBbf4quM0NmbP"),
    `${BASE}/subscriptions/sub_nqONBbf4quM0NmbP/info`,
  );
});

Deno.test("pagarmeDashboardUrl: trailing slashes and whitespace on the base are trimmed", () => {
  assertEquals(pagarmeDashboardUrl(`  ${BASE}//  `, "sub_1"), `${BASE}/subscriptions/sub_1/info`);
});

Deno.test("pagarmeDashboardUrl: null when the base is unset, empty or not https", () => {
  assertEquals(pagarmeDashboardUrl(null, "sub_1"), null);
  assertEquals(pagarmeDashboardUrl(undefined, "sub_1"), null);
  assertEquals(pagarmeDashboardUrl("", "sub_1"), null);
  assertEquals(pagarmeDashboardUrl("http://dash.pagar.me/merch_x/acc_y", "sub_1"), null);
});

Deno.test("pagarmeDashboardUrl: null for an empty id; special characters are encoded", () => {
  assertEquals(pagarmeDashboardUrl(BASE, ""), null);
  assertEquals(pagarmeDashboardUrl(BASE, "sub/1?x"), `${BASE}/subscriptions/sub%2F1%3Fx/info`);
});

// ─── statusDiffers ──────────────────────────────────────────────────────────

Deno.test("statusDiffers: same status is not drift", () => {
  assertEquals(statusDiffers("active", "active"), false);
  assertEquals(statusDiffers("trialing", "trialing"), false);
});

Deno.test("statusDiffers: different status is drift, including a null mirror", () => {
  assertEquals(statusDiffers("active", "canceled"), true);
  assertEquals(statusDiffers(null, "active"), true);
});

Deno.test("statusDiffers: past_due mirror vs active remote is NOT drift (dunning is local truth)", () => {
  assertEquals(statusDiffers("past_due", "active"), false);
});

Deno.test("statusDiffers: unknown remote status (null) never flags drift", () => {
  assertEquals(statusDiffers("active", null), false);
});

// ─── periodDiffers ──────────────────────────────────────────────────────────

Deno.test("periodDiffers: both null is not drift", () => {
  assertEquals(periodDiffers(null, null), false);
});

Deno.test("periodDiffers: null remote period never flags drift (canceled keeps the retained value)", () => {
  assertEquals(periodDiffers("2026-10-03T00:00:00Z", null), false);
});

Deno.test("periodDiffers: mirror null but remote set is drift", () => {
  assertEquals(periodDiffers(null, "2026-10-03T00:00:00Z"), true);
});

Deno.test("periodDiffers: within 24h is not drift (absorbs timezone skew)", () => {
  // "2026-10-03" parses as UTC midnight; the mirror is 3h later (midnight BRT).
  assertEquals(periodDiffers("2026-10-03T03:00:00Z", "2026-10-03"), false);
  assertEquals(periodDiffers("2026-10-03T00:00:00.000Z", "2026-10-03T23:59:59Z"), false);
});

Deno.test("periodDiffers: more than 24h apart is drift", () => {
  assertEquals(periodDiffers("2026-10-03T00:00:00Z", "2027-10-03T00:00:00Z"), true);
  assertEquals(periodDiffers("2026-10-03T00:00:00Z", "2026-10-04T00:00:01Z"), true);
});

Deno.test("periodDiffers: unparsable value counts as different", () => {
  assertEquals(periodDiffers("not-a-date", "2026-10-03T00:00:00Z"), true);
  assertEquals(periodDiffers("2026-10-03T00:00:00Z", "nope"), true);
});

// ─── buildPagarmeLive ───────────────────────────────────────────────────────

const TRIAL_MIRROR = { status: "trialing", current_period_end: "2026-10-03T00:00:00.000Z" };

function remote(over: Partial<PagarmeRemoteSubscription> = {}): PagarmeRemoteSubscription {
  return {
    id: "sub_1",
    status: "future",
    start_at: "2026-10-03T00:00:00Z",
    card: { brand: "visa", last_four_digits: "4242", exp_month: 12, exp_year: 2028 },
    ...over,
  };
}

Deno.test("buildPagarmeLive: future → trialing, next charge = start_at, card mapped, no drift", () => {
  const live = buildPagarmeLive(remote(), TRIAL_MIRROR);
  assertEquals(live.status, "trialing");
  assertEquals(live.remote_status, "future");
  assertEquals(live.next_billing_at, "2026-10-03T00:00:00Z");
  assertEquals(live.start_at, "2026-10-03T00:00:00Z");
  assertEquals(live.canceled_at, null);
  assertEquals(live.card, { brand: "visa", last4: "4242", exp_month: 12, exp_year: 2028 });
  assertEquals(live.drift, null);
});

Deno.test("buildPagarmeLive: active prefers next_billing_at, falls back to current_cycle.billing_at", () => {
  const mirror = { status: "active", current_period_end: "2027-10-03T00:00:00Z" };
  const cycle = { end_at: "2027-10-03T00:00:00Z", billing_at: "2027-10-02T00:00:00Z" };
  const a = buildPagarmeLive(
    remote({ status: "active", next_billing_at: "2027-10-03T00:00:00Z", current_cycle: cycle }),
    mirror,
  );
  assertEquals(a.next_billing_at, "2027-10-03T00:00:00Z");
  const b = buildPagarmeLive(
    remote({ status: "active", next_billing_at: null, current_cycle: cycle }),
    mirror,
  );
  assertEquals(b.next_billing_at, "2027-10-02T00:00:00Z");
  assertEquals(b.drift, null);
  // Only the sandbox-observed cycle shape ({ end_at }): the next charge is the cycle boundary.
  const c = buildPagarmeLive(
    remote({ status: "active", next_billing_at: null, current_cycle: { end_at: "2027-10-03T00:00:00Z" } }),
    mirror,
  );
  assertEquals(c.next_billing_at, "2027-10-03T00:00:00Z");
  assertEquals(c.drift, null);
});

Deno.test("buildPagarmeLive: canceled and failed → canceled, next charge null, canceled_at kept", () => {
  const mirror = { status: "canceled", current_period_end: "2027-10-03T00:00:00Z" };
  const c = buildPagarmeLive(
    remote({ status: "canceled", start_at: null, canceled_at: "2026-09-05T10:00:00Z" }),
    mirror,
  );
  assertEquals(c.status, "canceled");
  assertEquals(c.next_billing_at, null);
  assertEquals(c.canceled_at, "2026-09-05T10:00:00Z");
  assertEquals(c.drift, null); // period null on the remote side never flags
  const f = buildPagarmeLive(remote({ status: "failed" }), mirror);
  assertEquals(f.status, "canceled");
});

Deno.test("buildPagarmeLive: unknown remote status → status null, raw value exposed, no drift", () => {
  const live = buildPagarmeLive(remote({ status: "paused" }), TRIAL_MIRROR);
  assertEquals(live.status, null);
  assertEquals(live.remote_status, "paused");
  assertEquals(live.next_billing_at, null);
  assertEquals(live.drift, null);
});

Deno.test("buildPagarmeLive: missing card → null; partial card keeps what exists", () => {
  assertEquals(buildPagarmeLive(remote({ card: null }), TRIAL_MIRROR).card, null);
  assertEquals(buildPagarmeLive(remote({ card: undefined }), TRIAL_MIRROR).card, null);
  assertEquals(
    buildPagarmeLive(remote({ card: { brand: "mastercard" } }), TRIAL_MIRROR).card,
    { brand: "mastercard", last4: null, exp_month: null, exp_year: null },
  );
});

Deno.test("buildPagarmeLive: documented subscription card shape (masked_number, no brand/last4) still yields last4", () => {
  // Official "criar assinatura" example: card has holder_name, masked_number, exp_month,
  // exp_year, status; no brand, no last_four_digits.
  const live = buildPagarmeLive(
    remote({ card: { masked_number: "424242******4242", exp_month: 12, exp_year: 2028 } }),
    TRIAL_MIRROR,
  );
  assertEquals(live.card, { brand: null, last4: "4242", exp_month: 12, exp_year: 2028 });
});

Deno.test("buildPagarmeLive: last_four_digits wins over masked_number; a short or non-numeric mask gives null", () => {
  const a = buildPagarmeLive(
    remote({ card: { last_four_digits: "1111", masked_number: "424242******4242" } }),
    TRIAL_MIRROR,
  );
  assertEquals(a.card?.last4, "1111");
  const b = buildPagarmeLive(remote({ card: { masked_number: "****" } }), TRIAL_MIRROR);
  assertEquals(b.card?.last4, null);
  const c = buildPagarmeLive(remote({ card: { masked_number: "42" } }), TRIAL_MIRROR);
  assertEquals(c.card?.last4, null);
});

Deno.test("buildPagarmeLive: status drift is reported with both sides", () => {
  const live = buildPagarmeLive(
    remote({ status: "canceled", start_at: null, canceled_at: "2026-09-05T10:00:00Z" }),
    { status: "active", current_period_end: "2027-10-03T00:00:00Z" },
  );
  assertEquals(live.drift, { status: { mirror: "active", live: "canceled" }, period: null });
});

Deno.test("buildPagarmeLive: period drift is reported with both sides", () => {
  const live = buildPagarmeLive(
    remote({
      status: "active",
      next_billing_at: "2027-10-03T00:00:00Z",
      current_cycle: { end_at: "2027-10-03T00:00:00Z" },
    }),
    { status: "active", current_period_end: "2026-10-03T00:00:00Z" },
  );
  assertEquals(live.drift, {
    status: null,
    period: { mirror: "2026-10-03T00:00:00Z", live: "2027-10-03T00:00:00Z" },
  });
});

Deno.test("buildPagarmeLive: past_due mirror with active remote reports no status drift", () => {
  const live = buildPagarmeLive(
    remote({ status: "active", next_billing_at: "2027-10-03T00:00:00Z" }),
    { status: "past_due", current_period_end: "2027-10-03T00:00:00Z" },
  );
  assertEquals(live.drift, null);
});
```

- [ ] **Step 2: Run the test file to verify it fails**

Run:
```bash
deno test --no-check --node-modules-dir=auto --allow-env --allow-read --allow-net --allow-sys supabase/functions/__tests__/platform-admin-pagarme-detail_test.ts
```
Expected: FAIL at module resolution (`Module not found ".../platform-admin/pagarme-detail.ts"`).

- [ ] **Step 3: Write the module**

Create `supabase/functions/platform-admin/pagarme-detail.ts`:

```ts
// Pure view-model helpers for the Pagar.me branch of the admin workspace detail. No network,
// env or Supabase access in the helpers (same discipline as pricing.ts and
// _shared/pagarme-logic.ts) so the drift rules are unit-testable in isolation. The gateway port
// at the bottom is the only thing that touches the network, and buildSubscriptionDetail takes it
// by injection so tests substitute a fake.
//
// Spec: docs/superpowers/specs/2026-09-05-pagarme-admin-parity-design.md §1.

import { pagarmeFetch } from "../_shared/pagarme.ts";
import { mapPagarmeTemporalFields, normalizePagarmeStatus } from "../_shared/pagarme-logic.ts";

export interface PagarmeRemoteSubscription {
  id: string;
  /** 'future' | 'active' | 'canceled' | 'failed' | anything newer Pagar.me may add. */
  status: string;
  start_at?: string | null;
  next_billing_at?: string | null;
  canceled_at?: string | null;
  current_cycle?: {
    start_at?: string | null;
    end_at?: string | null;
    billing_at?: string | null;
    status?: string | null;
  } | null;
  card?: {
    brand?: string | null;
    first_six_digits?: string | null;
    last_four_digits?: string | null;
    /** The only number field the official subscription example shows, e.g. "424242******4242". */
    masked_number?: string | null;
    exp_month?: number | null;
    exp_year?: number | null;
  } | null;
}

export interface PagarmeLiveCard {
  brand: string | null;
  last4: string | null;
  exp_month: number | null;
  exp_year: number | null;
}

export interface PagarmeDrift {
  /** Present only when the normalized live status differs from the mirror. */
  status: { mirror: string | null; live: string } | null;
  /** Present only when the live period end differs from the mirror by more than 24h. */
  period: { mirror: string | null; live: string } | null;
}

export type PagarmeLiveStatus = "trialing" | "active" | "canceled";

export interface PagarmeLive {
  /** Normalized with the webhook's table; null when the remote status is unknown to us. */
  status: PagarmeLiveStatus | null;
  remote_status: string;
  /** active: next_billing_at ?? current_cycle.billing_at ?? current_cycle.end_at; future: start_at; otherwise null. */
  next_billing_at: string | null;
  start_at: string | null;
  canceled_at: string | null;
  card: PagarmeLiveCard | null;
  /** null when nothing diverges. */
  drift: PagarmeDrift | null;
}

export interface PagarmeDetailGateway {
  /** GET /subscriptions/{id}. Throws PagarmeApiError / timeout / missing-key errors. */
  fetchSubscription(subId: string): Promise<PagarmeRemoteSubscription>;
}

/**
 * `${base}/subscriptions/${id}/info` (the Pagar.me dashboard's subscription page). Returns null
 * when the base is unset, not https, or the id is empty, so callers just omit the link.
 */
export function pagarmeDashboardUrl(
  base: string | null | undefined,
  subId: string,
): string | null {
  if (!base || !subId) return null;
  const trimmed = base.trim().replace(/\/+$/, "");
  if (!/^https:\/\//i.test(trimmed)) return null;
  return `${trimmed}/subscriptions/${encodeURIComponent(subId)}/info`;
}

/**
 * Rule 1 of the spec. A remote `active` while the mirror is in a dunning episode (`past_due`)
 * is expected, not drift: only charge.paid closes the episode (see buildReconcileColumns in
 * pagarme-webhook/logic.ts). An unknown remote status (null) is displayed, never judged.
 */
export function statusDiffers(
  mirror: string | null,
  live: PagarmeLiveStatus | null,
): boolean {
  if (live == null) return false;
  if (mirror === live) return false;
  if (mirror === "past_due" && live === "active") return false;
  return true;
}

const PERIOD_TOLERANCE_MS = 24 * 60 * 60 * 1000;

function parseMs(value: string | null | undefined): number | null {
  if (!value) return null;
  const ms = new Date(value).getTime();
  return Number.isNaN(ms) ? null : ms;
}

/**
 * Rules 2 to 4 of the spec. A null remote period never flags (a canceled subscription has no
 * cycle and the mirror retains its paid-through date on purpose); a null mirror against a real
 * remote period does. Otherwise the two instants must be within 24h of each other, which
 * absorbs any date-only vs timestamp skew while still catching a real month/year change.
 */
export function periodDiffers(mirror: string | null, live: string | null): boolean {
  if (live == null) return false;
  if (mirror == null) return true;
  const a = parseMs(mirror);
  const b = parseMs(live);
  if (a == null || b == null) return true;
  return Math.abs(a - b) > PERIOD_TOLERANCE_MS;
}

/**
 * active: the documented top-level next_billing_at, then the cycle's billing_at (documented
 * only in the boleto example), then the cycle's end_at, the one cycle field every sibling
 * module in this repo has actually observed in sandbox (prepaid: the next charge is at the
 * cycle boundary). future: start_at. Otherwise null.
 */
function nextBilling(remote: PagarmeRemoteSubscription): string | null {
  if (remote.status === "active") {
    return remote.next_billing_at ??
      remote.current_cycle?.billing_at ??
      remote.current_cycle?.end_at ??
      null;
  }
  if (remote.status === "future") return remote.start_at ?? null;
  return null;
}

/** Last four digits from a mask like "424242******4242"; null unless the tail is 4 digits. */
function last4FromMask(masked: string | null | undefined): string | null {
  if (!masked) return null;
  const tail = masked.trim().slice(-4);
  return /^\d{4}$/.test(tail) ? tail : null;
}

/**
 * The subscription's card shape is not validated in this repo: the official example shows
 * holder_name/masked_number/exp_month/exp_year and NO brand or last_four_digits, while the
 * generic card object has brand + last_four_digits. Read both, prefer the explicit fields.
 */
function mapCard(card: PagarmeRemoteSubscription["card"]): PagarmeLiveCard | null {
  if (!card) return null;
  return {
    brand: card.brand ?? null,
    last4: card.last_four_digits ?? last4FromMask(card.masked_number),
    exp_month: typeof card.exp_month === "number" ? card.exp_month : null,
    exp_year: typeof card.exp_year === "number" ? card.exp_year : null,
  };
}

export function buildPagarmeLive(
  remote: PagarmeRemoteSubscription,
  mirror: { status: string | null; current_period_end: string | null },
): PagarmeLive {
  const status = normalizePagarmeStatus(remote.status);
  const livePeriod = mapPagarmeTemporalFields(remote).current_period_end;

  const statusDrift = status != null && statusDiffers(mirror.status, status)
    ? { mirror: mirror.status, live: status }
    : null;
  const periodDrift = livePeriod != null && periodDiffers(mirror.current_period_end, livePeriod)
    ? { mirror: mirror.current_period_end, live: livePeriod }
    : null;

  return {
    status,
    remote_status: remote.status,
    next_billing_at: nextBilling(remote),
    start_at: remote.start_at ?? null,
    canceled_at: remote.canceled_at ?? null,
    card: mapCard(remote.card),
    drift: statusDrift || periodDrift ? { status: statusDrift, period: periodDrift } : null,
  };
}

/** Real port. Same shape as pagarme-webhook/gateway.ts; the secret is only required at call time. */
export function createPagarmeDetailGateway(): PagarmeDetailGateway {
  return {
    fetchSubscription: (subId) =>
      pagarmeFetch<PagarmeRemoteSubscription>(
        "GET",
        `/subscriptions/${encodeURIComponent(subId)}`,
      ),
  };
}
```

- [ ] **Step 4: Run the test file to verify it passes**

Run:
```bash
deno test --no-check --node-modules-dir=auto --allow-env --allow-read --allow-net --allow-sys supabase/functions/__tests__/platform-admin-pagarme-detail_test.ts
```
Expected: all 22 tests PASS.

- [ ] **Step 5: Typecheck the module and commit**

Run:
```bash
deno check --node-modules-dir=auto supabase/functions/platform-admin/pagarme-detail.ts
```
Expected: no errors.

```bash
git checkout deno.lock
git add supabase/functions/platform-admin/pagarme-detail.ts supabase/functions/__tests__/platform-admin-pagarme-detail_test.ts
git commit -m "feat(platform-admin): view-model puro da assinatura Pagar.me (link, drift, cartão)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: Live read in `workspace-detail.ts` (display only, behind `readOnly`)

**Files:**
- Modify: `supabase/functions/platform-admin/workspace-detail.ts` (imports at top; `handleGetWorkspace` opts type at line ~31; `buildSubscriptionDetail` from line ~152)
- Test: `supabase/functions/__tests__/platform-admin-workspace-detail_test.ts`

**Interfaces:**
- Consumes (Task 1): `PagarmeDetailGateway`, `PagarmeLive`, `buildPagarmeLive`, `createPagarmeDetailGateway`, `pagarmeDashboardUrl`.
- Produces:
  - `export interface SubscriptionDetailOpts { readOnly?: boolean; pagarme?: PagarmeDetailGateway; pagarmeDashboardBase?: string | null }` (accepted by both `handleGetWorkspace` and `buildSubscriptionDetail`).
  - Three new keys on the `subscription` object of the `get-workspace` response, present for every provider: `pagarme_dashboard_url: string | null`, `pagarme_live: PagarmeLive | null`, `pagarme_live_error: boolean`.

- [ ] **Step 1: Write the failing tests**

Create `supabase/functions/__tests__/platform-admin-workspace-detail_test.ts`:

```ts
import { assert, assertEquals } from "./assert.ts";
import { makeFakeDb, type Resp } from "./mcp-admin-helpers.ts";
import { buildSubscriptionDetail } from "../platform-admin/workspace-detail.ts";
import type {
  PagarmeDetailGateway,
  PagarmeRemoteSubscription,
} from "../platform-admin/pagarme-detail.ts";

const BASE = "https://dash.pagar.me/merch_x/acc_y";

const PAGARME_ROW = {
  status: "trialing",
  plan_id: "max",
  billing_interval: "year",
  current_period_end: "2026-10-03T00:00:00.000Z",
  cancel_at_period_end: false,
  failed_payment_count: 0,
  stripe_customer_id: null,
  stripe_subscription_id: null,
  provider: "pagarme",
  pagarme_subscription_id: "sub_abc",
  installments: 12,
  amount_cents: 113880,
  gross_cents: null,
  currency: "brl",
  amount_interval: "year",
  discount_label: null,
};

const REMOTE: PagarmeRemoteSubscription = {
  id: "sub_abc",
  status: "future",
  start_at: "2026-10-03T00:00:00Z",
  card: { brand: "visa", last_four_digits: "4242", exp_month: 12, exp_year: 2028 },
};

function fakeGateway(impl: (id: string) => Promise<PagarmeRemoteSubscription>) {
  const calls: string[] = [];
  const gateway: PagarmeDetailGateway = {
    fetchSubscription: (id) => {
      calls.push(id);
      return impl(id);
    },
  };
  return { gateway, calls };
}

function dbFor(row: Record<string, unknown> | null, plans: Resp[]) {
  return makeFakeDb({
    workspace_subscriptions: [{ data: row, error: null }],
    plans,
  });
}

const PLAN_NAME_ONLY: Resp[] = [{ data: { name: "Max" }, error: null }];

Deno.test("pagarme row: one live fetch, link built, mirror amount kept, zero writes", async () => {
  const { db, calls } = dbFor(PAGARME_ROW, PLAN_NAME_ONLY);
  const { gateway, calls: fetched } = fakeGateway(() => Promise.resolve(REMOTE));
  const info = await buildSubscriptionDetail(db as never, "w1", {
    pagarme: gateway,
    pagarmeDashboardBase: BASE,
  });
  assert(info);
  assertEquals(fetched, ["sub_abc"]);
  assertEquals(info.provider, "pagarme");
  assertEquals(info.amount_cents, 113880);
  assertEquals(info.amount_source, "pagarme");
  assertEquals(info.pagarme_dashboard_url, `${BASE}/subscriptions/sub_abc/info`);
  assertEquals(info.pagarme_live_error, false);
  assertEquals(info.pagarme_live?.status, "trialing");
  assertEquals(info.pagarme_live?.card, { brand: "visa", last4: "4242", exp_month: 12, exp_year: 2028 });
  assertEquals(info.pagarme_live?.drift, null);
  assert(
    !calls.some((c) => c.table === "workspace_subscriptions" && c.method !== "from" && c.method !== "select" && c.method !== "eq" && c.method !== "maybeSingle"),
    "the Pagar.me branch must never write to workspace_subscriptions",
  );
});

Deno.test("pagarme row: gateway failure → error flag, live null, mirror and link intact", async () => {
  const { db, calls } = dbFor(PAGARME_ROW, PLAN_NAME_ONLY);
  const { gateway } = fakeGateway(() => Promise.reject(new Error("boom")));
  const info = await buildSubscriptionDetail(db as never, "w1", {
    pagarme: gateway,
    pagarmeDashboardBase: BASE,
  });
  assert(info);
  assertEquals(info.pagarme_live, null);
  assertEquals(info.pagarme_live_error, true);
  assertEquals(info.amount_cents, 113880);
  assertEquals(info.amount_source, "pagarme");
  assertEquals(info.pagarme_dashboard_url, `${BASE}/subscriptions/sub_abc/info`);
  assert(!calls.some((c) => c.table === "workspace_subscriptions" && c.method === "update"));
});

Deno.test("pagarme row: readOnly never calls the gateway and exposes no link", async () => {
  const { db } = dbFor(PAGARME_ROW, PLAN_NAME_ONLY);
  const { gateway, calls: fetched } = fakeGateway(() => Promise.resolve(REMOTE));
  const info = await buildSubscriptionDetail(db as never, "w1", {
    readOnly: true,
    pagarme: gateway,
    pagarmeDashboardBase: BASE,
  });
  assert(info);
  assertEquals(fetched, []);
  assertEquals(info.pagarme_dashboard_url, null);
  assertEquals(info.pagarme_live, null);
  assertEquals(info.pagarme_live_error, false);
  assertEquals(info.amount_source, "pagarme");
});

Deno.test("pagarme row without pagarme_subscription_id: no fetch, no link, mirror only", async () => {
  const { db } = dbFor({ ...PAGARME_ROW, pagarme_subscription_id: null }, PLAN_NAME_ONLY);
  const { gateway, calls: fetched } = fakeGateway(() => Promise.resolve(REMOTE));
  const info = await buildSubscriptionDetail(db as never, "w1", {
    pagarme: gateway,
    pagarmeDashboardBase: BASE,
  });
  assert(info);
  assertEquals(fetched, []);
  assertEquals(info.pagarme_dashboard_url, null);
  assertEquals(info.pagarme_live, null);
});

Deno.test("pagarme row without amount_cents: catalog fallback AND live fetch both happen", async () => {
  const { db } = dbFor(
    { ...PAGARME_ROW, amount_cents: null, currency: null, amount_interval: null },
    [
      { data: { name: "Max" }, error: null },
      { data: { price_brl: 29900, price_brl_annual: 113880 }, error: null },
    ],
  );
  const { gateway, calls: fetched } = fakeGateway(() => Promise.resolve(REMOTE));
  const info = await buildSubscriptionDetail(db as never, "w1", {
    pagarme: gateway,
    pagarmeDashboardBase: BASE,
  });
  assert(info);
  assertEquals(info.amount_cents, 113880);
  assertEquals(info.amount_source, "catalog");
  assertEquals(fetched, ["sub_abc"]);
  assertEquals(info.pagarme_live?.status, "trialing");
});

Deno.test("pagarme row: unset dashboard base → link null but the live read still runs", async () => {
  const { db } = dbFor(PAGARME_ROW, PLAN_NAME_ONLY);
  const { gateway, calls: fetched } = fakeGateway(() => Promise.resolve(REMOTE));
  const info = await buildSubscriptionDetail(db as never, "w1", {
    pagarme: gateway,
    pagarmeDashboardBase: null,
  });
  assert(info);
  assertEquals(info.pagarme_dashboard_url, null);
  assertEquals(fetched, ["sub_abc"]);
  assertEquals(info.pagarme_live?.status, "trialing");
});

Deno.test("stripe row: new fields are null/false and the Pagar.me gateway is never touched", async () => {
  const { db } = dbFor(
    {
      ...PAGARME_ROW,
      provider: "stripe",
      pagarme_subscription_id: null,
      stripe_subscription_id: "sub_stripe",
      amount_cents: null,
      currency: null,
      amount_interval: null,
      billing_interval: "month",
    },
    [
      { data: { name: "Max" }, error: null },
      { data: { price_brl: 29900, price_brl_annual: 113880 }, error: null },
    ],
  );
  const { gateway, calls: fetched } = fakeGateway(() => Promise.reject(new Error("must not be called")));
  // No Stripe loader is registered in tests, so the Stripe path falls back to the catalog.
  const info = await buildSubscriptionDetail(db as never, "w1", {
    pagarme: gateway,
    pagarmeDashboardBase: BASE,
  });
  assert(info);
  assertEquals(info.provider, "stripe");
  assertEquals(info.amount_source, "catalog");
  assertEquals(fetched, []);
  assertEquals(info.pagarme_dashboard_url, null);
  assertEquals(info.pagarme_live, null);
  assertEquals(info.pagarme_live_error, false);
});
```

- [ ] **Step 2: Run the test file to verify it fails**

Run:
```bash
deno test --no-check --node-modules-dir=auto --allow-env --allow-read --allow-net --allow-sys supabase/functions/__tests__/platform-admin-workspace-detail_test.ts
```
Expected: the first test FAILS on `assertEquals(fetched, ["sub_abc"])` (gateway never called) and on the missing `pagarme_dashboard_url`; the read-only and stripe tests may already pass.

- [ ] **Step 3: Implement the Pagar.me branch**

In `supabase/functions/platform-admin/workspace-detail.ts`:

3a. Add the import after the `stripe-loader` import (top of file):

```ts
import {
  buildPagarmeLive,
  createPagarmeDetailGateway,
  pagarmeDashboardUrl,
  type PagarmeDetailGateway,
  type PagarmeLive,
} from "./pagarme-detail.ts";
```

3b. Add the shared options type right above `handleGetWorkspace` and use it in both signatures:

```ts
export interface SubscriptionDetailOpts {
  /** Skips every outbound provider call and the Stripe write-back (mcp-admin's platform:read). */
  readOnly?: boolean;
  /** Injected in tests; defaults to the real GET /subscriptions/{id} port. */
  pagarme?: PagarmeDetailGateway;
  /** Injected in tests; `undefined` means read PAGARME_DASHBOARD_BASE from the env. */
  pagarmeDashboardBase?: string | null;
}
```

Change `handleGetWorkspace(..., opts: { readOnly?: boolean } = {})` to `opts: SubscriptionDetailOpts = {}` and `buildSubscriptionDetail(..., opts: { readOnly?: boolean } = {})` to `opts: SubscriptionDetailOpts = {}`.

3c. In `buildSubscriptionDetail`, add the three fields to the `info` literal, right after `stripe_dashboard_url: null as string | null,`:

```ts
    pagarme_dashboard_url: null as string | null,
    pagarme_live: null as PagarmeLive | null,
    pagarme_live_error: false,
```

3d. Replace the whole Pagar.me branch (the block starting with the comment `// A Pagar.me-owned row reads ONLY the mirror` through its closing `}`) with:

```ts
  // A Pagar.me-owned row prices from the mirror (written synchronously at checkout), never
  // from a Stripe live-fetch: its stripe_subscription_id, if present, is a dead pre-switch
  // leftover whose price would clobber the mirror on write-back. The live Pagar.me read below
  // is DISPLAY ONLY: it never writes to workspace_subscriptions (spec §2 step 5).
  if (provider === "pagarme") {
    if (row.amount_cents != null) {
      info.amount_cents = row.amount_cents as number;
      info.gross_cents = (row.gross_cents as number | null) ?? null;
      info.currency = (row.currency as string | null) ?? null;
      info.interval = (row.amount_interval as string | null) ?? row.billing_interval ?? null;
      info.discount_label = (row.discount_label as string | null) ?? null;
      info.amount_source = "pagarme";
    } else {
      await applyCatalogFallback(svc, info, row.plan_id ?? null, row.billing_interval ?? null);
    }
    return attachPagarmeLive(
      info,
      {
        pagarme_subscription_id: (row.pagarme_subscription_id as string | null) ?? null,
        status: row.status ?? null,
        current_period_end: row.current_period_end ?? null,
      },
      opts,
    );
  }
```

3e. Add the helper right after `buildSubscriptionDetail` (before `applyCatalogFallback`):

```ts
/**
 * Dashboard link + display-only live read for a Pagar.me row. Skipped entirely under
 * `readOnly` (mcp-admin) and for rows not yet bound to a Pagar.me subscription. The link does
 * not depend on the read succeeding, so it still works when the API is down. Errors are
 * logged internally and surfaced to the client only as `pagarme_live_error: true`.
 */
async function attachPagarmeLive<
  T extends {
    pagarme_dashboard_url: string | null;
    pagarme_live: PagarmeLive | null;
    pagarme_live_error: boolean;
  },
>(
  info: T,
  row: {
    pagarme_subscription_id: string | null;
    status: string | null;
    current_period_end: string | null;
  },
  opts: SubscriptionDetailOpts,
): Promise<T> {
  const subId = row.pagarme_subscription_id;
  if (opts.readOnly || !subId) return info;

  const base = opts.pagarmeDashboardBase !== undefined
    ? opts.pagarmeDashboardBase
    : (Deno.env.get("PAGARME_DASHBOARD_BASE") ?? null);
  info.pagarme_dashboard_url = pagarmeDashboardUrl(base, subId);

  const gateway = opts.pagarme ?? createPagarmeDetailGateway();
  try {
    const remote = await gateway.fetchSubscription(subId);
    info.pagarme_live = buildPagarmeLive(remote, {
      status: row.status,
      current_period_end: row.current_period_end,
    });
  } catch (err) {
    info.pagarme_live_error = true;
    console.error("[platform-admin] pagarme fetch failed:", (err as Error).message);
  }
  return info;
}
```

- [ ] **Step 4: Run the new test file and the existing mcp-admin suite**

Run:
```bash
deno test --no-check --node-modules-dir=auto --allow-env --allow-read --allow-net --allow-sys supabase/functions/__tests__/platform-admin-workspace-detail_test.ts
deno test --no-check --node-modules-dir=auto --allow-env --allow-read --allow-net --allow-sys supabase/functions/__tests__/mcp-admin-platform_test.ts
```
Expected: all 7 new tests PASS (the failing-gateway test prints one `[platform-admin] pagarme fetch failed: boom` line, which is expected); the mcp-admin suite still PASSES (its `getWorkspace` test passes `readOnly: true`).

- [ ] **Step 5: Typecheck the function graph and commit**

Run:
```bash
npm run check:functions
```
Expected: no errors (this checks `platform-admin/index.ts` and `mcp-admin/index.ts`, both of which import `workspace-detail.ts`).

```bash
git checkout deno.lock
git add supabase/functions/platform-admin/workspace-detail.ts supabase/functions/__tests__/platform-admin-workspace-detail_test.ts
git commit -m "feat(platform-admin): leitura ao vivo da assinatura Pagar.me no detalhe (só exibição)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3: Migration v6 of `admin_list_workspaces` (provider in the subscription JSON) + SQL suite

**Files:**
- Create: `supabase/migrations/20260910000001_admin_list_workspaces_provider.sql`
- Create: `supabase/tests/entitlements/79_admin_list_workspaces_provider.sql`

**Interfaces:**
- Produces: `subscription.provider` (`'stripe' | 'pagarme'`) inside every element of the RPC's `workspaces` array, consumed by Task 7 through `SubscriptionSummary.provider` (Task 4).

- [ ] **Step 1: Write the failing SQL suite**

Create `supabase/tests/entitlements/79_admin_list_workspaces_provider.sql`:

```sql
\set ON_ERROR_STOP on
\i supabase/tests/entitlements/_helpers.sql

begin;
do $$
declare
  v_stripe uuid; v_pagarme uuid; v_none uuid;
  v jsonb;
begin
  v_stripe  := et_make_workspace('max'); update workspaces set name = 'ET provider stripe'  where id = v_stripe;
  v_pagarme := et_make_workspace('max'); update workspaces set name = 'ET provider pagarme' where id = v_pagarme;
  v_none    := et_make_workspace('max'); update workspaces set name = 'ET provider none'    where id = v_none;

  insert into workspace_subscriptions (workspace_id, status, plan_id, provider, pagarme_subscription_id) values
    (v_stripe,  'active', 'max', 'stripe',  null),
    (v_pagarme, 'active', 'max', 'pagarme', 'sub_et_provider_79');

  execute 'set local role service_role';

  v := admin_list_workspaces(p_search := 'ET provider stripe');
  assert (v -> 'workspaces' -> 0 -> 'subscription' ->> 'provider') = 'stripe',
    format('stripe row: got %s', v -> 'workspaces' -> 0 -> 'subscription');

  v := admin_list_workspaces(p_search := 'ET provider pagarme');
  assert (v -> 'workspaces' -> 0 -> 'subscription' ->> 'provider') = 'pagarme',
    format('pagarme row: got %s', v -> 'workspaces' -> 0 -> 'subscription');

  -- Still carries the keys the Dashboard at-risk card reads (v5 contract untouched).
  assert (v -> 'workspaces' -> 0 -> 'subscription' ->> 'failed_payment_count')::int = 0,
    'failed_payment_count must survive the v6 rewrite';

  v := admin_list_workspaces(p_search := 'ET provider none');
  assert (v -> 'workspaces' -> 0 -> 'subscription' ->> 'provider') is null,
    'workspace without a subscription row must not carry a provider';

  execute 'reset role';
  raise notice 'PASS 79_admin_list_workspaces_provider';
end $$;
rollback;
```

- [ ] **Step 2: Run the suite to verify it fails (only if a local Supabase is up)**

If `npx supabase status` reports a running local stack (memory: it runs on colima; parallel worktrees may hold the default ports):
```bash
npx supabase db reset
psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -v ON_ERROR_STOP=1 -f supabase/tests/entitlements/79_admin_list_workspaces_provider.sql
```
Expected: FAIL with `stripe row: got {...}` (the v5 JSON has no `provider` key).

If no local stack is available, skip this step and rely on the CI `entitlement-tests` job; say so explicitly in the task report.

- [ ] **Step 3: Create the migration from the v5 file**

```bash
cp supabase/migrations/20260909000001_admin_list_workspaces_filters_sort.sql supabase/migrations/20260910000001_admin_list_workspaces_provider.sql
```

Then edit `supabase/migrations/20260910000001_admin_list_workspaces_provider.sql`:

3a. Replace everything **before** the line `CREATE OR REPLACE FUNCTION admin_list_workspaces(` (the whole v5 header comment **and** the `DROP FUNCTION IF EXISTS admin_list_workspaces(text, text, int, int, timestamptz);` line) with this header:

```sql
-- admin_list_workspaces v6: subscription JSON gains 'provider' ('stripe' | 'pagarme').
--
-- Body is v5 (20260909000001) verbatim, plus ONE key in the subscription LATERAL so the admin
-- Workspaces list and its CSV export can label which provider bills each customer. Same
-- signature, same grants; no DROP needed. The frontend deployed before this migration keeps
-- working (it treats a missing provider as "unknown" and shows no caption).
--
-- Spec: docs/superpowers/specs/2026-09-05-pagarme-admin-parity-design.md §5.
```

3b. In the subscription LATERAL near the end of the body, add `'provider'` as the **first** key. Before:

```sql
       LEFT JOIN LATERAL (
         SELECT jsonb_build_object(
           'status',               s.status,
           'plan_name',            sp.name,
```

After:

```sql
       LEFT JOIN LATERAL (
         SELECT jsonb_build_object(
           'provider',             s.provider,
           'status',               s.status,
           'plan_name',            sp.name,
```

Nothing else changes. Confirm with:
```bash
diff supabase/migrations/20260909000001_admin_list_workspaces_filters_sort.sql supabase/migrations/20260910000001_admin_list_workspaces_provider.sql
```
Expected: only the header block removed/replaced, the `DROP FUNCTION` line removed, and the one added `'provider',` line.

- [ ] **Step 4: Run the suite to verify it passes (local stack) and check the version guard**

If a local stack is up:
```bash
npx supabase db reset
bash scripts/test-entitlements.sh
```
Expected: every suite prints PASS, including `PASS 79_admin_list_workspaces_provider` and suites 67 to 73 (the v5 regression net).

Always run the duplicate-prefix check:
```bash
ls supabase/migrations | cut -d_ -f1 | sort | uniq -d
```
Expected: empty output.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260910000001_admin_list_workspaces_provider.sql supabase/tests/entitlements/79_admin_list_workspaces_provider.sql
git commit -m "feat(db): admin_list_workspaces v6 expõe provider na assinatura

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4: Admin types and `providerLabel` (`lib/subscription.ts`)

**Files:**
- Modify: `apps/admin/src/lib/subscription.ts` (interfaces at the top; new helper after `statusMeta`)
- Test: `apps/admin/src/lib/__tests__/subscription.test.ts`
- Modify (fixtures only): `apps/admin/src/pages/__tests__/dashboard-risk.test.ts`, `apps/admin/src/pages/__tests__/DashboardPage.test.tsx`

**Interfaces:**
- Produces (used by Tasks 5, 6, 7):
  - `export type BillingProvider = 'stripe' | 'pagarme'`
  - `SubscriptionSummary.provider: BillingProvider | null`
  - `export interface PagarmeLiveCard`, `PagarmeDrift`, `PagarmeLive` (TS mirrors of Task 1)
  - `SubscriptionInfo.pagarme_dashboard_url: string | null`, `SubscriptionInfo.pagarme_live: PagarmeLive | null`, `SubscriptionInfo.pagarme_live_error: boolean`
  - `export function providerLabel(provider: BillingProvider | null | undefined): string` → `'Stripe'` | `'Pagar.me'` (`'Stripe'` for null/unknown, the column's DB default)

- [ ] **Step 1: Write the failing test**

Add to `apps/admin/src/lib/__tests__/subscription.test.ts`: import `providerLabel` in the existing import list, and add this block inside `describe('subscription helpers', ...)`:

```ts
  describe('providerLabel', () => {
    it('names both billing providers', () => {
      expect(providerLabel('stripe')).toBe('Stripe');
      expect(providerLabel('pagarme')).toBe('Pagar.me');
    });
    it('falls back to Stripe, the column default, for null or unknown', () => {
      expect(providerLabel(null)).toBe('Stripe');
      expect(providerLabel(undefined)).toBe('Stripe');
      expect(providerLabel('other' as never)).toBe('Stripe');
    });
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run:
```bash
npx vitest run apps/admin/src/lib/__tests__/subscription.test.ts
```
Expected: FAIL, `providerLabel is not a function` (or not exported).

- [ ] **Step 3: Add the types and the helper**

In `apps/admin/src/lib/subscription.ts`:

3a. Add near the top (before `SubscriptionSummary`):

```ts
/** Which billing provider owns a subscription row (workspace_subscriptions.provider). */
export type BillingProvider = 'stripe' | 'pagarme';
```

3b. Add to `SubscriptionSummary` (after `current_period_end`):

```ts
  /** From the list RPC (migration 20260910000001); null on an older payload → no caption. */
  provider: BillingProvider | null;
```

3c. Add these interfaces right before `SubscriptionInfo`:

```ts
/** Card on file at Pagar.me, from the live read. */
export interface PagarmeLiveCard {
  brand: string | null;
  last4: string | null;
  exp_month: number | null;
  exp_year: number | null;
}

/** Fields where the live Pagar.me read disagrees with the local mirror. */
export interface PagarmeDrift {
  status: { mirror: string | null; live: string } | null;
  period: { mirror: string | null; live: string } | null;
}

/** Display-only live read of a Pagar.me subscription (never written back to the mirror). */
export interface PagarmeLive {
  status: 'trialing' | 'active' | 'canceled' | null;
  remote_status: string;
  next_billing_at: string | null;
  start_at: string | null;
  canceled_at: string | null;
  card: PagarmeLiveCard | null;
  drift: PagarmeDrift | null;
}
```

3d. Change `SubscriptionInfo.provider: 'stripe' | 'pagarme';` to `provider: BillingProvider;` and add after `stripe_dashboard_url`:

```ts
  /** "Abrir no Pagar.me" target; null when PAGARME_DASHBOARD_BASE is unset or the row is not Pagar.me. */
  pagarme_dashboard_url: string | null;
  /** Live read; null when skipped (Stripe row, read-only caller, unbound row) or when it failed. */
  pagarme_live: PagarmeLive | null;
  /** True when the live read was attempted and failed; the mirror fields are still authoritative. */
  pagarme_live_error: boolean;
```

3e. Add after `statusMeta`:

```ts
const PROVIDER_LABELS: Record<BillingProvider, string> = { stripe: 'Stripe', pagarme: 'Pagar.me' };

/** Human label for a billing provider. Unknown/null reads as Stripe, the column's DB default. */
export function providerLabel(provider: BillingProvider | null | undefined): string {
  return (provider && PROVIDER_LABELS[provider]) || PROVIDER_LABELS.stripe;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run:
```bash
npx vitest run apps/admin/src/lib/__tests__/subscription.test.ts
```
Expected: PASS.

- [ ] **Step 5: Complete the existing fixtures**

`SubscriptionSummary` now requires `provider`. Tests are excluded from `tsc`, so this is about keeping fixtures honest, not about a build break. In each of these files, add `provider: 'stripe',` immediately after every `failed_payment_count: <n>,` line inside a `subscription: { ... }` object literal:

- `apps/admin/src/pages/__tests__/dashboard-risk.test.ts` (7 occurrences)
- `apps/admin/src/pages/__tests__/DashboardPage.test.tsx` (1 occurrence)

(`WorkspacesTable.test.tsx` and `workspaces-export.test.ts` are updated in Task 7 together with their behaviour tests.)

Find them with:
```bash
grep -n "failed_payment_count" apps/admin/src/pages/__tests__/dashboard-risk.test.ts apps/admin/src/pages/__tests__/DashboardPage.test.tsx
```

Then run:
```bash
npx vitest run apps/admin/src/pages/__tests__/dashboard-risk.test.ts apps/admin/src/pages/__tests__/DashboardPage.test.tsx
```
Expected: PASS (unchanged behaviour).

- [ ] **Step 6: Typecheck, format, commit**

```bash
npx tsc -p apps/admin/tsconfig.json --noEmit
npx prettier --write apps/admin/src/lib/subscription.ts apps/admin/src/lib/__tests__/subscription.test.ts apps/admin/src/pages/__tests__/dashboard-risk.test.ts apps/admin/src/pages/__tests__/DashboardPage.test.tsx
```
Expected: tsc clean.

```bash
git add apps/admin/src/lib/subscription.ts apps/admin/src/lib/__tests__/subscription.test.ts apps/admin/src/pages/__tests__/dashboard-risk.test.ts apps/admin/src/pages/__tests__/DashboardPage.test.tsx
git commit -m "feat(admin): tipos da leitura ao vivo Pagar.me e providerLabel

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 5: Pure formatters `workspace-subscription.ts`

**Files:**
- Create: `apps/admin/src/pages/workspace-subscription.ts`
- Test: `apps/admin/src/pages/__tests__/workspace-subscription.test.ts`

**Interfaces:**
- Consumes (Task 4): `PagarmeDrift`, `PagarmeLiveCard`, `statusMeta` from `../lib/subscription`.
- Produces (used by Task 6):
  - `formatDay(iso: string | null | undefined): string` → `dd/MM/yyyy` in pt-BR, `'—'` for null/unparsable
  - `formatCard(card: PagarmeLiveCard | null | undefined): string` → e.g. `'Visa •••• 4242 · 12/28'`, `'—'` when nothing is known
  - `describeDrift(drift: PagarmeDrift | null | undefined): string[]` → one pt-BR line per divergent field, `[]` when none

- [ ] **Step 1: Write the failing tests**

Create `apps/admin/src/pages/__tests__/workspace-subscription.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { describeDrift, formatCard, formatDay } from '../workspace-subscription';

describe('formatDay', () => {
  it('renders dd/MM/yyyy in pt-BR', () => {
    // Midday UTC so the calendar day is the same in every timezone the tests may run in.
    expect(formatDay('2026-09-03T12:00:00Z')).toBe('03/09/2026');
  });
  it('renders a dash for null, empty or unparsable input', () => {
    expect(formatDay(null)).toBe('—');
    expect(formatDay(undefined)).toBe('—');
    expect(formatDay('')).toBe('—');
    expect(formatDay('not-a-date')).toBe('—');
  });
});

describe('formatCard', () => {
  it('renders brand, masked last four and MM/AA expiry', () => {
    expect(formatCard({ brand: 'visa', last4: '4242', exp_month: 12, exp_year: 2028 })).toBe(
      'Visa •••• 4242 · 12/28',
    );
  });
  it('zero-pads the month and accepts a two-digit year', () => {
    expect(formatCard({ brand: 'mastercard', last4: '0001', exp_month: 3, exp_year: 27 })).toBe(
      'Mastercard •••• 0001 · 03/27',
    );
  });
  it('drops the expiry when either part is missing', () => {
    expect(formatCard({ brand: 'visa', last4: '4242', exp_month: null, exp_year: 2028 })).toBe(
      'Visa •••• 4242',
    );
  });
  it('drops the brand when missing and keeps the last four', () => {
    expect(formatCard({ brand: null, last4: '4242', exp_month: 12, exp_year: 2028 })).toBe(
      '•••• 4242 · 12/28',
    );
  });
  it('renders a dash when nothing is known', () => {
    expect(formatCard(null)).toBe('—');
    expect(formatCard(undefined)).toBe('—');
    expect(formatCard({ brand: null, last4: null, exp_month: null, exp_year: null })).toBe('—');
  });
});

describe('describeDrift', () => {
  it('returns nothing when there is no drift', () => {
    expect(describeDrift(null)).toEqual([]);
    expect(describeDrift(undefined)).toEqual([]);
    expect(describeDrift({ status: null, period: null })).toEqual([]);
  });
  it('describes a status drift with both labels', () => {
    expect(describeDrift({ status: { mirror: 'active', live: 'canceled' }, period: null })).toEqual([
      'Status: espelho Ativo, Pagar.me Cancelado',
    ]);
  });
  it('describes a period drift with both dates', () => {
    expect(
      describeDrift({
        status: null,
        period: { mirror: '2026-10-03T12:00:00Z', live: '2027-10-03T12:00:00Z' },
      }),
    ).toEqual(['Período: espelho 03/10/2026, Pagar.me 03/10/2027']);
  });
  it('describes both, status first', () => {
    const lines = describeDrift({
      status: { mirror: null, live: 'active' },
      period: { mirror: null, live: '2027-10-03T12:00:00Z' },
    });
    expect(lines).toEqual([
      'Status: espelho —, Pagar.me Ativo',
      'Período: espelho —, Pagar.me 03/10/2027',
    ]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run:
```bash
npx vitest run apps/admin/src/pages/__tests__/workspace-subscription.test.ts
```
Expected: FAIL, cannot resolve `../workspace-subscription`.

- [ ] **Step 3: Write the module**

Create `apps/admin/src/pages/workspace-subscription.ts`:

```ts
/**
 * Pure formatters for the Pagar.me block of the workspace detail's subscription card.
 * No JSX and no data fetching, so they are unit-tested without rendering the page
 * (same pattern as plan-form.ts and workspace-events.ts).
 */
import { statusMeta, type PagarmeDrift, type PagarmeLiveCard } from '../lib/subscription';

/** ISO timestamp → "dd/MM/yyyy" (pt-BR). "—" for null, empty or unparsable input. */
export function formatDay(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1).toLowerCase();
}

/** "visa" + "4242" + 12/2028 → "Visa •••• 4242 · 12/28". Missing parts are dropped; nothing → "—". */
export function formatCard(card: PagarmeLiveCard | null | undefined): string {
  if (!card) return '—';
  const head: string[] = [];
  const brand = card.brand?.trim();
  if (brand) head.push(capitalize(brand));
  if (card.last4) head.push(`•••• ${card.last4}`);
  const expiry =
    card.exp_month != null && card.exp_year != null
      ? `${String(card.exp_month).padStart(2, '0')}/${String(card.exp_year).slice(-2)}`
      : null;
  const parts = [head.join(' '), expiry].filter((p): p is string => !!p);
  return parts.length ? parts.join(' · ') : '—';
}

/** One line per divergent field between the mirror and the live read; empty when in sync. */
export function describeDrift(drift: PagarmeDrift | null | undefined): string[] {
  if (!drift) return [];
  const lines: string[] = [];
  if (drift.status) {
    lines.push(
      `Status: espelho ${statusMeta(drift.status.mirror).label}, Pagar.me ${statusMeta(drift.status.live).label}`,
    );
  }
  if (drift.period) {
    lines.push(
      `Período: espelho ${formatDay(drift.period.mirror)}, Pagar.me ${formatDay(drift.period.live)}`,
    );
  }
  return lines;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run:
```bash
npx vitest run apps/admin/src/pages/__tests__/workspace-subscription.test.ts
```
Expected: PASS (13 tests).

- [ ] **Step 5: Format and commit**

```bash
npx prettier --write apps/admin/src/pages/workspace-subscription.ts apps/admin/src/pages/__tests__/workspace-subscription.test.ts
git add apps/admin/src/pages/workspace-subscription.ts apps/admin/src/pages/__tests__/workspace-subscription.test.ts
git commit -m "feat(admin): formatadores do bloco Pagar.me (cartão, data, divergência)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 6: Workspace detail card (link, fields, notes, copy)

**Files:**
- Modify: `apps/admin/src/pages/WorkspaceDetailPage.tsx` (imports lines 6-13; subscription card lines ~250-340; new subcomponent at the bottom next to `Field`)

**Interfaces:**
- Consumes (Task 4): `providerLabel`, `SubscriptionInfo`; (Task 5): `formatCard`, `formatDay`, `describeDrift`.
- Produces: nothing consumed elsewhere.

No unit test renders this page today (it is driven by TanStack Query against the edge function); the behaviour is covered by the Deno tests (Task 2) and the formatter tests (Task 5). Verification here is typecheck + lint, then the browser pass in Task 8.

- [ ] **Step 1: Update the imports**

Replace the `../lib/subscription` import block with:

```ts
import {
  statusMeta,
  toneBadgeClass,
  hasSubscription,
  intervalLabel,
  intervalSuffix,
  formatMoney,
  providerLabel,
  type SubscriptionInfo,
} from '../lib/subscription';
```

and add, after the `computeOverridesPayload` import:

```ts
import { describeDrift, formatCard, formatDay } from './workspace-subscription';
```

- [ ] **Step 2: Add the Pagar.me link in the card header**

Right after the existing `{data.subscription?.stripe_dashboard_url && ( ... )}` block (the one rendering "Abrir no Stripe"), add:

```tsx
          {data.subscription?.pagarme_dashboard_url && (
            <a
              href={sanitizeExternalUrl(data.subscription.pagarme_dashboard_url)}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex shrink-0 items-center gap-1 text-sm text-primary hover:underline"
            >
              Abrir no Pagar.me <ExternalLink size={14} />
            </a>
          )}
```

- [ ] **Step 3: Add the two live fields to the grid**

Right after the `{data.subscription.failed_payment_count > 0 && ( <Field label="Pagamentos falhos"> ... )}` block, still inside the `grid` div, add:

```tsx
              {data.subscription.provider === 'pagarme' && data.subscription.pagarme_live && (
                <>
                  <Field label="Cartão">
                    <span className="text-sm">
                      {formatCard(data.subscription.pagarme_live.card)}
                    </span>
                  </Field>
                  <Field label="Próxima cobrança">
                    <span className="text-sm">
                      {formatDay(data.subscription.pagarme_live.next_billing_at)}
                    </span>
                  </Field>
                </>
              )}
```

- [ ] **Step 4: Add the drift and error notes, and fix the copy**

Right after the closing `</div>` of the grid (before the `{data.workspace.plan_source === 'manual' && (` block), add:

```tsx
            {data.subscription.provider === 'pagarme' && (
              <PagarmeLiveNotes subscription={data.subscription} />
            )}
```

Change the comp note text from:

```tsx
                O plano efetivo foi ajustado manualmente (comp). Os dados acima refletem a
                assinatura real do cliente no Stripe.
```

to:

```tsx
                O plano efetivo foi ajustado manualmente (comp). Os dados acima refletem a
                assinatura real do cliente no {providerLabel(data.subscription.provider)}.
```

Change `Sem assinatura Stripe.` to `Sem assinatura.`

- [ ] **Step 5: Add the notes subcomponent**

Right above `function Field(...)` at the bottom of the file, add:

```tsx
/** Drift warning + live-read failure note for a Pagar.me subscription (display only). */
function PagarmeLiveNotes({ subscription }: { subscription: SubscriptionInfo }) {
  const lines = describeDrift(subscription.pagarme_live?.drift);
  return (
    <>
      {lines.length > 0 && (
        <div className="mt-4 rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-xs text-warning">
          <div className="font-semibold">Espelho desatualizado</div>
          <ul className="mt-1 list-disc pl-4">
            {lines.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </div>
      )}
      {subscription.pagarme_live_error && (
        <p className="mt-4 text-xs text-muted-foreground">
          Sem resposta do Pagar.me, exibindo o espelho local.
        </p>
      )}
    </>
  );
}
```

- [ ] **Step 6: Typecheck, lint, format**

```bash
npx tsc -p apps/admin/tsconfig.json --noEmit
npx eslint apps/admin/src/pages/WorkspaceDetailPage.tsx
npx prettier --write apps/admin/src/pages/WorkspaceDetailPage.tsx
```
Expected: no errors from tsc or eslint.

- [ ] **Step 7: Commit**

```bash
git add apps/admin/src/pages/WorkspaceDetailPage.tsx
git commit -m "feat(admin): link, cartão, próxima cobrança e aviso de divergência na assinatura Pagar.me

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 7: Provider caption in the Workspaces list + "Provedor" CSV column

**Files:**
- Modify: `apps/admin/src/pages/workspaces/WorkspacesTable.tsx` (import line 4; `SubscriptionCell` ~line 55)
- Modify: `apps/admin/src/pages/__tests__/WorkspacesTable.test.tsx` (fixture + new test)
- Modify: `apps/admin/src/pages/workspaces-export.ts`
- Modify: `apps/admin/src/pages/__tests__/workspaces-export.test.ts` (fixtures + new tests)

**Interfaces:**
- Consumes (Task 4): `providerLabel`, `SubscriptionSummary.provider`.
- Produces: CSV column `{ key: 'provider', label: 'Provedor' }` placed right after `subscription_status`.

- [ ] **Step 1: Write the failing table test**

In `apps/admin/src/pages/__tests__/WorkspacesTable.test.tsx`, add `provider: 'stripe',` after `failed_payment_count: 3,` in the `ws()` fixture. Then add inside `describe('WorkspacesTable', ...)`:

```tsx
  it('captions the subscription cell with the billing provider', () => {
    renderTable({
      workspaces: [
        ws({
          subscription: {
            status: 'active',
            plan_name: 'Max',
            billing_interval: 'year',
            amount_cents: 113880,
            currency: 'brl',
            interval: 'year',
            discount_label: null,
            failed_payment_count: 0,
            current_period_end: '2027-10-03T00:00:00Z',
            provider: 'pagarme',
          },
        }),
      ],
      visible: ['name', 'subscription'],
    });
    expect(screen.getByText('Pagar.me')).toBeInTheDocument();
  });

  it('shows no provider caption when the payload predates the provider key', () => {
    renderTable({
      workspaces: [
        ws({
          subscription: {
            status: 'active',
            plan_name: 'Max',
            billing_interval: 'month',
            amount_cents: 19700,
            currency: 'brl',
            interval: 'month',
            discount_label: null,
            failed_payment_count: 0,
            current_period_end: null,
            provider: null,
          },
        }),
      ],
      visible: ['name', 'subscription'],
    });
    expect(screen.queryByText('Stripe')).toBeNull();
    expect(screen.queryByText('Pagar.me')).toBeNull();
  });
```

- [ ] **Step 2: Write the failing export tests**

In `apps/admin/src/pages/__tests__/workspaces-export.test.ts`, add `provider: 'stripe',` after every `failed_payment_count: 0,` line (the `baseWorkspace` fixture and the four inline `subscription: { ... }` literals). Then add inside `describe('buildWorkspaceExportRows', ...)`:

```ts
  it('exports the billing provider label', () => {
    const rows = buildWorkspaceExportRows([baseWorkspace()]);
    expect(rows[0].provider).toBe('Stripe');
  });

  it('labels a Pagar.me subscription as Pagar.me', () => {
    const rows = buildWorkspaceExportRows([
      baseWorkspace({
        subscription: {
          status: 'active',
          plan_name: 'Max',
          billing_interval: 'year',
          amount_cents: 113880,
          currency: 'brl',
          interval: 'year',
          discount_label: null,
          failed_payment_count: 0,
          current_period_end: null,
          provider: 'pagarme',
        },
      }),
    ]);
    expect(rows[0].provider).toBe('Pagar.me');
  });

  it('blanks the provider when the payload has none or there is no subscription', () => {
    const noProvider = buildWorkspaceExportRows([
      baseWorkspace({
        subscription: {
          status: 'active',
          plan_name: 'Pro',
          billing_interval: 'month',
          amount_cents: 9900,
          currency: 'brl',
          interval: 'month',
          discount_label: null,
          failed_payment_count: 0,
          current_period_end: null,
          provider: null,
        },
      }),
    ]);
    expect(noProvider[0].provider).toBe('');
    const noSub = buildWorkspaceExportRows([baseWorkspace({ subscription: null })]);
    expect(noSub[0].provider).toBe('');
  });
```

- [ ] **Step 3: Run both test files to verify they fail**

Run:
```bash
npx vitest run apps/admin/src/pages/__tests__/WorkspacesTable.test.tsx apps/admin/src/pages/__tests__/workspaces-export.test.ts
```
Expected: the caption test FAILS (`Unable to find an element with the text: Pagar.me`); the provider export tests FAIL (`expected undefined to be 'Stripe'`).

- [ ] **Step 4: Implement the caption**

In `apps/admin/src/pages/workspaces/WorkspacesTable.tsx`:

Change the import on line 4 to:

```ts
import {
  formatMoney,
  hasSubscription,
  intervalSuffix,
  providerLabel,
  statusMeta,
} from '../../lib/subscription';
```

Replace `SubscriptionCell` with:

```tsx
function SubscriptionCell({ ws }: { ws: WorkspaceSummary }) {
  if (!hasSubscription(ws.subscription)) return <span className="text-dim-foreground">—</span>;
  const meta = statusMeta(ws.subscription.status);
  return (
    <span className="flex min-w-0 items-center gap-2">
      <Badge variant={STATUS_VARIANT[meta.tone]}>{meta.label}</Badge>
      <span className="whitespace-nowrap text-xs text-muted-foreground">
        {formatMoney(ws.subscription.amount_cents, ws.subscription.currency)}
        {intervalSuffix(ws.subscription.interval)}
      </span>
      {ws.subscription.provider && (
        <span className="whitespace-nowrap text-[0.65rem] uppercase tracking-wider text-dim-foreground">
          {providerLabel(ws.subscription.provider)}
        </span>
      )}
    </span>
  );
}
```

- [ ] **Step 5: Implement the CSV column**

In `apps/admin/src/pages/workspaces-export.ts`:

Change the import to `import { statusMeta, hasSubscription, providerLabel } from '../lib/subscription';`

In `WORKSPACE_EXPORT_COLUMNS`, insert right after `{ key: 'subscription_status', label: 'Status da assinatura' },`:

```ts
  { key: 'provider', label: 'Provedor' },
```

In `buildWorkspaceExportRows`, insert right after `subscription_status: ...,`:

```ts
      provider: hasSub && sub.provider ? providerLabel(sub.provider) : '',
```

- [ ] **Step 6: Run the tests to verify they pass**

Run:
```bash
npx vitest run apps/admin/src/pages/__tests__/WorkspacesTable.test.tsx apps/admin/src/pages/__tests__/workspaces-export.test.ts
```
Expected: PASS.

- [ ] **Step 7: Typecheck, format, commit**

```bash
npx tsc -p apps/admin/tsconfig.json --noEmit
npx prettier --write apps/admin/src/pages/workspaces/WorkspacesTable.tsx apps/admin/src/pages/workspaces-export.ts apps/admin/src/pages/__tests__/WorkspacesTable.test.tsx apps/admin/src/pages/__tests__/workspaces-export.test.ts
git add apps/admin/src/pages/workspaces/WorkspacesTable.tsx apps/admin/src/pages/workspaces-export.ts apps/admin/src/pages/__tests__/WorkspacesTable.test.tsx apps/admin/src/pages/__tests__/workspaces-export.test.ts
git commit -m "feat(admin): legenda do provedor na lista de Workspaces e coluna Provedor no CSV

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 8: Docs, full verification, staging rollout and browser check

**Files:**
- Modify: `CLAUDE.md` (env var block, after the `PAGARME_WEBHOOK_BASIC` entry, ~line 179)
- Modify: `.env.example` (Pagar.me block, after `PAGARME_WEBHOOK_BASIC=...`, ~line 83)

**Interfaces:** none.

- [ ] **Step 1: Document the env var**

In `CLAUDE.md`, right after the `PAGARME_WEBHOOK_BASIC` bullet (the one ending in `throws at module load`), add:

```markdown
- `PAGARME_DASHBOARD_BASE` -- Pagar.me dashboard prefix up to the account, e.g.
  `https://dash.pagar.me/merch_xxx/acc_yyy`. platform-admin appends
  `/subscriptions/{id}/info` to build the "Abrir no Pagar.me" link on the workspace
  detail. Optional, no default: unset or not `https://` means no link (everything else
  still works). Differs per environment (live account in prod, sandbox account in staging)
```

In `.env.example`, right after the line `PAGARME_WEBHOOK_BASIC=usuario:senha-do-toggle-do-dashboard`, add:

```bash
# Pagar.me dashboard prefix up to the account (platform-admin builds the "Abrir no Pagar.me"
# link from it). Optional: unset = no link. Differs per environment (live vs sandbox account).
PAGARME_DASHBOARD_BASE=https://dash.pagar.me/merch_xxx/acc_yyy
```

`.env.e2e.local.example` stays untouched (the variable plays no part in E2E).

- [ ] **Step 2: Run the full local gate (what CI runs)**

```bash
npm run lint
npm run format:check
npx tsc -p apps/crm/tsconfig.json --noEmit
npx tsc -p apps/hub/tsconfig.json --noEmit
npx tsc -p apps/admin/tsconfig.json --noEmit
npx tsc -p tsconfig.scripts.json
npm run test
npm run test:functions
npm run check:functions
git checkout deno.lock
ls supabase/migrations | cut -d_ -f1 | sort | uniq -d
```
Expected: every command exits 0; the last prints nothing. If `npm run format:check` fails, run `npm run format` and re-run. If `ls node_modules/.deno` shows a directory after `test:functions`, run `npm ci` before trusting `npm run test` again (memory: deno runs pollute node_modules).

- [ ] **Step 3: Commit the docs**

```bash
git add CLAUDE.md .env.example
git commit -m "docs: documenta PAGARME_DASHBOARD_BASE

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

- [ ] **Step 4: Staging rollout (reversible; staging only)**

Project refs (memory): staging = `wlyzhyfondykzpsiqsce`. Check the link state first; do not rely on it:

```bash
cat supabase/.temp/project-ref 2>/dev/null || echo "unlinked"
```

4a. Push the migration to staging (the `--linked` form refuses when other unapplied migrations exist there; use the explicit ref and, if it still refuses because of foreign pending migrations, follow `reference_staging_ops_management_api.md` for the out-of-band apply):

```bash
npx supabase db push --project-ref wlyzhyfondykzpsiqsce
```

4b. Set the secret from a file, never as a literal argument. Ask the user for the staging (sandbox) dashboard base; write it to a temp file in the scratchpad and:

```bash
npx supabase secrets set --project-ref wlyzhyfondykzpsiqsce --env-file /private/tmp/claude-501/-Users-eduardosouza-Projects-sm-crm--claude-worktrees-pagar-me-admin-integration-83c14f/8a47280d-0204-4a43-a748-40d8bf550530/scratchpad/pagarme-dashboard.env
```
where the file contains exactly one line: `PAGARME_DASHBOARD_BASE=https://dash.pagar.me/merch_.../acc_...`. Delete the file afterwards.

4c. Deploy the two functions that bundle `workspace-detail.ts`:

```bash
npx supabase functions deploy platform-admin --project-ref wlyzhyfondykzpsiqsce --no-verify-jwt --use-api
npx supabase functions deploy mcp-admin --project-ref wlyzhyfondykzpsiqsce --no-verify-jwt --use-api
```

- [ ] **Step 5: Browser verification against staging**

The worktree has no `.env.staging` (memory: worktrees start unlinked and `:staging` would hit PROD). Copy it from the main checkout without committing it:

```bash
cp /Users/eduardosouza/Projects/sm-crm/.env.staging .env.staging
git status --short   # .env.staging must NOT appear (it is gitignored); if it does, stop.
```

Then start the Admin against staging with the Browser pane: `preview_start` with `name: "admin-staging"` (already defined in the tracked `.claude/launch.json`: `npm run dev:admin:staging`, port 5178 with auto-port). Log in with the seed admin (memory: `reference_seed_login_browser_verification.md`: credentials come from `SEED_EMAIL`/`SEED_PASSWORD` in `.env.staging`, injected via a node script into localStorage; never typed into chat), and check:

1. Workspaces list: a Pagar.me workspace shows the "Pagar.me" caption after the amount; a Stripe one shows "Stripe"; `read_page` confirms both strings.
2. Open the Pagar.me workspace: header shows "Abrir no Pagar.me"; the href (via `read_page`) equals `<base>/subscriptions/<sub_id>/info`; "Cartão" shows **real values** (`•••• <last4> · MM/AA` of a sandbox test card, with or without a brand) and "Próxima cobrança" shows a **real date**; no "Espelho desatualizado" note for a healthy row. Check both an `active` (already charged) and a `future` (trial) sandbox subscription if both exist. **If "Cartão" or "Próxima cobrança" renders "—" on an active or trialing subscription, the response shape differs from the plan's assumption: STOP, fetch the raw object once with `curl -u "$PAGARME_SECRET_KEY:" https://api.pagar.me/core/v5/subscriptions/<sub_id>` (key read from the sandbox secret via a file, never pasted on the command line), fix `mapCard` in `pagarme-detail.ts` plus its tests, redeploy, and re-check before continuing.**
3. `read_console_messages` and `read_network_requests` for the `platform-admin` call: 200, no errors.
4. CSV export of the list includes the "Provedor" column (trigger the export and check the network response body or the downloaded text).
5. Failure path: temporarily unset the secret in staging (`npx supabase secrets unset PAGARME_DASHBOARD_BASE --project-ref wlyzhyfondykzpsiqsce`), reload the detail page, confirm the link is gone and the page still renders; then set it again with 4b.

Take a screenshot of the detail card for the PR description.

- [ ] **Step 6: Open the PR**

Re-verify the migration prefix right before pushing:

```bash
git fetch origin main
git ls-tree --name-only origin/main:supabase/migrations | tail -3
```
If anything ≥ `20260910000001` landed, rename the migration and the test-suite reference to a higher prefix (also update the comment inside `subscription.ts` that names the migration) and amend the Task 3 commit.

```bash
git push -u origin claude/pagar-me-admin-integration-83c14f
gh pr create --base main --title "feat(admin): paridade Pagar.me x Stripe no Admin (link, leitura ao vivo, provedor na lista)" --body-file /private/tmp/claude-501/-Users-eduardosouza-Projects-sm-crm--claude-worktrees-pagar-me-admin-integration-83c14f/8a47280d-0204-4a43-a748-40d8bf550530/scratchpad/pr-body.md
```

The PR body must list the **prod rollout order** as a checklist the user runs before merging (spec §8), because merging deploys the frontend immediately:

1. `npx supabase db push --project-ref skjzpekeqefvlojenfsw` (prod migration).
2. `PAGARME_DASHBOARD_BASE` set in prod from a file (live account base: `https://dash.pagar.me/merch_pv13W5kwigIKJX8b/acc_4AYdz4NIRHgey7Nk`).
3. Deploy `platform-admin` and `mcp-admin` to prod with `--no-verify-jwt --use-api`.
4. Merge.

End the body with `🤖 Generated with [Claude Code](https://claude.com/claude-code)`. The external Codex review fires on `gh pr create`; read the body of its comment (not just its presence) and verify each finding against the code before acting.
