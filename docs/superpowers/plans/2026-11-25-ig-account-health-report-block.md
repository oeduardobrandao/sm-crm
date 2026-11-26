# Saúde do Instagram como bloco do relatório Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bloco `account_health` ("Saúde do Instagram") no relatório de blocos, com as 4 métricas calculadas no mês do relatório e congeladas no `data_snapshot`.

**Architecture:** Sobrecarga SQL `ig_account_health_metrics(account, as_of)`; o `report-docs` grava `instagram_health` no snapshot na geração e no "Atualizar dados"; o bloco em `packages/report-blocks` só lê o snapshot. A lógica de percentil/veredito sai do CRM para o pacote e passa a ser compartilhada.

**Tech Stack:** Postgres + psql suites, Deno (`report-docs`, `_shared/report-docs`), React 19 (`packages/report-blocks`, CRM, Hub), Vitest, `deno test`.

**Spec:** `docs/superpowers/specs/2026-11-25-ig-account-health-report-block-design.md` (e o spec base `2026-11-25-ig-account-health-design.md` para definições, copy e vereditos). Mockup: seção 6 de `https://claude.ai/artifact/49SBsuR8bs6bnmGWGmkzCq`.

## Global Constraints

- `as_of = min(period.endExclusive, instante da geração)`; janelas de 30 e 90 dias terminam em `as_of` (exclusivo). Seguidores no corte são o denominador do engajamento e a faixa.
- Campo `instagram_health` é **opcional** no snapshot; `version: 1` não muda; snapshot antigo sem o campo = bloco sem dado.
- O tipo `account_health` não tem prefixo (é Instagram para o trigger e para `blockPlatform`); nenhuma migration de `validate_report_layout`.
- Bloco só tamanho `full`; fora do layout padrão.
- Copy sem travessão; `sanitizeUrl`/equivalente do pacote em `href` vindo de dado; lucide only.
- Migration nova com prefixo acima de `20261201000003` e acima da cauda de `main` no momento do PR.
- Antes do push: lint, format:check, os cinco `tsc`, `npm run test`, `check:functions`, `test:functions`, `test:db`.

## Review Focus

1. Relatório de mês fechado gerado semanas depois: as métricas tem de vir do mês do relatório, não de "hoje" (Task 1 e Task 3).
2. Instagram desconectado no "Atualizar dados": `instagram_health` congelado é preservado como as outras chaves Instagram (Task 3).
3. Snapshot antigo sem `instagram_health` no editor, no Hub e no PDF: nada quebra, bloco cai no placeholder "sem dados" do editor e some no Hub/PDF (Task 4).
4. Accent claro (ex.: amarelo) ou tema escuro do relatório: vereditos legíveis (cores fixas, AA) (Task 4).
5. Falha ao ler benchmarks ou métricas na geração: relatório é gerado igual, com `instagram_health: null` (Task 3).

---

### Task 1: Sobrecarga SQL ancorada em data

**Files:**
- Create: `supabase/migrations/20261206000001_ig_account_health_metrics_as_of.sql`
- Modify: `supabase/tests/entitlements/99_ig_account_health_metrics.sql`

**Interfaces:**
- Produces: `public.ig_account_health_metrics(p_account_id uuid, p_as_of timestamptz, p_followers int)` com o mesmo retorno da de 1 argumento (`p_followers` nulo = `follower_count` atual, é o denominador do engajamento); a de 1 argumento vira `select * from ig_account_health_metrics(p_account_id, now(), null)`. EXECUTE: `authenticated`, `service_role`; revogado de `public`, `anon`.

- [ ] **Step 1: Testes falhando** (acrescentar à suite existente):
  - posts de feed em `2026-09-05` e `2026-09-20` e um em `2026-10-10`; `p_as_of = '2026-10-01'` → `posts_30d = 2`; com `now()` (1 argumento) o de outubro também entra nas janelas certas.
  - um post em `2026-06-15` fica fora dos 90 dias de `as_of = '2026-10-01'` e dentro dos de `'2026-09-10'`.
  - melhor post respeita `as_of` (o de outubro não é melhor post de setembro).
  - a versão de 1 argumento dá o mesmo resultado de `p_as_of = now()` na fixture existente.
  - `p_followers = 5000` com mediana 100 → `engagement_rate = 0.02`, mesmo com `follower_count` 10000.
  - `anon` sem EXECUTE na de 3 argumentos; `service_role` com.
- [ ] **Step 2:** `npm run test:db` (stack local própria; nunca a porta de outro worktree, conferir `docker ps`) → FAIL.
- [ ] **Step 3:** Migration: `create or replace` da de 2 argumentos (corpo da atual trocando `now()` por `p_as_of`, filtrando `posted_at < p_as_of` e usando `coalesce(p_followers, follower_count)`), depois a de 1 argumento delegando. Grants.
- [ ] **Step 4:** `npm run test:db` → PASS (as suites da RPC e do refresh seguem verdes).
- [ ] **Step 5:** Commit `feat(db): métricas de saúde do Instagram ancoradas numa data`.

