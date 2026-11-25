# Saúde do Instagram vs contas do mesmo tamanho Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cartão "Seu Instagram está indo bem?" na Analytics da conta, comparando 4 métricas da conta
com contas da mesma faixa de seguidores (referência de mercado ou dados agregados do Mesaas).

**Architecture:** As 4 métricas são calculadas só em SQL (`ig_account_health_metrics`), usadas pelo
cron noturno que monta `ig_peer_benchmarks` (99 cortes percentis por faixa e métrica) e pela RPC
`ig_account_health` que o CRM chama. O CRM só posiciona o valor nos cortes, escolhe o veredito e
renderiza.

**Tech Stack:** Postgres (pg_cron, SQL/plpgsql), psql entitlement suites, Deno edge functions, React 19
+ TanStack Query + Tailwind/shadcn, Vitest + Testing Library, lucide-react.

**Spec:** `docs/superpowers/specs/2026-11-25-ig-account-health-design.md` (ler inteiro antes de
qualquer task; as definições das métricas, os limiares e as copys vêm de lá).

## Global Constraints

- Faixas: `lt1k` (< 1000), `1k_5k` (1000–4999), `5k_20k` (5000–19999), `20k_100k` (20000–99999), `100k_plus` (≥ 100000).
- Post de feed: `media_type in ('IMAGE','VIDEO','CAROUSEL_ALBUM')`. Reel: `media_product_type = 'REELS'` ou (`media_product_type is null and media_type = 'VIDEO'`).
- Janelas: 30 e 90 dias contados de `now()`; "12 mais recentes" = 12 posts de feed (ou reels) mais recentes dentro dos 90 dias.
- Piso de amostra Mesaas: `n >= 30` por (faixa, métrica). Cortes: 99 valores p1..p99.
- Chave `platform_settings.ig_peer_benchmarks_mesaas = {"enabled": false}` por padrão; desligada, nenhuma linha `mesaas` é gravada.
- Vereditos: ≥80 Muito bom, 60–79 Bom, 40–59 Na média, 20–39 Ruim, <20 Muito ruim.
- Copy em pt-BR, sem travessão (em-dash) em texto visível. Ícones só `lucide-react`. Toasts `sonner` (não deve haver nenhum aqui).
- Migrations: prefixo de versão único; renumerar acima da cauda de `main` antes de abrir o PR.
- Antes de push: `npm run lint`, `npm run format:check`, os cinco `tsc` do CLAUDE.md, `npm run test`, `npm run check:functions`, `npm run test:functions`, `npm run test:db` (Docker/colima).

## Review Focus

1. Conta com muitos posts de valor 0 (ex.: 0 posts em 30 dias) contra cortes quase todos 0: percentil tem de sair do posto médio (Task 4), nunca 0 nem 99.
2. Conta sem reels, ou com `impressions` indisponível em todos: `reel_views` nulo, cartão "Sem dados suficientes", veredito geral com 3 métricas e texto "Somando as 3 métricas" (Task 4 e Task 6).
3. Faixa sem linha de benchmark (nem mercado nem Mesaas) para alguma métrica: cartão mostra só "Você" e "Ainda sem referência", métrica fora da média; todas sem linha → cartão vazio, sem crash (Task 6).
4. Usuário restrito por "acesso por cliente" abrindo cliente não atribuído: a RPC não pode devolver métricas (RLS do invoker) (Task 2).
5. Melhor post fora do período selecionado na página: "Ver o post" ainda abre o post (busca por id) no desktop e no phone (Task 7).

---

### Task 1: Persistir `media_product_type`

**Files:**
- Create: `supabase/migrations/20261201000001_instagram_posts_media_product_type.sql`
- Modify: `supabase/functions/instagram-sync-cron/index.ts:323-336` (objeto do upsert)
- Modify: `supabase/functions/instagram-integration/index.ts:540` e `:867` (os dois objetos de upsert)
- Test: `supabase/functions/__tests__/` (o teste existente que cobre o shape do upsert do sync, se houver; senão só `check:functions`)

**Interfaces:**
- Produces: coluna `instagram_posts.media_product_type text null`.

