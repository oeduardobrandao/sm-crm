-- Acesso por cliente, Migração C4 (agenda, analytics e relatórios): a agenda,
-- as contas e o histórico do Instagram e do TikTok, os relatórios, os tokens do
-- Hub, os links de conexão, as mensagens do cliente e as automações de
-- comentário respeitam o escopo do membro.
--
-- Agenda (agenda_eventos é raiz de item):
--   leitura  = <qual atual> AND ((SELECT my_client_scope_all()) OR can_access_cliente(cliente_id) OR <é dele>)
--   "é dele" = organizador ou participante (agenda_pode_ver_evento(id, true,
--              organizador_id): com privado = true o helper DEFINER existente
--              responde exatamente "organizador ou participante", sem recursão
--              entre agenda_eventos e agenda_participantes). Evento sem cliente:
--              só pelo "é dele".
--   Ocorrências, participantes e respostas já seguem o evento visível (EXISTS no
--   pai), sem mudança.
--   authenticated só tem SELECT nas tabelas da agenda: a escrita é das RPCs
--   SECURITY DEFINER. Por isso o escopo de escrita fica nelas e em triggers:
--     * criar: estrito pelo trigger zz_client_scope_guard (cliente que ele
--       acessa; sem cliente, só quem vê todos);
--     * editar e resolver remarcação: só evento visível (senão "não existe
--       mais"); mover (cliente_id, inclusive para NULL) exige acesso à origem e
--       ao destino (trigger; origem sem cliente só se o evento é dele); a cópia
--       'seguintes' do evento dele num cliente oculto fica no mesmo cliente;
--     * excluir (todos os escopos): estrito, cliente que ele acessa ou evento sem
--       cliente que ele organiza;
--     * organizador imutável (libera o "é dele"); um restrito não se põe como
--       participante de evento de cliente que ele não acessa (trigger
--       zz_client_scope_guard em agenda_participantes).
--   agenda_eventos NÃO entra em can_see_cliente_context: o contexto da spec é
--   marca, briefing e identidade do item dele; um convite de agenda não abre a
--   marca do cliente. agenda_listar devolve o nome do cliente oculto só pelo
--   contexto (can_see_cliente_context).
-- Analytics, relatórios, tokens, links, mensagens, automações: estritos pelo
--   cliente da linha ou do pai, sem "é dele" (report_documents.created_by e
--   instagram_comment_analyses.analyzed_by não contam). Filhas que já consultam
--   o pai pela FK (instagram_posts, histórico, cache, tags, tiktok_posts,
--   histórico do TikTok) herdam sem mudança; as que só olhavam conta_id ganham
--   o EXISTS no pai com can_access_cliente.
-- analytics_reports: o restrito só grava caminho de arquivo (storage_path,
--   html_storage_path) dentro de reports/<conta>/<cliente da linha>/ e conta do
--   Instagram do mesmo cliente (as edges assinam o caminho gravado).
-- report_documents.layout: o restrito só referencia imagem visível pela origem
--   (file_visible_at_source), senão report_document_files levaria um arquivo
--   oculto para um relatório visível (o PDF e o editor o mostram).
-- RPCs SECURITY DEFINER chamáveis por authenticated (corpo = pg_proc + as linhas
--   marcadas [escopo]; CREATE OR REPLACE mantém o ACL): agenda_listar,
--   agenda_evento_editar, agenda_evento_excluir, agenda_remarcacao_resolver,
--   get_mensagens_conversas/feed/unread (só o ramo com usuário; o do Hub não
--   muda), hub_token_extend, hub_token_rotate.
-- O termo (SELECT my_client_scope_all()) vem primeiro: é um initplan, então o
-- membro irrestrito não paga can_access_cliente nem o EXISTS por linha.
-- Spec: docs/superpowers/specs/2026-11-03-acesso-por-cliente-design.md
-- Inventário: docs/superpowers/plans/2026-11-03-acesso-por-cliente-inventario.md

-- -------------------------------------------------------------
-- 0. Guardas
-- -------------------------------------------------------------
-- Raiz agenda_eventos. As RPCs gravam sem RLS, então este trigger é o que barra:
--   * organizador_id imutável para usuário logado (libera o "é dele"); ir a
--     NULL é o ON DELETE SET NULL do usuário;
--   * para o restrito, INSERT só num cliente que ele acessa (nunca sem cliente),
--     exceto a cópia 'seguintes' (serie_origem_id) que fica no cliente da série
--     de origem: é edição do evento, que a RPC já conferiu como visível;
--   * mudar cliente_id (inclusive para NULL, e a cópia que troca de cliente)
--     exige acesso à ORIGEM e ao DESTINO; origem sem cliente só se o evento é
--     dele (organizador ou participante). cliente_id que vira NULL porque o
--     cliente foi apagado (FK ON DELETE SET NULL) não é realocação.
-- Prefixo zz: roda depois de agenda_eventos_guard. auth.uid() NULL (service
-- role, cron, seed de demo) e membros irrestritos saem antes de qualquer leitura.
CREATE OR REPLACE FUNCTION public.guard_agenda_evento_scope()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid     uuid := auth.uid();
  v_src_id  bigint;
  v_src_cli bigint;
  v_src_org uuid;
BEGIN
  IF v_uid IS NULL THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND NEW.organizador_id IS NOT NULL
     AND NEW.organizador_id IS DISTINCT FROM OLD.organizador_id THEN
    RAISE EXCEPTION 'author_immutable' USING ERRCODE = '42501';
  END IF;
  -- Saída barata: quem não é restrito em nenhum workspace não paga nada mais.
  IF NOT EXISTS (
    SELECT 1 FROM public.workspace_members wm
     WHERE wm.user_id = v_uid AND wm.role <> 'owner' AND wm.client_scope = 'atribuidos'
  ) THEN
    RETURN NEW;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.workspace_members wm
     WHERE wm.workspace_id = NEW.conta_id AND wm.user_id = v_uid
       AND wm.role <> 'owner' AND wm.client_scope = 'atribuidos'
  ) THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.serie_origem_id IS NOT NULL THEN
      SELECT e.id, e.cliente_id, e.organizador_id INTO v_src_id, v_src_cli, v_src_org
        FROM public.agenda_eventos e
       WHERE e.id = NEW.serie_origem_id AND e.conta_id = NEW.conta_id;
    END IF;
    IF v_src_id IS NULL THEN
      IF NOT public.can_access_cliente(v_uid, NEW.conta_id, NEW.cliente_id) THEN
        RAISE EXCEPTION 'client_scope_restricted' USING ERRCODE = '42501';
      END IF;
      RETURN NEW;
    END IF;
  ELSE
    IF NEW.cliente_id IS NOT DISTINCT FROM OLD.cliente_id THEN RETURN NEW; END IF;
    IF NEW.cliente_id IS NULL
       AND NOT EXISTS (SELECT 1 FROM public.clientes c WHERE c.id = OLD.cliente_id) THEN
      RETURN NEW;
    END IF;
    v_src_id := OLD.id; v_src_cli := OLD.cliente_id; v_src_org := OLD.organizador_id;
  END IF;
  -- a cópia 'seguintes' no mesmo cliente da origem
  IF NEW.cliente_id IS NOT DISTINCT FROM v_src_cli THEN RETURN NEW; END IF;
  IF (v_src_cli IS NULL
      AND NOT (coalesce(v_src_org = v_uid, false)
               OR EXISTS (SELECT 1 FROM public.agenda_participantes ap
                           WHERE ap.evento_id = v_src_id AND ap.user_id = v_uid)))
     OR (v_src_cli IS NOT NULL AND NOT public.can_access_cliente(v_uid, NEW.conta_id, v_src_cli))
     OR NOT public.can_access_cliente(v_uid, NEW.conta_id, NEW.cliente_id) THEN
    RAISE EXCEPTION 'client_scope_restricted' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.guard_agenda_evento_scope() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.guard_agenda_evento_scope() TO service_role;

CREATE TRIGGER zz_client_scope_guard
  BEFORE INSERT OR UPDATE ON public.agenda_eventos
  FOR EACH ROW EXECUTE FUNCTION public.guard_agenda_evento_scope();

-- Participante = "é dele". O restrito não põe a si mesmo num evento de cliente
-- que ele não acessa (nem num evento sem cliente: tornaria o evento de outro
-- "dele"). Exceção: a cópia 'seguintes' de uma série de que ele já participa
-- (ou organiza) leva a linha dele junto. Outro membro (irrestrito) convidá-lo é
-- o caminho pretendido. As RPCs só convidam a partir de um evento que o
-- chamador pode editar (e portanto vê); isto cobre os caminhos DEFINER futuros.
CREATE OR REPLACE FUNCTION public.guard_agenda_participante_scope()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid    uuid := auth.uid();
  v_cli    bigint;
  v_origem bigint;
BEGIN
  IF v_uid IS NULL OR NEW.user_id IS DISTINCT FROM v_uid THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' THEN
    IF NEW.user_id IS NOT DISTINCT FROM OLD.user_id
       AND NEW.evento_id IS NOT DISTINCT FROM OLD.evento_id THEN
      RETURN NEW;
    END IF;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.workspace_members wm
     WHERE wm.workspace_id = NEW.conta_id AND wm.user_id = v_uid
       AND wm.role <> 'owner' AND wm.client_scope = 'atribuidos'
  ) THEN
    RETURN NEW;
  END IF;
  SELECT e.cliente_id, e.serie_origem_id INTO v_cli, v_origem
    FROM public.agenda_eventos e WHERE e.id = NEW.evento_id AND e.conta_id = NEW.conta_id;
  IF public.can_access_cliente(v_uid, NEW.conta_id, v_cli) THEN RETURN NEW; END IF;
  IF v_origem IS NOT NULL AND (
       EXISTS (SELECT 1 FROM public.agenda_eventos o
                WHERE o.id = v_origem AND o.organizador_id = v_uid)
       OR EXISTS (SELECT 1 FROM public.agenda_participantes ap
                   WHERE ap.evento_id = v_origem AND ap.user_id = v_uid)) THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'client_scope_restricted' USING ERRCODE = '42501';
END;
$$;
REVOKE ALL ON FUNCTION public.guard_agenda_participante_scope() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.guard_agenda_participante_scope() TO service_role;

CREATE TRIGGER zz_client_scope_guard
  BEFORE INSERT OR UPDATE OF user_id, evento_id ON public.agenda_participantes
  FOR EACH ROW EXECUTE FUNCTION public.guard_agenda_participante_scope();

-- Imagens do layout do relatório: report_document_files_sync (DEFINER) liga
-- toda imagem do layout que seja arquivo do workspace, e o editor e o PDF a
-- mostram a quem vê o relatório. O restrito só acrescenta imagem visível pela
-- ORIGEM (file_visible_at_source: upload dele ou pasta de cliente que ele
-- acessa; nunca um caminho emprestado). Imagens que já estavam no layout
-- continuam (reordenar e tirar não são barrados). Mesmo filtro do sync: o que
-- ele ignora (outro workspace, tipo errado) não é conferido. auth.uid() NULL
-- (report-docs, service role) e membros irrestritos saem antes.
CREATE OR REPLACE FUNCTION public.guard_report_layout_files()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_old bigint[] := '{}';
BEGIN
  IF v_uid IS NULL THEN RETURN NEW; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.workspace_members wm
     WHERE wm.workspace_id = NEW.conta_id AND wm.user_id = v_uid
       AND wm.role <> 'owner' AND wm.client_scope = 'atribuidos'
  ) THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND jsonb_typeof(OLD.layout -> 'blocks') = 'array' THEN
    SELECT coalesce(array_agg((b -> 'config' ->> 'file_id')::bigint), '{}') INTO v_old
      FROM jsonb_array_elements(OLD.layout -> 'blocks') AS b
     WHERE b ->> 'type' = 'image' AND jsonb_typeof(b -> 'config' -> 'file_id') = 'number';
  END IF;
  IF jsonb_typeof(NEW.layout -> 'blocks') = 'array' AND EXISTS (
       SELECT 1
         FROM jsonb_array_elements(NEW.layout -> 'blocks') AS b
         JOIN public.files f ON f.id = (b -> 'config' ->> 'file_id')::bigint
        WHERE b ->> 'type' = 'image'
          AND jsonb_typeof(b -> 'config' -> 'file_id') = 'number'
          AND f.conta_id = NEW.conta_id
          AND f.kind = 'image'
          AND f.mime_type IN ('image/jpeg', 'image/png', 'image/webp')
          AND NOT (f.id = ANY (v_old))
          AND NOT public.file_visible_at_source(f.id)) THEN
    RAISE EXCEPTION 'client_scope_restricted' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.guard_report_layout_files() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.guard_report_layout_files() TO service_role;