### Task 2: Tipos e lógica compartilhados

**Files:**
- Já existe (commitado antes da execução): `supabase/functions/_shared/report-docs/health-types.ts`; não recriar
- Create: `packages/report-blocks/health.ts` (conteúdo de `apps/crm/src/lib/ig-account-health.ts`, importando os tipos do arquivo acima)
- Move: `apps/crm/src/lib/__tests__/ig-account-health.test.ts` → `packages/report-blocks/__tests__/health.test.ts`
- Delete: `apps/crm/src/lib/ig-account-health.ts`
- Modify: imports em `apps/crm/src/pages/analytics-conta/health/AccountHealthCard.tsx`, `HealthBar.tsx`, seu teste e `apps/crm/src/services/analytics.ts` para `@mesaas/report-blocks/health`

**Interfaces:**
- Produces (em `health-types.ts`): `HealthMetricKey`, `FollowerBand`, `BenchmarkSource`, `PeerBenchmark` (os mesmos de hoje) e
  ```ts
  export interface InstagramHealthSnapshot {
    as_of: string; followers: number; band: FollowerBand | null;
    metrics: Record<HealthMetricKey, number | null>;
    benchmarks: Partial<Record<HealthMetricKey, PeerBenchmark>>;
    best_post: { ratio: number; permalink: string | null; thumbnail_url: string | null } | null;
  }
  ```
- Produces (em `packages/report-blocks/health.ts`): as funções de hoje (`percentileFromCuts`, `verdictFor`, `overallPercentile`, `bandLabel`, `roundedSampleLabel`, `formatMetric`, tipos `Verdict`, `VerdictTone`) re-exportando os tipos acima.

- [ ] **Step 1:** Mover o teste, ajustar o import, rodar `npx vitest run packages/report-blocks/__tests__/health.test.ts` → FAIL (módulo não existe).
- [ ] **Step 2:** Criar os dois arquivos, apagar o antigo, trocar os imports. `grep -rn "lib/ig-account-health" apps packages` sem resultado.
- [ ] **Step 3:** `npx vitest run packages/report-blocks apps/crm/src/pages/analytics-conta apps/crm/src/services` → PASS; `npx tsc -p apps/crm/tsconfig.json --noEmit` e `npx tsc -p apps/hub/tsconfig.json --noEmit` limpos.
- [ ] **Step 4:** Commit `refactor(analytics): lógica de saúde do Instagram no pacote de blocos`.

### Task 3: Snapshot do relatório

**Files:**
- Create: `supabase/functions/report-docs/health-section.ts` + `health-section.test.ts`
- Modify: `supabase/functions/_shared/report-docs/snapshot.ts` (campo opcional em `ReportDocSnapshot`, `"instagram_health"` em `INSTAGRAM_SECTION_KEYS`, `instagram_health: null` em `emptyInstagramSection`)
- Modify: `supabase/functions/report-docs/snapshot-source.ts` (chamar o loader quando o Instagram está conectado e pôr o resultado no snapshot; vale para geração e para `refresh.ts`, que usa o mesmo `loadClientSnapshot`)

**Interfaces:**
- Consumes: Task 1 (RPC de 2 argumentos), Task 2 (`InstagramHealthSnapshot`).
- Produces: `export async function loadInstagramHealth(db: Db, deps: SnapshotDeps, accountId: string, effectiveEnd: string): Promise<InstagramHealthSnapshot | null>`.

Regras (spec §Snapshot): `as_of` = o ISO recebido; seguidores = `instagram_follower_history.follower_count` com `date <= (as_of − 1 dia)` mais recente dentro de 7 dias, senão `instagram_accounts.follower_count`; faixa por esse número e métricas por `.rpc('ig_account_health_metrics', { p_account_id, p_as_of, p_followers })`; benchmarks = linhas de `ig_peer_benchmarks` da faixa, convertidas como em `getAccountHealth` (numérico string → number, só arrays de 99); melhor post = busca própria de `instagram_posts` por `best_post_id` (`instagram_post_id`, `permalink`, `thumbnail_url`), miniatura por `cachePostThumbnail(deps, accountId, instagram_post_id, thumbnail_url)` e `null` se o resultado ainda for `isEphemeralInstagramUrl`; qualquer erro → `null` + `console.error('[report-docs] instagram_health', ...)` sem detalhe ao cliente.

