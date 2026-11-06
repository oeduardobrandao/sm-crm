import { test, expect } from '@playwright/test';
import type { Page, Route } from '@playwright/test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { installSafetyNet, assertNoViolations } from './safety';
import { shoot } from './capture';

/**
 * Phone screenshots for the nurture e-mails (public/email/nurture-*.jpg).
 *
 * Same rules as landing-hero.spec.ts: the DK TESTE production workspace,
 * read-only navigation, nothing persisted. Two anonymization mechanisms:
 *
 * - CRM screens: the landing's DOM dressing (fictional names, agency "Aura
 *   Social"), plus a self-check that no real name survives into the frame.
 * - Hub screens: the test client's Hub has no posts, so hub-bootstrap is
 *   rewritten and hub-posts is answered with fictional fixture posts for
 *   "Café da Manhã" (tiles in assets/nurture/, generated with PIL: text on a
 *   gradient, no real client content). Data URIs, so nothing leaves the page.
 *
 * Viewport 390x844@2x (a common phone). Composition for the e-mail (crop,
 * rounded corners, JPEG) is done afterwards by
 * scripts/build-nurture-email-images.py.
 *
 * Run: CAPTURE_SCREENSHOTS=1 CRM_DEV_COMMAND="npm run dev:env" \
 *   HUB_DEV_COMMAND="node scripts/with-env.mjs npx vite --config apps/hub/vite.config.ts --port 5175 --strictPort" \
 *   npx playwright test --project=screenshots e2e/screenshots/nurture-emails.spec.ts
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SLUG = 'nurture-emails';
const asset = (rel: string, mime: string) =>
  `data:${mime};base64,` + readFileSync(path.join(__dirname, 'assets', rel)).toString('base64');
const CAMILA = asset('camila.jpg', 'image/jpeg');
const TILES = [1, 2, 3, 4].map((i) => asset(`nurture/post${i}.jpg`, 'image/jpeg'));

test.use({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 2,
  isMobile: true,
  hasTouch: true,
});
test.describe.configure({ mode: 'serial', timeout: 120_000 });

async function quietPopups(page: Page) {
  await page.route('**/rest/v1/global_popups*', (r) => r.fulfill({ json: [] }));
  await page.route('**/rest/v1/global_banners*', (r) => r.fulfill({ json: [] }));
}

const REAL_NAMES = [
  'DK TESTE',
  'Test User',
  'Débora Kristin',
  'Dra. Marina Pacheco',
  'Dr. Rafael Nunes',
  'Dra. Helena Costa',
  'Studio Bem-Estar',
  'App Review',
  'Eduardo',
];

async function dressCrm(page: Page) {
  await page.evaluate(() => {
    const RENAMES: Array<[RegExp, string]> = [
      [/Dra\. Marina Pacheco/g, 'Bella Moda'],
      [/Dr\. Rafael Nunes/g, 'Café da Manhã'],
      [/Dra\. Helena Costa/g, 'Clínica Raiz'],
      [/Studio Bem-Estar/g, 'Studio Vilma'],
      [/Débora Kristin|Test User/g, 'Ana Ribeiro'],
      [/App Review - META TEST USER/g, 'Clínica Vida Plena'],
      [/^Eduardo$/g, 'Padaria Trigo'],
      [/DK TESTE/g, 'Aura Social'],
    ];
    const INITIALS: Record<string, string> = {
      DM: 'BM',
      DH: 'CR',
      DR: 'CM',
      SB: 'SV',
      AR: 'VP',
      E: 'PT',
    };
    const tw = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    const nodes: Text[] = [];
    for (let n = tw.nextNode(); n; n = tw.nextNode()) nodes.push(n as Text);
    for (const n of nodes) {
      let t = n.textContent ?? '';
      for (const [re, to] of RENAMES) t = t.replace(re, to);
      const trimmed = t.trim();
      if (INITIALS[trimmed] && (n.parentElement?.clientWidth ?? 99) <= 48)
        t = t.replace(trimmed, INITIALS[trimmed]);
      if (t !== n.textContent) n.textContent = t;
    }
  });
  await page.waitForTimeout(300);
}

async function assertAnonymous(page: Page, names: string[]) {
  const text = await page.evaluate(() => document.body.innerText);
  for (const name of names) expect(text, `real name "${name}" in frame`).not.toContain(name);
}

test('crm: clientes (a1)', async ({ page }) => {
  const violations = await installSafetyNet(page);
  await quietPopups(page);
  await page.goto('/clientes');
  await page.getByText('Studio Bem-Estar').first().waitFor();
  await page.waitForTimeout(1500);
  await dressCrm(page);
  await assertAnonymous(page, REAL_NAMES);
  await shoot(page, SLUG, 1, 'crm-clientes');
  assertNoViolations(violations);
});

// ---------- Hub ----------

function hoursFromNow(h: number) {
  const d = new Date(Date.now() + h * 3600_000);
  d.setMinutes(0, 0, 0);
  return d.toISOString();
}

