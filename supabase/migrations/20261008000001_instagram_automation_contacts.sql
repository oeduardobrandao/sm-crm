-- Contatos das automações do Instagram (spec
-- docs/superpowers/specs/2026-10-07-automation-contacts-design.md).
-- Tabelas DERIVADAS de instagram_automation_sends, mantidas por trigger, que
-- sobrevivem à exclusão da automação (sends cascateiam com ela).

-- LOCK TABLE exige bloco de transação; o db push executa cada statement fora
-- de uma, então o arquivo inteiro vai em BEGIN/COMMIT explícito.
BEGIN;

-- Fecha a corrida backfill × trigger: nenhum send novo entre o backfill e o
-- CREATE TRIGGER. O worker espera o lock (segundos) e segue.
LOCK TABLE instagram_automation_sends IN SHARE ROW EXCLUSIVE MODE;

CREATE TABLE instagram_automation_contacts (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conta_id              uuid NOT NULL,
  client_id             bigint NOT NULL,
  commenter_id          text NOT NULL,
  commenter_username    text,
  first_interaction_at  timestamptz NOT NULL,
  last_interaction_at   timestamptz NOT NULL,
  interactions_count    int NOT NULL DEFAULT 0,
  reached               boolean NOT NULL DEFAULT false,
  last_comment_text     text,
  last_automation_id    uuid,
  last_automation_name  text,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT iac_client_commenter_uq UNIQUE (client_id, commenter_id),
  CONSTRAINT iac_id_conta_uq UNIQUE (id, conta_id),
  CONSTRAINT iac_client_same_tenant FOREIGN KEY (client_id, conta_id)
    REFERENCES clientes (id, conta_id) ON DELETE CASCADE
);
CREATE INDEX idx_iac_client_last ON instagram_automation_contacts (client_id, last_interaction_at DESC, id DESC);
CREATE INDEX idx_iac_conta_last  ON instagram_automation_contacts (conta_id, last_interaction_at DESC, id DESC);
CREATE INDEX idx_iac_conta_created ON instagram_automation_contacts (conta_id, created_at, id);

CREATE TABLE instagram_automation_contact_automations (
  contact_id            uuid NOT NULL,
  conta_id              uuid NOT NULL,
  automation_id         uuid NOT NULL,
  automation_name       text NOT NULL,
  first_interaction_at  timestamptz NOT NULL,
  last_interaction_at   timestamptz NOT NULL,
  interactions_count    int NOT NULL DEFAULT 0,
  reached               boolean NOT NULL DEFAULT false,
  last_comment_text     text,
  PRIMARY KEY (contact_id, automation_id),
  CONSTRAINT iaca_contact_same_tenant FOREIGN KEY (contact_id, conta_id)
    REFERENCES instagram_automation_contacts (id, conta_id) ON DELETE CASCADE
);
CREATE INDEX idx_iaca_automation ON instagram_automation_contact_automations (automation_id, last_interaction_at DESC);
CREATE INDEX idx_iaca_conta ON instagram_automation_contact_automations (conta_id);

-- RLS: mesmo predicado de ica_select (20260904000002).
ALTER TABLE instagram_automation_contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE instagram_automation_contact_automations ENABLE ROW LEVEL SECURITY;

CREATE POLICY iac_select ON instagram_automation_contacts
  FOR SELECT USING (
    conta_id IN (SELECT public.get_my_conta_id())
    AND (SELECT public.has_permission('automacoes', 'ver'))
  );
CREATE POLICY service_role_bypass_iac ON instagram_automation_contacts
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY iaca_select ON instagram_automation_contact_automations
  FOR SELECT USING (
    conta_id IN (SELECT public.get_my_conta_id())
    AND (SELECT public.has_permission('automacoes', 'ver'))
  );
CREATE POLICY service_role_bypass_iaca ON instagram_automation_contact_automations
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Hosted default ACLs dão ALL em tabela nova para anon/authenticated: revoga
-- explicitamente e devolve só SELECT.
REVOKE ALL ON instagram_automation_contacts FROM PUBLIC, anon, authenticated;
REVOKE ALL ON instagram_automation_contact_automations FROM PUBLIC, anon, authenticated;
GRANT SELECT ON instagram_automation_contacts TO authenticated;
GRANT SELECT ON instagram_automation_contact_automations TO authenticated;
GRANT ALL ON instagram_automation_contacts TO service_role;
GRANT ALL ON instagram_automation_contact_automations TO service_role;

-- Fonte única da derivação (rebuild + snapshot). Só sends de automações VIVAS
-- (as de automações excluídas já cascatearam).
CREATE OR REPLACE FUNCTION instagram_automation_contact_source(
  p_conta_id uuid, p_automation_id uuid)
