# MCP do Admin da plataforma (`mcp-admin`)

**Data:** 2026-09-04
**Status:** proposta, aguardando aprovação

## 1. Objetivo

Um segundo servidor MCP, separado do `mcp` de workspace, para que um agente
(Claude no claude.ai, Claude Desktop, Claude Code ou Codex) opere o **Admin da
plataforma** em nome de um `platform_admin`:

| Recurso | Ver | Criar | Editar |
|---|---|---|---|
| Banners globais (`global_banners`) | sim | sim | sim |
| Popups globais (`global_popups`) | sim | sim | sim, incl. imagem das páginas |
| Artigos de suporte (`kb_articles`) | sim | sim | sim, incl. imagem de capa e imagens inline |
| Workspaces, planos, dashboard | somente leitura | não | não |

Não há tool de exclusão em nenhum recurso. Arquivar um banner ou popup é
`update` com `status: "archived"`; despublicar um artigo é `status: "draft"`.

## 2. Decisões

1. **Autenticação: OAuth, reaproveitando o fluxo existente.** O servidor de
   OAuth do Supabase já é o Authorization Server do `mcp`, o consent page é
   `/oauth/consent` no CRM, e o claude.ai só aceita conectores OAuth. O
   `mcp-admin` é um segundo Resource Server com a mesma AS. O consent page
   ganha a opção **"Administração da plataforma"** (visível só para quem tem
   linha em `platform_admins`), e o grant vai para uma tabela própria,
   `admin_mcp_oauth_grants`. Chaves estáticas (`mesaas_sk_`) ficam fora do v1:
   exigiriam tabela, página de emissão no Admin e um segundo resolver, e todo
   cliente relevante (claude.ai, Desktop, Claude Code, Codex) já fala OAuth
   remoto.
2. **Função edge própria (`supabase/functions/mcp-admin/`)**, não uma extensão
   do `mcp`. O contexto de auth é diferente (`admin_id`/`user_id` em vez de
   `conta_id`), os recursos são globais (nenhuma tabela tem `conta_id`), e os
   escopos são outro allowlist. Compartilhar o `mcp` misturaria dois limites de
   confiança num único binário.
3. **Escrita passa pelos mesmos validadores do `platform-admin`.** Os
   validadores puros de popups (`validatePages`, `validatePopupFields`,
   `normalizePopupText`) saem de `platform-admin/popups.ts` para
   `_shared/admin-popups.ts` e as duas funções importam de lá. Banners e
   artigos ganham validadores puros novos em `_shared/` (hoje o `platform-admin`
   só aplica allowlist de colunas), e o `platform-admin` passa a usá-los também.
4. **Corpo do artigo em Markdown.** O agente lê e escreve `content_markdown`;
   o servidor converte para o JSON TipTap que `kb_articles.content` exige e
   deriva `content_plain`. Nós que o Markdown não representa viajam como blocos
   opacos e voltam intactos (seção 6).
5. **Imagens de artigo vão para o bucket público `kb-images`**, que já existe
   e é o único caminho que funciona para leitores de qualquer workspace. O
   caminho do editor do Admin (R2 sob o `conta_id` do admin) fica como está e
   **não** é exposto pelo MCP: imagens inline com `r2Key` 403 para leitores de
   outros workspaces depois de 1h (`20260717000002_kb_article_screenshots.sql`).
6. **Imagens de popup seguem o caminho da UI do Admin: R2 sob o workspace
   pessoal do admin.** O validador (`validatePages`) já aceita `image_key` sob
   `contas/<conta do admin>/files/`, e `sign-r2-urls` já assina essas chaves
   para qualquer usuário que possa ver o popup, então nem o CRM nem o validador
   mudam. A única obrigação nova é registrar a linha em `files` (via
   `file_insert_with_quota`, como o `file-upload-finalize`): o orphan-scan do
   `post-media-cleanup-cron` move para a lixeira qualquer objeto em `contas/`
   sem linha em `files`/`post_media`. Pré-requisito, já verdadeiro para a UI:
   o admin precisa de `profiles.conta_id`; sem ele a tool responde
   `McpInputError`.

## 3. Arquitetura

