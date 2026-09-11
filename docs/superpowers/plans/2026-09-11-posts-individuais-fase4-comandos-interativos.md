# Posts individuais — Fase 4 (comandos interativos) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire the CRM to the seven fase-2 RPCs that already exist in production (`detach_posts_keeping_process`, `apply_post_process`, `transition_post_process`, `update_post_process_step`, `remove_post_process`, `attach_post_closing_process`, `reorder_fluxos_board`) so an agency can desmembrar mantendo etapas, aplicar um processo a um avulso, avançar/voltar/concluir/reabrir/remover um processo individual, editar responsável e prazo de etapa, vincular um post com processo a um fluxo, and reorder a mixed Fluxos column — with optimistic UI, rollback on failure, PT-BR toasts per error code, and the flag `feature_post_processes` gating **creation only**.

**Architecture:** Pure frontend phase: zero migrations, zero new RPCs, zero edge-function changes (research confirmed all 47 error codes and all guard triggers are live since fase 1/2, and `hub-approve`/`hub-posts` already behave correctly under the creation-only flag model). `store/postProcesses.ts` (today read-only) gains one thin wrapper per RPC, all routed through the now-exported `callRpcWithDeadlockRetry`; a new pure module `postProcessErrors.ts` maps every code the UI can reach to Portuguese copy; `approvalAdvance.ts` extracts the fluxo approval decision tree that lives in three places today and feeds both the fluxo callers and the new single-post variant; a hook `usePostProcessCommands` owns the transition/remove/reabrir dialogs and is shared by the drawer header, the Kanban post card and Concluídas; three dialogs (`DetachPostsDialog`, `ApplyProcessDialog`, the confirmation step inside `AttachToFluxoDialog`) cover creation and vinculação; `KanbanView` learns to persist a mixed column through `reorder_fluxos_board` and to drag post cards. The flag stops gating reads (PO decision 1): display derives from data presence, creation affordances derive from the flag.

**Tech Stack:** React 19, TanStack Query v5, TypeScript, Vitest + Testing Library, dnd-kit (existing), lucide-react, shadcn `Dialog`/`AlertDialog`/`Select`/`month-picker`. Deno/Supabase CLI only for the two verification tasks. No new dependencies.

## Global Constraints

- **Flag semantics change in this phase (PO decision 1, 2026-09-11; spec §11 + §12.18; fase-2 Decision 9).** Two invariants replace fase 3's "flag off fires no `post_processes` query":
  - (a) **Flag off + zero processes = byte-for-byte what fase 3 renders today** (same DOM, same URL, same localStorage keys). The only new network call is the vigente-process batch (`getVigentePostProcesses`, one RLS-scoped query returning zero rows) and the drawer's `getVigentePostProcess(postId)`; both are cheap and both existed behind the flag already.
  - (b) **Flag off + existing processes = fully visible and fully operable, creation hidden.** Cards, drawer section, Concluídas entries, Publicações tags, timelines, and every mutation on an EXISTING process (avançar, voltar, concluir, reabrir, remover, editar etapa, vincular, reorder) work regardless of the flag. Exactly three creation affordances read the flag: the "Aplicar processo" buttons (drawer header + Sem processo), the "Manter etapas" option of the detach dialog, and the "Sem processo" section itself. Two copy variants also stay on the raw flag because they only matter when there is no process to show: the drawer tag ("Avulso · Sem processo" with the flag vs "Avulso" without, `StandalonePostDrawer.tsx:478`) and the Concluídas empty-state string (`ConcludedView.tsx:168`). Nothing else may read `features?.feature_post_processes`.
  - The derived boolean is named **`postProcessesVisible`** (`= postProcessesEnabled || vigenteProcesses.length > 0`, computed once in `useEntregasData`); the raw flag keeps its fase-3 name **`postProcessesEnabled`**. Display gates that fase 3 keyed on `postProcessesEnabled` (EntidadeToggle, `signatureRows`, `effectiveEntidade`, header count, empty-state copy, tour/explainer copy) move to `postProcessesVisible` in Task 3. `WorkflowDrawer.tsx:305`'s `post-process-events` gate is removed too (encerrado-process history for a post that went back into a fluxo is history, not creation). `PostEditorBody.tsx:88`'s prop doc ("só com feature_post_processes") is rewritten in the same task.
  - Three fase-3 tests are flipped (not deleted) in Task 3: `hooks/__tests__/useEntregasData.test.ts:516` ("com a flag desligada não consulta post_processes"), `components/__tests__/StandalonePostDrawer.test.tsx` ("flag desligada mantém a tag "Avulso" e não consulta o processo"), `views/__tests__/ConcludedView.test.tsx` ("flag desligada: não consulta processos").
