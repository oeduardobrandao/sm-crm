# Global Banners Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a platform-wide announcement system where admins create/manage banners in the admin portal and CRM users see them as dismissible bars below the topbar.

**Architecture:** Two new database tables (`global_banners`, `banner_dismissals`) with RLS. Admin CRUD through existing `platform-admin` edge function. CRM reads via Supabase client (RLS-filtered). Fixed-position banner container in CRM layout with dynamic height offset.

**Tech Stack:** PostgreSQL (Supabase), Deno edge functions, React 19, TanStack Query, Tailwind CSS, react-markdown, lucide-react

**Spec:** `docs/superpowers/specs/2026-05-02-global-banners-design.md`

---

## File Structure

### New Files

| File | Responsibility |
|------|---------------|
| `supabase/migrations/20260502000001_global_banners.sql` | Tables, constraints, RLS, helper function, trigger |
| `apps/admin/src/pages/BannersPage.tsx` | Admin banner CRUD page (list + modal form) |
| `apps/crm/src/components/layout/GlobalBannerContainer.tsx` | CRM banner display component (fixed position, dismissal) |
| `apps/crm/src/hooks/useBanners.ts` | React Query hook for fetching banners + dismissal |

### Modified Files

| File | Changes |
|------|---------|
| `supabase/functions/platform-admin/index.ts` | Add 4 banner actions: list, create, update, delete |
| `apps/admin/src/lib/api.ts` | Add `GlobalBanner` type + 4 API functions |
| `apps/admin/src/router.tsx` | Add `/admin/banners` route |
| `apps/admin/src/layouts/AdminLayout.tsx` | Add Banners nav item |
| `apps/crm/src/components/layout/AppLayout.tsx` | Insert `<GlobalBannerContainer />` |
| `apps/crm/src/store.ts` | Add banner query functions |
| `style.css` (CRM) | Add `--banner-height` variable to `.main-content` and `.sidebar` offsets |

---

### Task 1: Database Migration

**Files:**
- Create: `supabase/migrations/20260502000001_global_banners.sql`

- [ ] **Step 1: Write the migration file**

```sql
-- Helper function: resolve effective plan for a workspace
-- Falls back to default plan if no explicit assignment exists
create or replace function resolve_workspace_plan(ws_id uuid)
returns text
language sql
security definer
stable
as $$
  select coalesce(
    (select plan_id from workspace_plan_overrides where workspace_id = ws_id),
    (select id from plans where is_default = true limit 1)
  );
$$;

-- Global banners table
create table global_banners (
  id uuid primary key default gen_random_uuid(),
  type text not null,
  content text not null,
  link text,
  custom_color text,
  target_mode text not null,
  target_plan_ids text[],
  target_workspace_ids uuid[],
  dismissible boolean not null default true,
  starts_at timestamptz,
  ends_at timestamptz,
  status text not null default 'draft',
  created_by uuid references platform_admins(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint global_banners_type_check
    check (type in ('info', 'warning', 'critical')),
  constraint global_banners_status_check
    check (status in ('draft', 'active', 'archived')),
  constraint global_banners_target_mode_check
    check (target_mode in ('all', 'plan', 'workspace')),
  constraint global_banners_plan_targets_check
    check (target_mode != 'plan' or (target_plan_ids is not null and array_length(target_plan_ids, 1) > 0)),
  constraint global_banners_workspace_targets_check
    check (target_mode != 'workspace' or (target_workspace_ids is not null and array_length(target_workspace_ids, 1) > 0)),
  constraint global_banners_schedule_check
    check (ends_at is null or starts_at is null or ends_at > starts_at),
  constraint global_banners_color_check
    check (custom_color is null or custom_color ~ '^#[0-9a-fA-F]{6}$')
);

-- Auto-update updated_at
create or replace function update_global_banners_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger global_banners_updated_at
  before update on global_banners
  for each row execute function update_global_banners_updated_at();

-- Banner dismissals table
create table banner_dismissals (
  id uuid primary key default gen_random_uuid(),
  banner_id uuid not null references global_banners(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  dismissed_at timestamptz not null default now(),
  unique (banner_id, user_id)
);

-- RLS: global_banners
alter table global_banners enable row level security;

create policy "Authenticated users can read active banners matching their workspace"
  on global_banners for select to authenticated
  using (
    status = 'active'
    and (starts_at is null or starts_at <= now())
    and (ends_at is null or ends_at > now())
    and (
      target_mode = 'all'
      or (
        target_mode = 'plan'
        and resolve_workspace_plan(
          (select conta_id from profiles where id = auth.uid())
        ) = any(target_plan_ids)
      )
      or (
        target_mode = 'workspace'
        and (select conta_id from profiles where id = auth.uid()) = any(target_workspace_ids)
      )
    )
  );

-- RLS: banner_dismissals
alter table banner_dismissals enable row level security;

create policy "Users can read own dismissals"
  on banner_dismissals for select to authenticated
  using (user_id = auth.uid());

create policy "Users can insert own dismissals"
  on banner_dismissals for insert to authenticated
  with check (user_id = auth.uid());
```

- [ ] **Step 2: Push migration to staging**

Run: `npx supabase db push --linked`
Expected: Migration applies successfully with no errors.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260502000001_global_banners.sql
git commit -m "feat(banners): add global_banners and banner_dismissals tables with RLS"
```

---

### Task 2: Platform-Admin Edge Function — Banner Actions

**Files:**
- Modify: `supabase/functions/platform-admin/index.ts`

- [ ] **Step 1: Add banner action cases to the switch statement**

In the `switch (action)` block (after the `remove-admin` case, before `default`), add:

```typescript
      case "list-banners":
        return await handleListBanners(svc, body, headers);
      case "create-banner":
        return await handleCreateBanner(svc, body, admin.id, headers);
      case "update-banner":
        return await handleUpdateBanner(svc, body, headers);
      case "delete-banner":
        return await handleDeleteBanner(svc, body, headers);
