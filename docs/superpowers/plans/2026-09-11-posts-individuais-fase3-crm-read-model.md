# Posts individuais — Fase 3 (leitura no CRM) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the CRM's Entregas page a read model for individual post production processes (`post_processes`/`post_process_steps`/`post_process_events`, all live in prod since fase 2) — a mixed board, a "Sem processo" section, a read-only production section in the post drawer, process context in Publicações, and a Concluídas entry — entirely behind the `feature_post_processes` plan flag, with zero interactive commands.

**Architecture:** Introduce a `BoardEntity` discriminated union (`kind: 'workflow' | 'post'`) in a new pure module `boardEntity.ts`, with the common projection from spec §8.3 (`etapaOrdem`, `etapaNome`, `responsavel`, `prazoEfetivo`, `posicao`) and two adapters (`toWorkflowEntity(card)`, `toPostEntity(process, ctx)`). `useEntregasData({ postProcessesEnabled })` grows ONE flag-gated batched fetch of vigente processes (`estado IN ('ativo','concluido')`, one PostgREST embed query, `getVigentePostProcesses()` in a new `store/postProcesses.ts`) and folds the active ones into `postEntities: PostEntity[]` alongside the untouched workflow-only `cards: BoardCard[]`. The existing `boardRows.ts` (added by PR #478, column identity by etapa `ordem`) is extended, not created: `buildBoardRows` takes `BoardEntity[]`, each `BoardColumn` keeps `cards: BoardCard[]` and gains `posts: PostEntity[]`, and the spec §4.1 template+signature row key is selected by an option the page derives from the flag. Kanban and List keep their `cards` prop (seven existing view tests build partial `BoardCard` fixtures by hand, and the flag-off path must run zero adapter code) and gain an optional `postEntities` prop; Calendar and Chart stay workflow-only. The drawer fetches the post's vigente process on its own (flag-gated) and renders a read-only `PostProductionSection`, which fetches events on demand.

**Tech Stack:** React 19, TanStack Query v5, TypeScript, Vitest + Testing Library, dnd-kit (unchanged), lucide-react. No new dependencies.

## Global Constraints

- **Ships dark, unconditionally.** Every pixel of new UI (the Todos/Fluxos/Posts individuais filter, individual-post cards, the "Sem processo" section, the drawer's production section, the "Individual · <etapa>" tags in Publicações, the "Somente fluxos" notes, the Concluídas "Post individual" entries, the explainer/tour copy variants) is gated behind `features?.feature_post_processes === true` from `useWorkspaceLimits()` — the same idiom already used by `feature_tiktok`/`feature_instagram_automation` (`apps/crm/src/pages/entregas/components/PostAutomationSection.tsx:70`, `PostEditorBody.tsx:330`). Strict `=== true`, optional-chained, no `isUnlimited` bypass. When the flag is false (every real workspace today — it defaults `false` on all plans), the page must render byte-for-byte what it renders today: same DOM, same queries fired, same URL, same localStorage keys, same behavior. `useWorkspaceLimits()` is already mounted app-wide (`components/layout/ProtectedRoute.tsx`, `Sidebar.tsx`, `MobileNav.tsx`), so the new calls in `EntregasPage`, `StandalonePostDrawer`, `WorkflowDrawer` and `ConcludedView` dedupe on the `['workspace-limits', workspaceId]` cache and fire no extra request. This is what makes it safe to merge straight to `main` (Vercel auto-deploys the CRM on every push to `main`) without a staged rollout step.
- **Exactly two flag-independent changes are allowed, both named here.** (1) The "Responsável" select label in `PostEditorBody.tsx:364` becomes "Responsável do post" in every drawer (spec §5.4, a one-line copy change with no test asserting the old label). (2) `useEntregasData().refresh()` additionally invalidates `['post-processes']`, `['post-process-covers']`, `['post-process-events']`, `['post-process']`, `['concluded-workflows']` and `['concluded-summaries']` (spec §4.4: "`refresh()` da página passa a invalidar `concluded-*`") — inert when the flag is off because those queries are disabled or not mounted. Everything else is gated. The `BoardEntity` type refactor changes types only; `buildBoardRows` with `signatureRows: false` (the flag-off value) produces today's keys and labels.
- **Fase 3 is read-only. No interactive commands.** Nothing in this plan calls `detach_posts_keeping_process`, `apply_post_process`, `transition_post_process`, `update_post_process_step`, `remove_post_process`, `attach_post_closing_process`, or `reorder_fluxos_board`. Individual-post cards render **without** a drag handle, **without** "Avançar etapa"/"Voltar etapa" buttons, and the drawer's production section renders **without** any header action button (Concluir, Reabrir, Remover, Aplicar, Vincular). All of that is fase 4 (`docs/superpowers/specs/2026-09-10-posts-individuais-fluxos-design.md` §5, §6.2). A column that mixes workflow and post cards keeps drag-and-drop working for the **workflow** cards exactly as today (unchanged calls to `updateWorkflowPositions`); a post card in that column is mounted with `useSortable({ id, disabled: { draggable: true, droppable: false } })`: never draggable (no `attributes`/`listeners` are spread), but still a droppable so dnd-kit measures its rect and a workflow card released over it resolves to the right column through `findCardColumn` (Task 5). `disabled: true` would switch the droppable off too, and `over.id` would then never be a post id. `dropSlot.index` remains an index over the column's WORKFLOW cards only.
- **Fingerprint mirror: no `parseInt`/`Number()`.** `buildFingerprint`/`buildTemplateFingerprint` (Task 1) pass every field through `String(value ?? '')` with no numeric reformatting — the SQL side (`workflow_fingerprint`/`template_fingerprint`, migration `20260919000001`) serializes the *raw* stored value with `coalesce(x::text, '')`, and re-parsing it in TS would silently diverge. `String(null)` is `'null'`, hence the `?? ''`.
- **Never reuse `workflow_posts.board_ordem`.** That column belongs to the Publicações board (spec §4.2). Individual-post ordering on the Fluxos board reads `post_processes.board_position` exclusively (read-only in this phase).
- **One batch, no N+1.** Processes come from ONE query per page load (`getVigentePostProcesses`, ativo + concluido together, embedding steps and the post summary), split client-side into board entities, the Concluídas list and the "has a process" exclusion set. Never copy `ConcludedView.tsx`'s per-workflow `Promise.all` loop (lines 58-85). Events are fetched on demand, batched by post id list.
- **Row identity for the mixed board follows spec §4.1 exactly, behind the flag.** With `signatureRows: true` a row's key is `template:<id>#<assinatura>` when the entity's `template_id` is non-null, else `custom#<assinatura>`, where `<assinatura>` is the ordered stage signature `(ordem, nome, tipo)` — so two flows of the same template with divergent step snapshots get separate rows (and therefore tabs, `TABS_THRESHOLD = 1` stays, registered follow-up). A row without a template is labelled "Etapas personalizadas". With `signatureRows: false` (flag off) the key is today's `template:<id>` / `nomes.join(' → ')` and the label is unchanged, so no existing workspace sees its rows split or its `entregas_fluxos_sorts_<contaId>` keys change. Signature-mode keys use only printable separators (`#`, `;`, `|`) — nothing in this phase compares them with the DB column `post_processes.assinatura`.
- **`entidade` is derived, not stored, when the flag is off.** The page seeds `entidade` state per spec §4.1, but every consumer (URL serializer, views, persistence) reads `effectiveEntidade = postProcessesEnabled ? entidade : 'fluxos'`, so a flag-off user never sees `?entidade=` in the URL nor gains an `entregas_entidade_<contaId>` key.
- **Verify before pushing:** `npm run lint`, `npm run format:check` (`npm run format` auto-fixes), the four `tsc` commands (`npx tsc -p apps/crm/tsconfig.json --noEmit`, `apps/hub`, `apps/admin`, `tsconfig.scripts.json`), `npm run test`. This phase touches no edge functions and no migrations, so `check:functions`/`test:functions`/`migration-version-guard` are unaffected but still run in CI.
- **Copy rules:** Portuguese UI, no em-dashes in new user-facing copy (use period or colon).

## File Structure

| File | Status | Responsibility |
|---|---|---|
| `apps/crm/src/pages/entregas/fingerprint.ts` | create | TS mirror of `workflow_fingerprint`/`template_fingerprint` (pure) |
| `apps/crm/src/store/postProcesses.ts` | create | Types + batched readers for `post_processes`/steps/events |
| `apps/crm/src/store/posts.ts` | modify | Export `POST_CONTEXT_COLUMNS` and `mapPostContextRow` |
| `apps/crm/src/store/index.ts` | modify | Re-export the new module |
| `apps/crm/src/pages/entregas/etapaPrazo.ts` | modify | `prazo_efetivo` in `etapaDeadlineDateOf`; `deadlineFromPrazoEfetivo`; `matchesDeadlineFilter` |
| `apps/crm/src/pages/entregas/boardEntity.ts` | create | `BoardEntity` union, adapters, signature, mixed sorts |
| `apps/crm/src/pages/entregas/entityFilters.ts` | create | Page filters applied to a `PostEntity` |
| `apps/crm/src/pages/entregas/semProcesso.ts` | create | Pure selection for the "Sem processo" section |
| `apps/crm/src/pages/entregas/boardRows.ts` | modify | Entities in, `posts` per column, `signatureRows`, `templateId` |
| `apps/crm/src/pages/entregas/hooks/useEntregasData.ts` | modify | Flag-gated process batch; `postEntities`, `processByPostId`, counts; delete dead `BoardRow` |
| `apps/crm/src/hooks/useWorkspaceLimits.ts` | modify | `feature_post_processes: boolean` |
| `apps/crm/src/pages/entregas/viewQuery.ts` | modify | `entidade` URL param |
| `apps/crm/src/pages/entregas/entregasPrefs.ts` | modify | `loadLastEntidade`/`persistLastEntidade`/`hasLastMode` |
| `apps/crm/src/pages/entregas/components/EntidadeToggle.tsx` | create | Todos / Fluxos / Posts individuais pill + helper text |
| `apps/crm/src/pages/entregas/components/PostProcessCard.tsx` | create | Board card for a `PostEntity` (no drag, no actions) |
| `apps/crm/src/pages/entregas/components/SemProcessoSection.tsx` | create | Avulsos without a vigente process |
| `apps/crm/src/pages/entregas/components/PostProductionSection.tsx` | create | Read-only production section in the drawer |
| `apps/crm/src/pages/entregas/components/postTimeline.ts` | modify | Third source: `post_process_events`, `kind: 'process'` |
| `apps/crm/src/pages/entregas/components/PostTimelinePopover.tsx` | modify | Optional `processEvents` prop |
| `apps/crm/src/pages/entregas/components/WorkflowDrawer.tsx` | modify | Flag-gated batched process events → popover |
| `apps/crm/src/pages/entregas/components/StandalonePostDrawer.tsx` | modify | Header tag; vigente process query; prop to editor |
| `apps/crm/src/pages/entregas/components/PostEditorBody.tsx` | modify | "Responsável do post"; `postProcess` prop; section slot |
| `apps/crm/src/pages/entregas/components/WorkflowModals.tsx` | modify | Import canonical `BoardCard`; delete local duplicate |
| `apps/crm/src/pages/entregas/views/KanbanView.tsx` | modify | Mixed columns, counts, empty gate, `findCardColumn` posts |
| `apps/crm/src/pages/entregas/views/ListView.tsx` | modify | Post rows with "Individual" tag |
| `apps/crm/src/pages/entregas/views/PostsKanbanView.tsx`, `PostsListView.tsx` | modify | "Individual · <etapa>" tag via `processEtapaByPostId` |
| `apps/crm/src/pages/entregas/views/CalendarView.tsx`, `ChartView.tsx` | modify | "Somente fluxos" note |
| `apps/crm/src/pages/entregas/views/ConcludedView.tsx` | modify | "Post individual" entries from the shared batch |
| `apps/crm/src/pages/entregas/components/ComoFuncionaPanel.tsx`, `tour/entregasTour.ts` | modify | Flag-selected copy variants |
| `apps/crm/src/pages/entregas/EntregasPage.tsx` | modify | Flag read, hook options, `entidade`, wiring of everything above |
| `apps/crm/style.css` | modify | `.post-fluxo-tag--individual`, `.post-production*`, `.entregas-somente-fluxos`, `.sem-processo*` |

Spec §4.4 row "Calendário de publicações: painel de detalhe mostra etapa e prazo do processo" is **deferred to fase 4** with a reason: `CalendarPostDetailPanel` is only mounted by `WorkflowCalendarView.tsx` (a post inside a fluxo, which by invariant has no vigente process), and the Publicações calendar in `CalendarView` opens the drawer directly (`onPostClick`), where Task 12's section already shows etapa and prazo. There is no surface to change in fase 3.

---

### Task 1: Fingerprint mirror (`buildFingerprint` / `buildTemplateFingerprint`)

**Files:**
- Create: `apps/crm/src/pages/entregas/fingerprint.ts`
- Test: `apps/crm/src/pages/entregas/__tests__/fingerprint.test.ts`

**Interfaces:**
- Consumes: nothing (pure). Mirrors `supabase/migrations/20260919000001_post_process_fingerprints.sql`.
- Produces:
  - `export interface FingerprintEtapa { id?: number | null; ordem: number; nome?: string | null; tipo?: string | null; status?: string | null; responsavel_id?: number | null; prazo_dias?: number | null; tipo_prazo?: string | null; data_limite?: string | null; iniciado_em?: string | null }` (a `WorkflowEtapa` satisfies it)
  - `export function buildFingerprint(workflow: { etapa_atual: number | null | undefined }, etapas: readonly FingerprintEtapa[]): string`
  - `export function buildTemplateFingerprint(etapas: unknown): string` (a `WorkflowTemplate['etapas']` array; anything that is not an array yields `''`)
  - Fase 4 sends these values as `p_fingerprint` / `p_template_fingerprint`. Nothing in fase 3 calls them.

- [ ] **Step 1: Write the failing test with the SQL suite's exact fixtures**

```ts
// apps/crm/src/pages/entregas/__tests__/fingerprint.test.ts
import { describe, expect, it } from 'vitest';
import { buildFingerprint, buildTemplateFingerprint } from '../fingerprint';

// Fixtures copied verbatim from supabase/tests/entitlements/85_post_process_fingerprints.sql
// (85.0, 85.3, 85.4, 85.5, 85.6). The SQL side is the reference; these strings are the
// contract the RPCs of fase 4 will compare against.
describe('buildFingerprint', () => {
  it('85.0: formato exato do fluxo, com nulos, tipo default e timestamp UTC', () => {
    const fp = buildFingerprint({ etapa_atual: 1 }, [
      {
        id: 1,
        ordem: 0,
        nome: 'Copy',
        prazo_dias: 2,
        tipo_prazo: 'corridos',
        tipo: 'padrao',
        status: 'concluido',
        iniciado_em: '2026-09-01T12:00:00+00:00',
        data_limite: null,
      },
      {
        id: 2,
        ordem: 1,
        nome: 'Design',
        prazo_dias: 3,
        tipo_prazo: 'uteis',
        tipo: null,
        status: 'ativo',
        iniciado_em: '2026-09-03T09:30:00+00:00',
        data_limite: '2026-09-10',
      },
    ]);
    expect(fp).toBe(
      'etapa_atual=1\n' +
        '0|Copy|padrao|concluido||2|corridos||2026-09-01T12:00:00.000Z\n' +
        '1|Design|padrao|ativo||3|uteis|2026-09-10|2026-09-03T09:30:00.000Z',
    );
  });

  it('85.5: uma etapa sem iniciado_em nem data_limite serializa campos vazios no fim', () => {
    const fp = buildFingerprint({ etapa_atual: 1 }, [
      { id: 1, ordem: 0, nome: 'Copy', prazo_dias: 2, tipo_prazo: 'corridos', status: 'ativo' },
    ]);
    expect(fp).toBe('etapa_atual=1\n0|Copy|padrao|ativo||2|corridos||');
  });

  it('85.6: etapa_atual null serializa cabeçalho vazio, distinto de 0', () => {
    expect(buildFingerprint({ etapa_atual: null }, [])).toBe('etapa_atual=');
    expect(buildFingerprint({ etapa_atual: 0 }, [])).toBe('etapa_atual=0');
    expect(buildFingerprint({ etapa_atual: undefined }, [])).toBe('etapa_atual=');
  });

  it('ordena por (ordem, id), o mesmo desempate do ORDER BY e.ordem, e.id', () => {
    const fp = buildFingerprint({ etapa_atual: 0 }, [
      { id: 9, ordem: 0, nome: 'B', prazo_dias: 1, tipo_prazo: 'corridos', status: 'pendente' },
      { id: 3, ordem: 0, nome: 'A', prazo_dias: 1, tipo_prazo: 'corridos', status: 'pendente' },
      { id: 1, ordem: 1, nome: 'C', prazo_dias: 1, tipo_prazo: 'corridos', status: 'pendente' },
    ]);
    expect(fp.split('\n').slice(1)).toEqual([
      '0|A|padrao|pendente||1|corridos||',
      '0|B|padrao|pendente||1|corridos||',
      '1|C|padrao|pendente||1|corridos||',
    ]);
  });

  it('tipo vazio vira padrao e responsavel_id aparece cru', () => {
    const fp = buildFingerprint({ etapa_atual: 0 }, [
      {
        id: 1,
        ordem: 0,
        nome: 'Copy',
        tipo: '',
        responsavel_id: 42,
        prazo_dias: 2,
        tipo_prazo: 'uteis',
        status: 'ativo',
      },
    ]);
    expect(fp).toBe('etapa_atual=0\n0|Copy|padrao|ativo|42|2|uteis||');
  });
});

describe('buildTemplateFingerprint', () => {
  it('85.3: formato exato do template, com ordem base zero e sem cabeçalho', () => {
    const fp = buildTemplateFingerprint([
      { nome: 'Copy', prazo_dias: 2, tipo_prazo: 'corridos' },
      { nome: 'Aprovacao', prazo_dias: 1, tipo_prazo: 'uteis', tipo: 'aprovacao_cliente' },
    ]);
    expect(fp).toBe('0|Copy|padrao|2|corridos\n1|Aprovacao|aprovacao_cliente|1|uteis');
  });

  it('85.4: etapas vazio devolve string vazia; não-array também', () => {
    expect(buildTemplateFingerprint([])).toBe('');
    expect(buildTemplateFingerprint(null)).toBe('');
    expect(buildTemplateFingerprint({ nome: 'x' })).toBe('');
  });

  it('não normaliza números: o valor cru passa por String()', () => {
    // 2.5 nunca acontece num template salvo pelo CRM (inputs inteiros), mas o
    // espelho não pode "corrigir" nada: SQL serializa e.val ->> 'prazo_dias' cru.
    expect(buildTemplateFingerprint([{ nome: 'A', prazo_dias: 2.5, tipo_prazo: 'uteis' }])).toBe(
      '0|A|padrao|2.5|uteis',
    );
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run apps/crm/src/pages/entregas/__tests__/fingerprint.test.ts`
Expected: FAIL — `Cannot find module '../fingerprint'`.

- [ ] **Step 3: Implement the mirror**

```ts
// apps/crm/src/pages/entregas/fingerprint.ts
/**
 * Espelho TS de workflow_fingerprint() / template_fingerprint()
 * (supabase/migrations/20260919000001_post_process_fingerprints.sql, spec §9.4).
 *
 * É uma serialização canônica em TEXTO, sem hash: browser e Postgres têm de
 * produzir byte a byte o mesmo valor, porque a RPC recalcula sob lock e falha
 * com workflow_changed/template_changed quando difere.
 *
 * Regras que NÃO podem mudar sem mudar o SQL junto:
 * - todo campo passa por String(value ?? ''); nulo vira '' (coalesce), e nada é
 *   reparseado com Number()/parseInt() (o SQL serializa o valor cru);
 * - tipo nulo ou vazio vira 'padrao' (coalesce(nullif(tipo,''),'padrao'));
 * - data_limite é 'YYYY-MM-DD' (to_char(date)); iniciado_em é ISO 8601 UTC com
 *   milissegundos (to_char(x at time zone 'utc','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'));
 * - etapas ordenadas por (ordem, id): workflow_etapas não tem UNIQUE (workflow_id, ordem);
 * - o fluxo tem o cabeçalho 'etapa_atual=<n>' e cada linha vem precedida de '\n'
 *   (string_agg com separador vazio e chr(10) no início de cada linha), logo
 *   zero etapas = só o cabeçalho, sem '\n' final;
 * - o template NÃO tem cabeçalho e junta as linhas com '\n'; a ordem é o índice
 *   base zero do array, não um campo.
 *
 * Limite conhecido: iniciado_em chega do PostgREST com microssegundos; new Date()
 * trunca para ms e to_char(...MS) também emite 3 dígitos. Fixtures da suíte SQL
 * (85.*) usam segundos inteiros. Um template inexistente devolve NULL no SQL;
 * aqui a entrada é a própria linha, então não há análogo.
 */

export interface FingerprintEtapa {
  id?: number | null;
  ordem: number;
  nome?: string | null;
  tipo?: string | null;
  status?: string | null;
  responsavel_id?: number | null;
  prazo_dias?: number | null;
  tipo_prazo?: string | null;
  data_limite?: string | null;
  iniciado_em?: string | null;
}

const s = (v: unknown): string => (v == null ? '' : String(v));

const tipoOrPadrao = (v: unknown): string => {
  const t = s(v);
  return t === '' ? 'padrao' : t;
};

/** 'YYYY-MM-DD' — o PostgREST já devolve `date` nesse formato; o slice só protege
 *  contra um timestamp completo passado por engano. */
const dateOnly = (v: unknown): string => s(v).slice(0, 10);

const isoUtcMs = (v: unknown): string => {
  const str = s(v);
  if (str === '') return '';
  const d = new Date(str);
  return isNaN(d.getTime()) ? '' : d.toISOString();
};

export function buildFingerprint(
  workflow: { etapa_atual: number | null | undefined },
  etapas: readonly FingerprintEtapa[],
): string {
  const sorted = [...etapas].sort((a, b) => a.ordem - b.ordem || (a.id ?? 0) - (b.id ?? 0));
  const lines = sorted
    .map(
      (e) =>
        '\n' +
        [
          s(e.ordem),
          s(e.nome),
          tipoOrPadrao(e.tipo),
          s(e.status),
          s(e.responsavel_id),
          s(e.prazo_dias),
          s(e.tipo_prazo),
          dateOnly(e.data_limite),
          isoUtcMs(e.iniciado_em),
        ].join('|'),
    )
    .join('');
  return `etapa_atual=${s(workflow.etapa_atual)}${lines}`;
}

export function buildTemplateFingerprint(etapas: unknown): string {
  if (!Array.isArray(etapas)) return '';
  return etapas
    .map((raw, i) => {
      const e = (raw ?? {}) as Record<string, unknown>;
      return [s(i), s(e.nome), tipoOrPadrao(e.tipo), s(e.prazo_dias), s(e.tipo_prazo)].join('|');
    })
    .join('\n');
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run apps/crm/src/pages/entregas/__tests__/fingerprint.test.ts`
Expected: PASS (8 tests).

- [ ] **Step 5: Lint, format, commit**

```bash
npm run lint && npx prettier --write apps/crm/src/pages/entregas/fingerprint.ts apps/crm/src/pages/entregas/__tests__/fingerprint.test.ts
git add apps/crm/src/pages/entregas/fingerprint.ts apps/crm/src/pages/entregas/__tests__/fingerprint.test.ts
git commit -m "feat(entregas): espelho TS dos fingerprints de fluxo e template"
```

---

### Task 2: Store module for post processes (one batched read)

**Files:**
- Create: `apps/crm/src/store/postProcesses.ts`
- Modify: `apps/crm/src/store/posts.ts:290` (export `POST_CONTEXT_COLUMNS`), `:299` (export `mapPostContextRow`)
- Modify: `apps/crm/src/store/index.ts` (add `export * from './postProcesses';` after `./posts`)
- Test: `apps/crm/src/store/__tests__/postProcesses.test.ts`

**Interfaces:**
- Consumes: `supabase` from `./core`; `fetchAllPaged` from `./paging`; `POST_CONTEXT_COLUMNS`, `mapPostContextRow`, `ActivePost` from `./posts`.
- Produces (all re-exported from `apps/crm/src/store`):
  - `PostProcessEstado = 'ativo' | 'concluido' | 'encerrado'`
  - `PostProcessStepEstado = 'pendente' | 'ativo' | 'concluido' | 'herdado' | 'ignorado' | 'interrompido'`
  - `interface PostProcessStep { id: number; conta_id: string; process_id: number; ordem: number; nome: string; tipo: 'padrao' | 'aprovacao_cliente'; responsavel_id: number | null; prazo_dias: number | null; tipo_prazo: 'uteis' | 'corridos' | null; prazo_efetivo: string | null; estado: PostProcessStepEstado; iniciado_em: string | null; concluido_em: string | null; interrompido_em: string | null; origem_etapa_ordem: number | null; origem_etapa_nome: string | null }`
  - `interface PostProcess { id: number; conta_id: string; post_id: number; template_id: number | null; template_nome: string | null; assinatura: string; origem_workflow_id: number | null; origem_descricao: string | null; estado: PostProcessEstado; motivo_encerramento: 'removido' | 'vinculado' | null; etapa_atual: number; modo_prazo: 'padrao' | 'data_fixa' | 'data_entrega'; board_position: number; revisao: number; created_by: string | null; created_at: string; updated_at: string; concluido_em: string | null; steps: PostProcessStep[] /* sorted by ordem */ }`
  - `interface PostProcessWithPost extends PostProcess { post: ActivePost }`
  - `PostProcessEvento = 'desmembrado' | 'aplicado' | 'avancou' | 'voltou' | 'concluido' | 'reaberto' | 'removido' | 'vinculado' | 'etapa_editada'`
  - `interface PostProcessEvent { id: number; conta_id: string; post_id: number; process_id: number; evento: PostProcessEvento; actor_user_id: string | null; actor_name: string | null; origem: 'workspace_user' | 'system'; antes: Record<string, unknown> | null; depois: Record<string, unknown> | null; created_at: string }`
  - `getVigentePostProcesses(): Promise<PostProcessWithPost[]>` — `estado IN ('ativo','concluido')`, ordered `board_position, id`, paged
  - `getVigentePostProcess(postId: number): Promise<PostProcess | null>`
  - `getPostProcessEvents(postIds: number[]): Promise<PostProcessEvent[]>` — `[]` for an empty list, ordered `created_at, id`

- [ ] **Step 1: Export the two private helpers from `store/posts.ts`**

At line 290 change `const POST_CONTEXT_COLUMNS =` to `export const POST_CONTEXT_COLUMNS =`. At line 299 change `function mapPostContextRow(row: any): ActivePost {` to `export function mapPostContextRow(row: any): ActivePost {`. Add above `mapPostContextRow`'s existing doc comment one line: `// Exported for store/postProcesses.ts, which embeds a workflow_posts row (avulso arm shape).`

- [ ] **Step 2: Write the failing store test**

```ts
// apps/crm/src/store/__tests__/postProcesses.test.ts
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockFrom } = vi.hoisted(() => ({ mockFrom: vi.fn() }));

vi.mock('../core', () => ({
  supabase: { from: mockFrom },
  getContaId: vi.fn(),
  getUserId: vi.fn(),
  getCurrentProfile: vi.fn(),
  clearProfileCache: vi.fn(),
}));
vi.mock('../mentions', () => ({ syncMentions: vi.fn() }));
vi.mock('@/components/mentions/mentionTokens', () => ({ extractMentionsFromDoc: () => [] }));

import {
  getPostProcessEvents,
  getVigentePostProcess,
  getVigentePostProcesses,
} from '../postProcesses';

/** Thenable query builder: every filter returns itself, awaiting resolves `result`. */
function chain(result: { data: unknown; error: unknown }) {
  const q: Record<string, unknown> = {};
  const self = () => q;
  for (const m of ['select', 'eq', 'in', 'order', 'range', 'maybeSingle']) q[m] = vi.fn(self);
  q.then = (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) =>
    Promise.resolve(result).then(res, rej);
  return q;
}

const processRow = {
  id: 5,
  conta_id: 'c1',
  post_id: 77,
  template_id: 3,
  template_nome: 'Redes',
  assinatura: '0|Copy|padrao\n1|Design|padrao',
  origem_workflow_id: null,
  origem_descricao: null,
  estado: 'ativo',
  motivo_encerramento: null,
  etapa_atual: 1,
  modo_prazo: 'padrao',
  board_position: 2,
  revisao: 1,
  created_by: null,
  created_at: '2026-09-10T10:00:00Z',
  updated_at: '2026-09-10T10:00:00Z',
  concluido_em: null,
  post_process_steps: [
    { id: 12, process_id: 5, ordem: 1, nome: 'Design', estado: 'ativo' },
    { id: 11, process_id: 5, ordem: 0, nome: 'Copy', estado: 'ignorado' },
  ],
  workflow_posts: {
    id: 77,
    workflow_id: null,
    cliente_id: 9,
    titulo: 'Post X',
    tipo: 'feed',
    status: 'rascunho',
    ordem: 0,
    clientes: { nome: 'Aurora' },
  },
};

describe('getVigentePostProcesses', () => {
  beforeEach(() => vi.clearAllMocks());

  it('faz UMA consulta em post_processes com os dois estados vigentes e mapeia steps e post', async () => {
    const q = chain({ data: [processRow], error: null });
    mockFrom.mockReturnValueOnce(q);
    const out = await getVigentePostProcesses();
    expect(mockFrom).toHaveBeenCalledTimes(1);
    expect(mockFrom).toHaveBeenCalledWith('post_processes');
    expect(q.in).toHaveBeenCalledWith('estado', ['ativo', 'concluido']);
    expect(out).toHaveLength(1);
    expect(out[0].steps.map((s) => s.ordem)).toEqual([0, 1]);
    expect(out[0].post).toMatchObject({
      id: 77,
      workflow_id: null,
      cliente_id: 9,
      cliente_nome: 'Aurora',
      workflow_titulo: null,
    });
    expect((out[0] as unknown as Record<string, unknown>).post_process_steps).toBeUndefined();
    expect((out[0] as unknown as Record<string, unknown>).workflow_posts).toBeUndefined();
  });

  it('propaga o erro do PostgREST', async () => {
    mockFrom.mockReturnValueOnce(chain({ data: null, error: new Error('boom') }));
    await expect(getVigentePostProcesses()).rejects.toThrow('boom');
  });
});

describe('getVigentePostProcess', () => {
  beforeEach(() => vi.clearAllMocks());

  it('devolve null sem processo vigente e o processo com steps ordenados quando existe', async () => {
    mockFrom.mockReturnValueOnce(chain({ data: null, error: null }));
    expect(await getVigentePostProcess(77)).toBeNull();

    const { workflow_posts: _p, ...withoutPost } = processRow;
    const q = chain({ data: withoutPost, error: null });
    mockFrom.mockReturnValueOnce(q);
    const proc = await getVigentePostProcess(77);
    expect(q.eq).toHaveBeenCalledWith('post_id', 77);
    expect(q.in).toHaveBeenCalledWith('estado', ['ativo', 'concluido']);
    expect(proc?.steps.map((s) => s.nome)).toEqual(['Copy', 'Design']);
  });
});

describe('getPostProcessEvents', () => {
  beforeEach(() => vi.clearAllMocks());

  it('não consulta com lista vazia e filtra por post_id em lote', async () => {
    expect(await getPostProcessEvents([])).toEqual([]);
    expect(mockFrom).not.toHaveBeenCalled();
    const q = chain({ data: [{ id: 1, post_id: 77, evento: 'aplicado' }], error: null });
    mockFrom.mockReturnValueOnce(q);
    const evs = await getPostProcessEvents([77, 78]);
    expect(mockFrom).toHaveBeenCalledWith('post_process_events');
    expect(q.in).toHaveBeenCalledWith('post_id', [77, 78]);
    expect(evs).toHaveLength(1);
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npx vitest run apps/crm/src/store/__tests__/postProcesses.test.ts`
Expected: FAIL — `Cannot find module '../postProcesses'`.

- [ ] **Step 4: Implement the store module**

```ts
// apps/crm/src/store/postProcesses.ts
import { supabase } from './core';
import { fetchAllPaged } from './paging';
import { POST_CONTEXT_COLUMNS, mapPostContextRow, type ActivePost } from './posts';

// =============================================
// POST PROCESSES (processos individuais de produção)
// Spec: docs/superpowers/specs/2026-09-10-posts-individuais-fluxos-design.md §8.
// Tabelas: post_processes / post_process_steps / post_process_events
// (migration 20260918000002). SELECT liberado por RLS para membros da conta;
// toda escrita passa pelas RPCs SECURITY DEFINER da fase 2 -- este módulo só lê.
// =============================================

export type PostProcessEstado = 'ativo' | 'concluido' | 'encerrado';
export type PostProcessStepEstado =
  | 'pendente'
  | 'ativo'
  | 'concluido'
  | 'herdado'
  | 'ignorado'
  | 'interrompido';

export interface PostProcessStep {
  id: number;
  conta_id: string;
  process_id: number;
  ordem: number;
  nome: string;
  tipo: 'padrao' | 'aprovacao_cliente';
  responsavel_id: number | null;
  prazo_dias: number | null;
  tipo_prazo: 'uteis' | 'corridos' | null;
  /** Prazo congelado da etapa (timestamptz). Vence sobre prazo_dias/tipo_prazo. */
  prazo_efetivo: string | null;
  estado: PostProcessStepEstado;
  iniciado_em: string | null;
  concluido_em: string | null;
  interrompido_em: string | null;
  origem_etapa_ordem: number | null;
  origem_etapa_nome: string | null;
}

export interface PostProcess {
  id: number;
  conta_id: string;
  post_id: number;
  template_id: number | null;
  template_nome: string | null;
  assinatura: string;
  origem_workflow_id: number | null;
  origem_descricao: string | null;
  estado: PostProcessEstado;
  motivo_encerramento: 'removido' | 'vinculado' | null;
  etapa_atual: number;
  modo_prazo: 'padrao' | 'data_fixa' | 'data_entrega';
  /** Mesmo espaço de índices de workflows.position (spec §4.2). */
  board_position: number;
  revisao: number;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  concluido_em: string | null;
  /** Ordenadas por `ordem` ascendente. */
  steps: PostProcessStep[];
}

export interface PostProcessWithPost extends PostProcess {
  /** Resumo do post (POST_CONTEXT_COLUMNS, sem conteúdo rico), no formato de
   *  getActivePosts -- workflow_id é sempre null enquanto o processo é vigente. */
  post: ActivePost;
}

export type PostProcessEvento =
  | 'desmembrado'
  | 'aplicado'
  | 'avancou'
  | 'voltou'
  | 'concluido'
  | 'reaberto'
  | 'removido'
  | 'vinculado'
  | 'etapa_editada';

export interface PostProcessEvent {
  id: number;
  conta_id: string;
  post_id: number;
  process_id: number;
  evento: PostProcessEvento;
  actor_user_id: string | null;
  actor_name: string | null;
  origem: 'workspace_user' | 'system';
  antes: Record<string, unknown> | null;
  depois: Record<string, unknown> | null;
  created_at: string;
}

const PROCESS_COLUMNS =
  'id, conta_id, post_id, template_id, template_nome, assinatura, origem_workflow_id, origem_descricao, estado, motivo_encerramento, etapa_atual, modo_prazo, board_position, revisao, created_by, created_at, updated_at, concluido_em';

const STEP_COLUMNS =
  'id, conta_id, process_id, ordem, nome, tipo, responsavel_id, prazo_dias, tipo_prazo, prazo_efetivo, estado, iniciado_em, concluido_em, interrompido_em, origem_etapa_ordem, origem_etapa_nome';

// Embeds nomeados pela constraint (FKs compostas de tenant, migration
// 20260918000002): post_process_steps_process_same_tenant e
// post_processes_post_same_tenant. O post vem no formato do braço avulso de
// getActivePosts (clientes(nome) direto na linha), que mapPostContextRow já lê.
// O teste unitário mocka a cadeia e não exercita o hint; quem o valida é a
// checagem em staging (Task 15, Step 6). Se o PostgREST rejeitar o sufixo
// `!constraint`, remova só o sufixo (`post_process_steps(...)` e
// `workflow_posts(...)`): cada embed tem exatamente UM caminho de FK
// (post_processes.post_id só tem a FK composta; steps idem com process_id).
const STEPS_EMBED = `post_process_steps!post_process_steps_process_same_tenant(${STEP_COLUMNS})`;
const POST_EMBED = `workflow_posts!post_processes_post_same_tenant(${POST_CONTEXT_COLUMNS}, clientes(nome))`;

const VIGENTES: PostProcessEstado[] = ['ativo', 'concluido'];

function sortSteps(steps: PostProcessStep[] | null | undefined): PostProcessStep[] {
  return [...(steps ?? [])].sort((a, b) => a.ordem - b.ordem);
}

function mapProcessRow(row: any): PostProcess {
  const { post_process_steps, ...proc } = row;
  return { ...proc, steps: sortSteps(post_process_steps) };
}

function mapProcessWithPostRow(row: any): PostProcessWithPost {
  const { workflow_posts, ...rest } = row;
  return { ...mapProcessRow(rest), post: mapPostContextRow(workflow_posts) };
}

/**
 * Todos os processos VIGENTES da conta (ativo + concluido) numa consulta só,
 * com etapas e resumo do post embutidos (spec §8.3). Os ativos viram cards do
 * quadro; os concluídos entram em Concluídas; o conjunto inteiro é a exclusão
 * da seção Sem processo (§4.3, §8.2). Encerrados não aparecem em lugar nenhum
 * do quadro e ficam de fora. Paginado por segurança (max-rows silencioso do
 * PostgREST); RLS aplica conta_id.
 */
export async function getVigentePostProcesses(): Promise<PostProcessWithPost[]> {
  const rows = await fetchAllPaged(async (from, to) => {
    const { data, error } = await supabase
      .from('post_processes')
      .select(`${PROCESS_COLUMNS}, ${STEPS_EMBED}, ${POST_EMBED}`)
      .in('estado', VIGENTES)
      .order('board_position', { ascending: true })
      .order('id', { ascending: true })
      .range(from, to);
    if (error) throw error;
    return (data ?? []) as any[];
  });
  return rows.map(mapProcessWithPostRow);
}

/** O processo vigente de um post (no máximo um, índice parcial
 *  post_processes_one_vigente_per_post), sem o embed do post. Para o drawer. */
export async function getVigentePostProcess(postId: number): Promise<PostProcess | null> {
  const { data, error } = await supabase
    .from('post_processes')
    .select(`${PROCESS_COLUMNS}, ${STEPS_EMBED}`)
    .eq('post_id', postId)
    .in('estado', VIGENTES)
    .maybeSingle();
  if (error) throw error;
  return data ? mapProcessRow(data) : null;
}

/** Histórico de processo dos posts pedidos, em lote (mesmo desenho de
 *  getPostStatusEvents). Inclui eventos de processos já encerrados. */
export async function getPostProcessEvents(postIds: number[]): Promise<PostProcessEvent[]> {
  if (postIds.length === 0) return [];
  const { data, error } = await supabase
    .from('post_process_events')
    .select(
      'id, conta_id, post_id, process_id, evento, actor_user_id, actor_name, origem, antes, depois, created_at',
    )
    .in('post_id', postIds)
    .order('created_at', { ascending: true })
    .order('id', { ascending: true });
  if (error) throw error;
  return (data ?? []) as PostProcessEvent[];
}
```

Then in `apps/crm/src/store/index.ts` add `export * from './postProcesses';` immediately after `export * from './posts';`.

- [ ] **Step 5: Run the test and the typecheck**

Run: `npx vitest run apps/crm/src/store/__tests__/postProcesses.test.ts && npx tsc -p apps/crm/tsconfig.json --noEmit`
Expected: PASS (5 tests); tsc clean.

- [ ] **Step 6: Commit**

```bash
npx prettier --write apps/crm/src/store/postProcesses.ts apps/crm/src/store/posts.ts apps/crm/src/store/index.ts apps/crm/src/store/__tests__/postProcesses.test.ts
git add apps/crm/src/store/postProcesses.ts apps/crm/src/store/posts.ts apps/crm/src/store/index.ts apps/crm/src/store/__tests__/postProcesses.test.ts
git commit -m "feat(store): leitura em lote de processos individuais (post_processes)"
```

---

### Task 3: `etapaPrazo.ts` — `prazo_efetivo`, deadline adapter, shared filter matcher

**Files:**
- Modify: `apps/crm/src/pages/entregas/etapaPrazo.ts:40-63` (`EtapaDeadlineFields`, `etapaDeadlineDateOf`), `:82-115` (`matchesEtapaPrazo`)
- Test: `apps/crm/src/pages/entregas/__tests__/etapaPrazo.test.ts` (append)

**Interfaces:**
- Consumes: `computeDeadlineDate` (existing).
- Produces:
  - `EtapaDeadlineFields` widened: `prazo_dias: number | null; tipo_prazo: 'corridos' | 'uteis' | null; prazo_efetivo?: string | null` (existing callers `pages/dashboard/todayAgenda.ts:253` pass a `WorkflowEtapa`, which still satisfies it)
  - `etapaDeadlineDateOf(etapa)`: `prazo_efetivo` wins → `new Date(prazo_efetivo)`; then `data_limite`; then `iniciado_em + prazo_dias` only when both `prazo_dias` and `tipo_prazo` are non-null; else `null`
  - `export type DeadlineInfo = { diasRestantes: number; horasRestantes: number; estourado: boolean; urgente: boolean }` (structurally `ReturnType<typeof getDeadlineInfo>`)
  - `export function deadlineFromPrazoEfetivo(prazoEfetivo: string | null, fallbackDias: number | null, now?: Date): DeadlineInfo` — the spec §7 adapter "que devolve o formato de getDeadlineInfo"; NO +1 day (an instant, not a date)
  - `export function matchesDeadlineFilter(target: { deadline: { estourado: boolean }; date: Date | null } | undefined, presets, from, to, now?): boolean` — extracted body of `matchesEtapaPrazo`, which now delegates to it with identical results

- [ ] **Step 1: Append failing tests**

```ts
// append to apps/crm/src/pages/entregas/__tests__/etapaPrazo.test.ts
import { deadlineFromPrazoEfetivo, matchesDeadlineFilter } from '../etapaPrazo';

describe('etapaDeadlineDateOf com prazo_efetivo', () => {
  it('prazo_efetivo vence sobre data_limite e iniciado_em', () => {
    const d = etapaDeadlineDateOf({
      prazo_efetivo: '2026-07-20T15:00:00.000Z',
      data_limite: '2026-07-10',
      iniciado_em: '2026-07-01T10:00:00Z',
      prazo_dias: 2,
      tipo_prazo: 'corridos',
    });
    expect(d?.toISOString()).toBe('2026-07-20T15:00:00.000Z');
  });

  it('sem prazo_efetivo, prazo_dias nulo com iniciado_em devolve null (etapa relativa não ativada)', () => {
    expect(
      etapaDeadlineDateOf({
        prazo_efetivo: null,
        data_limite: null,
        iniciado_em: '2026-07-01T10:00:00Z',
        prazo_dias: null,
        tipo_prazo: null,
      }),
    ).toBeNull();
  });

  it('prazo_efetivo inválido devolve null', () => {
    expect(
      etapaDeadlineDateOf({ prazo_efetivo: 'nope', prazo_dias: 1, tipo_prazo: 'corridos' }),
    ).toBeNull();
  });
});

describe('deadlineFromPrazoEfetivo', () => {
  it('null devolve o fallback de dias, sem estourado nem urgente', () => {
    expect(deadlineFromPrazoEfetivo(null, 3, NOW)).toEqual({
      diasRestantes: 3,
      horasRestantes: 0,
      estourado: false,
      urgente: false,
    });
    expect(deadlineFromPrazoEfetivo(null, null, NOW).diasRestantes).toBe(0);
  });

  it('instante passado é estourado; dentro de 24h é urgente; além disso conta dias e horas', () => {
    const past = new Date(NOW.getTime() - 30 * 3_600_000).toISOString();
    expect(deadlineFromPrazoEfetivo(past, null, NOW)).toMatchObject({
      estourado: true,
      urgente: false,
      diasRestantes: -2,
    });
    const soon = new Date(NOW.getTime() + 5 * 3_600_000).toISOString();
    expect(deadlineFromPrazoEfetivo(soon, null, NOW)).toMatchObject({
      estourado: false,
      urgente: true,
      diasRestantes: 0,
      horasRestantes: 5,
    });
    const later = new Date(NOW.getTime() + 50 * 3_600_000).toISOString();
    expect(deadlineFromPrazoEfetivo(later, null, NOW)).toMatchObject({
      estourado: false,
      urgente: false,
      diasRestantes: 2,
      horasRestantes: 2,
    });
  });
});

describe('matchesDeadlineFilter', () => {
  it('filtro vazio aceita tudo, inclusive alvo indefinido; filtro ativo rejeita alvo indefinido', () => {
    expect(matchesDeadlineFilter(undefined, [], '', '', NOW)).toBe(true);
    expect(matchesDeadlineFilter(undefined, ['hoje'], '', '', NOW)).toBe(false);
  });

  it('é a mesma regra de matchesEtapaPrazo para um card', () => {
    const card = makeCard({ data_limite: '2026-07-15' });
    expect(matchesEtapaPrazo(card, ['hoje'], '', '', NOW)).toBe(true);
    expect(
      matchesDeadlineFilter(
        { deadline: card.deadline, date: etapaDeadlineDate(card) },
        ['hoje'],
        '',
        '',
        NOW,
      ),
    ).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run apps/crm/src/pages/entregas/__tests__/etapaPrazo.test.ts`
Expected: FAIL — `deadlineFromPrazoEfetivo`/`matchesDeadlineFilter` not exported; `prazo_efetivo` type error.

- [ ] **Step 3: Implement**

Replace lines 40-63 of `etapaPrazo.ts` with:

```ts
/** Minimal shape needed to compute an etapa's deadline. A WorkflowEtapa
 *  satisfies it; a post_process_steps row satisfies it too (nullable
 *  prazo_dias/tipo_prazo, plus the frozen prazo_efetivo). */
export interface EtapaDeadlineFields {
  data_limite?: string | null;
  iniciado_em?: string | null;
  prazo_dias: number | null;
  tipo_prazo: 'corridos' | 'uteis' | null;
  /** Instante congelado da etapa individual (spec §7). Vence sobre os demais. */
  prazo_efetivo?: string | null;
}

/**
 * The ONE deadline function for the mixed board (spec §7: "não criar uma
 * terceira implementação de prazo"). Precedence: prazo_efetivo (instant) →
 * data_limite (local day) → iniciado_em + prazo_dias → null.
 */
export function etapaDeadlineDateOf(etapa: EtapaDeadlineFields): Date | null {
  const { data_limite, iniciado_em, prazo_dias, tipo_prazo, prazo_efetivo } = etapa;
  if (prazo_efetivo) {
    const d = new Date(prazo_efetivo);
    return isNaN(d.getTime()) ? null : d;
  }
  if (data_limite) {
    // 'YYYY-MM-DD' — build via components so the LOCAL day is preserved
    // (new Date('YYYY-MM-DD') parses as UTC midnight and can shift a day).
    const [y, m, d] = data_limite.slice(0, 10).split('-').map(Number);
    if (y && m && d) return new Date(y, m - 1, d);
    return null;
  }
  if (iniciado_em && prazo_dias != null && tipo_prazo)
    return computeDeadlineDate(iniciado_em, prazo_dias, tipo_prazo);
  return null;
}

export type DeadlineInfo = {
  diasRestantes: number;
  horasRestantes: number;
  estourado: boolean;
  urgente: boolean;
};

/**
 * getDeadlineInfo's shape from a frozen instant (post_process_steps.prazo_efetivo).
 * Unlike the data_limite branch of getDeadlineInfo there is NO "+1 day": a
 * timestamptz is the exact moment the etapa is due. With no instant the etapa
 * has no deadline yet (relative step not activated): `fallbackDias` fills
 * diasRestantes the way getDeadlineInfo does for a pending etapa.
 */
export function deadlineFromPrazoEfetivo(
  prazoEfetivo: string | null,
  fallbackDias: number | null,
  now: Date = new Date(),
): DeadlineInfo {
  if (!prazoEfetivo) {
    return { diasRestantes: fallbackDias ?? 0, horasRestantes: 0, estourado: false, urgente: false };
  }
  const msRestantes = new Date(prazoEfetivo).getTime() - now.getTime();
  const totalHoras = Math.floor(msRestantes / (1000 * 60 * 60));
  return {
    diasRestantes: Math.floor(totalHoras / 24),
    horasRestantes: totalHoras % 24,
    estourado: msRestantes < 0,
    urgente: msRestantes >= 0 && msRestantes <= 24 * 60 * 60 * 1000,
  };
}
```

Replace lines 82-115 (`matchesEtapaPrazo`) with:

```ts
/**
 * OR-semantics matcher for the "Prazo da etapa" filter, over an already
 * projected target (any board entity). An entirely empty filter matches
 * everything; an active filter excludes a missing target or one without a
 * deadline. `estourado` comes from the precise deadline flag, not the date.
 */
export function matchesDeadlineFilter(
  target: { deadline: { estourado: boolean }; date: Date | null } | undefined,
  presets: PrazoPreset[],
  from: string,
  to: string,
  now: Date = new Date(),
): boolean {
  const fromNum = parseDayInput(from);
  const toNum = parseDayInput(to);
  const rangeActive = fromNum != null || toNum != null;
  if (presets.length === 0 && !rangeActive) return true;
  if (!target) return false;

  if (presets.includes('atrasado') && target.deadline.estourado) return true;

  const deadline = target.date;
  if (!deadline) return false;
  const day = dayNum(deadline);
  const today = dayNum(now);

  if (presets.includes('hoje') && day === today) return true;
  if (presets.includes('amanha') && day === dayNum(addDays(now, 1))) return true;
  if (presets.includes('proximos7') && day >= today && day <= dayNum(addDays(now, 7))) return true;
  if (rangeActive && (fromNum == null || day >= fromNum) && (toNum == null || day <= toNum))
    return true;
  return false;
}

/** Same matcher for a workflow card (kept for the existing call sites). */
export function matchesEtapaPrazo(
  card: BoardCard | undefined,
  presets: PrazoPreset[],
  from: string,
  to: string,
  now: Date = new Date(),
): boolean {
  return matchesDeadlineFilter(
    card ? { deadline: card.deadline, date: etapaDeadlineDate(card) } : undefined,
    presets,
    from,
    to,
    now,
  );
}
```

- [ ] **Step 4: Run tests and typecheck**

Run: `npx vitest run apps/crm/src/pages/entregas/__tests__/etapaPrazo.test.ts apps/crm/src/pages/dashboard && npx tsc -p apps/crm/tsconfig.json --noEmit`
Expected: PASS; tsc clean (todayAgenda still compiles: `WorkflowEtapa.prazo_dias: number` is assignable to `number | null`).

- [ ] **Step 5: Commit**

```bash
npx prettier --write apps/crm/src/pages/entregas/etapaPrazo.ts apps/crm/src/pages/entregas/__tests__/etapaPrazo.test.ts
git add apps/crm/src/pages/entregas/etapaPrazo.ts apps/crm/src/pages/entregas/__tests__/etapaPrazo.test.ts
git commit -m "feat(entregas): prazo_efetivo em etapaDeadlineDateOf e adaptador de deadline"
```

---

### Task 4: `BoardEntity` union, adapters, signature and mixed sorts; dedupe `BoardCard`

**Files:**
- Create: `apps/crm/src/pages/entregas/boardEntity.ts`
- Modify: `apps/crm/src/pages/entregas/hooks/useEntregasData.ts:42-47` (delete the dead `BoardRow` export)
- Modify: `apps/crm/src/pages/entregas/components/WorkflowModals.tsx:34-51, 62-70` (import the canonical `BoardCard`, delete the local duplicate)
- Test: `apps/crm/src/pages/entregas/__tests__/boardEntity.test.ts`

**Interfaces:**
- Consumes: `BoardCard` (hook), `PostProcessWithPost`, `PostProcessStep`, `Cliente`, `Membro`, `PostMedia` (store), `etapaDeadlineDate`, `etapaDeadlineDateOf`, `deadlineFromPrazoEfetivo`, `DeadlineInfo` (Task 3).
- Produces:
  - `interface StageStep { ordem: number; nome: string; tipo: 'padrao' | 'aprovacao_cliente' }`
  - `interface WorkflowEntity { kind: 'workflow'; id: \`workflow:${number}\`; card: BoardCard; templateId: number | null; steps: StageStep[]; etapaOrdem: number; etapaNome: string; responsavel: Membro | undefined; prazoEfetivo: Date | null; posicao: number; deadline: DeadlineInfo; cliente: Cliente | undefined; titulo: string }`
  - `interface PostEntity { kind: 'post'; id: \`post:${number}\`; process: PostProcessWithPost; step: PostProcessStep; templateId; steps; etapaOrdem; etapaNome; responsavel; prazoEfetivo; posicao /* board_position */; deadline; cliente; titulo; clienteAvatarUrl?: string; cover?: PostMedia }`
  - `type BoardEntity = WorkflowEntity | PostEntity`; guards `isWorkflowEntity(e)`, `isPostEntity(e)`
  - `stageSignature(steps: readonly StageStep[]): string` — sorted by `ordem`, each `${ordem}|${nome}|${tipo}`, joined by `;`
  - `toWorkflowEntity(card: BoardCard): WorkflowEntity`, `toWorkflowEntities(cards: BoardCard[]): WorkflowEntity[]`
  - `interface PostEntityContext { clientes: Cliente[]; membros: Membro[]; clienteAvatars?: Map<number, string>; covers?: Map<number, PostMedia> }`
  - `toPostEntity(process: PostProcessWithPost, ctx: PostEntityContext): PostEntity | null` (null when no step matches `etapa_atual`; the active step is the one with `estado === 'ativo'`, falling back to `ordem === etapa_atual`)
  - `entityNumericId(e: BoardEntity): number`
  - `sortEntitiesByPrazo(entities: BoardEntity[]): BoardEntity[]` — `prazoEfetivo` ascending, `null` last, tie by `posicao` (stable) — same result as `sortCardsByPrazo` for workflow-only input
  - `sortEntitiesByPosicao(entities: BoardEntity[]): BoardEntity[]` — `posicao` ascending, tie by numeric id (spec §4.2 manual rule)

- [ ] **Step 1: Write the failing test**

```ts
// apps/crm/src/pages/entregas/__tests__/boardEntity.test.ts
import { describe, expect, it } from 'vitest';
import {
  entityNumericId,
  isPostEntity,
  sortEntitiesByPosicao,
  sortEntitiesByPrazo,
  stageSignature,
  toPostEntity,
  toWorkflowEntity,
} from '../boardEntity';
import type { BoardCard } from '../hooks/useEntregasData';
import type { PostProcessStep, PostProcessWithPost } from '../../../store';

function makeCard(opts: { id: number; position?: number; ativa?: number; data_limite?: string | null }): BoardCard {
  const etapas = [
    { id: 1, workflow_id: opts.id, ordem: 0, nome: 'Copy', tipo: 'padrao' as const, prazo_dias: 1, tipo_prazo: 'corridos' as const, status: 'concluido' as const },
    { id: 2, workflow_id: opts.id, ordem: 1, nome: 'Design', tipo: 'padrao' as const, prazo_dias: 2, tipo_prazo: 'corridos' as const, status: 'ativo' as const, data_limite: opts.data_limite ?? null, responsavel_id: 7 },
  ];
  const etapa = etapas[opts.ativa ?? 1];
  return {
    workflow: { id: opts.id, cliente_id: 3, titulo: `WF ${opts.id}`, status: 'ativo', etapa_atual: 1, recorrente: false, template_id: 5, position: opts.position ?? 0 },
    etapa,
    cliente: { id: 3, nome: 'Aurora', cor: '#000' } as never,
    membro: { id: 7, nome: 'Ana' } as never,
    deadline: { diasRestantes: 2, horasRestantes: 0, estourado: false, urgente: false },
    totalEtapas: 2,
    etapaIdx: etapa.ordem,
    allEtapas: etapas,
  } as unknown as BoardCard;
}

function step(p: Partial<PostProcessStep> & { ordem: number; nome: string }): PostProcessStep {
  return {
    id: 100 + p.ordem, conta_id: 'c', process_id: 9, tipo: 'padrao', responsavel_id: null,
    prazo_dias: null, tipo_prazo: null, prazo_efetivo: null, estado: 'pendente', iniciado_em: null,
    concluido_em: null, interrompido_em: null, origem_etapa_ordem: null, origem_etapa_nome: null,
    ...p,
  };
}

function makeProcess(opts: { id?: number; board_position?: number; steps?: PostProcessStep[]; etapa_atual?: number }): PostProcessWithPost {
  return {
    id: opts.id ?? 9, conta_id: 'c', post_id: 77, template_id: 5, template_nome: 'Redes',
    assinatura: '', origem_workflow_id: null, origem_descricao: null, estado: 'ativo',
    motivo_encerramento: null, etapa_atual: opts.etapa_atual ?? 1, modo_prazo: 'padrao',
    board_position: opts.board_position ?? 0, revisao: 1, created_by: null,
    created_at: '2026-09-10T00:00:00Z', updated_at: '2026-09-10T00:00:00Z', concluido_em: null,
    steps: opts.steps ?? [
      step({ ordem: 0, nome: 'Copy', estado: 'ignorado' }),
      step({ ordem: 1, nome: 'Design', estado: 'ativo', responsavel_id: 7, prazo_efetivo: '2026-07-20T15:00:00.000Z', iniciado_em: '2026-07-18T10:00:00Z' }),
    ],
    post: { id: 77, workflow_id: null, cliente_id: 3, cliente_nome: 'Aurora', workflow_titulo: null, titulo: 'Post X', tipo: 'feed', status: 'rascunho', custom_status_id: null, scheduled_at: null, published_at: null, ig_caption: null, instagram_permalink: null, publish_error: null, publish_error_code: null, ordem: 0, responsavel_id: null, platform: 'instagram', tiktok_publish_status: null, tiktok_publish_error: null, tiktok_post_url: null, instagram_media_id: null, ig_trial_strategy: null, board_ordem: null },
  };
}

const ctx = { clientes: [{ id: 3, nome: 'Aurora', cor: '#000' } as never], membros: [{ id: 7, nome: 'Ana' } as never] };

describe('stageSignature', () => {
  it('ordena por ordem e serializa (ordem, nome, tipo)', () => {
    expect(
      stageSignature([
        { ordem: 1, nome: 'Aprovação', tipo: 'aprovacao_cliente' },
        { ordem: 0, nome: 'Copy', tipo: 'padrao' },
      ]),
    ).toBe('0|Copy|padrao;1|Aprovação|aprovacao_cliente');
    expect(stageSignature([])).toBe('');
  });
});

describe('toWorkflowEntity', () => {
  it('projeta o card sem inventar nada', () => {
    const e = toWorkflowEntity(makeCard({ id: 4, position: 3, data_limite: '2026-07-15' }));
    expect(e.kind).toBe('workflow');
    expect(e.id).toBe('workflow:4');
    expect(e.templateId).toBe(5);
    expect(e.steps.map((s) => s.nome)).toEqual(['Copy', 'Design']);
    expect(e.etapaOrdem).toBe(1);
    expect(e.etapaNome).toBe('Design');
    expect(e.responsavel?.nome).toBe('Ana');
    expect(e.prazoEfetivo?.getDate()).toBe(15);
    expect(e.posicao).toBe(3);
    expect(e.titulo).toBe('WF 4');
    expect(e.cliente?.nome).toBe('Aurora');
  });
});

describe('toPostEntity', () => {
  it('usa a etapa ativa, resolve cliente/responsável e o prazo congelado', () => {
    const e = toPostEntity(makeProcess({ board_position: 2 }), ctx);
    expect(e).not.toBeNull();
    expect(e!.id).toBe('post:9');
    expect(e!.step.nome).toBe('Design');
    expect(e!.etapaOrdem).toBe(1);
    expect(e!.etapaNome).toBe('Design');
    expect(e!.responsavel?.nome).toBe('Ana');
    expect(e!.cliente?.nome).toBe('Aurora');
    expect(e!.prazoEfetivo?.toISOString()).toBe('2026-07-20T15:00:00.000Z');
    expect(e!.posicao).toBe(2);
    expect(e!.titulo).toBe('Post X');
    expect(e!.templateId).toBe(5);
    expect(e!.steps.map((s) => s.ordem)).toEqual([0, 1]);
  });

  it('cai em etapa_atual quando nenhuma etapa está ativa e devolve null sem nenhuma', () => {
    const e = toPostEntity(
      makeProcess({ steps: [step({ ordem: 0, nome: 'Copy' }), step({ ordem: 1, nome: 'Design' })], etapa_atual: 0 }),
      ctx,
    );
    expect(e?.etapaNome).toBe('Copy');
    expect(toPostEntity(makeProcess({ steps: [] }), ctx)).toBeNull();
  });

  it('sem responsável, avatar e capa vêm do contexto', () => {
    const e = toPostEntity(makeProcess({ steps: [step({ ordem: 0, nome: 'Copy', estado: 'ativo' })] }), {
      ...ctx,
      clienteAvatars: new Map([[3, 'https://x/a.png']]),
      covers: new Map([[77, { id: 1, url: 'u' } as never]]),
    });
    expect(e?.responsavel).toBeUndefined();
    expect(e?.clienteAvatarUrl).toBe('https://x/a.png');
    expect(e?.cover).toMatchObject({ id: 1 });
    expect(e?.deadline).toEqual({ diasRestantes: 0, horasRestantes: 0, estourado: false, urgente: false });
  });
});

describe('sorts', () => {
  it('sortEntitiesByPrazo: mais cedo primeiro, sem prazo por último, empate por posicao', () => {
    const a = toWorkflowEntity(makeCard({ id: 1, position: 5, data_limite: '2026-07-20' }));
    const b = toPostEntity(makeProcess({ id: 2, board_position: 1 }), ctx)!; // 2026-07-20T15:00Z
    const c = toWorkflowEntity(makeCard({ id: 3, position: 0, data_limite: null })); // sem prazo
    const d = toWorkflowEntity(makeCard({ id: 4, position: 0, data_limite: '2026-07-20' }));
    const out = sortEntitiesByPrazo([c, a, b, d]).map((e) => e.id);
    // a e d têm a mesma data local (00:00 do dia 20); d vem antes por posicao 0 < 5.
    expect(out.slice(-1)).toEqual(['workflow:3']);
    expect(out.indexOf('workflow:4')).toBeLessThan(out.indexOf('workflow:1'));
  });

  it('sortEntitiesByPosicao: posicao crescente, empate por id numérico', () => {
    const w = toWorkflowEntity(makeCard({ id: 10, position: 1 }));
    const p = toPostEntity(makeProcess({ id: 2, board_position: 1 }), ctx)!;
    const q = toPostEntity(makeProcess({ id: 30, board_position: 0 }), ctx)!;
    expect(sortEntitiesByPosicao([w, p, q]).map((e) => e.id)).toEqual(['post:30', 'post:2', 'workflow:10']);
    expect(entityNumericId(w)).toBe(10);
    expect(isPostEntity(p)).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run apps/crm/src/pages/entregas/__tests__/boardEntity.test.ts`
Expected: FAIL — `Cannot find module '../boardEntity'`.

- [ ] **Step 3: Create `boardEntity.ts`**

```ts
// apps/crm/src/pages/entregas/boardEntity.ts
import type { BoardCard } from './hooks/useEntregasData';
import type {
  Cliente,
  Membro,
  PostMedia,
  PostProcessStep,
  PostProcessWithPost,
} from '../../store';
import {
  deadlineFromPrazoEfetivo,
  etapaDeadlineDate,
  etapaDeadlineDateOf,
  type DeadlineInfo,
} from './etapaPrazo';

/**
 * A entidade do quadro de Fluxos (spec §8.3): união discriminada entre um card
 * de fluxo (a forma que já existia, BoardCard) e um processo individual de
 * post. Nunca preencher um Workflow falso para renderizar um post: o Kanban, a
 * Lista, o agrupamento em linhas e a ordenação mista leem só a projeção comum
 * abaixo; o que é específico fica em `card` ou em `process`/`step`.
 */
export interface StageStep {
  ordem: number;
  nome: string;
  tipo: 'padrao' | 'aprovacao_cliente';
}

interface BoardEntityBase {
  templateId: number | null;
  /** Sequência completa de etapas, ordenada por `ordem`. */
  steps: StageStep[];
  etapaOrdem: number;
  etapaNome: string;
  responsavel: Membro | undefined;
  /** Prazo da etapa ativa pela única função de prazo (etapaDeadlineDateOf). */
  prazoEfetivo: Date | null;
  /** workflows.position ou post_processes.board_position (mesmo espaço). */
  posicao: number;
  deadline: DeadlineInfo;
  cliente: Cliente | undefined;
  titulo: string;
}

export interface WorkflowEntity extends BoardEntityBase {
  kind: 'workflow';
  id: `workflow:${number}`;
  card: BoardCard;
}

export interface PostEntity extends BoardEntityBase {
  kind: 'post';
  id: `post:${number}`;
  process: PostProcessWithPost;
  /** Etapa ativa do processo. */
  step: PostProcessStep;
  clienteAvatarUrl?: string;
  cover?: PostMedia;
}

export type BoardEntity = WorkflowEntity | PostEntity;

export const isWorkflowEntity = (e: BoardEntity): e is WorkflowEntity => e.kind === 'workflow';
export const isPostEntity = (e: BoardEntity): e is PostEntity => e.kind === 'post';

export function entityNumericId(e: BoardEntity): number {
  return e.kind === 'workflow' ? e.card.workflow.id! : e.process.id;
}

/** Assinatura ordenada das etapas (ordem, nome, tipo) para a identidade de
 *  linha (spec §4.1). Separadores imprimíveis: vive em chaves de coluna, ids
 *  de droppable e localStorage. Não é o formato de post_processes.assinatura. */
export function stageSignature(steps: readonly StageStep[]): string {
  return [...steps]
    .sort((a, b) => a.ordem - b.ordem)
    .map((s) => `${s.ordem}|${s.nome}|${s.tipo}`)
    .join(';');
}

export function toWorkflowEntity(card: BoardCard): WorkflowEntity {
  const steps: StageStep[] = [...card.allEtapas]
    .sort((a, b) => a.ordem - b.ordem)
    .map((e) => ({ ordem: e.ordem, nome: e.nome, tipo: e.tipo ?? 'padrao' }));
  return {
    kind: 'workflow',
    id: `workflow:${card.workflow.id!}`,
    card,
    templateId: card.workflow.template_id ?? null,
    steps,
    etapaOrdem: card.etapa.ordem,
    etapaNome: card.etapa.nome,
    responsavel: card.membro,
    prazoEfetivo: etapaDeadlineDate(card),
    posicao: card.workflow.position ?? 0,
    deadline: card.deadline,
    cliente: card.cliente,
    titulo: card.workflow.titulo,
  };
}

export function toWorkflowEntities(cards: BoardCard[]): WorkflowEntity[] {
  return cards.map(toWorkflowEntity);
}

export interface PostEntityContext {
  clientes: Cliente[];
  membros: Membro[];
  clienteAvatars?: Map<number, string>;
  covers?: Map<number, PostMedia>;
}

export function toPostEntity(
  process: PostProcessWithPost,
  ctx: PostEntityContext,
): PostEntity | null {
  const steps = [...process.steps].sort((a, b) => a.ordem - b.ordem);
  const step =
    steps.find((s) => s.estado === 'ativo') ?? steps.find((s) => s.ordem === process.etapa_atual);
  if (!step) return null;
  const clienteId = process.post.cliente_id;
  return {
    kind: 'post',
    id: `post:${process.id}`,
    process,
    step,
    templateId: process.template_id,
    steps: steps.map((s) => ({ ordem: s.ordem, nome: s.nome, tipo: s.tipo })),
    etapaOrdem: step.ordem,
    etapaNome: step.nome,
    responsavel:
      step.responsavel_id != null
        ? ctx.membros.find((m) => m.id === step.responsavel_id)
        : undefined,
    prazoEfetivo: etapaDeadlineDateOf({
      prazo_efetivo: step.prazo_efetivo,
      data_limite: null,
      iniciado_em: step.iniciado_em,
      prazo_dias: step.prazo_dias,
      tipo_prazo: step.tipo_prazo,
    }),
    posicao: process.board_position,
    deadline: deadlineFromPrazoEfetivo(step.prazo_efetivo, step.prazo_dias),
    cliente: clienteId != null ? ctx.clientes.find((c) => c.id === clienteId) : undefined,
    titulo: process.post.titulo,
    clienteAvatarUrl: clienteId != null ? ctx.clienteAvatars?.get(clienteId) : undefined,
    cover: ctx.covers?.get(process.post_id),
  };
}

/** Prazo mais curto primeiro, sem prazo por último; empate mantém a ordem
 *  manual (posicao). Para entrada só de fluxos dá o mesmo que sortCardsByPrazo. */
export function sortEntitiesByPrazo(entities: BoardEntity[]): BoardEntity[] {
  return [...entities].sort((a, b) => {
    const ad = a.prazoEfetivo?.getTime() ?? Infinity;
    const bd = b.prazoEfetivo?.getTime() ?? Infinity;
    if (ad !== bd) return ad - bd;
    return a.posicao - b.posicao;
  });
}

/** Ordem manual mista (spec §4.2): valor numérico dos dois campos, desempate por id. */
export function sortEntitiesByPosicao(entities: BoardEntity[]): BoardEntity[] {
  return [...entities].sort(
    (a, b) => a.posicao - b.posicao || entityNumericId(a) - entityNumericId(b),
  );
}
```

- [ ] **Step 4: Delete the dead `BoardRow` from the hook and the duplicate `BoardCard` from `WorkflowModals`**

In `apps/crm/src/pages/entregas/hooks/useEntregasData.ts` delete lines 42-47 (the `export interface BoardRow { key; label; stepNames; columns: Map<string, BoardCard[]> }` block). It has no importers (`grep -rn "BoardRow" apps/crm/src --include=*.ts --include=*.tsx | grep useEntregasData` returns nothing).

In `apps/crm/src/pages/entregas/components/WorkflowModals.tsx`: delete the local `interface BoardCard { ... }` at lines 62-70 (under `// ---- Types ----`), add `import type { BoardCard } from '../hooks/useEntregasData';` after the `../../../store` import block, and remove `getDeadlineInfo,` from that store import (its only use was the deleted interface; `npm run lint` fails on the unused import otherwise). Keep `Workflow`, `WorkflowEtapa`, `Cliente`, `Membro` if still referenced elsewhere in the file (run lint to confirm).

- [ ] **Step 5: Run tests, typecheck, lint**

Run: `npx vitest run apps/crm/src/pages/entregas/__tests__/boardEntity.test.ts apps/crm/src/pages/entregas/components/__tests__/WorkflowModals.test.tsx && npx tsc -p apps/crm/tsconfig.json --noEmit && npm run lint`
Expected: PASS; tsc clean; lint clean. `EditWorkflowModal` now receives the canonical `BoardCard` (a superset of the deleted local shape), so `EntregasPage.tsx:1000` compiles unchanged.

- [ ] **Step 6: Commit**

```bash
npx prettier --write apps/crm/src/pages/entregas/boardEntity.ts apps/crm/src/pages/entregas/__tests__/boardEntity.test.ts apps/crm/src/pages/entregas/hooks/useEntregasData.ts apps/crm/src/pages/entregas/components/WorkflowModals.tsx
git add apps/crm/src/pages/entregas/boardEntity.ts apps/crm/src/pages/entregas/__tests__/boardEntity.test.ts apps/crm/src/pages/entregas/hooks/useEntregasData.ts apps/crm/src/pages/entregas/components/WorkflowModals.tsx
git commit -m "feat(entregas): BoardEntity (fluxo | post individual) com projeção comum e adaptadores"
```

---

### Task 5: `boardRows.ts` — entities in, posts per column, signature row key behind an option

**Files:**
- Modify: `apps/crm/src/pages/entregas/boardRows.ts` (whole file)
- Modify: `apps/crm/src/pages/entregas/views/KanbanView.tsx:118-133` (`fullColumnOrder`, its `buildBoardRows` call is line 126), `:357, :383, :453` (the three `buildBoardRows(localCards, templates)` calls), `:856` (template quick-add) — adapter only, no behaviour change
- Test: `apps/crm/src/pages/entregas/__tests__/boardRows.test.ts` (update + extend)

**Interfaces:**
- Consumes: `BoardEntity`, `PostEntity`, `toWorkflowEntities`, `stageSignature`, `entityNumericId`, `isWorkflowEntity` (Task 4); `WorkflowTemplate`.
- Produces:
  - `interface BoardColumn { ordem: number; nome: string; tipo: 'padrao' | 'aprovacao_cliente'; cards: BoardCard[]; posts: PostEntity[] }` — `cards` sorted by `workflow.position` exactly as today; `posts` sorted by `posicao` then numeric id
  - `interface BoardRow { key: string; label: string; templateId: number | null; columns: BoardColumn[] }`
  - `interface BuildBoardRowsOptions { signatureRows?: boolean }` (default `false`)
  - `rowKeyFor(entity: BoardEntity, signatureRows: boolean): string`
  - `buildBoardRows(entities: BoardEntity[], templates: WorkflowTemplate[], opts?: BuildBoardRowsOptions): BoardRow[]`
  - `findCardColumn(cardId: string, rows: BoardRow[])` — now also matches a post by its entity id (`'post:<processId>'`)
  - `columnKey`, `parseColumnKey`, `isValidDropTarget` unchanged
  - `fullColumnOrder(allCards, visibleColumnCards, rowKey, ordem, templates, sortMode, signatureRows = false)` in KanbanView gains a trailing optional parameter

- [ ] **Step 1: Update the existing tests to the entity input and add signature-mode cases**

In `boardRows.test.ts` add `import { toWorkflowEntities } from '../boardEntity';` and change every `buildBoardRows([makeCard(...)...], templates)` call to `buildBoardRows(toWorkflowEntities([makeCard(...)...]), templates)`. Existing assertions stay green (default `signatureRows: false`). Then append:

```ts
import type { PostEntity } from '../boardEntity';

function makePostEntity(
  processId: number,
  templateId: number | null,
  etapas: EtapaLike[],
  ativaOrdem: number,
  posicao = 0,
): PostEntity {
  const steps = etapas.map((e) => ({ ordem: e.ordem, nome: e.nome, tipo: e.tipo ?? 'padrao' }));
  const step = steps.find((s) => s.ordem === ativaOrdem)!;
  return {
    kind: 'post',
    id: `post:${processId}`,
    process: { id: processId, post_id: 700 + processId, template_id: templateId } as never,
    step: step as never,
    templateId,
    steps,
    etapaOrdem: step.ordem,
    etapaNome: step.nome,
    responsavel: undefined,
    prazoEfetivo: null,
    posicao,
    deadline: { diasRestantes: 0, horasRestantes: 0, estourado: false, urgente: false },
    cliente: undefined,
    titulo: `Post ${processId}`,
  };
}

describe('buildBoardRows com posts individuais', () => {
  it('coloca o post na coluna da própria etapa e ordena por posicao, depois id', () => {
    const rows = buildBoardRows(
      [
        makeCard(1, 7, DUP, 1),
        makePostEntity(30, 7, DUP, 1, 0),
        makePostEntity(2, 7, DUP, 1, 0),
        makePostEntity(9, 7, DUP, 3, 5),
      ],
      [],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].columns[1].cards.map((c) => c.workflow.id)).toEqual([1]);
    expect(rows[0].columns[1].posts.map((p) => p.id)).toEqual(['post:2', 'post:30']);
    expect(rows[0].columns[3].posts.map((p) => p.id)).toEqual(['post:9']);
  });

  it('mantém uma linha que só tem posts', () => {
    const rows = buildBoardRows([makePostEntity(1, null, DUP, 0)], []);
    expect(rows).toHaveLength(1);
    expect(rows[0].columns[0].posts).toHaveLength(1);
  });

  it('expõe templateId na linha', () => {
    expect(buildBoardRows(toWorkflowEntities([makeCard(1, 7, DUP, 0)]), [])[0].templateId).toBe(7);
    expect(buildBoardRows(toWorkflowEntities([makeCard(1, null, DUP, 0)]), [])[0].templateId).toBeNull();
  });
});

describe('buildBoardRows com signatureRows (flag ligada)', () => {
  const SIG = '0|Copy|padrao;1|Aprovação|aprovacao_cliente;2|Design|padrao;3|Aprovação|aprovacao_cliente';

  it('chave = template + assinatura; rótulo = nome do template', () => {
    const rows = buildBoardRows(
      toWorkflowEntities([makeCard(1, 7, DUP, 0)]),
      [{ id: 7, nome: 'Redes', etapas: [] } as never],
      { signatureRows: true },
    );
    expect(rows[0].key).toBe(`template:7#${SIG}`);
    expect(rows[0].label).toBe('REDES');
  });

  it('dois fluxos do mesmo template com etapas divergentes viram duas linhas', () => {
    const longer = [...DUP, { id: 5, ordem: 4, nome: 'Publicação' }];
    const rows = buildBoardRows(
      toWorkflowEntities([makeCard(1, 7, DUP, 0), makeCard(2, 7, longer, 4)]),
      [],
      { signatureRows: true },
    );
    expect(rows).toHaveLength(2);
    expect(rows[0].columns.map((c) => c.ordem)).toEqual([0, 1, 2, 3]);
    expect(rows[1].columns.map((c) => c.ordem)).toEqual([0, 1, 2, 3, 4]);
  });

  it('sem template: chave custom#assinatura e rótulo "Etapas personalizadas"', () => {
    const rows = buildBoardRows(toWorkflowEntities([makeCard(1, null, DUP, 0)]), [], {
      signatureRows: true,
    });
    expect(rows[0].key).toBe(`custom#${SIG}`);
    expect(rows[0].label).toBe('ETAPAS PERSONALIZADAS');
  });

  it('fluxo e post com a mesma assinatura e template compartilham a linha', () => {
    const rows = buildBoardRows([makeCard(1, 7, DUP, 0), makePostEntity(3, 7, DUP, 2)], [], {
      signatureRows: true,
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].columns[2].posts.map((p) => p.id)).toEqual(['post:3']);
  });
});

