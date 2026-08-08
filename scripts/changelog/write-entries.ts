// Writes the changelog entries by asking a free LLM (Groq) to turn the selected
// merged PRs into customer-facing Portuguese entries.
//
// This is NOT an agent: it makes a bounded number of API calls (one per week of
// merged PRs, split further only if a week is too large) and writes one file.
// It has no shell, no tools, and no repo/push token. The output is sanitized
// here (deterministically), then validated by scripts/changelog/apply.ts (zod)
// and gated by CI before publishing.
//
// Why per-week calls: the Groq free tier caps tokens-per-minute at 12k. A
// multi-week backlog in a single prompt blows that cap (the 2026-08 failures),
// and one giant release block would misdate a month of work anyway. Each week
// becomes its own dated release.
//
// Usage: npx tsx scripts/changelog/write-entries.ts <fetch.json> <out-entries.json>
//   fetch.json   — output of fetch.ts: { selected: PR[], batchMaxMergedAt }
//   out-entries  — written as: { batchMaxMergedAt, releases: [{ date, summary?, items[] }] }

import { readFileSync, writeFileSync } from 'node:fs';
import {
  groupByWeek,
  sanitizeItems,
  scrubDashes,
  LINK_CATALOG,
  type PullRequest,
} from '../../apps/crm/src/content/changelog.logic';
import type { ChangelogRelease } from '../../apps/crm/src/content/changelog.schema';

const [, , fetchPath, outPath] = process.argv;
if (!fetchPath || !outPath) {
  console.error('usage: npx tsx scripts/changelog/write-entries.ts <fetch.json> <out-entries.json>');
  process.exit(1);
}

const GROQ_API_KEY = process.env.GROQ_API_KEY;
if (!GROQ_API_KEY) {
  console.error('GROQ_API_KEY is not set.');
  process.exit(1);
}
const MODEL = process.env.GROQ_MODEL ?? 'llama-3.3-70b-versatile';
const CHANGELOG = 'apps/crm/src/content/changelog.json';

// Groq free tier: 12k tokens/minute. Keep every call under CALL_TOKEN_LIMIT
// (prompt estimate + completion cap) and never start a call that would push the
// rolling one-minute total past TPM_BUDGET.
const TPM_BUDGET = 10_000;
const CALL_TOKEN_LIMIT = 9_000;
const MAX_COMPLETION_TOKENS = 1_500;
const BODY_SLICE = 600;

const fetchData = JSON.parse(readFileSync(fetchPath, 'utf8'));
const changelog = JSON.parse(readFileSync(CHANGELOG, 'utf8'));
const selected: PullRequest[] = fetchData.selected ?? [];
const batchMaxMergedAt: string = fetchData.batchMaxMergedAt;
const existingPrs: number[] = (changelog.releases ?? []).flatMap((r: ChangelogRelease) =>
  r.items.map((i) => i.pr),
);

// No candidates -> watermark-only (apply.ts advances lastMergedAt, no release block).
if (!selected.length) {
  writeFileSync(outPath, JSON.stringify({ batchMaxMergedAt }, null, 2));
  console.log('No selected PRs; wrote watermark-only entries.');
  process.exit(0);
}

const SYSTEM = [
  'Você escreve as notas de versão (changelog) PÚBLICAS do Mesaas, um CRM para social media managers.',
  'Escreva entradas voltadas ao cliente, em português do Brasil, focadas no benefício concreto.',
  'Responda APENAS com um objeto JSON (sem markdown), exatamente neste formato:',
  '{"summary": string, "items": [{"type": "feature"|"improvement"|"fix", "area": string, "title": string, "description": string, "pr": number, "link": string (opcional)}]}',
].join('\n');

function buildUserPrompt(prs: PullRequest[]): string {
  return [
    'Para cada PR relevante abaixo, escreva UMA entrada:',
    '- type: "feature" (novo recurso), "improvement" (melhoria/desempenho) ou "fix" (correção perceptível).',
    '- area: área do produto em português (ex.: Entregas, Analytics, Clientes, Hub, Financeiro).',
    '- title e description: linguagem amigável, SEM nomes de arquivo, jargão interno ou detalhes de segurança.',
    '- Evite muletas genéricas como "para uma melhor experiência de usuário"; diga o que mudou na prática.',
    '- NUNCA use travessão (—) nem meia-risca (–); prefira dois-pontos, vírgula ou ponto.',
    '- pr: o número do PR (inteiro). Use SOMENTE números de PR listados abaixo.',
    `- NÃO inclua PRs cujo número já esteja nesta lista: [${existingPrs.join(', ')}].`,
    '- DESCARTE PRs que um cliente não perceberia (refactors internos, chores, testes, CI, instrumentação/telemetria como PostHog ou Crisp, ajustes internos de crons e filas de sincronização).',
    '- DESCARTE trabalho do painel administrativo interno da plataforma (admin: convites de admin, planos/preços internos, Stripe interno). Em PRs mistos, mantenha só a parte visível ao cliente.',
    '- Se nenhum PR merecer entrada, items = [].',
    `- link (opcional): quando indicar onde usar o recurso ajudar de verdade, escolha UMA rota desta lista: ${LINK_CATALOG.map((l) => l.href).join(', ')}. Não invente rotas; omita na dúvida.`,
    '- "summary": uma linha resumindo a semana (ou string vazia).',
    '',
    'PRs:',
    prs
      .map((p) => `PR #${p.number} — ${p.title}\n${(p.body ?? '').slice(0, BODY_SLICE)}`)
      .join('\n\n---\n\n'),
  ].join('\n');
}

