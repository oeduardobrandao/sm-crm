-- Posts avulsos (fora de fluxo): notificacoes, pastas, health e mensagens.
-- Task 3 do plano .superpowers/sdd/2026-08-29-posts-avulsos-plan. Depende da
-- 20260829000001 (workflow_posts.cliente_id/conta_id sempre presentes; iguais
-- ao workflow enquanto anexado; workflow_id agora nullable para o avulso).
--
-- Copy-forward: cada funcao abaixo e a definicao completa da sua canonica,
-- com APENAS a troca de "achar conta/cliente via JOIN workflows [JOIN
-- clientes]" por "ler direto de workflow_posts", e o deep-link passando a
-- ser null-safe:
--   CASE WHEN v_workflow_id IS NULL THEN '/entregas?post=' || <post_id>
--        ELSE '/entregas?drawer=' || v_workflow_id END
-- (mantendo "&post=<id>" nos casos em que a canonica ja o inclui). Nenhuma
-- mudanca de comportamento para post anexado (cliente_id/conta_id ==
-- cliente/conta do workflow, pela invariante da 20260829000001); post avulso
-- deixa de ser descartado pelo JOIN / de virar link morto.
--
-- Item 9 do brief (Estudio: create_design/attach_design lendo cliente via
-- JOIN workflows, canonica citada 20260706000002_design_import_media_hold.sql)
-- NAO e aplicado nesta migration -- ver nota grande antes da secao 8.

