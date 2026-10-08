-- supabase/migrations/20261008000001_agenda_hub_periodo.sql
-- Agenda (sub-projeto 4, migration A): the Hub home calendar reads the client's
-- shared events by date range. agenda_hub_listar pages forward from "now - 30
-- days"; the calendar needs any month (past included), so this adds
-- agenda_hub_periodo plus agenda_hub_visivel, the visibility predicate both RPCs
-- share so they cannot diverge.
-- Spec: docs/superpowers/specs/2026-10-07-agenda-camadas-convidados-design.md §2
-- Plan: docs/superpowers/plans/2026-10-07-agenda-camadas-convidados.md (Task 2 + amendments 5, 6, 16)
--
-- No table changes. agenda_hub_listar keeps its signature and its behavior.

-- Internal: may p_cliente see this occurrence? Shared with that cliente, not
-- private, not cancelled. Callers still scope by conta_id (the rows come from
-- the caller's own WHERE). Pure logic on the passed rows, so no SECURITY DEFINER.
CREATE OR REPLACE FUNCTION public.agenda_hub_visivel(e public.agenda_eventos, o public.agenda_ocorrencias, p_cliente bigint)
RETURNS boolean LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT coalesce(e.compartilhado_cliente AND e.cliente_id IS NOT NULL AND e.cliente_id = p_cliente
                  AND NOT e.privado AND NOT o.cancelada, false);
$$;

-- The client's shared occurrences, oldest first, from fim >= now() - 30 days,
-- in pages of p_limite (clamped to 1..100) with a keyset cursor
-- (inicio, id) > (p_apos_inicio, p_apos_id). Flag off: estado 'desligado'
-- with no items (not an error). A cliente that is not 'ativo' is refused
-- (nao_encontrado); one that no longer exists simply has nothing shared.
-- (Body of 20261007000001_agenda_hub.sql; only the visibility WHERE now calls
-- agenda_hub_visivel.)
CREATE OR REPLACE FUNCTION public.agenda_hub_listar(
  p_conta uuid, p_cliente bigint, p_apos_inicio timestamptz DEFAULT NULL, p_apos_id bigint DEFAULT NULL, p_limite int DEFAULT 100)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_status text;
  v_lim int := least(greatest(coalesce(p_limite, 100), 1), 100);
  v_ids bigint[];
  v_ini timestamptz[];
  v_itens jsonb;
  v_proximo jsonb := NULL;
BEGIN
  IF p_conta IS NULL OR NOT public.effective_plan_feature(p_conta, 'feature_agenda') THEN
    RETURN jsonb_build_object('estado', 'desligado', 'itens', '[]'::jsonb, 'proximo', NULL);
  END IF;
  SELECT c.status INTO v_status FROM public.clientes c WHERE c.id = p_cliente AND c.conta_id = p_conta;
  IF FOUND AND v_status IS DISTINCT FROM 'ativo' THEN
    RAISE EXCEPTION 'agenda_hub:nao_encontrado' USING ERRCODE = 'P0001';
  END IF;

  SELECT array_agg(x.id ORDER BY x.inicio, x.id), array_agg(x.inicio ORDER BY x.inicio, x.id) INTO v_ids, v_ini
    FROM (
      SELECT o.id, o.inicio
        FROM public.agenda_eventos e
        JOIN public.agenda_ocorrencias o ON o.evento_id = e.id AND o.conta_id = e.conta_id
       WHERE e.conta_id = p_conta AND e.cliente_id = p_cliente
         AND public.agenda_hub_visivel(e, o, p_cliente)
         AND o.fim >= now() - interval '30 days'
         AND (p_apos_inicio IS NULL OR p_apos_id IS NULL OR (o.inicio, o.id) > (p_apos_inicio, p_apos_id))
       ORDER BY o.inicio, o.id
       LIMIT v_lim + 1
    ) x;
  v_ids := coalesce(v_ids, '{}');
  IF cardinality(v_ids) > v_lim THEN
    v_proximo := jsonb_build_object('inicio', v_ini[v_lim], 'id', v_ids[v_lim]);
    v_ids := v_ids[1:v_lim];
  END IF;
  SELECT coalesce(jsonb_agg(public.agenda_hub_item(p_conta, p_cliente, t.id) ORDER BY t.n), '[]'::jsonb) INTO v_itens
    FROM unnest(v_ids) WITH ORDINALITY AS t(id, n);
  RETURN jsonb_build_object('estado', 'ok', 'itens', v_itens, 'proximo', v_proximo);
END $$;

-- The client's shared occurrences that overlap [p_de, p_ate): inicio < p_ate
-- AND fim > p_de, oldest first, at most 300, in the same Item shape as
-- agenda_hub_listar (built by the same agenda_hub_item). The window must be
-- positive and at most 45 days (agenda_hub:periodo_invalido). Gate mirrors
-- agenda_hub_listar: flag off -> estado 'desligado' (no items, no error); a
-- cliente that exists but is not 'ativo' raises agenda_hub:nao_encontrado, so
-- estado is only 'ok' | 'desligado'.
CREATE OR REPLACE FUNCTION public.agenda_hub_periodo(p_conta uuid, p_cliente bigint, p_de timestamptz, p_ate timestamptz)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_status text;
  v_ids bigint[];
  v_itens jsonb;
BEGIN
  IF p_de IS NULL OR p_ate IS NULL OR p_ate <= p_de OR p_ate - p_de > interval '45 days' THEN
    RAISE EXCEPTION 'agenda_hub:periodo_invalido' USING ERRCODE = 'P0001';
  END IF;
  IF p_conta IS NULL OR NOT public.effective_plan_feature(p_conta, 'feature_agenda') THEN
    RETURN jsonb_build_object('estado', 'desligado', 'itens', '[]'::jsonb);
  END IF;
  SELECT c.status INTO v_status FROM public.clientes c WHERE c.id = p_cliente AND c.conta_id = p_conta;
  IF FOUND AND v_status IS DISTINCT FROM 'ativo' THEN
    RAISE EXCEPTION 'agenda_hub:nao_encontrado' USING ERRCODE = 'P0001';
  END IF;

  SELECT array_agg(x.id ORDER BY x.inicio, x.id) INTO v_ids
    FROM (
      SELECT o.id, o.inicio
        FROM public.agenda_eventos e
        JOIN public.agenda_ocorrencias o ON o.evento_id = e.id AND o.conta_id = e.conta_id
       WHERE e.conta_id = p_conta AND e.cliente_id = p_cliente
         AND public.agenda_hub_visivel(e, o, p_cliente)
         AND o.inicio < p_ate AND o.fim > p_de
       ORDER BY o.inicio, o.id
       LIMIT 300
    ) x;
  SELECT coalesce(jsonb_agg(public.agenda_hub_item(p_conta, p_cliente, t.id) ORDER BY t.n), '[]'::jsonb) INTO v_itens
    FROM unnest(coalesce(v_ids, '{}')) WITH ORDINALITY AS t(id, n);
  RETURN jsonb_build_object('estado', 'ok', 'itens', v_itens);
END $$;

-- ---- grants ----
REVOKE ALL ON FUNCTION public.agenda_hub_visivel(public.agenda_eventos, public.agenda_ocorrencias, bigint) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.agenda_hub_listar(uuid, bigint, timestamptz, bigint, int) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.agenda_hub_periodo(uuid, bigint, timestamptz, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.agenda_hub_visivel(public.agenda_eventos, public.agenda_ocorrencias, bigint) TO service_role;
GRANT EXECUTE ON FUNCTION public.agenda_hub_listar(uuid, bigint, timestamptz, bigint, int) TO service_role;
GRANT EXECUTE ON FUNCTION public.agenda_hub_periodo(uuid, bigint, timestamptz, timestamptz) TO service_role;

-- ============ GRANT ASSERTIONS ============
DO $$
DECLARE
  v_fn text;
BEGIN
  FOREACH v_fn IN ARRAY ARRAY[
    'public.agenda_hub_visivel(public.agenda_eventos, public.agenda_ocorrencias, bigint)',
    'public.agenda_hub_listar(uuid, bigint, timestamptz, bigint, int)',
    'public.agenda_hub_periodo(uuid, bigint, timestamptz, timestamptz)'] LOOP
    IF has_function_privilege('anon', v_fn, 'EXECUTE') OR has_function_privilege('authenticated', v_fn, 'EXECUTE') THEN
      RAISE EXCEPTION '%: anon/authenticated can execute', v_fn;
    END IF;
    IF NOT has_function_privilege('service_role', v_fn, 'EXECUTE') THEN
      RAISE EXCEPTION '%: service_role cannot execute', v_fn;
    END IF;
  END LOOP;
END $$;