describe('findCardColumn com posts', () => {
  it('localiza a coluna de um post pelo id da entidade', () => {
    const rows = buildBoardRows([makePostEntity(3, 7, DUP, 2)], []);
    expect(findCardColumn('post:3', rows)?.column.ordem).toBe(2);
    expect(findCardColumn('3', rows)).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run apps/crm/src/pages/entregas/__tests__/boardRows.test.ts`
Expected: FAIL — type errors / `posts` undefined / signature keys not produced.

- [ ] **Step 3: Rewrite `boardRows.ts`**

```ts
// apps/crm/src/pages/entregas/boardRows.ts
import type { WorkflowTemplate } from '../../store';
import type { BoardCard } from './hooks/useEntregasData';
import {
  entityNumericId,
  stageSignature,
  type BoardEntity,
  type PostEntity,
} from './boardEntity';

/** Uma coluna do quadro de Fluxos: identidade pela ORDEM da etapa dentro da
 *  linha, nunca pelo nome. Duas etapas chamadas "Aprovação" são duas colunas.
 *  `cards` são fluxos (arrastáveis); `posts` são processos individuais
 *  (fase 3: só leitura, sem drag). */
export interface BoardColumn {
  ordem: number;
  nome: string;
  tipo: 'padrao' | 'aprovacao_cliente';
  cards: BoardCard[];
  posts: PostEntity[];
}

export interface BoardRow {
  key: string;
  label: string;
  /** Template da linha, para o botão "Novo fluxo" da primeira coluna. */
  templateId: number | null;
  /** Ordenadas por `ordem` ascendente. */
  columns: BoardColumn[];
}

export interface BuildBoardRowsOptions {
  /** Spec §4.1: chave `template:<id>#<assinatura>` / `custom#<assinatura>`, de
   *  modo que snapshots divergentes do mesmo template viram linhas próprias.
   *  Ligado pela feature_post_processes; desligado, a chave é a de sempre
   *  (`template:<id>` ou nomes unidos), byte a byte. */
  signatureRows?: boolean;
}

const KEY_SEP = '::';

export function columnKey(rowKey: string, ordem: number): string {
  return `${rowKey}${KEY_SEP}${ordem}`;
}

/** Inverso de columnKey. A ordem é sempre o ÚLTIMO segmento, então o split é
 *  pelo último separador -- um rowKey pode conter "::" (nomes livres). */
export function parseColumnKey(key: string): { rowKey: string; ordem: number } | null {
  const idx = key.lastIndexOf(KEY_SEP);
  if (idx === -1) return null;
  const tail = key.slice(idx + KEY_SEP.length);
  if (!/^-?\d+$/.test(tail)) return null; // Number('') === 0: exige dígitos explícitos
  const ordem = Number(tail);
  return { rowKey: key.slice(0, idx), ordem };
}

export function rowKeyFor(entity: BoardEntity, signatureRows: boolean): string {
  if (signatureRows) {
    const sig = stageSignature(entity.steps);
    return entity.templateId != null ? `template:${entity.templateId}#${sig}` : `custom#${sig}`;
  }
  return entity.templateId != null
    ? `template:${entity.templateId}`
    : entity.steps.map((s) => s.nome).join(' → ');
}

function rowLabelFor(
  entity: BoardEntity,
  key: string,
  templates: WorkflowTemplate[],
  signatureRows: boolean,
): string {
  const t = entity.templateId != null ? templates.find((t) => t.id === entity.templateId) : undefined;
  if (t) return t.nome.toUpperCase();
  if (!signatureRows) return key.toUpperCase();
  if (entity.kind === 'post' && entity.process.template_nome) {
    return entity.process.template_nome.toUpperCase();
  }
  return 'ETAPAS PERSONALIZADAS';
}

export function buildBoardRows(
  entities: BoardEntity[],
  templates: WorkflowTemplate[],
  opts: BuildBoardRowsOptions = {},
): BoardRow[] {
  const signatureRows = opts.signatureRows === true;
  const rowMap = new Map<
    string,
    { key: string; label: string; templateId: number | null; columns: Map<number, BoardColumn> }
  >();
  for (const entity of entities) {
    const key = rowKeyFor(entity, signatureRows);
    if (!rowMap.has(key)) {
      rowMap.set(key, {
        key,
        label: rowLabelFor(entity, key, templates, signatureRows),
        templateId: entity.templateId,
        columns: new Map(),
      });
    }
    const row = rowMap.get(key)!;
    // Garante a coluna de cada etapa desta entidade (templates evoluem; um card
    // pode ter uma etapa a mais). O nome e o tipo vêm da primeira entidade que
    // trouxe a ordem.
    for (const s of entity.steps) {
      if (!row.columns.has(s.ordem)) {
        row.columns.set(s.ordem, { ordem: s.ordem, nome: s.nome, tipo: s.tipo, cards: [], posts: [] });
      }
    }
    const col = row.columns.get(entity.etapaOrdem);
    if (!col) continue;
    if (entity.kind === 'workflow') col.cards.push(entity.card);
    else col.posts.push(entity);
  }
  const rows: BoardRow[] = [];
  for (const r of rowMap.values()) {
    const columns = [...r.columns.values()].sort((a, b) => a.ordem - b.ordem);
    for (const col of columns) {
      col.cards.sort((a, b) => (a.workflow.position ?? 0) - (b.workflow.position ?? 0));
      col.posts.sort((a, b) => a.posicao - b.posicao || entityNumericId(a) - entityNumericId(b));
    }
    if (columns.some((c) => c.cards.length > 0 || c.posts.length > 0))
      rows.push({ key: r.key, label: r.label, templateId: r.templateId, columns });
  }
  return rows;
}

/** Um card só pode ser solto numa coluna adjacente que exista na SUA própria
 *  sequência de etapas. Linhas por template aceitam fluxos com listas
 *  divergentes; a coluna de ordem 3 de outro fluxo não é alvo válido para um
 *  fluxo que só tem ordens 0..2. */
export function isValidDropTarget(
  allEtapas: { ordem: number }[],
  activeOrdem: number,
  targetOrdem: number,
): boolean {
  return (
    Math.abs(targetOrdem - activeOrdem) === 1 && allEtapas.some((e) => e.ordem === targetOrdem)
  );
}

/** Localiza a coluna de um card de fluxo (id = String(workflow.id)) ou de um
 *  post individual (id = 'post:<processId>', o mesmo id do useSortable). */
export function findCardColumn(
  cardId: string,
  rows: BoardRow[],
): { row: BoardRow; column: BoardColumn } | null {
  for (const row of rows) {
    for (const column of row.columns) {
      if (column.cards.some((c) => String(c.workflow.id) === cardId)) return { row, column };
      if (column.posts.some((p) => p.id === cardId)) return { row, column };
    }
  }
  return null;
}
```

- [ ] **Step 4: Adapt `KanbanView.tsx` call sites (no behaviour change)**

Add `import { toWorkflowEntities } from '../boardEntity';` next to the `../boardRows` imports. Then:

- `fullColumnOrder` (line 118): add a 7th parameter `signatureRows = false` and change its `buildBoardRows(allCards, templates)` to `buildBoardRows(toWorkflowEntities(allCards), templates, { signatureRows })`.
- Line 357 `const boardRows = buildBoardRows(localCards, templates);` → `buildBoardRows(toWorkflowEntities(localCards), templates);`
- Line 383 (inside `handleDragOver`) and line 453 (inside `handleDragEnd`): same replacement.
- Line 856 `row.key.startsWith('template:') ? Number(row.key.slice('template:'.length)) : null` → `row.templateId`.

Task 8 replaces these adapter calls with the mixed list; for now they keep the board byte-identical.

- [ ] **Step 5: Run the board tests, typecheck, lint**

Run: `npx vitest run apps/crm/src/pages/entregas/__tests__/boardRows.test.ts apps/crm/src/pages/entregas/views/__tests__ && npx tsc -p apps/crm/tsconfig.json --noEmit && npm run lint`
Expected: PASS (all Kanban view tests unchanged); tsc and lint clean.

- [ ] **Step 6: Commit**

```bash
npx prettier --write apps/crm/src/pages/entregas/boardRows.ts apps/crm/src/pages/entregas/__tests__/boardRows.test.ts apps/crm/src/pages/entregas/views/KanbanView.tsx
git add apps/crm/src/pages/entregas/boardRows.ts apps/crm/src/pages/entregas/__tests__/boardRows.test.ts apps/crm/src/pages/entregas/views/KanbanView.tsx
git commit -m "feat(entregas): linhas do quadro por entidade, posts por coluna e chave por assinatura opcional"
```

---

### Task 6: `useEntregasData({ postProcessesEnabled })` — the flag-gated batch, `postEntities`, and the page's flag read

**Files:**
- Modify: `apps/crm/src/hooks/useWorkspaceLimits.ts:47` (add `feature_post_processes: boolean;` after `feature_briefing_audio`)
- Modify: `apps/crm/src/pages/entregas/hooks/useEntregasData.ts` (imports; new queries after line 334; `refresh()` at 392-405; return at 413-431; signature at 211)
- Modify: `apps/crm/src/pages/entregas/EntregasPage.tsx:33, :96, :133-149, :196-197, :753`
- Test: `apps/crm/src/pages/entregas/hooks/__tests__/useEntregasData.test.ts` (append), `apps/crm/src/pages/entregas/__tests__/EntregasPage.test.tsx` (mock updates)

**Interfaces:**
- Consumes: `getVigentePostProcesses`, `PostProcessWithPost` (Task 2); `getPostCovers` (`services/postMedia`); `toPostEntity`, `PostEntity` (Task 4).
- Produces:
  - `useEntregasData(options: { postProcessesEnabled?: boolean } = {})` — same return as today plus `postEntities: PostEntity[]` (active processes only, stable `EMPTY_POST_ENTITIES` identity when empty), `processByPostId: Map<number, PostProcessWithPost>` (ativo + concluido), `concludedPostProcesses: PostProcessWithPost[]`, `activePostProcessCount: number`
  - Query keys: `['post-processes', 'vigentes']` (disabled unless `postProcessesEnabled`), `['post-process-covers', <ids>]`
  - `refresh()` additionally invalidates `['post-processes']`, `['post-process-covers']`, `['post-process-events']`, `['post-process']`, `['concluded-workflows']`, `['concluded-summaries']`
  - In `EntregasPage`: `const postProcessesEnabled = features?.feature_post_processes === true;` — the single flag read every later task in this file reuses; header shows `· posts individuais: N` when the flag is on

- [ ] **Step 1: Add the flag to `FeatureFlags`**

In `apps/crm/src/hooks/useWorkspaceLimits.ts` after `feature_briefing_audio: boolean;` add:

```ts
  /** Processos individuais de produção (spec 2026-09-10). The workspace-limits
   *  edge function already returns it (FEATURE_COLUMNS in _shared/entitlements.ts). */
  feature_post_processes: boolean;
```

- [ ] **Step 2: Append the failing hook tests**

The file already mocks `../../../../lib/supabase`, `../../../../store` (spread of `importOriginal`) and `../../../../services/postMedia` (`getWorkflowCovers`). Extend the postMedia mock at line 107 with `getPostCovers: vi.fn().mockResolvedValue(new Map()),` and the store mock with `getVigentePostProcesses: vi.fn().mockResolvedValue([]),`. Then append:

```ts
import { getVigentePostProcesses } from '../../../../store';
import { useEntregasData } from '../useEntregasData';

const vigenteFixture = {
  id: 9,
  conta_id: 'c',
  post_id: 77,
  template_id: null,
  template_nome: null,
  assinatura: '',
  origem_workflow_id: null,
  origem_descricao: null,
  estado: 'ativo',
  motivo_encerramento: null,
  etapa_atual: 0,
  modo_prazo: 'padrao',
  board_position: 0,
  revisao: 1,
  created_by: null,
  created_at: '2026-09-10T00:00:00Z',
  updated_at: '2026-09-10T00:00:00Z',
  concluido_em: null,
  steps: [
    {
      id: 1, conta_id: 'c', process_id: 9, ordem: 0, nome: 'Copy', tipo: 'padrao', responsavel_id: null,
      prazo_dias: null, tipo_prazo: null, prazo_efetivo: null, estado: 'ativo', iniciado_em: null,
      concluido_em: null, interrompido_em: null, origem_etapa_ordem: null, origem_etapa_nome: null,
    },
  ],
  post: {
    id: 77, workflow_id: null, cliente_id: 10, cliente_nome: 'Cliente A', workflow_titulo: null,
    titulo: 'Post X', tipo: 'feed', status: 'rascunho', custom_status_id: null, scheduled_at: null,
    published_at: null, ig_caption: null, instagram_permalink: null, publish_error: null,
    publish_error_code: null, ordem: 0, responsavel_id: null, platform: 'instagram',
    tiktok_publish_status: null, tiktok_publish_error: null, tiktok_post_url: null,
    instagram_media_id: null, ig_trial_strategy: null, board_ordem: null,
  },
};

describe('useEntregasData: processos individuais', () => {
  it('com a flag desligada não consulta post_processes e devolve listas vazias estáveis', async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrapper = ({ children }: { children: ReactNode }) =>
      createElement(QueryClientProvider, { client: qc }, children);
    const { result } = renderHook(() => useEntregasData(), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(getVigentePostProcesses).not.toHaveBeenCalled();
    expect(result.current.postEntities).toEqual([]);
    expect(result.current.activePostProcessCount).toBe(0);
    expect(result.current.processByPostId.size).toBe(0);
    const first = result.current.postEntities;
    await waitFor(() => expect(result.current.postEntities).toBe(first));
  });

  it('com a flag ligada monta postEntities dos ativos e o mapa por post dos vigentes', async () => {
    (getVigentePostProcesses as any).mockResolvedValueOnce([
      vigenteFixture,
      { ...vigenteFixture, id: 10, post_id: 78, estado: 'concluido', steps: [], etapa_atual: 0 },
    ]);
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrapper = ({ children }: { children: ReactNode }) =>
      createElement(QueryClientProvider, { client: qc }, children);
    const { result } = renderHook(() => useEntregasData({ postProcessesEnabled: true }), { wrapper });
    await waitFor(() => expect(result.current.postEntities).toHaveLength(1));
    expect(result.current.postEntities[0]).toMatchObject({ kind: 'post', id: 'post:9', etapaNome: 'Copy' });
    expect(result.current.postEntities[0].cliente?.nome).toBe('Cliente A');
    expect(result.current.activePostProcessCount).toBe(1);
    expect(result.current.concludedPostProcesses.map((p) => p.id)).toEqual([10]);
    expect([...result.current.processByPostId.keys()].sort()).toEqual([77, 78]);
  });
});
```

- [ ] **Step 3: Run to verify failure**

Run: `npx vitest run apps/crm/src/pages/entregas/hooks/__tests__/useEntregasData.test.ts`
Expected: FAIL — `useEntregasData` takes no options; `postEntities` undefined.

- [ ] **Step 4: Implement in the hook**

Imports: add `getVigentePostProcesses, type PostProcessWithPost` to the `'../../../store'` import; add `import { getPostCovers } from '../../../services/postMedia';` next to `getWorkflowCovers`; add `import { toPostEntity, type PostEntity } from '../boardEntity';`.

After the other `EMPTY_*` constants add:

```ts
const EMPTY_PROCESSES: PostProcessWithPost[] = [];
const EMPTY_POST_ENTITIES: PostEntity[] = [];
const EMPTY_PROCESS_MAP: Map<number, PostProcessWithPost> = new Map();
```

Change the signature to:

```ts
export interface UseEntregasDataOptions {
  /** features?.feature_post_processes === true. Off (default) fires no
   *  post_processes query and returns the empty constants below. */
  postProcessesEnabled?: boolean;
}

export function useEntregasData(options: UseEntregasDataOptions = {}) {
  const postProcessesEnabled = options.postProcessesEnabled === true;
  const qc = useQueryClient();
```

After the `hubTokens` query (line 334) add:

```ts
  // Processos individuais (spec §8.3): UM lote por conta com ativos e
  // concluídos. Os ativos viram cards; os concluídos vão para Concluídas; os
  // dois juntos são a exclusão da seção Sem processo. Desligado pela flag, a
  // query nem existe e tudo abaixo devolve as constantes vazias (identidade
  // estável, mesma regra dos EMPTY_* acima).
  const vigenteQuery = useQuery({
    queryKey: ['post-processes', 'vigentes'],
    queryFn: getVigentePostProcesses,
    enabled: postProcessesEnabled,
  });
  const vigenteProcesses: PostProcessWithPost[] = vigenteQuery.data ?? EMPTY_PROCESSES;
  const activeProcesses = useMemo(
    () => (vigenteProcesses.length ? vigenteProcesses.filter((p) => p.estado === 'ativo') : EMPTY_PROCESSES),
    [vigenteProcesses],
  );
  const concludedPostProcesses = useMemo(
    () =>
      vigenteProcesses.length
        ? vigenteProcesses.filter((p) => p.estado === 'concluido')
        : EMPTY_PROCESSES,
    [vigenteProcesses],
  );
  const processByPostId = useMemo(
    () =>
      vigenteProcesses.length
        ? new Map(vigenteProcesses.map((p) => [p.post_id, p]))
        : EMPTY_PROCESS_MAP,
    [vigenteProcesses],
  );
  const processPostIds = useMemo(() => activeProcesses.map((p) => p.post_id), [activeProcesses]);
  const { data: processCovers } = useQuery({
    queryKey: ['post-process-covers', processPostIds.join(',')],
    queryFn: () => getPostCovers(processPostIds),
    enabled: processPostIds.length > 0,
  });
  const postEntities: PostEntity[] = useMemo(() => {
    if (activeProcesses.length === 0) return EMPTY_POST_ENTITIES;
    const out: PostEntity[] = [];
    for (const p of activeProcesses) {
      const e = toPostEntity(p, { clientes, membros, clienteAvatars, covers: processCovers });
      if (e) out.push(e);
    }
    return out;
  }, [activeProcesses, clientes, membros, clienteAvatars, processCovers]);
```

In `refresh()` append:

```ts
    qc.invalidateQueries({ queryKey: ['post-processes'] });
    qc.invalidateQueries({ queryKey: ['post-process-covers'] });
    qc.invalidateQueries({ queryKey: ['post-process-events'] });
    qc.invalidateQueries({ queryKey: ['post-process'] });
    // Spec §4.4: refresh() da página passa a invalidar concluded-*. Inerte
    // enquanto ConcludedView não estiver montada.
    qc.invalidateQueries({ queryKey: ['concluded-workflows'] });
    qc.invalidateQueries({ queryKey: ['concluded-summaries'] });
```

Change `const isLoading = loadingWf || etapasQuery.isLoading;` to `const isLoading = loadingWf || etapasQuery.isLoading || vigenteQuery.isLoading;` and `isFetching` to `fetchingWf || etapasQuery.isFetching || vigenteQuery.isFetching;` (both `false` for a disabled query). In the return add `postEntities, processByPostId, concludedPostProcesses, activePostProcessCount: activeProcesses.length,` after `cards,`.

- [ ] **Step 5: Wire the flag in `EntregasPage.tsx`**

Add `import { useWorkspaceLimits } from '@/hooks/useWorkspaceLimits';` after the `useAuth` import (line 27). After `const contaId = profile?.conta_id ?? 'unknown';` (line 96) add:

```ts
  // Processos individuais de produção (spec 2026-09-10). Ships dark: every new
  // surface on this page checks this one boolean; nothing else may read the flag.
  const { features } = useWorkspaceLimits();
  const postProcessesEnabled = features?.feature_post_processes === true;
```

Change `} = useEntregasData();` (line 149) to `} = useEntregasData({ postProcessesEnabled });` and add `postEntities, activePostProcessCount,` to the destructuring (after `cards,`). Change line 196 to:

```ts
  const activeBoardCount = activeWorkflows.length + activePostProcessCount;
```

In the header `<p>` (line 753) change `fluxos ativos: {activeWorkflows.length}` to:

```tsx
            fluxos ativos: {activeWorkflows.length}
            {postProcessesEnabled && <> · posts individuais: {activePostProcessCount}</>}
```

Destructure only `postEntities` and `activePostProcessCount` in this task (lint rejects unused destructured names). Task 10 adds `processByPostId` to the destructuring when it first uses it; `concludedPostProcesses` is never read by the page (`ConcludedView` runs the same query itself in Task 14) and stays a hook-only export.

- [ ] **Step 6: Update `EntregasPage.test.tsx` mocks**

After the `useActivePosts` mock (line 9-11) add:

```ts
const limitsMock = vi.hoisted(() => ({ features: null as Record<string, boolean> | null }));
vi.mock('@/hooks/useWorkspaceLimits', () => ({
  useWorkspaceLimits: () => ({
    limits: null,
    features: limitsMock.features,
    planName: null,
    isLoading: false,
    isUnlimited: false,
  }),
}));
```

The file calls `mockedUseEntregasData.mockReturnValue({...})` in FOUR places: the `renderEntregasPage` helper (line 487) and three tests that build their own object inline (line 534 "renders a loading state", line 552 "renders the default kanban shell", line 642 "switches views and hides filters"). Extend ALL FOUR objects with `postEntities: [], processByPostId: new Map(), concludedPostProcesses: [], activePostProcessCount: 0,`. Missing them is not benign: `activeWorkflows.length + activePostProcessCount` becomes `NaN`, `shouldShowExample` turns false and the existing example-board tests fail; after Task 8, `postEntities.length` throws. Add `limitsMock.features = null;` to the top-level `beforeEach`. Add one test:

```ts
  it('mostra o total de posts individuais no cabeçalho só com a flag ligada', async () => {
    renderEntregasPage({ activeWorkflows: [wfFixture], cards: [] });
    expect(await screen.findByText(/fluxos ativos: 1/)).toBeInTheDocument();
    expect(screen.queryByText(/posts individuais/)).toBeNull();
  });
```

- [ ] **Step 7: Run tests, typecheck, lint**

Run: `npx vitest run apps/crm/src/pages/entregas/hooks/__tests__/useEntregasData.test.ts apps/crm/src/pages/entregas/__tests__/EntregasPage.test.tsx && npx tsc -p apps/crm/tsconfig.json --noEmit && npm run lint`
Expected: PASS; clean.

- [ ] **Step 8: Commit**

```bash
npx prettier --write apps/crm/src/hooks/useWorkspaceLimits.ts apps/crm/src/pages/entregas/hooks/useEntregasData.ts apps/crm/src/pages/entregas/EntregasPage.tsx apps/crm/src/pages/entregas/hooks/__tests__/useEntregasData.test.ts apps/crm/src/pages/entregas/__tests__/EntregasPage.test.tsx
git add apps/crm/src/hooks/useWorkspaceLimits.ts apps/crm/src/pages/entregas/hooks/useEntregasData.ts apps/crm/src/pages/entregas/EntregasPage.tsx apps/crm/src/pages/entregas/hooks/__tests__/useEntregasData.test.ts apps/crm/src/pages/entregas/__tests__/EntregasPage.test.tsx
git commit -m "feat(entregas): lote de processos individuais no hook, atrás de feature_post_processes"
```

---

### Task 7: `entidade` filter — URL param, localStorage preference, toggle

**Files:**
- Modify: `apps/crm/src/pages/entregas/viewQuery.ts:9-19, :29-32, :54-57, :89`
- Modify: `apps/crm/src/pages/entregas/entregasPrefs.ts` (append after `persistLastMode`)
- Create: `apps/crm/src/pages/entregas/components/EntidadeToggle.tsx`
- Modify: `apps/crm/src/pages/entregas/EntregasPage.tsx:88-118, :316-338, :534-541, :856-858`
- Test: `apps/crm/src/pages/entregas/__tests__/viewQuery.test.ts`, `__tests__/entregasPrefs.test.ts`, `__tests__/EntregasPage.test.tsx`

**Interfaces:**
- Consumes: `postProcessesEnabled` (Task 6).
- Produces:
  - `export type EntidadeFilter = 'todos' | 'fluxos' | 'posts'` (viewQuery.ts); `EntregasViewState.entidade: EntidadeFilter`; serializer omits `fluxos`, emits `todos`/`posts`; parser: absent or malformed → `fluxos`
  - `loadLastEntidade(contaId): EntidadeFilter | null`, `persistLastEntidade(contaId, entidade): void`, `hasLastMode(contaId): boolean` (prefs; key `entregas_entidade_<contaId>`)
  - `EntidadeToggle({ value, onChange }: { value: EntidadeFilter; onChange: (v: EntidadeFilter) => void })`
  - In `EntregasPage`: `entidade` state, `effectiveEntidade` (= `'fluxos'` when the flag is off). Later tasks read `effectiveEntidade`.

- [ ] **Step 1: Failing tests — viewQuery and prefs**

`viewQuery.test.ts`: add `entidade: 'fluxos' as const` to the `state` literal of "round-trips a fully loaded state" and to every other `EntregasViewState` literal in the file, then append:

```ts
describe('entidade', () => {
  it('ausente ou malformado vira fluxos; todos e posts são explícitos', () => {
    expect(parseEntregasQuery(new URLSearchParams('')).entidade).toBe('fluxos');
    expect(parseEntregasQuery(new URLSearchParams('entidade=xyz')).entidade).toBe('fluxos');
    expect(parseEntregasQuery(new URLSearchParams('entidade=todos')).entidade).toBe('todos');
    expect(parseEntregasQuery(new URLSearchParams('entidade=posts')).entidade).toBe('posts');
  });

  it('o serializador omite fluxos e emite os outros', () => {
    const base = { view: 'kanban' as const, mode: 'entregas' as const, filters: EMPTY_FILTERS };
    expect(serializeEntregasQuery({ ...base, entidade: 'fluxos' })).toBe('');
    expect(serializeEntregasQuery({ ...base, entidade: 'todos' })).toBe('entidade=todos');
    expect(serializeEntregasQuery({ ...base, entidade: 'posts' })).toBe('entidade=posts');
  });
});
```

`entregasPrefs.test.ts`: extend the import with `loadLastEntidade, persistLastEntidade, hasLastMode` and append:

```ts
describe('entidade prefs', () => {
  beforeEach(() => localStorage.clear());

  it('null sem chave ou com lixo; persiste e recarrega por conta', () => {
    expect(loadLastEntidade('c1')).toBeNull();
    localStorage.setItem('entregas_entidade_c1', 'garbage');
    expect(loadLastEntidade('c1')).toBeNull();
    persistLastEntidade('c1', 'posts');
    expect(loadLastEntidade('c1')).toBe('posts');
    expect(localStorage.getItem('entregas_entidade_c1')).toBe('posts');
    expect(loadLastEntidade('c2')).toBeNull();
  });

  it('hasLastMode distingue ausente de entregas', () => {
    expect(hasLastMode('c1')).toBe(false);
    persistLastMode('c1', 'entregas');
    expect(hasLastMode('c1')).toBe(true);
  });

  it('não lança quando o storage falha', () => {
    const spy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    expect(loadLastEntidade('c1')).toBeNull();
    expect(hasLastMode('c1')).toBe(false);
    spy.mockRestore();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run apps/crm/src/pages/entregas/__tests__/viewQuery.test.ts apps/crm/src/pages/entregas/__tests__/entregasPrefs.test.ts`
Expected: FAIL (missing exports / property).

- [ ] **Step 3: Implement `viewQuery.ts`**

After `export type ActiveView = ...` add:

```ts
/** Spec §4.1: filtro de entidade do quadro de Fluxos. `fluxos` é o default do
 *  parser/serializador para que vistas salvas antigas continuem casando por
 *  igualdade de string enquanto o quadro estiver em Fluxos. */
export type EntidadeFilter = 'todos' | 'fluxos' | 'posts';
const ENTIDADES: readonly EntidadeFilter[] = ['todos', 'fluxos', 'posts'];
```

Add `entidade: EntidadeFilter;` to `EntregasViewState` (with the doc line `/** Only meaningful for kanban/list in mode 'entregas'. */`). The field is required, not optional, so every object literal typed `EntregasViewState` must gain it. `grep -rn "serializeEntregasQuery(\|EntregasViewState" apps/crm/src` outside `viewQuery.ts`, `viewQuery.test.ts` and `EntregasPage.tsx` returns nothing (verified on `main-local`: the only other consumer is `components/VistasTabs.tsx:26`, which calls `parseEntregasQuery` and reads `.view` from the full parsed state, so it needs no change). The single `serializeEntregasQuery({ view: activeView, mode: activeMode, filters })` literal in `EntregasPage.tsx:321` is updated in Step 4 of this task. Re-run the grep before committing; a new caller added on `main` since then needs `entidade: 'fluxos'`. In `serializeEntregasQuery` after the `mode` line add `if (state.entidade !== 'fluxos') p.set('entidade', state.entidade);`. In `parseEntregasQuery` after the `mode` line add:

```ts
  const rawEntidade = p.get('entidade') as EntidadeFilter | null;
  const entidade: EntidadeFilter =
    rawEntidade && ENTIDADES.includes(rawEntidade) ? rawEntidade : 'fluxos';
```

and return `{ view, mode, entidade, filters }`.

- [ ] **Step 4: Implement the prefs**

Append to `entregasPrefs.ts` after `persistLastMode` (import `type EntidadeFilter` from `'./viewQuery'` at the top — `viewQuery.ts` imports `PRAZO_PRESET_ORDER` from `etapaPrazo`, not from prefs, so there is no cycle):

```ts
const entidadeKey = (contaId: string) => `entregas_entidade_${contaId}`;
const ENTIDADES: EntidadeFilter[] = ['todos', 'fluxos', 'posts'];

/** Último filtro de entidade do quadro de Fluxos, por conta. null quando não
 *  há preferência gravada (ou o valor é lixo) -- a página então decide entre
 *  Fluxos e Todos pelo proxy hasLastMode (spec §4.1). */
export function loadLastEntidade(contaId: string): EntidadeFilter | null {
  try {
    const raw = localStorage.getItem(entidadeKey(contaId));
    return raw && (ENTIDADES as string[]).includes(raw) ? (raw as EntidadeFilter) : null;
  } catch {
    return null;
  }
}

export function persistLastEntidade(contaId: string, entidade: EntidadeFilter): void {
  try {
    localStorage.setItem(entidadeKey(contaId), entidade);
  } catch {
    // Best effort: a preferência só não sobrevive ao reload.
  }
}

/** "Já usou Entregas neste navegador": a chave de modo existe, qualquer valor.
 *  loadLastMode não serve porque devolve 'entregas' tanto para ausente quanto
 *  para o valor gravado. */
export function hasLastMode(contaId: string): boolean {
  try {
    return localStorage.getItem(storageKey(contaId)) !== null;
  } catch {
    return false;
  }
}
```

- [ ] **Step 5: Create `EntidadeToggle.tsx`**

```tsx
// apps/crm/src/pages/entregas/components/EntidadeToggle.tsx
import type { EntidadeFilter } from '../viewQuery';

interface EntidadeToggleProps {
  value: EntidadeFilter;
  onChange: (value: EntidadeFilter) => void;
}

const OPTIONS: { id: EntidadeFilter; label: string }[] = [
  { id: 'todos', label: 'Todos' },
  { id: 'fluxos', label: 'Fluxos' },
  { id: 'posts', label: 'Posts individuais' },
];

/** Filtro de entidade do quadro de Fluxos (spec §4.1), no mesmo desenho de
 *  ModeToggle. O texto auxiliar "Quadro por etapa de produção" vive aqui e
 *  não no ModeToggle, que não tem espaço para subtítulo. */
export function EntidadeToggle({ value, onChange }: EntidadeToggleProps) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', flexWrap: 'wrap' }}>
      <div
        role="radiogroup"
        aria-label="Entidades do quadro"
        style={{
          display: 'flex',
          gap: '0.25rem',
          background: 'var(--card-bg)',
          border: '1px solid var(--border-color)',
          padding: '0.25rem',
          borderRadius: 8,
          width: 'fit-content',
        }}
      >
        {OPTIONS.map((o) => (
          <button
            key={o.id}
            type="button"
            role="radio"
            aria-checked={value === o.id}
            onClick={() => onChange(o.id)}
            style={{
              padding: '0.35rem 0.85rem',
              borderRadius: 6,
              border: 'none',
              cursor: 'pointer',
              fontSize: '0.8rem',
              background: value === o.id ? 'var(--cta-bg)' : 'transparent',
              color: value === o.id ? 'var(--cta-fg)' : 'var(--text-secondary)',
              fontWeight: value === o.id ? 600 : 400,
              whiteSpace: 'nowrap',
            }}
          >
            {o.label}
          </button>
        ))}
      </div>
      <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
        Quadro por etapa de produção
      </span>
    </div>
  );
}
```

- [ ] **Step 6: Wire `EntregasPage.tsx`**

Imports: add `type EntidadeFilter` to the `./viewQuery` import; add `loadLastEntidade, persistLastEntidade, hasLastMode` to the `./entregasPrefs` import; add `import { EntidadeToggle } from './components/EntidadeToggle';`.

Next to `hadModeParam` (line 88) add `const hadEntidadeParam = useRef(searchParams.has('entidade')).current;`. After the `mode` state (line 118) add:

```ts
  // Filtro de entidade do quadro de Fluxos (spec §4.1). URL vence a preferência
  // local; sem as duas, quem já usou Entregas neste navegador começa em Fluxos e
  // quem nunca usou começa em Todos. Só é consumido através de effectiveEntidade.
  const [entidade, setEntidade] = useState<EntidadeFilter>(() => {
    if (hadEntidadeParam) return initialQuery.entidade;
    return loadLastEntidade(contaId) ?? (hasLastMode(contaId) ? 'fluxos' : 'todos');
  });
```

Right after `const postProcessesEnabled = ...` line (Task 6; it sits above this state, so place the next line after the `entidade` state instead):

```ts
  // Flag desligada: o quadro é sempre o de fluxos, a URL não ganha ?entidade= e
  // nenhuma chave nova entra no localStorage.
  const effectiveEntidade: EntidadeFilter = postProcessesEnabled ? entidade : 'fluxos';
```

Change `serializeEntregasQuery({ view: activeView, mode: activeMode, filters })` (line 321) to include `entidade: activeMode === 'entregas' && (activeView === 'kanban' || activeView === 'list') ? effectiveEntidade : 'fluxos'`. In `applySavedView` add `setEntidade(parsed.entidade);` inside the kanban/calendar/list branch. After the `persistLastMode` effect add:

```ts
  useEffect(() => {
    if (!postProcessesEnabled) return;
    if ((activeView === 'kanban' || activeView === 'list') && activeMode === 'entregas') {
      persistLastEntidade(contaId, effectiveEntidade);
    }
  }, [postProcessesEnabled, activeView, activeMode, effectiveEntidade, contaId]);
```

In the toolbar, right after the `<ModeToggle ... />` block (line 856-858) add:

```tsx
        {postProcessesEnabled &&
          (activeView === 'kanban' || activeView === 'list') &&
          mode === 'entregas' && <EntidadeToggle value={effectiveEntidade} onChange={setEntidade} />}
```

- [ ] **Step 7: Page tests**

Append to `EntregasPage.test.tsx` (uses `limitsMock` from Task 6; `renderPage(initialEntry)` and `localStorage` are available there):

```ts
  describe('filtro de entidade', () => {
    it('flag desligada: sem toggle e sem entidade na URL', () => {
      renderEntregasPage({ activeWorkflows: [wfFixture], cards: [] });
      expect(screen.queryByRole('radiogroup', { name: 'Entidades do quadro' })).toBeNull();
      // The URL guarantee (no ?entidade= when the flag is off) is `effectiveEntidade`
      // feeding serializeEntregasQuery, covered by the viewQuery tests: 'fluxos' is
      // omitted. MemoryRouter never touches window.location, so it is not asserted here.
    });

    it('flag ligada e navegador novo: começa em Todos; com entregas_last_mode gravado começa em Fluxos', () => {
      limitsMock.features = { feature_post_processes: true };
      renderEntregasPage({ activeWorkflows: [wfFixture], cards: [] });
      expect(screen.getByRole('radio', { name: 'Todos' })).toHaveAttribute('aria-checked', 'true');
    });

    it('com entregas_last_mode gravado começa em Fluxos', () => {
      limitsMock.features = { feature_post_processes: true };
      localStorage.setItem('entregas_last_mode_conta-1', 'entregas');
      renderEntregasPage({ activeWorkflows: [wfFixture], cards: [] });
      expect(screen.getByRole('radio', { name: 'Fluxos' })).toHaveAttribute('aria-checked', 'true');
    });

    it('?entidade=posts na URL vence a preferência local', () => {
      limitsMock.features = { feature_post_processes: true };
      localStorage.setItem('entregas_entidade_conta-1', 'todos');
      mockedUseEntregasData.mockReturnValue({
        clientes: [], membros: [], templates: [], cards: [], activeWorkflows: [wfFixture],
        postEntities: [], processByPostId: new Map(), concludedPostProcesses: [],
        activePostProcessCount: 0, isLoading: false, refresh: vi.fn(),
      } as never);
      renderPage('/entregas?entidade=posts');
      expect(screen.getByRole('radio', { name: 'Posts individuais' })).toHaveAttribute('aria-checked', 'true');
    });
  });
```

The `conta-1` id is the value of this file's `AuthContext` mock (`useAuth: () => ({ profile: { conta_id: 'conta-1', role: 'owner' } })`, line 171). The top-level `beforeEach` (line 512) already calls `localStorage.clear()`, so no extra cleanup is needed.

- [ ] **Step 8: Run, typecheck, lint, commit**

Run: `npx vitest run apps/crm/src/pages/entregas && npx tsc -p apps/crm/tsconfig.json --noEmit && npm run lint`
Expected: PASS; clean.

```bash
npx prettier --write apps/crm/src/pages/entregas/viewQuery.ts apps/crm/src/pages/entregas/entregasPrefs.ts apps/crm/src/pages/entregas/components/EntidadeToggle.tsx apps/crm/src/pages/entregas/EntregasPage.tsx apps/crm/src/pages/entregas/__tests__/viewQuery.test.ts apps/crm/src/pages/entregas/__tests__/entregasPrefs.test.ts apps/crm/src/pages/entregas/__tests__/EntregasPage.test.tsx
git add apps/crm/src/pages/entregas/viewQuery.ts apps/crm/src/pages/entregas/entregasPrefs.ts apps/crm/src/pages/entregas/components/EntidadeToggle.tsx apps/crm/src/pages/entregas/EntregasPage.tsx apps/crm/src/pages/entregas/__tests__
git commit -m "feat(entregas): filtro de entidade Todos/Fluxos/Posts individuais (URL + preferência local)"
```

---

### Task 8: Kanban — individual-post cards in mixed columns

**Files:**
- Create: `apps/crm/src/pages/entregas/components/PostProcessCard.tsx`
- Create: `apps/crm/src/pages/entregas/entityFilters.ts`
- Modify: `apps/crm/src/pages/entregas/views/KanbanView.tsx` (props 61-83; `rowCardCount` 95; `fullColumnOrder` 118-133; state block 260-360; empty gate 761; `renderRowBoard` 780-915)
- Modify: `apps/crm/src/pages/entregas/EntregasPage.tsx` (`etapaNames` 441-445; after `filteredCards` ~700; `handleCardClick` area 479; `<KanbanView>` 883-906)
- Modify: `apps/crm/style.css` (after `.post-fluxo-tag--avulso` block, line 5784)
- Test: `apps/crm/src/pages/entregas/__tests__/entityFilters.test.ts`, `apps/crm/src/pages/entregas/views/__tests__/KanbanPostEntities.test.tsx`

**Interfaces:**
- Consumes: `PostEntity`, `BoardEntity`, `toWorkflowEntities`, `sortEntitiesByPrazo`, `sortEntitiesByPosicao`, `isPostEntity` (Task 4); `buildBoardRows`/`BoardColumn.posts`/`findCardColumn` (Task 5); `postEntities`, `postProcessesEnabled`, `effectiveEntidade` (Tasks 6-7); `classifyDeadline` (deadlineStatus.ts); `matchesDeadlineFilter` (Task 3); `PostStatusChip` + `useStatusRegistry`; `TIPO_LABELS` (postLabels.ts).
- Produces:
  - `PostProcessCard({ entity, onClick, isDragOverlay }: { entity: PostEntity; onClick?: () => void; isDragOverlay?: boolean })` — `data-testid="post-process-card"`, no drag handle, no action row
  - `matchesPostEntityFilters(entity: PostEntity, filters: FilterState, now?: Date): boolean` (entityFilters.ts)
  - KanbanView new optional props: `postEntities?: PostEntity[]`, `postProcessesEnabled?: boolean` (drives `signatureRows` and copy), `onPostClick?: (entity: PostEntity) => void`
  - In `EntregasPage`: `filteredPostEntities`, `visibleCards`, `visiblePostEntities`, `handlePostEntityClick`

- [ ] **Step 1: `entityFilters.ts` + its test (failing first)**

```ts
// apps/crm/src/pages/entregas/__tests__/entityFilters.test.ts
import { describe, expect, it, vi } from 'vitest';
vi.mock('../../../lib/supabase');
import { EMPTY_FILTERS } from '../components/EntregasFilters';
import { matchesPostEntityFilters } from '../entityFilters';
import type { PostEntity } from '../boardEntity';

const NOW = new Date(2026, 6, 15, 10, 0, 0);

function entity(over: Partial<PostEntity> = {}): PostEntity {
  return {
    kind: 'post',
    id: 'post:1',
    process: { id: 1, post_id: 50, template_id: 7, post: { id: 50, cliente_id: 3, responsavel_id: 11, titulo: 'Reels de julho' } } as never,
    step: { responsavel_id: 8 } as never,
    templateId: 7,
    steps: [],
    etapaOrdem: 0,
    etapaNome: 'Design',
    responsavel: undefined,
    prazoEfetivo: new Date(2026, 6, 15, 18, 0, 0),
    posicao: 0,
    deadline: { diasRestantes: 0, horasRestantes: 8, estourado: false, urgente: true },
    cliente: undefined,
    titulo: 'Reels de julho',
    ...over,
  };
}

describe('matchesPostEntityFilters', () => {
  it('sem filtros aceita', () => {
    expect(matchesPostEntityFilters(entity(), EMPTY_FILTERS, NOW)).toBe(true);
  });
  it('busca por título, cliente, responsável da etapa, responsável do post, etapa e template', () => {
    const e = entity();
    expect(matchesPostEntityFilters(e, { ...EMPTY_FILTERS, filterSearch: 'JULHO' }, NOW)).toBe(true);
    expect(matchesPostEntityFilters(e, { ...EMPTY_FILTERS, filterSearch: 'agosto' }, NOW)).toBe(false);
    expect(matchesPostEntityFilters(e, { ...EMPTY_FILTERS, filterClientes: [3] }, NOW)).toBe(true);
    expect(matchesPostEntityFilters(e, { ...EMPTY_FILTERS, filterClientes: [4] }, NOW)).toBe(false);
    expect(matchesPostEntityFilters(e, { ...EMPTY_FILTERS, filterMembros: [8] }, NOW)).toBe(true);
    expect(matchesPostEntityFilters(e, { ...EMPTY_FILTERS, filterMembros: [11] }, NOW)).toBe(false);
    expect(matchesPostEntityFilters(e, { ...EMPTY_FILTERS, filterPostResponsaveis: [11] }, NOW)).toBe(true);
    expect(matchesPostEntityFilters(e, { ...EMPTY_FILTERS, filterEtapas: ['Design'] }, NOW)).toBe(true);
    expect(matchesPostEntityFilters(e, { ...EMPTY_FILTERS, filterEtapas: ['Copy'] }, NOW)).toBe(false);
    expect(matchesPostEntityFilters(e, { ...EMPTY_FILTERS, filterTemplates: [7] }, NOW)).toBe(true);
    expect(matchesPostEntityFilters(entity({ templateId: null }), { ...EMPTY_FILTERS, filterTemplates: [7] }, NOW)).toBe(false);
  });
  it('status de prazo e prazo da etapa usam o mesmo bucket e o mesmo matcher dos fluxos', () => {
    const e = entity();
    expect(matchesPostEntityFilters(e, { ...EMPTY_FILTERS, filterStatus: ['urgente'] }, NOW)).toBe(true);
    expect(matchesPostEntityFilters(e, { ...EMPTY_FILTERS, filterStatus: ['atrasado'] }, NOW)).toBe(false);
    expect(matchesPostEntityFilters(e, { ...EMPTY_FILTERS, filterPrazo: ['hoje'] }, NOW)).toBe(true);
    expect(matchesPostEntityFilters(entity({ prazoEfetivo: null }), { ...EMPTY_FILTERS, filterPrazo: ['hoje'] }, NOW)).toBe(false);
  });
});
```

```ts
// apps/crm/src/pages/entregas/entityFilters.ts
import type { FilterState, StatusFilter } from './components/EntregasFilters';
import type { PostEntity } from './boardEntity';
import { classifyDeadline } from './deadlineStatus';
import { matchesDeadlineFilter } from './etapaPrazo';

/**
 * The Fluxos-mode page filters applied to an individual post (mirror of the
 * `filteredCards` chain in EntregasPage, field by field, in the same order).
 * filterTipos / filterPostStatus only exist on the Publicações bar and are not
 * read here, exactly like `filteredCards`.
 */
export function matchesPostEntityFilters(
  entity: PostEntity,
  filters: FilterState,
  now: Date = new Date(),
): boolean {
  if (filters.filterSearch) {
    if (!entity.titulo.toLowerCase().includes(filters.filterSearch.toLowerCase())) return false;
  }
  const clienteId = entity.process.post.cliente_id;
  if (filters.filterClientes.length) {
    if (clienteId == null || !filters.filterClientes.includes(clienteId)) return false;
  }
  if (filters.filterMembros.length) {
    const r = entity.step.responsavel_id;
    if (r == null || !filters.filterMembros.includes(r)) return false;
  }
  if (filters.filterPostResponsaveis.length) {
    const r = entity.process.post.responsavel_id;
    if (r == null || !filters.filterPostResponsaveis.includes(r)) return false;
  }
  if (filters.filterEtapas.length && !filters.filterEtapas.includes(entity.etapaNome)) return false;
  if (filters.filterTemplates.length) {
    if (entity.templateId == null || !filters.filterTemplates.includes(entity.templateId))
      return false;
  }
  if (filters.filterStatus.length) {
    const status: StatusFilter = classifyDeadline(entity.deadline);
    if (!filters.filterStatus.includes(status)) return false;
  }
  if (filters.filterPrazo.length || filters.filterPrazoFrom || filters.filterPrazoTo) {
    if (
      !matchesDeadlineFilter(
        { deadline: entity.deadline, date: entity.prazoEfetivo },
        filters.filterPrazo,
        filters.filterPrazoFrom,
        filters.filterPrazoTo,
        now,
      )
    )
      return false;
  }
  return true;
}
```

Run: `npx vitest run apps/crm/src/pages/entregas/__tests__/entityFilters.test.ts` → PASS after the module exists.

- [ ] **Step 2: Create `PostProcessCard.tsx`**

```tsx
// apps/crm/src/pages/entregas/components/PostProcessCard.tsx
import { useNavigate } from 'react-router-dom';
import { FileText } from 'lucide-react';
import { MediaUnavailable } from '@/components/MediaUnavailable';
import { avatarColorClass } from '@/lib/avatarColor';
import { useStatusRegistry } from '@/hooks/useStatusRegistry';
import type { PostEntity } from '../boardEntity';
import { TIPO_LABELS } from '../postLabels';
import { PostStatusChip } from './PostStatusChip';

function getInitials(name: string): string {
  return name
    .split(' ')
    .map((p) => p[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();
}

const deadlineAccent: Record<string, string> = {
  'deadline-ok': '#3ecf8e',
  'deadline-caution': '#eab308',
  'deadline-warning': '#ea580c',
  'deadline-overdue': '#ef4444',
};

interface PostProcessCardProps {
  entity: PostEntity;
  onClick?: () => void;
  isDragOverlay?: boolean;
}

/**
 * Card de um post individual no quadro de Fluxos (spec §4.2): cliente, título,
 * formato, tag "Individual", status do post (PostStatusChip, os mesmos rótulos
 * de Publicações), responsável e prazo da etapa, etapa e progresso, capa
 * quando existe. Fase 3 = leitura: SEM alça de arrastar e SEM botões de
 * avançar/voltar (fase 4). A marcação espelha WorkflowCard para que os dois
 * tipos fiquem visualmente na mesma família; o tipo é identificado por texto e
 * ícone, a cor é complementar.
 */
export function PostProcessCard({ entity, onClick, isDragOverlay }: PostProcessCardProps) {
  const navigate = useNavigate();
  const registry = useStatusRegistry();
  const dl = entity.deadline;
  const deadlineClass = dl.estourado
    ? 'deadline-overdue'
    : dl.urgente
      ? 'deadline-warning'
      : dl.diasRestantes <= 3
        ? 'deadline-caution'
        : 'deadline-ok';
  const hasDeadline = entity.prazoEfetivo != null;
  const deadlineText = !hasDeadline
    ? 'Sem prazo'
    : dl.estourado
      ? `${Math.abs(dl.diasRestantes)}d atrasado`
      : dl.diasRestantes === 0 && dl.horasRestantes === 0
        ? 'Vence agora'
        : dl.diasRestantes === 0
          ? `${dl.horasRestantes}h restantes`
          : dl.horasRestantes > 0
            ? `${dl.diasRestantes}d ${dl.horasRestantes}h restantes`
            : `${dl.diasRestantes}d restantes`;
  const etapaIdx = entity.steps.findIndex((s) => s.ordem === entity.etapaOrdem);
  const total = entity.steps.length;
  const progressPct = total > 0 && etapaIdx >= 0 ? Math.round((etapaIdx / total) * 100) : 0;
  const accent = deadlineAccent[deadlineClass] ?? '#3ecf8e';
  const post = entity.process.post;
  const cliente = entity.cliente;

  return (
    <div
      className={`board-card board-card--post ${hasDeadline ? deadlineClass : 'deadline-ok'}`}
      data-testid="post-process-card"
      style={{
        opacity: isDragOverlay ? 0.85 : 1,
        position: 'relative',
        padding: '0.9rem',
        gap: '0.6rem',
        borderRadius: '10px',
      }}
      onClick={onClick}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span
          className="board-card-client"
          style={{
            borderLeft: 'none',
            paddingLeft: 0,
            fontSize: '0.74rem',
            fontWeight: 500,
            textTransform: 'none',
            color: 'var(--text-muted)',
            display: 'inline-flex',
            alignItems: 'center',
            gap: '0.35rem',
          }}
        >
          {cliente ? (
            <>
              {entity.clienteAvatarUrl ? (
                <img
                  src={entity.clienteAvatarUrl}
                  alt=""
                  loading="lazy"
                  decoding="async"
                  style={{ width: 18, height: 18, borderRadius: '50%', objectFit: 'cover', flexShrink: 0 }}
                />
              ) : (
                <div
                  style={{
                    width: 18,
                    height: 18,
                    borderRadius: '50%',
                    background: cliente.cor || 'var(--surface-hover)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: '0.45rem',
                    fontWeight: 800,
                    color: '#fff',
                    flexShrink: 0,
                  }}
                >
                  {getInitials(cliente.nome)}
                </div>
              )}
              <span
                role="link"
                tabIndex={0}
                onClick={(e) => {
                  e.stopPropagation();
                  navigate(`/clientes/${cliente.id}`);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.stopPropagation();
                    navigate(`/clientes/${cliente.id}`);
                  }
                }}
                style={{ cursor: 'pointer', color: cliente.cor || 'var(--text-muted)', opacity: 0.85 }}
              >
                {cliente.nome}
              </span>
            </>
          ) : (
            post.cliente_nome || '—'
          )}
        </span>
        <span className="post-fluxo-tag post-fluxo-tag--avulso post-fluxo-tag--individual">
          <FileText size={11} aria-hidden="true" style={{ flexShrink: 0 }} />
          Individual
        </span>
      </div>

      <div
        className="board-card-title"
        style={{ fontSize: '0.9rem', fontWeight: 700, lineHeight: 1.35, color: 'var(--text-main)' }}
      >
        {entity.titulo || 'Post sem título'}
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
        <span style={{ fontSize: '0.68rem', color: 'var(--text-muted)' }}>{TIPO_LABELS[post.tipo]}</span>
        <PostStatusChip post={post} registry={registry} />
      </div>

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.5rem' }}>
        <span
          className={`board-card-deadline ${hasDeadline ? deadlineClass : 'deadline-ok'}`}
          style={{ fontSize: '0.7rem', fontWeight: 700, padding: '0.2rem 0.6rem', borderRadius: '999px' }}
        >
          {deadlineText}
        </span>
        {entity.step.tipo_prazo && (
          <span
            className="board-card-prazo-type"
            style={{ fontSize: '0.62rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}
          >
            {entity.step.tipo_prazo === 'uteis' ? 'úteis' : 'corridos'}
          </span>
        )}
      </div>

      <div
        className="board-card-assignee"
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: '0.4rem',
          padding: '0.25rem 0.5rem 0.25rem 0.25rem',
          borderRadius: '10px',
          border: '1px solid var(--border-color)',
          background: 'var(--card-bg)',
          width: 'fit-content',
          maxWidth: '100%',
        }}
      >
        {entity.responsavel ? (
          <>
            <div
              className={`avatar ${avatarColorClass(entity.responsavel.id ?? entity.responsavel.nome)}`}
              style={{ width: 20, height: 20, fontSize: '0.55rem', fontWeight: 800 }}
            >
              {getInitials(entity.responsavel.nome)}
            </div>
            <span style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-main)' }}>
              {entity.responsavel.nome}
            </span>
          </>
        ) : (
          <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontStyle: 'italic' }}>
            Sem responsável
          </span>
        )}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={{ fontSize: '0.68rem', fontWeight: 600, color: 'var(--text-main)' }}>
            {entity.etapaNome}
          </span>
          <span style={{ fontSize: '0.65rem', color: 'var(--text-muted)', fontWeight: 600, fontFamily: 'var(--font-mono)' }}>
            {etapaIdx + 1}/{total}
          </span>
        </div>
        <div style={{ height: '5px', background: 'var(--surface-hover)', borderRadius: '999px', overflow: 'hidden' }}>
          <div style={{ height: '100%', width: `${progressPct}%`, background: accent, borderRadius: '999px', opacity: 0.85 }} />
        </div>
      </div>

      {entity.cover && (
        <div
          style={{
            width: 32,
            height: 32,
            borderRadius: '50%',
            overflow: 'hidden',
            border: '2px solid var(--card-bg)',
            background: 'var(--surface-hover)',
          }}
        >
          {entity.cover.media_lost_at ? (
            <MediaUnavailable size="compact" />
          ) : (
            <img
              src={entity.cover.thumbnail_url ?? entity.cover.url}
              alt=""
              loading="lazy"
              decoding="async"
              style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
            />
          )}
        </div>
      )}
    </div>
  );
}
```

CSS, appended after the `[data-theme='dark'] .post-fluxo-tag--avulso` rule in `apps/crm/style.css`:

```css
/* Post individual com processo (spec §5.4): mesma família visual do avulso,
   borda sólida para diferenciar de "sem processo". */
.post-fluxo-tag--individual {
  border-style: solid;
}
.board-card--post {
  cursor: pointer;
}
```

- [ ] **Step 3: Failing Kanban test**

```tsx
// apps/crm/src/pages/entregas/views/__tests__/KanbanPostEntities.test.tsx
import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

const store = vi.hoisted(() => ({
  completeEtapa: vi.fn(), completeEtapaWithRearm: vi.fn(), hasLaterApprovalEtapa: vi.fn(),
  approvePostsInternally: vi.fn(), sendPostsToCliente: vi.fn(), revertEtapa: vi.fn(),
  updateWorkflowPositions: vi.fn(), getDeadlineInfo: vi.fn(), addWorkflow: vi.fn(),
  addWorkflowEtapa: vi.fn(), addWorkflowTemplate: vi.fn(), removeWorkflowTemplate: vi.fn(),
  removeWorkflow: vi.fn(), updateWorkflow: vi.fn(), updateWorkflowEtapa: vi.fn(),
  updateWorkflowTemplate: vi.fn(), propagateTemplateToWorkflows: vi.fn(),
  getPropertyDefinitions: vi.fn(), deletePropertyDefinition: vi.fn(), getWorkflows: vi.fn(),
  getClientes: vi.fn(), getMembros: vi.fn(), getWorkflowTemplates: vi.fn(),
  getWorkflowEtapas: vi.fn(), getWorkflowPostsCounts: vi.fn(),
  getWorkflowApprovedPostsCounts: vi.fn(), getWorkflowClearedClientePostsCounts: vi.fn(),
  getWorkflowRevisaoInternaCounts: vi.fn(), getWorkflowAwaitingClientePostsCounts: vi.fn(),
  getWorkflowPostResponsaveis: vi.fn(), getWorkspaceSlug: vi.fn(),
}));
vi.mock('../../../../store', () => store);
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));
vi.mock('../../components/PropertyDefinitionPanel', () => ({
  PropertyDefinitionPanel: () => <div>PropertyDefinitionPanel</div>,
}));
vi.mock('../../components/WorkflowCard', () => ({
  WorkflowCard: ({ card, dragHandle }: { card: { workflow: { titulo: string } }; dragHandle?: React.ReactNode }) => (
    <div data-testid="workflow-card">
      {card.workflow.titulo}
      {dragHandle && <span data-testid="drag-handle" />}
    </div>
  ),
}));
vi.mock('../../components/PostProcessCard', () => ({
  PostProcessCard: ({ entity, onClick }: { entity: { titulo: string }; onClick?: () => void }) => (
    <div data-testid="post-process-card" onClick={onClick}>{entity.titulo}</div>
  ),
}));

import { KanbanView } from '../KanbanView';
import type { BoardCard } from '../../hooks/useEntregasData';
import type { PostEntity } from '../../boardEntity';

const ETAPAS = [
  { id: 1, ordem: 0, nome: 'Copy', tipo: 'padrao' as const },
  { id: 2, ordem: 1, nome: 'Design', tipo: 'padrao' as const },
].map((e) => ({ ...e, workflow_id: 1, prazo_dias: 1, tipo_prazo: 'corridos' as const, status: 'pendente' as const }));

const card = {
  workflow: { id: 1, cliente_id: 1, titulo: 'Fluxo A', status: 'ativo', etapa_atual: 1, recorrente: false, template_id: 7, position: 0 },
  etapa: { ...ETAPAS[1], status: 'ativo' },
  cliente: undefined, membro: undefined,
  deadline: { diasRestantes: 2, horasRestantes: 0, estourado: false, urgente: false },
  totalEtapas: 2, etapaIdx: 1, allEtapas: ETAPAS,
} as unknown as BoardCard;

function postEntity(id: number, ordem: number, titulo: string): PostEntity {
  const steps = ETAPAS.map((e) => ({ ordem: e.ordem, nome: e.nome, tipo: e.tipo }));
  return {
    kind: 'post', id: `post:${id}`,
    process: { id, post_id: 100 + id, template_id: 7 } as never,
    step: { ordem } as never,
    templateId: 7, steps, etapaOrdem: ordem, etapaNome: steps[ordem].nome,
    responsavel: undefined, prazoEfetivo: null, posicao: 0,
    deadline: { diasRestantes: 0, horasRestantes: 0, estourado: false, urgente: false },
    cliente: undefined, titulo,
  };
}

function renderBoard(posts: PostEntity[], onPostClick = vi.fn()) {
  render(
    <KanbanView
      cards={[card]}
      postEntities={posts}
      postProcessesEnabled
      onPostClick={onPostClick}
      onCardClick={() => {}}
      onEditClick={() => {}}
      onPostsClick={() => {}}
      onRefresh={() => {}}
      onRecurring={() => {}}
      membros={[]}
      templates={[{ id: 7, nome: 'Redes', etapas: [] } as never]}
      postsCounts={new Map()}
      approvedPostsCounts={new Map()}
      clearedClienteCounts={new Map()}
      revisaoInternaCounts={new Map()}
      awaitingClienteCounts={new Map()}
    />,
  );
  return onPostClick;
}

describe('KanbanView com posts individuais', () => {
  it('renderiza o post na coluna da própria etapa, sem alça, e divide a contagem por tipo', () => {
    renderBoard([postEntity(9, 1, 'Post Individual A'), postEntity(10, 0, 'Post Individual B')]);
    expect(screen.getByText('Fluxo A')).toBeInTheDocument();
    expect(screen.getAllByTestId('post-process-card')).toHaveLength(2);
    expect(screen.getByText('1 fluxo · 1 post')).toBeInTheDocument(); // coluna Design
    expect(screen.getByText('1')).toBeInTheDocument(); // coluna Copy: só posts
    expect(screen.getAllByTestId('drag-handle')).toHaveLength(1); // só o fluxo
  });

  it('clicar no card do post chama onPostClick com a entidade', () => {
    const onPostClick = renderBoard([postEntity(9, 1, 'Post Individual A')]);
    fireEvent.click(screen.getByText('Post Individual A'));
    expect(onPostClick).toHaveBeenCalledWith(expect.objectContaining({ id: 'post:9' }));
  });

  it('uma coluna só com posts não mostra "Nenhuma entrega"; um quadro só com posts não mostra o vazio', () => {
    render(
      <KanbanView
        cards={[]}
        postEntities={[postEntity(9, 1, 'Só post')]}
        postProcessesEnabled
        onCardClick={() => {}} onEditClick={() => {}} onPostsClick={() => {}} onRefresh={() => {}} onRecurring={() => {}}
        membros={[]} templates={[]} postsCounts={new Map()} approvedPostsCounts={new Map()}
        clearedClienteCounts={new Map()} revisaoInternaCounts={new Map()} awaitingClienteCounts={new Map()}
      />,
    );
    expect(screen.getByText('Só post')).toBeInTheDocument();
    expect(screen.queryByText(/Nenhum fluxo ou post individual encontrado/)).toBeNull();
  });
});
```

Run: `npx vitest run apps/crm/src/pages/entregas/views/__tests__/KanbanPostEntities.test.tsx` → FAIL (unknown props, posts not rendered).

- [ ] **Step 4: Implement in `KanbanView.tsx`**

Imports: add `import { PostProcessCard } from '../components/PostProcessCard';` and change the `../boardEntity` import to `import { toWorkflowEntities, sortEntitiesByPrazo, sortEntitiesByPosicao, type BoardEntity, type PostEntity } from '../boardEntity';`.

Props (`KanbanViewBaseProps`): add

```ts
  /** Processos individuais ativos, já filtrados pela página (fase 3: só
   *  leitura; sem drag, sem botões). Ausente = quadro só de fluxos. */
  postEntities?: PostEntity[];
  /** features?.feature_post_processes === true. Liga a chave de linha por
   *  assinatura (spec §4.1) e a cópia do estado vazio. */
  postProcessesEnabled?: boolean;
  onPostClick?: (entity: PostEntity) => void;
```

Module constant near `COL_PREFIX`: `const EMPTY_POST_ENTITIES: PostEntity[] = [];`

`rowCardCount`: `return row.columns.reduce((sum, col) => sum + col.cards.length + col.posts.length, 0);`

`fullColumnOrder`: keep Task 5's `signatureRows = false` param.

Destructure the three new props in `KanbanView({ ... })`. After `localAllCards` add:

```ts
  const posts = postEntities ?? EMPTY_POST_ENTITIES;
  const signatureRows = postProcessesEnabled === true;
  // A lista mista que o agrupador recebe: fluxos com overlays otimistas + posts
  // (que nunca têm overlay: fase 3 não os move).
  const localEntities: BoardEntity[] = useMemo(
    () => (posts.length === 0 ? toWorkflowEntities(localCards) : [...toWorkflowEntities(localCards), ...posts]),
    [localCards, posts],
  );
  const boardRows = buildBoardRows(localEntities, templates, { signatureRows });
```

(and delete the Task 5 line `const boardRows = buildBoardRows(toWorkflowEntities(localCards), templates);`). In `handleDragOver` and `handleDragEnd` replace `buildBoardRows(toWorkflowEntities(localCards), templates)` with `buildBoardRows(localEntities, templates, { signatureRows })` and add `localEntities, signatureRows` to both dependency arrays. In the two `fullColumnOrder(...)` calls pass `signatureRows` as the 7th argument.

Empty gate (line 761): `if (localCards.length === 0 && posts.length === 0) {` and the copy inside becomes:

```tsx
          {postProcessesEnabled
            ? 'Nenhum fluxo ou post individual encontrado. Ajuste os filtros ou crie um novo fluxo.'
            : 'Nenhuma entrega encontrada. Ajuste os filtros ou crie um novo fluxo.'}
```

Add a sortable wrapper next to `SortableCard`:

```tsx
// Post individual na coluna: registrado no SortableContext com o draggable
// desligado e o droppable ligado. Nunca arrastável nesta fase (sem
// `attributes`/`listeners` de propósito), mas o dnd-kit mede o retângulo dele
// e um fluxo solto sobre o card resolve a coluna via findCardColumn.
// `disabled: true` desligaria o droppable também (Disabled = { draggable?,
// droppable? } em @dnd-kit/sortable) e over.id nunca seria um id de post.
function SortablePostCard({ entity, onClick }: { entity: PostEntity; onClick?: () => void }) {
  const { setNodeRef, transform, transition } = useSortable({
    id: entity.id,
    disabled: { draggable: true, droppable: false },
  });
  return (
    <div ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition }}>
      <PostProcessCard entity={entity} onClick={onClick} />
    </div>
  );
}
```

In `renderRowBoard`, after `const sortMode = sortModeFor(colKeyStr);` add:

```tsx
        const stepPosts = column.posts;
        // Ordem exibida da coluna mista (spec §4.2): prazo por uma única função,
        // manual por posicao/board_position. Sem posts a lista é exatamente
        // stepCards, na mesma ordem de hoje.
        const mixed: BoardEntity[] =
          stepPosts.length === 0
            ? toWorkflowEntities(stepCards)
            : sortMode === 'prazo'
              ? sortEntitiesByPrazo([...toWorkflowEntities(stepCards), ...stepPosts])
              : sortEntitiesByPosicao([...toWorkflowEntities(stepCards), ...stepPosts]);
        const countLabel =
          stepCards.length > 0 && stepPosts.length > 0
            ? `${stepCards.length} ${stepCards.length === 1 ? 'fluxo' : 'fluxos'} · ${stepPosts.length} ${stepPosts.length === 1 ? 'post' : 'posts'}`
            : String(stepCards.length + stepPosts.length);