- [ ] **Step 1:** Migration: `alter table public.instagram_posts add column if not exists media_product_type text;` com comentário dizendo que nulo = post sincronizado antes da coluna. Conferir se `instagram_posts` tem GRANT por coluna (grep `grant select (` em migrations); se tiver, incluir a coluna nova.
- [ ] **Step 2:** Nos três upserts, adicionar `media_product_type: post.media_product_type ?? null`. Rodar `grep -rn "from('instagram_posts')" supabase/functions | xargs grep -l upsert` e confirmar que não há outro upsert com `media_type` vindo da Graph API (os de `instagram-analytics` são leituras).
- [ ] **Step 3:** Se existir teste Deno que afirma o objeto do upsert (grep `instagram_post_id` em `supabase/functions/__tests__`), acrescentar a asserção `media_product_type: 'REELS'` para um post de reel.
- [ ] **Step 4:** `npm run check:functions && npm run test:functions` → PASS.
- [ ] **Step 5:** Commit `feat(instagram): persiste media_product_type dos posts`.

### Task 2: Métricas em SQL + RPC do CRM

**Files:**
- Create: `supabase/migrations/20261201000002_ig_account_health_metrics.sql`
- Create: `supabase/tests/entitlements/99_ig_account_health_metrics.sql`

**Interfaces:**
- Consumes: `instagram_posts.media_product_type` (Task 1).
- Produces:
  - `public.ig_follower_band(p_followers int) returns text` IMMUTABLE (null para ≤ 0).
  - `public.ig_account_health_metrics(p_account_id uuid) returns table(engagement_rate numeric, posts_30d int, reel_views numeric, reels_share numeric, best_post_id uuid, best_post_ratio numeric)` STABLE, SECURITY INVOKER, `search_path = public`. EXECUTE só `service_role` e `postgres` (o CRM nunca chama direto).
  - `public.ig_account_health(p_client_id bigint) returns jsonb` STABLE, SECURITY INVOKER, EXECUTE para `authenticated` (revogado de `public`, `anon`). Retorno: `null` se não houver `instagram_accounts` visível para o cliente; senão
    `{"followers": int, "band": text|null, "metrics": {"engagement_rate": num|null, "posts_30d": int|null, "reel_views": num|null, "reels_share": num|null}, "best_post": {"id": uuid, "ratio": num}|null, "benchmarks": [{"metric": text, "source": "mercado"|"mesaas", "sample_size": int|null, "cuts": num[]}]}`.
    `benchmarks` lê `ig_peer_benchmarks` filtrando pela faixa. A tabela `ig_peer_benchmarks` (só DDL, RLS e grants) nasce **nesta** migration, vazia; a Task 3 adiciona a irmã de mercado, o seed, o refresh e o cron.

Definições (copiar do spec, §"As 4 métricas"): `engagement_rate` = mediana(likes+comments) dos 12 feed mais recentes em 90 d ÷ followers, nulo se < 3 posts ou followers ≤ 0; `posts_30d` = contagem de feed em 30 d, nulo se nenhum feed em 90 d; `reel_views` = mediana de `impressions` dos 12 reels mais recentes em 90 d sem `'impressions' = any(unavailable_metrics)`, nulo se < 3; `reels_share` = reels ÷ feed nos 12 feed mais recentes em 90 d, nulo se < 3; melhor post = maior (likes+comments) em 30 d ÷ mediana(likes+comments) de todos os feed em 90 d, nulo se < 2 posts em 30 d ou mediana 0. Mediana = `percentile_cont(0.5)`.

- [ ] **Step 1: Suite psql falhando** em `99_ig_account_health_metrics.sql` (padrão de `99_youtube_history.sql`: `\i _helpers.sql`, `et_make_workspace`, blocos `begin … rollback`). Casos, cada um com `assert`:
  - conta 10.000 seguidores, 12 feed em 90 d com likes+comments = 100..210 (passo 10) → `engagement_rate = 0.0155` (mediana 155 ÷ 10000).
  - 8 feed em 30 d + 4 entre 31 e 89 d → `posts_30d = 8`; nenhum feed em 90 d → `posts_30d is null`.
  - 2 reels → `reel_views is null`; 3 reels com impressions 1000/2000/3000 → `2000`; um reel com `unavailable_metrics = '{impressions}'` fica fora.
  - reel por `media_product_type='REELS'` e por `VIDEO` com nulo contam; `VIDEO` com `media_product_type='FEED'` não conta.
  - 12 feed, 8 reels → `reels_share = 0.6667` (arredondar a 4 casas no assert).
  - posts com `media_type='STORY'` são ignorados em tudo.
  - melhor post: 30 d com 100, 140; 90 d mediana 100 → `best_post_ratio = 1.4` e `best_post_id` = o de 140.
  - `ig_follower_band`: 999→`lt1k`, 1000→`1k_5k`, 19999→`5k_20k`, 20000→`20k_100k`, 100000→`100k_plus`, 0→null.
  - RLS: membro do workspace A chamando `ig_account_health` de cliente do workspace B recebe `null`; membro restrito (`client_scope='atribuidos'`) sem atribuição ao cliente recebe `null`; `anon` não tem EXECUTE; `authenticated` não tem EXECUTE em `ig_account_health_metrics`.
