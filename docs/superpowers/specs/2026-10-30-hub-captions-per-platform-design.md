# Hub: legendas por plataforma (leitura e sugestão de edição)

Data: 2026-10-30. Mockups aprovados: https://claude.ai/artifact/1V6YTgcEqBDax4DgtZtvVc

## Por quê

Um post pode ir para Instagram, TikTok e Geral, cada um com a sua legenda
(`workflow_posts.ig_caption`, `workflow_posts.tiktok_caption`, `post_targets.caption` da linha
`geral`; ver `apps/crm/src/store/postTargets.ts:8-11`). O Hub só conhece `ig_caption`:

- `hub-posts` seleciona só `ig_caption` (`supabase/functions/hub-posts/handler.ts:168`);
- o cliente aprova sem ver a legenda do TikTok, que é publicada mesmo assim
  (`tiktok_caption ?? ig_caption`, `_shared/tiktok-publish-utils.ts:241`);
- um post só de TikTok mostra o texto depois de "LEGENDA" no corpo (`deriveCaption`,
  `apps/hub/src/lib/postView.ts:161`), não a legenda que vai ao ar;
- o cliente só sugere edição na legenda do Instagram.

A spec de posts multiplataforma (`2026-09-29-platform-agnostic-posts-design.md`) já previa os dois
pontos: P3 "per-destination caption labels in the Hub" e "Later: versions, suggestions and comments on
non-Instagram captions". Esta spec entrega os dois.

## Objetivos

1. O cliente vê, no Hub, a legenda que cada destino vai publicar (PR 1).
2. O cliente sugere edição na legenda de qualquer destino, e a equipe revisa campo a campo no CRM
   (PR 2).
3. Aceitar uma sugestão na legenda Geral entra no histórico de versões, como Instagram e TikTok (PR 2).

## Não objetivos

- Comentários ancorados (`ig_caption` tem âncoras; TikTok e Geral seguem sem).
- Prévia do feed de Mensagens para sugestão só de legenda (hoje já mostra o corpo em sugestão só de
  Instagram; continua igual).
- Snapshot de envio (`post_status_events.snapshot_*`) e diff do histórico do Hub para TikTok/Geral.
- Link "editar separado" quando as legendas são iguais (o cliente pede pelos comentários).
- Mudar a miniatura do grid (`PostTile.tsx:145` segue com `ig_caption || conteudo_plain`).

## Antiobjetivos

- O Hub mostrar para um destino um texto diferente do que esse destino publica.
- Uma sugestão de cliente sobrescrever, sem a equipe ver, uma edição da equipe (vale a regra de
  conflito de `2026-10-29-edit-suggestion-no-auto-reject-design.md`).
- Um Hub ou CRM antigo, aberto durante o deploy, perder ou inventar uma edição.

## Decisões do usuário

- Abas por plataforma (mockup "Leitura: legendas diferentes"), e **só quando as legendas diferem**:
  legendas iguais viram um bloco só, com o rótulo "Mesma legenda no Instagram e no TikTok".
- O cliente pode sugerir edição em todas as legendas (Instagram, TikTok, Geral).
- A legenda Geral entra no histórico de versões do CRM.
- Dois PRs: PR 1 só leitura (sem migration), PR 2 sugestões.

## Modelo: a legenda efetiva de cada destino

Destinos do post = linhas de `post_targets` (`instagram`, `tiktok`, `geral`). Payload antigo ou sem
destinos: deriva de `platform` (`instagram` → [instagram]; `tiktok` → [tiktok]; `both` →
[instagram, tiktok]; `other` → [geral]), como já faz `getPlatformLabel`.

| Destino | Legenda mostrada |
|---|---|
| Instagram | `ig_caption`; vazio → `deriveCaption` (fallback LEGENDA de hoje, intocado). O fallback é só de exibição: o publicador do Instagram recusa agendar post sem `ig_caption` (`instagram-publish-utils.ts:112`), então ele nunca vai ao ar sem a equipe preencher |
| TikTok | `tiktok_caption ?? ig_caption ?? ''`, a mesma regra do publicador (`tiktok-publish-utils.ts:241`). Sem fallback LEGENDA: um post só de TikTok sem legenda mostra "Sem legenda", não o corpo, que não é publicado |
| Geral | `post_targets.caption` da linha `geral`; nulo → `''` |

