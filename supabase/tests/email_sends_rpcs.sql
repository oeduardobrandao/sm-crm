\set ON_ERROR_STOP on
begin;

-- email_sends_apply_event: dedupe, upsert monotônico, PII só em estados acionáveis.
do $$
declare
  r boolean;
  e record;
  t1 timestamptz;
  msg text := repeat('x', 800);
begin
  -- sent: sem PII mesmo se o recipient vier
  r := email_sends_apply_event('sv-1', 'em-1', 'sent', now(), 'convites', 'convite', true,
                               null, null, null, 'a@b.com', 'Assunto');
  assert r, 'primeiro evento deve aplicar';
  select * into e from email_sends where email_id = 'em-1';
  assert e.last_event = 'sent' and e.source = 'webhook', 'sent/webhook';
  assert e.recipient is null and e.subject is null, 'sent nao guarda PII';

  perform email_sends_apply_event('sv-2', 'em-1', 'delivered', now(), 'x', 'y', true, null, null, null, 'a@b.com', 'A');
  assert (select last_event from email_sends where email_id = 'em-1') = 'delivered';
  assert (select recipient from email_sends where email_id = 'em-1') is null, 'delivered nao guarda PII';
  perform email_sends_apply_event('sv-2b', 'em-0', 'delivered', now(), 'x', 'y', true, 'Permanent', 'G', 'msg', 'p@q.com', 'S');
  assert (select bounce_type is null and bounce_subtype is null and bounce_message is null and recipient is null
            from email_sends where email_id = 'em-0'), 'delivered nao guarda bounce_*';
  perform email_sends_apply_event('sv-3', 'em-1', 'sent', now(), 'x', 'y', true, null, null, null, null, null);
  assert (select last_event from email_sends where email_id = 'em-1') = 'delivered', 'sent nao rebaixa';
  assert (select category from email_sends where email_id = 'em-1') = 'convites', 'categoria nao muda';
  assert (select type from email_sends where email_id = 'em-1') = 'convite', 'tipo nao muda';

  perform email_sends_apply_event('sv-4', 'em-1', 'bounced', now(), 'x', 'y', true,
                                  'Permanent', 'General', msg, 'joao@gmail.com', 'Oi');
  select * into e from email_sends where email_id = 'em-1';
  assert e.last_event = 'bounced' and e.bounce_type = 'Permanent' and e.bounce_subtype = 'General', 'bounced';
  assert e.recipient = 'joao@gmail.com' and e.subject = 'Oi', 'bounced guarda PII';
  assert length(e.bounce_message) = 500, 'bounce_message truncada em 500';
  perform email_sends_apply_event('sv-5', 'em-1', 'delivered', now(), 'x', 'y', true, null, null, null, null, null);
  assert (select last_event from email_sends where email_id = 'em-1') = 'bounced', 'delivered nao rebaixa bounced';

  perform email_sends_apply_event('sv-6', 'em-1', 'complained', now(), 'x', 'y', true, null, null, null, null, null);
  assert (select last_event from email_sends where email_id = 'em-1') = 'complained', 'complained vence';
  assert (select recipient from email_sends where email_id = 'em-1') = 'joao@gmail.com', 'PII preservada';

  -- delivery_delayed sobe para bounced
  perform email_sends_apply_event('sv-7', 'em-2', 'delivery_delayed', now(), 'cobranca', 'fatura', true, null, null, null, null, null);
  assert (select last_event from email_sends where email_id = 'em-2') = 'delivery_delayed';
  perform email_sends_apply_event('sv-8', 'em-2', 'bounced', now(), 'cobranca', 'fatura', true, 'Transient', null, 'm', 'z@y.com', 's');
  assert (select last_event from email_sends where email_id = 'em-2') = 'bounced';

  perform email_sends_apply_event('sv-f1', 'em-4', 'failed', now(), 'cobranca', 'fatura', true, null, null, 'smtp', 'fail@x.com', 'Fatura');
  assert (select recipient from email_sends where email_id = 'em-4') = 'fail@x.com', 'failed guarda recipient';
  assert (select bounce_message from email_sends where email_id = 'em-4') = 'smtp', 'failed guarda bounce_message';
  perform email_sends_apply_event('sv-f2', 'em-4', 'complained', now(), 'x', 'y', true, null, null, null, null, null);
  assert (select last_event from email_sends where email_id = 'em-4') = 'complained', 'complained vence failed';

  -- mesmo svix_id: false e linha inalterada
  update email_sends set updated_at = '2020-01-01 00:00:00+00' where email_id = 'em-2';
  t1 := '2020-01-01 00:00:00+00';
  r := email_sends_apply_event('sv-8', 'em-2', 'complained', now(), 'x', 'y', true, null, null, null, null, null);
  assert r = false, 'svix repetido retorna false';
  assert (select updated_at from email_sends where email_id = 'em-2') = t1, 'linha inalterada';
  assert (select last_event from email_sends where email_id = 'em-2') = 'bounced';

  -- backfill + evento com tag: webhook ganha classificação e source
  insert into email_sends (email_id, category, type, sent_at, last_event, source)
    values ('em-3', 'outros', 'desconhecido', now() - interval '1 day', 'delivered', 'backfill');
  perform email_sends_apply_event('sv-9', 'em-3', 'sent', now(), 'notificacoes', 'aviso', false, null, null, null, null, null);
  assert (select category from email_sends where email_id = 'em-3') = 'outros', 'sem tag nao reclassifica backfill';
  assert (select source from email_sends where email_id = 'em-3') = 'backfill';
  perform email_sends_apply_event('sv-10', 'em-3', 'sent', now(), 'notificacoes', 'aviso', true, null, null, null, null, null);
  select * into e from email_sends where email_id = 'em-3';
  assert e.category = 'notificacoes' and e.type = 'aviso' and e.source = 'webhook', 'webhook ganha do backfill';
  assert e.last_event = 'delivered', 'last_event nao rebaixa';

  -- grants
  assert not has_table_privilege('authenticated', 'public.email_sends', 'select'), 'authenticated sem select';
  assert not has_table_privilege('anon', 'public.email_sends', 'select'), 'anon sem select';
  assert not has_table_privilege('authenticated', 'public.email_webhook_events', 'select');
  assert has_table_privilege('service_role', 'public.email_sends', 'update');
  assert not has_function_privilege('authenticated',
    'public.email_sends_apply_event(text,text,text,timestamptz,text,text,boolean,text,text,text,text,text)', 'execute');
  assert has_function_privilege('service_role',
    'public.email_sends_apply_event(text,text,text,timestamptz,text,text,boolean,text,text,text,text,text)', 'execute');
  assert not has_function_privilege('authenticated', 'public.email_metrics(date,date)', 'execute');
  assert has_function_privilege('service_role', 'public.email_metrics(date,date)', 'execute');
