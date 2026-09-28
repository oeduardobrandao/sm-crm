# Central de Ajuda: playlist de vídeos tutoriais

**Data:** 2026-09-28
**Status:** design aprovado, aguardando plano de implementação

## Objetivo

Tornar a Central de Ajuda do CRM (`/ajuda`) um recurso "video-first": uma playlist de
tutoriais em vídeo aparece no topo, antes da busca e das seções de artigos. Os vídeos são
hospedados no Cloudflare Stream, enviados e organizados pelo Admin da plataforma, e o CRM
guarda o progresso de cada usuário.

Primeiro conteúdo: a série "Primeiros passos no Mesaas", já editada em 8 vídeos curtos
(Primeiro acesso, Equipe, Cliente, Instagram, Fluxo, Post, Portal do cliente, Agendamento).

## Decisões

| Tema | Decisão |
|---|---|
| Layout | Player em destaque + playlist lateral (opção A dos mockups) |
| Unidade | Vídeos separados, agrupados em séries. Sem capítulos dentro de um vídeo |
| Gestão | Página "Vídeos" no Admin, com upload direto para o Stream |
| Playback | Público (`requireSignedURLs: false`). Sem token por visualização |
| Progresso | Por usuário, no banco (`kb_video_progress`) |
| Várias séries | Um player, com seletor de série no cabeçalho da playlist |
| Link próprio | `/ajuda/video/:slug` com o mesmo player + playlist |

## Fora de escopo (v1)

Hub do cliente; busca global (⌘K); links de onboarding/tooltips para vídeos; `allowedOrigins`
no Stream (bloquearia dev local; fácil de ligar depois); legendas; capítulos; comentários
ou avaliação de vídeo; ferramentas no MCP do Admin para vídeos.

## 1. Experiência no CRM

### `/ajuda` (AjudaPage)

Novo bloco `VideoPlaylistHero` acima da busca. Estrutura em grid
`minmax(0,1.7fr) minmax(0,1fr)`:

- **Player (esquerda):** `VideoPlayer` de `@mesaas/ui/VideoPlayer` em 16:9, com `poster`
  = thumbnail do Stream. Abaixo: título, "Ler artigo" (quando `article_id` existe, link para
  `/ajuda/:slug` do artigo) e descrição.
- **Playlist (direita):** cabeçalho com o seletor de série (shadcn `Select`), contador
  "2 de 8" e barra de progresso. Uma linha por vídeo: ícone de estado (concluído,
  tocando agora, não iniciado), número, título, duração `m:ss`. A linha atual fica
  destacada com o tom primário (`--primary-color`, mesmo tom dos chips de categoria).
  Clicar numa linha troca o vídeo sem sair da página.
- **Seleção inicial:** a primeira série (por `display_order`) com algum vídeo não concluído,
  posicionada no primeiro vídeo não concluído dela. Se a URL tiver `?video=<slug>`, esse
  vídeo tem prioridade.
- **Ao terminar (`ended`):** overlay "Próximo: <título>" com contagem de 5s e botão
  "Cancelar". Último vídeo da série: overlay "Série concluída" sem autoplay.
- **Tudo concluído:** o bloco colapsa para uma faixa fina "Tutoriais em vídeo" com botão
  "Rever", que expande o bloco completo (estado só em memória).
- **Sem séries publicadas:** o bloco não renderiza. A página fica como hoje.
- **Carregando:** skeleton com a mesma altura do bloco, para não deslocar a página.
- **Responsivo:** abaixo de 900px a playlist vai para baixo do player (coluna única).

A busca existente passa a casar também título e descrição dos vídeos. O placeholder vira
"Buscar vídeos e artigos...". Resultados de vídeo aparecem antes dos artigos, como cards com
thumbnail + duração que levam a `/ajuda/video/:slug`.

### `/ajuda/video/:slug` (VideoPage)

Mesmo player + playlist (componentes compartilhados), com a série do vídeo selecionada e
link "Voltar para a Central de Ajuda". Slug inexistente ou não publicado: estado vazio
"Vídeo não encontrado" com link de volta. Rota nova em `App.tsx` declarada antes de
`/ajuda/:slug`. `vercel.json` já cobre `/ajuda(/.*)?`, sem mudança. A página define
`document.title` com captura e restauração no cleanup (padrão das páginas do CRM).

### Progresso

- Ao carregar metadados, se houver `position_seconds` salvo e o vídeo não estiver concluído,
  retoma dessa posição (`currentTarget.currentTime` em `onLoadedMetadata`; o `VideoPlayer`
  repassa eventos do `<video>`).
- Salva a posição a cada ~10s de reprodução (throttle em `onTimeUpdate`), em `pause` e em
  `pagehide`/troca de vídeo.
- Concluído quando `currentTime >= 0.9 * duration` ou em `ended`. `completed_at` nunca volta
  a nulo (rever um vídeo não "desconclui").
- Falha ao salvar progresso é silenciosa (log no console). Nunca interrompe o vídeo nem
  mostra toast.
