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
   reportado. Cobre os 16 pontos de renderização mapeados abaixo nos dois apps.
2. **Mensagem**: **igual em todo lugar**, neutra — "Mídia indisponível" — em vez de
   copy diferenciada por audiência. Evita vazar detalhes do incidente de storage para o
   cliente e mantém uma única string para manter.
3. **Sinal de "indisponível" é determinístico, vindo do backend** (não `onError` no
   `<img>`): as três funções que hoje assinam URL para exibição de mídia de post
   (contando todas as rotas relevantes de cada uma) passam a checar `media_lost_at` e
   omitir a assinatura quando presente, devolvendo o campo no lugar. O frontend nunca
   chega a tentar carregar uma URL que o servidor já sabe estar morta — para mídia
   anexada via `post_file_links`; ver limite dessa garantia mais abaixo.
4. **Fora de escopo, explicitamente**: `supabase/functions/mcp/queries.ts` (superfície
   de tools do agente MCP) e `_shared/instagram-publish-utils.ts` /
   `_shared/tiktok-publish-utils.ts` (assinatura em tempo de publicação) têm a mesma
   lacuna, mas são classes de bug diferentes (tooling de agente; falha de publicação,
   não exibição) — não tocados nesta spec. **Também fora de escopo** (achado na revisão
   externa, ver seção final): imagens coladas/inline dentro do corpo rich-text do post
   (`post.conteudo`, nós TipTap `inlineImage`) — resolvidas por um mecanismo
   completamente separado (`hub-posts`'s `contentUrlMap` + CRM's função `sign-r2-urls`
   via `inlineImage.ts`), sem relação com `post_file_links`/`files` além de também usar
   `r2_key`. Corrigir isso exige um fallback no nível do node-view do editor TipTap, uma
   forma de trabalho estruturalmente diferente de trocar um `<img>` por um placeholder —
   candidato a spec própria se vier a doer na prática.

## Modelo de dados

Nenhuma migration nova — `files.media_lost_at` já existe (migration `20260814000003`).

**Contrato do campo (corrigido após revisão externa — a redação original era
ambígua/contraditória):** a chave `media_lost_at` vem **sempre presente** na resposta a
partir do deploy desta mudança — `null` quando o arquivo está ok, timestamp ISO quando
perdido permanentemente. Isso é o resultado natural de espalhar a coluna nullable do
Postgres direto no objeto de resposta (`media_lost_at: f.media_lost_at`); não há lógica
de omitir a chave. O `?:` no tipo TypeScript é só a mesma convenção de resiliência a
cache de frontend desatualizado já usada em `blur_data_url?`/`PostMedia.origin?` (uma
resposta cacheada de antes do deploy não tem a chave) — **não** significa "o backend às
vezes omite." O frontend testa por valor, nunca por presença de chave:
`Boolean(media.media_lost_at)`.

```ts
media_lost_at?: string | null; // ausente = resposta cacheada pré-deploy; null = ok; ISO = perdido
```

- `apps/hub/src/types.ts` — `HubPostMedia` (hoje linhas 32-46). **Aqui também precisa
  mudar `url: string` → `url: string | null`** — ao contrário do que a versão anterior
  desta spec afirmou, esse campo NÃO é opcional hoje (só `thumbnail_url` já é
  `string | null`). Deixar de assinar a URL de um arquivo perdido e devolver `null`
  quebra esse tipo se ele não for ajustado. Usar o `tsc` do Hub como checklist: apertar
  o tipo primeiro e deixar o compilador apontar todo consumidor que hoje assume
  `media.url` sempre-string (`InstagramPostCard`, `StoryPostCard`, `PostCard`,
  `PostMediaLightbox`, `InstagramGridPreview`, `SharePostButton` e qualquer outro).
- `apps/crm/src/store/posts.ts` — `PostMedia` (hoje linhas 265-292). `url?: string` e
  `thumbnail_url?: string | null` **já são opcionais** — nenhuma mudança de tipo aqui,
  só adicionar o campo novo.
