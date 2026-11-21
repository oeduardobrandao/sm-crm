# Moderação de comentários do Instagram Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ocultar, mostrar e excluir comentários do Instagram na aba Comentários do post, com respostas aninhadas e sem contagem dupla.

**Architecture:** Duas rotas novas na família `post-comments` do `instagram-analytics` (`comments-routes.ts`), apoiadas em funções de Graph novas em `comments-graph.ts`. `fetchMediaComments` passa a deduplicar e a marcar `hidden`/`parent_id`/`from_owner` para as três rotas que o usam. O frontend agrupa respostas pelo `parent_id`, mostra o menu "⋯" só para `analytics:editar` e faz atualização otimista no cache do TanStack Query.

**Tech Stack:** Deno edge function (Supabase), Instagram Graph `v22.0` (Instagram Login), React 19 + TanStack Query + shadcn (`DropdownMenu`, `AlertDialog`) + `ActionSheet` (`@/components/mobile`) + `sonner`, i18next, Vitest, `deno test`.

**Spec:** `docs/superpowers/specs/2026-11-21-instagram-comment-moderation-design.md` (mockups: https://claude.ai/artifact/HiUbePJmtGwjSt4K9k3E1v)

## Global Constraints

- Branch `claude/instagram-delete-comments-eacc68`, worktree `/Users/eduardosouza/projects/sm-crm/.claude/worktrees/post-editor-messaging-237e59` (caminho com `projects` minúsculo).
- Sem migration, sem coluna nova em `plans`. Flag: `feature_instagram_comments_ai` (o `feature-guard` já casa `^/post-comments/`).
- Permissão de escrita: `analytics:editar`, conferida no servidor com `hasPermissionFor` e no frontend com `can('analytics','editar') === true`.
- Nunca logar nem gravar no `audit_log` texto de comentário, username ou token. Log de erro só com o `kind`.
- Graph: Bearer no header, nunca token na query; toda chamada com timeout (via `igRequest`).
- Códigos de erro da API (contrato com o frontend): `forbidden` 403, `bad_request` 400, `comment_not_found` 404, `comment_unavailable` 404, `post_not_found` 404, `owner_comment_not_hideable` 409, `missing_comments_scope` 409, `write_rate_limited` 429, `instagram_unavailable` 502.
- Rate limit de escrita: chave `ig-comments-write:${contaId}`, 120 por 3600 s. Leitura segue `ig-comments-read:${contaId}`.
- Audit: `resource_type: "instagram_comment"`, `action` `instagram-comment-hide` | `instagram-comment-unhide` | `instagram-comment-delete`, `metadata: { client_id, instagram_post_id }`.
- A lista da rota `GET /post-comments` continua plana (`comments[]`), com id único, e mantém `replies_count`/`replies_more`.
- Copy pt/en sem travessão (em-dash). Textos pt exatos estão na seção "Textos (pt)" da spec.
- Gates antes de qualquer push: `npm run lint`, `npm run format:check`, os cinco `tsc` (crm, hub, admin, mcp-widgets, scripts), `npm run test`, `npm run check:functions`, `npm run test:functions`.

## Review Focus

1. **Clique duplo / ação repetida em voo.** Duas chamadas para o mesmo comentário (duplo clique em "Excluir", "Desfazer" antes do hide responder). Esperado: um comentário com ação em voo tem o "⋯" desabilitado e o botão "Excluir" do diálogo fica desabilitado durante a chamada; só uma requisição sai. Teste na Task 5.
2. **Excluir um comentário que tem respostas.** Esperado: a linha e as respostas dela somem na hora; a recarga com debounce traz o estado real. Teste na Task 5.
3. **Permissão ainda carregando (`can` devolve `'unknown'`).** Esperado: sem menu (não pisca menu para agente). Teste na Task 5.
4. **Texto longo ou só emoji no diálogo de exclusão.** Esperado: citação truncada em 140 caracteres com "…", sem quebrar o layout. Teste na Task 5.
5. **Comentário que reaparece depois de "Desfazer" enquanto a lista recarrega.** Esperado: o resultado da recarga vence o estado otimista (sem linha duplicada nem `hidden` errado). Teste na Task 5 (recarga substitui o cache inteiro).

---

### Task 1: Conferir respostas e `parent_id` em staging

Sem código no repo. Usa a function descartável `ig-comment-spike` do staging (`wlyzhyfondykzpsiqsce`), hoje um stub 410. O código do spike está em `<scratchpad>/ig-comment-spike/index.ts` e a chave em `<scratchpad>/spike-key` (scratchpad da sessão que escreveu este plano; se sumiu, recriar o mesmo arquivo com uma chave nova e o hash dela).

**Files:** nenhum no repo. Atualiza a spec só se algum resultado contrariar o que ela supõe.

- [ ] **Step 1:** Redeployar `ig-comment-spike` em staging com o código do spike (`verify_jwt: false`) e incluir `parent_id` nos `fields` da operação `list`.
- [ ] **Step 2:** Pedir ao usuário uma **resposta** de outra conta a um comentário de outra conta num post de @mesaas.com.br (account `1680d40f-f1fc-489b-b980-c29b3adaba3c`). Esperar a confirmação.
- [ ] **Step 3:** `op=list` no post. Registrar: (a) o item solto da resposta traz `parent_id`? (b) traz `hidden`?
- [ ] **Step 4:** `op=get&comment=<id da resposta>`: o GET traz `media{id}`? Se não, traz `parent_id`?
- [ ] **Step 5:** `op=hide` (true, depois false) e `op=delete` na resposta. Esperado: `{"success": true}` nas três.
- [ ] **Step 6:** Redeployar o stub 410 (`verify_jwt: true`).
- [ ] **Step 7:** Registrar os resultados num comentário no topo de `comments-graph.ts` na Task 2 e, se algum contrariar a spec, aplicar a regra dela: `media` ausente em resposta → passo 6 usa o `media` do pai via `parent_id`; hide/delete falhando em resposta → o "⋯" não aparece em respostas (Task 5) e a spec é atualizada e commitada antes de seguir. Se `parent_id` não vier na lista, a Task 2 deriva o pai por `replies{id}`.

### Task 2: Graph: lista deduplicada e funções de moderação

**Files:**
- Modify: `supabase/functions/_shared/instagram-messaging.ts` (tipo de `method` em `igRequest`)
- Modify: `supabase/functions/instagram-analytics/comments-graph.ts`
- Modify: `supabase/functions/instagram-analytics/comments-routes.ts` (só `loadAccount` e as três chamadas de `fetchComments`)
- Test: `supabase/functions/__tests__/instagram-comments-graph_test.ts`, `supabase/functions/__tests__/instagram-comments-routes_test.ts` (fixtures de `IgComment`)

**Interfaces:**
- Produces:
  - `igRequest(deps, method: "GET" | "POST" | "DELETE", path, token, body?)`.
  - `interface IgComment { id; text; timestamp; username; like_count; replies_count; replies_more; hidden: boolean; from_owner: boolean; parent_id: string | null }`.
  - `fetchMediaComments(deps, args: { mediaId: string; token: string; max: number; deadlineAt: number; ownerIds: string[] }): Promise<{ comments: IgComment[]; truncated: boolean }>` (lista plana, id único).
  - `interface CommentRef { id: string; mediaId: string | null; fromId: string | null; parentId: string | null }`.
  - `getCommentRef(deps: { fetchFn?: typeof fetch }, args: { commentId: string; token: string }): Promise<CommentRef>`.
  - `setCommentHidden(deps, args: { commentId: string; token: string; hidden: boolean }): Promise<void>` (lança `GraphNoSuccess` se a resposta não tiver `success: true`).
  - `deleteComment(deps, args: { commentId: string; token: string }): Promise<void>` (idem).
  - `isCommentUnavailable(e: unknown): boolean` (`IgApiError` com `graphCode === 100 && graphSubcode === 33`).
  - `export class GraphNoSuccess extends Error`.
  - `loadAccount` passa a devolver também `professional_account_id: string | null`; as rotas passam `ownerIds: [instagram_user_id, professional_account_id].filter(Boolean)`.

- [ ] **Step 1: Testes falhando em `instagram-comments-graph_test.ts`**
  - `"dedupe: resposta solta e aninhada aparece uma vez com parent_id"`: página com `c1` (`replies.data: [{id:"c2"}]`) e `c2` solto → `comments.map(c=>c.id)` é `["c1","c2"]`, `c2.parent_id === "c1"`, `c1.parent_id === null`.
  - `"parent_id do item vence a derivação"`: `c2` com `parent_id: "c9"` e listado em `replies` de `c1` → `c2.parent_id === "c9"`.
  - `"hidden vem do item, ausente vira false"`.
  - `"from_owner compara from.id com qualquer ownerId e não expõe from.id"`: `ownerIds: ["111","222"]`, item com `from: {id:"222"}` → `from_owner === true`, e `"from" in comment === false`.
  - `"fields pede hidden e parent_id"`: a URL de `/comments` contém `hidden` e `parent_id` (decodificar `fields`).
  - `"max conta itens únicos"`: duplicatas não consomem a cota de `max`.
  - `"getCommentRef mapeia media, from e parent_id; ausentes viram null"`.
  - `"setCommentHidden manda POST /{id}?hide=true"` e `"=false"`, sem body, Bearer no header; resposta sem `success` lança `GraphNoSuccess`.
  - `"deleteComment manda DELETE /{id}"`; resposta `{success:false}` lança `GraphNoSuccess`.
  - `"isCommentUnavailable só para 100/33"`: `IgApiError` com 100/33 → true; 100/0, 190, `Error` comum → false.
- [ ] **Step 2:** Rodar `deno test --no-check --allow-env --allow-read --allow-net supabase/functions/__tests__/instagram-comments-graph_test.ts`. Esperado: FAIL nos casos novos.
- [ ] **Step 3: Implementar.** `FIELDS` passa a `id,text,timestamp,username,hidden,parent_id,from{id,username},like_count,replies.limit(25){id}`. Dedupe por id num `Map` ao longo de todas as páginas; o `parent_id` derivado de `replies` só preenche quando o item não trouxe o seu. `mapComment` recebe `ownerIds` e não copia `from`. As funções novas usam `igRequest` com `timeoutMs: 8000`. Nas três chamadas de `deps.fetchComments` em `comments-routes.ts`, passar `ownerIds`; `loadAccount` seleciona `professional_account_id`.
- [ ] **Step 4:** Atualizar as fixtures de `IgComment` em `instagram-comments-routes_test.ts` (campos novos) e incluir `"análise do post recebe textos sem duplicata"`: o `fetchComments` falso devolve lista já deduplicada e o prompt recebido pelo `callAi` falso tem cada texto uma vez (prova que as rotas não reintroduzem duplicatas).
- [ ] **Step 5:** Rodar os dois arquivos de teste. Esperado: PASS. Rodar `npm run check:functions`. Esperado: sem erros.
- [ ] **Step 6: Commit** `feat(instagram-analytics): lista de comentários sem duplicatas, com hidden, parent_id e from_owner`.

### Task 3: Rotas de ocultar, mostrar e excluir

**Files:**
- Modify: `supabase/functions/instagram-analytics/comments-routes.ts`
- Modify: `supabase/functions/instagram-analytics/index.ts` (deps novas)
- Test: `supabase/functions/__tests__/instagram-comments-routes_test.ts`

**Interfaces:**
- Consumes: Task 2 (`getCommentRef`, `setCommentHidden`, `deleteComment`, `isCommentUnavailable`, `GraphNoSuccess`, `ownerIds`).
- Produces:
  - `POST /post-comments/:clientId/:postId/:commentId/hide`, body `{ hidden: boolean }` → 200 `{ id, hidden }`.
  - `DELETE /post-comments/:clientId/:postId/:commentId` → 200 `{ id, deleted: true }`.
  - `CommentsRouteDeps` ganha: `body: unknown` (JSON já lido pelo `index.ts`, `null` se não houver), `hasPermission: (module: string, action: "ver" | "editar") => Promise<boolean>`, `audit: (entry: { action: string; resource_id: string; metadata: Record<string, unknown> }) => Promise<void>`, `commentGraph: { getCommentRef; setCommentHidden; deleteComment }`.

- [ ] **Step 1: Testes falhando** (mesmo harness `makeSvc`; deps falsas para `hasPermission`, `audit`, `commentGraph`, `rateLimit`):
  - `"hide: sem analytics:editar responde 403 forbidden e não chama a Graph"`.
  - `"hide: commentId inválido responde 404 comment_not_found"` (`abc`, `1'2`, 31 dígitos).
  - `"hide: hidden não booleano responde 400 bad_request"`.
  - `"hide: rate limit de escrita usa ig-comments-write:<conta> 120/3600 e responde 429 write_rate_limited"`.
  - `"hide: sem escopo responde 409 missing_comments_scope"`.
  - `"hide: comentário de outro post responde 404 comment_not_found sem chamar setCommentHidden"`.
  - `"hide: media ausente responde 502 instagram_unavailable sem chamar setCommentHidden"`.
  - `"hide: 100/33 no getCommentRef responde 404 comment_unavailable"`; idem no `setCommentHidden`.
  - `"hide true em comentário do dono responde 409 owner_comment_not_hideable"` (fromId igual a `professional_account_id` também).
  - `"hide false em comentário do dono passa"`.
  - `"hide: sucesso grava audit instagram-comment-hide com metadata só client_id e instagram_post_id"`; o JSON do audit não contém o texto nem o username da fixture.
  - `"unhide: sucesso grava instagram-comment-unhide"`.
  - `"delete: sucesso responde {id, deleted:true} e grava instagram-comment-delete"`.
  - `"delete: GraphNoSuccess responde 502 instagram_unavailable sem audit"`.
  - `"delete: token expirado (190) propaga TOKEN_EXPIRED"`.
  - `"GET /post-comments/... e POST de análise continuam roteando"` (regressão do `parseRoute`).
  - Se a Task 1 mostrou `media` ausente em resposta: `"resposta sem media usa o media do pai via parentId"`.
- [ ] **Step 2:** Rodar o arquivo. Esperado: FAIL nos casos novos.
- [ ] **Step 3: Implementar.** `parseRoute` reconhece `kind: "hide"` (POST, sufixo `/hide`) e `kind: "delete"` (DELETE) em `/post-comments/:clientId/:postId/:commentId`, `commentId` validado com `/^\d{1,30}$/`. Ordem do fluxo exatamente como a spec ("Fluxo de cada ação", passos 1 a 8): validação → `verifyClientOwnership` (fora do try, como hoje) → `hasPermission("analytics","editar")` → `rateLimit` → `loadAccount` → `loadPost` → `getCommentRef` → Graph → `audit`. `GraphNoSuccess` e erros não classificados viram 502 `instagram_unavailable`; `token_expired` sobe com o formato `TOKEN_EXPIRED` de hoje.
- [ ] **Step 4:** Em `index.ts`, ler o body só para `POST`/`DELETE` dessas rotas (`await req.json().catch(() => null)`), e passar `hasPermission: (m, a) => hasPermissionFor(serviceClient, user.id, contaId, m, a)`, `audit: (e) => insertAuditLog(serviceClient, { conta_id: contaId, actor_user_id: user.id, resource_type: "instagram_comment", ...e })` e `commentGraph: { getCommentRef, setCommentHidden, deleteComment }`.
- [ ] **Step 5:** Rodar o arquivo de teste, `npm run check:functions` e `npm run test:functions`. Esperado: PASS.
- [ ] **Step 6: Commit** `feat(instagram-analytics): rotas para ocultar, mostrar e excluir comentário`.

### Task 4: Serviço do CRM, erros e i18n

**Files:**
- Modify: `apps/crm/src/services/instagramComments.ts`
- Modify: `packages/i18n/locales/pt/analyticsComments.json`, `packages/i18n/locales/en/analyticsComments.json`
- Test: `apps/crm/src/services/__tests__/instagramComments.test.ts`

**Interfaces:**
- Consumes: contrato HTTP da Task 3.
- Produces:
  - `IgComment` com `hidden?: boolean; from_owner?: boolean; parent_id?: string | null` (opcionais: uma function antiga não os manda; ausente = `false`/`null`).
  - `setCommentHidden(clientId: number, postId: string, commentId: string, hidden: boolean): Promise<{ id: string; hidden: boolean }>`.
  - `deleteComment(clientId: number, postId: string, commentId: string): Promise<{ id: string; deleted: true }>`.
  - `request<T>(path, method: 'GET' | 'POST' | 'DELETE', body?: unknown)` (JSON + `Content-Type` só com body).
  - `commentsErrorMessage` mapeia `write_rate_limited` **antes** do ramo genérico de 429, mais `forbidden`, `comment_not_found`, `comment_unavailable`, `owner_comment_not_hideable`.
  - Chaves i18n novas em `analyticsComments`: `moderation.actions` ("Ações do comentário"), `moderation.hide`, `moderation.show`, `moderation.delete`, `moderation.hiddenBadge` ("Oculto"), `moderation.ownerBadge` ("Você"), `moderation.confirmTitle`, `moderation.confirmBody`, `moderation.cancel`, `moderation.confirmDelete` ("Excluir"), `moderation.hidden` ("Comentário oculto"), `moderation.shown` ("Comentário visível de novo"), `moderation.undo` ("Desfazer"), `moderation.deleted` ("Comentário excluído"), `moderation.refreshFailed` (linha discreta do erro de recarga com cache: "Não foi possível atualizar a lista agora."), `error.forbidden`, `error.writeRateLimited`, `error.commentGone` (para `comment_not_found` e `comment_unavailable`), `error.ownerNotHideable`. Textos pt exatos da spec; en equivalente.

- [ ] **Step 1: Testes falhando:**
  - `"setCommentHidden faz POST em /post-comments/:c/:p/:id/hide com {hidden}"` (URL com `encodeURIComponent` do postId, header `Content-Type: application/json`).
  - `"deleteComment faz DELETE sem body"`.
  - `"write_rate_limited usa error.writeRateLimited, não error.rateLimited"`.
  - `"429 rate_limited segue error.rateLimited"` (regressão).
  - `"comment_unavailable e comment_not_found usam error.commentGone"`.
  - `"pt e en têm as mesmas chaves em moderation e error"` (comparação de chaves dos dois JSON).
  - `"nenhum texto novo tem travessão"` (varre os valores de `moderation.*` e as chaves novas de `error.*` nos dois JSON procurando `—`).
- [ ] **Step 2:** `npx vitest run apps/crm/src/services/__tests__/instagramComments.test.ts`. Esperado: FAIL.
- [ ] **Step 3:** Implementar conforme as Interfaces.
- [ ] **Step 4:** Rodar de novo. Esperado: PASS.
- [ ] **Step 5: Commit** `feat(crm): serviço e textos da moderação de comentários`.

### Task 5: Painel: respostas aninhadas, menu, ocultar, excluir

**Files:**
- Modify: `apps/crm/src/pages/analytics-conta/comments/PostCommentsPanel.tsx`
- Create: `apps/crm/src/pages/analytics-conta/comments/CommentActions.tsx` (menu desktop + `ActionSheet` + diálogo de exclusão)
- Create: `apps/crm/src/pages/analytics-conta/comments/groupComments.ts`
- Create: `apps/crm/src/pages/analytics-conta/comments/useCommentModeration.ts`
- Modify: `apps/crm/app.css` (junto das regras `.igc-comment` existentes)
- Test: `apps/crm/src/pages/analytics-conta/comments/__tests__/PostCommentsPanel.test.tsx`, Create `apps/crm/src/pages/analytics-conta/comments/__tests__/groupComments.test.ts`

**Interfaces:**
- Consumes: Task 4 (`setCommentHidden`, `deleteComment`, `commentsErrorMessage`, chaves i18n).
- Produces:
  - `groupComments(comments: IgComment[]): { comment: IgComment; replies: IgComment[] }[]` (ordem original dos itens de topo; resposta cujo pai não está na lista vira item de topo; respostas na ordem original).
  - `useCommentModeration({ clientId: number; postId: string; queryKey: unknown[] }): { pending: ReadonlySet<string>; hide(c: IgComment, hidden: boolean): Promise<void>; remove(c: IgComment): Promise<void> }`.
  - `CommentActions` props: `{ comment: IgComment; compact: boolean; disabled: boolean; onHide(hidden: boolean): void; onDelete(): Promise<void> }`.

- [ ] **Step 1: Testes de `groupComments`:** aninha por `parent_id`; órfã vira topo; sem `parent_id` em nenhum item devolve tudo como topo (function antiga).
- [ ] **Step 2: Testes falhando no painel** (mock de `@/context/AuthContext` com `can` controlável, como em `GlobalSearchTrigger.test.tsx`; mock de `setCommentHidden`/`deleteComment`; mock de `sonner`):
  - `"sem analytics:editar não mostra o botão Ações do comentário"`; `"can 'unknown' também não mostra"`.
  - `"respostas aparecem recuadas sob o pai e o rodapé conta itens únicos"`.
  - `"comentário oculto mostra o selo Oculto e o menu oferece Mostrar comentário"`.
  - `"comentário do dono mostra Você e o menu não tem Ocultar"`.
  - `"ocultar é otimista, mostra toast Comentário oculto com Desfazer, e Desfazer chama setCommentHidden(false)"`.
  - `"erro ao ocultar desfaz o estado local e mostra a mensagem"`.
  - `"excluir abre o diálogo com a citação, Excluir chama deleteComment uma vez mesmo com dois cliques, e a linha e as respostas somem"`.
  - `"citação do diálogo trunca em 140 caracteres com …"`.
  - `"enquanto uma ação está em voo, o ⋯ daquele comentário fica desabilitado"`.
  - `"depois de excluir, recarrega a lista uma vez com debounce de 5 s (fake timers): três exclusões seguidas geram um getPostComments a mais"`.
  - `"comment_unavailable não apaga a linha localmente; recarrega a lista e mostra error.commentGone"`.
  - `"recarga em segundo plano que falha mantém a lista e mostra moderation.refreshFailed"`.
  - `"compact usa ActionSheet em vez de DropdownMenu"` (procura `role="dialog"` com o título do ActionSheet).
  - `"resultado da recarga substitui o estado otimista"` (Review Focus 5).
  - Se a Task 1 mostrou que hide/delete não funcionam em respostas: `"respostas não têm o botão Ações do comentário"`.
- [ ] **Step 3:** `npx vitest run apps/crm/src/pages/analytics-conta/comments`. Esperado: FAIL.
- [ ] **Step 4: Implementar.**
  - `canModerate = can('analytics','editar') === true`.
  - Desktop: `DropdownMenu` (shadcn) com Ocultar/Mostrar (ausente se `from_owner`) e, após um separador, Excluir com a classe de perigo. `compact`: o "⋯" abre `ActionSheet` com as mesmas ações (`destructive: true` em Excluir); Excluir abre o mesmo `AlertDialog`.
  - `useCommentModeration`: `qc.setQueryData` otimista; `pending` como `Set` de ids em `useState`; `useUnsavedWork(pending.size > 0)`; toast de sucesso via `toast()` do `sonner` com `action: { label: t('moderation.undo'), onClick }` para hide/unhide; recarga com `setTimeout` de 5000 ms reiniciado a cada exclusão e limpo no unmount, chamando `qc.invalidateQueries({ queryKey })`; `comment_not_found`/`comment_unavailable` disparam a mesma recarga (sem debounce) e o toast de erro.
  - Ramo de erro do painel: cartão de erro só quando `!query.data`; com `data` e `query.error`, mostrar a lista e um `<p className="igc-error" role="status">` com `moderation.refreshFailed`.
  - CSS em `app.css`: `.igc-comment--reply` (recuo de 42px, avatar 26px), `.igc-comment--hidden` (fundo `var(--surface-hover)`, texto em itálico com `var(--text-light)`), `.igc-badge`, `.igc-comment__more` (30×30, foco visível). Verificar com `npx vitest run apps/crm/src/__tests__/cssSplitBoundary.test.ts`.
- [ ] **Step 5:** Rodar os testes da pasta e `cssSplitBoundary`. Esperado: PASS.
- [ ] **Step 6: Commit** `feat(crm): moderação de comentários na aba Comentários`.

### Task 6: Gates, staging e verificação no navegador

**Files:** nenhum novo (só correções que os gates apontarem).

- [ ] **Step 1:** Rodar os gates da seção Global Constraints. Esperado: todos verdes. Se `format:check` falhar, `npx prettier --write` só nos arquivos tocados (nunca no repo inteiro).
- [ ] **Step 2:** Deploy de `instagram-analytics` em staging (`--project-ref wlyzhyfondykzpsiqsce`; a function verifica o JWT sozinha como hoje, manter a configuração atual de `verify_jwt` dela). Conferir antes que o `instagram-analytics` de staging não está à frente de `main` em algo que este deploy apagaria (comparar com `get_edge_function`); se estiver, parar e avisar.
- [ ] **Step 3:** `npm run dev:staging` (ou com `.env.staging` da checkout principal; worktree não tem o arquivo) e abrir Analytics da conta > cliente "Mesaas" > um post com comentários > aba Comentários no Browser pane. Pedir ao usuário um comentário novo de outra conta antes. Verificar: menu aparece; ocultar mostra "Oculto" e o toast; Desfazer volta; excluir pede confirmação e remove; respostas recuadas; layout de celular (`resize_window` mobile) abre o ActionSheet.
- [ ] **Step 4:** Consultar `audit_log` em staging: três linhas `instagram-comment-*` com `metadata` só `client_id` e `instagram_post_id`.
- [ ] **Step 5:** Screenshot desktop e celular como prova. Commit de qualquer correção. Não fazer push nem abrir PR sem o usuário pedir.
