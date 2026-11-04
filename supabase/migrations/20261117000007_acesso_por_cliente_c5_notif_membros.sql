-- Acesso por cliente, Task 4e: notificações e vínculo de membro.
-- Nota: a leitura de notifications descrita abaixo (escopo ou contexto) foi
-- substituída pela leitura por item em 20261117000012.
-- Spec: docs/superpowers/specs/2026-11-03-acesso-por-cliente-design.md
-- Inventário: docs/superpowers/plans/2026-11-03-acesso-por-cliente-inventario.md
--
-- 1. notifications: o destinatário lê a notificação sem cliente, ou sobre um
--    cliente que ele vê (escopo, ou o contexto de um item dele ali:
--    can_see_cliente_context). As notificações já gravadas de cliente oculto
--    deixam de aparecer e de ser clicáveis.
--    O sino lista as notificações de TODOS os workspaces do usuário, mas
--    my_client_scope_all() e can_see_cliente_context() respondem pelo workspace
--    ATIVO. Por isso o predicado do plano vale só para as linhas do workspace
--    ativo; numa linha de outro workspace conta o escopo da membership daquele
--    workspace (dono, 'todos' ou cliente atribuído), sem o "é dele" (falha
--    fechada: aparece quando ele troca para aquele workspace). Sem isso, quem é
--    'todos' no ativo via as notificações de cliente oculto do workspace em que
--    é restrito.
--    UPDATE (marcar lida, dispensar) segue a mesma visibilidade: o WITH CHECK
--    repete o USING em vez do "estrito" das tabelas de conteúdo, porque o único
--    UPDATE concedido a authenticated é (read_at, dismissed_at)
--    (20260430000001); cliente_id não é gravável, então não há como reescopar.
--    O GRANT é reafirmado aqui. Sem policy de INSERT/DELETE (só os emissores
--    SECURITY DEFINER e service role escrevem).
-- 2. membros.crm_user_id: o vínculo decide o que my_membro_ids() devolve, ou
--    seja o que é "dele" para o restrito. Ligar a um restrito uma linha de
--    membro com trabalho atribuído num cliente oculto (ou tirar o vínculo dele)
--    muda o escopo dele, e isso é só do dono (como set_member_client_scope).
--    trg_membros_crm_user_scope_lock: INSERT ou UPDATE de crm_user_id em que o
--    valor antigo ou o novo é um usuário com client_scope = 'atribuidos' naquele
--    conta_id exige que auth.uid() seja dono ali (client_scope_owner_only).
--    INSERT entra pelo mesmo motivo: crm_user_id está no GRANT de INSERT e a
--    linha nova passa a dar a ele o "é dele" de tudo que for atribuído a ela.
--    auth.uid() NULL (service role: accept_workspace_invite, invite-actions)
--    não muda: esses caminhos carregam o próprio controle (Task 13).
-- equipe_conversas e filhas: sem mudança (o restrito segue nas salas em que está).

-- -------------------------------------------------------------
-- 1. notifications
-- -------------------------------------------------------------
DROP POLICY IF EXISTS notifications_select ON public.notifications;
CREATE POLICY notifications_select ON public.notifications
  FOR SELECT
  USING (
    (user_id = auth.uid())
    AND (EXISTS (SELECT 1 FROM public.workspace_members wm
                  WHERE wm.workspace_id = notifications.workspace_id AND wm.user_id = auth.uid()))
    AND (
      cliente_id IS NULL
      OR (workspace_id = (SELECT public.get_my_conta_id())
          AND ((SELECT public.my_client_scope_all()) OR public.can_see_cliente_context(cliente_id)))
      OR (workspace_id IS DISTINCT FROM (SELECT public.get_my_conta_id())
          AND EXISTS (SELECT 1 FROM public.workspace_members wm2
                       WHERE wm2.workspace_id = notifications.workspace_id
                         AND wm2.user_id = auth.uid()
                         AND (wm2.role = 'owner' OR wm2.client_scope = 'todos'
                              OR EXISTS (SELECT 1 FROM public.workspace_member_clientes wmc
                                          WHERE wmc.workspace_id = notifications.workspace_id
                                            AND wmc.user_id = auth.uid()
                                            AND wmc.cliente_id = notifications.cliente_id))))
    )
  );

