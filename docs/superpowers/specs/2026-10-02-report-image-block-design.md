# Bloco "Imagem" no relatório de blocos: Design

Mockups aprovados: https://claude.ai/artifact/6nuyyYwqYQiCtwHtb9gN18 (7 artboards:
drawer, estados de envio, ajustes interativos, visão do cliente, celular, seletor de
Arquivos, editor de modelo).

Revisões: review externo Codex (2026-10-02, duas rodadas) e review Fable (2026-10-02) incorporados.

## Contexto

O relatório de blocos (`packages/report-blocks`, editor em
`apps/crm/src/pages/relatorio-editor`, schema em
`supabase/functions/_shared/report-docs/layout.ts`) só tem widgets de dados do
Instagram, texto e estrutura. Pedido: um widget de imagem. O usuário envia uma imagem
(ou escolhe uma dos Arquivos do cliente), escolhe orientação horizontal/vertical e
controla a proporção.

Restrição que molda o design: hoje TODA URL de imagem em relatório é pública e
permanente (logo e splash no bucket público `avatars`, thumbnails de post no bucket
público `instagram-posts`), congelada no snapshot. Os Arquivos são privados no R2 e
só abrem por URL assinada que expira (media-proxy: 7 dias; presign R2: 15 a 60 min).

## Decisões (brainstorming 2026-10-02)

1. **Modelos guardam só o espaço.** Num modelo, o bloco de imagem guarda largura,
   proporção, ajuste e enquadramento; nunca a imagem. Todo relatório gerado começa com
   o espaço vazio.
2. **Origem da imagem:** upload (arrastar, escolher arquivo, colar) **e** escolher dos
   Arquivos do cliente. Uploads vão para os Arquivos do cliente.
3. **Armazenamento (opção 1):** o layout guarda só o `file_id` (e as dimensões),
   nunca chave nem URL. A URL é assinada na leitura a partir da linha de `files`.
   Arquivo usado em relatório não pode ser excluído dos Arquivos.
4. **Vertical em largura total:** altura máxima de 560 px, centralizada, com sugestão
   "Usar meia largura" no popover.
5. **Padrão após envio:** proporção `original` (nada é cortado até o usuário escolher).
6. **Formatos:** JPG, PNG e WebP. GIF não entra (nem no envio nem no seletor).

## Modelo de dados

### Tipo de bloco

`"image"` entra em `BLOCK_TYPES` (`_shared/report-docs/layout.ts`). `WIDGET_CATALOG`
ganha a categoria `'Mídia'` (entre `'Texto'` e `'Estrutura'`) com
`{ type: 'image', label: 'Imagem', category: 'Mídia' }`. `WIDGET_ICONS.image =
FileImage` (`Image` já é o ícone de `cover`; repetir deixaria capa e imagem iguais no
painel de camadas). Tamanho inicial ao inserir: `full`.

### `config` do bloco `image`

| campo | tipo | regra |
|---|---|---|
| `file_id` | inteiro positivo | ausente = bloco vazio |
| `width`, `height` | inteiros positivos | dimensões naturais do arquivo; obrigatórios com `file_id` |
| `ratio` | `original` `16:9` `3:2` `4:3` `1:1` `4:5` `3:4` `2:3` `9:16` | padrão `original` |
| `fit` | `cover` \| `contain` | padrão `cover` |
| `focal` | `{ x, y }`, cada um em `0`, `0.5`, `1` | padrão centro |
| `caption` | string, até 200 caracteres | opcional |
| `alt` | string, até 300 caracteres | opcional |

- **Sem `r2_key` no config.** Todo leitor (Hub, print, editor) resolve a chave pela
  linha de `files`, então guardá-la seria redundante e ainda quebraria com arquivos
  copiados nos Arquivos, cuja chave é `<conta>/<uuid>-nome`, sem o prefixo `contas/`
  (`file-manage/handler.ts:414`, cópia de pasta em `:323`).
- **Arquivos copiados entram no seletor e precisam funcionar no editor.** Hoje
  `sign-r2-urls` só assina chaves `contas/<conta>/...` (`handler.ts:135` no GET de
  bytes, `:167` no POST), então uma cópia apareceria "indisponível" no editor enquanto
  Hub e PDF (que usam `signMediaUrl` sobre a chave do banco) a mostrariam. Este PR
  amplia os dois caminhos de `sign-r2-urls` para aceitar também o prefixo
  `<conta>/` do próprio workspace (continua escopado ao tenant; nada de outro
  workspace passa). Isso também conserta imagens copiadas no resto do CRM que usam
  `useFileUrl`. Mudar o formato de chave da cópia fica fora do escopo.
