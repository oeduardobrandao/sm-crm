# Client Detail Responsive Follow-up Design

**Date:** 2026-07-18
**Scope:** CRM client-detail calendar and Instagram sections

## Goal

Finish the responsive polish identified during authenticated local review: make the client post calendar geometrically consistent, prevent selected post cards from overflowing, compact the Instagram account summary, and replace the latest-publications table with a media-first horizontal carousel at every screen size.

## Calendar

The month grid will retain seven columns, but each track will use `minmax(0, 1fr)` so event labels cannot determine column width. Every current-month and placeholder cell will share the same explicit responsive height. Event pills will remain inside the cell, use the available width, and truncate when their label is longer than the cell.

The selected-day panel will be width-constrained throughout its layout hierarchy. The panel, list, and card will use `min-width: 0`; long post titles will wrap or clamp; badges and actions will wrap without increasing the viewport width. These rules apply to the client-detail instance without changing calendar data or selection behavior.

## Instagram account summary

The account-level metrics—followers, following, and publications—will use a dedicated three-column grid instead of the generic auto-fit KPI layout. On phones, the cards will become more compact while remaining equal in size and preserving readable values and labels.

The token-expiry badge will have a larger visual container and a non-wrapping label so values such as “38 dias restantes” remain on one line. The surrounding profile header will still wrap safely on narrow screens.

## Neutral post carousel

The presentation used by Analytics “Melhores Posts” will be generalized into a neutral post-carousel component. The component will not rank or sort posts. It will accept display parameters such as title, description, posts, tone, optional “see more” behavior, and the metrics to render. Ordering and semantic meaning belong to each caller.

- Analytics continues to supply posts ranked by reach and labels the section “Melhores Posts.”
- Client details supplies posts ordered newest-first and labels the section “Últimas Publicações.”

The client-detail carousel replaces the current table at all breakpoints. It will show a media preview, media type, caption, publication date, likes, comments, reach, impressions, and a sanitized link to the original publication. Cards will use horizontal overflow, snap alignment, touch scrolling, and a visible next-card cue where space permits. Existing server pagination remains available and is independent of horizontal scrolling.

## Safety and accessibility

All user-provided captions and account data rendered through raw HTML remain escaped. External media and publication URLs remain sanitized. Icon-only pagination and external-link controls retain accessible names. Carousel markup will expose a labelled region/list relationship without interfering with native touch scrolling.

## Testing

Implementation will follow test-first cycles. Coverage will assert:

- seven equal, shrinkable calendar tracks and consistent cell height;
- selected-post panel/card containment and safe title/action wrapping;
- a dedicated three-column Instagram summary grid;
- a non-wrapping, enlarged token-expiry badge;
- neutral carousel parameters with no sorting/ranking inside the component;
- newest-first client-detail data passed to “Últimas Publicações”;
- media-first card content, sanitized links, pagination, and responsive carousel CSS.

Focused tests will run after each change, followed by the full Vitest suite and the CRM production build.
