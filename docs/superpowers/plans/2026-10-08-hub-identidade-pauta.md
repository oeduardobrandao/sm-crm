# Hub "Pauta" visual identity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the client Hub its own visual identity ("Pauta") behind the per-workspace flag `plans.feature_hub_pauta`, leaving the current look ("classic") visually identical when the flag is off.

**Architecture:** One new plan flag flows `plans` → `hub-bootstrap` → `bootstrap.feature_hub_pauta`. `useHubLook()` reads it from `HubContext` (classic without a provider). `resolveHubTheme(config, dark, look)` emits the Pauta tokens (readable primary from the brand color, `PAUTA_WARM`, radius/status tokens). `HubShell` sets `data-hub-look="pauta"` on `.hub-root`; scoped CSS in `apps/hub/index.html` covers class-styled elements, and every inline-styled component branches in TSX. Home gets a separate `HomePagePauta` render branch; the CRM preview and font pickers follow the flag.

**Tech Stack:** React 19 + TanStack Query (Hub, CRM), hand-written `hub-*` CSS in `apps/hub/index.html`, `packages/hub-theme`, Supabase migrations + psql entitlement suites, Deno edge function `hub-bootstrap`, Vitest, react-i18next.

**Spec:** `docs/superpowers/specs/2026-10-08-hub-identidade-pauta-design.md` (read it before any task).
**Mockups:** https://claude.ai/artifact/ArhzoNmFpw1wg1oWXvuhFm (row "Direção A · Pauta", board "Fundamentos").

## Global Constraints

- Flag off = classic look unchanged: every existing CSS variable keeps today's value, every component renders today's markup and classes. Only exception: spinners (Task 10) change in both looks.
- Never read the flag in the CRM with `hasFeature`: always `features?.feature_hub_pauta === true`.
- `useHubLook()` uses `useContext(HubContext)`, never `useHub()`, and no new field is added to `HubContextValue`.
- Inline styles can't be overridden by CSS: inline-styled components branch in TSX and keep the classic branch byte-identical.
- An element that sets its own Pauta radius must NOT carry `hub-btn-primary`/`hub-btn-secondary` (the Pauta rule `:is(.hub-btn-primary,.hub-btn-secondary):not(.rounded-full)` at specificity (0,3,0) would override it). Use inline `background: var(--hub-primary); color: var(--hub-primary-fg)` instead.
- `index.html` CSS is NOT loaded in Vitest. Tests assert classes, attributes and inline styles only; computed radius/colour checks belong to the browser task (Task 12).
- Grid stays `grid-cols-2 sm:grid-cols-3`, 4:5, `gap-1`, no radius, in every preset. Mobile keeps the floating hamburger bar + right drawer.
- Copy: pt-BR and en, sentence case, **no em dash (—)** in user-facing strings.
- Migration version `20261012000001`; renumber above `main`'s tail right before `gh pr create` (`ls supabase/migrations | tail -1` on fresh `origin/main`).
- Before pushing: `npm run lint`, `npm run format:check`, the four `tsc` commands (`apps/crm`, `apps/hub`, `apps/admin`, `tsconfig.scripts.json`), `npm run test`, `npm run check:functions`, `npm run test:functions`. After any Deno run: `ls node_modules/.deno` and `npm ci` if it exists.
- Work in the worktree `/Users/eduardosouza/projects/sm-crm/.claude/worktrees/post-auto-schedule-approval-6efafc` (branch `claude/client-hub-design-3c780b`). Start every task with `pwd && git branch --show-current`.

## Task order and parallelism

