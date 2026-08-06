// Seeds the DK TESTE workspace with the post states the KB screenshot capture
// needs, and tears them down again.
//
// WHY THIS EXISTS
// The capture harness (e2e/screenshots/*) is deliberately zero-write: it
// photographs state that already exists rather than creating any. That design
// assumed DK TESTE held realistic content. As of 2026-08-06 it does not: the
// whole workspace holds 2 posts, 0 approved and 0 scheduled, and workflow 217
// that e2e/screenshots/entregas.spec.ts targets no longer exists. Without the
// states below, the article's most important screenshots (an enabled Agendar
// button, a scheduled post) cannot be taken at all.
//
// This script is the one deliberate, reviewable, reversible human write. The
// capture run itself stays zero-write.
//
// USAGE
//   node --env-file=.env.kb-upload.local scripts/seed-kb-capture-fixtures.mjs --up
//   node --env-file=.env.kb-upload.local scripts/seed-kb-capture-fixtures.mjs --down
//
// .env.kb-upload.local must define SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.
// The service role bypasses RLS, which is why every guard below is explicit.
//
// ⚠️ READ BEFORE RUNNING --up
// One seeded post carries status 'agendado', the status instagram-publish-cron
// claims on. It is made structurally unclaimable via a far-future
// publish_processing_at (see the note on that fixture below), so a missed
// teardown does not eventually publish anything or raise a cron failure.
// Run --down anyway when the captures are done: the belt is the unclaimable
// flag, the braces are the teardown, and fixture rows should not outlive
// their purpose in a production workspace.
import { createClient } from '@supabase/supabase-js';
import { writeFileSync, readFileSync, existsSync, unlinkSync, mkdirSync } from 'node:fs';
import path from 'node:path';

// Everything this script may touch, pinned by id. Nothing is discovered at
// runtime, so a wrong environment fails the preflight instead of writing
// somewhere unexpected.
const CONTA_ID = 'e68bdbc3-baf0-4807-b905-0807ac4e0253'; // DK TESTE
const CLIENTE_ID = 42; // Studio Bem-Estar, one of the four fake personas
const WORKFLOW_APROVACAO = 48; // "Campanha Antes/Depois", parked at Revisão Interna
const WORKFLOW_AGENDAMENTO = 53; // "Post Semana 4", parked at Agendamento

const MANIFEST = path.join(process.cwd(), '.superpowers', 'kb-capture-fixtures.json');

const DAY = 24 * 60 * 60 * 1000;
const TEARDOWN_DEADLINE_DAYS = 60;

// Studio Bem-Estar is a fictional persona, so this copy is safe to photograph.
// Deliberately bland: it appears in a help article, not in a portfolio.
const POSTS = [
  {
    workflow_id: WORKFLOW_APROVACAO,
    titulo: 'Antes e depois: harmonização facial',
    tipo: 'carrossel',
    status: 'rascunho',
    ordem: 0,
    ig_caption: null,
    scheduled_at: null,
  },
  {
    workflow_id: WORKFLOW_APROVACAO,
    titulo: 'Bastidores do atendimento',
    tipo: 'reels',
    status: 'revisao_interna',
    ordem: 1,
    ig_caption: null,
    scheduled_at: null,
  },
  {
    workflow_id: WORKFLOW_APROVACAO,
    titulo: 'Cuidados no pós-procedimento',
    tipo: 'feed',
    status: 'aprovado_interno',
    ordem: 2,
    ig_caption: null,
    scheduled_at: null,
  },
  // Shot 30: the enabled Agendar button. Needs the full canSchedule predicate
  // (ScheduleButton.tsx:504): aprovado_cliente + scheduled_at + caption +
  // no account warning + platform not targeting TikTok.
  {
    workflow_id: WORKFLOW_AGENDAMENTO,
    titulo: 'Rotina de skincare para o verão',
    tipo: 'feed',
    status: 'aprovado_cliente',
    ordem: 0,
    ig_caption:
      'Sua pele pede cuidado redobrado no verão. Salve este post e comece pelo básico: limpeza, hidratação e protetor solar todos os dias.',
    scheduledInDays: 45,
  },
  // Shots 31 and 32: the Agendado chip and the Cancelar button.
  //
  // This row carries status 'agendado', which is what instagram-publish-cron
  // claims on, so it is made structurally unclaimable rather than merely
  // far-dated. claim_posts_for_publishing requires
  //   publish_processing_at IS NULL OR publish_processing_at < now() - 10 min
  // so a far-FUTURE publish_processing_at fails both branches and the row is
  // never claimed, in any phase, at any date.
  //
  // The UI is unaffected: getPostPublishState (postLabels.ts:86-102) derives the
  // Agendado vs Publicando chip from status and scheduled_at only and never
  // reads publish_processing_at, so the screenshot still shows what it must.
  //
  // NOT doing what a review suggested here, deliberately: attaching fixture
  // media to stop the cron erroring with "No media files found"
  // (_shared/instagram-publish-utils.ts:565). That fixes the symptom by making
  // the post genuinely publishable, so a later token refresh would post real
  // content to a real Instagram account. The missing media is a safety net, not
  // a bug. Blocking the claim removes the error AND the publication risk.
  {
    workflow_id: WORKFLOW_AGENDAMENTO,
    titulo: 'Dicas de hidratação facial',
    tipo: 'feed',
    status: 'agendado',
    ordem: 1,
    ig_caption:
      'Hidratação não é só creme. Água, alimentação e sono entram na conta. Comente aqui a sua maior dúvida sobre pele.',
    scheduledInDays: TEARDOWN_DEADLINE_DAYS,
    unclaimable: true,
  },
];

