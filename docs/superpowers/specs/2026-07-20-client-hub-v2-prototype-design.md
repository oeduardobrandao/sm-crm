# Client Hub V2 Prototype Design

**Date:** 2026-07-20
**Status:** Approved design; ready for implementation planning

## Objective

Create a clickable, responsive prototype for a complete visual redesign of the client Hub. The prototype must feel professional, intentional, and human-made while remaining neutral enough to become the foundation for future agency branding controls.

The prototype is a design-validation artifact. It must not replace current production routes, call Supabase, mutate client data, or change the behavior of the existing Hub.

## Approved Direction

The selected direction is **Editorial Service** with a **sans-first** typographic system. Its editorial character comes from proportion, whitespace, dividers, controlled density, and direct copy instead of decorative display typography.

The homepage is **action-first**. Pending approvals and other required client decisions appear before performance reporting. Metrics, calendar context, and resource links support the primary workflow rather than competing with it.

The Hub expresses the **agency/workspace brand**, not the end client's brand. Client identity assets remain content on the Marca page and do not automatically recolor the Hub interface.

## Scope

The prototype provides light-mode designs for every current Hub route and page family:

- Home
- Approvals queue
- Individual post review and shareable post view
- Posts calendar/list
- Brand
- Pages library
- Individual page reader
- Briefing
- Ideas
- Reports history
- Monthly report
- Responsive desktop, tablet, and mobile shells
- Representative loading, empty, success, unavailable, and recoverable-error states
- A dark-mode reference sequence covering Home and individual post review

The prototype includes realistic local data and interactions for navigation, filters, approval decisions, feedback entry, lightboxes or dialogs, theme preview, and state switching.

## Non-goals

- Replacing or restyling the production Hub in this phase
- Supabase requests, token authentication, or persistence
- Database migrations or an agency-facing theme editor
- End-client-driven portal branding
- Arbitrary CSS, arbitrary font uploads, or unrestricted theme controls
- Pixel-perfect preservation of the current visual treatment
- Adding new product capabilities unrelated to the redesign

## Prototype Architecture

The prototype will be a separate Vite entry inside `apps/hub`:

- `apps/hub/prototype.html` is the isolated HTML entry.
- `apps/hub/src/prototype/` contains the prototype application, routes, fixtures, components, and styles.
- The entry uses the repository's existing React, TypeScript, Tailwind, and Lucide dependencies.
- Hash-based prototype routes keep every screen directly reachable without adding server rewrites or production Hub routes.
- Local fixtures follow the current Hub's TypeScript data shapes where practical.
- A dedicated prototype stylesheet owns semantic Hub V2 tokens and components. It must not add more Hub-specific overrides to `apps/hub/index.html` or change `apps/crm/style.css` for production behavior.
- The normal Hub build remains rooted at `apps/hub/index.html`; the prototype is excluded from the production Hub entry and does not alter the current router.

The implementation plan may introduce focused files within `apps/hub/src/prototype/`, but it should preserve boundaries between shell, page templates, theme resolution, fixtures, and state controls.

## Visual Foundation

### Principles

- Warm-neutral surfaces and clear typographic hierarchy
- One sans-serif family for headings, body copy, controls, and data
- Editorial rhythm through spacing and rules, not a decorative serif
- Minimal shadows and restrained corner radii
- Fewer generic card grids; use dividers, lists, and page composition where they communicate hierarchy more clearly
- Media-led cards only when the media is the primary object
- Motion that explains state changes, with reduced-motion support
- No decorative gradients, noise textures, emoji greetings, excessive pill shapes, or ornamental animation

### Semantic tokens

Components consume semantic CSS variables rather than raw palette values. The token layer includes:

- Canvas, surface, elevated surface, and subtle surface
- Default, subtle, and strong borders
- Primary, secondary, and muted text
- Action, action foreground, focus, and selection
- Success, warning, danger, and informational states
- Typography families, sizes, line heights, and weights
- Spacing, radius, shadow, and motion scales