- [ ] **Step 2:** `npm run test:db` → FAIL (funções inexistentes).
- [ ] **Step 3:** Escrever a migration (DDL de `ig_peer_benchmarks` conforme spec §Tabela com `cuts numeric[] not null check (array_length(cuts,1) = 99)`, RLS ligada, `revoke all … from public, anon, authenticated`, `grant select … to authenticated`, policy `select using (true)`; depois as três funções).
- [ ] **Step 4:** `npm run test:db` → PASS.
- [ ] **Step 5:** Commit `feat(db): métricas de saúde do Instagram e RPC ig_account_health`.

### Task 3: Referências de mercado, refresh e cron

**Files:**
- Create: `supabase/migrations/20261201000003_ig_peer_benchmarks.sql`
- Create: `supabase/tests/entitlements/99_ig_peer_benchmarks.sql`

**Interfaces:**
- Consumes: `ig_peer_benchmarks`, `ig_follower_band`, `ig_account_health_metrics` (Task 2).
- Produces: `ig_peer_benchmarks_mercado(band, metric, cuts, computed_at, source_note text)` (sem grant ao CRM); `public.ig_peer_benchmarks_refresh() returns void` SECURITY DEFINER, `search_path = public`, EXECUTE revogado de `public, anon, authenticated`; chave `ig_peer_benchmarks_mesaas`; job `cron.schedule('ig-peer-benchmarks-refresh', '53 6 * * *', $$select public.ig_peer_benchmarks_refresh()$$)`.

- [ ] **Step 1: Pesquisa do seed.** Para cada (faixa, métrica), procurar benchmark público (WebSearch) o mais próximo possível da definição do spec (diferença de definição é aceita e registrada; decisão do usuário) (ex.: engajamento por post = (likes+comments) ÷ seguidores, por faixa de seguidores; posts de feed por mês ou por semana × 30/7; mediana de views de reels por faixa; % de reels no feed). Registrar fonte, ano e valores num rascunho. Sem nenhuma fonte → a linha não entra. Gerar os 99 cortes: com mediana m e quartis q1,q3, ajustar log-normal (`mu = ln m`, `sigma = (ln q3 - ln q1)/1.349`); só mediana, usar `sigma` de outra faixa da mesma métrica e fonte e dizer isso no comentário; `reels_share` em logit-normal limitada a 0..1; `posts_30d` arredondado para inteiro. Script do cálculo fica fora do repo (scratchpad); só os números entram.
- [ ] **Step 2: Suite psql falhando** em `99_ig_peer_benchmarks.sql`:
  - grants: `authenticated` tem SELECT em `ig_peer_benchmarks` e nenhum INSERT/UPDATE/DELETE; não tem SELECT em `ig_peer_benchmarks_mercado`; `anon` sem SELECT em ambas; `authenticated` sem EXECUTE no refresh. (Excluir as duas tabelas de `et_grant_hosted_parity`, como em `99_youtube_history.sql`.)
  - depois da migration, `ig_peer_benchmarks` = cópia exata das linhas de mercado (`source='mercado'`, `sample_size is null`).
  - refresh com 29 contas elegíveis na faixa `5k_20k` e chave ligada → linha `engagement_rate/5k_20k` continua `mercado`.
  - 30 contas e chave ligada → `source='mesaas'`, `sample_size=30`, `array_length(cuts,1)=99`, `cuts[50]` = mediana das 30.
  - 30 contas e chave desligada → `mercado`.
  - duas linhas de `instagram_accounts` com o mesmo `instagram_user_id` contam como 1 (só a de `last_synced_at` mais recente).
  - conta com `last_synced_at` de 15 dias atrás fica fora; `follower_count = 0` fica fora.
  - (faixa, métrica) sem mercado e com < 30 contas → sem linha; com ≥ 30 → linha `mesaas`.
  - cron: `select 1 from cron.job where jobname = 'ig-peer-benchmarks-refresh' and schedule = '53 6 * * *'`.
