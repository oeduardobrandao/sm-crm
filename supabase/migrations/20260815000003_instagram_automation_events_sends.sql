-- Evento durável (1 linha POR COMENTÁRIO, não por delivery: entry é array e
-- cada entry pode trazer vários changes) + máquina de estados do envio.
-- Deliberadamente append-only, sem unicidade por comment_id: redelivery gera
-- linha nova e reprocessa idempotente (o efeito externo é deduplicado pelo
-- comment_id UNIQUE de sends); o expurgo de 30 dias limita o crescimento.

CREATE TABLE instagram_webhook_events (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  delivery_id  uuid NOT NULL,
  ig_user_id   text NOT NULL,
  comment_id   text,
  raw          jsonb NOT NULL,
  received_at  timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz
);

CREATE INDEX idx_ig_webhook_events_unprocessed
  ON instagram_webhook_events (received_at) WHERE processed_at IS NULL;

-- Service-role only (padrão tiktok_webhook_events): RLS ligada, sem policies.
ALTER TABLE instagram_webhook_events ENABLE ROW LEVEL SECURITY;

-- Envio: evento durável != envio. comment_id UNIQUE = 1 private reply por
-- comentário (limite da própria Meta). FK composta tenant-safe: o worker é
-- service role e um bug não pode casar automação de um workspace com o
-- conta_id de outro.
CREATE TABLE instagram_automation_sends (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  comment_id          text NOT NULL UNIQUE,
  automation_id       uuid NOT NULL,
  conta_id            uuid NOT NULL,
  media_id            text,
  commenter_id        text,
  commenter_username  text,
  comment_text        text,
  comment_created_at  timestamptz NOT NULL,
  status              text NOT NULL DEFAULT 'processing'
    CHECK (status IN ('processing', 'retry', 'sent', 'sent_partial', 'failed', 'skipped')),
  skip_reason         text,
  error_code          text,
  dm_status           text CHECK (dm_status IN ('sent', 'failed')),
  public_reply_status text CHECK (public_reply_status IN ('sent', 'failed', 'unknown')),
  public_reply_id     text,
  processing_at       timestamptz,
  next_attempt_at     timestamptz,
  attempts            int NOT NULL DEFAULT 0,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ias_automation_same_tenant FOREIGN KEY (automation_id, conta_id)
    REFERENCES instagram_comment_automations (id, conta_id) ON DELETE CASCADE
);

CREATE INDEX idx_ias_automation_created ON instagram_automation_sends (automation_id, created_at DESC);
CREATE INDEX idx_ias_conta_created ON instagram_automation_sends (conta_id, created_at DESC);
CREATE INDEX idx_ias_retryable ON instagram_automation_sends (next_attempt_at)
  WHERE status IN ('retry', 'processing');

CREATE OR REPLACE FUNCTION set_instagram_automation_sends_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END $$;

CREATE TRIGGER instagram_automation_sends_updated_at
  BEFORE UPDATE ON instagram_automation_sends
  FOR EACH ROW EXECUTE FUNCTION set_instagram_automation_sends_updated_at();

-- Log visível na UI: SELECT para qualquer membro do workspace; escrita só
-- service role (sem policies de INSERT/UPDATE/DELETE para authenticated).
ALTER TABLE instagram_automation_sends ENABLE ROW LEVEL SECURITY;

CREATE POLICY ias_select ON instagram_automation_sends
  FOR SELECT USING (conta_id IN (SELECT public.get_my_conta_id()));

CREATE POLICY service_role_bypass_ias ON instagram_automation_sends
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Assinatura do webhook de comments confirmada (POST + GET subscribed_apps).
-- Setada/limpa APENAS pelo callback OAuth e pelo re-check diário do cron.
ALTER TABLE instagram_accounts ADD COLUMN IF NOT EXISTS comments_subscribed_at timestamptz;

-- Lookup do webhook (entry.id -> conta). NÃO-ÚNICO de propósito: a mesma
-- conta IG pode estar conectada em clientes/workspaces distintos; o conflito
-- é resolvido fail-closed no processador (spec, "Resolução de conta duplicada").
CREATE INDEX IF NOT EXISTS idx_instagram_accounts_ig_user_id
  ON instagram_accounts (instagram_user_id);
