-- supabase/migrations/20260815000006_instagram_professional_account_id.sql
-- O OAuth de Instagram Login devolve um ID app-scoped (/me?fields=id), mas os
-- webhooks de comentário entregam entry.id com o ID PROFISSIONAL da conta
-- (prefixo 17841...). São espaços de ID diferentes: o lookup do webhook por
-- instagram_user_id nunca encontrava a conta e todo evento virava skip.
-- Guardamos os dois: instagram_user_id segue app-scoped (as chamadas Graph
-- existentes dependem dele) e professional_account_id vira a chave de lookup
-- do webhook. Preenchido no callback OAuth; contas antigas ficam NULL até
-- reconectar -- a aptidão para automação já exige reconexão de qualquer forma.

ALTER TABLE instagram_accounts ADD COLUMN IF NOT EXISTS professional_account_id text;

CREATE INDEX IF NOT EXISTS idx_instagram_accounts_professional_id
  ON instagram_accounts (professional_account_id)
  WHERE professional_account_id IS NOT NULL;
