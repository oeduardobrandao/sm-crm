-- Acesso por cliente, Migração C2 (tarefas, ideias, linha editorial e contexto):
-- tarefas, ideias e o que pende delas, a linha editorial, a marca, o briefing e
-- as páginas do Hub respeitam o escopo do membro.
--
-- Raízes de item (tarefas, tarefa_series, ideias):
--   leitura  = <qual atual> AND ((SELECT my_client_scope_all()) OR can_access_cliente(cliente) OR <é dele>)
--   "é dele": tarefas e tarefa_series = responsavel_id (membros) ou user_id (autor);
--             ideias = autor_membro_id (membros).
--   UPDATE   = USING e WITH CHECK com a regra de leitura (o restrito edita a
--              própria tarefa/ideia num cliente oculto ou sem cliente). O trigger
--              zz_client_scope_guard barra realocar (cliente_id, inclusive para
--              NULL) sem acesso à origem e ao destino, reescrever o autor e pôr a
--              si mesmo como responsável num cliente que ele não acessa.
--   INSERT e DELETE = estritos (RESTRICTIVE ou qual próprio), sem o "é dele":
--              cliente NULL só para quem tem my_client_scope_all().
--   tarefa_series: authenticated só lê (escrita pelas RPCs); o mesmo trigger
--              guarda o caminho SECURITY DEFINER.
-- Filhas (subtarefas, tags, comentários, eventos, menções, arquivos e reações da
--   ideia): leitura, INSERT e UPDATE pelo pai visível (EXISTS no pai, que roda com
--   a RLS dele), mais o autor na leitura onde há autor. DELETE num pai de cliente
--   que ele não acessa: só a linha que ele mesmo escreveu (sem autor: nenhuma).
--   Trocar o pai exige acesso ao cliente do pai de origem (zz_client_scope_reparent_guard).
-- Linha editorial: estrita (created_by/enviada_por/convertido_por não são "é dele",
--   como workflows.user_id na C1); itens e respostas pela linha visível.
-- Contexto (hub_brand, hub_brand_files, briefings, hub_briefing_questions): leitura
--   por can_see_cliente_context, escrita estrita. hub_pages: estrita.
-- Termos de tenant que consultavam clientes/tarefa_series sob a RLS (agora
--   escopada) viram helpers DEFINER (cliente_in_active_conta,
--   tarefa_serie_in_active_conta), de mesmo resultado: sem isso o restrito não
--   salvaria a própria tarefa no cliente oculto e a marca desse cliente nunca
--   apareceria como contexto.
-- O termo (SELECT my_client_scope_all()) vem primeiro: é um initplan, então o
-- membro irrestrito não paga can_access_cliente nem o EXISTS por linha.
-- Spec: docs/superpowers/specs/2026-11-03-acesso-por-cliente-design.md
-- Inventário: docs/superpowers/plans/2026-11-03-acesso-por-cliente-inventario.md

-- -------------------------------------------------------------
-- 0. Helpers
-- -------------------------------------------------------------
-- O cliente é do workspace ativo, sem passar pela RLS de clientes (o restrito
-- não lê a linha do cliente oculto, mas a tarefa dele ou a marca de contexto
-- continuam referindo-o). Mesmo resultado do EXISTS em clientes que substitui.
CREATE OR REPLACE FUNCTION public.cliente_in_active_conta(p_cliente_id bigint)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.clientes c
     WHERE c.id = p_cliente_id AND c.conta_id = public.get_my_conta_id()
  );
$$;
REVOKE ALL ON FUNCTION public.cliente_in_active_conta(bigint) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cliente_in_active_conta(bigint) TO authenticated, service_role;

-- A série é do workspace ativo, sem passar pela RLS de tarefa_series (a tarefa
-- dele pode pertencer a uma série que ele não lê). serie_id não muda por
-- authenticated (tarefas_serie_id_guard), então isto só revalida o valor gravado
-- pelas RPCs de série.
CREATE OR REPLACE FUNCTION public.tarefa_serie_in_active_conta(p_serie_id bigint)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.tarefa_series s
     WHERE s.id = p_serie_id AND s.conta_id = public.get_my_conta_id()
  );
$$;
REVOKE ALL ON FUNCTION public.tarefa_serie_in_active_conta(bigint) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.tarefa_serie_in_active_conta(bigint) TO authenticated, service_role;

-- Guarda das raízes de item (tarefas, tarefa_series, ideias):
--   * autor imutável para qualquer usuário logado: tarefas.user_id e
--     ideias.autor_membro_id liberam a leitura "é dele" (tarefa_series.user_id já
--     é imutável por tarefa_series_guard). ideias.autor_membro_id pode ir a NULL
--     (ON DELETE SET NULL do membro);
--   * para o restrito: mudar cliente_id (inclusive para NULL) exige acesso à
--     ORIGEM e ao DESTINO; pôr a si mesmo como responsável exige acesso ao
--     cliente; no INSERT, uma linha "dele" (autor ou responsável) só num cliente
--     que ele acessa. Isso cobre os caminhos SECURITY DEFINER (RPCs de série,
--     RPCs futuras), que não passam pela RLS;
--   * exceções: a ocorrência que uma série materializa (serie_id, que só o código
--     de série grava) não é barrada, a série é que foi guardada; e cliente_id que
--     vira NULL porque o cliente foi apagado (FK ON DELETE SET NULL) não é
--     realocação.
-- Prefixo zz: roda depois dos outros BEFORE e vê o NEW final. auth.uid() NULL
-- (service role, cron) e membros irrestritos saem antes de qualquer leitura.
CREATE OR REPLACE FUNCTION public.guard_client_scope_item()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid     uuid := auth.uid();
  v_conta   uuid;
  v_old_cli bigint;
  v_new_cli bigint;
  v_old_own bigint;
  v_new_own bigint;
  v_mine    boolean := false;
BEGIN
  IF v_uid IS NULL THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' THEN
    IF TG_TABLE_NAME = 'ideias' THEN
      IF NEW.autor_membro_id IS NOT NULL
         AND NEW.autor_membro_id IS DISTINCT FROM OLD.autor_membro_id THEN
        RAISE EXCEPTION 'author_immutable' USING ERRCODE = '42501';
      END IF;
    ELSIF TG_TABLE_NAME = 'tarefas' THEN
      IF NEW.user_id IS DISTINCT FROM OLD.user_id THEN
        RAISE EXCEPTION 'author_immutable' USING ERRCODE = '42501';
      END IF;
    END IF;
  END IF;
  -- Saída barata: quem não é restrito em nenhum workspace não paga nada mais.
  IF NOT EXISTS (
    SELECT 1 FROM public.workspace_members wm
     WHERE wm.user_id = v_uid AND wm.role <> 'owner' AND wm.client_scope = 'atribuidos'
  ) THEN
    RETURN NEW;
  END IF;
  -- Ramos separados: plpgsql resolve o campo do NEW ao executar o comando, e
  -- ideias não tem conta_id/user_id/responsavel_id.
  IF TG_TABLE_NAME = 'ideias' THEN
    v_conta   := NEW.workspace_id;
    v_new_cli := NEW.cliente_id;
    v_new_own := NEW.autor_membro_id;
    IF TG_OP = 'UPDATE' THEN
      v_old_cli := OLD.cliente_id;
      v_old_own := OLD.autor_membro_id;
    END IF;
  ELSE
    v_conta   := NEW.conta_id;
    v_new_cli := NEW.cliente_id;
    v_new_own := NEW.responsavel_id;
    v_mine    := NEW.user_id = v_uid;
    IF TG_OP = 'UPDATE' THEN
      v_old_cli := OLD.cliente_id;
      v_old_own := OLD.responsavel_id;
    END IF;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.workspace_members wm
     WHERE wm.workspace_id = v_conta AND wm.user_id = v_uid
       AND wm.role <> 'owner' AND wm.client_scope = 'atribuidos'
  ) THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF TG_TABLE_NAME = 'tarefas' THEN
      IF NEW.serie_id IS NOT NULL THEN RETURN NEW; END IF;
    END IF;
    -- linha "dele": autor (v_mine) ou responsável/autor-membro ele mesmo
    v_mine := v_mine OR (v_new_own IS NOT NULL AND EXISTS (
      SELECT 1 FROM public.membros m
       WHERE m.id = v_new_own AND m.crm_user_id = v_uid AND m.conta_id = v_conta));
    IF v_mine AND NOT public.can_access_cliente(v_uid, v_conta, v_new_cli) THEN
      RAISE EXCEPTION 'client_scope_restricted' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;

  IF v_new_cli IS DISTINCT FROM v_old_cli THEN
    IF v_new_cli IS NULL
       AND NOT EXISTS (SELECT 1 FROM public.clientes c WHERE c.id = v_old_cli) THEN
      RETURN NEW;
    END IF;
    IF NOT public.can_access_cliente(v_uid, v_conta, v_old_cli)
       OR NOT public.can_access_cliente(v_uid, v_conta, v_new_cli) THEN
      RAISE EXCEPTION 'client_scope_restricted' USING ERRCODE = '42501';
    END IF;
  END IF;
  -- autoatribuição: o responsável passou a ser ele mesmo
  IF v_new_own IS DISTINCT FROM v_old_own AND v_new_own IS NOT NULL
     AND EXISTS (SELECT 1 FROM public.membros m
                  WHERE m.id = v_new_own AND m.crm_user_id = v_uid AND m.conta_id = v_conta)
     AND NOT public.can_access_cliente(v_uid, v_conta, v_new_cli) THEN
    RAISE EXCEPTION 'client_scope_restricted' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.guard_client_scope_item() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.guard_client_scope_item() TO service_role;

CREATE TRIGGER zz_client_scope_guard
  BEFORE INSERT OR UPDATE ON public.tarefas
  FOR EACH ROW EXECUTE FUNCTION public.guard_client_scope_item();
CREATE TRIGGER zz_client_scope_guard
  BEFORE INSERT OR UPDATE ON public.tarefa_series
  FOR EACH ROW EXECUTE FUNCTION public.guard_client_scope_item();
CREATE TRIGGER zz_client_scope_guard
  BEFORE INSERT OR UPDATE ON public.ideias
  FOR EACH ROW EXECUTE FUNCTION public.guard_client_scope_item();

