# Workspace Invite Inside the Membro Form

**Date:** 2026-07-31
**Status:** Approved design, validated in a static mock (4 dialog states); ready for implementation
**Branch:** `claude/team-workspace-member-clarity-f25513`

## Problem

Users don't understand the difference between a **membro da equipe** (a row in `membros`: nome, cargo, custo — no login, no seat) and a **membro do workspace** (an auth user occupying a `max_team_members` seat, invited from Configurações → Workspace). The KB article only covers adding a team member. The result: people add a membro on the Equipe page and expect that person to be able to log in.

## Goal

Let owners/admins optionally invite a person to the workspace **from the same dialog** where they add/edit a membro, with a visual seat indicator, and auto-link the resulting account to the membro when the invite is accepted. Adding a membro without an invite (no seat used) stays the default path.

## Non-goals

- No reverse flow (creating a membro from Configurações → Workspace's invite modal).
- No resend/cancel invite controls inside the membro dialog — those stay in Configurações → Workspace.
- No email column on `membros` (avoids the column-grant allowlist machinery).
- No changes for the `agent` role (they can't add/edit membros today; unchanged).

## Current state (verified)

- `membros`: `apps/crm/src/store/team.ts` — `addMembro` inserts and returns `void`; reads go through `membros_v`; columns are allowlisted (`MEMBRO_SAFE_COLUMNS`). `crm_user_id` links a membro to a workspace user, settable via the `set_membro_crm_user` RPC (owner/admin).
- Workspace invites: `supabase/functions/invite-user/index.ts` → `inviteOrResend()` in `_shared/invite-actions.ts`. Seat pre-check counts `workspace_members` + pending `invites` (excluding a pending row for the same email) against `max_team_members` (`effectivePlanLimit`). Outcomes: `invited` / `reinvited` / `resent-link` / `added` (existing user added instantly, invite row written as `accepted`) / `already-member` / `plan-limit-exceeded` / `blocked-anomalous`.
- Acceptance: invited user sets a password on `/configurar-senha`, which calls `manage-workspace-user` `action: 'accept-invite'` → Postgres RPC `accept_workspace_invite(p_user_id)` (creates the `workspace_members` row, marks the invite `accepted`).
- Limits in UI: `useWorkspaceLimits()` exposes `limits.max_team_members` (null = unlimited). `EquipePage` already queries `getWorkspaceUsers()` for the "Conta CRM" select. `MembrosTab` reads `invites` directly from the client (RLS permits owner/admin).

## UX design (validated in mock)

The Adicionar/Editar Membro dialog gains an **"Acesso ao CRM"** section below a divider, visible to owner/admin only, with four states:

1. **Add, switch off (default).** Switch "Convidar para o workspace" off. Hint copy: without an invite the membro serves for costs/assignments but cannot log in; you can invite later. Seat meter always visible: progress bar + "3 de 5 vagas do plano usadas · 2 restantes". Unlimited plans (`max_team_members: null`): no meter, switch always enabled.
2. **Switch on.** Email (required) + Função no workspace (Admin/Agente, default Agente). Hint: the person receives an email invite, **occupies 1 seat**, and their account is linked to this membro automatically on accept. Meter previews post-invite usage ("4 de 5 vagas após este convite"). Submit button label changes from "Salvar" to **"Salvar e convidar"**.
3. **Seats full.** Switch disabled, meter full (danger color), inline notice: membro can still be saved; to invite, upgrade the plan or remove a user. Reuse upgrade copy patterns from `lib/entitlement-errors.ts`.
4. **Edit with pending invite.** The section collapses into a notice: "Convite pendente para x@y (função) · expira em Nd Nh", pointing to Configurações → Workspace for resend/cancel. Edit with linked account: today's "Conta CRM" select, unchanged. Edit with no link and no pending invite: same section as add mode.

**Equipe card badge:** a membro with a pending invite shows "convite pendente" (warning tone) instead of "sem conta vinculada".

## Data model

New migration (version prefix must be re-verified against `origin/main`'s tail at PR-open time):

```sql
alter table public.invites
  add column membro_id bigint references public.membros(id) on delete set null;

-- accept_workspace_invite: after creating the workspace_members row and
-- marking the invite accepted, when invite.membro_id is not null:
update public.membros m
   set crm_user_id = p_user_id
 where m.id = v_invite.membro_id
   and m.conta_id = v_invite.conta_id
   and m.crm_user_id is null;
```

Notes:

- `on delete set null`: deleting the membro before acceptance degrades the invite to a plain workspace invite (no link on accept). Correct and silent.
- The update is guarded by `crm_user_id is null` so a manual link done in the meantime wins.
- `invites` is not under the column-grant allowlist (only `membros`/`clientes` are); client reads of `invites` use `select('*')` under RLS and will simply see the new column.

## Backend changes

`invite-user` (POST):

- Accept optional `membroId` (number) in the body.
- Validate before calling `inviteOrResend`: the membro exists, `conta_id` matches the caller's `profile.conta_id`, and `crm_user_id` is null. Invalid → 400 with a generic message (no detail leakage).
- Pass `membroId` into `inviteOrResend` (new optional field on `InviteOrResendInput`); every invite-row insert/update stamps `membro_id`.
- `added` route (existing user, no acceptance step): set `membros.crm_user_id` immediately via the admin client, same `is null` guard.
- The CRM-side callers that don't send `membroId` (MembrosTab, resend) are unaffected; `platform-admin` resend path passes nothing.

Deploy: `npx supabase functions deploy invite-user --use-api` + `npx supabase db push --linked` (staging first).

## Frontend changes

`store/team.ts`:

- `addMembro` returns the created `Membro` (it already does `.select(MEMBRO_SAFE_COLUMNS).single()`; change `void` → `Membro`). **Contract change:** grep `apps/**/__tests__` and `supabase/functions/__tests__` for callers/mocks of `addMembro` and update.

`EquipePage.tsx`:

- New queries (owner/admin only): pending invites for the workspace (`from('invites')`, `status = 'pending'`, non-expired — reuse `computeEffectiveInviteStatus`) and `useWorkspaceLimits()`. Seat usage = `workspaceUsers.length + pendingInvites.length`.
- Form schema gains `inviteEnabled: boolean`, `inviteEmail: string` (required valid email when enabled), `inviteRole: 'admin' | 'agent'` (default `'agent'`).
- Submit orchestration: save membro first (add returns the row; edit already has the id), then when `inviteEnabled`, POST `invite-user` with `{ email, role, membroId }` (same fetch pattern as MembrosTab). Invalidate `membros`, `workspace-users`, and the invites query.
- A small seat-meter subcomponent + a pure helper for the seat math (`used`, `limit`, `remaining`, `isUnlimited`, `isFull`) in `pages/equipe/` or `pages/configuracao/inviteHelpers.tsx` — shared with nothing today, but keep it pure for tests.
- Card badge: map `membro.id` → pending invite via the invites query; render "convite pendente" instead of "sem conta vinculada".

## Error handling

Membro save and invite are two operations, deliberately not atomic:

- Membro save fails → nothing else runs (today's behavior).
- Membro saved, invite fails → membro stays; toast: "Membro salvo, mas o convite falhou: <reason>". `plan_limit_exceeded` (seat race) gets the friendly limit message from `entitlement-errors.ts`; `already-member` shows the server message and the user can link manually via "Conta CRM". Retry is just reopening the membro in edit mode.
- Invite success reuses `inviteSuccessMessage()` so the three server outcomes (invited / link resent / added directly) stay distinguishable. The `added` outcome means the membro is already linked — the card shows no pending badge, correctly.

## Analytics

`captureEvent('invite_sent', { source: 'equipe' })` on success; MembrosTab's existing call gains `source: 'configuracao'` so the two flows are distinguishable.

## Testing

- **Vitest:** seat-math helper (limit null / 0 remaining / normal); invite-section states (off/on/full/pending/linked — rendering-level); submit orchestration (invite failure still saves membro, correct toasts); `addMembro` return-shape updates in existing suites.
- **Deno (`supabase/functions/__tests__`):** `invite-user` rejects `membroId` from another conta and already-linked membros; invite row stamped with `membro_id`; `added` route links immediately; callers without `membroId` unchanged.
- **RPC:** `accept_workspace_invite` linking covered by a migration-level test if the suite supports it; otherwise verified on staging (invite → accept → `crm_user_id` set; second accept idempotent).
- **Browser:** verify the four dialog states and the card badge in the running CRM (`npm run dev:staging`), light + dark.

## Rollout

1. Migration to staging (`db push --linked` after confirming link target via `supabase/.temp/project-ref`), deploy `invite-user`, E2E the four states + accept flow on staging.
2. Prod: migration + function deploy, then merge for Vercel.
