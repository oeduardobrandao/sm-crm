# Financeiro v2: rentabilidade por cliente

Status: design, awaiting approval. Mockups: https://claude.ai/artifact/4UYPydavKfJwzVBMaT3UWv

## Why

Agencies on Mesaas run their real finances in a spreadsheet. The owner's own agency keeps
one row per client with MRR, ARR, monthly cost, profit, annual profit, margin, and then the
cost of each role (videomaker, design, edição de vídeo, gestão de projetos, copy). Every
number in it is derived by hand from two facts: what each client pays, and what each team
member costs and which clients they serve. A designer paid R$ 3.900 who serves all 15
clients costs each client R$ 260. Talitha lives in São Paulo, so a second videomaker is
hired just for her and all of that person's R$ 550 lands on her row.

Mesaas already knows the clients, the fees (`clientes.valor_mensal`) and the team
(`membros.custo_mensal`). What it does not know is who serves whom, what each person agreed
to deliver, and how the numbers looked last month. This project teaches it those three
things so the spreadsheet computes itself, and stays right as people and clients change.

The goal the owner stressed above all: **easy to use**. Assign people once, read the
numbers; no formulas, no duplicated columns.

## Goals

- Per-client profitability computed automatically from fees, team agreements and
  assignments, with the cost broken down by função.
- Team agreements that fit how agencies actually pay: monthly with a delivery goal,
  monthly with a client limit, or per delivery; with the signed contract attached.
- Recurring income (client fees) and one-off income (avulsos) modelled separately.
- Fixed costs (tools, rent, taxes) supported, either split across clients or kept at the
  agency level, chosen per workspace.
- History that never shifts: changes apply from a date forward, and closed periods are
  frozen snapshots.
- A configurable financial period start day (1st to 1st, 15th to 15th, ...).
- A delivery helper that estimates what each person delivered against their goal.
- Everything behind a feature flag, off by default.

## Non-goals

- Accounting, invoicing, nota fiscal, bank reconciliation, payroll.
- Paying team members or charging clients (no Stripe/Pagar.me money movement).
- Weighted or hour-based cost splits (see "Later").
- Non-monthly period lengths (weekly, fortnightly).
- Replacing the current Financeiro cash ledger (`transacoes`); v2 sits beside it.

## Anti-goals (would be failure even if it technically works)

- A screen that looks like a spreadsheet but makes the user type the derived numbers.
- Past months changing because someone edited a salary or removed an assignment today.
- The delivery estimate presented as fact, or feeding pay, cost or margin.
- Team members without financial visibility seeing anyone's pay or any client's fee.
- Breaking or changing the current Financeiro for workspaces without the flag.

## Concepts and rules

### Função

A workspace-level list of roles (Videomaker, Design, Edição de vídeo, Copy, Gestão de
projetos, ...), editable by the workspace. Seeded with those five defaults. Each member has
at most one função (today `membros.cargo` is free text; see "Existing data"). Funções are
the cost columns of the profitability table, in the workspace's order.

"Sem função" is a valid persisted state. A member without a função has no matrix column and
no client allocation; their cost counts under "Custo sem cliente" in the totals, and the
matrix shows a banner listing them with a "Definir função" action.

### Acordo (team agreement)

Each member has an acordo. Three models, picked as cards ("Como essa pessoa é paga?"):

| Model | Pay | What was agreed |
|---|---|---|
| Mensal com meta | fixed monthly amount | a delivery goal: N units per period (`8 artes por dia útil`, `2 vídeos por dia útil`) |
| Mensal com limite | fixed monthly amount | serve up to N clients at once |
| Por entrega | an amount per unit | nothing fixed; cost is units delivered × amount |

Plus: payment day (drives the existing projected "saída agendada"), CLT/freelancer type
(already on `membros.tipo`), vigência, and an attached contract file (PDF). Units are a
short list (arte, vídeo, gravação, post, ...) the builder may make editable.

### Atribuição (who serves which client)

A member ↔ client link. This is the core new fact. Two places edit it:

