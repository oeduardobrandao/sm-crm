# Placeholder "Mídia indisponível" para arquivos perdidos — Design

## Contexto

No incidente de perda de dados do R2 (2026-08-13/14, durante o rollout do Cloudflare
Stream — PRs #349/#351), um bug no scan de órfãos do `post-media-cleanup-cron` apagou permanentemente
milhares de objetos do bucket antes de ser identificado e corrigido. A reconciliação
pós-incidente (migration `20260814000003_files_media_lost.sql`) adicionou a coluna
`files.media_lost_at timestamptz` e marcou ~4.194 imagens + 178 vídeos como
definitivamente perdidos, após esgotar toda tentativa de recuperação (Stream, crawl de
cache de borda). A partir do momento em que essa coluna é preenchida, o arquivo **não é
recuperável** — não há necessidade de lógica de fallback por tipo de mídia (ex.: tentar
Stream para vídeo), a reconciliação já esgotou isso antes de marcar a linha.

Hoje essa coluna só é lida em um lugar do backend (`post-media-cleanup-cron/canary.ts`,
para excluir perdas já conhecidas do alarme de integridade) e em nenhum lugar do
frontend. Toda função que assina URL para exibição continua assinando normalmente para
arquivos marcados como perdidos, e o worker `media-proxy` devolve 404 (o objeto
realmente não existe no R2) — o resultado visível é o ícone de imagem quebrada nativo
do navegador, sem nenhuma explicação, tanto no Hub do cliente quanto no CRM interno.

Caso concreto que motivou esta spec: posts 1220 e 1562 do workspace Araripe MKT
(`5e2dbc8b-9120-4332-90d8-5eff5f81d918`) — 5 arquivos (`files.id` 3853-3856, 4737), todos
com `media_lost_at = 2026-08-14 03:00:00+00`, confirmados perdidos permanentemente.

## Decisões (confirmadas em brainstorming 2026-08-25)

1. **Escopo**: Hub (cliente) **e** CRM (interno) — não só o Hub, onde o bug foi
   reportado. Cobre os ~15 pontos de renderização mapeados abaixo nos dois apps.
2. **Mensagem**: **igual em todo lugar**, neutra — "Mídia indisponível" — em vez de
   copy diferenciada por audiência. Evita vazar detalhes do incidente de storage para o
   cliente e mantém uma única string para manter.
3. **Sinal de "indisponível" é determinístico, vindo do backend** (não `onError` no
   `<img>`): os três endpoints que hoje assinam URL para exibição passam a checar
   `media_lost_at` e omitir a assinatura quando presente, devolvendo o campo no lugar.
   O frontend nunca chega a tentar carregar uma URL que o servidor já sabe estar morta.
4. **Fora de escopo, explicitamente**: `supabase/functions/mcp/queries.ts` (superfície
   de tools do agente MCP) e `_shared/instagram-publish-utils.ts` /
   `_shared/tiktok-publish-utils.ts` (assinatura em tempo de publicação) têm a mesma
   lacuna, mas são classes de bug diferentes (tooling de agente; falha de publicação,
   não exibição) — não tocados nesta spec.

## Modelo de dados

Nenhuma migration nova — `files.media_lost_at` já existe (migration `20260814000003`).

Três tipos TypeScript ganham um campo novo, seguindo a convenção já usada por
`HubPost.media_autocleaned_at` e `PostMedia.origin?` (campo opcional, ausente quando o
arquivo está ok ou quando o cache do cliente é antigo):

```ts
media_lost_at?: string | null; // ISO timestamp; presente = arquivo perdido permanentemente
```

- `apps/hub/src/types.ts` — `HubPostMedia` (hoje linhas 32-46)
- `apps/crm/src/store/posts.ts` — `PostMedia` (hoje linhas 265-292)
- `apps/crm/src/pages/arquivos/types.ts` — `FileRecord` (hoje linhas 22-47)

Quando `media_lost_at` está presente, `url` e `thumbnail_url` ficam `undefined` (ambos
já são opcionais nos três tipos — nenhuma mudança de tipo adicional necessária).

## Backend — três funções, mesmo padrão

Padrão em todos os três: adicionar `media_lost_at` ao `select` de `files`; no
mapeamento de resposta, quando `f.media_lost_at` estiver presente, **pular a chamada de
assinatura** (`signGetUrl`/`signUrl`) e devolver `media_lost_at` no item.

1. **`supabase/functions/hub-posts/handler.ts`**
   - Select de `files` (hoje linhas 198-205): adicionar `media_lost_at`.
   - `mediaWithUrls` (hoje linhas 207-226): `url`/`thumbnail_url` só chamam
     `deps.signGetUrl` quando `!f.media_lost_at`; incluir `media_lost_at` no item
     retornado.

2. **`supabase/functions/post-media-manage/handler.ts`**
   - `files(*)` já traz a coluna em memória — só falta não descartá-la.
   - `toLegacy()` (hoje linhas 24-56): adicionar `media_lost_at` à allowlist de campos
     do retorno.
   - Guardar as 4 chamadas de `deps.signUrl` (capas de workflow linha ~130, capas de
     post linha ~167, lista de mídia de um post linha ~189, resposta do PATCH linha
     ~230) com o mesmo `f.media_lost_at ? undefined : await deps.signUrl(...)`.

3. **`supabase/functions/file-manage/handler.ts`**
   - `GET /folders` já espalha a linha crua de `files` na resposta (hoje linha ~155,
     só filtra `stream_uid`/`stream_status`) — `media_lost_at` já trafega, mas sem tipo
     e sem uso. Adicionar aos tipos e guardar as assinaturas de `url`/`thumbnail_url`
     (hoje linhas ~156-158) do mesmo jeito.

## Frontend — componente novo + pontos de renderização

Sem componente compartilhado entre os apps (padrão já existente no repo —
`OptimizedImage` já é duplicado por app, não compartilhado via `packages/ui`; ver
DESIGN_SYSTEM.md, os dois apps não compartilham design system). Cada app ganha um
componente pequeno e local:

- `apps/hub/src/components/MediaUnavailable.tsx`
- `apps/crm/src/components/MediaUnavailable.tsx`

Ícone `ImageOff` do `lucide-react` (mesmo ícone já usado no estado vazio irmão de
`PostMediaGallery.tsx` para mídia auto-limpa) + texto "Mídia indisponível". Prop
`size: 'compact' | 'full'`: `compact` mostra só o ícone (contextos apertados — capa de
card do kanban, chip de mensagens, miniaturas de carrossel), `full` mostra ícone + texto
(lightbox, tile de galeria, card de feed/story, célula de grid do Arquivos).

### Pontos de renderização a atualizar

**`OptimizedImage`** (`apps/hub/src/components/OptimizedImage.tsx` e
`apps/crm/src/components/OptimizedImage.tsx`) ganha uma prop opcional `unavailable?:
boolean` — quando `true`, renderiza `MediaUnavailable` no lugar do `<img>`. Isso cobre
de graça 4 dos pontos abaixo.

Hub (`apps/hub/src/components/`):
1. `InstagramPostCard.tsx:358-380` — via prop nova em `OptimizedImage`
2. `StoryPostCard.tsx:121-141` — via prop nova em `OptimizedImage`
3. `PostCard.tsx:276-305` (capa) — via prop nova em `OptimizedImage`
4. `PostCard.tsx:411-443` (miniaturas do carrossel) — via prop nova em `OptimizedImage`
5. `PostMediaLightbox.tsx:135-154` — `<img>`/`VideoPlayer` bare, condicional manual
6. `InstagramGridPreview.tsx:59-70` (via `@mesaas/ui/InstagramGrid`) — condicional manual

CRM (`apps/crm/src/pages/`):
7. `entregas/components/PostMediaGallery.tsx:688-709` (`SortableMediaTile`) — via prop
   nova em `OptimizedImage`
8. `entregas/components/PostMediaLightbox.tsx:82-102` — condicional manual
9. `entregas/components/WorkflowCard.tsx:594-620` (capa do kanban) — condicional manual
10. `entregas/components/CalendarPostDetailPanel.tsx:121-137` — condicional manual
    (distinto do fallback de "sem mídia" que já existe ali)
11. `entregas/components/ThumbnailPickerDialog.tsx:96-148` — condicional manual
12. `entregas/components/WorkflowGridView.tsx:109-152` (via `@mesaas/ui/InstagramGrid`)
    — condicional manual
13. `mensagens/components/PostChip.tsx:70,100` — condicional manual
14. `arquivos/components/FileGrid.tsx:600-618` — condicional manual (`media_lost_at` já
    chega na resposta hoje, só falta tipar e usar)
15. `arquivos/components/FilePickerModal.tsx:211-242` — condicional manual
16. `arquivos/components/MobileArquivosView.tsx:331-333,439-441` — condicional manual
    (dois pontos)

`@mesaas/ui/InstagramGrid` (usado pelos pontos 6 e 12): avaliar na implementação se vale
adicionar a mesma prop `unavailable` ao componente compartilhado (ele já recebe
`url`/`thumbnail_url` prontos) em vez de duplicar a lógica de novo nos dois
consumidores — decisão de implementação, não muda o contrato de dados.

## Tratamento de erro

O sinal é determinístico (vem do backend), não depende de `onError`. Isso evita
especificamente um bug real encontrado na investigação: o lightbox do Hub
(`PostMediaLightbox.tsx`) hoje trata qualquer falha de carregamento como "URL
assinada expirou" e dispara refetch (`onStaleUrl` → invalidação de query) — para um
arquivo permanentemente perdido isso causaria um loop de refetch inútil. Como o item
perdido nunca chega a ter `url` preenchido, o componente nem tenta renderizar o
`<img>`, então esse caminho de refetch nunca é acionado para esse caso. O
comportamento de refetch em si continua existindo e correto para o caso legítimo
(arquivo existe, URL assinada expirou).

## Testes

**Deno** (`supabase/functions/*/⁠__tests__/`): para cada uma das três funções, um caso
onde um item de mídia tem `media_lost_at` setado — asserta que a resposta não tem
`url`/`thumbnail_url`, tem `media_lost_at`, e que o mock de assinatura NÃO foi chamado
para aquele item.

**Vitest**: `MediaUnavailable` (os dois apps), a prop nova de `OptimizedImage`, e pelo
menos um teste de integração por app cobrindo um dos pontos "condicional manual"
(prova que o padrão funciona fora do `OptimizedImage`, não precisa cobrir os 16 pontos
individualmente).

**Verificação manual**: recarregar as duas URLs do Hub reportadas (posts 1220 e 1562) e
confirmar que o placeholder aparece — sem nenhuma mudança de dado necessária, a
flag já está setada nessas linhas. Checar pelo menos dois pontos do CRM (grid do
Arquivos, card do kanban de Entregas) usando um `file_id` conhecido como perdido.