Light mode is the neutral default. Dark mode supplies an equivalent semantic token set instead of selector-by-selector overrides for individual Tailwind colors.

## Agency Theme Configuration

The prototype includes a local theme resolver and mock agency configurations. A configuration can supply:

- Agency name
- Full logo and compact mark
- Accent color
- Optional attribution text
- Preferred light or dark appearance
- Optional top banner image
- Banner alternative text
- Desktop and mobile banner focal positions
- Optional sanitized banner link

The resolver merges agency values with neutral defaults, validates accent colors, determines a readable foreground, and falls back to graphite when contrast is unsafe. Components reference semantic action, focus, link, and selection tokens rather than the raw agency color. Agency accents do not replace semantic success, warning, danger, or informational colors.

The optional top banner appears beneath the primary navigation at the top of the homepage. It stays within the main content width and uses a fixed responsive aspect ratio with safe cropping. Text and controls remain outside the image. When no banner is configured, the space collapses completely.

Typography, radius, and density remain controlled by the neutral system in this phase. The architecture may later support curated presets, but the prototype does not expose unrestricted CSS or font controls.

## Information Architecture

All current destinations remain available, but the top-level navigation is reorganized around client intent.

### Desktop navigation

- **Início** — action-first account overview
- **Aprovações** — review queue, with a pending-count indicator
- **Conteúdo** — posts calendar/list and individual content views
- **Relatórios** — reporting history and monthly reports
- **Recursos** — grouped access to Marca, Páginas, Briefing, and Ideias

The desktop shell uses a quiet sticky horizontal header with agency branding on the left, primary navigation in the center, and client/account controls on the right.

### Mobile navigation

The bottom navigation contains four destinations:

- Início
- Aprovações
- Conteúdo
- Mais

“Mais” opens an accessible sheet containing Relatórios, Marca, Páginas, Briefing, Ideias, language, and appearance controls. The compact top bar carries agency identity and client/account context without duplicating the full navigation.

## Page Designs

### Home

Home answers “What needs my attention?” before “How are we performing?” Its order is:

1. Optional agency banner
2. Direct greeting and short context sentence
3. Required actions, led by pending approvals
4. Quick access to the most relevant next destinations
5. Compact performance summary
6. Upcoming content/calendar context
7. Secondary resources and reporting links

The page must not reproduce the current grid of equally weighted section cards.

### Approvals queue

The queue is optimized for scanning. Each item shows the media preview, title or content type, platform, planned date, and review status. Filters and selection remain visible without dominating the page. Media may use a gallery layout; metadata and controls follow consistent alignment.

### Individual post review

Desktop uses a split layout with media on the left and caption, context, discussion, and decision controls on the right. The decision panel remains visible while reviewing long content. Mobile stacks media, post context, caption, discussion, and final actions in that order. Approval and correction actions have clear confirmation and recovery states.

### Posts

The content area provides a calm calendar/list switch. Calendar cells show only essential signals; selecting a date or post reveals detail without overwhelming the grid. Workflow grouping and platform status are visible through compact labels, not decorative color blocks.

### Brand

Marca presents client identity as organized reference content: logo assets, swatches, typography, and downloadable files. It uses disciplined lists and specimen areas rather than letting client brand colors recolor the surrounding Hub.

### Pages and page reader

Páginas becomes a document library with title, description or metadata, and updated context where available. The reader uses a narrow content measure, strong heading rhythm, safe rich-text rendering, and sticky local navigation only when document length warrants it.

### Briefing

Briefing uses clear section navigation, readable question-and-answer grouping, visible save or update state, and inline validation. Editable controls retain at least 16px text on mobile.

### Ideas

Ideias separates submission from the ongoing idea feed. Cards remain appropriate for image-led ideas, but status, reactions, agency responses, and destructive controls follow a restrained hierarchy. Dialogs remain keyboard accessible and are rendered outside transformed ancestors.

### Reports

