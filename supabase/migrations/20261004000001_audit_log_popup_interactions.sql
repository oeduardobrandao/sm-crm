-- Interações com popups no histórico de eventos do workspace (Admin > detalhe
-- do workspace). O card lê audit_log por conta_id; popup_interactions só tem
-- user_id, então este trigger espelha cada interação em audit_log, no mesmo
-- formato dos triggers de 20260812000002_audit_log_event_history_triggers.sql.
--
-- Ações: popup-seen (no máximo uma por usuário/popup/dia, ver GlobalPopupHost),
-- popup-closed, popup-cta e popup-ack.
--
-- O título é copiado para metadata: global_popups apaga popup_interactions em
-- cascata, então depois que um popup é excluído o audit_log é o único registro.

CREATE OR REPLACE FUNCTION trg_audit_popup_interaction()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_conta_id uuid;
BEGIN
  BEGIN
    -- Mesma fonte que a policy de SELECT de global_popups usa para decidir
    -- quais popups o usuário vê.
    SELECT conta_id INTO v_conta_id FROM profiles WHERE id = NEW.user_id;
    IF v_conta_id IS NULL THEN
      RETURN NEW;
    END IF;

    INSERT INTO audit_log (conta_id, actor_user_id, action, resource_type, resource_id, metadata)
    VALUES (
      v_conta_id,
      NEW.user_id,
      'popup-' || NEW.action,
      'popup',
      NEW.popup_id::text,
      jsonb_build_object(
        'popup_id', NEW.popup_id,
        'title', (SELECT g.pages->0->>'title' FROM global_popups g WHERE g.id = NEW.popup_id)
      )
    );
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'trg_audit_popup_interaction failed for interaction %: %', NEW.id, SQLERRM;
  END;
  RETURN NEW;
END;
$$;

-- Função de trigger: ninguém chama direto. Nomear anon/authenticated (FROM
-- public sozinho não remove os grants explícitos do Supabase hospedado).
REVOKE ALL ON FUNCTION trg_audit_popup_interaction() FROM public, anon, authenticated;

CREATE TRIGGER audit_popup_interaction
  AFTER INSERT ON popup_interactions
  FOR EACH ROW EXECUTE FUNCTION trg_audit_popup_interaction();

-- Backfill das interações anteriores, com a data original. O workspace vem do
-- profiles.conta_id ATUAL do usuário: quem trocou de workspace desde então
-- aparece no histórico do workspace de agora.
INSERT INTO audit_log (created_at, conta_id, actor_user_id, action, resource_type, resource_id, metadata)
SELECT
  pi.created_at,
  p.conta_id,
  pi.user_id,
  'popup-' || pi.action,
  'popup',
  pi.popup_id::text,
  jsonb_build_object('popup_id', pi.popup_id, 'title', g.pages->0->>'title')
FROM popup_interactions pi
JOIN profiles p ON p.id = pi.user_id
JOIN global_popups g ON g.id = pi.popup_id
WHERE p.conta_id IS NOT NULL
  -- Reaplicar a migration (db push pode gravar a versão e reverter o DDL) não
  -- duplica o histórico.
  AND NOT EXISTS (
    SELECT 1 FROM audit_log a
    WHERE a.resource_type = 'popup'
      AND a.resource_id = pi.popup_id::text
      AND a.actor_user_id = pi.user_id
      AND a.action = 'popup-' || pi.action
      AND a.created_at = pi.created_at
  )
ORDER BY pi.created_at;
