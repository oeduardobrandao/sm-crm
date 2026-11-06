-- supabase/migrations/20261016000001_entregas_saved_views.sql
-- Visualizações salvas da página Entregas no servidor, por usuário e por
-- workspace (decisão D19 do plano do app iOS, PR C2). Até aqui elas viviam no
-- localStorage (`entregas_saved_views_<contaId>`), presas a um navegador; o CRM
-- importa essa lista uma vez por workspace e depois só lê esta tabela.
--
-- Uma visualização é um nome + a mesma query serializada que a URL de Entregas
-- carrega (viewQuery). Sem compartilhamento entre usuários: a tabela pode
-- ganhar uma coluna `shared` depois, se alguém pedir.

CREATE TABLE public.entregas_saved_views (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conta_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  -- CASCADE, não SET NULL: a coluna é NOT NULL, e SET NULL num NOT NULL faz o
  -- DELETE de auth.users falhar (20261001000001_user_fk_columns_nullable.sql).
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (char_length(btrim(name)) >= 1 AND char_length(name) <= 80),
  query text NOT NULL CHECK (char_length(query) <= 4000),
  position int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  -- Também é o alvo do ON CONFLICT do importador (upsert ignoreDuplicates).
  CONSTRAINT entregas_saved_views_user_conta_name_uq UNIQUE (user_id, conta_id, name)
);

CREATE INDEX entregas_saved_views_user_conta_position_idx
  ON public.entregas_saved_views (user_id, conta_id, position);

-- Mesmo desenho de post_processes_set_updated_at (20260918000002).
CREATE OR REPLACE FUNCTION public.entregas_saved_views_set_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  new.updated_at := now();
  RETURN new;
END;
$$;
CREATE TRIGGER entregas_saved_views_set_updated_at
  BEFORE UPDATE ON public.entregas_saved_views
  FOR EACH ROW EXECUTE FUNCTION public.entregas_saved_views_set_updated_at();

-- ---- RLS ----
-- Só as próprias linhas, e só no workspace ativo. get_my_conta_id() devolve o
-- active_workspace_id do perfil apenas se o usuário ainda é membro dele
-- (20260720000004), então o WITH CHECK impede gravar uma visualização num
-- workspace que o usuário deixou ou em outro que não o ativo. Formas
-- (select ...) para o planner avaliar as funções uma vez por query.
ALTER TABLE public.entregas_saved_views ENABLE ROW LEVEL SECURITY;

CREATE POLICY entregas_saved_views_select ON public.entregas_saved_views
  FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()) AND conta_id IN (SELECT public.get_my_conta_id()));
CREATE POLICY entregas_saved_views_insert ON public.entregas_saved_views
  FOR INSERT TO authenticated
  WITH CHECK (user_id = (SELECT auth.uid()) AND conta_id IN (SELECT public.get_my_conta_id()));
CREATE POLICY entregas_saved_views_update ON public.entregas_saved_views
  FOR UPDATE TO authenticated
  USING (user_id = (SELECT auth.uid()) AND conta_id IN (SELECT public.get_my_conta_id()))
  WITH CHECK (user_id = (SELECT auth.uid()) AND conta_id IN (SELECT public.get_my_conta_id()));
CREATE POLICY entregas_saved_views_delete ON public.entregas_saved_views
  FOR DELETE TO authenticated
  USING (user_id = (SELECT auth.uid()) AND conta_id IN (SELECT public.get_my_conta_id()));

-- ---- grants ----
-- O default ACL hospedado concede ALL em tabelas novas, inclusive a anon.
-- Revoga tudo (TRUNCATE ignora RLS) e devolve só o necessário, no formato de
-- 20261005000001_agenda_eventos.sql. Chave uuid: não há sequence a conceder.
REVOKE ALL ON TABLE public.entregas_saved_views FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.entregas_saved_views TO authenticated;
GRANT ALL ON TABLE public.entregas_saved_views TO service_role;

-- A função de trigger não é chamável diretamente (RETURNS trigger); revogar
-- EXECUTE só tira a superfície do inventário de grants.
REVOKE ALL ON FUNCTION public.entregas_saved_views_set_updated_at() FROM PUBLIC, anon, authenticated;

DO $$
DECLARE
  v_extra text;
BEGIN
  SELECT string_agg(privilege_type, ', ' ORDER BY privilege_type) INTO v_extra
    FROM information_schema.role_table_grants
   WHERE table_schema = 'public' AND table_name = 'entregas_saved_views'
     AND grantee = 'authenticated'
     AND privilege_type NOT IN ('SELECT', 'INSERT', 'UPDATE', 'DELETE');
  IF v_extra IS NOT NULL THEN
    RAISE EXCEPTION 'entregas_saved_views: authenticated holds more than CRUD (%)', v_extra;
  END IF;
  IF (SELECT count(*) FROM information_schema.role_table_grants
       WHERE table_schema = 'public' AND table_name = 'entregas_saved_views'
         AND grantee = 'authenticated'
         AND privilege_type IN ('SELECT', 'INSERT', 'UPDATE', 'DELETE')) <> 4 THEN
    RAISE EXCEPTION 'entregas_saved_views: authenticated is missing a CRUD privilege';
  END IF;
  IF EXISTS (
    SELECT 1 FROM information_schema.role_table_grants
     WHERE table_schema = 'public' AND table_name = 'entregas_saved_views'
       AND grantee = 'anon'
  ) THEN
    RAISE EXCEPTION 'entregas_saved_views: anon holds a privilege';
  END IF;
END
$$;