-- Guarda das filhas cujo pai está no GRANT UPDATE de authenticated (subtarefas,
-- tarefa_tag_links: tarefa_id; ideia_files, ideia_reactions: ideia_id): trocar o
-- pai exige, para o restrito, acesso ao cliente do pai de ORIGEM. Senão ele
-- moveria a filha da tarefa/ideia dele num cliente oculto para um pai acessível
-- e a apagaria lá. auth.uid() NULL passa.
CREATE OR REPLACE FUNCTION public.guard_scope_child_reparent()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid   uuid := auth.uid();
  v_conta uuid;
  v_cli   bigint;
BEGIN
  IF v_uid IS NULL THEN RETURN NEW; END IF;
  IF TG_TABLE_NAME IN ('subtarefas', 'tarefa_tag_links') THEN
    IF NEW.tarefa_id IS NOT DISTINCT FROM OLD.tarefa_id THEN RETURN NEW; END IF;
  ELSE
    IF NEW.ideia_id IS NOT DISTINCT FROM OLD.ideia_id THEN RETURN NEW; END IF;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.workspace_members wm
     WHERE wm.user_id = v_uid AND wm.role <> 'owner' AND wm.client_scope = 'atribuidos'
  ) THEN
    RETURN NEW;
  END IF;
  IF TG_TABLE_NAME IN ('subtarefas', 'tarefa_tag_links') THEN
    SELECT t.conta_id, t.cliente_id INTO v_conta, v_cli
      FROM public.tarefas t WHERE t.id = OLD.tarefa_id;
  ELSE
    SELECT i.workspace_id, i.cliente_id INTO v_conta, v_cli
      FROM public.ideias i WHERE i.id = OLD.ideia_id;
  END IF;
  IF EXISTS (
       SELECT 1 FROM public.workspace_members wm
        WHERE wm.workspace_id = v_conta AND wm.user_id = v_uid
          AND wm.role <> 'owner' AND wm.client_scope = 'atribuidos')
     AND NOT public.can_access_cliente(v_uid, v_conta, v_cli) THEN
    RAISE EXCEPTION 'client_scope_restricted' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.guard_scope_child_reparent() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.guard_scope_child_reparent() TO service_role;

CREATE TRIGGER zz_client_scope_reparent_guard
  BEFORE UPDATE OF tarefa_id ON public.subtarefas
  FOR EACH ROW EXECUTE FUNCTION public.guard_scope_child_reparent();
CREATE TRIGGER zz_client_scope_reparent_guard
  BEFORE UPDATE OF tarefa_id ON public.tarefa_tag_links
  FOR EACH ROW EXECUTE FUNCTION public.guard_scope_child_reparent();
CREATE TRIGGER zz_client_scope_reparent_guard
  BEFORE UPDATE OF ideia_id ON public.ideia_files
  FOR EACH ROW EXECUTE FUNCTION public.guard_scope_child_reparent();
CREATE TRIGGER zz_client_scope_reparent_guard
  BEFORE UPDATE OF ideia_id ON public.ideia_reactions
  FOR EACH ROW EXECUTE FUNCTION public.guard_scope_child_reparent();

-- -------------------------------------------------------------
-- 1. tarefas
-- -------------------------------------------------------------
-- FOR ALL: USING e WITH CHECK levam o "é dele" (leitura e UPDATE); INSERT e
-- DELETE estritos pelas RESTRICTIVE abaixo. O WITH CHECK mantém as checagens de
-- tenant do responsável, do cliente e da série; as duas últimas passam a usar os
-- helpers DEFINER (mesmo resultado, sem depender da RLS de clientes/tarefa_series).
ALTER POLICY tarefas_tenant_all ON public.tarefas
  USING (
    conta_id IN (SELECT public.get_my_conta_id())
    AND ((SELECT public.my_client_scope_all())
         OR public.can_access_cliente(cliente_id)
         OR responsavel_id = ANY ((SELECT public.my_membro_ids())::bigint[])
         OR user_id = auth.uid())
  )
  WITH CHECK (
    conta_id IN (SELECT public.get_my_conta_id())
    AND (responsavel_id IS NULL
         OR EXISTS (SELECT 1 FROM public.membros m
                     WHERE m.id = tarefas.responsavel_id AND m.conta_id = tarefas.conta_id))
    AND (cliente_id IS NULL OR public.cliente_in_active_conta(cliente_id))
    AND (serie_id IS NULL OR public.tarefa_serie_in_active_conta(serie_id))
    AND ((SELECT public.my_client_scope_all())
         OR public.can_access_cliente(cliente_id)
         OR responsavel_id = ANY ((SELECT public.my_membro_ids())::bigint[])
         OR user_id = auth.uid())
  );
CREATE POLICY tarefas_scope_insert ON public.tarefas
  AS RESTRICTIVE FOR INSERT TO authenticated
  WITH CHECK ((SELECT public.my_client_scope_all()) OR public.can_access_cliente(cliente_id));
CREATE POLICY tarefas_scope_delete ON public.tarefas
  AS RESTRICTIVE FOR DELETE TO authenticated
  USING ((SELECT public.my_client_scope_all()) OR public.can_access_cliente(cliente_id));

-- tarefa_series: só SELECT para authenticated (escrita pelas RPCs, guardadas pelo
-- zz_client_scope_guard).
ALTER POLICY tarefa_series_tenant_select ON public.tarefa_series
  USING (
    conta_id IN (SELECT public.get_my_conta_id())
    AND ((SELECT public.my_client_scope_all())
         OR public.can_access_cliente(cliente_id)
         OR responsavel_id = ANY ((SELECT public.my_membro_ids())::bigint[])
         OR user_id = auth.uid())
  );

-- -------------------------------------------------------------
-- 2. Filhas da tarefa
-- -------------------------------------------------------------
-- Comentários: authenticated tem só UPDATE (conteudo) e DELETE (o INSERT é pela
-- RPC tarefa_comentario_enviar), então author_id e tarefa_id já são fixos pelo
-- grant. Leitura: tarefa visível ou o comentário é dele.
ALTER POLICY tarefa_comentarios_select ON public.tarefa_comentarios
  USING (
    conta_id IN (SELECT public.get_my_conta_id())
    AND ((SELECT public.my_client_scope_all())
         OR EXISTS (SELECT 1 FROM public.tarefas t WHERE t.id = tarefa_comentarios.tarefa_id)
         OR author_id = auth.uid())
  );
ALTER POLICY tarefa_comentarios_update_own ON public.tarefa_comentarios
  USING (
    conta_id IN (SELECT public.get_my_conta_id())
    AND author_id = auth.uid()
    AND ((SELECT public.my_client_scope_all())
         OR EXISTS (SELECT 1 FROM public.tarefas t WHERE t.id = tarefa_comentarios.tarefa_id))
  )
  WITH CHECK (
    conta_id IN (SELECT public.get_my_conta_id())
    AND author_id = auth.uid()
    AND ((SELECT public.my_client_scope_all())
         OR EXISTS (SELECT 1 FROM public.tarefas t WHERE t.id = tarefa_comentarios.tarefa_id))
  );
-- DELETE: a regra das filhas (num pai que ele não acessa, só a linha que ele
-- escreveu) já é o qual atual, que só deixa apagar o próprio comentário; o termo
-- de escopo fica explícito para a guarda de deriva enxergar o pai.
ALTER POLICY tarefa_comentarios_delete_own ON public.tarefa_comentarios
  USING (
    conta_id IN (SELECT public.get_my_conta_id())
    AND author_id = auth.uid()
    AND ((SELECT public.my_client_scope_all())
         OR EXISTS (SELECT 1 FROM public.tarefas t WHERE t.id = tarefa_comentarios.tarefa_id)
         OR author_id = auth.uid())
  );

ALTER POLICY tarefa_eventos_select ON public.tarefa_eventos
  USING (
    conta_id IN (SELECT public.get_my_conta_id())
    AND ((SELECT public.my_client_scope_all())
         OR EXISTS (SELECT 1 FROM public.tarefas t WHERE t.id = tarefa_eventos.tarefa_id))
  );

ALTER POLICY subtarefas_tenant_all ON public.subtarefas
  USING (
    conta_id IN (SELECT public.get_my_conta_id())
    AND ((SELECT public.my_client_scope_all())
         OR EXISTS (SELECT 1 FROM public.tarefas t WHERE t.id = subtarefas.tarefa_id))
  )
  WITH CHECK (
    conta_id IN (SELECT public.get_my_conta_id())
    AND ((SELECT public.my_client_scope_all())
         OR EXISTS (SELECT 1 FROM public.tarefas t WHERE t.id = subtarefas.tarefa_id))
  );
CREATE POLICY subtarefas_scope_delete ON public.subtarefas
  AS RESTRICTIVE FOR DELETE TO authenticated
  USING (
    (SELECT public.my_client_scope_all())
    OR EXISTS (SELECT 1 FROM public.tarefas t
                WHERE t.id = subtarefas.tarefa_id AND public.can_access_cliente(t.cliente_id))
  );

ALTER POLICY tarefa_tag_links_tenant_all ON public.tarefa_tag_links
  USING (
    conta_id IN (SELECT public.get_my_conta_id())
    AND ((SELECT public.my_client_scope_all())
         OR EXISTS (SELECT 1 FROM public.tarefas t WHERE t.id = tarefa_tag_links.tarefa_id))
  )
  WITH CHECK (
    conta_id IN (SELECT public.get_my_conta_id())
    AND ((SELECT public.my_client_scope_all())
         OR EXISTS (SELECT 1 FROM public.tarefas t WHERE t.id = tarefa_tag_links.tarefa_id))
  );
CREATE POLICY tarefa_tag_links_scope_delete ON public.tarefa_tag_links
  AS RESTRICTIVE FOR DELETE TO authenticated
  USING (
    (SELECT public.my_client_scope_all())
    OR EXISTS (SELECT 1 FROM public.tarefas t
                WHERE t.id = tarefa_tag_links.tarefa_id AND public.can_access_cliente(t.cliente_id))
  );

