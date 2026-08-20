-- Botões de link na DM da automação comentário -> DM (button template).
-- Spec: docs/superpowers/specs/2026-08-19-instagram-dm-link-buttons-design.md
--
-- dm_buttons é validado por função de CHECK. ATENÇÃO: sem REVOKE/GRANT
-- restritivo aqui -- a função roda como o role que insere (authenticated via
-- PostgREST); revogar EXECUTE de PUBLIC quebraria todo INSERT/UPDATE da
-- tabela com 42501. O default do Supabase já concede EXECUTE aos roles da API.

-- CASE (não AND) para o type-guard: o Postgres NÃO garante ordem/short-circuit
-- entre operandos de AND, então `jsonb_typeof(b)='array' AND jsonb_array_length(b)...`
-- poderia avaliar jsonb_array_length primeiro e estourar 22023 cru em vez do
-- 23514 limpo do CHECK. CASE tem ordem de avaliação garantida.
CREATE FUNCTION validate_ig_dm_buttons(b jsonb)
RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN jsonb_typeof(b) <> 'array' THEN false
    WHEN jsonb_array_length(b) > 3 THEN false
    ELSE coalesce((
      -- coalesce POR ITEM: um objeto sem as chaves gera NULL na comparação
      -- de chaves e bool_and IGNORA NULLs -- sem o coalesce(false) um {} passaria.
      SELECT bool_and(CASE
        WHEN jsonb_typeof(item) <> 'object' THEN false
        ELSE coalesce(
          (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(item) k) = ARRAY['title', 'url']
          AND jsonb_typeof(item->'title') = 'string'
          AND char_length(btrim(item->>'title')) BETWEEN 1 AND 20
          AND jsonb_typeof(item->'url') = 'string'
          AND char_length(item->>'url') <= 500
          AND item->>'url' ~* '^https?://'
          -- sem userinfo (https://user:pass@evil.x); @ no PATH segue válido
          -- (https://instagram.com/@handle) porque o guard para em /?#
          AND item->>'url' !~ '^[Hh][Tt][Tt][Pp][Ss]?://[^/?#]*@'
          -- sem barra invertida: o parser WHATWG do browser normaliza a barra
          -- invertida para / (https://a.com<bs>@evil.com viraria path la e
          -- userinfo aqui); rejeitar nas TRES camadas mantem cliente e CHECK
          -- de acordo. chr(92) evita ambiguidade de escape.
          AND strpos(item->>'url', chr(92)) = 0
        , false)
      END)
      FROM jsonb_array_elements(b) AS item
    ), true)
  END
$$;

ALTER TABLE instagram_comment_automations
  ADD COLUMN dm_buttons jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD CONSTRAINT ica_dm_buttons_valid CHECK (validate_ig_dm_buttons(dm_buttons)),
  -- O button template da Meta limita o texto a 640 chars; sem botão o CHECK
  -- original de dm_message (1..1000) segue valendo sozinho. O guard de
  -- jsonb_typeof evita 22023 em jsonb_array_length caso um valor não-array
  -- escape (a ordem de avaliação dos CHECKs não é garantida).
  ADD CONSTRAINT ica_dm_message_len_with_buttons CHECK (
    jsonb_typeof(dm_buttons) <> 'array'
    OR jsonb_array_length(dm_buttons) = 0
    OR char_length(dm_message) <= 640
  );

-- Forma com que a DM foi de fato entregue. NULL = ainda não entregue, ou
-- entregue sem sabermos a forma (auto-correção via already_replied).
ALTER TABLE instagram_automation_sends
  ADD COLUMN dm_kind text CHECK (
    dm_kind IS NULL OR dm_kind IN ('text', 'buttons', 'buttons_fallback_text')
  );

-- mark_automation_dm_sent ganha p_dm_kind. DROP + CREATE (não OR REPLACE):
-- a lista de argumentos muda e CREATE OR REPLACE criaria uma sobrecarga
-- (precedente: 20260807000002). O deploy da function usa DEFAULT NULL, então
-- o código antigo continua funcionando entre a migration e o redeploy.
DROP FUNCTION mark_automation_dm_sent(uuid);

-- Transição atômica dm_status -> 'sent' + contador + dm_kind. O incremento e
-- o dm_kind acontecem EXATAMENTE na transição (condicional, mesma transação):
-- retry/redelivery caem no IS DISTINCT FROM e não regravam nada.
CREATE FUNCTION mark_automation_dm_sent(p_send_id uuid, p_dm_kind text DEFAULT NULL)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_automation uuid;
BEGIN
  UPDATE instagram_automation_sends
     SET dm_status = 'sent', dm_kind = p_dm_kind
   WHERE id = p_send_id AND dm_status IS DISTINCT FROM 'sent'
  RETURNING automation_id INTO v_automation;

  IF v_automation IS NULL THEN
    RETURN false;
  END IF;

  UPDATE instagram_comment_automations
     SET dms_sent_count = dms_sent_count + 1, last_triggered_at = now()
   WHERE id = v_automation;

  RETURN true;
END $$;

REVOKE ALL ON FUNCTION mark_automation_dm_sent(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION mark_automation_dm_sent(uuid, text) TO service_role;
