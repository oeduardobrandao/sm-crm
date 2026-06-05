// Writes this week's changelog entries by asking a free LLM (Google Gemini) to
// turn the selected merged PRs into customer-facing Portuguese entries.
//
// This is NOT an agent: it makes exactly one API call and writes one file. It
// has no shell, no tools, and no repo/push token. The output is later validated
// by scripts/changelog/apply.ts (zod schema) and gated by CI before publishing.
//
// Usage: node scripts/changelog/write-entries.mjs <fetch.json> <out-entries.json>
//   fetch.json   — output of fetch.ts: { selected: PR[], batchMaxMergedAt }
//   out-entries  — written as: { batchMaxMergedAt, release?: { date, summary?, items[] } }

import { readFileSync, writeFileSync } from 'node:fs';

const [, , fetchPath, outPath] = process.argv;
if (!fetchPath || !outPath) {
  console.error('usage: node write-entries.mjs <fetch.json> <out-entries.json>');
  process.exit(1);
}

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
if (!GEMINI_API_KEY) {
  console.error('GEMINI_API_KEY is not set.');
  process.exit(1);
}
const MODEL = process.env.GEMINI_MODEL ?? 'gemini-2.0-flash';
const CHANGELOG = 'apps/crm/src/content/changelog.json';

const fetchData = JSON.parse(readFileSync(fetchPath, 'utf8'));
const changelog = JSON.parse(readFileSync(CHANGELOG, 'utf8'));
const selected = fetchData.selected ?? [];
const batchMaxMergedAt = fetchData.batchMaxMergedAt;
const existingPrs = (changelog.releases ?? []).flatMap((r) => r.items.map((i) => i.pr));

// No candidates -> watermark-only (apply.ts advances lastMergedAt, no release block).
if (!selected.length) {
  writeFileSync(outPath, JSON.stringify({ batchMaxMergedAt }, null, 2));
  console.log('No selected PRs; wrote watermark-only entries.');
  process.exit(0);
}

const prList = selected
  .map((p) => `PR #${p.number} — ${p.title}\n${(p.body ?? '').slice(0, 1000)}`)
  .join('\n\n---\n\n');

const prompt = [
  'Você escreve as notas de versão (changelog) PÚBLICAS do Mesaas, um CRM para social media managers.',
  'Para cada PR relevante abaixo, escreva UMA entrada voltada ao cliente, em português do Brasil, focada no benefício.',
  'Regras:',
  '- type: "feature" (novo recurso), "improvement" (melhoria/desempenho) ou "fix" (correção perceptível).',
  '- area: área do produto em português (ex.: Entregas, Analytics, Clientes, Hub, Financeiro).',
  '- title e description: linguagem amigável, SEM nomes de arquivo, jargão interno ou detalhes de segurança.',
  '- pr: o número do PR (inteiro).',
  `- NÃO inclua PRs cujo número já esteja nesta lista: [${existingPrs.join(', ')}].`,
  '- DESCARTE PRs que um cliente não perceberia (refactors internos, chores, testes, CI).',
  '- "summary": uma linha resumindo a semana (ou string vazia).',
  'Se nenhum PR merecer entrada, retorne items como lista vazia.',
  '',
  'Responda APENAS com um objeto JSON exatamente neste formato:',
  '{"summary": string, "items": [{"type": "feature"|"improvement"|"fix", "area": string, "title": string, "description": string, "pr": number}]}',
  '',
  'PRs:',
  prList,
].join('\n');

const res = await fetch(
  `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${GEMINI_API_KEY}`,
  {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.4, responseMimeType: 'application/json' },
    }),
  },
);

if (!res.ok) {
  console.error('Gemini error:', res.status, await res.text());
  process.exit(1);
}

const data = await res.json();
const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
if (!text) {
  console.error('Gemini returned no content:', JSON.stringify(data).slice(0, 500));
  process.exit(1);
}

let parsed;
try {
  parsed = JSON.parse(text.trim().replace(/^```json\s*/, '').replace(/```$/, ''));
} catch {
  console.error('Failed to parse Gemini JSON output:', text.slice(0, 500));
  process.exit(1);
}

// Drop any PR already in the changelog (defense in depth; apply.ts also dedups).
const items = (Array.isArray(parsed.items) ? parsed.items : []).filter(
  (i) => !existingPrs.includes(i.pr),
);

const out = { batchMaxMergedAt };
if (items.length) {
  out.release = {
    date: new Date().toISOString().slice(0, 10),
    ...(parsed.summary ? { summary: String(parsed.summary) } : {}),
    items,
  };
}
writeFileSync(outPath, JSON.stringify(out, null, 2));
console.log(`Wrote ${items.length} entr(y/ies) to ${outPath}.`);
