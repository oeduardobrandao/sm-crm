# Contextual Help System

## Context

New users struggle with non-obvious processes in the CRM. Three specific pain points identified from real support interactions:

1. **Empty Responsável dropdown** — users create a fluxo without having added team members first, so the Responsável dropdown in each etapa is empty with no guidance on how to fix it.
2. **Team members vs workspace users** — users don't understand the difference between membros (for cost tracking/task assignment) and workspace users (CRM login accounts), or how to link them.
3. **Video thumbnail surprise** — users don't know videos require a thumbnail image until after they attempt to upload one.

The goal is to prevent confusion at the exact moment it would occur, using inline contextual help components.

## Approach

Component-level help — a small set of reusable React components that pages compose inline. No new infrastructure, no database tables, no context providers. Content lives alongside the UI it serves. This can evolve into a centralized help system later if needed.

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
- `title` — heading (e.g., "Dica: adicione membros à equipe primeiro")
- `description` — explanation text
- `actionLabel` — link text
- `actionHref` — internal route

**Styling:** Light blue background (`#eff6ff`), blue border (`#bfdbfe`), `10px` border radius.

**File:** `apps/crm/src/components/help/PrerequisiteAlert.tsx`

## Integration Points

### Pain Point 1: Empty Responsável dropdown

**Files modified:** `apps/crm/src/pages/entregas/components/WorkflowModals.tsx`

1. **PrerequisiteAlert** — rendered at the top of `NewWorkflowModal`, above the etapas list, when `membros.length === 0`. Links to `/equipe`.

2. **EmptyStateGuide** — in `SortableEtapaRow`, replaces the Responsável `<Select>` dropdown when `membros.length === 0`. Shows explanation of what membros are, links to `/equipe`, and includes a hint clarifying membros vs workspace users.

### Pain Point 2: Team members vs workspace users

**Files modified:** `apps/crm/src/pages/equipe/EquipePage.tsx`

1. **HelpTooltip** — replaces the existing `data-tooltip` on the Equipe page header (line 189). Content clearly explains: membros = people on your team for cost tracking and task assignment; workspace users = accounts with CRM login access; link them via "Vincular Conta CRM" to give a member CRM access.

2. **FormDescription** — in the member add/edit dialog, add a helper text under the "Vincular Conta CRM" select field explaining what linking does: "Vincular um membro a um usuário do workspace permite que ele acesse o CRM e veja suas atribuições."

### Pain Point 3: Video thumbnail surprise

**Files modified:** `apps/crm/src/pages/entregas/components/PostMediaGallery.tsx`

1. **UploadHint** — rendered below the media upload grid (after the grid, before existing upload queue/pending-video alerts). Always visible when uploads are enabled and `!disabled && !atLimit`. Message: "Vídeos precisam de uma imagem de thumbnail. Você poderá selecioná-la logo após o upload."

2. **Improved pending-video alert** — enhance the existing amber alert box (line 365-381) with a clearer heading ("Thumbnail necessária") and more descriptive text explaining what to do, replacing the current terse message.

## File Structure

```
apps/crm/src/components/help/
├── EmptyStateGuide.tsx
├── HelpTooltip.tsx
├── UploadHint.tsx
└── PrerequisiteAlert.tsx
```

## Verification

1. **Fluxo creation with no members:** Navigate to Entregas, click "Novo Fluxo". Verify PrerequisiteAlert appears at top of modal. Add an etapa — verify EmptyStateGuide replaces the dropdown. Click the Equipe link — verify it navigates correctly.
2. **Fluxo creation with members:** Same flow but with members present. Verify no alerts appear and the dropdown works normally.
3. **Equipe page tooltip:** Visit /equipe, hover the help icon next to the title. Verify tooltip explains membros vs workspace users clearly. Open add/edit member dialog — verify helper text appears under "Vincular Conta CRM" field.
4. **Video upload hint:** Open a post's media gallery. Verify the upload hint about video thumbnails is visible below the grid. Upload a video — verify the pending-video alert shows the improved heading and description.
5. **Dark mode:** Verify all components render correctly in dark mode.
6. **Mobile:** Verify all components are readable on mobile viewports.
7. **Typecheck:** Run `npm run build` — no TypeScript errors.
8. **Tests:** Run `npm run test` — no regressions.
