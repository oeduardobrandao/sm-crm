-- =====================================================================
-- 20261205000001_usd_billing_schema.sql
--
-- Cobrança em USD (lançamento nos EUA, parte 1). Spec:
-- docs/superpowers/specs/2026-11-25-usd-billing-design.md
--
-- (1) workspaces.billing_currency ('brl' | 'usd', padrão 'brl'): moeda de
--     cobrança do workspace. Nasce 'usd' no cadastro vindo da landing dos EUA
--     (metadata market = 'us', trigger abaixo). billing_currency_locked_at
--     marca o primeiro checkout: depois dele a moeda não muda mais, porque o
--     cliente Stripe do workspace já carrega uma moeda. Backfill: todo workspace
--     que já tem customer ou assinatura num provedor (linha de
--     workspace_subscriptions com stripe_customer_id, stripe_subscription_id,
--     pagarme_customer_id ou pagarme_subscription_id) nasce travado, e
--     billing_currency_set recusa esse workspace mesmo com locked_at nulo.
--     As duas colunas entram no guard workspaces_guard_billing_columns(): o
--     cliente (dono/admin via PostgREST) não troca a moeda nem destrava a
--     trava. Só RPCs DEFINER abaixo, edge functions com service role e SQL.
--
-- (2) plans.price_usd / price_usd_annual (inteiros, centavos de dólar, null =
--     plano sem preço em USD).
--
-- (3) workspace_subscription_snapshots.currency: moeda do valor do snapshot.
--
-- (4) RPCs billing_currency_lock / billing_currency_set (só service_role).
--     billing_currency_lock roda no billing-checkout (Stripe) e no
--     pagarme-checkout, depois das recusas e antes de criar o customer.
--     REVOKE nomeado de anon/authenticated: REVOKE FROM PUBLIC não os remove.
--
-- (5) Trigger on_auth_user_created_zz_billing_market (AFTER INSERT em
--     auth.users): o nome ordena depois de on_auth_user_created_workspace
--     (mesma regra do trigger de afiliados), então o workspace já existe.
--     Convite (conta_id nos metadados) entra num workspace que já existe e
--     não muda a moeda dele. Falha vira WARNING: o cadastro segue em BRL.
-- =====================================================================

ALTER TABLE public.workspaces
  ADD COLUMN IF NOT EXISTS billing_currency text NOT NULL DEFAULT 'brl',
  ADD COLUMN IF NOT EXISTS billing_currency_locked_at timestamptz NULL;

ALTER TABLE public.workspaces
  DROP CONSTRAINT IF EXISTS workspaces_billing_currency_check;
ALTER TABLE public.workspaces
  ADD CONSTRAINT workspaces_billing_currency_check
  CHECK (billing_currency IN ('brl', 'usd'));

-- Backfill da trava: quem já chegou a um provedor (Stripe ou Pagar.me) tem a moeda fixada
-- lá. Mesmo predicado de billing_currency_set abaixo. Idempotente (só linhas sem trava).
UPDATE public.workspaces w
   SET billing_currency_locked_at = now()
 WHERE w.billing_currency_locked_at IS NULL
   AND EXISTS (
     SELECT 1
       FROM public.workspace_subscriptions s
      WHERE s.workspace_id = w.id
        AND (s.stripe_customer_id IS NOT NULL
          OR s.stripe_subscription_id IS NOT NULL
          OR s.pagarme_customer_id IS NOT NULL
          OR s.pagarme_subscription_id IS NOT NULL)
   );

ALTER TABLE public.plans
  ADD COLUMN IF NOT EXISTS price_usd integer NULL,
  ADD COLUMN IF NOT EXISTS price_usd_annual integer NULL;

ALTER TABLE public.plans
  DROP CONSTRAINT IF EXISTS plans_price_usd_check,
  DROP CONSTRAINT IF EXISTS plans_price_usd_annual_check;
ALTER TABLE public.plans
  ADD CONSTRAINT plans_price_usd_check CHECK (price_usd >= 0),
  ADD CONSTRAINT plans_price_usd_annual_check CHECK (price_usd_annual >= 0);