-- Menções (polimórficas, sem FK: host_type/host_id). Não são raiz de contexto (a
-- notificação cobre quem foi mencionado). Leitura, UPDATE e DELETE (FOR ALL):
-- host de cliente que ele acessa, ou a menção é dele (author_id). Escrita: o
-- CASE de tenant já resolve o host sob a RLS dele (agora escopada); o termo de
-- escopo repete isso de forma explícita: só se menciona em host visível (inclusive
-- a tarefa/post dele num cliente oculto). author_id e host não precisam de
-- guarda: as linhas que ele alcança são de host acessível ou dele, que ele já
-- pode apagar.
ALTER POLICY mencoes_tenant_all ON public.mencoes
  USING (
    conta_id IN (SELECT public.get_my_conta_id())
    AND ((SELECT public.my_client_scope_all())
         OR author_id = auth.uid()
         OR CASE host_type
              WHEN 'tarefa' THEN EXISTS (
                SELECT 1 FROM public.tarefas t
                 WHERE t.id = mencoes.host_id AND public.can_access_cliente(t.cliente_id))
              WHEN 'workflow_post' THEN EXISTS (
                SELECT 1 FROM public.workflow_posts wp
                 WHERE wp.id = mencoes.host_id AND public.can_access_cliente(wp.cliente_id))
              WHEN 'post_comment' THEN EXISTS (
                SELECT 1 FROM public.post_comments pc
                  JOIN public.post_comment_threads pct ON pct.id = pc.thread_id
                  JOIN public.workflow_posts wp ON wp.id = pct.post_id AND wp.conta_id = pct.conta_id
                 WHERE pc.id = mencoes.host_id AND public.can_access_cliente(wp.cliente_id))
              WHEN 'tarefa_comentario' THEN EXISTS (
                SELECT 1 FROM public.tarefa_comentarios tc
                  JOIN public.tarefas t ON t.id = tc.tarefa_id
                 WHERE tc.id = mencoes.host_id AND public.can_access_cliente(t.cliente_id))
              ELSE false
            END)
  )
  WITH CHECK (
    conta_id IN (SELECT public.get_my_conta_id())
    AND author_id = auth.uid()
    AND EXISTS (SELECT 1 FROM public.membros m
                 WHERE m.id = mencoes.mentioned_membro_id AND m.conta_id = mencoes.conta_id)
    AND CASE host_type
          WHEN 'tarefa' THEN EXISTS (
            SELECT 1 FROM public.tarefas t
             WHERE t.id = mencoes.host_id AND t.conta_id = mencoes.conta_id)
          WHEN 'workflow_post' THEN EXISTS (
            SELECT 1 FROM public.workflow_posts wp
             WHERE wp.id = mencoes.host_id AND wp.conta_id = mencoes.conta_id)
          WHEN 'post_comment' THEN EXISTS (
            SELECT 1 FROM public.post_comments pc
              JOIN public.post_comment_threads pct ON pct.id = pc.thread_id
              JOIN public.workflow_posts wp ON wp.id = pct.post_id AND wp.conta_id = pct.conta_id
             WHERE pc.id = mencoes.host_id AND pct.conta_id = mencoes.conta_id)
          WHEN 'tarefa_comentario' THEN EXISTS (
            SELECT 1 FROM public.tarefa_comentarios tc
             WHERE tc.id = mencoes.host_id AND tc.conta_id = mencoes.conta_id
               AND tc.author_id = auth.uid())
          ELSE false
        END
    AND ((SELECT public.my_client_scope_all())
         OR CASE host_type
              WHEN 'tarefa' THEN EXISTS (SELECT 1 FROM public.tarefas t WHERE t.id = mencoes.host_id)
              WHEN 'workflow_post' THEN EXISTS (SELECT 1 FROM public.workflow_posts wp WHERE wp.id = mencoes.host_id)
              WHEN 'post_comment' THEN EXISTS (SELECT 1 FROM public.post_comments pc WHERE pc.id = mencoes.host_id)
              WHEN 'tarefa_comentario' THEN EXISTS (SELECT 1 FROM public.tarefa_comentarios tc WHERE tc.id = mencoes.host_id)
              ELSE false
            END)
  );

-- -------------------------------------------------------------
-- 3. ideias (tenant em workspace_id) e filhas
-- -------------------------------------------------------------
ALTER POLICY ideias_select ON public.ideias
  USING (
    workspace_id IN (SELECT public.get_my_conta_id())
    AND ((SELECT public.my_client_scope_all())
         OR public.can_access_cliente(cliente_id)
         OR autor_membro_id = ANY ((SELECT public.my_membro_ids())::bigint[]))
  );
ALTER POLICY ideias_update ON public.ideias
  USING (
    workspace_id IN (SELECT public.get_my_conta_id())
    AND ((SELECT public.my_client_scope_all())
         OR public.can_access_cliente(cliente_id)
         OR autor_membro_id = ANY ((SELECT public.my_membro_ids())::bigint[]))
  )
  WITH CHECK (
    workspace_id IN (SELECT public.get_my_conta_id())
    AND ((SELECT public.my_client_scope_all())
         OR public.can_access_cliente(cliente_id)
         OR autor_membro_id = ANY ((SELECT public.my_membro_ids())::bigint[]))
  );
ALTER POLICY ideias_insert ON public.ideias
  WITH CHECK (
    workspace_id IN (SELECT public.get_my_conta_id())
    AND ((SELECT public.my_client_scope_all()) OR public.can_access_cliente(cliente_id))
  );
ALTER POLICY ideias_delete ON public.ideias
  USING (
    workspace_id IN (SELECT public.get_my_conta_id())
    AND ((SELECT public.my_client_scope_all()) OR public.can_access_cliente(cliente_id))
  );

ALTER POLICY ideia_files_tenant_all ON public.ideia_files
  USING (
    conta_id IN (SELECT public.get_my_conta_id())
    AND ((SELECT public.my_client_scope_all())
         OR EXISTS (SELECT 1 FROM public.ideias i WHERE i.id = ideia_files.ideia_id))
  )
  WITH CHECK (
    conta_id IN (SELECT public.get_my_conta_id())
    AND ((SELECT public.my_client_scope_all())
         OR EXISTS (SELECT 1 FROM public.ideias i WHERE i.id = ideia_files.ideia_id))
  );
CREATE POLICY ideia_files_scope_delete ON public.ideia_files
  AS RESTRICTIVE FOR DELETE TO authenticated
  USING (
    (SELECT public.my_client_scope_all())
    OR EXISTS (SELECT 1 FROM public.ideias i
                WHERE i.id = ideia_files.ideia_id AND public.can_access_cliente(i.cliente_id))
  );

-- Reações: leitura, INSERT e UPDATE já seguem a ideia visível (o qual atual
-- consulta ideias, que agora é escopada). DELETE estrito, como as filhas sem autor.
CREATE POLICY ideia_reactions_scope_delete ON public.ideia_reactions
  AS RESTRICTIVE FOR DELETE TO authenticated
  USING (
    (SELECT public.my_client_scope_all())
    OR EXISTS (SELECT 1 FROM public.ideias i
                WHERE i.id = ideia_reactions.ideia_id AND public.can_access_cliente(i.cliente_id))
  );

-- -------------------------------------------------------------
-- 4. Linha editorial: estrita
-- -------------------------------------------------------------
ALTER POLICY linhas_editoriais_select ON public.linhas_editoriais
  USING (
    conta_id IN (SELECT public.get_my_conta_id())
    AND ((SELECT public.my_client_scope_all()) OR public.can_access_cliente(cliente_id))
  );
ALTER POLICY linhas_editoriais_insert ON public.linhas_editoriais
  WITH CHECK (
    conta_id IN (SELECT public.get_my_conta_id())
    AND public.effective_plan_feature(conta_id, 'feature_linha_editorial')
    AND ((SELECT public.my_client_scope_all()) OR public.can_access_cliente(cliente_id))
  );
ALTER POLICY linhas_editoriais_update ON public.linhas_editoriais
  USING (
    conta_id IN (SELECT public.get_my_conta_id())
    AND public.effective_plan_feature(conta_id, 'feature_linha_editorial')
    AND ((SELECT public.my_client_scope_all()) OR public.can_access_cliente(cliente_id))
  )
  WITH CHECK (
    conta_id IN (SELECT public.get_my_conta_id())
    AND public.effective_plan_feature(conta_id, 'feature_linha_editorial')
    AND ((SELECT public.my_client_scope_all()) OR public.can_access_cliente(cliente_id))
  );
ALTER POLICY linhas_editoriais_delete ON public.linhas_editoriais
  USING (
    conta_id IN (SELECT public.get_my_conta_id())
    AND public.effective_plan_feature(conta_id, 'feature_linha_editorial')
    AND ((SELECT public.my_client_scope_all()) OR public.can_access_cliente(cliente_id))
  );

-- Itens e respostas pela linha visível (que é estrita, então visível = acessível).
ALTER POLICY linha_editorial_itens_select ON public.linha_editorial_itens
  USING (
    conta_id IN (SELECT public.get_my_conta_id())
    AND ((SELECT public.my_client_scope_all())
         OR EXISTS (SELECT 1 FROM public.linhas_editoriais l WHERE l.id = linha_editorial_itens.linha_id))
  );
ALTER POLICY linha_editorial_itens_insert ON public.linha_editorial_itens
  WITH CHECK (
    conta_id IN (SELECT public.get_my_conta_id())
    AND public.effective_plan_feature(conta_id, 'feature_linha_editorial')
    AND ((SELECT public.my_client_scope_all())
         OR EXISTS (SELECT 1 FROM public.linhas_editoriais l WHERE l.id = linha_editorial_itens.linha_id))
  );
ALTER POLICY linha_editorial_itens_update ON public.linha_editorial_itens
  USING (
    conta_id IN (SELECT public.get_my_conta_id())
    AND public.effective_plan_feature(conta_id, 'feature_linha_editorial')
    AND ((SELECT public.my_client_scope_all())
         OR EXISTS (SELECT 1 FROM public.linhas_editoriais l WHERE l.id = linha_editorial_itens.linha_id))
  )
  WITH CHECK (
    conta_id IN (SELECT public.get_my_conta_id())
    AND public.effective_plan_feature(conta_id, 'feature_linha_editorial')
    AND ((SELECT public.my_client_scope_all())
         OR EXISTS (SELECT 1 FROM public.linhas_editoriais l WHERE l.id = linha_editorial_itens.linha_id))
  );
