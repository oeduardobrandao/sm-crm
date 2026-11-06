-- Métricas de e-mail transacional (Resend): uma linha por e-mail + dedupe de webhook.
-- Spec: docs/superpowers/specs/2026-11-06-email-metrics-design.md
--
-- Rollback: drop function public.email_metrics(date, date);
--           drop function public.email_sends_apply_event(text,text,text,timestamptz,text,text,boolean,text,text,text,text,text);
--           drop function public._email_event_rank(text);
-- (as tabelas podem ficar: só o service_role as toca e os contadores são históricos).

create table if not exists public.email_sends (
  email_id       text primary key,
  category       text not null,
  type           text not null,
  sent_at        timestamptz not null,
  last_event     text not null check (last_event in (
                   'sent','delivery_delayed','delivered','failed','suppressed','canceled','bounced','complained')),
  bounce_type    text,
  bounce_subtype text,
  bounce_message text,
  recipient      text,
  subject        text,
  source         text not null check (source in ('webhook','backfill')),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create index if not exists email_sends_sent_at_idx on public.email_sends (sent_at);
create index if not exists email_sends_category_sent_at_idx on public.email_sends (category, sent_at);

create table if not exists public.email_webhook_events (
  svix_id     text primary key,
  received_at timestamptz not null default now()
);

alter table public.email_sends enable row level security;
alter table public.email_webhook_events enable row level security;

revoke all on public.email_sends from public, anon, authenticated;
revoke all on public.email_webhook_events from public, anon, authenticated;
grant select, insert, update, delete on public.email_sends to service_role;
grant select, insert, delete on public.email_webhook_events to service_role;

-- Precedência: sent 0 < delivery_delayed 1 < delivered 2 < failed/suppressed/canceled 3
-- < bounced 4 < complained 5.
create or replace function public._email_event_rank(p_event text)
returns int language sql immutable set search_path = public as $$
  select case p_event
    when 'sent' then 0
    when 'delivery_delayed' then 1
    when 'delivered' then 2
    when 'failed' then 3
    when 'suppressed' then 3
    when 'canceled' then 3
    when 'bounced' then 4
    when 'complained' then 5
    else 0
  end
$$;

-- Dedupe + upsert monotônico na mesma transação. false = svix_id repetido (nada aplicado).
create or replace function public.email_sends_apply_event(
  p_svix_id text, p_email_id text, p_event text, p_sent_at timestamptz,
  p_category text, p_type text, p_has_tag boolean,
  p_bounce_type text, p_bounce_subtype text, p_bounce_message text,
  p_recipient text, p_subject text
) returns boolean
language plpgsql security definer set search_path = public as $$
declare
  v_inserted int;
  v_pii boolean := p_event in ('bounced','complained','failed','suppressed');
begin
  insert into email_webhook_events (svix_id) values (p_svix_id) on conflict do nothing;
  get diagnostics v_inserted = row_count;
  if v_inserted = 0 then
    return false;
  end if;

  insert into email_sends as s (email_id, category, type, sent_at, last_event, bounce_type,
                                bounce_subtype, bounce_message, recipient, subject, source)
  values (p_email_id, p_category, p_type, p_sent_at, p_event,
          p_bounce_type, p_bounce_subtype, left(p_bounce_message, 500),
          case when v_pii then p_recipient end,
          case when v_pii then p_subject end,
          'webhook')
  on conflict (email_id) do update set
    last_event = case when _email_event_rank(p_event) > _email_event_rank(s.last_event)
                      then p_event else s.last_event end,
    bounce_type = case when _email_event_rank(p_event) > _email_event_rank(s.last_event)
                       then coalesce(p_bounce_type, s.bounce_type) else s.bounce_type end,
    bounce_subtype = case when _email_event_rank(p_event) > _email_event_rank(s.last_event)
                          then coalesce(p_bounce_subtype, s.bounce_subtype) else s.bounce_subtype end,
    bounce_message = case when _email_event_rank(p_event) > _email_event_rank(s.last_event)
                          then coalesce(left(p_bounce_message, 500), s.bounce_message) else s.bounce_message end,
    recipient = case when v_pii and _email_event_rank(p_event) > _email_event_rank(s.last_event)
                     then coalesce(p_recipient, s.recipient) else s.recipient end,
    subject = case when v_pii and _email_event_rank(p_event) > _email_event_rank(s.last_event)
                   then coalesce(p_subject, s.subject) else s.subject end,
    category = case when s.source = 'backfill' and p_has_tag then p_category else s.category end,
    type = case when s.source = 'backfill' and p_has_tag then p_type else s.type end,
    sent_at = case when s.source = 'backfill' and p_has_tag then p_sent_at else s.sent_at end,
    source = case when s.source = 'backfill' and p_has_tag then 'webhook' else s.source end,
    updated_at = now()
  where _email_event_rank(p_event) > _email_event_rank(s.last_event)
     or (s.source = 'backfill' and p_has_tag);

  -- Limpeza oportunista (~1% das chamadas): sem cron novo.
  if random() < 0.01 then
    delete from email_webhook_events where received_at < now() - interval '7 days';
    update email_sends
       set recipient = null, subject = null, bounce_message = null
     where sent_at < now() - interval '90 days'
       and (recipient is not null or subject is not null or bounce_message is not null);
  end if;

  return true;
end $$;

revoke execute on function public._email_event_rank(text) from public, anon, authenticated;
grant execute on function public._email_event_rank(text) to service_role;
revoke execute on function public.email_sends_apply_event(text,text,text,timestamptz,text,text,boolean,text,text,text,text,text)
  from public, anon, authenticated;
grant execute on function public.email_sends_apply_event(text,text,text,timestamptz,text,text,boolean,text,text,text,text,text)
  to service_role;

-- Agregação por dia de envio em São Paulo. Enviados ("sent") = tudo menos failed/suppressed/canceled
-- (base das taxas: entrega = (delivered+complained)/sent, bounce = bounced/sent,
-- reclamação = complained/(delivered+complained)).
create or replace function public.email_metrics(p_start date, p_end date)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_result jsonb;
begin
  if p_start is null or p_end is null or p_end < p_start or p_end - p_start > 366 then
    raise exception 'invalid_range';
  end if;

  with base as (
    select *, (sent_at at time zone 'America/Sao_Paulo')::date as day
      from email_sends
     where (sent_at at time zone 'America/Sao_Paulo')::date between p_start and p_end
  ),
  customer as (
    select * from base where category not in ('interno','externo')
  ),
  by_type as (
    select category, type,
      count(*) filter (where last_event not in ('failed','suppressed','canceled')) as sent,
      count(*) filter (where last_event = 'delivered') as delivered,
      count(*) filter (where last_event = 'bounced') as bounced,
      count(*) filter (where last_event = 'complained') as complained,
      count(*) filter (where last_event = 'delivery_delayed') as delayed,
      count(*) filter (where last_event = 'sent') as pending,
      count(*) filter (where last_event in ('failed','suppressed','canceled')) as not_sent
    from base group by category, type
  ),
  days as (
    select d::date as day from generate_series(p_start, p_end, interval '1 day') d
  ),
  daily as (
    select days.day,
      count(c.*) filter (where c.last_event not in ('failed','suppressed','canceled')) as sent,
      count(c.*) filter (where c.last_event = 'delivered') as delivered,
      count(c.*) filter (where c.last_event = 'bounced') as bounced
    from days left join customer c on c.day = days.day
    group by days.day
  ),
  recent as (
    select * from customer
     where last_event in ('bounced','complained','failed','suppressed')
     order by sent_at desc limit 50
  )
  select jsonb_build_object(
    'coverage_start', (select min(sent_at) from email_sends),
    'by_type', coalesce((select jsonb_agg(jsonb_build_object(
        'category', category, 'type', type, 'sent', sent, 'delivered', delivered,
        'bounced', bounced, 'complained', complained, 'delayed', delayed,
        'pending', pending, 'not_sent', not_sent) order by category, type) from by_type), '[]'::jsonb),
    'daily', coalesce((select jsonb_agg(jsonb_build_object(
        'day', to_char(day, 'YYYY-MM-DD'), 'sent', sent, 'delivered', delivered,
        'bounced', bounced, 'other', sent - delivered - bounced) order by day) from daily), '[]'::jsonb),
    'recent', coalesce((select jsonb_agg(jsonb_build_object(
        'sent_at', sent_at, 'category', category, 'type', type, 'last_event', last_event,
        'bounce_type', bounce_type, 'bounce_message', bounce_message,
        'recipient_masked', case when recipient is null then null
            else left(recipient, 1) || '***@' || split_part(recipient, '@', 2) end,
        'subject', subject) order by sent_at desc) from recent), '[]'::jsonb)
  ) into v_result;

  return v_result;
end $$;

revoke execute on function public.email_metrics(date, date) from public, anon, authenticated;
grant execute on function public.email_metrics(date, date) to service_role;