```
claude.ai / Desktop / Code / Codex
        │  Bearer <JWT Supabase OAuth>
        ▼
supabase/functions/mcp-admin/index.ts     ── PRM discovery, 401+WWW-Authenticate, 405 GET/DELETE,
        │                                    resolveAdminCtx, rate limit, McpServer por request
        ├─ tools.ts        registro das tools (escopo + audit + errorResult)
        ├─ queries.ts      banners / popups / kb / platform (leitura e escrita)
        ├─ markdown.ts     Markdown ⇄ TipTap + content_plain (puro)
        └─ images.ts       upload_kb_image (bucket kb-images), upload_popup_image (R2 + files)
                           e probe de dimensões
supabase/functions/_shared/mcp-admin-auth.ts  ── escopos, AdminMcpContext, resolveAdminCtx
supabase/functions/_shared/admin-popups.ts    ── validadores de popup (movidos)
supabase/functions/_shared/admin-banners.ts   ── validador de banner (novo)
supabase/functions/_shared/admin-kb.ts        ── validador de artigo (novo)
supabase/functions/mcp-oauth-consent/index.ts ── + `platform_admin` em eligible-workspaces,
                                                  + approve com target "platform"
apps/crm/src/pages/oauth/ConsentPage.tsx      ── + opção "Administração da plataforma"
apps/crm/src/lib/mcp-scopes.ts                ── + ADMIN_SCOPE_OPTIONS
supabase/migrations/<versão>_admin_mcp_oauth_grants.sql
```

### 3.1 Tabela `admin_mcp_oauth_grants`

```sql
create table admin_mcp_oauth_grants (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  client_id   text not null,
  scopes      text[] not null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  revoked_at  timestamptz,
  revoked_by  uuid references auth.users(id) on delete set null,
  unique (user_id, client_id)
);
alter table admin_mcp_oauth_grants enable row level security;
-- Sem policies para authenticated: leitura/escrita só via service role.
grant select, insert, update on admin_mcp_oauth_grants to service_role;
```

O mesmo `client_id` nunca aparece nas duas tabelas de grant para o mesmo
usuário na prática (cada conector registra um client via DCR), mas se aparecer,
cada Resource Server só consulta a sua tabela, então não há vazamento cruzado.
A versão da migration é escolhida na abertura do PR acima do último prefixo em
`origin/main` (hoje `20260907000010`).

### 3.2 Auth (`_shared/mcp-admin-auth.ts`)

```ts
export const ADMIN_MCP_ALLOWED_SCOPES = [
  "banners:read", "banners:write",
  "popups:read",  "popups:write",
  "kb:read",      "kb:write",
  "platform:read",
] as const;

export interface AdminMcpContext {
  admin_id: string;   // platform_admins.id (vai em created_by / author_id)
  user_id: string;    // auth.users.id (actor no audit)
  scopes: string[];
  key_id: string;     // `oauth:<client_id>`
}
```

`resolveAdminCtx(db, token)`:

1. `db.auth.getUser(token)`; falha → `null`.
2. `client_id` do JWT (`client_id` ou `azp`, via `decodeJwtClaim` já existente).
3. `platform_admins` por `user_id`; ausente → `null`. Revalidado **a cada
   request**: remover o admin corta o acesso sem precisar revogar o grant.
4. `admin_mcp_oauth_grants` por `(user_id, client_id)`, `revoked_at is null`;
   ausente → `null`.
5. `scopes = boundGrantScopes(grant.scopes, tokenMcpScopes)`, como no `mcp`.

`requireAdminScope(ctx, scope)` lança `McpScopeError` (reutilizada de
`mcp-token.ts`, junto com `McpInputError`).

`mcp-admin/index.ts` espelha `mcp/index.ts`: mesmo tratamento de CORS e
cabeçalhos MCP, `publicOrigin` para o PRM, `OAUTH_SCOPE = "openid"`, 405 em
GET/DELETE, `checkRateLimit(db, \`mcp-admin:${ctx.key_id}\`, 120, 60)`,
`McpServer` por request com `name: "mesaas-admin"`. Deploy com
`--no-verify-jwt`.

### 3.3 Consent (`mcp-oauth-consent` + `ConsentPage`)

- `eligible-workspaces` passa a devolver também `platform_admin: boolean`
  (consulta `platform_admins` por `user_id`).
