# Shell de marca e conteúdo dos e-mails ao cliente final — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Alinhar os e-mails de relatório mensal e Pendências do Hub à família visual da Mesaas (faixa na cor do workspace com texto por luminância, avatar do logo, rodapé creme, 16px) e melhorar o conteúdo (preheaders, hierarquia de CTA, fila de KPIs com views, pendências com contagem no título e ícones por tipo).

**Architecture:** Um módulo novo `_shared/report-template/brand-header.ts` concentra luminância + faixa + preheader (escapando internamente); os dois builders são reescritos por cima dele. A fila de KPIs exige o único encanamento de backend: coluna `analytics_reports.email_kpis jsonb` gravada pelo gerador (views da tabela mensal de paridade; interações da soma dos posts; followers do KPI existente) e lida pelo report-worker. Tudo em 1 PR.

**Tech Stack:** Deno edge functions, HTML de e-mail table-based (SEM flex/grid), Postgres (1 coluna aditiva), deno test.

**Spec:** `docs/superpowers/specs/2026-09-03-client-email-brand-shell-design.md` — as decisões numeradas 1-11 de lá governam; este plano as referencia por número.

## Global Constraints

- Copy PT-BR; NUNCA em-dash em texto de usuário (ponto/dois-pontos/`·`).
- HTML de e-mail: só tabelas/inline-style; NUNCA flex/grid; degradações Outlook aceitas na spec §3b (círculo vira quadrado, anel some) — sem VML.
- Edge functions NÃO importam de `packages/` (regra documentada em `_shared/whatsapp.ts:4-6`); a fórmula de luminância é DUPLICADA com comentário citando `packages/hub-theme/theme.ts:36-39`.
- `brandColor` chega validado pelo CHECK `^#[0-9a-fA-F]{6}$` (não escapar); `workspaceName`/`logoUrl` chegam CRUS e o módulo escapa internamente (spec, "Contrato de escaping").
- Fontes: manter a stack atual de cada builder (`-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif`); largura 560px inalterada.
- Migration nova: prefixo acima do tail de `origin/main` (conferir `git ls-tree origin/main:supabase/migrations --name-only | tail -3` na abertura do PR; usar `20260905000001` salvo colisão).
- `npm run test:functions` suja `deno.lock` → `git checkout deno.lock` antes de commitar.
- Rodar tudo DESTE worktree (`pwd` + `git branch --show-current` = `claude/notification-center-960dfc`); branch está em `origin/main` + commits de spec.
- Bateria antes do push: lint, format:check, 4× tsc, `npm run test`, `npm run test:functions` (as mudanças são todas Deno + 1 SQL, mas a bateria completa é a regra).

---

### Task 1: Migration `email_kpis` + módulo `brand-header.ts`

**Files:**
- Create: `supabase/migrations/20260905000001_analytics_reports_email_kpis.sql`
- Create: `supabase/functions/_shared/report-template/brand-header.ts`
- Test: `supabase/functions/__tests__/brand-header_test.ts`

**Interfaces:**
- Consumes: `escapeHtml` de `_shared/report-template/escape.ts`.
- Produces (Tasks 2-4 importam por nome):

```ts
export interface EmailKpiEntry { value: number; pct_change?: number }
export interface EmailKpis {
  views?: EmailKpiEntry; interactions?: EmailKpiEntry; followers_gained?: EmailKpiEntry;
}
export function pickHeaderTextColor(brandColorHex: string): "#171717" | "#ffffff"
export function buildBrandHeaderBand(p: {
  workspaceName: string; brandColor: string; logoUrl: string | null;
}): string   // <tr><td>...</td></tr> completo da faixa
export function buildPreheader(text: string): string  // span oculto p/ logo após <body>
export function formatCompactPtBr(n: number): string  // 48200 -> "48,2 mil"; 1240 -> "1.240"
```

- [ ] **Step 1: Migration** (aditiva; `analytics_reports` não usa allowlist de colunas — leitura é via service role no worker):