ALTER POLICY linha_editorial_itens_delete ON public.linha_editorial_itens
  USING (
    conta_id IN (SELECT public.get_my_conta_id())
    AND public.effective_plan_feature(conta_id, 'feature_linha_editorial')
    AND ((SELECT public.my_client_scope_all())
         OR EXISTS (SELECT 1 FROM public.linhas_editoriais l WHERE l.id = linha_editorial_itens.linha_id))
  );

ALTER POLICY linha_editorial_respostas_select ON public.linha_editorial_respostas
  USING (
    conta_id IN (SELECT public.get_my_conta_id())
    AND ((SELECT public.my_client_scope_all())
         OR EXISTS (SELECT 1 FROM public.linhas_editoriais l WHERE l.id = linha_editorial_respostas.linha_id))
  );
ALTER POLICY linha_editorial_respostas_insert ON public.linha_editorial_respostas
  WITH CHECK (
    conta_id IN (SELECT public.get_my_conta_id())
    AND public.effective_plan_feature(conta_id, 'feature_linha_editorial')
    AND is_workspace_user
    AND author_user_id = (SELECT auth.uid())
    AND acao = 'comentario'
    AND ((SELECT public.my_client_scope_all())
         OR EXISTS (SELECT 1 FROM public.linhas_editoriais l WHERE l.id = linha_editorial_respostas.linha_id))
  );
ALTER POLICY linha_editorial_respostas_update ON public.linha_editorial_respostas
  USING (
    conta_id IN (SELECT public.get_my_conta_id())
    AND public.effective_plan_feature(conta_id, 'feature_linha_editorial')
    AND ((SELECT public.my_client_scope_all())
         OR EXISTS (SELECT 1 FROM public.linhas_editoriais l WHERE l.id = linha_editorial_respostas.linha_id))
  )
  WITH CHECK (
    conta_id IN (SELECT public.get_my_conta_id())
    AND public.effective_plan_feature(conta_id, 'feature_linha_editorial')
    AND ((SELECT public.my_client_scope_all())
         OR EXISTS (SELECT 1 FROM public.linhas_editoriais l WHERE l.id = linha_editorial_respostas.linha_id))
  );
ALTER POLICY linha_editorial_respostas_delete ON public.linha_editorial_respostas
  USING (
    conta_id IN (SELECT public.get_my_conta_id())
    AND public.effective_plan_feature(conta_id, 'feature_linha_editorial')
    AND ((SELECT public.my_client_scope_all())
         OR EXISTS (SELECT 1 FROM public.linhas_editoriais l WHERE l.id = linha_editorial_respostas.linha_id))
  );

-- -------------------------------------------------------------
-- 5. Contexto (marca e briefing): leitura por can_see_cliente_context,
--    escrita estrita
-- -------------------------------------------------------------
ALTER POLICY briefings_select ON public.briefings
  USING (
    conta_id IN (SELECT public.get_my_conta_id())
    AND ((SELECT public.my_client_scope_all()) OR public.can_see_cliente_context(cliente_id))
  );
ALTER POLICY briefings_insert ON public.briefings
  WITH CHECK (
    conta_id IN (SELECT public.get_my_conta_id())
    AND ((SELECT public.my_client_scope_all()) OR public.can_access_cliente(cliente_id))
  );
ALTER POLICY briefings_update ON public.briefings
  USING (
    conta_id IN (SELECT public.get_my_conta_id())
    AND ((SELECT public.my_client_scope_all()) OR public.can_access_cliente(cliente_id))
  )
  WITH CHECK (
    conta_id IN (SELECT public.get_my_conta_id())
    AND ((SELECT public.my_client_scope_all()) OR public.can_access_cliente(cliente_id))
  );
ALTER POLICY briefings_delete ON public.briefings
  USING (
    conta_id IN (SELECT public.get_my_conta_id())
    AND ((SELECT public.my_client_scope_all()) OR public.can_access_cliente(cliente_id))
  );

ALTER POLICY hub_briefing_questions_select ON public.hub_briefing_questions
  USING (
    conta_id IN (SELECT public.get_my_conta_id())
    AND ((SELECT public.my_client_scope_all()) OR public.can_see_cliente_context(cliente_id))
  );
ALTER POLICY hub_briefing_questions_insert ON public.hub_briefing_questions
  WITH CHECK (
    conta_id IN (SELECT public.get_my_conta_id())
    AND ((SELECT public.my_client_scope_all()) OR public.can_access_cliente(cliente_id))
  );
ALTER POLICY hub_briefing_questions_update ON public.hub_briefing_questions
  USING (
    conta_id IN (SELECT public.get_my_conta_id())
    AND ((SELECT public.my_client_scope_all()) OR public.can_access_cliente(cliente_id))
  )
  WITH CHECK (
    conta_id IN (SELECT public.get_my_conta_id())
    AND ((SELECT public.my_client_scope_all()) OR public.can_access_cliente(cliente_id))
  );
ALTER POLICY hub_briefing_questions_delete ON public.hub_briefing_questions
  USING (
    conta_id IN (SELECT public.get_my_conta_id())
    AND ((SELECT public.my_client_scope_all()) OR public.can_access_cliente(cliente_id))
  );

-- hub_brand / hub_brand_files (sem conta_id; tenant pelo cliente). O USING
-- consultava clientes sob a RLS, que esconde o cliente de contexto: passa a usar
-- cliente_in_active_conta (mesmo resultado). FOR ALL: o USING de contexto
-- valeria também para UPDATE e DELETE, então as RESTRICTIVE os deixam estritos.
ALTER POLICY hub_brand_workspace_all ON public.hub_brand
  USING (
    public.cliente_in_active_conta(cliente_id)
    AND ((SELECT public.my_client_scope_all()) OR public.can_see_cliente_context(cliente_id))
  )
  WITH CHECK (
    cliente_id IN (SELECT clientes.id FROM public.clientes
                    WHERE clientes.conta_id IN (SELECT public.get_my_conta_id()))
    AND ((SELECT public.my_client_scope_all()) OR public.can_access_cliente(cliente_id))
  );
CREATE POLICY hub_brand_scope_update ON public.hub_brand
  AS RESTRICTIVE FOR UPDATE TO authenticated
  USING ((SELECT public.my_client_scope_all()) OR public.can_access_cliente(cliente_id));
CREATE POLICY hub_brand_scope_delete ON public.hub_brand
  AS RESTRICTIVE FOR DELETE TO authenticated
  USING ((SELECT public.my_client_scope_all()) OR public.can_access_cliente(cliente_id));

ALTER POLICY hub_brand_files_workspace_all ON public.hub_brand_files
  USING (
    public.cliente_in_active_conta(cliente_id)
    AND ((SELECT public.my_client_scope_all()) OR public.can_see_cliente_context(cliente_id))
  )
  WITH CHECK (
    cliente_id IN (SELECT clientes.id FROM public.clientes
                    WHERE clientes.conta_id IN (SELECT public.get_my_conta_id()))
    AND ((SELECT public.my_client_scope_all()) OR public.can_access_cliente(cliente_id))
  );
CREATE POLICY hub_brand_files_scope_update ON public.hub_brand_files
  AS RESTRICTIVE FOR UPDATE TO authenticated
  USING ((SELECT public.my_client_scope_all()) OR public.can_access_cliente(cliente_id));
CREATE POLICY hub_brand_files_scope_delete ON public.hub_brand_files
  AS RESTRICTIVE FOR DELETE TO authenticated
  USING ((SELECT public.my_client_scope_all()) OR public.can_access_cliente(cliente_id));

-- Páginas do Hub: não são contexto, estritas.
ALTER POLICY hub_pages_workspace_all ON public.hub_pages
  USING (
    conta_id IN (SELECT public.get_my_conta_id())
    AND ((SELECT public.my_client_scope_all()) OR public.can_access_cliente(cliente_id))
  )
  WITH CHECK (
    conta_id IN (SELECT public.get_my_conta_id())
    AND ((SELECT public.my_client_scope_all()) OR public.can_access_cliente(cliente_id))
  );

-- -------------------------------------------------------------
-- 6. Contexto do item dele em cliente oculto: + ideias e tarefa_series
-- -------------------------------------------------------------
-- Corpo de 20261115000003 mais a ideia de autoria dele (autor_membro_id) e a
-- série dele (responsável ou autor). CREATE OR REPLACE mantém o ACL.
CREATE OR REPLACE FUNCTION public.can_see_cliente_context(p_cliente_id bigint)
RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid   uuid := auth.uid();
  v_conta uuid;
  v_ids   bigint[];
BEGIN
  IF public.can_access_cliente(p_cliente_id) THEN RETURN true; END IF;
  IF p_cliente_id IS NULL OR v_uid IS NULL THEN RETURN false; END IF;
  v_conta := public.get_my_conta_id();
  IF v_conta IS NULL THEN RETURN false; END IF;
  v_ids := public.my_membro_ids();
  RETURN EXISTS (
      SELECT 1 FROM public.workflow_posts wp
       WHERE wp.cliente_id = p_cliente_id AND wp.conta_id = v_conta
         AND wp.responsavel_id = ANY (v_ids)
    ) OR EXISTS (
      SELECT 1 FROM public.workflow_etapas e
        JOIN public.workflows w ON w.id = e.workflow_id
       WHERE w.cliente_id = p_cliente_id AND w.conta_id = v_conta
         AND e.responsavel_id = ANY (v_ids)
    ) OR EXISTS (
      SELECT 1 FROM public.post_process_steps s
        JOIN public.post_processes pp ON pp.id = s.process_id AND pp.conta_id = s.conta_id
        JOIN public.workflow_posts wp ON wp.id = pp.post_id AND wp.conta_id = pp.conta_id
       WHERE wp.cliente_id = p_cliente_id AND s.conta_id = v_conta
         AND s.responsavel_id = ANY (v_ids)
    ) OR EXISTS (
      SELECT 1 FROM public.tarefas t
       WHERE t.cliente_id = p_cliente_id AND t.conta_id = v_conta
         AND (t.responsavel_id = ANY (v_ids) OR t.user_id = v_uid)
    ) OR EXISTS (
      SELECT 1 FROM public.tarefa_series ts
       WHERE ts.cliente_id = p_cliente_id AND ts.conta_id = v_conta
         AND (ts.responsavel_id = ANY (v_ids) OR ts.user_id = v_uid)
    ) OR EXISTS (
      SELECT 1 FROM public.ideias i
       WHERE i.cliente_id = p_cliente_id AND i.workspace_id = v_conta
         AND i.autor_membro_id = ANY (v_ids)
    );
