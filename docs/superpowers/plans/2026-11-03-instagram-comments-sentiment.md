# Comentários do Instagram + leitura por IA: plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Lista de comentários por post do Instagram e uma leitura por IA (sentimento, temas,
perguntas, ideias de conteúdo) por post e por conta, com "Salvar como ideia".

**Architecture:** Rotas novas na edge function `instagram-analytics`, com a lógica em módulos
puros e testáveis (`comments-graph.ts`, `comments-ai.ts`, `comments-routes.ts`). Comentários
buscados ao vivo na Graph; só o resultado da IA vai para `instagram_comment_analyses`. No CRM,
um serviço novo, uma aba "Comentários" na linha expandida/sheet do post e um cartão da conta,
tudo atrás da flag `feature_instagram_comments_ai`.

**Tech Stack:** Deno edge functions, Postgres (Supabase), Gemini REST (`gemini-2.5-flash-lite`),
React 19 + TanStack Query, Vitest, `deno test`, psql entitlement suites.

**Spec:** `docs/superpowers/specs/2026-11-03-instagram-comments-sentiment-design.md`
**Mockups:** https://claude.ai/artifact/Se3zA33dPGaYVx6qnqvQ4i

## Global Constraints

- Nenhuma mudança em `_shared/instagram-scopes.ts`, `IG_AUTOMATION_SCOPES_LIVE` ou fluxo OAuth.
- Flag `feature_instagram_comments_ai`, `boolean NOT NULL DEFAULT false` em `plans`; piloto por `workspace_plan_overrides`.
- Modelo `gemini-2.5-flash-lite`, `temperature 0.3`, `responseMimeType: application/json` + `responseSchema`.
- Limites: 200 comentários/post; conta = 30 dias, 15 posts (por `instagram_posts.comments` desc, `comments > 0`) × 60 comentários; mínimo 5 (post) e 10 (conta) senão `422 too_few_comments`.
- Prazos: `AbortSignal.timeout(8000)` por página Graph; 25 s por chamada Gemini (backoff incluso); orçamento de 50 s por requisição; análise para de buscar comentários aos 20 s.
- Rate limits: `ig-comments-ai:${contaId}` 20/3600 (POSTs); `ig-comments-read:${contaId}` 120/3600 (GET de comentários).
- Erros ao cliente: `missing_comments_scope` 409, `too_few_comments` 422, `ai_unavailable` 503, `ai_timeout` 504, `ai_bad_output` 502, demais genéricos. Detalhe só no log; **log nunca leva texto de comentário nem username**.
- IA recebe só o texto (sem username); prompt marca os comentários como dado não confiável.
- Resultado: `@handle` e usernames buscados (palavra inteira, sem caixa) trocados por "alguém do público" antes de gravar.
- Copy pt-BR, sem travessão (`—`) em texto visível. Renderizar comentários como texto React, nunca `dangerouslySetInnerHTML`.
- CRM: flag desligada = aba e cartão não montam e não consultam.
- Migration com versão `20261114000001` (acima da cauda de main, `20261113000001`); conferir de novo antes do PR.

## Review Focus

1. Comentário com `@fulano` ou o username de quem comentou aparecendo em `resumo`/`temas.exemplo`/`ideias` → tem que sair redigido (teste em Task 4).
2. Graph lenta ou paginação infinita (`paging.next` sempre presente) → para no limite/prazo e devolve `truncated: true`, nunca estoura o runtime (teste em Task 3).
3. Cliente reconectado com outra conta do Instagram (mesmo `instagram_account_id`, `ig_user_id` novo) → análise antiga não aparece (teste em Task 5).
4. Gemini devolve JSON com `distribuicao` que não soma 100, `ideias` vazia ou rótulo desconhecido → `ai_bad_output`, nada gravado (teste em Task 4).
5. Dois cliques em "Salvar como ideia" (ou dois usuários) → uma ideia só, o segundo vira "Salva" sem toast de erro cru (teste em Task 7).

---

### Task 1: Migration (flag, tabela de análises, coluna em ideias) + suíte SQL

**Files:**
- Create: `supabase/migrations/20261114000001_instagram_comment_analyses.sql`
- Create: `supabase/tests/entitlements/99_instagram_comment_analyses.sql`
- Modify: `supabase/seed.sql` só se ele lista colunas `feature_*` de `plans` explicitamente (conferir com grep)