```sql
-- 20260905000001_analytics_reports_email_kpis.sql
-- KPIs compactos do e-mail de relatório (spec 2026-09-03 §10). Gravado pelo
-- instagram-report-generator-v2 na geração; lido pelo report-worker no envio.
-- Nullable de propósito: relatórios antigos ficam sem a fila (sem backfill).
-- Shape: { views?: {value, pct_change?}, interactions?: {...}, followers_gained?: {...} }
ALTER TABLE analytics_reports ADD COLUMN IF NOT EXISTS email_kpis jsonb;
```

- [ ] **Step 2: Teste que falha** (casos-âncora da spec):

```ts
// supabase/functions/__tests__/brand-header_test.ts
import { assertEquals, assertStringIncludes, assert } from "jsr:@std/assert";
import {
  pickHeaderTextColor, buildBrandHeaderBand, buildPreheader, formatCompactPtBr,
} from "../_shared/report-template/brand-header.ts";

Deno.test("pickHeaderTextColor: escura -> branco, pálida -> escuro", () => {
  assertEquals(pickHeaderTextColor("#e11d48"), "#ffffff");
  assertEquals(pickHeaderTextColor("#1a3d2b"), "#ffffff");
  assertEquals(pickHeaderTextColor("#fef3c7"), "#171717");
});
Deno.test("pickHeaderTextColor: default #eab308 -> ESCURO (âncora, lum ~0.70)", () => {
  assertEquals(pickHeaderTextColor("#eab308"), "#171717");
});
Deno.test("pickHeaderTextColor: hex maiúsculo aceito", () => {
  assertEquals(pickHeaderTextColor("#FEF3C7"), "#171717");
});
Deno.test("band: fundo é sempre literalmente a brandColor; nunca flex", () => {
  const html = buildBrandHeaderBand({ workspaceName: "DK", brandColor: "#fef3c7", logoUrl: null });
  assertStringIncludes(html, "background: #fef3c7");
  assert(!html.includes("display: flex") && !html.includes("display:flex"));
});
Deno.test("band: avatar sse logoUrl; alt vazio; nome sempre presente", () => {
  const sem = buildBrandHeaderBand({ workspaceName: "DK", brandColor: "#e11d48", logoUrl: null });
  const com = buildBrandHeaderBand({ workspaceName: "DK", brandColor: "#e11d48", logoUrl: "https://x/l.png" });
  assert(!sem.includes("<img"));
  assertStringIncludes(com, 'alt=""');
  assertStringIncludes(com, "https://x/l.png");
  for (const h of [sem, com]) assertStringIncludes(h, "DK");
});
Deno.test("band: nome/logoUrl hostis saem escapados", () => {
  const h = buildBrandHeaderBand({
    workspaceName: '<script>x</script>"&', brandColor: "#e11d48",
    logoUrl: 'https://x/"onerror="a',
  });
  assert(!h.includes("<script>"));
  assert(!h.includes('"onerror="'));
});
Deno.test("preheader: contém o texto, oculto, com enchimento", () => {
  const p = buildPreheader("Visualizações +18% em agosto.");
  assertStringIncludes(p, "Visualizações +18% em agosto.");
  assertStringIncludes(p, "display:none");
  assertStringIncludes(p, "&zwnj;");
});
Deno.test("formatCompactPtBr", () => {
  assertEquals(formatCompactPtBr(48200), "48,2 mil");
  assertEquals(formatCompactPtBr(1240), "1.240");
  assertEquals(formatCompactPtBr(312), "312");
  assertEquals(formatCompactPtBr(1200000), "1,2 mi");
});
```

- [ ] **Step 3: RED** — `cd supabase/functions && deno test __tests__/brand-header_test.ts` → falha (módulo inexistente).

- [ ] **Step 4: Implementar o módulo:**

