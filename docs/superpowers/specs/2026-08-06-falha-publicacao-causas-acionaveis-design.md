# Falha na publicação com causas acionáveis

**Data:** 2026-08-06
**Status:** aprovado para planejamento

## Problema

Quando um post agendado falha ao publicar no Instagram, o card cai em "Falha na
publicação" e o único detalhe disponível é o `publish_error` cru (geralmente a
mensagem em inglês da Graph API, truncada em 500 chars), exibido apenas numa
linha pequena dentro do popover do `ScheduleButton`. O usuário não sabe o que
causou a falha nem o que fazer, o que gera volume de suporte.

Dados de produção (2026-08-06, `workflow_posts.publish_error`):

| Erro | Ocorrências |
|---|---|
| "Please reduce the amount of data you're asking for" (mídia pesada) | 7 |
| "No media files found" (post sem mídia) | 5 |
| "Object with ID '...' does not exist" (container expirado/permissão) | 6 |
| "An unexpected error has occurred. Please retry later." (transiente) | 2 |
| "Tag length overflows ciphertext" (decrypt de token, interno) | 1 |
| "too little or too many attachments to qualify as a carousel" | 1 |

## Decisões de escopo (aprovadas)

1. **Escopo:** classificação de erros acionáveis em PT **e** preflight de mídia,
   juntos nesta entrega.
2. **Superfícies:** WorkflowDrawer (bloco destacado) + popover do ScheduleButton.
   Card do kanban sem mudança.
3. **Preflight:** bloqueia agendamento/publicação; o upload em si continua livre
   (a mídia pode servir só para aprovação interna).
4. **Notificação:** in-app quando a falha se torna acionável (sem e-mail).
5. **Hub:** intocado. Falha de publicação é assunto operacional da agência.
6. **TikTok:** fora do escopo (feature ships dark; zero erros em prod). A coluna
   e o enum ficam prontos para reuso futuro.

## Parte 1: Classificação no backend

### Módulo `supabase/functions/_shared/publish-error-codes.ts`

Exporta:

- `type PublishErrorCode` com os códigos abaixo.
- `NON_RETRYABLE_CODES: PublishErrorCode[]`.
- `classifyPublishError(err: unknown): PublishErrorCode`, uma lista ordenada de
  regras que usa primeiro os campos numéricos anexados pelo `throwGraphError`
  e só depois pattern-matching de mensagem (para os nossos erros internos).

| Código | Regra de classificação (em ordem) | Retryable |
|---|---|---|
| `TOKEN_EXPIRED` | `graphCode === 190` | não |
| `MEDIA_TOO_LARGE` | mensagem contém `reduce the amount of data` (checar ANTES do transiente: a Meta devolve esse texto com code 1) | não |
| `CAROUSEL_LIMIT` | nossa mensagem de >10 itens, ou Graph `too little or too many attachments` | não |
| `NO_MEDIA` | nossa mensagem `No media files found` ou `Stories require exactly one media file` | não |
| `MEDIA_UNSUPPORTED` | nossas mensagens de container `ERROR` ("Container failed processing", "Container falhou no processamento", "Story segment N falhou"), ou subcódigos de mídia da Meta (ex.: 2207026 formato de vídeo não suportado) | não |
| `CONTAINER_EXPIRED` | `graphCode === 100` com `does not exist` / `missing permissions` | sim |
| `RATE_LIMIT` | `graphCode` em {4, 9, 17, 32, 613} (inclui o limite de ~25 publicações/24h da API) | sim |
| `IG_TRANSIENT` | `graphCode` em {1, 2} ou mensagem `retry your request later` | sim |
| `INTERNAL` | mensagens nossas de RPC/presign/decrypt (`mark_platform_published failed`, `Failed to persist`, `Tag length`, `ciphertext`, etc.) | sim |
| `UNKNOWN` | fallback | sim |

### `throwGraphError` enriquecido

