# Conta demo criada pelo Admin

Date: 2026-10-26
Status: design, awaiting approval

## Intent

We want to hand Mesaas to influencers and to people we want testing the product
without asking them for a card. A platform admin types an e-mail, picks a plan,
and the platform creates a complete workspace owned by that person. It is on
the chosen plan for free, comes **pre-filled with example data** so it looks
like a working agency on day one, and the person receives an e-mail with a
link to set their password, the same experience as someone invited to a
workspace.

When they decide to keep going, they subscribe through the normal checkout and
start paying immediately. The demo ends by itself at that point.

The only product difference between a demo account and a regular account is the
example data and the free plan. Everything else (features, screens, limits of
the chosen plan) is the real product.

## Goals

- Admin action "Criar conta demo": e-mail, plan, optional person name and
  optional agency name. One click creates everything and sends the e-mail.
- The new workspace has the person as **owner**, on the chosen plan, with no
  charge and no end date.
- The workspace is pre-filled with example data: a team member, a client, ideas,
  leads, posts, a fluxo and a calendar event.
- A "conta pronta" e-mail with a "Definir minha senha" button that lands on the
  existing `/configurar-senha` page and then `/dashboard`.
- Demo workspaces are visibly marked "Demo" in the Admin and never count as
  paying (MRR, paying customers).
- An optional **affiliate code** on the demo form, editable later from the
  workspace detail, so a demo that converts pays commission (decided by the
  user, section 8).
- Subscribing from a demo: **no 30-day trial**, charged right away (decided by
  the user). On the first successful payment the workspace switches to the
  purchased plan and stops being a demo, with no admin action.

## Non-goals

- No automatic expiry of the demo. It lasts until an admin changes or removes
  the plan, or the person subscribes. (The user confirmed the no-expiry
  reading.)
- No per-niche or per-influencer example data. One fixed set for everyone.
- No "reset example data" or "delete example data" button. The person edits or
  deletes the examples like any other record.
- No demo for an e-mail that already has a Mesaas account. That is refused.
- No changes to how the normal invite flow (`inviteOrResend`) works.
- No new Admin metrics page for demos (counting conversions etc. can come later).
- No banner or prominent "você está numa conta demo" in the CRM. The only
  in-app signal is a discreet note on the Configurações billing page (section 7,
  decided by the user).

## Anti-goals (would make this a failure even if it technically works)

- A demo user getting a 30-day trial on top of the demo.
- A demo user paying and staying stuck on the demo plan until an admin
  intervenes (the existing comp behaviour, see "Billing" below).
- A failed or abandoned first payment knocking the demo down to Free.
- Example data that looks like a real customer's data, or that triggers real
  side effects (publishing to Instagram, sending e-mails to fake addresses,
  hub notifications).
- A half-created account (user exists, workspace empty, no e-mail) left behind
  silently after an error.
- The e-mail saying "você foi convidado para o workspace X", which is wrong for
  an owner.

## What exists today (facts the design builds on)

- **Workspace creation:** the `auth.users` insert trigger
  `handle_new_user_workspace()` (latest definition in
  `supabase/migrations/20260928000001_workspace_slug_unaccent.sql`) has two
  branches. Without `raw_user_meta_data.conta_id` it is a fresh signup: creates
  `contas` + `workspaces` (name from `meta.empresa`, fallback "Meu Workspace"),
  upserts `profiles` as owner with `onboarding_complete=true`, inserts the
  `workspace_members` owner row, and seeds the "Padrão" workflow template (5
  etapas). With `conta_id` it is the invited branch, which requires a pending
  invite to an existing workspace. **The demo must use the fresh-signup branch.**