```ts
// supabase/functions/_shared/report-template/brand-header.ts
import { escapeHtml } from "./escape.ts";

export interface EmailKpiEntry { value: number; pct_change?: number }
export interface EmailKpis {
  views?: EmailKpiEntry; interactions?: EmailKpiEntry; followers_gained?: EmailKpiEntry;
}

// Duplicado de packages/hub-theme/theme.ts:36-39 de propósito: edge functions
// não importam de packages/ (racional em _shared/whatsapp.ts:4-6). Mesma
// fórmula do Hub (sem correção gamma), mesmo threshold do --hub-acc-fg (0.55).
function relativeLuminance(hex: string): number {
  const h = hex.replace("#", "");
  const r = parseInt(h.slice(0, 2), 16) / 255;
  const g = parseInt(h.slice(2, 4), 16) / 255;
  const b = parseInt(h.slice(4, 6), 16) / 255;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function pickHeaderTextColor(brandColorHex: string): "#171717" | "#ffffff" {
  return relativeLuminance(brandColorHex) > 0.55 ? "#171717" : "#ffffff";
}

/** Faixa do cabeçalho: cor REAL do workspace, texto por luminância, avatar
 * opcional. brandColor NÃO é escapado (CHECK ^#hex6 no banco); nome/logoUrl
 * chegam CRUS e são escapados aqui (contrato da spec). Tabela, nunca flex:
 * flex não renderiza em Outlook. Degradações aceitas (spec §3b): border-radius
 * e box-shadow somem no engine Word — logo continua legível no fundo branco. */
export function buildBrandHeaderBand(p: {
  workspaceName: string; brandColor: string; logoUrl: string | null;
}): string {
  const name = escapeHtml(p.workspaceName);
  const textColor = pickHeaderTextColor(p.brandColor);
  const avatarCell = p.logoUrl
    ? `<td style="padding-right: 9px;"><table role="presentation" cellpadding="0" cellspacing="0"><tr><td width="40" height="40" align="center" valign="middle" style="width: 40px; height: 40px; background: #ffffff; border-radius: 50%; box-shadow: 0 0 0 2px rgba(255,255,255,.55);"><img src="${escapeHtml(p.logoUrl)}" alt="" width="32" style="max-width: 32px; max-height: 32px; display: block;" /></td></tr></table></td>`
    : "";
  return `<tr><td align="center" style="background: ${p.brandColor}; padding: 20px 24px;">
  <table role="presentation" cellpadding="0" cellspacing="0"><tr>
    ${avatarCell}<td valign="middle" style="font-size: 18px; font-weight: 700; color: ${textColor};">${name}</td>
  </tr></table>
</td></tr>`;
}

/** Texto de prévia da inbox. Vai logo após <body>; o enchimento de &zwnj;
 * impede que o conteúdo real vaze na prévia. Texto chega CRU, escapado aqui. */
export function buildPreheader(text: string): string {
  const pad = "&nbsp;&zwnj;".repeat(90);
  return `<div style="display:none; max-height:0; overflow:hidden; mso-hide:all;">${escapeHtml(text)}${pad}</div>`;
}

/** 48200 -> "48,2 mil"; 1200000 -> "1,2 mi"; abaixo de 10 mil, separador pt-BR. */
export function formatCompactPtBr(n: number): string {
  const fmt = (v: number) => v.toLocaleString("pt-BR", { maximumFractionDigits: 1, minimumFractionDigits: 0 });
  if (Math.abs(n) >= 1_000_000) return `${fmt(n / 1_000_000)} mi`;
  if (Math.abs(n) >= 10_000) return `${fmt(n / 1_000)} mil`;
  return n.toLocaleString("pt-BR");
}
```

- [ ] **Step 5: GREEN** no arquivo de teste; **Step 6: Commit** — `feat(email-brand): coluna email_kpis + módulo brand-header (faixa, luminância, preheader)`.

---

### Task 2: Builder do relatório mensal reescrito

**Files:**
- Modify: `supabase/functions/_shared/report-template/email.ts` (reescrever `buildReportEmail`)
- Test: `supabase/functions/__tests__/report-email_test.ts` (NOVO — primeiro teste deste builder)