| Wave | Tasks | Notes |
|---|---|---|
| 1 (parallel) | 1 Flag backend · 2 Flag clients (Admin, CRM type) · 3 hub-theme | no shared files |
| 2 (serial, after 1+3) | 4 Hub foundation (`useHubLook`, `HubShell`, CSS, status primitives) | everything in wave 3 consumes its exports |
| 3 (parallel, after 4; Task 11 only needs 2+3) | 5 Shell chrome · 6 PageHeader + filters + Aprovações · 7 PostCalendar · 8 Post surfaces · 9 Home Pauta · 11 CRM | disjoint files (see each task's **Files**) |
| 4 (serial) | 10 Spinners (after 5-9) · 12 Verification | 12 last |

File ownership in wave 3 (no two tasks edit the same file): Task 5 owns `HubSidebar.tsx`, `HubMobileNav.tsx`, `WorkspaceMark.tsx`, `shell/pautaNav.ts`, `common.json`. Task 6 owns `PageHeader.tsx`, `filterPill.ts`, `StatusFilterChips.tsx`, `FilterDropdown.tsx`, `FloatingFilterBar.tsx`, `AprovacoesPage.tsx` (non-spinner lines). Task 7 owns `PostCalendar.tsx`. Task 8 owns `PostCard.tsx`, `PostTile.tsx`, `StoriesRail.tsx`. Task 9 owns `HomePage.tsx`, `HomePagePauta.tsx`, `pages/home/*`, `components/SectionHeader.tsx`, `HomeAgendaPauta.tsx`, `DashboardSection.tsx`, `hubHome.json`, `hubAgenda.json`. Task 10 owns only the spinner line in 14 files; it runs **after** 5-9 finish (it touches `HomePage.tsx`, `AprovacoesPage.tsx`, `HubShell.tsx`) or is rebased onto them. Task 11 owns CRM files only.

---

### Task 1: Flag backend (migration, entitlements, hub-bootstrap, Hub type)

**Files:**
- Create: `supabase/migrations/20261012000001_feature_hub_pauta.sql`
- Create: `supabase/tests/entitlements/99_hub_pauta_flag.sql`
- Modify: `supabase/functions/_shared/entitlements.ts:13-23`
- Modify: `supabase/functions/hub-bootstrap/handler.ts:110-166`
- Modify: `supabase/functions/__tests__/hub-bootstrap_test.ts:147-186` (+ new tests)
- Modify: `apps/hub/src/types.ts:38` (`HubBootstrap`)

**Interfaces:**
- Produces: column `plans.feature_hub_pauta boolean NOT NULL DEFAULT false`; `FEATURE_COLUMNS` contains `"feature_hub_pauta"`; bootstrap JSON field `feature_hub_pauta: boolean`; TS `HubBootstrap.feature_hub_pauta?: boolean`; CHECKs accept `bricolage-grotesque` (display) and `figtree` (body).

- [ ] **Step 1: Write the psql suite (fails: column missing)**

`supabase/tests/entitlements/99_hub_pauta_flag.sql`:

```sql
\set ON_ERROR_STOP on
\i supabase/tests/entitlements/_helpers.sql

-- Hub "Pauta" rollout flag (feature_hub_pauta, 20261012000001). The column is
-- born false on every plan and is switched per workspace through
-- workspace_plan_overrides.feature_overrides. The same migration widens the
-- hub_font_* CHECKs with the "Assinatura" pair (bricolage-grotesque / figtree).

begin;
do $$
declare
  v_ws uuid;
  v_ok boolean;
begin
  assert exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'plans' and column_name = 'feature_hub_pauta'
                    and data_type = 'boolean' and is_nullable = 'NO' and column_default = 'false'),
    'plans.feature_hub_pauta is not boolean NOT NULL DEFAULT false';
  assert not exists (select 1 from plans where feature_hub_pauta), 'a plan has feature_hub_pauta on by default';

  v_ws := et_make_workspace('max');
  assert not effective_plan_feature(v_ws, 'feature_hub_pauta'), 'new workspace resolves feature_hub_pauta on';

  insert into workspace_plan_overrides (workspace_id, feature_overrides)
    values (v_ws, '{"feature_hub_pauta": true}'::jsonb);
  assert effective_plan_feature(v_ws, 'feature_hub_pauta'), 'override true did not enable feature_hub_pauta';

  -- the new ids are accepted
  update workspaces set hub_font_display = 'bricolage-grotesque', hub_font_body = 'figtree' where id = v_ws;
  assert (select hub_font_display = 'bricolage-grotesque' and hub_font_body = 'figtree' from workspaces where id = v_ws),
    'Assinatura ids were not stored';

  -- the old ids still are
  update workspaces set hub_font_display = 'fraunces', hub_font_body = 'instrument-sans' where id = v_ws;

  -- an unknown id is refused on each column
  v_ok := false;
  begin
    update workspaces set hub_font_display = 'comic-sans' where id = v_ws;
  exception when check_violation then v_ok := true;
  end;
  assert v_ok, 'unknown display font accepted';

  v_ok := false;
  begin
    update workspaces set hub_font_body = 'comic-sans' where id = v_ws;
  exception when check_violation then v_ok := true;
  end;
  assert v_ok, 'unknown body font accepted';

  raise notice 'PASS 99_hub_pauta_flag';
end $$;
rollback;
```

- [ ] **Step 2: Write the migration**

`supabase/migrations/20261012000001_feature_hub_pauta.sql`:

```sql
-- Flag de rollout da identidade visual "Pauta" do Hub
-- (spec docs/superpowers/specs/2026-10-08-hub-identidade-pauta-design.md).
-- Nasce desligada em todos os planos e é ligada por workspace via
-- workspace_plan_overrides.feature_overrides ({"feature_hub_pauta": true}),
-- no mesmo desenho de feature_agenda / feature_multiplatform. Lançamento = ligar
-- a coluna nos planos. Só muda aparência: nenhuma escrita é bloqueada por ela.
--
-- A mesma migração amplia os CHECKs de fonte (20260731000001) com o par
-- "Assinatura": bricolage-grotesque (títulos) e figtree (texto). Os defaults
-- das colunas não mudam aqui; isso fica para a limpeza pós-lançamento.
-- Espelho em packages/hub-theme/theme.ts (HUB_DISPLAY_FONTS / HUB_BODY_FONTS)
-- e nos testes "font allowlist sync" de theme.test.ts.

SET LOCAL lock_timeout = '5s';

ALTER TABLE public.plans ADD COLUMN IF NOT EXISTS feature_hub_pauta boolean NOT NULL DEFAULT false;

ALTER TABLE public.workspaces
  DROP CONSTRAINT IF EXISTS hub_font_display_allowed,
  DROP CONSTRAINT IF EXISTS hub_font_body_allowed;

ALTER TABLE public.workspaces
  ADD CONSTRAINT hub_font_display_allowed CHECK (hub_font_display IN ('fraunces','playfair-display','dm-serif-display','space-grotesk','sora','lora','bricolage-grotesque')),
  ADD CONSTRAINT hub_font_body_allowed CHECK (hub_font_body IN ('instrument-sans','inter','dm-sans','manrope','public-sans','figtree'));
```

- [ ] **Step 3: Run the suite if Docker/colima is up**

Run: `npm run test:db` (needs local Supabase; see memory "Local Supabase runs on colima"). Expected: `PASS 99_hub_pauta_flag`. If Docker is unavailable, note it in the report; CI's `entitlement-tests` job runs it.

- [ ] **Step 4: Add the key to `FEATURE_COLUMNS`**

In `supabase/functions/_shared/entitlements.ts`, change the last line of the array:

```ts
  "feature_briefing_audio", "feature_post_processes", "feature_agenda",
  "feature_multiplatform", "feature_hub_pauta",
] as const;
```

- [ ] **Step 5: Write the failing Deno tests**

In `supabase/functions/__tests__/hub-bootstrap_test.ts`, inside "post-auth lookups run alongside touchToken, not behind it": change the comment to `// resolveHubToken's feature_hub_portal check is RPC #1; the five plan features the bootstrap serves are #2-#6.`, change `if (++rpcCalls === 5) allFeaturesStarted();` to `if (++rpcCalls === 6) allFeaturesStarted();` and `assertEquals(rpcCalls, 5);` to `assertEquals(rpcCalls, 6);`.

Append after the `feature_agenda` tests:

```ts
Deno.test("feature_hub_pauta reflects the effective_plan_feature RPC result", async () => {
  const make = (flags: Record<string, boolean>) =>
    createHubBootstrapHandler({
      buildCorsHeaders: cors,
      createDb: () =>
        makeDbWithFeatureFlags({ cliente_id: 15, conta_id: "ws-1", is_active: true }, flags) as any,
      now: () => NOW,
      touchToken: async () => {},
      rateLimit: async () => true,
    });
  const on = await (await make({ feature_hub_pauta: true, feature_mensagens: false })(req())).json();
  assertEquals(on.feature_hub_pauta, true);
  assertEquals(on.feature_mensagens, false);
  const off = await (await make({ feature_hub_pauta: false })(req())).json();
  assertEquals(off.feature_hub_pauta, false);
});

Deno.test("feature_hub_pauta is false and does NOT break the response when its RPC errors", async () => {
  const handler = createHubBootstrapHandler({
    buildCorsHeaders: cors,
    createDb: () =>
      makeDbWithThrowingFeature(
        { cliente_id: 15, conta_id: "ws-1", is_active: true },
        "feature_hub_pauta",
      ) as any,
    now: () => NOW,
    touchToken: async () => {},
    rateLimit: async () => true,
  });
  const res = await handler(req());
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.feature_hub_pauta, false);
  assertEquals(body.feature_mensagens, true);
});
```

Also create `supabase/functions/__tests__/entitlements_feature_hub_pauta_test.ts`, the twin of `entitlements_feature_multiplatform_test.ts` (copy it and swap the key to `feature_hub_pauta`).

- [ ] **Step 6: Run to verify they fail**

Run: `deno test --no-check supabase/functions/__tests__/hub-bootstrap_test.ts supabase/functions/__tests__/entitlements_feature_hub_pauta_test.ts`
Expected: FAIL (`rpcCalls` 5 vs 6; `feature_hub_pauta` undefined).

- [ ] **Step 7: Implement in the handler**

In `supabase/functions/hub-bootstrap/handler.ts`, add `featureHubPauta` as the last destructured item and `feature("feature_hub_pauta")` as the last `Promise.all` entry:

```ts
      brandCustomization,
      featureAgenda,
      featureHubPauta,
    ] = await Promise.all([
        ...
        feature("feature_agenda"),
        feature("feature_hub_pauta"),
      ]);
```

and in the response, right after `feature_agenda: featureAgenda,`:

```ts
      // Visual identity "Pauta" (aparência apenas). Optional on the wire like
      // feature_agenda: an older Hub bundle ignores it.
      feature_hub_pauta: featureHubPauta,
```

- [ ] **Step 8: Run the Deno suite and the type gate**

Run: `deno test --no-check supabase/functions/__tests__/hub-bootstrap_test.ts && npm run check:functions`
Expected: PASS. Then `ls node_modules/.deno && npm ci` if the directory exists.

- [ ] **Step 9: Hub type**

In `apps/hub/src/types.ts`, after `feature_agenda?: boolean;`:

```ts
  /**
   * Identidade visual "Pauta" (feature_hub_pauta). Optional for the same reason as
   * feature_agenda: absent = classic look.
   */
  feature_hub_pauta?: boolean;
```

Run: `npx tsc -p apps/hub/tsconfig.json --noEmit` → no errors.

- [ ] **Step 10: Commit**

```bash
git add supabase/migrations/20261012000001_feature_hub_pauta.sql supabase/tests/entitlements/99_hub_pauta_flag.sql supabase/functions/_shared/entitlements.ts supabase/functions/__tests__/entitlements_feature_hub_pauta_test.ts supabase/functions/hub-bootstrap/handler.ts supabase/functions/__tests__/hub-bootstrap_test.ts apps/hub/src/types.ts
git commit -m "feat(hub): flag feature_hub_pauta no plano, no hub-bootstrap e nos CHECKs de fonte"
```

---

### Task 2: Flag clients (Admin lists, CRM type)

**Files:**
- Modify: `apps/admin/src/lib/api.ts:103,251,280`
- Modify: `apps/admin/src/lib/__tests__/featureFlags.test.ts`
- Modify: `apps/admin/src/pages/__tests__/plan-form.test.ts:61`
- Modify: `apps/crm/src/hooks/useWorkspaceLimits.ts:55`

**Interfaces:**
- Produces: `Plan.feature_hub_pauta: boolean`; `FEATURE_FLAG_KEYS` contains `'feature_hub_pauta'`; `FEATURE_FLAG_LABELS.feature_hub_pauta === 'Hub: visual Pauta'`; CRM `FeatureFlags.feature_hub_pauta?: boolean`.

- [ ] **Step 1: Failing test**

In `apps/admin/src/lib/__tests__/featureFlags.test.ts`, before the `for` loop:

```ts
    expect(FEATURE_FLAG_KEYS).toContain('feature_hub_pauta');
    expect(FEATURE_FLAG_LABELS.feature_hub_pauta).toBe('Hub: visual Pauta');
```

Run: `npx vitest run apps/admin/src/lib/__tests__/featureFlags.test.ts` → FAIL.

- [ ] **Step 2: Implement**

`apps/admin/src/lib/api.ts`: after `feature_multiplatform: boolean;` in `Plan` add `feature_hub_pauta: boolean;`; after `'feature_multiplatform',` in `FEATURE_FLAG_KEYS` add `'feature_hub_pauta',`; after `feature_multiplatform: 'Plataformas por fluxo',` add `feature_hub_pauta: 'Hub: visual Pauta',`.

`apps/admin/src/pages/__tests__/plan-form.test.ts`: after `feature_multiplatform: false,` add `feature_hub_pauta: false,`.

`apps/crm/src/hooks/useWorkspaceLimits.ts`: after `feature_multiplatform: boolean;` add

```ts
  /** Identidade visual "Pauta" do Hub (spec 2026-10-08-hub-identidade-pauta). Optional:
   *  read it as `features?.feature_hub_pauta === true`, never through hasFeature
   *  (which treats a missing key as on). */
  feature_hub_pauta?: boolean;
```

- [ ] **Step 3: Verify**

Run: `npx vitest run apps/admin && npx tsc -p apps/admin/tsconfig.json --noEmit && npx tsc -p apps/crm/tsconfig.json --noEmit`
Expected: PASS, no type errors.

- [ ] **Step 4: Commit**

```bash
git add apps/admin/src/lib/api.ts apps/admin/src/lib/__tests__/featureFlags.test.ts apps/admin/src/pages/__tests__/plan-form.test.ts apps/crm/src/hooks/useWorkspaceLimits.ts
git commit -m "feat(admin): flag feature_hub_pauta nas listas do Admin e no tipo do CRM"
```

---

### Task 3: hub-theme (look, readable primary, Pauta tokens, fonts)

**Files:**
- Modify: `packages/hub-theme/theme.ts`
- Modify: `packages/hub-theme/theme.test.ts`

**Interfaces:**
- Produces (all exported from `packages/hub-theme/theme.ts`, re-exported by `apps/hub/src/theme.ts`):
  - `type HubLook = 'classic' | 'pauta'`
  - `wcagLuminance(hex: string): number`, `contrastRatio(a: string, b: string): number`, `mixHex(a: string, b: string, t: number): string`
  - `readablePrimary(acc: string): { primary: string; fg: string }`
  - `PAUTA_WARM: { light: HubPalette; dark: HubPalette }`
  - `type StatusToneKey = 'wait' | 'fix' | 'ok' | 'sched' | 'prod' | 'done'`
  - `PAUTA_STATUS: Record<'light' | 'dark', Record<StatusToneKey, { fg: string; bg: string }>>`
  - `PAUTA_FONTS: { display: 'bricolage-grotesque'; body: 'figtree' }`
  - `effectiveHubFonts(look: HubLook, customized: boolean, stored: { display?: string | null; body?: string | null }): { display: string; body: string }`
  - `hubFontOptions(pauta: boolean, current: { display: string; body: string })` returning `{ display: [string, HubFontOption][]; body: [string, HubFontOption][]; pairings: typeof HUB_FONT_PAIRINGS }`
  - `resolveHubTheme(config: HubThemeConfig, dark: boolean, look: HubLook = 'classic'): ResolvedHubTheme`
  - New CSS vars (both looks): `--hub-acc-soft`, `--hub-display-weight`, `--hub-shadow-card`, `--hub-r-chip`, `--hub-r-tile`, `--hub-r-dot`, `--hub-st-{wait|fix|ok|sched|prod|done}-{fg|bg}`.

- [ ] **Step 1: Write the failing tests**

Append to `packages/hub-theme/theme.test.ts` (extend the import list with `contrastRatio, readablePrimary, effectiveHubFonts, hubFontOptions, PAUTA_WARM, PAUTA_STATUS, HUB_FONT_PAIRINGS`):

```ts
describe('readable primary (Pauta)', () => {
  const brands = ['#f97316', '#0ea5e9', '#ec4899', '#f43f5e', '#d946ef', '#8b5cf6', '#ffbf30', '#1a1a2e'];
  for (const hex of brands) {
    it(`${hex}: primary-fg on primary >= 4.5`, () => {
      const { primary, fg } = readablePrimary(hex);
      expect(contrastRatio(fg, primary)).toBeGreaterThanOrEqual(4.5);
    });
  }
  it('keeps the brand color when a foreground already reaches 4.5', () => {
    expect(readablePrimary('#f97316').primary).toBe('#f97316'); // ink passes
    expect(readablePrimary('#0f766e').primary).toBe('#0f766e'); // white passes
  });
  it('resolveHubTheme Pauta: primary-fg on primary >= 4.5 in both modes', () => {
    for (const hex of ['#f97316', '#0ea5e9', '#ec4899', '#f43f5e', '#8b5cf6']) {
      for (const dark of [false, true]) {
        const v = resolveHubTheme({ ...DEFAULT_HUB_THEME, accent: hex }, dark, 'pauta').vars;
        expect(contrastRatio(v['--hub-primary-fg'], v['--hub-primary'])).toBeGreaterThanOrEqual(4.5);
      }
    }
  });
  it('darkens a mid-tone toward ink when neither foreground reaches 4.5', () => {
    const r = readablePrimary('#8b5cf6');
    expect(r.primary).not.toBe('#8b5cf6');
    expect(r.fg).toBe('#ffffff');
  });
});

describe("resolveHubTheme look='pauta'", () => {
  const base = { ...DEFAULT_HUB_THEME, accent: '#f97316' };
  it('primary is the readable brand color even with customized: false', () => {
    const v = resolveHubTheme(base, false, 'pauta').vars;
    expect(v['--hub-primary']).toBe('#f97316');
    expect(v['--hub-primary-fg']).toBe('#171717');
    expect(v['--hub-ring']).toBe('color-mix(in srgb, #f97316 22%, transparent)');
    expect(v['--hub-acc']).toBe('#f97316');
  });
  it('warm surface uses PAUTA_WARM in Pauta and the classic palette otherwise', () => {
    const warm = { ...base, surface: 'warm' as const, customized: true };
    expect(resolveHubTheme(warm, false, 'pauta').vars['--hub-bg']).toBe('#F8F5F3');
    expect(resolveHubTheme(warm, true, 'pauta').vars['--hub-bg']).toBe('#141110');
    expect(resolveHubTheme(warm, false).vars['--hub-bg']).toBe('#FAF7F2');
  });
  it('non-customized Pauta uses the Assinatura fonts; customized keeps the stored ones', () => {
    expect(resolveHubTheme(base, false, 'pauta').vars['--hub-font-display']).toContain('Bricolage Grotesque');
    expect(resolveHubTheme(base, false, 'pauta').vars['--hub-font-sans']).toContain('Figtree');
    const custom = { ...base, customized: true, fontDisplay: 'fraunces', fontBody: 'inter' };
    expect(resolveHubTheme(custom, false, 'pauta').vars['--hub-font-display']).toContain('Fraunces');
  });
  it('display weight is 500 for Fraunces and 600 otherwise', () => {
    const fr = { ...base, customized: true, fontDisplay: 'fraunces' };
    expect(resolveHubTheme(fr, false, 'pauta').vars['--hub-display-weight']).toBe('500');
    expect(resolveHubTheme(base, false, 'pauta').vars['--hub-display-weight']).toBe('600');
  });
  it('radius tokens per preset', () => {
    const r = (radius: 'square' | 'soft' | 'pill') =>
      resolveHubTheme({ ...base, customized: true, radius }, false, 'pauta').vars;
    expect([r('square')['--hub-r-chip'], r('soft')['--hub-r-chip'], r('pill')['--hub-r-chip']]).toEqual(['3px', '8px', '999px']);
    expect([r('square')['--hub-r-tile'], r('soft')['--hub-r-tile'], r('pill')['--hub-r-tile']]).toEqual(['0px', '8px', '14px']);
    expect([r('square')['--hub-r-dot'], r('soft')['--hub-r-dot'], r('pill')['--hub-r-dot']]).toEqual(['0px', '2px', '999px']);
  });
  it('card shadow only on filled light', () => {
    expect(resolveHubTheme(base, false, 'pauta').vars['--hub-shadow-card']).toBe('0 1px 2px rgba(16,16,16,.05)');
    expect(resolveHubTheme(base, true, 'pauta').vars['--hub-shadow-card']).toBe('none');
    expect(resolveHubTheme({ ...base, customized: true, cardStyle: 'outline' }, false, 'pauta').vars['--hub-shadow-card']).toBe('none');
  });
  it('status tokens are emitted and done reads the surface', () => {
    const v = resolveHubTheme(base, false, 'pauta').vars;
    expect(v['--hub-st-wait-fg']).toBe('#8A5300');
    expect(v['--hub-st-done-fg']).toBe('var(--hub-tx2)');
    expect(v['--hub-st-done-bg']).toBe('var(--hub-soft)');
  });
});

describe('classic stays as it was', () => {
  it('existing vars are identical with and without the look argument', () => {
    for (const dark of [false, true]) {
      for (const cfg of [
        { ...DEFAULT_HUB_THEME, accent: '#f97316' },
        { ...DEFAULT_HUB_THEME, accent: '#8b5cf6', customized: true, surface: 'warm' as const, radius: 'pill' as const },
      ]) {
        const a = resolveHubTheme(cfg, dark).vars;
        const b = resolveHubTheme(cfg, dark, 'classic').vars;
        expect(b).toEqual(a);
        // the 19 pre-Pauta vars keep their pre-Pauta values
        expect(a['--hub-primary']).toBe(cfg.customized ? '#8b5cf6' : 'var(--hub-txt)');
      }
    }
  });
  it('classic accFg keeps the linear-luminance pick', () => {
    expect(resolveHubTheme({ ...DEFAULT_HUB_THEME, accent: '#f97316' }, false).vars['--hub-acc-fg']).toBe('#ffffff');
  });
});

describe('Pauta status tokens contrast (>= 4.5 on card and bg of every surface)', () => {
  for (const mode of ['light', 'dark'] as const) {
    const palettes = [PALETTES.neutral[mode], PAUTA_WARM[mode], PALETTES.cool[mode]];
    for (const [tone, { fg }] of Object.entries(PAUTA_STATUS[mode])) {
      if (tone === 'done') continue; // tx2 on soft, covered by the palette floors
      it(`${mode} ${tone}`, () => {
        for (const p of palettes) {
          expect(contrastRatio(fg, p.card)).toBeGreaterThanOrEqual(4.5);
          expect(contrastRatio(fg, p.bg)).toBeGreaterThanOrEqual(4.5);
        }
      });
    }
  }
});

describe('effectiveHubFonts', () => {
  it('classic: defaults unless customized', () => {
    expect(effectiveHubFonts('classic', false, { display: 'sora', body: 'inter' })).toEqual({ display: 'fraunces', body: 'instrument-sans' });
    expect(effectiveHubFonts('classic', true, { display: 'sora', body: 'inter' })).toEqual({ display: 'sora', body: 'inter' });
  });
  it('pauta: Assinatura unless customized', () => {
    expect(effectiveHubFonts('pauta', false, {})).toEqual({ display: 'bricolage-grotesque', body: 'figtree' });
    expect(effectiveHubFonts('pauta', true, { display: 'fraunces', body: 'instrument-sans' })).toEqual({ display: 'fraunces', body: 'instrument-sans' });
  });
  it('customized with missing ids falls back to the classic defaults', () => {
    expect(effectiveHubFonts('pauta', true, { display: null, body: undefined })).toEqual({ display: 'fraunces', body: 'instrument-sans' });
  });
});

describe('hubFontOptions', () => {
  const cur = { display: 'fraunces', body: 'instrument-sans' };
  it('hides the Assinatura ids and pair without the flag', () => {
    const o = hubFontOptions(false, cur);
    expect(o.display.map(([id]) => id)).not.toContain('bricolage-grotesque');
    expect(o.body.map(([id]) => id)).not.toContain('figtree');
    expect(o.pairings.map((p) => p.label)).not.toContain('Assinatura');
  });
  it('shows them with the flag, Assinatura first', () => {
    const o = hubFontOptions(true, cur);
    expect(o.display.map(([id]) => id)).toContain('bricolage-grotesque');
    expect(o.pairings[0].label).toBe('Assinatura');
  });
  it('keeps an already-stored Assinatura id visible without the flag', () => {
    const o = hubFontOptions(false, { display: 'bricolage-grotesque', body: 'figtree' });
    expect(o.display.map(([id]) => id)).toContain('bricolage-grotesque');
    expect(o.body.map(([id]) => id)).toContain('figtree');
    expect(o.pairings.map((p) => p.label)).toContain('Assinatura');
  });
});
```

Also update the two allowlist tests (exact arrays, new ids appended last):

```ts
    expect(Object.keys(HUB_DISPLAY_FONTS)).toEqual([
      'fraunces', 'playfair-display', 'dm-serif-display', 'space-grotesk', 'sora', 'lora', 'bricolage-grotesque',
    ]);
```
```ts
    expect(Object.keys(HUB_BODY_FONTS)).toEqual([
      'instrument-sans', 'inter', 'dm-sans', 'manrope', 'public-sans', 'figtree',
    ]);
```

And extend the tx3 test to cover `PAUTA_WARM`: **inside** the `describe('surface presets: tx3 contrast (WCAG AA)')` block (where `ratio` is defined), after its `for (const [surface, modes] of Object.entries(PALETTES))` loop, add

```ts
  for (const [mode, p] of Object.entries(PAUTA_WARM)) {
    it(`pauta warm ${mode}: tx3 is >= 4.5:1 on bg, card and soft`, () => {
      for (const bg of [p.bg, p.card, p.soft]) expect(ratio(p.tx3, bg)).toBeGreaterThanOrEqual(4.5);
    });
  }
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run packages/hub-theme`
Expected: FAIL (missing exports).

- [ ] **Step 3: Implement in `packages/hub-theme/theme.ts`**

After `relativeLuminance` add:

```ts
export type HubLook = 'classic' | 'pauta';

const INK = '#171717';

/** WCAG 2.x relative luminance (gamma-corrected). The linear `relativeLuminance`
 * above stays for the classic accent clamp; Pauta decisions use this one.
 * report-blocks/theme.ts has its own copy; dedupe in the post-launch cleanup. */
export function wcagLuminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [wcagLuminance(a), wcagLuminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

export function mixHex(a: string, b: string, t: number): string {
  const A = hexToRgb(a);
  const B = hexToRgb(b);
  return `#${A.map((v, i) => Math.round(v + (B[i] - v) * t).toString(16).padStart(2, '0')).join('')}`;
}

/** Pauta fills (buttons, active nav, counters) with text on them. Keeps the brand
 * color when white or ink reaches 4.5:1 on it; otherwise darkens it toward ink in
 * 10% steps until white does. */
export function readablePrimary(acc: string): { primary: string; fg: string } {
  const white = contrastRatio('#ffffff', acc);
  const ink = contrastRatio(INK, acc);
  if (Math.max(white, ink) >= 4.5) return { primary: acc, fg: white >= ink ? '#ffffff' : INK };
  for (let i = 1; i <= 10; i++) {
    const candidate = mixHex(acc, INK, i / 10);
    if (contrastRatio('#ffffff', candidate) >= 4.5) return { primary: candidate, fg: '#ffffff' };
  }
  return { primary: INK, fg: '#ffffff' };
}
```

After `PALETTES` add:

```ts
// Pauta's warm surface ("linho"). Neutral and cool are shared with the classic look.
// Becomes PALETTES.warm in the post-launch cleanup.
export const PAUTA_WARM: { light: HubPalette; dark: HubPalette } = {
  light: {
    bg: '#F8F5F3',
    card: '#FFFFFF',
    txt: '#1F1A17',
    tx2: '#5A514C',
    tx3: '#6F655F',
    bd: 'rgba(31,26,23,.08)',
    bd2: 'rgba(31,26,23,.2)',
    soft: '#F0EAE6',
  },
  dark: {
    bg: '#141110',
    card: '#1D1917',
    txt: '#F6F1EE',
    tx2: '#BBB1AB',
    tx3: '#958A84',
    bd: 'rgba(246,241,238,.09)',
    bd2: 'rgba(246,241,238,.22)',
    soft: '#29231F',
  },
};

export type StatusToneKey = 'wait' | 'fix' | 'ok' | 'sched' | 'prod' | 'done';

// Fixed set, never derived from the accent (spec table "Status").
export const PAUTA_STATUS: Record<'light' | 'dark', Record<StatusToneKey, { fg: string; bg: string }>> = {
  light: {
    wait: { fg: '#8A5300', bg: 'rgba(214,138,0,.14)' },
    fix: { fg: '#B42318', bg: 'rgba(180,35,24,.09)' },
    ok: { fg: '#146C46', bg: 'rgba(20,108,70,.10)' },
    sched: { fg: '#1F4FB0', bg: 'rgba(31,79,176,.10)' },
    prod: { fg: '#6D3FC4', bg: 'rgba(109,63,196,.10)' },
    done: { fg: 'var(--hub-tx2)', bg: 'var(--hub-soft)' },
  },
  dark: {
    wait: { fg: '#F2B65A', bg: 'rgba(242,182,90,.14)' },
    fix: { fg: '#FF8F85', bg: 'rgba(255,143,133,.13)' },
    ok: { fg: '#5BD69B', bg: 'rgba(91,214,155,.13)' },
    sched: { fg: '#93B4FF', bg: 'rgba(147,180,255,.14)' },
    prod: { fg: '#C3A6FF', bg: 'rgba(195,166,255,.14)' },
    done: { fg: 'var(--hub-tx2)', bg: 'var(--hub-soft)' },
  },
};

