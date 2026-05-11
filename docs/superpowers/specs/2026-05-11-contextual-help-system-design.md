# Contextual Help System

## Context

New users struggle with non-obvious processes in the CRM. Twelve friction points identified from real support interactions and a systematic audit of the app:

1. **Empty Responsavel dropdown** — users create a fluxo without having added team members first, so the Responsavel dropdown in each etapa is empty with no guidance on how to fix it.
2. **Team members vs workspace users** — users don't understand the difference between membros (for cost tracking/task assignment) and workspace users (CRM login accounts), or how to link them.
3. **Video thumbnail surprise** — users don't know videos require a thumbnail image until after they attempt to upload one.
4. **Post Express prerequisite** — users open Post Express without any Instagram-connected clients, seeing an unexplained empty state.
5. **Instagram warning action links** — token expiry/revocation warnings don't tell users how to fix the issue.
6. **Equipe page agent restrictions** — agent-role users see no explanation for why add/edit/remove buttons are missing.
7. **Configuracao workspace settings** — agent-role users see no explanation for why workspace settings are hidden.
8. **Client Hub section for agents** — agent-role users see no explanation for why the Hub section is missing.
9. **Workflow deadline types** — "Corridos" vs "Uteis" deadline types are not explained.
10. **Lead conversion form clarity** — the conversion dialog doesn't explain that fields were auto-filled from the lead.
11. **Optional field labels** — optional fields (email on leads, cliente on contratos) don't indicate they're optional.
12. **Financeiro CSV categories** — the CSV import tooltip doesn't list valid category values.

The goal is to prevent confusion at the exact moment it would occur, using inline contextual help components.

## Approach

Component-level help — a small set of reusable React components that pages compose inline. No new infrastructure, no database tables, no context providers. Content lives alongside the UI it serves.

## Components

### 1. EmptyStateGuide

Replaces empty dropdowns/lists with a message explaining what's missing and an action link to fix it.

**Props:**
- `icon` — emoji or Lucide icon
- `title` — short heading (e.g., "Nenhum membro cadastrado")
- `description` — explanation text
- `actionLabel` — link text (e.g., "Equipe")
- `actionHref` — internal route to navigate to
- `hint` — optional secondary tip text

**Styling:** Dashed border, light amber background (`rgba(234,179,8,0.06)`), rounded corners (`12px`).

**File:** `apps/crm/src/components/help/EmptyStateGuide.tsx`

### 2. HelpTooltip

Standardized tooltip with richer content than the current `data-tooltip` attributes. Wraps the existing Radix `Tooltip` primitives from `components/ui/tooltip.tsx`.

**Props:**
- `children` — trigger element (defaults to a `?` icon if not provided)
- `content` — tooltip text (string or ReactNode for structured content)

**Styling:** Dark background (`#1c1917`), light text, `8px` border radius, max-width `280px`.

**File:** `apps/crm/src/components/help/HelpTooltip.tsx`

### 3. UploadHint

Small contextual note near file inputs about format or requirements, shown before the user takes action.

**Props:**
- `icon` — emoji or Lucide icon
- `text` — hint message

**Styling:** Light yellow background (`#fefce8`), amber border (`#fde68a`), `8px` border radius, small text.

**File:** `apps/crm/src/components/help/UploadHint.tsx`

### 4. PrerequisiteAlert

Info banner at the top of a form/modal when a required setup step is incomplete. Non-blocking — the user can still proceed.

**Props:**
- `title` — heading (e.g., "Dica: adicione membros a equipe primeiro")
- `description` — explanation text
- `actionLabel` — link text
- `actionHref` — internal route

**Styling:** Light blue background (`#eff6ff`), blue border (`#bfdbfe`), `10px` border radius.

**File:** `apps/crm/src/components/help/PrerequisiteAlert.tsx`

### 5. RoleRestrictionNotice

Centered notice explaining why a feature is restricted for the current user's role. Shown where features would be silently hidden.

**Props:**
- `title` — heading (e.g., "Acesso restrito")
- `description` — explanation text

**Styling:** Light gray background (`stone-50`, dark: `stone-900`), muted border, Lock icon, centered layout. Supports dark mode via Tailwind dark: classes.

**File:** `apps/crm/src/components/help/RoleRestrictionNotice.tsx`

## Integration Points

### #1: Empty Responsavel dropdown

**Files modified:** `apps/crm/src/pages/entregas/components/WorkflowModals.tsx`

1. **PrerequisiteAlert** — rendered at the top of `NewWorkflowModal`, above the etapas list, when `membros.length === 0`. Links to `/equipe`.
2. **EmptyStateGuide** — in `SortableEtapaRow`, replaces the Responsavel `<Select>` dropdown when `membros.length === 0`. Shows explanation, links to `/equipe`, includes a hint clarifying membros vs workspace users.

### #2: Team members vs workspace users

**Files modified:** `apps/crm/src/pages/equipe/EquipePage.tsx`

1. **HelpTooltip** — replaces the existing `data-tooltip` on the Equipe page header. Content explains: membros = people on your team for cost tracking and task assignment; workspace users = accounts with CRM login access; link them via "Vincular Conta CRM" to give a member CRM access.
2. **HelpTooltip** — replaces CSV import `data-tooltip` with richer content including column format.
3. **FormDescription** — in the member add/edit dialog, helper text under the "Conta CRM" select field explaining what linking does.
4. **RoleRestrictionNotice** — for agent-role users, explains that only admins/owners can manage team members.

### #3: Video thumbnail surprise

