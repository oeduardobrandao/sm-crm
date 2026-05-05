// Wipe all seeded data from a workspace.
// Usage:
//   node scripts/unseed-demo.mjs              # uses .env (production)
//   node scripts/unseed-demo.mjs --staging    # uses .env.staging
// Relies on ON DELETE CASCADE (workflows → etapas, clientes → instagram_accounts → posts/history).
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

const EMAIL = process.env.SEED_EMAIL ?? env.SEED_EMAIL;
const PASSWORD = process.env.SEED_PASSWORD ?? env.SEED_PASSWORD;

if (!EMAIL || !PASSWORD) {
  console.error('✗ SEED_EMAIL and SEED_PASSWORD must be set in', envFile, 'or as environment variables');
  process.exit(1);
}

console.log(`Using ${envFile} → ${env.VITE_SUPABASE_URL}`);

const supabase = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY, {
  auth: { persistSession: false },
});

const log = (...a) => console.log('·', ...a);

async function main() {
  const { data: auth, error: authErr } = await supabase.auth.signInWithPassword({
    email: EMAIL,
    password: PASSWORD,
  });
  if (authErr) {
    console.error('login failed', authErr);
    process.exit(1);
  }
  const { data: profile } = await supabase
    .from('profiles')
    .select('conta_id')
    .eq('id', auth.user.id)
    .single();
  const contaId = profile.conta_id;
  log('Wiping workspace', contaId);

  // Order: things that don't cascade first, then parents.
  // clientes CASCADE → instagram_accounts → posts/history
  // workflows CASCADE → workflow_etapas, workflow_posts
  await supabase.from('transacoes').delete().eq('conta_id', contaId);
  log('  transacoes');
  await supabase.from('contratos').delete().eq('conta_id', contaId);
  log('  contratos');
  await supabase.from('leads').delete().eq('conta_id', contaId);
  log('  leads');
  await supabase.from('ideias').delete().eq('workspace_id', contaId);
  log('  ideias');
  await supabase.from('hub_briefing_questions').delete().eq('conta_id', contaId);
  log('  hub_briefing_questions');
  await supabase.from('integracoes_status').delete().eq('conta_id', contaId);
  log('  integracoes_status');
  await supabase.from('workflows').delete().eq('conta_id', contaId);
  log('  workflows (+etapas, +posts via cascade)');
  await supabase.from('workflow_templates').delete().eq('conta_id', contaId);
  log('  workflow_templates');
  await supabase.from('client_hub_tokens').delete().eq('conta_id', contaId);
  log('  client_hub_tokens');
  await supabase.from('membros').delete().eq('conta_id', contaId);
  log('  membros');
  await supabase.from('clientes').delete().eq('conta_id', contaId);
  log('  clientes (+instagram_accounts/posts/history via cascade)');

  console.log('\n✓ Unseed complete.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
