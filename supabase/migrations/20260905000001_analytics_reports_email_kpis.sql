-- 20260905000001_analytics_reports_email_kpis.sql
-- KPIs compactos do e-mail de relatório (spec 2026-09-03 §10). Gravado pelo
-- instagram-report-generator-v2 na geração; lido pelo report-worker no envio.
-- Nullable de propósito: relatórios antigos ficam sem a fila (sem backfill).
-- Shape: { views?: {value, pct_change?}, interactions?: {...}, followers_gained?: {...} }
ALTER TABLE analytics_reports ADD COLUMN IF NOT EXISTS email_kpis jsonb;