-- ============================================================
-- 1) create_post_approval_notification + trg_notify_post_approval
-- Canonica: 20260505100001_approval_notification_rpc.sql (unico
-- CREATE OR REPLACE de ambas -- confirmado via grep, sem hits mais recentes).
-- Troca identica nas duas: o SELECT que buscava conta/cliente via
-- "FROM workflow_posts wp JOIN workflows w ON w.id = wp.workflow_id" passa a
-- ler wp.conta_id/wp.cliente_id direto (sem join); link vira o CASE
-- null-safe. RETURNS TABLE, CASE de v_type, resolve_notification_targets e o
-- corpo do EXCEPTION ficam intactos.
-- ============================================================
CREATE OR REPLACE FUNCTION create_post_approval_notification(
  p_post_id bigint,
  p_action text,
  p_comentario text DEFAULT NULL
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_responsavel_id bigint;
  v_workflow_id    bigint;
  v_conta_id       uuid;
  v_cliente_id     bigint;
  v_post_title     text;
  v_client_name    text;
  v_targets        uuid[];
  v_type           text;
  v_link           text;
  v_metadata       jsonb;
  v_count          integer := 0;
BEGIN
  SELECT wp.responsavel_id, wp.workflow_id, wp.titulo,
         wp.conta_id, wp.cliente_id
    INTO v_responsavel_id, v_workflow_id, v_post_title, v_conta_id, v_cliente_id
    FROM workflow_posts wp
   WHERE wp.id = p_post_id;

  IF v_conta_id IS NULL THEN
    RETURN 0;
  END IF;

  SELECT nome INTO v_client_name FROM clientes WHERE id = v_cliente_id;

  v_type := CASE p_action
    WHEN 'aprovado' THEN 'post_approved'
    WHEN 'correcao' THEN 'post_correction'
    WHEN 'mensagem' THEN 'post_message'
    ELSE NULL
  END;

  IF v_type IS NULL THEN
    RETURN 0;
  END IF;

  v_targets := resolve_notification_targets(v_conta_id, v_responsavel_id, ARRAY['owner','admin']);

  IF v_targets IS NULL OR array_length(v_targets, 1) IS NULL THEN
    RETURN 0;
  END IF;

  v_link := CASE WHEN v_workflow_id IS NULL
    THEN '/entregas?post=' || p_post_id
    ELSE '/entregas?drawer=' || v_workflow_id
  END;
  v_metadata := jsonb_build_object(
    'client_name', v_client_name,
    'post_title',  v_post_title,
    'workflow_id', v_workflow_id,
    'post_id',     p_post_id
  );

  IF v_type IN ('post_correction', 'post_message') THEN
    v_metadata := v_metadata || jsonb_build_object('comentario', p_comentario);
  END IF;

  PERFORM insert_notification_batch(v_conta_id, v_targets, v_type, v_link, v_metadata, NULL);

  v_count := array_length(v_targets, 1);
  RETURN COALESCE(v_count, 0);
END;
$$;
REVOKE ALL ON FUNCTION create_post_approval_notification(bigint, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION create_post_approval_notification(bigint, text, text) TO service_role;

CREATE OR REPLACE FUNCTION trg_notify_post_approval()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_responsavel_id bigint;
  v_workflow_id    bigint;
  v_conta_id       uuid;
  v_cliente_id     bigint;
  v_post_title     text;
  v_client_name    text;
  v_targets        uuid[];
  v_type           text;
  v_link           text;
  v_metadata       jsonb;
BEGIN
  -- Hub-originated approvals are handled by the edge function via
  -- create_post_approval_notification() RPC for better error visibility.
  IF NEW.is_workspace_user = false THEN
    RETURN NEW;
  END IF;

  BEGIN
    SELECT wp.responsavel_id, wp.workflow_id, wp.titulo,
           wp.conta_id, wp.cliente_id
      INTO v_responsavel_id, v_workflow_id, v_post_title, v_conta_id, v_cliente_id
      FROM workflow_posts wp
     WHERE wp.id = NEW.post_id;

    IF v_conta_id IS NULL THEN
      RETURN NEW;
    END IF;

    SELECT nome INTO v_client_name FROM clientes WHERE id = v_cliente_id;

    v_type := CASE NEW.action
      WHEN 'aprovado' THEN 'post_approved'
      WHEN 'correcao' THEN 'post_correction'
      WHEN 'mensagem' THEN 'post_message'
      ELSE NULL
    END;

    IF v_type IS NULL THEN
      RETURN NEW;
    END IF;

    v_targets := resolve_notification_targets(v_conta_id, v_responsavel_id, ARRAY['owner','admin']);
    v_link := CASE WHEN v_workflow_id IS NULL
      THEN '/entregas?post=' || NEW.post_id
      ELSE '/entregas?drawer=' || v_workflow_id
    END;
    v_metadata := jsonb_build_object(
      'client_name', v_client_name,
      'post_title',  v_post_title,
      'workflow_id', v_workflow_id,
      'post_id',     NEW.post_id
    );

    IF v_type IN ('post_correction', 'post_message') THEN
      v_metadata := v_metadata || jsonb_build_object('comentario', NEW.comentario);
    END IF;

    PERFORM insert_notification_batch(v_conta_id, v_targets, v_type, v_link, v_metadata, auth.uid());
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'trg_notify_post_approval failed: % %', SQLERRM, SQLSTATE;
  END;
  RETURN NEW;
END;
$$;

-- ============================================================
-- 2) create_edit_suggestion_notification
-- Canonica: 20260521000001_post_edit_suggestions.sql (unico
-- CREATE OR REPLACE, confirmado via grep). Mesma reforma do item 1.
-- ============================================================
CREATE OR REPLACE FUNCTION create_edit_suggestion_notification(p_post_id bigint)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_responsavel_id bigint;
  v_workflow_id    bigint;
  v_conta_id       uuid;
  v_cliente_id     bigint;
  v_post_title     text;
  v_client_name    text;
  v_targets        uuid[];
  v_link           text;
  v_metadata       jsonb;
  v_count          integer := 0;
BEGIN
  SELECT wp.responsavel_id, wp.workflow_id, wp.titulo,
         wp.conta_id, wp.cliente_id
    INTO v_responsavel_id, v_workflow_id, v_post_title, v_conta_id, v_cliente_id
    FROM workflow_posts wp
   WHERE wp.id = p_post_id;

  IF v_conta_id IS NULL THEN
    RETURN 0;
  END IF;

  SELECT nome INTO v_client_name FROM clientes WHERE id = v_cliente_id;

  v_targets := resolve_notification_targets(v_conta_id, v_responsavel_id, ARRAY['owner','admin']);

  IF v_targets IS NULL OR array_length(v_targets, 1) IS NULL THEN
    RETURN 0;
  END IF;

  v_link := CASE WHEN v_workflow_id IS NULL
    THEN '/entregas?post=' || p_post_id
    ELSE '/entregas?drawer=' || v_workflow_id
  END;
  v_metadata := jsonb_build_object(
    'client_name', v_client_name,
    'post_title',  v_post_title,
    'workflow_id', v_workflow_id,
    'post_id',     p_post_id
  );

  PERFORM insert_notification_batch(v_conta_id, v_targets, 'post_edit_suggestion', v_link, v_metadata, NULL);

  v_count := array_length(v_targets, 1);
  RETURN COALESCE(v_count, 0);
END;
$$;
REVOKE ALL ON FUNCTION create_edit_suggestion_notification(bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION create_edit_suggestion_notification(bigint) TO service_role;

-- ============================================================
-- 3) trg_notify_post_assigned
-- Canonica: 20260504000001_post_assigned_only_target_user.sql (unico
-- CREATE OR REPLACE, confirmado via grep). O SELECT que buscava
-- "w.conta_id, c.nome FROM workflows w LEFT JOIN clientes c ON c.id =
-- w.cliente_id WHERE w.id = NEW.workflow_id" sai por completo: NEW ja carrega
-- conta_id/cliente_id (trigger roda em workflow_posts), entao o nome do
-- cliente vem de um SELECT direto em clientes. A guarda "v_conta_id IS NULL"
-- fica como estava -- hoje nunca dispara (NEW.conta_id e NOT NULL), mas e
-- inofensiva e mantem o mesmo formato defensivo dos outros trg_notify_*.
-- ============================================================
CREATE OR REPLACE FUNCTION trg_notify_post_assigned()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_conta_id    uuid;
  v_client_name text;
  v_targets     uuid[];
BEGIN
  BEGIN
    v_conta_id := NEW.conta_id;
    SELECT nome INTO v_client_name FROM clientes WHERE id = NEW.cliente_id;

    IF v_conta_id IS NULL THEN
      RETURN NEW;
    END IF;

    v_targets := resolve_notification_targets(v_conta_id, NEW.responsavel_id, NULL);

    PERFORM insert_notification_batch(
      v_conta_id,
      v_targets,
      'post_assigned',
      CASE WHEN NEW.workflow_id IS NULL
        THEN '/entregas?post=' || NEW.id
        ELSE '/entregas?drawer=' || NEW.workflow_id
      END,
      jsonb_build_object(
        'client_name', v_client_name,
        'post_title',  NEW.titulo,
        'workflow_id', NEW.workflow_id,
        'post_id',     NEW.id
      ),
      auth.uid()
    );
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'trg_notify_post_assigned failed: % %', SQLERRM, SQLSTATE;
  END;
  RETURN NEW;
END;
$$;

-- ============================================================
-- 4) trg_notify_post_publish_failed
-- Canonica: 20260807000003_post_publish_failed_notification.sql (unico
-- CREATE OR REPLACE, confirmado via grep). O SELECT
-- "c.nome FROM workflows w JOIN clientes c ON c.id = w.cliente_id WHERE
-- w.id = NEW.workflow_id" vira "SELECT nome FROM clientes WHERE id =
-- NEW.cliente_id". O link ganha o CASE null-safe, mantendo "&post=" || NEW.id
-- no ramo anexado (a canonica ja o inclui).
-- ============================================================
CREATE OR REPLACE FUNCTION trg_notify_post_publish_failed()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_client_name text;
  v_targets     uuid[];
  v_notify      boolean := false;