RETURNS TABLE (
  conta_id uuid, client_id bigint, automation_id uuid, automation_name text,
  commenter_id text, commenter_username text, comment_text text,
  comment_created_at timestamptz, reached boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT s.conta_id, a.client_id, s.automation_id, a.name,
         s.commenter_id, s.commenter_username, s.comment_text,
         s.comment_created_at, (s.dm_status IS NOT DISTINCT FROM 'sent')
    FROM instagram_automation_sends s
    JOIN instagram_comment_automations a ON a.id = s.automation_id
   WHERE s.commenter_id IS NOT NULL
     AND (p_automation_id IS NULL OR s.automation_id = p_automation_id)
     AND (p_conta_id IS NULL OR s.conta_id = p_conta_id);
$$;
REVOKE ALL ON FUNCTION instagram_automation_contact_source(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION instagram_automation_contact_source(uuid, uuid) TO service_role;

-- Reconciliação NÃO destrutiva: nunca apaga (contatos de automações excluídas
-- não são re-deriváveis e são justamente o que a feature retém).
CREATE OR REPLACE FUNCTION rebuild_instagram_automation_contacts(
  p_conta_id uuid DEFAULT NULL, p_automation_id uuid DEFAULT NULL)
RETURNS int LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_touched int;
BEGIN
  -- 1. Esqueleto dos contatos que faltam.
  INSERT INTO instagram_automation_contacts
    (conta_id, client_id, commenter_id, first_interaction_at, last_interaction_at)
  SELECT src.conta_id, src.client_id, src.commenter_id,
         min(src.comment_created_at), max(src.comment_created_at)
    FROM instagram_automation_contact_source(p_conta_id, p_automation_id) src
   GROUP BY src.conta_id, src.client_id, src.commenter_id
  ON CONFLICT (client_id, commenter_id) DO NOTHING;

  -- 2. Links das automações vivas: valor exato a partir dos sends.
  WITH src AS (
    SELECT * FROM instagram_automation_contact_source(p_conta_id, p_automation_id)
  ), agg AS (
    SELECT src.conta_id, src.client_id, src.automation_id, src.commenter_id,
           min(src.comment_created_at) AS f, max(src.comment_created_at) AS l,
           count(*)::int AS n, bool_or(src.reached) AS r
      FROM src GROUP BY 1, 2, 3, 4
  ), latest AS (
    SELECT DISTINCT ON (src.automation_id, src.commenter_id)
           src.automation_id, src.commenter_id, src.automation_name, src.comment_text
      FROM src ORDER BY src.automation_id, src.commenter_id, src.comment_created_at DESC
  )
  INSERT INTO instagram_automation_contact_automations AS t
    (contact_id, conta_id, automation_id, automation_name, first_interaction_at,
     last_interaction_at, interactions_count, reached, last_comment_text)
  SELECT c.id, agg.conta_id, agg.automation_id, latest.automation_name, agg.f, agg.l,
         agg.n, agg.r, latest.comment_text
    FROM agg
    JOIN latest USING (automation_id, commenter_id)
    JOIN instagram_automation_contacts c
      ON c.client_id = agg.client_id AND c.commenter_id = agg.commenter_id
  ON CONFLICT (contact_id, automation_id) DO UPDATE SET
    automation_name = EXCLUDED.automation_name,
    first_interaction_at = EXCLUDED.first_interaction_at,
    last_interaction_at = EXCLUDED.last_interaction_at,
    interactions_count = EXCLUDED.interactions_count,
    reached = EXCLUDED.reached,
    last_comment_text = EXCLUDED.last_comment_text;

  -- 3. Contatos tocados: agregados a partir de TODOS os seus links (inclusive
  --    de automações excluídas).
  WITH src AS (
    SELECT * FROM instagram_automation_contact_source(p_conta_id, p_automation_id)
  ), touched AS (
    SELECT DISTINCT c.id
      FROM src JOIN instagram_automation_contacts c
        ON c.client_id = src.client_id AND c.commenter_id = src.commenter_id
  ), agg AS (
    SELECT l.contact_id, min(l.first_interaction_at) AS f, max(l.last_interaction_at) AS la,
           sum(l.interactions_count)::int AS n, bool_or(l.reached) AS r
      FROM instagram_automation_contact_automations l
     WHERE l.contact_id IN (SELECT id FROM touched)
     GROUP BY l.contact_id
  ), latest_link AS (
    SELECT DISTINCT ON (l.contact_id) l.contact_id, l.automation_id, l.automation_name, l.last_comment_text
      FROM instagram_automation_contact_automations l
     WHERE l.contact_id IN (SELECT id FROM touched)
     ORDER BY l.contact_id, l.last_interaction_at DESC
  ), latest_user AS (
    SELECT DISTINCT ON (src.client_id, src.commenter_id)
           src.client_id, src.commenter_id, src.commenter_username AS u, src.comment_created_at AS at
      FROM src WHERE src.commenter_username IS NOT NULL
     ORDER BY src.client_id, src.commenter_id, src.comment_created_at DESC
  )
  UPDATE instagram_automation_contacts c SET
    first_interaction_at = agg.f,
    last_interaction_at = agg.la,
    interactions_count = agg.n,
    reached = agg.r,
    last_comment_text = ll.last_comment_text,
    last_automation_id = ll.automation_id,
    last_automation_name = ll.automation_name,
    commenter_username = coalesce(
      (SELECT CASE WHEN lu.at >= c.last_interaction_at OR c.commenter_username IS NULL
                   THEN lu.u ELSE c.commenter_username END
         FROM latest_user lu
        WHERE lu.client_id = c.client_id AND lu.commenter_id = c.commenter_id),
      c.commenter_username),
    updated_at = now()
  FROM agg JOIN latest_link ll USING (contact_id)
  WHERE c.id = agg.contact_id;
  GET DIAGNOSTICS v_touched = ROW_COUNT;
  RETURN v_touched;
END $$;
REVOKE ALL ON FUNCTION rebuild_instagram_automation_contacts(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION rebuild_instagram_automation_contacts(uuid, uuid) TO service_role;

-- Manutenção no caminho quente do DM: erro vira WARNING (o DM é o produto;
-- contato é derivado e o rebuild repara).
CREATE OR REPLACE FUNCTION sync_instagram_automation_contact()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_client bigint;
  v_name text;
  v_contact uuid;
  v_reached boolean;
BEGIN
  BEGIN
    SELECT a.client_id, a.name INTO v_client, v_name
      FROM instagram_comment_automations a WHERE a.id = NEW.automation_id;
    IF v_client IS NULL THEN
      RETURN NULL;
    END IF;

    IF TG_OP = 'INSERT' THEN
      v_reached := NEW.dm_status IS NOT DISTINCT FROM 'sent';

      -- Contato primeiro, link depois (mesma ordem de lock nos dois ramos).
      INSERT INTO instagram_automation_contacts AS t
        (conta_id, client_id, commenter_id, commenter_username, first_interaction_at,
         last_interaction_at, interactions_count, reached, last_comment_text,
         last_automation_id, last_automation_name)
      VALUES
        (NEW.conta_id, v_client, NEW.commenter_id, NEW.commenter_username,
         NEW.comment_created_at, NEW.comment_created_at, 1, v_reached, NEW.comment_text,
         NEW.automation_id, v_name)
      ON CONFLICT (client_id, commenter_id) DO UPDATE SET
        interactions_count = t.interactions_count + 1,
        first_interaction_at = least(t.first_interaction_at, EXCLUDED.first_interaction_at),
        last_interaction_at = greatest(t.last_interaction_at, EXCLUDED.last_interaction_at),
        commenter_username = CASE WHEN EXCLUDED.last_interaction_at >= t.last_interaction_at
          THEN coalesce(EXCLUDED.commenter_username, t.commenter_username)
          ELSE coalesce(t.commenter_username, EXCLUDED.commenter_username) END,
        last_comment_text = CASE WHEN EXCLUDED.last_interaction_at >= t.last_interaction_at
          THEN EXCLUDED.last_comment_text ELSE t.last_comment_text END,
        last_automation_id = CASE WHEN EXCLUDED.last_interaction_at >= t.last_interaction_at
          THEN EXCLUDED.last_automation_id ELSE t.last_automation_id END,
        last_automation_name = CASE WHEN EXCLUDED.last_interaction_at >= t.last_interaction_at
          THEN EXCLUDED.last_automation_name ELSE t.last_automation_name END,
        reached = t.reached OR EXCLUDED.reached,
        updated_at = now()
      RETURNING id INTO v_contact;

      INSERT INTO instagram_automation_contact_automations AS t
        (contact_id, conta_id, automation_id, automation_name, first_interaction_at,
         last_interaction_at, interactions_count, reached, last_comment_text)
      VALUES
        (v_contact, NEW.conta_id, NEW.automation_id, v_name, NEW.comment_created_at,
         NEW.comment_created_at, 1, v_reached, NEW.comment_text)
      ON CONFLICT (contact_id, automation_id) DO UPDATE SET
        interactions_count = t.interactions_count + 1,
        first_interaction_at = least(t.first_interaction_at, EXCLUDED.first_interaction_at),
        last_interaction_at = greatest(t.last_interaction_at, EXCLUDED.last_interaction_at),
        last_comment_text = CASE WHEN EXCLUDED.last_interaction_at >= t.last_interaction_at
          THEN EXCLUDED.last_comment_text ELSE t.last_comment_text END,
        automation_name = EXCLUDED.automation_name,
        reached = t.reached OR EXCLUDED.reached;
    ELSE
      -- UPDATE: o WHEN do trigger garante a virada de dm_status para 'sent'.
      SELECT c.id INTO v_contact FROM instagram_automation_contacts c
       WHERE c.client_id = v_client AND c.commenter_id = NEW.commenter_id;
      IF v_contact IS NULL THEN
        RETURN NULL;
      END IF;
      UPDATE instagram_automation_contacts SET reached = true, updated_at = now()
       WHERE id = v_contact AND NOT reached;
      UPDATE instagram_automation_contact_automations SET reached = true
       WHERE contact_id = v_contact AND automation_id = NEW.automation_id AND NOT reached;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'sync_instagram_automation_contact: %', SQLERRM;
  END;
  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION sync_instagram_automation_contact() FROM PUBLIC, anon, authenticated;

-- Renomear a automação roda como authenticated (ica_update); as tabelas novas
-- não têm policy de UPDATE para ele, daí SECURITY DEFINER.
CREATE OR REPLACE FUNCTION sync_instagram_automation_contact_names()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  BEGIN
    UPDATE instagram_automation_contacts SET last_automation_name = NEW.name, updated_at = now()
     WHERE conta_id = NEW.conta_id AND last_automation_id = NEW.id;
    UPDATE instagram_automation_contact_automations SET automation_name = NEW.name
     WHERE automation_id = NEW.id;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'sync_instagram_automation_contact_names: %', SQLERRM;
  END;
  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION sync_instagram_automation_contact_names() FROM PUBLIC, anon, authenticated;

-- Antes de a automação sumir (e cascatear os sends), reconcilia os contatos
-- dela: fecha a janela de um erro engolido pelo trigger quente. NÃO engole
-- erro: falhar o delete é melhor que perder contatos. Pula quando o cliente
-- já está sendo excluído (cascata de clientes): os contatos vão junto.
CREATE OR REPLACE FUNCTION snapshot_instagram_automation_contacts()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM clientes WHERE id = OLD.client_id) THEN
    PERFORM rebuild_instagram_automation_contacts(OLD.conta_id, OLD.id);
  END IF;
  RETURN OLD;
END $$;
REVOKE ALL ON FUNCTION snapshot_instagram_automation_contacts() FROM PUBLIC, anon, authenticated;

-- Backfill com a tabela de sends travada, ANTES dos triggers.
SELECT rebuild_instagram_automation_contacts();

CREATE TRIGGER ias_z1_sync_contact_insert
  AFTER INSERT ON instagram_automation_sends
  FOR EACH ROW WHEN (NEW.commenter_id IS NOT NULL)
  EXECUTE FUNCTION sync_instagram_automation_contact();

CREATE TRIGGER ias_z2_sync_contact_reached
  AFTER UPDATE OF dm_status ON instagram_automation_sends
  FOR EACH ROW WHEN (
    OLD.dm_status IS DISTINCT FROM 'sent' AND NEW.dm_status = 'sent'
    AND NEW.commenter_id IS NOT NULL
  )
  EXECUTE FUNCTION sync_instagram_automation_contact();

CREATE TRIGGER ica_z1_sync_contact_names
  AFTER UPDATE OF name ON instagram_comment_automations
  FOR EACH ROW WHEN (OLD.name IS DISTINCT FROM NEW.name)
  EXECUTE FUNCTION sync_instagram_automation_contact_names();

CREATE TRIGGER ica_z2_snapshot_contacts_before_delete
  BEFORE DELETE ON instagram_comment_automations
  FOR EACH ROW EXECUTE FUNCTION snapshot_instagram_automation_contacts();

-- Sanidade do backfill: WARNING, nunca EXCEPTION (um erro num lote do db push
-- pode gravar a versão com o DDL revertido).
DO $$
DECLARE v_contacts bigint; v_pairs bigint;
BEGIN
  SELECT count(*) INTO v_contacts FROM instagram_automation_contacts;
  SELECT count(DISTINCT (a.client_id, s.commenter_id)) INTO v_pairs
    FROM instagram_automation_sends s
    JOIN instagram_comment_automations a ON a.id = s.automation_id
   WHERE s.commenter_id IS NOT NULL;
  IF v_contacts <> v_pairs THEN
    RAISE WARNING 'instagram_automation_contacts backfill: % contacts vs % pairs', v_contacts, v_pairs;
  END IF;
END $$;

COMMIT;