```

- [ ] **Step 2: Add the handler functions at the bottom of the file**

Append before the closing of the file:

```typescript
// ─── Banners ──────────────────────────────────────────────────

const BANNER_COLUMNS = [
  "type", "content", "link", "custom_color", "target_mode",
  "target_plan_ids", "target_workspace_ids", "dismissible",
  "starts_at", "ends_at", "status",
] as const;

async function handleListBanners(
  svc: ReturnType<typeof createClient>,
  body: { status?: string },
  headers: Record<string, string>,
) {
  let query = svc
    .from("global_banners")
    .select("*")
    .order("created_at", { ascending: false });

  if (body.status) {
    query = query.eq("status", body.status);
  }

  const { data: banners, error } = await query;
  if (error) throw error;

  const enriched = await Promise.all(
    (banners || []).map(async (b) => {
      const { count } = await svc
        .from("banner_dismissals")
        .select("id", { count: "exact", head: true })
        .eq("banner_id", b.id);
      return { ...b, dismissal_count: count || 0 };
    })
  );

  return new Response(JSON.stringify({ banners: enriched }), { status: 200, headers });
}

async function handleCreateBanner(
  svc: ReturnType<typeof createClient>,
  body: Record<string, unknown>,
  adminId: string,
  headers: Record<string, string>,
) {
  const { action: _, ...rest } = body;

  if (!rest.type || !rest.content || !rest.target_mode) {
    return new Response(
      JSON.stringify({ error: "type, content, and target_mode are required" }),
      { status: 400, headers },
    );
  }

  const insert: Record<string, unknown> = { created_by: adminId };
  for (const col of BANNER_COLUMNS) {
    if (rest[col] !== undefined) insert[col] = rest[col];
  }

  const { data, error } = await svc
    .from("global_banners")
    .insert(insert)
    .select()
    .single();
  if (error) throw error;

  return new Response(JSON.stringify({ banner: data }), { status: 201, headers });
}

async function handleUpdateBanner(
  svc: ReturnType<typeof createClient>,
  body: Record<string, unknown>,
  headers: Record<string, string>,
) {
  const { action: _, banner_id, ...rest } = body;

  if (!banner_id) {
    return new Response(
      JSON.stringify({ error: "banner_id is required" }),
      { status: 400, headers },
    );
  }

  const update: Record<string, unknown> = {};
  for (const col of BANNER_COLUMNS) {
    if (rest[col] !== undefined) update[col] = rest[col];
  }

  if (Object.keys(update).length === 0) {
    return new Response(
      JSON.stringify({ error: "No fields to update" }),
      { status: 400, headers },
    );
  }

  const { data, error } = await svc
    .from("global_banners")
    .update(update)
    .eq("id", banner_id)
    .select()
    .single();
  if (error) throw error;

  return new Response(JSON.stringify({ banner: data }), { status: 200, headers });
}

async function handleDeleteBanner(
  svc: ReturnType<typeof createClient>,
  body: { banner_id?: string },
  headers: Record<string, string>,
) {
  const { banner_id } = body;

  if (!banner_id) {
    return new Response(
      JSON.stringify({ error: "banner_id is required" }),
      { status: 400, headers },
    );
  }

  const { data: banner } = await svc
    .from("global_banners")
    .select("status")
    .eq("id", banner_id)
    .single();

  if (banner && banner.status !== "draft") {
    return new Response(
      JSON.stringify({ error: "Only draft banners can be deleted" }),
      { status: 400, headers },
    );
  }

  const { error } = await svc
    .from("global_banners")
    .delete()
    .eq("id", banner_id);
  if (error) throw error;

  return new Response(JSON.stringify({ message: "Banner deleted" }), { status: 200, headers });
}
```

- [ ] **Step 3: Typecheck**

Run: `cd supabase/functions && deno check platform-admin/index.ts`
Expected: No errors.

- [ ] **Step 4: Commit**

```bash
git add supabase/functions/platform-admin/index.ts
git commit -m "feat(banners): add list/create/update/delete banner actions to platform-admin"
```

---

### Task 3: Admin API Client — Banner Types & Functions

**Files:**
- Modify: `apps/admin/src/lib/api.ts`

- [ ] **Step 1: Add the GlobalBanner type after the PlatformAdmin interface**

```typescript
export interface GlobalBanner {
  id: string;
  type: 'info' | 'warning' | 'critical';
  content: string;
  link: string | null;
  custom_color: string | null;
  target_mode: 'all' | 'plan' | 'workspace';
  target_plan_ids: string[] | null;
  target_workspace_ids: string[] | null;
  dismissible: boolean;
  starts_at: string | null;
  ends_at: string | null;
  status: 'draft' | 'active' | 'archived';
  created_by: string | null;
  created_at: string;
  updated_at: string;
  dismissal_count: number;
}
```

- [ ] **Step 2: Add the 4 API functions at the bottom of the file**

```typescript
export function listBanners(params?: { status?: string }) {
  return adminApi<{ banners: GlobalBanner[] }>('list-banners', params || {});
}

export function createBanner(params: Record<string, unknown>) {
  return adminApi<{ banner: GlobalBanner }>('create-banner', params);
}

export function updateBanner(params: Record<string, unknown>) {
  return adminApi<{ banner: GlobalBanner }>('update-banner', params);
}

