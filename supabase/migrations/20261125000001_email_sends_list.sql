-- Lista paginada de e-mails (Admin > Métricas de e-mail > lista completa).
-- Spec: docs/superpowers/specs/2026-11-07-email-list-design.md
--
-- Rollback: drop function public.email_sends_list(date,date,text[],text[],text[],timestamptz,text,int);
--           drop index public.email_sends_sent_at_id_idx;
-- (email_sends_sent_at_idx, usado por email_metrics, nunca é tocado aqui).

create index if not exists email_sends_sent_at_id_idx
  on public.email_sends (sent_at desc, email_id desc);

create or replace function public.email_sends_list(
  p_start date, p_end date,
  p_categories text[], p_types text[], p_events text[],
  p_cursor_sent_at timestamptz, p_cursor_id text,
  p_limit int
) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_limit int := least(greatest(coalesce(p_limit, 50), 1), 100);
  v_items jsonb;
  v_next jsonb;
  v_types jsonb := null;
begin
  if p_start is null or p_end is null or p_end < p_start or p_end - p_start > 365 then
    raise exception 'invalid_range';
  end if;

  with page as (
    select *
      from email_sends
     where sent_at >= (p_start::timestamp at time zone 'America/Sao_Paulo')
       and sent_at < ((p_end + 1)::timestamp at time zone 'America/Sao_Paulo')
       and (coalesce(cardinality(p_categories), 0) = 0 or category = any (p_categories))
       and (coalesce(cardinality(p_types), 0) = 0 or type = any (p_types))
       and (coalesce(cardinality(p_events), 0) = 0 or last_event = any (p_events))
       and (p_cursor_sent_at is null or (sent_at, email_id) < (p_cursor_sent_at, p_cursor_id))
     order by sent_at desc, email_id desc
     limit v_limit + 1
  ),
  shown as (
    select * from page order by sent_at desc, email_id desc limit v_limit
  )
  select
    coalesce((select jsonb_agg(jsonb_build_object(
        'email_id', email_id, 'sent_at', sent_at, 'category', category, 'type', type,
        'last_event', last_event, 'source', source, 'bounce_type', bounce_type,
        'bounce_message', case when sent_at < now() - interval '90 days' then null else bounce_message end,
        'recipient_masked', case when recipient is null or sent_at < now() - interval '90 days' then null
            else left(recipient, 1) || '***@' || split_part(recipient, '@', 2) end,
        'subject', case when sent_at < now() - interval '90 days' then null else subject end)
        order by sent_at desc, email_id desc) from shown), '[]'::jsonb),
    case when (select count(*) from page) > v_limit
         then (select jsonb_build_object('sent_at', to_jsonb(sent_at), 'email_id', email_id)
                 from shown order by sent_at asc, email_id asc limit 1)
    end
  into v_items, v_next;

  if p_cursor_sent_at is null then
    select coalesce(jsonb_agg(jsonb_build_object('category', category, 'type', type)
                              order by category, type), '[]'::jsonb)
      into v_types
      from (select distinct category, type
              from email_sends
             where sent_at >= (p_start::timestamp at time zone 'America/Sao_Paulo')
               and sent_at < ((p_end + 1)::timestamp at time zone 'America/Sao_Paulo')
               and (coalesce(cardinality(p_categories), 0) = 0 or category = any (p_categories))) d;
  end if;

  return jsonb_build_object('items', v_items, 'next_cursor', v_next, 'types', v_types);
end $$;

revoke execute on function public.email_sends_list(date,date,text[],text[],text[],timestamptz,text,int)
  from public, anon, authenticated;
grant execute on function public.email_sends_list(date,date,text[],text[],text[],timestamptz,text,int)
  to service_role;
