-- check_rate_limit fazia count e insert em passos separados, sem lock: requests
-- concorrentes podiam todos observar contagem zero, ser permitidos e estourar o
-- teto (ex.: alertas de configuração do OAuth do Instagram limitados a 1/hora).
-- Um advisory lock transacional por chave serializa a checagem; o lock solta
-- automaticamente no commit/rollback. hashtextextended reduz colisão vs hashtext.
CREATE OR REPLACE FUNCTION check_rate_limit(
  p_key text,
  p_max_requests int,
  p_window_seconds int
)
RETURNS boolean LANGUAGE plpgsql AS $$
DECLARE
  request_count int;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(p_key, 0));

  SELECT count(*) INTO request_count
  FROM rate_limit_log
  WHERE key = p_key
  AND created_at > now() - (p_window_seconds || ' seconds')::interval;

  IF request_count >= p_max_requests THEN
    RETURN false;
  END IF;

  INSERT INTO rate_limit_log (key) VALUES (p_key);
  RETURN true;
END;
$$;
