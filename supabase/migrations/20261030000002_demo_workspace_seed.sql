-- Conta demo criada pelo Admin: dados de exemplo e descarte.
--
-- demo_workspace_seed(p_conta, p_owner): grava o conjunto fixo de exemplos (spec §4) numa conta
-- recem-criada. Roda como service_role (auth.uid() nulo), por isso user_id / organizador_id sao
-- sempre p_owner. Respeita o plano efetivo: omite o grupo cuja feature esta desligada e corta o
-- grupo que nao cabe no limite. Nunca concede override e nunca falha por causa do plano.
--
-- Triggers conferidos (nenhum depende de auth.uid() para gravar nem envia e-mail): as notificacoes
-- de etapa/post/ideia sao in-app, embrulhadas em EXCEPTION WHEN OTHERS, e gravam com ator nulo.
-- Nenhum post fica agendado/postado, entao nenhum cron de publicacao os pega. Sem token do Hub e
-- sem convidados, nada sai por e-mail.
--
-- demo_workspace_discard(p_conta): apaga a conta demo inteira (sem tocar em auth.users), filhos
-- primeiro. Usada no rollback do Admin; o deleteUser depois remove o usuario sem violar FK.

create or replace function public.demo_workspace_seed(p_conta uuid, p_owner uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_leads_on   boolean := coalesce(public.effective_plan_feature(p_conta, 'feature_leads'), false);
  v_ideias_on  boolean := coalesce(public.effective_plan_feature(p_conta, 'feature_ideas'), false);
  v_agenda_on  boolean := coalesce(public.effective_plan_feature(p_conta, 'feature_agenda'), false);
  v_lim_posts  bigint  := public.effective_plan_limit(p_conta, 'max_posts_per_workflow');
  v_lim_leads  bigint  := public.effective_plan_limit(p_conta, 'max_leads');
  v_lim_cli    bigint  := public.effective_plan_limit(p_conta, 'max_clients');
  v_lim_wf     bigint  := public.effective_plan_limit(p_conta, 'max_active_workflows_per_client');
  v_membro     bigint;
  v_cliente    bigint;
  v_wf         bigint;
  v_evento     bigint;
  v_etapas     jsonb;
  v_et         jsonb;
  v_i          int;
  v_ordem      int;
  v_status     text;
  v_n_membros  int := 0;
  v_n_clientes int := 0;
  v_n_wf       int := 0;
  v_n_posts    int := 0;
  v_n_ideias   int := 0;
  v_n_leads    int := 0;
  v_n_eventos  int := 0;
  v_day        date;
  v_post       record;
  v_leads      jsonb := '[
    {"nome":"Padaria Trigo Bom (exemplo)","email":"contato@trigobom.example","instagram":"@padariatrigobom","status":"novo","origem":"instagram"},
    {"nome":"Studio Pilates Leve (exemplo)","email":"contato@pilatesleve.example","instagram":"@studiopilatesleve","status":"contatado","origem":"manual"},
    {"nome":"Ótica Visão Clara (exemplo)","email":"contato@visaoclara.example","instagram":"@oticavisaoclara","status":"qualificado","origem":"instagram"}
  ]';
  v_ideias     jsonb := '[
    {"titulo":"Bastidores da torra do café","descricao":"Mostrar a torra em vídeo curto, do grão verde ao aroma da primeira xícara.","status":"nova"},
    {"titulo":"Receita de cold brew em 30 segundos","descricao":"Passo a passo rápido para o reels da semana.","status":"em_analise"},
    {"titulo":"Enquete: qual o café da semana?","descricao":"Enquete nos stories para engajar e escolher o destaque do cardápio.","status":"aprovada"}
  ]';
  v_posts      jsonb := '[
    {"tipo":"carrossel","titulo":"5 cafés para começar a manhã (exemplo)","status":"rascunho","dias":2,
     "texto":"Cinco jeitos de começar a manhã com um café especial. Qual é o seu favorito? Conta nos comentários."},
    {"tipo":"reels","titulo":"Bastidores da torra (exemplo)","status":"revisao_interna","dias":5,
     "texto":"Do grão verde ao aroma que enche a casa: veja como a nossa torra acontece todos os dias."},
    {"tipo":"feed","titulo":"Cold brew da casa (exemplo)","status":"enviado_cliente","dias":9,
     "texto":"Cold brew gelado, 12 horas de extração e zero amargor. Já provou o da casa?"},
    {"tipo":"stories","titulo":"Café da semana (exemplo)","status":"aprovado_cliente","dias":12,
     "texto":"Qual será o café da semana? Vote na enquete e a gente prepara o mais pedido."}
  ]';
