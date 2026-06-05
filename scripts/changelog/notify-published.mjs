import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const PATH = 'apps/crm/src/content/changelog.json';
const RESEND_API_KEY = process.env.RESEND_API_KEY;
const ALERT_EMAIL = process.env.ALERT_EMAIL;
const SITE_URL = process.env.SITE_URL ?? 'https://mesaas.com.br';

if (!RESEND_API_KEY || !ALERT_EMAIL) {
  console.log('Missing RESEND_API_KEY/ALERT_EMAIL; skipping.');
  process.exit(0);
}

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' };
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ESC[c]);

function load(ref) {
  try {
    return JSON.parse(execFileSync('git', ['show', `${ref}:${PATH}`], { encoding: 'utf8' }));
  } catch {
    return { releases: [] };
  }
}

const before = load('HEAD~1');
const after = JSON.parse(readFileSync(PATH, 'utf8'));
const beforePrs = new Set(before.releases.flatMap((r) => r.items.map((i) => i.pr)));
const newItems = after.releases.flatMap((r) => r.items).filter((i) => !beforePrs.has(i.pr));

if (!newItems.length) {
  console.log('No new entries; skipping.');
  process.exit(0);
}

const list = newItems.map((i) => `<li><strong>${esc(i.title)}</strong> — ${esc(i.description)}</li>`).join('');
const html = `Novas entradas publicadas no changelog:<br><ul>${list}</ul><br>` +
  `<a href="${SITE_URL}/novidades">Ver Novidades</a>`;

const res = await fetch('https://api.resend.com/emails', {
  method: 'POST',
  headers: { Authorization: `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({
    from: 'Mesaas Alerts <alertas@mesaas.com.br>',
    to: [ALERT_EMAIL],
    subject: `[Mesaas] ${newItems.length} novidade(s) publicada(s)`,
    html,
  }),
});

if (!res.ok) {
  console.error('Resend error:', res.status, await res.text());
  process.exit(1);
}
console.log(`Notification sent for ${newItems.length} entr(y/ies).`);
