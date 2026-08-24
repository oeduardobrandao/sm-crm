# Tema "Hub" no relatório de blocos — Plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Adicionar um quarto tema (`'hub'`) ao relatório de blocos, que renderiza o
documento com a identidade whitelabel real do Personalizar Hub do workspace —
superfície, fontes, raio e estilo de card — nos três contextos (editor, viewer do
Hub, PDF), com fallback fail-closed quando o workspace não tem a entitlement.

**Architecture:** Extrai a lógica pura de `apps/hub/src/theme.ts` para um pacote
novo `packages/hub-theme` (sem mudar comportamento do Hub), congela a config
whitelabel efetiva no `data_snapshot` do documento na geração/refresh (gate por
`feature_brand_customization`, fail-closed), e ensina `resolveReportTheme` a
derivar os tokens `--rb-*` dessa config em vez de usar um `THEME_DEFS` fixo. A
migration existente do trigger `validate_report_layout` ganha `'hub'` no enum.

**Tech Stack:** TypeScript puro (o pacote não pode ter dependências de app nem de
Deno), Deno edge functions, Postgres/plpgsql, Vitest, React 19.

## Global Constraints

- Spec de referência: `docs/superpowers/specs/2026-08-24-report-theme-hub-design.md`.
- Só a variante **light** das paletas do Hub entra no relatório. Dark do Hub fica
  fora desta v1.
- Fidelidade completa: superfície (bg/ink/border), fontes (display + body), raio
  de card e estilo de card — não só cor.
- Sem entitlement `feature_brand_customization`: relatório usa os defaults
  neutros (`neutral`, `fraunces`, `instrument-sans`, `soft`, `filled`), igual ao
  `NEUTRAL_HUB_THEME` do `hub-bootstrap`. **Fail closed**: qualquer erro da RPC
  de entitlement também degrada para os defaults neutros — nunca derruba a
  geração/refresh com um erro 500 (achado de review externo da spec; mesmo
  padrão de `supabase/functions/hub-bootstrap/handler.ts:94-101`).
- Precedência de fontes: `layout.fonts` explícito (escolha do usuário no
  popover) sempre vence a fonte do portal.
- Nenhuma mudança no pipeline legado (`_shared/report-template/*`,
  `instagram-report-generator-v2`) nem no comportamento hoje existente do Hub
  whitelabel (`apps/hub/src/theme.ts` consumers: `HubShell.tsx`, `HubPreview.tsx`,
  `HubTab.tsx`) — extração é refactor puro, byte-idêntico.
- Todo lookup em mapa por um id persistido (surface, font_display, font_body,
  radius, card_style) precisa de fallback para o default quando o id é
  desconhecido — `data_snapshot` é JSON sem tipo em runtime, e documentos
  antigos ou fonts descontinuadas não podem quebrar a renderização.
- Sem comentários explicando O QUE o código faz; só POR QUÊ quando não óbvio.
  Sem travessão em copy voltada ao usuário (regra da casa).
- Migration é forward-only (sem downgrade) — mesmo padrão do resto do projeto.
- Antes de cada `git push`/PR: `npm run lint`, `npm run format:check`, os 4
  `tsc` (`apps/crm`, `apps/hub`, `apps/admin`, `tsconfig.scripts.json`),
  `npm run test`, `npm run test:functions` (seguido de
  `git checkout -- deno.lock` — o deno test resolve carets do package.json e
  polui `node_modules/.deno`; se isso acontecer, `rm -rf node_modules/.deno &&
  npm ci` antes de rodar os gates de npm).
- Migration precisa de prefixo de versão único: reconferir
  `git ls-tree origin/main:supabase/migrations | tail` no momento de abrir o PR
  (o tail no início deste plano era `20260824000001`; a próxima migration desta
  spec usa `20260824000002`, mas se `origin/main` já tiver avançado até lá,
  renumerar para o próximo timestamp livre).

---

### Task 1: Extrair `packages/hub-theme` (refactor puro, sem mudança de comportamento)

**Files:**
- Create: `packages/hub-theme/package.json`
- Create: `packages/hub-theme/theme.ts`
- Create: `packages/hub-theme/theme.test.ts`
- Modify: `apps/hub/src/theme.ts` (vira re-export)
- Delete: `apps/hub/src/theme.test.ts` (o conteúdo migra para
  `packages/hub-theme/theme.test.ts`)

**Interfaces:**
- Produces: `packages/hub-theme/theme.ts` exporta TUDO que
  `apps/hub/src/theme.ts` exporta hoje — `HubSurface`, `HubRadius`,
  `HubCardStyle`, `HubThemeConfig`, `DEFAULT_HUB_THEME`, `HubPalette`,
  `PALETTES`, `RADIUS_CARD` (NOVO: ganha `export`, hoje é const module-local),
  `HubFontOption`, `HUB_DISPLAY_FONTS`, `HUB_BODY_FONTS`, `HUB_FONT_PAIRINGS`,
  `buildGoogleFontsHref`, `relativeLuminance`, `ResolvedHubTheme`,
  `resolveHubTheme`.

- [ ] **Step 1: Copiar o arquivo inteiro para o pacote novo**

Leia `apps/hub/src/theme.ts` (305 linhas, conteúdo atual do repo) e copie
**literalmente**, sem nenhuma alteração de lógica, para
`packages/hub-theme/theme.ts`. A ÚNICA mudança de texto permitida nesta cópia:
na declaração da const `RADIUS_CARD` (hoje sem `export`), adicionar `export`:

```ts
export const RADIUS_CARD: Record<HubRadius, string> = {
  square: '0px',
  soft: '12px',
  pill: '18px',
};
```

`RADIUS_CTL`, `CARD_BG`, `CARD_BD` continuam SEM `export` — não são consumidos
fora deste arquivo (`CARD_BG`/`CARD_BD` embutem strings `var(--hub-*)`, inúteis
fora do shell do Hub).

- [ ] **Step 2: Criar o package.json do pacote novo**

```json
{
  "name": "@mesaas/hub-theme",
  "private": true,
  "version": "0.0.0",
  "type": "module"
}
```

(Idêntico em forma a `packages/report-blocks/package.json` — sem `main`/
`exports`, resolução por caminho de arquivo direto, mesmo padrão do resto do
monorepo.)

- [ ] **Step 3: Mover o arquivo de teste**

Copie o conteúdo INTEIRO de `apps/hub/src/theme.test.ts` para
`packages/hub-theme/theme.test.ts`, trocando só a linha do import (de `'./theme'`
para `'./theme'` — o caminho relativo já funciona sem mudança, pois o arquivo de
teste fica na mesma pasta do `theme.ts` no pacote novo). Depois delete
`apps/hub/src/theme.test.ts`.

- [ ] **Step 4: Rodar o teste no novo local**

Run: `npx vitest run packages/hub-theme/theme.test.ts`
Expected: todos os testes que passavam em `apps/hub/src/theme.test.ts` passam
aqui, sem alteração de asserts.

- [ ] **Step 5: Transformar `apps/hub/src/theme.ts` em re-export**

Substitua o conteúdo INTEIRO de `apps/hub/src/theme.ts` por:

```ts
export * from '../../../packages/hub-theme/theme';
```

- [ ] **Step 6: Verificar que os consumidores existentes continuam intactos**

Run: `npx tsc -p apps/hub/tsconfig.json --noEmit`
Run: `npx tsc -p apps/crm/tsconfig.json --noEmit`

Expected: PASS nos dois — `apps/hub/src/shell/HubShell.tsx`,
`apps/crm/src/pages/configuracao/HubPreview.tsx` e
`apps/crm/src/pages/configuracao/tabs/HubTab.tsx` continuam importando de
`./theme` / `../../../../hub/src/theme` sem nenhuma mudança de import, e o
re-export resolve tudo transitivamente.

