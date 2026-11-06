# Saída de etapa de aprovação: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Toda saída manual de uma etapa `aprovacao_cliente` (fluxo ou post individual) passa por um diálogo único onde o usuário escolhe o que acontece com o status dos posts; o re-arm automático para rascunho deixa de existir e vira um banner dispensável com "Voltar todos para rascunho".

**Architecture:** Duas migrations: uma RPC atômica nova para fluxos (`advance_workflow_from_approval`) mais a RPC do banner, e uma revisão de `transition_post_process` (posts individuais) mais a RPC do banner do processo. No CRM, um módulo puro decide opções/pré-seleção/banner, um componente `ApprovalExitDialog` substitui `ForwardConfirmDialog` + `ClientApprovalChoiceDialog` na saída de aprovação, e os três caminhos de fluxo (Kanban/phone via `useWorkflowStageCommands`, aba Entregas do cliente, auto-complete do drawer) mais `usePostProcessCommands` passam a usá-los.

**Tech Stack:** Postgres/plpgsql (Supabase), psql entitlement suites, React 19 + TanStack Query + shadcn/ui, Vitest + Testing Library.

**Spec:** `docs/superpowers/specs/2026-10-21-saida-etapa-aprovacao-design.md`

## Global Constraints

- Copy em português, **sem travessão (—)** em texto visível ao usuário; use ponto ou dois-pontos.
- Toasts via `toast()` de `sonner`; ícones só `lucide-react`.
- Posts `agendado` e `postado` nunca mudam de status por nenhuma opção nova; `falha_publicacao` nunca vai para `rascunho` (o trigger `workflow_posts_reset_tiktok_target` apagaria erro e destino TikTok).
- Toda escrita nova é RPC `SECURITY DEFINER`, `SET search_path = public, pg_temp`, autenticada por `public.post_process_require_editor()` (deriva `conta_id`, exige `entregas/editar`), toda query filtrada por `conta_id = v_conta`; `REVOKE ALL ... FROM public, anon` + `GRANT EXECUTE ... TO authenticated, service_role`.
- Migrations com prefixo de versão único acima do último de main (`20261022100000`): use `20261023000001` e `20261023000002`; reconfira contra `origin/main` antes de abrir o PR.
- "Enviar ao portal" de fluxo mantém a semântica atual: só aparece com ≥1 post `aprovado_interno` e só move esses (`sendPostsToCliente`).
- Saída de etapa `padrao` e "Voltar etapa" ficam como estão (`ForwardConfirmDialog`, `revertEtapa`).
- Nunca usar `useBlocker`.
- Antes de cada commit: `npx prettier --write` só nos arquivos tocados pela task.

## Review Focus

1. Dois membros (ou duplo clique) avançam o mesmo fluxo ao mesmo tempo: o segundo recebe `etapa_changed` e nada é escrito duas vezes. Pinned no Task 1 (`1.3`) e no Task 6.
2. O cliente aprova ou pede correção no Hub com o diálogo aberto: confirmar "Aprovar todos"/"Voltar todos" responde `posts_changed`, o CRM recarrega as contagens e reabre o diálogo. Pinned no Task 1 (`1.4`) e no Task 6.
3. Fluxo sem nenhum post saindo de aprovação: o diálogo mostra só "Manter status atuais", sem chips, e avança. Pinned no Task 4.
4. Aba antiga do CRM (versão anterior ainda carregada) chama `transition_post_process` com `p_approval_choice = NULL` num post `aprovado_cliente` com aprovação adiante: avança e o post continua aprovado. Pinned no Task 2 (`89.3`).
5. Post `falha_publicacao` com destino TikTok em falha num fluxo que recebe "Voltar todos para rascunho": post e `post_targets` ficam intactos. Pinned no Task 1 (`1.5`) e Task 2 (`100.2`).

---

### Task 1: Migration de fluxos (avanço atômico + banner)

**Files:**
- Create: `supabase/migrations/20261023000001_advance_workflow_from_approval.sql`
- Create: `supabase/tests/entitlements/99_advance_workflow_from_approval.sql`

**Interfaces:**
- Produces:
  - coluna `workflows.aviso_rascunho_dispensado_em timestamptz NULL`
  - `public.advance_workflow_from_approval(p_workflow_id bigint, p_expected_etapa_id bigint, p_choice text, p_expected_counts jsonb DEFAULT NULL) RETURNS jsonb` → `{ ok: true, workflow_status: 'ativo'|'concluido', etapa_atual: int, posts_changed: int }`. `p_choice in ('manter','aprovar_todos','voltar_rascunho')`. Erros (`ERRCODE P0001`): `invalid_approval_choice`, `workflow_not_found`, `etapa_changed`, `not_approval_etapa`, `expected_counts_required`, `posts_changed`, mais os de `post_process_require_editor`.
  - `public.resolve_workflow_rascunho_banner(p_workflow_id bigint, p_expected_ciclo timestamptz, p_reset boolean) RETURNS integer` (posts alterados; 0 quando só dispensa). Erros: `workflow_not_found`, `ciclo_changed`.