- Saves em voo não usam `useUnsavedWork`: perder 10s de posição num deploy é aceitável.

### Erro de reprodução

`onFatalError` do `VideoPlayer` mostra, no lugar do vídeo, "Não foi possível carregar este
vídeo." com botão "Tentar novamente" (remonta o player via `key`).

## 2. Dados (uma migration)

```sql
kb_video_series (
  id            uuid PK default gen_random_uuid(),
  title         text not null,
  slug          text not null unique,
  description   text,
  display_order integer not null default 0,
  status        text not null default 'draft' check (status in ('draft','published')),
  created_at, updated_at timestamptz
)

kb_videos (
  id               bigint generated always as identity PK,  -- numérico: o cursor do reap
  series_id        uuid not null references kb_video_series(id) on delete restrict,
  title            text not null,
  slug             text not null unique,
  description      text,
  article_id       uuid references kb_articles(id) on delete set null,
  display_order    integer not null default 0,
  status           text not null default 'draft' check (status in ('draft','published')),
  stream_uid       text unique,
  stream_status    text not null default 'pending' check (stream_status in ('pending','ready','error')),
  duration_seconds numeric,
  hls_url          text,
  thumbnail_url    text,
  created_at, updated_at timestamptz
)

kb_video_progress (
  user_id          uuid not null references auth.users(id) on delete cascade,
  video_id         bigint not null references kb_videos(id) on delete cascade,
  position_seconds numeric not null default 0,
  completed_at     timestamptz,
  updated_at       timestamptz not null default now(),
  primary key (user_id, video_id)
)
```

- Triggers de `updated_at` no padrão de `kb_articles`.
- Série com vídeos não pode ser apagada (`on delete restrict`); o Admin mostra o erro.
- **RLS:**
  - `kb_video_series`: `authenticated` lê `status = 'published'`.
  - `kb_videos`: `authenticated` lê `status = 'published' and stream_status = 'ready'` e
    série publicada (`exists` em `kb_video_series`).
  - `kb_video_progress`: `authenticated` faz select/insert/update onde
    `user_id = auth.uid()`. Sem delete.
  - Escrita em séries e vídeos só pelo service role (via `platform-admin`).
- Progresso não é por workspace: o tutorial é do usuário, não da agência.

### Store do CRM (`apps/crm/src/store/kb.ts`)

- `getPublishedVideoSeries()`: séries + vídeos publicados e prontos, ordenados.
- `getVideoBySlug(slug)`.
- `getMyVideoProgress()`: todas as linhas do usuário (volume pequeno).
- `saveVideoProgress(videoId, positionSeconds, completed)`: upsert em `(user_id, video_id)`.
  Quando `completed` é falso, não envia `completed_at`, para não apagar uma conclusão
  anterior.

## 3. Admin: página "Vídeos"

Nova entrada "Vídeos" na navegação, ao lado de "Artigos" (KB). Rotas via
`apps/admin/src/lib/routes.ts`.