-- zz: depois de report_documents_validate_layout (layout já validado).
CREATE TRIGGER zz_client_scope_layout_guard
  BEFORE INSERT OR UPDATE OF layout ON public.report_documents
  FOR EACH ROW EXECUTE FUNCTION public.guard_report_layout_files();

-- Referências do relatório mensal (analytics_reports): authenticated tem
-- escrita direta (grant padrão do hosted), e as edges servem o arquivo pelo
-- caminho gravado na linha (instagram-analytics e hub-reports assinam
-- storage_path / html_storage_path). Como o caminho é previsível
-- (reports/<conta>/<cliente>/<mês>.pdf|.html), um restrito gravaria numa linha
-- do cliente A o caminho do PDF de B e baixaria o relatório oculto. Para o
-- restrito: os caminhos só dentro de reports/<conta>/<cliente da linha>/ (um
-- nível, sem '..'), e instagram_account_id só de uma conta do mesmo cliente.
-- auth.uid() NULL (geradores, cron) e membros irrestritos saem antes.
CREATE OR REPLACE FUNCTION public.guard_analytics_report_refs()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_dir text;
BEGIN
  IF v_uid IS NULL THEN RETURN NEW; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.workspace_members wm
     WHERE wm.workspace_id = NEW.conta_id AND wm.user_id = v_uid
       AND wm.role <> 'owner' AND wm.client_scope = 'atribuidos'
  ) THEN
    RETURN NEW;
  END IF;
  v_dir := 'reports/' || NEW.conta_id::text || '/' || coalesce(NEW.client_id::text, '-') || '/';
  -- no UPDATE só conta o que mudou (linhas antigas do gerador seguem editáveis)
  IF (NEW.storage_path IS NOT NULL
      AND (TG_OP = 'INSERT' OR NEW.storage_path IS DISTINCT FROM OLD.storage_path)
      AND (left(NEW.storage_path, length(v_dir)) <> v_dir
           OR position('/' IN substr(NEW.storage_path, length(v_dir) + 1)) > 0
           OR NEW.storage_path LIKE '%..%'))
     OR (NEW.html_storage_path IS NOT NULL
      AND (TG_OP = 'INSERT' OR NEW.html_storage_path IS DISTINCT FROM OLD.html_storage_path)
      AND (left(NEW.html_storage_path, length(v_dir)) <> v_dir
           OR position('/' IN substr(NEW.html_storage_path, length(v_dir) + 1)) > 0
           OR NEW.html_storage_path LIKE '%..%'))
     OR (NEW.instagram_account_id IS NOT NULL
      AND (TG_OP = 'INSERT' OR NEW.instagram_account_id IS DISTINCT FROM OLD.instagram_account_id
           OR NEW.client_id IS DISTINCT FROM OLD.client_id)
      AND NOT EXISTS (SELECT 1 FROM public.instagram_accounts ia
                       WHERE ia.id = NEW.instagram_account_id AND ia.client_id = NEW.client_id)) THEN
    RAISE EXCEPTION 'client_scope_restricted' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.guard_analytics_report_refs() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.guard_analytics_report_refs() TO service_role;

CREATE TRIGGER zz_client_scope_refs_guard
  BEFORE INSERT OR UPDATE ON public.analytics_reports
  FOR EACH ROW EXECUTE FUNCTION public.guard_analytics_report_refs();

-- -------------------------------------------------------------
-- 1. Agenda
-- -------------------------------------------------------------
ALTER POLICY agenda_eventos_select ON public.agenda_eventos
  USING (
    conta_id IN (SELECT public.get_my_conta_id())
    AND (SELECT public.has_permission('calendario', 'ver'))
    AND public.agenda_pode_ver_evento(id, privado, organizador_id)
    AND ((SELECT public.my_client_scope_all())
         OR public.can_access_cliente(cliente_id)
         OR public.agenda_pode_ver_evento(id, true, organizador_id))
  );

-- -------------------------------------------------------------
-- 2. Contas do Instagram e do TikTok (FOR ALL sem WITH CHECK até aqui)
-- -------------------------------------------------------------
ALTER POLICY accounts_conta ON public.instagram_accounts
  USING (
    client_id IN (SELECT c.id FROM public.clientes c
                   WHERE c.conta_id IN (SELECT profiles.conta_id FROM public.profiles
                                         WHERE profiles.id = auth.uid()))
    AND ((SELECT public.my_client_scope_all()) OR public.can_access_cliente(client_id))
  )
  WITH CHECK (
    client_id IN (SELECT c.id FROM public.clientes c
                   WHERE c.conta_id IN (SELECT profiles.conta_id FROM public.profiles
                                         WHERE profiles.id = auth.uid()))
    AND ((SELECT public.my_client_scope_all()) OR public.can_access_cliente(client_id))
  );

ALTER POLICY tiktok_accounts_conta ON public.tiktok_accounts
  USING (
    client_id IN (SELECT c.id FROM public.clientes c
                   WHERE c.conta_id IN (SELECT profiles.conta_id FROM public.profiles
                                         WHERE profiles.id = auth.uid()))
    AND ((SELECT public.my_client_scope_all()) OR public.can_access_cliente(client_id))
  )
  WITH CHECK (
    client_id IN (SELECT c.id FROM public.clientes c
                   WHERE c.conta_id IN (SELECT profiles.conta_id FROM public.profiles
                                         WHERE profiles.id = auth.uid()))
    AND ((SELECT public.my_client_scope_all()) OR public.can_access_cliente(client_id))
  );

-- Análise de comentários: segue a conta (analyzed_by não é "é dele").
ALTER POLICY instagram_comment_analyses_select ON public.instagram_comment_analyses
  USING (
    conta_id IN (SELECT public.get_my_conta_id())
    AND ((SELECT public.my_client_scope_all())
         OR EXISTS (SELECT 1 FROM public.instagram_accounts ia
                     WHERE ia.id = instagram_comment_analyses.instagram_account_id
                       AND public.can_access_cliente(ia.client_id)))
  );

-- -------------------------------------------------------------
-- 3. Automações de comentário e contatos
-- -------------------------------------------------------------
ALTER POLICY ica_select ON public.instagram_comment_automations
  USING (
    conta_id IN (SELECT public.get_my_conta_id())
    AND (SELECT public.has_permission('automacoes', 'ver'))
    AND ((SELECT public.my_client_scope_all()) OR public.can_access_cliente(client_id))
  );
ALTER POLICY ica_insert ON public.instagram_comment_automations
  WITH CHECK (
    conta_id IN (SELECT public.get_my_conta_id())
    AND (SELECT public.has_permission('automacoes', 'editar'))
    AND ((SELECT public.my_client_scope_all()) OR public.can_access_cliente(client_id))
  );
ALTER POLICY ica_update ON public.instagram_comment_automations
  USING (
    conta_id IN (SELECT public.get_my_conta_id())
    AND (SELECT public.has_permission('automacoes', 'editar'))
    AND ((SELECT public.my_client_scope_all()) OR public.can_access_cliente(client_id))
  )
  WITH CHECK (
    conta_id IN (SELECT public.get_my_conta_id())
    AND (SELECT public.has_permission('automacoes', 'editar'))
    AND ((SELECT public.my_client_scope_all()) OR public.can_access_cliente(client_id))
  );
ALTER POLICY ica_delete ON public.instagram_comment_automations
  USING (
    conta_id IN (SELECT public.get_my_conta_id())
    AND (SELECT public.has_permission('automacoes', 'editar'))
    AND ((SELECT public.my_client_scope_all()) OR public.can_access_cliente(client_id))
  );

ALTER POLICY ias_select ON public.instagram_automation_sends
  USING (
    conta_id IN (SELECT public.get_my_conta_id())
    AND ((SELECT public.my_client_scope_all())
         OR EXISTS (SELECT 1 FROM public.instagram_comment_automations a
                     WHERE a.id = instagram_automation_sends.automation_id
                       AND public.can_access_cliente(a.client_id)))
  );

ALTER POLICY iac_select ON public.instagram_automation_contacts
  USING (
    conta_id IN (SELECT public.get_my_conta_id())
    AND (SELECT public.has_permission('automacoes', 'ver'))
    AND ((SELECT public.my_client_scope_all()) OR public.can_access_cliente(client_id))
  );

ALTER POLICY iaca_select ON public.instagram_automation_contact_automations
  USING (
    conta_id IN (SELECT public.get_my_conta_id())
    AND (SELECT public.has_permission('automacoes', 'ver'))
    AND ((SELECT public.my_client_scope_all())
         OR EXISTS (SELECT 1 FROM public.instagram_automation_contacts ct
                     WHERE ct.id = instagram_automation_contact_automations.contact_id
                       AND public.can_access_cliente(ct.client_id)))
  );

-- -------------------------------------------------------------
-- 4. Relatórios
-- -------------------------------------------------------------
-- analytics_reports.client_id aceita NULL: sem cliente, só quem vê todos.
ALTER POLICY reports_conta_select ON public.analytics_reports
  USING (
    conta_id IN (SELECT public.get_my_conta_id())
    AND ((SELECT public.my_client_scope_all()) OR public.can_access_cliente(client_id))
  );
ALTER POLICY reports_conta_insert ON public.analytics_reports
  WITH CHECK (
    conta_id IN (SELECT public.get_my_conta_id())
    AND ((SELECT public.my_client_scope_all()) OR public.can_access_cliente(client_id))
  );
ALTER POLICY reports_conta_update ON public.analytics_reports
  USING (
    conta_id IN (SELECT public.get_my_conta_id())
    AND ((SELECT public.my_client_scope_all()) OR public.can_access_cliente(client_id))
  )
  WITH CHECK (
    conta_id IN (SELECT public.get_my_conta_id())
    AND ((SELECT public.my_client_scope_all()) OR public.can_access_cliente(client_id))
  );
ALTER POLICY reports_conta_delete ON public.analytics_reports
  USING (
    conta_id IN (SELECT public.get_my_conta_id())
    AND ((SELECT public.my_client_scope_all()) OR public.can_access_cliente(client_id))
  );

-- report_documents: created_by não é "é dele". authenticated só atualiza
-- title e layout (grant por coluna); o layout passa pela guarda acima.
ALTER POLICY report_documents_select ON public.report_documents
  USING (
    conta_id IN (SELECT public.get_my_conta_id())
    AND ((SELECT public.my_client_scope_all()) OR public.can_access_cliente(client_id))
  );
ALTER POLICY report_documents_update ON public.report_documents
  USING (
    conta_id IN (SELECT public.get_my_conta_id())
    AND ((SELECT public.my_client_scope_all()) OR public.can_access_cliente(client_id))
  )
  WITH CHECK (
    conta_id IN (SELECT public.get_my_conta_id())
    AND ((SELECT public.my_client_scope_all()) OR public.can_access_cliente(client_id))
  );

-- Vínculo de imagem: segue o relatório. Não abre o arquivo (a RLS de files não
-- consulta esta tabela).
ALTER POLICY report_document_files_tenant_select ON public.report_document_files
  USING (
    conta_id IN (SELECT public.get_my_conta_id())
    AND ((SELECT public.my_client_scope_all())
         OR EXISTS (SELECT 1 FROM public.report_documents r
                     WHERE r.id = report_document_files.report_id
                       AND public.can_access_cliente(r.client_id)))
  );

-- -------------------------------------------------------------
-- 5. Tokens do Hub, links de conexão do Instagram, mensagens do cliente
-- -------------------------------------------------------------
ALTER POLICY client_hub_tokens_workspace_all ON public.client_hub_tokens
  USING (
    conta_id IN (SELECT public.get_my_conta_id())
    AND ((SELECT public.my_client_scope_all()) OR public.can_access_cliente(cliente_id))
  )
  WITH CHECK (
    conta_id IN (SELECT public.get_my_conta_id())
    AND ((SELECT public.my_client_scope_all()) OR public.can_access_cliente(cliente_id))
  );

