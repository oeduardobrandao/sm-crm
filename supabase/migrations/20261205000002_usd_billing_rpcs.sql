-- =====================================================================
-- 20261205000002_usd_billing_rpcs.sql
--
-- Cobrança em USD (lançamento nos EUA, parte 2). Spec:
-- docs/superpowers/specs/2026-11-25-usd-billing-design.md
--
-- (1) admin_metrics_write_snapshot passa a gravar a moeda de cada linha em
--     workspace_subscription_snapshots.currency (coluna da 20261205000001).
--     Linha sem a chave `currency` (cron/backfill antigos durante o deploy)
--     grava 'brl', o comportamento de antes. O histórico de métricas nunca
--     soma centavos de USD com centavos de BRL: get-metrics-history devolve
--     uma série por moeda.
--     Corpo copiado da definição de 20260925130001_metrics_snapshots.sql
--     (nenhuma migration posterior a redefiniu); mesma assinatura, mesmo
--     SECURITY INVOKER, mesmos grants (service_role só).
-- =====================================================================

create or replace function public.admin_metrics_write_snapshot(
  p_date date,
  p_source text,
  p_rows jsonb
) returns jsonb
language plpgsql
set search_path = public
as $$
declare
  v_written integer;
begin
  if p_source is null or p_source not in ('cron', 'backfill') then
    raise exception 'invalid source %', p_source using errcode = '22023';
  end if;
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then
    raise exception 'p_rows must be a json array' using errcode = '22023';
  end if;

  -- Serialize concurrent writers of the same day (cron tick vs a manual trigger).
  perform pg_advisory_xact_lock(hashtext('metrics_snapshot:' || p_date::text));

  if p_source = 'backfill' and exists (
    select 1 from metrics_snapshot_runs where snapshot_date = p_date and source = 'cron'
  ) then
    return jsonb_build_object('written', 0, 'skipped', true);
  end if;

  delete from workspace_subscription_snapshots where snapshot_date = p_date;

  insert into workspace_subscription_snapshots (
    workspace_id, snapshot_date, provider, plan_id, plan_name, status, billing_interval,
    monthly_cents, amount_source, provider_switch, source, currency
  )
  select r.workspace_id, p_date, r.provider, r.plan_id, r.plan_name, r.status, r.billing_interval,
         coalesce(r.monthly_cents, 0), r.amount_source, coalesce(r.provider_switch, false), p_source,
         coalesce(r.currency, 'brl')
  from jsonb_to_recordset(p_rows) as r(
    workspace_id uuid, provider text, plan_id text, plan_name text, status text,
    billing_interval text, monthly_cents integer, amount_source text, provider_switch boolean,
    currency text
  );
  get diagnostics v_written = row_count;

  insert into metrics_snapshot_runs (snapshot_date, source, row_count, completed_at)
  values (p_date, p_source, v_written, now())
  on conflict (snapshot_date) do update
    set source = excluded.source, row_count = excluded.row_count, completed_at = excluded.completed_at;

  return jsonb_build_object('written', v_written, 'skipped', false);
end;
$$;

-- CREATE OR REPLACE keeps the existing ACL; restated so this file alone is the source of truth.
revoke all on function public.admin_metrics_write_snapshot(date, text, jsonb)
  from public, anon, authenticated;
grant execute on function public.admin_metrics_write_snapshot(date, text, jsonb)
  to service_role;


-- =====================================================================
-- (2) RPCs que alimentam e-mails e o Admin passam a conhecer a moeda.
--     Corpos copiados da ultima definicao (20261130000001_reverse_trial.sql;
--     nenhuma migration posterior as redefiniu), mudando so o necessario:
--     - get_trial_reminder_candidates: nova coluna `currency` (s.currency, a
--       moeda do valor que a assinatura ja guarda em amount_cents).
--     - get_reverse_trial_email_candidates: nova coluna `currency` (moeda de
--       cobranca do workspace) e price_cents vem de price_usd quando USD.
--     - admin_list_workspaces: o fallback de preco do plano (assinatura sem
--       amount_cents) usa price_usd*/billing_currency do workspace; retorna
--       jsonb, entao nao precisa de DROP.
--     As duas de candidatos mudam o RETURNS TABLE: DROP + CREATE, grants
--     refeitos (service_role so).
-- =====================================================================

