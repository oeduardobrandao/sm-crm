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
--    agenda_pode_ver_evento ganha a forma de 4 argumentos com o usuário explícito, só para
--    os cores (EXECUTE só service_role: aberta a authenticated, deixaria sondar se qualquer
--    usuário participa de qualquer evento). A de 3 argumentos não muda (é ela que a RLS usa).
--    Os corpos são cópias das versões vigentes (20261117000006, 20261007000001,
--    20261008000002) com as linhas do ator marcadas com [mcp].
--
-- 2. Listagem. O corpo de agenda_listar vira _agenda_listar_core(conta, usuário, privados, ...),
--    cópia da versão vigente (20261117000006) com só as linhas de identidade trocadas
--    (marcadas [mcp]): permissão, escopo de cliente e nome de cliente por contexto são julgados
--    em p_conta para p_user, nunca no workspace ativo. p_privados = false mascara todo evento
--    privado, inclusive os do próprio usuário (conexão por chave de API). agenda_listar (CRM)
--    passa a chamar o core com get_my_conta_id()/auth.uid() e privados = true, mantendo
--    assinatura, retorno, ACL e o erro de sessão sem workspace; agenda_listar_as é a variante
--    do MCP (só service_role) e recusa quem não é membro de p_conta com o mesmo erro.
--    can_see_cliente_context_for, citada na spec, saiu em 20261117000012 (e
--    99_acesso_por_cliente_notificacoes exige que continue fora). Para não haver dois corpos,
--    a regra de contexto de cliente passa a viver só em _can_see_cliente_context_core(usuário,
--    conta, cliente), sem EXECUTE para nenhum papel da API; can_see_cliente_context(bigint)
--    vira um wrapper fino com a mesma assinatura, ACL e semântica (auth.uid() nulo = true,
--    como antes) e o core da listagem chama o núcleo direto.
--
-- 3. Escrita. agenda_evento_criar/_editar/_excluir viram _agenda_evento_*_core(conta, usuário,
--    privados, ...), cópias das versões vigentes (20261008000002 para criar, 20261117000006 para
--    editar e excluir) com só as linhas de identidade trocadas (marcadas [mcp]): permissão,
--    escopo de cliente e visibilidade do evento julgados em p_conta para p_user. Com
--    p_privados = false (ou NULL) o core recusa criar evento privado e editar ou excluir evento
--    privado (inclusive o próprio) ou tornar um evento privado, com 'agenda: evento privado
--    indisponível nesta conexão', sempre depois da checagem de visibilidade (não confirma o id).
--    Os wrappers *_as (só service_role) recusam quem não é membro de p_conta, gravam o ator em
--    mesaas.agenda_actor (os gatilhos de escopo, author_immutable incluído, e o resolvido_por
--    de agenda_cliente_substituir_pedidos passam a vê-lo), chamam o core e limpam o ator. Os
--    RPCs do CRM mantêm assinatura, retorno, ACL e erro de sessão, e chamam o core com
--    get_my_conta_id()/auth.uid() e privados = true.

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
REVOKE ALL ON FUNCTION public.agenda_pode_ver_evento(bigint, boolean, uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.agenda_pode_ver_evento(bigint, boolean, uuid, uuid) TO service_role;

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

-- ============================================================ 2. listagem

-- [mcp] corpo de can_see_cliente_context(bigint) com usuário e conta explícitos; a única cópia da regra
CREATE OR REPLACE FUNCTION public._can_see_cliente_context_core(p_user uuid, p_conta uuid, p_cliente_id bigint)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid   uuid := p_user;  -- [mcp]
  v_conta uuid := p_conta;  -- [mcp]
  v_ids   bigint[];
BEGIN
  IF public.can_access_cliente(p_user, p_conta, p_cliente_id) THEN RETURN true; END IF;  -- [mcp]
  IF p_cliente_id IS NULL OR v_uid IS NULL THEN RETURN false; END IF;
  IF v_conta IS NULL THEN RETURN false; END IF;
  SELECT COALESCE(array_agg(m.id ORDER BY m.id), '{}'::bigint[]) INTO v_ids  -- [mcp] membros do usuário na conta
    FROM public.membros m
   WHERE m.crm_user_id = v_uid AND m.conta_id = v_conta;
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
$function$;
REVOKE ALL ON FUNCTION public._can_see_cliente_context_core(uuid, uuid, bigint) FROM PUBLIC, anon, authenticated, service_role;

-- [mcp] wrapper fino sobre o núcleo; mesma assinatura, volatilidade, search_path e ACL
CREATE OR REPLACE FUNCTION public.can_see_cliente_context(p_cliente_id bigint)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  -- [mcp] sem jwt, can_access_cliente(bigint) dava true e a versão anterior devolvia true
  IF auth.uid() IS NULL THEN RETURN true; END IF;
  RETURN public._can_see_cliente_context_core(auth.uid(), public.get_my_conta_id(), p_cliente_id);  -- [mcp]
END;
$function$;
REVOKE ALL ON FUNCTION public.can_see_cliente_context(bigint) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.can_see_cliente_context(bigint) TO authenticated, service_role;

-- [mcp] núcleo com conta, usuário e máscara explícitos
CREATE OR REPLACE FUNCTION public._agenda_listar_core(p_conta uuid, p_user uuid, p_privados boolean, p_de timestamp with time zone, p_ate timestamp with time zone, p_ocorrencia_id bigint)
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
  v_conta := p_conta; v_user := p_user;  -- [mcp]
  IF v_conta IS NULL OR v_user IS NULL THEN RAISE EXCEPTION 'agenda: sessão sem workspace ativo'; END IF;
  -- flag off: no rows, no raise (stale clients and prefetches stay quiet)
  IF NOT public.effective_plan_feature(v_conta, 'feature_agenda') THEN RETURN; END IF;
  IF NOT public.has_permission_for(p_user, p_conta, 'calendario', 'ver') THEN  -- [mcp]
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
  v_editar := public.has_permission_for(p_user, p_conta, 'calendario', 'editar');  -- [mcp]
  SELECT wm.role::text INTO v_role FROM public.workspace_members wm
   WHERE wm.workspace_id = v_conta AND wm.user_id = v_user;
  v_all := EXISTS (SELECT 1 FROM public.workspace_members wm  -- [mcp]
                    WHERE wm.user_id = p_user AND wm.workspace_id = p_conta
                      AND (wm.role = 'owner' OR wm.client_scope = 'todos'));

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
         WHEN v_all OR public._can_see_cliente_context_core(p_user, p_conta, e.cliente_id) THEN c.nome END,  -- [mcp]
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
    -- [mcp] p_privados = false (ou NULL) mascara todo evento privado, inclusive os do próprio usuário
    SELECT (e.privado AND (NOT coalesce(p_privados, false) OR (e.organizador_id IS DISTINCT FROM v_user AND eu.user_id IS NULL))) AS mascarado
  ) m
  CROSS JOIN LATERAL (  -- [hub] effective sharing, never for a masked row
    SELECT (NOT m.mascarado AND e.compartilhado_cliente AND e.cliente_id IS NOT NULL) AS compartilhado
  ) sh
  WHERE o.conta_id = v_conta
    AND NOT o.cancelada
    AND o.inicio < v_ate AND o.fim > v_de AND o.inicio >= v_de - interval '31 days'
    AND (p_ocorrencia_id IS NULL OR o.id = p_ocorrencia_id)
    -- [escopo] cliente que ele acessa, ou evento dele (organizador ou participante)
    AND (v_all OR public.can_access_cliente(p_user, p_conta, e.cliente_id)  -- [mcp]
         OR e.organizador_id = v_user OR eu.user_id IS NOT NULL)
  ORDER BY o.inicio, o.id;
