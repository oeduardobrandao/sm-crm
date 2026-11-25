-- =====================================================================
-- 20261129000002_workspace_billing_column_guard.sql
--
-- Fecha duas escalas de privilégio de plano pelo cliente.
--
-- (1) workspaces: colunas de cobrança/plano.
--     `workspaces` tem grants de tabela inteira para anon/authenticated (não a
--     allowlist por coluna de `clientes`/`membros`), e a policy
--     ws_update_owner_admin deixa dono ou admin atualizar a própria linha. RLS é
--     por linha e não compara OLD/NEW, então um dono/admin conseguia gravar
--     `plan_id` direto pelo PostgREST e ganhar todo recurso pago: todo caminho de
--     entitlement (effective_plan_feature/effective_plan_limit, triggers
--     enforce_plan_*, _shared/entitlements.ts, services/billing.ts do CRM) lê
--     workspaces.plan_id.
--
--     Colunas guardadas (nenhum write legítimo do CRM/Hub/Admin as toca; todo
--     writer é função SECURITY DEFINER ou edge function com service role):
--       plan_id, plan_source            -- plano efetivo e quem o concedeu
--       trial_offer_seen_at             -- elegibilidade do /comecar (mark_trial_offer_seen, DEFINER)
--       storage_used_bytes              -- contador da quota; zerar burla a quota (RPCs DEFINER, file-manage svc)
--       storage_quota_bytes             -- coluna morta, mas é um limite: guardada por segurança
--       demo_created_at, demo_created_by -- marcador de conta demo (platform-admin, svc)
--       is_internal                     -- flag interna da plataforma (só SQL/admin)
--
--     Fora do guard de propósito: hub_hide_branding e os demais hub_* (o CRM
--     grava pela aba Hub; o hub-bootstrap só os honra com o entitlement de
--     marca, então gravar sem plano não dá nada) e storage_autoclean_* (guard
--     próprio, 20260811000001).
--
--     Por que current_user e SECURITY INVOKER: a função do trigger roda como o
--     papel da requisição. Via PostgREST com JWT de usuário é `authenticated`
--     (ou `anon`); dentro de uma função SECURITY DEFINER (mark_trial_offer_seen,
--     grant_pagarme_plan, *_finalize, file_update_used_bytes...) é o dono da
--     função (postgres); service_role, crons e webhooks são `service_role`. Por
--     isso NÃO se usa auth.uid(): ele está preenchido quando o dono chama
--     mark_trial_offer_seen() e bloquearia esse caminho legítimo. E a função do
--     trigger não pode ser SECURITY DEFINER, senão current_user seria sempre o
--     dono e o guard nunca dispararia.
--
--     Sem prefixo zz_: o guard só compara NEW com OLD do que o chamador pediu, e
--     nenhum outro trigger BEFORE UPDATE de workspaces reescreve essas colunas,
--     então a ordem alfabética não muda o resultado.
--
--     Ao adicionar coluna de cobrança/plano em workspaces (ex.: reverse_trial_*),
--     acrescente-a aqui e ao teste 99_workspace_billing_column_guard.sql.
--
-- (2) workspace_plan_overrides: RLS desligada e sem policy desde 20260501000002.
--     Com o ACL padrão do Supabase hospedado (GRANT ALL a anon/authenticated em
--     tabela nova de public), qualquer usuário autenticado podia inserir
--     feature_overrides/resource_overrides para QUALQUER workspace. Só a service
--     role (platform-admin) e funções SECURITY DEFINER do dono da tabela
--     (effective_plan_*, admin_list_workspaces, demo_workspace_discard) leem ou
--     gravam a tabela, e ambas ignoram RLS; então liga a RLS sem policy e tira
--     os grants de anon/authenticated (nomeados: REVOKE FROM PUBLIC não os
--     remove).
-- =====================================================================

CREATE OR REPLACE FUNCTION public.workspaces_guard_billing_columns()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  IF current_user IN ('anon', 'authenticated')
     AND (NEW.plan_id             IS DISTINCT FROM OLD.plan_id
       OR NEW.plan_source         IS DISTINCT FROM OLD.plan_source
       OR NEW.trial_offer_seen_at IS DISTINCT FROM OLD.trial_offer_seen_at
       OR NEW.storage_used_bytes  IS DISTINCT FROM OLD.storage_used_bytes
       OR NEW.storage_quota_bytes IS DISTINCT FROM OLD.storage_quota_bytes
       OR NEW.demo_created_at     IS DISTINCT FROM OLD.demo_created_at
       OR NEW.demo_created_by     IS DISTINCT FROM OLD.demo_created_by
       OR NEW.is_internal         IS DISTINCT FROM OLD.is_internal)
  THEN
    RAISE EXCEPTION 'workspace_billing_columns_read_only'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.workspaces_guard_billing_columns() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_workspaces_guard_billing_columns ON public.workspaces;
CREATE TRIGGER trg_workspaces_guard_billing_columns
  BEFORE UPDATE ON public.workspaces
  FOR EACH ROW EXECUTE FUNCTION public.workspaces_guard_billing_columns();

ALTER TABLE public.workspace_plan_overrides ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.workspace_plan_overrides FROM PUBLIC, anon, authenticated;