- [ ] **Step 1: Write the failing suite** no esqueleto do `89_transition_post_process.sql` (`\i _helpers.sql`, `et_make_workspace('max')`, `request.jwt.claims`, `begin; ... rollback;` por seção). Ambiente: fluxo com etapas `0 Copy padrao`, `1 Aprov copy aprovacao_cliente` (ativa), `2 Design padrao`, `3 Aprov design aprovacao_cliente`; posts em `rascunho`, `aprovado_interno`, `enviado_cliente`, `aprovado_cliente`, `agendado`, `falha_publicacao` (com `post_targets` TikTok `status='falha', error='x'`). Seções:
  - `1.1 manter`: posts idênticos; etapa 1 `concluido` com `concluido_em`, etapa 2 `ativo`, `workflows.etapa_atual = 2`; retorno `posts_changed = 0`.
  - `1.2 aprovar_todos` com contagens corretas: `rascunho`, `aprovado_interno`, `enviado_cliente` viram `aprovado_cliente`; `aprovado_cliente`, `agendado`, `falha_publicacao` intactos; `posts_changed = 3`.
  - `1.3` segunda chamada com o mesmo `p_expected_etapa_id` → `etapa_changed`, nada mudou.
  - `1.4` `aprovar_todos` com `p_expected_counts` divergente (ex.: um post mudado antes da chamada) → `posts_changed`, nenhuma escrita; `aprovar_todos` sem contagens → `expected_counts_required`.
  - `1.5 voltar_rascunho`: todos exceto `agendado`/`postado`/`falha_publicacao` viram `rascunho`; o `post_targets` do post em falha continua `status='falha', error='x'`.
  - `1.6` última etapa: chamada com `voltar_rascunho` → `invalid_approval_choice`; `manter` → `workflow_status = 'concluido'`.
  - `1.7` etapa ativa `padrao` → `not_approval_etapa`; fluxo de outra conta → `workflow_not_found`; usuário sem `entregas/editar` → `permission_denied`.
  - `1.8 banner`: `resolve_workflow_rascunho_banner(wf, <concluido_em da etapa 1>, true)` volta só os `aprovado_cliente` para `rascunho`, grava `aviso_rascunho_dispensado_em`; com `p_reset = false` só grava a coluna e devolve 0; `p_expected_ciclo` diferente do maior `concluido_em` entre etapas `aprovacao_cliente` concluídas → `ciclo_changed`.

- [ ] **Step 2: Run to verify it fails**

Run: `npm run test:db` (precisa de Docker/colima; ver memória `reference_local_supabase_colima`). Sem Docker local, rodar `psql` contra o Supabase local do worktree ou deixar o gate para o job `entitlement-tests` e registrar isso no PR.
Expected: FAIL, `function public.advance_workflow_from_approval(...) does not exist`.

- [ ] **Step 3: Implement the migration**

`advance_workflow_from_approval`, nesta ordem:
1. valida `p_choice`; `v_conta := post_process_require_editor()`;
2. `pg_advisory_xact_lock(hashtext(v_conta::text || ':post_move'))` (mesma família de locks de mover posts, para as contagens não mudarem por baixo);
3. `SELECT ... FROM workflows WHERE id = p_workflow_id AND conta_id = v_conta FOR UPDATE` (senão `workflow_not_found`);
4. etapa `status = 'ativo'` do fluxo deve ter `id = p_expected_etapa_id` (senão `etapa_changed`) e `tipo = 'aprovacao_cliente'` (senão `not_approval_etapa`); `voltar_rascunho` sem etapa de `ordem` maior → `invalid_approval_choice`;
5. para `aprovar_todos`/`voltar_rascunho`: `p_expected_counts` obrigatório; compara com `jsonb_object_agg(status, count)` dos `workflow_posts` do fluxo (ausente = 0, comparação por chave) → `posts_changed`;
6. `aprovar_todos`: `UPDATE workflow_posts SET status = 'aprovado_cliente'` onde `status NOT IN ('aprovado_cliente','agendado','postado','falha_publicacao')` (só os pendentes; mais restrito que `approvePostsInternally`, de propósito, para não tocar `falha_publicacao`). `voltar_rascunho`: `SET status = 'rascunho'` onde `status NOT IN ('rascunho','agendado','postado','falha_publicacao')`;
7. conclui a etapa com as mesmas escritas de `completeEtapa` (`apps/crm/src/store/workflows.ts:398`): etapa atual `concluido`/`concluido_em = now()`, próxima `ativo`/`iniciado_em = now()` e `workflows.etapa_atual = próxima`; sem próxima, `workflows.status = 'concluido'`. Os triggers `workflow_etapas_updated_event` e `notify_step_activated` disparam sozinhos.

`resolve_workflow_rascunho_banner`: auth + lock da linha do fluxo; ciclo = `max(concluido_em)` das etapas `aprovacao_cliente` com `status = 'concluido'`, comparado a `p_expected_ciclo` (`ciclo_changed`); `p_reset` → `UPDATE ... SET status = 'rascunho' WHERE status = 'aprovado_cliente'`; sempre `aviso_rascunho_dispensado_em = now()`. Retorna `ROW_COUNT` do reset.

Nenhuma alteração de grant de coluna: `workflows` não tem allowlist.

