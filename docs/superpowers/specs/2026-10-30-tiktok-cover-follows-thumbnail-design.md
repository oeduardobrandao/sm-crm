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
- A pessoa precisa ver, em cada vídeo, se a capa é a padrão (o quadro automático) ou uma que ela
  escolheu (um quadro ou uma imagem), e saber que pode trocar.
- As prévias de mídia no editor de post seguem a proporção do arquivo (1080×1440 não vira quadrado).
- O seletor só do TikTok do #785 sai. Em prod, 0 posts têm `tiktok_settings.video_cover_timestamp_ms`
  (consulta de 2026-10-30, 9 posts com `tiktok_settings`), então não há valor a migrar nem fallback.

## Modelo de dados

Migration `20261110000001_files_thumbnail_frame_ms.sql`:

- `files.thumbnail_frame_ms integer NULL`, `CHECK (thumbnail_frame_ms IS NULL OR thumbnail_frame_ms >= 0)`.
  Significado: **o momento do vídeo, em milissegundos, de onde saiu a miniatura atual.** `NULL` = a
  miniatura não é um quadro do vídeo (imagem enviada, capa do Estúdio) ou não se sabe (arquivos de antes
  desta mudança, vídeo que o navegador não decodificou).
- `files.thumbnail_source text NULL` (migration `20261110000002_files_thumbnail_source.sql`, que veio depois do #786 e recria a função do trigger), `CHECK (thumbnail_source IN ('auto', 'frame', 'image'))`: de onde
  veio a miniatura atual. `auto` = o quadro gerado no upload (ou regerado por um ajuste); `frame` = um
  quadro que a pessoa escolheu; `image` = uma imagem (enviada no editor, "Usar como capa do Reel", capa do
  Estúdio); `NULL` = desconhecido (arquivos de antes desta mudança). Só o quadro não basta para isso: o
  quadro automático e um quadro escolhido no mesmo milissegundo seriam iguais.
- Trigger `trg_files_thumbnail_frame_reset` (`BEFORE UPDATE OF thumbnail_r2_key ON files`): quando
  `thumbnail_r2_key` muda (`IS DISTINCT FROM`), põe `thumbnail_frame_ms := NULL` e
  `thumbnail_source := 'image'` (o único tipo de miniatura sem quadro; `NULL` se a miniatura sumir). Assim toda escrita que
  troca a miniatura sem saber o quadro (RPCs do Estúdio `finalize_design_render`, backfill,
  qualquer caminho futuro) zera o quadro sozinha e o TikTok nunca usa um quadro velho para uma miniatura
  nova, e a capa do Estúdio e o "Usar como capa do Reel" saem como `image` sem mudar nada neles. Quem
  sabe o quadro grava `thumbnail_frame_ms` e `thumbnail_source` **num UPDATE seguinte**, que não toca
  `thumbnail_r2_key` e por isso não dispara o trigger. (Um UPDATE único com as duas colunas não serve: o
  trigger não distingue "quadro novo informado" de "quadro igual ao anterior" quando a pessoa recaptura
  no mesmo milissegundo.)
- Sem backfill: um arquivo antigo pode ter a miniatura automática (0,5 s) ou um quadro escolhido; não dá
  para saber, então fica `NULL` e o painel do TikTok mostra o aviso (a pessoa reabre o editor e usa
  "Usar este frame" uma vez).
- `files` não tem allowlist de colunas por GRANT; as functions leem com service role.

## Escritas

| Caminho | Quadro gravado | Origem |
|---|---|---|
| Upload no editor de post (`PostMediaGallery` → `uploadPostMedia` → `file-upload-finalize`) | o momento usado por `extractVideoFrame` (0,5 s ou metade da duração) | `auto` |
| Upload com miniatura manual (vídeo que o navegador não decodifica, `pendingVideos`) | `NULL` | `image` |
| Upload em Arquivos (`FileUploader` → `uploadFile`) | 100 ms (o `captureVideoThumbnail` busca 0,1 s) | `auto` |
| Ajuste de mídia (`MediaAdjustmentDialog`, recorte sem corte de tempo) → `replacePostMedia` | o momento da prévia quando a miniatura foi gerada | `auto` (a miniatura é regerada, não escolhida) |
| Reduzir vídeo (`DownscaleMediaDialog`) | reaproveita a miniatura antiga → o quadro e a origem antigos; se gerar uma nova → o momento extraído | antiga / `auto` |
| Editor: "Usar este frame" (`ThumbnailPickerDialog`) | `video.currentTime` na captura | `frame` |
| Editor: "Enviar imagem", "Usar como capa do Reel" | `NULL` | `image` (trigger) |
| Cópia de arquivo/pasta (`file-manage`) | copia o valor da origem | copia |
| Capa do Estúdio, backfill, MCP | não informam; o trigger zera | `image` (trigger) |

Servidor:

- `file-upload-finalize`: aceita `thumbnail_frame_ms` e `thumbnail_source` opcionais, só para
  `kind = 'video'` (`videoThumbnailOrigin`): quadro inteiro ≥ 0, origem conhecida; quadro sem origem é
  `auto`; origem `image` descarta o quadro; o resto é ignorado (fica `NULL`). Grava num UPDATE depois do insert (mesmo padrão do
  `blur_data_url`; o RPC `file_insert_with_quota` não muda) e devolve o campo na resposta.
- `post-media-manage` PATCH com `thumbnail_r2_key`: o UPDATE da miniatura (o trigger zera o quadro e
  marca `image`) e, se `thumbnail_frame_ms` vier válido, um segundo UPDATE gravando o quadro com origem
  `frame`. `toLegacy` passa a devolver `thumbnail_frame_ms` e `thumbnail_source`.
- `file-manage`: as duas cópias levam `thumbnail_frame_ms` e `thumbnail_source` da origem.
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

- **Estado da capa** (`videoCoverState(media)`): `default` (`auto`), `frame` (com o momento), `image`,
  `unknown` (`NULL`). É a mesma leitura em todos os lugares abaixo.
- **Galeria do editor de post**: todo vídeo mostra, sempre visível (não só no hover), um selo com o estado:
  "Capa padrão", "Capa 0:12.3", "Capa: imagem" ou "Capa" (desconhecido, com dica). No desktop o selo é o
  botão que abre o editor da miniatura (substitui o ícone de imagem que só aparecia no hover); no celular
  ele mostra o estado e a troca segue pelo menu do toque longo ("Escolher miniatura").
- **Proporção das prévias**: os tiles do desktop, os do celular e a prévia grande do toque longo usam
  `width`/`height` do arquivo (limitado entre 1:2 e 2:1; sem dimensões, quadrado). No desktop os botões
  "Adicionar"/"Escolher" seguem a proporção da primeira mídia; no celular a faixa tem altura fixa e a
  largura varia. As prévias "Miniatura atual"/"Nova miniatura" do editor seguem a proporção do vídeo; a
  prévia "Feed · 1:1" continua quadrada de propósito (é o recorte do Instagram).
- **Editor da miniatura**: abaixo da descrição, a linha "Capa atual: …" com o mesmo estado.
- **Painel do TikTok** (`TikTokSettingsPanel`, posts de vídeo): a seção "Capa do TikTok" deixa de ter
  seletor próprio. Mostra a miniatura atual e:
  - `default`: "O TikTok usa o quadro padrão da miniatura (0:00.5)."; `frame`: "O TikTok usa o quadro
    escolhido na miniatura (0:12.3)."
  - `image` ou `unknown`: aviso "A miniatura atual não é um quadro do vídeo (imagem enviada ou definida antes desta
    versão). O TikTok não aceita imagem como capa e vai usar o quadro padrão dele. Para escolher, abra a
    miniatura e use "Usar este frame"."
  - botão "Editar miniatura", que abre o mesmo `ThumbnailPickerDialog` (bottom sheet no celular) e, ao
    salvar, invalida `['post-media', postId]` e `['workflow-covers']`, como a galeria.
  - O draft do painel deixa de carregar `video_cover_timestamp_ms`.
- **Editor da miniatura**: a descrição passa a citar o TikTok ("No TikTok, a capa é este quadro do vídeo;
  uma imagem enviada não vale para o TikTok, que usa o quadro padrão dele.").
- Sai `TikTokCoverFrameDialog` e as chaves `posts.tiktokCover.*`; entram as novas mensagens do painel.

## Ordem de deploy

Estado da capa (`thumbnail_source`, o follow-up do #786): migration `20261110000002` antes de
`file-upload-finalize`, `post-media-manage` e `file-manage` novos (eles gravam a coluna; sem ela o
finalize loga a falha e salva o arquivo sem quadro, e o PATCH perde o quadro escolhido). O frontend
pode vir em qualquer ordem: sem a coluna, o selo mostra "Capa" (desconhecido).

#786:

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