**Interfaces:**
- Consumes: Task 1 (`buildBrandHeaderBand`, `buildPreheader`, `pickHeaderTextColor`, `formatCompactPtBr`, `EmailKpis`).
- Produces: `buildReportEmail(params: ReportEmailParams & { emailKpis?: EmailKpis | null }): string` — Task 4 (worker) passa o campo novo.

Requisitos (spec §§1-10): faixa via `buildBrandHeaderBand`; radius 16px; preheader = `Visualizações {sinal}{x}% em {mês}. Veja o relatório completo.` quando `emailKpis?.views?.pct_change` existe, senão `Seu relatório de {mês} está pronto.`; eyebrow `RELATÓRIO MENSAL · {MÊS DE AAAA}` (uppercase via CSS, cinza `#6b7280`); fila de KPIs (tiles `Visualizações`/`Interações`/`Seguidores`, valor via `formatCompactPtBr`, delta positivo `#16a34a` prefixado `+`, negativo `#6b7280` prefixado `−` (sinal U+2212 ou hífen, NÃO em-dash), sem linha quando `pct_change` ausente; tile some sem entry; fila inteira some com `emailKpis` null/undefined/vazio); bloco de IA INALTERADO (fundo `#f8f9fa`, corte 300); CTA único "Ver Relatório Completo" (fundo `brandColor`, texto `pickHeaderTextColor(brandColor)`); "Baixar PDF" vira link de texto cinza sublinhado abaixo do botão (condições de existência de cada um inalteradas); rodapé creme `#f5f3ee`/`#888780` com 2 linhas ("Enviado por {ws} via Mesaas" + "Mesaas · gestão inteligente para social media managers").

- [ ] **Step 1: Teste que falha** (casos mínimos — ampliar com variantes é bem-vindo):

```ts
// supabase/functions/__tests__/report-email_test.ts
import { assertStringIncludes, assert } from "jsr:@std/assert";
import { buildReportEmail } from "../_shared/report-template/email.ts";

const base = {
  clientName: "Marina Arrais", month: "2026-08", workspaceName: "DK",
  brandColor: "#e11d48", logoUrl: null, aiSummary: "Resumo do mês com tamanho suficiente.",
  pdfUrl: "https://x/r.pdf", hubUrl: "https://x/hub",
};

Deno.test("shell: faixa com brandColor, radius 16, rodapé creme com tagline", () => {
  const h = buildReportEmail(base);
  assertStringIncludes(h, "background: #e11d48");
  assertStringIncludes(h, "border-radius: 16px");
  assertStringIncludes(h, "#f5f3ee");
  assertStringIncludes(h, "gestão inteligente para social media managers");
  assert(!h.includes("—"));
});
Deno.test("preheader: com delta de views usa o texto específico; sem, o fallback", () => {
  const com = buildReportEmail({ ...base, emailKpis: { views: { value: 48200, pct_change: 18 } } });
  assertStringIncludes(com, "Visualizações +18% em Agosto de 2026.");
  const sem = buildReportEmail(base);
  assertStringIncludes(sem, "Seu relatório de Agosto de 2026 está pronto.");
});
Deno.test("KPIs: 3 tiles com formato compacto e cores de delta; fila some sem dados", () => {
  const h = buildReportEmail({ ...base, emailKpis: {
    views: { value: 48200, pct_change: 18 },
    interactions: { value: 1240, pct_change: -9 },
    followers_gained: { value: 312 },
  }});
  assertStringIncludes(h, "48,2 mil");
  assertStringIncludes(h, "Visualizações");
  assertStringIncludes(h, "#16a34a");       // +18 verde
  assertStringIncludes(h, ">-9%<");          // negativo presente...
  assert(!h.match(/-9%[^<]*#16a34a/));       // ...mas nunca verde
  const semFila = buildReportEmail(base);
  assert(!semFila.includes("Visualizações"));
});
Deno.test("CTA: botão único com texto por luminância; PDF vira link", () => {
  const palida = buildReportEmail({ ...base, brandColor: "#fef3c7" });
  assertStringIncludes(palida, "background: #fef3c7; color: #171717");
  assert(!palida.includes('background: #1f2937'));     // botão escuro sumiu
  assertStringIncludes(palida, ">Baixar em PDF</a>");  // virou link de texto
});
Deno.test("eyebrow com o mês; bloco de IA continua neutro com corte de 300", () => {
  const h = buildReportEmail({ ...base, aiSummary: "x".repeat(400) });
  assertStringIncludes(h, "Relatório mensal");
  assertStringIncludes(h, "#f8f9fa");
  assert(!h.includes("x".repeat(301)));
});
```

