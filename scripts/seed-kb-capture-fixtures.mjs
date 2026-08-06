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
    secao7: true,
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
    secao7: true,
  },
];

// Workflow 53's stored title uses an em-dash, which the house style bans in
// user-facing copy. It would be legible in several screenshots, so --up
// rewrites it and --down restores whatever was there before.
// `from` is the title observed in production on 2026-08-06, kept so teardown can
// undo the rename even when the manifest is gone. Row cleanup already survives a
// lost manifest via findFixtureRows; without this the title restore would not,
// and the cosmetic rename would stick to a real workflow forever with no record
// anywhere of what it used to be. Only ever applied when the current title is
// exactly `to`, so a legitimate rename made in the meantime is never clobbered.
const TITLE_FIX = {
  id: WORKFLOW_AGENDAMENTO,
  from: 'Post Semana 4 — BE',
  to: 'Post Semana 4 · BE',
};

// The titles are the fixture marker. workflow_posts has no free-form provenance
// column that would take a custom value (created_via is CHECK-constrained to
// 'human'/'agent'), so identity comes from the exact title inside the exact two
// fixture workflows of the exact fixture workspace. Nothing else in DK TESTE
// carries these strings.
//
// This makes the rows discoverable in the DATABASE rather than only through the
// local manifest, which closes two gaps the manifest alone cannot:
//   1. A crash between the insert and the manifest write. The manifest is the
//      only record, so --down would refuse and the rows would be stranded.
//   2. A second worktree or clone. .superpowers/ is per-worktree, so its
//      manifest check passes while rows from another run already exist, and
//      whichever operator never runs --down leaves theirs behind.
const FIXTURE_TITLES = POSTS.map((p) => p.titulo);
const FIXTURE_WORKFLOWS = [WORKFLOW_APROVACAO, WORKFLOW_AGENDAMENTO];

/** Every fixture row currently in production, found without the manifest. */
async function findFixtureRows(supabase) {
  const { data, error } = await supabase
    .from('workflow_posts')
    .select('id, titulo, status, workflow_id')
    .eq('conta_id', CONTA_ID)
    .in('workflow_id', FIXTURE_WORKFLOWS)
    .in('titulo', FIXTURE_TITLES);
  if (error) throw error;
  return data ?? [];
}

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

/**
 * @param skipSecao7
 *   Seed only the fixtures that do not depend on a publish-capable Instagram
 *   account. The section 7 pair (the enabled Agendar button and the Agendado
 *   chip) is the only part that needs one, so this lets sections 1 to 6 and 8
 *   be captured while the account's token is expired. Explicit rather than
 *   automatic: silently seeding a subset would look like a full seed and send
 *   someone hunting for screenshots that were never going to appear.
 */