BEGIN
  BEGIN
    IF OLD.status IS DISTINCT FROM NEW.status
       AND NEW.publish_error_code IN
         ('TOKEN_EXPIRED','MEDIA_TOO_LARGE','CAROUSEL_LIMIT','NO_MEDIA','MEDIA_UNSUPPORTED') THEN
      v_notify := true;
    ELSIF COALESCE(OLD.publish_retry_count, 0) < 3
       AND COALESCE(NEW.publish_retry_count, 0) >= 3 THEN
      v_notify := true;
    ELSIF OLD.publish_error_code IS DISTINCT FROM NEW.publish_error_code
       AND NEW.publish_error_code IN
         ('TOKEN_EXPIRED','MEDIA_TOO_LARGE','CAROUSEL_LIMIT','NO_MEDIA','MEDIA_UNSUPPORTED') THEN
      v_notify := true;
    END IF;

    IF v_notify THEN
      SELECT nome INTO v_client_name FROM clientes WHERE id = NEW.cliente_id;

      v_targets := resolve_notification_targets(NEW.conta_id, NEW.responsavel_id, ARRAY['owner','admin']);

      PERFORM insert_notification_batch(
        NEW.conta_id,
        v_targets,
        'post_publish_failed',
        CASE WHEN NEW.workflow_id IS NULL
          THEN '/entregas?post=' || NEW.id
          ELSE '/entregas?drawer=' || NEW.workflow_id || '&post=' || NEW.id
        END,
        jsonb_build_object(
          'post_id',            NEW.id,
          'workflow_id',        NEW.workflow_id,
          'post_title',         NEW.titulo,
          'client_name',        v_client_name,
          'publish_error_code', NEW.publish_error_code
        ),
        NULL
      );
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'trg_notify_post_publish_failed failed: % %', SQLERRM, SQLSTATE;
  END;
  RETURN NEW;
END;
$$;