END $function$;
REVOKE ALL ON FUNCTION public._agenda_listar_core(uuid, uuid, boolean, timestamptz, timestamptz, bigint) FROM PUBLIC, anon, authenticated, service_role;

-- MCP: a conexão informa o workspace e o usuário; quem não é membro de p_conta é recusado
CREATE OR REPLACE FUNCTION public.agenda_listar_as(p_conta uuid, p_user uuid, p_privados boolean, p_de timestamp with time zone DEFAULT NULL::timestamp with time zone, p_ate timestamp with time zone DEFAULT NULL::timestamp with time zone, p_ocorrencia_id bigint DEFAULT NULL::bigint)
 RETURNS TABLE(ocorrencia_id bigint, evento_id bigint, data_original date, inicio timestamp with time zone, fim timestamp with time zone, dia_inteiro boolean, data_inicio_local date, data_fim_local date, titulo text, descricao text, local text, link_reuniao text, tipo text, cor text, cliente_id bigint, cliente_nome text, privado boolean, mascarado boolean, recorrente boolean, regra jsonb, lembretes integer[], organizador_id uuid, participantes jsonb, minha_resposta text, pode_editar boolean, pode_responder boolean, tz text, compartilhado_cliente boolean, cliente_resposta text, remarcacao_pendente jsonb, sequencia integer, convidados jsonb)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF p_conta IS NULL OR p_user IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.workspace_members wm
     WHERE wm.workspace_id = p_conta AND wm.user_id = p_user
  ) THEN
    RAISE EXCEPTION 'agenda: sessão sem workspace ativo';
  END IF;
  RETURN QUERY SELECT * FROM public._agenda_listar_core(p_conta, p_user, coalesce(p_privados, false), p_de, p_ate, p_ocorrencia_id);