ALTER POLICY instagram_connect_links_workspace_all ON public.instagram_connect_links
  USING (
    conta_id IN (SELECT public.get_my_conta_id())
    AND EXISTS (SELECT 1 FROM public.clientes c
                 WHERE c.id = instagram_connect_links.cliente_id
                   AND c.conta_id = instagram_connect_links.conta_id)
    AND ((SELECT public.my_client_scope_all()) OR public.can_access_cliente(cliente_id))
  )
  WITH CHECK (
    conta_id IN (SELECT public.get_my_conta_id())
    AND EXISTS (SELECT 1 FROM public.clientes c
                 WHERE c.id = instagram_connect_links.cliente_id
                   AND c.conta_id = instagram_connect_links.conta_id)
    AND ((SELECT public.my_client_scope_all()) OR public.can_access_cliente(cliente_id))
  );

-- mensagens: sem "é dele" (author_user_id não conta).
ALTER POLICY mensagens_tenant_select ON public.mensagens
  USING (
    conta_id IN (SELECT public.get_my_conta_id())
    AND ((SELECT public.my_client_scope_all()) OR public.can_access_cliente(cliente_id))
  );
ALTER POLICY mensagens_tenant_insert ON public.mensagens
  WITH CHECK (
    conta_id IN (SELECT public.get_my_conta_id())
    AND is_workspace_user = true
    AND author_user_id = auth.uid()
    AND EXISTS (SELECT 1 FROM public.clientes c
                 WHERE c.id = mensagens.cliente_id AND c.conta_id = mensagens.conta_id)
    AND ((SELECT public.my_client_scope_all()) OR public.can_access_cliente(cliente_id))
  );

-- -------------------------------------------------------------
-- 6. RPCs SECURITY DEFINER chamáveis por authenticated
-- -------------------------------------------------------------
-- Corpo de cada uma = definição atual (pg_proc) + as linhas marcadas [escopo].
-- my_client_scope_all() é true para auth.uid() NULL, então service role, cron e
-- o caminho do Hub não mudam. agenda_evento_criar e agenda_responder não mudam:
-- criar é barrado pelo trigger de agenda_eventos; responder já exige ser
-- participante (é dele). agenda_feed_eventos (só service_role, token do membro)
-- já devolve só os eventos de que ele participa.

CREATE OR REPLACE FUNCTION public.agenda_listar(p_de timestamp with time zone DEFAULT NULL::timestamp with time zone, p_ate timestamp with time zone DEFAULT NULL::timestamp with time zone, p_ocorrencia_id bigint DEFAULT NULL::bigint)
 RETURNS TABLE(ocorrencia_id bigint, evento_id bigint, data_original date, inicio timestamp with time zone, fim timestamp with time zone, dia_inteiro boolean, data_inicio_local date, data_fim_local date, titulo text, descricao text, local text, link_reuniao text, tipo text, cor text, cliente_id bigint, cliente_nome text, privado boolean, mascarado boolean, recorrente boolean, regra jsonb, lembretes integer[], organizador_id uuid, participantes jsonb, minha_resposta text, pode_editar boolean, pode_responder boolean, tz text, compartilhado_cliente boolean, cliente_resposta text, remarcacao_pendente jsonb, sequencia integer, convidados jsonb)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
#variable_conflict use_column
DECLARE
  v_conta uuid;
  v_user uuid;
  v_editar boolean;
  v_role text;
  v_all boolean;  -- [escopo] vê todos os clientes (uma vez, não por linha)
  v_de timestamptz := p_de;
  v_ate timestamptz := p_ate;
BEGIN
  v_conta := get_my_conta_id(); v_user := auth.uid();
  IF v_conta IS NULL OR v_user IS NULL THEN RAISE EXCEPTION 'agenda: sessão sem workspace ativo'; END IF;
  -- flag off: no rows, no raise (stale clients and prefetches stay quiet)
  IF NOT public.effective_plan_feature(v_conta, 'feature_agenda') THEN RETURN; END IF;
  IF NOT public.has_permission('calendario', 'ver') THEN
    RAISE EXCEPTION 'agenda: você não pode ver a agenda';
  END IF;

  IF p_ocorrencia_id IS NOT NULL THEN
    SELECT o.inicio, o.fim INTO v_de, v_ate FROM public.agenda_ocorrencias o
     WHERE o.id = p_ocorrencia_id AND o.conta_id = v_conta AND NOT o.cancelada;
    IF NOT FOUND THEN RETURN; END IF;
  ELSIF v_de IS NULL OR v_ate IS NULL OR v_ate <= v_de OR v_ate - v_de > interval '100 days' THEN
    RAISE EXCEPTION 'agenda: período inválido';
  END IF;

  -- pode_editar: the rule of agenda_pode_editar (section 4), evaluated inline
  -- from the caller's permission and role computed once, instead of a
  -- non-inlinable DEFINER call per row. Keep both in sync.
  v_editar := public.has_permission('calendario', 'editar');
  SELECT wm.role::text INTO v_role FROM public.workspace_members wm
   WHERE wm.workspace_id = v_conta AND wm.user_id = v_user;
  v_all := public.my_client_scope_all();

  RETURN QUERY
  SELECT
    o.id, e.id, o.data_original,
    o.inicio, o.fim, e.dia_inteiro,
    (o.inicio AT TIME ZONE e.tz)::date,
    CASE WHEN e.dia_inteiro THEN (o.fim AT TIME ZONE e.tz)::date
         ELSE ((o.fim AT TIME ZONE e.tz) - interval '1 microsecond')::date + 1 END,
    CASE WHEN m.mascarado THEN 'Ocupado'
         WHEN 'titulo' = ANY (o.campos_sobrescritos) THEN o.titulo ELSE e.titulo END,
    CASE WHEN m.mascarado THEN NULL
         WHEN 'descricao' = ANY (o.campos_sobrescritos) THEN o.descricao ELSE e.descricao END,
    CASE WHEN m.mascarado THEN NULL
         WHEN 'local' = ANY (o.campos_sobrescritos) THEN o.local ELSE e.local END,
    CASE WHEN m.mascarado THEN NULL
         WHEN 'link_reuniao' = ANY (o.campos_sobrescritos) THEN o.link_reuniao ELSE e.link_reuniao END,
    CASE WHEN m.mascarado THEN NULL ELSE e.tipo END,
    CASE WHEN m.mascarado THEN NULL ELSE e.cor END,
    CASE WHEN m.mascarado THEN NULL ELSE e.cliente_id END,
    -- [escopo] o nome de um cliente que ele não acessa só pelo contexto
    CASE WHEN m.mascarado THEN NULL
         WHEN v_all OR public.can_see_cliente_context(e.cliente_id) THEN c.nome END,
    e.privado, m.mascarado, e.freq IS NOT NULL,
    CASE WHEN m.mascarado OR e.freq IS NULL THEN NULL
         ELSE jsonb_build_object('freq', e.freq, 'intervalo', e.intervalo, 'dias_semana', e.dias_semana,
                                 'mensal_modo', e.mensal_modo, 'mensal_ordinal', e.mensal_ordinal,
                                 'ate', e.ate, 'contagem', e.contagem) END,
    CASE WHEN m.mascarado THEN NULL ELSE e.lembretes END,
    e.organizador_id,
    coalesce((
      SELECT jsonb_agg(jsonb_build_object(
               'user_id', ap.user_id,
               'resposta', CASE WHEN m.mascarado THEN NULL ELSE coalesce(ar.resposta, ap.resposta) END)
             ORDER BY ap.user_id)
        FROM public.agenda_participantes ap
        JOIN public.workspace_members wm ON wm.user_id = ap.user_id AND wm.workspace_id = v_conta
        LEFT JOIN public.agenda_respostas ar ON ar.ocorrencia_id = o.id AND ar.user_id = ap.user_id
       WHERE ap.evento_id = e.id), '[]'::jsonb),
    CASE WHEN eu.user_id IS NULL THEN NULL ELSE coalesce(mr.resposta, eu.resposta) END,
    coalesce(v_editar AND (e.organizador_id = v_user OR (v_role IN ('owner', 'admin') AND NOT e.privado)), false),
    eu.user_id IS NOT NULL AND e.organizador_id IS DISTINCT FROM v_user,
    e.tz,
    -- [hub] the four appended columns
    CASE WHEN m.mascarado THEN NULL ELSE sh.compartilhado END,
    CASE WHEN NOT sh.compartilhado THEN NULL
         WHEN rc.resposta IS NOT NULL AND rc.inicio_respondido = o.inicio AND rc.cliente_id = e.cliente_id THEN rc.resposta
         ELSE 'aguardando' END,
    CASE WHEN NOT sh.compartilhado THEN NULL
         ELSE (SELECT jsonb_build_object('id', rm.id, 'inicio_sugerido', rm.inicio_sugerido,
                                         'fim_sugerido', rm.fim_sugerido, 'mensagem', rm.mensagem,
                                         'criado_em', rm.criado_em)
                 FROM public.agenda_remarcacoes rm
                WHERE rm.ocorrencia_id = o.id AND rm.status = 'pendente' AND rm.cliente_id = e.cliente_id) END,
    CASE WHEN m.mascarado THEN NULL ELSE o.sequencia END,
    -- [convidados] the active guests with their effective answer here
    CASE WHEN m.mascarado THEN NULL
         ELSE coalesce((
           SELECT jsonb_agg(jsonb_build_object(
                    'id', g.id, 'email', g.email, 'nome', g.nome,
                    'resposta', CASE WHEN rg.inicio_respondido = o.inicio THEN rg.resposta END)
                  ORDER BY g.id)
             FROM public.agenda_convidados g
             LEFT JOIN public.agenda_respostas_convidado rg ON rg.ocorrencia_id = o.id AND rg.convidado_id = g.id
            WHERE g.evento_id = e.id AND g.removido_em IS NULL), '[]'::jsonb) END
  FROM public.agenda_ocorrencias o
  JOIN public.agenda_eventos e ON e.id = o.evento_id AND e.conta_id = v_conta
  LEFT JOIN public.agenda_participantes eu ON eu.evento_id = e.id AND eu.user_id = v_user
  LEFT JOIN public.agenda_respostas mr ON mr.ocorrencia_id = o.id AND mr.user_id = v_user
  LEFT JOIN public.clientes c ON c.id = e.cliente_id AND c.conta_id = v_conta
  LEFT JOIN public.agenda_respostas_cliente rc ON rc.ocorrencia_id = o.id  -- [hub]
  CROSS JOIN LATERAL (
    SELECT (e.privado AND e.organizador_id IS DISTINCT FROM v_user AND eu.user_id IS NULL) AS mascarado
  ) m
  CROSS JOIN LATERAL (  -- [hub] effective sharing, never for a masked row
    SELECT (NOT m.mascarado AND e.compartilhado_cliente AND e.cliente_id IS NOT NULL) AS compartilhado
  ) sh
  WHERE o.conta_id = v_conta
    AND NOT o.cancelada
    AND o.inicio < v_ate AND o.fim > v_de AND o.inicio >= v_de - interval '31 days'
    AND (p_ocorrencia_id IS NULL OR o.id = p_ocorrencia_id)
    -- [escopo] cliente que ele acessa, ou evento dele (organizador ou participante)
    AND (v_all OR public.can_access_cliente(e.cliente_id)
         OR e.organizador_id = v_user OR eu.user_id IS NOT NULL)
  ORDER BY o.inicio, o.id;
END $function$;

