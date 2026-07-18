# Client Finance Mobile Polish Design

## Goal

Improve the financial area of the CRM client-detail page on phones without changing the behavior of populated contract or transaction records.

## Scope

- Keep the monthly value, total received, and pending metrics on one horizontal row at mobile widths.
- Replace empty contract and transaction table rows with dedicated empty-state panels.
- Provide useful navigation from each empty state.
- Preserve the existing desktop layout and the rendering of populated tables.

## Layout

The finance metrics will use a section-specific grid class instead of inheriting the generic odd-card behavior used elsewhere. At mobile widths the grid will render three equal `minmax(0, 1fr)` columns. Labels, values, gaps, and padding will be compacted so Brazilian currency values fit predictably on narrow phones without causing the third card to wrap.

The contracts and transactions containers will keep their existing headings. When records exist, their current tables and mobile responsive presentation remain unchanged. When no records exist, the page will not render a placeholder table row. It will render a compact empty-state panel outside the table structure, preventing the generic mobile table styles from pushing the text to the right.

## Empty States

Each empty state will contain a Lucide icon, a concise title, supporting copy, and an outline-style navigation link:

- Contracts: **Nenhum contrato cadastrado**; “Os contratos vinculados a este cliente aparecerão aqui.”; **Gerenciar contratos** links to `/contratos`.
- Transactions: **Nenhuma transação registrada**; “Os lançamentos financeiros deste cliente aparecerão aqui.”; **Ver financeiro** links to `/financeiro`.

English translations will be added for the same strings. Navigation will use the page's existing React Router navigation rather than raw links.

## Accessibility and Responsive Behavior

- Empty-state icons are decorative and will be hidden from assistive technology.
- Action controls retain visible text and normal keyboard behavior.
- Text is centered within the empty panel rather than relying on table-cell alignment.
- KPI values may reduce in font size at the narrowest breakpoint, but will remain on one line.
- No horizontal page overflow will be introduced.

## Testing

- Add a focused responsive contract test for the three-column finance grid and the override of the generic odd-card rule.
- Verify the page source renders dedicated empty states only when the corresponding arrays are empty and preserves tables for populated data.
- Verify both Portuguese and English translation keys.
- Run the focused tests, the complete Vitest suite, and the CRM production build before updating the pull request.

## Out of Scope

- Redesigning populated contract or transaction cards.
- Adding contract or transaction creation flows to the client-detail page.
- Changing finance calculations or data fetching.
