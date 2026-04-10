# Client Hub — Design Spec

**Date:** 2026-04-10  
**Status:** Approved for implementation

---

## Overview

A persistent, client-facing hub page that agencies share with their clients. Each client gets a permanent magic link (`mesaas.com.br/:workspaceSlug/hub/:clientToken`) where they can approve posts, view their content calendar, access brand assets, read agency-created pages, and review their briefing — all without logging in.

The hub is white-labeled per workspace: each agency's branding (logo, primary color, name) is applied via CSS variables derived from the workspace record.

---

## Architecture

### Two apps in one monorepo

The project is reorganized as a monorepo with two Vite apps:

```
sm-crm/
├── apps/
│   ├── crm/          ← current src/ moved here
│   └── hub/          ← new client hub app
│       ├── src/
│       │   ├── main.tsx
│       │   ├── router.tsx
│       │   ├── shell/        ← branded layout shell, nav
│       │   └── pages/        ← one folder per section
│       └── vite.config.ts
├── packages/
│   └── ui/           ← shared primitives (Button, Badge, Spinner, etc.)
├── supabase/
│   ├── functions/
│   └── migrations/
```

Shared UI primitives are extracted to `packages/ui/` and imported by both apps. No logic is shared — only stateless components and styles.

### URL structure

```
mesaas.com.br/:workspaceSlug/hub/:clientToken              → Home
mesaas.com.br/:workspaceSlug/hub/:clientToken/aprovacoes   → Posts to approve
mesaas.com.br/:workspaceSlug/hub/:clientToken/calendario   → Content calendar
mesaas.com.br/:workspaceSlug/hub/:clientToken/marca        → Brand center
mesaas.com.br/:workspaceSlug/hub/:clientToken/paginas      → Custom pages list
mesaas.com.br/:workspaceSlug/hub/:clientToken/paginas/:id  → Single custom page
mesaas.com.br/:workspaceSlug/hub/:clientToken/briefing     → Briefing
```

On load, the hub validates both `:workspaceSlug` and `:clientToken`. If the token doesn't belong to that workspace, it returns a 404.

### Deployment

Both apps build to separate `dist/` folders. The hub is served at `/:workspaceSlug/hub/*` via path-based routing rules (Nginx rewrite or Vercel rewrites). No subdomain or wildcard DNS needed.

---

## Token Model

A new `client_hub_tokens` table: one row per client. Token is a UUID auto-generated when the client is created. Agency can toggle `is_active` to revoke or restore access instantly. No expiry by default.

**Access flow:**
1. Hub app loads — calls `hub-bootstrap` with `workspaceSlug` + `clientToken`
2. Edge function validates both; returns workspace branding + client name + active status
3. If `is_active = false`, hub shows an "acesso desativado" screen
4. All subsequent edge function calls include the token for authorization

---

## Hub Sections

### Home
Landing page after token validation. Displays workspace logo + client name at the top. Below, a grid of section cards (like Notion's database links). If there are posts pending approval, the "Aprovações" card shows a red badge with the count.

Navigation: cards on home → section pages. On mobile: bottom tab bar (Home, Aprovações, Calendário, Marca, Mais). On desktop: top nav bar.

### Posts to Approve (`/aprovacoes`)
Flat list of all posts with status `enviado_cliente` across all workflows, sorted by scheduled date ascending. Each card shows: post type (feed/reels/stories/carrossel), caption preview, scheduled date, and approve/request-correction actions with an optional comment field. Reuses the approval interaction from the existing portal.

### Content Calendar (`/calendario`)
Monthly calendar view of all posts for this client, regardless of status. Posts appear on their scheduled date as colored dots (color = status). Clicking a post opens a drawer with full caption, status badge, and approval history.

### Brand Center (`/marca`)
Structured, agency-managed section with:
- Logo: uploaded file, shown as preview + download button
- Primary color: hex swatch + value
- Secondary color: hex swatch + value  
- Primary font name
- Secondary font name
- File gallery: named files (PDFs, ZIPs, images) the agency uploads — client can download, not edit

### Custom Pages (`/paginas`, `/paginas/:id`)
Agency creates named pages with rich-text content blocks (text, images, embedded links). Listed on `/paginas` as cards with title. Clicking navigates to the full page, rendered read-only. Examples: "Manual de Comunicação", "Estratégia de Conteúdo", "Direcionamento Criativo".

### Briefing (`/briefing`)
Read-only view of the client's structured data from the CRM: name, segment, target audience, goals, and any custom fields the agency fills in on the client record.

---

## Database

### New tables

**`client_hub_tokens`**
| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| cliente_id | int FK | references clientes |
| conta_id | int FK | references contas |
| token | uuid | unique, auto-generated |
| is_active | bool | default true |
| created_at | timestamptz | |

**`hub_pages`**
| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| conta_id | int FK | |
| cliente_id | int FK | |
| title | text | |
| content | jsonb | rich-text blocks array |
| display_order | int | |
| created_at | timestamptz | |

**`hub_brand`**
| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| cliente_id | int FK | unique |
| logo_url | text | |
| primary_color | text | hex |
| secondary_color | text | hex |
| font_primary | text | |
| font_secondary | text | |

**`hub_brand_files`**
| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| cliente_id | int FK | |
| name | text | |
| file_url | text | |
| file_type | text | pdf/image/zip/etc |
| display_order | int | |

### Existing table changes

**`contas`** — add columns:
- `slug` (text, unique, url-safe) — workspace URL identifier
- `brand_color` (text) — hex, used in hub CSS variables
- `hub_enabled` (bool, default true)

---

## Edge Functions

| Function | Method | Auth | Purpose |
|---|---|---|---|
| `hub-bootstrap` | GET | token | Validate workspaceSlug + clientToken, return branding + client name |
| `hub-posts` | GET | token | All posts for this client (all statuses), for calendar + approvals |
| `hub-approve` | POST | token | Client approves or requests correction on a post |
| `hub-brand` | GET | token | Brand center data (structured fields + files) |
| `hub-pages` | GET | token | All custom pages for this client |
| `hub-briefing` | GET | token | Readonly client fields from CRM |

All functions use the service role key internally. The `clientToken` is the sole authorization mechanism — no session cookie, no JWT.

---

## Agency Management (CRM)

A new **"Hub do Cliente"** tab is added to the existing `ClienteDetalhePage`. From this tab the agency can:

- See and copy the hub link
- Toggle `is_active` on/off (revoke/restore access)
- Manage brand center: upload logo, set colors and fonts, upload/remove files
- Create, edit, reorder, and delete custom pages (rich-text editor)
- Preview the hub as the client sees it (opens in new tab)

---

## Out of Scope

- Client authentication with email/password (magic link only for now)
- Custom domain per workspace (path-based only)
- Financials / contracts visible to client
- Client editing any data (hub is read + approve only)
- Notifications / email alerts to client