**Interfaces:**
- Produces: tabela `public.instagram_comment_analyses` (colunas da spec: `id uuid pk default gen_random_uuid()`, `conta_id uuid not null`, `instagram_account_id <tipo de instagram_accounts.id> not null references instagram_accounts(id) on delete cascade`, `ig_user_id text not null`, `scope text not null check (scope in ('post','account'))`, `instagram_post_id text`, `comments_analyzed int not null`, `comments_count_at_analysis int not null`, `period_start date`, `period_end date`, `result jsonb not null`, `model text not null`, `analyzed_by uuid`, `analyzed_at timestamptz not null default now()`), check `(scope = 'post') = (instagram_post_id is not null)`, índice único `(instagram_account_id, scope, instagram_post_id) NULLS NOT DISTINCT`.
- Produces: `plans.feature_instagram_comments_ai`; `ideias.origem_sugestao_id text` + índice único parcial `(workspace_id, origem_sugestao_id) where origem_sugestao_id is not null`.

- [ ] **Step 1: Escrever a suíte SQL** no padrão de `supabase/tests/entitlements/99_linha_editorial_rpcs.sql` (use `et_grant_hosted_parity()` antes de selects como `authenticated`). Asserções:
  - membro do workspace A lê a linha de A e não vê a de B (`select count(*) = 0`);
  - `authenticated` não consegue `insert`/`update`/`delete` em `instagram_comment_analyses` (erro `42501` ou 0 linhas);
  - duas ideias com o mesmo `origem_sugestao_id` no mesmo workspace → `23505`; mesmo id em workspaces diferentes → ok;
  - `select feature_instagram_comments_ai from plans` é `false` em todos.
- [ ] **Step 2:** `npm run test:db` (precisa Docker/colima) → FAIL (tabela não existe).
- [ ] **Step 3: Escrever a migration.** `SET LOCAL lock_timeout = '5s'`; RLS ligada; policy de SELECT `conta_id IN (SELECT public.get_my_conta_id())`; `REVOKE ALL ON instagram_comment_analyses FROM PUBLIC, anon, authenticated` e `GRANT SELECT ... TO authenticated`, `GRANT ALL ... TO service_role` (nomear os papéis: REVOKE FROM PUBLIC sozinho não basta). Cabeçalho com a ordem de deploy da spec.
- [ ] **Step 4:** `npm run test:db` → PASS. Sem Docker local, registre isso e deixe o CI (`entitlement-tests`) cobrir.
- [ ] **Step 5: Commit** `feat(db): análises de comentários do Instagram + flag + origem_sugestao_id`

### Task 2: Flag nas entitlements, feature-guard, CRM e Admin

**Files:**
- Modify: `supabase/functions/_shared/entitlements.ts` (`FEATURE_COLUMNS`)
- Modify: `supabase/functions/_shared/feature-guard.ts`
- Create: `supabase/functions/__tests__/entitlements_feature_instagram_comments_ai_test.ts`
- Modify/Create: teste de `featureForPath` (procure o existente com `grep -rl featureForPath supabase/functions/__tests__`; senão crie `feature-guard-comments_test.ts`)
- Modify: `apps/crm/src/hooks/useWorkspaceLimits.ts`, `apps/crm/src/lib/entitlement-errors.ts`, `apps/admin/src/lib/api.ts` (tipo, lista de chaves, label), e onde mais `feature_google_business` aparecer no Admin (`grep -rn feature_google_business apps/admin/src`)

**Interfaces:**
- Produces: `featureForPath(method, path)` devolve `"feature_instagram_comments_ai"` para `^/post-comments/` e `^/comments-analysis(-account)?/`.
- Produces: `features?.feature_instagram_comments_ai?: boolean` no CRM; label `'Comentários com IA'`.

