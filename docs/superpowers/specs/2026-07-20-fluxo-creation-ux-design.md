# Fluxo Creation UX — Wizard com Galeria de Modelos + Tour da página Entregas

**Date:** 2026-07-20
**Status:** Revised after code review (r2) — all findings resolved; pending final approval
**Branch:** `claude/fluxo-creation-ux-8a5de4`

## Problem

Creating a fluxo is the biggest onboarding pain point. The current `NewWorkflowModal`
([WorkflowModals.tsx](../../../apps/crm/src/pages/entregas/components/WorkflowModals.tsx)) asks for
everything in one 700px form: título, cliente, a template dropdown (offered before the user knows
what a template is), "Modo de Prazo" (three modes, one requiring an anchor etapa plus a client
setting), a recurrence checkbox, and an inline drag-and-drop etapa builder where "Aprovação externa"
is an unexplained checkbox — despite being the feature that powers the client portal approval.
Validation fires only as submit-time toasts. Templates are authored in a separate modal with no path
from fluxo → template, so users never internalize the fluxo/template distinction. New accounts start
with zero templates and a blank etapa list. The Entregas Kanban gives first-time users no clue what
a card is or that posts live inside it.

Additionally, agencies that require **two client approvals** (copy, then art) already run this flow
today via a manual workaround: after the first approval they reset post statuses back to rascunho so
the second approval etapa re-triggers the portal flow. The system treats client approval as
post-level state (`workflow_posts.status`), so without that reset a second `aprovacao_cliente` etapa
silently auto-advances ([KanbanView.tsx:356](../../../apps/crm/src/pages/entregas/views/KanbanView.tsx),
`CLIENT_CLEARED_STATUSES` in [posts.ts](../../../apps/crm/src/store/posts.ts)).

## Goals

1. Make the first fluxo creatable in under a minute without understanding templates first
   (bulk assignee assignment makes this real — see Step 3).
2. Teach fluxo vs. template implicitly (gallery + "salvar como template" at the end).
3. Make external approval — including **multiple approval etapas per fluxo** — a visible, explained
   choice that actually works, by automating the existing revert workaround (see *Approval cycle
   re-arm*).
4. Teach the Entregas page (cards, etapas, posts, portal) via an example card + guided tour.

## Non-goals

- No data-model changes. `workflows`, `workflow_etapas`, `workflow_templates`, `workflow_posts`
  stay as-is; no migrations, no edge-function changes, no Hub changes.
- No full stage-aware approval mechanics (per-etapa approval records/labels, per-cycle portal
  views). The re-arm automation below is deliberately the *minimal* mechanics change — the same
  status reset users perform manually today. A richer per-etapa approval model is a future
  initiative.
- No changes to `TemplatesModal` management UI (it remains the place to edit/delete saved templates
  and manage Propriedades) beyond consuming the extracted `SortableEtapaList`.
- No change to the `data_entrega` anchor rule (first `aprovacao_cliente` etapa anchors) — the wizard
  surfaces it instead of changing it.

## Decisions (validated with the user)

| Decision | Choice |
|---|---|
| Entry point | One "Novo Fluxo" button opens the wizard; gallery is step 1; legacy `NewWorkflowModal` is **deleted** |
| Presets storage | **Code-defined** in `presets.ts` (no seeded DB rows); become account templates only via opt-in save |
| Multiple approvals | **Supported, via automated re-arm** of the existing manual workaround (post-status reset); full stage-aware approvals deferred |
| Tour engine | **driver.js** (~5 kB, MIT), styled via CSS variables |
| Scope | Both slices in this spec; implemented as two PRs — Slice A (wizard + re-arm) first, Slice B (tour) second |

## Approval cycle re-arm (enables multiple approval etapas)

Today's mechanics, confirmed in code:

- Advancing a card on an `aprovacao_cliente` etapa shows the `ClientApprovalChoiceDialog` only when
  **not** all posts are "cleared" (`aprovado_cliente` / `agendado` / `postado` / `falha_publicacao`).
  After a first approval cycle, all posts are cleared, so a second approval etapa advances silently
  with no dialog.