Hoje (`_shared/instagram-publish-utils.ts:241`) o helper descarta tudo menos o
code 190. Passa a anexar ao `Error`: `graphCode`, `graphSubcode`, `fbtraceId`.
O campo `err.code === 'TOKEN_EXPIRED'` existente é mantido (o cron e o
publish-now dependem dele para marcar a conta como expirada).

### Persistência

Migration nova (prefixo de versão único, conferir tail de `origin/main` antes
do PR):

```sql
ALTER TABLE workflow_posts ADD COLUMN publish_error_code text;
```

Sem CHECK constraint: código novo no futuro não pode quebrar o insert do cron.

Escritores atualizados para gravar `publish_error_code` junto de
`publish_error`:

- `markFailed()` em `instagram-publish-cron/index.ts`. Além do código, quando a
  classificação é `CONTAINER_EXPIRED` o update também zera
  `instagram_container_id`: o retry automático (`processRetry`) reusa o
  container persistido, e um container expirado nunca volta a funcionar; sem a
  limpeza, as 3 tentativas seriam idênticas e inúteis. Com ela, o retry cai no
  caminho de recriação de container.
- catch do `publish-now` em `instagram-publish/handler.ts`

Todo ponto que hoje limpa `publish_error` (ações `cancel` e `retry` do handler,
caminhos de sucesso que setam `publish_error: null`) passa a limpar também
`publish_error_code`. Verificação obrigatória: grep por `publish_error` em
`supabase/functions/` e `apps/` para não deixar nenhum writer/limpador de fora,
e grep pelos shapes antigos nos dois conjuntos de testes (regra de mudança de
contrato).

Posts que já estão falhados hoje ficam com código `NULL`; o front trata `NULL`
como `UNKNOWN` e mostra o texto cru. Sem parser retroativo.

### Retry do cron para de insistir em erro não-retryable

Nova migration redefine `claim_posts_for_publishing` (copiando a definição MAIS
RECENTE, hoje em `20260720000005_tiktok_publishing.sql`, e registrando no
arquivo que ele passa a ser a definição canônica). Mudança na fase `retry`:

```sql
AND (wp.publish_error_code IS NULL
     OR wp.publish_error_code NOT IN ('TOKEN_EXPIRED','MEDIA_TOO_LARGE',
       'CAROUSEL_LIMIT','NO_MEDIA','MEDIA_UNSUPPORTED'))
```

Hoje o cron queima 3 tentativas idênticas num token expirado. A ação manual
"Tentar novamente" (action `retry` do handler) continua funcionando para
qualquer código, pois zera `publish_error_code` junto com `publish_error`.

## Parte 2: Preflight de mídia

**Correção de rota (revisão externa):** o servidor JÁ valida mídia no
agendamento. `validateForScheduling` chama `validateMedia`
(`_shared/instagram-publish-utils.ts:86`), que hoje impõe: imagem JPEG/PNG/WebP
≤ 8 MB, mínimo 320 px, proporção 3:4 a 1.91:1 (story 9:16); vídeo MP4/MOV
≤ 250 MB, 3 a 90 s (story 60 s), proporção 9:16 a 1.25; carrossel ≤ 10 itens;
≥ 1 mídia. Stories já validam por arquivo com `forStories: true` (cada mídia é
um segmento).

Portanto esta entrega NÃO cria regras novas nem altera limites. Subir os
limites de vídeo para os atuais da Meta (300 MB / 15 min para reels) é uma
decisão de produto separada, registrada em fora de escopo. O gap real é o
front: nada roda essas regras antes do clique, então o usuário só descobre no
422 (ou pior, o post falha depois se a mídia mudou após o agendamento).

### Extração (fonte única)

Mover de `instagram-publish-utils.ts` para um módulo puro novo
`supabase/functions/_shared/instagram-limits.ts` (sem imports Deno): as
constantes de limite, `MediaFile`, `ValidationError`, `validateMedia` e
`CAROUSEL_MAX_ITEMS`. `instagram-publish-utils.ts` importa e re-exporta, para
os consumidores atuais não mudarem. `validateForScheduling` continua como
está (fonte da verdade no servidor, 422 com `details` em PT).