- [ ] **Step 7: Rodar a suíte completa do Hub e do CRM**

Run: `npm run test -- apps/hub apps/crm/src/pages/configuracao`
Expected: PASS. Nenhum teste do Personalizar Hub ou do preview do CRM quebra.

- [ ] **Step 8: Commit**

```bash
git add packages/hub-theme apps/hub/src/theme.ts apps/hub/src/theme.test.ts
git commit -m "refactor(hub-theme): extrai apps/hub/src/theme.ts para packages/hub-theme"
```

---

### Task 2: `buildGoogleFontsHref` ganha o parâmetro `includeDefaults`

**Files:**
- Modify: `packages/hub-theme/theme.ts` (função `buildGoogleFontsHref`)
- Test: `packages/hub-theme/theme.test.ts`

**Interfaces:**
- Consumes: `HUB_DISPLAY_FONTS`, `HUB_BODY_FONTS`, `DEFAULT_DISPLAY_ID`,
  `DEFAULT_BODY_ID` (já existem no arquivo, de Task 1).
- Produces: `buildGoogleFontsHref(displayId: string, bodyId: string, opts?: {
  includeDefaults?: boolean }): string | null` — assinatura nova, backward
  compatible (terceiro parâmetro opcional).

**Motivo**: o Hub shell já carrega Fraunces + Instrument Sans no
`index.html`, então `buildGoogleFontsHref` pula essas duas famílias quando são
as escolhidas (evita link duplicado). O editor do CRM e a página de print do
relatório NÃO carregam essas fontes por padrão — o tema Hub no relatório
precisa do link completo mesmo quando a dupla escolhida é a default.

- [ ] **Step 1: Escrever os testes que faltam (novos, além dos existentes)**

Adicione a `packages/hub-theme/theme.test.ts`, dentro do `describe('buildGoogleFontsHref'` já existente:

```ts
it('includeDefaults: true inclui as familias padrao mesmo quando sao as escolhidas', () => {
  expect(buildGoogleFontsHref('fraunces', 'instrument-sans', { includeDefaults: true })).toBe(
    'https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400;9..144,500;9..144,600;9..144,700&family=Instrument+Sans:wght@400;500;600;700&display=swap',
  );
});

it('includeDefaults: true com IDs desconhecidos ainda cai nos defaults e os inclui', () => {
  expect(buildGoogleFontsHref('comic-sans', 'papyrus', { includeDefaults: true })).toBe(
    'https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400;9..144,500;9..144,600;9..144,700&family=Instrument+Sans:wght@400;500;600;700&display=swap',
  );
});

it('includeDefaults ausente ou false preserva o comportamento atual (sem regressao)', () => {
  expect(buildGoogleFontsHref('fraunces', 'instrument-sans')).toBeNull();
  expect(buildGoogleFontsHref('fraunces', 'instrument-sans', {})).toBeNull();
  expect(buildGoogleFontsHref('fraunces', 'instrument-sans', { includeDefaults: false })).toBeNull();
});
```

- [ ] **Step 2: Rodar os testes novos para confirmar que falham**

Run: `npx vitest run packages/hub-theme/theme.test.ts -t "includeDefaults"`
Expected: FAIL — `buildGoogleFontsHref` ainda não aceita um terceiro
parâmetro (TypeScript vai reclamar de excesso de argumentos, ou em runtime o
resultado não bate porque o terceiro argumento é ignorado).

- [ ] **Step 3: Implementar**

Troque a implementação atual de `buildGoogleFontsHref` por:

