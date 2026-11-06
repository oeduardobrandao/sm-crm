-- Rollback of supabase/migrations/20261029000003_financeiro_mcp_lancamentos.sql.
-- Run by hand: psql "$DB_URL" -v ON_ERROR_STOP=1 -f docs/superpowers/rollbacks/20261029000003_financeiro_mcp_lancamentos.down.sql
-- Then delete the version row if the migration history must forget it:
--   DELETE FROM supabase_migrations.schema_migrations WHERE version = '20261029000003';
--
-- Order: run this BEFORE the 20261029000002 rollback (both functions call
-- _financeiro_exigir_dono, which that rollback drops). Anything that calls these
-- functions (the MCP edge function's confirmar_agendamento / create_recorrente tools)
-- must be rolled back first. Rows they already wrote (transacoes, transacoes_recorrentes)
-- are ordinary rows and stay.

BEGIN;
SET LOCAL lock_timeout = '5s';

DROP FUNCTION IF EXISTS public.financeiro_agendamento_confirmar_as(uuid, uuid, text, bigint, date);
DROP FUNCTION IF EXISTS public.financeiro_recorrente_criar_as(uuid, uuid, text, text, text, numeric, int, date, boolean, date);

COMMIT;
