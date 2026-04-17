-- Rate-limit tracking table
CREATE TABLE IF NOT EXISTS rate_limit_log (
  id bigserial PRIMARY KEY,
  key text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_rate_limit_key_created ON rate_limit_log (key, created_at);

-- Auto-cleanup: drop entries older than 1 hour
CREATE OR REPLACE FUNCTION cleanup_rate_limit_log()
RETURNS void LANGUAGE sql AS $$
  DELETE FROM rate_limit_log WHERE created_at < now() - interval '1 hour';
$$;

-- Rate-limit check RPC: returns true if under the limit
CREATE OR REPLACE FUNCTION check_rate_limit(
  p_key text,
  p_max_requests int,
  p_window_seconds int
)
RETURNS boolean LANGUAGE plpgsql AS $$
DECLARE
  request_count int;
BEGIN
  -- Count recent requests
  SELECT count(*) INTO request_count
  FROM rate_limit_log
  WHERE key = p_key
  AND created_at > now() - (p_window_seconds || ' seconds')::interval;

  IF request_count >= p_max_requests THEN
    RETURN false;
  END IF;

  -- Log this request
  INSERT INTO rate_limit_log (key) VALUES (p_key);
  RETURN true;
END;
$$;

ALTER TABLE rate_limit_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role_all" ON rate_limit_log FOR ALL TO service_role USING (true) WITH CHECK (true);
