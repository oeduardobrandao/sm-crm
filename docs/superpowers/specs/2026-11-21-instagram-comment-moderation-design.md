# Moderação de comentários do Instagram (ocultar, mostrar, excluir)

Data: 2026-11-21. Mockups: https://claude.ai/artifact/HiUbePJmtGwjSt4K9k3E1v

## Intenção

Agências precisam limpar spam e lidar com críticas nos posts dos clientes sem sair do
Mesaas. A aba **Comentários** do post (Analytics da conta, desktop e celular) já lista os
comentários ao vivo do Instagram; esta mudança acrescenta, em cada comentário, as ações
**Ocultar / Mostrar comentário** (reversível) e **Excluir comentário** (permanente).

## Decisões do usuário

- Ações: ocultar + mostrar de novo + excluir.
- Permissão: `analytics:editar` (dono, admin, papel customizado com Analytics "editar").
  Agente (preset Analytics "ver") não vê o menu e recebe 403 no servidor.
- Flag de plano: a mesma da aba, `feature_instagram_comments_ai`. Sem coluna nova em `plans`.
- Construção: rotas novas dentro do `instagram-analytics` (`comments-routes.ts`), ao lado de
  `GET /post-comments`. Nada de function nova.

## Fatos verificados (spike em staging, 2026-11-21)

Conta @mesaas.com.br (staging, escopo `instagram_business_manage_comments`), Graph
`v22.0`, token do dono da mídia, comentário de outra conta:

- `POST /{comment-id}?hide=true|false` → `{"success": true}`. O comentário oculto **continua**
  em `GET /{media-id}/comments` com `hidden: true` quando `hidden` está nos `fields`. Por isso
  "Mostrar comentário" não precisa de tabela nem de migration.
- `DELETE /{comment-id}` com o token do dono apaga o comentário de outra pessoa →
  `{"success": true}`. (A referência da Meta diz "token do autor do comentário"; está errada
  para esse caso.)
- Depois de excluído, `GET /{comment-id}` → HTTP 400, `code 100`, `error_subcode 33`
  ("does not exist").
- `/{media-id}/comments` devolve as **respostas também como itens soltos**, além de aninhadas
  em `replies`. A aba de hoje conta cada resposta duas vezes. `replies{hidden}` aninhado volta
  `null`.
- Só da documentação, não testado: comentário do dono da mídia no próprio post nunca fica
  oculto (sempre aparece); comentários de live não são suportados.

## Objetivos

1. Ocultar, mostrar e excluir um comentário (ou resposta) a partir da lista, com retorno
   imediato na tela.
2. Mostrar o estado "Oculto" que vem do Instagram, inclusive de comentários ocultados no app.
3. Deixar trilha: cada ação vai para o `audit_log`.
4. Corrigir a contagem dupla de respostas, mostrando respostas aninhadas sob o comentário.

## Não objetivos

- Moderação em lote, por palavra-chave ou automática (as automações de comentário já existem
  em outro módulo).
- Responder comentários pela aba.
- Moderação no Hub (cliente final) ou pelo MCP.
- Comentários de anúncios, stories, lives.
- Guardar comentários no banco.

## Antiobjetivos

- Excluir sem confirmação, ou excluir o comentário errado (id vindo do cliente sem conferir que
  pertence àquele post).
- Liberar ação de escrita para quem só tem leitura de Analytics, ou para cliente fora do escopo
  do membro (Acesso por cliente).
- Gravar texto de comentário ou username em log ou no `audit_log`.
- Quebrar a leitura por IA ou a lista para quem não modera.

## Abordagens consideradas

| | Abordagem | Troca |
|---|---|---|
| **A (escolhida)** | Duas rotas em `instagram-analytics/comments-routes.ts` | Reaproveita auth, escopo por cliente, flag (`feature-guard` já casa `^/post-comments/`), checagem do escopo OAuth, decrypt do token e mapeamento de erros. Um deploy. |
| B | Function nova `instagram-comment-moderation` | Isola escrita de analytics, mas duplica auth/escopo/token e soma mais uma function ao deploy. |
| C | Dentro do `instagram-webhook` / automações | Código serve o webhook da Meta, sem auth de usuário do CRM. Descartada. |

## Desenho

### Backend (`supabase/functions/instagram-analytics/`)

**Rotas novas** (em `parseRoute`, mesma família `post-comments`):

- `POST /post-comments/:clientId/:postId/:commentId/hide`, body JSON `{ "hidden": boolean }`.
  Resposta 200 `{ "id": "<commentId>", "hidden": boolean }`.
- `DELETE /post-comments/:clientId/:postId/:commentId`. Resposta 200 `{ "id": "<commentId>", "deleted": true }`.

