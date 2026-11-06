-- E-mails dos membros do workspace para quem gerencia a equipe.
--
-- profiles não tem coluna de e-mail; ele só existe em auth.users, que o CRM
-- não lê. Sem isso, dono e admin não tinham onde consultar o e-mail de login
-- de um membro. Esta RPC devolve (user_id, email) dos membros do workspace
-- ATIVO, e só para quem tem equipe:editar (dono, admin legado e papéis
-- customizados com esse nível -- o mesmo predicado que o CRM usa para
-- mostrar a gestão de equipe). Sem permissão, zero linhas em vez de erro:
-- o CRM usa o resultado só como enriquecimento da lista.

CREATE OR REPLACE FUNCTION public.get_workspace_member_emails()
RETURNS TABLE (
  user_id uuid,
  email   text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_conta uuid := public.get_my_conta_id();
BEGIN
  -- get_my_conta_id() já exige membership do workspace ativo;
  -- has_permission() resolve contra o mesmo par (auth.uid(), workspace).
  IF v_conta IS NULL OR NOT public.has_permission('equipe', 'editar') THEN
    RETURN;
  END IF;
  RETURN QUERY
  SELECT wm.user_id, u.email::text
    FROM public.workspace_members wm
    JOIN auth.users u ON u.id = wm.user_id
   WHERE wm.workspace_id = v_conta
     AND u.email IS NOT NULL;
END;
$$;

-- Padrão can_see_financials (20260728000001): enumerar os roles,
-- REVOKE FROM PUBLIC sozinho não basta.
REVOKE ALL ON FUNCTION public.get_workspace_member_emails()
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_workspace_member_emails() TO authenticated;
