# Botões de link na DM da automação comentário → DM

**Status: aprovado (2026-08-19).** Extensão do v1 aprovado em
`2026-08-14-instagram-comment-dm-automation-design.md`. Este documento tira
"botões" da lista "fora do v1" daquele spec; o restante daquela lista
(quick replies, follow-up, fluxos multi-etapa, gatilhos por DM/story)
continua fora.

## Problema

A DM da automação sai como texto puro
(`{ recipient: { comment_id }, message: { text } }` em
`_shared/instagram-messaging.ts`). O caso de uso número 1 das agências é
"comentou LINK → recebe DM com um botão que abre o link" (agenda, WhatsApp,
landing). Hoje a URL vai colada no texto, sem CTA.

## Decisões

1. **Botões de link (web_url), até 3 por automação.** A API do Instagram
   Messaging aceita o *button template*: `message.attachment.type=template`,
   `payload.template_type=button`, `text` ≤ 640 chars, 1 a 3 botões
   (`web_url` | `postback`), título ≤ 20 chars. Só usamos `web_url` nesta
   entrega: `postback` exige assinar o campo `messages` do webhook e não há
   consumidor para o evento ainda.
2. **A doc de private reply só exemplifica texto.** A ManyChat manda o
   "opening DM" com botões na prática, então deve funcionar; mas é fato não
   documentado, como foi o `manage_messages`. Por isso o **milestone 1 é a
   prova real em staging** (comentário de verdade → DM com botão visível)
   antes de polir a UI. Se a Meta recusar, paramos e reavaliamos.
3. **Fallback para texto em erro permanente.** Se o POST com template
   classificar como `permanent` (`IgApiError`), reenviamos uma única vez como
   texto puro com as URLs anexadas ("Título: url" por linha). Seguro porque a
   Meta garante 1 private reply por comentário: nunca duplica DM. `transient`,
   `timeout`, `token_expired` e `already_replied` seguem as ramificações
   atuais, sem fallback (transient tenta o template de novo no retry).
   O erro da PRÓPRIA tentativa de fallback cai nas mesmas ramificações
   existentes, sem tratamento novo: `permanent` → `failed/dm_permanent`;
   `transient`/`timeout` → estado `retry` (a reentrada reconstrói a lista de
   tentativas e recomeça do template); `token_expired` → `failed` + conta
   expirada; `already_replied` → auto-correção (`dmDelivered`), com
   `dm_kind` NULL porque não sabemos qual forma a Meta aceitou.
   `buildFallbackText` mantém ≤ 1000 chars cortando primeiro o texto (com
   "…"); se só as linhas de botão já estouram (3 × título 20 + URL 500 é
   legal pelo CHECK e passa de 1000), derruba linhas de botão do FIM até
   caber, nunca corta uma URL no meio.
4. **`dm_kind` no log de envios** (`text` | `buttons` |
   `buttons_fallback_text`), gravado na transição `dm_status → sent` pela
   mesma RPC `mark_automation_dm_sent` (novo parâmetro `p_dm_kind`, default
   NULL). Em `already_replied` não sabemos a forma entregue: fica NULL.
5. **Coluna nova, não coluna genérica.** `dm_buttons jsonb NOT NULL DEFAULT
   '[]'` com CHECK via função SQL imutável; `dm_message` mantém o CHECK atual
   (1..1000) e ganha um CHECK adicional "≤ 640 quando há botão". Uma futura
   imagem/quick reply será outra coluna; generalizar agora seria YAGNI e
   mexeria no caminho de texto provado em prod.
6. **Sem env var nova, sem escopo novo, sem App Review extra, sem mudança no
   webhook** (`parse.ts` e a assinatura `comments` ficam intactos).
7. **Preview ao vivo no editor** (balão de DM simulado com botões) + nota de
   que templates podem não renderizar no Instagram web (desktop).

## Schema (migration `20260819000001_instagram_dm_buttons.sql`)

Re-verificar o tail de `git ls-tree origin/main:supabase/migrations` no
momento do `gh pr create` e renumerar acima dele se preciso (colisão de
prefixo já ocorreu 2x neste repo; o `migration-version-guard` barra no CI,
mas só contra o que está NO PR).

- `validate_ig_dm_buttons(jsonb) RETURNS boolean IMMUTABLE`: array, 0..3
  itens, cada item objeto com exatamente `title` (string, 1..20 chars após
  btrim) e `url` (string ≤ 500 chars, `~* '^https?://'`). **Sem
  REVOKE/GRANT restritivo**: a função roda como o role que insere
  (authenticated via PostgREST), o default do Supabase já dá EXECUTE.
- `instagram_comment_automations.dm_buttons jsonb NOT NULL DEFAULT '[]'`
  + CHECK `validate_ig_dm_buttons(dm_buttons)`
  + CHECK `(jsonb_typeof(dm_buttons) <> 'array' OR jsonb_array_length(dm_buttons) = 0 OR char_length(dm_message) <= 640)`.
- `instagram_automation_sends.dm_kind text` CHECK NULL ou
  `('text','buttons','buttons_fallback_text')`.