`index.ts` já repassa todo método para `handleCommentsRoute` e `buildCorsHeaders` já libera
`DELETE` (`_shared/cors.ts`): só `parseRoute` muda.

**Fluxo de cada ação**, na ordem:

1. `decodePostId` e validação do `commentId` com `/^\d{1,30}$/` (inválido → 404 `comment_not_found`).
   `hidden` precisa ser booleano (senão 400 `bad_request`).
2. `verifyClientOwnership` (já cobre workspace e Acesso por cliente), igual às rotas de hoje.
3. Permissão: `hasPermissionFor(svc, userId, contaId, "analytics", "editar")` de
   `_shared/permissions.ts`. Falso → 403 `forbidden`. (O handler recebe `userId` e `contaId`
   em `CommentsRouteDeps`; injetar `hasPermission` como dependência para teste.)
4. Rate limit separado da leitura: `ig-comments-write:${contaId}`, 120 por hora. Estourou →
   429 `write_rate_limited` (código próprio: `commentsErrorMessage` hoje trata todo 429 como o
   limite de análise, então o frontend checa `write_rate_limited` antes do ramo genérico de
   429).
5. `loadAccount` (escopo OAuth → 409 `missing_comments_scope`, token vencido → caminho
   `TOKEN_EXPIRED` de hoje) e `loadPost` (→ 404 `post_not_found`).
6. Conferência do comentário: `GET /{commentId}?fields=id,media{id},from{id}` com o token.
   - Graph `code 100` + `subcode 33` → 404 `comment_unavailable`.
   - `media.id` ausente na resposta → 502 `instagram_unavailable`, sem ação (fail-closed: sem a
     mídia não dá para provar que o comentário é deste post). A Meta não garante esse campo no
     webhook (`instagram-webhook/process.ts`); no GET direto ele veio no spike, mas o código
     não pode supor.
   - `media.id !== post.instagram_post_id` → 404 `comment_not_found` (não revela que o
     comentário existe em outro post).
   - Ocultar (`hidden: true`) quando `from.id === account.instagram_user_id` → 409
     `owner_comment_not_hideable`. `from.id` ausente: segue como "não é do dono" (o
     frontend já não oferece Ocultar para `from_owner`, que vem da lista) e loga o caso. Mostrar
     (`hidden: false`) passa.
7. Ação na Graph: `POST /{commentId}?hide=true|false` ou `DELETE /{commentId}`. Resposta sem
   `success: true` → 502 `instagram_unavailable`. Erro com `code 100/subcode 33` aqui também →
   404 `comment_unavailable`.
8. `insertAuditLog(svc, { conta_id, actor_user_id, action, resource_type: "instagram_comment",
   resource_id: commentId, metadata: { client_id, instagram_post_id } })` com `action`
   `instagram-comment-hide` | `instagram-comment-unhide` | `instagram-comment-delete`. Sem texto,
   sem username. Falha do audit não derruba a ação (o helper já engole).

**`100/33` não quer dizer só "excluído".** A Graph usa o mesmo código para "não existe" e "não
pode ser carregado por falta de permissão / operação não suportada". Por isso a rota responde
404 `comment_unavailable` (nome neutro) e o frontend **não** apaga a linha por conta própria:
ele refaz a lista uma vez e mostra o resultado real (ver Frontend).

**Respostas (replies):** o spike testou só comentário de topo. Os itens soltos de resposta na
lista já vieram com `hidden` preenchido (`false`), então o selo "Oculto" de respostas sai da
lista. A primeira tarefa da implementação confere em staging, numa resposta de outra conta:
(a) se o GET do passo 6 traz `media` para uma resposta; se não trouxer, o passo 6 lê
`parent_id` e confere o `media` do pai; (b) se hide e delete funcionam numa resposta; se não
funcionarem, o "⋯" não aparece em respostas e a spec é atualizada antes de seguir.

**Dono da conta:** `from_owner` e a guarda do passo 6 comparam `from.id` com
`instagram_user_id` **e** com `professional_account_id` (quando não nulo), porque o repositório
usa os dois para a mesma conta (`instagram-webhook/process.ts`). `loadAccount` passa a
selecionar `professional_account_id`. `mapComment` hoje descarta `from.id`; ele passa a usá-lo
só para calcular `from_owner`, sem devolver o id.

Erros de Graph sem classificação especial seguem o padrão atual: `token_expired` sobe como
`TOKEN_EXPIRED`, o resto vira 502 `instagram_unavailable`, com log só do `kind`.