```ts
export function buildGoogleFontsHref(
  displayId: string,
  bodyId: string,
  opts?: { includeDefaults?: boolean },
): string | null {
  const includeDefaults = opts?.includeDefaults ?? false;
  const gfs: string[] = [];

  const display = HUB_DISPLAY_FONTS[displayId] ?? HUB_DISPLAY_FONTS[DEFAULT_DISPLAY_ID];
  if (includeDefaults || displayId !== DEFAULT_DISPLAY_ID) gfs.push(display.gf);

  const body = HUB_BODY_FONTS[bodyId] ?? HUB_BODY_FONTS[DEFAULT_BODY_ID];
  if (includeDefaults || bodyId !== DEFAULT_BODY_ID) gfs.push(body.gf);

  if (gfs.length === 0) return null;

  return `https://fonts.googleapis.com/css2?${gfs.map((gf) => `family=${gf}`).join('&')}&display=swap`;
}
```

Note a mudança sutil necessária para o caso "IDs desconhecidos com
includeDefaults": a implementação ATUAL só empurra `display.gf`/`body.gf`
quando `display`/`body` existe no mapa (`if (displayId !== DEFAULT_DISPLAY_ID
&& display)`) — um id desconhecido como `'comic-sans'` faz `display` ser
`undefined` e a família é silenciosamente omitida. A nova versão resolve
`display`/`body` com fallback (`?? HUB_DISPLAY_FONTS[DEFAULT_DISPLAY_ID]`)
ANTES de decidir se inclui, então um id desconhecido com `includeDefaults:
true` inclui a família PADRÃO (Fraunces/Instrument Sans), que é o
comportamento correto pedido pelo teste do Step 1. Sem `includeDefaults`, o
comportamento observável não muda: um id desconhecido ainda resolve para o
default, e `id !== DEFAULT_ID` ainda é `true` (porque o id desconhecido, ex.
`'comic-sans'`, nunca é igual à string `DEFAULT_DISPLAY_ID`), então a família
padrão ainda entra no href — IDÊNTICO ao teste já existente
`'unknown ids are treated as defaults'` (linha ~313 do arquivo atual).

- [ ] **Step 4: Rodar todos os testes de `buildGoogleFontsHref`**

Run: `npx vitest run packages/hub-theme/theme.test.ts -t "buildGoogleFontsHref"`
Expected: PASS — os 5 testes antigos (`returns null for the defaults`, `custom
display only`, `custom body only`, `both custom`, `unknown ids are treated as
defaults`) E os 3 novos do Step 1.

- [ ] **Step 5: Rodar a suíte inteira do pacote**

Run: `npx vitest run packages/hub-theme/theme.test.ts`
Expected: PASS, sem nenhuma regressão nos outros describes do arquivo.

- [ ] **Step 6: Commit**

```bash
git add packages/hub-theme/theme.ts packages/hub-theme/theme.test.ts
git commit -m "feat(hub-theme): buildGoogleFontsHref aceita includeDefaults para consumidores sem os padroes pre-carregados"
```

---

### Task 3: Schema — `theme: 'hub'` no layout e `SnapshotHubTheme` no snapshot

**Files:**
- Modify: `supabase/functions/_shared/report-docs/layout.ts`
- Modify: `supabase/functions/_shared/report-docs/snapshot.ts`
- Modify: `packages/report-blocks/types.ts`
- Test: `packages/report-blocks/__tests__/theme.test.ts` (só a parte de smoke
  do enum; o resolvedor em si é Task 5)
- Test: `supabase/functions/_shared/report-docs/snapshot.test.ts`

**Interfaces:**
- Consumes: nada de tasks anteriores (esta task é pura definição de tipos/schema).
- Produces:
  - `REPORT_THEME_IDS = ["clean", "editorial", "bold", "hub"] as const` em
    `layout.ts`, re-exportado sem mudança de nome por `packages/report-blocks/types.ts`.
  - `export interface SnapshotHubTheme { surface: "neutral" | "warm" | "cool";
    font_display: string; font_body: string; radius: "square" | "soft" |
    "pill"; card_style: "filled" | "outline" | "tonal"; }` em `snapshot.ts`.
  - `SnapshotBranding.hub_theme?: SnapshotHubTheme` (campo opcional — snapshots
    antigos não têm).
  - `packages/report-blocks/types.ts` re-exporta `SnapshotHubTheme` ao lado dos
    demais tipos de snapshot.

- [ ] **Step 1: Escrever o teste do enum estendido**

Em `packages/report-blocks/__tests__/theme.test.ts`, adicione dentro do
`describe('temas explícitos'` já existente:

```ts
it('REPORT_THEME_IDS inclui hub ao lado dos temas fixos', () => {
  expect([...REPORT_THEME_IDS]).toEqual(['clean', 'editorial', 'bold', 'hub']);
});
```

`REPORT_THEME_IDS` é um valor (array), não um tipo, então NÃO cabe na linha
`import type { ReportLayout } from '../types';` já existente no topo do
arquivo. Adicione uma linha de import nova, separada:

```ts
import { REPORT_THEME_IDS } from '../types';
```

- [ ] **Step 2: Escrever o teste do campo opcional no snapshot**

`snapshot.test.ts` usa `Deno.test` + `assert`/`assertEquals` de
`https://deno.land/std@0.208.0/assert/mod.ts` (NÃO é Vitest). Adicione ao
final de `supabase/functions/_shared/report-docs/snapshot.test.ts`, replicando
a MESMA shape de `kpiSources` vazio que o segundo teste do arquivo já usa
(`allPosts: [], prevMonthPosts: null, currSnapshot: null, prevSnapshot: null,
prevPrevSnapshot: null, followerHistory: [], accountViews: null`):

```ts
Deno.test("aceita branding.hub_theme opcional sem quebrar o assembleSnapshot", () => {
  const snap = assembleSnapshot({
    month: "2026-08",
    account: { handle: "x", specialty: "" },
    branding: {
      workspace_name: "W", logo_url: null, splash_url: null, accent_color: "#000",
      hub_theme: {
        surface: "warm", font_display: "sora", font_body: "manrope",
        radius: "pill", card_style: "outline",
      },
    },
    kpiSources: {
      allPosts: [], prevMonthPosts: null, currSnapshot: null, prevSnapshot: null,
      prevPrevSnapshot: null, followerHistory: [], accountViews: null,
    },
    followerTrend: [],
    posts: [],
    stableThumbnails: new Map(),
    audience: null,
    bestTimes: [],
    tagsPerformance: [],
  });
  assertEquals(snap.branding.hub_theme?.surface, "warm");
  assertEquals(snap.branding.hub_theme?.card_style, "outline");
});
```

- [ ] **Step 3: Rodar os dois testes para confirmar que falham**

Run: `npx vitest run packages/report-blocks/__tests__/theme.test.ts -t "REPORT_THEME_IDS inclui hub"`
Run: `deno test --allow-env supabase/functions/_shared/report-docs/snapshot.test.ts`
Expected: FAIL nos dois — `REPORT_THEME_IDS` ainda não tem `'hub'`, e
`branding.hub_theme` ainda não é uma propriedade reconhecida por TypeScript
(erro de excesso de propriedade no objeto literal do teste novo).

- [ ] **Step 4: Implementar em `layout.ts`**

Em `supabase/functions/_shared/report-docs/layout.ts:28`, troque:

```ts
export const REPORT_THEME_IDS = ["clean", "editorial", "bold"] as const;
```

por:

```ts
export const REPORT_THEME_IDS = ["clean", "editorial", "bold", "hub"] as const;
```

`validateLayout` já valida `theme` contra `REPORT_THEME_IDS` genericamente
(linha ~89), então nenhuma outra mudança é necessária nesse arquivo.

- [ ] **Step 5: Implementar em `snapshot.ts`**

Em `supabase/functions/_shared/report-docs/snapshot.ts`, logo antes da
interface `SnapshotBranding` (linha ~13), adicione:

```ts
export interface SnapshotHubTheme {
  surface: "neutral" | "warm" | "cool";
  font_display: string;
  font_body: string;
  radius: "square" | "soft" | "pill";
  card_style: "filled" | "outline" | "tonal";
}
```

E dentro de `SnapshotBranding`, adicione o campo opcional:

```ts
export interface SnapshotBranding {
  workspace_name: string;
  logo_url: string | null;
  splash_url: string | null;
  accent_color: string;
  hub_theme?: SnapshotHubTheme;
}
```

`assembleSnapshot` já repassa `input.branding` inteiro para `branding:
input.branding` (linha ~174 do arquivo) — nenhuma mudança de lógica é
necessária ali, o campo novo viaja de graça.

- [ ] **Step 6: Re-exportar em `packages/report-blocks/types.ts`**

Adicione `SnapshotHubTheme` ao bloco de re-export de tipos de snapshot:

```ts
export type {
  ReportDocSnapshot,
  SnapshotBranding,
  SnapshotContentBreakdown,
  SnapshotFormatStats,
  SnapshotHubTheme,
  SnapshotTopPost,
} from '../../supabase/functions/_shared/report-docs/snapshot';
```

- [ ] **Step 7: Rodar os testes**

Run: `npx vitest run packages/report-blocks/__tests__/theme.test.ts`
Run: `deno test --allow-env supabase/functions/_shared/report-docs/snapshot.test.ts`
Expected: PASS nos dois, incluindo os dois testes novos do Step 1/2. Rode
`git checkout -- deno.lock` depois do `deno test` (regra da casa: deno
resolve os carets do package.json e polui `node_modules/.deno`).

- [ ] **Step 8: tsc dos dois projetos que tocam esses arquivos**

Run: `npx tsc -p apps/crm/tsconfig.json --noEmit`
Run: `npx tsc -p apps/hub/tsconfig.json --noEmit`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add supabase/functions/_shared/report-docs/layout.ts \
  supabase/functions/_shared/report-docs/snapshot.ts \
  supabase/functions/_shared/report-docs/snapshot.test.ts \
  packages/report-blocks/types.ts \
  packages/report-blocks/__tests__/theme.test.ts
git commit -m "feat(relatorios): theme 'hub' no enum de layout e SnapshotHubTheme no schema do snapshot"
```

---

### Task 4: Congelar a config whitelabel no snapshot (fail-closed)

**Files:**
- Modify: `supabase/functions/report-docs/snapshot-source.ts`
- Modify: `supabase/functions/report-docs/generate.test.ts` (extensão do
  `makeDb` compartilhado + 3 testes novos)

**Interfaces:**
- Consumes: `SnapshotHubTheme` (Task 3, de `_shared/report-docs/snapshot.ts`);
  `effectivePlanFeature` (já importado em `generate.ts`, de
  `_shared/entitlements-rpc.ts`).
- Produces: `loadClientSnapshot` (assinatura inalterada) agora popula
  `branding.hub_theme` no snapshot retornado, condicionado à entitlement
  `feature_brand_customization`. Tanto `generateReportDocument` quanto
  `refreshReportDocument` chamam `loadClientSnapshot` (confirmado em
  `generate.ts:90-92` e `refresh.ts:27-30`), então este é o ÚNICO ponto de
  gate — nenhuma mudança é necessária em `generate.ts` ou `refresh.ts`.
  `refresh.test.ts` NÃO precisa de testes novos (cobriria a MESMA função sob
  teste que `generate.test.ts` já exercita) — só precisa continuar passando
  sem alteração, verificado no Step 6.

**Nota sobre o arquivo de teste**: `generate.test.ts` usa `Deno.test` +
`assert`/`assertEquals` de `https://deno.land/std@0.208.0/assert/mod.ts` (NÃO
é Vitest, NÃO existe `expect()`/`it()` neste arquivo). O `makeDb(rows, opts)`
compartilhado (linhas 8-48) tem hoje `opts.feature?: boolean` que controla o
retorno da RPC `effective_plan_feature` de forma ÚNICA para qualquer chamada
— não distingue por `feature_key`. Como esta task introduz uma SEGUNDA
checagem de entitlement (`feature_brand_customization`, ao lado da já
existente `feature_analytics_reports`), o mock precisa aprender a diferenciar
por chave antes que os 3 testes novos façam sentido.