Legenda efetiva vazia em qualquer destino: o bloco mostra "Sem legenda" em `--hub-tx3`.
`tiktok_caption = ''` (o que o CRM grava ao limpar o campo, `postTargets.ts:147-156`) não é nulo: o
TikTok não segue o Instagram e forma o seu próprio grupo, editável.

Destinos e payload antigo:
- `targets` ausente (payload em cache ou `hub-posts` antigo): deriva de `platform` como acima.
  `platform = 'both'` de um Stories cai em [instagram, tiktok] só nesse caso; o payload novo já vem sem
  a linha tiktok (z7) e mostra só o Instagram.
- `targets` vazio, ou `geral` presente com `geral_caption` ausente (`undefined`, não `null`): mostra o
  bloco único de hoje (`deriveCaption`), nunca um bloco Geral vazio.
- Nome de cada destino: `geral` usa a chave `hubPostCard:platform.other` ("Geral"); o plano cria um
  helper por `PlatformId` em vez de passar `geral` para `getPlatformLabel`.

Agrupamento: destinos cuja legenda efetiva é igual (comparação exata da string, sem `trim()`) formam
um grupo, e o grupo mostra essa string. Duas legendas que só diferem em espaço viram duas abas: é
verdade, cada destino publica o seu texto. Ordem dos grupos e dos destinos no grupo: `PLATFORM_IDS`
(instagram, tiktok, geral).

- 1 grupo, 1 destino: bloco como hoje, sem rótulo.
- 1 grupo, 2+ destinos: um bloco com rótulo "Mesma legenda no Instagram e no TikTok" (nomes juntados
  com vírgula e "e", ícones de cada plataforma).
- 2+ grupos: seletor segmentado com uma aba por grupo; rótulo da aba = nomes do grupo ("Instagram e
  TikTok", "Geral"). Aba inicial = a do primeiro grupo.
- Geral, quando é aba própria ou o bloco único, leva a nota "Esta legenda não é publicada
  automaticamente. A equipe usa ela para publicar por fora." (o Hub não tem download de post; a nota
  não promete um.)

Um `tiktok_caption` nulo cai no grupo do Instagram sempre que `ig_caption` não é nulo, então o cliente
nunca edita "a legenda do TikTok" isolada quando ela só segue o Instagram (isso evita a armadilha de
base nula, ver PR 2). Exceção: `ig_caption` nulo com texto depois de "LEGENDA" no corpo. Aí o Instagram
mostra o fallback e o TikTok mostra "Sem legenda", em abas separadas.

## PR 1: o Hub mostra todas as legendas

### `hub-posts`

- Select: acrescentar `tiktok_caption` e trocar o embed para
  `targets_state:post_targets(platform, permalink, caption)`.
- Flatten (`handler.ts:239-250`): além de `tiktok_post_url`, devolver
  - `targets: ('instagram'|'tiktok'|'geral')[]` (ordenado por `PLATFORM_IDS`),
  - `tiktok_caption: string | null` (cru),
  - `geral_caption: string | null` (`caption` da linha geral; ausente → `null`).
  Não devolver `caption` de outras linhas (instagram/tiktok usam as colunas de `workflow_posts` até
  P4/P5).
- O teste de select (`hub-functions_test.ts:234`) e o fixture (`:189-204`) mudam junto, com asserts
  de `targets`, `tiktok_caption`, `geral_caption` e de que `targets_state` e o `caption` de outras
  linhas não vazam.

### Hub

- `types.ts` `HubPost`: `targets?`, `tiktok_caption?`, `geral_caption?` (opcionais: payload em cache).
- `lib/postView.ts`: `effectiveCaptions(post, igCaption)` → `{ platform, text }[]` e
  `groupCaptions(...)` → `{ platforms: PlatformId[], text }[]`, com testes. `igCaption` é o valor que a
  tela já usa (o original, a sugestão pendente ou o rascunho), para o grupo do Instagram acompanhar a
  sugestão como hoje.
- Componente novo `components/posts/PlatformCaptions.tsx`: recebe os grupos e renderiza bloco único,
  bloco com rótulo ou seletor + texto. `role="tablist"`/`role="tab"`/`aria-selected`, setas
  esquerda/direita trocam a aba. O seletor usa o mesmo visual do mockup (fundo `--hub-soft`, aba ativa
  `--hub-card`). Estado da aba é local ao diálogo (volta à primeira ao trocar de post).