- [ ] **Step 2: RED.** **Step 3: Reescrever `buildReportEmail`** — manter `formatMonthLabel` e as regras de existência de `aiSection`/botões; estrutura nova: `<!DOCTYPE...><body>` → `buildPreheader(...)` → tabela externa → card 16px → `buildBrandHeaderBand(...)` → eyebrow+saudação → fila de KPIs (tabela de 3 `<td>` width 33%, fundo `#f8f9fa`, radius 8) → `aiSection` (inalterada) → botão + link PDF → rodapé creme. **Step 4: GREEN + `npm run test:functions` completo** (nenhum teste existente pina este builder — verificado na spec). **Step 5: Commit** — `feat(email-brand): relatório mensal com shell de marca, preheader, eyebrow, fila de KPIs e CTA único`.

---

### Task 3: Builder de pendências reescrito + handler do cron passa `tipo`

**Files:**
- Modify: `supabase/functions/_shared/client-event-email.ts` (shell + conteúdo; token de unsub INTOCADO)
- Modify: `supabase/functions/client-event-email-cron/handler.ts` (embed ganha `tipo`; interface `pendingPosts`)
- Test: `supabase/functions/__tests__/client-event-email_test.ts` (atualizar — pina markup antigo) e `supabase/functions/__tests__/client-event-email-cron_test.ts` (fixtures ganham `tipo`)

**Interfaces:**
- Consumes: Task 1 (`buildBrandHeaderBand`, `buildPreheader`, `pickHeaderTextColor`).
- Produces: `ClientEventEmailParams.pendingPosts: { titulo: string; tipo: string }[]` (contract change da spec §11); `clientEventSubject` INALTERADO.

Requisitos (spec §§1-8, 11): faixa via módulo; radius 16px; preheader dinâmico "{N} posts aguardando sua aprovação e {M} mensagens." (parte zerada omitida; singular "1 post aguardando sua aprovação" / "1 mensagem"); título adaptativo no `<h1>`: posts>0 → `${n} posts esperam sua aprovação` (singular "1 post espera sua aprovação"), senão `${m} mensagens esperam você` ("1 mensagem espera você"); saudação vira primeira linha do corpo ("Olá, {nome}! Quando puder, dá uma olhada no que a equipe preparou:" com posts; só mensagens → "Olá, {nome}!"); posts como linhas de tabela (célula 24px com emoji por tipo: `feed:"🖼", carrossel:"🗂", reels:"🎬", stories:"📱"`, desconhecido → `🖼`; borda `#eceef2`, radius 8) mantendo corte de 20 + "e mais N posts aguardando aprovação."; linha de mensagens (fundo `#f8f9fa`, 💬, "<strong>{M} mensagens não lidas</strong> da equipe esperando você." / singular "1 mensagem não lida... esperando"); CTA: posts>0 → "Revisar e aprovar", senão "Ver mensagens" (fundo `brandColor`, texto por luminância); rodapé: 3 linhas atuais mantidas, só paleta creme (link herda `#888780`).

No handler: o select do embed passa de `workflow_posts!inner(titulo)`-shape para incluir `tipo` (conferir a forma exata no arquivo — o embed também filtra por `cliente_id`/`status`), e o item passado ao builder vira `{ titulo, tipo }`. NADA mais muda no handler (janela/lease/idempotency intocados — a chave usa ids, não conteúdo).

