CREATE TABLE IF NOT EXISTS oauth_states (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  nonce text NOT NULL UNIQUE,
  client_id bigint NOT NULL,
  conta_id text NOT NULL,
  initiated_by uuid NOT NULL,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_oauth_states_nonce ON oauth_states(nonce);
CREATE INDEX IF NOT EXISTS idx_oauth_states_expires_at ON oauth_states(expires_at);