**Cliente Graph:** `igRequest` (`_shared/instagram-messaging.ts`) passa a aceitar `"DELETE"` no
tipo de `method`. Funções novas pequenas em `comments-graph.ts` (`getCommentRef`,
`setCommentHidden`, `deleteComment`) usando `igRequest`, com timeout e Bearer no header como o
resto do arquivo. A detecção de "não existe" lê `IgApiError.graphCode === 100 &&
graphSubcode === 33`.

**Lista (`GET /post-comments`), mudanças:**

- `FIELDS` ganha `hidden`, `parent_id` e mantém `from{id,username}`.
- `IgComment` ganha `hidden: boolean`, `from_owner: boolean` (calculado no servidor:
  `from.id === account.instagram_user_id`; o `from.id` em si não vai para o cliente) e
  `parent_id: string | null`.
- **A resposta continua sendo uma lista plana** `comments[]` (compatível com o frontend antigo,
  que só renderiza `data.comments`; aninhar no servidor sumiria com as respostas durante o
  deploy e depois de um rollback). O que muda: cada id aparece uma vez só, e cada item traz
  `parent_id`. Quem aninha é o frontend novo, agrupando por `parent_id`; resposta cujo pai não
  está na lista aparece como item de topo. `replies_count`/`replies_more` continuam.
- **Dedupe e `parent_id` ficam em `fetchMediaComments`** (`comments-graph.ts`), que as três
  rotas usam: lista, `analyzePostRoute` e `accountRoute`. Assim a leitura por IA também para de
  contar resposta duas vezes. Comentários ocultos continuam entrando na análise (seguem sendo
  comentários do post).
- **Origem do `parent_id`:** primeira tarefa da implementação é conferir em staging se
  `parent_id` vem em `/{media-id}/comments` (o spike só pediu no GET do comentário). Se vier,
  ele é a única fonte. Se não vier, deriva do `replies.limit(25){id}` já buscado, e uma resposta
  além das 25 primeiras de um comentário aparece como item de topo (caso raro, aceito e citado
  no teste).
- `total_fetched` conta itens sem duplicar.

### Frontend (`apps/crm/src`)

**Serviço `services/instagramComments.ts`:** `request` aceita `'DELETE'` e body JSON;
`setCommentHidden(clientId, postId, commentId, hidden)` e `deleteComment(clientId, postId,
commentId)`. Tipos `IgComment` atualizados (`hidden`, `from_owner`, `parent_id`).
`commentsErrorMessage` ganha `forbidden`, `comment_not_found`, `comment_unavailable`,
`owner_comment_not_hideable` e
`write_rate_limited` (checado antes do ramo genérico de 429; ver Textos).

**`PostCommentsPanel.tsx`:**

- `canModerate = can('analytics', 'editar') === true` (de `useAuth`). Falso ou `'unknown'`: a
  lista fica como hoje, sem menu.
- `CommentRow` ganha botão "⋯" (`aria-label="Ações do comentário"`). Desktop: `DropdownMenu`
  do shadcn com "Ocultar comentário" ou "Mostrar comentário" (conforme `hidden`; sem essa
  opção quando `from_owner`) e, separado, "Excluir comentário" em cor de perigo. Celular
  (`compact`, painel dentro do `PostDetailSheet`): o mesmo "⋯" abre o `ActionSheet` de
  `components/mobile`.
- Respostas renderizadas recuadas sob o comentário pai, com o mesmo "⋯".
- Comentário oculto: fundo mais apagado, texto em itálico com cor fraca e selo "Oculto".
  Comentário da conta: selo "Você".
- Ocultar/mostrar: atualização otimista no cache `['ig-post-comments', clientId, postId]`,
  toast `sonner` "Comentário oculto" / "Comentário visível de novo" com ação "Desfazer" (chama
  a ação inversa). Erro: desfaz a mudança local e mostra o erro.
- Excluir: `AlertDialog` "Excluir comentário?" citando `@usuario: texto` (truncado), "Cancelar"
  e "Excluir". Enquanto a chamada roda, o botão fica em carregamento e o diálogo não fecha
  sozinho. Sucesso: remove a linha (e as respostas dela) do cache e mostra "Comentário
  excluído".
- **Recarga da lista depois de excluir:** uma só, com debounce (uns 5 s depois da última
  exclusão), para pegar respostas apagadas junto e a contagem. Nada de invalidar a cada ação:
  cada recarga gasta o limite de leitura `ig-comments-read` (120/hora por workspace, o mesmo das
  aberturas normais da aba). Ocultar/mostrar não recarrega.
