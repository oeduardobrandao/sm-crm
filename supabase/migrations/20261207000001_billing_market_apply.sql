-- =====================================================================
-- Reparo da moeda do cadastro dos EUA (spec 2026-11-25-us-english-site-design §6).
--
-- O trigger on_auth_user_created_zz_billing_market (20261205000001) põe em USD o
-- workspace de quem se cadastra com raw_user_meta_data ->> 'market' = 'us', mas
-- uma falha dele vira só WARNING e o cadastro segue em BRL. billing_market_apply()
-- é o reparo que o /workspace-setup chama do lado do servidor:
--
--   * sem argumentos: o market vem do raw_user_meta_data do próprio auth.users do
--     chamador (auth.uid()). Esse metadata é gravável pelo usuário (auth.updateUser), então o
--     efeito se limita ao workspace do próprio chamador, nunca pago e destravado, só para USD
--     (sem volta) e recusado depois de qualquer trava ou linha de provedor;
--   * workspace = o ativo do chamador (profiles.active_workspace_id, senão
--     profiles.conta_id), e só se ele é owner dele em workspace_members (convidado
--     não muda a moeda do workspace que o recebe);
--   * mesmas regras de billing_currency_set: sem billing_currency_locked_at e sem
--     linha de provedor (stripe_customer_id, stripe_subscription_id,
--     pagarme_customer_id ou pagarme_subscription_id) em workspace_subscriptions;
--   * devolve a moeda do workspace ativo depois da chamada ('usd' | 'brl'; NULL sem
--     usuário ou sem workspace). Idempotente; no-op para todos os outros.
--
-- Roda como definer (dono postgres), então o UPDATE passa pelo guard
-- workspaces_guard_billing_columns(), que só barra current_user anon/authenticated,
-- do mesmo jeito que billing_currency_set. EXECUTE só para authenticated
-- (REVOKE nomeado: REVOKE FROM PUBLIC não tira anon/authenticated).
-- =====================================================================

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
