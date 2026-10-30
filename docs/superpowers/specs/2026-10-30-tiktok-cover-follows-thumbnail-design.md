# Capa do TikTok segue a miniatura do vídeo

Status: aprovado em 2026-10-30 (opção 1: um editor só, aviso quando o TikTok não consegue seguir).
Substitui o seletor de quadro só do TikTok do #785 (`TikTokCoverFrameDialog`).

## Por quê

A miniatura de um vídeo é do **arquivo** (`files.thumbnail_r2_key`), não do Instagram: o editor
(`ThumbnailPickerDialog`) deixa usar um quadro do vídeo ou enviar uma imagem, e o resultado vale para os
tiles do CRM, o Hub e a capa do Reel. O #785 criou um segundo lugar, só do TikTok, para escolher a capa
(`tiktok_settings.video_cover_timestamp_ms`). Quem escolhe um quadro no editor recebe esse quadro no
Instagram e o quadro padrão no TikTok, a menos que escolha de novo no outro lugar.

Objetivo: **o TikTok segue o que a pessoa fez no editor da miniatura.** Um lugar só.

O limite: a API do TikTok só aceita a posição de um quadro do próprio vídeo
(`post_info.video_cover_timestamp_ms`), nunca uma imagem. Então o TikTok segue o editor quando a miniatura
é um quadro do vídeo, e não consegue seguir quando é uma imagem enviada.

Hoje nada guarda *qual* quadro virou a miniatura: o editor sabe a posição (`video.currentTime`) na hora da
captura e joga fora; o arquivo só tem o JPEG.

Não-objetivos: imagem enviada como capa no TikTok (exigiria embutir a imagem no vídeo); mudar a capa do
Instagram (segue usando o JPEG); carrosséis de fotos do TikTok (`photo_cover_index` não muda).

## Decisões do usuário

- Opção 1: um editor só. Quando a miniatura é uma imagem enviada (ou não se sabe de que quadro veio), o
  TikTok usa o quadro padrão dele e o painel do TikTok avisa, com um botão para abrir o editor.
- O seletor só do TikTok do #785 sai. Em prod, 0 posts têm `tiktok_settings.video_cover_timestamp_ms`
  (consulta de 2026-10-30, 9 posts com `tiktok_settings`), então não há valor a migrar nem fallback.

## Modelo de dados

Migration `20261110000001_files_thumbnail_frame_ms.sql`:

- `files.thumbnail_frame_ms integer NULL`, `CHECK (thumbnail_frame_ms IS NULL OR thumbnail_frame_ms >= 0)`.
  Significado: **o momento do vídeo, em milissegundos, de onde saiu a miniatura atual.** `NULL` = a
  miniatura não é um quadro do vídeo (imagem enviada, capa do Estúdio) ou não se sabe (arquivos de antes
  desta mudança, vídeo que o navegador não decodificou).
- Trigger `trg_files_thumbnail_frame_reset` (`BEFORE UPDATE OF thumbnail_r2_key ON files`): quando
  `thumbnail_r2_key` muda (`IS DISTINCT FROM`), põe `thumbnail_frame_ms := NULL`. Assim toda escrita que
  troca a miniatura sem saber o quadro (RPCs do Estúdio `finalize_design_render`, backfill,
  qualquer caminho futuro) zera o quadro sozinha e o TikTok nunca usa um quadro velho para uma miniatura
  nova. Quem sabe o quadro grava `thumbnail_frame_ms` **num UPDATE seguinte**, que não toca
  `thumbnail_r2_key` e por isso não dispara o trigger. (Um UPDATE único com as duas colunas não serve: o
  trigger não distingue "quadro novo informado" de "quadro igual ao anterior" quando a pessoa recaptura
  no mesmo milissegundo.)
- Sem backfill: um arquivo antigo pode ter a miniatura automática (0,5 s) ou um quadro escolhido; não dá
  para saber, então fica `NULL` e o painel do TikTok mostra o aviso (a pessoa reabre o editor e usa
  "Usar este frame" uma vez).
- `files` não tem allowlist de colunas por GRANT; as functions leem com service role.

## Escritas

| Caminho | Quadro gravado |
|---|---|
| Upload no editor de post (`PostMediaGallery` → `uploadPostMedia` → `file-upload-finalize`) | o momento usado por `extractVideoFrame` (0,5 s ou metade da duração) |
| Upload com miniatura manual (vídeo que o navegador não decodifica, `pendingVideos`) | `NULL` |
| Upload em Arquivos (`FileUploader` → `uploadFile`) | 100 ms (o `captureVideoThumbnail` busca 0,1 s) |
| Ajuste de mídia (`MediaAdjustmentDialog`, recorte sem corte de tempo) → `replacePostMedia` | o momento da prévia (`time`) quando a miniatura foi gerada |
| Reduzir vídeo (`DownscaleMediaDialog`) | reaproveita a miniatura antiga → o `thumbnail_frame_ms` antigo; se gerar uma nova → o momento extraído |
| Editor: "Usar este frame" (`ThumbnailPickerDialog`) | `video.currentTime` na captura |
| Editor: "Enviar imagem" | `NULL` |
| Cópia de arquivo/pasta (`file-manage`) | copia o valor da origem |
| Capa do Estúdio, backfill, MCP | não informam; o trigger zera |