const RADIUS_CHIP: Record<HubRadius, string> = { square: '3px', soft: '8px', pill: '999px' };
const RADIUS_TILE: Record<HubRadius, string> = { square: '0px', soft: '8px', pill: '14px' };
const RADIUS_DOT: Record<HubRadius, string> = { square: '0px', soft: '2px', pill: '999px' };
```

Append to `HUB_DISPLAY_FONTS` (last entry):

```ts
  'bricolage-grotesque': {
    label: 'Bricolage Grotesque',
    css: "'Bricolage Grotesque', ui-sans-serif, system-ui, sans-serif",
    gf: 'Bricolage+Grotesque:opsz,wght@12..96,400;12..96,500;12..96,600;12..96,700',
  },
```

Append to `HUB_BODY_FONTS` (last entry):

```ts
  figtree: {
    label: 'Figtree',
    css: "'Figtree', ui-sans-serif, system-ui, sans-serif",
    gf: 'Figtree:wght@400;500;600;700',
  },
```

Put Assinatura first in `HUB_FONT_PAIRINGS`:

```ts
export const HUB_FONT_PAIRINGS: { display: string; body: string; label: string }[] = [
  { display: 'bricolage-grotesque', body: 'figtree', label: 'Assinatura' },
  { display: 'fraunces', body: 'instrument-sans', label: 'Editorial' },
  ...
];
```

After `DEFAULT_BODY_ID` add:

```ts
export const PAUTA_FONTS = { display: 'bricolage-grotesque', body: 'figtree' } as const;
const PAUTA_ONLY_FONT_IDS = new Set<string>([PAUTA_FONTS.display, PAUTA_FONTS.body]);

/** The font ids a hub actually uses. One function for the resolver and for both
 * font loaders (HubShell's <link id="hub-custom-fonts"> and the CRM HubPreview). */
export function effectiveHubFonts(
  look: HubLook,
  customized: boolean,
  stored: { display?: string | null; body?: string | null },
): { display: string; body: string } {
  if (customized) {
    return { display: stored.display ?? DEFAULT_DISPLAY_ID, body: stored.body ?? DEFAULT_BODY_ID };
  }
  return look === 'pauta'
    ? { display: PAUTA_FONTS.display, body: PAUTA_FONTS.body }
    : { display: DEFAULT_DISPLAY_ID, body: DEFAULT_BODY_ID };
}

/** Font choices offered in the CRM HubTab. Without the flag the Assinatura ids
 * and pair are hidden, except the ones the workspace already stored. */
export function hubFontOptions(pauta: boolean, current: { display: string; body: string }) {
  const keep = (id: string) =>
    pauta || !PAUTA_ONLY_FONT_IDS.has(id) || id === current.display || id === current.body;
  return {
    display: Object.entries(HUB_DISPLAY_FONTS).filter(([id]) => keep(id)),
    body: Object.entries(HUB_BODY_FONTS).filter(([id]) => keep(id)),
    pairings: HUB_FONT_PAIRINGS.filter(
      (p) =>
        pauta ||
        p.display !== PAUTA_FONTS.display ||
        (current.display === p.display && current.body === p.body),
    ),
  };
}
```

Replace `resolveHubTheme` with:

```ts
export function resolveHubTheme(
  config: HubThemeConfig,
  dark: boolean,
  look: HubLook = 'classic',
): ResolvedHubTheme {
  const pauta = look === 'pauta';
  const family = pauta && config.surface === 'warm' ? PAUTA_WARM : (PALETTES[config.surface] ?? PALETTES.neutral);
  const t = dark ? family.dark : family.light;

  // Accent clamp pipeline: unchanged from the pre-customization resolver. --hub-acc /
  // --hub-acc-fg keep this behavior regardless of `customized` and of `look`.
  let acc = config.accent && HEX_RE.test(config.accent) ? config.accent : '#171717';
  const lum = relativeLuminance(acc);
  if (dark && lum < 0.18) acc = '#F5F5F5';
  else if (!dark && lum > 0.85) acc = '#171717';
  const accFg = relativeLuminance(acc) > 0.55 ? '#171717' : '#ffffff';

  let primary: string;
  let primaryFg: string;
  let ring: string;
  if (pauta) {
    const readable = readablePrimary(acc);
    primary = readable.primary;
    primaryFg = readable.fg;
    ring = `color-mix(in srgb, ${acc} 22%, transparent)`;
  } else {
    primary = config.customized ? acc : 'var(--hub-txt)';
    primaryFg = config.customized ? accFg : 'var(--hub-card)';
    ring = config.customized
      ? `color-mix(in srgb, ${acc} 22%, transparent)`
      : 'color-mix(in srgb, var(--hub-txt) 15%, transparent)';
  }

  const radius: HubRadius = config.radius in RADIUS_CARD ? config.radius : 'soft';
  const cardStyle: HubCardStyle = config.cardStyle in CARD_BG ? config.cardStyle : 'filled';

  // Classic keeps reading config.fontDisplay/fontBody as before (callers already pass
  // defaults when not customized); Pauta goes through effectiveHubFonts.
  const fontIds = pauta
    ? effectiveHubFonts(look, config.customized, { display: config.fontDisplay, body: config.fontBody })
    : { display: config.fontDisplay, body: config.fontBody };
  const fontDisplay = HUB_DISPLAY_FONTS[fontIds.display] ?? HUB_DISPLAY_FONTS[DEFAULT_DISPLAY_ID];
  const fontBody = HUB_BODY_FONTS[fontIds.body] ?? HUB_BODY_FONTS[DEFAULT_BODY_ID];
  const displayIsFraunces = !(fontIds.display in HUB_DISPLAY_FONTS) || fontIds.display === 'fraunces';

  const status = PAUTA_STATUS[dark ? 'dark' : 'light'];
  const statusVars: Record<string, string> = {};
  for (const [tone, { fg, bg }] of Object.entries(status)) {
    statusVars[`--hub-st-${tone}-fg`] = fg;
    statusVars[`--hub-st-${tone}-bg`] = bg;
  }

  return {
    vars: {
      '--hub-bg': t.bg,
      '--hub-card': t.card,
      '--hub-txt': t.txt,
      '--hub-tx2': t.tx2,
      '--hub-tx3': t.tx3,
      '--hub-bd': t.bd,
      '--hub-bd2': t.bd2,
      '--hub-soft': t.soft,
      '--hub-acc': acc,
      '--hub-acc-fg': accFg,
      '--hub-font-display': fontDisplay.css,
      '--hub-font-sans': fontBody.css,
      '--hub-primary': primary,
      '--hub-primary-fg': primaryFg,
      '--hub-ring': ring,
      '--hub-r-card': RADIUS_CARD[radius],
      '--hub-r-ctl': RADIUS_CTL[radius],
      '--hub-card-bg': CARD_BG[cardStyle],
      '--hub-card-bd': CARD_BD[cardStyle],
      // New in Pauta. Emitted in both looks; only Pauta rules and branches read them.
      '--hub-acc-soft': `color-mix(in srgb, ${acc} 16%, transparent)`,
      '--hub-display-weight': displayIsFraunces ? '500' : '600',
      '--hub-shadow-card': cardStyle === 'filled' && !dark ? '0 1px 2px rgba(16,16,16,.05)' : 'none',
      '--hub-r-chip': RADIUS_CHIP[radius],
      '--hub-r-tile': RADIUS_TILE[radius],
      '--hub-r-dot': RADIUS_DOT[radius],
      ...statusVars,
    },
  };
}
```

Note: the old code did `RADIUS_CARD[config.radius] ?? RADIUS_CARD.soft`; the `in` check above preserves the "unknown enum falls back" tests.

- [ ] **Step 4: Run the package and dependent suites**

Run: `npx vitest run packages/hub-theme packages/report-blocks apps/hub/src/shell apps/crm/src/pages/configuracao`
Expected: PASS. If `packages/report-blocks/__tests__/theme.test.ts` or a CRM test lists font ids/pairings explicitly and now fails, extend its expected list with the new ids (append order) and the Assinatura pairing (first); do not change production code for it.

- [ ] **Step 5: Commit**

```bash
git add packages/hub-theme/theme.ts packages/hub-theme/theme.test.ts
git commit -m "feat(hub-theme): look Pauta, primário legível, tokens de status e par Assinatura"
```

(Include any test fixture you had to extend in Step 4 in the same commit.)

---

### Task 4: Hub foundation (useHubLook, HubShell, CSS, status primitives)

Depends on Tasks 1 (type) and 3 (theme exports).

**Files:**
- Create: `apps/hub/src/hooks/useHubLook.ts`
- Create: `apps/hub/src/hooks/__tests__/useHubLook.test.tsx`
- Modify: `apps/hub/src/shell/HubShell.tsx`
- Modify: `apps/hub/src/shell/__tests__/HubShell.test.tsx`
- Modify: `apps/hub/index.html` (`<style>`)
- Modify: `apps/hub/src/lib/postView.ts` (add `statusTone`)
- Modify: `apps/hub/src/components/StatusPill.tsx`
- Modify: `apps/hub/src/components/posts/StatusTag.tsx`
- Modify: `apps/hub/src/pages/agenda/AgendaCardView.tsx:66-85,188`
- Test: `apps/hub/src/components/__tests__/StatusPill.test.tsx`, `apps/hub/src/lib/__tests__/statusTone.test.ts`, `apps/hub/src/components/posts/__tests__/StatusTag.test.tsx` (create if absent; check `ls apps/hub/src/components/posts/__tests__`)

**Interfaces:**
- Produces:
  - `useHubLook(): HubLook` from `apps/hub/src/hooks/useHubLook.ts`
  - `statusTone(status: string): StatusToneKey` from `apps/hub/src/lib/postView.ts`
  - `type PillSemantic = 'wait' | 'ok' | 'fix' | 'neutral'`; `StatusPill({ tone, semantic?, children })`
  - `selo(...)` now returns `{ tone: PillTone; semantic: PillSemantic; texto: string }`
  - CSS classes: `.hub-eyebrow`, `.hub-eyebrow-plain`, `.hub-nav-pill`, `.hub-display-title`, `.hub-pill-st-{wait|ok|fix|neutral}`, `.hub-spinner`
  - DOM: `.hub-root[data-hub-look="pauta"]` only when the flag is on

- [ ] **Step 1: Failing tests**

`apps/hub/src/hooks/__tests__/useHubLook.test.tsx`:

```tsx
import { renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it } from 'vitest';
import { HubContext } from '../../HubContext';
import { useHubLook } from '../useHubLook';

const wrap = (bootstrap: unknown) => ({ children }: { children: ReactNode }) => (
  <HubContext.Provider value={{ bootstrap, token: 't', workspace: 'w', theme: 'light', toggleTheme: () => {} } as never}>
    {children}
  </HubContext.Provider>
);

describe('useHubLook', () => {
  it('is classic without a provider', () => {
    expect(renderHook(() => useHubLook()).result.current).toBe('classic');
  });
  it('is classic when the flag is absent or false', () => {
    expect(renderHook(() => useHubLook(), { wrapper: wrap({}) }).result.current).toBe('classic');
    expect(renderHook(() => useHubLook(), { wrapper: wrap({ feature_hub_pauta: false }) }).result.current).toBe('classic');
  });
  it('is pauta when the flag is true', () => {
    expect(renderHook(() => useHubLook(), { wrapper: wrap({ feature_hub_pauta: true }) }).result.current).toBe('pauta');
  });
});
```

`apps/hub/src/lib/__tests__/statusTone.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { STATUS_COLORS, statusTone } from '../postView';

describe('statusTone', () => {
  it('maps every STATUS_COLORS status', () => {
    expect(Object.fromEntries(Object.keys(STATUS_COLORS).map((s) => [s, statusTone(s)]))).toEqual({
      enviado_cliente: 'wait',
      aprovado_cliente: 'ok',
      correcao_cliente: 'fix',
      agendado: 'sched',
      publicando: 'sched',
      postado: 'done',
      falha_publicacao: 'fix',
      em_producao: 'prod',
    });
  });
  it('falls back to done', () => {
    expect(statusTone('qualquer')).toBe('done');
  });
});
```

Add to `apps/hub/src/components/__tests__/StatusPill.test.tsx` (keep existing tests):

```tsx
import { HubContext } from '../../HubContext';

const pauta = (ui: React.ReactNode) => (
  <HubContext.Provider value={{ bootstrap: { feature_hub_pauta: true } } as never}>{ui}</HubContext.Provider>
);

it('classic ignores semantic', () => {
  render(<StatusPill tone="accent" semantic="ok">X</StatusPill>);
  expect(screen.getByText('X')).toHaveClass('hub-pill', 'hub-pill-accent');
});
it('pauta uses semantic', () => {
  render(pauta(<StatusPill tone="accent" semantic="ok">X</StatusPill>));
  expect(screen.getByText('X')).toHaveClass('hub-pill', 'hub-pill-st-ok');
});
it('pauta falls back from tone', () => {
  render(pauta(<StatusPill tone="danger">X</StatusPill>));
  expect(screen.getByText('X')).toHaveClass('hub-pill-st-fix');
});
```

StatusTag test (create `apps/hub/src/components/posts/__tests__/StatusTag.pauta.test.tsx`):

```tsx
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { HubContext } from '../../../HubContext';
import { StatusTag } from '../StatusTag';

describe('StatusTag Pauta', () => {
  it('uses the status token on a card background', () => {
    render(
      <HubContext.Provider value={{ bootstrap: { feature_hub_pauta: true } } as never}>
        <StatusTag status="enviado_cliente" />
      </HubContext.Provider>,
    );
    const el = screen.getByText(/aguardando|aprovação/i).closest('span[data-hub-status]') as HTMLElement;
    expect(el.dataset.hubStatus).toBe('wait');
    expect(el.style.color).toBe('var(--hub-st-wait-fg)');
    expect(el.style.background).toBe('var(--hub-card)');
    expect(el.style.borderRadius).toBe('var(--hub-r-chip)');
  });
  it('unknown status reads done', () => {
    render(
      <HubContext.Provider value={{ bootstrap: { feature_hub_pauta: true } } as never}>
        <StatusTag status="xyz" />
      </HubContext.Provider>,
    );
    expect((document.querySelector('[data-hub-status]') as HTMLElement).dataset.hubStatus).toBe('done');
  });
});
```

(If the label regex doesn't match the pt label of `enviado_cliente`, read `getClientStatusLabel` and use the exact label.)

HubShell tests: add to the `hub_theme customization` describe in `HubShell.test.tsx`, reusing that file's render pattern:

```tsx
    it('sets data-hub-look and loads Assinatura for a non-customized Pauta hub', async () => {
      mockedFetchBootstrap.mockResolvedValue({
        workspace: { name: 'Mesaas', logo_url: null, brand_color: '#0f766e' },
        cliente_nome: 'Clínica Aurora',
        is_active: true,
        cliente_id: 14,
        feature_mensagens: true,
        feature_hub_pauta: true,
        hub_theme: { ...CUSTOM_THEME_BASE, customized: false },
      });
      render(
        <MemoryRouter initialEntries={['/mesaas/hub/token-publico']}>
          <Routes>
            <Route path="/:workspace/hub/:token" element={<HubShell />}>
              <Route index element={<div>Página inicial do hub</div>} />
            </Route>
          </Routes>
        </MemoryRouter>,
      );
      await waitFor(() => expect(screen.getByText('Página inicial do hub')).toBeInTheDocument());
      expect(document.querySelector('.hub-root')?.getAttribute('data-hub-look')).toBe('pauta');
      expect(document.querySelector('main')?.className).not.toContain('hub-noise');
      const link = document.getElementById('hub-custom-fonts') as HTMLLinkElement;
      expect(link.href).toContain('Bricolage+Grotesque');
      expect(link.href).toContain('Figtree');
      expect(document.querySelector('style')?.textContent).toContain('--hub-primary: #0f766e;');
    });

    it('classic: no data-hub-look, hub-noise kept, no font link', async () => {
      mockedFetchBootstrap.mockResolvedValue({
        workspace: { name: 'Mesaas', logo_url: null, brand_color: '#0f766e' },
        cliente_nome: 'Clínica Aurora',
        is_active: true,
        cliente_id: 14,
        feature_mensagens: true,
        hub_theme: { ...CUSTOM_THEME_BASE, customized: false },
      });
      render(
        <MemoryRouter initialEntries={['/mesaas/hub/token-publico']}>
          <Routes>
            <Route path="/:workspace/hub/:token" element={<HubShell />}>
              <Route index element={<div>Página inicial do hub</div>} />
            </Route>
          </Routes>
        </MemoryRouter>,
      );
      await waitFor(() => expect(screen.getByText('Página inicial do hub')).toBeInTheDocument());
      expect(document.querySelector('.hub-root')?.hasAttribute('data-hub-look')).toBe(false);
      expect(document.querySelector('main')?.className).toBe('hub-noise flex-1 md:pl-[240px]');
      expect(document.getElementById('hub-custom-fonts')).toBeNull();
    });
```

(If the file wraps renders in a QueryClientProvider helper, use that same helper as the neighbouring tests do.)

- [ ] **Step 2: Run to verify failures**

Run: `npx vitest run apps/hub/src/hooks apps/hub/src/lib/__tests__/statusTone.test.ts apps/hub/src/components/__tests__/StatusPill.test.tsx apps/hub/src/components/posts apps/hub/src/shell/__tests__/HubShell.test.tsx`
Expected: FAIL.

- [ ] **Step 3: `useHubLook`**

`apps/hub/src/hooks/useHubLook.ts`:

```ts
import { useContext } from 'react';
import { HubContext } from '../HubContext';
import type { HubLook } from '../theme';