- [ ] **Step 4: Run to verify it passes** — `npm run test:db`, Expected: suite 99 verde, demais inalteradas.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20261023000001_advance_workflow_from_approval.sql supabase/tests/entitlements/99_advance_workflow_from_approval.sql
git commit -m "feat(fluxos): RPC atômica para sair de etapa de aprovação com escolha de status"
```

---

### Task 2: Migration de processos individuais

**Files:**
- Create: `supabase/migrations/20261023000002_transition_post_process_approval_exit.sql`
- Modify: `supabase/tests/entitlements/89_transition_post_process.sql` (seção 89.3 e cabeçalho)
- Create: `supabase/tests/entitlements/100_post_process_rascunho_banner.sql`

**Interfaces:**
- Consumes: nada do Task 1.
- Produces:
  - `transition_post_process` com a **mesma assinatura**, aceitando `p_approval_choice in ('aprovar_interno','sem_alterar','voltar_rascunho')`; novo erro `post_locked`.
  - coluna `post_processes.aviso_rascunho_dispensado_em timestamptz NULL`
  - `public.resolve_post_process_rascunho_banner(p_process_id bigint, p_expected_ciclo timestamptz, p_reset boolean) RETURNS boolean` (true se o post mudou). Erros: `process_not_found`, `ciclo_changed`.

- [ ] **Step 1: Update/write the failing tests**
  - `89.3` passa a afirmar: post `aprovado_cliente` com aprovação pendente adiante, `avancar` com `p_approval_choice = NULL` → avança, post **continua** `aprovado_cliente`, `post_status_changed = false`. Mesmo cenário com `voltar_rascunho` → `rascunho`, `post_status_changed = true`.
  - `89.10` (nova, no mesmo arquivo): `voltar_rascunho` com `concluir` → `invalid_approval_choice`; com post `agendado`, `postado` ou `falha_publicacao` → `post_locked`, sem escrita; com `enviado_cliente` → `rascunho`; `sem_alterar` num post liberado → não mexe.
  - `100.1`: `resolve_post_process_rascunho_banner` com ciclo = `max(concluido_em)` dos passos `aprovacao_cliente` `concluido` e `p_reset = true` → post `aprovado_cliente` vira `rascunho`, coluna gravada, retorna true; `p_reset = false` só grava; ciclo errado → `ciclo_changed`; processo de outra conta → `process_not_found`.
  - `100.2`: post `falha_publicacao` com TikTok em falha: `p_reset = true` não muda nada (retorna false) e o `post_targets` fica intacto.

- [ ] **Step 2: Run to verify it fails** — `npm run test:db`; Expected: 89.3/89.10/100 FAIL (`invalid_approval_choice` para `voltar_rascunho`, função 100 inexistente).

- [ ] **Step 3: Implement** — `CREATE OR REPLACE` copiando o corpo de `20260919000005` com estas mudanças na árvore de aprovação (linhas ~177-203 de lá): remove o ramo `ELSIF v_tem_adiante AND v_status = 'aprovado_cliente'`; `voltar_rascunho` → se `p_command = 'concluir'` `invalid_approval_choice`, se `v_status IN ('agendado','postado','falha_publicacao')` `post_locked`, senão `v_novo_status := 'rascunho'` (no-op se já for rascunho); `aprovar_interno` mantém a regra atual; `NULL` só é exigido para post não liberado (como hoje). Atualizar o comentário do topo (re-arm removido). Reemitir `REVOKE`/`GRANT`. `resolve_post_process_rascunho_banner`: `post_process_require_editor`, mesmo protocolo de lock de `transition_post_process` (advisory `:post_move`, post, processo `FOR UPDATE`), não incrementa `revisao` (não é transição de etapa). `post_processes` só tem `SELECT` para `authenticated`, por isso a escrita é só por esta RPC.

- [ ] **Step 4: Run to verify it passes** — `npm run test:db`; Expected: 89 e 100 verdes.

- [ ] **Step 5: Commit** — `git commit -m "feat(processos): escolha explícita de status ao sair de passo de aprovação"`

---

### Task 3: Store layer

**Files:**
- Modify: `apps/crm/src/store/workflows.ts` (tipo `Workflow`, funções novas)
- Modify: `apps/crm/src/store/posts.ts` (contagem por status)
- Modify: `apps/crm/src/store/postProcesses.ts` (`ApprovalChoice`, `PROCESS_COLUMNS`, `PostProcess`, função nova)
- Modify: `apps/crm/src/pages/entregas/postProcessErrors.ts`
- Test: `apps/crm/src/store/__tests__/approvalExitStore.test.ts`

**Interfaces:**
- Consumes: RPCs dos Tasks 1-2.
- Produces:
  - `type WorkflowApprovalExitChoice = 'manter' | 'aprovar_todos' | 'voltar_rascunho'`
  - `type PostStatusCounts = Partial<Record<WorkflowPost['status'], number>>`
  - `getWorkflowPostStatusCounts(workflowId: number): Promise<PostStatusCounts>` (select `status` de `workflow_posts` do fluxo, agregado no cliente)
  - `advanceWorkflowFromApproval(args: { workflowId: number; expectedEtapaId: number; choice: WorkflowApprovalExitChoice; expectedCounts: PostStatusCounts | null }): Promise<{ workflowStatus: Workflow['status']; etapaAtual: number; postsChanged: number }>`
  - `resolveWorkflowRascunhoBanner(workflowId: number, expectedCiclo: string, reset: boolean): Promise<number>`
  - `resolvePostProcessRascunhoBanner(processId: number, expectedCiclo: string, reset: boolean): Promise<boolean>`
  - `Workflow.aviso_rascunho_dispensado_em?: string | null`; `PostProcess.aviso_rascunho_dispensado_em: string | null` (e a coluna em `PROCESS_COLUMNS`)
  - `ApprovalChoice = 'aprovar_interno' | 'sem_alterar' | 'voltar_rascunho'`
  - em `POST_PROCESS_ERROR_MESSAGES`: `etapa_changed: 'Este fluxo já foi movido por outra pessoa. Recarregue e confira.'`, `posts_changed: 'Os posts mudaram enquanto você escolhia. Confira os números e confirme de novo.'`, `ciclo_changed: 'Este aviso ficou desatualizado. Recarregue e confira.'`, `post_locked: 'Posts agendados, publicados ou com falha na publicação não voltam para rascunho.'`; os três primeiros também na lista de erros de estado velho (`isStaleStateError`).

- [ ] **Step 1: Write failing tests** com o supabase mockado no padrão dos testes de store existentes: `advanceWorkflowFromApproval` chama `rpc('advance_workflow_from_approval', { p_workflow_id: 7, p_expected_etapa_id: 3, p_choice: 'voltar_rascunho', p_expected_counts: { aprovado_cliente: 2 } })` e mapeia `{ workflow_status, etapa_atual, posts_changed }`; erro da RPC sobe; `getWorkflowPostStatusCounts` agrega `[{status:'rascunho'},{status:'rascunho'},{status:'agendado'}]` em `{ rascunho: 2, agendado: 1 }`; os dois `resolve*` passam os parâmetros `p_*` exatos.
- [ ] **Step 2: Run** `npx vitest run apps/crm/src/store/__tests__/approvalExitStore.test.ts` → FAIL (exports inexistentes).
- [ ] **Step 3: Implement** as funções acima; `advanceWorkflowFromApproval` usa `callRpcWithDeadlockRetry` (`apps/crm/src/store/posts.ts:1070`) como `transitionPostProcess`.
- [ ] **Step 4: Run** o mesmo comando → PASS; `npx tsc -p apps/crm/tsconfig.json --noEmit` → limpo.
- [ ] **Step 5: Commit** — `git commit -m "feat(store): avanço atômico de aprovação, contagens por status e banners"`

---

### Task 4: Decisão pura (opções, pré-seleção, banner)

**Files:**
- Create: `apps/crm/src/pages/entregas/approvalExit.ts`
- Test: `apps/crm/src/pages/entregas/__tests__/approvalExit.test.ts`

**Interfaces:**
- Consumes: `PostStatusCounts` (Task 3).
- Produces:
  - `type ApprovalExitOption = 'manter' | 'aprovar' | 'voltar_rascunho' | 'enviar_portal'`
  - `fluxoExitOptions(input: { counts: PostStatusCounts; isLastEtapa: boolean; temAprovacaoAdiante: boolean }): { options: ApprovalExitOption[]; recommended: ApprovalExitOption; pendentes: number; alteraveisRascunho: number; aprovadoInterno: number }`
  - `postExitOptions(input: { status: WorkflowPost['status']; command: 'avancar' | 'concluir'; temAprovacaoAdiante: boolean; sendDisabledReason?: string }): { options: ApprovalExitOption[]; recommended: ApprovalExitOption; locked: boolean }`
  - `fluxoRascunhoBanner(input: { etapas: WorkflowEtapa[]; approvedCount: number; dispensadoEm: string | null | undefined; workflowStatus: Workflow['status'] }): { show: false } | { show: true; ciclo: string }`
  - `postRascunhoBanner(input: { steps: PostProcessStep[]; estado: PostProcessEstado; postStatus: WorkflowPost['status']; dispensadoEm: string | null }): { show: false } | { show: true; ciclo: string }`

Regras (do spec): `pendentes` = posts fora de `aprovado_cliente/agendado/postado/falha_publicacao`; `alteraveisRascunho` = fora de `rascunho/agendado/postado/falha_publicacao`; opções na ordem `manter, aprovar, voltar_rascunho, enviar_portal`; `aprovar` só com `pendentes > 0`; `voltar_rascunho` só com `alteraveisRascunho > 0` e `!isLastEtapa` (post: e `command === 'avancar'`); `enviar_portal` só com `aprovadoInterno > 0` (post: status pendente e sem `sendDisabledReason`); `recommended = 'voltar_rascunho'` se presente e `temAprovacaoAdiante`, senão `'manter'`; post `locked` = status `agendado/postado`. Banner fluxo: `workflowStatus === 'ativo'`, etapa ativa `padrao`, existe etapa `aprovacao_cliente` `concluido` com `ordem` menor (ciclo = maior `concluido_em` entre elas), existe `aprovacao_cliente` de `ordem` maior, `approvedCount > 0`, e `dispensadoEm` nulo ou `< ciclo`. Banner post: mesmas regras sobre `steps` (`estado` `concluido`/`pendente`, ativo `padrao`), `estado === 'ativo'`, `postStatus === 'aprovado_cliente'`.

- [ ] **Step 1: Write failing tests**, um `it` por regra, incluindo: `counts = {}` → `options = ['manter']`, `recommended = 'manter'`; mockup esquerdo (`{aprovado_cliente:5, enviado_cliente:2, rascunho:1, agendado:1}`, sem aprovação adiante) → `['manter','aprovar','voltar_rascunho']`, `pendentes = 3`, `alteraveisRascunho = 7`, recommended `manter`; mockup direito (`{aprovado_cliente:8, agendado:1}`, aprovação adiante) → `['manter','voltar_rascunho']`, recommended `voltar_rascunho`; `{aprovado_interno:2}` inclui `enviar_portal`; `isLastEtapa` remove `voltar_rascunho`; post `concluir` nunca tem `voltar_rascunho`; post `agendado` → `locked`, `options = ['manter']`; banner some com `dispensadoEm` posterior ao ciclo e reaparece com ciclo novo; banner não aparece com etapa ativa `aprovacao_cliente`.
- [ ] **Step 2: Run** `npx vitest run apps/crm/src/pages/entregas/__tests__/approvalExit.test.ts` → FAIL.
- [ ] **Step 3: Implement** as quatro funções.
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** — `git commit -m "feat(entregas): regras do diálogo de saída de aprovação e do banner de rascunho"`

---

### Task 5: `ApprovalExitDialog` e `RascunhoBanner`

**Files:**
- Create: `apps/crm/src/pages/entregas/components/ApprovalExitDialog.tsx`
- Create: `apps/crm/src/pages/entregas/components/RascunhoBanner.tsx`
- Test: `apps/crm/src/pages/entregas/components/__tests__/ApprovalExitDialog.test.tsx`, `.../RascunhoBanner.test.tsx`

**Interfaces:**
- Consumes: `ApprovalExitOption`, `PostStatusCounts` (Tasks 3-4), `STATUS_LABELS` de `apps/crm/src/pages/entregas/postLabels.ts`, `PhoneConfirmSheet` de `@/components/mobile`, `useIsDesktop`.
- Produces:
  - `ApprovalExitDialog(props: { open: boolean; entityKind: 'fluxo' | 'post'; entityTitle: string; nextEtapaName: string | null /* null = conclui */; counts: PostStatusCounts | null /* null = carregando */; options: ApprovalExitOption[]; recommended: ApprovalExitOption; numbers: { pendentes: number; alteraveisRascunho: number; aprovadoInterno: number }; locked?: boolean; busy?: boolean; onConfirm: (choice: ApprovalExitOption) => void; onCancel: () => void })`
  - `RascunhoBanner(props: { count: number; entityKind: 'fluxo' | 'post'; busy?: boolean; onReset: () => void; onDismiss: () => void })` (o componente abre a própria confirmação `AlertDialog` e só chama `onReset` depois de confirmar)

Copy exata (fluxo / post):
- Título: `Avançar "{título}" para {próxima}?`; com `nextEtapaName = null`: `Concluir "{título}"?`
- Intro: `Este fluxo está saindo de uma etapa de aprovação. Escolha o que acontece com os posts.` / `Este post está saindo de uma etapa de aprovação. Escolha o que acontece com ele.`
- Chips: um por status com contagem > 0, rótulo `{n} {STATUS_LABELS[status] em minúsculas}` (fluxo); post mostra só o status atual.
- `manter`: `Manter status atuais` · `Nenhum post muda.` / `Manter status` · `O status do post não muda.`
- `aprovar`: `Aprovar todos` · `{pendentes} posts pendentes ficam aprovados pela equipe.` (singular com 1) / `Aprovar` · `O post fica aprovado pela equipe.`
- `voltar_rascunho`: `Voltar todos para rascunho` · `{alteraveisRascunho} posts voltam para rascunho. O histórico de aprovações é mantido.` / `Voltar para rascunho` · `O post volta para rascunho. O histórico de aprovações é mantido.`
- `enviar_portal`: `Enviar ao portal` · `{aprovadoInterno} posts aprovados internamente vão para o cliente aprovar. O fluxo não avança.` / `Enviar ao portal` · `O post vai para o cliente aprovar. O processo não avança.`
- Selo na opção recomendada: `Recomendado`. Rodapé: `Posts agendados ou publicados nunca são alterados.` Post `locked`: só a linha `O status do post não muda.` e o botão.
- Botões: `Cancelar` e primário `Avançar` (`Concluir` quando `nextEtapaName = null`; `Enviar ao portal` quando essa opção está marcada); primário desabilitado com `counts = null` ou `busy`.
- Desktop: `Dialog` com radio cards (`role="radiogroup"`, estado inicial = `recommended`, layout do mockup `advance-dialog.html`). Phone (`!useIsDesktop(768)`): `PhoneConfirmSheet` com uma ação por opção, recomendada primeiro e rotulada `(Recomendado)`, toque = confirmar.
- Banner fluxo: `{count} posts continuam aprovados.` + `A próxima etapa de aprovação vai precisar deles em rascunho para enviar ao cliente de novo.` + botão `Voltar todos para rascunho` + X (`aria-label="Dispensar aviso"`). Post: `Este post continua aprovado.` + `A próxima etapa de aprovação vai precisar dele em rascunho para enviar ao cliente de novo.` + `Voltar para rascunho`. Confirmação: título `Voltar {count} posts para rascunho?` (post: `Voltar o post para rascunho?`), corpo `Eles saem de Aprovado e voltam para Rascunho. O histórico de aprovações é mantido.` (post: `Ele sai de ...`), ação `Voltar para rascunho`. Estilo do mockup `reset-placement.html` opção A, com tokens `--warning` do `style.css`.

- [ ] **Step 1: Write failing tests**: opção recomendada vem marcada; `onConfirm` recebe a opção marcada depois de trocar o radio; primário desabilitado com `counts = null`; rótulo vira `Enviar ao portal` ao marcar essa opção; título `Concluir` com `nextEtapaName = null`; nenhuma string renderizada contém `—`; phone (mock de `useIsDesktop` → false) mostra a recomendada primeiro; banner: X chama `onDismiss` sem confirmação; botão abre confirmação e `onReset` só roda após `Voltar para rascunho`.
- [ ] **Step 2: Run** `npx vitest run apps/crm/src/pages/entregas/components/__tests__/ApprovalExitDialog.test.tsx apps/crm/src/pages/entregas/components/__tests__/RascunhoBanner.test.tsx` → FAIL.
- [ ] **Step 3: Implement** os dois componentes.
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** — `git commit -m "feat(entregas): diálogo de saída de aprovação e banner de rascunho"`

---

### Task 6: Kanban e phone (`useWorkflowStageCommands`)

**Files:**
- Modify: `apps/crm/src/pages/entregas/hooks/useWorkflowStageCommands.tsx`
- Modify (testes): `apps/crm/src/pages/entregas/views/__tests__/KanbanRearm.test.tsx` (renomear para `KanbanApprovalExit.test.tsx`), `KanbanBatchAutoScheduleNudge.test.tsx`, `KanbanPhone.test.tsx`, `KanbanSync.test.tsx`, `KanbanFullColumnOrder.test.tsx` onde dependerem do fluxo antigo

**Interfaces:**
- Consumes: Tasks 3-5. `WorkflowStageCommands` (API pública do hook) **não muda**: `forward`, `revert`, `dialogs`.
- Produces: nada novo para fora.

Comportamento:
- `forward(card)`: etapa `aprovacao_cliente` → abre `ApprovalExitDialog` direto (sem `ForwardConfirmDialog`) e dispara `useQuery(['workflow-post-status-counts', wfId], () => getWorkflowPostStatusCounts(wfId))`; etapa `padrao` → `ForwardConfirmDialog` → `completeEtapa` sem rearm, como hoje.
- Confirmar `manter`/`aprovar`/`voltar_rascunho` → `onBeforeMove` → `advanceWorkflowFromApproval({ workflowId, expectedEtapaId: card.etapa.id, choice: 'manter'|'aprovar_todos'|'voltar_rascunho', expectedCounts: counts quando a escolha muda posts, senão null })` → `onMoveSucceeded` → `onRefresh`. Toasts: `Etapa concluída. Status dos posts mantidos.` / `Posts aprovados e etapa concluída.` / `Etapa concluída. Posts voltaram para rascunho.`; `workflowStatus === 'concluido' && card.workflow.recorrente` → `onRecurring` e limpa o nudge, como hoje.
- `aprovar` sem aprovação adiante + `schedulingEnabled === true` + `card.cliente?.auto_publish_on_approval === true` → abre `AutoScheduleBatchDialog` com `isFinalApprovalCycle: true` (substitui o gate `!willRearm`).
- `enviar_portal` → `onAbandon` → `sendPostsToCliente` → toast `Posts enviados ao portal do cliente!` (atual).
- Erro `posts_changed` → `onMoveFailed`, toast da mensagem do Task 3, `refetch` das contagens e o diálogo **continua aberto** com os números novos. `etapa_changed` → `onMoveFailed`, toast, fecha, `onRefresh`. Outros erros → toast `Erro ao avançar etapa` como hoje.
- Cancelar → `onAbandon` (inclui o caso de drag entre colunas).
- Remove imports de `completeEtapaForAdvance`, `notifyRearmOutcome`, `decideApprovalAdvance`, `ClientApprovalChoiceDialog`, `approvePostsInternally`.

- [ ] **Step 1: Write failing tests** em `KanbanApprovalExit.test.tsx` (mocks de store no padrão de `KanbanRearm.test.tsx`): avançar card em etapa de aprovação abre o diálogo **sem** `ForwardConfirm`; confirmar a recomendada com aprovação adiante chama `advanceWorkflowFromApproval` com `choice: 'voltar_rascunho'` e as contagens mockadas; rejeição `{ message: 'posts_changed' }` mantém o diálogo aberto e chama `getWorkflowPostStatusCounts` de novo; `etapa_changed` fecha e chama `onRefresh`; drag de coluna de aprovação + Cancelar chama `onAbandon` e o card volta; etapa `padrao` continua com `ForwardConfirm`. Atualizar o nudge test para o gate novo.
- [ ] **Step 2: Run** `npx vitest run apps/crm/src/pages/entregas/views/__tests__/` → FAIL nos novos.
- [ ] **Step 3: Implement** no hook.
- [ ] **Step 4: Run** a pasta inteira de views + `apps/crm/src/pages/entregas/hooks/__tests__` → PASS.
- [ ] **Step 5: Commit** — `git commit -m "feat(entregas): Kanban usa o diálogo de saída de aprovação"`

---

### Task 7: Aba Entregas do cliente no hook compartilhado

**Files:**
- Modify: `apps/crm/src/pages/cliente-detalhe/tabs/EntregasTab.tsx` (handlers ~linhas 495-605 e JSX ~1053-1096)
- Modify: `apps/crm/src/pages/cliente-detalhe/tabs/__tests__/EntregasTab.test.tsx`
- Delete: `apps/crm/src/pages/cliente-detalhe/tabs/__tests__/EntregasTabRearm.test.ts`

**Interfaces:**
- Consumes: `useWorkflowStageCommands` (Task 6) com `onRefresh: refreshCards`, `onRecurring: setRecurringWfId`, `postsCounts`, `clearedClienteCounts`, `schedulingEnabled`, `tiktokEnabled`, `recurringWfId`.

Troca `forwardTarget`/`revertTarget`/`approvalChoice`/`batchSchedule` e os handlers `handleForward*`, `handleApproveInternally`, `handleSendToPortal`, `handleAdvanceWithoutApproval`, `handleRevert*` por `commands.forward`/`commands.revert` e `{commands.dialogs}`; remove o `AutoScheduleBatchDialog` local (o do hook o substitui). Mantém as `invalidateQueries` históricas dentro de `refreshCards`. Atualiza o docblock do componente (não cita mais rearm).

- [ ] **Step 1: Update tests**: avançar fluxo em etapa de aprovação na aba abre `ApprovalExitDialog` e chama `advanceWorkflowFromApproval`; fluxo recorrente concluído abre o diálogo de recorrência e não o nudge; revert continua igual.
- [ ] **Step 2: Run** `npx vitest run apps/crm/src/pages/cliente-detalhe/tabs/__tests__/EntregasTab.test.tsx` → FAIL.
- [ ] **Step 3: Implement**.
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** — `git commit -m "refactor(cliente): aba Entregas usa a cadeia de etapas compartilhada"`

---

### Task 8: Drawer do fluxo (auto-complete + banner)

**Files:**
- Modify: `apps/crm/src/pages/entregas/components/WorkflowDrawer.tsx` (efeito ~linhas 317-344; banner logo antes do `{isLoading ? <CardListSkeleton ...`, ~linha 1242, que cobre desktop e phone)
- Modify: `apps/crm/src/pages/entregas/components/__tests__/WorkflowDrawerAutoComplete.test.tsx`
- Test: `apps/crm/src/pages/entregas/components/__tests__/WorkflowDrawerRascunhoBanner.test.tsx`

**Interfaces:**
- Consumes: `advanceWorkflowFromApproval` com `choice: 'manter'`, `expectedCounts: null` (Task 3); `fluxoRascunhoBanner` (Task 4); `RascunhoBanner` (Task 5); `resolveWorkflowRascunhoBanner` (Task 3).

Auto-complete: troca `completeEtapaForAdvance` por `advanceWorkflowFromApproval({ workflowId, expectedEtapaId: approvalEtapa.id!, choice: 'manter', expectedCounts: null })`, mesmo toast `Todos os posts aprovados. Etapa concluída!` (sem travessão), sem `notifyRearmOutcome`; `etapa_changed` continua silencioso. Banner: `fluxoRascunhoBanner({ etapas: card.allEtapas, approvedCount: posts.filter(p => p.status === 'aprovado_cliente').length, dispensadoEm: card.workflow.aviso_rascunho_dispensado_em, workflowStatus: card.workflow.status })`; `onReset`/`onDismiss` → `resolveWorkflowRascunhoBanner(workflowId, ciclo, reset)` → toast `Posts voltaram para rascunho.` só no reset → invalidar `['workflow-posts-with-props', workflowId]` e `onRefresh()`. Esconder localmente na hora (estado otimista) para o X não piscar até o refetch. `ciclo_changed` → toast da mensagem e `onRefresh()`.

- [ ] **Step 1: Write failing tests**: último post aprovado com drawer aberto chama `advanceWorkflowFromApproval` com `choice: 'manter'` (e nunca `resetApprovedPostsForNextCycle`); banner aparece com etapa ativa `padrao` entre duas aprovações e posts aprovados; X chama `resolveWorkflowRascunhoBanner(id, ciclo, false)` e some; reset confirmado chama com `true`; banner ausente quando `aviso_rascunho_dispensado_em` > ciclo.
- [ ] **Step 2: Run** `npx vitest run apps/crm/src/pages/entregas/components/__tests__/WorkflowDrawerAutoComplete.test.tsx apps/crm/src/pages/entregas/components/__tests__/WorkflowDrawerRascunhoBanner.test.tsx` → FAIL.
- [ ] **Step 3: Implement**.
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** — `git commit -m "feat(entregas): banner para voltar posts a rascunho e auto-conclusão sem re-arm"`

---

### Task 9: Post individual (comandos + banner)

**Files:**
- Modify: `apps/crm/src/pages/entregas/hooks/usePostProcessCommands.tsx`
- Modify: `apps/crm/src/pages/entregas/components/StandalonePostDrawer.tsx` (banner logo abaixo da linha de passo com Voltar/Avançar, ~linha 938 no desktop e ~1129 no phone)
- Modify: `apps/crm/src/pages/entregas/hooks/__tests__/usePostProcessCommands.test.tsx`, `apps/crm/src/pages/entregas/components/__tests__/StandalonePostDrawer.test.tsx`, `.../StandalonePostDrawer.phone.test.tsx`, `apps/crm/src/pages/entregas/views/__tests__/ConcludedView.test.tsx` se afetado

**Interfaces:**
- Consumes: `postExitOptions`, `postRascunhoBanner` (Task 4); `ApprovalExitDialog`, `RascunhoBanner` (Task 5); `ApprovalChoice` com `voltar_rascunho`, `resolvePostProcessRascunhoBanner` (Task 3). API pública de `PostProcessCommands` não muda.

Comportamento: `avancar`/`concluir` com passo ativo `aprovacao_cliente` → `ApprovalExitDialog` (`entityKind: 'post'`, `counts: { [status]: 1 }`) direto, sem `ForwardConfirm`/AlertDialog de concluir; mapeamento `manter → 'sem_alterar'`, `aprovar → 'aprovar_interno'`, `voltar_rascunho → 'voltar_rascunho'`, `enviar_portal → sendToPortal` (existente). Remove o `toast.info('O post voltou para rascunho...')` e passa a mostrar `O post voltou para rascunho.` só quando a escolha foi `voltar_rascunho`. Mantém os refs de ciclo (`choiceResolvedRef`, `onDismiss`) e `onOptimisticStep`. Banner: `postRascunhoBanner({ steps: postProcess.steps, estado: postProcess.estado, postStatus: post.status, dispensadoEm: postProcess.aviso_rascunho_dispensado_em })` → `resolvePostProcessRascunhoBanner` → invalida `['post-process', postId]` e o post.

- [ ] **Step 1: Write failing tests**: avançar post `aprovado_cliente` com aprovação adiante abre o diálogo com `Voltar para rascunho` recomendado e chama `transitionPostProcess` com `approvalChoice: 'voltar_rascunho'`; `Manter status` → `'sem_alterar'`; `concluir` não oferece rascunho; post `agendado` mostra só a confirmação com `O status do post não muda.`; Cancelar chama `onDismiss` uma única vez; banner no drawer aparece/dispensa/reseta como no Task 8.
- [ ] **Step 2: Run** `npx vitest run apps/crm/src/pages/entregas/hooks/__tests__/usePostProcessCommands.test.tsx apps/crm/src/pages/entregas/components/__tests__/StandalonePostDrawer.test.tsx apps/crm/src/pages/entregas/components/__tests__/StandalonePostDrawer.phone.test.tsx` → FAIL.
- [ ] **Step 3: Implement**.
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** — `git commit -m "feat(processos): diálogo de saída de aprovação e banner no post individual"`

---

### Task 10: Limpeza, copy e verificação final

**Files:**
- Delete: `apps/crm/src/pages/entregas/advanceEtapa.ts`, `apps/crm/src/pages/entregas/__tests__/advanceEtapa.test.ts`, `apps/crm/src/pages/entregas/components/__tests__/ClientApprovalChoiceDialog.test.tsx`
- Modify: `apps/crm/src/store/workflows.ts` (remove `completeEtapaWithRearm`, `CompleteEtapaWithRearmResult`), `apps/crm/src/store/posts.ts` (remove `resetApprovedPostsForNextCycle`; `approvePostsInternally` some se ficar sem uso), `apps/crm/src/pages/entregas/approvalAdvance.ts` (remove `decideApprovalAdvance` se sem uso; `isClientCleared`/`hasLaterPendingApprovalStep` ficam se usados), `apps/crm/src/pages/entregas/components/WorkflowModals.tsx` (remove `ClientApprovalChoiceDialog`, `ApprovalChoiceOption`, `ChoiceLabel` se sem uso), `apps/crm/src/pages/entregas/components/__tests__/WorkflowModalsPhone.test.tsx`, `apps/crm/src/pages/entregas/components/ComoFuncionaPanel.tsx:128-131`, comentários de `supabase/functions/hub-approve/handler.ts:68-72`

- [ ] **Step 1:** `grep -rnE "completeEtapaWithRearm|resetApprovedPostsForNextCycle|notifyRearmOutcome|ClientApprovalChoiceDialog|decideApprovalAdvance|rearm" apps/ supabase/functions/` e remover/ajustar cada ocorrência (os dois `__tests__` trees, memória `feedback_contract_change_update_existing_tests`).
- [ ] **Step 2:** `ComoFuncionaPanel` exceção passa a: `<strong>Exceção:</strong> ao concluir uma etapa de aprovação, você escolhe o que acontece com os posts: manter, aprovar todos ou voltar para Rascunho.`; comentário do `hub-approve` deixa de citar o re-arm automático (só comentário, sem redeploy).
- [ ] **Step 3: Gates do CI**, todos verdes:

```bash
npm run lint
npx prettier --check $(git diff --name-only origin/main...HEAD)
npx tsc -p apps/crm/tsconfig.json --noEmit
npx tsc -p apps/hub/tsconfig.json --noEmit
npx tsc -p apps/admin/tsconfig.json --noEmit
npx tsc -p tsconfig.scripts.json
npm run test
npm run check:functions
npm run test:functions
```

Depois de `test:functions`: `git status` limpo de `deno.lock` e `ls node_modules/.deno` vazio (memórias `reference_deno_lock_dirtied_by_test_functions`, `project_deno_npm_node_modules_gotcha`).
- [ ] **Step 4: Browser** (`npm run dev:env`, login de seed, stubs de edge functions conforme memórias `reference_seed_login_browser_verification` / `reference_local_browser_verify_stub_edge_functions`; com migrations aplicadas no Supabase local, nunca em prod): Kanban botão e drag numa etapa de aprovação, phone (resize mobile), aba Entregas do cliente, drawer (banner: dispensar e resetar), post individual. Screenshot de cada diálogo.
- [ ] **Step 5: Commit** — `git commit -m "chore(entregas): remove o re-arm automático e atualiza a ajuda"`

Deploy (fora do plano de código, na ordem da memória `feedback_merge_deploys_frontend_migrations_first`): `db push` das duas migrations em staging e prod **antes** do merge; artigos da Central de Ajuda que descrevam o re-arm ficam como tarefa de conteúdo separada.