- [ ] **Step 3:** `npm run test:db` → FAIL.
- [ ] **Step 4:** Migration: tabela de mercado + seed com comentário por linha (fonte, ano, se é estimativa e de quê); `insert … on conflict` da chave; cópia inicial mercado → `ig_peer_benchmarks`; função de refresh (CTE de contas elegíveis com `distinct on (instagram_user_id) … order by instagram_user_id, last_synced_at desc`, `lateral ig_account_health_metrics(a.id)`, `percentile_cont(array[0.01,…,0.99]) within group`, depois `delete` + `insert` numa transação); `cron.schedule`. Conferir que o minuto 53 segue livre (`grep -rh "cron.schedule(" supabase/migrations`).
- [ ] **Step 5:** `npm run test:db` → PASS.
- [ ] **Step 6:** Commit `feat(db): referências de contas do mesmo tamanho para o Instagram`.

### Task 4: Lógica pura do cartão

**Files:**
- Create: `apps/crm/src/lib/ig-account-health.ts`
- Test: `apps/crm/src/lib/__tests__/ig-account-health.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export type HealthMetricKey = 'engagement_rate' | 'posts_30d' | 'reel_views' | 'reels_share';
  export type FollowerBand = 'lt1k' | '1k_5k' | '5k_20k' | '20k_100k' | '100k_plus';
  export type BenchmarkSource = 'mercado' | 'mesaas';
  export interface PeerBenchmark { metric: HealthMetricKey; source: BenchmarkSource; sample_size: number | null; cuts: number[] }
  export type VerdictTone = 'great' | 'good' | 'avg' | 'bad' | 'worst';
  export interface Verdict { label: string; tone: VerdictTone }
  export function percentileFromCuts(value: number, cuts: number[]): number; // 0..100 inteiro
  export function verdictFor(pct: number): Verdict;
  export function overallPercentile(pcts: number[]): number | null; // média arredondada; null se vazio
  export function bandLabel(band: FollowerBand): string;
  export function roundedSampleLabel(n: number): string;
  export function formatMetric(key: HealthMetricKey, v: number): string;
  ```

- [ ] **Step 1: Testes falhando:**
  - `percentileFromCuts(0, [0×40, 1..59 em sequência])` → `21` (lt=0, eq=40 → 0+20+0,5 = 20,5 → arredonda 21). Cortes 1..99 (`cuts[i]=i+1`): valor 50 → `50`; 50,5 → `51` (interpolação 50,5 → arredonda); valor -1 → `0`; valor 1000 → `100`; valor 0,5 (abaixo de p1=1, com cuts[0]=1) → `1` (entre 0 e 1, 0,5 → arredonda 1).
  - `verdictFor`: 80→Muito bom/great, 79→Bom/good, 60→Bom, 59→Na média/avg, 40→Na média, 39→Ruim/bad, 20→Ruim, 19→Muito ruim/worst.
  - `overallPercentile([96,34,81,71])` → `71`; `[]` → `null`.
  - `bandLabel('5k_20k')` → `'de 5 mil a 20 mil seguidores'`; `'lt1k'` → `'com menos de 1 mil seguidores'`; `'100k_plus'` → `'com mais de 100 mil seguidores'`; `'1k_5k'` → `'de 1 mil a 5 mil seguidores'`; `'20k_100k'` → `'de 20 mil a 100 mil seguidores'`.
  - `roundedSampleLabel`: 344→`'mais de 300'`, 300→`'mais de 200'`, 100→`'mais de 90'`, 47→`'mais de 40'`, 30→`'mais de 20'` (maior múltiplo de 100, ou de 10 abaixo de 100, estritamente menor que n).
  - `formatMetric`: engagement 0,0193→`'1,93%'`; posts_30d 8→`'8'`; reel_views 3816→`'3.816'`; reels_share 0,667→`'67%'`.
