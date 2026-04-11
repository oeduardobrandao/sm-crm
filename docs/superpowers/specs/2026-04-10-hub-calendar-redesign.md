# Hub Calendar Redesign

**Date:** 2026-04-10

## Goal

Redesign the hub's post calendar to match the CRM's two-column calendar UI, and move it to the hub home page. Remove the standalone Calendário page and its nav entry.

## Changes

### 1. Extract `PostCalendar` component

Create `apps/hub/src/components/PostCalendar.tsx`.

- Accepts `posts: HubPost[]` as a prop (data already fetched by the caller)
- **Layout**: two-column on md+ (`grid-cols-[auto_280px]` or similar), stacked on mobile
- **Left — calendar grid**:
  - Header: title "Postagens" + month/year + prev/next nav buttons
  - Weekday row: Dom Seg Ter Qua Qui Sex Sáb
  - Day cells: number in top-left; colored pills grouped by `tipo` (same as CRM). Colors: `feed:#3b82f6`, `reels:#8b5cf6`, `stories:#f59e0b`, `carrossel:#10b981`. Pill shows count + label (e.g. "2 Feed")
  - Today highlighted with primary color circle on day number
  - Selected day highlighted (border or bg change)
- **Right — side panel**:
  - Header: "Postagens" + selected date string (or month name if nothing selected)
  - List of posts for the selected day, each showing: tipo badge (colored), post title, status chip (read-only label only — no action buttons)
  - Empty state: "Selecione um dia." / "Nenhuma postagem neste dia."
  - On mobile: panel appears below the calendar grid
- **Default selected day**: today's date (if current month), else null

### 2. Update `HomePage.tsx`

- Import and render `<PostCalendar posts={posts} />` below the section cards grid, with `isLoading` handled (spinner)
- Remove the `{ label: 'Calendário', ... }` entry from the `SECTIONS` array

### 3. Remove `CalendarioPage.tsx`

- Delete `apps/hub/src/pages/CalendarioPage.tsx`

### 4. Update `router.tsx`

- Remove the `{ path: 'calendario', element: <CalendarioPage /> }` route
- Remove the `CalendarioPage` import

### 5. Update `HubNav.tsx`

- Remove the Calendário nav item (if present)

## Out of scope

- No status-update actions in the hub calendar (read-only)
- No deep linking from the side panel to individual posts
- No changes to data fetching — `fetchPosts` already returns `scheduled_at`
