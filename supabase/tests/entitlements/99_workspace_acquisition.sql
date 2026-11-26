\set ON_ERROR_STOP on
\i supabase/tests/entitlements/_helpers.sql

-- Origem de aquisição do workspace (migration 20261209000001).
--
-- Prova:
--   1. acquisition_channel: a tabela de regras da spec (§3), primeira regra
--      que casa vence; touch nulo ou só com utm_campaign = direct.
--   2. cadastro de dono com acq: uma linha em workspace_acquisition com o canal
--      do last (ou do first quando last é null ou ausente), campanha do mesmo
--      touch, captured = true; acq some de raw_user_meta_data; nenhuma linha
--      sobra em acquisition_pending.
--   3. sem acq, acq string ou acq sem first objeto: captured = false,
--      channel = 'unknown', touches nulos.
--   4. falha forçada (tabela renomeada): o cadastro segue, usuário, profile e
--      workspace existem e acq continua removido.
--   5. convite: nenhuma linha, nenhum pending.
--   6. metadata hostil é saneada (200 caracteres, click fora da lista, host
--      inválido, objeto onde vai texto).
--   7. UPDATE de raw_user_meta_data (recadastro não confirmado) remove acq sem
--      criar pending.
--   8. afiliado: canal 'affiliate' com linha em affiliate_referrals e ref no
--      last; sem a linha, workspace_acquisition_reclassify devolve other_sites.
--   9. anon e authenticated não leem as tabelas nem executam as RPCs.
--  10. ever_paid_workspace_ids: snapshot pagante, ever_subscribed_at ou
--      reverse_trial_first_paid_at; trial da Stripe sozinho não conta.
--  11. landing_path de rota com token (painel de afiliado, convite,
--      descadastro, cancelar avisos) fica só com o prefixo, no saneador e num
--      cadastro de ponta a ponta.
--  12. falha na limpeza dos pendings órfãos não desfaz a linha do workspace.
--
-- Os inserts em auth.users rodam como postgres: localmente o postgres não pode
-- SET ROLE supabase_auth_admin ("permission denied to set role"). O caminho
-- real do GoTrue (supabase_auth_admin) é provado no passo 6 do plano, com um
-- POST /auth/v1/signup no stack local.

begin;
-- As duas tabelas ficam fora: o REVOKE delas é o que se testa.
select et_grant_hosted_parity(array['workspace_acquisition', 'acquisition_pending']);

-- Passo 12: trava a limpeza dos órfãos (só o DELETE de linhas com mais de um
-- dia levanta erro; o DELETE do pending do próprio usuário passa).
create function public.acq_test_fail_orphan_cleanup() returns trigger
language plpgsql as $f$
begin
  if old.created_at < now() - interval '1 day' then
    raise exception 'forced orphan cleanup failure';
  end if;
  return old;
end;
$f$;
do $$
declare
  r          record;
  v_got      text;
  v_user     uuid;
  v_ws       uuid;
  v_row      record;
  v_n        bigint;
  v_state    text;
  v_aff      uuid;
  v_host     uuid := gen_random_uuid();
  v_host_ws  uuid;
  v_ws_a     uuid;
  v_ws_b     uuid;
  v_ws_c     uuid;
  v_ws_d     uuid;
  v_ws_e     uuid;
  v_ids      uuid[];
  v_tbl      text;
  v_role     text;
  v_fn       text;
