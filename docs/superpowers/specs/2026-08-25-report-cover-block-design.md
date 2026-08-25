# Capa em página inteira, editável, com foto do cliente — Design

## Contexto

O bloco "Capa" (`cover`, categoria Estrutura) hoje é somente-leitura: renderiza a logo
da agência, o nome do workspace, a linha "Relatório mensal · Instagram", o mês do
período (`snapshot.period.label`) e o handle/especialidade do cliente, tudo derivado
do snapshot, sem nenhum `block.config`. A cor de fundo é sempre o accent do relatório
(`var(--rb-cover-bg, var(--rb-accent))`). É renderizado pelo mesmo `CoverBlock.tsx`
nos três consumidores do pacote `packages/report-blocks` (editor do CRM, viewer do
Hub, página de print/PDF), via `BlockRenderer`.

Pedido: transformar a Capa em página inteira, com foto de perfil do cliente ao lado
da logo, conteúdo editável, cor própria (independente do accent) e tamanho de logo
customizável.

## Decisões (confirmadas em brainstorming 2026-08-25)

1. **Conteúdo editável**: kicker, título (hoje = mês) e subtítulo (hoje = @handle ·
   especialidade) viram todos editáveis, incluindo o título — aceito o risco de
   destoar do período real dos dados em troca de liberdade total.
2. **Foto do cliente**: avatar circular ao lado da logo da agência (os dois
   convivem); fonte é a MESMA coluna que o Hub já usa (`instagram_accounts.profile_picture_url`),
   mas com cache próprio no momento da geração (ver Modelo de dados — essa coluna
   nem sempre é estável, ver achado do review externo abaixo).
3. **Página inteira**: aplica-se ao editor (tela) E ao PDF — a capa ocupa a maior
   parte da tela no editor/Hub, e no PDF fica sozinha na primeira página via quebra
   forçada.
4. **Cor própria**: um único seletor de cor de fundo; a cor do texto é derivada
   automaticamente para contraste, reaproveitando a mesma lógica que já resolve o
   contraste do accent hoje.

## Modelo de dados

### `cover.config` (novos campos, todos opcionais — ausência preserva o comportamento
atual byte-a-byte)

```ts
interface CoverConfig {
  kicker?: string;   // default: "Relatório mensal · Instagram"
  title?: string;    // default: snapshot.period.label (o mês)
  subtitle?: string; // default: "@{handle}" + " · {specialty}" quando houver
  color?: string;    // "#rrggbb"; ausente = var(--rb-cover-bg, var(--rb-accent)), igual a hoje
  logoSize?: number; // altura da logo em px; ausente = 36 (o valor fixo atual)
}
```

Semântica de herança idêntica à já usada por `layout.accent`/`layout.theme`/
`layout.fonts`: campo ausente = usa o valor computado (dado real ou accent do
relatório); campo presente = override explícito. No editor, limpar um campo de texto
volta a herdar o valor computado (grava `undefined`, que o merge raso de
`updateBlockConfig` e a serialização JSONB já descartam — nenhuma mudança necessária
em `layoutOps.ts`).

### `snapshot.account.profile_picture_url` e `snapshot.account.client_name` (campos novos)

`supabase/functions/_shared/report-docs/snapshot.ts`: `ReportDocSnapshot.account` e
`SnapshotInput.account` ganham `profile_picture_url: string | null` e
`client_name: string`.

**Pré-requisito de conta conectada não muda.** `loadClientSnapshot` já lança
`GenerateError("not_found", "Conta Instagram não conectada")` quando não há linha em
`instagram_accounts` para o cliente (`snapshot-source.ts:69-72`) — isso é anterior a
este pedido e vale para o relatório inteiro, não só para a foto. Ou seja: a partir do
ponto em que o snapshot é montado, a conta SEMPRE existe; o único campo que pode
faltar de fato é o próprio `profile_picture_url` (conta conectada mas o Graph nunca
devolveu foto, ou o cache abaixo falha).

