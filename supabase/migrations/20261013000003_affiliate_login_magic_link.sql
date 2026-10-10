-- Painel do afiliado: login por link mágico de uso único trocado por uma sessão.
-- Spec: docs/superpowers/specs/2026-10-10-afiliados-login-link-magico-design.md
--
-- 'login'   = token do e-mail: 15 minutos, uso único, só serve para a troca.
-- 'session' = token guardado no navegador: 30 dias, é o que as ações do painel aceitam.
-- As linhas existentes (links de 180 dias já enviados) viram 'session' pelo default e passam a
-- vencer em no máximo 30 dias a partir de agora.

ALTER TABLE public.affiliate_access_tokens
  ADD COLUMN kind text NOT NULL DEFAULT 'session' CHECK (kind IN ('login', 'session')),
  ADD COLUMN used_at timestamptz;

UPDATE public.affiliate_access_tokens
SET expires_at = least(expires_at, now() + interval '30 days');

-- Troca atômica: gasta o login e cria a sessão no mesmo commit. Duas trocas concorrentes do
-- mesmo link geram no máximo uma sessão (o UPDATE condicional só casa uma vez), e uma falha
-- ao criar a sessão desfaz o used_at. Devolve o affiliate_id, ou NULL se o login for
-- inválido, vencido ou já usado (o chamador responde igual nos três casos).
CREATE OR REPLACE FUNCTION public.affiliate_exchange_login(
  p_login_hash text,
  p_session_hash text,
  p_session_expires_at timestamptz
) RETURNS uuid
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_affiliate_id uuid;
BEGIN
  UPDATE affiliate_access_tokens
  SET used_at = now()
  WHERE token_hash = p_login_hash
    AND kind = 'login'
    AND used_at IS NULL
    AND expires_at > now()
  RETURNING affiliate_id INTO v_affiliate_id;

  IF v_affiliate_id IS NULL THEN
    RETURN NULL;
  END IF;

  INSERT INTO affiliate_access_tokens (token_hash, affiliate_id, expires_at, kind)
  VALUES (p_session_hash, v_affiliate_id, p_session_expires_at, 'session');

  -- Limpeza: nada mais apaga linhas vencidas desta tabela.
  DELETE FROM affiliate_access_tokens
  WHERE affiliate_id = v_affiliate_id
    AND expires_at < now() - interval '1 day';

  RETURN v_affiliate_id;
END;
$$;

-- Só a edge function (service_role) chama. REVOKE de PUBLIC sozinho não tira anon e
-- authenticated no Supabase: os papéis vão nomeados.
REVOKE EXECUTE ON FUNCTION public.affiliate_exchange_login(text, text, timestamptz)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.affiliate_exchange_login(text, text, timestamptz) TO service_role;