**Files modified:** `apps/crm/src/pages/entregas/components/PostMediaGallery.tsx`

1. **UploadHint** — rendered below the media upload grid when uploads are enabled. Message: "Videos precisam de uma imagem de thumbnail..."
2. **Improved pending-video alert** — enhanced with heading "Thumbnail necessaria" and descriptive text.

### #4: Post Express prerequisite

**Files modified:** `apps/crm/src/pages/post-express/ExpressPostPage.tsx`

1. **PrerequisiteAlert** — at top of page when `eligibleClients.length === 0`, explaining Instagram setup is needed, linking to `/clientes`.
2. **EmptyStateGuide** — replaces the plain empty state text in the client picker.

### #5: Instagram warning action links

**Files modified:** `apps/crm/src/pages/post-express/ExpressPostPage.tsx`

1. Enhanced warning banner with "Reconectar" action link to `/clientes/{clienteId}` for expired/revoked tokens.

### #6: Equipe page agent restrictions

**Files modified:** `apps/crm/src/pages/equipe/EquipePage.tsx`

1. **RoleRestrictionNotice** — displayed below header for agent-role users explaining that add/edit/remove are restricted to admins and owners.

### #7: Configuracao workspace settings

**Files modified:** `apps/crm/src/pages/configuracao/ConfiguracaoPage.tsx`

1. **RoleRestrictionNotice** — displayed for non-owner/admin users explaining that workspace, Instagram sync, and member management settings are available to owners and admins only.

### #8: Client Hub section for agents

**Files modified:** `apps/crm/src/pages/cliente-detalhe/ClienteDetalhePage.tsx`

1. **RoleRestrictionNotice** — displayed for agent-role users in place of the Hub section, explaining this is owner/admin only.

### #9: Workflow deadline types

**Files modified:** `apps/crm/src/pages/entregas/components/WorkflowModals.tsx`

1. **HelpTooltip** — next to the Corridos/Uteis select explaining: "Corridos = todos os dias do calendario. Uteis = apenas dias uteis (exceto fins de semana)."

### #10: Lead conversion form clarity

**Files modified:** `apps/crm/src/pages/leads/LeadsPage.tsx`

1. **FormDescription** — at top of conversion dialog: "Os dados do lead foram preenchidos automaticamente. Revise e complete os campos abaixo."

### #11: Optional field labels

**Files modified:** `apps/crm/src/pages/leads/LeadsPage.tsx`, `apps/crm/src/pages/contratos/ContratosPage.tsx`

1. Added "(opcional)" to email field label in lead conversion form.
2. Added "(opcional)" to cliente field label in contratos form.

### #12: Financeiro CSV categories

**Files modified:** `apps/crm/src/pages/financeiro/FinanceiroPage.tsx`

1. **HelpTooltip** — replaces `data-tooltip` for CSV import with richer content including column format and the list of valid categories: Mensalidade, Producao, Trafego, Salario, Imposto, Ferramenta, Outro.

### Dashboard empty state

**Files modified:** `apps/crm/src/pages/dashboard/DashboardPage.tsx`

1. **EmptyStateGuide** — replaces plain "Nenhum evento para hoje" with helpful explanation of what populates events: payment dates from clients/members and workflow deadlines.

## File Structure

```
apps/crm/src/components/help/
  EmptyStateGuide.tsx
  HelpTooltip.tsx
  UploadHint.tsx
  PrerequisiteAlert.tsx
  RoleRestrictionNotice.tsx
```

## Verification

1. **Fluxo creation with no members:** Navigate to Entregas, click "Novo Fluxo". Verify PrerequisiteAlert appears at top of modal. Add an etapa — verify EmptyStateGuide replaces the dropdown. Click the Equipe link — verify it navigates correctly.
2. **Fluxo creation with members:** Same flow but with members present. Verify no alerts appear and the dropdown works normally.
3. **Equipe page tooltip:** Visit /equipe, hover the help icon next to the title. Verify tooltip explains membros vs workspace users clearly. Open add/edit member dialog — verify helper text appears under "Conta CRM" field.
4. **Equipe page as agent:** Log in as agent. Verify RoleRestrictionNotice appears explaining restricted access.
5. **Video upload hint:** Open a post's media gallery. Verify the upload hint about video thumbnails is visible below the grid. Upload a video — verify the pending-video alert shows the improved heading and description.
6. **Post Express with no Instagram clients:** Visit Post Express. Verify PrerequisiteAlert and EmptyStateGuide appear.
7. **Post Express with expired token:** Select a client with expired token. Verify warning includes "Reconectar" link.
8. **Configuracao as agent:** Log in as agent. Visit /configuracao. Verify RoleRestrictionNotice for workspace settings.
9. **Client detail Hub as agent:** Log in as agent. Open client detail. Verify RoleRestrictionNotice in Hub section.
10. **Workflow deadline tooltip:** Create a new etapa. Hover the help icon next to Corridos/Uteis. Verify tooltip.
11. **Lead conversion:** Convert a lead. Verify auto-fill description and "(opcional)" label on email.
12. **Contratos form:** Open new contrato. Verify "(opcional)" label on cliente field.
13. **Financeiro CSV tooltip:** Hover CSV import help icon. Verify category list appears.
14. **Dashboard empty state:** Visit dashboard with no events. Verify EmptyStateGuide explains what populates events.
15. **Dark mode:** Verify all components render correctly in dark mode.
16. **Mobile:** Verify all components are readable on mobile viewports.
17. **Typecheck:** Run `npm run build` — no TypeScript errors.
18. **Tests:** Run `npm run test` — no regressions from this feature.