async function up({ skipSecao7 }) {
  const supabase = client();

  if (existsSync(MANIFEST)) {
    throw new Error(
      `Já existe ${MANIFEST}. Rode --down antes de semear de novo, para não duplicar os posts.`,
    );
  }

  const selected = skipSecao7 ? POSTS.filter((p) => !p.secao7) : POSTS;

  const { flows } = await preflight(supabase, { requirePublishable: !skipSecao7 });

  // Ask the database, not just the local manifest. Another worktree may have
  // seeded, or a previous run may have crashed between the insert and the
  // manifest write. Either way, inserting again would duplicate rows that
  // nobody's --down would then fully remove.
  const alreadyThere = await findFixtureRows(supabase);
  if (alreadyThere.length > 0) {
    throw new Error(
      `Já existem ${alreadyThere.length} post(s) de fixture em produção: ` +
        `${alreadyThere.map((r) => r.id).join(', ')}.\n` +
        'Isso acontece quando outra worktree semeou, ou quando um --up anterior morreu\n' +
        'antes de gravar o manifesto. Rode --down (ele encontra essas linhas mesmo sem\n' +
        'manifesto) e semeie de novo.',
    );
  }
  console.log(
    skipSecao7
      ? `Preflight OK (modo parcial). Semeando ${selected.length} post(s), sem a seção 7.\n`
      : 'Preflight OK: DK TESTE, Studio Bem-Estar, fluxos 48 e 53, Instagram apto a publicar.\n',
  );

  const rows = selected.map((p) => ({
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
          // null when partial mode left the title alone, so --down knows there
          // is nothing to restore and cannot clobber a later legitimate rename.
          workflowTitle: skipSecao7 ? null : { id: TITLE_FIX.id, original: originalTitle },
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

  // Only rename when section 7 is actually being seeded. The rename exists so
  // the em-dash in workflow 53's title does not show up in the section 7
  // screenshots; in partial mode nothing is captured there, so renaming would
  // mutate an unrelated workflow for no reason. Worse, --down would later
  // "restore" the title recorded at seed time and silently overwrite any
  // legitimate rename made in between.
  if (!skipSecao7) {
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
  }

  if (skipSecao7) {
    console.log(
      '\nModo parcial: os dois posts da seção 7 (Agendar habilitado e chip Agendado)\n' +
        'NÃO foram criados, porque exigem uma conta de Instagram apta a publicar.\n' +
        'As capturas 29 a 32 ficam de fora desta rodada.',
    );
  } else {
    console.log(
      `\nUm post ficou com status 'agendado'. Ele NÃO pode ser reivindicado pelo cron:\n` +
        `publish_processing_at está 10 anos à frente, o que reprova o predicado do\n` +
        `claim_posts_for_publishing em qualquer data. Ainda assim, rode --down quando as\n` +
        `capturas terminarem: linhas de fixture não devem sobreviver ao seu propósito.`,
    );
  }
  console.log('\nPara remover tudo: --down');
}

async function down() {
  const supabase = client();

  // The manifest is a convenience, not a precondition. Teardown must work when
  // it is missing: a run that died before writing it, or a seed done from a
  // different worktree, would otherwise leave rows nobody can remove with this
  // script. Fixture rows are identifiable in the database on their own.
  let manifest = null;
  if (existsSync(MANIFEST)) {
    manifest = JSON.parse(readFileSync(MANIFEST, 'utf-8'));
    if (manifest.contaId !== CONTA_ID) {
      throw new Error(
        `Manifesto aponta para o workspace ${manifest.contaId}, não o DK TESTE. Abortando.`,
      );
    }
  }

  await preflight(supabase, { requirePublishable: false });

  const discovered = await findFixtureRows(supabase);
  // Union of what this worktree recorded and what is actually there, so a
  // partially recorded run still gets fully cleaned.
  const ids = [...new Set([...(manifest?.postIds ?? []), ...discovered.map((r) => r.id)])];

  if (ids.length === 0) {
    console.log('Nenhum post de fixture encontrado em produção.');
  } else if (!manifest) {
    console.log(
      `Sem manifesto local. Encontrei ${discovered.length} post(s) de fixture pelo título\n` +
        'dentro dos fluxos de fixture do DK TESTE, e vou remover essas linhas.\n',
    );
  }

  // Deliberately NOT an early return when ids is empty. The posts and the title
  // rename are two independent leftovers: a run can leave the rename behind with
  // no posts (partial mode plus a lost manifest, or a --down that removed rows
  // and then died). Returning here would make the title restore unreachable in
  // exactly the case it exists for.
  let deleted = [];
  if (ids.length > 0) {
    // Delete by id AND by conta, so a tampered manifest still cannot reach
    // another workspace's rows.
    const { data, error } = await supabase
      .from('workflow_posts')
      .delete()
      .in('id', ids)
      .eq('conta_id', CONTA_ID)
      .select('id, titulo');
    if (error) throw error;
    deleted = data ?? [];
  }

  // Test against null, not truthiness: an empty original title is a real value
  // that must be restored, and this database does contain empty name strings.
  // A truthiness check would silently leave the fixture title in place forever.
  let originalTitle = manifest?.workflowTitle?.original;
  let fromFallback = false;

  // No manifest, or a manifest that recorded no rename (partial mode). The rename
  // may still be in place from another worktree's run, so check the database the
  // same way row cleanup does. Restoring only when the current title is exactly
  // TITLE_FIX.to means a legitimate rename since the seed is left alone.
  if (originalTitle == null) {
    const { data: flow, error: flowErr } = await supabase
      .from('workflows')
      .select('id, titulo')
      .eq('id', TITLE_FIX.id)
      .eq('conta_id', CONTA_ID)
      .maybeSingle();
    if (flowErr) throw flowErr;
    if (flow?.titulo === TITLE_FIX.to) {
      originalTitle = TITLE_FIX.from;
      fromFallback = true;
    }
  }

  let restored = false;
  if (originalTitle != null) {
    const { error: titleErr } = await supabase
      .from('workflows')
      .update({ titulo: originalTitle })
      .eq('id', TITLE_FIX.id)
      .eq('conta_id', CONTA_ID);
    if (titleErr) throw titleErr;
    restored = true;
  }

  if (existsSync(MANIFEST)) unlinkSync(MANIFEST);

  if (deleted.length > 0) {
    console.log(`Removidos ${deleted.length} post(s):`);
    for (const r of deleted) console.log(`  ${r.id}  ${r.titulo}`);
  }
  if (ids.length !== deleted.length) {
    console.log(
      `\n⚠️  Esperava remover ${ids.length} post(s) e ${deleted.length} foram removidos.\n` +
        '    Confira manualmente se sobrou algum post de fixture no DK TESTE.',
    );
  }
  if (restored && fromFallback) {
    console.log(
      `\nFluxo ${TITLE_FIX.id} estava com o título de fixture e não havia manifesto.\n` +
        `Restaurado para "${TITLE_FIX.from}", o valor observado em produção em 2026-08-06.\n` +
        'Confira se era mesmo esse o título.',
    );
  } else if (restored) {
    console.log('\nFluxo renomeado de volta. Manifesto apagado.');
  } else {
    console.log('\nNenhum título a restaurar. Manifesto apagado.');
  }
}

/**
 * Runs every guard and writes nothing. Use this first: it proves the ids still
 * point where this script thinks they do before you authorise any write.
 */
async function check({ skipSecao7 }) {
  const supabase = client();
  const { conta, cliente, flows } = await preflight(supabase, {
    requirePublishable: !skipSecao7,
  });
  const existing = await findFixtureRows(supabase);
  const selected = skipSecao7 ? POSTS.filter((p) => !p.secao7) : POSTS;

  console.log('Preflight OK. Nada foi escrito.\n');
  console.log(`  workspace  ${conta.nome} (${conta.id})`);
  console.log(`  cliente    ${cliente.nome} (${cliente.id})`);
  for (const f of flows) console.log(`  fluxo      ${f.id}  ${f.titulo}`);
  console.log(`\n  manifesto  ${existsSync(MANIFEST) ? 'JÁ EXISTE, --up vai recusar' : 'ausente'}`);
  console.log(
    `  em prod    ${existing.length} post(s) de fixture` +
      (existing.length > 0 ? ` (${existing.map((r) => r.id).join(', ')}), --up vai recusar` : ''),
  );
  console.log(
    `  a semear   ${selected.length} post(s)` +
      (skipSecao7 ? ', modo parcial, sem a seção 7' : ", sendo 1 com status 'agendado'"),
  );
}

const mode = process.argv[2];
const skipSecao7 = process.argv.includes('--sem-secao-7');
if (!['--up', '--down', '--check'].includes(mode)) {
  console.error(
    'Uso: node --env-file=.env.kb-upload.local scripts/seed-kb-capture-fixtures.mjs --check|--up|--down\n' +
      '  --check  roda as validações e não escreve nada. Comece por aqui.\n' +
      '  --up     cria os posts de fixture no DK TESTE.\n' +
      '  --down   remove exatamente o que o --up criou.\n' +
      '\n' +
      '  --sem-secao-7  (com --up) pula os dois posts que exigem uma conta de\n' +
      '                 Instagram apta a publicar. Use quando o token estiver\n' +
      '                 vencido: libera as capturas das seções 1 a 6 e 8.',
  );
  process.exit(1);
}

try {
  if (mode === '--check') await check({ skipSecao7 });
  else if (mode === '--up') await up({ skipSecao7 });
  else await down();
} catch (err) {
  console.error(`\nFalhou: ${err.message}`);
  process.exit(1);
}
