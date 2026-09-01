import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { installSafetyNet, assertNoViolations } from './safety';
import { shoot } from './capture';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** AI-generated portrait of the fictional persona "Camila" (Café da Manhã) —
 * no real person. Swapped into avatars during dressing. */
const CAMILA_URI =
  'data:image/jpeg;base64,' +
  readFileSync(path.join(__dirname, 'assets', 'camila.jpg')).toString('base64');

/**
 * Captures the two device screenshots for the landing page hero (option D:
 * MacBook with the CRM + iPhone with the client Hub).
 *
 * Runs against the DK TESTE production workspace like every other capture
 * spec — personas in that workspace are cleared for publication. Read-only:
 * navigations and screenshots, zero writes. The "dressing" page.evaluate
 * blocks rewrite text/numbers in the DOM before the shot so the marketing
 * image reads as a healthy workspace; nothing is persisted.
 *
 * The committed hero assets (public/landing/hero-macbook.webp and
 * hero-iphone.webp) are these captures composited into Apple's official
 * product bezels — MacBook Pro M5 14" Space Black and iPhone 16 Pro Black
 * Titanium, from https://developer.apple.com/design/resources/#product-bezels
 * (Bezel-MacBook-Pro-M5.dmg / Bezel-iPhone-16.dmg, PNG variants). Viewports
 * below match each bezel's screen hole exactly (1512x982@2x and 402x874@3x),
 * so compositing is: mask the screenshot to the bezel's transparent screen
 * hole (flood fill on the alpha channel from the center), paste it behind,
 * overlay the bezel, trim, downscale (1560w / 560w), cwebp -q 85.
 */

const SLUG = 'landing-hero';

test.describe.configure({ mode: 'serial' });