/**
 * 'pauta' when the workspace has feature_hub_pauta. Reads the context directly
 * (not useHub, which throws without a provider) so components rendered outside
 * HubShell, such as the public ConvitePage or isolated tests, fall back to classic.
 */
export function useHubLook(): HubLook {
  return useContext(HubContext)?.bootstrap?.feature_hub_pauta === true ? 'pauta' : 'classic';
}
```

- [ ] **Step 4: `HubShell`**

1. Import `effectiveHubFonts` and `type HubLook` from `../theme`.
2. After `const isCustomized = ...` add:

```ts
  // Visual identity flag. HubShell provides HubContext, so it can't use useHubLook.
  const look: HubLook = bootstrap?.feature_hub_pauta === true ? 'pauta' : 'classic';
```

3. Replace the body of the font `useEffect` (first two `const`s) and its deps:

```ts
  useEffect(() => {
    const fonts = effectiveHubFonts(look, isCustomized, {
      display: ht?.font_display,
      body: ht?.font_body,
    });
    const href = buildGoogleFontsHref(fonts.display, fonts.body);
    ... (rest unchanged)
  }, [look, isCustomized, ht?.font_display, ht?.font_body]);
```

4. `const resolved = resolveHubTheme(config, theme === 'dark', look);`
5. Root and main:

```tsx
      <div
        className="hub-root min-h-screen flex flex-col"
        data-hub-look={look === 'pauta' ? 'pauta' : undefined}
      >
        <HubSidebar />
        <HubMobileNav />
        <main className={look === 'pauta' ? 'flex-1 md:pl-[240px]' : 'hub-noise flex-1 md:pl-[240px]'}>
```

Do not touch the loading spinner here (Task 10).

- [ ] **Step 5: CSS in `apps/hub/index.html`**

Add these fallbacks at the end of the `:root` block (values match the classic soft/neutral emission so nothing changes before HubShell paints):

```css
        --hub-acc-soft: color-mix(in srgb, var(--hub-acc) 16%, transparent);
        --hub-display-weight: 500;
        --hub-shadow-card: none;
        --hub-r-chip: 8px;
        --hub-r-tile: 8px;
        --hub-r-dot: 2px;
```

Add before the closing `</style>`:

```css
      /* ── Pauta (feature_hub_pauta) ─────────────────────────────────────────
         Rules scoped to [data-hub-look='pauta'] restyle class-based elements; the
         new classes below are only ever rendered by Pauta branches. Inline-styled
         components branch in TSX instead (CSS can't reach inline styles). */
      .hub-root[data-hub-look='pauta'] .hub-card {
        box-shadow: var(--hub-shadow-card);
      }
      /* :not(.rounded-full) keeps the circular counters, monogram and icon buttons
         that also carry hub-btn-primary round in every radius preset. */
      .hub-root[data-hub-look='pauta'] :is(.hub-btn-primary, .hub-btn-secondary):not(.rounded-full) {
        border-radius: var(--hub-r-ctl);
      }
      .hub-root[data-hub-look='pauta'] .hub-pill {
        border-radius: var(--hub-r-chip);
        gap: 6px;
      }
      .hub-root[data-hub-look='pauta'] .hub-pill::before {
        content: '';
        width: 6px;
        height: 6px;
        flex-shrink: 0;
        border-radius: var(--hub-r-dot);
        background: currentColor;
      }
      .hub-root .hub-pill-st-wait {
        color: var(--hub-st-wait-fg);
        background: var(--hub-st-wait-bg);
      }
      .hub-root .hub-pill-st-ok {
        color: var(--hub-st-ok-fg);
        background: var(--hub-st-ok-bg);
      }
      .hub-root .hub-pill-st-fix {
        color: var(--hub-st-fix-fg);
        background: var(--hub-st-fix-bg);
      }
      .hub-root .hub-pill-st-neutral {
        color: var(--hub-tx2);
        background: var(--hub-soft);
      }
      .hub-root .hub-eyebrow,
      .hub-root .hub-eyebrow-plain {
        display: flex;
        align-items: center;
        gap: 8px;
        font-size: 11.5px;
        font-weight: 600;
        letter-spacing: 0.09em;
        text-transform: uppercase;
        color: var(--hub-tx3);
      }
      .hub-root .hub-eyebrow::before {
        content: '';
        width: 7px;
        height: 7px;
        flex-shrink: 0;
        border-radius: var(--hub-r-dot);
        background: var(--hub-acc);
      }
      .hub-root .hub-nav-pill {
        background: var(--hub-primary);
        color: var(--hub-primary-fg);
        border-radius: var(--hub-r-ctl);
      }
      .hub-root .hub-display-title {
        font-weight: var(--hub-display-weight);
      }
      /* Loading spinners, both looks (the one declared exception to "classic
         unchanged": the stone colours ignored dark mode). Unscoped because
         ConvitePage renders its own .hub-root outside HubShell. */
      .hub-spinner {
        border-color: var(--hub-bd2);
        border-top-color: var(--hub-txt);
      }
```

- [ ] **Step 6: `statusTone`**

In `apps/hub/src/lib/postView.ts`, after `STATUS_COLORS`:

```ts
import type { StatusToneKey } from '../theme';

const STATUS_TONES: Record<string, StatusToneKey> = {
  enviado_cliente: 'wait',
  correcao_cliente: 'fix',
  falha_publicacao: 'fix',
  aprovado_cliente: 'ok',
  agendado: 'sched',
  publicando: 'sched',
  em_producao: 'prod',
  postado: 'done',
};

/** Pauta status tone (spec table "Status"). STATUS_COLORS keeps serving classic. */
export function statusTone(status: string): StatusToneKey {
  return STATUS_TONES[status] ?? 'done';
}
```

(Put the `import type` with the other imports at the top of the file.)

- [ ] **Step 7: `StatusPill`**

```tsx
import type { ReactNode } from 'react';
import { useHubLook } from '../hooks/useHubLook';

export type PillTone = 'accent' | 'danger' | 'neutral';
export type PillSemantic = 'wait' | 'ok' | 'fix' | 'neutral';

// Fallback only. `accent` means "pending" in PostCard and "confirmed" in the
// Agenda, so callers pass `semantic` explicitly.
const TONE_FALLBACK: Record<PillTone, PillSemantic> = {
  accent: 'wait',
  danger: 'fix',
  neutral: 'neutral',
};

export function StatusPill({
  tone,
  semantic,
  children,
}: {
  tone: PillTone;
  semantic?: PillSemantic;
  children: ReactNode;
}) {
  const look = useHubLook();
  if (look === 'pauta') {
    return <span className={`hub-pill hub-pill-st-${semantic ?? TONE_FALLBACK[tone]}`}>{children}</span>;
  }
  return <span className={`hub-pill hub-pill-${tone}`}>{children}</span>;
}
```

- [ ] **Step 8: `StatusTag`**

```tsx
import { useTranslation } from 'react-i18next';
import { STATUS_COLORS, getClientStatusLabel, statusTone } from '../../lib/postView';
import { useHubLook } from '../../hooks/useHubLook';

export function StatusTag({ status, size = 'sm' }: { status: string; size?: 'sm' | 'md' }) {
  const { t } = useTranslation('hubPosts');
  const look = useHubLook();
  if (look === 'pauta') {
    const tone = statusTone(status);
    return (
      <span
        data-hub-status={tone}
        className="inline-flex items-center gap-1.5 font-semibold whitespace-nowrap"
        style={{
          fontSize: size === 'md' ? '0.72rem' : '0.68rem',
          padding: size === 'md' ? '0.25rem 0.6rem' : '0.2rem 0.5rem',
          color: `var(--hub-st-${tone}-fg)`,
          background: 'var(--hub-card)',
          borderRadius: 'var(--hub-r-chip)',
          boxShadow: '0 1px 2px rgba(0,0,0,.12)',
        }}
      >
        <span
          aria-hidden="true"
          style={{ width: 6, height: 6, borderRadius: 'var(--hub-r-dot)', background: 'currentColor' }}
        />
        {getClientStatusLabel(t, status)}
      </span>
    );
  }
  const color = STATUS_COLORS[status] ?? '#94a3b8';
  return ( /* classic JSX unchanged */ );
}
```

- [ ] **Step 9: `selo` returns `semantic`**

In `apps/hub/src/pages/agenda/AgendaCardView.tsx`, import `type PillSemantic` alongside `PillTone`, change the return type to `{ tone: PillTone; semantic: PillSemantic; texto: string }` and add the field to each branch: `'sim'` → `semantic: 'ok'`, `'nao'` → `semantic: 'fix'`, encerrado → `semantic: 'neutral'`, pending → `semantic: 'wait'`. At line ~188: `<StatusPill tone={s.tone} semantic={s.semantic}>{s.texto}</StatusPill>`.

- [ ] **Step 10: Run tests + typecheck**

Run: `npx vitest run apps/hub && npx tsc -p apps/hub/tsconfig.json --noEmit`
Expected: PASS (all existing Hub tests, which render without the flag, stay green).

- [ ] **Step 11: Commit**

```bash
git add apps/hub/src/hooks/useHubLook.ts apps/hub/src/hooks/__tests__/useHubLook.test.tsx apps/hub/src/shell/HubShell.tsx apps/hub/src/shell/__tests__/HubShell.test.tsx apps/hub/index.html apps/hub/src/lib/postView.ts apps/hub/src/lib/__tests__/statusTone.test.ts apps/hub/src/components/StatusPill.tsx apps/hub/src/components/__tests__/StatusPill.test.tsx apps/hub/src/components/posts/StatusTag.tsx apps/hub/src/components/posts/__tests__/StatusTag.pauta.test.tsx apps/hub/src/pages/agenda/AgendaCardView.tsx
git commit -m "feat(hub): useHubLook, data-hub-look no shell, CSS e selos do Pauta"
```

---

### Task 5: Shell chrome (sidebar, mobile nav, monogram)

Depends on Task 4.

**Files:**
- Create: `apps/hub/src/shell/pautaNav.ts`
- Modify: `apps/hub/src/shell/HubSidebar.tsx`, `apps/hub/src/shell/HubMobileNav.tsx`, `apps/hub/src/components/WorkspaceMark.tsx:88-95`
- Modify: `packages/i18n/locales/{pt,en}/common.json` (`nav`)
- Test: `apps/hub/src/shell/__tests__/HubSidebar.test.tsx`, `apps/hub/src/shell/__tests__/HubMobileNav.test.tsx`, `apps/hub/src/components/__tests__/WorkspaceMark.test.tsx`

**Interfaces:**
- Consumes: `useHubLook()`, classes `.hub-nav-pill`, `.hub-display-title`, vars `--hub-acc-soft`, `--hub-r-chip`, `--hub-r-tile`.
- Produces: `pautaBadgeStyle(active: boolean): CSSProperties`, `PAUTA_BADGE_CLASS: string`.

- [ ] **Step 1: Failing tests**

In `HubSidebar.test.tsx` (helper `renderSidebar(pathname, bootstrap = BOOTSTRAP)`) and `HubMobileNav.test.tsx` (helper `renderMobileNav(bootstrap: HubBootstrap)`), add Pauta cases. Add `within` to the mobile file's `@testing-library/react` import. Assertions:

Sidebar:
```tsx
  it('Pauta: active item uses hub-nav-pill and the aside has no right border', async () => {
    renderSidebar('/ws/hub/tok', { ...BOOTSTRAP, feature_hub_pauta: true });
    const active = await screen.findByRole('link', { name: /início/i });
    expect(active).toHaveClass('hub-nav-pill');
    expect(document.querySelector('aside')).not.toHaveClass('border-r');
  });
  it('classic: active item keeps hub-nav-active hub-bg-soft', async () => {
    renderSidebar('/ws/hub/tok');
    const active = await screen.findByRole('link', { name: /início/i });
    expect(active).toHaveClass('hub-nav-active', 'hub-bg-soft');
    expect(active).not.toHaveClass('hub-nav-pill');
  });
```

Mobile nav (add `import { fetchPosts } from '../../api';` next to the file's existing api mock; use the file's bootstrap constant, named `BOOTSTRAP` here):
```tsx
  it('Pauta: menu button shows the pending count', async () => {
    // usePendingApprovalsCount = fetchPosts posts filtered by enviado_cliente
    vi.mocked(fetchPosts).mockResolvedValueOnce({
      posts: [
        { id: 1, status: 'enviado_cliente' },
        { id: 2, status: 'enviado_cliente' },
      ],
      postApprovals: [],
      instagramProfile: null,
    } as never);
    renderMobileNav({ ...BOOTSTRAP, feature_hub_pauta: true });
    const btn = await screen.findByRole('button', { name: 'Abrir menu, 2 pendências' });
    expect(within(btn).getByText('2')).toBeInTheDocument();
  });
  it('classic: no count on the menu button', async () => {
    renderMobileNav(BOOTSTRAP);
    expect(await screen.findByRole('button', { name: 'Abrir menu' })).toBeInTheDocument();
  });
```

WorkspaceMark:
```tsx
  it('Pauta monogram uses the tile radius and no hub-btn-primary', () => {
    // render the no-logo case like the file's existing monogram test, with feature_hub_pauta: true
    const mark = document.querySelector('[aria-hidden="true"]') as HTMLElement;
    expect(mark).not.toHaveClass('hub-btn-primary');
    expect(mark.style.borderRadius).toBe('var(--hub-r-tile)');
    expect(mark.style.background).toBe('var(--hub-primary)');
  });
```

Run: `npx vitest run apps/hub/src/shell apps/hub/src/components/__tests__/WorkspaceMark.test.tsx` → FAIL.

- [ ] **Step 2: `pautaNav.ts`**

```ts
import type { CSSProperties } from 'react';

/** Nav counters in Pauta: brand-tinted when idle, inverted on the active pill.
 * Inline because the radius is per-preset and must not meet hub-btn-primary. */
export const PAUTA_BADGE_CLASS =
  'min-w-[18px] h-[18px] px-1 text-[12px] font-bold flex items-center justify-center';

export function pautaBadgeStyle(active: boolean): CSSProperties {
  return active
    ? { background: 'var(--hub-primary-fg)', color: 'var(--hub-primary)', borderRadius: 'var(--hub-r-chip)' }
    : { background: 'var(--hub-acc-soft)', color: 'var(--hub-txt)', borderRadius: 'var(--hub-r-chip)' };
}
```

- [ ] **Step 3: `HubSidebar`**

Add `const look = useHubLook(); const pauta = look === 'pauta';`. Changes, each with the classic string kept verbatim in the `false` branch:

- `<aside className={pauta ? 'hidden md:flex fixed left-0 top-0 bottom-0 w-[240px] z-30 flex-col bg-[var(--hub-bg)]' : '<current string>'}>`
- Link className:

```tsx
              className={
                pauta
                  ? `flex items-center gap-2.5 px-3 py-2.5 rounded-[var(--hub-r-ctl)] text-[13.5px] min-h-[40px] transition-colors ${
                      active ? 'font-semibold hub-nav-pill' : 'font-medium hub-tx2 hover:bg-[var(--hub-soft)]'
                    }`
                  : `<current template literal>`
              }
```

- Badge:

```tsx
              {!!badge &&
                (pauta ? (
                  <span className={PAUTA_BADGE_CLASS} style={pautaBadgeStyle(active)}>
                    {badge}
                  </span>
                ) : (
                  <span className="<current classes>">{badge}</span>
                ))}
```

- Workspace name div: `font-semibold text-[14.5px]` → in Pauta `font-display hub-display-title text-[15px]` (rest unchanged).
- Language and theme buttons: in Pauta both use `w-8 h-8 flex items-center justify-center rounded-[var(--hub-r-ctl)] border hub-border hover:bg-[var(--hub-soft)] transition-colors` (theme button also `hub-tx3`).

- [ ] **Step 4: `HubMobileNav`**

Add `const pauta = useHubLook() === 'pauta';` and `const pendingTotal = pendingCount + mensagensUnread;`. Changes:

- Bar div: `rounded-2xl` → in Pauta `rounded-[var(--hub-r-card)]` (build the className with the same template, swapping only that token).
- Workspace name spans (bar and drawer): in Pauta `font-display text-[15px] hub-display-title hub-txt truncate` (drops `font-medium`).
- Trigger button:

```tsx
            <button
              type="button"
              ref={triggerRef}
              aria-label={
                pauta && pendingTotal > 0
                  ? t('nav.openMenuPending', { count: pendingTotal })
                  : t('nav.openMenu', 'Abrir menu')
              }
              aria-haspopup="dialog"
              aria-expanded={open}
              onClick={() => setOpen(true)}
              className={
                pauta
                  ? 'relative w-10 h-10 rounded-[var(--hub-r-ctl)] border hub-border flex items-center justify-center hub-txt'
                  : 'w-10 h-10 rounded-lg border hub-border flex items-center justify-center hub-txt'
              }
            >
              <Menu size={18} />
              {pauta && pendingTotal > 0 && (
                <span
                  aria-hidden="true"
                  className="absolute -top-1 -right-1 min-w-[16px] h-4 px-1 text-[10.5px] font-bold flex items-center justify-center"
                  style={{ background: 'var(--hub-primary)', color: 'var(--hub-primary-fg)', borderRadius: 'var(--hub-r-chip)' }}
                >
                  {pendingTotal}
                </span>
              )}
            </button>
