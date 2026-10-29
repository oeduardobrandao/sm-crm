# MCP Apps cards: directory submission material

Spec §7: `docs/superpowers/specs/2026-10-29-mcp-apps-cards-design.md`. Order of operations:
`docs/mcp-apps-rollout.md` (submit only after `MCP_APPS=on` and the KB updates).

Owners: **founder** (Eduardo: accounts, verification, recordings, the submit click) or **builder**
(engineering/agent: drafts, files, checks). Status column is for the person ticking items off.

Things stated below that come from the spec and were not re-verified against the live directory docs
(re-read both submission guides before filing; they change):

- Claude: `claude.com/docs/connectors/building/submission.md`
- ChatGPT: `developers.openai.com/plugins/deploy/submission.md`
- On ChatGPT, write actions from a custom connector are likely limited to Business/Enterprise developer
  mode [unverified], so Plus/Pro users need the published app for every write card.

## 1. Shared prerequisites

| #   | Item                                                                                                                                                                                                                                                    | Owner                                          | Status |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------- | ------ |
| S1  | Reviewer account: a populated demo workspace (reuse the Admin's "Conta demo" flow), no MFA, with at least 2 clients that have briefing and brand profile, 1 draft carousel post, 1 post in `enviado_cliente`, 1 client with 3+ weeks of scheduled posts | builder prepares, founder approves             |        |
| S2  | Reviewer credentials delivered through each directory's secure field. Never in this repo, a PR or chat                                                                                                                                                  | founder                                        |        |
| S3  | KB articles live: `limites-e-seguranca-do-agente` and `o-que-o-agente-pode-fazer` updated, "Cartões no Claude e no ChatGPT" published (drafts in the rollout runbook, step 4), with screenshots                                                         | builder drafts via Admin MCP, founder approves |        |
| S4  | `https://www.mesaas.com.br/politica-de-privacidade` and `/termos-de-uso` exist and mention the connector and the data it reads (clients, briefings, posts, calendar, media the user attaches)                                                           | founder                                        |        |
| S5  | Allowed link URIs for `ui/open-link`: `https://www.mesaas.com.br` and the CRM app origin if it differs. Confirm the card's `open_url` (`https://www.mesaas.com.br/entregas?view=calendar&clientes=<id>`) is inside this list                            | builder                                        |        |
| S6  | Support URL and support contact (WhatsApp support number or e-mail), same one in both listings                                                                                                                                                          | founder                                        |        |
| S7  | Production OAuth works end to end from both hosts (staging's OAuth server is off): connect, consent screen with scopes, tool call, disconnect                                                                                                           | builder verifies                               |        |
| S8  | Pilot sign-off done (rollout runbook, checks A to D) and `MCP_APPS=on`                                                                                                                                                                                  | builder                                        |        |
| S9  | Listing and in-card copy has no em dashes, is pt-BR sentence case, and makes no claim of endorsement by Anthropic, OpenAI or Meta                                                                                                                       | builder                                        |        |

## 2. Claude connector directory

| #   | Item                                                                                                                                                                                                                                               | Owner                              | Status |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------- | ------ |
| C1  | Annotations (`readOnlyHint`/`destructiveHint`, plus `openWorldHint` on `send_post_to_client`) and `title` on every tool. The structural Deno test covers it; re-run `deno test --no-check --allow-all supabase/functions/__tests__/` before filing | builder                            |        |
| C2  | Separate read and write tools (already true)                                                                                                                                                                                                       | builder                            |        |
| C3  | Tool names at most 64 characters (longest today is well below; verify with the live `tools/list`)                                                                                                                                                  | builder                            |        |
| C4  | Descriptions free of prompt-injection-like wording (no "ignore previous", no instructions aimed at overriding the model). Read every tool description once in the live `tools/list`                                                                | builder                            |        |
| C5  | Errors are full actionable pt-BR sentences (`Cliente não encontrado neste workspace.`, `Este post já está com o cliente.`, `Formato não aceito. Use JPG ou PNG.`, ...) with no raw DB or provider text                                             | builder                            |        |
| C6  | Card screenshots for the carousel (list in section 5), light and dark                                                                                                                                                                              | builder captures, founder approves |        |
| C7  | Listing text from section 4 (pt-BR primary, en alongside)                                                                                                                                                                                          | builder drafts, founder approves   |        |
| C8  | Connector URL submitted exactly as users type it (the function URL on production) and tested from Claude web, desktop and mobile                                                                                                                   | builder                            |        |
| C9  | Submit through the directory form                                                                                                                                                                                                                  | founder                            |        |

## 3. ChatGPT app directory

| #   | Item                                                                                                                                                                       | Owner                            | Status |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------- | ------ |
| G1  | Organization verification in the OpenAI platform                                                                                                                           | founder                          |        |
| G2  | Domain verification for `www.mesaas.com.br` (the resource declares `_meta["openai/widgetDomain"] = "https://www.mesaas.com.br"`; the value must match the verified domain) | founder                          |        |
| G3  | Plugin ZIP: manifest, icon, descriptions. Manifest fields per the live submission guide                                                                                    | builder                          |        |
| G4  | Support URL (S6) and privacy policy URL (S4) in the manifest                                                                                                               | founder                          |        |
| G5  | Exactly 5 positive and 3 negative test cases (section 4 below), each with prompt, expected tool calls and expected result, against the S1 account                          | builder drafts, founder approves |        |
| G6  | Demo video: connect, preview + save draft, caption pick, calendar, attach image, send with confirmation (about 2 minutes, pt-BR narration or captions)                     | founder records                  |        |
| G7  | Target countries: `BR` only                                                                                                                                                | founder                          |        |
| G8  | `MCP_IMAGE_HOSTS` set to the hostnames observed in the pilot (rollout check B) and the attach card tested from ChatGPT web and mobile                                      | builder                          |        |
| G9  | Reviewer notes: how to connect, which workspace is the demo, that write buttons need a click, that image attach is ChatGPT only                                            | builder                          |        |
| G10 | Submit                                                                                                                                                                     | founder                          |        |

## 4. ChatGPT test cases

Run each against the S1 demo workspace in ChatGPT with the Mesaas app installed. `Clínica Demo` stands
for the demo client name and `Skincare no inverno` for the demo draft title: replace both with the real
seed names before filing. Prompts are what a Brazilian agency user would type.

### Positive

**P1. Preview and save a draft**

- Prompt: `Crie um carrossel de 5 lâminas sobre cuidados com a pele no inverno para a Clínica Demo e me mostre antes de salvar.`
- Expected tool calls: reads (`list_clients`, optionally `get_brand_profile`), then `preview_post` with
  `client_id`, `tipo: "carrossel"`, 5 `slides`, `ig_caption`. After the click on **Salvar como
  rascunho**: `create_post` with `cliente_id`, `titulo`, `tipo`, `body`, `ig_caption`.
- Expected result: the "Prévia do post" card shows 5 slides and the caption count (for example "412 de
  2.200"). After saving, the card confirms the draft and shows **Enviar para aprovação**. In the Mesaas
  CRM the post exists in `rascunho` under Clínica Demo, with one paragraph per slide in the body.

**P2. Pick a caption**

- Prompt: `Me dê 3 opções de legenda para o post "Skincare no inverno" da Clínica Demo.`
- Expected tool calls: `list_posts` (or `get_post`) to find the post, then `show_caption_options` with
  `client_id`, `post_id`, 3 `options`. After the click on option 2 and **Usar esta legenda**:
  `update_post {post_id, ig_caption}`.
- Expected result: the "Opções de legenda" card shows 3 options with their length. The post's Instagram
  caption in Mesaas equals option 2 after the click. The status does not change.

**P3. Client calendar**

- Prompt: `Como está o calendário de posts da Clínica Demo nas próximas 3 semanas?`
- Expected tool calls: `list_clients` (to resolve the client), then `show_client_calendar` with
  `client_id`, `weeks: 3`.
- Expected result: the "Calendário do cliente" card shows 3 weeks starting on a Monday, the existing
  posts on their days, and **Sem post** on usual weekdays with no post. **Abrir calendário no Mesaas**
  opens Entregas in calendar view filtered by the client.

**P4. Attach an image from the chat**

- Prompt (after uploading a JPEG or PNG in the chat): `Anexe esta imagem à lâmina 1 do post "Skincare no inverno" da Clínica Demo.`
- Expected tool calls: `show_attach_image` with `post_id`, `image` (file param with `download_url` and
  `file_id`) and `position: 1`. After the click on **Anexar** (and the replace prompt if the slide
  already has an image): `attach_image_to_post {post_id, image, position: 1, replace}`.
- Expected result: the "Anexar imagem" card shows the post's current media in order. After the click the
  image is at position 1 and is the cover in the CRM; the other images moved one position later; the file
  is in Arquivos. If the slide already had an image and the user confirmed "Substituir a imagem da lâmina
  1?", that slide kept its position and cover flag.

**P5. Send for approval only after confirmation**

- Prompt: `Mostre o cartão do rascunho "Skincare no inverno" da Clínica Demo.` Then
  click **Enviar para aprovação**, then **Enviar ao cliente**. As a side check, also type: `Pode enviar
esse post para o cliente agora.`
- Expected tool calls: `list_posts` (or `get_post`) to resolve the title, then `preview_post` with `post_id`
  (its result carries the send nonce for the card). The card's first click opens an inline confirmation and calls nothing. The second
  click calls `send_post_to_client {post_id, expected_status, nonce}`. The typed request in the side
  check calls no send tool.
- Expected result: after **Enviar ao cliente** the card shows "Post enviado ao cliente para aprovação." and
  the post is `enviado_cliente` in Mesaas, with the status history naming the reviewer as actor. For the
  side check the model answers that the send is done with the button on the card and changes nothing.

### Negative

**N1. Client from another workspace**

- Prompt: `Mostre o calendário de posts do cliente de id <client_id de outro workspace> nas próximas 3 semanas.`
- Expected tool calls: `show_client_calendar` with that `client_id`.
- Expected result: the call fails with "Cliente não encontrado neste workspace." No card data, no client
  name or post from the other workspace appears anywhere in the response.

**N2. Send on an already-sent post**

- Setup: send the post from P5 once. Then in a new message: `Mostre o post "Skincare no inverno" de novo.`
  and click **Enviar para aprovação** then **Enviar ao cliente** on the card.
- Expected tool calls: `list_posts` (or `get_post`), `preview_post` with `post_id`, then
  `send_post_to_client` (if the card still offers the button; the card may instead
  already show the post as sent).
- Expected result: "Este post já está com o cliente." The post stays `enviado_cliente`; no second
  status-history entry and no second client notification is produced.

**N3. WebP image**

- Prompt (after uploading a `.webp` image): `Anexe esta imagem ao post "Skincare no inverno" da Clínica Demo.`
- Expected tool calls: `show_attach_image`, then `attach_image_to_post` after the click.
- Expected result: "Formato não aceito. Use JPG ou PNG." The post's media is unchanged and no file
  appears in Arquivos.

## 5. Screenshots

Capture at the host's normal width and on a phone (about 390 px), light and dark, using the demo workspace
(S1). The same set goes to the KB article and both listings. They are not committed: they are uploaded
to the KB (`upload_kb_image`) and to each directory form.

1. Prévia do post: carousel with 5 slides, caption count visible (Claude, light).
2. Prévia do post, caption above the limit: warning shown and save disabled.
3. Saved draft with **Enviar para aprovação**.
4. Inline confirmation with **Enviar ao cliente** and **Cancelar**.
5. Result after sending: "Post enviado ao cliente para aprovação."
6. Opções de legenda: 3 options, one selected.
7. Calendário do cliente: 3 weeks with **Sem post** days and the suggest button.
8. Anexar imagem (ChatGPT): slide picker, and the "Substituir a imagem da lâmina N?" prompt.
9. Any card on a phone in dark theme (Claude mobile and ChatGPT mobile).
10. The error states a reviewer is likely to hit: "Este post já está com o cliente." and "Formato não aceito.
    Use JPG ou PNG."

## 6. Listing copy

Listing country: `BR`. Primary language pt-BR; the English text is for directories that ask for it.

### Name

Mesaas

### Short description

pt-BR: `Crie e organize posts dos seus clientes de social media, com cartões dentro do chat.`

en: `Plan and draft your social media clients' posts, with cards right in the chat.`

### Description (pt-BR)

```text
O Mesaas é o CRM para agências e social medias. Com este conector, o Claude e o ChatGPT trabalham com os
dados do seu workspace: clientes, briefings, posts e calendário.

Cartões dentro da conversa:
- Prévia do post: veja o carrossel, o roteiro ou a legenda antes de salvar, e salve como rascunho com um clique.
- Opções de legenda: compare 2 ou 3 legendas lado a lado e grave a escolhida no post.
- Calendário do cliente: veja as próximas semanas de posts e os dias de costume que ficaram sem post.
- Anexar imagem (ChatGPT): coloque no post uma imagem da conversa, escolhendo a lâmina.

Você no controle: o agente prepara rascunhos, mas não envia nada ao cliente sozinho. Enviar para aprovação
exige o seu clique e uma confirmação no cartão. Nada é publicado no Instagram pelo conector. Cada conexão
enxerga apenas o workspace autorizado, dentro das permissões que você concedeu.

Requer uma conta Mesaas. Conecte por login e escolha as permissões na tela de autorização.
```

### Description (en)

```text
Mesaas is the CRM for social media agencies and freelancers. With this connector, Claude and ChatGPT work
with your workspace data: clients, briefings, posts and calendar.

Cards inside the conversation:
- Post preview: see the carousel, script or caption before saving, and save it as a draft in one click.
- Caption options: compare 2 or 3 captions side by side and write the chosen one to the post.
- Client calendar: see the next weeks of posts and the usual posting days that have no post yet.
- Attach image (ChatGPT): put an image from the conversation on a post, choosing the slide.

You stay in control: the agent prepares drafts but never sends anything to the client on its own.
Sending for approval needs your click and a confirmation on the card. The connector publishes nothing to
Instagram. Each connection sees only the workspace you authorized, within the permissions you granted.

Requires a Mesaas account. Connect with login and choose permissions on the authorization screen.
```

### Categories and keywords

Category: productivity / social media management (use the closest option each form offers).
Keywords: social media, CRM, Instagram, agência, calendário editorial, legendas, carrossel, aprovação de
posts.

## 7. After submission

- Reviewer questions go to the founder's e-mail; the builder prepares the answer and any code fix. A
  review that asks for a tool-description change is a normal deploy of `mcp` (runbook step 2 command).
- Never edit `ui://mesaas/cards-v1.html` in place after listing: a breaking card change ships as
  `cards-v2.html` (runbook, "Redeploy triggers").
- Rollback of the cards without touching the listing: `MCP_APPS=off`. The listing then shows tools without
  cards until `on` again; tell the reviewer if a review is in progress.