- **Orientação não é guardada:** deriva da proporção. No popover, trocar a orientação
  leva à proporção padrão daquele lado (`16:9` ou `4:5`). `original` usa
  `width/height`.
- **`src` é proibido no `config`.** URL assinada nunca é persistida (layout nem
  template).
- `validateLayout` ganha as regras acima (mensagens de erro em inglês, como as atuais).
- **Garantia no banco.** O CRM grava `layout` direto por PostgREST (`report_documents`
  e `report_templates`), então a validação TS é só do cliente. A migration estende
  `validate_report_layout()` (compartilhado pelas duas tabelas) para blocos `image`:
  `config` sem as chaves `src` e `r2_key`; `ratio` e `fit` nos enums;
  `focal.x`/`focal.y` em `{0, 0.5, 1}`; `file_id`, `width`, `height` inteiros
  positivos quando presentes; `caption` ≤ 200 e `alt` ≤ 300 caracteres. Quando
  `TG_TABLE_NAME = 'report_templates'`, bloco `image` com `file_id`, `width`,
  `height`, `caption` ou `alt` é rejeitado (`INVALID_LAYOUT`). Isso torna a limpeza
  de modelo uma invariante do banco, não só do código.

### Tabela de vínculo (migration nova)

```
ALTER TABLE report_documents ADD CONSTRAINT report_documents_id_conta_uq UNIQUE (id, conta_id);

report_document_files (
  report_id  uuid   NOT NULL,
  file_id    bigint NOT NULL,
  conta_id   uuid   NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  PRIMARY KEY (report_id, file_id),
  FOREIGN KEY (report_id, conta_id) REFERENCES report_documents(id, conta_id) ON DELETE CASCADE,
  FOREIGN KEY (file_id, conta_id)   REFERENCES files(id, conta_id)            -- RESTRICT
)
CREATE INDEX report_document_files_file_idx ON report_document_files (file_id);
```

FKs compostas amarram relatório, arquivo e vínculo ao mesmo `conta_id` no próprio
banco (`files_id_conta_uq` já existe desde `20260626000001_ideia_files.sql`;
`report_documents.id` é `uuid`). O índice em `file_id` serve o 409, o diff do
trigger e a proteção do autoclean.

- **Exclusão de workspace:** `workspaces → files` (CASCADE) e
  `workspaces → report_documents → report_document_files` (CASCADE) formam um
  losango com a FK RESTRICT. `post_file_links` tem o mesmo losango hoje e não há
  caminho de produto que exclua workspace, então isso não está verificado. O teste SQL
  "exclusão de workspace em cascata não trava" decide: se falhar, a FK de `file_id`
  vira `NO ACTION DEFERRABLE INITIALLY DEFERRED` (exclusão direta de arquivo continua
  falhando no commit; PostgREST é um statement por transação).
- RLS ligada; `authenticated` só lê (política por `get_my_conta_id()`); escrita só
  pelos triggers. Conceder privilégios explicitamente por role (`REVOKE FROM PUBLIC`
  não tira `anon`/`authenticated`).
- `trg_*_ref_count_ins/_del` reutilizam `file_update_reference_count()` (SECURITY
  DEFINER), igual a `ideia_files`. **Sem** limpeza de órfão: a imagem vive na pasta do
  cliente nos Arquivos e continua lá quando o relatório some.
- Trigger `AFTER INSERT OR UPDATE OF layout ON report_documents` (SECURITY DEFINER):
  extrai os `config.file_id` dos blocos `image`, mantém só os ids de `files` com o
  mesmo `conta_id` do relatório, `kind = 'image'` **e** `mime_type IN ('image/jpeg',
  'image/png', 'image/webp')` (o backend aceita GIF como `kind = 'image'`,
  `file-upload-finalize/handler.ts:65`; sem esse filtro uma escrita direta de layout
  vincularia um GIF e o Hub o mostraria), e faz o diff com os vínculos existentes
  (insere/remove). `GRANT UPDATE (layout, title)` em `report_documents`
  deixa esse trigger como único escritor de vínculos.