-- ============================================================
-- 5) trg_notify_mention
-- Canonica: 20260803000006_mencoes.sql (unico CREATE OR REPLACE, confirmado
-- via grep). Dois branches mudam:
--  - workflow_post: o guard "IF v_workflow_id IS NULL THEN RETURN NEW"
--    detectava "host sumiu" usando o workflow como proxy -- mas workflow_id
--    agora e legitimamente NULL num avulso que EXISTE. Troca para
--    "v_context_title IS NULL" (titulo e `text NOT NULL DEFAULT ''` em
--    workflow_posts, 20260402_workflow_posts.sql:16 -- so fica NULL se o
--    SELECT nao achou linha nenhuma). Link vira o CASE null-safe.
--  - post_comment: mesma troca de guard (titulo vem do JOIN workflow_posts;
--    NULL so quando o JOIN nao encontrou linha) e mesmo CASE no link.
-- Branch tarefa fica intocado (nunca dependeu de workflow).
-- ============================================================
CREATE OR REPLACE FUNCTION trg_notify_mention()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor_name    text;
  v_context_title text;
  v_excerpt       text;
  v_workflow_id   bigint;
  v_post_id       bigint;
  v_task_id       bigint;
  v_link          text;
  v_metadata      jsonb;
  v_targets       uuid[];
BEGIN
  BEGIN
    -- Actor: prefer the membro record linked to the author's CRM login
    -- (matches the display name used elsewhere in the app); fall back to
    -- the auth.users profile for authors with no membro row yet.
    SELECT nome INTO v_actor_name
      FROM membros
     WHERE crm_user_id = NEW.author_id
       AND conta_id = NEW.conta_id
     LIMIT 1;

    IF v_actor_name IS NULL THEN
      SELECT COALESCE(raw_user_meta_data->>'full_name', email) INTO v_actor_name
        FROM auth.users
       WHERE id = NEW.author_id;
    END IF;

    IF NEW.host_type = 'tarefa' THEN
      SELECT titulo INTO v_context_title FROM tarefas WHERE id = NEW.host_id;
      IF v_context_title IS NULL THEN
        RETURN NEW; -- host vanished between insert and trigger; nothing to notify
      END IF;
      v_task_id := NEW.host_id;
      v_link := '/tarefas?tarefa=' || NEW.host_id;

    ELSIF NEW.host_type = 'workflow_post' THEN
      SELECT titulo, workflow_id INTO v_context_title, v_workflow_id
        FROM workflow_posts
       WHERE id = NEW.host_id;
      -- v_context_title (nao v_workflow_id) e o proxy de "host sumiu": titulo
      -- e NOT NULL DEFAULT '' em workflow_posts, entao so fica NULL quando o
      -- SELECT acima nao achou a linha -- workflow_id sozinho nao serve mais
      -- porque um avulso existente tem workflow_id NULL de forma legitima.
      IF v_context_title IS NULL THEN
        RETURN NEW; -- host vanished between insert and trigger; nothing to notify
      END IF;
      v_post_id := NEW.host_id;
      v_link := CASE WHEN v_workflow_id IS NULL
        THEN '/entregas?post=' || v_post_id
        ELSE '/entregas?drawer=' || v_workflow_id
      END;

    ELSIF NEW.host_type = 'post_comment' THEN
      -- Belt and suspenders: AND wp.conta_id = NEW.conta_id, in addition to
      -- the mencoes_tenant_all WITH CHECK guard above -- even if a malformed
      -- cross-workspace thread row somehow exists, this SECURITY DEFINER
      -- trigger must never read (and copy into a notification) a post title
      -- from a different workspace.
      SELECT wp.titulo, wp.workflow_id, wp.id, left(pc.content, 140)
        INTO v_context_title, v_workflow_id, v_post_id, v_excerpt
        FROM post_comments pc
        JOIN post_comment_threads pct ON pct.id = pc.thread_id
        JOIN workflow_posts wp ON wp.id = pct.post_id AND wp.conta_id = NEW.conta_id
       WHERE pc.id = NEW.host_id;
      -- Same proxy swap as the workflow_post branch above: v_context_title
      -- NULL means the JOIN found nothing, not "no workflow".
      IF v_context_title IS NULL THEN
        RETURN NEW;
      END IF;
      v_link := CASE WHEN v_workflow_id IS NULL
        THEN '/entregas?post=' || v_post_id
        ELSE '/entregas?drawer=' || v_workflow_id
      END;
    END IF;

    v_metadata := jsonb_strip_nulls(jsonb_build_object(
      'actor_name',    v_actor_name,
      'host_type',     NEW.host_type,
      'host_id',       NEW.host_id,
      'context_title', v_context_title,
      'excerpt',       v_excerpt,
      'workflow_id',   v_workflow_id,
      'post_id',       v_post_id,
      'task_id',       v_task_id
    ));

    -- p_responsavel_id doubles here as "the mentioned membro": resolve_notification_targets
    -- appends that membro's crm_user_id (if set) to the target list, and with
    -- p_roles_filter NULL no extra role-based targets are added -- exactly
    -- the mentioned person, nobody else.
    v_targets := resolve_notification_targets(NEW.conta_id, NEW.mentioned_membro_id, NULL);

    -- p_exclude_actor = NEW.author_id silences self-mentions.
    PERFORM insert_notification_batch(NEW.conta_id, v_targets, 'mention', v_link, v_metadata, NEW.author_id);
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'trg_notify_mention failed: % %', SQLERRM, SQLSTATE;
  END;
  RETURN NEW;
