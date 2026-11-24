-- Login do cliente no Hub (spec docs/superpowers/specs/2026-11-23-hub-client-login-design.md).
--
-- 1. Tabelas: hub_client_people (quem do cliente pode entrar), hub_client_settings (o switch
--    require_login, por cliente), hub_login_codes (código de 6 dígitos por e-mail, só o hash
--    com salt) e hub_sessions (sessão por e-mail, só o hash do token). As quatro: RLS ligada,
--    policy só de service_role, nenhum privilégio para anon/authenticated.
-- 2. RPCs do CRM (hub_people_list/add/remove, hub_set_require_login): workspace, escopo de
--    acesso por cliente e configuracoes:editar, invariantes sob lock por cliente, audit_log.
-- 3. RPCs de serviço (hub_access_context, hub_login_issue/verify, hub_session_touch/delete,
--    hub_login_cleanup): só service_role. Código e token de sessão nunca vão ao audit_log.
-- 4. Autoria do cliente: post_approvals/mensagens ganham hub_person_id + hub_person_nome
--    (snapshot do nome). Só service role grava (trigger hub_person_guard).
-- 5. record_client_approval, record_client_approval_with_notes (dois parâmetros no fim, com
--    default) e get_mensagens_feed (coluna client_person_name no fim) recriados com os
--    mesmos grants.

-- ---------------------------------------------------------------------------
-- 1. Tabelas
-- ---------------------------------------------------------------------------

CREATE TABLE public.hub_client_people (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conta_id      uuid NOT NULL,
  cliente_id    bigint NOT NULL REFERENCES public.clientes(id) ON DELETE CASCADE,
  nome          text NOT NULL CHECK (char_length(nome) BETWEEN 1 AND 80),
  email         text NOT NULL CHECK (email = lower(btrim(email))),
  created_at    timestamptz NOT NULL DEFAULT now(),
  created_by    uuid,
  last_login_at timestamptz,
  UNIQUE (cliente_id, email)
);

CREATE TABLE public.hub_client_settings (
  cliente_id    bigint PRIMARY KEY REFERENCES public.clientes(id) ON DELETE CASCADE,
  conta_id      uuid NOT NULL,
  require_login boolean NOT NULL DEFAULT false,
  updated_at    timestamptz NOT NULL DEFAULT now(),
  updated_by    uuid
);

