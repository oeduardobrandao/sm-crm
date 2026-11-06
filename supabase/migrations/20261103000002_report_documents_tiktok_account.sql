-- 20261103000002_report_documents_tiktok_account.sql
-- Conta TikTok registrada no relatório de blocos
-- (spec: docs/superpowers/specs/2026-10-28-tiktok-analytics-and-multiplatform-reports-design.md, §B3)
--
-- report-docs grava aqui a conta TikTok cujos dados entraram no data_snapshot (generate e
-- refresh-data), ao lado de instagram_account_id, que já é nullable desde 20260820000010: um
-- relatório pode ter só Instagram, só TikTok ou os dois. Mesma regra de vida da coluna do
-- Instagram: apagar a conta TikTok não apaga o relatório, só solta a referência.
--
-- Sem mudança de grant: authenticated continua com UPDATE só em (layout, title) e SELECT na
-- tabela toda; só o service role (a edge function) escreve esta coluna.

ALTER TABLE public.report_documents
  ADD COLUMN tiktok_account_id uuid REFERENCES public.tiktok_accounts(id) ON DELETE SET NULL;