- [ ] **Step 1: Estender o `makeDb` compartilhado para distinguir feature keys**

Em `supabase/functions/report-docs/generate.test.ts`, troque a assinatura de
`opts` (linha 10) de:

```ts
  opts: { feature?: boolean; errors?: Record<string, { message: string }> } = {},
```

para:

```ts
  opts: {
    feature?: boolean;
    errors?: Record<string, { message: string }>;
    featureByKey?: Record<string, boolean>;
    featureErrors?: Record<string, { message: string }>;
  } = {},
```

E troque o corpo de `rpc` (linhas 40-45) de:

```ts
    rpc: (name: string, args: Record<string, unknown> = {}) => {
      rpcCalls.push({ name, args });
      return name === "effective_plan_feature"
        ? Promise.resolve({ data: opts.feature ?? true, error: null })
        : Promise.resolve({ data: [], error: null });
    },
```

para:

```ts
    rpc: (name: string, args: Record<string, unknown> = {}) => {
      rpcCalls.push({ name, args });
      if (name === "effective_plan_feature") {
        const key = args.feature_key as string;
        if (opts.featureErrors?.[key]) {
          return Promise.resolve({ data: null, error: opts.featureErrors[key] });
        }
        return Promise.resolve({ data: opts.featureByKey?.[key] ?? opts.feature ?? true, error: null });
      }
      return Promise.resolve({ data: [], error: null });
    },
```

Nenhum teste existente passa `opts.feature` hoje (confirmado: os 11 testes
atuais do arquivo chamam `makeDb(rows)` ou `makeDb(rows, { errors: {...} })`,
nunca `{ feature: ... }`), então o default `opts.feature ?? true` preserva o
comportamento de todos eles sem mudança.

- [ ] **Step 2: Rodar a suíte atual para confirmar zero regressão da extensão do mock**

Run: `deno test --allow-env supabase/functions/report-docs/generate.test.ts`
Expected: os 11 testes que já existiam continuam PASS, byte a byte (a
extensão do Step 1 é aditiva).

- [ ] **Step 3: Escrever os 3 testes novos**

Adicione ao final de `generate.test.ts`:

```ts
Deno.test("com feature_brand_customization ativa, o snapshot carrega hub_theme das colunas do workspace", async () => {
  const db = makeDb({
    clientes: { id: 1, conta_id: "c", nome: "X", especialidade: "Derma", include_ai_analysis: false },
    instagram_accounts: { id: "ig-1", username: "dra.x", follower_count: 100 },
    instagram_posts: [],
    instagram_follower_history: [],
    instagram_analytics_cache: null,
    instagram_account_metrics_daily: [],
    workspaces: {
      name: "DK", logo_url: null, brand_color: "#123456", report_splash_url: null,
      hub_surface_theme: "warm", hub_font_display: "sora", hub_font_body: "manrope",
      hub_radius: "pill", hub_card_style: "outline",
    },
  }, { featureByKey: { feature_analytics_reports: true, feature_brand_customization: true } });
  await generateReportDocument(db, deps, "c", 1, "2026-07", null);
  const row = db.inserts[0] as { data_snapshot: { branding: { hub_theme?: unknown } } };
  assertEquals(row.data_snapshot.branding.hub_theme, {
    surface: "warm", font_display: "sora", font_body: "manrope",
    radius: "pill", card_style: "outline",
  });
});

Deno.test("sem feature_brand_customization, o snapshot usa os defaults neutros mesmo com colunas customizadas", async () => {
  const db = makeDb({
    clientes: { id: 1, conta_id: "c", nome: "X", especialidade: "Derma", include_ai_analysis: false },
    instagram_accounts: { id: "ig-1", username: "dra.x", follower_count: 100 },
    instagram_posts: [],
    instagram_follower_history: [],
    instagram_analytics_cache: null,
    instagram_account_metrics_daily: [],
    workspaces: {
      name: "DK", logo_url: null, brand_color: "#123456", report_splash_url: null,
      hub_surface_theme: "warm", hub_font_display: "sora", hub_font_body: "manrope",
      hub_radius: "pill", hub_card_style: "outline",
    },
  }, { featureByKey: { feature_analytics_reports: true, feature_brand_customization: false } });
  await generateReportDocument(db, deps, "c", 1, "2026-07", null);
  const row = db.inserts[0] as { data_snapshot: { branding: { hub_theme?: unknown } } };
  assertEquals(row.data_snapshot.branding.hub_theme, {
    surface: "neutral", font_display: "fraunces", font_body: "instrument-sans",
    radius: "soft", card_style: "filled",
  });
});

Deno.test("erro na RPC de feature_brand_customization degrada para os defaults neutros, sem lançar", async () => {
  const db = makeDb({
    clientes: { id: 1, conta_id: "c", nome: "X", especialidade: "Derma", include_ai_analysis: false },
    instagram_accounts: { id: "ig-1", username: "dra.x", follower_count: 100 },
    instagram_posts: [],
    instagram_follower_history: [],
    instagram_analytics_cache: null,
    instagram_account_metrics_daily: [],
    workspaces: {
      name: "DK", logo_url: null, brand_color: "#123456", report_splash_url: null,
      hub_surface_theme: "warm", hub_font_display: "sora", hub_font_body: "manrope",
      hub_radius: "pill", hub_card_style: "outline",
    },
  }, {
    featureByKey: { feature_analytics_reports: true },
    featureErrors: { feature_brand_customization: { message: "rpc indisponivel" } },
  });
  const { id } = await generateReportDocument(db, deps, "c", 1, "2026-07", null);
  assertEquals(id, "doc-1");
  const row = db.inserts[0] as { status: string; data_snapshot: { branding: { hub_theme?: { surface?: string } } } };
  assertEquals(row.status, "ready");
  assertEquals(row.data_snapshot.branding.hub_theme?.surface, "neutral");
});
```

- [ ] **Step 4: Rodar os 3 testes para confirmar que falham**

Run: `deno test --allow-env supabase/functions/report-docs/generate.test.ts`
Expected: FAIL nos 3 novos — `hub_theme` ainda não existe no snapshot
(`row.data_snapshot.branding.hub_theme` é `undefined`).

- [ ] **Step 5: Implementar em `snapshot-source.ts`**

No topo do arquivo, adicione o import:

```ts
import { effectivePlanFeature } from "../_shared/entitlements-rpc.ts";
```

Troque a linha do select de `workspaces` (linha 130):

```ts
    db.from("workspaces").select("name, logo_url, brand_color, report_splash_url")
      .eq("id", contaId).single(),
```

por:

```ts
    db.from("workspaces").select(
      "name, logo_url, brand_color, report_splash_url, hub_surface_theme, " +
        "hub_font_display, hub_font_body, hub_radius, hub_card_style",
    ).eq("id", contaId).single(),
```

Depois do bloco de `warnQueryError(...)` (antes da montagem de `const posts`
ou logo após, num ponto qualquer antes de `assembleSnapshot`), adicione:

```ts
  // Fail closed, mesmo padrão de defesa em profundidade de
  // hub-bootstrap/handler.ts:94-101: uma soluco na RPC de entitlements nunca
  // pode fazer a geracao do relatorio falhar -- so degrada o visual para o
  // neutro.
  let hubBrandCustomization = false;
  try {
    hubBrandCustomization = await effectivePlanFeature(db, contaId, "feature_brand_customization");
  } catch {
    // fail closed
  }
  const hubTheme: SnapshotHubTheme = hubBrandCustomization
    ? {
      surface: ws?.hub_surface_theme ?? "neutral",
      font_display: ws?.hub_font_display ?? "fraunces",
      font_body: ws?.hub_font_body ?? "instrument-sans",
      radius: ws?.hub_radius ?? "soft",
      card_style: ws?.hub_card_style ?? "filled",
    }
    : {
      surface: "neutral", font_display: "fraunces", font_body: "instrument-sans",
      radius: "soft", card_style: "filled",
    };
```