- `PostDetailDialog.tsx`:
  - post de mídia: o `<p>{caption}</p>` do `readingBody` (`:748`) vira `PlatformCaptions`;
  - post de texto: o bloco "Legenda do Instagram" (`:738-746` e `:1020-1028`) vira `PlatformCaptions`
    com o título de seção "Legenda" (quando há um destino só, o título continua "Legenda do Instagram"
    para não mudar nada em post só de Instagram).
- `CorrectionPanel.tsx`: quando o post tem outro destino além do Instagram, o campo de legenda ganha
  o rótulo "Legenda do Instagram" também em post de mídia (hoje só em post de texto), para o cliente
  saber o que está editando. Nada mais muda no PR 1.
- i18n `hubPosts` pt e en: rótulo de grupo, nota do Geral, nomes de aba (reusar
  `hubPostCard:platform.*` para os nomes).

### Verificação do PR 1

Unitários de `effectiveCaptions`/`groupCaptions` (iguais, diferentes, TikTok nulo, Geral sem linha,
payload sem `targets`), de `PlatformCaptions` (bloco único, rótulo, abas, teclado) e do diálogo.
Browser: Hub local contra prod com fetch interceptado (memória `reference_hub_repro_patch_fetch`),
desktop e celular, post com 3 legendas diferentes e post com legendas iguais.

Deploy: `hub-posts` antes do merge (Hub antigo ignora campos novos; Hub novo sem a function nova cai no
fallback por `platform` e mostra só o Instagram, como hoje).

## PR 2: o cliente sugere edição em qualquer legenda

### Campos

| Campo lógico (`p_fields`, `touched_fields`) | Coluna em `changed_fields` | Onde mora |
|---|---|---|
| `texto` | `conteudo`, `conteudo_plain` | `workflow_posts` (igual hoje) |
| `legenda` | `ig_caption` | `workflow_posts` (igual hoje) |
| `legenda_tiktok` | `tiktok_caption` | `workflow_posts` |
| `legenda_geral` | `geral_caption` | `post_targets` (`platform = 'geral'`) |

### Migration (prefixo acima do último de `main` no momento do PR)

1. `post_edit_suggestions`: `original_tiktok_caption`, `suggested_tiktok_caption`,
   `original_geral_caption`, `suggested_geral_caption` (text, nulos) e `geral_target_id bigint`
   (o `post_targets.id` da linha geral quando `legenda_geral` entrou em `changed_fields`). Upsert e
   accept comparam o id vivo com esse: linha removida e recriada (o CRM deixa remover destino
   pendente) é `target_gone`, nunca herda a sugestão antiga. E `tiktok_followed_ig boolean`: o
   `tiktok_caption` estava nulo (TikTok seguindo o Instagram) quando `legenda` entrou em
   `changed_fields`. O CRM usa isso para avisar quando, no aceite, o TikTok já tem legenda própria (o
   cliente aprovou um texto que o TikTok não publica mais): linha de aviso no campo `legenda`, "O TikTok
   seguia o Instagram quando o cliente sugeriu; agora tem legenda própria e não muda."
2. `upsert_edit_suggestion` (última definição `20261106000002`): DROP + CREATE com um parâmetro novo
   no fim, `p_suggested_captions jsonb default null` (`{"tiktok_caption": …, "geral_caption": …}`),
   para o próximo destino não exigir outra troca de assinatura. Grant só `service_role`, como hoje.
   - Ramo legado (`p_touched_fields` nulo): não toca os campos novos. O INSERT lê `tiktok_caption`
     com o post e o `caption` da linha geral e grava `original = suggested = valor vivo`. O
     `ON CONFLICT DO UPDATE` não mexe nas colunas novas e preserva em `changed_fields` as entradas
     `tiktok_caption`/`geral_caption` que já estavam lá (`EXCLUDED.changed_fields || (antigo ∩ novos)`),
     para um Hub antigo aberto não apagar o que um Hub novo sugeriu.
   - Ramo por campo: um bloco por campo novo espelhando o de `legenda` (`:204-223`): base crua em
     `p_bases->>'tiktok_caption'` / `p_bases->>'geral_caption'`, `base_required` quando falta,
     igualdade por `COALESCE(x,'')`, rebase para o vivo quando o campo não mudou.
   - Ordem de lock: post → linha geral (`FOR UPDATE`) → sugestão. `legenda_geral` tocado sem linha
     geral, ou com id diferente do gravado → `raise 'target_gone'`. `legenda_tiktok` tocado sem linha
     tiktok → `raise 'target_gone'` (a legenda mora em `workflow_posts`; a checagem é de intenção: o
     destino saiu, por exemplo ao virar Stories, z7).
   - Deadlock: `post_targets_sync_platform` faz post_targets → workflow_posts num DELETE de destino
     pelo PostgREST, o inverso desta ordem, e escritores do PostgREST não dá para ordenar. As RPCs são
     seguras para repetir; `hub-edit-suggestion` e o CRM tratam `40P01` como 409 "Não deu para salvar
     agora. Tente de novo." em vez do 500 genérico.
   - Retorno jsonb inclui os `suggested_*` novos.