- [ ] **Step 2:** `npx vitest run apps/crm/src/lib/__tests__/ig-account-health.test.ts` → FAIL.
- [ ] **Step 3:** Implementar. `percentileFromCuts`: cortes em p = i+1 (i = índice 0..98). `lt = #(c < v)`, `eq = #(c == v)`. Se `eq > 0`: `lt + eq/2 + 0.5`. Senão: `v < cuts[0]` → `v/cuts[0]` limitado a 0..1 se `cuts[0] > 0`, senão 0; `v > cuts[98]` → 100; senão interpolar entre o corte k (p=k+1) e k+1 (p=k+2). `Math.round`, limitar a 0..100. Formatação com `Intl.NumberFormat('pt-BR')`.
- [ ] **Step 4:** Mesmo comando → PASS.
- [ ] **Step 5:** Commit `feat(analytics): cálculo do percentil e vereditos da saúde do Instagram`.

### Task 5: Leitura no data layer

**Files:**
- Modify: `apps/crm/src/services/analytics.ts` (perto de `getClientRateBaseline`, linha ~857)
- Test: `apps/crm/src/services/__tests__/analytics.accountHealth.test.ts` (seguir o mock de supabase já usado nos testes de `services/`)

**Interfaces:**
- Consumes: tipos da Task 4; RPC `ig_account_health` (Task 2).
- Produces:
  ```ts
  export interface AccountHealth {
    followers: number; band: FollowerBand | null;
    metrics: Record<HealthMetricKey, number | null>;
    bestPost: { id: string; ratio: number } | null;
    benchmarks: Partial<Record<HealthMetricKey, PeerBenchmark>>;
  }
  export async function getAccountHealth(clientId: number): Promise<AccountHealth | null>;
  export async function getPostAnalyticsById(clientId: number, postId: string): Promise<PostAnalytics | null>;
  ```
- [ ] **Step 1: Testes falhando:** `getAccountHealth` chama `supabase.rpc('ig_account_health', { p_client_id: 7 })`, converte `best_post` → `bestPost`, a lista `benchmarks` → objeto por `metric`, `numeric` em string → number (PostgREST devolve numeric como number em jsonb, mas cuts podem vir como string: `Number()` em cada); RPC `null` → `null`; erro → lança.
- [ ] **Step 2:** `npx vitest run <arquivo>` → FAIL.
- [ ] **Step 3:** Implementar. `getPostAnalyticsById` reaproveita o mapeamento por post de `getPostsAnalytics` (extrair a parte que monta um `PostAnalytics` a partir da linha + tags numa função interna, sem mudar o comportamento de `getPostsAnalytics`), consultando `instagram_posts` por `id` e `instagram_account_id`.
- [ ] **Step 4:** `npx vitest run apps/crm/src/services` → PASS (inclui os testes existentes de `getPostsAnalytics`).
- [ ] **Step 5:** Commit `feat(analytics): leitura da saúde da conta e post por id`.

### Task 6: Componente do cartão

**Files:**
- Create: `apps/crm/src/pages/analytics-conta/health/AccountHealthCard.tsx`
- Create: `apps/crm/src/pages/analytics-conta/health/HealthBar.tsx`
- Modify: `apps/crm/app.css` (classes `.ig-health-*`, só shell logado; tons pelos tokens legados `--success`, `--warning`, `--danger`, `--danger-text`, `--text-muted`, `--border-color`, `--card-bg`, claro e `[data-theme='dark']`)
- Test: `apps/crm/src/pages/analytics-conta/health/__tests__/AccountHealthCard.test.tsx`

**Interfaces:**
- Consumes: Task 4, `AccountHealth` (Task 5).
- Produces: `export function AccountHealthCard(props: { health: AccountHealth | null | undefined; isLoading: boolean; onOpenPost: (postId: string) => void; layout?: 'desktop' | 'phone' }): JSX.Element | null`.

Copy exata (do spec e dos mockups `https://claude.ai/artifact/49SBsuR8bs6bnmGWGmkzCq`):
- Título "Seu Instagram está indo bem?"; resumo "Somando as {N} métricas, você está à frente de {cerca de }{X}% das contas do seu tamanho." ("cerca de " quando todas as métricas usadas são `mercado`; N = métricas com valor e benchmark).
- Linha de destaque pela métrica de maior percentil:
  engagement "Seu engajamento é {v} por post; em contas do seu tamanho é {p}." · posts "Você publicou {v} posts em 30 dias; contas do seu tamanho publicam {p}." · reels "Seus reels têm {v} visualizações; em contas do seu tamanho, {p}." · share "Reels são {v} do seu feed; em contas do seu tamanho, {p}."
