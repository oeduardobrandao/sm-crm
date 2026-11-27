-- Login do cliente no Hub: endurecimento (segue a 20261129000001).
--
-- 1. Teto diário de tentativas por par (cliente, e-mail). O teto por código (5) mais o limite
--    de pedidos (5 por hora) ainda deixava 600 palpites por dia num e-mail da lista. Agora, com
--    20 tentativas em 24 horas no par, hub_login_verify recusa qualquer código e
--    hub_login_issue deixa de emitir (a pessoa não recebe um código que não funcionaria).
--    A resposta é a mesma de código errado: um e-mail fora da lista nunca tem linha em
--    hub_login_codes, então uma resposta própria de "bloqueado" revelaria quem está na lista.
--    A contagem lê hub_login_codes (o cleanup guarda cada código por 1 dia depois de vencer);
--    rate_limit_log não serve, é podado de hora em hora.
--    Custo aceito: quem tem o link do Hub e conhece um e-mail da lista consegue travar o login
--    daquela pessoa, e manter travado repetindo as 20 tentativas a cada 24 horas. O bloqueio é
--    silencioso para ela (o pedido responde ok e o e-mail não chega). A contagem inclui os
--    logins que deram certo: 20 entradas do mesmo e-mail no mesmo cliente em 24 horas também
--    fecham o teto.
-- 2. Sessões órfãs. hub_sessions é por e-mail e não tem FK: excluir um cliente ou um workspace
--    apaga hub_client_people em cascata e deixava a sessão viva até vencer (90 dias), pronta
--    para voltar a valer se o mesmo e-mail fosse cadastrado de novo. O cleanup de hora em hora
--    passa a apagar toda sessão cujo e-mail não está na lista de nenhum cliente.
--    (hub_people_remove já fazia isso na hora para a remoção pelo CRM.)
--
-- Aditiva e segura antes de qualquer código: nenhuma assinatura muda.

SET lock_timeout = '5s';

-- Serve o NOT EXISTS por e-mail do cleanup e do hub_people_remove (o UNIQUE é (cliente_id, email)).
CREATE INDEX IF NOT EXISTS hub_client_people_email_idx ON public.hub_client_people (email);

-- true quando o par (cliente, e-mail) já gastou as 20 tentativas das últimas 24 horas.
-- Espera o e-mail já normalizado (lower + btrim), como as duas RPCs abaixo passam.
CREATE OR REPLACE FUNCTION public._hub_login_capped(p_cliente_id bigint, p_email text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT coalesce(sum(c.attempts), 0) >= 20
    FROM hub_login_codes c
   WHERE c.cliente_id = p_cliente_id
     AND c.email = p_email
     AND c.created_at > now() - interval '24 hours';
$$;

CREATE OR REPLACE FUNCTION public.hub_login_issue(p_cliente_id bigint, p_email text, p_code text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_salt  text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM hub_client_people p WHERE p.cliente_id = p_cliente_id AND p.email = v_email) THEN
    RETURN false;
  END IF;
  IF public._hub_login_capped(p_cliente_id, v_email) THEN
    RETURN false;
  END IF;

  UPDATE hub_login_codes c
     SET used_at = now()
   WHERE c.cliente_id = p_cliente_id AND c.email = v_email AND c.used_at IS NULL;

  v_salt := encode(extensions.gen_random_bytes(16), 'hex');
  INSERT INTO hub_login_codes (cliente_id, email, code_hash, salt, expires_at)
  VALUES (p_cliente_id, v_email,
          encode(sha256(convert_to(v_salt || ':' || p_code, 'UTF8')), 'hex'),
          v_salt, now() + interval '10 minutes');
  RETURN true;
END;
$$;

-- Nunca levanta exceção para código errado: um raise desfaria o incremento de attempts.
CREATE OR REPLACE FUNCTION public.hub_login_verify(p_cliente_id bigint, p_email text, p_code text, p_session_hash text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_row   hub_login_codes%ROWTYPE;
BEGIN
  SELECT * INTO v_row
    FROM hub_login_codes c
   WHERE c.cliente_id = p_cliente_id AND c.email = v_email
     AND c.used_at IS NULL AND c.expires_at > now()
   ORDER BY c.created_at DESC, c.id DESC
   LIMIT 1
   FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false);
  END IF;
  IF v_row.attempts >= 5 THEN
    RETURN jsonb_build_object('ok', false);
  END IF;
  -- Teto diário, lido sob o lock da linha acima: duas tentativas simultâneas no mesmo par
  -- disputam o mesmo código vigente, então a segunda já enxerga o incremento da primeira.
  IF public._hub_login_capped(p_cliente_id, v_email) THEN
    RETURN jsonb_build_object('ok', false);
  END IF;

  UPDATE hub_login_codes SET attempts = attempts + 1 WHERE id = v_row.id;

  IF encode(sha256(convert_to(v_row.salt || ':' || coalesce(p_code, ''), 'UTF8')), 'hex')
     IS DISTINCT FROM v_row.code_hash THEN
    RETURN jsonb_build_object('ok', false);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM hub_client_people p WHERE p.cliente_id = p_cliente_id AND p.email = v_email) THEN
    RETURN jsonb_build_object('ok', false);
  END IF;

  UPDATE hub_login_codes SET used_at = now() WHERE id = v_row.id;
  INSERT INTO hub_sessions (token_hash, email, expires_at)
  VALUES (p_session_hash, v_email, now() + interval '90 days');
  UPDATE hub_client_people SET last_login_at = now()
   WHERE cliente_id = p_cliente_id AND email = v_email;

  RETURN jsonb_build_object('ok', true);
END;
$$;

CREATE OR REPLACE FUNCTION public.hub_login_cleanup()
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  DELETE FROM hub_login_codes WHERE expires_at < now() - interval '1 day';
  DELETE FROM hub_sessions WHERE expires_at < now();
  DELETE FROM hub_sessions s
   WHERE NOT EXISTS (SELECT 1 FROM hub_client_people p WHERE p.email = s.email);
$$;

REVOKE ALL ON FUNCTION public._hub_login_capped(bigint, text)             FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.hub_login_issue(bigint, text, text)         FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.hub_login_verify(bigint, text, text, text)  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.hub_login_cleanup()                         FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._hub_login_capped(bigint, text)            TO service_role;
GRANT EXECUTE ON FUNCTION public.hub_login_issue(bigint, text, text)        TO service_role;
GRANT EXECUTE ON FUNCTION public.hub_login_verify(bigint, text, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.hub_login_cleanup()                        TO service_role;

-- Sessões que já ficaram órfãs antes desta migration.
DELETE FROM public.hub_sessions s
 WHERE NOT EXISTS (SELECT 1 FROM public.hub_client_people p WHERE p.email = s.email);