- `sendPostsToCliente` only moves `aprovado_interno` posts, so already-approved posts cannot be
  re-sent without a manual status reset.

**Change:** a new store function `resetApprovedPostsForNextCycle(workflowId)` — updates
`workflow_posts` with `status = 'rascunho'` where `status = 'aprovado_cliente'` (never touching
`agendado` / `postado` / `falha_publicacao`). The shared etapa-advance logic calls it when **both**:

1. the etapa being completed has `tipo === 'aprovacao_cliente'`, and
2. a later etapa (higher `ordem`) with `tipo === 'aprovacao_cliente'` exists in the workflow.

Applies on these advance paths (Kanban drag, forward button, and the drawer's advance control —
all route through the same helper):

- **"Aprovar internamente"** → approve + complete etapa + re-arm.
- **Silent all-cleared advance** (the path that breaks today) → complete etapa + re-arm.
- **"Avançar etapa sem alterar posts"** keeps its literal contract: no post changes, no re-arm.
- **"Enviar ao portal"** doesn't complete the etapa (unchanged) — no re-arm.

On re-arm, toast: *"Posts voltaram para rascunho para o próximo ciclo de aprovação."* When a later
approval etapa exists, the `ClientApprovalChoiceDialog` also shows a one-line note explaining this
will happen. Approval history in `post_approvals` is untouched (records persist across cycles —
same as the manual workaround).

Display logic: `WorkflowCard`'s "posts com o cliente" badge keys off the *first* approval etapa's
`ordem` (`allEtapas.find(...)`), which remains correct under re-arm — during a second cycle the
current etapa's ordem is still greater than the first approval's ordem, so awaiting/aguardando
badges render. Covered by a dedicated test; no display changes required.

## Slice A — Creation wizard with template gallery

### File layout

```
apps/crm/src/pages/entregas/
  wizard/
    NewWorkflowWizard.tsx     — dialog shell, step state, navigation, requestClose()
    steps/StepTemplate.tsx    — gallery: presets + account templates + "do zero"
    steps/StepBasics.tsx      — cliente, nome, recorrente
    steps/StepEtapas.tsx      — suggestion chips + bulk assign + sortable etapa list
    steps/StepPrazos.tsx      — modo de prazo radio cards + mês de entrega
    steps/StepReview.tsx      — summary + salvar-como-template
    presets.ts                — WorkflowPreset type + STANDARD_PRESETS
    createWorkflow.ts         — creation sequencing (template-first) + orphan cleanup
  components/
    SortableEtapaList.tsx     — extracted from WorkflowModals.tsx (shared with TemplatesModal)
```

`WorkflowModals.tsx` loses `NewWorkflowModal` and `SortableEtapaList`/`SortableEtapaRow`
(~330+ lines); `EntregasPage` renders `NewWorkflowWizard` instead. The keyboard-DnD sensor
(`KeyboardSensor`) must keep working in the extracted list.

### Wizard state & navigation

State lives in one `WizardState` object in `NewWorkflowWizard`; steps are controlled components.
Each step validates inline and gates "Continuar" — no submit-time toast validation. Dialog is
full-screen at ≤768px.

**Source switching:** returning to step 1 and picking a different source **replaces** the dependent
state (etapas, modo_prazo, recorrente) with the new source's values and re-suggests the nome —
unless the user manually edited the nome, which is then preserved. Cliente is always preserved.

**Close confirmation:** a single `requestClose()` path guards every close route — the dialog X
button, Escape, overlay click, the Cancelar button, and controlled `onOpenChange(false)`. This
requires a small fix to the shared [dialog.tsx](../../../apps/crm/src/components/ui/dialog.tsx):
the built-in `DialogPrimitive.Close` (X) currently bypasses the `confirmClose` guard that
Escape/outside-click respect — its click must route through the same `handleConfirmTrigger`
(`preventDefault` + confirm when dirty). The guard is active when the wizard has any progress
(`confirmClose={isDirty}`). All five paths get RTL tests.

### Wizard steps

