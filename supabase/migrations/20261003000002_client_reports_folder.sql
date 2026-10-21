-- supabase/migrations/20261003000002_client_reports_folder.sql
-- Pasta "Relatórios" do cliente nos Arquivos (spec 2026-10-02, "Pasta Relatórios"):
-- destino dos envios do bloco de imagem. (conta, 'client_reports', cliente)
-- é único via folders_source_unique (índice parcial), o que torna o
-- get-or-create atômico.

-- Recria o check com TODOS os valores atuais + o novo (já existem linhas
-- root_clients; omitir quebraria o ADD CONSTRAINT).
ALTER TABLE folders DROP CONSTRAINT folders_source_type_check;
ALTER TABLE folders ADD CONSTRAINT folders_source_type_check
  CHECK (source_type = ANY (ARRAY['client', 'workflow', 'post', 'root_clients', 'client_reports']));

CREATE OR REPLACE FUNCTION public.get_or_create_client_reports_folder(p_cliente_id bigint)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ws            uuid := public.get_my_conta_id();
  v_nome          text;
  v_root          bigint;
  v_client_folder bigint;
  v_id            bigint;
BEGIN
  IF v_ws IS NULL OR NOT EXISTS (
    SELECT 1 FROM workspace_members WHERE workspace_id = v_ws AND user_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'not_found';
  END IF;

  SELECT nome INTO v_nome FROM clientes WHERE id = p_cliente_id AND conta_id = v_ws;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'not_found';
  END IF;

  SELECT id INTO v_client_folder FROM folders
   WHERE conta_id = v_ws AND source_type = 'client' AND source_id = p_cliente_id;

  IF v_client_folder IS NULL THEN
    -- Cliente anterior ao trigger de pastas: cria a pasta no formato de
    -- folder_sync_cliente (20260425000005).
    SELECT id INTO v_root FROM folders WHERE conta_id = v_ws AND source_type = 'root_clients';
    IF v_root IS NULL THEN
      INSERT INTO folders (conta_id, name, source, source_type, source_id)
      VALUES (v_ws, 'Clientes', 'system', 'root_clients', 0)
      ON CONFLICT (conta_id, source_type, source_id)
        WHERE source_type IS NOT NULL AND source_id IS NOT NULL
      DO UPDATE SET name = folders.name
      RETURNING id INTO v_root;
    END IF;
    INSERT INTO folders (conta_id, parent_id, name, source, source_type, source_id)
    VALUES (v_ws, v_root, v_nome, 'system', 'client', p_cliente_id)
    ON CONFLICT (conta_id, source_type, source_id)
      WHERE source_type IS NOT NULL AND source_id IS NOT NULL
    DO UPDATE SET name = folders.name
    RETURNING id INTO v_client_folder;
  END IF;

  -- DO UPDATE no-op (não DO NOTHING) para o RETURNING sempre devolver a linha.
  INSERT INTO folders (conta_id, parent_id, name, source, source_type, source_id)
  VALUES (v_ws, v_client_folder, 'Relatórios', 'system', 'client_reports', p_cliente_id)
  ON CONFLICT (conta_id, source_type, source_id)
    WHERE source_type IS NOT NULL AND source_id IS NOT NULL
  DO UPDATE SET name = folders.name
  RETURNING id INTO v_id;

  RETURN v_id;
END $$;

REVOKE ALL ON FUNCTION public.get_or_create_client_reports_folder(bigint) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_or_create_client_reports_folder(bigint) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_or_create_client_reports_folder(bigint) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_or_create_client_reports_folder(bigint) TO service_role;
