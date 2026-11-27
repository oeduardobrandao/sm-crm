-- =====================================================================
-- Idioma por workspace (spec 2026-11-26-workspace-language-design, seção 1).
--
-- Todo workspace passa a ter um idioma ('pt' | 'en') que o CRM, o Hub e os
-- e-mails leem. É do workspace, não da pessoa: quem entra num workspace de
-- outro vê o idioma dele.
--
--   * workspaces.language          -- 'pt' (padrão) | 'en'.
--   * workspaces.language_set_at   -- preenchido só quando o dono escolhe pela
--     RPC. Cadastro e backfill deixam nulo: nulo significa "ainda é o padrão
--     do cadastro", e é isso que deixa billing_market_apply() corrigir para
--     'en' sem nunca desfazer uma escolha do dono.
--   * workspace_set_language(text) -- única porta de escrita do cliente. Só o
--     dono do workspace ativo (profiles.active_workspace_id, senão conta_id,
--     como em billing_market_apply); 42501 para os outros, 22023 para valor
--     fora de pt/en. Espelha o idioma em auth.users.raw_user_meta_data.language
--     do chamador (merge jsonb) para os templates de e-mail do Auth.
--   * trg_workspaces_guard_language -- anon/authenticated não mudam language
--     nem language_set_at por UPDATE direto (a policy ws_update_owner_admin
--     deixa dono ou admin atualizar a própria linha, e RLS não compara
--     OLD/NEW). Função separada do guard de cobrança, SECURITY INVOKER pelo
--     mesmo motivo daquele: current_user tem que ser o papel da requisição.
--     A RPC roda como definer (postgres), então passa pelo guard.
--   * handle_new_user_billing_market() -- o mesmo ramo market = 'us' que põe
--     USD agora põe language = 'en'. Não mexe no metadata do usuário: o
--     cadastro já leva market = 'us' e os templates do Auth leem language com
--     fallback em market.
--   * billing_market_apply() -- o reparo também põe 'en' enquanto
--     language_set_at é nulo. Tipo de retorno e lógica de moeda iguais.
--   * Backfill: workspaces já em USD (cadastro dos EUA) viram 'en', sem
--     language_set_at.
--
-- workspaces não tem allowlist de SELECT por coluna (só membros/clientes
-- têm), então a coluna nova já é legível pelo CRM sem GRANT.
--
-- EXECUTE da RPC só para authenticated (REVOKE nomeado: REVOKE FROM PUBLIC
-- não tira anon/authenticated).
-- =====================================================================

ALTER TABLE public.workspaces
  ADD COLUMN IF NOT EXISTS language text NOT NULL DEFAULT 'pt',
  ADD COLUMN IF NOT EXISTS language_set_at timestamptz;

ALTER TABLE public.workspaces
  DROP CONSTRAINT IF EXISTS workspaces_language_check;
ALTER TABLE public.workspaces
  ADD CONSTRAINT workspaces_language_check CHECK (language IN ('pt', 'en'));

-- Guard: só a RPC (definer) e a service role gravam o idioma.
CREATE OR REPLACE FUNCTION public.workspaces_guard_language()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  IF current_user IN ('anon', 'authenticated')
     AND (NEW.language        IS DISTINCT FROM OLD.language
       OR NEW.language_set_at IS DISTINCT FROM OLD.language_set_at)
  THEN
    RAISE EXCEPTION 'workspace_language_read_only'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.workspaces_guard_language() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_workspaces_guard_language ON public.workspaces;
CREATE TRIGGER trg_workspaces_guard_language
  BEFORE UPDATE ON public.workspaces
  FOR EACH ROW EXECUTE FUNCTION public.workspaces_guard_language();

