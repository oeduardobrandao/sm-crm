-- VULN-005: client_hub_tokens created before token_expiry migration
-- were set to '2100-01-01' (effectively never expire).
-- Cap those to 90 days from now so they follow the same lifecycle.
-- The default for new tokens is already 365 days.

UPDATE client_hub_tokens
  SET expires_at = now() + interval '90 days'
  WHERE expires_at >= '2099-01-01'::timestamptz;