- **Recarga em segundo plano que falha não apaga a lista.** Hoje `if (query.error ||
  !query.data)` troca o painel inteiro pelo cartão de erro mesmo com dados em cache
  (`retry: false`). O painel passa a mostrar o cartão de erro só quando não há `data`; com
  `data`, mantém a lista e mostra o erro numa linha discreta.
- `comment_not_found` / `comment_unavailable` em qualquer ação: não apaga a linha por conta
  própria; faz uma recarga da lista e mostra "Não foi possível encontrar esse comentário no
  Instagram. A lista foi atualizada."
- Ação em voo: `useUnsavedWork(pendingActions > 0)` (troca silenciosa de deploy espera).
- O "Mostrando N comentários" do rodapé passa a contar sem duplicatas.

**CSS:** classes `igc-*` novas ficam onde as `igc-*` de hoje estão (conferir `app.css` vs
`style.css` pela regra do `cssSplitBoundary.test.ts`; a aba só existe no app logado).

**i18n:** chaves novas em `packages/i18n/locales/{pt,en}/analyticsComments.json`.

### Textos (pt)

- Menu: "Ocultar comentário", "Mostrar comentário", "Excluir comentário"; `aria-label` "Ações
  do comentário".
- Selos: "Oculto", "Você".
- Diálogo: título "Excluir comentário?"; corpo "Ele sai do Instagram para todo mundo e não dá
  para desfazer. Se quiser só tirar da vista, use Ocultar."; botões "Cancelar", "Excluir".
- Toasts: "Comentário oculto", "Comentário visível de novo", "Desfazer", "Comentário excluído",
  "Não foi possível encontrar esse comentário no Instagram. A lista foi atualizada.".
- Erros: `forbidden` "Você não tem permissão para moderar comentários."; `write_rate_limited`
  "Muitas ações seguidas. Tente de novo em alguns minutos."; `owner_comment_not_hideable`
  "O Instagram não permite ocultar comentários da própria conta."; genérico o de hoje.
- Sem travessão (em-dash) em nenhum texto.

### Testes

- Deno (`supabase/functions/instagram-analytics/__tests__/`): rotas novas com deps falsas
  cobrindo 403 sem permissão, 404 id inválido, 404 comentário de outro post, 404 subcode 33,
  409 ocultar comentário do dono, 409 sem escopo, 429 `write_rate_limited`, 502 com `media`
  ausente (sem chamada de escrita na Graph), sucesso de hide/unhide/delete com audit sem
  texto/username, `TOKEN_EXPIRED` propagado. `fetchMediaComments`: `hidden`/`from_owner`/
  `parent_id`, dedupe (lista plana, id único), `total_fetched`, e as duas rotas de análise
  recebendo textos sem duplicata.
- Vitest: `CommentRow`/painel com e sem `analytics:editar`, opção Ocultar ausente para
  `from_owner`, otimista + desfazer, diálogo de exclusão, `comment_unavailable` recarrega a lista
  sem apagar a linha antes, recarga com debounce, erro de recarga com cache mantém a lista,
  respostas aninhadas.
- Os testes existentes de `comments-routes` e `PostCommentsPanel` que fixam o formato da lista
  mudam junto (contrato mudou).

### Deploy e rollback

Sem migration. Ordem: (1) redeploy de `instagram-analytics` (o frontend antigo segue lendo
`comments[]` plano; só deixa de ver as duplicatas e ignora `hidden`, `from_owner` e
`parent_id`); (2) merge (Vercel publica o frontend). Rollback: frontend primeiro; a function
pode ficar. Voltar só a function também é seguro: o frontend novo, sem `parent_id`, mostra a
lista plana e sem o menu de ações não quebra (tratar campos ausentes como `false`/`null`).

Antes do merge: em staging, ocultar/mostrar/excluir um comentário real pela UI nova e conferir
uma linha no `audit_log`.

## Decisões minhas (para revisar)

- Rate limit de escrita 120/hora por workspace, chave separada da leitura.
- `comment_not_found` em vez de 400 quando o comentário é de outro post.
- Respostas aninhadas (e a correção da contagem dupla) entram nesta mudança.
- Comentários ocultos continuam na leitura por IA.
- Ocultar/mostrar sem confirmação, com "Desfazer"; excluir com confirmação.
- Sem moderação no Hub e no MCP.
- `100/33` vira `comment_unavailable` e a UI recarrega a lista em vez de dizer "excluído".
- Dono comparado com `instagram_user_id` e `professional_account_id`.
- Uma recarga com debounce depois de excluir; erro de recarga com cache não apaga a lista.
- Se hide/delete não funcionarem em respostas (conferido na primeira tarefa), o menu sai das
  respostas.

## Para quem for construir

- Nome exato das funções e componentes, estrutura dos testes.