- [ ] **Step 1: Atualizar/estender os testes PRIMEIRO** (RED): no `client-event-email_test.ts`, além de adaptar `pendingPosts` para `{titulo, tipo}`, adicionar: título adaptativo (3 posts → "3 posts esperam sua aprovação"; 1 post singular; 0 posts + 2 msgs → "2 mensagens esperam você"); emoji por tipo (reels → 🎬) e fallback (tipo "zzz" → 🖼); CTA adaptativo; preheader dinâmico com as duas contagens e omissão da parte zerada; shell (faixa/16px/rodapé creme com link `#888780`); unsub link SEMPRE presente (mantido). No cron test, fixtures de `workflow_posts` ganham `tipo` e os asserts de HTML que citavam o título genérico antigo são atualizados.
- [ ] **Step 2: RED.** **Step 3: Implementar builder + handler.** **Step 4: GREEN + `npm run test:functions`** (o sweep completo: `client-email-unsub_test` não pina esse markup, mas rodar tudo). **Step 5: Commit** — `feat(email-brand): pendências com contagem no título, linhas por tipo, CTA acionável e shell de marca`.

---

### Task 4: Gerador grava `email_kpis`; worker lê e passa

**Files:**
- Modify: `supabase/functions/instagram-report-generator-v2/index.ts` (montar + gravar `email_kpis` no `updatePayload`, ~linha 1075)
- Modify: `supabase/functions/report-worker/index.ts` (select ganha `email_kpis` ~L176; call do builder ganha `emailKpis` ~L203-212)
- Test: `supabase/functions/__tests__/` — teste novo ou estendido do gerador se houver harness (verificar `ls supabase/functions/__tests__/ | grep -i generator`); no mínimo, teste unitário da função de montagem extraída (ver abaixo)

**Interfaces:**
- Consumes: `EmailKpis` (Task 1); coluna da Task 1; `buildReportEmail` com `emailKpis` (Task 2).
- Produces: `analytics_reports.email_kpis` populado em toda geração nova.

Detalhes de encanamento (verificados no grounding):
- **views:** `instagram_account_metrics_monthly.views_month` — `.eq('instagram_account_id', igAccountId).eq('month', '<AAAA-MM-01 do mês do relatório>')`; `pct_change` = comparação com a linha do mês anterior (mesma tabela), arredondado a inteiro, omitido se a linha anterior não existe ou `views_month` anterior é null/0. O gerador já tem `igAccountId` em escopo (usado em ~7 queries, ex. `index.ts:423-465`). Tabela criada em `20260901100000_account_metrics_parity.sql:19-33`.
- **interactions:** soma de likes+comments+saves dos posts do mês que o gerador JÁ carrega (os mesmos acumuladores da região `index.ts:640-690` que produzem `totalReach`/`totalSaved`/`engagement_rate` — reusar as variáveis existentes; NÃO refazer query). `pct_change` omitido (não há mês anterior de posts em mãos; a spec permite delta ausente).
- **followers_gained:** o valor já computado para o KPI map (`index.ts:658`); `pct_change` omitido pelo mesmo motivo.
- Extrair a montagem para uma função pura exportada (testável sem harness do gerador): `buildEmailKpis(p: { viewsMonth: number | null; prevViewsMonth: number | null; interactions: number; followersGained: number }): EmailKpis | null` — retorna `null` quando NENHUM campo tem valor (então a coluna fica null e o e-mail degrada). Vive em arquivo próprio `_shared/report-template/email-kpis.ts` (responsabilidade do pipeline de GERAÇÃO, não do módulo de shell — importa o tipo `EmailKpis` de `brand-header.ts`), com teste unitário próprio (`__tests__/email-kpis_test.ts`: monta com tudo; omite pct sem prev; pct arredondado a inteiro; null quando nada tem valor).
- Worker: `.select('client_id, conta_id, report_month, storage_path, ai_content')` → adiciona `, email_kpis`; call do builder adiciona `emailKpis: reportRow.email_kpis ?? null`. Null-safe por construção (Task 2).