/** Conservative for pt-BR + JSON: ~3 chars per token. */
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 3);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Rolling one-minute token window across calls.
let windowStart = 0;
let windowTokens = 0;
async function reserveBudget(tokens: number): Promise<void> {
  const now = Date.now();
  if (now - windowStart >= 65_000) {
    windowStart = now;
    windowTokens = 0;
  }
  if (windowTokens + tokens > TPM_BUDGET) {
    const wait = 65_000 - (now - windowStart);
    console.log(`TPM budget reached; sleeping ${Math.ceil(wait / 1000)}s.`);
    await sleep(Math.max(wait, 1_000));
    windowStart = Date.now();
    windowTokens = 0;
  }
  windowTokens += tokens;
}

interface GroqResult {
  summary: string;
  items: unknown[];
}

async function callGroq(prs: PullRequest[]): Promise<GroqResult> {
  const user = buildUserPrompt(prs);
  const estimate = estimateTokens(SYSTEM + user) + MAX_COMPLETION_TOKENS;

  // A single oversized call can never fit the per-minute cap — split the batch.
  if (estimate > CALL_TOKEN_LIMIT && prs.length > 1) {
    const mid = Math.ceil(prs.length / 2);
    const a = await callGroq(prs.slice(0, mid));
    const b = await callGroq(prs.slice(mid));
    return { summary: a.summary || b.summary, items: [...a.items, ...b.items] };
  }

  for (let attempt = 1; ; attempt++) {
    await reserveBudget(estimate);
    const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${GROQ_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: MODEL,
        temperature: 0.4,
        max_tokens: MAX_COMPLETION_TOKENS,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: SYSTEM },
          { role: 'user', content: user },
        ],
      }),
    });

    if (res.ok) {
      const data = await res.json();
      const text: string | undefined = data?.choices?.[0]?.message?.content;
      if (!text) throw new Error(`Groq returned no content: ${JSON.stringify(data).slice(0, 300)}`);
      let parsed: any;
      try {
        parsed = JSON.parse(text.trim().replace(/^```json\s*/, '').replace(/```$/, ''));
      } catch {
        throw new Error(`Failed to parse Groq JSON output: ${text.slice(0, 300)}`);
      }
      return {
        summary: typeof parsed.summary === 'string' ? parsed.summary : '',
        items: Array.isArray(parsed.items) ? parsed.items : [],
      };
    }

    const body = await res.text();
    const retriable = res.status === 429 || res.status === 413 || res.status >= 500;
    if (!retriable || attempt >= 3) {
      throw new Error(`Groq error ${res.status} (attempt ${attempt}): ${body.slice(0, 400)}`);
    }
    // 413 with a splittable batch: halving beats waiting.
    if (res.status === 413 && prs.length > 1) {
      console.log(`Groq 413 on ${prs.length} PRs; splitting the batch.`);
      const mid = Math.ceil(prs.length / 2);
      const a = await callGroq(prs.slice(0, mid));
      const b = await callGroq(prs.slice(mid));
      return { summary: a.summary || b.summary, items: [...a.items, ...b.items] };
    }
    console.log(`Groq ${res.status} (attempt ${attempt}); backing off 70s.`);
    await sleep(70_000);
  }
}

const groups = groupByWeek(selected);
console.log(`${selected.length} PR(s) across ${groups.length} week(s).`);

const releases: ChangelogRelease[] = [];
const publishedSoFar = [...existingPrs];
for (const group of groups) {
  const { summary, items: rawItems } = await callGroq(group.prs);
  const items = sanitizeItems(rawItems, {
    allowedPrNumbers: group.prs.map((p) => p.number),
    existingPrNumbers: publishedSoFar,
  });
  publishedSoFar.push(...items.map((i) => i.pr));
  console.log(`Week of ${group.date}: ${group.prs.length} PR(s) -> ${items.length} entr(y/ies).`);
  if (!items.length) continue;
  const cleanSummary = scrubDashes(summary);
  releases.push({ date: group.date, ...(cleanSummary ? { summary: cleanSummary } : {}), items });
}

const out = releases.length ? { batchMaxMergedAt, releases } : { batchMaxMergedAt };
writeFileSync(outPath, JSON.stringify(out, null, 2));
console.log(`Wrote ${releases.length} release(s) to ${outPath}.`);