- **Lista:** vídeos agrupados por série (ordem das séries e dos vídeos por
  `display_order`), com thumbnail, título, duração, badge de status (Rascunho / Publicado)
  e badge de processamento (Processando / Pronto / Erro, de `stream_status`; "Enviando"
  com percentual é estado local enquanto o upload deste navegador está em curso; linha
  `pending` sem `hls_url` e sem upload local em curso há mais de 1h mostra "Envio
  interrompido" com ação para reenviar). Linhas clicáveis via
  `RowLink`. Ordem editável por botões subir/descer (troca `display_order`).
- **Séries:** criar/editar (título, slug, descrição, status) em diálogo na mesma página.
- **Editor de vídeo** (novo ou existente): título, slug (gerado do título, editável),
  descrição, série, artigo relacionado (select dos artigos publicados), status, e o arquivo.
  Um vídeo só pode ser publicado com `stream_status = 'ready'`.

### Fluxo de upload

1. Admin escolhe o arquivo (`video/*`, até 200 MB, validado no cliente).
2. `platform-admin` action `create-kb-video-upload` (vídeo novo ou existente):
   - chama `POST /accounts/{id}/stream/direct_upload` com
     `{ maxDurationSeconds: 900, requireSignedURLs: false, meta: { kind: 'kb-video' } }`;
   - grava `stream_uid` e `stream_status = 'pending'` na linha **antes** de responder
     (o reap nunca vê esse uid como desconhecido);
   - em vídeo existente com uid anterior, apaga o uid antigo com `deleteStreamVideo`
     (best-effort; se falhar, o reap remove depois, porque ele deixou de ser conhecido);
   - devolve `{ uploadURL, video }`.
3. O navegador envia o arquivo por `POST` multipart direto ao `uploadURL`, com barra de
   progresso (XHR `upload.onprogress`). O upload é envolvido em `trackUnsavedWork`.
4. O Stream processa e dispara o webhook (seção 4). O Admin mostra "Processando" e
   consulta a lista a cada 10s enquanto houver linhas `pending` na tela.
5. Fallback: action `refresh-kb-video` consulta o vídeo no Stream e grava o resultado.
   A lista chama automaticamente para linhas `pending` com mais de 5 minutos.

Novas funções em `_shared/stream.ts`:

- `createStreamDirectUpload(opts)` → `{ uid, uploadURL }`.
- `getStreamVideo(uid)` → `{ state, duration, hls, thumbnail }`.

Ambas seguem o padrão existente: `fetchStreamWithRetry` e `AbortSignal.timeout`. Exigem só
`isStreamCleanupEnabled()` (conta + token), já que o playback público não usa as chaves de
assinatura. Sem Stream configurado, a action responde 503 `stream_not_configured` e o Admin
mostra "Upload de vídeo indisponível neste ambiente."

### Actions novas em `platform-admin`

`list-kb-video-series`, `upsert-kb-video-series`, `delete-kb-video-series`,
`list-kb-videos`, `upsert-kb-video`, `delete-kb-video`, `create-kb-video-upload`,
`refresh-kb-video`, `reorder-kb-videos`.

Todas autorizadas por `platform_admins`, como as actions de KB. `delete-kb-video` apaga a
linha e depois o uid no Stream (best-effort, com o reap como rede de segurança).

A lógica fica em `_shared/admin-kb-videos.ts`, no padrão de `_shared/admin-kb.ts`, para ser
testável sem o servidor.

## 4. Backend: webhook e cleanup

### `stream-webhook`

Hoje o handler só atualiza `files`. Mudança: se o update em `files` casar zero linhas, tenta
`kb_videos`:

```
update kb_videos
set stream_status = mapped,
    duration_seconds = payload.duration,
    hls_url = payload.playback.hls,
    thumbnail_url = payload.thumbnail
where stream_uid = uid and stream_status = 'pending'
```

Mesma regra monotônica (só sai de `pending`) e mesmo contrato de resposta (200 para uid
desconhecido, 5xx só em falha interna). O `.update()` de `files` passa a usar
`.select('id')` para saber quantas linhas casou.

### `post-media-cleanup-cron`: proteger os tutoriais do orphan reap

`orphanReap` (`stream-steps.ts`) apaga todo vídeo do Stream com mais de 1h cujo uid não está
em `files` nem em `file_deletions`. Sem mudança, os tutoriais seriam apagados na próxima
rodada do reap (a cada 6h).

- `orphanReap` passa a somar `fetchKnownStreamUids(deps.db, "kb_videos")` ao conjunto
  conhecido. `kb_videos.id` é `bigint` justamente para caber no cursor numérico existente.
- Falha nessa leitura aborta o reap inteiro, como já acontece com as outras duas tabelas.
- O sweep "settle pending" continua só em `files`. `kb_videos` pendentes são resolvidos
  pelo webhook ou pelo `refresh-kb-video`. O fallback importa: o webhook depende de
  `STREAM_WEBHOOK_SECRET`, que o kill switch do Stream remove.

## 5. Testes

**Deno (`supabase/functions/__tests__/`):**

- `stream-steps_test.ts`: um uid presente só em `kb_videos`, com mais de 1h, não é
  apagado; erro ao ler `kb_videos` aborta o reap sem apagar nada.
- `stream-webhook_test.ts`: um uid de `kb_videos` grava status, duração, HLS e thumbnail;
  linha já `ready` não é rebaixada por um `error` tardio; uid de `files` continua sem
  tocar `kb_videos`.
- `stream-shared_test.ts`: `createStreamDirectUpload` envia `requireSignedURLs: false` e
  `maxDurationSeconds`; `getStreamVideo` mapeia os campos.
- `admin-kb-videos_test.ts`: a action de upload grava o uid antes de responder; o upload
  em vídeo existente apaga o uid antigo; não publica vídeo não pronto; não autorizado → 403;
  sem Stream → 503.

**Entitlements (`supabase/tests/entitlements/`):** usuário A não lê nem escreve o progresso
de B; `authenticated` não vê vídeo em rascunho, `pending`, ou de série em rascunho; e não
escreve em `kb_videos`/`kb_video_series`.

**Vitest (CRM):**

- Seleção inicial: primeira série não concluída, primeiro vídeo não concluído, prioridade
  do `?video=`.
- Regra de conclusão aos 90%, e o upsert que não apaga `completed_at`.
- Colapso quando tudo está concluído.
- A busca casa vídeos.

**Vitest (Admin):** estados de processamento e a regra "publicar exige pronto" no editor.

**Browser:** verificar `/ajuda` e `/ajuda/video/:slug` em desktop e em 375px, claro e escuro.

## 6. Rollout

1. Migration (`db push` staging, depois prod).
2. Deploy de `stream-webhook`, `post-media-cleanup-cron` e `platform-admin`, **antes** de
   qualquer upload. O reap protegido precisa estar no ar antes do primeiro vídeo existir.
3. Merge do frontend (CRM + Admin). Sem séries publicadas, o CRM fica como hoje.
4. Upload dos 8 vídeos de "Primeiros passos" pelo Admin, e depois publicar a série.
