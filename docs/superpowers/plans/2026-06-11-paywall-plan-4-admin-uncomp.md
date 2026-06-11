# Paywall Plan 4 — Admin Un-comp & Dual-write Cleanup

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let admins escape the sticky `plan_source='manual'` (an "un-comp" action that returns a workspace to Stripe-driven billing), and stop dual-writing the deprecated `workspace_plan_overrides.plan_id`.

**Architecture:** A pure `revertPlanTarget(sub, defaultPlanId)` decides the post-comp state — `stripe` + the subscription's plan if an active subscription exists, else `system` + the default plan. A new `unset-workspace-plan` platform-admin action applies it and clears granular overrides. `handleSetWorkspacePlan` stops writing the deprecated override `plan_id` (the resolver reads `workspaces.plan_id`). The admin app gets a "Remover comp" button.

**Tech Stack:** Deno (platform-admin), React (admin app). Tests: Deno for the pure helper.

**Depends on:** money-in slice (`workspace_subscriptions`, `workspaces.plan_source`). Standalone otherwise.

**Spec:** `docs/superpowers/specs/2026-06-11-paywall-feature-gating-design.md` (§6.3, decision 9).

---

## File Structure

- Create: `supabase/functions/platform-admin/revert-target.ts`
- Create: `supabase/functions/__tests__/revert-target_test.ts`
- Modify: `supabase/functions/platform-admin/index.ts` (new handler + switch case + stop dual-write + get-workspace returns plan_source)
- Modify: `apps/admin/src/lib/api.ts`, `apps/admin/src/pages/WorkspaceDetailPage.tsx`

---

## Task 1: `revertPlanTarget` pure helper

**Files:**
- Create: `supabase/functions/platform-admin/revert-target.ts`
- Create: `supabase/functions/__tests__/revert-target_test.ts`

- [ ] **Step 1: Write the failing test**

Create `supabase/functions/__tests__/revert-target_test.ts`:

```ts
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { revertPlanTarget } from "../platform-admin/revert-target.ts";

Deno.test("active subscription => revert to stripe + sub plan", () => {
  assertEquals(
    revertPlanTarget({ status: "active", plan_id: "pro" }, "free"),
    { plan_source: "stripe", plan_id: "pro" });
  assertEquals(
    revertPlanTarget({ status: "trialing", plan_id: "max" }, "free"),
    { plan_source: "stripe", plan_id: "max" });
});

Deno.test("no/inactive subscription => revert to system + default plan", () => {
  assertEquals(revertPlanTarget(null, "free"), { plan_source: "system", plan_id: "free" });
  assertEquals(
    revertPlanTarget({ status: "canceled", plan_id: "pro" }, "free"),
    { plan_source: "system", plan_id: "free" });
  assertEquals(
    revertPlanTarget({ status: "active", plan_id: null }, "free"),
    { plan_source: "system", plan_id: "free" });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `deno test --no-check --allow-env --allow-read --allow-net supabase/functions/__tests__/revert-target_test.ts`
Expected: FAIL — cannot find `../platform-admin/revert-target.ts`.

- [ ] **Step 3: Implement the helper**

Create `supabase/functions/platform-admin/revert-target.ts`:

```ts
/**
 * Decides the workspace state when un-comping (clearing plan_source='manual').
 * If an active Stripe subscription exists, hand control back to it; otherwise
 * fall back to the default (free) plan as an unmanaged 'system' workspace.
 */