- **Invite e-mail:** `_shared/invite-actions.ts` uses
  `auth.admin.inviteUserByEmail` with `data.conta_id` (Supabase's own template)
  for new users, and `generateLink` + Resend (`_shared/invite-email.ts`,
  `buildInviteEmail`, from "Mesaas <convites@mesaas.com.br>") for resends. The
  copy says "convidado".
- **`/configurar-senha`** (`apps/crm/src/pages/configurar-senha/ConfigurarSenhaPage.tsx`):
  without `user_metadata.conta_id` it does a plain `updateUser({password})` and
  redirects to `/dashboard`. That is the path the demo uses.
- **Comp plans:** `platform-admin` `set-workspace-plan` writes
  `workspaces.plan_id` + `plan_source='manual'` and resets
  `workspace_plan_overrides`. `writeWorkspacePlan` (`_shared/plan-writer.ts`)
  skips every write when `plan_source='manual'`. Consequence today: a comped
  workspace that pays stays on the comp plan until an admin runs
  `unset-workspace-plan`. Nothing ever expires a plan that has no subscription
  row (`billing-downgrade-cron` only iterates subscriptions).
- **Trials:** `billing-checkout` and `pagarme-checkout` call
  `resolveTrialDays(hasEverSubscribed(subRow))`; any workspace that never
  subscribed gets 30 days.
- **MRR / paying** is computed from `workspace_subscriptions` only
  (`platform-admin/mrr.ts`, `metrics-logic.ts`), so a workspace with no
  subscription never counts as paying.
- **Existing seed script** `scripts/seed-demo.mjs` (developer CLI) shows the
  required columns for clientes, membros, leads, workflow templates, workflows +
  etapas, ideias. It does not seed posts or agenda events.
- **Welcome lifecycle e-mail** (`lifecycle-email-cron`,
  `get_welcome_email_candidates()`) goes to any confirmed user once. A demo user
  will therefore get our "conta pronta" e-mail now and the normal welcome e-mail
  after they set the password. Accepted: it is the same thing a normal signup
  gets.

## Design

### 1. Data model (one migration)

- Extend the `workspaces.plan_source` CHECK constraint (defined in
  `20260812000001_pagarme_provider.sql`) to allow `'demo'`.
- Add to `workspaces`:
  - `demo_created_at timestamptz null`: set when the admin creates the demo.
    **Never cleared.** This is the durable "was a demo" marker that disables
    the trial forever, even after the demo ends or an admin converts it to a
    comp.
  - `demo_created_by uuid null references auth.users(id) on delete set null`:
    the admin who created it.
- Migration version must sit above `origin/main`'s tail at PR time (today the
  tail is `20261029000003`).

`plan_source='demo'` means "currently in demo". `demo_created_at is not null`
means "was ever a demo".

`is_internal` stays `false`. It gates the Instagram/TikTok sync crons, and a
demo user who connects a real account needs sync.

### 2. Admin backend: `platform-admin` action `create-demo-workspace`

Input: `email` (required), `plan_id` (required), `nome` (optional, person's
name), `empresa` (optional, agency name), `ref_code` (optional affiliate code,
section 8).

Validation:
- E-mail normalised (trim, lowercase) and validated.
- `plan_id` must exist, be active, not be the default/free plan (a demo on
  Free makes no sense and hides the Agenda event) and not be an internal plan
  such as `lifetime` (`isInternalPlan`): those can never be subscribed to from
  the CRM, so the demo could never convert.
- If an `auth.users` row already exists for the e-mail: **409**, Portuguese
  message "Já existe uma conta Mesaas com este e-mail." No deletion, no reuse of
  `inviteOrResend`'s cross-workspace logic.

Steps, in this order:
1. **Create the user without `conta_id`** so the fresh-signup trigger branch
   runs: `auth.admin.createUser({ email, email_confirm: false, user_metadata:
   { nome, empresa } })`, then `auth.admin.generateLink({ type: 'invite',
   email, options: { redirectTo: OAUTH_REDIRECT_BASE + '/configurar-senha' } })`
   for the action link (no Supabase e-mail is sent). `createUser` comes first
   because it is the call that refuses a duplicate: verified on local GoTrue,
   `generateLink type 'invite'` for an existing unconfirmed user returns 200 with
   the same user and a new token, while `createUser` returns 422 `email_exists`
   (and 500 `unexpected_failure` for the loser of two concurrent inserts, which
   the handler maps to 409 after re-checking the e-mail). Defaults: `nome` falls
   back to the trigger's e-mail-prefix rule; `empresa` falls back to "Minha
   agência" (my call, instead of the trigger's "Meu Workspace").
