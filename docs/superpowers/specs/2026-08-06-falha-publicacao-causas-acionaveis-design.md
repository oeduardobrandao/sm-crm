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

- `markFailed()` em `instagram-publish-cron/index.ts`
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

### Regras (módulo `supabase/functions/_shared/instagram-limits.ts`)

Módulo puro, sem APIs Deno, com constantes e uma função
`validateInstagramMedia(tipo, media[]): Violation[]` onde `media` usa os
metadados já persistidos (`files.size_bytes`, `kind`, `duration_seconds`).

| Regra | Limite |
|---|---|
| Imagem (feed/carrossel/story) | ≤ 8 MB |
| Vídeo feed/reels | ≤ 300 MB, duração 3 s a 15 min |
| Vídeo de story | ≤ 100 MB, duração 3 a 60 s |
| Carrossel | 2 a 10 itens |
| Story | regras por segmento: cada mídia é um segmento e valida individualmente (vídeo ≤ 100 MB / 60 s, imagem ≤ 8 MB); sem limite de quantidade de segmentos |
| Post sem mídia | inválido |

Cada `Violation` já carrega a mensagem em PT pronta (ex.: "A imagem 2 tem
12 MB. O Instagram aceita imagens de até 8 MB."). Sem validação de proporção /
codec / bitrate nesta entrega (metadados não confiáveis o suficiente; ficam
para uma iteração futura, cobertos em runtime por `MEDIA_UNSUPPORTED`).

### Servidor (fonte da verdade)

`validateForScheduling` (usado por `schedule` e `publish-now`) incorpora
`validateInstagramMedia`. Violação retorna o 422 existente com `details`
contendo as mensagens em PT.

### Front (bloqueio com explicação)

`ScheduleButton` roda as mesmas regras sobre a mídia carregada do post e, em
caso de violação, desabilita agendar/publicar e mostra as mensagens. O front
usa um espelho leve das constantes em
`apps/crm/src/pages/entregas/instagramLimits.ts`; um teste Vitest importa o
arquivo do front E o de `_shared/` e falha se as constantes divergirem (guarda
de drift sem acoplar o build do Vite ao diretório das functions).

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
  colapsável "Detalhes técnicos" exibindo o `publish_error` cru.
- **Popover do ScheduleButton:** substitui o texto cru atual
  (`ScheduleButton.tsx:485`) por título + ação curta.
- O tipo `Post` do front (`store/posts.ts` e selects correspondentes) ganha
  `publish_error_code`.

## Parte 4: Notificação in-app

Trigger de banco no padrão existente (`trg_notify_*` de `20260430000001`:
SECURITY DEFINER, corpo inteiro em `EXCEPTION WHEN OTHERS` para nunca
reverter a operação de negócio):

- `AFTER UPDATE OF status ON workflow_posts`, disparando quando
  `NEW.status = 'falha_publicacao' AND OLD.status IS DISTINCT FROM NEW.status`.
  Cobre os três escritores (cron via UPDATE direto, publish-now via RPC, e
  qualquer caminho futuro) sem tocar em cada um.
- **Anti-spam:** dentro da função, notifica apenas se
  `NEW.publish_error_code` é não-retryable **ou** `publish_retry_count >= 3`
  (auto-retries esgotados). Falha transiente que o cron vai resolver sozinho
  não notifica.
- Tipo novo `post_publish_failed` adicionado ao `notifications_type_check`
  copiando a lista da definição mais recente (`20260803000006_mencoes.sql`) e
  atualizando o comentário de "latest definition" para o arquivo novo.
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
  - `validateInstagramMedia`: limites, tipos e mensagens.
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
- Validação de proporção, codec e bitrate no preflight.
- Notificação por e-mail.
- Mensagem suavizada no Hub.
- Parser retroativo para falhas antigas com código NULL.