- `apps/crm/src/pages/arquivos/types.ts` — `FileRecord` (hoje linhas 22-47). Mesma
  situação do `PostMedia` — `url?: string` já opcional, só adicionar o campo novo.

## Backend — três funções, mesmo padrão

Padrão em todos os três: adicionar `media_lost_at` ao `select` de `files`; no
mapeamento de resposta, quando `f.media_lost_at` estiver presente, **pular a chamada de
assinatura** (`signGetUrl`/`signUrl`) e devolver `media_lost_at` no item.

1. **`supabase/functions/hub-posts/handler.ts`**
   - Select de `files` (hoje linhas 198-205): adicionar `media_lost_at`.
   - `mediaWithUrls` (hoje linhas 207-226): `url`/`thumbnail_url` viram
     `f.media_lost_at ? null : await deps.signGetUrl(...)`; incluir `media_lost_at` no
     item retornado.

2. **`supabase/functions/post-media-manage/handler.ts`**
   - `files(*)` já traz a coluna em memória — só falta não descartá-la.
   - `toLegacy()` (hoje linhas 24-56): adicionar `media_lost_at` à allowlist de campos
     do retorno. **A assinatura da função também precisa mudar** — hoje
     `toLegacy(link, file, url: string, thumbnailUrl, playback)` recebe `url` como
     parâmetro posicional obrigatório (linha 27); vira `url: string | null` para aceitar
     o caso "não assinado por estar perdido".
   - Guardar as 4 chamadas de `deps.signUrl` (capas de workflow linha ~130, capas de
     post linha ~167, lista de mídia de um post linha ~189, resposta do PATCH linha
     ~230) com o mesmo `f.media_lost_at ? null : await deps.signUrl(...)`.

3. **`supabase/functions/file-manage/handler.ts`**
   - `GET /folders` já espalha a linha crua de `files` na resposta (hoje linha ~155,
     só filtra `stream_uid`/`stream_status`) — `media_lost_at` já trafega, mas sem tipo
     e sem uso. Adicionar aos tipos e guardar as assinaturas de `url`/`thumbnail_url`
     (hoje linhas ~156-158) do mesmo jeito.
   - **`GET /links?post_id=...`** (hoje linhas 556-581, achado na revisão externa) sofre
     do mesmo problema — assina `url`/`thumbnail_url` sem checar `media_lost_at` (linhas
     575-576). Guardar do mesmo jeito, para o `FileRecord` ter a mesma garantia
     independente da rota que o devolveu. Hoje esse endpoint não tem nenhum caller no
     frontend (`getPostLinks` em `fileService.ts` é exportado mas não é chamado em
     lugar nenhum da UI) — não é um site de bug ativo, é higiene/consistência de
     contrato enquanto o arquivo já está sendo mexido.
   - `GET /files/:id/url` (linha ~384-390, usado só por `getFileDownloadUrl` no botão de
     download do Arquivos) fica **de fora**: é uma ação disparada por clique do usuário
     com seu próprio caminho de erro (download falha e mostra erro), não uma renderização
     passiva de `<img>` — não é o bug relatado.

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

**Correção após revisão externa:** a versão anterior desta spec propunha cobrir 4 pontos
"de graça" passando uma prop nova para `OptimizedImage`. Isso está errado — em todo
ponto que usa `OptimizedImage`, ela só renderiza o ramo `kind === 'image'`; o ramo
`kind === 'video'` desses MESMOS pontos renderiza um `<img src={thumbnail_url}>` (ou
`<video>`) bare, à parte, sem passar por `OptimizedImage` nenhuma (confirmado lendo
`InstagramPostCard.tsx:358-380`, `PostCard.tsx:276-305`,
`PostMediaGallery.tsx:688-709`). Uma prop em `OptimizedImage` deixaria vídeos perdidos
sem placeholder. Correção: o guard fica **antes** da bifurcação por `kind`, em todo
ponto, cobrindo os dois ramos de uma vez — não precisa de mudança nenhuma em
`OptimizedImage`.

