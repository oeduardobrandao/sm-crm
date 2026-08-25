# Capa em página inteira, editável, com foto do cliente — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Transformar o bloco "Capa" do relatório de blocos em página inteira, com foto
do cliente ao lado da logo, kicker/título/subtítulo editáveis, cor de fundo própria
(com contraste automático) e tamanho de logo configurável.

**Architecture:** `CoverBlock.tsx` (leitura, em `packages/report-blocks`) passa a ler
`block.config` e `snapshot.account.{profile_picture_url,client_name}`; um
`CoverEditor.tsx` novo no CRM reproduz a mesma casca visual trocando os três textos
por inputs. A foto do cliente ganha cache próprio no momento da geração (mesmo
mecanismo já usado para thumbnails de post). A invariante "capa é sempre full width"
é validada em TS E numa migration SQL nova (única migration deste plano).

**Tech Stack:** React 19, TypeScript, Vitest (frontend/pacotes), Deno test (edge
functions), Postgres/PL-pgSQL (trigger), Supabase Edge Functions.

## Global Constraints

- Testes de `supabase/functions/**` usam `Deno.test`/`assert`/`assertEquals` de
  `https://deno.land/std@0.208.0/assert/mod.ts`. Testes de `apps/**`/`packages/**`
  usam `describe`/`it`/`expect` do `vitest`. Nunca misturar os dois estilos.
- Sem travessão (—) em texto voltado ao usuário; use vírgula, ponto ou "·".
- `cover.config.logoSize`: inteiro, [20, 68], default 36, passo 8 (stepper +/-).
- `cover.config.color`: `#rrggbb` (6 dígitos exatos). Um valor de 8 dígitos
  (`#rrggbbaa`) deve ser normalizado para 6 antes de persistir, mesma blindagem já
  existente em `setLayoutAccent` (achado C2 documentado em `layoutOps.ts`).
- Todo bloco `type: "cover"` deve ter `size: "full"` — validado em TS
  (`validateLayout`) E no trigger SQL (`validate_report_layout`), não só num dos dois.
- Migration nova segue o padrão forward-only já usado no projeto:
  `CREATE OR REPLACE FUNCTION validate_report_layout()` reescrevendo o CORPO INTEIRO
  da função (preservando tudo da migration anterior), nunca um `ALTER` parcial.
- Depois de rodar `deno test` localmente, sempre `git checkout -- deno.lock` (evita a
  poluição de `node_modules/.deno` documentada no CLAUDE.md do projeto, que quebra
  `tsc`/`vitest` na sequência).
- Campos novos em `ReportDocSnapshot.account` (`profile_picture_url`,
  `client_name`) são OPCIONAIS no tipo (`?`), porque snapshots já persistidos antes
  deste recurso não têm essas chaves — mesmo padrão já usado por
  `SnapshotBranding.hub_theme?`.
- Ao final de TODAS as tasks: os 4 `tsc` (`apps/crm`, `apps/hub`, `apps/admin`,
  `tsconfig.scripts.json`), `npm run lint`, `npm run format:check`, `npm run test`,
  `npm run test:functions`.

---

### Task 1: Validação da capa em `validateLayout` + helpers puros no editor

**Files:**
- Modify: `supabase/functions/_shared/report-docs/layout.ts`
- Modify: `supabase/functions/_shared/report-docs/layout.test.ts`
- Modify: `apps/crm/src/pages/relatorio-editor/layoutOps.ts`
- Modify: `apps/crm/src/pages/relatorio-editor/__tests__/layoutOps.test.ts`

**Interfaces:**
- Produces: `validateLayout` (já existente) passa a rejeitar `cover.size !== "full"`,
  `cover.config.color` fora do formato `#rrggbb`, e `cover.config.logoSize` fora de
  `[20, 68]` ou não-inteiro.
- Produces (novo, em `layoutOps.ts`): `COVER_LOGO_MIN = 20`, `COVER_LOGO_MAX = 68`,
  `COVER_LOGO_DEFAULT = 36` (exportados); `normalizeCoverColorPatch(color: string |
  undefined): Record<string, unknown>`; `stepCoverLogoSize(current: number |
  undefined, delta: 1 | -1): number`.

- [ ] **Step 1: Escrever os testes que falham para `validateLayout`**

Adicione ao FINAL de `supabase/functions/_shared/report-docs/layout.test.ts`:

```ts
Deno.test("validateLayout: cover deve ser size full", () => {
  const cover = (over: Record<string, unknown> = {}) => block({ type: "cover", ...over });
  assert(validateLayout(layout([cover()])).ok);
  assert(!validateLayout(layout([cover({ size: "third" })])).ok);
  assert(!validateLayout(layout([cover({ size: "half" })])).ok);
});

Deno.test("validateLayout: cover.config.color precisa ser hex #rrggbb", () => {
  const cover = (config: Record<string, unknown>) => block({ type: "cover", config });
  assert(validateLayout(layout([cover({ color: "#0f766e" })])).ok);
  assert(!validateLayout(layout([cover({ color: "vermelho" })])).ok);
  assert(!validateLayout(layout([cover({ color: "#fff" })])).ok);
});

Deno.test("validateLayout: cover.config.logoSize entre 20 e 68", () => {
  const cover = (config: Record<string, unknown>) => block({ type: "cover", config });
  assert(validateLayout(layout([cover({ logoSize: 20 })])).ok);
  assert(validateLayout(layout([cover({ logoSize: 68 })])).ok);
  assert(!validateLayout(layout([cover({ logoSize: 19 })])).ok);
  assert(!validateLayout(layout([cover({ logoSize: 69 })])).ok);
  assert(!validateLayout(layout([cover({ logoSize: 40.5 })])).ok);
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `deno test supabase/functions/_shared/report-docs/layout.test.ts`
Expected: FAIL nos 3 novos testes (a validação ainda não existe).

- [ ] **Step 3: Implementar a validação em `layout.ts`**

Em `supabase/functions/_shared/report-docs/layout.ts`, dentro do `for (const b of
raw.blocks) { ... }` de `validateLayout`, logo após o bloco `if (b.type ===
"top_posts" || b.type === "post_list") { ... }` existente (e antes do `}` que fecha o
`for`), adicione:

```ts
    if (b.type === "cover") {
      if (b.size !== "full") {
        return { ok: false, error: "cover must be full width" };
      }
      const coverCfg = b.config as Record<string, unknown> | undefined;
      if (coverCfg?.color !== undefined) {
        if (
          typeof coverCfg.color !== "string" ||
          !/^#[0-9a-fA-F]{6}$/.test(coverCfg.color)
        ) {
          return { ok: false, error: "invalid cover color" };
        }
      }
      if (coverCfg?.logoSize !== undefined) {
        const logoSize = coverCfg.logoSize;
        // Bounds espelhados em apps/crm/src/pages/relatorio-editor/layoutOps.ts
        // (COVER_LOGO_MIN/MAX) -- mudar um dos dois lados sem o outro quebra a
        // consistência entre o que o stepper produz e o que o backend aceita.
        if (
          typeof logoSize !== "number" || !Number.isInteger(logoSize) ||
          logoSize < 20 || logoSize > 68
        ) {
          return { ok: false, error: "cover logoSize out of bounds" };
        }
      }
    }
```

- [ ] **Step 4: Rodar e ver passar**

Run: `deno test supabase/functions/_shared/report-docs/layout.test.ts`
Expected: PASS em todos os testes do arquivo.

Run em seguida: `git checkout -- deno.lock` (limpa a poluição do `deno test` no
lockfile, gotcha documentado no CLAUDE.md do projeto).

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/_shared/report-docs/layout.ts supabase/functions/_shared/report-docs/layout.test.ts
git commit -m "feat(relatorios): valida cor, tamanho de logo e largura da capa no layout"
```

- [ ] **Step 6: Escrever os testes que falham para os helpers do editor**