END;
$$;

-- ============================================================
-- 6) folder_sync_post
-- Canonica: 20260425000002_file_system_triggers.sql (unico CREATE OR
-- REPLACE, confirmado via grep). source_type do CHECK em folders e
-- ('client', 'workflow', 'post') -- 20260425000001_file_system_tables.sql:12
-- -- 'client', NAO 'cliente'.
-- INSERT: pai passa a ser a pasta do workflow quando workflow_id IS NOT
-- NULL, senao a pasta do cliente (source_type='client').
-- UPDATE: alem do rename por titulo (ja existia), um novo bloco reage a
-- "workflow_id IS DISTINCT FROM OLD.workflow_id" (anexar/desanexar um
-- avulso a um fluxo) recalculando o pai do mesmo jeito do INSERT e fazendo
-- UPDATE folders SET parent_id = ..., updated_at = now() WHERE
-- source_type='post' AND source_id = NEW.id AND conta_id = NEW.conta_id --
-- mesmo padrao de reparent que folder_sync_workflow ja usa (linhas 63-69 da
-- canonica) quando um workflow muda de cliente.
-- ============================================================
CREATE OR REPLACE FUNCTION folder_sync_post() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_parent_id     bigint;
  v_new_parent_id bigint;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.workflow_id IS NOT NULL THEN
      SELECT id INTO v_parent_id FROM folders
      WHERE source_type = 'workflow' AND source_id = NEW.workflow_id AND conta_id = NEW.conta_id;
    ELSE
      SELECT id INTO v_parent_id FROM folders
      WHERE source_type = 'client' AND source_id = NEW.cliente_id AND conta_id = NEW.conta_id;
    END IF;

    INSERT INTO folders (conta_id, parent_id, name, source, source_type, source_id)
    VALUES (NEW.conta_id, v_parent_id, NEW.titulo, 'system', 'post', NEW.id);
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF NEW.titulo IS DISTINCT FROM OLD.titulo THEN
      UPDATE folders SET name = NEW.titulo, updated_at = now()
      WHERE source_type = 'post' AND source_id = NEW.id
        AND conta_id = NEW.conta_id AND name_overridden = false;
    END IF;

    -- Detach (attached -> avulso) ou attach (avulso -> attached) move a pasta
    -- do post para debaixo do pai correto.
    IF NEW.workflow_id IS DISTINCT FROM OLD.workflow_id THEN
      IF NEW.workflow_id IS NOT NULL THEN
        SELECT id INTO v_new_parent_id FROM folders
        WHERE source_type = 'workflow' AND source_id = NEW.workflow_id AND conta_id = NEW.conta_id;
      ELSE
        SELECT id INTO v_new_parent_id FROM folders
        WHERE source_type = 'client' AND source_id = NEW.cliente_id AND conta_id = NEW.conta_id;
      END IF;

      UPDATE folders SET parent_id = v_new_parent_id, updated_at = now()
      WHERE source_type = 'post' AND source_id = NEW.id AND conta_id = NEW.conta_id;
    END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'DELETE' THEN
    DELETE FROM folders
    WHERE source_type = 'post' AND source_id = OLD.id AND conta_id = OLD.conta_id;
    RETURN OLD;
  END IF;

  RETURN NULL;
END;
$$;

