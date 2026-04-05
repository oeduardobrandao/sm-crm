# Agent RLS Restriction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add database-level role enforcement so agents cannot read `transacoes`, `contratos`, or `leads` even via direct Supabase client calls.

**Architecture:** A single migration file adds a `get_my_role()` SECURITY DEFINER helper (mirroring the existing `get_my_conta_id()` pattern) and replaces the `SELECT` policies on the three sensitive tables to include `AND public.get_my_role() != 'agent'`.

**Tech Stack:** PostgreSQL RLS, Supabase migrations (plain SQL files in `supabase/migrations/`)

---

## Files

- **Create:** `supabase/migrations/20260404_agent_rls_restriction.sql`

---

### Task 1: Write the migration file

**Files:**
- Create: `supabase/migrations/20260404_agent_rls_restriction.sql`

- [ ] **Step 1: Create the migration file**

Create `supabase/migrations/20260404_agent_rls_restriction.sql` with the following exact content:

```sql
-- =============================================
-- Agent RLS Restriction - 2026-04-04
-- Adds role-based enforcement to SELECT policies
-- on transacoes, contratos, and leads so that
-- users with role='agent' receive empty result
-- sets regardless of workspace membership.
-- =============================================

-- =============================================
-- Helper: SECURITY DEFINER function to get the
-- current user's role without triggering RLS.
-- Mirrors the existing get_my_conta_id() pattern.
-- =============================================
CREATE OR REPLACE FUNCTION public.get_my_role()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT role FROM profiles WHERE id = auth.uid();
$$;

-- =============================================
-- TRANSACOES — replace SELECT policy
-- =============================================
DROP POLICY IF EXISTS "transacoes_select" ON transacoes;
CREATE POLICY "transacoes_select" ON transacoes
  FOR SELECT USING (
    conta_id IN (SELECT public.get_my_conta_id())
    AND public.get_my_role() != 'agent'
  );

-- =============================================
-- CONTRATOS — replace SELECT policy
-- =============================================
DROP POLICY IF EXISTS "contratos_select" ON contratos;
CREATE POLICY "contratos_select" ON contratos
  FOR SELECT USING (
    conta_id IN (SELECT public.get_my_conta_id())
    AND public.get_my_role() != 'agent'
  );

-- =============================================
-- LEADS — replace SELECT policy
-- =============================================
DROP POLICY IF EXISTS "leads_select" ON leads;
CREATE POLICY "leads_select" ON leads
  FOR SELECT USING (
    conta_id IN (SELECT public.get_my_conta_id())
    AND public.get_my_role() != 'agent'
  );
```

- [ ] **Step 2: Verify the file was created**

```bash
cat supabase/migrations/20260404_agent_rls_restriction.sql
```

Expected: full file contents printed with no errors.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260404_agent_rls_restriction.sql
git commit -m "feat: restrict transacoes/contratos/leads SELECT to non-agent roles via RLS"
```

---

### Task 2: Apply and verify the migration

**Files:**
- No file changes — this task applies the migration and verifies it.

> **Note:** These steps require access to the Supabase project. Use `supabase db push` if you have the Supabase CLI linked to the project, or apply the SQL manually via the Supabase dashboard SQL editor.

- [ ] **Step 1: Apply the migration**

If using Supabase CLI:
```bash
supabase db push
```

Expected output includes the migration filename and no errors.

If applying manually: open the Supabase dashboard → SQL editor → paste and run the contents of `supabase/migrations/20260404_agent_rls_restriction.sql`.

- [ ] **Step 2: Verify `get_my_role()` exists**

In the Supabase SQL editor, run:

```sql
SELECT routine_name, routine_type, security_type
FROM information_schema.routines
WHERE routine_schema = 'public'
  AND routine_name = 'get_my_role';
```

Expected: one row with `routine_name = get_my_role`, `routine_type = FUNCTION`, `security_type = DEFINER`.

- [ ] **Step 3: Verify SELECT policies were replaced**

```sql
SELECT tablename, policyname, cmd, qual
FROM pg_policies
WHERE tablename IN ('transacoes', 'contratos', 'leads')
  AND cmd = 'SELECT';
```

Expected: three rows (one per table), each with `policyname` ending in `_select` and `qual` containing `get_my_role`.

- [ ] **Step 4: Smoke-test agent access**

Log in to the app as a user with `role = 'agent'` and open the browser DevTools console. Run:

```js
const { data, error } = await window.__supabase.from('transacoes').select('*');
console.log(data, error);
```

> Note: `window.__supabase` may not be exposed. If not, use the Supabase SQL editor to impersonate an agent user:
> ```sql
> -- Replace <agent_user_id> with an actual agent's auth.uid()
> SET LOCAL role authenticated;
> SET LOCAL request.jwt.claims = '{"sub": "<agent_user_id>"}';
> SELECT * FROM transacoes LIMIT 5;
> ```

Expected: `data = []` (empty array), `error = null`. RLS silently returns no rows — it does not throw an error.

- [ ] **Step 5: Smoke-test non-agent access**

Log in as a user with `role = 'owner'` or `'admin'` and confirm they can still read data from all three tables normally through the UI (Financeiro, Contratos, Leads pages load data as expected).