test('macbook: crm entregas (dressed)', async ({ page }) => {
  const violations = await installSafetyNet(page);

  // Match the Apple MacBook Pro 14" bezel's screen panel (1512x982 pt).
  await page.setViewportSize({ width: 1512, height: 982 });
  await page.goto('/entregas');
  await page.locator('nav#sidebar').waitFor();
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(2000);
  const fechar = page.getByRole('button', { name: 'Fechar explicação' });
  if (await fechar.isVisible().catch(() => false)) await fechar.click();
  await page.waitForTimeout(500);
  // The multi-etapa board lives under the "Produção de Conteúdo" template group.
  await page
    .locator('button, [role="tab"]')
    .filter({ hasText: /produção de conteúdo/i })
    .first()
    .click();
  await page.waitForTimeout(1200);

  // Marketing dressing: anonymize every name and neutralize overdue markers so
  // the shot reads as a healthy, fictional workspace. Screenshot-only —
  // nothing is persisted anywhere.
  await page.evaluate((camila) => {
    const RENAMES: Array<[RegExp, string]> = [
      [/Dra\. Marina Pacheco/g, 'Bella Moda'],
      [/Dr\. Rafael Nunes/g, 'Café da Manhã'],
      [/Dra\. Helena Costa/g, 'Clínica Raiz'],
      [/Studio Bem-Estar/g, 'Studio Vilma'],
      [/Débora Kristin|Test User/g, 'Ana Ribeiro'],
      [/Campanha Abril — Posts \+ Reels/g, 'Campanha de Setembro'],
      [/Lançamento Procedimento/g, 'Novo cardápio de inverno'],
      [/Série Educativa — Reels/g, 'Série Educativa em Reels'],
      [/\s—\s(?:MP|HC|RN|BE|VP)\b/g, ''],
      [/iniciada em .+/g, 'iniciada em 28 de ago.'],
      [/\s*[·•]\s*9 atrasados/g, ''],
    ];
    const INITIALS: Record<string, string> = { DM: 'BM', DH: 'CR', SB: 'SV', DK: 'AR', TU: 'AR' };
    const tw = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    const textNodes: Text[] = [];
    for (let n = tw.nextNode(); n; n = tw.nextNode()) textNodes.push(n as Text);
    for (const n of textNodes) {
      let t = n.textContent ?? '';
      for (const [re, to] of RENAMES) t = t.replace(re, to);
      const trimmed = t.trim();
      if (INITIALS[trimmed]) t = t.replace(trimmed, INITIALS[trimmed]);
      if (t !== n.textContent) n.textContent = t;
    }

    const walk = (fn: (el: HTMLElement) => void) =>
      document.querySelectorAll<HTMLElement>('body *').forEach(fn);

    // Red overdue counter in the header ("· 9 atrasados"), stale start dates,
    // and danger-red progress bars.
    walk((el) => {
      const t = el.textContent?.trim() ?? '';
      if (el.children.length === 0 && (/atrasados$/.test(t) || /^[·•]$/.test(t)))
        el.style.display = 'none';
      if (el.children.length === 0 && /^iniciada/.test(t))
        el.textContent = 'iniciada em 28 de ago.';
      const bg = getComputedStyle(el).backgroundColor;
      const rgb = /^rgba?\((\d+), (\d+), (\d+)/.exec(bg);
      if (rgb && +rgb[1] > 190 && +rgb[2] < 130 && +rgb[3] < 130) {
        el.style.background = '#3ecf8e';
        el.style.backgroundImage = 'none';
      }
    });

    // Overdue pills on cards → friendly due-date labels
    const due = ['entrega sex', 'entrega qui', 'entrega 12/09', 'entrega 15/09', 'entrega ter'];
    let di = 0;
    walk((el) => {
      if (el.children.length === 0 && /^\d+d atrasado$/.test(el.textContent?.trim() ?? '')) {
        el.textContent = due[di++ % due.length];
        el.style.background = '#f1f5f9';
        el.style.color = '#374151';
      }
    });

    // Hide the empty "Roteiro" column so the frame fills with busy columns
    walk((ph) => {
      if (ph.children.length !== 0 || ph.textContent?.trim() !== 'Nenhuma entrega') return;
      let col: HTMLElement = ph;
      while (col.parentElement && col.parentElement.offsetWidth <= 600) col = col.parentElement;
      col.style.display = 'none';
    });

    // Tiny avatar photos: Camila's generated portrait for Café da Manhã,
    // plain brand-colored dots elsewhere (anonymized)
    document.querySelectorAll<HTMLImageElement>('main img, nav img').forEach((img) => {
      if (img.clientWidth > 0 && img.clientWidth <= 48 && img.clientHeight <= 48) {
        const chipText = img.parentElement?.parentElement?.textContent ?? '';
        if (chipText.includes('Café da Manhã')) {
          img.src = camila;
          img.style.objectFit = 'cover';
          return;
        }
        const dot = document.createElement('span');
        dot.style.cssText = `display:inline-block;width:${img.clientWidth}px;height:${img.clientHeight}px;border-radius:9999px;background:#FFBF30;flex-shrink:0`;
        img.replaceWith(dot);
      }
    });
  }, CAMILA_URI);
  await page.waitForTimeout(600);
  await shoot(page, SLUG, 1, 'crm-dashboard');

  // Dark variant: the CRM theme is pure CSS keyed off data-theme, so flipping
  // the attribute is enough; re-tint the inline-styled due pills for dark.
  await page.evaluate(() => {
    document.documentElement.setAttribute('data-theme', 'dark');
    document.querySelectorAll<HTMLElement>('body *').forEach((el) => {
      if (el.children.length === 0 && /^entrega /.test(el.textContent?.trim() ?? '')) {
        el.style.background = 'rgba(255,255,255,.08)';
        el.style.color = '#9ca3af';
      }
    });
  });
  await page.waitForTimeout(600);
  await shoot(page, SLUG, 3, 'crm-dashboard-dark');

  assertNoViolations(violations);
});

test('iphone: client hub (Dr. Rafael Nunes)', async ({ page, browser }) => {
  const violations = await installSafetyNet(page);

  // Cliente 41 (Dr. Rafael Nunes) has an ACTIVE hub token (see hub.spec.ts).
  // Read the hub URL straight from the client detail page instead of touching
  // the database.
  await page.goto('/clientes/41/hub');
  await page.getByRole('heading', { name: 'Dr. Rafael Nunes' }).first().waitFor();
  const hubUrlText = await page.locator('text=/\\/hub\\/[A-Za-z0-9_-]+/').first().innerText();
  const match = /(\/[^\s/]+\/hub\/[A-Za-z0-9_-]+)/.exec(hubUrlText);
  expect(match, `could not extract hub path from: ${hubUrlText}`).toBeTruthy();
  const hubPath = match![1];
  assertNoViolations(violations);

  // Match the Apple iPhone 16 Pro bezel's screen panel (402x874 pt).
  const context = await browser.newContext({
    viewport: { width: 402, height: 874 },
    deviceScaleFactor: 3,
    isMobile: true,
    hasTouch: true,
    colorScheme: 'light',
    baseURL: process.env.HUB_BASE_URL || 'http://localhost:5175',
  });
  const hubPage = await context.newPage();
  const hubViolations = await installSafetyNet(hubPage);

  const loadHub = async () => {
    await hubPage.goto(hubPath);
    await hubPage.locator('main.hub-noise').waitFor({ timeout: 20_000 });
    await hubPage.waitForLoadState('networkidle');
    await hubPage.waitForTimeout(2500);
    await dressHub();
    await hubPage.waitForTimeout(600);
  };

  // Marketing dressing: same text-only DOM rewrites as the CRM shot.
  const dressHub = async () =>
    hubPage.evaluate((camila) => {
      // Simulated iOS safe area so the bezel's Dynamic Island doesn't cover the
      // Hub header in the composited shot.
      const st = document.createElement('style');
      st.textContent = 'body{padding-top:58px} header{top:58px!important}';
      document.head.appendChild(st);
      // Paint the safe-area strip with the hub's own background (dark or light)
      const hubRoot = document.querySelector('.hub-root');
      const rootBg = hubRoot ? getComputedStyle(hubRoot).backgroundColor : '';
      if (rootBg && rootBg !== 'rgba(0, 0, 0, 0)') document.body.style.background = rootBg;
      const leaves = Array.from(document.querySelectorAll<HTMLElement>('main *, header *')).filter(
        (el) => el.children.length === 0,
      );
      const setKpi = (labelText: string, value: string, sub?: string) => {
        const label = leaves.find((el) => el.textContent?.trim() === labelText);
        if (!label) return;
        // Climb until we reach the container that also holds the value leaf.
        let card: HTMLElement | null = label.parentElement;
        let valueEl: HTMLElement | undefined;
        while (card && !valueEl) {
          const cardLeaves = Array.from(card.querySelectorAll<HTMLElement>('*')).filter(
            (el) => el.children.length === 0,
          );
          valueEl = cardLeaves.find((el) => /^(0|—|--|-)$/.test(el.textContent?.trim() ?? ''));
          if (valueEl) {
            valueEl.textContent = value;
            if (sub) {
              const subEl = cardLeaves.find((el) =>
                ['Tudo em dia', 'Nada agendado'].includes(el.textContent?.trim() ?? ''),
              );
              if (subEl) subEl.textContent = sub;
            }
            return;
          }
          card = card.parentElement;
        }
      };
      // Anonymize: fictional agency brand + fictional client, no real photos.
      document.querySelectorAll<HTMLElement>('body *').forEach((el) => {
        if (el.children.length === 0 && el.textContent?.trim() === 'DK TESTE')
          el.textContent = 'Aura Social';
        if (el.children.length === 0 && el.textContent?.trim() === 'D') el.textContent = 'A';
        if (el.children.length === 0 && el.textContent?.trim() === 'Dr.') el.textContent = 'Camila';
        if (el.children.length === 0 && el.textContent?.trim() === 'Dr. Rafael Nunes')
          el.textContent = 'Café da Manhã';
      });
      // Client avatar photo → Camila's generated portrait
      document.querySelectorAll<HTMLImageElement>('main img').forEach((img) => {
        if (img.clientWidth >= 60) {
          img.src = camila;
          img.style.objectFit = 'cover';
        }
      });
      setKpi('Posts este mês', '14');
      setKpi('Aprovações pendentes', '2', '2 aguardando seu OK');
      setKpi('Taxa de aprovação', '96%');
      setKpi('Próximo post', 'Qui · 18:00', 'Reels · Cardápio de inverno');
    }, CAMILA_URI);

  await loadHub();
  await shoot(hubPage, SLUG, 2, 'hub-rn-home');

  // Dark variant: the Hub resolves its whitelabel tokens on mount from the
  // stored theme, so seed localStorage and reload instead of just flipping
  // the attribute.
  await hubPage.evaluate(() => {
    localStorage.setItem('hub-theme', 'dark');
    localStorage.setItem('hub-theme-explicit', '1');
  });
  await loadHub();
  await shoot(hubPage, SLUG, 4, 'hub-rn-home-dark');

  assertNoViolations(hubViolations);
  await context.close();
});