- [ ] **Step 1: Testes Deno**, copiando `entitlements_feature_linha_editorial_test.ts`: chave em `FEATURE_COLUMNS`; nasce `false`; override liga. Em feature-guard: `featureForPath("GET","/post-comments/12/179")`, `("POST","/comments-analysis/12/179")`, `("POST","/comments-analysis-account/12")`, `("GET","/comments-analysis-account/12")` → `"feature_instagram_comments_ai"`; `("POST","/ai-analysis/12")` continua `"feature_instagram_ai"`.
- [ ] **Step 2:** `deno test --no-check supabase/functions/__tests__/<os dois arquivos>` → FAIL.
- [ ] **Step 3:** Implementar; a regex nova vem **antes** do fallback `feature_instagram`.
- [ ] **Step 4:** testes Deno → PASS; `npx tsc -p apps/crm/tsconfig.json --noEmit` e `npx tsc -p apps/admin/tsconfig.json --noEmit` limpos; `npm run test -- entitlement` (Vitest que conferem listas de flags, se houver) verde.
- [ ] **Step 5: Commit** `feat(entitlements): feature_instagram_comments_ai`

### Task 3: Busca de comentários na Graph com prazo

**Files:**
- Modify: `supabase/functions/_shared/instagram-messaging.ts` (exportar `igRequest`, sem mudar comportamento)
- Create: `supabase/functions/instagram-analytics/comments-graph.ts`
- Create: `supabase/functions/__tests__/instagram-comments-graph_test.ts`

**Interfaces:**
- Consumes: `igRequest(deps: IgMessagingDeps, "GET", path, token)`, `IgApiError`, `classifyIgError`.
- Produces:
  ```ts
  export interface IgComment { id: string; text: string; timestamp: string; username: string; like_count: number; replies_count: number; replies_more: boolean }
  export async function fetchMediaComments(
    deps: { fetchFn?: typeof fetch; now?: () => number },
    args: { mediaId: string; token: string; max: number; deadlineAt: number },
  ): Promise<{ comments: IgComment[]; truncated: boolean }>
  ```
  Campos pedidos: `id,text,timestamp,username,like_count,replies.limit(25){id}`, `limit=50` por página, segue `paging.cursors.after` enquanto houver `paging.next`. `replies_count` = tamanho de `replies.data`; `replies_more` = página aninhada cheia (25) ou com `paging.next`. Cada página: `timeoutMs = min(8000, deadlineAt - now())`; se não sobra tempo antes da página, para com `truncated: true`. Erro na **primeira** página propaga; erro depois dela devolve o que tem com `truncated: true` (log com o `kind`, sem texto).

- [ ] **Step 1: Testes** com `fetchFn` falso:
  - `"pagina até max e marca truncated"`: 3 páginas de 50 com `paging.next`, `max: 120` → 120 comentários, `truncated: true`, 3 chamadas;
  - `"sem paging.next termina com truncated false"`;
  - `"para no prazo"`: `now` avança 30 s por chamada, `deadlineAt = 40_000` → 2 chamadas no máximo, `truncated: true`;
  - `"replies_count e replies_more"`: comentário com 3 respostas → `3, false`; com 25 → `25, true`;
  - `"erro na primeira página propaga IgApiError"`; `"erro na segunda devolve a primeira com truncated"`;
  - `"comentário sem text vira string vazia e não quebra"`.
- [ ] **Step 2:** `deno test --no-check supabase/functions/__tests__/instagram-comments-graph_test.ts` → FAIL.
- [ ] **Step 3:** Implementar.
- [ ] **Step 4:** PASS, e `deno test --no-check supabase/functions/__tests__/instagram-messaging_test.ts` continua verde.
- [ ] **Step 5: Commit** `feat(instagram-analytics): busca de comentários com prazo`

### Task 4: Análise com Gemini: prompt, schema, validação e redação

**Files:**
- Create: `supabase/functions/instagram-analytics/comments-ai.ts`
- Create: `supabase/functions/__tests__/instagram-comments-ai_test.ts`