drop function if exists public.get_trial_reminder_candidates();
create or replace function public.get_trial_reminder_candidates()
returns table (
  workspace_id uuid,
  workspace_name text,
  owner_email text,
  owner_nome text,
  plan_name text,
  provider text,
  amount_cents int,
  amount_interval text,
  billing_interval text,
  first_charge_at timestamptz,
  attempts int,
  reverse_trial_conversion boolean,
  currency text
)
language sql
security definer
set search_path = public
as $$
  select ws.id,
         ws.name,
         u.email::text,
         p.nome,
         coalesce(pl.name, s.plan_id),
         s.provider,
         s.amount_cents,
         s.amount_interval,
         s.billing_interval,
         s.current_period_end,
         case
           when le.id is null or le.ref_at is distinct from s.current_period_end then 0
           else le.attempts
         end,
         ws.reverse_trial_card_added_at is not null,
         s.currency
  from workspace_subscriptions s
  join workspaces ws on ws.id = s.workspace_id
  cross join lateral (
    select wm.user_id
    from workspace_members wm
    where wm.workspace_id = ws.id and wm.role = 'owner'
    order by (wm.user_id = ws.created_by) desc, wm.joined_at asc, wm.user_id asc
    limit 1
  ) owner_pick
  join auth.users u on u.id = owner_pick.user_id
  left join profiles p on p.id = owner_pick.user_id
  left join plans pl on pl.id = s.plan_id
  left join lifecycle_emails le
    on le.email_type = 'trial_reminder' and le.workspace_id = ws.id
  where s.status = 'trialing'
    and s.cancel_at_period_end = false
    and s.current_period_end is not null
    and s.current_period_end between now() + interval '3 days'
                                 and now() + interval '7 days 1 hour'
    and (s.switched_from_stripe_subscription_id is null
         or s.switched_from_trialing is true)
    and u.email is not null
    and (le.id is null
         or le.ref_at is distinct from s.current_period_end
         or (le.delivered_at is null
             and le.sent_at <= now() - interval '1 hour'
             and le.attempts < 30))
  order by s.current_period_end asc, ws.id asc
  limit 50
$$;

revoke all on function public.get_trial_reminder_candidates() from public, anon, authenticated;
grant execute on function public.get_trial_reminder_candidates() to service_role;

drop function if exists public.get_reverse_trial_email_candidates(timestamptz);
create or replace function public.get_reverse_trial_email_candidates(p_now timestamptz default now())
returns table (
  workspace_id uuid,
  user_id uuid,
  email text,
  nome text,
  workspace_name text,
  email_type text,
  ref_at timestamptz,
  ends_at timestamptz,
  ended_at timestamptz,
  hub_pause_at timestamptz,
  plan_name text,
  price_cents int,
  attempts int,
  currency text
)
language sql
stable
security definer
set search_path = public
as $$
  with dflt as (
    select id from plans where is_default limit 1
  ),
  cand as (
    select w.id as workspace_id, 'reverse_trial_ending'::text as email_type,
           w.reverse_trial_ends_at as ref_at
      from workspaces w
     where w.plan_source = 'trial'
       and w.reverse_trial_ends_at > p_now
       and w.reverse_trial_ends_at <= p_now + interval '3 days'
    union all
    select w.id, 'reverse_trial_ended', w.reverse_trial_ended_at
      from workspaces w
     where w.reverse_trial_outcome = 'downgraded'
       and w.reverse_trial_ended_at is not null
       and p_now < w.reverse_trial_ended_at + interval '7 days'
       and w.plan_source is distinct from 'manual'
       and coalesce(w.plan_id, (select id from dflt)) = (select id from dflt)
    union all
    select w.id, 'reverse_trial_hub_pausing', w.reverse_trial_ended_at + interval '7 days'
      from workspaces w
     where w.reverse_trial_outcome = 'downgraded'
       and w.reverse_trial_ended_at is not null
       and p_now >= w.reverse_trial_ended_at + interval '6 days'
       and p_now <  w.reverse_trial_ended_at + interval '7 days'
       and w.plan_source is distinct from 'manual'
       and coalesce(w.plan_id, (select id from dflt)) = (select id from dflt)
       and exists (
         select 1 from client_hub_tokens t
          where t.conta_id = w.id and t.is_active and t.expires_at > p_now)
  )
  select w.id,
         o.user_id,
         u.email::text,
         p.nome,
         w.name,
         c.email_type,
         c.ref_at,
         w.reverse_trial_ends_at,
         w.reverse_trial_ended_at,
         case when w.reverse_trial_ended_at is not null
              then w.reverse_trial_ended_at + interval '7 days' end,
         coalesce(pl.name, w.reverse_trial_plan_id),
         case when w.billing_currency = 'usd' then pl.price_usd else pl.price_brl end,
         case
           when le.id is null or le.ref_at is distinct from c.ref_at then 0
           else le.attempts
         end,
         w.billing_currency
    from cand c
    join workspaces w on w.id = c.workspace_id
    cross join lateral (select _nurture_current_owner(w.id) as user_id) o
    join auth.users u on u.id = o.user_id
    left join profiles p on p.id = o.user_id
    left join plans pl on pl.id = coalesce(w.reverse_trial_plan_id, 'pro')
    left join lifecycle_emails le
      on le.email_type = c.email_type and le.workspace_id = w.id
   where u.email is not null
     and (le.id is null
          or le.ref_at is distinct from c.ref_at
          or (le.delivered_at is null
              and le.sent_at <= p_now - interval '1 hour'
              and le.attempts < 30))
   order by c.ref_at asc, w.id asc
   limit 100
