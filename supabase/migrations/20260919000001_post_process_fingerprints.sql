-- Fingerprints canonicos de fluxo e de template (spec
-- 2026-09-10-posts-individuais-fluxos-design.md, secao 9.4).
--
-- workflows e workflow_etapas nao tem updated_at nem coluna de versao. Para
-- detectar "a origem mudou entre abrir o dialogo e confirmar", a UI calcula
-- uma serializacao canonica com os dados que exibe e a RPC recalcula a mesma
-- serializacao sob lock. E TEXTO, sem hash, de proposito: md5(jsonb::text)
-- no servidor nunca casaria com um hash do browser, porque a serializacao de
-- jsonb e propria do Postgres. O valor tem poucas centenas de bytes.
--
-- SECURITY INVOKER, nao DEFINER. Duas consequencias desejadas:
--   (a) chamada direta por membro de outra conta devolve NULL (RLS de
--       workflows): o SELECT nao encontra a linha, cai no IF NOT FOUND e a
--       funcao retorna antes de montar qualquer parte do fingerprint;
--   (b) dentro das RPCs SECURITY DEFINER da fase 2 a funcao roda como dona
--       (postgres), que ignora RLS, e por isso as RPCs validam conta_id por
--       conta propria ANTES de chamar workflow_fingerprint/template_fingerprint.
--
-- Fluxo/template inexistente devolve NULL: assim um fingerprint enviado pelo
-- cliente nunca casa com uma origem apagada.
--
-- workflow_etapas nao tem UNIQUE (workflow_id, ordem); o desempate de ordem
-- igual e por e.id (ORDER BY e.ordem, e.id). O espelho TS da fase 3
-- (buildFingerprint) tem de usar o mesmo desempate por id.

CREATE OR REPLACE FUNCTION public.workflow_fingerprint(p_workflow_id bigint)
RETURNS text
LANGUAGE plpgsql
STABLE
SET search_path = public, pg_temp
AS $$
DECLARE
  v_etapa_atual integer;
  v_linhas      text;
BEGIN
  SELECT w.etapa_atual INTO v_etapa_atual FROM workflows w WHERE w.id = p_workflow_id;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  SELECT coalesce(string_agg(
           chr(10)
             || e.ordem::text
             || '|' || coalesce(e.nome, '')
             || '|' || coalesce(nullif(e.tipo, ''), 'padrao')
             || '|' || coalesce(e.status, '')
             || '|' || coalesce(e.responsavel_id::text, '')
             || '|' || coalesce(e.prazo_dias::text, '')
             || '|' || coalesce(e.tipo_prazo, '')
             || '|' || coalesce(to_char(e.data_limite, 'YYYY-MM-DD'), '')
             || '|' || coalesce(to_char(e.iniciado_em AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'), ''),
           '' ORDER BY e.ordem, e.id), '')
    INTO v_linhas
    FROM workflow_etapas e
   WHERE e.workflow_id = p_workflow_id;

  RETURN 'etapa_atual=' || coalesce(v_etapa_atual::text, '') || v_linhas;
END;
$$;

-- Mesmo formato, colunas ordem|nome|tipo|prazo_dias|tipo_prazo, sobre o jsonb
-- de workflow_templates.etapas. NAO tem a linha etapa_atual=: template nao tem
-- ponteiro de etapa, e uma linha fixa 'etapa_atual=0' so serviria para
-- confundir quem comparasse os dois formatos. A ordem e o indice base zero do
-- array (WITH ORDINALITY comeca em 1), a mesma convencao de
-- migrate_workflow_template.
CREATE OR REPLACE FUNCTION public.template_fingerprint(p_template_id bigint)
RETURNS text
LANGUAGE plpgsql
STABLE
SET search_path = public, pg_temp
AS $$
DECLARE
  v_etapas jsonb;
  v_out    text;
BEGIN
  SELECT t.etapas INTO v_etapas FROM workflow_templates t WHERE t.id = p_template_id;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;
  IF v_etapas IS NULL OR jsonb_typeof(v_etapas) <> 'array' THEN
    RETURN '';
  END IF;

  SELECT coalesce(string_agg(
           (e.ord - 1)::text
             || '|' || coalesce(e.val ->> 'nome', '')
             || '|' || coalesce(nullif(e.val ->> 'tipo', ''), 'padrao')
             || '|' || coalesce(e.val ->> 'prazo_dias', '')
             || '|' || coalesce(e.val ->> 'tipo_prazo', ''),
           chr(10) ORDER BY e.ord), '')
    INTO v_out
    FROM jsonb_array_elements(v_etapas) WITH ORDINALITY AS e(val, ord);

  RETURN v_out;
END;
$$;

REVOKE ALL ON FUNCTION public.workflow_fingerprint(bigint) FROM public, anon;
REVOKE ALL ON FUNCTION public.template_fingerprint(bigint) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.workflow_fingerprint(bigint) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.template_fingerprint(bigint) TO authenticated, service_role;