- **Every mutation follows spec §9.6.** Optimistic update → RPC → on failure: revert the optimistic state, `toast.error(getPostProcessErrorToast(err, fallback))`, and for stale-state codes (`workflow_changed`, `process_changed`, `post_changed`, `template_changed`, `request_mismatch`, `post_has_active_process`, `post_in_workflow`) also refetch. Never present partial success as total. Every UI task carries (1) a flag-off test and (2) a rollback test: optimistic state applied → RPC mock rejects → state reverted, `toast.error` called with the mapped copy, no success toast.
- **Cache keys to invalidate per command** (spec §9.6, matching `useEntregasData().refresh()` at `hooks/useEntregasData.ts:446-467` and `StandalonePostDrawer.refresh()` at `components/StandalonePostDrawer.tsx:194-205`): `['post-processes']`, `['post-process', postId]`, `['post-process-events']`, `['post-process-covers']`, `['active-posts']`, `['standalone-post', postId]`, `['workflows']`, `['all-active-etapas']`, `['workflow-posts-counts']` and the four sibling count keys, `['workflow-events']`, `['concluded-workflows']`, `['concluded-summaries']`, `['scheduled-posts']`, `['clientePosts', clienteId]`. A command calls the page-level `onRefresh()`/`refresh()` it has access to AND invalidates the drawer-scoped keys it knows.
- **Deadlines are computed by the CRM, stored by the RPC (spec §7).** `p_active_deadline`, `p_step_deadlines`, `p_step_overrides[].prazo_efetivo` and `p_next_deadline` are ISO instants built with `computeDeadlineDate` (`hooks/useEntregasData.ts:72`) and the new `endOfLocalDay`/`toLocalISODate` helpers (Task 6). `p_next_deadline` is sent only on `avancar`, only when the next `pendente` step has `prazo_dias != null` and `prazo_efetivo == null`; never on `voltar`, `concluir`, `reabrir`. Never `toISOString().split('T')[0]` for a calendar day.
- **RPC contracts are the fase-2 signatures, verbatim** (`supabase/migrations/20260919000003..8`). `p_step_overrides` keys are digit strings (`'0'`, `'1'`…), values only `responsavel_id`/`prazo_efetivo`; template `ordem` = array index (same convention as `buildTemplateFingerprint`). `p_step_deadlines` keys are ordens strictly greater than the active ordem, and every future etapa with `data_limite` MUST have an entry (`step_deadline_required`). `p_request_id` is generated by the dialog and regenerated whenever the selection or the archive checkbox changes (both are in the server's `input_hash`; reusing an id with a different input → `request_mismatch`). `p_approval_choice` ∈ `aprovar_interno | sem_alterar` (Decision 13: "enviar ao cliente" is NOT a transition). `avancar` never concludes (`no_next_step`); `concluir` only when no later step is `pendente` (`pending_steps_remaining`) (Decision 12). `voltar` reopens the previous step by `ordem` regardless of its state (Decision 15).
- **Fingerprints come from `pages/entregas/fingerprint.ts`** (`buildFingerprint(workflow, etapas)`, `buildTemplateFingerprint(etapas)`), computed from the data the UI displays at the moment of confirmation. No hashing, no reformatting.
- **Store functions stay plain async** (no hooks in `store/`); components wrap them in handlers/`useMutation`. Never `useBlocker` in the apps (`installSilentUpdate` already registers one).
- **Verify before pushing:** `npm run lint`, `npm run format:check` (`npm run format` auto-fixes), the four `tsc` commands (`npx tsc -p apps/crm/tsconfig.json --noEmit`, `apps/hub`, `apps/admin`, `tsconfig.scripts.json`), `npm run test`. This phase touches no edge functions and no migrations, so `check:functions`, `test:functions`, `entitlement-tests` and `migration-version-guard` are unaffected but still run in CI; run `npm run check:functions` once anyway before opening the PR so the branch is proven green on all gates.
- **Copy rules:** Portuguese UI; no em-dashes in NEW user-facing copy (use period or colon). Pre-existing strings on untouched branches keep their em-dashes. The action is called **"Desmembrar do fluxo"** everywhere (spec §3).
- **Worktree hygiene:** run `npm ci` inside the worktree before Task 1 (`ls node_modules/.deno` must be empty; see memory `project_deno_npm_node_modules_gotcha`). `.env.staging` must exist in the worktree before Task 14/15 (`ls .env.staging || cp /Users/eduardosouza/Projects/sm-crm/.env.staging .env.staging`); it is gitignored and never committed. `supabase/config.toml` port overrides for the local stack (Task 14) are never committed.
- **Production stays dark.** Nothing in this plan flips `feature_post_processes` on any production workspace. Task 15 enables it for ONE staging workspace only. Turning it on in prod is a separate, explicit, user-authorized decision.

## File Structure

| File | Status | Responsibility |
|---|---|---|
| `apps/crm/src/lib/entitlement-errors.ts` | modify | `FEATURE_LABELS.feature_post_processes` |
| `apps/crm/src/pages/entregas/postProcessErrors.ts` | create | Error identifier → PT-BR toast; stale-state predicate |
| `apps/crm/src/store/posts.ts` | modify | Export `callRpcWithDeadlockRetry` |
| `apps/crm/src/store/postProcesses.ts` | modify | Seven RPC wrappers + result types (module stops being read-only) |
| `apps/crm/src/pages/entregas/hooks/useEntregasData.ts` | modify | Vigente batch always on; `postProcessesVisible`; timezone fix in `computeDeliveryDeadlines` |
| `apps/crm/src/pages/entregas/EntregasPage.tsx` | modify | Visible vs enabled split; reveal after desmembrar/aplicar; dialog wiring |
| `apps/crm/src/pages/entregas/views/ConcludedView.tsx` | modify | Batch always on; "Reabrir processo" |
| `apps/crm/src/pages/entregas/components/StandalonePostDrawer.tsx` | modify | Process query always on; header action buttons; Aplicar/Vincular wiring |
| `apps/crm/src/pages/entregas/components/WorkflowDrawer.tsx` | modify | Events query ungated; `DetachPostsDialog` replaces inline AlertDialog; auto-complete uses `decideApprovalAdvance` |
| `apps/crm/src/pages/entregas/components/PostEditorBody.tsx` | modify | Prop doc; `onProcessChanged` passthrough |
| `apps/crm/src/pages/entregas/boardReorder.ts` | modify | Generic ids (`T`) for mixed columns |
| `apps/crm/src/pages/entregas/views/KanbanView.tsx` | modify | Mixed-column reorder via `reorder_fluxos_board`; draggable post cards; post buttons |
| `apps/crm/src/pages/entregas/approvalAdvance.ts` | create | `decideApprovalAdvance`, `isClientCleared`, `hasLaterPendingApprovalStep` |
| `apps/crm/src/pages/cliente-detalhe/tabs/EntregasTab.tsx` | modify | Use `decideApprovalAdvance`; dialog prop rename |
| `apps/crm/src/pages/entregas/components/WorkflowModals.tsx` | modify | `entityTitle`/`entityKind`/`sendToPortalDisabledReason` on the three step dialogs |
| `apps/crm/src/utils/postDate.ts` | modify | `toLocalISODate`, `endOfLocalDay`, `parseLocalISODate` |
| `apps/crm/src/store/workflows.ts` | modify | Timezone fix in `_computeDeliveryDeadlines` |
| `apps/crm/src/pages/entregas/applyProcessDeadlines.ts` | create | Pure builder of `p_step_overrides` + preview + blockers |
| `apps/crm/src/pages/entregas/detachDeadlines.ts` | create | Pure builder of `p_active_deadline` + `p_step_deadlines` |
| `apps/crm/src/pages/entregas/hooks/usePostProcessCommands.tsx` | create | Shared transition/remove/reabrir handlers + their dialogs |
| `apps/crm/src/pages/entregas/components/PostProcessCard.tsx` | modify | Avançar/Voltar buttons + drag handle slot |
| `apps/crm/src/pages/entregas/components/PostProductionSection.tsx` | modify | "Cliente aprovou" hint; inline step editing |
| `apps/crm/src/pages/entregas/components/DetachPostsDialog.tsx` | create | Manter etapas / avulso sem etapas |
| `apps/crm/src/pages/entregas/components/ApplyProcessDialog.tsx` | create | Template, etapa inicial, responsáveis, prazos |
| `apps/crm/src/pages/entregas/components/SemProcessoSection.tsx` | modify | "Aplicar processo" action per card |
| `apps/crm/src/pages/entregas/components/AttachToFluxoDialog.tsx` | modify | Confirmation step; `attach_post_closing_process`; error case |
| `apps/crm/src/pages/entregas/revealFilters.ts` | create | Pure: which filters to clear to reveal a post entity |
| `apps/crm/src/store/__tests__/postProcesses.contract.test.ts` | create | Live RPC signature check (env-gated) |
| `apps/crm/style.css` | modify | `.post-production-actions`, `.post-production-hint`, `.board-card--post .btn-*` |

Out of scope, on purpose: the Publicações per-post kebab menu named in spec §5.2 does not exist today (`PostsKanbanView.tsx` only has a column-sort menu at 466-476); "Aplicar processo" ships in the drawer header and on the Sem processo cards. MCP, Hub, edge functions, migrations: untouched.

---

### Task 1: Error mapping module + `FEATURE_LABELS`

**Files:**
- Modify: `apps/crm/src/lib/entitlement-errors.ts:21-39`
- Create: `apps/crm/src/pages/entregas/postProcessErrors.ts`
- Test: `apps/crm/src/pages/entregas/__tests__/postProcessErrors.test.ts`
- Test: `apps/crm/src/lib/__tests__/entitlement-errors.test.ts` (extend; create if the folder lacks it)

**Interfaces:**
- Consumes: `mapEntitlementError(err)` / `entitlementMessage(e)` from `@/lib/entitlement-errors` (existing).
- Produces:
  - `export function getErrorIdentifier(err: unknown): string` — the `.message` string of a PostgREST/RPC error, or `''`.
  - `export const POST_PROCESS_ERROR_MESSAGES: Record<string, string>` — one PT-BR sentence per code of the fase-2 table (47 codes).
  - `export function getPostProcessErrorToast(err: unknown, fallback: string): string` — entitlement wording first (`plan_limit_exceeded:*`, `feature_disabled:*`), then the table, then `fallback`.
  - `export const STALE_STATE_CODES: ReadonlySet<string>` and `export function isStaleStateError(err: unknown): boolean` — `workflow_changed | process_changed | post_changed | template_changed | request_mismatch | post_has_active_process | post_in_workflow | post_already_in_flow`.
  - `FEATURE_LABELS.feature_post_processes = 'Processos individuais de produção'`.

- [ ] **Step 1: Write the failing tests**

```ts
// apps/crm/src/pages/entregas/__tests__/postProcessErrors.test.ts
import { describe, expect, it } from 'vitest';
import {
  getErrorIdentifier,
  getPostProcessErrorToast,
  isStaleStateError,
  POST_PROCESS_ERROR_MESSAGES,
} from '../postProcessErrors';

const err = (message: string) => ({ message, code: 'P0001' });

// Every code the fase-2 table lists (docs/superpowers/plans/2026-09-10-posts-individuais-fase2-rpcs.md,
// "Códigos de erro"). If a code is added server-side it must be added here too.
const ALL_CODES = [
  'workspace_not_found', 'permission_denied', 'invalid_arguments', 'post_ids_required',
  'post_not_found', 'post_not_in_source_flow', 'post_in_workflow', 'post_already_in_flow',
  'post_has_active_process', 'post_belongs_to_another_client', 'post_changed',
  'workflow_not_found', 'workflow_not_active', 'workflow_changed', 'workflow_etapas_inconsistent',
  'template_not_found', 'template_empty', 'template_invalid', 'template_changed',
  'invalid_start_ordem', 'invalid_step_overrides', 'invalid_step_deadlines',
  'start_deadline_required', 'step_deadline_required', 'data_entrega_requires_approval_step',
  'active_deadline_required', 'next_deadline_required', 'expected_post_status_required',
  'approval_choice_required', 'invalid_approval_choice', 'invalid_command', 'membro_not_found',
  'process_not_found', 'process_changed', 'process_not_active', 'process_not_concluded',
  'process_already_closed', 'step_not_found', 'step_not_editable', 'no_next_step',
  'no_previous_step', 'pending_steps_remaining', 'request_id_required', 'request_not_found',
  'request_mismatch',
];

describe('POST_PROCESS_ERROR_MESSAGES', () => {
  it('cobre todos os códigos identificadores da tabela da fase 2', () => {
    for (const code of ALL_CODES) {
      expect(POST_PROCESS_ERROR_MESSAGES[code], code).toBeTruthy();
      expect(POST_PROCESS_ERROR_MESSAGES[code]).not.toMatch(/—/);
    }
  });
});

describe('getErrorIdentifier', () => {
  it('lê message de objetos de erro e devolve vazio para o resto', () => {
    expect(getErrorIdentifier(err('process_changed'))).toBe('process_changed');
    expect(getErrorIdentifier(new Error('post_changed'))).toBe('post_changed');
    expect(getErrorIdentifier(null)).toBe('');
    expect(getErrorIdentifier('x')).toBe('');
  });
});

describe('getPostProcessErrorToast', () => {
  it('mapeia um código conhecido', () => {
    expect(getPostProcessErrorToast(err('process_changed'), 'fallback')).toBe(
      POST_PROCESS_ERROR_MESSAGES.process_changed,
    );
  });
  it('usa a frase de entitlement para feature_disabled e plan_limit', () => {
    expect(getPostProcessErrorToast(err('feature_disabled:feature_post_processes'), 'x')).toBe(
      'O recurso "Processos individuais de produção" não está disponível no seu plano.',
    );
    expect(getPostProcessErrorToast(err('plan_limit_exceeded:max_posts_per_workflow'), 'x')).toBe(
      'Você atingiu o limite de posts por fluxo do seu plano.',
    );
  });
  it('cai no fallback para código desconhecido e para erro sem message', () => {
    expect(getPostProcessErrorToast(err('something_else'), 'Erro ao avançar etapa')).toBe(
      'Erro ao avançar etapa',
    );
    expect(getPostProcessErrorToast(undefined, 'Erro')).toBe('Erro');
  });
});

describe('isStaleStateError', () => {
  it('é verdadeiro só para os códigos de estado obsoleto', () => {
    for (const c of [
      'workflow_changed', 'process_changed', 'post_changed', 'template_changed',
      'request_mismatch', 'post_has_active_process', 'post_in_workflow', 'post_already_in_flow',
    ]) {
      expect(isStaleStateError(err(c)), c).toBe(true);
    }
    expect(isStaleStateError(err('permission_denied'))).toBe(false);
    expect(isStaleStateError(null)).toBe(false);
  });
});
```

```ts
// apps/crm/src/lib/__tests__/entitlement-errors.test.ts (add this case; create the file with the
// same imports if it does not exist)
import { describe, expect, it } from 'vitest';
import { mapEntitlementError } from '../entitlement-errors';

describe('mapEntitlementError feature_post_processes', () => {
  it('rotula feature_post_processes em português', () => {
    expect(mapEntitlementError({ message: 'feature_disabled:feature_post_processes' })).toEqual({
      kind: 'feature',
      key: 'feature_post_processes',
      label: 'Processos individuais de produção',
    });
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run apps/crm/src/pages/entregas/__tests__/postProcessErrors.test.ts apps/crm/src/lib/__tests__/entitlement-errors.test.ts`
Expected: FAIL — "Cannot find module '../postProcessErrors'" and the label assertion receiving `'feature_post_processes'`.

- [ ] **Step 3: Add the label**

In `apps/crm/src/lib/entitlement-errors.ts`, after `feature_briefing_audio: 'Briefing por áudio',` add:

```ts
  feature_post_processes: 'Processos individuais de produção',
```

- [ ] **Step 4: Write the module**

```ts
// apps/crm/src/pages/entregas/postProcessErrors.ts
import { entitlementMessage, mapEntitlementError } from '@/lib/entitlement-errors';

/**
 * Cópia em português para os códigos identificadores que as RPCs de processos
 * individuais levantam (`RAISE EXCEPTION '<codigo>' USING ERRCODE = 'P0001'`,
 * spec §9.3). Tabela completa em
 * docs/superpowers/plans/2026-09-10-posts-individuais-fase2-rpcs.md, seção
 * "Códigos de erro". `feature_disabled:*` e `plan_limit_exceeded:*` passam
 * pelo mapeamento de entitlement existente, não por esta tabela.
 */
export const POST_PROCESS_ERROR_MESSAGES: Record<string, string> = {
  workspace_not_found: 'Workspace ativo não encontrado. Recarregue a página.',
  permission_denied: 'Você não tem permissão para editar entregas neste workspace.',
  invalid_arguments: 'Não foi possível salvar a ordem da coluna. Recarregue e tente de novo.',
  post_ids_required: 'Selecione pelo menos um post.',
  post_not_found: 'Um ou mais posts não foram encontrados.',
  post_not_in_source_flow: 'Um dos posts já não está neste fluxo. Recarregue a lista.',
  post_in_workflow: 'Este post já pertence a um fluxo. Recarregue para ver o estado atual.',
  post_already_in_flow: 'Este post já pertence a um fluxo.',
  post_has_active_process:
    'Este post tem um processo individual em andamento. Use "Vincular a um fluxo" para encerrá-lo e vincular.',
  post_belongs_to_another_client: 'Este post pertence a outro cliente.',
  post_changed: 'O status do post mudou em outro lugar. Recarregue e tente de novo.',
  workflow_not_found: 'Fluxo não encontrado.',
  workflow_not_active: 'Este fluxo não está mais ativo.',
  workflow_changed: 'O fluxo foi alterado em outro lugar. Recarregue e tente de novo.',
  workflow_etapas_inconsistent:
    'As etapas deste fluxo estão inconsistentes. Só é possível desmembrar como avulso sem etapas.',
  template_not_found: 'Modelo de fluxo não encontrado.',
  template_empty: 'Este modelo não tem etapas.',
  template_invalid: 'Este modelo tem etapas inválidas. Corrija o modelo antes de aplicá-lo.',
  template_changed: 'O modelo foi alterado depois que você abriu este diálogo. Recarregue e tente de novo.',
  invalid_start_ordem: 'Etapa inicial inválida para este modelo.',
  invalid_step_overrides: 'Responsáveis ou prazos inválidos. Revise os campos.',
  invalid_step_deadlines: 'Prazos das etapas futuras inválidos. Revise os campos.',
  start_deadline_required: 'A etapa inicial precisa de um prazo.',
  step_deadline_required: 'Todas as etapas a partir da inicial precisam de uma data.',
  data_entrega_requires_approval_step:
    'No modo data de entrega é preciso haver uma etapa de aprovação do cliente a partir da etapa inicial.',
  active_deadline_required: 'Não foi possível calcular o prazo da etapa atual.',
  next_deadline_required: 'Não foi possível calcular o prazo da próxima etapa.',
  expected_post_status_required: 'Não foi possível conferir o status do post. Recarregue e tente de novo.',
  approval_choice_required: 'Escolha como prosseguir com a aprovação.',
  invalid_approval_choice: 'Opção de aprovação inválida.',
  invalid_command: 'Comando inválido.',
  membro_not_found: 'Responsável não encontrado neste workspace.',
  process_not_found: 'Processo não encontrado.',
  process_changed: 'Este processo foi alterado em outro lugar. Recarregue e tente de novo.',
  process_not_active: 'Este processo não está em andamento.',
  process_not_concluded: 'Só um processo concluído pode ser reaberto.',
  process_already_closed: 'Este processo já foi encerrado.',
  step_not_found: 'Etapa não encontrada.',
  step_not_editable: 'Só etapas pendentes ou em andamento podem ser editadas.',
  no_next_step: 'Não há próxima etapa. Use "Concluir processo".',
  no_previous_step: 'Esta já é a primeira etapa.',
  pending_steps_remaining: 'Ainda há etapas pendentes. Avance até a última antes de concluir.',
  request_id_required: 'Não foi possível identificar a operação. Tente de novo.',
  request_not_found: 'Não foi possível identificar a operação. Tente de novo.',
  request_mismatch: 'A seleção mudou desde a última tentativa. Feche o diálogo e tente de novo.',
};

/** Códigos que significam "seu estado local está velho": além do toast, refetch. */
export const STALE_STATE_CODES: ReadonlySet<string> = new Set([
  'workflow_changed',
  'process_changed',
  'post_changed',
  'template_changed',
  'request_mismatch',
  'post_has_active_process',
  'post_in_workflow',
  'post_already_in_flow',
]);

export function getErrorIdentifier(err: unknown): string {
  if (err && typeof err === 'object' && 'message' in err) {
    const message = (err as { message?: unknown }).message;
    if (typeof message === 'string') return message;
  }
  return '';
}

export function getPostProcessErrorToast(err: unknown, fallback: string): string {
  const ent = mapEntitlementError(err);
  if (ent) return entitlementMessage(ent);
  const id = getErrorIdentifier(err);
  return POST_PROCESS_ERROR_MESSAGES[id] ?? fallback;
}

export function isStaleStateError(err: unknown): boolean {
  return STALE_STATE_CODES.has(getErrorIdentifier(err));
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run apps/crm/src/pages/entregas/__tests__/postProcessErrors.test.ts apps/crm/src/lib/__tests__/entitlement-errors.test.ts`
Expected: PASS (all cases).

- [ ] **Step 6: Commit**

```bash
git add apps/crm/src/lib/entitlement-errors.ts apps/crm/src/pages/entregas/postProcessErrors.ts apps/crm/src/pages/entregas/__tests__/postProcessErrors.test.ts apps/crm/src/lib/__tests__/entitlement-errors.test.ts
git commit -m "feat(entregas): mapeamento em português dos erros das RPCs de processos individuais"
```

---

### Task 2: Store wrappers for the seven RPCs (+ exported `callRpcWithDeadlockRetry`)

**Files:**
- Modify: `apps/crm/src/store/posts.ts:955-962` (export the helper; doc comment)
- Modify: `apps/crm/src/store/postProcesses.ts` (append wrappers; rewrite the header comment)
- Test: `apps/crm/src/store/__tests__/postProcesses.test.ts` (append a `describe` block)

**Interfaces:**
- Consumes: `supabase.rpc` via `../core`; `callRpcWithDeadlockRetry` from `./posts`.
- Produces (all exported from `store/postProcesses.ts`, re-exported by `store/index.ts` through the existing `export * from './postProcesses'`):

```ts
export interface RpcStepRow {
  process_id: number; ordem: number; nome: string; tipo: 'padrao' | 'aprovacao_cliente';
  estado: PostProcessStepEstado; responsavel_id: number | null; prazo_dias: number | null;
  tipo_prazo: 'uteis' | 'corridos' | null; prazo_efetivo: string | null;
  iniciado_em: string | null; concluido_em?: string | null;
}
export interface DetachKeepingProcessArgs {
  postIds: number[]; workflowId: number; fingerprint: string; activeDeadline: string;
  requestId: string; stepDeadlines?: Record<string, string> | null; archiveEmptyFlow?: boolean;
}
export interface DetachKeepingProcessResult {
  ok: true; request_id: string; detached: number; archived_workflow_ids: number[];
  processes: { process_id: number; post_id: number; etapa_atual: number; revisao: number;
    board_position: number; assinatura: string; origem_workflow_id: number | null;
    origem_descricao: string | null }[];
  steps: RpcStepRow[];
}
export function detachPostsKeepingProcess(args: DetachKeepingProcessArgs): Promise<DetachKeepingProcessResult>;

export type StepOverrides = Record<string, { responsavel_id?: number | null; prazo_efetivo?: string | null }>;
export interface ApplyPostProcessArgs {
  postId: number; templateId: number; templateFingerprint: string; startOrdem: number;
  stepOverrides?: StepOverrides | null;
}
export interface ApplyPostProcessResult {
  ok: true; process_id: number; post_id: number; estado: 'ativo'; etapa_atual: number;
  revisao: number; assinatura: string; template_id: number; template_nome: string; steps: RpcStepRow[];
}
export function applyPostProcess(args: ApplyPostProcessArgs): Promise<ApplyPostProcessResult>;

export type ProcessCommand = 'avancar' | 'voltar' | 'concluir' | 'reabrir';
export type ApprovalChoice = 'aprovar_interno' | 'sem_alterar';
export interface TransitionPostProcessArgs {
  processId: number; expectedRevisao: number; command: ProcessCommand;
  approvalChoice?: ApprovalChoice | null; expectedPostStatus?: string | null; nextDeadline?: string | null;
}
export interface TransitionPostProcessResult {
  ok: true; process_id: number; post_id: number; command: ProcessCommand;
  estado: PostProcessEstado; etapa_atual: number; revisao: number;
  post_status: string; post_status_changed: boolean; steps: RpcStepRow[];
}
export function transitionPostProcess(args: TransitionPostProcessArgs): Promise<TransitionPostProcessResult>;

export interface UpdatePostProcessStepArgs {
  processId: number; expectedRevisao: number; ordem: number;
  responsavelId: number | null; prazoEfetivo: string | null;   // absolute setters: null clears
}
export interface UpdatePostProcessStepResult { ok: true; process_id: number; ordem: number; revisao: number; step: RpcStepRow }
export function updatePostProcessStep(args: UpdatePostProcessStepArgs): Promise<UpdatePostProcessStepResult>;

export interface RemovePostProcessResult { ok: true; process_id: number; post_id: number; estado: 'encerrado'; motivo_encerramento: 'removido'; revisao: number }
export function removePostProcess(processId: number, expectedRevisao: number): Promise<RemovePostProcessResult>;

export interface AttachClosingProcessResult { ok: true; process_id: number; post_id: number; workflow_id: number; estado: 'encerrado'; motivo_encerramento: 'vinculado'; revisao: number }
export function attachPostClosingProcess(postId: number, workflowId: number, expectedRevisao: number): Promise<AttachClosingProcessResult>;

export interface ReorderFluxosBoardArgs { workflowIds: number[]; workflowPositions: number[]; processIds: number[]; processPositions: number[] }
export function reorderFluxosBoard(args: ReorderFluxosBoardArgs): Promise<void>;
```

- [ ] **Step 1: Write the failing tests**

Append to `apps/crm/src/store/__tests__/postProcesses.test.ts`. The file already mocks `../core` with `supabase: { from: mockFrom }`; extend the hoisted mock to include `rpc`:

```ts
// At the top of the file, change the hoisted mock to:
const { mockFrom, mockRpc } = vi.hoisted(() => ({ mockFrom: vi.fn(), mockRpc: vi.fn() }));
vi.mock('../core', () => ({
  supabase: { from: mockFrom, rpc: mockRpc },
  getContaId: vi.fn(),
  getUserId: vi.fn(),
  getCurrentProfile: vi.fn(),
  clearProfileCache: vi.fn(),
}));

// Add to the import list:
import {
  applyPostProcess,
  attachPostClosingProcess,
  detachPostsKeepingProcess,
  removePostProcess,
  reorderFluxosBoard,
  transitionPostProcess,
  updatePostProcessStep,
} from '../postProcesses';

// Append at the end of the file:
describe('RPC wrappers (fase 4)', () => {
  beforeEach(() => {
    mockRpc.mockReset();
  });

  it('detachPostsKeepingProcess envia os parâmetros exatos da RPC', async () => {
    mockRpc.mockResolvedValueOnce({ data: { ok: true, detached: 2 }, error: null });
    const res = await detachPostsKeepingProcess({
      postIds: [7, 3],
      workflowId: 11,
      fingerprint: 'etapa_atual=1\n0|Copy|padrao|concluido||2|corridos||',
      activeDeadline: '2026-09-15T02:59:59.999Z',
      requestId: '11111111-2222-4333-8444-555555555555',
      stepDeadlines: { '2': '2026-09-20T02:59:59.999Z' },
      archiveEmptyFlow: true,
    });
    expect(mockRpc).toHaveBeenCalledWith('detach_posts_keeping_process', {
      p_post_ids: [7, 3],
      p_workflow_id: 11,
      p_fingerprint: 'etapa_atual=1\n0|Copy|padrao|concluido||2|corridos||',
      p_active_deadline: '2026-09-15T02:59:59.999Z',
      p_request_id: '11111111-2222-4333-8444-555555555555',
      p_step_deadlines: { '2': '2026-09-20T02:59:59.999Z' },
      p_archive_empty_flow: true,
    });
    expect(res.detached).toBe(2);
  });

  it('detachPostsKeepingProcess reenvia o MESMO request_id na repetição por deadlock', async () => {
    mockRpc
      .mockResolvedValueOnce({ data: null, error: { code: '40P01', message: 'deadlock' } })
      .mockResolvedValueOnce({ data: { ok: true, detached: 1 }, error: null });
    await detachPostsKeepingProcess({
      postIds: [7],
      workflowId: 11,
      fingerprint: 'fp',
      activeDeadline: '2026-09-15T02:59:59.999Z',
      requestId: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
    });
    expect(mockRpc).toHaveBeenCalledTimes(2);
    expect(mockRpc.mock.calls[0][1].p_request_id).toBe('aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee');
    expect(mockRpc.mock.calls[1][1].p_request_id).toBe('aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee');
    // Defaults when the optional args are omitted.
    expect(mockRpc.mock.calls[0][1].p_step_deadlines).toBeNull();
    expect(mockRpc.mock.calls[0][1].p_archive_empty_flow).toBe(false);
  });

  it('applyPostProcess envia overrides por ordem e o fingerprint do template', async () => {
    mockRpc.mockResolvedValueOnce({ data: { ok: true, process_id: 5, revisao: 1 }, error: null });
    await applyPostProcess({
      postId: 77,
      templateId: 3,
      templateFingerprint: '0|Copy|padrao|2|corridos\n1|Design|padrao|3|uteis',
      startOrdem: 1,
      stepOverrides: { '1': { responsavel_id: 9, prazo_efetivo: '2026-09-18T02:59:59.999Z' } },
    });
    expect(mockRpc).toHaveBeenCalledWith('apply_post_process', {
      p_post_id: 77,
      p_template_id: 3,
      p_template_fingerprint: '0|Copy|padrao|2|corridos\n1|Design|padrao|3|uteis',
      p_start_ordem: 1,
      p_step_overrides: { '1': { responsavel_id: 9, prazo_efetivo: '2026-09-18T02:59:59.999Z' } },
    });
  });

  it('transitionPostProcess envia só os campos informados e nulos nos demais', async () => {
    mockRpc.mockResolvedValueOnce({ data: { ok: true, revisao: 2 }, error: null });
    await transitionPostProcess({ processId: 5, expectedRevisao: 1, command: 'voltar' });
    expect(mockRpc).toHaveBeenCalledWith('transition_post_process', {
      p_process_id: 5,
      p_expected_revisao: 1,
      p_command: 'voltar',
      p_approval_choice: null,
      p_expected_post_status: null,
      p_next_deadline: null,
    });
    mockRpc.mockResolvedValueOnce({ data: { ok: true, revisao: 3 }, error: null });
    await transitionPostProcess({
      processId: 5,
      expectedRevisao: 2,
      command: 'avancar',
      approvalChoice: 'aprovar_interno',
      expectedPostStatus: 'enviado_cliente',
      nextDeadline: '2026-09-20T02:59:59.999Z',
    });
    expect(mockRpc.mock.calls[1][1]).toEqual({
      p_process_id: 5,
      p_expected_revisao: 2,
      p_command: 'avancar',
      p_approval_choice: 'aprovar_interno',
      p_expected_post_status: 'enviado_cliente',
      p_next_deadline: '2026-09-20T02:59:59.999Z',
    });
  });

  it('updatePostProcessStep, removePostProcess, attachPostClosingProcess, reorderFluxosBoard', async () => {
    mockRpc.mockResolvedValue({ data: { ok: true }, error: null });
    await updatePostProcessStep({
      processId: 5, expectedRevisao: 1, ordem: 1, responsavelId: null, prazoEfetivo: null,
    });
    expect(mockRpc).toHaveBeenLastCalledWith('update_post_process_step', {
      p_process_id: 5, p_expected_revisao: 1, p_ordem: 1, p_responsavel_id: null, p_prazo_efetivo: null,
    });
    await removePostProcess(5, 1);
    expect(mockRpc).toHaveBeenLastCalledWith('remove_post_process', {
      p_process_id: 5, p_expected_revisao: 1,
    });
    await attachPostClosingProcess(77, 11, 1);
    expect(mockRpc).toHaveBeenLastCalledWith('attach_post_closing_process', {
      p_post_id: 77, p_workflow_id: 11, p_expected_revisao: 1,
    });
    mockRpc.mockResolvedValueOnce({ data: null, error: null });
    await reorderFluxosBoard({
      workflowIds: [1, 2], workflowPositions: [0, 2], processIds: [5], processPositions: [1],
    });
    expect(mockRpc).toHaveBeenLastCalledWith('reorder_fluxos_board', {
      p_workflow_ids: [1, 2], p_workflow_positions: [0, 2], p_process_ids: [5], p_process_positions: [1],
    });
  });

  it('propaga o erro identificador da RPC sem retry fora de 40P01', async () => {
    mockRpc.mockResolvedValueOnce({ data: null, error: { code: 'P0001', message: 'process_changed' } });
    await expect(removePostProcess(5, 1)).rejects.toMatchObject({ message: 'process_changed' });
    expect(mockRpc).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run apps/crm/src/store/__tests__/postProcesses.test.ts`
Expected: FAIL — the seven names are not exported from `../postProcesses`.

- [ ] **Step 3: Export `callRpcWithDeadlockRetry`**

In `apps/crm/src/store/posts.ts:955`, change `async function callRpcWithDeadlockRetry<T>(` to `export async function callRpcWithDeadlockRetry<T>(` and extend the doc comment above it:

```ts
/** Postgres deadlock SQLSTATE. detach_posts_from_flow/attach_posts_to_flow can
 * rarely deadlock against the (unrelated, pre-existing) workflow-client-move
 * trigger path -- a documented, self-recovering residual case (see the
 * migration's header comment) -- so both RPC wrappers retry exactly once.
 *
 * Retry semantics for callers: the SAME closure is re-invoked, so every value
 * it captured (post ids, fingerprint, and for detach_posts_keeping_process the
 * `p_request_id`) is resent unchanged. That is what makes the fase-2 batch
 * idempotency work: generate the request id OUTSIDE the closure (spec §9.4)
 * and the retry is recognized server-side as the same attempt. Never generate
 * an id inside `invoke`. */
```

- [ ] **Step 4: Add the wrappers to `store/postProcesses.ts`**

Replace the header comment lines 5-11 ("toda escrita passa pelas RPCs SECURITY DEFINER da fase 2 — este módulo só lê") with:

```ts
 * Leitura em lote (fase 3) e, a partir da fase 4, os invólucros das sete RPCs
 * SECURITY DEFINER da fase 2 (migrations 20260919000003..8). Nenhuma escrita
 * direta nas três tabelas: RLS bloqueia `authenticated`, só as RPCs escrevem.
 * Prazos (`p_active_deadline`, `p_step_deadlines`, `prazo_efetivo` dos
 * overrides, `p_next_deadline`) são calculados pelo CRM e só armazenados pela
 * RPC (spec §7). Todas passam por callRpcWithDeadlockRetry; o `requestId` do
 * desmembrar em lote vem do chamador para que a repetição por 40P01 reenvie o
 * mesmo id (spec §9.4).
```

Add the import at the top: `import { callRpcWithDeadlockRetry } from './posts';` (the module already imports `POST_CONTEXT_COLUMNS`/`mapPostContextRow` from `./posts`; add to that import).

Append at the end of the file:

```ts
// ── RPCs de mutação (fase 4) ─────────────────────────────────────────────────

/** Linha de etapa como as RPCs a devolvem em `steps`/`step`. */
export interface RpcStepRow {
  process_id: number;
  ordem: number;
  nome: string;
  tipo: 'padrao' | 'aprovacao_cliente';
  estado: PostProcessStepEstado;
  responsavel_id: number | null;
  prazo_dias: number | null;
  tipo_prazo: 'uteis' | 'corridos' | null;
  prazo_efetivo: string | null;
  iniciado_em: string | null;
  concluido_em?: string | null;
}

export interface DetachKeepingProcessArgs {
  postIds: number[];
  workflowId: number;
  /** buildFingerprint(workflow, allEtapas) sobre os dados exibidos. */
  fingerprint: string;
  /** Prazo congelado da etapa ativa da origem, ISO (spec §7). */
  activeDeadline: string;
  /** uuid gerado pelo diálogo; regenerado quando a seleção ou o checkbox de
   *  arquivar mudam (os dois entram no input_hash do servidor). */
  requestId: string;
  /** {"<ordem>": "<ISO>"} das etapas futuras com data_limite na origem. */
  stepDeadlines?: Record<string, string> | null;
  archiveEmptyFlow?: boolean;
}

export interface DetachKeepingProcessResult {
  ok: true;
  request_id: string;
  detached: number;
  archived_workflow_ids: number[];
  processes: {
    process_id: number;
    post_id: number;
    etapa_atual: number;
    revisao: number;
    board_position: number;
    assinatura: string;
    origem_workflow_id: number | null;
    origem_descricao: string | null;
  }[];
  steps: RpcStepRow[];
}

export async function detachPostsKeepingProcess(
  args: DetachKeepingProcessArgs,
): Promise<DetachKeepingProcessResult> {
  return callRpcWithDeadlockRetry<DetachKeepingProcessResult>(() =>
    supabase.rpc('detach_posts_keeping_process', {
      p_post_ids: args.postIds,
      p_workflow_id: args.workflowId,
      p_fingerprint: args.fingerprint,
      p_active_deadline: args.activeDeadline,
      p_request_id: args.requestId,
      p_step_deadlines: args.stepDeadlines ?? null,
      p_archive_empty_flow: args.archiveEmptyFlow ?? false,
    }),
  );
}

/** Por `ordem` (chave em string de dígitos), só as duas chaves que a RPC aceita. */
export type StepOverrides = Record<
  string,
  { responsavel_id?: number | null; prazo_efetivo?: string | null }
>;

export interface ApplyPostProcessArgs {
  postId: number;
  templateId: number;
  /** buildTemplateFingerprint(template.etapas). */
  templateFingerprint: string;
  startOrdem: number;
  stepOverrides?: StepOverrides | null;
}

export interface ApplyPostProcessResult {
  ok: true;
  process_id: number;
  post_id: number;
  estado: 'ativo';
  etapa_atual: number;
  revisao: number;
  assinatura: string;
  template_id: number;
  template_nome: string;
  steps: RpcStepRow[];
}

export async function applyPostProcess(args: ApplyPostProcessArgs): Promise<ApplyPostProcessResult> {
  return callRpcWithDeadlockRetry<ApplyPostProcessResult>(() =>
    supabase.rpc('apply_post_process', {
      p_post_id: args.postId,
      p_template_id: args.templateId,
      p_template_fingerprint: args.templateFingerprint,
      p_start_ordem: args.startOrdem,
      p_step_overrides: args.stepOverrides ?? null,
    }),
  );
}

export type ProcessCommand = 'avancar' | 'voltar' | 'concluir' | 'reabrir';
/** Decisão 13 da fase 2: "enviar ao cliente" NÃO é transição. */
export type ApprovalChoice = 'aprovar_interno' | 'sem_alterar';

export interface TransitionPostProcessArgs {
  processId: number;
  expectedRevisao: number;
  command: ProcessCommand;
  approvalChoice?: ApprovalChoice | null;
  /** Obrigatório em avancar/concluir sobre etapa aprovacao_cliente. */
  expectedPostStatus?: string | null;
  /** Só em avancar, e só quando a próxima etapa tem prazo relativo sem prazo_efetivo. */
  nextDeadline?: string | null;
}

export interface TransitionPostProcessResult {
  ok: true;
  process_id: number;
  post_id: number;
  command: ProcessCommand;
  estado: PostProcessEstado;
  etapa_atual: number;
  revisao: number;
  post_status: string;
  post_status_changed: boolean;
  steps: RpcStepRow[];
}

export async function transitionPostProcess(
  args: TransitionPostProcessArgs,
): Promise<TransitionPostProcessResult> {
  return callRpcWithDeadlockRetry<TransitionPostProcessResult>(() =>
    supabase.rpc('transition_post_process', {
      p_process_id: args.processId,
      p_expected_revisao: args.expectedRevisao,
      p_command: args.command,
      p_approval_choice: args.approvalChoice ?? null,
      p_expected_post_status: args.expectedPostStatus ?? null,
      p_next_deadline: args.nextDeadline ?? null,
    }),
  );
}

export interface UpdatePostProcessStepArgs {
  processId: number;
  expectedRevisao: number;
  ordem: number;
  /** Setters absolutos: null limpa. A UI manda sempre os dois valores. */
  responsavelId: number | null;
  prazoEfetivo: string | null;
}

export interface UpdatePostProcessStepResult {
  ok: true;
  process_id: number;
  ordem: number;
  revisao: number;
  step: RpcStepRow;
}

export async function updatePostProcessStep(
  args: UpdatePostProcessStepArgs,
): Promise<UpdatePostProcessStepResult> {
  return callRpcWithDeadlockRetry<UpdatePostProcessStepResult>(() =>
    supabase.rpc('update_post_process_step', {
      p_process_id: args.processId,
      p_expected_revisao: args.expectedRevisao,
      p_ordem: args.ordem,
      p_responsavel_id: args.responsavelId,
      p_prazo_efetivo: args.prazoEfetivo,
    }),
  );
}

export interface RemovePostProcessResult {
  ok: true;
  process_id: number;
  post_id: number;
  estado: 'encerrado';
  motivo_encerramento: 'removido';
  revisao: number;
}

export async function removePostProcess(
  processId: number,
  expectedRevisao: number,
): Promise<RemovePostProcessResult> {
  return callRpcWithDeadlockRetry<RemovePostProcessResult>(() =>
    supabase.rpc('remove_post_process', {
      p_process_id: processId,
      p_expected_revisao: expectedRevisao,
    }),
  );
}

export interface AttachClosingProcessResult {
  ok: true;
  process_id: number;
  post_id: number;
  workflow_id: number;
  estado: 'encerrado';
  motivo_encerramento: 'vinculado';
  revisao: number;
}

export async function attachPostClosingProcess(
  postId: number,
  workflowId: number,
  expectedRevisao: number,
): Promise<AttachClosingProcessResult> {
  return callRpcWithDeadlockRetry<AttachClosingProcessResult>(() =>
    supabase.rpc('attach_post_closing_process', {
      p_post_id: postId,
      p_workflow_id: workflowId,
      p_expected_revisao: expectedRevisao,
    }),
  );
}

export interface ReorderFluxosBoardArgs {
  workflowIds: number[];
  workflowPositions: number[];
  processIds: number[];
  processPositions: number[];
}

/** Coluna inteira, ids mistos, um único espaço de índices (spec §4.2). A RPC
 *  rejeita arrays de comprimentos diferentes, id/posição repetidos e os dois
 *  vazios com invalid_arguments; o chamador nunca envia coluna vazia. */
export async function reorderFluxosBoard(args: ReorderFluxosBoardArgs): Promise<void> {
  await callRpcWithDeadlockRetry<null>(() =>
    supabase.rpc('reorder_fluxos_board', {
      p_workflow_ids: args.workflowIds,
      p_workflow_positions: args.workflowPositions,
      p_process_ids: args.processIds,
      p_process_positions: args.processPositions,
    }),
  );
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run apps/crm/src/store/__tests__/postProcesses.test.ts apps/crm/src/store/__tests__/`
Expected: PASS, including the pre-existing read tests.

- [ ] **Step 6: Typecheck**

Run: `npx tsc -p apps/crm/tsconfig.json --noEmit`
Expected: no errors (the `supabase.rpc` generic accepts the param objects; if the generated `Database` types complain about `Json` for `p_step_overrides`, cast with `as unknown as Json`-free `as never` is NOT acceptable — instead type the object literal as `Record<string, unknown>` inline).

- [ ] **Step 7: Commit**

```bash
git add apps/crm/src/store/posts.ts apps/crm/src/store/postProcesses.ts apps/crm/src/store/__tests__/postProcesses.test.ts
git commit -m "feat(entregas): invólucros das sete RPCs de processos individuais no store"
```

---

### Task 3: Flag gates creation only — reads always on, `postProcessesVisible` drives display

**Files:**
- Modify: `apps/crm/src/pages/entregas/hooks/useEntregasData.ts:210-217, 346-350, 475-497`
- Modify: `apps/crm/src/pages/entregas/EntregasPage.tsx:120, 152, 186, 255, 387-391, 613, 854, 894, 974, 1001, 1057, 1072`
- Modify: `apps/crm/src/pages/entregas/components/StandalonePostDrawer.tsx:88-96, 468-483, 524`
- Modify: `apps/crm/src/pages/entregas/views/ConcludedView.tsx:96-110`
- Modify: `apps/crm/src/pages/entregas/components/WorkflowDrawer.tsx:300-305`
- Modify: `apps/crm/src/pages/entregas/components/PostEditorBody.tsx:86-89`
- Test: `apps/crm/src/pages/entregas/hooks/__tests__/useEntregasData.test.ts:516-528`
- Test: `apps/crm/src/pages/entregas/components/__tests__/StandalonePostDrawer.test.tsx` (the "flag desligada" case)
- Test: `apps/crm/src/pages/entregas/views/__tests__/ConcludedView.test.tsx` (the "flag desligada" case)
- Test: `apps/crm/src/pages/entregas/__tests__/EntregasPage.test.tsx` (add two cases)

**Interfaces:**
- Consumes: `getVigentePostProcesses`, `getVigentePostProcess` (fase 3).
- Produces:
  - `useEntregasData({ postProcessesEnabled })` keeps its option but NO LONGER gates the query with it; the return object gains `postProcessesVisible: boolean` (`= postProcessesEnabled || vigenteProcesses.length > 0`).
  - `EntregasPage` has two booleans: `postProcessesEnabled` (flag; used ONLY for `semProcessoMode` in this task, and by Tasks 11/12 for the creation affordances) and `postProcessesVisible` (from the hook; every display gate).
  - `StandalonePostDrawer` always fetches `['post-process', postId]`; the header tag reads: process → "Individual · <etapa>"; no process → `postProcessesEnabled ? 'Avulso · Sem processo' : 'Avulso'`. `postProcess` is passed to `PostEditorBody` ungated.
  - `ConcludedView` always fetches `['post-processes','vigentes']`.
  - `WorkflowDrawer` fetches `post-process-events` whenever `postIds.length > 0`.

- [ ] **Step 1: Flip the three fase-3 tests and add the page cases**

`hooks/__tests__/useEntregasData.test.ts:516-528` — replace the test with:

```ts
  it('consulta post_processes mesmo com a flag desligada e devolve postProcessesVisible=false sem linhas', async () => {
    (getVigentePostProcesses as any).mockResolvedValueOnce([]);
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrapper = ({ children }: { children: ReactNode }) =>
      createElement(QueryClientProvider, { client: qc }, children);
    const { result } = renderHook(() => useEntregasData(), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(getVigentePostProcesses).toHaveBeenCalledTimes(1);
    expect(result.current.postEntities).toEqual([]);
    expect(result.current.activePostProcessCount).toBe(0);
    expect(result.current.processByPostId.size).toBe(0);
    expect(result.current.postProcessesVisible).toBe(false);
    const first = result.current.postEntities;
    await waitFor(() => expect(result.current.postEntities).toBe(first));
  });

  it('flag desligada com processo existente: postProcessesVisible=true e o card entra em postEntities', async () => {
    (getVigentePostProcesses as any).mockResolvedValueOnce([vigenteFixture]);
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrapper = ({ children }: { children: ReactNode }) =>
      createElement(QueryClientProvider, { client: qc }, children);
    const { result } = renderHook(() => useEntregasData(), { wrapper });
    await waitFor(() => expect(result.current.postEntities.length).toBe(1));
    expect(result.current.postProcessesVisible).toBe(true);
  });
```

`components/__tests__/StandalonePostDrawer.test.tsx` — the case "flag desligada mantém a tag "Avulso" e não consulta o processo" becomes two cases:

```ts
  it('flag desligada sem processo: tag "Avulso" (consulta o processo, que vem nulo)', async () => {
    limitsMock.features = { feature_post_processes: false };
    (getVigentePostProcess as any).mockResolvedValueOnce(null);
    renderDrawer();
    await screen.findByText('Avulso');
    expect(getVigentePostProcess).toHaveBeenCalledWith(POST_ID);
    expect(screen.queryByText(/Avulso · Sem processo/)).toBeNull();
  });

  it('flag desligada com processo existente: tag "Individual · <etapa>" e seção de produção visíveis', async () => {
    limitsMock.features = { feature_post_processes: false };
    (getVigentePostProcess as any).mockResolvedValueOnce(processFixture); // estado 'ativo', etapa ativa 'Design'
    renderDrawer();
    await screen.findByText(/Individual · Design/);
    expect(screen.getByText('Produção')).toBeInTheDocument();
  });
```

(`renderDrawer`, `POST_ID`, `limitsMock` and the process fixture already exist in that file from fase 3 — reuse them; if the fixture is named differently, use the existing name.)

`views/__tests__/ConcludedView.test.tsx` — the case "flag desligada: não consulta processos e mantém a cópia vazia de sempre" becomes:

```ts
  it('flag desligada: consulta processos; sem linhas mantém a cópia vazia de sempre', async () => {
    limitsMock.features = { feature_post_processes: false };
    (getVigentePostProcesses as any).mockResolvedValueOnce([]);
    renderView();
    await screen.findByText('Nenhum fluxo concluído ainda.');
    expect(getVigentePostProcesses).toHaveBeenCalledTimes(1);
  });

  it('flag desligada com processo concluído: a entrada "Post individual" aparece', async () => {
    limitsMock.features = { feature_post_processes: false };
    (getVigentePostProcesses as any).mockResolvedValueOnce([concludedProcessFixture]);
    renderView();
    await screen.findByText('Post individual');
  });
```

`__tests__/EntregasPage.test.tsx` — add, next to the existing flag cases (~line 1627):

```ts
    it('flag desligada com processo ativo: mostra o toggle de entidade e o card individual', async () => {
      limitsMock.features = { feature_post_processes: false };
      store.getVigentePostProcesses.mockResolvedValueOnce([vigenteFixture]);
      renderPage('/entregas');
      await screen.findByTestId('post-process-card');
      expect(screen.getByRole('group', { name: /Entidade/ })).toBeInTheDocument();
      // Criação continua escondida: a seção Sem processo não aparece com a flag desligada.
      expect(screen.queryByText('Sem processo')).toBeNull();
    });
```

(Use the file's existing render helper and the `store` hoisted mock; `vigenteFixture` mirrors `useEntregasData.test.ts`'s fixture. If `EntidadeToggle` has no accessible group name, assert on its three option labels "Todos"/"Fluxos"/"Posts individuais" instead.)

- [ ] **Step 2: Run the four test files to verify the new cases fail**

Run: `npx vitest run apps/crm/src/pages/entregas/hooks/__tests__/useEntregasData.test.ts apps/crm/src/pages/entregas/components/__tests__/StandalonePostDrawer.test.tsx apps/crm/src/pages/entregas/views/__tests__/ConcludedView.test.tsx apps/crm/src/pages/entregas/__tests__/EntregasPage.test.tsx`
Expected: FAIL on the new cases (query never fires / `postProcessesVisible` undefined / card absent).

- [ ] **Step 3: `useEntregasData`**

At lines 210-217 replace the option doc and keep the option:

```ts
export interface UseEntregasDataOptions {
  /** features?.feature_post_processes === true. Desde a fase 4 a flag NÃO gate
   *  a leitura (spec §11 + §12.18: execuções existentes ficam visíveis e
   *  operáveis com a flag desligada); ela só entra em `postProcessesVisible`,
   *  o booleano de exibição que a página usa no lugar da flag crua. */
  postProcessesEnabled?: boolean;
}
```

At lines 346-350 delete `enabled: postProcessesEnabled,` from the `vigenteQuery` `useQuery` and rewrite the comment above it:

```ts
  // Processos individuais (spec §8.3): UM lote por conta com ativos e
  // concluídos, SEMPRE ligado (PO 2026-09-11, decisão 1): com a flag desligada
  // e zero linhas o resultado é vazio e tudo abaixo devolve as constantes
  // vazias; com linhas, o quadro continua exibindo e operando os processos.
```

Before the `return {`, add:

```ts
  // Exibição = flag OU existência de processo. A flag crua fica para as
  // affordances de criação (Aplicar processo, Manter etapas, Sem processo).
  const postProcessesVisible = postProcessesEnabled || vigenteProcesses.length > 0;
```

and add `postProcessesVisible,` to the returned object right after `activePostProcessCount`.

- [ ] **Step 4: `EntregasPage`**

- Line 186: destructure `postProcessesVisible` from `useEntregasData({ postProcessesEnabled })`.
- Replace `postProcessesEnabled` with `postProcessesVisible` at lines 152 (`effectiveEntidade`), 255/258 (tour `postProcesses:` option and deps), 387/391 (`persistLastEntidade` effect), 854 (header count), 894 (`KanbanView postProcessesEnabled=`), 974 (`EntidadeToggle` render), 1001 (`SemProcessoSection`'s sibling `postProcessesEnabled` prop passed to Kanban, if that is what 1001 is; otherwise it is the `ListView`/`PostsKanbanView` prop: same rule), 1057 (`ChartView`), 1072 (`CalendarView`).
- Line 613 (`semProcessoMode = postProcessesEnabled && ...`) STAYS on the flag: the Sem processo section is a creation surface.
- Add a comment above line 120:

```ts
  // Duas verdades (spec §11, PO 2026-09-11): `postProcessesEnabled` é a flag do
  // plano e gate SÓ criação (Aplicar processo, Manter etapas, seção Sem
  // processo). `postProcessesVisible` (hook) = flag OU processo existente, e
  // gate tudo que é exibição e operação de processos existentes.
```

- [ ] **Step 5: `StandalonePostDrawer`, `ConcludedView`, `WorkflowDrawer`, `PostEditorBody`**

`StandalonePostDrawer.tsx:88-96`: delete `enabled: postProcessesEnabled,`; rewrite the comment:

```ts
  // Processo individual vigente (spec §5.4). Sempre consultado (a flag só gate
  // criação, PO 2026-09-11): `null` = avulso sem processo.
```

Lines 468-483: change `{postProcessesEnabled && postProcess ? (` to `{postProcess ? (`. Line 524: `postProcess={postProcess}`.

`ConcludedView.tsx:96-110`: delete `enabled: postProcessesEnabled,`; `const isLoadingCombined = isLoading || vigenteLoading;` and delete the comment block above it (lines 104-109). Keep `postProcessesEnabled` only for the empty-state copy at line 168.

`WorkflowDrawer.tsx:300-305`: `enabled: postIds.length > 0,` and rewrite the comment: `// Sempre que houver posts: histórico de processo encerrado é história, não criação (PO 2026-09-11).` Remove the now-unused `features`/`useWorkspaceLimits` import if nothing else in the file reads it (grep first: `grep -n 'features\|useWorkspaceLimits' apps/crm/src/pages/entregas/components/WorkflowDrawer.tsx`).

`PostEditorBody.tsx:86-89`:

```ts
  /** Processo individual vigente do post (spec §5.4). `undefined` = não se
   *  aplica (drawer de fluxo); `null` = avulso sem processo. Só o
   *  StandalonePostDrawer preenche, independentemente da flag do plano. */
```

- [ ] **Step 6: Run the tests and typecheck**

Run: `npx vitest run apps/crm/src/pages/entregas && npx tsc -p apps/crm/tsconfig.json --noEmit`
Expected: PASS; no type errors. If `EntregasPage.test.tsx`'s pre-existing flag-off cases assert `getVigentePostProcesses` was NOT called, update them to assert it resolved `[]` and the DOM is unchanged.

- [ ] **Step 7: Commit**

```bash
git add apps/crm/src/pages/entregas
git commit -m "feat(entregas): flag de processos individuais passa a gatear só criação; leitura sempre ligada"
```

---

### Task 4: Mixed-column drag-and-drop persists through `reorder_fluxos_board`

**Files:**
- Modify: `apps/crm/src/pages/entregas/boardReorder.ts` (generic ids + three pure helpers)
- Modify: `apps/crm/src/pages/entregas/views/KanbanView.tsx:60-100, 131-150, 296-400, 413-662, 692, 797, 841-870, 930-990`
- Modify: `apps/crm/src/pages/entregas/EntregasPage.tsx:885-900` (pass `allPostEntities`)
- Test: `apps/crm/src/pages/entregas/__tests__/boardReorder.test.ts` (extend)
- Test: `apps/crm/src/pages/entregas/views/__tests__/KanbanFullColumnOrder.test.tsx` (extend with the mixed variant)

**Interfaces:**
- Consumes: `reorderFluxosBoard` (Task 2), `updateWorkflowPositions` (existing), `sortEntitiesByPrazo`/`sortEntitiesByPosicao`/`toWorkflowEntities` (`boardEntity.ts`), `buildBoardRows`/`findCardColumn` (`boardRows.ts`).
- Produces (all in `boardReorder.ts`):
  - `mergeVisibleReorder<T>(fullOrder: T[], visibleReordered: T[]): T[]` and `insertIntoFullOrder<T>(fullOrder: T[], visibleOrder: T[], slotIndex: number, movedId: T): T[]` — same bodies, generic.
  - `export type BoardSortableId = string` — `'<workflowId>'` for a fluxo (unchanged dnd id) or `'post:<processId>'` for a post.
  - `export function sortableIdOf(e: BoardEntity): BoardSortableId`
  - `export function planColumnPersist(orderedIds: BoardSortableId[]): { kind: 'workflows'; updates: { id: number; position: number }[] } | { kind: 'mixed'; args: ReorderFluxosBoardArgs }` — `'workflows'` when no `post:` id is present (keeps the fase-3 path byte-identical), `'mixed'` otherwise, positions = index.
  - `export function computeCrossColumnSlot(targetDisplay: { id: BoardSortableId; posicao: number }[], slotIndex: number): { beforePos?: number; afterPos?: number; optimisticPos: number }` — the arithmetic currently inline at `KanbanView.tsx:606-615`.
- KanbanView props gain `allPostEntities?: PostEntity[]` (unfiltered, mirrors `allCards`). `fullColumnOrder` gains a sibling `fullMixedColumnOrder(allCards, allPosts, visibleCards, visiblePosts, rowKey, ordem, templates, sortMode, signatureRows): BoardSortableId[]` (exported for tests).

- [ ] **Step 1: Write the failing tests**

Append to `apps/crm/src/pages/entregas/__tests__/boardReorder.test.ts`:

```ts
import { planColumnPersist, computeCrossColumnSlot, sortableIdOf } from '../boardReorder';

describe('sortableIdOf', () => {
  it('fluxo = id numérico em string (id do dnd de hoje); post = id da entidade', () => {
    expect(sortableIdOf({ kind: 'workflow', card: { workflow: { id: 4 } } } as never)).toBe('4');
    expect(sortableIdOf({ kind: 'post', id: 'post:9' } as never)).toBe('post:9');
  });
});

describe('planColumnPersist', () => {
  it('coluna só de fluxos: caminho antigo (reorder_workflow_positions)', () => {
    expect(planColumnPersist(['3', '1', '2'])).toEqual({
      kind: 'workflows',
      updates: [
        { id: 3, position: 0 },
        { id: 1, position: 1 },
        { id: 2, position: 2 },
      ],
    });
  });
  it('coluna mista: um espaço de índices, cada tipo no seu array', () => {
    expect(planColumnPersist(['3', 'post:9', '1'])).toEqual({
      kind: 'mixed',
      args: {
        workflowIds: [3, 1],
        workflowPositions: [0, 2],
        processIds: [9],
        processPositions: [1],
      },
    });
  });
});

describe('computeCrossColumnSlot', () => {
  const col = [
    { id: '1', posicao: 0 },
    { id: 'post:9', posicao: 1 },
    { id: '2', posicao: 4 },
  ];
  it('entre dois vizinhos: média', () => {
    expect(computeCrossColumnSlot(col, 2)).toEqual({ beforePos: 1, afterPos: 4, optimisticPos: 2.5 });
  });
  it('no topo: afterPos - 1; no fim: beforePos + 1; vazio: 0', () => {
    expect(computeCrossColumnSlot(col, 0)).toEqual({ beforePos: undefined, afterPos: 0, optimisticPos: -1 });
    expect(computeCrossColumnSlot(col, 3)).toEqual({ beforePos: 4, afterPos: undefined, optimisticPos: 5 });
    expect(computeCrossColumnSlot([], 0)).toEqual({ beforePos: undefined, afterPos: undefined, optimisticPos: 0 });
  });
});

describe('generic ids', () => {
  it('mergeVisibleReorder e insertIntoFullOrder aceitam ids string mistos', () => {
    expect(mergeVisibleReorder(['1', 'post:9', '2', '3'], ['2', '1'])).toEqual(['2', 'post:9', '1', '3']);
    expect(insertIntoFullOrder(['1', 'post:9', '2'], ['1', 'post:9', '2'], 1, '7')).toEqual(['1', '7', 'post:9', '2']);
  });
});
```

Append to `views/__tests__/KanbanFullColumnOrder.test.tsx` (reuse its `card(id, position)` helper and etapa fixture):

```ts
import { fullMixedColumnOrder } from '../KanbanView';
import type { PostEntity } from '../../boardEntity';

function postEntity(processId: number, posicao: number): PostEntity {
  return {
    kind: 'post',
    id: `post:${processId}`,
    templateId: 2,
    steps: [{ ordem: 1, nome: 'Produção', tipo: 'padrao' }],
    etapaOrdem: 1,
    etapaNome: 'Produção',
    responsavel: undefined,
    prazoEfetivo: null,
    posicao,
    deadline: { diasRestantes: 0, horasRestantes: 0, estourado: false, urgente: false },
    cliente: undefined,
    titulo: `Post ${processId}`,
    process: { id: processId, post_id: 100 + processId, template_id: 2, estado: 'ativo', etapa_atual: 1, steps: [] } as never,
    step: { ordem: 1, estado: 'ativo' } as never,
  };
}

describe('fullMixedColumnOrder', () => {
  it('modo manual: fluxos e posts intercalados por posicao, incluindo ocultos pelo filtro', () => {
    const all = [card(1, 0), card(2, 3)];
    const allPosts = [postEntity(9, 1), postEntity(8, 2)];
    const ids = fullMixedColumnOrder(all, allPosts, [card(1, 0)], [postEntity(9, 1)], 'template:2', 1, [], 'manual');
    expect(ids).toEqual(['1', 'post:9', 'post:8', '2']);
  });
  it('sem posts devolve exatamente fullColumnOrder (caminho da fase 3)', () => {
    const all = [card(1, 2), card(2, 0)];
    expect(fullMixedColumnOrder(all, [], all, [], 'template:2', 1, [], 'manual')).toEqual(['2', '1']);
  });
});
```

(The `card()` helper in that file builds `template_id: 2` cards under row key `template:2`; if its row key differs, use the file's value.)

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run apps/crm/src/pages/entregas/__tests__/boardReorder.test.ts apps/crm/src/pages/entregas/views/__tests__/KanbanFullColumnOrder.test.tsx`
Expected: FAIL — missing exports.

- [ ] **Step 3: `boardReorder.ts`**

Make both existing functions generic (replace `number[]`/`number` with `T[]`/`T`, bodies unchanged) and append:

```ts
import type { BoardEntity } from './boardEntity';
import type { ReorderFluxosBoardArgs } from '../../store';

/** Id que o dnd-kit usa na coluna: fluxo = `String(workflow.id)` (inalterado
 *  desde antes da fase 3), post = o id da entidade (`post:<processId>`). */
export type BoardSortableId = string;

export function sortableIdOf(e: BoardEntity): BoardSortableId {
  return e.kind === 'workflow' ? String(e.card.workflow.id) : e.id;
}

const POST_PREFIX = 'post:';

/**
 * Como persistir a ordem completa de uma coluna (índice = posição). Sem post na
 * coluna, é o caminho que já existia (reorder_workflow_positions); com post, a
 * RPC mista reorder_fluxos_board grava os dois tipos no mesmo espaço (spec §4.2).
 */
export function planColumnPersist(
  orderedIds: BoardSortableId[],
):
  | { kind: 'workflows'; updates: { id: number; position: number }[] }
  | { kind: 'mixed'; args: ReorderFluxosBoardArgs } {
  if (!orderedIds.some((id) => id.startsWith(POST_PREFIX))) {
    return {
      kind: 'workflows',
      updates: orderedIds.map((id, i) => ({ id: Number(id), position: i })),
    };
  }
  const args: ReorderFluxosBoardArgs = {
    workflowIds: [],
    workflowPositions: [],
    processIds: [],
    processPositions: [],
  };
  orderedIds.forEach((id, i) => {
    if (id.startsWith(POST_PREFIX)) {
      args.processIds.push(Number(id.slice(POST_PREFIX.length)));
      args.processPositions.push(i);
    } else {
      args.workflowIds.push(Number(id));
      args.workflowPositions.push(i);
    }
  });
  return { kind: 'mixed', args };
}

/** Posição otimista de um card solto no slot `slotIndex` da lista exibida. */
export function computeCrossColumnSlot(
  targetDisplay: { id: BoardSortableId; posicao: number }[],
  slotIndex: number,
): { beforePos?: number; afterPos?: number; optimisticPos: number } {
  const beforePos = targetDisplay[slotIndex - 1]?.posicao;
  const afterPos = targetDisplay[slotIndex]?.posicao;
  const optimisticPos =
    beforePos != null && afterPos != null
      ? (beforePos + afterPos) / 2
      : afterPos != null
        ? afterPos - 1
        : beforePos != null
          ? beforePos + 1
          : 0;
  return { beforePos, afterPos, optimisticPos };
}
```

- [ ] **Step 4: `KanbanView.tsx` — props, overlays, mixed display, full order**

1. Props (line ~92): add after `postEntities?`:

```ts
  /** Todos os processos ativos, sem o filtro da página (espelho de allCards):
   *  a ordem manual é gravada para a coluna INTEIRA. */
  allPostEntities?: PostEntity[];
```

2. Imports: `import { reorderFluxosBoard } from '../../../store';` (keep `updateWorkflowPositions`), `import { mergeVisibleReorder, insertIntoFullOrder, planColumnPersist, computeCrossColumnSlot, sortableIdOf, type BoardSortableId } from '../boardReorder';`, and `sortEntitiesByPrazo, sortEntitiesByPosicao, toWorkflowEntities` from `../boardEntity` (already partly imported).

3. Optimistic overlay for posts, next to `pendingPositions` (line ~309):

```ts
  // Mesma ideia de pendingPositions, chaveado por process id: posicao otimista
  // de um post reordenado (board_position) até o refetch refletir.
  const [pendingPostPositions, setPendingPostPositions] = useState<Map<number, number>>(new Map());
```

Apply it where `posts` is derived (line ~398):

```ts
  const applyPostOverlay = useCallback(
    (list: PostEntity[]): PostEntity[] =>
      pendingPostPositions.size === 0
        ? list
        : list.map((p) => {
            const pp = pendingPostPositions.get(p.process.id);
            return pp !== undefined && pp !== p.posicao ? { ...p, posicao: pp } : p;
          }),
    [pendingPostPositions],
  );
  const posts = useMemo(() => applyPostOverlay(postEntities ?? EMPTY_POST_ENTITIES), [postEntities, applyPostOverlay]);
  const allPosts = useMemo(
    () => (allPostEntities ? applyPostOverlay(allPostEntities) : undefined),
    [allPostEntities, applyPostOverlay],
  );
```

Release the post overlay in the existing catch-up effect (line ~360) with the same rule as `pendingPositions`: delete an entry once `(allPostEntities ?? postEntities)` shows that process with `posicao === pp`.

4. Replace the inline `mixed` computation in `renderRowBoard` (lines ~849-857) with a shared callback defined next to `displayCards`:

```ts
  /** Lista EXIBIDA da coluna mista (spec §4.2). Sem posts é exatamente
   *  displayCards(...) convertido, na mesma ordem de sempre. */
  const displayMixed = useCallback(
    (rowKey: string, ordem: number, column: BoardColumn): BoardEntity[] => {
      const stepCards = displayCards(rowKey, ordem, column.cards);
      if (column.posts.length === 0) return toWorkflowEntities(stepCards);
      const all = [...toWorkflowEntities(stepCards), ...column.posts];
      return sortModeFor(columnKey(rowKey, ordem)) === 'prazo'
        ? sortEntitiesByPrazo(all)
        : sortEntitiesByPosicao(all);
    },
    [displayCards, sortModeFor],
  );
```

and in `renderRowBoard`: `const mixed = displayMixed(row.key, column.ordem, column);`.

5. Add the exported mixed full-order helper next to `fullColumnOrder` (line ~131):

```ts
export function fullMixedColumnOrder(
  allCards: BoardCard[] | undefined,
  allPosts: PostEntity[] | undefined,
  visibleColumnCards: BoardCard[],
  visibleColumnPosts: PostEntity[],
  rowKey: string,
  ordem: number,
  templates: WorkflowTemplate[],
  sortMode: FluxosColumnSort,
  signatureRows = false,
): BoardSortableId[] {
  if ((allPosts ?? visibleColumnPosts).length === 0 && visibleColumnPosts.length === 0) {
    return fullColumnOrder(allCards, visibleColumnCards, rowKey, ordem, templates, sortMode, signatureRows).map(String);
  }
  const entities: BoardEntity[] = [
    ...toWorkflowEntities(allCards ?? visibleColumnCards),
    ...(allPosts ?? visibleColumnPosts),
  ];
  const column = buildBoardRows(entities, templates, { signatureRows })
    .find((r) => r.key === rowKey)
    ?.columns.find((c) => c.ordem === ordem);
  const source: BoardEntity[] = column
    ? [...toWorkflowEntities(column.cards), ...column.posts]
    : [...toWorkflowEntities(visibleColumnCards), ...visibleColumnPosts];
  const ordered = sortMode === 'prazo' ? sortEntitiesByPrazo(source) : sortEntitiesByPosicao(source);
  return ordered.map(sortableIdOf);
}
```

6. A single persist helper inside the component:

```ts
  // Grava a ordem completa (índice = posição) e aplica o overlay otimista dos
  // dois tipos; devolve uma função de rollback.
  const persistColumnOrder = useCallback(async (orderedIds: BoardSortableId[]) => {
    const plan = planColumnPersist(orderedIds);
    if (plan.kind === 'workflows') {
      await updateWorkflowPositions(plan.updates);
    } else {
      await reorderFluxosBoard(plan.args);
    }
  }, []);
  const applyOptimisticOrder = useCallback((orderedIds: BoardSortableId[]) => {
    const plan = planColumnPersist(orderedIds);
    if (plan.kind === 'workflows') {
      setPendingPositions((prev) => {
        const next = new Map(prev);
        plan.updates.forEach((u) => next.set(u.id, u.position));
        return next;
      });
      return;
    }
    setPendingPositions((prev) => {
      const next = new Map(prev);
      plan.args.workflowIds.forEach((id, i) => next.set(id, plan.args.workflowPositions[i]));
      return next;
    });
    setPendingPostPositions((prev) => {
      const next = new Map(prev);
      plan.args.processIds.forEach((id, i) => next.set(id, plan.args.processPositions[i]));
      return next;
    });
  }, []);
  const rollbackOptimisticOrder = useCallback((orderedIds: BoardSortableId[]) => {
    const plan = planColumnPersist(orderedIds);
    const wfIds = plan.kind === 'workflows' ? plan.updates.map((u) => u.id) : plan.args.workflowIds;
    setPendingPositions((prev) => {
      const next = new Map(prev);
      wfIds.forEach((id) => next.delete(id));
      return next;
    });
    if (plan.kind === 'mixed')
      setPendingPostPositions((prev) => {
        const next = new Map(prev);
        plan.args.processIds.forEach((id) => next.delete(id));
        return next;
      });
  }, []);
```

- [ ] **Step 5: `KanbanView.tsx` — drag handlers over the mixed list**

`handleDragOver` (lines ~477-489): replace `targetCards`/`overIdx` with the mixed list:

```ts
      const targetMixed = displayMixed(targetRow.key, targetColumn.ordem, targetColumn);
      let index = targetMixed.length;
      if (!overId.startsWith(COL_PREFIX)) {
        const overIdx = targetMixed.findIndex((e) => sortableIdOf(e) === overId);
        if (overIdx !== -1) {
          const activeRect = active.rect.current?.translated;
          const after = activeRect && activeRect.top > over.rect.top + over.rect.height / 2;
          index = after ? overIdx + 1 : overIdx;
        }
      }
```

Add `displayMixed` to the deps.

`handleDragEnd` within-column branch (lines ~528-584):

```ts
        const colKeyStr = columnKey(activeLocation.row.key, activeLocation.column.ordem);
        const col = displayMixed(activeLocation.row.key, activeLocation.column.ordem, activeLocation.column);
        const colIds = col.map(sortableIdOf);
        const oldIdx = colIds.indexOf(activeId);
        const newIdx = overId.startsWith(COL_PREFIX) ? colIds.length - 1 : colIds.indexOf(overId);
        if (oldIdx === -1 || newIdx === -1 || oldIdx === newIdx) return;
        const reordered = arrayMove(colIds, oldIdx, newIdx);
        const full = fullMixedColumnOrder(
          localAllCards, allPosts, activeLocation.column.cards, activeLocation.column.posts,
          activeLocation.row.key, activeLocation.column.ordem, templates, sortModeFor(colKeyStr), signatureRows,
        );
        const merged = mergeVisibleReorder(full, reordered);
        applyOptimisticOrder(merged);
        if (sortModeFor(colKeyStr) === 'prazo') setColumnSort(colKeyStr, 'manual');
        try {
          await persistColumnOrder(merged);
          onRefresh();
        } catch (err) {
          rollbackOptimisticOrder(merged);
          toast.error(getPostProcessErrorToast(err, 'Erro ao salvar ordem dos cartões'));
        }
```

(`getPostProcessErrorToast` from `../postProcessErrors`, Task 1.)

Cross-column branch (lines ~600-635): replace the `targetDisplay`/`beforePos`/`afterPos`/`optimisticPos`/`targetFull`/`pendingInsertRef` block with:

```ts
        const targetMixed = displayMixed(targetRow.key, targetColumn.ordem, targetColumn);
        const colKey = columnKey(targetRow.key, targetColumn.ordem);
        const slotIndex =
          dropSlot && dropSlot.colKey === colKey ? Math.min(dropSlot.index, targetMixed.length) : targetMixed.length;
        const { optimisticPos } = computeCrossColumnSlot(
          targetMixed.map((e) => ({ id: sortableIdOf(e), posicao: e.posicao })),
          slotIndex,
        );
        const targetFull = fullMixedColumnOrder(
          localAllCards, allPosts, targetColumn.cards, targetColumn.posts,
          targetRow.key, targetColumn.ordem, templates, sortModeFor(colKey), signatureRows,
        );
        pendingInsertRef.current = {
          wfId: draggedCard.workflow.id!,
          ids: insertIntoFullOrder(targetFull, targetMixed.map(sortableIdOf), slotIndex, activeId),
          optimisticPos,
        };
```

Change the ref type to `ids: BoardSortableId[]`. In `advanceEtapa` (line ~692) and `handleRevertConfirm` (line ~797) replace `await updateWorkflowPositions(insert.ids.map((id, i) => ({ id, position: i })));` with `await persistColumnOrder(insert.ids);` (still inside the best-effort try/catch with the `console.warn`). Add `allPosts`, `displayMixed`, `persistColumnOrder`, `applyOptimisticOrder`, `rollbackOptimisticOrder` to the relevant dep arrays.

- [ ] **Step 6: `KanbanView.tsx` — drop slot over the mixed list**

In `renderRowBoard`'s `mixed.map(...)` (lines ~930-990), render the slot by mixed index for BOTH kinds:

```tsx
                  mixed.map((entity, idx) => {
                    const slot = colKeyStr === dropSlot?.colKey && dropSlot.index === idx && (
                      <div className="board-drop-slot" style={{ height: dragHeight }} aria-hidden="true" />
                    );
                    if (entity.kind === 'post') {
                      return (
                        <Fragment key={entity.id}>
                          {slot}
                          <SortablePostCard entity={entity} onClick={onPostClick ? () => onPostClick(entity) : undefined} />
                        </Fragment>
                      );
                    }
                    const card = entity.card;
                    return (
                      <Fragment key={card.workflow.id}>
                        {slot}
                        <SortableCard ... (unchanged props) />
                      </Fragment>
                    );
                  })
```

and the trailing slot condition becomes `dropSlot.index >= mixed.length`. Delete the now-unused `cardIdx`/`stepCards.indexOf`.

- [ ] **Step 7: `EntregasPage.tsx`**

At the `KanbanView` mount (line ~885): add `allPostEntities={postEntities}` (the hook's unfiltered list; `postEntities={visiblePostEntities}` stays).

- [ ] **Step 8: Run tests + typecheck**

Run: `npx vitest run apps/crm/src/pages/entregas && npx tsc -p apps/crm/tsconfig.json --noEmit`
Expected: PASS, including `KanbanPostEntities`, `KanbanPrazoSort`, `KanbanFullColumnOrder`, `KanbanDuplicateNames`, `KanbanSync`, `KanbanRearm` unchanged. `KanbanRearm`/`KanbanFullColumnOrder`'s hoisted store mocks need `reorderFluxosBoard: vi.fn()` added (the import now exists even when unused on the workflows-only path).

- [ ] **Step 9: Commit**

```bash
git add apps/crm/src/pages/entregas
git commit -m "fix(entregas): reordenar coluna mista do quadro de Fluxos grava fluxos e posts numa RPC só"
```

---

### Task 5: `approvalAdvance.ts` extraction, three fluxo call sites, entity-agnostic step dialogs

**Files:**
- Create: `apps/crm/src/pages/entregas/approvalAdvance.ts`
- Modify: `apps/crm/src/pages/entregas/views/KanbanView.tsx:714-731, 1056-1096`
- Modify: `apps/crm/src/pages/cliente-detalhe/tabs/EntregasTab.tsx:409-424, 694-724`
- Modify: `apps/crm/src/pages/entregas/components/WorkflowDrawer.tsx:231-259`
- Modify: `apps/crm/src/pages/entregas/components/WorkflowModals.tsx:910-1050` (three dialogs)
- Test: `apps/crm/src/pages/entregas/__tests__/approvalAdvance.test.ts` (create)
- Test: `apps/crm/src/pages/cliente-detalhe/tabs/__tests__/EntregasTabRearm.test.ts:52-59` (rewrite one case)
- Test: `apps/crm/src/pages/entregas/components/__tests__/WorkflowModals.test.tsx`, `ClientApprovalChoiceDialog.test.tsx` (prop rename + two new cases)
- Test: `apps/crm/src/pages/entregas/components/__tests__/WorkflowDrawerAutoComplete.test.tsx` (one new case)

**Interfaces:**
- Consumes: `CLIENT_CLEARED_STATUSES` (`store/posts.ts:766`), `hasLaterApprovalEtapa` (`store/workflows.ts:340`, unchanged: fluxos ignore status by design, spec §6.2).
- Produces:

```ts
// approvalAdvance.ts
export interface ApprovalAdvanceInput {
  tipo: 'padrao' | 'aprovacao_cliente' | null | undefined;
  total: number;           // posts considered (fluxo: postsCounts; post individual: 1)
  cleared: number;         // posts with status ∈ CLIENT_CLEARED_STATUSES
  temAprovacaoAdiante: boolean;
}
export type ApprovalAdvanceDecision =
  | { kind: 'advance'; willRearm: boolean }   // no dialog; willRearm is informational (the fluxo store re-arms on its own)
  | { kind: 'choose'; willRearm: boolean };   // open ClientApprovalChoiceDialog with willRearm
export function decideApprovalAdvance(input: ApprovalAdvanceInput): ApprovalAdvanceDecision;
export function isClientCleared(status: string | null | undefined): boolean;
/** Processo individual: só etapas aprovacao_cliente PENDENTES contam (spec §6.2). */
export function hasLaterPendingApprovalStep(
  steps: readonly { ordem: number; tipo: string; estado: string }[],
  currentOrdem: number,
): boolean;
```

- Dialog props in `WorkflowModals.tsx`: `RevertConfirmDialog`/`ForwardConfirmDialog`/`ClientApprovalChoiceDialog` rename `workflowTitle` → `entityTitle`. `ClientApprovalChoiceDialog` additionally gains `entityKind?: 'fluxo' | 'post'` (default `'fluxo'`; selects singular copy), `withoutChangesLabel?: string` (default `'Avançar etapa sem alterar posts'`), `sendToPortalDisabledReason?: string` (when set, the "Enviar ao portal do cliente" button is disabled and the reason is rendered under it).
- Callers keep state as `approvalChoice: { card: BoardCard; willRearm: boolean } | null` (replacing `approvalChoiceCard`) so the dialog's `willRearm` comes from the decision, not from JSX.

- [ ] **Step 1: Write the failing tests**

```ts
// apps/crm/src/pages/entregas/__tests__/approvalAdvance.test.ts
import { describe, expect, it } from 'vitest';
import {
  decideApprovalAdvance,
  hasLaterPendingApprovalStep,
  isClientCleared,
} from '../approvalAdvance';

describe('decideApprovalAdvance', () => {
  it('etapa padrão sempre avança, sem re-arm', () => {
    expect(decideApprovalAdvance({ tipo: 'padrao', total: 3, cleared: 0, temAprovacaoAdiante: true }))
      .toEqual({ kind: 'advance', willRearm: false });
    expect(decideApprovalAdvance({ tipo: null, total: 0, cleared: 0, temAprovacaoAdiante: false }))
      .toEqual({ kind: 'advance', willRearm: false });
  });
  it('aprovação com todos liberados avança e informa o re-arm', () => {
    expect(decideApprovalAdvance({ tipo: 'aprovacao_cliente', total: 2, cleared: 2, temAprovacaoAdiante: true }))
      .toEqual({ kind: 'advance', willRearm: true });
  });
  it('aprovação com pendência (ou sem posts) abre a escolha', () => {
    expect(decideApprovalAdvance({ tipo: 'aprovacao_cliente', total: 2, cleared: 1, temAprovacaoAdiante: false }))
      .toEqual({ kind: 'choose', willRearm: false });
    // total 0: a regra `total > 0 && cleared === total` dos fluxos fica igual.
    expect(decideApprovalAdvance({ tipo: 'aprovacao_cliente', total: 0, cleared: 0, temAprovacaoAdiante: true }))
      .toEqual({ kind: 'choose', willRearm: true });
  });
  it('post individual: total 1, cleared 0/1', () => {
    expect(decideApprovalAdvance({ tipo: 'aprovacao_cliente', total: 1, cleared: 1, temAprovacaoAdiante: false }).kind).toBe('advance');
    expect(decideApprovalAdvance({ tipo: 'aprovacao_cliente', total: 1, cleared: 0, temAprovacaoAdiante: false }).kind).toBe('choose');
  });
});

describe('isClientCleared', () => {
  it('é a mesma lista de CLIENT_CLEARED_STATUSES', () => {
    for (const s of ['aprovado_cliente', 'agendado', 'postado', 'falha_publicacao']) expect(isClientCleared(s)).toBe(true);
    for (const s of ['rascunho', 'aprovado_interno', 'enviado_cliente', 'correcao_cliente', null, undefined]) expect(isClientCleared(s)).toBe(false);
  });
});

describe('hasLaterPendingApprovalStep', () => {
  const steps = [
    { ordem: 0, tipo: 'padrao', estado: 'concluido' },
    { ordem: 1, tipo: 'aprovacao_cliente', estado: 'ativo' },
    { ordem: 2, tipo: 'aprovacao_cliente', estado: 'herdado' },
    { ordem: 3, tipo: 'aprovacao_cliente', estado: 'pendente' },
  ];
  it('só conta aprovações PENDENTES com ordem maior', () => {
    expect(hasLaterPendingApprovalStep(steps, 1)).toBe(true);
    expect(hasLaterPendingApprovalStep(steps.filter((s) => s.ordem !== 3), 1)).toBe(false);
    expect(hasLaterPendingApprovalStep(steps, 3)).toBe(false);
  });
});
```

Rewrite the last case of `EntregasTabRearm.test.ts` (lines 52-59):

```ts
  it('decides through the shared approvalAdvance module and forwards willRearm from it', () => {
    expect(source).toContain(
      "import { decideApprovalAdvance } from '@/pages/entregas/approvalAdvance'",
    );
    expect(source).toMatch(/decideApprovalAdvance\(\{/);
    // hasLaterApprovalEtapa is still the fluxo input to the decision (spec §6.2: not changed).
    expect(source).toContain('hasLaterApprovalEtapa');
    // The dialog no longer recomputes the warning inline.
    expect(source).not.toMatch(/willRearm=\{\s*approvalChoiceCard/);
    expect(source).toMatch(/willRearm=\{approvalChoice\?\.willRearm \?\? false\}/);
  });
```

Also in that file, `handleAdvanceWithoutApproval`'s slice boundaries (`const handleAdvanceWithoutApproval` … `const handleRevertClick`) stay valid; keep the other four cases.

Add to `ClientApprovalChoiceDialog.test.tsx` (rename every `workflowTitle=` to `entityTitle=` in existing cases, then add):

```ts
  it('post individual: cópia no singular e botão do portal desabilitado com o motivo', () => {
    render(
      <ClientApprovalChoiceDialog
        open
        entityTitle="Post X"
        entityKind="post"
        willRearm
        withoutChangesLabel="Avançar etapa sem alterar o post"
        sendToPortalDisabledReason="Só posts aprovados internamente podem ser enviados ao cliente."
        onApproveInternally={vi.fn()}
        onSendToPortal={vi.fn()}
        onAdvanceWithoutChanges={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(screen.getByText(/o post aprovado voltará para rascunho/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Enviar ao portal do cliente' })).toBeDisabled();
    expect(screen.getByText('Só posts aprovados internamente podem ser enviados ao cliente.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Avançar etapa sem alterar o post' })).toBeInTheDocument();
  });
```

In `WorkflowModals.test.tsx` rename `workflowTitle` → `entityTitle` wherever the three dialogs are rendered.

Add to `WorkflowDrawerAutoComplete.test.tsx` (reuse its render helper and post fixtures; the file already drives the awaiting → aprovado_cliente transition):

```ts
  it('não completa a etapa quando um post do fluxo continua sem liberação (decisão compartilhada)', async () => {
    // prev: [enviado_cliente, rascunho] -> next: [aprovado_cliente, rascunho]
    store.getWorkflowPostsWithProperties
      .mockResolvedValueOnce([post(1, 'enviado_cliente'), post(2, 'rascunho')])
      .mockResolvedValueOnce([post(1, 'aprovado_cliente'), post(2, 'rascunho')]);
    renderDrawerAndRefetch();
    await waitFor(() => expect(store.getWorkflowPostsWithProperties).toHaveBeenCalledTimes(2));
    expect(store.completeEtapaWithRearm).not.toHaveBeenCalled();
    expect(store.completeEtapa).not.toHaveBeenCalled();
  });
```

(Adapt `post(...)`/`renderDrawerAndRefetch` to the helper names that file actually defines; the intent is: the second fetch still contains a non-cleared post, so no auto-complete.)

- [ ] **Step 2: Run to verify failures**

Run: `npx vitest run apps/crm/src/pages/entregas/__tests__/approvalAdvance.test.ts apps/crm/src/pages/cliente-detalhe/tabs/__tests__/EntregasTabRearm.test.ts apps/crm/src/pages/entregas/components/__tests__/ClientApprovalChoiceDialog.test.tsx apps/crm/src/pages/entregas/components/__tests__/WorkflowDrawerAutoComplete.test.tsx`
Expected: FAIL (module missing; source regexes; prop unknown; auto-complete fires).

- [ ] **Step 3: Create `approvalAdvance.ts`**

```ts
// apps/crm/src/pages/entregas/approvalAdvance.ts
import { CLIENT_CLEARED_STATUSES } from '../../store';

/**
 * A decisão de "avançar uma etapa de aprovação do cliente" (spec §6.2), num
 * único lugar. Antes vivia em três: KanbanView.executeForward,
 * EntregasTab.handleForwardConfirm e o auto-complete do WorkflowDrawer.
 * Fluxos passam `total`/`cleared` das contagens por fluxo e
 * `temAprovacaoAdiante = hasLaterApprovalEtapa(...)` (que ignora status, de
 * propósito). O processo individual passa `total = 1`,
 * `cleared = isClientCleared(post.status) ? 1 : 0` e
 * `temAprovacaoAdiante = hasLaterPendingApprovalStep(...)` (só pendentes).
 */
export interface ApprovalAdvanceInput {
  tipo: 'padrao' | 'aprovacao_cliente' | null | undefined;
  total: number;
  cleared: number;
  temAprovacaoAdiante: boolean;
}

export type ApprovalAdvanceDecision =
  | { kind: 'advance'; willRearm: boolean }
  | { kind: 'choose'; willRearm: boolean };

export function decideApprovalAdvance(input: ApprovalAdvanceInput): ApprovalAdvanceDecision {
  if (input.tipo !== 'aprovacao_cliente') return { kind: 'advance', willRearm: false };
  const allCleared = input.total > 0 && input.cleared === input.total;
  if (allCleared) return { kind: 'advance', willRearm: input.temAprovacaoAdiante };
  return { kind: 'choose', willRearm: input.temAprovacaoAdiante };
}

const CLEARED = new Set<string>(CLIENT_CLEARED_STATUSES as unknown as string[]);

export function isClientCleared(status: string | null | undefined): boolean {
  return status != null && CLEARED.has(status);
}

export function hasLaterPendingApprovalStep(
  steps: readonly { ordem: number; tipo: string; estado: string }[],
  currentOrdem: number,
): boolean {
  return steps.some(
    (s) => s.ordem > currentOrdem && s.tipo === 'aprovacao_cliente' && s.estado === 'pendente',
  );
}
```

- [ ] **Step 4: `WorkflowModals.tsx` dialogs**

Rename the prop `workflowTitle` → `entityTitle` in the three prop interfaces, destructurings and JSX (lines 913/919/934, 950/957/973, 988/998/1017). Extend `ClientApprovalChoiceDialogProps`:

```ts
  /** Título do fluxo ou do post (spec §4.2: os diálogos recebem a entidade). */
  entityTitle: string;
  /** Muda a cópia para o singular no processo individual. */
  entityKind?: 'fluxo' | 'post';
  /** Rótulo da terceira opção; o processo individual usa "…sem alterar o post"
   *  ou "Concluir sem alterar o post". */
  withoutChangesLabel?: string;
  /** Quando definido, desabilita "Enviar ao portal do cliente" e mostra o motivo
   *  (spec §6.2: com n=1, botão desabilitado com o motivo, nunca sucesso vazio). */
  sendToPortalDisabledReason?: string;
```

Body changes:

```tsx
        {willRearm && (
          <p className="text-sm" style={{ color: 'var(--warning)' }}>
            {entityKind === 'post'
              ? 'Há outra etapa de aprovação adiante. Ao concluir esta, o post aprovado voltará para rascunho para o próximo ciclo de aprovação.'
              : 'Há outra etapa de aprovação adiante — ao concluir esta, os posts aprovados voltarão para rascunho para o próximo ciclo de aprovação.'}
          </p>
        )}
        <DialogFooter className="flex-col gap-2 sm:flex-col">
          <Button className="w-full" onClick={onApproveInternally}>Aprovar internamente</Button>
          <Button className="w-full" variant="outline" onClick={onSendToPortal} disabled={!!sendToPortalDisabledReason}>
            Enviar ao portal do cliente
          </Button>
          {sendToPortalDisabledReason && (
            <p className="text-xs text-muted-foreground" style={{ marginTop: '-0.25rem' }}>{sendToPortalDisabledReason}</p>
          )}
          <Button className="w-full" variant="secondary" onClick={onAdvanceWithoutChanges}>
            {withoutChangesLabel ?? 'Avançar etapa sem alterar posts'}
          </Button>
          <Button className="w-full" variant="ghost" onClick={onCancel}>Cancelar</Button>
        </DialogFooter>
```

(The pre-existing fluxo sentence keeps its em-dash; the new post sentence uses a period.)

- [ ] **Step 5: `KanbanView.tsx`**

- Rename state: `const [approvalChoice, setApprovalChoice] = useState<{ card: BoardCard; willRearm: boolean } | null>(null);` (replace every `approvalChoiceCard`/`setApprovalChoiceCard` use; the handlers read `approvalChoice.card`).
- `executeForward` (lines 714-731):

```ts
  const executeForward = useCallback(
    (card: BoardCard) => {
      const wfId = card.workflow.id!;
      const decision = decideApprovalAdvance({
        tipo: card.etapa.tipo,
        total: postsCounts.get(wfId) ?? 0,
        // "Cleared" (approved / scheduled / posted / publish-failed), not just aprovado_cliente.
        cleared: clearedClienteCounts.get(wfId) ?? 0,
        temAprovacaoAdiante: hasLaterApprovalEtapa(card.allEtapas, card.etapa.id!),
      });
      if (decision.kind === 'choose') setApprovalChoice({ card, willRearm: decision.willRearm });
      else advanceEtapa(card, 'Etapa concluída!');
    },
    [advanceEtapa, postsCounts, clearedClienteCounts],
  );
```

- JSX (lines 1056-1096): `entityTitle={forwardTarget?.workflow.titulo || ''}`, `entityTitle={revertTarget?.title || ''}`, and for the choice dialog `open={!!approvalChoice}`, `entityTitle={approvalChoice?.card.workflow.titulo || ''}`, `willRearm={approvalChoice?.willRearm ?? false}`.
- Import `decideApprovalAdvance` from `'../approvalAdvance'`.

- [ ] **Step 6: `EntregasTab.tsx`**

Same three changes: state `approvalChoice`, `handleForwardConfirm` uses `decideApprovalAdvance({ tipo: card.etapa.tipo, total, cleared, temAprovacaoAdiante: hasLaterApprovalEtapa(card.allEtapas, card.etapa.id!) })` and `if (decision.kind === 'choose') { setApprovalChoice({ card, willRearm: decision.willRearm }); return; }`; JSX at 694-724 uses `entityTitle=` and `willRearm={approvalChoice?.willRearm ?? false}`. Import line exactly: `import { decideApprovalAdvance } from '@/pages/entregas/approvalAdvance';` (the source-text test pins this string).

- [ ] **Step 7: `WorkflowDrawer.tsx` auto-complete (lines 231-259)**

After `if (!approvalEtapa) return;` insert:

```ts
    // Mesma decisão dos botões (spec §6.2): só auto-completa quando TODOS os
    // posts estão liberados. Um post ainda em rascunho nunca foi enviado e
    // continua pedindo a escolha explícita do usuário.
    const decision = decideApprovalAdvance({
      tipo: 'aprovacao_cliente',
      total: posts.length,
      cleared: posts.filter((p) => isClientCleared(p.status)).length,
      temAprovacaoAdiante: hasLaterApprovalEtapa(card.allEtapas, approvalEtapa.id!),
    });
    if (decision.kind !== 'advance') return;
```

Imports: `decideApprovalAdvance, isClientCleared` from `'../approvalAdvance'`; `hasLaterApprovalEtapa` from `'../../../store'`.

- [ ] **Step 8: Run all touched suites + typecheck**

Run: `npx vitest run apps/crm/src/pages/entregas apps/crm/src/pages/cliente-detalhe && npx tsc -p apps/crm/tsconfig.json --noEmit`
Expected: PASS. `KanbanRearm.test.tsx`, `EntregasTab.test.tsx` and `WorkflowDrawer.test.tsx` mock `hasLaterApprovalEtapa`; they need no change unless they assert the `willRearm` JSX string.

- [ ] **Step 9: Commit**

```bash
git add apps/crm/src/pages/entregas apps/crm/src/pages/cliente-detalhe
git commit -m "refactor(entregas): decisão de avanço em etapa de aprovação num módulo puro; diálogos por entidade"
```

---

### Task 6: Local-day helpers, the two timezone bugs, pure deadline builders for aplicar/desmembrar

**Files:**
- Modify: `apps/crm/src/utils/postDate.ts` (append three helpers)
- Modify: `apps/crm/src/store/workflows.ts:541` (`_computeDeliveryDeadlines` `toISO`)
- Modify: `apps/crm/src/pages/entregas/hooks/useEntregasData.ts:173-207` (`computeDeliveryDeadlines` `toISO` + structural param type)
- Create: `apps/crm/src/pages/entregas/applyProcessDeadlines.ts`
- Create: `apps/crm/src/pages/entregas/detachDeadlines.ts`
- Test: `apps/crm/src/utils/__tests__/postDate.test.ts` (extend or create)
- Test: `apps/crm/src/pages/entregas/__tests__/deliveryDeadlinesTimezone.test.ts` (create)
- Test: `apps/crm/src/pages/entregas/__tests__/applyProcessDeadlines.test.ts` (create)
- Test: `apps/crm/src/pages/entregas/__tests__/detachDeadlines.test.ts` (create)

**Interfaces:**
- Consumes: `computeDeadlineDate`, `computeDeliveryDeadlines`, `getNextDeliveryDate` (`hooks/useEntregasData.ts`), `etapaDeadlineDateOf` (`etapaPrazo.ts`), `StepOverrides` (Task 2), `WorkflowTemplate`/`WorkflowEtapa` (store).
- Produces:

```ts
// utils/postDate.ts
export function toLocalISODate(d: Date): string;          // 'YYYY-MM-DD' from LOCAL components
export function parseLocalISODate(s: string): Date | null; // local midnight of 'YYYY-MM-DD'
export function endOfLocalDay(d: Date): Date;              // 23:59:59.999 local of that day

// hooks/useEntregasData.ts
export type DeliveryStep = { ordem: number; tipo?: 'padrao' | 'aprovacao_cliente' | null; prazo_dias: number; tipo_prazo: 'corridos' | 'uteis' };
export function computeDeliveryDeadlines(etapas: DeliveryStep[], deliveryDate: Date): Map<number, string>; // unchanged name; structural param

// applyProcessDeadlines.ts
export type ModoPrazo = 'padrao' | 'data_fixa' | 'data_entrega';
export interface ApplyPlanInput {
  template: WorkflowTemplate; startOrdem: number; now: Date;
  fixedDates: Record<number, string | undefined>;   // data_fixa: 'YYYY-MM-DD' per ordem >= start
  deliveryDate: Date | null;                         // data_entrega: resolved local date, or null
  clienteHasDiaEntrega: boolean;
  responsaveis: Record<number, number | null | undefined>; // undefined = template default
}
export interface ApplyPlanStep { ordem: number; nome: string; tipo: 'padrao' | 'aprovacao_cliente'; estado: 'ignorado' | 'ativo' | 'pendente'; responsavelId: number | null; prazoEfetivo: string | null }
export interface ApplyPlan { modo: ModoPrazo; steps: ApplyPlanStep[]; overrides: StepOverrides; blockers: string[]; needsApprovalStep: boolean }
export function buildApplyPlan(input: ApplyPlanInput): ApplyPlan;

// detachDeadlines.ts
export function buildDetachDeadlines(allEtapas: WorkflowEtapa[], activeEtapa: WorkflowEtapa): { activeDeadline: string | null; stepDeadlines: Record<string, string> | null };
```

- [ ] **Step 1: Write the failing tests**

```ts
// apps/crm/src/utils/__tests__/postDate.test.ts (append; create with this content if absent)
import { describe, expect, it } from 'vitest';
import { endOfLocalDay, parseLocalISODate, toLocalISODate } from '../postDate';

describe('local-day helpers', () => {
  it('toLocalISODate usa os componentes locais, nunca o dia UTC', () => {
    const late = new Date(2026, 8, 15, 23, 30);
    const early = new Date(2026, 8, 15, 0, 30);
    expect(toLocalISODate(late)).toBe('2026-09-15');
    expect(toLocalISODate(early)).toBe('2026-09-15');
    expect(toLocalISODate(new Date(2026, 0, 5))).toBe('2026-01-05');
  });
  it('parseLocalISODate devolve meia-noite local e null para lixo', () => {
    const d = parseLocalISODate('2026-09-15')!;
    expect([d.getFullYear(), d.getMonth(), d.getDate(), d.getHours()]).toEqual([2026, 8, 15, 0]);
    expect(parseLocalISODate('2026-09-15T12:00:00Z')!.getDate()).toBe(15);
    expect(parseLocalISODate('')).toBeNull();
    expect(parseLocalISODate('nope')).toBeNull();
  });
  it('endOfLocalDay é 23:59:59.999 local do mesmo dia', () => {
    const e = endOfLocalDay(new Date(2026, 8, 15, 9, 0));
    expect([e.getDate(), e.getHours(), e.getMinutes(), e.getSeconds(), e.getMilliseconds()]).toEqual([15, 23, 59, 59, 999]);
  });
});
```

```ts
// apps/crm/src/pages/entregas/__tests__/deliveryDeadlinesTimezone.test.ts
// Roda em UTC-3 de propósito: Node relê TZ quando process.env.TZ muda (v13+).
// Com toISOString().split('T')[0] uma data local às 23:30 vira o DIA SEGUINTE
// em UTC; é o bug que a spec §7 manda corrigir nas duas cópias.
process.env.TZ = 'America/Sao_Paulo';
import { describe, expect, it } from 'vitest';
import { computeDeliveryDeadlines } from '../hooks/useEntregasData';
import { _computeDeliveryDeadlines } from '../../../store/workflows';

const etapas = [
  { id: 1, workflow_id: 1, ordem: 0, nome: 'Copy', prazo_dias: 2, tipo_prazo: 'corridos' as const, tipo: 'padrao' as const, status: 'pendente' as const },
  { id: 2, workflow_id: 1, ordem: 1, nome: 'Aprovação', prazo_dias: 1, tipo_prazo: 'corridos' as const, tipo: 'aprovacao_cliente' as const, status: 'pendente' as const },
  { id: 3, workflow_id: 1, ordem: 2, nome: 'Publicação', prazo_dias: 1, tipo_prazo: 'corridos' as const, tipo: 'padrao' as const, status: 'pendente' as const },
];

describe('data_entrega no fuso local', () => {
  it('as duas implementações devolvem o dia LOCAL da entrega às 23:30', () => {
    const delivery = new Date(2026, 8, 15, 23, 30);
    expect(computeDeliveryDeadlines(etapas, delivery).get(1)).toBe('2026-09-15');
    expect(_computeDeliveryDeadlines(etapas, delivery).get(1)).toBe('2026-09-15');
    // Anterior: 15 - 1 dia (prazo da aprovação) = 14; posterior: 15 + 1 = 16.
    expect(computeDeliveryDeadlines(etapas, delivery).get(0)).toBe('2026-09-14');
    expect(computeDeliveryDeadlines(etapas, delivery).get(2)).toBe('2026-09-16');
  });
});
```

```ts
// apps/crm/src/pages/entregas/__tests__/applyProcessDeadlines.test.ts
import { describe, expect, it } from 'vitest';
import { buildApplyPlan } from '../applyProcessDeadlines';
import type { WorkflowTemplate } from '../../../store';

const NOW = new Date(2026, 8, 14, 10, 0); // segunda-feira 14/09/2026 10:00 local

const padrao: WorkflowTemplate = {
  id: 3, nome: 'Redes', modo_prazo: 'padrao',
  etapas: [
    { nome: 'Copy', prazo_dias: 2, tipo_prazo: 'corridos', tipo: 'padrao', responsavel_id: 9 },
    { nome: 'Design', prazo_dias: 3, tipo_prazo: 'uteis', tipo: 'padrao' },
    { nome: 'Aprovação', prazo_dias: 1, tipo_prazo: 'corridos', tipo: 'aprovacao_cliente' },
  ],
};

describe('buildApplyPlan padrao', () => {
  it('só a etapa inicial recebe prazo (calculado de agora); anteriores ignoradas; responsável do template', () => {
    const plan = buildApplyPlan({ template: padrao, startOrdem: 1, now: NOW, fixedDates: {}, deliveryDate: null, clienteHasDiaEntrega: true, responsaveis: {} });
    expect(plan.blockers).toEqual([]);
    expect(plan.steps.map((s) => s.estado)).toEqual(['ignorado', 'ativo', 'pendente']);
    // 3 dias úteis a partir de segunda 14/09 = quinta 17/09
    expect(new Date(plan.steps[1].prazoEfetivo!).getDate()).toBe(17);
    expect(plan.steps[2].prazoEfetivo).toBeNull();
    expect(plan.overrides).toEqual({
      '1': { responsavel_id: null, prazo_efetivo: plan.steps[1].prazoEfetivo },
      '2': { responsavel_id: null, prazo_efetivo: null },
    });
    expect(plan.overrides['0']).toBeUndefined();
  });
  it('responsável do template e override do usuário', () => {
    const plan = buildApplyPlan({ template: padrao, startOrdem: 0, now: NOW, fixedDates: {}, deliveryDate: null, clienteHasDiaEntrega: true, responsaveis: { 1: 4 } });
    expect(plan.steps[0].responsavelId).toBe(9);
    expect(plan.steps[1].responsavelId).toBe(4);
    expect(plan.overrides['0'].responsavel_id).toBe(9);
    expect(plan.overrides['1'].responsavel_id).toBe(4);
  });
  it('template vazio e etapa inicial fora do intervalo são bloqueios', () => {
    expect(buildApplyPlan({ template: { ...padrao, etapas: [] }, startOrdem: 0, now: NOW, fixedDates: {}, deliveryDate: null, clienteHasDiaEntrega: true, responsaveis: {} }).blockers).toContain('Este modelo não tem etapas.');
    expect(buildApplyPlan({ template: padrao, startOrdem: 5, now: NOW, fixedDates: {}, deliveryDate: null, clienteHasDiaEntrega: true, responsaveis: {} }).blockers).toContain('Escolha a etapa inicial.');
  });
});

describe('buildApplyPlan data_fixa', () => {
  const tpl: WorkflowTemplate = { ...padrao, modo_prazo: 'data_fixa' };
  it('exige data por etapa a partir da inicial e grava fim do dia local', () => {
    const missing = buildApplyPlan({ template: tpl, startOrdem: 1, now: NOW, fixedDates: { 1: '2026-09-20' }, deliveryDate: null, clienteHasDiaEntrega: true, responsaveis: {} });
    expect(missing.blockers).toEqual(['Informe a data da etapa "Aprovação".']);
    const ok = buildApplyPlan({ template: tpl, startOrdem: 1, now: NOW, fixedDates: { 1: '2026-09-20', 2: '2026-09-22' }, deliveryDate: null, clienteHasDiaEntrega: true, responsaveis: {} });
    expect(ok.blockers).toEqual([]);
    const d = new Date(ok.steps[1].prazoEfetivo!);
    expect([d.getDate(), d.getHours(), d.getMinutes()]).toEqual([20, 23, 59]);
    expect(ok.overrides['2'].prazo_efetivo).toBe(new Date(2026, 8, 22, 23, 59, 59, 999).toISOString());
  });
});

describe('buildApplyPlan data_entrega', () => {
  const tpl: WorkflowTemplate = { ...padrao, modo_prazo: 'data_entrega' };
  it('bloqueia sem dia de entrega, sem mês e sem aprovação a partir da inicial', () => {
    expect(buildApplyPlan({ template: tpl, startOrdem: 0, now: NOW, fixedDates: {}, deliveryDate: null, clienteHasDiaEntrega: false, responsaveis: {} }).blockers).toContain('O cliente não tem dia de entrega configurado.');
    expect(buildApplyPlan({ template: tpl, startOrdem: 0, now: NOW, fixedDates: {}, deliveryDate: null, clienteHasDiaEntrega: true, responsaveis: {} }).blockers).toContain('Escolha o mês de entrega.');
    const noApproval = buildApplyPlan({ template: { ...tpl, etapas: tpl.etapas.slice(0, 2) }, startOrdem: 0, now: NOW, fixedDates: {}, deliveryDate: new Date(2026, 9, 10), clienteHasDiaEntrega: true, responsaveis: {} });
    expect(noApproval.needsApprovalStep).toBe(true);
    expect(noApproval.blockers).toContain('O modelo precisa de uma etapa de aprovação do cliente a partir da etapa inicial.');
  });
  it('materializa todas as etapas a partir da inicial ancoradas na data de entrega', () => {
    const plan = buildApplyPlan({ template: tpl, startOrdem: 0, now: NOW, fixedDates: {}, deliveryDate: new Date(2026, 9, 10), clienteHasDiaEntrega: true, responsaveis: {} });
    expect(plan.blockers).toEqual([]);
    // Aprovação (ordem 2) = 10/10; Design (ordem 1) = 10/10 - 1 dia corrido da aprovação = 09/10;
    // Copy (ordem 0) = 09/10 - 3 dias úteis do Design = 06/10 (sexta 09 -> qui 08, qua 07, ter 06).
    expect(new Date(plan.steps[2].prazoEfetivo!).getDate()).toBe(10);
    expect(new Date(plan.steps[1].prazoEfetivo!).getDate()).toBe(9);
    expect(new Date(plan.steps[0].prazoEfetivo!).getDate()).toBe(6);
    expect(Object.keys(plan.overrides)).toEqual(['0', '1', '2']);
  });
});
```

```ts
// apps/crm/src/pages/entregas/__tests__/detachDeadlines.test.ts
import { describe, expect, it } from 'vitest';
import { buildDetachDeadlines } from '../detachDeadlines';
import type { WorkflowEtapa } from '../../../store';

const base = { workflow_id: 1, prazo_dias: 2, tipo_prazo: 'corridos' as const, tipo: 'padrao' as const };
const etapas: WorkflowEtapa[] = [
  { ...base, id: 1, ordem: 0, nome: 'Copy', status: 'concluido', iniciado_em: '2026-09-01T12:00:00Z', data_limite: null },
  { ...base, id: 2, ordem: 1, nome: 'Design', status: 'ativo', iniciado_em: '2026-09-10T12:00:00Z', data_limite: null },
  { ...base, id: 3, ordem: 2, nome: 'Aprovação', status: 'pendente', iniciado_em: null, data_limite: '2026-09-20' },
  { ...base, id: 4, ordem: 3, nome: 'Publicação', status: 'pendente', iniciado_em: null, data_limite: null },
];

describe('buildDetachDeadlines', () => {
  it('etapa ativa relativa: iniciado_em + prazo; futuras com data_limite entram no mapa como fim do dia local', () => {
    const r = buildDetachDeadlines(etapas, etapas[1]);
    expect(r.activeDeadline).toBe(new Date('2026-09-12T12:00:00Z').toISOString());
    expect(r.stepDeadlines).toEqual({ '2': new Date(2026, 8, 20, 23, 59, 59, 999).toISOString() });
  });
  it('etapa ativa com data_limite: fim daquele dia local; sem futuras com data o mapa é null', () => {
    const withLimit = { ...etapas[1], data_limite: '2026-09-11' };
    const r = buildDetachDeadlines([etapas[0], withLimit, { ...etapas[2], data_limite: null }], withLimit);
    expect(r.activeDeadline).toBe(new Date(2026, 8, 11, 23, 59, 59, 999).toISOString());
    expect(r.stepDeadlines).toBeNull();
  });
  it('etapa ativa sem iniciado_em nem data_limite: prazo nulo (o diálogo desabilita Manter etapas)', () => {
    const noStart = { ...etapas[1], iniciado_em: null };
    expect(buildDetachDeadlines([noStart], noStart).activeDeadline).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify failures**

Run: `npx vitest run apps/crm/src/utils/__tests__/postDate.test.ts apps/crm/src/pages/entregas/__tests__/deliveryDeadlinesTimezone.test.ts apps/crm/src/pages/entregas/__tests__/applyProcessDeadlines.test.ts apps/crm/src/pages/entregas/__tests__/detachDeadlines.test.ts`
Expected: FAIL — helpers missing; the timezone test fails on `.get(1)` returning `'2026-09-16'`; the builders are missing.

- [ ] **Step 3: `utils/postDate.ts`**

Append:

```ts
const pad2 = (n: number) => String(n).padStart(2, '0');

/** 'YYYY-MM-DD' a partir dos componentes LOCAIS. Nunca use
 *  `toISOString().split('T')[0]` para um dia de calendário: ele converte para
 *  UTC antes de cortar e muda o dia no Brasil (spec de processos §7). */
export function toLocalISODate(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/** Meia-noite local de 'YYYY-MM-DD' (aceita um timestamp e usa os 10 primeiros
 *  caracteres). `new Date('YYYY-MM-DD')` seria meia-noite UTC. */
export function parseLocalISODate(s: string): Date | null {
  const [y, m, d] = s.slice(0, 10).split('-').map(Number);
  if (!y || !m || !d) return null;
  return new Date(y, m - 1, d);
}

/** 23:59:59.999 local do dia de `d`: o instante que "fim daquele dia" vira
 *  como timestamptz (spec de processos §7, prazo congelado de data_limite). */
export function endOfLocalDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999);
}
```

- [ ] **Step 4: The two timezone fixes**

`store/workflows.ts:541`: replace `const toISO = (d: Date) => d.toISOString().split('T')[0];` with `const toISO = toLocalISODate;` and import `{ toLocalISODate } from '../utils/postDate'`.

`hooks/useEntregasData.ts:187`: same replacement, import `{ toLocalISODate } from '@/utils/postDate'`. Also relax the signature (line 179):

```ts
/** Forma mínima de uma etapa para o cálculo de data de entrega: WorkflowEtapa e
 *  as etapas de um template (com `ordem` = índice) satisfazem. */
export type DeliveryStep = {
  ordem: number;
  tipo?: 'padrao' | 'aprovacao_cliente' | null;
  prazo_dias: number;
  tipo_prazo: 'corridos' | 'uteis';
};

export function computeDeliveryDeadlines(
  etapas: DeliveryStep[],
  deliveryDate: Date,
): Map<number, string> {
```

- [ ] **Step 5: `applyProcessDeadlines.ts`**

```ts
// apps/crm/src/pages/entregas/applyProcessDeadlines.ts
import type { StepOverrides, WorkflowTemplate } from '../../store';
import { computeDeadlineDate, computeDeliveryDeadlines } from './hooks/useEntregasData';
import { endOfLocalDay, parseLocalISODate } from '@/utils/postDate';

export type ModoPrazo = 'padrao' | 'data_fixa' | 'data_entrega';

export interface ApplyPlanInput {
  template: WorkflowTemplate;
  startOrdem: number;
  now: Date;
  fixedDates: Record<number, string | undefined>;
  deliveryDate: Date | null;
  clienteHasDiaEntrega: boolean;
  responsaveis: Record<number, number | null | undefined>;
}

export interface ApplyPlanStep {
  ordem: number;
  nome: string;
  tipo: 'padrao' | 'aprovacao_cliente';
  estado: 'ignorado' | 'ativo' | 'pendente';
  responsavelId: number | null;
  prazoEfetivo: string | null;
}

export interface ApplyPlan {
  modo: ModoPrazo;
  steps: ApplyPlanStep[];
  overrides: StepOverrides;
  blockers: string[];
  needsApprovalStep: boolean;
}

/**
 * Tudo que o diálogo "Aplicar processo" mostra e envia (spec §5.2, §7). A
 * sequência vem do template (ordem = índice do array, a mesma convenção de
 * buildTemplateFingerprint); do cliente só responsável e prazo_efetivo por
 * ordem >= inicial. `blockers` vazio = botão de confirmar habilitado.
 * - padrao: só a etapa inicial recebe prazo (de `now`); as futuras ganham
 *   prazo ao serem ativadas (transition_post_process com p_next_deadline).
 * - data_fixa: data por etapa >= inicial, obrigatória (step_deadline_required).
 * - data_entrega: aprovação do cliente a partir da inicial, dia do cliente e
 *   mês; prazos materializados por computeDeliveryDeadlines (fuso local).
 */
export function buildApplyPlan(input: ApplyPlanInput): ApplyPlan {
  const { template, startOrdem, now } = input;
  const modo: ModoPrazo = template.modo_prazo ?? 'padrao';
  const etapas = Array.isArray(template.etapas) ? template.etapas : [];
  const blockers: string[] = [];
  if (etapas.length === 0) blockers.push('Este modelo não tem etapas.');
  if (!Number.isInteger(startOrdem) || startOrdem < 0 || startOrdem >= etapas.length) {
    blockers.push('Escolha a etapa inicial.');
  }
  const fromStart = etapas
    .map((e, i) => ({ ordem: i, tipo: e.tipo ?? 'padrao', prazo_dias: e.prazo_dias, tipo_prazo: e.tipo_prazo }))
    .filter((e) => e.ordem >= startOrdem);
  const needsApprovalStep =
    modo === 'data_entrega' && !fromStart.some((e) => e.tipo === 'aprovacao_cliente');

  const prazoByOrdem = new Map<number, string | null>();
  if (blockers.length === 0) {
    if (modo === 'padrao') {
      const start = etapas[startOrdem];
      prazoByOrdem.set(
        startOrdem,
        computeDeadlineDate(now.toISOString(), start.prazo_dias, start.tipo_prazo).toISOString(),
      );
    } else if (modo === 'data_fixa') {
      for (const e of fromStart) {
        const raw = input.fixedDates[e.ordem];
        const d = raw ? parseLocalISODate(raw) : null;
        if (!d) blockers.push(`Informe a data da etapa "${etapas[e.ordem].nome}".`);
        else prazoByOrdem.set(e.ordem, endOfLocalDay(d).toISOString());
      }
    } else {
      if (!input.clienteHasDiaEntrega) blockers.push('O cliente não tem dia de entrega configurado.');
      else if (!input.deliveryDate) blockers.push('Escolha o mês de entrega.');
      if (needsApprovalStep) {
        blockers.push('O modelo precisa de uma etapa de aprovação do cliente a partir da etapa inicial.');
      }
      if (blockers.length === 0 && input.deliveryDate) {
        const map = computeDeliveryDeadlines(fromStart, input.deliveryDate);
        for (const e of fromStart) {
          const day = map.get(e.ordem);
          const d = day ? parseLocalISODate(day) : null;
          if (!d) blockers.push(`Não foi possível calcular a data da etapa "${etapas[e.ordem].nome}".`);
          else prazoByOrdem.set(e.ordem, endOfLocalDay(d).toISOString());
        }
      }
    }
  }

  const steps: ApplyPlanStep[] = etapas.map((e, i) => {
    const override = input.responsaveis[i];
    const responsavelId = override === undefined ? (e.responsavel_id ?? null) : override;
    return {
      ordem: i,
      nome: e.nome,
      tipo: e.tipo ?? 'padrao',
      estado: i < startOrdem ? 'ignorado' : i === startOrdem ? 'ativo' : 'pendente',
      responsavelId,
      prazoEfetivo: prazoByOrdem.get(i) ?? null,
    };
  });

  const overrides: StepOverrides = {};
  for (const s of steps) {
    if (s.ordem < startOrdem) continue;
    overrides[String(s.ordem)] = { responsavel_id: s.responsavelId, prazo_efetivo: s.prazoEfetivo };
  }
  return { modo, steps, overrides, blockers, needsApprovalStep };
}
```

- [ ] **Step 6: `detachDeadlines.ts`**

```ts
// apps/crm/src/pages/entregas/detachDeadlines.ts
import type { WorkflowEtapa } from '../../store';
import { etapaDeadlineDateOf } from './etapaPrazo';
import { endOfLocalDay, parseLocalISODate } from '@/utils/postDate';

/**
 * Prazos que detach_posts_keeping_process só armazena (spec §7): o prazo
 * congelado da etapa ativa (data_limite = fim daquele dia local; senão
 * iniciado_em + prazo_dias) e o mapa {"<ordem>": ISO} das etapas FUTURAS com
 * data_limite, obrigatório para cada uma delas (step_deadline_required).
 */
export function buildDetachDeadlines(
  allEtapas: WorkflowEtapa[],
  activeEtapa: WorkflowEtapa,
): { activeDeadline: string | null; stepDeadlines: Record<string, string> | null } {
  const endOf = (day: string): string | null => {
    const d = parseLocalISODate(day);
    return d ? endOfLocalDay(d).toISOString() : null;
  };
  const activeDeadline = activeEtapa.data_limite
    ? endOf(activeEtapa.data_limite)
    : (etapaDeadlineDateOf(activeEtapa)?.toISOString() ?? null);
  const stepDeadlines: Record<string, string> = {};
  for (const e of allEtapas) {
    if (e.ordem <= activeEtapa.ordem || !e.data_limite) continue;
    const iso = endOf(e.data_limite);
    if (iso) stepDeadlines[String(e.ordem)] = iso;
  }
  return {
    activeDeadline,
    stepDeadlines: Object.keys(stepDeadlines).length ? stepDeadlines : null,
  };
}
```

- [ ] **Step 7: Run the tests + the fase-3/pre-existing deadline suites + typecheck**

Run: `npx vitest run apps/crm/src/utils apps/crm/src/pages/entregas apps/crm/src/store && npx tsc -p apps/crm/tsconfig.json --noEmit`
Expected: PASS. `MigrateTemplateDialog.test.tsx` and any `computeDeliveryDeadlines` consumer keep passing (same output for local-midnight inputs).

- [ ] **Step 8: Commit**

```bash
git add apps/crm/src/utils apps/crm/src/store/workflows.ts apps/crm/src/pages/entregas
git commit -m "fix(entregas): data de entrega no fuso local; construtores puros de prazos para aplicar e desmembrar"
```

---

### Task 7: `usePostProcessCommands` (avançar / voltar / concluir / reabrir / remover) + drawer header actions

**Files:**
- Create: `apps/crm/src/pages/entregas/postProcessCommands.ts` (pure helpers)
- Create: `apps/crm/src/pages/entregas/hooks/usePostProcessCommands.tsx` (hook + dialogs)
- Modify: `apps/crm/src/pages/entregas/components/StandalonePostDrawer.tsx:486-500, 520-556` (header buttons; pass `onProcessAvancar`)
- Modify: `apps/crm/src/pages/entregas/components/PostEditorBody.tsx:86-89, 428-430` (new props threaded to the section)
- Modify: `apps/crm/src/pages/entregas/components/PostProductionSection.tsx` (hint "Cliente aprovou. Avançar etapa?")
- Modify: `apps/crm/style.css` (append `.post-production-hint`, `.post-production-actions`)
- Test: `apps/crm/src/pages/entregas/__tests__/postProcessCommands.test.ts` (create)
- Test: `apps/crm/src/pages/entregas/hooks/__tests__/usePostProcessCommands.test.tsx` (create)
- Test: `apps/crm/src/pages/entregas/components/__tests__/StandalonePostDrawer.test.tsx` (extend)

**Interfaces:**
- Consumes: `transitionPostProcess`, `removePostProcess`, `updateWorkflowPost` (store); `decideApprovalAdvance`, `isClientCleared`, `hasLaterPendingApprovalStep` (Task 5); `getPostProcessErrorToast`, `isStaleStateError` (Task 1); `computeDeadlineDate`; `ForwardConfirmDialog`, `RevertConfirmDialog`, `ClientApprovalChoiceDialog` (Task 5 props).
- Produces:

```ts
// postProcessCommands.ts (pure)
export interface ProcessTarget {
  process: PostProcess;
  post: { id: number; titulo: string | null; status: string; cliente_id: number | null };
}
export function activeStepOf(process: PostProcess): PostProcessStep | null;      // estado 'ativo', else by etapa_atual
export function nextPendingStepOf(process: PostProcess): PostProcessStep | null; // smallest ordem > active with estado 'pendente'
export function previousStepOf(process: PostProcess): PostProcessStep | null;    // largest ordem < active, any estado (Decision 15)
export function canConcluir(process: PostProcess): boolean;                      // no 'pendente' with ordem > active (Decision 12)
export function nextDeadlineFor(step: PostProcessStep | null, now: Date): string | null; // ISO when prazo_efetivo null && prazo_dias != null && tipo_prazo
export function forwardLabelFor(process: PostProcess): 'Avançar etapa' | 'Concluir processo';
export function sendToPortalDisabledReasonFor(status: string): string | undefined; // undefined when status === 'aprovado_interno'
export const SEND_TO_PORTAL_REASON = 'Só posts aprovados internamente podem ser enviados ao cliente.';

// hooks/usePostProcessCommands.tsx
export interface UsePostProcessCommandsOptions {
  onRefresh: () => void;
  /** Kanban overlay: called with the target ordem before the RPC, and with null on rollback. */
  onOptimisticStep?: (processId: number, ordem: number | null) => void;
}
export interface PostProcessCommands {
  avancar: (t: ProcessTarget) => void;
  voltar: (t: ProcessTarget) => void;
  concluir: (t: ProcessTarget) => void;
  reabrir: (t: ProcessTarget) => void;
  remover: (t: ProcessTarget) => void;
  busy: boolean;
  dialogs: JSX.Element;   // render once in the consuming component
}
export function usePostProcessCommands(opts: UsePostProcessCommandsOptions): PostProcessCommands;
```

- `PostEditorBodyProps` gains `onProcessAvancar?: () => void` and `postStatus` is read from `post.status` (already in props). `PostProductionSectionProps` gains `postStatus: string; onAvancar?: () => void`.

- [ ] **Step 1: Write the failing tests**

```ts
// apps/crm/src/pages/entregas/__tests__/postProcessCommands.test.ts
import { describe, expect, it } from 'vitest';
import {
  activeStepOf, canConcluir, forwardLabelFor, nextDeadlineFor, nextPendingStepOf, previousStepOf,
  sendToPortalDisabledReasonFor, SEND_TO_PORTAL_REASON,
} from '../postProcessCommands';
import type { PostProcess, PostProcessStep } from '../../../store';

const step = (ordem: number, estado: PostProcessStep['estado'], extra: Partial<PostProcessStep> = {}): PostProcessStep =>
  ({ id: ordem + 1, conta_id: 'c', process_id: 5, ordem, nome: `E${ordem}`, tipo: 'padrao', responsavel_id: null,
     prazo_dias: null, tipo_prazo: null, prazo_efetivo: null, estado, iniciado_em: null, concluido_em: null,
     interrompido_em: null, origem_etapa_ordem: null, origem_etapa_nome: null, ...extra });
const proc = (steps: PostProcessStep[], etapa_atual: number): PostProcess =>
  ({ id: 5, conta_id: 'c', post_id: 77, template_id: null, template_nome: null, assinatura: '', origem_workflow_id: null,
     origem_descricao: null, estado: 'ativo', motivo_encerramento: null, etapa_atual, modo_prazo: 'padrao',
     board_position: 0, revisao: 3, created_by: null, created_at: '', updated_at: '', concluido_em: null, steps });

describe('postProcessCommands helpers', () => {
  const p = proc([step(0, 'herdado'), step(1, 'ativo'), step(2, 'ignorado'), step(3, 'pendente', { prazo_dias: 2, tipo_prazo: 'corridos' })], 1);
  it('activeStepOf, nextPendingStepOf (pula ignorado), previousStepOf (qualquer estado)', () => {
    expect(activeStepOf(p)?.ordem).toBe(1);
    expect(nextPendingStepOf(p)?.ordem).toBe(3);
    expect(previousStepOf(p)?.ordem).toBe(0);
  });
  it('canConcluir só sem pendente adiante; forwardLabelFor acompanha', () => {
    expect(canConcluir(p)).toBe(false);
    expect(forwardLabelFor(p)).toBe('Avançar etapa');
    const last = proc([step(0, 'concluido'), step(1, 'ativo'), step(2, 'herdado')], 1);
    expect(canConcluir(last)).toBe(true);
    expect(forwardLabelFor(last)).toBe('Concluir processo');
  });
  it('nextDeadlineFor: só prazo relativo sem prazo_efetivo', () => {
    const now = new Date(2026, 8, 14, 10, 0);
    expect(new Date(nextDeadlineFor(step(3, 'pendente', { prazo_dias: 2, tipo_prazo: 'corridos' }), now)!).getDate()).toBe(16);
    expect(nextDeadlineFor(step(3, 'pendente', { prazo_dias: 2, tipo_prazo: 'corridos', prazo_efetivo: '2026-09-30T00:00:00Z' }), now)).toBeNull();
    expect(nextDeadlineFor(step(3, 'pendente'), now)).toBeNull();
    expect(nextDeadlineFor(null, now)).toBeNull();
  });
  it('sendToPortalDisabledReasonFor', () => {
    expect(sendToPortalDisabledReasonFor('aprovado_interno')).toBeUndefined();
    expect(sendToPortalDisabledReasonFor('rascunho')).toBe(SEND_TO_PORTAL_REASON);
  });
});
```

```tsx
// apps/crm/src/pages/entregas/hooks/__tests__/usePostProcessCommands.test.tsx
import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const store = vi.hoisted(() => ({
  transitionPostProcess: vi.fn(),
  removePostProcess: vi.fn(),
  updateWorkflowPost: vi.fn(),
  CLIENT_CLEARED_STATUSES: ['aprovado_cliente', 'agendado', 'postado', 'falha_publicacao'],
}));
vi.mock('../../../../store', () => store);
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() }));
vi.mock('sonner', () => ({ toast }));

import { usePostProcessCommands } from '../usePostProcessCommands';
import type { ProcessTarget } from '../../postProcessCommands';

const step = (ordem: number, estado: string, tipo = 'padrao', extra = {}) =>
  ({ id: ordem + 1, process_id: 5, ordem, nome: `E${ordem}`, tipo, estado, responsavel_id: null,
     prazo_dias: null, tipo_prazo: null, prazo_efetivo: null, iniciado_em: null, ...extra }) as never;
function target(steps: unknown[], status: string, etapa_atual = 1): ProcessTarget {
  return {
    process: { id: 5, post_id: 77, estado: 'ativo', etapa_atual, revisao: 3, steps } as never,
    post: { id: 77, titulo: 'Post X', status, cliente_id: 9 },
  };
}

function Harness({ t, onRefresh, onOptimisticStep }: { t: ProcessTarget; onRefresh: () => void; onOptimisticStep?: (id: number, o: number | null) => void }) {
  const c = usePostProcessCommands({ onRefresh, onOptimisticStep });
  return (
    <>
      <button onClick={() => c.avancar(t)}>avancar</button>
      <button onClick={() => c.voltar(t)}>voltar</button>
      <button onClick={() => c.concluir(t)}>concluir</button>
      <button onClick={() => c.reabrir(t)}>reabrir</button>
      <button onClick={() => c.remover(t)}>remover</button>
      {c.dialogs}
    </>
  );
}
function renderHarness(t: ProcessTarget, onOptimisticStep?: (id: number, o: number | null) => void) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const invalidate = vi.spyOn(qc, 'invalidateQueries');
  const onRefresh = vi.fn();
  render(<QueryClientProvider client={qc}><Harness t={t} onRefresh={onRefresh} onOptimisticStep={onOptimisticStep} /></QueryClientProvider>);
  return { onRefresh, invalidate };
}

beforeEach(() => {
  vi.clearAllMocks();
  store.transitionPostProcess.mockResolvedValue({ ok: true, revisao: 4, post_status: 'rascunho', post_status_changed: false, steps: [] });
  store.removePostProcess.mockResolvedValue({ ok: true });
  store.updateWorkflowPost.mockResolvedValue({});
});

describe('usePostProcessCommands', () => {
  it('avançar etapa padrão: confirma, calcula p_next_deadline e não manda campos de aprovação', async () => {
    const t = target([step(0, 'concluido'), step(1, 'ativo'), step(2, 'pendente', 'padrao', { prazo_dias: 2, tipo_prazo: 'corridos' })], 'rascunho');
    const optimistic = vi.fn();
    const { onRefresh } = renderHarness(t, optimistic);
    fireEvent.click(screen.getByText('avancar'));
    fireEvent.click(await screen.findByRole('button', { name: 'Avançar' }));
    await waitFor(() => expect(store.transitionPostProcess).toHaveBeenCalledTimes(1));
    const args = store.transitionPostProcess.mock.calls[0][0];
    expect(args).toMatchObject({ processId: 5, expectedRevisao: 3, command: 'avancar', approvalChoice: null, expectedPostStatus: null });
    expect(typeof args.nextDeadline).toBe('string');
    expect(optimistic).toHaveBeenCalledWith(5, 2);
    await waitFor(() => expect(onRefresh).toHaveBeenCalled());
    expect(toast.success).toHaveBeenCalledWith('Etapa avançada.');
  });

  it('avançar em aprovação com post não liberado abre a escolha; "Aprovar internamente" manda aprovar_interno + status esperado', async () => {
    const t = target([step(0, 'concluido'), step(1, 'ativo', 'aprovacao_cliente'), step(2, 'pendente')], 'enviado_cliente');
    renderHarness(t);
    fireEvent.click(screen.getByText('avancar'));
    fireEvent.click(await screen.findByRole('button', { name: 'Avançar' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Aprovar internamente' }));
    await waitFor(() => expect(store.transitionPostProcess).toHaveBeenCalledTimes(1));
    expect(store.transitionPostProcess.mock.calls[0][0]).toMatchObject({
      command: 'avancar', approvalChoice: 'aprovar_interno', expectedPostStatus: 'enviado_cliente',
    });
  });

  it('"Enviar ao portal" desabilitado fora de aprovado_interno; habilitado faz o UPDATE direto e NÃO transiciona', async () => {
    const t = target([step(1, 'ativo', 'aprovacao_cliente'), step(2, 'pendente')], 'rascunho');
    renderHarness(t);
    fireEvent.click(screen.getByText('avancar'));
    fireEvent.click(await screen.findByRole('button', { name: 'Avançar' }));
    expect(await screen.findByRole('button', { name: 'Enviar ao portal do cliente' })).toBeDisabled();
    expect(screen.getByText('Só posts aprovados internamente podem ser enviados ao cliente.')).toBeInTheDocument();
  });
  it('"Enviar ao portal" com aprovado_interno', async () => {
    const t = target([step(1, 'ativo', 'aprovacao_cliente'), step(2, 'pendente')], 'aprovado_interno');
    const { onRefresh } = renderHarness(t);
    fireEvent.click(screen.getByText('avancar'));
    fireEvent.click(await screen.findByRole('button', { name: 'Avançar' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Enviar ao portal do cliente' }));
    await waitFor(() => expect(store.updateWorkflowPost).toHaveBeenCalledWith(77, { status: 'enviado_cliente' }));
    expect(store.transitionPostProcess).not.toHaveBeenCalled();
    await waitFor(() => expect(onRefresh).toHaveBeenCalled());
  });

  it('avançar liberado com outra aprovação PENDENTE adiante: avança direto e avisa o re-arm quando o post volta a rascunho', async () => {
    store.transitionPostProcess.mockResolvedValueOnce({ ok: true, revisao: 4, post_status: 'rascunho', post_status_changed: true, steps: [] });
    const t = target([step(1, 'ativo', 'aprovacao_cliente'), step(2, 'pendente', 'aprovacao_cliente')], 'aprovado_cliente');
    renderHarness(t);
    fireEvent.click(screen.getByText('avancar'));
    fireEvent.click(await screen.findByRole('button', { name: 'Avançar' }));
    await waitFor(() => expect(store.transitionPostProcess).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole('button', { name: 'Aprovar internamente' })).toBeNull();
    expect(store.transitionPostProcess.mock.calls[0][0]).toMatchObject({ approvalChoice: null, expectedPostStatus: 'aprovado_cliente' });
    await waitFor(() => expect(toast.info).toHaveBeenCalledWith('O post voltou para rascunho para o próximo ciclo de aprovação.'));
  });

  it('rollback: RPC falha com process_changed → overlay desfeito, toast mapeado, refetch, sem sucesso', async () => {
    store.transitionPostProcess.mockRejectedValueOnce({ message: 'process_changed', code: 'P0001' });
    const t = target([step(1, 'ativo'), step(2, 'pendente')], 'rascunho');
    const optimistic = vi.fn();
    const { onRefresh } = renderHarness(t, optimistic);
    fireEvent.click(screen.getByText('avancar'));
    fireEvent.click(await screen.findByRole('button', { name: 'Avançar' }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Este processo foi alterado em outro lugar. Recarregue e tente de novo.'));
    expect(optimistic).toHaveBeenLastCalledWith(5, null);
    expect(onRefresh).toHaveBeenCalled();
    expect(toast.success).not.toHaveBeenCalled();
  });

  it('voltar: confirma e manda o comando sem prazo', async () => {
    const t = target([step(0, 'concluido'), step(1, 'ativo')], 'rascunho');
    renderHarness(t);
    fireEvent.click(screen.getByText('voltar'));
    fireEvent.click(await screen.findByRole('button', { name: 'Reverter' }));
    await waitFor(() => expect(store.transitionPostProcess).toHaveBeenCalledWith(expect.objectContaining({ command: 'voltar', nextDeadline: null })));
  });

  it('concluir em aprovação com pendência abre a escolha SEM aviso de re-arm e com rótulo "Concluir sem alterar o post"', async () => {
    const t = target([step(0, 'concluido'), step(1, 'ativo', 'aprovacao_cliente')], 'enviado_cliente');
    renderHarness(t);
    fireEvent.click(screen.getByText('concluir'));
    fireEvent.click(await screen.findByRole('button', { name: 'Concluir' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Concluir sem alterar o post' }));
    await waitFor(() => expect(store.transitionPostProcess).toHaveBeenCalledWith(expect.objectContaining({ command: 'concluir', approvalChoice: 'sem_alterar', expectedPostStatus: 'enviado_cliente' })));
    expect(screen.queryByText(/voltará para rascunho/)).toBeNull();
  });

  it('reabrir e remover confirmam e chamam as RPCs certas', async () => {
    const t = target([step(0, 'concluido')], 'postado');
    t.process = { ...t.process, estado: 'concluido' } as never;
    renderHarness(t);
    fireEvent.click(screen.getByText('reabrir'));
    fireEvent.click(await screen.findByRole('button', { name: 'Reabrir' }));
    await waitFor(() => expect(store.transitionPostProcess).toHaveBeenCalledWith(expect.objectContaining({ command: 'reabrir' })));
    fireEvent.click(screen.getByText('remover'));
    fireEvent.click(await screen.findByRole('button', { name: 'Remover' }));
    await waitFor(() => expect(store.removePostProcess).toHaveBeenCalledWith(5, 3));
    expect(toast.success).toHaveBeenLastCalledWith('Processo removido. O post continua em Publicações.');
  });
});
```

Extend `StandalonePostDrawer.test.tsx` (mock additions: `transitionPostProcess: vi.fn()`, `removePostProcess: vi.fn()`, `CLIENT_CLEARED_STATUSES: [...]` in the `@/store` mock):

```ts
  it('processo ativo: cabeçalho com Voltar etapa / Avançar etapa / Remover processo, mesmo com a flag desligada', async () => {
    limitsMock.features = { feature_post_processes: false };
    (getVigentePostProcess as any).mockResolvedValueOnce(processFixture); // etapa 1 ativa de 3, próxima pendente
    renderDrawer();
    await screen.findByRole('button', { name: 'Avançar etapa' });
    expect(screen.getByRole('button', { name: 'Voltar etapa' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Remover processo' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Concluir processo' })).toBeNull();
  });
  it('última etapa ativa: "Concluir processo" no lugar de "Avançar etapa"; concluído: "Reabrir processo"', async () => {
    (getVigentePostProcess as any).mockResolvedValueOnce({ ...processFixture, etapa_atual: 2, steps: lastStepActiveSteps });
    renderDrawer();
    await screen.findByRole('button', { name: 'Concluir processo' });
    expect(screen.queryByRole('button', { name: 'Avançar etapa' })).toBeNull();
  });
  it('post aprovado_cliente em etapa de aprovação: dica "Cliente aprovou. Avançar etapa?" na seção', async () => {
    (getStandalonePost as any).mockResolvedValueOnce({ ...postFixture, status: 'aprovado_cliente' });
    (getVigentePostProcess as any).mockResolvedValueOnce(approvalActiveProcessFixture);
    renderDrawer();
    await screen.findByText('Cliente aprovou. Avançar etapa?');
  });
```

- [ ] **Step 2: Run to verify failures**

Run: `npx vitest run apps/crm/src/pages/entregas/__tests__/postProcessCommands.test.ts apps/crm/src/pages/entregas/hooks/__tests__/usePostProcessCommands.test.tsx apps/crm/src/pages/entregas/components/__tests__/StandalonePostDrawer.test.tsx`
Expected: FAIL (modules missing; buttons absent).

- [ ] **Step 3: `postProcessCommands.ts`**

```ts
// apps/crm/src/pages/entregas/postProcessCommands.ts
import type { PostProcess, PostProcessStep } from '../../store';
import { computeDeadlineDate } from './hooks/useEntregasData';

export interface ProcessTarget {
  process: PostProcess;
  post: { id: number; titulo: string | null; status: string; cliente_id: number | null };
}

export function activeStepOf(process: PostProcess): PostProcessStep | null {
  return (
    process.steps.find((s) => s.estado === 'ativo') ??
    process.steps.find((s) => s.ordem === process.etapa_atual) ??
    null
  );
}

/** Próxima etapa PENDENTE por ordem (a RPC pula herdado/ignorado/concluído). */
export function nextPendingStepOf(process: PostProcess): PostProcessStep | null {
  const active = activeStepOf(process);
  if (!active) return null;
  return (
    [...process.steps]
      .filter((s) => s.ordem > active.ordem && s.estado === 'pendente')
      .sort((a, b) => a.ordem - b.ordem)[0] ?? null
  );
}

/** Etapa imediatamente anterior por ordem, qualquer estado (Decisão 15). */
export function previousStepOf(process: PostProcess): PostProcessStep | null {
  const active = activeStepOf(process);
  if (!active) return null;
  return (
    [...process.steps]
      .filter((s) => s.ordem < active.ordem)
      .sort((a, b) => b.ordem - a.ordem)[0] ?? null
  );
}

/** Decisão 12: concluir só quando nenhuma etapa de ordem maior está pendente. */
export function canConcluir(process: PostProcess): boolean {
  return nextPendingStepOf(process) === null;
}

export function forwardLabelFor(process: PostProcess): 'Avançar etapa' | 'Concluir processo' {
  return canConcluir(process) ? 'Concluir processo' : 'Avançar etapa';
}

/** p_next_deadline: só quando a etapa a ativar tem prazo relativo e ainda não
 *  tem prazo_efetivo (spec §7). A RPC valida e só armazena. */
export function nextDeadlineFor(step: PostProcessStep | null, now: Date): string | null {
  if (!step || step.prazo_efetivo || step.prazo_dias == null || !step.tipo_prazo) return null;
  return computeDeadlineDate(now.toISOString(), step.prazo_dias, step.tipo_prazo).toISOString();
}

export const SEND_TO_PORTAL_REASON = 'Só posts aprovados internamente podem ser enviados ao cliente.';

/** Mesma regra de sendPostsToCliente (status = aprovado_interno), para n = 1 (spec §6.2). */
export function sendToPortalDisabledReasonFor(status: string): string | undefined {
  return status === 'aprovado_interno' ? undefined : SEND_TO_PORTAL_REASON;
}
```

- [ ] **Step 4: `hooks/usePostProcessCommands.tsx`**

```tsx
// apps/crm/src/pages/entregas/hooks/usePostProcessCommands.tsx
import { useCallback, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  removePostProcess, transitionPostProcess, updateWorkflowPost,
  type ApprovalChoice, type ProcessCommand,
} from '../../../store';
import { decideApprovalAdvance, hasLaterPendingApprovalStep, isClientCleared } from '../approvalAdvance';
import { getPostProcessErrorToast, isStaleStateError } from '../postProcessErrors';
import {
  activeStepOf, nextDeadlineFor, nextPendingStepOf, previousStepOf, sendToPortalDisabledReasonFor, type ProcessTarget,
} from '../postProcessCommands';
import {
  ClientApprovalChoiceDialog, ForwardConfirmDialog, RevertConfirmDialog,
} from '../components/WorkflowModals';

export interface UsePostProcessCommandsOptions {
  onRefresh: () => void;
  onOptimisticStep?: (processId: number, ordem: number | null) => void;
}

export interface PostProcessCommands {
  avancar: (t: ProcessTarget) => void;
  voltar: (t: ProcessTarget) => void;
  concluir: (t: ProcessTarget) => void;
  reabrir: (t: ProcessTarget) => void;
  remover: (t: ProcessTarget) => void;
  busy: boolean;
  dialogs: JSX.Element;
}

type Pending =
  | { kind: 'forward'; t: ProcessTarget }
  | { kind: 'revert'; t: ProcessTarget }
  | { kind: 'conclude'; t: ProcessTarget }
  | { kind: 'reopen'; t: ProcessTarget }
  | { kind: 'remove'; t: ProcessTarget }
  | { kind: 'choice'; t: ProcessTarget; command: 'avancar' | 'concluir'; willRearm: boolean };

const SUCCESS: Record<ProcessCommand, string> = {
  avancar: 'Etapa avançada.',
  voltar: 'Etapa revertida.',
  concluir: 'Processo concluído. O post mantém status e agendamento.',
  reabrir: 'Processo reaberto na última etapa.',
};

/**
 * Comandos de um processo individual (spec §5.4, §5.5, §6.2) compartilhados
 * pelo cabeçalho do drawer, pelo card do Kanban e por Concluídas. Cada comando
 * abre o diálogo que os fluxos já usam (Forward/Revert/ClientApprovalChoice)
 * ou um AlertDialog de confirmação, e a transição roda numa RPC só, com
 * `revisao` esperada e rollback em falha (spec §9.6).
 */
export function usePostProcessCommands(opts: UsePostProcessCommandsOptions): PostProcessCommands {
  const qc = useQueryClient();
  const [pending, setPending] = useState<Pending | null>(null);
  const [busy, setBusy] = useState(false);

  const invalidate = useCallback(
    (t: ProcessTarget) => {
      for (const key of [
        ['post-processes'], ['post-process', t.post.id], ['post-process-events'], ['post-process-covers'],
        ['active-posts'], ['standalone-post', t.post.id], ['post-status-events'],
        ['concluded-workflows'], ['concluded-summaries'], ['scheduled-posts'],
      ]) qc.invalidateQueries({ queryKey: key });
      if (t.post.cliente_id != null) qc.invalidateQueries({ queryKey: ['clientePosts', t.post.cliente_id] });
      opts.onRefresh();
    },
    [qc, opts],
  );

  const run = useCallback(
    async (t: ProcessTarget, command: ProcessCommand, choice: ApprovalChoice | null) => {
      const active = activeStepOf(t.process);
      const next = command === 'avancar' ? nextPendingStepOf(t.process) : null;
      const needsStatus =
        (command === 'avancar' || command === 'concluir') && active?.tipo === 'aprovacao_cliente';
      const optimisticOrdem =
        command === 'avancar' ? (next?.ordem ?? null) : command === 'voltar' ? (previousStepOf(t.process)?.ordem ?? null) : null;
      if (optimisticOrdem != null) opts.onOptimisticStep?.(t.process.id, optimisticOrdem);
      setBusy(true);
      try {
        const result = await transitionPostProcess({
          processId: t.process.id,
          expectedRevisao: t.process.revisao,
          command,
          approvalChoice: choice,
          expectedPostStatus: needsStatus ? t.post.status : null,
          nextDeadline: command === 'avancar' ? nextDeadlineFor(next, new Date()) : null,
        });
        toast.success(SUCCESS[command]);
        if (result.post_status_changed && result.post_status === 'rascunho') {
          toast.info('O post voltou para rascunho para o próximo ciclo de aprovação.');
        }
        invalidate(t);
      } catch (err) {
        opts.onOptimisticStep?.(t.process.id, null);
        toast.error(getPostProcessErrorToast(err, `Erro ao ${command === 'avancar' ? 'avançar etapa' : command === 'voltar' ? 'voltar etapa' : command === 'concluir' ? 'concluir processo' : 'reabrir processo'}`));
        if (isStaleStateError(err)) invalidate(t);
      } finally {
        setBusy(false);
      }
    },
    [invalidate, opts],
  );

  const decideThenRun = useCallback(
    (t: ProcessTarget, command: 'avancar' | 'concluir') => {
      const active = activeStepOf(t.process);
      const decision = decideApprovalAdvance({
        tipo: active?.tipo,
        total: 1,
        cleared: isClientCleared(t.post.status) ? 1 : 0,
        temAprovacaoAdiante:
          command === 'avancar' && active ? hasLaterPendingApprovalStep(t.process.steps, active.ordem) : false,
      });
      if (decision.kind === 'choose') setPending({ kind: 'choice', t, command, willRearm: decision.willRearm });
      else void run(t, command, null);
    },
    [run],
  );

  const sendToPortal = useCallback(
    async (t: ProcessTarget) => {
      setBusy(true);
      try {
        await updateWorkflowPost(t.post.id, { status: 'enviado_cliente' });
        toast.success('Post enviado ao portal do cliente.');
        invalidate(t);
      } catch (err) {
        toast.error(getPostProcessErrorToast(err, 'Erro ao enviar ao portal'));
      } finally {
        setBusy(false);
      }
    },
    [invalidate],
  );

  const remove = useCallback(
    async (t: ProcessTarget) => {
      setBusy(true);
      try {
        await removePostProcess(t.process.id, t.process.revisao);
        toast.success('Processo removido. O post continua em Publicações.');
        invalidate(t);
      } catch (err) {
        toast.error(getPostProcessErrorToast(err, 'Erro ao remover processo'));
        if (isStaleStateError(err)) invalidate(t);
      } finally {
        setBusy(false);
      }
    },
    [invalidate],
  );

  const close = () => setPending(null);
  const p = pending;
  const nextName = p && p.kind === 'forward' ? (nextPendingStepOf(p.t.process)?.nome ?? '') : '';

  const dialogs = (
    <>
      <ForwardConfirmDialog
        open={p?.kind === 'forward'}
        entityTitle={p?.t.post.titulo || 'Post sem título'}
        nextEtapaName={nextName}
        onConfirm={() => { if (p?.kind === 'forward') { const t = p.t; close(); decideThenRun(t, 'avancar'); } }}
        onCancel={close}
      />
      <RevertConfirmDialog
        open={p?.kind === 'revert'}
        entityTitle={p?.t.post.titulo || 'Post sem título'}
        onConfirm={() => { if (p?.kind === 'revert') { const t = p.t; close(); void run(t, 'voltar', null); } }}
        onCancel={close}
      />
      <ClientApprovalChoiceDialog
        open={p?.kind === 'choice'}
        entityTitle={p?.t.post.titulo || 'Post sem título'}
        entityKind="post"
        willRearm={p?.kind === 'choice' ? p.willRearm : false}
        withoutChangesLabel={p?.kind === 'choice' && p.command === 'concluir' ? 'Concluir sem alterar o post' : 'Avançar etapa sem alterar o post'}
        sendToPortalDisabledReason={p?.kind === 'choice' ? sendToPortalDisabledReasonFor(p.t.post.status) : undefined}
        onApproveInternally={() => { if (p?.kind === 'choice') { const { t, command } = p; close(); void run(t, command, 'aprovar_interno'); } }}
        onSendToPortal={() => { if (p?.kind === 'choice') { const t = p.t; close(); void sendToPortal(t); } }}
        onAdvanceWithoutChanges={() => { if (p?.kind === 'choice') { const { t, command } = p; close(); void run(t, command, 'sem_alterar'); } }}
        onCancel={close}
      />
      <AlertDialog open={p?.kind === 'conclude' || p?.kind === 'reopen' || p?.kind === 'remove'} onOpenChange={(o) => !o && close()}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {p?.kind === 'conclude' ? 'Concluir processo?' : p?.kind === 'reopen' ? 'Reabrir processo?' : 'Remover processo?'}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {p?.kind === 'conclude' && 'O processo vai para Concluídas. Status, visibilidade no portal e agendamento do post não mudam.'}
              {p?.kind === 'reopen' && 'O processo volta para a última etapa, com o prazo salvo (mesmo vencido). O status do post não muda.'}
              {p?.kind === 'remove' && 'O histórico fica guardado, o status e o conteúdo do post não mudam, e o post volta para Sem processo.'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={close} disabled={busy}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              disabled={busy}
              onClick={() => {
                if (!p) return;
                const t = p.t;
                const kind = p.kind;
                close();
                if (kind === 'conclude') decideThenRun(t, 'concluir');
                else if (kind === 'reopen') void run(t, 'reabrir', null);
                else if (kind === 'remove') void remove(t);
              }}
            >
              {p?.kind === 'conclude' ? 'Concluir' : p?.kind === 'reopen' ? 'Reabrir' : 'Remover'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );

  return useMemo(
    () => ({
      avancar: (t: ProcessTarget) => setPending({ kind: 'forward', t }),
      voltar: (t: ProcessTarget) => setPending({ kind: 'revert', t }),
      concluir: (t: ProcessTarget) => setPending({ kind: 'conclude', t }),
      reabrir: (t: ProcessTarget) => setPending({ kind: 'reopen', t }),
      remover: (t: ProcessTarget) => setPending({ kind: 'remove', t }),
      busy,
      dialogs,
    }),
    // dialogs closes over `pending`/`busy`; recreate when they change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [busy, pending],
  );
}
```

(`ForwardConfirmDialog`'s confirm button reads "Avançar" and `RevertConfirmDialog`'s "Reverter" — check `WorkflowModals.tsx:917-985` and use the exact labels those dialogs render; the tests above assume "Avançar"/"Reverter". If the real labels differ, fix the TESTS, not the dialogs.)

- [ ] **Step 5: Drawer header + section hint**

`StandalonePostDrawer.tsx`: 

```tsx
  const commands = usePostProcessCommands({ onRefresh: () => { refresh(); onRefresh(); } });
  const target: ProcessTarget | null =
    post && postProcess
      ? { process: postProcess, post: { id: post.id!, titulo: post.titulo, status: post.status, cliente_id: post.cliente_id } }
      : null;
```

In `drawer-header-actions` (line ~486), before the "Vincular a um fluxo" button:

```tsx
                {target && postProcess.estado === 'ativo' && (
                  <>
                    {previousStepOf(postProcess) && (
                      <button className="drawer-add-post-btn" aria-label="Voltar etapa" onClick={() => commands.voltar(target)} disabled={commands.busy}>
                        <ArrowLeft className="h-3.5 w-3.5" /> Voltar etapa
                      </button>
                    )}
                    <button
                      className="drawer-add-post-btn"
                      aria-label={forwardLabelFor(postProcess)}
                      onClick={() => (canConcluir(postProcess) ? commands.concluir(target) : commands.avancar(target))}
                      disabled={commands.busy}
                    >
                      <Check className="h-3.5 w-3.5" /> {forwardLabelFor(postProcess)}
                    </button>
                  </>
                )}
                {target && postProcess.estado === 'concluido' && (
                  <button className="drawer-add-post-btn" aria-label="Reabrir processo" onClick={() => commands.reabrir(target)} disabled={commands.busy}>
                    <RotateCcw className="h-3.5 w-3.5" /> Reabrir processo
                  </button>
                )}
                {target && (
                  <button className="drawer-add-post-btn" aria-label="Remover processo" onClick={() => commands.remover(target)} disabled={commands.busy}>
                    <CircleOff className="h-3.5 w-3.5" /> Remover processo
                  </button>
                )}
```

Render `{commands.dialogs}` next to the existing `AttachToFluxoDialog`. Pass `onProcessAvancar={target ? () => commands.avancar(target) : undefined}` to `PostEditorBody`. Icons from lucide: `ArrowLeft, Check, RotateCcw, CircleOff`.

`PostEditorBody.tsx`: add `onProcessAvancar?: () => void;` to the props (doc: "Avançar etapa do processo individual, para a dica da seção de produção") and forward: `<PostProductionSection process={postProcess} postId={post.id!} membros={membros} postStatus={post.status} onAvancar={onProcessAvancar} />`.

`PostProductionSection.tsx`: add props `postStatus: string; onAvancar?: () => void;` and, right under `<p className="post-production-origem">`:

```tsx
      {process.estado === 'ativo' &&
        postStatus === 'aprovado_cliente' &&
        process.steps.find((s) => s.estado === 'ativo')?.tipo === 'aprovacao_cliente' && (
          <div className="post-production-hint" role="status">
            <span>Cliente aprovou. Avançar etapa?</span>
            {onAvancar && (
              <button type="button" className="sem-processo-link" onClick={onAvancar}>Avançar etapa</button>
            )}
          </div>
        )}
```

`style.css` (append after `.post-production-history`):

```css
.post-production-hint {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin: 0.35rem 0 0.5rem;
  padding: 0.45rem 0.6rem;
  border-radius: 8px;
  background: color-mix(in srgb, var(--success) 12%, transparent);
  font-size: 0.78rem;
  color: var(--text-main);
}
.post-production-actions {
  display: flex;
  gap: 0.35rem;
  align-items: center;
}
```

- [ ] **Step 6: Run + typecheck**

Run: `npx vitest run apps/crm/src/pages/entregas && npx tsc -p apps/crm/tsconfig.json --noEmit`
Expected: PASS. Update `PostProductionSection.test.tsx` renders to pass `postStatus="rascunho"`.

- [ ] **Step 7: Commit**

```bash
git add apps/crm/src/pages/entregas apps/crm/style.css
git commit -m "feat(entregas): avançar, voltar, concluir, reabrir e remover processo individual no drawer"
```

---

### Task 8: Kanban post cards: Avançar/Voltar buttons and drag between adjacent columns

**Files:**
- Modify: `apps/crm/src/pages/entregas/components/PostProcessCard.tsx:26-41, 240-309`
- Modify: `apps/crm/src/pages/entregas/views/KanbanView.tsx:258-268 (SortablePostCard), 413-420 (findCard), 424-500 (dragOver), 505-662 (dragEnd), 1040-1052 (DragOverlay)`
- Modify: `apps/crm/style.css` (`.board-card--post .board-card-actions`)
- Test: `apps/crm/src/pages/entregas/components/__tests__/PostProcessCard.test.tsx` (extend)
- Test: `apps/crm/src/pages/entregas/views/__tests__/KanbanPostEntities.test.tsx` (extend)

**Interfaces:**
- Consumes: `usePostProcessCommands` (Task 7), `planColumnPersist`/`sortableIdOf`/`computeCrossColumnSlot` (Task 4), `isValidDropTarget` (`boardRows.ts`), `previousStepOf`/`canConcluir`/`forwardLabelFor` (Task 7).
- Produces:
  - `PostProcessCardProps` gains `onForwardClick?: () => void; onRevertClick?: () => void; dragHandle?: React.ReactNode; forwardLabel?: 'Avançar etapa' | 'Concluir processo'; canRevert?: boolean`. Buttons carry `aria-label` equal to their label ("Voltar etapa", "Avançar etapa"/"Concluir processo"); `e.stopPropagation()` like `WorkflowCard.tsx:661-733`.
  - `SortablePostCard` becomes draggable (`useSortable({ id: entity.id })`, `attributes` on the wrapper, `listeners` on a `GripVertical` handle) — same shape as `SortableCard`.
  - `KanbanView` keeps `pendingPostSteps: Map<number, number>` (process id → optimistic ordem) fed by `usePostProcessCommands({ onOptimisticStep })`, applied to post entities as `{ etapaOrdem, etapaNome, step }` and released by the catch-up effect when `process.etapa_atual === ordem`.

- [ ] **Step 1: Write the failing tests**

Append to `PostProcessCard.test.tsx`:

```tsx
  it('renderiza Voltar/Avançar com aria-label e não propaga o clique ao card', () => {
    const onClick = vi.fn();
    const onForwardClick = vi.fn();
    const onRevertClick = vi.fn();
    render(<PostProcessCard entity={makeEntity()} onClick={onClick} onForwardClick={onForwardClick} onRevertClick={onRevertClick} canRevert forwardLabel="Avançar etapa" dragHandle={<span data-testid="handle" />} />);
    fireEvent.click(screen.getByRole('button', { name: 'Avançar etapa' }));
    fireEvent.click(screen.getByRole('button', { name: 'Voltar etapa' }));
    expect(onForwardClick).toHaveBeenCalledTimes(1);
    expect(onRevertClick).toHaveBeenCalledTimes(1);
    expect(onClick).not.toHaveBeenCalled();
    expect(screen.getByTestId('handle')).toBeInTheDocument();
  });
  it('sem canRevert não mostra Voltar; rótulo "Concluir processo" na última etapa', () => {
    render(<PostProcessCard entity={makeEntity()} onForwardClick={vi.fn()} forwardLabel="Concluir processo" />);
    expect(screen.queryByRole('button', { name: 'Voltar etapa' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Concluir processo' })).toBeInTheDocument();
  });
  it('sem handlers (leitura) não renderiza botão nenhum: DOM da fase 3', () => {
    render(<PostProcessCard entity={makeEntity()} />);
    expect(screen.queryAllByRole('button')).toHaveLength(0);
  });
```

Append to `KanbanPostEntities.test.tsx` (its `PostProcessCard` mock must be updated to render the two buttons and the handle from props; add `transitionPostProcess: vi.fn()`, `removePostProcess: vi.fn()`, `updateWorkflowPost: vi.fn()`, `reorderFluxosBoard: vi.fn()`, `CLIENT_CLEARED_STATUSES: [...]` to the hoisted store):

```tsx
  it('post na coluna: botão Avançar abre a confirmação e chama transition_post_process', async () => {
    store.transitionPostProcess.mockResolvedValue({ ok: true, revisao: 2, post_status: 'rascunho', post_status_changed: false, steps: [] });
    renderBoard({ postEntities: [postEntity] }); // helper do arquivo
    fireEvent.click(screen.getByRole('button', { name: 'Avançar etapa' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Avançar' }));
    await waitFor(() => expect(store.transitionPostProcess).toHaveBeenCalledWith(expect.objectContaining({ command: 'avancar', processId: postEntity.process.id })));
  });
  it('post na coluna tem alça de arrastar', () => {
    renderBoard({ postEntities: [postEntity] });
    expect(screen.getAllByTestId('drag-handle').length).toBeGreaterThan(0);
  });
```

- [ ] **Step 2: Run to verify failures**

Run: `npx vitest run apps/crm/src/pages/entregas/components/__tests__/PostProcessCard.test.tsx apps/crm/src/pages/entregas/views/__tests__/KanbanPostEntities.test.tsx`
Expected: FAIL (props unknown; no buttons; no handle).

- [ ] **Step 3: `PostProcessCard.tsx`**

Extend the props and, before the closing `</div>` of the card (after the cover block), add:

```tsx
      {(onRevertClick || onForwardClick || dragHandle) && (
        <div className="board-card-actions" style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', paddingTop: '0.5rem', borderTop: '1px solid var(--border-color)' }}>
          {dragHandle && <span className="board-card-drag-handle" style={{ cursor: 'grab', display: 'inline-flex' }}>{dragHandle}</span>}
          {canRevert && onRevertClick && (
            <button className="btn-revert-etapa" aria-label="Voltar etapa" title="Voltar etapa" style={{ padding: '0.35rem 0.55rem', borderRadius: '10px', flexShrink: 0 }} onClick={(e) => { e.stopPropagation(); onRevertClick(); }}>
              <ArrowLeft className="h-3.5 w-3.5" />
            </button>
          )}
          {onForwardClick && (
            <button className="btn-edit-workflow btn-forward-etapa" aria-label={forwardLabel ?? 'Avançar etapa'} title={forwardLabel ?? 'Avançar etapa'} style={{ padding: '0.35rem 0.55rem', borderRadius: '10px', flexShrink: 0, marginLeft: 'auto', color: '#3ecf8e', borderColor: '#3ecf8e' }} onClick={(e) => { e.stopPropagation(); onForwardClick(); }}>
              <Check className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      )}
```

Import `ArrowLeft, Check` from lucide. Update the doc comment: "Fase 4: botões Avançar/Voltar com aria-label e alça de arrastar (spec §4.2); sem handlers o DOM é o da fase 3."

- [ ] **Step 4: `KanbanView.tsx` — draggable post cards + commands**

1. `SortablePostCard` (lines 258-268):

```tsx
function SortablePostCard({ entity, onClick, onForwardClick, onRevertClick }: { entity: PostEntity; onClick?: () => void; onForwardClick: () => void; onRevertClick?: () => void }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: entity.id });
  return (
    <div ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.3 : 1, position: 'relative' }} {...attributes}>
      <PostProcessCard
        entity={entity}
        onClick={onClick}
        dragHandle={<GripVertical className="h-4 w-4" {...listeners} />}
        onForwardClick={onForwardClick}
        onRevertClick={onRevertClick}
        canRevert={previousStepOf(entity.process) != null}
        forwardLabel={forwardLabelFor(entity.process)}
      />
    </div>
  );
}
```

Imports for this file: `previousStepOf`, `nextPendingStepOf`, `forwardLabelFor`, `canConcluir`, `type ProcessTarget` from `'../postProcessCommands'`; `usePostProcessCommands` from `'../hooks/usePostProcessCommands'` (`GripVertical` and `useSortable` are already imported).

2. Optimistic step overlay for posts, next to `pendingPostPositions`:

```ts
  const [pendingPostSteps, setPendingPostSteps] = useState<Map<number, number>>(new Map());
  const commands = usePostProcessCommands({
    onRefresh,
    onOptimisticStep: (processId, ordem) =>
      setPendingPostSteps((prev) => {
        const next = new Map(prev);
        if (ordem == null) next.delete(processId); else next.set(processId, ordem);
        return next;
      }),
  });
```

Extend `applyPostOverlay` (Task 4) to also apply `pendingPostSteps`: when `ordem` is set and differs from `p.etapaOrdem`, find `p.steps.find(s => s.ordem === ordem)` and return `{ ...p, etapaOrdem: ordem, etapaNome: s?.nome ?? p.etapaNome, step: { ...p.step, ordem } }`. Release in the catch-up effect when the server's `p.process.etapa_atual === ordem` (or the process disappears from the list: concluded/removed).

3. `findCard` → keep, and add `findPost = (id: string) => posts.find((p) => p.id === id)`. `handleDragStart` sets `activeEntity` (`BoardEntity | null`) instead of `activeCard`; `DragOverlay` renders `WorkflowCard` for `kind === 'workflow'` (as today) and `<PostProcessCard entity={...} isDragOverlay />` for a post.

4. `handleDragOver`/`handleDragEnd`: replace `const draggedCard = findCard(activeId); if (!draggedCard) return;` with:

```ts
      const draggedCard = findCard(activeId);
      const draggedPost = draggedCard ? undefined : findPost(activeId);
      if (!draggedCard && !draggedPost) return;
      const draggedSteps = draggedCard ? draggedCard.allEtapas : draggedPost!.steps;
      const draggedOrdem = draggedCard ? draggedCard.etapa.ordem : draggedPost!.etapaOrdem;
```

and validate the drop in both handlers with:

```ts
      // Fluxo: adjacência por ordem (como hoje). Post: o MESMO alvo dos botões
      // (§12.2: drag e botão dão o mesmo resultado): avançar vai para a próxima
      // etapa PENDENTE, voltar para a anterior por ordem, qualquer estado.
      const valid = draggedCard
        ? isValidDropTarget(draggedSteps, draggedOrdem, targetColumn.ordem)
        : nextPendingStepOf(draggedPost!.process)?.ordem === targetColumn.ordem ||
          previousStepOf(draggedPost!.process)?.ordem === targetColumn.ordem;
```

(`draggedSteps`/`draggedOrdem` are then only read on the fluxo branch.) In `handleDragEnd` the post branch decides direction by comparing `targetColumn.ordem` with `nextPendingStepOf(...)?.ordem` (forward) rather than by `diff === 1`, so a `herdado`/`ignorado`/`concluido` step between the two columns never mis-routes the command. In `handleDragEnd`'s cross-column branch, `pendingInsertRef.current = { movedId: activeId, ids: ..., optimisticPos }` (rename `wfId` → `movedId: BoardSortableId`; update `advanceEtapa`/`handleRevertConfirm` comparisons to `pendingInsertRef.current?.movedId === String(wfId)`), then:

```ts
        if (draggedPost) {
          const t = targetOf(draggedPost);
          const forward = nextPendingStepOf(draggedPost.process)?.ordem === targetColumn.ordem;
          if (forward) commands.avancar(t); else commands.voltar(t);
          return;
        }
```

where `targetOf = (p: PostEntity): ProcessTarget => ({ process: p.process, post: { id: p.process.post_id, titulo: p.titulo, status: p.process.post.status, cliente_id: p.process.post.cliente_id } })`. The captured drop position for a post is persisted by an effect: when `pendingPostSteps` releases a process whose `pendingInsertRef.current?.movedId === 'post:<id>'`, call `persistColumnOrder(insert.ids)` best-effort (same `console.warn` as the fluxo path) and clear the ref. Cancel/rollback (`onOptimisticStep(id, null)`) also clears the ref.

5. Render: `SortablePostCard` gets `onForwardClick={() => (canConcluir(entity.process) ? commands.concluir(targetOf(entity)) : commands.avancar(targetOf(entity)))}` and `onRevertClick={() => commands.voltar(targetOf(entity))}`. Render `{commands.dialogs}` next to the existing three dialogs.

- [ ] **Step 5: Run + typecheck**

Run: `npx vitest run apps/crm/src/pages/entregas && npx tsc -p apps/crm/tsconfig.json --noEmit`
Expected: PASS. `KanbanRearm`/`KanbanFullColumnOrder`/`KanbanSync`/`KanbanPrazoSort`/`KanbanDuplicateNames` hoisted mocks gain the same five store entries as `KanbanPostEntities`.

- [ ] **Step 6: Commit**

```bash
git add apps/crm/src/pages/entregas apps/crm/style.css
git commit -m "feat(entregas): card de post individual com Avançar/Voltar e arrasto entre etapas adjacentes"
```

---

### Task 9: Concluídas — "Reabrir processo"

**Files:**
- Modify: `apps/crm/src/pages/entregas/views/ConcludedView.tsx:236-262`
- Test: `apps/crm/src/pages/entregas/views/__tests__/ConcludedView.test.tsx` (extend)

**Interfaces:**
- Consumes: `usePostProcessCommands` (Task 7); `refresh` semantics = the view's own invalidation list at `handleReopenConfirm` (lines 148-158).
- Produces: on each "Post individual" row, a `RotateCcw` button `title="Reabrir processo"` `aria-label="Reabrir processo"` that calls `commands.reabrir(target)`; `{commands.dialogs}` rendered once.

- [ ] **Step 1: Write the failing test**

```tsx
  it('Reabrir processo: confirma e chama transition_post_process com reabrir', async () => {
    store.transitionPostProcess.mockResolvedValue({ ok: true, revisao: 2, post_status: 'postado', post_status_changed: false, steps: [] });
    (getVigentePostProcesses as any).mockResolvedValueOnce([concludedProcessFixture]);
    renderView();
    fireEvent.click(await screen.findByText('Cliente X')); // expand the client group (use the fixture's client name)
    fireEvent.click(await screen.findByRole('button', { name: 'Reabrir processo' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Reabrir' }));
    await waitFor(() => expect(store.transitionPostProcess).toHaveBeenCalledWith(expect.objectContaining({ command: 'reabrir', processId: concludedProcessFixture.id, expectedRevisao: concludedProcessFixture.revisao })));
  });
  it('rollback: reabrir falha com process_not_concluded → toast mapeado e nenhum sucesso', async () => {
    store.transitionPostProcess.mockRejectedValueOnce({ message: 'process_not_concluded', code: 'P0001' });
    (getVigentePostProcesses as any).mockResolvedValueOnce([concludedProcessFixture]);
    renderView();
    fireEvent.click(await screen.findByText('Cliente X'));
    fireEvent.click(await screen.findByRole('button', { name: 'Reabrir processo' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Reabrir' }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Só um processo concluído pode ser reaberto.'));
    expect(toast.success).not.toHaveBeenCalled();
  });
```

(Add `transitionPostProcess`, `removePostProcess`, `updateWorkflowPost`, `CLIENT_CLEARED_STATUSES` to the file's store mock.)

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run apps/crm/src/pages/entregas/views/__tests__/ConcludedView.test.tsx`
Expected: FAIL (button absent).

- [ ] **Step 3: Implement**

```tsx
  const commands = usePostProcessCommands({
    onRefresh: () => {
      qc.invalidateQueries({ queryKey: ['concluded-workflows'] });
      qc.invalidateQueries({ queryKey: ['concluded-summaries'] });
      qc.invalidateQueries({ queryKey: ['workflows'] });
      qc.invalidateQueries({ queryKey: ['all-active-etapas'] });
      qc.invalidateQueries({ queryKey: ['post-processes'] });
    },
  });
```

In the process row (line ~240), replace the trailing `→` span with:

```tsx
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                        <button
                          className="concluded-reopen-btn"
                          title="Reabrir processo"
                          aria-label="Reabrir processo"
                          onClick={(e) => {
                            e.stopPropagation();
                            commands.reabrir({ process: p, post: { id: p.post_id, titulo: p.post.titulo, status: p.post.status, cliente_id: p.post.cliente_id } });
                          }}
                        >
                          <RotateCcw size={14} />
                        </button>
                        <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>→</span>
                      </div>
```

Render `{commands.dialogs}` before the existing reopen `AlertDialog`.

- [ ] **Step 4: Run + commit**

Run: `npx vitest run apps/crm/src/pages/entregas/views && npx tsc -p apps/crm/tsconfig.json --noEmit`
Expected: PASS.

```bash
git add apps/crm/src/pages/entregas/views/ConcludedView.tsx apps/crm/src/pages/entregas/views/__tests__/ConcludedView.test.tsx
git commit -m "feat(entregas): reabrir processo individual a partir de Concluídas"
```

---

### Task 10: Edit responsável and prazo of a `pendente`/`ativo` step (`update_post_process_step`)

**Files:**
- Modify: `apps/crm/src/pages/entregas/components/PostProductionSection.tsx` (inline editors per step)
- Modify: `apps/crm/style.css` (`.post-production-step-edit`)
- Test: `apps/crm/src/pages/entregas/components/__tests__/PostProductionSection.test.tsx` (extend)

**Interfaces:**
- Consumes: `updatePostProcessStep` (Task 2), `toLocalISODate`/`parseLocalISODate`/`endOfLocalDay` (Task 6), `getPostProcessErrorToast`/`isStaleStateError` (Task 1), shadcn `Select`.
- Produces: for `process.estado === 'ativo'` and steps with `estado ∈ {pendente, ativo}`, a responsável `<Select>` (`aria-label="Responsável da etapa <nome>"`, options "Sem responsável" + `membros`) and an `<input type="date" aria-label="Prazo da etapa <nome>">`. Any change sends BOTH current values (absolute setters): `updatePostProcessStep({ processId, expectedRevisao: process.revisao, ordem, responsavelId, prazoEfetivo })`, where `prazoEfetivo = date ? endOfLocalDay(parseLocalISODate(date)).toISOString() : null`. Optimistic: the control shows the new value immediately; on failure it reverts to the server value, toasts, and stale-state errors refetch. Steps in `concluido/herdado/ignorado/interrompido` stay read-only (spec §5.4).

- [ ] **Step 1: Write the failing tests**

```tsx
  it('etapa pendente: trocar responsável envia os DOIS valores e invalida o processo', async () => {
    store.updatePostProcessStep.mockResolvedValue({ ok: true, revisao: 2, step: {} });
    const { qc } = renderSection({ process: activeProcessWithPendingStep, membros: [{ id: 4, nome: 'Ana' }, { id: 9, nome: 'Bia' }] });
    const invalidate = vi.spyOn(qc, 'invalidateQueries');
    // Radix Select: open the trigger and pick the option
    fireEvent.click(screen.getByRole('combobox', { name: 'Responsável da etapa Design' }));
    fireEvent.click(await screen.findByRole('option', { name: 'Bia' }));
    await waitFor(() => expect(store.updatePostProcessStep).toHaveBeenCalledWith({
      processId: activeProcessWithPendingStep.id, expectedRevisao: activeProcessWithPendingStep.revisao,
      ordem: 1, responsavelId: 9, prazoEfetivo: activeProcessWithPendingStep.steps[1].prazo_efetivo,
    }));
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['post-process', activeProcessWithPendingStep.post_id] });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['post-processes'] });
  });
  it('prazo: data local vira fim do dia; limpar manda null', async () => {
    store.updatePostProcessStep.mockResolvedValue({ ok: true, revisao: 2, step: {} });
    renderSection({ process: activeProcessWithPendingStep, membros: [] });
    const input = screen.getByLabelText('Prazo da etapa Design') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '2026-09-25' } });
    await waitFor(() => expect(store.updatePostProcessStep).toHaveBeenLastCalledWith(expect.objectContaining({ prazoEfetivo: new Date(2026, 8, 25, 23, 59, 59, 999).toISOString() })));
    fireEvent.change(input, { target: { value: '' } });
    await waitFor(() => expect(store.updatePostProcessStep).toHaveBeenLastCalledWith(expect.objectContaining({ prazoEfetivo: null })));
  });
  it('rollback: falha step_not_editable → valor volta ao do servidor e toast mapeado', async () => {
    store.updatePostProcessStep.mockRejectedValueOnce({ message: 'step_not_editable', code: 'P0001' });
    renderSection({ process: activeProcessWithPendingStep, membros: [] });
    const input = screen.getByLabelText('Prazo da etapa Design') as HTMLInputElement;
    const before = input.value;
    fireEvent.change(input, { target: { value: '2026-09-25' } });
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Só etapas pendentes ou em andamento podem ser editadas.'));
    await waitFor(() => expect(input.value).toBe(before));
  });
  it('etapas concluídas/herdadas/ignoradas e processo concluído não têm controles', () => {
    renderSection({ process: concludedProcess, membros: [] });
    expect(screen.queryAllByRole('combobox')).toHaveLength(0);
    expect(screen.queryAllByLabelText(/Prazo da etapa/)).toHaveLength(0);
  });
```

(`renderSection` = the file's existing helper, extended to return `qc`; add `updatePostProcessStep: vi.fn()` to its `@/store` mock and `toast` to a `sonner` mock. Radix `Select` in jsdom: if `fireEvent.click` on the trigger does not open the listbox, use `fireEvent.keyDown(trigger, { key: 'ArrowDown' })` then pick the option; the repo's `SortableEtapaList.test.tsx` shows the working incantation.)

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run apps/crm/src/pages/entregas/components/__tests__/PostProductionSection.test.tsx`
Expected: FAIL (no controls).

- [ ] **Step 3: Implement**

In `PostProductionSection.tsx`, add local state `const [draft, setDraft] = useState<Record<number, { responsavelId: number | null; prazo: string }>>({});` and `const [savingOrdem, setSavingOrdem] = useState<number | null>(null);` plus:

```tsx
  const qc = useQueryClient();
  const editable = (step: PostProcessStep) =>
    process.estado === 'ativo' && (step.estado === 'pendente' || step.estado === 'ativo');
  const valueOf = (step: PostProcessStep) =>
    draft[step.ordem] ?? {
      responsavelId: step.responsavel_id,
      prazo: step.prazo_efetivo ? toLocalISODate(new Date(step.prazo_efetivo)) : '',
    };
  const save = async (step: PostProcessStep, next: { responsavelId: number | null; prazo: string }) => {
    setDraft((d) => ({ ...d, [step.ordem]: next }));
    setSavingOrdem(step.ordem);
    try {
      const day = next.prazo ? parseLocalISODate(next.prazo) : null;
      await updatePostProcessStep({
        processId: process.id,
        expectedRevisao: process.revisao,
        ordem: step.ordem,
        responsavelId: next.responsavelId,
        prazoEfetivo: day ? endOfLocalDay(day).toISOString() : null,
      });
      qc.invalidateQueries({ queryKey: ['post-process', postId] });
      qc.invalidateQueries({ queryKey: ['post-processes'] });
      qc.invalidateQueries({ queryKey: ['post-process-events'] });
    } catch (err) {
      setDraft((d) => { const { [step.ordem]: _drop, ...rest } = d; return rest; }); // revert to server value
      toast.error(getPostProcessErrorToast(err, 'Erro ao editar etapa'));
      if (isStaleStateError(err)) qc.invalidateQueries({ queryKey: ['post-process', postId] });
    } finally {
      setSavingOrdem(null);
    }
  };
```

Clear `draft[ordem]` whenever `process.revisao` changes (a `useEffect` on `process.revisao` → `setDraft({})`), so the server value wins after refetch. In the step body, replace the static responsável/prazo spans with, when `editable(step)`:

```tsx
                  <div className="post-production-step-edit">
                    <Select value={String(v.responsavelId ?? '')} onValueChange={(val) => save(step, { ...v, responsavelId: val === '' ? null : Number(val) })} disabled={savingOrdem === step.ordem}>
                      <SelectTrigger aria-label={`Responsável da etapa ${step.nome}`} className="h-7 text-xs"><SelectValue placeholder="Sem responsável" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="">Sem responsável</SelectItem>
                        {membros.map((m) => <SelectItem key={m.id} value={String(m.id)}>{m.nome}</SelectItem>)}
                      </SelectContent>
                    </Select>
                    <input type="date" aria-label={`Prazo da etapa ${step.nome}`} className="h-7 text-xs rounded-md border border-input px-2" value={v.prazo} disabled={savingOrdem === step.ordem} onChange={(e) => save(step, { ...v, prazo: e.target.value })} />
                  </div>
```

(If the repo's `SelectItem` rejects an empty-string value — Radix does in v2 — use the sentinel `'none'` and map it to `null`.) Non-editable steps keep today's spans.

`style.css`: `.post-production-step-edit { display: flex; gap: 0.4rem; align-items: center; margin-top: 0.25rem; flex-wrap: wrap; }`.

- [ ] **Step 4: Run + commit**

Run: `npx vitest run apps/crm/src/pages/entregas/components && npx tsc -p apps/crm/tsconfig.json --noEmit`
Expected: PASS.

```bash
git add apps/crm/src/pages/entregas/components/PostProductionSection.tsx apps/crm/src/pages/entregas/components/__tests__/PostProductionSection.test.tsx apps/crm/style.css
git commit -m "feat(entregas): editar responsável e prazo das etapas de um processo individual"
```

---

### Task 11: "Desmembrar do fluxo" with "Manter etapas" (`detach_posts_keeping_process`) + reveal on the board

**Files:**
- Create: `apps/crm/src/pages/entregas/components/DetachPostsDialog.tsx`
- Create: `apps/crm/src/pages/entregas/revealFilters.ts`
- Modify: `apps/crm/src/pages/entregas/components/WorkflowDrawer.tsx:134-143 (delete getDetachErrorToast), 147-162 (prop), 619-650 (handlers), 1125-1170 (inline dialog → component)`
- Modify: `apps/crm/src/pages/entregas/EntregasPage.tsx` (reveal state + effect; pass the new drawer prop)
- Test: `apps/crm/src/pages/entregas/components/__tests__/DetachPostsDialog.test.tsx` (create)
- Test: `apps/crm/src/pages/entregas/__tests__/revealFilters.test.ts` (create)
- Test: `apps/crm/src/pages/entregas/__tests__/EntregasPage.test.tsx` (one reveal case)

**Interfaces:**
- Consumes: `detachPostsFromWorkflow` (existing), `detachPostsKeepingProcess` (Task 2), `buildFingerprint` (`fingerprint.ts`), `buildDetachDeadlines` (Task 6), `getPostProcessErrorToast`/`isStaleStateError` (Task 1), `matchesPostEntityFilters` (`entityFilters.ts`), `EMPTY_FILTERS`/`FilterState` (`components/EntregasFilters.tsx`).
- Produces:

```ts
// DetachPostsDialog.tsx
export interface DetachPostsDialogProps {
  open: boolean;
  onClose: () => void;
  card: BoardCard;                       // workflow, etapa (ativa), allEtapas
  posts: { id: number; titulo: string | null }[];   // the batch
  isTotalSelection: boolean;
  /** features?.feature_post_processes === true: the ONLY flag read in this dialog. */
  keepStepsEnabled: boolean;
  onDetachedWithoutProcess: (result: DetachPostsResult, archived: boolean) => void;
  onDetachedKeepingProcess: (result: DetachKeepingProcessResult, archived: boolean) => void;
}
export function DetachPostsDialog(props: DetachPostsDialogProps): JSX.Element;
export function newRequestId(): string;  // crypto.randomUUID() with a Math.random v4 fallback
export function keepStepsAvailability(card: BoardCard, activeDeadline: string | null): { available: boolean; reason?: string };

// revealFilters.ts
export function filtersToReveal(entities: PostEntity[], filters: FilterState, now?: Date): { filters: FilterState; cleared: (keyof FilterState)[] };
```

- `WorkflowDrawerProps` gains `onDetachedKeepingProcess?: (postIds: number[]) => void` (EntregasPage passes it; EntregasTab does not).
- `EntregasPage` gains `revealPostProcesses(postIds: number[])` (spec §4.1: Kanban, mode `entregas`, entidade `todos`, refresh, then a pending-reveal effect that clears only the filters hiding the entities and opens the drawer when exactly one post).

- [ ] **Step 1: Write the failing tests**

```ts
// apps/crm/src/pages/entregas/__tests__/revealFilters.test.ts
import { describe, expect, it } from 'vitest';
import { filtersToReveal } from '../revealFilters';
import { EMPTY_FILTERS } from '../components/EntregasFilters';
import type { PostEntity } from '../boardEntity';

const entity = {
  kind: 'post', id: 'post:9', titulo: 'Reels de setembro', templateId: 3, etapaOrdem: 1, etapaNome: 'Design',
  steps: [], responsavel: undefined, prazoEfetivo: null, posicao: 0,
  deadline: { diasRestantes: 2, horasRestantes: 0, estourado: false, urgente: false }, cliente: undefined,
  process: { id: 9, post_id: 77, post: { cliente_id: 4, responsavel_id: null, status: 'rascunho' } },
  step: { responsavel_id: 8 },
} as unknown as PostEntity;

describe('filtersToReveal', () => {
  it('não mexe em nada quando a entidade já é visível', () => {
    const f = { ...EMPTY_FILTERS, filterClientes: [4] };
    expect(filtersToReveal([entity], f)).toEqual({ filters: f, cleared: [] });
  });
  it('limpa SÓ as dimensões que escondem (cliente e etapa), preservando as outras', () => {
    const f = { ...EMPTY_FILTERS, filterClientes: [99], filterEtapas: ['Copy'], filterMembros: [8], filterSearch: 'reels' };
    const r = filtersToReveal([entity], f);
    expect(r.cleared.sort()).toEqual(['filterClientes', 'filterEtapas']);
    expect(r.filters).toEqual({ ...f, filterClientes: [], filterEtapas: [] });
  });
  it('trata prazo (preset + intervalo) como uma dimensão só', () => {
    const f = { ...EMPTY_FILTERS, filterPrazo: ['atrasado' as const] };
    const r = filtersToReveal([entity], f);
    expect(r.cleared).toEqual(expect.arrayContaining(['filterPrazo', 'filterPrazoFrom', 'filterPrazoTo']));
  });
});
```

```tsx
// apps/crm/src/pages/entregas/components/__tests__/DetachPostsDialog.test.tsx
import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const store = vi.hoisted(() => ({ detachPostsFromWorkflow: vi.fn(), detachPostsKeepingProcess: vi.fn() }));
vi.mock('../../../../store', () => store);
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() }));
vi.mock('sonner', () => ({ toast }));

import { DetachPostsDialog, keepStepsAvailability } from '../DetachPostsDialog';
import type { BoardCard } from '../../hooks/useEntregasData';

const etapas = [
  { id: 1, workflow_id: 11, ordem: 0, nome: 'Copy', tipo: 'padrao', status: 'concluido', prazo_dias: 2, tipo_prazo: 'corridos', iniciado_em: '2026-09-01T12:00:00Z', data_limite: null },
  { id: 2, workflow_id: 11, ordem: 1, nome: 'Design', tipo: 'padrao', status: 'ativo', prazo_dias: 2, tipo_prazo: 'corridos', iniciado_em: '2026-09-10T12:00:00Z', data_limite: null },
  { id: 3, workflow_id: 11, ordem: 2, nome: 'Aprovação', tipo: 'aprovacao_cliente', status: 'pendente', prazo_dias: 1, tipo_prazo: 'corridos', iniciado_em: null, data_limite: '2026-09-20' },
] as never[];
const card = {
  workflow: { id: 11, titulo: 'Conteúdo de setembro', status: 'ativo', etapa_atual: 1, cliente_id: 4, template_id: 3 },
  etapa: etapas[1], allEtapas: etapas, cliente: { id: 4, nome: 'Aurora' }, etapaIdx: 1, totalEtapas: 3,
} as unknown as BoardCard;
const posts = [{ id: 7, titulo: 'Post A' }, { id: 3, titulo: 'Post B' }];

function renderDialog(over: Partial<React.ComponentProps<typeof DetachPostsDialog>> = {}) {
  const onDetachedWithoutProcess = vi.fn();
  const onDetachedKeepingProcess = vi.fn();
  const onClose = vi.fn();
  render(<DetachPostsDialog open onClose={onClose} card={card} posts={posts} isTotalSelection={false} keepStepsEnabled onDetachedWithoutProcess={onDetachedWithoutProcess} onDetachedKeepingProcess={onDetachedKeepingProcess} {...over} />);
  return { onDetachedWithoutProcess, onDetachedKeepingProcess, onClose };
}

beforeEach(() => vi.clearAllMocks());

describe('DetachPostsDialog', () => {
  it('flag desligada: o AlertDialog de hoje, sem opções (DOM da fase 3)', () => {
    renderDialog({ keepStepsEnabled: false });
    expect(screen.getByText('Desmembrar do fluxo?')).toBeInTheDocument();
    expect(screen.queryByLabelText('Manter etapas')).toBeNull();
    expect(screen.getByText(/viram publicações avulsas de Aurora/)).toBeInTheDocument();
  });
  it('flag ligada: Manter etapas pré-selecionada, lista os posts e a etapa atual', () => {
    renderDialog();
    expect(screen.getByLabelText('Manter etapas')).toBeChecked();
    expect(screen.getByLabelText('Transformar em avulso sem etapas')).not.toBeChecked();
    expect(screen.getByText('Post A')).toBeInTheDocument();
    expect(screen.getByText(/etapa atual: Design/)).toBeInTheDocument();
    expect(screen.getByText(/Status, conteúdo e aprovações são preservados/)).toBeInTheDocument();
  });
  it('Manter etapas: envia fingerprint, prazo congelado, mapa de prazos futuros e request_id estável', async () => {
    store.detachPostsKeepingProcess.mockResolvedValue({ ok: true, detached: 2, archived_workflow_ids: [], processes: [], steps: [] });
    const { onDetachedKeepingProcess } = renderDialog();
    fireEvent.click(screen.getByRole('button', { name: 'Desmembrar' }));
    await waitFor(() => expect(store.detachPostsKeepingProcess).toHaveBeenCalledTimes(1));
    const args = store.detachPostsKeepingProcess.mock.calls[0][0];
    expect(args.postIds).toEqual([7, 3]);
    expect(args.workflowId).toBe(11);
    expect(args.fingerprint.startsWith('etapa_atual=1\n')).toBe(true);
    expect(args.activeDeadline).toBe(new Date('2026-09-12T12:00:00Z').toISOString());
    expect(args.stepDeadlines).toEqual({ '2': new Date(2026, 8, 20, 23, 59, 59, 999).toISOString() });
    expect(args.requestId).toMatch(/^[0-9a-f-]{36}$/);
    expect(args.archiveEmptyFlow).toBe(false);
    expect(onDetachedKeepingProcess).toHaveBeenCalledWith(expect.objectContaining({ detached: 2 }), false);
  });
  it('mudar o checkbox de arquivar troca o request_id (input_hash do servidor)', async () => {
    // O harness mantém open=true, então dois envios bem-sucedidos são observáveis.
    store.detachPostsKeepingProcess.mockResolvedValue({ ok: true, detached: 2, archived_workflow_ids: [], processes: [], steps: [] });
    renderDialog({ isTotalSelection: true });
    fireEvent.click(screen.getByRole('button', { name: 'Desmembrar' }));
    await waitFor(() => expect(store.detachPostsKeepingProcess).toHaveBeenCalledTimes(1));
    const first = store.detachPostsKeepingProcess.mock.calls[0][0].requestId;
    fireEvent.click(screen.getByLabelText('Arquivar o fluxo depois de desmembrar'));
    fireEvent.click(screen.getByRole('button', { name: 'Desmembrar' }));
    await waitFor(() => expect(store.detachPostsKeepingProcess).toHaveBeenCalledTimes(2));
    expect(store.detachPostsKeepingProcess.mock.calls[1][0].requestId).not.toBe(first);
    expect(store.detachPostsKeepingProcess.mock.calls[1][0].archiveEmptyFlow).toBe(true);
  });
  it('falha na RPC regenera o request_id para a próxima tentativa', async () => {
    store.detachPostsKeepingProcess.mockRejectedValueOnce({ message: 'workflow_changed', code: 'P0001' }).mockResolvedValueOnce({ ok: true, detached: 2, archived_workflow_ids: [], processes: [], steps: [] });
    renderDialog();
    fireEvent.click(screen.getByRole('button', { name: 'Desmembrar' }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('O fluxo foi alterado em outro lugar. Recarregue e tente de novo.'));
    const first = store.detachPostsKeepingProcess.mock.calls[0][0].requestId;
    fireEvent.click(screen.getByRole('button', { name: 'Desmembrar' }));
    await waitFor(() => expect(store.detachPostsKeepingProcess).toHaveBeenCalledTimes(2));
    expect(store.detachPostsKeepingProcess.mock.calls[1][0].requestId).not.toBe(first);
  });
  it('Transformar em avulso: caminho antigo, sem processo', async () => {
    store.detachPostsFromWorkflow.mockResolvedValue({ ok: true, detached: 2, archived_workflow_ids: [] });
    const { onDetachedWithoutProcess } = renderDialog();
    fireEvent.click(screen.getByLabelText('Transformar em avulso sem etapas'));
    fireEvent.click(screen.getByRole('button', { name: 'Desmembrar' }));
    await waitFor(() => expect(store.detachPostsFromWorkflow).toHaveBeenCalledWith([7, 3], false));
    expect(store.detachPostsKeepingProcess).not.toHaveBeenCalled();
    expect(onDetachedWithoutProcess).toHaveBeenCalled();
  });
  it('fluxo não ativo ou etapas inconsistentes: só a opção sem etapas, com explicação', () => {
    renderDialog({ card: { ...card, workflow: { ...card.workflow, status: 'concluido' } } as never });
    expect(screen.getByLabelText('Manter etapas')).toBeDisabled();
    expect(screen.getByText(/Um processo pode ser aplicado depois/)).toBeInTheDocument();
    expect(screen.getByLabelText('Transformar em avulso sem etapas')).toBeChecked();
  });
});

describe('keepStepsAvailability', () => {
  it('exige fluxo ativo, exatamente uma etapa ativa e prazo calculável', () => {
    expect(keepStepsAvailability(card, '2026-09-12T12:00:00.000Z')).toEqual({ available: true });
    expect(keepStepsAvailability(card, null).available).toBe(false);
    const twoActive = { ...card, allEtapas: [etapas[1], { ...etapas[2], status: 'ativo' }] } as never;
    expect(keepStepsAvailability(twoActive, 'x').available).toBe(false);
  });
});
```

Add to `EntregasPage.test.tsx`:

```tsx
    it('desmembrar mantendo etapas revela o card: Kanban, Todos, filtros que escondiam limpos, drawer do post aberto', async () => {
      limitsMock.features = { feature_post_processes: true };
      store.getVigentePostProcesses.mockResolvedValueOnce([]).mockResolvedValue([vigenteFixture]); // second fetch = after refresh
      renderPage('/entregas?view=list&clientes=99');
      // Drive the page's revealPostProcesses through the drawer callback (the drawer is mocked in this file;
      // grab the onDetachedKeepingProcess prop from the mock's last render and call it).
      const drawerProps = WorkflowDrawerMock.mock.lastCall![0];
      await act(async () => drawerProps.onDetachedKeepingProcess([vigenteFixture.post_id]));
      await screen.findByTestId('post-process-card');
      expect(window.location.search).toContain('entidade=todos');
      expect(window.location.search).not.toContain('clientes=99');
      expect(toast.info).toHaveBeenCalledWith('Filtros removidos para mostrar o post no quadro.');
      expect(StandalonePostDrawerMock).toHaveBeenLastCalledWith(expect.objectContaining({ postId: vigenteFixture.post_id }), expect.anything());
    });
```

(Open a WorkflowDrawer first via the file's existing helper for `?drawer=`; if the file mocks `WorkflowDrawer`/`StandalonePostDrawer` under other names, use those.) Add a second case for the timing guard: `getVigentePostProcesses` resolves `[]` on the first two calls and `[vigenteFixture]` only on the third (the refresh); assert `toast.error` is NOT called with 'O post não apareceu no quadro. Recarregue a página.' and that the drawer opens once the entity arrives.

- [ ] **Step 2: Run to verify failures**

Run: `npx vitest run apps/crm/src/pages/entregas/__tests__/revealFilters.test.ts apps/crm/src/pages/entregas/components/__tests__/DetachPostsDialog.test.tsx`
Expected: FAIL (modules missing).

- [ ] **Step 3: `revealFilters.ts`**

```ts
// apps/crm/src/pages/entregas/revealFilters.ts
import { EMPTY_FILTERS, type FilterState } from './components/EntregasFilters';
import { matchesPostEntityFilters } from './entityFilters';
import type { PostEntity } from './boardEntity';

/** Dimensões independentes do filtro do modo Fluxos; prazo é uma só. */
const GROUPS: (keyof FilterState)[][] = [
  ['filterSearch'], ['filterClientes'], ['filterMembros'], ['filterPostResponsaveis'],
  ['filterEtapas'], ['filterTemplates'], ['filterStatus'],
  ['filterPrazo', 'filterPrazoFrom', 'filterPrazoTo'],
];

function withCleared(filters: FilterState, keys: (keyof FilterState)[]): FilterState {
  const out = { ...filters } as Record<keyof FilterState, unknown>;
  for (const k of keys) out[k] = EMPTY_FILTERS[k];
  return out as FilterState;
}

/**
 * Spec §4.1: revelar o card "removendo só os filtros que o ocultariam". Uma
 * dimensão esconde a entidade quando ela passa com TODAS as dimensões limpas
 * mas não passa com todas limpas EXCETO essa. União sobre as entidades.
 */
export function filtersToReveal(
  entities: PostEntity[],
  filters: FilterState,
  now: Date = new Date(),
): { filters: FilterState; cleared: (keyof FilterState)[] } {
  const all = GROUPS.flat();
  const cleared = new Set<keyof FilterState>();
  for (const e of entities) {
    if (matchesPostEntityFilters(e, filters, now)) continue;
    if (!matchesPostEntityFilters(e, withCleared(filters, all), now)) continue; // hidden by something we cannot clear
    for (const group of GROUPS) {
      const allButThis = all.filter((k) => !group.includes(k));
      if (!matchesPostEntityFilters(e, withCleared(filters, allButThis), now)) group.forEach((k) => cleared.add(k));
    }
  }
  const keys = [...cleared];
  return { filters: keys.length ? withCleared(filters, keys) : filters, cleared: keys };
}
```

- [ ] **Step 4: `DetachPostsDialog.tsx`**

```tsx
// apps/crm/src/pages/entregas/components/DetachPostsDialog.tsx
import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import {
  detachPostsFromWorkflow, detachPostsKeepingProcess,
  type DetachKeepingProcessResult, type DetachPostsResult,
} from '../../../store';
import type { BoardCard } from '../hooks/useEntregasData';
import { buildFingerprint } from '../fingerprint';
import { buildDetachDeadlines } from '../detachDeadlines';
import { getPostProcessErrorToast } from '../postProcessErrors';

export interface DetachPostsDialogProps {
  open: boolean;
  onClose: () => void;
  card: BoardCard;
  posts: { id: number; titulo: string | null }[];
  isTotalSelection: boolean;
  keepStepsEnabled: boolean;
  onDetachedWithoutProcess: (result: DetachPostsResult, archived: boolean) => void;
  onDetachedKeepingProcess: (result: DetachKeepingProcessResult, archived: boolean) => void;
}

export function newRequestId(): string {
  const c = globalThis.crypto as { randomUUID?: () => string } | undefined;
  if (c?.randomUUID) return c.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (ch) => {
    const r = (Math.random() * 16) | 0;
    return (ch === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

/** Spec §5.1: manter etapas exige fluxo ativo com exatamente uma etapa ativa,
 *  e um prazo congelável para ela (senão a RPC responde active_deadline_required). */
export function keepStepsAvailability(
  card: BoardCard,
  activeDeadline: string | null,
): { available: boolean; reason?: string } {
  if (card.workflow.status !== 'ativo') return { available: false, reason: 'O fluxo não está ativo.' };
  const ativas = card.allEtapas.filter((e) => e.status === 'ativo').length;
  if (ativas !== 1) return { available: false, reason: 'As etapas deste fluxo estão inconsistentes.' };
  if (!activeDeadline) return { available: false, reason: 'Não foi possível calcular o prazo da etapa atual.' };
  return { available: true };
}

type Mode = 'manter' | 'avulso';

export function DetachPostsDialog({
  open, onClose, card, posts, isTotalSelection, keepStepsEnabled, onDetachedWithoutProcess, onDetachedKeepingProcess,
}: DetachPostsDialogProps) {
  const deadlines = useMemo(() => buildDetachDeadlines(card.allEtapas, card.etapa), [card]);
  const availability = keepStepsAvailability(card, deadlines.activeDeadline);
  const keepAvailable = keepStepsEnabled && availability.available;
  const [mode, setMode] = useState<Mode>('manter');
  const [archive, setArchive] = useState(false);
  const [busy, setBusy] = useState(false);
  const postIdsKey = posts.map((p) => p.id).join(',');
  // Spec §9.4 + fase 2 (input_hash): novo id sempre que a entrada muda.
  const [requestId, setRequestId] = useState(newRequestId);
  useEffect(() => { setRequestId(newRequestId()); }, [open, postIdsKey, archive, card.workflow.id]);
  useEffect(() => { if (open) { setMode(keepAvailable ? 'manter' : 'avulso'); setArchive(false); } }, [open, keepAvailable]);

  const confirm = async () => {
    const ids = posts.map((p) => p.id);
    const archiveFlag = isTotalSelection && archive;
    setBusy(true);
    try {
      if (keepStepsEnabled && mode === 'manter') {
        const result = await detachPostsKeepingProcess({
          postIds: ids,
          workflowId: card.workflow.id!,
          fingerprint: buildFingerprint(card.workflow, card.allEtapas),
          activeDeadline: deadlines.activeDeadline!,
          requestId,
          stepDeadlines: deadlines.stepDeadlines,
          archiveEmptyFlow: archiveFlag,
        });
        onDetachedKeepingProcess(result, result.archived_workflow_ids.length > 0);
      } else {
        const result = await detachPostsFromWorkflow(ids, archiveFlag);
        onDetachedWithoutProcess(result, archiveFlag);
      }
    } catch (err) {
      toast.error(getPostProcessErrorToast(err, 'Erro ao desmembrar posts'));
      setRequestId(newRequestId());
    } finally {
      setBusy(false);
    }
  };

  const archiveRow = isTotalSelection && (
    <div className="flex items-center gap-2">
      <Checkbox id="detach-archive-empty-flow" checked={archive} onCheckedChange={(c) => setArchive(c === true)} aria-label="Arquivar o fluxo depois de desmembrar" />
      <Label htmlFor="detach-archive-empty-flow">Arquivar o fluxo depois de desmembrar</Label>
    </div>
  );

  return (
    <AlertDialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Desmembrar do fluxo?</AlertDialogTitle>
          {keepStepsEnabled ? (
            <AlertDialogDescription>
              {posts.length === 1 ? '1 publicação' : `${posts.length} publicações`} de {card.cliente?.nome || '—'}, etapa atual: {card.etapa.nome}. Status, conteúdo e aprovações são preservados.
            </AlertDialogDescription>
          ) : (
            <AlertDialogDescription>
              Os posts selecionados viram publicações avulsas de {card.cliente?.nome || '—'}. Eles
              continuam no quadro de Publicações e no portal do cliente, mas saem deste fluxo.
            </AlertDialogDescription>
          )}
        </AlertDialogHeader>
        {keepStepsEnabled && (
          <>
            <ul className="text-sm max-h-32 overflow-y-auto" style={{ color: 'var(--text-muted)' }}>
              {posts.map((p) => <li key={p.id}>{p.titulo || 'Post sem título'}</li>)}
            </ul>
            <div role="radiogroup" aria-label="Como desmembrar" className="flex flex-col gap-2">
              <label className="flex items-start gap-2 text-sm">
                <input type="radio" name="detach-mode" aria-label="Manter etapas" checked={mode === 'manter'} disabled={!keepAvailable} onChange={() => setMode('manter')} />
                <span><strong>Manter etapas</strong> (recomendado): o post segue as mesmas etapas, com responsável e prazo próprios, como card individual no quadro.</span>
              </label>
              {!keepAvailable && (
                <p className="text-xs" style={{ color: 'var(--text-muted)', marginLeft: '1.5rem' }}>
                  {availability.reason ?? 'Indisponível.'} Um processo pode ser aplicado depois, no drawer do post.
                </p>
              )}
              <label className="flex items-start gap-2 text-sm">
                <input type="radio" name="detach-mode" aria-label="Transformar em avulso sem etapas" checked={mode === 'avulso'} onChange={() => setMode('avulso')} />
                <span><strong>Transformar em avulso sem etapas</strong>: o post continua em Publicações e no portal do cliente, só com status.</span>
              </label>
            </div>
          </>
        )}
        {archiveRow}
        <AlertDialogFooter>
          <AlertDialogCancel onClick={onClose} disabled={busy}>Cancelar</AlertDialogCancel>
          <AlertDialogAction onClick={confirm} disabled={busy}>{busy ? 'Desmembrando...' : 'Desmembrar'}</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
```

- [ ] **Step 5: `WorkflowDrawer.tsx`**

- Delete `getDetachErrorToast` (lines 134-143); its only message ('Um ou mais posts não foram encontrados.') is in Task 1's table.
- Props (line 147): add `onDetachedKeepingProcess?: (postIds: number[]) => void;` with doc: "Desmembrar mantendo etapas: a página revela o card no quadro (spec §4.1). Sem o callback (EntregasTab), só refresh."
- Read the flag once: `const { features } = useWorkspaceLimits(); const keepStepsEnabled = features?.feature_post_processes === true;` (the drawer already imports the hook or did until Task 3; re-add the import if removed).
- Replace `handleConfirmDetach` (619-650) with two callbacks used by the dialog:

```ts
  const afterDetach = (n: number, archived: boolean) => {
    toast.success(`${n} post${n === 1 ? '' : 's'} desmembrado${n === 1 ? '' : 's'}`);
    setSelectedPostIds(new Set());
    setDetachTarget(null);
    if (archived) { onRefresh(); onClose(); } else { refresh(); onRefresh(); }
  };
  const handleDetachedWithoutProcess = (result: DetachPostsResult, archived: boolean) => afterDetach(result.detached, archived);
  const handleDetachedKeepingProcess = (result: DetachKeepingProcessResult, archived: boolean) => {
    const ids = result.processes.map((p) => p.post_id);
    afterDetach(result.detached, archived);
    onDetachedKeepingProcess?.(ids);
  };
```

- Replace the inline `AlertDialog` (1125-1170) with:

```tsx
      {detachTarget && (
        <DetachPostsDialog
          open
          onClose={() => setDetachTarget(null)}
          card={card}
          posts={detachTarget.map((id) => ({ id, titulo: posts.find((p) => p.id === id)?.titulo ?? null }))}
          isTotalSelection={isTotalDetachSelection}
          keepStepsEnabled={keepStepsEnabled}
          onDetachedWithoutProcess={handleDetachedWithoutProcess}
          onDetachedKeepingProcess={handleDetachedKeepingProcess}
        />
      )}
```

Remove the now-unused `archiveEmptyFlow`/`isDetaching` state, `openDetachConfirm` keeps setting `detachTarget`. Update `WorkflowDrawer.test.tsx` detach cases: the copy is unchanged on the flag-off branch; the confirm button label stays "Desmembrar".

- [ ] **Step 6: `EntregasPage.tsx` reveal**

```ts
  const [pendingReveal, setPendingReveal] = useState<{ postIds: number[]; openDrawer: boolean } | null>(null);
  // Spec §4.1: desmembrar mantendo etapas / aplicar processo abrem Fluxos em
  // Kanban, selecionam Todos e revelam o card, removendo só os filtros que o
  // esconderiam, com aviso. Um post abre o drawer; vários só revelam.
  const revealPostProcesses = useCallback((postIds: number[]) => {
    setDrawerCard(null);
    setDrawerInitialPostId(null);
    setActiveView('kanban');
    setMode('entregas');
    setEntidade('todos');
    refresh();
    setPendingReveal({ postIds, openDrawer: postIds.length === 1 });
  }, [refresh]);

  // O refetch disparado por refresh() pode ainda não ter virado isFetching na
  // primeira renderização após o clique: só desistir depois de ter VISTO o
  // fetch acontecer uma vez desde o início da revelação.
  const sawFetchingRef = useRef(false);
  useEffect(() => {
    if (!pendingReveal) { sawFetchingRef.current = false; return; }
    if (isFetching) sawFetchingRef.current = true;
    const found = postEntities.filter((e) => pendingReveal.postIds.includes(e.process.post_id));
    if (found.length < pendingReveal.postIds.length) {
      if (isLoading || isFetching || !sawFetchingRef.current) return;
      toast.error('O post não apareceu no quadro. Recarregue a página.');
      setPendingReveal(null);
      return;
    }
    const { filters: next, cleared } = filtersToReveal(found, filters);
    if (cleared.length) {
      setFilters(next);
      toast.info('Filtros removidos para mostrar o post no quadro.');
    }
    if (pendingReveal.openDrawer) setStandalonePostId(pendingReveal.postIds[0]);
    setPendingReveal(null);
  }, [pendingReveal, postEntities, isLoading, isFetching, filters]);
```

(`useRef` from react.) Pass `onDetachedKeepingProcess={revealPostProcesses}` to the `WorkflowDrawer` mount (line ~1160). `postEntities` here is the hook's UNFILTERED list.

- [ ] **Step 7: Run + typecheck + commit**

Run: `npx vitest run apps/crm/src/pages/entregas apps/crm/src/pages/cliente-detalhe && npx tsc -p apps/crm/tsconfig.json --noEmit`
Expected: PASS.

```bash
git add apps/crm/src/pages/entregas
git commit -m "feat(entregas): desmembrar do fluxo mantendo etapas, com revelação do card no quadro"
```

---

### Task 12: "Aplicar processo" dialog (`apply_post_process`) in the drawer and in Sem processo

**Files:**
- Create: `apps/crm/src/pages/entregas/components/ApplyProcessDialog.tsx`
- Modify: `apps/crm/src/pages/entregas/components/StandalonePostDrawer.tsx` (button + dialog + `onProcessApplied` prop)
- Modify: `apps/crm/src/pages/entregas/components/SemProcessoSection.tsx` (per-card "Aplicar processo" button, `onApplyProcess` prop)
- Modify: `apps/crm/src/pages/entregas/EntregasPage.tsx` (`applyTarget` state; mount dialog for Sem processo; pass `onProcessApplied`)
- Test: `apps/crm/src/pages/entregas/components/__tests__/ApplyProcessDialog.test.tsx` (create)
- Test: `apps/crm/src/pages/entregas/components/__tests__/SemProcessoSection.test.tsx`, `StandalonePostDrawer.test.tsx` (extend)

**Interfaces:**
- Consumes: `getWorkflowTemplates`, `applyPostProcess`, `getClientes` (store), `buildTemplateFingerprint` (`fingerprint.ts`), `buildApplyPlan` (Task 6), `getNextDeliveryDate` (`hooks/useEntregasData.ts:150`), `formatEtapaDeadlineDay` (`etapaPrazo.ts`), `getPostProcessErrorToast`/`isStaleStateError` (Task 1).
- Produces:

```ts
export interface ApplyProcessDialogProps {
  open: boolean;
  onClose: () => void;
  post: { id: number; titulo: string | null; cliente_id: number | null };
  membros: Membro[];
  onApplied: (result: ApplyPostProcessResult) => void;
}
```

  Template `<Select aria-label="Modelo de processo">` (templates from `['workflow-templates']`, empty ones disabled with "(sem etapas)"), etapa inicial `<Select aria-label="Etapa inicial">` (default first), per-step responsável `<Select aria-label="Responsável da etapa <nome>">`, per-step `<input type="date" aria-label="Data da etapa <nome>">` (data_fixa only), `<input type="month" aria-label="Mês de entrega">` (data_entrega only; default = month of `getNextDeliveryDate(cliente.dia_entrega)`), a preview list (ordem, nome, estado label, responsável, prazo via `formatEtapaDeadlineDay`), and a confirm button disabled while `plan.blockers.length > 0` with the first blocker rendered under it. Confirm calls `applyPostProcess({ postId, templateId, templateFingerprint: buildTemplateFingerprint(template.etapas), startOrdem, stepOverrides: plan.overrides })`.
- `StandalonePostDrawerProps` gains `onProcessApplied?: (postId: number) => void`; the header shows `Aplicar processo` (`aria-label`) only when `!postProcess && postProcessesEnabled`.
- `SemProcessoSectionProps` gains `onApplyProcess: (post: ActivePost) => void`; each card gets a button "Aplicar processo" (`e.stopPropagation()`).

- [ ] **Step 1: Write the failing tests**

```tsx
// apps/crm/src/pages/entregas/components/__tests__/ApplyProcessDialog.test.tsx
import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const store = vi.hoisted(() => ({ getWorkflowTemplates: vi.fn(), getClientes: vi.fn(), applyPostProcess: vi.fn() }));
vi.mock('../../../../store', () => store);
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() }));
vi.mock('sonner', () => ({ toast }));

import { ApplyProcessDialog } from '../ApplyProcessDialog';

const padrao = { id: 3, nome: 'Redes', modo_prazo: 'padrao', etapas: [
  { nome: 'Copy', prazo_dias: 2, tipo_prazo: 'corridos', tipo: 'padrao', responsavel_id: 9 },
  { nome: 'Design', prazo_dias: 3, tipo_prazo: 'uteis', tipo: 'padrao' },
  { nome: 'Aprovação', prazo_dias: 1, tipo_prazo: 'corridos', tipo: 'aprovacao_cliente' },
] };
const entrega = { id: 4, nome: 'Mensal', modo_prazo: 'data_entrega', etapas: padrao.etapas };
const semAprovacao = { id: 5, nome: 'Curto', modo_prazo: 'data_entrega', etapas: padrao.etapas.slice(0, 2) };
const vazio = { id: 6, nome: 'Vazio', modo_prazo: 'padrao', etapas: [] };

function renderDialog(over = {}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const onApplied = vi.fn();
  const onClose = vi.fn();
  render(<QueryClientProvider client={qc}><ApplyProcessDialog open onClose={onClose} post={{ id: 77, titulo: 'Post X', cliente_id: 4 }} membros={[{ id: 9, nome: 'Ana' }, { id: 4, nome: 'Bia' }] as never} onApplied={onApplied} {...over} /></QueryClientProvider>);
  return { onApplied, onClose };
}

beforeEach(() => {
  vi.clearAllMocks();
  store.getWorkflowTemplates.mockResolvedValue([padrao, entrega, semAprovacao, vazio]);
  store.getClientes.mockResolvedValue([{ id: 4, nome: 'Aurora', dia_entrega: 10 }]);
  store.applyPostProcess.mockResolvedValue({ ok: true, process_id: 5, post_id: 77, revisao: 1, steps: [] });
});

describe('ApplyProcessDialog', () => {
  it('modelo padrão: preview com etapas, responsável do template, prazo só na inicial; confirma com fingerprint e overrides', async () => {
    const { onApplied } = renderDialog();
    fireEvent.click(await screen.findByRole('combobox', { name: 'Modelo de processo' }));
    fireEvent.click(await screen.findByRole('option', { name: 'Redes' }));
    expect(await screen.findByText('Copy')).toBeInTheDocument();
    expect(screen.getByText('Ana')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Aplicar processo' }));
    await waitFor(() => expect(store.applyPostProcess).toHaveBeenCalledTimes(1));
    const args = store.applyPostProcess.mock.calls[0][0];
    expect(args).toMatchObject({ postId: 77, templateId: 3, startOrdem: 0 });
    expect(args.templateFingerprint).toBe('0|Copy|padrao|2|corridos\n1|Design|padrao|3|uteis\n2|Aprovação|aprovacao_cliente|1|corridos');
    expect(args.stepOverrides['0'].responsavel_id).toBe(9);
    expect(typeof args.stepOverrides['0'].prazo_efetivo).toBe('string');
    expect(args.stepOverrides['1'].prazo_efetivo).toBeNull();
    expect(onApplied).toHaveBeenCalledWith(expect.objectContaining({ process_id: 5 }));
    expect(toast.success).toHaveBeenCalledWith('Processo aplicado.');
  });
  it('etapa inicial no meio: anteriores marcadas como ignoradas e fora dos overrides', async () => {
    renderDialog();
    fireEvent.click(await screen.findByRole('combobox', { name: 'Modelo de processo' }));
    fireEvent.click(await screen.findByRole('option', { name: 'Redes' }));
    fireEvent.click(await screen.findByRole('combobox', { name: 'Etapa inicial' }));
    fireEvent.click(await screen.findByRole('option', { name: 'Design' }));
    expect(screen.getByText('Ignorada')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Aplicar processo' }));
    await waitFor(() => expect(store.applyPostProcess).toHaveBeenCalled());
    expect(Object.keys(store.applyPostProcess.mock.calls[0][0].stepOverrides)).toEqual(['1', '2']);
  });
  it('data_entrega: mês pré-preenchido com a próxima entrega do cliente; sem aprovação a partir da inicial desabilita com o motivo', async () => {
    renderDialog();
    fireEvent.click(await screen.findByRole('combobox', { name: 'Modelo de processo' }));
    fireEvent.click(await screen.findByRole('option', { name: 'Curto' }));
    expect(await screen.findByLabelText('Mês de entrega')).toHaveValue(expect.stringMatching(/^\d{4}-\d{2}$/));
    expect(screen.getByRole('button', { name: 'Aplicar processo' })).toBeDisabled();
    expect(screen.getByText('O modelo precisa de uma etapa de aprovação do cliente a partir da etapa inicial.')).toBeInTheDocument();
  });
  it('template vazio aparece desabilitado', async () => {
    renderDialog();
    fireEvent.click(await screen.findByRole('combobox', { name: 'Modelo de processo' }));
    expect(await screen.findByRole('option', { name: /Vazio/ })).toHaveAttribute('aria-disabled', 'true');
  });
  it('template_changed: toast mapeado, templates recarregados, nada aplicado', async () => {
    store.applyPostProcess.mockRejectedValueOnce({ message: 'template_changed', code: 'P0001' });
    const { onApplied } = renderDialog();
    fireEvent.click(await screen.findByRole('combobox', { name: 'Modelo de processo' }));
    fireEvent.click(await screen.findByRole('option', { name: 'Redes' }));
    fireEvent.click(screen.getByRole('button', { name: 'Aplicar processo' }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('O modelo foi alterado depois que você abriu este diálogo. Recarregue e tente de novo.'));
    await waitFor(() => expect(store.getWorkflowTemplates).toHaveBeenCalledTimes(2));
    expect(onApplied).not.toHaveBeenCalled();
  });
});
```

Extend `SemProcessoSection.test.tsx`:

```tsx
  it('cada card tem "Aplicar processo" que não abre o post', () => {
    const onPostClick = vi.fn();
    const onApplyProcess = vi.fn();
    renderSection({ posts: [post], total: 1, onPostClick, onApplyProcess });
    fireEvent.click(screen.getByRole('button', { name: 'Aplicar processo' }));
    expect(onApplyProcess).toHaveBeenCalledWith(post);
    expect(onPostClick).not.toHaveBeenCalled();
  });
```

Extend `StandalonePostDrawer.test.tsx`:

```tsx
  it('sem processo + flag ligada: "Aplicar processo" no cabeçalho; flag desligada: ausente', async () => {
    limitsMock.features = { feature_post_processes: true };
    (getVigentePostProcess as any).mockResolvedValueOnce(null);
    const { unmount } = renderDrawer();
    await screen.findByRole('button', { name: 'Aplicar processo' });
    unmount();
    limitsMock.features = { feature_post_processes: false };
    (getVigentePostProcess as any).mockResolvedValueOnce(null);
    renderDrawer();
    await screen.findByText('Avulso');
    expect(screen.queryByRole('button', { name: 'Aplicar processo' })).toBeNull();
  });
```

- [ ] **Step 2: Run to verify failures**

Run: `npx vitest run apps/crm/src/pages/entregas/components/__tests__/ApplyProcessDialog.test.tsx apps/crm/src/pages/entregas/components/__tests__/SemProcessoSection.test.tsx apps/crm/src/pages/entregas/components/__tests__/StandalonePostDrawer.test.tsx`
Expected: FAIL.

- [ ] **Step 3: `ApplyProcessDialog.tsx`**

```tsx
// apps/crm/src/pages/entregas/components/ApplyProcessDialog.tsx
import { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  applyPostProcess, getClientes, getWorkflowTemplates,
  type ApplyPostProcessResult, type Membro,
} from '../../../store';
import { buildTemplateFingerprint } from '../fingerprint';
import { buildApplyPlan } from '../applyProcessDeadlines';
import { getNextDeliveryDate } from '../hooks/useEntregasData';
import { formatEtapaDeadlineDay } from '../etapaPrazo';
import { getPostProcessErrorToast, isStaleStateError } from '../postProcessErrors';

export interface ApplyProcessDialogProps {
  open: boolean;
  onClose: () => void;
  post: { id: number; titulo: string | null; cliente_id: number | null };
  membros: Membro[];
  onApplied: (result: ApplyPostProcessResult) => void;
}

const ESTADO_LABEL = { ignorado: 'Ignorada', ativo: 'Inicial', pendente: 'Pendente' } as const;
const monthKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;

/**
 * Aplicar um template de processo a um avulso (spec §5.2, §7). A sequência
 * vem do template; o diálogo só escolhe template, etapa inicial, responsáveis
 * e prazos, e mostra o resultado antes de confirmar. Confirmar fica
 * desabilitado com o motivo enquanto buildApplyPlan devolver bloqueios.
 */
export function ApplyProcessDialog({ open, onClose, post, membros, onApplied }: ApplyProcessDialogProps) {
  const qc = useQueryClient();
  const { data: templates = [] } = useQuery({ queryKey: ['workflow-templates'], queryFn: getWorkflowTemplates, enabled: open });
  const { data: clientes = [] } = useQuery({ queryKey: ['clientes'], queryFn: getClientes, enabled: open });
  const cliente = clientes.find((c) => c.id === post.cliente_id);
  const [templateId, setTemplateId] = useState<number | null>(null);
  const [startOrdem, setStartOrdem] = useState(0);
  const [responsaveis, setResponsaveis] = useState<Record<number, number | null | undefined>>({});
  const [fixedDates, setFixedDates] = useState<Record<number, string | undefined>>({});
  const [month, setMonth] = useState<string>('');
  const [busy, setBusy] = useState(false);
  const template = templates.find((t) => t.id === templateId) ?? null;

  useEffect(() => {
    if (!open) return;
    setTemplateId(null); setStartOrdem(0); setResponsaveis({}); setFixedDates({});
    setMonth(cliente?.dia_entrega ? monthKey(getNextDeliveryDate(cliente.dia_entrega)) : '');
  }, [open, cliente?.dia_entrega]);
  useEffect(() => { setStartOrdem(0); setResponsaveis({}); setFixedDates({}); }, [templateId]);

  const deliveryDate = useMemo(() => {
    if (!cliente?.dia_entrega || !/^\d{4}-\d{2}$/.test(month)) return null;
    const [y, m] = month.split('-').map(Number);
    const days = new Date(y, m, 0).getDate();
    return new Date(y, m - 1, Math.min(cliente.dia_entrega, days));
  }, [cliente?.dia_entrega, month]);

  const plan = useMemo(
    () => (template ? buildApplyPlan({ template, startOrdem, now: new Date(), fixedDates, deliveryDate, clienteHasDiaEntrega: !!cliente?.dia_entrega, responsaveis }) : null),
    [template, startOrdem, fixedDates, deliveryDate, cliente?.dia_entrega, responsaveis],
  );
  const blocker = !template ? 'Escolha um modelo.' : plan?.blockers[0];

  const confirm = async () => {
    if (!template || !plan || blocker) return;
    setBusy(true);
    try {
      const result = await applyPostProcess({
        postId: post.id,
        templateId: template.id!,
        templateFingerprint: buildTemplateFingerprint(template.etapas),
        startOrdem,
        stepOverrides: plan.overrides,
      });
      toast.success('Processo aplicado.');
      for (const key of [['post-processes'], ['post-process', post.id], ['post-process-events'], ['active-posts'], ['standalone-post', post.id]])
        qc.invalidateQueries({ queryKey: key });
      onApplied(result);
      onClose();
    } catch (err) {
      toast.error(getPostProcessErrorToast(err, 'Erro ao aplicar processo'));
      if (isStaleStateError(err)) {
        qc.invalidateQueries({ queryKey: ['workflow-templates'] });
        qc.invalidateQueries({ queryKey: ['post-process', post.id] });
        qc.invalidateQueries({ queryKey: ['post-processes'] });
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-[520px]">
        <DialogHeader>
          <DialogTitle>Aplicar processo</DialogTitle>
          <DialogDescription>"{post.titulo || 'Post sem título'}" passa a ter etapas, responsáveis e prazos próprios. Status, conteúdo e aprovações não mudam.</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <Select value={templateId != null ? String(templateId) : ''} onValueChange={(v) => setTemplateId(Number(v))}>
            <SelectTrigger aria-label="Modelo de processo"><SelectValue placeholder="Escolha um modelo" /></SelectTrigger>
            <SelectContent>
              {templates.map((t) => (
                <SelectItem key={t.id} value={String(t.id)} disabled={!Array.isArray(t.etapas) || t.etapas.length === 0}>
                  {t.nome}{(!Array.isArray(t.etapas) || t.etapas.length === 0) ? ' (sem etapas)' : ''}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {template && plan && (
            <>
              <Select value={String(startOrdem)} onValueChange={(v) => setStartOrdem(Number(v))}>
                <SelectTrigger aria-label="Etapa inicial"><SelectValue /></SelectTrigger>
                <SelectContent>{template.etapas.map((e, i) => <SelectItem key={i} value={String(i)}>{e.nome}</SelectItem>)}</SelectContent>
              </Select>
              {plan.modo === 'data_entrega' && (
                <label className="text-sm flex flex-col gap-1">
                  Mês de entrega{cliente?.dia_entrega ? ` (dia ${cliente.dia_entrega})` : ''}
                  <input type="month" aria-label="Mês de entrega" value={month} onChange={(e) => setMonth(e.target.value)} className="h-8 rounded-md border border-input px-2" />
                </label>
              )}
              <ul className="history-timeline text-sm">
                {plan.steps.map((s) => (
                  <li key={s.ordem} className="flex flex-col gap-1 py-1">
                    <span><strong>{s.nome}</strong> · {ESTADO_LABEL[s.estado]}{s.tipo === 'aprovacao_cliente' ? ' · Aprovação do cliente' : ''}</span>
                    {s.estado !== 'ignorado' && (
                      <span className="flex flex-wrap gap-2 items-center">
                        <Select value={s.responsavelId != null ? String(s.responsavelId) : 'none'} onValueChange={(v) => setResponsaveis((r) => ({ ...r, [s.ordem]: v === 'none' ? null : Number(v) }))}>
                          <SelectTrigger aria-label={`Responsável da etapa ${s.nome}`} className="h-7 w-44 text-xs"><SelectValue placeholder="Sem responsável" /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="none">Sem responsável</SelectItem>
                            {membros.map((m) => <SelectItem key={m.id} value={String(m.id)}>{m.nome}</SelectItem>)}
                          </SelectContent>
                        </Select>
                        {plan.modo === 'data_fixa' ? (
                          <input type="date" aria-label={`Data da etapa ${s.nome}`} value={fixedDates[s.ordem] ?? ''} onChange={(e) => setFixedDates((d) => ({ ...d, [s.ordem]: e.target.value || undefined }))} className="h-7 rounded-md border border-input px-2 text-xs" />
                        ) : (
                          <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
                            {s.prazoEfetivo ? formatEtapaDeadlineDay(new Date(s.prazoEfetivo)) : 'Prazo definido ao ativar'}
                          </span>
                        )}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </>
          )}
          {blocker && <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{blocker}</p>}
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose} disabled={busy}>Cancelar</Button>
          <Button type="button" onClick={confirm} disabled={busy || !!blocker}>{busy ? 'Aplicando...' : 'Aplicar processo'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

(The preview list renders the responsável NAME for the Select value via `SelectValue`; the first test asserts "Ana" is visible: if Radix renders the selected label only after mount, assert via `screen.getByRole('combobox', { name: 'Responsável da etapa Copy' })` text content instead.)

- [ ] **Step 4: Wire the drawer and Sem processo**

`StandalonePostDrawer.tsx`: prop `onProcessApplied?: (postId: number) => void;`, state `const [applyOpen, setApplyOpen] = useState(false);`; header (only when `post && !postProcess && postProcessesEnabled`):

```tsx
                <button className="drawer-add-post-btn" aria-label="Aplicar processo" onClick={() => setApplyOpen(true)}>
                  <Route className="h-3.5 w-3.5" /> Aplicar processo
                </button>
```

Mount: `{post && <ApplyProcessDialog open={applyOpen} onClose={() => setApplyOpen(false)} post={{ id: postId, titulo: post.titulo, cliente_id: post.cliente_id }} membros={membros} onApplied={() => { refresh(); onRefresh(); onProcessApplied?.(postId); }} />}`.

`SemProcessoSection.tsx`: prop `onApplyProcess: (post: ActivePost) => void;` and inside each card, after the cliente meta line:

```tsx
            <button type="button" className="sem-processo-link" aria-label="Aplicar processo" onClick={(e) => { e.stopPropagation(); onApplyProcess(post); }}>
              Aplicar processo
            </button>
```

Update the doc comment ("Fase 4: ação Aplicar processo por card").

`EntregasPage.tsx`: `const [applyTarget, setApplyTarget] = useState<ActivePost | null>(null);`; `<SemProcessoSection ... onApplyProcess={setApplyTarget} />`; mount next to the drawers:

```tsx
      {applyTarget && (
        <ApplyProcessDialog
          open
          onClose={() => setApplyTarget(null)}
          post={{ id: applyTarget.id, titulo: applyTarget.titulo, cliente_id: applyTarget.cliente_id }}
          membros={membros}
          onApplied={(r) => { setApplyTarget(null); revealPostProcesses([r.post_id]); }}
        />
      )}
```

and `<StandalonePostDrawer ... onProcessApplied={(id) => revealPostProcesses([id])} />`.

- [ ] **Step 5: Run + typecheck + commit**

Run: `npx vitest run apps/crm/src/pages/entregas && npx tsc -p apps/crm/tsconfig.json --noEmit`
Expected: PASS (update `SemProcessoSection.test.tsx`'s render helper to pass `onApplyProcess`).

```bash
git add apps/crm/src/pages/entregas
git commit -m "feat(entregas): aplicar processo a um post avulso pelo drawer e pela seção Sem processo"
```

---

### Task 13: "Vincular a um fluxo" closes the individual process (`attach_post_closing_process`)

**Files:**
- Modify: `apps/crm/src/pages/entregas/components/AttachToFluxoDialog.tsx:14-52, 55-110, 112-155`
- Modify: `apps/crm/src/pages/entregas/components/StandalonePostDrawer.tsx:562-570` (pass `process`)
- Test: `apps/crm/src/pages/entregas/components/__tests__/AttachToFluxoDialog.test.tsx` (extend)

**Interfaces:**
- Consumes: `attachPostClosingProcess` (Task 2), `attachPostToWorkflow` (existing), `getPostProcessErrorToast` (Task 1).
- Produces: `AttachToFluxoDialogProps.process?: PostProcess | null`. With a vigente process (`estado ∈ {ativo, concluido}`), clicking "Vincular" shows a confirmation step (title "Encerrar o processo individual?"; copy: `O post passará a seguir as etapas de "<fluxo>". O processo individual será encerrado: etapas, responsáveis e prazos individuais não são transferidos. O histórico fica guardado.`; buttons "Voltar" / "Encerrar processo e vincular"). Confirming calls `attachPostClosingProcess(postId, workflowId, process.revisao)`. Without a process, the legacy path is untouched. `getAttachErrorToast` keeps its three legacy strings and falls back to `getPostProcessErrorToast(err, 'Erro ao vincular post ao fluxo')` — which covers `post_has_active_process`, `process_changed`, `process_already_closed`, `process_not_found`, `post_already_in_flow`. Success invalidates the fase-3 keys too: `['post-process', postId]`, `['post-processes']`, `['post-process-events']`, `['standalone-post', postId]`.

- [ ] **Step 1: Write the failing tests**

Append to `AttachToFluxoDialog.test.tsx` (add `attachPostClosingProcessMock` to the hoisted mocks and to the `@/store` mock):

```tsx
  it('com processo vigente: passo de confirmação e RPC de encerrar+vincular com a revisão', async () => {
    attachPostClosingProcessMock.mockResolvedValue({ ok: true, process_id: 5, post_id: 5, workflow_id: 1, revisao: 4 });
    const { onAttached, invalidateSpy } = renderDialog({ process: { id: 5, estado: 'ativo', revisao: 3, template_nome: 'Redes' } });
    fireEvent.click(await screen.findByLabelText('Fluxo Ativo A'));
    fireEvent.click(screen.getByRole('button', { name: 'Vincular' }));
    expect(await screen.findByText('Encerrar o processo individual?')).toBeInTheDocument();
    expect(attachPostToWorkflowMock).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Encerrar processo e vincular' }));
    await waitFor(() => expect(attachPostClosingProcessMock).toHaveBeenCalledWith(5, 1, 3));
    expect(attachPostToWorkflowMock).not.toHaveBeenCalled();
    expect(onAttached).toHaveBeenCalledWith(1, 5);
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['post-process', 5] });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['post-processes'] });
  });
  it('"Voltar" no passo de confirmação retorna à lista sem chamar nada', async () => {
    renderDialog({ process: { id: 5, estado: 'concluido', revisao: 1 } });
    fireEvent.click(await screen.findByLabelText('Fluxo Ativo A'));
    fireEvent.click(screen.getByRole('button', { name: 'Vincular' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Voltar' }));
    expect(screen.getByLabelText('Fluxo Ativo A')).toBeInTheDocument();
    expect(attachPostClosingProcessMock).not.toHaveBeenCalled();
  });
  it('sem processo: caminho antigo inalterado', async () => {
    attachPostToWorkflowMock.mockResolvedValue({ ok: true, attached: 1 });
    renderDialog({ process: null });
    fireEvent.click(await screen.findByLabelText('Fluxo Ativo A'));
    fireEvent.click(screen.getByRole('button', { name: 'Vincular' }));
    await waitFor(() => expect(attachPostToWorkflowMock).toHaveBeenCalledWith(5, 1));
    expect(screen.queryByText('Encerrar o processo individual?')).toBeNull();
  });
  it('post_has_active_process (cliente antigo / cache velha) e process_changed têm cópia própria', async () => {
    attachPostToWorkflowMock.mockRejectedValueOnce({ message: 'post_has_active_process' });
    renderDialog({ process: null });
    fireEvent.click(await screen.findByLabelText('Fluxo Ativo A'));
    fireEvent.click(screen.getByRole('button', { name: 'Vincular' }));
    await waitFor(() => expect(toastErrorMock).toHaveBeenCalledWith('Este post tem um processo individual em andamento. Use "Vincular a um fluxo" para encerrá-lo e vincular.'));
    attachPostClosingProcessMock.mockRejectedValueOnce({ message: 'process_changed' });
    cleanup(); renderDialog({ process: { id: 5, estado: 'ativo', revisao: 3 } });
    fireEvent.click(await screen.findByLabelText('Fluxo Ativo A'));
    fireEvent.click(screen.getByRole('button', { name: 'Vincular' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Encerrar processo e vincular' }));
    await waitFor(() => expect(toastErrorMock).toHaveBeenCalledWith('Este processo foi alterado em outro lugar. Recarregue e tente de novo.'));
  });
```

(The existing cases pass no `process`, so they keep exercising the legacy path unchanged. If radio inputs have no accessible name, select them via `screen.getByText('Fluxo Ativo A').closest('label')`.)

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run apps/crm/src/pages/entregas/components/__tests__/AttachToFluxoDialog.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implement**

- Props: `process?: PostProcess | null;` (doc: "Processo individual vigente do post, quando existe: exige o passo de confirmação e usa attach_post_closing_process (spec §5.5, §9.3)").
- State: `const [confirming, setConfirming] = useState(false);` reset with `selectedId` when `open` changes.
- `getAttachErrorToast`: keep the three legacy `if`s and replace the final `return 'Erro ao vincular post ao fluxo';` with `return getPostProcessErrorToast(err, 'Erro ao vincular post ao fluxo');`.
- `handleConfirm`: `if (process && (process.estado === 'ativo' || process.estado === 'concluido') && !confirming) { setConfirming(true); return; }` at the top; then `await (process && confirming ? attachPostClosingProcess(postId, selectedId, process.revisao) : attachPostToWorkflow(postId, selectedId));` and add to the invalidation list: `['post-process', postId]`, `['post-processes']`, `['post-process-events']`, `['standalone-post', postId]`.
- Render: when `confirming`, replace the list with:

```tsx
          <div className="flex flex-col gap-2 text-sm">
            <p className="font-medium">Encerrar o processo individual?</p>
            <p style={{ color: 'var(--text-muted)' }}>
              O post passará a seguir as etapas de "{activeFluxos.find((w) => w.id === selectedId)?.titulo}". O processo individual será encerrado: etapas, responsáveis e prazos individuais não são transferidos. O histórico fica guardado.
            </p>
          </div>
```

and the footer becomes `Voltar` (`onClick={() => setConfirming(false)}`) + `Encerrar processo e vincular` (`onClick={handleConfirm}`). `DialogTitle` stays "Vincular a um fluxo".

- `StandalonePostDrawer.tsx:562-570`: `process={postProcess}`.

- [ ] **Step 4: Run + commit**

Run: `npx vitest run apps/crm/src/pages/entregas/components && npx tsc -p apps/crm/tsconfig.json --noEmit`
Expected: PASS.

```bash
git add apps/crm/src/pages/entregas/components
git commit -m "feat(entregas): vincular a um fluxo encerra o processo individual com confirmação"
```

---

### Task 14: RPC-contract verification against a real local Supabase (env-gated Vitest)

**Files:**
- Create: `apps/crm/src/store/__tests__/postProcesses.contract.test.ts`
- Scratch only (never committed): `supabase/config.toml` port overrides; `<scratchpad>/local.env`

**Interfaces:**
- Consumes: the seven wrappers (Task 2), `POST_PROCESS_ERROR_MESSAGES` (Task 1), `@supabase/supabase-js` `createClient`.
- Produces: a suite that is **skipped** unless `POST_PROCESS_CONTRACT_URL` and `POST_PROCESS_CONTRACT_SERVICE_KEY` are set, and that, when run, proves each wrapper's parameter names resolve to the deployed function signature. Discriminator: PostgREST answers `PGRST202` ("Could not find the function public.x(p_a, p_b) in the schema cache") when a parameter name does not match; a resolved call reaches the function body and fails with a `P0001` identifier (`workspace_not_found`, or `request_id_required`/`invalid_arguments` for argument pre-checks) because the service role has no `auth.uid()`. No seeded auth is needed.

- [ ] **Step 1: Write the test**

```ts
// apps/crm/src/store/__tests__/postProcesses.contract.test.ts
/**
 * Contrato ao vivo dos sete invólucros de RPC contra um Supabase LOCAL
 * (supabase start + db reset). Pulado sem as duas variáveis abaixo. Prova que
 * os nomes de parâmetro que o CRM manda batem com as funções implantadas:
 * parâmetro errado = PGRST202; parâmetro certo = P0001 com um identificador
 * da tabela de erros (service_role não tem auth.uid(), então
 * post_process_require_editor responde workspace_not_found antes de qualquer
 * escrita). Nunca aponte para staging/prod: a chave é a service_role local.
 */
import { describe, expect, it, vi } from 'vitest';
import { createClient } from '@supabase/supabase-js';

const env = vi.hoisted(() => ({
  url: process.env.POST_PROCESS_CONTRACT_URL,
  key: process.env.POST_PROCESS_CONTRACT_SERVICE_KEY,
}));

vi.mock('../core', async () => {
  if (!env.url || !env.key) return { supabase: {} };
  const { createClient } = await import('@supabase/supabase-js');
  return { supabase: createClient(env.url, env.key), getContaId: vi.fn(), getUserId: vi.fn(), getCurrentProfile: vi.fn(), clearProfileCache: vi.fn() };
});

import {
  applyPostProcess, attachPostClosingProcess, detachPostsKeepingProcess, removePostProcess,
  reorderFluxosBoard, transitionPostProcess, updatePostProcessStep,
} from '../postProcesses';
import { POST_PROCESS_ERROR_MESSAGES } from '../../pages/entregas/postProcessErrors';

const enabled = !!env.url && !!env.key && /^https?:\/\/(127\.0\.0\.1|localhost)/.test(env.url);

describe.skipIf(!enabled)('post process RPC contract (local Supabase)', () => {
  const expectIdentifier = async (p: Promise<unknown>) => {
    let err: { code?: string; message?: string } | null = null;
    try { await p; } catch (e) { err = e as { code?: string; message?: string }; }
    expect(err, 'a RPC tem de falhar (sem auth.uid())').not.toBeNull();
    expect(err!.code, err!.message).toBe('P0001');
    expect(Object.keys(POST_PROCESS_ERROR_MESSAGES)).toContain(err!.message);
  };

  it('createClient sanity', () => {
    expect(createClient).toBeTypeOf('function');
  });
  it('detach_posts_keeping_process', () => expectIdentifier(detachPostsKeepingProcess({
    postIds: [1], workflowId: 1, fingerprint: 'etapa_atual=0', activeDeadline: new Date().toISOString(),
    requestId: '11111111-2222-4333-8444-555555555555', stepDeadlines: { '1': new Date().toISOString() }, archiveEmptyFlow: false,
  })));
  it('apply_post_process', () => expectIdentifier(applyPostProcess({ postId: 1, templateId: 1, templateFingerprint: '0|Copy|padrao|2|corridos', startOrdem: 0, stepOverrides: { '0': { responsavel_id: null, prazo_efetivo: new Date().toISOString() } } })));
  it('transition_post_process', () => expectIdentifier(transitionPostProcess({ processId: 1, expectedRevisao: 1, command: 'avancar', approvalChoice: 'sem_alterar', expectedPostStatus: 'rascunho', nextDeadline: new Date().toISOString() })));
  it('update_post_process_step', () => expectIdentifier(updatePostProcessStep({ processId: 1, expectedRevisao: 1, ordem: 0, responsavelId: null, prazoEfetivo: null })));
  it('remove_post_process', () => expectIdentifier(removePostProcess(1, 1)));
  it('attach_post_closing_process', () => expectIdentifier(attachPostClosingProcess(1, 1, 1)));
  it('reorder_fluxos_board', () => expectIdentifier(reorderFluxosBoard({ workflowIds: [1], workflowPositions: [0], processIds: [1], processPositions: [1] })));
});
```

- [ ] **Step 2: Confirm it is skipped by default**

Run: `npx vitest run apps/crm/src/store/__tests__/postProcesses.contract.test.ts`
Expected: the suite reports as skipped (0 failures). This is how CI sees it.

- [ ] **Step 3: Bring up a fresh local stack (colima + port overrides; memory `reference_local_supabase_colima`)**

```bash
colima status || colima start --cpu 4 --memory 8
cp supabase/config.toml "$SCRATCH/config.toml.bak"          # $SCRATCH = the session scratchpad dir
cat >> supabase/config.toml <<'EOF'
[api]
port = 54421
[db]
port = 54422
[inbucket]
port = 54424
[studio]
port = 54425
EOF
npx supabase start
npx supabase db reset                                        # fresh: applies every migration incl. 20260919000003..8
npx supabase status -o env > "$SCRATCH/local.env"            # API_URL + SERVICE_ROLE_KEY, never printed, never committed
```

If another worktree already holds the default ports, the overrides above avoid the collision; do not stop the other stack.

- [ ] **Step 4: Run the contract suite and the SQL suites against it**

```bash
set -a; source "$SCRATCH/local.env"; set +a
POST_PROCESS_CONTRACT_URL="$API_URL" POST_PROCESS_CONTRACT_SERVICE_KEY="$SERVICE_ROLE_KEY" \
  npx vitest run apps/crm/src/store/__tests__/postProcesses.contract.test.ts
SUPABASE_DB_URL=postgresql://postgres:postgres@127.0.0.1:54422/postgres bash scripts/test-entitlements.sh
```

Expected: 8/8 contract cases PASS with `P0001` identifiers (a `PGRST202` on any wrapper is a parameter-name mismatch: fix the wrapper in `store/postProcesses.ts`, not the test); entitlement suites 83–92 PASS (run once per fresh `db reset`; repeated runs on the same DB produce spurious failures in unrelated suites, per memory `project_posts_individuais_fluxos`).

- [ ] **Step 5: Tear down and restore**

```bash
npx supabase stop --project-id "$(basename "$PWD")"
cp "$SCRATCH/config.toml.bak" supabase/config.toml
git diff --stat supabase/config.toml                          # must be empty
rm -f "$SCRATCH/local.env"
ls node_modules/.deno 2>/dev/null && npm ci                   # deno never ran here, but check anyway
```

- [ ] **Step 6: Commit the test only**

```bash
git status --porcelain supabase/config.toml                   # must print nothing
git add apps/crm/src/store/__tests__/postProcesses.contract.test.ts
git commit -m "test(entregas): contrato ao vivo dos invólucros das RPCs de processos individuais"
```

---

### Task 15: Staging validation — flag on for ONE workspace, §12 acceptance matrix (PO decision 4)

**Files:** none committed. Output = a filled-in checklist in the SDD ledger (`.superpowers/sdd/<this plan>/progress.md`, git-ignored) and, if anything fails, fix-cycle tasks. **Production is not touched.**

**Preconditions (do these first, in order):**

- [ ] **Step 1: Environment**

```bash
ls .env.staging || cp /Users/eduardosouza/Projects/sm-crm/.env.staging .env.staging   # gitignored
cat supabase/.temp/project-ref 2>/dev/null                                              # MUST print wlyzhyfondykzpsiqsce (staging)
```

If the ref is missing or is `skjzpekeqefvlojenfsw` (PROD), run `npx supabase link --project-ref wlyzhyfondykzpsiqsce` and re-check the file before ANY `--linked` command (memory `reference_supabase_project_refs`: the ambient link state has silently pointed at prod before).

- [ ] **Step 2: Confirm the fase-2 RPCs exist on staging (read-only)**

Write `$SCRATCH/check.sql`:

```sql
select p.proname, pg_get_function_identity_arguments(p.oid)
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public'
   and p.proname in ('detach_posts_keeping_process','apply_post_process','transition_post_process',
                     'update_post_process_step','remove_post_process','attach_post_closing_process','reorder_fluxos_board')
 order by 1;
```

Run: `npx supabase db query --linked --file "$SCRATCH/check.sql"` — expect 7 rows with the Task 2 signatures.

- [ ] **Step 3: Turn the flag on for the seed workspace only**

Start the Admin against staging (`npm run dev:admin:staging`, Vite binds 5177), log in with the seed technique (memory `reference_seed_login_browser_verification`: the session JSON is produced by a script under `node_modules/.cache/`, injected into `localStorage`, deleted afterwards; the password never enters the transcript). Open Workspaces → "seed" → plan overrides → set `feature_post_processes` on. Verify with `$SCRATCH/flag.sql`:

```sql
select w.id, w.name, effective_plan_feature(w.id, 'feature_post_processes') as on
  from workspaces w where w.name ilike 'seed%';
```

`npx supabase db query --linked --file "$SCRATCH/flag.sql"` → exactly one row, `on = true`. No other workspace changes.

- [ ] **Step 4: Run the CRM against staging and log in**

`npm run dev:staging` (port 5173), same seed login. Open `/entregas`. Confirm the `EntidadeToggle` shows (flag on), and that `post_processes` appears in the network tab with zero or more rows.

- [ ] **Step 5: Exercise each command once and tick the §12 criteria**

Use one client of the seed workspace with a fluxo of three posts in an intermediate etapa and one avulso post.

| Command | Steps | §12 criteria to confirm |
|---|---|---|
| Desmembrar mantendo etapas | Fluxo drawer → kebab of one post → "Desmembrar do fluxo" → "Manter etapas" pre-selected → Desmembrar. Board switches to Kanban/Todos, card appears in the SAME column, drawer of the post opens. Reload. | **1** (two posts remain, one individual card, same id/status/content, prazo frozen: compare the card's deadline with the fluxo etapa's), **3** (repeat with "Transformar em avulso": no navigation, drawer stays), **14** (open the dialog, edit the origin etapa's responsável in another tab, confirm → toast "O fluxo foi alterado…", nothing detached) |
| Avançar / Voltar | Card buttons AND drag to the adjacent column, both directions. | **2** (fluxo and its posts untouched, post status untouched; drag and button give the same result), **10** (aria-labels present; dark mode via `document.documentElement.dataset.theme='dark'`; 375px viewport) |
| Aplicar processo | Sem processo → "Aplicar processo" on an approved avulso → template padrão, etapa inicial = 2ª → confirm. Then again with a `data_entrega` template. | **4** (approval, media and publication date preserved; earlier step shows "Ignorada"), **13a** (edit the template's etapas in another tab before confirming → "O modelo foi alterado…") |
| Editar etapa | Drawer → seção Produção → change responsável and prazo of a pendente step of ONE of the two detached posts. | **5** (the other post and the template unchanged) |
| Concluir / Reabrir / Remover | Advance to the last step → "Concluir processo" (with the post in `enviado_cliente`: choose "Concluir sem alterar o post"). Concluídas → "Reabrir processo". Drawer → "Remover processo". | **6** (Concluídas entry; still in Publicações; reopen restores the last step with the overdue prazo intact; remove keeps history and the post goes back to Sem processo), **7** (concluding did not approve/publish the post) |
| Vincular a um fluxo | Drawer of a post with an active process → "Vincular a um fluxo" → confirmation step → confirm. | **16** (process `encerrado`/`vinculado` in the timeline; post now in the fluxo; the fluxo's `max_posts_per_workflow` is respected: try on a fluxo at the limit and expect the entitlement toast) |
| Ordem manual mista | Column with a fluxo and a post: drag the fluxo below the post; reload. | **9** (order survives reload; counts show "1 fluxo · 1 post"; a detached post is never counted inside its old fluxo) |
| Dupla aprovação (Hub) | Detach a post from a fluxo with two `aprovacao_cliente` etapas while in the first; approve it in the Hub portal (`npm run dev:hub:staging`, port 5174). | **11** (post NOT auto-scheduled; `hub-posts` response lists it in `autoPublishSuspendedPostIds`), **12** (advance the approval step: post returns to `rascunho`; a `postado`/`agendado` post is never reset; "Avançar etapa sem alterar o post" keeps status and custom status) |
| Lote e revisão | Select two posts → Manter etapas → cut the network (DevTools offline) mid-request → retry online. Then open the same post in two tabs and avançar in both. | **13** (no partial detach; the retry with the same request id returns the original result, no duplicate processes/events — check `post_process_events` count; the second tab gets "Este processo foi alterado em outro lugar…") |
| Flag off keeps things operable | Admin → turn the override OFF → reload the CRM. | **18** (existing individual cards still render and "Avançar etapa" still works; "Aplicar processo", "Manter etapas" and the Sem processo section are gone; a Post Express draft with an active process is not cleaned: check `express-post-cleanup-cron` logs or simply that the post survives past the cutoff). Turn the override back ON afterwards only if wider staging validation will continue; otherwise leave it OFF |

Also confirm there are no console errors on any of the flows and that `npm run lint`, `npm run format:check`, the four `tsc`s, `npm run test`, `npm run check:functions`, `npm run test:functions` are green on the branch before opening the PR.

- [ ] **Step 6: Record and decide**

Write the ticked matrix (with the seed workspace id, dates, and any deviation) into the SDD ledger. Any failed criterion becomes a fix task on this branch before the PR is opened. Then propose the next step to the user: keep the flag on for the seed workspace only, or enable it for more staging workspaces. **Do not enable the flag on any production workspace: that is a separate decision the user makes explicitly.**

---

## Self-Review

**1. Spec coverage** (interactive-command scope of spec §5, §6.2, §7, §9.6, §11, §12; PO decisions 1–4; the 8 advisor-confirmed gaps):

| Requirement | Task |
|---|---|
| §5.1 desmembrar mantendo etapas: two options, "Manter etapas" recommended/pre-selected, list of posts + current etapa, archive checkbox, availability rule (ativo + exactly one etapa ativa), `workflow_changed`, `request_id` across `callRpcWithDeadlockRetry` | 2, 6, 11 |
| §4.1 reveal on the board after desmembrar/aplicar, clearing only the hiding filters, single → drawer, multiple → reveal only; avulso sem etapas keeps today's behaviour | 11, 12 |
| §5.2 aplicar processo: template + etapa inicial + responsáveis/prazos preview, three prazo modes, `data_entrega` needs approval step + `dia_entrega` + month, disabled confirm with reason, `template_changed`, `post_has_active_process`/`post_in_workflow` refetch | 6, 12 |
| §5.2 surfaces: drawer + Sem processo (Publicações per-post menu does not exist: see File Structure note) | 12 |
| §5.4 header actions (Avançar, Voltar, Concluir, Reabrir, Remover, Aplicar, Vincular); edit responsável/prazo of `pendente`/`ativo` steps; "Cliente aprovou. Avançar etapa?" hint | 7, 10, 12, 13 |
| §5.5 concluir (approval dialog on `aprovacao_cliente` with pendência), reabrir (preserves prazo), remover (confirm, history kept), vincular (confirmation step + `attach_post_closing_process`) | 7, 9, 13 |
| §4.2 post card buttons with `aria-label`, drag to adjacent column, dialogs receive the entity title, counts unchanged | 5, 8 |
| §4.2 mixed manual order via `reorder_fluxos_board`, whole column incl. hidden cards (PO decision 2) | 4 |
| §6.2 `approvalAdvance.ts` extraction + three call sites + `EntregasTabRearm.test.ts`; individual variant (total 1, only `pendente` approvals ahead); "Enviar ao cliente" = direct UPDATE gated on `aprovado_interno`, disabled with reason; re-arm inside the RPC; Decisions 12/13/15 | 5, 7 |
| §7 CRM-computed deadlines (`p_active_deadline`, `p_step_deadlines`, overrides, `p_next_deadline`), end-of-local-day for `data_limite`, the two `toISOString().split('T')[0]` bugs | 6, 7, 11, 12 |
| §9.6 optimistic + rollback + refetch on stale codes + PT-BR toasts; invalidation set | 1, 4, 7–13 |
| §9.3 `getAttachErrorToast` gains `post_has_active_process` | 13 |
| §11 / §12.18 / PO decision 1: flag gates creation only; reads always on; existing processes operable | 3 (+ every mutation task reads no flag) |
| `FEATURE_LABELS.feature_post_processes`; all 47 codes mapped | 1 |
| RPC contracts proven against a real Postgres | 14 |
| §12 matrix on staging with the flag on for one workspace (PO decision 4); prod untouched | 15 |
| `.env.staging` presence checked before browser tasks | Global Constraints, 15 |

Not in this plan, on purpose: MCP read fields (§13), server-side approval transition (§13), Publicações per-post menu (does not exist), `TABS_THRESHOLD`, keyboard sensor for dnd-kit (§4.2 says the buttons are the alternative), any backend change.

**2. Placeholder scan:** no "TBD"/"TODO"/"similar to Task N"; every code step shows the code; the only "adapt to the file's helper names" notes point at existing test helpers whose names the implementer reads from the file (`renderDrawer`, `renderView`, `renderSection`, `renderBoard`, `renderPage`, `card()`), with the intended assertion spelled out.

**3. Type consistency:** `postProcessesVisible` (Task 3) is what EntregasPage passes as `KanbanView.postProcessesEnabled` (prop name kept, documented). `ProcessTarget` is defined once in `postProcessCommands.ts` and consumed by Tasks 7, 8, 9. `BoardSortableId`/`sortableIdOf`/`planColumnPersist`/`computeCrossColumnSlot` live in `boardReorder.ts` (Task 4) and are consumed by Task 8. `StepOverrides` (Task 2) is the type `buildApplyPlan` (Task 6) returns and `applyPostProcess` (Task 12) sends. Dialog props renamed once (Task 5: `entityTitle`, `entityKind`, `withoutChangesLabel`, `sendToPortalDisabledReason`) and used with those names in Task 7. `DetachKeepingProcessResult.processes[].post_id` (Task 2) is what Task 11's `handleDetachedKeepingProcess` maps for the reveal. `getPostProcessErrorToast(err, fallback)` signature is the same in every task.

## Judgment calls made while planning (review these)

Everything below is a decision the plan makes where the spec, the PO decisions or the research left room; each is marked in the task that carries it.

1. **Flag mechanism (Task 3):** reads are unconditionally on and a derived `postProcessesVisible = flag || vigenteProcesses.length > 0` drives every display gate; only Aplicar processo, Manter etapas and the Sem processo section read the raw flag. PO decision 1 asked for "the specific mechanism"; this is it. Cost: one extra zero-row query per Entregas load and per drawer open for every flag-off workspace. `WorkflowDrawer`'s `post-process-events` gate is also removed (history is not creation).
2. **WorkflowDrawer auto-complete (Task 5):** it now consumes `decideApprovalAdvance` and only auto-fires when every post of the fluxo is client-cleared. Today it fires whenever the last *awaiting* post gets approved even if another post was never sent (still `rascunho`). This is a behaviour change on the fluxo path, chosen because §6.2 says the three callers must use the extracted decision; a test pins it. If the PO prefers today's behaviour, drop the `decision.kind !== 'advance'` guard in Task 5 Step 7 and the new test case.
3. **Post cards are draggable (Task 8):** PO decision 2 covers the reorder math only, but spec §4.2 ("move a entidade arrastada") and §12.2 ("Voltar por drag e por botão produz o mesmo resultado") require post drag; fase 3's `disabled: { draggable: true }` is treated as a phase boundary, not a design. A post drop is valid only onto the column of `nextPendingStepOf` (forward) or `previousStepOf` (backward), the same targets the buttons use, so a `herdado`/`ignorado`/`concluido` step between two columns can never make drag and button diverge.
4. **Step editing included (Task 10):** not in the prompt's enumerated command list, but in spec v1 scope (§2, §5.4), acceptance 12.5, and one of the seven RPCs.
5. **"Aplicar processo" surfaces (Task 12):** drawer header + Sem processo cards only; the Publicações per-post menu §5.2 names does not exist and is not created here.
6. **Reveal semantics (Task 11):** single post → open its drawer; multiple → reveal only; filters cleared per dimension using the existing `matchesPostEntityFilters` (prazo preset + range treated as one dimension); when the entity never shows up after the refetch, a toast asks to reload instead of hanging.
7. **`callRpcWithDeadlockRetry` for all seven RPCs (Task 2):** the spec names the retry only for the detach/attach family; transition/update/remove are retry-safe by `revisao`, so retrying them once on `40P01` is harmless and keeps one code path.
8. **Dialog prop rename (Task 5):** `workflowTitle` → `entityTitle` plus three new optional props, rather than a second post-specific dialog.
9. **Avançar vs Concluir on the card/header (Task 7):** one button whose label flips to "Concluir processo" when no later step is `pendente` (Decision 12 makes them mutually exclusive by state), so `no_next_step`/`pending_steps_remaining` are never the normal path.
10. **Month input (Task 12):** a native `<input type="month">` instead of `components/ui/month-picker.tsx` (its API was not audited; the native control is testable and sufficient).
11. **Contract test technique (Task 14):** service-role calls that must fail with a `P0001` identifier prove parameter-name resolution without seeding auth; the suite is skipped unless pointed at `127.0.0.1`/`localhost`.
