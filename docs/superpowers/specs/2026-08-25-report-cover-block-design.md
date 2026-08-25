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
   convivem); fonte é a MESMA que o Hub já usa (`instagram_accounts.profile_picture_url`,
   URL estável cacheada pelo instagram-integration).
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

### `snapshot.account.profile_picture_url` (campo novo)

`supabase/functions/_shared/report-docs/snapshot.ts`: `ReportDocSnapshot.account` e
`SnapshotInput.account` ganham `profile_picture_url: string | null`.

`supabase/functions/report-docs/snapshot-source.ts`: a query a `instagram_accounts`
já roda com `select("*")` (linha ~69) — só falta repassar o campo ao montar
`assembleSnapshot({ account: { handle, specialty, profile_picture_url: account.profile_picture_url ?? null }, ... })`.
Nenhuma query nova, nenhum cache novo: é a mesma URL estável que `hub-bootstrap`
já expõe como `cliente_foto_url` (best-effort — cliente sem conta conectada ou sem
foto simplesmente recebe `null`, nunca falha a geração).

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

**Sem migration nova.** O trigger SQL `validate_report_layout()` valida a FORMA do
layout (versão, blocks é array, ids, `size` no enum, `theme`/`fonts`/`accent`
layout-level) mas nunca inspeciona `block.config` campo a campo — nem o
`top_posts.config.count` (que já existe hoje) tem contraparte no trigger. `color` e
`logoSize` seguem o MESMO precedente: validados só em TS, no cliente (antes do
autosave, mesmo raciocínio do comentário em `setLayoutAccent` sobre nunca deixar um
valor inválido ENTRAR no layout) e em qualquer chamada de `report-docs`. A regra de
`size === "full"` do cover também fica só em TS + reforçada na UI (ver abaixo) — é
uma regra de exibição, não de integridade de dado.

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
  `onError` revertendo para um círculo com a inicial do nome do workspace/cliente;
  tamanho = `config.logoSize ?? 36` (acompanha a logo); estilo memory-safe quanto a
  contraste: borda `1.5px solid currentColor` e o fallback usa fundo transparente +
  `color: inherit` — herda o MESMO `--rb-cover-fg`/cor de contraste já calculada,
  então nunca preciso computar uma segunda cor. Posição: ao lado da logo, mesma
  linha, pequeno gap.
- Full-page: `className="rb-cover"` ganha as regras novas no `styles.css` (abaixo);
  nenhuma mudança de estrutura de grid é necessária além de garantir `size: 'full'`.

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
  relatório como cor "de marca" sugerida.
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
@media print {
  .rb-cover {
    min-height: 277mm; /* área útil do A4 com as margens de 10mm do Gotenberg */
    break-after: page; /* mesmo mecanismo do .rb-page-break já usado pelo Divisor */
  }
}
```

Mais classes de apoio para o avatar de fallback (`.rb-cover-avatar`,
`.rb-cover-avatar-fallback`) — sem qualquer nova custom property de tema; tudo lido
via `currentColor`/herança do `--rb-cover-fg` já resolvido.

## Fora de escopo

- Tamanho do avatar como controle independente do tamanho da logo (acompanha
  `logoSize` para manter o par visualmente alinhado; YAGNI até haver pedido
  específico).
- Splash image (`branding.splash_url`) continua como está — não faz parte deste
  pedido.
- Nenhuma migration nova (ver seção Validação acima).

## Verificação

- `packages/report-blocks/__tests__/CoverBlock.test.tsx` (novo): defaults herdados,
  overrides de config, contraste de cor própria, fallback do avatar sem foto/com
  erro de carregamento, `logoSize` aplicado a logo e avatar.
- `supabase/functions/_shared/report-docs/layout.test.ts`: novos casos para
  `cover.config.color`/`logoSize` fora dos bounds e `cover` com `size !== 'full'`.
- `supabase/functions/_shared/report-docs/snapshot.test.ts` +
  `supabase/functions/report-docs/snapshot-source.test.ts` (ou `generate.test.ts`,
  o que já cobrir essa montagem): `profile_picture_url` chega no snapshot.
- `apps/crm/src/pages/relatorio-editor/__tests__/CoverEditor.test.tsx` (novo) e
  `EditorCanvas.test.tsx`: edição de cada campo, herança ao limpar, botões de
  largura ausentes para `cover`.
- Antes de push: os 4 `tsc`, `npm run lint`, `npm run format:check`, `npm run test`,
  `npm run test:functions` (`git checkout -- deno.lock` depois).
- Browser: capa em página inteira no editor e no Hub, PDF com a capa sozinha na
  página 1, edição dos 5 controles refletindo no preview imediatamente, fallback de
  avatar com um cliente sem Instagram conectado.