END $function$;
REVOKE ALL ON FUNCTION public.agenda_listar_as(uuid, uuid, boolean, timestamptz, timestamptz, bigint) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.agenda_listar_as(uuid, uuid, boolean, timestamptz, timestamptz, bigint) TO service_role;

-- CRM: mesma assinatura, retorno, ACL e erro de sessão; o corpo vai para o core
CREATE OR REPLACE FUNCTION public.agenda_listar(p_de timestamp with time zone DEFAULT NULL::timestamp with time zone, p_ate timestamp with time zone DEFAULT NULL::timestamp with time zone, p_ocorrencia_id bigint DEFAULT NULL::bigint)
 RETURNS TABLE(ocorrencia_id bigint, evento_id bigint, data_original date, inicio timestamp with time zone, fim timestamp with time zone, dia_inteiro boolean, data_inicio_local date, data_fim_local date, titulo text, descricao text, local text, link_reuniao text, tipo text, cor text, cliente_id bigint, cliente_nome text, privado boolean, mascarado boolean, recorrente boolean, regra jsonb, lembretes integer[], organizador_id uuid, participantes jsonb, minha_resposta text, pode_editar boolean, pode_responder boolean, tz text, compartilhado_cliente boolean, cliente_resposta text, remarcacao_pendente jsonb, sequencia integer, convidados jsonb)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_conta uuid := get_my_conta_id();
  v_user uuid := auth.uid();
BEGIN
  IF v_conta IS NULL OR v_user IS NULL THEN RAISE EXCEPTION 'agenda: sessão sem workspace ativo'; END IF;
  RETURN QUERY SELECT * FROM public._agenda_listar_core(v_conta, v_user, true, p_de, p_ate, p_ocorrencia_id);
END $function$;
REVOKE ALL ON FUNCTION public.agenda_listar(timestamptz, timestamptz, bigint) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.agenda_listar(timestamptz, timestamptz, bigint) TO authenticated, service_role;

-- ============================================================ 3. escrita