ALTER TABLE public.workspace_subscription_snapshots
  ADD COLUMN IF NOT EXISTS currency text NOT NULL DEFAULT 'brl';

ALTER TABLE public.workspace_subscription_snapshots
  DROP CONSTRAINT IF EXISTS workspace_subscription_snapshots_currency_check;
ALTER TABLE public.workspace_subscription_snapshots
  ADD CONSTRAINT workspace_subscription_snapshots_currency_check
  CHECK (currency IN ('brl', 'usd'));

-- Guard: mesma função de 20261129000002 com as duas colunas novas na lista.
CREATE OR REPLACE FUNCTION public.workspaces_guard_billing_columns()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  IF current_user IN ('anon', 'authenticated')
     AND (NEW.plan_id                    IS DISTINCT FROM OLD.plan_id
       OR NEW.plan_source                IS DISTINCT FROM OLD.plan_source
       OR NEW.trial_offer_seen_at        IS DISTINCT FROM OLD.trial_offer_seen_at
       OR NEW.storage_used_bytes         IS DISTINCT FROM OLD.storage_used_bytes
       OR NEW.storage_quota_bytes        IS DISTINCT FROM OLD.storage_quota_bytes
       OR NEW.demo_created_at            IS DISTINCT FROM OLD.demo_created_at
       OR NEW.demo_created_by            IS DISTINCT FROM OLD.demo_created_by
       OR NEW.is_internal                IS DISTINCT FROM OLD.is_internal
       OR NEW.billing_currency           IS DISTINCT FROM OLD.billing_currency
       OR NEW.billing_currency_locked_at IS DISTINCT FROM OLD.billing_currency_locked_at)
  THEN
    RAISE EXCEPTION 'workspace_billing_columns_read_only'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.workspaces_guard_billing_columns() FROM PUBLIC, anon, authenticated;

-- Trava a moeda no primeiro checkout e devolve a moeda vigente.
CREATE OR REPLACE FUNCTION public.billing_currency_lock(p_workspace_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_currency text;
BEGIN
  UPDATE public.workspaces
     SET billing_currency_locked_at = COALESCE(billing_currency_locked_at, now())
   WHERE id = p_workspace_id
  RETURNING billing_currency INTO v_currency;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'workspace_not_found';
  END IF;
  RETURN v_currency;
END;
$$;

-- Troca a moeda enquanto não houver trava NEM linha de provedor (customer ou assinatura
-- Stripe/Pagar.me em workspace_subscriptions, mesmo predicado do backfill acima): a moeda de
-- quem chegou a um provedor está fixada lá, com ou sem locked_at. false = nada mudou.
CREATE OR REPLACE FUNCTION public.billing_currency_set(p_workspace_id uuid, p_currency text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_rows integer;
BEGIN
  IF p_currency IS NULL OR p_currency NOT IN ('brl', 'usd') THEN
    RAISE EXCEPTION 'invalid_billing_currency';
  END IF;

  UPDATE public.workspaces
     SET billing_currency = p_currency
   WHERE id = p_workspace_id
     AND billing_currency_locked_at IS NULL
     AND NOT EXISTS (
       SELECT 1
         FROM public.workspace_subscriptions s
        WHERE s.workspace_id = p_workspace_id
          AND (s.stripe_customer_id IS NOT NULL
            OR s.stripe_subscription_id IS NOT NULL
            OR s.pagarme_customer_id IS NOT NULL
            OR s.pagarme_subscription_id IS NOT NULL)
     );
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RETURN v_rows > 0;
END;
$$;

REVOKE ALL ON FUNCTION public.billing_currency_lock(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.billing_currency_set(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.billing_currency_lock(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.billing_currency_set(uuid, text) TO service_role;

-- Cadastro vindo da landing dos EUA: o workspace novo nasce em USD.
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
         SET billing_currency = 'usd'
       WHERE created_by = NEW.id;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'billing_market trigger failed for user %: %', NEW.id, SQLERRM;
  END;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.handle_new_user_billing_market() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS on_auth_user_created_zz_billing_market ON auth.users;
CREATE TRIGGER on_auth_user_created_zz_billing_market
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user_billing_market();