- Rótulos: "Taxa de engajamento", "Posts em 30 dias", "Visualizações nos reels", "Reels no seu feed". Linha "À frente de {cerca de }{X}% das contas do seu tamanho". "Você:" e "Contas do seu tamanho*:" / "†:" (p50 = `cuts[49]`). Ajuda do engajamento: "Mediana de curtidas + comentários dos seus posts recentes ÷ seguidores."
- Métrica nula: "Sem dados suficientes." + motivo: engagement/share "Precisa de pelo menos 3 posts nos últimos 90 dias.", reels "Precisa de pelo menos 3 reels nos últimos 90 dias.".
- Valor sem benchmark: "Você: {v}" + "Ainda sem referência para contas do seu tamanho."
- Rodapé: `*Comparado com {roundedSampleLabel(min sample_size mesaas)} contas do seu tamanho no Mesaas ({bandLabel}).` e/ou `†Estimativa de mercado para contas {bandLabel}, a partir de estudos públicos com métricas parecidas.`. Selo por métrica ("Mesaas"/"Mercado") só quando as fontes estão misturadas.
- Melhor post: "Seu melhor post dos últimos 30 dias teve {ratio com 1 casa, vírgula}x o resultado normal da sua conta." + botão-link "Ver o post" → `onOpenPost(id)`.
- Vazio (`followers <= 0`, `band` nulo ou as 4 métricas nulas): "Ainda não dá para comparar" / "Publique alguns posts e sincronize. A comparação aparece quando a conta tiver posts de feed nos últimos 90 dias."
- `health === null` (sem conta) → `null`. `isLoading` → skeleton (`components/ui/skeletons` ou `Skeleton`).
- Ícones: `TrendingUp` (great/good), `Minus` (avg), `TrendingDown` (bad/worst). Barra com `role="img"` e `aria-label="À frente de X% das contas do seu tamanho"`.

- [ ] **Step 1: Testes falhando** (`render` + `screen`):
  - fixture do print (followers 9274, 5k_20k, todas `mesaas` n=344, valores que dão 96/34/81/71): mostra "Bom", "Somando as 4 métricas, você está à frente de 71% das contas do seu tamanho.", "Muito bom" duas vezes, "Ruim" uma, rodapé "*Comparado com mais de 300 contas do seu tamanho no Mesaas (de 5 mil a 20 mil seguidores)." e nenhum "Mercado".
  - todas `mercado`: "à frente de cerca de", rodapé "†Estimativa de mercado para contas de 5 mil a 20 mil seguidores, a partir de estudos públicos com métricas parecidas.".
  - mistas: selos "Mesaas" e "Mercado", as duas linhas de rodapé.
  - `reel_views: null`: "Sem dados suficientes." e "Somando as 3 métricas".
  - benchmark ausente para `reels_share`: "Ainda sem referência para contas do seu tamanho." e "Somando as 3 métricas".
  - vazio e `null` (renderiza nada); clique em "Ver o post" chama `onOpenPost('post-uuid')`; `bestPost: null` sem a frase.
  - nenhum texto renderizado contém "—".
- [ ] **Step 2:** `npx vitest run apps/crm/src/pages/analytics-conta/health` → FAIL.
- [ ] **Step 3:** Implementar seguindo o layout dos mockups (topo centralizado, grade 2×2 `layout='desktop'`, 1 coluna `layout='phone'`). As classes novas vão em `app.css` (só shell logado); `npx vitest run apps/crm/src/__tests__/cssSplitBoundary.test.ts apps/crm/src/__tests__/phoneShellCss.test.ts` tem de seguir verde.
- [ ] **Step 4:** Mesmos comandos → PASS.
- [ ] **Step 5:** Commit `feat(analytics): cartão Seu Instagram está indo bem?`.

### Task 7: Encaixe na página (desktop e phone)

**Files:**
- Modify: `apps/crm/src/pages/analytics-conta/AnalyticsContaPage.tsx` (query perto da linha 960; render logo antes do `<StatCardGrid>` da linha ~1454; `openPostId`/`heldPost` ~925/1011; invalidação no sync ~1227)
- Modify: `apps/crm/src/pages/analytics-conta/phone/ContaPhone.tsx` (props; `selectedPostId`/`selectedPost` ~260; topo da visão geral)
- Test: `apps/crm/src/pages/analytics-conta/__tests__/AnalyticsContaPage.test.tsx` e `AnalyticsContaPage.phone.test.tsx` (acrescentar casos)