- [ ] **Step 1: Teste de `buildEmailKpis` (RED)** → **Step 2: implementar `email-kpis.ts`** → **Step 3: fiação no gerador** (query da linha mensal atual + anterior com `maybeSingle()`, try/catch em volta: falha na query de métricas NUNCA derruba a geração do relatório — loga e grava `email_kpis: null`) **e no worker** → **Step 4: GREEN + suite completa** → **Step 5: Commit** — `feat(email-brand): gerador grava email_kpis (views da fonte de paridade) e worker repassa ao e-mail`.

---

### Task 5: Verificação final + preview visual + PR

**Files:** nenhum novo além do script de preview em `/tmp`.

- [ ] **Step 1: Bateria completa** (lint, format:check, 4× tsc, `npm run test`, `npm run test:functions` + restore `deno.lock`). Qualquer RED sem causa pré-existente conhecida = BLOCKED.
- [ ] **Step 2: Preview visual manual (exigência da spec):** script Deno em `/tmp` chamando os DOIS builders reais nas variantes: cor forte `#e11d48` e pálida `#fef3c7`; com e sem `logoUrl`; relatório com e sem `emailKpis` (incl. delta negativo); pendências com 3 posts+2 msgs, 1 post+0 msgs, 0 posts+1 msg, e 25 posts (corte de 20). Gravar os HTML em `/tmp` e ENVIAR ao usuário via SendUserFile (o controlador faz o envio) — a aprovação visual é gate de push.
- [ ] **Step 3: Re-verificar prefixo da migration** vs tail de `origin/main`; renumerar se main andou.
- [ ] **Step 4: Push + PR** (autorização em pé, mesmo padrão das fases anteriores):

```bash
git push -u origin claude/notification-center-960dfc
gh pr create --title "feat(email-brand): shell de marca e conteúdo novo nos e-mails ao cliente final" --body "$(cat <<'EOF'
Alinha os e-mails de relatório mensal e Pendências do Hub à família visual da
Mesaas e melhora o conteúdo:

- Faixa do cabeçalho na cor real do workspace (texto inverte por luminância,
  fórmula do Hub duplicada com citação; a cor NUNCA é substituída), avatar
  redondo do logo, rodapé creme, radius 16px. Markup 100% tabela (sem flex).
- Preheaders invisíveis nos dois e-mails (prévia da inbox com conteúdo real).
- Relatório: eyebrow com o mês, CTA único (PDF vira link), fila de KPIs
  Visualizações/Interações/Seguidores com deltas (views da fonte de paridade
  via nova coluna analytics_reports.email_kpis; degrada silenciosamente em
  relatórios antigos).
- Pendências: número no título ("3 posts esperam sua aprovação"), linhas com
  ícone por tipo, linha de mensagens, CTA "Revisar e aprovar"/"Ver mensagens".

Spec: docs/superpowers/specs/2026-09-03-client-email-brand-shell-design.md

Rollout pós-merge (deste worktree, linkado ao prod):
1. npx supabase db push --linked        # coluna email_kpis (aditiva, segura antes)
2. npx supabase functions deploy instagram-report-generator-v2 --no-verify-jwt --use-api
3. npx supabase functions deploy report-worker --no-verify-jwt --use-api
4. npx supabase functions deploy client-event-email-cron --no-verify-jwt --use-api
Ordem: migration ANTES das functions (o gerador novo escreve na coluna; o
worker novo lê null-safe). Sem janela de erro: builders antigos ignoram a
coluna; novos degradam sem ela.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 5:** Tratar o review externo com receiving-code-review.

## Rollout pós-merge

Ordem no corpo do PR (migration primeiro — inversão deliberada vs. fases
anteriores porque aqui a coluna é aditiva e os deploys dependem dela; nenhum
cron novo é agendado). Smoke: disparar um relatório de teste (rota manual
`send-report-email` do instagram-analytics respeita cooldown) e um digest de
pendências num workspace de teste; conferir preheader, faixa, KPIs e ícones em
Gmail + um cliente Outlook se disponível.