const POSTS = [
  { titulo: 'Chocolate quente da casa', tipo: 'feed', h: 26 },
  { titulo: 'Pão de queijo recheado', tipo: 'feed', h: 50 },
  { titulo: 'Nossa torra de quinta', tipo: 'carrossel', h: 74 },
  { titulo: 'Café com bolo em dobro', tipo: 'feed', h: 98 },
].map((p, i) => {
  const media = {
    id: 9000 + i,
    post_id: 8000 + i,
    kind: 'image' as const,
    mime_type: 'image/jpeg',
    url: TILES[i],
    thumbnail_url: TILES[i],
    width: 1080,
    height: 1350,
    duration_seconds: null,
    is_cover: true,
    sort_order: 0,
    media_lost_at: null,
  };
  return {
    id: 8000 + i,
    titulo: p.titulo,
    tipo: p.tipo,
    platform: 'instagram',
    targets: ['instagram'],
    ig_collaborators: [],
    status: 'enviado_cliente',
    ordem: i,
    conteudo: null,
    conteudo_plain: '',
    scheduled_at: hoursFromNow(p.h),
    ig_caption: `${p.titulo}. Passa aqui e prova.`,
    instagram_permalink: null,
    tiktok_caption: null,
    geral_caption: null,
    published_at: null,
    publish_error: null,
    workflow_id: null,
    workflow_titulo: null,
    workflow_created_at: null,
    media: [media],
    cover_media: media,
    pending_suggestion: null,
    suggestion_rejected_at: null,
    em_producao: null,
  };
});

async function fakeHub(page: Page) {
  await page.route('**/functions/v1/hub-bootstrap*', async (route: Route) => {
    const res = await route.fetch();
    const json = await res.json();
    json.workspace = { ...json.workspace, name: 'Aura Social', logo_url: null };
    json.cliente_nome = 'Café da Manhã';
    json.cliente_foto_url = CAMILA;
    await route.fulfill({ response: res, json });
  });
  await page.route('**/functions/v1/hub-posts*', (route) =>
    route.fulfill({
      json: {
        posts: POSTS,
        postApprovals: [],
        mediaNotes: [],
        propertyValues: [],
        workflowSelectOptions: [],
        instagramProfile: { username: 'cafedamanha', profilePictureUrl: CAMILA },
        autoPublishOnApproval: false,
        olderCursor: null,
        historyCutoff: null,
      },
    }),
  );
  await page.route('**/functions/v1/hub-instagram-feed*', (route) =>
    route.fulfill({ status: 404, json: { error: 'not_found' } }),
  );
}

const HUB_REAL = ['DK TESTE', 'Dra. Marina', 'Marina Pac', 'Dr. Rafael', 'Helena'];

test('hub: home, aprovações, post, relatórios (a2, b2, a3, b1, b3)', async ({ page }) => {
  const hubPath = process.env.E2E_HUB_PATH!;
  const violations = await installSafetyNet(page);
  await fakeHub(page);

  await page.goto(`http://localhost:5175${hubPath}`);
  await page.locator('main.hub-noise').waitFor();
  await page.waitForTimeout(2500);
  // Greeting uses the client's first word ("Olá, Café"): greet the persona instead,
  // and fill the approval-rate KPI the fixture cannot derive (no approval history).
  await page.evaluate(() => {
    const em = [...document.querySelectorAll('h1 em')].find((e) => e.textContent === 'Café');
    if (em) em.textContent = 'Camila';
    const tw = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let n = tw.nextNode(); n; n = tw.nextNode()) {
      const card = n.parentElement?.closest('div');
      if (
        n.textContent?.trim() === '—' &&
        card?.parentElement?.textContent?.includes('Taxa de aprovação')
      )
        n.textContent = '96%';
    }
  });
  await assertAnonymous(page, HUB_REAL);
  await shoot(page, SLUG, 2, 'hub-home');

  await page.goto(`http://localhost:5175${hubPath}/aprovacoes`);
  await page.getByText('Chocolate quente da casa').first().waitFor();
  await page.waitForTimeout(2000);
  await assertAnonymous(page, HUB_REAL);
  await shoot(page, SLUG, 3, 'hub-aprovacoes');

  await page.getByText('Chocolate quente da casa').first().click();
  await page.waitForTimeout(2000);
  // The media-notes chips ("Comentar") sit over the artwork; hide them for the shot.
  await page.evaluate(() => {
    document.querySelectorAll('button').forEach((b) => {
      if (/^Comentar/.test(b.textContent?.trim() ?? '')) b.style.visibility = 'hidden';
    });
  });
  await assertAnonymous(page, HUB_REAL);
  await shoot(page, SLUG, 4, 'hub-post');

  await page.goto(`http://localhost:5175${hubPath}/relatorios`);
  await page.waitForTimeout(3000);
  await assertAnonymous(page, HUB_REAL);
  await shoot(page, SLUG, 5, 'hub-relatorios');

  assertNoViolations(violations);
});
