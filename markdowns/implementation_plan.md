# Client Portal — Área do Cliente

Public page where clients track workflow progress via a secret shareable link, without authentication.

## Reference

![Reference Portal](file:///Users/eduardosouza/.gemini/antigravity/brain/1882a2a1-d0d2-4d0b-8e61-27009ffb769b/client_portal_top_1773920806064.png)

## Decisions (User Approved)

| Topic | Decision |
|-------|----------|
| Security | **Edge Function** validates token, returns data |
| Drive/Notion links | **Workflow-level** (no per-etapa migration) |
| Logo | **Workspace logo** (from `workspaces.logo_url`) prominent, **Mesaas** logo secondary in footer |
| Deadline visibility | **Not included** for now |

## Proposed Changes

---

### 1. DB Migration — `portal_tokens` table

#### [NEW] Migration `create_portal_tokens`

```sql
CREATE TABLE portal_tokens (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  token TEXT UNIQUE NOT NULL DEFAULT encode(gen_random_bytes(16), 'hex'),
  workflow_id INTEGER NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
  conta_id TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE portal_tokens ENABLE ROW LEVEL SECURITY;
CREATE POLICY "owners_manage_portal_tokens" ON portal_tokens
  FOR ALL USING (conta_id = (SELECT conta_id FROM profiles WHERE id = auth.uid()));
```

---

### 2. Edge Function — `portal-data`

#### [NEW] Edge Function `portal-data`

- Accepts `GET ?token=xxx`
- Queries `portal_tokens` → get `workflow_id` + `conta_id`
- Fetches: workflow, etapas (ordered), client name, workspace `logo_url` + `name`
- Returns JSON (no sensitive data — no financials, no assignee)

---

### 3. Frontend — Store functions

#### [MODIFY] [store.ts](file:///Users/eduardosouza/Projects/sm-crm/src/store.ts)

Add:
- `createPortalToken(workflowId)` — inserts into `portal_tokens`, returns token
- `getPortalToken(workflowId)` — fetches existing token or null

---

### 4. Frontend — Portal Page

#### [NEW] [PortalPage.tsx](file:///Users/eduardosouza/Projects/sm-crm/src/pages/portal/PortalPage.tsx)

Layout (top → bottom):

1. **Header**: Workspace logo (left) + "Área do Cliente" label (right)
2. **Hero Card**: Workflow title, status badge, client name, progress bar (completed/total)
3. **Timeline**: Vertical timeline of etapas with status icons (✅ done, 🔵 active, ⚪ pending)
4. **Links Card**: Drive & Notion buttons (if present on workflow)
5. **Footer**: "fornecido por" + Mesaas logo + [logo-black.svg](file:///Users/eduardosouza/Projects/sm-crm/public/logo-black.svg)

#### [MODIFY] [App.tsx](file:///Users/eduardosouza/Projects/sm-crm/src/App.tsx)

Add public route outside `<ProtectedRoute>`:
```tsx
<Route path="/portal/:token" element={<PortalPage />} />
```

---

### 5. Share Button in EntregasPage

#### [MODIFY] [EntregasPage.tsx](file:///Users/eduardosouza/Projects/sm-crm/src/pages/entregas/EntregasPage.tsx)

Add "Compartilhar" button on workflow cards → creates/retrieves portal token → copies link to clipboard.

---

### 6. Styling

#### [MODIFY] [style.css](file:///Users/eduardosouza/Projects/sm-crm/style.css)

Portal-specific styles: `.portal-*` classes for header, hero, timeline, and footer.

## Verification Plan

### Browser Testing
- Open `/portal/:token` without auth → renders correctly
- Verify timeline with correct status colors per etapa
- Verify responsive on 375px width
- Test invalid token → error state
- Test "Compartilhar" button → copies correct URL