Import `SnapshotHubTheme` do mesmo lugar de onde `ReportDocSnapshot` já é
importado no topo do arquivo (`"../_shared/report-docs/snapshot.ts"`).

Na chamada de `assembleSnapshot({...})`, dentro do objeto `branding:`,
adicione o campo:

```ts
    branding: {
      workspace_name: ws?.name ?? "Mesaas",
      logo_url: ws?.logo_url ?? null,
      splash_url: ws?.report_splash_url ?? null,
      accent_color: ws?.brand_color ?? "#171717",
      hub_theme: hubTheme,
    },
```

Note que `hubTheme` é escrito INCONDICIONALMENTE (não é `?:` opcional na
escrita) — o campo só é opcional no TIPO para tolerar snapshots ANTIGOS lidos
de volta do banco (documentos gerados antes desta task). Toda geração/refresh
NOVA a partir de agora sempre popula `hub_theme`.

- [ ] **Step 6: Rodar os testes de generate e refresh**

Run: `deno test --allow-env supabase/functions/report-docs/generate.test.ts supabase/functions/report-docs/refresh.test.ts`
Expected: PASS em todos, incluindo os 3 novos de `generate.test.ts`. Os testes
de `refresh.test.ts` continuam passando sem NENHUMA alteração naquele
arquivo: seu `makeDb` próprio usa o mesmo stub `chain(...)` que ignora
qualquer argumento passado a `.select(...)` (retorna sempre o valor
pré-configurado de `rows[table]`, não importa quais colunas foram pedidas), e
`refreshReportDocument` chama o MESMO `loadClientSnapshot` já validado pelos
testes de `generate.test.ts` — não há necessidade de duplicar cobertura de
`hub_theme` neste arquivo.

- [ ] **Step 7: Limpar o deno.lock**

Run: `git checkout -- deno.lock`

- [ ] **Step 8: Commit**

```bash
git add supabase/functions/report-docs/snapshot-source.ts \
  supabase/functions/report-docs/generate.test.ts \
  supabase/functions/report-docs/refresh.test.ts
git commit -m "feat(relatorios): congela a config whitelabel do Hub no snapshot, fail-closed por entitlement"
```

---

### Task 5: Resolvedor — tema `'hub'` deriva os tokens da config whitelabel

**Files:**
- Modify: `packages/report-blocks/theme.ts`
- Test: `packages/report-blocks/__tests__/theme.test.ts`

**Interfaces:**
- Consumes: `PALETTES`, `RADIUS_CARD`, `HUB_DISPLAY_FONTS`, `HUB_BODY_FONTS`,
  `buildGoogleFontsHref` de `../hub-theme/theme` (Tasks 1-2); `SnapshotHubTheme`
  de `./types` (Task 3); `snapshot.branding.hub_theme` (Task 4).
- Produces: `resolveReportTheme` trata `theme === 'hub'` como um quarto ramo,
  ao lado do `if (theme) { const def = THEME_DEFS[theme]; ... }` que já existe
  — sem mudar o comportamento dos três temas fixos nem do herdado.

- [ ] **Step 1: Escrever os testes do tema hub**

Adicione `SnapshotHubTheme` ao import de tipos já existente no topo de
`packages/report-blocks/__tests__/theme.test.ts` (a Task 3 já adicionou
`REPORT_THEME_IDS` ali; a linha deve ficar
`import type { ReportLayout, SnapshotHubTheme } from '../types';`).

Adicione um novo describe ao final do arquivo (após o describe `'fontes'`):

```ts
describe('tema hub (deriva da config whitelabel do portal)', () => {
  const hubSnapshot = (hub_theme: SnapshotHubTheme) =>
    makeSnapshotFixture({
      branding: {
        workspace_name: 'W', logo_url: null, splash_url: null, accent_color: '#7c3aed',
        hub_theme,
      },
    });

  it('mapeia superficie, radius e card style filled para os tokens do relatorio', () => {
    const t = resolveReportTheme(
      layout({ theme: 'hub' }),
      hubSnapshot({ surface: 'neutral', font_display: 'fraunces', font_body: 'instrument-sans', radius: 'soft', card_style: 'filled' }),
    );
    expect(t.vars['--rb-bg']).toBe('#FAFAFA');
    expect(t.vars['--rb-ink']).toBe('#171717');
    expect(t.vars['--rb-border']).toBe('rgba(0,0,0,.08)');
    expect(t.vars['--rb-radius']).toBe('12px');
    expect(t.vars['--rb-surface']).toBe('#FFFFFF');
    expect(t.themeClass).toBe('rb-theme-hub');
  });

  it('card style outline usa a borda mais forte e superficie transparente', () => {
    const t = resolveReportTheme(
      layout({ theme: 'hub' }),
      hubSnapshot({ surface: 'neutral', font_display: 'fraunces', font_body: 'instrument-sans', radius: 'soft', card_style: 'outline' }),
    );
    expect(t.vars['--rb-border']).toBe('rgba(0,0,0,.2)');
    expect(t.vars['--rb-surface']).toBe('transparent');
  });

  it('card style tonal usa o soft da paleta como superficie', () => {
    const t = resolveReportTheme(
      layout({ theme: 'hub' }),
      hubSnapshot({ surface: 'warm', font_display: 'fraunces', font_body: 'instrument-sans', radius: 'soft', card_style: 'tonal' }),
    );
    expect(t.vars['--rb-surface']).toBe('#F3EEE7');
  });

  it('superficie warm e cool usam a paleta light correspondente', () => {
    const warm = resolveReportTheme(layout({ theme: 'hub' }), hubSnapshot({ surface: 'warm', font_display: 'fraunces', font_body: 'instrument-sans', radius: 'soft', card_style: 'filled' }));
    expect(warm.vars['--rb-bg']).toBe('#FAF7F2');
    const cool = resolveReportTheme(layout({ theme: 'hub' }), hubSnapshot({ surface: 'cool', font_display: 'fraunces', font_body: 'instrument-sans', radius: 'soft', card_style: 'filled' }));
    expect(cool.vars['--rb-bg']).toBe('#F7F9FB');
  });

  it('fontes do hub entram com includeDefaults quando layout.fonts esta ausente', () => {
    const t = resolveReportTheme(
      layout({ theme: 'hub' }),
      hubSnapshot({ surface: 'neutral', font_display: 'space-grotesk', font_body: 'manrope', radius: 'soft', card_style: 'filled' }),
    );
    expect(t.vars['--rb-font-display']).toContain('Space Grotesk');
    expect(t.vars['--rb-font-body']).toContain('Manrope');
    expect(t.fontHref).toContain('Space+Grotesk');
  });

  it('layout.fonts explicito vence a fonte do hub', () => {
    const t = resolveReportTheme(
      layout({ theme: 'hub', fonts: 'playfair' }),
      hubSnapshot({ surface: 'neutral', font_display: 'space-grotesk', font_body: 'manrope', radius: 'soft', card_style: 'filled' }),
    );
    expect(t.vars['--rb-font-display']).toContain('Playfair');
  });

  it('snapshot antigo sem hub_theme cai nos defaults neutros sem lancar', () => {
    const t = resolveReportTheme(layout({ theme: 'hub' }), makeSnapshotFixture());
    expect(t.vars['--rb-bg']).toBe('#FAFAFA');
    expect(t.vars['--rb-radius']).toBe('12px');
  });

  it('ids desconhecidos persistidos (surface/fonte/radius) caem nos defaults sem lancar', () => {
    const t = resolveReportTheme(
      layout({ theme: 'hub' }),
      hubSnapshot({ surface: 'galaxy', font_display: 'comic-sans', font_body: 'papyrus', radius: 'huge', card_style: 'glassy' } as any),
    );
    expect(t.vars['--rb-bg']).toBe('#FAFAFA');
    expect(t.vars['--rb-radius']).toBe('12px');
    expect(t.vars['--rb-surface']).toBe('#FFFFFF');
  });

  it('accent deriva accent-text/accent-line contra o bg do hub, sem tokens de capa/secao', () => {
    const t = resolveReportTheme(
      layout({ theme: 'hub' }),
      hubSnapshot({ surface: 'neutral', font_display: 'fraunces', font_body: 'instrument-sans', radius: 'soft', card_style: 'filled' }),
    );
    expect(contrastRatio(t.vars['--rb-accent-text'], t.vars['--rb-bg'])).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(t.vars['--rb-accent-line'], t.vars['--rb-bg'])).toBeGreaterThanOrEqual(3.0);
    expect(t.vars['--rb-cover-bg']).toBeUndefined();
    expect(t.vars['--rb-section-title']).toBeUndefined();
  });
});
```

