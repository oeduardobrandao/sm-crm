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
