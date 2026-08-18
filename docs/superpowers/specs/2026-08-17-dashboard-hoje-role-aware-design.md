# Dashboard "Hoje" v2: first section, role-aware, interactive

## Context

The "Hoje" card on `/dashboard` (`TodayCard`) is a flat list of today's events (recebimentos, despesas, prazos de etapa, aniversários, datas) sitting below the health monitor, with one link to `/calendario` around everything. The user wants it to be **the first section**, to surface **what needs action** with better visibility, and to be **role-aware**:

- **owner/admin**: holistic workspace view (today's events + work signals across all members, with who is responsible);
- **agent**: only items that require *their* action (tarefas, etapas and posts assigned to them), no finance/birthday rows.

Decisions taken during brainstorming (all confirmed by user):
- Agents keep **both** cards: new "Hoje" (due today/overdue/next 7 days, mine) **and** the existing "Minhas pendências" backlog below it. `AgentPendingSection` is untouched.
- Owner/admin content = current events **+** tarefas due today/overdue (any member), etapas overdue/due (any member), posts agendados para hoje, posts `enviado_cliente` (aguardando cliente).
- Interactivity: deep-links per row, count chips `Atrasado / Hoje / Próximos 7 dias` that toggle groups, inline "concluir" checkbox on tarefas.
- Grouping = **option A** from the visual companion mockup: chips + stacked groups; Atrasado and Hoje expanded, Próximos collapsed by default.
- Approach A: pure agenda logic + role-aware hook + rewritten `TodayCard`; queries stay component-local (DashboardPage's `useQueries` batch is index-mocked in its test and must not grow).

### Scope matrix (single contract; builder + tests enforce exactly this)

| Kind | workspace (owner/admin) | mine (agent) | Buckets it can land in |
|---|---|---|---|
| tarefa (open, has `data_limite`) | all members, shows responsável | `responsavel_id === membroId` | atrasado / hoje / proximos |
| etapa (`status==='ativo'`, has deadline) | all members | `responsavel_id === membroId` | atrasado / hoje / proximos |
| post_agendado (`scheduled_at` in [today, +7d), not `postado`) | all | `responsavel_id === membroId` (field exists in `POST_CONTEXT_COLUMNS`) | hoje / proximos (never atrasado; a past `scheduled_at` is a publish state, not a deadline) |
| post_aguardando_cliente (`enviado_cliente`) | all | none | hoje, or atrasado when waiting ≥ 3 days |
| post_pendente (`getAssignedPendingPosts`) | none | own | hoje |
| income / expense (`canSeeFinancials === true`) | yes | none | hoje |
| birthday / data | yes | none | hoje |

The horizon is uniform: overdue + today + next 7 days for every dated kind, both scopes. Undated action items are "hoje".

### Role resolution (fail closed)

`scope` is derived **only** from `workspaceRole`, gated by `membershipResolved` from `AuthContext` (`AuthContext.tsx:235-250`). Until `membershipResolved === true` **and** `workspaceRole !== null`, the card renders its loading state and fires no workspace-wide queries. Never fall back to profile-level `role` (stale across workspace switches; an owner viewing a workspace where they are an agent must not see workspace data during a membership blip). `DashboardPage`'s own `isAgent` line is left as is (out of scope), but the card no longer depends on it.

Spec: this plan doubles as the design doc. First implementation step commits it (trimmed) to `docs/superpowers/specs/2026-08-17-dashboard-hoje-role-aware-design.md` (brainstorming skill convention; plan mode forbade writing it now).

## 1. `todayAgenda.ts` (pure)

```ts
export type AgendaBucket = 'atrasado' | 'hoje' | 'proximos';
export type AgendaKind =
  | 'tarefa' | 'etapa' | 'post_agendado' | 'post_aguardando_cliente' | 'post_pendente'
  | 'income' | 'expense' | 'birthday' | 'data';
export interface AgendaItem {
  key: string;                       // `${kind}:${id}` (React key)
  kind: AgendaKind;
  bucket: AgendaBucket;
  title: string;
  context: string;                   // "cliente · workflow", "Recebimento", "Agendado 18:00"…
  when: Date | null;                 // sort key inside bucket (null = last)
  href: string;
  responsavel?: { id: number; nome: string } | null;   // owner scope only
  badge?: { label: string; className: 'deadline-overdue'|'deadline-warning'|'deadline-caution'|'deadline-ok' } | null;
  tarefaId?: number;                 // present only for kind 'tarefa' → enables the checkbox
}
export interface AgendaInput {
  now: Date; scope: 'workspace' | 'mine'; membroId: number | null;
  canSeeFinancials: FinancialAccess;
  tarefas: TarefaWithRelations[]; etapas: ActiveEtapa[]; scheduledPosts: ScheduledPost[];
  awaitingClientePosts: AwaitingClientePost[]; assignedPendingPosts: AssignedPendingPost[];
  clientes: Cliente[]; membros: Membro[]; datas: ClienteData[];
}
export function buildTodayAgenda(input: AgendaInput): Record<AgendaBucket, AgendaItem[]>;
export function bucketFor(when: Date | null, now: Date): AgendaBucket | null; // null = outside horizon
```

Rules
- Bucketing is done on **local calendar days** via a `dayNum(d) = y*10000+m*100+d` key (same technique as `etapaPrazo.ts:44`), never on ms arithmetic against a UTC-parsed date. `bucketFor(when, now)`: `dayNum(when) < dayNum(now)` → atrasado; equal → hoje; `≤ dayNum(now + 7d)` → proximos; else null (dropped). Items with `when === null` that "need action now" go to `hoje`.
- **tarefas** (`status !== 'concluida'`): `when = parseDateOnly(t.data_limite)` (`tarefasLogic.ts:10`, local-safe); no `data_limite` → dropped (belongs to backlog, not "Hoje"). Badge via existing `dueBadge(t, now)` (`tarefasLogic.ts:227`), which uses the same `parseDateOnly` + local-day diff, so bucket and badge always agree. href `/tarefas?tarefa=${id}`. scope `'mine'` → `responsavel_id === membroId`.
- **etapas** (`status === 'ativo'`, from `getAllActiveEtapas`): `when = etapaDeadlineDateOf(e)` (null → dropped); badge derived from `bucketFor` + `dayNum` diff (Atrasada / Hoje / `Nd`), **not** from `getDeadlineInfo` (which uses its own `new Date()` and ms math and would disagree with the bucket near midnight). href `/entregas?drawer=${workflow_id}`. `'mine'` → `responsavel_id === membroId`. Note current TodayCard only shows etapas due *today*; v2 also shows overdue + next 7d.
- **post_agendado** (from `getScheduledPosts(startOfTodayISO, horizonEndISO)`, both scopes per matrix): `when = new Date(scheduled_at)`; context `Agendado HH:mm · cliente`; badge `deadline-ok`; href `/entregas?drawer=${workflow_id}&post=${id}`. Exclude `status === 'postado'`. Query range starts at start of today, so it can only bucket hoje/proximos.
- **post_aguardando_cliente** (workspace only): from new `getAwaitingClientePosts()`; `waiting_since` null or < 3 days → `hoje`; ≥ 3 full days → `atrasado`; context `Aguardando cliente há Nd` (or plain `Aguardando cliente` when null); badge `deadline-warning` when atrasado else `deadline-caution`. href `/entregas?drawer=${workflow_id}&post=${id}`.
- **post_pendente** (agent only): `getAssignedPendingPosts(membroId)`; `when = null` → `hoje`; badge label = `POST_STATUS_LABELS[status]`, className `deadline-warning` for `correcao_cliente|falha_publicacao`, `deadline-caution` otherwise.
- **income/expense** (owner + `canSeeFinancials === true` only): same predicates as today's DashboardPage:143-154; `when = today` → hoje only; href `/clientes/${id}` (income) / `/equipe/${id}` (expense).
- **birthday/data** (owner only): same predicates as DashboardPage:160-177; hoje only; href `/clientes/${id}` when a client is known, else `/calendario`.
- Sort inside bucket: `when` asc (nulls last), then title. `responsavel` resolved via `membros.find(m => m.id === responsavel_id)` in workspace scope only.

## 2. `useTodayAgenda.ts`

```ts
export function useTodayAgenda(): { buckets; isLoading; scope; membroMissing: boolean }
```
- `useAuth()` → `{ workspaceRole, membershipResolved, canSeeFinancials }`. `roleReady = membershipResolved && workspaceRole !== null`; `scope = workspaceRole === 'agent' ? 'mine' : 'workspace'`. While `!roleReady` the hook returns `{ isLoading: true }` and **every** query is `enabled: false` (fail closed; see Role resolution above). If `membershipResolved && workspaceRole === null` (genuinely no membership), render the `semVinculo` state.
- `useCurrentMembro()` (`hooks/useCurrentMembro.ts`) for `membroId` (agent scope). `membroMissing = scope==='mine' && !isLoading && !membro`.
- Queries (all `retry: 1`; keys MUST match the app's existing keys so mutations elsewhere invalidate them): `['tarefas']→getTarefas`, `['agent-pending-etapas']→getAllActiveEtapas` (same key AgentPendingSection uses so it's fetched once), `['clientes']`, `['membros']`, `['allClienteDatas']` (workspace only), `['scheduled-posts', startISO, endISO]→getScheduledPosts` (hyphenated, same prefix as `useScheduledPosts.ts:23` and the invalidations in `CalendarView.tsx:101`), `['active-posts', 'awaiting-cliente']→getAwaitingClientePosts` (workspace only; shares the `['active-posts']` prefix so existing `invalidateQueries({queryKey:['active-posts']})` calls hit it), `['agent-pending-posts', membroId]→getAssignedPendingPosts` (mine only). `enabled` = `roleReady && <scope condition>`.
- `useMemo(() => buildTodayAgenda(...), [deps])`; `now` from `new Date()` at render (tests freeze time with `vi.useFakeTimers`).

## 3. `TodayCard.tsx` (rewrite; no props)

Structure (Option A):
- Header: `CalendarCheck` (lucide) + `t('today.title')` ("Hoje") + `Link` "Calendário →" to `/calendario`. Subtitle: `format(now, "EEEE, d 'de' MMMM", { locale: ptBR })` + ` · N atrasados, M para hoje` (+ ` · atribuídos a você` in mine scope). Use `date-fns`.
- Chips row: three `<button aria-pressed>` chips `Atrasado N` (red when N>0), `Hoje N`, `Próximos 7 dias N`; local `useState<Set<AgendaBucket>>` initial `{atrasado, hoje}`; toggling shows/hides that group. Chip with N=0 rendered dimmed, still toggleable.
- Groups: for each visible bucket with items → group label (uppercase, count pill) + rows. Cap 8 rows per group with `+ N itens · ver todos` link (→ `/tarefas` if the overflow is all tarefas, else `/entregas`; simplest: `/calendario`). Keep it simple: link to `/calendario`.
- Row (`<Link className="today-row" to={href}>`): kind icon (lucide: `ClipboardList` tarefa, `Flag` etapa, `Send` post_agendado, `MailQuestion` aguardando cliente, `PencilLine` post_pendente, `ArrowUpRight` income (`--success`), `ArrowDownLeft` expense (`--danger`), `Cake` birthday, `Star` data), title (ellipsis), context (muted), right side: `responsavel` (initials avatar via `components/ui/avatar.tsx` + first name) in workspace scope, then badge span `board-card-deadline ${className}`.
- Tarefa rows: leading `Checkbox` (`components/ui/checkbox.tsx`) with `onClick={e => {e.preventDefault(); e.stopPropagation();}}` so it doesn't navigate; `useMutation({ mutationFn: ({id}) => updateTarefa(id, {status:'concluida'}) })` with optimistic removal from `['tarefas']` cache; the mutation variables carry `previousStatus: TarefaStatus` (`'pendente' | 'em_andamento'`, read from the row before mutating) and the toast undo restores **that** status: `toast.success(t('today.taskDone'), { action: { label: 'Desfazer', onClick: () => undo.mutate({id, status: previousStatus}) } })`. `onError` rollback + `toast.error`, `onSettled` invalidate `['tarefas']`. `concluida_em` is DB-owned by trigger, don't send it. Store `role` isn't needed: agents may complete their own tasks (they can already on /tarefas).
- States: loading → `Spinner`; `membroMissing` → reuse `t('agentPending.semVinculo')` copy; empty (all buckets empty) → `EmptyStateGuide` with `t('today.empty')` ("Nada para hoje. Bom trabalho!") mine / `t('empty.noEventsToday')` workspace, action → `/calendario`.
- Copy: no em-dashes (user rule); use "·".

CSS (`style.css`, after `.dashboard-hub-row`): `.today-card`, `.today-sub`, `.today-chips`, `.today-chip[aria-pressed=true]`, `.today-chip.is-danger`, `.today-group`, `.today-row` (+hover, dark), `.today-row-title/-context/-who`, `.today-more`. Use legacy tokens (`--card-bg`, `--border-color`, `--text-muted`, `--danger-text`) so dark mode works.

## 4. `DashboardPage.tsx`

- Import new `TodayCard` (no props). Render order: `<TodayCard />` first, then Trial/WhatsApp/Onboarding, then `isAgent ? AgentPendingSection : ClientHealthMonitor`, ImportBanner, FinanceKpiStrip. Remove the `dashboard-hub` wrapper (or keep as `.today-wrap` margin), remove `todayEvents`, `deadlineEvents`, `datasImportantes` queries and now-unused imports (`getWorkflowEtapas`, `getAllClienteDatas`, `useQuery`, `TodayEvent`). Keep `useQueries` batch exactly as is (index-mocked in test).

## 5. i18n (`packages/i18n/locales/{pt,en}/dashboard.json`)

`today.title`, `today.calendar`, `today.summary` ("{{overdue}} atrasados, {{today}} para hoje"), `today.mine` ("atribuídos a você"), `today.buckets.{atrasado,hoje,proximos}`, `today.more` ("+ {{count}} itens · ver todos"), `today.empty`, `today.emptyMine`, `today.taskDone`, `today.taskDoneUndo`, `today.taskDoneError`, `today.awaitingClient` ("Aguardando cliente há {{days}}d"), `today.scheduledAt` ("Agendado {{time}}"), `today.markDone` (aria). Keep existing `cards.today`/`events.*` (still used elsewhere? `events.*` reused for income/expense/birthday context).

## 6. Tests

- `todayAgenda.test.ts` (Vitest, pure; `now` injected, run once with `now = 2026-08-17T23:30` local to prove no midnight/UTC drift): bucketing edges (tarefa due yesterday → atrasado; due today → hoje even at 23:30; +7d → proximos; +8d dropped; no data_limite dropped; bucket and `dueBadge` agree), scope matrix table above enforced kind-by-kind (mine never emits income/expense/birthday/data/aguardando_cliente; workspace never emits post_pendente; post_agendado filtered by membroId in mine), workspace resolves `responsavel`, `waiting_since` ≥3d → atrasado / null → hoje, `canSeeFinancials: 'unknown'/false` → no finance rows, post_agendado with past `scheduled_at` today stays hoje.
- `etapaPrazo.test.ts` (extend existing if present): `etapaDeadlineDateOf` data_limite wins (local day preserved); corridos; uteis skips weekend; not started + no data_limite → null.
- `store/__tests__/posts` (or new): `getAwaitingClientePosts` reduces status events to the latest `enviado_cliente` per post, null when none (mock supabase chain as the existing store tests do).
- `TodayCard.test.tsx`: real `QueryClientProvider` + mocked `../../../../store` and `useAuth` (same pattern as `AgentPendingSection.test.tsx`); asserts: loading while `membershipResolved=false` and **no store fn called**; `workspaceRole:'agent'` never calls `getAwaitingClientePosts`/finance paths; chips toggle groups; Próximos hidden by default; checkbox calls `updateTarefa(id,{status:'concluida'})`, removes row optimistically, and undo restores `em_andamento` when that was the prior status; rows link to correct hrefs; membroMissing copy.
- `DashboardPage.test.tsx`: stub `TodayCard` (`vi.mock('../components/TodayCard')`) like `ClientHealthMonitor`; drop `allClienteDatas`/`calendar-deadlines` branches and the "today events" assertions that relied on them (move that coverage to `todayAgenda.test.ts`); add assertion that `TodayCard` renders before `client-health-monitor`/`agent-pending` in DOM order.