Em `apps/crm/src/pages/relatorio-editor/__tests__/layoutOps.test.ts`, adicione ao
final do arquivo (após o `describe('setLayoutTheme / setLayoutFonts', ...)`
existente):

```ts
describe('normalizeCoverColorPatch', () => {
  it('cor válida de 6 dígitos: patch com a mesma cor', () => {
    expect(normalizeCoverColorPatch('#0f766e')).toEqual({ color: '#0f766e' });
  });
  it('cor de 8 dígitos: normaliza para 6', () => {
    expect(normalizeCoverColorPatch('#0f766eff')).toEqual({ color: '#0f766e' });
  });
  it('cor inválida (não-hex): patch vazio', () => {
    expect(normalizeCoverColorPatch('vermelho')).toEqual({});
  });
  it('cor de 8 dígitos que não normaliza pra 6 hex válidos: patch vazio', () => {
    expect(normalizeCoverColorPatch('#zzzzzzzz')).toEqual({});
  });
  it('undefined: patch remove a chave (herda o accent)', () => {
    expect(normalizeCoverColorPatch(undefined)).toEqual({ color: undefined });
  });
});

describe('stepCoverLogoSize', () => {
  it('sem valor atual: parte do default (36) e soma o passo', () => {
    expect(stepCoverLogoSize(undefined, 1)).toBe(44);
    expect(stepCoverLogoSize(undefined, -1)).toBe(28);
  });
  it('clampa no teto (68) e no piso (20)', () => {
    expect(stepCoverLogoSize(68, 1)).toBe(68);
    expect(stepCoverLogoSize(20, -1)).toBe(20);
  });
  it('soma/subtrai 8px a partir do valor atual', () => {
    expect(stepCoverLogoSize(44, 1)).toBe(52);
    expect(stepCoverLogoSize(44, -1)).toBe(36);
  });
});
```

E adicione `normalizeCoverColorPatch, stepCoverLogoSize` ao import existente do topo
do arquivo (`import { ..., setLayoutAccent, setLayoutTheme, setLayoutFonts } from
'../layoutOps';` — inclua os dois nomes novos nessa lista).

- [ ] **Step 7: Rodar e ver falhar**

Run: `npx vitest run apps/crm/src/pages/relatorio-editor/__tests__/layoutOps.test.ts`
Expected: FAIL (`normalizeCoverColorPatch`/`stepCoverLogoSize` ainda não existem).

- [ ] **Step 8: Implementar os helpers em `layoutOps.ts`**

Em `apps/crm/src/pages/relatorio-editor/layoutOps.ts`, adicione ao final do arquivo
(depois de `setLayoutFonts`):

```ts
export const COVER_LOGO_MIN = 20;
export const COVER_LOGO_MAX = 68;
export const COVER_LOGO_DEFAULT = 36;
const COVER_LOGO_STEP = 8;

/** Cor de fundo própria da capa (bloco `cover`): mesma blindagem hex8->hex6 de
 * setLayoutAccent (achado C2) acima, só que por bloco em vez de por layout.
 * `undefined` produz o patch que remove a chave (herda o accent do relatório). Cor
 * inválida devolve patch vazio -- o chamador deve tratar `{}` como "nada a
 * fazer" e pular o onConfigChange. */
export function normalizeCoverColorPatch(color: string | undefined): Record<string, unknown> {
  if (color === undefined) return { color: undefined };
  const normalized = HEX8_RE.test(color) ? color.slice(0, 7) : color;
  if (!HEX6_RE.test(normalized)) return {};
  return { color: normalized };
}

/** Próximo logoSize da capa dado o atual (ausente = COVER_LOGO_DEFAULT), clamped a
 * [COVER_LOGO_MIN, COVER_LOGO_MAX] em passos de COVER_LOGO_STEP px. */
export function stepCoverLogoSize(current: number | undefined, delta: 1 | -1): number {
  const base = typeof current === 'number' ? current : COVER_LOGO_DEFAULT;
  return Math.min(Math.max(base + delta * COVER_LOGO_STEP, COVER_LOGO_MIN), COVER_LOGO_MAX);
}
```

- [ ] **Step 9: Rodar e ver passar**

Run: `npx vitest run apps/crm/src/pages/relatorio-editor/__tests__/layoutOps.test.ts`
Expected: PASS em todos os testes do arquivo (deve reportar mais testes que antes).

- [ ] **Step 10: Commit**

```bash
git add apps/crm/src/pages/relatorio-editor/layoutOps.ts apps/crm/src/pages/relatorio-editor/__tests__/layoutOps.test.ts
git commit -m "feat(relatorios): helpers de cor e tamanho de logo da capa em layoutOps"
```

---

### Task 2: Migration — capa sempre `size: "full"` no trigger SQL

**Files:**
- Create: `supabase/migrations/20260825000001_report_cover_full_width.sql`
- Modify: `supabase/tests/entitlements/66_report_docs.sql`

**Interfaces:**
- Consumes: nada das tasks anteriores (regra independente, aplicada em paralelo em
  SQL).
- Produces: `validate_report_layout()` (trigger function, já existente) passa a
  rejeitar qualquer bloco `type: "cover"` com `size` diferente de `"full"`, em
  QUALQUER escrita em `report_documents.layout` ou `report_templates.layout`
  (inclusive via PostgREST direto, sem passar pelo `validateLayout` do TS).

**IMPORTANTE — antes de criar o arquivo:** confira `ls supabase/migrations | tail -5`
e `git ls-tree origin/main:supabase/migrations | tail -5`. Se algum arquivo com
prefixo `20260825000001` já existir (de outro trabalho concorrente), troque o
prefixo deste arquivo para o próximo timestamp livre — duas migrations com o mesmo
prefixo colidem silenciosamente no histórico do Supabase (`migration-version-guard`
do CI existe exatamente para isso).

- [ ] **Step 1: Escrever o teste SQL que falha**

Em `supabase/tests/entitlements/66_report_docs.sql`, logo depois do bloco existente
que termina em (procure por este texto exato):

```sql
  -- Task 6 (spec 2026-08-24): theme 'hub' é aceito em report_documents.
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

adicione logo em seguida (antes do comentário `-- Hardening PR3: ...` que já existe
na sequência):

```sql
  -- Task 1 (spec 2026-08-25): bloco cover com size != 'full' é rejeitado.
  begin
    insert into report_documents (conta_id, client_id, period_start, period_end, layout)
      values (v_ws_a, v_cli_a, '2026-03-01', '2026-03-31',
        '{"version":1,"blocks":[{"id":"c1","type":"cover","size":"third"}]}'::jsonb);
    raise exception 'validate_report_layout aceitou cover com size != full';
  exception when others then
    if sqlerrm not like '%INVALID_LAYOUT%' then raise; end if;
  end;

  -- Task 1 (spec 2026-08-25): bloco cover com size 'full' é aceito.
  declare
    v_doc_cover uuid;
  begin
    insert into report_documents (conta_id, client_id, period_start, period_end, layout)
      values (v_ws_a, v_cli_a, '2026-03-01', '2026-03-31',
        '{"version":1,"blocks":[{"id":"c1","type":"cover","size":"full"}]}'::jsonb)
      returning id into v_doc_cover;
    delete from report_documents where id = v_doc_cover;
  end;
```

Depois, procure o bloco existente (mais abaixo no mesmo arquivo, dentro da seção de
`report_templates`):

```sql
  -- Task 6 (spec 2026-08-24): theme 'hub' é aceito em report_templates.
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

e adicione logo em seguida:

```sql
  -- Task 1 (spec 2026-08-25): bloco cover com size 'full' é aceito em report_templates.
  declare
    v_tpl_cover uuid;
  begin
    insert into report_templates (conta_id, name, layout)
      values (v_ws_a, 'T-cover',
        '{"version":1,"blocks":[{"id":"c1","type":"cover","size":"full"}]}'::jsonb)
      returning id into v_tpl_cover;
    delete from report_templates where id = v_tpl_cover;
  end;
```

