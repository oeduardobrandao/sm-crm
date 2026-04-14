// Seed DK TESTE workspace with mock data for landing-page screenshots.
// Run: node scripts/seed-demo.mjs
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';

const env = Object.fromEntries(
  readFileSync('.env', 'utf8')
    .split('\n')
    .filter((l) => l && !l.startsWith('#') && l.includes('='))
    .map((l) => {
      const i = l.indexOf('=');
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
    })
);

const SUPABASE_URL = env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = env.VITE_SUPABASE_ANON_KEY;
const EMAIL = 'deborakristinsm@gmail.com';
const PASSWORD = 'Bochecha@123';

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { persistSession: false },
});

const log = (...a) => console.log('·', ...a);
const die = (msg, err) => {
  console.error('✗', msg, err ?? '');
  process.exit(1);
};

// ---------- helpers ----------
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

async function main() {
  log('Logging in as', EMAIL);
  const { data: auth, error: authErr } = await supabase.auth.signInWithPassword({
    email: EMAIL,
    password: PASSWORD,
  });
  if (authErr) die('login failed', authErr);
  const userId = auth.user.id;

  const { data: profile, error: profErr } = await supabase
    .from('profiles')
    .select('conta_id, nome')
    .eq('id', userId)
    .single();
  if (profErr) die('profile fetch failed', profErr);
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
  ];
  const { data: membros, error: membrosErr } = await supabase
    .from('membros')
    .insert(membrosSeed.map((m) => ({ ...m, user_id: userId, conta_id: contaId })))
    .select();
  if (membrosErr) die('membros insert failed', membrosErr);
  log('  ✓', membros.length, 'membros');

  // ---------- CONTRATOS ----------
  log('Seeding contratos…');
  const contratosSeed = clientes.map((c, i) => ({
    user_id: userId,
    conta_id: contaId,
    cliente_id: c.id,
    cliente_nome: c.nome,
    titulo: `Contrato Social Media — ${c.nome}`,
    data_inicio: daysAgo(180 - i * 20),
    data_fim: daysAgo(-185 + i * 20),
    status: 'vigente',
    valor_total: Number(c.valor_mensal) * 12,
  }));
  const { error: contratosErr } = await supabase.from('contratos').insert(contratosSeed);
  if (contratosErr) die('contratos insert failed', contratosErr);
  log('  ✓', contratosSeed.length, 'contratos');

  // ---------- TRANSACOES ----------
  log('Seeding transacoes…');
  const txs = [];
  for (let m = 0; m < 3; m++) {
    for (const c of clientes) {
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
    for (const mb of membros) {
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
  const { error: txErr } = await supabase.from('transacoes').insert(txs);
  if (txErr) die('transacoes insert failed', txErr);
  log('  ✓', txs.length, 'transacoes');

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

  // ---------- WORKFLOWS (one per cliente, with distinct active stages) ----------
  log('Seeding workflows + etapas…');
  const workflowTitles = [
    'Campanha Abril — Posts + Reels',
    'Conteúdo Semanal — Feed',
    'Lançamento Procedimento',
    'Campanha Antes/Depois',
    'Série Educativa — Reels',
  ];
  const workflows = [];
  for (let i = 0; i < clientes.length; i++) {
    const cliente = clientes[i];
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
  // Add a couple more workflows to make the kanban denser
  for (let i = 0; i < 5; i++) {
    const cliente = clientes[i % clientes.length];
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

  // ---------- INSTAGRAM ACCOUNTS + POSTS + FOLLOWER HISTORY (for Analytics) ----------
  log('Seeding instagram accounts + posts…');
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
  for (let i = 0; i < clientes.length; i++) {
    const cliente = clientes[i];
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

    // Follower history (last 30 days, growing)
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

    // Posts (last 8)
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
  log('  ✓ instagram data for', clientes.length, 'clients');

  // ---------- HUB TOKENS (for Hub do Cliente link) ----------
  log('Seeding hub tokens…');
  for (const cliente of clientes) {
    const { error: hubErr } = await supabase
      .from('client_hub_tokens')
      .insert({ cliente_id: cliente.id, conta_id: contaId });
    if (hubErr) log('  ! hub token skipped for', cliente.nome, hubErr.message);
  }
  log('  ✓ hub tokens created');

  console.log('\n✓ Seed complete. Log in and take screenshots.');
}

main().catch((e) => die('unexpected', e));