-- [mcp] núcleo com conta, usuário e acesso a privados explícitos
CREATE OR REPLACE FUNCTION public._agenda_evento_criar_core(p_conta uuid, p_user uuid, p_privados boolean, p_evento jsonb, p_participantes uuid[])
 RETURNS TABLE(evento_id bigint, ocorrencia_id bigint, dtstart timestamp without time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
#variable_conflict use_column
DECLARE
  v_conta uuid;
  v_user uuid;
  v_e public.agenda_eventos;
  v_id bigint;
  v_oc bigint;
  v_parts uuid[];
  v_conv_add bigint[] := '{}';   -- [convidados] guests added by the payload
  v_envios jsonb := '[]'::jsonb; -- [convidados]
  v_privados boolean := coalesce(p_privados, false);  -- [mcp] NULL = sem privados
BEGIN
  v_conta := p_conta; v_user := p_user;  -- [mcp]
  IF v_conta IS NULL OR v_user IS NULL THEN RAISE EXCEPTION 'agenda: sessão sem workspace ativo'; END IF;
  IF NOT public.effective_plan_feature(v_conta, 'feature_agenda') THEN
    RAISE EXCEPTION 'feature_disabled:feature_agenda' USING ERRCODE = 'P0001';
  END IF;
  IF NOT public.has_permission_for(p_user, p_conta, 'calendario', 'editar') THEN  -- [mcp]
    RAISE EXCEPTION 'agenda: você não pode criar eventos';
  END IF;
  -- [mcp] conexão sem acesso a eventos privados (chave de API)
  IF NOT v_privados AND (p_evento->>'privado') IS NOT DISTINCT FROM 'true' THEN
    RAISE EXCEPTION 'agenda: evento privado indisponível nesta conexão';
  END IF;

  v_e := public.agenda_validar_payload(v_conta, p_evento, NULL);
  v_e.organizador_id := v_user;
  v_e.dtstart := public.agenda_normalizar_dtstart(v_e);

  v_parts := ARRAY(SELECT DISTINCT d.u FROM unnest(coalesce(p_participantes, '{}'::uuid[])) AS d(u)
                    WHERE d.u IS NOT NULL AND d.u <> v_user);
  IF cardinality(v_parts) > 50 THEN
    RAISE EXCEPTION 'agenda: no máximo 50 participantes';
  END IF;
  IF EXISTS (SELECT 1 FROM unnest(v_parts) AS d(u)
              WHERE NOT EXISTS (SELECT 1 FROM public.workspace_members wm
                                 WHERE wm.user_id = d.u AND wm.workspace_id = v_conta)) THEN
    RAISE EXCEPTION 'agenda: participante fora do workspace';
  END IF;

  INSERT INTO public.agenda_eventos (
    conta_id, organizador_id, titulo, descricao, local, link_reuniao, tipo, cor, cliente_id,
    privado, dia_inteiro, tz, dtstart, duracao_min, duracao_dias, freq, intervalo, dias_semana,
    mensal_modo, mensal_ordinal, ate, contagem, lembretes,
    compartilhado_cliente)  -- [hub]
  VALUES (
    v_conta, v_user, v_e.titulo, v_e.descricao, v_e.local, v_e.link_reuniao, v_e.tipo, v_e.cor, v_e.cliente_id,
    v_e.privado, v_e.dia_inteiro, v_e.tz, v_e.dtstart, v_e.duracao_min, v_e.duracao_dias, v_e.freq, v_e.intervalo,
    v_e.dias_semana, v_e.mensal_modo, v_e.mensal_ordinal, v_e.ate, v_e.contagem, v_e.lembretes,
    v_e.compartilhado_cliente)  -- [hub]
  RETURNING agenda_eventos.id INTO v_id;

  INSERT INTO public.agenda_participantes (evento_id, conta_id, user_id, resposta, respondido_em)
  VALUES (v_id, v_conta, v_user, 'sim', now());
  INSERT INTO public.agenda_participantes (evento_id, conta_id, user_id, resposta)
  SELECT v_id, v_conta, d.u, 'pendente' FROM unnest(v_parts) AS d(u);

  PERFORM public.agenda_materializar(v_id, (public.agenda_hoje(v_e.tz) + interval '24 months')::date);

  SELECT o.id INTO v_oc FROM public.agenda_ocorrencias o
   WHERE o.evento_id = v_id ORDER BY o.data_original LIMIT 1;

  PERFORM public.agenda_notificar(v_conta, v_id, v_oc, 'event_invited', v_parts, v_user, '{}'::jsonb);

  -- [convidados] the external guests of the payload (validated, capped, audited)
  IF p_evento ? 'convidados' THEN
    SELECT d.adicionados INTO v_conv_add FROM public.agenda_definir_convidados(v_id, p_evento->'convidados') d;
  END IF;

  -- [hub] shared with the client: 'convite' with the next occurrences
  -- [convidados] and each guest a 'convite' with its own (unbounded) snapshot,
  -- with one bump for all
  IF v_e.compartilhado_cliente AND v_e.cliente_id IS NOT NULL THEN
    v_envios := jsonb_build_array(jsonb_build_object('cliente', v_e.cliente_id, 'convidado', NULL,
      'tipo', 'convite', 'ocorrencias', public.agenda_cliente_ocorrencias_snapshot(v_id, 'ativa')));
  END IF;
  IF cardinality(v_conv_add) > 0 THEN
    v_envios := v_envios || public.agenda_envios_convidados(v_conv_add, 'convite',
      public.agenda_convidados_snapshot(v_id, 'ativa'));
  END IF;
  PERFORM public.agenda_envios_enfileirar(v_conta, v_id, v_envios);

  RETURN QUERY SELECT v_id, v_oc, v_e.dtstart;
END $function$;
REVOKE ALL ON FUNCTION public._agenda_evento_criar_core(uuid, uuid, boolean, jsonb, uuid[]) FROM PUBLIC, anon, authenticated, service_role;

-- [mcp] núcleo com conta, usuário e acesso a privados explícitos
CREATE OR REPLACE FUNCTION public._agenda_evento_editar_core(p_conta uuid, p_user uuid, p_privados boolean, p_ocorrencia_id bigint, p_escopo text, p_evento jsonb, p_participantes uuid[])
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
  v_privados boolean := coalesce(p_privados, false);  -- [mcp] NULL = sem privados
BEGIN
  v_conta := p_conta; v_user := p_user;  -- [mcp]
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
  IF NOT (EXISTS (SELECT 1 FROM public.workspace_members wm  -- [mcp]
                  WHERE wm.user_id = p_user AND wm.workspace_id = p_conta
                    AND (wm.role = 'owner' OR wm.client_scope = 'todos'))
          OR public.can_access_cliente(p_user, p_conta, v_e.cliente_id)  -- [mcp]
          OR coalesce(public.agenda_pode_ver_evento(v_e.id, true, v_e.organizador_id, p_user), false)) THEN  -- [mcp]
    RAISE EXCEPTION 'agenda: este evento não existe mais';
  END IF;
  -- [mcp] conexão sem acesso a eventos privados (chave de API); depois da checagem
  -- de visibilidade, para não confirmar o id de um evento que ele não vê
  IF NOT v_privados AND (v_e.privado OR (p_evento->>'privado') IS NOT DISTINCT FROM 'true') THEN
    RAISE EXCEPTION 'agenda: evento privado indisponível nesta conexão';
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
REVOKE ALL ON FUNCTION public._agenda_evento_editar_core(uuid, uuid, boolean, bigint, text, jsonb, uuid[]) FROM PUBLIC, anon, authenticated, service_role;

-- [mcp] núcleo com conta, usuário e acesso a privados explícitos
CREATE OR REPLACE FUNCTION public._agenda_evento_excluir_core(p_conta uuid, p_user uuid, p_privados boolean, p_ocorrencia_id bigint, p_escopo text)
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
  v_privados boolean := coalesce(p_privados, false);  -- [mcp] NULL = sem privados
BEGIN
  v_conta := p_conta; v_user := p_user;  -- [mcp]
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
  IF NOT (EXISTS (SELECT 1 FROM public.workspace_members wm  -- [mcp]
                  WHERE wm.user_id = p_user AND wm.workspace_id = p_conta
                    AND (wm.role = 'owner' OR wm.client_scope = 'todos'))
          OR public.can_access_cliente(p_user, p_conta, v_e.cliente_id)  -- [mcp]
          OR coalesce(public.agenda_pode_ver_evento(v_e.id, true, v_e.organizador_id, p_user), false)) THEN  -- [mcp]
    RAISE EXCEPTION 'agenda: este evento não existe mais';
  END IF;
  -- [mcp] conexão sem acesso a eventos privados (chave de API); depois da checagem
  -- de visibilidade, para não confirmar o id de um evento que ele não vê
  IF NOT v_privados AND (v_e.privado) THEN
    RAISE EXCEPTION 'agenda: evento privado indisponível nesta conexão';
  END IF;
  IF NOT public.agenda_pode_editar(v_e, v_user, v_conta) THEN
    RAISE EXCEPTION 'agenda: você não pode editar este evento';
  END IF;
  -- [escopo] excluir (qualquer escopo) é estrito: cliente que ele acessa, ou
  -- evento sem cliente que ele organiza
  IF NOT (EXISTS (SELECT 1 FROM public.workspace_members wm  -- [mcp]
                  WHERE wm.user_id = p_user AND wm.workspace_id = p_conta
                    AND (wm.role = 'owner' OR wm.client_scope = 'todos'))
          OR public.can_access_cliente(p_user, p_conta, v_e.cliente_id)  -- [mcp]
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
REVOKE ALL ON FUNCTION public._agenda_evento_excluir_core(uuid, uuid, boolean, bigint, text) FROM PUBLIC, anon, authenticated, service_role;

-- MCP: membro de p_conta, ator nos gatilhos durante o core; se o core levanta, a transação aborta
CREATE OR REPLACE FUNCTION public.agenda_evento_criar_as(p_conta uuid, p_user uuid, p_privados boolean, p_evento jsonb, p_participantes uuid[])
 RETURNS TABLE(evento_id bigint, ocorrencia_id bigint, dtstart timestamp without time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF p_conta IS NULL OR p_user IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.workspace_members wm
     WHERE wm.workspace_id = p_conta AND wm.user_id = p_user
  ) THEN
    RAISE EXCEPTION 'agenda: sessão sem workspace ativo';
  END IF;
  PERFORM set_config('mesaas.agenda_actor', p_user::text, true);
  RETURN QUERY SELECT * FROM public._agenda_evento_criar_core(p_conta, p_user, coalesce(p_privados, false), p_evento, p_participantes);
  PERFORM set_config('mesaas.agenda_actor', '', true);
  RETURN;
END $function$;
REVOKE ALL ON FUNCTION public.agenda_evento_criar_as(uuid, uuid, boolean, jsonb, uuid[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.agenda_evento_criar_as(uuid, uuid, boolean, jsonb, uuid[]) TO service_role;

CREATE OR REPLACE FUNCTION public.agenda_evento_editar_as(p_conta uuid, p_user uuid, p_privados boolean, p_ocorrencia_id bigint, p_escopo text, p_evento jsonb, p_participantes uuid[] DEFAULT NULL::uuid[])
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_ret bigint;
BEGIN
  IF p_conta IS NULL OR p_user IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.workspace_members wm
     WHERE wm.workspace_id = p_conta AND wm.user_id = p_user
  ) THEN
    RAISE EXCEPTION 'agenda: sessão sem workspace ativo';
  END IF;
  PERFORM set_config('mesaas.agenda_actor', p_user::text, true);
  v_ret := public._agenda_evento_editar_core(p_conta, p_user, coalesce(p_privados, false), p_ocorrencia_id, p_escopo, p_evento, p_participantes);
  PERFORM set_config('mesaas.agenda_actor', '', true);
  RETURN v_ret;
END $function$;
REVOKE ALL ON FUNCTION public.agenda_evento_editar_as(uuid, uuid, boolean, bigint, text, jsonb, uuid[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.agenda_evento_editar_as(uuid, uuid, boolean, bigint, text, jsonb, uuid[]) TO service_role;

CREATE OR REPLACE FUNCTION public.agenda_evento_excluir_as(p_conta uuid, p_user uuid, p_privados boolean, p_ocorrencia_id bigint, p_escopo text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF p_conta IS NULL OR p_user IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.workspace_members wm
     WHERE wm.workspace_id = p_conta AND wm.user_id = p_user
  ) THEN
    RAISE EXCEPTION 'agenda: sessão sem workspace ativo';
  END IF;
  PERFORM set_config('mesaas.agenda_actor', p_user::text, true);
  PERFORM public._agenda_evento_excluir_core(p_conta, p_user, coalesce(p_privados, false), p_ocorrencia_id, p_escopo);
  PERFORM set_config('mesaas.agenda_actor', '', true);
END $function$;
REVOKE ALL ON FUNCTION public.agenda_evento_excluir_as(uuid, uuid, boolean, bigint, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.agenda_evento_excluir_as(uuid, uuid, boolean, bigint, text) TO service_role;

-- CRM: mesma assinatura, retorno, ACL e erro de sessão; o corpo vai para o core
CREATE OR REPLACE FUNCTION public.agenda_evento_criar(p_evento jsonb, p_participantes uuid[])
 RETURNS TABLE(evento_id bigint, ocorrencia_id bigint, dtstart timestamp without time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_conta uuid := get_my_conta_id();
  v_user uuid := auth.uid();
BEGIN
  IF v_conta IS NULL OR v_user IS NULL THEN RAISE EXCEPTION 'agenda: sessão sem workspace ativo'; END IF;
  RETURN QUERY SELECT * FROM public._agenda_evento_criar_core(v_conta, v_user, true, p_evento, p_participantes);
END $function$;
REVOKE ALL ON FUNCTION public.agenda_evento_criar(jsonb, uuid[]) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.agenda_evento_criar(jsonb, uuid[]) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.agenda_evento_editar(p_ocorrencia_id bigint, p_escopo text, p_evento jsonb, p_participantes uuid[] DEFAULT NULL::uuid[])
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_conta uuid := get_my_conta_id();
  v_user uuid := auth.uid();
BEGIN
  IF v_conta IS NULL OR v_user IS NULL THEN RAISE EXCEPTION 'agenda: sessão sem workspace ativo'; END IF;
  RETURN public._agenda_evento_editar_core(v_conta, v_user, true, p_ocorrencia_id, p_escopo, p_evento, p_participantes);
END $function$;
REVOKE ALL ON FUNCTION public.agenda_evento_editar(bigint, text, jsonb, uuid[]) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.agenda_evento_editar(bigint, text, jsonb, uuid[]) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.agenda_evento_excluir(p_ocorrencia_id bigint, p_escopo text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_conta uuid := get_my_conta_id();
  v_user uuid := auth.uid();
BEGIN
  IF v_conta IS NULL OR v_user IS NULL THEN RAISE EXCEPTION 'agenda: sessão sem workspace ativo'; END IF;
  PERFORM public._agenda_evento_excluir_core(v_conta, v_user, true, p_ocorrencia_id, p_escopo);
END $function$;
REVOKE ALL ON FUNCTION public.agenda_evento_excluir(bigint, text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.agenda_evento_excluir(bigint, text) TO authenticated, service_role;