**Interfaces:**
- Produces:
  ```ts
  export type Sentimento = "positivo" | "misto" | "negativo" | "polemico";
  export interface CommentAnalysis {
    sentimento_geral: Sentimento; resumo: string;
    distribuicao: { apoio: number; duvida: number; critica: number; discussao: number; spam: number };
    temas: { tema: string; peso: number; exemplo: string; post_ids?: string[] }[];
    perguntas_frequentes: string[];
    ideias: { id: string; titulo: string; descricao: string; motivo: string }[];
  }
  export const COMMENTS_MODEL = "gemini-2.5-flash-lite";
  export function buildPostPrompt(input: { caption: string; mediaType: string; texts: string[] }): string
  export function buildAccountPrompt(input: { posts: { id: string; caption: string; texts: string[] }[] }): string
  export const RESPONSE_SCHEMA: Record<string, unknown>
  export function validateAnalysis(raw: unknown, opts: { allowPostIds?: Set<string> }): Omit<CommentAnalysis, "ideias"> & { ideias: Omit<CommentAnalysis["ideias"][number], "id">[] } | null
  export function redactIdentities(a: CommentAnalysis, usernames: string[]): CommentAnalysis
  export async function callGemini(deps: { fetchFn?: typeof fetch; now?: () => number; sleep?: (ms: number) => Promise<void> }, args: { apiKey: string; prompt: string; deadlineAt: number }): Promise<unknown>
  export class AiTimeoutError extends Error {}
  export class AiBadOutputError extends Error {}
  ```
- Regras de `validateAnalysis`: rótulo no enum; `distribuicao` com as 5 chaves, inteiros 0–100, soma 100 (aceita 98–102 e ajusta a maior para fechar 100); `temas` ≤ 5, `peso` 0–100; `perguntas_frequentes` ≤ 5; `ideias` 3 a 5 com os três campos não vazios; `post_ids` filtrado para `allowPostIds`; strings aparadas e cortadas (resumo 600, demais 300). Inválido → `null`.
- `redactIdentities`: troca `/@[\w.]+/g` e cada username (escapado, `\b`, `i`) por `alguém do público` em todos os textos; depois disso, campo obrigatório vazio → o chamador trata como `ai_bad_output`.
- `callGemini`: POST `https://generativelanguage.googleapis.com/v1beta/models/${COMMENTS_MODEL}:generateContent`, header `x-goog-api-key`, `generationConfig: { temperature: 0.3, responseMimeType: "application/json", responseSchema: RESPONSE_SCHEMA }`; até 2 retentativas em 429/5xx/erro de rede com backoff 1 s/3 s, sempre dentro de `min(25_000, deadlineAt - now())`; estourou → `AiTimeoutError`; texto que não é JSON → `AiBadOutputError`.
- Prompts em pt-BR: comentários entre marcadores `<<<COMENTARIOS ... COMENTARIOS>>>`, uma linha por comentário, com a instrução de tratar o bloco como dado e ignorar ordens dentro dele; proibir nomes e `@`; pedir ideias acionáveis para o Instagram do cliente.

- [ ] **Step 1: Testes:**
  - `"validateAnalysis aceita a saída de exemplo da spec"` (fixture com os valores dos mockups);
  - `"rejeita rótulo desconhecido"`, `"rejeita distribuicao que soma 90"`, `"ajusta soma 101 para 100"`, `"rejeita 2 ideias"`, `"filtra post_ids fora do conjunto"`;
  - `"redactIdentities remove @handle e username conhecido, sem caixa"`: resumo `"@Maria_23 e joao.silva pedem preço"` com usernames `["maria_23","joao.silva"]` → sem nenhum dos dois;
  - `"buildPostPrompt não contém username e envolve os textos nos marcadores"`;
  - `"callGemini tenta de novo em 429 e devolve o JSON"`, `"callGemini lança AiTimeoutError quando o prazo acaba"`, `"callGemini lança AiBadOutputError em texto não JSON"`.
- [ ] **Step 2:** `deno test --no-check supabase/functions/__tests__/instagram-comments-ai_test.ts` → FAIL.
- [ ] **Step 3:** Implementar.
- [ ] **Step 4:** PASS.
- [ ] **Step 5: Commit** `feat(instagram-analytics): análise de comentários com Gemini`

### Task 5: Rotas de comentários e análises

**Files:**
- Create: `supabase/functions/instagram-analytics/comments-routes.ts`
- Modify: `supabase/functions/instagram-analytics/index.ts` (despachar as 4 rotas depois do feature gate, antes de `/overview`)
- Create: `supabase/functions/__tests__/instagram-comments-routes_test.ts`