$$;

revoke all on function public.get_reverse_trial_email_candidates(timestamptz) from public, anon, authenticated;
grant execute on function public.get_reverse_trial_email_candidates(timestamptz) to service_role;

CREATE OR REPLACE FUNCTION public.admin_list_workspaces(
  p_search        text        DEFAULT NULL,
  p_plan_id       text        DEFAULT NULL,
  p_offset        int         DEFAULT 0,
  p_limit         int         DEFAULT 20,
  p_as_of         timestamptz DEFAULT NULL,
  p_status        text        DEFAULT NULL,
  p_has_overrides boolean     DEFAULT NULL,
  p_activity      text        DEFAULT NULL,
  p_created_since timestamptz DEFAULT NULL,
  p_sort          text        DEFAULT 'created_at',
  p_dir           text        DEFAULT 'desc'
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
WITH default_plan AS (
  SELECT id, name FROM plans WHERE is_default = true LIMIT 1
),
args AS (
  -- v9: p_plan_id, p_status and p_activity each take one value or a comma-separated list
  -- (OR within a filter, AND across filters). Blank entries are dropped; unknown status and
  -- activity values are ignored, so a list with no known value does not filter (the same
  -- "unknown means no filter" rule v5 had for a single value). Plan ids are not validated:
  -- an unknown id matches nothing, as before. NULL, '' and an all-blank list mean no filter.
  -- Readers write `= ANY((SELECT x FROM args)::text[])`: without the cast Postgres reads
  -- ANY(subquery) and compares text to text[].
  SELECT
    NULLIF(ARRAY(SELECT DISTINCT btrim(x) FROM unnest(string_to_array(p_plan_id, ',')) x
                  WHERE btrim(x) <> ''), '{}') AS plan_ids,
    NULLIF(ARRAY(SELECT DISTINCT btrim(x) FROM unnest(string_to_array(p_status, ',')) x
                  WHERE btrim(x) IN ('ativo', 'teste', 'pendente', 'cancelado', 'sem_assinatura',
                                     'teste_sem_cartao')),
           '{}') AS statuses,
    NULLIF(ARRAY(SELECT DISTINCT btrim(x) FROM unnest(string_to_array(p_activity, ',')) x
                  WHERE btrim(x) IN ('7d', '30d', 'dormente', 'nunca')), '{}') AS activities
),
flags AS (
  -- NULL-safe: p_sort may arrive as a literal NULL, and NULL here would make the CASEs below
  -- take their ELSE arm silently. IS NOT DISTINCT FROM keeps this a plain boolean.
  SELECT ((SELECT activities FROM args) IS NOT NULL
          OR p_sort IS NOT DISTINCT FROM 'last_activity_at') AS needs_full
),
base AS (
  SELECT b.*
    FROM (
      SELECT
        w.id,
        w.name,
        w.logo_url,
        w.created_at,
        w.created_by,
        (SELECT count(*) FROM workspace_members m WHERE m.workspace_id = w.id) AS member_count,
        (SELECT count(*) FROM clientes c WHERE c.conta_id = w.id)              AS client_count,
        COALESCE(pl.name, (SELECT name FROM default_plan))                     AS plan_name,
        w.plan_source,
        w.reverse_trial_ends_at,
        w.reverse_trial_outcome,
        w.billing_currency,
        EXISTS (
          SELECT 1 FROM workspace_plan_overrides o
           WHERE o.workspace_id = w.id
             AND (o.resource_overrides IS NOT NULL OR o.feature_overrides IS NOT NULL)
        ) AS has_overrides,
        s.status AS sub_status
        FROM workspaces w
        LEFT JOIN plans pl ON pl.id = w.plan_id
        -- At most one subscription row per workspace: the previous revision's LATERAL had no
        -- LIMIT either, so it relied on the same invariant. A plain join cannot multiply rows.
        LEFT JOIN workspace_subscriptions s ON s.workspace_id = w.id
       WHERE (p_search IS NULL
              OR w.name ILIKE '%' || p_search || '%'
              OR EXISTS (
                   SELECT 1
                     FROM workspace_members m
                     JOIN auth.users u ON u.id = m.user_id
                    WHERE m.workspace_id = w.id
                      AND m.role = 'owner'
                      AND u.email ILIKE '%' || p_search || '%'))
         AND ((SELECT plan_ids FROM args) IS NULL
              OR COALESCE(w.plan_id, (SELECT id FROM default_plan)) = ANY((SELECT plan_ids FROM args)::text[]))
         AND w.created_at <= COALESCE(p_as_of, now())
         AND (p_created_since IS NULL OR w.created_at >= p_created_since)
         -- One arm per group, ORed: sem_assinatura is an IS NULL check, so the groups cannot
         -- collapse into a single `s.status = ANY(...)`.
         AND ((SELECT statuses FROM args) IS NULL
              OR ('ativo'          = ANY((SELECT statuses FROM args)::text[]) AND s.status = 'active')
              OR ('teste'          = ANY((SELECT statuses FROM args)::text[]) AND s.status = 'trialing')
              OR ('pendente'       = ANY((SELECT statuses FROM args)::text[])
                  AND s.status IN ('past_due', 'unpaid', 'incomplete'))
              OR ('cancelado'      = ANY((SELECT statuses FROM args)::text[])
                  AND s.status IN ('canceled', 'incomplete_expired', 'paused'))
              -- Covers both "no row" (LEFT JOIN miss) and "row with NULL status".
              OR ('sem_assinatura' = ANY((SELECT statuses FROM args)::text[]) AND s.status IS NULL)
              -- v10: teste reverso em andamento (Pro sem cartao)
              OR ('teste_sem_cartao' = ANY((SELECT statuses FROM args)::text[]) AND w.plan_source = 'trial'))
    ) b
   -- has_overrides is a target-list expression, so it is filtered one level up rather than
   -- spelling the EXISTS out twice.
   WHERE (p_has_overrides IS NULL OR b.has_overrides = p_has_overrides)
),
prepage AS (
  -- Cheap ranking, used only when last_activity_at is not part of the ordering or the filters.
  SELECT b.id, row_number() OVER (
    ORDER BY
      CASE WHEN p_dir = 'asc' THEN (CASE p_sort WHEN 'client_count' THEN b.client_count
                                                WHEN 'member_count' THEN b.member_count END) END ASC  NULLS LAST,
      CASE WHEN p_dir IS DISTINCT FROM 'asc' THEN (CASE p_sort WHEN 'client_count' THEN b.client_count
                                                 WHEN 'member_count' THEN b.member_count END) END DESC NULLS LAST,
      CASE WHEN p_dir = 'asc' THEN (CASE p_sort WHEN 'name' THEN lower(b.name)
                                                WHEN 'plan' THEN lower(b.plan_name) END) END ASC  NULLS LAST,
      CASE WHEN p_dir IS DISTINCT FROM 'asc' THEN (CASE p_sort WHEN 'name' THEN lower(b.name)
                                                 WHEN 'plan' THEN lower(b.plan_name) END) END DESC NULLS LAST,
      CASE WHEN p_dir = 'asc' THEN (CASE p_sort WHEN 'created_at' THEN b.created_at END) END ASC  NULLS FIRST,
      CASE WHEN p_dir IS DISTINCT FROM 'asc' THEN (CASE p_sort WHEN 'created_at' THEN b.created_at END) END DESC NULLS LAST,
      b.created_at DESC,
      b.id ASC
  ) AS rn
  FROM base b
  WHERE NOT (SELECT needs_full FROM flags)
),
target_ids AS (
  SELECT COALESCE(
    CASE WHEN (SELECT needs_full FROM flags)
         THEN (SELECT array_agg(b.id) FROM base b)
         ELSE (SELECT array_agg(p.id) FROM prepage p
                WHERE p.rn > p_offset AND p.rn <= p_offset + p_limit)
    END, '{}'::uuid[]) AS ids
),
activity AS (
  SELECT a.workspace_id, a.last_activity_at
    FROM admin_workspace_last_activity((SELECT ids FROM target_ids)) a
),
filtered AS (
  SELECT b.*, la.last_activity_at
    FROM base b
    LEFT JOIN activity la ON la.workspace_id = b.id
   WHERE ((SELECT activities FROM args) IS NULL
          OR ('7d'       = ANY((SELECT activities FROM args)::text[])
              AND la.last_activity_at >= now() - interval '7 days')
          OR ('30d'      = ANY((SELECT activities FROM args)::text[])
              AND la.last_activity_at >= now() - interval '30 days')
          OR ('dormente' = ANY((SELECT activities FROM args)::text[])
              AND la.last_activity_at <  now() - interval '30 days')
          OR ('nunca'    = ANY((SELECT activities FROM args)::text[]) AND la.last_activity_at IS NULL))
),
page AS (
  SELECT f.*, row_number() OVER (
    ORDER BY
      CASE WHEN p_dir = 'asc' THEN (CASE p_sort WHEN 'client_count' THEN f.client_count
                                                WHEN 'member_count' THEN f.member_count END) END ASC  NULLS LAST,
      CASE WHEN p_dir IS DISTINCT FROM 'asc' THEN (CASE p_sort WHEN 'client_count' THEN f.client_count
                                                 WHEN 'member_count' THEN f.member_count END) END DESC NULLS LAST,
      CASE WHEN p_dir = 'asc' THEN (CASE p_sort WHEN 'name' THEN lower(f.name)
                                                WHEN 'plan' THEN lower(f.plan_name) END) END ASC  NULLS LAST,
      CASE WHEN p_dir IS DISTINCT FROM 'asc' THEN (CASE p_sort WHEN 'name' THEN lower(f.name)
                                                 WHEN 'plan' THEN lower(f.plan_name) END) END DESC NULLS LAST,
      -- NULLS FIRST on asc: "least active first" must surface never-active workspaces.
      CASE WHEN p_dir = 'asc' THEN (CASE p_sort WHEN 'created_at'       THEN f.created_at
                                                WHEN 'last_activity_at' THEN f.last_activity_at END) END ASC  NULLS FIRST,
      CASE WHEN p_dir IS DISTINCT FROM 'asc' THEN (CASE p_sort WHEN 'created_at'       THEN f.created_at
                                                 WHEN 'last_activity_at' THEN f.last_activity_at END) END DESC NULLS LAST,
      f.created_at DESC,
      f.id ASC
  ) AS rn
  FROM filtered f
)
SELECT jsonb_build_object(
  'total',                (SELECT count(*) FROM filtered),
  'total_members',        (SELECT COALESCE(sum(member_count), 0) FROM filtered),
  'total_clients',        (SELECT COALESCE(sum(client_count), 0) FROM filtered),
  'total_instagram_accounts',        (SELECT count(*)
                                        FROM instagram_accounts ia
                                        JOIN clientes c ON c.id = ia.client_id
                                       WHERE c.conta_id IN (SELECT id FROM filtered)),
  'total_instagram_accounts_active', (SELECT count(*)
                                        FROM instagram_accounts ia
                                        JOIN clientes c ON c.id = ia.client_id
                                       WHERE c.conta_id IN (SELECT id FROM filtered)
                                         AND ia.authorization_status = 'active'),
  'total_with_overrides', (SELECT count(*) FROM filtered WHERE has_overrides),
  'workspaces',           COALESCE(
    (SELECT jsonb_agg(
              jsonb_build_object(
                'id',               p.id,
                'name',             p.name,
                'logo_url',         p.logo_url,
                'created_at',       p.created_at,
                'last_activity_at', p.last_activity_at,
                'member_count',     p.member_count,
                'client_count',     p.client_count,
                'plan_name',        p.plan_name,
                'plan_source',      p.plan_source,
                'reverse_trial_ends_at', p.reverse_trial_ends_at,
                'reverse_trial_outcome', p.reverse_trial_outcome,
                'has_overrides',    p.has_overrides,
                'owner',            own.owner_json,
                'subscription',     sub.sub_json
              ) ORDER BY p.rn)
       -- The page window is applied BEFORE the LATERALs so the owner lookup and the
       -- subscription JSON are built only for the rows actually returned.
       FROM (SELECT * FROM page WHERE rn > p_offset AND rn <= p_offset + p_limit) p
       LEFT JOIN LATERAL (
         SELECT jsonb_build_object(
           'name',             COALESCE(pr.nome, 'Unknown'),
           'email',            COALESCE(u.email, 'Unknown'),
           'telefone',         pr.telefone,
           'marketing_opt_in', COALESCE(pr.marketing_opt_in, false)
         ) AS owner_json
           FROM workspace_members m
           LEFT JOIN profiles pr ON pr.id = m.user_id
           LEFT JOIN auth.users u ON u.id = m.user_id
          WHERE m.workspace_id = p.id AND m.role = 'owner'
          ORDER BY (m.user_id = p.created_by) DESC, m.joined_at ASC, m.user_id ASC
          LIMIT 1
       ) own ON true
       LEFT JOIN LATERAL (
         SELECT jsonb_build_object(
           'provider',             s.provider,
           'status',               s.status,
           'plan_name',            sp.name,
           'billing_interval',     s.billing_interval,
           'amount_cents',         COALESCE(
                                     s.amount_cents,
                                     CASE WHEN p.billing_currency = 'usd'
                                          THEN (CASE WHEN s.billing_interval = 'year'
                                                     THEN sp.price_usd_annual ELSE sp.price_usd END)
                                          ELSE (CASE WHEN s.billing_interval = 'year'
                                                     THEN sp.price_brl_annual ELSE sp.price_brl END)
                                     END),
           'currency',             CASE
                                     WHEN s.amount_cents IS NOT NULL THEN s.currency
                                     WHEN (CASE WHEN p.billing_currency = 'usd'
                                                THEN (CASE WHEN s.billing_interval = 'year'
                                                           THEN sp.price_usd_annual ELSE sp.price_usd END)
                                                ELSE (CASE WHEN s.billing_interval = 'year'
                                                           THEN sp.price_brl_annual ELSE sp.price_brl END)
                                           END) IS NOT NULL
                                          THEN p.billing_currency
                                     ELSE NULL
                                   END,
           'interval',             COALESCE(s.amount_interval, s.billing_interval),
           'discount_label',       s.discount_label,
           'failed_payment_count', COALESCE(s.failed_payment_count, 0),
           'current_period_end',   s.current_period_end
         ) AS sub_json
           FROM workspace_subscriptions s
           LEFT JOIN plans sp ON sp.id = s.plan_id
          WHERE s.workspace_id = p.id
       ) sub ON true),
    '[]'::jsonb)
);
$$;

revoke all on function public.admin_list_workspaces(text,text,int,int,timestamptz,text,boolean,text,timestamptz,text,text) from public, anon, authenticated;
grant execute on function public.admin_list_workspaces(text,text,int,int,timestamptz,text,boolean,text,timestamptz,text,text) to service_role;
