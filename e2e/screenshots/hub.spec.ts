import { test } from '@playwright/test';
import { installSafetyNet, assertNoViolations } from './safety';
import { shoot } from './capture';

const SLUG = 'como-configurar-o-hub-do-cliente';

// Client used to represent all 5 steps: Dr. Rafael Nunes, one of the four fake personas
// cleared for publication (App Review - META TEST USER is the 5th client in this
// workspace but is not one of the four personas). Verified live (browsed as the DK TESTE
// owner account, 2026-07-17) that clienteId 41 already has an ACTIVE Hub token
// (client_hub_tokens.is_active = true, expires 16/07/2027, well outside the <=30-day
// "Estender +1 ano" rescue window) -- so steps 3-5 capture the EXISTING active-access
// cluster (Ativar/Preview/Copiar/Desativar) with ZERO writes, per the task brief's strong
// preference. No persona's Hub was activated, deactivated, or rotated by this spec.
const CLIENTE_ID = 41;

test.describe.configure({ mode: 'serial' });

test('hub do cliente walkthrough', async ({ page, context }) => {
  const violations = await installSafetyNet(page);

  // Step 1 -- 'Abra o detalhe do cliente'
  await page.goto(`/clientes/${CLIENTE_ID}`);
  await page.getByRole('heading', { name: 'Dr. Rafael Nunes', level: 2 }).waitFor();
  // This client has no Instagram profile picture connected, so the header avatar renders
  // as a plain colored initials <div> (ClienteDetalhePage.tsx's
  // `igSummary?.account?.profile_picture_url` branch), not an <img> -- confirmed against
  // the live DOM before writing this spec, so no image-decode wait is needed for this
  // shot (cf. Post Express's Step 4, which needs one because that client's preview DOES
  // render an <img>).
  await shoot(page, SLUG, 1, 'abrir-detalhe-cliente');

  // Step 2 -- 'Vá até a seção Hub do Cliente'
  const hubHeading = page.getByRole('heading', { name: 'Hub do Cliente', level: 3 });
  await hubHeading.scrollIntoViewIfNeeded();
  // Wait for the Acesso tab's own content (the default tab) to actually be present, not
  // just the card title -- confirms the section itself, not only its header, is in view.
  await page.getByRole('heading', { name: 'Acesso do Cliente' }).waitFor();
  await shoot(page, SLUG, 2, 'ir-para-hub-do-cliente');

  // Step 3 -- 'Ative o Hub para gerar ou reativar o link'
  // This client's Hub is already active (see CLIENTE_ID comment above), so there is
  // nothing to click -- the honest capture of this step IS the already-active cluster.
  // "Desativar" only renders when tokenData.is_active === true (HubTab.tsx), so waiting
  // for it is a concrete assertion of that state, not a guess. Hover it (never click --
  // clicking would really deactivate this client's Hub) to give the shot a natural point
  // of visual focus.
  const desativarButton = page.getByRole('button', { name: 'Desativar' });
  await desativarButton.waitFor();
  await desativarButton.hover();
  await shoot(page, SLUG, 3, 'hub-ja-ativo');

  // Step 4 -- 'Use visualizar para conferir a experiência antes de enviar'
  // Preview calls openExternalUrl(hubUrl) -> window.open(url, '_blank') (HubTab.tsx),
  // where hubUrl is built from window.location.origin -- the CRM's own origin. That's
  // correct in production (vercel.json rewrites both apps onto one domain), but in this
  // local/e2e setup the CRM (baseURL, port 5173) and Hub (port 5175) are two separate dev
  // servers started by this harness's own webServer config (playwright.config.ts) -- so
  // the popup's URL is right on *path* but wrong on *origin*. Verified live: clicking
  // Preview opens a popup that 404s through the CRM's own catch-all route (App.tsx:
  // `<Route path="*" element={<Navigate to="/login" replace />} />`). Capturing that
  // popup as-is would be a dishonest "broken" screenshot of a control that works
  // correctly in production. Compensation: click the real button (so the actual control
  // is exercised end to end), then correct only the *origin* of the resulting popup to
  // the Hub dev server -- the path (workspace slug + token) still comes entirely from the
  // app's own click, nothing is hardcoded here.
  const popupPromise = page.waitForEvent('popup');
  await page.getByRole('button', { name: 'Preview' }).click();
  const popup = await popupPromise;
  const popupViolations = await installSafetyNet(popup);
  await popup.waitForLoadState('domcontentloaded');
  const brokenUrl = new URL(popup.url());
  const hubBaseUrl = process.env.HUB_BASE_URL || 'http://localhost:5175';
  await popup.goto(`${hubBaseUrl}${brokenUrl.pathname}`);
  // main.hub-noise is the Hub shell's own "loaded" marker (see e2e/hub/smoke.spec.ts).
  await popup.locator('main.hub-noise').waitFor();
  // This client has no posts, Instagram data, or brand logo, so the Home view renders as
  // text-only empty states -- confirmed live (zero <img> elements on the page) -- so
  // there is no image to poll for decode here, only real rendered text to wait on.
  await popup.getByText('Desempenho', { exact: true }).waitFor();
  await shoot(popup, SLUG, 4, 'visualizar-preview');
  await popup.close();
  violations.push(...popupViolations);

  // Step 5 -- 'Copie o link e compartilhe com o cliente por e-mail, WhatsApp ou canal
  // combinado' -- captured as clicking Copiar (clipboard-only, harmless per the task
  // brief) and the resulting confirmation. NEVER an email/WhatsApp send -- no such
  // control exists in this UI.
  // navigator.clipboard.writeText needs an explicit grant under Chromium/CDP, or the
  // promise rejects silently and the "Link copiado!" toast (HubTab.tsx's copyLink) never
  // fires.
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.getByRole('button', { name: 'Copiar' }).click();
  await page.getByText('Link copiado!').waitFor();
  await shoot(page, SLUG, 5, 'copiar-link');

  // Fails the run if anything outward-facing was attempted. Must be last.
  assertNoViolations(violations);
});