**A URL da Graph API NÃO é garantidamente estável — precisa de cache próprio, igual
ao dos thumbnails de post.** Achado do review externo, confirmado no código: a
conexão inicial (`instagram-integration/index.ts:382`) grava
`profile_picture_url: igProfile.profile_picture_url || ''` — a URL EFÊMERA da CDN do
Graph, sem cache nenhum. Só os crons de sync/refresh (`instagram-sync-cron`,
`instagram-refresh-cron`, e o próprio `instagram-integration` num caminho posterior)
tentam baixar e recachear no bucket `avatars`, com fallback pra URL crua se o
download falhar. Isso é aceitável para o `cliente_foto_url` do `hub-bootstrap`
porque ali é um valor buscado a cada bootstrap (se expirar, o próximo bootstrap
autocorrige, e o `ClientAvatar` já tem `onError`). Mas o `data_snapshot` do relatório
é CONGELADO para sempre — uma URL efêmera congelada vai quebrar quando expirar
(dias), sem nenhum jeito de autocorrigir depois.

Correção: em `snapshot-source.ts`, cachear a foto no MESMO mecanismo já usado para
thumbnails de post nesse arquivo — `cachePostThumbnail` (de
`_shared/instagram-thumbnail-cache.ts`), chamado com um id sintético fixo:

```ts
const avatarUrl = await cachePostThumbnail(
  { fetch: deps.fetch, storage: deps.storage },
  igAccountId,
  "avatar",
  account.profile_picture_url ?? null,
  null,
);
```

Isso grava em `instagram-posts/{igAccountId}/avatar.jpg` (bucket que já existe) e
devolve uma URL pública estável; em caso de falha de download, `cachePostThumbnail`
devolve a própria URL crua (mesmo contrato que os thumbnails de post já aceitam hoje
— o `CoverAvatar` tem `onError` para esse caso residual, igual ao `ClientAvatar` do
Hub). A chamada roda em paralelo com o resto do I/O que `loadClientSnapshot` já
dispara (mesmo padrão do `accountViewsPromise`), sem adicionar latência no caminho
crítico.

`client_name`: fonte é `clientes.nome`. `generate.ts` já seleciona essa coluna
(`select("id, conta_id, nome, especialidade, include_ai_analysis")`, linha 50) mas
não repassa para `loadClientSnapshot` — passa a repassar. `refresh.ts` ainda não
seleciona `nome` (`select("id, conta_id, especialidade")`, linha 21) — passa a
selecionar também. `loadClientSnapshot`'s `cliente` param ganha `nome: string`. Sem
query nova em nenhum dos dois casos, só ampliar o `select` existente e propagar o
campo.

## Validação (`supabase/functions/_shared/report-docs/layout.ts`)

Estende `validateLayout`, mesmo estilo dos checks existentes de `accent`/`top_posts.count`:

- `cover.config.color`, quando presente: string `^#[0-9a-fA-F]{6}$` (mesma regex do
  `accent` do layout).
- `cover.config.logoSize`, quando presente: inteiro entre 20 e 68 (mesmo padrão de
  bounds de `top_posts.config.count`, que vai de `TOP_POSTS_MIN` a `TOP_POSTS_MAX`;
  o teto em 68, e não 64, é para o stepper de +8px a partir do default de 36 bater
  exatamente no limite: 36 → 44 → 52 → 60 → 68).
- Todo bloco `type === "cover"` deve ter `size === "full"` (a capa não faz sentido em
  largura parcial com altura de página inteira).

**`color`/`logoSize`: sem migration, só TS.** O trigger SQL `validate_report_layout()`
valida a FORMA do layout (versão, blocks é array, ids, `size` no enum,
`theme`/`fonts`/`accent` layout-level) mas nunca inspeciona `block.config` campo a
campo — nem o `top_posts.config.count` (que já existe hoje) tem contraparte no
trigger. `color` e `logoSize` são cosméticos: um valor inválido escrito direto via
PostgREST, ignorando o `validateLayout` do cliente, só produz uma cor/tamanho que o
CSS silenciosamente ignora — sem corrupção de layout. Seguem o mesmo precedente de
`top_posts.count`: validados só em TS, no cliente (antes do autosave, mesmo
raciocínio do comentário em `setLayoutAccent` sobre nunca deixar um valor inválido
ENTRAR no layout) e em qualquer chamada de `report-docs`.