END;
$$;

-- -------------------------------------------------------------
-- 7. RPCs SECURITY DEFINER que escrevem nestas tabelas
-- -------------------------------------------------------------
-- São o único caminho de escrita de tarefa_series, dos comentários e do fluxo da
-- linha editorial, e não passam pela RLS. Cada uma ganha o escopo logo depois da
-- leitura da linha, com as regras das policies acima:
--   * séries: criar e excluir estritos (can_access_cliente); editar, pausar,
--     retomar e encerrar valem também para a série/ocorrência dele num cliente
--     oculto, sem realocar; série ou tarefa que ele não vê responde com o mesmo
--     erro de inexistente, para não confirmar ids;
--   * tarefa_comentario_enviar: segue a tarefa visível (tarefa_not_found);
--   * linha editorial: estrita (nao_encontrada); apagar coluna do workspace só
--     para quem vê todos os clientes.
-- Corpo de cada uma = definição atual (pg_proc) + as checagens marcadas;
-- CREATE OR REPLACE mantém o ACL. O "é dele" vai em coalesce(..., false):
-- responsavel_id NULL deixaria o NOT (...) NULL e a checagem passaria em branco. my_client_scope_all() é true para
-- auth.uid() NULL, então service role e cron não mudam.

CREATE OR REPLACE FUNCTION public.tarefa_serie_criar(p_serie jsonb, p_tarefa jsonb, p_tag_ids bigint[], p_subtarefas text[], p_tarefa_id bigint DEFAULT NULL::bigint)
 RETURNS TABLE(serie_id bigint, tarefa_id bigint)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_conta uuid := get_my_conta_id();
  v_user uuid := auth.uid();
  v_hoje date := tarefa_hoje_sp();
  v_inicio date;
  v_fim date;
  v_resp bigint;
  v_cli bigint;
  v_tags bigint[];
  v_subs text[];
  v_titulo text;
  v_descricao text;
  v_rich jsonb;
  v_dias int[];
  v_existing record;
  v_serie_id bigint;
  v_tarefa_id bigint;
BEGIN
  IF v_conta IS NULL OR v_user IS NULL THEN RAISE EXCEPTION 'Sessao sem workspace ativo.'; END IF;

  v_inicio := (p_tarefa->>'data_limite')::date;
  IF v_inicio IS NULL THEN RAISE EXCEPTION 'Tarefas de uma série precisam de prazo.'; END IF;
  IF v_inicio < v_hoje THEN RAISE EXCEPTION 'Para repetir, o prazo precisa ser hoje ou depois.'; END IF;
  v_fim := (p_serie->>'fim')::date;
  IF v_fim IS NOT NULL AND v_fim < v_inicio THEN
    RAISE EXCEPTION 'A data final precisa ser igual ou depois do prazo.';
  END IF;

  v_resp := (p_tarefa->>'responsavel_id')::bigint;
  v_cli := (p_tarefa->>'cliente_id')::bigint;
  PERFORM tarefa_serie_validar_refs(v_conta, v_resp, v_cli);
  SELECT coalesce(array_agg(t.id ORDER BY t.id), '{}') INTO v_tags
    FROM tarefa_tags t WHERE t.id = ANY (coalesce(p_tag_ids, '{}')) AND t.conta_id = v_conta;
  -- blank / NULL entries are dropped (same filter as the promotion path below),
  -- so they never reach tarefa_series_subtarefas_chk as a raw 23514
  SELECT coalesce(array_agg(u.t ORDER BY u.o), '{}') INTO v_subs
    FROM unnest(coalesce(p_subtarefas, '{}')) WITH ORDINALITY AS u(t, o)
   WHERE btrim(u.t) <> '';
  v_titulo := btrim(coalesce(p_tarefa->>'titulo', ''));
  v_descricao := NULLIF(btrim(coalesce(p_tarefa->>'descricao', '')), '');
  v_rich := NULLIF(p_tarefa->'descricao_rich', 'null'::jsonb);
  v_dias := tarefa_serie_parse_dias_semana(p_serie->'dias_semana');

  -- RETURNS TABLE (serie_id, tarefa_id) makes `serie_id` and `tarefa_id`
  -- plpgsql variables, and plpgsql.variable_conflict defaults to `error`.
  -- Every bare column reference to those names below is therefore
  -- table-qualified (t.serie_id, st.tarefa_id, l.tarefa_id); the aliases are
  -- load-bearing, not style.
  IF p_tarefa_id IS NOT NULL THEN
    -- promotion: lock first, then validate
    SELECT t.id, t.serie_id, t.status, t.cliente_id, t.responsavel_id, t.user_id INTO v_existing
      FROM tarefas t WHERE t.id = p_tarefa_id AND t.conta_id = v_conta FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Tarefa não encontrada neste workspace.'; END IF;
    -- escopo de cliente: tarefa que o restrito não vê fica não confirmada
    IF NOT public.my_client_scope_all()
       AND NOT (public.can_access_cliente(v_existing.cliente_id)
                OR coalesce(v_existing.responsavel_id = ANY (public.my_membro_ids()), false)
                OR v_existing.user_id = v_user) THEN
      RAISE EXCEPTION 'Tarefa não encontrada neste workspace.';
    END IF;
    -- a promoção grava cliente_id = v_cli: tirar a tarefa do cliente de origem exige acesso a ele
    IF NOT public.my_client_scope_all()
       AND v_cli IS DISTINCT FROM v_existing.cliente_id
       AND NOT public.can_access_cliente(v_existing.cliente_id) THEN
      RAISE EXCEPTION 'client_scope_restricted' USING ERRCODE = '42501';
    END IF;
    IF v_existing.serie_id IS NOT NULL THEN RAISE EXCEPTION 'Esta tarefa já pertence a uma série.'; END IF;
    IF v_existing.status = 'concluida' THEN RAISE EXCEPTION 'Reabra a tarefa para torná-la recorrente.'; END IF;
    SELECT coalesce(array_agg(st.titulo ORDER BY st.ordem, st.id), '{}') INTO v_subs
      FROM subtarefas st WHERE st.tarefa_id = p_tarefa_id AND btrim(st.titulo) <> '';
  END IF;

  -- criar série é estrito: o restrito só cria num cliente que ele acessa (nunca sem cliente)
  IF NOT public.my_client_scope_all() AND NOT public.can_access_cliente(v_cli) THEN
    RAISE EXCEPTION 'client_scope_restricted' USING ERRCODE = '42501';
  END IF;

  INSERT INTO tarefa_series (conta_id, user_id, freq, intervalo, dias_semana, dia_mes, mes, modo, inicio, fim,
                             titulo, descricao, descricao_rich, responsavel_id, cliente_id, tag_ids, subtarefas)
  VALUES (v_conta, v_user, p_serie->>'freq', coalesce((p_serie->>'intervalo')::int, 1),
          v_dias,
          (p_serie->>'dia_mes')::int, (p_serie->>'mes')::int, p_serie->>'modo', v_inicio, v_fim,
          v_titulo, v_descricao, v_rich, v_resp, v_cli, v_tags, to_jsonb(v_subs))
  RETURNING id INTO v_serie_id;

  IF p_tarefa_id IS NULL THEN
    INSERT INTO tarefas (conta_id, user_id, titulo, descricao, descricao_rich, status,
                         responsavel_id, cliente_id, data_limite, serie_id)
    VALUES (v_conta, v_user, v_titulo, v_descricao, v_rich, 'pendente', v_resp, v_cli, v_inicio, v_serie_id)
    RETURNING id INTO v_tarefa_id;
    INSERT INTO subtarefas (tarefa_id, conta_id, titulo, concluida, ordem)
    SELECT v_tarefa_id, v_conta, s.t, false, (s.o - 1)::int
      FROM unnest(v_subs) WITH ORDINALITY AS s(t, o);
  ELSE
    v_tarefa_id := p_tarefa_id;
    UPDATE tarefas t
       SET titulo = v_titulo, descricao = v_descricao, descricao_rich = v_rich,
           status = coalesce(p_tarefa->>'status', t.status),
           responsavel_id = v_resp, cliente_id = v_cli, data_limite = v_inicio, serie_id = v_serie_id
     WHERE t.id = p_tarefa_id;
    DELETE FROM tarefa_tag_links l WHERE l.tarefa_id = p_tarefa_id;
  END IF;

  INSERT INTO tarefa_tag_links (tarefa_id, tag_id, conta_id)
  SELECT v_tarefa_id, tg, v_conta FROM unnest(v_tags) tg;

  -- plpgsql assignments to the OUT columns (not SQL): unaffected by the rule above
  serie_id := v_serie_id;
  tarefa_id := v_tarefa_id;
  RETURN NEXT;
END;
$function$;

CREATE OR REPLACE FUNCTION public.tarefa_serie_aplicar_edicao(p_tarefa_id bigint, p_tarefa jsonb, p_tag_ids bigint[], p_regra jsonb, p_encerrar boolean DEFAULT false)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_conta uuid := get_my_conta_id();
  v_user uuid := auth.uid();
  v_t record;
  v_s record;
  v_data date;
  v_fim date;
  v_resp bigint;
  v_cli bigint;
  v_tags bigint[];
  v_subs text[];
  v_titulo text;
  v_descricao text;
  v_rich jsonb;
  v_dias int[];