- `approve` aceita `target: "workspace" | "platform"` (default `"workspace"`,
  retrocompatível). Com `"platform"`: `conta_id` é ignorado, `scopes` é
  validado contra `ADMIN_MCP_ALLOWED_SCOPES`, o usuário precisa ter linha em
  `platform_admins`, não há gate de `feature_mcp`, e o upsert vai para
  `admin_mcp_oauth_grants` com `onConflict: "user_id,client_id"`. Audit
  `mcp_admin.oauth.grant` sem `conta_id`.
- `ConsentPage`: quando `platform_admin` é true, a lista de workspaces ganha
  um item extra "Administração da plataforma" no topo. Selecioná-lo troca o
  bloco de escopos pelo `ADMIN_SCOPE_OPTIONS` (rótulos em português, preset =
  todos os `:read`). O botão de aprovar envia `target: "platform"`.
- `validateConsentPayload` ganha o campo `target` e só exige `conta_id`
  quando `target === "workspace"`.

Revogação no v1: `mcp-oauth-consent` ganha `list-admin-grants` e
`revoke-admin-grant`. Gate: o chamador precisa estar em `platform_admins`.
Escopo **admin-wide**: qualquer platform admin lista e revoga os grants de
qualquer admin (a tabela não tem `conta_id`; a página de Admins do Admin, no
follow-up, é supervisão entre admins, não autoatendimento). `list-admin-grants`
devolve `{ id, user_id, email, client_id, scopes, created_at, revoked_at }`;
`revoke-admin-grant` recebe `grant_id`, seta `revoked_at`/`revoked_by` e audita
`mcp_admin.oauth.revoke`. Sem UI no v1.

## 4. Tools

Todas retornam JSON em `content[0].text`. Erros seguem o `errorResult` do
`mcp`: `McpScopeError` → `Permission denied: missing scope 'x'`,
`McpInputError` → mensagem literal, resto → `Internal error.` com log interno.
Cada chamada bem-sucedida grava `audit_log` com `action: "mcp_admin.<tool>"`,
`resource_type: "mcp_admin"`, `actor_user_id: ctx.user_id`, sem `conta_id`,
`resource_id` = id do recurso tocado (`banner_id`/`popup_id`/`article_id`/
`workspace_id` do argumento, ou o `id` do resultado num create), e
`metadata: { key_id, tool, args }` onde `args` só carrega ids e filtros.

### 4.1 Banners (`banners:read` / `banners:write`)

| Tool | Entrada | Saída |
|---|---|---|
| `list_banners` | `status?: draft\|active\|archived` | `[{ id, type, content, link, custom_color, target_mode, target_plan_ids, target_workspace_ids, dismissible, starts_at, ends_at, status, dismissal_count, created_at, updated_at }]` |
| `get_banner` | `banner_id` | um banner, mesmo shape |
| `create_banner` | `type, content, target_mode, link?, custom_color?, target_plan_ids?, target_workspace_ids?, dismissible?, starts_at?, ends_at?, status?` | `{ id, status }` |
| `update_banner` | `banner_id` + qualquer subconjunto dos campos acima | `{ id, status }` |

`validateBanner(row)` em `_shared/admin-banners.ts` avalia a linha **mesclada**
(atual + patch), como o popup: `type` e `status` nos enums, `content` 1..500
chars, `link` https ou caminho relativo `/…`, `custom_color` `^#[0-9a-fA-F]{6}$`,
`target_mode: plan` exige `target_plan_ids` não vazio e `workspace` exige
`target_workspace_ids` não vazio (fecha o buraco do `array_length('{}')`),
`ends_at > starts_at`, timestamps parseáveis. Uma migration companheira
troca os dois CHECKs de targeting de `global_banners` para
`coalesce(array_length(...), 0) > 0`, como `global_popups` já faz, para o
invariante valer também fora das edge functions. `dismissal_count` vem de uma
única query agregada em `banner_dismissals` (não o N+1 do handler atual).

### 4.2 Popups (`popups:read` / `popups:write`)

| Tool | Entrada | Saída |
|---|---|---|
| `list_popups` | `status?` | `[{ id, pages, cta_label, cta_url, cta_style, secondary_label, frequency, require_ack, target_mode, target_plan_ids, target_workspace_ids, starts_at, ends_at, status, seen_count, closed_count, cta_count, ack_count, created_at, updated_at }]` |
| `get_popup` | `popup_id` | um popup |
| `create_popup` | `pages` (1..6 de `{ title, eyebrow?, body }`), `target_mode`, e os opcionais `cta_label, cta_url, cta_style, secondary_label, frequency, require_ack, target_plan_ids, target_workspace_ids, starts_at, ends_at, status` | `{ id, status }` |
| `update_popup` | `popup_id` + subconjunto | `{ id, status }` |
| `upload_popup_image` | `filename, mime_type, size_bytes?, source_url?` | seção 7 |