```

Replace `{stepCards.length}` in the `board-column-count` span with `{countLabel}`. Replace the `SortableContext` block with:

```tsx
              <SortableContext
                items={mixed.map((e) => (e.kind === 'workflow' ? String(e.card.workflow.id) : e.id))}
                strategy={verticalListSortingStrategy}
              >
                {mixed.length === 0 && colKeyStr !== dropSlot?.colKey ? (
                  <div className="board-empty">Nenhuma entrega</div>
                ) : (
                  mixed.map((entity) => {
                    if (entity.kind === 'post') {
                      return (
                        <SortablePostCard
                          key={entity.id}
                          entity={entity}
                          onClick={onPostClick ? () => onPostClick(entity) : undefined}
                        />
                      );
                    }
                    const card = entity.card;
                    const cardIdx = stepCards.indexOf(card);
                    return (
                      <Fragment key={card.workflow.id}>
                        {colKeyStr === dropSlot?.colKey && dropSlot.index === cardIdx && (
                          <div
                            className="board-drop-slot"
                            style={{ height: dragHeight }}
                            aria-hidden="true"
                          />
                        )}
                        <SortableCard
                          card={card}
                          onCardClick={onCardClick}
                          onEditClick={onEditClick}
                          onPostsClick={onPostsClick}
                          membros={membros}
                          onRefresh={onRefresh}
                          onRevertClick={() =>
                            setRevertTarget({ workflowId: card.workflow.id!, title: card.workflow.titulo })
                          }
                          onForwardClick={() => handleForwardCard(card)}
                          postsCount={postsCounts.get(card.workflow.id!) ?? 0}
                          approvedPostsCount={approvedPostsCounts.get(card.workflow.id!) ?? 0}
                          clearedClienteCount={clearedClienteCounts.get(card.workflow.id!) ?? 0}
                          revisaoInternaCount={revisaoInternaCounts.get(card.workflow.id!) ?? 0}
                          awaitingClienteCount={awaitingClienteCounts.get(card.workflow.id!) ?? 0}
                        />
                      </Fragment>
                    );
                  })
                )}
                {colKeyStr === dropSlot?.colKey && dropSlot.index >= stepCards.length && (
                  <div className="board-drop-slot" style={{ height: dragHeight }} aria-hidden="true" />
                )}
              </SortableContext>
