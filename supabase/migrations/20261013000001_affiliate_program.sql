-- Programa de afiliados (spec: docs/superpowers/specs/2026-10-10-programa-de-afiliados-design.md).
--
-- Qualquer pessoa vira afiliada por cadastro público (edge function affiliate-public), sem
-- conta no Mesaas. Quem se cadastra pelo link (?ref=<code>) fica preso ao afiliado por
-- workspace. As faturas Stripe pagas por esse workspace nos primeiros meses (janela e
-- percentual por plano, em affiliate_commission_rules) geram comissão, e o repasse sai por
-- Stripe Connect (transfer para a conta Express do afiliado, affiliate-payout-cron).
--
-- Tabelas service-role only, exceto affiliate_commission_rules (leitura pública, para a
-- página do programa). O afiliado lê o próprio painel pelo token (affiliate-public) e os
-- admins da plataforma pelo platform-admin.

-- (1) Afiliados -------------------------------------------------------------------------
CREATE TABLE public.affiliates (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code                text NOT NULL UNIQUE CHECK (code ~ '^[a-z0-9]{4,32}$'),
  nome                text NOT NULL CHECK (char_length(btrim(nome)) BETWEEN 1 AND 120),
  email               text NOT NULL UNIQUE CHECK (email = lower(email) AND char_length(email) <= 254),
  telefone            text CHECK (telefone IS NULL OR telefone ~ '^[0-9]{10,13}$'),
  status              text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended')),
  -- Stripe Connect (conta Express). Os flags espelham a conta e são relidos do Stripe pelo
  -- painel e pelo cron de repasse; só stripe_transfers_active libera transfer.
  stripe_account_id        text UNIQUE,
  stripe_details_submitted boolean NOT NULL DEFAULT false,
  stripe_transfers_active  boolean NOT NULL DEFAULT false,
  stripe_status_checked_at timestamptz,
  terms_accepted_at   timestamptz NOT NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

-- (2) Tokens de acesso ao painel (link mágico por e-mail). Só o hash SHA-256 (hex) fica
-- guardado. Vários tokens válidos por afiliado: pedir um link novo não derruba os antigos,
-- senão qualquer um derrubaria o acesso alheio pedindo link com o e-mail da vítima.
CREATE TABLE public.affiliate_access_tokens (
  token_hash   text PRIMARY KEY CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  affiliate_id uuid NOT NULL REFERENCES public.affiliates(id) ON DELETE CASCADE,
  created_at   timestamptz NOT NULL DEFAULT now(),
  expires_at   timestamptz NOT NULL
);
CREATE INDEX affiliate_access_tokens_affiliate_idx ON public.affiliate_access_tokens (affiliate_id);

-- (2b) Tabela de comissões por plano: percentual (basis points, 3000 = 30%) e quantos meses
-- pagos de cada indicação geram comissão. Editável no Admin; leitura pública para a página
-- do programa e o simulador. Cada comissão copia o percentual do momento do pagamento.
CREATE TABLE public.affiliate_commission_rules (
  plan_id    text PRIMARY KEY REFERENCES public.plans(id) ON DELETE CASCADE,
  rate_bps   integer NOT NULL CHECK (rate_bps BETWEEN 0 AND 10000),
  months     integer NOT NULL CHECK (months BETWEEN 1 AND 120),
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.affiliate_commission_rules (plan_id, rate_bps, months)
SELECT p.id, v.rate_bps, v.months
FROM (VALUES ('start', 3000, 3), ('pro', 2500, 3), ('max', 2000, 3)) AS v(plan_id, rate_bps, months)
JOIN public.plans p ON p.id = v.plan_id
ON CONFLICT (plan_id) DO NOTHING;

-- (3) Indicações: um afiliado por workspace, gravado no cadastro e nunca reescrito.
CREATE TABLE public.affiliate_referrals (
  workspace_id uuid PRIMARY KEY REFERENCES public.workspaces(id) ON DELETE CASCADE,
  affiliate_id uuid NOT NULL REFERENCES public.affiliates(id) ON DELETE RESTRICT,
  ref_code     text NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX affiliate_referrals_affiliate_idx ON public.affiliate_referrals (affiliate_id);

-- (4) Comissões: uma por fatura Stripe paga. workspace_id vira NULL se o workspace for
-- apagado, sem perder o histórico financeiro do afiliado.
CREATE TABLE public.affiliate_commissions (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  affiliate_id          uuid NOT NULL REFERENCES public.affiliates(id) ON DELETE RESTRICT,
  workspace_id          uuid REFERENCES public.workspaces(id) ON DELETE SET NULL,
  stripe_invoice_id     text NOT NULL UNIQUE,
  currency              text NOT NULL DEFAULT 'brl',
  invoice_amount_cents  integer NOT NULL CHECK (invoice_amount_cents > 0),
  plan_id               text,
  billing_reason        text,
  -- Parte da fatura dentro da janela de meses do plano (anual pago à vista: 3/12 do valor
  -- quando a janela é de 3 meses). A comissão é rate_bps sobre este valor.
  commissionable_cents  integer NOT NULL CHECK (commissionable_cents >= 0),
  -- Meses da janela que esta fatura consumiu (mensal 1, anual até 12, proration 0).
  covered_months        integer NOT NULL DEFAULT 0 CHECK (covered_months >= 0),
  rate_bps              integer NOT NULL CHECK (rate_bps BETWEEN 0 AND 10000),
  commission_cents      integer NOT NULL CHECK (commission_cents >= 0),
  -- Acumulado da cobrança (charge.amount_refunded), não um delta: reaplicar é idempotente.
  refunded_amount_cents integer NOT NULL DEFAULT 0 CHECK (refunded_amount_cents >= 0),
  disputed              boolean NOT NULL DEFAULT false,
  net_cents             integer GENERATED ALWAYS AS (
    CASE
      WHEN disputed THEN 0
      ELSE commission_cents - round(
        commission_cents::numeric * least(refunded_amount_cents, invoice_amount_cents)
          / invoice_amount_cents
      )::integer
    END
  ) STORED,
  paid_at               timestamptz NOT NULL,
  -- Fim da carência (30 dias): antes disso a comissão é "pendente".
  available_at          timestamptz NOT NULL,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX affiliate_commissions_affiliate_idx ON public.affiliate_commissions (affiliate_id, paid_at DESC);
CREATE INDEX affiliate_commissions_workspace_idx ON public.affiliate_commissions (workspace_id);

-- (5) Repasses por Stripe Connect. A linha nasce 'pending' ANTES do transfer (o saldo
-- reservado não é pago duas vezes) e o transfer usa transfer_group = 'affiliate_payout_<id>',
-- que o cron consulta para reconciliar uma linha 'pending' de uma execução interrompida.
-- 'failed' não conta no saldo: o valor volta a ficar disponível na próxima execução.
CREATE TABLE public.affiliate_payouts (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  affiliate_id       uuid NOT NULL REFERENCES public.affiliates(id) ON DELETE RESTRICT,
  amount_cents       integer NOT NULL CHECK (amount_cents > 0),
  status             text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'paid', 'failed')),
  stripe_account_id  text NOT NULL,
  stripe_transfer_id text UNIQUE,
  failure_code       text CHECK (failure_code IS NULL OR char_length(failure_code) <= 100),
  created_at         timestamptz NOT NULL DEFAULT now(),
  paid_at            timestamptz,
  updated_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX affiliate_payouts_affiliate_idx ON public.affiliate_payouts (affiliate_id, created_at DESC);
CREATE INDEX affiliate_payouts_pending_idx ON public.affiliate_payouts (status) WHERE status = 'pending';

-- (6) RLS + grants: service_role only.
ALTER TABLE public.affiliates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.affiliate_access_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.affiliate_commission_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.affiliate_referrals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.affiliate_commissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.affiliate_payouts ENABLE ROW LEVEL SECURITY;

CREATE POLICY affiliates_service_role ON public.affiliates
  FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY affiliate_access_tokens_service_role ON public.affiliate_access_tokens
  FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY affiliate_commission_rules_service_role ON public.affiliate_commission_rules
  FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY affiliate_commission_rules_public_read ON public.affiliate_commission_rules
  FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY affiliate_referrals_service_role ON public.affiliate_referrals
  FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY affiliate_commissions_service_role ON public.affiliate_commissions
  FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY affiliate_payouts_service_role ON public.affiliate_payouts
  FOR ALL TO service_role USING (true) WITH CHECK (true);

REVOKE ALL ON TABLE
  public.affiliates,
  public.affiliate_access_tokens,
  public.affiliate_referrals,
  public.affiliate_commissions,
  public.affiliate_payouts
FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE
  public.affiliates,
  public.affiliate_access_tokens,
  public.affiliate_referrals,
  public.affiliate_commissions,
  public.affiliate_payouts
TO service_role;

REVOKE ALL ON TABLE public.affiliate_commission_rules FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.affiliate_commission_rules TO anon, authenticated;
GRANT ALL ON TABLE public.affiliate_commission_rules TO service_role;

-- (7) Atribuição no cadastro.
--
-- Trigger separado (não mexe em handle_new_user_workspace): AFTER INSERT em auth.users, com
-- nome que ordena depois de on_auth_user_created_workspace. O Postgres dispara triggers do
-- mesmo evento em ordem alfabética, então o workspace e o profile já existem aqui.
--
-- Tudo dentro de um bloco com EXCEPTION: uma falha na indicação vira WARNING e o cadastro
-- segue. Convites (conta_id nos metadados) entram num workspace que já existe e não são
-- atribuídos.
CREATE OR REPLACE FUNCTION public.record_affiliate_referral()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_code text;
  v_affiliate_id uuid;
  v_affiliate_email text;
  v_workspace_id uuid;
BEGIN
  BEGIN
    IF NULLIF(NEW.raw_user_meta_data ->> 'conta_id', '') IS NOT NULL THEN
      RETURN NEW;
    END IF;

    v_code := lower(btrim(NEW.raw_user_meta_data ->> 'ref_code'));
    IF v_code IS NULL OR v_code !~ '^[a-z0-9]{4,32}$' THEN
      RETURN NEW;
    END IF;

    SELECT a.id, a.email INTO v_affiliate_id, v_affiliate_email
    FROM public.affiliates a
    WHERE a.code = v_code AND a.status = 'active';
    IF v_affiliate_id IS NULL THEN
      RETURN NEW;
    END IF;

    -- Autoindicação pelo mesmo e-mail.
    IF v_affiliate_email = lower(NEW.email) THEN
      RETURN NEW;
    END IF;

    SELECT p.conta_id INTO v_workspace_id
    FROM public.profiles p
    WHERE p.id = NEW.id AND p.role = 'owner'::user_role;
    IF v_workspace_id IS NULL THEN
      RETURN NEW;
    END IF;

    INSERT INTO public.affiliate_referrals (workspace_id, affiliate_id, ref_code)
    VALUES (v_workspace_id, v_affiliate_id, v_code)
    ON CONFLICT (workspace_id) DO NOTHING;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'affiliate referral skipped for user %: %', NEW.id, SQLERRM;
  END;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.record_affiliate_referral() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS on_auth_user_created_zz_affiliate_referral ON auth.users;
CREATE TRIGGER on_auth_user_created_zz_affiliate_referral
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.record_affiliate_referral();

-- (8) Totais por afiliado (painel e Admin). p_affiliate_id NULL = todos.
--   pending_cents   = líquido ainda na carência
--   released_cents  = líquido fora da carência (antes de descontar repasses)
--   paid_out_cents  = repasses 'paid'
--   available_cents = released - repasses 'paid' - repasses 'pending' (pode ser negativo após
--                     estorno de comissão já repassada; o negativo abate o próximo repasse)
CREATE OR REPLACE FUNCTION public.affiliate_summaries(p_affiliate_id uuid DEFAULT NULL)
RETURNS TABLE (
  affiliate_id     uuid,
  referrals_count  integer,
  trialing_count   integer,
  paying_count     integer,
  pending_cents    bigint,
  released_cents   bigint,
  paid_out_cents   bigint,
  available_cents  bigint,
  lifetime_cents   bigint
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH refs AS (
    SELECT
      r.affiliate_id,
      count(*)::integer AS referrals_count,
      count(*) FILTER (WHERE s.provider = 'stripe' AND s.status = 'trialing')::integer AS trialing_count,
      count(*) FILTER (
        WHERE s.provider = 'stripe' AND s.status IN ('active', 'past_due')
      )::integer AS paying_count
    FROM public.affiliate_referrals r
    LEFT JOIN public.workspace_subscriptions s ON s.workspace_id = r.workspace_id
    WHERE p_affiliate_id IS NULL OR r.affiliate_id = p_affiliate_id
    GROUP BY r.affiliate_id
  ),
  comms AS (
    SELECT
      c.affiliate_id,
      coalesce(sum(c.net_cents) FILTER (WHERE c.available_at > now()), 0)::bigint AS pending_cents,
      coalesce(sum(c.net_cents) FILTER (WHERE c.available_at <= now()), 0)::bigint AS released_cents,
      coalesce(sum(c.net_cents), 0)::bigint AS lifetime_cents
    FROM public.affiliate_commissions c
    WHERE p_affiliate_id IS NULL OR c.affiliate_id = p_affiliate_id
    GROUP BY c.affiliate_id
  ),
  pays AS (
    SELECT
      p.affiliate_id,
      coalesce(sum(p.amount_cents) FILTER (WHERE p.status = 'paid'), 0)::bigint AS paid_out_cents,
      coalesce(sum(p.amount_cents) FILTER (WHERE p.status IN ('paid', 'pending')), 0)::bigint AS reserved_cents
    FROM public.affiliate_payouts p
    WHERE p_affiliate_id IS NULL OR p.affiliate_id = p_affiliate_id
    GROUP BY p.affiliate_id
  )
  SELECT
    a.id,
    coalesce(refs.referrals_count, 0),
    coalesce(refs.trialing_count, 0),
    coalesce(refs.paying_count, 0),
    coalesce(comms.pending_cents, 0),
    coalesce(comms.released_cents, 0),
    coalesce(pays.paid_out_cents, 0),
    coalesce(comms.released_cents, 0) - coalesce(pays.reserved_cents, 0),
    coalesce(comms.lifetime_cents, 0)
  FROM public.affiliates a
  LEFT JOIN refs ON refs.affiliate_id = a.id
  LEFT JOIN comms ON comms.affiliate_id = a.id
  LEFT JOIN pays ON pays.affiliate_id = a.id
  WHERE p_affiliate_id IS NULL OR a.id = p_affiliate_id;
$$;

REVOKE ALL ON FUNCTION public.affiliate_summaries(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.affiliate_summaries(uuid) TO service_role;