2. Read back the new workspace id (`profiles.active_workspace_id` /
   `workspace_members` owner row for the new user id).
3. **Set the plan before seeding** (the posts limit triggers count against the
   plan): `plan_id = <chosen>`, `plan_source = 'demo'`, `demo_created_at =
   now()`, `demo_created_by = admin.id`, and create/reset the
   `workspace_plan_overrides` row the same way `set-workspace-plan` does. The
   write is a compare-and-set on `demo_created_at is null`: zero rows means
   another request owns the workspace, so the handler answers 409 and does
   **not** roll back. `demo_workspace_discard` also refuses any workspace older
   than one hour or not in demo, so a rollback can never remove a real account.
4. **Seed the example data** (section 4) in **one SQL call**.
5. `insertAuditLog` action `admin-create-demo`, `conta_id` = new workspace,
   metadata `{ email, plan_id }`. From here on the account exists for good.
6. **Send the "conta pronta" e-mail** via Resend with the action link (section 5).

Response: `{ workspace_id, email, email_sent }`. The Admin navigates to that
workspace's detail page.

**Input normalisation:** `nome` and `empresa` are trimmed; blank becomes
omitted, so the handler never passes `""` into the metadata (the trigger uses
`COALESCE`, which would keep an empty string). `empresa` omitted is replaced
by "Minha agência" in the handler before the call; `nome` omitted is left out
so the trigger's e-mail-prefix fallback applies.

**Seeding is atomic.** The seed is a single SQL `SECURITY DEFINER` function
(`demo_workspace_seed(conta_id, owner_user_id)`, `service_role` only). One call
is one transaction, so a seed failure leaves no seed rows behind.