3. `accept_edit_suggestion` (última `20261106000003`): mesma assinatura. Lê `tiktok_caption` com o post
   e trava a linha geral (post → geral → sugestão). `changed`/`conflict` por campo novo com a mesma regra
   de `legenda`; `p_fields`/`p_acknowledged` aceitam `legenda_tiktok` e `legenda_geral`. Aplica com um
   `UPDATE workflow_posts` por coluna escolhida via `CASE WHEN v_do_x THEN suggested ELSE col END`
   (troca as combinações de `:138-153`) e um `UPDATE post_targets SET caption` para Geral.
   - Geral escolhido e linha sumiu (ou id diferente de `geral_target_id`) → `raise 'target_gone'`,
     nada muda. TikTok escolhido e linha tiktok sumiu → `raise 'target_gone'`.
   - TikTok escolhido e o destino TikTok em `processando`/`publicado` → `raise 'target_locked'`, nada
     muda (o post pode seguir em `agendado` com o TikTok já no ar; spec de no-auto-reject §3). Fora
     disso a RPC é a autoridade: aceitar muda legenda de post `agendado`, como já faz com o Instagram,
     mesmo com os campos do editor do CRM travados (`PostEditorBody.tsx:585`); o publicador lê a
     legenda na hora de publicar.
   - `p_fields` nulo (CRM antigo, que não sabe mostrar os campos novos): se `changed_fields` tem
     `tiktok_caption` ou `geral_caption`, `raise 'suggestion_conflict'` (o CRM antigo já mostra o toast
     genérico para ele, `editSuggestionAccept.ts:35-40`). Sem campo novo, igual a hoje.
4. Histórico de versões da legenda Geral:
   - `post_content_versions.geral_caption text`.
   - `record_post_content_version()` (última `20260923000008`) passa a gravar também o `caption` atual
     da linha geral em cada versão de `workflow_posts`.
   - Trigger novo `AFTER INSERT OR UPDATE OF caption ON post_targets` (só `platform = 'geral'`), função
     `SECURITY DEFINER` (`authenticated` não tem INSERT em `post_content_versions`,
     `20260923000001:176`). UPDATE: só quando o valor muda. INSERT: só com `caption` não vazio (z6
     cria destinos com `caption` nulo em todo post novo; `addPostDestination` semeia o Geral). Grava uma
     versão com o mesmo coalescing (mesmo ator, janela curta), `source` (`app.event_source`) e
     `suggestion_id` (`app.post_edit_suggestion_id`) da função existente, lendo o retrato atual de
     `workflow_posts` (não há `OLD` de post aqui). Baseline usa `now()`: `post_targets.updated_at` não
     é mantido (`postTargets.ts:160-162`).
   - `geral_caption` na versão: `''` quando a linha geral existe com legenda vazia, nulo quando não há
     linha geral ou a versão é anterior a esta migration ("não registrado").
   - **Um aceite = uma versão.** Versões de cliente nunca coalescem, então um aceite que mexe em
     `workflow_posts` e em `post_targets` geraria duas versões com um retrato intermediário. Regra: o
     accept atualiza `post_targets` primeiro; o trigger de `post_targets` não grava nada enquanto
     `app.accepting_edit_suggestion` estiver setado; o `UPDATE workflow_posts` seguinte grava a versão
     única, já lendo o Geral novo. Aceite só de Geral (nenhuma coluna de `workflow_posts` muda) chama o
     registro de versão explicitamente no fim, uma vez. Teste SQL cobre os três casos (só Geral, Geral +
     outro campo, sem Geral).
   - Remover o destino Geral fica fora do histórico de versões (o histórico é de texto, não de
     destinos): sem trigger de `DELETE`, e a última versão segue mostrando a legenda que existia. O
     editor do CRM já mostra quais destinos o post tem.
   - Sem backfill: versões antigas ficam com `geral_caption` nulo, e o histórico trata nulo como "não
     registrado", não como "apagada".
