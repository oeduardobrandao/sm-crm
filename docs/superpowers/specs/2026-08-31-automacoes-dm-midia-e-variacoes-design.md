# Automações: cartão com imagem na DM + variações de resposta pública

**Status: aprovado (2026-08-31).** Extensão da automação comentário → DM
(`2026-08-14-instagram-comment-dm-automation-design.md`) e dos botões de link
(`2026-08-19-instagram-dm-link-buttons-design.md`). Este documento tira
"imagem (generic template)" da lista "fora de escopo" do spec dos botões;
o restante daquela lista (postback, quick replies, assinatura do campo
`messages`, fluxos multi-etapa, variáveis `{nome}`, click-tracking)
continua fora.

Uma iniciativa, **duas fatias com implementação simultânea em worktrees
separados e dois PRs**:

- **Fatia 1 — variações de resposta pública**: pool de até 5 respostas ao
  comentário, sorteada uma por envio. Não depende da Meta; merga primeiro.
- **Fatia 2 — cartão com imagem na DM**: generic template (imagem + título +
  subtítulo + botões). Depende de prova empírica em staging (Milestone 0).

## Problema

1. A resposta pública ao comentário é um texto fixo. Num post com dezenas de
   comentários respondidos, a mesma frase repetida parece robô — e todo mundo
   vê (a DM é privada; a resposta pública não).
2. A DM automática é texto puro ou texto + botões de link. O formato que
   converte (padrão ManyChat) é o cartão: imagem de capa do material + frase
   de efeito + botão de CTA. Hoje a "embalagem" do lead magnet é um texto
   seco. O Instagram DM não aceita PDF/arquivo genérico; imagem é o teto
   prático de paridade, e é o que esta entrega cobre.

## Decisões

1. **Variações só na resposta pública, até 5.** A DM não ganha variações
   (é privada, ninguém compara). Cada variação segue o limite atual de 500
   chars. Sorteio uniforme a cada envio.
2. **Mídia da DM: só imagem/GIF nesta entrega** (jpg, png, gif, ≤ 8 MB — o
   limite da Meta). Vídeo e áudio ficam para iteração futura.
3. **Com mídia, a DM vira cartão de texto curto.** O generic template limita
   título e subtítulo a 80 chars cada; não existe "imagem + texto longo" em
   uma private reply (a Meta aceita UMA mensagem por comentário, e uma
   mensagem é texto OU attachment). Com mídia anexada, o formulário troca o
   campo de mensagem por título (≤ 80, reusa `dm_message`) + subtítulo
   opcional (≤ 80, coluna nova), com contadores explícitos. Sem mídia, nada
   muda.
4. **Upload dedicado no R2, prefixo próprio.** `automation-media/{conta_id}/`
   fica fora do alcance do `post-media-cleanup-cron` (que apaga mídia de post
   publicado — automação vive além da publicação). Nada de picker de arquivos
   de post nesta entrega. No envio, presigned GET de 1h para a Meta baixar;
   a mídia continua privada no bucket.
5. **Fallback: perde a imagem, mantém o CTA.** Cartão recusado com erro
   `permanent` → button template (título + subtítulo viram o texto, com os
   botões) → texto puro com links (cadeia existente). Cada degrau só dispara
   em `permanent`; `transient`/`timeout`/`token_expired`/`already_replied`
   seguem as ramificações atuais sem mudança. Máximo 3 POSTs.
6. **Sorteio persistido antes do POST.** A variação escolhida é gravada em
   `instagram_automation_sends.public_reply_text` no MESMO update que grava o
   estado em voo `public_reply_status='unknown'`. A reconciliação pós-crash
   (os dois pontos que hoje comparam `r.text === automation.public_reply`)
   passa a casar contra o texto persistido; reentrada em retry reusa o texto,
   nunca re-sorteia. É o que mantém a garantia "nunca reposta às cegas".
