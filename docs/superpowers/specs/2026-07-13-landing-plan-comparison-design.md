# Landing Plan Comparison — Design Specification

## Context

The landing-page pricing cards now load the active public plans from the Admin configuration when the pricing section approaches the viewport. Each card intentionally shows only price, Clients, and Users.

Plan features should move to a dedicated comparison section below the cards. The purpose is to help visitors evaluate the offer without making the cards dense or adding meaningful work to the landing page's initial load.

The current Admin configuration enables the same feature flags for Start, Pro, and Max. Their meaningful differences are primarily quantitative limits. The comparison therefore combines a curated feature set with selected operational limits while remaining faithful to the Admin data.

## Goals

- Add a concise plan-comparison section immediately below the pricing cards.
- Keep the pricing cards limited to Clients and Users.
- Read all displayed values from the same Admin-backed public plan query used by the cards.
- Make differences easy to scan on desktop and mobile.
- Preserve deferred loading near the pricing section and avoid a second request.
- Provide a direct subscription action after the comparison.

## Non-goals

- Display every limit or feature flag stored in the `plans` table.
- Add plan-specific marketing copy management to Admin.
- Change checkout, authentication, billing intervals, or subscription routing.
- Change the current plan definitions or feature entitlements.
- Expose the internal Lifetime plan.

## Considered Approaches

### 1. Curated comparison matrix — selected

A compact matrix compares all public plans in aligned columns, with rows grouped into capacity and features. This supports direct comparison and keeps the page focused.

### 2. Feature groups by customer outcome

Marketing-oriented blocks could explain benefits such as planning, approvals, and analytics. This would be easier to read as editorial content but less precise for plan-to-plan comparison.

### 3. Separate feature list for each plan

Cards below the pricing section could show each plan's complete feature list. This works on narrow screens but repeats content and recreates the density removed from the pricing cards.

## Content and Information Architecture

The section appears inside the existing pricing section, after the pricing-card grid. It uses the heading **“Compare os planos”** and a short sentence explaining that values reflect the current plan configuration.

The matrix has four public plan columns in Admin order and 11 curated rows:

### Capacity

1. Contas do Instagram — `max_instagram_accounts`
2. Armazenamento — `storage_quota_bytes`
3. Templates de fluxo — `max_workflow_templates`
4. Portais do cliente — `max_hub_tokens`

### Features

5. Relatórios e analytics — `feature_analytics_reports`
6. Agendamento de posts — `feature_post_scheduling`
7. Leads — `feature_leads`
8. Financeiro — `feature_financial`
9. Contratos — `feature_contracts`
10. Personalização de marca — `feature_brand_customization`
11. Integração com Claude (MCP) — `feature_mcp`

The comparison deliberately omits Clients and Users because they remain visible in each pricing card. It also omits features that do not help differentiate the current offer, such as Instagram integration and CSV import.

The matrix ends with one action per plan. Actions reuse the existing plan destinations and labels so a visitor can subscribe without scrolling back to the cards.

## Visual Design

- Use the landing page's existing neutral surfaces, borders, radii, typography, and spacing.
- Give the Pro column a subtle amber treatment consistent with the existing “Mais popular” card, without overpowering row readability.
- Separate Capacity and Features with visible group headers.
- Use concise values: localized storage units, numeric limits, `Ilimitado`, a green check for enabled features, and an em dash for disabled features.
- Keep row heights consistent so the eye can compare values horizontally.
- Avoid animations beyond existing reveal behavior and honor reduced-motion preferences.

## Responsive Behavior

### Desktop and tablet

Render the complete semantic table at the container width. The first column contains row labels; the remaining columns contain the public plans in their Admin-defined order.

### Mobile

Place the table in a horizontally scrollable region. Keep the resource-label column sticky while the plan columns move horizontally. Keep plan headers visible within the comparison region where practical and show a short “deslize para comparar” hint before the table.

The implementation must not convert the matrix into separate per-plan cards on mobile because that would remove direct comparison.