**Failure handling, steps 2 to 4:** roll back with a dedicated SQL function
`demo_workspace_discard(conta_id, user_id)` (`service_role` only) that deletes,
in dependency order, every row the signup trigger and the seed may have
written. The core tenant tables (`clientes`, `membros`, `leads`, `workflows`,
`workflow_templates`, ...) carry `conta_id` **without a foreign key** to
`workspaces`/`contas`, so cascades cannot be relied on; the function names
each table explicitly (trigger rows: `workflow_templates`, `workspace_members`,
`profiles`, `workspaces`, `contas`, plus `workspace_plan_overrides`). Then
delete the auth user. Return a generic 500 ("Não foi possível criar a conta
demo. Nada foi criado."); details are logged internally only. If the discard
itself fails, log CRITICAL with both ids and write the audit row with
`metadata.rollback_failed = true`. *Builder: check the `auth.users` delete
against the FK fixes from #616.*

**Duplicate e-mail, including races:** the pre-check gives the 409, and a
duplicate-user error from Auth in step 1 (two requests racing for the same new
e-mail) also maps to the same 409, not to the generic 500. Nothing has been
created at that point, so there is nothing to roll back.

**E-mail failure (step 6) never rolls back.** Resend is not transactional: a
timeout can happen after the message was accepted, and deleting the account
would leave the person with a link to nothing. So once step 5 is done the
account stays. If the send fails or times out, the response says
`email_sent: false`, the Admin shows "Conta criada, mas o e-mail não foi
enviado. Use Reenviar acesso." and logs it. **"Reenviar acesso"** on the
workspace detail (for demo workspaces whose owner has not set a password yet)
generates a fresh link and sends the same e-mail again. No outbox or retry job.

### 3. Billing behaviour

**While in demo** (`plan_source='demo'`): entitlements resolve from `plan_id`
exactly like a comp. No crons touch it (no subscription row).

**No trial for ex-demos:** `billing-checkout` and `pagarme-checkout` must treat
`workspaces.demo_created_at is not null` as "has subscribed before", so
`resolveTrialDays` returns `undefined` and the person is charged at checkout.
Either extend `hasEverSubscribed` to take the workspace marker or OR it at both
call sites; builder's call, but **both providers** must honour it.
**The CRM must agree.** Today `getWorkspaceSubscription()` derives
`hasEverSubscribed` only from `workspace_subscriptions` (a demo has no row) and
`fetchEffectivePlan()` selects only `plan_id, plan_source`. Select
`demo_created_at` from `workspaces` and fold it into that same
`hasEverSubscribed` contract, so every trial surface follows it: `/comecar`,
Cobrança plan cards, `TrialNudgeCard` and the Pagar.me dialog copy. This holds
even after an admin moves an ex-demo to Free or a comp: no trial UI, ever.

**Leaving demo on payment:** `writeWorkspacePlan` keeps skipping `manual`, and
for `plan_source='demo'`:
- a write coming from a **paid subscription** (status `active`, or `trialing`
  if it ever happens) replaces the demo: `plan_id = purchased plan`,
  `plan_source = 'stripe' | 'pagarme'`. `demo_created_at` stays.
- a write of the **default plan** (from `canceled`, `unpaid`,
  `incomplete_expired`, `paused`) is **skipped**, so an abandoned or failed
  first payment never drops the demo to Free.
- `incomplete` / `past_due` already produce no write (`statusToPlanId` returns
  null), so the demo stays until the payment actually clears.

The function needs to know whether the target is the subscribed plan or the
default fallback; builder decides the signature (e.g. pass the status, or a
`reason`).

There are **two plan writers** and both need the demo rules:
- TS `writeWorkspacePlan`, called by `stripe-webhook`, `pagarme-checkout`
  (step 11) and `pagarme-subscription/handler.ts:350`.
- SQL `grant_pagarme_plan` (migration `20260813000002`), called by
  `pagarme-webhook/handler.ts:174` and `billing-downgrade-cron/handler.ts:118`.
  It only guards `manual` today, so as it stands a canceled or failed Pagar.me
  event would drop a demo to Free. The new migration redefines it with the
  same demo rules: a paid target replaces the demo, a fallback target is
  skipped.

**Paying from the Cobrança page** (decided while writing, reviewer finding):
today `CobrancaPage.renderCta` shows a static "Plano atual" on the current
plan's card and `canUpgradeTo` (`plan-display.ts`) refuses the current plan, so
a demo on Pro would have no button to buy Pro. For `plan_source='demo'`:
- the current plan's card shows an "Assinar" CTA (with the normal monthly /
  annual and 12x choices that card would have for a non-subscriber);
- every other non-free, non-internal plan is purchasable too, cheaper ones
  included. It is a normal first checkout.
- The backend does not block a same-plan checkout, so this is a CRM change only.