- **Autoclean noturno (P0 do review Fable).** `storage_autoclean_candidates()`
  (`20260811000002_storage_autoclean_rpcs.sql:47-66`) seleciona arquivos de posts
  publicados antigos e só exclui `ideia_files` e o logo do Hub; o `DELETE FROM files`
  final (`:233-250`) bateria na FK RESTRICT e abortaria a noite inteira para um
  arquivo de post antigo que também está num relatório. A migration faz
  `CREATE OR REPLACE` das duas funções com
  `AND NOT EXISTS (SELECT 1 FROM report_document_files rdf WHERE rdf.file_id = f.id)`
  na seleção e no DELETE final.
- `file-manage` DELETE `/files/:id` já devolve 409 `file_in_use` com
  `reference_count > 0`. A resposta ganha `linked_reports: [{ report_id, title }]`.
  As duas listas do 409 são filtradas explicitamente pelo `profiles.conta_id` do
  chamador: a query atual de `linked_posts` (`handler.ts:495`) usa só `file_id` sob
  service role, e `post_file_links` não tem FK composta (o autoclean trata vínculo
  cross-tenant malformado como possível, `20260811000002:59`), então hoje ela poderia
  vazar título de post de outro workspace. Passa a ter
  `.eq("conta_id", contaId)`; `linked_reports` idem.