export function deleteBanner(banner_id: string) {
  return adminApi<{ message: string }>('delete-banner', { banner_id });
}
```

- [ ] **Step 3: Typecheck**

Run: `npm run build 2>&1 | head -20`
Expected: No TypeScript errors from `api.ts`.

- [ ] **Step 4: Commit**

```bash
git add apps/admin/src/lib/api.ts
git commit -m "feat(banners): add GlobalBanner type and API functions to admin client"
```

---

### Task 4: Admin Route & Navigation

**Files:**
- Modify: `apps/admin/src/router.tsx`
- Modify: `apps/admin/src/layouts/AdminLayout.tsx`

- [ ] **Step 1: Add BannersPage import and route to router.tsx**

Add the import at the top with the other page imports:

```typescript
import BannersPage from './pages/BannersPage';
```

Add the route inside the `children` array, after the `admins` route:

```typescript
      { path: 'banners', element: <BannersPage /> },
```

- [ ] **Step 2: Add Banners nav item to AdminLayout.tsx**

Add `Megaphone` to the lucide-react import:

```typescript
import { LayoutDashboard, Building2, Package, Users, Menu, X, Sun, Moon, Megaphone } from 'lucide-react';
```

Add the Banners entry to `NAV_ITEMS`, after Admins:

```typescript
  { to: '/admin/banners', icon: Megaphone, label: 'Banners' },
```

- [ ] **Step 3: Typecheck**

Run: `npm run build 2>&1 | head -20`
Expected: Error about missing `BannersPage` module (expected — we create it in the next task).

- [ ] **Step 4: Commit**

```bash
git add apps/admin/src/router.tsx apps/admin/src/layouts/AdminLayout.tsx
git commit -m "feat(banners): add banners route and nav item to admin portal"
```

---

### Task 5: Admin Banners Page

**Files:**
- Create: `apps/admin/src/pages/BannersPage.tsx`

- [ ] **Step 1: Create the BannersPage component**

```tsx
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2, Pencil } from 'lucide-react';
import { toast } from 'sonner';
import {
  listBanners, createBanner, updateBanner, deleteBanner,
  listPlans, listWorkspaces,
  type GlobalBanner,
} from '../lib/api';

const BANNER_TYPES = ['info', 'warning', 'critical'] as const;
const TARGET_MODES = ['all', 'plan', 'workspace'] as const;
const STATUSES = ['draft', 'active', 'archived'] as const;

const TYPE_COLORS: Record<string, { accent: string; bg: string }> = {
  info: { accent: '#42c8f5', bg: 'rgba(66,200,245,0.08)' },
  warning: { accent: '#f5a342', bg: 'rgba(245,163,66,0.10)' },
  critical: { accent: '#f55a42', bg: 'rgba(245,90,66,0.12)' },
};

interface FormState {
  type: 'info' | 'warning' | 'critical';
  content: string;
  link: string;
  custom_color: string;
  target_mode: 'all' | 'plan' | 'workspace';
  target_plan_ids: string[];
  target_workspace_ids: string[];
  dismissible: boolean;
  starts_at: string;
  ends_at: string;
  status: 'draft' | 'active' | 'archived';
}

const EMPTY_FORM: FormState = {
  type: 'info', content: '', link: '', custom_color: '',
  target_mode: 'all', target_plan_ids: [], target_workspace_ids: [],
  dismissible: true, starts_at: '', ends_at: '', status: 'draft',
};

function bannerToForm(b: GlobalBanner): FormState {
  return {
    type: b.type,
    content: b.content,
    link: b.link || '',
    custom_color: b.custom_color || '',
    target_mode: b.target_mode,
    target_plan_ids: b.target_plan_ids || [],
    target_workspace_ids: b.target_workspace_ids || [],
    dismissible: b.dismissible,
    starts_at: b.starts_at ? b.starts_at.slice(0, 16) : '',
    ends_at: b.ends_at ? b.ends_at.slice(0, 16) : '',
    status: b.status,
  };
}

function formToPayload(form: FormState): Record<string, unknown> {
  return {
    type: form.type,
    content: form.content,
    link: form.link || null,
    custom_color: form.custom_color || null,
    target_mode: form.target_mode,
    target_plan_ids: form.target_mode === 'plan' ? form.target_plan_ids : null,
    target_workspace_ids: form.target_mode === 'workspace' ? form.target_workspace_ids : null,
    dismissible: form.dismissible,
    starts_at: form.starts_at ? new Date(form.starts_at).toISOString() : null,
    ends_at: form.ends_at ? new Date(form.ends_at).toISOString() : null,
    status: form.status,
  };
}