- [ ] **Step 2: Rodar e ver falhar**

Este teste roda dentro de `bash scripts/test-entitlements.sh`, que exige um Supabase
local via `supabase start` (Docker/colima). Se não houver ambiente local disponível
agora, pule a verificação local e confie no `entitlement-tests` job do CI — mas
ainda assim escreva o teste ANTES da migration (ordem TDD), e note isso no relatório
da task.

Se houver ambiente local: `colima start` (se necessário) → `supabase start` →
`bash scripts/test-entitlements.sh`.
Expected (com ambiente local): FAIL no bloco "bloco cover com size 'full' é aceito"
(a coluna `size` já existe, mas o `type: cover` + `full` deve passar; o teste que
DEVE falhar antes da Step 3 é o de REJEIÇÃO -- ele vai "passar" silenciosamente hoje
porque a inserção de `size: third` HOJE não lança `INVALID_LAYOUT`, então o `raise
exception` de fallback dispara e o teste do arquivo inteiro falha).

- [ ] **Step 3: Criar a migration**

Crie `supabase/migrations/20260825000001_report_cover_full_width.sql`:

```sql
-- supabase/migrations/20260825000001_report_cover_full_width.sql
-- Bloco 'cover' sempre size 'full' (spec 2026-08-25): pagina inteira so faz
-- sentido em largura cheia. Recria a funcao inteira (CREATE OR REPLACE)
-- preservando todo o corpo da 20260824000002, so adicionando essa condicao ao
-- EXISTS que ja valida a forma de cada bloco. Forward-only: sem downgrade,
-- mesmo padrao do resto do projeto.
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
  -- accent, quando presente, é string #rrggbb exata.
  IF NEW.layout ? 'accent' AND (
       jsonb_typeof(NEW.layout -> 'accent') IS DISTINCT FROM 'string'
       OR NEW.layout ->> 'accent' !~ '^#[0-9a-fA-F]{6}$'
     ) THEN
    RAISE EXCEPTION 'INVALID_LAYOUT';
  END IF;
  -- theme/fonts, quando presentes, sao strings dos enums fechados.
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
       -- text só nos tipos textuais (subset estável; espelha TEXT_BLOCK_TYPES)
       OR (b ? 'text' AND b ->> 'type' NOT IN
           ('text', 'ai_summary', 'ai_recommendations', 'ai_goals'))
       -- capa é sempre largura cheia (spec 2026-08-25): pagina inteira nao faz
       -- sentido em largura parcial.
       OR (b ->> 'type' = 'cover' AND b ->> 'size' <> 'full')
  ) THEN
    RAISE EXCEPTION 'INVALID_LAYOUT';
  END IF;
  -- id duplicado
  IF (SELECT count(*) <> count(DISTINCT b ->> 'id')
        FROM jsonb_array_elements(NEW.layout -> 'blocks') AS b) THEN
    RAISE EXCEPTION 'INVALID_LAYOUT';
  END IF;
  RETURN NEW;
END $$;
```

- [ ] **Step 4: Rodar e ver passar (se houver ambiente local)**