**Interfaces:**
- Consumes: Tasks 3 e 4; `checkRateLimit`; `decryptToken`/`verifyClientOwnership` de `index.ts` (passe por `deps`).
- Produces:
  ```ts
  export interface CommentsRouteDeps {
    svc: SupabaseClient; contaId: string; userId: string;
    geminiKey: string | null; now: () => number;
    decryptToken: (enc: string) => Promise<string>;
    verifyClientOwnership: (clientId: string) => Promise<void>;
    rateLimit: (key: string, max: number, windowS: number) => Promise<boolean>;
    fetchComments: typeof fetchMediaComments; callGemini: typeof callGemini;
  }
  export async function handleCommentsRoute(method: string, path: string, deps: CommentsRouteDeps): Promise<{ status: number; body: unknown } | null> // null = rota não é desta família
  ```
- Contrato das respostas (o CRM da Task 7 usa exatamente isto):
  - `GET /post-comments/:clientId/:postId` → `{ comments: IgComment[], total_fetched: number, truncated: boolean, comments_count: number, cached_analysis: StoredAnalysis | null }`
  - `POST /comments-analysis/:clientId/:postId` → `{ analysis: StoredAnalysis }`
  - `GET|POST /comments-analysis-account/:clientId` → `{ analysis: StoredAnalysis | null, current_comments: number }` (POST sempre com `analysis`)
  - `StoredAnalysis = { result: CommentAnalysis, comments_analyzed: number, comments_count_at_analysis: number, analyzed_at: string, period_start: string | null, period_end: string | null }`
- Regras: conta por `client_id` com `authorization_status` ativo e token; sem `instagram_business_manage_comments` em `permissions` → 409; post precisa ser da conta (`instagram_posts.instagram_post_id` + `instagram_account_id`); toda leitura de análise filtra `ig_user_id` = o da conta; upsert com `onConflict: "instagram_account_id,scope,instagram_post_id"` regravando todas as colunas, `analyzed_at` = `new Date(now()).toISOString()`, `analyzed_by` = `userId`; ids das ideias com `crypto.randomUUID()`; `comments_count_at_analysis` = `max(instagram_posts.comments, total buscado)` (conta: soma do mirror dos posts do período); `current_comments` da conta = soma de `instagram_posts.comments` com `posted_at` nos últimos 30 dias; `period_start/end` = hoje-30 e hoje (UTC); token expirado (graph 190) → mesmo tratamento das rotas atuais (marcar conta expirada; ver o `catch` do `index.ts`).

- [ ] **Step 1: Testes** com `svc` falso (objeto que grava as chamadas `from().select/upsert`; veja `instagram-connect-link-handler_test.ts` para o padrão de deps):
  - `"rota fora da família devolve null"`;
  - `"sem escopo de comentários → 409 missing_comments_scope sem chamar a Graph"`;
  - `"post de outra conta → 404"`;
  - `"GET post-comments devolve cached_analysis só do ig_user_id atual"` (linha com `ig_user_id` antigo → `null`);
  - `"POST com 4 comentários → 422 too_few_comments sem chamar Gemini"`;
  - `"POST manda à IA só textos, grava upsert com analyzed_at novo e ideias com id"`: inspeciona o prompt (sem username) e o payload do upsert;
  - `"POST redige username no resultado gravado"`;
  - `"Gemini sem chave → 503 ai_unavailable; GET de comentários segue 200"`;
  - `"AiTimeoutError → 504 ai_timeout"`, `"AiBadOutputError ou validação null → 502 ai_bad_output, sem upsert"`;
  - `"rate limit negado → 429"`;
  - `"conta: escolhe os 15 com mais comentários dos últimos 30 dias e corta 60 por post"`;
  - `"GET conta devolve current_comments mesmo sem análise"`.
- [ ] **Step 2:** `deno test --no-check supabase/functions/__tests__/instagram-comments-routes_test.ts` → FAIL.
- [ ] **Step 3:** Implementar `comments-routes.ts`; em `index.ts`, uma chamada `const r = await handleCommentsRoute(req.method, path, {...}); if (r) return json(r.body, r.status);` logo após o feature gate. Erro inesperado: `console.error` com nome da rota e `err.message` (nunca texto de comentário), resposta `500 { error: "internal_error" }`.
- [ ] **Step 4:** PASS; `npm run check:functions` limpo.
- [ ] **Step 5: Commit** `feat(instagram-analytics): rotas de comentários e análises`

### Task 6: `/disconnect` apaga as análises

