import { test } from '@playwright/test';
import { installSafetyNet, assertNoViolations } from './safety';
import { shoot } from './capture';

const SLUG = 'como-conectar-o-instagram';

// Client used for both steps: "App Review - META TEST USER" (clienteId 59), the 5th
// client in this workspace -- NOT one of the four fake personas (Studio Bem-Estar,
// Dr. Rafael Nunes id 41, Dra. Helena Costa, Dra. Marina Pacheco). Verified live
// (browsed as the DK TESTE owner account, 2026-07-17) that all four personas already
// have an Instagram account CONNECTED, just with an EXPIRED token -- their #ig-container
// renders the overview card + "Reconectar" button, never the empty "Conectar Instagram"
// state this article's step 2 needs. "App Review - META TEST USER" is the only client in
// the workspace with no Instagram account at all (igSummary is null), so its
// #ig-container renders exactly the InstagramConnectButton empty state
// (renderInstagramConnectButton, apps/crm/src/components/instagram/InstagramConnectButton.ts):
// h3 "Conectar Instagram" + button "Conectar com o Instagram". This client's name was NOT
// on the brief's "cleared for publication, no redaction needed" list -- flagged in the
// task report for a publish decision, not redacted here.
const CLIENTE_ID = 59;

test.describe.configure({ mode: 'serial' });

test('conectar instagram walkthrough', async ({ page }) => {
  const violations = await installSafetyNet(page);

  // Step 1 -- 'Abra o detalhe do cliente'
  await page.goto(`/clientes/${CLIENTE_ID}`);
  await page
    .getByRole('heading', { name: 'App Review - META TEST USER', level: 2 })
    .waitFor();
  // This client has no Instagram account at all (igSummary is null -- see CLIENTE_ID
  // comment above), so the header avatar renders as a plain colored initials <div>
  // (ClienteDetalhePage.tsx's `igSummary?.account?.profile_picture_url` branch), not an
  // <img> -- confirmed live before writing this spec, so no image-decode wait is needed
  // for this shot.
  await shoot(page, SLUG, 1, 'abrir-detalhe-cliente');

  // Step 2 -- 'Na seção Instagram, clique em Conectar Instagram'
  // Wait for the actual empty-state heading rendered by renderInstagramConnectButton
  // ("Conectar Instagram", h3) -- a concrete signal the imperative IG widget finished
  // mounting, not just that #ig-container exists.
  const connectHeading = page.getByRole('heading', { name: 'Conectar Instagram', level: 3 });
  await connectHeading.waitFor();
  const connectButton = page.getByRole('button', { name: 'Conectar com o Instagram' });
  await connectButton.waitFor();
  await connectButton.scrollIntoViewIfNeeded();
  // NEVER click this button -- it kicks off the real Facebook OAuth flow
  // (getInstagramAuthUrl -> window.location.href = url). Capture resting state only.
  await shoot(page, SLUG, 2, 'conectar-instagram');

  // Fails the run if anything outward-facing was attempted. Must be last.
  assertNoViolations(violations);
});
