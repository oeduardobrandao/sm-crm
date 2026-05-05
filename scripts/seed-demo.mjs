// Seed a workspace with realistic demo data.
// Usage:
//   node scripts/seed-demo.mjs              # uses .env (production)
//   node scripts/seed-demo.mjs --staging    # uses .env.staging
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';

const isStaging = process.argv.includes('--staging');
const envFile = isStaging ? '.env.staging' : '.env';

const env = Object.fromEntries(
  readFileSync(envFile, 'utf8')
    .split('\n')
    .filter((l) => l && !l.startsWith('#') && l.includes('='))
    .map((l) => {
      const i = l.indexOf('=');
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
    })
);

const SUPABASE_URL = env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = env.VITE_SUPABASE_ANON_KEY;
const EMAIL = process.env.SEED_EMAIL ?? env.SEED_EMAIL;
const PASSWORD = process.env.SEED_PASSWORD ?? env.SEED_PASSWORD;

if (!EMAIL || !PASSWORD) {
  console.error('✗ SEED_EMAIL and SEED_PASSWORD must be set in', envFile, 'or as environment variables');
  process.exit(1);
}

console.log(`Using ${envFile} → ${SUPABASE_URL}`);

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { persistSession: false },
});

const log = (...a) => console.log('·', ...a);
const die = (msg, err) => {
  console.error('✗', msg, err ?? '');
  process.exit(1);
};

const daysAgo = (n) => {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
};
const isoDaysAgo = (n) => {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString();
};
const daysFromNow = (n) => {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
};