begin
  -- Fluxo "Padrao" da conta; se o seed do trigger de signup foi pulado, usa as mesmas etapas.
  select etapas into v_etapas
    from public.workflow_templates
   where conta_id = p_conta and nome = 'Padrão'
   order by id limit 1;
  if v_etapas is null or jsonb_typeof(v_etapas) <> 'array' or jsonb_array_length(v_etapas) = 0 then
    v_etapas := '[
      {"nome":"Copy","prazo_dias":3,"tipo_prazo":"uteis","tipo":"padrao"},
      {"nome":"Aprovação da Copy","prazo_dias":2,"tipo_prazo":"corridos","tipo":"aprovacao_cliente"},
      {"nome":"Mídia","prazo_dias":3,"tipo_prazo":"uteis","tipo":"padrao"},
      {"nome":"Aprovação da Mídia","prazo_dias":2,"tipo_prazo":"corridos","tipo":"aprovacao_cliente"},
      {"nome":"Agendamento","prazo_dias":1,"tipo_prazo":"uteis","tipo":"padrao"}
    ]'::jsonb;
  end if;

  -- Membro sem login e sem custo.
  insert into public.membros (user_id, conta_id, nome, cargo, tipo)
    values (p_owner, p_conta, 'Camila Rocha (exemplo)', 'Designer', 'freelancer_mensal')
    returning id into v_membro;
  v_n_membros := 1;

  -- Cliente sem mensalidade nem dia de pagamento. Se o limite de clientes nao comporta nem um,
  -- pula so o que depende do cliente (fluxo, posts, ideias); leads e evento seguem.
  if v_lim_cli is null or v_lim_cli >= 1 then
    insert into public.clientes (user_id, conta_id, nome, sigla, cor, especialidade, status, email)
      values (p_owner, p_conta, 'Café Aurora (exemplo)', 'CA', '#b45309', 'Cafeteria', 'ativo',
              'contato@cafeaurora.example')
      returning id into v_cliente;
    v_n_clientes := 1;
  end if;

  -- Fluxo + etapas.
  if v_cliente is not null and (v_lim_wf is null or v_lim_wf >= 1) then
    -- etapa_atual: indice 0-based da etapa Mídia no template Padrão (Copy 0, Aprovação 1, Mídia 2).
    insert into public.workflows (user_id, conta_id, cliente_id, titulo, status, etapa_atual, modo_prazo)
      values (p_owner, p_conta, v_cliente, 'Conteúdo de novembro (exemplo)', 'ativo', 2, 'padrao')
      returning id into v_wf;
    v_n_wf := 1;

    v_i := 0;
    for v_et in select * from jsonb_array_elements(v_etapas) loop
      v_i := v_i + 1;
      insert into public.workflow_etapas
        (workflow_id, ordem, nome, prazo_dias, tipo_prazo, tipo, status, responsavel_id, iniciado_em, concluido_em)
      values (
        v_wf, v_i, v_et->>'nome', coalesce((v_et->>'prazo_dias')::int, 1),
        coalesce(v_et->>'tipo_prazo', 'uteis'), coalesce(v_et->>'tipo', 'padrao'),
        case when v_i <= 2 then 'concluido' when v_i = 3 then 'ativo' else 'pendente' end,
        case when v_i = 3 then v_membro end,
        case when v_i = 3 then now() end,
        case when v_i <= 2 then now() end);
    end loop;
  end if;

  -- Posts (cortados do fim se o limite for menor), sem midia, sem status de publicacao.
  if v_wf is not null then
    for v_post in
      select value as p, ordinality as o from jsonb_array_elements(v_posts) with ordinality
       where v_lim_posts is null or ordinality <= v_lim_posts
    loop
      insert into public.workflow_posts
        (conta_id, workflow_id, cliente_id, titulo, tipo, status, ordem, platform, scheduled_at,
         conteudo, conteudo_plain)
      values (
        p_conta, v_wf, v_cliente, v_post.p->>'titulo', v_post.p->>'tipo', v_post.p->>'status',
        v_post.o::int, 'instagram',
        now() + make_interval(days => (v_post.p->>'dias')::int),
        jsonb_build_object('type', 'doc', 'content', jsonb_build_array(jsonb_build_object(
          'type', 'paragraph', 'content', jsonb_build_array(
            jsonb_build_object('type', 'text', 'text', v_post.p->>'texto'))))),
        v_post.p->>'texto');
      v_n_posts := v_n_posts + 1;
    end loop;
  end if;

  -- Ideias.
  if v_ideias_on and v_cliente is not null then
    insert into public.ideias (workspace_id, cliente_id, titulo, descricao, status, origem, tipo)
      select p_conta, v_cliente, x->>'titulo', x->>'descricao', x->>'status', 'agencia', 'ideia'
        from jsonb_array_elements(v_ideias) x;
    get diagnostics v_n_ideias = row_count;
  end if;

  -- Leads (cortados pelo limite).
  if v_leads_on then
    insert into public.leads (user_id, conta_id, nome, email, instagram, status, origem)
      select p_owner, p_conta, x.value->>'nome', x.value->>'email', x.value->>'instagram',
             x.value->>'status', x.value->>'origem'
        from jsonb_array_elements(v_leads) with ordinality x
       where v_lim_leads is null or x.ordinality <= v_lim_leads;
    get diagnostics v_n_leads = row_count;
  end if;

  -- Evento: proximo dia util depois de amanha, 10:00 em Sao Paulo, e materializa ~90 dias.
  if v_agenda_on then
    v_day := (now() at time zone 'America/Sao_Paulo')::date + 2;
    while extract(isodow from v_day) > 5 loop
      v_day := v_day + 1;
    end loop;
    insert into public.agenda_eventos
      (conta_id, organizador_id, titulo, tipo, cliente_id, tz, dtstart, duracao_min)
      values (p_conta, p_owner, 'Reunião de alinhamento com Café Aurora (exemplo)', 'reuniao',
              v_cliente, 'America/Sao_Paulo', v_day + time '10:00', 60)
      returning id into v_evento;
    perform public.agenda_materializar(v_evento, current_date + 90);
    v_n_eventos := 1;
  end if;

  return jsonb_build_object('membros', v_n_membros, 'clientes', v_n_clientes, 'workflows', v_n_wf,
                            'posts', v_n_posts, 'ideias', v_n_ideias, 'leads', v_n_leads,
                            'eventos', v_n_eventos);
