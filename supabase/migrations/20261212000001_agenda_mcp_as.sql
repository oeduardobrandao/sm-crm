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
-- 3. (escrita: cores, wrappers *_as e CRM) entra em tarefa seguinte.

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
    -- [mcp] p_privados = false mascara todo evento privado, inclusive os do próprio usuário
    SELECT (e.privado AND (NOT p_privados OR (e.organizador_id IS DISTINCT FROM v_user AND eu.user_id IS NULL))) AS mascarado
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
