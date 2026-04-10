---
title: HubTab Inner Tabs with Briefing Editor
date: 2026-04-10
status: approved
---

## Overview

Add an inner tab bar to the `HubTab` component in the CRM's client detail page. This organises the existing sections (Acesso, Marca, Páginas) into tabs and adds a new **Briefing** tab where the user can view and edit the client's core fields (`nome`, `email`, `telefone`, `segmento`, `notas`) directly from the Hub tab.

## Motivation

Currently the Briefing section in the client hub reads from `clientes` table fields, but there is no way to edit those fields from within the Hub tab. Users must scroll up to the main client form. Adding a Briefing tab here closes that gap without adding a new data model.

## Architecture

### Tab structure

`HubTab` wraps all content in shadcn `<Tabs>` with four tabs:

| Tab | Content |
|-----|---------|
| Acesso | Existing access control section (token link, copy, preview, toggle) |
| Briefing | New `BriefingEditor` component |
| Marca | Existing `BrandEditor` (unchanged) |
| Páginas | Existing `PagesEditor` (unchanged) |

Default active tab: **Acesso**.

### BriefingEditor component

- Lives inside `HubTab.tsx` as a local component (same pattern as `BrandEditor` and `PagesEditor`)
- Props: `clienteId: number`, `onSaved: () => void`
- Fetches via `getClienteBriefing(clienteId)` on mount (React Query)
- Fields: Nome, Email, Telefone, Segmento, Notas (textarea)
- Save button calls `upsertClienteBriefing(clienteId, fields)` then invalidates query and shows toast

### Store changes (apps/crm/src/store.ts)

Two new functions:

```ts
getClienteBriefing(clienteId: number): Promise<{ nome, email, telefone, segmento, notas }>
upsertClienteBriefing(clienteId: number, fields: Partial<BriefingFields>): Promise<void>
```

`upsertClienteBriefing` does `supabase.from('clientes').update(fields).eq('id', clienteId)`.

## Files Changed

- `apps/crm/src/pages/cliente-detalhe/HubTab.tsx` — wrap in `<Tabs>`, add `BriefingEditor`
- `apps/crm/src/store.ts` — add `getClienteBriefing`, `upsertClienteBriefing`

## Out of Scope

- No new database tables or migrations (reads/writes existing `clientes` columns)
- No changes to the hub app (`apps/hub/`)