- **Mensagem de arquivo em uso.** Hoje `callFn` (`services/fileService.ts:48-51`)
  lança `new Error(err.error)`, então só a string `file_in_use` chega ao
  `FileContextMenu` (`:185-190`). `callFn` passa a lançar um erro tipado
  (`FileApiError` com `status` e `body`). `FileContextMenu.openDelete` deixa de
  bloquear localmente quando `reference_count > 0` (cópia fixa "vinculado a N
  post(s)"); o diálogo abre, o DELETE roda, e o 409 vira a mensagem a partir de
  `linked_posts` e `linked_reports` ("Este arquivo está em uso em 2 posts e no
  relatório Relatório de setembro. Remova de lá primeiro."). `FileGrid.tsx:444-450` e
  `FolderInfoModal.tsx:138` ("Links em posts") passam a dizer "Em uso" de forma
  genérica.
- Excluir pasta não é afetado: `files.folder_id` é `ON DELETE SET NULL`, o arquivo
  sobrevive na raiz. Excluir o cliente remove a pasta do cliente e, em cascata, a
  pasta "Relatórios"; as imagens vão para a raiz dos Arquivos, e os relatórios do
  cliente saem em cascata (liberando os vínculos).
- Versão da migration: acima do último prefixo de `main` no momento do PR.

## Leitura e assinatura de URL

### Hub e print (`hub-report-docs`)

`docHandler` e `printDocHandler` (hoje devolvem `layout` cru) passam o layout por um
`signImageBlocks(layout, docId, deps)`:

1. Remove qualquer `config.src` que esteja no layout salvo.
2. Uma query: `report_document_files JOIN files` para o `report_id`, trazendo
   `file_id, r2_key, media_lost_at`. Ler pelo vínculo garante que o conjunto
   assinado é o mesmo que o trigger vinculou (mesmo `conta_id`, `kind = 'image'`) e o
   mesmo que bloqueia exclusão.
3. Para cada bloco cujo `file_id` voltou e não tem `media_lost_at`: `config.src =
   signMediaUrl(r2_key)` (7 dias), com fallback de presign R2 de 3600 s (mesmo padrão
   de `hub-posts/index.ts:13-14`).
4. Os demais blocos de imagem ficam sem `src` e não aparecem.

A assinatura de `docHandler`/`printDocHandler` ganha `deps` para assinar; os testes
existentes em `hub-report-docs/handlers.test.ts` são atualizados.

Cache do Hub: a `useQuery` de `RelatorioDocPage.tsx:20-24` (`['hub-report-doc', ...]`)
usa o `staleTime` padrão de 0, então refaz a busca a cada montagem e as URLs se
renovam ao navegar. Não há mudança de cache. (O `staleTime: Infinity` de
`apps/hub/src/queries.ts:13` é só do bootstrap.)

### Editor do CRM

O editor lê `report_documents` direto por PostgREST. Em vez de um hook paralelo, o
editor usa o existente `apps/crm/src/hooks/useFileUrl.ts` (lookup em `files` →
`sign-r2-urls` → blob URL, com o fallback de proxy de bytes para origens não-prod).
`resolveImageUrls` passa a selecionar também `kind, media_lost_at` e devolve um
marcador "indisponível" para arquivo ausente, `kind != 'image'` ou com
`media_lost_at`, sem assinar. (`sign-r2-urls` sozinho assina qualquer chave com o
prefixo do workspace sem olhar `files`, então não detecta arquivo perdido.) O cache
por `file_id` desse módulo nunca expira, o que combina com arquivos imutáveis.

As URLs ficam só nesse cache; o editor passa `src` para o componente em memória e
nunca escreve no layout.

### Renderer (`packages/report-blocks/blocks/ImageBlock.tsx`)

- Sem `config.src` válido (`https:` ou `blob:`): retorna `null` (célula colapsa pela
  regra `:empty` existente).
- `<figure class="rb-image">` com `<img src alt>`, **sem `loading="lazy"`**: a página
  de print espera `img.decode()` de `document.images`
  (`RelatorioPrintPage.tsx:58-62`) e uma imagem preguiçosa pode nunca decodificar no
  Gotenberg.
- `aspect-ratio` pela proporção (`original` = `width / height`), `object-fit` pelo
  `fit`, `object-position` pelo `focal`. `fit: contain` pinta a sobra com
  `var(--rb-surface)`.
- Altura máxima 560 px: largura do quadro = `min(100%, 560px * ratio)`, centralizado.
- Legenda em `<figcaption>`, com a cor de texto secundário dos tokens de tema.
- `blockHasData`: `image` sem `file_id` = sem dados.
- CSS: `.rb-image { break-inside: avoid; }` (primeira regra `break-inside` do pacote).

## Editor do CRM

### `ImageBlockEditor` (novo, como `CoverEditor`)

`EditorCanvas.SortableCell` despacha `block.type === 'image'` para ele. Estados:

| estado | o que mostra |
|---|---|
| vazio | área de soltar: "Arraste uma imagem para cá", "Enviar imagem", "Escolher dos arquivos", "JPG, PNG ou WebP até 10 MB. Também dá para colar uma imagem copiada." |
| enviando | prévia local (`blob:`) com barra de progresso |
| erro | mensagem do erro + "Escolher outra" |
| imagem | o `ImageBlock` com o `src` assinado |
| indisponível | "Imagem indisponível" + "Trocar imagem" (arquivo perdido ou assinatura falhou, com "Tentar novamente") |

A toolbar do bloco ganha o botão "Ajustes da imagem" (`SlidersHorizontal`) que abre um
`Popover` com: Orientação; Proporção (`Original` + 4 por orientação); "Quando não
couber" (`Preencher` / `Mostrar inteira`, oculto em `Original`); Enquadramento (grade
3×3, só em `Preencher`); dica de vertical em largura total com "Usar meia largura";
Legenda (opcional); Descrição da imagem ("Lida por leitores de tela. Não aparece no
relatório."); "Trocar imagem". As mudanças de `config` vão por `onConfigChange`
(`updateBlockConfig` + `commit`, `RelatorioEditorPage.tsx:216-217`) e entram no
desfazer/refazer; o envio vira um passo só. "Usar meia largura" muda `block.size`, que
não é `config`: o `ImageBlockEditor` recebe também `onSizeChange(id, size)`, ligado a
uma operação nova `setBlockSize(layout, id, size)` em `layoutOps.ts` e passada pelo
`onChange` do canvas, o mesmo caminho dos botões −/+ (`resizeBlock`).

### Envio

- Validação no cliente: JPG, PNG ou WebP; até 10 MB.
- Redução no navegador para no máximo 2400 px no maior lado. Função nova: o
  `downscaleImage` de `reportSplash.ts` sempre achata para JPEG sobre um fundo fixo,
  e aqui PNG mantém transparência (sai PNG; JPG/WebP saem JPEG q0.85).
- `uploadFile({ file, folderId })` de `services/fileService.ts` (já envolve
  `trackUnsavedWork` e cria a linha em `files`). `folderId` = pasta "Relatórios" do
  cliente.
- Se o editor for desmontado antes do envio terminar, o arquivo fica na pasta
  "Relatórios" sem vínculo. Aceito: aparece nos Arquivos e pode ser escolhido depois.
- Colar (`paste`) com o bloco focado também envia.

### Pasta "Relatórios"

O par `(source_type='client', source_id=clienteId)` já é a raiz do cliente e é único,
e a API de pastas só cria pasta comum. A migration:

- recria `folders_source_type_check` (última versão em
  `20260425000005_clientes_root_folder.sql:4-6`) com **todos** os valores atuais mais o
  novo: `'client', 'workflow', 'post', 'root_clients', 'client_reports'`. Omitir
  `root_clients` faz a migration falhar, porque já existem linhas com esse valor;
- cria a RPC SECURITY DEFINER
  `get_or_create_client_reports_folder(p_cliente_id bigint) RETURNS bigint`, com
  `SET search_path = public`, `REVOKE ALL ... FROM PUBLIC, anon` e
  `GRANT EXECUTE ... TO authenticated` (como `set_default_report_template`,
  `20260820000010_report_docs.sql:180-181`). Ela confere que o cliente é do
  `get_my_conta_id()`; localiza a pasta raiz do cliente e, se não existir (clientes
  anteriores ao trigger de pastas), cria no mesmo formato de `folder_sync_cliente`;
  então faz
  `INSERT INTO folders (conta_id, parent_id, name, source, source_type, source_id)
  VALUES (..., 'Relatórios', 'system', 'client_reports', p_cliente_id)
  ON CONFLICT (conta_id, source_type, source_id)
  WHERE source_type IS NOT NULL AND source_id IS NOT NULL
  DO UPDATE SET name = folders.name RETURNING id`.
  (`folders_source_unique` é índice parcial, não constraint, então o alvo é a lista de
  colunas com o predicado; `DO UPDATE` no-op para o `RETURNING` sempre devolver a
  linha.) Atômico: dois primeiros envios simultâneos não duplicam a pasta.
- `source='system'` impede excluir pelo `file-manage`. Se o usuário mover a pasta, ela
  continua sendo achada pelo par `source_type`/`source_id`.

### Erros (pt-BR)

| caso | mensagem |
|---|---|
| > 10 MB | "Esta imagem tem X MB. O limite é 10 MB." |
| formato | "Formato não suportado. Use JPG, PNG ou WebP." |
| cota (413) | "Sem espaço de armazenamento no plano." |
| rede / 5xx | "Não foi possível enviar a imagem." + "Tentar novamente" |

### Seletor de Arquivos

`FilePickerModal` (hoje título "Selecionar arquivos", botão "Vincular",
`onSelect(fileIds: number[])`) ganha:

- `selectionMode?: 'multiple' | 'single'` (padrão `multiple`; o uso atual em
  `PostMediaGallery` não muda). No modo single, clicar seleciona um só, o título vira
  "Escolher imagem" e o botão "Usar imagem".
- `initialFolderId?: number | null`, aplicado **dentro** do efeito de abertura
  (`:50-56`, que hoje zera `currentFolderId` para `null`).
- `onSelectRecords?(files: FileRecord[])`: devolve os registros, que já vêm com `url`
  assinada do `file-manage` (`handler.ts:157-161`, que anula `url` quando
  `media_lost_at`). O editor passa essa URL para `seedImageUrl` e evita uma segunda
  assinatura.
- Filtro por mime além de `filterKind={['image']}`: só `image/jpeg`, `image/png`,
  `image/webp`. Arquivo com `media_lost_at` não aparece.

Ao escolher, o bloco recebe `file_id`, `width`, `height` do `FileRecord`; `ratio`
volta para `original`. `FileRecord.width`/`height` são anuláveis (registros antigos):
se vierem nulos, o editor carrega a URL num `Image()` e usa `naturalWidth` /
`naturalHeight` antes de gravar; se falhar, mostra "Não foi possível abrir esta
imagem." e não altera o bloco. Nunca grava um bloco com `file_id` sem
`width`/`height`.

## Modelos

- `stripAiTextForTemplate` vira `sanitizeLayoutForTemplate` (em
  `_shared/report-docs/`, usada pelo CRM e pelo servidor): além do texto de IA, remove
  de blocos `image` os campos `file_id`, `width`, `height`, `caption`, `alt`. Mantém
  `size`, `ratio`, `fit`, `focal`.
- Usada onde um layout de relatório vira modelo: `SaveTemplateDialog`,
  `templateAutosave`, `buildSystemDefaultLayout`. (`ReportTemplatesCard` e
  `ModeloPadraoPage` criam a partir de `buildSystemDefaultLayout()` ou copiam um
  modelo, que já não tem imagem pela invariante do banco; não são brecha.)
- Defesa no servidor: `report-docs/generate.ts` aplica a mesma limpeza ao layout do
  modelo antes do insert.
- No editor de modelo (sem cliente), `ImageBlockEditor` em modo `template`: mostra o
  "Espaço para imagem" já no formato escolhido, sem envio nem seletor; o popover
  oferece só Orientação, Proporção, Quando não couber e Enquadramento.
- `ratio: 'original'` num modelo não tem dimensão: o espaço usa 3:2 como prévia.
- **Aplicar modelo num relatório existente** (`applyTemplateLayout`,
  `templateOps.ts:24-37`) troca o layout inteiro, então as imagens do relatório saem
  (os arquivos continuam nos Arquivos). O `ApplyTemplateDialog` ganha o aviso "As
  imagens deste relatório serão removidas. Elas continuam nos Arquivos do cliente."
  quando o relatório atual tem bloco de imagem preenchido.

## Hub e PDF

- Hub: `RelatorioDocPage` já usa `BlockRenderer`; abaixo de 720 px os blocos
  `third`/`half` já viram largura total. Muda só o renderer.
- PDF: cache por `pdf_generated_at >= updated_at` continua válido (`updated_at` sobe
  com mudança de layout; o PDF é binário, a expiração da URL não importa depois de
  renderizado). `break-inside: avoid` impede imagem cortada entre páginas.

## Fora do escopo

- Escolher capa de publicação do Instagram como imagem.
- Galeria / várias imagens num bloco.
- Recorte livre (arrastar para enquadrar); fica a grade 3×3.
- Imagem no MCP de conteúdo.
- Redimensionar no media proxy (`w=`) para o print; só se o Gotenberg ficar lento com
  imagens grandes.
- Mudar o formato de chave de cópia do `file-manage` (o signer passa a aceitá-lo).

## Testes

- **Testes existentes que mudam:** `_shared/report-docs/layout.test.ts:49`
  (`BLOCK_TYPES.length === 26` vira 27); `hub-report-docs/handlers.test.ts`
  (assinatura nova dos handlers); `packages/report-blocks/__tests__/catalog.test.ts`
  (categoria `'Mídia'`; `'Estrutura'` continua última); testes de `FileContextMenu`
  que dependem do pré-bloqueio; testes de `callFn`/`deleteFile`.
- **Deno** (`_shared/report-docs`, `hub-report-docs`, `report-docs`):
  `validateLayout` (campos, limites, `src`/`r2_key` rejeitados); `signImageBlocks`
  (sem vínculo = sem `src`, perdido = sem `src`, `src` salvo removido, chave vem de
  `files`); limpeza do modelo em `generate.ts`; `linked_posts` e `linked_reports` no
  409 do `file-manage` escopados ao `conta_id` (vínculo de outro workspace não
  aparece); `sign-r2-urls` aceita `<conta>/` próprio e recusa `<outra-conta>/` nos
  dois métodos.
- **Vitest:** `ImageBlock` (proporção, `fit`, `focal` → CSS; sem `src` = `null`; sem
  `loading="lazy"`); `blockHasData`; estados do `ImageBlockEditor`; popover (troca de
  orientação, `Original` oculta ajuste, dica de vertical); `sanitizeLayoutForTemplate`;
  `resolveImageUrls` com marcador indisponível; `setBlockSize` e "Usar meia largura"; `FilePickerModal` single +
  `initialFolderId` + `onSelectRecords` + filtro de mime; catálogo/ícone; mensagem de
  `file_in_use` com posts e relatórios; aviso do `ApplyTemplateDialog`; downscale que
  preserva PNG.
- **SQL** (`supabase/tests/entitlements/`, gated no CI): sincronização dos vínculos
  ao inserir/editar/limpar o layout; `reference_count` sobe e desce; `file_id` de
  outro workspace, `kind != 'image'` ou GIF ignorado; insert manual de vínculo
  cross-workspace barrado pelas FKs compostas; exclusão de arquivo em uso bloqueada;
  excluir relatório libera; exclusão de workspace em cascata não trava;
  `validate_report_layout` rejeita `src`, `r2_key`, enums inválidos e imagem
  preenchida em `report_templates`; a migration aplica sobre pastas `root_clients`
  existentes; `get_or_create_client_reports_folder` idempotente,
  cria a raiz que falta, recusa cliente de outro workspace e não é executável por
  `anon`; novo caso em `63_storage_autoclean.sql`: arquivo de post antigo usado em
  relatório não é candidato e a noite não aborta.
- **Navegador:** envio, colar, escolher dos Arquivos, todas as proporções e ajustes,
  vertical em largura total, aplicar modelo com aviso, exclusão bloqueada nos
  Arquivos com a mensagem nova, Hub (desktop e celular) e PDF exportado.

## Ordem de deploy

1. Migration (`db push`).
2. Deploy de `hub-report-docs` (`--no-verify-jwt`), `report-docs`, `file-manage` e
   `sign-r2-urls`.
3. Merge (o merge publica o CRM e o Hub na hora).

Function antiga com layout novo devolve o bloco sem `src` e ele não aparece; por isso
as functions vão antes.