```

- Drawer links: Pauta `flex items-center gap-3 px-3 py-3 rounded-[var(--hub-r-ctl)] min-h-[48px] transition-colors ${active ? 'font-semibold hub-nav-pill' : 'font-medium hub-tx2 hover:bg-[var(--hub-soft)]'}`; badges as in the sidebar.
- Drawer close, language and theme buttons: Pauta `rounded-[var(--hub-r-ctl)]` instead of `rounded-full`; language and theme buttons also `border hub-border`.

Behaviour (focus trap, Escape, scroll lock, sentinel) untouched.

- [ ] **Step 5: i18n**

`packages/i18n/locales/pt/common.json`, inside `"nav"` (keep alphabetical position irrelevant; append):

```json
    "openMenuPending_one": "Abrir menu, 1 pendência",
    "openMenuPending_other": "Abrir menu, {{count}} pendências"
```

`packages/i18n/locales/en/common.json` `"nav"`:

```json
    "openMenuPending_one": "Open menu, 1 pending item",
    "openMenuPending_other": "Open menu, {{count}} pending items"
```

- [ ] **Step 6: `WorkspaceMark` monogram**

In the final `return`, branch:

```tsx
  if (look === 'pauta') {
    return (
      <div
        style={{
          ...box,
          fontSize: Math.round(size * 0.42),
          borderRadius: 'var(--hub-r-tile)',
          background: 'var(--hub-primary)',
          color: 'var(--hub-primary-fg)',
        }}
        aria-hidden="true"
        className="flex items-center justify-center font-display hub-display-title flex-shrink-0"
      >
        {name.trim().charAt(0).toUpperCase()}
      </div>
    );
  }
```

with `const look = useHubLook();` at the top of the component. Classic return unchanged.

- [ ] **Step 7: Run + typecheck**

Run: `npx vitest run apps/hub/src/shell apps/hub/src/components/__tests__/WorkspaceMark.test.tsx && npx tsc -p apps/hub/tsconfig.json --noEmit`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add apps/hub/src/shell apps/hub/src/components/WorkspaceMark.tsx apps/hub/src/components/__tests__/WorkspaceMark.test.tsx packages/i18n/locales/pt/common.json packages/i18n/locales/en/common.json
git commit -m "feat(hub): menu lateral, gaveta e monograma no Pauta"
```

---

### Task 6: PageHeader eyebrow, filters, Aprovações controls

Depends on Task 4.

**Files:**
- Modify: `apps/hub/src/components/PageHeader.tsx`
- Modify: `apps/hub/src/components/filterPill.ts`, `StatusFilterChips.tsx:51`, `FilterDropdown.tsx:71,87,114`, `FloatingFilterBar.tsx:125`
- Modify: `apps/hub/src/pages/AprovacoesPage.tsx:24-50,197` (SortToggle + "Selecionar")
- Test: create `apps/hub/src/components/__tests__/PageHeader.test.tsx`; add cases to `StatusFilterChips.test.tsx`

**Interfaces:**
- Consumes: `useHubLook()`, `HubContext`, `.hub-eyebrow`, `.hub-display-title`.
- Produces: `PageHeader({ title, description?, action?, eyebrow? })`; `filterPillStyle(selected: boolean, look?: HubLook): CSSProperties`.

- [ ] **Step 1: Failing tests**

`PageHeader.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { HubContext } from '../../HubContext';
import { PageHeader } from '../PageHeader';

const ctx = (extra: object) =>
  ({ bootstrap: { cliente_nome: 'Clínica Aurora', ...extra } }) as never;

describe('PageHeader', () => {
  it('classic: no eyebrow, title keeps font-medium', () => {
    render(
      <HubContext.Provider value={ctx({})}>
        <PageHeader title="Aprovações" />
      </HubContext.Provider>,
    );
    expect(screen.queryByText('Clínica Aurora')).toBeNull();
    expect(screen.getByRole('heading', { name: 'Aprovações' })).toHaveClass('font-medium');
  });
  it('Pauta: client name as eyebrow and hub-display-title', () => {
    render(
      <HubContext.Provider value={ctx({ feature_hub_pauta: true })}>
        <PageHeader title="Aprovações" />
      </HubContext.Provider>,
    );
    expect(screen.getByText('Clínica Aurora')).toHaveClass('hub-eyebrow');
    expect(screen.getByRole('heading', { name: 'Aprovações' })).toHaveClass('hub-display-title');
  });
  it('Pauta: explicit eyebrow wins', () => {
    render(
      <HubContext.Provider value={ctx({ feature_hub_pauta: true })}>
        <PageHeader title="X" eyebrow="Outro" />
      </HubContext.Provider>,
    );
    expect(screen.getByText('Outro')).toHaveClass('hub-eyebrow');
  });
});
```

`StatusFilterChips.test.tsx` add:

```tsx
  it('Pauta: selected chip uses the primary and the chip radius', () => {
    // render like the existing tests, wrapped in HubContext.Provider value={{ bootstrap: { feature_hub_pauta: true } } as never}
    const selected = screen.getByRole('button', { pressed: true });
    expect(selected.style.background).toBe('var(--hub-primary)');
    expect(selected.style.borderRadius).toBe('var(--hub-r-chip)');
  });
```

Run: `npx vitest run apps/hub/src/components/__tests__/PageHeader.test.tsx apps/hub/src/components/__tests__/StatusFilterChips.test.tsx` → FAIL.

- [ ] **Step 2: `PageHeader`**

```tsx
import { useContext, type ReactNode } from 'react';
import { HubContext } from '../HubContext';
import { useHubLook } from '../hooks/useHubLook';

export function PageHeader({
  title,
  description,
  action,
  eyebrow,
}: {
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  /** Pauta only. Defaults to the client's name. */
  eyebrow?: ReactNode;
}) {
  const pauta = useHubLook() === 'pauta';
  const clienteNome = useContext(HubContext)?.bootstrap?.cliente_nome;
  const eyebrowNode = pauta ? (eyebrow ?? clienteNome) : null;
  return (
    <header className="mb-8">
      {eyebrowNode ? <div className="hub-eyebrow mb-2.5">{eyebrowNode}</div> : null}
      <div className="flex items-center justify-between gap-4">
        <h2
          className={
            pauta
              ? 'font-display text-[2rem] sm:text-[2.25rem] leading-[1.05] hub-display-title tracking-tight hub-txt'
              : 'font-display text-[2rem] sm:text-[2.25rem] leading-[1.05] font-medium tracking-tight hub-txt'
          }
        >
          {title}
        </h2>
        {action}
      </div>
      {description && <p className="text-[14px] hub-tx2 mt-2">{description}</p>}
    </header>
  );
}
```

(Keep the existing doc comment above the function.)

- [ ] **Step 3: `filterPillStyle` and callers**

```ts
import type { CSSProperties } from 'react';
import type { HubLook } from '../theme';

export function filterPillStyle(selected: boolean, look: HubLook = 'classic'): CSSProperties {
  if (look === 'pauta') {
    return selected
      ? {
          background: 'var(--hub-primary)',
          color: 'var(--hub-primary-fg)',
          borderColor: 'var(--hub-primary)',
          borderRadius: 'var(--hub-r-chip)',
        }
      : {
          background: 'var(--hub-card)',
          color: 'var(--hub-tx2)',
          borderColor: 'var(--hub-bd)',
          borderRadius: 'var(--hub-r-chip)',
        };
  }
  return selected
    ? { background: 'var(--hub-acc)', color: 'var(--hub-acc-fg)', borderColor: 'var(--hub-acc)' }
    : { background: 'var(--hub-card)', color: 'var(--hub-tx2)', borderColor: 'var(--hub-bd)' };
}
```

Callers: in `StatusFilterChips.tsx`, `FilterDropdown.tsx` and `AprovacoesPage.tsx`'s `SortToggle`, add `const look = useHubLook();` and call `filterPillStyle(selected, look)` (FilterDropdown: `filterPillStyle(active, look)`). `MonthFilterDropdown`/`MediaFilterDropdown` render `FilterDropdown`, so they need no change.

- [ ] **Step 4: Radii in filter containers**

- `FloatingFilterBar.tsx:125`: replace `rounded-2xl` in the template with `${pauta ? 'rounded-[var(--hub-r-card)]' : 'rounded-2xl'}` (add `const pauta = useHubLook() === 'pauta';`).
- `FilterDropdown.tsx:87` (popover) and `:114` (items): `rounded-[4px]` → `${pauta ? 'rounded-[var(--hub-r-chip)]' : 'rounded-[4px]'}` on items; the popover uses `${pauta ? 'rounded-[var(--hub-r-card)]' : 'rounded-[4px]'}` (not `--hub-r-ctl`, which is 999px on Pílula and would clip a 260px list).

- [ ] **Step 5: Aprovações "Selecionar"**

In `AprovacoesPage.tsx` (~line 197), add `const pauta = useHubLook() === 'pauta';` in `AprovacoesPage` and:

```tsx
                  className={
                    pauta
                      ? 'hub-btn-secondary px-3 py-2 text-[13px] font-semibold'
                      : 'rounded-[4px] border hub-border px-3 py-2 text-[13px] font-semibold hub-tx2'
                  }
```

Do not touch the spinner line (Task 10).

- [ ] **Step 6: Run + typecheck**

Run: `npx vitest run apps/hub && npx tsc -p apps/hub/tsconfig.json --noEmit` → PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/hub/src/components/PageHeader.tsx apps/hub/src/components/__tests__/PageHeader.test.tsx apps/hub/src/components/filterPill.ts apps/hub/src/components/StatusFilterChips.tsx apps/hub/src/components/__tests__/StatusFilterChips.test.tsx apps/hub/src/components/FilterDropdown.tsx apps/hub/src/components/FloatingFilterBar.tsx apps/hub/src/pages/AprovacoesPage.tsx
git commit -m "feat(hub): eyebrow nos cabeçalhos e filtros no Pauta"
```

---

### Task 7: PostCalendar (today, selected, selos)

Depends on Task 4.

**Files:**
- Modify: `apps/hub/src/components/PostCalendar.tsx:302-325,456-471`
- Test: `apps/hub/src/components/__tests__/PostCalendar.test.tsx`

**Interfaces:**
- Consumes: `useHubLook()`, `selo(...).semantic`.

- [ ] **Step 1: Failing tests**

Add to `PostCalendar.test.tsx` (use its render helper; wrap in `HubContext.Provider value={{ bootstrap: { feature_hub_pauta: true } } as never}` when it doesn't already provide one, otherwise extend its bootstrap):

```tsx
  it('Pauta: selected day uses the primary fill; today-only gets a primary ring', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-18T12:00:00.000Z'));
    // render the calendar with no posts inside
    // <HubContext.Provider value={{ bootstrap: { feature_hub_pauta: true } } as never}>
    const chip = getDayButton(18).firstElementChild as HTMLElement;
    expect(chip.style.background).toBe('var(--hub-primary)');
    expect(chip.style.color).toBe('var(--hub-primary-fg)');
    fireEvent.click(getDayButton(17));
    const after = getDayButton(18).firstElementChild as HTMLElement;
    expect(after.style.boxShadow).toBe('inset 0 0 0 1.5px var(--hub-primary)');
    expect(after.style.color).toBe('var(--hub-txt)');
    vi.useRealTimers();
  });
  it('classic: selected day keeps the accent fill', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-18T12:00:00.000Z'));
    // same render without the provider
    const chip = getDayButton(18).firstElementChild as HTMLElement;
    expect(chip.style.background).toBe('var(--hub-acc)');
    vi.useRealTimers();
  });
```

`getDayButton(day)` is the file's existing helper (`PostCalendar.test.tsx:33`); follow the neighbouring tests for how they render and restore timers.

Run: `npx vitest run apps/hub/src/components/__tests__/PostCalendar.test.tsx` → FAIL.

- [ ] **Step 2: Implement**

Add `const pauta = useHubLook() === 'pauta';` in the component. Replace the chip `style` prop with:

```tsx
                    style={
                      pauta
                        ? isSelected
                          ? { background: 'var(--hub-primary)', color: 'var(--hub-primary-fg)' }
                          : isToday
                            ? { boxShadow: 'inset 0 0 0 1.5px var(--hub-primary)', color: 'var(--hub-txt)' }
                            : undefined
                        : isSelected
                          ? { background: 'var(--hub-acc)', color: 'var(--hub-acc-fg)' }
                          : isToday
                            ? {
                                boxShadow: 'inset 0 0 0 1.5px var(--hub-acc)',
                                color: 'var(--hub-acc)',
                              }
                            : undefined
                    }
```

The classic object literals stay byte-identical (the existing comment about `rounded-[13px]` still holds; leave it). Dots keep `TIPO_COLOR`. At line ~471: `<StatusPill tone={s.tone} semantic={s.semantic}>{s.texto}</StatusPill>`.

- [ ] **Step 3: Run + commit**

Run: `npx vitest run apps/hub/src/components/__tests__/PostCalendar.test.tsx apps/hub/src/pages/__tests__/homeCalendarRange.test.tsx && npx tsc -p apps/hub/tsconfig.json --noEmit` → PASS.

```bash
git add apps/hub/src/components/PostCalendar.tsx apps/hub/src/components/__tests__/PostCalendar.test.tsx
git commit -m "feat(hub): calendário com hoje e dia selecionado legíveis no Pauta"
```

---

### Task 8: Post surfaces (PostCard, PostTile, StoriesRail)

Depends on Task 4.

**Files:**
- Modify: `apps/hub/src/components/PostCard.tsx:355-372`
- Modify: `apps/hub/src/components/posts/PostTile.tsx:63,~153-157`
- Modify: `apps/hub/src/components/posts/StoriesRail.tsx:23,32-49`
- Test: `apps/hub/src/components/__tests__/PostCard.test.tsx`; create `apps/hub/src/components/posts/__tests__/PostTile.pauta.test.tsx`

**Interfaces:**
- Consumes: `useHubLook()`, `StatusPill semantic`, `statusTone`.

- [ ] **Step 1: Failing tests**

`PostCard.test.tsx` (wrap the existing render helper with a Pauta provider variant):

```tsx
  it('Pauta: pending pill is wait, agendado uses the sched tone', () => {
    // render a post with status 'enviado_cliente' in Pauta
    expect(screen.getByText(/aguardando/i)).toHaveClass('hub-pill-st-wait');
    // render a post with status 'agendado' in Pauta
    const pill = screen.getByText(/agendado/i);
    expect(pill.style.color).toBe('var(--hub-st-sched-fg)');
    expect(pill.style.background).toBe('var(--hub-st-sched-bg)');
  });