```

`dropSlot.index` keeps being an index over `stepCards` (workflow cards only): `handleDragOver` computes it from `displayCards(...)`, and a hover over a post card resolves its column via `findCardColumn` but its `findIndex` on the workflow list is `-1`, so the slot falls to the end of the column. Within-column `handleDragEnd` over a post card returns early (`newIdx === -1`), a deliberate no-op in fase 3. The `DragOverlay` and every `updateWorkflowPositions` call are untouched.

- [ ] **Step 5: Wire `EntregasPage.tsx`**

Imports: `import { matchesPostEntityFilters } from './entityFilters';` and `import type { PostEntity } from './boardEntity';`. Module constants after `VIEW_TABS`: `const EMPTY_POST_ENTITIES: PostEntity[] = []; const EMPTY_CARDS: BoardCard[] = [];`.

`etapaNames` (line 441): add `for (const e of postEntities) names.add(e.etapaNome);` and `postEntities` to its deps.

After `filteredCards` (line ~700) add:

```ts
  // Posts individuais passam pelos MESMOS filtros do modo Fluxos (entityFilters
  // espelha a cadeia acima campo a campo). O filtro de entidade só decide o
  // que o Kanban e a Lista recebem; Calendário e Gráfico seguem lendo
  // filteredCards (spec §4.1: "não afeta ... o gráfico").
  const filteredPostEntities = useMemo(
    () =>
      postEntities.length === 0
        ? EMPTY_POST_ENTITIES
        : postEntities.filter((e) => matchesPostEntityFilters(e, filters)),
    [postEntities, filters],
  );
  const visibleCards = effectiveEntidade === 'posts' ? EMPTY_CARDS : filteredCards;
  const visiblePostEntities =
    effectiveEntidade === 'fluxos' ? EMPTY_POST_ENTITIES : filteredPostEntities;
