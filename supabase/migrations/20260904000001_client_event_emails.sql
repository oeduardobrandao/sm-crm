-- 20260904000001_client_event_emails.sql
-- Central de Notificações, Fase 2 (spec 2026-09-02): digest "Pendências do Hub"
-- para o cliente final. Cursor entregue separado de lease de claim; guarda de
-- papel no banco (clientes_update/insert não checam papel — precedente
-- 20260817000001); workspaces já é owner/admin por policy (20260322), então o
-- toggle geral dispensa RPC/guarda extra.

-- ---------- colunas ------------------------------------------------------
ALTER TABLE workspaces
  ADD COLUMN IF NOT EXISTS send_client_event_emails boolean NOT NULL DEFAULT false;

ALTER TABLE clientes
  ADD COLUMN IF NOT EXISTS send_event_email boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS event_email_unsub_at timestamptz,
  ADD COLUMN IF NOT EXISTS event_cursor_at timestamptz,
  ADD COLUMN IF NOT EXISTS event_claim_through timestamptz,
  ADD COLUMN IF NOT EXISTS event_claimed_at timestamptz;

-- ---------- allowlist de SELECT (trio da armadilha 20260728000002) --------
-- Re-declara a lista INTEIRA + as 2 colunas novas legíveis pelo CRM.
-- Cursor/lease ficam de fora de propósito (só service role lê/escreve).
REVOKE SELECT ON public.clientes FROM authenticated;
GRANT SELECT (
  id, user_id, conta_id, nome, sigla, cor, plano, email, telefone, status,
  created_at, notion_page_url, data_pagamento, especialidade, data_aniversario,
  dia_entrega, auto_publish_on_approval, send_report_email, include_ai_analysis,
  foto_url, send_event_email, event_email_unsub_at
) ON public.clientes TO authenticated;

-- clientes_v: recriar com as colunas novas APENDADAS POR ÚLTIMO (inserir no
-- meio renomeia colunas por ordinal e a migration falha — 20260817000001).
-- SELECT vigente copiado de 20260817000001:22-31 (o mais recente a tocar a
-- view), com send_event_email e event_email_unsub_at apendados ao final —
-- ambas fora da allowlist de cursor/lease acima de propósito.
CREATE OR REPLACE VIEW public.clientes_v WITH (security_barrier = true) AS
  SELECT c.id, c.user_id, c.conta_id, c.nome, c.sigla, c.cor, c.plano,
         c.email, c.telefone, c.status, c.created_at, c.notion_page_url,
         c.data_pagamento, c.especialidade, c.data_aniversario, c.dia_entrega,
         c.auto_publish_on_approval, c.send_report_email, c.include_ai_analysis,
         CASE WHEN public.can_see_financials()
              THEN c.valor_mensal ELSE NULL END AS valor_mensal,
         c.foto_url,
         c.send_event_email, c.event_email_unsub_at
  FROM public.clientes c
  WHERE c.conta_id = public.get_my_conta_id();

-- ---------- guarda de papel (espelho de enforce_cliente_foto_owner_admin) --
CREATE OR REPLACE FUNCTION public.enforce_cliente_notify_columns()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_changed boolean;
  v_cron_changed boolean;
BEGIN
  IF auth.role() = 'service_role' THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    -- INSERT com valor divergente do default = tentativa de burlar a guarda
    -- (send_report_email default REAL é false — 20260526100000)
    v_user_changed := NEW.send_event_email IS DISTINCT FROM true
                   OR NEW.event_email_unsub_at IS NOT NULL
                   OR NEW.send_report_email IS DISTINCT FROM false;
    v_cron_changed := NEW.event_cursor_at IS NOT NULL
                   OR NEW.event_claim_through IS NOT NULL
                   OR NEW.event_claimed_at IS NOT NULL;
  ELSE
    v_user_changed := NEW.send_event_email IS DISTINCT FROM OLD.send_event_email
                   OR NEW.event_email_unsub_at IS DISTINCT FROM OLD.event_email_unsub_at
                   OR NEW.send_report_email IS DISTINCT FROM OLD.send_report_email;
    v_cron_changed := NEW.event_cursor_at IS DISTINCT FROM OLD.event_cursor_at
                   OR NEW.event_claim_through IS DISTINCT FROM OLD.event_claim_through
                   OR NEW.event_claimed_at IS DISTINCT FROM OLD.event_claimed_at;
  END IF;

  -- cursor/lease: NINGUÉM além do service role escreve.
  IF v_cron_changed THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  IF v_user_changed THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.workspace_members
      WHERE user_id = auth.uid()
        AND workspace_id = NEW.conta_id
        AND role IN ('owner', 'admin')
    ) THEN
      RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_cliente_notify_guard ON public.clientes;
CREATE TRIGGER trg_cliente_notify_guard
  BEFORE INSERT OR UPDATE ON public.clientes
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_cliente_notify_columns();

-- ---------- claim atômico: lease separado do cursor -----------------------
-- Gates re-checados DENTRO do claim (opt-out tardio é honrado). Conteúdo é
-- verificado pelo worker DEPOIS; cliente sem conteúdo tem o lease liberado
-- sem avançar cursor.
CREATE OR REPLACE FUNCTION claim_client_event_emails(p_now timestamptz, p_limit int)
RETURNS TABLE (
  id bigint, conta_id uuid, nome text, email text,
  event_cursor_at timestamptz, event_claim_through timestamptz
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  UPDATE public.clientes c
     SET event_claim_through = p_now,
         event_claimed_at = p_now
   WHERE c.id IN (
     SELECT c2.id FROM public.clientes c2
     JOIN public.workspaces w ON w.id = c2.conta_id
     WHERE w.send_client_event_emails = true
       AND c2.send_event_email = true
       AND c2.status = 'ativo'
       AND coalesce(c2.email, '') <> ''
       AND (c2.event_cursor_at IS NULL OR c2.event_cursor_at < p_now - interval '4 hours')
       AND (c2.event_claimed_at IS NULL OR c2.event_claimed_at < p_now - interval '30 minutes')
     ORDER BY c2.event_cursor_at ASC NULLS FIRST
     LIMIT p_limit
     FOR UPDATE OF c2 SKIP LOCKED
   )
  RETURNING c.id, c.conta_id, c.nome, c.email, c.event_cursor_at, c.event_claim_through;
$$;

-- REVOKE FROM PUBLIC também derruba service_role — re-grant explícito.
REVOKE ALL ON FUNCTION claim_client_event_emails(timestamptz, int)
  FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION claim_client_event_emails(timestamptz, int)
  TO service_role;

-- ---------- índice para a varredura do digest -----------------------------
-- post_status_events só tem (post_id, created_at); a janela por workspace
-- faria seq-scan.
CREATE INDEX IF NOT EXISTS idx_post_status_events_conta_created
  ON post_status_events (conta_id, created_at);

-- ---------- schedule (APLICAR SÓ APÓS deploy da função) -------------------
do $$ begin
  if exists (select 1 from cron.job where jobname = 'client-event-email-cron') then
    perform cron.unschedule('client-event-email-cron');
  end if;
end $$;

select cron.schedule(
  'client-event-email-cron',
  '*/15 * * * *',
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url')
            || '/functions/v1/client-event-email-cron',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')
    ),
    body := '{}'::jsonb
  ) as request_id;
  $$
);