`pages` aceita `image_key` em cada página. Validação =
`validatePages(pages, contaDoAdmin, persistedImageKeys(atual))` +
`validatePopupFields(merged)` + `normalizePopupText`, importados de
`_shared/admin-popups.ts`, exatamente como o `platform-admin`. Em
`update_popup`, `pages` substitui o array inteiro; uma `image_key` passa se
já existir no popup atual (pode ter sido enviada por outro admin) ou se estiver
sob `contas/<conta do admin>/files/`. Quando alguma página traz `image_key`
nova, o servidor resolve `profiles.conta_id` do admin antes de validar; sem
`conta_id` → `McpInputError` (nunca `validatePages` com `allowedContaId`
indefinido, que desligaria a checagem). Antes de persistir, cada `image_key`
nova é finalizada (seção 7). Contadores vêm da view
`popup_interaction_counts` (service role).

### 4.3 Artigos de suporte (`kb:read` / `kb:write`)

| Tool | Entrada | Saída |
|---|---|---|
| `list_kb_articles` | `status?: draft\|published`, `category?` | `[{ id, title, slug, excerpt, category, tags, status, display_order, cover_image_url, updated_at }]` (sem corpo) |
| `get_kb_article` | `article_id` **ou** `slug` (`article_id` prevalece se vierem os dois) | metadados + `content_markdown` + `opaque_blocks: number` |
| `create_kb_article` | `title, slug, category, content_markdown, excerpt?, tags?, status?, display_order?, cover_image_url?` | `{ id, slug, status }` |
| `update_kb_article` | `article_id` + subconjunto (incl. `content_markdown`, `cover_image_url`) | `{ id, slug, status }` |
| `upload_kb_image` | `filename, mime_type, source_url?, article_slug?` | seção 7 |

`validateKbArticle(merged)` em `_shared/admin-kb.ts`: `title` 1..200, `slug`
`^[a-z0-9]+(-[a-z0-9]+)*$` e fora de `RESERVED_SLUGS = ["novo", "editar"]`
(constante passa a viver em `_shared/admin-kb.ts`; `platform-admin` importa de
lá), `category` em `KB_CATEGORIES` (a lista de 15 slugs de
`apps/admin/src/lib/kb-categories.ts` é duplicada em `_shared/admin-kb.ts` com
comentário cruzado, pois Deno e Vite não compartilham import), `status` em
`draft|published`, `tags` array de strings ≤ 40 chars, `display_order` inteiro
≥ 0, `excerpt` ≤ 300, `cover_image_url` https. Slug duplicado → o erro
`23505` do Postgres vira `McpInputError("slug already in use")`.

Quando `content_markdown` está presente, o servidor grava `content` (TipTap) e
`content_plain` juntos; nunca um sem o outro. `author_id = ctx.admin_id` no
create.

### 4.4 Plataforma (`platform:read`)

| Tool | Entrada | Saída |
|---|---|---|
| `list_workspaces` | `search?, plan_id?, offset?, limit? (≤ 100)` | resultado do RPC `admin_list_workspaces` via `handleListWorkspaces` (mesmo shape que a página Workspaces do Admin) |
| `get_workspace` | `workspace_id` | `{ id, name, created_at, plan_id, plan_source, is_internal, members: [{ role, email, joined_at }], counts: { members, clients }, subscription: { status, provider, current_period_end } \| null, overrides }` |
| `list_plans` | nenhuma | `plans` com limites e features, mesmo shape de `list-plans` |
| `get_dashboard` | nenhuma | `{ totals: { workspaces, members, clients, with_overrides, active_plans }, mrr: { mrr_cents, paying_count }, trials: { trial_mrr_cents, trial_count } }` |