async function main() {
  // ---------- AUTH ----------
  log('Logging in as', EMAIL);
  let auth, authErr;
  ({ data: auth, error: authErr } = await supabase.auth.signInWithPassword({
    email: EMAIL,
    password: PASSWORD,
  }));

  if (authErr) {
    log('Login failed, attempting sign up…');
    ({ data: auth, error: authErr } = await supabase.auth.signUp({
      email: EMAIL,
      password: PASSWORD,
    }));
    if (authErr) die('sign up failed', authErr);
    log('User created. Note: confirm email if required by your Supabase project settings.');
  }

  const userId = auth.user.id;

  const { data: profile, error: profErr } = await supabase
    .from('profiles')
    .select('conta_id, nome')
    .eq('id', userId)
    .single();
  if (profErr) die('profile fetch failed — make sure the user has a workspace', profErr);
  const contaId = profile.conta_id;
  log('Workspace (conta_id):', contaId);

  // ---------- CLIENTES ----------
  log('Seeding clientes…');
  const clientesSeed = [
    {
      nome: 'Dra. Marina Pacheco',
      sigla: 'MP',
      cor: '#D97757',
      plano: 'Premium',
      email: 'contato@marinapacheco.com.br',
      telefone: '(11) 97654-3210',
      status: 'ativo',
      valor_mensal: 4500,
      data_pagamento: 5,
      especialidade: 'Dermatologia',
    },
    {
      nome: 'Clínica Vida Plena',
      sigla: 'VP',
      cor: '#6C8EBF',
      plano: 'Standard',
      email: 'marketing@vidaplena.com.br',
      telefone: '(11) 98877-1122',
      status: 'ativo',
      valor_mensal: 3200,
      data_pagamento: 10,
      especialidade: 'Medicina Integrativa',
    },
    {
      nome: 'Dr. Rafael Nunes',
      sigla: 'RN',
      cor: '#82B366',
      plano: 'Premium',
      email: 'dr.rafael@nunesortopedia.com.br',
      telefone: '(11) 99123-4567',
      status: 'ativo',
      valor_mensal: 5200,
      data_pagamento: 15,
      especialidade: 'Ortopedia',
    },
    {
      nome: 'Studio Bem-Estar',
      sigla: 'BE',
      cor: '#B85450',
      plano: 'Standard',
      email: 'ola@studiobemestar.com.br',
      telefone: '(11) 98234-5566',
      status: 'ativo',
      valor_mensal: 2800,
      data_pagamento: 20,
      especialidade: 'Estética',
    },
    {
      nome: 'Dra. Helena Costa',
      sigla: 'HC',
      cor: '#9673A6',
      plano: 'Premium',
      email: 'dra.helena@costaendocrino.com.br',
      telefone: '(11) 97411-2233',
      status: 'ativo',
      valor_mensal: 4800,
      data_pagamento: 25,
      especialidade: 'Endocrinologia',
    },
    {
      nome: 'Nutrição em Foco',
      sigla: 'NF',
      cor: '#E6A817',
      plano: 'Basic',
      email: 'contato@nutricaoemfoco.com.br',
      telefone: '(11) 98455-7788',
      status: 'pausado',
      valor_mensal: 1800,
      data_pagamento: 15,
      especialidade: 'Nutrição',
    },
  ];

  const { data: clientes, error: clientesErr } = await supabase
    .from('clientes')
    .insert(clientesSeed.map((c) => ({ ...c, user_id: userId, conta_id: contaId })))
    .select();
  if (clientesErr) die('clientes insert failed', clientesErr);
  log('  ✓', clientes.length, 'clientes');

  // ---------- MEMBROS ----------
  log('Seeding membros…');
  const membrosSeed = [
    { nome: 'Débora Kristin', cargo: 'Diretora Criativa', tipo: 'clt', custo_mensal: 8500, avatar_url: '', data_pagamento: 5 },
    { nome: 'Lucas Ferreira', cargo: 'Social Media', tipo: 'clt', custo_mensal: 4200, avatar_url: '', data_pagamento: 5 },
    { nome: 'Bianca Almeida', cargo: 'Designer', tipo: 'freelancer_mensal', custo_mensal: 3800, avatar_url: '', data_pagamento: 10 },
    { nome: 'Thiago Rocha', cargo: 'Editor de Vídeo', tipo: 'freelancer_demanda', custo_mensal: null, avatar_url: '', data_pagamento: null },
  ];
  const { data: membros, error: membrosErr } = await supabase
    .from('membros')
    .insert(membrosSeed.map((m) => ({ ...m, user_id: userId, conta_id: contaId })))
    .select();
  if (membrosErr) die('membros insert failed', membrosErr);
  log('  ✓', membros.length, 'membros');

  // ---------- CONTRATOS ----------
  log('Seeding contratos…');
  const contratosSeed = clientes.filter(c => c.status === 'ativo').map((c, i) => ({
    user_id: userId,
    conta_id: contaId,
    cliente_id: c.id,
    cliente_nome: c.nome,
    titulo: `Contrato Social Media — ${c.nome}`,
    data_inicio: daysAgo(180 - i * 20),
    data_fim: daysFromNow(185 - i * 20),
    status: 'vigente',
    valor_total: Number(c.valor_mensal) * 12,
  }));
  contratosSeed.push({
    user_id: userId,
    conta_id: contaId,
    cliente_id: clientes[5].id,
    cliente_nome: clientes[5].nome,
    titulo: `Contrato — ${clientes[5].nome}`,
    data_inicio: daysAgo(200),
    data_fim: daysAgo(20),
    status: 'encerrado',
    valor_total: Number(clientes[5].valor_mensal) * 6,
  });
  const { error: contratosErr } = await supabase.from('contratos').insert(contratosSeed);
  if (contratosErr) die('contratos insert failed', contratosErr);
  log('  ✓', contratosSeed.length, 'contratos');

  // ---------- TRANSACOES ----------
  log('Seeding transacoes…');
  const txs = [];
  for (let m = 0; m < 3; m++) {
    for (const c of clientes.filter(c => c.status === 'ativo')) {
      txs.push({
        user_id: userId,
        conta_id: contaId,
        data: daysAgo(30 * m + 5),
        descricao: `Mensalidade — ${c.nome}`,
        detalhe: 'Recebido via PIX',
        categoria: 'Mensalidade',
        tipo: 'entrada',
        valor: Number(c.valor_mensal),
        cliente_id: c.id,
        status: 'pago',
      });
    }
    for (const mb of membros.filter(m => m.custo_mensal)) {
      txs.push({
        user_id: userId,
        conta_id: contaId,
        data: daysAgo(30 * m + 10),
        descricao: `Pagamento — ${mb.nome}`,
        detalhe: mb.cargo,
        categoria: 'Folha',
        tipo: 'saida',
        valor: Number(mb.custo_mensal),
        status: 'pago',
      });
    }
  }
  // Future scheduled transactions
  for (const c of clientes.filter(c => c.status === 'ativo')) {
    txs.push({
      user_id: userId,
      conta_id: contaId,
      data: daysFromNow(c.data_pagamento),
      descricao: `Mensalidade — ${c.nome}`,
      detalhe: 'Agendado',
      categoria: 'Mensalidade',
      tipo: 'entrada',
      valor: Number(c.valor_mensal),
      cliente_id: c.id,
      status: 'agendado',
    });
  }
  const { error: txErr } = await supabase.from('transacoes').insert(txs);
  if (txErr) die('transacoes insert failed', txErr);
  log('  ✓', txs.length, 'transacoes');

  // ---------- LEADS ----------
  log('Seeding leads…');
  const leadsSeed = [
    { nome: 'Dra. Camila Santos', email: 'camila@clinicasantos.com.br', telefone: '(11) 91234-0001', instagram: '@dracamilasantos', canal: 'Instagram', origem: 'instagram', status: 'novo', notas: 'Viu nosso anúncio no Instagram', especialidade: 'Pediatria', faturamento: '100k-500k', objetivo: 'Aumentar presença digital' },
    { nome: 'Fernando Lima', email: 'fernando@limefit.com.br', telefone: '(11) 91234-0002', instagram: '@limefitbr', canal: 'Indicação', origem: 'manual', status: 'contatado', notas: 'Indicação do Dr. Rafael', especialidade: 'Personal Training', faturamento: '50k-100k', objetivo: 'Captação de alunos' },
    { nome: 'Clínica Odonto Plus', email: 'admin@odontoplus.com.br', telefone: '(11) 91234-0003', instagram: '@odontoplusbr', canal: 'Google', origem: 'manual', status: 'qualificado', notas: 'Quer começar em junho. Budget aprovado.', especialidade: 'Odontologia', faturamento: '500k-1m', objetivo: 'Lançamento de clínica nova' },
    { nome: 'Ana Beatriz Souza', email: 'ana@belezapura.com.br', telefone: '(11) 91234-0004', instagram: '@belezapuraoficial', canal: 'Instagram', origem: 'instagram', status: 'perdido', notas: 'Achou o valor alto. Pode recontatar em 3 meses.', especialidade: 'Estética', faturamento: '50k-100k', objetivo: 'Engajamento' },
    { nome: 'Dr. Ricardo Mendes', email: 'ricardo@mendescard.com.br', telefone: '(11) 91234-0005', instagram: '@drricardomendess', canal: 'Indicação', origem: 'manual', status: 'novo', notas: 'Indicação da Dra. Helena', especialidade: 'Cardiologia', faturamento: '500k-1m', objetivo: 'Posicionamento como autoridade' },
    { nome: 'Pilates Studio Flow', email: 'contato@studioflow.com.br', telefone: '(11) 91234-0006', instagram: '@studioflowpilates', canal: 'Site', origem: 'manual', status: 'contatado', notas: 'Preencheu formulário no site', especialidade: 'Pilates', faturamento: '100k-500k', objetivo: 'Atrair novas alunas' },
  ];
  const { data: leads, error: leadsErr } = await supabase
    .from('leads')
    .insert(leadsSeed.map((l) => ({ ...l, user_id: userId, conta_id: contaId })))
    .select();
  if (leadsErr) die('leads insert failed', leadsErr);
  log('  ✓', leads.length, 'leads');

  // ---------- WORKFLOW TEMPLATE ----------
  log('Seeding workflow template…');
  const etapasTpl = [
    { nome: 'Briefing', prazo_dias: 1, tipo_prazo: 'uteis', tipo: 'padrao' },
    { nome: 'Roteiro', prazo_dias: 2, tipo_prazo: 'uteis', tipo: 'padrao' },
    { nome: 'Design', prazo_dias: 2, tipo_prazo: 'uteis', tipo: 'padrao' },
    { nome: 'Revisão Interna', prazo_dias: 1, tipo_prazo: 'uteis', tipo: 'padrao' },
    { nome: 'Aprovação Cliente', prazo_dias: 2, tipo_prazo: 'uteis', tipo: 'aprovacao_cliente' },
    { nome: 'Agendamento', prazo_dias: 1, tipo_prazo: 'uteis', tipo: 'padrao' },
  ];
  const { data: tpl, error: tplErr } = await supabase
    .from('workflow_templates')
    .insert({ user_id: userId, conta_id: contaId, nome: 'Produção de Conteúdo', etapas: etapasTpl })
    .select()
    .single();
  if (tplErr) die('template insert failed', tplErr);
  log('  ✓ template', tpl.id);

  // ---------- WORKFLOWS ----------
  log('Seeding workflows + etapas…');
  const workflowTitles = [
    'Campanha Maio — Posts + Reels',
    'Conteúdo Semanal — Feed',
    'Lançamento Procedimento',
    'Campanha Antes/Depois',
    'Série Educativa — Reels',
  ];
  const activeClientes = clientes.filter(c => c.status === 'ativo');
  const workflows = [];
  for (let i = 0; i < activeClientes.length; i++) {
    const cliente = activeClientes[i];
    const { data: wf, error: wfErr } = await supabase
      .from('workflows')
      .insert({
        user_id: userId,
        conta_id: contaId,
        cliente_id: cliente.id,
        titulo: workflowTitles[i],
        template_id: tpl.id,
        status: 'ativo',
        etapa_atual: i % etapasTpl.length,
        recorrente: true,
      })
      .select()
      .single();
    if (wfErr) die('workflow insert failed', wfErr);

    const activeIdx = i % etapasTpl.length;
    const etapasRows = etapasTpl.map((e, idx) => ({
      workflow_id: wf.id,
      ordem: idx,
      nome: e.nome,
      prazo_dias: e.prazo_dias,
      tipo_prazo: e.tipo_prazo,
      tipo: e.tipo,
      responsavel_id: membros[idx % membros.length].id,
      status: idx < activeIdx ? 'concluido' : idx === activeIdx ? 'ativo' : 'pendente',
      iniciado_em: idx <= activeIdx ? isoDaysAgo(activeIdx - idx + 1) : null,
      concluido_em: idx < activeIdx ? isoDaysAgo(activeIdx - idx) : null,
    }));
    const { error: etErr } = await supabase.from('workflow_etapas').insert(etapasRows);
    if (etErr) die('etapas insert failed', etErr);
    workflows.push(wf);
  }
  for (let i = 0; i < 5; i++) {
    const cliente = activeClientes[i % activeClientes.length];
    const { data: wf, error: wfErr } = await supabase
      .from('workflows')
      .insert({
        user_id: userId,
        conta_id: contaId,
        cliente_id: cliente.id,
        titulo: `Post Semana ${i + 1} — ${cliente.sigla}`,
        template_id: tpl.id,
        status: 'ativo',
        etapa_atual: (i + 2) % etapasTpl.length,
        recorrente: false,
      })
      .select()
      .single();
    if (wfErr) die('workflow insert failed', wfErr);
    const activeIdx = (i + 2) % etapasTpl.length;
    const etapasRows = etapasTpl.map((e, idx) => ({
      workflow_id: wf.id,
      ordem: idx,
      nome: e.nome,
      prazo_dias: e.prazo_dias,
      tipo_prazo: e.tipo_prazo,
      tipo: e.tipo,
      responsavel_id: membros[(idx + i) % membros.length].id,
      status: idx < activeIdx ? 'concluido' : idx === activeIdx ? 'ativo' : 'pendente',
      iniciado_em: idx <= activeIdx ? isoDaysAgo(activeIdx - idx + 1) : null,
      concluido_em: idx < activeIdx ? isoDaysAgo(activeIdx - idx) : null,
    }));
    const { error: etErr } = await supabase.from('workflow_etapas').insert(etapasRows);
    if (etErr) die('etapas insert failed', etErr);
    workflows.push(wf);
  }
  log('  ✓', workflows.length, 'workflows');

  // ---------- INSTAGRAM ACCOUNTS + POSTS + FOLLOWER HISTORY ----------
  log('Seeding instagram data…');
  const captions = [
    'Tudo o que você precisa saber antes do procedimento ✨',
    'Antes & depois — um caso real da clínica 💫',
    '5 mitos sobre skincare que você precisa parar de acreditar',
    'Rotina diária para pele saudável ☀️',
    'Resultado que fala por si só 💛',
    'Novo procedimento disponível na clínica!',
    'Dica rápida da semana 🎯',
    'Depoimento de paciente — agradecimento especial',
  ];
  for (let i = 0; i < activeClientes.length; i++) {
    const cliente = activeClientes[i];
    const baseFollowers = 8000 + i * 2500 + Math.floor(Math.random() * 2000);
    const { data: igAcc, error: igErr } = await supabase
      .from('instagram_accounts')
      .insert({
        client_id: cliente.id,
        instagram_user_id: `mock_${cliente.id}`,
        username: cliente.nome.toLowerCase().replace(/[^a-z]/g, '').slice(0, 14),
        profile_picture_url: '',
        follower_count: baseFollowers,
        following_count: 420 + i * 30,
        media_count: 180 + i * 40,
        reach_28d: baseFollowers * 3 + Math.floor(Math.random() * 5000),
        impressions_28d: baseFollowers * 5 + Math.floor(Math.random() * 8000),
        profile_views_28d: 2400 + i * 500,
        last_synced_at: new Date().toISOString(),
        encrypted_access_token: 'mock_token_not_real',
        token_expires_at: new Date(Date.now() + 60 * 86400000).toISOString(),
      })
      .select()
      .single();
    if (igErr) die('instagram_accounts insert failed', igErr);

    const history = [];
    for (let d = 30; d >= 0; d--) {
      history.push({
        instagram_account_id: igAcc.id,
        date: daysAgo(d),
        follower_count: baseFollowers - d * 12 - Math.floor(Math.random() * 8),
      });
    }
    const { error: histErr } = await supabase.from('instagram_follower_history').insert(history);
    if (histErr) die('follower_history insert failed', histErr);

    const posts = captions.map((cap, p) => ({
      instagram_account_id: igAcc.id,
      instagram_post_id: `mock_${cliente.id}_${p}_${Date.now()}`,
      caption: cap,
      media_type: p % 3 === 0 ? 'VIDEO' : 'IMAGE',
      permalink: 'https://instagram.com/',
      posted_at: isoDaysAgo(p * 3 + 1),
      likes: 200 + Math.floor(Math.random() * 800) + i * 50,
      comments: 15 + Math.floor(Math.random() * 60),
      reach: 3000 + Math.floor(Math.random() * 6000) + i * 400,
      impressions: 5000 + Math.floor(Math.random() * 8000) + i * 500,
      saved: 20 + Math.floor(Math.random() * 80),
      shares: 10 + Math.floor(Math.random() * 40),
      synced_at: new Date().toISOString(),
    }));
    const { error: postsErr } = await supabase.from('instagram_posts').insert(posts);
    if (postsErr) die('instagram_posts insert failed', postsErr);
  }
  log('  ✓ instagram data for', activeClientes.length, 'clients');

  // ---------- HUB TOKENS ----------
  log('Seeding hub tokens…');
  for (const cliente of activeClientes) {
    const { error: hubErr } = await supabase
      .from('client_hub_tokens')
      .insert({ cliente_id: cliente.id, conta_id: contaId });
    if (hubErr) log('  ! hub token skipped for', cliente.nome, hubErr.message);
  }
  log('  ✓ hub tokens');

  // ---------- HUB BRIEFING QUESTIONS ----------
  log('Seeding briefing questions…');
  const briefingSections = ['Identidade', 'Público-Alvo', 'Conteúdo'];
  const briefingQuestions = [
    { section: 'Identidade', question: 'Qual é o tom de voz da sua marca?', answer: 'Profissional mas acessível, com toques de humor leve.' },
    { section: 'Identidade', question: 'Quais cores e fontes representam sua marca?', answer: null },
    { section: 'Público-Alvo', question: 'Quem é seu cliente ideal?', answer: 'Mulheres de 25-45 anos, classe AB, preocupadas com saúde e bem-estar.' },
    { section: 'Público-Alvo', question: 'Quais são as dores do seu público?', answer: null },
    { section: 'Conteúdo', question: 'Quais temas você gostaria de abordar?', answer: 'Dicas de saúde, bastidores da clínica, depoimentos de pacientes.' },
    { section: 'Conteúdo', question: 'Existe algum assunto que NÃO devemos abordar?', answer: 'Não mencionar procedimentos invasivos sem supervisão médica.' },
  ];
  for (const cliente of activeClientes.slice(0, 3)) {
    const rows = briefingQuestions.map((q, idx) => ({
      cliente_id: cliente.id,
      conta_id: contaId,
      question: q.question,
      answer: q.answer,
      section: q.section,
      display_order: idx,
    }));
    const { error: bErr } = await supabase.from('hub_briefing_questions').insert(rows);
    if (bErr) log('  ! briefing skipped for', cliente.nome, bErr.message);
  }
  log('  ✓ briefing questions');

  // ---------- IDEIAS ----------
  log('Seeding ideias…');
  const ideiasSeed = [
    { titulo: 'Série "Mitos & Verdades"', descricao: 'Uma série semanal desmistificando crenças populares sobre saúde.', status: 'aprovada' },
    { titulo: 'Bastidores da clínica', descricao: 'Vídeos curtos mostrando o dia a dia, humanizando a marca.', status: 'em_analise' },
    { titulo: 'Live mensal com Q&A', descricao: 'Live no Instagram respondendo dúvidas dos seguidores.', status: 'nova' },
    { titulo: 'Colaboração com influencer local', descricao: 'Parceria com micro-influencer da área de saúde para ampliar alcance.', status: 'nova' },
    { titulo: 'Campanha de aniversário', descricao: 'Promoção especial no mês de aniversário da clínica.', status: 'descartada', comentario_agencia: 'Deixar para o segundo semestre quando teremos mais budget.' },
  ];
  for (const cliente of activeClientes.slice(0, 2)) {
    for (const ideia of ideiasSeed) {
      const { error: idErr } = await supabase.from('ideias').insert({
        workspace_id: contaId,
        cliente_id: cliente.id,
        titulo: ideia.titulo,
        descricao: ideia.descricao,
        status: ideia.status,
        comentario_agencia: ideia.comentario_agencia || null,
        comentario_autor_id: ideia.comentario_agencia ? membros[0].id : null,
        comentario_at: ideia.comentario_agencia ? new Date().toISOString() : null,
      });
      if (idErr) log('  ! ideia skipped:', idErr.message);
    }
  }
  log('  ✓ ideias');

  // ---------- INTEGRACOES ----------
  log('Seeding integracoes status…');
  const integracoes = [
    { integracao_id: 'meta_ads', status: 'desconectado' },
    { integracao_id: 'asaas', status: 'em_breve' },
    { integracao_id: 'whatsapp', status: 'em_breve' },
    { integracao_id: 'google_analytics', status: 'desconectado' },
    { integracao_id: 'canva', status: 'em_breve' },
    { integracao_id: 'notion', status: 'desconectado' },
  ];
  for (const ig of integracoes) {
    const { error: igErr } = await supabase
      .from('integracoes_status')
      .upsert({ ...ig, user_id: userId, conta_id: contaId }, { onConflict: 'user_id,integracao_id' });
    if (igErr) log('  ! integracao skipped:', ig.integracao_id, igErr.message);
  }
  log('  ✓ integracoes');

  console.log('\n✓ Seed complete!');
  console.log('  Clientes:', clientes.length);
  console.log('  Membros:', membros.length);
  console.log('  Contratos:', contratosSeed.length);
  console.log('  Transações:', txs.length);
  console.log('  Leads:', leads.length);
  console.log('  Workflows:', workflows.length);
  console.log('  Instagram accounts:', activeClientes.length);
  console.log('\nLog in at', SUPABASE_URL.replace('.supabase.co', ''), 'with', EMAIL);
}

main().catch((e) => die('unexpected', e));