BEGIN
  IF v_conta IS NULL OR v_user IS NULL THEN RAISE EXCEPTION 'Sessao sem workspace ativo.'; END IF;

  -- (0) lock the occurrence and the series; effective due date up front
  SELECT id, serie_id, data_limite, cliente_id, responsavel_id, user_id INTO v_t
    FROM tarefas WHERE id = p_tarefa_id AND conta_id = v_conta FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Tarefa não encontrada neste workspace.'; END IF;
  IF NOT public.my_client_scope_all()
     AND NOT (public.can_access_cliente(v_t.cliente_id)
                OR coalesce(v_t.responsavel_id = ANY (public.my_membro_ids()), false)
                OR v_t.user_id = v_user) THEN
    RAISE EXCEPTION 'Tarefa não encontrada neste workspace.';
  END IF;
  IF v_t.serie_id IS NULL THEN RAISE EXCEPTION 'Esta tarefa não pertence a uma série.'; END IF;
  SELECT cliente_id, responsavel_id, user_id INTO v_s
    FROM tarefa_series WHERE id = v_t.serie_id AND conta_id = v_conta FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Série não encontrada neste workspace.'; END IF;
  -- a edição reescreve o modelo da série: a série também tem de ser visível
  IF NOT public.my_client_scope_all()
     AND NOT (public.can_access_cliente(v_s.cliente_id)
                OR coalesce(v_s.responsavel_id = ANY (public.my_membro_ids()), false)
                OR v_s.user_id = v_user) THEN
    RAISE EXCEPTION 'Série não encontrada neste workspace.';
  END IF;
  -- Effective due date. An OMITTED key keeps the stored value. A key present
  -- with JSON null is an explicit "clear the prazo": honoured only when the
  -- occurrence is being detached from the series (p_encerrar, "Nao repete"),
  -- because a series occurrence must have a prazo; otherwise it raises.
  IF p_tarefa ? 'data_limite' THEN
    v_data := (p_tarefa->>'data_limite')::date;
  ELSE
    v_data := v_t.data_limite;
  END IF;
  IF v_data IS NULL AND NOT p_encerrar THEN
    RAISE EXCEPTION 'Tarefas de uma série precisam de prazo.';
  END IF;

  v_resp := (p_tarefa->>'responsavel_id')::bigint;
  v_cli := (p_tarefa->>'cliente_id')::bigint;
  PERFORM tarefa_serie_validar_refs(v_conta, v_resp, v_cli);
  -- item dele: editar sim, realocar nunca (origem e destino acessíveis), nem se
  -- pôr como responsável num cliente que ele não acessa
  IF NOT public.my_client_scope_all() THEN
    IF (v_cli IS DISTINCT FROM v_t.cliente_id
          AND NOT (public.can_access_cliente(v_t.cliente_id) AND public.can_access_cliente(v_cli)))
       OR (NOT p_encerrar AND v_cli IS DISTINCT FROM v_s.cliente_id
          AND NOT (public.can_access_cliente(v_s.cliente_id) AND public.can_access_cliente(v_cli)))
       OR (v_resp IS DISTINCT FROM v_t.responsavel_id AND coalesce(v_resp = ANY (public.my_membro_ids()), false)
          AND NOT public.can_access_cliente(v_cli)) THEN
      RAISE EXCEPTION 'client_scope_restricted' USING ERRCODE = '42501';
    END IF;
  END IF;
  SELECT coalesce(array_agg(t.id ORDER BY t.id), '{}') INTO v_tags
    FROM tarefa_tags t WHERE t.id = ANY (coalesce(p_tag_ids, '{}')) AND t.conta_id = v_conta;
  SELECT coalesce(array_agg(titulo ORDER BY ordem, id), '{}') INTO v_subs
    FROM subtarefas WHERE tarefa_id = p_tarefa_id AND btrim(titulo) <> '';
  v_titulo := btrim(coalesce(p_tarefa->>'titulo', ''));
  v_descricao := NULLIF(btrim(coalesce(p_tarefa->>'descricao', '')), '');
  v_rich := NULLIF(p_tarefa->'descricao_rich', 'null'::jsonb);

  -- (1) series first, so the completion trigger in (2) sees the new template / closed series
  IF p_encerrar THEN
    UPDATE tarefa_series SET encerrada_em = coalesce(encerrada_em, now()) WHERE id = v_t.serie_id;
  ELSE
    v_fim := (p_regra->>'fim')::date;
    v_dias := tarefa_serie_parse_dias_semana(p_regra->'dias_semana');
    IF v_fim IS NOT NULL AND v_fim < v_data THEN
      RAISE EXCEPTION 'A data final precisa ser igual ou depois do prazo.';
    END IF;
    UPDATE tarefa_series
       SET freq = p_regra->>'freq',
           intervalo = coalesce((p_regra->>'intervalo')::int, 1),
           dias_semana = v_dias,
           dia_mes = (p_regra->>'dia_mes')::int,
           mes = (p_regra->>'mes')::int,
           modo = p_regra->>'modo',
           inicio = v_data,          -- re-anchors the phase; dia_mes/mes come from p_regra
           fim = v_fim,
           titulo = v_titulo, descricao = v_descricao, descricao_rich = v_rich,
           responsavel_id = v_resp, cliente_id = v_cli,
           tag_ids = v_tags, subtarefas = to_jsonb(v_subs)
     WHERE id = v_t.serie_id;
  END IF;

  -- (2) the occurrence (status included: the completion trigger fires here).
  -- In the p_encerrar branch serie_id = NULL and a NULL data_limite land in the
  -- same UPDATE, so tarefas_serie_exige_prazo (serie_id IS NULL OR data_limite
  -- IS NOT NULL) is satisfied: the row is a standalone task by then.
  UPDATE tarefas
     SET titulo = v_titulo, descricao = v_descricao, descricao_rich = v_rich,
         status = coalesce(p_tarefa->>'status', status),
         responsavel_id = v_resp, cliente_id = v_cli, data_limite = v_data,
         serie_id = CASE WHEN p_encerrar THEN NULL ELSE serie_id END
   WHERE id = p_tarefa_id;

  -- (3) tags of this occurrence; its subtasks are untouched
  DELETE FROM tarefa_tag_links WHERE tarefa_id = p_tarefa_id;
  INSERT INTO tarefa_tag_links (tarefa_id, tag_id, conta_id)
  SELECT p_tarefa_id, t, v_conta FROM unnest(v_tags) t;

  -- (4) an ao_concluir series whose last occurrence is already completed and
  -- whose rule / fim / modo just changed would otherwise stay dormant: the
  -- completion trigger only fires on the status transition. No-op when an open
  -- occurrence exists, the series is paused or ended, or the next date is past fim.
  IF NOT p_encerrar THEN
    PERFORM tarefa_serie_garantir_aberta(v_t.serie_id, v_data);
  END IF;
END;
$function$;