end $$;

-- email_metrics
do $$
declare
  m jsonb;
  row_t jsonb;
  d jsonb;
  ok boolean := false;
begin
  delete from email_sends;

  insert into email_sends (email_id, category, type, sent_at, last_event, bounce_type, bounce_message, recipient, subject, source) values
    -- 23h50 em SP do dia 8
    ('m1', 'convites', 'convite', '2026-11-09 02:50:00+00', 'delivered', null, null, null, null, 'webhook'),
    ('m2', 'convites', 'convite', '2026-11-09 12:00:00+00', 'bounced', 'Permanent', 'caixa cheia', 'joao@gmail.com', 'Oi', 'webhook'),
    ('m3', 'convites', 'convite', '2026-11-09 13:00:00+00', 'failed', null, null, 'f@x.com', 'F', 'webhook'),
    ('m4', 'convites', 'convite', '2026-11-09 14:00:00+00', 'complained', null, null, 'c@x.com', 'C', 'webhook'),
    ('m5', 'convites', 'convite', '2026-11-09 15:00:00+00', 'sent', null, null, null, null, 'webhook'),
    ('m6', 'convites', 'convite', '2026-11-09 16:00:00+00', 'delivery_delayed', null, null, null, null, 'webhook'),
    ('m7', 'interno', 'alerta', '2026-11-09 17:00:00+00', 'bounced', 'Permanent', 'x', 'int@x.com', 'I', 'webhook'),
    -- fora do intervalo
    ('m8', 'convites', 'convite', '2026-11-20 12:00:00+00', 'delivered', null, null, null, null, 'webhook');

  m := email_metrics('2026-11-08', '2026-11-10');
  assert (m->>'coverage_start')::timestamptz = '2026-11-09 02:50:00+00', 'coverage_start';

  select x into row_t from jsonb_array_elements(m->'by_type') x where x->>'type' = 'convite';
  assert (row_t->>'sent')::int = 5, 'sent exclui failed: ' || row_t::text;
  assert (row_t->>'delivered')::int = 1;
  assert (row_t->>'bounced')::int = 1;
  assert (row_t->>'complained')::int = 1;
  assert (row_t->>'delayed')::int = 1;
  assert (row_t->>'pending')::int = 1;
  assert (row_t->>'not_sent')::int = 1;
  select x into row_t from jsonb_array_elements(m->'by_type') x where x->>'type' = 'alerta';
  assert row_t is not null and (row_t->>'bounced')::int = 1, 'interno aparece em by_type';

  assert jsonb_array_length(m->'daily') = 3, 'um item por dia';
  select x into d from jsonb_array_elements(m->'daily') x where x->>'day' = '2026-11-08';
  assert (d->>'delivered')::int = 1 and (d->>'sent')::int = 1, 'dia em Sao Paulo: ' || d::text;
  select x into d from jsonb_array_elements(m->'daily') x where x->>'day' = '2026-11-09';
  assert (d->>'sent')::int = 4 and (d->>'delivered')::int = 0 and (d->>'bounced')::int = 1
     and (d->>'other')::int = 3, 'dia 9 (interno fora): ' || d::text;
  select x into d from jsonb_array_elements(m->'daily') x where x->>'day' = '2026-11-10';
  assert (d->>'sent')::int = 0 and (d->>'other')::int = 0, 'dia vazio zerado';

  assert jsonb_array_length(m->'recent') = 3, 'recent: bounced, failed, complained (sem interno)';
  assert (m->'recent'->0->>'last_event') = 'complained', 'mais recente primeiro';
  select x into d from jsonb_array_elements(m->'recent') x where x->>'last_event' = 'bounced';
  assert d->>'recipient_masked' = 'j***@gmail.com', 'mascara';
  assert d->>'subject' = 'Oi' and d->>'bounce_type' = 'Permanent';
  assert not exists (select 1 from jsonb_array_elements(m->'recent') x where x->>'category' = 'interno');

  -- intervalo sem dados
  m := email_metrics('2027-01-01', '2027-01-03');
  assert jsonb_array_length(m->'daily') = 3 and jsonb_array_length(m->'by_type') = 0;

  m := email_metrics('2026-01-01', '2027-01-01');
  assert jsonb_array_length(m->'daily') = 366, '365 dias de diferenca ok';
  ok := false;
  begin
    perform email_metrics('2026-01-01', '2027-01-02');
  exception when others then ok := true; end;
  assert ok, '366 dias de diferenca levanta';
  ok := false;
  begin
    perform email_metrics('2026-11-10', '2026-11-08');
  exception when others then ok := true; end;
  assert ok, 'end < start levanta';
  ok := false;
  begin
    perform email_metrics('2025-01-01', '2026-11-08');
  exception when others then ok := true; end;
  assert ok, '> 365 dias de diferenca levanta';