**Files:**
- Modify: `supabase/functions/instagram-integration/index.ts:934-942`
- Test: extraia o corpo do disconnect para uma função `disconnectAccount(svc, accountId)` em `supabase/functions/instagram-integration/disconnect.ts` e teste em `supabase/functions/__tests__/instagram-disconnect_test.ts`

**Interfaces:**
- Produces: `disconnectAccount(svc: SupabaseClient, accountId: string): Promise<void>`: apaga `instagram_posts`, apaga `instagram_comment_analyses` da conta, depois o update atual (mesmos campos). Erro em qualquer passo lança.

- [ ] **Step 1: Teste** `"disconnect apaga posts e análises antes de zerar o token"` (ordem das chamadas no `svc` falso) e `"erro ao apagar análises propaga"`.
- [ ] **Step 2:** FAIL. **Step 3:** implementar e trocar o trecho inline pela chamada. **Step 4:** PASS + `npm run check:functions`.
- [ ] **Step 5: Commit** `fix(instagram-integration): desconectar apaga as análises de comentários`

### Task 7: Serviço do CRM, ideias com origem e prefill do diálogo

**Files:**
- Create: `apps/crm/src/services/instagramComments.ts`
- Modify: `apps/crm/src/store/ideias.ts` (`CreateIdeiaInput.origem_sugestao_id?: string | null`; nova `getSavedSuggestionIds`)
- Modify: `apps/crm/src/components/ideias/NovaIdeiaDialog.tsx` (prop `initialValues`)
- Test: `apps/crm/src/services/__tests__/instagramComments.test.ts`, `apps/crm/src/store/__tests__/ideias.test.ts` (ou o arquivo de testes de ideias que já existir: `grep -rl createIdeia apps/crm/src --include=*.test.*`), `apps/crm/src/components/ideias/__tests__/NovaIdeiaDialog.test.tsx` (idem)

**Interfaces:**
- Consumes: contrato da Task 5.
- Produces:
  ```ts
  // services/instagramComments.ts (tipos espelham a Task 5)
  export class CommentsApiError extends Error { code: string; status: number }
  export async function getPostComments(clientId: number, postId: string): Promise<PostCommentsResponse>
  export async function analyzePostComments(clientId: number, postId: string): Promise<StoredAnalysis>
  export async function getAccountCommentsAnalysis(clientId: number): Promise<{ analysis: StoredAnalysis | null; current_comments: number }>
  export async function analyzeAccountComments(clientId: number): Promise<StoredAnalysis>
  export function commentsErrorMessage(e: unknown): string // copy pt-BR por código
  // store/ideias.ts
  export async function getSavedSuggestionIds(ids: string[]): Promise<Set<string>>
  // NovaIdeiaDialog
  initialValues?: { cliente_id: number; titulo: string; descricao: string; origem_sugestao_id: string } | null
  ```
- Copy de `commentsErrorMessage`: `missing_comments_scope` → "Reconecte o Instagram deste cliente para ver os comentários."; `too_few_comments` → "Ainda não há comentários suficientes para analisar."; `ai_unavailable` → "A análise por IA está indisponível no momento."; `ai_timeout` → "A análise demorou demais. Tente de novo."; `ai_bad_output` → "Não foi possível gerar a análise. Tente de novo."; 429 → "Muitas análises seguidas. Tente de novo em alguns minutos."; outro → "Não foi possível carregar os comentários."
- `createIdeia` com `origem_sugestao_id` que bate no índice (`23505`) → lança `DuplicateSuggestionError` (exportada) em vez de erro cru; o diálogo trata como sucesso: fecha, chama `onSaved('')` e o card marca "Salva".
- `initialValues` só vale com `editing` nulo; preenche os campos ao abrir e mantém "Visível no Hub" desligado.

- [ ] **Step 1: Testes Vitest:**
  - serviço: `"lança CommentsApiError com code do corpo"` (fetch mockado devolvendo `409 {error:"missing_comments_scope"}`), `"commentsErrorMessage mapeia cada código"`;
  - ideias: `"createIdeia envia origem_sugestao_id"`, `"23505 vira DuplicateSuggestionError"`, `"getSavedSuggestionIds consulta só os ids pedidos e devolve Set"` (lista vazia → Set vazio sem consulta);
  - diálogo: `"initialValues preenche título, descrição e cliente, Hub desligado"`, `"salvar com initialValues chama createIdeia com origem_sugestao_id"`.
