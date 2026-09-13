-- supabase/migrations/20260902000021_analytics_reports_status_skipped.sql
-- O report-worker marca como 'skipped' relatórios de workspaces sem
-- feature_analytics_reports, mas o status_check (20260526100000) não inclui
-- 'skipped': o update falhava (23514) e era ignorado, deixando a linha presa
-- em 'generating'. A cada lock vencido (>10 min) ela voltava à frente da
-- janela de candidatos do worker ('generating' < 'pending' na ordenação),
-- roubando slots de relatórios legítimos.
-- Idempotente: safe to apply twice.

ALTER TABLE analytics_reports DROP CONSTRAINT IF EXISTS status_check;
ALTER TABLE analytics_reports
  ADD CONSTRAINT status_check
    CHECK (status IN ('pending', 'generating', 'ready', 'failed', 'skipped'));
