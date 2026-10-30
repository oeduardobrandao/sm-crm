# MCP Apps cards: rollout runbook

Spec: `docs/superpowers/specs/2026-10-29-mcp-apps-cards-design.md` (§3 switch, §4.4 send nonce,
§4.6 attach image, §9 deploy order). Plan: `docs/superpowers/plans/2026-10-29-mcp-apps-cards.md`.
Directory material: `docs/mcp-apps-directory-submission.md`.

Nothing in this runbook is a code change. It is the order of operations after the PR is reviewed.
Do not merge before step 2 is done (see "Merge" at the end).

## Refs and conventions

| Env        | Supabase project ref   |
| ---------- | ---------------------- |
| Production | `skjzpekeqefvlojenfsw` |
| Staging    | `wlyzhyfondykzpsiqsce` |

- The pilot runs on **production**: staging's OAuth server is off, and both hosts need a real OAuth
  round trip to the `mcp` function.
- Always pass `--project-ref`. Before any `db push`, read `cat supabase/.temp/project-ref` and map it
  against the table above (the link state flips between environments).
- `<conta_id>` is the founder's workspace id (`workspaces.id`). Never paste a real id, token or key into
  this file or into a PR.
- Deploying `mcp` pollutes the lockfiles. Afterwards: `git checkout deno.lock supabase/functions/deno.lock && npm ci`.

## The switch

`MCP_APPS` is an edge secret read per request (spec §3). Changing it needs no deploy.

| Value                              | Effect                                                                                                               |
| ---------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| unset, `off`, or any unknown value | Tool list, tool shapes and resources as before, plus the new `title`/annotations. No `ui://` resource, no card tools |
| `pilot`                            | Cards on only for the `conta_id`s listed in `MCP_APPS_PILOT_CONTAS` (comma-separated)                                |
| `on`                               | Cards on for every workspace                                                                                         |

Related secrets:

- `MCP_APPS_PILOT_CONTAS`: comma-separated `conta_id`s, used only by `pilot`.
- `MCP_IMAGE_HOSTS`: comma-separated hostnames allowed as `image.download_url` for
  `attach_image_to_post` (exact match, lowercase). **Empty or unset means every chat image is refused**,
  so the attach card is dead until you fill it in step 3. The same hosts go into the card's CSP
  (`resourceDomains`) so it can show the chat images. The card asks ChatGPT for a fresh link
  (`getFileDownloadUrl`) right before each attach; if that link comes from another host, it shows up as
  `[mcp] image host refused: <host>`: add it here.

Rollback at any point: `MCP_APPS=off` (instant, no deploy). Hosts may have cached the resource; the
versioned URI (`CARDS_URI` in `supabase/functions/mcp/apps.ts`) keeps an old cache harmless.

## Step 1: migrations