7. **Planos: Pro+Max, mesmo gate atual.** Sem flag nova de entitlement, sem
   env var nova, sem escopo novo da Meta, sem mudança de App Review, sem
   mudança no webhook/parse. `IG_AUTOMATION_SCOPES_LIVE` segue como está.
8. **Milestone 0 da fatia 2 é gate.** Prova real em staging (curl: private
   reply com generic template num comentário de verdade, conta de teste com
   papel no app) ANTES de qualquer UI. A doc da Meta não exemplifica generic
   template em private reply — mesmo buraco documental dos botões, que quase
   recusou por escopo. Se a Meta recusar, a fatia 2 para e reavalia; a
   fatia 1 segue independente.

## Fatia 1 — variações de resposta pública (PR 1)

### Schema

Re-verificar o tail de `git ls-tree origin/main:supabase/migrations` no
momento do `gh pr create` e renumerar acima dele se preciso. Prefixo
reservado ABAIXO do da fatia 2 (fatia 1 merga primeiro).

- `validate_ig_public_replies(jsonb) RETURNS boolean IMMUTABLE`, mesmo
  padrão do `validate_ig_dm_buttons` (CASE para ordem de avaliação, coalesce
  por item): array, 0..5 itens, cada item string com 1..500 chars após
  btrim. Sem REVOKE restritivo (roda como o role que insere).
- `instagram_comment_automations.public_replies jsonb NOT NULL DEFAULT '[]'`
  + CHECK. Backfill na mesma migration, ANTES de adicionar o CHECK:
  `public_replies = jsonb_build_array(public_reply)` onde
  `public_reply IS NOT NULL AND btrim(public_reply) <> ''`. O CHECK atual de
  `public_reply` (char_length 1..500, sem btrim) aceita string só de
  espaços; um valor desses viraria array inválido para o validador novo —
  linhas assim ficam com `[]` (e o CRM novo normaliza `public_reply` para
  NULL na próxima edição).
- **`public_reply` (coluna antiga) FICA.** Entre a migration e o redeploy, o
  código antigo ainda a lê. O CRM novo grava as duas (`public_reply` =
  primeira variação ou NULL) para leitores legados (lista, MCP). O DROP é
  cleanup de um ciclo futuro, fora desta iniciativa.
- `instagram_automation_sends.public_reply_text text` (sem CHECK de
  conteúdo: é snapshot do que foi sorteado).
- RPC `claim_retryable_automation_sends`: DROP + CREATE para devolver
  também `public_reply_text` (precedente de mudança de assinatura:
  `20260819000001`). Entre a migration e o redeploy, o código antigo
  ignora a coluna extra sem quebrar.

### Backend (`instagram-webhook/process.ts`)

- `RevalidatedAutomation` ganha `public_replies`; leitura fail-open no
  padrão `parseDmButtons`: malformado → warn + fallback para
  `public_reply` legado; ambos vazios → sem resposta pública.
- `SendContext` ganha `random?: () => number` (default `Math.random`),
  injetável nos testes.
- Fluxo da resposta pública:
  1. Reentrada com `send.public_reply_text` já gravado → usa esse texto
     (posting e reconciliação), nunca re-sorteia.
  2. Primeira tentativa → sorteia, grava `public_reply_text` + `'unknown'`
     no mesmo UPDATE já existente, e só então chama `replyToComment`.
  3. Reconciliação (reentrada e timeout) casa `r.text` contra o texto
     persistido; para sends em voo criados pelo código antigo
     (`public_reply_text IS NULL`), casa contra QUALQUER item de
     `public_replies` atuais + `public_reply` legado (fallback de transição,
     coberto em teste).
- `ClaimedSend` ganha `public_reply_text` (vem do claim do cron também —
  a RPC `claim_retryable_automation_sends` passa a devolver a coluna).
- **`public_reply_text` não-nulo é autoritativo até o fechamento.** Todos os
  gates que hoje leem `automation.public_reply` atual passam a decidir pela
  resposta PLANEJADA do send: com `public_reply_text` gravado, a
  reconciliação roda e o fechamento (`sent` vs `sent_partial`) considera que
  havia resposta pública pendente — mesmo que um editor tenha esvaziado o
  pool da automação no meio do caminho. Hoje esse cenário fecharia um send
  `unknown` como `sent` sem reconciliar. O pool atual da automação só decide
  quando ainda NÃO há texto persistido (primeira tentativa).

