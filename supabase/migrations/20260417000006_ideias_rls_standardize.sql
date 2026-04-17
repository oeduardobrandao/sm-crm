-- Standardize ideias RLS to use get_my_conta_id() instead of inline subquery
-- against membros table. This aligns with the pattern used by all other tables.

DO $$ BEGIN
  -- Drop the old catch-all policy
  DROP POLICY IF EXISTS "workspace members can manage ideias" ON ideias;

  -- Recreate as granular per-operation policies using get_my_conta_id()
  CREATE POLICY "ideias_select" ON ideias
    FOR SELECT USING (workspace_id IN (SELECT public.get_my_conta_id()));

  CREATE POLICY "ideias_insert" ON ideias
    FOR INSERT WITH CHECK (workspace_id IN (SELECT public.get_my_conta_id()));

  CREATE POLICY "ideias_update" ON ideias
    FOR UPDATE USING (workspace_id IN (SELECT public.get_my_conta_id()))
    WITH CHECK (workspace_id IN (SELECT public.get_my_conta_id()));

  CREATE POLICY "ideias_delete" ON ideias
    FOR DELETE USING (workspace_id IN (SELECT public.get_my_conta_id()));
END $$;

-- Also standardize ideia_reactions
DO $$ BEGIN
  DROP POLICY IF EXISTS "workspace members can manage reactions" ON ideia_reactions;

  CREATE POLICY "reactions_select" ON ideia_reactions
    FOR SELECT USING (
      ideia_id IN (SELECT id FROM ideias WHERE workspace_id IN (SELECT public.get_my_conta_id()))
    );

  CREATE POLICY "reactions_insert" ON ideia_reactions
    FOR INSERT WITH CHECK (
      ideia_id IN (SELECT id FROM ideias WHERE workspace_id IN (SELECT public.get_my_conta_id()))
    );

  CREATE POLICY "reactions_update" ON ideia_reactions
    FOR UPDATE USING (
      ideia_id IN (SELECT id FROM ideias WHERE workspace_id IN (SELECT public.get_my_conta_id()))
    );

  CREATE POLICY "reactions_delete" ON ideia_reactions
    FOR DELETE USING (
      ideia_id IN (SELECT id FROM ideias WHERE workspace_id IN (SELECT public.get_my_conta_id()))
    );
END $$;