begin
  -- 1. classificador.
  for r in
    select * from (values
      ('{"click":"oppref"}'::jsonb, false, 'chatgpt_ads'),
      ('{"click":"gclid"}', false, 'google_ads'),
      ('{"utm_source":"meta","utm_medium":"paid"}', false, 'meta_ads'),
      ('{"utm_source":"ig","utm_medium":"social"}', false, 'instagram'),
      ('{"click":"fbclid"}', false, 'other_social'),
      ('{"click":"fbclid","referrer_host":"l.instagram.com"}', false, 'instagram'),
      ('{"utm_source":"chatgpt.com"}', false, 'ai'),
      ('{"referrer_host":"www.google.com"}', false, 'search'),
      ('{"referrer_host":"www.google.com.br"}', false, 'search'),
      ('{"utm_medium":"email"}', false, 'email'),
      ('{"ref":true}', false, 'other_sites'),
      ('{"ref":true}', true, 'affiliate'),
      ('{"referrer_host":"blog.example.com"}', false, 'other_sites'),
      -- regra 5: msclkid, ou cpc com fonte que não é Google nem Meta.
      ('{"click":"msclkid"}', false, 'other_ads'),
      ('{"utm_source":"bing","utm_medium":"cpc"}', false, 'other_ads'),
      -- regras 6, 8 e 9 pelo host do referrer.
      ('{"referrer_host":"mail.google.com"}', false, 'email'),
      ('{"referrer_host":"l.facebook.com"}', false, 'other_social'),
      ('{"referrer_host":"l.wl.co"}', false, 'other_social'),
      ('{"referrer_host":"chatgpt.com"}', false, 'ai'),
      ('{"referrer_host":"gemini.google.com"}', false, 'ai'),
      -- buscador que não é o Google, e outro *.google.com que não é busca.
      ('{"referrer_host":"www.bing.com"}', false, 'search'),
      ('{"referrer_host":"news.google.com"}', false, 'other_sites'),
      ('{}', false, 'direct'),
      (null, false, 'direct'),
      ('{"utm_campaign":"x"}', false, 'direct')
    ) as t(touch, has_aff, expected)
  loop
    v_got := public.acquisition_channel(r.touch, r.has_aff);
    if v_got is distinct from r.expected then
      raise exception 'acquisition_channel(%, %) = %, expected %', r.touch, r.has_aff, v_got, r.expected;
    end if;
  end loop;

  -- 2. cadastro de dono com acq (first instagram, last meta pago).
  v_user := gen_random_uuid();
  insert into auth.users (id, email, raw_user_meta_data)
    values (v_user, 'acq-owner@example.com', jsonb_build_object(
      'empresa', 'Acq Co',
      'acq', jsonb_build_object(
        'first', jsonb_build_object('utm_source', 'ig', 'utm_medium', 'social',
                                    'landing_path', '/', 'at', '2026-11-20T10:00:00Z'),
        'last', jsonb_build_object('utm_source', 'meta', 'utm_medium', 'paid',
                                   'utm_campaign', 'lp-nov', 'landing_path', '/precos',
                                   'at', '2026-11-25T10:00:00Z'),
        'v', 1)));
  select conta_id into v_ws from profiles where id = v_user and role = 'owner';
  if v_ws is null then
    raise exception 'owner signup must create an owner profile with a workspace';
  end if;
  select * into v_row from workspace_acquisition where workspace_id = v_ws;
  if not found then
    raise exception 'owner signup must write a workspace_acquisition row';
  end if;
  if v_row.channel is distinct from 'meta_ads' or v_row.campaign is distinct from 'lp-nov'
     or v_row.captured is distinct from true then
    raise exception 'owner row must be meta_ads / lp-nov / captured, got % / % / %',
      v_row.channel, v_row.campaign, v_row.captured;
  end if;
  if v_row.first_touch ->> 'utm_source' is distinct from 'ig'
     or v_row.last_touch ->> 'utm_campaign' is distinct from 'lp-nov' then
    raise exception 'touches must be stored: first % last %', v_row.first_touch, v_row.last_touch;
  end if;
  if (select raw_user_meta_data ? 'acq' from auth.users where id = v_user) then
    raise exception 'acq must be stripped from raw_user_meta_data';
  end if;
  if (select raw_user_meta_data ->> 'empresa' from auth.users where id = v_user) is distinct from 'Acq Co' then
    raise exception 'stripping acq must keep the other metadata keys';
  end if;
  if exists (select 1 from acquisition_pending where user_id = v_user) then
    raise exception 'owner signup must not leave an acquisition_pending row';
  end if;

  -- last null (JSON) e last ausente: o canal vem do first.
  for r in
    select * from (values
      ('acq-last-null@example.com', '{"first":{"utm_source":"meta","utm_medium":"paid","utm_campaign":"c1"},"last":null}'::jsonb),
      ('acq-last-absent@example.com', '{"first":{"utm_source":"meta","utm_medium":"paid","utm_campaign":"c1"}}')
    ) as t(email, acq)
  loop
    v_user := gen_random_uuid();
    insert into auth.users (id, email, raw_user_meta_data)
      values (v_user, r.email, jsonb_build_object('empresa', '', 'acq', r.acq));
    select a.* into v_row from workspace_acquisition a
      join profiles p on p.conta_id = a.workspace_id where p.id = v_user;
    if v_row.channel is distinct from 'meta_ads' or v_row.campaign is distinct from 'c1'
       or v_row.captured is distinct from true or v_row.last_touch is not null then
      raise exception '% must classify from first (meta_ads / c1 / captured, last NULL), got % / % / % / %',
        r.email, v_row.channel, v_row.campaign, v_row.captured, v_row.last_touch;
    end if;
  end loop;

  -- 3. sem acq, acq string, acq sem first objeto.
  for r in
    select * from (values
      ('acq-none@example.com', jsonb_build_object('empresa', 'No Acq')),
      ('acq-oops@example.com', jsonb_build_object('empresa', '', 'acq', '"oops"'::jsonb)),
      ('acq-empty@example.com', jsonb_build_object('empresa', '', 'acq', '{}'::jsonb))
    ) as t(email, meta)
  loop
    v_user := gen_random_uuid();
    insert into auth.users (id, email, raw_user_meta_data) values (v_user, r.email, r.meta);
    select a.* into v_row from workspace_acquisition a
      join profiles p on p.conta_id = a.workspace_id where p.id = v_user;
    if not found then
      raise exception '% must still write a row', r.email;
    end if;
    if v_row.captured is distinct from false or v_row.channel is distinct from 'unknown'
       or v_row.first_touch is not null or v_row.last_touch is not null or v_row.campaign is not null then
      raise exception '% must be captured=false / unknown / null touches, got % / % / % / %',
        r.email, v_row.captured, v_row.channel, v_row.first_touch, v_row.last_touch;
    end if;
    if (select raw_user_meta_data ? 'acq' from auth.users where id = v_user) then
      raise exception '% must have acq stripped', r.email;
    end if;
    if exists (select 1 from acquisition_pending where user_id = v_user) then
      raise exception '% must not leave a pending row', r.email;
    end if;
  end loop;

  -- 4a. falha forçada: acquisition_pending renomeada.
  alter table public.acquisition_pending rename to acquisition_pending_x;
  v_user := gen_random_uuid();
  insert into auth.users (id, email, raw_user_meta_data)
    values (v_user, 'acq-fail-pending@example.com',
            jsonb_build_object('empresa', 'Fail P', 'acq', '{"first":{"utm_source":"meta"}}'::jsonb));
  if not exists (select 1 from auth.users where id = v_user) then
    raise exception 'pending failure must not drop the user';
  end if;
  select conta_id into v_ws from profiles where id = v_user and role = 'owner';
  if v_ws is null or not exists (select 1 from workspaces where id = v_ws) then
    raise exception 'pending failure must keep the profile and the workspace';
  end if;
  if (select raw_user_meta_data ? 'acq' from auth.users where id = v_user) then
    raise exception 'pending failure must still strip acq';
  end if;
  if exists (select 1 from public.acquisition_pending_x where user_id = v_user) then
    raise exception 'the forced pending failure did not happen (row reached the renamed table)';
  end if;
  alter table public.acquisition_pending_x rename to acquisition_pending;

  -- 4b. falha forçada: workspace_acquisition renomeada.
  alter table public.workspace_acquisition rename to workspace_acquisition_x;
  v_user := gen_random_uuid();
  insert into auth.users (id, email, raw_user_meta_data)
    values (v_user, 'acq-fail-row@example.com',
            jsonb_build_object('empresa', 'Fail R', 'acq', '{"first":{"utm_source":"meta"}}'::jsonb));
  select conta_id into v_ws from profiles where id = v_user and role = 'owner';
  if v_ws is null or not exists (select 1 from workspaces where id = v_ws) then
    raise exception 'row failure must keep the user, the profile and the workspace';
  end if;
  if (select raw_user_meta_data ? 'acq' from auth.users where id = v_user) then
    raise exception 'row failure must still strip acq';
  end if;
  if exists (select 1 from public.workspace_acquisition_x where workspace_id = v_ws) then
    raise exception 'the forced row failure did not happen (row reached the renamed table)';
  end if;
  if exists (select 1 from acquisition_pending where user_id = v_user) then
    raise exception 'row failure must not leave a pending row';
  end if;
  alter table public.workspace_acquisition_x rename to workspace_acquisition;

  -- 12. falha na limpeza dos órfãos: a linha do workspace fica.
  insert into acquisition_pending (user_id, acq, captured, created_at)
    values (gen_random_uuid(), null, false, now() - interval '2 days');
  create trigger acq_fail_orphan_cleanup before delete on public.acquisition_pending
    for each row execute function public.acq_test_fail_orphan_cleanup();
  v_user := gen_random_uuid();
  insert into auth.users (id, email, raw_user_meta_data)
    values (v_user, 'acq-cleanup-fail@example.com', jsonb_build_object(
      'empresa', '', 'acq', '{"first":{"utm_source":"meta","utm_medium":"paid"}}'::jsonb));
  select a.* into v_row from workspace_acquisition a
    join profiles p on p.conta_id = a.workspace_id where p.id = v_user;
  if not found or v_row.channel is distinct from 'meta_ads' then
    raise exception 'a failing orphan cleanup must keep the workspace row, got %', v_row.channel;
  end if;
  if exists (select 1 from acquisition_pending where user_id = v_user) then
    raise exception 'a failing orphan cleanup must still consume the user pending row';
  end if;
  if not exists (select 1 from acquisition_pending where created_at < now() - interval '1 day') then
    raise exception 'the forced cleanup failure did not happen (orphan was deleted)';
  end if;
  drop trigger acq_fail_orphan_cleanup on public.acquisition_pending;
  delete from acquisition_pending where created_at < now() - interval '1 day';

  -- 5. convite.
  v_host_ws := et_make_workspace('free');
  insert into auth.users (id) values (v_host);
  insert into invites (conta_id, email, role, invited_by, status, expires_at)
    values (v_host_ws, 'acq-invitee@example.com', 'agent', v_host, 'pending', now() + interval '7 days');
  v_user := gen_random_uuid();
  insert into auth.users (id, email, raw_user_meta_data)
    values (v_user, 'acq-invitee@example.com',
            jsonb_build_object('conta_id', v_host_ws::text,
                               'acq', '{"first":{"utm_source":"meta","utm_medium":"paid"}}'::jsonb));
  if not exists (select 1 from profiles where id = v_user and conta_id = v_host_ws) then
    raise exception 'invitee should have joined workspace %', v_host_ws;
  end if;
  if exists (select 1 from workspace_acquisition where workspace_id = v_host_ws) then
    raise exception 'invite must not write a workspace_acquisition row';
  end if;
  if exists (select 1 from acquisition_pending where user_id = v_user) then
    raise exception 'invite must not leave a pending row';
  end if;

  -- 6. metadata hostil.
  v_user := gen_random_uuid();
  insert into auth.users (id, email, raw_user_meta_data)
    values (v_user, 'acq-hostile@example.com', jsonb_build_object(
      'empresa', '',
      'acq', jsonb_build_object(
        'first', jsonb_build_object(
          'utm_source', repeat('x', 10000),
          'utm_medium', jsonb_build_object('nested', 1),
          'utm_campaign', 42,
          'click', 'evil',
          'referrer_host', 'a b',
          'ref', 'yes',
          'extra', 'dropped'),
        'last', 'junk')));
  select a.* into v_row from workspace_acquisition a
    join profiles p on p.conta_id = a.workspace_id where p.id = v_user;
  if not found then
    raise exception 'hostile metadata must still write a row';
  end if;
  if length(v_row.first_touch ->> 'utm_source') is distinct from 200 then
    raise exception 'utm_source must be cut to 200, got %', length(v_row.first_touch ->> 'utm_source');
  end if;
  if v_row.first_touch ->> 'click' is not null
     or v_row.first_touch ->> 'referrer_host' is not null
     or v_row.first_touch ->> 'utm_medium' is not null
     or v_row.first_touch ->> 'utm_campaign' is not null
     or v_row.first_touch ? 'extra'
     or v_row.first_touch -> 'ref' is distinct from 'false'::jsonb then
    raise exception 'hostile fields must be nulled, got %', v_row.first_touch;
  end if;
  if v_row.last_touch is not null or v_row.captured is distinct from true then
    raise exception 'a non-object last must be NULL and the row captured, got % / %',
      v_row.last_touch, v_row.captured;
  end if;
  -- host com formato válido mas acima de 200 caracteres vira null (nunca cortado).
  if public.acquisition_sanitize_touch(jsonb_build_object('referrer_host', repeat('a', 250)))
       ->> 'referrer_host' is not null then
    raise exception 'a referrer_host over 200 characters must be nulled';
  end if;
  if public.acquisition_sanitize_touch(jsonb_build_object('referrer_host', repeat('a', 200)))
       ->> 'referrer_host' is distinct from repeat('a', 200) then
    raise exception 'a valid 200-character referrer_host must be kept';
  end if;

  -- 6b. landing_path só o caminho (corta em ? ou #, exige / inicial) e at só
  -- timestamp ISO válido.
  for r in
    select * from (values
      ('/precos?gclid=abc', '/precos'),
      ('/blog/post#secao', '/blog/post'),
      ('/?gclid=abc&utm_source=x', '/'),
      ('  /trim  ', '/trim'),
      ('precos', null),
      ('https://evil.example.com/x', null),
      ('?gclid=abc', null),
      ('#x', null),
      -- 11. rotas com token: só o prefixo.
      ('/afiliados/painel/TOKEN123', '/afiliados/painel'),
      ('/conectar/TOKEN123?utm_source=x', '/conectar'),
      ('/descadastrar/TOKEN123', '/descadastrar'),
      ('/cancelar-avisos/TOKEN123', '/cancelar-avisos'),
      ('/Conectar/TOKEN123', '/conectar'),
      ('//afiliados//painel/TOKEN123', '/afiliados/painel'),
      ('/conectar/TOKEN123/x', '/conectar'),
      ('/conectar-x/abc', '/conectar-x/abc'),
      ('/afiliados/painel', '/afiliados/painel'),
      ('/blog/conectar/abc', '/blog/conectar/abc')
    ) as t(input, expected)
  loop
    v_got := public.acquisition_sanitize_touch(jsonb_build_object('landing_path', r.input)) ->> 'landing_path';
    if v_got is distinct from r.expected then
      raise exception 'landing_path % must sanitize to %, got %', r.input, r.expected, v_got;
    end if;
  end loop;
  if length(public.acquisition_sanitize_touch(
       jsonb_build_object('landing_path', '/' || repeat('p', 300) || '?q=1')) ->> 'landing_path') <> 200 then
    raise exception 'a long landing_path must be cut to 200 after the query is dropped';
  end if;
  for r in
    select * from (values
      ('2026-11-26T12:00:00.123Z', '2026-11-26T12:00:00.123Z'),
      ('2026-11-26T12:00:00Z', '2026-11-26T12:00:00Z'),
      ('2026-11-26T09:00:00-03:00', '2026-11-26T09:00:00-03:00'),
      ('gclid=abc', null),
      ('2026-13-45T00:00:00Z', null),
      ('now', null),
      ('infinity', null),
      ('2026-11-26T12:00:00Z?gclid=abc', null)
    ) as t(input, expected)
  loop
    v_got := public.acquisition_sanitize_touch(jsonb_build_object('at', r.input)) ->> 'at';
    if v_got is distinct from r.expected then
      raise exception 'at % must sanitize to %, got %', r.input, r.expected, v_got;
    end if;
  end loop;

  -- 11. cadastro com first em rota com token: o token não chega à linha.
  v_user := gen_random_uuid();
  insert into auth.users (id, email, raw_user_meta_data)
    values (v_user, 'acq-token-path@example.com', jsonb_build_object(
      'empresa', '',
      'acq', jsonb_build_object(
        'first', jsonb_build_object('landing_path', '/afiliados/painel/SECRET-TOKEN-1',
                                    'referrer_host', 'mail.google.com',
                                    'at', '2026-11-20T10:00:00Z'),
        'last', jsonb_build_object('landing_path', '/descadastrar/SECRET-TOKEN-2',
                                   'utm_source', 'ig', 'at', '2026-11-21T10:00:00Z'))));
  select a.* into v_row from workspace_acquisition a
    join profiles p on p.conta_id = a.workspace_id where p.id = v_user;
  if v_row.first_touch ->> 'landing_path' is distinct from '/afiliados/painel'
     or v_row.last_touch ->> 'landing_path' is distinct from '/descadastrar'
     or (v_row.first_touch::text || v_row.last_touch::text) like '%SECRET-TOKEN%' then
    raise exception 'token route paths must be collapsed, got % / %', v_row.first_touch, v_row.last_touch;
  end if;

  -- 6c. auth.identities: o GoTrue copia o metadata do cadastro em identity_data
  -- (INSERT e depois UPDATEs); o trigger tira acq e mantém o resto.
  select id into v_user from auth.users where email = 'acq-owner@example.com';
  insert into auth.identities (user_id, provider_id, provider, identity_data)
    values (v_user, v_user::text, 'email', jsonb_build_object(
      'sub', v_user::text, 'email', 'acq-owner@example.com', 'empresa', 'Acq Co',
      'acq', '{"first":{"utm_source":"meta","landing_path":"/?gclid=raw"}}'::jsonb));
  if (select identity_data ? 'acq' from auth.identities where provider_id = v_user::text) then
    raise exception 'identity insert must strip acq';
  end if;
  if (select identity_data ->> 'empresa' from auth.identities where provider_id = v_user::text)
       is distinct from 'Acq Co'
     or (select email from auth.identities where provider_id = v_user::text)
       is distinct from 'acq-owner@example.com' then
    raise exception 'identity strip must keep the other keys';
  end if;
  update auth.identities
     set identity_data = identity_data || '{"email_verified":true,"acq":{"first":{"utm_source":"ig"}}}'
   where provider_id = v_user::text;
  if (select identity_data ? 'acq' from auth.identities where provider_id = v_user::text) then
    raise exception 'identity update must strip acq';
  end if;
  if (select identity_data -> 'email_verified' from auth.identities where provider_id = v_user::text)
       is distinct from 'true'::jsonb then
    raise exception 'identity update must keep the updated keys';
  end if;
  -- falha forçada: identity_data escalar "acq" faz o "-" levantar erro
  -- (cannot delete from scalar); o trigger engole e devolve a linha.
  insert into auth.identities (user_id, provider_id, provider, identity_data)
    values (v_user, 'acq-scalar-' || v_user::text, 'acq_test', '"acq"'::jsonb);
  if (select identity_data from auth.identities where provider_id = 'acq-scalar-' || v_user::text)
       is distinct from '"acq"'::jsonb then
    raise exception 'a failing identity strip must still insert the row unchanged';
  end if;

  -- 7. recadastro (UPDATE de raw_user_meta_data) remove acq sem pending.
  select id into v_user from auth.users where email = 'acq-owner@example.com';
  update auth.users set raw_user_meta_data = raw_user_meta_data || '{"acq":{"first":{}}}'
    where id = v_user;
  if (select raw_user_meta_data ? 'acq' from auth.users where id = v_user) then
    raise exception 'update must strip acq';
  end if;
  if exists (select 1 from acquisition_pending where user_id = v_user) then
    raise exception 'update must not write a pending row';
  end if;

  -- 8. afiliado.
  insert into affiliates (code, nome, email, terms_accepted_at)
    values ('acqaff01', 'Afiliado Acq', 'acq-affiliate@example.com', now())
    returning id into v_aff;
  v_user := gen_random_uuid();
  insert into auth.users (id, email, raw_user_meta_data)
    values (v_user, 'acq-referred@example.com', jsonb_build_object(
      'empresa', '', 'ref_code', 'acqaff01',
      'acq', '{"first":{"utm_source":"google","utm_medium":"cpc"},"last":{"ref":true}}'::jsonb));
  select conta_id into v_ws from profiles where id = v_user and role = 'owner';
  if not exists (select 1 from affiliate_referrals where workspace_id = v_ws) then
    raise exception 'setup: the affiliate trigger should have written a referral';
  end if;
  select channel into v_got from workspace_acquisition where workspace_id = v_ws;
  if v_got is distinct from 'affiliate' then
    raise exception 'affiliate signup must be affiliate, got %', v_got;
  end if;
  delete from affiliate_referrals where workspace_id = v_ws;
  set local role service_role;
  select workspace_acquisition_reclassify(v_ws) into v_got;
  reset role;
  if v_got is distinct from 'other_sites' then
    raise exception 'reclassify without the referral must return other_sites, got %', v_got;
  end if;
  select channel into v_got from workspace_acquisition where workspace_id = v_ws;
  if v_got is distinct from 'other_sites' then
    raise exception 'reclassify must store other_sites, got %', v_got;
  end if;

  -- reclassify não mexe em captured = false e devolve null sem linha.
  select a.workspace_id into v_ws from workspace_acquisition a
    join profiles p on p.conta_id = a.workspace_id
    join auth.users u on u.id = p.id where u.email = 'acq-none@example.com';
  set local role service_role;
  select workspace_acquisition_reclassify(v_ws) into v_got;
  reset role;
  if v_got is distinct from 'unknown' then
    raise exception 'reclassify must leave captured=false rows as unknown, got %', v_got;
  end if;
  set local role service_role;
  select workspace_acquisition_reclassify(gen_random_uuid()) into v_got;
  reset role;
  if v_got is not null then
    raise exception 'reclassify of a workspace without a row must return null, got %', v_got;
  end if;

  -- 9. privilégios.
  foreach v_role in array array['authenticated', 'anon'] loop
    foreach v_tbl in array array['workspace_acquisition', 'acquisition_pending'] loop
      v_state := null;
      perform set_config('request.jwt.claims',
        json_build_object('sub', v_host, 'role', v_role)::text, true);
      execute format('set local role %I', v_role);
      begin
        execute format('select count(*) from public.%I', v_tbl) into v_n;
      exception when others then
        get stacked diagnostics v_state = returned_sqlstate;
      end;
      reset role;
      if v_state is distinct from '42501' then
        raise exception '% select on % must raise 42501, got %', v_role, v_tbl, v_state;
      end if;
    end loop;
    foreach v_fn in array array['public.workspace_acquisition_reclassify(uuid)',
                                'public.ever_paid_workspace_ids(uuid[])'] loop
      if has_function_privilege(v_role, v_fn, 'EXECUTE') then
        raise exception '% must not execute %', v_role, v_fn;
      end if;
    end loop;
  end loop;
  foreach v_fn in array array['public.workspace_acquisition_reclassify(uuid)',
                              'public.ever_paid_workspace_ids(uuid[])'] loop
    if not has_function_privilege('service_role', v_fn, 'EXECUTE') then
      raise exception 'service_role must execute %', v_fn;
    end if;
  end loop;

  -- 10. ever_paid_workspace_ids.
  v_ws_a := et_make_workspace('free');  -- snapshot ativo pagante
  v_ws_b := et_make_workspace('free');  -- só ever_subscribed_at
  v_ws_c := et_make_workspace('free');  -- só reverse_trial_first_paid_at
  v_ws_d := et_make_workspace('free');  -- só trial da Stripe
  v_ws_e := et_make_workspace('free');  -- troca para o Pagar.me em trial, pagante
  insert into workspace_subscription_snapshots
    (workspace_id, snapshot_date, provider, status, monthly_cents, amount_source, provider_switch, source)
  values
    (v_ws_a, current_date - 10, 'stripe', 'active', 9900, 'stripe', false, 'cron'),
    (v_ws_d, current_date - 10, 'stripe', 'trialing', 9900, 'stripe', false, 'cron'),
    (v_ws_e, current_date - 10, 'pagarme', 'trialing', 9900, 'pagarme', true, 'cron');
  insert into workspace_subscriptions (workspace_id, provider, status, ever_subscribed_at)
  values
    (v_ws_b, 'stripe', 'canceled', now() - interval '30 days'),
    (v_ws_d, 'stripe', 'trialing', null);
  update workspaces set reverse_trial_first_paid_at = now() where id = v_ws_c;

  set local role service_role;
  select array_agg(workspace_id) into v_ids
    from ever_paid_workspace_ids(array[v_ws_a, v_ws_b, v_ws_c, v_ws_d, v_ws_e, v_ws_a]);
  reset role;
  if not (v_ids @> array[v_ws_a, v_ws_b, v_ws_c, v_ws_e]) then
    raise exception 'ever_paid must return a, b, c and e, got %', v_ids;
  end if;
  if v_ws_d = any(v_ids) then
    raise exception 'ever_paid must not return a Stripe-trialing-only workspace';
  end if;
  if cardinality(v_ids) <> 4 then
    raise exception 'ever_paid must return distinct ids, got %', v_ids;
  end if;
end;
$$;
rollback;
