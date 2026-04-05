# Agent RLS Restriction — Design Spec

**Date:** 2026-04-04  
**Status:** Approved

## Problem

The `ProtectedRoute` component blocks agents from navigating to `/financeiro`, `/contratos`, and `/leads` in the UI, but this is purely client-side. An agent with DevTools can call the Supabase client directly and query `transacoes`, `contratos`, and `leads` without restriction, because the existing RLS policies only scope by `conta_id` — not by role. The database-level enforcement must match the intended access model.

## Solution

Add a `get_my_role()` SECURITY DEFINER helper function (mirroring the existing `get_my_conta_id()` pattern) and replace the `SELECT` policies on `transacoes`, `contratos`, and `leads` to include a `role != 'agent'` condition.

---

## Section 1: Helper Function

New `SECURITY DEFINER` function added in the migration:

```sql
CREATE OR REPLACE FUNCTION public.get_my_role()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT role FROM profiles WHERE id = auth.uid();
$$;
```

- `STABLE` allows Postgres to cache the result within a single query execution.
- `SECURITY DEFINER` + `SET search_path = public` prevents privilege escalation and search path injection — same hardening as `get_my_conta_id()`.

---

## Section 2: Policy Changes

The existing `SELECT` policies on `transacoes`, `contratos`, and `leads` are dropped and recreated with an additional role check. The `INSERT`, `UPDATE`, and `DELETE` policies are left unchanged.

```sql
-- transacoes
DROP POLICY IF EXISTS "transacoes_select" ON transacoes;
CREATE POLICY "transacoes_select" ON transacoes
  FOR SELECT USING (
    conta_id IN (SELECT public.get_my_conta_id())
    AND public.get_my_role() != 'agent'
  );

-- contratos
DROP POLICY IF EXISTS "contratos_select" ON contratos;
CREATE POLICY "contratos_select" ON contratos
  FOR SELECT USING (
    conta_id IN (SELECT public.get_my_conta_id())
    AND public.get_my_role() != 'agent'
  );

-- leads
DROP POLICY IF EXISTS "leads_select" ON leads;
CREATE POLICY "leads_select" ON leads
  FOR SELECT USING (
    conta_id IN (SELECT public.get_my_conta_id())
    AND public.get_my_role() != 'agent'
  );
```

Agents querying these tables will receive an empty result set (not an error), which is the standard Postgres RLS behavior.

---

## Section 3: Migration File

**File:** `supabase/migrations/20260404_agent_rls_restriction.sql`

Contains:
1. The `get_my_role()` function definition
2. The three replaced `SELECT` policies

---

## Scope

**In scope:**
- New migration `supabase/migrations/20260404_agent_rls_restriction.sql`
- `get_my_role()` SECURITY DEFINER helper function
- Replace `SELECT` policies on `transacoes`, `contratos`, `leads`

**Out of scope:**
- `INSERT`/`UPDATE`/`DELETE` policies (unchanged)
- `ProtectedRoute.tsx` (unchanged — UI guard remains as defense-in-depth)
- Any other tables
- Application-level error handling for empty result sets returned to agents