**Other `plan_source` sites to update for `'demo'`:**
- `platform-admin/revert-target.ts` / `unset-workspace-plan`: works as for a
  comp (back to the live subscription's plan or the default).
- `platform-admin` `set-workspace-plan` on a demo: becomes a normal comp
  (`manual`). `demo_created_at` stays, so still no trial.
- `pagarme-checkout/handler.ts` around line 180 (switch refuses `manual`) and
  `CobrancaPage.tsx:236` (switch CTA hidden for `manual`): a demo has no
  subscription so the mensal to 12x switch does not apply; make sure `demo`
  does not accidentally pass the switch path.
- `platform-admin/workspace-detail.ts`, `apps/admin/src/lib/api.ts` types, and
  the three Admin badge sites (`WorkspaceDetailDesktop.tsx:140`,
  `PanelsDesktop.tsx:128-131`, `WorkspaceDetailPhone.tsx:88`): show a **"Demo"**
  badge, distinct from "Comp".
- `crisp-sync-cron` forwards `plan_source` as-is; `demo` is a fine value there.
- `apps/crm/src/services/billing.ts` comment/type listing the sources.

MRR and paying metrics need no change (no subscription row). Demo workspaces do
count in Admin "total workspaces" denominators; accepted.

### 4. Example data (my call on content)

Fixed set, Portuguese, fictional, no em-dashes in any copy. Every example
record's name ends in "(exemplo)" so the person knows what to delete. A generic
small business (a coffee shop) keeps it relevant to any social media manager.
Dates are relative to the creation moment.

| What | Content |
|---|---|
| Team member (`membros`, no login, `crm_user_id` null) | "Camila Rocha (exemplo)", cargo "Designer", tipo `freelancer_mensal`. **No `custo_mensal`.** |
| Client (`clientes`) | "Café Aurora (exemplo)", sigla "CA", a brand colour, especialidade "Cafeteria", status ativo. **No `valor_mensal` / `data_pagamento`** (keeps Financeiro v2 mirroring and its guard triggers out of the picture). Fictional contact e-mail on a reserved domain (`contato@cafeaurora.example`). |
| Fluxo (`workflows` + `workflow_etapas`) | From the "Padrão" template the trigger seeds (Copy, Aprovação da Copy, Mídia, Aprovação da Mídia, Agendamento), for Café Aurora, titled "Conteúdo de novembro (exemplo)". Copy and Aprovação da Copy concluídas, **Mídia ativa with Camila as responsável**. |
| Posts (`workflow_posts`) | 4 posts for Café Aurora, attached to the fluxo, platform `instagram`, one each of `carrossel`, `reels`, `feed`, `stories`, with captions and planned dates over the next 2 weeks. No media. Statuses from the canonical editorial set in `workflow_posts_status_check`: `rascunho`, `revisao_interna`, `enviado_cliente`, `aprovado_cliente` (one each). No custom status definitions are seeded. **Never `agendado`, `postado` or `falha_publicacao`**, so no publishing cron ever picks them up. *Builder: check that `enviado_cliente` / `aprovado_cliente` on a post with no Hub token sends nothing (no client e-mail, no notification).* |
| Ideas (`ideias`, uses `workspace_id`) | 3 ideas for Café Aurora: statuses `nova`, `em_analise`, `aprovada`. E.g. "Bastidores da torra do café", "Receita de cold brew em 30 segundos", "Enquete: qual o café da semana?". |
| Leads (`leads`) | 3 leads with statuses `novo`, `contatado`, `qualificado`, origens like Instagram / indicação: "Padaria Trigo Bom (exemplo)", "Studio Pilates Leve (exemplo)", "Ótica Visão Clara (exemplo)". Fictional `.example` e-mails, no phone numbers. |
| Calendar event (`agenda_eventos`) | "Reunião de alinhamento com Café Aurora (exemplo)", next business day + 1 at 10:00 America/Sao_Paulo, 60 min, organizer = the owner. Then `agenda_materializar(evento_id, <~90 days>)` or it never lists. **Only if the chosen plan has `feature_agenda`**; otherwise skipped (no override is granted). No participants and no invites, so no e-mails go out. |

**Fixtures follow the chosen plan.** Inserts enforce plan features
(`feature_leads`, `feature_ideas`, `feature_agenda`, via the feature triggers
in `20260611140003`) and limits (clients, team members, active workflows per
client, leads, posts per workflow). The seed reads the effective plan first and
**omits** a fixture group whose feature is off (no leads without
`feature_leads`, no ideas without `feature_ideas`, no event without
`feature_agenda`), and trims a group to fit a limit lower than its count (e.g.
fewer posts if `max_posts_per_workflow` is below 4). It never grants overrides
and never fails because of the plan. The e-mail copy lists only what was
actually seeded.

Seeding runs as service role, so `auth.uid()` is null. *Builder: check every
insert trigger these tables fire for `auth.uid()` / `get_my_conta_id()`
assumptions, in particular `trg_limit_posts`, `trg_limit_posts_avulsos`,
`workflow_posts_z6_seed_targets`, `z4b_platform_on_insert`,
`trg_guard_clientes_valor`, `trg_guard_membros_custo` and the
`trg_financeiro_v2_*_legado` triggers, and set `user_id` / `organizador_id`
explicitly to the new owner.* No Hub token, no Instagram account, no
contracts or financial records are seeded.

### 5. The e-mail

New builder next to `buildInviteEmail` in `_shared/invite-email.ts`, same
visual template as the other transactional e-mails, sent via Resend from
"Mesaas <convites@mesaas.com.br>".

- Subject: "Sua conta Mesaas está pronta"
- Body (draft): "Olá, {nome}. Criamos uma conta no Mesaas para você testar,
  no plano {plano}, sem custo. Ela já vem com alguns exemplos (um cliente,
  posts, ideias e um evento na agenda) para você explorar. Defina sua senha
  para entrar."
- Button: "Definir minha senha" to the action link.
- Footer note on link expiry, consistent with the invite e-mail.

If the link expires before they use it, the existing "esqueci minha senha" flow
on the login page works (they have a normal account), and the Admin has
"Reenviar acesso" (section 2).

### 6. Admin UI

- **Workspaces page:** a "Criar conta demo" button in `PageHeader`'s `actions`
  (`workspaces/WorkspacesDesktop.tsx`) and `phoneActions`
  (`workspaces/WorkspacesPhone.tsx`).
- It opens a dialog: E-mail, Nome (opcional), Nome da agência (opcional), Plano
  (select from `list-plans`, active non-default plans only). Submit "Criar e
  enviar acesso". Errors inline (409 text above; generic text for 500). On
  success: toast "Conta demo criada. O acesso foi enviado para {email}." and
  navigate to the workspace detail.
- API wrapper `createDemoWorkspace(...)` in `apps/admin/src/lib/api.ts`,
  following `setWorkspacePlan`.
- Workspace detail and the workspaces list show the "Demo" badge. The list
  needs plumbing: `admin_list_workspaces` (latest in
  `20260909000001_admin_list_workspaces_filters_sort.sql`) returns no
  `plan_source`, so the migration redefines it to return `plan_source`, and
  `WorkspaceSummary`, `workspaces-columns.ts` and both list renderings
  (desktop and phone) show the badge.
- Copy in Portuguese, no em-dashes.

### 7. Demo note in the CRM (Configurações)

On the billing page under Configurações (`CobrancaPage`), while
`plan_source='demo'`, a small, discreet line near the plan cards, e.g.:
"Conta demo: você está usando o plano {plano} sem custo. Para continuar depois,
é só assinar um plano." No banner, no modal, nothing elsewhere in the app.
It disappears as soon as the workspace stops being a demo (paid, or changed by
an admin). Copy is my draft; no em-dashes.

### 8. Affiliate code

Attribution today is the `on_auth_user_created_zz_affiliate_referral` trigger,
which reads `ref_code` from the signup metadata and **silently skips** an
unknown or inactive code. That is wrong for an admin form, so the demo flow
does not pass `ref_code` in the metadata. Instead `platform-admin` writes the
`affiliate_referrals` row itself (`workspace_id` PK, `affiliate_id`,
`ref_code`) and validates explicitly:

- **At creation:** before step 1, look up `affiliates` by `code` (normalised
  with the trigger's rule: trim, lowercase, `^[a-z0-9]{4,32}$`) with
  `status='active'`. Unknown or inactive: **400** "Código de afiliado não
  encontrado ou inativo.", nothing created. Same e-mail as the affiliate
  (self-referral): 400 too. The referral row is inserted inside the creation
  steps (before the audit row), so it is covered by the rollback.
- **Later:** new action `set-workspace-affiliate` (`workspace_id`, `ref_code`
  or null) on the workspace detail, available for **any** workspace (not only
  demos), since admins may need to fix attribution in general. Same
  validation. Setting a code upserts the row; clearing it deletes the row.
  Audit-logged (`admin-set-affiliate`, metadata old and new affiliate).
- **Commissions already recorded stay** with the affiliate who earned them
  (`affiliate_commissions` rows are never rewritten). Only invoices paid
  after the change go to the new affiliate. *Builder: check how
  `stripe-webhook` computes the commission window (months per plan) and make
  sure changing the affiliate does not restart that window; if the window is
  anchored on `affiliate_referrals.created_at`, preserve it on update.*
- Admin UI: an "Código de afiliado (opcional)" field in the demo dialog, and an
  "Afiliado" row on the workspace detail showing the current affiliate (name +
  code, link to the affiliate page) with an edit control.
- Reminder from the affiliate program spec: only Stripe payments generate
  commission. A demo that converts via Pagar.me 12x earns none. Unchanged here.

## Constraints

- Edge functions: no raw error details to clients, CORS via
  `buildCorsHeaders`, service role only server-side.
- Platform-admin authorization already enforced by the dispatcher
  (`platform_admins`).
- `clientes` / `membros` column-level grants: seeding writes as service role,
  but any new column read by the CRM must go through the allowlists (none
  planned).
- CI gates: lint, format, the four `tsc` projects, Vitest, `check:functions`,
  `test:functions`, entitlement suites.

## Testing

- Unit (Deno): `writeWorkspacePlan` demo rules (paid write replaces, default
  write skipped, manual still skipped); trial resolution with
  `demo_created_at`; `create-demo-workspace` validation (bad e-mail, unknown /
  default plan, existing e-mail 409, unknown/inactive/self affiliate code 400)
  and rollback on a seed failure; `set-workspace-affiliate` set, change and
  clear.
- Seed: run against local Supabase, assert the counts per table, that no post
  has a publishing status, and that the agenda event lists via `agenda_listar`
  when the plan has `feature_agenda` and is absent when not.
- Vitest: the Admin dialog (validation, plan list filtering, error states) and
  the Demo badge; the CRM hides the trial promise for ex-demo workspaces.
- Manual on staging: create a demo, receive the e-mail, set the password, land
  on `/dashboard` with the examples visible; subscribe via Stripe test mode and
  check there is no trial, the plan switches and the Demo badge disappears.

## Rollout

Per the house rule (merge deploys the frontend immediately):
1. Migration on staging, then prod.
2. Deploy `platform-admin`, `mcp-admin` (it bundles the `get-workspace`
   handler), `billing-checkout`, `pagarme-checkout`, `pagarme-subscription`,
   `pagarme-webhook`, `stripe-webhook` and `billing-downgrade-cron` to staging,
   then prod. **Hard dependency:** both checkouts, `platform-admin` and
   `mcp-admin` read `workspaces.demo_created_at` and fail closed, so deploying
   any of them before the migration makes every checkout (and the Admin
   workspace detail) answer 500.
3. Merge (CRM + Admin go live).

The new backend tolerates the old frontend (the action is only called by the
new Admin), and the old backend never sees `plan_source='demo'` because only
the new action creates it.

## Left to the builder

- `writeWorkspacePlan` signature change.
- `generateLink type 'invite'` vs `createUser` + recovery link (verify which
  fires the trigger).
- Exact post captions, statuses within the allowed editorial set, brand colour.

## Calls made by Claude (for the user to check)

- Example content: coffee shop client "Café Aurora", designer "Camila Rocha",
  every record tagged "(exemplo)".
- Default agency name "Minha agência" when the admin leaves it blank.
- Free/default plan and internal plans (e.g. `lifetime`) not offered for demos.
- On the Cobrança page a demo user can buy their current plan ("Assinar" on
  that card) or any other paid plan, cheaper ones included.
- Agenda event skipped (not forced on) when the chosen plan lacks the Agenda.
- New `plan_source='demo'` plus a permanent `demo_created_at` marker, instead of
  reusing the "Comp" (`manual`) source.
- Existing e-mail refused instead of attaching a demo to an existing account.
- On a creation error before the account is complete, everything is rolled
  back; an e-mail failure after that keeps the account and offers "Reenviar
  acesso".
- Example fixtures a plan does not include are left out, never forced on.
- Demo note wording on the Configurações billing page.
- The affiliate code is validated loudly (400) instead of the signup trigger's
  silent skip, and the later edit works on any workspace, not only demos.
- Changing a workspace's affiliate never moves commissions already recorded.
- Demo users also get the normal welcome lifecycle e-mail after setting the
  password.