**Step 1 · Como começar.** Microcopy header: *"Um fluxo é um ciclo de trabalho para um cliente
(ex.: posts de agosto). Um template é a receita reutilizável de etapas."* Card grid of the 6
standard presets (icon, nome, etapa chips with approval etapas highlighted, `N etapas · ~X dias`,
badges "Aprovação externa"/"2 aprovações externas"/"Recorrente"), then "Seus templates" (account's
saved templates, `created_at` desc), then a dashed "Começar do zero" card. Selecting any card
advances to step 2 immediately, pre-filling per the source (see prefill rules below).

**Step 2 · O básico.** Cliente (required; active clients sorted pt-BR — same as today), nome
(required; auto-suggested as `"<source nome> — <next month, capitalized pt-BR> <year>"`, editable),
recorrente toggle with explainer: *"Ao concluir todas as etapas, o Mesaas oferece criar o próximo
ciclo automaticamente."*

Prefill rules (resolves review finding 3 — `WorkflowTemplate` has no `recorrente` field):

- **Presets** prefill etapas, modo_prazo, **and** recorrente.
- **Account templates** prefill etapas and modo_prazo; recorrente keeps the wizard default
  (`false`) or whatever the user already toggled.
- **Salvar como template** does *not* persist recorrente (documented limitation; adding a
  `recorrente` column to `workflow_templates` is a possible future migration, out of scope).

**Step 3 · Etapas.** Three zones:

- *Etapas sugeridas* — chips: Briefing, Roteiro, Redação, Criação, Design, Revisão interna,
  Aprovação do cliente, Ajustes, Agendamento, Publicação, Relatório, plus "＋ Personalizada"
  (appends a blank etapa row for the user to name). Chip identity is a stable `suggestionId`
  carried on the etapa row (`EtapaFormData.suggestionId?`), **not** the display name: toggling ON
  appends a row bound to that id; toggling OFF removes that row even if renamed; rows the user
  deleted directly show the chip unselected; custom/template rows without a matching suggestion
  have no `suggestionId`. Source etapas map to suggestionIds by name at load time only.
- *Atribuir todas a…* — bulk-assign select that sets the responsável on every etapa at once
  (per-row selects remain editable after). This is what keeps preset creation under a minute.
- *Ordem, responsáveis e aprovações* — the sortable list (drag to reorder; rename; prazo + tipo;
  responsável select). **Every row has an "Aprovação externa" pill toggle** (replaces today's bare
  checkbox); any number of approval etapas is allowed (see re-arm). Approval rows render visually
  distinct (blue tint) with an explainer note: the etapa sends posts to the client's Hub portal.

Validation (inline, gates Continuar): ≥1 named etapa; every etapa has a responsável **that exists
in the current membros list** — a stale id from an old template renders a per-row error
("Responsável não existe mais — selecione outro") instead of passing non-null validation and being
silently nulled at insert (current bug: non-null check at
[WorkflowModals.tsx:382](../../../apps/crm/src/pages/entregas/components/WorkflowModals.tsx) passes,
then sanitize at insert nulls it). The insert-time sanitize stays as defense in depth.
`PrerequisiteAlert` + `EmptyStateGuide` when the account has no members (existing components).

**Step 4 · Prazos.** Radio cards (not a select):

- *Duração por etapa* — default for most presets.
- *Datas fixas* — reveals per-etapa date inputs in the list (same `data_fixa` semantics as today).
- *Data de entrega do cliente* — badge "Recomendado" when the fluxo has ≥1 approval etapa AND the
  selected client has `dia_entrega`.

Availability & fallback (resolves finding 8):

- Client lacks `dia_entrega` → the data_entrega card is **disabled**, showing the reason inline
  with a link to the client detail page ("Configurar dia de entrega").
