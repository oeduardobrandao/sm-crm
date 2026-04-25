-- Create a "Clientes" root folder per workspace and reparent client folders under it.

-- Step 0: Extend check constraint to allow 'root_clients' source_type
ALTER TABLE folders DROP CONSTRAINT folders_source_type_check;
ALTER TABLE folders ADD CONSTRAINT folders_source_type_check
  CHECK (source_type = ANY (ARRAY['client', 'workflow', 'post', 'root_clients']));

-- Step 1: Create "Clientes" root folder for each workspace that has client folders
INSERT INTO folders (conta_id, name, source, source_type, source_id)
SELECT DISTINCT f.conta_id, 'Clientes', 'system', 'root_clients', 0
FROM folders f
WHERE f.source_type = 'client'
ON CONFLICT DO NOTHING;

-- Step 2: Reparent existing client folders under their workspace's "Clientes" folder
UPDATE folders cf
SET parent_id = rf.id, updated_at = now()
FROM folders rf
WHERE cf.source_type = 'client'
  AND cf.parent_id IS NULL
  AND rf.source_type = 'root_clients'
  AND rf.conta_id = cf.conta_id;

-- Step 3: Update the trigger to create client folders under "Clientes"
CREATE OR REPLACE FUNCTION folder_sync_cliente() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_parent_id bigint;
BEGIN
  IF TG_OP = 'INSERT' THEN
    -- Find or create the "Clientes" root folder for this workspace
    SELECT id INTO v_parent_id FROM folders
    WHERE source_type = 'root_clients' AND conta_id = NEW.conta_id;

    IF v_parent_id IS NULL THEN
      INSERT INTO folders (conta_id, name, source, source_type, source_id)
      VALUES (NEW.conta_id, 'Clientes', 'system', 'root_clients', 0)
      RETURNING id INTO v_parent_id;
    END IF;

    INSERT INTO folders (conta_id, parent_id, name, source, source_type, source_id)
    VALUES (NEW.conta_id, v_parent_id, NEW.nome, 'system', 'client', NEW.id);
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF NEW.nome IS DISTINCT FROM OLD.nome THEN
      UPDATE folders SET name = NEW.nome, updated_at = now()
      WHERE source_type = 'client' AND source_id = NEW.id
        AND conta_id = NEW.conta_id AND name_overridden = false;
    END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'DELETE' THEN
    DELETE FROM folders
    WHERE source_type = 'client' AND source_id = OLD.id AND conta_id = OLD.conta_id;
    RETURN OLD;
  END IF;

  RETURN NULL;
END;
$$;
