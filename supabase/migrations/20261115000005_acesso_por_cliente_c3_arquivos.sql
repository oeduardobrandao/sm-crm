-- Acesso por cliente, Migração C3 (arquivos): files, folders e post_file_links
-- respeitam o escopo do membro.
--
-- O cliente de uma pasta é o da pasta de origem mais próxima subindo parent_id:
--   client / client_reports -> source_id; workflow -> workflows.cliente_id;
--   post -> workflow_posts.cliente_id; root_clients ou topo sem origem -> sem
--   cliente. O cliente de um arquivo é o da pasta dele (folder_id NULL = sem
--   cliente). folder_cliente_id / folder_row_cliente_id fazem a subida, com teto
--   de profundidade (um ciclo de parent_id dá "sem cliente", nunca trava).
--
-- files (raiz de arquivo; "é dele" = uploaded_by):
--   leitura  = <qual atual> AND ((SELECT my_client_scope_all())
--              OR uploaded_by = auth.uid() OR can_access_cliente(cliente da pasta)
--              OR o arquivo está ligado a um post que ele vê (filha segue o item:
--              o post dele num cliente oculto inclui a mídia, mesmo de colega)).
--              Sem cliente e não dele: oculto ("trabalho sem cliente: escondido").
--   UPDATE   = USING e WITH CHECK com a regra de leitura (renomear, capa do vídeo
--              do post dele). O trigger zz_client_scope_guard barra trocar de pasta
--              sem acesso à ORIGEM (origem sem cliente só se o arquivo é dele) e ao
--              DESTINO, e fixa uploaded_by para qualquer usuário logado.
--   INSERT   = estrito: pasta de cliente que ele acessa (sem pasta / pasta sem
--              cliente só para quem vê todos os clientes).
--   DELETE   = estrito, exceto o upload dele sem cliente.
-- folders (sem coluna de autor, sem "é dele"):
--   leitura  = cliente acessível, mais a pasta raiz "Clientes" (root_clients):
--              só navegação, não guarda dado de cliente e é o pai de toda pasta
--              de cliente. Qualquer outra pasta sem cliente fica oculta.
--   escrita  = estrita pelo cliente da própria linha (USING na origem, WITH CHECK
--              no destino); root_clients nunca é gravável pelo restrito. O trigger
--              zz_client_scope_guard barra pôr uma pasta (inclusive marcada como de
--              outro cliente/post) dentro da árvore de um cliente que ele não acessa.
-- post_file_links (filha do post e porta de leitura do arquivo):
--   leitura e UPDATE pelo post visível (regra das filhas da C1); INSERT/UPDATE
--   exigem também o arquivo visível, senão o restrito ligaria um arquivo oculto ao
--   post dele e passaria a lê-lo; DELETE estrito (sem coluna de autor); trocar
--   post_id exige o post de origem acessível (guard_post_child_update da C1).
-- ideia_files não abre leitura de arquivo (a mídia da ideia vem pelo
-- ideia-media-manage, service role), então o file_id dele não precisa de guarda.
-- O termo (SELECT my_client_scope_all()) vem primeiro: é um initplan, então o
-- membro irrestrito não paga o resolvedor, can_access_cliente nem a consulta de
-- vínculo por linha. A consulta de vínculo é uma função plpgsql INVOKER (não
-- vira SubPlan por linha no plano e reusa a RLS de post_file_links).
-- Spec: docs/superpowers/specs/2026-11-03-acesso-por-cliente-design.md
-- Inventário: docs/superpowers/plans/2026-11-03-acesso-por-cliente-inventario.md

-- -------------------------------------------------------------
-- 0. Helpers
-- -------------------------------------------------------------
-- Cliente de uma pasta descrita pelas próprias colunas (o NEW de um INSERT ou
-- UPDATE em folders: buscar a linha pelo id veria a versão antiga). DEFINER: lê
-- folders, workflows e workflow_posts sem a RLS (a pasta do post dele num
-- cliente oculto continua resolvendo para o cliente certo). Só pastas, workflows
-- e posts do workspace ativo. Só service_role (e as guardas DEFINER): devolve o
-- cliente cru de qualquer pasta/workflow/post, então authenticated não a chama;
-- as policies usam folder_row_scope_cliente_id.
CREATE OR REPLACE FUNCTION public.folder_row_cliente_id(p_source_type text, p_source_id bigint, p_parent_id bigint)
RETURNS bigint
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_conta uuid := public.get_my_conta_id();
  v_type  text := p_source_type;
  v_src   bigint := p_source_id;
  v_par   bigint := p_parent_id;
  v_cli   bigint;
  v_depth integer := 0;