**`cover.size === "full"`: PRECISA do trigger também.** Achado do review externo,
que muda minha decisão original de deixar essa regra só em TS. Diferença em relação
a `color`/`logoSize`: essa invariante sustenta a promessa de página cheia/página
única no PDF (seção CSS abaixo) — um `cover` com `size: 'third'` persistido por uma
escrita direta via PostgREST (caminho OFICIALMENTE suportado pela arquitetura deste
recurso, não uma brecha) quebra a paginação de verdade, não é só estética. Nova
migration (`supabase/migrations/<timestamp>_report_cover_full_width.sql`, forward-only,
`CREATE OR REPLACE FUNCTION validate_report_layout()` preservando o corpo inteiro da
`20260824000002`, mesmo padrão dela) estende o `EXISTS` sobre `blocks` com:

```sql
OR (b ->> 'type' = 'cover' AND b ->> 'size' <> 'full')
```

A regra também fica no `validateLayout` (TS) e reforçada na UI (esconder os botões
de largura — ver Edição abaixo), pelas mesmas razões de defesa em profundidade já
usadas em todo o resto do arquivo.

## Contraste (`packages/report-blocks/theme.ts`)

`pickAccentFg(acc, ink)` já existe e já resolve exatamente este problema para o
accent hoje; só está sem `export`. Passa a ser exportada para o `CoverBlock` chamar
`pickAccentFg(config.color, '#171717')` quando houver cor própria — mesmo ink de
fallback já usado no branch herdado do resolver (`resolveReportTheme` linha ~262).
Sem cor própria, o comportamento não muda: `var(--rb-cover-fg, var(--rb-accent-fg))`
continua vindo do tema.

## Renderização (`packages/report-blocks/blocks/CoverBlock.tsx`)

Reescrita do componente somente-leitura (consumido por editor fora do modo edição,
Hub viewer e print, via `BlockRenderer`):

- Lê `block.config` (já disponível em `BlockProps`, não usado hoje).
- Kicker/título/subtítulo: `config.X ?? valorComputado`.
- Cor: `config.color` presente → `background: config.color` + `color:
  pickAccentFg(config.color, '#171717')` inline; ausente → mantém os `var(...)`
  atuais (zero mudança visual em documentos existentes).
- Logo: `height: config.logoSize ?? 36` (era fixo em 36).
- Avatar do cliente: novo componente `CoverAvatar` (dentro do próprio
  `CoverBlock.tsx` — **não** importa `apps/hub/src/components/ClientAvatar.tsx`,
  que usa classes `hub-*` que só existem no stylesheet inline do Hub; o pacote
  compartilhado precisa renderizar igual no editor do CRM, que não carrega esse
  CSS). Mesmo comportamento do `ClientAvatar` do Hub: `<img>` com
  `onError` revertendo para um círculo com a inicial de `snapshot.account.client_name`
  (**não** `branding.workspace_name` — esse é o nome da agência, não do cliente; a
  correção veio do review externo). Tamanho = `config.logoSize ?? 36` (acompanha a
  logo); estilo memory-safe quanto a contraste: borda `1.5px solid currentColor` e o
  fallback usa fundo transparente + `color: inherit` — herda o MESMO
  `--rb-cover-fg`/cor de contraste já calculada, então nunca preciso computar uma
  segunda cor. Posição: ao lado da logo, mesma linha, pequeno gap. Snapshot antigo,
  sem a chave `client_name` (ver abaixo): cai para a primeira letra de
  `account.handle`, que existe desde a v1 do documento de blocos.
