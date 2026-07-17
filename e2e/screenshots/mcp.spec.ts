import { test } from '@playwright/test';
import { installSafetyNet, assertNoViolations } from './safety';
import { shoot } from './capture';

const SLUG = 'como-conectar-o-claude-mcp';

// This article has two connection methods (connector, no key vs. API key). Only the
// Mesaas-side screens are captured here -- the Claude-side connector dialog in claude.ai
// is captured manually by the user (out of scope for this spec).
//
// Gating check (verified live, 2026-07-17, DK TESTE owner account): /configuracao/mcp
// rendered the full "Como conectar" / "Conexões Claude" / "Chaves de API" UI, not
// FeatureGate's upgrade-nudge fallback (apps/crm/src/components/paywall/FeatureGate.tsx)
// -- feature_mcp is enabled on this workspace, so no gating workaround was needed.

test.describe.configure({ mode: 'serial' });

test('claude mcp connection walkthrough', async ({ page }) => {
  const violations = await installSafetyNet(page);

  // Shot 1 -- 'Onde encontrar' + the connector method's 'copie a URL do MCP'.
  // MCP_URL (IntegracoesClaudePage.tsx:33) is `${VITE_SUPABASE_URL}/functions/v1/mcp` --
  // a generic edge-function endpoint, the same for every workspace. Per-workspace
  // identity is established AFTER connecting (bearer token or OAuth grant), never
  // embedded in this URL, so it's safe to show unmasked.
  await page.goto('/configuracao/mcp');
  await page.getByRole('heading', { name: 'Claude (MCP)', level: 1 }).waitFor();
  // Wait for the Chaves de API card's own heading (not just the page title) so the
  // FeatureGate branch has definitely resolved to the real UI, not a transient loading
  // state that could still flip to the upgrade nudge.
  await page.getByRole('heading', { name: 'Chaves de API' }).waitFor();
  await shoot(page, SLUG, 1, 'pagina-mcp');

  // Shot 2 -- the API-key method's step 1-2: name field + the 'Permissões (escopos)'
  // checkboxes.
  //
  // CREDENTIAL SAFETY: capture the form BEFORE submitting. Never click "Criar chave"
  // (createMutation, IntegracoesClaudePage.tsx) -- that mints a real, working
  // mesaas_sk_... credential for this production workspace, which a support-article
  // screenshot would then leak to every reader. Fill the Name field with the article's
  // own example text ("Agente de conteúdo", supabase/migrations/
  // 20260624000002_seed_kb_mcp_articles.sql:132) and leave the default scopes as-is --
  // the dialog opens with AGENT_PRESET pre-checked (4 read scopes: Clientes, Posts,
  // Fluxos, Ideias/Pautas) and the 4 write/generate scopes unchecked (verified live: 8
  // checkboxes total, 4 checked + 4 unchecked) -- exactly what a new user sees. Then
  // Cancel, never Criar chave.
  await page.getByRole('button', { name: 'Criar chave' }).click();
  await page.getByRole('heading', { name: 'Criar chave de API' }).waitFor();
  const nameInput = page.getByPlaceholder('Ex: Agente de conteúdo');
  await nameInput.fill('Agente de conteúdo');
  await shoot(page, SLUG, 2, 'criar-chave');
  await page.getByRole('button', { name: 'Cancelar' }).click();
  await page.getByRole('heading', { name: 'Criar chave de API' }).waitFor({ state: 'hidden' });

  // Shot 3 -- 'Gerenciar e revogar acesso': the Conexões Claude card + the Chaves de API
  // list underneath it.
  //
  // This workspace has zero active OAuth connector grants right now (verified live,
  // 2026-07-17: "Nenhuma conexão ativa") -- there is no in-app control on this page to
  // create one; a grant is only created via claude.ai's own consent flow, which is
  // explicitly out of scope for this spec (see file header) -- so per the task brief's
  // "prefer creating nothing" rule, this captures the honest current state: the Conexões
  // Claude card's empty state, plus the Chaves de API list below it. That list already
  // contains 5 REVOKED keys left over from earlier engineering work (e2e-v2-scratch*,
  // estudio-smoke-TEMP) -- each row shows only a 4-character token_suffix (e.g.
  // "...53da", McpKey.token_suffix) and a "revogada" label, never a full mesaas_sk_...
  // value -- which doubles as a real illustration of the "revogar individualmente"
  // outcome the article describes, with zero writes performed by this spec.
  const connectionsHeading = page.getByRole('heading', { name: 'Conexões Claude' });
  await connectionsHeading.evaluate((el) => el.scrollIntoView({ block: 'start' }));
  await page.getByText('Nenhuma conexão ativa').waitFor();
  await page.getByText('revogada').first().waitFor();
  await shoot(page, SLUG, 3, 'conexoes');

  // Fails the run if anything outward-facing was attempted. Must be last.
  assertNoViolations(violations);
});