- [ ] **Step 1: Testes Deno falhando** em `health-section.test.ts` com o `createSupabaseQueryMock` já usado nos testes de `report-docs`:
  - `asOfIso '2026-10-01T03:00:00.000Z'` → RPC chamada com esse `p_as_of` e com `p_followers` igual ao seguidor do histórico.
  - histórico de seguidores em `2026-09-28` (9100) e conta com 9274 → `followers 9100`, `band '5k_20k'`; sem histórico → 9274.
  - benchmarks com `cuts` em string viram number; linha com 98 cortes some.
  - `best_post_id` nulo → `best_post null`; com id → `permalink` e thumbnail cacheada; cache que devolve URL efêmera → `thumbnail_url null`.
  - `snapshot-source`: mês corrente usa o instante da geração como corte, mês fechado usa `endExclusive`.
  - RPC com erro → `null`.
  - `snapshot.test`/`refresh.test`: Instagram desconectado no refresh preserva o `instagram_health` congelado; `emptyInstagramSection().instagram_health === null`.
- [ ] **Step 2:** `deno test --no-check supabase/functions/report-docs/ supabase/functions/_shared/report-docs/` → FAIL.
- [ ] **Step 3:** Implementar e ligar em `snapshot-source.ts` (em paralelo com as outras leituras do Instagram, sem atrasar a geração além de uma ida ao banco).
- [ ] **Step 4:** `npm run check:functions && npm run test:functions` → PASS.
- [ ] **Step 5:** Commit `feat(report-docs): saúde do Instagram no snapshot do relatório`.

### Task 4: Bloco `account_health`

**Files:**
- Create: `packages/report-blocks/blocks/AccountHealthBlock.tsx` + teste em `packages/report-blocks/__tests__/`
- Modify: `packages/report-blocks/types.ts` (`BlockType`), `catalog.ts` (label "Saúde do Instagram", `Conteúdo`, `platform: 'instagram'`), `BlockRenderer.tsx`, `data-presence.ts`, `fixtures.ts` (`instagram_health` na fixture de amostra, com os números do mockup), `styles.css` (classes `rb-health-*`)
- Modify: `supabase/functions/_shared/report-docs/layout.ts` (`"account_health"` em `ALLOWED_BLOCK_TYPES`), `apps/crm/src/pages/relatorio-editor/widgetIcons.ts` (ícone lucide `Gauge`)
- Modify: onde o editor restringe tamanhos por tipo (procurar em `layoutOps.ts`/`catalog.ts` como `cover` fica só `full`) para `account_health` só `full`

**Interfaces:**
- Consumes: Task 2 (`health.ts`), snapshot com `instagram_health` (Task 3; nos testes vem da fixture).
- Produces: `export function AccountHealthBlock({ snapshot }: BlockProps): JSX.Element | null`.

Conteúdo e copy = cartão do CRM (spec base §Cartão), com estas diferenças: cabeçalho "Saúde do Instagram" + carimbo "Até {dd/mm do effectiveEnd}"; melhor post "Seu melhor post do período teve {r}x o resultado normal da conta." + miniatura + link "Ver no Instagram" (só com `permalink` válido, `rel="noopener noreferrer"`, `target="_blank"`); some abaixo de 1x. Retorna `null` quando `data-presence` diz sem dado (snapshot sem `instagram_health`, `band` nulo, ou nenhuma métrica com valor e referência). Cores de veredito fixas em `styles.css`, com contraste AA sobre `--rb-card` claro e escuro dos temas do relatório; accent só em detalhes (link, borda da miniatura).

- [ ] **Step 1: Testes falhando:**
  - com a fixture: título, "Até 30/09", o veredito geral, "Somando as 4 métricas", as quatro métricas, rodapé "†Estimativa de mercado…", "teve 2,2x", link "Ver no Instagram" com o `permalink`.
  - snapshot sem `instagram_health` → render vazio; `hasData('account_health', snapshot)` false.
  - `best_post.ratio 0.8` → sem a linha; `permalink null` → frase sem link.
  - `ALLOWED_BLOCK_TYPES` contém `account_health` (teste existente de paridade do catálogo com o layout do Deno deve pegar; se não pegar, acrescentar asserção).
  - nenhum texto com "—".
- [ ] **Step 2:** `npx vitest run packages/report-blocks apps/crm/src/pages/relatorio-editor` → FAIL.
- [ ] **Step 3:** Implementar.
- [ ] **Step 4:** Mesmo comando + `apps/hub` (`npx vitest run apps/hub/src/pages`) → PASS; `deno test --no-check supabase/functions/_shared/report-docs/` → PASS.
- [ ] **Step 5:** Commit `feat(relatorios): bloco Saúde do Instagram`.

### Task 5: Verificação

- [ ] **Step 1:** lint, format:check, os cinco `tsc`, `npm run test`, `check:functions`, `test:functions`, `test:db` (stack própria) → verdes.
- [ ] **Step 2:** Browser pane: editor de modelo (`/relatorios/modelos/...`, usa a fixture de amostra) → adicionar "Saúde do Instagram" pelo drawer na seção Instagram, conferir render claro/escuro e com accent claro; Hub `RelatorioDocPage` com snapshot da fixture (fetch patch). Screenshot.
- [ ] **Step 3:** Atualizar a descrição do PR #878: nova migration e `report-docs` na ordem de deploy (migration → merge → `report-docs` depois do deploy de produção da Vercel).