CREATE OR REPLACE FUNCTION public.agenda_evento_editar(p_ocorrencia_id bigint, p_escopo text, p_evento jsonb, p_participantes uuid[] DEFAULT NULL::uuid[])
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_conta uuid;
  v_user uuid;
  v_o public.agenda_ocorrencias;
  v_e public.agenda_eventos;
  v_base public.agenda_eventos;
  v_novo public.agenda_eventos;
  v_escopo text;
  v_primeira boolean;
  v_tem_horario boolean;
  v_delta int;
  v_hoje date;
  v_h date;
  v_c date;
  v_datas date[];
  v_alvo bigint;          -- series that ends up holding the edited occurrence
  v_ret bigint;
  v_regen boolean := false;
  v_reset boolean := false;
  v_notifica boolean := false;
  v_regra_igual boolean;
  v_contagem int;
  v_add uuid[] := '{}';
  v_rem uuid[] := '{}';
  v_atuais uuid[];
  v_pedidos uuid[];
  v_campos text[];
  v_ini timestamptz; v_fim timestamptz;
  v_gen_ini timestamptz; v_gen_fim timestamptz;
  v_old_titulo text; v_old_local text; v_old_link text;
  v_destinatarios uuid[];
  v_cli_antes bigint;            -- [hub] cliente the series was shared with (NULL: not shared)
  v_cli_depois bigint;           -- [hub] same, after the edit (series v_alvo)
  v_antes jsonb := '[]'::jsonb;  -- [hub] affected future occurrences, before the edit
  v_convs_antes bigint[] := '{}';   -- [convidados] active guests of the series before the edit
  v_conv_add bigint[] := '{}';      -- [convidados] added by this edit (on v_alvo)
  v_conv_rem bigint[] := '{}';      -- [convidados] removed by this edit (on v_alvo)
  v_conv_manter bigint[] := '{}';   -- [convidados] active on v_alvo and not added now
  v_conv_n int;                     -- [convidados]
  v_antes_g jsonb := '[]'::jsonb;   -- [convidados] same as v_antes, guest snapshot (no 90-day bound)
  v_diff jsonb := '[]'::jsonb;      -- [convidados] the client's diff
  v_diff_g jsonb := '[]'::jsonb;    -- [convidados] the guests' diff
  v_snap jsonb;                     -- [convidados]
  v_snap_g jsonb;                   -- [convidados]
  v_cancel jsonb;                   -- [convidados] v_antes as 'cancelada'
  v_cancel_g jsonb;                 -- [convidados] v_antes_g as 'cancelada'
  v_envios jsonb := '[]'::jsonb;    -- [convidados] every e-mail of this write