```

Next to `handleCardClick` add:

```ts
  // Card de post individual: abre o drawer do post (StandalonePostDrawer), que
  // mostra a seção de produção. Mesmo slot exclusivo dos demais drawers.
  const handlePostEntityClick = (entity: PostEntity) => {
    setDrawerCard(null);
    setDrawerInitialPostId(null);
    setStandalonePostId(entity.process.post_id);
  };
```

`<KanbanView>`: `cards={visibleCards}`, keep `allCards={cards}`, add `postEntities={visiblePostEntities}`, `postProcessesEnabled={postProcessesEnabled}`, `onPostClick={handlePostEntityClick}`.

- [ ] **Step 6: Run everything for the board, typecheck, lint, commit**

Run: `npx vitest run apps/crm/src/pages/entregas && npx tsc -p apps/crm/tsconfig.json --noEmit && npm run lint`
Expected: PASS (all previous Kanban tests untouched: without `postEntities` the column list is `toWorkflowEntities(stepCards)` in today's order).

```bash
npx prettier --write apps/crm/src/pages/entregas/components/PostProcessCard.tsx apps/crm/src/pages/entregas/entityFilters.ts apps/crm/src/pages/entregas/views/KanbanView.tsx apps/crm/src/pages/entregas/EntregasPage.tsx apps/crm/style.css apps/crm/src/pages/entregas/__tests__/entityFilters.test.ts apps/crm/src/pages/entregas/views/__tests__/KanbanPostEntities.test.tsx
git add apps/crm/src/pages/entregas apps/crm/style.css
git commit -m "feat(entregas): cards de posts individuais no Kanban de Fluxos (leitura)"
```

---

### Task 9: ListView — post rows

**Files:**
- Modify: `apps/crm/src/pages/entregas/views/ListView.tsx` (whole file)
- Modify: `apps/crm/src/pages/entregas/EntregasPage.tsx:943-948` (`<ListView>`)
- Test: `apps/crm/src/pages/entregas/views/__tests__/ListView.test.tsx` (append)

**Interfaces:**
- Consumes: `PostEntity` (Task 4); `visiblePostEntities`, `handlePostEntityClick` (Task 8).
- Produces: `ListViewProps` gains `postEntities?: PostEntity[]; onPostClick?: (entity: PostEntity) => void;`. Rows are built from a local projection `ListRow { key; titulo; clienteNome; clienteCor; etapaNome; responsavelNome; deadline; individual: boolean; open: () => void }`; sorting and badges read the projection, so workflow-only output is identical.

- [ ] **Step 1: Append failing tests**

```tsx
// append to ListView.test.tsx
import type { PostEntity } from '../../boardEntity';

function makePostEntity(titulo: string, dias: number): PostEntity {
  return {
    kind: 'post', id: 'post:9',
    process: { id: 9, post_id: 90 } as never, step: {} as never,
    templateId: null, steps: [], etapaOrdem: 0, etapaNome: 'Copy',
    responsavel: { id: 2, nome: 'Bia' } as never, prazoEfetivo: null, posicao: 0,
    deadline: { diasRestantes: dias, horasRestantes: 0, estourado: false, urgente: false },
    cliente: { id: 1, nome: 'Aurora', cor: '#0f766e' } as never, titulo,
  };
}

