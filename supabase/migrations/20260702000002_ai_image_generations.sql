-- ai_image_generations — quota ledger + forensics for Estúdio image generation
-- (docs/estudio-design.md §4.2). A row is inserted BEFORE the provider call (spend is
-- never unlogged) and finalized after. Quota counting treats 'pending' rows as
-- reservations (see the trigger predicate below) so concurrent requests can't all see
-- the same under-limit count and overshoot.

CREATE TABLE IF NOT EXISTS ai_image_generations (
  id              bigserial PRIMARY KEY,
  conta_id        uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  cliente_id      bigint REFERENCES clientes(id) ON DELETE SET NULL,
  post_id         bigint,
  file_id         bigint REFERENCES files(id) ON DELETE SET NULL,  -- SET NULL: deleting the file never refunds quota
  source          text NOT NULL CHECK (source IN ('crm', 'mcp')),
  mcp_key_id      uuid,
  provider        text NOT NULL,             -- 'gemini'
  model           text NOT NULL,             -- e.g. 'gemini-3.1-flash-image'
  aspect_ratio    text NOT NULL,
  image_size      text NOT NULL,             -- '1K' | '2K'
  prompt          text NOT NULL,             -- stored (tenant content class, RLS-scoped); NEVER copied to audit_log
  reference_count int NOT NULL DEFAULT 0,
  idempotency_key text,                      -- per-submission key; safe retries never double-spend
  status          text NOT NULL DEFAULT 'pending' CHECK (status IN
    ('pending', 'succeeded', 'safety_refused', 'provider_timeout', 'provider_error',
     'failed_storage', 'failed_storage_quota')),
  provider_latency_ms int,
  tokens_out      int,
  cost_usd_estimate numeric(8,4),
  created_by      uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_via     text NOT NULL DEFAULT 'human' CHECK (created_via IN ('human', 'agent')),
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ai_image_generations_conta_month_idx
  ON ai_image_generations (conta_id, created_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS ai_image_generations_idempotency_idx
  ON ai_image_generations (conta_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

ALTER TABLE ai_image_generations ENABLE ROW LEVEL SECURITY;

-- Members may read their workspace's log (usage panel later). All writes happen via the
-- generate-image edge function / MCP tool using the service role — no client INSERT policy.
DROP POLICY IF EXISTS ai_image_generations_select ON ai_image_generations;
CREATE POLICY ai_image_generations_select ON ai_image_generations
  FOR SELECT USING (conta_id IN (SELECT public.get_my_conta_id()));

DROP POLICY IF EXISTS ai_image_generations_service_role ON ai_image_generations;
CREATE POLICY ai_image_generations_service_role ON ai_image_generations
  FOR ALL TO service_role USING (true) WITH CHECK (true);

REVOKE ALL ON ai_image_generations FROM anon;
REVOKE ALL ON ai_image_generations FROM authenticated;
GRANT SELECT ON ai_image_generations TO authenticated;

-- Monthly quota backstop. Predicate treats a 'pending' row as a live reservation only for
-- 10 minutes (self-heals reservations stranded by a crashed worker); 'succeeded' rows count
-- indefinitely within the calendar month. Fires on service-role inserts too (triggers ignore
-- roles) — this is the authoritative backstop behind the edge function's own pre-check.
DROP TRIGGER IF EXISTS trg_limit_ai_images ON ai_image_generations;
CREATE TRIGGER trg_limit_ai_images BEFORE INSERT ON ai_image_generations
  FOR EACH ROW EXECUTE FUNCTION
    enforce_plan_count_limit('rate_ai_images_per_month', 'direct', 'conta_id', 'conta_id',
      '(status = ''succeeded'' OR (status = ''pending'' AND created_at > now() - interval ''10 minutes''))');
