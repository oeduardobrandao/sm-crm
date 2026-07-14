# Landing plan cards synced with Admin

## Goal

Keep the public landing-page pricing cards aligned with the active plan catalog managed in Admin without adding a request to the initial page load.

## Scope

- Replace the hardcoded plan prices and limits in `LandingPage.tsx` with data read from the public `plans` catalog.
- Show only the `Clientes` and `Usuários` limits on each card.
- Keep plan marketing copy, CTA labels, CTA destinations, and the Pro highlight in frontend-owned metadata because Admin does not manage those fields.
- Exclude internal plans such as `lifetime` from the public offer.
- Preserve the existing monthly/annual selector and calculate the annual savings message from catalog prices.

## Architecture

The landing pricing section will use a small, dedicated plan-display model. The Supabase query will request only the fields needed by the cards:

- `id`
- `name`
- `price_brl`
- `price_brl_annual`
- `sort_order`
- `max_clients`
- `max_team_members`

The query will return only active plans, ordered by `sort_order`. Internal plan IDs will be filtered out before rendering. Plan-specific marketing metadata will be joined by plan ID in the frontend. Plans without marketing metadata will still use safe generic CTA text and no highlight, so a newly activated public plan can render without breaking the section.

## Loading strategy

An `IntersectionObserver` will enable the plan query only when the pricing section is close to the viewport. A positive root margin will start the request shortly before the visitor reaches the cards. This avoids adding a Supabase request to the landing page's initial load while normally completing the request before the cards are visible.

The observer will degrade safely when unavailable by enabling the query, ensuring the section still works in older browsers and test environments.

## Rendering and states

- Loading: render four skeleton cards with stable dimensions to limit layout shift.
- Success: render active public plans in Admin order.
- Empty result: show a concise unavailable state rather than stale hardcoded prices.
- Error: show a discreet error message and a `Tentar novamente` action.
- Limits: render a numeric value when configured and `Ilimitado` when the Admin value is `null`.
- Annual pricing: show the monthly equivalent of the annual charge and the complete annual charge, preserving the current card convention.
- Annual savings: derive the displayed maximum percentage from the returned monthly and annual prices; hide the hint when no positive saving exists.

## Data ownership

Admin-owned, dynamic fields:

- plan activation and order
- plan name
- monthly and annual prices
- client limit
- user limit

Frontend-owned fields:

- audience description
- CTA label and destination behavior
- recommended-plan highlight

## Testing

Automated tests will verify:

- the query is not enabled before the pricing section approaches the viewport;
- active plans render in catalog order;
- `lifetime` is not offered publicly;
- finite and unlimited client/user limits render correctly;
- monthly and annual prices use catalog values;
- annual savings are calculated from catalog prices;
- loading and retryable error states render correctly;
- existing landing navigation, promo, theme, and FAQ behavior remains intact.

Verification will run the focused pricing tests first, followed by `npm run build` and `npm run test` as required by the repository instructions.

## Out of scope

- Adding plan descriptions, recommendation flags, or CTA configuration to Admin.
- Displaying Templates, feature flags, storage, rate limits, or other plan entitlements in the landing cards.
- Changing checkout or billing behavior.
- Showing internal plans publicly.