- **Equipe por cliente** matrix (clients × members grouped by função, checkboxes). The fast
  path for an agency setting up 15+ clients at once. Ticking updates cost and margin live.
- **Cliente › Financeiro**: "Equipe neste cliente", one row per função, pick/trocar person.

A member appears only under their own função. A client may have several people in the same
função; each one's share is added to that função's column.

"Mensal com limite" members show `15 de 20` in the matrix footer and warn when over limit.
The warning does not block the save.

### Cost allocation

- **Even split** (my call, confirmed by the owner's numbers): a monthly-paid member's cost
  for a period is divided equally among the clients assigned to them in that period.
  `3.900 ÷ 15 = 260`. A member assigned to one client puts their whole cost on that client
  ("Só este cliente" badge).
- **Por entrega** members: cost for a client = units delivered for that client × amount.
  The quantity per client per period is entered by hand ("Quantas entregas para cada
  cliente?", on the member's Acordo and in the period). Until entered, the cell shows
  "a informar" and the cost counts as zero, flagged in the KPI sub-line. Phase 3's delivery
  helper only pre-fills these quantities; a person still confirms. (My call; the owner did
  not decide this explicitly.)
- **Members with no assignments** count toward agency cost but no client's margin. The
  table shows them as "Custo sem cliente" in the totals so the totals still reconcile.
- **Mid-period changes**: an assignment or pay change takes effect at the start of the
  period chosen in "Vale a partir de"; no pro-rating inside a period. (My call: simpler to
  read, and matches how the owner's sheet works.)

### Fixed costs

A list of agency fixed costs: name, category (ferramenta, imposto, aluguel, outro), and an
amount that is either fixed (`R$ 450`) or a percentage of revenue (`6% da receita`).
Percentage costs apply to recurring revenue for the period.

Workspace setting **"Ratear custos fixos entre os clientes"**:

- **Off** (default, matches the owner's sheet): client margin is team cost only. The
  overview shows `Lucro da agência = lucro dos clientes − custos fixos`.
- **On**: fixed amounts are split evenly across active clients; percentage amounts apply to
  each client's own fee. Shown as one extra cost column, "Custos fixos".

### Income

- **Recorrente**: the client's monthly fee, from the client (today `clientes.valor_mensal`
  and `data_pagamento`), effective-dated like everything else. MRR and margin use only this.
- **Avulso**: a one-off service for a client: title, amount, due date, status (a receber /
  pago). Optionally split into installments (parcelas) with their own due dates (builder's
  call on whether v1 needs installments). Counts in the period's cash and the overview's
  "Avulsos do período", never in MRR or recurring margin.

### Accrual, not cash

Profitability uses **contracted** amounts for the period (confirmed by the owner): Talitha's
R$ 2.500 counts in October even if she pays late. Late or missing payments show separately
as "a receber" (overview KPI and a flag on the client), so a late payer does not look
unprofitable. Cash reality stays in the existing ledger.

Today's "agendado" entries are virtual and exist only for the current calendar month, so
they cannot carry "a receber" across periods. v2 therefore stores one **mensalidade** record
per client per financial period (amount from the effective fee, due date from the payment
day, status a receber / pago, and a link to the `transacoes` row once paid). Confirming a
payment in the ledger, the calendar or the client tab marks it paid and creates or links
the `transacoes` row, which then carries `cliente_id` (no writer sets it today). Avulsos and
their parcelas use the same record shape. Team payouts stay as today's projected saídas.
(Phase 2; my call on the shape.)

- Confirming in the ledger stays the "paid" signal. With v2 data, a client's projected
  entrada comes from the mensalidade record (`referencia_agendamento = mensalidade_{id}`),
  not the calendar-month key, so a day-15 period maps cleanly. Unpaid past mensalidades stay
  listed as "a receber" in Lançamentos and the client tab, so they can still be confirmed.
- A paid avulso creates its `transacoes` row through the same link; it is never typed twice.
  A manual Lançamento with category Mensalidade or for a client with an open avulso of the
  same amount gets a "Isso é a mensalidade de X?" hint that links them instead of double
  counting. (My call.)

### Periods

- Workspace setting **"O período financeiro começa no dia __"**, 1 to 28, default 1.
  Period length is always one month. Labels read `out 2026` when the day is 1, otherwise
  `15 out a 14 nov`.
- Every v2 screen, the period picker and snapshots follow this setting.
- Changing the start day affects future periods only; closed periods keep their bounds.

### Effective dates and snapshots

- Every change to an acordo, assignment, client fee, fixed cost or client status asks
  "Vale a partir de" and defaults to the current period. Past periods never change.
- When a period ends it is **closed automatically**: its computed figures (per client, per
  função, per member, fixed costs, totals, and who served whom) are stored as a snapshot.
  Closed periods render from the snapshot, not by recomputing.
- "Reabrir período" (owner/admin only, confirm dialog) unfreezes a closed period so a
  mistake can be fixed; it re-closes with fresh figures. Reopening is audit-logged.
- The current period is always computed live.

Rules for the close job and edits (my calls):

- Periods close at 00:00 America/Sao_Paulo on the first day of the next period (the same
  default timezone the analytics RPCs use).
- Closing is idempotent: closing an already-closed period is a no-op, a late run closes
  every ended open period in order, and a failed close leaves the period open to retry (one
  transaction per period).
- "Vale a partir de" offers the current period, future periods and any reopened period;
  never a closed one.
- A change made from a reopened period flows forward to later periods that are open. Later
  closed periods keep their snapshots until they are reopened too, and the UI says so ("Os
  períodos seguintes já fechados não mudam").
- A reopened period closes again only by its "Fechar período" button; the automatic job
  skips reopened periods.
- At close, por-entrega quantities still "a informar" freeze as zero and the snapshot is
  marked "custo incompleto" (shown on the period and its rows). Reopening fixes it.

### Paused and ended clients (my calls)

- **Pausado**: no fee for that period (no mensalidade), and the client is left out of every
  even split and the fixed-cost rateio while paused. Assignments are kept for when it
  resumes. Shown in the table greyed with "Pausado", no margin.
- **Encerrado**: ends all its assignments from the effective period on; drops out of splits.
- "Active clients" for any split = status ativo in that period.

### Changing the period start day (my call)

The onboarding card asks for the start day up front, so most agencies never change it.
A later change takes effect after the period in progress: the next period is a short
"período de transição" up to the new start day, with fees and monthly costs pro-rated by
days. From then on periods are a full month again.

### Delivery helper

A helper, not a source of truth (the owner's words: game changer, but worried about
accuracy).

- Next to a member's goal, show an estimate: "142 artes estimadas de 176".
- Clicking it lists exactly what was counted (post, client, date, stage), so mistakes are
  visible: wrong responsável, a post sent back for correction, a duplicated stage.
- Labeled as an estimate everywhere ("estimativa", "Ideia" badge in the mockups).
- Never moves money on its own: it does not change cost, margin or pay. For "por entrega"
  members it pre-fills the suggested amount that a person confirms.
- Source (my guess, builder to validate against real data): Entregas items where the member
  is `responsavel_id` and the relevant stage was completed inside the period. Candidate
  tables: `workflow_posts.responsavel_id`, `workflow_etapas` responsável, `tarefas`. How a
  stage maps to a unit (arte vs vídeo) is open; post type (feed/carrossel/reels/stories) is
  the obvious first mapping.

## Screens

All in the mockups canvas. pt-BR, sentence case, no em dashes in UI copy.

Navigation today: `/financeiro` is a single ledger page with no tabs, client finance is
`/clientes/:id/financeiro`, contracts are `/contratos`. With the flag on, `/financeiro`
gains a tab bar: Visão geral, Rentabilidade, Lançamentos (today's ledger, unchanged),
Receitas avulsas, Custos da equipe. With the flag off, the route renders today's page with
no tab bar. Contratos stays its own route.

1. **Financeiro › Rentabilidade**. KPIs: receita recorrente (with ARR), avulsos do período,
   custo da equipe, lucro recorrente (with LL anual), margem média vs meta. Table: cliente,
   receita, custo, lucro, margem, then one column per função; Mensal/Anual toggle replaces
   the sheet's duplicated ARR / LL anual columns; sorted by margem ascending; rows under the
   workspace's **meta de margem** (setting, default 55%) get an "Abaixo da meta" badge. A
   side panel explains the selected client's cost line by line ("R$ 3.900 ÷ 15 clientes").
   CSV export.
2. **Equipe por cliente** matrix (described above).
3. **Cliente › Financeiro** tab: KPIs, Equipe neste cliente, mensalidades by period with
   status, contrato, receitas avulsas.
4. **Equipe › membro › Acordo**: model cards, função, valor, dia de pagamento, goal or
   limit, contract file, clientes atendidos with per-client share, capacidade (helper).
5. **Phone**: Rentabilidade as a card list with a cost/profit bar per client. Dark mode
   everywhere.
6. Settings (not mocked): funções, período start day, meta de margem, custos fixos list,
   rateio switch.

Tabs that the mockups show but do not detail, defined here (my calls):

- **Visão geral** (phase 2): the period's KPIs plus a 12-period trend of receita, custo and
  lucro read from snapshots, and the "a receber" list. Until phase 2 the tab bar opens on
  Rentabilidade.
- **Receitas avulsas** (phase 2): list of avulsos and parcelas across clients, filter by
  status, "+ Receita avulsa".
- **Custos da equipe** (phase 1): one row per member with função, model, cost, number of
  clients and per-client share; links to each Acordo. The fixed costs list joins it in
  phase 2.
- Member page **Pagamentos** tab: today's MembroDetalhe transactions, moved under a tab.
- Client **Contrato** card reuses the existing `contratos` rows for that client (plano is
  `clientes.plano`). The mockup's "Reajuste" field is illustrative and out of scope. A file
  on client contracts uses the same private file mechanism as acordos (phase 2).

## Constraints

- **Feature flag.** New plan column `feature_financeiro_v2 boolean NOT NULL DEFAULT false`,
  enabled per workspace through `workspace_plan_overrides.feature_overrides`
  (`{"feature_financeiro_v2": true}`), same pattern as `feature_hub_pauta` /
  `feature_agenda` (migration `20261012000001_feature_hub_pauta.sql`). Launch = turn the
  column on in plans. The flag must be added to `supabase/functions/_shared/entitlements.ts`
  (plan columns' single source; a new flag means redeploying the functions that read it)
  and read in the CRM through `useWorkspaceLimits`. Flag off: today's Financeiro, Equipe and
  Cliente › Financeiro render exactly as now.
- **Plan gating stays, and is enforced in the database.** `feature_financial` still gates
  the whole area; v2 requires both flags. Like `transacoes` (insert triggers in
  `20260611140003_feature_triggers.sql`), every new v2 table and RPC fails closed in the
  database when either flag is off, so direct PostgREST calls cannot bypass the rollout.
  Hiding the UI through `useWorkspaceLimits` is not enough on its own.
- **Tenant integrity.** Every new reference (member, client, função, acordo, assignment,
  snapshot, mensalidade, attachment) must belong to the same `conta_id`, enforced with
  composite foreign keys on `(id, conta_id)` or explicit `WITH CHECK` ownership tests, as the
  existing tenant-safe child tables do (e.g. `20260903000002_workspace_roles_a_additive.sql`).
  A plain FK to `membros(id)` would allow a cross-workspace assignment.
- **Contract files.** Private storage only, readable by those with financial visibility;
  PDF or image, size limit set by the builder (around 10 MB); replacing a file keeps the old
  one attached to the past acordo version; deleting a member's acordo does not orphan files.
  There is no file storage for contracts today (`contratos` holds metadata only). Storage
  mechanism is the builder's call.
- **Financial visibility.** Pay, fees, costs, margins and snapshots are visible only where
  `can_see_financials()` / `canSeeFinancials` allows (migrations `20260728000001/2`,
  `20260904000002`). Assignments without amounts (who serves whom) may be visible more
  broadly; the builder decides, defaulting to the same restriction.
- **Column grants.** `membros` and `clientes` use column-level `GRANT SELECT` allowlists
  (`20260728000002`). New data should live in new tables with their own RLS rather than new
  columns on those two; any column that must go on them needs the grant, the `_v` views and
  the `*_SAFE_COLUMNS` constants updated.
- **One source of truth.** With the flag on, v2's effective-dated fee and acordo are
  authoritative. Every v2 change effective in the current period writes the current value
  through to `clientes.valor_mensal` / `data_pagamento` and `membros.custo_mensal` /
  `data_pagamento`, so `projetarAgendamentos` (`store/computed.ts`), the calendar layer and
  any other reader keep working unchanged. A future-dated change writes through when its
  period starts (done by the same job that closes periods). While the flag is on, editing
  those legacy fields from the old forms (ClienteEditDialog, membro form) goes through v2
  instead, asking "Vale a partir de". Already materialized `transacoes` rows are left as
  they are. (My call.)
- **Other legacy writers.** ClientesPage, lead conversion (LeadsPage), the Equipe dialogs
  and the MCP tools (`supabase/functions/mcp/tools.ts`) also write those columns. Rather
  than chase every caller, a database trigger turns any write to `valor_mensal` /
  `custo_mensal` / `data_pagamento` into a v2 change effective from the current period. It
  runs whenever the workspace has v2 data, flag on or off, so turning the flag off and on
  again never leaves the two copies drifting. v2 data is kept when the flag goes off; the
  seed never runs twice. (My call.)
- Migration filenames need unique version prefixes; follow repo CI gates.

## Existing data

Turning the flag on (by override or plan-wide) fires no event, so seeding is an explicit
step. The first time someone with financial visibility opens a v2 screen in a workspace
that has no v2 data, they see a short onboarding card, "Montar a partir dos dados atuais",
that runs the seed. The seed is one idempotent, transactional operation: running it twice
or after a failure produces the same result, and a failure leaves nothing half-written.
Until it runs, v2 screens show only that card. (My call; it also lets the agency look at
what will be imported before committing.) It seeds:

- Client fee and payment day from `clientes.valor_mensal` / `data_pagamento`.
- Acordo "Mensal com meta" (no goal set) from `membros.custo_mensal` / `data_pagamento` /
  `tipo`.
- Função: suggest from `membros.cargo` text (exact or fuzzy match to the defaults); unmatched
  members land in a "Sem função" state that the matrix asks the user to fix.
- No assignments exist today; the matrix opens with a one-line prompt and a "Marcar todos"
  per member column (most small agencies have everyone on everything).
- Effective-from for seeded data: the start of the current period. No backfilled history.

## Phasing (my call)

1. **Core**: flag, funções, acordos (all three models, por entrega with manual quantities;
   contract file), atribuição
   (matrix + client tab), even-split allocation, Rentabilidade tab, period start day,
   effective dates, auto-close snapshots, reabrir. Seed from existing data.
2. **Income and fixed costs**: mensalidade records per period linked to `transacoes`,
   avulsos (with or without parcelas), fixed costs list with
   fixed/percentage amounts, rateio setting, meta de margem, "a receber" flags.
3. **Delivery helper**: estimates, drill-down list, por-entrega suggested amounts with
   confirmation.

## Later

Weighted splits (e.g. by posts or hours per client), non-monthly periods, capacity-aware
"does a new client fit?" simulator, alerts when margin or capacity crosses a threshold.

## Left to the builder

Table shapes, how snapshots are stored, the close job (pg_cron vs edge cron), unit list
editability, whether assignment visibility is broader than financial visibility, exact
copy, where settings live in Configuração, mobile behaviour of the matrix.