5. Pin `supabase/tests/entitlements/96_lockdown_definer_function_grants.sql` com a assinatura nova do
   upsert; grants reafirmados (upsert só `service_role`; accept `authenticated` + `service_role`).

### `hub-edit-suggestion`

- Aceita `suggested_tiktok_caption` e `suggested_geral_caption`; `SUGGESTION_FIELDS` ganha
  `legenda_tiktok`/`legenda_geral`; `parseBases` ganha `tiktok_caption`/`geral_caption`.
- O 400 "No content provided" passa a olhar todos os campos.
- Limite de tamanho só nos campos tocados e só para TikTok e Geral; `captionMaxFor` nulo (Geral,
  TikTok de Stories) = sem limite. O Instagram fica como hoje (sem checagem no servidor), para não
  passar a recusar uma legenda viva que já está acima do limite.
- Valida o destino: `legenda_tiktok` exige linha `tiktok` em `post_targets`, `legenda_geral` exige
  linha `geral`; senão 409 com mensagem genérica.
- Valida o tamanho com `captionMaxFor(platform, tipo)` de `_shared/platform-registry.ts` (400 acima;
  regras de limite abaixo).
- `target_gone` do RPC → 409 genérico; o Hub recarrega o post.

### `hub-posts`

O select da sugestão pendente (`:388-397`) inclui `suggested_tiktok_caption` e
`suggested_geral_caption`.

### Hub

- `types.ts`: `SuggestionField`, `SuggestionBases`, `PendingEditSuggestion` com os campos novos.
- `api.ts` `submitEditSuggestion`: passa a receber um objeto (`{ conteudo, conteudo_plain, captions:
  { ig_caption, tiktok_caption, geral_caption }, touched_fields, bases }`).
- `useEditSuggestion`: rascunho por legenda (`draftTiktokCaption`, `draftGeralCaption`), semeado da
  sugestão só quando o campo está em `changed_fields`, senão do valor cru do post. Base = valor cru
  (`post.tiktok_caption`, `post.geral_caption`), nunca o efetivo.
- `CorrectionPanel`: a seção "Editar legenda" usa os mesmos grupos da leitura, calculados dos
  rascunhos no momento em que a edição abre (o agrupamento não muda enquanto o cliente digita). Um grupo
  = um campo; 2+ grupos = o seletor do mockup "Editar", com ponto laranja na aba alterada e contador
  `n / max` quando o destino tem limite.
  - Salvar um grupo marca como tocado cada campo do grupo, com uma exceção: TikTok com
    `tiktok_caption` nulo no mesmo grupo do Instagram não é tocado (continua seguindo o Instagram).
    Grupo Instagram + TikTok com `tiktok_caption` próprio toca `legenda` e `legenda_tiktok` com o
    mesmo texto. TikTok sozinho no grupo com valor cru nulo (a exceção do fallback LEGENDA) toca
    `legenda_tiktok` com base nula; aceitar grava a coluna.
  - Geral só entra como campo quando a linha geral existe.
- `SuggestionDiff`: um bloco por legenda alterada, rotulado pelo destino ("Legenda do TikTok"); o
  "antes" é o valor cru da base, o mesmo que o servidor compara.
- Aviso de sugestão pendente: hoje são as chaves fixas `shared.suggestionShowingBoth`/`Text`/`Caption`
  (`packages/i18n/locales/{pt,en}/hubPosts.json:10-13`, usadas em `PostDetailDialog.tsx` e
  `CorrectionPanel.tsx`). Passam a um modelo com a lista dos campos alterados, juntada com vírgula e
  "e"/"and" (`Intl.ListFormat`): "Você sugeriu mudanças no texto, na legenda do TikTok e na legenda
  Geral". Também `MensagensPage.tsx:45` ("Você sugeriu edições no texto") vira genérico ("Você sugeriu
  edições").