The reports history is a clear period list. Monthly reports prioritize summary, interpretation, and comparison before detailed charts and top posts. Charts use semantic labels and textual context so color is not the only carrier of meaning.

## Shared Component Vocabulary

- App shell and responsive navigation
- Page header with eyebrow, direct title, description, and optional contextual action
- Attention strip for required client action
- Metric group with compact trend indicators
- Content row, media preview, and resource list
- Status badge and platform label
- Empty, loading, success, unavailable, and recoverable-error states
- Accessible menu, sheet, dialog, and lightbox
- Form controls and inline validation
- Resource reader and optional local table of contents

The system should use the smallest suitable component. Surfaces are introduced only when they establish grouping, interaction, or elevation.

## Prototype State and Data Flow

The prototype has no server state. Local fixtures provide representative workspace, client, posts, approvals, brand assets, documents, briefing, ideas, and reports. A small prototype state layer controls:

- Current theme fixture and appearance
- Current route
- Filter and selection state
- Approval, correction, and feedback simulations
- Dialog and lightbox state
- Loading, empty, success, unavailable, and error variants

Interaction results update local state only. A reset control restores the initial fixture. Direct URL or query controls make representative states reviewable without repeating long interaction sequences.

## Error and Edge-state Design

- Loading states preserve the expected page structure and avoid excessive skeleton animation.
- Empty states explain why the area is empty and identify the next useful action when one exists.
- Recoverable errors provide a retry control and generic user-facing copy.
- Unavailable or disabled access provides agency-contact guidance without exposing implementation details.
- Forms retain entered local values after recoverable validation failures.
- Theme failures fall back to the neutral default without breaking the interface.
- Banner load failures collapse the image region without affecting primary actions.

## Responsive Behavior

- Layout changes are driven by content pressure rather than shrinking desktop cards.
- Desktop uses horizontal navigation, wider content measures, and split review views.
- Tablet reduces grid columns and preserves visible review actions.
- Mobile uses one-column reading order, full-width media, the bottom navigation, and sticky final actions where appropriate.
- Interactive targets are at least 44 by 44 CSS pixels on touch layouts.
- Editable controls render at 16px or larger on mobile to prevent browser zoom.
- Safe-area insets are respected for fixed mobile controls.

## Accessibility

- Semantic header, navigation, main, aside, section, and footer landmarks
- Visible keyboard focus for every interactive control
- Keyboard-operable menus, sheets, dialogs, lightboxes, and filters
- Focus trapping and restoration for modal surfaces
- Useful alternative text and decorative-image handling
- WCAG AA contrast after agency accent resolution
- Status information that does not rely on color alone
- Reduced-motion support
- Screen-reader labels for icon-only actions, charts, and state controls

## Verification

Implementation is complete only after the following checks pass:

- TypeScript and `npm run build:hub`
- Existing Hub tests, confirming no regressions to the production application
- Prototype component tests for navigation, theme resolution, approval interactions, filters, dialogs, and state switching
- Automated accessibility checks for the shell, Home, approvals queue, post review, and mobile navigation
- Visual review at representative desktop, tablet, and mobile widths
- Screenshot coverage for every page family in light mode
- Dark screenshot coverage for Home and individual post review
- Manual keyboard review of navigation, review actions, dialogs, sheets, and forms
- Confirmation that the existing Hub router and API modules are unchanged unless a later approved implementation plan explicitly requires a safe shared extraction

## Acceptance Criteria

- The prototype is reachable through its isolated HTML entry and every screen is directly navigable.
- All current Hub routes have a corresponding prototype screen.
- The experience uses the approved Editorial Service, sans-first, action-first direction.
- Agency identity, accent color, attribution, and optional banner can be changed through local configuration without editing components.
- Unsafe accent values fall back safely and do not reduce required contrast.
- The prototype works at desktop, tablet, and mobile sizes.
- Home and post review demonstrate the dark token set.
- Representative state variants are reviewable without network access.
- The prototype performs no external writes and makes no Supabase requests.
- Production Hub routing, data access, and behavior remain unchanged.
