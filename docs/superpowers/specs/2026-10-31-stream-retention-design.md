# Stream só para vídeo em aprovação (retenção do Cloudflare Stream)

Data: 2026-10-31. Status: design para revisão.

## Intenção

O Cloudflare Stream existe para o cliente assistir o vídeo do post **durante a aprovação**, no Hub
(HLS assinado, adaptativo, rápido em celular). Depois que o post foi publicado, o vídeo vive na
plataforma (Instagram, TikTok, YouTube) e o Mesaas não precisa mais servir HLS: o arquivo original
no R2 basta. Hoje o Stream guarda o vídeo para sempre enquanto o `files` existir, e recebe também
todo vídeo da biblioteca de Arquivos, mesmo os que nunca entram num post. O objetivo é que o
Stream guarde só os vídeos que estão ou vão estar diante do cliente, e o resto seja servido do R2.

O motivo é custo: o Stream cobra por minuto armazenado, e esse volume só cresce.

## Estado atual (o que já existe e se aproveita)

- `files.stream_uid` / `files.stream_status` (`pending | ready | error | skipped`). Todo leitor de
  playback (`hub-posts`, `post-media-manage`, `file-manage`) usa o Stream só quando
  `stream_status === 'ready'` e senão cai para o R2. **Tirar um vídeo do Stream não exige mudança
  em player nenhum.**
- O original no R2 (`files.r2_key`) é sempre mantido; o Stream é uma cópia.
- `file-upload-finalize` copia para o Stream na hora todo upload `kind='video'`.
- `post-media-cleanup-cron` (em prod de hora em hora, job `post-media-cleanup-hourly`, `5 * * * *`;
  em staging e bancos novos só o diário `5 3 * * *`, migration `20260925110001`) já tem, em `stream-steps.ts`: ingest
  catch-up (vídeo com `stream_uid` nulo e status nulo/`pending`, mais de 10 min), settle de
  `pending` e orphan reap (uid no Stream que nada no banco conhece). A fila `file_deletions` apaga
  do Stream quando o `files` é apagado.
- `storage-autoclean-cron` (opt-in por workspace) já apaga mídia de post publicado; esses vídeos
  saem do Stream pela fila. Workspaces sem ele ficam com o vídeo no Stream para sempre.

## Decisões do Eduardo

1. **Post publicado sai do Stream depois de uma carência.** O cliente ainda pode rever o vídeo no
   Hub por alguns dias com HLS; passada a carência, o vídeo é liberado do Stream e o Hub passa a
   tocar o MP4 do R2.
2. **Só vídeo de post vai para o Stream.** Upload na biblioteca de Arquivos (sem post) fica só no
   R2. O vídeo entra no Stream quando passa a estar ligado a um post elegível.
3. **Backfill:** os vídeos que já estão no Stream de posts publicados há tempo também saem, pela
   mesma varredura, respeitando os limites de taxa do Stream que já existem.
4. **Post parado também libera.** Post não publicado e sem movimento há muitos dias (aprovação
   abandonada, rascunho esquecido) libera o vídeo. Se o post voltar a andar (por exemplo,
   reenviado ao cliente), o vídeo volta para o Stream.

## Regra central: elegibilidade

Vídeo fora de post (biblioteca pura, ou cujos posts foram apagados) não é elegível: a varredura de
release também tira esses do Stream (decisão 2 aplicada ao acervo).

Um vídeo (`files` com `kind='video'`, não referência) é **elegível ao Stream** quando está ligado
(`post_file_links`) a pelo menos um post "vivo". Um post é vivo quando:

- está `agendado` ou `falha_publicacao` (aprovado e esperando publicar, ou precisando de ação),
  sem limite de tempo; ou
- está publicado (`postado`) há menos de `STREAM_RELEASE_GRACE_DAYS` dias; ou
- está em qualquer outro status (rascunho, revisão, enviado ao cliente, correção) e teve mudança de
  status nos últimos `STREAM_RELEASE_IDLE_DAYS` dias.

(Minha escolha: `agendado` sem limite evita que um post agendado para daqui a meses saia e volte
do Stream.)

Tudo deriva desse único predicado, inclusive a volta ao Stream: não há estado "liberado para
sempre". Um arquivo ligado a vários posts fica no Stream enquanto **qualquer** um deles for vivo.

- **Ingest** (entrar no Stream): vídeo elegível, sem `stream_uid`, e status que permite ingest.
- **Release** (sair do Stream): vídeo com `stream_uid` que deixou de ser elegível.
- Vídeo nunca elegível (biblioteca pura) simplesmente nunca entra.

### Valores padrão (minha escolha, ajustável)

- `STREAM_RELEASE_GRACE_DAYS` = 7.
- `STREAM_RELEASE_IDLE_DAYS` = 60.

Ambos secrets comuns do edge function (mudar não exige deploy), documentados no CLAUDE.md junto
dos outros dials do `post-media-cleanup-cron`.