-- ============================================================
-- 7) get_client_health_aggregates
-- Canonica: 20260625130000_client_health_aggregates.sql (unico
-- CREATE OR REPLACE, confirmado via grep). SECURITY INVOKER preservado.
-- Unica troca: a CTE "pipe" perde o INNER JOIN workflows (que descartava
-- avulso por completo) e passa a agrupar por wp.cliente_id direto; um LEFT
-- JOIN workflows so serve mais para checar w.status = 'ativo' QUANDO o post
-- esta anexado -- "wp.workflow_id IS NULL OR w.status = 'ativo'" deixa o
-- avulso contar sempre e preserva a regra antiga para o anexado.
-- ============================================================
CREATE OR REPLACE FUNCTION get_client_health_aggregates(p_window_days int DEFAULT 28)
RETURNS TABLE (
  client_id bigint,
  client_name text,
  client_sigla text,
  client_cor text,
  connected boolean,
  username text,
  profile_picture_url text,
  follower_count int,
  authorization_status text,
  token_expires_at timestamptz,
  last_synced_at timestamptz,
  follower_first int,
  follower_points int,
  follower_series int[],
  interactions_cur bigint,
  reach_cur bigint,
  posts_cur int,
  reach_prev bigint,
  posts_56d int,
  last_post_at timestamptz,
  pl_agendados int,
  pl_em_producao int,
  pl_agente int,
  pl_falha int
)
LANGUAGE sql
SECURITY INVOKER
SET search_path = public
AS $$
WITH cli AS (
  SELECT c.id, c.nome, c.sigla, c.cor
  FROM clientes c
  WHERE c.status = 'ativo'
    AND c.conta_id IN (SELECT public.get_my_conta_id())
),
acc AS (
  SELECT DISTINCT ON (a.client_id)
    a.id AS account_id, a.client_id, a.username, a.profile_picture_url,
    a.follower_count, a.authorization_status, a.token_expires_at, a.last_synced_at
  FROM instagram_accounts a
  WHERE a.client_id IN (SELECT id FROM cli)
  ORDER BY a.client_id, a.last_synced_at DESC NULLS LAST, a.id
),
fh AS (
  SELECT h.instagram_account_id AS account_id,
         (array_agg(h.follower_count ORDER BY h.date))[1] AS follower_first,
         count(*)::int AS follower_points,
         array_agg(h.follower_count ORDER BY h.date)::int[] AS follower_series
  FROM instagram_follower_history h
  WHERE h.instagram_account_id IN (SELECT account_id FROM acc)
    AND h.date::date >= current_date - p_window_days
  GROUP BY h.instagram_account_id
),
pc AS (
  SELECT p.instagram_account_id AS account_id,
         sum(coalesce(p.likes,0)+coalesce(p.comments,0)+coalesce(p.saved,0)+coalesce(p.shares,0))::bigint AS interactions_cur,
         sum(coalesce(p.reach,0))::bigint AS reach_cur,
         count(*)::int AS posts_cur
  FROM instagram_posts p
  WHERE p.instagram_account_id IN (SELECT account_id FROM acc)
    AND p.posted_at >= (now() - (p_window_days * interval '1 day'))
  GROUP BY p.instagram_account_id
),
pp AS (
  SELECT p.instagram_account_id AS account_id,
         sum(coalesce(p.reach,0))::bigint AS reach_prev
  FROM instagram_posts p
  WHERE p.instagram_account_id IN (SELECT account_id FROM acc)
    AND p.posted_at >= (now() - (2 * p_window_days * interval '1 day'))
    AND p.posted_at <  (now() - (p_window_days * interval '1 day'))
  GROUP BY p.instagram_account_id
),
pall AS (
  -- Posts over 2 × p_window_days (posts_56d is "2× the window", 56 days at default)
  SELECT p.instagram_account_id AS account_id,
         count(*)::int AS posts_56d
  FROM instagram_posts p
  WHERE p.instagram_account_id IN (SELECT account_id FROM acc)
    AND p.posted_at >= (now() - (2 * p_window_days * interval '1 day'))
  GROUP BY p.instagram_account_id
),
plast AS (
  -- Unbounded last post per account — not capped to the window so Inativo detection works
  SELECT p.instagram_account_id AS account_id,
         max(p.posted_at) AS last_post_at
  FROM instagram_posts p
  WHERE p.instagram_account_id IN (SELECT account_id FROM acc)
  GROUP BY p.instagram_account_id
),
pipe AS (
  -- Avulso (workflow_id NULL) sempre conta; anexado so conta enquanto o
  -- workflow esta ativo -- mesma regra de antes, lida direto do post em vez
  -- de exigir o INNER JOIN workflows que descartava o avulso inteiro.
  SELECT wp.cliente_id AS client_id,
         count(*) FILTER (WHERE wp.status = 'agendado')::int AS pl_agendados,
         count(*) FILTER (WHERE wp.status IN ('rascunho','revisao_interna','aprovado_interno','enviado_cliente','aprovado_cliente','correcao_cliente'))::int AS pl_em_producao,
         count(*) FILTER (WHERE wp.created_via = 'agent')::int AS pl_agente,
         count(*) FILTER (WHERE wp.status = 'falha_publicacao')::int AS pl_falha
  FROM workflow_posts wp
  LEFT JOIN workflows w ON w.id = wp.workflow_id
  WHERE wp.cliente_id IN (SELECT id FROM cli)
    AND (wp.workflow_id IS NULL OR w.status = 'ativo')
  GROUP BY wp.cliente_id
)
SELECT
  cli.id::bigint,
  cli.nome,
  cli.sigla,
  cli.cor,
  (acc.account_id IS NOT NULL AND acc.authorization_status IS DISTINCT FROM 'disconnected') AS connected,
  acc.username,
  acc.profile_picture_url,
  coalesce(acc.follower_count, 0)::int,
  acc.authorization_status,
  acc.token_expires_at,
  acc.last_synced_at,
  coalesce(fh.follower_first, 0)::int,
  coalesce(fh.follower_points, 0)::int,
  coalesce(fh.follower_series, ARRAY[]::int[]),
  coalesce(pc.interactions_cur, 0)::bigint,
  coalesce(pc.reach_cur, 0)::bigint,
  coalesce(pc.posts_cur, 0)::int,
  coalesce(pp.reach_prev, 0)::bigint,
  coalesce(pall.posts_56d, 0)::int,
  plast.last_post_at,
  coalesce(pipe.pl_agendados, 0)::int,
  coalesce(pipe.pl_em_producao, 0)::int,
  coalesce(pipe.pl_agente, 0)::int,
  coalesce(pipe.pl_falha, 0)::int