### Front (bloqueio com explicação)

- `apps/crm/src/pages/entregas/instagramLimits.ts`: espelho do módulo
  `_shared` (constantes + `validateMedia` operando sobre `PostMedia[]`). Um
  teste Vitest importa o arquivo do front E
  `supabase/functions/_shared/instagram-limits.ts` e compara constantes e
  resultados de casos-limite, falhando em drift (guarda sem acoplar o build do
  Vite ao diretório das functions; o módulo `_shared` é TS puro e importável
  pelo Vitest).
- `ScheduleButton` ganha prop opcional `media?: PostMedia[]`. Quando presente
  e há violações, desabilita "Agendar" e "Publicar agora" e lista as
  mensagens (mesmo padrão da lista "Falta: ..." existente).
- `WorkflowDrawer` fornece a prop a partir de
  `useQuery({ queryKey: ['post-media', post.id], queryFn: () => listPostMedia(post.id) })`,
  a MESMA queryKey da `PostMediaGallery`, então o cache é compartilhado e não
  há request extra.
- Call sites sem mídia carregada (ex.: `PublicacoesPanel` no calendário) não
  passam a prop e não bloqueiam no cliente; o servidor continua sendo o gate.

## Parte 3: UI no CRM

### Mapa de copy (`apps/crm/src/pages/entregas/publishErrorCopy.ts`)

`Record<PublishErrorCode, { titulo, explicacao, acao }>` com ação tipada:

| Código | Ação primária |
|---|---|
| `TOKEN_EXPIRED` | "Reconectar Instagram" (link para a página do cliente) |
| `MEDIA_TOO_LARGE`, `MEDIA_UNSUPPORTED`, `CAROUSEL_LIMIT`, `NO_MEDIA` | "Revisar mídia" (abre a galeria de mídia do post) |
| `CONTAINER_EXPIRED`, `RATE_LIMIT`, `IG_TRANSIENT`, `UNKNOWN` | "Tentar novamente" (action `retry` existente) |
| `INTERNAL` | Sem botão; copy orienta falar com o suporte |

Regras de copy: português claro, sem jargão, sem em-dash (regra da casa),
explicação de 1 a 2 frases dizendo o que houve e o que fazer.

### Superfícies

- **WorkflowDrawer:** post com status `falha_publicacao` ganha bloco destacado
  no topo (tokens de erro do design system: `--danger` como borda/fundo,
  `--danger-text` para texto) com título, explicação, botão de ação e um
  colapsável "Detalhes técnicos" exibindo o `publish_error` cru. Exceção: para
  o código `INTERNAL` o texto cru NÃO é exibido (mensagens de decrypt/RPC não
  ajudam o usuário e expõem detalhe interno); o bloco mostra apenas a
  orientação de contatar o suporte informando o post.
- **Popover do ScheduleButton:** substitui o texto cru atual
  (`ScheduleButton.tsx:485`) por título + ação curta.
- O tipo `Post` do front (`store/posts.ts` e selects correspondentes) ganha
  `publish_error_code`.

## Parte 4: Notificação in-app

Trigger de banco no padrão existente (`trg_notify_*` de `20260430000001`:
SECURITY DEFINER, corpo inteiro em `EXCEPTION WHEN OTHERS` para nunca
reverter a operação de negócio):

- `AFTER UPDATE OF status, publish_retry_count ON workflow_posts`. Motivo de
  observar as duas colunas: nas falhas repetidas do auto-retry o status NÃO
  transiciona (permanece `falha_publicacao`; só o contador sobe), então um
  trigger apenas de transição de status jamais dispararia no esgotamento dos
  retries.