export default function BannersPage() {
  const queryClient = useQueryClient();
  const [editingBanner, setEditingBanner] = useState<GlobalBanner | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<FormState>({ ...EMPTY_FORM });
  const [statusFilter, setStatusFilter] = useState('');
  const [search, setSearch] = useState('');

  const { data, isLoading } = useQuery({
    queryKey: ['admin', 'banners', statusFilter],
    queryFn: () => listBanners(statusFilter ? { status: statusFilter } : undefined),
  });

  const { data: plansData } = useQuery({
    queryKey: ['admin', 'plans'],
    queryFn: listPlans,
  });

  const { data: workspacesData } = useQuery({
    queryKey: ['admin', 'workspaces-all'],
    queryFn: () => listWorkspaces({ limit: 500 }),
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['admin', 'banners'] });

  const createMut = useMutation({
    mutationFn: () => createBanner(formToPayload(form)),
    onSuccess: () => { invalidate(); toast.success('Banner created'); closeForm(); },
    onError: (err: Error) => toast.error(err.message),
  });

  const updateMut = useMutation({
    mutationFn: () => updateBanner({ banner_id: editingBanner!.id, ...formToPayload(form) }),
    onSuccess: () => { invalidate(); toast.success('Banner updated'); closeForm(); },
    onError: (err: Error) => toast.error(err.message),
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => deleteBanner(id),
    onSuccess: () => { invalidate(); toast.success('Banner deleted'); closeForm(); },
    onError: (err: Error) => toast.error(err.message),
  });

  const openCreate = () => {
    setEditingBanner(null);
    setForm({ ...EMPTY_FORM });
    setShowForm(true);
  };

  const openEdit = (b: GlobalBanner) => {
    setEditingBanner(b);
    setForm(bannerToForm(b));
    setShowForm(true);
  };

  const closeForm = () => { setShowForm(false); setEditingBanner(null); };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (editingBanner) updateMut.mutate(); else createMut.mutate();
  };

  const banners = (data?.banners || []).filter((b) =>
    !search || b.content.toLowerCase().includes(search.toLowerCase())
  );

  const isExpired = (b: GlobalBanner) =>
    b.status === 'active' && b.ends_at && new Date(b.ends_at) < new Date();

  const getStatusBadge = (b: GlobalBanner) => {
    if (isExpired(b)) return { label: 'EXPIRED', cls: 'text-dim-foreground bg-secondary' };
    if (b.status === 'active') return { label: 'ACTIVE', cls: 'text-success bg-success/15' };
    if (b.status === 'draft') return { label: 'DRAFT', cls: 'text-muted-foreground bg-secondary' };
    return { label: 'ARCHIVED', cls: 'text-dim-foreground bg-secondary' };
  };

  const formatSchedule = (b: GlobalBanner) => {
    const fmt = (s: string) => new Date(s).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' });
    const start = b.starts_at ? fmt(b.starts_at) : 'Now';
    const end = b.ends_at ? fmt(b.ends_at) : '∞';
    return `${start} → ${end}`;
  };

  const getTargetLabel = (b: GlobalBanner) => {
    if (b.target_mode === 'all') return 'All workspaces';
    if (b.target_mode === 'plan') {
      const names = (b.target_plan_ids || []).map((pid) => {
        const p = plansData?.plans?.find((pl) => pl.id === pid);
        return p?.name || pid;
      });
      return names.join(', ');
    }
    return `${(b.target_workspace_ids || []).length} workspaces`;
  };

  return (
    <div>
      <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-3 mb-6">
        <div>
          <h1 className="font-['Playfair_Display'] text-2xl font-bold mb-1">Banners</h1>
          <p className="text-sm text-muted-foreground">Manage global announcements</p>
        </div>
        <button onClick={openCreate} className="flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-primary text-primary-foreground font-semibold text-sm hover:bg-primary-hover transition-colors">
          <Plus size={16} /> New Banner
        </button>
      </div>

      <div className="flex flex-col sm:flex-row gap-3 mb-6">
        <input type="text" placeholder="Search banners..." value={search} onChange={(e) => setSearch(e.target.value)}
          className="flex-1 px-3 py-2.5 rounded-lg bg-card border border-border text-sm text-foreground placeholder-muted-foreground focus:outline-none focus:border-primary" />
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}
          className="px-3 py-2.5 rounded-lg bg-card border border-border text-sm text-muted-foreground focus:outline-none focus:border-primary">
          <option value="">All Statuses</option>
          {STATUSES.map((s) => <option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</option>)}
        </select>
      </div>

      <div className="bg-card border border-border rounded-2xl p-5">
        <div className="hidden md:grid grid-cols-[2fr_0.7fr_1fr_1fr_0.7fr_0.5fr] gap-2 text-[0.7rem] text-muted-foreground uppercase tracking-wider pb-3 border-b border-border">
          <span>Content</span><span>Type</span><span>Target</span><span>Schedule</span><span>Status</span><span></span>
        </div>

        {isLoading ? (
          <p className="text-sm text-dim-foreground py-4">Loading...</p>
        ) : banners.length === 0 ? (
          <p className="text-sm text-dim-foreground py-4">No banners found.</p>
        ) : (
          banners.map((b) => {
            const tc = TYPE_COLORS[b.type];
            const badge = getStatusBadge(b);
            return (
              <div key={b.id}
                onClick={() => openEdit(b)}
                className={`cursor-pointer hover:bg-secondary/30 transition-colors border-b border-border/50 py-3 -mx-5 px-5 ${b.status === 'draft' ? 'opacity-50' : ''}`}
              >
                {/* Mobile card */}
                <div className="md:hidden flex flex-col gap-1.5">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium truncate">{b.content.slice(0, 60)}{b.content.length > 60 ? '...' : ''}</span>
                  </div>
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                    <span className="text-[0.65rem] font-semibold uppercase px-1.5 py-0.5 rounded-sm" style={{ color: tc.accent, backgroundColor: tc.bg }}>{b.type}</span>
                    <span>{getTargetLabel(b)}</span>
                    <span className={`text-[0.65rem] font-semibold uppercase px-1.5 py-0.5 rounded-sm ${badge.cls}`}>{badge.label}</span>
                  </div>
                </div>
                {/* Desktop row */}
                <div className="hidden md:grid grid-cols-[2fr_0.7fr_1fr_1fr_0.7fr_0.5fr] gap-2 items-center">
                  <div>
                    <div className="text-sm font-medium truncate">{b.content.slice(0, 80)}{b.content.length > 80 ? '...' : ''}</div>
                    <div className="text-xs text-muted-foreground mt-0.5">{getTargetLabel(b)}</div>
                  </div>
                  <span className="text-[0.65rem] font-semibold uppercase px-1.5 py-0.5 rounded-sm w-fit" style={{ color: tc.accent, backgroundColor: tc.bg }}>{b.type}</span>
                  <span className="text-sm text-muted-foreground">{b.target_mode === 'all' ? 'All' : b.target_mode === 'plan' ? 'Plan' : 'Workspace'}</span>
                  <span className="text-sm text-muted-foreground">{formatSchedule(b)}</span>
                  <span className={`text-[0.65rem] font-semibold uppercase px-1.5 py-0.5 rounded-sm w-fit ${badge.cls}`}>{badge.label}</span>
                  <span className="text-muted-foreground hover:text-primary"><Pencil size={14} /></span>
                </div>
              </div>
            );
          })
        )}
      </div>

      {showForm && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50" onClick={closeForm}>
          <div className="bg-card border border-border rounded-2xl p-5 md:p-8 w-full max-w-2xl max-h-[85vh] overflow-y-auto mx-4 md:mx-0" onClick={(e) => e.stopPropagation()}>
            <h2 className="font-['Playfair_Display'] text-lg font-bold mb-6">
              {editingBanner ? 'Edit Banner' : 'New Banner'}
            </h2>

            <form onSubmit={handleSubmit} className="flex flex-col gap-5">
              <div>
                <label className="block text-xs font-medium text-muted-foreground uppercase tracking-wider mb-1.5">Content (Markdown)</label>
                <textarea value={form.content} onChange={(e) => setForm((f) => ({ ...f, content: e.target.value }))} required rows={3}
                  className="w-full px-3 py-2 rounded-lg bg-secondary border border-transparent text-sm font-['DM_Mono'] text-foreground focus:outline-none focus:border-primary resize-none" />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-muted-foreground uppercase tracking-wider mb-1.5">Link (optional)</label>
                  <input type="url" value={form.link} onChange={(e) => setForm((f) => ({ ...f, link: e.target.value }))}
                    placeholder="https://..."
                    className="w-full px-3 py-2 rounded-lg bg-secondary border border-transparent text-sm font-['DM_Mono'] text-foreground placeholder-dim-foreground focus:outline-none focus:border-primary" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-muted-foreground uppercase tracking-wider mb-1.5">Custom Color (optional)</label>
                  <input type="text" value={form.custom_color} onChange={(e) => setForm((f) => ({ ...f, custom_color: e.target.value }))}
                    placeholder="#ff5500"
                    className="w-full px-3 py-2 rounded-lg bg-secondary border border-transparent text-sm font-['DM_Mono'] text-foreground placeholder-dim-foreground focus:outline-none focus:border-primary" />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-muted-foreground uppercase tracking-wider mb-1.5">Type</label>
                  <select value={form.type} onChange={(e) => setForm((f) => ({ ...f, type: e.target.value as FormState['type'] }))}
                    className="w-full px-3 py-2 rounded-lg bg-secondary border border-transparent text-sm text-foreground focus:outline-none focus:border-primary">
                    {BANNER_TYPES.map((t) => <option key={t} value={t}>{t.charAt(0).toUpperCase() + t.slice(1)}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-muted-foreground uppercase tracking-wider mb-1.5">Status</label>
                  <select value={form.status} onChange={(e) => setForm((f) => ({ ...f, status: e.target.value as FormState['status'] }))}
                    className="w-full px-3 py-2 rounded-lg bg-secondary border border-transparent text-sm text-foreground focus:outline-none focus:border-primary">
                    {STATUSES.map((s) => <option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</option>)}
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">Target</label>
                <div className="flex gap-3 mb-3">
                  {TARGET_MODES.map((m) => (
                    <label key={m} className="flex items-center gap-2 text-sm text-muted-foreground">
                      <input type="radio" name="target_mode" value={m} checked={form.target_mode === m}
                        onChange={() => setForm((f) => ({ ...f, target_mode: m, target_plan_ids: [], target_workspace_ids: [] }))} />
                      {m === 'all' ? 'All' : m === 'plan' ? 'By Plan' : 'By Workspace'}
                    </label>
                  ))}
                </div>

                {form.target_mode === 'plan' && plansData?.plans && (
                  <div className="flex flex-wrap gap-2">
                    {plansData.plans.map((p) => (
                      <label key={p.id} className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs cursor-pointer transition-colors ${
                        form.target_plan_ids.includes(p.id) ? 'bg-primary/20 text-primary border border-primary/30' : 'bg-secondary text-muted-foreground border border-transparent'
                      }`}>
                        <input type="checkbox" className="hidden"
                          checked={form.target_plan_ids.includes(p.id)}
                          onChange={(e) => setForm((f) => ({
                            ...f,
                            target_plan_ids: e.target.checked
                              ? [...f.target_plan_ids, p.id]
                              : f.target_plan_ids.filter((id) => id !== p.id),
                          }))} />
                        {p.name}
                      </label>
                    ))}
                  </div>
                )}

                {form.target_mode === 'workspace' && workspacesData?.workspaces && (
                  <div className="flex flex-wrap gap-2 max-h-40 overflow-y-auto">
                    {workspacesData.workspaces.map((ws) => (
                      <label key={ws.id} className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs cursor-pointer transition-colors ${
                        form.target_workspace_ids.includes(ws.id) ? 'bg-primary/20 text-primary border border-primary/30' : 'bg-secondary text-muted-foreground border border-transparent'
                      }`}>
                        <input type="checkbox" className="hidden"
                          checked={form.target_workspace_ids.includes(ws.id)}
                          onChange={(e) => setForm((f) => ({
                            ...f,
                            target_workspace_ids: e.target.checked
                              ? [...f.target_workspace_ids, ws.id]
                              : f.target_workspace_ids.filter((id) => id !== ws.id),
                          }))} />
                        {ws.name}
                      </label>
                    ))}
                  </div>
                )}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-muted-foreground uppercase tracking-wider mb-1.5">Starts At (optional)</label>
                  <input type="datetime-local" value={form.starts_at} onChange={(e) => setForm((f) => ({ ...f, starts_at: e.target.value }))}
                    className="w-full px-3 py-2 rounded-lg bg-secondary border border-transparent text-sm font-['DM_Mono'] text-foreground focus:outline-none focus:border-primary" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-muted-foreground uppercase tracking-wider mb-1.5">Ends At (optional)</label>
                  <input type="datetime-local" value={form.ends_at} onChange={(e) => setForm((f) => ({ ...f, ends_at: e.target.value }))}
                    className="w-full px-3 py-2 rounded-lg bg-secondary border border-transparent text-sm font-['DM_Mono'] text-foreground focus:outline-none focus:border-primary" />
                </div>
              </div>

              <label className="flex items-center gap-2 text-sm text-muted-foreground">
                <input type="checkbox" checked={form.dismissible} onChange={(e) => setForm((f) => ({ ...f, dismissible: e.target.checked }))} className="rounded" />
                Dismissible
              </label>

              {/* Live preview */}
              <div>
                <label className="block text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">Preview</label>
                <BannerPreview type={form.type} content={form.content} customColor={form.custom_color} link={form.link} dismissible={form.dismissible} />
              </div>

              <div className="flex gap-3 mt-2">
                <button type="submit" disabled={createMut.isPending || updateMut.isPending}
                  className="flex-1 py-2.5 rounded-lg bg-primary text-primary-foreground font-semibold text-sm hover:bg-primary-hover transition-colors disabled:opacity-50">
                  {editingBanner ? 'Update' : 'Create'}
                </button>
                <button type="button" onClick={closeForm}
                  className="px-4 py-2.5 rounded-lg border border-border text-sm text-muted-foreground hover:border-primary transition-colors">
                  Cancel
                </button>
                {editingBanner && editingBanner.status === 'draft' && (
                  <button type="button" onClick={() => deleteMut.mutate(editingBanner.id)} disabled={deleteMut.isPending}
                    className="px-4 py-2.5 rounded-lg border border-destructive/30 text-sm text-destructive hover:bg-destructive/10 transition-colors disabled:opacity-50">
                    <Trash2 size={16} />
                  </button>
                )}
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

function BannerPreview({ type, content, customColor, link, dismissible }: {
  type: string; content: string; customColor: string; link: string; dismissible: boolean;
}) {
  const tc = TYPE_COLORS[type] || TYPE_COLORS.info;
  const accent = customColor || tc.accent;
  const bg = customColor
    ? `${customColor}14`
    : tc.bg;

  return (
    <div style={{ background: bg, borderBottom: `1px solid ${accent}33` }}
      className="rounded-lg px-4 py-2.5 flex items-center gap-2">
      <div className="flex-1 text-center text-sm text-foreground">
        {content || 'Banner preview...'}
        {link && <span style={{ color: accent }} className="ml-1 underline text-sm">Link</span>}
      </div>
      {dismissible && <span className="text-muted-foreground text-lg cursor-default">×</span>}
    </div>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run build 2>&1 | head -20`
Expected: Build succeeds.

- [ ] **Step 3: Test in browser**

Run: `npm run dev` (admin app on :5173)
Navigate to `/admin/banners`. Verify:
- Page loads with empty state
- "New Banner" button opens modal
- Form fields render correctly
- Target mode radio switches show/hide plan and workspace selectors
- Preview strip updates as you type
- Create a test banner (draft status) and verify it appears in the list

- [ ] **Step 4: Commit**

```bash
git add apps/admin/src/pages/BannersPage.tsx
git commit -m "feat(banners): add BannersPage with CRUD modal and live preview"
```

---

### Task 6: CRM Store — Banner Query Functions

**Files:**
- Modify: `apps/crm/src/store.ts`

- [ ] **Step 1: Add banner types and query functions**

Add at the bottom of `store.ts`, after the notification functions:

```typescript
// ─── Banners ──────────────────────────────────────────────────

export interface GlobalBanner {
  id: string;
  type: 'info' | 'warning' | 'critical';
  content: string;
  link: string | null;
  custom_color: string | null;
  dismissible: boolean;
  created_at: string;
}

export async function getActiveBanners(): Promise<GlobalBanner[]> {
  const { data, error } = await supabase
    .from('global_banners')
    .select('id, type, content, link, custom_color, dismissible, created_at')
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data || [];
}

export async function getDismissedBannerIds(): Promise<string[]> {
  const user = await getCurrentUser();
  if (!user) return [];
  const { data, error } = await supabase
    .from('banner_dismissals')
    .select('banner_id')
    .eq('user_id', user.id);
  if (error) throw error;
  return (data || []).map((d) => d.banner_id);
}

export async function dismissBanner(bannerId: string): Promise<void> {
  const user = await getCurrentUser();
  if (!user) throw new Error('Not authenticated');
  const { error } = await supabase
    .from('banner_dismissals')
    .insert({ banner_id: bannerId, user_id: user.id });
  if (error && error.code !== '23505') throw error;
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run build 2>&1 | head -20`
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add apps/crm/src/store.ts
git commit -m "feat(banners): add banner query functions to CRM store"
```

---

### Task 7: CRM Hook — useBanners

**Files:**
- Create: `apps/crm/src/hooks/useBanners.ts`

- [ ] **Step 1: Create the hook**

```typescript
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { getActiveBanners, getDismissedBannerIds, dismissBanner, type GlobalBanner } from '../store';

const BANNERS_KEY = ['banners'] as const;
const DISMISSED_KEY = ['banner-dismissals'] as const;

const TYPE_PRIORITY: Record<string, number> = { critical: 0, warning: 1, info: 2 };

export function useBanners() {
  const queryClient = useQueryClient();

  const bannersQuery = useQuery({
    queryKey: BANNERS_KEY,
    queryFn: getActiveBanners,
    staleTime: 60_000,
    refetchInterval: 300_000,
  });

  const dismissedQuery = useQuery({
    queryKey: DISMISSED_KEY,
    queryFn: getDismissedBannerIds,
    staleTime: 60_000,
  });

  const dismissMutation = useMutation({
    mutationFn: dismissBanner,
    onMutate: async (bannerId) => {
      await queryClient.cancelQueries({ queryKey: DISMISSED_KEY });
      const prev = queryClient.getQueryData<string[]>(DISMISSED_KEY);
      queryClient.setQueryData<string[]>(DISMISSED_KEY, (old) => [...(old || []), bannerId]);
      return { prev };
    },
    onError: (_err, _bannerId, context) => {
      if (context?.prev) queryClient.setQueryData(DISMISSED_KEY, context.prev);
      toast.error('Failed to dismiss banner');
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: DISMISSED_KEY });
    },
  });

  const dismissed = new Set(dismissedQuery.data || []);
  const visibleBanners = (bannersQuery.data || [])
    .filter((b) => !dismissed.has(b.id))
    .sort((a, b) => {
      const pa = TYPE_PRIORITY[a.type] ?? 9;
      const pb = TYPE_PRIORITY[b.type] ?? 9;
      if (pa !== pb) return pa - pb;
      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
    });

  return {
    banners: visibleBanners,
    dismiss: (id: string) => dismissMutation.mutate(id),
    isLoading: bannersQuery.isLoading,
  };
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run build 2>&1 | head -20`
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add apps/crm/src/hooks/useBanners.ts
git commit -m "feat(banners): add useBanners hook with optimistic dismissal"
```

---

### Task 8: CRM Banner Display Component

**Files:**
- Create: `apps/crm/src/components/layout/GlobalBannerContainer.tsx`

- [ ] **Step 1: Create the component**

```tsx
import { useRef, useEffect } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useBanners } from '../../hooks/useBanners';
import { sanitizeUrl } from '../../utils/security';
import type { GlobalBanner } from '../../store';

const TYPE_STYLES: Record<string, { accent: string; bg: string; border: string }> = {
  info: { accent: '#42c8f5', bg: 'rgba(66,200,245,0.08)', border: 'rgba(66,200,245,0.15)' },
  warning: { accent: '#f5a342', bg: 'rgba(245,163,66,0.10)', border: 'rgba(245,163,66,0.20)' },
  critical: { accent: '#f55a42', bg: 'rgba(245,90,66,0.12)', border: 'rgba(245,90,66,0.25)' },
};

function getStyles(banner: GlobalBanner) {
  const base = TYPE_STYLES[banner.type] || TYPE_STYLES.info;
  if (!banner.custom_color) return base;
  return {
    accent: banner.custom_color,
    bg: `${banner.custom_color}14`,
    border: `${banner.custom_color}33`,
  };
}

function contentHasLinks(content: string): boolean {
  return /\[.*?\]\(.*?\)/.test(content) || /<a\s/i.test(content);
}

export default function GlobalBannerContainer() {
  const { banners, dismiss } = useBanners();
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const height = containerRef.current?.offsetHeight || 0;
    document.documentElement.style.setProperty('--banner-height', `${height}px`);
    return () => {
      document.documentElement.style.setProperty('--banner-height', '0px');
    };
  }, [banners.length]);

  if (banners.length === 0) return null;

  return (
    <div ref={containerRef} className="banner-container">
      {banners.map((b) => {
        const styles = getStyles(b);
        const hasInlineLinks = contentHasLinks(b.content);
        const useLink = b.link && !hasInlineLinks;

        const inner = (
          <>
            <div className="banner-content" style={b.type === 'critical' ? { color: styles.accent } : undefined}>
              <ReactMarkdown remarkPlugins={[remarkGfm]}
                components={{
                  p: ({ children }) => <span>{children}</span>,
                  a: ({ href, children }) => (
                    <a href={sanitizeUrl(href || '')} target="_blank" rel="noopener noreferrer"
                      style={{ color: styles.accent, textDecoration: 'underline' }}
                      onClick={(e) => e.stopPropagation()}>
                      {children}
                    </a>
                  ),
                }}>
                {b.content}
              </ReactMarkdown>
            </div>
            {b.dismissible && (
              <button className="banner-dismiss" onClick={(e) => { e.preventDefault(); e.stopPropagation(); dismiss(b.id); }}
                aria-label="Dismiss banner">
                ×
              </button>
            )}
          </>
        );

        return useLink ? (
          <a key={b.id} href={sanitizeUrl(b.link!)} target="_blank" rel="noopener noreferrer"
            className="banner-bar" style={{ background: styles.bg, borderBottom: `1px solid ${styles.border}` }}>
            {inner}
          </a>
        ) : (
          <div key={b.id} className="banner-bar"
            style={{ background: styles.bg, borderBottom: `1px solid ${styles.border}` }}>
            {inner}
          </div>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run build 2>&1 | head -20`
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add apps/crm/src/components/layout/GlobalBannerContainer.tsx
git commit -m "feat(banners): add GlobalBannerContainer component with markdown rendering"
```

---

### Task 9: CRM Layout Integration & CSS

**Files:**
- Modify: `apps/crm/src/components/layout/AppLayout.tsx`
- Modify: `style.css` (CRM)

- [ ] **Step 1: Add GlobalBannerContainer to AppLayout**

Add the import at the top of `AppLayout.tsx`:

```typescript
import GlobalBannerContainer from './GlobalBannerContainer';
```

Add the component inside the `app-container` div, as a sibling right after the TopBar conditional block and before the Sidebar:

```tsx
      <GlobalBannerContainer />
```

The full return becomes:
```tsx
    <div className="app-container">
      {!isMobile && (
        <TopBar
          showHamburger={isTablet}
          isDrawerOpen={drawerOpen}
          onHamburgerClick={() => setDrawerOpen(v => !v)}
        />
      )}

      <GlobalBannerContainer />

      <Sidebar
        isDrawer={isTablet}
        isOpen={drawerOpen}
        onClose={closeDrawer}
      />

      {isTablet && drawerOpen && (
        <div
          className="tablet-drawer-backdrop visible"
          onClick={closeDrawer}
        />
      )}

      <main className="main-content" id="app">
        <Outlet />
      </main>

      <MobileNav />
    </div>
```

- [ ] **Step 2: Add banner CSS to style.css**

Find the `.main-content` rule in `style.css` (around line 673). Add `--banner-height: 0px` to `:root` and update the offsets. Add the banner-specific CSS at the end of the layout section:

Add to the `:root` block (around line 128):
```css
  --banner-height: 0px;
```

Update `.main-content` margin-top (around line 678):
```css
  margin-top: calc(var(--topbar-height) + var(--banner-height, 0px));
  height: calc(100dvh - var(--topbar-height) - var(--banner-height, 0px));
```

Update `.sidebar` top offset (around line 205):
```css
  top: calc(var(--topbar-height) + var(--banner-height, 0px));
  height: calc(100dvh - var(--topbar-height) - var(--banner-height, 0px));
```

Add new banner styles (append after the topbar section):
```css
/* ─── Global Banners ─────────────────────────────── */

.banner-container {
  position: fixed;
  top: var(--topbar-height);
  left: var(--sidebar-width);
  right: 0;
  z-index: 105;
  display: flex;
  flex-direction: column;
}

.banner-bar {
  display: flex;
  align-items: center;
  padding: 10px 20px;
  font-family: var(--font-main);
  font-size: 0.85rem;
  text-decoration: none;
  color: var(--text-main);
}

.banner-content {
  flex: 1;
  text-align: center;
  line-height: 1.4;
}

.banner-content p, .banner-content span {
  margin: 0;
}

.banner-dismiss {
  flex-shrink: 0;
  background: none;
  border: none;
  color: var(--text-muted);
  font-size: 1.1rem;
  cursor: pointer;
  padding: 0 4px;
  line-height: 1;
}

.banner-dismiss:hover {
  color: var(--text-main);
}
```

Add mobile overrides in the `@media (max-width: 768px)` section:
```css
.banner-container {
  top: 0;
  left: 0;
}
```

And update the mobile `.main-content` overrides:
```css
.main-content {
  margin-top: var(--banner-height, 0px);
  height: calc(100dvh - var(--banner-height, 0px));
}
```

- [ ] **Step 3: Typecheck**

Run: `npm run build 2>&1 | head -20`
Expected: Build succeeds.

- [ ] **Step 4: Test in browser**

Run: `npm run dev` (CRM on :5173)

To test, first create an active banner via the admin portal (Task 5), then navigate to the CRM app. Verify:
- Banner appears below the topbar
- Content renders centered
- Main content is pushed down (no overlap)
- Sidebar top aligns with the bottom of the banner area
- Dismiss button works (banner disappears immediately)
- On mobile (resize to <768px): banner renders at the top of the screen
- Refreshing the page after dismissal: dismissed banner stays hidden

- [ ] **Step 5: Commit**

```bash
git add apps/crm/src/components/layout/AppLayout.tsx style.css
git commit -m "feat(banners): integrate GlobalBannerContainer into CRM layout with CSS positioning"
```

---

### Task 10: Final Typecheck & Test Suite

- [ ] **Step 1: Full typecheck**

Run: `npm run build`
Expected: Both CRM and admin apps build successfully.

- [ ] **Step 2: Run existing tests**

Run: `npm run test`
Expected: All existing tests pass (no regressions).

- [ ] **Step 3: Test end-to-end flow**

1. Admin portal: create a banner (type=warning, target=all, status=active, dismissible=true)
2. CRM app: verify banner appears below topbar
3. CRM app: dismiss the banner, verify it disappears
4. CRM app: refresh page, verify dismissed banner stays hidden
5. Admin portal: create a critical non-dismissible banner
6. CRM app: verify it appears without dismiss button
7. Admin portal: archive the critical banner
8. CRM app: verify it disappears (may need to wait for refetch or refresh)
9. Admin portal: create a scheduled banner (starts_at = 1 hour in future)
10. CRM app: verify it does not appear yet
11. Admin portal: verify expired banners show EXPIRED badge

- [ ] **Step 4: Commit any fixes and final commit**

```bash
git add -A
git commit -m "feat(banners): complete global banners implementation"
```