BEGIN
  IF v_conta IS NULL THEN RETURN NULL; END IF;
  LOOP
    IF v_type IN ('client', 'client_reports') THEN
      RETURN v_src;
    ELSIF v_type = 'workflow' THEN
      SELECT w.cliente_id INTO v_cli FROM public.workflows w
       WHERE w.id = v_src AND w.conta_id = v_conta;
      RETURN v_cli;
    ELSIF v_type = 'post' THEN
      SELECT wp.cliente_id INTO v_cli FROM public.workflow_posts wp
       WHERE wp.id = v_src AND wp.conta_id = v_conta;
      RETURN v_cli;
    ELSIF v_type = 'root_clients' THEN
      RETURN NULL;
    END IF;
    -- pasta comum: sobe para o pai (teto de profundidade contra ciclo)
    IF v_par IS NULL OR v_depth >= 32 THEN RETURN NULL; END IF;
    SELECT f.source_type, f.source_id, f.parent_id INTO v_type, v_src, v_par
      FROM public.folders f
     WHERE f.id = v_par AND f.conta_id = v_conta;
    IF NOT FOUND THEN RETURN NULL; END IF;
    v_depth := v_depth + 1;
  END LOOP;
END;
$$;
REVOKE ALL ON FUNCTION public.folder_row_cliente_id(text, bigint, bigint) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.folder_row_cliente_id(text, bigint, bigint) TO service_role;

-- Cliente da pasta p_folder_id (a de um arquivo). NULL = sem cliente. Só
-- service_role, como a de cima.
CREATE OR REPLACE FUNCTION public.folder_cliente_id(p_folder_id bigint)
RETURNS bigint
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_type text;
  v_src  bigint;
  v_par  bigint;
BEGIN
  IF p_folder_id IS NULL THEN RETURN NULL; END IF;
  SELECT f.source_type, f.source_id, f.parent_id INTO v_type, v_src, v_par
    FROM public.folders f
   WHERE f.id = p_folder_id AND f.conta_id = public.get_my_conta_id();
  IF NOT FOUND THEN RETURN NULL; END IF;
  RETURN public.folder_row_cliente_id(v_type, v_src, v_par);
END;
$$;
REVOKE ALL ON FUNCTION public.folder_cliente_id(bigint) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.folder_cliente_id(bigint) TO service_role;

-- Versões das policies (authenticated): devolvem o cliente só quando o usuário
-- atual o acessa; caso contrário NULL, que nas policies vira can_access_cliente
-- falso. NULL aqui não quer dizer "sem cliente": o "sem cliente e é dele" do
-- DELETE usa file_own_client_less. Assim um restrito que chama a função pelo
-- PostgREST não descobre de qual cliente é uma pasta, workflow ou post oculto.
CREATE OR REPLACE FUNCTION public.folder_scope_cliente_id(p_folder_id bigint)
RETURNS bigint
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cli bigint := public.folder_cliente_id(p_folder_id);
BEGIN
  IF v_cli IS NOT NULL AND public.can_access_cliente(v_cli) THEN RETURN v_cli; END IF;
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION public.folder_scope_cliente_id(bigint) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.folder_scope_cliente_id(bigint) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.folder_row_scope_cliente_id(p_source_type text, p_source_id bigint, p_parent_id bigint)
RETURNS bigint
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cli bigint := public.folder_row_cliente_id(p_source_type, p_source_id, p_parent_id);
BEGIN
  IF v_cli IS NOT NULL AND public.can_access_cliente(v_cli) THEN RETURN v_cli; END IF;
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION public.folder_row_scope_cliente_id(text, bigint, bigint) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.folder_row_scope_cliente_id(text, bigint, bigint) TO authenticated, service_role;

-- O arquivo é um upload do usuário atual, do workspace ativo, numa pasta sem
-- cliente (ou sem pasta): o único DELETE "é dele" de files. Responde só sobre os
-- arquivos dele.
CREATE OR REPLACE FUNCTION public.file_own_client_less(p_file_id bigint)
RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_folder bigint;
BEGIN
  IF auth.uid() IS NULL THEN RETURN false; END IF;
  SELECT f.folder_id INTO v_folder FROM public.files f
   WHERE f.id = p_file_id AND f.conta_id = public.get_my_conta_id()
     AND f.uploaded_by = auth.uid();
  IF NOT FOUND THEN RETURN false; END IF;
  RETURN public.folder_cliente_id(v_folder) IS NULL;
END;
$$;
REVOKE ALL ON FUNCTION public.file_own_client_less(bigint) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.file_own_client_less(bigint) TO authenticated, service_role;