export function revertPlanTarget(
  sub: { status?: string | null; plan_id?: string | null } | null,
  defaultPlanId: string,
): { plan_source: "stripe" | "system"; plan_id: string } {
  if (sub && (sub.status === "active" || sub.status === "trialing") && sub.plan_id) {
    return { plan_source: "stripe", plan_id: sub.plan_id };
  }
  return { plan_source: "system", plan_id: defaultPlanId };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `deno test --no-check --allow-env --allow-read --allow-net supabase/functions/__tests__/revert-target_test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/platform-admin/revert-target.ts supabase/functions/__tests__/revert-target_test.ts
git commit -m "feat(paywall): revertPlanTarget helper for admin un-comp"
```

---

## Task 2: `unset-workspace-plan` handler + stop dual-write

**Files:**
- Modify: `supabase/functions/platform-admin/index.ts`

- [ ] **Step 1: Add the handler**

In `supabase/functions/platform-admin/index.ts`, import the helper and add `handleUnsetWorkspacePlan` (near `handleSetWorkspacePlan`, ~line 520):

```ts
import { revertPlanTarget } from "./revert-target.ts";

async function handleUnsetWorkspacePlan(
  svc: ReturnType<typeof createClient>,
  body: { workspace_id: string },
  adminId: string,
  headers: Record<string, string>,
) {
  const { workspace_id } = body;
  if (!workspace_id) {
    return new Response(JSON.stringify({ error: "workspace_id is required" }), { status: 400, headers });
  }

  const { data: sub } = await svc
    .from("workspace_subscriptions").select("status, plan_id")
    .eq("workspace_id", workspace_id).maybeSingle();
  const { data: def } = await svc.from("plans").select("id").eq("is_default", true).maybeSingle();
  const target = revertPlanTarget(sub as { status?: string; plan_id?: string } | null, (def?.id as string) ?? "free");

  const { error: wErr } = await svc.from("workspaces")
    .update({ plan_id: target.plan_id, plan_source: target.plan_source }).eq("id", workspace_id);
  if (wErr) throw wErr;

  // clear any manual granular overrides left from the comp
  await svc.from("workspace_plan_overrides")
    .update({ resource_overrides: null, feature_overrides: null, notes: null,
      updated_by: adminId, updated_at: new Date().toISOString() })
    .eq("workspace_id", workspace_id);

  return new Response(JSON.stringify({ message: "Comp removed", plan_source: target.plan_source }),
    { status: 200, headers });
}
```

- [ ] **Step 2: Wire the switch case**

In the action switch (~line 100, next to `set-workspace-plan`), add:

```ts
      case "unset-workspace-plan":
        return await handleUnsetWorkspacePlan(svc, body, admin.id, headers);
```

- [ ] **Step 3: Stop dual-writing the deprecated `plan_id` in `handleSetWorkspacePlan`**

In `handleSetWorkspacePlan` (lines 499-516), remove `plan_id` from the override-row writes (the resolver reads `workspaces.plan_id`). The update branch becomes:

```ts
  if (existing) {
    const { error } = await svc
      .from("workspace_plan_overrides")
      .update({
        resource_overrides: null,
        feature_overrides: null,
        notes: null,
        updated_by: adminId,
        updated_at: new Date().toISOString(),
      })
      .eq("workspace_id", workspace_id);
    if (error) throw error;
  } else {
    const { error } = await svc
      .from("workspace_plan_overrides")
      .insert({ workspace_id, updated_by: adminId });
    if (error) throw error;
  }
```

(The `workspaces.update({ plan_id, plan_source: "manual" })` at lines 487-491 is unchanged — that's the source of truth.)

- [ ] **Step 4: Ensure `get-workspace` returns `plan_source`**

In `handleGetWorkspace` (the workspace select ~line 254 currently `select("id, name, logo_url, created_at, plan_id")`), add `plan_source` so the admin UI can show the un-comp button conditionally:

```ts
    .select("id, name, logo_url, created_at, plan_id, plan_source")
```

- [ ] **Step 5: Typecheck + commit**

Run: `deno check supabase/functions/platform-admin/index.ts`
Expected: no type errors.

```bash
git add supabase/functions/platform-admin/index.ts
git commit -m "feat(paywall): platform-admin unset-workspace-plan + stop deprecated plan_id dual-write"
```

---

## Task 3: Admin app — un-comp button

**Files:**
- Modify: `apps/admin/src/lib/api.ts`, `apps/admin/src/pages/WorkspaceDetailPage.tsx`

- [ ] **Step 1: Add the API function**

In `apps/admin/src/lib/api.ts`, next to `setWorkspacePlan` (line ~265):

```ts
export function unsetWorkspacePlan(workspace_id: string) {
  return adminApi<{ message: string; plan_source: string }>('unset-workspace-plan', { workspace_id });
}
```

If the `Workspace` type used by `get-workspace` doesn't include `plan_source`, add `plan_source?: string;` to it.

- [ ] **Step 2: Add the mutation + button**

In `apps/admin/src/pages/WorkspaceDetailPage.tsx`, add a mutation alongside `setPlanMutation` (line ~66):

```tsx
import { unsetWorkspacePlan } from '../lib/api';

const unsetMutation = useMutation({
  mutationFn: () => unsetWorkspacePlan(id!),
  onSuccess: () => {
    queryClient.invalidateQueries({ queryKey: ['admin', 'workspace', id] });
    toast.success('Comp removido — workspace volta à cobrança normal');
  },
  onError: (err: Error) => toast.error(err.message),
});
```

And render the button next to the plan selector (after line ~172), only when the workspace is comped:

```tsx
{workspace?.plan_source === 'manual' && (
  <button
    type="button"
    onClick={() => unsetMutation.mutate()}
    disabled={unsetMutation.isPending}
    className="mt-2 text-sm underline text-muted-foreground hover:text-foreground"
  >
    Remover comp (voltar à cobrança)
  </button>
)}
```

(`workspace` is the `get-workspace` result already loaded on this page; confirm the variable name in scope and that it now carries `plan_source` from Task 2 Step 4.)

- [ ] **Step 3: Typecheck the admin app**

Run: `npm run build -w apps/admin` (or the admin build script in `package.json`).
Expected: build succeeds.

- [ ] **Step 4: Commit**

```bash
git add apps/admin/src/lib/api.ts apps/admin/src/pages/WorkspaceDetailPage.tsx
git commit -m "feat(paywall): admin un-comp button (revert plan_source)"
```

---

## Final verification

- [ ] Deno: `deno test --no-check --allow-env --allow-read --allow-net supabase/functions/__tests__/revert-target_test.ts` → PASS. `deno check supabase/functions/platform-admin/index.ts` → clean. Then `git checkout deno.lock && npm ci` if needed.
- [ ] Admin build: `npm run build -w apps/admin` → succeeds.
- [ ] Manual (local Supabase): comp a workspace to `max` (`set-workspace-plan`) → it shows `plan_source='manual'`; click "Remover comp" → with no active subscription it reverts to `system`/free; with an active subscription it reverts to `stripe` and the subscription's plan. Confirm `set-workspace-plan` no longer writes `workspace_plan_overrides.plan_id`.

## Self-review notes

- **Spec coverage (§6.3, decision 9):** un-comp action with stripe/system revert logic (T1–T2), stop deprecated dual-write (T2 Step 3), admin UI (T3).
- **Type consistency:** `revertPlanTarget(sub, defaultPlanId)` return `{ plan_source, plan_id }` is consumed unchanged by `handleUnsetWorkspacePlan`. `unsetWorkspacePlan` action string `'unset-workspace-plan'` matches the switch case.
- **Pin:** confirm `WorkspaceDetailPage`'s workspace query variable name and that `get-workspace` exposes `plan_source` after Task 2 Step 4.