### UI (CRM)

- `AutomationFormDialog`: a textarea única vira lista de 1..5 variações
  (linha + contador 500 + lixeira; "Adicionar variação" some com 5; padrão
  visual do editor de botões). Automação existente abre como lista de 1.
  Validação inline via helper puro (item vazio após trim bloqueia submit).
- Store: `public_replies` nos tipos e whitelists de create/update
  (gravando também `public_reply` = primeira variação); `public_reply_text`
  no tipo do send.
- `AutomacoesPage`: onde o log/lista mostra a resposta pública, usa
  `public_reply_text` do send quando presente.
- i18n pt + en (`automations.json`). Sem travessão na cópia.

### Testes

- Deno (`instagram-webhook-process_test.ts`): sorteio gravado ANTES do POST
  (ordem verificável pelo mock); reentrada reusa texto sem re-sorteio;
  reconciliação casa pelo texto persistido; fallback legado
  (`public_reply_text` NULL) casa contra o pool; send `unknown` com pool
  esvaziado no meio do caminho ainda reconcilia e fecha pelo texto
  persistido (nunca `sent` sem reconciliar); rng injetado torna o caso
  determinístico.
- SQL (`65_instagram_automations.sql`): CHECK rejeita 6 itens, item vazio,
  item 501 chars, não-array; backfill verificado, incluindo o caso
  `public_reply` só de espaços → `[]`; insert válido como `authenticated`
  passa.
- Vitest: editor de variações (adicionar/remover/limites), whitelist do
  store, submit com validação.

## Fatia 2 — cartão com imagem na DM (PR 2)

### Milestone 0 (gate)

Antes de qualquer UI: comentário real em staging → POST de private reply com
`attachment.type=template`, `payload.template_type=generic`, um elemento
`{title, subtitle, image_url, buttons}` → cartão visível no app do
Instagram. Registrar o resultado (payload aceito, forma renderizada) no
topic file de memória. Roda em paralelo ao desenvolvimento da fatia 1.

### Schema

Prefixo reservado ACIMA do da fatia 1; re-verificar tail no `gh pr create`.

- `validate_ig_dm_media(jsonb) RETURNS boolean IMMUTABLE`: NULL passa;
  senão objeto com exatamente `key` (string, prefixo `automation-media/`),
  `content_type` (`image/jpeg` | `image/png` | `image/gif`), `size_bytes`
  (int, 1..8388608), `width`/`height` (int > 0, opcionais).
- `instagram_comment_automations`:
  - `dm_media jsonb` (nullable) + CHECK `validate_ig_dm_media(dm_media)`
    + CHECK de posse: `dm_media IS NULL OR dm_media->>'key' LIKE
    'automation-media/' || conta_id || '/%'`. RLS protege a LINHA, não o
    conteúdo do JSON: sem esse bind, um usuário autenticado apontaria a
    própria automação (via PostgREST) para a key de OUTRA workspace e o
    envio (service role) pré-assinaria o objeto alheio para a Meta. Mesmo
    racional do guard de prefixo do `post-media-finalize`.
  - `dm_subtitle text` + CHECK (NULL, ou 1..80 chars E `dm_media IS NOT
    NULL` — subtítulo só existe com mídia).
  - CHECK adicional: `dm_media IS NULL OR char_length(dm_message) <= 80`
    (com mídia, `dm_message` é o título do cartão; mesmo padrão do
    "≤ 640 com botão").
- `instagram_automation_sends.dm_kind`: CHECK ganha `'card'`,
  `'card_fallback_buttons'` e `'card_fallback_text'`.

### Armazenamento e edge function nova

- Objetos em `automation-media/{conta_id}/{uuid}.{ext}` no bucket R2
  existente. Fora do alcance do cleanup-cron de posts por prefixo.
