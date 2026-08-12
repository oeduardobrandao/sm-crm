-- Triggers that populate audit_log for events that previously had no
-- server-side audit trail: client creation (RLS-only) and post
-- publishing/scheduling (tracked in post_status_events but not audit_log).

-- 1. Client creation ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION trg_audit_client_create()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  BEGIN
    INSERT INTO audit_log (conta_id, actor_user_id, action, resource_type, resource_id, metadata)
    VALUES (
      NEW.conta_id,
      COALESCE(auth.uid(), NEW.user_id),
      'client-create',
      'client',
      NEW.id::text,
      jsonb_build_object('nome', NEW.nome, 'sigla', NEW.sigla)
    );
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'trg_audit_client_create failed for client %: %', NEW.id, SQLERRM;
  END;
  RETURN NEW;
END;
$$;

CREATE TRIGGER audit_client_create
  AFTER INSERT ON clientes
  FOR EACH ROW EXECUTE FUNCTION trg_audit_client_create();

-- 2. Post publish / schedule ─────────────────────────────────────
CREATE OR REPLACE FUNCTION trg_audit_post_status()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  BEGIN
    IF NEW.to_status IN ('published', 'scheduled', 'publish_failed') THEN
      INSERT INTO audit_log (conta_id, actor_user_id, action, resource_type, resource_id, metadata)
      VALUES (
        NEW.conta_id,
        NEW.actor_user_id,
        'post-' || NEW.to_status,
        'post',
        NEW.post_id::text,
        jsonb_build_object(
          'from_status', NEW.from_status,
          'to_status', NEW.to_status,
          'source', NEW.source,
          'actor_name', NEW.actor_name
        )
      );
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'trg_audit_post_status failed for event %: %', NEW.id, SQLERRM;
  END;
  RETURN NEW;
END;
$$;

CREATE TRIGGER audit_post_status
  AFTER INSERT ON post_status_events
  FOR EACH ROW EXECUTE FUNCTION trg_audit_post_status();