- **Condição de disparo (anti-spam), dentro da função:** notifica quando
  `NEW.status = 'falha_publicacao'` E uma das duas:
  1. transição de status (`OLD.status IS DISTINCT FROM NEW.status`) com
     `NEW.publish_error_code` não-retryable (falha que o cron não vai
     resolver sozinho; como a fase retry passa a pular esses códigos, a
     transição acontece uma única vez); ou
  2. o contador cruzou o teto: `OLD.publish_retry_count < 3 AND
     NEW.publish_retry_count >= 3` (auto-retries esgotados; o cruzamento só
     ocorre uma vez por ciclo, e um "Tentar novamente" manual zera o contador
     e permite notificar de novo num ciclo futuro, o que é o comportamento
     desejado).
  Falha transiente que o cron resolve sozinho não notifica.
- Tipo novo `post_publish_failed` adicionado ao `notifications_type_check`
  copiando a lista da definição mais recente
  (`20260805000002_post_status_automations.sql`, 18 tipos, inclui
  `post_status_automation`) e atualizando o comentário de "latest definition"
  para o arquivo novo.
- Destinatários via `resolve_notification_targets` existente; `metadata` leva
  `post_id`, `workflow_id`, `publish_error_code` e título do post; `link`
  aponta para o post no CRM.
- Front: renderer do tipo novo no painel de notificações do CRM.

## Fluxo resumido

```
agendar/publicar
  ├─ preflight (front bloqueia; servidor 422 com mensagens PT)
  └─ cron/publish-now falha
       ├─ classifyPublishError() → publish_error_code + publish_error
       ├─ cron retry: pula códigos não-retryable
       ├─ trigger → notificação in-app (não-retryable ou retries esgotados)
       └─ CRM: drawer + popover mostram causa em PT + ação
```

## Testes

- **Deno (`supabase/functions/__tests__/`):**
  - `classifyPublishError`: um caso por código, incluindo os 6 erros reais de
    prod da tabela acima; caso de precedência (mensagem "reduce the amount of
    data" com graphCode 1 vira `MEDIA_TOO_LARGE`, não `IG_TRANSIENT`).
  - `validateMedia` (movido para `_shared/instagram-limits.ts`): limites,
    tipos e mensagens; os testes existentes que o cobrem via
    `validateForScheduling` continuam passando sem mudança (re-export).
  - Testes existentes de `instagram-publish-gate` e do cron atualizados para o
    novo campo gravado.
- **Vitest (`apps/crm/`):**
  - `publishErrorCopy`: todo código tem copy; nenhuma copy contém em-dash.
  - Preflight no `ScheduleButton`: botão bloqueado + mensagem exibida.
  - Paridade de constantes front vs `_shared/instagram-limits.ts`.
- **Contrato:** grep pelos shapes antigos em `apps/**/__tests__` e
  `supabase/functions/__tests__` antes de finalizar; rodar `npm run test` e
  `npm run test:functions` completos (e `git checkout -- deno.lock` depois).
- **Migrations:** prefixos únicos (conferir `git ls-tree origin/main` na hora
  do PR); trigger validado manualmente em staging antes de prod.

## Deploy

1. Migrations no staging (`db push --linked` com link conferido via
   `supabase/.temp/project-ref`), depois prod.
2. Edge functions: `instagram-publish` e `instagram-publish-cron` com
   `--no-verify-jwt --use-api`.
3. Front via merge (Vercel).
4. Ordem segura: migration da coluna primeiro (coluna nova é ignorada pelo
   código antigo), depois functions, depois front.

## Fora de escopo (registrado para o futuro)

- Caminho TikTok (`tiktok_publish_error`) usando o mesmo enum.
- Subir limites de vídeo para os atuais da Meta (reels: 300 MB / 15 min vs os
  250 MB / 90 s do `validateMedia` de hoje). Decisão de produto separada;
  exige confirmar na doc da Meta e testar com vídeo real.
- Backoff para `RATE_LIMIT` / `IG_TRANSIENT` (ex.: coluna `next_attempt_at`
  no claim). Hoje o custo é limitado: no máximo 3 tentativas por post,
  espaçadas por ciclos de cron de ~1 min. Aceito nesta entrega.
- Validação de codec e bitrate no preflight.
- Notificação por e-mail.
- Mensagem suavizada no Hub.
- Parser retroativo para falhas antigas com código NULL.