-- O arquivo está ligado a um post que o usuário atual vê. INVOKER de propósito:
-- a consulta passa pela RLS de post_file_links (que segue o post visível,
-- inclusive o post dele num cliente oculto), sem duplicar a regra do post.
-- plpgsql não é inlinado: na policy de files fica uma chamada simples, depois do
-- initplan, e não um SubPlan por linha.
CREATE OR REPLACE FUNCTION public.file_linked_to_visible_post(p_file_id bigint)
RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  RETURN EXISTS (SELECT 1 FROM public.post_file_links l WHERE l.file_id = p_file_id);
END;
$$;
REVOKE ALL ON FUNCTION public.file_linked_to_visible_post(bigint) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.file_linked_to_visible_post(bigint) TO authenticated, service_role;

-- Guarda de files:
--   * uploaded_by (que libera a leitura e o DELETE "é dele") é imutável para
--     qualquer usuário logado. Exceção: vira NULL porque o usuário foi apagado
--     (FK ON DELETE SET NULL);
--   * para o restrito, trocar folder_id exige acesso ao cliente da pasta de ORIGEM
--     (origem sem cliente: só se o arquivo é dele) e ao da de DESTINO (sem pasta
--     ou pasta sem cliente: negado). Exceção: folder_id que vira NULL porque a
--     pasta foi apagada (FK ON DELETE SET NULL), que não é realocação.
-- auth.uid() NULL (service role, cron) passa; membro irrestrito sai no EXISTS do
-- escopo, antes de qualquer resolução de pasta.
CREATE OR REPLACE FUNCTION public.guard_file_scope_update()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid     uuid := auth.uid();
  v_old_cli bigint;
  v_new_cli bigint;
BEGIN
  IF v_uid IS NULL THEN RETURN NEW; END IF;
  IF NEW.uploaded_by IS DISTINCT FROM OLD.uploaded_by
     AND NOT (NEW.uploaded_by IS NULL
              AND NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id = OLD.uploaded_by)) THEN
    RAISE EXCEPTION 'author_immutable' USING ERRCODE = '42501';
  END IF;
  IF NEW.folder_id IS NOT DISTINCT FROM OLD.folder_id THEN RETURN NEW; END IF;
  IF NEW.folder_id IS NULL
     AND NOT EXISTS (SELECT 1 FROM public.folders f WHERE f.id = OLD.folder_id) THEN
    RETURN NEW;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.workspace_members wm
     WHERE wm.workspace_id = NEW.conta_id AND wm.user_id = v_uid
       AND wm.role <> 'owner' AND wm.client_scope = 'atribuidos'
  ) THEN
    RETURN NEW;
  END IF;
  v_old_cli := public.folder_cliente_id(OLD.folder_id);
  v_new_cli := public.folder_cliente_id(NEW.folder_id);
  IF (v_old_cli IS NULL AND OLD.uploaded_by IS DISTINCT FROM v_uid)
     OR (v_old_cli IS NOT NULL AND NOT public.can_access_cliente(v_uid, NEW.conta_id, v_old_cli))
     OR NOT public.can_access_cliente(v_uid, NEW.conta_id, v_new_cli) THEN
    RAISE EXCEPTION 'client_scope_restricted' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.guard_file_scope_update() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.guard_file_scope_update() TO service_role;

-- Prefixo zz: roda depois de trg_files_thumbnail_frame_reset e vê o NEW final.
CREATE TRIGGER zz_client_scope_guard
  BEFORE UPDATE OF folder_id, uploaded_by ON public.files
  FOR EACH ROW EXECUTE FUNCTION public.guard_file_scope_update();

-- Guarda de folders: para o restrito, a pasta nova ou movida não pode ficar
-- dentro da árvore de um cliente que ele não acessa, mesmo quando a própria linha
-- resolve para um cliente dele (pasta marcada como client/workflow/post de A
-- posta sob B). Pai sem cliente (root_clients, raiz) não é barrado aqui: a
-- própria linha ainda precisa de cliente acessível pelo WITH CHECK. Vale também
-- na RPC get_or_create_client_reports_folder (SECURITY DEFINER, roda com o
-- auth.uid() de quem chamou). Escrita feita por outro trigger
-- (pg_trigger_depth() > 1: folder_sync_cliente/_workflow/_post) passa: ela só
-- espelha uma linha de clientes/workflows/workflow_posts cuja escrita já foi
-- conferida pela RLS e pelas guardas dessas tabelas.
CREATE OR REPLACE FUNCTION public.guard_folder_scope_parent()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_cli bigint;
BEGIN
  IF v_uid IS NULL OR NEW.parent_id IS NULL OR pg_trigger_depth() > 1 THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' THEN
    IF NEW.parent_id IS NOT DISTINCT FROM OLD.parent_id THEN RETURN NEW; END IF;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.workspace_members wm
     WHERE wm.workspace_id = NEW.conta_id AND wm.user_id = v_uid
       AND wm.role <> 'owner' AND wm.client_scope = 'atribuidos'
  ) THEN
    RETURN NEW;
  END IF;
  v_cli := public.folder_cliente_id(NEW.parent_id);
  IF v_cli IS NOT NULL AND NOT public.can_access_cliente(v_uid, NEW.conta_id, v_cli) THEN
    RAISE EXCEPTION 'client_scope_restricted' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.guard_folder_scope_parent() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.guard_folder_scope_parent() TO service_role;