CREATE OR REPLACE FUNCTION public.tarefa_serie_definir_estado(p_serie_id bigint, p_estado text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_conta uuid := get_my_conta_id();
  v_user uuid := auth.uid();
  v_encerrada timestamptz;
  v_s record;
BEGIN
  IF v_conta IS NULL OR v_user IS NULL THEN RAISE EXCEPTION 'Sessao sem workspace ativo.'; END IF;
  IF p_estado NOT IN ('pausar', 'retomar', 'encerrar') THEN RAISE EXCEPTION 'Estado inválido.'; END IF;
  SELECT encerrada_em, cliente_id, responsavel_id, user_id INTO v_s
    FROM tarefa_series WHERE id = p_serie_id AND conta_id = v_conta FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Série não encontrada neste workspace.'; END IF;
  -- pausar/retomar/encerrar é edição: vale também a série dele num cliente oculto
  IF NOT public.my_client_scope_all()
     AND NOT (public.can_access_cliente(v_s.cliente_id)
                OR coalesce(v_s.responsavel_id = ANY (public.my_membro_ids()), false)
                OR v_s.user_id = v_user) THEN
    RAISE EXCEPTION 'Série não encontrada neste workspace.';
  END IF;
  v_encerrada := v_s.encerrada_em;
  IF v_encerrada IS NOT NULL THEN RAISE EXCEPTION 'Esta série já foi encerrada.'; END IF;
  IF p_estado = 'pausar' THEN
    UPDATE tarefa_series SET pausada = true WHERE id = p_serie_id;
  ELSIF p_estado = 'retomar' THEN
    UPDATE tarefa_series SET pausada = false WHERE id = p_serie_id;   -- guard + apos_retomar do the rest
  ELSE
    UPDATE tarefa_series SET encerrada_em = now() WHERE id = p_serie_id;
  END IF;
END;
$function$;

CREATE OR REPLACE FUNCTION public.tarefa_serie_excluir(p_serie_id bigint)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_conta uuid := get_my_conta_id();
  v_user uuid := auth.uid();
  v_s record;
BEGIN
  IF v_conta IS NULL OR v_user IS NULL THEN RAISE EXCEPTION 'Sessao sem workspace ativo.'; END IF;
  -- Lock order: ALL occurrences (completed ones included, no status filter),
  -- then the series row: the same tarefas -> series order as
  -- tarefa_serie_aplicar_edicao and the completion/delete triggers. The final
  -- DELETE of the series fires ON DELETE SET NULL, an UPDATE on EVERY
  -- occurrence, completed ones too; without this pre-lock, excluir (series ->
  -- tarefas) can cycle with an edit of a completed occurrence (tarefas -> series)
  -- and die with 40P01. Precedent: 20260830000004_post_detach_attach_rpcs.sql.
  -- Accepted residual: an occurrence spawned after this SELECT and locked by a
  -- third session before the DELETE still resolves through Postgres' own 40P01
  -- deadlock detection, which is acceptable for such a narrow window.
  PERFORM t.id FROM tarefas t
   WHERE t.serie_id = p_serie_id AND t.conta_id = v_conta
   ORDER BY t.id FOR UPDATE;
  SELECT cliente_id, responsavel_id, user_id INTO v_s
    FROM tarefa_series WHERE id = p_serie_id AND conta_id = v_conta FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Série não encontrada neste workspace.'; END IF;
  -- excluir é estrito: série que ele não vê fica não confirmada; a dele num
  -- cliente oculto é recusada
  IF NOT public.my_client_scope_all() THEN
    IF NOT (public.can_access_cliente(v_s.cliente_id)
                OR coalesce(v_s.responsavel_id = ANY (public.my_membro_ids()), false)
                OR v_s.user_id = v_user) THEN
      RAISE EXCEPTION 'Série não encontrada neste workspace.';
    END IF;
    IF NOT public.can_access_cliente(v_s.cliente_id) THEN
      RAISE EXCEPTION 'client_scope_restricted' USING ERRCODE = '42501';
    END IF;
  END IF;
  -- mandatory order: end (disarms the delete trigger) -> delete open -> delete series
  UPDATE tarefa_series SET encerrada_em = coalesce(encerrada_em, now()) WHERE id = p_serie_id;
  DELETE FROM tarefas WHERE serie_id = p_serie_id AND conta_id = v_conta AND status <> 'concluida';
  DELETE FROM tarefa_series WHERE id = p_serie_id;   -- FK SET NULL unlinks the completed ones
END;
$function$;

CREATE OR REPLACE FUNCTION public.tarefa_comentario_enviar(p_tarefa_id bigint, p_conteudo text)
 RETURNS tarefa_comentarios
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid         uuid := auth.uid();
  t             tarefas;
  v_conteudo    text;
  v_row         tarefa_comentarios;
  v_mencionados uuid[];
  v_author_name text;
  v_meta        jsonb;
BEGIN
  SELECT * INTO t FROM tarefas WHERE id = p_tarefa_id;
  IF v_uid IS NULL
     OR t.id IS NULL
     OR t.conta_id IS DISTINCT FROM (SELECT get_my_conta_id())
     OR NOT EXISTS (
       SELECT 1 FROM workspace_members wm
        WHERE wm.workspace_id = t.conta_id AND wm.user_id = v_uid
     ) THEN
    RAISE EXCEPTION 'tarefa_not_found' USING ERRCODE = 'P0002';
  END IF;
  -- o comentário segue a tarefa visível (cliente acessível ou tarefa dele);
  -- a oculta responde como inexistente
  IF NOT public.my_client_scope_all()
     AND NOT (public.can_access_cliente(t.cliente_id)
                OR coalesce(t.responsavel_id = ANY (public.my_membro_ids()), false)
                OR t.user_id = v_uid) THEN
    RAISE EXCEPTION 'tarefa_not_found' USING ERRCODE = 'P0002';
  END IF;

  v_conteudo := COALESCE(btrim(p_conteudo), '');
  IF v_conteudo = '' THEN
    RAISE EXCEPTION 'content_empty' USING ERRCODE = '22023';
  END IF;
  IF char_length(v_conteudo) > 4000 THEN
    RAISE EXCEPTION 'content_too_long' USING ERRCODE = '22023';
  END IF;

  INSERT INTO tarefa_comentarios (conta_id, tarefa_id, author_id, conteudo)
  VALUES (t.conta_id, t.id, v_uid, v_conteudo)
  RETURNING * INTO v_row;

  PERFORM sync_mentions('tarefa_comentario', v_row.id,
                        post_discussao_membro_ids(v_conteudo, t.conta_id));

  BEGIN
    -- Users behind the membros mencoes actually kept for this comment.
    SELECT COALESCE(array_agg(DISTINCT mb.crm_user_id), '{}'::uuid[])
      INTO v_mencionados
      FROM mencoes me
      JOIN membros mb ON mb.id = me.mentioned_membro_id AND mb.conta_id = t.conta_id
     WHERE me.host_type = 'tarefa_comentario'
       AND me.host_id = v_row.id
       AND mb.crm_user_id IS NOT NULL;

    SELECT COALESCE(mb.nome, p.nome, 'Equipe') INTO v_author_name
      FROM auth.users u
      LEFT JOIN membros mb ON mb.crm_user_id = v_uid AND mb.conta_id = t.conta_id
      LEFT JOIN profiles p ON p.id = v_uid
     WHERE u.id = v_uid
     LIMIT 1;
    v_author_name := COALESCE(v_author_name, 'Equipe');

    v_meta := jsonb_strip_nulls(jsonb_build_object(
      'task_id',     t.id::text,
      'task_title',  t.titulo,
      'author_name', v_author_name,
      'authors',     jsonb_build_array(v_author_name),
      'count',       1,
      -- Same token replacement as trg_post_comments_discussao_insert (20261025000003).
      'preview',     left(
        regexp_replace(
          v_conteudo,
          '@\[([^\]]+)\]\((membro|post|cliente|tarefa):[0-9:]+\)',
          '@\1',
          'g'
        ),
        280
      )
    ));

    INSERT INTO notifications (workspace_id, user_id, type, metadata, link)
    SELECT t.conta_id, d.user_id, 'task_comment', v_meta,
           '/tarefas?tarefa=' || t.id || '&comentarios=1'
      FROM (
        SELECT unnest(resolve_notification_targets(t.conta_id, t.responsavel_id, NULL)) AS user_id
        UNION
        SELECT t.user_id
        UNION
        SELECT tc.author_id
          FROM tarefa_comentarios tc
         WHERE tc.tarefa_id = t.id
           AND tc.conta_id = t.conta_id
           AND tc.id <> v_row.id
           AND tc.author_id IS NOT NULL
      ) d
     WHERE d.user_id IS NOT NULL
       AND d.user_id <> v_uid
       AND d.user_id <> ALL (v_mencionados)
       AND EXISTS (
         SELECT 1 FROM workspace_members wm
          WHERE wm.workspace_id = t.conta_id AND wm.user_id = d.user_id
       )
    ON CONFLICT (user_id, ((metadata->>'task_id')))
      WHERE type = 'task_comment' AND read_at IS NULL AND dismissed_at IS NULL
      DO UPDATE SET
        metadata = EXCLUDED.metadata || jsonb_build_object(
          'count', COALESCE((notifications.metadata->>'count')::int, 1) + 1,
          -- Latest author first, then earlier distinct authors, at most 3.
          'authors', (
            SELECT COALESCE(jsonb_agg(a.nome ORDER BY a.ord), '[]'::jsonb)
              FROM (
                SELECT x.nome, x.ord
                  FROM (
                    SELECT v_author_name AS nome, 0::bigint AS ord
                    UNION ALL
                    SELECT e.nome, e.ord
                      FROM jsonb_array_elements_text(
                             COALESCE(notifications.metadata->'authors', '[]'::jsonb)
                           ) WITH ORDINALITY AS e(nome, ord)
                     WHERE e.nome <> v_author_name
                  ) x
                 ORDER BY x.ord
                 LIMIT 3
              ) a
          )
        ),
        created_at = now();
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'tarefa_comentario_enviar notification failed: % %', SQLERRM, SQLSTATE;
  END;

  RETURN v_row;
END;
$function$;

CREATE OR REPLACE FUNCTION public.linha_editorial_criar(p_cliente_id bigint, p_periodo date)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_conta   uuid := public.get_my_conta_id();
  v_periodo date;
  v_id      uuid;
BEGIN
  IF v_conta IS NULL OR NOT public.effective_plan_feature(v_conta, 'feature_linha_editorial') THEN
    RAISE EXCEPTION 'feature_disabled:feature_linha_editorial' USING ERRCODE = 'P0001';
  END IF;
  IF p_periodo IS NULL THEN
    RAISE EXCEPTION 'periodo_invalido' USING ERRCODE = 'P0001';
  END IF;
  v_periodo := date_trunc('month', p_periodo)::date;

  IF NOT EXISTS (SELECT 1 FROM public.clientes c WHERE c.id = p_cliente_id AND c.conta_id = v_conta)
     OR NOT (public.my_client_scope_all() OR public.can_access_cliente(p_cliente_id)) THEN
    RAISE EXCEPTION 'nao_encontrada' USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO public.linhas_editoriais (conta_id, cliente_id, periodo, created_by)
  VALUES (v_conta, p_cliente_id, v_periodo, auth.uid())
  ON CONFLICT (conta_id, cliente_id, periodo) DO NOTHING
  RETURNING id INTO v_id;
  IF v_id IS NULL THEN
    SELECT l.id INTO v_id FROM public.linhas_editoriais l
     WHERE l.conta_id = v_conta AND l.cliente_id = p_cliente_id AND l.periodo = v_periodo;
  END IF;

  -- ON CONFLICT on the normalized-name index makes two concurrent first calls seed once.
  IF NOT EXISTS (SELECT 1 FROM public.linha_editorial_colunas WHERE conta_id = v_conta) THEN
    INSERT INTO public.linha_editorial_colunas (conta_id, nome, tipo, config, ordem)
    VALUES
      (v_conta, 'Pilar', 'select', jsonb_build_object('options', jsonb_build_array(
         jsonb_build_object('id', gen_random_uuid()::text, 'label', 'Educação',   'color', '#3b82f6'),
         jsonb_build_object('id', gen_random_uuid()::text, 'label', 'Autoridade', 'color', '#8b5cf6'),
         jsonb_build_object('id', gen_random_uuid()::text, 'label', 'Bastidores', 'color', '#f59e0b'),
         jsonb_build_object('id', gen_random_uuid()::text, 'label', 'Conexão',    'color', '#ec4899'))), 0),
      (v_conta, 'CTA', 'select', jsonb_build_object('options', jsonb_build_array(
         jsonb_build_object('id', gen_random_uuid()::text, 'label', 'Salvar',       'color', '#22c55e'),
         jsonb_build_object('id', gen_random_uuid()::text, 'label', 'Comentar',     'color', '#06b6d4'),
         jsonb_build_object('id', gen_random_uuid()::text, 'label', 'Compartilhar', 'color', '#f97316'),
         jsonb_build_object('id', gen_random_uuid()::text, 'label', 'Seguir',       'color', '#94a3b8'))), 1),
      (v_conta, 'Referência', 'url', '{}'::jsonb, 2)
    ON CONFLICT (conta_id, public.linha_nome_norm(nome)) DO NOTHING;
  END IF;

  RETURN v_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.linha_editorial_enviar(p_linha_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_conta  uuid := public.get_my_conta_id();
  v_status text;
  v_cli    bigint;
BEGIN
  IF v_conta IS NULL OR NOT public.effective_plan_feature(v_conta, 'feature_linha_editorial') THEN
    RAISE EXCEPTION 'feature_disabled:feature_linha_editorial' USING ERRCODE = 'P0001';
  END IF;

  SELECT l.status, l.cliente_id INTO v_status, v_cli FROM public.linhas_editoriais l
   WHERE l.id = p_linha_id AND l.conta_id = v_conta
   FOR UPDATE;
  IF NOT FOUND OR NOT (public.my_client_scope_all() OR public.can_access_cliente(v_cli)) THEN
    RAISE EXCEPTION 'nao_encontrada' USING ERRCODE = 'P0001';
  END IF;
  IF v_status NOT IN ('rascunho', 'ajustes', 'aprovada') THEN
    RAISE EXCEPTION 'status_invalido' USING ERRCODE = 'P0001';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.linha_editorial_itens i WHERE i.linha_id = p_linha_id) THEN
    RAISE EXCEPTION 'linha_vazia' USING ERRCODE = 'P0001';
  END IF;

  -- (new) Approvals carry over to the next round; ajustes go back to pending.
  UPDATE public.linha_editorial_itens
     SET aprovacao = NULL, aprovacao_at = NULL
   WHERE linha_id = p_linha_id AND aprovacao = 'ajustes';

  UPDATE public.linhas_editoriais
     SET status = 'enviada', enviada_at = now(), enviada_por = auth.uid(), rodada = rodada + 1
   WHERE id = p_linha_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.linha_editorial_recolher(p_linha_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_conta  uuid := public.get_my_conta_id();
  v_status text;
  v_cli    bigint;
BEGIN
  IF v_conta IS NULL OR NOT public.effective_plan_feature(v_conta, 'feature_linha_editorial') THEN
    RAISE EXCEPTION 'feature_disabled:feature_linha_editorial' USING ERRCODE = 'P0001';
  END IF;

  SELECT l.status, l.cliente_id INTO v_status, v_cli FROM public.linhas_editoriais l
   WHERE l.id = p_linha_id AND l.conta_id = v_conta
   FOR UPDATE;
  IF NOT FOUND OR NOT (public.my_client_scope_all() OR public.can_access_cliente(v_cli)) THEN
    RAISE EXCEPTION 'nao_encontrada' USING ERRCODE = 'P0001';
  END IF;
  IF v_status <> 'enviada' THEN
    RAISE EXCEPTION 'status_invalido' USING ERRCODE = 'P0001';
  END IF;

  UPDATE public.linhas_editoriais SET status = 'rascunho' WHERE id = p_linha_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.linha_editorial_converter(p_linha_id uuid, p_workflow_id bigint, p_posts jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_conta    uuid := public.get_my_conta_id();
  v_user     uuid := auth.uid();
  v_cliente  bigint;
  v_wf_cli   bigint;
  v_wf_conta uuid;
  v_template bigint;
  v_base     integer := 0;
  v_ids      uuid[];
  v_n        integer;
  v_locked   integer;
  v_post     bigint;
  v_out      jsonb := '[]'::jsonb;
  r          record;
BEGIN
  IF v_conta IS NULL OR NOT public.effective_plan_feature(v_conta, 'feature_linha_editorial') THEN
    RAISE EXCEPTION 'feature_disabled:feature_linha_editorial' USING ERRCODE = 'P0001';
  END IF;

  SELECT l.cliente_id INTO v_cliente FROM public.linhas_editoriais l
   WHERE l.id = p_linha_id AND l.conta_id = v_conta
   FOR UPDATE;
  IF NOT FOUND OR NOT (public.my_client_scope_all() OR public.can_access_cliente(v_cliente)) THEN
    RAISE EXCEPTION 'nao_encontrada' USING ERRCODE = 'P0001';
  END IF;

  -- Payload shape: a non-empty array of objects, each with a distinct uuid item_id, an object
  -- or null conteudo and an array or null property_values.
  IF p_posts IS NULL OR jsonb_typeof(p_posts) <> 'array' OR jsonb_array_length(p_posts) = 0
     OR EXISTS (SELECT 1 FROM jsonb_array_elements(p_posts) e
                 WHERE jsonb_typeof(e) <> 'object'
                    OR coalesce(e->>'item_id', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                    OR coalesce(jsonb_typeof(e->'conteudo'), 'null') NOT IN ('object', 'null')
                    OR coalesce(jsonb_typeof(e->'property_values'), 'null') NOT IN ('array', 'null')) THEN
    RAISE EXCEPTION 'payload_invalido' USING ERRCODE = 'P0001';
  END IF;
  SELECT array_agg(DISTINCT (e->>'item_id')::uuid), count(*) INTO v_ids, v_n
    FROM jsonb_array_elements(p_posts) e;
  IF cardinality(v_ids) <> v_n
     OR (SELECT count(*) FROM public.linha_editorial_itens i
          WHERE i.linha_id = p_linha_id AND i.id = ANY (v_ids)) <> v_n THEN
    RAISE EXCEPTION 'payload_invalido' USING ERRCODE = 'P0001';
  END IF;

  -- Same conta and same client as the linha: for a fluxo, post_a0_sync_cliente takes the
  -- post's cliente_id from the workflow, so this check is what keeps the client right.
  IF p_workflow_id IS NOT NULL THEN
    SELECT w.cliente_id, w.conta_id, w.template_id INTO v_wf_cli, v_wf_conta, v_template
      FROM public.workflows w WHERE w.id = p_workflow_id
      FOR SHARE;
    IF NOT FOUND OR v_wf_conta IS DISTINCT FROM v_conta OR v_wf_cli IS DISTINCT FROM v_cliente THEN
      RAISE EXCEPTION 'workflow_invalido' USING ERRCODE = 'P0001';
    END IF;
  END IF;

  -- Every definition must belong to the workflow's template (avulso posts have none), and a
  -- post names each definition once.
  IF EXISTS (
    SELECT 1
      FROM jsonb_array_elements(p_posts) e,
           jsonb_array_elements(coalesce(nullif(e->'property_values', 'null'::jsonb), '[]'::jsonb)) pv
     WHERE jsonb_typeof(pv) <> 'object'
        OR coalesce(pv->>'property_definition_id', '') !~ '^[0-9]{1,18}$'
        OR v_template IS NULL
        OR NOT EXISTS (SELECT 1 FROM public.template_property_definitions d
                        WHERE d.id = (pv->>'property_definition_id')::bigint
                          AND d.template_id = v_template AND d.conta_id = v_conta))
     OR EXISTS (
    SELECT 1
      FROM jsonb_array_elements(p_posts) e,
           jsonb_array_elements(coalesce(nullif(e->'property_values', 'null'::jsonb), '[]'::jsonb)) pv
     GROUP BY e->>'item_id', pv->>'property_definition_id'
    HAVING count(*) > 1) THEN
    RAISE EXCEPTION 'propriedade_invalida' USING ERRCODE = 'P0001';
  END IF;

  -- Lock the items, then refuse any already converted. A row released by a post delete
  -- (post_id back to null) converts again. The membership count above ran before the lock,
  -- so count again under it: a row deleted in between must fail the whole batch.
  PERFORM 1 FROM public.linha_editorial_itens i
   WHERE i.linha_id = p_linha_id AND i.id = ANY (v_ids) ORDER BY i.id FOR UPDATE;
  GET DIAGNOSTICS v_locked = ROW_COUNT;
  IF v_locked <> v_n THEN
    RAISE EXCEPTION 'payload_invalido' USING ERRCODE = 'P0001';
  END IF;
  IF EXISTS (SELECT 1 FROM public.linha_editorial_itens i WHERE i.id = ANY (v_ids) AND i.post_id IS NOT NULL) THEN
    RAISE EXCEPTION 'ja_convertido' USING ERRCODE = 'P0001';
  END IF;

  IF p_workflow_id IS NOT NULL THEN
    -- After the last post of the fluxo; an empty fluxo starts at 0.
    SELECT coalesce(max(p.ordem), -1) INTO v_base FROM public.workflow_posts p WHERE p.workflow_id = p_workflow_id;
  END IF;

  FOR r IN
    SELECT i.id, i.titulo, i.tipo, i.data, e.elem,
           row_number() OVER (ORDER BY i.data NULLS LAST, i.ordem, i.created_at, i.id) AS rn
      FROM public.linha_editorial_itens i
      JOIN jsonb_array_elements(p_posts) AS e(elem) ON (e.elem->>'item_id')::uuid = i.id
     ORDER BY rn
  LOOP
    INSERT INTO public.workflow_posts
      (conta_id, workflow_id, cliente_id, titulo, tipo, status, ordem, scheduled_at,
       conteudo, conteudo_plain, created_via)
    VALUES
      (v_conta, p_workflow_id, v_cliente, r.titulo, r.tipo, 'rascunho',
       CASE WHEN p_workflow_id IS NULL THEN 0 ELSE v_base + r.rn::integer END,
       CASE WHEN r.data IS NULL THEN NULL ELSE (r.data + time '10:00') AT TIME ZONE 'America/Sao_Paulo' END,
       nullif(r.elem->'conteudo', 'null'::jsonb), coalesce(r.elem->>'conteudo_plain', ''), 'linha_editorial')
    RETURNING id INTO v_post;

    INSERT INTO public.post_property_values (post_id, property_definition_id, value)
    SELECT v_post, (pv->>'property_definition_id')::bigint, pv->'value'
      FROM jsonb_array_elements(coalesce(nullif(r.elem->'property_values', 'null'::jsonb), '[]'::jsonb)) pv;

    UPDATE public.linha_editorial_itens
       SET post_id = v_post, convertido_at = now(), convertido_por = v_user
     WHERE id = r.id;

    v_out := v_out || jsonb_build_array(jsonb_build_object('item_id', r.id, 'post_id', v_post));
  END LOOP;

  RETURN v_out;
END;
$function$;

CREATE OR REPLACE FUNCTION public.linha_editorial_coluna_excluir(p_coluna_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_conta uuid := public.get_my_conta_id();
BEGIN
  IF v_conta IS NULL OR NOT public.effective_plan_feature(v_conta, 'feature_linha_editorial') THEN
    RAISE EXCEPTION 'feature_disabled:feature_linha_editorial' USING ERRCODE = 'P0001';
  END IF;
  -- a coluna é do workspace e apagar tira o valor dela de todas as linhas, inclusive
  -- as de clientes que o restrito não acessa: só quem vê todos os clientes
  IF NOT public.my_client_scope_all() THEN
    RAISE EXCEPTION 'client_scope_restricted' USING ERRCODE = '42501';
  END IF;

  DELETE FROM public.linha_editorial_colunas c WHERE c.id = p_coluna_id AND c.conta_id = v_conta;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'nao_encontrada' USING ERRCODE = 'P0001';
  END IF;

  UPDATE public.linha_editorial_itens i
     SET valores = i.valores - p_coluna_id::text
   WHERE i.conta_id = v_conta
     AND i.post_id IS NULL
     AND i.valores ? p_coluna_id::text;
END;
$function$;