end $$;

-- janela de 90 dias em recent e email_sends_cleanup
do $$
declare
  m jsonb;
begin
  delete from email_sends;
  insert into email_sends (email_id, category, type, sent_at, last_event, bounce_message, recipient, subject, source)
    values ('o1', 'convites', 'convite', now() - interval '91 days', 'bounced', 'old', 'old@x.com', 'Velho', 'webhook'),
           ('o2', 'convites', 'convite', now() - interval '1 day', 'bounced', 'new', 'new@x.com', 'Novo', 'webhook');
  m := email_metrics((current_date - 120), current_date + 1);
  assert (select x->'recipient_masked' from jsonb_array_elements(m->'recent') x where x->>'type' = 'convite'
            and x->>'bounce_message' is null limit 1) = 'null'::jsonb, 'velho sem mascara';
  assert (select count(*) from jsonb_array_elements(m->'recent') x
           where x->>'subject' is null and x->>'recipient_masked' is null and x->>'bounce_message' is null) = 1, 'so o velho zerado';

  insert into email_webhook_events (svix_id, received_at) values ('w10', now() - interval '10 days'), ('w8', now() - interval '8 days'), ('w1', now() - interval '1 day');
  perform email_sends_cleanup();
  assert (select recipient is null and subject is null and bounce_message is null from email_sends where email_id = 'o1'), 'o1 zerado';
  assert (select recipient is not null from email_sends where email_id = 'o2'), 'o2 mantido';
  assert not exists (select 1 from email_webhook_events where svix_id in ('w10','w8')), 'eventos antigos apagados';
  assert exists (select 1 from email_webhook_events where svix_id = 'w1'), 'evento recente fica';
  assert not has_function_privilege('authenticated', 'public.email_sends_cleanup()', 'execute');
  assert has_function_privilege('service_role', 'public.email_sends_cleanup()', 'execute');
end $$;

rollback;