DROP POLICY IF EXISTS notifications_update ON public.notifications;
CREATE POLICY notifications_update ON public.notifications
  FOR UPDATE
  USING (
    (user_id = auth.uid())
    AND (EXISTS (SELECT 1 FROM public.workspace_members wm
                  WHERE wm.workspace_id = notifications.workspace_id AND wm.user_id = auth.uid()))
    AND (
      cliente_id IS NULL
      OR (workspace_id = (SELECT public.get_my_conta_id())
          AND ((SELECT public.my_client_scope_all()) OR public.can_see_cliente_context(cliente_id)))
      OR (workspace_id IS DISTINCT FROM (SELECT public.get_my_conta_id())
          AND EXISTS (SELECT 1 FROM public.workspace_members wm2
                       WHERE wm2.workspace_id = notifications.workspace_id
                         AND wm2.user_id = auth.uid()
                         AND (wm2.role = 'owner' OR wm2.client_scope = 'todos'
                              OR EXISTS (SELECT 1 FROM public.workspace_member_clientes wmc
                                          WHERE wmc.workspace_id = notifications.workspace_id
                                            AND wmc.user_id = auth.uid()
                                            AND wmc.cliente_id = notifications.cliente_id))))
    )
  )
  WITH CHECK (
    (user_id = auth.uid())
    AND (EXISTS (SELECT 1 FROM public.workspace_members wm
                  WHERE wm.workspace_id = notifications.workspace_id AND wm.user_id = auth.uid()))
    AND (
      cliente_id IS NULL
      OR (workspace_id = (SELECT public.get_my_conta_id())
          AND ((SELECT public.my_client_scope_all()) OR public.can_see_cliente_context(cliente_id)))
      OR (workspace_id IS DISTINCT FROM (SELECT public.get_my_conta_id())
          AND EXISTS (SELECT 1 FROM public.workspace_members wm2
                       WHERE wm2.workspace_id = notifications.workspace_id
                         AND wm2.user_id = auth.uid()
                         AND (wm2.role = 'owner' OR wm2.client_scope = 'todos'
                              OR EXISTS (SELECT 1 FROM public.workspace_member_clientes wmc
                                          WHERE wmc.workspace_id = notifications.workspace_id
                                            AND wmc.user_id = auth.uid()
                                            AND wmc.cliente_id = notifications.cliente_id))))
    )
  );

-- Reafirma 20260430000001: authenticated só grava read_at e dismissed_at.
REVOKE UPDATE ON public.notifications FROM authenticated;
GRANT UPDATE (read_at, dismissed_at) ON public.notifications TO authenticated;

-- -------------------------------------------------------------
-- 2. membros.crm_user_id: vínculo de restrito só pelo dono
-- -------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.guard_membros_crm_user_scope()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  -- service role / pg_cron: caminhos com controle próprio
  IF v_uid IS NULL THEN RETURN NEW; END IF;

  IF TG_OP = 'UPDATE'
     AND NEW.crm_user_id IS NOT DISTINCT FROM OLD.crm_user_id
     AND NEW.conta_id IS NOT DISTINCT FROM OLD.conta_id THEN
    RETURN NEW;
  END IF;

  -- valor antigo (UPDATE): tirar o vínculo de um restrito
  IF TG_OP = 'UPDATE' AND OLD.crm_user_id IS NOT NULL
     AND EXISTS (SELECT 1 FROM public.workspace_members wm
                  WHERE wm.workspace_id = OLD.conta_id AND wm.user_id = OLD.crm_user_id
                    AND wm.client_scope = 'atribuidos')
     AND NOT EXISTS (SELECT 1 FROM public.workspace_members wm
                      WHERE wm.workspace_id = OLD.conta_id AND wm.user_id = v_uid
                        AND wm.role = 'owner') THEN
    RAISE EXCEPTION 'client_scope_owner_only' USING ERRCODE = '42501';
  END IF;

  -- valor novo (INSERT/UPDATE): ligar a linha a um restrito
  IF NEW.crm_user_id IS NOT NULL
     AND EXISTS (SELECT 1 FROM public.workspace_members wm
                  WHERE wm.workspace_id = NEW.conta_id AND wm.user_id = NEW.crm_user_id
                    AND wm.client_scope = 'atribuidos')
     AND NOT EXISTS (SELECT 1 FROM public.workspace_members wm
                      WHERE wm.workspace_id = NEW.conta_id AND wm.user_id = v_uid
                        AND wm.role = 'owner') THEN
    RAISE EXCEPTION 'client_scope_owner_only' USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.guard_membros_crm_user_scope() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.guard_membros_crm_user_scope() TO service_role;

DROP TRIGGER IF EXISTS trg_membros_crm_user_scope_lock ON public.membros;
CREATE TRIGGER trg_membros_crm_user_scope_lock
  BEFORE INSERT OR UPDATE OF crm_user_id, conta_id ON public.membros
  FOR EACH ROW EXECUTE FUNCTION public.guard_membros_crm_user_scope();

-- -------------------------------------------------------------
-- 3. Pós-condições
-- -------------------------------------------------------------
DO $$
DECLARE
  acl text;
BEGIN
  SELECT array_to_string(proacl, ',') INTO acl FROM pg_proc
   WHERE oid = 'public.guard_membros_crm_user_scope()'::regprocedure;
  IF acl IS NULL OR acl NOT LIKE '%service_role=X%' THEN
    RAISE EXCEPTION 'guard_membros_crm_user_scope: service_role lacks EXECUTE — acl=%', acl;
  END IF;
  IF acl LIKE '%authenticated=X%' OR acl LIKE '%anon=X%' OR acl LIKE '=X%' OR acl LIKE '%,=X%' THEN
    RAISE EXCEPTION 'guard_membros_crm_user_scope: unexpected EXECUTE grant — acl=%', acl;
  END IF;

  IF has_column_privilege('authenticated', 'public.notifications', 'cliente_id', 'UPDATE')
     OR has_column_privilege('authenticated', 'public.notifications', 'user_id', 'UPDATE')
     OR has_column_privilege('authenticated', 'public.notifications', 'workspace_id', 'UPDATE') THEN
    RAISE EXCEPTION 'notifications: authenticated can UPDATE a scoping column';
  END IF;
END $$;
