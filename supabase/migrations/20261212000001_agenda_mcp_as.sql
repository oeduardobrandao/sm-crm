-- Agenda no MCP do workspace (spec docs/superpowers/specs/2026-11-27-mcp-agenda-design.md).
--
-- 1. Ator do MCP. As ferramentas da agenda no MCP chamam, como service_role, wrappers *_as
--    (seções 2 e 3, em tarefas seguintes desta migration) que gravam o usuário da chave ou do
--    grant em set_config('mesaas.agenda_actor', <uuid>, true) antes de chamar o core. Sem
--    jwt, auth.uid() é NULL e os gatilhos zz_client_scope_guard da agenda saíam cedo; agora
--    eles, agenda_cliente_substituir_pedidos (resolvido_por) e agenda_definir_convidados
--    (adicionado_por e o audit_log) leem o ator por _agenda_actor() =
--    coalesce(auth.uid(), setting). Só aperta: quem está logado sempre tem auth.uid(), que
--    vence a setting, e o service_role sem a setting segue como antes (sem restrição).
--    agenda_pode_ver_evento ganha a forma de 4 argumentos com o usuário explícito, para os
--    cores; a de 3 argumentos segue com auth.uid() (é ela que a RLS usa) e delega.
--    Os corpos são cópias das versões vigentes (20261117000006, 20261007000001,
--    20261008000002, 20261005000001) com as linhas do ator marcadas com [mcp].
--
-- 2 e 3. (cores, wrappers *_as e CRM) entram em tarefas seguintes.

-- ============================================================ 1. ator do MCP

CREATE OR REPLACE FUNCTION public._agenda_actor()
 RETURNS uuid
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  SELECT coalesce(auth.uid(), nullif(current_setting('mesaas.agenda_actor', true), '')::uuid);
$function$;
REVOKE ALL ON FUNCTION public._agenda_actor() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public._agenda_actor() TO authenticated, service_role;

