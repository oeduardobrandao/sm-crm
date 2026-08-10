# Plan Usage Indicators Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Visual plan-limit indicators everywhere: a "Uso do plano" panel on Plano & Cobrança fed by a new `workspace_usage()` RPC, plus unified in-context meters on Clientes, Leads, Equipe and Arquivos.

**Architecture:** One pure threshold helper + one presentational `UsageMeter` component replace the two divergent meter implementations (Equipe seat meter, Arquivos storage bar). Limits come from the existing `useWorkspaceLimits()`; usage for the central panel comes from a new SECURITY DEFINER Postgres RPC whose count expressions mirror the enforcement triggers exactly; in-context meters use each page's already-loaded data (except Leads, which needs an exact head-count).

**Tech Stack:** React 19 + TypeScript, TanStack Query, Tailwind/inline styles with CSS-var tokens, Supabase (Postgres RPC, RLS), Vitest + Testing Library, psql entitlement suite.

**Spec:** `docs/superpowers/specs/2026-08-08-plan-usage-indicators-design.md` (read it first).

## Global Constraints

- UI copy is PT-BR. **Never use em-dashes in user-facing copy** — separate with "·", periods, or colons.
- Colors only via CSS vars: `var(--success)` `var(--warning)` `var(--danger)` `var(--danger-text)` `var(--surface-2)` `var(--text-muted)` `var(--text-light)` `var(--text-main)` `var(--border-color)`.
- Threshold semantics (single source, spec §3): `ok` → `warning` when `remaining <= 1` OR `used/limit >= 0.8` → `danger` when `used >= limit`; `limit === 0` → `blocked` ("Não incluído no plano"); `limit === null` → unlimited. Upgrade CTA when `used/limit > 0.75` OR state is not `ok`.
- CTA is owner-only, from the RESOLVED active-workspace role only: `workspaceRole === 'owner'` (with `membershipResolved !== false`). NO fallback to the profile-level `role` — it is stale across workspace switches (Codex finding, human-ruled 2026-08-08).
- Path alias `@/` → `apps/crm/src/` works in CRM imports; tests use relative paths for `vi.mock` (match each test file's existing style).
- Migration version prefix must be unique repo-wide AND above `origin/main`'s tail (currently `20260807000004`). This plan uses `20260808000001`. **Re-verify with `git ls-tree origin/main:supabase/migrations --name-only | tail` immediately before opening the PR** and renumber if main moved.
- `npm run test:functions` dirties the root `deno.lock`: run `git checkout -- deno.lock` afterwards.
- Commit after each task. Never commit `.env*`.

## File Structure

| File | Responsibility |
|---|---|
| `apps/crm/src/components/usage/usage-meter-state.ts` | Pure logic: `computeMeterState`, `METER_FILL`, `formatStorageBytes` |
| `apps/crm/src/components/usage/UsageMeter.tsx` | Presentational meter (`UsageMeter`, `MeterBar`) |
| `apps/crm/src/hooks/useIsWorkspaceOwner.ts` | Active-workspace ownership boolean |
| `apps/crm/src/hooks/useWorkspaceUsage.ts` | TanStack query over `supabase.rpc('workspace_usage')` |
| `supabase/migrations/20260808000001_workspace_usage_rpc.sql` | The RPC + hardened grants |
| `supabase/tests/entitlements/07_workspace_usage.sql` | psql suite for the RPC |
| `apps/crm/src/pages/configuracao/cobranca/UsagePanel.tsx` | "Uso do plano" panel |
| Modified: `CobrancaPage.tsx`, `cobranca.css`, `ClientesPage.tsx`, `LeadsPage.tsx`, `store/leads.ts`, `EquipePage.tsx`, `InviteSection.tsx`, `ArquivosPage.tsx`, `MobileArquivosView.tsx` | Integration |

---

### Task 1: Threshold helper + storage formatter

**Files:**
- Create: `apps/crm/src/components/usage/usage-meter-state.ts`
- Test: `apps/crm/src/components/usage/__tests__/usage-meter-state.test.ts`

**Interfaces:**
- Produces: `computeMeterState(used: number, limit: number | null): MeterInfo` where `MeterInfo = { state: 'ok'|'warning'|'danger'|'blocked'|'unlimited'; pct: number; remaining: number | null; showCta: boolean }`; `METER_FILL: Record<MeterState, string>`; `formatStorageBytes(bytes: number): string`.

- [ ] **Step 1: Write the failing test**

```ts
// apps/crm/src/components/usage/__tests__/usage-meter-state.test.ts
import { describe, expect, it } from 'vitest';
import { computeMeterState, formatStorageBytes } from '../usage-meter-state';

describe('computeMeterState', () => {
  it('is ok with no CTA well below the limit', () => {
    expect(computeMeterState(3, 10)).toEqual({ state: 'ok', pct: 30, remaining: 7, showCta: false });
  });
  it('shows the CTA above 75% while still ok (green band)', () => {
    const m = computeMeterState(76, 100);
    expect(m.state).toBe('ok');
    expect(m.showCta).toBe(true);
  });
  it('does not show the CTA at exactly 75% or below', () => {
    expect(computeMeterState(75, 100).showCta).toBe(false);
    expect(computeMeterState(74, 100).showCta).toBe(false);
  });
  it('warns at 80% usage', () => {
    const m = computeMeterState(8, 10);
    expect(m.state).toBe('warning');
    expect(m.showCta).toBe(true);
  });
  it('warns when only 1 slot remains, even below 75% (tiny limits)', () => {
    const m = computeMeterState(1, 2);
    expect(m.state).toBe('warning');
    expect(m.remaining).toBe(1);
    expect(m.showCta).toBe(true);
  });
  it('is danger at the limit and clamps pct at 100 when over', () => {
    expect(computeMeterState(10, 10)).toEqual({ state: 'danger', pct: 100, remaining: 0, showCta: true });
    expect(computeMeterState(12, 10).pct).toBe(100);
  });
  it('treats limit 0 as blocked (fail-closed), never 0-de-0 danger', () => {
    expect(computeMeterState(0, 0)).toEqual({ state: 'blocked', pct: 0, remaining: 0, showCta: true });
  });
  it('treats null limit as unlimited with no CTA', () => {
    expect(computeMeterState(42, null)).toEqual({ state: 'unlimited', pct: 0, remaining: null, showCta: false });
  });
});

describe('formatStorageBytes', () => {
  it('formats GB with pt-BR decimal comma', () => {
    expect(formatStorageBytes(4.2 * 1024 ** 3)).toBe('4,2 GB');
    expect(formatStorageBytes(10 * 1024 ** 3)).toBe('10 GB');
  });
  it('formats sub-GB as MB', () => {
    expect(formatStorageBytes(100 * 1024 ** 2)).toBe('100 MB');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run apps/crm/src/components/usage/__tests__/usage-meter-state.test.ts`
Expected: FAIL — cannot resolve `../usage-meter-state`.

- [ ] **Step 3: Write the implementation**

```ts
// apps/crm/src/components/usage/usage-meter-state.ts
export type MeterState = 'ok' | 'warning' | 'danger' | 'blocked' | 'unlimited';

export interface MeterInfo {
  state: MeterState;
  /** 0-100, clamped. 0 when no bar is drawn (unlimited/blocked). */
  pct: number;
  /** Slots/bytes left. null when unlimited. */
  remaining: number | null;
  /** Upgrade nudge: usage above 75%, or any non-ok state. */
  showCta: boolean;
}

/**
 * Single source for meter thresholds (spec 2026-08-08 §3). limit semantics
 * follow the entitlement resolver: null = unlimited, 0 = blocked (fail-closed).
 */
export function computeMeterState(used: number, limit: number | null): MeterInfo {
  if (limit === null) return { state: 'unlimited', pct: 0, remaining: null, showCta: false };
  if (limit === 0) return { state: 'blocked', pct: 0, remaining: 0, showCta: true };
  const ratio = used / limit;
  const pct = Math.min(100, Math.round(ratio * 100));
  const remaining = Math.max(0, limit - used);
  const state: MeterState =
    used >= limit ? 'danger' : remaining <= 1 || ratio >= 0.8 ? 'warning' : 'ok';
  return { state, pct, remaining, showCta: ratio > 0.75 || state !== 'ok' };
}

export const METER_FILL: Record<MeterState, string> = {
  ok: 'var(--success)',
  warning: 'var(--warning)',
  danger: 'var(--danger)',
  blocked: 'var(--danger)',
  unlimited: 'var(--success)',
};

/** "4,2 GB" / "100 MB", pt-BR decimals. Same tiering as CobrancaPage.formatStorage. */
export function formatStorageBytes(bytes: number): string {
  const gb = bytes / 1024 ** 3;
  if (gb >= 1) {
    const v = Number.isInteger(gb) ? gb : Number(gb.toFixed(1));
    return `${v.toLocaleString('pt-BR')} GB`;
  }
  return `${Math.round(bytes / 1024 ** 2)} MB`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run apps/crm/src/components/usage/__tests__/usage-meter-state.test.ts`
Expected: PASS (11 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/crm/src/components/usage/
git commit -m "feat(usage): meter threshold helper with 75% CTA band"
```

---

### Task 2: `UsageMeter` component + `useIsWorkspaceOwner`

**Files:**
- Create: `apps/crm/src/components/usage/UsageMeter.tsx`
- Create: `apps/crm/src/hooks/useIsWorkspaceOwner.ts`
- Test: `apps/crm/src/components/usage/__tests__/UsageMeter.test.tsx`

**Interfaces:**
- Consumes: `computeMeterState`, `METER_FILL` from Task 1.
- Produces:
  - `UsageMeter(props: { label: string; used: number; limit: number | null; size?: 'full' | 'compact'; format?: (n: number) => string; showUpgradeCta?: boolean; valueText?: string; subText?: string; unlimitedBadge?: boolean })` — `size` defaults `'full'`; `showUpgradeCta` is the OWNERSHIP input (caller passes `useIsWorkspaceOwner()`), ANDed internally with `MeterInfo.showCta`.
  - `MeterBar({ used, limit, height = 5 }: { used: number; limit: number; height?: number })` — just the track+fill.
  - `useIsWorkspaceOwner(): boolean`.

- [ ] **Step 1: Write the failing test**

```tsx
// apps/crm/src/components/usage/__tests__/UsageMeter.test.tsx
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { UsageMeter } from '../UsageMeter';

function renderMeter(ui: React.ReactElement) {
  return render(<MemoryRouter>{ui}</MemoryRouter>);
}

describe('UsageMeter', () => {
  it('renders value text and no CTA when ok below 75%', () => {
    renderMeter(<UsageMeter label="clientes" used={3} limit={15} showUpgradeCta />);
    expect(screen.getByText('3 de 15')).toBeInTheDocument();
    expect(screen.queryByText('Fazer upgrade')).not.toBeInTheDocument();
  });

  it('shows the CTA above 75% for owners', () => {
    renderMeter(<UsageMeter label="clientes" used={12} limit={15} showUpgradeCta />);
    expect(screen.getByRole('link', { name: 'Fazer upgrade' })).toHaveAttribute(
      'href',
      '/configuracao/cobranca',
    );
  });

  it('never shows the CTA for non-owners', () => {
    renderMeter(<UsageMeter label="clientes" used={15} limit={15} showUpgradeCta={false} />);
    expect(screen.queryByText('Fazer upgrade')).not.toBeInTheDocument();
  });

  it('renders the blocked state for limit 0', () => {
    renderMeter(<UsageMeter label="portais do Hub" used={0} limit={0} showUpgradeCta />);
    expect(screen.getByText('Não incluído no plano')).toBeInTheDocument();
    expect(screen.getByText('Fazer upgrade')).toBeInTheDocument();
  });

  it('renders count + Ilimitado badge for null limit in full size', () => {
    renderMeter(<UsageMeter label="Chaves MCP" used={2} limit={null} />);
    expect(screen.getByText('2')).toBeInTheDocument();
    expect(screen.getByText('Ilimitado')).toBeInTheDocument();
  });

  it('hides the Ilimitado badge when unlimitedBadge is false', () => {
    renderMeter(<UsageMeter label="Armazenamento" used={5} limit={null} unlimitedBadge={false} />);
    expect(screen.queryByText('Ilimitado')).not.toBeInTheDocument();
  });

  it('renders nothing in compact size when unlimited', () => {
    const { container } = renderMeter(
      <UsageMeter size="compact" label="clientes" used={3} limit={null} />,
    );
    expect(container.textContent).toBe('');
  });

  it('compact size renders "X de Y label" as one line', () => {
    renderMeter(<UsageMeter size="compact" label="clientes" used={13} limit={15} />);
    expect(screen.getByText('13 de 15 clientes')).toBeInTheDocument();
  });

  it('honors valueText and subText overrides', () => {
    renderMeter(
      <UsageMeter
        label=""
        used={3}
        limit={5}
        valueText="3 de 5 vagas do plano usadas"
        subText="2 restantes"
      />,
    );
    expect(screen.getByText('3 de 5 vagas do plano usadas')).toBeInTheDocument();
    expect(screen.getByText('2 restantes')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run apps/crm/src/components/usage/__tests__/UsageMeter.test.tsx`
Expected: FAIL — cannot resolve `../UsageMeter`.

- [ ] **Step 3: Write the components**

```tsx
// apps/crm/src/components/usage/UsageMeter.tsx
import { Link } from 'react-router-dom';
import { computeMeterState, METER_FILL } from './usage-meter-state';

/** Track + fill only. Callers with bespoke layouts (mobile StorageCard) use this. */
export function MeterBar({
  used,
  limit,
  height = 5,
}: {
  used: number;
  limit: number;
  height?: number;
}) {
  const meter = computeMeterState(used, limit);
  return (
    <div
      style={{
        height,
        borderRadius: 999,
        background: 'var(--surface-2)',
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          height: '100%',
          borderRadius: 999,
          width: `${meter.pct}%`,
          background: METER_FILL[meter.state],
          transition: 'width .3s',
        }}
      />
    </div>
  );
}

interface UsageMeterProps {
  label: string;
  used: number;
  /** null = unlimited (resolver semantics). 0 = blocked (fail-closed). */
  limit: number | null;
  size?: 'full' | 'compact';
  format?: (n: number) => string;
  /** Ownership gate for the CTA: pass useIsWorkspaceOwner(). ANDed with showCta. */
  showUpgradeCta?: boolean;
  /** Overrides "{used} de {limit}" (Equipe preview copy). */
  valueText?: string;
  /** Overrides the default remaining text. */
  subText?: string;
  /** false hides the Ilimitado badge (Arquivos quota_bytes:0 = unknown, not unlimited). */
  unlimitedBadge?: boolean;
}

/**
 * Purely presentational: render it only with a RESOLVED limit. Unknown or
 * unavailable limits are the caller's job (see spec §3) — never map them to null.
 */
export function UsageMeter({
  label,
  used,
  limit,
  size = 'full',
  format = String,
  showUpgradeCta = false,
  valueText,
  subText,
  unlimitedBadge = true,
}: UsageMeterProps) {
  const meter = computeMeterState(used, limit);
  const danger = meter.state === 'danger' || meter.state === 'blocked';
  const cta =
    showUpgradeCta && meter.showCta ? (
      <Link
        to="/configuracao/cobranca"
        style={{
          color: danger ? 'var(--danger-text)' : 'var(--text-main)',
          fontWeight: 600,
          textDecoration: 'underline',
          textUnderlineOffset: 2,
        }}
      >
        Fazer upgrade
      </Link>
    ) : null;

  if (size === 'compact') {
    if (limit === null) return null;
    return (
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          fontSize: '0.78rem',
          color: danger ? 'var(--danger-text)' : 'var(--text-muted)',
        }}
      >
        {limit > 0 && (
          <span style={{ width: 64, flex: 'none' }}>
            <MeterBar used={used} limit={limit} />
          </span>
        )}
        <span>
          {limit > 0 ? `${format(used)} de ${format(limit)} ${label}` : 'Não incluído no plano'}
        </span>
        {cta}
      </div>
    );
  }

  return (
    <div style={{ minWidth: 0 }}>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'baseline',
          gap: 8,
          marginBottom: 6,
        }}
      >
        <span style={{ fontSize: '0.82rem', fontWeight: 600, color: 'var(--text-main)' }}>
          {label}
        </span>
        <span
          style={{
            fontSize: '0.78rem',
            color: 'var(--text-muted)',
            fontVariantNumeric: 'tabular-nums',
          }}
        >
          {meter.state === 'unlimited' ? (
            <>
              {format(used)}{' '}
              {unlimitedBadge && (
                <span
                  style={{
                    fontSize: '0.68rem',
                    fontWeight: 600,
                    border: '1px solid var(--border-color)',
                    borderRadius: 999,
                    padding: '1px 8px',
                    color: 'var(--text-muted)',
                  }}
                >
                  Ilimitado
                </span>
              )}
            </>
          ) : (
            (valueText ?? (limit! > 0 ? `${format(used)} de ${format(limit!)}` : format(used)))
          )}
        </span>
      </div>
      {meter.state !== 'unlimited' && meter.state !== 'blocked' && limit !== null && (
        <MeterBar used={used} limit={limit} />
      )}
      {(meter.state === 'blocked' || subText || cta) && meter.state !== 'unlimited' && (
        <div
          style={{
            marginTop: 5,
            fontSize: '0.72rem',
            color: danger ? 'var(--danger-text)' : 'var(--text-light)',
            display: 'flex',
            gap: 6,
            flexWrap: 'wrap',
          }}
        >
          {meter.state === 'blocked' ? <span>Não incluído no plano</span> : null}
          {subText ? <span>{subText}</span> : null}
          {cta}
        </div>
      )}
    </div>
  );
}
```

```ts
// apps/crm/src/hooks/useIsWorkspaceOwner.ts
import { useContext } from 'react';
import { AuthContext } from '../context/AuthContext';

/**
 * Ownership of the ACTIVE workspace, for upgrade CTAs. Requires the RESOLVED
 * workspace-membership role — deliberately stricter than CobrancaPage's
 * (workspaceRole ?? role): profiles.role is stale across workspace switches,
 * so falling back to it could nudge a removed member or a foreign-workspace
 * owner toward a billing page that will refuse them. An errored lookup just
 * hides the nudge (fail-quiet). Safe outside an AuthProvider (returns false),
 * matching useWorkspaceLimits' context pattern.
 */
export function useIsWorkspaceOwner(): boolean {
  const auth = useContext(AuthContext);
  if (!auth || auth.membershipResolved === false) return false;
  return auth.workspaceRole === 'owner';
}
```

Note: check `AuthContext`'s value type for the exact `role` property name (`role: 'owner' | 'admin' | 'agent' | null` alongside `workspaceRole` and `membershipResolved: boolean | 'error'`) — CobrancaPage destructures `{ role, workspaceRole }` from `useAuth()`, so both exist on the context value.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run apps/crm/src/components/usage/__tests__/UsageMeter.test.tsx`
Expected: PASS (9 tests).

- [ ] **Step 5: Typecheck and commit**

```bash
npx tsc -p apps/crm/tsconfig.json --noEmit
git add apps/crm/src/components/usage/ apps/crm/src/hooks/useIsWorkspaceOwner.ts
git commit -m "feat(usage): UsageMeter component and useIsWorkspaceOwner hook"
```

---

### Task 3: `workspace_usage()` RPC migration + psql test

**Files:**
- Create: `supabase/migrations/20260808000001_workspace_usage_rpc.sql`
- Test: `supabase/tests/entitlements/07_workspace_usage.sql`

**Interfaces:**
- Produces: SQL function `public.workspace_usage() returns jsonb` — keys `clients, team_members, pending_invites, leads, hub_tokens, workflow_templates, instagram_accounts, mcp_keys` (numbers) and `storage_used_bytes` (number). Empty object `{}` when the caller has no active workspace. EXECUTE: `authenticated` + `service_role` only.

- [ ] **Step 1: Write the migration**

```sql
-- supabase/migrations/20260808000001_workspace_usage_rpc.sql
-- Workspace-wide usage counts for the CRM "Uso do plano" panel.
-- Count expressions MIRROR the enforcement triggers (20260611130003_count_triggers.sql,
-- 20260622120001_mcp_api_keys.sql) and the invite seat pre-check
-- (supabase/functions/_shared/invite-actions.ts). Rule: usage displays mirror enforcement.
-- pending_invites deliberately has NO expiry filter: an expired-but-unprocessed invite
-- still consumes a seat at the server pre-check until it is revoked or replaced.
create or replace function public.workspace_usage()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_ws uuid := public.get_my_conta_id();
begin
  if v_ws is null then
    return '{}'::jsonb;
  end if;
  return jsonb_build_object(
    'clients',            (select count(*) from clientes where conta_id = v_ws),
    'team_members',       (select count(*) from workspace_members where workspace_id = v_ws),
    'pending_invites',    (select count(*) from invites
                            where conta_id = v_ws and status = 'pending'),
    'leads',              (select count(*) from leads where conta_id = v_ws),
    'hub_tokens',         (select count(*) from client_hub_tokens where conta_id = v_ws),
    'workflow_templates', (select count(*) from workflow_templates where conta_id = v_ws),
    'instagram_accounts', (select count(*) from instagram_accounts t
                             join clientes c on c.id = t.client_id
                            where c.conta_id = v_ws),
    'mcp_keys',           (select count(*) from mcp_api_keys
                            where conta_id = v_ws and revoked_at is null),
    'storage_used_bytes', (select coalesce(storage_used_bytes, 0)
                             from workspaces where id = v_ws)
  );
end;
$$;

-- SECURITY DEFINER: default privileges hand EXECUTE on new public functions to
-- anon/authenticated/service_role, so lock it down explicitly.
-- NOTE: revoking PUBLIC also strips service_role; the GRANT below restores it.
revoke all on function public.workspace_usage() from public;
revoke all on function public.workspace_usage() from anon;
grant execute on function public.workspace_usage() to authenticated;
grant execute on function public.workspace_usage() to service_role;
```

- [ ] **Step 2: Write the psql test**

Follow the impersonation pattern of `supabase/tests/entitlements/31_hub_token_rotate_extend.sql` (bare `auth.users` insert → trigger creates profiles → re-point them; NEVER insert into `profiles` directly).

```sql
-- supabase/tests/entitlements/07_workspace_usage.sql
\set ON_ERROR_STOP on
\i supabase/tests/entitlements/_helpers.sql

begin;
do $$
declare
  v_ws uuid; v_ws2 uuid;
  v_owner uuid := gen_random_uuid();
  v_other uuid := gen_random_uuid();
  v_nullu uuid := gen_random_uuid();
  v_cli bigint;
  v_usage jsonb;
begin
  -- 'max' plan: null limits, so seeding data can't trip the count triggers.
  v_ws  := et_make_workspace('max');
  v_ws2 := et_make_workspace('max');

  insert into auth.users (id) values (v_owner), (v_other), (v_nullu);
  -- handle_new_user_workspace already created a profile (+ throwaway workspace)
  -- per user; re-point the existing rows instead of inserting (see 31_*.sql).
  insert into workspace_members (user_id, workspace_id, role)
    values (v_owner, v_ws, 'owner'), (v_other, v_ws2, 'owner');
  update profiles set conta_id = v_ws,  active_workspace_id = v_ws  where id = v_owner;
  update profiles set conta_id = v_ws2, active_workspace_id = v_ws2 where id = v_other;
  update profiles set conta_id = v_ws,  active_workspace_id = null  where id = v_nullu;

  -- v_ws data: 2 clientes, 1 IG account on the first, 1 hub token,
  -- 1 pending invite (EXPIRED on purpose) + 1 accepted invite,
  -- 1 live + 1 revoked mcp key, storage counter set by hand.
  insert into clientes (user_id, conta_id, nome, sigla, cor)
    values (v_owner, v_ws, 'C1', 'C1', '#000') returning id into v_cli;
  insert into clientes (user_id, conta_id, nome, sigla, cor)
    values (v_owner, v_ws, 'C2', 'C2', '#000');
  insert into instagram_accounts (client_id, instagram_user_id) values (v_cli, 'ig-1');
  insert into client_hub_tokens (cliente_id, conta_id, expires_at)
    values (v_cli, v_ws, now() + interval '10 days');
  insert into invites (conta_id, email, role, invited_by, status, expires_at)
    values (v_ws, 'p@x.com', 'agent', v_owner, 'pending',  now() - interval '1 day'),
           (v_ws, 'a@x.com', 'agent', v_owner, 'accepted', now() + interval '7 days');
  insert into mcp_api_keys (conta_id, created_by, name, token_hash, token_suffix)
    values (v_ws, v_owner, 'live', 'et-hash-live', 'aaaa'),
           (v_ws, v_owner, 'dead', 'et-hash-dead', 'bbbb');
  update mcp_api_keys set revoked_at = now() where token_hash = 'et-hash-dead';
  update workspaces set storage_used_bytes = 12345 where id = v_ws;

  -- foreign-workspace noise that must NOT leak into v_ws counts
  insert into clientes (user_id, conta_id, nome, sigla, cor)
    values (v_other, v_ws2, 'X', 'X', '#000');

  -- act as the owner of v_ws
  perform set_config('request.jwt.claims', json_build_object('sub', v_owner)::text, true);
  v_usage := workspace_usage();
  assert (v_usage->>'clients')::int = 2, format('clients: %s', v_usage->>'clients');
  assert (v_usage->>'team_members')::int = 1, format('team_members: %s', v_usage->>'team_members');
  assert (v_usage->>'pending_invites')::int = 1,
    'expired-but-unprocessed pending invite must still count (mirrors invite-actions)';
  assert (v_usage->>'leads')::int = 0, format('leads: %s', v_usage->>'leads');
  assert (v_usage->>'hub_tokens')::int = 1, format('hub_tokens: %s', v_usage->>'hub_tokens');
  assert (v_usage->>'workflow_templates')::int = 0, 'workflow_templates';
  assert (v_usage->>'instagram_accounts')::int = 1, 'instagram via clientes join';
  assert (v_usage->>'mcp_keys')::int = 1, 'revoked mcp key must free the slot';
  assert (v_usage->>'storage_used_bytes')::bigint = 12345, 'storage_used_bytes';

  -- scoping: the other owner sees only their own workspace
  perform set_config('request.jwt.claims', json_build_object('sub', v_other)::text, true);
  v_usage := workspace_usage();
  assert (v_usage->>'clients')::int = 1, 'foreign workspace must not leak';
  assert (v_usage->>'instagram_accounts')::int = 0, 'ig scoping';

  -- NULL active workspace: fail-safe empty object, no error
  perform set_config('request.jwt.claims', json_build_object('sub', v_nullu)::text, true);
  assert workspace_usage() = '{}'::jsonb, 'null conta must return {}';

  raise notice 'PASS 07_workspace_usage counts + scoping';
end $$;
rollback;

-- Grant surface: authenticated + service_role only.
do $$
begin
  assert has_function_privilege('anon', 'public.workspace_usage()', 'EXECUTE') = false,
    'anon must NOT execute workspace_usage';
  assert has_function_privilege('authenticated', 'public.workspace_usage()', 'EXECUTE') = true,
    'authenticated must execute workspace_usage';
  assert has_function_privilege('service_role', 'public.workspace_usage()', 'EXECUTE') = true,
    'service_role must keep execute (PUBLIC revoke strips it without the explicit grant)';
  raise notice 'PASS 07_workspace_usage grants';
end $$;
```

- [ ] **Step 3: Run the suite locally (needs Docker via colima)**

```bash
colima start || true
npx supabase start
bash scripts/test-entitlements.sh
```

Expected: `PASS 07_workspace_usage counts + scoping` and `PASS 07_workspace_usage grants` among the output; every pre-existing suite still passes. If local Docker is unavailable, note it in the commit and rely on the CI `entitlement-tests` job — it DOES gate this.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260808000001_workspace_usage_rpc.sql supabase/tests/entitlements/07_workspace_usage.sql
git commit -m "feat(db): workspace_usage() RPC mirroring enforcement counts"
```

---

### Task 4: `useWorkspaceUsage` hook

**Files:**
- Create: `apps/crm/src/hooks/useWorkspaceUsage.ts`
- Test: `apps/crm/src/hooks/__tests__/useWorkspaceUsage.test.tsx`

**Interfaces:**
- Consumes: `supabase.rpc('workspace_usage')` (Task 3).
- Produces: `useWorkspaceUsage(): { usage: Partial<WorkspaceUsage> | null; isLoading: boolean; isError: boolean }` with `WorkspaceUsage = { clients; team_members; pending_invites; leads; hub_tokens; workflow_templates; instagram_accounts; mcp_keys; storage_used_bytes: number }`. Query key `['workspace-usage', workspaceId]`, staleTime 30s. `usage` is `Partial` because a NULL-conta caller gets `{}`.

- [ ] **Step 1: Write the failing test**

```tsx
// apps/crm/src/hooks/__tests__/useWorkspaceUsage.test.tsx
import React from 'react';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { rpcMock } = vi.hoisted(() => ({ rpcMock: vi.fn() }));
vi.mock('../../lib/supabase', () => ({ supabase: { rpc: rpcMock } }));

import { useWorkspaceUsage } from '../useWorkspaceUsage';

function wrapper({ children }: { children: React.ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

beforeEach(() => rpcMock.mockReset());

describe('useWorkspaceUsage', () => {
  it('returns the usage object from the workspace_usage RPC', async () => {
    rpcMock.mockResolvedValue({ data: { clients: 2, storage_used_bytes: 12345 }, error: null });
    const { result } = renderHook(() => useWorkspaceUsage(), { wrapper });
    await waitFor(() => expect(result.current.usage).not.toBeNull());
    expect(rpcMock).toHaveBeenCalledWith('workspace_usage');
    expect(result.current.usage).toEqual({ clients: 2, storage_used_bytes: 12345 });
  });

  it('flags isError when the RPC fails', async () => {
    rpcMock.mockResolvedValue({ data: null, error: new Error('boom') });
    const { result } = renderHook(() => useWorkspaceUsage(), { wrapper });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.usage).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run apps/crm/src/hooks/__tests__/useWorkspaceUsage.test.tsx`
Expected: FAIL — cannot resolve `../useWorkspaceUsage`.

- [ ] **Step 3: Write the hook**

```ts
// apps/crm/src/hooks/useWorkspaceUsage.ts
import { useContext } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { AuthContext } from '../context/AuthContext';

export interface WorkspaceUsage {
  clients: number;
  team_members: number;
  pending_invites: number;
  leads: number;
  hub_tokens: number;
  workflow_templates: number;
  instagram_accounts: number;
  mcp_keys: number;
  storage_used_bytes: number;
}

/**
 * Current usage counts from workspace_usage() (counts mirror the enforcement
 * triggers). Partial: a caller with no active workspace gets {}. Consumed only
 * by the Cobrança usage panel, so freshness rides on staleTime, not on
 * cross-page invalidation.
 */
export function useWorkspaceUsage() {
  // Same context pattern as useWorkspaceLimits: key by workspace, usable
  // outside an AuthProvider in isolated tests.
  const auth = useContext(AuthContext);
  const workspaceId = auth?.profile?.conta_id ?? null;
  const { data, isLoading, isError } = useQuery({
    queryKey: ['workspace-usage', workspaceId],
    queryFn: async (): Promise<Partial<WorkspaceUsage>> => {
      const { data, error } = await supabase.rpc('workspace_usage');
      if (error) throw error;
      return (data ?? {}) as Partial<WorkspaceUsage>;
    },
    staleTime: 30 * 1000,
  });
  return { usage: data ?? null, isLoading, isError };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run apps/crm/src/hooks/__tests__/useWorkspaceUsage.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/crm/src/hooks/useWorkspaceUsage.ts apps/crm/src/hooks/__tests__/useWorkspaceUsage.test.tsx
git commit -m "feat(usage): useWorkspaceUsage hook over workspace_usage RPC"
```

---

### Task 5: "Uso do plano" panel on Plano & Cobrança

**Files:**
- Create: `apps/crm/src/pages/configuracao/cobranca/UsagePanel.tsx`
- Modify: `apps/crm/src/pages/configuracao/cobranca/CobrancaPage.tsx` (render the panel between the current-plan card and the month/annual toggle, ~L213)
- Modify: `apps/crm/src/pages/configuracao/cobranca/cobranca.css` (grid styles)
- Test: `apps/crm/src/pages/configuracao/cobranca/__tests__/UsagePanel.test.tsx`

**Interfaces:**
- Consumes: `useWorkspaceLimits()` (`limits`, `planName`, `isLoading`, `isUnlimited`), `useWorkspaceUsage()` (Task 4), `UsageMeter` + `formatStorageBytes` (Tasks 1-2), `useIsWorkspaceOwner()` (Task 2).
- Produces: `UsagePanel(): JSX.Element | null` — default-less named export.

- [ ] **Step 1: Write the failing test**

```tsx
// apps/crm/src/pages/configuracao/cobranca/__tests__/UsagePanel.test.tsx
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { limitsMock, usageMock } = vi.hoisted(() => ({
  limitsMock: vi.fn(),
  usageMock: vi.fn(),
}));
vi.mock('@/hooks/useWorkspaceLimits', () => ({ useWorkspaceLimits: limitsMock }));
vi.mock('@/hooks/useWorkspaceUsage', () => ({ useWorkspaceUsage: usageMock }));
vi.mock('@/hooks/useIsWorkspaceOwner', () => ({ useIsWorkspaceOwner: () => true }));

import { UsagePanel } from '../UsagePanel';

const LIMITS = {
  max_clients: 15,
  max_team_members: 3,
  max_workflow_templates: 8,
  max_active_workflows_per_client: 10,
  max_instagram_accounts: 15,
  max_leads: 200,
  max_hub_tokens: 15,
  storage_quota_bytes: 10 * 1024 ** 3,
  max_custom_properties_per_template: 15,
  max_posts_per_workflow: null,
  max_workspaces_per_user: 1,
  max_mcp_keys: null,
  rate_instagram_syncs_per_day: null,
  rate_ai_analyses_per_month: null,
  rate_report_generations_per_month: null,
};
const USAGE = {
  clients: 13,
  team_members: 2,
  pending_invites: 1,
  leads: 37,
  hub_tokens: 9,
  workflow_templates: 5,
  instagram_accounts: 6,
  mcp_keys: 2,
  storage_used_bytes: 4.2 * 1024 ** 3,
};

function renderPanel() {
  render(
    <MemoryRouter>
      <UsagePanel />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  limitsMock.mockReturnValue({
    limits: LIMITS,
    planName: 'Pro',
    isLoading: false,
    isUnlimited: false,
  });
  usageMock.mockReturnValue({ usage: USAGE, isLoading: false, isError: false });
});

describe('UsagePanel', () => {
  it('renders a meter per workspace-wide limit with the seat total including pending invites', () => {
    renderPanel();
    expect(screen.getByText('Uso do plano')).toBeInTheDocument();
    expect(screen.getByText('13 de 15')).toBeInTheDocument(); // clientes
    expect(screen.getByText('3 de 3')).toBeInTheDocument(); // 2 membros + 1 convite
    expect(screen.getByText('2 membros e 1 convite pendente')).toBeInTheDocument();
    expect(screen.getByText('4,2 GB de 10 GB')).toBeInTheDocument();
    expect(screen.getByText('Ilimitado')).toBeInTheDocument(); // chaves MCP (null limit)
  });

  it('renders the quiet fallback when the usage RPC fails', () => {
    usageMock.mockReturnValue({ usage: null, isLoading: false, isError: true });
    renderPanel();
    expect(screen.getByText('Não foi possível carregar o uso do plano.')).toBeInTheDocument();
  });

  it('renders nothing when no plan resolved (isUnlimited)', () => {
    limitsMock.mockReturnValue({
      limits: null,
      planName: null,
      isLoading: false,
      isUnlimited: true,
    });
    const { container } = render(
      <MemoryRouter>
        <UsagePanel />
      </MemoryRouter>,
    );
    expect(container.firstChild).toBeNull();
  });
});
```

Note: `max_posts_per_workflow: null` in LIMITS produces a second null-limit meter only if you wrongly include per-entity limits — the panel must NOT render `max_posts_per_workflow`, `max_custom_properties_per_template`, `max_active_workflows_per_client`, or `max_workspaces_per_user` (spec §1). The `Ilimitado` assertion above therefore expects exactly ONE badge (`getByText` throws on multiples — that is the point).

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run apps/crm/src/pages/configuracao/cobranca/__tests__/UsagePanel.test.tsx`
Expected: FAIL — cannot resolve `../UsagePanel`.

- [ ] **Step 3: Write the panel**

```tsx
// apps/crm/src/pages/configuracao/cobranca/UsagePanel.tsx
import { useWorkspaceLimits } from '@/hooks/useWorkspaceLimits';
import { useWorkspaceUsage } from '@/hooks/useWorkspaceUsage';
import { useIsWorkspaceOwner } from '@/hooks/useIsWorkspaceOwner';
import { UsageMeter } from '@/components/usage/UsageMeter';
import { formatStorageBytes } from '@/components/usage/usage-meter-state';

/**
 * "Uso do plano": every WORKSPACE-WIDE countable limit vs current usage.
 * Per-entity limits (posts per workflow, custom props per template, active
 * workflows per client) and max_workspaces_per_user are deliberately absent.
 */
export function UsagePanel() {
  const { limits, planName, isLoading: limitsLoading, isUnlimited } = useWorkspaceLimits();
  const { usage, isLoading: usageLoading, isError } = useWorkspaceUsage();
  const isOwner = useIsWorkspaceOwner();

  if (isUnlimited) return null; // no plan resolved: same skip as ProtectedRoute
  if (limitsLoading || usageLoading) {
    return (
      <div className="card usage-panel" aria-busy="true">
        <h3 className="usage-panel-title">Uso do plano</h3>
        <p className="usage-panel-sub">Carregando...</p>
      </div>
    );
  }
  if (isError || limits === null || usage === null) {
    return (
      <div className="card usage-panel">
        <h3 className="usage-panel-title">Uso do plano</h3>
        <p className="usage-panel-sub">Não foi possível carregar o uso do plano.</p>
      </div>
    );
  }

  const members = usage.team_members ?? 0;
  const pending = usage.pending_invites ?? 0;
  const seatSub =
    pending > 0
      ? `${members} ${members === 1 ? 'membro' : 'membros'} e ${pending} ${
          pending === 1 ? 'convite pendente' : 'convites pendentes'
        }`
      : undefined;

  const meters: Array<{
    label: string;
    used: number;
    limit: number | null;
    format?: (n: number) => string;
    subText?: string;
  }> = [
    { label: 'Clientes', used: usage.clients ?? 0, limit: limits.max_clients },
    {
      label: 'Vagas de equipe',
      used: members + pending,
      limit: limits.max_team_members,
      subText: seatSub,
    },
    {
      label: 'Armazenamento',
      used: usage.storage_used_bytes ?? 0,
      limit: limits.storage_quota_bytes,
      format: formatStorageBytes,
    },
    { label: 'Leads', used: usage.leads ?? 0, limit: limits.max_leads },
    {
      label: 'Templates de workflow',
      used: usage.workflow_templates ?? 0,
      limit: limits.max_workflow_templates,
    },
    {
      label: 'Contas de Instagram',
      used: usage.instagram_accounts ?? 0,
      limit: limits.max_instagram_accounts,
    },
    { label: 'Tokens do Hub', used: usage.hub_tokens ?? 0, limit: limits.max_hub_tokens },
    { label: 'Chaves MCP', used: usage.mcp_keys ?? 0, limit: limits.max_mcp_keys },
  ];

  return (
    <div className="card usage-panel">
      <h3 className="usage-panel-title">Uso do plano</h3>
      {planName && <p className="usage-panel-sub">Plano {planName}</p>}
      <div className="usage-grid">
        {meters.map((m) => (
          <UsageMeter key={m.label} size="full" showUpgradeCta={isOwner} {...m} />
        ))}
      </div>
    </div>
  );
}
```

Append to `apps/crm/src/pages/configuracao/cobranca/cobranca.css`:

```css
/* Uso do plano panel */
.usage-panel {
  margin-bottom: 1.25rem;
}
.usage-panel-title {
  font-size: 0.95rem;
  font-weight: 700;
  margin: 0 0 2px;
}
.usage-panel-sub {
  color: var(--text-muted);
  font-size: 0.8rem;
  margin: 0 0 1rem;
}
.usage-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
  gap: 18px 32px;
}
```

In `CobrancaPage.tsx`: add `import { UsagePanel } from './UsagePanel';` and render `<UsagePanel />` immediately AFTER the current-plan card block (the `billing-current` section that ends around L213) and BEFORE the month/annual toggle. The page is already gated to owners at L124-132, so the panel needs no extra gate of its own.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run apps/crm/src/pages/configuracao/cobranca/__tests__/UsagePanel.test.tsx`
Expected: PASS (3 tests).

- [ ] **Step 5: Verify in the browser**

Start the CRM preview (dev server, launch.json name for `npm run dev`), log in as an owner, open Configurações > Plano & Cobrança. Confirm: panel renders above the catalog, meters show real counts, no horizontal overflow at 375px width. Also confirm the loading skeleton does not flash-render broken.

- [ ] **Step 6: Commit**

```bash
git add apps/crm/src/pages/configuracao/cobranca/
git commit -m "feat(cobranca): Uso do plano usage panel"
```

---

### Task 6: Clientes header meter

**Files:**
- Modify: `apps/crm/src/pages/clientes/ClientesPage.tsx` (~L177, ~L352)
- Test: `apps/crm/src/pages/clientes/__tests__/ClientesPage.atlimit.test.tsx` (extend)

**Interfaces:**
- Consumes: `UsageMeter` (compact), `useIsWorkspaceOwner`, `useEntitlements` (now also destructuring `limits`).

- [ ] **Step 1: Extend the failing test**

In `ClientesPage.atlimit.test.tsx`, the `useEntitlements` mock currently returns `{ isAtLimit }` only. Replace it with a controllable version and add a hook mock:

```tsx
const { isAtLimitMock, limitsRef } = vi.hoisted(() => ({
  isAtLimitMock: vi.fn(),
  limitsRef: { current: null as null | Record<string, number | null> },
}));

vi.mock('../../../hooks/useEntitlements', () => ({
  useEntitlements: () => ({ isAtLimit: isAtLimitMock, limits: limitsRef.current }),
}));
vi.mock('../../../hooks/useIsWorkspaceOwner', () => ({ useIsWorkspaceOwner: () => true }));
```

Reset `limitsRef.current = null` in the existing `beforeEach` (existing tests then see no meter and keep passing untouched). ClientesPage renders `<UsageMeter>` which contains a react-router `Link`; the file already mocks `react-router-dom` with `importActual`, so wrap the render in `MemoryRouter`:

```tsx
import { MemoryRouter } from 'react-router-dom';
// in renderPage():
render(
  <MemoryRouter>
    <QueryClientProvider client={queryClient}>
      <ClientesPage />
    </QueryClientProvider>
  </MemoryRouter>,
);
```

New tests:

```tsx
it('shows the header meter when max_clients is limited', async () => {
  isAtLimitMock.mockReturnValue(false);
  limitsRef.current = { max_clients: 15 };
  mockedGetClientes.mockResolvedValue([
    { id: 1, nome: 'A', sigla: 'A', cor: '#000', status: 'ativo' } as store.Cliente,
    { id: 2, nome: 'B', sigla: 'B', cor: '#000', status: 'ativo' } as store.Cliente,
  ]);
  renderPage();
  expect(await screen.findByText('2 de 15 clientes')).toBeInTheDocument();
});

it('shows the owner upgrade CTA above 75% usage', async () => {
  isAtLimitMock.mockReturnValue(false);
  limitsRef.current = { max_clients: 15 };
  mockedGetClientes.mockResolvedValue(
    Array.from({ length: 12 }, (_, i) => ({
      id: i + 1, nome: `C${i}`, sigla: 'C', cor: '#000', status: 'ativo',
    })) as store.Cliente[],
  );
  renderPage();
  expect(await screen.findByText('12 de 15 clientes')).toBeInTheDocument();
  expect(screen.getByText('Fazer upgrade')).toBeInTheDocument();
});

it('hides the meter entirely when limits are unresolved', async () => {
  isAtLimitMock.mockReturnValue(false);
  limitsRef.current = null;
  renderPage();
  await waitFor(() => expect(mockedGetClientes).toHaveBeenCalled());
  expect(screen.queryByText(/de .* clientes/)).not.toBeInTheDocument();
});
```

- [ ] **Step 2: Run to verify the new tests fail**

Run: `npx vitest run apps/crm/src/pages/clientes/__tests__/ClientesPage.atlimit.test.tsx`
Expected: the 3 new tests FAIL (no meter rendered); the 3 existing tests PASS.

- [ ] **Step 3: Implement**

In `ClientesPage.tsx`:

```tsx
// imports
import { UsageMeter } from '@/components/usage/UsageMeter';
import { useIsWorkspaceOwner } from '@/hooks/useIsWorkspaceOwner';

// ~L177: also take limits
const { isAtLimit, limits } = useEntitlements();
const isOwner = useIsWorkspaceOwner();
```

In the header (the div wrapping the `<h1>` at ~L352), directly below the title row:

```tsx
{limits && limits.max_clients !== null && (
  <div style={{ marginTop: 6 }}>
    <UsageMeter
      size="compact"
      label="clientes"
      used={clientes.length}
      limit={limits.max_clients}
      showUpgradeCta={isOwner}
    />
  </div>
)}
```

The button's `disabled={clientsAtLimit}` + `title` behavior at L374-380 stays exactly as is.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run apps/crm/src/pages/clientes/__tests__/ClientesPage.atlimit.test.tsx`
Expected: PASS (6 tests).

- [ ] **Step 5: Verify in the browser**

CRM preview → /clientes: meter under the title, correct count, bar coloring; at-limit workspace (or temporarily hardcode `limit={clientes.length}` to eyeball, then revert) shows danger + CTA.

- [ ] **Step 6: Commit**

```bash
git add apps/crm/src/pages/clientes/
git commit -m "feat(clientes): visible plan usage meter in the page header"
```

---

### Task 7: Leads exact count + header meter

**Files:**
- Modify: `apps/crm/src/store/leads.ts` (add `getLeadsCount`)
- Modify: `apps/crm/src/pages/leads/LeadsPage.tsx` (~L195-199, header)
- Test: `apps/crm/src/pages/leads/__tests__/LeadsPage.atlimit.test.tsx` (extend)

**Interfaces:**
- Produces: `getLeadsCount(): Promise<number>` in `store/leads.ts`.
- Consumes: `UsageMeter` compact, `useIsWorkspaceOwner`.

**Why:** `getLeads()` is one unpaged select subject to the server max-rows cap, so `leads.length` can understate usage; the meter and `leadsAtLimit` must use an exact count (spec §5). Invalidation is free: every existing `qc.invalidateQueries({ queryKey: ['leads'] })` prefix-matches `['leads', 'count']`.

- [ ] **Step 1: Extend the failing test**

Mirror Task 6's mock changes in `LeadsPage.atlimit.test.tsx` (`limitsRef` on the `useEntitlements` mock, `useIsWorkspaceOwner` mock, `MemoryRouter` wrapper if not already present). Add `getLeadsCount` to the store mock (the file mocks the leads store — extend the same `vi.mock` with `getLeadsCount: vi.fn()`), then:

```tsx
it('feeds isAtLimit the exact server count, not the list length', async () => {
  isAtLimitMock.mockReturnValue(false);
  mockedGetLeads.mockResolvedValue([{ id: 1 } as never, { id: 2 } as never]);
  mockedGetLeadsCount.mockResolvedValue(1205); // truncated list scenario
  renderPage();
  await waitFor(() => expect(isAtLimitMock).toHaveBeenCalledWith('max_leads', 1205));
});

it('shows the header meter from the exact count', async () => {
  isAtLimitMock.mockReturnValue(false);
  limitsRef.current = { max_leads: 200 };
  mockedGetLeads.mockResolvedValue([]);
  mockedGetLeadsCount.mockResolvedValue(37);
  renderPage();
  expect(await screen.findByText('37 de 200 leads')).toBeInTheDocument();
});
```

Keep the existing test asserting `isAtLimit('max_leads', <count>)` working: it must now expect the mocked `getLeadsCount` value (update its arrangement accordingly — set `mockedGetLeadsCount.mockResolvedValue(<same count>)`).

- [ ] **Step 2: Run to verify the new tests fail**

Run: `npx vitest run apps/crm/src/pages/leads/__tests__/LeadsPage.atlimit.test.tsx`

- [ ] **Step 3: Implement**

`apps/crm/src/store/leads.ts` (after `getLeads`):

```ts
/**
 * Exact lead count for plan-usage display. getLeads() is a single unpaged
 * select capped by the server max-rows setting, so its length can understate
 * a large workspace; head+count asks Postgres for the real number.
 */
export async function getLeadsCount(): Promise<number> {
  const { count, error } = await supabase
    .from('leads')
    .select('*', { count: 'exact', head: true });
  if (error) throw error;
  return count ?? 0;
}
```

`LeadsPage.tsx`:

```tsx
// imports: add getLeadsCount to the existing store import; add
import { UsageMeter } from '@/components/usage/UsageMeter';
import { useIsWorkspaceOwner } from '@/hooks/useIsWorkspaceOwner';

// ~L195-199
const { isAtLimit, limits } = useEntitlements();
const isOwner = useIsWorkspaceOwner();
const { data: leads = [], isLoading } = useQuery({ queryKey: ['leads'], queryFn: getLeads });
const { data: leadsCount } = useQuery({ queryKey: ['leads', 'count'], queryFn: getLeadsCount });
const usedLeads = leadsCount ?? leads.length;
const leadsAtLimit = isAtLimit('max_leads', usedLeads);
```

Header meter, below the page title (same placement pattern as Clientes):

```tsx
{limits && limits.max_leads !== null && (
  <div style={{ marginTop: 6 }}>
    <UsageMeter
      size="compact"
      label="leads"
      used={usedLeads}
      limit={limits.max_leads}
      showUpgradeCta={isOwner}
    />
  </div>
)}
```

The `disabled={leadsAtLimit}` button at L443-444 stays as is.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run apps/crm/src/pages/leads/__tests__/LeadsPage.atlimit.test.tsx`

- [ ] **Step 5: Commit**

```bash
git add apps/crm/src/store/leads.ts apps/crm/src/pages/leads/
git commit -m "feat(leads): exact usage count and header meter"
```

---

### Task 8: Equipe — raw pending seat count + SeatMeter on UsageMeter

**Files:**
- Modify: `apps/crm/src/pages/equipe/EquipePage.tsx` (~L143-166)
- Modify: `apps/crm/src/pages/equipe/InviteSection.tsx` (SeatMeter, L19-69)
- Test: `apps/crm/src/pages/equipe/__tests__/InviteSection.test.tsx`, `apps/crm/src/pages/equipe/__tests__/EquipePage.test.tsx` (keep green; extend)

**Interfaces:**
- Consumes: `UsageMeter` (`valueText`/`subText` overrides), `useIsWorkspaceOwner`.
- Behavior contract preserved: copy "X de Y vagas do plano usadas", "X de Y vagas após este convite", "N restante(s)", "Carregando vagas do plano..."; `unlimited` renders nothing; `computeSeatState` untouched.
- Deliberate change (spec §5): the seat count now uses the RAW `status='pending'` invite count (matches the server pre-check in `_shared/invite-actions.ts`); the pending-invite LIST keeps hiding locally-expired invites.

- [ ] **Step 1: Write the failing test (pure derivation)**

Add to `apps/crm/src/pages/equipe/__tests__/inviteSupport.test.ts`:

```ts
import { derivePendingInvites } from '../inviteSupport';

describe('derivePendingInvites', () => {
  const past = new Date(Date.now() - 86400000).toISOString();
  const future = new Date(Date.now() + 86400000).toISOString();

  it('hides locally-expired invites from display but counts them as seats', () => {
    const rows = [
      { id: '1', status: 'pending', expires_at: past, email: 'old@x.com' },
      { id: '2', status: 'pending', expires_at: future, email: 'new@x.com' },
    ];
    const { display, seatCount } = derivePendingInvites(rows);
    // Display mirrors computeEffectiveInviteStatus: the expired one drops out...
    expect(display.map((i) => i.id)).toEqual(['2']);
    // ...but the server pre-check counts RAW pending rows, so both hold a seat.
    expect(seatCount).toBe(2);
  });

  it('returns empty display and zero seats for no rows', () => {
    expect(derivePendingInvites([])).toEqual({ display: [], seatCount: 0 });
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run apps/crm/src/pages/equipe/__tests__/inviteSupport.test.ts`
Expected: FAIL — `derivePendingInvites` is not exported.

- [ ] **Step 3: Implement**

In `apps/crm/src/pages/equipe/inviteSupport.ts`:

```ts
import { computeEffectiveInviteStatus } from '../configuracao/inviteHelpers';

/**
 * Pending-invite rows split for the Equipe page. `display` hides invites whose
 * expires_at already passed (they must not RENDER as pending); `seatCount` is
 * the RAW row count, because the server seat pre-check (_shared/
 * invite-actions.ts) counts every status='pending' row regardless of expiry:
 * an expired-but-unprocessed invite still consumes a seat until revoked or
 * replaced. Counting filtered here would show capacity the server refuses.
 */
export function derivePendingInvites<T extends { status: string; expires_at?: string | null }>(
  rows: T[],
): { display: T[]; seatCount: number } {
  return {
    display: computeEffectiveInviteStatus(rows).filter((i) => i.status === 'pending'),
    seatCount: rows.length,
  };
}
```

In `EquipePage.tsx` (~L143-166), the invites query stops filtering and the derivation goes through the helper:

```tsx
const { data: pendingInviteRows = [] } = useQuery({
  queryKey: ['invites', 'equipe-pending', profile?.conta_id],
  queryFn: async () => {
    const { data, error } = await supabase
      .from('invites')
      .select('id, email, role, membro_id, expires_at, status')
      .eq('conta_id', profile!.conta_id)
      .eq('status', 'pending');
    if (error) throw error;
    return data ?? [];
  },
  enabled: canManageWorkspace && !!profile?.conta_id,
});
const { display: pendingInvites, seatCount: pendingSeatCount } = useMemo(
  () => derivePendingInvites(pendingInviteRows),
  [pendingInviteRows],
);
```

Keep `pendingByMembroId` built from the filtered `pendingInvites` (unchanged), pass `pendingCount: pendingSeatCount` into `computeSeatState`, and drop the now-unused direct `computeEffectiveInviteStatus` import from `EquipePage.tsx` if nothing else in the file uses it (`inviteSuccessMessage` comes from the same import — keep that).

- [ ] **Step 4: Refactor SeatMeter onto UsageMeter**

Replace the bar/label markup of `SeatMeter` in `InviteSection.tsx` (keep the function and its early returns):

```tsx
import { UsageMeter } from '@/components/usage/UsageMeter';
import { useIsWorkspaceOwner } from '@/hooks/useIsWorkspaceOwner';

function SeatMeter({ seat, previewing }: { seat: SeatState; previewing: boolean }) {
  const isOwner = useIsWorkspaceOwner();
  if (seat.status === 'unlimited') return null;
  if (seat.status === 'loading' || seat.status === 'unavailable') {
    return (
      <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: 8 }}>
        Carregando vagas do plano...
      </p>
    );
  }
  const doPreview = previewing && seat.status === 'ok';
  const displayUsed = doPreview ? seat.used + 1 : seat.used;
  const displayRemaining = doPreview
    ? Math.max(0, (seat.remaining ?? 0) - 1)
    : (seat.remaining ?? 0);
  return (
    <div style={{ marginTop: 10 }}>
      <UsageMeter
        label=""
        used={displayUsed}
        limit={seat.limit}
        showUpgradeCta={isOwner}
        valueText={`${displayUsed} de ${seat.limit} ${
          doPreview ? 'vagas após este convite' : 'vagas do plano usadas'
        }`}
        subText={`${displayRemaining} restante${displayRemaining === 1 ? '' : 's'}`}
      />
    </div>
  );
}
```

Update `InviteSection.test.tsx` setup only as needed: add `vi.mock` for `@/hooks/useIsWorkspaceOwner` (return `false` so no CTA disturbs existing copy assertions) and wrap renders in `MemoryRouter`. The copy assertions at L36-73 must pass UNCHANGED.

- [ ] **Step 5: Run the equipe suites**

Run: `npx vitest run apps/crm/src/pages/equipe/`
Expected: all pass, including the untouched copy assertions.

- [ ] **Step 6: Commit**

```bash
git add apps/crm/src/pages/equipe/
git commit -m "feat(equipe): seat meter on UsageMeter; raw pending count matches enforcement"
```

---

### Task 9: Arquivos — storage bars on the shared component

**Files:**
- Modify: `apps/crm/src/pages/arquivos/ArquivosPage.tsx` (L580-608)
- Modify: `apps/crm/src/pages/arquivos/components/MobileArquivosView.tsx` (StorageCard, L241-285)

**Interfaces:**
- Consumes: `UsageMeter`, `MeterBar`, `useIsWorkspaceOwner`, existing `formatBytes` from `./components/FileGrid`.
- Contract preserved: `quota_bytes: 0` from `file-manage` means "unlimited/unknown FOR DISPLAY" (`file-manage/handler.ts:184-186`) — map it to `limit={null}` with `unlimitedBadge={false}`, never to the blocked state.
- Deliberate change (spec §5): warning threshold moves 90% → 80%, and the sub-80% fill becomes `var(--success)` (was `var(--primary-color)`).

- [ ] **Step 1: Replace the desktop sidebar bar (L580-608)**

```tsx
{/* Storage usage bar */}
{storage && (
  <div className="px-4 py-3 border-t border-[var(--border-color)]">
    <UsageMeter
      label="Armazenamento"
      used={storage.used_bytes}
      limit={storage.quota_bytes > 0 ? storage.quota_bytes : null}
      format={formatBytes}
      unlimitedBadge={false}
      showUpgradeCta={isOwner}
      subText={
        storage.quota_bytes > 0
          ? `${Math.min(100, Math.round((storage.used_bytes / storage.quota_bytes) * 100))}% usado`
          : undefined
      }
    />
  </div>
)}
```

Add imports and `const isOwner = useIsWorkspaceOwner();` in the component body.

- [ ] **Step 2: Swap StorageCard's manual bar for MeterBar**

In `MobileArquivosView.tsx`, replace the inner `<div className="h-1.5 ...">...</div>` bar (the one with the 90%-threshold `backgroundColor` ternary) with:

```tsx
{storage.quota_bytes > 0 && (
  <MeterBar used={storage.used_bytes} limit={storage.quota_bytes} height={6} />
)}
```

`import { MeterBar } from '@/components/usage/UsageMeter';`. Everything else in the card (labels, `pct% usado` footer) stays.

- [ ] **Step 3: Run the arquivos tests + typecheck**

Run: `npx vitest run apps/crm/src/pages/arquivos/ && npx tsc -p apps/crm/tsconfig.json --noEmit`
Expected: PASS. If any existing test asserts the old bar colors/thresholds, update it to the unified helper's values (80% warning) — that change is spec'd, not accidental.

- [ ] **Step 4: Verify in the browser**

CRM preview → /arquivos (desktop width ≥1101px for the sidebar): storage meter renders with the unified look; resize to mobile and check the StorageCard bar.

- [ ] **Step 5: Commit**

```bash
git add apps/crm/src/pages/arquivos/
git commit -m "feat(arquivos): storage bars on the shared UsageMeter (warning at 80%)"
```

---

### Task 10: Full verification gate

**Files:** none new.

- [ ] **Step 1: Full local CI parity**

```bash
npm run lint
npm run format          # then confirm: npm run format:check
npx tsc -p apps/crm/tsconfig.json --noEmit
npx tsc -p apps/hub/tsconfig.json --noEmit
npx tsc -p apps/admin/tsconfig.json --noEmit
npx tsc -p tsconfig.scripts.json
npm run test
npm run test:functions && git checkout -- deno.lock
```

Expected: everything green. `npm run build` is NOT sufficient — CI typechecks all four projects.

- [ ] **Step 2: Entitlement suite (if Docker available)**

```bash
bash scripts/test-entitlements.sh
```

Otherwise rely on CI's `entitlement-tests` job.

- [ ] **Step 3: Migration collision re-check (memory: struck twice)**

```bash
git fetch origin main
git ls-tree origin/main:supabase/migrations --name-only | tail -3
```

If any file on main now shares the `20260808000001` prefix (or is above it), renumber the migration file above main's tail before opening the PR.

- [ ] **Step 4: Commit any format fixes, push, open PR**

Branch: `claude/plan-limits-visual-indicators-8a0ef7`. PR body: reference the spec, list the deliberate behavior changes (CTA >75%, storage warning 80%, raw pending seat count, Leads exact count). End with the standard Claude Code footer. Note: an external Codex review auto-fires on `gh pr create` — verify its findings before acting on them.

**Deploy note (post-merge):** `npx supabase db push --linked` for the migration — check `cat supabase/.temp/project-ref` FIRST (link state flips between prod `skjzpekeqefvlojenfsw` and staging `wlyzhyfondykzpsiqsce`; memory: worktrees start unlinked). No edge function deploys needed. Frontend ships via Vercel on merge. The migration must be applied BEFORE the frontend deploy lands, or the panel's RPC call 404s and renders the quiet fallback (acceptable degradation, but avoid it).
