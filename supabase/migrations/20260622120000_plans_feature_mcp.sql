-- MCP entitlements on plans:
--   feature_mcp   — whether a workspace may use the MCP server / mint keys
--   max_mcp_keys  — how many API keys a workspace may have (active, non-revoked)
--
-- effective_plan_feature() / effective_plan_limit() read plan columns dynamically,
-- so adding these columns is enough for gating + the count trigger to work.

ALTER TABLE plans
  ADD COLUMN IF NOT EXISTS feature_mcp  boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS max_mcp_keys int;

-- Default cap for existing plans (decision: 5 per workspace). Overridable per plan/override.
UPDATE plans SET max_mcp_keys = 5 WHERE max_mcp_keys IS NULL;

-- Decision: MCP ships on the TOP-TIER plan only. Pick the highest-priced active plan.
-- NOTE: verify this resolves to the intended plan in each environment; adjust by id if tiering
-- is not strictly price-ordered.
UPDATE plans SET feature_mcp = true
WHERE id = (
  SELECT id FROM plans
  WHERE is_active
  ORDER BY price_brl DESC NULLS LAST, sort_order DESC
  LIMIT 1
);