end;
$$;

create or replace function public.demo_workspace_discard(p_conta uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.agenda_ocorrencias
   where evento_id in (select id from public.agenda_eventos where conta_id = p_conta);
  delete from public.agenda_eventos where conta_id = p_conta;
  delete from public.workflow_posts where conta_id = p_conta;
  delete from public.workflow_etapas
   where workflow_id in (select id from public.workflows where conta_id = p_conta);
  delete from public.workflows where conta_id = p_conta;
  delete from public.workflow_templates where conta_id = p_conta;
  delete from public.ideias where workspace_id = p_conta;
  delete from public.leads where conta_id = p_conta;
  delete from public.clientes where conta_id = p_conta;
  delete from public.membros where conta_id = p_conta;
  delete from public.workspace_plan_overrides where workspace_id = p_conta;
  delete from public.affiliate_referrals where workspace_id = p_conta;
  delete from public.workspace_members where workspace_id = p_conta;
  delete from public.profiles where conta_id = p_conta;
  delete from public.workspaces where id = p_conta;
  delete from public.contas where id = p_conta;
end;
$$;

-- service_role only. Sem checagem de chamador no corpo: o grant e a fronteira inteira.
revoke all on function public.demo_workspace_seed(uuid, uuid) from public, anon, authenticated;
grant execute on function public.demo_workspace_seed(uuid, uuid) to service_role;
revoke all on function public.demo_workspace_discard(uuid) from public, anon, authenticated;
grant execute on function public.demo_workspace_discard(uuid) to service_role;