describe('ListView com posts individuais', () => {
  it('lista o post com a tag Individual, etapa e responsável da etapa, e abre pelo onPostClick', () => {
    const onPostClick = vi.fn();
    render(
      <ListView
        cards={[makeCard() as never]}
        postEntities={[makePostEntity('Post Z', 1)]}
        sort={{ column: 'titulo', direction: 'asc' }}
        onSortChange={vi.fn()}
        onCardClick={vi.fn()}
        onPostClick={onPostClick}
      />,
    );
    expect(screen.getByText('Individual')).toBeInTheDocument();
    expect(screen.getByText('Bia')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Post Z'));
    expect(onPostClick).toHaveBeenCalledWith(expect.objectContaining({ id: 'post:9' }));
  });

  it('ordena fluxos e posts juntos por prazo', () => {
    render(
      <ListView
        cards={[makeCard() as never]} // 3d restantes
        postEntities={[makePostEntity('Post Z', 1)]}
        sort={{ column: 'prazo', direction: 'asc' }}
        onSortChange={vi.fn()}
        onCardClick={vi.fn()}
      />,
    );
    const rows = screen.getAllByRole('row').slice(1);
    expect(rows[0]).toHaveTextContent('Post Z');
    expect(rows[1]).toHaveTextContent('Fluxo Base');
  });

  it('sem cards mas com posts não mostra o estado vazio', () => {
    render(
      <ListView cards={[]} postEntities={[makePostEntity('Post Z', 1)]} sort={{ column: 'titulo', direction: 'asc' }} onSortChange={vi.fn()} onCardClick={vi.fn()} />,
    );
    expect(screen.queryByText('Nenhuma entrega encontrada. Ajuste os filtros.')).toBeNull();
  });
});
```

Run: `npx vitest run apps/crm/src/pages/entregas/views/__tests__/ListView.test.tsx` → FAIL.

- [ ] **Step 2: Rewrite `ListView.tsx`**

```tsx
import { ChevronUp, ChevronDown, FileText } from 'lucide-react';
import type { BoardCard } from '../hooks/useEntregasData';
import type { PostEntity } from '../boardEntity';
import { DEADLINE_STATUS, classifyDeadline } from '../deadlineStatus';

interface ListViewProps {
  cards: BoardCard[];
  /** Processos individuais (spec §4.4: mesmos tipos e filtro de entidade do Kanban). */
  postEntities?: PostEntity[];
  sort: { column: string; direction: 'asc' | 'desc' };
  onSortChange: (sort: { column: string; direction: 'asc' | 'desc' }) => void;
  onCardClick: (card: BoardCard) => void;
  onPostClick?: (entity: PostEntity) => void;
}

type Column = { key: string; label: string };
const COLUMNS: Column[] = [
  { key: 'titulo', label: 'Título' },
  { key: 'cliente', label: 'Cliente' },
  { key: 'etapa', label: 'Etapa atual' },
  { key: 'responsavel', label: 'Responsável' },
  { key: 'prazo', label: 'Prazo' },
  { key: 'status', label: 'Status' },
];

/** Projeção comum de fluxo e post para a tabela: etapa, responsável e prazo
 *  resolvidos pela entidade. */
interface ListRow {
  key: string;
  titulo: string;
  clienteNome: string;
  clienteCor: string | undefined;
  etapaNome: string;
  responsavelNome: string;
  deadline: BoardCard['deadline'];
  individual: boolean;
  open: () => void;
}

const EMPTY_POST_ENTITIES: PostEntity[] = [];

/** Same three buckets the board, the Visão geral and the filters use. */
function getStatusBadge(row: ListRow) {
  const { label, cssVar } = DEADLINE_STATUS[classifyDeadline(row.deadline)];
  return { label, color: `var(${cssVar})` };
}

function sortRows(rows: ListRow[], column: string, direction: 'asc' | 'desc'): ListRow[] {
  const dir = direction === 'asc' ? 1 : -1;
  return [...rows].sort((a, b) => {
    switch (column) {
      case 'titulo':
        return dir * a.titulo.localeCompare(b.titulo);
      case 'cliente':
        return dir * a.clienteNome.localeCompare(b.clienteNome);
      case 'etapa':
        return dir * a.etapaNome.localeCompare(b.etapaNome);
      case 'responsavel':
        return dir * a.responsavelNome.localeCompare(b.responsavelNome);
      case 'prazo':
        return dir * (a.deadline.diasRestantes - b.deadline.diasRestantes);
      case 'status': {
        const order = (r: ListRow) => (r.deadline.estourado ? 0 : r.deadline.urgente ? 1 : 2);
        return dir * (order(a) - order(b));
      }
      default:
        return 0;
    }
  });
}

function formatPrazo(row: ListRow): string {
  const d = row.deadline;
  if (d.estourado) return `${Math.abs(d.diasRestantes)}d atrasado`;
  if (d.diasRestantes === 0) return `${d.horasRestantes}h restantes`;
  return `${d.diasRestantes}d restantes`;
}

export function ListView({
  cards,
  postEntities = EMPTY_POST_ENTITIES,
  sort,
  onSortChange,
  onCardClick,
  onPostClick,
}: ListViewProps) {
  if (cards.length === 0 && postEntities.length === 0) {
    return (
      <div
        className="card animate-up"
        style={{ textAlign: 'center', padding: '3rem', color: 'var(--text-muted)' }}
      >
        <p>Nenhuma entrega encontrada. Ajuste os filtros.</p>
      </div>
    );
  }

  const rows: ListRow[] = [
    ...cards.map<ListRow>((card) => ({
      key: `wf-${card.workflow.id}`,
      titulo: card.workflow.titulo,
      clienteNome: card.cliente?.nome || '',
      clienteCor: card.cliente?.cor,
      etapaNome: card.etapa.nome,
      responsavelNome: card.membro?.nome || '',
      deadline: card.deadline,
      individual: false,
      open: () => onCardClick(card),
    })),
    ...postEntities.map<ListRow>((e) => ({
      key: e.id,
      titulo: e.titulo,
      clienteNome: e.cliente?.nome || e.process.post.cliente_nome || '',
      clienteCor: e.cliente?.cor,
      etapaNome: e.etapaNome,
      responsavelNome: e.responsavel?.nome || '',
      deadline: e.deadline,
      individual: true,
      open: () => onPostClick?.(e),
    })),
  ];
  const sorted = sortRows(rows, sort.column, sort.direction);

  const handleSort = (key: string) => {
    if (sort.column === key) {
      onSortChange({ column: key, direction: sort.direction === 'asc' ? 'desc' : 'asc' });
    } else {
      onSortChange({ column: key, direction: 'asc' });
    }
  };

  return (
    <div className="animate-up card" style={{ overflow: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.875rem' }}>
        <thead>
          <tr>
            {COLUMNS.map((col) => (
              <th
                key={col.key}
                onClick={() => handleSort(col.key)}
                style={{
                  padding: '0.75rem 1rem',
                  textAlign: 'left',
                  cursor: 'pointer',
                  userSelect: 'none',
                  whiteSpace: 'nowrap',
                  borderBottom: '1px solid var(--border-color)',
                  color: sort.column === col.key ? 'var(--accent)' : 'var(--text-secondary)',
                  fontWeight: 600,
                }}
              >
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.25rem' }}>
                  {col.label}
                  {sort.column === col.key ? (
                    sort.direction === 'asc' ? (
                      <ChevronUp className="h-3 w-3" />
                    ) : (
                      <ChevronDown className="h-3 w-3" />
                    )
                  ) : null}
                </span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sorted.map((row) => {
            const badge = getStatusBadge(row);
            return (
              <tr
                key={row.key}
                onClick={row.open}
                style={{ cursor: 'pointer', borderBottom: '1px solid var(--border-color)' }}
                onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--surface-2)')}
                onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
              >
                <td style={{ padding: '0.75rem 1rem' }}>
                  {row.titulo}
                  {row.individual && (
                    <span
                      className="post-fluxo-tag post-fluxo-tag--avulso post-fluxo-tag--individual"
                      style={{ marginLeft: '0.5rem' }}
                    >
                      <FileText size={11} aria-hidden="true" style={{ flexShrink: 0 }} />
                      Individual
                    </span>
                  )}
                </td>
                <td style={{ padding: '0.75rem 1rem' }}>
                  <span
                    style={{ borderLeft: `3px solid ${row.clienteCor || '#888'}`, paddingLeft: '0.5rem' }}
                  >
                    {row.clienteNome || '—'}
                  </span>
                </td>
                <td style={{ padding: '0.75rem 1rem' }}>{row.etapaNome}</td>
                <td style={{ padding: '0.75rem 1rem' }}>{row.responsavelNome || '—'}</td>
                <td style={{ padding: '0.75rem 1rem' }}>{formatPrazo(row)}</td>
                <td style={{ padding: '0.75rem 1rem' }}>
                  <span
                    style={{
                      padding: '0.2rem 0.6rem',
                      borderRadius: 12,
                      background: `color-mix(in srgb, ${badge.color} 13%, transparent)`,
                      color: badge.color,
                      fontSize: '0.75rem',
                      fontWeight: 600,
                    }}
                  >
                    {badge.label}
                  </span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
```

- [ ] **Step 3: Wire `EntregasPage.tsx`**

`<ListView cards={visibleCards} postEntities={visiblePostEntities} onPostClick={handlePostEntityClick} sort={listSort} onSortChange={setListSort} onCardClick={handleCardClick} />`.

- [ ] **Step 4: Run, typecheck, lint, commit**

Run: `npx vitest run apps/crm/src/pages/entregas/views/__tests__/ListView.test.tsx apps/crm/src/pages/entregas/__tests__/EntregasPage.test.tsx && npx tsc -p apps/crm/tsconfig.json --noEmit && npm run lint`

```bash
npx prettier --write apps/crm/src/pages/entregas/views/ListView.tsx apps/crm/src/pages/entregas/views/__tests__/ListView.test.tsx apps/crm/src/pages/entregas/EntregasPage.tsx
git add apps/crm/src/pages/entregas/views/ListView.tsx apps/crm/src/pages/entregas/views/__tests__/ListView.test.tsx apps/crm/src/pages/entregas/EntregasPage.tsx
git commit -m "feat(entregas): posts individuais na Lista de Fluxos"
```

---

### Task 10: "Sem processo" section

**Files:**
- Create: `apps/crm/src/pages/entregas/semProcesso.ts`
- Create: `apps/crm/src/pages/entregas/components/SemProcessoSection.tsx`
- Modify: `apps/crm/src/pages/entregas/EntregasPage.tsx:543-548` (`postsMode` / `useActivePosts`), `:906` (after `<KanbanView ... />`)
- Modify: `apps/crm/style.css` (append)
- Test: `apps/crm/src/pages/entregas/__tests__/semProcesso.test.ts`, `apps/crm/src/pages/entregas/components/__tests__/SemProcessoSection.test.tsx`

**Interfaces:**
- Consumes: `ActivePost`, `useActivePosts`, `processByPostId` (Task 6), `effectiveEntidade` (Task 7), `handlePostClick` (existing), `PostStatusChip`, `TIPO_LABELS`.
- Produces:
  - `SEM_PROCESSO_LIMIT = 12`
  - `selectSemProcessoPosts(posts: ActivePost[], hasProcess: (postId: number) => boolean, filters: Pick<FilterState, 'filterSearch' | 'filterClientes' | 'filterPostResponsaveis'>): ActivePost[]` — `workflow_id == null`, no vigente process, search + cliente + responsável do post applied, sorted by `id` desc (spec §4.3: the query exposes no `created_at`)
  - `productionFiltersActive(filters: FilterState): boolean` — membros, etapas, templates, status, prazo, prazoFrom/To
  - `SemProcessoSection({ posts, total, productionFiltersActive, onPostClick, onVerTodos })`

- [ ] **Step 1: Pure helper + failing test**

```ts
// apps/crm/src/pages/entregas/__tests__/semProcesso.test.ts
import { describe, expect, it, vi } from 'vitest';
vi.mock('../../../lib/supabase');
import { EMPTY_FILTERS } from '../components/EntregasFilters';
import { productionFiltersActive, selectSemProcessoPosts, SEM_PROCESSO_LIMIT } from '../semProcesso';
import type { ActivePost } from '../../../store';

function post(id: number, over: Partial<ActivePost> = {}): ActivePost {
  return { id, workflow_id: null, cliente_id: 1, cliente_nome: 'A', workflow_titulo: null, titulo: `Post ${id}`, tipo: 'feed', status: 'rascunho', custom_status_id: null, scheduled_at: null, published_at: null, ig_caption: null, instagram_permalink: null, publish_error: null, publish_error_code: null, ordem: 0, responsavel_id: null, platform: 'instagram', tiktok_publish_status: null, tiktok_publish_error: null, tiktok_post_url: null, instagram_media_id: null, ig_trial_strategy: null, board_ordem: null, ...over };
}

describe('selectSemProcessoPosts', () => {
  it('só avulsos sem processo vigente, mais recentes primeiro por id', () => {
    const out = selectSemProcessoPosts(
      [post(1), post(2, { workflow_id: 9 }), post(3), post(4)],
      (id) => id === 3,
      EMPTY_FILTERS,
    );
    expect(out.map((p) => p.id)).toEqual([4, 1]);
  });
  it('aplica busca, cliente e responsável do post; ignora os filtros de produção', () => {
    const posts = [post(1, { titulo: 'Reels' }), post(2, { titulo: 'Feed', cliente_id: 2, responsavel_id: 5 })];
    expect(selectSemProcessoPosts(posts, () => false, { ...EMPTY_FILTERS, filterSearch: 'reels' }).map((p) => p.id)).toEqual([1]);
    expect(selectSemProcessoPosts(posts, () => false, { ...EMPTY_FILTERS, filterClientes: [2] }).map((p) => p.id)).toEqual([2]);
    expect(selectSemProcessoPosts(posts, () => false, { ...EMPTY_FILTERS, filterPostResponsaveis: [5] }).map((p) => p.id)).toEqual([2]);
    expect(selectSemProcessoPosts(posts, () => false, { ...EMPTY_FILTERS, filterEtapas: ['Copy'] })).toHaveLength(2);
  });
  it('productionFiltersActive só olha os filtros de etapa/template/responsável da etapa/status/prazo', () => {
    expect(productionFiltersActive(EMPTY_FILTERS)).toBe(false);
    expect(productionFiltersActive({ ...EMPTY_FILTERS, filterSearch: 'x', filterClientes: [1] })).toBe(false);
    expect(productionFiltersActive({ ...EMPTY_FILTERS, filterEtapas: ['Copy'] })).toBe(true);
    expect(productionFiltersActive({ ...EMPTY_FILTERS, filterPrazoTo: '2026-01-01' })).toBe(true);
    expect(SEM_PROCESSO_LIMIT).toBe(12);
  });
});
```

```ts
// apps/crm/src/pages/entregas/semProcesso.ts
import type { ActivePost } from '../../store';
import type { FilterState } from './components/EntregasFilters';

/** Spec §4.3: no máximo 12 cards; paginação fica fora da v1. */
export const SEM_PROCESSO_LIMIT = 12;

/**
 * Avulsos sem execução vigente (nem ativa nem concluída), a partir do cache
 * ['active-posts'] de Publicações. Aplica os filtros que existem na barra do
 * modo Fluxos e falam de post (busca, cliente, responsável do post); os
 * filtros de produção não se aplicam e a seção avisa em vez de esconder.
 * Ordem: id desc (a consulta não expõe created_at/updated_at; o id é serial).
 */
export function selectSemProcessoPosts(
  posts: ActivePost[],
  hasProcess: (postId: number) => boolean,
  filters: Pick<FilterState, 'filterSearch' | 'filterClientes' | 'filterPostResponsaveis'>,
): ActivePost[] {
  let ps = posts.filter((p) => p.workflow_id == null && !hasProcess(p.id));
  if (filters.filterSearch) {
    const q = filters.filterSearch.toLowerCase();
    ps = ps.filter((p) => p.titulo.toLowerCase().includes(q));
  }
  if (filters.filterClientes.length)
    ps = ps.filter((p) => p.cliente_id != null && filters.filterClientes.includes(p.cliente_id));
  if (filters.filterPostResponsaveis.length)
    ps = ps.filter(
      (p) => p.responsavel_id != null && filters.filterPostResponsaveis.includes(p.responsavel_id),
    );
  return [...ps].sort((a, b) => b.id - a.id);
}

/** Filtros de etapa, template, responsável da etapa, status de prazo e prazo:
 *  não se aplicam à seção; quando algum está ativo ela mostra o aviso. */
export function productionFiltersActive(filters: FilterState): boolean {
  return (
    filters.filterMembros.length > 0 ||
    filters.filterEtapas.length > 0 ||
    filters.filterTemplates.length > 0 ||
    filters.filterStatus.length > 0 ||
    filters.filterPrazo.length > 0 ||
    !!filters.filterPrazoFrom ||
    !!filters.filterPrazoTo
  );
}
```

Run: `npx vitest run apps/crm/src/pages/entregas/__tests__/semProcesso.test.ts` → PASS.

- [ ] **Step 2: Component + failing test**

```tsx
// apps/crm/src/pages/entregas/components/__tests__/SemProcessoSection.test.tsx
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
vi.mock('@/lib/supabase');
vi.mock('@/hooks/useStatusRegistry', () => ({
  useStatusRegistry: () => ({
    resolve: (p: { status: string }) => ({ key: p.status, kind: 'canonical', canonical: p.status, label: p.status }),
    options: [],
  }),
}));
vi.mock('../PostStatusChip', () => ({ PostStatusChip: ({ post }: { post: { status: string } }) => <span>{post.status}</span> }));
import { SemProcessoSection } from '../SemProcessoSection';
import type { ActivePost } from '../../../../store';

const post = (id: number): ActivePost =>
  ({ id, workflow_id: null, cliente_id: 1, cliente_nome: 'Aurora', titulo: `Post ${id}`, tipo: 'feed', status: 'rascunho', platform: 'instagram' }) as never;

describe('SemProcessoSection', () => {
  it('lista os posts, mostra o total e o link para Publicações; clique abre o post', () => {
    const onPostClick = vi.fn();
    const onVerTodos = vi.fn();
    render(<SemProcessoSection posts={[post(1), post(2)]} total={15} productionFiltersActive={false} onPostClick={onPostClick} onVerTodos={onVerTodos} />);
    expect(screen.getByRole('heading', { name: 'Sem processo' })).toBeInTheDocument();
    expect(screen.getByText('15')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Post 2'));
    expect(onPostClick).toHaveBeenCalledWith(expect.objectContaining({ id: 2 }));
    fireEvent.click(screen.getByRole('button', { name: 'Ver todos em Publicações' }));
    expect(onVerTodos).toHaveBeenCalled();
    expect(screen.queryByText(/Filtros de produção/)).toBeNull();
  });
  it('mostra o aviso de filtros de produção em vez de esconder a seção', () => {
    render(<SemProcessoSection posts={[post(1)]} total={1} productionFiltersActive onPostClick={vi.fn()} onVerTodos={vi.fn()} />);
    expect(screen.getByText('Filtros de produção não se aplicam aos posts sem processo')).toBeInTheDocument();
  });
  it('sem nenhum post não renderiza nada', () => {
    const { container } = render(<SemProcessoSection posts={[]} total={0} productionFiltersActive={false} onPostClick={vi.fn()} onVerTodos={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });
});
```

```tsx
// apps/crm/src/pages/entregas/components/SemProcessoSection.tsx
import { CircleDashed } from 'lucide-react';
import type { ActivePost } from '../../../store';
import { useStatusRegistry } from '@/hooks/useStatusRegistry';
import { TIPO_LABELS } from '../postLabels';
import { PostStatusChip } from './PostStatusChip';

interface SemProcessoSectionProps {
  /** Já limitados a SEM_PROCESSO_LIMIT pela página. */
  posts: ActivePost[];
  /** Total antes do limite, para o contador. */
  total: number;
  productionFiltersActive: boolean;
  onPostClick: (post: ActivePost) => void;
  onVerTodos: () => void;
}

/**
 * Seção abaixo das linhas de etapas (spec §4.3): avulsos sem processo vigente.
 * Não posiciona os posts numa coluna pelo status nem inventa prazo ou
 * responsável de etapa. Fase 3: sem a ação "Aplicar processo" (fase 4).
 */
export function SemProcessoSection({
  posts,
  total,
  productionFiltersActive,
  onPostClick,
  onVerTodos,
}: SemProcessoSectionProps) {
  const registry = useStatusRegistry();
  if (total === 0) return null;
  return (
    <section className="sem-processo animate-up" aria-labelledby="sem-processo-title">
      <div className="sem-processo-head">
        <h2 id="sem-processo-title" className="sem-processo-title">
          Sem processo
        </h2>
        <span className="board-column-count">{total}</span>
        <button type="button" className="sem-processo-link" onClick={onVerTodos}>
          Ver todos em Publicações
        </button>
      </div>
      {productionFiltersActive && (
        <p className="sem-processo-note">
          Filtros de produção não se aplicam aos posts sem processo
        </p>
      )}
      <div className="sem-processo-grid">
        {posts.map((post) => (
          <div
            key={post.id}
            className="scheduled-item board-post-card sem-processo-card"
            role="button"
            tabIndex={0}
            onClick={() => onPostClick(post)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') onPostClick(post);
            }}
          >
            <div className="item-top">
              <span className="board-post-tipo">{TIPO_LABELS[post.tipo]}</span>
              <PostStatusChip post={post} registry={registry} />
            </div>
            <div className="item-title">{post.titulo || 'Post sem título'}</div>
            <span className="post-fluxo-tag post-fluxo-tag--avulso">
              <CircleDashed size={11} aria-hidden="true" style={{ flexShrink: 0 }} />
              Avulso
            </span>
            <div className="item-meta" style={{ color: 'var(--text-muted)', fontSize: '0.72rem' }}>
              {post.cliente_nome || '—'}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
```

CSS, appended to `apps/crm/style.css`:

```css
/* Seção "Sem processo" do quadro de Fluxos (spec §4.3) */
.sem-processo {
  margin-top: 1.5rem;
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}
.sem-processo-head {
  display: flex;
  align-items: center;
  gap: 0.6rem;
}
.sem-processo-title {
  font-size: 0.9rem;
  font-weight: 700;
  color: var(--text-main);
  margin: 0;
}
.sem-processo-link {
  margin-left: auto;
  background: none;
  border: none;
  cursor: pointer;
  font-size: 0.78rem;
  color: var(--text-muted);
  text-decoration: underline;
}
.sem-processo-note {
  margin: 0;
  font-size: 0.78rem;
  color: var(--text-muted);
}
.sem-processo-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
  gap: 0.75rem;
}
.sem-processo-card {
  cursor: pointer;
}
```

Run: `npx vitest run apps/crm/src/pages/entregas/components/__tests__/SemProcessoSection.test.tsx` → PASS.

- [ ] **Step 3: Wire `EntregasPage.tsx`**

Imports: `import { SemProcessoSection } from './components/SemProcessoSection';` and `import { selectSemProcessoPosts, productionFiltersActive, SEM_PROCESSO_LIMIT } from './semProcesso';`. Replace lines 543-548 with:

```ts
  // Publicações mode (Kanban/Lista): every post of every active workflow, fetched
  // only while one of those modes is actually visible. The "Sem processo"
  // section of the Fluxos board (spec §4.3) reads the same cache, so it turns
  // the query on too; the 15 s poll stays conditioned on a post being published.
  const postsMode =
    (activeView === 'kanban' && mode === 'publicacoes') ||
    (activeView === 'list' && mode === 'publicacoes');
  const semProcessoMode =
    postProcessesEnabled &&
    activeView === 'kanban' &&
    mode === 'entregas' &&
    effectiveEntidade !== 'fluxos';
  const { posts: activePosts, isLoading: activePostsLoading } = useActivePosts(
    postsMode || semProcessoMode,
  );
  const semProcessoPosts = useMemo(
    () =>
      semProcessoMode
        ? selectSemProcessoPosts(activePosts, (id) => processByPostId.has(id), filters)
        : [],
    [semProcessoMode, activePosts, processByPostId, filters],
  );
```

After the `<KanbanView ... />` element (inside the `mode === 'entregas'` branch, wrap both in a fragment):

```tsx
          <>
            <KanbanView ... />
            {semProcessoMode && (
              <SemProcessoSection
                posts={semProcessoPosts.slice(0, SEM_PROCESSO_LIMIT)}
                total={semProcessoPosts.length}
                productionFiltersActive={productionFiltersActive(filters)}
                onPostClick={handlePostClick}
                onVerTodos={() => setMode('publicacoes')}
              />
            )}
          </>
```

- [ ] **Step 4: Page test**

Append to the `filtro de entidade` describe in `EntregasPage.test.tsx`:

```ts
    it('em Todos, a seção Sem processo lista só avulsos sem processo vigente e liga useActivePosts', async () => {
      limitsMock.features = { feature_post_processes: true };
      mockedUseActivePosts.mockReturnValue({
        posts: [
          { id: 1, workflow_id: null, cliente_id: 1, cliente_nome: 'A', titulo: 'Avulso livre', tipo: 'feed', status: 'rascunho', platform: 'instagram' },
          { id: 2, workflow_id: null, cliente_id: 1, cliente_nome: 'A', titulo: 'Avulso com processo', tipo: 'feed', status: 'rascunho', platform: 'instagram' },
        ],
        isLoading: false,
      } as never);
      mockedUseEntregasData.mockReturnValue({
        clientes: [], membros: [], templates: [], cards: [], activeWorkflows: [wfFixture],
        postEntities: [], processByPostId: new Map([[2, {}]]), concludedPostProcesses: [],
        activePostProcessCount: 0, isLoading: false, refresh: vi.fn(),
      } as never);
      renderPage('/entregas?entidade=todos');
      expect(await screen.findByText('Avulso livre')).toBeInTheDocument();
      expect(screen.queryByText('Avulso com processo')).toBeNull();
      expect(mockedUseActivePosts).toHaveBeenLastCalledWith(true);
    });
```

(`mockedUseActivePosts` already exists in the file, line 518.) `SemProcessoSection` is real in this suite and its `PostStatusChip` reads `useStatusRegistry`, which reaches `getPostStatusDefinitions` -- absent from `storeMocks`, and vitest throws on a missing mock export. Add next to the other top-level mocks of the file:

```ts
vi.mock('@/hooks/useStatusRegistry', () => ({
  useStatusRegistry: () => ({
    resolve: (p: { status: string }) => ({ key: p.status, kind: 'canonical', canonical: p.status, label: p.status }),
    options: [],
  }),
}));
```

- [ ] **Step 5: Run, typecheck, lint, commit**

Run: `npx vitest run apps/crm/src/pages/entregas && npx tsc -p apps/crm/tsconfig.json --noEmit && npm run lint`

```bash
npx prettier --write apps/crm/src/pages/entregas apps/crm/style.css
git add apps/crm/src/pages/entregas apps/crm/style.css
git commit -m "feat(entregas): seção Sem processo no quadro de Fluxos"
```

---

### Task 11: Timeline — `post_process_events` as a third source

**Files:**
- Modify: `apps/crm/src/pages/entregas/components/postTimeline.ts` (whole file)
- Modify: `apps/crm/src/pages/entregas/components/PostTimelinePopover.tsx:56-63`
- Modify: `apps/crm/src/pages/entregas/components/WorkflowDrawer.tsx:65, :285-288, :965, :1179, :1226, :1349`
- Test: `apps/crm/src/pages/entregas/components/__tests__/postTimeline.test.ts` (append); `WorkflowDrawer.test.tsx`, `WorkflowDrawerAutoComplete.test.tsx` (store mock entries)

**Interfaces:**
- Consumes: `PostProcessEvent`, `getPostProcessEvents` (Task 2).
- Produces:
  - `TimelineNode.kind: 'created' | 'status' | 'process'`
  - `buildPostTimeline(post, events, approvals, processEvents: PostProcessEvent[] = []): TimelineNode[]` — 4th parameter, same single sort by `at`
  - `processEventLabel(ev: PostProcessEvent): string`
  - `PostTimelinePopover` gains `processEvents?: PostProcessEvent[]`
  - WorkflowDrawer: flag-gated `useQuery(['post-process-events', postIds.join(',')])`, threaded per post into the popover

- [ ] **Step 1: Append failing tests**

```ts
// append to postTimeline.test.ts
import type { PostProcessEvent } from '../../../../store';
import { processEventLabel } from '../postTimeline';

function pev(partial: Partial<PostProcessEvent>): PostProcessEvent {
  return { id: 1, conta_id: 'c', post_id: 10, process_id: 5, evento: 'aplicado', actor_user_id: null, actor_name: 'Ana', origem: 'workspace_user', antes: null, depois: null, created_at: '2026-06-03T10:00:00Z', ...partial };
}

describe('buildPostTimeline com eventos de processo', () => {
  it('mescla a terceira fonte na mesma ordem temporal, com kind process', () => {
    const nodes = buildPostTimeline(
      post,
      [ev({ id: 1, to_status: 'revisao_interna', created_at: '2026-06-02T10:00:00Z' })],
      [],
      [pev({ id: 7, evento: 'avancou', depois: { etapa_nome: 'Design' }, created_at: '2026-06-02T12:00:00Z' })],
    );
    expect(nodes.map((n) => [n.kind, n.label])).toEqual([
      ['created', 'Criado'],
      ['status', 'Em revisão'],
      ['process', 'Avançou para Design'],
    ]);
    expect(nodes[2]).toMatchObject({ key: 'process-7', actorLabel: 'Ana', tone: 'neutral' });
  });

  it('rotula cada evento a partir do payload; origem system vira Sistema', () => {
    expect(processEventLabel(pev({ evento: 'desmembrado', antes: { workflow_titulo: 'Setembro', etapa_nome: 'Design' } }))).toBe('Desmembrado de Setembro na etapa Design');
    expect(processEventLabel(pev({ evento: 'aplicado', depois: { template_nome: 'Redes' } }))).toBe('Processo aplicado: Redes');
    expect(processEventLabel(pev({ evento: 'voltou', depois: { etapa_nome: 'Copy' } }))).toBe('Voltou para Copy');
    expect(processEventLabel(pev({ evento: 'concluido' }))).toBe('Processo concluído');
    expect(processEventLabel(pev({ evento: 'reaberto' }))).toBe('Processo reaberto');
    expect(processEventLabel(pev({ evento: 'removido' }))).toBe('Processo removido');
    expect(processEventLabel(pev({ evento: 'vinculado' }))).toBe('Vinculado a um fluxo, processo encerrado');
    expect(processEventLabel(pev({ evento: 'etapa_editada', depois: { nome: 'Design' } }))).toBe('Etapa Design editada');
    const sys = buildPostTimeline({ created_at: undefined }, [], [], [pev({ origem: 'system', actor_name: null })]);
    expect(sys[0].actorLabel).toBe('Sistema');
    expect(buildPostTimeline({ created_at: undefined }, [], [], [pev({ evento: 'concluido' })])[0].tone).toBe('approved');
  });
});
```

- [ ] **Step 2: Implement `postTimeline.ts`**

```ts
import type { WorkflowPost, PostApproval, PostStatusEvent, PostProcessEvent } from '../../../store';
import { STATUS_LABELS } from '../postLabels';

export type TimelineTone = 'neutral' | 'approved' | 'correction' | 'published' | 'failed';

export interface TimelineNode {
  key: string;
  kind: 'created' | 'status' | 'process';
  label: string;
  at: string;
  actorLabel: string;
  comment: string | null;
  tone: TimelineTone;
}

const TONE_BY_STATUS: Partial<Record<WorkflowPost['status'], TimelineTone>> = {
  aprovado_interno: 'approved',
  aprovado_cliente: 'approved',
  correcao_cliente: 'correction',
  postado: 'published',
  falha_publicacao: 'failed',
};

function actorLabelFor(ev: PostStatusEvent): string {
  if (ev.source === 'client') return 'Cliente';
  if (ev.source === 'system') return 'Sistema';
  return ev.actor_name ?? '—';
}

const str = (v: unknown, fallback: string): string =>
  typeof v === 'string' && v !== '' ? v : fallback;

/** Rótulo de um evento de processo a partir do payload gravado pelas RPCs da
 *  fase 2 (antes/depois em jsonb; ver post_process_log_event nas migrations
 *  20260919000003-7). Campos ausentes caem em texto genérico, nunca em erro. */
export function processEventLabel(ev: PostProcessEvent): string {
  const antes = ev.antes ?? {};
  const depois = ev.depois ?? {};
  switch (ev.evento) {
    case 'desmembrado':
      return `Desmembrado de ${str(antes.workflow_titulo, 'um fluxo')} na etapa ${str(antes.etapa_nome, 'atual')}`;
    case 'aplicado':
      return `Processo aplicado: ${str(depois.template_nome, 'template')}`;
    case 'avancou':
      return `Avançou para ${str(depois.etapa_nome, 'a próxima etapa')}`;
    case 'voltou':
      return `Voltou para ${str(depois.etapa_nome, 'a etapa anterior')}`;
    case 'concluido':
      return 'Processo concluído';
    case 'reaberto':
      return 'Processo reaberto';
    case 'removido':
      return 'Processo removido';
    case 'vinculado':
      return 'Vinculado a um fluxo, processo encerrado';
    case 'etapa_editada':
      return `Etapa ${str(depois.nome, '')} editada`.replace('  ', ' ');
    default:
      return ev.evento;
  }
}

export function buildPostTimeline(
  post: Pick<WorkflowPost, 'created_at'>,
  events: PostStatusEvent[],
  approvals: PostApproval[],
  processEvents: PostProcessEvent[] = [],
): TimelineNode[] {
  const nodes: TimelineNode[] = [];

  if (post.created_at) {
    nodes.push({
      key: 'created',
      kind: 'created',
      label: 'Criado',
      at: post.created_at,
      actorLabel: '—',
      comment: null,
      tone: 'neutral',
    });
  }

  const approvalById = new Map(approvals.map((a) => [a.id, a]));

  for (const ev of events) {
    const comment =
      ev.post_approval_id != null
        ? (approvalById.get(ev.post_approval_id)?.comentario ?? null)
        : null;
    nodes.push({
      key: `event-${ev.id}`,
      kind: 'status',
      // Custom statuses show the nome snapshotted at event time; the tone
      // still comes from the canonical status underneath.
      label: ev.to_custom_nome ?? STATUS_LABELS[ev.to_status] ?? ev.to_status,
      at: ev.created_at,
      actorLabel: actorLabelFor(ev),
      comment,
      tone: TONE_BY_STATUS[ev.to_status] ?? 'neutral',
    });
  }

  // Terceira fonte (spec §5.4): o histórico do processo individual no mesmo
  // feed em que o usuário já procura. Mesma ordenação por `at`.
  for (const ev of processEvents) {
    nodes.push({
      key: `process-${ev.id}`,
      kind: 'process',
      label: processEventLabel(ev),
      at: ev.created_at,
      actorLabel: ev.origem === 'system' ? 'Sistema' : (ev.actor_name ?? '—'),
      comment: null,
      tone: ev.evento === 'concluido' ? 'approved' : 'neutral',
    });
  }

  return nodes.sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());
}
```

- [ ] **Step 3: Popover + WorkflowDrawer wiring**

`PostTimelinePopover.tsx`: import `type PostProcessEvent` from `'../../../store'`; add `processEvents?: PostProcessEvent[];` to `PostTimelinePopoverProps`; `const nodes = buildPostTimeline(post, events, approvals, processEvents);`.

`WorkflowDrawer.tsx`:
- Import `getPostProcessEvents, type PostProcessEvent` in the `../../../store` import (line 65 area) and `import { useWorkspaceLimits } from '@/hooks/useWorkspaceLimits';`.
- Module constant: `const EMPTY_PROCESS_EVENTS: PostProcessEvent[] = [];`
- After the `statusEvents` query (line 285-288):

```ts
  // Histórico de processo dos posts do fluxo (spec §5.4): um post vinculado
  // depois de ter tido processo carrega os eventos do processo encerrado.
  // Flag-gated: sem feature_post_processes a query não existe.
  const { features } = useWorkspaceLimits();
  const { data: processEvents = EMPTY_PROCESS_EVENTS } = useQuery({
    queryKey: ['post-process-events', postIds.join(',')],
    queryFn: () => getPostProcessEvents(postIds),
    enabled: features?.feature_post_processes === true && postIds.length > 0,
  });
```

- Add `qc.invalidateQueries({ queryKey: ['post-process-events'] });` next to line 344.
- At line 965 pass `processEvents={processEvents.filter((e) => e.post_id === post.id)}` alongside `statusEvents=...`; add `processEvents: PostProcessEvent[];` to the row component's props type (line 1179) and destructure it (line 1226); at line 1349: `<PostTimelinePopover post={post} events={statusEvents} approvals={approvals} processEvents={processEvents} />`.

Tests: in `WorkflowDrawer.test.tsx` and `WorkflowDrawerAutoComplete.test.tsx` the `@/store` mock is a fixed object — add `getPostProcessEvents: vi.fn(async () => []),` to each (both already mock `useWorkspaceLimits`). Run `npx vitest run apps/crm/src/pages/entregas/components/__tests__/postTimeline.test.ts apps/crm/src/pages/entregas/components/__tests__/PostTimelinePopover.test.tsx apps/crm/src/pages/entregas/components/__tests__/WorkflowDrawer.test.tsx apps/crm/src/pages/entregas/components/__tests__/WorkflowDrawerAutoComplete.test.tsx` → PASS.

- [ ] **Step 4: Typecheck, lint, commit**

```bash
npx tsc -p apps/crm/tsconfig.json --noEmit && npm run lint
npx prettier --write apps/crm/src/pages/entregas/components
git add apps/crm/src/pages/entregas/components
git commit -m "feat(entregas): eventos de processo individual no histórico do post"
```

---

### Task 12: Drawer — header tag, "Responsável do post", read-only production section

**Files:**
- Create: `apps/crm/src/pages/entregas/components/PostProductionSection.tsx`
- Modify: `apps/crm/src/pages/entregas/components/StandalonePostDrawer.tsx:5, :17-40, :80-84, :176-183, :447-453, :492-495`
- Modify: `apps/crm/src/pages/entregas/components/PostEditorBody.tsx:80-119 (props), :364 (label), :419-421 (slot)`
- Modify: `apps/crm/style.css` (append)
- Test: `apps/crm/src/pages/entregas/components/__tests__/PostProductionSection.test.tsx`, `StandalonePostDrawer.test.tsx` (mock entries + 2 tests)

**Interfaces:**
- Consumes: `PostProcess`, `getVigentePostProcess`, `getPostProcessEvents` (Task 2); `etapaDeadlineDateOf`, `formatEtapaDeadlineDay` (etapaPrazo.ts); `buildPostTimeline` (Task 11); `PostTimelineList` (existing export of PostTimelinePopover.tsx).
- Produces:
  - `PostProductionSection({ process, postId, membros }: { process: PostProcess; postId: number; membros: Membro[] })` — origem, linha de etapas (responsável e prazo por etapa as text), estado, nota sobre propriedades, histórico filtrado ao processo; fetches `['post-process-events', String(postId)]` itself; NO buttons
  - `PostEditorBodyProps.postProcess?: PostProcess | null` — `undefined` = not applicable (workflow drawers, flag off): nothing rendered; `null` = avulso without process: nothing rendered; object = section rendered
  - StandalonePostDrawer: query `['post-process', postId]` (flag-gated), header tag `Avulso · Sem processo` / `Individual · <etapa>` / `Individual · Processo concluído`

- [ ] **Step 1: Section test (failing)**

```tsx
// apps/crm/src/pages/entregas/components/__tests__/PostProductionSection.test.tsx
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';

const store = vi.hoisted(() => ({ getPostProcessEvents: vi.fn() }));
vi.mock('@/store', () => store);

import { PostProductionSection } from '../PostProductionSection';
import type { PostProcess } from '../../../../store';

const process: PostProcess = {
  id: 5, conta_id: 'c', post_id: 77, template_id: 3, template_nome: 'Redes', assinatura: '',
  origem_workflow_id: 9, origem_descricao: 'Conteúdo de setembro, etapa Design',
  estado: 'ativo', motivo_encerramento: null, etapa_atual: 1, modo_prazo: 'padrao',
  board_position: 0, revisao: 1, created_by: null, created_at: '', updated_at: '', concluido_em: null,
  steps: [
    { id: 1, conta_id: 'c', process_id: 5, ordem: 0, nome: 'Copy', tipo: 'padrao', responsavel_id: null, prazo_dias: 2, tipo_prazo: 'uteis', prazo_efetivo: null, estado: 'herdado', iniciado_em: null, concluido_em: null, interrompido_em: null, origem_etapa_ordem: 0, origem_etapa_nome: 'Copy' },
    { id: 2, conta_id: 'c', process_id: 5, ordem: 1, nome: 'Design', tipo: 'padrao', responsavel_id: 7, prazo_dias: 3, tipo_prazo: 'uteis', prazo_efetivo: '2026-09-20T15:00:00Z', estado: 'ativo', iniciado_em: '2026-09-10T00:00:00Z', concluido_em: null, interrompido_em: null, origem_etapa_ordem: 1, origem_etapa_nome: 'Design' },
    { id: 3, conta_id: 'c', process_id: 5, ordem: 2, nome: 'Aprovação', tipo: 'aprovacao_cliente', responsavel_id: null, prazo_dias: 1, tipo_prazo: 'corridos', prazo_efetivo: null, estado: 'pendente', iniciado_em: null, concluido_em: null, interrompido_em: null, origem_etapa_ordem: 2, origem_etapa_nome: 'Aprovação' },
  ],
};

function renderSection() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <PostProductionSection process={process} postId={77} membros={[{ id: 7, nome: 'Ana' } as never]} />
    </QueryClientProvider>,
  );
}

describe('PostProductionSection', () => {
  it('mostra origem, etapas com estado, responsável e prazo, a nota de propriedades e nenhum botão', async () => {
    store.getPostProcessEvents.mockResolvedValue([
      { id: 1, conta_id: 'c', post_id: 77, process_id: 5, evento: 'desmembrado', actor_user_id: null, actor_name: 'Ana', origem: 'workspace_user', antes: { workflow_titulo: 'Conteúdo de setembro', etapa_nome: 'Design' }, depois: null, created_at: '2026-09-10T00:00:00Z' },
    ]);
    renderSection();
    expect(screen.getByRole('heading', { name: 'Produção' })).toBeInTheDocument();
    expect(screen.getByText('Desmembrado de Conteúdo de setembro, etapa Design')).toBeInTheDocument();
    expect(screen.getByText('Copy')).toBeInTheDocument();
    expect(screen.getByText('Herdada')).toBeInTheDocument();
    expect(screen.getByText('Ana')).toBeInTheDocument();
    expect(screen.getAllByText('Sem responsável')).toHaveLength(2);
    expect(screen.getByText(/^20 set/)).toBeInTheDocument();
    expect(screen.getByText(/Aprovação do cliente/)).toBeInTheDocument();
    expect(screen.getByText('Propriedades do template só valem dentro de um fluxo')).toBeInTheDocument();
    expect(await screen.findByText('Desmembrado de Conteúdo de setembro na etapa Design')).toBeInTheDocument();
    expect(screen.queryAllByRole('button')).toHaveLength(0);
    await waitFor(() => expect(store.getPostProcessEvents).toHaveBeenCalledWith([77]));
  });
});
```

The `/^20 set/` expectation relies on `formatEtapaDeadlineDay(new Date('2026-09-20T15:00:00Z'))` in the runner's local zone (UTC or America/Sao_Paulo both give day 20); the regex tolerates the year suffix the formatter appends when the runner's clock is not in 2026. `/Aprovação do cliente/` is a regex because the span text carries a leading " · ".

- [ ] **Step 2: Create `PostProductionSection.tsx`**

```tsx
// apps/crm/src/pages/entregas/components/PostProductionSection.tsx
import { useQuery } from '@tanstack/react-query';
import { Check, Clock, Ban, CircleDot } from 'lucide-react';
import {
  getPostProcessEvents,
  type Membro,
  type PostProcess,
  type PostProcessStep,
} from '../../../store';
import { etapaDeadlineDateOf, formatEtapaDeadlineDay } from '../etapaPrazo';
import { buildPostTimeline } from './postTimeline';
import { PostTimelineList } from './PostTimelinePopover';

const ESTADO_LABEL: Record<PostProcessStep['estado'], string> = {
  pendente: 'Pendente',
  ativo: 'Em andamento',
  concluido: 'Concluída',
  herdado: 'Herdada',
  ignorado: 'Ignorada',
  interrompido: 'Interrompida',
};

const PROCESS_LABEL: Record<PostProcess['estado'], string> = {
  ativo: 'Ativo',
  concluido: 'Concluído',
  encerrado: 'Encerrado',
};

function StepIcon({ estado }: { estado: PostProcessStep['estado'] }) {
  if (estado === 'concluido') return <Check className="h-3 w-3" />;
  if (estado === 'ativo') return <CircleDot className="h-3 w-3" />;
  if (estado === 'interrompido') return <Ban className="h-3 w-3" />;
  if (estado === 'pendente') return <Clock className="h-3 w-3" />;
  return null; // herdado / ignorado: só o círculo neutro
}

function toneFor(estado: PostProcessStep['estado']): string {
  if (estado === 'concluido') return 'approved';
  if (estado === 'interrompido') return 'failed';
  return 'neutral';
}

interface PostProductionSectionProps {
  process: PostProcess;
  postId: number;
  membros: Membro[];
}

/**
 * Seção de produção do post individual (spec §5.4), só leitura na fase 3:
 * origem (template ou fluxo de origem), linha de etapas com responsável e
 * prazo por etapa, estado do processo, nota sobre propriedades e o histórico
 * filtrado ao processo. Não existe stepper reutilizável (SortableEtapaList é
 * formulário); a linha usa o estilo history-timeline do PostTimelinePopover.
 * Sem ações no cabeçalho: Avançar/Voltar/Concluir/Reabrir/Remover/Aplicar/
 * Vincular são fase 4. Só é montada pelo drawer de post avulso (workflowId
 * nulo) e só busca eventos enquanto está aberta.
 */
export function PostProductionSection({ process, postId, membros }: PostProductionSectionProps) {
  const { data: events = [] } = useQuery({
    queryKey: ['post-process-events', String(postId)],
    queryFn: () => getPostProcessEvents([postId]),
  });
  const origem = process.origem_descricao
    ? `Desmembrado de ${process.origem_descricao}`
    : process.template_nome
      ? `Template: ${process.template_nome}`
      : 'Processo individual';
  const nodes = buildPostTimeline({ created_at: undefined }, [], [], events).filter(
    (n) => n.kind === 'process',
  );

  return (
    <section className="post-production" aria-labelledby="post-production-title">
      <div className="post-production-head">
        <h4 id="post-production-title" className="post-production-title">
          Produção
        </h4>
        <span className={`post-production-state post-production-state--${process.estado}`}>
          {PROCESS_LABEL[process.estado]}
        </span>
      </div>
      <p className="post-production-origem">{origem}</p>

      <div className="history-timeline">
        {process.steps.map((step, i) => {
          const responsavel =
            step.responsavel_id != null
              ? membros.find((m) => m.id === step.responsavel_id)
              : undefined;
          const prazo = etapaDeadlineDateOf(step);
          const tone = toneFor(step.estado);
          return (
            <div key={step.id} className="history-step">
              <div className="history-step-track">
                <div className={`history-step-icon history-step-icon--${tone}`}>
                  <StepIcon estado={step.estado} />
                </div>
                {i < process.steps.length - 1 && (
                  <div className={`history-step-line history-step-line--${tone}`} />
                )}
              </div>
              <div className="history-step-body">
                <div className="history-step-name">
                  {step.nome}
                  {step.tipo === 'aprovacao_cliente' && (
                    <span className="post-production-tipo"> · Aprovação do cliente</span>
                  )}
                </div>
                <div className="history-step-detail">
                  <span>{ESTADO_LABEL[step.estado]}</span>
                  {' · '}
                  <span>{responsavel ? responsavel.nome : 'Sem responsável'}</span>
                  {' · '}
                  <span>{prazo ? formatEtapaDeadlineDay(prazo) : 'Sem prazo'}</span>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {process.template_id != null && (
        <p className="post-production-note">Propriedades do template só valem dentro de um fluxo</p>
      )}

      {nodes.length > 0 && (
        <div className="post-production-history">
          <div className="post-timeline-title">Histórico do processo</div>
          <PostTimelineList nodes={nodes} />
        </div>
      )}
    </section>
  );
}
```

CSS appended to `apps/crm/style.css`:

```css
/* Seção de produção do post individual (spec §5.4) */
.post-production {
  display: flex;
  flex-direction: column;
  gap: 0.6rem;
  padding: 0.85rem 1rem;
  border: 1px solid var(--border-color);
  border-radius: 10px;
  background: var(--surface-1);
  margin-bottom: 1rem;
}
.post-production-head {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}
.post-production-title {
  margin: 0;
  font-size: 0.82rem;
  font-weight: 700;
  color: var(--text-main);
}
.post-production-state {
  font-size: 0.68rem;
  font-weight: 700;
  padding: 0.1rem 0.5rem;
  border-radius: 999px;
  background: var(--surface-hover);
  color: var(--text-muted);
}
.post-production-state--ativo {
  background: rgba(62, 207, 142, 0.15);
  color: var(--success);
}
.post-production-origem,
.post-production-note {
  margin: 0;
  font-size: 0.76rem;
  color: var(--text-muted);
}
.post-production-tipo {
  font-weight: 400;
  color: var(--text-muted);
}
.post-production-history {
  border-top: 1px solid var(--border-color);
  padding-top: 0.6rem;
}
```

Run: `npx vitest run apps/crm/src/pages/entregas/components/__tests__/PostProductionSection.test.tsx` → PASS.

- [ ] **Step 3: `PostEditorBody.tsx`**

Imports: add `type PostProcess` to the `'../../../store'` import and `import { PostProductionSection } from './PostProductionSection';`. In `PostEditorBodyProps` after `workflowId: number | null;` add:

```ts
  /** Processo individual vigente do post (spec §5.4). `undefined` = não se
   *  aplica (drawer de fluxo, flag desligada); `null` = avulso sem processo.
   *  Só o StandalonePostDrawer preenche, e só com feature_post_processes. */
  postProcess?: PostProcess | null;
```

Destructure `postProcess` in the component. Line 364: `<label>Responsável</label>` → `<label>Responsável do post</label>`. Immediately after the `PropertyPanel` block (line 419) and before `<PostMediaGallery` add:

```tsx
      {postProcess && workflowId == null && (
        <PostProductionSection process={postProcess} postId={post.id!} membros={membros} />
      )}
```

- [ ] **Step 4: `StandalonePostDrawer.tsx`**

Imports: add `Route` to the lucide import (line 5); add `getVigentePostProcess` to the `'../../../store'` import block; add `import { useWorkspaceLimits } from '@/hooks/useWorkspaceLimits';`. After the `post` query (line 80-84):

```ts
  // Processo individual vigente (spec §5.4). Flag-gated e sob demanda: só
  // este drawer, só enquanto aberto. `null` = avulso sem processo.
  const { features } = useWorkspaceLimits();
  const postProcessesEnabled = features?.feature_post_processes === true;
  const { data: postProcess = null } = useQuery({
    queryKey: ['post-process', postId],
    queryFn: () => getVigentePostProcess(postId),
    enabled: postProcessesEnabled,
  });
  const activeStepName =
    postProcess?.estado === 'ativo'
      ? (postProcess.steps.find((s) => s.estado === 'ativo')?.nome ??
        postProcess.steps.find((s) => s.ordem === postProcess.etapa_atual)?.nome ??
        null)
      : null;
```

In `refresh()` (line 176-183) add `qc.invalidateQueries({ queryKey: ['post-process', postId] }); qc.invalidateQueries({ queryKey: ['post-processes'] }); qc.invalidateQueries({ queryKey: ['post-process-events'] });`.

Replace the header tag (lines 450-453) with:

```tsx
                {postProcessesEnabled && postProcess ? (
                  <span className="post-fluxo-tag post-fluxo-tag--avulso post-fluxo-tag--individual">
                    <Route size={11} aria-hidden="true" style={{ flexShrink: 0 }} />
                    Individual · {activeStepName ?? 'Processo concluído'}
                  </span>
                ) : (
                  <span className="post-fluxo-tag post-fluxo-tag--avulso">
                    <CircleDashed size={11} aria-hidden="true" style={{ flexShrink: 0 }} />
                    {postProcessesEnabled ? 'Avulso · Sem processo' : 'Avulso'}
                  </span>
                )}
```

In the `<PostEditorBody ... />` call add `postProcess={postProcessesEnabled ? postProcess : undefined}`.

- [ ] **Step 5: Drawer tests**

In `StandalonePostDrawer.test.tsx`: change the `useWorkspaceLimits` mock (line 24-33) to a hoisted, configurable object:

```ts
const limitsMock = vi.hoisted(() => ({ features: null as Record<string, boolean> | null }));
vi.mock('@/hooks/useWorkspaceLimits', () => ({
  useWorkspaceLimits: () => ({ limits: null, features: limitsMock.features, planName: null, isLoading: false, isUnlimited: true }),
}));
```

Add to the `@/store` mock (line 59): `getVigentePostProcess: vi.fn(async () => null), getPostProcessEvents: vi.fn(async () => []),`. Add `limitsMock.features = null;` to the suite's `beforeEach` (line 183). Append inside the `describe('StandalonePostDrawer')` block, using the file's `renderDrawer(qc)` helper (line 163; it mounts the drawer with `postId={5}` inside a `QueryClientProvider`) and the `basePost()` fixture `mockGetStandalonePost` already resolves:

```ts
  it('flag desligada mantém a tag "Avulso" e não consulta o processo', async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    renderDrawer(qc);
    expect(await screen.findByText('Avulso')).toBeInTheDocument();
    const { getVigentePostProcess } = await import('@/store');
    expect(getVigentePostProcess).not.toHaveBeenCalled();
  });

  it('flag ligada sem processo: tag "Avulso · Sem processo"', async () => {
    limitsMock.features = { feature_post_processes: true };
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    renderDrawer(qc);
    expect(await screen.findByText('Avulso · Sem processo')).toBeInTheDocument();
    const { getVigentePostProcess } = await import('@/store');
    expect(getVigentePostProcess).toHaveBeenCalledWith(5);
  });

  it('flag ligada com processo ativo: tag "Individual · <etapa>" e seção Produção', async () => {
    limitsMock.features = { feature_post_processes: true };
    const { getVigentePostProcess } = await import('@/store');
    // Set the value BEFORE mounting: the query fires on mount, and a `Once`
    // value is consumed by whichever call happens next.
    (getVigentePostProcess as any).mockResolvedValueOnce({
      id: 9, post_id: 5, estado: 'ativo', etapa_atual: 1, template_id: null, template_nome: null,
      origem_descricao: null, steps: [
        { id: 1, ordem: 0, nome: 'Copy', estado: 'ignorado', tipo: 'padrao', responsavel_id: null, prazo_dias: null, tipo_prazo: null, prazo_efetivo: null, iniciado_em: null },
        { id: 2, ordem: 1, nome: 'Design', estado: 'ativo', tipo: 'padrao', responsavel_id: null, prazo_dias: null, tipo_prazo: null, prazo_efetivo: null, iniciado_em: null },
      ],
    });
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    renderDrawer(qc, { membros: [{ id: 1, nome: 'Ana' }] }); // the select (and its label) only renders with membros
    expect(await screen.findByText('Individual · Design')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Produção' })).toBeInTheDocument();
    expect(screen.getByText('Responsável do post')).toBeInTheDocument();
  });
```

Each `it` mounts exactly one drawer (the file's `afterEach` cleanup unmounts between tests), so no assertion ever sees two drawers.

Run: `npx vitest run apps/crm/src/pages/entregas/components/__tests__/StandalonePostDrawer.test.tsx apps/crm/src/pages/entregas/components/__tests__/PostProductionSection.test.tsx` → PASS.

- [ ] **Step 6: Typecheck, lint, commit**

```bash
npx tsc -p apps/crm/tsconfig.json --noEmit && npm run lint
npx prettier --write apps/crm/src/pages/entregas/components apps/crm/style.css
git add apps/crm/src/pages/entregas/components apps/crm/style.css
git commit -m "feat(entregas): seção de produção (leitura) e tag Individual no drawer do post"
```

---

### Task 13: Publicações context ("Individual · <etapa>") and "Somente fluxos" notes

**Files:**
- Modify: `apps/crm/src/pages/entregas/views/PostsKanbanView.tsx:132-152 (props), :170-178 + :226-235 (card content), :299-311 + :337 (card), :350-372 + :492-498 (column), :522-532 + :846-870 (view + overlay)`
- Modify: `apps/crm/src/pages/entregas/views/PostsListView.tsx:14-29 (props), :71 (destructure), :259-284 (tag cell + etapa cell)`
- Modify: `apps/crm/src/pages/entregas/views/CalendarView.tsx:15-21 (props), :121-125 (main return)`
- Modify: `apps/crm/src/pages/entregas/views/ChartView.tsx:60-68 (props), :542-543 (main return)`
- Modify: `apps/crm/src/pages/entregas/EntregasPage.tsx` (`processEtapaByPostId` memo; the four view call sites 907-960)
- Modify: `apps/crm/style.css` (append)
- Test: `apps/crm/src/pages/entregas/views/__tests__/PostsListView.test.tsx`, `CalendarView.test.tsx` (append)

**Interfaces:**
- Consumes: `postEntities` (Task 6), `postProcessesEnabled`.
- Produces:
  - `PostsKanbanView` / `PostsListView` new optional prop `processEtapaByPostId?: Map<number, string>` (post id → active etapa name of its vigente ATIVO process). A post with `workflow_id === null` and an entry renders `Individual · <etapa>` instead of `Avulso`; PostsListView's "Etapa atual" cell shows the etapa too.
  - `CalendarView` / `ChartView` new optional props `postProcessesEnabled?: boolean; onGoToKanban?: () => void` rendering the spec §4.4 note "Somente fluxos" with a link to the board (calendar: only in mode `entregas`).
  - `EntregasPage`: `processEtapaByPostId = new Map(postEntities.map(e => [e.process.post_id, e.etapaNome]))` (module `EMPTY_ETAPA_MAP` when empty).

- [ ] **Step 1: Failing view tests**

Append to `PostsListView.test.tsx` (the file already mocks `useStatusRegistry` with the real registry builder and renders `PostsListView` without a router; the snippet passes every prop explicitly, so it needs nothing else from the file):

```tsx
  it('mostra "Individual · <etapa>" para um avulso com processo, quando o mapa traz a etapa', () => {
    const avulso = { id: 1, workflow_id: null, cliente_id: 1, cliente_nome: 'A', workflow_titulo: null, titulo: 'Post individual', tipo: 'feed', status: 'rascunho', custom_status_id: null, scheduled_at: null, published_at: null, ig_caption: null, instagram_permalink: null, publish_error: null, publish_error_code: null, ordem: 0, responsavel_id: null, platform: 'instagram', tiktok_publish_status: null, tiktok_publish_error: null, tiktok_post_url: null, instagram_media_id: null, ig_trial_strategy: null, board_ordem: null } as ActivePost;
    render(
      <PostsListView
        posts={[avulso]}
        isLoading={false}
        openableWorkflowIds={new Set()}
        onPostClick={vi.fn()}
        onFluxoClick={vi.fn()}
        cardsByWorkflowId={new Map()}
        filtersActive={false}
        onCreateAvulso={vi.fn()}
        processEtapaByPostId={new Map([[1, 'Design']])}
      />,
    );
    expect(screen.getByText('Individual · Design')).toBeInTheDocument();
    expect(screen.queryByText('Avulso')).toBeNull();
    expect(screen.getAllByText('Design')).not.toHaveLength(0); // célula "Etapa atual"
  });
```

Append to `CalendarView.test.tsx`:

```tsx
  it('mostra a nota "Somente fluxos" com a flag ligada e chama onGoToKanban', () => {
    const onGoToKanban = vi.fn();
    render(
      <Wrapper>
        <CalendarView cards={[makeCard()]} onCardClick={vi.fn()} {...defaultProps} postProcessesEnabled onGoToKanban={onGoToKanban} />
      </Wrapper>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'quadro' }));
    expect(onGoToKanban).toHaveBeenCalled();
    expect(screen.getByText(/Somente fluxos/)).toBeInTheDocument();
  });

  it('sem a flag não há nota', () => {
    render(
      <Wrapper>
        <CalendarView cards={[makeCard()]} onCardClick={vi.fn()} {...defaultProps} />
      </Wrapper>,
    );
    expect(screen.queryByText(/Somente fluxos/)).toBeNull();
  });
```

(`Wrapper`, `defaultProps` and `makeCard` are the file's existing helpers, used by every render in it; `fireEvent` comes from the file's Testing Library import.)

- [ ] **Step 2: `PostsKanbanView.tsx`**

- Props: add `/** post id → etapa ativa do processo individual (spec §4.4). Só posts avulsos aparecem aqui. */ processEtapaByPostId?: Map<number, string>;`
- `PostBoardCardContent`: add prop `processEtapa?: string` and change the tag block (226-235) to:

```tsx
      {card ? (
        <span className="post-fluxo-tag post-fluxo-tag--static">
          <Route size={11} aria-hidden="true" style={{ flexShrink: 0 }} />
          {card.etapa.nome}
        </span>
      ) : post.workflow_id === null && processEtapa ? (
        <span className="post-fluxo-tag post-fluxo-tag--avulso post-fluxo-tag--individual">
          <Route size={11} aria-hidden="true" style={{ flexShrink: 0 }} />
          Individual · {processEtapa}
        </span>
      ) : post.workflow_id === null ? (
        <span className="post-fluxo-tag post-fluxo-tag--avulso">
          <CircleDashed size={11} aria-hidden="true" style={{ flexShrink: 0 }} />
          Avulso
        </span>
      ) : null}
```

- `PostBoardCard`: add prop `processEtapa?: string` and pass it to `PostBoardCardContent`.
- `PostBoardColumn`: add prop `processEtapaByPostId?: Map<number, string>`; at the `<PostBoardCard>` render (492) pass `processEtapa={processEtapaByPostId?.get(p.id)}`.
- `PostsKanbanView`: destructure `processEtapaByPostId`, pass to every `<PostBoardColumn>` and to the overlay `<PostBoardCardContent processEtapa={processEtapaByPostId?.get(activePost.id)} />`.

- [ ] **Step 3: `PostsListView.tsx`**

Props: add `processEtapaByPostId?: Map<number, string>;`; destructure it. Inside the row (after `const card = cardOf(p);`, line 214) add `const processEtapa = workflowId == null ? processEtapaByPostId?.get(p.id) : undefined;`. Replace the avulso branch (259-264) with:

```tsx
                  {workflowId == null ? (
                    processEtapa ? (
                      <span className="post-fluxo-tag post-fluxo-tag--avulso post-fluxo-tag--individual">
                        <Route size={11} aria-hidden="true" style={{ flexShrink: 0 }} />
                        Individual · {processEtapa}
                      </span>
                    ) : (
                      <span className="post-fluxo-tag post-fluxo-tag--avulso">
                        <CircleDashed size={11} aria-hidden="true" style={{ flexShrink: 0 }} />
                        Avulso
                      </span>
                    )
                  ) : card ? (
```

(add `Route` to the lucide import) and the etapa cell (283): `{card?.etapa.nome || processEtapa || '—'}`.

- [ ] **Step 4: "Somente fluxos" note in `CalendarView.tsx` and `ChartView.tsx`**

Shared markup (inline in each file; two lines, not worth a component):

```tsx
{postProcessesEnabled && (
  <p className="entregas-somente-fluxos">
    Somente fluxos. Posts individuais aparecem no{' '}
    <button type="button" className="entregas-somente-fluxos-link" onClick={onGoToKanban}>
      quadro
    </button>
    .
  </p>
)}
```

`CalendarView`: props `postProcessesEnabled?: boolean; onGoToKanban?: () => void;`; render the note as the first child of the main `<div className="animate-up" ...>` (line 122) only when `mode === 'entregas'`. `ChartView`: same props; render as the first child of the main wrapper `<div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>` (line 543).

CSS appended to `apps/crm/style.css`:

```css
.entregas-somente-fluxos {
  margin: 0;
  font-size: 0.78rem;
  color: var(--text-muted);
}
.entregas-somente-fluxos-link {
  background: none;
  border: none;
  padding: 0;
  cursor: pointer;
  font: inherit;
  color: var(--text-main);
  text-decoration: underline;
}
```

- [ ] **Step 5: `EntregasPage.tsx` wiring**

Module constant `const EMPTY_ETAPA_MAP: Map<number, string> = new Map();`. After `filteredPostEntities`:

```ts
  // Publicações (Kanban/Lista): "Individual · <etapa>" no card de um avulso
  // com processo ativo (spec §4.4). Vazio e estável com a flag desligada.
  const processEtapaByPostId = useMemo(() => {
    if (postEntities.length === 0) return EMPTY_ETAPA_MAP;
    return new Map(postEntities.map((e) => [e.process.post_id, e.etapaNome]));
  }, [postEntities]);
```

Pass `processEtapaByPostId={processEtapaByPostId}` to `<PostsKanbanView>` and `<PostsListView>`; pass `postProcessesEnabled={postProcessesEnabled} onGoToKanban={() => setActiveView('kanban')}` to `<CalendarView>` and `<ChartView>`.

- [ ] **Step 6: Run, typecheck, lint, commit**

Run: `npx vitest run apps/crm/src/pages/entregas/views apps/crm/src/pages/entregas/__tests__/EntregasPage.test.tsx && npx tsc -p apps/crm/tsconfig.json --noEmit && npm run lint`

```bash
npx prettier --write apps/crm/src/pages/entregas apps/crm/style.css
git add apps/crm/src/pages/entregas apps/crm/style.css
git commit -m "feat(entregas): contexto de processo em Publicações e nota Somente fluxos"
```

---

### Task 14: Concluídas — "Post individual" entries from the shared batch

**Files:**
- Modify: `apps/crm/src/pages/entregas/views/ConcludedView.tsx` (whole component)
- Modify: `apps/crm/src/pages/entregas/EntregasPage.tsx:961` (`<ConcludedView />`)
- Test: `apps/crm/src/pages/entregas/views/__tests__/ConcludedView.test.tsx` (new)

**Interfaces:**
- Consumes: `getVigentePostProcesses`, `PostProcessWithPost` (Task 2); `useWorkspaceLimits`.
- Produces: `ConcludedView({ onOpenPost }: { onOpenPost?: (postId: number) => void })`; reads `['post-processes', 'vigentes']` (same key and fn as the hook, so it dedupes with the page) filtered to `estado === 'concluido'`; groups them under the post's client; entry shows title, tag "Post individual", template name, `Concluído <date>`; click → `onOpenPost(post_id)`. No "Reabrir processo" (fase 4). Empty copy with flag on: "Nenhum fluxo ou post individual concluído ainda."

- [ ] **Step 1: Failing test**

```tsx
// apps/crm/src/pages/entregas/views/__tests__/ConcludedView.test.tsx
import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const store = vi.hoisted(() => ({
  getConcludedWorkflows: vi.fn(async () => []),
  getWorkflowEtapas: vi.fn(async () => []),
  getWorkflowPosts: vi.fn(async () => []),
  getClientes: vi.fn(async () => [{ id: 3, nome: 'Aurora', cor: '#000' }]),
  reopenWorkflow: vi.fn(),
  getVigentePostProcesses: vi.fn(async () => []),
}));
vi.mock('../../../../store', () => store);
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('../../components/HistoryDrawer', () => ({ HistoryDrawer: () => <div>HistoryDrawer</div> }));
const limitsMock = vi.hoisted(() => ({ features: null as Record<string, boolean> | null }));
vi.mock('@/hooks/useWorkspaceLimits', () => ({
  useWorkspaceLimits: () => ({ limits: null, features: limitsMock.features, planName: null, isLoading: false, isUnlimited: false }),
}));

import { ConcludedView } from '../ConcludedView';

const concluded = {
  id: 9, conta_id: 'c', post_id: 77, template_id: 5, template_nome: 'Redes', assinatura: '', origem_workflow_id: null,
  origem_descricao: null, estado: 'concluido', motivo_encerramento: null, etapa_atual: 1, modo_prazo: 'padrao',
  board_position: 0, revisao: 2, created_by: null, created_at: '', updated_at: '', concluido_em: '2026-09-05T12:00:00Z',
  steps: [], post: { id: 77, workflow_id: null, cliente_id: 3, cliente_nome: 'Aurora', titulo: 'Post concluído', tipo: 'feed', status: 'postado' },
};

function renderView(onOpenPost = vi.fn()) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <ConcludedView onOpenPost={onOpenPost} />
    </QueryClientProvider>,
  );
  return onOpenPost;
}

describe('ConcludedView com processos individuais', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    limitsMock.features = null;
  });

  it('flag desligada: não consulta processos e mantém a cópia vazia de sempre', async () => {
    renderView();
    expect(await screen.findByText('Nenhum fluxo concluído ainda.')).toBeInTheDocument();
    expect(store.getVigentePostProcesses).not.toHaveBeenCalled();
  });

  it('flag ligada: lista o processo concluído no grupo do cliente com a tag e abre o post', async () => {
    limitsMock.features = { feature_post_processes: true };
    store.getVigentePostProcesses.mockResolvedValueOnce([concluded] as never);
    const onOpenPost = renderView();
    fireEvent.click(await screen.findByText('Aurora'));
    expect(screen.getByText('Post concluído')).toBeInTheDocument();
    expect(screen.getByText('Post individual')).toBeInTheDocument();
    expect(screen.getByText(/1 post individual/)).toBeInTheDocument();
    fireEvent.click(screen.getByText('Post concluído'));
    expect(onOpenPost).toHaveBeenCalledWith(77);
    expect(screen.queryByTitle('Reabrir processo')).toBeNull();
  });

  it('flag ligada e nada concluído: cópia vazia inclui posts individuais', async () => {
    limitsMock.features = { feature_post_processes: true };
    renderView();
    expect(await screen.findByText('Nenhum fluxo ou post individual concluído ainda.')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Implement in `ConcludedView.tsx`**

Imports: add `useMemo` to the react import; `getVigentePostProcesses, type PostProcessWithPost` to the store import; `import { useWorkspaceLimits } from '@/hooks/useWorkspaceLimits';`; `FileText` to lucide.

Types:

```ts
interface ClientGroup {
  cliente: Cliente;
  workflows: ConcludedWorkflowSummary[];
  processes: PostProcessWithPost[];
}
const EMPTY_PROCESSES: PostProcessWithPost[] = [];
```

Signature: `export function ConcludedView({ onOpenPost }: { onOpenPost?: (postId: number) => void } = {})`. After the `summaries` query add:

```ts
  // Processos individuais concluídos (spec §4.4): UMA consulta por conta, a
  // mesma chave/fn de useEntregasData (dedupe pelo cache). Nunca o padrão N+1
  // dos sumários de fluxo acima.
  const { features } = useWorkspaceLimits();
  const postProcessesEnabled = features?.feature_post_processes === true;
  const { data: vigente = EMPTY_PROCESSES } = useQuery({
    queryKey: ['post-processes', 'vigentes'],
    queryFn: getVigentePostProcesses,
    enabled: postProcessesEnabled,
  });
  const concludedProcesses = useMemo(
    () => vigente.filter((p) => p.estado === 'concluido'),
    [vigente],
  );
```

Grouping (replace lines 87-98):

```ts
  const groups: ClientGroup[] = [];
  const clientMap = new Map<number, { workflows: ConcludedWorkflowSummary[]; processes: PostProcessWithPost[] }>();
  const bucket = (clienteId: number) => {
    let b = clientMap.get(clienteId);
    if (!b) {
      b = { workflows: [], processes: [] };
      clientMap.set(clienteId, b);
    }
    return b;
  };
  for (const s of summaries) bucket(s.workflow.cliente_id).workflows.push(s);
  for (const p of concludedProcesses) {
    if (p.post.cliente_id != null) bucket(p.post.cliente_id).processes.push(p);
  }
  for (const [clienteId, b] of clientMap) {
    const cliente = clientes.find((c) => c.id === clienteId);
    if (cliente) groups.push({ cliente, workflows: b.workflows, processes: b.processes });
  }
  groups.sort((a, b) => a.cliente.nome.localeCompare(b.cliente.nome));
```

Empty state (line 129): `if (summaries.length === 0 && concludedProcesses.length === 0 && !isLoading)` with copy `{postProcessesEnabled ? 'Nenhum fluxo ou post individual concluído ainda.' : 'Nenhum fluxo concluído ainda.'}`.

Group count (line 156-158):

```tsx
                <span className="concluded-client-count">
                  ({group.workflows.length} fluxo{group.workflows.length !== 1 ? 's' : ''}
                  {group.processes.length > 0 &&
                    ` · ${group.processes.length} post${group.processes.length !== 1 ? 's' : ''} individua${group.processes.length !== 1 ? 'is' : 'l'}`}
                  )
                </span>
```

After the `group.workflows.map(...)` rows (inside `concluded-client-workflows`, before its closing `</div>`) add:

```tsx
                  {group.processes.map((p) => (
                    <div
                      key={`proc-${p.id}`}
                      className="concluded-wf-row"
                      onClick={() => onOpenPost?.(p.post_id)}
                    >
                      <div>
                        <div className="concluded-wf-title">
                          {p.post.titulo || 'Post sem título'}
                          <span
                            className="post-fluxo-tag post-fluxo-tag--avulso post-fluxo-tag--individual"
                            style={{ marginLeft: '0.5rem' }}
                          >
                            <FileText size={11} aria-hidden="true" style={{ flexShrink: 0 }} />
                            Post individual
                          </span>
                        </div>
                        <div className="concluded-wf-meta">
                          {p.template_nome ?? 'Etapas personalizadas'}
                          {p.concluido_em && <> &bull; Concluído {formatDateShort(p.concluido_em)}</>}
                        </div>
                      </div>
                      <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>→</span>
                    </div>
                  ))}
```

Also add `qc.invalidateQueries({ queryKey: ['post-processes'] });` to `handleReopenConfirm`'s invalidation list (inert flag-off).

- [ ] **Step 3: `EntregasPage.tsx`**

Line 961: `{activeView === 'concluded' && (<ConcludedView onOpenPost={(postId) => { setDrawerCard(null); setDrawerInitialPostId(null); setStandalonePostId(postId); }} />)}`. The page test mocks `ConcludedView` (line 248), so no test change there.

- [ ] **Step 4: Run, typecheck, lint, commit**

Run: `npx vitest run apps/crm/src/pages/entregas/views/__tests__/ConcludedView.test.tsx apps/crm/src/pages/entregas/__tests__/EntregasPage.test.tsx && npx tsc -p apps/crm/tsconfig.json --noEmit && npm run lint`

```bash
npx prettier --write apps/crm/src/pages/entregas/views/ConcludedView.tsx apps/crm/src/pages/entregas/views/__tests__/ConcludedView.test.tsx apps/crm/src/pages/entregas/EntregasPage.tsx
git add apps/crm/src/pages/entregas/views/ConcludedView.tsx apps/crm/src/pages/entregas/views/__tests__/ConcludedView.test.tsx apps/crm/src/pages/entregas/EntregasPage.tsx
git commit -m "feat(entregas): processos individuais concluídos em Concluídas (lote único)"
```

---

### Task 15: Copy — explainer and tour variants behind the flag

**Files:**
- Modify: `apps/crm/src/pages/entregas/components/ComoFuncionaPanel.tsx:26-63, :100-103`
- Modify: `apps/crm/src/pages/entregas/tour/entregasTour.ts:5-56`
- Modify: `apps/crm/src/pages/entregas/EntregasPage.tsx:205-220 (launchTour), :787 (<ComoFuncionaPanel>)`
- Test: `apps/crm/src/pages/entregas/tour/__tests__/entregasTour.test.ts` (append), `apps/crm/src/pages/entregas/components/__tests__/ComoFuncionaPanel.test.tsx` (new)

**Interfaces:**
- Produces:
  - `ComoFuncionaPanel({ onDismiss, postProcessesEnabled }: { onDismiss: () => void; postProcessesEnabled?: boolean })` — with the flag, the objects tree gains a "Post individual" item and the two copies that assert "só fluxos são cards" change; without it, byte-identical strings
  - `TOUR_STEP_DEFS` unchanged; new `TOUR_STEP_DEFS_POST_PROCESSES` (same 6 selectors); `buildTourSteps(root = document, defs = TOUR_STEP_DEFS)`; `startEntregasTour(opts: { onComplete; onDismiss; postProcesses?: boolean })`

- [ ] **Step 1: Failing tests**

Append to `entregasTour.test.ts`:

```ts
import { TOUR_STEP_DEFS_POST_PROCESSES } from '../entregasTour';

describe('tour com posts individuais', () => {
  it('a variante tem os mesmos 6 seletores e não afirma que só fluxos são cards', () => {
    expect(TOUR_STEP_DEFS_POST_PROCESSES.map((s) => s.selector)).toEqual(TOUR_STEP_DEFS.map((s) => s.selector));
    expect(TOUR_STEP_DEFS_POST_PROCESSES[0].description).toMatch(/Posts individuais/);
    expect(TOUR_STEP_DEFS_POST_PROCESSES[2].description).toMatch(/Os posts de um fluxo/);
    expect(TOUR_STEP_DEFS[2].description).toBe('Os posts ficam dentro do card. Clique no card para abrir o painel e criar posts.');
  });

  it('startEntregasTour escolhe a variante pela opção postProcesses', () => {
    document.body.innerHTML = '<div data-tour="wf-card"></div>';
    startEntregasTour({ onComplete: vi.fn(), onDismiss: vi.fn(), postProcesses: true });
    expect(capturedConfig.current.steps[0].popover.description).toMatch(/Posts individuais/);
  });
});
```

New `ComoFuncionaPanel.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
vi.mock('@/lib/supabase');
import { ComoFuncionaPanel } from '../ComoFuncionaPanel';

describe('ComoFuncionaPanel', () => {
  it('sem a flag descreve o fluxo como o card do kanban', () => {
    render(<ComoFuncionaPanel onDismiss={vi.fn()} />);
    expect(screen.getByText('um ciclo de entrega de um cliente — o card do kanban')).toBeInTheDocument();
    expect(screen.queryByText('Post individual')).toBeNull();
  });
  it('com a flag inclui o post individual entre os objetos', () => {
    render(<ComoFuncionaPanel onDismiss={vi.fn()} postProcessesEnabled />);
    expect(screen.getByText('Post individual')).toBeInTheDocument();
    expect(screen.getByText('um ciclo de entrega de um cliente: um card do kanban')).toBeInTheDocument();
    expect(screen.getByText('as fases do fluxo ou do post individual: só uma fica ativa por vez')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: `ComoFuncionaPanel.tsx`**

Signature: `export function ComoFuncionaPanel({ onDismiss, postProcessesEnabled = false }: { onDismiss: () => void; postProcessesEnabled?: boolean })`. Replace the `<ol className="ex-tree">` (lines 50-63) with:

```tsx
          <ol className="ex-tree">
            <li className="ex-tree-l0">
              <span className="ex-term">Fluxo</span>
              <span className="ex-def">
                {postProcessesEnabled
                  ? 'um ciclo de entrega de um cliente: um card do kanban'
                  : 'um ciclo de entrega de um cliente — o card do kanban'}
              </span>
            </li>
            <li className="ex-tree-l1">
              <span className="ex-term">Etapas</span>
              <span className="ex-def">
                {postProcessesEnabled
                  ? 'as fases do fluxo ou do post individual: só uma fica ativa por vez'
                  : 'as fases do fluxo — só uma fica ativa por vez'}
              </span>
            </li>
            <li className="ex-tree-l2">
              <span className="ex-term">Posts</span>
              <span className="ex-def">o conteúdo em si, cada um com o seu status</span>
            </li>
            {postProcessesEnabled && (
              <li className="ex-tree-l0">
                <span className="ex-term">Post individual</span>
                <span className="ex-def">
                  um post com etapas próprias, sem fluxo: também é um card do kanban
                </span>
              </li>
            )}
          </ol>
```

(The pre-existing strings on the flag-off branch keep their em-dashes: that branch must stay byte-identical. The three NEW strings, the two flag-on variants and the "Post individual" line, use a colon per the Global Constraints copy rule, so with the flag on the list mixes " — " on untouched lines with ": " on new ones. Accepted on purpose: the copy rule wins over the list's visual symmetry, and the mixed list only exists behind the flag.) Replace the aside at lines 100-103 with:

```tsx
          <p className="ex-aside">
            {postProcessesEnabled
              ? 'Um post também pode existir sem fluxo: avulso, andando só pelo trilho de status no quadro de Publicações, ou individual, com etapas próprias no quadro de Fluxos.'
              : 'Um post também pode existir sem fluxo (publicação avulsa): ele anda só pelo trilho de status, no quadro de Publicações.'}
          </p>
```

- [ ] **Step 3: `entregasTour.ts`**

After `TOUR_STEP_DEFS` add:

```ts
/** Variante com feature_post_processes: mesmos seletores, sem afirmar que só
 *  fluxos são cards (spec §3). */
export const TOUR_STEP_DEFS_POST_PROCESSES = TOUR_STEP_DEFS.map((s, i) =>
  i === 0
    ? {
        ...s,
        description:
          'Isto é um card de fluxo: um ciclo de trabalho de um cliente. Posts individuais com processo próprio também viram cards aqui.',
      }
    : i === 2
      ? {
          ...s,
          description:
            'Os posts de um fluxo ficam dentro do card. Clique no card para abrir o painel e criar posts.',
        }
      : s,
);
```

`buildTourSteps(root: ParentNode = document, defs: typeof TOUR_STEP_DEFS = TOUR_STEP_DEFS)` filters `defs`. `startEntregasTour(opts: { onComplete: () => void; onDismiss: (stepIndex: number) => void; postProcesses?: boolean })` → `const steps = buildTourSteps(document, opts.postProcesses ? TOUR_STEP_DEFS_POST_PROCESSES : TOUR_STEP_DEFS);`.

- [ ] **Step 4: `EntregasPage.tsx`**

In `launchTour` pass `postProcesses: postProcessesEnabled` to `startEntregasTour` and add `postProcessesEnabled` to the `useCallback` deps. `<ComoFuncionaPanel onDismiss={dismissExplainer} postProcessesEnabled={postProcessesEnabled} />`.

- [ ] **Step 5: Run everything, typecheck all four projects, lint, format, commit**

```bash
npx vitest run apps/crm/src/pages/entregas
npx tsc -p apps/crm/tsconfig.json --noEmit && npx tsc -p apps/hub/tsconfig.json --noEmit && npx tsc -p apps/admin/tsconfig.json --noEmit && npx tsc -p tsconfig.scripts.json
npm run lint && npm run format && npm run test
git add apps/crm/src/pages/entregas
git commit -m "feat(entregas): cópia do explicador e do tour com posts individuais"
```

- [ ] **Step 6: Manual flag-off verification in the browser (before opening the PR)**

Run `npm run dev:staging` (the worktree needs `.env.staging`; see memory `reference_worktree_env_staging_gotcha`), open `/entregas` in a workspace whose plan has `feature_post_processes = false` and confirm: no toggle, no `?entidade=` in the URL, no `entregas_entidade_*` key in localStorage, `post_processes` absent from the network tab, "Responsável do post" label in the drawer (the one allowed copy change), board/list/calendar/chart/concluded identical to prod. Then flip the flag for the staging validation workspace via `workspace_plan_overrides.feature_overrides` in the Admin and confirm the toggle, an active process card (create one with `apply_post_process` via `supabase db query` if none exists), the "Sem processo" section, the drawer section and the Concluídas entry. Do NOT turn the flag on in prod: that is spec §11 step 5, fase 4.

---

## Self-Review

Run against the spec (`docs/superpowers/specs/2026-09-10-posts-individuais-fluxos-design.md`) with fresh eyes after writing every task.

**1. Spec coverage (fase 3 = read model; §5, §6.2 and §11 step 5 are fase 4 by definition)**

| Spec item | Task |
|---|---|
| §3 copy that asserts "só fluxos são cards": `ComoFuncionaPanel`, tour steps, empty states | 15 (explainer + tour), 8 (Kanban empty copy), 14 (Concluídas empty copy) |
| §4.1 `entidade` param, localStorage key, `hasLastMode` proxy, URL/vista win, helper text "Quadro por etapa de produção" | 7 |
| §4.1 row identity `template:<id>` + signature `(ordem, nome, tipo)`, "Etapas personalizadas", `TABS_THRESHOLD` unchanged | 5 (behind `signatureRows`, see Global Constraints) |
| §4.1 "Aplicar processo ou desmembrar ... abre Fluxos em Kanban e revela o card" | fase 4 (command side) |
| §4.2 post card content (cliente, título, formato, ícone/tag "Individual", status chip, responsável e prazo da etapa, capa) | 8 |
| §4.2 column count split "N fluxos · M posts"; header total "posts individuais" | 8, 6 |
| §4.2 movement, buttons, dialogs with entity title, `reorder_fluxos_board` | fase 4 |
| §4.2 mixed ordering: prazo by one function, manual by `board_position`, tie by id | 3, 4, 8 |
| §4.3 Sem processo: cache `['active-posts']`, 12 max, id desc, "Ver todos em Publicações", search+cliente, production-filter notice, concluded excluded | 10 (+ 2 for the vigente batch) |
| §4.4 Lista de Fluxos | 9 |
| §4.4 Publicações Kanban/Lista "Individual · <etapa>" | 13 |
| §4.4 Calendário de publicações detail panel | deferred, reason in File Structure |
| §4.4 Calendário/gráfico de Fluxos "Somente fluxos" with link | 13 |
| §4.4 Concluídas: tag "Post individual", one query per conta (no N+1), `refresh()` invalidates `concluded-*` | 14, 2, 6 |
| §4.4 Analytics unchanged; onboarding gates count every card kind | 6 (`activeBoardCount`), 15 |
| §5.4 header tag "Avulso · Sem processo" / "Individual · <etapa>" | 12 |
| §5.4 production section: origem, linha de etapas, responsável e prazo por etapa, estado, histórico; no reusable stepper; "Propriedades do template só valem dentro de um fluxo"; fetch only when `workflowId == null` and open | 12 |
| §5.4 "Responsável do post" in all drawers | 12 (flag-independent, named in Global Constraints) |
| §5.4 `buildPostTimeline` third source, `kind: 'process'`, popover "Histórico" | 11 |
| §7 `etapaDeadlineDateOf` extended for `prazo_efetivo`; badge adapter in `getDeadlineInfo` shape; "Sem responsável" | 3, 4, 8 |
| §8.3 `BoardEntity` union, ids `workflow:<id>`/`post:<id>`, common projection; Kanban+Lista consume it, Calendário/Gráfico stay workflow-only; unify `BoardRow` and duplicate card shape; never a fake `Workflow` | 4, 5, 8, 9 |
| §8.3 `getActivePostProcesses(contaId)` one embed query with `POST_CONTEXT_COLUMNS`; drawer loads events on demand | 2 (`getVigentePostProcesses`, ativo+concluido in one batch as the advisor and §4.3/§4.4 require), 12 |
| §9.4 fingerprint TS mirror + Vitest parity with the SQL fixtures | 1 |
| §9.6 invalidations (`post-processes`, `concluded-*`, ...) on the read side | 6, 12, 14 |
| §11 flag `feature_post_processes` read via `useWorkspaceLimits`; merge with flag off | 6 + every gated task |
| §12 Validação (Vitest): `BoardEntity` + mixed board composition, entidade filter + `viewQuery`, `etapaDeadlineDateOf` with `prazo_efetivo` | 4/5/8, 7, 3 (`approvalAdvance.ts`, dialogs, rollback, error mapping are fase 4) |

Gaps found and fixed during this pass: the `entidade` URL-off assertion used `window.location` under `MemoryRouter` (replaced by the `viewQuery` guarantee); `SemProcessoSection` in the page suite needs a `useStatusRegistry` mock (made unconditional); the drawer-section test's date and "Aprovação do cliente" assertions were exact-string and brittle (regexes now); the "Responsável do post" assertion needed `membros` (added to `renderDrawer`).

**2. Placeholder scan**

No "TBD", "TODO", "implement later", "add validation", "handle edge cases", or "similar to Task N". Every code step carries the code. One conditional instruction remains on purpose and is concrete: Task 4 Step 4 (remove only the store imports lint flags after deleting the duplicate `BoardCard`). All `import` lines shown in "append to test" snippets belong in the file's existing top-level import block (ES imports are top-level declarations; `eslint-plugin-import` rejects them mid-file).

**3. Type and name consistency across tasks**

- `PostProcess`, `PostProcessStep`, `PostProcessWithPost`, `PostProcessEvent`, `getVigentePostProcesses`, `getVigentePostProcess(postId)`, `getPostProcessEvents(postIds: number[])` (Task 2) are the only store names used in Tasks 4, 6, 11, 12, 14 and in every test mock (`getVigentePostProcess`, `getPostProcessEvents`, `getVigentePostProcesses`).
- `EtapaDeadlineFields.prazo_efetivo`, `deadlineFromPrazoEfetivo(prazoEfetivo, fallbackDias, now?)`, `DeadlineInfo`, `matchesDeadlineFilter(target, presets, from, to, now?)` (Task 3) match their uses in Tasks 4 and 8 (`entityFilters.ts`).
- `BoardEntity`/`WorkflowEntity`/`PostEntity` fields (`kind`, `id`, `card`/`process`+`step`, `templateId`, `steps`, `etapaOrdem`, `etapaNome`, `responsavel`, `prazoEfetivo`, `posicao`, `deadline`, `cliente`, `titulo`, `clienteAvatarUrl?`, `cover?`), `toWorkflowEntity(ies)`, `toPostEntity(process, ctx)`, `stageSignature`, `sortEntitiesByPrazo`, `sortEntitiesByPosicao`, `entityNumericId`, `isPostEntity` (Task 4) are used with those exact names in Tasks 5, 6, 8, 9, 10 and every fixture.
- `BoardColumn.posts`, `BoardRow.templateId`, `buildBoardRows(entities, templates, { signatureRows })`, `findCardColumn(id, rows)` (Task 5) match Task 8; `fullColumnOrder(..., signatureRows = false)` (Task 5) matches Task 8's calls.
- Hook return `postEntities`, `processByPostId`, `concludedPostProcesses`, `activePostProcessCount` and option `postProcessesEnabled` (Task 6) match Tasks 7, 8, 10, 13 and the page-test mocks.
- `EntidadeFilter`, `EntregasViewState.entidade`, `loadLastEntidade`, `persistLastEntidade`, `hasLastMode`, `EntidadeToggle`, `effectiveEntidade` (Task 7) match Tasks 8, 10.
- KanbanView props `postEntities`, `postProcessesEnabled`, `onPostClick`; ListView props `postEntities`, `onPostClick`; `handlePostEntityClick(entity: PostEntity)` (Tasks 8, 9) match the page wiring.
- `selectSemProcessoPosts`, `productionFiltersActive`, `SEM_PROCESSO_LIMIT`, `SemProcessoSection` props (`posts`, `total`, `productionFiltersActive`, `onPostClick`, `onVerTodos`) (Task 10) match the page wiring.
- `buildPostTimeline(post, events, approvals, processEvents?)`, `processEventLabel`, `TimelineNode.kind` including `'process'`, `PostTimelinePopover.processEvents?` (Task 11) match Task 12's `PostProductionSection` and the WorkflowDrawer wiring.
- `PostEditorBodyProps.postProcess?: PostProcess | null`, `PostProductionSection({ process, postId, membros })`, query keys `['post-process', postId]` and `['post-process-events', String(postId)]` (Task 12) match Task 6's invalidation list.
- `processEtapaByPostId?: Map<number, string>` and `postProcessesEnabled`/`onGoToKanban` (Task 13), `ConcludedView({ onOpenPost })` (Task 14), `ComoFuncionaPanel.postProcessesEnabled`, `TOUR_STEP_DEFS_POST_PROCESSES`, `startEntregasTour({ ..., postProcesses })` (Task 15) match the page wiring.
- Known import cycle introduced by Task 6: `useEntregasData.ts` → `boardEntity.ts` → `etapaPrazo.ts` → `useEntregasData.ts` (`computeDeadlineDate`). It is safe because every cross-module reference is used inside function bodies at render time, never at module evaluation; if vitest reports the cycle, move `computeDeadlineDate`/`subtractDays` into a new `prazoMath.ts` re-exported from the hook (mechanical, no behaviour change).

**Deviations from the original draft header, made deliberately**

- The draft's Architecture said `boardRows.ts` was a new file; PR #478 created it, so the plan extends it.
- The draft's row-identity constraint applied the signature key unconditionally ("replaces KanbanView's `stepNames.join(' → ')` fallback"); the plan puts it behind `signatureRows` (= the flag) because applying it flag-off would split every template row whose flows carry divergent step snapshots into tabs for real workspaces today, contradicting the byte-for-byte constraint.
- Two flag-independent changes are allowed and named (label "Responsável do post"; `refresh()` invalidations) instead of the draft's absolute "every pixel gated" phrasing.