-- RPC do dono.
CREATE OR REPLACE FUNCTION public.workspace_set_language(p_language text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_ws  uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;

  SELECT COALESCE(p.active_workspace_id, p.conta_id)
    INTO v_ws
    FROM public.profiles p
   WHERE p.id = v_uid;

  IF v_ws IS NULL
     OR NOT EXISTS (
       SELECT 1
         FROM public.workspace_members m
        WHERE m.workspace_id = v_ws
          AND m.user_id = v_uid
          AND m.role = 'owner'
     )
  THEN
    RAISE EXCEPTION 'owner_required' USING ERRCODE = '42501';
  END IF;

  IF p_language IS NULL OR p_language NOT IN ('pt', 'en') THEN
    RAISE EXCEPTION 'unsupported_language' USING ERRCODE = '22023';
  END IF;

  UPDATE public.workspaces
     SET language = p_language,
         language_set_at = now()
   WHERE id = v_ws;

  UPDATE auth.users
     SET raw_user_meta_data = COALESCE(raw_user_meta_data, '{}'::jsonb)
                              || jsonb_build_object('language', p_language)
   WHERE id = v_uid;

  RETURN p_language;
END;
$$;

REVOKE ALL ON FUNCTION public.workspace_set_language(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.workspace_set_language(text) TO authenticated;

-- Cadastro dos EUA: moeda e idioma. Corpo de 20261205000001 + a linha de idioma.
CREATE OR REPLACE FUNCTION public.handle_new_user_billing_market()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  BEGIN
    IF NEW.raw_user_meta_data ->> 'market' = 'us'
       AND NULLIF(NEW.raw_user_meta_data ->> 'conta_id', '') IS NULL
    THEN
      UPDATE public.workspaces
         SET billing_currency = 'usd',
             language = 'en'
       WHERE created_by = NEW.id;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'billing_market trigger failed for user %: %', NEW.id, SQLERRM;
  END;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.handle_new_user_billing_market() FROM PUBLIC, anon, authenticated;

-- Reparo de /workspace-setup. Corpo de 20261207000001 + o idioma.
CREATE OR REPLACE FUNCTION public.billing_market_apply()
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid    uuid := auth.uid();
  v_ws     uuid;
  v_market text;
  v_cur    text;
BEGIN
  IF v_uid IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT COALESCE(p.active_workspace_id, p.conta_id)
    INTO v_ws
    FROM public.profiles p
   WHERE p.id = v_uid;

  IF v_ws IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT u.raw_user_meta_data ->> 'market'
    INTO v_market
    FROM auth.users u
   WHERE u.id = v_uid;

  IF v_market = 'us'
     AND EXISTS (
       SELECT 1
         FROM public.workspace_members m
        WHERE m.workspace_id = v_ws
          AND m.user_id = v_uid
          AND m.role = 'owner'
     )
  THEN
    UPDATE public.workspaces
       SET billing_currency = 'usd'
     WHERE id = v_ws
       AND billing_currency <> 'usd'
       AND billing_currency_locked_at IS NULL
       AND NOT EXISTS (
         SELECT 1
           FROM public.workspace_subscriptions s
          WHERE s.workspace_id = v_ws
            AND (s.stripe_customer_id IS NOT NULL
              OR s.stripe_subscription_id IS NOT NULL
              OR s.pagarme_customer_id IS NOT NULL
              OR s.pagarme_subscription_id IS NOT NULL)
       );

    -- Idioma: só enquanto o dono não escolheu um.
    UPDATE public.workspaces
       SET language = 'en'
     WHERE id = v_ws
       AND language_set_at IS NULL
       AND language <> 'en';
  END IF;

  SELECT w.billing_currency
    INTO v_cur
    FROM public.workspaces w
   WHERE w.id = v_ws;

  RETURN v_cur;
END;
$$;

REVOKE ALL ON FUNCTION public.billing_market_apply() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.billing_market_apply() TO authenticated;

-- Backfill: workspaces dos EUA já criados em USD.
UPDATE public.workspaces
   SET language = 'en'
 WHERE billing_currency = 'usd'
   AND language_set_at IS NULL
   AND language <> 'en';

-- Pós-condições.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
     WHERE tgname = 'trg_workspaces_guard_language'
       AND tgrelid = 'public.workspaces'::regclass
       AND NOT tgisinternal
  ) THEN
    RAISE EXCEPTION 'trg_workspaces_guard_language missing';
  END IF;

  IF has_function_privilege('anon', 'public.workspace_set_language(text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'anon must not execute workspace_set_language';
  END IF;
  IF NOT has_function_privilege('authenticated', 'public.workspace_set_language(text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'authenticated must execute workspace_set_language';
  END IF;
END
$$;