Run: `bash scripts/test-entitlements.sh`
Expected: PASS. Se não houver ambiente local disponível, documente no relatório da
task que a verificação ficou para o `entitlement-tests` job do CI.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260825000001_report_cover_full_width.sql supabase/tests/entitlements/66_report_docs.sql
git commit -m "feat(relatorios): migration garante cover sempre full width no trigger"
```

---

### Task 3: Foto do cliente e nome no snapshot (com cache próprio)

**Files:**
- Modify: `supabase/functions/_shared/report-docs/snapshot.ts`
- Modify: `supabase/functions/_shared/report-docs/snapshot.test.ts`
- Modify: `supabase/functions/report-docs/snapshot-source.ts`
- Modify: `supabase/functions/report-docs/generate.ts`
- Modify: `supabase/functions/report-docs/refresh.ts`
- Modify: `supabase/functions/report-docs/generate.test.ts` (ou `refresh.test.ts`,
  o que já tiver um teste fácil de estender para o `cliente` mockado — ver Step 6)

**Interfaces:**
- Consumes: `cachePostThumbnail` (já existente, já importado em
  `snapshot-source.ts`, de `../_shared/instagram-thumbnail-cache.ts`) —
  `cachePostThumbnail(deps: {fetch, storage}, accountId: string | number, postId:
  string, cdnUrl: string | null, existingUrl?: string | null): Promise<string |
  null>`.
- Produces: `ReportDocSnapshot.account` e `SnapshotInput.account` ganham
  `profile_picture_url?: string | null` e `client_name?: string`.
  `loadClientSnapshot`'s `cliente` param ganha `nome: string`.

- [ ] **Step 1: Escrever o teste que falha para `assembleSnapshot`**

Em `supabase/functions/_shared/report-docs/snapshot.test.ts`, adicione ao final do
arquivo:

```ts
Deno.test("assembleSnapshot repassa profile_picture_url e client_name do account", () => {
  const snap = assembleSnapshot({
    month: "2026-07",
    account: {
      handle: "dra.exemplo", specialty: "Dermatologia",
      profile_picture_url: "https://x/avatar.jpg", client_name: "Dra. Exemplo",
    },
    branding: { workspace_name: "DK", logo_url: null, splash_url: null, accent_color: "#123456" },
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
  assertEquals(snap.account.profile_picture_url, "https://x/avatar.jpg");
  assertEquals(snap.account.client_name, "Dra. Exemplo");
});

Deno.test("assembleSnapshot: account sem profile_picture_url/client_name continua válido (compat)", () => {
  const snap = assembleSnapshot({
    month: "2026-07",
    account: { handle: "h", specialty: "" },
    branding: { workspace_name: "W", logo_url: null, splash_url: null, accent_color: "#000" },
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
  assertEquals(snap.account.profile_picture_url, undefined);
  assertEquals(snap.account.client_name, undefined);
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `deno test supabase/functions/_shared/report-docs/snapshot.test.ts`
Expected: FAIL com erro de tipo/propriedade ausente (`profile_picture_url`/
`client_name` não existem em `account` ainda).

- [ ] **Step 3: Adicionar os campos ao tipo**

Em `supabase/functions/_shared/report-docs/snapshot.ts`, troque a linha (aparece
DUAS vezes no arquivo, uma em `ReportDocSnapshot`, outra em `SnapshotInput`):

```ts
  account: { handle: string; specialty: string };
```

pelas DUAS ocorrências:

```ts
  account: {
    handle: string;
    specialty: string;
    /** URL estável (cacheada no momento da geração; ver snapshot-source.ts).
     * Ausente/null = sem foto de perfil disponível. */
    profile_picture_url?: string | null;
    /** Nome do cliente (clientes.nome), pro fallback de iniciais do avatar da
     * capa. Ausente = snapshot gerado antes deste campo existir. */
    client_name?: string;
  };
```

- [ ] **Step 4: Rodar e ver passar**

Run: `deno test supabase/functions/_shared/report-docs/snapshot.test.ts`
Expected: PASS em todos os testes do arquivo.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/_shared/report-docs/snapshot.ts supabase/functions/_shared/report-docs/snapshot.test.ts
git commit -m "feat(relatorios): snapshot ganha profile_picture_url e client_name da conta"
```

- [ ] **Step 6: Escrever o teste que falha para `loadClientSnapshot`/`generate.ts`**

`supabase/functions/report-docs/generate.test.ts` já define, no topo do arquivo: um
`makeDb(rows, opts)` cujo `from(table)` devolve `rows[table]` encadeável (qualquer
`.select/.eq/.gte/.lt/.order/.limit` é um no-op que devolve a mesma linha; só
`report_documents.insert(row)` é especial, e empilha `row` em `db.inserts`); um
`deps` compartilhado (`{ fetch: globalThis.fetch, storage: {} as any, geminiKey: "",
userId: "user-1" }`); e chama `generateReportDocument(db, deps, contaId, clientId,
month, templateId)`, que devolve `{ id }` (o resto é inspecionado via
`db.inserts[0]`, o payload que seria persistido). Adicione ao FINAL do arquivo:

```ts
Deno.test("generate: cacheia a foto de perfil e propaga client_name no snapshot", async () => {
  const uploaded: { path: string; contentType: string }[] = [];
  const storage = {
    from: (bucket: string) => ({
      upload: async (path: string, _body: unknown, opts: { contentType: string }) => {
        uploaded.push({ path, contentType: opts.contentType });
        return { error: null };
      },
      getPublicUrl: (path: string) => ({
        data: { publicUrl: `https://cdn.example/${bucket}/${path}` },
      }),
    }),
    createBucket: async () => ({}),
  };
  const fetchMock = (async (url: string) => {
    if (url === "https://cdninstagram.com/raw.jpg") {
      return new Response(new Uint8Array([1, 2, 3]), {
        status: 200,
        headers: { "content-type": "image/jpeg" },
      });
    }
    return new Response("{}", { status: 200 });
  }) as typeof fetch;
  const testDeps = { ...deps, fetch: fetchMock, storage };

  const db = makeDb({
    clientes: { id: 1, conta_id: "c", nome: "Dra. X", especialidade: "Derma", include_ai_analysis: false },
    instagram_accounts: {
      id: "ig-1", username: "dra.x", follower_count: 100,
      profile_picture_url: "https://cdninstagram.com/raw.jpg",
    },
    instagram_posts: [],
    instagram_follower_history: [],
    instagram_analytics_cache: null,
    instagram_account_metrics_daily: [],
    workspaces: { name: "DK", logo_url: null, brand_color: "#123456", report_splash_url: null },
  });
  await generateReportDocument(db, testDeps, "c", 1, "2026-07", null);
  const row = db.inserts[0] as {
    data_snapshot: { account: { client_name: string; profile_picture_url: string | null } };
  };
  assertEquals(row.data_snapshot.account.client_name, "Dra. X");
  assertEquals(
    row.data_snapshot.account.profile_picture_url,
    "https://cdn.example/instagram-posts/ig-1/avatar.jpg",
  );
  assertEquals(uploaded.length, 1);
  assertEquals(uploaded[0].path, "ig-1/avatar.jpg");
});
```

(`workspaces` aqui omite os campos `hub_*` que a query real seleciona — sem
problema, o `makeDb` não filtra por coluna, e `hubTheme` em `snapshot-source.ts` já
tem defaults pra quando eles vêm `undefined`.)

- [ ] **Step 7: Rodar e ver falhar**

Run: `deno test supabase/functions/report-docs/generate.test.ts`
Expected: FAIL (`client_name` ausente da chamada de `loadClientSnapshot`, e a foto
ainda não é cacheada).

- [ ] **Step 8: Implementar em `snapshot-source.ts`**

Em `supabase/functions/report-docs/snapshot-source.ts`:

1. Troque a assinatura de `loadClientSnapshot` (procure `cliente: { id: number;
   especialidade: string | null },`):

```ts
  cliente: { id: number; especialidade: string | null; nome: string },
```

2. Logo depois do bloco `const accountViewsPromise: Promise<...> = (async () => {
   ... })().catch((e) => { ... });` (o mesmo padrão de I/O concorrente), adicione:

```ts
  // Foto do cliente: cacheada no MESMO bucket/mecanismo dos thumbnails de post
  // (achado de review externo 2026-08-25) -- instagram_accounts.profile_picture_url
  // NÃO é garantidamente estável: a conexão inicial grava a URL efêmera crua do
  // Graph (instagram-integration/index.ts:382), só os crons de sync recacheiam
  // depois. O data_snapshot é congelado para sempre, então precisa da MESMA
  // blindagem que os thumbnails de post já têm -- sem isso a foto quebraria
  // quando a URL efêmera expirasse, sem chance de autocorrigir depois.
  const avatarUrlPromise: Promise<string | null> = cachePostThumbnail(
    { fetch: deps.fetch, storage: deps.storage },
    igAccountId,
    "avatar",
    account.profile_picture_url ?? null,
    null,
  );
```

3. Logo depois de `const accountViews = await accountViewsPromise;` (mais abaixo no
   mesmo arquivo), adicione:

```ts
  const avatarUrl = await avatarUrlPromise;
```

4. No objeto passado a `assembleSnapshot({...})`, troque:

```ts
    account: {
      handle: account.username ?? account.handle ?? "",
      specialty: [cliente.especialidade].filter(Boolean).join(" · "),
    },
```

por:

```ts
    account: {
      handle: account.username ?? account.handle ?? "",
      specialty: [cliente.especialidade].filter(Boolean).join(" · "),
      profile_picture_url: avatarUrl,
      client_name: cliente.nome,
    },
```

- [ ] **Step 9: Atualizar os call sites (`generate.ts` e `refresh.ts`)**

Em `supabase/functions/report-docs/generate.ts`, troque:

```ts
  const { snapshot, igAccountId } = await loadClientSnapshot(
    db, deps, contaId, { id: cliente.id, especialidade: cliente.especialidade }, month,
  );
```

por:

```ts
  const { snapshot, igAccountId } = await loadClientSnapshot(
    db, deps, contaId,
    { id: cliente.id, especialidade: cliente.especialidade, nome: cliente.nome },
    month,
  );
```

(`cliente.nome` já vem do `select` existente em `generate.ts:50`, nenhuma mudança de
query necessária ali.)

Em `supabase/functions/report-docs/refresh.ts`, troque a linha do `select`:

```ts
  const { data: cliente } = await db.from("clientes")
    .select("id, conta_id, especialidade")
    .eq("id", doc.client_id).maybeSingle();
```

por:

```ts
  const { data: cliente } = await db.from("clientes")
    .select("id, conta_id, especialidade, nome")
    .eq("id", doc.client_id).maybeSingle();
```

E troque a chamada:

```ts
    ({ snapshot } = await loadClientSnapshot(
      db, deps, contaId, { id: cliente.id, especialidade: cliente.especialidade }, month,
    ));
```

por:

```ts
    ({ snapshot } = await loadClientSnapshot(
      db, deps, contaId,
      { id: cliente.id, especialidade: cliente.especialidade, nome: cliente.nome },
      month,
    ));
```

- [ ] **Step 10: Rodar e ver passar**

Run: `deno test supabase/functions/report-docs/generate.test.ts
supabase/functions/report-docs/refresh.test.ts
supabase/functions/_shared/report-docs/snapshot.test.ts`
Expected: PASS em todos. Se algum teste PRÉ-EXISTENTE quebrar por causa da nova
assinatura de `loadClientSnapshot`, adicione `nome: "..."` (qualquer string) ao
`cliente` mockado desse teste — não mude a assinatura para tornar `nome` opcional.

Run em seguida: `git checkout -- deno.lock`.

- [ ] **Step 11: Commit**

```bash
git add supabase/functions/report-docs/snapshot-source.ts supabase/functions/report-docs/generate.ts supabase/functions/report-docs/refresh.ts supabase/functions/report-docs/generate.test.ts supabase/functions/report-docs/refresh.test.ts
git commit -m "feat(relatorios): cacheia foto do cliente e propaga nome no snapshot"
```

---

### Task 4: `CoverBlock.tsx` — página inteira, foto do cliente, config-driven

**Files:**
- Modify: `packages/report-blocks/theme.ts`
- Modify: `packages/report-blocks/blocks/CoverBlock.tsx`
- Modify: `packages/report-blocks/styles.css`
- Create: `packages/report-blocks/__tests__/CoverBlock.test.tsx`

**Interfaces:**
- Consumes: `ReportDocSnapshot.account.{profile_picture_url,client_name}` (Task 3).
- Produces: `export function CoverAvatar({ name, photoUrl, size }: { name: string;
  photoUrl: string | null; size: number }): JSX.Element` (novo, exportado de
  `CoverBlock.tsx` — Task 5 importa este componente). `export interface CoverConfig
  { kicker?: string; title?: string; subtitle?: string; color?: string; logoSize?:
  number }` (novo, exportado de `CoverBlock.tsx` — Task 5 importa este tipo em vez de
  redeclarar). `pickAccentFg` (já existente em `theme.ts`) passa a ser exportada.

- [ ] **Step 1: Exportar `pickAccentFg`**

Em `packages/report-blocks/theme.ts`, troque:

```ts
function pickAccentFg(acc: string, ink: string): string {
```

por:

```ts
export function pickAccentFg(acc: string, ink: string): string {
```

- [ ] **Step 2: Escrever os testes que falham para `CoverBlock`**

Crie `packages/report-blocks/__tests__/CoverBlock.test.tsx`:

```tsx
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { CoverBlock } from '../blocks/CoverBlock';
import { makeSnapshotFixture } from '../fixtures';
import type { ReportBlock } from '../types';

const coverBlock = (config?: Record<string, unknown>): ReportBlock =>
  config ? { id: 'c', type: 'cover', size: 'full', config } : { id: 'c', type: 'cover', size: 'full' };

describe('CoverBlock', () => {
  it('sem config: usa os valores computados do snapshot', () => {
    render(<CoverBlock block={coverBlock()} snapshot={makeSnapshotFixture()} />);
    expect(screen.getByText('Relatório mensal · Instagram')).toBeInTheDocument();
    expect(screen.getByText('Julho de 2026')).toBeInTheDocument();
    expect(screen.getByText('@dra.exemplo · Dermatologia · São Paulo')).toBeInTheDocument();
  });

  it('config presente: sobrescreve kicker, título e subtítulo', () => {
    render(
      <CoverBlock
        block={coverBlock({ kicker: 'Relatório especial', title: 'Julho turbinado', subtitle: '@outra' })}
        snapshot={makeSnapshotFixture()}
      />,
    );
    expect(screen.getByText('Relatório especial')).toBeInTheDocument();
    expect(screen.getByText('Julho turbinado')).toBeInTheDocument();
    expect(screen.getByText('@outra')).toBeInTheDocument();
    expect(screen.queryByText('Relatório mensal · Instagram')).not.toBeInTheDocument();
  });

  it('sem cor própria: usa as CSS vars do tema (comportamento atual)', () => {
    const { container } = render(<CoverBlock block={coverBlock()} snapshot={makeSnapshotFixture()} />);
    const header = container.querySelector('.rb-cover') as HTMLElement;
    expect(header.style.background).toBe('var(--rb-cover-bg, var(--rb-accent))');
    expect(header.style.color).toBe('var(--rb-cover-fg, var(--rb-accent-fg))');
  });

  it('cor própria: aplica a cor e calcula o contraste do texto', () => {
    const { container } = render(
      <CoverBlock block={coverBlock({ color: '#0f172a' })} snapshot={makeSnapshotFixture()} />,
    );
    const header = container.querySelector('.rb-cover') as HTMLElement;
    expect(header.style.background).toBe('#0f172a');
    expect(header.style.color).toBe('#ffffff');
  });

  it('logoSize aplica na altura da logo', () => {
    const snap = makeSnapshotFixture({
      branding: { workspace_name: 'DK Marketing', logo_url: 'https://x/logo.png', splash_url: null, accent_color: '#7c3aed' },
    });
    const { container } = render(<CoverBlock block={coverBlock({ logoSize: 60 })} snapshot={snap} />);
    const logo = container.querySelector('img[src="https://x/logo.png"]') as HTMLImageElement;
    expect(logo.style.height).toBe('60px');
  });

  it('avatar com foto: renderiza a imagem do cliente pela URL do snapshot', () => {
    const snap = makeSnapshotFixture({
      account: {
        handle: 'dra.exemplo', specialty: 'Dermatologia',
        profile_picture_url: 'https://x/avatar.jpg', client_name: 'Dra. Exemplo',
      },
    });
    const { container } = render(<CoverBlock block={coverBlock()} snapshot={snap} />);
    expect(container.querySelector('img[src="https://x/avatar.jpg"]')).toBeInTheDocument();
  });

  it('avatar sem foto: mostra a inicial do nome do cliente', () => {
    const snap = makeSnapshotFixture({
      account: { handle: 'dra.exemplo', specialty: 'Dermatologia', profile_picture_url: null, client_name: 'Beatriz' },
    });
    render(<CoverBlock block={coverBlock()} snapshot={snap} />);
    expect(screen.getByText('B')).toBeInTheDocument();
  });

  it('avatar sem client_name (snapshot antigo): cai pra inicial do handle', () => {
    const snap = makeSnapshotFixture({ account: { handle: 'dra.exemplo', specialty: 'Dermatologia' } });
    render(<CoverBlock block={coverBlock()} snapshot={snap} />);
    expect(screen.getByText('D')).toBeInTheDocument();
  });

  it('avatar com erro de carregamento: reverte pra inicial', () => {
    const snap = makeSnapshotFixture({
      account: {
        handle: 'dra.exemplo', specialty: 'Dermatologia',
        profile_picture_url: 'https://x/quebrada.jpg', client_name: 'Beatriz',
      },
    });
    const { container } = render(<CoverBlock block={coverBlock()} snapshot={snap} />);
    const img = container.querySelector('img[src="https://x/quebrada.jpg"]') as HTMLImageElement;
    fireEvent.error(img);
    expect(screen.getByText('B')).toBeInTheDocument();
  });

  it('splash: ganha a classe de teto de altura', () => {
    const snap = makeSnapshotFixture({
      branding: { workspace_name: 'DK', logo_url: null, splash_url: 'https://x/splash.jpg', accent_color: '#7c3aed' },
    });
    const { container } = render(<CoverBlock block={coverBlock()} snapshot={snap} />);
    expect(container.querySelector('img.rb-cover-splash')).toBeInTheDocument();
  });
});
```

- [ ] **Step 3: Rodar e ver falhar**

Run: `npx vitest run packages/report-blocks/__tests__/CoverBlock.test.tsx`
Expected: FAIL (o componente ainda não lê `block.config`, não tem avatar, nem classe
de splash).

- [ ] **Step 4: Reescrever `CoverBlock.tsx`**

Substitua o CONTEÚDO INTEIRO de `packages/report-blocks/blocks/CoverBlock.tsx` por:

```tsx
import { useState } from 'react';
import type { BlockProps } from '../BlockRenderer';
import { pickAccentFg } from '../theme';

const KICKER_DEFAULT = 'Relatório mensal · Instagram';
const LOGO_SIZE_DEFAULT = 36;
const COVER_INK_FALLBACK = '#171717';

export function CoverAvatar({
  name,
  photoUrl,
  size,
}: {
  name: string;
  photoUrl: string | null;
  size: number;
}) {
  const [failed, setFailed] = useState(false);
  const initial = name.trim().charAt(0).toUpperCase() || '?';
  const box = { width: size, height: size };

  if (photoUrl && !failed) {
    return (
      <img
        src={photoUrl}
        alt=""
        onError={() => setFailed(true)}
        style={{
          ...box,
          borderRadius: '50%',
          objectFit: 'cover',
          border: '1.5px solid currentColor',
          flexShrink: 0,
        }}
      />
    );
  }
  return (
    <div
      aria-hidden
      style={{
        ...box,
        borderRadius: '50%',
        border: '1.5px solid currentColor',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: size * 0.4,
        fontWeight: 600,
        flexShrink: 0,
      }}
    >
      {initial}
    </div>
  );
}

export interface CoverConfig {
  kicker?: string;
  title?: string;
  subtitle?: string;
  color?: string;
  logoSize?: number;
}

export function CoverBlock({ block, snapshot }: BlockProps) {
  const b = snapshot.branding;
  const config = (block.config ?? {}) as CoverConfig;
  const kicker = config.kicker ?? KICKER_DEFAULT;
  const title = config.title ?? snapshot.period.label;
  const subtitle =
    config.subtitle ??
    `@${snapshot.account.handle}${snapshot.account.specialty ? ` · ${snapshot.account.specialty}` : ''}`;
  const logoSize = config.logoSize ?? LOGO_SIZE_DEFAULT;
  const clientName = snapshot.account.client_name ?? snapshot.account.handle;

  const colorStyle = config.color
    ? { background: config.color, color: pickAccentFg(config.color, COVER_INK_FALLBACK) }
    : {
        background: 'var(--rb-cover-bg, var(--rb-accent))',
        color: 'var(--rb-cover-fg, var(--rb-accent-fg))',
      };

  return (
    <header
      className="rb-cover"
      style={{
        ...colorStyle,
        borderRadius: 12,
        padding: '2.5rem 2rem',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
        {b.logo_url ? (
          <img
            src={b.logo_url}
            alt=""
            style={{ height: logoSize, borderRadius: 8, background: '#fff', padding: 4 }}
          />
        ) : null}
        <CoverAvatar
          name={clientName}
          photoUrl={snapshot.account.profile_picture_url ?? null}
          size={logoSize}
        />
        <span style={{ fontWeight: 600 }}>{b.workspace_name}</span>
      </div>
      <p
        style={{
          margin: '2rem 0 0',
          opacity: 0.85,
          fontSize: '0.8rem',
          textTransform: 'uppercase',
          letterSpacing: '0.08em',
        }}
      >
        {kicker}
      </p>
      <h1
        style={{
          margin: '0.25rem 0 0',
          fontSize: '2rem',
          fontFamily: 'var(--rb-font-display, inherit)',
          letterSpacing: '-1px',
        }}
      >
        {title}
      </h1>
      <p style={{ margin: '0.25rem 0 0', opacity: 0.9 }}>{subtitle}</p>
      {b.splash_url ? (
        <img
          src={b.splash_url}
          alt=""
          className="rb-cover-splash"
          style={{
            marginTop: '1.5rem',
            width: '100%',
            aspectRatio: '21 / 9',
            objectFit: 'cover',
            borderRadius: 8,
          }}
        />
      ) : null}
    </header>
  );
}
```

- [ ] **Step 5: Adicionar o CSS de página inteira**

Em `packages/report-blocks/styles.css`, troque o bloco existente:

```css
@media print {
  .rb-page-break {
    break-after: page;
  }
  .rb-grid {
    max-width: none;
  }
}
```

por:

```css
.rb-cover {
  min-height: 80vh;
}
.rb-cover-splash {
  max-height: 320px;
}
@media print {
  .rb-page-break {
    break-after: page;
  }
  .rb-grid {
    max-width: none;
  }
  .rb-cover {
    /* Área útil do A4 com as margens de 10mm que o Gotenberg já usa
       (RelatorioPrintPage.tsx: `@page { margin: 10mm; }`). */
    min-height: 277mm;
    break-after: page;
  }
  .rb-cover-splash {
    /* Acompanha o teto de tela: garante que kicker+título+subtítulo+logo+splash
       cabem em 277mm mesmo com logoSize no máximo (achado de review externo
       2026-08-25 — sem isso o break-after não impede a PRÓPRIA capa de invadir
       a página 2). */
    max-height: 100mm;
  }
}
```

- [ ] **Step 6: Rodar e ver passar**

Run: `npx vitest run packages/report-blocks/__tests__/CoverBlock.test.tsx`
Expected: PASS em todos os testes.

Run também (garante que nada mais quebrou):
`npx vitest run packages/report-blocks/`

- [ ] **Step 7: Commit**

```bash
git add packages/report-blocks/theme.ts packages/report-blocks/blocks/CoverBlock.tsx packages/report-blocks/styles.css packages/report-blocks/__tests__/CoverBlock.test.tsx
git commit -m "feat(relatorios): capa em pagina inteira com foto do cliente e cor propria"
```

---

### Task 5: `CoverEditor.tsx` — edição inline no canvas do CRM

**Files:**
- Create: `apps/crm/src/pages/relatorio-editor/CoverEditor.tsx`
- Create: `apps/crm/src/pages/relatorio-editor/__tests__/CoverEditor.test.tsx`
- Modify: `apps/crm/src/pages/relatorio-editor/EditorCanvas.tsx`
- Modify: `apps/crm/src/pages/relatorio-editor/__tests__/EditorCanvas.test.tsx`

**Interfaces:**
- Consumes: `normalizeCoverColorPatch`, `stepCoverLogoSize` (Task 1, de
  `./layoutOps`); `CoverAvatar`, `CoverConfig`, `pickAccentFg` (Task 4, de
  `@mesaas/report-blocks/blocks/CoverBlock` e `@mesaas/report-blocks/theme`).
- Produces: `CoverEditor({ block, snapshot, onConfigChange }): JSX.Element`, usado
  por `EditorCanvas.tsx`.

- [ ] **Step 1: Escrever os testes que falham para `CoverEditor`**

Crie `apps/crm/src/pages/relatorio-editor/__tests__/CoverEditor.test.tsx`:

```tsx
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { CoverEditor } from '../CoverEditor';
import { makeSnapshotFixture } from '@mesaas/report-blocks/fixtures';
import type { ReportBlock } from '@mesaas/report-blocks/types';

const coverBlock = (config?: Record<string, unknown>): ReportBlock =>
  config ? { id: 'c', type: 'cover', size: 'full', config } : { id: 'c', type: 'cover', size: 'full' };

describe('CoverEditor', () => {
  it('inputs mostram os valores computados por default', () => {
    render(
      <CoverEditor block={coverBlock()} snapshot={makeSnapshotFixture()} onConfigChange={vi.fn()} />,
    );
    expect(screen.getByRole('textbox', { name: 'Texto de destaque da capa' })).toHaveValue(
      'Relatório mensal · Instagram',
    );
    expect(screen.getByRole('textbox', { name: 'Título da capa' })).toHaveValue('Julho de 2026');
    expect(screen.getByRole('textbox', { name: 'Subtítulo da capa' })).toHaveValue(
      '@dra.exemplo · Dermatologia · São Paulo',
    );
  });

  it('editar o título chama onConfigChange com o novo valor', () => {
    const onConfigChange = vi.fn();
    render(
      <CoverEditor block={coverBlock()} snapshot={makeSnapshotFixture()} onConfigChange={onConfigChange} />,
    );
    fireEvent.change(screen.getByRole('textbox', { name: 'Título da capa' }), {
      target: { value: 'Julho especial' },
    });
    expect(onConfigChange).toHaveBeenCalledWith('c', { title: 'Julho especial' });
  });

  it('limpar o título reverte pra herdar (grava undefined)', () => {
    const onConfigChange = vi.fn();
    render(
      <CoverEditor
        block={coverBlock({ title: 'Julho especial' })}
        snapshot={makeSnapshotFixture()}
        onConfigChange={onConfigChange}
      />,
    );
    fireEvent.change(screen.getByRole('textbox', { name: 'Título da capa' }), { target: { value: '' } });
    expect(onConfigChange).toHaveBeenCalledWith('c', { title: undefined });
  });

  it('stepper de logo: aumentar e diminuir chamam onConfigChange com o próximo tamanho', () => {
    const onConfigChange = vi.fn();
    render(
      <CoverEditor block={coverBlock()} snapshot={makeSnapshotFixture()} onConfigChange={onConfigChange} />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Aumentar logo' }));
    expect(onConfigChange).toHaveBeenCalledWith('c', { logoSize: 44 });
    fireEvent.click(screen.getByRole('button', { name: 'Diminuir logo' }));
    expect(onConfigChange).toHaveBeenCalledWith('c', { logoSize: 28 });
  });

  it('cor de 8 dígitos vinda do ColorPicker é normalizada antes do onConfigChange', () => {
    const onConfigChange = vi.fn();
    render(
      <CoverEditor block={coverBlock()} snapshot={makeSnapshotFixture()} onConfigChange={onConfigChange} />,
    );
    const native = screen.getByTestId('estudio-color-native') as HTMLInputElement;
    fireEvent.click(screen.getByLabelText('Cor da capa'));
    fireEvent.change(native, { target: { value: '#0f766e' } });
    expect(onConfigChange).toHaveBeenCalledWith('c', { color: '#0f766e' });
  });

  it('com cor própria definida: botão "usar cor de destaque" aparece e remove o override', () => {
    const onConfigChange = vi.fn();
    render(
      <CoverEditor
        block={coverBlock({ color: '#0f172a' })}
        snapshot={makeSnapshotFixture()}
        onConfigChange={onConfigChange}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'usar cor de destaque' }));
    expect(onConfigChange).toHaveBeenCalledWith('c', { color: undefined });
  });

  it('sem cor própria: botão "usar cor de destaque" não aparece', () => {
    render(
      <CoverEditor block={coverBlock()} snapshot={makeSnapshotFixture()} onConfigChange={vi.fn()} />,
    );
    expect(screen.queryByRole('button', { name: 'usar cor de destaque' })).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run apps/crm/src/pages/relatorio-editor/__tests__/CoverEditor.test.tsx`
Expected: FAIL (`CoverEditor` ainda não existe).

- [ ] **Step 3: Criar `CoverEditor.tsx`**

Crie `apps/crm/src/pages/relatorio-editor/CoverEditor.tsx`:

```tsx
// Edição inline da capa no canvas: reproduz a MESMA casca visual do CoverBlock
// (fundo, logo, avatar) e troca kicker/título/subtítulo por inputs. Diferente do
// SectionHeaderEditor (que não reproduz chrome nenhum), a capa precisa do preview
// real porque cor e contraste são o próprio ponto do recurso (spec 2026-08-25).
import type { CSSProperties } from 'react';
import { Minus, Plus } from 'lucide-react';
import { ColorPicker } from '@/components/shared/ColorPicker';
import { CoverAvatar, type CoverConfig } from '@mesaas/report-blocks/blocks/CoverBlock';
import { pickAccentFg } from '@mesaas/report-blocks/theme';
import type { ReportBlock, ReportDocSnapshot } from '@mesaas/report-blocks/types';
import { normalizeCoverColorPatch, stepCoverLogoSize } from './layoutOps';

const KICKER_DEFAULT = 'Relatório mensal · Instagram';
const LOGO_SIZE_DEFAULT = 36;
const COVER_INK_FALLBACK = '#171717';

export interface CoverEditorProps {
  block: ReportBlock;
  snapshot: ReportDocSnapshot;
  onConfigChange: (id: string, patch: Record<string, unknown>) => void;
}

export function CoverEditor({ block, snapshot, onConfigChange }: CoverEditorProps) {
  const b = snapshot.branding;
  const config = (block.config ?? {}) as CoverConfig;
  const kicker = config.kicker ?? KICKER_DEFAULT;
  const title = config.title ?? snapshot.period.label;
  const subtitle =
    config.subtitle ??
    `@${snapshot.account.handle}${snapshot.account.specialty ? ` · ${snapshot.account.specialty}` : ''}`;
  const logoSize = config.logoSize ?? LOGO_SIZE_DEFAULT;
  const clientName = snapshot.account.client_name ?? snapshot.account.handle;
  const accentColor = snapshot.branding.accent_color;

  const colorStyle = config.color
    ? { background: config.color, color: pickAccentFg(config.color, COVER_INK_FALLBACK) }
    : {
        background: 'var(--rb-cover-bg, var(--rb-accent))',
        color: 'var(--rb-cover-fg, var(--rb-accent-fg))',
      };

  const emitColor = (hex: string) => {
    const patch = normalizeCoverColorPatch(hex);
    if (Object.keys(patch).length > 0) onConfigChange(block.id, patch);
  };

  return (
    <div className="rb-cover" style={{ ...colorStyle, borderRadius: 12, padding: '2.5rem 2rem' } as CSSProperties}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
        {b.logo_url ? (
          <img
            src={b.logo_url}
            alt=""
            style={{ height: logoSize, borderRadius: 8, background: '#fff', padding: 4 }}
          />
        ) : null}
        <CoverAvatar
          name={clientName}
          photoUrl={snapshot.account.profile_picture_url ?? null}
          size={logoSize}
        />
        <span style={{ fontWeight: 600 }}>{b.workspace_name}</span>
        <div style={{ display: 'flex', gap: '0.25rem', marginLeft: 'auto' }}>
          <button
            type="button"
            className="rb-edit-btn"
            aria-label="Diminuir logo"
            onClick={() => onConfigChange(block.id, { logoSize: stepCoverLogoSize(config.logoSize, -1) })}
          >
            <Minus className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            className="rb-edit-btn"
            aria-label="Aumentar logo"
            onClick={() => onConfigChange(block.id, { logoSize: stepCoverLogoSize(config.logoSize, 1) })}
          >
            <Plus className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
      <input
        aria-label="Texto de destaque da capa"
        value={kicker}
        onChange={(e) => onConfigChange(block.id, { kicker: e.target.value || undefined })}
        className="rb-section-input"
        style={{
          marginTop: '2rem',
          fontSize: '0.8rem',
          textTransform: 'uppercase',
          letterSpacing: '0.08em',
          opacity: 0.85,
          color: 'inherit',
        }}
      />
      <input
        aria-label="Título da capa"
        value={title}
        onChange={(e) => onConfigChange(block.id, { title: e.target.value || undefined })}
        className="rb-section-input"
        style={{
          fontSize: '2rem',
          fontFamily: 'var(--rb-font-display, inherit)',
          letterSpacing: '-1px',
          color: 'inherit',
        }}
      />
      <input
        aria-label="Subtítulo da capa"
        value={subtitle}
        onChange={(e) => onConfigChange(block.id, { subtitle: e.target.value || undefined })}
        className="rb-section-input"
        style={{ opacity: 0.9, color: 'inherit' }}
      />
      {b.splash_url ? (
        <img
          src={b.splash_url}
          alt=""
          className="rb-cover-splash"
          style={{ marginTop: '1.5rem', width: '100%', aspectRatio: '21 / 9', objectFit: 'cover', borderRadius: 8 }}
        />
      ) : null}
      <div style={{ marginTop: '1.5rem' }}>
        <ColorPicker
          value={config.color ?? accentColor}
          onChange={emitColor}
          brandColors={[accentColor]}
          allowAlpha={false}
          label="Cor da capa"
        />
        {config.color && (
          <button
            type="button"
            className="rb-appearance-reset"
            onClick={() => onConfigChange(block.id, { color: undefined })}
          >
            usar cor de destaque
          </button>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npx vitest run apps/crm/src/pages/relatorio-editor/__tests__/CoverEditor.test.tsx`
Expected: PASS em todos os testes.

- [ ] **Step 5: Commit**

```bash
git add apps/crm/src/pages/relatorio-editor/CoverEditor.tsx apps/crm/src/pages/relatorio-editor/__tests__/CoverEditor.test.tsx
git commit -m "feat(relatorios): CoverEditor edita capa inline no canvas"
```

- [ ] **Step 6: Atualizar os testes existentes de `EditorCanvas.test.tsx` afetados**

O fixture `layout()` no topo do arquivo já tem um bloco `{ id: 'a', type: 'cover',
size: 'full' }` como PRIMEIRO bloco. Depois deste plano, a capa deixa de mostrar os
botões de largura — 3 testes existentes que contam/indexam esses botões precisam de
ajuste. Troque:

```tsx
  it('renderiza os widgets com chrome: alça, largura e excluir por bloco', () => {
    render(<EditorCanvas layout={layout()} snapshot={makeSnapshotFixture()} onChange={() => {}} />);
    expect(screen.getByText('DK Marketing')).toBeInTheDocument();
    expect(screen.getAllByLabelText('Reordenar bloco')).toHaveLength(2);
    expect(screen.getAllByLabelText('Aumentar largura')).toHaveLength(2);
    expect(screen.getAllByLabelText('Diminuir largura')).toHaveLength(2);
    expect(screen.getAllByLabelText('Excluir bloco')).toHaveLength(2);
  });
```

por:

```tsx
  it('renderiza os widgets com chrome: alça, largura e excluir por bloco', () => {
    render(<EditorCanvas layout={layout()} snapshot={makeSnapshotFixture()} onChange={() => {}} />);
    expect(screen.getByText('DK Marketing')).toBeInTheDocument();
    expect(screen.getAllByLabelText('Reordenar bloco')).toHaveLength(2);
    // A capa é sempre largura cheia (spec 2026-08-25): só o kpi_reach (block 'b')
    // tem os botões de largura.
    expect(screen.getAllByLabelText('Aumentar largura')).toHaveLength(1);
    expect(screen.getAllByLabelText('Diminuir largura')).toHaveLength(1);
    expect(screen.getAllByLabelText('Excluir bloco')).toHaveLength(2);
  });
```

E troque:

```tsx
  it('aumentar largura chama onChange com o size seguinte', () => {
    const onChange = vi.fn();
    render(<EditorCanvas layout={layout()} snapshot={makeSnapshotFixture()} onChange={onChange} />);
    fireEvent.click(screen.getAllByLabelText('Aumentar largura')[1]);
    expect(onChange.mock.calls[0][0].blocks[1].size).toBe('half');
  });

  it('diminuir largura em third não dispara onChange (no-op preservado)', () => {
    const onChange = vi.fn();
    render(<EditorCanvas layout={layout()} snapshot={makeSnapshotFixture()} onChange={onChange} />);
    fireEvent.click(screen.getAllByLabelText('Diminuir largura')[1]);
    expect(onChange).not.toHaveBeenCalled();
  });
```

por:

```tsx
  it('aumentar largura chama onChange com o size seguinte', () => {
    const onChange = vi.fn();
    render(<EditorCanvas layout={layout()} snapshot={makeSnapshotFixture()} onChange={onChange} />);
    fireEvent.click(screen.getAllByLabelText('Aumentar largura')[0]);
    expect(onChange.mock.calls[0][0].blocks[1].size).toBe('half');
  });

  it('diminuir largura em third não dispara onChange (no-op preservado)', () => {
    const onChange = vi.fn();
    render(<EditorCanvas layout={layout()} snapshot={makeSnapshotFixture()} onChange={onChange} />);
    fireEvent.click(screen.getAllByLabelText('Diminuir largura')[0]);
    expect(onChange).not.toHaveBeenCalled();
  });
```

Depois, adicione um teste NOVO ao final do `describe('EditorCanvas', ...)` (logo
antes do `});` que fecha o describe):

```tsx
  it('capa com onConfigChange: usa o CoverEditor e some com os botões de largura', () => {
    const onConfigChange = vi.fn();
    const l: ReportLayout = { version: 1, blocks: [{ id: 'c', type: 'cover', size: 'full' }] };
    render(
      <EditorCanvas
        layout={l}
        snapshot={makeSnapshotFixture()}
        onChange={() => {}}
        onConfigChange={onConfigChange}
      />,
    );
    const title = screen.getByRole('textbox', { name: 'Título da capa' });
    fireEvent.change(title, { target: { value: 'Julho especial' } });
    expect(onConfigChange).toHaveBeenCalledWith('c', { title: 'Julho especial' });
    expect(screen.queryByLabelText('Aumentar largura')).not.toBeInTheDocument();
  });
```

- [ ] **Step 7: Rodar e ver falhar**

Run: `npx vitest run apps/crm/src/pages/relatorio-editor/__tests__/EditorCanvas.test.tsx`
Expected: FAIL (o `EditorCanvas` ainda não importa `CoverEditor` nem esconde os
botões de largura para `cover`).

- [ ] **Step 8: Atualizar `EditorCanvas.tsx`**

Em `apps/crm/src/pages/relatorio-editor/EditorCanvas.tsx`:

1. Adicione o import (junto aos outros imports locais, perto de
   `import { SectionHeaderEditor } from './SectionHeaderEditor';`):

```ts
import { CoverEditor } from './CoverEditor';
```

2. Troque:

```tsx
  const body =
    isText && renderTextBlock ? (
      renderTextBlock(block)
    ) : block.type === 'section_header' && onConfigChange ? (
      <SectionHeaderEditor block={block} onConfigChange={onConfigChange} />
    ) : Component && !blockHasData(block, snapshot) ? (
```

por:

```tsx
  const body =
    isText && renderTextBlock ? (
      renderTextBlock(block)
    ) : block.type === 'cover' && onConfigChange ? (
      <CoverEditor block={block} snapshot={snapshot} onConfigChange={onConfigChange} />
    ) : block.type === 'section_header' && onConfigChange ? (
      <SectionHeaderEditor block={block} onConfigChange={onConfigChange} />
    ) : Component && !blockHasData(block, snapshot) ? (
```

3. Troque o bloco da toolbar:

```tsx
        <button
          type="button"
          className="rb-edit-btn"
          aria-label="Diminuir largura"
          onClick={() => onResize(-1)}
        >
          <Minus className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          className="rb-edit-btn"
          aria-label="Aumentar largura"
          onClick={() => onResize(1)}
        >
          <Plus className="h-3.5 w-3.5" />
        </button>
```

por:

```tsx
        {block.type !== 'cover' && (
          <>
            <button
              type="button"
              className="rb-edit-btn"
              aria-label="Diminuir largura"
              onClick={() => onResize(-1)}
            >
              <Minus className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              className="rb-edit-btn"
              aria-label="Aumentar largura"
              onClick={() => onResize(1)}
            >
              <Plus className="h-3.5 w-3.5" />
            </button>
          </>
        )}
```

- [ ] **Step 9: Rodar e ver passar**

Run: `npx vitest run apps/crm/src/pages/relatorio-editor/__tests__/EditorCanvas.test.tsx`
Expected: PASS em todos os testes.

- [ ] **Step 10: Rodar a suíte inteira do editor + typecheck**

Run: `npx vitest run apps/crm/src/pages/relatorio-editor/`
Expected: PASS em tudo.

Run: `npx tsc -p apps/crm/tsconfig.json --noEmit`
Expected: sem erros.

- [ ] **Step 11: Commit**

```bash
git add apps/crm/src/pages/relatorio-editor/EditorCanvas.tsx apps/crm/src/pages/relatorio-editor/__tests__/EditorCanvas.test.tsx
git commit -m "feat(relatorios): capa usa CoverEditor no canvas e esconde botoes de largura"
```

---

## Verificação final (depois de todas as tasks)

```bash
npx tsc -p apps/crm/tsconfig.json   --noEmit
npx tsc -p apps/hub/tsconfig.json   --noEmit
npx tsc -p apps/admin/tsconfig.json --noEmit
npx tsc -p tsconfig.scripts.json    --noEmit
npm run lint
npm run format:check
npm run test
npm run test:functions
git checkout -- deno.lock
```

Browser (manual, per achado do review externo sobre não ter credenciais de CRM
neste worktree — fazer junto com o usuário ou pedir para ele conferir): capa em
página inteira no editor e no Hub, PDF com a capa sozinha na página 1 mesmo com
splash configurado, edição dos 5 controles refletindo no preview imediatamente,
fallback de avatar com um cliente conectado mas sem foto de perfil no Instagram.