**Interfaces:**
- Consumes: `getAccountHealth`, `getPostAnalyticsById` (Task 5), `AccountHealthCard` (Task 6).

- [ ] **Step 1: Testes falhando:**
  - desktop: com `getAccountHealth` mockado, o cartão aparece antes da grade de KPIs; erro na RPC → cartão some e o resto da página renderiza; clique em "Ver o post" de um post que não está em `getPostsAnalytics` chama `getPostAnalyticsById` e abre o `PostMetricsDialog` com ele.
  - phone: o cartão aparece no `ContaPhone` com `layout='phone'`; "Ver o post" abre o `PostDetailSheet` (também para post fora da lista).
  - "Sincronizar" invalida `['ig-account-health', clientId]`.
- [ ] **Step 2:** `npx vitest run apps/crm/src/pages/analytics-conta/__tests__` → FAIL.
- [ ] **Step 3:** Implementar. Query `useQuery({ queryKey: ['ig-account-health', clientId], queryFn: () => getAccountHealth(clientId), staleTime: 3_600_000, retry: false })`, compartilhada pelos dois shells (a página já decide qual shell renderiza; passar o resultado ao `ContaPhone` por prop, sem segunda query). Post fora da lista: desktop usa `heldPost` (buscar por id e `setHeldPost` antes de `setOpenPostId`); phone ganha o mesmo fallback (`selectedPost` cai para um post buscado por id quando `posts.find` não acha).
- [ ] **Step 4:** Mesmo comando → PASS.
- [ ] **Step 5:** Commit `feat(analytics): saúde do Instagram na Analytics da conta`.

### Task 8: Política de Privacidade

**Files:**
- Modify: `apps/crm/src/pages/politica-privacidade/PoliticaPage.tsx:129-133`
- Modify: `apps/crm/src/pages/politica-privacidade/__tests__/PoliticaPage.test.tsx`
- Modify: espelho `.seo.ts` da página, se existir (`ls apps/crm/src/pages/politica-privacidade` e grep da frase antiga em `apps/crm/src`)

- [ ] **Step 1: Teste falhando:** a página contém o parágrafo novo do spec §Privacidade (citação exata) e não contém "somente para mostrar o desempenho da conta".
- [ ] **Step 2:** `npx vitest run apps/crm/src/pages/politica-privacidade` → FAIL.
- [ ] **Step 3:** Trocar o parágrafo pelo texto do spec, palavra por palavra; `grep -rn "somente para mostrar o desempenho" apps/ supabase/` sem resultado.
- [ ] **Step 4:** Mesmo comando → PASS.
- [ ] **Step 5:** Commit `docs(legal): política cita referências agregadas do Instagram`.

### Task 9: Verificação final

- [ ] **Step 1:** `npm run lint && npm run format:check` e os cinco `tsc` (`apps/crm`, `apps/hub`, `apps/admin`, `apps/mcp-widgets`, `tsconfig.scripts.json`) → sem erro.
- [ ] **Step 2:** `npm run test && npm run check:functions && npm run test:functions && npm run test:db` → PASS.
- [ ] **Step 3:** Browser pane (`npm run dev:env`, login de seed conforme a memória do projeto) na Analytics da conta de um cliente com Instagram: cartão no topo, claro e escuro, Vidro e clássico, `resize_window` mobile (phone shell, uma coluna), "Ver o post" abre o post. Contra prod as migrations ainda não existem: interceptar a RPC (`fetch` patch no pane) com a fixture do print para ver o cartão preenchido; screenshot como prova.
- [ ] **Step 4:** Renumerar as três migrations acima da cauda de `main` (`git fetch && ls` em `origin/main:supabase/migrations`) e commitar.

## Deploy (para o PR, não é task)

Migrations `…01`→`…03` (staging, depois prod) → `instagram-sync-cron` e `instagram-integration` (com `--no-verify-jwt`, como hoje) → merge → depois da política no ar, `update platform_settings set value = '{"enabled": true}' where key = 'ig_peer_benchmarks_mesaas'`. Rollback: desligar a chave, depois o frontend; tabelas, coluna e funções ficam.