### "Publicado" e "movimento" (minha escolha)

- Publicado = `workflow_posts.status = 'postado'`. Momento da publicação: `published_at`; se nulo
  (marcado à mão), a última transição para `postado` em `post_status_events`; se nada, `updated_at`.
- Movimento = a última mudança de status em `post_status_events` (se não houver, `created_at` do
  post). Não usar `workflow_posts.updated_at`: o trigger o carimba em todo UPDATE, inclusive de
  crons, o que manteria post abandonado vivo para sempre. Reenviar ao cliente é mudança de status,
  então reinicia o relógio e traz o vídeo de volta.

## Comportamento

### Release (novo passo em `stream-steps.ts`)

Novo passo `releaseSweep`, ao lado de ingest/settle/reap, com o mesmo isolamento (falha de um
passo não bloqueia os outros) e o mesmo `StreamRetryBudget`. Para cada vídeo com `stream_uid` não
elegível, em lote (`STREAM_RELEASE_BATCH`, padrão no mesmo espírito dos outros, por exemplo 50):

1. Gravar a intenção no banco antes da chamada externa, no mesmo padrão do upload: o arquivo fica
   num estado que diz "fora do Stream por política" (novo valor `parked` no CHECK de
   `stream_status`).
2. Apagar o vídeo no Stream (`deleteStreamVideo`, que já trata 404 como sucesso).
3. Limpar `stream_uid`.

A ordem precisa garantir que nenhum estado intermediário deixe um uid vivo no Stream sem que
alguém volte a ele, nem deixe o arquivo marcado `ready` com o vídeo já apagado (o player tentaria
o HLS e falharia em vez de cair no R2). Se o delete falhar, a próxima execução tenta de novo. O
orphan reap continua sendo a rede de segurança para uid que escapou do banco.

O backfill é só este passo rodando sobre o acervo: o tamanho do lote e a cadência horária limitam o
ritmo (50 por execução = até 1.200 por dia em prod), sem migração de dados. O filtro de
elegibilidade tem que estar na query (SQL), antes do `LIMIT`, senão linhas não elegíveis ocupam a
cabeça do lote para sempre.

### Ingest (mudanças)

- `file-upload-finalize`: copia para o Stream na hora só quando o upload já vem ligado a um post
  elegível (o caso do editor de post, o mais comum). Upload de biblioteca grava `parked`, não nulo:
  assim nem o cron novo nem um cron antigo (rollback) o copiam.
- O ingest catch-up do cron passa a exigir elegibilidade (na query, antes do `LIMIT`) e a aceitar
  também `parked`. É assim que um vídeo da biblioteca ligado a um post, ou de um post que voltou a
  andar, entra no Stream.
- **Sem ingest imediato nos outros caminhos** (minha escolha). Há ao menos seis caminhos que ligam
  vídeo a post (`file-manage` POST `/links`, `duplicate_post`/`duplicate_post_targets`,
  `post_media_set_from_uploads`, `post_file_link_replace` e variantes) e o status muda pelo CRM, Hub,
  MCP e crons de publicação. Como o cron roda de hora em hora em prod, o pior caso é o cliente ver o
  MP4 do R2 por até uma hora, o que o player já faz hoje enquanto o Stream processa.

### Fora do escopo

- Vídeos da Central de Ajuda (`kb_videos`): continuam no Stream, sem mudança.
- Referências de post (`stream_status = 'skipped'`): seguem fora do Stream.
- Áudio, imagens, outros buckets: nada muda.
- Qualquer mudança visual no Hub ou no CRM: o fallback para R2 já existe e é o comportamento
  esperado depois da liberação.

## Anti-objetivos (falha mesmo funcionando)

- O cliente abre um post em aprovação e o vídeo não toca, ou fica preso tentando HLS de um vídeo
  apagado.
- Um vídeo entra e sai do Stream repetidamente (ping-pong) por causa de bordas do predicado.
- O release apaga do Stream um vídeo que outro post vivo ainda usa.
- A varredura estoura a cota de taxa da conta do Stream e derruba ingest/settle de vídeos novos.
- Algum tutorial da Central de Ajuda some.

## Deploy e rollback (a detalhar no plano)

- Migration (novo valor `parked` no CHECK, mais a função de elegibilidade se ficar em SQL) antes das
  functions.
- `post-media-cleanup-cron` e `file-upload-finalize`.
- Rollback para um cron antigo é seguro: o ingest dele só pega status nulo/`pending`, então não
  reingere `parked`; o reap continua respeitando `files.stream_uid`.

## Deixado para quem constrói

- Se o predicado vive numa função SQL (preferível: uma fonte só para ingest e release) ou na query
  do cron.
- Tamanho de lote e nomes finais das variáveis.
- Testes: os passos de `stream-steps.ts` já têm suíte com deps injetadas; o release segue o mesmo
  formato.