- `mark_automation_dm_sent(p_send_id uuid, p_dm_kind text DEFAULT NULL)`:
  DROP da assinatura antiga + CREATE (o UPDATE condicional grava `dm_kind`
  na mesma transição) + REVOKE PUBLIC + GRANT service_role.
- Linhas existentes: intactas (default `[]` satisfaz os CHECKs).

## Backend

- Novo módulo puro `_shared/instagram-dm-payload.ts`: `DmButton`,
  `PrivateReplyMessage`, `parseDmButtons(raw)`, `buildPrivateReplyMessage
  (text, buttons)`, `buildFallbackText(text, buttons)` (regra de corte na
  Decisão 3). `parseDmButtons` é fail-open POR DESIGN: `undefined`/`null`
  viram `[]` em silêncio (fixtures dos testes e a janela migration→redeploy),
  e um valor presente porém malformado descarta itens com `console.warn` em
  vez de lançar. O ponto de enforcement da forma é o CHECK do banco; um throw
  aqui envenenaria envios por causa de uma coluna de apresentação.
- `sendPrivateReply` recebe `message: PrivateReplyMessage` no lugar de
  `text: string` (único call site: `process.ts`).
- `executeSend`: revalidação inclui `dm_buttons`; a tentativa de DM vira uma
  lista de até 2 mensagens `[template, fallbackTexto]` quando há botões, com
  a regra do item 3. O cron reaproveita `executeSend` sem mudanças.

## UI (CRM)

- `AutomationFormDialog`: bloco "Botões (opcional)" abaixo da DM, 0..3 linhas
  (título ≤ 20 + URL), "Adicionar botão" some com 3; contador do textarea cai
  para 640 com botão; validação via helper puro `pages/automacoes/dmButtons.ts`.
  A URL é validada com `^https?://` PRIMEIRO (portanto `example.com` sem
  esquema falha inline; nunca chega ao CHECK do banco) e depois com
  `sanitizeExternalUrl` como gate de segurança (`javascript:`/credenciais →
  inválida). O valor salvo é o digitado (trim), nunca o reescrito pelo
  sanitizer. Não usar `sanitizeUrl`, que aceita URL relativa.
  Edição de automação antiga com `dm_message` > 640: ao adicionar botão o
  contador fica vermelho e o submit bloqueia com o toast
  `form.validationDmWithButtons` (o erro nunca vaza como 23514 do Postgres);
  caso combinado coberto em `dmButtons.test.ts`.
- `DmPreview.tsx`: balão de DM (monograma do cliente via `sigla`/`cor` do
  registro do CRM, sem dependência nova: é um preview, não uma simulação da
  conta IG), texto, botões empilhados, placeholder quando vazio, nota sobre
  desktop. Tokens shadcn, funciona no dark.
- `AutomacoesPage`: chip "N botões" na lista; badge "enviado como texto" no
  log quando `dm_kind = 'buttons_fallback_text'`.
- Store: `dm_buttons` nos tipos e nas whitelists de create/update; `dm_kind`
  no tipo do send.
- i18n: chaves novas em pt E en (`automations.json`). Sem travessão na cópia.

## Testes

- Deno: `instagram-dm-payload_test.ts` (builder/parse/fallback);
  `instagram-messaging_test.ts` atualizado (texto + template);
  `instagram-webhook-process_test.ts`: `routedFetch` passa a capturar o body;
  casos novos: botões → body de template + `p_dm_kind='buttons'`; permanent →
  fallback texto + `buttons_fallback_text`; permanent 2× → `dm_permanent` com
  exatamente 2 POSTs; transient → retry sem fallback.
- SQL (`65_instagram_automations.sql`): CHECKs (4 botões, URL inválida,
  título 21, chave extra, 641 chars com botão) rejeitam; insert válido como
  `authenticated` passa (prova o EXECUTE da função de CHECK);
  `mark_automation_dm_sent(id, kind)` grava `dm_kind` só na transição.
- Vitest: `dmButtons.test.ts`, `DmPreview.test.tsx`, whitelist no
  `store.instagramAutomations.test.ts`, chip/badge no `AutomacoesPage.test.tsx`.

## Rollout

1. Backend completo primeiro; deploy em staging (migration → functions
   `instagram-webhook` + `instagram-automation-cron`, `--use-api
   --no-verify-jwt`); **milestone 1**: comentário real → send com
   `dm_kind='buttons'` e botão visível no app.
2. PR único (backend + UI). Codex review esperado.
3. Prod: migration ANTES do redeploy das functions (função nova sem a coluna
   quebra o select de revalidação), Vercel via merge. Frontend antigo ignora
   a coluna nova.
4. Smoke: automação existente da DK segue mandando texto (`dm_kind='text'`).

## Fora de escopo

Botão `postback`, quick replies, imagem (generic template), assinatura do
campo `messages`, follow-up/fluxo 2 passos estilo ManyChat, variáveis tipo
`{nome}`, click-tracking (web_url não gera evento de clique). O fluxo em 2
passos é o próximo passo natural e usará `PrivateReplyMessage` como base.