**Dados pessoais.** `get_dashboard` devolve **só agregados**: dos `Response`
de `handleGetMrr`/`handleGetTrials` ficam apenas `mrr_cents`, `paying_count`,
`trial_mrr_cents`, `trial_count`; os arrays `workspaces`/`trials` (com
`owner_name`, `owner_email`, `owner_telefone`, `owner_marketing_opt_in`) são
descartados e um teste garante que nenhuma chave `owner_*` aparece na saída.
`list_workspaces` e `get_workspace` mantêm nome e e-mail do dono/membros (é o
que identifica um workspace para o admin), mas removem `telefone`/
`owner_telefone` e `marketing_opt_in`/`owner_marketing_opt_in` antes de
devolver: a transcrição de um agente não é o lugar de telefone de cliente.

As quatro tools reutilizam os handlers do `platform-admin` lendo o `Response`
que devolvem: `handleListWorkspaces` (`list-workspaces.ts`), `handleGetMrr` e
`handleGetTrials` (`mrr.ts`) já são módulos sem `Deno.serve`;
`handleGetWorkspace` (com `buildSubscriptionDetail`, `extractLimits`,
`extractFeatures`) e `handleListPlans` saem de `platform-admin/index.ts` para
`platform-admin/workspace-detail.ts` e `platform-admin/plans.ts` (cut/paste,
sem mudança de comportamento) para poderem ser importados. Uma única
implementação por leitura, sem drift entre Admin e MCP.

## 5. Escopos e UI