```

(Use the exact labels from `getPostStatusLabel` for those statuses.)

`PostTile.pauta.test.tsx`: render a selectable tile in select mode with `selected` true inside a Pauta provider (copy the props the existing PostGrid/PostTile tests use) and assert the tile button has class `ring-[var(--hub-primary)]` and not `ring-[#0095f6]`; the format glyph span has `rounded-[var(--hub-r-chip)]`.

Run: `npx vitest run apps/hub/src/components` → FAIL.

- [ ] **Step 2: PostCard**

Add `const pauta = useHubLook() === 'pauta';`. Replace the status block:

```tsx
            {post.status === 'agendado' ? (
              pauta ? (
                <span
                  className="hub-pill"
                  style={{ color: 'var(--hub-st-sched-fg)', background: 'var(--hub-st-sched-bg)' }}
                >
                  {getPostStatusLabel(t, post.status)}
                </span>
              ) : (
                <span className="text-[12px] font-semibold px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200/60">
                  {getPostStatusLabel(t, post.status)}
                </span>
              )
            ) : (
              <StatusPill
                tone={post.status === 'correcao_cliente' ? 'danger' : isPending ? 'accent' : 'neutral'}
                semantic={
                  post.status === 'correcao_cliente'
                    ? 'fix'
                    : isPending
                      ? 'wait'
                      : post.status === 'aprovado_cliente'
                        ? 'ok'
                        : 'neutral'
                }
              >
                {getPostStatusLabel(t, post.status)}
              </StatusPill>
            )}
```

The format chip at line 357 (`hub-btn-primary px-2 py-0.5 rounded-full`) stays as is: it keeps `rounded-full`, so the Pauta CSS rule skips it.

- [ ] **Step 3: PostTile**

Add `const pauta = useHubLook() === 'pauta';`.
- Glyph span (line 63): `rounded-md` → `${pauta ? 'rounded-[var(--hub-r-chip)]' : 'rounded-md'}`.
- Selection ring (select-mode button, ~line 153): `ring-[3px] ring-[#0095f6]` → in Pauta `ring-[3px] ring-[var(--hub-primary)]`; the check circle `bg-[#0095f6]` → in Pauta add `style={{ background: 'var(--hub-primary)', color: 'var(--hub-primary-fg)' }}` and drop the `bg-[#0095f6]` class only in the Pauta branch.
- Grid, aspect ratio, gaps and the absence of tile radius stay untouched.

- [ ] **Step 4: StoriesRail**

Add `const pauta = useHubLook() === 'pauta';` and import `statusTone` from `../../lib/postView`. Only the status dot (line ~48) changes, keeping `rounded-full` and the Instagram gradient ring (the platform's own affordance):

```tsx
                style={{
                  background: pauta
                    ? `var(--hub-st-${statusTone(getPostPublishState(post))}-fg)`
                    : color,
                }}
```

This deliberately narrows the spec line "anéis/selos com os tokens de status e raios do preset" to the colour; Task 12 Step 3 records it in the spec.

- [ ] **Step 5: Run + commit**

Run: `npx vitest run apps/hub && npx tsc -p apps/hub/tsconfig.json --noEmit` → PASS.

```bash
git add apps/hub/src/components/PostCard.tsx apps/hub/src/components/__tests__/PostCard.test.tsx apps/hub/src/components/posts/PostTile.tsx apps/hub/src/components/posts/__tests__/PostTile.pauta.test.tsx apps/hub/src/components/posts/StoriesRail.tsx
git commit -m "feat(hub): selos semânticos e seleção no tom da marca nos posts do Pauta"
```

---

### Task 9: Home Pauta (greeting, KPI strip, numbered sections, agenda, results)

Depends on Task 4.

**Files:**
- Create: `apps/hub/src/pages/home/pautaHome.ts`
- Create: `apps/hub/src/pages/home/__tests__/pautaHome.test.ts`
- Create: `apps/hub/src/components/SectionHeader.tsx`
- Create: `apps/hub/src/pages/home/resourceLinks.ts`
- Create: `apps/hub/src/pages/home/PautaGreeting.tsx`
- Create: `apps/hub/src/pages/home/PautaKpiStrip.tsx`
- Create: `apps/hub/src/pages/home/WaitingSection.tsx`
- Create: `apps/hub/src/pages/home/ResourcesSection.tsx`
- Create: `apps/hub/src/pages/HomePagePauta.tsx`
- Create: `apps/hub/src/pages/agenda/HomeAgendaPauta.tsx`
- Create: `apps/hub/src/pages/__tests__/homePauta.test.tsx`
- Modify: `apps/hub/src/pages/HomePage.tsx` (branch only)
- Modify: `apps/hub/src/components/dashboard/DashboardSection.tsx:19,70-76`
- Modify: `packages/i18n/locales/{pt,en}/hubHome.json`, `packages/i18n/locales/{pt,en}/hubAgenda.json`

**Interfaces:**
- Consumes: `useHubLook()`, `StatusPill semantic`, `selo(...).semantic`, `.hub-eyebrow`, `.hub-eyebrow-plain`, `.hub-display-title`, `.hub-spinner`, `getPlatformLabel` and `formatDate` from `components/PostCard`, `getTipoLabel`/`getPostCover`/`getClientStatusLabel` from `lib/postView`.
- Produces:
  - `greetingKey(hour: number): 'morning' | 'afternoon' | 'evening'`
  - `formatEyebrowDate(d: Date, lang: string): string`
  - `startOfNextMonday(now: Date): Date`
  - `weekCount(posts: { status: string; scheduled_at: string | null }[], now: Date): number`
  - `numberSections(hasPending: boolean, hasAgenda: boolean): { approvals: number | null; calendar: number; agenda: number | null; resources: number; results: number }`
  - `pad2(n: number): string`
  - `SectionHeader({ number, label, title, action? })` from `apps/hub/src/components/SectionHeader.tsx`
  - `DashboardSection({ sectionNumber?: number })`
  - `HomeAgendaPauta({ token, base, number })`

- [ ] **Step 1: Pure helpers, failing tests**

`apps/hub/src/pages/home/__tests__/pautaHome.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  formatEyebrowDate,
  greetingKey,
  numberSections,
  pad2,
  startOfNextMonday,
  weekCount,
} from '../pautaHome';

describe('greetingKey', () => {
  it.each([
    [5, 'morning'], [11, 'morning'], [12, 'afternoon'], [17, 'afternoon'],
    [18, 'evening'], [23, 'evening'], [0, 'evening'], [4, 'evening'],
  ])('%i h → %s', (h, k) => expect(greetingKey(h)).toBe(k));
});

describe('formatEyebrowDate', () => {
  const thu = new Date(2026, 9, 8, 9, 0); // Thursday, local time
  it('pt drops "-feira" and capitalizes', () => expect(formatEyebrowDate(thu, 'pt')).toBe('Quinta, 8 de outubro'));
  it('en', () => expect(formatEyebrowDate(thu, 'en')).toBe('Thursday, October 8'));
  it('pt keeps sábado/domingo whole', () =>
    expect(formatEyebrowDate(new Date(2026, 9, 10), 'pt')).toBe('Sábado, 10 de outubro'));
});

describe('week window', () => {
  it('next Monday 00:00 from a Thursday', () => {
    expect(startOfNextMonday(new Date(2026, 9, 8, 15, 0))).toEqual(new Date(2026, 9, 12, 0, 0, 0, 0));
  });
  it('a Monday counts until the following Monday', () => {
    expect(startOfNextMonday(new Date(2026, 9, 12, 8, 0))).toEqual(new Date(2026, 9, 19));
  });
  it('a Sunday ends at midnight', () => {
    expect(startOfNextMonday(new Date(2026, 9, 11, 22, 0))).toEqual(new Date(2026, 9, 12));
  });
  it('counts agendado + aprovado_cliente in [now, next Monday)', () => {
    const now = new Date(2026, 9, 11, 22, 0); // Sunday 22:00
    const at = (d: Date) => d.toISOString();
    const posts = [
      { status: 'agendado', scheduled_at: at(new Date(2026, 9, 11, 23, 0)) }, // in
      { status: 'aprovado_cliente', scheduled_at: at(new Date(2026, 9, 11, 23, 59)) }, // in
      { status: 'agendado', scheduled_at: at(new Date(2026, 9, 12, 0, 0)) }, // Monday 00:00, out
      { status: 'agendado', scheduled_at: at(new Date(2026, 9, 11, 21, 0)) }, // past, out
      { status: 'enviado_cliente', scheduled_at: at(new Date(2026, 9, 11, 23, 0)) }, // wrong status
      { status: 'agendado', scheduled_at: null },
    ];
    expect(weekCount(posts, now)).toBe(2);
  });
});

describe('numberSections', () => {
  it('all present', () =>
    expect(numberSections(true, true)).toEqual({ approvals: 1, calendar: 2, agenda: 3, resources: 4, results: 5 }));
  it('no pending, no agenda', () =>
    expect(numberSections(false, false)).toEqual({ approvals: null, calendar: 1, agenda: null, resources: 2, results: 3 }));
  it('pad2', () => expect(pad2(3)).toBe('03'));
});
```

Run: `npx vitest run apps/hub/src/pages/home` → FAIL.

- [ ] **Step 2: `pautaHome.ts`**

```ts
export function greetingKey(hour: number): 'morning' | 'afternoon' | 'evening' {
  if (hour >= 5 && hour < 12) return 'morning';
  if (hour >= 12 && hour < 18) return 'afternoon';
  return 'evening';
}

/** "Quinta, 8 de outubro" / "Thursday, October 8". */
export function formatEyebrowDate(d: Date, lang: string): string {
  if (lang.startsWith('en')) {
    return d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
  }
  const weekday = d.toLocaleDateString('pt-BR', { weekday: 'long' }).replace(/-feira$/, '');
  const dayMonth = d.toLocaleDateString('pt-BR', { day: 'numeric', month: 'long' });
  return `${weekday.charAt(0).toUpperCase()}${weekday.slice(1)}, ${dayMonth}`;
}

/** Start of next Monday in the browser's zone (the zone the Hub calendar groups days in). */
export function startOfNextMonday(now: Date): Date {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  const add = (8 - d.getDay()) % 7 || 7;
  d.setDate(d.getDate() + add);
  return d;
}

export function weekCount(
  posts: { status: string; scheduled_at: string | null }[],
  now: Date,
): number {
  const start = now.getTime();
  const end = startOfNextMonday(now).getTime();
  return posts.filter((p) => {
    if (p.status !== 'agendado' && p.status !== 'aprovado_cliente') return false;
    if (!p.scheduled_at) return false;
    const t = Date.parse(p.scheduled_at);
    return t >= start && t < end;
  }).length;
}

/** Section numbers from what Home knows synchronously; Results is always last. */
export function numberSections(hasPending: boolean, hasAgenda: boolean) {
  let n = 0;
  const approvals = hasPending ? ++n : null;
  const calendar = ++n;
  const agenda = hasAgenda ? ++n : null;
  const resources = ++n;
  const results = ++n;
  return { approvals, calendar, agenda, resources, results };
}

export const pad2 = (n: number) => String(n).padStart(2, '0');
```

Run the helper tests → PASS.

- [ ] **Step 3: i18n**

`packages/i18n/locales/pt/hubHome.json`, add inside `"home"`:

```json
    "pauta": {
      "greeting": {
        "morning": "Bom dia, {{name}}.",
        "afternoon": "Boa tarde, {{name}}.",
        "evening": "Boa noite, {{name}}."
      },
      "summary": {
        "both": "Você tem <chip>{{posts}}</chip> para aprovar e <chip>{{publications}}</chip> saindo esta semana.",
        "pendingOnly": "Você tem <chip>{{posts}}</chip> para aprovar.",
        "weekOnly": "<chip>{{publications}}</chip> saindo esta semana.",
        "none": "Tudo em dia por aqui."
      },
      "chip": {
        "posts_one": "1 post",
        "posts_other": "{{count}} posts",
        "publications_one": "1 publicação",
        "publications_other": "{{count}} publicações"
      },
      "cta": { "review": "Revisar aprovações" },
      "kpi": { "pending": "Para aprovar", "reviewNow": "Revisar agora" },
      "section": {
        "approvals": "Aprovações",
        "calendar": "Calendário",
        "agenda": "Agenda",
        "resources": "Recursos",
        "results": "Resultados"
      },
      "waiting": { "title": "Esperando você", "seeAll": "Ver todas", "review": "Revisar" },
      "resources": { "title": "Acesso rápido" }
    }
```

`packages/i18n/locales/en/hubHome.json`, same keys:

```json
    "pauta": {
      "greeting": {
        "morning": "Good morning, {{name}}.",
        "afternoon": "Good afternoon, {{name}}.",
        "evening": "Good evening, {{name}}."
      },
      "summary": {
        "both": "You have <chip>{{posts}}</chip> to approve and <chip>{{publications}}</chip> going out this week.",
        "pendingOnly": "You have <chip>{{posts}}</chip> to approve.",
        "weekOnly": "<chip>{{publications}}</chip> going out this week.",
        "none": "All caught up here."
      },
      "chip": {
        "posts_one": "1 post",
        "posts_other": "{{count}} posts",
        "publications_one": "1 publication",
        "publications_other": "{{count}} publications"
      },
      "cta": { "review": "Review approvals" },
      "kpi": { "pending": "To approve", "reviewNow": "Review now" },
      "section": {
        "approvals": "Approvals",
        "calendar": "Calendar",
        "agenda": "Agenda",
        "resources": "Resources",
        "results": "Results"
      },
      "waiting": { "title": "Waiting on you", "seeAll": "See all", "review": "Review" },
      "resources": { "title": "Quick access" }
    }
```

`hubAgenda.json` `"home"`: pt `"vazio": "Nenhum evento nos próximos dias"`, en `"vazio": "No events in the coming days"`.

The Calendar section title reuses `home.calendarSection.subtitle` ("Próximas publicações"); Results reuses `dashboard.title` ("Desempenho"); Agenda reuses hubAgenda `home.titulo`.

- [ ] **Step 4: Presentational pieces**

`apps/hub/src/components/SectionHeader.tsx`:

```tsx
import type { ReactNode } from 'react';
import { pad2 } from '../pages/home/pautaHome';

export function SectionHeader({
  number,
  label,
  title,
  action,
}: {
  number: number;
  label: string;
  title: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="flex items-end justify-between gap-3 mb-4">
      <div className="min-w-0">
        <div className="hub-eyebrow">
          {pad2(number)} · {label}
        </div>
        <h3 className="font-display hub-display-title text-[20px] leading-tight tracking-tight hub-txt mt-2">
          {title}
        </h3>
      </div>
      {action}
    </div>
  );
}
```

`PautaGreeting.tsx`:

```tsx
import { Trans, useTranslation } from 'react-i18next';
import { formatEyebrowDate, greetingKey } from './pautaHome';

export function PautaGreeting({
  firstName,
  pendingCount,
  weekTotal,
  loading,
  onReview,
}: {
  firstName: string;
  pendingCount: number;
  weekTotal: number;
  loading: boolean;
  onReview: () => void;
}) {
  const { t, i18n } = useTranslation('hubHome');
  const now = new Date();
  const summaryKey =
    pendingCount > 0 && weekTotal > 0
      ? 'both'
      : pendingCount > 0
        ? 'pendingOnly'
        : weekTotal > 0
          ? 'weekOnly'
          : 'none';
  const chip = (
    <span
      className="inline-flex items-center px-2 py-0.5 rounded-[var(--hub-r-chip)] font-semibold hub-txt"
      style={{ background: 'var(--hub-acc-soft)' }}
    />
  );
  return (
    <section className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        <div className="hub-eyebrow">{formatEyebrowDate(now, i18n.language)}</div>
        <h1 className="font-display hub-display-title text-[clamp(2rem,5vw,2.75rem)] leading-[1.05] tracking-tight hub-txt mt-3">
          {t(`home.pauta.greeting.${greetingKey(now.getHours())}`, { name: firstName })}
        </h1>
        {loading ? (
          <div
            data-testid="pauta-summary-skeleton"
            className="h-5 w-72 max-w-full mt-3 rounded-[var(--hub-r-chip)] hub-bg-soft animate-pulse"
          />
        ) : (
          <p className="text-[15px] leading-relaxed hub-tx2 mt-3">
            <Trans
              t={t}
              i18nKey={`home.pauta.summary.${summaryKey}`}
              values={{
                posts: t('home.pauta.chip.posts', { count: pendingCount }),
                publications: t('home.pauta.chip.publications', { count: weekTotal }),
              }}
              components={{ chip }}
            />
          </p>
        )}
      </div>
      {!loading && pendingCount > 0 && (
        <button
          type="button"
          onClick={onReview}
          className="hub-btn-primary h-11 px-5 text-[14px] font-semibold shrink-0 self-start sm:self-end"
        >
          {t('home.pauta.cta.review', 'Revisar aprovações')}
        </button>
      )}
    </section>
  );
}
```

`PautaKpiStrip.tsx`:

```tsx
export interface PautaKpi {
  label: string;
  value: string;
  emphasized?: boolean;
  action?: { label: string; onClick: () => void };
}

// Hairlines: 2×2 below sm (left rule on odd cells, top rule on the second row),
// one row of four from sm.
const CELL_BORDER = ['', 'border-l', 'border-t sm:border-t-0 sm:border-l', 'border-l border-t sm:border-t-0'];

export function PautaKpiStrip({ kpis, loading }: { kpis: PautaKpi[]; loading: boolean }) {
  return (
    <section className="hub-card grid grid-cols-2 sm:grid-cols-4 overflow-hidden">
      {kpis.map((k, i) => (
        <div key={k.label} className={`p-4 sm:p-5 flex flex-col gap-3 hub-border ${CELL_BORDER[i] ?? ''}`}>
          <div className={k.emphasized ? 'hub-eyebrow' : 'hub-eyebrow-plain'}>{k.label}</div>
          {loading ? (
            <div className="h-8 w-16 rounded-[var(--hub-r-chip)] hub-bg-soft animate-pulse" />
          ) : (
            <div className="font-display hub-display-title text-[2rem] leading-none tracking-tight tabular-nums hub-txt">
              {k.value}
            </div>
          )}
          {!loading && k.action && (
            <button
              type="button"
              onClick={k.action.onClick}
              className="self-start text-[13px] font-semibold hub-txt underline-offset-4 hover:underline"
            >
              {k.action.label}
            </button>
          )}
        </div>
      ))}
    </section>
  );
}
```

`WaitingSection.tsx`:

```tsx
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ChevronRight } from 'lucide-react';
import type { HubPost } from '../../types';
import { getClientStatusLabel, getPostCover, getTipoLabel } from '../../lib/postView';
import { formatDate, getPlatformLabel } from '../../components/PostCard';
import { StatusPill } from '../../components/StatusPill';
import { SectionHeader } from '../../components/SectionHeader';

export function WaitingSection({ number, posts, base }: { number: number; posts: HubPost[]; base: string }) {
  const { t } = useTranslation('hubHome');
  const { t: tp, i18n } = useTranslation('hubPosts');
  const dateLang = i18n.language === 'en' ? 'en-US' : 'pt-BR';
  return (
    <section className="hub-card p-5">
      <SectionHeader
        number={number}
        label={t('home.pauta.section.approvals', 'Aprovações')}
        title={t('home.pauta.waiting.title', 'Esperando você')}
        action={
          <Link to={`${base}/aprovacoes`} className="flex items-center gap-1 text-[13px] font-semibold hub-txt shrink-0 group">
            {t('home.pauta.waiting.seeAll', 'Ver todas')}
            <ChevronRight size={14} className="hub-tx3 group-hover:translate-x-0.5 transition-transform" />
          </Link>
        }
      />
      <ul className="hub-divide">
        {posts.map((p) => {
          const cover = getPostCover(p);
          const src = cover ? (cover.kind === 'image' ? cover.url : cover.thumbnail_url) : null;
          return (
            <li key={p.id} className="flex items-center gap-3 py-3">
              <span className="w-12 h-[60px] shrink-0 overflow-hidden rounded-[var(--hub-r-tile)] hub-bg-soft">
                {src && !cover?.media_lost_at && (
                  <img src={src} alt="" className="w-full h-full object-cover" loading="lazy" decoding="async" />
                )}
              </span>
              <div className="min-w-0 flex-1">
                <div className="text-[14px] font-medium hub-txt truncate">{p.titulo}</div>
                <div className="text-[12.5px] hub-tx3 mt-0.5 truncate">
                  {getTipoLabel(tp, p.tipo)} · {getPlatformLabel(tp, p.platform ?? 'instagram')}
                  {p.scheduled_at ? ` · ${formatDate(p.scheduled_at, dateLang)}` : ''}
                </div>
              </div>
              <span className="hidden sm:inline-flex">
                <StatusPill tone="accent" semantic="wait">
                  {getClientStatusLabel(tp, 'enviado_cliente')}
                </StatusPill>
              </span>
              <Link
                to={`${base}/aprovacoes/${p.id}`}
                className="hub-btn-secondary h-9 px-3 inline-flex items-center text-[13px] font-semibold shrink-0"
              >
                {t('home.pauta.waiting.review', 'Revisar')}
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
```

`ResourcesSection.tsx` (rows; reuses Home's `RESOURCE_LINKS` passed in as a prop to avoid a second list):

```tsx
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ChevronRight, type LucideIcon } from 'lucide-react';
import { SectionHeader } from '../../components/SectionHeader';

export function ResourcesSection({
  number,
  base,
  links,
}: {
  number: number;
  base: string;
  links: { labelKey: string; label: string; icon: LucideIcon; path: string }[];
}) {
  const { t } = useTranslation('hubHome');
  const navigate = useNavigate();
  return (
    <section className="hub-card p-5">
      <SectionHeader
        number={number}
        label={t('home.pauta.section.resources', 'Recursos')}
        title={t('home.pauta.resources.title', 'Acesso rápido')}
      />
      <div className="hub-divide">
        {links.map(({ labelKey, label, icon: Icon, path }) => (
          <button
            key={path}
            type="button"
            onClick={() => navigate(`${base}${path}`)}
            className="w-full flex items-center gap-3 py-2.5 text-left group"
          >
            <span className="w-8 h-8 rounded-[var(--hub-r-tile)] hub-bg-soft flex items-center justify-center hub-tx2 shrink-0">
              <Icon size={16} strokeWidth={1.75} />
            </span>
            <span className="flex-1 text-[14px] font-medium hub-txt">{t(labelKey, label)}</span>
            <ChevronRight size={14} className="hub-tx3 group-hover:translate-x-0.5 transition-transform" />
          </button>
        ))}
      </div>
    </section>
  );
}
```

- [ ] **Step 5: `HomeAgendaPauta`**

`apps/hub/src/pages/agenda/HomeAgendaPauta.tsx`:

```tsx
import { Link } from 'react-router-dom';
import { useInfiniteQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { ArrowRight, CalendarDays, ChevronRight } from 'lucide-react';
import { hubAgendaQuery } from '../../queries';
import { StatusPill } from '../../components/StatusPill';
import { SectionHeader } from '../../components/SectionHeader';
import { compararInicio, quando } from './formatar';
import { localeDe, selo, textoQuando } from './AgendaCard';

const MAX_ITENS = 3;

/** Pauta Home: one card, always present while the Agenda feature is on (the
 * classic HomeAgenda returns null without events). Same query as the page. */
export function HomeAgendaPauta({ token, base, number }: { token: string; base: string; number: number }) {
  const { t, i18n } = useTranslation('hubAgenda');
  const { t: tHome } = useTranslation('hubHome');
  const locale = localeDe(i18n.language);
  const { data, isPending } = useInfiniteQuery(hubAgendaQuery(token));

  const agora = Date.now();
  const proximos = (data?.pages[0]?.itens ?? [])
    .filter((i) => Date.parse(i.fim) > agora)
    .sort(compararInicio);
  const aguardando = proximos.filter((i) => i.resposta === null).length;

  return (
    <section className="hub-card p-5">
      <SectionHeader
        number={number}
        label={tHome('home.pauta.section.agenda', 'Agenda')}
        title={t('home.titulo', 'Próximos eventos')}
        action={
          <Link to={`${base}/agenda`} className="flex items-center gap-1 text-[13px] font-semibold hub-txt shrink-0 group">
            {t('home.verAgenda', 'Ver agenda')}
            <ChevronRight size={14} className="hub-tx3 group-hover:translate-x-0.5 transition-transform" />
          </Link>
        }
      />
      {isPending ? (
        <div className="flex justify-center py-8">
          <div className="animate-spin h-5 w-5 rounded-full border-2 hub-spinner" />
        </div>
      ) : (
        <>
          {aguardando > 0 && (
            <Link
              to={`${base}/agenda`}
              className="mb-2 flex items-center gap-2.5 px-3 py-2.5 rounded-[var(--hub-r-ctl)] text-[13px] font-medium hub-txt group"
              style={{ background: 'var(--hub-st-wait-bg)' }}
            >
              <CalendarDays size={15} strokeWidth={2} style={{ color: 'var(--hub-st-wait-fg)' }} />
              <span className="flex-1">
                {t('home.aguardando', { count: aguardando })}
              </span>
              <ArrowRight size={15} className="hub-tx3 group-hover:translate-x-0.5 transition-transform" />
            </Link>
          )}
          {proximos.length === 0 ? (
            <p className="py-6 text-center text-[13px] hub-tx3">
              {t('home.vazio', 'Nenhum evento nos próximos dias')}
            </p>
          ) : (
            <ul className="hub-divide">
              {proximos.slice(0, MAX_ITENS).map((item) => {
                const s = selo(item, false, t);
                return (
                  <li key={item.ocorrencia_id}>
                    <Link to={`${base}/agenda?ocorrencia=${item.ocorrencia_id}`} className="flex items-center gap-3 py-3">
                      <div className="min-w-0 flex-1">
                        <div className="text-[14px] font-medium hub-txt truncate">{item.titulo}</div>
                        <div className="text-[12.5px] hub-tx3 mt-0.5">{textoQuando(quando(item, locale), t, true)}</div>
                      </div>
                      <StatusPill tone={s.tone} semantic={s.semantic}>{s.texto}</StatusPill>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </>
      )}
    </section>
  );
}
```

(The classic `HomeAgenda` uses `t('home.aguardando_one', ...)`/`_other` with explicit keys; `t('home.aguardando', { count })` resolves the same plural keys.)

- [ ] **Step 6: `DashboardSection` gets `sectionNumber`**

```tsx
export function DashboardSection({ sectionNumber }: { sectionNumber?: number } = {}) {
```

Replace the header block in the final return (the `<div className="flex justify-between items-center mb-5">…</div>` containing the `h2`) with:

```tsx
      {sectionNumber !== undefined ? (
        <SectionHeader
          number={sectionNumber}
          label={t('home.pauta.section.results', 'Resultados')}
          title={t('dashboard.title', 'Desempenho')}
          action={<PeriodSelector value={period} onChange={setPeriod} />}
        />
      ) : (
        <div className="flex justify-between items-center mb-5">
          <h2 className="font-display text-xl font-semibold tracking-tight hub-txt">
            {t('dashboard.title', 'Desempenho')}
          </h2>
          <PeriodSelector value={period} onChange={setPeriod} />
        </div>
      )}
```

Import `SectionHeader` from `../SectionHeader`. Loading, error (`null`) and the "conecte o Instagram" state stay as they are.

- [ ] **Step 7: `HomePagePauta` and the branch in `HomePage`**

In `HomePage.tsx`:
1. Move `RESOURCE_LINKS` verbatim into `apps/hub/src/pages/home/resourceLinks.ts` (`export const RESOURCE_LINKS = [...]` with its lucide imports) and import it in `HomePage.tsx` from `./home/resourceLinks`.
2. Add `const look = useHubLook();` with the other hooks at the top.
3. Hoist the calendar body and the event dialog into constants **without changing their JSX**: `const calendarBody = isLoading ? (<div className="flex justify-center py-8">…spinner…</div>) : (<PostCalendar …/>);` and `const eventDialog = eventoAtual && (<HubDialog …>…</HubDialog>);` and use `{calendarBody}` / `{eventDialog}` in the classic tree where they were.
4. Right before the classic `return (`:

```tsx
  if (look === 'pauta') {
    return (
      <HomePagePauta
        base={base}
        token={token}
        firstName={firstName}
        posts={allPosts}
        loading={isLoading}
        pendingCount={pendingCount}
        agendaEnabled={agendaAtiva}
        kpis={{
          thisMonth: String(thisMonthCount),
          pending: String(pendingCount),
          approvalRate,
          nextPost: nextPost ? formatNextPost(nextPost.scheduled_at!, dateLocale) : '—',
        }}
        calendar={calendarBody}
        eventDialog={eventDialog}
      />
    );
  }
```

(`'—'` is the existing KPI placeholder glyph, a data dash, not prose copy.)

`apps/hub/src/pages/HomePagePauta.tsx`:

```tsx
import type { ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import type { HubPost } from '../types';
import { DashboardSection } from '../components/dashboard/DashboardSection';
import { HomeAgendaPauta } from './agenda/HomeAgendaPauta';
import { PautaGreeting } from './home/PautaGreeting';
import { PautaKpiStrip } from './home/PautaKpiStrip';
import { ResourcesSection } from './home/ResourcesSection';
import { SectionHeader } from '../components/SectionHeader';
import { WaitingSection } from './home/WaitingSection';
import { numberSections, weekCount } from './home/pautaHome';
import { RESOURCE_LINKS } from './home/resourceLinks';

export function HomePagePauta({
  base,
  token,
  firstName,
  posts,
  loading,
  pendingCount,
  agendaEnabled,
  kpis,
  calendar,
  eventDialog,
}: {
  base: string;
  token: string;
  firstName: string;
  posts: HubPost[];
  loading: boolean;
  pendingCount: number;
  agendaEnabled: boolean;
  kpis: { thisMonth: string; pending: string; approvalRate: string; nextPost: string };
  calendar: ReactNode;
  eventDialog: ReactNode;
}) {
  const { t } = useTranslation('hubHome');
  const navigate = useNavigate();
  const goApprovals = () => navigate(`${base}/aprovacoes`);
  const sections = numberSections(pendingCount > 0, agendaEnabled);
  const pending = posts.filter((p) => p.status === 'enviado_cliente').slice(0, 3);

  return (
    <div className="hub-fade-up flex flex-col gap-6">
      <PautaGreeting
        firstName={firstName}
        pendingCount={pendingCount}
        weekTotal={weekCount(posts, new Date())}
        loading={loading}
        onReview={goApprovals}
      />
      <PautaKpiStrip
        loading={loading}
        kpis={[
          { label: t('home.kpi.postsThisMonth.label', 'Posts este mês'), value: kpis.thisMonth },
          {
            label: t('home.pauta.kpi.pending', 'Para aprovar'),
            value: kpis.pending,
            emphasized: true,
            action:
              pendingCount > 0
                ? { label: t('home.pauta.kpi.reviewNow', 'Revisar agora'), onClick: goApprovals }
                : undefined,
          },
          { label: t('home.kpi.approvalRate.label', 'Taxa de aprovação'), value: kpis.approvalRate },
          { label: t('home.kpi.nextPost.label', 'Próximo post'), value: kpis.nextPost },
        ]}
      />
      {loading ? (
        <section className="hub-card flex justify-center py-12" data-testid="pauta-home-loading">
          <div className="animate-spin h-5 w-5 rounded-full border-2 hub-spinner" />
        </section>
      ) : (
        <>
          {sections.approvals !== null && (
            <WaitingSection number={sections.approvals} posts={pending} base={base} />
          )}
          <section className="hub-card p-5">
            <SectionHeader
              number={sections.calendar}
              label={t('home.pauta.section.calendar', 'Calendário')}
              title={t('home.calendarSection.subtitle', 'Próximas publicações')}
            />
            {calendar}
          </section>
          <div className={agendaEnabled ? 'grid gap-6 lg:grid-cols-[2fr_1fr]' : 'grid gap-6'}>
            {sections.agenda !== null && (
              <HomeAgendaPauta token={token} base={base} number={sections.agenda} />
            )}
            <ResourcesSection number={sections.resources} base={base} links={RESOURCE_LINKS} />
          </div>
          <DashboardSection sectionNumber={sections.results} />
        </>
      )}
      {eventDialog}
    </div>
  );
}
```

`HomePagePauta` never imports from `HomePage`, so there is no import cycle.

- [ ] **Step 8: Integration test**

`apps/hub/src/pages/__tests__/homePauta.test.tsx`: copy the mocks and `renderHome` from `homeCalendarRange.test.tsx` (api mock, `DashboardSection` mock returning `null`, `PostCalendar` mock). Use `vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date(2026, 9, 8, 9, 0));` in `beforeEach` and `vi.useRealTimers()` in `afterEach`. Bootstrap: `{ ...hubValue.bootstrap, feature_hub_pauta: true }`. Cases:

```tsx
const pautaValue = {
  ...(hubValue as object),
  bootstrap: { ...(hubValue as { bootstrap: object }).bootstrap, feature_hub_pauta: true },
} as never;

it('greets by the hour, without italics or emoji', async () => {
  posts.mockResolvedValue({ posts: [], historyCutoff: null } as never);
  renderHome(pautaValue);
  expect(await screen.findByRole('heading', { level: 1, name: 'Bom dia, Ana.' })).toBeInTheDocument();
  expect(document.querySelector('em')).toBeNull();
  expect(screen.getByText('Quinta, 8 de outubro')).toHaveClass('hub-eyebrow');
});

it('summary with both clauses and the review button', async () => {
  posts.mockResolvedValue({
    posts: [
      { id: 1, titulo: 'A', status: 'enviado_cliente', scheduled_at: null, tipo: 'feed', media: [] },
      { id: 2, titulo: 'B', status: 'enviado_cliente', scheduled_at: null, tipo: 'feed', media: [] },
      { id: 3, titulo: 'C', status: 'agendado', scheduled_at: new Date(2026, 9, 9, 10).toISOString(), tipo: 'feed', media: [] },
    ],
    historyCutoff: null,
  } as never);
  renderHome(pautaValue);
  const p = await screen.findByText(/para aprovar e/);
  expect(p).toHaveTextContent('Você tem 2 posts para aprovar e 1 publicação saindo esta semana.');
  expect(screen.getByRole('button', { name: 'Revisar aprovações' })).toBeInTheDocument();
  expect(screen.getByText('01 · Aprovações')).toBeInTheDocument();
  expect(screen.getByText('02 · Calendário')).toBeInTheDocument();
  expect(screen.getAllByRole('link', { name: 'Revisar' })[0]).toHaveAttribute('href', '/mesaas/hub/tk/aprovacoes/1');
});

it('no pending: "Tudo em dia por aqui.", no Esperando você, calendar is 01', async () => {
  posts.mockResolvedValue({ posts: [], historyCutoff: null } as never);
  renderHome(pautaValue);
  expect(await screen.findByText('Tudo em dia por aqui.')).toBeInTheDocument();
  expect(screen.queryByText('Esperando você')).toBeNull();
  expect(screen.getByText('01 · Calendário')).toBeInTheDocument();
  expect(screen.getByText('02 · Recursos')).toBeInTheDocument();
});

it('with the agenda on: agenda card always present, empty state', async () => {
  posts.mockResolvedValue({ posts: [], historyCutoff: null } as never);
  agenda.mockResolvedValue({ itens: [], proximo: null } as never);
  renderHome({ ...pautaValue, bootstrap: { ...pautaValue.bootstrap, feature_agenda: true } });
  expect(await screen.findByText('02 · Agenda')).toBeInTheDocument();
  expect(await screen.findByText('Nenhum evento nos próximos dias')).toBeInTheDocument();
});

it('agenda card shows a spinner while the agenda loads', async () => {
  posts.mockResolvedValue({ posts: [], historyCutoff: null } as never);
  agenda.mockReturnValue(new Promise(() => {}) as never);
  renderHome({
    ...(pautaValue as object),
    bootstrap: { ...(pautaValue as { bootstrap: object }).bootstrap, feature_agenda: true },
  });
  const card = (await screen.findByText('02 · Agenda')).closest('section') as HTMLElement;
  expect(card.querySelector('.animate-spin')).not.toBeNull();
  expect(within(card).queryByText('Nenhum evento nos próximos dias')).toBeNull();
});

it('while posts load: skeleton, no numbered sections', async () => {
  posts.mockReturnValue(new Promise(() => {}) as never);
  renderHome(pautaValue);
  expect(await screen.findByTestId('pauta-home-loading')).toBeInTheDocument();
  expect(screen.queryByText(/01 ·/)).toBeNull();
});

it('en summary renders through <Trans>', async () => {
  await i18n.changeLanguage('en'); // import i18n from '@mesaas/i18n' the way other en tests do; restore 'pt' in afterEach
  posts.mockResolvedValue({ posts: [{ id: 1, titulo: 'A', status: 'enviado_cliente', scheduled_at: null, tipo: 'feed', media: [] }], historyCutoff: null } as never);
  renderHome(pautaValue);
  expect(await screen.findByText(/to approve/)).toHaveTextContent('You have 1 post to approve.');
});
```

(Check how `fetchAgenda` resolves in `homeCalendarRange.test.tsx` and the `HubPost` fields the mocks need; add fields until the components render without throwing. Find how existing tests switch to English with `grep -rn "changeLanguage('en')" apps/hub/src`.)

Run: `npx vitest run apps/hub/src/pages` → PASS, including the untouched `contentPages.test.tsx` and `homeCalendarRange.test.tsx`.

- [ ] **Step 9: Typecheck + commit**

Run: `npx tsc -p apps/hub/tsconfig.json --noEmit` → no errors.

```bash
git add apps/hub/src/pages/HomePage.tsx apps/hub/src/pages/HomePagePauta.tsx apps/hub/src/pages/home apps/hub/src/components/SectionHeader.tsx apps/hub/src/pages/agenda/HomeAgendaPauta.tsx apps/hub/src/pages/__tests__/homePauta.test.tsx apps/hub/src/components/dashboard/DashboardSection.tsx packages/i18n/locales/pt/hubHome.json packages/i18n/locales/en/hubHome.json packages/i18n/locales/pt/hubAgenda.json packages/i18n/locales/en/hubAgenda.json
git commit -m "feat(hub): Início do Pauta com saudação, faixa de KPIs e seções numeradas"
```

---

### Task 10: Spinners in both looks

Runs after Tasks 4-9 are committed (shares files with them).

**Files:** the 14 files from `grep -rln "border-stone-300 border-t-stone-900" apps/hub/src` (AgendaPage, AprovacoesPage, BriefingPage, ConvitePage, HomePage, IdeiasPage, MarcaPage, PaginaPage, PaginasPage, PostagensPage, RelatorioDocPage, RelatorioView, Relatorios, HubShell).

- [ ] **Step 1: Replace**

In each file replace the substring `border-stone-300 border-t-stone-900` with `hub-spinner` (keep `animate-spin`, sizes, `rounded-full` and `border-2`). Then:

Run: `grep -rn "border-stone-300\|border-t-stone-900" apps/hub/src` → no output.

- [ ] **Step 2: Test + commit**

Run: `npx vitest run apps/hub && npx tsc -p apps/hub/tsconfig.json --noEmit` → PASS. (If a test asserts the stone classes, update it to `hub-spinner`.)

```bash
git add apps/hub/src
git commit -m "fix(hub): spinners seguem o tema claro/escuro"
```

---

### Task 11: CRM (HubTab font options, HubPreview Pauta)

Depends on Tasks 2 and 3 only.

**Files:**
- Modify: `apps/crm/src/pages/configuracao/tabs/HubTab.tsx:423-480,485-570,679-680,740-757,895-900,1004`
- Modify: `apps/crm/src/pages/configuracao/HubPreview.tsx`
- Test: `apps/crm/src/pages/configuracao/tabs/__tests__/HubTab.test.tsx`, `apps/crm/src/pages/configuracao/__tests__/HubPreview.test.tsx`

**Interfaces:**
- Consumes: `hubFontOptions`, `effectiveHubFonts`, `HubLook`, `resolveHubTheme(config, dark, look)` from hub-theme (HubPreview already imports from it via the cross-boundary path used today); `FeatureFlags.feature_hub_pauta`.
- Produces: `HubPreview` prop `look?: HubLook` (default `'classic'`).

- [ ] **Step 1: Failing tests**

`HubPreview.test.tsx`: change the helper to `renderPreview(overrides: Partial<HubPreviewDraft> = {}, customized = true, look: HubLook = 'classic')` and pass `look` to `<HubPreview>`. Add:

```tsx
  it('Pauta mobile shows the floating bar with a menu button and no bottom nav', () => {
    renderPreview({}, true, 'pauta');
    fireEvent.click(screen.getByRole('button', { name: 'Celular' }));
    expect(screen.getByTestId('hub-preview-floating-bar')).toBeInTheDocument();
    expect(screen.queryByTestId('hub-preview-bottom-nav')).not.toBeInTheDocument();
  });
  it('Pauta greets and loads Assinatura for a non-customized workspace', () => {
    renderPreview({}, false, 'pauta');
    expect(screen.getByText('Bom dia, Ana.')).toBeInTheDocument();
    const link = document.getElementById('crm-hub-preview-fonts') as HTMLLinkElement;
    expect(link.href).toContain('Bricolage+Grotesque');
    expect(link.href).toContain('Figtree');
  });
  it('classic keeps its greeting', () => {
    renderPreview();
    expect(screen.getByText('Bem-vindo(a) de volta')).toBeInTheDocument();
  });
```

`HubTab.test.tsx`: widen the entitlements mock type to `{ hasFeature: (f: string) => boolean; isLoading: boolean; features?: Record<string, boolean> }`, and make the `../../HubPreview` stub render `<div data-testid="hub-preview-stub" data-look={look} />` from its `look` prop (keep whatever it renders today alongside). The stubbed `HUB_DISPLAY_FONTS`/`HUB_BODY_FONTS` (2 entries each) no longer drive the option lists, which now come from the real `hubFontOptions`; don't assert on the stub's list. Add:

```tsx
  it('shows Assinatura first and previews Pauta with the flag', async () => {
    mockEntitlements = {
      hasFeature: () => true,
      isLoading: false,
      features: { feature_brand_customization: true, feature_hub_pauta: true },
    };
    renderTab(); // the file's render helper
    const group = await screen.findByRole('group', { name: 'Combinações de fontes sugeridas' });
    expect(within(group).getAllByRole('button')[0]).toHaveTextContent('Assinatura');
    expect(screen.getByTestId('hub-preview-stub')).toHaveAttribute('data-look', 'pauta');
  });
  it('treats a missing feature_hub_pauta key as off', async () => {
    mockEntitlements = {
      hasFeature: () => true,
      isLoading: false,
      features: { feature_brand_customization: true },
    };
    renderTab();
    await screen.findByRole('group', { name: 'Combinações de fontes sugeridas' });
    expect(screen.queryByRole('button', { name: /assinatura/i })).toBeNull();
    expect(screen.getByTestId('hub-preview-stub')).toHaveAttribute('data-look', 'classic');
  });
```

Run: `npx vitest run apps/crm/src/pages/configuracao` → FAIL.

- [ ] **Step 2: HubTab**

1. Next to `const { hasFeature, isLoading: entitlementsLoading } = useEntitlements();` read the raw features: `const { hasFeature, features, isLoading: entitlementsLoading } = useEntitlements();` and

```ts
  // Never hasFeature here: it treats a missing key as on (useEntitlements.ts:16).
  const pauta = !entitlementsLoading && features?.feature_hub_pauta === true;
  const fontOptions = hubFontOptions(pauta, { display: fontDisplay, body: fontBody });
```

(Place the `fontOptions` line after the `fontDisplay`/`fontBody` state declarations.)
2. `FontPairingCards`: add a `pairings` prop (`typeof HUB_FONT_PAIRINGS`) and an optional `defaultLabel?: string`; map over `pairings` instead of `HUB_FONT_PAIRINGS`; render the label as `{pairing.label}{defaultLabel && pairing.display === 'bricolage-grotesque' ? ' · Padrão' : ''}`. Pass `pairings={fontOptions.pairings}` and `defaultLabel={pauta ? 'Padrão' : undefined}`.
3. `FontSelectsDisclosure`: add props `displayOptions: [string, HubFontOption][]` and `bodyOptions: [string, HubFontOption][]`; map those instead of `Object.entries(HUB_DISPLAY_FONTS/HUB_BODY_FONTS)`. Pass `fontOptions.display` / `fontOptions.body` at line ~1004.
4. Specimen `<link>` effect (~line 740): build `families` from `fontOptions.display.map(([, font]) => …)` and add `pauta` to the deps; because the effect early-returns when the link exists, change it to update `link.href` in place when the id already exists (mirror HubPreview's existing/created pattern) so turning the flag on adds Bricolage.
5. `<HubPreview … customized={customized} look={pauta ? 'pauta' : 'classic'} />`.

Import `hubFontOptions` and `type HubFontOption` from the same module `HUB_FONT_PAIRINGS` comes from.

- [ ] **Step 3: HubPreview**

1. Prop `look?: HubLook` (default `'classic'`).
2. Font effect: 

```ts
  const fonts = effectiveHubFonts(look, customized, { display: draft.fontDisplay, body: draft.fontBody });
  useEffect(() => {
    const href = buildGoogleFontsHref(fonts.display, fonts.body);
    … (unchanged body)
  }, [fonts.display, fonts.body]);
```

This intentionally changes the classic non-customized preview to load only the defaults the real Hub uses (spec, Fontes).
3. `const resolved = resolveHubTheme(config, dark, look);`
4. Create `apps/crm/src/pages/configuracao/HubPreviewPauta.tsx` (export `PreviewDims` from `HubPreview.tsx` so it can type `dims`):

```tsx
import type { ReactNode } from 'react';
import { Menu } from 'lucide-react';
import type { PreviewDims } from './HubPreview';

export function PautaPreviewGreeting({ dims }: { dims: PreviewDims }) {
  return (
    <div>
      <div
        style={{
          fontSize: dims.kpiLabelFont,
          fontWeight: 600,
          letterSpacing: '.09em',
          textTransform: 'uppercase',
          color: 'var(--hub-tx3)',
        }}
      >
        Quinta, 8 de outubro
      </div>
      <div
        style={{
          fontFamily: 'var(--hub-font-display)',
          fontWeight: 'var(--hub-display-weight)' as unknown as number,
          fontSize: dims.greetingFont,
          lineHeight: 1.2,
          color: 'var(--hub-txt)',
          marginTop: 4,
        }}
      >
        Bom dia, Ana.
      </div>
    </div>
  );
}

export function PautaPreviewKpiRow({
  dims,
  kpis,
}: {
  dims: PreviewDims;
  kpis: { label: string; value: string }[];
}) {
  return (
    <div
      style={{
        display: 'flex',
        background: 'var(--hub-card-bg)',
        border: '1px solid var(--hub-card-bd)',
        borderRadius: 'var(--hub-r-card)',
        boxShadow: 'var(--hub-shadow-card)',
        overflow: 'hidden',
      }}
    >
      {kpis.map((kpi, i) => (
        <div
          key={kpi.label}
          style={{
            flex: 1,
            minWidth: 0,
            padding: dims.kpiPad,
            display: 'flex',
            flexDirection: 'column',
            gap: 4,
            borderLeft: i > 0 ? '1px solid var(--hub-bd)' : undefined,
          }}
        >
          <div style={{ fontSize: dims.kpiLabelFont, color: 'var(--hub-tx3)', whiteSpace: 'nowrap' }}>
            {kpi.label}
          </div>
          <div style={{ fontSize: dims.kpiValueFont, fontWeight: 700, color: 'var(--hub-txt)' }}>
            {kpi.value}
          </div>
        </div>
      ))}
    </div>
  );
}

const PAUTA_PILLS: { label: string; tone: 'wait' | 'ok' | 'sched' }[] = [
  { label: 'Aguardando', tone: 'wait' },
  { label: 'Aprovado', tone: 'ok' },
  { label: 'Agendado', tone: 'sched' },
];

export function PautaPreviewStatusRow({ dims }: { dims: PreviewDims }) {
  return (
    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }} data-testid="preview-status-pills">
      {PAUTA_PILLS.map((pill) => (
        <span
          key={pill.label}
          style={{
            fontSize: dims.pillFont,
            fontWeight: 600,
            padding: dims.pillPad,
            borderRadius: 'var(--hub-r-chip)',
            background: `var(--hub-st-${pill.tone}-bg)`,
            color: `var(--hub-st-${pill.tone}-fg)`,
            whiteSpace: 'nowrap',
          }}
        >
          {pill.label}
        </span>
      ))}
    </div>
  );
}

export function PautaPreviewFloatingBar({ dims, logoMark }: { dims: PreviewDims; logoMark: ReactNode }) {
  return (
    <div style={{ flexShrink: 0, padding: 8 }}>
      <div
        data-testid="hub-preview-floating-bar"
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: dims.topbarPad,
          borderRadius: 'var(--hub-r-card)',
          border: '1px solid var(--hub-bd)',
          background: 'var(--hub-card)',
        }}
      >
        {logoMark}
        <span
          style={{
            width: 22,
            height: 22,
            borderRadius: 'var(--hub-r-ctl)',
            border: '1px solid var(--hub-bd)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Menu size={12} color="var(--hub-txt)" aria-hidden="true" />
        </span>
      </div>
    </div>
  );
}
```

5. In `HubPreview.tsx`, `const pauta = look === 'pauta';` and, with the classic JSX untouched in the `false` branches:
   - `mainContent`: `{pauta ? <PautaPreviewGreeting dims={dims} /> : greeting}`, `{pauta ? <PautaPreviewStatusRow dims={dims} /> : statusPillsRow}`, and for KPIs `{pauta ? <PautaPreviewKpiRow dims={dims} kpis={device === 'mobile' ? KPI_STATS.slice(0, 2) : KPI_STATS} /> : <div style={{ display: 'flex', gap: dims.kpiGap }}>{kpiCards}</div>}` (KPI_STATS items have `label`/`value`; check and map if the value field is named differently).
   - Sidebar: `background: pauta ? 'var(--hub-bg)' : 'var(--hub-soft)'`, `borderRight: pauta ? 'none' : '1px solid var(--hub-bd)'`; nav item `borderRadius: pauta ? 'var(--hub-r-ctl)' : 8`.
   - Mobile: `{device === 'mobile' && (pauta ? <PautaPreviewFloatingBar dims={dims} logoMark={logoMark} /> : <div data-testid="hub-preview-topbar" …>…</div>)}` and render `hub-preview-bottom-nav` only when `!pauta`. Classic mobile (top bar + bottom nav) is unchanged, so `HubPreview.test.tsx:159` keeps passing.

- [ ] **Step 4: Run + typecheck + commit**

Run: `npx vitest run apps/crm/src/pages/configuracao && npx tsc -p apps/crm/tsconfig.json --noEmit` → PASS.

```bash
git add apps/crm/src/pages/configuracao
git commit -m "feat(crm): prévia e fontes do Hub seguem a flag Pauta"
```

---

### Task 12: Verification and spec sync

Depends on all tasks.

- [ ] **Step 1: Gates**

Run, in order: `npm run lint`, `npm run format` then `npm run format:check`, `npx tsc -p apps/crm/tsconfig.json --noEmit`, `npx tsc -p apps/hub/tsconfig.json --noEmit`, `npx tsc -p apps/admin/tsconfig.json --noEmit`, `npx tsc -p tsconfig.scripts.json`, `npm run test`, `npm run check:functions`, `npm run test:functions`, then `ls node_modules/.deno && npm ci`.
Expected: all green. Commit any formatting changes: `git commit -am "chore: format"`.

- [ ] **Step 2: Browser check (computed CSS, not testable in jsdom)**

Hub dev must run on `:5175` (`npm run dev:hub` via `preview_start`; see memory "Hub dev must be on :5175 for prod CORS"). Writes to prod are blocked; use the patched-fetch approach (memory "Hub repro via patched fetch in Browser pane") to serve a bootstrap with `feature_hub_pauta: true` and with it absent. Check, light and dark, at desktop and 390px:
- classic: computed styles of `.hub-root`, a `.hub-card`, `.hub-btn-primary`, the sidebar active item and a `.hub-pill` equal the values on production for the same hub.
- Pauta: `.hub-root[data-hub-look=pauta]`; with radius `square` (patch `hub_theme.radius`), a `.hub-btn-primary` without `rounded-full` has `border-radius: 0px` while the sidebar counter, `WorkspaceMark` and PostCard format chip stay circular or use their Pauta radius; `.hub-pill::before` dot visible; eyebrow marker in the brand color; Início shows greeting, KPI strip, numbered sections; Aprovações keeps the grid (2 columns at 390px, 3 at ≥640px); the mobile menu button shows the count; Calendar today ring vs selected fill.
- Brand `#8b5cf6` and `#ffbf30`: primary buttons readable (inspect `--hub-primary`/`--hub-primary-fg`).
Take one screenshot per look for the report.

- [ ] **Step 3: Spec sync**

In `docs/superpowers/specs/2026-10-08-hub-identidade-pauta-design.md`, Testes → Hub: move "`.hub-btn-primary.rounded-full` continua redondo no Pauta com raio Reto" from the Vitest list to the Navegador bullet; in i18n note that the Calendar title reuses `home.calendarSection.subtitle`, Results reuses `dashboard.title`, and `hubAgenda` gains `home.vazio` and `home.pauta.kpi.pending` ("Para aprovar"); in Componentes → `StoriesRail`, say the Pauta branch changes only the status dot colour (the gradient ring and round dot stay); in Componentes → Filtros, the dropdown popover uses `--hub-r-card`. Commit: `git commit -am "docs(hub): spec Pauta alinhada ao plano"`.

- [ ] **Step 4: Before the PR**

`git fetch origin && ls supabase/migrations | sort | tail -1` against `origin/main`; if the tail is ≥ `20261012000001`, rename the migration above it and update the header comments that cite the version (migration, psql suite). Then open the PR per the repo workflow. Deploy order (spec Lançamento) is user-owned: migration (staging, then prod) → redeploy `hub-bootstrap`, `workspace-limits`, `platform-admin`, `paywall-report` with `--use-api` → merge → DK override.