- Source prefers data_entrega but it's unavailable → the wizard **auto-selects padrao** and shows a
  visible notice on the step ("Modo ajustado para Duração por etapa — o cliente não tem dia de
  entrega configurado.").
- Changing the client in step 2 re-evaluates: if the user hasn't manually chosen a mode, the source
  preference is re-applied; if they have, their choice is kept unless now-invalid, in which case the
  card disables and Continuar is blocked with the inline error until a valid mode is picked.
- No approval etapa in the fluxo → data_entrega card disabled with the anchor explanation.
- **≥2 approval etapas** → inline warning: the *first* approval etapa anchors the delivery date.
- Mês de Entrega keeps today's exact contract: default "Próximo mês disponível" resolves via
  `getNextDeliveryDate` (which may be the **current** month when the client's delivery day hasn't
  passed yet); the explicit list is current month + next 5 (6 options).

**Step 5 · Revisar e criar.** Summary rows (cliente, nome, nº etapas + nº aprovações, modo de
prazo/data, recorrente). Checkbox *"Salvar estas etapas como template"* + name input (default:
`"<source nome> — <cliente nome>"` for presets, source name otherwise). Primary button "Criar
Fluxo".

### Creation sequencing (`createWorkflow.ts`) — template-first

Resolves review finding 2 (the previous draft promised a `template_id` that didn't exist yet):

1. If "salvar como template" is checked: `addWorkflowTemplate` **first**.
   - On failure: set a warning, continue with no saved template. A template failure never blocks or
     rolls back fluxo creation.
2. `addWorkflow` with `template_id` = (newly saved template)?.id ?? (source account template)?.id ??
   `null` (presets and "do zero"), then sequential `addWorkflowEtapa` (first etapa `ativo` +
   `iniciado_em: now`; `data_limite` per mode via `computeDeliveryDeadlines` for `data_entrega` /
   user dates for `data_fixa`; membro-id sanitize as defense).
3. On etapa-insert failure: remove the orphaned workflow (best-effort) and rethrow — the saved
   template from step 1 is **kept** (it's independently useful; the user can retry from it).

Helper signature: `createWorkflowFromWizard(state): Promise<{ workflow, template?, warning? }>`.
The wizard surfaces `warning` as a distinct toast after the success toast. No `updateWorkflow`
back-link step exists, so there is no link-failure state to handle.

### Standard presets (`presets.ts`)

```ts
interface WorkflowPresetEtapa {
  nome: string;
  prazo_dias: number;
  tipo_prazo: 'uteis' | 'corridos';
  tipo: 'padrao' | 'aprovacao_cliente';
}
interface WorkflowPreset {
  id: string;                    // stable slug, used in analytics
  nome: string;
  descricao: string;
  icon: LucideIcon;
  recorrente: boolean;
  modo_prazo: 'padrao' | 'data_fixa' | 'data_entrega';
  etapas: WorkflowPresetEtapa[];
}
```

Presets never carry `responsavel_id` (account-specific; assigned in step 3 via bulk or per-row).

| id | nome | icon | recorrente | modo_prazo | etapas (prazo, tipo) |
|---|---|---|---|---|---|
| `posts-mensais` | Posts mensais | CalendarDays | ✔ | data_entrega | Criação (4 úteis) · Revisão interna (1 útil) · **Aprovação do cliente** (3 corridos) · Ajustes (2 úteis) · Agendamento (1 útil) |
| `aprovacao-dupla` | Aprovação dupla (texto + arte) | PenLine | ✔ | padrao | Redação (3 úteis) · **Aprovação do texto** (2 corridos) · Design (3 úteis) · **Aprovação da arte** (2 corridos) · Ajustes finais (1 útil) · Agendamento (1 útil) |
| `reels-video` | Reels / vídeo | Clapperboard | — | padrao | Roteiro (2 úteis) · Gravação (2 úteis) · Edição (3 úteis) · **Aprovação do cliente** (2 corridos) · Publicação (1 útil) |
| `campanha-lancamento` | Campanha / lançamento | Rocket | — | padrao | Planejamento (3 úteis) · Criativos (4 úteis) · Revisão (1 útil) · **Aprovação do cliente** (2 corridos) · Veiculação (3 úteis) · Relatório (2 úteis) |
| `post-avulso` | Post avulso rápido | Zap | — | padrao | Criação (2 úteis) · Revisão (1 útil) · Publicação (1 útil) |
| `identidade-branding` | Identidade / branding | Palette | — | padrao | Pesquisa (5 úteis) · Proposta (5 úteis) · **Aprovação do cliente** (3 corridos) · Refinamento (4 úteis) · Entrega final (2 úteis) |

Bold = `tipo: 'aprovacao_cliente'`. The `aprovacao-dupla` preset relies on the re-arm mechanism
above and ships in the same PR.

### Analytics (PostHog)

The five new event names are added to the closed `AnalyticsEvent` union in
[analytics.ts](../../../apps/crm/src/lib/analytics.ts) (finding 10) and covered by its tests:

- `workflow_created` — unchanged (fired via `onCreated`).
- `workflow_wizard_source` — `{ source: '<preset-id>' | 'template' | 'zero' }`, fired **once per
  successful creation** with the final source (not on each step-1 selection; funnel-abandon
  analysis is a non-goal).
- `workflow_saved_as_template` — when the review-step checkbox results in a saved template.
- `entregas_tour_started` / `entregas_tour_completed` / `entregas_tour_dismissed` (Slice B;
  dismissed carries `{ step }`).

## Slice B — Example board + guided tour (Entregas)

### ExampleBoard

Rendered by `KanbanView` in place of the "Nenhuma entrega encontrada" empty state when
(a) the conta has **zero active workflows** (`activeWorkflows.length === 0` from
`useEntregasData` — not merely zero *filtered* cards; a filtered-empty board keeps today's
message) and (b) the tour/example was not dismissed. Accounts whose workflows are all
concluded/archived may see it once; dismissing persists. Static component reusing the real board
CSS classes (`board-column`, `board-column-header`, card styles): columns Criação → Revisão
interna → Aprovação do cliente → Ajustes, one example card ("Posts de Agosto", "Cliente Exemplo",
deadline pill, posts count, responsável) with an "EXEMPLO" badge. No DB row, no drag, no
click-through to drawer. Includes a dismiss control ("Ocultar exemplo") that sets the same
localStorage key as tour completion.

### Tour (driver.js)

`tour/entregasTour.ts` exports a **step builder**, not a static config: at tour start, steps are
constructed from the selectors that actually resolve in the DOM — any step whose target is absent
is omitted (finding 6). Auto-starts on first Entregas visit when the ExampleBoard is shown.

**Replay** ("Ver tour novamente" from the header Info icon): if the board has no real cards, the
ExampleBoard is **temporarily rendered for the duration of the tour** (ephemeral React state — the
localStorage key is not cleared). With real workflows, steps anchor to the first real card/column
via the same `data-tour` attributes; e.g. a board with no approval column simply skips step 5.

Steps (each conditional on its target):
1. `[data-tour="wf-card"]` — *card de fluxo*: um ciclo de trabalho de um cliente; avança pelas colunas.
2. `[data-tour="wf-deadline"]` — prazo e etapa atual (pílulas de deadline).
3. `[data-tour="wf-posts"]` — os posts vivem dentro do card; clique para abrir o drawer e criar posts.
4. `[data-tour="wf-card"]` — arraste para a próxima coluna para avançar a etapa.
5. `[data-tour="wf-col-aprovacao"]` — a coluna de Aprovação envia os posts ao portal do cliente.
6. `[data-tour="novo-fluxo-btn"]` — crie seu primeiro fluxo (fechar o tour aqui pode abrir o wizard).

`data-tour` attributes live on both the ExampleBoard and the real `WorkflowCard` / column headers /
"Novo Fluxo" button. Persistence: `localStorage` key `entregas_tour_done_{conta_id}` (mirrors
`OnboardingBanner`); completing, skipping, or dismissing the ExampleBoard all set it. driver.js
popover styled with CSS variables (dark surface, `--primary-color` accents) in both themes.

## MCP compatibility

Verified against `supabase/functions/mcp/` — no MCP changes are required:

- **`create_workflow`** ([queries.ts](../../../supabase/functions/mcp/queries.ts)) instantiates
  account templates (including wizard-saved ones) — the save-as-template path *increases* what
  agents can do. It hardcodes `recorrente: false` / `modo_prazo: 'padrao'` (pre-existing,
  unchanged).
- **`create_workflow_template`** already accepts multiple `aprovacao_cliente` etapas; with re-arm,
  such templates become genuinely functional instead of silently broken. Schema unchanged.
- The re-arm logic lives in the CRM advance path; the MCP server has **no etapa-advance tool**, so
  agents cannot bypass it.
- Code-defined presets are invisible to `list_workflow_templates` until saved as an account
  template — accepted trade-off (unchanged).

## Error handling

Same semantics as today plus the sequencing above: orphaned-workflow cleanup on partial etapa
failure; generic error toasts (no raw error details); template-save failure produces a warning
without blocking creation; re-arm failure after etapa advance surfaces a toast asking the user to
reset post statuses manually (the etapa advance itself is not rolled back).

## Testing

- `presets.test.ts` — every preset has ≥1 named etapa; every `data_entrega` preset contains an
  `aprovacao_cliente` etapa; ids unique.
- **Re-arm:** completing an approval etapa with a later approval etapa resets `aprovado_cliente` →
  `rascunho` and leaves `agendado`/`postado` untouched; the approval dialog re-appears at the
  second approval etapa; "Avançar sem alterar posts" performs no reset; no reset when no later
  approval etapa exists; `WorkflowCard` badges render correctly during a second cycle.
- Wizard RTL: step gating (cliente/nome required; etapa/responsável rules), preset selection
  pre-fills etapas + modo + recorrente + suggested name, account-template selection does *not*
  set recorrente, chips add/remove by `suggestionId` (rename-safe), bulk "Atribuir todas a…",
  multiple approval toggles allowed, **stale/deleted template assignee id → inline per-row error**,
  step-4 matrix (missing dia_entrega disables card + auto-fallback notice; client switch
  re-evaluation; multi-approval anchor warning; month options = próximo disponível + current month
  + 5), review step sequencing (template-first: **template failure still creates the workflow with
  a warning; etapa failure removes the orphaned workflow but keeps the saved template**),
  back-navigation source switch replaces etapas/modo/recorrente without leaking preset state,
  user-edited nome survives source switch.
- **Close paths:** all five (X, Escape, overlay click, Cancelar, controlled `onOpenChange(false)`)
  trigger the confirm guard when dirty — including the shared `dialog.tsx` X-button fix.
- ExampleBoard: renders only when `activeWorkflows.length === 0` and key unset; **filtered-empty
  board never shows it**; dismiss sets key.
- Tour: replay with zero workflows temporarily renders ExampleBoard; step builder omits steps with
  missing targets (e.g. real board without an approval column skips step 5) — tested against a
  mock DOM; selector/step-count unit test.
- Update existing suites that reference `NewWorkflowModal` (`EntregasPage.test.tsx`,
  `WorkflowModals.test.tsx`) and the analytics union test — contract changes, grep both apps'
  `__tests__` (per project convention, also `supabase/functions/__tests__` — no changes expected
  there since MCP contracts are untouched).
- jsdom can't drive driver.js positioning — visual tour behavior verified in the browser.

## Dependencies

- `driver.js` (MIT, ~5 kB gzip) — pin an exact aged version (Deno CI min-dep-age gotcha applies to
  fresh npm releases).

## Rollout

Two PRs, no feature flag (CRM-internal UX; fluxo creation is available on all plans today and
stays that way):

1. **PR A** — approval re-arm + wizard + presets + `SortableEtapaList` extraction + `dialog.tsx`
   X-button guard fix + `NewWorkflowModal` removal + analytics union.
2. **PR B** — ExampleBoard + driver.js tour (step builder + replay) + Info-icon re-trigger.

## Risks / notes

- Re-arm resets post *status* only; nuance: a post the client approved in cycle 1 shows as
  rascunho again until re-approved in cycle 2. This matches the manual workaround users already
  run; `post_approvals` history preserves cycle-1 records.
- `data_entrega` anchor = first approval etapa (`workflows.ts` `_computeDeliveryDeadlines`,
  `duplicateWorkflow`). Not changed; surfaced in step 4. A future "choose anchor etapa" option is
  out of scope.
- `propagateTemplateToWorkflows` only applies to template *edits* in `TemplatesModal`;
  wizard-created fluxos keep today's behavior (linked via `template_id` when applicable).
- Keyboard DnD (existing `KeyboardSensor`) must keep working in the extracted `SortableEtapaList`.
