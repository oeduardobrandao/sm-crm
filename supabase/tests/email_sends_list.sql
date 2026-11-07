\set ON_ERROR_STOP on
begin;

-- email_sends_list: janela, filtros, cursor com empate, limite, PII de 90 dias, types, grants.
do $$
declare
  ok boolean;
  r jsonb;
  cur jsonb;
  seen text[] := '{}';
  pages int := 0;
  d1 date := '2026-11-01';
begin
  delete from email_sends;

  -- range_guard
  ok := false;
  begin perform email_sends_list(d1, d1 - 1, null, null, null, null, null, null);
  exception when others then ok := (sqlerrm = 'invalid_range'); end;
  assert ok, 'p_end < p_start levanta invalid_range';
  ok := false;
  begin perform email_sends_list(d1, d1 + 366, null, null, null, null, null, null);
  exception when others then ok := (sqlerrm = 'invalid_range'); end;
  assert ok, 'intervalo de 366 dias levanta';
  perform email_sends_list(d1, d1 + 365, null, null, null, null, null, null);

  -- filters
  insert into email_sends (email_id, category, type, sent_at, last_event, source) values
    ('f1', 'convites', 'convite', '2026-11-02 12:00+00', 'delivered', 'webhook'),
    ('f2', 'convites', 'lembrete', '2026-11-02 13:00+00', 'bounced', 'webhook'),
    ('f3', 'cobranca', 'fatura', '2026-11-02 14:00+00', 'delivered', 'backfill'),
    ('f4', 'cobranca', 'fatura', '2026-10-31 14:00+00', 'delivered', 'webhook'),  -- fora da janela
    ('f5', 'cobranca', 'fatura', '2026-11-03 02:59:59+00', 'delivered', 'webhook'),  -- 23:59:59 SP de 11-02
    ('f6', 'cobranca', 'fatura', '2026-11-03 03:00:00+00', 'delivered', 'webhook');  -- 00:00 SP de 11-03
  r := email_sends_list('2026-11-01', '2026-11-02', null, null, null, null, null, null);
  assert jsonb_array_length(r->'items') = 4, 'janela em SP: f1,f2,f3,f5 (' || jsonb_array_length(r->'items') || ')';
  r := email_sends_list('2026-11-01', '2026-11-02', '{}', '{}', '{}', null, null, null);
  assert jsonb_array_length(r->'items') = 4, 'arrays vazios nao filtram';
  r := email_sends_list('2026-11-01', '2026-11-02', array['convites'], null, null, null, null, null);
  assert jsonb_array_length(r->'items') = 2, 'categoria';
  r := email_sends_list('2026-11-01', '2026-11-02', null, array['fatura'], null, null, null, null);
  assert jsonb_array_length(r->'items') = 2, 'tipo';
  r := email_sends_list('2026-11-01', '2026-11-02', null, null, array['bounced'], null, null, null);
  assert jsonb_array_length(r->'items') = 1 and r->'items'->0->>'email_id' = 'f2', 'evento';
  assert r->'items'->0->>'source' = 'webhook', 'source no item';
  r := email_sends_list('2026-11-01', '2026-11-02', array['convites'], null, array['delivered'], null, null, null);
  assert jsonb_array_length(r->'items') = 1 and r->'items'->0->>'email_id' = 'f1', 'filtros combinados';

  -- tie_paging
  delete from email_sends;
  insert into email_sends (email_id, category, type, sent_at, last_event, source)
    select 't' || i, 'convites', 'convite', '2026-11-01 12:00:00.123456+00', 'delivered', 'webhook'
      from generate_series(1, 5) i;
  cur := null;
  loop
    r := email_sends_list('2026-11-01', '2026-11-02', null, null, null,
                          (cur->>'sent_at')::timestamptz, cur->>'email_id', 2);
    pages := pages + 1;
    seen := seen || (select array_agg(x->>'email_id') from jsonb_array_elements(r->'items') x);
    cur := r->'next_cursor';
    exit when cur is null or jsonb_typeof(cur) = 'null';
    assert pages < 10, 'loop de paginacao';
  end loop;
  assert seen = array['t5','t4','t3','t2','t1'], 'todas uma vez, email_id desc: ' || seen::text;
  assert pages = 3, 'tres paginas';
  assert (r->'next_cursor') is null or jsonb_typeof(r->'next_cursor') = 'null', 'ultima pagina sem cursor';
  r := email_sends_list('2026-11-01', '2026-11-02', null, null, null, null, null, 2);
  assert r->'next_cursor'->>'sent_at' = (to_jsonb('2026-11-01 12:00:00.123456+00'::timestamptz))#>>'{}',
    'cursor preserva microssegundos: ' || (r->'next_cursor')::text;
  r := email_sends_list('2026-11-01', '2026-11-02', null, null, null, null, null, 5);
  assert (r->'next_cursor') is null or jsonb_typeof(r->'next_cursor') = 'null', 'exatamente limit linhas: sem cursor';

  -- limit_clamp
  delete from email_sends;
  insert into email_sends (email_id, category, type, sent_at, last_event, source)
    select 'l' || lpad(i::text, 3, '0'), 'convites', 'convite', '2026-11-01 12:00+00'::timestamptz + i * interval '1 second', 'delivered', 'webhook'
      from generate_series(1, 120) i;
  assert jsonb_array_length(email_sends_list('2026-11-01', '2026-11-02', null, null, null, null, null, 0)->'items') = 1, 'limit 0 -> 1';
  assert jsonb_array_length(email_sends_list('2026-11-01', '2026-11-02', null, null, null, null, null, 500)->'items') = 100, 'limit 500 -> 100';
  assert jsonb_array_length(email_sends_list('2026-11-01', '2026-11-02', null, null, null, null, null, null)->'items') = 50, 'limit null -> 50';

  -- pii_90d
  delete from email_sends;
  insert into email_sends (email_id, category, type, sent_at, last_event, bounce_type, bounce_message, recipient, subject, source) values
    ('p-old', 'convites', 'convite', now() - interval '100 days', 'bounced', 'Permanent', 'msg', 'ana@b.com', 'Oi', 'webhook'),
    ('p-new', 'convites', 'convite', now() - interval '10 days', 'bounced', 'Permanent', 'msg', 'ana@b.com', 'Oi', 'webhook');
  r := email_sends_list(current_date - 120, current_date + 1, null, null, null, null, null, null);
  assert (select x->>'bounce_type' = 'Permanent' and x->'bounce_message' = 'null'::jsonb
            and x->'recipient_masked' = 'null'::jsonb and x->'subject' = 'null'::jsonb
            from jsonb_array_elements(r->'items') x where x->>'email_id' = 'p-old'), 'velho: PII nula, bounce_type fica';
  assert (select x->>'recipient_masked' = 'a***@b.com' and x->>'subject' = 'Oi' and x->>'bounce_message' = 'msg'
            from jsonb_array_elements(r->'items') x where x->>'email_id' = 'p-new'), 'recente: mascarado';

  -- types_first_page
  delete from email_sends;
  insert into email_sends (email_id, category, type, sent_at, last_event, source) values
    ('y1', 'convites', 'convite', '2026-11-02 12:00+00', 'delivered', 'webhook'),
    ('y2', 'cobranca', 'fatura', '2026-11-02 12:01+00', 'bounced', 'webhook'),
    ('y3', 'cobranca', 'fatura', '2026-11-02 12:02+00', 'delivered', 'webhook'),
    ('y4', 'cobranca', 'outro', '2026-10-01 12:00+00', 'delivered', 'webhook');
  r := email_sends_list('2026-11-01', '2026-11-02', null, array['convite'], array['bounced'], null, null, null);
  assert jsonb_array_length(r->'types') = 2, 'types ignora p_types e p_events, so janela: ' || (r->'types')::text;
  assert r->'types'->0 = '{"category":"cobranca","type":"fatura"}'::jsonb, 'forma de types';
  r := email_sends_list('2026-11-01', '2026-11-02', null, null, null, '2026-11-02 12:02+00', 'y3', null);
  assert r->'types' is null or jsonb_typeof(r->'types') = 'null', 'types nulo com cursor';

  -- grants
  assert not has_function_privilege('authenticated',
    'public.email_sends_list(date,date,text[],text[],text[],timestamptz,text,int)', 'execute'), 'authenticated sem execute';
  assert not has_function_privilege('anon',
    'public.email_sends_list(date,date,text[],text[],text[],timestamptz,text,int)', 'execute'), 'anon sem execute';
  assert has_function_privilege('service_role',
    'public.email_sends_list(date,date,text[],text[],text[],timestamptz,text,int)', 'execute'), 'service_role executa';
end $$;

rollback;