Adicione `contrastRatio` ao import já existente no topo do arquivo se ainda
não estiver importado (já está, é usado em outros describes).

- [ ] **Step 2: Rodar os testes para confirmar que falham**

Run: `npx vitest run packages/report-blocks/__tests__/theme.test.ts -t "tema hub"`
Expected: FAIL — `resolveReportTheme` ainda não reconhece `theme: 'hub'`
(cai no branch `else` do herdado hoje, porque o guard de enum de Task 3 já
aceita `'hub'` como válido, mas `THEME_DEFS['hub']` é `undefined` e o código
atual só tem um `if (theme) { const def = THEME_DEFS[theme]; ... }`, que
quebraria ao indexar `THEME_DEFS['hub']` — os testes vão falhar por
`def.bg`/etc. ser `undefined`, não por um crash controlado, o que confirma que
o branch novo ainda não existe).

- [ ] **Step 3: Implementar**

No topo de `packages/report-blocks/theme.ts`, adicione o import (caminho
relativo cru, pacote irmão, mesmo precedente de `types.ts`):

```ts
import {
  PALETTES, RADIUS_CARD, HUB_DISPLAY_FONTS, HUB_BODY_FONTS, buildGoogleFontsHref,
} from '../hub-theme/theme';
```

Adicione `SnapshotHubTheme` ao import de tipos já existente de `'./types'`
(hoje é `import type { ReportDocSnapshot, ReportLayout } from './types';`):

```ts
import type { ReportDocSnapshot, ReportLayout, SnapshotHubTheme } from './types';
```

Adicione, ao lado de `THEME_DEFS` (antes de `resolveReportTheme`):

```ts
const HUB_DEFAULT_THEME: SnapshotHubTheme = {
  surface: 'neutral', font_display: 'fraunces', font_body: 'instrument-sans',
  radius: 'soft', card_style: 'filled',
};
```

**IMPORTANTE — armadilha de tipo**: `theme` é inferido como `ReportThemeId |
undefined`, e `ReportThemeId` agora inclui `'hub'` (Task 3). O `if (theme) {
const def = THEME_DEFS[theme]; ... }` que já existe no arquivo QUEBRA a
compilação se `'hub'` entrar nesse branch sem antes ser excluído — `THEME_DEFS`
é `Record<'clean' | 'editorial' | 'bold', ThemeDef>` e não tem chave `'hub'`.
A solução é um branch PRÓPRIO para `'hub'`, ANTES do `if (theme)` existente,
para que TypeScript estreite `theme` corretamente no branch seguinte. Troque o
corpo INTEIRO de `resolveReportTheme` (do `export function resolveReportTheme`
até o `}` de fechamento) por:

```ts
export function resolveReportTheme(layout: ReportLayout, snapshot: ReportDocSnapshot): ReportTheme {
  const acc = clampAccent(layout.accent ?? snapshot.branding.accent_color);
  const theme = (REPORT_THEME_IDS as readonly unknown[]).includes(layout.theme)
    ? layout.theme
    : undefined;
  const fonts = (REPORT_FONT_IDS as readonly unknown[]).includes(layout.fonts)
    ? layout.fonts
    : undefined;

  const vars: Record<string, string> = { '--rb-accent': acc };
  let fontHref: string | null = null;

  if (theme === 'hub') {
    // Deriva do Personalizar Hub do workspace (congelado no snapshot na
    // geração/refresh, Task 4) em vez de um THEME_DEFS fixo -- branch próprio
    // porque THEME_DEFS não tem entrada 'hub' e porque a fonte vem de um
    // mapa de 6+5 opções, não de FONT_PAIRINGS. Cada lookup por id
    // persistido cai no default quando o valor é desconhecido: data_snapshot
    // é JSON sem tipo em runtime, e um documento antigo (ou uma fonte do
    // Hub descontinuada) não pode quebrar a renderização.
    const hubCfg = snapshot.branding.hub_theme ?? HUB_DEFAULT_THEME;
    const palette = PALETTES[hubCfg.surface]?.light ?? PALETTES.neutral.light;
    const bg = palette.bg;
    const ink = palette.txt;
    const border = hubCfg.card_style === 'outline' ? palette.bd2 : palette.bd;
    const radius = RADIUS_CARD[hubCfg.radius] ?? RADIUS_CARD.soft;
    const surface =
      hubCfg.card_style === 'outline' ? 'transparent'
      : hubCfg.card_style === 'tonal' ? palette.soft
      : palette.card;
    const soft = mixHex(acc, bg, 0.9);
    const accentFg = pickAccentFg(acc, ink);
    const accentText = deriveAccentText(acc, bg, ink);
    vars['--rb-accent-fg'] = accentFg;
    vars['--rb-accent-text'] = accentText;
    vars['--rb-accent-line'] = deriveAccentLine(acc, bg, ink);
    vars['--rb-bg'] = bg;
    vars['--rb-ink'] = ink;
    vars['--rb-ink-soft'] = palette.tx2;
    vars['--rb-border'] = border;
    vars['--rb-radius'] = radius;
    vars['--rb-soft'] = soft;
    vars['--rb-surface'] = surface;
    if (!fonts) {
      const fontDisplay = HUB_DISPLAY_FONTS[hubCfg.font_display] ?? HUB_DISPLAY_FONTS.fraunces;
      const fontBody = HUB_BODY_FONTS[hubCfg.font_body] ?? HUB_BODY_FONTS['instrument-sans'];
      vars['--rb-font-display'] = fontDisplay.css;
      vars['--rb-font-body'] = fontBody.css;
      fontHref = buildGoogleFontsHref(hubCfg.font_display, hubCfg.font_body, { includeDefaults: true });
    }
  } else if (theme) {
    const def = THEME_DEFS[theme];
    const soft = mixHex(acc, def.bg, 0.9);
    const accentFg = pickAccentFg(acc, def.ink);
    const accentText = deriveAccentText(acc, def.bg, def.ink);
    vars['--rb-accent-fg'] = accentFg;
    vars['--rb-accent-text'] = accentText;
    vars['--rb-accent-line'] = deriveAccentLine(acc, def.bg, def.ink);
    vars['--rb-bg'] = def.bg;
    vars['--rb-ink'] = def.ink;
    vars['--rb-ink-soft'] = def.inkSoft;
    vars['--rb-border'] = def.border;
    vars['--rb-radius'] = def.radius;
    vars['--rb-soft'] = soft;
    vars['--rb-surface'] =
      def.surface === 'white' ? '#ffffff' : def.surface === 'transparent' ? 'transparent' : soft;
    if (theme === 'bold') {
      vars['--rb-cover-bg'] = acc;
      vars['--rb-cover-fg'] = accentFg;
      vars['--rb-section-title'] = accentText;
    }
  } else {
    vars['--rb-accent-fg'] = pickAccentFg(acc, '#171717');
    vars['--rb-accent-text'] = deriveAccentText(acc, '#ffffff', '#171717');
    vars['--rb-accent-line'] = deriveAccentLine(acc, '#ffffff', '#171717');
  }

  if (fonts) {
    const pairing = FONT_PAIRINGS[fonts];
    vars['--rb-font-display'] = pairing.display;
    vars['--rb-font-body'] = pairing.body;
    fontHref = pairing.googleHref;
  }

  return { vars, themeClass: theme ? `rb-theme-${theme}` : null, fontHref };
}
```

