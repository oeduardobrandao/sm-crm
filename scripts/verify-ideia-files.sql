-- scripts/verify-ideia-files.sql — run after applying the migration.
-- Each block RAISEs on failure so a clean run = all assertions passed.

-- A1: table + composite FKs exist
DO $$
BEGIN
  IF to_regclass('public.ideia_files') IS NULL THEN
    RAISE EXCEPTION 'A1 FAIL: ideia_files table missing';
  END IF;
  IF (SELECT count(*) FROM pg_constraint
      WHERE conrelid = 'ideia_files'::regclass AND contype = 'f') <> 3 THEN
    RAISE EXCEPTION 'A1 FAIL: expected 3 FKs (ideia, file, conta)';
  END IF;
END $$;

-- A2: RPC + triggers exist
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'ideia_file_insert_with_quota') THEN
    RAISE EXCEPTION 'A2 FAIL: RPC missing';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_ideia_file_cleanup_orphan') THEN
    RAISE EXCEPTION 'A2 FAIL: cleanup trigger missing';
  END IF;
END $$;

-- A3: cross-tenant link rejected by composite FK.
-- Picks a real file/idea if any exist; otherwise skips with a notice.
DO $$
DECLARE v_file bigint; v_idea uuid; v_other uuid;
BEGIN
  SELECT id INTO v_file FROM files LIMIT 1;
  SELECT id INTO v_idea FROM ideias LIMIT 1;
  SELECT id INTO v_other FROM workspaces
    WHERE id <> (SELECT conta_id FROM files WHERE id = v_file) LIMIT 1;
  IF v_file IS NULL OR v_idea IS NULL OR v_other IS NULL THEN
    RAISE NOTICE 'A3 SKIP: needs >=1 file, >=1 idea, >=2 workspaces';
    RETURN;
  END IF;
  BEGIN
    INSERT INTO ideia_files (ideia_id, file_id, conta_id) VALUES (v_idea, v_file, v_other);
    RAISE EXCEPTION 'A3 FAIL: cross-tenant insert was allowed';
  EXCEPTION WHEN foreign_key_violation THEN
    -- The failed INSERT is unwound automatically by this exception subtransaction;
    -- no explicit ROLLBACK (illegal inside a DO block).
    RAISE NOTICE 'A3 PASS: cross-tenant link rejected';
  END;
END $$;