- [ ] **Step 2:** `npm run test -- instagramComments ideias NovaIdeiaDialog` → FAIL.
- [ ] **Step 3:** Implementar (use `getAuthHeaders`/`EDGE_URL` de `services/analytics.ts`; exporte-os se ainda não forem).
- [ ] **Step 4:** PASS; `npx tsc -p apps/crm/tsconfig.json --noEmit`.
- [ ] **Step 5: Commit** `feat(crm): serviço de comentários e ideia a partir de sugestão`

### Task 8: Painel de comentários por post (desktop e phone)

**Files:**
- Create: `apps/crm/src/pages/analytics-conta/comments/CommentsAnalysisView.tsx` (o cartão de resultado, reaproveitado na Task 9)
- Create: `apps/crm/src/pages/analytics-conta/comments/PostCommentsPanel.tsx`
- Create: `apps/crm/src/pages/analytics-conta/comments/SuggestionIdeaButton.tsx`
- Modify: `apps/crm/src/pages/analytics-conta/AnalyticsContaPage.tsx:1981-2017` (abas "Insights" / "Comentários · N" na linha expandida)
- Modify: `apps/crm/src/pages/analytics-conta/phone/PostDetailSheet.tsx` (mesmas abas)
- Test: `apps/crm/src/pages/analytics-conta/comments/__tests__/PostCommentsPanel.test.tsx`, e ajustes em `AnalyticsContaPage.test.tsx` / `AnalyticsContaPage.phone.test.tsx`

**Interfaces:**
- Consumes: Task 7.
- Produces:
  ```ts
  export function CommentsAnalysisView(props: { analysis: StoredAnalysis; clienteId: number; sourceLabel: string; newComments: number; onRefresh: () => void; refreshing: boolean; postThumbs?: Record<string, string | null> }): JSX.Element
  export function PostCommentsPanel(props: { clientId: number; post: PostAnalytics; compact?: boolean }): JSX.Element
  export function SuggestionIdeaButton(props: { clienteId: number; idea: CommentAnalysis["ideias"][number]; sourceLabel: string; saved: boolean; onSaved: () => void; fullWidth?: boolean }): JSX.Element
  ```
- Layout e copy: os mockups (artboards "Post", "Estados", "Phone"). Rótulos do chip: positivo → "Majoritariamente positivo", misto → "Misto", negativo → "Majoritariamente negativo", polemico → "Polêmico". Cores da distribuição distintas também em luminosidade (apoio verde escuro, dúvida azul, crítica laranja, discussão roxo, spam cinza) com legenda em texto.
- Query keys: `['ig-post-comments', clientId, postId]` (`staleTime` 5 min), `['ideias-sugestoes-salvas', ids.join(',')]`. Depois de analisar: `setQueryData` do `cached_analysis`. "N comentários novos" = `max(post.comments, total_fetched) - comments_count_at_analysis` quando > 0.
- Descrição pré-preenchida da ideia: `${descricao}\n\nOrigem: comentários de ${sourceLabel} (${motivo})`, com `sourceLabel` = `"${tipo} de ${dd mmm}"` (date-fns pt-BR).
- Sem a flag (`useWorkspaceLimits().features?.feature_instagram_comments_ai !== true`): sem abas, layout atual intacto, nenhuma consulta.
- Comentário: inicial do username no avatar, `@username`, texto, data relativa (`formatDistanceToNowStrict`, pt-BR), "N curtidas", "N respostas"/"25+ respostas". `truncated` → "Mostrando os 200 mais recentes".
- Estado sem escopo: botão "Reconectar Instagram" leva ao fluxo de conexão que a página do cliente já usa (procure o CTA de reconexão existente com `grep -rn "Reconectar" apps/crm/src/pages`); reutilize, não crie outro.