// Workflow 53's stored title uses an em-dash, which the house style bans in
// user-facing copy. It would be legible in several screenshots, so --up
// rewrites it and --down restores whatever was there before.
const TITLE_FIX = { id: WORKFLOW_AGENDAMENTO, to: 'Post Semana 4 · BE' };

function client() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error('Faltam SUPABASE_URL ou SUPABASE_SERVICE_ROLE_KEY. Use --env-file.');
  }
  return createClient(url, key);
}

/**
 * Refuses to touch anything that is not the exact DK TESTE fixture target.
 *
 * The service role bypasses RLS, so nothing else stops this script from writing
 * into a paying customer's workspace if an id were wrong. Prod holds many real
 * agencies alongside DK TESTE.
 *
 * @param requirePublishable
 *   Whether to also demand that Instagram can actually publish. True for --up
 *   and --check, where a non-publishable account makes the capture worthless.
 *   MUST be false for --down: teardown has to work in every state, and an
 *   expired token is no reason to refuse to delete a scheduled fixture post.
 *   Blocking cleanup on it would strand exactly the row that most needs
 *   removing.
 */
async function preflight(supabase, { requirePublishable }) {
  const { data: conta, error: contaErr } = await supabase
    .from('contas')
    .select('id, nome')
    .eq('id', CONTA_ID)
    .maybeSingle();
  if (contaErr) throw contaErr;
  if (!conta) throw new Error(`Workspace ${CONTA_ID} não existe neste ambiente.`);
  if (conta.nome !== 'DK TESTE') {
    throw new Error(
      `Workspace ${CONTA_ID} se chama "${conta.nome}", esperado "DK TESTE". Abortando.`,
    );
  }

  const { data: cliente, error: cliErr } = await supabase
    .from('clientes')
    .select('id, nome, conta_id')
    .eq('id', CLIENTE_ID)
    .maybeSingle();
  if (cliErr) throw cliErr;
  if (!cliente || cliente.conta_id !== CONTA_ID) {
    throw new Error(`Cliente ${CLIENTE_ID} não pertence ao DK TESTE. Abortando.`);
  }

  const { data: flows, error: flowErr } = await supabase
    .from('workflows')
    .select('id, titulo, conta_id, cliente_id')
    .in('id', [WORKFLOW_APROVACAO, WORKFLOW_AGENDAMENTO]);
  if (flowErr) throw flowErr;
  if (!flows || flows.length !== 2) {
    throw new Error(
      `Esperados os fluxos ${WORKFLOW_APROVACAO} e ${WORKFLOW_AGENDAMENTO}, encontrados ${flows?.length ?? 0}. Abortando.`,
    );
  }
  for (const f of flows) {
    if (f.conta_id !== CONTA_ID || f.cliente_id !== CLIENTE_ID) {
      throw new Error(
        `Fluxo ${f.id} não pertence ao cliente ${CLIENTE_ID} do DK TESTE. Abortando.`,
      );
    }
  }

  // canSchedule also requires no account warning, and "no account warning" is a
  // stricter test than authorization_status = 'active'. The UI derives it in
  // WorkflowDrawer.tsx:266-274 and this MUST mirror it exactly:
  //
  //   revoked    = authorization_status === 'revoked'
  //   expired    = authorization_status === 'expired'
  //                OR token_expires_at < now        <-- the one that bites
  //   canPublish = permissions includes 'instagram_business_content_publish'
  //
  // An earlier version of this preflight checked only authorization_status and
  // passed on an account whose token had expired two months earlier. It seeded
  // the rows, and the "enabled Agendar" screenshot would have come out disabled
  // behind a red warning banner: the exact thing this script exists to enable.
  const { data: ig, error: igErr } = await supabase
    .from('instagram_accounts')
    .select('client_id, authorization_status, token_expires_at, permissions')
    .eq('client_id', CLIENTE_ID)
    .maybeSingle();
  if (igErr) throw igErr;

  if (!requirePublishable) return { conta, cliente, flows, ig };

  if (!ig) {
    throw new Error(`Cliente ${CLIENTE_ID} não tem conta de Instagram. Abortando.`);
  }

  const revoked = ig.authorization_status === 'revoked';
  const expired =
    ig.authorization_status === 'expired' ||
    (ig.token_expires_at ? new Date(ig.token_expires_at) < new Date() : false);
  const canPublish =
    Array.isArray(ig.permissions) && ig.permissions.includes('instagram_business_content_publish');

  if (revoked || expired || !canPublish) {
    const motivo = revoked
      ? 'o token foi revogado'
      : expired
        ? `o token expirou em ${String(ig.token_expires_at).slice(0, 10)}`
        : 'falta a permissão instagram_business_content_publish';
    throw new Error(
      `Instagram do cliente ${CLIENTE_ID} não está apto a publicar: ${motivo}.\n` +
        'Com isso o botão Agendar renderiza DESABILITADO, atrás de um aviso vermelho, e as\n' +
        'capturas da seção 7 não servem. Reconecte a conta do cliente pelo CRM (OAuth do\n' +
        'Facebook) e rode de novo. Aproveite para capturar as telas externas ext-13 a ext-15.',
    );
  }

  return { conta, cliente, flows };
}

