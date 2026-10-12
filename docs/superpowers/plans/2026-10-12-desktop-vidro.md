# Desktop Vidro (level 3) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** a macOS-style glass desktop shell for the CRM (≥1101px) behind the workspace flag
`feature_crm_vidro`. With the flag off, the app is pixel-identical to today.

**Architecture:**
- A workspace entitlement plus a per-user opt-out decide the look. A pre-paint cache in `localStorage`
  avoids a flash.
- `AppLayout` swaps the top bar for:
  - a glass sidebar header with search;
  - a rounded panel holding a page toolbar that pages fill through `usePageToolbar()`. This is a
    `useSyncExternalStore` store, not React state.
- Notifications and support chat move into a shell capsule.
- Content restyling lives in one guarded stylesheet, `vidro.css`.

**Tech Stack:** React 19, React Router v7, TanStack Query, Vitest + Testing Library, postcss, Supabase
(Postgres migration, Deno edge function shared module), Admin app (Vite/React).

**Spec:** `docs/superpowers/specs/2026-10-12-desktop-vidro-design.md`. Read it before any task. The
plan argues from it.

## Global Constraints

- **Flag read:** the CRM reads the flag only as `features?.feature_crm_vidro === true`. Never use
  `hasFeature`.
- **Flag off:** pixel-identical markup and CSS at every width. Every new attribute, class or prop
  defaults to today's output.
- **Scope:** vidro applies at ≥1101px only. The width source is AppLayout's existing
  `sidebarCollapsible` (`!isTablet && !isMobile`), exposed as `vidroShell`. Nothing else computes the
  breakpoint.
- **`apps/crm/src/styles/vidro.css`:**
  - imported only from `apps/crm/src/main.tsx`, after `import '../style.css'`;
  - every selector starts with `html[data-look='vidro']`;
  - every rule sits inside `@media (min-width: 1101px)`, except one `@media print` block whose
    selectors carry `body:has(.analytics-fluxos-page)`;
  - no `@layer`, no `!important`.
- **`style.css`:** never edited by this plan.
- **Storage keys:** `look-vidro` (cache; its value is the user id it was resolved for) and
  `look-optout:<userId>` (`'1'`). Every storage access is wrapped in try/catch.
- **Copy:** Portuguese UI. No em-dashes in user-facing copy (use a period or a colon). Labels: "Visual
  clássico" / "Visual novo"; Admin label "Visual vidro (CRM desktop)".
- **Tokens:** values are copied verbatim from the spec's token table (the `vidro.css` code in Task 5
  holds them).
- **Icons:** `lucide-react` in new TSX. Phosphor `ph` classes only where the surrounding code already
  uses them (Sidebar).
- **Migration version:** `20261017000001`. Before the PR, re-check that it is above main's tail.
- **Commits:** end every commit message with
  `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- **Lanes.** Each task runs in its own nested worktree (the dispatch gives the literal path and branch;
  the controller creates it from the integrated feature branch and symlinks `node_modules` and
  `packages/import-parsers/node_modules`). Start **every** shell command with `cd <lane path> &&`, and
  before the first edit check `pwd` and `git branch --show-current`. Commit only in your lane. The
  controller cherry-picks reviewed lanes onto `claude/desktop-ios-macos-previews-ce1e35`.
- **Scoped checks.** Run only the test files your task names, and `npx eslint <your files>`.
  `npx tsc -p apps/crm/tsconfig.json --noEmit` in your lane is fine (it sees only your lane). Repo-wide
  `npm run lint`, `npm run test` and the four `tsc` projects run in T14 on the integrated branch.
  Failures that trace to `node_modules/.deno` pollution are environmental; report, do not "fix".

## Review Focus

1. **Identity changes by any path** (another user signs in, signs up, opens a recovery link, a second
   tab signs in) or a workspace switch to an unflagged workspace. The next load must not pre-paint the
   previous user's or workspace's look. Test: Task 2 pre-paint cases (match, mismatch, no session,
   malformed session); Task 6 Step 1 (the switch clears the cache).
2. **`workspace-limits` fails** (offline, 5xx), including a background refetch after a success. The
   shell must not flip mid-session (a flip remounts the page subtree and loses unsaved state), and the
   cache must survive. Test: Task 6 `useVidro` "keeps vidro when a later refetch fails".
3. **A page re-renders often** (Entregas live counts, a typing filter). The toolbar must update without
   re-rendering AppLayout or looping. Test: Task 3 render-count test.
4. **Window resized across 1101px** with the flag on. The shell swaps cleanly, and the Crisp listeners
   are not registered twice. Test: Task 4 "registers once across mounts"; Task 6 AppLayout tablet test.
5. **A tour (Entregas "Ver tour novamente", Automações onboarding) runs with vidro on.** Exactly one
   `data-tour` anchor exists. Test: Task 11 and Task 9 page tests.

## Execution waves (subagent swarm)

Tasks in the same wave touch **disjoint files** and run in parallel. Each implementer commits only its
own files.

| Wave | Tasks | Depends on |
|---|---|---|
| 1 | T1 flag plumbing · T2 look module + pre-paint + cache clearing · T3 page toolbar store + component · T4 support chat store + capsule variant · T5 `vidro.css` + `data-slot` hooks | none |
| 2 | T6 shell integration (AppLayout, Sidebar, `useVidro`, search variant, i18n) · T7-T13 page migrations | T6 needs T1-T5; T7-T13 need T3 only |
| 3 | T14 verification: browser checks, pre-paint matrix, flag-off parity, gates, PR | all |

Wave 2 lanes are cut from the feature branch after T1-T5 are cherry-picked, so every Wave 2 task sees
all Wave 1 interfaces.

**Shared-file rule:** only T6 edits `AppLayout.tsx`, `Sidebar.tsx`, `GlobalSearchTrigger.tsx` and the
i18n JSON. Only T5 edits `vidro.css`; later CSS fixes found in T14 go to `vidro.css` in T14. Only T2
edits `lib/supabase.ts`, `lib/analytics.ts` and `index.html`.

---

### Task 1: Flag plumbing (`feature_crm_vidro`)

**Files:**
- Create: `supabase/migrations/20261017000001_feature_crm_vidro.sql`
- Create: `supabase/tests/entitlements/99_crm_vidro_flag.sql`
- Create: `supabase/functions/__tests__/entitlements_feature_crm_vidro_test.ts`
- Modify: `supabase/functions/_shared/entitlements.ts:13-23` (`FEATURE_COLUMNS`)
- Modify: `apps/admin/src/lib/api.ts` (`Plan` type ~:112, `FEATURE_FLAG_KEYS` ~:234-262,
  `FEATURE_FLAG_LABELS` ~:264-292)
- Modify: `apps/admin/src/lib/__tests__/featureFlags.test.ts`,
  `apps/admin/src/pages/__tests__/plan-form.test.ts:62`
- Modify: `apps/crm/src/hooks/useWorkspaceLimits.ts` (`FeatureFlags` ~:24-60, return value ~:100-107)

**Interfaces:**
- Produces:
  - `FeatureFlags.feature_crm_vidro?: boolean`;
  - `useWorkspaceLimits()` additionally returns `isSuccess: boolean` (true when the current key's query
    has data).

- [ ] **Step 1: Write the failing tests**

`supabase/functions/__tests__/entitlements_feature_crm_vidro_test.ts`:

```ts
import { assert } from "./assert.ts";
import { FEATURE_COLUMNS, mergeEntitlements } from "../_shared/entitlements.ts";

Deno.test("FEATURE_COLUMNS conhece feature_crm_vidro", () => {
  assert(
    (FEATURE_COLUMNS as readonly string[]).includes("feature_crm_vidro"),
    "feature_crm_vidro precisa estar em FEATURE_COLUMNS para o plano e o override resolverem a flag",
  );
});
```

Before you write the next assertion, read `mergeEntitlements`'s signature in `_shared/entitlements.ts`
(~:41-48). Then add a second `Deno.test` asserting two things:
- a plan row without the key resolves `features.feature_crm_vidro === false`;
- an override `{ feature_crm_vidro: true }` resolves it to true.

Call `mergeEntitlements` with the exact parameters it declares.

In `apps/admin/src/lib/__tests__/featureFlags.test.ts`, inside the existing `it`, add:

```ts
    expect(FEATURE_FLAG_KEYS).toContain('feature_crm_vidro');
    expect(FEATURE_FLAG_LABELS.feature_crm_vidro).toBe('Visual vidro (CRM desktop)');
```

In `apps/admin/src/pages/__tests__/plan-form.test.ts`, add `feature_crm_vidro: false,` next to
`feature_hub_pauta: false,` (:62).

`supabase/tests/entitlements/99_crm_vidro_flag.sql`:

```sql
\set ON_ERROR_STOP on
\i supabase/tests/entitlements/_helpers.sql

-- Desktop "Vidro" rollout flag (feature_crm_vidro, 20261017000001). Born false on
-- every plan; switched per workspace through workspace_plan_overrides.feature_overrides.

begin;
do $$
declare
  v_ws uuid;
begin
  assert exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'plans' and column_name = 'feature_crm_vidro'
                    and data_type = 'boolean' and is_nullable = 'NO' and column_default = 'false'),
    'plans.feature_crm_vidro is not boolean NOT NULL DEFAULT false';
  assert not exists (select 1 from plans where feature_crm_vidro), 'a plan has feature_crm_vidro on by default';

  v_ws := et_make_workspace('max');
  assert not effective_plan_feature(v_ws, 'feature_crm_vidro'), 'new workspace resolves feature_crm_vidro on';

  insert into workspace_plan_overrides (workspace_id, feature_overrides)
    values (v_ws, '{"feature_crm_vidro": true}'::jsonb);
  assert effective_plan_feature(v_ws, 'feature_crm_vidro'), 'override true did not enable feature_crm_vidro';

  raise notice 'PASS 99_crm_vidro_flag';
end $$;
rollback;
```

- [ ] **Step 2: Run the tests and confirm they fail**

```bash
deno test --no-check supabase/functions/__tests__/entitlements_feature_crm_vidro_test.ts
npx vitest run apps/admin/src/lib/__tests__/featureFlags.test.ts
```

Expected: FAIL. `feature_crm_vidro` is not in `FEATURE_COLUMNS` / `FEATURE_FLAG_KEYS`.

- [ ] **Step 3: Implement**

`supabase/migrations/20261017000001_feature_crm_vidro.sql`:

```sql
-- Flag de rollout do visual "Vidro" do CRM desktop
-- (spec docs/superpowers/specs/2026-10-12-desktop-vidro-design.md).
-- Nasce desligada em todos os planos e é ligada por workspace via
-- workspace_plan_overrides.feature_overrides ({"feature_crm_vidro": true}),
-- no mesmo desenho de feature_hub_pauta. Lançamento = ligar a coluna nos planos;
-- desligar = kill switch. Só muda aparência: nenhuma escrita é bloqueada por ela.
-- Depois desta migração, redeploy de workspace-limits e platform-admin
-- (plan-mutations espalha todas as colunas) e, por consistência, paywall-report,
-- mcp-admin e data-import.

SET LOCAL lock_timeout = '5s';