- **O avatar é elemento novo, sempre presente — isso não é "byte-a-byte".** A
  garantia de "ausente = comportamento atual" na seção Modelo de dados vale só para
  os campos de `cover.config` (texto/cor/tamanho de logo): se nenhum for setado, o
  layout renderiza igual a hoje. O avatar não é um desses campos — ele é uma peça
  nova do próprio `CoverBlock`, e passa a aparecer em TODA capa, incluindo relatórios
  já gerados antes deste recurso (cujo `data_snapshot` congelado nem tem a chave
  `profile_picture_url`/`client_name`). Isso é intencional: `profile_picture_url`
  ausente ou `null` degrada para o fallback de iniciais (nunca quebra), então um
  relatório antigo simplesmente ganha um monograma ao lado da logo — não é
  regressão, é o recurso pedido se aplicando também ao histórico.
- Full-page: `className="rb-cover"` ganha as regras novas no `styles.css` (abaixo);
  nenhuma mudança de estrutura de grid é necessária além de garantir `size: 'full'`.
- Splash (`branding.splash_url`, já existente): a `<img>` ganha `className="rb-cover-splash"`
  para herdar o teto de altura do CSS abaixo (ver achado do review externo na seção
  CSS) — continua condicional a `b.splash_url`, nenhuma outra mudança de
  comportamento.

## Edição (`apps/crm/src/pages/relatorio-editor/CoverEditor.tsx`, novo)

Mesmo padrão de `SectionHeaderEditor.tsx`: componente exclusivo do editor, só
usado dentro de `EditorCanvas.tsx`, que reproduz a MESMA casca visual do
`CoverBlock` (fundo, logo, avatar) e troca os três textos por `<input>` (classe
`rb-section-input`, já existente e genérica o bastante para reutilizar — sem CSS
novo para os campos de texto). Valor exibido em cada input quando `config.X` está
ausente = o valor computado (mês real, "@handle · especialidade", kicker padrão) —
a capa nunca aparece em branco só porque ainda não foi editada. Limpar o campo grava
`undefined` (reverte a herança). Além dos três inputs:

- Seletor de cor: reaproveita o `ColorPicker` compartilhado (`@/components/shared/ColorPicker`,
  o mesmo componente que a Aparência já usa), com `allowAlpha={false}` e o accent do
  relatório como cor "de marca" sugerida. **`allowAlpha={false}` sozinho não basta**
  — achado do review externo, mesma classe de bug já documentada e corrigida em
  `setLayoutAccent` (`layoutOps.ts`, comentário "achado C2"): um clique num swatch
  "recente" salvo por OUTRA tela (Estúdio) pode devolver `#rrggbbaa` mesmo com
  `allowAlpha={false}` aqui. Sem normalizar, esse valor falharia o novo
  `validateLayout` e travaria o autosave sem retry (mesmo risco que `setLayoutAccent`
  já existe para prevenir). O handler de mudança de cor do `CoverEditor` aplica a
  MESMA normalização antes de chamar `onConfigChange` (hex8 → trunca pra hex6;
  inválido → ignora a mudança) — extrair um `normalizeHexColor` compartilhado entre
  `setLayoutAccent` e o novo handler é uma decisão de implementação do plano, não
  deste spec.
- Tamanho da logo: stepper +/- (mesmo visual dos botões de redimensionar bloco na
  toolbar — `rb-edit-btn` com ícones Minus/Plus), incrementos de 8px a partir do
  default de 36, clamped a [20, 68].

`EditorCanvas.tsx` ganha um branch `block.type === 'cover' && onConfigChange` (mesmo
formato do branch já existente para `section_header`) e esconde os botões +/- de
largura da toolbar quando `block.type === 'cover'` (a capa é sempre largura cheia).

## CSS (`packages/report-blocks/styles.css`)

```css
.rb-cover {
  min-height: 80vh; /* tela: editor e Hub viewer */
}
.rb-cover-splash {
  max-height: 320px; /* tela: cabe dentro da min-height sem dominar o layout */
}
@media print {
  .rb-cover {
    min-height: 277mm; /* área útil do A4 com as margens de 10mm do Gotenberg */
    break-after: page; /* mesmo mecanismo do .rb-page-break já usado pelo Divisor */
  }
  .rb-cover-splash {
    max-height: 100mm; /* garante que o resto do conteúdo + splash cabe em 277mm */
  }
}
```