async function up() {
  const supabase = client();

  if (existsSync(MANIFEST)) {
    throw new Error(
      `Já existe ${MANIFEST}. Rode --down antes de semear de novo, para não duplicar os posts.`,
    );
  }

  const { flows } = await preflight(supabase, { requirePublishable: true });
  console.log('Preflight OK: DK TESTE, Studio Bem-Estar, fluxos 48 e 53, Instagram ativo.\n');

  const rows = POSTS.map((p) => ({
    workflow_id: p.workflow_id,
    conta_id: CONTA_ID,
    titulo: p.titulo,
    tipo: p.tipo,
    status: p.status,
    ordem: p.ordem,
    ig_caption: p.ig_caption,
    platform: 'instagram',
    created_via: 'human',
    scheduled_at:
      p.scheduledInDays != null
        ? new Date(Date.now() + p.scheduledInDays * DAY).toISOString()
        : null,
    // See the 'unclaimable' note on the agendado fixture above. A far-future
    // value makes claim_posts_for_publishing skip the row permanently.
    publish_processing_at: p.unclaimable ? new Date(Date.now() + 3650 * DAY).toISOString() : null,
  }));

  const originalTitle = flows.find((f) => f.id === TITLE_FIX.id)?.titulo ?? null;

  const { data: inserted, error } = await supabase
    .from('workflow_posts')
    .insert(rows)
    .select('id, titulo, status, scheduled_at');
  if (error) throw error;

  // From this line on, production holds fixture rows, one of them a real
  // scheduled publication. --down is the only safe way to remove them and it
  // can only find them through the manifest, so the manifest is written FIRST,
  // before the cosmetic title change, and a failure to write it rolls the
  // insert back rather than stranding the rows.
  //
  // The ids are printed before anything else can fail, so that even a SIGKILL
  // in the next few milliseconds leaves the operator able to clean up by hand.
  console.log('Posts criados:');
  for (const r of inserted) {
    console.log(`  ${r.id}  ${r.status.padEnd(17)} ${r.titulo}`);
  }
  console.log('');

  const postIds = inserted.map((r) => r.id);

  try {
    // .superpowers/ is gitignored, so on a fresh clone or a new worktree it does
    // not exist and writeFileSync cannot create it. Without this the rollback
    // above fires on every first run and --up can never succeed.
    mkdirSync(path.dirname(MANIFEST), { recursive: true });
    writeFileSync(
      MANIFEST,
      JSON.stringify(
        {
          seededAt: new Date().toISOString(),
          contaId: CONTA_ID,
          postIds,
          workflowTitle: { id: TITLE_FIX.id, original: originalTitle },
        },
        null,
        2,
      ),
    );
  } catch (err) {
    const { error: rollbackErr } = await supabase
      .from('workflow_posts')
      .delete()
      .in('id', postIds)
      .eq('conta_id', CONTA_ID);
    if (rollbackErr) {
      throw new Error(
        `Não consegui gravar o manifesto (${err.message}) E a remoção automática também falhou ` +
          `(${rollbackErr.message}). APAGUE ESTES POSTS À MÃO, um deles está agendado: ${postIds.join(', ')}`,
      );
    }
    throw new Error(
      `Não consegui gravar o manifesto (${err.message}). Os posts inseridos foram removidos, ` +
        'nada ficou em produção.',
    );
  }
  console.log(`Manifesto: ${MANIFEST}`);

  // Past this point the manifest exists, so --down can always clean up. A
  // failure here is cosmetic and must not roll back the posts.
  const { error: titleErr } = await supabase
    .from('workflows')
    .update({ titulo: TITLE_FIX.to })
    .eq('id', TITLE_FIX.id)
    .eq('conta_id', CONTA_ID);
  if (titleErr) {
    console.log(
      `\n⚠️  Não consegui renomear o fluxo ${TITLE_FIX.id} (${titleErr.message}).\n` +
        `    O título ainda contém um travessão e vai aparecer nas capturas. Renomeie à mão\n` +
        `    para "${TITLE_FIX.to}" antes de capturar. Os posts foram criados normalmente.`,
    );
  } else {
    console.log(`Fluxo ${TITLE_FIX.id} renomeado: "${originalTitle}" -> "${TITLE_FIX.to}"`);
  }

  const deadline = new Date(Date.now() + TEARDOWN_DEADLINE_DAYS * DAY);
  console.log(
    `\n⚠️  Um post ficou com status 'agendado'. Ele é uma publicação real agendada.\n` +
      `    O cron só o reivindica quando a data chega, então rode --down antes de\n` +
      `    ${deadline.toISOString().slice(0, 10)}. O ideal é rodar assim que as capturas terminarem.`,
  );
}