ALTER TABLE public.plans ADD COLUMN IF NOT EXISTS feature_crm_vidro boolean NOT NULL DEFAULT false;
```

- In `entitlements.ts`, append `"feature_crm_vidro"` after `"feature_hub_pauta"` in `FEATURE_COLUMNS`.
- In `apps/admin/src/lib/api.ts`, mirror `feature_hub_pauta` at each of its three spots:
  - in the `Plan` type: `feature_crm_vidro: boolean;`
  - in `FEATURE_FLAG_KEYS`: `'feature_crm_vidro',`
  - in `FEATURE_FLAG_LABELS`: `feature_crm_vidro: 'Visual vidro (CRM desktop)',`
- In `useWorkspaceLimits.ts`:
  - add `feature_crm_vidro?: boolean;` to `FeatureFlags`, with a comment: "Rollout flag for the desktop
    Vidro shell. Optional on purpose: read only as `=== true`."
  - change `const { data, isLoading } = useQuery(` to `const { data, isLoading, isSuccess } = useQuery(`
    and add `isSuccess,` to the returned object.

- [ ] **Step 4: Run the tests and confirm they pass**

```bash
deno test --no-check supabase/functions/__tests__/entitlements_feature_crm_vidro_test.ts
npx vitest run apps/admin/src/lib/__tests__/featureFlags.test.ts apps/admin/src/pages/__tests__/plan-form.test.ts
npx tsc -p apps/admin/tsconfig.json --noEmit && npx tsc -p apps/crm/tsconfig.json --noEmit
npm run check:functions
```

Expected: PASS. `bash scripts/test-entitlements.sh` needs Docker; skip it locally if Docker is not up,
because CI runs it.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20261017000001_feature_crm_vidro.sql supabase/tests/entitlements/99_crm_vidro_flag.sql supabase/functions/__tests__/entitlements_feature_crm_vidro_test.ts supabase/functions/_shared/entitlements.ts apps/admin/src/lib/api.ts apps/admin/src/lib/__tests__/featureFlags.test.ts apps/admin/src/pages/__tests__/plan-form.test.ts apps/crm/src/hooks/useWorkspaceLimits.ts
git commit -m "feat(flags): feature_crm_vidro entitlement for the desktop Vidro shell"
```

---

### Task 2: Look module, user-keyed pre-paint, cache clearing, analytics event

**Files:**
- Create: `apps/crm/src/lib/vidroLook.ts`
- Test: `apps/crm/src/lib/__tests__/vidroLook.test.ts`
- Test: `apps/crm/src/__tests__/vidroPrePaint.test.ts`
- Modify: `apps/crm/index.html` (theme pre-paint function ~:17-24)
- Modify: `apps/crm/src/lib/supabase.ts` (`signOut` ~:254)
- Modify: `apps/crm/src/lib/analytics.ts` (`AnalyticsEvent` union, :9)

**Interfaces:**
- Produces, exported from `@/lib/vidroLook`:
  - `LOOK_CACHE_KEY = 'look-vidro'`;
  - `optOutKey(userId: string): string`;
  - `readOptOut(userId: string | null | undefined): boolean`;
  - `writeOptOut(userId: string, classic: boolean): void`;
  - `isVidroAttributeSet(): boolean`;
  - `applyVidro(on: boolean, userId: string | null): void`;
  - `clearVidroCache(): void`.
- Produces: the `'vidro_look_toggled'` member of `AnalyticsEvent`.

- [ ] **Step 1: Write the failing tests**

`apps/crm/src/lib/__tests__/vidroLook.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  LOOK_CACHE_KEY,
  applyVidro,
  clearVidroCache,
  isVidroAttributeSet,
  optOutKey,
  readOptOut,
  writeOptOut,
} from '../vidroLook';

afterEach(() => {
  localStorage.clear();
  document.documentElement.removeAttribute('data-look');
  vi.restoreAllMocks();
});

describe('vidroLook', () => {
  it('scopes the opt-out to the user', () => {
    writeOptOut('u1', true);
    expect(localStorage.getItem(optOutKey('u1'))).toBe('1');
    expect(readOptOut('u1')).toBe(true);
    expect(readOptOut('u2')).toBe(false);
    expect(readOptOut(null)).toBe(false);
    writeOptOut('u1', false);
    expect(localStorage.getItem(optOutKey('u1'))).toBeNull();
  });

  it('writes the attribute and the user-keyed cache together', () => {
    applyVidro(true, 'u1');
    expect(document.documentElement.getAttribute('data-look')).toBe('vidro');
    expect(isVidroAttributeSet()).toBe(true);
    expect(localStorage.getItem(LOOK_CACHE_KEY)).toBe('u1');
    applyVidro(false, 'u1');
    expect(document.documentElement.hasAttribute('data-look')).toBe(false);
    expect(localStorage.getItem(LOOK_CACHE_KEY)).toBeNull();
  });

  it('applies the attribute even when storage throws', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota');
    });
    expect(() => applyVidro(true, 'u1')).not.toThrow();
    expect(isVidroAttributeSet()).toBe(true);
  });

  it('does not write the cache without a user', () => {
    applyVidro(true, null);
    expect(isVidroAttributeSet()).toBe(true);
    expect(localStorage.getItem(LOOK_CACHE_KEY)).toBeNull();
  });

  it('clears only the cache', () => {
    applyVidro(true, 'u1');
    clearVidroCache();
    expect(localStorage.getItem(LOOK_CACHE_KEY)).toBeNull();
    expect(isVidroAttributeSet()).toBe(true);
  });

  it('does not remove a foreign data-look value', () => {
    document.documentElement.setAttribute('data-look', 'other');
    applyVidro(false, 'u1');
    expect(document.documentElement.getAttribute('data-look')).toBe('other');
  });
});
```

`apps/crm/src/__tests__/vidroPrePaint.test.ts`. It runs the real inline script from `index.html`:

```ts
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';

const html = readFileSync('apps/crm/index.html', 'utf8');
const script = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)]
  .map((m) => m[1])
  .find((s) => s.includes("getItem('theme')"));
if (!script) throw new Error('theme pre-paint script not found');

function runPrePaint() {
  new Function(script!)();
}

afterEach(() => {
  localStorage.clear();
  document.documentElement.removeAttribute('data-look');
  document.documentElement.removeAttribute('data-theme');
});

const SESSION_KEY = 'sb-abcdefgh-auth-token';
const session = (id: string) => JSON.stringify({ access_token: 'x', user: { id } });

describe('index.html pre-paint', () => {
  it('sets data-look="vidro" when the cache matches the signed-in user', () => {
    localStorage.setItem(SESSION_KEY, session('u1'));
    localStorage.setItem('look-vidro', 'u1');
    runPrePaint();
    expect(document.documentElement.getAttribute('data-look')).toBe('vidro');
  });

  it('ignores a cache written for another user', () => {
    localStorage.setItem(SESSION_KEY, session('u2'));
    localStorage.setItem('look-vidro', 'u1');
    runPrePaint();
    expect(document.documentElement.hasAttribute('data-look')).toBe(false);
  });

  it('ignores the cache with no session or a malformed session', () => {
    localStorage.setItem('look-vidro', 'u1');
    runPrePaint();
    expect(document.documentElement.hasAttribute('data-look')).toBe(false);
    localStorage.setItem(SESSION_KEY, '{not json');
    expect(() => runPrePaint()).not.toThrow();
    expect(document.documentElement.hasAttribute('data-look')).toBe(false);
  });

  it('does not read the PKCE code-verifier entry as a session', () => {
    localStorage.setItem('sb-abcdefgh-auth-token-code-verifier', session('u1'));
    localStorage.setItem('look-vidro', 'u1');
    runPrePaint();
    expect(document.documentElement.hasAttribute('data-look')).toBe(false);
  });

  it('matches any project session (dev may hold both prod and staging keys)', () => {
    localStorage.setItem('sb-aaaaaaaa-auth-token', session('other'));
    localStorage.setItem('sb-zzzzzzzz-auth-token', session('u1'));
    localStorage.setItem('look-vidro', 'u1');
    runPrePaint();
    expect(document.documentElement.getAttribute('data-look')).toBe('vidro');
  });

  it('leaves the attribute alone without the cache', () => {
    localStorage.setItem(SESSION_KEY, session('u1'));
    runPrePaint();
    expect(document.documentElement.hasAttribute('data-look')).toBe(false);
  });
});
```

If the theme script references something jsdom lacks (for example `navigator.standalone`), it lives in
a separate statement after the IIFE. The regex picks the whole `<script>` block, so if `new Function`
throws, narrow the test to the IIFE text (`script.slice(0, script.indexOf('})();') + 5)`).

- [ ] **Step 2: Run the tests and confirm they fail**

```bash
npx vitest run apps/crm/src/lib/__tests__/vidroLook.test.ts apps/crm/src/__tests__/vidroPrePaint.test.ts
```

Expected: FAIL. The module is missing, and the attribute is not set.

- [ ] **Step 3: Implement**

`apps/crm/src/lib/vidroLook.ts`:

```ts
/**
 * Desktop "Vidro" look (spec docs/superpowers/specs/2026-10-12-desktop-vidro-design.md, D2/D3).
 * The workspace flag decides; each user can opt out per browser. `look-vidro` holds the id of the
 * user the look last resolved "on" for; index.html pre-paints only when the Supabase session in
 * localStorage belongs to that same user, so any identity change falls back to classic.
 */
export const LOOK_CACHE_KEY = 'look-vidro';

export function optOutKey(userId: string): string {
  return `look-optout:${userId}`;
}

export function readOptOut(userId: string | null | undefined): boolean {
  if (!userId) return false;
  try {
    return localStorage.getItem(optOutKey(userId)) === '1';
  } catch {
    return false;
  }
}

export function writeOptOut(userId: string, classic: boolean): void {
  try {
    if (classic) localStorage.setItem(optOutKey(userId), '1');
    else localStorage.removeItem(optOutKey(userId));
  } catch {
    // Storage unavailable: the choice lasts for this page load only.
  }
}

export function isVidroAttributeSet(): boolean {
  return document.documentElement.getAttribute('data-look') === 'vidro';
}

export function applyVidro(on: boolean, userId: string | null): void {
  const root = document.documentElement;
  if (on) root.setAttribute('data-look', 'vidro');
  else if (root.getAttribute('data-look') === 'vidro') root.removeAttribute('data-look');
  try {
    if (on && userId) localStorage.setItem(LOOK_CACHE_KEY, userId);
    else localStorage.removeItem(LOOK_CACHE_KEY);
  } catch {
    // The attribute is already applied; only the next load loses the pre-paint.
  }
}

/** Sign-out or workspace switch: the next load must not pre-paint the previous look. */
export function clearVidroCache(): void {
  try {
    localStorage.removeItem(LOOK_CACHE_KEY);
  } catch {
    // Nothing to clear.
  }
}
```

In `apps/crm/index.html`, inside the existing IIFE, add these lines right after the
`if (localStorage.getItem('theme') === 'dark') { … }` block:

```js
        // Desktop "Vidro" look (src/lib/vidroLook.ts): look-vidro holds the user id it was
        // resolved for; pre-paint only when the stored Supabase session is that user's.
        try {
          var lookUser = localStorage.getItem('look-vidro');
          if (lookUser) {
            for (var i = 0; i < localStorage.length; i++) {
              var k = localStorage.key(i);
              if (k && /^sb-[a-z0-9]+-auth-token$/.test(k)) {
                var sess = JSON.parse(localStorage.getItem(k) || 'null');
                if (sess && sess.user && sess.user.id === lookUser) {
                  document.documentElement.setAttribute('data-look', 'vidro');
                  break;
                }
              }
            }
          }
        } catch (e) {}
```

Before writing it, confirm the session shape: `supabase-js`'s default storage key is
`sb-<project ref>-auth-token` and its value carries `user.id` (check the installed
`@supabase/auth-js` `GoTrueClient` `_saveSession` / `storageKey`). If the installed version stores the
user under a separate key, read that key instead and adjust the tests. Every unknown shape must fall
back to no pre-paint.

In `apps/crm/src/lib/supabase.ts`, add `import { clearVidroCache } from './vidroLook';` and call
`clearVidroCache();` as the first line of `signOut`. No AuthContext change: the user key covers
sign-in, sign-up, recovery links and other tabs.

Add a `signOut` case: if `apps/crm/src/lib/__tests__/supabase.test.ts` exists, extend it; otherwise
create it with `vi.mock('@supabase/supabase-js', …)` returning an `auth.signOut` that resolves. Set
`localStorage['look-vidro']='u1'`, call `signOut()`, assert the key is gone.

In `apps/crm/src/lib/analytics.ts`, add to the `AnalyticsEvent` union:

```ts
  // Desktop Vidro opt-out/opt-in from the account menu (src/hooks/useVidro.ts).
  | 'vidro_look_toggled'
```

- [ ] **Step 4: Run everything**

```bash
npx vitest run apps/crm/src/lib/__tests__/vidroLook.test.ts apps/crm/src/__tests__/vidroPrePaint.test.ts apps/crm/src/lib/__tests__/supabase.test.ts
npx tsc -p apps/crm/tsconfig.json --noEmit
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/crm/src/lib/vidroLook.ts apps/crm/src/lib/__tests__/vidroLook.test.ts apps/crm/src/lib/__tests__/supabase.test.ts apps/crm/src/__tests__/vidroPrePaint.test.ts apps/crm/index.html apps/crm/src/lib/supabase.ts apps/crm/src/lib/analytics.ts
git commit -m "feat(crm): vidro look module and user-keyed pre-paint cache"
```

---

### Task 3: Page toolbar store, provider, hook and component

**Files:**
- Create: `apps/crm/src/components/layout/PageToolbarContext.tsx`
- Create: `apps/crm/src/components/layout/PageToolbar.tsx`
- Create: `apps/crm/src/test/vidroToolbar.tsx` (test harness for the page tasks)
- Test: `apps/crm/src/components/layout/__tests__/PageToolbarContext.test.tsx`

**Interfaces:**
- Produces, from `@/components/layout/PageToolbarContext`:

```ts
export interface PageToolbarSpec {
  title: ReactNode;
  subtitle?: ReactNode;
  leading?: ReactNode;
  titleAccessory?: ReactNode;
  segmented?: ReactNode;
  actions?: ReactNode;
  primary?: ReactNode;
}
export interface PageToolbarStore {
  register(id: string): void;
  unregister(id: string): void;
  set(id: string, spec: PageToolbarSpec | null): void;
  subscribe(listener: () => void): () => void;
  getSnapshot(): PageToolbarSnapshot;
}
export interface PageToolbarSnapshot { spec: PageToolbarSpec | null; registered: boolean }
export function createPageToolbarStore(): PageToolbarStore;
export function PageToolbarProvider(props: { vidroShell: boolean; children: ReactNode }): JSX.Element;
export function usePageToolbar(spec: PageToolbarSpec | null): boolean;
export function useVidroShell(): boolean;
export function usePageToolbarStore(): PageToolbarStore | null;
```

- Produces, from `@/components/layout/PageToolbar`: `default function PageToolbar(props: { capsule: ReactNode })`.
  It renders `<header className="vidro-toolbar">` containing:
  - `.vidro-toolbar-left`, holding the leading node, `<h1 className="vidro-toolbar-title">`, the title
    accessory and `.vidro-toolbar-subtitle`;
  - `.vidro-toolbar-right`, holding segmented, actions, the capsule and the primary node.
- Produces, from `@/test/vidroToolbar`:
  `VidroToolbarHarness(props: { children: ReactNode; vidroShell?: boolean })`. It provides the store and
  renders `<PageToolbar capsule={null} />` before its children when `vidroShell` (default true).

- [ ] **Step 1: Write the failing tests**

`apps/crm/src/components/layout/__tests__/PageToolbarContext.test.tsx`:

```tsx
import { act, render, screen } from '@testing-library/react';
import { useState, type ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  PageToolbarProvider,
  createPageToolbarStore,
  usePageToolbar,
  useVidroShell,
} from '../PageToolbarContext';
import PageToolbar from '../PageToolbar';
import { VidroToolbarHarness } from '@/test/vidroToolbar';

function Page({ title, extra }: { title: string; extra?: ReactNode }) {
  const inToolbar = usePageToolbar({ title, primary: <button type="button">Novo</button>, subtitle: extra });
  return inToolbar ? <p>conteúdo</p> : <h1>{title}</h1>;
}

afterEach(() => vi.restoreAllMocks());

describe('page toolbar store', () => {
  it('shows the last inserted registration and keeps order on set', () => {
    const store = createPageToolbarStore();
    store.register('a');
    store.set('a', { title: 'A' });
    store.register('b');
    store.set('b', { title: 'B' });
    store.set('a', { title: 'A2' });
    expect(store.getSnapshot().spec?.title).toBe('B');
    store.unregister('b');
    expect(store.getSnapshot().spec?.title).toBe('A2');
    store.unregister('a');
    expect(store.getSnapshot()).toEqual({ spec: null, registered: false });
  });

  it('ignores set for an unregistered id and returns a stable snapshot', () => {
    const store = createPageToolbarStore();
    store.set('x', { title: 'X' });
    const first = store.getSnapshot();
    expect(first.registered).toBe(false);
    expect(store.getSnapshot()).toBe(first);
  });

  it('warns in development when two registrations are live', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const store = createPageToolbarStore();
    store.register('a');
    store.register('b');
    expect(warn).toHaveBeenCalled();
  });
});

describe('usePageToolbar', () => {
  it('renders the title once, in the toolbar h1, when vidroShell', () => {
    render(
      <VidroToolbarHarness>
        <Page title="Clientes" />
      </VidroToolbarHarness>,
    );
    const h1s = screen.getAllByRole('heading', { level: 1 });
    expect(h1s).toHaveLength(1);
    expect(h1s[0].closest('.vidro-toolbar')).not.toBeNull();
    expect(screen.getAllByRole('button', { name: 'Novo' })).toHaveLength(1);
  });

  it('is inert without vidroShell: the page keeps its own header', () => {
    render(
      <VidroToolbarHarness vidroShell={false}>
        <Page title="Clientes" />
      </VidroToolbarHarness>,
    );
    expect(screen.getByRole('heading', { level: 1, name: 'Clientes' }).closest('.vidro-toolbar')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Novo' })).toBeNull();
  });

  it('updates the toolbar on page re-render without changing the context value', () => {
    let shellRenders = 0;
    // Reads the context: it re-renders only if the Provider value changes.
    function ShellSibling() {
      useVidroShell();
      shellRenders += 1;
      return null;
    }
    let bump: () => void = () => {};
    function LivePage() {
      const [n, setN] = useState(0);
      bump = () => setN((v) => v + 1);
      usePageToolbar({ title: 'Entregas', subtitle: `${n} atrasados` });
      return null;
    }
    render(
      <PageToolbarProvider vidroShell>
        <ShellSibling />
        <PageToolbar capsule={null} />
        <LivePage />
      </PageToolbarProvider>,
    );
    const before = shellRenders;
    act(() => bump());
    act(() => bump());
    expect(screen.getByText('2 atrasados')).toBeInTheDocument();
    expect(shellRenders).toBe(before);
  });

  it('clears the toolbar when the page unmounts', () => {
    function Host() {
      const [show, setShow] = useState(true);
      return (
        <>
          <button type="button" onClick={() => setShow(false)}>sair</button>
          {show && <Page title="Leads" />}
        </>
      );
    }
    render(
      <VidroToolbarHarness>
        <Host />
      </VidroToolbarHarness>,
    );
    expect(screen.getByRole('heading', { level: 1, name: 'Leads' })).toBeInTheDocument();
    act(() => screen.getByRole('button', { name: 'sair' }).click());
    expect(screen.queryByRole('heading', { level: 1 })).toBeNull();
  });
});
```

- [ ] **Step 2: Run the tests and confirm they fail**

```bash
npx vitest run apps/crm/src/components/layout/__tests__/PageToolbarContext.test.tsx
```

Expected: FAIL. The modules are missing.

- [ ] **Step 3: Implement**

`apps/crm/src/components/layout/PageToolbarContext.tsx`:

```tsx
import {
  createContext,
  useContext,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  type ReactNode,
} from 'react';

/** What a page puts in the desktop Vidro toolbar (spec: usePageToolbar). */
export interface PageToolbarSpec {
  title: ReactNode;
  subtitle?: ReactNode;
  leading?: ReactNode;
  titleAccessory?: ReactNode;
  segmented?: ReactNode;
  actions?: ReactNode;
  primary?: ReactNode;
}

export interface PageToolbarSnapshot {
  spec: PageToolbarSpec | null;
  registered: boolean;
}

export interface PageToolbarStore {
  register(id: string): void;
  unregister(id: string): void;
  set(id: string, spec: PageToolbarSpec | null): void;
  subscribe(listener: () => void): () => void;
  getSnapshot(): PageToolbarSnapshot;
}

const EMPTY: PageToolbarSnapshot = { spec: null, registered: false };

/**
 * An external store, not React state: pages write their spec on every commit and only
 * PageToolbar subscribes (useSyncExternalStore), so AppLayout never re-renders because a
 * page did. Entries live in insertion order; the LAST inserted live entry is shown, and
 * `set` on an existing id keeps its position, so a re-rendering layout never steals the
 * slot from a child that mounted after it.
 */
export function createPageToolbarStore(): PageToolbarStore {
  const entries = new Map<string, PageToolbarSpec | null>();
  const listeners = new Set<() => void>();
  let snapshot: PageToolbarSnapshot = EMPTY;

  const recompute = () => {
    if (entries.size === 0) {
      snapshot = EMPTY;
    } else {
      const last = Array.from(entries.values())[entries.size - 1];
      snapshot = { spec: last, registered: true };
    }
    listeners.forEach((l) => l());
  };

  return {
    register(id) {
      if (entries.has(id)) return;
      entries.set(id, null);
      if (import.meta.env.DEV && entries.size > 1) {
        console.warn(
          '[PageToolbar] two pages registered at once; the last mounted wins. Children of a registering layout must not register.',
        );
      }
      recompute();
    },
    unregister(id) {
      if (!entries.delete(id)) return;
      recompute();
    },
    set(id, spec) {
      if (!entries.has(id)) return;
      entries.set(id, spec);
      recompute();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getSnapshot() {
      return snapshot;
    },
  };
}

interface PageToolbarContextValue {
  store: PageToolbarStore;
  vidroShell: boolean;
}

const PageToolbarContext = createContext<PageToolbarContextValue | null>(null);

export function PageToolbarProvider({
  vidroShell,
  children,
}: {
  vidroShell: boolean;
  children: ReactNode;
}) {
  const storeRef = useRef<PageToolbarStore | null>(null);
  if (!storeRef.current) storeRef.current = createPageToolbarStore();
  const value = useMemo(
    () => ({ store: storeRef.current as PageToolbarStore, vidroShell }),
    [vidroShell],
  );
  return <PageToolbarContext.Provider value={value}>{children}</PageToolbarContext.Provider>;
}

/**
 * Registers the calling page's toolbar content. Call it above every early return (pass null
 * while there is nothing to show). Returns true when the Vidro toolbar is showing it, in which
 * case the page must not render its own in-page header.
 */
export function usePageToolbar(spec: PageToolbarSpec | null): boolean {
  const ctx = useContext(PageToolbarContext);
  const id = useId();
  const store = ctx?.store ?? null;

  useLayoutEffect(() => {
    if (!store) return;
    store.register(id);
    return () => store.unregister(id);
  }, [store, id]);

  // Deliberately no deps: the latest JSX lands on every commit.
  useLayoutEffect(() => {
    store?.set(id, spec);
  });

  return ctx?.vidroShell ?? false;
}

/** For children of a registering layout (Cliente hub pages): heading level decisions only. */
export function useVidroShell(): boolean {
  return useContext(PageToolbarContext)?.vidroShell ?? false;
}

export function usePageToolbarStore(): PageToolbarStore | null {
  return useContext(PageToolbarContext)?.store ?? null;
}
```

`apps/crm/src/components/layout/PageToolbar.tsx`:

```tsx
import { useSyncExternalStore, type ReactNode } from 'react';
import { usePageToolbarStore, type PageToolbarSnapshot } from './PageToolbarContext';

const NONE: PageToolbarSnapshot = { spec: null, registered: false };
const noopSubscribe = () => () => {};
const noneSnapshot = () => NONE;

/** The Vidro panel's first row: page title on the left, page actions and the shell capsule on the right. */
export default function PageToolbar({ capsule }: { capsule: ReactNode }) {
  const store = usePageToolbarStore();
  const { spec } = useSyncExternalStore(
    store ? store.subscribe : noopSubscribe,
    store ? store.getSnapshot : noneSnapshot,
    noneSnapshot,
  );

  return (
    <header className="vidro-toolbar">
      <div className="vidro-toolbar-left">
        {spec?.leading}
        {spec?.title != null && <h1 className="vidro-toolbar-title">{spec.title}</h1>}
        {spec?.titleAccessory}
        {spec?.subtitle != null && <div className="vidro-toolbar-subtitle">{spec.subtitle}</div>}
      </div>
      <div className="vidro-toolbar-right">
        {spec?.segmented}
        {spec?.actions}
        {capsule}
        {spec?.primary}
      </div>
    </header>
  );
}
```

`apps/crm/src/test/vidroToolbar.tsx`:

```tsx
import type { ReactNode } from 'react';
import { PageToolbarProvider } from '@/components/layout/PageToolbarContext';
import PageToolbar from '@/components/layout/PageToolbar';

/** Renders a page inside the Vidro toolbar context, as AppLayout does at >=1101px with the flag on. */
export function VidroToolbarHarness({
  children,
  vidroShell = true,
}: {
  children: ReactNode;
  vidroShell?: boolean;
}) {
  return (
    <PageToolbarProvider vidroShell={vidroShell}>
      {vidroShell && <PageToolbar capsule={null} />}
      {children}
    </PageToolbarProvider>
  );
}
```

- [ ] **Step 4: Run the tests and confirm they pass**

```bash
npx vitest run apps/crm/src/components/layout/__tests__/PageToolbarContext.test.tsx
npx tsc -p apps/crm/tsconfig.json --noEmit
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/crm/src/components/layout/PageToolbarContext.tsx apps/crm/src/components/layout/PageToolbar.tsx apps/crm/src/test/vidroToolbar.tsx apps/crm/src/components/layout/__tests__/PageToolbarContext.test.tsx
git commit -m "feat(crm): page toolbar store and component for the Vidro shell"
```

---

### Task 4: Support chat unread store and the capsule variant

**Files:**
- Create: `apps/crm/src/lib/supportChatUnread.ts`
- Test: `apps/crm/src/lib/__tests__/supportChatUnread.test.ts`
- Modify: `apps/crm/src/components/layout/TopBarActions.tsx` (the whole file, 51 lines)
- Modify: `apps/crm/src/components/layout/NotificationBell.tsx:24` (button class becomes a prop)
- Modify: `apps/crm/src/components/layout/__tests__/TopBarActions.test.tsx` (add a capsule case)

**Interfaces:**
- Produces, from `@/lib/supportChatUnread`:
  - `ensureCrispListeners(): void` (idempotent);
  - `markSupportChatRead(): void`;
  - `useSupportChatUnread(): boolean`;
  - `__resetSupportChatUnreadForTests(): void`;
  - the `window.$crisp` / `CRISP_TOKEN_ID` global declaration, moved here.
- Produces:
  - `TopBarActions` props `{ variant?: 'topbar' | 'capsule' }`. The default `'topbar'` renders exactly
    today's markup. `'capsule'` wraps both buttons in
    `<div className="vidro-capsule" role="group" aria-label="Notificações e suporte">` and gives each
    button the class `vidro-capsule-btn`.
  - `NotificationBell` props `{ buttonClassName?: string }`, default `'topbar-action-btn'`.

- [ ] **Step 1: Write the failing test**

`apps/crm/src/lib/__tests__/supportChatUnread.test.ts`:

```ts
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  __resetSupportChatUnreadForTests,
  ensureCrispListeners,
  markSupportChatRead,
  useSupportChatUnread,
} from '../supportChatUnread';

type Handler = () => void;
let handlers: Record<string, Handler[]>;

beforeEach(() => {
  __resetSupportChatUnreadForTests();
  handlers = {};
  const queue: unknown[][] = [];
  queue.push = (...items: unknown[][]) => {
    for (const item of items) {
      if (item[0] === 'on') (handlers[item[1] as string] ??= []).push(item[2] as Handler);
    }
    return Array.prototype.push.apply(queue, items);
  };
  window.$crisp = queue;
});

afterEach(() => {
  delete window.$crisp;
});

describe('supportChatUnread', () => {
  it('registers the Crisp listeners once across calls', () => {
    ensureCrispListeners();
    ensureCrispListeners();
    expect(handlers['message:received']).toHaveLength(1);
    expect(handlers['chat:opened']).toHaveLength(1);
    expect(handlers['chat:closed']).toHaveLength(1);
  });

  it('tracks unread from Crisp events and clears on read', () => {
    ensureCrispListeners();
    const { result } = renderHook(() => useSupportChatUnread());
    expect(result.current).toBe(false);
    act(() => handlers['message:received'][0]());
    expect(result.current).toBe(true);
    act(() => handlers['chat:opened'][0]());
    expect(result.current).toBe(false);
    act(() => handlers['message:received'][0]());
    act(() => markSupportChatRead());
    expect(result.current).toBe(false);
  });

  it('hides the widget when the chat closes', () => {
    ensureCrispListeners();
    handlers['chat:closed'][0]();
    expect((window.$crisp as unknown[][]).some((i) => i[0] === 'do' && i[1] === 'chat:hide')).toBe(true);
  });
});
```

In `TopBarActions.test.tsx`, add a case that renders `<TopBarActions variant="capsule" />` with the
file's existing mocks and asserts two things:
- `screen.getByRole('group', { name: 'Notificações e suporte' })` exists;
- the Chat button has class `vidro-capsule-btn`.

Keep both existing cases unchanged.

- [ ] **Step 2: Run the tests and confirm they fail**

```bash
npx vitest run apps/crm/src/lib/__tests__/supportChatUnread.test.ts apps/crm/src/components/layout/__tests__/TopBarActions.test.tsx
```

Expected: FAIL.

- [ ] **Step 3: Implement**

`apps/crm/src/lib/supportChatUnread.ts`:

```ts
import { useSyncExternalStore } from 'react';

declare global {
  interface Window {
    $crisp?: Array<unknown[]>;
    /**
     * Crisp Session Continuity token, read by the widget on `session:reset`.
     * Only ever written by AuthContext.tsx: set on an authenticated rebind,
     * nulled on sign-out and user change. Declared here once; a TS global
     * augmentation merges across the compilation, so MobileNav.tsx's own
     * `$crisp` block deliberately does not repeat it.
     */
    CRISP_TOKEN_ID?: string | null;
  }
}

/**
 * One owner for the desktop support-chat unread dot. The Crisp listeners used to be pushed by
 * TopBarActions on mount with no cleanup; the Vidro shell can remount it (shell swap, crossing
 * 1101px), so registration is once-guarded here and the flag lives outside React.
 */
let registered = false;
let unread = false;
const listeners = new Set<() => void>();

function setUnread(next: boolean) {
  if (unread === next) return;
  unread = next;
  listeners.forEach((l) => l());
}

export function ensureCrispListeners(): void {
  if (registered || !window.$crisp) return;
  registered = true;
  window.$crisp.push(['on', 'message:received', () => setUnread(true)]);
  window.$crisp.push(['on', 'chat:opened', () => setUnread(false)]);
  window.$crisp.push(['on', 'chat:closed', () => window.$crisp?.push(['do', 'chat:hide'])]);
}

export function markSupportChatRead(): void {
  setUnread(false);
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useSupportChatUnread(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => unread,
    () => false,
  );
}

export function __resetSupportChatUnreadForTests(): void {
  registered = false;
  unread = false;
  listeners.clear();
}
```

`apps/crm/src/components/layout/TopBarActions.tsx` (complete file):

```tsx
import { useEffect, useCallback } from 'react';
import { MessageCircle } from 'lucide-react';
import NotificationBell from './NotificationBell';
import { openSupportChat } from '@/lib/supportChat';
import {
  ensureCrispListeners,
  markSupportChatRead,
  useSupportChatUnread,
} from '@/lib/supportChatUnread';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';

export default function TopBarActions({ variant = 'topbar' }: { variant?: 'topbar' | 'capsule' }) {
  const crispUnread = useSupportChatUnread();
  const buttonClassName = variant === 'capsule' ? 'vidro-capsule-btn' : 'topbar-action-btn';

  const openCrisp = useCallback(() => {
    // Gated: without support consent this opens the consent dialog instead of a dead click.
    // The unread dot only clears when the chat really opened, not when only the dialog did.
    if (openSupportChat()) markSupportChatRead();
  }, []);

  useEffect(() => {
    ensureCrispListeners();
  }, []);

  const buttons = (
    <TooltipProvider delayDuration={200}>
      <NotificationBell buttonClassName={buttonClassName} />

      <Tooltip>
        <TooltipTrigger asChild>
          <button type="button" className={buttonClassName} aria-label="Chat" onClick={openCrisp}>
            <MessageCircle size={18} />
            {crispUnread && <span className="unread-dot unread-dot--primary" />}
          </button>
        </TooltipTrigger>
        <TooltipContent>Chat de suporte</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );

  if (variant === 'capsule') {
    return (
      <div className="vidro-capsule" role="group" aria-label="Notificações e suporte">
        {buttons}
      </div>
    );
  }
  return buttons;
}
```

`NotificationBell.tsx`:
- Accept `{ buttonClassName = 'topbar-action-btn' }: { buttonClassName?: string }` in the component's
  props.
- Use it on the button at :24 (`className={buttonClassName}`). Nothing else changes.

- [ ] **Step 4: Run the tests and confirm they pass**

```bash
npx vitest run apps/crm/src/lib/__tests__/supportChatUnread.test.ts apps/crm/src/components/layout/__tests__/TopBarActions.test.tsx apps/crm/src/components/layout/__tests__/NotificationBell.test.tsx
npx tsc -p apps/crm/tsconfig.json --noEmit
```

Expected: PASS. The global `$crisp` typing still resolves for `MobileNav.tsx` and `AuthContext.tsx`.

- [ ] **Step 5: Commit**

```bash
git add apps/crm/src/lib/supportChatUnread.ts apps/crm/src/lib/__tests__/supportChatUnread.test.ts apps/crm/src/components/layout/TopBarActions.tsx apps/crm/src/components/layout/NotificationBell.tsx apps/crm/src/components/layout/__tests__/TopBarActions.test.tsx
git commit -m "feat(crm): one owner for the support-chat unread state; capsule variant"
```

---

### Task 5: `vidro.css`, `data-slot` hooks and the CSS contract test

**Files:**
- Create: `apps/crm/src/styles/vidro.css`
- Create: `apps/crm/src/__tests__/vidroContracts.test.ts`
- Create: `apps/crm/src/components/ui/__tests__/dataSlots.test.tsx`
- Modify: `apps/crm/src/main.tsx` (import after `import '../style.css';`)
- Modify: `apps/crm/src/components/ui/button.tsx:44`, `apps/crm/src/components/ui/tabs.tsx:11,26`

**Interfaces:**
- Consumes these class names, which T3, T4, T6 and the page tasks render:
  - `.vidro-panel`, `.vidro-toolbar`, `.vidro-toolbar-left`, `.vidro-toolbar-title`,
    `.vidro-toolbar-subtitle`, `.vidro-toolbar-right`;
  - `.vidro-capsule`, `.vidro-capsule-btn`;
  - `.vidro-sidebar-head`, `.vidro-sidebar-logo`, `.vidro-sidebar-ws`, `.vidro-sidebar-ws-name`,
    `.vidro-sidebar-ws-plan`;
  - `.search-trigger--sidebar`, `.vidro-seg`, `.vidro-seg-btn`.
- Produces these attributes:
  - `data-slot="button"` on the shadcn Button's rendered element;
  - `data-slot="tabs-list"` / `"tabs-trigger"` on `TabsList` / `TabsTrigger`.

- [ ] **Step 1: Write the failing tests**

`apps/crm/src/__tests__/vidroContracts.test.ts`:

```ts
import { readFileSync } from 'node:fs';
import postcss, { type AtRule, type Rule } from 'postcss';
import { describe, expect, it } from 'vitest';

const css = readFileSync('apps/crm/src/styles/vidro.css', 'utf8');
const root = postcss.parse(css);
const main = readFileSync('apps/crm/src/main.tsx', 'utf8');

function enclosingMedia(rule: Rule): string[] {
  const params: string[] = [];
  let p = rule.parent;
  while (p) {
    if (p.type === 'atrule' && (p as AtRule).name === 'media') params.push((p as AtRule).params);
    p = p.parent;
  }
  return params;
}

describe('vidro.css contracts', () => {
  it('has no @layer and no !important', () => {
    root.walkAtRules('layer', () => {
      throw new Error('@layer is not allowed in vidro.css');
    });
    root.walkDecls((d) => expect(d.important, `${d.prop} in ${d.parent}`).toBeFalsy());
  });

  it('keeps every rule in the 1101px block, except the scoped Analytics de Fluxos print block', () => {
    root.walkRules((rule) => {
      if (rule.parent?.type === 'atrule' && (rule.parent as AtRule).name === 'keyframes') return;
      const media = enclosingMedia(rule);
      if (media.some((m) => m.trim() === 'print')) {
        for (const s of rule.selectors) expect(s).toContain('body:has(.analytics-fluxos-page)');
        return;
      }
      expect(
        media.some((m) => /min-width:\s*1101px/.test(m)),
        `outside the 1101px block: ${rule.selector}`,
      ).toBe(true);
    });
  });

  it('starts every selector with html carrying [data-look=vidro]', () => {
    root.walkRules((rule) => {
      if (rule.parent?.type === 'atrule' && (rule.parent as AtRule).name === 'keyframes') return;
      for (const s of rule.selectors) {
        const first = s.trim().split(/\s+/)[0];
        expect(first.startsWith('html'), s).toBe(true);
        expect(first.includes("[data-look='vidro']"), s).toBe(true);
      }
    });
  });

  it('never redefines shared tokens on a bare .app-container', () => {
    root.walkRules((rule) => {
      for (const s of rule.selectors) {
        if (s.trim() === '.app-container') throw new Error('bare .app-container selector');
      }
    });
  });

  it('is imported once, right after style.css', () => {
    expect(main).toMatch(/import '\.\.\/style\.css';\s*\nimport '\.\/styles\/vidro\.css';/);
  });
});
```

`apps/crm/src/components/ui/__tests__/dataSlots.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Button } from '../button';
import { Tabs, TabsList, TabsTrigger } from '../tabs';

describe('data-slot hooks', () => {
  it('marks Button, also through asChild', () => {
    render(
      <>
        <Button>Salvar</Button>
        <Button asChild>
          <a href="/x">Link</a>
        </Button>
      </>,
    );
    expect(screen.getByRole('button', { name: 'Salvar' })).toHaveAttribute('data-slot', 'button');
    expect(screen.getByRole('link', { name: 'Link' })).toHaveAttribute('data-slot', 'button');
  });

  it('marks TabsList and TabsTrigger', () => {
    render(
      <Tabs defaultValue="a">
        <TabsList>
          <TabsTrigger value="a">A</TabsTrigger>
        </TabsList>
      </Tabs>,
    );
    expect(screen.getByRole('tablist')).toHaveAttribute('data-slot', 'tabs-list');
    expect(screen.getByRole('tab', { name: 'A' })).toHaveAttribute('data-slot', 'tabs-trigger');
  });
});
```

- [ ] **Step 2: Run the tests and confirm they fail**

```bash
npx vitest run apps/crm/src/__tests__/vidroContracts.test.ts apps/crm/src/components/ui/__tests__/dataSlots.test.tsx
```

Expected: FAIL. The file is missing and the attributes are absent.

- [ ] **Step 3: Implement**

`button.tsx:44`: render `<Comp data-slot="button" className={…} ref={ref} {...props} />`. Put
`data-slot` before `{...props}` so a caller could still override it. `tabs.tsx`: add
`data-slot="tabs-list"` to `TabsPrimitive.List` and `data-slot="tabs-trigger"` to
`TabsPrimitive.Trigger`, both before `{...props}`. No CSS or test reads `data-slot` today (verified:
zero hits in `apps/crm/style.css` and `apps/crm/src`), so the classic look is unchanged.

`apps/crm/src/main.tsx`: add `import './styles/vidro.css';` on the line directly after
`import '../style.css';`.

`apps/crm/src/styles/vidro.css`. Write it exactly as below. T14 may adjust values after the browser
sweep, inside the same guards.

```css
/*
 * Desktop "Vidro" (level 3) shell and content look.
 * Spec: docs/superpowers/specs/2026-10-12-desktop-vidro-design.md
 * Applies only with html[data-look='vidro'] (workspace flag feature_crm_vidro + no opt-out,
 * src/hooks/useVidro.ts) and only at >=1101px. Ordinary stylesheet on purpose: no @layer, no
 * !important. src/__tests__/vidroContracts.test.ts enforces the guards.
 */
@media (min-width: 1101px) {
  /* ---------- Tokens + backdrop ---------- */
  html[data-look='vidro'] .app-container {
    --vd-panel: rgba(255, 255, 255, 0.94);
    --vd-glass: rgba(255, 255, 255, 0.55);
    --vd-glass-bd: rgba(255, 255, 255, 0.75);
    --vd-cap: rgba(255, 255, 255, 0.82);
    --vd-cap-bd: rgba(18, 21, 26, 0.08);
    --vd-cap-ring: #ffffff;
    --vd-tile: #f4f4f6;
    --vd-group: #ffffff;
    --vd-sep: rgba(60, 60, 67, 0.12);
    --vd-fill: rgba(118, 118, 128, 0.12);
    --vd-sel: #12151a;
    --vd-sel-fg: #ffffff;
    --vd-txt3: #6b7280;
    --vd-shadow: 0 20px 50px -20px rgba(18, 21, 26, 0.25);
    --vd-solid: #f7f7f9;
    --topbar-height: 70px;
    background-color: #eceef3;
    background-image:
      radial-gradient(42rem 42rem at 6% 8%, rgba(255, 191, 48, 0.3), transparent 60%),
      radial-gradient(40rem 40rem at 92% 12%, rgba(57, 132, 255, 0.18), transparent 60%),
      radial-gradient(40rem 40rem at 80% 96%, rgba(245, 66, 200, 0.12), transparent 60%),
      radial-gradient(36rem 36rem at 12% 92%, rgba(106, 201, 208, 0.22), transparent 62%);
  }

  html[data-theme='dark'][data-look='vidro'] .app-container {
    --vd-panel: rgba(15, 17, 21, 0.86);
    --vd-glass: rgba(17, 21, 28, 0.5);
    --vd-glass-bd: rgba(255, 255, 255, 0.09);
    --vd-cap: rgba(30, 36, 48, 0.7);
    --vd-cap-bd: rgba(255, 255, 255, 0.08);
    --vd-cap-ring: #1e2430;
    --vd-tile: rgba(255, 255, 255, 0.05);
    --vd-group: rgba(255, 255, 255, 0.03);
    --vd-sep: rgba(235, 235, 245, 0.09);
    --vd-fill: rgba(118, 118, 128, 0.24);
    --vd-sel: rgba(255, 255, 255, 0.14);
    --vd-sel-fg: #ffffff;
    --vd-txt3: #8b93a1;
    --vd-shadow: 0 24px 60px -20px rgba(0, 0, 0, 0.7);
    --vd-solid: #12151a;
    background-color: #0a0c0f;
    background-image:
      radial-gradient(42rem 42rem at 6% 8%, rgba(234, 179, 8, 0.32), transparent 60%),
      radial-gradient(40rem 40rem at 92% 12%, rgba(57, 132, 255, 0.3), transparent 60%),
      radial-gradient(40rem 40rem at 80% 96%, rgba(245, 66, 200, 0.24), transparent 60%),
      radial-gradient(36rem 36rem at 12% 92%, rgba(106, 201, 208, 0.24), transparent 62%);
  }

  /* ---------- Sidebar: floating glass ---------- */
  html[data-look='vidro'] .app-container .sidebar {
    left: 10px;
    top: calc(var(--banner-height, 0px) + 10px);
    height: calc(100dvh - var(--banner-height, 0px) - 20px);
    background: var(--vd-glass);
    border: 1px solid var(--vd-glass-bd);
    border-radius: 20px;
    box-shadow:
      inset 0 1px 0 rgba(255, 255, 255, 0.35),
      var(--vd-shadow);
    -webkit-backdrop-filter: blur(26px) saturate(1.6);
    backdrop-filter: blur(26px) saturate(1.6);
    /* No overflow: hidden here: it would clip .user-menu-popover (width calc(100% + 1.5rem)). */
  }

  html[data-look='vidro'] .app-container .vidro-sidebar-head {
    display: flex;
    align-items: center;
    gap: 9px;
    padding: 14px 16px 8px;
    min-width: 0;
  }

  html[data-look='vidro'] .app-container .vidro-sidebar-logo {
    display: flex;
    align-items: center;
    flex-shrink: 0;
    border-radius: 6px;
  }

  html[data-look='vidro'] .app-container .vidro-sidebar-logo img {
    height: 16px;
    width: auto;
    display: block;
  }

  html[data-look='vidro'] .app-container .vidro-sidebar-ws {
    display: flex;
    flex-direction: column;
    min-width: 0;
    line-height: 1.2;
    margin-left: auto;
    text-align: right;
  }

  html[data-look='vidro'] .app-container .vidro-sidebar-ws-name {
    font-size: 12px;
    font-weight: 600;
    color: var(--text-main);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  html[data-look='vidro'] .app-container .vidro-sidebar-ws-plan {
    font-size: 11px;
    color: var(--vd-txt3);
  }

  /* Rail: the mark only (the logo's left 22px), no workspace text. */
  html[data-look='vidro'] .app-container .sidebar--rail .vidro-sidebar-head {
    justify-content: center;
    padding: 14px 0 8px;
  }

  html[data-look='vidro'] .app-container .sidebar--rail .vidro-sidebar-logo {
    width: 22px;
    overflow: hidden;
  }

  html[data-look='vidro'] .app-container .sidebar--rail .vidro-sidebar-ws {
    display: none;
  }

  html[data-look='vidro'] .app-container .search-trigger--sidebar {
    display: flex;
    align-items: center;
    gap: 6px;
    width: calc(100% - 1.5rem);
    height: 30px;
    margin: 4px 0.75rem 6px;
    padding: 0 12px;
    box-sizing: border-box;
    border: 0;
    border-radius: 999px;
    background: var(--vd-fill);
    color: var(--vd-txt3);
    font: inherit;
    font-size: 13px;
    cursor: pointer;
  }

  html[data-look='vidro'] .app-container .search-trigger--sidebar .search-trigger-text {
    flex: 1;
    text-align: left;
    font-size: 13px;
  }

  html[data-look='vidro'] .app-container .search-trigger--sidebar .search-trigger-kbd {
    background: transparent;
    color: var(--vd-txt3);
    font-size: 11px;
    padding: 0;
  }

  html[data-look='vidro'] .app-container .sidebar--rail .search-trigger--sidebar {
    width: 36px;
    height: 36px;
    margin: 4px auto 6px;
    padding: 0;
    justify-content: center;
  }

  html[data-look='vidro'] .app-container .sidebar--rail .search-trigger--sidebar .search-trigger-text,
  html[data-look='vidro'] .app-container .sidebar--rail .search-trigger--sidebar .search-trigger-kbd {
    display: none;
  }

  html[data-look='vidro'] .app-container .sidebar-group-label {
    text-transform: none;
    letter-spacing: 0;
    font-size: 11px;
    font-weight: 600;
    color: var(--vd-txt3);
  }

  html[data-look='vidro'] .app-container .sidebar-sub-link {
    min-height: 30px;
    border-radius: 10px;
    color: var(--text-main);
  }

  html[data-look='vidro'] .app-container .sidebar-sub-link:hover {
    background: var(--vd-fill);
  }

  html[data-look='vidro'] .app-container .sidebar-sub-link.active {
    background: var(--vd-sel);
    color: var(--vd-sel-fg);
    box-shadow: 0 4px 12px -4px rgba(18, 21, 26, 0.35);
  }

  html[data-look='vidro'] .app-container .sidebar-sub-link.active i {
    color: #ffbf30;
  }

  html[data-look='vidro'] .app-container .sidebar-bottom {
    border-top-color: var(--vd-sep);
  }

  /* ---------- Panel ---------- */
  html[data-look='vidro'] .app-container .vidro-panel {
    position: fixed;
    top: calc(var(--banner-height, 0px) + 10px);
    right: 10px;
    bottom: 10px;
    left: calc(10px + var(--sidebar-width) + 10px);
    display: flex;
    flex-direction: column;
    overflow: hidden;
    background: var(--vd-panel);
    border: 1px solid var(--vd-glass-bd);
    border-radius: 20px;
    box-shadow: var(--vd-shadow);
    transition: left 0.25s ease;
  }

  html[data-look='vidro'] .app-container .vidro-panel > .main-content {
    margin: 0;
    height: auto;
    flex: 1 1 auto;
    min-height: 0;
    border-radius: 0;
    background: transparent;
    padding: 4px clamp(1rem, 2.4vw, 2rem) clamp(1.25rem, 3vw, 2.5rem);
  }

  html[data-look='vidro'] .app-container .vidro-panel > .main-content:has(> .page-full-bleed) {
    margin: 0;
    padding: 0;
    border-radius: 0;
  }

  /* ---------- Toolbar ---------- */
  html[data-look='vidro'] .app-container .vidro-toolbar {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px 12px;
    min-height: 60px;
    padding: 10px 14px 10px 22px;
    box-sizing: border-box;
    flex-shrink: 0;
  }

  /* 240px basis: the right cluster wraps to its own line exactly when it cannot fit beside it. */
  html[data-look='vidro'] .app-container .vidro-toolbar-left {
    display: flex;
    align-items: center;
    gap: 10px;
    flex: 1 1 240px;
    min-width: 0;
  }

  html[data-look='vidro'] .app-container .vidro-toolbar-title {
    margin: 0;
    font-family: var(--font-heading);
    font-size: 22px;
    font-weight: 700;
    letter-spacing: -0.01em;
    line-height: 1.2;
    color: var(--text-main);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    min-width: 0;
    flex: 0 1 auto;
  }

  html[data-look='vidro'] .app-container .vidro-toolbar-subtitle {
    font-size: 12px;
    color: var(--vd-txt3);
    min-width: 0;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    flex: 0 1 auto;
  }

  html[data-look='vidro'] .app-container .vidro-toolbar-right {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: flex-end;
    gap: 8px;
    flex: 0 0 auto;
    margin-left: auto;
  }

  html[data-look='vidro'] .app-container .vidro-toolbar [data-slot='button'] {
    margin-bottom: 0;
  }

  /* ---------- Shell capsule ---------- */
  html[data-look='vidro'] .app-container .vidro-capsule {
    display: inline-flex;
    align-items: center;
    gap: 2px;
    height: 40px;
    padding: 0 3px;
    box-sizing: border-box;
    border-radius: 999px;
    background: var(--vd-cap);
    border: 1px solid var(--vd-cap-bd);
    box-shadow:
      0 6px 16px -8px rgba(18, 21, 26, 0.25),
      inset 0 1px 0 rgba(255, 255, 255, 0.4);
    -webkit-backdrop-filter: blur(18px) saturate(1.6);
    backdrop-filter: blur(18px) saturate(1.6);
  }

  html[data-look='vidro'] .app-container .vidro-capsule-btn {
    position: relative;
    width: 34px;
    height: 34px;
    border: 0;
    border-radius: 999px;
    background: transparent;
    color: var(--text-light);
    display: inline-flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
  }

  html[data-look='vidro'] .app-container .vidro-capsule-btn:hover {
    background: var(--vd-fill);
    color: var(--text-main);
  }

  html[data-look='vidro'] .app-container .vidro-capsule-btn:focus-visible {
    outline: 2px solid var(--primary-color);
    outline-offset: 1px;
  }

  html[data-look='vidro'] .app-container .vidro-capsule-btn .unread-dot {
    position: absolute;
    top: 6px;
    right: 6px;
    width: 8px;
    height: 8px;
    border-radius: 50%;
    border: 2px solid var(--vd-cap-ring);
    background: var(--primary-color);
  }

  /* ---------- Floating corner, report editor rail ---------- */
  html[data-look='vidro'] .app-container .guide-pill {
    right: 30px;
    bottom: 30px;
  }

  html[data-look='vidro'] .app-container .context-help {
    right: 30px;
    bottom: 30px;
  }

  html[data-look='vidro'] body:has(.guide-pill) .app-container .context-help {
    bottom: 82px;
  }

  html[data-look='vidro'] .app-container .rb-layers-rail {
    top: calc(var(--banner-height, 0px) + 10px + 60px + 16px);
    right: 26px;
    max-height: calc(100vh - var(--banner-height, 0px) - 10px - 60px - 42px);
  }

  /* ---------- Content: groups, tiles, segmented, pills ---------- */
  html[data-look='vidro'] .app-container .card:not(.card-blue):not(.card-yellow):not(.card-teal):not(.card-dark) {
    background: var(--vd-group);
    border: 1px solid var(--vd-sep);
    box-shadow: none;
    border-radius: 16px;
  }

  html[data-look='vidro'] .app-container .card .card {
    background: var(--vd-fill);
    border-color: transparent;
  }

  html[data-look='vidro'] .app-container .kpi-grid {
    gap: 12px;
    background: transparent;
    border: 0;
    box-shadow: none;
    overflow: visible;
  }

  html[data-look='vidro'] .app-container .kpi-card {
    background: var(--vd-tile);
    border: 0;
    border-radius: 16px;
    box-shadow: none;
  }

  html[data-look='vidro'] .app-container .kpi-card--filler {
    background: transparent;
  }

  html[data-look='vidro'] .app-container .kpi-grid > .kpi-card:hover,
  html[data-look='vidro'] .app-container button.kpi-card--clickable:hover {
    background: var(--vd-fill);
  }

  html[data-look='vidro'] .app-container .kpi-card[data-active='true'] {
    box-shadow: inset 0 0 0 2px var(--primary-color);
  }

  html[data-look='vidro'] .app-container .page-tabs,
  html[data-look='vidro'] .app-container .calendar-tabs,
  html[data-look='vidro'] .app-container .board-tabs,
  html[data-look='vidro'] .app-container .agenda-segmented,
  html[data-look='vidro'] .app-container .vidro-seg,
  html[data-look='vidro'] .app-container [data-slot='tabs-list'] {
    display: inline-flex;
    align-items: center;
    gap: 0;
    width: fit-content;
    max-width: 100%;
    padding: 2px;
    border: 0;
    border-bottom: 0;
    border-radius: 999px;
    background: var(--vd-fill);
  }

  html[data-look='vidro'] .app-container .page-tab,
  html[data-look='vidro'] .app-container .calendar-tab,
  html[data-look='vidro'] .app-container .board-tab:not(.board-tab-add),
  html[data-look='vidro'] .app-container .agenda-segmented__item,
  html[data-look='vidro'] .app-container .vidro-seg-btn,
  html[data-look='vidro'] .app-container [data-slot='tabs-trigger'] {
    border: 0;
    border-radius: 999px;
    padding: 6px 14px;
    background: transparent;
    color: var(--text-main);
    font-family: var(--font-main);
    font-size: 13px;
    font-weight: 500;
    letter-spacing: 0;
    text-transform: none;
    box-shadow: none;
    cursor: pointer;
  }

  html[data-look='vidro'] .app-container .page-tab.active,
  html[data-look='vidro'] .app-container .calendar-tab.active,
  html[data-look='vidro'] .app-container .board-tab.active:not(.board-tab-add),
  html[data-look='vidro'] .app-container .agenda-segmented__item[data-state='on'],
  html[data-look='vidro'] .app-container .vidro-seg-btn[aria-pressed='true'],
  html[data-look='vidro'] .app-container .vidro-seg-btn[aria-selected='true'],
  html[data-look='vidro'] .app-container [data-slot='tabs-trigger'][data-state='active'] {
    background: var(--vd-sel);
    color: var(--vd-sel-fg);
  }

  html[data-look='vidro'] .app-container .calendar-tab.active::after,
  html[data-look='vidro'] .app-container .board-tab.active::after {
    display: none;
  }

  html[data-look='vidro'] .app-container [data-slot='button'],
  html[data-look='vidro'] .app-container .btn-primary,
  html[data-look='vidro'] .app-container .btn-secondary,
  html[data-look='vidro'] .app-container .btn-danger,
  html[data-look='vidro'] .app-container .btn-danger-outline,
  html[data-look='vidro'] .app-container .btn-icon,
  html[data-look='vidro'] .app-container .btn-icon--danger,
  html[data-look='vidro'] .app-container .btn-upgrade {
    border-radius: 999px;
  }
}

/* Reduced transparency / no backdrop-filter: opaque surfaces. */
@media (min-width: 1101px) and (prefers-reduced-transparency: reduce) {
  html[data-look='vidro'] .app-container .sidebar,
  html[data-look='vidro'] .app-container .vidro-capsule {
    background: var(--vd-solid);
    -webkit-backdrop-filter: none;
    backdrop-filter: none;
  }
}

@supports not ((backdrop-filter: blur(1px)) or (-webkit-backdrop-filter: blur(1px))) {
  @media (min-width: 1101px) {
    html[data-look='vidro'] .app-container .sidebar,
    html[data-look='vidro'] .app-container .vidro-capsule {
      background: var(--vd-solid);
    }
  }
}

/* Analytics de Fluxos print: its actions and period tabs live in the toolbar under Vidro. */
@media print {
  html[data-look='vidro'] body:has(.analytics-fluxos-page) .vidro-toolbar-right {
    display: none;
  }

  html[data-look='vidro'] body:has(.analytics-fluxos-page) .vidro-toolbar {
    padding: 0 0 12px;
  }

  /* The panel is fixed + overflow hidden with .main-content as the scroller: reset all of it so the
     whole report prints, not the first screen. */
  html[data-look='vidro'] body:has(.analytics-fluxos-page) .app-container {
    background: #fff;
    height: auto;
    overflow: visible;
  }

  html[data-look='vidro'] body:has(.analytics-fluxos-page) .vidro-panel {
    position: static;
    display: block;
    overflow: visible;
    border: 0;
    border-radius: 0;
    box-shadow: none;
    background: #fff;
  }

  html[data-look='vidro'] body:has(.analytics-fluxos-page) .vidro-panel > .main-content {
    overflow: visible;
    height: auto;
  }
}
```

The contract test's 1101px check matches `/min-width:\s*1101px/` in any enclosing `@media`, so the
reduced-transparency block and the `@supports > @media` block pass. The Agenda control is a Radix
ToggleGroup: items are `.agenda-segmented__item` with `data-state='on'` (AgendaView.tsx:244-262), hence
those selectors. Add a contract-test case asserting the print block contains a `.vidro-panel` rule with
`position: static`.

- [ ] **Step 4: Run the tests and confirm they pass**

```bash
npx vitest run apps/crm/src/__tests__/vidroContracts.test.ts apps/crm/src/components/ui/__tests__/dataSlots.test.tsx apps/crm/src/__tests__/mobileResponsiveFinalContracts.test.ts
npx tsc -p apps/crm/tsconfig.json --noEmit
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/crm/src/styles/vidro.css apps/crm/src/__tests__/vidroContracts.test.ts apps/crm/src/components/ui/__tests__/dataSlots.test.tsx apps/crm/src/main.tsx apps/crm/src/components/ui/button.tsx apps/crm/src/components/ui/tabs.tsx
git commit -m "feat(crm): vidro.css shell and content look, data-slot hooks, contract test"
```

---

### Task 6: Shell integration (AppLayout, Sidebar, `useVidro`, search variant, i18n)

**Files:**
- Create: `apps/crm/src/hooks/useVidro.ts`
- Test: `apps/crm/src/hooks/__tests__/useVidro.test.tsx`
- Modify: `apps/crm/src/components/layout/AppLayout.tsx` (render tree ~:202-268, Crisp effect :198-200)
- Modify: `apps/crm/src/components/layout/Sidebar.tsx` (props, workspace query :126-135, pin row
  :296-310, theme item :461-470, workspace switch :159-169)
- Modify: `apps/crm/src/components/layout/GlobalSearchTrigger.tsx`
- Modify: `packages/i18n/locales/pt/common.json`, `packages/i18n/locales/en/common.json` (`sidebar.*`)
- Test: `apps/crm/src/components/layout/__tests__/AppLayout.test.tsx`,
  `apps/crm/src/components/layout/__tests__/Sidebar.test.tsx`,
  `apps/crm/src/components/layout/__tests__/GlobalSearchTrigger.test.tsx`

**Interfaces:**
- Consumes:
  - T1: `useWorkspaceLimits().isSuccess` and `features.feature_crm_vidro`.
  - T2: `readOptOut`, `writeOptOut`, `isVidroAttributeSet`, `applyVidro(on, userId)`,
    `clearVidroCache`, and the `'vidro_look_toggled'` event.
  - T3: `PageToolbarProvider` and `PageToolbar`.
  - T4: `ensureCrispListeners` and `TopBarActions variant="capsule"`.
- Produces:
  - `useVidro(): { enabled: boolean; active: boolean; optedOut: boolean; setOptedOut(v: boolean): void }`.
  - Sidebar props `vidroShell?: boolean` and
    `look?: { enabled: boolean; optedOut: boolean; onToggle: () => void }`.
  - `GlobalSearchTrigger` props `{ variant?: 'topbar' | 'sidebar' }`.

- [ ] **Step 1: Write the failing tests**

`apps/crm/src/hooks/__tests__/useVidro.test.tsx`. Mock `useWorkspaceLimits`, `useAuth` and
`captureEvent`:

```tsx
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const limits = { features: null as Record<string, boolean> | null, isSuccess: false };
vi.mock('@/hooks/useWorkspaceLimits', () => ({ useWorkspaceLimits: () => limits }));
vi.mock('@/context/AuthContext', () => ({ useAuth: () => ({ user: { id: 'u1' } }) }));
vi.mock('@/lib/analytics', () => ({ captureEvent: vi.fn() }));

import { useVidro } from '../useVidro';
import { captureEvent } from '@/lib/analytics';

beforeEach(() => {
  limits.features = null;
  limits.isSuccess = false;
});
afterEach(() => {
  localStorage.clear();
  document.documentElement.removeAttribute('data-look');
});

describe('useVidro', () => {
  it('is off when the flag is absent and on when it is true', () => {
    limits.isSuccess = true;
    limits.features = {};
    const { result, rerender } = renderHook(() => useVidro());
    expect(result.current.active).toBe(false);
    limits.features = { feature_crm_vidro: true };
    rerender();
    expect(result.current.active).toBe(true);
    expect(document.documentElement.getAttribute('data-look')).toBe('vidro');
    expect(localStorage.getItem('look-vidro')).toBe('u1');
  });

  it('uses the pre-painted attribute while loading and does not touch the cache', () => {
    document.documentElement.setAttribute('data-look', 'vidro');
    localStorage.setItem('look-vidro', 'u1');
    const { result } = renderHook(() => useVidro());
    expect(result.current.active).toBe(true);
    expect(localStorage.getItem('look-vidro')).toBe('u1');
  });

  it('keeps vidro when a later refetch fails (success, then error with data kept)', () => {
    limits.isSuccess = true;
    limits.features = { feature_crm_vidro: true };
    const { result, rerender } = renderHook(() => useVidro());
    expect(result.current.active).toBe(true);
    // TanStack v5: a failed refetch sets status 'error' (isSuccess false) even with data present.
    limits.isSuccess = false;
    rerender();
    expect(result.current.active).toBe(true);
    expect(document.documentElement.getAttribute('data-look')).toBe('vidro');
    expect(localStorage.getItem('look-vidro')).toBe('u1');
  });

  it('keeps classic when a later refetch fails after resolving off', () => {
    limits.isSuccess = true;
    limits.features = {};
    const { result, rerender } = renderHook(() => useVidro());
    limits.isSuccess = false;
    limits.features = null;
    rerender();
    expect(result.current.active).toBe(false);
    expect(document.documentElement.hasAttribute('data-look')).toBe(false);
  });

  it('opt-out turns it off, stores per user and fires the event', () => {
    limits.isSuccess = true;
    limits.features = { feature_crm_vidro: true };
    const { result } = renderHook(() => useVidro());
    act(() => result.current.setOptedOut(true));
    expect(result.current.active).toBe(false);
    expect(result.current.enabled).toBe(true);
    expect(localStorage.getItem('look-optout:u1')).toBe('1');
    expect(document.documentElement.hasAttribute('data-look')).toBe(false);
    expect(captureEvent).toHaveBeenCalledWith('vidro_look_toggled', { on: false });
  });
});
```

The AppLayout test file already mocks TopBar, Sidebar and the rest. Extend it:
- Mock `@/hooks/useVidro` with a mutable `{ active, enabled, optedOut, setOptedOut }`.
- Mock `./PageToolbar` (or `../PageToolbar`, matching the file's mock paths) as
  `() => <div data-testid="page-toolbar" />`.
- Mock `./TopBarActions` as `({ variant }) => <div data-testid={'actions-' + variant} />`.
- Add these cases:
  - vidro active at desktop width (the file's existing desktop setup): `queryByTestId('topbar')` is
    null; `page-toolbar` exists inside `.vidro-panel`; `#app` is inside `.vidro-panel`; the mocked
    Sidebar received `vidroShell` true (expose it as `data-vidro-shell` in the mock).
  - vidro active at tablet width (the file's existing tablet setup): `topbar` exists; there is no
    `.vidro-panel`.
  - vidro inactive at desktop: `topbar` exists; there is no `.vidro-panel`.

`Sidebar.test.tsx` gets new cases, using the file's existing render helper and mocks:
- **`vidroShell` header:** with `vidroShell` and `collapsible`, plus a workspace query returning one
  row `{ workspace_id: <id>, workspaces: { id: <the mocked profile.conta_id>, name: 'Agência Norte' } }`
  (the header uses the switcher's own active test, Sidebar.tsx:364-365), the
  text "Agência Norte" renders. Mock `useWorkspaceLimits` with `planName: 'Pro'`; "Pro" renders. The
  account-menu workspace switcher section does not render (one row).
- **Search:** with `vidroShell`, `getAllByRole('button', { name: 'Buscar' })` (exact string) has length
  1, and clicking it opens the dialog. Sidebar.test.tsx has no QueryClientProvider, so mock the dialog:
  `vi.mock('../GlobalSearchDialog', () => ({ default: ({ open }: { open: boolean }) => (open ? <div role="dialog" /> : null) }))`.
- **Look item:** with `look={{ enabled: true, optedOut: false, onToggle }}` and `collapsible`, opening
  the account menu shows "Visual clássico"; clicking it calls `onToggle`. With `optedOut: true` it shows
  "Visual novo". With `collapsible` false (drawer), the item is absent. With `enabled: false`, it is
  absent.
- **Workspace switch:** the file has neither a `switchWorkspace` mock nor a `reload` stub, and jsdom
  does not implement `location.reload`. Add
  `vi.mock('@/store/workspace', () => ({ switchWorkspace: vi.fn().mockResolvedValue(undefined) }))`
  (match the import path Sidebar.tsx really uses) and stub `window.location` with
  `Object.defineProperty(window, 'location', { configurable: true, value: { ...window.location, reload: vi.fn(() => { keyAtReload = localStorage.getItem('look-vidro'); }) } })`,
  restoring it in `afterEach`. With two rows and `localStorage['look-vidro']='u1'`, click the other
  workspace; assert `reload` was called and `keyAtReload` is `null`.

In `GlobalSearchTrigger.test.tsx`, add one case: `variant="sidebar"` renders a button with class
`search-trigger--sidebar` and without class `search-trigger`, and the ⌘K keydown
(`fireEvent.keyDown(document, { key: 'k', metaKey: true })`) opens the dialog.

- [ ] **Step 2: Run the tests and confirm they fail**

```bash
npx vitest run apps/crm/src/hooks/__tests__/useVidro.test.tsx apps/crm/src/components/layout/__tests__/AppLayout.test.tsx apps/crm/src/components/layout/__tests__/Sidebar.test.tsx apps/crm/src/components/layout/__tests__/GlobalSearchTrigger.test.tsx
```

Expected: the new cases FAIL and the old ones still pass.

- [ ] **Step 3: Implement**

`apps/crm/src/hooks/useVidro.ts`:

```ts
import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '@/context/AuthContext';
import { useWorkspaceLimits } from '@/hooks/useWorkspaceLimits';
import { captureEvent } from '@/lib/analytics';
import { applyVidro, isVidroAttributeSet, readOptOut, writeOptOut } from '@/lib/vidroLook';

/**
 * Desktop "Vidro" look state (spec D1-D3). Call ONLY in AppLayout: it owns the html attribute.
 * The flag is read as `=== true` and only from a successful workspace-limits response; while that
 * is loading or after it failed, the attribute the pre-paint script set from the cache stands.
 */
export function useVidro() {
  const { user } = useAuth();
  const userId = user?.id ?? null;
  const { features, isSuccess } = useWorkspaceLimits();
  // Last resolved value: seeded from the pre-paint attribute, updated on every successful response.
  // A failed (re)fetch keeps it, so the shell never flips (and never remounts the page) on a 5xx.
  const [resolved, setResolved] = useState(isVidroAttributeSet);
  const [optedOut, setOptedOutState] = useState(() => readOptOut(userId));

  useEffect(() => {
    setOptedOutState(readOptOut(userId));
  }, [userId]);

  const flag = features?.feature_crm_vidro === true;
  useEffect(() => {
    if (isSuccess) setResolved(flag);
  }, [isSuccess, flag]);

  const enabled = isSuccess ? flag : resolved;
  const active = enabled && !optedOut;

  useEffect(() => {
    if (isSuccess) applyVidro(active, userId);
  }, [isSuccess, active, userId]);

  const setOptedOut = useCallback(
    (v: boolean) => {
      if (!userId) return;
      writeOptOut(userId, v);
      setOptedOutState(v);
      applyVidro(enabled && !v, userId);
      captureEvent('vidro_look_toggled', { on: !v });
    },
    [userId, enabled],
  );

  return { enabled, active, optedOut, setOptedOut };
}
```

Check the import path `@/context/AuthContext`: Sidebar imports `useAuth` from
`../../context/AuthContext`, and the `@/` alias maps to `src/`.

`GlobalSearchTrigger.tsx`:
- Accept `{ variant = 'topbar' }: { variant?: 'topbar' | 'sidebar' }`.
- The button's `className` becomes
  `variant === 'sidebar' ? 'search-trigger--sidebar' : 'search-trigger'`.
- In the sidebar variant also pass `aria-label={t('topbar.search', 'Buscar...').replace('...', '')}`.
  The rail hides the text, so the button needs an accessible name. Use the literal `aria-label="Buscar"`
  if the replace reads poorly.
- Everything else, including the ⌘K effect, is unchanged.

`AppLayout.tsx`:
1. Add imports:
   - `useVidro` from `../../hooks/useVidro`;
   - `PageToolbarProvider` from `./PageToolbarContext`;
   - `PageToolbar` from `./PageToolbar`;
   - `TopBarActions` from `./TopBarActions`;
   - `NavigationProgress` from `./NavigationProgress`;
2. After `const sidebarCollapsible = ...` add:
   ```ts
   const vidro = useVidro();
   const vidroShell = vidro.active && sidebarCollapsible;
   ```
3. Leave the Crisp `chat:hide` effect as it is. Do **not** call `ensureCrispListeners()` here: today
   the listeners are registered only where `TopBarActions` mounts (never on phones), and registering
   them in AppLayout would change phone behaviour (closing Crisp would hide the bubble). `TopBarActions`
   calls it on mount in both variants; the once-guard covers shell swaps.
4. Move the existing `<main className="main-content" id="app">…</main>` JSX, unchanged, into
   `const mainContent = (…)` above the `return`.
5. Wrap `<div className="app-container" …>` in `<PageToolbarProvider vidroShell={vidroShell}>`, inside
   `PhoneLayoutContext.Provider`.
6. Change the top-bar branch to
   `{isMobile ? (!phoneChrome.chrome.pageHeader && <PhoneShellHeader />) : vidroShell ? null : (<TopBar … />)}`.
7. Pass `vidroShell` and `look` to `Sidebar`:
   ```tsx
   <Sidebar
     … existing props …
     vidroShell={vidroShell}
     look={{ enabled: vidro.enabled, optedOut: vidro.optedOut, onToggle: () => vidro.setOptedOut(!vidro.optedOut) }}
   />
   ```
8. Replace the inline `<main>` with:
   ```tsx
   {vidroShell ? (
     <div className="vidro-panel">
       <NavigationProgress />
       <PageToolbar capsule={<TopBarActions variant="capsule" />} />
       {mainContent}
     </div>
   ) : (
     mainContent
   )}
   ```
   With the flag off, the DOM is exactly today's.

`Sidebar.tsx`:
1. Props: add `vidroShell?: boolean` and
   `look?: { enabled: boolean; optedOut: boolean; onToggle: () => void }` to the props interface and
   the destructuring, both defaulting to `undefined`.
2. Workspace query (:126-135): store every row, not only when there are more than one. Change
   `if (data && data.length > 1) setWorkspaces(data);` to `if (data) setWorkspaces(data);`. The
   switcher's render gate `workspaces.length > 1` (:360) stays as it is, so single-workspace menus are
   unchanged. Derive:
   ```ts
   const activeWorkspaceName =
     workspaces.find(
       (m: any) => m.workspaces?.id === (profile?.active_workspace_id || profile?.conta_id),
     )?.workspaces?.name ?? null;
   ```
   Check that `profile` is already read from `useAuth()` in this file. If not, add it to the existing
   destructuring.
3. Plan name: `const { planName } = useWorkspaceLimits();`, imported from `../../hooks/useWorkspaceLimits`.
   If `features` already comes from a hook in this file, reuse that hook's return value.
4. Header and search. Inside `<div className="sidebar-wrapper">`, before the pin row:
   ```tsx
   {vidroShell && (
     <div className="vidro-sidebar-head">
       <Link to="/dashboard" className="vidro-sidebar-logo" aria-label="Mesaas, ir para o início">
         <img src={isDark ? '/logo-white.svg' : '/logo-black.svg'} alt="" />
       </Link>
       {(activeWorkspaceName || planName) && (
         <div className="vidro-sidebar-ws">
           {activeWorkspaceName && <span className="vidro-sidebar-ws-name">{activeWorkspaceName}</span>}
           {planName && <span className="vidro-sidebar-ws-plan">{planName}</span>}
         </div>
       )}
     </div>
   )}
   ```
   After the pin row, before `.sidebar-scrollable`: `{vidroShell && <GlobalSearchTrigger variant="sidebar" />}`.
   Import `Link` from `react-router-dom` and `GlobalSearchTrigger` from `./GlobalSearchTrigger`.
5. Look item. Directly after the theme toggle button (:461-470):
   ```tsx
   {look?.enabled && collapsible && (
     <button
       className="user-dropdown-item"
       onClick={(e) => {
         e.stopPropagation();
         look.onToggle();
       }}
     >
       <i className={`ph-bold ${look.optedOut ? 'ph-sparkle' : 'ph-squares-four'}`} />
       <span>{look.optedOut ? t('sidebar.lookNew') : t('sidebar.lookClassic')}</span>
     </button>
   )}
   ```
6. Workspace switch: in `handleWorkspaceSwitch`, call `clearVidroCache();` (from `../../lib/vidroLook`)
   right before `window.location.reload();`.

i18n, `sidebar` object:
- pt: `"lookClassic": "Visual clássico"`, `"lookNew": "Visual novo"`.
- en: `"lookClassic": "Classic look"`, `"lookNew": "New look"`.

- [ ] **Step 4: Run the tests and confirm they pass**

```bash
npx vitest run apps/crm/src/hooks/__tests__/useVidro.test.tsx apps/crm/src/components/layout
npx tsc -p apps/crm/tsconfig.json --noEmit
npx eslint apps/crm/src/hooks/useVidro.ts apps/crm/src/components/layout
```

Expected: PASS, including every pre-existing AppLayout, Sidebar and TopBarActions assertion.

- [ ] **Step 5: Commit**

```bash
git add apps/crm/src/hooks/useVidro.ts apps/crm/src/hooks/__tests__/useVidro.test.tsx apps/crm/src/components/layout packages/i18n/locales/pt/common.json packages/i18n/locales/en/common.json
git commit -m "feat(crm): Vidro desktop shell: glass sidebar header + search, panel, toolbar, look toggle"
```

---

## Migration recipe (used by Tasks 7-13)

Each page task applies this recipe to the pages it lists.

**Recipe:**
1. Import `usePageToolbar` from `@/components/layout/PageToolbarContext`.
2. Lift the header's pieces into constants above the first early return. Reuse today's JSX elements
   exactly: the same props, `FeatureGate` wrappers and `data-tour` attributes.
   ```tsx
   const infoTooltip = (/* the existing info icon element from the header */);
   const headerActions = (<>{/* existing secondary buttons, in today's order */}</>);
   const primaryAction = (/* the existing primary button */);
   ```
   A constant that depends on data that only exists after loading becomes `null` until then.
3. Call the hook above every early return:
   ```tsx
   const inToolbar = usePageToolbar(
     loading ? null : {
       title: /* today's h1 text or node */,
       titleAccessory: infoTooltip,
       subtitle: /* today's subtitle p content, or undefined */,
       actions: headerActions,
       primary: primaryAction,
     },
   );
   ```
   Use whatever loading condition the page already uses for its skeleton. Pages without a skeleton pass
   the spec directly.
4. Render the in-page header only when `!inToolbar`, using the same constants, so the classic markup is
   byte-identical:
   ```tsx
   {!inToolbar && (
     <div className="header">…today's JSX with {infoTooltip}{headerActions}{primaryAction}…</div>
   )}
   ```
5. A switcher assigned to `segmented` moves the same way: a constant, rendered in the content only
   when `!inToolbar`.
6. **Test.** In the page's existing test file (or a new `__tests__/<Page>.vidro.test.tsx` beside it,
   reusing that file's mocks and render helper), wrap the render in `VidroToolbarHarness` from
   `@/test/vidroToolbar`.
   **Mock desktop width first.** `test/vitest.setup.ts` stubs `matchMedia` to `matches: false`, so
   `useIsDesktop` returns false and the page renders its phone branch. In the vidro cases make
   `window.matchMedia` return `matches: true` for `min-width` queries (copy the desktop setup from
   `ClientesPage.test.tsx:42` or `EntregasPage.test.tsx:22`; pages with only a `.phone.test.tsx`, such as
   Financeiro and Contratos, need this written). Then assert:
   ```tsx
   const h1s = await screen.findAllByRole('heading', { level: 1 });
   expect(h1s).toHaveLength(1);
   expect(h1s[0].closest('.vidro-toolbar')).not.toBeNull();
   expect(h1s[0]).toHaveTextContent(/* title */);
   // every action once:
   expect(screen.getAllByRole('button', { name: /* primary label */ })).toHaveLength(1);
   ```
   Add one more case wrapped in `VidroToolbarHarness vidroShell={false}` asserting the in-page header
   h1 renders and no `.vidro-toolbar` exists. Every existing test must pass unchanged.
7. **Run.** `npx vitest run <the page's test files>` and
   `npx tsc -p apps/crm/tsconfig.json --noEmit`. Commit only the page files and their tests.

**Rules:**
- Never edit `style.css` or `vidro.css` in a page task. If a page needs CSS, record it in the task
  report for T14.
- Page actions may depend only on app-wide providers (spec, "Provider rule"). If a header element reads
  a page-local context, stop and report it.

---

### Task 7: Início, Clientes, Leads

**Files:**
- Modify: `apps/crm/src/pages/dashboard/DashboardPage.tsx` (~:113)
- Modify: `apps/crm/src/pages/dashboard/components/ClientHealthMonitor.tsx:36-38`
- Modify: `apps/crm/src/pages/clientes/ClientesPage.tsx` (~:360-420)
- Modify: `apps/crm/src/pages/leads/LeadsPage.tsx` (~:449-480)
- Tests: beside each page.

**Interfaces:** consumes `usePageToolbar` and `VidroToolbarHarness` (T3).

- [ ] **Step 1: Write the failing tests** (recipe step 6) for all three pages. Add a ClientHealthMonitor
  assertion in `dashboard/components/__tests__/ClientHealthMonitor.test.tsx` (DashboardPage.test.tsx
  mocks the component): "Saúde dos clientes" is a level-2 heading.
- [ ] **Step 2: Run the tests and confirm they fail.**
- [ ] **Step 3: Implement**
  - **Início:** `usePageToolbar({ title: 'Início', subtitle: <today's date> })`. Build the subtitle with
    `format(new Date(), "EEEE, d 'de' MMMM", { locale: ptBR })` from `date-fns`, capitalising the first
    letter. Início has no in-page header, so nothing is hidden.
  - **ClientHealthMonitor:** change its `<h1>` to `<h2>`. `.header-title h1, .header-title h2` share one
    rule (style.css:1005-1012), so the classic look is identical. If a test asserts level 1, update it.
  - **Clientes:**
    - title `t('title')`;
    - subtitle: the `UsageMeter` element (:375);
    - accessory: the info `data-tooltip` icon (:367);
    - actions: the CSV HelpCircle tooltip (:388) and both Import buttons (:404/:411);
    - primary: "Novo cliente" (:418).
  - **Leads:** the same shape (:449-480). The primary is "Novo lead".
- [ ] **Step 4: Run the tests and confirm they pass**, plus `npx tsc -p apps/crm/tsconfig.json --noEmit`.
- [ ] **Step 5: Commit:** `git commit -m "feat(crm): Início, Clientes and Leads fill the Vidro toolbar"`

### Task 8: Financeiro, Contratos, Equipe, MembroDetalhe

**Files:**
- Modify: `apps/crm/src/pages/financeiro/FinanceiroPage.tsx` (~:638-690)
- Modify: `apps/crm/src/pages/contratos/ContratosPage.tsx` (~:561-590)
- Modify: `apps/crm/src/pages/equipe/EquipePage.tsx` (~:268-300)
- Modify: `apps/crm/src/pages/membro-detalhe/MembroDetalhePage.tsx` (~:114-130)
- Tests: beside each page.

- [ ] **Step 1: Write the failing tests** (recipe step 6).
- [ ] **Step 2: Run the tests and confirm they fail.**
- [ ] **Step 3: Implement**
  - **Financeiro:**
    - title "Financeiro";
    - accessory: info (:644);
    - actions: the CSV HelpTooltip (:653), the Import pair and **Saída**;
    - primary: **Entrada** (:685-690).
  - **Contratos:**
    - title "Contratos";
    - accessory: info (:567);
    - actions: the CSV HelpCircle (:576) and Import;
    - primary: "Novo Contrato".
  - **Equipe:**
    - title "Equipe";
    - accessory: the HelpTooltip info (:274);
    - actions: the CSV HelpTooltip and the Import pair;
    - primary: "Adicionar Membro".
  - **MembroDetalhe:**
    - leading: the existing "Voltar" button;
    - title: the member's name, from the same source the content `h2` (:160) uses. Pass `null` while
      the member loads;
    - primary: "Editar".
    - The content `h2` stays.
- [ ] **Step 4: Run the tests and confirm they pass**, plus tsc.
- [ ] **Step 5: Commit:** `git commit -m "feat(crm): Financeiro, Contratos, Equipe and Membro fill the Vidro toolbar"`

### Task 9: Ideias, Automações, Ajuda, Ajuda seção, Post Express, Importar

**Files:**
- Modify: `apps/crm/src/pages/ideias/IdeiasPage.tsx` (~:220)
- Modify: `apps/crm/src/pages/automacoes/AutomacoesPage.tsx` (~:540-560)
- Modify: `apps/crm/src/pages/ajuda/AjudaPage.tsx` (~:62)
- Modify: `apps/crm/src/pages/ajuda/SecaoPage.tsx` (~:84)
- Modify: `apps/crm/src/pages/post-express/ExpressPostPage.tsx` (~:512-528)
- Modify: `apps/crm/src/pages/importar/ImportarPage.tsx` (~:450)
- Tests: beside each page.

- [ ] **Step 1: Write the failing tests** (recipe step 6). For Automações, also assert
  `document.querySelectorAll('[data-tour="nova-automacao"]').length === 1` with vidro on.
- [ ] **Step 2: Run the tests and confirm they fail.**
- [ ] **Step 3: Implement**
  - **Ideias:** title "Ideias"; accessory: info; primary: "Nova ideia". Today the button is a direct
    child of `.header`; keep that structure in the classic branch.
  - **Automações:**
    - title `t('title')`;
    - primary: the `FeatureGate`-wrapped "Nova automação" with `data-tour="nova-automacao"`, moved
      unchanged;
    - the hint `p` (:557) and the shadcn Tabs (:564) stay in content;
    - the gate screens (skeleton, UpgradeLockedScreen) register `null`.
  - **Ajuda:** title "Central de Ajuda".
  - **Seção:** title = the category label. The back link above the header stays in content.
  - **Post Express:** title `t('title')`; subtitle `t('subtitle')`. Hide only the inline header block
    (div + h1 + p).
  - **Importar:** title "Importar dados". Hide the `h1.text-2xl`; the `ol` step list stays in content.
- [ ] **Step 4: Run the tests and confirm they pass**, plus tsc.
- [ ] **Step 5: Commit:** `git commit -m "feat(crm): Ideias, Automações, Ajuda, Post Express and Importar fill the Vidro toolbar"`

### Task 10: Tarefas and Calendário

**Files:**
- Modify: `apps/crm/src/pages/tarefas/TarefasPage.tsx` (header :237, view tabs :274-300, scope switch
  ~:326, early return ~:131)
- Modify: `apps/crm/src/pages/calendario/CalendarioPage.tsx` (classic header :680, `.calendar-tabs`
  :689, Agenda header :758)
- Tests: beside each page.

- [ ] **Step 1: Write the failing tests** (recipe step 6). For Tarefas, also check two things:
  - with vidro, the scope switch renders once, inside `.vidro-toolbar`, as a `.vidro-seg` element;
  - with vidro, the view tabs render in content with class `vidro-seg`, not inline `background`, and
    switching a tab still changes the view.
- [ ] **Step 2: Run the tests and confirm they fail.**
- [ ] **Step 3: Implement**
  - **Tarefas:**
    - title "Tarefas"; subtitle: the counts `p` content; primary: "Nova tarefa";
    - segmented: the minhas/todas scope switch;
    - under `inToolbar`, render the scope switch and the view tabs with
      `className="vidro-seg"` / `className="vidro-seg-btn"` instead of their inline `style` objects.
      Keep the same `role`, `aria-*` and handlers, and set `aria-pressed` (or `aria-selected` for
      `role="tab"`) to the active state;
    - the classic branch keeps the inline styles byte-identical.
  - **Calendário (classic):** title and subtitle from today's header; segmented: the `.calendar-tabs`
    element, as is.
  - **Calendário (Agenda):** title "Agenda" and its subtitle. The `.agenda-toolbar` stays inside
    `AgendaView`.
  - **Both branches** call the hook unconditionally at the top of the component. The flag-dependent
    choice of spec happens inside the argument.
- [ ] **Step 4: Run the tests and confirm they pass**, plus tsc.
- [ ] **Step 5: Commit:** `git commit -m "feat(crm): Tarefas and Calendário fill the Vidro toolbar"`

### Task 11: Entregas

**Files:**
- Modify: `apps/crm/src/pages/entregas/EntregasPage.tsx` (early return ~:1311, header :1434-1530,
  view tabs :1619-1660)
- Tests: `apps/crm/src/pages/entregas/__tests__/` (existing) plus a new vidro case.

- [ ] **Step 1: Write the failing tests** (recipe step 6). Also assert:
  - with vidro, `document.querySelectorAll('[data-tour="novo-fluxo-btn"]').length === 1`;
  - the live counts subtitle is inside `.vidro-toolbar-subtitle`;
  - the view tabs are inside `.vidro-toolbar` as `.vidro-seg`, and clicking "Lista" switches the view.
- [ ] **Step 2: Run the tests and confirm they fail.**
- [ ] **Step 3: Implement**
  - title "Entregas";
  - subtitle: the live counts content of the `p` (:1482);
  - titleAccessory: the info tooltip (:1438), the "Como funciona" reopen button (:1453) and "Ver tour
    novamente" (:1462-1476), under exactly today's conditions (kanban plus entregas mode);
  - actions: the Templates pair (:1500-1515);
  - primary: the "Novo" dropdown (:1517) with its `data-tour`;
  - segmented: the VIEW_TABS tablist (:1619). Under `inToolbar` it renders with
    `.vidro-seg` / `.vidro-seg-btn` (keep `role="tablist"`/`role="tab"`, `aria-selected`, the handlers
    calling `setActiveView`). The classic branch keeps today's inline styles;
  - vistas, ModeToggle, EntidadeToggle and the list toolbar stay in content.
- [ ] **Step 4: Run the tests and confirm they pass**, plus tsc.
- [ ] **Step 5: Commit:** `git commit -m "feat(crm): Entregas fills the Vidro toolbar"`

### Task 12: Analytics, Analytics da conta, Analytics de Fluxos

**Files:**
- Modify: `apps/crm/src/pages/analytics/AnalyticsPage.tsx` (~:837)
- Modify: `apps/crm/src/pages/analytics-conta/AnalyticsContaPage.tsx` (early return ~:1534, header
  :1832-1880, not-connected branch :3347)
- Modify: `apps/crm/src/pages/analytics-fluxos/AnalyticsFluxosPage.tsx` (:197-250)
- Tests: beside each page.

- [ ] **Step 1: Write the failing tests** (recipe step 6).
- [ ] **Step 2: Run the tests and confirm they fail.**
- [ ] **Step 3: Implement**
  - **Analytics:** title "Analytics"; actions: the sync result text; primary: "Sincronizar".
  - **Analytics da conta:**
    - leading: the avatar element from `.conta-identity`;
    - title: the client name;
    - subtitle: the `@handle` link plus the cache note;
    - actions: "Voltar" and the sync icon button;
    - primary: "Gerar Relatório";
    - the period `.page-tabs--inline` and the custom days input stay in content;
    - the page is two components: the default export (:3274-3371) renders the not-connected header
      (:3347) or `<AnalyticsContent/>`, whose header is at :1832-1878 (early return :1534). The outer
      component must **not** call the hook. Register the main spec inside `AnalyticsContent` (above its
      early return, `null` while loading), and the not-connected spec
      `{ title: 'Analytics', actions: <Voltar/> }` from a small `NotConnectedToolbar` child that calls
      the hook and renders `null`, mounted only in that branch. Exactly one registration is ever live.
  - **Analytics de Fluxos:**
    - title "Analytics de Fluxos"; subtitle: "Fluxos concluídos no período" with its tooltip;
    - segmented: the period `.page-tabs--inline`;
    - actions: "Exportar CSV" and "Imprimir";
    - the selects stay in `.analytics-fluxos-toolbar`.
    - The print rule from T5 hides the toolbar's right side.
- [ ] **Step 4: Run the tests and confirm they pass**, plus tsc.
- [ ] **Step 5: Commit:** `git commit -m "feat(crm): Analytics pages fill the Vidro toolbar"`

### Task 13: Cliente detalhe, Configurações, Mensagens, Arquivos

**Files:**
- Modify: `apps/crm/src/pages/cliente-detalhe/ClienteDetalhePage.tsx` (:65, :146, :150, :193-218)
- Modify: `apps/crm/src/pages/cliente-detalhe/ClienteDetalheHeader.tsx` (:39)
- Modify: `apps/crm/src/pages/configuracao/ConfiguracaoLayout.tsx` (:151-186)
- Modify: `apps/crm/src/pages/mensagens/components/ConversationList.tsx` (:41-50),
  `apps/crm/src/pages/mensagens/MensagensPage.tsx` (:113)
- Modify: `apps/crm/src/pages/arquivos/ArquivosPage.tsx` (:803-812)
- Tests: beside each.

- [ ] **Step 1: Write the failing tests** (recipe step 6), plus:
  - ClienteDetalhe at a hub sub-route (for example `/clientes/1/marca`) under `VidroToolbarHarness` has
    exactly one `h1`, the toolbar's (the hub sub-pages' desktop titles are already `h2`);
  - Mensagens with vidro has no `h1` in the conversation pane, and the search input still renders.
- [ ] **Step 2: Run the tests and confirm they fail.**
- [ ] **Step 3: Implement**
  - **Cliente detalhe:** the layout page registers. Every child route renders under it, and children
    must not register.
    - leading: the back button and the avatar upload from `ClienteDetalheHeader`;
    - title: the client name;
    - subtitle: the plan and status badges;
    - primary: "Editar".
    - Pass the pieces out of `ClienteDetalheHeader`. The cleanest way is to export small components
      (`ClienteBackButton`, `ClienteAvatar`, `ClienteBadges`, `ClienteEditButton`) from that file and
      compose them in both places.
    - Hide the `cliente-detalhe-header` element under `inToolbar`. The vertical nav stays.
    - The hook is called before the early returns (:65, :146, :150) with `null` while loading.
  - **Hub sub-pages:** no change. Their desktop titles are already `h2`; their `h1`s live in phone-only
    branches that never render at ≥1101px.
  - **Configurações:** the layout registers `{ title: 'Configurações' }` and hides `config-shell-header`
    under `inToolbar`. The skeleton header at :64 also hides under `inToolbar`. The `config-nav` stays.
  - **Mensagens:** the info tooltip lives in `ConversationList.tsx:43-49`. Extract it into an exported
    `MensagensInfoTooltip` in that file and use it in both places. `MensagensPage` registers
    `{ title: 'Mensagens', titleAccessory: <MensagensInfoTooltip /> }` and passes `hideTitle={inToolbar}`
    to `ConversationList`, which then skips only its `h1` + info row (:41-50). Search and sort stay.
  - **Arquivos:** registers `{ title: 'Arquivos' }` and skips the aside's `h1` (:810) under `inToolbar`.
    The pane toolbar is untouched.
- [ ] **Step 4: Run the tests and confirm they pass**, plus tsc.
- [ ] **Step 5: Commit:** `git commit -m "feat(crm): Cliente, Configurações, Mensagens and Arquivos fill the Vidro toolbar"`

---

### Task 14: Verification, sweep, parity and PR (controller)

**Files:**
- Possibly modify: `apps/crm/src/styles/vidro.css`. Only for fixes the sweep finds, and only inside the
  guards.
- Create (scratchpad, not committed): a Playwright script modelled on the session's `shoot.mjs`.

- [ ] **Step 1: Gates.** Run `npm ci` first if `node_modules/.deno` exists. Then:
  ```bash
  npm run lint && npm run format:check
  npx tsc -p apps/crm/tsconfig.json --noEmit && npx tsc -p apps/hub/tsconfig.json --noEmit && npx tsc -p apps/admin/tsconfig.json --noEmit && npx tsc -p tsconfig.scripts.json
  npm run test && npm run check:functions && npm run test:functions
  ```
  Expected: all green. Fix failures in the owning task's files.
- [ ] **Step 2: Pre-paint matrix.** On the staging dev server (`crm-staging` launch config, with
  `.env.staging` copied into the worktree for the session and deleted afterwards), use Playwright with
  `context.route('**/functions/v1/workspace-limits', …)` installed **before** the first `goto`, serving
  `feature_crm_vidro` from a variable the script flips. Check:
  1. Flag on, cold load: classic first, then vidro, and `look-vidro` becomes the user's id.
  2. Reload: a screenshot at `domcontentloaded` already shows vidro.
  3. Flag off, then reload: one vidro paint, then classic, and the key is removed.
  4. Opt-out ("Visual clássico"), then reload: classic, and the key is removed.
  5. Sign out, then sign in: the key is removed and the first paint is classic.
  5b. With the key set for user A, sign in as user B in the same browser: the first paint is classic
      (the session's `user.id` does not match), then B's own resolve applies.
  6. A workspace switch, simulated by setting the key and calling the switch handler path: the key is
     removed before the reload.
- [ ] **Step 3: Sweep.**
  - At 1440×900 and 1101×800, light and dark, with the flag on, screenshot every migrated page:
    Início, Entregas (header plus board), Clientes, Cliente (visão geral plus a hub sub-page),
    Calendário, Tarefas, Leads, Ideias, Financeiro, Contratos, Equipe, Membro, Analytics, Analytics da
    conta, Analytics de Fluxos, Automações, Ajuda, Post Express, Importar, Configurações, Mensagens and
    Arquivos.
  - Also capture: one Sheet, one Dialog, the ⌘K search, the notification popover, the account menu
    with the look item, rail versus pinned, and the Analytics de Fluxos print preview
    (`page.emulateMedia({ media: 'print' })`).
  - At 1100px and 800px with the flag on: today's shell.
  - Known sweep items: `.rb-layers-rail` top assumes a one-line (60px) toolbar, so check a report editor
    at 1101px where the toolbar may wrap; the rail logo shows the wordmark's left 22px (there is no
    mark-only asset in `apps/crm/public`), so judge it and, if it reads badly, use the favicon mark
    instead; the account popover must not be clipped by the glass sidebar.
  - Fix any CSS gap in `vidro.css`, re-run `vidroContracts.test.ts`, and commit
    `fix(crm): vidro sweep fixes`.
- [ ] **Step 4: Flag-off parity.**
  - With the flag off, compare computed styles element by element for Início, Entregas, Clientes and
    Tarefas against an `origin/main` worktree on the same data. The recipe is in the memory note
    `reference-hub-fake-backend-visual-diff`.
  - Expected: 0 diffs. The only allowed DOM additions are the `data-slot` attributes.
- [ ] **Step 5: Publish the screenshots** to the owner's canvas (Design artifact
  https://claude.ai/artifact/Bt1KGGC2PLjqyH2QmVKGUo, a new section), as in the earlier rounds.
- [ ] **Step 6: Whole-branch review** by a Fable reviewer. Apply its fixes.
- [ ] **Step 7: PR.**
  - Rebase onto `origin/main` and confirm the migration version is still above main's tail.
  - Push and open the PR. The body lists:
    - the deploy order (migration staging then prod; redeploy `workspace-limits` and `platform-admin`,
      then `paywall-report`, `mcp-admin` and `data-import`; merge; pilot override);
    - pages left mixed;
    - the mockup gaps accepted in D6.
  - Do not deploy or merge; those steps belong to the owner.