Note os dois pontos onde este corpo difere do original: (1) `let fontHref =
null` sobe para ANTES do if/else (era declarada depois, sem uso pelo branch
hub); (2) o branch `if (theme) { const def = THEME_DEFS[theme]; ... }` vira
`else if (theme)` — o `else if` é o que faz TypeScript estreitar `theme` para
`'clean' | 'editorial' | 'bold'` nesse branch (excluindo `'hub'`, já tratado
acima), permitindo `THEME_DEFS[theme]` compilar. Fora esses dois pontos, a
lógica de `clean`/`editorial`/`bold`/herdado e o bloco final `if (fonts) {
...}` são BYTE-IDÊNTICOS ao arquivo atual — nenhuma variável, nenhuma ordem de
atribuição muda para os quatro casos que já existiam.

O bloco final `if (fonts) { ... }` roda DEPOIS do branch hub e SOBRESCREVE
`--rb-font-display`/`--rb-font-body`/`fontHref` quando `layout.fonts` está
definido — é assim que a precedência da spec ("fonte explícita vence a fonte
do portal") já sai correta sem nenhuma lógica extra: o branch hub só escreve
esses três campos dentro do `if (!fonts)`, e quando `fonts` existe esse `if`
nem roda.

- [ ] **Step 4: Rodar os testes do tema hub**

Run: `npx vitest run packages/report-blocks/__tests__/theme.test.ts -t "tema hub"`
Expected: PASS em todos os 9 casos do Step 1.

- [ ] **Step 5: Rodar a suíte inteira do arquivo (sem regressão nos 3 temas fixos e no herdado)**

Run: `npx vitest run packages/report-blocks/__tests__/theme.test.ts`
Expected: PASS — TODOS os testes do arquivo, incluindo os que já existiam para
`clean`/`editorial`/`bold`/herdado (nenhuma var muda para esses quatro casos).

- [ ] **Step 6: tsc dos dois apps**

Run: `npx tsc -p apps/crm/tsconfig.json --noEmit`
Run: `npx tsc -p apps/hub/tsconfig.json --noEmit`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/report-blocks/theme.ts packages/report-blocks/__tests__/theme.test.ts
git commit -m "feat(relatorios): resolvedor deriva o tema hub da config whitelabel do portal"
```

---

### Task 6: Migration — trigger aceita `theme: 'hub'`

**Files:**
- Create: `supabase/migrations/20260824000002_report_theme_hub.sql`
  (renumerar se `origin/main` já tiver avançado além de `20260824000001` —
  confira `git ls-tree origin/main:supabase/migrations | tail` antes de criar
  o arquivo)
- Modify: `supabase/tests/entitlements/66_report_docs.sql`

**Interfaces:**
- Consumes: nada de tasks TypeScript anteriores — SQL puro.
- Produces: `validate_report_layout()` aceita `theme IN ('clean', 'editorial',
  'bold', 'hub')` em `report_documents` e `report_templates`.

- [ ] **Step 1: Escrever os testes SQL que faltam**

Em `supabase/tests/entitlements/66_report_docs.sql`, localize o bloco "Task 3
(spec 2026-08-24): layout válido COM theme e fonts nos enums passa" (linhas
149-158, usa a variável `v_cli_a` — não `v_client_a` — e só as colunas
`conta_id, client_id, period_start, period_end, layout`, sem `title`/
`data_snapshot`/`status`, que têm default ou são nullable) e adicione logo
depois dele (antes do comentário "Hardening PR3: layout válido COM accent e
text em bloco ai_ passa" da linha 160):

```sql
  -- Task hub (spec 2026-08-24): theme 'hub' e aceito em report_documents.
  declare
    v_doc_hub uuid;
  begin
    insert into report_documents (conta_id, client_id, period_start, period_end, layout)
      values (v_ws_a, v_cli_a, '2026-03-01', '2026-03-31',
        '{"version":1,"theme":"hub","blocks":[]}'::jsonb)
      returning id into v_doc_hub;
    delete from report_documents where id = v_doc_hub;
  end;
```

Repita o mesmo padrão para `report_templates`, logo após o bloco "T-theme-valido"
(linhas 226-234, usa `insert into report_templates (conta_id, name, layout)
values (v_ws_a, ...)`):

```sql
  -- Task hub (spec 2026-08-24): theme 'hub' e aceito em report_templates.
  declare
    v_tpl_hub uuid;
  begin
    insert into report_templates (conta_id, name, layout)
      values (v_ws_a, 'T-hub',
        '{"version":1,"theme":"hub","blocks":[]}'::jsonb)
      returning id into v_tpl_hub;
    delete from report_templates where id = v_tpl_hub;
  end;
```

- [ ] **Step 2: Rodar a suíte SQL para confirmar que os 2 novos casos falham**

Isso exige Supabase local rodando (Docker via colima, conforme a memória do
projeto). Se não houver Docker disponível neste ambiente, pule a execução
local e confie na revisão de código + no CI (`entitlement-tests`), deixando
isso registrado no relatório da task.

Run: `colima start` (se necessário) e depois
`bash scripts/test-entitlements.sh` (ou o comando equivalente já documentado
em `CLAUDE.md`/README para rodar as suítes de `supabase/tests/entitlements/`).
Expected: FAIL nos 2 casos novos com `INVALID_LAYOUT` — o trigger atual ainda
rejeita `'hub'`.

- [ ] **Step 3: Escrever a migration**

Crie `supabase/migrations/20260824000002_report_theme_hub.sql`:

```sql
-- supabase/migrations/20260824000002_report_theme_hub.sql
-- Tema 'hub' no layout do relatorio (spec 2026-08-24): quarto valor aceito no
-- enum de theme, ao lado de clean/editorial/bold. Recria a funcao inteira
-- (CREATE OR REPLACE) preservando todo o corpo da 20260824000001, so
-- estendendo a lista do check de theme. Forward-only: sem downgrade, mesmo
-- padrao do resto do projeto.
CREATE OR REPLACE FUNCTION validate_report_layout() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.layout IS NULL
     OR jsonb_typeof(NEW.layout) <> 'object'
     OR (NEW.layout -> 'version') IS DISTINCT FROM to_jsonb(1)
     OR jsonb_typeof(NEW.layout -> 'blocks') IS DISTINCT FROM 'array'
     OR jsonb_array_length(NEW.layout -> 'blocks') > 200 THEN
    RAISE EXCEPTION 'INVALID_LAYOUT';
  END IF;
  IF NEW.layout ? 'accent' AND (
       jsonb_typeof(NEW.layout -> 'accent') IS DISTINCT FROM 'string'
       OR NEW.layout ->> 'accent' !~ '^#[0-9a-fA-F]{6}$'
     ) THEN
    RAISE EXCEPTION 'INVALID_LAYOUT';
  END IF;
  IF NEW.layout ? 'theme' AND (
       jsonb_typeof(NEW.layout -> 'theme') IS DISTINCT FROM 'string'
       OR NEW.layout ->> 'theme' NOT IN ('clean', 'editorial', 'bold', 'hub')
     ) THEN
    RAISE EXCEPTION 'INVALID_LAYOUT';
  END IF;
  IF NEW.layout ? 'fonts' AND (
       jsonb_typeof(NEW.layout -> 'fonts') IS DISTINCT FROM 'string'
       OR NEW.layout ->> 'fonts' NOT IN ('system', 'fraunces', 'grotesk', 'playfair')
     ) THEN
    RAISE EXCEPTION 'INVALID_LAYOUT';
  END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(NEW.layout -> 'blocks') AS b
    WHERE jsonb_typeof(b) <> 'object'
       OR jsonb_typeof(b -> 'id') IS DISTINCT FROM 'string'
       OR b ->> 'id' = ''
       OR jsonb_typeof(b -> 'type') IS DISTINCT FROM 'string'
       OR jsonb_typeof(b -> 'size') IS DISTINCT FROM 'string'
       OR b ->> 'size' NOT IN ('third', 'half', 'full')
       OR (b ? 'text' AND b ->> 'type' NOT IN
           ('text', 'ai_summary', 'ai_recommendations', 'ai_goals'))
  ) THEN
    RAISE EXCEPTION 'INVALID_LAYOUT';
  END IF;
  IF (SELECT count(*) <> count(DISTINCT b ->> 'id')
        FROM jsonb_array_elements(NEW.layout -> 'blocks') AS b) THEN
    RAISE EXCEPTION 'INVALID_LAYOUT';
  END IF;
  RETURN NEW;