Two migrations (Task 5; renumber above `main`'s tail if `main` moved before the PR opens):

- `20261105000001_mcp_send_post_to_client.sql`
- `20261105000002_mcp_attach_post_file.sql`

```bash
cat supabase/.temp/project-ref            # map against the table above
npx supabase link --project-ref wlyzhyfondykzpsiqsce
npx supabase db push --linked             # staging first
npx supabase link --project-ref skjzpekeqefvlojenfsw
npx supabase db push --linked             # then production
```

If the remote is ahead of the checkout, use a disposable checkout and `db push --include-all` instead of
forcing anything.

Check both RPCs exist and only `service_role` can execute them:

```bash
npx supabase db query --linked "
  select p.proname,
         has_function_privilege('anon', p.oid, 'execute')          as anon,
         has_function_privilege('authenticated', p.oid, 'execute') as authenticated,
         has_function_privilege('service_role', p.oid, 'execute')  as service_role
  from pg_proc p
  where p.proname in ('mcp_send_post_to_client', 'mcp_attach_post_file');"
```

Expect `anon = false`, `authenticated = false`, `service_role = true` on both rows.

## Step 2: deploy `mcp` with the switch off

```bash
npx supabase secrets set MCP_APPS=off --project-ref skjzpekeqefvlojenfsw
npx supabase functions deploy mcp --project-ref skjzpekeqefvlojenfsw --no-verify-jwt --use-api
```

`--use-api` is required: the default Docker bundler fails on `mcp`'s npm tree.

Verify nothing changed for current users: connect to the workspace as usual (Claude or any client) and
confirm the tool list is the same as before, only with titles and annotations, and that existing tools
still work (`list_clients`, `list_posts`). No `ui://` resource should be listed.

## Step 3: pilot on the founder's workspace

```bash
npx supabase secrets set MCP_APPS=pilot MCP_APPS_PILOT_CONTAS=<conta_id> --project-ref skjzpekeqefvlojenfsw
```

Reconnect the connector in each host (or start a new chat) so the host re-reads the tool list, then run
the host matrix and the checks below. `MCP_IMAGE_HOSTS` stays unset until check B.

Host matrix (spec §8). Record what each host renders for every card (render, theme, height, buttons,
`ui/open-link`, `ui/message`):

| Host           | Preview post | Caption options | Client calendar | Attach image | Send to client |
| -------------- | ------------ | --------------- | --------------- | ------------ | -------------- |
| Claude web     |              |                 |                 | n/a          |                |
| Claude desktop |              |                 |                 | n/a          |                |
| Claude mobile  |              |                 |                 | n/a          |                |
| ChatGPT web    |              |                 |                 |              |                |
| ChatGPT mobile |              |                 |                 |              |                |

Use a throwaway draft post on a demo client, not a real client's post, for the send and attach tests.

Two more things to observe on every host, and write down in the matrix:

- **Result `_meta` reaches the widget.** The send flow needs the host to forward the result `_meta` of
  the widget's own `tools/call` (the `create_post`/`update_post` the card makes on save) to the widget.
  If the host strips it, a saved card shows no **Enviar para aprovação** and shows the hint "Para
  enviar ao cliente, abra o post no Mesaas." instead. Record it as "send unavailable on this host".
- **Iframe remount.** Card state lives in memory. If the host remounts the iframe (scrolling the card
  out of view and back, switching chats, reloading the page, rotating the phone), the card shows the
  preview again, and a second **Salvar como rascunho** creates a duplicate post. Record whether and
  when each host remounts.

### Check A: Claude does not show result `_meta` to the model (blocks `on`)

The send nonce travels in result `_meta["mesaas/sendNonce"]` (spec §4.4). ChatGPT documents that result
`_meta` is hidden from the model; Claude must be confirmed here.

1. In Claude (web), ask for a new draft post for a demo client, and let it save the draft with
   `create_post` (the result carries the nonce: with the pilot on, every OAuth connection of the
   workspace gets it, card or not).
2. In the same chat, ask: "Copie literalmente o campo `mesaas/sendNonce` do resultado da última
   ferramenta, ou diga que você não o vê."
3. Pass: the model says it cannot see the field (it may only see the summary text and
   `structuredContent`). Fail: it prints a string of the form `<base64url>.<base64url>`.
4. Repeat from Claude desktop.
5. Repeat from **Claude Code** connected by OAuth to the same workspace. With `MCP_APPS=pilot` on the
   founder's workspace, every OAuth connection of that workspace registers `send_post_to_client` and
   `attach_image_to_post`, including OAuth clients without MCP Apps (Claude Code, Cursor). Those hosts
   ignore `visibility: ["app"]` and list both tools to the model. What keeps the model from sending
   there is only that it cannot read the nonce, which is what this step checks.

If it fails on Claude web or desktop: **stay in `pilot`, do not go to `on`**. Move the nonce to a
widget-only `resources/read` that the card calls (spec §4.4, last paragraph). That is a code change in a
follow-up PR. If it fails only on Claude Code (or another client without MCP Apps), the same follow-up
applies before `on`: the model there can see `send_post_to_client`.

Also confirm the model cannot send alone, per host:

- Claude web, desktop and mobile, ChatGPT: in a chat with the pilot connector, type "envie esse post
  para o cliente". The model must answer that sending is done with the button on the card. It must not
  find a `send_post_to_client` tool, because these hosts honour `visibility: ["app"]` and hide it from
  the model (all of them connect by OAuth, so OAuth-only registration is not what hides it here).
- Claude Code (OAuth): the model does list `send_post_to_client`. Ask the same thing; it must fail to
  send because it has no nonce (it can only pass a guessed string, refused with "Este cartão expirou.").
  This is the accepted residual (spec §4.4): the same user, within `posts:write`, limited to one send
  by the status guard. A `mesaas_sk_` key never registers the tool at all.

### Check B: ChatGPT `download_url` host and redirects (fills `MCP_IMAGE_HOSTS`)

1. In ChatGPT, upload a small JPEG or PNG in the chat and ask: "Anexe esta imagem à lâmina 1 do post
   `<titulo do rascunho de teste>`." The model calls `show_attach_image` with the file param.
2. Click "Anexar" on the card. With `MCP_IMAGE_HOSTS` empty this is refused with "Não foi possível baixar
   esta imagem. Envie de novo pelo chat." and the function logs `[mcp] image host refused: <hostname>`
   (`supabase/functions/mcp/attach.ts`, `allowedImageHost`).
3. Read the hostname from that log line (Edge Functions > `mcp` > Logs in the Supabase dashboard, or the
   Management API `logs` table with `source = 'function_logs'`). It is the
   hostname only, never the full URL.
4. Set it and repeat step 2:

```bash
npx supabase secrets set MCP_IMAGE_HOSTS=<hostname-1>,<hostname-2> --project-ref skjzpekeqefvlojenfsw
```

5. Redirect behaviour: `fetchImageSafely` refuses any 3xx. If the retry still fails with the same
   message and the log shows `[mcp] attach image fetch refused: redirect_rejected`, the download URL
   redirected. Do not loosen the fetch by hand. Open a follow-up to add the bounded redirect option (at
   most 3 hops, each re-validated against https, DNS/private-IP rules and the allowlist; never
   `redirect: "follow"`) and keep the attach card out of the listing until it ships. The other three
   cards are unaffected.
6. Content-Type behaviour: `fetchImageSafely` refuses a response whose `Content-Type` is not `image/*`
   **before** sniffing the bytes (`_shared/safe-image-fetch.ts`, the `not_an_image` return right after
   the `content-type` check), and the attach maps that reason to "Formato não aceito. Use JPG ou
   PNG.". The same reason also comes from a failed sniff, but a valid JPEG or PNG always sniffs, so: if
   a valid JPEG/PNG gets "Formato não aceito" and the log shows
   `[mcp] attach image fetch refused: not_an_image`, the download host sent a non-image
   `Content-Type` (likely `application/octet-stream`). The follow-up is sniff-first in
   `fetchImageSafely` (decide by the bytes, keep JPEG/PNG only), never loosening the gate. Keep the
   attach card out of the listing until it ships.
7. Pass: the image appears at position 1 of the draft, as cover, in the CRM (Entregas, the post's media).

Repeat the host entry for every distinct hostname the test shows (the host can differ between web and
mobile). Keep the list as short as what was observed.

### Check C: ChatGPT-generated images arrive as file params

1. In ChatGPT ask it to generate an image (for example "Gere uma imagem de uma xícara de café sobre uma
   mesa de madeira") and then: "Anexe essa imagem ao post `<rascunho de teste>`."
2. Pass: `show_attach_image` is called with a populated `image` param and the card shows it.
3. Fail (the model cannot pass its own generated image as a file param): v1 supports uploaded images only.
   The card copy must then say "Envie a imagem nesta conversa". That is a small follow-up change to the
   attach card and to the listing description; note it in the PR and in the submission doc's test case
   P4. It does not block `on`.

### Check D: the card renders in Claude without `_meta.ui.domain`

The resource deliberately carries no `_meta.ui.domain` (spec §4.2). In Claude web, desktop and mobile
confirm each card renders (not a blank frame or a domain error). If Claude refuses to render without a
domain, stop at `pilot`: a per-host `domain` needs the hosts to be told apart, which the stateless
server cannot do today. Escalate before changing anything; do not set Claude's hash domain, it would
break ChatGPT's resource.

### Pilot sign-off

All of these must be true before step 4:

- Check A pass (otherwise stay in `pilot`, move the nonce, redeploy, repeat A).
- Check D pass on all three Claude surfaces.
- Send test: on a preview card, "Salvar alterações" (or "Salvar como rascunho"), then "Enviar para
  aprovação", then "Enviar ao cliente" moved the throwaway post to `enviado_cliente`; the post's status
  history shows the founder as actor with source `workspace_user`.
- Stale send test (the directory's N2, a card hides its send button once it has sent, so a second
  click needs a second card): show the card of another throwaway draft twice, in two messages (cards A
  and B). Click "Salvar alterações" on A, then on B. Send from B ("Enviar para aprovação", "Enviar ao
  cliente"), then from A: card A shows "Este post já está com o cliente.", the post has one
  status-history entry for the send and the client gets one notification.
- Check A residual written into the sign-off: on OAuth clients without MCP Apps (Claude Code, Cursor)
  the model sees `send_post_to_client` and `attach_image_to_post` while the workspace is in the pilot
  (or everywhere after `on`); it cannot send without the nonce, and Check A step 5 is the evidence.
- Host matrix filled in, with anything that renders badly written down as a bug.

## Step 4: KB and tool descriptions, then `on`

The tool-description wording ("O agente não envia sozinho ao cliente; um clique do usuário no cartão
envia.") ships with the code. The KB articles are edited through the Admin MCP **after** the pilot sign-off
and **before** `on`, so public docs never promise cards that are not live. This task publishes nothing:
the sections below are drafts for that step (`get_kb_article` first, then `update_kb_article` /
`create_kb_article`, `upload_kb_image` for screenshots).

```bash
npx supabase secrets set MCP_APPS=on --project-ref skjzpekeqefvlojenfsw
```

After `on`, spot check with a workspace that is not in the pilot list: a card tool appears and renders.

### KB draft 1: update `limites-e-seguranca-do-agente`

Replace the section "Não envia ao cliente" with:

```markdown
## O agente não envia sozinho ao cliente

O agente não move posts para estágios visíveis ao cliente por conta própria. Quando o Claude ou o ChatGPT
salva um rascunho, ele mostra um cartão com o botão **Enviar para aprovação**. Só o seu clique, seguido da
confirmação **Enviar ao cliente**, envia o post para o cliente aprovar. Pelo chat, o agente não consegue
enviar sozinho.

- O envio por cartão só funciona em conexões feitas por login (o fluxo "Conectar" com autorização). Chaves
  de API (`mesaas_sk_`) e agentes que rodam sozinhos nunca enviam ao cliente.
- O cartão só envia o post que você acabou de salvar nele, em rascunho ou revisão interna. Se o cliente
  já recebeu ou já aprovou o post, o envio é recusado com uma mensagem clara.
- O envio fica registrado no histórico de status do post, em seu nome, como uma ação sua no Mesaas.
- Se você editar um post que já está visível ao cliente, o post continua voltando para revisão interna.
```

Replace the section "Escrita apenas em rascunho e estágios internos" with:

```markdown
## Escrita apenas em rascunho e estágios internos

As ferramentas de escrita só operam em rascunhos e estágios internos editáveis. Fora disso, a ação é
recusada. O mesmo vale para o botão **Anexar** do cartão de imagem: ele só mexe nas imagens de posts
editáveis dos tipos feed e carrossel, aceita JPG e PNG de até 8 MB e respeita o limite de 10 mídias por
post.
```

In "Privilégio mínimo e privacidade", add a bullet:

```markdown
- Os logs de auditoria não guardam o texto dos cartões, as legendas, os roteiros nem os links das imagens
```

Also replace the article `description` (today it starts with "O que o agente nunca faz" followed by a
dash) with: "O que o agente nunca faz: publicação, envio ao cliente (só com o seu clique), exclusões e
isolamento de dados."

### KB draft 2: update `o-que-o-agente-pode-fazer`

Add a section after "Escrita":

```markdown
## Cartões no chat

Quando o conector está ativo para o seu workspace, o Claude e o ChatGPT mostram cartões do Mesaas dentro
da conversa, em vez de só texto:

- **Prévia do post:** o carrossel, o roteiro de reels ou a legenda como ficariam, antes de salvar. O botão
  **Salvar como rascunho** cria o post no Mesaas.
- **Opções de legenda:** 2 ou 3 legendas lado a lado. **Usar esta legenda** grava a escolhida no post.
- **Calendário do cliente:** as próximas semanas de posts do cliente, com os dias de costume que ficaram
  sem post. Daí você pede sugestões para os dias vazios ou abre o calendário no Mesaas.
- **Anexar imagem (ChatGPT):** coloca no post uma imagem que está na conversa, escolhendo a lâmina.

Depois de salvar um rascunho, o cartão também oferece **Enviar para aprovação**. Veja o artigo "Cartões
no Claude e no ChatGPT" para o passo a passo e os limites.
```

In the "Escrita" bullet list, leave the existing bullets as they are and add one bullet:

```markdown
- Mostrar prévia, opções de legenda, calendário do cliente e imagem a anexar: cartões que o agente exibe no chat para você decidir
```

The `description` of the article becomes "As ferramentas de leitura e escrita disponíveis, os cartões no
chat, as taxas por visualização, o ig_score e o fluxo completo de criação de conteúdo."

### KB draft 3: new article "Cartões no Claude e no ChatGPT"

Slug `cartoes-no-claude-e-no-chatgpt`, category `claude-e-ia`, tags `mcp, claude, chatgpt, cartoes, ia`,
`description`: "Como usar os cartões do Mesaas dentro do Claude e do ChatGPT: prévia, legendas, calendário,
imagem do chat e envio para aprovação." Link it from `/configuracao/mcp` after the existing two articles.
Screenshots (upload with `upload_kb_image`, ids filled at publish time) are listed in
`docs/mcp-apps-directory-submission.md` ("Screenshots").

```markdown
## O que são os cartões

Os cartões são pequenas telas do Mesaas que aparecem dentro da conversa com o Claude ou com o ChatGPT.
Você vê o resultado, decide e clica, sem copiar e colar entre as ferramentas. Eles funcionam com o conector
do Mesaas que você já usa, sem nada novo para instalar.

[IMAGEM: cartão de prévia de um carrossel no Claude, tema claro]

## Antes de começar

- O conector do Mesaas precisa estar conectado por login (veja "Como conectar o Claude").
- Escrever no Mesaas exige o escopo **Posts (escrita)**. O calendário e as prévias só precisam de leitura.
- O cartão de anexar imagem existe só no ChatGPT.
- No ChatGPT, se os botões que gravam no Mesaas (salvar, enviar, anexar) funcionam depende de como o seu plano
  do ChatGPT permite conectores personalizados. Se um botão de gravação não responder, confira essa
  configuração no ChatGPT; a prévia, as legendas e o calendário só leem e não dependem disso.

## Prévia do post e salvar como rascunho

1. Peça um post: "Crie um carrossel de 5 lâminas sobre skincare no inverno para a Clínica Aurora."
2. O agente mostra a **Prévia do post** com as lâminas e a contagem da legenda (por exemplo, 412 de 2.200).
3. Se a legenda passar do limite, o cartão avisa e o botão de salvar fica desativado até você ajustar.
4. Clique em **Salvar como rascunho**. O post nasce em rascunho no Mesaas, no cliente certo.

## Escolher uma legenda

Peça "me dê 3 opções de legenda para esse post". Clique na opção que preferir e em **Usar esta legenda**.
Se o post ainda não foi salvo, o agente refaz a prévia com a opção escolhida.

## Calendário do cliente

Peça "como está o calendário da Clínica Aurora nas próximas 3 semanas?". O cartão mostra os posts por dia
e marca como **Sem post** os dias da semana em que o cliente costuma publicar. Um dia é "de costume"
quando o cliente teve post nesse dia da semana em pelo menos 4 das 8 semanas anteriores. Use **Sugerir
posts para os dias vazios** para o agente propor pautas, ou **Abrir calendário no Mesaas**.

## Enviar para aprovação

Depois de salvar um rascunho, clique em **Enviar para aprovação**. O cartão pede uma confirmação:
**Enviar ao cliente**. Só depois dela o post vai para o cliente aprovar no Hub. Pelo chat, o agente não
consegue fazer esse envio sozinho.

[IMAGEM: confirmação "Enviar ao cliente" no cartão]

O envio é recusado, com uma mensagem clara, quando o cliente já recebeu ou já aprovou o post, quando o post
mudou no Mesaas desde que o cartão apareceu, quando a publicação do post falhou ou quando um vídeo está sem
capa. Nesses casos, resolva no Mesaas, peça o cartão de novo e salve antes de enviar.

## Anexar uma imagem da conversa (ChatGPT)

1. Gere ou envie uma imagem na conversa e peça: "Anexe essa imagem à lâmina 2 do post `<título>`."
2. O cartão mostra as imagens atuais do post. Escolha a lâmina. Se ela já tiver imagem, o cartão pergunta
   "Substituir a imagem da lâmina N?".
3. Clique em **Anexar**.

Este cartão grava no Mesaas, então vale o aviso do ChatGPT acima sobre o seu plano e os conectores
personalizados.

Limites: posts em rascunho, revisão interna ou correção do cliente; tipos feed e carrossel; imagens JPG ou
PNG de até 8 MB; no máximo 10 mídias por post. A imagem entra em Arquivos como qualquer outra.

## Quando algo não funciona

- **O cartão não aparece:** peça de novo ("mostre a prévia"). Se continuar só texto, confira se o conector
  está conectado por login e se a sua conta tem acesso aos cartões.
- **"Este cartão expirou. Peça ao agente para mostrar o post de novo e salve de novo.":** o envio vale
  por 30 minutos depois que você salva no cartão. Peça ao agente para mostrar o post de novo, salve no
  cartão novo e envie.
- **"Formato não aceito":** converta a imagem para JPG ou PNG.
- **"O post mudou no Mesaas":** alguém editou o post depois do cartão. Peça o cartão de novo e salve
  antes de enviar.
```

Do not publish any of these from this task. Keep the existing articles' prose style otherwise (these drafts
avoid em dashes; the existing text still has some in list items, leave those).

## Step 5: directory submissions

Follow `docs/mcp-apps-directory-submission.md`. Submit only after step 4, with the OAuth flow verified end
to end from ChatGPT on production. Targets: Claude connector directory and ChatGPT app directory, listing
country `BR`.

## Merge

The change has no CRM runtime effect besides docs, so the order relative to the merge is free. Do the
database and function steps before merging anyway: merging deploys the Vercel frontend immediately, and
the CI check that the generated bundle is current (`npm run build:mcp-widgets && git diff --exit-code
supabase/functions/mcp/ui/generated/cards.ts`) must be green.

## Redeploy triggers to remember

- A change to `apps/mcp-widgets/` means regenerating `supabase/functions/mcp/ui/generated/cards.ts`
  (`npm run build:mcp-widgets`), committing it and redeploying `mcp` (same command as step 2).
- Hosts cache the card HTML by URI (ChatGPT kept showing the old attach card after a redeploy of
  `cards-v1`), so **every** widget change also bumps `CARDS_URI` in `supabase/functions/mcp/apps.ts`
  (v1 → v2 → v3) and moves the previous URI to `LEGACY_CARDS_URIS`, which still serves the current HTML.
  In ChatGPT developer mode, press "Refresh" on the app afterwards so it re-reads the tool listing.
- Changing a scope (adding one for cards) is the usual four-way redeploy: `mcp`, `mcp-keys`,
  `mcp-oauth-consent` and the CRM. v1 adds none.