FROM cli
LEFT JOIN acc  ON acc.client_id = cli.id
LEFT JOIN fh   ON fh.account_id = acc.account_id
LEFT JOIN pc   ON pc.account_id = acc.account_id
LEFT JOIN pp   ON pp.account_id = acc.account_id
LEFT JOIN pall  ON pall.account_id  = acc.account_id
LEFT JOIN plast ON plast.account_id = acc.account_id
LEFT JOIN pipe  ON pipe.client_id   = cli.id
ORDER BY cli.nome;
$$;

GRANT EXECUTE ON FUNCTION get_client_health_aggregates(int) TO authenticated;

-- ============================================================
-- 8) Mensagens: get_mensagens_feed + get_mensagens_unread (canonica
-- 20260731000003_mensagens_consolidadas.sql) e get_mensagens_conversas
-- (canonica 20260731000007_conversas_instagram_avatar.sql -- NAO a
-- 20260731000005/000006, superadas por ela; confirmado via grep, esta e a
-- unica definicao apos a data do brief e a unica com cliente_foto_url).
-- Nos tres, os branches post_feedback/post_approvals e edit_suggestion
-- perdem "JOIN workflows w ON w.id = wp.workflow_id" e passam a ler
-- wp.cliente_id / wp.conta_id direto (o branch edit_suggestion ja filtrava
-- por es.conta_id, entao so troca w.cliente_id -> wp.cliente_id). Branch
-- mensagem, ja lia m.cliente_id/m.conta_id direto -- intocado.
-- ============================================================
CREATE OR REPLACE FUNCTION get_mensagens_feed(
  p_conta_id       uuid        DEFAULT NULL,
  p_cliente_id     bigint      DEFAULT NULL,
  p_before         timestamptz DEFAULT NULL,
  p_limit          int         DEFAULT 50,
  p_before_source  text        DEFAULT NULL,
  p_before_item_id bigint      DEFAULT NULL
)
RETURNS TABLE (
  source            text,
  item_id           bigint,
  cliente_id        bigint,
  cliente_nome      text,
  post_id           bigint,
  workflow_id       bigint,
  post_titulo       text,
  action            text,
  content           text,
  is_workspace_user boolean,
  author_user_id    uuid,
  author_name       text,
  author_avatar_url text,
  created_at        timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_conta uuid;
BEGIN
  IF auth.uid() IS NOT NULL THEN
    SELECT public.get_my_conta_id() INTO v_conta;
    IF v_conta IS NULL THEN
      RAISE EXCEPTION 'No active workspace';
    END IF;
    IF p_conta_id IS NOT NULL AND p_conta_id <> v_conta THEN
      RAISE EXCEPTION 'Forbidden';
    END IF;
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
$$;

REVOKE ALL ON FUNCTION get_mensagens_feed(uuid, bigint, timestamptz, int, text, bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION get_mensagens_feed(uuid, bigint, timestamptz, int, text, bigint)
  TO authenticated, service_role;

-- ============ UNREAD RPC ============
CREATE OR REPLACE FUNCTION get_mensagens_unread(
  p_conta_id   uuid   DEFAULT NULL,
  p_cliente_id bigint DEFAULT NULL
)
RETURNS TABLE (cliente_id bigint, unread_count bigint)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_conta uuid;
  v_uid   uuid;
  v_since timestamptz;
BEGIN
  v_uid := auth.uid();

  IF v_uid IS NOT NULL THEN
    SELECT public.get_my_conta_id() INTO v_conta;
    IF v_conta IS NULL THEN RETURN; END IF;

    SELECT ls.last_seen_at INTO v_since
      FROM mensagens_last_seen ls
     WHERE ls.conta_id = v_conta AND ls.user_id = v_uid;
    v_since := COALESCE(v_since, '-infinity'::timestamptz);

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
      ) f
     WHERE f.f_created_at > v_since
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
      ) f
     WHERE f.f_created_at > v_since;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION get_mensagens_unread(uuid, bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION get_mensagens_unread(uuid, bigint)
  TO authenticated, service_role;

-- ============ CONVERSAS RPC (v3, cliente_foto_url) ============
CREATE OR REPLACE FUNCTION get_mensagens_conversas()
RETURNS TABLE (
  cliente_id             bigint,
  cliente_nome           text,
  cliente_foto_url       text,
  last_source            text,
  last_action            text,
  last_content           text,
  last_is_workspace_user boolean,
  last_author_name       text,
  last_created_at        timestamptz,
  unread_count           bigint
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_conta uuid;
  v_uid   uuid;
  v_since timestamptz;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'authenticated only';
  END IF;

  SELECT public.get_my_conta_id() INTO v_conta;
  IF v_conta IS NULL THEN RETURN; END IF;

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
   ORDER BY l.f_created_at DESC NULLS LAST, c.nome;
END;
$$;

REVOKE ALL ON FUNCTION get_mensagens_conversas() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION get_mensagens_conversas() TO authenticated;

-- ============================================================
-- Item 9 do brief -- Estudio (create_design/attach_design) -- NAO APLICADO.
--
-- O brief cita 20260706000002_design_import_media_hold.sql como canonica de
-- create_design (~linha 47) e attach_design (~linha 174), ambas com
-- "FROM workflow_posts p JOIN workflows w ON w.id = p.workflow_id" para
-- derivar o cliente. Mas grepando supabase/migrations/*.sql por
-- create_design/attach_design a lista completa e:
--   20260705000001_designs_first_class.sql       (cria)
--   20260706000001_estudio_enviado_cliente_editable.sql (redefine)
--   20260706000002_design_import_media_hold.sql  (redefine -- a canonica citada)
--   20260722000002_drop_estudio_objects.sql       (DROP FUNCTION ... CASCADE)
-- 20260722000002 (merged em main via PR #240, 2026-07-23 -- confirmado com
-- `git branch --contains`, muito antes deste plano de posts avulsos comecar)
-- e uma retirada deliberada de todo o Estudio: derruba create_design,
-- attach_design, save_design_blob, detach_design, finalize_design_render e
-- as tabelas designs/post_designs/design_asset_refs/ai_image_generations,
-- com asserts (secao 7 daquele arquivo) que abortam a migration se qualquer
-- funcao com "design" no nome sobreviver. Nenhuma migration posterior
-- recria esses nomes ou a tabela designs (confirmado via grep na arvore
-- inteira). O comentario daquele arquivo: "All existing design data is
-- test data (the feature never left dark mode; confirmed 2026-07-22)".
--
-- Ou seja: a canonica que o brief cita nao e mais a definicao vigente --
-- a funcao create_design/attach_design NAO EXISTE no schema atual. Recriar
-- essas duas funcoes aqui ressuscitaria uma feature deliberadamente
-- retirada (e faria referencia a uma tabela `designs` que nao existe mais,
-- quebrando o deploy). Aplicando a INTENCAO do brief -- corrigir uma
-- feature viva que quebraria para um post avulso -- concluo que nao ha o
-- que corrigir: sem create_design/attach_design, "criar/anexar design num
-- avulso" nao e um caminho que exista para dar post_not_found. Este item
-- fica de fora desta migration; ver task-3-report.md para o achado
-- completo.
-- ============================================================