- Nova function `automation-media` (JWT; toda rota resolve o `conta_id` do
  usuário e só opera sob `automation-media/{conta_id}/`), no MESMO contrato
  de upload do `post-media-finalize`:
  - `POST /presign`: valida content-type/tamanho declarados e devolve
    presigned PUT + a `key` (gerada pela function, nunca pelo cliente).
  - `POST /finalize`: `headObject` no objeto subido; confere que
    content-type e tamanho REAIS batem com os declarados e respeitam os
    limites; registra o objeto em `automation_media_objects` (key pk,
    conta_id, size_bytes) e contabiliza no contador de storage de forma
    atômica com lock, IDEMPOTENTE por key (retry de finalize não re-reserva;
    mesmo lock e fonte de quota do `post_media_insert_with_quota`). Quota
    estourada devolve erro, não deixa registro e o objeto vai para o trash.
    Devolve o objeto `dm_media` canônico, que é o que o CRM grava na
    automação. Sem finalize, nada é gravado.
  - `POST /delete` (troca/remoção/exclusão da automação): o CRM PRIMEIRO
    desanexa no banco (`dm_media = NULL` ou a key nova) e SÓ ENTÃO chama a
    rota, que usa `trashObject` (janela de undo de 30 dias, convenção do
    repo) e libera do contador os bytes REGISTRADOS no servidor para aquela
    key (o request não carrega tamanho: liberação forjada é impossível, e a
    rota é idempotente). Nunca hard-delete imediato; falha na rota deixa
    órfão recuperável, nunca automação apontando para objeto inexistente.
- O jsonb `dm_media` é metadado de apresentação; os pontos de enforcement
  são o finalize (conteúdo real), o CHECK de posse (tenant), um trigger
  BEFORE na própria automação (a key precisa ter registro finalizado da
  mesma workspace, e content_type/size_bytes são normalizados do registro:
  escrita direta via PostgREST não referencia objeto não-finalizado nem
  fabrica metadata) e um índice único parcial na key (posse única: duas
  automações nunca compartilham objeto, o que torna o delete seguro sem
  contagem de referências; a rota /delete ainda recusa com 409 uma key
  referenciada). O `executeSend` re-verifica o prefixo
  `automation-media/{conta_id}/` antes de pré-assinar (defesa em
  profundidade espelhando o CHECK).
- Órfãos por abandono de formulário (upload sem finalize, ou finalize sem
  gravação) são possíveis e ACEITOS como residual (baratos; anotar; um reap
  por prefixo pode entrar no cleanup-cron depois). Órfãos não finalizados
  não contam quota.
- Todo I/O com timeout + AbortSignal (lição do incidente R2: presign +
  fetch puro, nunca o caminho do aws-sdk que trava).

### Envio (`_shared/instagram-dm-payload.ts` + `process.ts`)

- `buildCardMessage(title, subtitle, imageUrl, buttons)`: generic template
  com um elemento; botões reusam a validação de `parseDmButtons`.
- `executeSend`, com `dm_media` presente, monta a lista de tentativas.
  Com botões configurados (3 degraus):
  1. cartão (`kind: 'card'`) — o presigned GET de 1h é gerado aqui;
  2. button template com `título\n\nsubtítulo` como texto
     (`kind: 'card_fallback_buttons'`);
  3. texto com links via `buildFallbackText` (`kind: 'card_fallback_text'`).
  Sem botões (2 degraus): cartão → texto puro `título\n\nsubtítulo`
  (`kind: 'card_fallback_text'`).
  Degrau seguinte só em `permanent`; demais kinds seguem as ramificações
  atuais (transient/timeout → retry recomeça do cartão; token_expired e
  already_replied inalterados). `permanent` em todos os degraus →
  `failed/dm_permanent` com exatamente o número de degraus em POSTs.
- Falha ao gerar o presigned GET (config R2 ausente/erro) classifica como
  `transient` (vai para retry), nunca derruba o send para `failed`.