`apps/crm/src/lib/mcp-scopes.ts` ganha `ADMIN_SCOPE_OPTIONS` (rótulos:
"Banners: ler/escrever", "Popups: ler/escrever", "Artigos de suporte:
ler/escrever", "Plataforma: ler workspaces, planos e dashboard") e
`ADMIN_READ_PRESET`. O comentário de sincronização com
`_shared/mcp-admin-auth.ts` segue o padrão do arquivo.

Gotcha de deploy (mesmo do `mcp`): `ADMIN_MCP_ALLOWED_SCOPES` é bundlado em
`mcp-admin` **e** `mcp-oauth-consent`. Mudar escopo exige redeploy dos dois
mais o CRM.

## 6. Markdown ⇄ TipTap (`mcp-admin/markdown.ts`)

Puro, sem I/O, testado em unidade. Parser Markdown = `npm:marked` (versão
exata com idade suficiente para o gate de min-dep-age do Deno) usando só o
lexer; a árvore de tokens é mapeada para nós TipTap.

| Markdown | TipTap |
|---|---|
| `## ` / `### ` | `heading` level 2 / 3. `#` (h1) vira h2; `####`+ vira h3 (o renderer só tem 2 e 3) |
| parágrafo | `paragraph` |
| `**x**`, `*x*`, `~~x~~`, `` `x` `` | marks `bold`, `italic`, `strike`, `code` |
| `[t](url)` | mark `link` (`href` https ou relativo) |
| `- ` / `1. ` | `bulletList` / `orderedList` de `listItem > paragraph` |
| `> ` | `blockquote` |
| ```` ``` ```` | `codeBlock` |
| `---` | `horizontalRule` |
| linha terminada em `\` ou dois espaços | `hardBreak` |
| `![alt](url)` em linha própria | `inlineImage { r2Key: null, src: url, alt, width, height, blurSrc: null, displayWidth: null, loading: false }` |
| parágrafo com só uma URL de YouTube | `youtube { src, width: 640, height: 480, start: 0 }` (defaults da extensão) |
| `:::callout emoji=💡 color=blue` … `:::` | `callout { emoji, color }` com o conteúdo interno parseado recursivamente; `color` em `brown\|gray\|orange\|yellow\|green\|blue\|purple\|pink`, default `brown`; emoji default 💡 |
| `<!--tiptap:BASE64-->` em linha própria | o nó decodificado, **validado por `validateTiptapNode`** (abaixo) e inserido |

Serialização inversa cobre a mesma tabela. Qualquer nó ou mark **fora** dela
(`iframe`, `inlineImage` com `r2Key`, `underline`, `textStyle`/`color`,
`highlight`, atributos desconhecidos) é serializado como bloco opaco
`<!--tiptap:BASE64(JSON do nó)-->`; marks desconhecidas em texto viram o texto
sem a mark **e** o parágrafo inteiro vira opaco, para não perder formatação.
Um `youtube` só vira URL simples se `width`/`height`/`start` forem os defaults
(640/480/0); com atributos customizados vai como bloco opaco. `get_kb_article`
devolve `opaque_blocks` para o agente saber que há trechos que ele não deve
reescrever à mão. Isso garante round-trip sem perda para artigos editados na
UI do Admin.

**Validação de schema na escrita.** `content_markdown` é texto livre, então um
bloco opaco digitado à mão é vetor de injeção de nó arbitrário (o artigo
renderiza em todos os workspaces). Todo documento gerado, incluindo cada nó
decodificado de bloco opaco, passa por `validateTiptapDoc(doc)` antes de
persistir. É uma allowlist recursiva: tipos de nó `doc, paragraph, heading
(level 2|3), text, bulletList, orderedList (start int), listItem, blockquote,
codeBlock (language string|null), horizontalRule, hardBreak, inlineImage,
youtube, iframe, callout`; atributos por tipo com forma e domínio fixos
(`inlineImage.r2Key` null ou `^contas/[0-9a-f-]{36}/files/[^/]+$`,
`inlineImage.src` null ou https, `width/height/displayWidth` int|null,
`blurSrc` null ou `data:image/`, `youtube.src` URL do YouTube,
`iframe.src` https em host da allowlist de `IframeExtension.ts`
(loom.com, arcade.software, scribehow.com e subdomínios), `callout.color` na
lista de 8 cores, `callout.emoji` ≤ 8 chars); marks `bold, italic, strike,
code, underline, link (href https ou `/…`), textStyle (color null ou hex),
highlight (color string ≤ 20)`. Qualquer tipo, atributo ou mark fora da lista
→ `McpInputError` nomeando o tipo. A lista de hosts do iframe é duplicada de
`apps/admin/src/components/editor/IframeExtension.ts` com comentário cruzado
e teste de sincronia (seção 9).

`content_plain` = texto de cada bloco de nível superior (recursivo,
`hardBreak` → espaço, imagens → `alt`), blocos unidos por `\n`. É o que
alimenta o índice FTS e o tempo de leitura no CRM.

Dimensões de `inlineImage`: para cada `![alt](url)` o servidor faz um fetch
limitado (https, timeout 5 s, primeiros 64 KB) e lê o header PNG/JPEG/WebP/GIF
para `width`/`height`. Falha no probe → `width`/`height` `null` (o renderer do
CRM já trata `null`, só perde o `aspect-ratio` de placeholder). URLs `http://`
ou não-https são rejeitadas com `McpInputError`.

## 7. Imagens

### 7.1 Artigos (`upload_kb_image`)

Dois modos, decididos por `source_url`:

**A. Importar de URL** (`source_url` presente): o servidor baixa com
`fetchImageSafely` (seção 7.3), grava com service role em
`kb-images/<pasta>/<uuid8>-<nome>.<ext>` (extensão do tipo *sniffado*, não do
`mime_type` declarado) e responde `{ path, public_url, width, height,
size_bytes }`.

**B. Upload direto** (sem `source_url`): responde
`{ path, public_url, upload_url, expires_in: 7200 }` onde `upload_url` vem de
`storage.from("kb-images").createSignedUploadUrl(path)`. O agente faz `PUT`
com o binário e `Content-Type` correto. Dimensões são resolvidas no probe da
seção 6 quando a URL entra num artigo. O que o servidor não vê neste modo é
imposto pelo próprio Storage: uma migration grava em `storage.buckets`
`allowed_mime_types = {image/jpeg,image/png,image/webp,image/gif}` e
`file_size_limit = 10485760` para o bucket `kb-images`, então um PUT com outro
tipo ou maior que 10 MB é recusado pelo Supabase, com ou sem MCP.

`<pasta>` = `article_slug` (validado com a regex de slug) ou `uploads`.
`<nome>` = `filename` normalizado (`[a-z0-9-]`, ≤ 60 chars). `mime_type` em
`image/jpeg|png|webp|gif`; a extensão vem do mime, não do filename. O upload
usa `upsert: false`, então uma colisão de `uuid8` falha em vez de sobrescrever.

O `public_url` serve tanto para `![alt](public_url)` no corpo quanto para
`cover_image_url`. Nenhuma alteração em `sign-r2-urls`: o bucket é público e
`r2Key: null` faz o CRM renderizar o `src` sem assinar.

### 7.2 Popups (`upload_popup_image`)

Espelha o fluxo `file-upload-url → PUT → file-upload-finalize` da UI, com o
`conta_id` de `profiles` do admin (`ctx.user_id`) como dono. Chave
`contas/<conta>/files/<uuid>.<ext>`, `mime_type` em `image/jpeg|png|webp|gif`,
cap 10 MB, quota do workspace do admin checada antes de assinar (mesmo
precheck de `createMediaUpload` do `mcp`).

**A. Importar de URL** (`source_url`): `fetchImageSafely` (seção 7.3); o
servidor grava no R2 com `putObject` de `_shared/r2.ts` (PUT pré-assinado com
`AbortSignal`), chama `file_insert_with_quota` com `kind: "image"`,
`uploaded_by: ctx.user_id`, `width`/`height` do parser de dimensões, e
responde `{ image_key, width, height, size_bytes }`. Falha no insert apaga o
objeto recém-gravado (`deleteObject`) antes de propagar.

**B. Upload direto**: exige `size_bytes`; responde
`{ image_key, upload_url, expires_in: 900 }`. A linha em `files` **não** é
criada aqui. Ela é criada na primeira vez que a `image_key` entra num
`create_popup`/`update_popup`: o servidor faz `headObject` (objeto existe,
`contentType` está na allowlist `image/jpeg|png|webp|gif`, tamanho ≤ 10 MB) e
só então chama `file_insert_with_quota`; objeto ausente → `McpInputError`
("imagem ainda não enviada"), tipo ou tamanho fora do permitido →
`McpInputError` (o objeto fica órfão e o cron o recolhe). É esse HEAD que
impõe no modo B o que o modo A impõe pelo sniff. Um upload que nunca é usado num popup fica sem linha e o
orphan-scan o recolhe no ciclo normal, sem lixo em `files`.

A finalização é idempotente: se já existe linha em `files` com aquela
`r2_key`, nada é inserido.

### 7.3 Fetch seguro (`_shared/safe-image-fetch.ts`)

O pipeline de importação de URL já existe, endurecido, em
`_shared/brand-logo.ts` (`materializeBrandLogo`, camadas 1 a 7 do cabeçalho
daquele arquivo). Ele sai de lá para `_shared/safe-image-fetch.ts` como
`fetchImageSafely(deps, rawUrl, { maxBytes, timeoutMs, truncate? })`, e
`materializeBrandLogo` passa a chamá-lo (a suíte `brand-logo_test.ts` segue
verde como regressão). Regras, na ordem: https apenas; sem credenciais na URL;
host IP-literal rejeitado em qualquer notação; resolução DNS A+AAAA com
deadline de 5 s e rejeição de qualquer endereço loopback, privado, link-local,
CGNAT, multicast, v4-mapped ou NAT64; `redirect: "manual"` com qualquer 3xx
rejeitado; timeout de fetch; `Content-Type` `image/*`; cap por
`Content-Length` e por stream; sniff de magic bytes PNG/JPEG/GIF/WebP (SVG
nunca). `truncate: true` (usado pelo probe de dimensões da seção 6, cap 64 KB)
devolve os primeiros bytes em vez de falhar por tamanho. Risco residual,
aceito como no `brand-logo`: DNS rebinding entre a resolução e o fetch;
`Deno.resolveDns` indisponível no runtime falha **fechado**
(`dns_resolution_failed`), e o smoke do rollout confirma que o modo A funciona
em prod.

## 8. Segurança

- Só quem está em `platform_admins` **hoje** resolve contexto; a checagem é por
  request.
- Nenhuma tool aceita `created_by`, `author_id`, `updated_by` do chamador.
- Nenhuma tool exclui linhas. `archived`/`draft` são o máximo de destruição.
- Colunas gravadas passam por allowlist (`BANNER_COLUMNS`, `POPUP_COLUMNS`,
  `KB_ARTICLE_COLUMNS`) antes do insert/update.
- Fetch de URL externa (probe e importação) passa por `fetchImageSafely`
  (seção 7.3): https, DNS resolvido e checado contra faixas privadas, sem
  redirects, timeout, cap por stream, sniff de bytes.
- Blocos opacos e todo o documento gerado passam por `validateTiptapDoc`
  (seção 6): nenhum nó, atributo ou mark fora da allowlist chega ao banco.
- Erros internos nunca chegam ao cliente; `McpInputError` é a única mensagem
  literal.
- Rate limit `mcp-admin:<key_id>` 120/min, com o mesmo fail-open do `mcp`
  (documentado, não alterado aqui).

## 9. Testes

Deno, em `supabase/functions/__tests__/`, com o fake `makeFakeDb` do padrão
`mcp-writes_test.ts`:

- `mcp-admin-auth_test.ts`: resolveAdminCtx (não-admin → null, grant revogado
  → null, admin removido depois do grant → null, scopes bounded), validação de
  escopos.
- `mcp-admin-markdown_test.ts`: cada linha da tabela da seção 6 nos dois
  sentidos; round-trip de um doc TipTap real com `iframe` + imagem R2 +
  callout aninhado; `content_plain`; h1 → h2.
- `mcp-admin-banners_test.ts`, `mcp-admin-popups_test.ts`,
  `mcp-admin-kb_test.ts`: validadores puros + queries (payload gravado,
  colunas fora da allowlist descartadas, `image_key` novo rejeitado em popup,
  slug duplicado → mensagem amigável, `content`+`content_plain` sempre juntos).
- `safe-image-fetch_test.ts`: os casos de URL/DNS/redirect/cap/sniff hoje em
  `brand-logo_test.ts` passam a exercitar `fetchImageSafely` diretamente
  (`brand-logo_test.ts` continua inteira, como regressão da delegação), mais
  `truncate: true`.
- `mcp-admin-markdown_test.ts` também cobre `validateTiptapDoc`: bloco opaco
  com `iframe` de host fora da allowlist → erro; `inlineImage` com `r2Key`
  fora do formato → erro; mark desconhecida → erro; documento válido com todos
  os tipos → ok; teste de sincronia da lista de hosts com
  `apps/admin/src/components/editor/IframeExtension.ts` e de `KB_CATEGORIES`
  com `apps/admin/src/lib/kb-categories.ts` (lê os dois arquivos e compara).
- `mcp-admin-images_test.ts`: parser de dimensões PNG/JPEG/WebP/GIF em fixtures
  de bytes; popup: chave sob o
  conta do admin, quota excedida → `McpInputError`, admin sem `conta_id` →
  `McpInputError`, finalização no persist (headObject ausente → erro; linha
  em `files` criada uma única vez; `image_key` já persistida não refaz
  headObject).
- `mcp-oauth-consent`: extensão de `mcp-oauth_test.ts` para `target:
  "platform"` (payload, gate de platform_admins, tabela alvo).
- `platform-admin-popups_test.ts` continua passando após o move para
  `_shared/`.
- Vitest: `ConsentPage` com `platform_admin: true` mostra a opção e envia
  `target: "platform"`; sem, comportamento inalterado.
- `supabase/tests/entitlements/`: RLS de `admin_mcp_oauth_grants` (anon e
  authenticated não leem nem escrevem).

## 10. Rollout

1. Migrations em prod **antes** do merge (o merge deploya o CRM na hora):
   `admin_mcp_oauth_grants`, `coalesce` nos CHECKs de `global_banners`,
   limites do bucket `kb-images`. Em staging, aplicar antes as migrations que
   faltam lá (`20260907000010_global_popups.sql` está ausente em staging, e o
   smoke dos popups depende dela).
2. Deploy `mcp-oauth-consent` (JWT on) e `mcp-admin` (`--no-verify-jwt`),
   `--use-api`, prod e staging. `platform-admin` também, por causa do move dos
   validadores.
3. Merge → Vercel publica o consent page novo.
4. Conector: URL `https://<ref>.supabase.co/functions/v1/mcp-admin`, campos
   OAuth em branco, escolher "Administração da plataforma" no consent.
5. Smoke: `get_dashboard`, `list_kb_articles`, `get_kb_article` de um artigo
   com screenshot (verifica `opaque_blocks`/imagens), `create_kb_article`
   draft com `upload_kb_image` modo A (confirma que `Deno.resolveDns` existe
   no runtime; se falhar com `dns_resolution_failed` para um host público,
   abrir follow-up antes de liberar o modo A), `upload_popup_image` modo A +
   `create_popup` draft, conferir no CRM `/ajuda` e no Admin.

## 11. Fora de escopo (follow-ups)

- Chaves estáticas `mesaas_adm_` e página de emissão no Admin.
- UI de revogação de grants de admin na página de Admins.
- `kb_context_links` (vínculo artigo ↔ rota) via MCP.
- Escrita em workspaces/planos.
- Pinar o IP resolvido no fetch (o `fetch` do edge runtime não permite); o
  rebinding fica como risco residual aceito, igual ao `brand-logo`.