CREATE TRIGGER zz_client_scope_guard
  BEFORE INSERT OR UPDATE OF parent_id ON public.folders
  FOR EACH ROW EXECUTE FUNCTION public.guard_folder_scope_parent();

-- Vínculo de post: trocar post_id exige o post de ORIGEM acessível (senão o
-- restrito tiraria a mídia do post dele num cliente oculto e a apagaria). A
-- função da C1 trata post_id no ramo genérico; post_file_links não tem autor.
CREATE TRIGGER zz_client_scope_reparent_guard
  BEFORE UPDATE OF post_id ON public.post_file_links
  FOR EACH ROW EXECUTE FUNCTION public.guard_post_child_update();

-- -------------------------------------------------------------
-- 1. files
-- -------------------------------------------------------------
-- FOR ALL sem WITH CHECK até aqui. USING e WITH CHECK levam a regra de leitura;
-- INSERT e DELETE estritos pelas RESTRICTIVE abaixo; troca de pasta e autor pelo
-- trigger zz_client_scope_guard.
ALTER POLICY files_tenant_all ON public.files
  USING (
    conta_id IN (SELECT public.get_my_conta_id())
    AND ((SELECT public.my_client_scope_all())
         OR uploaded_by = (SELECT auth.uid())
         OR public.can_access_cliente(public.folder_scope_cliente_id(folder_id))
         OR public.file_linked_to_visible_post(id))
  )
  WITH CHECK (
    conta_id IN (SELECT public.get_my_conta_id())
    AND ((SELECT public.my_client_scope_all())
         OR uploaded_by = (SELECT auth.uid())
         OR public.can_access_cliente(public.folder_scope_cliente_id(folder_id))
         OR public.file_linked_to_visible_post(id))
  );
CREATE POLICY files_scope_insert ON public.files
  AS RESTRICTIVE FOR INSERT TO authenticated
  WITH CHECK (
    (SELECT public.my_client_scope_all())
    OR public.can_access_cliente(public.folder_scope_cliente_id(folder_id))
  );
CREATE POLICY files_scope_delete ON public.files
  AS RESTRICTIVE FOR DELETE TO authenticated
  USING (
    (SELECT public.my_client_scope_all())
    OR public.can_access_cliente(public.folder_scope_cliente_id(folder_id))
    OR (uploaded_by = (SELECT auth.uid()) AND public.file_own_client_less(id))
  );

-- -------------------------------------------------------------
-- 2. folders
-- -------------------------------------------------------------
ALTER POLICY folders_tenant_all ON public.folders
  USING (
    conta_id IN (SELECT public.get_my_conta_id())
    AND ((SELECT public.my_client_scope_all())
         OR public.can_access_cliente(public.folder_row_scope_cliente_id(source_type, source_id, parent_id))
         OR source_type = 'root_clients')
  )
  WITH CHECK (
    conta_id IN (SELECT public.get_my_conta_id())
    AND ((SELECT public.my_client_scope_all())
         OR public.can_access_cliente(public.folder_row_scope_cliente_id(source_type, source_id, parent_id)))
  );
-- root_clients é legível pela navegação, nunca gravável pelo restrito.
CREATE POLICY folders_scope_update ON public.folders
  AS RESTRICTIVE FOR UPDATE TO authenticated
  USING (
    (SELECT public.my_client_scope_all())
    OR public.can_access_cliente(public.folder_row_scope_cliente_id(source_type, source_id, parent_id))
  );
CREATE POLICY folders_scope_delete ON public.folders
  AS RESTRICTIVE FOR DELETE TO authenticated
  USING (
    (SELECT public.my_client_scope_all())
    OR public.can_access_cliente(public.folder_row_scope_cliente_id(source_type, source_id, parent_id))
  );

