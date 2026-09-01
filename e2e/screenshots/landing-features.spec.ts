import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { installSafetyNet, assertNoViolations } from './safety';
import { shoot } from './capture';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CAMILA_URI =
  'data:image/jpeg;base64,' +
  readFileSync(path.join(__dirname, 'assets', 'camila.jpg')).toString('base64');

/**
 * Captures the real-app screenshots for the landing page features section
 * (public/landing/feat-*.webp). Same rules as landing-hero.spec.ts: DK TESTE
 * production workspace, read-only navigation, text-only DOM dressing before
 * the shot — nothing is persisted. Shots at 1512x982@2x, light theme (the
 * feature cards on the landing are light-only), later cropped to the content
 * region by the compositing step.
 */

const SLUG = 'landing-features';

test.describe.configure({ mode: 'serial' });

/** Shared anonymization pass (same fictional names as landing-hero.spec.ts). */
async function dressCrm(page: Page) {
  await page.evaluate((camila) => {
    const RENAMES: Array<[RegExp, string]> = [
      [/Dra\. Marina Pacheco/g, 'Bella Moda'],
      [/Dr\. Rafael Nunes/g, 'Café da Manhã'],
      [/Dra\. Helena Costa/g, 'Clínica Raiz'],
      [/Studio Bem-Estar/g, 'Studio Vilma'],
      [/Débora Kristin|Test User/g, 'Ana Ribeiro'],
      [/App Review - META TEST USER/g, 'Clínica Vida Plena'],
      [/oeduardobrandao/g, 'cafedamanhaoficial'],
      [/drahelenacosta/g, 'clinicaraiz'],
      [/dramarinapache\w*/g, 'bellamoda.oficial'],
      [/studiobemestar/g, 'studiovilma'],
      [/Campanha Abril — Posts \+ Reels/g, 'Campanha de Setembro'],
      [/Lançamento Procedimento/g, 'Novo cardápio de inverno'],
      [/Série Educativa — Reels/g, 'Série Educativa em Reels'],
      [/\s—\s(?:MP|HC|RN|BE|VP)\b/g, ''],
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
    // Small avatar photos → Camila for Café da Manhã, brand dots elsewhere
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
  await page.waitForTimeout(400);
}

test('crm: entregas (board produção de conteúdo)', async ({ page }) => {
  const violations = await installSafetyNet(page);
  await page.setViewportSize({ width: 1100, height: 860 });

  await page.goto('/entregas');
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(2000);
  const fechar = page.getByRole('button', { name: 'Fechar explicação' });
  if (await fechar.isVisible().catch(() => false)) await fechar.click();
  await page.waitForTimeout(500);
  await page
    .locator('button, [role="tab"]')
    .filter({ hasText: /produção de conteúdo/i })
    .first()
    .click();
  await page.waitForTimeout(1200);
  await dressCrm(page);

  // Board-specific dressing: neutralize overdue markers, hide the empty
  // Roteiro column, refresh stale dates. Screenshot-only.
  await page.evaluate(() => {
    const walk = (fn: (el: HTMLElement) => void) =>
      document.querySelectorAll<HTMLElement>('body *').forEach(fn);
    const due = ['entrega sex', 'entrega qui', 'entrega 12/09', 'entrega 15/09', 'entrega ter'];
    let di = 0;
    walk((el) => {
      const t = el.textContent?.trim() ?? '';
      if (el.children.length === 0 && (/atrasados$/.test(t) || /^[·•]$/.test(t)))
        el.style.display = 'none';
      if (el.children.length === 0 && /^iniciada/.test(t))
        el.textContent = 'iniciada em 28 de ago.';
      if (el.children.length === 0 && /^\d+d atrasado$/.test(t)) {
        el.textContent = due[di++ % due.length];
        el.style.background = '#f1f5f9';
        el.style.color = '#374151';
      }
      const bg = getComputedStyle(el).backgroundColor;
      const rgb = /^rgba?\((\d+), (\d+), (\d+)/.exec(bg);
      if (rgb && +rgb[1] > 190 && +rgb[2] < 130 && +rgb[3] < 130) {
        el.style.background = '#3ecf8e';
        el.style.backgroundImage = 'none';
      }
    });
    walk((ph) => {
      if (ph.children.length !== 0 || ph.textContent?.trim() !== 'Nenhuma entrega') return;
      let col: HTMLElement = ph;
      while (col.parentElement && col.parentElement.offsetWidth <= 600) col = col.parentElement;
      col.style.display = 'none';
    });
  });
  await page.waitForTimeout(400);
  await shoot(page, SLUG, 5, 'entregas');

  assertNoViolations(violations);
});

test('crm: agendamento (post express preenchido)', async ({ page }) => {
  const violations = await installSafetyNet(page);
  await page.setViewportSize({ width: 1100, height: 860 });

  await page.goto('/post-express');
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(2000);

  // Fill the form visually — pure client-side state, nothing is submitted.
  const clientSelect = page.locator('select').first();
  const rafaelValue = await clientSelect
    .locator('option', { hasText: 'Rafael Nunes' })
    .getAttribute('value');
  await clientSelect.selectOption(rafaelValue!);
  await page.waitForTimeout(800);
  const caption = page.locator('textarea').first();
  await caption.fill(
    'Chegou o cardápio de inverno ☕ Vem provar o novo cappuccino de avelã e o pão de queijo da casa. Marca aquele amigo que não vive sem café!',
  );
  await page.waitForTimeout(600);
  // Dress twice: the caption preview re-renders on the debounce and restores
  // the real handle, so the second pass right before the shot wins.
  await dressCrm(page);
  await page.waitForTimeout(800);
  await dressCrm(page);
  await shoot(page, SLUG, 1, 'agendamento');

  assertNoViolations(violations);
});

test('crm: calendario (maio, vestido de setembro)', async ({ page }) => {
  const violations = await installSafetyNet(page);
  await page.setViewportSize({ width: 1100, height: 860 });

  await page.goto('/calendario');
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(2000);
  for (let i = 0; i < 4; i++) {
    await page.locator('.calendar-nav button').first().click();
    await page.waitForTimeout(300);
  }
  await page.waitForTimeout(1500);
  await dressCrm(page);

  // Populate the month with post chips by cloning the real chip element the
  // calendar already renders, relabeled per weekday. Screenshot-only.
  await page.evaluate(() => {
    const chips = Array.from(document.querySelectorAll<HTMLElement>('main span, main div')).filter(
      (el) => el.children.length === 0 && /^[↗↘]?\s*\d+ (Receb|Desp)\.$/.test(el.textContent?.trim() ?? ''),
    );
    const sample = chips[0]?.parentElement?.querySelector('span, div') ?? chips[0];
    if (!sample) return;
    const template = (chips[0].closest('[class]') as HTMLElement) ?? chips[0];
    // hide the finance chips — the landing story here is posts
    chips.forEach((c) => ((c.closest('[class*="chip"], span, div') as HTMLElement).style.display = 'none'));

    const POSTS: Array<[number, string, string, string]> = [
      [4, 'Reels · 18:00', '#FBEAF0', '#993556'],
      [5, 'Feed · 11:00', '#E1F5EE', '#0F6E56'],
      [7, 'Carrossel · 19:30', '#FAEEDA', '#854F0B'],
      [11, 'Story · 09:00', '#E6F1FB', '#185FA5'],
      [12, 'Reels · 18:00', '#FBEAF0', '#993556'],
      [14, 'Feed · 12:00', '#E1F5EE', '#0F6E56'],
      [18, 'Carrossel · 19:00', '#FAEEDA', '#854F0B'],
      [19, 'Reels · 18:30', '#FBEAF0', '#993556'],
      [21, 'Feed · 10:00', '#E1F5EE', '#0F6E56'],
      [25, 'Story · 08:30', '#E6F1FB', '#185FA5'],
      [26, 'Reels · 18:00', '#FBEAF0', '#993556'],
      [28, 'Carrossel · 20:00', '#FAEEDA', '#854F0B'],
    ];
    const dayCells = Array.from(
      document.querySelectorAll<HTMLElement>('main [class*="day"], main td, main .calendar-grid > div'),
    );
    const cellFor = (day: number) =>
      dayCells.find((c) => {
        const first = c.querySelector('span, div');
        return first?.textContent?.trim() === String(day) && c.offsetHeight > 60;
      });
    for (const [day, label, bg, fg] of POSTS) {
      const cell = cellFor(day);
      if (!cell) continue;
      const chip = template.cloneNode(true) as HTMLElement;
      chip.style.display = '';
      const leaf = chip.querySelector('span, div') ?? chip;
      leaf.textContent = label;
      (leaf as HTMLElement).style.cssText += `;background:${bg};color:${fg};display:inline-block;border-radius:6px;padding:2px 6px;font-size:11px;font-weight:600`;
      chip.style.cssText += ';background:transparent';
      cell.appendChild(chip);
    }
    // Month label: Maio → Setembro (grid header + side panel date)
    document.querySelectorAll<HTMLElement>('main h2').forEach((el) => {
      if (el.textContent?.trim() === 'Maio') el.textContent = 'Setembro';
    });
    document.querySelectorAll<HTMLElement>('main *').forEach((el) => {
      if (el.children.length === 0 && /1 de Maio, 2026/.test(el.textContent ?? ''))
        el.textContent = el.textContent!.replace('1 de Maio, 2026', '1 de Setembro, 2026');
    });
  });
  await page.waitForTimeout(400);
  await shoot(page, SLUG, 2, 'calendario');

  assertNoViolations(violations);
});

test('crm: analytics do instagram', async ({ page }) => {
  const violations = await installSafetyNet(page);
  await page.setViewportSize({ width: 1100, height: 860 });

  await page.goto('/analytics');
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(3000);
  await dressCrm(page);
  // Hide the "quiet accounts" warning banner and fill the empty metrics so the
  // shot reads as an active operation. Screenshot-only.
  await page.evaluate(() => {
    // Deepest element containing the whole banner (title + chips) is the box —
    // '141d' only appears in the per-account chips, so requiring it forces the
    // match past the header row.
    const banners = Array.from(document.querySelectorAll<HTMLElement>('main *')).filter(
      (el) => el.textContent?.includes('Contas silenciosas') && el.textContent.includes('141d'),
    );
    let banner = banners[banners.length - 1];
    while (
      banner?.parentElement &&
      banner.parentElement.textContent?.includes('Contas silenciosas') &&
      !banner.parentElement.textContent.includes('Contas conectadas')
    )
      banner = banner.parentElement;
    if (banner) banner.style.display = 'none';

    const leaves = Array.from(document.querySelectorAll<HTMLElement>('main *')).filter(
      (el) => el.children.length === 0,
    );
    // KPI: engajamento médio
    const engLabel = leaves.find((el) => el.textContent?.trim() === 'Engajamento médio');
    const engCard = engLabel?.closest('div')?.parentElement;
    engCard?.querySelectorAll<HTMLElement>('*').forEach((el) => {
      if (el.children.length === 0 && /^[—–-]$/.test(el.textContent?.trim() ?? ''))
        el.textContent = '4,6%';
    });
    const bestLabel = leaves.find((el) => el.textContent?.trim() === 'Melhor engajamento');
    const bestCard = bestLabel?.closest('div')?.parentElement;
    bestCard?.querySelectorAll<HTMLElement>('*').forEach((el) => {
      if (el.children.length === 0 && /^[—–-]$/.test(el.textContent?.trim() ?? ''))
        el.textContent = '6,1% de engajamento';
    });
    // KPI: cliques no link
    const clickLabel = leaves.find((el) => /^Cliques no link/.test(el.textContent?.trim() ?? ''));
    const clickCard = clickLabel?.closest('div')?.parentElement;
    clickCard?.querySelectorAll<HTMLElement>('*').forEach((el) => {
      if (el.children.length === 0 && el.textContent?.trim() === '0') el.textContent = '318';
    });
    // Table: replace zeroed posts/clicks and dash engagement pills per row
    const rows = Array.from(document.querySelectorAll<HTMLElement>('main table tr'));
    const posts = ['9', '7', '8', '6'];
    const clicks = ['214', '117', '96', '82'];
    const eng = ['5,2%', '4,8%', '4,1%', '3,9%'];
    rows.forEach((row, i) => {
      let zi = 0;
      row.querySelectorAll<HTMLElement>('*').forEach((el) => {
        if (el.children.length !== 0) return;
        const t = el.textContent?.trim() ?? '';
        if (t === '0') el.textContent = zi++ === 0 ? posts[i % 4] : clicks[i % 4];
        if (/^[—–-]$/.test(t)) el.textContent = eng[i % 4];
      });
    });
  });
  await page.waitForTimeout(400);
  await shoot(page, SLUG, 3, 'analytics-lista');

  assertNoViolations(violations);
});

test('hub desktop home (dressed)', async ({ page, browser }) => {
  const violations = await installSafetyNet(page);

  await page.goto('/clientes/41/hub');
  await page.getByRole('heading', { name: 'Dr. Rafael Nunes' }).first().waitFor();
  const hubUrlText = await page.locator('text=/\\/hub\\/[A-Za-z0-9_-]+/').first().innerText();
  const match = /(\/[^\s/]+\/hub\/[A-Za-z0-9_-]+)/.exec(hubUrlText);
  expect(match).toBeTruthy();
  const hubPath = match![1];
  assertNoViolations(violations);

  const context = await browser.newContext({
    viewport: { width: 1200, height: 900 },
    deviceScaleFactor: 2,
    colorScheme: 'light',
    baseURL: process.env.HUB_BASE_URL || 'http://localhost:5175',
  });
  const hubPage = await context.newPage();
  const hubViolations = await installSafetyNet(hubPage);

  await hubPage.goto(hubPath);
  await hubPage.locator('main.hub-noise').waitFor({ timeout: 20_000 });
  await hubPage.waitForLoadState('networkidle');
  await hubPage.waitForTimeout(2500);

  await hubPage.evaluate((camila) => {
    const leaves = Array.from(document.querySelectorAll<HTMLElement>('main *, aside *, nav *')).filter(
      (el) => el.children.length === 0,
    );
    const setKpi = (labelText: string, value: string, sub?: string) => {
      const label = leaves.find((el) => el.textContent?.trim() === labelText);
      if (!label) return;
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
    document.querySelectorAll<HTMLElement>('body *').forEach((el) => {
      if (el.children.length === 0 && el.textContent?.trim() === 'DK TESTE')
        el.textContent = 'Aura Social';
      if (el.children.length === 0 && el.textContent?.trim() === 'D') el.textContent = 'A';
      if (el.children.length === 0 && el.textContent?.trim() === 'Dr.') el.textContent = 'Camila';
      if (el.children.length === 0 && /^Dr\. Rafael Nun/.test(el.textContent?.trim() ?? ''))
        el.textContent = 'Café da Manhã';
    });
    document.querySelectorAll<HTMLImageElement>('body img').forEach((img) => {
      if (img.clientWidth >= 24) {
        img.src = camila;
        img.style.objectFit = 'cover';
      }
    });
    setKpi('Posts este mês', '14');
    setKpi('Aprovações pendentes', '2', '2 aguardando seu OK');
    setKpi('Taxa de aprovação', '96%');
    setKpi('Próximo post', 'Qui · 18:00', 'Reels · Cardápio de inverno');
  }, CAMILA_URI);
  await hubPage.waitForTimeout(600);
  await shoot(hubPage, SLUG, 4, 'hub-desktop');

  assertNoViolations(hubViolations);
  await context.close();
});