BEGIN
  v_conta := get_my_conta_id(); v_user := auth.uid();
  IF v_conta IS NULL OR v_user IS NULL THEN RAISE EXCEPTION 'agenda: sessão sem workspace ativo'; END IF;
  IF NOT public.effective_plan_feature(v_conta, 'feature_agenda') THEN
    RAISE EXCEPTION 'feature_disabled:feature_agenda' USING ERRCODE = 'P0001';
  END IF;
  IF p_escopo IS NULL OR p_escopo NOT IN ('esta', 'seguintes', 'todas') THEN
    RAISE EXCEPTION 'agenda: escopo inválido';
  END IF;
  IF p_evento IS NULL OR jsonb_typeof(p_evento) <> 'object' THEN
    RAISE EXCEPTION 'agenda: dados do evento incompletos';
  END IF;

  SELECT o.* INTO v_o FROM public.agenda_ocorrencias o
   WHERE o.id = p_ocorrencia_id AND o.conta_id = v_conta AND NOT o.cancelada;
  IF NOT FOUND THEN RAISE EXCEPTION 'agenda: este evento não existe mais'; END IF;
  SELECT e.* INTO v_e FROM public.agenda_eventos e
   WHERE e.id = v_o.evento_id AND e.conta_id = v_conta FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'agenda: este evento não existe mais'; END IF;
  -- [escopo] evento de cliente que ele não acessa e que não é dele (organizador
  -- ou participante): mesmo erro de inexistente, para não confirmar o id
  IF NOT (public.my_client_scope_all() OR public.can_access_cliente(v_e.cliente_id)
          OR coalesce(public.agenda_pode_ver_evento(v_e.id, true, v_e.organizador_id), false)) THEN
    RAISE EXCEPTION 'agenda: este evento não existe mais';
  END IF;
  IF NOT public.agenda_pode_editar(v_e, v_user, v_conta) THEN
    RAISE EXCEPTION 'agenda: você não pode editar este evento';
  END IF;
  -- re-read the occurrence after the series lock (it may have changed meanwhile)
  SELECT o.* INTO v_o FROM public.agenda_ocorrencias o
   WHERE o.id = p_ocorrencia_id AND o.evento_id = v_e.id AND NOT o.cancelada;
  IF NOT FOUND THEN RAISE EXCEPTION 'agenda: este evento não existe mais'; END IF;

  v_primeira := NOT EXISTS (SELECT 1 FROM public.agenda_ocorrencias o
                             WHERE o.evento_id = v_e.id AND NOT o.cancelada AND o.data_original < v_o.data_original);
  IF v_e.freq IS NULL OR (p_escopo = 'seguintes' AND v_primeira) THEN
    v_escopo := 'todas';
  ELSE
    v_escopo := p_escopo;
  END IF;

  -- [hub] what the client sees before the edit, scope-dependent: esta -> this
  -- occurrence; todas -> the series' future occurrences; seguintes -> those
  -- from the cut. Taken before any regenerate/split/delete.
  v_cli_antes := CASE WHEN v_e.compartilhado_cliente THEN v_e.cliente_id END;
  IF v_cli_antes IS NOT NULL THEN
    v_antes := public.agenda_cliente_ocorrencias_snapshot(
      v_e.id, 'ativa',
      CASE WHEN v_escopo = 'esta' THEN v_o.id END,
      CASE WHEN v_escopo = 'seguintes' THEN v_o.data_original END);
  END IF;
  -- [convidados] the same for the guests, from their unbounded snapshot
  v_convs_antes := ARRAY(SELECT g.id FROM public.agenda_convidados g
                          WHERE g.evento_id = v_e.id AND g.removido_em IS NULL ORDER BY g.id);
  IF cardinality(v_convs_antes) > 0 THEN
    v_antes_g := public.agenda_convidados_snapshot(
      v_e.id, 'ativa',
      CASE WHEN v_escopo = 'esta' THEN v_o.id END,
      CASE WHEN v_escopo = 'seguintes' THEN v_o.data_original END);
  END IF;

  v_tem_horario := p_evento ? 'inicio_local' OR p_evento ? 'fim_local';
  v_hoje := public.agenda_hoje(v_e.tz);
  v_c := v_o.data_original;
  v_old_titulo := CASE WHEN 'titulo' = ANY (v_o.campos_sobrescritos) THEN v_o.titulo ELSE v_e.titulo END;
  v_old_local := CASE WHEN 'local' = ANY (v_o.campos_sobrescritos) THEN v_o.local ELSE v_e.local END;
  v_old_link := CASE WHEN 'link_reuniao' = ANY (v_o.campos_sobrescritos) THEN v_o.link_reuniao ELSE v_e.link_reuniao END;
  -- current participants other than the organizer, still members (what the form shows)
  v_atuais := ARRAY(SELECT ap.user_id FROM public.agenda_participantes ap
                      JOIN public.workspace_members wm ON wm.user_id = ap.user_id AND wm.workspace_id = v_conta
                     WHERE ap.evento_id = v_e.id AND ap.user_id IS DISTINCT FROM v_e.organizador_id
                     ORDER BY ap.user_id);

  -- ======== esta ========
  IF v_escopo = 'esta' THEN
    -- base: the series with this occurrence's effective content, so a drag that
    -- sends only times keeps an existing content override
    v_base := v_e;
    v_base.titulo := v_old_titulo;
    v_base.descricao := CASE WHEN 'descricao' = ANY (v_o.campos_sobrescritos) THEN v_o.descricao ELSE v_e.descricao END;
    v_base.local := v_old_local;
    v_base.link_reuniao := v_old_link;
    v_novo := public.agenda_validar_payload(v_conta, p_evento, v_base);

    IF v_novo.tipo IS DISTINCT FROM v_e.tipo
       OR v_novo.cor IS DISTINCT FROM v_e.cor
       OR v_novo.cliente_id IS DISTINCT FROM v_e.cliente_id
       OR v_novo.privado IS DISTINCT FROM v_e.privado
       -- [hub] sharing is a series field; compared as effective sharing, since a
       -- deleted cliente leaves compartilhado_cliente true with cliente_id NULL
       -- and agenda_validar_payload then reports false
       OR (v_novo.compartilhado_cliente AND v_novo.cliente_id IS NOT NULL)
          IS DISTINCT FROM (v_e.compartilhado_cliente AND v_e.cliente_id IS NOT NULL)
       OR v_novo.dia_inteiro IS DISTINCT FROM v_e.dia_inteiro
       OR ARRAY(SELECT x FROM unnest(v_novo.lembretes) x ORDER BY x) IS DISTINCT FROM ARRAY(SELECT x FROM unnest(v_e.lembretes) x ORDER BY x)
       OR (v_novo.freq, v_novo.intervalo, v_novo.dias_semana, v_novo.mensal_modo, v_novo.mensal_ordinal, v_novo.ate, v_novo.contagem)
          IS DISTINCT FROM (v_e.freq, v_e.intervalo, v_e.dias_semana, v_e.mensal_modo, v_e.mensal_ordinal, v_e.ate, v_e.contagem) THEN
      RAISE EXCEPTION 'agenda: este campo vale para toda a série';
    END IF;
    IF p_participantes IS NOT NULL THEN
      v_pedidos := ARRAY(SELECT DISTINCT d.u FROM unnest(p_participantes) AS d(u)
                          WHERE d.u IS NOT NULL AND d.u IS DISTINCT FROM v_e.organizador_id ORDER BY d.u);
      IF v_pedidos IS DISTINCT FROM v_atuais THEN
        RAISE EXCEPTION 'agenda: este campo vale para toda a série';
      END IF;
    END IF;

    IF v_tem_horario THEN
      SELECT f.inicio, f.fim INTO v_ini, v_fim FROM public.agenda_inicio_fim(v_novo, v_novo.dtstart::date) f;
    ELSE
      v_ini := v_o.inicio; v_fim := v_o.fim;
    END IF;
    SELECT g.inicio, g.fim INTO v_gen_ini, v_gen_fim FROM public.agenda_inicio_fim(v_e, v_o.data_original) g;

    -- [hub] the occurrence moves: its pending reschedule request is superseded
    IF (v_ini, v_fim) IS DISTINCT FROM (v_o.inicio, v_o.fim) THEN
      PERFORM public.agenda_cliente_substituir_pedidos(v_e.id, v_o.id);
    END IF;

    -- a field differing from the series is an override (even NULL); equal to
    -- the series value it is dropped from the list
    v_campos := ARRAY(SELECT c.campo FROM unnest(ARRAY['titulo', 'descricao', 'local', 'link_reuniao']) WITH ORDINALITY AS c(campo, n)
                       WHERE CASE c.campo
                               WHEN 'titulo' THEN v_novo.titulo IS DISTINCT FROM v_e.titulo
                               WHEN 'descricao' THEN v_novo.descricao IS DISTINCT FROM v_e.descricao
                               WHEN 'local' THEN v_novo.local IS DISTINCT FROM v_e.local
                               ELSE v_novo.link_reuniao IS DISTINCT FROM v_e.link_reuniao
                             END
                       ORDER BY c.n);

    UPDATE public.agenda_ocorrencias o
       SET titulo = CASE WHEN 'titulo' = ANY (v_campos) THEN v_novo.titulo END,
           descricao = CASE WHEN 'descricao' = ANY (v_campos) THEN v_novo.descricao END,
           local = CASE WHEN 'local' = ANY (v_campos) THEN v_novo.local END,
           link_reuniao = CASE WHEN 'link_reuniao' = ANY (v_campos) THEN v_novo.link_reuniao END,
           campos_sobrescritos = v_campos,
           inicio = v_ini,
           fim = v_fim,
           horario_alterado = (v_ini, v_fim) IS DISTINCT FROM (v_gen_ini, v_gen_fim)
     WHERE o.id = v_o.id;

    v_notifica := v_novo.titulo IS DISTINCT FROM v_old_titulo
               OR v_novo.local IS DISTINCT FROM v_old_local
               OR v_novo.link_reuniao IS DISTINCT FROM v_old_link
               OR (v_ini, v_fim) IS DISTINCT FROM (v_o.inicio, v_o.fim);
    v_alvo := v_e.id;
    v_ret := v_o.id;

  ELSE
    -- ======== todas / seguintes: derive the series dtstart ========
    v_novo := public.agenda_validar_payload(v_conta, p_evento, v_e);
    -- [convidados] a private series has no guests: the set after this edit is
    -- the payload's list when the key is present, else the current one
    IF v_novo.privado THEN
      v_conv_n := CASE WHEN NOT (p_evento ? 'convidados') THEN cardinality(v_convs_antes)
                       WHEN jsonb_typeof(p_evento->'convidados') = 'array' THEN jsonb_array_length(p_evento->'convidados')
                       ELSE 0 END;  -- not an array: agenda_definir_convidados refuses it below
      IF v_conv_n > 0 THEN
        IF v_e.privado THEN
          RAISE EXCEPTION 'agenda: evento privado não pode ter convidados externos.';
        END IF;
        RAISE EXCEPTION 'agenda: remova os convidados externos antes de tornar o evento privado.';
      END IF;
    END IF;
    IF v_tem_horario THEN
      v_delta := v_novo.dtstart::date - (v_o.inicio AT TIME ZONE v_e.tz)::date;
      -- Moving a recurring series to another day needs an explicit regra (the
      -- form always sends one): a stored rule cannot follow a shifted date in
      -- general (biweekly sets crossing a week boundary, monthly ordinals,
      -- ate). The UI sends date-changing drags of a recurring event as esta,
      -- so this is a backstop. A same-day time change (delta 0) keeps working.
      IF v_e.freq IS NOT NULL AND NOT (p_evento ? 'regra') AND v_delta <> 0 THEN
        RAISE EXCEPTION 'agenda: para mudar o dia da repetição, edite o evento';
      END IF;
      IF v_escopo = 'todas' THEN
        v_novo.dtstart := (v_e.dtstart::date + v_delta) + v_novo.dtstart::time;
      ELSE
        v_novo.dtstart := (v_c + v_delta) + v_novo.dtstart::time;
      END IF;
    ELSIF v_escopo = 'seguintes' THEN
      v_novo.dtstart := v_c + v_e.dtstart::time;
    END IF;

    IF v_escopo = 'seguintes' THEN
      -- contagem of the new series: a payload contagem equal to the stored one
      -- (or no regra at all, a same-day drag) means "the end was not touched", whatever
      -- else the rule changed (the form re-derives dias_semana from a moved
      -- date), so the remaining count carries over (tombstones count). A
      -- different contagem is the user's new end and is taken as sent.
      v_regra_igual := NOT (p_evento ? 'regra')
        OR (v_novo.freq, v_novo.intervalo, v_novo.dias_semana, v_novo.mensal_modo, v_novo.mensal_ordinal, v_novo.ate, v_novo.contagem)
           IS NOT DISTINCT FROM (v_e.freq, v_e.intervalo, v_e.dias_semana, v_e.mensal_modo, v_e.mensal_ordinal, v_e.ate, v_e.contagem);
      IF v_e.contagem IS NOT NULL AND v_novo.contagem IS NOT DISTINCT FROM v_e.contagem THEN
        v_contagem := v_e.contagem - (SELECT count(*) FROM public.agenda_datas_regra(v_e, v_e.dtstart::date, v_c - 1));
        IF v_contagem <= 0 THEN RAISE EXCEPTION 'agenda: a repetição não gera nenhuma data'; END IF;
        v_novo.contagem := v_contagem;
      END IF;
    END IF;

    IF v_novo.dtstart::date < least(v_e.dtstart::date, v_hoje - 366) THEN
      RAISE EXCEPTION 'agenda: a data de início é antiga demais';
    END IF;
    IF v_novo.freq IS NOT NULL AND v_novo.ate IS NOT NULL
       AND v_novo.ate > (v_novo.dtstart::date + interval '5 years')::date THEN
      RAISE EXCEPTION 'agenda: repetição inválida';
    END IF;
    v_novo.dtstart := public.agenda_normalizar_dtstart(v_novo);
    v_reset := v_novo.dia_inteiro IS DISTINCT FROM v_e.dia_inteiro;

    IF v_escopo = 'todas' THEN
      v_regen := (v_novo.freq, v_novo.intervalo, v_novo.dias_semana, v_novo.mensal_modo, v_novo.mensal_ordinal, v_novo.ate, v_novo.contagem)
                   IS DISTINCT FROM (v_e.freq, v_e.intervalo, v_e.dias_semana, v_e.mensal_modo, v_e.mensal_ordinal, v_e.ate, v_e.contagem)
              OR v_novo.dtstart IS DISTINCT FROM v_e.dtstart
              OR v_novo.duracao_min IS DISTINCT FROM v_e.duracao_min
              OR v_novo.duracao_dias IS DISTINCT FROM v_e.duracao_dias
              OR v_reset;
      v_notifica := v_regen
                 OR v_novo.titulo IS DISTINCT FROM v_e.titulo
                 OR v_novo.local IS DISTINCT FROM v_e.local
                 OR v_novo.link_reuniao IS DISTINCT FROM v_e.link_reuniao;

      UPDATE public.agenda_eventos ev
         SET titulo = v_novo.titulo, descricao = v_novo.descricao, local = v_novo.local,
             link_reuniao = v_novo.link_reuniao, tipo = v_novo.tipo, cor = v_novo.cor,
             cliente_id = v_novo.cliente_id, privado = v_novo.privado, dia_inteiro = v_novo.dia_inteiro,
             dtstart = v_novo.dtstart, duracao_min = v_novo.duracao_min, duracao_dias = v_novo.duracao_dias,
             freq = v_novo.freq, intervalo = v_novo.intervalo, dias_semana = v_novo.dias_semana,
             mensal_modo = v_novo.mensal_modo, mensal_ordinal = v_novo.mensal_ordinal,
             ate = v_novo.ate, contagem = v_novo.contagem, lembretes = v_novo.lembretes,
             compartilhado_cliente = v_novo.compartilhado_cliente  -- [hub]
       WHERE ev.id = v_e.id;

      IF p_participantes IS NOT NULL THEN
        SELECT d.adicionados, d.removidos INTO v_add, v_rem
          FROM public.agenda_definir_participantes(v_e.id, v_conta, v_e.organizador_id, p_participantes) d;
      END IF;
      -- [convidados] after the series UPDATE (privado is the new value)
      IF p_evento ? 'convidados' THEN
        SELECT d.adicionados, d.removidos INTO v_conv_add, v_conv_rem
          FROM public.agenda_definir_convidados(v_e.id, p_evento->'convidados') d;
      END IF;

      -- [hub] before agenda_regenerar deletes or moves rows: pending requests
      -- are superseded (the cascade would erase them); a cliente switch or
      -- un-share also drops the previous cliente's answers
      v_cli_depois := CASE WHEN v_novo.compartilhado_cliente THEN v_novo.cliente_id END;
      IF v_regen OR v_cli_depois IS DISTINCT FROM v_cli_antes THEN
        PERFORM public.agenda_cliente_substituir_pedidos(v_e.id);
      END IF;
      IF v_cli_antes IS NOT NULL AND v_cli_depois IS DISTINCT FROM v_cli_antes THEN
        DELETE FROM public.agenda_respostas_cliente rc
         USING public.agenda_ocorrencias o
         WHERE rc.ocorrencia_id = o.id AND o.evento_id = v_e.id AND rc.cliente_id = v_cli_antes;
      END IF;

      IF v_regen THEN
        -- a one-off keeps its single occurrence (id, RSVPs, deep links): move
        -- its identity date along before regenerating
        IF v_e.freq IS NULL AND v_novo.freq IS NULL THEN
          UPDATE public.agenda_ocorrencias o
             SET data_original = v_novo.dtstart::date
           WHERE o.evento_id = v_e.id;
        END IF;
        PERFORM public.agenda_regenerar(v_e.id, v_reset);
      END IF;
      v_alvo := v_e.id;

    ELSE
      -- ======== seguintes: split at v_c ========
      v_notifica := NOT v_regra_igual
                 OR v_novo.dtstart IS DISTINCT FROM (v_c + v_e.dtstart::time)
                 OR v_novo.duracao_min IS DISTINCT FROM v_e.duracao_min
                 OR v_novo.duracao_dias IS DISTINCT FROM v_e.duracao_dias
                 OR v_reset
                 OR v_novo.titulo IS DISTINCT FROM v_e.titulo
                 OR v_novo.local IS DISTINCT FROM v_e.local
                 OR v_novo.link_reuniao IS DISTINCT FROM v_e.link_reuniao;

      -- [hub] before the split moves and deletes rows from the cut: pending
      -- requests there are superseded; a cliente switch or un-share also drops
      -- the previous cliente's answers on those rows
      v_cli_depois := CASE WHEN v_novo.compartilhado_cliente THEN v_novo.cliente_id END;
      PERFORM public.agenda_cliente_substituir_pedidos(v_e.id, NULL, v_c);
      IF v_cli_antes IS NOT NULL AND v_cli_depois IS DISTINCT FROM v_cli_antes THEN
        DELETE FROM public.agenda_respostas_cliente rc
         USING public.agenda_ocorrencias o
         WHERE rc.ocorrencia_id = o.id AND o.evento_id = v_e.id AND o.data_original >= v_c
           AND rc.cliente_id = v_cli_antes;
      END IF;

      -- 1. the old series ends the day before the cut
      UPDATE public.agenda_eventos ev
         SET ate = v_c - 1, contagem = NULL, materializacao_completa = true
       WHERE ev.id = v_e.id;

      -- 2. the new series, with the participants (and their series answers) copied
      INSERT INTO public.agenda_eventos (
        conta_id, organizador_id, titulo, descricao, local, link_reuniao, tipo, cor, cliente_id,
        privado, dia_inteiro, tz, dtstart, duracao_min, duracao_dias, freq, intervalo, dias_semana,
        mensal_modo, mensal_ordinal, ate, contagem, lembretes, serie_origem_id,
        compartilhado_cliente)  -- [hub] the tail stays shared
      VALUES (
        v_conta, v_e.organizador_id, v_novo.titulo, v_novo.descricao, v_novo.local, v_novo.link_reuniao,
        v_novo.tipo, v_novo.cor, v_novo.cliente_id, v_novo.privado, v_novo.dia_inteiro, v_e.tz,
        v_novo.dtstart, v_novo.duracao_min, v_novo.duracao_dias, v_novo.freq, v_novo.intervalo,
        v_novo.dias_semana, v_novo.mensal_modo, v_novo.mensal_ordinal, v_novo.ate, v_novo.contagem,
        v_novo.lembretes, v_e.id,
        v_novo.compartilhado_cliente)  -- [hub]
      RETURNING id INTO v_alvo;
      SELECT * INTO v_novo FROM public.agenda_eventos ev WHERE ev.id = v_alvo;

      INSERT INTO public.agenda_participantes (evento_id, conta_id, user_id, resposta, respondido_em)
      SELECT v_alvo, v_conta, ap.user_id, ap.resposta, ap.respondido_em
        FROM public.agenda_participantes ap WHERE ap.evento_id = v_e.id;
      -- [convidados] and the active guests, with the SAME token and the source
      -- row's criado_em/adicionado_por (a copy is not a new invite: no audit,
      -- no daily cap)
      INSERT INTO public.agenda_convidados (conta_id, evento_id, email, nome, token, adicionado_por, criado_em)
      SELECT v_conta, v_alvo, g.email, g.nome, g.token, g.adicionado_por, g.criado_em
        FROM public.agenda_convidados g
       WHERE g.evento_id = v_e.id AND g.removido_em IS NULL
       ORDER BY g.id;

      -- 3. old rows from the cut: those on the new rule move over (exceptions,
      --    tombstones and per-occurrence RSVPs preserved), the rest go
      v_h := (v_hoje + interval '24 months')::date;
      v_h := greatest(coalesce(v_e.horizonte_ate, v_h), v_h);
      v_datas := coalesce(ARRAY(SELECT d FROM public.agenda_datas_regra(v_novo, v_novo.dtstart::date, v_h) d), '{}');
      UPDATE public.agenda_ocorrencias o
         SET evento_id = v_alvo
       WHERE o.evento_id = v_e.id AND o.data_original >= v_c AND o.data_original = ANY (v_datas);
      -- [convidados] the guests' answers on the moved rows follow their copy
      UPDATE public.agenda_respostas_convidado r
         SET convidado_id = c.id
        FROM public.agenda_convidados h, public.agenda_convidados c, public.agenda_ocorrencias o
       WHERE r.convidado_id = h.id AND h.evento_id = v_e.id
         AND c.evento_id = v_alvo AND c.token = h.token AND c.removido_em IS NULL
         AND o.id = r.ocorrencia_id AND o.evento_id = v_alvo;
      DELETE FROM public.agenda_ocorrencias o
       WHERE o.evento_id = v_e.id AND o.data_original >= v_c;
      UPDATE public.agenda_ocorrencias o
         SET inicio = f.inicio,
             fim = f.fim,
             horario_alterado = CASE WHEN v_reset THEN false ELSE o.horario_alterado END
        FROM public.agenda_ocorrencias o2
        CROSS JOIN LATERAL public.agenda_inicio_fim(v_novo, o2.data_original) f
       WHERE o.id = o2.id AND o.evento_id = v_alvo
         AND (v_reset OR NOT o.horario_alterado);
      PERFORM public.agenda_materializar(v_alvo, v_h);

      -- participants left out lose their answers on the moved rows (helper)
      IF p_participantes IS NOT NULL THEN
        SELECT d.adicionados, d.removidos INTO v_add, v_rem
          FROM public.agenda_definir_participantes(v_alvo, v_conta, v_e.organizador_id, p_participantes) d;
      END IF;
      -- [convidados] a guest added or removed in a seguintes edit concerns the
      -- tail only (its copy on v_alvo)
      IF p_evento ? 'convidados' THEN
        SELECT d.adicionados, d.removidos INTO v_conv_add, v_conv_rem
          FROM public.agenda_definir_convidados(v_alvo, p_evento->'convidados') d;
      END IF;

      -- 4. an old series left without a live occurrence is deleted
      IF NOT EXISTS (SELECT 1 FROM public.agenda_ocorrencias o WHERE o.evento_id = v_e.id AND NOT o.cancelada) THEN
        DELETE FROM public.agenda_eventos ev WHERE ev.id = v_e.id;
      END IF;
    END IF;

    -- the edited occurrence takes the times of this edit even if it had been
    -- moved by hand before (other hand-moved occurrences keep theirs)
    IF v_tem_horario THEN
      SELECT * INTO v_novo FROM public.agenda_eventos ev WHERE ev.id = v_alvo;
      -- (its data_original as stored now: a one-off moved it along)
      UPDATE public.agenda_ocorrencias o
         SET inicio = f.inicio, fim = f.fim, horario_alterado = false
        FROM public.agenda_ocorrencias o2
        CROSS JOIN LATERAL public.agenda_inicio_fim(v_novo, o2.data_original) f
       WHERE o.id = o2.id AND o.id = v_o.id AND o.evento_id = v_alvo;
    END IF;

    SELECT o.id INTO v_ret FROM public.agenda_ocorrencias o
     WHERE o.evento_id = v_alvo AND NOT o.cancelada
     ORDER BY (o.id = v_o.id) DESC, (o.data_original >= v_c) DESC, o.data_original
     LIMIT 1;
  END IF;

  -- ---- [hub] e-mail to the client ----
  -- Same cliente before and after: 'alteracao' with the affected occurrences
  -- whose inicio/fim/titulo/descricao/local/link changed (rows the edit
  -- deleted enter as 'cancelada' with their previous content). Sharing turned
  -- off or the cliente switched: 'cancelamento' to the previous cliente; turned
  -- on or switched: 'convite' to the new one. A split enqueues under the new
  -- series (v_alvo). Inside agenda_remarcacao_resolver the 'alteracao' becomes
  -- 'remarcacao_aceita' (GUC agenda.remarcacao, see agenda_cliente_enfileirar).
  -- [convidados] Guests, from their own unbounded snapshots
  -- (agenda_convidados_snapshot): the ones kept get the 'alteracao' diff of
  -- v_antes_g (computed once, before the bump); the ones added get 'convite'
  -- with the series' (the tail's) next occurrences; the ones removed get
  -- 'cancelamento' with what they knew (v_antes_g). Every list is built first,
  -- then agenda_envios_enfileirar bumps their union once and enqueues them.
  SELECT CASE WHEN ev.compartilhado_cliente THEN ev.cliente_id END INTO v_cli_depois
    FROM public.agenda_eventos ev WHERE ev.id = v_alvo;
  v_conv_manter := ARRAY(SELECT g.id FROM public.agenda_convidados g
                          WHERE g.evento_id = v_alvo AND g.removido_em IS NULL AND NOT (g.id = ANY (v_conv_add))
                          ORDER BY g.id);
  v_cancel := (SELECT coalesce(jsonb_agg(x || '{"estado":"cancelada"}'::jsonb), '[]'::jsonb) FROM jsonb_array_elements(v_antes) x);
  v_cancel_g := (SELECT coalesce(jsonb_agg(x || '{"estado":"cancelada"}'::jsonb), '[]'::jsonb) FROM jsonb_array_elements(v_antes_g) x);
  IF v_cli_antes IS NOT NULL AND v_cli_depois IS NOT DISTINCT FROM v_cli_antes THEN
    v_diff := public.agenda_cliente_diff(v_antes,
      public.agenda_cliente_ocorrencias_snapshot(v_alvo, 'ativa', CASE WHEN v_escopo = 'esta' THEN v_o.id END));
  END IF;
  IF cardinality(v_conv_manter) > 0 THEN
    v_diff_g := public.agenda_cliente_diff(v_antes_g,
      public.agenda_convidados_snapshot(v_alvo, 'ativa', CASE WHEN v_escopo = 'esta' THEN v_o.id END));
  END IF;
  IF (v_cli_antes IS NULL OR v_cli_depois IS DISTINCT FROM v_cli_antes) AND v_cli_depois IS NOT NULL THEN
    v_snap := public.agenda_cliente_ocorrencias_snapshot(v_alvo, 'ativa');
  END IF;
  IF cardinality(v_conv_add) > 0 THEN
    v_snap_g := public.agenda_convidados_snapshot(v_alvo, 'ativa');
  END IF;
  IF v_cli_antes IS NOT NULL AND v_cli_depois IS NOT DISTINCT FROM v_cli_antes THEN
    v_envios := v_envios || jsonb_build_array(jsonb_build_object(
      'cliente', v_cli_antes, 'convidado', NULL, 'tipo', 'alteracao', 'ocorrencias', v_diff));
  ELSE
    IF v_cli_antes IS NOT NULL THEN
      v_envios := v_envios || jsonb_build_array(jsonb_build_object(
        'cliente', v_cli_antes, 'convidado', NULL, 'tipo', 'cancelamento', 'ocorrencias', v_cancel));
    END IF;
    IF v_cli_depois IS NOT NULL THEN
      v_envios := v_envios || jsonb_build_array(jsonb_build_object(
        'cliente', v_cli_depois, 'convidado', NULL, 'tipo', 'convite', 'ocorrencias', v_snap));
    END IF;
  END IF;
  v_envios := v_envios
           || public.agenda_envios_convidados(v_conv_manter, 'alteracao', v_diff_g)
           || public.agenda_envios_convidados(v_conv_add, 'convite', v_snap_g)
           || public.agenda_envios_convidados(v_conv_rem, 'cancelamento', v_cancel_g);
  PERFORM public.agenda_envios_enfileirar(v_conta, v_alvo, v_envios);
  -- [convidados] a removed guest's pending items become a full cancellation
  PERFORM public.agenda_convidados_perda(v_alvo, v_conv_rem);

  -- ---- notifications (the actor is excluded by agenda_notificar) ----
  IF v_notifica THEN
    v_destinatarios := ARRAY(SELECT ap.user_id FROM public.agenda_participantes ap
                              WHERE ap.evento_id = v_alvo AND NOT (ap.user_id = ANY (v_add)));
    PERFORM public.agenda_notificar(v_conta, v_alvo, v_ret, 'event_updated', v_destinatarios, v_user,
                                    jsonb_build_object('escopo', v_escopo));
  END IF;
  IF cardinality(v_add) > 0 THEN
    PERFORM public.agenda_notificar(v_conta, v_alvo, v_ret, 'event_invited', v_add, v_user,
                                    jsonb_build_object('escopo', v_escopo));
  END IF;
  IF cardinality(v_rem) > 0 THEN
    PERFORM public.agenda_notificar(v_conta, v_alvo, v_ret, 'event_cancelled', v_rem, v_user,
                                    jsonb_build_object('escopo', v_escopo, 'motivo', 'removido'));
  END IF;

  RETURN v_ret;
