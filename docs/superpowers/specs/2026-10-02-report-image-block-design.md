# Bloco "Imagem" no relatório de blocos: Design

Mockups aprovados: https://claude.ai/artifact/6nuyyYwqYQiCtwHtb9gN18 (7 artboards:
drawer, estados de envio, ajustes interativos, visão do cliente, celular, seletor de
Arquivos, editor de modelo).

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
3. **Armazenamento (opção 1):** o layout guarda uma referência ao `files` (id + chave),
   nunca uma URL. A URL é assinada na leitura. Arquivo usado em relatório não pode ser
   excluído dos Arquivos.
4. **Vertical em largura total:** altura máxima de 560 px, centralizada, com sugestão
   "Usar meia largura" no popover.
5. **Padrão após envio:** proporção `original` (nada é cortado até o usuário escolher).

## Modelo de dados

### Tipo de bloco

`"image"` entra em `BLOCK_TYPES` (`_shared/report-docs/layout.ts`). `WIDGET_CATALOG`
ganha a categoria `'Mídia'` (entre `'Texto'` e `'Estrutura'`) com
`{ type: 'image', label: 'Imagem', category: 'Mídia' }`. `WIDGET_ICONS.image = Image`
(o tipo `Record<BlockType, LucideIcon>` já obriga). Tamanho inicial ao inserir: `full`.

### `config` do bloco `image`

| campo | tipo | regra |
|---|---|---|
| `file_id` | inteiro positivo | ausente = bloco vazio |
| `r2_key` | string | obrigatório se `file_id` existir; prefixo `contas/` |
| `width`, `height` | inteiros positivos | dimensões naturais do arquivo; obrigatórios com `file_id` |
| `ratio` | `original` `16:9` `3:2` `4:3` `1:1` `4:5` `3:4` `2:3` `9:16` | padrão `original` |
| `fit` | `cover` \| `contain` | padrão `cover` |
| `focal` | `{ x, y }`, cada um em `0`, `0.5`, `1` | padrão centro |
| `caption` | string, até 200 caracteres | opcional |
| `alt` | string, até 300 caracteres | opcional |

- **Orientação não é guardada:** deriva da proporção. No popover, trocar a orientação
  leva à proporção padrão daquele lado (`16:9` ou `4:5`). `original` usa
  `width/height`.
- **`src` é proibido no `config`.** `validateLayout` rejeita. URL assinada nunca é
  persistida (layout nem template).
