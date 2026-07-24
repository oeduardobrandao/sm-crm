// One-shot generator for the default OG image (1200x630). Rerun and re-commit
// when the tagline changes: npm run og:image
import { chromium } from '@playwright/test';

const html = `<!doctype html><html><head><meta charset="utf-8"><style>
  * { margin: 0; box-sizing: border-box; }
  body {
    width: 1200px; height: 630px; display: flex; flex-direction: column;
    justify-content: center; padding: 96px; background: #12151a; color: #e8eaf0;
    font-family: 'DM Sans', -apple-system, 'Segoe UI', sans-serif;
  }
  .logo { color: #eab308; font-size: 54px; font-weight: 900; letter-spacing: -1px; }
  h1 { font-size: 66px; font-weight: 800; line-height: 1.12; margin: 28px 0 20px; max-width: 980px; }
  p { font-size: 30px; color: #9ca3af; max-width: 900px; }
</style></head><body>
  <div class="logo">Mesaas</div>
  <h1>CRM para agências e gestores de social media</h1>
  <p>Clientes, aprovações, agendamento no Instagram e relatórios — em um só lugar.</p>
</body></html>`;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1200, height: 630 } });
await page.setContent(html, { waitUntil: 'networkidle' });
await page.screenshot({ path: 'public/og-image.png' });
await browser.close();
console.log('Wrote public/og-image.png (1200x630)');