END $function$;

CREATE OR REPLACE FUNCTION public.agenda_remarcacao_resolver(p_remarcacao bigint, p_aceitar boolean, p_mensagem text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_conta uuid;
  v_user uuid;
  v_rm public.agenda_remarcacoes;
  v_o public.agenda_ocorrencias;
  v_e public.agenda_eventos;
  v_msg text := NULLIF(btrim(p_mensagem), '');
  v_oc bigint;
  v_inicio timestamptz;
BEGIN
  v_conta := get_my_conta_id(); v_user := auth.uid();
  IF v_conta IS NULL OR v_user IS NULL THEN RAISE EXCEPTION 'agenda: sessão sem workspace ativo'; END IF;
  IF NOT public.effective_plan_feature(v_conta, 'feature_agenda') THEN
    RAISE EXCEPTION 'feature_disabled:feature_agenda' USING ERRCODE = 'P0001';
  END IF;
  IF p_aceitar IS NULL THEN RAISE EXCEPTION 'agenda: dados do evento inválidos'; END IF;
  IF char_length(v_msg) > 1000 THEN
    RAISE EXCEPTION 'agenda: a mensagem pode ter no máximo 1000 caracteres.';
  END IF;

  SELECT rm.* INTO v_rm FROM public.agenda_remarcacoes rm WHERE rm.id = p_remarcacao AND rm.conta_id = v_conta;
  IF NOT FOUND THEN RAISE EXCEPTION 'agenda: este evento não existe mais'; END IF;
  SELECT o.* INTO v_o FROM public.agenda_ocorrencias o WHERE o.id = v_rm.ocorrencia_id AND o.conta_id = v_conta;
  IF NOT FOUND THEN RAISE EXCEPTION 'agenda: este evento não existe mais'; END IF;
  -- (b) series -> occurrence -> request
  SELECT e.* INTO v_e FROM public.agenda_eventos e WHERE e.id = v_o.evento_id AND e.conta_id = v_conta FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'agenda: este evento não existe mais'; END IF;
  -- (a) who may edit the event may resolve its requests
  -- [escopo] evento de cliente que ele não acessa e que não é dele (organizador
  -- ou participante): mesmo erro de inexistente, para não confirmar o id
  IF NOT (public.my_client_scope_all() OR public.can_access_cliente(v_e.cliente_id)
          OR coalesce(public.agenda_pode_ver_evento(v_e.id, true, v_e.organizador_id), false)) THEN
    RAISE EXCEPTION 'agenda: este evento não existe mais';
  END IF;
  IF NOT public.agenda_pode_editar(v_e, v_user, v_conta) THEN
    RAISE EXCEPTION 'agenda: você não pode editar este evento';
  END IF;
  SELECT o.* INTO v_o FROM public.agenda_ocorrencias o WHERE o.id = v_rm.ocorrencia_id AND o.evento_id = v_e.id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'agenda: este evento não existe mais'; END IF;
  SELECT rm.* INTO v_rm FROM public.agenda_remarcacoes rm WHERE rm.id = p_remarcacao FOR UPDATE;

  IF NOT p_aceitar THEN
    UPDATE public.agenda_remarcacoes rm
       SET status = 'recusada', resolvido_em = now(), resolvido_por = v_user, resposta_equipe = v_msg
     WHERE rm.id = p_remarcacao AND rm.status = 'pendente'
    RETURNING rm.* INTO v_rm;
    IF NOT FOUND THEN RAISE EXCEPTION 'agenda: este pedido já foi resolvido.'; END IF;
    PERFORM public.agenda_cliente_enfileirar(
      v_conta, v_rm.cliente_id, v_e.id, 'remarcacao_recusada',
      public.agenda_cliente_ocorrencias_snapshot(NULL, 'ativa', v_o.id),
      jsonb_build_object('remarcacao_id', v_rm.id, 'inicio_sugerido', v_rm.inicio_sugerido,
                         'fim_sugerido', v_rm.fim_sugerido, 'mensagem', v_rm.mensagem,
                         'resposta_equipe', v_rm.resposta_equipe));
    RETURN;
  END IF;

  IF v_rm.status = 'pendente' AND v_rm.inicio_sugerido <= now() THEN
    RAISE EXCEPTION 'agenda: esse horário já passou. Combine outro com o cliente.';
  END IF;
  -- (c)
  UPDATE public.agenda_remarcacoes rm
     SET status = 'aceita', resolvido_em = now(), resolvido_por = v_user, resposta_equipe = v_msg
   WHERE rm.id = p_remarcacao AND rm.status = 'pendente'
  RETURNING rm.* INTO v_rm;
  IF NOT FOUND THEN RAISE EXCEPTION 'agenda: este pedido já foi resolvido.'; END IF;

  -- (d) + (e)
  PERFORM set_config('agenda.remarcacao', v_rm.id::text, true);
  v_oc := public.agenda_evento_editar(v_o.id, 'esta', jsonb_build_object(
    'inicio_local', to_char(v_rm.inicio_sugerido AT TIME ZONE v_e.tz, 'YYYY-MM-DD"T"HH24:MI:SS'),
    'fim_local', to_char(v_rm.fim_sugerido AT TIME ZONE v_e.tz, 'YYYY-MM-DD"T"HH24:MI:SS')));
  v_oc := coalesce(v_oc, v_o.id);
  SELECT o.inicio INTO v_inicio FROM public.agenda_ocorrencias o WHERE o.id = v_oc;

  -- a suggestion equal to the current time changes nothing in the edit, so it
  -- enqueued nothing: the client still gets the "remarcação aceita" e-mail
  IF NOT EXISTS (SELECT 1 FROM public.agenda_emails_cliente q
                  WHERE q.cliente_id = v_rm.cliente_id AND q.tipo = 'remarcacao_aceita'
                    AND (q.remarcacao->>'remarcacao_id')::bigint = v_rm.id) THEN
    PERFORM public.agenda_cliente_enfileirar(v_conta, v_rm.cliente_id, v_e.id, 'alteracao',
      public.agenda_cliente_ocorrencias_snapshot(NULL, 'ativa', v_oc));
  END IF;
  PERFORM set_config('agenda.remarcacao', '', true);

  -- (f)
  IF v_inicio IS NOT NULL THEN
    INSERT INTO public.agenda_respostas_cliente AS rc (ocorrencia_id, conta_id, cliente_id, resposta, respondido_em, inicio_respondido)
    VALUES (v_oc, v_conta, v_rm.cliente_id, 'sim', now(), v_inicio)
    ON CONFLICT (ocorrencia_id) DO UPDATE
       SET cliente_id = EXCLUDED.cliente_id, resposta = 'sim', respondido_em = EXCLUDED.respondido_em,
           inicio_respondido = EXCLUDED.inicio_respondido,
           lembrado_inicio = CASE WHEN rc.cliente_id = EXCLUDED.cliente_id THEN rc.lembrado_inicio END;
  END IF;
END $function$;

CREATE OR REPLACE FUNCTION public.agenda_evento_excluir(p_ocorrencia_id bigint, p_escopo text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_conta uuid;
  v_user uuid;
  v_o public.agenda_ocorrencias;
  v_e public.agenda_eventos;
  v_escopo text;
  v_primeira boolean;
  v_convs bigint[];               -- [convidados] active guests, read before any DELETE
  v_envios jsonb := '[]'::jsonb;  -- [convidados]
BEGIN
  v_conta := get_my_conta_id(); v_user := auth.uid();
  IF v_conta IS NULL OR v_user IS NULL THEN RAISE EXCEPTION 'agenda: sessão sem workspace ativo'; END IF;
  IF NOT public.effective_plan_feature(v_conta, 'feature_agenda') THEN
    RAISE EXCEPTION 'feature_disabled:feature_agenda' USING ERRCODE = 'P0001';
  END IF;
  IF p_escopo IS NULL OR p_escopo NOT IN ('esta', 'seguintes', 'todas') THEN
    RAISE EXCEPTION 'agenda: escopo inválido';
  END IF;

  SELECT o.* INTO v_o FROM public.agenda_ocorrencias o
   WHERE o.id = p_ocorrencia_id AND o.conta_id = v_conta AND NOT o.cancelada;
  IF NOT FOUND THEN RAISE EXCEPTION 'agenda: este evento não existe mais'; END IF;
  SELECT e.* INTO v_e FROM public.agenda_eventos e
   WHERE e.id = v_o.evento_id AND e.conta_id = v_conta FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'agenda: este evento não existe mais'; END IF;
  -- [escopo] evento de cliente que ele não acessa e que não é dele (organizador
  -- ou participante): mesmo erro de inexistente, para não confirmar o id
  IF NOT (public.my_client_scope_all() OR public.can_access_cliente(v_e.cliente_id)
          OR coalesce(public.agenda_pode_ver_evento(v_e.id, true, v_e.organizador_id), false)) THEN
    RAISE EXCEPTION 'agenda: este evento não existe mais';
  END IF;
  IF NOT public.agenda_pode_editar(v_e, v_user, v_conta) THEN
    RAISE EXCEPTION 'agenda: você não pode editar este evento';
  END IF;
  -- [escopo] excluir (qualquer escopo) é estrito: cliente que ele acessa, ou
  -- evento sem cliente que ele organiza
  IF NOT (public.my_client_scope_all() OR public.can_access_cliente(v_e.cliente_id)
          OR (v_e.cliente_id IS NULL AND v_e.organizador_id = v_user)) THEN
    RAISE EXCEPTION 'client_scope_restricted' USING ERRCODE = '42501';
  END IF;
  SELECT o.* INTO v_o FROM public.agenda_ocorrencias o
   WHERE o.id = p_ocorrencia_id AND o.evento_id = v_e.id AND NOT o.cancelada;
  IF NOT FOUND THEN RAISE EXCEPTION 'agenda: este evento não existe mais'; END IF;

  v_primeira := NOT EXISTS (SELECT 1 FROM public.agenda_ocorrencias o
                             WHERE o.evento_id = v_e.id AND NOT o.cancelada AND o.data_original < v_o.data_original);
  IF v_e.freq IS NULL OR (p_escopo = 'seguintes' AND v_primeira) THEN
    v_escopo := 'todas';
  ELSE
    v_escopo := p_escopo;
  END IF;

  PERFORM public.agenda_notificar(
    v_conta, v_e.id, v_o.id, 'event_cancelled',
    ARRAY(SELECT ap.user_id FROM public.agenda_participantes ap WHERE ap.evento_id = v_e.id),
    v_user, jsonb_build_object('escopo', v_escopo));

  -- [hub] before any delete: pending reschedule requests of the affected
  -- occurrences are superseded, and a shared series sends the client a
  -- 'cancelamento' whose snapshot survives the DELETE below
  PERFORM public.agenda_cliente_substituir_pedidos(v_e.id,
    CASE WHEN v_escopo = 'esta' THEN v_o.id END,
    CASE WHEN v_escopo = 'seguintes' THEN v_o.data_original END);
  -- [convidados] and each active guest the same 'cancelamento' (read before
  -- the DELETE: the cascade would erase the guests), one bump for all
  v_convs := ARRAY(SELECT g.id FROM public.agenda_convidados g
                    WHERE g.evento_id = v_e.id AND g.removido_em IS NULL ORDER BY g.id);
  IF (v_e.compartilhado_cliente AND v_e.cliente_id IS NOT NULL) OR cardinality(v_convs) > 0 THEN
    IF v_e.compartilhado_cliente AND v_e.cliente_id IS NOT NULL THEN
      v_envios := jsonb_build_array(jsonb_build_object('cliente', v_e.cliente_id, 'convidado', NULL,
        'tipo', 'cancelamento', 'ocorrencias', public.agenda_cliente_ocorrencias_snapshot(v_e.id, 'cancelada',
          CASE WHEN v_escopo = 'esta' THEN v_o.id END,
          CASE WHEN v_escopo = 'seguintes' THEN v_o.data_original END)));
    END IF;
    -- the guests' list has no 90-day bound (agenda_convidados_snapshot)
    v_envios := v_envios || public.agenda_envios_convidados(v_convs, 'cancelamento',
      public.agenda_convidados_snapshot(v_e.id, 'cancelada',
        CASE WHEN v_escopo = 'esta' THEN v_o.id END,
        CASE WHEN v_escopo = 'seguintes' THEN v_o.data_original END));
    PERFORM public.agenda_envios_enfileirar(v_conta, v_e.id, v_envios);
    -- [convidados] the whole series goes: the guests' pending items become a
    -- full cancellation (esta/seguintes keep the guests, nothing to convert)
    IF v_escopo = 'todas' THEN
      PERFORM public.agenda_convidados_perda(v_e.id, v_convs);
    END IF;
  END IF;

  IF v_escopo = 'todas' THEN
    DELETE FROM public.agenda_eventos ev WHERE ev.id = v_e.id;
    RETURN;
  ELSIF v_escopo = 'esta' THEN
    UPDATE public.agenda_ocorrencias o SET cancelada = true WHERE o.id = v_o.id;
  ELSE
    UPDATE public.agenda_eventos ev
       SET ate = v_o.data_original - 1, contagem = NULL, materializacao_completa = true
     WHERE ev.id = v_e.id;
    DELETE FROM public.agenda_ocorrencias o
     WHERE o.evento_id = v_e.id AND o.data_original >= v_o.data_original;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.agenda_ocorrencias o WHERE o.evento_id = v_e.id AND NOT o.cancelada)
     AND EXISTS (SELECT 1 FROM public.agenda_eventos ev WHERE ev.id = v_e.id AND ev.materializacao_completa) THEN
    DELETE FROM public.agenda_eventos ev WHERE ev.id = v_e.id;
  END IF;
END $function$;

CREATE OR REPLACE FUNCTION public.get_mensagens_conversas()
 RETURNS TABLE(cliente_id bigint, cliente_nome text, cliente_foto_url text, last_source text, last_action text, last_content text, last_is_workspace_user boolean, last_author_name text, last_created_at timestamp with time zone, unread_count bigint)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_conta uuid;
  v_uid   uuid;
  v_since timestamptz;
  v_all   boolean;  -- [escopo]
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'authenticated only';
  END IF;

  SELECT public.get_my_conta_id() INTO v_conta;
  IF v_conta IS NULL THEN RETURN; END IF;
  v_all := public.my_client_scope_all();

  SELECT ls.last_seen_at INTO v_since
    FROM mensagens_last_seen ls
   WHERE ls.conta_id = v_conta AND ls.user_id = v_uid;
  v_since := COALESCE(v_since, '-infinity'::timestamptz);

  RETURN QUERY
  WITH feed AS (
    SELECT 'post_feedback'::text AS f_source, wp.cliente_id AS f_cliente_id,
           pa.action AS f_action, pa.comentario AS f_content,
           pa.is_workspace_user AS f_iwu, pa.author_user_id AS f_author,
           pa.created_at AS f_created_at
      FROM post_approvals pa
      JOIN workflow_posts wp ON wp.id = pa.post_id
     WHERE wp.conta_id = v_conta
    UNION ALL
    SELECT 'edit_suggestion', wp.cliente_id,
           es.status, left(es.suggested_conteudo_plain, 280),
           false, NULL::uuid, es.created_at
      FROM post_edit_suggestions es
      JOIN workflow_posts wp ON wp.id = es.post_id
     WHERE es.conta_id = v_conta
    UNION ALL
    SELECT 'mensagem', m.cliente_id,
           NULL::text, m.content,
           m.is_workspace_user, m.author_user_id, m.created_at
      FROM mensagens m
     WHERE m.conta_id = v_conta
    UNION ALL
    SELECT 'media_note', wp.cliente_id,
           'nota', left(n.body, 280),
           false, NULL::uuid, n.created_at
      FROM post_media_notes n
      JOIN workflow_posts wp ON wp.id = n.post_id
     WHERE n.conta_id = v_conta AND n.visibility = 'client'
    UNION ALL
    SELECT 'media_note_reply', wp.cliente_id,
           'resposta_nota', left(r.body, 280),
           r.author_kind = 'team', r.author_user_id, r.created_at
      FROM post_media_note_replies r
      JOIN post_media_notes n ON n.id = r.note_id AND n.visibility = 'client' AND n.conta_id = v_conta
      JOIN workflow_posts wp ON wp.id = n.post_id
     WHERE r.conta_id = v_conta
  ),
  latest AS (
    SELECT DISTINCT ON (f.f_cliente_id)
           f.f_cliente_id, f.f_source, f.f_action, f.f_content,
           f.f_iwu, f.f_author, f.f_created_at
      FROM feed f
     ORDER BY f.f_cliente_id, f.f_created_at DESC
  ),
  unread AS (
    SELECT f.f_cliente_id, count(*)::bigint AS n
      FROM feed f
     WHERE f.f_iwu = false AND f.f_created_at > v_since
     GROUP BY f.f_cliente_id
  )
  SELECT c.id, c.nome, ig.profile_picture_url,
         l.f_source, l.f_action, l.f_content,
         l.f_iwu, mb.nome, l.f_created_at,
         COALESCE(u.n, 0)
    FROM clientes c
    LEFT JOIN LATERAL (
      SELECT ia.profile_picture_url
        FROM instagram_accounts ia
       WHERE ia.client_id = c.id
       LIMIT 1
    ) ig ON true
    LEFT JOIN latest l ON l.f_cliente_id = c.id
    LEFT JOIN membros mb ON mb.crm_user_id = l.f_author AND mb.conta_id = v_conta
    LEFT JOIN unread u ON u.f_cliente_id = c.id
   WHERE c.conta_id = v_conta
     AND (v_all OR public.can_access_cliente(c.id))  -- [escopo] só clientes que ele acessa
   ORDER BY l.f_created_at DESC NULLS LAST, c.nome;
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_mensagens_feed(p_conta_id uuid DEFAULT NULL::uuid, p_cliente_id bigint DEFAULT NULL::bigint, p_before timestamp with time zone DEFAULT NULL::timestamp with time zone, p_limit integer DEFAULT 50, p_before_source text DEFAULT NULL::text, p_before_item_id bigint DEFAULT NULL::bigint)
 RETURNS TABLE(source text, item_id bigint, cliente_id bigint, cliente_nome text, post_id bigint, workflow_id bigint, post_titulo text, action text, content text, is_workspace_user boolean, author_user_id uuid, author_name text, author_avatar_url text, created_at timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_conta uuid;
  v_all   boolean := true;  -- [escopo] o caminho do Hub (sem usuário) não muda
BEGIN
  IF auth.uid() IS NOT NULL THEN
    SELECT public.get_my_conta_id() INTO v_conta;
    IF v_conta IS NULL THEN
      RAISE EXCEPTION 'No active workspace';
    END IF;
    IF p_conta_id IS NOT NULL AND p_conta_id <> v_conta THEN
      RAISE EXCEPTION 'Forbidden';
    END IF;
    v_all := public.my_client_scope_all();
  ELSE
    IF p_conta_id IS NULL THEN
      RAISE EXCEPTION 'p_conta_id required';
    END IF;
    v_conta := p_conta_id;
  END IF;

  RETURN QUERY
  WITH feed AS (
    SELECT 'post_feedback'::text AS f_source, pa.id AS f_item_id,
           wp.cliente_id AS f_cliente_id, wp.id AS f_post_id,
           wp.workflow_id AS f_workflow_id, wp.titulo AS f_post_titulo,
           pa.action AS f_action, pa.comentario AS f_content,
           pa.is_workspace_user AS f_iwu, pa.author_user_id AS f_author,
           pa.created_at AS f_created_at
      FROM post_approvals pa
      JOIN workflow_posts wp ON wp.id = pa.post_id
     WHERE wp.conta_id = v_conta
    UNION ALL
    SELECT 'edit_suggestion', es.id,
           wp.cliente_id, wp.id, wp.workflow_id, wp.titulo,
           es.status, left(es.suggested_conteudo_plain, 280),
           false, NULL::uuid, es.created_at
      FROM post_edit_suggestions es
      JOIN workflow_posts wp ON wp.id = es.post_id
     WHERE es.conta_id = v_conta
    UNION ALL
    SELECT 'mensagem', m.id,
           m.cliente_id, NULL::bigint, NULL::bigint, NULL::text,
           NULL::text, m.content,
           m.is_workspace_user, m.author_user_id, m.created_at
      FROM mensagens m
     WHERE m.conta_id = v_conta
    UNION ALL
    -- Feedback em mídia: só notas visíveis ao cliente (nota de cliente é
    -- sempre client; a interna e suas respostas nunca entram).
    SELECT 'media_note', n.id,
           wp.cliente_id, wp.id, wp.workflow_id, wp.titulo,
           'nota', left(n.body, 280),
           false, NULL::uuid, n.created_at
      FROM post_media_notes n
      JOIN workflow_posts wp ON wp.id = n.post_id
     WHERE n.conta_id = v_conta AND n.visibility = 'client'
    UNION ALL
    SELECT 'media_note_reply', r.id,
           wp.cliente_id, wp.id, wp.workflow_id, wp.titulo,
           'resposta_nota', left(r.body, 280),
           r.author_kind = 'team', r.author_user_id, r.created_at
      FROM post_media_note_replies r
      JOIN post_media_notes n ON n.id = r.note_id AND n.visibility = 'client' AND n.conta_id = v_conta
      JOIN workflow_posts wp ON wp.id = n.post_id
     WHERE r.conta_id = v_conta
  )
  SELECT f.f_source, f.f_item_id, f.f_cliente_id, c.nome,
         f.f_post_id, f.f_workflow_id, f.f_post_titulo,
         f.f_action, f.f_content, f.f_iwu,
         f.f_author, mb.nome, mb.avatar_url,
         f.f_created_at
    FROM feed f
    JOIN clientes c ON c.id = f.f_cliente_id
    LEFT JOIN membros mb ON mb.crm_user_id = f.f_author AND mb.conta_id = v_conta
   WHERE (p_cliente_id IS NULL OR f.f_cliente_id = p_cliente_id)
     AND (v_all OR public.can_access_cliente(f.f_cliente_id))  -- [escopo]
     -- Composite keyset cursor: now() is transaction-stable, so batch inserts
     -- can share the exact same created_at. A strict created_at-only cursor
     -- would silently skip sibling rows sitting on that boundary. Falling
     -- back to created_at-only when the source/item_id leg is missing keeps
     -- older callers correct-ish, but every caller in this codebase passes
     -- the full three-part cursor.
     AND (
       p_before IS NULL
       OR (
         CASE
           WHEN p_before_source IS NULL OR p_before_item_id IS NULL
             THEN f.f_created_at < p_before
           ELSE (f.f_created_at, f.f_source, f.f_item_id)
                < (p_before, p_before_source, p_before_item_id)
         END
       )
     )
   ORDER BY f.f_created_at DESC, f.f_source DESC, f.f_item_id DESC
   LIMIT LEAST(GREATEST(COALESCE(p_limit, 50), 1), 100);
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_mensagens_unread(p_conta_id uuid DEFAULT NULL::uuid, p_cliente_id bigint DEFAULT NULL::bigint)
 RETURNS TABLE(cliente_id bigint, unread_count bigint)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_conta uuid;
  v_uid   uuid;
  v_since timestamptz;
  v_all   boolean;  -- [escopo]
BEGIN
  v_uid := auth.uid();

  IF v_uid IS NOT NULL THEN
    SELECT public.get_my_conta_id() INTO v_conta;
    IF v_conta IS NULL THEN RETURN; END IF;

    SELECT ls.last_seen_at INTO v_since
      FROM mensagens_last_seen ls
     WHERE ls.conta_id = v_conta AND ls.user_id = v_uid;
    v_since := COALESCE(v_since, '-infinity'::timestamptz);
    v_all := public.my_client_scope_all();

    RETURN QUERY
    SELECT f.f_cliente_id, count(*)::bigint
      FROM (
        SELECT wp.cliente_id AS f_cliente_id, pa.created_at AS f_created_at
          FROM post_approvals pa
          JOIN workflow_posts wp ON wp.id = pa.post_id
         WHERE wp.conta_id = v_conta AND pa.is_workspace_user = false
        UNION ALL
        SELECT wp.cliente_id, es.created_at
          FROM post_edit_suggestions es
          JOIN workflow_posts wp ON wp.id = es.post_id
         WHERE es.conta_id = v_conta
        UNION ALL
        SELECT m.cliente_id, m.created_at
          FROM mensagens m
         WHERE m.conta_id = v_conta AND m.is_workspace_user = false
        UNION ALL
        -- notas do cliente e respostas do cliente nelas
        SELECT wp.cliente_id, n.created_at
          FROM post_media_notes n
          JOIN workflow_posts wp ON wp.id = n.post_id
         WHERE n.conta_id = v_conta AND n.visibility = 'client'
        UNION ALL
        SELECT wp.cliente_id, r.created_at
          FROM post_media_note_replies r
          JOIN post_media_notes n ON n.id = r.note_id AND n.visibility = 'client' AND n.conta_id = v_conta
          JOIN workflow_posts wp ON wp.id = n.post_id
         WHERE r.conta_id = v_conta AND r.author_kind = 'client'
      ) f
     WHERE f.f_created_at > v_since
       AND (v_all OR public.can_access_cliente(f.f_cliente_id))  -- [escopo]
     GROUP BY f.f_cliente_id;
  ELSE
    IF p_conta_id IS NULL OR p_cliente_id IS NULL THEN
      RAISE EXCEPTION 'p_conta_id and p_cliente_id required';
    END IF;

    SELECT ls.last_seen_at INTO v_since
      FROM mensagens_last_seen ls
     WHERE ls.conta_id = p_conta_id AND ls.cliente_id = p_cliente_id;
    v_since := COALESCE(v_since, '-infinity'::timestamptz);

    RETURN QUERY
    SELECT p_cliente_id, count(*)::bigint
      FROM (
        SELECT pa.created_at AS f_created_at
          FROM post_approvals pa
          JOIN workflow_posts wp ON wp.id = pa.post_id
         WHERE wp.conta_id = p_conta_id AND wp.cliente_id = p_cliente_id
           AND pa.is_workspace_user = true
        UNION ALL
        SELECT m.created_at
          FROM mensagens m
         WHERE m.conta_id = p_conta_id AND m.cliente_id = p_cliente_id
           AND m.is_workspace_user = true
        UNION ALL
        -- respostas da equipe nas notas do cliente
        SELECT r.created_at
          FROM post_media_note_replies r
          JOIN post_media_notes n ON n.id = r.note_id AND n.visibility = 'client' AND n.conta_id = p_conta_id
          JOIN workflow_posts wp ON wp.id = n.post_id
         WHERE r.conta_id = p_conta_id AND wp.cliente_id = p_cliente_id
           AND r.author_kind = 'team'
      ) f
     WHERE f.f_created_at > v_since;
  END IF;
END;
$function$;

CREATE OR REPLACE FUNCTION public.hub_token_extend(p_token_id uuid)
 RETURNS timestamp with time zone
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_conta_id uuid;
  v_cliente_id bigint;
  v_old_expires timestamptz;
  v_new_expires timestamptz;
begin
  select t.conta_id, t.cliente_id, t.expires_at
    into v_conta_id, v_cliente_id, v_old_expires
    from client_hub_tokens t where t.id = p_token_id;

  if v_conta_id is null then raise exception 'not_found'; end if;
  if v_conta_id is distinct from public.get_my_conta_id() then
    raise exception 'forbidden';
  end if;
  -- [escopo] token de cliente que ele não acessa: mesmo erro de inexistente
  if not (public.my_client_scope_all() or public.can_access_cliente(v_cliente_id)) then
    raise exception 'not_found';
  end if;

  update client_hub_tokens t
     set expires_at = now() + interval '365 days'
   where t.id = p_token_id
  returning t.expires_at into v_new_expires;

  insert into audit_log (conta_id, actor_user_id, action, resource_type, resource_id, metadata)
  values (v_conta_id, auth.uid(), 'hub_token.extend', 'client_hub_tokens', p_token_id::text,
          jsonb_build_object('cliente_id', v_cliente_id,
                             'old_expires_at', v_old_expires,
                             'new_expires_at', v_new_expires));

  return v_new_expires;
end;
$function$;

CREATE OR REPLACE FUNCTION public.hub_token_rotate(p_token_id uuid)
 RETURNS TABLE(token uuid, expires_at timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_conta_id uuid;
  v_cliente_id bigint;
  v_old_expires timestamptz;
begin
  select t.conta_id, t.cliente_id, t.expires_at
    into v_conta_id, v_cliente_id, v_old_expires
    from client_hub_tokens t where t.id = p_token_id;

  if v_conta_id is null then raise exception 'not_found'; end if;
  if v_conta_id is distinct from public.get_my_conta_id() then
    raise exception 'forbidden';
  end if;
  -- [escopo] token de cliente que ele não acessa: mesmo erro de inexistente
  if not (public.my_client_scope_all() or public.can_access_cliente(v_cliente_id)) then
    raise exception 'not_found';
  end if;

  update client_hub_tokens t
     set token = gen_random_uuid(),
         expires_at = now() + interval '365 days'
   where t.id = p_token_id
  returning t.token, t.expires_at into token, expires_at;

  insert into audit_log (conta_id, actor_user_id, action, resource_type, resource_id, metadata)
  values (v_conta_id, auth.uid(), 'hub_token.rotate', 'client_hub_tokens', p_token_id::text,
          jsonb_build_object('cliente_id', v_cliente_id,
                             'old_expires_at', v_old_expires,
                             'new_expires_at', expires_at));

  return next;
end;
$function$;