Servidor:

- `file-upload-finalize`: aceita `thumbnail_frame_ms` opcional; só para `kind = 'video'`, inteiro ≥ 0;
  qualquer outro valor é ignorado (fica `NULL`). Grava num UPDATE depois do insert (mesmo padrão do
  `blur_data_url`; o RPC `file_insert_with_quota` não muda) e devolve o campo na resposta.
- `post-media-manage` PATCH com `thumbnail_r2_key`: o UPDATE da miniatura (o trigger zera o quadro) e,
  se `thumbnail_frame_ms` vier válido, um segundo UPDATE gravando o quadro. `toLegacy` passa a devolver
  `thumbnail_frame_ms`.
- `file-manage`: as duas cópias levam `thumbnail_frame_ms: source.thumbnail_frame_ms ?? null`.
- `extractVideoFrame` (`packages/ui/video/frame.ts`) ganha `extractVideoFrameWithTime`, que devolve
  `{ file, timeSeconds }` com o `currentTime` real depois do seek; `extractVideoFrame` passa a delegar
  para ela (os outros chamadores, como o Hub, não mudam).

## Publicação no TikTok

- `buildVideoInitPayload(post, videoUrl, video?)`, com `video = { durationSeconds, thumbnailFrameMs }`:
  a capa é `usableCoverTimestampMs(thumbnailFrameMs, durationSeconds)` (o guard do #785: inteiro ≥ 0 e
  dentro do vídeo). `tiktok_settings.video_cover_timestamp_ms` deixa de ser lido; o campo sai do tipo
  `TikTokSettings`.
- `tiktok-publish`: `validateForTikTokScheduling` passa a selecionar `files.thumbnail_frame_ms`.
- `tiktok-publish-cron`: `fetchPrecheckMedia` passa a selecionar `thumbnail_frame_ms`; o cron usa o do
  vídeo.

## Interface

- **Painel do TikTok** (`TikTokSettingsPanel`, posts de vídeo): a seção "Capa do TikTok" deixa de ter
  seletor próprio. Mostra a miniatura atual e:
  - quadro conhecido: "O TikTok usa o mesmo quadro da miniatura (0:12.3)."
  - `NULL`: aviso "A miniatura atual não é um quadro do vídeo (imagem enviada ou definida antes desta
    versão). O TikTok não aceita imagem como capa e vai usar o quadro padrão dele. Para escolher, abra a
    miniatura e use "Usar este frame"."
  - botão "Editar miniatura", que abre o mesmo `ThumbnailPickerDialog` (bottom sheet no celular) e, ao
    salvar, invalida `['post-media', postId]` e `['workflow-covers']`, como a galeria.
  - O draft do painel deixa de carregar `video_cover_timestamp_ms`.
- **Editor da miniatura**: a descrição passa a citar o TikTok ("No TikTok, a capa é este quadro do vídeo;
  uma imagem enviada não vale para o TikTok, que usa o quadro padrão dele.").
- Sai `TikTokCoverFrameDialog` e as chaves `posts.tiktokCover.*`; entram as novas mensagens do painel.

## Ordem de deploy

1. Migration `20261110000001` (coluna + trigger). Antes dela, as functions novas quebram: o
   `tiktok-publish` e o cron selecionam a coluna explicitamente e dariam erro em todo post de vídeo.
2. `file-upload-finalize`, `post-media-manage`, `file-manage`, `tiktok-publish`, `tiktok-publish-cron`.
3. Merge (frontend). O frontend novo com functions antigas é inofensivo: o quadro enviado é ignorado
   (fica `NULL`) e o painel mostra o aviso; por isso as functions vêm antes, para os uploads já gravarem o
   quadro.

Rollback: functions e frontend voltam livremente (a coluna a mais é ignorada). Não é preciso desfazer a
migration; se for, `DROP TRIGGER` + `DROP COLUMN` só depois de voltar as functions do passo 2.

## Testes

- Deno: `buildVideoInitPayload` (quadro do arquivo, dentro/fora da duração, `NULL`, o campo antigo de
  `tiktok_settings` ignorado); `file-upload-finalize` (grava só vídeo e inteiro ≥ 0); `post-media-manage`
  PATCH (com e sem quadro, ordem dos dois UPDATEs); cópias do `file-manage`; selects do TikTok.
- SQL (`supabase/tests/entitlements/`, rodado no CI): o trigger zera o quadro ao trocar a miniatura e
  mantém quando a miniatura não muda.
- Vitest: `extractVideoFrameWithTime`; o editor envia o quadro na captura e `null` na imagem; os caminhos
  de upload enviam o quadro; o painel do TikTok (quadro conhecido, aviso, botão abre o editor).