### UI (CRM)

- `AutomationFormDialog`: seção "Mídia da DM (opcional)" entre a mensagem e
  os botões (padrão visual do mockup aprovado): upload com validação
  client-side de tipo/tamanho ANTES do presign, thumbnail + nome + remover.
  Com mídia anexada, o campo de mensagem vira título (≤ 80) + subtítulo
  opcional (≤ 80) com contadores; mensagem existente > 80 ao anexar mídia
  bloqueia o submit com toast explicativo (o erro nunca vaza como 23514).
- `DmPreview`: renderiza o cartão (imagem, título, subtítulo, botões) e a
  nota da cadeia de fallback; sem mídia, comportamento atual.
- `AutomacoesPage`: chip "cartão" na lista; badge no log quando
  `dm_kind` caiu em fallback.
- Store: `dm_media`/`dm_subtitle` nos tipos e whitelists; serviço de upload
  chama a function `automation-media`.
- i18n pt + en.

### Testes

- Deno: `instagram-dm-payload_test.ts` (buildCardMessage, limites);
  `instagram-webhook-process_test.ts`: cartão → body de generic template +
  `p_dm_kind='card'`; permanent×1 → fallback buttons; permanent×2 → texto;
  permanent×3 → `dm_permanent` com 3 POSTs; presign mockado; falha de
  presign → retry; key fora do prefixo do tenant → send não pré-assina.
  Testes da function `automation-media` (auth, content-type inválido,
  finalize com size/content-type divergentes do HEAD, quota estourada,
  delete usa trashObject).
- SQL: CHECKs de `dm_media` (chave extra, prefixo errado, key de OUTRO
  conta_id, 9 MB, tipo não permitido), `dm_subtitle` sem mídia, título 81
  com mídia; contador de storage incrementa/decrementa.
- Vitest: modo cartão do formulário (troca de campos, contadores, bloqueio
  > 80), preview do cartão, whitelists.

## Coordenação dos dois PRs

- Branches independentes a partir de `main`, worktrees separados (disciplina
  de path absoluto nos prompts de dispatch). Arquivos em conflito garantido:
  `process.ts`, `AutomationFormDialog.tsx`, store de automações,
  `automations.json`, `65_instagram_automations.sql`. **PR 1 merga
  primeiro; PR 2 rebaseia sobre main e resolve lá.**
- Migrations: prefixos distintos (fatia 1 abaixo, fatia 2 acima), cada PR
  re-verifica o tail de origin/main ao abrir (o guard do CI só compara
  contra o próprio PR).
- MCP: a migration `20260829000002` deu escrita de automações ao agente.
  Na implementação de cada fatia, decidir explicitamente se as colunas
  novas entram no caminho do agente ou ficam de fora (e testar o que for
  decidido).
- Review externo do Codex em ambos os PRs; se o review chegar após merge
  rápido, correções via cherry-pick sobre main fresco em PR de follow-up.

## Rollout (cada PR, independente)

1. Staging primeiro: migration → deploy das functions (`instagram-webhook`,
   `instagram-automation-cron` e, na fatia 2, `automation-media`) com
   `--use-api --no-verify-jwt`. Fatia 2: repetir a prova do Milestone 0
   pelo caminho completo (comentário real → send `dm_kind='card'`).
2. Prod: migration ANTES do redeploy das functions (função nova sem coluna
   quebra o select de revalidação); frontend via merge na Vercel. Código
   antigo tolera as colunas novas (defaults satisfazem os CHECKs); código
   novo tolera a janela (fail-open no parse).
3. Smoke pós-deploy: automação existente da DK segue entregando no formato
   antigo (`dm_kind='text'`, resposta pública única via backfill).

## Fora de escopo

Vídeo e áudio na DM; picker de mídia de posts; variações na mensagem da DM;
DROP da coluna `public_reply`; reap de órfãos de `automation-media/`;
postback, quick replies, fluxos multi-etapa, variáveis `{nome}`,
click-tracking; flag de entitlement nova (Max-only).