-- [mcp] forma com usuário explícito; mesmo corpo da de 3 argumentos com p_user no lugar de auth.uid()
CREATE OR REPLACE FUNCTION public.agenda_pode_ver_evento(p_evento_id bigint, p_privado boolean, p_organizador uuid, p_user uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT NOT p_privado
      OR p_organizador = p_user
      OR EXISTS (SELECT 1 FROM public.agenda_participantes ap
                 WHERE ap.evento_id = p_evento_id AND ap.user_id = p_user);
$function$;
REVOKE ALL ON FUNCTION public.agenda_pode_ver_evento(bigint, boolean, uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.agenda_pode_ver_evento(bigint, boolean, uuid, uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.agenda_pode_ver_evento(p_evento_id bigint, p_privado boolean, p_organizador uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT public.agenda_pode_ver_evento(p_evento_id, p_privado, p_organizador, auth.uid());  -- [mcp] delega
$function$;
REVOKE ALL ON FUNCTION public.agenda_pode_ver_evento(bigint, boolean, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.agenda_pode_ver_evento(bigint, boolean, uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.guard_agenda_evento_scope()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid     uuid := public._agenda_actor();  -- [mcp] auth.uid() ou o ator do MCP
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
$function$;
REVOKE ALL ON FUNCTION public.guard_agenda_evento_scope() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.guard_agenda_evento_scope() TO service_role;

CREATE OR REPLACE FUNCTION public.guard_agenda_participante_scope()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid    uuid := public._agenda_actor();  -- [mcp] auth.uid() ou o ator do MCP
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
$function$;
REVOKE ALL ON FUNCTION public.guard_agenda_participante_scope() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.guard_agenda_participante_scope() TO service_role;

CREATE OR REPLACE FUNCTION public.agenda_cliente_substituir_pedidos(p_evento bigint, p_ocorrencia bigint DEFAULT NULL::bigint, p_desde date DEFAULT NULL::date)
 RETURNS void
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  UPDATE public.agenda_remarcacoes rm
     SET status = 'substituida', resolvido_em = now(), resolvido_por = public._agenda_actor()  -- [mcp]
    FROM public.agenda_ocorrencias o
   WHERE rm.ocorrencia_id = o.id
     AND rm.status = 'pendente'
     AND o.evento_id = p_evento
     AND (p_ocorrencia IS NULL OR o.id = p_ocorrencia)
     AND (p_desde IS NULL OR o.data_original >= p_desde);
$function$;
REVOKE ALL ON FUNCTION public.agenda_cliente_substituir_pedidos(bigint, bigint, date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.agenda_cliente_substituir_pedidos(bigint, bigint, date) TO service_role;

CREATE OR REPLACE FUNCTION public.agenda_definir_convidados(p_evento bigint, p_convidados jsonb, OUT adicionados bigint[], OUT removidos bigint[])
 RETURNS record
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_e public.agenda_eventos;
  v_user uuid := public._agenda_actor();  -- [mcp] auth.uid() ou o ator do MCP
  v_lista jsonb := '[]'::jsonb;  -- [{email, nome, tem_nome, n}] normalized, deduplicated
  x jsonb;
  v_n int := 0;
  v_email text;
  v_membro text;
  v_novos text[];
  v_contar text[];
  v_ws int;
  v_plat int;
BEGIN
  SELECT e.* INTO v_e FROM public.agenda_eventos e WHERE e.id = p_evento;
  IF NOT FOUND THEN RAISE EXCEPTION 'agenda: este evento não existe mais'; END IF;

  IF p_convidados IS NULL OR jsonb_typeof(p_convidados) <> 'array' THEN
    RAISE EXCEPTION 'agenda: informe e-mails válidos para os convidados.';
  END IF;
  FOR x IN SELECT t.e FROM jsonb_array_elements(p_convidados) WITH ORDINALITY AS t(e, n) ORDER BY t.n LOOP
    IF jsonb_typeof(x) <> 'object' OR jsonb_typeof(x->'email') IS DISTINCT FROM 'string'
       OR (x ? 'nome' AND jsonb_typeof(x->'nome') NOT IN ('string', 'null')) THEN
      RAISE EXCEPTION 'agenda: informe e-mails válidos para os convidados.';
    END IF;
    v_email := lower(btrim(x->>'email'));
    IF char_length(v_email) > 254 OR v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' THEN
      RAISE EXCEPTION 'agenda: informe e-mails válidos para os convidados.';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_lista) y WHERE y->>'email' = v_email) THEN
      v_n := v_n + 1;
      v_lista := v_lista || jsonb_build_array(jsonb_build_object(
        'email', v_email,
        'nome', left(NULLIF(btrim(x->>'nome'), ''), 120),
        'tem_nome', x ? 'nome',
        'n', v_n));
    END IF;
  END LOOP;

  IF jsonb_array_length(v_lista) > 20 THEN
    RAISE EXCEPTION 'agenda: no máximo 20 convidados externos por evento.';
  END IF;
  IF v_e.privado AND jsonb_array_length(v_lista) > 0 THEN
    RAISE EXCEPTION 'agenda: evento privado não pode ter convidados externos.';
  END IF;
  SELECT y->>'email' INTO v_membro
    FROM jsonb_array_elements(v_lista) y
   WHERE EXISTS (SELECT 1 FROM public.workspace_members wm
                   JOIN auth.users u ON u.id = wm.user_id
                  WHERE wm.workspace_id = v_e.conta_id AND lower(u.email) = y->>'email')
   ORDER BY (y->>'n')::int
   LIMIT 1;
  IF v_membro IS NOT NULL THEN
    RAISE EXCEPTION 'agenda: % já é da equipe. Adicione como participante.', v_membro;
  END IF;

  -- serializes the caps of concurrent writes in the workspace
  PERFORM pg_advisory_xact_lock(hashtextextended('agenda-convidados:' || v_e.conta_id::text, 0));

  v_novos := ARRAY(SELECT y->>'email' FROM jsonb_array_elements(v_lista) y
                    WHERE NOT EXISTS (SELECT 1 FROM public.agenda_convidados g
                                       WHERE g.evento_id = p_evento AND g.removido_em IS NULL AND g.email = y->>'email')
                    ORDER BY (y->>'n')::int);
  v_contar := ARRAY(SELECT d.email FROM unnest(v_novos) AS d(email)
                     WHERE NOT EXISTS (SELECT 1 FROM public.agenda_convidados g
                                        WHERE g.conta_id = v_e.conta_id AND g.email = d.email
                                          AND g.criado_em > now() - interval '24 hours'));
  IF cardinality(v_contar) > 0 THEN
    SELECT count(DISTINCT g.email) INTO v_ws FROM public.agenda_convidados g
     WHERE g.conta_id = v_e.conta_id AND g.criado_em > now() - interval '24 hours';
    IF v_ws + cardinality(v_contar) > 50 THEN
      RAISE EXCEPTION 'agenda: limite diário de convites externos atingido. Tente amanhã.';
    END IF;
    PERFORM pg_advisory_xact_lock(hashtextextended('agenda-convidados:plataforma', 0));
    SELECT count(*) INTO v_plat
      FROM (SELECT DISTINCT g.conta_id, g.email FROM public.agenda_convidados g
             WHERE g.criado_em > now() - interval '24 hours') d;
    IF v_plat + cardinality(v_contar) > 1000 THEN
      RAISE EXCEPTION 'agenda: limite diário de convites externos atingido. Tente amanhã.';
    END IF;
  END IF;

  -- removed
  WITH r AS (
    UPDATE public.agenda_convidados g SET removido_em = now()
     WHERE g.evento_id = p_evento AND g.removido_em IS NULL
       AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_lista) y WHERE y->>'email' = g.email)
    RETURNING g.id, g.email
  ), a AS (
    INSERT INTO public.audit_log (conta_id, actor_user_id, action, resource_type, resource_id, metadata)
    SELECT v_e.conta_id, v_user, 'agenda_convidado_removido', 'agenda_evento', p_evento::text, jsonb_build_object('email', r.email)
      FROM r
  )
  SELECT coalesce(array_agg(r.id ORDER BY r.id), '{}') INTO removidos FROM r;

  -- kept: the nome follows the payload when it carries one
  UPDATE public.agenda_convidados g SET nome = y->>'nome'
    FROM jsonb_array_elements(v_lista) y
   WHERE g.evento_id = p_evento AND g.removido_em IS NULL AND g.email = y->>'email'
     AND (y->>'tem_nome')::boolean AND g.nome IS DISTINCT FROM y->>'nome';

  -- added
  WITH i AS (
    INSERT INTO public.agenda_convidados (conta_id, evento_id, email, nome, token, adicionado_por)
    SELECT v_e.conta_id, p_evento, y->>'email', y->>'nome', encode(extensions.gen_random_bytes(32), 'hex'), v_user
      FROM jsonb_array_elements(v_lista) y
     WHERE y->>'email' = ANY (v_novos)
     ORDER BY (y->>'n')::int
    RETURNING id, email
  ), a AS (
    INSERT INTO public.audit_log (conta_id, actor_user_id, action, resource_type, resource_id, metadata)
    SELECT v_e.conta_id, v_user, 'agenda_convidado_adicionado', 'agenda_evento', p_evento::text, jsonb_build_object('email', i.email)
      FROM i
  )
  SELECT coalesce(array_agg(i.id ORDER BY i.id), '{}') INTO adicionados FROM i;
END $function$;
REVOKE ALL ON FUNCTION public.agenda_definir_convidados(bigint, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.agenda_definir_convidados(bigint, jsonb) TO service_role;