**Achado do review externo, corrigido aqui:** sem esse teto, `branding.splash_url`
(já renderizado dentro do `CoverBlock` hoje, com `aspectRatio: 21/9` na largura
inteira) pode empurrar a altura total da capa além de 277mm, e o `break-after: page`
não impede o PRÓPRIO bloco de invadir a página 2 — ele só garante que o bloco
SEGUINTE nunca compartilha página com a capa. `max-height` no splash é o que
efetivamente sustenta a promessa de "capa sozinha na página 1".

Mais classes de apoio para o avatar de fallback (`.rb-cover-avatar`,
`.rb-cover-avatar-fallback`) — sem qualquer nova custom property de tema; tudo lido
via `currentColor`/herança do `--rb-cover-fg` já resolvido.

## Fora de escopo

- Tamanho do avatar como controle independente do tamanho da logo (acompanha
  `logoSize` para manter o par visualmente alinhado; YAGNI até haver pedido
  específico).
- Splash image (`branding.splash_url`) continua condicional e do mesmo jeito visual
  de hoje — a única mudança é o teto de altura (seção CSS) para não quebrar a
  página única.
- **Quantidade e posição da capa no documento — decisão explícita, não uma lacuna.**
  Achado do review externo: o catálogo permite inserir quantas capas o usuário
  quiser, em qualquer posição, e o editor permite reordenar/remover qualquer bloco
  livremente — isso já vale hoje para `section_header`/`divider`, nenhum bloco
  estrutural tem restrição de cardinalidade ou posição. Este recurso NÃO muda isso:
  cada bloco `cover`, onde quer que esteja, independentemente vira uma página cheia
  com quebra forçada depois dele. Um documento com duas capas gera duas páginas de
  capa; uma capa no meio do relatório força uma quebra de página ali. É a mesma
  liberdade de hoje, com uma consequência visual mais forte por causa da altura de
  página inteira — não uma restrição nova.

## Verificação

- `packages/report-blocks/__tests__/CoverBlock.test.tsx` (novo): defaults herdados,
  overrides de config, contraste de cor própria, fallback do avatar sem foto/com
  erro de carregamento/sem `client_name` (snapshot antigo), `logoSize` aplicado a
  logo e avatar, teto de altura do splash.
- `supabase/functions/_shared/report-docs/layout.test.ts`: novos casos para
  `cover.config.color`/`logoSize` fora dos bounds e `cover` com `size !== 'full'`.
- Nova suíte SQL em `supabase/tests/entitlements/` (mesmo arquivo/padrão usado pelo
  tema Hub) para a migration: `cover` com `size` diferente de `full` é rejeitado
  pelo trigger; `cover` com `size: 'full'` continua aceito.
- `supabase/functions/_shared/report-docs/snapshot.test.ts` +
  `supabase/functions/report-docs/snapshot-source.test.ts` (ou `generate.test.ts`,
  o que já cobrir essa montagem): `profile_picture_url` cacheado via
  `cachePostThumbnail` (sucesso e falha de download), `client_name` propagado de
  `generate.ts` e de `refresh.ts`.
- `apps/crm/src/pages/relatorio-editor/__tests__/CoverEditor.test.tsx` (novo) e
  `EditorCanvas.test.tsx`: edição de cada campo, herança ao limpar, botões de
  largura ausentes para `cover`, cor `#rrggbbaa` normalizada antes do
  `onConfigChange` (mesmo caso de teste que `layoutOps.test.ts` já tem para
  `setLayoutAccent`).
- Antes de push: os 4 `tsc`, `npm run lint`, `npm run format:check`, `npm run test`,
  `npm run test:functions` (`git checkout -- deno.lock` depois).
- Browser: capa em página inteira no editor e no Hub, PDF com a capa sozinha na
  página 1 mesmo com splash configurado, edição dos 5 controles refletindo no
  preview imediatamente, fallback de avatar com um cliente conectado mas sem foto de
  perfil no Instagram.
