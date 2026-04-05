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
    AND public.get_my_role() IS DISTINCT FROM 'agent'
  );

-- =============================================
-- CONTRATOS — replace SELECT policy
-- =============================================
DROP POLICY IF EXISTS "contratos_select" ON contratos;
CREATE POLICY "contratos_select" ON contratos
  FOR SELECT USING (
    conta_id IN (SELECT public.get_my_conta_id())
    AND public.get_my_role() IS DISTINCT FROM 'agent'
  );

-- =============================================
-- LEADS — replace SELECT policy
-- =============================================
DROP POLICY IF EXISTS "leads_select" ON leads;
CREATE POLICY "leads_select" ON leads
  FOR SELECT USING (
    conta_id IN (SELECT public.get_my_conta_id())
    AND public.get_my_role() IS DISTINCT FROM 'agent'
  );