-- -------------------------------------------------------------
-- 3. post_file_links
-- -------------------------------------------------------------
-- Leitura e UPDATE pelo post visível. A escrita exige também o arquivo visível
-- (EXISTS em files sob a RLS dele): um vínculo é o que torna um arquivo legível
-- pelo post, então ligar um arquivo oculto ao post dele vazaria o arquivo. Num
-- UPDATE que não troca file_id o arquivo já é visível pelo próprio vínculo.
ALTER POLICY post_file_links_tenant_all ON public.post_file_links
  USING (
    conta_id IN (SELECT public.get_my_conta_id())
    AND ((SELECT public.my_client_scope_all())
         OR EXISTS (SELECT 1 FROM public.workflow_posts wp WHERE wp.id = post_file_links.post_id))
  )
  WITH CHECK (
    conta_id IN (SELECT public.get_my_conta_id())
    AND ((SELECT public.my_client_scope_all())
         OR (EXISTS (SELECT 1 FROM public.workflow_posts wp WHERE wp.id = post_file_links.post_id)
             AND EXISTS (SELECT 1 FROM public.files f WHERE f.id = post_file_links.file_id)))
  );
CREATE POLICY post_file_links_scope_delete ON public.post_file_links
  AS RESTRICTIVE FOR DELETE TO authenticated
  USING (
    (SELECT public.my_client_scope_all())
    OR EXISTS (SELECT 1 FROM public.workflow_posts wp
                WHERE wp.id = post_file_links.post_id AND public.can_access_cliente(wp.cliente_id))
  );

-- -------------------------------------------------------------
-- 4. RPC SECURITY DEFINER chamável por authenticated
-- -------------------------------------------------------------
-- get_or_create_client_reports_folder: corpo atual (pg_proc) + o escopo na
-- checagem de cliente, com o mesmo erro de inexistente. As demais funções que
-- escrevem nestas tabelas são só de service_role (o edge confere o escopo).
-- CREATE OR REPLACE mantém o ACL.
CREATE OR REPLACE FUNCTION public.get_or_create_client_reports_folder(p_cliente_id bigint)
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_ws            uuid := public.get_my_conta_id();
  v_nome          text;
  v_root          bigint;
  v_client_folder bigint;
  v_id            bigint;
BEGIN
  IF v_ws IS NULL OR NOT EXISTS (
    SELECT 1 FROM workspace_members WHERE workspace_id = v_ws AND user_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'not_found';
  END IF;

  SELECT nome INTO v_nome FROM clientes WHERE id = p_cliente_id AND conta_id = v_ws;
  -- acesso por cliente: cliente que ele não acessa responde como inexistente
  IF NOT FOUND OR NOT public.can_access_cliente(p_cliente_id) THEN
    RAISE EXCEPTION 'not_found';
  END IF;

  SELECT id INTO v_client_folder FROM folders
   WHERE conta_id = v_ws AND source_type = 'client' AND source_id = p_cliente_id;

  IF v_client_folder IS NULL THEN
    -- Cliente anterior ao trigger de pastas: cria a pasta no formato de
    -- folder_sync_cliente (20260425000005).
    SELECT id INTO v_root FROM folders WHERE conta_id = v_ws AND source_type = 'root_clients';
    IF v_root IS NULL THEN
      INSERT INTO folders (conta_id, name, source, source_type, source_id)
      VALUES (v_ws, 'Clientes', 'system', 'root_clients', 0)
      ON CONFLICT (conta_id, source_type, source_id)
        WHERE source_type IS NOT NULL AND source_id IS NOT NULL
      DO UPDATE SET name = folders.name
      RETURNING id INTO v_root;
    END IF;
    INSERT INTO folders (conta_id, parent_id, name, source, source_type, source_id)
    VALUES (v_ws, v_root, v_nome, 'system', 'client', p_cliente_id)
    ON CONFLICT (conta_id, source_type, source_id)
      WHERE source_type IS NOT NULL AND source_id IS NOT NULL
    DO UPDATE SET name = folders.name
    RETURNING id INTO v_client_folder;
  END IF;

  -- DO UPDATE no-op (não DO NOTHING) para o RETURNING sempre devolver a linha.
  INSERT INTO folders (conta_id, parent_id, name, source, source_type, source_id)
  VALUES (v_ws, v_client_folder, 'Relatórios', 'system', 'client_reports', p_cliente_id)
  ON CONFLICT (conta_id, source_type, source_id)
    WHERE source_type IS NOT NULL AND source_id IS NOT NULL
  DO UPDATE SET name = folders.name
  RETURNING id INTO v_id;

  RETURN v_id;
END $function$;