## Components and Responsibilities

### `listPublicPricingPlans`

Extend the existing public projection with only the fields required by the curated matrix. Continue filtering inactive plans in the query and internal plan IDs in the service. Continue ordering plans by `sort_order`.

### `PublicPricingPlan`

Extend the public type with the four capacity fields and seven feature flags listed above. No authenticated subscription data is required.

### `PlanComparison`

Create a focused presentation component in the landing-page folder. It receives:

- the loaded public plans;
- a function that returns the existing action URL for a plan;
- the existing marketing labels needed for the actions.

The component owns row definitions, formatting, semantic table markup, mobile scrolling, and visual highlighting. It does not fetch data or own loading state.

### Pricing section

Continue owning the Intersection Observer, TanStack Query state, billing-period toggle, and plan action routing. Render `PlanComparison` only after the same plan query succeeds with at least one public plan.

## Data Flow and Performance

1. The pricing section approaches the viewport.
2. The existing Intersection Observer enables the public plan query with the current 600-pixel root margin.
3. Supabase returns one compact projection containing card and comparison fields.
4. The cards and `PlanComparison` consume the same cached result.
5. Admin changes become visible after the existing five-minute query staleness window or a page reload.

There is no additional network request. The extra scalar fields add a small amount of response data for four plans and do not add code to the initial rendering path before the pricing section approaches the viewport.

## Formatting Rules

- A null numeric limit is displayed as `Ilimitado`.
- Storage is displayed in the largest appropriate binary unit using Portuguese formatting, for example `100 MB`, `5 GB`, or `25 GB`.
- An enabled feature is displayed with a visually green check and an accessible label such as “Incluído”.
- A disabled feature is displayed as an em dash with an accessible label such as “Não incluído”.
- Unknown plan IDs use the plan name returned by Admin and do not receive hard-coded highlighting.
- The internal `lifetime` plan remains excluded even if active.

## Loading, Empty, and Error States

- While the single plan query is pending, retain the current pricing-card skeletons. Do not add a second matrix skeleton below them.
- On query failure, retain the current alert and retry action. Do not render a stale or hard-coded matrix.
- When no public plans are returned, retain the current unavailable state and omit the matrix.
- If individual nullable limits are absent, format them as unlimited according to the Admin model.

## Accessibility

- Use a semantic `<table>` with column and row header scopes.
- Provide a descriptive caption for screen readers.
- Label the mobile scroll region and keep it keyboard-scrollable.
- Do not rely on color alone for Pro highlighting or feature availability.
- Add screen-reader text for check and em-dash states.
- Maintain visible focus styles on all plan actions.

## Testing

### Billing service tests

- Verify that the public query selects the complete curated projection.
- Verify active-plan filtering, Admin ordering, and internal Lifetime exclusion.
- Verify the extended fields are returned unchanged.

### Landing and comparison tests

- Verify the cards still display only Clients and Users as their limits.
- Verify the matrix renders the curated rows and public plans in query order.
- Verify finite capacity values, localized storage, and `Ilimitado` formatting.
- Verify enabled and disabled features have correct visible and accessible states.
- Verify the Pro emphasis and the absence of internal Lifetime data.
- Verify plan actions reuse the authenticated and unauthenticated destinations.
- Verify the matrix is absent during loading, empty, and error states.
- Preserve the existing deferred-query and retry tests.

## Acceptance Criteria

- Visitors see a comparison matrix directly below successfully loaded pricing cards.
- Cards continue to show only Clients and Users.
- The matrix contains exactly the approved four capacity rows and seven feature rows.
- Desktop users can compare all public plans in aligned columns.
- Mobile users can horizontally scroll plan columns while retaining row context.
- All displayed plan values originate from the existing deferred public query.
- No second plan request is introduced.
- Loading, error, empty, accessibility, and responsive behaviors match this specification.
- CRM build, full Vitest suite, and formatting check pass.