- [ ] **Step 1: Testes** (mock do serviço):
  - `"flag desligada: não renderiza aba nem chama getPostComments"`;
  - `"lista comentários como texto"`: um comentário com `<img src=x onerror=alert(1)>` aparece literal e nenhum `img` é criado;
  - `"sem análise mostra Analisar comentários; clique chama analyzePostComments e mostra o chip"`;
  - `"menos de 5 comentários desabilita o botão com a dica"`;
  - `"409 mostra Reconectar Instagram"`;
  - `"mostra N comentários novos desde a análise quando o total cresceu"`;
  - `"Salvar como ideia abre o diálogo preenchido; ideia já salva mostra Salva"`;
  - na página: `"linha expandida tem abas Insights e Comentários com a flag"`; no phone: `"sheet do post tem a aba Comentários com a flag"`.
- [ ] **Step 2:** `npm run test -- analytics-conta` → FAIL nos novos.
- [ ] **Step 3:** Implementar.
- [ ] **Step 4:** PASS (todos os testes de `analytics-conta`, antigos inclusive); tsc do CRM limpo.
- [ ] **Step 5: Commit** `feat(crm): comentários e leitura por IA no post`

### Task 9: Cartão da conta "O que o público está dizendo"

**Files:**
- Create: `apps/crm/src/pages/analytics-conta/comments/AccountCommentsCard.tsx`
- Modify: `apps/crm/src/pages/analytics-conta/AnalyticsContaPage.tsx` (logo antes de `<AISection clientId={clientId} days={days} />`, linha ~2050) e `phone/ContaPhone.tsx` (seção equivalente; procure onde o phone mostra a análise de IA, senão antes da lista de posts)
- Test: `apps/crm/src/pages/analytics-conta/comments/__tests__/AccountCommentsCard.test.tsx`

**Interfaces:**
- Consumes: `CommentsAnalysisView`, `SuggestionIdeaButton` (Task 8), serviço (Task 7).
- Produces: `export function AccountCommentsCard(props: { clientId: number; posts: PostAnalytics[] }): JSX.Element | null` (`posts` só para as miniaturas dos `post_ids`).
- Cabeçalho: "O que o público está dizendo"; subtítulo "Últimos 30 dias · N comentários em M posts · analisado há X" (sem análise: "Últimos 30 dias"). Botão "Analisar" sem análise, "Atualizar análise" com. `sourceLabel` das ideias = "os últimos 30 dias". Query key `['ig-account-comments-analysis', clientId]`.

- [ ] **Step 1: Testes:** `"flag desligada → null, sem consulta"`, `"sem análise mostra Analisar"`, `"com análise mostra resumo, temas com miniaturas dos post_ids e 3 ideias"`, `"current_comments maior que comments_count_at_analysis mostra o aviso de novos"`, `"422 mostra a dica de poucos comentários"`.
- [ ] **Step 2:** FAIL. **Step 3:** implementar. **Step 4:** PASS + tsc.
- [ ] **Step 5: Commit** `feat(crm): leitura dos comentários da conta`

### Task 10: Verificação final

- [ ] **Step 1:** Rodar tudo o que o CI roda: `npm run lint`, `npm run format:check` (se falhar, `npx prettier --write` **só nos arquivos deste branch**), os cinco `tsc` (`apps/crm`, `apps/hub`, `apps/admin`, `apps/mcp-widgets`, `tsconfig.scripts.json`), `npm run test`, `npm run check:functions`, `npm run test:functions`. Esperado: tudo verde; reportar qualquer falha com a saída.
- [ ] **Step 2: Browser.** `npm run dev:env` aponta para **prod**: não grave nada lá. Verifique a UI com `fetch` interceptado no Browser pane (respostas falsas das 4 rotas + `features.feature_instagram_comments_ai = true`), cobrindo: aba Comentários com análise, estado sem escopo, diálogo de ideia preenchido, cartão da conta, phone (375 px) e dark mode. Screenshot de cada.
- [ ] **Step 3:** Conferir que nenhum `console.*` novo das edge functions imprime `text`/`username` (`grep -n "console\." supabase/functions/instagram-analytics/comments-*.ts`).
- [ ] **Step 4:** Conferir de novo a versão da migration contra `origin/main` antes de abrir o PR. Descrição do PR com a ordem de deploy: migration (staging → prod) → `instagram-analytics` + `instagram-integration` + os importadores de `_shared/entitlements.ts` (`grep -rl "_shared/entitlements.ts" supabase/functions --include=index.ts`) → merge → override da flag no workspace piloto.