- `validateLayout` ganha as regras acima (mensagens de erro em inglês, como as atuais).
- **Garantia no banco.** O CRM grava `layout` direto por PostgREST (`report_documents`
  e `report_templates`), então a validação TS é só do cliente. A migration estende
  `validate_report_layout()` para blocos `image`: `config` sem a chave `src`; `ratio`
  e `fit` nos enums; `focal.x`/`focal.y` em `{0, 0.5, 1}`; `file_id`, `width`,
  `height` inteiros positivos quando presentes; `caption` ≤ 200 e `alt` ≤ 300
  caracteres. Quando `TG_TABLE_NAME = 'report_templates'`, bloco `image` com
  `file_id`, `r2_key`, `caption` ou `alt` é rejeitado (`INVALID_LAYOUT`). Isso torna
  a limpeza de modelo uma invariante do banco, não só do código.

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
```

FKs compostas amarram relatório, arquivo e vínculo ao mesmo `conta_id` no próprio
banco (`files_id_conta_uq` já existe desde `20260626000001_ideia_files.sql`); o
trigger de sincronização não é a única barreira (`report_documents.id` é `uuid`).

- RLS ligada; `authenticated` só lê (política por `get_my_conta_id()`); escrita só
  pelos triggers. Conceder privilégios explicitamente por role (`REVOKE FROM PUBLIC`
  não tira `anon`/`authenticated`).
- `trg_*_ref_count_ins/_del` reutilizam `file_update_reference_count()`, igual a
  `ideia_files`. **Sem** limpeza de órfão: a imagem vive na pasta do cliente nos
  Arquivos e continua lá quando o relatório some.
- Trigger `AFTER INSERT OR UPDATE OF layout ON report_documents` (SECURITY DEFINER):
  extrai os `config.file_id` dos blocos `image`, mantém só os ids de `files` com o
  mesmo `conta_id` do relatório **e** `kind = 'image'`, e faz o diff com os vínculos
  existentes (insere/remove).
- `file-manage` DELETE `/files/:id` já devolve 409 `file_in_use` com
  `reference_count > 0`. A resposta ganha `linked_reports: [{ report_id, title }]`
  (query filtrada pelo `conta_id` do chamador).
- `FileContextMenu.openDelete` hoje bloqueia localmente quando `reference_count > 0`,
  antes de chamar o DELETE, com a cópia fixa "vinculado a N post(s)". Esse
  pré-bloqueio sai: o diálogo de exclusão abre normalmente, e o 409 do servidor vira a
  mensagem, montada a partir de `linked_posts` e `linked_reports` ("Este arquivo está
  em uso em 2 posts e no relatório Relatório de setembro. Remova de lá primeiro.").
- Excluir pasta não é afetado: `files.folder_id` é `ON DELETE SET NULL`, o arquivo
  sobrevive na raiz.
- Versão da migration: acima do último prefixo de `main` no momento do PR.

## Leitura e assinatura de URL

### Hub e print (`hub-report-docs`)

`docHandler` e `printDocHandler` (hoje devolvem `layout` cru) passam o layout por um
`signImageBlocks(layout, contaId, deps)`:

1. Coleta os `file_id` dos blocos `image`.
2. Uma query: `files` com `id IN (...)` **e** `conta_id = doc.conta_id`. A chave
   assinada é o `r2_key` da linha do banco, nunca a do layout.
3. Para cada bloco com arquivo válido e sem `media_lost_at`: `config.src =
   signMediaUrl(r2_key)` (7 dias), com fallback de presign R2 de 3600 s (mesmo padrão
   de `hub-posts`).
4. Bloco cujo `file_id` não voltou na query (outro workspace, excluído, perdido):
   sem `src`. Qualquer `src` que já esteja no layout salvo é removido antes.

### Editor do CRM

O editor lê `report_documents` direto por PostgREST (não há edge function no caminho).
Um hook `useReportImageUrls(layout)`, com TanStack Query:

1. Lê `files` (`id, r2_key, kind, media_lost_at`) por PostgREST com
   `id IN (file_ids)`; a RLS `files_tenant_all` já limita ao workspace.
2. Arquivo ausente, `kind != 'image'` ou com `media_lost_at`: estado "indisponível",
   sem assinatura. (`sign-r2-urls` assina qualquer chave com o prefixo do workspace sem
   olhar `files`, então não serve sozinho para detectar arquivo perdido.)
3. Os demais: `sign-r2-urls` com o `r2_key` **da linha de `files`**, não o do layout.

As URLs ficam só nesse cache; o editor passa `src` para o componente em memória e
nunca escreve no layout.

### Renderer (`packages/report-blocks/blocks/ImageBlock.tsx`)

- Sem `config.src` válido (`https:` ou `blob:`): retorna `null` (célula colapsa pela
  regra `:empty` existente).
- `<figure class="rb-image">` com `<img src alt>`; `aspect-ratio` pela proporção
  (`original` = `width / height`), `object-fit` pelo `fit`, `object-position` pelo
  `focal`. `fit: contain` pinta a sobra com `var(--rb-surface)`.
- Altura máxima 560 px: largura do quadro = `min(100%, 560px * ratio)`, centralizado.
- Legenda em `<figcaption>`, com a cor de texto secundário dos tokens de tema.
- `blockHasData`: `image` sem `file_id` = sem dados.
- CSS: `.rb-image { break-inside: avoid; }` (primeira regra `break-inside` do pacote).
  A página de print já espera `img.decode()` antes de `__REPORT_READY`.

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
relatório."); "Trocar imagem". Todas as mudanças vão por `onConfigChange` e entram no
desfazer/refazer; o envio vira um passo só.

### Envio

- Validação no cliente: JPG, PNG ou WebP; até 10 MB.
- Redução no navegador para no máximo 2400 px no maior lado (mesma técnica de
  `reportSplash.ts`, sem achatar transparência em PNG).
- `uploadFile({ file, folderId })` de `services/fileService.ts` (já envolve
  `trackUnsavedWork` e cria a linha em `files`). `folderId` = subpasta "Relatórios"
  filha da pasta do cliente.
- **Pasta "Relatórios":** o par `(source_type='client', source_id=clienteId)` já é a
  raiz do cliente e é único (`folders_source_unique`), e a API de pastas só cria pasta
  comum. A migration acrescenta `'client_reports'` ao `folders_source_type_check`
  (última versão em `20260425000005`) e uma RPC SECURITY DEFINER
  `get_or_create_client_reports_folder(p_cliente_id bigint) RETURNS bigint`: confere
  que o cliente é do `get_my_conta_id()`, localiza a pasta raiz do cliente e faz
  `INSERT ... (source='system', source_type='client_reports', source_id=p_cliente_id,
  parent_id=<raiz do cliente>, name='Relatórios') ON CONFLICT` sobre
  `folders_source_unique`, devolvendo o id. Atômico: dois primeiros envios
  simultâneos não duplicam a pasta. `source='system'` impede excluir pelo
  `file-manage`. Se o usuário mover a pasta, ela continua sendo achada pelo par
  `source_type`/`source_id`.
- Colar (`paste`) com o bloco focado também envia.

### Erros (pt-BR)

| caso | mensagem |
|---|---|
| > 10 MB | "Esta imagem tem X MB. O limite é 10 MB." |
| formato | "Formato não suportado. Use JPG, PNG ou WebP." |
| cota (413) | "Sem espaço de armazenamento no plano." |
| rede / 5xx | "Não foi possível enviar a imagem." + "Tentar novamente" |

### Seletor de Arquivos

`FilePickerModal` ganha `selectionMode?: 'multiple' | 'single'` (padrão `multiple`,
o uso atual em `PostMediaGallery` não muda) e `initialFolderId?: number | null`. No
modo single, clicar seleciona um só, o título vira "Escolher imagem" e o botão "Usar
imagem". Aberto com `filterKind={['image']}` e a pasta do cliente. Arquivo com
`media_lost_at` não aparece. Ao escolher, o bloco recebe `file_id`, `r2_key`,
`width`, `height` do `FileRecord`; `ratio` volta para `original`.

`FileRecord.width`/`height` são anuláveis (registros antigos). Se vierem nulos, o
editor carrega a URL assinada do arquivo num `Image()` e usa `naturalWidth` /
`naturalHeight` antes de gravar o bloco; se o carregamento falhar, mostra "Não foi
possível abrir esta imagem." e não altera o bloco. Nunca grava um bloco com
`file_id` sem `width`/`height`.

## Modelos

- `stripAiTextForTemplate` vira `sanitizeLayoutForTemplate`: além do texto de IA,
  remove de blocos `image` os campos `file_id`, `r2_key`, `width`, `height`,
  `caption`, `alt`. Mantém `size`, `ratio`, `fit`, `focal`.
- Aplicado em todos os caminhos para `report_templates`: `SaveTemplateDialog`,
  `templateAutosave`, `buildSystemDefaultLayout`, e os dois que hoje não sanitizam
  (`ReportTemplatesCard.tsx:84`, `ModeloPadraoPage.tsx:49`).
- Defesa no servidor: `report-docs/generate.ts` aplica a mesma limpeza ao layout do
  modelo antes do insert. A função mora em `_shared/report-docs/` para os dois lados
  usarem.
- No editor de modelo (sem cliente), `ImageBlockEditor` em modo `template`: mostra o
  "Espaço para imagem" já no formato escolhido, sem envio nem seletor; o popover
  oferece só Orientação, Proporção, Quando não couber e Enquadramento.
- `ratio: 'original'` num modelo não tem dimensão: o espaço usa 3:2 como prévia.

## Hub e PDF

- Hub: `RelatorioDocPage` já usa `BlockRenderer`; abaixo de 720 px os blocos
  `third`/`half` já viram largura total. Nada a mudar além do renderer.
- PDF: cache por `pdf_generated_at >= updated_at` continua válido (o PDF é binário, a
  expiração da URL não importa depois de renderizado). `break-inside: avoid` impede
  imagem cortada entre páginas.

## Fora do escopo

- Escolher capa de publicação do Instagram como imagem.
- Galeria / várias imagens num bloco.
- Recorte livre (arrastar para enquadrar); fica a grade 3×3.
- Imagem no MCP de conteúdo.

## Testes

- **Deno** (`_shared/report-docs`, `hub-report-docs`, `report-docs`):
  `validateLayout` (campos, limites, `src` rejeitado); `signImageBlocks` (file de
  outro workspace sem `src`, perdido sem `src`, `src` salvo removido, chave vem do
  banco); limpeza do modelo em `generate.ts`.
- **Vitest:** `ImageBlock` (proporção, `fit`, `focal` → CSS; sem `src` = `null`);
  `blockHasData`; estados do `ImageBlockEditor`; popover (troca de orientação,
  `Original` oculta ajuste, dica de vertical); `sanitizeLayoutForTemplate`;
  `FilePickerModal` single + `initialFolderId`; catálogo/ícone; mensagem de
  `file_in_use` com relatório.
- **SQL** (`supabase/tests/entitlements/`, gated no CI): sincronização dos vínculos
  ao inserir/editar/limpar o layout; `reference_count` sobe e desce; `file_id` de
  outro workspace ou `kind != 'image'` ignorado; insert manual de vínculo
  cross-workspace barrado pelas FKs compostas; exclusão de arquivo em uso bloqueada;
  excluir relatório libera; exclusão de workspace em cascata não trava;
  `validate_report_layout` rejeita `src`, enums inválidos e imagem preenchida em
  `report_templates`; `get_or_create_client_reports_folder` idempotente e recusa
  cliente de outro workspace.
- **Navegador:** envio, colar, escolher dos Arquivos, todas as proporções e ajustes,
  vertical em largura total, Hub (desktop e celular) e PDF exportado.

## Ordem de deploy

1. Migration (`db push`).
2. Deploy de `hub-report-docs` (`--no-verify-jwt`), `report-docs` e `file-manage`.
3. Merge (o merge publica o CRM e o Hub na hora).

Function antiga com layout novo devolve o bloco sem `src` e ele não aparece; por isso
as functions vão antes.