Padrão único em todos os 16 pontos abaixo:
```tsx
{media.media_lost_at ? (
  <MediaUnavailable size="compact|full" />
) : media.kind === 'image' ? (
  <OptimizedImage ... />
) : (
  <video ... /> // ou <img> bare, conforme o ponto
)}
```

Hub (`apps/hub/src/components/`):
1. `InstagramPostCard.tsx:358-380`
2. `StoryPostCard.tsx:121-141`
3. `PostCard.tsx:276-305` (capa)
4. `PostCard.tsx:411-443` (miniaturas do carrossel)
5. `PostMediaLightbox.tsx:135-154` — `<img>`/`VideoPlayer` bare
6. `InstagramGridPreview.tsx:59-70` (via `@mesaas/ui/InstagramGrid`)

CRM (`apps/crm/src/pages/`):
7. `entregas/components/PostMediaGallery.tsx:688-709` (`SortableMediaTile`)
8. `entregas/components/PostMediaLightbox.tsx:82-102`
9. `entregas/components/WorkflowCard.tsx:594-620` (capa do kanban)
10. `entregas/components/CalendarPostDetailPanel.tsx:121-137` (distinto do fallback de
    "sem mídia" que já existe ali)
11. `entregas/components/ThumbnailPickerDialog.tsx:96-148`
12. `entregas/components/WorkflowGridView.tsx:109-152` (via `@mesaas/ui/InstagramGrid`)
13. `mensagens/components/PostChip.tsx:70,100`
14. `arquivos/components/FileGrid.tsx:600-618` (`media_lost_at` já chega na resposta
    hoje, só falta tipar e usar)
15. `arquivos/components/FilePickerModal.tsx:211-242`
16. `arquivos/components/MobileArquivosView.tsx:331-333,439-441` (dois pontos)

`@mesaas/ui/InstagramGrid` (usado pelos pontos 6 e 12): avaliar na implementação se vale
adicionar suporte a `media_lost_at` dentro do próprio componente compartilhado (ele já
recebe `url`/`thumbnail_url` prontos) em vez de duplicar o guard nos dois consumidores —
decisão de implementação, não muda o contrato de dados.

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

**Limite dessa garantia** (achado na revisão externa, ver "Fora de escopo" acima): isso
vale para mídia anexada via `post_file_links`/`files` — os 16 pontos listados. Imagens
coladas inline no corpo rich-text do post continuam passando pelo caminho de assinatura
separado (`hub-posts`'s `contentUrlMap`, `sign-r2-urls`), que esta spec não altera, e
ainda podem quebrar do mesmo jeito hoje. Não prometer "nunca mais" de forma geral.

## Testes

**Deno**: convenção real do repo é centralizada em `supabase/functions/__tests__/`, não
por função (corrigido — a versão anterior desta spec citava um caminho que não existe
no repo). Cada uma das três funções ganha um caso onde um item de mídia tem
`media_lost_at` setado — asserta que a resposta não tem `url`/`thumbnail_url`, tem
`media_lost_at`, e que o mock de assinatura NÃO foi chamado para aquele item.
- `post-media-manage` → `supabase/functions/__tests__/post-media-manage_test.ts`
  (existente)
- `file-manage` → `supabase/functions/__tests__/file-manage_test.ts` (existente)
- `hub-posts` → `supabase/functions/__tests__/hub-functions_test.ts` (existente —
  `hub-posts` não tem arquivo de teste dedicado, os casos vivem junto com os outros
  `hub-*` nesse arquivo, ver `Deno.test("hub-posts returns flattened post data...")`)

**Vitest**: `MediaUnavailable` (os dois apps) e pelo menos um teste de integração por
app cobrindo um dos 16 pontos, incluindo pelo menos um caso `kind === 'video'` (para
travar a correção acima — um item de vídeo perdido também precisa cair no guard, não só
imagem).

**Verificação manual**: recarregar as duas URLs do Hub reportadas (posts 1220 e 1562) e
confirmar que o placeholder aparece — sem nenhuma mudança de dado necessária, a
flag já está setada nessas linhas. Checar pelo menos dois pontos do CRM (grid do
Arquivos, card do kanban de Entregas) usando um `file_id` conhecido como perdido.