CREATE TABLE public.hub_login_codes (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cliente_id bigint NOT NULL REFERENCES public.clientes(id) ON DELETE CASCADE,
  email      text NOT NULL,
  code_hash  text NOT NULL,
  salt       text NOT NULL,
  expires_at timestamptz NOT NULL,
  attempts   int NOT NULL DEFAULT 0,
  used_at    timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX hub_login_codes_cliente_email_idx
  ON public.hub_login_codes (cliente_id, email, created_at DESC);

CREATE TABLE public.hub_sessions (
  token_hash   text PRIMARY KEY CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  email        text NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz NOT NULL DEFAULT now(),
  expires_at   timestamptz NOT NULL
);
CREATE INDEX hub_sessions_email_idx ON public.hub_sessions (email);

ALTER TABLE public.hub_client_people   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hub_client_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hub_login_codes     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hub_sessions        ENABLE ROW LEVEL SECURITY;

CREATE POLICY hub_client_people_service_role ON public.hub_client_people
  FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY hub_client_settings_service_role ON public.hub_client_settings
  FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY hub_login_codes_service_role ON public.hub_login_codes
  FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY hub_sessions_service_role ON public.hub_sessions
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- REVOKE FROM PUBLIC sozinho não tira o grant padrão de anon/authenticated: os três nomeados.
REVOKE ALL ON public.hub_client_people, public.hub_client_settings,
              public.hub_login_codes, public.hub_sessions
  FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.hub_client_people, public.hub_client_settings,
             public.hub_login_codes, public.hub_sessions
  TO service_role;

-- ---------------------------------------------------------------------------
-- 4. Autoria do cliente
-- ---------------------------------------------------------------------------

ALTER TABLE public.post_approvals
  ADD COLUMN hub_person_id uuid REFERENCES public.hub_client_people(id) ON DELETE SET NULL,
  ADD COLUMN hub_person_nome text;
ALTER TABLE public.mensagens
  ADD COLUMN hub_person_id uuid REFERENCES public.hub_client_people(id) ON DELETE SET NULL,
  ADD COLUMN hub_person_nome text;

-- A FK ON DELETE SET NULL varre a coluna ao remover uma pessoa: índice parcial (a maioria
-- das linhas é de autoria da agência ou de link sem login e fica de fora).
CREATE INDEX IF NOT EXISTS post_approvals_hub_person_id_idx
  ON public.post_approvals (hub_person_id) WHERE hub_person_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS mensagens_hub_person_id_idx
  ON public.mensagens (hub_person_id) WHERE hub_person_id IS NOT NULL;

-- Só o service role (edges do Hub, auth.uid() nulo) grava a autoria. Usuário logado: no
-- INSERT as duas colunas viram nulas; no UPDATE o nome fica o antigo e o id só pode ir para
-- NULL (o ON DELETE SET NULL da FK chega como UPDATE com o usuário do CRM que removeu a
-- pessoa pelo hub_people_remove), nunca para outro id.
CREATE OR REPLACE FUNCTION public.hub_person_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'INSERT' THEN
    NEW.hub_person_id := NULL;
    NEW.hub_person_nome := NULL;
  ELSE
    NEW.hub_person_nome := OLD.hub_person_nome;
    NEW.hub_person_id := CASE WHEN NEW.hub_person_id IS NULL THEN NULL ELSE OLD.hub_person_id END;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.hub_person_guard() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER hub_person_guard
  BEFORE INSERT OR UPDATE ON public.post_approvals
  FOR EACH ROW EXECUTE FUNCTION public.hub_person_guard();
CREATE TRIGGER hub_person_guard
  BEFORE INSERT OR UPDATE ON public.mensagens
  FOR EACH ROW EXECUTE FUNCTION public.hub_person_guard();

-- ---------------------------------------------------------------------------
-- 2. RPCs do CRM
-- ---------------------------------------------------------------------------

-- Guarda comum, na ordem: cliente existe, é do workspace ativo, está no escopo do membro
-- (mesmo erro de inexistente) e o membro tem configuracoes:editar. Devolve o conta_id.
-- Só chamada de dentro das RPCs abaixo.
CREATE OR REPLACE FUNCTION public._hub_people_guard(p_cliente_id bigint)
RETURNS uuid
LANGUAGE plpgsql
STABLE
SET search_path = public, pg_temp
AS $$
DECLARE
  v_conta_id uuid;
BEGIN
  SELECT c.conta_id INTO v_conta_id FROM clientes c WHERE c.id = p_cliente_id;
  IF v_conta_id IS NULL THEN
    RAISE EXCEPTION 'not_found';
  END IF;
  IF v_conta_id IS DISTINCT FROM public.get_my_conta_id() THEN
    RAISE EXCEPTION 'not_found';
  END IF;
  IF NOT (public.my_client_scope_all() OR public.can_access_cliente(p_cliente_id)) THEN
    RAISE EXCEPTION 'not_found';
  END IF;
  IF NOT public.has_permission_for(auth.uid(), v_conta_id, 'configuracoes', 'editar') THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
  RETURN v_conta_id;
END;
$$;
REVOKE ALL ON FUNCTION public._hub_people_guard(bigint) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.hub_people_list(p_cliente_id bigint)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  PERFORM public._hub_people_guard(p_cliente_id);
  RETURN jsonb_build_object(
    'require_login', coalesce((SELECT s.require_login FROM hub_client_settings s
                                WHERE s.cliente_id = p_cliente_id), false),
    'people', coalesce((SELECT jsonb_agg(jsonb_build_object(
                                 'id', p.id, 'nome', p.nome, 'email', p.email,
                                 'last_login_at', p.last_login_at, 'created_at', p.created_at)
                               ORDER BY p.created_at, p.id)
                          FROM hub_client_people p WHERE p.cliente_id = p_cliente_id), '[]'::jsonb));
END;
$$;

CREATE OR REPLACE FUNCTION public.hub_people_add(p_cliente_id bigint, p_nome text, p_email text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_conta_id uuid;
  v_nome  text := btrim(coalesce(p_nome, ''));
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_id uuid;
BEGIN
  v_conta_id := public._hub_people_guard(p_cliente_id);

  IF char_length(v_nome) NOT BETWEEN 1 AND 80
     OR char_length(v_email) > 254
     OR v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' THEN
    RAISE EXCEPTION 'invalid';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('hub_people:' || p_cliente_id::text, 0));

  IF EXISTS (SELECT 1 FROM hub_client_people p WHERE p.cliente_id = p_cliente_id AND p.email = v_email) THEN
    RAISE EXCEPTION 'duplicate';
  END IF;
  IF (SELECT count(*) FROM hub_client_people p WHERE p.cliente_id = p_cliente_id) >= 20 THEN
    RAISE EXCEPTION 'limit';
  END IF;

  INSERT INTO hub_client_people (conta_id, cliente_id, nome, email, created_by)
  VALUES (v_conta_id, p_cliente_id, v_nome, v_email, auth.uid())
  RETURNING id INTO v_id;

  INSERT INTO audit_log (conta_id, actor_user_id, action, resource_type, resource_id, metadata)
  VALUES (v_conta_id, auth.uid(), 'hub_people.add', 'hub_client_people', v_id::text,
          jsonb_build_object('cliente_id', p_cliente_id, 'email', v_email));

  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.hub_people_remove(p_person_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_conta_id uuid;
  v_cliente_id bigint;
  v_email text;
BEGIN
  SELECT p.cliente_id INTO v_cliente_id FROM hub_client_people p WHERE p.id = p_person_id;
  IF v_cliente_id IS NULL THEN
    RAISE EXCEPTION 'not_found';
  END IF;
  v_conta_id := public._hub_people_guard(v_cliente_id);

  PERFORM pg_advisory_xact_lock(hashtextextended('hub_people:' || v_cliente_id::text, 0));

  IF coalesce((SELECT s.require_login FROM hub_client_settings s WHERE s.cliente_id = v_cliente_id), false)
     AND (SELECT count(*) FROM hub_client_people p WHERE p.cliente_id = v_cliente_id) <= 1 THEN
    RAISE EXCEPTION 'last_person';
  END IF;

  DELETE FROM hub_client_people p WHERE p.id = p_person_id RETURNING p.email INTO v_email;
  IF v_email IS NULL THEN
    RAISE EXCEPTION 'not_found';
  END IF;

  -- A sessão é por e-mail: quem saiu da lista de todos os clientes perde o acesso já.
  -- Quem segue na lista de outro cliente mantém a sessão.
  DELETE FROM hub_sessions s
   WHERE s.email = v_email
     AND NOT EXISTS (SELECT 1 FROM hub_client_people p WHERE p.email = s.email);

  INSERT INTO audit_log (conta_id, actor_user_id, action, resource_type, resource_id, metadata)
  VALUES (v_conta_id, auth.uid(), 'hub_people.remove', 'hub_client_people', p_person_id::text,
          jsonb_build_object('cliente_id', v_cliente_id, 'email', v_email));
END;
$$;

CREATE OR REPLACE FUNCTION public.hub_set_require_login(p_cliente_id bigint, p_value boolean)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_conta_id uuid;
  v_value boolean := coalesce(p_value, false);
BEGIN
  v_conta_id := public._hub_people_guard(p_cliente_id);

  PERFORM pg_advisory_xact_lock(hashtextextended('hub_people:' || p_cliente_id::text, 0));

  IF v_value AND NOT EXISTS (SELECT 1 FROM hub_client_people p WHERE p.cliente_id = p_cliente_id) THEN
    RAISE EXCEPTION 'no_people';
  END IF;

  INSERT INTO hub_client_settings (cliente_id, conta_id, require_login, updated_at, updated_by)
  VALUES (p_cliente_id, v_conta_id, v_value, now(), auth.uid())
  ON CONFLICT (cliente_id) DO UPDATE
    SET require_login = EXCLUDED.require_login,
        updated_at = EXCLUDED.updated_at,
        updated_by = EXCLUDED.updated_by;

  INSERT INTO audit_log (conta_id, actor_user_id, action, resource_type, resource_id, metadata)
  VALUES (v_conta_id, auth.uid(), 'hub_login.require', 'hub_client_people', p_cliente_id::text,
          jsonb_build_object('cliente_id', p_cliente_id, 'require_login', v_value));
END;
$$;

REVOKE ALL ON FUNCTION public.hub_people_list(bigint)                 FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.hub_people_add(bigint, text, text)      FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.hub_people_remove(uuid)                 FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.hub_set_require_login(bigint, boolean)  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.hub_people_list(bigint)                TO authenticated;
GRANT EXECUTE ON FUNCTION public.hub_people_add(bigint, text, text)     TO authenticated;
GRANT EXECUTE ON FUNCTION public.hub_people_remove(uuid)                TO authenticated;
GRANT EXECUTE ON FUNCTION public.hub_set_require_login(bigint, boolean) TO authenticated;

-- ---------------------------------------------------------------------------
-- 3. RPCs de serviço
-- ---------------------------------------------------------------------------

-- person só quando há sessão válida para o hash e o e-mail dela está na lista do cliente.
CREATE OR REPLACE FUNCTION public.hub_access_context(p_cliente_id bigint, p_session_hash text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_person jsonb;
BEGIN
  IF p_session_hash IS NOT NULL THEN
    SELECT jsonb_build_object('id', p.id, 'nome', p.nome, 'email', p.email) INTO v_person
      FROM hub_sessions s
      JOIN hub_client_people p ON p.cliente_id = p_cliente_id AND p.email = s.email
     WHERE s.token_hash = p_session_hash AND s.expires_at > now();
  END IF;
  RETURN jsonb_build_object(
    'require_login', coalesce((SELECT s.require_login FROM hub_client_settings s
                                WHERE s.cliente_id = p_cliente_id), false),
    'person', v_person);
END;
$$;

-- false, sem escrita, quando o e-mail não está na lista do cliente. Senão invalida os
-- códigos anteriores do par (cliente, e-mail) e grava o novo (10 minutos), só o hash.
CREATE OR REPLACE FUNCTION public.hub_login_issue(p_cliente_id bigint, p_email text, p_code text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_salt  text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM hub_client_people p WHERE p.cliente_id = p_cliente_id AND p.email = v_email) THEN
    RETURN false;
  END IF;

  UPDATE hub_login_codes c
     SET used_at = now()
   WHERE c.cliente_id = p_cliente_id AND c.email = v_email AND c.used_at IS NULL;

  v_salt := encode(extensions.gen_random_bytes(16), 'hex');
  INSERT INTO hub_login_codes (cliente_id, email, code_hash, salt, expires_at)
  VALUES (p_cliente_id, v_email,
          encode(sha256(convert_to(v_salt || ':' || p_code, 'UTF8')), 'hex'),
          v_salt, now() + interval '10 minutes');
  RETURN true;
END;
$$;

-- Nunca levanta exceção para código errado: um raise desfaria o incremento de attempts.
CREATE OR REPLACE FUNCTION public.hub_login_verify(p_cliente_id bigint, p_email text, p_code text, p_session_hash text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_row   hub_login_codes%ROWTYPE;
BEGIN
  SELECT * INTO v_row
    FROM hub_login_codes c
   WHERE c.cliente_id = p_cliente_id AND c.email = v_email
     AND c.used_at IS NULL AND c.expires_at > now()
   ORDER BY c.created_at DESC, c.id DESC
   LIMIT 1
   FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false);
  END IF;
  IF v_row.attempts >= 5 THEN
    RETURN jsonb_build_object('ok', false);
  END IF;

  UPDATE hub_login_codes SET attempts = attempts + 1 WHERE id = v_row.id;

  IF encode(sha256(convert_to(v_row.salt || ':' || coalesce(p_code, ''), 'UTF8')), 'hex')
     IS DISTINCT FROM v_row.code_hash THEN
    RETURN jsonb_build_object('ok', false);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM hub_client_people p WHERE p.cliente_id = p_cliente_id AND p.email = v_email) THEN
    RETURN jsonb_build_object('ok', false);
  END IF;

  UPDATE hub_login_codes SET used_at = now() WHERE id = v_row.id;
  INSERT INTO hub_sessions (token_hash, email, expires_at)
  VALUES (p_session_hash, v_email, now() + interval '90 days');
  UPDATE hub_client_people SET last_login_at = now()
   WHERE cliente_id = p_cliente_id AND email = v_email;

  RETURN jsonb_build_object('ok', true);
END;
$$;

-- Janela deslizante de 90 dias, renovada no máximo uma vez por dia por sessão.
CREATE OR REPLACE FUNCTION public.hub_session_touch(p_session_hash text)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  UPDATE hub_sessions
     SET last_used_at = now(), expires_at = now() + interval '90 days'
   WHERE token_hash = p_session_hash
     AND expires_at > now()
     AND last_used_at < now() - interval '1 day';
$$;

CREATE OR REPLACE FUNCTION public.hub_session_delete(p_session_hash text)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  DELETE FROM hub_sessions WHERE token_hash = p_session_hash;
$$;

CREATE OR REPLACE FUNCTION public.hub_login_cleanup()
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  DELETE FROM hub_login_codes WHERE expires_at < now() - interval '1 day';
  DELETE FROM hub_sessions WHERE expires_at < now();
$$;

REVOKE ALL ON FUNCTION public.hub_access_context(bigint, text)             FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.hub_login_issue(bigint, text, text)          FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.hub_login_verify(bigint, text, text, text)   FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.hub_session_touch(text)                      FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.hub_session_delete(text)                     FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.hub_login_cleanup()                          FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.hub_access_context(bigint, text)           TO service_role;
GRANT EXECUTE ON FUNCTION public.hub_login_issue(bigint, text, text)        TO service_role;
GRANT EXECUTE ON FUNCTION public.hub_login_verify(bigint, text, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.hub_session_touch(text)                    TO service_role;
GRANT EXECUTE ON FUNCTION public.hub_session_delete(text)                   TO service_role;
GRANT EXECUTE ON FUNCTION public.hub_login_cleanup()                        TO service_role;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'hub-login-cleanup') THEN
    PERFORM cron.unschedule('hub-login-cleanup');
  END IF;
END $$;
SELECT cron.schedule('hub-login-cleanup', '17 * * * *', $$select public.hub_login_cleanup()$$);

-- ---------------------------------------------------------------------------
-- 5. RPCs recriadas (corpo atual, mudando só o listado)
-- ---------------------------------------------------------------------------

DROP FUNCTION public.record_client_approval_with_notes(bigint, uuid, bigint, text, text, text, text, text);
DROP FUNCTION public.record_client_approval(bigint, text, text, text, boolean, text, text);

CREATE FUNCTION public.record_client_approval(
  p_post_id bigint, p_token text, p_action text, p_comentario text,
  p_is_workspace_user boolean, p_new_status text, p_motivo text DEFAULT NULL::text,
  p_hub_person_id uuid DEFAULT NULL, p_hub_person_nome text DEFAULT NULL)
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_approval bigint;
begin
  perform 1 from workflow_posts where id = p_post_id for update;

  if not coalesce(p_is_workspace_user, false)
     and p_action in ('aprovado', 'correcao')
     and exists (
       select 1 from post_edit_suggestions
        where post_id = p_post_id and status = 'pending'
     )
  then
    raise exception 'pending_suggestion' using errcode = 'P0001';
  end if;

  insert into post_approvals (post_id, token, action, comentario, is_workspace_user, motivo,
                              hub_person_id, hub_person_nome)
  values (p_post_id, p_token, p_action, p_comentario, p_is_workspace_user, p_motivo,
          p_hub_person_id, p_hub_person_nome)
  returning id into v_approval;

  perform set_config('app.event_source',     'client',         true);
  perform set_config('app.post_approval_id', v_approval::text, true);

  update workflow_posts set status = p_new_status where id = p_post_id;

  return v_approval;
end;
$function$;

REVOKE ALL ON FUNCTION public.record_client_approval(bigint, text, text, text, boolean, text, text, uuid, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_client_approval(bigint, text, text, text, boolean, text, text, uuid, text)
  TO service_role;

CREATE FUNCTION public.record_client_approval_with_notes(
  p_post_id bigint, p_conta_id uuid, p_cliente_id bigint, p_token text, p_action text,
  p_comentario text, p_new_status text, p_motivo text DEFAULT NULL::text,
  p_hub_person_id uuid DEFAULT NULL, p_hub_person_nome text DEFAULT NULL)
 RETURNS TABLE(approval_id bigint, open_note_count integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_conta    uuid;
  v_status   text;
  v_approval bigint;
  v_count    int;
BEGIN
  SELECT wp.conta_id, wp.status INTO v_conta, v_status
    FROM workflow_posts wp
   WHERE wp.id = p_post_id AND wp.conta_id = p_conta_id AND wp.cliente_id = p_cliente_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'post_not_found';
  END IF;
  IF v_status NOT IN ('enviado_cliente', 'correcao_cliente') THEN
    RAISE EXCEPTION 'post_not_pending';
  END IF;

  -- Trava TODA nota do cliente no post, não só as abertas: um reabrir do CRM
  -- (resolved -> open) de uma nota resolvida espera este commit, então o
  -- snapshot abaixo e o status das notas não divergem.
  PERFORM 1 FROM post_media_notes n
   WHERE n.post_id = p_post_id AND n.visibility = 'client'
   FOR UPDATE;

  v_approval := record_client_approval(p_post_id, p_token, p_action, p_comentario, false,
                                       p_new_status, p_motivo, p_hub_person_id, p_hub_person_nome);

  INSERT INTO post_approval_media_notes (post_approval_id, note_id)
  SELECT v_approval, n.id
    FROM post_media_notes n
   WHERE n.post_id = p_post_id AND n.visibility = 'client' AND n.status = 'open';
  GET DIAGNOSTICS v_count = ROW_COUNT;

  RETURN QUERY SELECT v_approval, v_count;
END;
$function$;

REVOKE ALL ON FUNCTION public.record_client_approval_with_notes(bigint, uuid, bigint, text, text, text, text, text, uuid, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_client_approval_with_notes(bigint, uuid, bigint, text, text, text, text, text, uuid, text)
  TO service_role;

DROP FUNCTION public.get_mensagens_feed(uuid, bigint, timestamptz, integer, text, bigint);

CREATE FUNCTION public.get_mensagens_feed(p_conta_id uuid DEFAULT NULL::uuid, p_cliente_id bigint DEFAULT NULL::bigint, p_before timestamp with time zone DEFAULT NULL::timestamp with time zone, p_limit integer DEFAULT 50, p_before_source text DEFAULT NULL::text, p_before_item_id bigint DEFAULT NULL::bigint)
 RETURNS TABLE(source text, item_id bigint, cliente_id bigint, cliente_nome text, post_id bigint, workflow_id bigint, post_titulo text, action text, content text, is_workspace_user boolean, author_user_id uuid, author_name text, author_avatar_url text, created_at timestamp with time zone, client_person_name text)
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
           pa.created_at AS f_created_at, pa.hub_person_nome AS f_person_name
      FROM post_approvals pa
      JOIN workflow_posts wp ON wp.id = pa.post_id
     WHERE wp.conta_id = v_conta
    UNION ALL
    SELECT 'edit_suggestion', es.id,
           wp.cliente_id, wp.id, wp.workflow_id, wp.titulo,
           es.status, left(es.suggested_conteudo_plain, 280),
           false, NULL::uuid, es.created_at, NULL::text
      FROM post_edit_suggestions es
      JOIN workflow_posts wp ON wp.id = es.post_id
     WHERE es.conta_id = v_conta
    UNION ALL
    SELECT 'mensagem', m.id,
           m.cliente_id, NULL::bigint, NULL::bigint, NULL::text,
           NULL::text, m.content,
           m.is_workspace_user, m.author_user_id, m.created_at, m.hub_person_nome
      FROM mensagens m
     WHERE m.conta_id = v_conta
    UNION ALL
    -- Feedback em mídia: só notas visíveis ao cliente (nota de cliente é
    -- sempre client; a interna e suas respostas nunca entram).
    SELECT 'media_note', n.id,
           wp.cliente_id, wp.id, wp.workflow_id, wp.titulo,
           'nota', left(n.body, 280),
           false, NULL::uuid, n.created_at, NULL::text
      FROM post_media_notes n
      JOIN workflow_posts wp ON wp.id = n.post_id
     WHERE n.conta_id = v_conta AND n.visibility = 'client'
    UNION ALL
    SELECT 'media_note_reply', r.id,
           wp.cliente_id, wp.id, wp.workflow_id, wp.titulo,
           'resposta_nota', left(r.body, 280),
           r.author_kind = 'team', r.author_user_id, r.created_at, NULL::text
      FROM post_media_note_replies r
      JOIN post_media_notes n ON n.id = r.note_id AND n.visibility = 'client' AND n.conta_id = v_conta
      JOIN workflow_posts wp ON wp.id = n.post_id
     WHERE r.conta_id = v_conta
  )
  SELECT f.f_source, f.f_item_id, f.f_cliente_id, c.nome,
         f.f_post_id, f.f_workflow_id, f.f_post_titulo,
         f.f_action, f.f_content, f.f_iwu,
         f.f_author, mb.nome, mb.avatar_url,
         f.f_created_at, f.f_person_name
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

REVOKE ALL ON FUNCTION public.get_mensagens_feed(uuid, bigint, timestamptz, integer, text, bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_mensagens_feed(uuid, bigint, timestamptz, integer, text, bigint)
  TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Conferência do ACL: anon/authenticated/PUBLIC sem nenhum privilégio nas quatro tabelas.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_bad text;
BEGIN
  SELECT string_agg(c.relname || ':' || coalesce(r.rolname, 'PUBLIC') || ':' || a.privilege_type, ', ')
    INTO v_bad
    FROM pg_class c
    CROSS JOIN LATERAL aclexplode(c.relacl) a
    LEFT JOIN pg_roles r ON r.oid = a.grantee
   WHERE c.oid IN ('public.hub_client_people'::regclass, 'public.hub_client_settings'::regclass,
                   'public.hub_login_codes'::regclass, 'public.hub_sessions'::regclass)
     AND (a.grantee = 0 OR r.rolname IN ('anon', 'authenticated'));
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'hub login tables still grant privileges: %', v_bad;
  END IF;
END $$;