- Edição de grupo com mais de um destino tocado mostra a nota "Esta mudança vale para o Instagram e o
  TikTok."
- Leitura (`PlatformCaptions`) mostra a versão sugerida de cada legenda quando há sugestão pendente e
  a vista é "Alterações".

### CRM

- `store/posts.ts`: `SuggestionField` e `PostEditSuggestion` com os campos novos; select de
  `getPostEditSuggestions`.
- `editSuggestionFields.ts`: estados para os quatro campos; `LivePost` ganha `tiktok_caption` e
  `geral_caption`. Quem renderiza a revisão (`WorkflowDrawer`, `StandalonePostDrawer`, `PhoneSheets`)
  monta `useQuery(['post-targets', postId], getPostTargets)` quando há sugestão pendente com
  `geral_caption` em `changed_fields`, e passa a legenda viva. Enquanto carrega, o campo Geral aparece
  sem checkbox habilitado (nunca avalia conflito contra `undefined`).
- `getPostContentVersions` (`store/posts.ts:1494`) inclui `geral_caption` no select.
- `SuggestionReview`, `AcceptSuggestionDialog` (`FIELD_ORDER`), `TeamOnlyFooter` (deixa de supor um
  campo só), `PostEditorBody` (nota de sugestão nas abas TikTok/Geral de `DestinationCaptionTabs`),
  `PhoneSheets`: N campos, rótulos por destino, conflito com "Usar a versão do cliente" por campo
  (mockup "CRM").
- `WorkflowDrawer`/`StandalonePostDrawer`: depois de aceitar, invalidar também
  `['post-targets', postId]`.
- `classifyAcceptError`: `target_gone` ("O destino foi removido do post", nomeando TikTok ou Geral
  pelo campo escolhido), `target_locked` ("O TikTok já foi publicado; a legenda dele não muda mais") e
  `40P01` ("Tente de novo").
- `PostVersionHistorySheet`: diff de `geral_caption`.
- i18n `postEditor` pt e en.

### Verificação do PR 2

- SQL (`supabase/tests/entitlements/`): upsert por campo novo (base, rebase, `base_required`,
  `target_gone`, ramo legado intocado), accept (conflito, `p_acknowledged`, `target_gone`,
  `target_locked`, CRM antigo com `p_fields` nulo e campo novo → conflito, ramo legado preservando
  entradas novas, `geral_target_id` trocado, `tiktok_followed_ig`), versão Geral (trigger, INSERT
  semeado vazio não grava, `source='client'`, `suggestion_id`, um aceite = uma versão), pin 96, o
  `104.11` (assinaturas antigas não existem) re-fixado, e casos novos em
  `95_post_content_versions_coalescing.sql` (save do Geral no CRM coalesce por ator; aceite gera
  exatamente uma linha).
- Hub: unitário de Stories com `platform` legado `both` e `targets` novo só com Instagram.
- Deno: `hub-edit-suggestion` (campos, validação de destino e tamanho), `hub-posts` (select).
- Vitest Hub e CRM nos arquivos listados acima.
- Browser: sugestão em TikTok e Geral no Hub; aceite parcial e com conflito no CRM; histórico de versões.

Deploy (spec de no-auto-reject, item 10): migration → `hub-edit-suggestion` + `hub-posts` → merge.
Durante a janela: Hub antigo usa o ramo legado (campos novos intocados e preservados). CRM antigo aceita
como hoje sugestões só de texto e Instagram; sugestão com legenda de TikTok ou Geral recebe
`suggestion_conflict` até a aba recarregar (nunca aplica um campo que a tela antiga não mostrou).

## Decisões minhas (para conferir)

- Comparação de igualdade para agrupar: string exata (revisão Codex).
- TikTok com as duas colunas nulas mostra "Sem legenda", o que de fato vai ao ar (revisão Codex; muda o
  que um post só de TikTok sem legenda mostra hoje).
- Aba de leitura por grupo, não por destino (Instagram e TikTok iguais + Geral diferente = duas abas).
- Agrupamento da edição é congelado ao abrir a edição.
- `target_locked` recusa o aceite do TikTok já publicado em vez de aplicar em silêncio.
- Um parâmetro jsonb no upsert em vez de dois `text`.