async function down() {
  const supabase = client();

  if (!existsSync(MANIFEST)) {
    throw new Error(`Não encontrei ${MANIFEST}. Nada a remover, ou o manifesto foi perdido.`);
  }
  const manifest = JSON.parse(readFileSync(MANIFEST, 'utf-8'));
  if (manifest.contaId !== CONTA_ID) {
    throw new Error(
      `Manifesto aponta para o workspace ${manifest.contaId}, não o DK TESTE. Abortando.`,
    );
  }

  await preflight(supabase, { requirePublishable: false });

  // Delete by id AND by conta, so a tampered manifest still cannot reach
  // another workspace's rows.
  const { data: deleted, error } = await supabase
    .from('workflow_posts')
    .delete()
    .in('id', manifest.postIds)
    .eq('conta_id', CONTA_ID)
    .select('id, titulo');
  if (error) throw error;

  // Test against null, not truthiness: an empty original title is a real value
  // that must be restored, and this database does contain empty name strings.
  // A truthiness check would silently leave the fixture title in place forever.
  const originalTitle = manifest.workflowTitle?.original;
  if (originalTitle != null) {
    const { error: titleErr } = await supabase
      .from('workflows')
      .update({ titulo: originalTitle })
      .eq('id', manifest.workflowTitle.id)
      .eq('conta_id', CONTA_ID);
    if (titleErr) throw titleErr;
  }

  unlinkSync(MANIFEST);

  console.log(`Removidos ${deleted.length} post(s):`);
  for (const r of deleted) console.log(`  ${r.id}  ${r.titulo}`);
  if (manifest.postIds.length !== deleted.length) {
    console.log(
      `\n⚠️  O manifesto listava ${manifest.postIds.length} post(s) e ${deleted.length} foram removidos.\n` +
        '    Confira manualmente se sobrou algum post agendado no DK TESTE.',
    );
  }
  console.log('\nFluxo renomeado de volta. Manifesto apagado.');
}

/**
 * Runs every guard and writes nothing. Use this first: it proves the ids still
 * point where this script thinks they do before you authorise any write.
 */
async function check() {
  const supabase = client();
  const { conta, cliente, flows } = await preflight(supabase, { requirePublishable: true });
  console.log('Preflight OK. Nada foi escrito.\n');
  console.log(`  workspace  ${conta.nome} (${conta.id})`);
  console.log(`  cliente    ${cliente.nome} (${cliente.id})`);
  for (const f of flows) console.log(`  fluxo      ${f.id}  ${f.titulo}`);
  console.log(
    `\n  manifesto  ${existsSync(MANIFEST) ? 'JÁ EXISTE, --up vai recusar' : 'ausente, --up pode rodar'}`,
  );
  console.log(`  a semear   ${POSTS.length} post(s), sendo 1 com status 'agendado'`);
}

const mode = process.argv[2];
if (!['--up', '--down', '--check'].includes(mode)) {
  console.error(
    'Uso: node --env-file=.env.kb-upload.local scripts/seed-kb-capture-fixtures.mjs --check|--up|--down\n' +
      '  --check  roda as validações e não escreve nada. Comece por aqui.\n' +
      '  --up     cria os posts de fixture no DK TESTE.\n' +
      '  --down   remove exatamente o que o --up criou.',
  );
  process.exit(1);
}

try {
  if (mode === '--check') await check();
  else if (mode === '--up') await up();
  else await down();
} catch (err) {
  console.error(`\nFalhou: ${err.message}`);
  process.exit(1);
}