END $$;
```

- [ ] **Step 4: Rodar a suíte SQL de novo**

Mesmo comando do Step 2.
Expected: PASS em todos os casos, incluindo os 2 novos. Se o ambiente não tem
Docker/Supabase local, registre no relatório da task que a validação ficou
para o CI (`entitlement-tests`), sem marcar o passo como executado.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260824000002_report_theme_hub.sql \
  supabase/tests/entitlements/66_report_docs.sql
git commit -m "feat(relatorios): migration aceita theme 'hub' no trigger de validacao do layout"
```

---

### Task 7: Popover Aparência — opção "Hub"

**Files:**
- Modify: `apps/crm/src/pages/relatorio-editor/AppearancePopover.tsx`
- Modify: `apps/crm/style.css`

**Interfaces:**
- Consumes: `REPORT_THEME_IDS`/`ReportThemeId` já incluindo `'hub'` (Task 3);
  `resolveReportTheme` já tratando `'hub'` (Task 5) — a UI só precisa listar a
  opção, a renderização já funciona fim a fim assim que o layout grava
  `theme: 'hub'` (o `EditorCanvas.tsx`, `BlockRenderer.tsx` e
  `RelatorioPrintPage.tsx` já chamam `resolveReportTheme` genericamente, sem
  nenhum `switch` por id de tema — confirmado nos três arquivos).
- Produces: nada consumido por tasks futuras (última task do plano).

- [ ] **Step 1: Adicionar a opção ao array de temas**

Em `apps/crm/src/pages/relatorio-editor/AppearancePopover.tsx`, no array
`THEME_OPTIONS` (linha ~19), adicione uma quarta entrada:

```ts
const THEME_OPTIONS: { id: ReportThemeId | undefined; label: string; hint: string }[] = [
  { id: undefined, label: 'Padrão', hint: 'segue a página' },
  { id: 'clean', label: 'Clean', hint: 'claro e neutro' },
  { id: 'editorial', label: 'Editorial', hint: 'creme, serifa' },
  { id: 'bold', label: 'Bold', hint: 'marca em tudo' },
  { id: 'hub', label: 'Hub', hint: 'igual ao portal' },
];
```

- [ ] **Step 2: Passar a cor de destaque para a miniatura do Hub via CSS var inline**

A miniatura do Hub precisa de um indicador da cor de destaque (as outras
miniaturas usam cores fixas do próprio tema; o tema Hub não tem uma cor
fixa — ela vem do `accent_color` do workspace). No JSX do map de
`THEME_OPTIONS` (linha ~44-58), troque o `<span className={...thumb.../>`
para aceitar um style condicional:

```tsx
{THEME_OPTIONS.map((opt) => (
  <button
    key={opt.label}
    type="button"
    role="radio"
    aria-checked={layout.theme === opt.id}
    className={`rb-appearance-theme${layout.theme === opt.id ? ' rb-appearance-selected' : ''}`}
    onClick={() => onChange(setLayoutTheme(layout, opt.id))}
  >
    <span
      className={`rb-appearance-thumb rb-appearance-thumb-${opt.id ?? 'default'}`}
      style={
        opt.id === 'hub'
          ? ({ '--rb-hub-thumb-accent': snapshot.branding.accent_color } as CSSProperties)
          : undefined
      }
    />
    <span>
      {opt.label}
      <small>{opt.hint}</small>
    </span>
  </button>
))}
```

Adicione `type CSSProperties` ao import de `'react'` no topo do arquivo (o
arquivo hoje não importa nada de `react` diretamente — adicione
`import type { CSSProperties } from 'react';`).

- [ ] **Step 3: CSS da miniatura do Hub**

Em `apps/crm/style.css`, logo após a regra `.rb-appearance-thumb-bold` (linha
~11909-11912), adicione:

```css
.rb-appearance-thumb-hub {
  background: #fafafa;
  border: 1px solid var(--border-color);
  position: relative;
  overflow: hidden;
}
.rb-appearance-thumb-hub::after {
  content: '';
  position: absolute;
  right: 4px;
  bottom: 4px;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--rb-hub-thumb-accent, #171717);
}
```

- [ ] **Step 4: Verificação manual no browser**

Inicie o dev server do CRM (`npm run dev`), abra um relatório existente no
editor (`/relatorios/:id`), abra o popover "Aparência" e confirme:
- a quarta opção "Hub / igual ao portal" aparece na lista, com um ponto na cor
  de destaque do workspace no canto da miniatura;
- selecioná-la aplica o visual do Personalizar Hub do workspace (compare
  superfície, raio de card e fontes contra `/configuracoes` aba Hub do mesmo
  workspace);
- trocar a dupla de fontes no MESMO popover, com o tema Hub selecionado,
  sobrescreve a fonte do portal (confirma a precedência de `layout.fonts`);
- voltar para "Padrão" restaura o modo herdado sem erro no console.

- [ ] **Step 5: tsc, lint, format**

Run: `npx tsc -p apps/crm/tsconfig.json --noEmit`
Run: `npm run lint`
Run: `npm run format:check` (ou `npm run format` se houver diffs a corrigir)
Expected: PASS em todos.

- [ ] **Step 6: Commit**

```bash
git add apps/crm/src/pages/relatorio-editor/AppearancePopover.tsx apps/crm/style.css
git commit -m "feat(relatorios): opcao de tema Hub no popover Aparencia"
```

---

## Verificação final (antes do PR)

- [ ] `npm run lint`
- [ ] `npm run format:check`
- [ ] `npx tsc -p apps/crm/tsconfig.json --noEmit`
- [ ] `npx tsc -p apps/hub/tsconfig.json --noEmit`
- [ ] `npx tsc -p apps/admin/tsconfig.json --noEmit`
- [ ] `npx tsc -p tsconfig.scripts.json --noEmit`
- [ ] `npm run test`
- [ ] `npm run test:functions` seguido de `git checkout -- deno.lock`
- [ ] Suíte SQL de `supabase/tests/entitlements/66_report_docs.sql` (local se
      houver Docker; senão confiar no job `entitlement-tests` do CI)
- [ ] Browser: fluxo completo do Step 4 da Task 7, nos três contextos (editor,
      viewer do Hub navegando para o relatório, e — se o ambiente de PDF
      estiver configurado — exportar o PDF com o tema Hub selecionado e
      conferir que a fonte do portal e a superfície aparecem no arquivo)
- [ ] Reconferir `git ls-tree origin/main:supabase/migrations | tail` antes de
      abrir o PR — renumerar a migration se `origin/main` avançou
